import { uid } from "./id.js";

/**
 * Persistent Story Memory — durable continuity that survives across sessions,
 * separate from the raw transcript. Memories are recalled into the prompt by
 * relevance (keyword + importance + pinned + recency), and contradictions
 * supersede older memories instead of coexisting silently.
 */

export const MEMORY_TYPES = ["fact", "relationship", "state", "thread", "scene"];

export function newMemory(text, { type = "fact", importance = 2, source = "manual", pinned = false } = {}) {
  return {
    id: uid(),
    text: text.trim(),
    type,
    importance: Math.min(3, Math.max(1, importance)),
    pinned,
    archived: false,
    superseded: false,
    supersededBy: null,
    source,
    createdAt: Date.now(),
  };
}

/**
 * Category prefix before ":" — "Location: The Docks" → "location".
 * Only these prefixes supersede each other. Matching *any* "Prefix: text"
 * made ordinary lines ("Nadia said: …", "Positive moment: …") wipe out the
 * previous memory of the same shape.
 */
const SUPERSEDING_CATEGORIES = new Set([
  "location", "time", "weather", "weather/time", "mood", "status",
  "health", "injury", "goal", "objective", "relationship",
]);

function categoryOf(text) {
  const m = String(text).match(/^([A-Za-z][A-Za-z /]{1,20}):\s*/);
  if (!m) return null;
  const cat = m[1].toLowerCase().trim();
  return SUPERSEDING_CATEGORIES.has(cat) ? cat : null;
}

const stop = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "is", "was", "with", "for", "that", "this", "it", "they", "we", "you", "i"]);
function keywords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

/**
 * Merge incoming memories into the store.
 * Contradiction rule: an incoming memory with the same category prefix
 * (e.g. two "Location: …" facts) but different content supersedes the old one.
 * Exact duplicates are dropped.
 */
export function integrateMemories(existing, incoming) {
  const next = existing.map((m) => ({ ...m }));
  const added = [];
  for (const inc of incoming) {
    const mem = inc.id ? { ...inc } : newMemory(inc.text ?? inc, { type: inc.type, importance: inc.importance, source: inc.source });
    if (!mem.text) continue;
    const dup = next.find((m) => m.text.toLowerCase() === mem.text.toLowerCase() && !m.superseded);
    if (dup) continue;
    const cat = categoryOf(mem.text);
    if (cat && !mem.pinned) {
      for (const old of next) {
        if (old.superseded || old.archived || old.pinned) continue;
        if (categoryOf(old.text) === cat && old.text.toLowerCase() !== mem.text.toLowerCase()) {
          old.superseded = true;
          old.supersededBy = mem.id;
        }
      }
    }
    next.push(mem);
    added.push(mem);
  }
  return { memories: next, added };
}

/** Score a memory against the current message for prompt recall. */
export function scoreMemory(m, query, now = Date.now()) {
  if (m.superseded || m.archived) return -1;
  const kw = keywords(query || "");
  const mk = keywords(m.text);
  const overlap = kw.filter((w) => mk.some((k) => k === w || k.startsWith(w) || w.startsWith(k))).length;
  const ageDays = (now - m.createdAt) / 86400000;
  const recency = Math.max(0, 2 - ageDays * 0.2);
  return (m.pinned ? 100 : 0) + overlap * 3 + m.importance + recency;
}

/** Select the memories to inject into the prompt. */
export function recallMemories(memories, query, { limit = 8 } = {}) {
  return (memories || [])
    .map((m) => ({ m, s: scoreMemory(m, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}
