import { callJSON } from "./ai.js";

/**
 * Visual agents (post-gen).
 *
 * The Illustrator decides whether the latest beat deserves a single
 * illustration and writes the image prompt. The Background agent keeps a
 * reusable backdrop prompt for the current scene. Both are decisions only —
 * the caller owns image generation, file saving and message attachment so the
 * chat state stays deterministic.
 */

const SCENE_WORDS =
  /\b(rain|storm|snow|fog|mist|forest|woods|street|alley|room|hall|chapel|temple|ruin|castle|market|tavern|inn|ship|sea|ocean|river|lake|mountain|cliff|desert|city|village|sky|moon|sun|stars|fire|ember|smoke|blood|sword|blade|light|shadow|window|door|garden|roof|bridge|cave|dungeon|throne|battlefield)\b/i;

function mockDecision({ messages, character, world, chat }) {
  const last = messages[messages.length - 1];
  const text = String(last?.text || "").replace(/\s+/g, " ").trim();
  const already = messages.slice(-6).some((m) => m.image?.dataURL);
  const assistantCount = messages.filter((m) => m.role === "assistant").length;
  return {
    illustrate:
      !already &&
      text.length > 120 &&
      (SCENE_WORDS.test(text) || assistantCount % 4 === 0),
    illustrationPrompt: [
      world?.name,
      character?.name,
      text.slice(0, 180),
    ].filter(Boolean).join(" — "),
    backgroundPrompt:
      chat?.backgroundPrompt ||
      (world
        ? `${world.name}, ${world.genre || ""} — ${world.tagline || world.description || ""}`
        : `Backdrop for ${character?.name || "the scene"}`),
  };
}

/**
 * Ask the art-director agent what this turn needs. Uses the text profile; a
 * mock profile gets a deterministic heuristic so the pipeline works offline.
 */
export async function decideVisuals({ profile, messages, character, world, chat, signal }) {
  if (!messages?.length) return { illustrate: false, illustrationPrompt: "", backgroundPrompt: "" };
  if (profile?.isMock) return mockDecision({ messages, character, world, chat });

  const recent = messages
    .slice(-5)
    .map((m) => `${m.role === "user" ? "Player" : character?.name || "Narrator"}: ${m.text}`)
    .join("\n");

  try {
    const data = await callJSON(
      profile,
      `You are the art director for a text roleplay. Read the latest beat and decide:
- whether one illustration would strengthen it (do not illustrate every turn; favor decisive, visual moments)
- a concrete image prompt: subject, setting, lighting, mood, camera; no dialogue, no text overlays, no lettering
- a reusable background prompt for the current location/scene
Return JSON: {"illustrate":boolean,"illustrationPrompt":string,"backgroundPrompt":string}.`,
      `Character: ${character?.name || "unknown"}. ${world ? `World: ${world.name} (${world.genre || ""}).` : ""}
Current background: ${chat?.background?.dataURL ? "already set" : "none"}.
Latest beat:
${recent}`,
      { signal, temperature: 0.4, maxTokens: 320 }
    );
    return {
      illustrate: !!data.illustrate,
      illustrationPrompt: String(data.illustrationPrompt || "").trim(),
      backgroundPrompt: String(data.backgroundPrompt || "").trim(),
    };
  } catch {
    return mockDecision({ messages, character, world, chat });
  }
}
