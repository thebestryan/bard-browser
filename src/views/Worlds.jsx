import React, { useState } from "react";
import { uid, useStore } from "../store";
import { AICreator, CoverImage, DeleteButton, Empty, Field, ImageGen, ImagePicker, Modal, PageHead } from "../components/UI";
import { impactSummary } from "../lib/cascade";
import Icon from "../components/Icon";
import { generateWorld } from "../lib/ai";
import { fromWorldJSON, downloadJSON } from "../lib/stio";
import { genbus, runDetached } from "../lib/genbus";
const ITEM_TYPES = ["weapon", "armor", "clothing", "consumable", "tool", "treasure", "custom"];

/** AI Fill results that finished after their editor closed — applied on reopen. */
const worldFillPending = new Map();

function mergeWorldGen(x, gen) {
  return {
    ...x,
    name: x.name || gen.name,
    genre: x.genre || gen.genre,
    tagline: x.tagline || gen.tagline,
    description: x.description || gen.description,
    locations: [...x.locations, ...gen.locations],
    npcs: [...x.npcs, ...gen.npcs],
    factions: [...x.factions, ...gen.factions],
    items: [...x.items, ...gen.items],
    quests: [...x.quests, ...gen.quests],
    startLocation: x.startLocation || gen.startLocation,
  };
}

/** Fuzzy name similarity: 1 = identical, substring = 0.8, else Sørensen–Dice on character bigrams. */
function nameSimilarity(a, b) {
  a = String(a || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  b = String(b || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const grams = (str) => {
    const m = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const g = str.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = grams(a), B = grams(b);
  let overlap = 0, total = 0;
  A.forEach((v) => { total += v; });
  B.forEach((v, k) => { total += v; if (A.has(k)) overlap += Math.min(v, A.get(k)); });
  return total ? (2 * overlap) / total : 0;
}

export default function Worlds({ playWorld }) {
  const { state, add, patch, activeProfile, removeCascade, deletionImpact } = useStore();
  const [open, setOpen] = useState(null); // world being edited
  const fileRef = React.useRef(null);

  const doImport = async (e) => {
    for (const f of e.target.files || []) {
      try {
        const w = fromWorldJSON(JSON.parse(await f.text()));
        add("worlds", w);
      } catch (err) {
        alert(`Could not import "${f.name}": ${err.message || err}`);
      }
    }
    e.target.value = "";
  };

  return (
    <div>
      <PageHead title="Worlds" sub="Persistent, living settings — locations, NPCs, factions, quests and consequences that carry across sessions. Imports accept world JSON (best-effort Horde .horde_world and Marinara exports too).">
        <input ref={fileRef} type="file" multiple accept=".json,.horde_world" style={{ display: "none" }} onChange={doImport} />
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} /> Import World</button>
        <button className="btn" onClick={() => setOpen("manual")}>Blank World</button>
      </PageHead>

      <AICreator
        title="AI World Builder"
        placeholder="e.g. A drowned steampunk city where the tides decide who rules"
        chips={[
          "A fantasy kingdom on the eve of a magical plague",
          "Cyberpunk megacity run by corporate guilds",
          "Cozy fantasy village full of secrets",
          "Post-apocalyptic caravan nation crossing a wasteland",
        ]}
        onGenerate={async (idea, opts) => {
          const w = await generateWorld(activeProfile("text"), idea, opts);
          add("worlds", w);
        }}
      />

      {state.worlds.length === 0 ? (
        <Empty icon="globe" title="No worlds yet">
          Generate one with a single line above, or build it manually.
        </Empty>
      ) : (
        <div className="grid cards">
          {state.worlds.map((w) => (
            <div key={w.id} className="card cover-card hoverable" onClick={() => setOpen(w)}>
              <CoverImage
                value={w.background}
                onChange={(img) => patch("worlds", w.id, { background: img })}
                category="backgrounds"
                prompt={`${w.name}, ${w.genre || ""} — ${w.tagline || w.description || ""}`}
                alt={w.name}
              />
              <div className="cover-body">
                <div className="cover-title">{w.name}</div>
                <div className="muted clamp-6" style={{ fontSize: 13 }}>{w.description || w.tagline}</div>
                <div className="faint">
                  {[w.genre, `${w.locations?.length || 0} locations`, `${w.npcs?.length || 0} NPCs`, `${w.quests?.length || 0} quests`]
                    .filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn sm primary" style={{ flex: 1 }} onClick={() => playWorld(w.id)}>Enter World →</button>
                <button className="btn sm" onClick={() => setOpen(w)}>Edit</button>
                <button className="btn sm" onClick={() => downloadJSON(w, `${w.name.replace(/[^\w-]+/g, "_")}-world.json`)}>Export</button>
                <DeleteButton
                  what="world"
                  name={w.name}
                  impact={impactSummary(deletionImpact("worlds", w.id))}
                  onConfirm={() => removeCascade("worlds", w.id)}
                  label=""
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <WorldEditor world={open === "manual" ? null : open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function WorldEditor({ world, onClose }) {
  const { state, activeProfile, add, patch } = useStore();
  const [w, setW] = useState(() => {
    // worlds saved before a feature shipped may miss newer fields — normalize
    // here or editing crashes on the missing arrays
    if (world) {
      return {
        ...world,
        locations: (world.locations || []).map((l) => ({ pinned: false, ...l })),
        npcs: (world.npcs || []).map((n) => ({ linked: undefined, ...n })),
        factions: world.factions || [],
        items: world.items || [],
        quests: world.quests || [],
      };
    }
    return {
      id: uid(), name: "", genre: "Fantasy", tagline: "", description: "",
      locations: [], npcs: [], factions: [], items: [], quests: [],
      startLocation: "", timeOfDay: "morning", weather: "clear", createdAt: Date.now(),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idea, setIdea] = useState("");
  const set = (k, v) => setW((x) => ({ ...x, [k]: v }));

  const save = () => {
    if (world) patch("worlds", world.id, w);
    else add("worlds", w);
    onClose();
  };

  const aiExpand = async () => {
    if (!idea.trim()) return;
    setBusy(true); setError("");
    const worldId = w.id;
    try {
      // detached: finishing after the editor closes is fine — the content is
      // queued and merged the next time this world is opened in the studio
      const gen = await runDetached(`World fill: ${idea.trim().slice(0, 60)}`,
        generateWorld(activeProfile("text"), idea));
      worldFillPending.set(worldId, gen);
      genbus.emit({ type: "world-fill", id: worldId });
      setW((x) => mergeWorldGen(x, gen));
      worldFillPending.delete(worldId);
      setIdea("");
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  // apply AI Fill results that arrived while the editor was closed
  React.useEffect(() => {
    const pending = worldFillPending.get(w.id);
    if (pending) {
      setW((x) => mergeWorldGen(x, pending));
      worldFillPending.delete(w.id);
    }
    return genbus.subscribe((ev) => {
      if (ev.type === "world-fill" && ev.id === w.id) {
        const gen = worldFillPending.get(w.id);
        if (gen) {
          setW((x) => mergeWorldGen(x, gen));
          worldFillPending.delete(w.id);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.id]);

  const addList = (key, item) => set(key, [...w[key], item]);
  const patchList = (key, i, p) =>
    set(key, w[key].map((x, j) => (j === i ? { ...x, ...p } : x)));
  const rmList = (key, i) => set(key, w[key].filter((_, j) => j !== i));

  /* ---- name matching against your existing cast ---- */
  const [suggestions, setSuggestions] = useState({});
  const dismissedRef = React.useRef(new Set());

  const adoptCast = (npcIdx, m) => {
    const patch = m.kind === "character"
      ? { name: m.name, personality: m.src.personality || m.src.appearance || "", role: (m.src.tags || [])[0] || "imported", goal: (m.src.scenario || "").slice(0, 90) }
      : { name: m.name, role: m.src.occupation || "", location: m.src.location || "", personality: m.src.personality || "", schedule: (m.src.routine || []).join("; ") };
    patchList("npcs", npcIdx, { ...patch, linked: { kind: m.kind, id: m.id, name: m.name } });
    dismissedRef.current.add(m.id);
    setSuggestions((s0) => ({ ...s0, [npcIdx]: (s0[npcIdx] || []).filter((x) => x.id !== m.id) }));
  };
  const dismissSuggestion = (npcIdx, id) => {
    dismissedRef.current.add(id);
    setSuggestions((s0) => ({ ...s0, [npcIdx]: (s0[npcIdx] || []).filter((x) => x.id !== id) }));
  };
  const suggestFor = (npcIdx, name) => {
    const q = String(name || "").trim();
    if (q.length < 3) { setSuggestions((s0) => ({ ...s0, [npcIdx]: [] })); return; }
    const pool = [
      ...state.characters.map((c) => ({ ...c, kind: "character" })),
      ...state.virtualHumans.map((v) => ({ ...v, kind: "virtual human" })),
    ];
    const taken = new Set(w.npcs.map((n) => n.linked?.id).filter(Boolean));
    const matches = pool
      .filter((c) => !taken.has(c.id) && !dismissedRef.current.has(c.id))
      .map((c) => ({ id: c.id, kind: c.kind, name: c.name, src: c, score: nameSimilarity(q, c.name) }))
      .filter((m) => m.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    setSuggestions((s0) => ({ ...s0, [npcIdx]: matches }));
  };

  return (
    <Modal title={world ? `World Studio — ${w.name || "Untitled"}` : "New World"} onClose={onClose} wide>
      <div className="ai-panel mb">
        <div className="row">
          <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Minimum suggestion: one line and the AI fills in locations, NPCs, factions, quests…" />
          <button className="btn primary" onClick={aiExpand} disabled={busy}>{busy ? "Generating…" : "AI Fill"}</button>
        </div>
        {busy && <div className="thinking mt">Filling the world</div>}
        {error && <div className="mt" style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>}
      </div>

      <div className="grid cols-2">
        <div>
          <Field label="Name"><input value={w.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Genre"><input value={w.genre} onChange={(e) => set("genre", e.target.value)} /></Field>
          <Field label="Tagline"><input value={w.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          <Field label="Description"><textarea rows={4} value={w.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Starting location">
            <select value={w.startLocation} onChange={(e) => set("startLocation", e.target.value)}>
              <option value="">— none —</option>
              {w.locations.map((l, i) => <option key={i} value={l.name}>{l.name}</option>)}
            </select>
          </Field>
          <div className="row">
            <div className="grow">
              <Field label="Time of day">
                <select value={w.timeOfDay} onChange={(e) => set("timeOfDay", e.target.value)}>
                  {["dawn", "morning", "midday", "afternoon", "evening", "night"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <div className="grow">
              <Field label="Weather">
                <select value={w.weather} onChange={(e) => set("weather", e.target.value)}>
                  {["clear", "cloudy", "rain", "storm", "snow", "fog"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </div>
        <div>
          <SubList title="Locations" icon="pin" items={w.locations} onAdd={() => addList("locations", { name: "", type: "city", description: "", mood: "", pinned: false })}
            render={(l, i) => (
              <div>
                <div className="row">
                  <input className="grow" value={l.name} placeholder="Name" onChange={(e) => patchList("locations", i, { name: e.target.value })} />
                  <select style={{ width: 110 }} value={l.type} onChange={(e) => patchList("locations", i, { type: e.target.value })}>
                    {["city", "town", "wilderness", "dungeon", "building", "landmark", "planet"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <button className="btn sm" title={l.pinned ? "Unpin location" : "Pin location (shown in play HUD)"}
                    style={l.pinned ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
                    onClick={() => patchList("locations", i, { pinned: !l.pinned })}>
                    <Icon name="pin" size={12} />
                  </button>
                  <button className="btn sm danger" onClick={() => rmList("locations", i)}>×</button>
                </div>
              </div>
            )} />
          <SubList title="NPCs" icon="user" items={w.npcs} onAdd={() => addList("npcs", { name: "", role: "", location: "", personality: "", goal: "", secret: "", schedule: "" })}
            render={(n, i) => (
              <div>
                <div className="row">
                  <input className="grow" value={n.name} placeholder="Name (matches your cast — try an existing name)"
                    onChange={(e) => { patchList("npcs", i, { name: e.target.value }); suggestFor(i, e.target.value); }} />
                  <input className="grow" value={n.role} placeholder="Role" onChange={(e) => patchList("npcs", i, { role: e.target.value })} />
                  <button className="btn sm danger" onClick={() => rmList("npcs", i)}>×</button>
                </div>
                <div className="row mt">
                  <input className="grow" value={n.goal} placeholder="Goal" onChange={(e) => patchList("npcs", i, { goal: e.target.value })} />
                  <input className="grow" value={n.secret} placeholder="Secret" onChange={(e) => patchList("npcs", i, { secret: e.target.value })} />
                </div>
                {(suggestions[i] || []).map((m) => (
                  <div key={m.id} className="row mt" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    <span>Looks like <b style={{ color: "var(--accent)" }}>{m.name}</b> ({m.kind}) — use their details?</span>
                    <button className="btn sm primary" onClick={() => adoptCast(i, m)}>Use {m.kind}</button>
                    <button className="btn sm ghost" onClick={() => dismissSuggestion(i, m.id)}>Dismiss</button>
                  </div>
                ))}
              </div>
            )} />
        </div>
      </div>

      <div className="ai-panel mt">
        <div className="row">
          <h3 style={{ margin: 0 }}>World Background Illustration</h3>
          <div className="spacer" style={{ flex: 1 }} />
          <ImagePicker
            category="backgrounds"
            kind="cover"
            value={w.background?.dataURL}
            prompt={`${w.name}, ${w.genre} style — ${w.tagline || w.description}`}
            onChange={(img) => set("background", img)}
            label={w.background?.dataURL ? "Upload or remove" : "Upload image"}
          />
        </div>
        <ImageGen
          category="backgrounds"
          kind="background"
          initialPrompt={
            w.startLocation
              ? `${w.startLocation} in ${w.name}, ${w.genre} style — ${w.tagline || w.description}`
              : `${w.name}, ${w.genre} style — ${w.tagline || w.description}`
          }
          value={w.background?.dataURL || null}
          onGenerated={(img) => set("background", img)}
        />
      </div>

      <div className="grid cols-2 mt">
        <SubList title="Factions" icon="sword" items={w.factions} onAdd={() => addList("factions", { name: "", attitude: "neutral", description: "" })}
          render={(f, i) => (
            <div className="row">
              <input className="grow" value={f.name} placeholder="Name" onChange={(e) => patchList("factions", i, { name: e.target.value })} />
              <select style={{ width: 100 }} value={f.attitude} onChange={(e) => patchList("factions", i, { attitude: e.target.value })}>
                {["friendly", "neutral", "hostile"].map((t) => <option key={t}>{t}</option>)}
              </select>
              <button className="btn sm danger" onClick={() => rmList("factions", i)}>×</button>
            </div>
          )} />
        <SubList title="Items" icon="package" items={w.items} onAdd={() => addList("items", { name: "", type: "tool", description: "" })}
          render={(it, i) => (
            <div className="row">
              <input className="grow" value={it.name} placeholder="Name" onChange={(e) => patchList("items", i, { name: e.target.value })} />
              <select style={{ width: 120 }} value={it.type} onChange={(e) => patchList("items", i, { type: e.target.value })}>
                {ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <button className="btn sm danger" onClick={() => rmList("items", i)}>×</button>
            </div>
          )} />
      </div>

      <SubList mt title="Quests" icon="target" items={w.quests} onAdd={() => addList("quests", { title: "", description: "", status: "open" })}
        render={(q, i) => (
          <div className="row">
            <input className="grow" value={q.title} placeholder="Title" onChange={(e) => patchList("quests", i, { title: e.target.value })} />
            <select style={{ width: 100 }} value={q.status} onChange={(e) => patchList("quests", i, { status: e.target.value })}>
              {["open", "active", "done", "failed"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="btn sm danger" onClick={() => rmList("quests", i)}>×</button>
          </div>
        )} />

      <div className="row mt">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!w.name.trim()}>Save World</button>
      </div>
    </Modal>
  );
}

function SubList({ title, icon, items, onAdd, render, mt }) {
  return (
    <div style={mt ? { marginTop: 14 } : undefined}>
      <div className="row mb">
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}><Icon name={icon} size={11} style={{ color: "var(--accent)" }} /> {title} ({items.length})</h3>
        <div className="spacer" />
        <button className="btn sm" onClick={onAdd}>Add</button>
      </div>
      {items.map((_, i) => <div key={i} className="mb">{render(items[i], i)}</div>)}
    </div>
  );
}
