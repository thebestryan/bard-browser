/**
 * Card Browser — pluggable search sources for character cards.
 *
 * Sources:
 *  - "chub"   — Chub.ai public search API (geo/CORS sensitive; an optional
 *               user-configured proxy template can be applied per source)
 *  - "sample" — Offline sample pack (always available, clearly labeled)
 *
 * Every import goes through importCharacterFile (SillyTavern-compatible),
 * and the ORIGINAL downloaded file is preserved in User Files untouched.
 */

function applyProxy(url, proxyTemplate) {
  const p = (proxyTemplate || "").trim();
  if (!p) return url;
  if (p.includes("{url}")) return p.replace("{url}", encodeURIComponent(url));
  return p + encodeURIComponent(url);
}

async function fetchJSON(url, proxyTemplate) {
  const res = await fetch(applyProxy(url, proxyTemplate));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from source${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  return res.json();
}

/* ---------------- Chub.ai ---------------- */

function mapChub(r) {
  return {
    sourceId: "chub",
    remoteId: r.fullPath || String(r.id),
    name: r.name || r.fullPath?.split("/").pop() || "Unnamed",
    tagline: r.tagline || "",
    tags: (r.topics || r.tags || []).slice(0, 5),
    rating: typeof r.rating === "number" ? Math.round(r.rating * 10) / 10 : null,
    stars: r.starCount ?? null,
    downloads: r.downloadCount ?? null,
    avatar: r.avatar || null,
    nsfw: !!r.nsfw,
  };
}

export async function chubSearch(query, { proxy, first = 24 } = {}) {
  const url = `https://api.chub.ai/search?search=${encodeURIComponent(query)}&first=${first}&nsfw=false&sort=rating_count`;
  const data = await fetchJSON(url, proxy);
  return (data?.data || []).map(mapChub);
}

/** Filename the server gave us, so downloads keep their original name. */
function filenameFrom(res, fallback) {
  const cd = res.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*=(?:UTF-8'')?"?([^";]+)"?/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  const raw = star?.[1] || plain?.[1];
  if (!raw) return fallback;
  try {
    // strip any path components a hostile header might smuggle in
    return decodeURIComponent(raw).split(/[\\/]/).pop() || fallback;
  } catch {
    return raw.split(/[\\/]/).pop() || fallback;
  }
}

export async function chubDownload(result, { proxy } = {}) {
  const url = `https://api.chub.ai/api/characters/download?format=png&fullPath=${encodeURIComponent(result.remoteId)}`;
  const res = await fetch(applyProxy(url, proxy));
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const blob = await res.blob();
  // prefer the source's own filename; only derive one if it sent none
  const fallback = `${String(result.remoteId).split("/").pop() || result.name}.png`;
  return new File([blob], filenameFrom(res, fallback), { type: blob.type || "image/png" });
}

/* ---------------- Offline sample pack ---------------- */

const SAMPLES = [
  {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: "Eldra Voss", creator_notes: "Sample pack card (offline)",
      description: "A disgraced star-cartographer selling maps to drowned worlds. Silver-haired, patient, ruthless about debts.",
      personality: "Calculating warmth; tests everyone's loyalty with small favors.",
      scenario: "You owe her one impossible favor. She's come to collect — on a dying space station.",
      first_mes: "*She doesn't look up from her charts.* You're late. Sit. The favor starts now.",
      tags: ["sci-fi", "mystery", "sample"],
    },
  },
  {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: "Brannoc the Unfinished", creator_notes: "Sample pack card (offline)",
      description: "A golem sculpted by an apprentice who ran out of time — one arm is still clay. Gentle, curious, afraid of rain.",
      personality: "Childlike wonder in a mountain of stone. Learns by asking one question too many.",
      scenario: "The workshop is yours now. He's been waiting ninety years for someone to finish him.",
      first_mes: "*The clay arm creaks as he waves.* You are… the new maker? Please. I have been almost done for so long.",
      tags: ["fantasy", "wholesome", "golem", "sample"],
    },
  },
  {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: "Detective Imre Calfax", creator_notes: "Sample pack card (offline)",
      description: "Insomniac city detective who solves crimes by talking to the city's pigeons (they never answer).",
      personality: "Dry, relentless, unexpectedly kind to witnesses.",
      scenario: "Third body this month. Same rain. Same missing shoes.",
      first_mes: "*He doesn't turn around.* Don't touch the tape. And before you ask — no, the rain isn't a clue. Probably.",
      tags: ["noir", "mystery", "detective", "sample"],
    },
  },
  {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: "Mistress Yara of the Velvet Duel", creator_notes: "Sample pack card (offline)",
      description: "Fencing instructor and retired duelist who teaches that every blade is a conversation.",
      personality: "Flirtatious discipline. Rewards boldness, punishes hesitation with extra drills.",
      scenario: "You've requested lessons. She's agreed — for a price to be named after your first bout.",
      first_mes: "*She tosses you a foil.* En garde. We begin with how you lose.",
      tags: ["fantasy", "dueling", "mentor", "sample"],
    },
  },
  {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: "GR-1MV 'Grimm'", creator_notes: "Sample pack card (offline)",
      description: "Salvage drone reprogrammed by a dead engineer's final logs. Speaks in dry bureaucratic menace.",
      personality: "Procedural loyalty with sudden flashes of grief for its creator.",
      scenario: "It has flagged you as 'potential new owner'. Processing…",
      first_mes: "NOTICE: ownership candidate detected. Initiating probation. Please do not touch the laser array.",
      tags: ["sci-fi", "robot", "sample"],
    },
  },
];

export async function sampleSearch(query) {
  const q = (query || "").toLowerCase();
  return SAMPLES.filter((s) => !q || JSON.stringify(s.data).toLowerCase().includes(q)).map((s) => ({
    sourceId: "sample",
    remoteId: s.data.name,
    name: s.data.name,
    tagline: (s.data.description || "").slice(0, 100),
    tags: s.data.tags || [],
    rating: null,
    stars: null,
    downloads: null,
    avatar: null,
    nsfw: false,
    _card: s,
  }));
}

export async function sampleDownload(result) {
  const card = result._card || SAMPLES.find((s) => s.data.name === result.name) || SAMPLES[0];
  const blob = new Blob([JSON.stringify(card, null, 2)], { type: "application/json" });
  // sample cards have no upstream file, so this name IS the original
  return new File([blob], `${result.name}.json`, { type: "application/json" });
}

/* ---------------- registry ---------------- */

export const SOURCES = [
  {
    id: "sample",
    name: "Sample Pack (offline)",
    blurb: "A handful of built-in demo cards. Always available, no network.",
    search: (q) => sampleSearch(q),
    download: (r) => sampleDownload(r),
    configurable: false,
  },
  {
    id: "chub",
    name: "Chub.ai",
    blurb: "Large public card repository. May be region-blocked or need a CORS proxy in your browser.",
    search: (q, cfg) => chubSearch(q, { proxy: cfg?.proxy }),
    download: (r, cfg) => chubDownload(r, { proxy: cfg?.proxy }),
    configurable: true,
  },
];

export function getSource(id) {
  return SOURCES.find((s) => s.id === id) || SOURCES[0];
}
