// End-to-end against the live TopK collection. Skipped unless TOPK_API_KEY is set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "topk-js";
import { handleCard, handleSearch, MAX_REACH, MAX_RESULTS } from "../api.ts";
import { card, MAX_PRINTINGS, randomCard } from "../card.ts";
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
