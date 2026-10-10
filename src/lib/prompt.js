/**
 * Prompt assembly — ordered, toggleable preset sections (SillyTavern-style).
 *
 * A preset is a list of sections; each maps a role (system, lore, memory…)
 * to a position in the prompt and can be switched off. Sections may also
 * carry literal `content` (imported ST prompt bodies or user text) which is
 * sent as-is, with {{macros}} substituted.
 *
 * Guarantees:
 *  - disabled sections are dropped, and never resurrected by the fallback
 *  - empty blocks never leave blank gaps
 *  - a preset with its own literal text is authoritative: app blocks are not
 *    appended on top of it — EXCEPT the identity block ("You are <char>"),
 *    which is always guaranteed exactly once.
 * The engine: assemblePrompt(blocks, preset) — the AI never reorders content.
 */

/** Role that carries literal `content` instead of pulling app state. */
export const ROLE_NONE = "none";

/** Known roles, in the default order used when no preset is linked. */
export const SECTION_ROLES = [
  "system",
  "context",
  "character",
  "scenario",
  "lore",
  "memory",
  "persona",
  "instructions",
];

export const ROLE_LABEL = {
  none: "Own text",
  system: "System rules",
  context: "World state",
  character: "Character card",
  scenario: "Scenario",
  lore: "Lorebook",
  memory: "Memory",
  persona: "Persona",
  instructions: "Style instructions",
};

export const ROLE_DESCRIPTION = {
  system: "Who the model is playing and how it behaves.",
  context: "World, scene mechanics and moment-to-moment state.",
  character: "Appearance, scenario and the other characters present.",
  scenario: "The story setup this chat was started from.",
  lore: "Lorebook entries whose trigger keys matched the latest message.",
  memory: "Durable story memories recalled by relevance.",
  persona: "Who the user is in the story.",
  instructions: "Style direction from the preset and connection profile.",
};

/** The default, enabled sections for a new preset. */
export const DEFAULT_SECTIONS = SECTION_ROLES.map((role, i) => ({
  name: ROLE_LABEL[role],
  role,
  enabled: true,
  order: i,
}));

export function newSection() {
  return { name: "", role: "system", enabled: true, content: "", order: 0 };
}

export const uidLocal = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** Renumber sections sequentially — duplicate/gap orders are what makes presets read jumbled. */
export function normalizePreset(p) {
  const sections = (p?.sections || []).map((s, i) => ({
    id: s.id || uidLocal(),
    name: s.name || ROLE_LABEL[s.role] || `Section ${i + 1}`,
    role: s.role || "system",
    enabled: s.enabled !== false,
    content: s.content ?? "",
    order: i,
  }));
  return { ...p, sections };
}

/** Roles the preset never mentions (even a disabled section counts as placed). */
export function unplacedRoles(preset) {
  const mentioned = new Set((preset?.sections || []).map((s) => s.role));
  return SECTION_ROLES.filter((r) => !mentioned.has(r));
}

/** The preset linked to a connection profile, or null. */
export function activePreset(state, profile) {
  if (!profile?.presetId) return null;
  return (state?.presets || []).find((p) => p.id === profile.presetId) || null;
}

const IDENTITY_FALLBACK = { char: "the character", user: "the user" };
const MACRO_KEYS = ["char", "user", "persona", "description", "personality", "scenario", "scene", "world"];

/** {{macro}} substitution. {{ Char }} / {{USER}} tolerated; unknown macros are left alone. */
export function substituteMacros(text, opts = {}) {
  return String(text ?? "").replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (whole, rawKey) => {
    const key = rawKey.toLowerCase();
    if (!MACRO_KEYS.includes(key)) return whole; // unknown macros stay verbatim
    let v = opts[key];
    if ((key === "scene" || key === "world") && isEmpty(v)) v = opts.scenario; // aliases
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
    return IDENTITY_FALLBACK[key] ?? whole; // identity macros never collapse to nothing
  });
}

const isEmpty = (v) => v === null || v === undefined || !String(v).trim();

/**
 * Assemble the system prompt.
 *  - blocks: { role: "content string" } — what the app can provide
 *  - preset: the linked preset (or null → default order, everything enabled)
 *  - opts:   macro values for literal sections (char, user, persona…)
 */
export function assemblePrompt(blocks, preset, opts = {}) {
  const get = (role) => {
    const raw = blocks?.[role];
    return isEmpty(raw) ? null : String(raw).trim();
  };

  // No linked preset: plain default order, nothing dropped.
  if (!preset?.sections?.length) {
    return SECTION_ROLES
      .map((role) => get(role))
      .filter((v) => !isEmpty(v))
      .join("\n")
      .trim();
  }

  const charName = String(opts.char || "").trim();
  const parts = [];
  let systemPlaced = false;  // blocks.system is already in the prompt
  let identityCovered = false; // a literal section already introduces the character
  let hasLiteral = false;

  const sections = preset.sections
    .map((s, i) => ({ ...s, _ord: Number.isFinite(s.order) ? s.order : i }))
    .sort((a, b) => a._ord - b._ord);

  for (const s of sections) {
    if (s.enabled === false) continue;
    const literal = typeof s.content === "string" && s.content.trim() !== "";
    if (literal) {
      hasLiteral = true;
      const value = substituteMacros(s.content, opts).trim();
      if (/\{\{\s*char\b/i.test(s.content) || (charName && value.includes(charName))) {
        identityCovered = true;
      }
      if (!isEmpty(value)) parts.push(value);
    } else if (s.role === ROLE_NONE) {
      continue; // an empty own-text section contributes nothing
    } else {
      const value = get(s.role);
      if (!isEmpty(value)) {
        parts.push(value);
        if (s.role === "system") systemPlaced = true;
      }
    }
  }

  // Fallback: app blocks the preset never placed, appended in default order.
  // A preset carrying its own literal text is authoritative — only the
  // guaranteed identity block is added on top (see below).
  const mentioned = new Set(sections.map((s) => s.role));
  const appendUnplaced = !preset?.sections?.length
    ? true
    : hasLiteral
      ? preset.appendUnplaced === true
      : preset.appendUnplaced !== false;
  if (appendUnplaced) {
    for (const role of SECTION_ROLES) {
      if (role === "system" || mentioned.has(role)) continue;
      const value = get(role);
      if (!isEmpty(value)) parts.push(value);
    }
  }

  // Identity guarantee: the model must always know who it is playing —
  // exactly once, even if a preset is full of its own prompts.
  if (!identityCovered && !systemPlaced) {
    const sys = get("system");
    if (!isEmpty(sys)) parts.push(sys);
  }

  return parts.join("\n").trim();
}

/** Example content per role, from whatever exists in state — for the editor preview. */
export function previewBlocks(state = {}) {
  const char = state.characters?.[0];
  const persona = state.personas?.[0];
  const world = state.worlds?.[0];
  const loreEntry = state.lorebooks?.[0]?.entries?.[0];
  const memory = state.chats?.[0]?.memories?.[0];
  return {
    system: `You are ${char?.name || "Example Character"}. ${char?.personality || "A brief personality summary would sit here."}`,
    context: world
      ? `World: ${world.name} — ${world.description || "world description"}`
      : "World state, scene mechanics and current location would sit here.",
    character: [
      char?.appearance ? `Appearance: ${char.appearance}` : "",
      char?.scenario ? `Scenario: ${char.scenario}` : "",
    ].filter(Boolean).join("\n") || "Appearance, scenario and present company would sit here.",
    scenario: "The story setup this chat was started from.",
    lore: loreEntry
      ? `Lore matched by trigger keys: ${loreEntry.content}`
      : "Lorebook entries whose keys matched the latest message.",
    memory: memory ? `Durable memories: ${memory.text}` : "Recalled story memories.",
    persona: `You speak with ${persona?.name || "the user"} (${persona?.description || "persona description"}).`,
    instructions: "Style direction from the preset and connection profile.",
  };
}

/** Who is currently using this preset (connection profiles). */
export function profilesUsingPreset(state, presetId) {
  return (state?.profiles || []).filter((p) => p.presetId === presetId);
}

/**
 * [[OOC]] extraction — anything in double brackets is an out-of-character
 * instruction for the model, not story text. Returns the cleaned story text
 * plus the joined OOC instructions.
 */
export function extractOOC(text) {
  const ooc = [];
  const clean = String(text || "")
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, inner) => {
      if (inner.trim()) ooc.push(inner.trim());
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean, ooc: ooc.join(" | ") };
}

/** Insert a system instruction `depth` messages from the end of the payload (SillyTavern depth). */
export function insertAtDepth(payload, content, depth = 4) {
  if (!content || !String(content).trim()) return payload;
  const maxDepth = Math.max(0, payload.length - 1);
  const d = Math.max(0, Math.min(Number.isFinite(depth) ? depth : 4, maxDepth));
  return [
    ...payload.slice(0, payload.length - d),
    { role: "system", content: String(content).trim() },
    ...payload.slice(payload.length - d),
  ];
}
