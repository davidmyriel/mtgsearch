// A query said back in words. No network: the explanation is made from the parsed query alone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { explain } from "../explain.ts";
import { lower } from "../lower.ts";
import { parse, QueryError } from "../parser.ts";

const said = (query: string) => explain(parse(query));

test("each condition of a query is said on its own", () => {
  assert.deepEqual(said("t:sphinx mv<=3 -c:u"), [
    "the type includes “sphinx”",
    "the mana value is 3 or less",
    "its colours do not include blue",
  ]);
  assert.deepEqual(said('c:u t:sphinx o:"draw two cards"'), [
    "its colours include blue",
    "the type includes “sphinx”",
    "the text includes “draw two cards”",
  ]);
});

test("bare words look in the name and are said once; an exact name is exact", () => {
  assert.deepEqual(said("lightning bolt"), ["the name includes “lightning” and “bolt”"]);
  assert.deepEqual(said("bolt"), ["the name includes “bolt”"]);
  assert.deepEqual(said("-bolt t:instant"), ["the name does not include “bolt”", "the type includes “instant”"]);
  assert.deepEqual(said('!"lightning bolt"'), ["the name is “lightning bolt”"]);
  assert.deepEqual(said("name:/^the /"), ["the name matches /^the /"]);
});

test("colours: a bare colon means at least these, and for identity within these", () => {
  assert.deepEqual(said("c:wu"), ["its colours include white and blue"]);
  assert.deepEqual(said("c=wu"), ["its colours are exactly white and blue"]);
  assert.deepEqual(said("c<=esper"), ["its colours are within white, blue and black"]);
  assert.deepEqual(said("c>wu"), ["its colours include white and blue and at least one more"]);
  assert.deepEqual(said("c!=wu"), ["its colours are not exactly white and blue"]);
  assert.deepEqual(said("-c=wu"), ["its colours are not exactly white and blue"]);
  assert.deepEqual(said("id:rg"), ["its colour identity is within red and green"]);
  assert.deepEqual(said("id>=izzet"), ["its colour identity includes blue and red"]);
  assert.deepEqual(said("c:m"), ["it is multicoloured"]);
  assert.deepEqual(said("c:c"), ["it is colourless"]);
  assert.deepEqual(said("id:c"), ["its colour identity is colourless"]);
  assert.deepEqual(said("c=2"), ["it has 2 colours"]);
  assert.deepEqual(said("c<3"), ["it has fewer than 3 colours"]);
  assert.deepEqual(said("c:1"), ["it has 1 colour"]);
});

test("numbers, and stats compared with one another", () => {
  assert.deepEqual(said("mv=3"), ["the mana value is 3"]);
  assert.deepEqual(said("mv!=3"), ["the mana value is not 3"]);
  assert.deepEqual(said("-mv>=3"), ["the mana value is not 3 or more"]);
  assert.deepEqual(said("mv:odd"), ["the mana value is odd"]);
  assert.deepEqual(said("pow>=4 tou<2"), ["its power is 4 or more", "its toughness is less than 2"]);
  assert.deepEqual(said("pow>tou"), ["its power is more than its toughness"]);
  assert.deepEqual(said("loy>=6"), ["its loyalty is 6 or more"]);
  assert.deepEqual(said("usd<5"), ["its price in US dollars is less than 5"]);
  assert.deepEqual(said("prints>=40"), ["its number of printings is 40 or more"]);
});

test("legality, flags and tags", () => {
  assert.deepEqual(said("f:pauper"), ["it is legal in Pauper"]);
  assert.deepEqual(said("f:edh"), ["it is legal in Commander"]);
  assert.deepEqual(said("banned:modern"), ["it is banned in Modern"]);
  assert.deepEqual(said("-f:standard"), ["it is not legal in Standard"]);
  assert.deepEqual(said("is:commander"), ["it is a card that can be a commander"]);
  assert.deepEqual(said("not:reprint"), ["it is not a reprint"]);
  assert.deepEqual(said("-is:reprint"), ["it is not a reprint"]);
  assert.deepEqual(said("-not:reprint"), ["it is a reprint"]);
  assert.deepEqual(said("is:fetchland"), ["it is “fetchland”"]);
  assert.deepEqual(said("otag:removal kw:flash"), ["it has the tag “removal”", "it has the keyword “flash”"]);
});

test("printings: set, rarity, dates, games", () => {
  assert.deepEqual(said('set:mh2 a:"chris rahn"'), ["the set is MH2", "the artist's name includes “chris rahn”"]);
  // a block is said by its name; a set outside every block is that set
  assert.deepEqual(said("b:wwk"), ["the set is in the Zendikar block"]);
  assert.deepEqual(said("-block:zendikar"), ["the set is not in the Zendikar block"]);
  assert.deepEqual(said("b:dom"), ["the set is DOM"]);
  assert.deepEqual(said("b:nosuchblock"), ["the set is in a block called “nosuchblock” (there is none)"]);
  // a printing that was the first of its card to have something
  assert.deepEqual(said("new:art"), ["it is the card's first printing with this art"]);
  assert.deepEqual(said("new:flavor"), ["it is the card's first printing with this flavour text"]);
  assert.deepEqual(said("new:frame"), ["it is the card's first printing in this frame"]);
  assert.deepEqual(said("-new:rarity"), ["it is not the card's first printing at this rarity"]);
  assert.deepEqual(said("r:mythic"), ["its rarity is mythic"]);
  assert.deepEqual(said("r>=r"), ["its rarity is rare or higher"]);
  assert.deepEqual(said("year=2015"), ["it was released in 2015"]);
  assert.deepEqual(said("year>=2015"), ["it was released in 2015 or later"]);
  assert.deepEqual(said("date<2000"), ["it was released before 2000"]);
  assert.deepEqual(said("date>=2024-01-01"), ["it was released on 2024-01-01 or later"]);
  assert.deepEqual(said("date>mh2"), ["it was released after the set MH2"]);
  assert.deepEqual(said("in:paper -in:mtgo"), ["it has been printed in paper", "it has not been printed in Magic Online"]);
  assert.deepEqual(said("in:rare in:ktk"), ["it has been printed at rare", "it has been printed in the set KTK"]);
  assert.deepEqual(said("game:arena"), ["it is available in Arena"]);
});

test("mana: a bare colon means at least", () => {
  assert.deepEqual(said("m:2WW"), ["its mana cost is at least “2WW”"]);
  assert.deepEqual(said("m={R/W}{R/W}"), ["its mana cost is exactly “{R/W}{R/W}”"]);
  assert.deepEqual(said("devotion:bb"), ["its devotion is at least “BB”"]);
  assert.deepEqual(said("produces:g"), ["it produces green mana"]);
  assert.deepEqual(said("produces>=2"), ["the number of colours of mana it produces is 2 or more"]);
});

test("or and brackets: a group is one condition, and a negated group says so", () => {
  assert.deepEqual(said("t:elf or t:goblin"), ["the type includes “elf” or the type includes “goblin”"]);
  assert.deepEqual(said("(t:elf or t:goblin) mv=1"), ["the type includes “elf” or the type includes “goblin”", "the mana value is 1"]);
  assert.deepEqual(said("-(c:r or c:g)"), ["not (its colours include red or its colours include green)"]);
  assert.deepEqual(said("t:elf or (t:goblin mv=1)"), ["the type includes “elf” or (the type includes “goblin” and the mana value is 1)"]);
});

test("keywords that change the display are not conditions", () => {
  assert.deepEqual(said("order:cmc direction:desc"), []);
  assert.deepEqual(said("t:sphinx unique:prints order:released prefer:oldest include:extras"), ["the type includes “sphinx”"]);
});

test("every query the compiler accepts can be said, with no raw value left over", () => {
  const root = new URL("../../", import.meta.url);
  const files = ["queries", "heldout", "printings", "printings_heldout", "mana", "mana_heldout", "shortcuts", "heldout2", "regex", "prices"];
  let explained = 0;
  for (const file of files) {
    const lines = readFileSync(new URL(`conformance/${file}.txt`, root), "utf8").split("\n");
    for (const query of lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))) {
      let ast;
      try {
        ast = parse(query);
        lower(ast);
      } catch (error) {
        if (error instanceof QueryError) continue; // refused queries are not explained
        throw error;
      }
      const conditions = explain(ast);
      assert.ok(conditions.length > 0, query);
      for (const condition of conditions) {
        assert.ok(condition.length > 3 && !/undefined|null|\[object/.test(condition), `${query} -> ${condition}`);
      }
      explained++;
    }
  }
  assert.ok(explained > 400, `only ${explained} queries were explained`);
});
