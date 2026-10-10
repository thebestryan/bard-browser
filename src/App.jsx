import React, { useState } from "react";
import { StoreProvider, uid, useStore } from "./store";
import ErrorBoundary from "./components/ErrorBoundary";
import { QuitButton } from "./components/UI";
import "./theme.css";
import Icon from "./components/Icon";
import { genbus } from "./lib/genbus";
import Home from "./views/Home";
import Worlds from "./views/Worlds";
import WorldPlay from "./views/WorldPlay";
import Characters from "./views/Characters";
import Chats from "./views/Chats";
import Settings from "./views/Settings";
import Files from "./views/Files";
import { Personas, Scenarios, VirtualHumans } from "./views/Sims";
import { Lorebooks, Presets } from "./views/LorePresets";

const NAV = [
  { id: "home", icon: "home", label: "Home" },
  { id: "worlds", icon: "globe", label: "Worlds" },
  { id: "characters", icon: "masks", label: "Characters" },
  { id: "personas", icon: "user", label: "Personas" },
  { id: "scenarios", icon: "film", label: "Scenarios" },
  { id: "virtualhumans", icon: "users", label: "Virtual Humans" },
  { id: "chats", icon: "message", label: "Chats" },
  { id: "lorebooks", icon: "book", label: "Lorebooks" },
  { id: "presets", icon: "sliders", label: "Presets" },
  { id: "files", icon: "folder", label: "User Files" },
  { id: "settings", icon: "settings", label: "Settings" },
];

function Shell() {
  const { activeProfile, add, ready, saveError, cryptoError } = useStore();
  const [view, setView] = useState("home");
  const [activeChatId, setActiveChatId] = useState(null);
  const [playingWorld, setPlayingWorld] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const go = (v) => { setView(v); setActiveChatId(null); setPlayingWorld(null); setComposerOpen(false); };

  const [splashPhase, setSplashPhase] = React.useState("wait"); // wait | play | fading | done
  React.useEffect(() => {
    if (splashPhase !== "wait") return undefined;
    const t = setTimeout(() => setSplashPhase("play"), 1000);
    return () => clearTimeout(t);
  }, [splashPhase]);
  React.useEffect(() => {
    if (splashPhase !== "fading") return undefined;
    const t = setTimeout(() => setSplashPhase("done"), 700);
    return () => clearTimeout(t);
  }, [splashPhase]);


  /* Background generation status: indicator + toasts. */
  const [genCount, setGenCount] = React.useState(0);
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => genbus.subscribe((ev) => {
    if (ev.type === "start") {
      setGenCount((n) => n + 1);
    } else if (ev.type === "done") {
      setGenCount((n) => Math.max(0, n - 1));
      const id = ev.id;
      const toast = {
        id, ok: ev.ok,
        text: ev.ok ? `${ev.label || "Generation"} finished` : `${ev.label || "Generation"} failed — ${ev.detail.slice(0, 80)}`,
      };
      setToasts((t) => [...t.slice(-2), toast]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    }
  }), []);

  const appLoaded = ready && splashPhase !== "wait";
  if (!appLoaded) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)" }}>
        <div style={{ textAlign: "center" }}>
          <div className="brand-name" style={{ fontSize: 44, marginBottom: 12, color: "var(--accent)" }}>B</div>
          <div className="micro">Loading your world</div>
        </div>
      </div>
    );
  }

  /* Splash intro: after the app has loaded (1s), play /Splash.mp4 once, then enter the UI. */

  const profile = activeProfile("text");
  const connected = profile && !profile.isMock;

  const titles = {
    home: ["Home", "Your creative studio"],
    worlds: ["Worlds", "Persistent living settings"],
    characters: ["Characters", "Cast of your stories"],
    personas: ["Personas", "Your in-story identity"],
    scenarios: ["Scenarios", "Story setups"],
    virtualhumans: ["Virtual Humans", "Autonomous simulated people"],
    chats: ["Chats", "Roleplay conversations"],
    lorebooks: ["Lorebooks", "Keyword-triggered world info"],
    presets: ["Presets", "Prompt ordering & parameters"],
    files: ["User Files", "Clearly labeled, original filenames"],
    settings: ["Settings", "Providers, data and privacy"],
  };

  const body = () => {
    if (playingWorld) return <WorldPlay worldId={playingWorld} exit={() => { setPlayingWorld(null); setView("worlds"); }} />;
    switch (view) {
      case "home": return <Home go={go} onNewStory={() => { setView("chats"); setComposerOpen(true); }} />;
      case "worlds": return <Worlds playWorld={setPlayingWorld} />;
      case "characters": return <Characters startChat={(cid) => {
        const chat = { id: uid(), characterId: cid, worldId: null, messages: [], createdAt: Date.now() };
        add("chats", chat);
        setActiveChatId(chat.id);
        setView("chats");
      }} />;
      case "personas": return <Personas />;
      case "scenarios": return <Scenarios />;
      case "virtualhumans": return <VirtualHumans />;
      case "chats": return <Chats activeChatId={activeChatId} setActiveChatId={setActiveChatId} composerOpen={composerOpen} setComposerOpen={setComposerOpen} />;
      case "lorebooks": return <Lorebooks />;
      case "presets": return <Presets />;
      case "files": return <Files />;
      case "settings": return <Settings />;
      default: return <Home go={go} onNewStory={() => { setView("chats"); setComposerOpen(true); }} />;
    }
  };

  return (
    <div className="app">
      {splashPhase !== "done" && (
        <div
          className="splash"
          style={{ opacity: splashPhase === "fading" ? 0 : 1, pointerEvents: splashPhase === "play" ? "auto" : "none" }}
          onClick={() => splashPhase === "play" && setSplashPhase("fading")}
        >
          {splashPhase === "play" && (
            <video
              className="splash-video"
              src="/Splash.mp4"
              autoPlay
              muted
              playsInline
              onEnded={() => setSplashPhase("fading")}
            />
          )}
          {splashPhase === "play" && <div className="micro splash-skip">Click to skip</div>}
        </div>
      )}
      <div className="sidebar">
        <div className="brand">
          <img src="/BardBrowser.jpeg" alt="Bard Browser" className="brand-mark" />
          <div>
            <div className="brand-name">Bard Browser</div>
            <div className="brand-sub">Persistent AI Worlds</div>
          </div>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${view === n.id && !playingWorld ? "active" : ""}`} onClick={() => go(n.id)}>
            <Icon name={n.icon} size={15} /> {n.label}
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`status-dot ${connected ? "connected" : ""}`} />
            <span className="grow">{connected ? profile.name : "Mock mode — add a provider"}</span>
          </div>
          <QuitButton />
        </div>
      </div>
      <div className="main">
        {!playingWorld && (
          <div className="topbar">
            <h1>{titles[view]?.[0]}</h1>
            <span className="sub">{titles[view]?.[1]}</span>
            <div className="spacer" />
            <span className="tag accent">{profile?.name || "Mock"}</span>
            {genCount > 0 && (
              <span className="tag" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
                <Icon name="spark" size={11} style={{ animation: "spin 2s linear infinite" }} /> generating × {genCount}
              </span>
            )}
            {saveError && <span className="badge red" title={saveError}>save error</span>}
            {cryptoError && (
              <span className="badge red" title="WebCrypto unavailable — API keys are not being saved. Use https:// or http://localhost. See Settings.">
                keys not saved
              </span>
            )}
          </div>
        )}
        <div className="content" style={playingWorld ? { padding: 0, overflow: "hidden" } : undefined}>
          {/* keyed so switching view remounts the boundary and clears a failure */}
          <ErrorBoundary key={`${view}:${activeChatId}:${playingWorld}`}>{body()}</ErrorBoundary>
        </div>
      </div>
      {toasts.length > 0 && (
        <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 500, display: "flex", flexDirection: "column", gap: 8 }}>
          {toasts.map((t) => (
            <div key={t.id} className="card" style={{
              padding: "10px 14px", maxWidth: 340, fontSize: 12,
              borderColor: t.ok ? "var(--border-strong)" : "var(--red)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
            }}>
              <div style={{ fontWeight: 650, color: t.ok ? "var(--accent)" : "var(--red)" }}>
                {t.ok ? "Generation finished" : "Generation failed"}
              </div>
              <div className="faint" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
