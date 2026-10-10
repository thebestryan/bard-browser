import React, { useState } from "react";
import { uid, useStore } from "../store";
import Icon from "./Icon";
import {
  MODES, STATS, STAT_LABEL, SLOTS,
  emptyMechanics, makeCharacter, makeItem, grantItem, equipItem, unequipSlot,
  statMod, maxHpOf, checkStat, applyDamage, heal, addEffect, tickEffects,
  startCombat, combatAttack, combatOver, grantXp,
} from "../lib/mechanics";

/**
 * RPG Mechanics panel — Off/Light/Full. Works on a chat or a world:
 * party sheets, equipment, d20 checks, effects, combat, XP.
 */
export default function MechanicsPanel({ collection, id, onClose }) {
  const { state, patch } = useStore();
  const rec = state[collection]?.find((x) => x.id === id);
  const mech = rec?.mechanics || emptyMechanics("off");
  const world = collection === "worlds" ? rec : state.worlds.find((w) => w.id === rec?.worldId);
  const persona = state.personas[0];
  const [enemyName, setEnemyName] = useState("");
  const [effectName, setEffectName] = useState("");

  const setMech = (patchObj) => patch(collection, id, { mechanics: { ...mech, ...patchObj } });

  const setMode = (mode) => {
    if (mech.mode !== "off" || mode === "off") {
      setMech({ mode, log: [...mech.log, { id: uid(), ts: Date.now(), entry: `Mechanics set to ${mode.toUpperCase()}.` }] });
      return;
    }
    // initialize party on first enable
    const party = [];
    party.push(makeCharacter(persona?.name || "You"));
    const groupIds = collection === "chats"
      ? (rec.characterIds || [rec.characterId]).slice(1).filter(Boolean)
      : [];
    for (const gid of groupIds) {
      const g = state.characters.find((c) => c.id === gid);
      if (g) party.push(makeCharacter(g.name));
    }
    setMech({
      mode,
      party,
      log: [...mech.log, { id: uid(), ts: Date.now(), entry: `Mechanics set to ${mode.toUpperCase()}. Party formed: ${party.map((p) => p.name).join(", ")}.` }],
    });
  };

  /** Single-write helper: apply party/combat changes + append log atomically. */
  const applyChanges = ({ party, combat, entries }) => {
    const logEntries = (entries || []).map((entry) => ({ id: uid(), ts: Date.now(), entry }));
    setMech({
      ...(party ? { party } : {}),
      ...(combat !== undefined ? { combat } : {}),
      log: [...mech.log, ...logEntries].slice(-40),
    });
  };

  const doCheck = (cIdx, stat, dc) => {
    const r = checkStat(mech.party[cIdx], stat, dc);
    applyChanges({
      party: mech.party.map((c, i) => (i === cIdx ? { ...c, _last: r } : c)),
      entries: [`${mech.party[cIdx].name} ${STAT_LABEL[stat]} check: d20 ${r.d20} +${r.mod} = ${r.total} vs DC ${dc} → ${r.success ? "SUCCESS" : "FAILURE"}${r.crit ? " (critical!)" : ""}${r.fumble ? " (fumble!)" : ""}`],
    });
  };

  const damageMember = (cIdx, dmg) => {
    applyChanges({
      party: mech.party.map((c, i) => (i === cIdx ? applyDamage(c, dmg) : c)),
      entries: [`${mech.party[cIdx].name} takes ${dmg} damage.`],
    });
  };
  const healMember = (cIdx, amt) => {
    applyChanges({
      party: mech.party.map((c, i) => (i === cIdx ? heal(c, amt) : c)),
      entries: [`${mech.party[cIdx].name} heals ${amt}.`],
    });
  };
  const addEffectTo = (cIdx) => {
    if (!effectName.trim()) return;
    applyChanges({
      party: mech.party.map((c, i) => (i === cIdx ? addEffect(c, { name: effectName.trim(), rounds: 3, statMod: { might: -1 } }) : c)),
      entries: [`${mech.party[cIdx].name} gains effect: ${effectName.trim()} (3 rounds).`],
    });
    setEffectName("");
  };

  const loot = (worldItem) => {
    if (!mech.party.length) return;
    const item = makeItem(worldItem);
    applyChanges({
      party: mech.party.map((c, i) => (i === 0 ? grantItem({ ...c }, item) : c)),
      entries: [`${mech.party[0].name} acquires ${item.name} (${item.rarity}${item.slot ? `, ${item.slot}` : ""}${item.damage ? `, dmg ${item.damage[0]}-${item.damage[1]}` : ""}${item.armor ? `, armor ${item.armor}` : ""}).`],
    });
  };
  const equip = (cIdx, itemId) => {
    applyChanges({
      party: mech.party.map((c, i) => (i === cIdx ? equipItem({ ...c }, itemId) : c)),
      entries: [`${mech.party[cIdx].name} equips an item.`],
    });
  };
  const unequip = (cIdx, slot) => {
    applyChanges({
      party: mech.party.map((c, i) => (i === cIdx ? unequipSlot({ ...c }, slot) : c)),
      entries: [`${mech.party[cIdx].name} unequips ${slot}.`],
    });
  };

  const startEncounter = () => {
    if (!enemyName.trim() || !mech.party.length) return;
    const combat = startCombat(mech.party, enemyName.trim(), { level: mech.party[0].level });
    applyChanges({
      combat,
      entries: [`Encounter begins: ${enemyName.trim()} vs ${mech.party.map((p) => p.name).join(", ")}!`],
    });
    setEnemyName("");
  };
  const attack = (cIdx, enemyNameTarget) => {
    if (!mech.combat) return;
    const c = mech.party[cIdx];
    const attacker = {
      name: c.name,
      statMod: Math.max(statMod(c, "might"), statMod(c, "agility")),
      weapon: c.equipment?.weapon,
    };
    const swing = combatAttack(mech.combat, attacker, enemyNameTarget);
    if (!swing) return; // target no longer in the encounter
    const { combat, result } = swing;
    // enemy retaliation + effect ticks when enemy dead or after all allies act is simplified: enemy strikes back immediately
    let combat2 = combat;
    if (result.hit) {
      const enemy = combat.combatants.find((x) => x.side === "enemy");
      if (enemy && enemy.hp > 0) {
        const dmg = 3 + Math.floor(Math.random() * 7) + mech.party[0].level;
        // each ally keeps their OWN maxHp; party[0]'s was being applied to everyone
        combat2 = { ...combat, combatants: combat.combatants.map((x) => {
          if (x.side !== "ally" || x.hp <= 0) return x;
          const member = mech.party.find((p) => p.id === x.refId);
          return applyDamage({ ...x, maxHp: member ? maxHpOf(member) : x.maxHp }, dmg);
        }) };
      }
    }
    combat2 = { ...combat2, round: combat2.round + 1 };
    let newParty = mech.party.map((c0) => {
      const cb = combat2.combatants.find((x) => x.refId === c0.id);
      if (!cb) return c0;
      return tickEffects({ ...c0, hp: cb.hp });
    });
    const entries = [
      `${result.attacker} attacks ${result.targetName}: d20 ${result.atkD20} +${result.atkMod} = ${result.total} vs def ${result.defense} → ${result.crit ? "CRITICAL HIT! " : result.hit ? "hit! " : "miss. "}${result.hit ? `${result.damage} damage.` : ""}` + (result.hit ? ` ${result.targetName} strikes back.` : ""),
    ];
    const over = combatOver(combat2);
    if (over === "victory") {
      const xp = 60 + mech.party[0].level * 30;
      newParty = newParty.map((c0) => grantXp({ ...c0 }, xp).character);
      entries.push(`Victory — party gains ${xp} XP.`);
    } else if (over === "defeat") {
      entries.push(`Defeat — the party falls.`);
    }
    applyChanges({ party: newParty, combat: combat2, entries });
  };

  const over = mech.combat ? combatOver(mech.combat) : null;

  return (
    <div className="hud">
      <div className="hud-section">
        <h3>RPG Mechanics</h3>
        <div className="row">
          <select value={mech.mode} onChange={(e) => setMode(e.target.value)} style={{ flex: 1 }}>
            {MODES.map((m) => <option key={m} value={m}>{m === "off" ? "Off — pure narrative" : m === "light" ? "Light — HP & checks" : "Full — everything"}</option>)}
          </select>
          {onClose && <button className="btn sm ghost" onClick={onClose}><Icon name="x" size={12} /></button>}
        </div>
        <div className="faint mt" style={{ lineHeight: 1.4 }}>
          {mech.mode === "off" && "Dice and stats are dormant. Your sheets are preserved."}
          {mech.mode === "light" && "HP, d20 checks and simple damage."}
          {mech.mode === "full" && "Attributes, gear modifiers, effects, XP and levels."}
        </div>
        <div className="faint mt">The dice are authoritative — the AI narrates the results, never rerolls them.</div>
      </div>

      {mech.mode !== "off" && (
        <>
          {mech.combat && (
            <div className="hud-section">
              <h3>Combat — Round {mech.combat.round}</h3>
              {mech.combat.combatants.map((c, i) => (
                <div className="stat-line" key={i}>
                  <span style={{ width: 80, color: c.side === "enemy" ? "var(--red)" : undefined }}>{c.name}</span>
                  <span className="bar"><i style={{ width: `${Math.max(0, (c.hp / c.maxHp) * 100)}%`, background: c.side === "enemy" ? "linear-gradient(90deg,var(--red),var(--amber))" : undefined }} /></span>
                  <span className="faint">{c.hp}/{c.maxHp}</span>
                </div>
              ))}
              {over ? (
                <div className="mt">{over === "victory" ? "Victory" : "Defeat"}</div>
              ) : (
                mech.combat.combatants.filter((c) => c.side === "enemy" && c.hp > 0).map((e) => (
                  <div key={e.name} className="row mt">
                    {mech.party.map((p, i) => (
                      <button key={p.id} className="btn sm" disabled={p.hp <= 0} onClick={() => attack(i, e.name)}>
                        {p.name.split(" ")[0]} → {e.name.split(" ")[0]}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {!mech.combat && (
            <div className="hud-section">
              <h3>Start Encounter</h3>
              <div className="row">
                <input className="grow" value={enemyName} placeholder="Enemy name…" onChange={(e) => setEnemyName(e.target.value)} />
                <button className="btn sm primary" onClick={startEncounter} disabled={!enemyName.trim()}>Start</button>
              </div>
            </div>
          )}

          {mech.party.map((c, ci) => (
            <div className="hud-section" key={c.id}>
              <h3>{c.name} — Lv {c.level}{mech.mode === "full" ? ` · ${c.xp}/${c.level * 100} XP` : ""}</h3>
              <div className="stat-line">
                <span style={{ width: 40 }}>HP</span>
                <span className="bar"><i style={{ width: `${(c.hp / maxHpOf(c)) * 100}%` }} /></span>
                <span className="faint">{c.hp}/{maxHpOf(c)}</span>
              </div>
              {mech.mode === "full" && (
                <div className="row wrap" style={{ marginTop: 6 }}>
                  {STATS.map((s) => (
                    <button key={s} className="chip" title={`Roll ${STAT_LABEL[s]} check`}
                      onClick={() => doCheck(ci, s, 12)}>
                      {STAT_LABEL[s].slice(0, 3)} {statMod(c, s) >= 0 ? `+${statMod(c, s)}` : statMod(c, s)}
                    </button>
                  ))}
                </div>
              )}
              <div className="row mt" style={{ fontSize: 11 }}>
                <span className="faint">Check DC:</span>
                <span className="faint">click a stat above (DC 12) — combat uses your weapon</span>
              </div>
              {mech.mode === "full" && (
                <>
                  <div className="row wrap mt" style={{ fontSize: 11 }}>
                    {SLOTS.map((slot) => (
                      <span key={slot} className="tag" title={c.equipment?.[slot]?.description || ""}>
                        {slot}: {c.equipment?.[slot]?.name || "—"}
                        {c.equipment?.[slot] && (
                          <button style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", marginLeft: 4 }}
                            onClick={() => unequip(ci, slot)}>×</button>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="row wrap mt">
                    {(c.inventory || []).map((it) => (
                      <button key={it.id} className="chip" onClick={() => equip(ci, it.id)} title={`Equip ${it.name} (${it.rarity})`}>
                        {it.name}{it.slot ? "" : " (passive)"}
                      </button>
                    ))}
                    {(c.inventory || []).length === 0 && <span className="faint">inventory empty</span>}
                  </div>
                  {c.effects?.length > 0 && (
                    <div className="row wrap mt">
                      {c.effects.map((e) => <span key={e.id} className="tag" style={{ borderColor: "var(--amber)" }}>{e.name} ({e.rounds}r)</span>)}
                    </div>
                  )}
                  <div className="row mt">
                    <input style={{ flex: 1, fontSize: 11 }} value={effectName} placeholder="Add effect (e.g. Poisoned)"
                      onChange={(e) => setEffectName(e.target.value)} />
                    <button className="btn sm" onClick={() => addEffectTo(ci)}><Icon name="plus" size={12} /></button>
                  </div>
                  <div className="row mt">
                    <button className="btn sm" onClick={() => healMember(ci, 15)}>Heal 15</button>
                    <button className="btn sm" onClick={() => damageMember(ci, 10)}>Damage 10</button>
                  </div>
                </>
              )}
              {c._last && (
                <div className="faint mt">Last check: {STAT_LABEL[c._last.stat]} {c._last.total} vs {c._last.dc} → {c._last.success ? "success" : "fail"}</div>
              )}
            </div>
          ))}

          {(world?.items || []).length > 0 && (
            <div className="hud-section">
              <h3>Loot from World</h3>
              <div className="row wrap">
                {world.items.map((it, i) => (
                  <button key={i} className="chip" onClick={() => loot(it)}>+ {it.name}</button>
                ))}
              </div>
              <div className="faint mt">World items gain mechanical stats when looted (quality by rarity).</div>
            </div>
          )}

          {mech.log.length > 0 && (
            <div className="hud-section">
              <h3>Mechanics Log</h3>
              <div className="event-log">
                {mech.log.slice().reverse().map((l) => <div key={l.id} className="ev">{l.entry}</div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
