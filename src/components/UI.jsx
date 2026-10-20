import React from "react";
import Icon from "./Icon";
import { useStore } from "../store";
import { generateImage, generatedFileEntry } from "../lib/ai";
import { runDetached } from "../lib/genbus";
import { readImageFile } from "../lib/image";
import { uid } from "../lib/id";
import { GENDERS } from "../lib/presets";

export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { width: "min(900px, 94vw)" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn sm ghost" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Required gender choice. Nothing is inferred from a name or description —
 * the user picks how the character should be referred to.
 */
export function GenderAsk({ name, onPick, onCancel }) {
  return (
    <Modal title="Choose gender" onClose={onCancel || (() => {})}>
      <div className="muted mb">
        {name ? <>How should <b>{name}</b> be referred to?</> : "How should this character be referred to?"}{" "}
        Nothing is assumed — pick one.
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {GENDERS.map((g) => (
          <button key={g.value} className="btn primary" onClick={() => onPick(g.value)}>{g.label}</button>
        ))}
      </div>
      <div className="faint mt" style={{ lineHeight: 1.45 }}>
        This is stored on the card and passed to the model as an explicit pronoun line.
      </div>
    </Modal>
  );
}

export function Empty({ icon, title, children }) {
  return (
    <div className="empty">
      <div className="big"><Icon name={icon} size={36} strokeWidth={1.3} /></div>
      <div style={{ fontWeight: 600, color: "var(--text-dim)", marginBottom: 4 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <>
      <label>{label}</label>
      {children}
    </>
  );
}

/**
 * Reusable "create with AI or manually" panel.
 * Every feature gets its own AI generation option, routed through the
 * active provider (mock or any OpenAI-compatible endpoint).
 */
export function AICreator({ title, placeholder, chips = [], onGenerate, manualForm }) {
  const { activeProfile } = useStore();
  const [idea, setIdea] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [manual, setManual] = React.useState(!onGenerate);

  const run = async () => {
    if (!idea.trim()) return;
    setBusy(true);
    setError("");
    try {
      // detached: keeps running in the background if you navigate away
      await runDetached(`${title}: ${idea.trim().slice(0, 60)}`, onGenerate(idea.trim()));
      setIdea("");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-panel mb">
      <div className="row">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div className="spacer" />
        {onGenerate && manualForm && (
          <button className="btn sm ghost" onClick={() => setManual((m) => !m)}>
            {manual ? "Use AI" : "Fill manually"}
          </button>
        )}
      </div>
      <div className="hint">
        Describe it in one line and the AI does the rest. Uses{" "}
        <b style={{ color: "var(--accent-2)" }}>{activeProfile("text")?.name || "the active provider"}</b> —
        switch providers in Settings, including any outside OpenAI-compatible API.
      </div>

      {manual ? (
        manualForm
      ) : (
        <>
          <div className="row">
            <input
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => e.key === "Enter" && !busy && run()}
            />
            <button className="btn primary" onClick={run} disabled={busy || !idea.trim()}>
              {busy ? "Generating…" : "Generate"}
            </button>
          </div>
          {chips.length > 0 && (
            <div className="chips">
              {chips.map((c) => (
                <button key={c} className="chip" onClick={() => setIdea(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {busy && <div className="thinking mt">Generating</div>}
          {error && <div className="mt" style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>}
        </>
      )}
    </div>
  );
}

/**
 * One delete control for every user-created item: labeled (not a bare ×),
 * confirms, and spells out what else the delete will take with it.
 */
export function DeleteButton({ what, name, onConfirm, impact = "", label = "Delete", stop = true }) {
  return (
    <button
      className="btn sm danger"
      title={`Delete this ${what}`}
      onClick={(e) => {
        if (stop) e.stopPropagation();
        const extra = impact ? `\n\n${impact}` : "";
        if (confirm(`Delete ${what} "${name || "untitled"}"?${extra}\n\nThis cannot be undone.`)) onConfirm();
      }}
    >
      <Icon name="trash" size={12} /> {label}
    </button>
  );
}

/** Dev-only: stop the local server from inside the app. */
export function QuitButton() {
  const [state, setState] = React.useState("idle");
  if (!import.meta.env.DEV) return null;
  if (state === "done") return <span className="faint">Server stopped — you can close this tab.</span>;
  return (
    <button
      className="btn sm ghost"
      title="Stop the local Bard Browser server"
      disabled={state === "quitting"}
      onClick={async () => {
        if (!confirm("Stop the Bard Browser server?\n\nYour data is saved in this browser and will still be here next time.")) return;
        setState("quitting");
        try {
          await fetch("/__quit", { method: "POST" });
        } catch { /* the server dies mid-request — that's the success case */ }
        setState("done");
      }}
    >
      <Icon name="power" size={12} /> {state === "quitting" ? "Stopping…" : "Quit"}
    </button>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="row mb" style={{ alignItems: "flex-start" }}>
      <div className="grow">
        <h2 style={{ fontSize: 18, margin: 0 }}>{title}</h2>
        <div className="faint">{sub}</div>
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

/**
 * Image generation panel for story illustrations.
 * Uses the active Image/Video profile (mock or OpenAI-compatible).
 * Every generated image is also saved into User Files under `category`
 * with a clear descriptive name.
 */
export function ImageGen({
  category,
  kind,
  initialPrompt = "",
  value = null,
  onGenerated,
  compact = false,
  refs = [],
  buttonLabel,
}) {
  const resolvedLabel = buttonLabel || (refs.length ? "Generate from reference" : "Generate Image");
  const { activeProfile, add } = useStore();
  const profile = activeProfile("image");
  const [prompt, setPrompt] = React.useState(initialPrompt);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const aliveRef = React.useRef(true);
  React.useEffect(() => () => { aliveRef.current = false; }, []);

  const run = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const styled = profile?.style ? `${prompt.trim()}, ${profile.style}` : prompt.trim();
      const img = await runDetached(`Image render: ${prompt.trim().slice(0, 50)}`,
        generateImage(profile, styled, { size: profile?.size || "1024x576", refs }));
      add("userFiles", generatedFileEntry(category, kind, prompt.trim().slice(0, 40) || kind, img));
      if (aliveRef.current) onGenerated(img); // editor may be closed — the file is safe in User Files
    } catch (e) {
      if (aliveRef.current) setError(String(e.message || e));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  if (compact) {
    return (
      <span className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={run} disabled={busy} title={initialPrompt.slice(0, 120)}>
          {busy ? "…" : buttonLabel}
        </button>
        {error && <span style={{ color: "var(--red)", fontSize: 11 }}>{error.slice(0, 60)}</span>}
      </span>
    );
  }

  return (
    <div>
      {value && (
        <img
          src={typeof value === "string" ? value : value.dataURL}
          alt="illustration"
          style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, marginBottom: 8 }}
        />
      )}
      <div className="row">
        <input
          className="grow"
          value={prompt}
          placeholder="Describe the image…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
        />
        <button className="btn primary" onClick={run} disabled={busy || !prompt.trim()}>
          {busy ? "Rendering…" : resolvedLabel}
        </button>
      </div>
      {refs.length > 0 && (
        <div className="faint mt">
          Reference-guided: {refs.length} reference photo{refs.length === 1 ? "" : "s"} on this card steer the render.
          If the provider rejects them, it falls back to a prompt-only render.
        </div>
      )}
      <div className="faint mt">
        Uses the active <b style={{ color: "var(--accent-2)" }}>{profile?.name || "image"}</b> profile — configure in Settings → Connections.
      </div>
      {busy && <div className="thinking mt">Rendering</div>}
      {error && <div className="mt" style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

/** Two-letter initials for when there's no image. */
export const initialsOf = (name) =>
  String(name || "?")
    .split(/\s+/)
    .map((w) => [...w][0])
    .filter((ch) => ch && /\p{L}|\p{N}/u.test(ch))
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

/**
 * Rounded-square image or initials. `status` (available | busy | asleep) adds
 * a presence dot on the bottom-right corner.
 */
export function Avatar({ name, src, size = 32, radius, status }) {
  const r = radius ?? Math.max(4, Math.round(size * 0.18));
  const box = (
    <div className="avatar" style={{ width: size, height: size, minWidth: size, borderRadius: r, fontSize: size * 0.36 }}>
      {src
        ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span className="initials">{initialsOf(name)}</span>}
    </div>
  );
  if (!status) return box;
  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      {box}
      <span className={`presence ${status}`} title={status} aria-label={status} />
    </div>
  );
}

/** "Available" pill with a coloured dot. */
export function StatusPill({ status, label }) {
  if (!status) return null;
  return <span className={`status-pill ${status}`}>{label || status}</span>;
}

/**
 * Upload / generate / remove an image. Used for avatars and card covers.
 * Uploads keep the ORIGINAL file (name untouched) in User Files; the entity
 * gets a downscaled copy so big photos don't bloat the saved state.
 */
export function ImagePicker({
  value, onChange, category, kind = "avatar", prompt = "",
  label, buttonClass = "btn sm", align = "right", refs = [],
}) {
  const { activeProfile, add } = useStore();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const fileRef = React.useRef(null);
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("Reading image");
    setError("");
    try {
      const { original, display } = await readImageFile(file, kind === "cover" ? "cover" : "avatar");
      add("userFiles", {
        id: uid(), category, fileName: file.name, // original name, never renamed
        fileType: file.type, size: file.size, dataURL: original, createdAt: Date.now(),
      });
      onChange({ dataURL: display, fileName: file.name, source: "upload" });
      setOpen(false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };

  const generate = async () => {
    const profile = activeProfile("image");
    const base = prompt.trim() || "An evocative illustration";
    setBusy("Generating");
    setError("");
    try {
      const styled = profile?.style ? `${base}, ${profile.style}` : base;
      const size = kind === "cover" ? profile?.size || "1024x576" : "1024x1024";
      // reference photos on the card steer the identity of the render
      const refURLs = refs.map((r) => (typeof r === "string" ? r : r?.dataURL)).filter(Boolean);
      const img = await generateImage(profile, styled, { size, refs: refURLs });
      add("userFiles", generatedFileEntry(category, kind, base.slice(0, 40), img));
      onChange(img);
      setOpen(false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="picker" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={upload} />
      <button className={buttonClass} disabled={!!busy} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="image" size={12} /> {busy ? `${busy}…` : label || (value ? "Change image" : "Add image")}
      </button>
      {open && (
        <div className="picker-menu" style={align === "left" ? { left: 0, right: "auto" } : undefined}>
          <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={12} /> Upload image
          </button>
          <button className="btn sm ghost" onClick={generate}>
            <Icon name="spark" size={12} /> {refs.length ? "Generate from reference" : "Generate from description"}
          </button>
          {value && (
            <button className="btn sm ghost danger" onClick={() => { onChange(null); setOpen(false); }}>
              <Icon name="trash" size={12} /> Remove image
            </button>
          )}
        </div>
      )}
      {error && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4, maxWidth: 240 }}>{error}</div>}
    </div>
  );
}

/**
 * Image across the top of a card, with a gradient when there isn't one.
 * The add/change control appears on hover.
 */
export function CoverImage({ value, fallback, onChange, category, prompt, alt = "", height = 140 }) {
  const src = typeof value === "string" ? value : value?.dataURL;
  // `fallback` is shown when there's no own image (e.g. a chat borrowing its
  // world's background) but is never offered for removal
  const shown = src || (typeof fallback === "string" ? fallback : fallback?.dataURL);
  return (
    <div className="cover" style={{ height }}>
      {shown && <img src={shown} alt={alt} />}
      {onChange && (
        <div className="cover-edit">
          <ImagePicker
            value={src}
            onChange={onChange}
            category={category}
            kind="cover"
            prompt={prompt}
            buttonClass="btn sm on-image"
            label={src ? "Change cover" : "Add cover"}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A person's card: rounded-square image on the left, name + status on the
 * right, then description, chips, a last-line preview and actions.
 */
export function ProfileCard({
  name, image, status, statusLabel, meta,
  description, chips = [], preview, actions, extra, onClick,
}) {
  const shown = chips.filter(Boolean);
  const initials = String(name || "?")
    .split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div className={`card profile-card charcard ${onClick ? "hoverable" : ""}`} onClick={onClick}>
      <div className="charcard-art">
        {image
          ? <img src={image} alt={name} />
          : <div className="charcard-fallback"><span>{initials}</span></div>}
        <div className="charcard-scrim" />
        <div className="charcard-caption">
          <div className="charcard-name" title={name}>{name}</div>
          {(status || meta) && (
            <div className="charcard-caption-sub">
              <StatusPill status={status} label={statusLabel} />
              {meta && <span>{meta}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="card-body">
        {description && <div className="muted clamp-2" style={{ fontSize: 13 }}>{description}</div>}
        {shown.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {shown.map((c, i) => <span key={i} className="chip-soft">{c}</span>)}
          </div>
        )}
        {preview !== undefined && (
          <div className="last-line" title={preview || ""}>{preview || "No conversation yet"}</div>
        )}
        {actions && <div className="card-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
    </div>
  );
}


/**
 * Reference photos for a character/persona/virtual human card — face, full
 * body, side views (like a model sheet). The AI image generator uses them
 * to keep the character's identity consistent across renders.
 * Originals are preserved in User Files; the entity keeps downscaled copies.
 */
export function RefPhotos({ refs = [], onChange, category = "characters" }) {
  const { add } = useStore();
  const fileRef = React.useRef(null);
  const [error, setError] = React.useState("");

  const upload = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    const next = [...refs];
    for (const file of picked) {
      try {
        const { original, display } = await readImageFile(file, "avatar");
        add("userFiles", {
          id: uid(), category,
          fileName: file.name, // original filename, never renamed
          fileType: file.type, size: file.size, dataURL: original, createdAt: Date.now(),
        });
        next.push({ dataURL: display, fileName: file.name });
      } catch (err) {
        setError(String(err.message || err));
      }
    }
    onChange(next);
  };

  const removeAt = (i) => onChange(refs.filter((_, j) => j !== i));

  return (
    <div>
      <div className="row wrap" style={{ gap: 8 }}>
        {refs.map((r, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img src={r.dataURL || r} alt={`reference ${i + 1}`}
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border-strong)" }} />
            <button
              onClick={() => removeAt(i)}
              title="Remove reference"
              style={{
                position: "absolute", top: -6, right: -6, width: 18, height: 18,
                borderRadius: "50%", border: "1px solid var(--border-strong)",
                background: "var(--bg-panel)", color: "var(--red)",
                cursor: "pointer", fontSize: 10, lineHeight: 1, padding: 0,
              }}
            >×</button>
          </div>
        ))}
        {refs.length === 0 && <span className="faint">No reference photos yet.</span>}
      </div>
      <div className="row mt" style={{ gap: 8 }}>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={upload} />
        <button className="btn sm" onClick={() => fileRef.current?.click()}>
          <Icon name="image" size={12} /> Load reference photos
        </button>
        {refs.length > 0 && <span className="faint">{refs.length} reference{refs.length === 1 ? "" : "s"} loaded</span>}
      </div>
      <div className="faint mt" style={{ lineHeight: 1.45 }}>
        Face, full-body and side views work best (like a model sheet). The AI uses these to keep
        the same identity across every generated portrait. Originals are kept in User Files, never renamed.
      </div>
      {error && <div className="mt" style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}


/**
 * Compact reference-photo manager for editor forms: thumbnails, add/remove.
 * Pairs with ImagePicker's `refs` prop.
 */
