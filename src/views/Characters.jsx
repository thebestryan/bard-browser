import React, { useState } from "react";
import { uid, useStore } from "../store";
import { AICreator, Avatar, DeleteButton, Empty, Field, ImagePicker, Modal, PageHead, ProfileCard, RefPhotos } from "../components/UI";
import { impactSummary } from "../lib/cascade";
import { generateCharacter } from "../lib/ai";
import { importCharacterFile, exportPngCard, toSTCard, downloadJSON, downloadBlob } from "../lib/stio";
import CardBrowser from "../components/CardBrowser";
import Icon from "../components/Icon";

export default function Characters({ startChat }) {
  const { state, add, activeProfile, removeCascade, deletionImpact } = useStore();
  const [edit, setEdit] = useState(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const fileRef = React.useRef(null);

  const doImport = async (e) => {
    for (const f of e.target.files || []) {
      try {
        const c = await importCharacterFile(f);
        add("characters", c);
      } catch (err) {
        alert(`Could not import "${f.name}": ${err.message || err}`);
      }
    }
    e.target.value = "";
  };

  return (
    <div>
      <PageHead title="Characters" sub="Character cards with appearance, personality, greetings and example dialogue. Imports accept SillyTavern PNG/JSON cards plus best-effort Marinara/Horde files. Exports are SillyTavern-compatible.">
        <input ref={fileRef} type="file" multiple accept=".json,.png,.horde,.horde_human" style={{ display: "none" }} onChange={doImport} />
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} /> Import Card</button>
        <button className="btn" onClick={() => setBrowseOpen(true)}><Icon name="globe" size={13} /> Browse Cards</button>
        <button className="btn" onClick={() => setEdit("manual")}>＋ Blank Character</button>
      </PageHead>

      {browseOpen && (
        <CardBrowser
          onClose={() => setBrowseOpen(false)}
          onImported={() => setBrowseOpen(false)}
        />
      )}

      <AICreator
        title="AI Character Creator"
        placeholder="e.g. A grumpy lighthouse keeper who secretly writes romance novels"
        chips={[
          "Street-smart courier in a neon city",
          "Knight who lost her memory",
          "Talkative tavern cat (small magic)",
          "Rival adventurer with a soft side",
        ]}
        onGenerate={async (idea, opts) => {
          const c = await generateCharacter(activeProfile("text"), idea, opts);
          add("characters", c);
        }}
      />

      {state.characters.length === 0 ? (
        <Empty icon="masks" title="No characters yet">
          One line of suggestion is enough for the AI to build a full card.
        </Empty>
      ) : (
        <div className="grid cards">
          {state.characters.map((c) => {
            // most recent chat with this character, for the last-line preview
            const chat = state.chats
              .filter((x) => (x.characterIds || [x.characterId]).includes(c.id))
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
            const last = chat?.messages?.[chat.messages.length - 1];
            return (
              <ProfileCard
                key={c.id}
                name={c.name}
                image={c.portrait?.dataURL}
                meta={(c.tags || []).slice(0, 3).join(" · ") || undefined}
                description={c.personality || c.appearance}
                preview={last ? `${last.role === "user" ? "You: " : ""}${last.text}` : ""}
                onClick={() => setEdit(c)}
                actions={
                  <>
                    <button className="btn sm primary" onClick={() => startChat(c.id)}>
                      <Icon name="message" size={12} /> Chat
                    </button>
                    <button className="btn sm" onClick={() => setEdit(c)}>Edit</button>
                    <button className="btn sm" title="SillyTavern V2 JSON card"
                      onClick={() => downloadJSON(toSTCard(c), `${c.name.replace(/[^\w-]+/g, "_")}.json`)}>JSON</button>
                    <button className="btn sm" title="SillyTavern PNG card"
                      onClick={async () => downloadBlob(await exportPngCard(c), `${c.name.replace(/[^\w-]+/g, "_")}.png`)}>PNG</button>
                    <DeleteButton
                      what="character"
                      name={c.name}
                      impact={impactSummary(deletionImpact("characters", c.id))}
                      onConfirm={() => removeCascade("characters", c.id)}
                      label=""
                    />
                  </>
                }
              />
            );
          })}
        </div>
      )}

      {edit && <CharEditor c={edit === "manual" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CharEditor({ c, onClose }) {
  const { add, patch } = useStore();
  // lazy initializer: don't mint an id/timestamp on every render
  const [ch, setCh] = useState(() => c || {
    id: uid(), name: "", tags: [], appearance: "", personality: "",
    scenario: "", greeting: "", examples: [], createdAt: Date.now(),
  });
  const set = (k, v) => setCh((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (c) patch("characters", c.id, ch);
    else add("characters", ch);
    onClose();
  };
  return (
    <Modal title={c ? `Edit — ${ch.name}` : "New Character"} onClose={onClose}>
      <div className="profile-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <Avatar name={ch.name} src={ch.portrait?.dataURL} size={96} />
          <ImagePicker
            align="left"
            category="characters"
            kind="portrait"
            refs={ch.refs || []}
            value={ch.portrait?.dataURL}
            prompt={`Character portrait of ${ch.name || "a character"}: ${ch.appearance || ch.personality || ""}`}
            onChange={(img) => set("portrait", img)}
            label={ch.portrait?.dataURL ? "Change" : "Add image"}
          />
        </div>
        <div className="who">
          <Field label="Name"><input value={ch.name} onChange={(e) => set("name", e.target.value)} /></Field>
        </div>
      </div>
      <Field label="Tags (comma separated)"><input value={(ch.tags || []).join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></Field>
      <Field label="Appearance"><textarea value={ch.appearance} onChange={(e) => set("appearance", e.target.value)} /></Field>
      <Field label="Personality"><textarea value={ch.personality} onChange={(e) => set("personality", e.target.value)} /></Field>
      <Field label="Scenario"><textarea value={ch.scenario} onChange={(e) => set("scenario", e.target.value)} /></Field>
      <Field label="Greeting (first message)"><textarea value={ch.greeting} onChange={(e) => set("greeting", e.target.value)} /></Field>
      <Field label="Example dialogue (one per line)"><textarea value={(ch.examples || []).join("\n")} onChange={(e) => set("examples", e.target.value.split("\n").filter(Boolean))} /></Field>
      <label>Reference photos (model sheet — face, body, sides)</label>
      <RefPhotos refs={ch.refs || []} category="characters" onChange={(refs) => set("refs", refs)} />
      <div className="row mt">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!ch.name.trim()}>Save</button>
      </div>
    </Modal>
  );
}
