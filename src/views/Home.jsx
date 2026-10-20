import React from "react";
import { useStore } from "../store";
import Icon from "../components/Icon";

export default function Home({ go, onNewStory }) {
  const { state } = useStore();
  const tiles = [
    { icon: "compass", title: "New Story", desc: "Combine persona, characters, world and scenario into one scene", onClick: onNewStory, highlight: true },
    { icon: "globe", title: "Worlds", desc: "Persistent living worlds with locations, NPCs, factions and consequences", view: "worlds", count: state.worlds.length },
    { icon: "masks", title: "Characters", desc: "Create or import character cards — with AI assistance", view: "characters", count: state.characters.length },
    { icon: "user", title: "Personas", desc: "Who you are in the story", view: "personas", count: state.personas.length },
    { icon: "film", title: "Scenarios", desc: "Ready-to-play setups", view: "scenarios", count: state.scenarios.length },
    { icon: "users", title: "Virtual Humans", desc: "People with routines, moods and lives of their own", view: "virtualhumans", count: state.virtualHumans.length },
    { icon: "message", title: "Chats", desc: "Roleplay conversations with world context", view: "chats", count: state.chats.length },
    { icon: "book", title: "Lorebooks", desc: "Keyword-triggered world info", view: "lorebooks", count: state.lorebooks.length },
    { icon: "sliders", title: "Presets", desc: "Prompt ordering and generation settings", view: "presets", count: state.presets.length },
    { icon: "folder", title: "User Files", desc: "Your uploads, labeled and never renamed", view: "files", count: (state.userFiles || []).length },
  ];

  return (
    <div>
      <div className="card mb" style={{ borderLeft: "2px solid var(--accent)", padding: "26px 28px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
          What reality will you command today?
        </h2>
        <div className="muted" style={{ maxWidth: 640 }}>
          Design the players. Establish the stakes. Control the narrative. Generate complex lore and deep scenarios from a single line.
        </div>
      </div>
      <div className="grid cols-3">
        {tiles.map((t) => (
          <div key={t.title} className={`card hoverable ${t.highlight ? "highlight" : ""}`} onClick={() => (t.onClick ? t.onClick() : go(t.view))}
            style={t.highlight ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}>
            <div className="row">
              <Icon name={t.icon} size={22} style={{ color: "var(--accent)" }} />
              <div className="grow">
                <div style={{ fontWeight: 650 }}>{t.title}</div>
                <div className="micro">{t.count} saved</div>
              </div>
            </div>
            <div className="muted mt" style={{ fontSize: 12 }}>{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
