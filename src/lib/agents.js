import { uid } from "./id.js";
import { callJSON } from "./ai.js";

/**
 * Agents & Trackers — Marinara-style toggleable per-chat add-ons.
 * Each agent analyzes recent messages and maintains part of a shared
 * per-chat agent state. Works with any text profile (mock or real).
 */

export const AGENTS = [
  { id: "worldState", icon: "globe", name: "World State Tracker", category: "Tracker", desc: "Extracts durable facts (location, time, weather, promises, injuries) from the story as it happens." },
  { id: "characterTracker", icon: "users", name: "Character Tracker", category: "Tracker", desc: "Tracks who's present, their status and how they feel about you." },
  { id: "questTracker", icon: "target", name: "Quest Tracker", category: "Tracker", desc: "Detects new quests and progress from conversation." },
  { id: "inventoryTracker", icon: "package", name: "Inventory Tracker", category: "Tracker", desc: "Watches for items gained or lost in the story." },
  { id: "memory", icon: "brain", name: "Long-Term Memory", category: "Tracker", desc: "Summarizes older messages into compact durable memories so long chats stay coherent." },
  { id: "lorebookKeeper", icon: "book", name: "Lorebook Keeper", category: "Misc", desc: "Harvests new lore with trigger keywords from the story into a lorebook." },
  { id: "cyoa", icon: "dice", name: "CYOA Choices", category: "Misc", desc: "Offers clickable action choices after each reply." },
  { id: "expression", icon: "masks", name: "Expression Engine", category: "Misc", desc: "Reads the character's current emotion and shows it on their replies." },
  { id: "combat", icon: "sword", name: "Combat Tracker", category: "Misc", desc: "Detects fights and tracks rounds, hit points and fallen combatants." },
];

export function initialAgentState() {
  return {
    enabled: {},
    // deterministic world state (pre-gen writes here before the model runs)
    world: null,
    lastRoll: null,
    facts: [],
    npcStatus: [],
    memory: [],
    quests: [],
    inventory: [],
    emotion: null,
    lastChoices: [],
    combat: null,
    lastRunMessageCount: 0,
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function naiveFacts(text) {
  // offline heuristic: track "X is/are now Y" and "we/head/move to Z" style lines
  const facts = [];
  const move = text.match(/\b(?:arrive|arrived|head(?:ed|ing)?|walk(?:ed|ing)?|enter(?:ed)?|travel(?:ed|ing)?)\s+(?:to|into|at)?\s+(?:the\s+)?([A-Z][\w\s'-]{2,40})/);
  if (move) facts.push(`Location: ${move[1].trim().replace(/[.,!?]+$/, "")}`);
  const weather = text.match(/\b(?:rain|storm|snow|fog|clear skies|sunset|sunrise|night falls|dawn)\b/i);
  if (weather) facts.push(`Weather/Time: ${cap(weather[0].toLowerCase())}`);
  const promise = text.match(/\b(?:promise|swear|vow|owe)\b/i);
  if (promise) facts.push(`A promise or debt was made ("…${text.slice(Math.max(0, promise.index - 30), promise.index + 40).trim()}…")`);
  return facts;
}

const MOCK_EMOTIONS = ["amused", "wary", "curious", "troubled", "determined", "fond"];

/** Run all enabled tracker agents over the latest exchange. Returns partial agent state. */
export async function runTrackerAgents({ profile, messages, character, agentState, world, extraInstructions = "" }) {
  const out = { facts: [], npcStatus: [], quests: [], inventoryAdds: [], inventoryRemoves: [], memoryAdd: null, emotion: null, combat: null };
  const recent = messages.slice(-6);

  if (profile?.isMock) {
    const last = recent.filter((m) => m.role !== "system").slice(-1)[0];
    const text = last?.text || "";
    if (agentState.enabled.worldState) out.facts = naiveFacts(text);
    if (agentState.enabled.characterTracker) {
      const who = text.match(/\b(?:with|beside|across from|near)\s+([A-Z][\w'-]{2,24})/);
      if (who) out.npcStatus = [{ name: who[1], status: "present", relation: "engaged" }];
      else out.npcStatus = [{ name: character.name, status: "present", relation: "conversing" }];
    }
    if (agentState.enabled.questTracker) {
      if (/\b(?:quest|mission|task|favor|errand|bounty)\b/i.test(text) && !agentState.quests.some((q) => q.done)) {
        const m = text.match(/\b(?:retrieve|find|deliver|kill|protect|steal|rescue)\b/i);
        out.quests = [{ title: cap((m ? m[0] : "unresolved task") + " — " + (text.slice(0, 24).trim() || "new thread")), status: "open" }];
      }
    }
    if (agentState.enabled.inventoryTracker) {
      const gain = text.match(/\b(?:take|pick up|receive|find|grab|steal|buy)\s+(?:the\s+|a\s+|an\s+)?([a-z][\w\s'-]{2,30})/i);
      const lose = text.match(/\b(?:drop|lose|give away|use up|spend)\s+(?:the\s+|a\s+|an\s+)?([a-z][\w\s'-]{2,30})/i);
      if (gain) out.inventoryAdds = [gain[1].trim()];
      if (lose) out.inventoryRemoves = [lose[1].trim()];
    }
    if (agentState.enabled.memory && messages.length > 0 && messages.length % 10 === 0) {
      out.memoryAdd = `So far: the conversation with ${character.name} has covered ${messages.filter((m) => m.role === "user").length} exchanges, most recently about "${text.slice(0, 60)}".`;
    }
    if (agentState.enabled.expression) out.emotion = MOCK_EMOTIONS[messages.length % MOCK_EMOTIONS.length];
    if (agentState.enabled.combat) {
      if (!agentState.combat && /\b(?:attack|fight|draw|strike|swing|shoot|charge)\b/i.test(text)) {
        out.combat = {
          round: 1,
          combatants: [
            { name: character.name, hp: 100, side: "enemy" },
            { name: "You", hp: 100, side: "ally" },
          ],
        };
      } else if (agentState.combat && /\b(?:flee|retreat|surrender|end fight)\b/i.test(text)) {
        out.combat = { ended: true };
      } else if (agentState.combat) {
        const dmg = 8 + Math.floor(Math.random() * 18);
        const target = agentState.combat.combatants.find((c) => c.side === "enemy");
        out.combat = { hitEnemy: dmg, targetName: target?.name };
      }
    }
    return out;
  }

  // Real profile: one structured analysis call
  const enabled = AGENTS.filter((a) => agentState.enabled[a.id] && a.category === "Tracker").map((a) => a.id);
  if (!enabled.length) return out;
  const transcript = recent.map((m) => `${m.role === "user" ? "User" : character.name}: ${m.text}`).join("\n");
  const data = await callJSON(
    profile,
    `You are a story state tracker. Analyze the transcript and report changes only. Return JSON: {"facts":[string],"npcStatus":[{"name":"","status":"","relation":""}],"quests":[{"title":"","status":"open|active|done|failed"}],"inventoryAdds":[string],"inventoryRemoves":[string],"memoryAdd":string|null,"emotion":string|null,"combat":{"round":number,"combatants":[{"name":"","hp":number,"side":"ally|enemy"}]}|{"ended":true}|null}`,
    `Character: ${character.name}. ${world ? `World: ${world.name}.` : ""}\nKnown state: ${JSON.stringify({ facts: agentState.facts.slice(-10), npcStatus: agentState.npcStatus, quests: agentState.quests, inventory: agentState.inventory, combat: agentState.combat })}\nTranscript:\n${transcript}` +
    (extraInstructions ? `\nAdditional agent instructions:\n${extraInstructions}` : "")
  );
  return {
    facts: (Array.isArray(data.facts) ? data.facts : []).slice(0, 5),
    npcStatus: Array.isArray(data.npcStatus) ? data.npcStatus.slice(0, 5) : [],
    quests: Array.isArray(data.quests) ? data.quests.slice(0, 3) : [],
    inventoryAdds: Array.isArray(data.inventoryAdds) ? data.inventoryAdds.slice(0, 5) : [],
    inventoryRemoves: Array.isArray(data.inventoryRemoves) ? data.inventoryRemoves.slice(0, 5) : [],
    memoryAdd: typeof data.memoryAdd === "string" ? data.memoryAdd : null,
    emotion: typeof data.emotion === "string" ? data.emotion : null,
    combat: data.combat && typeof data.combat === "object" ? data.combat : null,
  };
}

/** CYOA choices for the current moment. */
export async function runCYOA({ profile, messages, character, world }) {
  const recent = messages.slice(-4).map((m) => `${m.role === "user" ? "User" : character.name}: ${m.text}`).join("\n");
  if (profile?.isMock) {
    const seeds = [
      `Ask ${character.name} what they're really thinking`,
      "Change the subject entirely",
      "Leave the room without a word",
      "Offer to help with whatever they fear most",
    ];
    return seeds.slice(0, 3 + (messages.length % 2));
  }
  const data = await callJSON(
    profile,
    `Propose 3-4 short, vivid next actions for the USER (second person, imperative, max 12 words each). Return JSON {"choices":[string]}`,
    `Scene so far:\n${recent}\n${world ? `World: ${world.name}.` : ""}`
  );
  return Array.isArray(data.choices) ? data.choices.slice(0, 4) : [];
}

/** Lorebook Keeper: harvest entries from the latest exchange. */
export async function runLorebookKeeper({ profile, messages, character }) {
  const recent = messages.slice(-4).map((m) => `${m.role === "user" ? "User" : character.name}: ${m.text}`).join("\n");
  if (profile?.isMock) {
    const noun = recent.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/);
    if (!noun) return [];
    return [{ keys: [noun[1].toLowerCase()], content: `${noun[1]} came up between the user and ${character.name}; worth remembering.` }];
  }
  const data = await callJSON(
    profile,
    `Extract 0-2 lorebook entries from the story. Each needs short trigger keywords that would appear in future text. Return JSON {"entries":[{"keys":[""],"content":""}]}`,
    recent
  );
  return (Array.isArray(data.entries) ? data.entries : []).slice(0, 2);
}

/** Merge tracker output into agent state (pure). */
export function applyTrackerOutput(agentState, out) {
  const next = { ...agentState };
  if (out.facts?.length)
    next.facts = [...agentState.facts, ...out.facts.filter((f) => !agentState.facts.includes(f)).map((text) => ({ id: uid(), text }))].slice(-40);
  if (out.npcStatus?.length) {
    next.npcStatus = [...agentState.npcStatus];
    for (const n of out.npcStatus) {
      const i = next.npcStatus.findIndex((x) => x.name?.toLowerCase() === n.name?.toLowerCase());
      if (i >= 0) next.npcStatus[i] = { ...next.npcStatus[i], ...n };
      else next.npcStatus.push({ name: n.name || "?", status: n.status || "", relation: n.relation || "" });
    }
    next.npcStatus = next.npcStatus.slice(-12);
  }
  if (out.quests?.length) {
    next.quests = [...agentState.quests];
    for (const q of out.quests) {
      const i = next.quests.findIndex((x) => x.title?.toLowerCase() === q.title?.toLowerCase());
      if (i >= 0) next.quests[i] = { ...next.quests[i], status: q.status || next.quests[i].status };
      else next.quests.push({ id: uid(), title: q.title || "New quest", status: q.status || "open" });
    }
  }
  if (out.inventoryAdds?.length || out.inventoryRemoves?.length) {
    let inv = [...agentState.inventory];
    for (const add of out.inventoryAdds || []) {
      const i = inv.findIndex((x) => x.name?.toLowerCase() === add.toLowerCase());
      if (i >= 0) inv[i] = { ...inv[i], count: (inv[i].count || 1) + 1 };
      else inv.push({ id: uid(), name: add, count: 1 });
    }
    for (const rem of out.inventoryRemoves || []) {
      const i = inv.findIndex((x) => x.name?.toLowerCase().includes(rem.toLowerCase()));
      if (i >= 0) inv[i] = { ...inv[i], count: (inv[i].count || 1) - 1 };
      else inv = inv.filter((x) => !x.name?.toLowerCase().includes(rem.toLowerCase()));
    }
    next.inventory = inv.filter((x) => (x.count ?? 1) > 0);
  }
  if (out.memoryAdd) next.memory = [...agentState.memory, { id: uid(), text: out.memoryAdd }].slice(-30);
  if (out.emotion) next.emotion = out.emotion;
  if (out.combat) {
    if (out.combat.ended) next.combat = null;
    else if (out.combat.combatants) next.combat = { round: out.combat.round || 1, combatants: out.combat.combatants };
    else if (out.combat.hitEnemy && agentState.combat) {
      const combatants = agentState.combat.combatants.map((c) =>
        c.name === out.combat.targetName ? { ...c, hp: Math.max(0, c.hp - out.combat.hitEnemy) } : c
      );
      next.combat = { round: agentState.combat.round + 1, combatants };
    }
  }
  next.lastRunMessageCount = 0; // caller sets
  return next;
}
