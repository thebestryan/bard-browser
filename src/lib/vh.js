import { uid } from "./id.js";
import { callJSON, callChat } from "./ai.js";
import { integrateMemories, recallMemories } from "./memory.js";

/**
 * Virtual Human simulation — people with their own clock, routine, mood,
 * memory and relationship. They may reply late, message on their own,
 * and remember across timelines.
 */

export function newTimeline(name = "Main") {
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    messages: [], // {id, role: "user"|"vh", text, ts, autonomous?}
    mood: 0,          // -100 gloomy .. +100 bright
    trust: 10,        // -100 hostile .. +100 devoted
    memories: [],
  };
}

/** Normalize a VH loaded from older saves. */
export function ensureVH(vh) {
  if (vh.timelines?.length) return vh;
  const t = newTimeline("Main");
  t.messages = (vh.messages || []).map((m) => ({
    id: uid(),
    role: m.role === "user" ? "user" : "vh",
    text: m.text || "",
    ts: Date.now(),
  }));
  return { ...vh, timelines: [t], activeTimelineId: t.id };
}

export const activeTimeline = (vh) =>
  vh.timelines.find((t) => t.id === vh.activeTimelineId) || vh.timelines[0];

/* ---------------- clock + routine ---------------- */

function parseRange(entry) {
  // "Sleeps 9am–4pm" / "Works 22:00-06:00" → {startMin, endMin, label}
  const m = String(entry).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  const toMin = (h, mm, ap) => {
    h = parseInt(h) % 24;
    mm = parseInt(mm || 0);
    if (ap?.toLowerCase() === "pm" && h < 12) h += 12;
    if (ap?.toLowerCase() === "am" && h === 12) h = 0;
    return h * 60 + mm;
  };
  const start = toMin(m[1], m[2], m[3]);
  const end = toMin(m[4], m[5], m[6]);
  const label = String(entry).split(/\d/)[0].replace(/[^A-Za-z ]/g, "").trim();
  return { start, end, label: label || "Busy" };
}

function inRange(nowMin, r) {
  if (r.start <= r.end) return nowMin >= r.start && nowMin < r.end;
  return nowMin >= r.start || nowMin < r.end; // wraps midnight
}

/** What are they up to right now? */
export function currentActivity(vh, now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const entry of vh.routine || []) {
    const r = parseRange(entry);
    if (r && inRange(nowMin, r)) return { busy: /sleep|asleep|rest/i.test(r.label), label: r.label };
  }
  const hour = now.getHours();
  if (hour < 6) return { busy: true, label: "Sleeping" };
  return { busy: false, label: "Free" };
}

/**
 * Presence for the card pill and chat-header dot.
 * available = nothing scheduled, busy = inside a routine block, asleep =
 * a sleep/rest block (or the small hours with nothing scheduled).
 * ponytail: separate from currentActivity().busy, which only slows replies
 * for sleep — being "busy painting" shows Busy but still replies normally.
 */
export function presenceOf(vh, now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const entry of vh?.routine || []) {
    const r = parseRange(entry);
    if (r && inRange(nowMin, r)) {
      const asleep = /sleep|asleep|rest|nap/i.test(r.label);
      return asleep
        ? { key: "asleep", label: "Asleep", activity: r.label }
        : { key: "busy", label: "Busy", activity: r.label };
    }
  }
  if (now.getHours() < 6) return { key: "asleep", label: "Asleep", activity: "Sleeping" };
  return { key: "available", label: "Available", activity: "Free" };
}

export function moodLabel(mood) {
  if (mood > 60) return "radiant";
  if (mood > 25) return "cheerful";
  if (mood > -10) return "okay";
  if (mood > -40) return "down";
  return "gloomy";
}

/* ---------------- reply generation ---------------- */

const MOCK_REPLIES = [
  "hey! sorry, just saw this",
  "ok that's fair haha",
  "wait really?",
  "ugh, long shift. tell me everything",
  "you always know what to say",
  "can I call you later? getting swamped",
  "that actually made me smile",
  "hmm. thinking about that one",
  "I'm out right now but don't disappear",
  "you're trouble, you know that?",
];

const MOCK_AUTONOMOUS = [
  "thinking about you, random but true",
  "you will NOT believe what just happened at work",
  "hey stranger",
  "saw something today that reminded me of you",
  "coffee later? I need human contact",
];

function sentimentShift(text) {
  const t = String(text).toLowerCase();
  let s = 0;
  for (const w of ["thanks", "sorry", "love", "great", "awesome", "good", "nice", "miss you", "proud"]) if (t.includes(w)) s += 6;
  for (const w of ["stupid", "hate", "shut up", "idiot", "useless", "whatever", "annoying"]) if (t.includes(w)) s -= 10;
  return Math.max(-20, Math.min(20, s));
}

/** How long until they reply (ms), given their state. */
export function replyDelay(vh, timeline) {
  const { busy } = currentActivity(vh);
  const trust = timeline.trust;
  const base = 2500 + Math.random() * 3500;
  const busyMul = busy ? 2.5 : 1;
  const trustMul = trust > 40 ? 0.8 : trust < -20 ? 1.6 : 1;
  return base * busyMul * trustMul;
}

/** Generate a reply from the VH. */
export async function generateVHReply({ vh, timeline, userText, profile }) {
  const act = currentActivity(vh);
  const mood = moodLabel(timeline.mood);
  const relevant = recallMemories(timeline.memories, userText, { limit: 4 });

  if (profile?.isMock) {
    const pool = act.busy ? MOCK_REPLIES.filter((_, i) => i % 2 === 0) : MOCK_REPLIES;
    const picks = [pool[(userText.length + timeline.messages.length) % pool.length]];
    if (timeline.trust > 40 && Math.random() < 0.4) picks.push("btw I added that to my list of things I owe you");
    return picks.join(" ");
  }

  const sys =
    `You are ${vh.name}, ${vh.age ? vh.age + ", " : ""}${vh.occupation || ""} in ${vh.location || "an unspecified place"}. ` +
    `Personality: ${vh.personality || "ordinary"}. ` +
    `Right now you are: ${act.label}. Mood: ${mood}. Relationship warmth toward the user: ${timeline.trust}/100. ` +
    (vh.boundaries ? `Boundaries: ${vh.boundaries}. ` : "") +
    `Reply as a short casual text message (1-3 sentences, lowercase-ish, natural texting style). Stay in character and reference your life.`;
  const memories = relevant.length ? `Things you remember: ${relevant.map((m) => m.text).join("; ")}\n` : "";
  const history = timeline.messages.slice(-10).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
  const out = await callChat(profile, [{ role: "system", content: sys + memories }, ...history, { role: "user", content: userText }]);
  return out.content;
}

/** Generate an unprompted message. */
export async function generateAutonomousMessage({ vh, timeline, profile }) {
  if (profile?.isMock) {
    return MOCK_AUTONOMOUS[(timeline.messages.length + Math.floor(Math.random() * 5)) % MOCK_AUTONOMOUS.length];
  }
  const act = currentActivity(vh);
  const data = await callJSON(
    profile,
    `Write ONE unprompted casual text message from ${vh.name} (${vh.occupation || ""}, currently: ${act.label}, mood: ${moodLabel(timeline.mood)}). Return JSON {"text":""}`,
    `Recent conversation: ${timeline.messages.slice(-4).map((m) => m.text).join(" | ") || "nothing yet"}`
  );
  return data?.text || "hey";
}

/* ---------------- state updates ---------------- */

/** Apply the effect of a user message: sentiment → mood/trust, memory updates. */
export function applySentiment(timeline, userText) {
  const shift = sentimentShift(userText);
  const next = { ...timeline };
  next.mood = Math.max(-100, Math.min(100, timeline.mood + Math.round(shift * 0.6)));
  next.trust = Math.max(-100, Math.min(100, timeline.trust + Math.round(shift * 0.8)));
  if (shift !== 0) {
    const { memories } = integrateMemories(timeline.memories || [], [
      { text: `${shift > 0 ? "Positive" : "Negative"} moment: user said something ${shift > 0 ? "kind" : "unkind"} ("${userText.slice(0, 50)}")`, type: "relationship", importance: 2, source: "conversation" },
    ]);
    next.memories = memories;
  }
  return next;
}

/** Should they message on their own right now? */
export function wantsToMessage(vh, timeline, lastTs) {
  const minutes = (Date.now() - (lastTs || Date.now())) / 60000;
  if (minutes < 1) return false; // just talked
  const act = currentActivity(vh);
  const chance = act.busy ? 0.05 : 0.22;
  const trustBonus = timeline.trust > 40 ? 0.15 : 0;
  return Math.random() < chance + trustBonus;
}

/** While-away catch-up: generate 0-2 messages referencing the gap. */
export function catchUpCount(vh, timeline, lastTs) {
  const hours = (Date.now() - (lastTs || Date.now())) / 3600000;
  if (hours < 1) return 0;
  if (timeline.trust > 20) return Math.min(2, Math.ceil(hours / 6));
  return hours > 24 ? 1 : 0;
}
