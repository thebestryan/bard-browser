import { uid } from "./id.js";

/**
 * SillyTavern-compatible import/export.
 *
 * Exports (what this app SAVES) target SillyTavern formats:
 *  - Characters: chara_card_v2 JSON and PNG cards with an embedded "chara" tEXt chunk
 *  - Chats: SillyTavern JSONL (one message object per line)
 *  - Presets: SillyTavern chat-completion preset JSON
 * Imports accept those same formats, plus best-effort parsing of
 * Marinara Engine and Horde Studio files (any JSON with recognizable fields).
 */

/* ================= character card (V2) ================= */

/**
 * Cards occasionally carry an explicit gender field. Only an explicit value
 * counts — names and descriptions are never used to infer one.
 */
const GENDER_MAP = {
  male: "he", m: "he", man: "he", he: "he", "he/him": "he",
  female: "she", f: "she", woman: "she", she: "she", "she/her": "she",
  "non-binary": "they", nonbinary: "they", enby: "they", they: "they", "they/them": "they",
};
function normalizeGender(v) {
  return GENDER_MAP[String(v || "").toLowerCase().trim()] || "";
}

export function toSTCard(c) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: c.name || "",
      gender: c.gender || "",
      description: [c.appearance, c.personality].filter(Boolean).join("\n\n"),
      personality: c.personality || "",
      scenario: c.scenario || "",
      first_mes: c.greeting || "",
      mes_example: (c.examples || []).map((e) => `<START>\n{{user}}: ${e}`).join("\n"),
      creator_notes: "Exported from Bard Browser",
      system_prompt: c.systemPrompt || "",
      post_history_instructions: c.postHistoryInstructions || "",
      alternate_greetings: c.alternateGreetings || [],
      character_book: c.characterBook || null,
      tags: c.tags || [],
      creator: "",
      character_version: "",
      extensions: {},
    },
  };
}

export function fromSTCard(obj) {
  // Accept ST V2/V1 cards plus best-effort Marinara/Horde JSON characters.
  const d = obj?.data || obj; // V2 nests under data; V1 is flat
  const name = d?.name || d?.character?.name || obj?.name || "Imported Character";
  const description = d?.description || d?.bio || d?.description_plain || "";
  const personality = d?.personality || d?.personality_summary || "";
  const appearance =
    description && description !== personality ? description : "";
  return {
    id: uid(),
    name,
    gender: normalizeGender(d?.gender || d?.sex),
    tags: d?.tags || [],
    appearance,
    personality,
    scenario: d?.scenario || d?.greeting_scene || "",
    greeting: d?.first_mes || d?.greeting || d?.alternate_greetings?.[0] || "",
    examples: splitExamples(d?.mes_example),
    // keep fields the app has no editor for, so a round-trip doesn't lose them
    alternateGreetings: d?.alternate_greetings || [],
    systemPrompt: d?.system_prompt || "",
    postHistoryInstructions: d?.post_history_instructions || "",
    characterBook: d?.character_book || null,
    createdAt: Date.now(),
  };
}

function splitExamples(mesExample) {
  if (!mesExample) return [];
  return String(mesExample)
    .split("<START>")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\{\{user\}\}:?\s*/i, "").split(/\n\{\{char\}\}/)[0].trim())
    .filter(Boolean);
}

/* ================= PNG card embedding (tEXt chunk) ================= */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function unb64utf8(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Build a ST-compatible PNG character card. `imgDataUrl` optional (portrait). */
export async function exportPngCard(character) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  let drawn = false;
  // any raster/SVG data URL draws fine; uploads are stored as JPEG
  if (character.portrait?.dataURL?.startsWith("data:image/")) {
    try {
      const img = await loadImg(character.portrait.dataURL);
      // centre-crop to a square instead of stretching a non-square photo
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const side = Math.min(w, h);
      if (side > 0) ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
      else ctx.drawImage(img, 0, 0, size, size);
      drawn = true;
    } catch { /* fall through */ }
  }
  if (!drawn) {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "#7c5cff");
    g.addColorStop(1, "#4fc3f7");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // initials, not an emoji — a card without a portrait gets a typographic mark
    const initials = String(character.name || "?")
      .split(/\s+/).map((w) => [...w][0]).filter((c) => c && /\p{L}|\p{N}/u.test(c))
      .slice(0, 2).join("").toUpperCase() || "?";
    ctx.fillStyle = "#0d0f17";
    ctx.font = "bold 200px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, size / 2, size / 2 + 8);
  }
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const png = new Uint8Array(await blob.arrayBuffer());

  const card = toSTCard(character);
  const textData = b64utf8(JSON.stringify(card));
  const keyword = new TextEncoder().encode("chara\0");
  const textChunk = chunk("tEXt", new Uint8Array([...keyword, ...new TextEncoder().encode(textData)]));

  // insert before IEND (IEND is always the final 12-byte chunk: len=0 + "IEND" + CRC)
  const iend = png.length - 12;
  const dvEnd = new DataView(png.buffer, png.byteOffset + iend, 8);
  if (dvEnd.getUint32(0) !== 0 || String.fromCharCode(png[iend + 4], png[iend + 5], png[iend + 6], png[iend + 7]) !== "IEND")
    throw new Error("Invalid PNG structure.");
  const out = new Uint8Array(png.length + textChunk.length);
  out.set(png.subarray(0, iend), 0);
  out.set(textChunk, iend);
  out.set(png.subarray(iend), iend + textChunk.length);
  return new Blob([out], { type: "image/png" });
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** Extract a character card from a ST PNG (or JSON), or best-effort from Marinara/Horde JSON. */
export async function importCharacterFile(file) {
  if (file.name.toLowerCase().endsWith(".png") || file.type === "image/png") {
    const buf = new Uint8Array(await file.arrayBuffer());
    let i = 8; // skip PNG signature
    let card = null;
    while (i < buf.length - 8) {
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 8);
      const len = dv.getUint32(0);
      const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
      if (type === "tEXt") {
        const data = buf.subarray(i + 8, i + 8 + len);
        const nul = data.indexOf(0);
        const keyword = new TextDecoder().decode(data.subarray(0, nul));
        if (keyword === "chara" || keyword === "ccv3") {
          try {
            card = unb64utf8(new TextDecoder().decode(data.subarray(nul + 1)));
          } catch { /* try next chunk */ }
        }
      }
      if (type === "IEND") break;
      i += 12 + len;
    }
    if (!card) throw new Error("No character card data found in this PNG.");
    return fromSTCard(card);
  }
  const json = JSON.parse(await file.text());
  return fromSTCard(json);
}

/* ================= chat JSONL (ST format) ================= */

export function toSTChatJSONL(chat, characterName, personaName) {
  // SillyTavern chat files open with a metadata line before the messages
  const header = {
    user_name: personaName || "User",
    character_name: characterName || "Character",
    create_date: new Date(chat.createdAt || Date.now()).toISOString(),
    chat_metadata: {},
  };
  const lines = (chat.messages || []).map((m) => ({
    name: m.role === "user" ? personaName || "User" : characterName || "Character",
    is_user: m.role === "user",
    is_system: false,
    send_date: Date.now(),
    mes: m.text || "",
    swipe_id: m.swipeIdx ?? 0,
    swipes: m.swipes?.length ? m.swipes : undefined,
  }));
  return [header, ...lines].map((l) => JSON.stringify(l)).join("\n");
}

export function toPlainTextChat(messages, characterName, personaName) {
  return (messages || [])
    .map((m) => `[${m.role === "user" ? personaName || "User" : characterName || "Character"}]\n${m.text}`)
    .join("\n\n");
}

const asMessage = (o) => {
  const body = o.mes ?? o.message ?? o.text ?? o.content ?? "";
  if (!body) return null;
  const role = o.is_user || o.role === "user" ? "user" : o.is_system || o.role === "system" ? "system" : "assistant";
  return {
    id: uid(),
    role,
    text: String(body),
    ...(Array.isArray(o.swipes) && o.swipes.length ? { swipes: o.swipes, swipeIdx: o.swipe_id ?? 0 } : {}),
  };
};

/** Import an ST JSONL chat (or best-effort Marinara/Horde message arrays). */
export async function importChatFile(file) {
  const text = await file.text();
  const msgs = [];

  // A whole-file JSON document (object or array) is NOT JSONL — parse it as
  // one value first. Only fall back to line-by-line when that fails.
  try {
    const doc = JSON.parse(text);
    const arr = Array.isArray(doc) ? doc : doc.messages || doc.chat || doc.history || [];
    for (const m of arr) {
      const msg = asMessage(m || {});
      if (msg) msgs.push(msg);
    }
  } catch {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        if (o.user_name || o.character_name || o.create_date) continue; // ST header line
        const msg = asMessage(o);
        if (msg) msgs.push(msg);
      } catch { /* skip malformed lines */ }
    }
  }

  if (!msgs.length) throw new Error("No messages found in this file.");
  return msgs;
}

/* ================= presets (ST chat-completion format) ================= */

export function toSTPreset(p) {
  return {
    chat_completion_source: "openai",
    temperature: p.temperature ?? 0.8,
    top_p: p.topP ?? 1,
    openai_max_tokens: p.maxTokens ?? 1024,
    name: p.name,
    prompts: (p.sections || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        identifier: s.name,
        name: s.name,
        system_prompt: s.role === "system",
        role: "system",
        content: s.content || "",
        enabled: s.enabled !== false,
        marker: !s.content, // no literal text => the app fills this section
        extensions: { myrpg_role: s.role },
      })),
    prompt_order: (p.sections || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s, i) => ({ character_id: 100000 + i, identifier: s.name, enabled: s.enabled !== false })),
    // our own section kinds, so a round-trip through this app is lossless
    myrpg_sections: (p.sections || []).slice().sort((a, b) => a.order - b.order),
    myrpg_appendUnplaced: p.appendUnplaced !== false,
    extensions: { myrpg_style: p.style || "" },
  };
}

/** "Cinematic-preset.json" -> "Cinematic". ST presets rarely carry a name
 *  inside the file — the filename IS the preset's name. */
export function presetNameFromFile(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")        // drop the extension
    .replace(/[-_ ]?preset$/i, "") // drop the suffix our own export adds
    .replace(/[_]+/g, " ")
    .trim();
}

/**
 * SillyTavern "marker" prompts are placeholders the app fills in; map them to
 * the role that supplies the same material here. Everything else is a literal
 * prompt whose text lives in `content`.
 *
 * NOTE: ST's `role` field is the *message* role (system/user/assistant), not a
 * section kind — using it made every imported section come out as "system".
 */
const ST_MARKER_ROLE = {
  charDescription: "character",
  charPersonality: "character",
  dialogueExamples: "character",
  scenario: "scenario",
  personaDescription: "persona",
  worldInfoBefore: "lore",
  worldInfoAfter: "lore",
  chatHistory: "history",
};

export function fromSTPreset(obj, fileName) {
  // a preset exported by this app round-trips exactly
  if (Array.isArray(obj.myrpg_sections) && obj.myrpg_sections.length) {
    return {
      id: uid(),
      name: presetNameFromFile(fileName) || obj.name || "Imported Preset",
      sections: obj.myrpg_sections.map((s, i) => ({ ...s, order: i })),
      temperature: obj.temperature ?? 0.8,
      maxTokens: obj.openai_max_tokens ?? obj.max_tokens ?? 1024,
      topP: obj.top_p ?? obj.topP ?? 1,
      style: obj.extensions?.myrpg_style || obj.style || "",
      appendUnplaced: obj.myrpg_appendUnplaced ?? true,
      createdAt: Date.now(),
    };
  }

  const prompts = Array.isArray(obj.prompts) ? obj.prompts : [];

  // ST keeps order + enabled in prompt_order[].order[], not on prompts[]
  const orderList = (Array.isArray(obj.prompt_order) ? obj.prompt_order : [])
    .map((o) => (Array.isArray(o?.order) ? o.order : Array.isArray(o) ? o : null))
    .find(Boolean) || (Array.isArray(obj.prompt_order) ? obj.prompt_order : []);
  const orderIndex = new Map();
  const enabledById = new Map();
  orderList.forEach((o, i) => {
    const id = o?.identifier ?? o?.name;
    if (id == null) return;
    orderIndex.set(id, i);
    if (typeof o?.enabled === "boolean") enabledById.set(id, o.enabled);
  });

  const source = prompts.length ? prompts : orderList;
  const sections = source.map((s, i) => {
    const id = s.identifier ?? s.name;
    const marker = s.marker === true || (!s.content && ST_MARKER_ROLE[id]);
    const empty = !marker && !String(s.content || "").trim();
    return {
      name: s.name || s.identifier || `Section ${i + 1}`,
      // an ST prompt with no content and no marker is a placeholder that
      // contributes nothing — don't make it show some unrelated app block
      role: empty ? "none" : marker ? ST_MARKER_ROLE[id] || "context" : "system",
      // literal prompt text — previously discarded, which emptied the section
      content: marker ? "" : String(s.content || ""),
      enabled: enabledById.has(id) ? enabledById.get(id) : s.enabled !== false,
      order: orderIndex.has(id) ? orderIndex.get(id) : orderIndex.size + i,
    };
  })
    .filter((s) => s.role !== "history") // chat history isn't part of the system prompt
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }));
  return {
    id: uid(),
    name: presetNameFromFile(fileName) || obj.name || "Imported Preset",
    sections,
    temperature: obj.temperature ?? 0.8,
    maxTokens: obj.openai_max_tokens ?? obj.max_tokens ?? 1024,
    topP: obj.top_p ?? obj.topP ?? 1,
    style: obj.extensions?.myrpg_style || obj.style || "",
    // a preset that ships its own prompt text is authoritative — don't append
    // our generated blocks on top of what the author already wrote
    appendUnplaced: !sections.some((s) => String(s.content || "").trim()),
    createdAt: Date.now(),
  };
}

/* ================= worlds (best-effort Marinara/Horde + our JSON) ================= */

export function fromWorldJSON(obj) {
  const o = obj?.data || obj;
  return {
    id: uid(),
    name: o.name || o.title || "Imported World",
    genre: o.genre || o.setting || "Imported",
    tagline: o.tagline || o.summary || "",
    description: o.description || o.overview || o.lore || "",
    locations: (o.locations || o.places || o.areas || []).map((l) => ({
      name: l.name || l.title || "?",
      type: l.type || "landmark",
      description: l.description || l.desc || "",
      mood: l.mood || l.atmosphere || "",
    })),
    npcs: (o.npcs || o.characters || o.people || []).map((n) => ({
      name: n.name || "?",
      role: n.role || n.occupation || "",
      location: n.location || n.current_location || "",
      personality: n.personality || n.traits || "",
      goal: n.goal || n.goals || n.agenda || "",
      secret: n.secret || n.secrets || "",
      schedule: n.schedule || n.routine || "",
    })),
    factions: (o.factions || o.organizations || o.groups || []).map((f) => ({
      name: f.name || "?",
      attitude: (f.attitude || f.relation || "neutral").toLowerCase(),
      description: f.description || "",
    })),
    items: (o.items || o.inventory || o.objects || []).map((it) => ({
      name: it.name || "?",
      type: it.type || "custom",
      description: it.description || "",
    })),
    quests: (o.quests || o.story_threads || o.threads || []).map((q) => ({
      title: q.title || q.name || "?",
      description: q.description || "",
      status: (q.status || "open").toLowerCase(),
    })),
    startLocation: o.startLocation || o.start_location || (o.locations?.[0]?.name ?? ""),
    timeOfDay: o.timeOfDay || o.time_of_day || "morning",
    weather: o.weather || "clear",
    createdAt: Date.now(),
  };
}

/* ================= download helper ================= */

export function downloadBlob(blob, fileName) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function downloadJSON(obj, fileName) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), fileName);
}
