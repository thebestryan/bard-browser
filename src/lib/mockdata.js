/**
 * Offline mock fixtures for the mock provider. Kept out of ai.js so the
 * service layer stays readable; nothing here is used by real providers.
 */

export const MOCK_WORLDS = [
  {
    name: "Brinemouth", genre: "Drowned Steampunk", tagline: "The tide decides who rules.",
    description: "A canal-city of brass and brine where the daily flood redraws the map of power. When the tide rises, the lower wards drown and the rich seal their doors; when it falls, smugglers and tide-gangs claim the streets.",
    locations: [
      { name: "The Harbor Market", type: "building", description: "Stalls on stilts, fish-glass lanterns, and the Tide Guild's toll desk.", mood: "bustling, salt-crusted" },
      { name: "The Lower Wards", type: "town", description: "Half-drowned tenements connected by rope bridges, home of the tide-gangs.", mood: "dangerous, resilient" },
      { name: "The Clockspire", type: "landmark", description: "A gear-driven tower whose bells warn of the flood. Whoever rings them, rules.", mood: "imposing" },
    ],
    npcs: [
      { name: "Warden Ilex", role: "Tide Guild officer", location: "The Harbor Market", personality: "pompous but fair-minded", goal: "Keep the tolls flowing and the Clockspire bells loyal to the Guild", secret: "She cannot swim", schedule: "Collects tolls at morning tide, drinks at the Gull & Gear by evening" },
      { name: "Fen", role: "Tide-gang runner", location: "The Lower Wards", personality: "cheerful, slippery", goal: "Steal the Clockspire bell-key for the gangs", secret: "Fen is the Warden's estranged child", schedule: "Sleeps at dawn, works the flood" },
      { name: "Old Marlow", role: "Clockspire keeper", location: "The Clockspire", personality: "deaf, cryptic", goal: "Ring the bells one last time before he dies", secret: "He already sold the bell-key", schedule: "Never leaves the spire" },
    ],
    factions: [
      { name: "The Tide Guild", attitude: "hostile", description: "Merchant-lords who own the flood barriers and charge the city to stay dry." },
      { name: "The Gangs of the Wards", attitude: "neutral", description: "Semi-allied street crews who move with the water." },
      { name: "The Bellringers", attitude: "friendly", description: "A quiet order that believes the bells belong to everyone." },
    ],
    items: [
      { name: "Brass Lung", type: "tool", description: "Rebreather allowing ten minutes underwater." },
      { name: "Tide Chart, annotated", type: "treasure", description: "Predicts the next flood weeks ahead. Worth killing for." },
      { name: "Rust-cutlass", type: "weapon", description: "Cheap, jagged, everywhere." },
    ],
    quests: [
      { title: "Ring the Bells", description: "Someone must warn the Lower Wards before the great tide — and choose who rules after.", status: "open" },
      { title: "The Warden's Ledger", description: "Steal the Tide Guild's toll ledger from the Harbor Market.", status: "open" },
    ],
    startLocation: "The Harbor Market", timeOfDay: "morning", weather: "fog",
  },
  {
    name: "Vespergate", genre: "Cozy Fantasy", tagline: "Every cottage hides a secret.",
    description: "A hillside town of crooked lanes, honey bread, and small magics. Nothing terrible ever happens — officially. In practice, everyone owes someone a favor and the mayor's cat knows too much.",
    locations: [
      { name: "The Bun & Bristle", type: "building", description: "Bakery by day, gossip den by night.", mood: "warm, floury" },
      { name: "The Hanging Gardens", type: "wilderness", description: "Terraced orchards where the fruit hums old songs.", mood: "peaceful" },
      { name: "Mayor's Row", type: "town", description: "The nicer half of the hill. Mostly honest fences.", mood: "genteel" },
    ],
    npcs: [
      { name: "Bram", role: "Baker", location: "The Bun & Bristle", personality: "jolly, evasive", goal: "Win the regional bread festival", secret: "His starter is a minor fire spirit", schedule: "Rises at 4, naps at noon, tales at dusk" },
      { name: "Sela Quill", role: "Letter-writer", location: "Mayor's Row", personality: "curious, discreet", goal: "Read one letter she shouldn't", secret: "She already has — several", schedule: "Post at midday, ink by candlelight" },
    ],
    factions: [
      { name: "The Festival Committee", attitude: "friendly", description: "Controls the calendar and, therefore, everything." },
      { name: "The Night Market", attitude: "neutral", description: "Trades in forgotten things after midnight." },
    ],
    items: [
      { name: "Everwarm Mittens", type: "clothing", description: "Hands stay toast-adjacent in any weather." },
      { name: "Maple Biscuit (enchanted)", type: "consumable", description: "Restores 2 cheer and one small memory." },
      { name: "Whistling Kettle", type: "tool", description: "Boils water and alerts you to eavesdroppers." },
    ],
    quests: [
      { title: "The Missing Recipe", description: "Bram's festival recipe has wandered off. The cat may know.", status: "open" },
    ],
    startLocation: "The Bun & Bristle", timeOfDay: "morning", weather: "clear",
  },
  {
    name: "Ashfall Reach", genre: "Post-Apocalyptic", tagline: "The caravan is the nation.",
    description: "A country of moving towns: a mile-long convoy of repaired, re-purposed vehicles crossing an ash plain, chasing clean water and old-world salvage.",
    locations: [
      { name: "The Convoy", type: "town", description: "Rig-city: engine hall, water racks, and the Council trailer.", mood: "grim determination" },
      { name: "The Glass Flats", type: "wilderness", description: "A fused desert of mirrored sand that blinds at noon.", mood: "eerie, beautiful" },
      { name: "Station Nineteen", type: "dungeon", description: "A buried rail depot, half-collapsed, rumored to hold a working water purifier.", mood: "silent" },
    ],
    npcs: [
      { name: "Mother Diesel", role: "Convoy Council head", location: "The Convoy", personality: "pragmatic, tired", goal: "Reach the coast before the fuel runs out", secret: "The fuel ran out last week", schedule: "Council at dawn, rounds at dusk" },
      { name: "Ticker", role: "Salvage scout", location: "The Glass Flats", personality: "manic, brilliant", goal: "Map the buried rail network", secret: "He's hearing radio voices again", schedule: "Scouts at first light, drinks after dark" },
    ],
    factions: [
      { name: "The Council", attitude: "friendly", description: "Keeps the convoy moving and the peace barely." },
      { name: "The Rustvipers", attitude: "hostile", description: "Raiders who take water and leave ashes." },
    ],
    items: [
      { name: "Ash Goggles", type: "tool", description: "Cuts glare on the Glass Flats." },
      { name: "Water chit", type: "treasure", description: "A liter of the convoy's most valuable currency." },
      { name: "Scrap rifle", type: "weapon", description: "Loud, unreliable, beloved." },
    ],
    quests: [
      { title: "Water at Station Nineteen", description: "Scout the buried depot for the purifier before the Rustvipers do.", status: "open" },
    ],
    startLocation: "The Convoy", timeOfDay: "afternoon", weather: "clear",
  },
];

export const MOCK_CHARACTERS = [
  { name: "Serah Vane", tags: ["knight", "amnesiac", "stoic"], appearance: "Tall, worn plate armor engraved with a name she can't read. A scar across the left eyebrow.", personality: "Honor-bound, quietly furious about her missing memories, protective of anyone smaller than her. Dry humor surfaces rarely.", scenario: "She wakes in the ruins of the chapter-house with no past and a sword that people keep recognizing.", greeting: "*She draws the sword halfway, then stops.*\n\nYou. You know this blade. Tell me whose name is on it — or walk away while I'm still asking politely.", examples: ["\"I don't need my past. I need a direction.\"", "\"Knights are made by oaths. I remember the oath. Nothing else.\""] },
  { name: "Pip Tallowwick", tags: ["rogue", "chatty", "lucky"], appearance: "Small, quick, permanently smudged with soot. Grin like a loan shark.", personality: "Talks first, steals second, apologizes never. Secretly sentimental.", scenario: "Caught (again) picking locks in the market district, one step ahead of the watch.", greeting: "Okay, okay — before you say anything: the lock was *asking* for it. Name's Pip. You look like someone who needs a problem *solved*, and I happen to be a solution with pockets.", examples: ["\"I have never been arrested. Detained, sure. Arrested, never.\"", "\"Luck isn't magic. It's just very, very consistent — for me.\""] },
];

export const MOCK_PERSONAS = [
  { name: "Rowan Ash", description: "A curious cartographer who is always, reliably, lost.", traits: ["curious", "unlucky", "endlessly optimistic"], voice: "Warm and over-caffeinated; narrates their own misadventures." },
  { name: "The Nameless Broker", description: "A fixer for hire with no history and too many names.", traits: ["calm", "transactional", "loyal to contracts, not people"], voice: "Flat, precise, faintly amused." },
];

export const MOCK_SCENARIOS = [
  { title: "The Night Train", summary: "A murder at midnight on the sleeper train — and everyone's alibi is your secret.", opening: "*The train lurches. The lights flicker out for exactly four seconds. When they return, the conductor is face-down in aisle three.*" },
  { title: "First Contact, Gone Sideways", summary: "The alien delegation's translator has broken — and it's learning language from your group chat.", opening: "*The landing pad smells of ozone. The envoy raises three hands and says, clearly, in your voice: 'Okay so basically—'*" },
];

export const MOCK_VH = [
  { name: "Nadia Reyes", age: "31", occupation: "Night-shift nurse", location: "Port Calloway", personality: "Dry-wired humor, deeply caring, terrible at resting.", mood: "tired but warm", routine: ["Sleeps 9am–4pm", "Night shift at St. Brendan's", "Reads on the pier after shift"], memories: ["Talked a jumper off the pier railing last winter", "Hates the vending machine on floor 3, keeps using it"], boundaries: "Kind but firm; doesn't tolerate being condescended to about her job." },
  { name: "Otto Brunner", age: "27", occupation: "Freelance artist", location: "Flat 4B, Eldon Street", personality: "Chaotic schedule, warm heart, deadline-phobic.", mood: "manic creative", routine: ["Paints 10pm–4am", "Coffee at noon, groceries at 1", "Ignores phone until inspired"], memories: ["Sold a piece to someone famous and told no one", "Ex still texts on the first of the month"], boundaries: "Avoids conflict; goes quiet rather than angry." },
];

export const MOCK_LORE = [
  { name: "The Drowned City — Lore", entries: [
    { keys: ["tide", "flood"], content: "The Great Tide floods the lower city every day at dusk. The wealthy raise barriers; the poor tie their doors to the walls." },
    { keys: ["guild"], content: "The Tide Guild owns every barrier contract. Its seal is a crab holding a key." },
    { keys: ["clockspire", "bell"], content: "The Clockspire's bells are rung only to warn of flood. Unlawful ringing is a hanging offense." },
  ] },
];
