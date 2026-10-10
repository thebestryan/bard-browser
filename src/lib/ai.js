import { uid } from "./id.js";
import { decryptText } from "./secure.js";
import { normalizePreset } from "./prompt.js";
import { MOCK_WORLDS, MOCK_CHARACTERS, MOCK_PERSONAS, MOCK_SCENARIOS, MOCK_VH, MOCK_LORE } from "./mockdata.js";

/**
 * AI service layer.
 *
 * - `mock` provider: deterministic-ish generated content with zero network.
 * - Real provider: OpenAI-compatible /chat/completions (JSON mode when requested).
 *
 * Every feature routes through here, so a single place controls whether an
 * outside OpenAI-compatible API is used per feature.
 */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Requests hang forever without this; also lets callers cancel via `signal`. */
const REQUEST_TIMEOUT_MS = 120000;

function withTimeout(signal, ms = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Request timed out after ${ms / 1000}s`)), ms);
  signal?.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

function isMock(provider) {
  return !provider || provider.isMock;
}

/**
 * Effective generation parameters for a text profile.
 * A linked preset supplies defaults; explicit profile values win over it
 * (SillyTavern-style: profile = connection + sampler settings + preset).
 */
export function textParams(state, profile) {
  const preset = profile?.presetId ? state.presets.find((p) => p.id === profile.presetId) : null;
  return {
    temperature: profile?.temperature ?? preset?.temperature ?? 0.8,
    maxTokens: profile?.maxTokens ?? preset?.maxTokens ?? 1024,
    topP: profile?.topP ?? preset?.topP ?? 1,
    style: [preset?.style, profile?.style].filter(Boolean).join(" — "),
  };
}

export async function callChat(provider, messages, { temperature = 0.8, maxTokens, topP, json = false, onDelta, signal } = {}) {
  if (provider?.isMock) {
    const text = mockRespond(messages[messages.length - 1]?.content || "");
    if (onDelta) {
      // stream the mock response word by word for realistic UX
      const parts = text.split(/(\s+)/);
      let acc = "";
      for (const part of parts) {
        acc += part;
        onDelta(part);
        await delay(12 + Math.random() * 30);
      }
      return { content: acc, raw: null };
    }
    await delay(600 + Math.random() * 900);
    return { content: text, raw: null };
  }
  const headers = {
    "Content-Type": "application/json",
    ...(provider.apiKey ? { Authorization: `Bearer ${await decryptText(provider.apiKey)}` } : {}),
  };
  const body = JSON.stringify({
    model: provider.model,
    messages,
    temperature,
    ...(topP && topP !== 1 ? { top_p: topP } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(json ? { response_format: { type: "json_object" } } : { stream: !!onDelta }),
  });
  const t = withTimeout(signal);
  let res;
  try {
    res = await fetch(`${provider.baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body,
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  } catch (e) {
    t.done();
    throw e;
  }

  if (onDelta && res.body) {
    // SSE stream: accumulate content deltas, resolve with full text
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = "";
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const ln = line.trim();
          if (!ln.startsWith("data:")) continue;
          const payload = ln.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              onDelta(delta);
            }
          } catch { /* partial frame — keep buffering */ }
        }
      }
    } finally {
      t.done();
      reader.cancel().catch(() => {});
    }
    return { content: acc, raw: null };
  }

  try {
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content ?? "", raw: data };
  } finally {
    t.done();
  }
}

/**
 * Emoji that render as pictures: default-emoji characters, text symbols forced
 * to emoji with U+FE0F, skin-tone modifiers and ZWJ sequences (a profession
 * emoji built from person + ZWJ + object). Plain symbols like (c), TM and
 * arrows are left alone. At the start of a line the following space goes
 * too; elsewhere the preceding one does, so no stray spaces are left behind.
 */
const EMOJI_CORE =
  "(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)\\p{Emoji_Modifier}?\\uFE0F?" +
  "(?:\\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic})\\p{Emoji_Modifier}?\\uFE0F?)*";
const EMOJI_RX = new RegExp(`(?<=^|\\n)${EMOJI_CORE}[ \\t]?|[ \\t]?${EMOJI_CORE}`, "gu");

/** Remove emoji from every string in a value (deep). Untouched strings stay byte-identical. */
export function stripEmoji(v) {
  if (typeof v === "string") {
    const out = v.replace(EMOJI_RX, "");
    return out === v ? v : out.trim();
  }
  if (Array.isArray(v)) {
    // drop only entries that were nothing BUT emoji (a tag that was just a symbol)
    return v.map((x) => [x, stripEmoji(x)]).filter(([a, b]) => !(b === "" && a !== "")).map(([, b]) => b);
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripEmoji(x)]));
  return v;
}

/** Ask the AI for a JSON object. Falls back to extracting JSON from text. */
export async function callJSON(provider, systemPrompt, userPrompt, { signal } = {}) {
  const out = await callChat(
    provider,
    [
      { role: "system", content: systemPrompt + " Respond with a single JSON object only. Do not use emoji anywhere." },
      { role: "user", content: userPrompt },
    ],
    { json: true, temperature: 0.9, signal }
  );
  let text = out.content.trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (m) text = m[0];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model did not return valid JSON:\n" + out.content.slice(0, 400));
  }
  // names, tags, titles and choices end up in the UI — keep emoji out of it
  return stripEmoji(parsed);
}

/* ---------- Mock generation bodies (swapped by real provider when configured) ---------- */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mockWorld() { return pick(MOCK_WORLDS); }
function mockChar(idea) {
  const c = JSON.parse(JSON.stringify(pick(MOCK_CHARACTERS)));
  c.scenario = idea ? `${idea} — ${c.scenario}` : c.scenario;
  return c;
}

function mockRespond(last) {
  return (
    `*The mock narrator weighs your words:* "${last.slice(0, 80)}".\n\n` +
    "The air shifts. Somewhere beyond the scene, a clock ticks forward and the world quietly adjusts — a door unlocks, a rumor spreads, an NPC changes their plan. " +
    "Connect a real OpenAI-compatible provider in Settings and this beat will be written by your model instead."
  );
}

export async function generateCharacter(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    const c = mockChar(idea);
    return { ...c, id: uid(), examples: c.examples || [], createdAt: Date.now() };
  }
  const data = await callJSON(
    provider,
    `You are a character creator for a roleplay app. Given a short idea, produce a full character card.`,
    `Idea: ${idea}\n\nReturn JSON: {"name":"","tags":[],"appearance":"","personality":"","scenario":"","greeting":"","examples":[]}`,
    { signal },
  );
  return {
    id: uid(),
    name: data.name || "Unnamed",
    tags: data.tags || [],
    appearance: data.appearance || "",
    personality: data.personality || "",
    scenario: data.scenario || "",
    greeting: data.greeting || "",
    examples: data.examples || [],
    createdAt: Date.now(),
  };
}

export async function generatePersona(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    const p = pick(MOCK_PERSONAS);
    return {
      ...p,
      description: idea ? `${idea} — ${p.description}` : p.description,
      id: uid(), createdAt: Date.now(),
    };
  }
  const data = await callJSON(
    provider,
    `You create the player's persona for roleplay.`,
    `Idea: ${idea}\n\nReturn JSON: {"name":"","description":"","traits":[],"voice":""}`,
    { signal },
  );
  return {
    id: uid(),
    name: data.name || "You",
    description: data.description || "",
    traits: data.traits || [],
    voice: data.voice || "",
    createdAt: Date.now(),
  };
}

export async function generateScenario(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    const s = pick(MOCK_SCENARIOS);
    return { ...s, summary: idea ? `${idea} — ${s.summary}` : s.summary, id: uid(), createdAt: Date.now() };
  }
  const data = await callJSON(
    provider,
    `You create roleplay scenario setups.`,
    `Idea: ${idea}\n\nReturn JSON: {"title":"","summary":"","opening":"","requiredTags":[]}`,
    { signal },
  );
  return {
    id: uid(),
    title: data.title || "Untitled Scenario",
    summary: data.summary || "",
    opening: data.opening || "",
    requiredTags: data.requiredTags || [],
    createdAt: Date.now(),
  };
}

export async function generateWorld(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    const w = JSON.parse(JSON.stringify(mockWorld()));
    if (idea) w.description = `${idea} — ${w.description}`;
    return { ...w, id: uid(), createdAt: Date.now() };
  }
  const data = await callJSON(
    provider,
    `You are a master worldbuilder for persistent living-world roleplay. Create a rich, playable setting.`,
    `Idea: ${idea}\n\nReturn JSON: {
"name":"","genre":"","tagline":"","description":"",
"locations":[{"name":"","type":"city|town|wilderness|dungeon|building","description":"","mood":""}],
"npcs":[{"name":"","role":"","location":"","personality":"","goal":"","secret":"","schedule":""}],
"factions":[{"name":"","attitude":"friendly|neutral|hostile","description":""}],
"items":[{"name":"","type":"weapon|armor|consumable|tool|treasure","description":""}],
"quests":[{"title":"","description":"","status":"open"}],
"startLocation":"","timeOfDay":"morning","weather":"clear"}`,
    { signal },
  );
  return {
    id: uid(),
    name: data.name || "New World",
    genre: data.genre || "Fantasy",
    tagline: data.tagline || "",
    description: data.description || "",
    locations: data.locations || [],
    npcs: data.npcs || [],
    factions: data.factions || [],
    items: data.items || [],
    quests: data.quests || [],
    startLocation: data.startLocation || data.locations?.[0]?.name || "Nowhere",
    timeOfDay: data.timeOfDay || "morning",
    weather: data.weather || "clear",
    createdAt: Date.now(),
  };
}

export async function generateVirtualHuman(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    const v = JSON.parse(JSON.stringify(pick(MOCK_VH)));
    if (idea) v.personality = `${idea} — ${v.personality}`;
    return { ...v, id: uid(), messages: [], createdAt: Date.now() };
  }
  const data = await callJSON(
    provider,
    `You design a virtual human simulation profile: a person with routines, moods and a life of their own.`,
    `Idea: ${idea}\n\nReturn JSON: {"name":"","age":"","occupation":"","location":"","personality":"","mood":"","routine":[],"memories":[],"boundaries":""}`,
    { signal },
  );
  return {
    id: uid(),
    name: data.name || "Virtual Person",
    age: data.age || "",
    occupation: data.occupation || "",
    location: data.location || "",
    personality: data.personality || "",
    mood: data.mood || "content",
    routine: data.routine || [],
    memories: data.memories || [],
    boundaries: data.boundaries || "",
    messages: [],
    createdAt: Date.now(),
  };
}

export async function generateLorebook(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    const b = JSON.parse(JSON.stringify(pick(MOCK_LORE)));
    if (idea) b.name = `${idea}`.slice(0, 60) || b.name;
    return { ...b, id: uid(), createdAt: Date.now() };
  }
  const data = await callJSON(
    provider,
    `You create lorebooks: keyword-triggered world info entries.`,
    `Idea: ${idea}\n\nReturn JSON: {"name":"","entries":[{"keys":[""],"content":"","priority":1}] }`,
    { signal },
  );
  return {
    id: uid(),
    name: data.name || "New Lorebook",
    entries: (data.entries || []).map((e) => ({ keys: e.keys || [], content: e.content || "", priority: e.priority || 1 })),
    createdAt: Date.now(),
  };
}

export async function generatePreset(provider, idea, { signal } = {}) {
  if (isMock(provider)) {
    return {
      id: uid(),
      name: idea ? String(idea).slice(0, 40) : "Cinematic Roleplay",
      sections: [
        { name: "System rules", role: "system", enabled: true, order: 0 },
        { name: "Lorebook", role: "lore", enabled: true, order: 1 },
        { name: "World state", role: "context", enabled: true, order: 2 },
        { name: "Persona", role: "persona", enabled: true, order: 3 },
        { name: "Character card", role: "character", enabled: true, order: 4 },
        { name: "Memory", role: "memory", enabled: true, order: 5 },
        { name: "Style instructions", role: "instructions", enabled: true, order: 6 },
      ],
      temperature: 0.85, maxTokens: 1024, topP: 1, style: idea ? String(idea) : "Cinematic, slow-burn",
      createdAt: Date.now(),
    };
  }
  const data = await callJSON(
    provider,
    `You create generation presets (prompt ordering + sampler settings).`,
    `Idea: ${idea}\n\nReturn JSON: {"name":"","sections":[{"name":"","role":"system|context|persona|character|scenario|lore|memory|instructions","enabled":true,"order":0}],"temperature":0.8,"maxTokens":1024,"style":""}`,
    { signal },
  );
  return normalizePreset({
    id: uid(),
    name: data.name || "New Preset",
    // LLMs return duplicate/missing `order` values — renumber sequentially
    // or the sections render (and assemble) jumbled.
    sections: (data.sections || []).map((s) => ({ ...s, enabled: s.enabled !== false })),
    temperature: data.temperature ?? 0.8,
    maxTokens: data.maxTokens ?? 1024,
    topP: data.topP ?? 1,
    style: data.style || "",
    createdAt: Date.now(),
  });
}

/* ================= IMAGE / VIDEO GENERATION ================= */

/**
 * Generate an illustration via the active image/video profile.
 * - mock: procedural SVG scene art (offline).
 * - real: OpenAI-compatible /images/generations endpoint.
 * Returns { dataURL, prompt, model }.
 */
export async function generateImage(profile, prompt, { size = "1024x576", refs = [], signal } = {}) {
  const refURLs = refs.map((r) => (typeof r === "string" ? r : r?.dataURL)).filter(Boolean);
  if (isMock(profile)) {
    await delay(800 + Math.random() * 1200);
    // with reference photos: compose them as the identity + mock dressing
    if (refURLs.length) {
      const composed = await mockReferenceCompose(prompt, refURLs);
      return { dataURL: composed, prompt, model: "mock-reference", mime: "image/png", referenceUsed: true };
    }
    return { dataURL: mockSceneSVG(prompt), prompt, model: "mock-scene", mime: "image/svg+xml", referenceUsed: false };
  }
  // with reference photos, try the OpenAI-compatible multipart /images/edits
  // endpoint first; if the provider doesn't support it, fall back to a plain
  // generation and say so.
  if (refURLs.length) {
    try {
      return await editImageFromRefs(profile, prompt, refURLs, { size, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      const plain = await plainGeneration(profile, prompt, { size, signal });
      return {
        ...plain,
        referenceUsed: false,
        note: "This provider rejected the reference image (no /images/edits support) — rendered from the prompt only.",
      };
    }
  }
  const t = withTimeout(signal);
  try {
    return await plainGeneration(profile, prompt, { size, signal: t.signal });
  } finally {
    t.done();
  }
}

async function plainGeneration(profile, prompt, { size, signal } = {}) {
  const res = await fetch(
    `${profile.baseURL.replace(/\/$/, "")}/images/generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(profile.apiKey ? { Authorization: `Bearer ${await decryptText(profile.apiKey)}` } : {}),
      },
      body: JSON.stringify({ model: profile.model, prompt, size, response_format: "b64_json", n: 1 }),
      signal,
    }
  );
  if (!res.ok) throw new Error(`Image API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) return { dataURL: `data:image/png;base64,${item.b64_json}`, prompt, model: profile.model, mime: "image/png" };
  if (item?.url) return { dataURL: item.url, prompt, model: profile.model, mime: "image/png" };
  throw new Error("Image API returned no image data.");
}

const dataURLtoBlob = async (dataURL) => (await fetch(dataURL)).blob();

const loadImgEl = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("reference image unreadable"));
    img.src = src;
  });

/** Reference-guided render via the multipart /images/edits endpoint. */
async function editImageFromRefs(profile, prompt, refs, { size, signal }) {
  const fd = new FormData();
  fd.append("model", profile.model || "");
  fd.append("prompt", `${prompt}. Keep the exact face, hair, build and identity of the reference person.`);
  fd.append("n", "1");
  fd.append("size", size);
  for (let i = 0; i < Math.min(refs.length, 4); i++) {
    const blob = await dataURLtoBlob(refs[i]);
    fd.append(i === 0 ? "image" : "image[]", blob, `reference${i + 1}.png`);
  }
  const res = await fetch(
    `${profile.baseURL.replace(/\/$/, "")}/images/edits`,
    {
      method: "POST",
      headers: {
        ...(profile.apiKey ? { Authorization: `Bearer ${await decryptText(profile.apiKey)}` } : {}),
      },
      body: fd,
      signal,
    }
  );
  if (!res.ok) throw new Error(`Image edits API error ${res.status}`);
  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) return { dataURL: `data:image/png;base64,${item.b64_json}`, prompt, model: profile.model, mime: "image/png", referenceUsed: true };
  if (item?.url) return { dataURL: item.url, prompt, model: profile.model, mime: "image/png", referenceUsed: true };
  throw new Error("Image edits API returned no image data.");
}

/** Offline reference-guided mock: compose the reference photo + mock dressing. */
async function mockReferenceCompose(prompt, refs) {
  let img = null;
  for (const r of refs) {
    try { img = await loadImgEl(r); break; } catch { /* try the next reference */ }
  }
  if (!img) throw new Error("reference image unreadable");
  const W = 1024, H = 576;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0.45, "rgba(13, 15, 23, 0)");
  scrim.addColorStop(1, "rgba(13, 15, 23, 0.9)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(13, 15, 23, 0.78)";
  ctx.fillRect(24, H - 46, W - 48, 28);
  ctx.font = "12px monospace";
  ctx.fillStyle = "#07aed7";
  ctx.fillText("REFERENCE-GUIDED RENDER (MOCK)", 34, H - 27);
  ctx.fillStyle = "#9aa1c0";
  ctx.textAlign = "right";
  ctx.fillText(prompt.slice(0, 60).replace(/[<>&]/g, ""), W - 34, H - 27);
  return canvas.toDataURL("image/png");
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** Procedural scene art for offline mode — deterministic per prompt. */
function mockSceneSVG(prompt) {
  const h = hashStr(prompt);
  const scenes = [
    { sky: ["#1b2a52", "#3c2f6e", "#7c5cff"], sun: "#ffd27c", sil: "#0d0f17", water: true, label: "twilight city" },
    { sky: ["#0e2f33", "#155e63", "#4fc3f7"], sun: "#e6f7ff", sil: "#06181a", water: false, label: "misty isles" },
    { sky: ["#2a1420", "#5c2a33", "#ff6b7a"], sun: "#ffb454", sil: "#140a0e", water: false, label: "ember wastes" },
    { sky: ["#101c14", "#1f4029", "#43d6a0"], sun: "#f4ffd4", sil: "#081109", water: true, label: "verdant valley" },
    { sky: ["#191a2e", "#2c3358", "#9aa1c0"], sun: "#dfe6ff", sil: "#0a0b14", water: true, label: "night harbor" },
  ];
  const s = scenes[h % scenes.length];
  const W = 1024, H = 576;
  const stars = Array.from({ length: 40 }, (_, i) => {
    const x = (hashStr(prompt + i) % W), y = (hashStr("y" + prompt + i) % (H * 0.55));
    return `<circle cx="${x}" cy="${y}" r="${(i % 3) * 0.6 + 0.7}" fill="#ffffff" opacity="0.7"/>`;
  }).join("");
  const ridge = (base, amp, color, op) => {
    let d = `M0 ${H} L0 ${base}`;
    for (let x = 0; x <= W; x += 64) {
      const hh = base - (hashStr(prompt + color + x) % amp);
      d += ` L${x} ${hh}`;
    }
    return `<path d="${d} L${W} ${H} Z" fill="${color}" opacity="${op}"/>`;
  };
  const buildings = Array.from({ length: 14 }, (_, i) => {
    const bw = 46 + (hashStr("b" + prompt + i) % 50);
    const bh = 90 + (hashStr("h" + prompt + i) % 190);
    const x = i * 76 - 20;
    const y = H * 0.72 - bh;
    const win = Array.from({ length: 6 }, (_, w) =>
      `<rect x="${x + 8 + (w % 2) * 20}" y="${y + 14 + Math.floor(w / 2) * 26}" width="9" height="12" fill="#ffd27c" opacity="${0.35 + (hashStr("w" + i + w) % 50) / 100}"/>`
    ).join("");
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${s.sil}"/>${win}`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${s.sky[0]}"/><stop offset="0.55" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.42" r="0.5">
        <stop offset="0" stop-color="${s.sun}" stop-opacity="0.9"/><stop offset="1" stop-color="${s.sun}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${stars}
    <circle cx="${W * 0.72}" cy="${H * 0.3}" r="130" fill="url(#glow)"/>
    <circle cx="${W * 0.72}" cy="${H * 0.3}" r="34" fill="${s.sun}"/>
    ${ridge(H * 0.62, 130, s.sil, 0.55)}
    ${buildings}
    ${ridge(H * 0.78, 60, s.sil, 0.9)}
    ${s.water ? `<rect x="0" y="${H * 0.86}" width="${W}" height="${H * 0.14}" fill="${s.sky[2]}" opacity="0.35"/>` : ""}
    <rect x="24" y="${H - 46}" rx="8" width="${Math.min(W - 48, 34 + prompt.length * 6.4)}" height="28" fill="rgba(13,15,23,0.75)" stroke="#3a4066"/>
    <text x="38" y="${H - 26}" font-family="Segoe UI, sans-serif" font-size="13" fill="#e6e9f5">✦ MOCK RENDER — ${s.label}</text>
    <text x="${W - 24}" y="${H - 26}" text-anchor="end" font-family="Segoe UI, sans-serif" font-size="11" fill="#9aa1c0">${prompt.slice(0, 70).replace(/[<>&]/g, "")}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Byte length of a data: URL payload (base64 or percent-encoded). */
function dataURLSize(dataURL) {
  const comma = String(dataURL).indexOf(",");
  if (comma < 0) return 0;
  const payload = dataURL.slice(comma + 1);
  if (/;base64/i.test(dataURL.slice(0, comma))) {
    const padding = (payload.match(/=+$/) || [""])[0].length;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return payload.length;
  }
}

/** Save a generated image into the User Files library under a clear category + descriptive name. */
export function generatedFileEntry(category, kind, name, img) {
  // mock renders are SVG, real ones PNG — label the file with what it actually is
  const mime = img.mime || (String(img.dataURL).startsWith("data:image/svg") ? "image/svg+xml" : "image/png");
  const ext = mime === "image/svg+xml" ? "svg" : "png";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || kind;
  return {
    id: uid(),
    category,
    fileName: `generated-${kind}-${slug}.${ext}`,
    fileType: mime,
    size: dataURLSize(img.dataURL),
    dataURL: img.dataURL,
    prompt: img.prompt,
    model: img.model,
    createdAt: Date.now(),
  };
}
