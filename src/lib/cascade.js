/**
 * Deleting an entity leaves references behind: a chat still pointing at a
 * deleted character opens as "Chat not found", a profile still linked to a
 * deleted preset silently loses its defaults. These helpers describe and
 * apply the cleanup. Pure, so the confirmation dialog and the actual delete
 * agree on exactly what will happen.
 */

const charIdsOf = (chat) => (chat.characterIds || [chat.characterId]).filter(Boolean);

/** Human-readable label per collection, singular. */
export const ENTITY_LABEL = {
  characters: "character",
  worlds: "world",
  personas: "persona",
  scenarios: "scenario",
  virtualHumans: "virtual human",
  lorebooks: "lorebook",
  presets: "preset",
  chats: "chat",
  userFiles: "file",
};

/**
 * What else changes if `id` is removed from `coll`.
 * { deletedChats, updatedChats, updatedProfiles }
 */
export function deletionImpact(state, coll, id) {
  const impact = { deletedChats: 0, updatedChats: 0, updatedProfiles: 0 };
  const chats = state.chats || [];

  if (coll === "characters") {
    for (const c of chats) {
      const ids = charIdsOf(c);
      if (!ids.includes(id)) continue;
      if (ids.length === 1) impact.deletedChats++;
      else impact.updatedChats++;
    }
  } else if (coll === "worlds") {
    impact.updatedChats = chats.filter((c) => c.worldId === id).length;
  } else if (coll === "personas") {
    impact.updatedChats = chats.filter((c) => c.personaId === id).length;
  } else if (coll === "scenarios") {
    impact.updatedChats = chats.filter((c) => c.scenarioId === id).length;
  } else if (coll === "presets") {
    impact.updatedProfiles = (state.profiles || []).filter((p) => p.presetId === id).length;
  }
  return impact;
}

/** One sentence describing the impact, or "" when nothing else is touched. */
export function impactSummary(impact) {
  const parts = [];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (impact.deletedChats) parts.push(`${n(impact.deletedChats, "chat", "chats")} will also be deleted`);
  if (impact.updatedChats) parts.push(`${n(impact.updatedChats, "chat", "chats")} will be updated`);
  if (impact.updatedProfiles) parts.push(`${n(impact.updatedProfiles, "connection profile", "connection profiles")} will lose the linked preset`);
  if (!parts.length) return "";
  return parts.join(", ").replace(/^./, (m) => m.toUpperCase()) + ".";
}

/**
 * Remove `id` from `coll` and clean up everything that referenced it.
 * Returns the changed slices of state (for the store's `update`).
 */
export function removeCascade(state, coll, id) {
  const next = { [coll]: (state[coll] || []).filter((x) => x.id !== id) };

  if (coll === "characters") {
    next.chats = [];
    for (const c of state.chats || []) {
      const ids = charIdsOf(c);
      if (!ids.includes(id)) { next.chats.push(c); continue; }
      const left = ids.filter((x) => x !== id);
      if (!left.length) continue; // no cast left — drop the chat
      next.chats.push({
        ...c,
        characterIds: left,
        characterId: left[0],
        speakerId: c.speakerId && left.includes(c.speakerId) ? c.speakerId : left[0],
      });
    }
  } else if (coll === "worlds" || coll === "personas" || coll === "scenarios") {
    const key = { worlds: "worldId", personas: "personaId", scenarios: "scenarioId" }[coll];
    next.chats = (state.chats || []).map((c) => (c[key] === id ? { ...c, [key]: null } : c));
  } else if (coll === "presets") {
    next.profiles = (state.profiles || []).map((p) => (p.presetId === id ? { ...p, presetId: null } : p));
  }

  return next;
}
