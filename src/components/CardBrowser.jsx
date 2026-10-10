import React, { useState } from "react";
import { uid, useStore } from "../store";
import Icon from "./Icon";
import { Modal } from "./UI";
import { SOURCES, getSource } from "../lib/cardbrowser";
import { importCharacterFile } from "../lib/stio";


/**
 * Card Browser — search external card repositories and import characters.
 * Downloaded files are imported through the SillyTavern-compatible importer
 * and the ORIGINAL file is saved to User Files (never renamed).
 */
export default function CardBrowser({ onClose, onImported }) {
  const { state, add } = useStore();
  const [sourceId, setSourceId] = useState("sample");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState("");

  const source = getSource(sourceId);
  const cfg = state.cardSources?.[sourceId] || {};

  const search = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await source.search(query, cfg);
      setResults(r);
      if (!r.length) setError("No results.");
    } catch (e) {
      setResults([]);
      setError(
        String(e.message || e) +
          (source.configurable ? " — if this is a region/CORS block, set a proxy template for this source in Settings → Card Browser." : "")
      );
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (result) => {
    setImporting(result.remoteId);
    setError("");
    try {
      const file = await source.download(result, cfg);
      const character = await importCharacterFile(file);
      // preserve the ORIGINAL downloaded file (never renamed) in User Files
      const reader = new FileReader();
      reader.onload = () => {
        add("userFiles", {
          id: uid(),
          category: "characters",
          fileName: file.name, // original filename from the source, untouched
          fileType: file.type,
          size: file.size,
          dataURL: reader.result,
          createdAt: Date.now(),
          source: sourceId,
        });
      };
      reader.readAsDataURL(file);
      add("characters", character);
      onImported?.(character);
    } catch (e) {
      setError(`Import failed: ${e.message || e}`);
    } finally {
      setImporting(null);
    }
  };

  return (
    <Modal title="Card Browser" onClose={onClose} wide>
      <div className="row mb">
        <select style={{ width: 220 }} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setResults([]); setError(""); }}>
          {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          className="grow"
          value={query}
          placeholder={`Search ${source.name}…`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && search()}
        />
        <button className="btn primary" onClick={search} disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </div>
      <div className="faint mb">{source.blurb}</div>
      {error && <div className="mb" style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>}

      <div>
        {results.map((r) => (
          <div key={r.sourceId + r.remoteId} className="list-item">
            {r.avatar ? (
              <img src={r.avatar} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover" }} />
            ) : (
              <Icon name="masks" size={20} style={{ color: "var(--text-faint)" }} />
            )}
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{r.name}</div>
              <div className="faint" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.tagline}</div>
              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                {r.tags.map((t) => <span key={t} className="tag" style={{ fontSize: 10 }}>{t}</span>)}
                {r.rating != null && <span className="faint">rating {r.rating}</span>}
                {r.downloads != null && <span className="faint" title="Downloads"><Icon name="download" size={11} /> {r.downloads}</span>}
              </div>
            </div>
            <button className="btn sm primary" onClick={() => doImport(r)} disabled={importing === r.remoteId}>
              {importing === r.remoteId ? "Importing…" : "Import"}
            </button>
          </div>
        ))}
        {!results.length && !busy && !error && (
          <div className="empty" style={{ padding: 30 }}>
            <div className="big"><Icon name="search" size={34} strokeWidth={1.3} /></div>
            Pick a source and search. Imported cards are parsed with the SillyTavern-compatible
            importer and the original file is saved to User Files → Characters, never renamed.
          </div>
        )}
      </div>
    </Modal>
  );
}
