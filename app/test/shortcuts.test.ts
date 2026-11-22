// `is:` shortcuts for well-known groups of cards, checked without a network. The land cycles
// that rest on community tags are compared with Scryfall in conformance/shortcuts.txt; here
// the rules are run against small hand-written documents.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../evaluate.ts";
import type { Doc } from "../evaluate.ts";
import { lower } from "../lower.ts";
import { parse, Unsupported } from "../parser.ts";
import { SHORTCUT_NAMES } from "../shortcuts.ts";

const compile = (query: string) => lower(parse(query));
const visible = ["eq", "extra", false];
/** Whether a document with these fields matches the query. */
const matches = (query: string, fields: Doc) => evaluate(compile(query)[0], { extra: false, ...fields });
const land = (text: string): Doc => ({ type_words: ["land"], oracle_tilde_lc: text });

test("most land cycles are a community tag the documents already carry", () => {
  assert.deepEqual(compile("is:fetchland")[0], ["and", [["in", "otags", "cycle-fetchland"], visible]]);
  assert.deepEqual(compile("not:shockland")[0], ["and", [["not", ["in", "otags", "cycle-shockland"]], visible]]);
  assert.ok(matches("is:gainland", { otags: ["cycle-zen-refugeland"] }));
  assert.ok(matches("is:gainland", { otags: ["cycle-gainland", "lifegain"] }));
  assert.ok(!matches("is:gainland", { otags: ["lifegain"] }) && !matches("is:gainland", {}));
});

test("a cycle's other names mean the same thing", () => {
  const same: [string, string][] = [
    ["karoo", "bounceland"], ["cycleland", "bikeland"], ["bicycleland", "bikeland"], ["canland", "canopyland"],
    ["horizonland", "canopyland"], ["snarl", "shadowland"], ["manland", "creatureland"], ["battleland", "tangoland"],
  ];
  for (const [alias, name] of same) assert.deepEqual(compile(`is:${alias}`)[0], compile(`is:${name}`)[0], alias);
});

test("every shortcut compiles, needs only the cards unless it is about a printing, and unknown words are refused", () => {
  const aboutPrintings = new Set(["masterpiece", "colorshifted", "tombstone", "firstprint"]);
  for (const name of SHORTCUT_NAMES) {
    assert.equal(compile(`is:${name}`)[1].printings, aboutPrintings.has(name), name);
  }
  assert.throws(() => compile("is:unicorn"), Unsupported);
});

test("lands that turn themselves into creatures", () => {
  assert.ok(matches("is:creatureland", land("{1}: ~ becomes a 2/2 creature with all creature types until end of turn. it's still a land.")));
  // a quoted ability with its own full stop sits between "creature" and "still a land"
  assert.ok(matches("is:manland", land('{2}{r}{g}: until end of turn, ~ becomes a 3/3 red and green elemental creature with "whenever ~ attacks, put a +1/+1 counter on it." it\'s still a land.')));
  assert.ok(matches("is:creatureland", land("{6}: ~ becomes a 3/3 elemental artifact creature that's still a land.")));
  assert.ok(matches("is:creatureland", land("{5}: if ~ isn't a creature, it becomes a 2/4 wizard creature with flying. it's still a land.")));
  // becoming a copy, or animating some other land, does not count; nor does a non-land
  assert.ok(!matches("is:creatureland", land("{2}{g}{g}: ~ becomes a copy of target permanent card in your graveyard until end of turn.")));
  assert.ok(!matches("is:creatureland", land("{t}: target land becomes a 3/3 creature until end of turn. it's still a land.")));
  assert.ok(!matches("is:creatureland", { type_words: ["artifact"], oracle_tilde_lc: "{1}: ~ becomes a 2/2 creature. it's still a land." }));
});

test("filter lands and storage lands", () => {
  assert.ok(matches("is:filterland", land("{1}, {t}: add {u}{b}.")));
  assert.ok(matches("is:filterland", land("{t}: add {c}.\n{w/u}, {t}: add {w}{w}, {w}{u}, or {u}{u}.")));
  assert.ok(matches("is:filterland", land("{5}, {t}: add five mana in any combination of colors.")));
  assert.ok(!matches("is:filterland", land("{1}, {t}: add one mana of any color.")));
  assert.ok(!matches("is:filterland", land("{1}, {t}: add {c}{c}.")));
  assert.ok(matches("is:storageland", land("at the beginning of your upkeep, if ~ is tapped, put a storage counter on it.")));
  assert.ok(matches("is:storageland", land("{1}, {t}: put a storage counter on ~.")));
  assert.ok(!matches("is:storageland", land("{t}: put a storage counter on ~."))); // the Mercadian Masques lands are not in the group
});

test("party and outlaw are creature types, which a changeling has all of", () => {
  assert.ok(matches("is:party", { type_words: ["creature", "minotaur", "wizard"] }));
  assert.ok(matches("is:party", { type_words: ["creature", "shapeshifter"], keywords_lc: ["changeling"] }));
  assert.ok(!matches("is:party", { type_words: ["creature", "elf", "druid"] }));
  assert.ok(matches("is:outlaw", { type_words: ["creature", "human", "pirate"] }));
  assert.ok(matches("is:outlaw", { type_words: ["creature", "human", "rogue"] }) && matches("is:party", { type_words: ["creature", "human", "rogue"] }));
  assert.ok(!matches("is:outlaw", { type_words: ["creature", "human", "wizard"] }));
});

test("partner means a legendary partner or a Background", () => {
  assert.ok(matches("is:partner", { flags: ["commander"], keywords_lc: ["partner"] }));
  assert.ok(matches("is:partner", { flags: ["commander"], keywords_lc: ["choose a background"] }));
  assert.ok(matches("is:partner", { type_words: ["background", "enchantment", "legendary"] }));
  // "partner with" on a creature that cannot be a commander
  assert.ok(!matches("is:partner", { flags: ["permanent"], keywords_lc: ["partner with"] }));
});

test("modal cards list their modes with bullets, or as Spree costs", () => {
  assert.ok(matches("is:modal", { fulloracle_lc: "choose one —\n• draw a card.\n• you gain 3 life." }));
  assert.ok(matches("is:modal", { fulloracle_lc: "choose three. you may choose the same mode more than once.\n• ~ deals 2 damage." }));
  assert.ok(matches("is:modal", { fulloracle_lc: "spree\n+ {2} — draw a card.", keywords_lc: ["spree"] }));
  assert.ok(!matches("is:modal", { fulloracle_lc: "draw two cards." }));
  assert.ok(matches("not:modal", { fulloracle_lc: "draw two cards." }));
});

test("commanders by format, and layouts", () => {
  const front = { type_lc: "legendary planeswalker — jace", type_words: ["jace", "legendary", "planeswalker"], legal: ["oathbreaker"] };
  assert.ok(matches("is:oathbreaker", front));
  // a planeswalker only on the back face is not an oathbreaker
  const back = { type_lc: "legendary creature — cat warrior // legendary planeswalker — ajani", type_words: ["ajani", "planeswalker"], legal: ["oathbreaker"] };
  assert.ok(!matches("is:oathbreaker", back));
  assert.ok(matches("is:duelcommander", { flags: ["commander"], legal: ["duel"] }) && !matches("is:duelcommander", { flags: ["commander"], legal: ["commander"] }));
  assert.ok(matches("is:brawler", { flags: ["commander"], legal: ["brawl"] }));
  assert.ok(matches("is:brawler", { type_words: ["legendary", "planeswalker"], legal: ["brawl"] }));
  assert.ok(matches("is:adventure", { layout: "adventure" }) && !matches("is:adventure", { layout: "normal" }));
  assert.ok(matches("is:augmentation", { layout: "host" }) && matches("is:augmentation", { layout: "augment" }));
  assert.ok(matches("is:frenchvanilla", { flags: ["frenchvanilla", "permanent"] }));
});
