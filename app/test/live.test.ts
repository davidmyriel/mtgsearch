// End-to-end against the live TopK collection. Skipped unless TOPK_API_KEY is set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "topk-js";
import { handleCard, handleSearch, MAX_REACH, MAX_RESULTS } from "../api.ts";
import { card, MAX_PRINTINGS, randomCard } from "../card.ts";
import { chooseTheme, exampleCards, EXAMPLES, home, HOME_CARDS, newestSets, randomCards, themedCards, THEMES } from "../home.ts";
import { search } from "../search.ts";
import type { Collection, Collections } from "../search.ts";

const key = (process.env.TOPK_API_KEY ?? "").trim();
const skip = key ? false : "TOPK_API_KEY is not set";
const collection = (): Collections => {
  const client = new Client({ apiKey: key, region: process.env.TOPK_REGION || "aws-us-east-1-elastica" });
  return {
    cards: client.collection(process.env.MTGSEARCH_COLLECTION || "mtg-cards-v2") as unknown as Collection,
    printings: client.collection(process.env.MTGSEARCH_PRINTINGS_COLLECTION || "mtg-printings-v1") as unknown as Collection,
  };
};
const names = (result: { hits: { name: string }[] }) => result.hits.map((h) => h.name);

test("syntax query returns exactly the matching cards", { skip }, async () => {
  const result = await search(collection(), 'c:u t:sphinx o:"draw two cards"');
  assert.equal(result.mode, "syntax");
  assert.equal(result.total, result.hits.length);
  assert.ok(result.total !== null && result.total >= 3);
  assert.ok(names(result).includes("Consecrated Sphinx"));
});

test("plain English finds the card", { skip }, async () => {
  const result = await search(collection(), "sphinx that draws two cards");
  assert.equal(result.mode, "semantic");
  assert.equal(result.note, "sphinx");
  assert.equal(names(result)[0], "Consecrated Sphinx");
  assert.equal(typeof result.hits[0].score, "number");
});

// A card or two that each example the home page offers has to find among its first results.
// An example with no entry here fails the test below: none is offered that has not been looked at.
const FINDS: Record<string, string[]> = {
  "angel that gains life": ["Angel of Vitality", "Angel of Mercy", "Herald of Faith"],
  "knight with first strike": ["White Knight", "Black Knight", "Knight of Malice"],
  "white enchantment removal": ["Generous Gift", "Disenchant", "Stroke of Midnight"],
  "creature that taxes spells": ["Esper Sentinel", "Spelltithe Enforcer", "Aven Interrupter"],
  "tithe alternative": ["Land Tax", "Gift of Estates"],
  "sphinx that draws two cards": ["Consecrated Sphinx"],
  "blue land destruction": ["Erosion", "Mana Vortex", "Volcanic Eruption"],
  "wizard that copies spells": ["Echo Mage", "Naru Meha, Master Wizard", "Dualcaster Mage"],
  "merfolk that draws cards": ["Silvergill Adept", "Seafloor Oracle", "Mindspring Merfolk"],
  "brainstorm alternative": ["Ponder", "Preordain", "Impulse"],
  "black creature removal": ["Infernal Grasp", "Go for the Throat", "Deadly Rollick"],
  "reanimate a creature": ["Reanimate", "Animate Dead", "Zombify"],
  "demon with a drawback": ["Desecration Demon", "Hellcarver Demon", "Grinning Demon"],
  "zombie that comes back": ["Relentless Dead", "Ashen Ghoul", "Dread Wanderer"],
  "ritual alternative": ["Cabal Ritual", "Culling the Weak"],
  "dwarf that destroys lands": ["Dwarven Miner", "Dwarven Blastminer", "Dwarven Driller"],
  "goblin that makes goblins": ["Krenko, Mob Boss", "Mogg War Marshal", "Goblin Instigator"],
  "dragon with haste": ["Hellkite Charger", "Karrthus, Tyrant of Jund", "Thundermane Dragon"],
  "damage to each creature": ["Anger of the Gods", "Firespout", "Flamebreak"],
  "shock alternative": ["Burst Lightning", "Play with Fire", "Galvanic Blast"],
  "hydra with x in its cost": ["Primordial Hydra", "Hungering Hydra", "Feral Hydra"],
  "druid that untaps lands": ["Ley Druid", "Krosan Restorer", "Argothian Elder"],
  "fight target creature": ["Prey Upon", "Pounce", "Prizefight"],
  "search for a basic land": ["Traverse the Ulvenwald", "Search for Tomorrow", "Traveler's Amulet"],
  "llanowar alternative": ["Elvish Mystic", "Druid of the Cowl", "Leaf Gilder"],
  "equipment that gives haste": ["Swiftfoot Boots", "Boots of Speed", "Helm of the Host"],
  "vehicle with flying": ["Aethersphere Harvester", "Dragonfly Suit", "Mindlink Mech"],
  "artifact that draws cards": ["Mindstorm Crown", "Urza's Miter", "Trigon of Thought"],
  "mana rocks": ["Sol Ring", "Arcane Signet", "Fellwar Stone"],
  "izzet dragon": ["Niv-Mizzet, Parun", "Niv-Mizzet, the Firemind", "Niv-Mizzet, Dracogenius"],
  "orzhov vampire": ["Blood Baron of Vizkopa", "Vizkopa Vampire", "Cliffhaven Vampire"],
  "simic hydra": ["Bioessence Hydra", "Hydroid Krasis", "Zaxara, the Exemplary"],
  "dimir rogue": ["Soaring Thought-Thief", "Dimir Strandcatcher", "Deathcult Rogue"],
};

test("every example the home page offers finds what it promises", { skip }, async () => {
  const cols = collection();
  assert.deepEqual(Object.keys(FINDS).sort(), [...EXAMPLES].sort());
  for (const example of EXAMPLES) {
    const result = await search(cols, example, { k: 10 });
    // by meaning, or as a players' word for a kind of card
    assert.ok(["semantic", "jargon"].includes(result.mode), example);
    assert.equal(result.hits.length, 10, example);
    assert.ok(FINDS[example].some((name) => names(result).includes(name)), `${example}: ${names(result).join("; ")}`);
  }
  // the card itself comes first when one card is described
  assert.equal(names(await search(cols, "sphinx that draws two cards"))[0], "Consecrated Sphinx");
});

test("players' words find the cards players mean, most played first", { skip }, async () => {
  const cols = collection();
  const first = async (query: string) => {
    const result = await search(cols, query, { k: 12 });
    assert.equal(result.mode, "jargon", query);
    return { result, cards: names(result) };
  };
  // the four the home page offers
  const rocks = await first("mana rocks");
  assert.deepEqual(rocks.cards.slice(0, 2), ["Sol Ring", "Arcane Signet"]);
  assert.equal(rocks.result.reads, "otag:mana-rock");
  assert.equal(rocks.result.sortedBy, "edhrec");
  assert.ok(Number(rocks.result.total) > 200 && rocks.result.hasMore);
  assert.ok((await first("bounce spells")).cards.includes("Cyclonic Rift"));
  assert.ok((await first("blink effects")).cards.includes("Ephemerate"));
  const wipes = (await first("board wipes")).cards;
  assert.ok(wipes.includes("Blasphemous Act") && wipes.includes("Toxic Deluge"), wipes.join("; "));
  // the word this site is named for
  assert.deepEqual((await first("tutors")).cards.slice(0, 3), ["Demonic Tutor", "Vampiric Tutor", "Enlightened Tutor"]);
  // a colour in front: cards of exactly that colour
  const white = await first("white board wipes");
  assert.ok(white.cards.includes("Wrath of God") && !white.cards.includes("Blasphemous Act"), white.cards.join("; "));
  assert.ok(white.result.hits.every((hit) => /W/.test(String(hit.mana_cost)) && !/[UBRG]/.test(String(hit.mana_cost))), white.cards.join("; "));
  // the page's own sort order applies, as for any list
  const byName = await search(cols, "mana rocks", { k: 3, order: "name" });
  assert.equal(byName.sortedBy, "name");
  assert.notEqual(names(byName)[0], "Sol Ring");
  // a word that is also exactly a card's name is that card, as for any name
  const card = await search(cols, "counterspell", { k: 3 });
  assert.equal(card.mode, "name");
  assert.equal(card.exact?.name, "Counterspell");
  assert.equal((await search(cols, "counterspells", { k: 3 })).mode, "jargon");
});

test("every players' word the search knows finds cards", { skip }, async () => {
  const { JARGON_WORDS } = await import("../jargon.ts");
  const cols = collection();
  const empty: string[] = [];
  for (const word of JARGON_WORDS) {
    const result = await search(cols, `${word}s`, { k: 1 });
    // a word that is a card's name reads as that card in the singular; the plural is the kind
    if (result.mode !== "jargon" || Number(result.total) < 10) empty.push(`${word} (${result.mode}, ${result.total})`);
  }
  assert.deepEqual(empty, []);
});

test("what a kind of card does, a colour and an effect, and a named card's like", { skip }, async () => {
  const cols = collection();
  // a kind of card and what it does: only that kind
  const dwarves = await search(cols, "dwarf that destroys lands", { k: 8 });
  assert.equal(dwarves.note, "dwarf");
  assert.ok(dwarves.hits.every((hit) => String(hit.type_line).includes("Dwarf")), names(dwarves).join("; "));
  // a colour and an effect: "land" is what is destroyed, not what the card is
  const blue = await search(cols, "blue land destruction", { k: 8 });
  assert.equal(blue.note, "blue");
  assert.ok(blue.hits.filter((hit) => String(hit.type_line).includes("Land")).length <= 1, names(blue).join("; "));
  // two colours by the name players give them, and a kind of card: only cards of both colours
  const izzet = await search(cols, "izzet dragon", { k: 8 });
  assert.equal(izzet.note, "izzet, dragon");
  assert.ok(izzet.hits.every((hit) => String(hit.type_line).includes("Dragon")), names(izzet).join("; "));
  assert.ok(izzet.hits.every((hit) => /U/.test(String(hit.mana_cost)) && /R/.test(String(hit.mana_cost))), names(izzet).join("; "));
  // a card named, and others that do the same wanted: found from that card's own text, without it
  const likeTithe = await search(cols, "tithe alternative", { k: 8 });
  assert.equal(likeTithe.mode, "semantic");
  assert.equal(likeTithe.like, "Tithe");
  assert.ok(!names(likeTithe).includes("Tithe"));
  assert.ok(names(likeTithe).includes("Land Tax") && names(likeTithe).includes("Gift of Estates"), names(likeTithe).join("; "));
});

test("a query that names no card, or asks nothing of the kind, is read as before", { skip }, async () => {
  const cols = collection();
  const none = await search(cols, "frobnicate alternative", { k: 3 });
  assert.equal(none.mode, "semantic");
  assert.equal(none.like, null);
  // asking for a card's alternatives, part of its name will do: the most played card with those words
  assert.equal((await search(cols, "llanowar alternative", { k: 3 })).like, "Llanowar Elves");
  assert.equal((await search(cols, "a ritual replacement", { k: 3 })).like, "Dark Ritual");
  // "like ..." is followed by all sorts of things, so there only a whole name is a card
  assert.equal((await search(cols, "cards like goblins", { k: 3 })).like, null);
  // the second page of cards like a named card follows the first without repeats
  const [first, second] = [await search(cols, "cards like sol ring", { k: 5 }), await search(cols, "cards like sol ring", { k: 5, offset: 5 })];
  assert.equal(first.like, "Sol Ring");
  assert.ok(first.hasMore && second.hits.length === 5);
  assert.equal(new Set([...names(first), ...names(second)]).size, 10);
  assert.ok(![...names(first), ...names(second)].includes("Sol Ring"));
});

test("a card name takes the name path, most-played first", { skip }, async () => {
  const result = await search(collection(), "lightning bolt");
  assert.equal(result.mode, "name");
  assert.equal(names(result)[0], "Lightning Bolt");
});

test("keywords mixed with plain words", { skip }, async () => {
  const result = await search(collection(), "c:u t:sphinx draws when opponents draw");
  assert.equal(result.mode, "mixed");
  assert.equal(names(result)[0], "Consecrated Sphinx");
});

test("negation, regex and comparisons run on TopK", { skip }, async () => {
  const col = collection();
  assert.deepEqual(names(await search(col, "-kw:flying t:sphinx")), ["Petra Sphinx"]);
  assert.equal((await search(col, "t:creature o:/^{T}:/ c:u mv=1", { k: 60 })).total, 13);
  assert.equal((await search(col, "t:fish", { k: 1 })).total, 59); // whole word: no Jellyfish
});

test("the handler answers end to end", { skip }, async () => {
  const col = collection();
  const response = await handleSearch(new URL("https://x.test/api/search?q=dwarf+destroys+lands&k=3"), (q, options) =>
    search(col, q, options),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "semantic");
  assert.equal(body.hits.length, 3);
  assert.ok(body.hits[0].image.startsWith("https://cards.scryfall.io/"));
});

test("paging returns consecutive, non-overlapping pages", { skip }, async () => {
  const col = collection();
  const first = await search(col, "t:sphinx", { k: 10 });
  const second = await search(col, "t:sphinx", { k: 10, offset: 10 });
  assert.equal(first.hits.length, 10);
  assert.ok(first.hasMore && first.total !== null && first.total > 20);
  assert.equal(new Set([...names(first), ...names(second)]).size, 20);
  assert.deepEqual(names(await search(col, "t:sphinx", { k: 20 })), [...names(first), ...names(second)]);
  const last = await search(col, "t:sphinx", { k: 10, offset: first.total - 3 });
  assert.equal(last.hits.length, 3);
  assert.equal(last.hasMore, false);
});

test("results ranked by meaning are the same list however many are asked for", { skip }, async () => {
  const col = collection();
  // TopK's search by meaning is approximate: asked for ten it returns other cards than the
  // first ten of sixty. The search always asks to the full depth, so pages agree.
  for (const query of ["sphinx that draws two cards", "one mana artifact that taps for two colorless mana", "c:u t:sphinx draws when opponents draw"]) {
    const whole = names(await search(col, query, { k: 60 }));
    const [first, second, third] = [
      await search(col, query, { k: 10 }),
      await search(col, query, { k: 10, offset: 10 }),
      await search(col, query, { k: 5, offset: 20 }),
    ];
    assert.deepEqual([...names(first), ...names(second), ...names(third)], whole.slice(0, 25), query);
    assert.equal(new Set(whole).size, whole.length, query);
  }
  // what asking deeper finds: the card everyone means by this description, which ten did not hold
  assert.ok(names(await search(col, "one mana artifact that taps for two colorless mana", { k: 3 })).includes("Sol Ring"));
  // the last page stops at the limit and says there is no more
  const end = await search(col, "sphinx that draws two cards", { k: 60, offset: 60 });
  assert.equal(end.hits.length, 60);
  assert.equal(end.hasMore, false);
  assert.equal((await search(col, "sphinx that draws two cards", { k: 60 })).hasMore, true);
});

test("the page's sort order applies unless the query has its own", { skip }, async () => {
  const col = collection();
  const cost = (hit: Record<string, unknown>) => String(hit.mana_cost);
  const byName = await search(col, "t:sphinx", { k: 5 });
  assert.equal(byName.sortedBy, "name");
  assert.deepEqual(names(byName), [...names(byName)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  const expensive = await search(col, "t:sphinx", { k: 3, order: "cmc", descending: true });
  assert.equal(expensive.sortedBy, "cmc");
  const cheap = await search(col, "t:sphinx", { k: 3, order: "cmc" });
  assert.notDeepEqual(names(expensive), names(cheap));
  assert.ok(cost(expensive.hits[0]).length >= cost(cheap.hits[0]).length);
  // `order:` written in the query wins over the menu
  const explicit = await search(col, "t:sphinx order:name", { k: 5, order: "cmc", descending: true });
  assert.equal(explicit.sortedBy, "name");
  assert.deepEqual(names(explicit), names(byName));
  // a direction alone reverses the default order, from the page or from the query
  const reversed = await search(col, "t:sphinx", { k: 5, descending: true });
  assert.deepEqual(names(reversed), [...names(reversed)].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase())));
  assert.deepEqual(names(await search(col, "t:sphinx direction:desc", { k: 5 })), names(reversed));
  assert.deepEqual(names(await search(col, "t:sphinx direction:asc", { k: 5, descending: true })), names(byName));
  // plain-English results are ranked by meaning; the menu does not apply
  const ranked = await search(col, "sphinx that draws two cards", { k: 5, order: "cmc" });
  assert.equal(ranked.sortedBy, null);
  const page2 = await search(col, "sphinx that draws two cards", { k: 5, offset: 5 });
  assert.equal(new Set([...names(ranked), ...names(page2)]).size, 10);
});

test("printing keywords: one result per card, shown by a matching printing", { skip }, async () => {
  const cols = collection();
  const inSet = await search(cols, "t:sphinx set:ima");
  assert.deepEqual([inSet.mode, inSet.unit, inSet.total], ["syntax", "cards", 3]);
  assert.deepEqual(names(inSet), ["Consecrated Sphinx", "Sandstone Oracle", "Sphinx of Uthuun"]);
  assert.ok(inSet.hits.every((hit) => hit.set === "ima" && String(hit.scryfall_uri).includes("/ima/")));
  assert.deepEqual([inSet.hits[0].cn, inSet.hits[0].rarity, inSet.hits[0].artist], ["47", "mythic", "Mark Zug"]);
  // the same card found without a printing keyword shows Scryfall's pick for it, not this one
  const plain = await search(cols, '!"consecrated sphinx"');
  assert.equal(plain.total, 1);
  assert.notEqual(plain.hits[0].set, "ima");
});

test("unique:prints lists printings, newest first when ordered by release", { skip }, async () => {
  const cols = collection();
  const prints = await search(cols, '!"consecrated sphinx" unique:prints order:released', { k: 60 });
  assert.equal(prints.unit, "printings");
  assert.equal(prints.sortedBy, "released");
  assert.ok(prints.total !== null && prints.total >= 11 && prints.total === prints.hits.length);
  const dates = prints.hits.map((hit) => String(hit.released));
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(new Set(prints.hits.map((hit) => hit._id)).size, prints.hits.length);
  // each printing counts once; the card total is the number of distinct illustrations at most
  const art = await search(cols, '!"consecrated sphinx" unique:art', { k: 60 });
  assert.equal(art.unit, "illustrations");
  assert.ok(art.total !== null && art.total > 1 && art.total < prints.total);
});

test("sorting cards by price shows the printing that decides the order", { skip }, async () => {
  const cols = collection();
  const cheap = await search(cols, "t:sphinx r:mythic order:usd", { k: 60 });
  const dear = await search(cols, "t:sphinx r:mythic order:usd direction:desc", { k: 60 });
  const prices = (result: typeof cheap) => result.hits.map((hit) => hit.usd).filter((usd): usd is number => typeof usd === "number");
  assert.equal(cheap.total, dear.total);
  assert.deepEqual(prices(cheap), [...prices(cheap)].sort((a, b) => a - b));
  assert.deepEqual(prices(dear), [...prices(dear)].sort((a, b) => b - a));
  assert.ok(prices(dear)[0] > prices(cheap)[0]);
  // the page's menu can ask for the same thing on a card-level query
  const menu = await search(cols, "t:sphinx", { k: 5, order: "usd", descending: true });
  assert.equal(menu.sortedBy, "usd");
  assert.equal(menu.total, (await search(cols, "t:sphinx", { k: 1 })).total);
  assert.equal(menu.hits[0].usd, Math.max(...prices(menu)));
});

test("grouped results page without gaps or repeats", { skip }, async () => {
  const cols = collection();
  const all = await search(cols, "t:sphinx game:arena", { k: 60 });
  const first = await search(cols, "t:sphinx game:arena", { k: 10 });
  const second = await search(cols, "t:sphinx game:arena", { k: 10, offset: 10 });
  assert.ok(all.total !== null && all.total > 20 && first.hasMore);
  assert.deepEqual([...names(first), ...names(second)], names(all).slice(0, 20));
  assert.equal(new Set(names(all)).size, all.hits.length);
});

test("printing keywords mixed with plain words rank by meaning within the matching cards", { skip }, async () => {
  const result = await search(collection(), "set:ima draws when opponents draw");
  assert.equal(result.mode, "mixed");
  assert.equal(names(result)[0], "Consecrated Sphinx");
  assert.equal(result.hits[0].set, "ima");
  assert.equal(typeof result.hits[0].score, "number");
});

test("in: and prints are answered from the cards collection", { skip }, async () => {
  const cols = collection();
  const never = await search(cols, "t:sphinx -in:ima", { k: 1 });
  const all = await search(cols, "t:sphinx", { k: 1 });
  assert.equal(never.total, (all.total ?? 0) - 3);
  assert.equal((await search(cols, "t:sphinx prints=1", { k: 60 })).hits.every((hit) => hit.prints === 1), true);
});

test("a query that is exactly a card's name names that card, beside the list", { skip }, async () => {
  const cols = collection();
  const only = await search(cols, "consecrated sphinx", { k: 5 });
  assert.deepEqual([only.mode, only.total, only.exact?.name], ["name", 1, "Consecrated Sphinx"]);
  // other cards contain the words too: the exact one is still named, and can be opened
  const bolt = await search(cols, "Lightning Bolt", { k: 5 });
  assert.equal(bolt.exact?.name, "Lightning Bolt");
  assert.ok(bolt.total !== null && bolt.total >= 2);
  assert.ok(bolt.exact?.set && bolt.exact?.cn, "the exact card says which printing shows it");
  // case, accents and punctuation do not matter
  assert.equal((await search(cols, "urzas saga")).exact?.name, "Urza's Saga");
  assert.equal((await search(cols, "LIM-DUL'S VAULT")).exact?.name, "Lim-Dûl's Vault");
  // part of a name is not a name; nor is syntax, a negated word or an "or"
  assert.equal((await search(cols, "bolt")).exact, null);
  assert.equal((await search(cols, "lightning bol")).exact, null);
  assert.equal((await search(cols, "t:sphinx")).exact, null);
  assert.equal((await search(cols, "lightning -bolt")).exact, null);
  assert.equal((await search(cols, "opt or shock")).exact, null);
  // only on the first page, where the page decides whether to open it
  assert.equal((await search(cols, "lightning bolt", { k: 1, offset: 1 })).exact, null);
  // a description is not mistaken for a name
  assert.equal((await search(cols, "sphinx that draws two cards")).exact, null);
});

test("block: finds the sets of a block, named by any of them", { skip }, async () => {
  const cols = collection();
  const block = await search(cols, "block:zen", { k: 1 });
  assert.deepEqual([block.mode, block.unit, block.understood], ["syntax", "cards", ["the set is in the Zendikar block"]]);
  // any set of it, by code or by name, and the block's own name: the same cards
  for (const query of ["b:wwk", "b:roe", "block:worldwake", 'b:"rise of the eldrazi"', "block:zendikar"]) {
    assert.equal((await search(cols, query, { k: 1 })).total, block.total, query);
  }
  // more than its three sets hold between them: promos and tokens are in the block too
  const three = await search(cols, "e:zen or e:wwk or e:roe", { k: 1 });
  assert.ok((block.total ?? 0) > (three.total ?? 0) && (three.total ?? 0) > 500);
  // a set outside every block is itself, and so is the set of its promos
  const dominaria = await search(cols, "e:dom", { k: 1 });
  assert.equal((await search(cols, "b:dom", { k: 1 })).total, dominaria.total);
  assert.equal((await search(cols, "b:pdom", { k: 1 })).total, dominaria.total);
  // a block that does not exist finds nothing and is not refused
  const none = await search(cols, "b:nosuchblock", { k: 1 });
  assert.deepEqual([none.mode, none.total, none.ignored], ["syntax", 0, []]);
  // with other conditions
  const allies = await search(cols, "b:wwk t:ally r:rare", { k: 60 });
  assert.equal(allies.total, 9);
  assert.ok(["Kazuul Warlord", "Turntimber Ranger", "Talus Paladin"].every((name) => names(allies).includes(name)));
  assert.ok(allies.hits.every((hit) => /ally/i.test(String(hit.type_line))));
});

test("new: finds the printings that were the first of their card to have something", { skip }, async () => {
  const cols = collection();
  const total = async (query: string) => (await search(cols, query, { k: 1 })).total ?? 0;
  // every printing of a set either is the first with its art or is not
  const all = await total("e:m21 unique:prints");
  assert.equal((await total("new:art e:m21 unique:prints")) + (await total("-new:art e:m21 unique:prints")), all);
  assert.ok((await total("new:art e:m21 unique:prints")) > 100);
  // Lightning Bolt: one first printing in each frame, Alpha among them
  const frames = await search(cols, '!"lightning bolt" new:frame unique:prints order:released direction:asc', { k: 20 });
  assert.deepEqual([frames.mode, frames.unit, frames.hits[0].set], ["syntax", "printings", "lea"]);
  assert.ok((frames.total ?? 0) >= 5 && (frames.total ?? 0) <= 8);
  assert.deepEqual(frames.understood.slice(1, 2), ["it is the card's first printing in this frame"]);
  // a promo is never a card's first at a rarity
  assert.equal(await total("new:rarity st:promo"), 0);
  // what Scryfall has and we do not is left out with the reason
  const artist = await search(cols, "new:artist t:sphinx", { k: 1 });
  assert.deepEqual(artist.ignored.map((left) => left.term), ["new:artist"]);
});

test("a card is found by the other names its printings go by, and shown as that printing", { skip }, async () => {
  const cols = collection();
  // a flavour name, by one of its words: the Godzilla cards, each as its Godzilla printing
  const godzilla = await search(cols, "godzilla", { k: 20 });
  assert.deepEqual([godzilla.mode, godzilla.total], ["name", 8]);
  const zilortha = godzilla.hits.find((hit) => hit.name === "Zilortha, Strength Incarnate");
  assert.deepEqual([zilortha?.set, zilortha?.cn, zilortha?.printed_as], ["iko", "275", "Godzilla, King of the Monsters"]);
  assert.ok(godzilla.hits.every((hit) => String(hit.printed_as).includes("odzilla")), "every hit is a Godzilla printing");
  assert.ok(godzilla.hits.every((hit) => !("alt_prints" in hit)));
  // the whole flavour name opens the card, at that printing; so does the name without its comma
  for (const typed of ["Godzilla, King of the Monsters", "godzilla king of the monsters"]) {
    const found = await search(cols, typed);
    assert.deepEqual([found.exact?.name, found.exact?.set, found.exact?.cn], ["Zilortha, Strength Incarnate", "iko", "275"], typed);
  }
  // a name that is only printed on the card is found whole and not by its words, as on
  // Scryfall; typed in full it is still the card
  const rick = await search(cols, "Rick, Steadfast Leader");
  assert.deepEqual([rick.mode, rick.total, names(rick)], ["name", 1, ["Greymond, Avacyn's Stalwart"]]);
  assert.deepEqual([rick.exact?.name, rick.exact?.printed_as], ["Greymond, Avacyn's Stalwart", "Rick, Steadfast Leader"]);
  assert.equal((await search(cols, '!"Rick, Steadfast Leader"')).total, 1);
  assert.notEqual((await search(cols, "rick steadfast")).mode, "name");
  // found by its own name, a card is shown as usual
  const greaves = await search(cols, "lightning greaves");
  assert.equal(greaves.exact?.name, "Lightning Greaves");
  assert.equal(greaves.exact?.printed_as ?? null, null);
  // ...and by its flavour name, as the printing that carries it
  const sneakers = await search(cols, "power sneakers");
  assert.deepEqual([sneakers.exact?.name, sneakers.exact?.printed_as], ["Lightning Greaves", "Power Sneakers"]);
  // among printings, only the ones that carry the name
  const prints = await search(cols, '!"power sneakers" unique:prints');
  assert.deepEqual([prints.total, prints.hits[0].printed_as], [1, "Power Sneakers"]);
  // ruled out, a name keeps the card: its other printings are not called that
  const without = await search(cols, "-godzilla t:dinosaur c=rg mv=5 t:legendary", { k: 60 });
  assert.ok(names(without).includes("Zilortha, Strength Incarnate"));
  // the card page of such a printing says what it is printed as
  const page = await card(cols, "iko", "275");
  assert.deepEqual([page?.card.name, page?.card.printed_as], ["Zilortha, Strength Incarnate", "Godzilla, King of the Monsters"]);
});

test("a term that cannot be used is left out and the rest of the query runs", { skip }, async () => {
  const cols = collection();
  const plain = await search(cols, "t:sphinx", { k: 5 });
  // Scryfall syntax: the same results as without the term, and the term reported
  const partial = await search(cols, "lang:ja t:sphinx", { k: 5 });
  assert.deepEqual([partial.mode, partial.total], ["syntax", plain.total]);
  assert.deepEqual(names(partial), names(plain));
  assert.deepEqual(partial.ignored, [{ term: "lang:ja", reason: "'lang:' is not supported yet" }]);
  assert.deepEqual(partial.understood, ["the type includes “sphinx”"]);
  assert.deepEqual(plain.ignored, []);
  // a value that makes no sense is left out the same way
  const invalid = await search(cols, "t:sphinx c:purple", { k: 5 });
  assert.deepEqual([invalid.total, invalid.ignored.map((left) => left.term)], [plain.total, ["c:purple"]]);
  // a card name: still found by name
  const named = await search(cols, "new:art lightning bolt", { k: 3 });
  assert.equal(named.mode, "name");
  assert.equal(named.hits[0].name, "Lightning Bolt");
  assert.equal(named.ignored.length, 1);
  // plain English: only the words are ranked by meaning
  const described = await search(cols, "is:unicorn sphinx that draws two cards", { k: 3 });
  assert.equal(described.mode, "semantic");
  assert.equal(described.hits[0].name, "Consecrated Sphinx");
  assert.deepEqual(described.ignored.map((left) => left.term), ["is:unicorn"]);
  // nothing left to search for: refused, with every reason
  const nothing = await search(cols, "lang:ja new:art");
  assert.deepEqual([nothing.mode, nothing.hits.length], ["unsupported", 0]);
  assert.equal(nothing.note, "'lang:' is not supported yet; 'new:' is not supported yet");
});

test("the deepest page the endpoint offers is one TopK will serve", { skip }, async () => {
  const cols = collection();
  const ask = (params: Record<string, string>) =>
    handleSearch(new URL(`https://x.test/api/search?${new URLSearchParams(params)}`), (query, options) => search(cols, query, options));
  // cards, then printings: both collections have the same ceiling on limit plus offset
  for (const q of ["t:creature", "t:creature unique:prints"]) {
    const response = await ask({ q, k: String(MAX_RESULTS), offset: "999999" });
    assert.equal(response.status, 200, q);
    const body = await response.json();
    assert.deepEqual([body.offset, body.hits.length, body.has_more], [MAX_REACH - MAX_RESULTS, MAX_RESULTS, false], q);
    assert.ok(body.total > MAX_REACH, q);
  }
});

test("the page can ask for printings or illustrations; a unique: in the query wins", { skip }, async () => {
  const cols = collection();
  const cards = await search(cols, '!"consecrated sphinx"', { k: 60 });
  const prints = await search(cols, '!"consecrated sphinx"', { k: 60, unique: "prints" });
  const art = await search(cols, '!"consecrated sphinx"', { k: 60, unique: "art" });
  assert.deepEqual([cards.unit, cards.total], ["cards", 1]);
  assert.equal(prints.unit, "printings");
  assert.equal(art.unit, "illustrations");
  assert.ok(prints.total !== null && art.total !== null && prints.total >= 8 && art.total > 1 && art.total <= prints.total);
  // the same as writing it in the query
  const written = await search(cols, '!"consecrated sphinx" unique:prints', { k: 60 });
  assert.deepEqual(prints.hits.map((h) => h._id).sort(), written.hits.map((h) => h._id).sort());
  // ... which wins when the two disagree
  const both = await search(cols, '!"consecrated sphinx" unique:cards', { k: 60, unique: "prints" });
  assert.deepEqual([both.unit, both.total], ["cards", 1]);
  // a release-date sort with no direction is newest first
  const newest = await search(cols, '!"consecrated sphinx"', { k: 60, unique: "prints", order: "released" });
  const dates = newest.hits.map((h) => String(h.released));
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("a card's page: one printing with stats and legality, and its printings newest first", { skip }, async () => {
  const page = await card(collection(), "IMA", "47");
  assert.ok(page);
  assert.equal(page.card.name, "Consecrated Sphinx");
  assert.equal(page.card.stats, "4/6");
  assert.ok((page.card.legal as string[]).includes("commander") && !(page.card.legal as string[]).includes("standard"));
  assert.ok(page.printings.length >= 8 && page.printings.length < MAX_PRINTINGS);
  assert.ok(page.printings.some((p) => p.set === "ima" && p.cn === "47"), "the printing shown is in the list");
  const dates = page.printings.map((p) => String(p.released));
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.ok(page.printings.some((p) => typeof p.usd === "number"));
  // the same through the HTTP handler, as the page receives it
  const body = await (await handleCard(new URL("https://x.test/api/card?set=ima&cn=47"), (set, number) => card(collection(), set, number))).json();
  assert.deepEqual([body.card.name, body.card.stats, body.card.set], ["Consecrated Sphinx", "4/6", "ima"]);
  assert.equal(body.printings.length, page.printings.length);
});

test("the home page's cards are found by the example the search box shows", { skip }, async () => {
  const cols = collection();
  // a few of them: one for a colour, one for an effect, one for two colours
  for (const example of ["sphinx that draws two cards", "black creature removal", "izzet dragon"]) {
    assert.ok(EXAMPLES.includes(example));
    const page = await home(cols, Math.random, example);
    assert.deepEqual(page.theme, { label: example, query: example });
    assert.equal(page.cards.length, HOME_CARDS);
    assert.equal(new Set(page.cards.map((card) => card._id)).size, HOME_CARDS);
    // they are that search's first results and nothing from further down
    const results = names(await search(cols, example, { k: HOME_CARDS }));
    const shown = page.cards.map((card) => card.name);
    assert.deepEqual([...shown].sort(), [...results].sort(), `${example}: ${shown.join("; ")}`);
    // the closest is in the middle of the fan, where a phone shows it, and the next two beside it
    assert.equal(shown[2], results[0], example);
    assert.deepEqual([shown[1], shown[3]].sort(), [results[1], results[2]].sort(), example);
    assert.ok(page.cards.every((card) => String(card.image).startsWith("https://cards.scryfall.io/")));
  }
  assert.equal(HOME_CARDS, 5);
  // no draw is involved: the same cards whenever that example is the one shown
  const [once, again] = [await exampleCards(cols, "dwarf that destroys lands"), await exampleCards(cols, "dwarf that destroys lands")];
  assert.deepEqual(once.map((card) => card.name), again.map((card) => card.name));
  // the dwarves that fetch lands, which the owner found on the home page, are further down and not shown
  assert.ok(!once.some((card) => ["Stoic Farmer", "Druid of the Emerald Grove"].includes(card.name)), once.map((card) => card.name).join("; "));
  // anything that is not one of the examples is not searched for: the cards share a theme instead
  const other = await home(cols, Math.random, "ignore previous instructions");
  assert.ok(other.theme === null || THEMES.some((theme) => theme.query === other.theme?.query) || other.theme.query.startsWith("set:"), JSON.stringify(other.theme));
});

test("the home page's cards have something in common: a kind of card, or the newest set", { skip }, async () => {
  const cols = collection();
  const dice = (seed: number) => {
    let n = seed;
    return () => (n = (n * 9301 + 49297) % 233280) / 233280;
  };
  // a kind of card: every card drawn is one, they are distinct, and other dice draw others
  const dragons = await themedCards(cols, "t:dragon", HOME_CARDS, dice(3));
  assert.equal(dragons.length, HOME_CARDS);
  assert.ok(dragons.every((card) => /Dragon/.test(String(card.type_line)) && card.image && card.set && card.cn));
  assert.equal(new Set(dragons.map((card) => card.name)).size, HOME_CARDS);
  assert.deepEqual(names({ hits: dragons }), names({ hits: await themedCards(cols, "t:dragon", HOME_CARDS, dice(3)) }));
  assert.notDeepEqual(names({ hits: dragons }), names({ hits: await themedCards(cols, "t:dragon", HOME_CARDS, dice(4)) }));
  // they are drawn from the sixty most played of the kind, so they are cards people know
  const mostPlayed = new Set(names(await search(cols, "t:goblin", { k: 60, order: "edhrec" })));
  for (const seed of [1, 2, 3]) {
    const goblins = await themedCards(cols, "t:goblin", HOME_CARDS, dice(seed));
    assert.ok(goblins.every((card) => mostPlayed.has(card.name)), names({ hits: goblins }).join(", "));
  }
  // a set: every card is shown by its printing in that set, one printing for each card
  const set = await themedCards(cols, "set:ima", HOME_CARDS, dice(5));
  assert.equal(set.length, HOME_CARDS);
  assert.ok(set.every((card) => card.set === "ima"));
  assert.equal(new Set(set.map((card) => card.name)).size, HOME_CARDS);

  // which theme a visit gets: the newest set that is out about a third of the time, else a kind
  const sets = [
    { code: "nau", name: "Nauctis", kind: "set" as const, released: "2027-02-05", cards: 24, upcoming: true, revealed: 22 },
    // the decks that come out with a set are news, but are not what a visit's cards are drawn from
    { code: "trc", name: "Star Trek Commander", kind: "commander" as const, released: "2026-11-13", cards: 556, upcoming: false, revealed: null },
    { code: "trk", name: "Star Trek", kind: "set" as const, released: "2026-11-13", cards: 587, upcoming: false, revealed: null },
  ];
  assert.deepEqual(chooseTheme(sets, () => 0.1), { label: "Star Trek", query: "set:trk" });
  const kind = chooseTheme(sets, () => 0.5);
  assert.ok(THEMES.includes(kind));
  assert.ok(THEMES.includes(chooseTheme([], () => 0.1)), "with no set out, always a kind of card");
  // every kind on the list is a search that finds enough cards to fill the home page
  for (const theme of THEMES) {
    assert.equal((await themedCards(cols, theme.query, HOME_CARDS, dice(1))).length, HOME_CARDS, theme.label);
  }
  // the whole thing, as the endpoint serves it
  const page = await home(cols, dice(9));
  assert.equal(page.cards.length, HOME_CARDS);
  assert.ok(page.theme && page.theme.label && page.theme.query);
});

test("the home page's cards differ from draw to draw, and its sets are the newest", { skip }, async () => {
  const cols = collection();
  // fixed "dice" stand in for chance: the same dice draw the same cards, other dice others
  const dice = (seed: number) => {
    let n = seed;
    return () => (n = (n * 9301 + 49297) % 233280) / 233280;
  };
  const first = await randomCards(cols, HOME_CARDS, dice(7));
  const again = await randomCards(cols, HOME_CARDS, dice(7));
  const other = await randomCards(cols, HOME_CARDS, dice(8));
  assert.equal(first.length, HOME_CARDS);
  assert.ok(first.every((card) => card.name && card.image && card.set && card.cn));
  assert.equal(new Set(first.map((card) => card._id)).size, HOME_CARDS);
  assert.deepEqual(first.map((card) => card._id), again.map((card) => card._id));
  assert.notDeepEqual(first.map((card) => card._id), other.map((card) => card._id));

  // on a fixed day, so the test does not depend on when it runs
  const sets = await newestSets(cols, 4, new Date("2026-11-23T00:00:00Z"));
  assert.equal(sets.length, 4);
  assert.deepEqual(sets.map((set) => set.released), [...sets.map((set) => set.released)].sort().reverse());
  assert.ok(sets.every((set) => set.code && set.name && set.cards > 0));
  assert.deepEqual(sets.map((set) => set.upcoming), sets.map((set) => set.released > "2026-11-23"));
  // what came out beside a set is news too: on that day Star Trek, then its decks, then its sheet
  const wave = (await newestSets(cols, 12, new Date("2026-11-23T00:00:00Z"))).filter((set) => set.released === "2026-11-13");
  assert.deepEqual(wave.map((set) => [set.code, set.kind]), [["trk", "set"], ["trc", "commander"], ["sds", "bonus"]]);
  // decks and sheets are named once there is something of them to look at; a set from its first card
  const all = await newestSets(cols, 40, new Date("2026-11-23T00:00:00Z"));
  assert.ok(all.every((set) => set.kind === "set" || set.cards >= 10), all.filter((set) => set.kind !== "set").map((set) => `${set.code} ${set.cards}`).join(", "));
  assert.ok(all.every((set) => ["set", "commander", "bonus"].includes(set.kind)));
  // a set still to come says how many different cards have been shown, never more than its printings
  assert.ok(all.some((set) => set.upcoming));
  for (const set of all) {
    if (set.upcoming) assert.ok(set.revealed !== null && set.revealed >= 1 && set.revealed <= set.cards, `${set.code}: ${set.revealed} of ${set.cards}`);
    else assert.equal(set.revealed, null, set.code);
  }
  // a year and a half earlier, sets since released did not exist yet from that day's point of view
  const earlier = await newestSets(cols, 4, new Date("2025-06-01T00:00:00Z"));
  assert.ok(earlier.every((set) => set.released >= "2024-08-05"));
  assert.ok(earlier.filter((set) => set.released > "2025-06-01").every((set) => set.upcoming));
});

test("a random card is a real card with its printings, and differs from pick to pick", { skip }, async () => {
  const cols = collection();
  // fixed "dice" make the test repeatable: two different handfuls of cards
  const first = await randomCard(cols, () => 0.1);
  const second = await randomCard(cols, () => 0.7);
  assert.ok(first && second);
  assert.ok(first.card.name && first.card.set && first.card.cn && first.card.image);
  assert.ok(first.printings.length >= 1);
  assert.notEqual(first.card.name, second.card.name);
  assert.equal(first.card.name, (await randomCard(cols, () => 0.1))?.card.name);
});

test("a card with more printings than the page lists stops at the limit; a wrong address finds nothing", { skip }, async () => {
  const cols = collection();
  const [forest] = (await search(cols, "!forest", { k: 1 })).hits;
  const page = await card(cols, String(forest.set), String(forest.cn));
  assert.ok(page && page.card.name === "Forest");
  assert.equal(page.printings.length, MAX_PRINTINGS);
  assert.equal(page.card.stats ?? null, null);
  assert.equal(await card(cols, "nosuchset", "999"), null);
  // a planeswalker shows its loyalty
  const [jace] = (await search(cols, '!"jace, the mind sculptor"', { k: 1 })).hits;
  assert.equal((await card(cols, String(jace.set), String(jace.cn)))?.card.stats, "Loyalty 3");
});
