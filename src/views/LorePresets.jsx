import React, { useState, useEffect } from "react";
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
                <div key={i} className="row mt" style={{ fontSize: "0.75rem" }}>
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

/**
 * SillyTavern-style preset manager: a dropdown of presets at the top; the
 * selected preset's options populate below it, each toggleable, in the order
 * the preset (or the imported JSON) lists them. Edits save live — no restart,
 * no save button. SillyTavern JSON import/export included.
 */
export function Presets() {
  const { state, add, patch, activeProfile, patchProfile, removeCascade, deletionImpact } = useStore();
  const fileRef = React.useRef(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [importError, setImportError] = useState("");
  const textProfile = activeProfile("text");
  const presets = state.presets || [];

  const selected =
    presets.find((p) => p.id === selectedId) ||
    presets.find((p) => p.id === textProfile?.presetId) ||
    presets[0] ||
    null;

  useEffect(() => {
    if (!selected) return;
    const sec = selected.sections || [];
    if (sec.some((s, i) => s.order !== i)) patch("presets", selected.id, normalizePreset(selected));
  }, [selected?.id]);

  const createBlank = () => {
    const p = normalizePreset({
      id: uid(),
      name: `Preset ${presets.length + 1}`,
      sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
      temperature: 0.8,
      maxTokens: 1024,
      topP: 1,
      style: "",
      createdAt: Date.now(),
    });
    add("presets", p);
    setSelectedId(p.id);
  };

  const doImport = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    setImportError("");
    for (const f of picked) {
      try {
        const p = normalizePreset(fromSTPreset(JSON.parse(await f.text()), f.name));
        add("presets", p);
        setSelectedId(p.id);
      } catch (err) {
        setImportError(`Could not import "${f.name}": ${err.message || err}`);
      }
    }
  };

  const setP = (patchObj) => {
    if (!selected) return;
    patch("presets", selected.id, patchObj);
  };

  const pv = React.useMemo(() => previewBlocks(state), [state]);
  const unplaced = unplacedRoles(selected);

  if (presets.length === 0) {
    return (
      <div>
        <PageHead title="Presets" sub="Prompt section ordering + generation parameters. Import a SillyTavern preset, or start blank — everything is editable in place.">
          <input ref={fileRef} type="file" multiple accept=".json" style={{ display: "none" }} onChange={doImport} />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={13} /> Import ST Preset
          </button>
          <button className="btn" onClick={createBlank}>Blank Preset</button>
        </PageHead>
        {importError && <div className="mb" style={{ color: "var(--red)", fontSize: "0.75rem" }}>{importError}</div>}
        <AICreator
          title="AI Preset Builder"
          placeholder="e.g. A cinematic, slow-burn roleplay preset with strong memory"
          chips={["Fast and punchy chat style", "Epic novel-style prose", "Lightweight low-token preset"]}
          onGenerate={async (idea) => {
            const p = normalizePreset(await generatePreset(activeProfile("text"), idea));
            add("presets", p);
            setSelectedId(p.id);
          }}
        />
        <Empty icon="sliders" title="No presets yet">Import one, start blank, or describe the feel you want for the AI.</Empty>
      </div>
    );
  }

  const inUse = textProfile?.presetId === selected?.id;
  const users = selected ? profilesUsingPreset(state, selected.id) : [];
  const sections = (selected?.sections || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const writeSections = (list) =>
    setP({ sections: list.map((s, i) => ({ ...s, order: i })) });
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

  return (
    <div>
      <PageHead title="Presets" sub={`Pick a preset, toggle its sections, done — edits save live. A preset takes effect by being linked to a text connection profile (active: "${textProfile?.name || "none"}").`}>
        <input ref={fileRef} type="file" multiple accept=".json" style={{ display: "none" }} onChange={doImport} />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={13} /> Import
        </button>
        <button className="btn" onClick={createBlank}>Blank</button>
      </PageHead>
      {importError && <div className="mb" style={{ color: "var(--red)", fontSize: "0.75rem" }}>{importError}</div>}

      <div className="card mb">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="grow" style={{ maxWidth: 420 }}>
            <label style={{ marginTop: 0 }}>Preset</label>
            <select value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.id === textProfile?.presetId ? " (in use)" : ""}
                </option>
              ))}
            </select>
          </div>
          {inUse ? (
            <button className="btn" style={{ height: 38 }} title={`Unlink from ${textProfile.name}`}
              onClick={() => patchProfile(textProfile.id, { presetId: null })}>Stop using</button>
          ) : (
            <button className="btn primary" style={{ height: 38 }} disabled={!textProfile}
              title={textProfile ? `Make this the preset ${textProfile.name} uses` : "No text profile available"}
              onClick={() => patchProfile(textProfile.id, { presetId: selected.id })}>
              Use for "{textProfile?.name || "—"}"
            </button>
          )}
          <button className="btn" style={{ height: 38 }} title="SillyTavern chat-completion preset JSON"
            onClick={() => downloadJSON(toSTPreset(selected), `${selected.name.replace(/[^\w-]+/g, "_")}-preset.json`)}>
            <Icon name="save" size={12} /> Export
          </button>
          <DeleteButton
            what="preset" name={selected.name}
            impact={impactSummary(deletionImpact("presets", selected.id))}
            onConfirm={() => {
              removeCascade("presets", selected.id);
              setSelectedId(null);
            }}
          />
        </div>
        <div className="faint mt">
          {users.length
            ? `Linked to: ${users.map((u) => u.name).join(", ")}`
            : "Not linked to any connection profile yet."}
        </div>
      </div>

      <div className="card">
        <Field label="Preset name">
          <input value={selected.name} onChange={(e) => setP({ name: e.target.value })} />
        </Field>

        <div className="grid cols-3">
          <div><Field label="Temperature">
            <input type="number" step="0.05" min="0" max="2" value={selected.temperature}
              onChange={(e) => setP({ temperature: num(e.target.value, 0.8) })} />
          </Field></div>
          <div><Field label="Max tokens">
            <input type="number" min="1" value={selected.maxTokens}
              onChange={(e) => setP({ maxTokens: Math.round(num(e.target.value, 1024)) })} />
          </Field></div>
          <div><Field label="Top P">
            <input type="number" step="0.05" min="0" max="1" value={selected.topP ?? 1}
              onChange={(e) => setP({ topP: num(e.target.value, 1) })} />
          </Field></div>
        </div>

        <Field label="Style instructions">
          <textarea rows={2} value={selected.style || ""} placeholder="e.g. Cinematic, slow-burn, heavy on sensory detail"
            onChange={(e) => setP({ style: e.target.value })} />
        </Field>

        <label>Prompt sections — in the order the model reads them</label>
        <div className="faint mb">
          Toggle a section off to leave it out of the prompt entirely. What you see in the grey
          boxes below is a <b>live preview</b>, resolved with your data — the stored preset text
          keeps <code>{"{{macros}}"}</code> exactly as imported.
        </div>
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
                <textarea
                  rows={Math.min(6, Math.max(2, String(s.content).split("\n").length))}
                  value={s.content}
                  style={{
                    margin: "4px 0 0 26px", width: "calc(100% - 26px)", fontSize: "0.7188rem",
                    fontFamily: "var(--font-mono)", lineHeight: 1.45,
                  }}
                  onChange={(e) => setSection(i, { content: e.target.value })}
                />
              ) : (
                <pre style={{
                  margin: "4px 0 0 26px", padding: "6px 8px", borderRadius: 6,
                  background: "rgba(0,0,0,0.25)", whiteSpace: "pre-wrap",
                  fontSize: "0.6875rem", lineHeight: 1.4, color: "var(--text-dim)",
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
        <button className="btn sm" onClick={addSection}>Add section</button>

        {unplaced.length > 0 && (
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14,
            textTransform: "none", letterSpacing: 0, fontSize: "0.75rem", cursor: "pointer",
          }}>
            <input type="checkbox" style={{ width: "auto", marginTop: 2 }}
              checked={selected.appendUnplaced !== false}
              onChange={(e) => setP({ appendUnplaced: e.target.checked })} />
            <span>
              <b>Also append what this preset doesn't place</b>
              <div className="faint" style={{ lineHeight: 1.45 }}>
                {unplaced.map((r) => ROLE_LABEL[r]).join(", ")} — added at the end.
                Turn this off if your own text already covers them, or you'll say the same thing twice.
              </div>
            </span>
          </label>
        )}

        <div className="row mt">
          <label style={{ margin: 0 }}>
            Assembled prompt preview — {"{{macros}}"} resolved against{" "}
            <b style={{ color: "var(--accent-2)" }}>
              {state.characters?.[0]?.name || "no character"}
            </b>{" "}
            speaking with{" "}
            <b style={{ color: "var(--accent-2)" }}>
              {state.personas?.[0]?.name || "no persona"}
            </b>
          </label>
          <div className="spacer" />
          <button className="btn sm ghost" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
            <Icon name="chevron" size={12} style={{ transform: showPreview ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }} />
            {showPreview ? "Hide" : "Show"}
          </button>
        </div>
        {showPreview && (
          <pre className="prompt-preview" style={{
            padding: 10, borderRadius: 8, background: "rgba(0,0,0,0.25)",
            whiteSpace: "pre-wrap", fontSize: "0.7188rem", lineHeight: 1.5,
            maxHeight: 240, overflowY: "auto", overflowX: "auto",
          }}>
            {assemblePrompt(pv, selected, { char: state.characters?.[0]?.name || "Example Character", user: state.personas?.[0]?.name || "Rowan Ash" })
              || "(every section is switched off — the model would get no system prompt)"}
          </pre>
        )}
      </div>
    </div>
  );
}
