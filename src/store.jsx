import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { idbGet, idbSet, idbDel } from "./lib/idb";
import { encryptText, decryptText, isEncrypted, cryptoAvailable } from "./lib/secure";
export { uid } from "./lib/id";
import { removeCascade as cascade, deletionImpact } from "./lib/cascade";

const STATE_KEY = "state.v1";
const FILES_KEY = "files.v1"; // uploads/generated images live apart from hot state
const LEGACY_KEY = "myrpg.state.v1"; // pre-IDB localStorage state

const seedState = {
  profiles: [
    // sampler fields null = inherit from the linked preset (see Settings BLANK)
    { id: "mock", type: "text", name: "Mock Text (offline)", baseURL: "", apiKey: "", model: "mock-1", isMock: true, temperature: null, maxTokens: null, topP: null, presetId: null, style: "" },
    { id: "mock-img", type: "image", name: "Mock Renderer (offline)", baseURL: "", apiKey: "", model: "mock-diffusion", isMock: true, size: "1024x576", style: "" },
    { id: "mock-audio", type: "audio", name: "Mock Voice (offline)", baseURL: "", apiKey: "", model: "mock-tts", isMock: true, voice: "narrator", format: "mp3" },
  ],
  activeProfiles: { text: "mock", image: "mock-img", audio: "mock-audio" },
  characters: [],
  personas: [],
  scenarios: [],
  worlds: [],
  virtualHumans: [],
  lorebooks: [],
  presets: [],
  chats: [],
  userFiles: [], // organized by category, original filenames preserved (uploads are NEVER renamed)
  jailbreak: { enabled: false, text: "" },
};

/** Migrate older state shapes: providers[] → text profiles, etc. */
function migrate(s) {
  if (s.profiles && s.activeProfiles) return s;
  const profiles = s.profiles || (s.providers || []).map((p) => ({
    ...p,
    type: "text",
    temperature: p.temperature ?? 0.8,
    maxTokens: p.maxTokens ?? 1024,
    topP: p.topP ?? 1,
    presetId: null,
    style: "",
  }));
  if (!profiles.some((p) => p.id === "mock")) profiles.unshift(seedState.profiles[0]);
  const activeProfiles = s.activeProfiles || {
    text: s.activeProviderId || profiles[0]?.id || "mock",
    image: seedState.profiles[1].id,
    audio: seedState.profiles[2].id,
  };
  const next = { ...s, profiles, activeProfiles };
  delete next.providers;
  delete next.activeProviderId;
  return next;
}

/**
 * API keys are encrypted at rest — plaintext never hits the disk, and never
 * leaves in a backup. If WebCrypto is unavailable the key is DROPPED rather
 * than written in the clear; `cryptoFailed` tells the UI to say so.
 */
export async function encryptState(s) {
  let cryptoFailed = false;
  const profiles = await Promise.all(
    s.profiles.map(async (p) => {
      if (!p.apiKey || isEncrypted(p.apiKey)) return p;
      try {
        return { ...p, apiKey: await encryptText(p.apiKey) };
      } catch {
        cryptoFailed = true;
        return { ...p, apiKey: "" };
      }
    })
  );
  return { state: { ...s, profiles }, cryptoFailed };
}

/**
 * Decrypt keys back into memory. `undecryptable` counts keys this browser
 * cannot read — normal when a backup is restored on a different device,
 * since the AES key never leaves the browser that made it.
 */
async function decryptState(s) {
  let undecryptable = 0;
  const profiles = await Promise.all(
    s.profiles.map(async (p) => {
      if (!isEncrypted(p.apiKey)) return p;
      const apiKey = await decryptText(p.apiKey);
      if (!apiKey) undecryptable++;
      return { ...p, apiKey };
    })
  );
  return { state: { ...s, profiles }, undecryptable };
}

async function loadState() {
  try {
    let raw = await idbGet(STATE_KEY);
    let files = await idbGet(FILES_KEY);
    if (!raw) {
      // one-time migration from old localStorage state
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) raw = JSON.parse(legacy);
    }
    if (!raw) return seedState;
    const merged = { ...seedState, ...raw, userFiles: files ?? raw.userFiles ?? [] };
    return (await decryptState(migrate(merged))).state;
  } catch {
    return seedState;
  }
}

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [state, setState] = useState(seedState);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cryptoError, setCryptoError] = useState(!cryptoAvailable());
  const savedFilesRef = useRef(null); // reference-identity check: skip rewriting blobs

  useEffect(() => {
    (async () => {
      const loaded = await loadState();
      savedFilesRef.current = loaded.userFiles;
      setState(loaded);
      setReady(true);
      // only drop the legacy copy once the new records exist
      localStorage.removeItem(LEGACY_KEY);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      try {
        const { state: enc, cryptoFailed } = await encryptState(state);
        const { userFiles, ...hot } = enc;
        await idbSet(STATE_KEY, hot);
        // files are large (base64); only rewrite them when they actually changed
        if (userFiles !== savedFilesRef.current) {
          await idbSet(FILES_KEY, userFiles);
          savedFilesRef.current = userFiles;
        }
        setCryptoError(cryptoFailed || !cryptoAvailable());
        setSaveError("");
      } catch (e) {
        setSaveError("Save failed: " + String(e?.message || e));
      }
    }, 300); // debounce rapid updates (e.g. streaming text)
    return () => clearTimeout(t);
  }, [state, ready]);

  const stateRef = React.useRef(state); // detached tasks read the LATEST state
  stateRef.current = state;

  const update = (fn) => setState((s) => ({ ...s, ...fn(s) }));

  const api = {
    state,
    ready,
    getState: () => stateRef.current,
    saveError,
    cryptoError,
    update,
    add(coll, item) {
      update((s) => ({ [coll]: [item, ...s[coll]] }));
    },
    patch(coll, id, patchObj) {
      update((s) => ({
        [coll]: s[coll].map((x) => (x.id === id ? { ...x, ...patchObj } : x)),
      }));
    },
    remove(coll, id) {
      update((s) => ({ [coll]: s[coll].filter((x) => x.id !== id) }));
    },
    /** Delete an item AND clean up everything that referenced it. */
    removeCascade(coll, id) {
      update((s) => cascade(s, coll, id));
    },
    /** What else a delete would touch — for the confirmation prompt. */
    deletionImpact(coll, id) {
      return deletionImpact(state, coll, id);
    },

    /* ---- Connection profiles (text / image / audio) ---- */
    addProfile(p) {
      update((s) => ({ profiles: [...s.profiles, p] }));
    },
    patchProfile(id, patchObj) {
      update((s) => ({
        profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patchObj } : p)),
      }));
    },
    removeProfile(id) {
      update((s) => {
        const prof = s.profiles.find((p) => p.id === id);
        const activeProfiles = { ...s.activeProfiles };
        if (prof && activeProfiles[prof.type] === id) {
          const fallback = s.profiles.find((p) => p.type === prof.type && p.id !== id);
          if (fallback) activeProfiles[prof.type] = fallback.id;
        }
        return { profiles: s.profiles.filter((p) => p.id !== id), activeProfiles };
      });
    },
    setActiveProfile(type, id) {
      update((s) => ({ activeProfiles: { ...s.activeProfiles, [type]: id } }));
    },
    activeProfile(type = "text") {
      const id = state.activeProfiles?.[type];
      return (
        state.profiles.find((p) => p.id === id) ||
        state.profiles.find((p) => p.type === type) ||
        state.profiles[0]
      );
    },

    /* ---- Backup ---- */
    /** Full backup with API keys ENCRYPTED (never the in-memory plaintext). */
    async exportBackup() {
      const { state: enc } = await encryptState(state);
      return enc;
    },
    /** Restore a backup produced by exportBackup(). Replaces all app data. */
    async importBackup(obj) {
      if (!obj || typeof obj !== "object" || !Array.isArray(obj.profiles)) {
        throw new Error("Not a Bard Browser backup file (no profiles array).");
      }
      const { state: next, undecryptable } = await decryptState(migrate({ ...seedState, ...obj }));
      savedFilesRef.current = null; // force the files record to be rewritten
      setState(next);
      return { undecryptable };
    },

    async reset() {
      await idbDel(STATE_KEY);
      await idbDel(FILES_KEY);
      localStorage.removeItem(LEGACY_KEY);
      savedFilesRef.current = null;
      setState(seedState);
    },
  };

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

export const useStore = () => useContext(StoreCtx);
