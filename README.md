# Bard Browser — Persistent AI Roleplay Studio

A creator-focused roleplay frontend combining Horde Studio's world-simulation depth with
Marinara Engine's feature breadth, restyled with its own editorial dark theme (slate / cyan /
salmon — no emoji in the interface). Built with React + Vite. Local-first: all data stays in
your browser's IndexedDB.

## Running

**Windows** — double-click `start.bat`, or run `start.ps1` in PowerShell:

```powershell
.\start.ps1                                # default port 5173
$env:BARD_BROWSER_PORT = 8080; .\start.ps1 # custom port
```

**macOS / Linux:**

```bash
./start.sh        # installs deps on first run, opens the browser
./stop.sh         # stop
```

Without the launchers: `npm install`, then `npm run dev`. Other commands:

```bash
npm run build     # production build → dist/
npm test          # regression checks for lib/ (plain node, no framework)
npm run check     # lint + test + build
```

**Stopping the app** — any of these, no `pkill` needed:

- the **Quit** button in the sidebar (dev server only)
- `Ctrl+C` in the terminal running the launcher
- `./stop.sh` / `.\stop.ps1` from anywhere

The launchers run Vite directly (not via `npm run`, which would leave the real server orphaned
when the wrapper dies) and record its PID in `.bardbrowser.pid`. `stop.sh` / `stop.ps1` use that
PID, falling back to the dev server's `/__quit` endpoint if the file is missing.

## The 30-second tour

1. **Settings → Connections** — add a text provider (any OpenAI-compatible endpoint: OpenRouter,
   OpenAI, NanoGPT, Mistral, local Ollama / LM Studio / KoboldCpp…) or just use the built-in
   **Mock** profiles to try everything offline.
2. **Characters** — generate a character from one line, upload a reference model sheet, or import
   a SillyTavern card.
3. **Worlds** — build a living world (or let the AI fill it), with locations, NPCs, planets,
   quests and mechanics.
4. **New Story** — combine persona + cast + world + scenario into one wired scene and start
   playing.

## Features

### Living Worlds

Persistent settings with locations, NPCs (goals + secrets + schedules), factions, items, quests,
time of day, weather, meters, inventory and a world-event log that reacts as you play.
- **Planets** — a location can be typed as a *planet* and pinned; pinned locations become
  quick-travel chips in the play HUD, and being on a planet location is shown in the HUD.
- The play session (log, clock, weather, meters, inventory) is saved on the world, so leaving
  and returning resumes where you left off.
- **World Studio name matching** — typing an NPC name that resembles a character or virtual human
  you already have offers to adopt their details instead of starting from scratch.

### AI creators

Worlds, Characters, Personas, Scenarios, Virtual Humans, Lorebooks and Presets can all be
generated from a one-line suggestion (AI Fill in World Studio too), with full manual editors
alongside every creator.

### Characters, personas, virtual humans

- Full character cards: appearance, personality, scenario, greeting, example dialogue.
- **Character-card layout** — portrait on top with the name over it; without an image you get a
  serif-initials fallback.
- **Reference photos** — load a model sheet (face, body, side views) on any card. AI portraits
  become reference-guided: renders go through the OpenAI-compatible multipart `/images/edits`
  endpoint with your references, keeping the same identity across renders. Providers without
  edits support fall back to a prompt-only render and say so.
- **Virtual humans** run on their own life: routines with times (busy / asleep / free), mood and
  trust that shift with how you treat them, delayed natural replies, autonomous messages, while-
  away catch-up, and **timelines** you can fork or restart — each keeping its own history, mood,
  trust and memories. Their card shows a live Available / Busy / Asleep status pill.

### Chats

- **Story Composer** — one place to combine persona + one or more characters (group scenes) +
  world + scenario, with a "Reply as" switcher mid-scene.
- Lorebook injection, world context, memory recall, mechanics state — assembled by your preset.
- Streaming replies (SSE for real providers), rerolls that reuse the **full** scene context,
  response swipes, message editing, and a **Stop** button that keeps whatever streamed in.
- **`[[OOC]]`** — anything in double brackets is split out of your message and delivered to the
  model as a side-channel instruction, never as story text.

### Macros

`{{char}}`, `{{user}}`, `{{persona}}`, `{{description}}`, `{{personality}}`, `{{scenario}}`,
`{{scene}}`, `{{world}}` are substituted everywhere text reaches the model — user input, chat
history, preset literals, jailbreak, author's note. Identity macros never collapse to nothing
(an empty `{{char}}` becomes "the character"), unknown macros are left untouched, and
`{{ Char }}`-style spacing and casing is tolerated.

### Author's Note

Every chat has an **A/N** button: a standing system instruction injected into every send and
reroll at a depth you choose (0–10 messages from the end). World play has its own note in the
HUD, and virtual humans have one in the chat header. Macros supported.

### Agents & Trackers

Marinara-style toggleable per-chat add-ons, running automatically after each reply:

| Agent | What it does |
|---|---|
| World State Tracker | Extracts durable facts (location, time, promises, injuries) |
| Character Tracker | Who's present, their status and relation to you |
| Quest Tracker | Detects quests and progress from the story |
| Inventory Tracker | Items gained / lost |
| Long-Term Memory | Summarizes older messages into compact memories |
| Lorebook Keeper | Harvests lore with trigger keywords into a "Story Lore" lorebook |
| CYOA Choices | Clickable action chips after each reply |
| Expression Engine | Emotion badge on the character's replies |
| Combat Tracker | Rounds, HP bars, fallen combatants |

Tracked state is injected into the system prompt (facts, memory, emotion) so it influences
generation. Everything is visible and toggleable in the Agents drawer inside any chat.

### Persistent Story Memory

Chats and worlds keep a durable memory store separate from the transcript:

- Tracker facts land here automatically; you can add memories manually.
- **Relevance-weighted recall** into the prompt: keyword overlap + importance + recency, capped
  so long stories stay coherent.
- **Pin to canon** — pinned memories are always included regardless of relevance.
- **Contradiction superseding** — a new "Location: X" supersedes the old "Location: Y" instead of
  coexisting (limited to genuine state prefixes, so prose with a colon doesn't erase memories).
- **Memory Inspector** (chats: Agents drawer; world play: HUD) — search, add, edit, pin, archive,
  delete; superseded memories stay visible struck through for auditability.

### RPG Mechanics Engine

System-agnostic rules with three switchable modes (per chat and per world — non-destructive,
sheets preserved when paused):

| Mode | What's active |
|---|---|
| Off | Pure narrative; all sheets and items preserved |
| Light | HP, d20 checks, basic damage |
| Full | Six attributes (Might, Agility, Wits, Presence, Luck, Heart), derived HP/defense, gear modifiers, trinkets, buffs/debuffs with round durations, XP and levels |

The dice are authoritative: attacks and checks are computed by the engine (d20 + modifiers vs
defense/DC, crits on natural 20, fumbles on 1) and handed to the AI to narrate — the model never
invents or rerolls numbers. World items gain mechanical stats when looted (scaled by rarity),
equipment changes derived values live, and victory grants XP with level-ups. Open via the
**Mech** button in any chat, or the Mechanics section in world play.

### Presets

Prompt section ordering + sampler parameters, with a full manual editor: rename, retune
temperature / max tokens / top P, edit style instructions, and reorder, rename, disable, add or
remove prompt sections — each with a one-line description, a live content preview, and an
**Assembled prompt preview** showing the finished prompt in order.

- A preset takes effect by being linked to a text connection profile; the Presets view shows
  which preset is in use and which profiles link each one.
- **Imported presets are authoritative** — a preset with its own prompt text is used as written;
  the app does not stack its generated blocks on top. A checkbox lists exactly what the preset
  doesn't place and lets you append it anyway. The character's identity line is always
  guaranteed — if nothing in the preset mentions the character, it is added regardless.
- Applies to both character chats and world play narration.

### Connections (profiles)

Settings → Connections: bundles of API endpoint + generation settings, in three types
(**Text**, **Image/Video**, **Audio**). Create as many as you like per type and pick which is
active — every AI feature routes through the active profile of its type. All endpoints are
OpenAI-compatible: OpenRouter, OpenAI, NanoGPT, Mistral, Together, local Ollama
(`http://127.0.0.1:11434/v1`), LM Studio (`http://127.0.0.1:1234/v1`), KoboldCpp, llama.cpp,
vLLM… Text profiles carry sampler settings and an optional linked preset. **Leave a sampler box
empty to inherit it from the linked preset; type a value to override the preset.** Offline Mock
profiles for all three types ship enabled so everything works before you connect anything.

### Jailbreak

Settings → Jailbreak: a prompt sent as a post-history system instruction in every chat and world
play generation (SillyTavern-style), with a per-chat toggle in the Agents drawer and an unlock
marker on the Agents button while it's active.

### Card Browser

Search and import characters from external repositories — **Browse Cards** in Characters:

- **Chub.ai** built in (search by rating, download PNG cards directly).
- Optional **proxy template per source** (Settings → Card Browser) for region-blocked or
  CORS-restricted networks — use `{url}` where the encoded target URL goes.
- **Offline Sample Pack** always available (5 demo cards).
- Imports run through the SillyTavern-compatible importer.

### SillyTavern-compatible import/export

**What this app saves is SillyTavern-compatible:**

- **Characters** → `chara_card_v2` JSON and PNG cards with an embedded `chara` tEXt chunk
  (drag straight into SillyTavern).
- **Chats** → SillyTavern JSONL (per-message records with swipes) and plain text.
- **Presets** → SillyTavern chat-completion preset JSON (temperature, top_p, max tokens, prompt
  order); imports keep each prompt's **own text**, map ST marker prompts (`charDescription`,
  `personaDescription`, `worldInfoBefore`, …) to the matching section kind, and take order +
  enabled flags from `prompt_order`. Presets exported by this app re-import losslessly.

**Imports accept:** SillyTavern PNG/JSON cards, ST JSONL chats, ST presets, plain world JSON —
plus best-effort parsing of Marinara Engine and Horde Studio files (any JSON with recognizable
character/world/message fields).

### Generation lifecycle

AI generation runs **detached**: starting a character creation, world fill, image render, or a
chat reply and then navigating away does **not** cancel it. The task keeps running (chat replies
keep streaming in the background) and commits to the store the moment it finishes. The topbar
shows a live "generating × N" indicator and a toast fires when each task completes or fails.
The Stop button in an open chat still cancels manually.

### Images on every card

Characters, personas and virtual humans show their picture as a character-card portrait;
worlds, scenarios and chats carry a cover image, with a styled fallback when there isn't one
(a chat borrows its world's background until you give it its own). Every image can be uploaded
or generated. Uploads are downscaled for display so large photos don't slow saving; the
untouched original goes to User Files under its original filename.

### Splash

The app boots into a 1-second loading screen, plays `public/Splash.mp4` once (click anywhere to
skip), then fades into the UI.

### No emoji

The interface uses a stroke icon set and plain typography. Generated names, tags and titles have
emoji stripped, and a test fails if one is ever added to the source.

## User Files policy

Uploads are stored in clearly labeled categories (Backgrounds, Characters, Personas, Virtual
Humans, Worlds, Scenarios, Presets, Lorebooks, Exports) under **User Files** so anyone
transferring files knows exactly where to look.

**Uploaded files are never renamed.** The original filename is preserved exactly as uploaded,
shown in the UI, and used for downloads/exports.

## Where your data lives

| What | Where |
|---|---|
| App data (worlds, characters, chats, profiles) | **IndexedDB** (`myrpg` DB, `kv` store), key `state.v1` — the DB name is stable so existing installs keep their data |
| Uploads & generated images | IndexedDB key `files.v1`, kept apart from hot state so large blobs aren't rewritten on every edit |
| API keys | Encrypted at rest with AES-GCM (WebCrypto); the key is non-extractable and never leaves the browser. If WebCrypto is unavailable (plain `http://` on a non-localhost address) keys are **not saved** rather than written in the clear, and the app says so. |
| Full backup | Settings → Export full backup / Restore backup (single JSON; API keys stay encrypted in it — restore elsewhere and you re-enter those). |
| Uploaded files | **User Files** view, organized by labeled category, original filenames |
| Generated images | Saved automatically into **User Files** with descriptive names |

## Reliability

- A per-view **error boundary** — one bad view shows "This view hit an error" with Try again /
  Reload app, and your data is never at risk.
- Requests time out after 120 s instead of hanging forever.
- 31 regression tests (`npm test`) cover the tricky parts: preset ordering, macro substitution,
  memory superseding, combat math, ST round-trips, cascade deletes, VH presence.
- A test fails if emoji are ever added to the source.

## Architecture

```
src/
├── main.jsx                       # entry
├── App.jsx                        # shell, navigation, splash, toasts
├── theme.css                      # complete visual system (editorial dark)
├── store.jsx                      # state + IndexedDB persistence + encryption
├── components/
│   ├── Icon.jsx                   # stroke icon set (no emoji)
│   ├── UI.jsx                     # Modal, AICreator, ProfileCard, ImagePicker,
│   │                              #   RefPhotos, ImageGen, MemoryInspector link…
│   ├── CardBrowser.jsx            # external card repositories
│   ├── MechanicsPanel.jsx         # RPG mechanics drawer
│   ├── MemoryInspector.jsx        # durable memory manager
│   └── ErrorBoundary.jsx          # per-view crash isolation
├── lib/
│   ├── ai.js                      # AI service layer: mock OR OpenAI-compatible
│   ├── prompt.js                  # preset assembly, macros, [[OOC]], depth
│   ├── agents.js                  # agents & trackers engine
│   ├── mechanics.js               # RPG rules engine
│   ├── memory.js                  # durable memory + superseding + recall
│   ├── vh.js                      # virtual human simulation
│   ├── stio.js                    # SillyTavern-compatible import/export
│   ├── cardbrowser.js             # card repository sources
│   ├── genbus.js                  # detached generation lifecycle
│   ├── secure.js                  # AES-GCM key encryption
│   ├── idb.js / id.js / image.js  # storage, ids, image downscaling
│   ├── cascade.js                 # delete impact analysis
│   ├── mockdata.js                # offline fixtures
│   └── lib.test.mjs               # regression suite (plain node)
└── views/
    ├── Home.jsx                   # dashboard
    ├── Worlds.jsx                 # world studio + AI fill
    ├── WorldPlay.jsx              # living-world gameplay with HUD
    ├── Characters.jsx             # character cards + Card Browser
    ├── Sims.jsx                   # Personas, Scenarios, Virtual Humans + VH chat
    ├── Chats.jsx                  # chat rooms, Story Composer, agents, A/N
    ├── LorePresets.jsx            # Lorebooks, Presets
    ├── Files.jsx                  # User Files
    └── Settings.jsx               # connections, card sources, jailbreak, data
```

## Privacy

Everything runs locally in your browser. API keys are encrypted at rest and are only ever sent
to the endpoint you configure. No telemetry, no accounts, no server.
