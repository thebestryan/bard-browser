import { callJSON } from "./ai.js";
import { uid } from "./id.js";
import { activePreset } from "./prompt.js";
import { engineEnabledFromPresets, agentInstructions } from "./presets.js";
import { checkStat, emptyMechanics, roll } from "./mechanics.js";

/**
 * Three-phase generation pipeline.
 *
 *  PRE-GEN   fast routing/decision agents: pick lore, parse world-state updates,
 *            decide whether a check is needed and roll the dice deterministically.
 *  GENERATION the main model gets a lean prompt: persona, tone preset and the
 *            structured state blocks produced above — no agent chatter.
 *  POST-GEN  extraction agents update character sheets, inventory JSON and UI
 *            widgets in the background, after the reply is committed.
 *
 * Deterministic state wins: tracker output is stored as JSON (`agentState`) and
 * rendered into the prompt from that state, never pasted back as free text.
 */

export const WORLD_TIMES = ["dawn", "morning", "midday", "afternoon", "evening", "night"];
export const WEATHERS = ["clear", "cloudy", "rain", "storm", "snow", "fog"];

/* ------------------------------------------------------------------ */
/* State rendering                                                     */
/* ------------------------------------------------------------------ */

/**
 * The authoritative state block injected into the prompt. Everything here
 * comes from saved JSON so the model can never quietly rewrite it.
 */
export function stateBlocks(agentState) {
  if (!agentState) return "";
  const lines = [];

  const w = agentState.world;
  if (w && (w.location || w.time || w.weather)) {
    lines.push(
      `World state: ${[
        w.location ? `location=${w.location}` : "",
        w.time ? `time=${w.time}` : "",
        w.weather ? `weather=${w.weather}` : "",
      ].filter(Boolean).join(", ")}`
    );
  }

  if (agentState.facts?.length) {
    lines.push(`Established facts:\n${agentState.facts.slice(-12).map((f) => `- ${f.text || f}`).join("\n")}`);
  }
  if (agentState.inventory?.length) {
    lines.push(
      `Inventory: ${agentState.inventory
        .map((i) => `${i.name}${i.count > 1 ? ` ×${i.count}` : ""}`)
        .join(", ")}`
    );
  }
  if (agentState.npcStatus?.length) {
    lines.push(
      `NPCs: ${agentState.npcStatus
        .map((n) => `${n.name}${n.status ? ` (${n.status}${n.relation ? `, ${n.relation}` : ""})` : ""}`)
        .join("; ")}`
    );
  }
  if (agentState.quests?.length) {
    lines.push(
      `Quests: ${agentState.quests
        .filter((q) => q.status !== "done")
        .map((q) => `${q.title} [${q.status}]`)
        .join("; ")}`
    );
  }
  if (agentState.combat?.combatants?.length) {
    lines.push(
      `Combat round ${agentState.combat.round}: ${agentState.combat.combatants
        .map((c) => `${c.name} ${c.hp}/${c.maxHp ?? 100} HP`)
        .join(", ")}`
    );
  }
  if (agentState.lastRoll) {
    const r = agentState.lastRoll;
    lines.push(
      `Last check (authoritative): ${r.stat} d20=${r.d20}${r.mod >= 0 ? "+" : ""}${r.mod} ` +
      `vs DC ${r.dc} → ${r.success ? "success" : "failure"}${r.crit ? " (critical)" : r.fumble ? " (fumble)" : ""}. ` +
      `Narrate this outcome; do not reroll or contradict it.`
    );
  }

  return lines.length ? `[STATE — deterministic, do not contradict]\n${lines.join("\n")}` : "";
}

/* ------------------------------------------------------------------ */
/* Lore routing                                                        */
/* ------------------------------------------------------------------ */

/** Keyword-scored lore entries for the current turn (fast, deterministic). */
export function selectLore(state, query) {
  const q = String(query || "").toLowerCase();
  if (!q.trim()) return [];
  const scored = [];
  for (const b of state?.lorebooks || []) {
    for (const e of b.entries || []) {
      let score = 0;
      for (const k of e.keys || []) {
        const key = String(k || "").trim().toLowerCase();
        if (key && q.includes(key)) score += key.length > 4 ? 2 : 1;
      }
      if (score > 0) scored.push({ score, content: e.content, book: b.name });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.content)
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Pre-gen                                                             */
/* ------------------------------------------------------------------ */

const COMBAT_INTENT = /\b(?:attack|strike|swing|shoot|stab|slash|punch|kick|charge|cast|dodge|parry|block|flee|fight)\b/i;
const ACTION_INTENT = /\b(?:try|attempt|check|climb|jump|sneak|persuade|intimidate|search|pick|lock|lift|force|track|listen|investigate)\b/i;

function mockWorldUpdates(text) {
  const updates = {};
  const move = text.match(/\b(?:go|walk|head|travel|move|ride|run)\s+(?:to|into|toward|towards|through)?\s+(?:the\s+)?([A-Za-z][\w\s'-]{2,40})/i);
  if (move) updates.location = move[1].trim().replace(/[.,!?]+$/, "");
  if (/\b(?:morning|dawn)\b/i.test(text)) updates.time = "morning";
  else if (/\b(?:noon|midday)\b/i.test(text)) updates.time = "midday";
  else if (/\b(?:afternoon)\b/i.test(text)) updates.time = "afternoon";
  else if (/\b(?:evening|dusk)\b/i.test(text)) updates.time = "evening";
  else if (/\b(?:night|midnight)\b/i.test(text)) updates.time = "night";
  if (/\b(?:rain|raining)\b/i.test(text)) updates.weather = "rain";
  else if (/\b(?:storm|thunder)\b/i.test(text)) updates.weather = "storm";
  else if (/\b(?:snow|snowing)\b/i.test(text)) updates.weather = "snow";
  else if (/\b(?:fog|mist)\b/i.test(text)) updates.weather = "fog";
  else if (/\b(?:clear|sunny)\b/i.test(text)) updates.weather = "clear";
  return updates;
}

/**
 * Run the routing pass. Returns the prompt blocks plus a structured update
 * that the caller merges into app state BEFORE generation.
 *
 * Deterministic pieces (lore selection, dice) never need an LLM. The world
 * parser uses a small JSON call only when a real profile is available.
 */
export async function runPreGen({
  profile,
  state,
  chat,
  character,
  persona,
  world,
  userText,
  agentState,
  presetSystem,
  signal,
}) {
  const enabled = { ...engineEnabledFromPresets(presetSystem), ...(agentState?.enabled || {}) };
  const updates = {};
  let loreText = "";
  let dice = null;

  /* Lore routing — on when either memory/lore injection or the lore updater is on. */
  if (enabled.lorebookKeeper || enabled.memory) {
    const entries = selectLore(state, userText);
    if (entries.length) loreText = `Lore:\n${entries.join("\n")}`;
  }

  /* World-state parsing — structured, saved to agentState.world. */
  if (enabled.worldState) {
    if (profile?.isMock) {
      const w = mockWorldUpdates(userText);
      if (Object.keys(w).length) updates.world = w;
    } else {
      try {
        const data = await callJSON(
          profile,
          `You are a fast pre-generation router for a text RPG. Read the player's latest action and the current state, then report only what changed. ` +
          `Return JSON: {"location":string|null,"time":"dawn|morning|midday|afternoon|evening|night"|null,"weather":"clear|cloudy|rain|storm|snow|fog"|null,"facts":[string],"npcNotes":[{"name":string,"status":string}],"intent":"explore|social|travel|combat|check|other","check":{"stat":"might|agility|wits|presence|luck|heart","dc":number}|null}. ` +
          `Do not invent changes that are not supported by the action. ` + agentInstructions(presetSystem),
          `Character: ${character?.name || "the character"}. Player: ${persona?.name || "the player"}. ` +
          `${world ? `World: ${world.name}.` : ""}\n` +
          `Current state: ${JSON.stringify({ world: agentState?.world || null, facts: (agentState?.facts || []).slice(-8).map((f) => f.text || f) })}\n` +
          `Latest action: ${userText}`,
          { signal, temperature: 0.1, maxTokens: 320 }
        );
        const w = {};
        if (typeof data.location === "string" && data.location.trim()) w.location = data.location.trim();
        if (WORLD_TIMES.includes(data.time)) w.time = data.time;
        if (WEATHERS.includes(data.weather)) w.weather = data.weather;
        if (Object.keys(w).length) updates.world = w;
        if (Array.isArray(data.facts)) {
          updates.facts = data.facts
            .filter((f) => typeof f === "string" && f.trim())
            .slice(0, 4)
            .map((text) => ({ id: uid(), text: text.trim() }));
        }
        if (Array.isArray(data.npcNotes)) {
          updates.npcStatus = data.npcNotes
            .filter((n) => n?.name)
            .slice(0, 4)
            .map((n) => ({ name: String(n.name), status: String(n.status || "present") }));
        }
        updates._intent = data.intent;
        updates._check = data.check;
      } catch {
        // a failed router must never block generation — fall back to heuristics
        const w = mockWorldUpdates(userText);
        if (Object.keys(w).length) updates.world = w;
      }
    }
  }

  /* Dice / DC adjudication — deterministic and saved as state. */
  if (enabled.combat) {
    const wantsCombat = COMBAT_INTENT.test(userText);
    const wantsCheck = ACTION_INTENT.test(userText);
    if (wantsCombat || wantsCheck || updates._check) {
      const stat = updates._check?.stat || (wantsCombat ? "might" : "wits");
      const dc = Number.isFinite(updates._check?.dc) ? updates._check.dc : wantsCombat ? 12 : 11;
      const mechanics = chat?.mechanics || world?.mechanics || emptyMechanics("off");
      const hero = mechanics.party?.[0];
      let result;
      if (hero) {
        result = checkStat(hero, stat, dc);
      } else {
        const d20 = roll(20);
        result = {
          stat, d20, mod: 0, dc, total: d20,
          success: d20 >= dc, crit: d20 === 20, fumble: d20 === 1,
        };
      }
      updates.lastRoll = result;
      dice = result;
    }
  }

  /*
   * Background routing (pre-gen): reuse an existing asset when there is one.
   * If none exists, post-gen asks the illustrator to make one.
   */
  if (presetSystem?.agents?.background?.enabled) {
    if (!chat?.background?.dataURL && world?.background?.dataURL) {
      updates.background = world.background;
    }
  }

  // internal routing hints are not part of the saved state
  delete updates._intent;
  delete updates._check;

  return { updates, loreText, dice };
}

/** Merge pre-gen output into agent state (pure). */
export function applyPreGenUpdates(agentState, pre) {
  const next = { ...(agentState || {}) };
  const u = pre?.updates || {};
  if (u.world) next.world = { ...(next.world || {}), ...u.world };
  if (u.facts?.length) {
    const existing = new Set((next.facts || []).map((f) => (f.text || f).toLowerCase()));
    next.facts = [
      ...(next.facts || []),
      ...u.facts.filter((f) => !existing.has(String(f.text || f).toLowerCase())),
    ].slice(-40);
  }
  if (u.npcStatus?.length) {
    const list = [...(next.npcStatus || [])];
    for (const n of u.npcStatus) {
      const i = list.findIndex((x) => String(x.name).toLowerCase() === String(n.name).toLowerCase());
      if (i >= 0) list[i] = { ...list[i], ...n };
      else list.push(n);
    }
    next.npcStatus = list.slice(-12);
  }
  // A check result is authoritative only for the turn it was rolled in.
  next.lastRoll = u.lastRoll || null;
  return next;
}

/** The tone/format/boundary directives that belong in the base prompt. */
export { generationDirectives } from "./presets.js";

/** Convenience for callers that just want the linked preset's style line. */
export function styleLine(state, profile) {
  return activePreset(state, profile)?.style || "";
}
