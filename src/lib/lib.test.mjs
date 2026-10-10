/**
 * Regression checks for the bugs fixed in the code review.
 * Run: node src/lib/lib.test.mjs   (no framework, exits non-zero on failure)
 */
import assert from "node:assert/strict";
import { applyTrackerOutput, initialAgentState } from "./agents.js";
import { integrateMemories } from "./memory.js";
import { importChatFile, toSTChatJSONL } from "./stio.js";
import { makeCharacter, makeItem, grantItem, combatAttack, startCombat } from "./mechanics.js";
import { generatedFileEntry, stripEmoji } from "./ai.js";
import { presenceOf } from "./vh.js";
import { fitWithin } from "./image.js";
import { deletionImpact, impactSummary, removeCascade } from "./cascade.js";
import { assemblePrompt, substituteMacros, unplacedRoles } from "./prompt.js";
import { fromSTPreset, toSTPreset, presetNameFromFile } from "./stio.js";
import { textParams } from "./ai.js";

const file = (name, text) => ({ name, text: async () => text });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("inventory tracker survives a second item", () => {
  let st = initialAgentState();
  st = applyTrackerOutput(st, { inventoryAdds: ["rusty key"] });
  st = applyTrackerOutput(st, { inventoryAdds: ["lantern"] }); // used to throw
  st = applyTrackerOutput(st, { inventoryAdds: ["rusty key"] }); // stacks
  assert.equal(st.inventory.length, 2);
  assert.equal(st.inventory.find((i) => i.name === "rusty key").count, 2);
});

test("only real state categories supersede", () => {
  const a = integrateMemories([], [{ text: "Location: The Docks" }]).memories;
  const b = integrateMemories(a, [{ text: "Location: The Spire" }]).memories;
  assert.equal(b.filter((m) => !m.superseded).length, 1, "location should supersede");

  const c = integrateMemories([], [{ text: "Positive moment: user said thanks" }]).memories;
  const d = integrateMemories(c, [{ text: "Positive moment: user said hello" }]).memories;
  assert.equal(d.filter((m) => !m.superseded).length, 2, "prose must NOT supersede");
});

test("chat import handles object, array and jsonl", async () => {
  const obj = await importChatFile(file("c.json", JSON.stringify({ messages: [{ role: "user", content: "hi" }] })));
  assert.equal(obj.length, 1);
  assert.equal(obj[0].role, "user");

  const arr = await importChatFile(file("c.json", JSON.stringify([{ is_user: true, mes: "yo" }, { mes: "hey" }])));
  assert.deepEqual(arr.map((m) => m.role), ["user", "assistant"]);

  const jsonl = [
    JSON.stringify({ user_name: "Me", character_name: "Her", create_date: "x" }),
    JSON.stringify({ is_user: true, mes: "one" }),
    JSON.stringify({ mes: "two" }),
  ].join("\n");
  const l = await importChatFile(file("c.jsonl", jsonl));
  assert.equal(l.length, 2, "header line must be skipped, not imported as a message");
});

test("exported JSONL round-trips through the importer", async () => {
  const chat = { createdAt: Date.now(), messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }] };
  const out = toSTChatJSONL(chat, "Her", "Me");
  assert.match(out.split("\n")[0], /character_name/, "must emit an ST header line");
  const back = await importChatFile(file("c.jsonl", out));
  assert.deepEqual(back.map((m) => m.text), ["a", "b"]);
});

test("grantItem does not mutate the previous character", () => {
  const c = makeCharacter("Hero");
  const before = JSON.stringify(c);
  const c2 = grantItem(c, makeItem({ name: "Sword", type: "weapon" }));
  assert.equal(JSON.stringify(c), before, "original must be untouched");
  assert.equal(c2.equipment.weapon.name, "Sword");
  assert.equal(c.equipment.weapon, null);
});

test("combatAttack on a missing target returns null, not a crash", () => {
  const combat = startCombat([makeCharacter("Hero")], "Goblin");
  assert.equal(combatAttack(combat, { name: "Hero", statMod: 2 }, "Nobody"), null);
  assert.ok(combatAttack(combat, { name: "Hero", statMod: 2 }, "Goblin"));
});

test("generated files are labeled with their real type and size", () => {
  const svg = generatedFileEntry("backgrounds", "bg", "Misty Isles", {
    dataURL: "data:image/svg+xml;charset=utf-8,%3Csvg%3E", prompt: "p", model: "mock-scene", mime: "image/svg+xml",
  });
  assert.equal(svg.fileType, "image/svg+xml");
  assert.match(svg.fileName, /\.svg$/);
  assert.ok(svg.size > 0, "size must not be hardcoded 0");

  const png = generatedFileEntry("characters", "portrait", "Serah Vane", {
    dataURL: "data:image/png;base64,aGVsbG8=", prompt: "p", model: "m", mime: "image/png",
  });
  assert.equal(png.fileType, "image/png");
  assert.equal(png.size, 5); // "hello"
});

test("deleting a character cleans up the chats that used it", () => {
  const st = {
    characters: [{ id: "c1" }, { id: "c2" }],
    chats: [
      { id: "solo", characterId: "c1", characterIds: ["c1"] },
      { id: "group", characterId: "c1", characterIds: ["c1", "c2"], speakerId: "c1" },
      { id: "other", characterId: "c2", characterIds: ["c2"] },
    ],
  };
  assert.deepEqual(deletionImpact(st, "characters", "c1"), { deletedChats: 1, updatedChats: 1, updatedProfiles: 0 });
  const next = removeCascade(st, "characters", "c1");
  assert.deepEqual(next.characters.map((c) => c.id), ["c2"]);
  assert.deepEqual(next.chats.map((c) => c.id), ["group", "other"], "solo chat is dropped, others kept");
  const group = next.chats.find((c) => c.id === "group");
  assert.deepEqual(group.characterIds, ["c2"]);
  assert.equal(group.characterId, "c2", "main speaker is promoted");
  assert.equal(group.speakerId, "c2", "dangling speakerId is repointed");
});

test("deleting a world/persona/scenario clears the reference, keeps the chat", () => {
  const st = { worlds: [{ id: "w1" }], chats: [{ id: "a", worldId: "w1" }, { id: "b", worldId: null }] };
  assert.equal(deletionImpact(st, "worlds", "w1").updatedChats, 1);
  const next = removeCascade(st, "worlds", "w1");
  assert.equal(next.chats.length, 2, "chats survive");
  assert.equal(next.chats[0].worldId, null, "dangling worldId cleared");
});

test("deleting a preset unlinks it from connection profiles", () => {
  const st = { presets: [{ id: "p1" }], profiles: [{ id: "x", presetId: "p1" }, { id: "y", presetId: null }] };
  assert.equal(deletionImpact(st, "presets", "p1").updatedProfiles, 1);
  const next = removeCascade(st, "presets", "p1");
  assert.equal(next.profiles[0].presetId, null);
});

test("impact summary reads as a sentence, empty when nothing else changes", () => {
  assert.equal(impactSummary({ deletedChats: 0, updatedChats: 0, updatedProfiles: 0 }), "");
  assert.equal(impactSummary({ deletedChats: 1, updatedChats: 2, updatedProfiles: 0 }),
    "1 chat will also be deleted, 2 chats will be updated.");
});

test("preset section order actually reorders the prompt", () => {
  const blocks = { system: "SYS", character: "CHAR", lore: "LORE", persona: "PERSONA" };
  const preset = { sections: [
    { role: "lore", enabled: true, order: 0 },
    { role: "system", enabled: true, order: 1 },
    { role: "character", enabled: true, order: 2 },
    { role: "persona", enabled: true, order: 3 },
  ] };
  assert.equal(assemblePrompt(blocks, preset), "LORE\nSYS\nCHAR\nPERSONA");
  // and the default order differs, proving the preset is what moved it
  assert.equal(assemblePrompt(blocks, null), "SYS\nCHAR\nLORE\nPERSONA");
});

test("a disabled section is dropped; an unmentioned role is still kept", () => {
  const blocks = { system: "SYS", lore: "LORE", memory: "MEM" };
  const preset = { sections: [
    { role: "system", enabled: true, order: 0 },
    { role: "lore", enabled: false, order: 1 },
  ] };
  const out = assemblePrompt(blocks, preset);
  assert.ok(!out.includes("LORE"), "disabled section must not appear");
  assert.ok(out.includes("MEM"), "role the preset never mentions must not silently vanish");
});

test("empty blocks never leave blank gaps", () => {
  assert.equal(assemblePrompt({ system: "SYS", lore: "", memory: "   " }, null), "SYS");
});

test("preset survives an ST export/import round-trip, top_p included", () => {
  const original = {
    id: "p1", name: "Cinematic", topP: 0.85, temperature: 1.1, maxTokens: 2048, style: "slow burn",
    sections: [{ name: "Lorebook", role: "lore", enabled: true, order: 0 },
               { name: "System rules", role: "system", enabled: false, order: 1 }],
  };
  const back = fromSTPreset(toSTPreset(original));
  assert.equal(back.topP, 0.85, "top_p used to be dropped on import");
  assert.equal(back.temperature, 1.1);
  assert.equal(back.maxTokens, 2048);
  assert.equal(back.style, "slow burn");
  assert.deepEqual(back.sections.map((s) => s.role), ["lore", "system"], "order preserved");
  assert.equal(back.sections[1].enabled, false, "disabled stays disabled");
});

test("a linked preset supplies topP, not just temperature and maxTokens", () => {
  const state = { presets: [{ id: "p1", temperature: 1.2, maxTokens: 300, topP: 0.5 }] };
  const profile = { presetId: "p1" }; // profile sets nothing itself
  const params = textParams(state, profile);
  assert.equal(params.temperature, 1.2);
  assert.equal(params.maxTokens, 300);
  assert.equal(params.topP, 0.5, "preset topP was previously ignored");
  // an explicit profile value still wins
  assert.equal(textParams(state, { presetId: "p1", topP: 0.9 }).topP, 0.9);
});

test("a profile that sets no samplers inherits every one from its preset", () => {
  const state = { presets: [{ id: "p1", temperature: 1.15, maxTokens: 1536, topP: 0.82, style: "cinematic" }] };
  const inherit = textParams(state, { presetId: "p1", temperature: null, maxTokens: null, topP: null });
  assert.equal(inherit.temperature, 1.15, "preset temperature must apply");
  assert.equal(inherit.maxTokens, 1536, "preset maxTokens must apply");
  assert.equal(inherit.topP, 0.82, "preset topP must apply");
  assert.ok(inherit.style.includes("cinematic"));

  // an explicit profile value still overrides the preset
  const override = textParams(state, { presetId: "p1", temperature: 0.2, maxTokens: null, topP: null });
  assert.equal(override.temperature, 0.2);
  assert.equal(override.maxTokens, 1536, "unset fields still inherit");

  // no preset linked -> documented fallbacks
  const bare = textParams({ presets: [] }, { presetId: null, temperature: null, maxTokens: null, topP: null });
  assert.deepEqual([bare.temperature, bare.maxTokens, bare.topP], [0.8, 1024, 1]);
});

test("an imported preset is named after its file, not \"Imported Preset\"", () => {
  assert.equal(presetNameFromFile("Cinematic Roleplay.json"), "Cinematic Roleplay");
  assert.equal(presetNameFromFile("Cinematic-preset.json"), "Cinematic", "our own export suffix is stripped");
  assert.equal(presetNameFromFile("Deep_Roleplay_preset.json"), "Deep Roleplay");
  assert.equal(presetNameFromFile(""), "");

  // an ST file with no internal name used to become "Imported Preset"
  const st = { temperature: 1.0, prompts: [{ name: "Lorebook", role: "lore", enabled: true }] };
  assert.equal(fromSTPreset(st, "Midnight Noir.json").name, "Midnight Noir");
  // no filename available -> fall back to the internal name, then the old default
  assert.equal(fromSTPreset({ name: "Inner" }).name, "Inner");
  assert.equal(fromSTPreset({}).name, "Imported Preset");
});

test("a real ST preset keeps each prompt's own text and role", async () => {
  // shape of a real SillyTavern chat-completion preset (inlined, not a temp file)
  const raw = {
    temperature: 1.05, top_p: 0.9, openai_max_tokens: 900,
    prompts: [
      { identifier: "main", name: ".+`.. Core Directive", system_prompt: true, role: "system",
        content: "You are a masterful narrator. Write vivid, grounded prose.", marker: false },
      { identifier: "immersion", name: "Immersion", system_prompt: true, role: "system",
        content: "Never break character. Never mention being an AI.", marker: false },
      { identifier: "charDescription", name: "Chara Cards", role: "system", marker: true },
      { identifier: "wordcount", name: "Word Count", system_prompt: true, role: "system",
        content: "Keep replies under 250 words.", marker: false },
      { identifier: "personaDescription", name: "Persona", role: "system", marker: true },
      { identifier: "worldInfoBefore", name: "World Info", role: "system", marker: true },
      { identifier: "chatHistory", name: "Chat History", role: "system", marker: true },
      { identifier: "unusedA", name: "UNUSED", system_prompt: true, role: "system", content: "", marker: false },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: "main", enabled: true },
      { identifier: "immersion", enabled: true },
      { identifier: "charDescription", enabled: true },
      { identifier: "personaDescription", enabled: true },
      { identifier: "worldInfoBefore", enabled: true },
      { identifier: "wordcount", enabled: false },
      { identifier: "unusedA", enabled: false },
    ] }],
  };
  const p = fromSTPreset(raw, "Deep Roleplay.json");

  // chatHistory is not a system-prompt section
  assert.ok(!p.sections.some((s) => s.role === "history"));

  const core = p.sections.find((s) => s.name === ".+`.. Core Directive");
  assert.equal(core.content, "You are a masterful narrator. Write vivid, grounded prose.",
    "literal prompt text was previously discarded");

  // markers map to the role that supplies that material, not all to "system"
  const roles = Object.fromEntries(p.sections.map((s) => [s.name, s.role]));
  assert.equal(roles["Chara Cards"], "character");
  assert.equal(roles["Persona"], "persona");
  assert.equal(roles["World Info"], "lore");
  assert.notEqual(new Set(Object.values(roles)).size, 1, "not every section may collapse to one role");

  // enabled + order come from prompt_order
  assert.equal(p.sections.find((s) => s.name === "Word Count").enabled, false);
  assert.equal(p.sections.find((s) => s.name === "UNUSED").enabled, false);
  assert.equal(p.sections[0].name, ".+`.. Core Directive", "prompt_order drives ordering");
});

test("literal sections are sent verbatim; markers pull app blocks", () => {
  const blocks = { character: "CHAR-BLOCK", persona: "PERSONA-BLOCK" };
  const preset = { sections: [
    { name: "Core", role: "system", content: "WRITE VIVIDLY", enabled: true, order: 0 },
    { name: "Chara", role: "character", content: "", enabled: true, order: 1 },
    { name: "Off", role: "system", content: "SHOULD NOT APPEAR", enabled: false, order: 2 },
    { name: "Persona", role: "persona", content: "", enabled: true, order: 3 },
  ] };
  const out = assemblePrompt(blocks, preset);
  assert.equal(out, "WRITE VIVIDLY\nCHAR-BLOCK\nPERSONA-BLOCK");
  assert.ok(!out.includes("SHOULD NOT APPEAR"));
});

test("two literal sections both survive, and identity is not lost", () => {
  const preset = { sections: [
    { name: "A", role: "system", content: "FIRST", enabled: true, order: 0 },
    { name: "B", role: "system", content: "SECOND", enabled: true, order: 1 },
  ] };
  // both literals kept in order (sharing a role must not dedupe them), and the
  // app's own system block still appends -- an ST preset full of literal
  // prompts must not silently drop "You are <character>"
  // neither literal mentions the character, so identity is still guaranteed
  assert.equal(assemblePrompt({ system: "IDENTITY" }, preset), "FIRST\nSECOND\nIDENTITY");
  // but once a literal introduces the character, it is not stated twice
  const named = { sections: [{ name: "A", role: "system", content: "You are {{char}}.", enabled: true, order: 0 }] };
  assert.equal(assemblePrompt({ system: "IDENTITY" }, named, { char: "Serah" }), "You are Serah.");
});

test("a disabled marker section stays dropped, not resurrected by the fallback", () => {
  const preset = { sections: [{ name: "Lore", role: "lore", content: "", enabled: false, order: 0 }] };
  assert.equal(assemblePrompt({ lore: "LORE" }, preset), "", "disabling must beat the fallback");
});

test("a preset exported by this app re-imports exactly", () => {
  const original = {
    id: "p1", name: "Mine", temperature: 1.05, maxTokens: 900, topP: 0.9, style: "",
    sections: [
      { name: "Core", role: "system", content: "WRITE VIVIDLY", enabled: true, order: 0 },
      { name: "Chara", role: "character", content: "", enabled: false, order: 1 },
    ],
  };
  const back = fromSTPreset(toSTPreset(original), "Mine-preset.json");
  assert.equal(back.name, "Mine");
  assert.deepEqual(back.sections.map((s) => [s.name, s.role, s.content, s.enabled]),
                   original.sections.map((s) => [s.name, s.role, s.content, s.enabled]));
});

test("empty ST placeholders are inert, not filled with an unrelated block", () => {
  const st = { prompts: [
    { identifier: "u1", name: "UNUSED", role: "system", content: "", marker: false },
    { identifier: "u2", name: "UNUSED", role: "system", content: "", marker: false },
    { identifier: "main", name: "Core", role: "system", content: "WRITE VIVIDLY", marker: false },
  ] };
  const p = fromSTPreset(st, "x.json");
  const unused = p.sections.filter((s) => s.name === "UNUSED");
  assert.equal(unused.length, 2);
  assert.ok(unused.every((s) => s.role === "none"), "empty placeholders must not claim a real role");

  // they contribute nothing, and they do NOT suppress the app's own system block
  // an ST preset is authoritative: only the guaranteed identity block is added
  const out = assemblePrompt({ system: "IDENTITY", character: "CHAR" }, p);
  assert.equal(out, "WRITE VIVIDLY\nIDENTITY");
  assert.ok(!out.includes("undefined"));
});

test("ST macros are substituted, never sent as raw braces", () => {
  const vars = { char: "Serah Vane", user: "Rowan Ash", personality: "stoic" };
  const out = substituteMacros("You are {{char}}, speaking with {{user}}. {{personality}}.", vars);
  assert.equal(out, "You are Serah Vane, speaking with Rowan Ash. stoic.");
  assert.ok(!/\{\{/.test(out));

  // spacing and case tolerated
  assert.equal(substituteMacros("{{ Char }} / {{USER}}", vars), "Serah Vane / Rowan Ash");
  // identity macros never collapse to nothing
  assert.equal(substituteMacros("You are {{char}}, with {{user}}.", {}), "You are the character, with the user.");
  // unknown macros are left alone rather than silently deleted
  assert.equal(substituteMacros("keep {{unknown_thing}}", vars), "keep {{unknown_thing}}");
});

test("a preset with its own text does not get our blocks appended on top", () => {
  const blocks = { system: "You are Serah Vane. Stoic.", character: "CHAR", persona: "PERSONA" };
  const literalPreset = {
    sections: [
      { name: "Core", role: "system", content: "You are {{char}}. Stay in character.", enabled: true, order: 0 },
      { name: "Chara", role: "character", content: "", enabled: true, order: 1 },
    ],
  };
  const out = assemblePrompt(blocks, literalPreset, { char: "Serah Vane" });
  assert.equal((out.match(/You are/g) || []).length, 1, "identity must not be stated twice");
  assert.ok(!out.includes("PERSONA"), "unplaced blocks are not appended to an authoritative preset");

  // an explicit opt-in brings the safety net back
  const opted = { ...literalPreset, appendUnplaced: true };
  assert.ok(assemblePrompt(blocks, opted, { char: "Serah Vane" }).includes("PERSONA"));

  // a marker-only preset (built in this app) keeps the net by default
  const appPreset = { sections: [{ name: "Chara", role: "character", content: "", enabled: true, order: 0 }] };
  assert.ok(assemblePrompt(blocks, appPreset).includes("PERSONA"), "app presets still append");
});

test("unplacedRoles reports exactly what the fallback would add", () => {
  const preset = { sections: [
    { name: "Chara", role: "character", content: "", enabled: true, order: 0 },
    { name: "Lore", role: "lore", content: "", enabled: false, order: 1 },
  ] };
  const un = unplacedRoles(preset);
  assert.ok(!un.includes("character") && !un.includes("lore"), "placed roles excluded even when disabled");
  assert.ok(un.includes("system") && un.includes("memory"));
});

test("virtual human presence follows their routine and the clock", () => {
  const vh = { routine: ["Sleeps 9am-4pm", "Paints 10pm-2am"] };
  const at = (h, m = 0) => { const d = new Date(2026, 0, 1, h, m); return d; };
  assert.equal(presenceOf(vh, at(11)).key, "asleep");
  assert.equal(presenceOf(vh, at(23)).key, "busy");
  assert.equal(presenceOf(vh, at(23)).activity, "Paints");
  assert.equal(presenceOf(vh, at(1)).key, "busy", "block that wraps past midnight");
  assert.equal(presenceOf(vh, at(18)).key, "available");
  assert.equal(presenceOf({ routine: [] }, at(3)).key, "asleep", "small hours with nothing scheduled");
});

test("uploaded images are downscaled to fit, never upscaled", () => {
  assert.deepEqual(fitWithin(4000, 3000, 512), { w: 512, h: 384 });
  assert.deepEqual(fitWithin(3000, 4000, 512), { w: 384, h: 512 });
  assert.deepEqual(fitWithin(300, 200, 512), { w: 300, h: 200 }, "small images stay as they are");
  assert.deepEqual(fitWithin(0, 0, 512), { w: 0, h: 0 });
});

test("emoji are stripped from generated data, and nothing else changes", () => {
  assert.equal(stripEmoji("⚔️ Serah Vane"), "Serah Vane");
  assert.equal(stripEmoji("Night nurse 👩‍⚕️"), "Night nurse", "ZWJ sequence removed whole");
  assert.equal(stripEmoji("wave 👋🏽 hi"), "wave hi", "skin-tone modifier removed too");
  assert.equal(stripEmoji("line one\n🔥 line two"), "line one\nline two", "newlines survive, no stray space");
  assert.equal(stripEmoji("© 2026 → north ™"), "© 2026 → north ™", "plain symbols untouched");
  const plain = "  keep   my   spacing  ";
  assert.equal(stripEmoji(plain), plain, "untouched strings stay byte-identical");

  const card = stripEmoji({ name: "🕯️ Pip", tags: ["rogue", "🔥", ""], nested: { t: "ok 🎲" }, n: 3 });
  assert.deepEqual(card, { name: "Pip", tags: ["rogue", ""], nested: { t: "ok" }, n: 3 },
    "emoji-only tag dropped; pre-existing empty string kept");
});

test("no emoji anywhere in the app's source or README", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(jsx?|mjs|css|html|md)$/.test(e.name) && !e.name.endsWith(".test.mjs")) files.push(f);
    }
  };
  walk(path.join(root, "src"));
  files.push(path.join(root, "README.md"), path.join(root, "index.html"));
  const rx = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (rx.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 60)}`);
    });
  }
  assert.deepEqual(hits, [], "emoji found:\n" + hits.join("\n"));
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "\n      " + e.message); }
}
console.log(failed ? `\n${failed} failing` : `\nall ${tests.length} passing`);
process.exit(failed ? 1 : 0);
