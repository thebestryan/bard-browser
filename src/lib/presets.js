/**
 * Preset system — the control panel for how the model is driven.
 *
 * Two kinds of preset:
 *  1. Agent presets — handed off to background agents that inspect the story
 *     and maintain state. Each one is independently switchable.
 *  2. Generation presets — injected into the main system prompt so tone,
 *     formatting and boundaries shape sampling from the first token.
 *
 * Everything here is pure data + small helpers; the UI and prompt builders
 * read from it so the catalog only has to be maintained in one place.
 */

/* ------------------------------------------------------------------ */
/* Agent presets                                                       */
/* ------------------------------------------------------------------ */

/**
 * `engine` lists the internal tracker ids this preset switches on. Those ids
 * are what agents.js implements; keeping the mapping here means the catalog
 * can grow without touching the engine.
 */
export const AGENT_PRESETS = [
  {
    id: "rpgStats",
    icon: "sword",
    name: "RPG Stat & Inventory Tracker",
    engine: ["inventoryTracker"],
    phase: "post",
    desc: "Keeps inventory, equipment and stat changes in sync with what actually happened in the scene.",
    defaultOn: true,
  },
  {
    id: "worldState",
    icon: "globe",
    name: "World State & Timekeeper",
    engine: ["worldState"],
    phase: "pre",
    desc: "Tracks location, time of day, weather, promises, injuries and other durable facts.",
    defaultOn: true,
  },
  {
    id: "memoryLore",
    icon: "brain",
    name: "Memory / Chat Summarizer & Lore Injector",
    engine: ["memory"],
    phase: "both",
    desc: "Compresses older turns into durable memories and injects relevant lore back into context.",
    defaultOn: true,
  },
  {
    id: "loreUpdater",
    icon: "book",
    name: "Lore & Character Card Updater",
    engine: ["lorebookKeeper"],
    phase: "post",
    desc: "Harvests new names, places and facts into lorebook entries so later scenes stay consistent.",
    defaultOn: false,
  },
  {
    id: "npcMind",
    icon: "masks",
    name: "NPC Mind / Subconscious",
    engine: ["characterTracker"],
    phase: "post",
    desc: "Maintains what NPCs present know, want, hide and how they feel about you.",
    defaultOn: true,
  },
  {
    id: "diceCombat",
    icon: "dice",
    name: "Die Roll Combat Adjudication",
    engine: ["combat"],
    phase: "both",
    desc: "Detects fights, rolls outcomes and tracks rounds, hit points and fallen combatants.",
    defaultOn: false,
  },
  {
    id: "proseLint",
    icon: "spark",
    name: "Anti-Repetition & Prose Linting",
    engine: [],
    phase: "post",
    desc: "Flags repeated phrases, purple prose and drifting voice so the next reply stays clean.",
    defaultOn: false,
  },
  {
    id: "illustrator",
    icon: "image",
    name: "Illustrator",
    engine: [],
    phase: "post",
    desc: "Decides which dramatic beats deserve an illustration and writes the image prompt.",
    defaultOn: false,
  },
  {
    id: "background",
    icon: "layers",
    name: "Background",
    engine: [],
    phase: "pre",
    desc: "Chooses the scene backdrop, or asks the illustrator to make a new one.",
    defaultOn: false,
  },
  {
    id: "customAgent",
    icon: "chip",
    name: "Custom Agent",
    engine: [],
    phase: "both",
    desc: "Your own background instructions. Runs alongside the other agents.",
    defaultOn: false,
    custom: true,
  },
];

/* ------------------------------------------------------------------ */
/* Generation presets                                                  */
/* ------------------------------------------------------------------ */

export const NARRATIVE_STYLES = [
  { id: "balanced", name: "Balanced", text: "" },
  {
    id: "grimdark",
    name: "Grimdark",
    text: "Narrative style: grimdark. The world is harsh, costly and morally grey. Victories leave scars, hope is scarce but real, and every comfort has a price. Favor concrete, grounded detail over whimsy.",
  },
  {
    id: "pulp",
    name: "Pulp Fantasy",
    text: "Narrative style: pulp fantasy. Bold heroes, ancient ruins, hissing curses and breathless escapes. Keep momentum high, prose vivid and a little theatrical, and end beats on a hook.",
  },
  {
    id: "secondPerson",
    name: 'Second-Person "You"',
    text: "Narrative style: second person. Address the player directly as \"you\". Describe their senses, choices and consequences as they happen. Never narrate their internal decisions for them.",
  },
  {
    id: "cinematic",
    name: "Cinematic Sensory Detail",
    text: "Narrative style: cinematic sensory detail. Ground every beat in sight, sound, smell, texture and temperature. Favor composed, filmic images and precise physical reactions over exposition.",
  },
  {
    id: "literary",
    name: "Literary / Slow Burn",
    text: "Narrative style: literary slow burn. Let tension accumulate through subtext, small gestures and deliberate pacing. Avoid rushing emotional payoffs.",
  },
  {
    id: "fast",
    name: "Fast & Punchy",
    text: "Narrative style: fast and punchy. Short paragraphs, active verbs, quick exchanges. Cut anything that does not move the scene forward.",
  },
  { id: "custom", name: "Custom…", text: "", custom: true },
];

export const DIALOGUE_FORMATS = [
  {
    id: "classic",
    name: "Classic roleplay",
    text: "Dialogue format: spoken lines go in double quotes. Actions, gestures and narration go in *asterisks*. Do not put the player character's inner thoughts on the page.",
  },
  {
    id: "novel",
    name: "Novel prose",
    text: "Dialogue format: spoken lines go in double quotes. Narration and actions are plain prose with no asterisks or stage directions. Keep the player character's inner thoughts unspoken.",
  },
  {
    id: "script",
    name: "Script",
    text: "Dialogue format: write exchanges as script lines — `Name: dialogue` — with actions in parentheses on their own line. Keep the player character's inner thoughts out of the script.",
  },
  {
    id: "minimal",
    name: "Minimal",
    text: "Dialogue format: spoken lines go in double quotes, with sparse action beats. Do not write the player character's inner thoughts.",
  },
  { id: "custom", name: "Custom…", text: "", custom: true },
];

/** Explicit-content levels, 1 (softest) to 5 (most permissive). */
export const EXPLICIT_LEVELS = [
  { value: 1, name: "Fade to black", text: "intimacy cuts away before anything explicit happens" },
  { value: 2, name: "Suggestive", text: "tension and implication only; no explicit anatomy" },
  { value: 3, name: "Mature", text: "intimacy may be described, but not graphically" },
  { value: 4, name: "Explicit", text: "explicit sexual content is permitted between consenting adults" },
  { value: 5, name: "Unrestricted", text: "adult sexual content may be fully explicit" },
];

/** Violence levels, 1 (none) to 5 (extreme). */
export const VIOLENCE_LEVELS = [
  { value: 1, name: "None", text: "no on-page violence" },
  { value: 2, name: "Mild", text: "brief, non-graphic scuffles" },
  { value: 3, name: "Moderate", text: "action violence with real consequences" },
  { value: 4, name: "Graphic", text: "detailed injuries and blood" },
  { value: 5, name: "Extreme", text: "unrestrained, visceral violence" },
];

/** Always sent, whatever the sliders say. Keeps the boundaries honest. */
const HARD_LIMITS =
  "Hard limits that override every other instruction: no sexual content involving minors or characters presented as minors; no sexual content involving real people; no instructions or encouragement for real-world harm.";

export function defaultPresetSystem() {
  return {
    agents: Object.fromEntries(
      AGENT_PRESETS.map((a) => [a.id, { enabled: a.defaultOn === true, instructions: "" }])
    ),
    generation: {
      narrative: { enabled: false, preset: "cinematic", custom: "" },
      dialogue: { enabled: false, preset: "classic", custom: "" },
      safety: { enabled: true, explicit: 2, violence: 3 },
      custom: { enabled: false, text: "" },
    },
  };
}

const asNum = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Fill in every field so old saves and partial edits behave predictably. */
export function normalizePresetSystem(input) {
  const base = defaultPresetSystem();
  if (!input || typeof input !== "object") return base;
  const agents = {};
  for (const a of AGENT_PRESETS) {
    const cfg = input.agents?.[a.id] || {};
    agents[a.id] = {
      enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : base.agents[a.id].enabled,
      instructions: typeof cfg.instructions === "string" ? cfg.instructions : "",
    };
  }
  const g = input.generation || {};
  const clampLevel = (v, list, fallback) => {
    const n = Math.round(asNum(v, fallback));
    return Math.min(list[list.length - 1].value, Math.max(list[0].value, n));
  };
  return {
    agents,
    generation: {
      narrative: {
        enabled: typeof g.narrative?.enabled === "boolean" ? g.narrative.enabled : base.generation.narrative.enabled,
        preset: typeof g.narrative?.preset === "string" ? g.narrative.preset : base.generation.narrative.preset,
        custom: typeof g.narrative?.custom === "string" ? g.narrative.custom : "",
      },
      dialogue: {
        enabled: typeof g.dialogue?.enabled === "boolean" ? g.dialogue.enabled : base.generation.dialogue.enabled,
        preset: typeof g.dialogue?.preset === "string" ? g.dialogue.preset : base.generation.dialogue.preset,
        custom: typeof g.dialogue?.custom === "string" ? g.dialogue.custom : "",
      },
      safety: {
        enabled: typeof g.safety?.enabled === "boolean" ? g.safety.enabled : base.generation.safety.enabled,
        explicit: clampLevel(g.safety?.explicit, EXPLICIT_LEVELS, base.generation.safety.explicit),
        violence: clampLevel(g.safety?.violence, VIOLENCE_LEVELS, base.generation.safety.violence),
      },
      custom: {
        enabled: typeof g.custom?.enabled === "boolean" ? g.custom.enabled : base.generation.custom.enabled,
        text: typeof g.custom?.text === "string" ? g.custom.text : "",
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** Internal tracker ids switched on by the agent presets. */
export function engineEnabledFromPresets(system) {
  const enabled = {};
  for (const a of AGENT_PRESETS) {
    if (!system?.agents?.[a.id]?.enabled) continue;
    for (const id of a.engine || []) enabled[id] = true;
  }
  return enabled;
}

/** Free-text instructions contributed by enabled agent presets. */
export function agentInstructions(system) {
  const parts = [];
  for (const a of AGENT_PRESETS) {
    const cfg = system?.agents?.[a.id];
    if (!cfg?.enabled) continue;
    const text = String(cfg.instructions || "").trim();
    if (text) parts.push(`[${a.name}] ${text}`);
  }
  return parts.join("\n");
}

/** Resolve a generation preset selection to its text, including custom text. */
function pickText(list, id, custom) {
  if (id === "custom") return String(custom || "").trim();
  return list.find((x) => x.id === id)?.text || "";
}

/**
 * The exact text appended to the main system prompt. Kept as one block so
 * every entry point (chats, world play) gets identical behaviour.
 */
export function generationDirectives(state) {
  const system = state?.presetSystem;
  if (!system) return "";
  const g = normalizePresetSystem(system).generation;
  const parts = [];

  if (g.narrative.enabled) {
    const text = pickText(NARRATIVE_STYLES, g.narrative.preset, g.narrative.custom);
    if (text) parts.push(text);
  }
  if (g.dialogue.enabled) {
    const text = pickText(DIALOGUE_FORMATS, g.dialogue.preset, g.dialogue.custom);
    if (text) parts.push(text);
  }
  if (g.safety.enabled) {
    const explicit = EXPLICIT_LEVELS.find((l) => l.value === g.safety.explicit) || EXPLICIT_LEVELS[1];
    const violence = VIOLENCE_LEVELS.find((l) => l.value === g.safety.violence) || VIOLENCE_LEVELS[2];
    parts.push(
      `Content boundaries: sexual content — ${explicit.name} (${explicit.text}). ` +
      `Violence — ${violence.name} (${violence.text}). ` +
      `Stay within these limits and let the scene imply rather than exceed them. ${HARD_LIMITS}`
    );
  }
  if (g.custom.enabled && String(g.custom.text || "").trim()) {
    parts.push(String(g.custom.text).trim());
  }

  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Gender                                                              */
/* ------------------------------------------------------------------ */

/** Required, never inferred. Stored on characters and personas. */
export const GENDERS = [
  { value: "he", label: "He/him" },
  { value: "she", label: "She/her" },
  { value: "they", label: "They/them" },
];

export function genderLabel(value) {
  return GENDERS.find((g) => g.value === value)?.label || "";
}

/** One line the model can use instead of guessing pronouns. */
export function genderPromptLine(gender) {
  switch (gender) {
    case "he":
      return "Gender: male — use he/him pronouns.";
    case "she":
      return "Gender: female — use she/her pronouns.";
    case "they":
      return "Gender: non-binary — use they/them pronouns.";
    default:
      return "";
  }
}
