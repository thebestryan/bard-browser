import React, { useState } from "react";
import { uid, useStore } from "../store";
import { AICreator, DeleteButton, Empty, Field, Modal, PageHead } from "../components/UI";
import { impactSummary } from "../lib/cascade";
import { generateLorebook, generatePreset } from "../lib/ai";
import { fromSTPreset, toSTPreset, downloadJSON } from "../lib/stio";
import {
  DEFAULT_SECTIONS, ROLE_LABEL, ROLE_DESCRIPTION, ROLE_NONE, SECTION_ROLES,
  newSection, profilesUsingPreset, previewBlocks, assemblePrompt, unplacedRoles, normalizePreset,
} from "../lib/prompt";
import Icon from "../components/Icon";

/** Clearing a number input yields "" -> NaN, which serializes to null. */
const num = (v, fallback) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);

export function Lorebooks() {
  const { state, add, activeProfile, removeCascade } = useStore();
  const [edit, setEdit] = useState(null);

  return (
    <div>
      <PageHead title="Lorebooks" sub="Keyword-triggered world info injected into chats when keywords appear." />
      <AICreator
        title="AI Lorebook Maker"
        placeholder="e.g. Lore for my drowned steampunk city: tides, guilds, ancient machines"
        chips={["Space station factions", "Vampire court politics", "Desert caravan trade routes"]}
        onGenerate={async (idea, opts) => {
          const b = await generateLorebook(activeProfile("text"), idea, opts);
          add("lorebooks", b);
        }}
      />
      {state.lorebooks.length === 0 ? (
        <Empty icon="book" title="No lorebooks yet">The AI fills entries with trigger keys from a one-line idea.</Empty>
      ) : (
        <div className="grid cols-2">
          {state.lorebooks.map((b) => (
            <div key={b.id} className="card">
              <div className="row">
                <Icon name="book" size={20} style={{ color: "var(--accent)" }} />
                <div className="grow" style={{ fontWeight: 650 }}>{b.name}</div>
                <button className="btn sm" onClick={() => setEdit(b)}>Edit</button>
                <DeleteButton what="lorebook" name={b.name} onConfirm={() => removeCascade("lorebooks", b.id)} label="" />
              </div>
              <div className="faint mt">{b.entries?.length || 0} entries</div>
              {(b.entries || []).slice(0, 3).map((e, i) => (
                <div key={i} className="row mt" style={{ fontSize: 12 }}>
                  {(e.keys || []).map((k) => <span key={k} className="tag">{k}</span>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {edit && <LorebookEditor b={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function LorebookEditor({ b, onClose }) {
  const { patch } = useStore();
  const [x, setX] = useState(b);
  const setEntries = (e) => setX((o) => ({ ...o, entries: e }));
  return (
    <Modal title={`Lorebook — ${x.name}`} onClose={onClose}>
      <Field label="Name"><input value={x.name} onChange={(e) => setX((o) => ({ ...o, name: e.target.value }))} /></Field>
      <h3 className="mt">Entries</h3>
      {(x.entries || []).map((e, i) => (
        <div key={i} className="card mb" style={{ padding: 10 }}>
          <div className="row">
            <input className="grow" value={(e.keys || []).join(", ")} placeholder="Trigger keys, comma separated"
              onChange={(ev) => { const n = [...x.entries]; n[i] = { ...e, keys: ev.target.value.split(",").map((s) => s.trim()).filter(Boolean) }; setEntries(n); }} />
            <button className="btn sm danger" onClick={() => setEntries(x.entries.filter((_, j) => j !== i))}>×</button>
          </div>
          <textarea className="mt" rows={2} value={e.content} placeholder="Lore content injected when a key appears"
            onChange={(ev) => { const n = [...x.entries]; n[i] = { ...e, content: ev.target.value }; setEntries(n); }} />
        </div>
      ))}
      <button className="btn sm" onClick={() => setEntries([...(x.entries || []), { keys: [], content: "", priority: 1 }])}>Add entry</button>
      <div className="row mt">
        <div className="spacer" />
        <button className="btn primary" onClick={() => { patch("lorebooks", b.id, x); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

export function Presets() {
  const { state, add, activeProfile, patchProfile, removeCascade, deletionImpact } = useStore();
  const fileRef = React.useRef(null);
  const [edit, setEdit] = React.useState(null);
  const textProfile = activeProfile("text");

  const doImport = async (e) => {
    for (const f of e.target.files || []) {
      try {
        const p = normalizePreset(fromSTPreset(JSON.parse(await f.text()), f.name));
        add("presets", p);
      } catch (err) {
        alert(`Could not import "${f.name}": ${err.message || err}`);
      }
    }
    e.target.value = "";
  };

  return (
    <div>
      <PageHead title="Presets" sub={`Prompt section ordering + generation parameters, per style of play. A preset takes effect by being linked to a text connection profile — the active one is "${textProfile?.name || "none"}". Exports use SillyTavern chat-completion preset format.`}>
        <input ref={fileRef} type="file" multiple accept=".json" style={{ display: "none" }} onChange={doImport} />
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} /> Import ST Preset</button>
        <button className="btn" onClick={() => setEdit("manual")}>＋ Blank Preset</button>
      </PageHead>
      <AICreator
        title="AI Preset Builder"
        placeholder="e.g. A cinematic, slow-burn roleplay preset with strong memory"
        chips={["Fast and punchy chat style", "Epic novel-style prose", "Lightweight low-token preset"]}
        onGenerate={async (idea, opts) => {
          const p = normalizePreset(await generatePreset(activeProfile("text"), idea));
          add("presets", p);
        }}
      />
      {state.presets.length === 0 ? (
        <Empty icon="sliders" title="No presets yet">Describe the feel you want; the AI orders the prompt sections.</Empty>
      ) : (
        <div className="grid cols-2">
          {state.presets.map((p) => {
            const users = profilesUsingPreset(state, p.id);
            const inUse = textProfile?.presetId === p.id;
            return (
            <div key={p.id} className="card" style={inUse ? { borderColor: "var(--accent)" } : undefined}>
              <div className="row">
                <Icon name="sliders" size={20} style={{ color: inUse ? "var(--accent)" : "var(--text-faint)" }} />
                <div className="grow" style={{ fontWeight: 650 }}>
                  {p.name}
                  {inUse && <span className="badge green" style={{ marginLeft: 8 }}>In use</span>}
                </div>
                <button className="btn sm" onClick={() => setEdit(p)}>Edit</button>
                <button className="btn sm" onClick={() => downloadJSON(toSTPreset(p), `${p.name.replace(/[^\w-]+/g, "_")}-preset.json`)}>Export</button>
                <DeleteButton what="preset" name={p.name} impact={impactSummary(deletionImpact("presets", p.id))} onConfirm={() => removeCascade("presets", p.id)} label="" />
              </div>

              <div className="row mt">
                {inUse ? (
                  <button className="btn sm" title={`Unlink from ${textProfile.name}`}
                    onClick={() => patchProfile(textProfile.id, { presetId: null })}>Stop using</button>
                ) : (
                  <button className="btn sm primary" disabled={!textProfile}
                    title={textProfile ? `Link this preset to ${textProfile.name}` : "No text profile available"}
                    onClick={() => patchProfile(textProfile.id, { presetId: p.id })}>
                    Use for “{textProfile?.name || "—"}”
                  </button>
                )}
                <span className="faint">
                  {users.length
                    ? `Linked to: ${users.map((u) => u.name).join(", ")}`
                    : "Not linked to any connection profile yet"}
                </span>
              </div>
              <div className="faint mt">temp {p.temperature} · max tokens {p.maxTokens} · top P {p.topP ?? 1}</div>
              <div className="row wrap mt" style={{ fontSize: 12 }}>
                {(p.sections || []).slice().sort((a, b2) => a.order - b2.order).map((s, i) => (
                  <span key={i} className="tag" style={s.enabled === false ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                    {i + 1}. {s.name}
                  </span>
                ))}
                {!(p.sections || []).length && <span className="faint">Default section order</span>}
              </div>
              {p.style && <div className="muted mt" style={{ fontSize: 12 }}>{p.style.slice(0, 120)}</div>}
            </div>
            );
          })}
        </div>
      )}

      {edit && <PresetEditor preset={edit === "manual" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/**
 * Full manual editor — presets could previously only be generated or imported,
 * with no way to change anything afterwards.
 */
function PresetEditor({ preset, onClose }) {
  const { state, add, patch } = useStore();
  const [showPreview, setShowPreview] = React.useState(true);
  const [p, setP] = React.useState(() => preset || {
    id: uid(),
    name: "",
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    temperature: 0.8,
    maxTokens: 1024,
    topP: 1,
    style: "",
    createdAt: Date.now(),
  });
  const set = (k, v) => setP((o) => ({ ...o, [k]: v }));
  const sections = (p.sections || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const pv = React.useMemo(() => previewBlocks(state), [state]);
  const unplaced = unplacedRoles(p);

  const writeSections = (list) =>
    set("sections", list.map((s, i) => ({ ...s, order: i })));

  const move = (i, dir) => {
    const next = [...sections];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    writeSections(next);
  };
  const setSection = (i, patchObj) =>
    writeSections(sections.map((s, k) => (k === i ? { ...s, ...patchObj } : s)));
  const removeSection = (i) => writeSections(sections.filter((_, k) => k !== i));
  const addSection = () => writeSections([...sections, newSection()]);

  const save = () => {
    const clean = { ...p, name: p.name.trim() || "Untitled Preset" };
    if (preset) patch("presets", preset.id, clean);
    else add("presets", clean);
    onClose();
  };

  return (
    <Modal title={preset ? `Edit — ${p.name || "preset"}` : "New Preset"} onClose={onClose} wide>
      <Field label="Preset name">
        <input value={p.name} placeholder="e.g. Cinematic slow-burn" onChange={(e) => set("name", e.target.value)} />
      </Field>

      <div className="grid cols-3">
        <div><Field label="Temperature">
          <input type="number" step="0.05" min="0" max="2" value={p.temperature}
            onChange={(e) => set("temperature", num(e.target.value, 0.8))} />
        </Field></div>
        <div><Field label="Max tokens">
          <input type="number" min="1" value={p.maxTokens}
            onChange={(e) => set("maxTokens", Math.round(num(e.target.value, 1024)))} />
        </Field></div>
        <div><Field label="Top P">
          <input type="number" step="0.05" min="0" max="1" value={p.topP ?? 1}
            onChange={(e) => set("topP", num(e.target.value, 1))} />
        </Field></div>
      </div>

      <Field label="Style instructions">
        <textarea rows={2} value={p.style || ""} placeholder="e.g. Cinematic, slow-burn, heavy on sensory detail"
          onChange={(e) => set("style", e.target.value)} />
      </Field>

      <label>Prompt sections — order decides what the model reads first</label>
      <div className="faint mb">Untick a section to leave it out of the prompt entirely.</div>
      {sections.map((s, i) => {
        const off = s.enabled === false;
        const literal = String(s.content || "").trim() !== "";
        return (
          <div key={i} className="mb" style={{ opacity: off ? 0.55 : 1 }}>
            <div className="row" style={{ gap: 6 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={!off}
                title={off ? "Excluded from the prompt" : "Included in the prompt"}
                onChange={(e) => setSection(i, { enabled: e.target.checked })} />
              <input className="grow" value={s.name} placeholder="Section name"
                onChange={(e) => setSection(i, { name: e.target.value })} />
              <select style={{ width: 150 }} value={s.role} disabled={literal}
                title={literal ? "This section sends its own text, so it has no role" : "What this section pulls from the app"}
                onChange={(e) => setSection(i, { role: e.target.value })}>
                {literal
                  ? <option value={s.role}>Own text</option>
                  : [ROLE_NONE, ...SECTION_ROLES].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button className="btn sm" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn sm" title="Move down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn sm danger" title="Remove section" onClick={() => removeSection(i)}>×</button>
            </div>
            <div className="faint" style={{ margin: "2px 0 0 26px", lineHeight: 1.45 }}>
              {literal
                ? "Your own text, sent exactly as written."
                : ROLE_DESCRIPTION[s.role] || "Custom section."}
            </div>
            {literal ? (
              // an imported ST prompt body, or text you typed — editable in place
              <textarea
                rows={Math.min(6, Math.max(2, String(s.content).split("\n").length))}
                value={s.content}
                style={{
                  margin: "4px 0 0 26px", width: "calc(100% - 26px)", fontSize: 11.5,
                  fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: 1.45,
                }}
                onChange={(e) => setSection(i, { content: e.target.value })}
              />
            ) : (
              <pre style={{
                margin: "4px 0 0 26px", padding: "6px 8px", borderRadius: 6,
                background: "var(--bg-deep, rgba(0,0,0,0.25))", whiteSpace: "pre-wrap",
                fontSize: 11, lineHeight: 1.4, color: "var(--text-dim)",
                textDecoration: off ? "line-through" : undefined,
                maxHeight: 58, overflow: "auto",
              }}>
                {pv[s.role] || "(nothing — this section adds no text)"}
              </pre>
            )}
            {!literal && (
              <button className="btn sm ghost" style={{ marginLeft: 26, marginTop: 4 }}
                onClick={() => setSection(i, { content: pv[s.role] || " " })}>
                Replace with my own text
              </button>
            )}
          </div>
        );
      })}
      <button className="btn sm" onClick={addSection}>＋ Add section</button>

      {unplaced.length > 0 && (
        <label style={{
          display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14,
          textTransform: "none", letterSpacing: 0, fontSize: 12, cursor: "pointer",
        }}>
          <input type="checkbox" style={{ width: "auto", marginTop: 2 }}
            checked={p.appendUnplaced !== false}
            onChange={(e) => set("appendUnplaced", e.target.checked)} />
          <span>
            <b>Also append what this preset doesn’t place</b>
            <div className="faint" style={{ lineHeight: 1.45 }}>
              {unplaced.map((r) => ROLE_LABEL[r]).join(", ")} — added at the end.
              Turn this off if your own text already covers them, or you’ll say the same thing twice.
            </div>
          </span>
        </label>
      )}

      <div className="row mt">
        <label style={{ margin: 0 }}>Assembled prompt preview</label>
        <div className="spacer" />
        <button className="btn sm ghost" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
          <Icon
            name="chevron"
            size={12}
            style={{ transform: showPreview ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}
          />
          {showPreview ? "Hide" : "Show"}
        </button>
      </div>
      {showPreview && (
        <>
          <div className="faint mb">
            Exactly what this preset sends, in this order. Uses your own character, world and persona
            where you have them, example text where you don't.
          </div>
          <pre className="prompt-preview" style={{
            padding: 10, borderRadius: 8, background: "var(--bg-deep, rgba(0,0,0,0.25))",
            whiteSpace: "pre-wrap", fontSize: 11.5, lineHeight: 1.5,
            maxHeight: 240, overflowY: "auto", overflowX: "auto",
          }}>
            {assemblePrompt(pv, p, { char: state.characters?.[0]?.name || "Serah Vane", user: state.personas?.[0]?.name || "Rowan Ash" })
              || "(every section is switched off — the model would get no system prompt)"}
          </pre>
        </>
      )}

      {/* sticky so Save stays reachable past the section previews; the negative
          margins let it cover the modal's 24px padding instead of leaking content */}
      <div className="row mt" style={{
        position: "sticky", bottom: -24, background: "var(--bg-panel)",
        padding: "10px 24px 24px", margin: "0 -24px -24px",
        borderTop: "1px solid var(--border-strong)",
      }}>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save Preset</button>
      </div>
    </Modal>
  );
}
