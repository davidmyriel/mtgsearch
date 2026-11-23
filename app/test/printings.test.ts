// Printing-level keywords, checked without a network: queries are compiled and evaluated
// against fixtures/printings.json, the documents the ingest job builds for a few hand-made
// printings (a Python test keeps that file in step with the document builder).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate } from "../evaluate.ts";
import type { Doc } from "../evaluate.ts";
import { blockOf, BLOCKS, lower, usesPrintings } from "../lower.ts";
import { parse, QueryError, Unsupported } from "../parser.ts";
import { asNamed, grouped } from "../search.ts";
import type { Collection, Hit } from "../search.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const printings: Doc[] = read("printings.json");
const cards: Doc[] = read("documents.json");

const compile = (query: string) => lower(parse(query));
/** Ids of the printings a query matches, sorted. */
const ids = (query: string) => {
  const [predicate] = compile(query);
  return printings.filter((doc) => evaluate(predicate, doc)).map((doc) => doc._id as string).sort();
};
const names = (query: string) => {
  const [predicate] = compile(query);
  return cards.filter((doc) => evaluate(predicate, doc)).map((doc) => doc.name as string).sort();
};

test("set and rarity", () => {
  for (const query of ["set:ima", "s:ima", "e:IMA", "edition:ima"]) assert.deepEqual(ids(query), ["ima-47"], query);
  assert.deepEqual(ids("r:mythic"), ["ima-47", "nph-30", "soi-5"]);
  assert.deepEqual(ids("r:m"), ids("rarity:mythic"));
  assert.deepEqual(ids("r>=rare"), ["ima-47", "nph-30", "pima-47s", "sld-1011", "soi-5"]);
  assert.deepEqual(ids("r<uncommon"), ["10e-268", "anb-13", "m19-314"]);
  assert.deepEqual(ids("r!=common t:elf"), []);
  assert.deepEqual(ids("st:expansion r:rare"), ["pima-47s", "sld-1011"]);
  assert.throws(() => compile("r:legendary"), (e) => e instanceof QueryError && !(e instanceof Unsupported));
  assert.throws(() => compile("set>ima"), QueryError);
});

test("collector numbers match exactly as text and compare as numbers", () => {
  assert.deepEqual(ids("cn:47"), ["ima-47"]); // not 47s
  assert.deepEqual(ids("cn:47S"), ["pima-47s"]);
  assert.deepEqual(ids("number>=263"), ["10e-268", "c21-263", "lea-270", "m19-314", "sld-1011"]);
  assert.deepEqual(ids("cn<20"), ["anb-13", "soi-5"]);
});

test("artist, flavour text and watermark", () => {
  assert.deepEqual(ids("a:zug"), ["ima-47", "nph-30", "pima-47s"]);
  assert.deepEqual(ids('artist:"mike bierek"'), ["c21-263", "sld-1011"]);
  assert.deepEqual(ids("ft:jin-gitaxias"), ["nph-30"]);
  assert.deepEqual(ids("flavor:/golden helix/"), ["soi-5"]); // on a face of a double-faced card
  assert.deepEqual(ids("wm:phyrexian"), ["nph-30"]);
  assert.throws(() => compile("a:/zug/"), QueryError);
});

test("a negated test keeps printings that lack the field", () => {
  assert.deepEqual(ids("-ft:blessed t:sphinx"), ["ima-47", "pima-47s"]); // neither has flavour text
  assert.deepEqual(ids("-stamp:oval t:sphinx"), ["nph-30", "pima-47s"]);
  assert.deepEqual(ids("-usd>40 t:sphinx"), ["ima-47"]);
  assert.deepEqual(ids("-wm:phyrexian t:sphinx"), ["ima-47", "pima-47s"]);
});

test("frame, border, stamp and game", () => {
  assert.deepEqual(ids("frame:2003"), ["10e-268", "nph-30"]);
  assert.deepEqual(ids("frame:extendedart"), ["sld-1011"]);
  assert.deepEqual(ids("frame:sunmoondfc"), ["soi-5"]);
  assert.deepEqual(ids("border:borderless"), ["sld-1011"]);
  assert.deepEqual(ids("border:white"), ["10e-268"]);
  assert.deepEqual(ids("stamp:oval"), ["ima-47"]);
  assert.deepEqual(ids("game:arena"), ["anb-13", "m19-314"]);
  assert.deepEqual(ids("-game:paper"), ["anb-13"]);
});

test("dates: a year, a day, or a set's release date", () => {
  assert.deepEqual(ids("year=2017"), ["ima-47", "pima-47s"]);
  assert.deepEqual(ids("year<2000"), ["lea-270"]);
  assert.deepEqual(ids("date>=2020-01-01"), ["anb-13", "c21-263", "sld-1011"]);
  assert.deepEqual(ids("date:2017-11-17"), ["ima-47"]);
  assert.deepEqual(ids("date>=2021"), ["c21-263", "sld-1011"]);
  // Iconic Masters was released on 2017-11-17 (app/sets.json)
  assert.deepEqual(compile("date>ima")[0], ["and", [["cmp", "date", ">", 20171117], ["eq", "extra", false]]]);
  assert.deepEqual(ids("date>ima t:sphinx"), ["pima-47s"]);
  assert.throws(() => compile("date>tomorrow"), (e) => e instanceof QueryError && !(e instanceof Unsupported));
});

test("prices compare exactly, in cents, and a printing without a price never matches", () => {
  assert.deepEqual(ids("usd>=40"), ["lea-270", "nph-30", "pima-47s"]);
  assert.deepEqual(ids("usd=34.97"), ["ima-47"]);
  assert.deepEqual(ids("usd<1"), ["m19-314"]);
  assert.deepEqual(ids("eur>30"), ["nph-30"]);
  assert.deepEqual(ids("tix<0.1"), ["m19-314"]);
  assert.deepEqual(compile("usd>=0.5")[0], ["and", [["cmp", "usd_c", ">=", 50], ["eq", "extra", false]]]);
  // a foil-only printing is priced by its foil
  assert.deepEqual(ids("usd=55 is:promo"), ["pima-47s"]);
  assert.throws(() => compile("usd>cheap"), QueryError);
});

test("is: and not: for printings", () => {
  assert.deepEqual(ids("is:etched"), ["sld-1011"]);
  assert.deepEqual(ids("is:promo"), ["pima-47s"]);
  assert.deepEqual(ids("is:digital"), ["anb-13"]);
  assert.deepEqual(ids("not:reprint"), ["10e-268", "lea-270", "nph-30", "soi-5"]);
  assert.deepEqual(ids("is:nonfoil -is:foil"), ["anb-13", "lea-270"]);
  assert.deepEqual(ids("is:prerelease"), ["pima-47s"]);
  for (const query of ["is:fullart", "is:full", "is:ub", "is:universesbeyond", "is:extended", "is:borderless"]) {
    assert.deepEqual(ids(query), ["sld-1011"], query);
  }
  assert.deepEqual(ids("is:old"), ["lea-270"]);
  assert.deepEqual(ids("is:new t:sphinx"), ["ima-47", "pima-47s"]);
  // card-level flags still work on printings, and unknown ones are still refused
  assert.deepEqual(ids("is:transform"), ["soi-5"]);
  assert.throws(() => compile("is:unicorn"), Unsupported);
});

test("in:, prints and sets are facts about the card, true on every printing and on the card", () => {
  assert.deepEqual(names("in:ima"), ["Consecrated Sphinx"]);
  assert.deepEqual(names("in:arena"), ["Llanowar Elves"]);
  // Sol Ring's only rare printing is a Secret Lair drop, which does not count
  assert.deepEqual(names("in:rare"), ["Consecrated Sphinx"]);
  assert.deepEqual(names("in:uncommon"), ["Sol Ring"]);
  assert.deepEqual(names("in:mtgo -in:arena"), ["Archangel Avacyn // Avacyn, the Purifier", "Consecrated Sphinx", "Grizzly Bears", "Sol Ring"]);
  assert.deepEqual(names("prints>=3"), ["Consecrated Sphinx", "Grizzly Bears", "Sol Ring"]);
  assert.deepEqual(names("sets=1"), ["Archangel Avacyn // Avacyn, the Purifier"]);
  assert.deepEqual(ids("in:lea"), ["c21-263", "lea-270", "sld-1011"]);
  for (const query of ["in:ima", "prints>=3", "-in:paper"]) assert.equal(compile(query)[1].printings, false, query);
  assert.throws(() => compile("in:japanese"), Unsupported);
  assert.throws(() => compile("in>ima"), QueryError);
});

test("which collection a query needs", () => {
  for (const query of ["t:sphinx", "c:u mv>=6 order:cmc", "in:ima f:modern", "unique:cards t:elf"]) {
    assert.equal(compile(query)[1].printings, false, query);
  }
  for (const query of ["set:ima", "t:sphinx -r:common", "t:elf unique:prints", "t:elf unique:art", "t:elf order:usd", "t:elf order:released", "t:elf prefer:oldest", "(t:elf or a:zug)"]) {
    assert.equal(compile(query)[1].printings, true, query);
  }
  assert.equal(usesPrintings(["and", [["has", "type_lc", "elf"], ["not", ["eq", "set", "ima"]]]]), true);
  assert.equal(usesPrintings(["in", "in_sets", "ima"]), false);
});

test("unique, prefer, order and direction", () => {
  const options = (query: string) => compile(query)[1];
  assert.equal(options("t:elf unique:prints").unique, "prints");
  assert.equal(options("t:elf unique:art").unique, "art");
  assert.equal(options("t:elf").unique, "cards");
  assert.equal(options("t:elf prefer:oldest").prefer, "oldest");
  assert.deepEqual([options("order:usd").order, options("order:usd").descending], ["usd_c", false]);
  // newest first unless a direction is given; everything else ascends
  assert.deepEqual([options("order:released").order, options("order:released").descending], ["date", true]);
  assert.equal(options("order:released direction:asc").descending, false);
  assert.equal(options("order:name dir:desc").descending, true);
  assert.equal(options("order:rarity direction:auto").descending, false);
  assert.throws(() => compile("unique:names"), (e) => e instanceof QueryError && !(e instanceof Unsupported));
  assert.throws(() => compile("direction:sideways"), QueryError);
  assert.throws(() => compile("prefer:promo"), Unsupported);
  assert.throws(() => compile("order:artist"), Unsupported);
});

test("naming a set, an artist or a watermark also searches the hidden extras", () => {
  assert.deepEqual(ids("set:tm19"), ["tm19-8"]); // a token
  assert.deepEqual(ids("a:kopinski"), ["tm19-8"]);
  assert.deepEqual(ids("r:common t:goblin"), []); // the token stays hidden
  assert.equal(compile("-set:ima t:goblin")[1].includeExtras, false); // excluding a set reveals nothing
  assert.deepEqual(ids("-set:ima t:goblin"), []);
  assert.deepEqual(ids("r:common t:goblin include:extras"), ["tm19-8"]);
});

/** A collection that answers every query with the same rows, as the group-by would. */
const answering = (rows: Record<string, unknown>[]): Collection => ({
  query: async () => rows as Hit[],
  count: async () => rows.length,
});

test("grouping: cards in order, each with the printing that shows it", async () => {
  const rows = [
    { oracle_id: "b", name_lc: "sol ring", rank: 0, key: 1 },
    { oracle_id: "a", name_lc: "consecrated sphinx", rank: 2, key: 6 },
    { oracle_id: "c", name_lc: "black lotus", rank: 1, key: null },
  ];
  const by = (sortField: string, descending = false, prefer: string | null = null) =>
    grouped(answering(rows), ["all"], { unique: "cards", prefer, sortField, descending });
  assert.deepEqual((await by("name_lc")).map((g) => [g.oracle_id, g.rank]), [["c", 1], ["a", 2], ["b", 0]]);
  assert.deepEqual((await by("name_lc", true)).map((g) => g.oracle_id), ["b", "a", "c"]);
  // cards lacking the sort value go last in both directions
  assert.deepEqual((await by("cmc")).map((g) => g.oracle_id), ["b", "a", "c"]);
  assert.deepEqual((await by("cmc", true)).map((g) => g.oracle_id), ["a", "b", "c"]);
});

test("grouping: a packed value names both the sort key and the printing that holds it", async () => {
  const SLOTS = 4096;
  // sorting by price, ascending: the cheapest printing of each card, pref_rank in the low bits
  const cheapest = [
    { oracle_id: "a", name_lc: "a", rank: 0, choice: 3497 * SLOTS + 4 },
    { oracle_id: "b", name_lc: "b", rank: 0, choice: 25 * SLOTS + 1 },
    { oracle_id: "c", name_lc: "c", rank: 3, choice: null }, // no printing has a price
  ];
  const asc = await grouped(answering(cheapest), ["all"], { unique: "cards", prefer: null, sortField: "usd_c", descending: false });
  assert.deepEqual(asc.map((g) => [g.oracle_id, g.key, g.rank]), [["b", 25, 1], ["a", 3497, 4], ["c", null, 3]]);
  // descending: the dearest printing; the low bits hold SLOTS - 1 - pref_rank so the best rank wins ties
  const dearest = [
    { oracle_id: "a", name_lc: "a", rank: 0, choice: 49999 * SLOTS + (SLOTS - 1 - 7) },
    { oracle_id: "b", name_lc: "b", rank: 0, choice: 129 * SLOTS + (SLOTS - 1 - 0) },
  ];
  const desc = await grouped(answering(dearest), ["all"], { unique: "cards", prefer: null, sortField: "usd_c", descending: true });
  assert.deepEqual(desc.map((g) => [g.oracle_id, g.key, g.rank]), [["a", 49999, 7], ["b", 129, 0]]);
  // prefer:oldest with a card-level sort: the choice picks the printing, the key sorts
  const oldest = [{ oracle_id: "a", name_lc: "a", rank: 0, key: 6, choice: 20110513 * SLOTS + 5 }];
  const preferred = await grouped(answering(oldest), ["all"], { unique: "cards", prefer: "oldest", sortField: "cmc", descending: false });
  assert.deepEqual(preferred.map((g) => [g.key, g.rank]), [[6, 5]]);
});

test("grouping: a card whose printings have different names is one result", async () => {
  // A reversible printing is named "X // X"; the group-by returns one row per (card, name).
  const rows = [
    { oracle_id: "a", name_lc: "captain howler // captain howler", rank: 3 },
    { oracle_id: "a", name_lc: "captain howler", rank: 0 },
    { oracle_id: "b", name_lc: "sol ring", rank: 1 },
  ];
  const groups = await grouped(answering(rows), ["all"], { unique: "cards", prefer: null, sortField: "name_lc", descending: false });
  assert.deepEqual(groups.map((g) => [g.oracle_id, g.name_lc, g.rank]), [["a", "captain howler", 0], ["b", "sol ring", 1]]);
  // when a printing field decides, the row with the winning value is kept
  const SLOTS = 4096;
  const priced = [
    { oracle_id: "a", name_lc: "x // x", rank: 3, choice: 500 * SLOTS + 3 },
    { oracle_id: "a", name_lc: "x", rank: 0, choice: 900 * SLOTS + 0 },
    { oracle_id: "a", name_lc: "x (no price)", rank: 1, choice: null },
  ];
  const cheapest = await grouped(answering(priced), ["all"], { unique: "cards", prefer: null, sortField: "usd_c", descending: false });
  assert.deepEqual(cheapest.map((g) => [g.key, g.rank]), [[500, 3]]);
});

test("block: is the sets of a block, named by any of them; a set outside every block is itself", () => {
  // the core sets are one block; the fixtures hold three of them
  const core = ["10e-268", "lea-270", "m19-314"];
  for (const query of ["block:lea", "b:m19", "b:10E", "b=lea", 'b:"core set 2019"', 'block:"Limited Edition Alpha"', 'b:"core set"', "b:tm19"]) {
    assert.deepEqual(ids(query), core, query);
  }
  assert.deepEqual(ids("b:nph"), ["nph-30"]); // New Phyrexia, by its code
  assert.deepEqual(ids("b:som"), ["nph-30"]); // by another set of its block
  assert.deepEqual(ids('b:"scars of mirrodin"'), ["nph-30"]); // by that set's name, which is the block's too
  assert.deepEqual(ids("b:soi"), ["soi-5"]);
  assert.deepEqual(ids("b:cmd"), ["c21-263"]); // Commander 2021 is in the Commander block
  assert.deepEqual(ids("b:ftv"), []); // a block whose code is no set's: known, and none of its sets is here
  // Iconic Masters belongs to no block: it stands for itself
  assert.deepEqual(ids("b:ima"), ["ima-47"]);
  assert.deepEqual(ids('b:"iconic masters"'), ["ima-47"]);
  // a block nobody knows finds nothing, and is not an error
  assert.deepEqual(ids("b:nosuchblock"), []);
  assert.deepEqual(ids("-b:lea t:artifact"), ["c21-263", "sld-1011"]);
  // it is about printings, and lists a block's tokens as naming a set does
  assert.deepEqual(compile("b:zen")[1], { ...compile("b:zen")[1], printings: true, includeExtras: true });
  const sets = (compile("b:wwk")[0] as [string, string, string[]])[2];
  assert.ok(["zen", "wwk", "roe", "tzen"].every((code) => sets.includes(code)), "the Zendikar block and its tokens");
  assert.throws(() => compile("b>zen"), QueryError);
  assert.throws(() => compile("b:/zen/"), QueryError);
});

test("new: is the printing that was the first of its card to have an art, a flavour text, a frame or a rarity", () => {
  // Consecrated Sphinx: New Phyrexia first, then Iconic Masters (a new frame), then a rare printing
  assert.deepEqual(ids("new:art t:sphinx"), ["nph-30"]);
  assert.deepEqual(ids("new:flavor t:sphinx"), ["nph-30"]);
  assert.deepEqual(ids("new:frame t:sphinx"), ["ima-47", "nph-30"]);
  assert.deepEqual(ids("new:rarity t:sphinx"), ["nph-30", "pima-47s"]);
  assert.deepEqual(ids("-new:frame t:sphinx"), ["pima-47s"]);
  assert.deepEqual(ids("NEW:Rarity t:artifact"), ["lea-270", "sld-1011"]); // a Secret Lair's rarity counts
  assert.deepEqual(ids("new=flavor t:artifact"), ["c21-263"]);
  assert.equal(compile("new:art")[1].printings, true);
  // two that Scryfall has are refused with the reason; anything else is a mistake
  for (const query of ["new:artist", "new:language"]) assert.throws(() => compile(query), Unsupported, query);
  assert.throws(() => compile("new:shiny"), (e) => e instanceof QueryError && !(e instanceof Unsupported));
  assert.throws(() => compile("new>art"), QueryError);
});

test("the catalogue of blocks is consistent", () => {
  for (const [code, block] of Object.entries(BLOCKS.blocks)) {
    assert.ok(block.name && block.sets.length, code);
    for (const set of block.sets) assert.equal(BLOCKS.sets[set], code, `${set} stands for ${code}`);
  }
  for (const [name, code] of Object.entries(BLOCKS.names)) assert.ok(Object.hasOwn(BLOCKS.sets, code), name);
  assert.equal(blockOf("Worldwake"), "zen");
  assert.equal(blockOf("pdom"), "dom");
  assert.equal(blockOf("Ravnica"), "rav"); // a block's name that is not a set's
});

// In the fixtures one Grizzly Bears printing has the flavour name "Ursa, the Twin Maw" and
// another is printed as "Bob's Hungry Bear".
test("a flavour name finds the card by its words; a name only printed on it, when given whole", () => {
  for (const query of ["ursa", "twin maw", '"the twin maw"', "name:ursa", "ursa bears"]) {
    assert.deepEqual(names(query), ["Grizzly Bears"], query);
  }
  assert.deepEqual(names("hungry"), []); // a word of a printed name
  assert.deepEqual(names("name:/ursa/"), []); // a regular expression reads the card's own name
  const whole = ['!"Bob\'s Hungry Bear"', '!"bobs hungry bear"', '!"Ursa, the Twin Maw"', '!"ursa the twin maw"', '!"Grizzly Bears"'];
  for (const query of whole) assert.deepEqual(names(query), ["Grizzly Bears"], query);
  assert.deepEqual(names('!"hungry bear"'), []); // part of a name is not the name
  // ruling a name out keeps the card: it has printings that are not called that
  assert.deepEqual(names("-ursa t:bear"), ["Grizzly Bears"]);
  assert.deepEqual(names('-!"ursa the twin maw" t:bear'), ["Grizzly Bears"]);
  assert.deepEqual(names("-grizzly t:bear"), []);
  assert.deepEqual(names("-(-ursa) t:bear"), ["Grizzly Bears"]); // ruled out twice is asked for
  for (const query of ["ursa", '!"bobs hungry bear"', "-ursa"]) assert.equal(compile(query)[1].printings, false, query);
});

test("an exact name may leave out its punctuation", () => {
  assert.deepEqual(names('!"jace the mind sculptor"'), ["Jace, the Mind Sculptor"]);
  assert.deepEqual(names('!"Jace, the Mind Sculptor"'), ["Jace, the Mind Sculptor"]);
  assert.deepEqual(names('!"archangel avacyn"'), ["Archangel Avacyn // Avacyn, the Purifier"]); // one face
  assert.deepEqual(names('!"jace the mind"'), []);
});

test("among printings, each answers for its own names only", () => {
  assert.deepEqual(ids("ursa"), ["sld-88"]);
  assert.deepEqual(ids("ursa unique:prints"), ["sld-88"]);
  assert.deepEqual(ids('!"bobs hungry bear"'), ["sld-89"]);
  // ruled out, a name drops the printings that carry it and keeps the card's others
  assert.deepEqual(ids("-ursa t:bear"), ["10e-268", "sld-89"]);
  assert.deepEqual(ids('-!"bobs hungry bear" t:bear'), ["10e-268", "sld-88"]);
  assert.deepEqual(ids('!"grizzly bears"'), ["10e-268", "sld-88", "sld-89"]);
});

test("a card found by a name one printing carries is shown as that printing", async () => {
  const bears = cards.find((doc) => doc.name === "Grizzly Bears") as Hit;
  const ring = cards.find((doc) => doc.name === "Sol Ring") as Hit;
  const named = printings.filter((doc) => doc._id === "sld-88" || doc._id === "sld-89");
  const shown = async (query: string, col = answering(named)) => (await asNamed(col, [ring, bears], parse(query)))[1];
  const unasked: Collection = { query: async () => assert.fail("no printing is needed"), count: async () => 0 };

  assert.deepEqual([(await shown("ursa")).cn, (await shown("ursa")).printed_as], ["88", "Ursa, the Twin Maw"]);
  assert.deepEqual([(await shown('!"bobs hungry bear"')).cn, (await shown('!"bobs hungry bear"')).printed_as], ["89", "Bob's Hungry Bear"]);
  assert.equal((await shown("ursa or ring")).cn, "88");
  assert.equal((await shown("ursa bears")).cn, "88"); // one word from each name
  // found by its own name, or not by name at all: the card as it is, and nothing is asked
  for (const query of ["grizzly", "t:bear", "-ursa", "bears -maw"]) {
    const kept = await shown(query, unasked);
    assert.deepEqual([kept.name, kept.cn, "alt_prints" in kept], ["Grizzly Bears", undefined, false], query);
  }
  // the printing is gone from the index: the card as it is
  assert.equal((await shown("ursa", answering([]))).name, "Grizzly Bears");
});
