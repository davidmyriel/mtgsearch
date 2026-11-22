// `m:`, `devotion:` and `produces:`, checked without a network against fixtures/documents.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate } from "../evaluate.ts";
import type { Doc } from "../evaluate.ts";
import { lower } from "../lower.ts";
import { parseCost } from "../mana.ts";
import { parse, QueryError, Unsupported } from "../parser.ts";

const docs: Doc[] = JSON.parse(readFileSync(new URL("../../fixtures/documents.json", import.meta.url), "utf8"));
const AVACYN = "Archangel Avacyn // Avacyn, the Purifier";
const compile = (query: string) => lower(parse(query));
const matches = (query: string) => {
  const [predicate] = compile(query);
  return docs.filter((doc) => evaluate(predicate, doc)).map((doc) => doc.name as string).sort();
};
const NO_COST = ["Goblin"]; // the token is hidden by default, so no visible test card lacks a cost

test("a cost can be typed with or without braces; hybrids have one spelling", () => {
  assert.deepEqual(parseCost("m", "2WW"), { generic: 2, symbols: new Map([["W", 2]]) });
  assert.deepEqual(parseCost("m", "{2}{w}{W}"), parseCost("m", "2ww"));
  assert.deepEqual(parseCost("m", "{W/R}{r/w}x"), { generic: null, symbols: new Map([["R/W", 2], ["X", 1]]) });
  assert.deepEqual(parseCost("m", "10"), { generic: 10, symbols: new Map() });
  for (const bad of ["m:{2", "m:2-W", "m:?"]) {
    assert.throws(() => compile(bad), (e) => e instanceof QueryError && !(e instanceof Unsupported), bad);
  }
});

test("m: asks for at least these symbols and this much generic mana", () => {
  assert.deepEqual(matches("m:UU"), ["Consecrated Sphinx", "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("m:4UU"), ["Consecrated Sphinx"]);
  assert.deepEqual(matches("m:2UU"), ["Consecrated Sphinx", "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("m>=3"), ["Archangel Avacyn // Avacyn, the Purifier", "Consecrated Sphinx"]);
  // surplus coloured mana does not stand in for generic: {U}{B} is not "at least {1}{U}"
  assert.deepEqual(matches("m:1U"), ["Consecrated Sphinx", "Fire // Ice", "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("m:{R/W}"), ["Boros Reckoner"]);
  assert.deepEqual(matches("m:{w/r}{w/r}{w/r}"), ["Boros Reckoner"]);
  assert.deepEqual(matches("m:{R/W}{R/W}{R/W}{R/W}"), []);
  // {0} generic: any card that has a cost
  assert.equal(matches("m:0").length, docs.filter((d) => d.extra === false).length - 0);
});

test("m= is the exact cost; m> excludes it; m!= is its complement", () => {
  assert.deepEqual(matches("m={G}"), ["Llanowar Elves"]);
  assert.deepEqual(matches("m=1G"), ["Grizzly Bears", "Tarmogoyf"]);
  assert.deepEqual(matches("m=G1"), matches("m={1}{G}"));
  assert.deepEqual(matches("m>G"), ["Grizzly Bears", "Tarmogoyf"]);
  assert.deepEqual(matches("m>=G"), ["Grizzly Bears", "Llanowar Elves", "Tarmogoyf"]);
  assert.deepEqual(matches("m!=1G c:g"), ["Llanowar Elves"]);
});

test("m<= is any cost that fits inside the one given", () => {
  assert.deepEqual(matches("m<=1G"), ["Grizzly Bears", "Llanowar Elves", "Sol Ring", "Tarmogoyf"]);
  assert.deepEqual(matches("m<1G"), ["Llanowar Elves", "Sol Ring"]);
  assert.deepEqual(matches("m<=UB"), ["Lim-Dûl's Vault"]);
  // a card with no cost at all fits inside anything
  assert.deepEqual(matches("m<=G include:extras t:token"), NO_COST);
  assert.deepEqual(matches("m:0 include:extras t:token"), []);
  assert.throws(() => compile("m<=9WWWWUUUUBBBBRRRRGGGG"), Unsupported);
});

test("each half of a split card and each face with a cost is compared on its own", () => {
  assert.deepEqual(matches("m=1R"), ["Fire // Ice"]);
  assert.deepEqual(matches("m=1U"), ["Fire // Ice"]);
  assert.deepEqual(matches("m:RU"), []); // red is on one half, blue on the other
  // != holds when some part differs: Fire // Ice is "not {1}{R}" because of Ice
  assert.ok(matches("m!=1R").includes("Fire // Ice") && matches("m!=1U").includes("Fire // Ice"));
  assert.ok(!matches("m!=1G").includes("Grizzly Bears") && matches("m!=1G").includes("Sol Ring"));
  assert.deepEqual(matches("m=3WW"), [AVACYN]); // the front face; the back has no cost
  assert.deepEqual(matches("m<=W"), []); // and that missing cost is not a part of the card
});

test("devotion counts a permanent's coloured symbols; a hybrid counts for each of its colours", () => {
  assert.deepEqual(matches("devotion:uu"), ["Consecrated Sphinx", "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("devotion:{u}{u}{u}"), []);
  assert.deepEqual(matches("devotion:rrr"), ["Boros Reckoner"]);
  assert.deepEqual(matches("devotion:www"), ["Boros Reckoner"]);
  assert.deepEqual(matches("devotion=w"), []);
  assert.deepEqual(matches("devotion>w"), [AVACYN, "Boros Reckoner"]);
  // a hybrid symbol is devotion to both colours: a symbol of either counts once
  assert.deepEqual(matches("devotion:{r/w}{r/w}"), [AVACYN, "Boros Reckoner"]);
  assert.deepEqual(matches("devotion:{w/r}{w/r}{w/r}"), ["Boros Reckoner"]);
  assert.deepEqual(matches("devotion:{u/w}{u/w}"), [AVACYN, "Boros Reckoner", "Consecrated Sphinx", "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("devotion:{r/g}{r/g}{r/g}"), ["Boros Reckoner"]);
  assert.deepEqual(compile("devotion:{g/u}{g/u}")[0], ["and", [["cmp", "dev_UG", ">=", 2], ["eq", "extra", false]]]);
  // only permanents have devotion: Fire // Ice is an instant with a red symbol
  assert.deepEqual(matches("devotion:{r/w} t:instant"), []);
  assert.deepEqual(matches("devotion<=r t:instant"), ["Fire // Ice", "Lim-Dûl's Vault"]);
  // zero is not stored: a card without the colour has devotion zero to it
  assert.ok(matches("devotion<=u").includes("Sol Ring") && !matches("devotion<=u").includes("Consecrated Sphinx"));
  assert.deepEqual(matches("devotion<uu c:u"), ["Fire // Ice", "Lim-Dûl's Vault"]);
  assert.deepEqual(matches("devotion=uu"), ["Consecrated Sphinx", "Jace, the Mind Sculptor"]);
  for (const query of ["devotion:wu", "devotion:2", "devotion:{w/p}", "devotion:{w/u/b}"]) {
    assert.throws(() => compile(query), Unsupported, query);
  }
});

test("produces compares the colours of mana a card makes, or how many", () => {
  assert.deepEqual(matches("produces:g"), ["Llanowar Elves"]);
  assert.deepEqual(matches("produces:green"), ["Llanowar Elves"]);
  assert.deepEqual(matches("produces:c"), ["Sol Ring"]);
  assert.deepEqual(matches("produces=g"), ["Llanowar Elves"]);
  assert.deepEqual(matches("produces<=gw"), ["Llanowar Elves"]);
  assert.deepEqual(matches("produces<g"), []);
  assert.deepEqual(matches("produces>g"), []);
  assert.deepEqual(matches("produces:gw"), []);
  assert.deepEqual(matches("produces=1"), ["Llanowar Elves", "Sol Ring"]);
  assert.deepEqual(matches("produces>=2"), []);
  // a card that makes no mana never matches, except by negation
  assert.ok(!matches("produces<=wubrgc").includes("Grizzly Bears"));
  assert.ok(matches("-produces:g").includes("Grizzly Bears"));
  assert.throws(() => compile("produces:purple"), (e) => e instanceof QueryError && !(e instanceof Unsupported));
});

test("mana keywords are about the card, so they do not need the printings", () => {
  for (const query of ["m:2WW", "devotion:uu", "produces:g", "m<=1G"]) assert.equal(compile(query)[1].printings, false, query);
});
