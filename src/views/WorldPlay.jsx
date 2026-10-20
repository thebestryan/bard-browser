import React, { useEffect, useRef, useState } from "react";
import { uid, useStore } from "../store";
import { callChat, textParams } from "../lib/ai";
import { integrateMemories, recallMemories } from "../lib/memory";
import { activePreset, assemblePrompt, extractOOC, insertAtDepth, substituteMacros } from "../lib/prompt";
import { mechanicsPromptBlock } from "../lib/mechanics";
import { genderPromptLine, generationDirectives } from "../lib/presets";
import MemoryInspector from "../components/MemoryInspector";
import MechanicsPanel from "../components/MechanicsPanel";
import { Avatar } from "../components/UI";
import Icon from "../components/Icon";

const TIMES = ["dawn", "morning", "midday", "afternoon", "evening", "night"];
const WEATHER = ["clear", "cloudy", "rain", "storm", "snow", "fog"];

/**
 * A play session lives ON the world, not in component state — otherwise the
 * log, clock, weather, meters and inventory are lost the moment you exit.
 */
function defaultSession(world) {
  return {
    log: [],
    events: [],
    inv: [],
    meters: { health: 100, energy: 80, reputation: 50 },
    location: world?.startLocation || "Unknown",
    timeIdx: Math.max(0, TIMES.indexOf(world?.timeOfDay)),
    weather: world?.weather || "clear",
  };
}

export default function WorldPlay({ worldId, exit }) {
  const { state, patch, update, activeProfile } = useStore();
  const world = state.worlds.find((w) => w.id === worldId);
  const persona = state.personas[0];
  const provider = activeProfile("text");
  const params = textParams(state, provider);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [mechOpen, setMechOpen] = useState(false);
  const logRef = useRef(null);
  const abortRef = useRef(null);
  // leaving the world cancels any in-flight narration

  const session = { ...defaultSession(world), ...(world?.session || {}) };
  const { log, events, inv, meters, location, timeIdx, weather } = session;

  /** Functional session update — safe to call several times in one async run. */
  const setSession = (fn) =>
    update((s) => ({
      worlds: s.worlds.map((w) => {
        if (w.id !== worldId) return w;
        const cur = { ...defaultSession(w), ...(w.session || {}) };
        return { ...w, session: { ...cur, ...fn(cur) } };
      }),
    }));

  useEffect(() => {
    if (world && world.memories === undefined) patch("worlds", world.id, { memories: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world?.id, world?.memories === undefined]);

  /** Record a durable world memory (contradictions supersede older ones). */
  const stripOOC = (t) => extractOOC(t).clean.trim();
  const remember = (text) => {
    if (!world || !text) return;
    const { memories } = integrateMemories(world.memories || [], [{ text, type: "state", importance: 2, source: "world" }]);
    patch("worlds", world.id, { memories });
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, busy, streamText]);

  if (!world) return <div className="content">World not found.</div>;

  const pushEvent = (text) =>
    setSession((s) => ({ events: [{ text, time: TIMES[s.timeIdx], id: uid() }, ...s.events].slice(0, 40) }));

  const advanceTime = () => {
    setSession((s) => {
      const n = (s.timeIdx + 1) % TIMES.length;
      const who = world.npcs?.[Math.floor(Math.random() * (world.npcs?.length || 1))]?.name || "Someone";
      const text = `Time advances to ${TIMES[n]}. ${who} is now ${TIMES[n] === "night" ? "asleep" : "awake and about their business"}.`;
      return { timeIdx: n, events: [{ text, time: TIMES[n], id: uid() }, ...s.events].slice(0, 40) };
    });
  };

  const stop = () => abortRef.current?.abort(new Error("Stopped."));

  const send = async (text) => {
    const userMsg = { id: uid(), role: "user", who: persona?.name || "You", text };
    setSession((s) => ({ log: [...s.log, userMsg] }));
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let partial = "";
    try {
      // Same role-keyed blocks as chats, so a preset's section order and its
      // disabled sections apply to narration too.
      const lore = (state.lorebooks || [])
        .flatMap((bk) => bk.entries || [])
        .filter((e) => (e.keys || []).some((k) => k && k.trim() && text.toLowerCase().includes(k.toLowerCase().trim())))
        .map((e) => e.content)
        .join("\n");

      const blocks = {
        system:
          `You are the narrator of a persistent living world.\n` +
          `Stay in scene, track consequences, and let NPC schedules and the world move on their own.`,
        context: [
          `WORLD: ${world.name} (${world.genre}). ${world.description}`,
          `STATE: location=${location}, time=${TIMES[timeIdx]}, weather=${weather}, inventory=${inv.join(", ") || "empty"}.`,
          mechanicsPromptBlock(world.mechanics),
        ].filter((x) => x && String(x).trim()).join("\n"),
        character: `NPCS PRESENT: ${world.npcs?.filter((n) => n.location === location).map((n) => `${n.name} (${n.role}; goal: ${n.goal})`).join("; ") || "none"}`,
        scenario: `Quests: ${world.quests?.filter((q) => q.status !== "done").map((q) => `${q.title} (${q.status})`).join("; ") || "none"}`,
        lore: lore ? `Lore:\n${lore}` : "",
        memory: (world.memories || []).length
          ? `Durable memories (canon):\n${recallMemories(world.memories, text).map((m) => `- ${m.text}`).join("\n")}`
          : "",
        persona: `PLAYER: ${persona?.name || "the player"} — ${persona?.description || "an adventurer"}.${persona?.gender ? ` ${genderPromptLine(persona.gender)}` : ""}`,
        instructions: params.style ? `Style: ${params.style}` : "",
      };
      const ctx = [
        assemblePrompt(blocks, activePreset(state, provider), {
          char: "the narrator",
          user: persona?.name || "the player",
          persona: persona?.description || "",
          scenario: world.name || "",
        }),
        generationDirectives(state),
      ].filter(Boolean).join("\n\n");
      // [[OOC]] side-channel + macros on the player's words
      const { clean, ooc } = extractOOC(text);
      const macroOpts = {
        char: "the narrator",
        user: persona?.name || "the player",
        persona: persona?.description || "",
        description: persona?.description || "",
        scenario: world.name || "",
        scene: world.description || "",
        world: world.description || "",
      };
      const payload = insertAtDepth(
        [
          { role: "system", content: ctx },
          ...log.slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: substituteMacros(stripOOC(m.text), macroOpts) })),
          ...(ooc ? [{ role: "system", content: `(OOC instruction — follow it, but do not repeat it verbatim: ${ooc})` }] : []),
          { role: "user", content: substituteMacros(clean || ooc, macroOpts) },
        ],
        world.authorNote?.text?.trim() ? substituteMacros(world.authorNote.text, macroOpts) : "",
        world.authorNote?.depth ?? 4,
      );
      if (state.jailbreak?.enabled && state.jailbreak.text?.trim()) {
        payload.push({ role: "system", content: state.jailbreak.text.trim() });
      }
      const out = await callChat(provider, payload, {
        ...params,
        signal: ctrl.signal,
        onDelta: (d) => { partial += d; setStreamText((t) => (t || "") + d); },
      });
      setStreamText(null);
      setSession((s) => ({
        log: [...s.log, { id: uid(), role: "assistant", who: "Narrator", text: out.content }],
        // light living-world simulation: meter drift
        meters: {
          health: Math.max(0, s.meters.health - (Math.random() < 0.2 ? 5 : 0)),
          energy: Math.max(0, s.meters.energy - 3),
          reputation: Math.min(100, s.meters.reputation + (Math.random() < 0.3 ? 2 : 0)),
        },
      }));
      if (Math.random() < 0.45) advanceTime();
      if (Math.random() < 0.3) {
        const locs = world.locations || [];
        if (locs.length) {
          const l = locs[Math.floor(Math.random() * locs.length)];
          setSession(() => ({ location: l.name }));
          remember(`Location: ${l.name}`);
          pushEvent(`You find yourself at ${l.name} — ${l.description?.slice(0, 80) || l.mood || ""}`);
        }
      }
    } catch (e) {
      setStreamText(null);
      setSession((s) => ({
        log: [...s.log, ctrl.signal.aborted && partial
          ? { id: uid(), role: "assistant", who: "Narrator", text: partial }
          : { id: uid(), role: "assistant", who: "Error", text: String(e.message || e) }],
      }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="chat-wrap" style={{ height: "100%", position: "relative" }}>
      {world.background?.dataURL && (
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${String(world.background.dataURL).replace(/"/g, '%22')}")`, backgroundSize: "cover", backgroundPosition: "center", opacity: 0.16, pointerEvents: "none" }} />
      )}
      <div className="chat-pane" style={{ position: "relative", background: world.background?.dataURL ? "transparent" : undefined }}>
        <div className="chat-log" ref={logRef}>
          <div className="card" style={{ alignSelf: "center", textAlign: "center", maxWidth: 640 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, letterSpacing: "0.06em", textTransform: "uppercase" }}>{world.name}</div>
            <div className="faint">{world.tagline}</div>
            <div className="muted mt" style={{ fontSize: 12 }}>{world.description}</div>
          </div>
          {log.map((m, i) => (
            <div key={m.id || i} className={`msg ${m.role === "user" ? "user" : ""}`}>
              <Avatar name={m.who} src={m.who === "Narrator" ? null : persona?.image?.dataURL} size={32} />
              <div>
                <div className="bubble">{m.text}</div>
                <div className="meta">{m.who}</div>
              </div>
            </div>
          ))}
          {streamText !== null && (
            <div className="msg">
              <Avatar name="Narrator" size={32} />
              <div><div className="bubble">{streamText}</div><div className="meta">Narrator</div></div>
            </div>
          )}
          {busy && streamText === null && <div className="thinking">The world turns</div>}
        </div>
        <div className="chat-input-bar" style={{ position: "relative", background: "var(--bg-panel)" }}>
          <div className="box">
            <textarea
              rows={2}
              value={input}
              placeholder={`What do you do in ${location}?`}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                  e.preventDefault();
                  send(input.trim());
                }
              }}
            />
            {busy
              ? <button className="btn" onClick={stop} title="Stop generating">Stop</button>
              : <button className="btn primary" disabled={!input.trim()} onClick={() => send(input.trim())}>Send</button>}
            <button className="btn ghost" onClick={exit}>Exit World</button>
          </div>
        </div>
      </div>

      <div className="hud">
        <div className="hud-section">
          <h3>Location — {location}</h3>
          {(() => {
            const loc = (world.locations || []).find((l) => l.name === location);
            const pinned = (world.locations || []).filter((l) => l.pinned && l.name !== location);
            return (
              <>
                {loc?.type === "planet" && <div className="micro" style={{ color: "var(--accent-2)" }}>Planet</div>}
                {pinned.length > 0 && (
                  <div className="row wrap mt">
                    {pinned.map((l) => (
                      <button key={l.id || l.name} className="chip" title={l.type === "planet" ? "Planet" : "Pinned location"}
                        onClick={() => { setSession(() => ({ location: l.name })); remember(`Location: ${l.name}`); }}>
                        <Icon name="pin" size={10} /> {l.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
          <div className="row">
            <span className="tag accent">{TIMES[timeIdx]}</span>
            <select style={{ width: 100, fontSize: 12 }} value={weather} onChange={(e) => { const w = e.target.value; setSession(() => ({ weather: w })); pushEvent(`Weather shifts: ${w}.`); remember(`Weather: ${w}`); }}>
              {WEATHER.map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>

        <div className="hud-section">
          <h3>Vitals</h3>
          {Object.entries(meters).map(([k, v]) => (
            <div className="stat-line" key={k}>
              <span style={{ width: 70, textTransform: "capitalize" }}>{k}</span>
              <span className="bar"><i style={{ width: `${v}%` }} /></span>
              <span className="faint">{v}</span>
            </div>
          ))}
        </div>

        <div className="hud-section">
          <h3>Inventory ({inv.length})</h3>
          <div className="row wrap">
            {inv.map((it, i) => <span key={i} className="tag">{it}</span>)}
            {inv.length === 0 && <span className="faint">Empty — pick things up as you play.</span>}
          </div>
          {(world.items || []).length > 0 && (
            <div className="row wrap mt">
              {world.items.map((it, i) => (
                <button key={i} className="chip" onClick={() => { if (!inv.includes(it.name)) { setSession((s) => ({ inv: [...s.inv, it.name] })); pushEvent(`Acquired ${it.name} (${it.type}).`); } }}>
                  + {it.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hud-section">
          <h3>Quests</h3>
          {(world.quests || []).filter((q) => q.status !== "done").map((q, i) => (
            <div key={i} className="mb" style={{ fontSize: 12 }}>
              <b>{q.title}</b> <span className="badge amber">{q.status}</span>
              <div className="faint">{q.description}</div>
            </div>
          ))}
          {(world.quests || []).length === 0 && <span className="faint">No active quests.</span>}
        </div>

        <div className="hud-section">
          <h3>World Events</h3>
          <div className="event-log">
            {events.map((e) => (
              <div key={e.id} className="ev">
                <div className="t">{e.time}</div>
                {e.text}
              </div>
            ))}
            {events.length === 0 && <span className="faint">The world stirs as you play…</span>}
          </div>
        </div>

        <div className="hud-section">
          <h3>Author's Note</h3>
          <textarea
            rows={3}
            value={world.authorNote?.text || ""}
            placeholder="Standing instruction for every narration. Macros supported."
            onChange={(e) => patch("worlds", world.id, { authorNote: { ...(world.authorNote || { depth: 4 }), text: e.target.value } })}
          />
          <div className="row mt" style={{ fontSize: 11 }}>
            <span className="faint">Depth {world.authorNote?.depth ?? 4}</span>
            <input
              type="range" min="0" max="10" step="1" value={world.authorNote?.depth ?? 4}
              style={{ flex: 1, accentColor: "var(--accent)" }}
              onChange={(e) => patch("worlds", world.id, { authorNote: { ...(world.authorNote || { text: "" }), depth: parseInt(e.target.value) } })}
            />
          </div>
        </div>

        <div className="hud-section">
          <h3>Story Memory</h3>
          <div style={{ fontSize: 12 }}>
            {(world.memories || []).filter((m) => !m.superseded && !m.archived).length} active memories
          </div>
          <button className="btn sm mt" onClick={() => setMemoryOpen(true)}>Open Memory Inspector</button>
        </div>

        <div className="hud-section">
          <h3>RPG Mechanics</h3>
          <div style={{ fontSize: 12 }}>
            {world.mechanics?.mode && world.mechanics.mode !== "off"
              ? `Mode: ${world.mechanics.mode} · party HP: ${world.mechanics.party?.map((p) => p.hp).join("/") || "—"}`
              : "Off — pure narrative."}
          </div>
          <button className="btn sm mt" onClick={() => setMechOpen(true)}>Open Mechanics</button>
        </div>
      </div>

      {memoryOpen && <MemoryInspector owner={{ collection: "worlds", id: world.id }} onClose={() => setMemoryOpen(false)} />}
      {mechOpen && <MechanicsPanel collection="worlds" id={world.id} onClose={() => setMechOpen(false)} />}
    </div>
  );
}
