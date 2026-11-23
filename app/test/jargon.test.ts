// Players' words for kinds of card, read as Scryfall syntax. No network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { jargon, JARGON_WORDS } from "../jargon.ts";
import { lower } from "../lower.ts";
import { parse } from "../parser.ts";

const reads = (query: string) => jargon(query)?.reads ?? null;

test("a players' word is read as the community's tag for it", () => {
  assert.deepEqual(jargon("mana rocks"), { term: "mana rock", reads: "otag:mana-rock" });
  assert.equal(reads("Board  Wipes"), "otag:sweeper");
  assert.equal(reads("wrath"), "otag:sweeper");
  assert.equal(reads("blink"), "otag:flicker");
  assert.equal(reads("flicker"), "otag:flicker");
  assert.equal(reads("counterspells"), "otag:counterspell");
  // some tags hold more than players mean by the word, and are narrowed
  assert.equal(reads("tutors"), "otag:tutor -otag:ramp -t:land");
  assert.equal(reads("removal"), "otag:removal -otag:sweeper");
  assert.equal(reads("bounce"), "otag:bounce -t:land");
});

test("a kind of card after the word, a colour before it, and words that ask for nothing", () => {
  assert.equal(reads("bounce spells"), "otag:bounce -t:land (t:instant or t:sorcery)");
  assert.equal(reads("blink effects"), "otag:flicker");
  assert.equal(reads("blink creatures"), "otag:flicker t:creature");
  assert.equal(reads("removal sorceries"), "otag:removal -otag:sweeper t:sorcery");
  // cards of exactly that colour; two colours said either way are one condition
  assert.equal(reads("white board wipes"), "otag:sweeper c=w");
  assert.equal(reads("izzet counterspells"), "otag:counterspell c=ur");
  assert.equal(reads("red and white board wipes"), "otag:sweeper c=wr");
  assert.equal(reads("blue black removal"), "otag:removal -otag:sweeper c=ub");
  assert.equal(reads("colorless mana rocks"), "otag:mana-rock c=colorless");
  assert.equal(reads("the best mana rocks"), "otag:mana-rock");
  assert.equal(reads("black creature removal"), "otag:removal-creature -otag:sweeper c=b");
});

test("anything else is not a players' word", () => {
  const others = [
    "sphinx that draws two cards",
    "mana rocks that draw cards", // the word inside a sentence: left to its meaning
    "blue land destruction", // left to its meaning on purpose
    "board",
    "white", // a colour on its own
    "rocks",
    "consecrated sphinx",
    "",
  ];
  for (const query of others) assert.equal(jargon(query), null, query);
});

test("every reading is Scryfall syntax this search can run", () => {
  assert.ok(JARGON_WORDS.length >= 50);
  for (const word of JARGON_WORDS) {
    const reading = jargon(word);
    assert.ok(reading, word);
    assert.doesNotThrow(() => lower(parse(reading.reads)), word);
    // with a colour and a kind as well
    const narrowed = jargon("golgari " + word + " spells");
    assert.ok(narrowed, word);
    assert.doesNotThrow(() => lower(parse(narrowed.reads)), word);
  }
});
