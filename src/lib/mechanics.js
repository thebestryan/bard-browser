import { uid } from "./id.js";

/**
 * RPG Mechanics Engine — system-agnostic, Off / Light / Full.
 *  Off: pure narrative, data preserved.
 *  Light: HP, simple checks, basic inventory effects.
 *  Full: everything — attributes, derived values, equipment with modifiers,
 *        buffs/debuffs with durations, XP/levels, combat encounters.
 * The engine is authoritative: dice and damage are computed here, the LLM
 * only narrates the provided outcomes.
 */

export const MODES = ["off", "light", "full"];
export const STATS = ["might", "agility", "wits", "presence", "luck", "heart"];
export const STAT_LABEL = { might: "Might", agility: "Agility", wits: "Wits", presence: "Presence", luck: "Luck", heart: "Heart" };
export const SLOTS = ["weapon", "armor", "trinket"];
export const RARITY = ["common", "fine", "rare", "epic", "legendary"];

export function emptyMechanics(mode = "off") {
  return { mode, party: [], combat: null, log: [] };
}

export function roll(n = 20) {
  return 1 + Math.floor(Math.random() * n);
}

export function makeCharacter(name, { level = 1, stats } = {}) {
  const s = stats || Object.fromEntries(STATS.map((k) => [k, 2 + roll(2)]));
  const c = {
    id: uid(),
    name: name || "Hero",
    level,
    xp: 0,
    stats: s,
    hp: null,
    inventory: [],
    equipment: { weapon: null, armor: null, trinket: null },
    effects: [],
  };
  c.hp = maxHpOf(c);
  return c;
}

/* ---------------- derived values (includes gear + effects) ---------------- */

export function equippedItems(c) {
  return Object.values(c.equipment || {}).filter(Boolean);
}

export function statMod(c, stat) {
  let v = (c.stats?.[stat] ?? 0) + Math.floor((c.level - 1) / 2);
  for (const it of equippedItems(c)) {
    v += it.mods?.[stat] || 0;
  }
  for (const e of c.effects || []) {
    v += e.statMod?.[stat] || 0;
  }
  return v;
}

export function maxHpOf(c) {
  let hp = 50 + statMod(c, "might") * 8 + (c.level - 1) * 12;
  for (const it of equippedItems(c)) hp += it.hpBonus || 0;
  return Math.max(1, hp);
}

export function defenseOf(c) {
  let d = 8 + statMod(c, "agility");
  for (const it of equippedItems(c)) d += it.armor || 0;
  return d;
}

export function weaponOf(c) {
  return c.equipment?.weapon || null;
}

/* ---------------- items ---------------- */

/** Build a mechanical item from a world item (or scratch). */
export function makeItem({ name, type = "custom", rarity = "common", slot, damage, armor, mods, hpBonus, charges, description } = {}) {
  const r = RARITY.includes(rarity) ? rarity : "common";
  const q = RARITY.indexOf(r) + 1; // quality multiplier
  return {
    id: uid(),
    name: name || "Unnamed item",
    type,
    rarity: r,
    slot: slot || (type === "weapon" ? "weapon" : type === "armor" ? "armor" : type === "trinket" ? "trinket" : null),
    damage: damage || (type === "weapon" ? [2 + q, 6 + q * 2] : null), // [min, max]
    armor: armor ?? (type === "armor" ? q * 2 : 0),
    mods: mods || (slot === "trinket" ? { luck: q } : {}),
    hpBonus: hpBonus || 0,
    charges: charges ?? null,
    description: description || "",
  };
}

export function grantItem(c, item) {
  const c2 = {
    ...c,
    inventory: [...(c.inventory || []), item],
    equipment: { ...c.equipment },
  };
  if (item.slot && !c2.equipment[item.slot]) {
    c2.equipment[item.slot] = item;
    c2.hp = Math.min(c2.hp ?? maxHpOf(c2), maxHpOf(c2)); // hp may grow; clamp up handled on heal
  }
  return c2;
}

export function equipItem(c, itemId) {
  const item = (c.inventory || []).find((i) => i.id === itemId);
  if (!item?.slot) return c;
  const c2 = { ...c, equipment: { ...c.equipment, [item.slot]: item } };
  c2.hp = Math.min(c2.hp ?? maxHpOf(c2), maxHpOf(c2));
  return c2;
}

export function unequipSlot(c, slot) {
  const c2 = { ...c, equipment: { ...c.equipment, [slot]: null } };
  c2.hp = Math.min(c2.hp ?? 1, maxHpOf(c2));
  return c2;
}

/* ---------------- checks, damage, effects ---------------- */

export function checkStat(c, stat, dc = 12) {
  const d20 = roll(20);
  const mod = statMod(c, stat);
  const total = d20 + mod;
  return { stat, d20, mod, dc, total, success: total >= dc, crit: d20 === 20, fumble: d20 === 1 };
}

export function applyDamage(c, dmg) {
  return { ...c, hp: Math.max(0, (c.hp ?? maxHpOf(c)) - dmg) };
}

export function heal(c, amount) {
  return { ...c, hp: Math.min(maxHpOf(c), (c.hp ?? 0) + amount) };
}

export function addEffect(c, effect) {
  // effect: {name, rounds, statMod?, dmgPerRound?}
  return { ...c, effects: [...(c.effects || []), { id: uid(), ...effect }] };
}

export function tickEffects(c) {
  const effects = (c.effects || [])
    .map((e) => ({ ...e, rounds: e.rounds - 1 }))
    .filter((e) => e.rounds > 0);
  return { ...c, effects };
}

/* ---------------- combat ---------------- */

export function startCombat(party, enemyName, { level = 1, hp } = {}) {
  const enemyMax = hp || 40 + level * 12;
  return {
    round: 1,
    combatants: [
      ...party.map((c) => ({ refId: c.id, name: c.name, side: "ally", hp: c.hp ?? maxHpOf(c), maxHp: maxHpOf(c), defense: defenseOf(c) })),
      { refId: "enemy", name: enemyName, side: "enemy", hp: enemyMax, maxHp: enemyMax, defense: 8 + level * 2 },
    ],
  };
}

export function combatAttack(combat, attacker, targetName) {
  const atkD20 = roll(20);
  const atkMod = attacker.statMod ?? 2;
  const weapon = attacker.weapon;
  const total = atkD20 + atkMod;
  const target = combat.combatants.find((c) => c.name === targetName);
  if (!target) return null;
  const hit = atkD20 !== 1 && (atkD20 === 20 || total >= target.defense);
  let damage = 0;
  if (hit) {
    const [lo, hi] = weapon?.damage || [3, 8];
    damage = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (atkD20 === 20) damage *= 2;
  }
  const combatants = combat.combatants.map((c) =>
    c.name === targetName ? { ...c, hp: Math.max(0, c.hp - damage) } : c
  );
  return {
    combat: { ...combat, combatants },
    result: { attacker: attacker.name, targetName, atkD20, atkMod, total, defense: target.defense, hit, crit: atkD20 === 20, damage },
  };
}

export function combatOver(combat) {
  const enemies = combat.combatants.filter((c) => c.side === "enemy");
  const allies = combat.combatants.filter((c) => c.side === "ally");
  if (enemies.every((c) => c.hp <= 0)) return "victory";
  if (allies.every((c) => c.hp <= 0)) return "defeat";
  return null;
}

/* ---------------- progression ---------------- */

export function xpForLevel(level) {
  return level * 100;
}

export function grantXp(c, amount) {
  let xp = (c.xp || 0) + amount;
  let level = c.level;
  let leveled = false;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
    leveled = true;
  }
  const c2 = { ...c, xp, level };
  if (leveled) c2.hp = Math.min(maxHpOf(c2), (c2.hp ?? 0) + 12);
  return { character: c2, leveled };
}

/* ---------------- prompt rendering ---------------- */

export function mechanicsPromptBlock(mechanics) {
  if (!mechanics || mechanics.mode === "off") return "";
  const { party, combat } = mechanics;
  let out = `\n[RPG MECHANICS: ${mechanics.mode.toUpperCase()} mode — dice outcomes below are authoritative; narrate around them, never invent different numbers.]\n`;
  for (const c of party) {
    out += `Party — ${c.name} (lvl ${c.level}): HP ${c.hp}/${maxHpOf(c)}, ` +
      `stats ${STATS.map((s) => `${STAT_LABEL[s]} ${statMod(c, s)}`).join(", ")}, defense ${defenseOf(c)}` +
      (c.equipment?.weapon?.damage ? `, weapon ${c.equipment.weapon.name} (dmg ${c.equipment.weapon.damage[0]}-${c.equipment.weapon.damage[1]})` : c.equipment?.weapon ? `, weapon ${c.equipment.weapon.name}` : "") +
      `, effects: ${c.effects?.length ? c.effects.map((e) => `${e.name} (${e.rounds}r)`).join(", ") : "none"}\n`;
  }
  if (combat) {
    out += `Combat round ${combat.round}: ${combat.combatants.map((c) => `${c.name} ${c.hp}/${c.maxHp} (def ${c.defense})`).join(", ")}.\n`;
  }
  return out;
}
