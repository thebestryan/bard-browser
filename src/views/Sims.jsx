import React, { useState } from "react";
import { uid, useStore } from "../store";
import { AICreator, Avatar, CoverImage, DeleteButton, Empty, Field, ImagePicker, Modal, PageHead, ProfileCard, RefPhotos } from "../components/UI";
import { generatePersona, generateScenario, generateVirtualHuman } from "../lib/ai";
import {
  ensureVH,
  activeTimeline,
  currentActivity,
  presenceOf,
  moodLabel,
  replyDelay,
  generateVHReply,
  generateAutonomousMessage,
  applySentiment,
  wantsToMessage,
  catchUpCount,
  newTimeline,
} from "../lib/vh";
import { integrateMemories } from "../lib/memory";
import Icon from "../components/Icon";

export function Personas() {
  const { state, add, remove, activeProfile } = useStore();
  const [edit, setEdit] = useState(null);

  return (
    <div>
      <PageHead title="Personas" sub="Who you are in every story — description, traits and voice." />
      <AICreator
        title="AI Persona Creator"
        placeholder="e.g. A curious cartographer who always gets lost"
        chips={["Retired pirate turned baker", "Detective with insomnia", "Ordinary student, extraordinary luck"]}
        onGenerate={async (idea) => {
          const p = await generatePersona(activeProfile("text"), idea);
          add("personas", p);
        }}
      />
      {state.personas.length === 0 ? (
        <Empty icon="user" title="No personas yet">Create one for yourself — or let the AI.</Empty>
      ) : (
        <div className="grid cards">
          {state.personas.map((p) => (
            <ProfileCard
              key={p.id}
              name={p.name}
              image={p.image?.dataURL}
              meta={(p.traits || []).slice(0, 3).join(" · ") || undefined}
              description={p.description}
              onClick={() => setEdit(p)}
              actions={
                <>
                  <button className="btn sm" onClick={() => setEdit(p)}>Edit</button>
                  <DeleteButton what="persona" name={p.name} onConfirm={() => remove("personas", p.id)} />
                </>
              }
            />
          ))}
        </div>
      )}
      {edit && <PersonaEditor p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PersonaEditor({ p, onClose }) {
  const { patch } = useStore();
  const [x, setX] = useState(p);
  const set = (k, v) => setX((o) => ({ ...o, [k]: v }));
  return (
    <Modal title={`Edit — ${x.name}`} onClose={onClose}>
      <div className="profile-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <Avatar name={x.name} src={x.image?.dataURL} size={96} />
          <ImagePicker
            align="left"
            category="personas"
            kind="persona"
            refs={x.refs || []}
            value={x.image?.dataURL}
            prompt={`Portrait of ${x.name || "a person"}: ${x.description || ""}`}
            onChange={(img) => set("image", img)}
            label={x.image?.dataURL ? "Change" : "Add image"}
          />
        </div>
        <div className="who"><Field label="Name"><input value={x.name} onChange={(e) => set("name", e.target.value)} /></Field></div>
      </div>
      <Field label="Description"><textarea rows={4} value={x.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Traits (comma separated)"><input value={(x.traits || []).join(", ")} onChange={(e) => set("traits", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></Field>
      <Field label="Voice / speech style"><input value={x.voice || ""} onChange={(e) => set("voice", e.target.value)} /></Field>
      <label>Reference photos (model sheet — face, body, sides)</label>
      <RefPhotos refs={x.refs || []} category="personas" onChange={(refs) => set("refs", refs)} />
      <div className="row mt">
        <div className="spacer" />
        <button className="btn primary" onClick={() => { patch("personas", p.id, x); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

export function Scenarios() {
  const { state, add, remove, activeProfile } = useStore();

  return (
    <div>
      <PageHead title="Scenarios" sub="Ready-to-play story setups you can drop any characters into." />
      <AICreator
        title="AI Scenario Creator"
        placeholder="e.g. Trapped in an elevator during a citywide blackout"
        chips={["A murder mystery on a night train", "First contact gone sideways", "The heist that never was"]}
        onGenerate={async (idea) => {
          const s = await generateScenario(activeProfile("text"), idea);
          add("scenarios", s);
        }}
      />
      {state.scenarios.length === 0 ? (
        <Empty icon="film" title="No scenarios yet">Describe a setup in one line — the AI writes the opening.</Empty>
      ) : (
        <div className="grid cols-2">
          {state.scenarios.map((s) => (
            <div key={s.id} className="card">
              <div className="row">
                <Icon name="film" size={20} style={{ color: "var(--accent)" }} />
                <div className="grow" style={{ fontWeight: 650 }}>{s.title}</div>
                <button className="btn sm danger" onClick={() => remove("scenarios", s.id)}>×</button>
              </div>
              <div className="muted mt" style={{ fontSize: 12 }}>{s.summary}</div>
              {s.opening && <div className="card mt" style={{ padding: 10, fontSize: 12, fontStyle: "italic" }}>{s.opening}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VirtualHumans() {
  const { state, add, patch, remove, removeCascade, activeProfile } = useStore();
  const [openVH, setOpenVH] = useState(null);

  // normalize older saves (messages → timelines)
  React.useEffect(() => {
    for (const v of state.virtualHumans) {
      if (!v.timelines) patch("virtualHumans", v.id, ensureVH(v));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.virtualHumans.length]);

  if (openVH) {
    const vh = state.virtualHumans.find((v) => v.id === openVH);
    if (vh) return <VHChat vhId={vh.id} back={() => setOpenVH(null)} />;
  }

  return (
    <div>
      <PageHead title="Virtual Humans" sub="People with routines, moods, memories and a life beyond the chat. Open one to text them — they reply on their own schedule, message unprompted, and remember across timelines." />
      <AICreator
        title="AI Virtual Human Creator"
        placeholder="e.g. A night-shift nurse in a rain-soaked port town who texts at odd hours"
        chips={["Freelance artist with a chaotic schedule", "Bakery owner who rises at 4am", "Long-haul trucker always somewhere new"]}
        onGenerate={async (idea, opts) => {
          const v = await generateVirtualHuman(activeProfile("text"), idea, opts);
          add("virtualHumans", ensureVH(v));
        }}
      />
      {state.virtualHumans.length === 0 ? (
        <Empty icon="users" title="No virtual humans yet">
          They keep their own clock, mood, routines and memories — autonomously messaging on their schedule.
        </Empty>
      ) : (
        <div className="grid cards">
          {state.virtualHumans.map((v0) => {
            const v = v0.timelines ? v0 : ensureVH(v0);
            const tl = activeTimeline(v);
            const act = currentActivity(v);
            const pres = presenceOf(v);
            const last = tl.messages[tl.messages.length - 1];
            return (
            <ProfileCard
              key={v.id}
              name={v.name}
              image={v.photo?.dataURL}
              status={pres.key}
              statusLabel={pres.label}
              meta={[v.age, v.occupation].filter(Boolean).join(" · ") || undefined}
              description={v.personality}
              chips={[
                act.busy ? act.label : "free right now",
                `Mood: ${moodLabel(tl.mood)}`,
                `Trust: ${tl.trust > 0 ? "+" : ""}${tl.trust}`,
                last?.role === "vh" ? "Awaiting your reply" : null,
              ]}
              preview={last ? `${last.role === "user" ? "You: " : ""}${last.text}` : ""}
              onClick={() => setOpenVH(v.id)}
              actions={
                <>
                  <button className="btn sm primary" onClick={() => setOpenVH(v.id)}>Open chat</button>
                  <ImagePicker
                    category="virtualhumans"
                    kind="photo"
                    refs={v.refs || []}
                    value={v.photo?.dataURL}
                    prompt={`Candid photo of ${v.name}, ${v.age || ""} ${v.occupation || ""} in ${v.location || ""}. ${v.personality || ""}`}
                    onChange={(img) => patch("virtualHumans", v.id, { photo: img })}
                    label="Photo"
                  />
                  <DeleteButton what="virtual human" name={v.name} onConfirm={() => removeCascade("virtualHumans", v.id)} />
                </>
              }
              // reference photos panel
              extra={
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <div className="micro" style={{ marginBottom: 6 }}>Reference photos</div>
                  <RefPhotos refs={v.refs || []} category="virtualhumans" onChange={(refs) => patch("virtualHumans", v.id, { refs })} />
                </div>
              }
            />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================= VH Chat — texting a person with a life ================= */

function VHChat({ vhId, back }) {
  const { state, patch, activeProfile } = useStore();
  const vh0 = state.virtualHumans.find((v) => v.id === vhId);
  const vh = vh0 ? ensureVH(vh0) : null;
  const profile = activeProfile("text");
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [clock, setClock] = useState(Date.now()); // re-render so activity stays live
  const logRef = React.useRef(null);
  const stateRef = React.useRef(state); // always-fresh state for async callbacks
  stateRef.current = state;
  const aliveRef = React.useRef(true);
  React.useEffect(() => () => { aliveRef.current = false; }, []);

  const tl = vh ? activeTimeline(vh) : null;
  const act = vh ? currentActivity(vh, new Date(clock)) : null;

  /** Apply a change to the CURRENT timeline of the LATEST state. */
  const patchLatest = (fn) => {
    const cur = ensureVH(stateRef.current.virtualHumans.find((v) => v.id === vhId));
    if (!cur) return;
    const t = activeTimeline(cur);
    const timelines = cur.timelines.map((x) => (x.id === t.id ? fn({ ...x }) : x));
    patch("virtualHumans", cur.id, { timelines });
  };
  const pushMsg = (msg) =>
    patchLatest((t) => ({ ...t, messages: [...t.messages, { ...msg, id: msg.id || uid(), ts: msg.ts || Date.now() }] }));

  // clock re-render + autonomous messages
  React.useEffect(() => {
    const iv = setInterval(() => setClock(Date.now()), 20000);
    const auto = setInterval(async () => {
      const fresh = ensureVH(stateRef.current.virtualHumans.find((v) => v.id === vhId));
      if (!fresh) return;
      const t = activeTimeline(fresh);
      const last = t.messages[t.messages.length - 1];
      if (wantsToMessage(fresh, t, last?.ts)) {
        const text = await generateAutonomousMessage({ vh: fresh, timeline: t, profile });
        if (aliveRef.current) pushMsg({ role: "vh", text, autonomous: true });
      }
    }, 45000);
    return () => { clearInterval(iv); clearInterval(auto); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vhId]);

  // while-away catch-up on open
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise((r) => setTimeout(r, 600));
      const fresh = ensureVH(stateRef.current.virtualHumans.find((v) => v.id === vhId));
      if (!fresh) return;
      const t = activeTimeline(fresh);
      const last = t.messages[t.messages.length - 1];
      const n = catchUpCount(fresh, t, last?.ts);
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1200 + i * 1800));
        if (cancelled || !aliveRef.current) return;
        // eslint-disable-next-line no-await-in-loop
        const text = await generateAutonomousMessage({ vh: fresh, timeline: t, profile });
        pushMsg({ role: "vh", text, autonomous: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vhId]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [tl?.messages, typing]);

  if (!vh || !tl) return <div className="content">Virtual Human not found.</div>;

  const send = async () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput("");
    const userMsg = { role: "user", text };
    pushMsg(userMsg);
    // sentiment → mood/trust + relationship memories (applied on latest state)
    patchLatest((t) => {
      const withUser = { ...t, messages: [...t.messages, { ...userMsg, id: uid(), ts: Date.now() }] };
      return applySentiment(withUser, text);
    });

    setTyping(true);
    const delay = replyDelay(vh, tl);
    generateVHReply({ vh, timeline: tl, userText: text, profile })
      .then((reply) => {
        setTimeout(() => {
          if (!aliveRef.current) return;
          setTyping(false);
          patchLatest((t) => {
            let next = { ...t, messages: [...t.messages, { id: uid(), role: "vh", text: reply, ts: Date.now() }] };
            if (Math.random() < 0.35) {
              next.memories = integrateMemories(next.memories || [], [{ text: `Talked about: ${text.slice(0, 60)}`, type: "scene", importance: 1, source: "conversation" }]).memories;
            }
            return next;
          });
        }, Math.max(800, delay * 0.4));
      })
      .catch((e) => {
        if (aliveRef.current) {
          setTyping(false);
          pushMsg({ role: "vh", text: "Error: " + (e.message || e) });
        }
      });
  };

  return (
    <div className="chat-wrap" style={{ height: "100%" }}>
      <div className="chat-pane">
        <div className="topbar" style={{ gap: 12 }}>
          <button className="btn sm ghost" onClick={back}><Icon name="back" size={13} /></button>
          <Avatar name={vh.name} src={vh.photo?.dataURL} size={34} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650 }}>{vh.name} <span className="faint">· {act.label}</span></div>
            <div className="row" style={{ gap: 8, fontSize: 11 }}>
              <span className="tag accent">feeling {moodLabel(tl.mood)}</span>
              <span className="faint">trust</span>
              <span className="bar" style={{ width: 80, height: 4, background: "var(--bg-input)", borderRadius: 2, display: "inline-block" }}>
                <i style={{ display: "block", height: "100%", width: `${(tl.trust + 100) / 2}%`, background: "linear-gradient(90deg,var(--red),var(--green))", borderRadius: 2 }} />
              </span>
            </div>
          </div>
          <select style={{ width: 150, fontSize: 12 }} value={tl.id}
            onChange={(e) => patch("virtualHumans", vh.id, { activeTimelineId: e.target.value })}>
            {vh.timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn sm" title="Fork this timeline (keeps history)" onClick={() => {
            const t = { ...tl, id: uid(), name: `${tl.name} (fork)`, createdAt: Date.now() };
            patch("virtualHumans", vh.id, { timelines: [...vh.timelines, t], activeTimelineId: t.id });
          }}>Fork</button>
          <button className="btn sm" title="Start a fresh timeline" onClick={() => {
            const t = newTimeline(`Fresh ${vh.timelines.length}`);
            patch("virtualHumans", vh.id, { timelines: [...vh.timelines, t], activeTimelineId: t.id });
          }}>New</button>
        </div>

        <div className="chat-log" ref={logRef}>
          {tl.messages.length === 0 && (
            <div className="faint" style={{ textAlign: "center" }}>
              {vh.name} is {act.label.toLowerCase()}. Messages arrive on their schedule.
            </div>
          )}
          {tl.messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === "user" ? "user" : ""}`} style={{ maxWidth: "70%" }}>
              <Avatar name={m.role === "user" ? "You" : vh.name} src={m.role === "user" ? null : vh.photo?.dataURL} size={30} />
              <div>
                <div className="bubble" style={{ borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px" }}>{m.text}</div>
                <div className="meta" style={{ flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
                  {new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {m.autonomous && <span className="tag" style={{ fontSize: 9, padding: "0 6px" }}>on their own</span>}
                </div>
              </div>
            </div>
          ))}
          {typing && <div className="thinking">{vh.name} is typing</div>}
        </div>

        <div className="chat-input-bar">
          <div className="box">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <div className="row" style={{ fontSize: 12 }}>
                <span className="micro">Author's note</span>
                <input
                  className="grow"
                  style={{ fontSize: 12 }}
                  value={vh.authorNote?.text || ""}
                  placeholder="Standing instruction for every reply. Macros supported."
                  onChange={(e) => patch("virtualHumans", vh.id, { authorNote: { ...(vh.authorNote || { depth: 4 }), text: e.target.value } })}
                />
              </div>
              <textarea
                rows={2}
                value={input}
                placeholder={`Text ${vh.name}…`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && input.trim()) { e.preventDefault(); send(); } }}
              />
            </div>
            <button className="btn primary" disabled={typing || !input.trim()} onClick={send}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
