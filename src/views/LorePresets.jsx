import React, { useState, useEffect } from "react";
import { uid, useStore } from "../store";
import { AICreator, DeleteButton, Empty, Field, Modal, PageHead } from "../components/UI";
import { impactSummary } from "../lib/cascade";
import { generateLorebook, generatePreset } from "../lib/ai";
import { fromSTPreset, toSTPreset, downloadJSON } from "../lib/stio";
import {
  DEFAULT_SECTIONS, ROLE_LABEL, ROLE_DESCRIPTION, ROLE_NONE, SECTION_ROLES,
  newSection, profilesUsingPreset, previewBlocks, assemblePrompt, unplacedRoles, normalizePreset,
  uidLocal,
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

/** One compact row per section: grip, reorder, expand, name, role, actions. */
function SectionRow({
  s, i, last, open, preview, drag,
  onToggleOpen, onMove, onPatch, onDuplicate, onRemove,
}) {
  const off = s.enabled === false;
  const literal = String(s.content || "").trim() !== "";
  const marker = !literal && s.role !== ROLE_NONE;
  const roleLabel = literal ? "own text" : (ROLE_LABEL[s.role] || "custom").toLowerCase();

  return (
    <div
      className={[
        "pe-row", off ? "off" : "on",
        drag.dragging ? "dragging" : "",
        drag.over === "up" ? "over-up" : drag.over === "down" ? "over-down" : "",
      ].filter(Boolean).join(" ")}
      draggable={drag.armed}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <div className="pe-bar">
        <span
          className="pe-grip"
          title="Drag to reorder"
          onMouseDown={drag.arm}
          onMouseUp={drag.disarm}
        >
          <Icon name="grip" size={14} />
        </span>
        <button className="pe-ico" title="Move up" disabled={i === 0} onClick={() => onMove(-1)}>
          <Icon name="chevron" size={13} style={{ transform: "rotate(-90deg)" }} />
        </button>
        <button className="pe-ico" title="Move down" disabled={last} onClick={() => onMove(1)}>
          <Icon name="chevron" size={13} style={{ transform: "rotate(90deg)" }} />
        </button>
        <button className="pe-ico" title={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={onToggleOpen}>
          <Icon name="chevron" size={13}
            style={{ transition: "transform 140ms ease", transform: open ? "rotate(90deg)" : "none" }} />
        </button>
        <Icon name="sectionmark" size={15} className="pe-mark" />
        <button className="pe-name" title={open ? "Collapse" : "Expand"} onClick={onToggleOpen}>
          {s.name || "Untitled section"}
        </button>
        {marker && <span className="badge amber" title="Filled in by the app at send time">Marker</span>}
        <span className="pe-role" title={literal ? "Sent exactly as written" : ROLE_DESCRIPTION[s.role] || ""}>
          {roleLabel}
        </span>
        <button className="pe-ico" title="Duplicate section" onClick={onDuplicate}>
          <Icon name="copy" size={14} />
        </button>
        <button
          className={`pe-ico${off ? "" : " on"}`}
          title={off ? "Switched off — not sent to the model" : "Switched on"}
          aria-pressed={!off}
          onClick={() => onPatch({ enabled: off })}
        >
          <Icon name={off ? "eyeOff" : "eye"} size={14} />
        </button>
        <button className="pe-ico danger" title="Remove section" onClick={onRemove}>
          <Icon name="trash" size={14} />
        </button>
      </div>

      {open && (
        <div className="pe-edit">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="grow">
              <label>Name</label>
              <input value={s.name} placeholder="Section name" onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
            <div style={{ width: 170 }}>
              <label>Pulls from</label>
              <select
                value={s.role}
                disabled={literal}
                title={literal ? "This section sends its own text, so it has no role" : "What this section pulls from the app"}
                onChange={(e) => onPatch({ role: e.target.value })}
              >
                {literal
                  ? <option value={s.role}>Own text</option>
                  : [ROLE_NONE, ...SECTION_ROLES].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          <div className="faint" style={{ lineHeight: 1.5 }}>
            {literal ? "Your own text, sent exactly as written." : ROLE_DESCRIPTION[s.role] || "Adds nothing on its own."}
          </div>
          {literal ? (
            <textarea
              rows={Math.min(14, Math.max(3, String(s.content).split("\n").length))}
              value={s.content}
              onChange={(e) => onPatch({ content: e.target.value })}
            />
          ) : (
            <>
              <pre className="pe-preview" style={{ textDecoration: off ? "line-through" : undefined }}>
                {preview || "(nothing — this section adds no text)"}
              </pre>
              <div>
                <button className="btn sm ghost" onClick={() => onPatch({ content: preview || " " })}>
                  Replace with my own text
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
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
  const [showPreview, setShowPreview] = useState(false);
  const [editorOpen, setEditorOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  const [importError, setImportError] = useState("");
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  // only the row whose grip is held becomes draggable — making every row
  // draggable breaks text selection in the inputs an expanded row contains
  const [armedIdx, setArmedIdx] = useState(null);

  useEffect(() => {
    if (armedIdx === null) return;
    const clear = () => setArmedIdx(null);
    window.addEventListener("mouseup", clear);
    return () => window.removeEventListener("mouseup", clear);
  }, [armedIdx]);
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
    // rows are keyed by section id, so a preset missing them has to be normalized
    if (sec.some((s, i) => s.order !== i || !s.id)) patch("presets", selected.id, normalizePreset(selected));
  }, [selected?.id]);

  // keyed by preset too, so switching presets closes whatever was expanded
  const rowKey = (s, i) => `${selected?.id}:${s.id || i}`;

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
  const onCount = sections.filter((s) => s.enabled !== false).length;

  const writeSections = (list) =>
    setP({ sections: list.map((s, i) => ({ ...s, order: i })) });
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    writeSections(next);
  };
  const reorder = (from, to) => {
    if (from == null || from === to) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    writeSections(next);
  };
  const setSection = (i, patchObj) =>
    writeSections(sections.map((s, k) => (k === i ? { ...s, ...patchObj } : s)));
  const removeSection = (i) => writeSections(sections.filter((_, k) => k !== i));
  const duplicateSection = (i) => {
    const copy = { ...sections[i], id: uidLocal(), name: `${sections[i].name || "Section"} copy` };
    const next = [...sections];
    next.splice(i + 1, 0, copy);
    writeSections(next);
    setOpenSection(rowKey(copy, i + 1));
  };
  const addSection = () => {
    const s = { ...newSection(), id: uidLocal(), name: "New section" };
    writeSections([...sections, s]);
    setOpenSection(rowKey(s, sections.length));
    setEditorOpen(true);
  };

  const endDrag = () => { setArmedIdx(null); setDragFrom(null); setDragOver(null); };
  const dragFor = (i) => ({
    armed: armedIdx === i,
    dragging: dragFrom === i,
    over: dragOver?.i === i ? dragOver.pos : null,
    arm: () => setArmedIdx(i),
    disarm: () => setArmedIdx(null),
    onDragStart: (e) => {
      if (armedIdx !== i) { e.preventDefault(); return; }
      setDragFrom(i);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    },
    onDragEnd: endDrag,
    onDragOver: (e) => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? "up" : "down";
      if (dragOver?.i !== i || dragOver?.pos !== pos) setDragOver({ i, pos });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === i) return endDrag();
      const pos = dragOver?.i === i ? dragOver.pos : "up";
      let to = pos === "up" ? i : i + 1;
      if (dragFrom < to) to -= 1;
      reorder(dragFrom, to);
      endDrag();
    },
  });

  return (
    <div>
      <PageHead title="Presets" sub={`Pick a preset, switch its sections on or off, done — edits save as you type. A preset takes effect once a text connection profile links to it (active: "${textProfile?.name || "none"}").`}>
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

      <div className="card mb">
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

      </div>

      <div className="pe mb">
        <button className="pe-head" aria-expanded={editorOpen} onClick={() => setEditorOpen((v) => !v)}>
          <Icon name="layers" size={16} className="pe-head-icon" />
          {editorOpen ? "Collapse preset editor" : "Expand preset editor"}
          <span className="pe-count">
            {sections.length} section{sections.length === 1 ? "" : "s"} · {onCount} on
          </span>
          <Icon name="chevron" size={14} className={`pe-caret${editorOpen ? " open" : ""}`} />
        </button>

        {editorOpen && (
          <div className="pe-body">
            <div className="pe-note">Edit sections here. Changes save as you type.</div>

            <div className="pe-toolbar">
              <button className="pe-ico" title="What are these sections?" aria-expanded={showHelp}
                onClick={() => setShowHelp((v) => !v)}>
                <Icon name="help" size={16} />
              </button>
              <button className="btn primary pill" onClick={addSection}>
                <Icon name="plus" size={13} /> Add section
              </button>
            </div>

            {showHelp && (
              <div className="pe-note long">
                Each row is one block of the system prompt. Switch a row off to leave it out
                entirely. A <b>Marker</b> row is filled in by the app at send time — expand it to
                see a live preview resolved with your own characters and worlds. Rows without the
                badge send their stored text as written, keeping <code>{"{{macros}}"}</code> exactly
                as imported.
              </div>
            )}

            {sections.length === 0 ? (
              <div className="faint" style={{ padding: "16px 0" }}>
                No sections yet. Add one to start building the prompt.
              </div>
            ) : (
              <div className="pe-list">
                {sections.map((s, i) => {
                  const key = rowKey(s, i);
                  return (
                    <SectionRow
                      key={key}
                      s={s}
                      i={i}
                      last={i === sections.length - 1}
                      open={openSection === key}
                      preview={pv[s.role]}
                      drag={dragFor(i)}
                      onToggleOpen={() => setOpenSection((cur) => (cur === key ? null : key))}
                      onMove={(dir) => move(i, dir)}
                      onPatch={(p) => setSection(i, p)}
                      onDuplicate={() => duplicateSection(i)}
                      onRemove={() => removeSection(i)}
                    />
                  );
                })}
              </div>
            )}

            <div className="pe-foot">Click a row to expand it · Sections are assembled top-to-bottom</div>

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
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
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
          <pre className="prompt-preview mt" style={{
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
