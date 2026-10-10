import React, { useState } from "react";
import { useStore } from "../store";
import { MEMORY_TYPES, newMemory, integrateMemories } from "../lib/memory";
import { Modal } from "./UI";
import Icon from "./Icon";

/**
 * Memory Inspector — search, pin, edit, archive, delete and add durable
 * story memories. Memories live on the chat (or world) and are recalled
 * into prompts by relevance; pinned ones are always included.
 */
export default function MemoryInspector({ owner, onClose }) {
  // owner: { collection: "chats"|"worlds", id }
  const { state, patch } = useStore();
  const rec = state[owner.collection]?.find((x) => x.id === owner.id);
  const memories = rec?.memories || [];
  const [search, setSearch] = useState("");
  const [addText, setAddText] = useState("");
  const [addType, setAddType] = useState("fact");
  const [addImportance, setAddImportance] = useState(2);
  const [editing, setEditing] = useState(null); // id being edited
  const [showSuperseded, setShowSuperseded] = useState(true);

  const commit = (next) => patch(owner.collection, owner.id, { memories: next });

  const add = () => {
    if (!addText.trim()) return;
    commit(integrateMemories(memories, [newMemory(addText, { type: addType, importance: addImportance })]).memories);
    setAddText("");
  };

  const shown = memories
    .filter((m) => !search || m.text.toLowerCase().includes(search.toLowerCase()))
    .filter((m) => showSuperseded || !m.superseded)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);

  const typeIcon = { fact: "globe", relationship: "users", state: "pin", thread: "scroll", scene: "film" };

  return (
    <Modal title="Memory Inspector" onClose={onClose} wide>
      <div className="row mb">
        <input className="grow" value={search} placeholder="Search memories…" onChange={(e) => setSearch(e.target.value)} />
        <button className={`btn sm ${showSuperseded ? "" : "ghost"}`} onClick={() => setShowSuperseded((s) => !s)}>
          {showSuperseded ? "Hide superseded" : "Show superseded"}
        </button>
      </div>

      <div className="card mb" style={{ padding: 12 }}>
        <div className="row">
          <input className="grow" value={addText} placeholder="Add a durable memory…" onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <select style={{ width: 130 }} value={addType} onChange={(e) => setAddType(e.target.value)}>
            {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select style={{ width: 90 }} value={addImportance} onChange={(e) => setAddImportance(parseInt(e.target.value))}>
            <option value={1}>low</option>
            <option value={2}>normal</option>
            <option value={3}>high</option>
          </select>
          <button className="btn primary sm" onClick={add} disabled={!addText.trim()}>Add</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty" style={{ padding: 30 }}>
          <div className="big"><Icon name="brain" size={36} strokeWidth={1.3} /></div>
          No memories{search ? " match your search" : " yet"} — tracker facts land here automatically as the story moves.
        </div>
      ) : (
        <div>
          {shown.map((m) => (
            <div key={m.id} className="list-item" style={m.superseded ? { opacity: 0.55 } : undefined}>
              <Icon name={typeIcon[m.type] || "globe"} size={15} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
              <div className="grow">
                {editing === m.id ? (
                  <input
                    autoFocus
                    defaultValue={m.text}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        commit(memories.map((x) => (x.id === m.id ? { ...x, text: e.target.value.trim() || x.text } : x)));
                        setEditing(null);
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <div style={{ textDecoration: m.superseded ? "line-through" : undefined }}>
                    {m.pinned && <Icon name="pin" size={11} style={{ color: "var(--accent-2)", verticalAlign: "-1px" }} /> }
                    {m.text}
                  </div>
                )}
                <div className="faint">
                  {m.type} · importance {m.importance}/3 · {new Date(m.createdAt).toLocaleDateString()}
                  {m.superseded && " · superseded"}
                </div>
              </div>
              <div className="row" style={{ flexShrink: 0 }}>
                <button className="btn sm" title={m.pinned ? "Unpin" : "Pin to canon (always in prompt)"}
                  onClick={() => commit(memories.map((x) => (x.id === m.id ? { ...x, pinned: !x.pinned } : x)))}>
                  <Icon name="pin" size={12} />
                </button>
                <button className="btn sm" title="Edit" onClick={() => setEditing(m.id)}><Icon name="edit" size={12} /></button>
                <button className="btn sm" title={m.archived ? "Restore" : "Archive (kept, never recalled)"}
                  onClick={() => commit(memories.map((x) => (x.id === m.id ? { ...x, archived: !x.archived } : x)))}>
                  <Icon name="archive" size={12} />
                </button>
                <button className="btn sm danger" title="Delete forever"
                  onClick={() => commit(memories.filter((x) => x.id !== m.id))}><Icon name="trash" size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
