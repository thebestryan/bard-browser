import React, { useEffect, useRef, useState } from "react";
import { uid, useStore } from "../store";
import { CoverImage, DeleteButton, Empty, Field, ImagePicker, Modal, PageHead } from "../components/UI";
import { callChat, textParams, extractReasoning, filterReasoningStream, generateImage, generatedFileEntry } from "../lib/ai";
import { toSTChatJSONL, toPlainTextChat, importChatFile, downloadBlob } from "../lib/stio";
import {
  AGENTS,
  initialAgentState,
  runTrackerAgents,
  runCYOA,
  runLorebookKeeper,
  applyTrackerOutput,
} from "../lib/agents";
import { integrateMemories, recallMemories } from "../lib/memory";
import { activePreset, assemblePrompt, extractOOC, insertAtDepth, substituteMacros } from "../lib/prompt";
import { genbus, runDetached } from "../lib/genbus";
import { mechanicsPromptBlock } from "../lib/mechanics";
import { agentInstructions, engineEnabledFromPresets, genderPromptLine, generationDirectives } from "../lib/presets";
import { applyPreGenUpdates, runPreGen, stateBlocks } from "../lib/pipeline";
import { decideVisuals } from "../lib/visual";
import MemoryInspector from "../components/MemoryInspector";
import MechanicsPanel from "../components/MechanicsPanel";
import Icon from "../components/Icon";
import { Avatar } from "../components/UI";

/**
 * Background reply tasks — replies keep generating (and streaming into
 * runningReplies) even after the chat view is closed.
 */
const runningReplies = new Map(); // chatId -> { text }
let replySeq = 0;

function generateReplyDetached({ genbus, patch, getState, chatId, speakerName, payload, profile, params, replyId }) {
  const stream = { text: "" };
  runningReplies.set(chatId, stream);
  genbus.emit({ type: "chat-stream", chatId, text: "" });
  const taskId = genbus.start(`Reply — ${speakerName}`);
  const filter = filterReasoningStream((d) => {
    stream.text += d;
    genbus.emit({ type: "chat-stream", chatId, text: stream.text });
  });
  return callChat(profile, payload, {
    ...params,
    onDelta: filter.onDelta,
  }).then((out) => {
    const s = getState();
    const chat = s.chats.find((c) => c.id === chatId);
    if (chat) {
      const msgs = [...(chat.messages || [])];
      const last = msgs[msgs.length - 1];
      const placeholder = last && last.role === "assistant" && last.id === replyId;
      const reply = { id: replyId, role: "assistant", text: out.content, swipes: [out.content], swipeReasoning: [out.reasoning], swipeIdx: 0 };
      if (placeholder) msgs[msgs.length - 1] = reply;
      else msgs.push(reply);
      patch("chats", chatId, { messages: msgs });
    }
    runningReplies.delete(chatId);
    genbus.done(taskId, true, "Reply ready");
    genbus.emit({ type: "chat-stream", chatId, text: null, finished: true });
  }).catch((e) => {
    runningReplies.delete(chatId);
    genbus.done(taskId, false, String(e?.message || e));
    genbus.emit({ type: "chat-stream", chatId, text: null, finished: true });
    throw e;
  });
}

function ReasoningBlock({ text }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return null;
  return (
    <div className="reasoning-block">
      <button className="btn sm ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide thinking" : "Show thinking"}
      </button>
      {open && (
        <pre style={{
          margin: "6px 0 0",
          padding: "8px 10px",
          borderRadius: 6,
          background: "rgba(0,0,0,0.25)",
          color: "var(--text-dim)",
          whiteSpace: "pre-wrap",
          fontSize: "0.6875rem",
          lineHeight: 1.45,
          maxHeight: 240,
          overflow: "auto",
        }}>
          {text}
        </pre>
      )}
    </div>
  );
}

export default function Chats({ activeChatId, setActiveChatId, composerOpen, setComposerOpen }) {
  const { state, add, patch, remove } = useStore();
  const fileRef = React.useRef(null);

  const doImportChat = async (e) => {
    for (const f of e.target.files || []) {
      try {
        const msgs = await importChatFile(f);
        add("chats", {
          id: uid(),
          characterId: state.characters[0]?.id || null,
          worldId: null,
          messages: msgs,
          createdAt: Date.now(),
        });
      } catch (err) {
        alert(`Could not import "${f.name}": ${err.message || err}`);
      }
    }
    e.target.value = "";
  };

  if (activeChatId) return <ChatRoom chatId={activeChatId} back={() => setActiveChatId(null)} />;
  return (
    <div>
      <PageHead title="Chats" sub="Roleplay conversations that carry world context, lorebooks and personas. Exports are SillyTavern-compatible.">
        <input ref={fileRef} type="file" multiple accept=".jsonl,.json" style={{ display: "none" }} onChange={doImportChat} />
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} /> Import ST Chat</button>
        <button className="btn primary" onClick={() => setComposerOpen(true)}><Icon name="compass" size={13} /> New Story</button>
      </PageHead>
      {composerOpen && <StoryComposer onClose={() => setComposerOpen(false)} onCreated={(id) => { setComposerOpen(false); setActiveChatId(id); }} />}
      {state.chats.length === 0 ? (
        <Empty icon="message" title="No chats yet">Open a character and start a conversation.</Empty>
      ) : (
        <div className="grid cards">
          {state.chats.map((c) => {
            const ch = state.characters.find((x) => x.id === c.characterId);
            const world = c.worldId ? state.worlds.find((w) => w.id === c.worldId) : null;
            const scen = c.scenarioId ? state.scenarios.find((x) => x.id === c.scenarioId) : null;
            const persona = state.personas.find((x) => x.id === c.personaId);
            const last = c.messages?.[c.messages.length - 1];
            const fileBase = `chat-${(ch?.name || "chat").replace(/[^\w-]+/g, "_")}`;
            return (
              <div key={c.id} className="card cover-card hoverable" onClick={() => setActiveChatId(c.id)}>
                <CoverImage
                  value={c.cover}
                  fallback={world?.background || scen?.cover}
                  onChange={(img) => patch("chats", c.id, { cover: img })}
                  category="backgrounds"
                  prompt={[ch?.name, scen?.title, world?.name].filter(Boolean).join(" — ") || "A roleplay scene"}
                  alt=""
                />
                <div className="cover-body">
                  <div className="row" style={{ gap: 12 }}>
                    <Avatar name={ch?.name} src={ch?.portrait?.dataURL} size={44} />
                    <div className="grow">
                      <div className="cover-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ch?.name || "Unknown"}{c.characterIds?.length > 1 ? ` +${c.characterIds.length - 1}` : ""}
                      </div>
                      <div className="faint">
                        {c.messages?.length || 0} messages · {new Date(c.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  {(world || scen || persona) && (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {world && <span className="chip-soft">{world.name}</span>}
                      {scen && <span className="chip-soft">{scen.title}</span>}
                      {persona && <span className="chip-soft">as {persona.name}</span>}
                    </div>
                  )}
                  <div className="last-line">{last ? `${last.role === "user" ? "You: " : ""}${last.text}` : "No messages yet"}</div>
                </div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm primary" style={{ flex: 1 }} onClick={() => setActiveChatId(c.id)}>Open chat</button>
                  <button className="btn sm" title="SillyTavern JSONL"
                    onClick={() => downloadBlob(new Blob([toSTChatJSONL(c, ch?.name, persona?.name || state.personas[0]?.name)], { type: "application/jsonl" }), `${fileBase}.jsonl`)}>
                    <Icon name="download" size={12} /> JSONL
                  </button>
                  <button className="btn sm" title="Plain text"
                    onClick={() => downloadBlob(new Blob([toPlainTextChat(c.messages, ch?.name, persona?.name || state.personas[0]?.name)], { type: "text/plain" }), `${fileBase}.txt`)}>
                    <Icon name="download" size={12} /> TXT
                  </button>
                  <DeleteButton what="chat" name={`${ch?.name || "Unknown"} — ${c.messages?.length || 0} messages`} onConfirm={() => remove("chats", c.id)} label="" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChatRoom({ chatId, back }) {
  const { state, patch, add, getState, activeProfile } = useStore();
  const abortRef = useRef(null);
  // a reply that is still streaming in the background for this chat
  const bgStream = runningReplies.get(chatId) || null;
  const chat = state.chats.find((c) => c.id === chatId);
  const character = state.characters.find((c) => c.id === chat?.characterId);
  const persona = state.personas.find((p) => p.id === chat?.personaId) || state.personas[0];
  const world = chat?.worldId ? state.worlds.find((w) => w.id === chat.worldId) : null;
  const scenario = state.scenarios.find((s) => s.id === chat?.scenarioId);
  // group scene support: who is currently replying
  const speaker = state.characters.find((c) => c.id === (chat?.speakerId || chat?.characterId)) || character;
  const group = (chat?.characterIds || [chat?.characterId])
    .filter((id) => id && id !== speaker?.id)
    .map((id) => state.characters.find((c) => c.id === id))
    .filter(Boolean);
  const profile = activeProfile("text");
  const params = textParams(state, profile);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState(null); // live text while streaming
  const [streamIdx, setStreamIdx] = useState(-1);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [mechOpen, setMechOpen] = useState(false);
  const logRef = useRef(null);
  const aliveRef = React.useRef(true);
  React.useEffect(() => () => { aliveRef.current = false; }, []);

  // ensure agent + memory state exists for this chat
  React.useEffect(() => {
    if (chat && !chat.agentState) patch("chats", chat.id, { agentState: initialAgentState() });
    if (chat && !chat.memories) patch("chats", chat.id, { memories: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, !!chat?.agentState, !!chat?.memories]);
  // Global agent presets seed every chat; a per-chat switch wins once touched.
  const rawAgentState = chat?.agentState || initialAgentState();
  const agentState = {
    ...initialAgentState(),
    ...rawAgentState,
    enabled: { ...engineEnabledFromPresets(state.presetSystem), ...(rawAgentState.enabled || {}) },
  };

  /** Macro values for {{char}}/{{user}}/… substitution in user input, notes and preset literals. */
  const macroOpts = {
    char: speaker?.name || "",
    user: persona?.name || "the user",
    persona: persona?.description || persona?.voice || "",
    description: speaker?.appearance || "",
    personality: speaker?.personality || "",
    scenario: speaker?.scenario || scenario?.summary || "",
    scene: scenario?.summary || world?.description || "",
    world: world?.description || "",
  };
  const stripOOC = (t) => extractOOC(t).clean.trim();

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [editDraft, setEditDraft] = useState("");

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat?.messages, busy, streamText]);

  if (!chat || !character) return <div className="content">Chat not found.</div>;

  const msgs = chat.messages || [];
  const setMsgs = (next) => patch("chats", chat.id, { messages: next });

  // global text + per-chat toggle (undefined = inherit the Settings default)
  const jailbreakOn = (chat.jailbreak ?? state.jailbreak?.enabled) && !!state.jailbreak?.text?.trim();
  const withJailbreak = (payload) =>
    jailbreakOn ? [...payload, { role: "system", content: state.jailbreak.text.trim() }] : payload;

  const stop = () => abortRef.current?.abort(new Error("Stopped."));

  /**
   * System prompt for this scene, as role-keyed blocks. Used by send AND
   * reroll so they match, and ordered by the linked preset's sections.
   */
  const buildSystem = (query, { reroll = false, runtime } = {}) => {
    const live = runtime?.agentState || agentState;
    // Pre-gen hands us the exact lore it selected; fall back to keyword match.
    const lore = runtime && "loreText" in runtime
      ? runtime.loreText
      : (state.lorebooks || [])
          .flatMap((b) => b.entries || [])
          .filter((e) =>
            (e.keys || []).some((k) => k && k.trim() && query.toLowerCase().includes(k.toLowerCase().trim()))
          )
          .map((e) => e.content)
          .join("\n");

    const memoryLines = [
      (chat.memories || []).length
        ? `Durable memories (canon):\n${recallMemories(chat.memories, query).map((m) => `- ${m.text}`).join("\n")}`
        : "",
      live.memory?.length
        ? `Long-term memory: ${live.memory.slice(-5).map((m) => m.text).join("; ")}`
        : "",
    ].filter(Boolean).join("\n");

    const speakerGender = genderPromptLine(speaker.gender);
    const personaGender = genderPromptLine(persona?.gender);

    const blocks = {
      system: `You are ${speaker.name}.${speakerGender ? ` ${speakerGender}` : ""} ${speaker.personality || ""}`
        + (reroll ? "\nGive a different response than before." : ""),
      character: [
        speaker.appearance ? `Appearance: ${speaker.appearance}` : "",
        speaker.scenario ? `Scenario: ${speaker.scenario}` : "",
        group.length
          ? `Also in the scene: ${group.map((g) => `${g.name} (${g.personality || "present"})`).join("; ")}. You may reference and speak about them.`
          : "",
      ].filter(Boolean).join("\n"),
      scenario: scenario ? `Story setup: ${scenario.title} — ${scenario.summary}` : "",
      context: [
        world ? `World: ${world.name} — ${world.description}` : "",
        live.emotion ? `Your current emotion: ${live.emotion}` : "",
        mechanicsPromptBlock(chat.mechanics),
      ].filter((x) => x && String(x).trim()).join("\n"),
      lore: lore ? `Lore:\n${lore}` : "",
      memory: memoryLines,
      instructions: params.style ? `Style: ${params.style}` : "",
      persona: `You speak with ${persona?.name || "the user"} (${persona?.voice || persona?.description || ""}).${personaGender ? ` ${personaGender}` : ""} Stay in character.`,
    };
    const assembled = assemblePrompt(blocks, activePreset(state, profile), {
      char: speaker.name,
      user: persona?.name || "the user",
      persona: persona?.description || persona?.voice || "",
      description: speaker.appearance || "",
      personality: speaker.personality || "",
      scenario: speaker.scenario || scenario?.summary || "",
    });
    // Deterministic state is always injected, even when a linked ST preset
    // carries its own literal sections. Tone/format/boundaries follow it.
    return [
      assembled,
      stateBlocks(live),
      generationDirectives(state),
    ].filter(Boolean).join("\n\n");
  };

  /* ---- Agents & Trackers ---- */
  const runAgents = async (finalMsgs) => {
    // Post-gen runs in the background: read the freshly committed state so a
    // pre-gen update from this same turn is never overwritten.
    const fresh = getState().chats.find((c) => c.id === chat.id);
    const stored = fresh?.agentState || chat.agentState || initialAgentState();
    const as = {
      ...agentState,
      ...stored,
      enabled: { ...engineEnabledFromPresets(state.presetSystem), ...(stored.enabled || {}) },
    };
    const trackersOn = AGENTS.some((a) => as.enabled[a.id]);
    const agentCfg = state.presetSystem?.agents || {};
    const illustratorOn = !!agentCfg.illustrator?.enabled;
    const backgroundOn = !!agentCfg.background?.enabled;
    const visualOn = illustratorOn || backgroundOn;
    if (!trackersOn && !visualOn) return;
    const ms = finalMsgs || msgs;
    setAgentBusy(true);
    try {
      if (trackersOn) {
        const out = await runTrackerAgents({
          profile, params, messages: ms, character, agentState: as, world,
          extraInstructions: agentInstructions(state.presetSystem),
        });
        const next = applyTrackerOutput(as, out);
        next.lastRunMessageCount = ms.length;
        // persist only explicit per-chat overrides; global agent presets stay live
        next.enabled = stored.enabled || {};
        if (out.facts?.length) {
          const { memories } = integrateMemories(chat.memories || [], out.facts.map((text) => ({ text, type: "fact", importance: 2, source: "worldState" })));
          patch("chats", chat.id, { memories });
        }
        if (as.enabled.lorebookKeeper) {
          const entries = await runLorebookKeeper({ profile, messages: ms, character });
          if (entries.length) {
            let book = state.lorebooks.find((b) => b.name === "Story Lore");
            if (!book) {
              book = { id: uid(), name: "Story Lore", entries, createdAt: Date.now() };
              add("lorebooks", book);
            } else {
              const merged = [...book.entries, ...entries.filter((e) => !book.entries.some((x) => x.content === e.content))];
              patch("lorebooks", book.id, { entries: merged });
            }
          }
        }
        if (as.enabled.cyoa) {
          next.lastChoices = await runCYOA({ profile, messages: ms, character, world });
        }
        patch("chats", chat.id, { agentState: next });
      }

      /* ---- Visual agents: decide, render, attach ---- */
      if (visualOn) {
        const decision = await decideVisuals({ profile, messages: ms, character, world, chat });
        const imageProfile = activeProfile("image");
        const refs = (character?.refs || [])
          .map((r) => (typeof r === "string" ? r : r?.dataURL))
          .filter(Boolean);
        const styled = (txt) => (imageProfile?.style ? `${txt}, ${imageProfile.style}` : txt);

        if (illustratorOn && decision.illustrate && decision.illustrationPrompt) {
          const latest = getState().chats.find((c) => c.id === chat.id);
          const latestMsgs = latest?.messages || ms;
          const lastAssistant = [...latestMsgs].reverse().find((m) => m.role === "assistant");
          const recentIllustrated = latestMsgs.slice(-6).some((m) => m.image?.dataURL);
          if (lastAssistant && !lastAssistant.image?.dataURL && !recentIllustrated) {
            const img = await generateImage(imageProfile, styled(decision.illustrationPrompt), {
              size: imageProfile?.size || "1024x576",
              refs,
            });
            add("userFiles", generatedFileEntry(
              "illustrations", "illustration",
              decision.illustrationPrompt.slice(0, 40), img
            ));
            const after = getState().chats.find((c) => c.id === chat.id);
            patch("chats", chat.id, {
              messages: (after?.messages || latestMsgs).map((m) =>
                m.id === lastAssistant.id
                  ? { ...m, image: { ...img, createdAt: Date.now() } }
                  : m
              ),
            });
          }
        }

        if (backgroundOn && decision.backgroundPrompt) {
          const latest = getState().chats.find((c) => c.id === chat.id);
          const hasAsset = latest?.background?.dataURL || world?.background?.dataURL;
          if (!hasAsset && illustratorOn) {
            const img = await generateImage(imageProfile, styled(decision.backgroundPrompt), {
              size: imageProfile?.size || "1024x576",
            });
            add("userFiles", generatedFileEntry(
              "backgrounds", "background",
              decision.backgroundPrompt.slice(0, 40), img
            ));
            patch("chats", chat.id, {
              background: { ...img, createdAt: Date.now() },
              backgroundPrompt: decision.backgroundPrompt,
            });
          } else {
            // an existing world/chat asset wins; keep the prompt for the HUD
            patch("chats", chat.id, { backgroundPrompt: decision.backgroundPrompt });
          }
        }
      }
    } catch (e) {
      console.warn("Agent run failed:", e);
    } finally {
      setAgentBusy(false);
    }
  };

  const toggleAgent = (id) => {
    const enabled = { ...agentState.enabled, [id]: !agentState.enabled[id] };
    patch("chats", chat.id, { agentState: { ...agentState, enabled } });
  };

  const send = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const userMsg = { id: uid(), role: "user", text };
    setMsgs([...msgs, userMsg]);
    setBusy(true);
    try {
      // --- Phase 1: pre-gen routing (lore, world state, dice) ---
      let pre = { updates: {}, loreText: "", dice: null };
      try {
        pre = await runPreGen({
          profile, state, chat, character: speaker, persona, world,
          userText: text, agentState, presetSystem: state.presetSystem,
        });
      } catch {
        // routing must never block a reply
      }
      const { background: backgroundAsset, ...agentUpdates } = pre?.updates || {};
      const preState = applyPreGenUpdates(agentState, { ...pre, updates: agentUpdates });
      if (Object.keys(agentUpdates).length) {
        patch("chats", chat.id, { agentState: preState });
      }
      // Background agent picked an existing world/chat asset pre-gen.
      if (backgroundAsset && !chat.background?.dataURL) {
        patch("chats", chat.id, { background: backgroundAsset });
      }

      const history = msgs.slice(-12).map((m) => ({
        role: m.role,
        content: substituteMacros(stripOOC(m.text), macroOpts),
      }));
      // [[OOC]] segments become a side-channel instruction, never story text
      const { clean, ooc } = extractOOC(text);
      const conversation = [
        ...history,
        ...(ooc ? [{ role: "system", content: `(OOC instruction — follow it, but do not repeat it verbatim: ${ooc})` }] : []),
        { role: "user", content: substituteMacros(clean || ooc, macroOpts) },
      ];
      // --- Phase 2: lean generation prompt ---
      const systemPrompt = buildSystem(text, {
        runtime: { agentState: preState, loreText: pre.loreText },
      });
      const payload = insertAtDepth(
        [{ role: "system", content: systemPrompt }, ...conversation],
        chat.authorNote?.text?.trim() ? substituteMacros(chat.authorNote.text, macroOpts) : "",
        chat.authorNote?.depth ?? 4,
      );
      // post-history jailbreak instruction, SillyTavern-style
      const finalPayload = withJailbreak(payload);
      const reply = { id: uid(), role: "assistant", text: "", swipes: [""], swipeIdx: 0 };
      setMsgs([...msgs, userMsg, reply]);
      // detached: the reply keeps streaming even if you close this chat;
      // it commits to the store the moment it is done
      generateReplyDetached({
        genbus, patch, getState, chatId: chat.id, speakerName: speaker.name,
        payload: finalPayload, profile, params, replyId: reply.id,
      }).then(() => {
        // agents/tracker sweep runs when this view is still open
        if (aliveRef.current) {
          const fresh = getState().chats.find((c) => c.id === chat.id);
          if (fresh) runAgents(fresh.messages);
        }
      }).catch((e) => {
        if (aliveRef.current) {
          setMsgs([...(getState().chats.find((c) => c.id === chat.id)?.messages || []), {
            id: uid(), role: "assistant", text: "Error: " + (e.message || e),
          }]);
        }
      }).finally(() => {
        if (aliveRef.current) setBusy(false);
      });
    } catch (e) {
      setMsgs([...msgs, userMsg, { id: uid(), role: "assistant", text: "Error: " + (e.message || e) }]);
      setBusy(false);
    }
  };

  const reroll = async (i) => {
    const m = msgs[i];
    if (!m || busy) return;
    setBusy(true);
    try {
      // reroll must use the SAME context as send — world, lore, persona,
      // memories and mechanics included — or rerolls silently degrade
      const lastUser = msgs.slice(0, i).reverse().find((x) => x.role === "user")?.text || "";
      const history = msgs.slice(0, i).slice(-12).map((x) => ({ role: x.role, content: substituteMacros(stripOOC(x.text), macroOpts) }));
      const anText = chat.authorNote?.text?.trim() ? substituteMacros(chat.authorNote.text, macroOpts) : "";
      const rerollPayload = withJailbreak(insertAtDepth(
        [{ role: "system", content: buildSystem(lastUser, { reroll: true }) }, ...history],
        anText,
        chat.authorNote?.depth ?? 4,
      ));
      setStreamText("");
      setStreamIdx(i);
      const out = await runDetached(`Reroll — ${speaker.name}`, callChat(profile, rerollPayload, {
        ...params,
        onDelta: (d) => setStreamText((t) => (t || "") + d),
      }));
      setStreamText(null);
      setStreamIdx(-1);
      const next = [...msgs];
      const prevSwipes = m.swipes || [m.text];
      const prevReasoning = m.swipeReasoning || new Array(prevSwipes.length).fill("");
      next[i] = { ...m, text: out.content, swipes: [...prevSwipes, out.content], swipeReasoning: [...prevReasoning, out.reasoning], swipeIdx: prevSwipes.length };
      setMsgs(next);
      runAgents(next);
    } catch {
      setStreamText(null);
      setStreamIdx(-1);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const swipe = (i, dir) => {
    const m = msgs[i];
    if (!m?.swipes?.length) return;
    const idx = Math.min(m.swipes.length - 1, Math.max(0, m.swipeIdx + dir));
    const next = [...msgs];
    next[i] = { ...m, swipeIdx: idx, text: m.swipes[idx] };
    if (m.swipeReasoning?.[idx]) next[i].reasoning = m.swipeReasoning[idx];
    else delete next[i].reasoning;
    setMsgs(next);
  };

  const generateNextReply = async (baseMsgs) => {
    setBusy(true);
    try {
      const lastUser = baseMsgs.slice().reverse().find((m) => m.role === "user");
      let pre = { updates: {}, loreText: "", dice: null };
      try {
        pre = await runPreGen({
          profile, state, chat, character: speaker, persona, world,
          userText: lastUser?.text || "", agentState, presetSystem: state.presetSystem,
        });
      } catch {
        // routing must never block a reply
      }
      const { background: backgroundAsset, ...agentUpdates } = pre?.updates || {};
      const preState = applyPreGenUpdates(agentState, { ...pre, updates: agentUpdates });
      if (Object.keys(agentUpdates).length) {
        patch("chats", chat.id, { agentState: preState });
      }
      if (backgroundAsset && !chat.background?.dataURL) {
        patch("chats", chat.id, { background: backgroundAsset });
      }
      const history = baseMsgs.slice(-12).map((m) => ({
        role: m.role,
        content: substituteMacros(stripOOC(m.text), macroOpts),
      }));
      const payload = insertAtDepth(
        [{ role: "system", content: buildSystem(lastUser?.text || "", { runtime: { agentState: preState, loreText: pre.loreText } }) }, ...history],
        chat.authorNote?.text?.trim() ? substituteMacros(chat.authorNote.text, macroOpts) : "",
        chat.authorNote?.depth ?? 4,
      );
      const finalPayload = withJailbreak(payload);
      const reply = { id: uid(), role: "assistant", text: "", swipes: [""], swipeIdx: 0 };
      setMsgs([...baseMsgs, reply]);
      generateReplyDetached({
        genbus, patch, getState, chatId: chat.id, speakerName: speaker.name,
        payload: finalPayload, profile, params, replyId: reply.id,
      }).then(() => {
        if (aliveRef.current) {
          const fresh = getState().chats.find((c) => c.id === chat.id);
          if (fresh) runAgents(fresh.messages);
        }
      }).catch((e) => {
        if (aliveRef.current) {
          setMsgs([...(getState().chats.find((c) => c.id === chat.id)?.messages || []), {
            id: uid(), role: "assistant", text: "Error: " + (e.message || e),
          }]);
        }
      }).finally(() => {
        if (aliveRef.current) setBusy(false);
      });
    } catch (e) {
      setMsgs([...baseMsgs, { id: uid(), role: "assistant", text: "Error: " + (e.message || e) }]);
      setBusy(false);
    }
  };

  const openEdit = (i) => {
    setEditIdx(i);
    setEditDraft(msgs[i]?.text || "");
  };

  const saveEdit = (branch = false) => {
    if (editIdx === null) return;
    const next = [...msgs];
    next[editIdx] = { ...msgs[editIdx], text: editDraft };

    if (branch) {
      const truncated = next.slice(0, editIdx + 1);
      setMsgs(truncated);
      if (truncated[editIdx]?.role === "user") {
        generateNextReply(truncated);
      }
    } else {
      setMsgs(next);
    }
    setEditIdx(null);
    setEditDraft("");
  };

  const branchFrom = (i) => {
    if (!confirm("Branch from this message? Everything after it will be discarded.")) return;
    const truncated = msgs.slice(0, i + 1);
    setMsgs(truncated);
    if (truncated[i]?.role === "user") {
      generateNextReply(truncated);
    }
  };

  const sceneBg = chat.background?.dataURL || world?.background?.dataURL;

  return (
    <div className="chat-wrap" style={{ height: "100%", position: "relative" }}>
      {sceneBg && (
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `url("${String(sceneBg).replace(/"/g, "%22")}")`,
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: 0.16, pointerEvents: "none",
        }} />
      )}
      <div className="chat-pane" style={{ position: "relative", background: sceneBg ? "transparent" : undefined }}>
        <div className="chat-head">
          <button className="btn ghost back" onClick={back} aria-label="Back" title="Back">‹</button>
          <Avatar name={speaker.name} src={speaker.portrait?.dataURL} size={52} />
          <div className="who">
            <div className="name">
              {speaker.name}
              {group.length > 0 && <span className="faint" style={{ fontWeight: 400 }}> with {group.map((g) => g.name).join(", ")}</span>}
            </div>
            <div className="sub">
              {busy
                ? "typing…"
                : [world?.name, scenario?.title, `${msgs.length} message${msgs.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        <div className="chat-log" ref={logRef}>
          {msgs.length === 0 && speaker.greeting && (
            <div className="msg">
              <Avatar name={speaker.name} src={speaker.portrait?.dataURL} size={32} />
              <div><div className="bubble">{speaker.greeting}</div><div className="meta">{speaker.name}</div></div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={m.id || i} className={`msg ${m.role === "user" ? "user" : ""}`}>
              <Avatar name={m.role === "user" ? (persona?.name || "You") : speaker.name} src={m.role === "user" ? persona?.image?.dataURL : speaker.portrait?.dataURL} size={32} />
                <div>
                  <div className="bubble">{streamIdx === i && streamText !== null ? streamText : m.text}</div>
                  {m.image?.dataURL && (
                    <img
                      src={m.image.dataURL}
                      alt={m.image.prompt || "Illustration"}
                      title={m.image.prompt || ""}
                      style={{
                        display: "block", marginTop: 8, width: "100%", maxWidth: 520,
                        borderRadius: 8, border: "1px solid var(--border)",
                      }}
                    />
                  )}
                  {m.role === "assistant" && !(streamIdx === i && streamText !== null) && (
                    <ReasoningBlock text={m.swipeReasoning?.[m.swipeIdx] || m.reasoning || extractReasoning(m.text).reasoning || ""} />
                  )}
                  <div className="meta">
                  {m.role === "user" ? persona?.name || "You" : speaker.name}
                  {m.role === "assistant" && agentState.emotion && agentState.enabled.expression && (
                    <span className="tag accent" style={{ fontSize: 10, padding: "1px 8px" }}>{agentState.emotion}</span>
                  )}
                  {m.swipes?.length > 1 && (
                    <span className="swipe-dots">
                      <button onClick={() => swipe(i, -1)}>‹</button>
                      <b>{m.swipeIdx + 1}/{m.swipes.length}</b>
                      <button onClick={() => swipe(i, 1)}>›</button>
                    </span>
                  )}
                  <span className="actions">
                    {m.role === "assistant" && <button onClick={() => reroll(i)}>↻ Reroll</button>}
                    <button onClick={() => openEdit(i)}>Edit</button>
                    <button onClick={() => branchFrom(i)}>Branch</button>
                    <button onClick={() => setMsgs(msgs.filter((_, j) => j !== i))}>Delete</button>
                  </span>
                </div>
              </div>
            </div>
          ))}
          {bgStream && (
            <div className="msg">
              <Avatar name={speaker.name} src={speaker.portrait?.dataURL} size={32} />
              <div><div className="bubble">{bgStream.text}</div><div className="meta">{speaker.name} · background</div></div>
            </div>
          )}
          {busy && streamText === null && <div className="thinking">{speaker.name} is typing</div>}
        </div>
        <div className="chat-input-bar">
          {agentState.lastChoices?.length > 0 && (
            <div className="chips mb" style={{ marginBottom: 10 }}>
              {agentState.lastChoices.map((c, i) => (
                <button key={i} className="chip" onClick={() => send(c)}>{c}</button>
              ))}
            </div>
          )}
          <div className="box">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              {(chat.characterIds?.length > 1) && (
                <div className="row" style={{ fontSize: 12 }}>
                  <span className="faint">Reply as:</span>
                  <select
                    style={{ width: 180, fontSize: 12 }}
                    value={speaker.id}
                    onChange={(e) => patch("chats", chat.id, { speakerId: e.target.value })}
                  >
                    {[speaker, ...group].map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <textarea
                rows={2}
                value={input}
                placeholder={`Message ${speaker.name}…`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && input.trim()) { e.preventDefault(); send(); }
                }}
              />
            </div>
            {busy
              ? <button className="btn" onClick={stop} title="Stop generating">Stop</button>
              : <button className="btn primary" disabled={!input.trim()} onClick={() => send()}>Send</button>}
            <button className="btn" onClick={() => { setMechOpen((o) => !o); setAgentsOpen(false); }}
              title="RPG mechanics">
              <Icon name="sword" size={13} /> Mech{chat.mechanics?.mode && chat.mechanics.mode !== "off" ? ` (${chat.mechanics.mode})` : ""}
            </button>
            <button className="btn" onClick={() => setNoteOpen(true)} title="Author's Note">
              A/N{chat.authorNote?.text?.trim() ? " ·" : ""}
            </button>
            <button className="btn" onClick={() => { setAgentsOpen((o) => !o); setMechOpen(false); }} title="Agents & trackers">
              <Icon name="chip" size={13} /> Agents{agentBusy ? "…" : ""}{jailbreakOn ? <Icon name="unlock" size={12} style={{ color: "var(--accent-2)" }} /> : ""}
            </button>
          </div>
        </div>
      </div>

      {memoryOpen && <MemoryInspector owner={{ collection: "chats", id: chat.id }} onClose={() => setMemoryOpen(false)} />}
      {noteOpen && <AuthorNoteModal chat={chat} onClose={() => setNoteOpen(false)} />}
      {mechOpen && <MechanicsPanel collection="chats" id={chat.id} onClose={() => setMechOpen(false)} />}
      {agentsOpen && (
        <div className="hud">          <div className="hud-section">
            <h3>Agents & Trackers</h3>
            {AGENTS.map((a) => (
              <label key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "8px 0", cursor: "pointer", textTransform: "none", letterSpacing: 0, fontSize: 12, color: "var(--text-dim)" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto", marginTop: 2 }}
                  checked={!!agentState.enabled[a.id]}
                  onChange={() => toggleAgent(a.id)}
                />
                <span>
                  <b style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={a.icon} size={12} style={{ color: "var(--accent)" }} />{a.name}</b>
                  <div className="faint" style={{ lineHeight: 1.4 }}>{a.desc}</div>
                </span>
              </label>
            ))}
            <div className="faint mt">{agentBusy ? "Agents are analyzing…" : "Agents run automatically after each reply."}</div>
          </div>

          <div className="hud-section">
            <h3>Story Memory</h3>
            <div style={{ fontSize: 12 }}>
              {(chat.memories || []).filter((m) => !m.superseded && !m.archived).length} active memories
              {(chat.memories || []).some((m) => m.pinned) && " · some pinned to canon"}
            </div>
            <button className="btn sm mt" onClick={() => setMemoryOpen(true)}>Open Memory Inspector</button>
            <div className="faint mt" style={{ lineHeight: 1.4 }}>
              Tracker facts land here automatically. Relevant memories are recalled into the prompt; pinned ones always are.
            </div>
          </div>

          <div className="hud-section">
            <h3>Scene Background</h3>
            <div className="faint" style={{ lineHeight: 1.4, marginBottom: 8 }}>
              {chat.backgroundPrompt || "The Background agent keeps this in sync; the Illustrator can render one if none exists."}
            </div>
            <ImagePicker
              category="backgrounds"
              kind="cover"
              value={chat.background?.dataURL}
              prompt={chat.backgroundPrompt || (world ? `${world.name} — ${world.description}` : `Scene with ${speaker.name}`)}
              onChange={(img) => patch("chats", chat.id, { background: img })}
              label={chat.background?.dataURL ? "Change background" : "Add background"}
            />
          </div>

          {agentState.world && (agentState.world.location || agentState.world.time || agentState.world.weather) && (
            <div className="hud-section">
              <h3>World State</h3>
              <div style={{ fontSize: 12 }}>
                {[agentState.world.location, agentState.world.time, agentState.world.weather].filter(Boolean).join(" · ")}
              </div>
              <div className="faint mt" style={{ lineHeight: 1.4 }}>
                Parsed by the pre-gen router and saved as deterministic state.
              </div>
            </div>
          )}

          <div className="hud-section">
            <h3>Jailbreak</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={chat.jailbreak ?? !!state.jailbreak?.enabled}
                onChange={(e) => patch("chats", chat.id, { jailbreak: e.target.checked })}
              />
              <span>Apply jailbreak prompt to this chat</span>
            </label>
            <div className="faint mt" style={{ lineHeight: 1.4 }}>
              {state.jailbreak?.text?.trim()
                ? "Sent as a post-history system instruction. Edit the text in Settings → Jailbreak."
                : "No text set yet — write your jailbreak prompt in Settings → Jailbreak."}
            </div>
          </div>

          {agentState.emotion && agentState.enabled.expression && (
            <div className="hud-section">
              <h3>Expression</h3>
              <div>{speaker.name} seems <b style={{ color: "var(--accent-2)" }}>{agentState.emotion}</b>.</div>
            </div>
          )}

          {agentState.combat && (
            <div className="hud-section">
              <h3>Combat — Round {agentState.combat.round}</h3>
              {agentState.combat.combatants?.map((c, i) => (
                <div className="stat-line" key={i}>
                  <span style={{ width: 80 }}>{c.name}</span>
                  <span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (c.hp / (c.maxHp || 100)) * 100))}%`, background: c.side === "enemy" ? "linear-gradient(90deg,var(--red),var(--amber))" : undefined }} /></span>
                  <span className="faint">{c.hp}{c.maxHp ? `/${c.maxHp}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {agentState.inventory?.length > 0 && (
            <div className="hud-section">
              <h3>Inventory</h3>
              <div className="row wrap">
                {agentState.inventory.map((it) => (
                  <span key={it.id || it.name} className="tag">{it.name}{it.count > 1 ? ` ×${it.count}` : ""}</span>
                ))}
              </div>
            </div>
          )}

          {agentState.quests?.length > 0 && (
            <div className="hud-section">
              <h3>Quests</h3>
              {agentState.quests.map((q) => (
                <div key={q.id || q.title} className="mb" style={{ fontSize: 12 }}>
                  <b>{q.title}</b> <span className="badge amber">{q.status}</span>
                </div>
              ))}
            </div>
          )}

          {agentState.npcStatus?.length > 0 && (
            <div className="hud-section">
              <h3>Characters</h3>
              {agentState.npcStatus.map((n, i) => (
                <div key={i} style={{ fontSize: 12, marginBottom: 6 }}>
                  <b>{n.name}</b>{n.status ? ` — ${n.status}` : ""}{n.relation ? ` · ${n.relation}` : ""}
                </div>
              ))}
            </div>
          )}

          {agentState.facts?.length > 0 && (
            <div className="hud-section">
              <h3>Story Facts</h3>
              <div className="event-log">
                {agentState.facts.slice().reverse().map((f) => (
                  <div key={f.id || f.text} className="ev">{f.text}</div>
                ))}
              </div>
            </div>
          )}

          {agentState.memory?.length > 0 && (
            <div className="hud-section">
              <h3>Long-Term Memory</h3>
              <div className="event-log">
                {agentState.memory.slice().reverse().map((m) => (
                  <div key={m.id || m.text} className="ev">{m.text}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editIdx !== null && (
        <Modal
          title={`Edit ${msgs[editIdx]?.role === "user" ? "your" : speaker.name + "'s"} message`}
          onClose={() => setEditIdx(null)}
          wide
        >
          <textarea
            rows={8}
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            style={{ width: "100%", minHeight: 140 }}
          />
          <div className="faint mt">
            <b>Save</b> updates the message in place. <b>Save & Branch</b> updates it, removes everything after it, and continues from there.
          </div>
          <div className="row mt">
            <div className="spacer" />
            <button className="btn" onClick={() => setEditIdx(null)}>Cancel</button>
            <button className="btn primary" onClick={() => saveEdit(false)}>Save</button>
            <button className="btn primary" onClick={() => saveEdit(true)}>Save & Branch</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= Story Composer =================
   Dedicated setup area: combine persona + characters (group) + world + scenario
   into a single wired chat. */
function StoryComposer({ onClose, onCreated }) {
  const { state, add } = useStore();
  const [personaId, setPersonaId] = useState(state.personas[0]?.id || "");
  const [charIds, setCharIds] = useState(state.characters[0] ? [state.characters[0].id] : []);
  const [worldId, setWorldId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [openingNote, setOpeningNote] = useState("");

  const toggleChar = (id) =>
    setCharIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const create = () => {
    if (!charIds.length) return;
    const scenario = state.scenarios.find((s) => s.id === scenarioId);
    const messages = [];
    if (openingNote.trim()) messages.push({ id: uid(), role: "assistant", who: "Narrator", text: openingNote.trim() });
    else if (scenario?.opening) messages.push({ id: uid(), role: "assistant", who: "Narrator", text: scenario.opening });
    const chat = {
      id: uid(),
      characterId: charIds[0],
      characterIds: charIds,
      personaId: personaId || null,
      worldId: worldId || null,
      scenarioId: scenarioId || null,
      messages,
      createdAt: Date.now(),
      agentState: initialAgentState(),
    };
    add("chats", chat);
    onCreated(chat.id);
  };

  return (
    <Modal title="New Story" onClose={onClose}>
      <Field label="Your persona">
        <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
          <option value="">— none —</option>
          {state.personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>

      <label>Characters (pick one or several for a group scene)</label>
      <div className="row wrap">
        {state.characters.map((c) => (
          <button key={c.id} className={`chip ${charIds.includes(c.id) ? "primary" : ""}`}
            style={charIds.includes(c.id) ? { borderColor: "var(--accent)", color: "var(--text)" } : undefined}
            onClick={() => toggleChar(c.id)}>
            {c.name}{charIds[0] === c.id ? " · main" : ""}
          </button>
        ))}
        {state.characters.length === 0 && <span className="faint">No characters yet — create one first.</span>}
      </div>
      <div className="faint mt">The main character speaks first; you can switch who replies mid-scene.</div>

      <Field label="World (optional — adds locations, NPCs, quests to the scene)">
        <select value={worldId} onChange={(e) => setWorldId(e.target.value)}>
          <option value="">— none —</option>
          {state.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </Field>

      <Field label="Scenario (optional — adds the setup and its opening line)">
        <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          <option value="">— none —</option>
          {state.scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </Field>

      <Field label="Opening line (optional — overrides the scenario opening)">
        <textarea rows={2} value={openingNote} placeholder="e.g. Rain hammers the windows as the power cuts out…"
          onChange={(e) => setOpeningNote(e.target.value)} />
      </Field>

      <div className="row mt">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!charIds.length} onClick={create}>Start Story</button>
      </div>
    </Modal>
  );
}

/* ================= Author's Note ================= */
function AuthorNoteModal({ chat, onClose }) {
  const { patch } = useStore();
  const an = chat.authorNote || { text: "", depth: 4 };
  const update = (patchObj) => patch("chats", chat.id, { authorNote: { ...an, ...patchObj } });
  return (
    <Modal title="Author's Note" onClose={onClose}>
      <Field label="Note text — injected into every generation. Macros supported.">
        <textarea
          rows={4}
          value={an.text || ""}
          placeholder="e.g. Keep responses under 100 words. Drive the plot toward the ritual tonight. {{char}} is hiding something."
          onChange={(e) => update({ text: e.target.value })}
        />
      </Field>
      <Field label={`Insertion depth — ${an.depth ?? 4} message${(an.depth ?? 4) === 1 ? "" : "s"} from the end of the conversation`}>
        <input
          type="range" min="0" max="10" step="1" value={an.depth ?? 4}
          style={{ accentColor: "var(--accent)" }}
          onChange={(e) => update({ depth: parseInt(e.target.value) })}
        />
      </Field>
      <div className="faint" style={{ lineHeight: 1.5 }}>
        Sent as a system instruction on every send and reroll. Higher depth sits closer to the latest
        messages (stronger, more immediate influence); lower depth reads like standing background guidance.
        Supported macros: {"{{char}} {{user}} {{persona}} {{description}} {{personality}} {{scenario}} {{scene}}"}.
        Applies to this chat only.
      </div>
      <div className="row mt">
        <div className="spacer" />
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
