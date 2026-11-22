// Keyword semantics, checked without a network: queries are compiled and evaluated against
// fixtures/documents.json, which holds the documents the ingest job builds for a small
// hand-made card set (a Python test keeps that file in step with the document builder).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate } from "../evaluate.ts";
import type { Doc } from "../evaluate.ts";
import { lower } from "../lower.ts";
import { extract } from "../nl.ts";
import { fold, plain } from "../normalize.ts";
import { parse, QueryError, Unsupported } from "../parser.ts";
import { isPlainWords, splitWords } from "../search.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const docs: Doc[] = read("documents.json");
const AVACYN = "Archangel Avacyn // Avacyn, the Purifier";

const compile = (query: string) => lower(parse(query));
const matches = (query: string) => {
  const [predicate] = compile(query);
  return docs.filter((doc) => evaluate(predicate, doc)).map((doc) => doc.name as string).sort();
};
const has = (query: string, name: string) => matches(query).includes(name);

test("fold and plain agree with the ingest job's normalisation", () => {
  for (const { text, fold: folded, plain: plained } of read("normalize.json")) {
    assert.equal(fold(text), folded, `fold(${JSON.stringify(text)})`);
    assert.equal(plain(text), plained, `plain(${JSON.stringify(text)})`);
  }
});

test("parser: keywords, bare words, quotes, regex, exact names", () => {
  assert.deepEqual(parse("t:elf bolt"), {
    kind: "and",
    children: [
      { kind: "keyword", key: "t", op: ":", value: "elf", regex: false },
      { kind: "name", text: "bolt", exact: false },
    ],
  });
  assert.deepEqual(parse('o:"draw two cards"'), { kind: "keyword", key: "o", op: ":", value: "draw two cards", regex: false });
  assert.deepEqual(parse(String.raw`o:/a\/b/`), { kind: "keyword", key: "o", op: ":", value: "a/b", regex: true });
  assert.deepEqual(parse('!"sift through sands"'), { kind: "name", text: "sift through sands", exact: true });
  assert.deepEqual(parse("pow>=8"), { kind: "keyword", key: "pow", op: ">=", value: "8", regex: false });
  assert.deepEqual(parse("lim-dul"), { kind: "name", text: "lim-dul", exact: false }); // not a negation
});

test("parser: or binds looser than adjacency", () => {
  const ast = parse("a b or c");
  assert.equal(ast.kind, "or");
  assert.equal(ast.kind === "or" && ast.children[0].kind, "and");
});

test("malformed queries are QueryErrors", () => {
  for (const bad of ['o:"unterminated', "o:/unterminated", "(t:elf", "t:elf )", "t:", "bogus:value", "t:elf -", "c:purple", "mv:inf"]) {
    assert.throws(() => compile(bad), (e) => e instanceof QueryError && !(e instanceof Unsupported), bad);
  }
});

test("unsupported keywords are reported, never silently ignored", () => {
  for (const query of ["block:ice", "cube:vintage", "is:unicorn", "lang:ja", "new:art", "order:artist", "prefer:promo", "in:japanese", "pow>loy", String.raw`o:/\spp/`]) {
    assert.throws(() => compile(query), Unsupported, query);
  }
});

test("bare words match the name, forgiving case, diacritics and punctuation", () => {
  assert.deepEqual(matches("sphinx"), ["Consecrated Sphinx"]);
  assert.deepEqual(matches("limduls"), ["Lim-Dûl's Vault"]);
  assert.deepEqual(matches("lim-dul's"), ["Lim-Dûl's Vault"]);
  assert.deepEqual(matches("SOL ring"), ["Sol Ring"]);
  assert.deepEqual(matches("onsecrated"), ["Consecrated Sphinx"]); // substring, not just a prefix
});

test("an exact name matches a face", () => {
  assert.deepEqual(matches("!fire"), ["Fire // Ice"]);
  assert.deepEqual(matches('!"sol ring"'), ["Sol Ring"]);
  assert.deepEqual(matches("!sol"), []);
});

test("type matches whole words for known types and substrings otherwise", () => {
  assert.deepEqual(compile("t:fish include:extras")[0], ["in", "type_words", "fish"]); // not Jellyfish
  assert.deepEqual(compile("t:jelly include:extras")[0], ["has", "type_lc", "jelly"]);
  assert.deepEqual(matches("t:sphinx"), ["Consecrated Sphinx"]);
  assert.deepEqual(matches("t:leg"), [AVACYN, "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches('t:"creature — sphinx"'), ["Consecrated Sphinx"]);
});

test("rules text, the ~ placeholder, reminder text and keywords", () => {
  assert.deepEqual(matches('o:"draw two cards"'), ["Consecrated Sphinx"]);
  assert.deepEqual(matches('o:"~ is dealt damage"'), ["Boros Reckoner"]);
  assert.deepEqual(matches('o:"~ transforms"'), [AVACYN]); // "this creature transforms"
  assert.deepEqual(matches("o:shuffle"), []);
  assert.deepEqual(matches("fo:shuffle"), ["Lim-Dûl's Vault"]);
  assert.deepEqual(matches("kw:flash"), [AVACYN]);
});

test("colour comparisons", () => {
  assert.deepEqual(matches("c:u"), ["Consecrated Sphinx", "Fire // Ice", "Jace, the Mind Sculptor", "Lim-Dûl's Vault"]);
  assert.deepEqual(matches("c=u"), ["Consecrated Sphinx", "Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("c:dimir"), ["Lim-Dûl's Vault"]);
  assert.deepEqual(matches("c:blue c:black"), ["Lim-Dûl's Vault"]);
  assert.deepEqual(matches("c:colorless"), ["Sol Ring"]);
  assert.deepEqual(matches("c=2 t:creature"), ["Boros Reckoner"]);
  assert.deepEqual(matches("c!=u t:planeswalker"), []);
  assert.deepEqual(matches("c<g"), ["Sol Ring"]);
});

test("colours match per face on double-faced cards", () => {
  // Front face white, back face red: either can satisfy a condition, but the card is not "white and red".
  assert.ok(has("c:w", AVACYN) && has("c:r", AVACYN));
  assert.ok(has("c=w", AVACYN) && has("c=1", AVACYN));
  assert.ok(!has("c=rw", AVACYN) && !has("c:m", AVACYN));
  assert.ok(has("c<=izzet c>=1", AVACYN));
  assert.deepEqual(matches("c:m"), ["Boros Reckoner", "Fire // Ice", "Lim-Dûl's Vault"]);
});

test("colour identity defaults to subset", () => {
  assert.deepEqual(matches("id:boros"), [AVACYN, "Boros Reckoner", "Sol Ring"]);
  assert.deepEqual(matches("id:c"), ["Sol Ring"]);
  assert.deepEqual(matches("id=rw"), [AVACYN, "Boros Reckoner"]);
});

test("numbers", () => {
  assert.deepEqual(matches("mv=1"), ["Llanowar Elves", "Sol Ring"]);
  assert.deepEqual(matches("mv:odd t:creature"), [AVACYN, "Boros Reckoner", "Llanowar Elves"]);
  assert.deepEqual(matches("pow>=4"), [AVACYN, "Consecrated Sphinx"]);
  assert.deepEqual(matches("tou>pow"), [AVACYN, "Consecrated Sphinx", "Tarmogoyf"]); // 5 toughness vs 4 power
  assert.deepEqual(matches("loy=3"), ["Jace, the Mind Sculptor"]);
  assert.deepEqual(matches("pt=10"), ["Consecrated Sphinx"]);
  assert.deepEqual(matches("edhrec<10"), ["Sol Ring"]);
});

test("power and toughness match on any face", () => {
  assert.deepEqual(matches("pow=6"), [AVACYN]); // back face
  assert.ok(has("pow=4", AVACYN)); // front face
  assert.deepEqual(matches("pow>tou"), [AVACYN]); // 6/5 back face
  assert.ok(has("pow<=4", AVACYN) && has("pow>=6", AVACYN));
});

test("negation keeps cards that lack the field", () => {
  assert.ok(has("-pow>=4", "Sol Ring"));
  assert.ok(has("-kw:flying", "Sol Ring"));
  assert.ok(!has("-kw:flying", "Consecrated Sphinx"));
});

test("legality, flags and tags", () => {
  assert.ok(!has("f:modern", "Sol Ring"));
  assert.deepEqual(matches("banned:legacy"), ["Sol Ring"]);
  assert.deepEqual(matches("restricted:vintage"), ["Sol Ring"]);
  assert.deepEqual(matches("f:edh t:artifact"), ["Sol Ring"]);
  assert.deepEqual(matches("is:vanilla"), ["Grizzly Bears"]);
  assert.deepEqual(matches("not:permanent"), ["Fire // Ice", "Lim-Dûl's Vault"]);
  assert.deepEqual(matches("is:tdfc"), [AVACYN]);
  assert.deepEqual(matches("otag:ramp"), ["Sol Ring"]);
  assert.deepEqual(matches('function:"mana rock"'), ["Sol Ring"]);
});

test("regular expressions", () => {
  assert.deepEqual(matches("o:/^{T}: add/"), ["Llanowar Elves", "Sol Ring"]);
  assert.deepEqual(matches(String.raw`name:/\bring\b/`), ["Sol Ring"]);
  assert.deepEqual(matches(String.raw`t:/elf\b/`), ["Llanowar Elves"]);
});

test("or and nesting", () => {
  assert.deepEqual(matches("t:elf or t:bear"), ["Grizzly Bears", "Llanowar Elves"]);
  assert.deepEqual(matches("c:g (t:elf or t:lhurgoyf) -mv=1"), ["Tarmogoyf"]);
});

test("extras are hidden unless the query reveals them", () => {
  assert.ok(!has("t:goblin", "Goblin"));
  assert.ok(has("t:goblin include:extras", "Goblin"));
  assert.ok(has("t:token", "Goblin"));
  assert.ok(!has("t:planeswalker or c:r", "Goblin")); // "plane" inside "planeswalker" must not reveal
  assert.ok(has("name:/^goblin$/", "Goblin")); // a name regex searches extras too
  assert.deepEqual(compile("is:funny")[0], ["in", "flags", "funny"]); // is:funny reveals extras
  assert.deepEqual(compile("not:funny")[0], ["and", [["not", ["in", "flags", "funny"]], ["eq", "extra", false]]]);
});

test("display options change options, not which cards match", () => {
  const [, options] = compile("t:elf order:cmc direction:desc");
  assert.deepEqual(options, { includeExtras: false, order: "cmc", descending: true, unique: "cards", prefer: null, printings: false });
  assert.deepEqual(compile("unique:cards display:grid include:extras")[0], ["all"]);
});

test("plain English: filters come from the opening noun phrase only", () => {
  const notes = (query: string) => extract(query).notes;
  assert.deepEqual(notes("one mana artifact that taps for two colorless mana"), ["mana value 1", "artifact"]);
  assert.deepEqual(notes("one mana elf that taps for one green mana"), ["mana value 1", "elf"]);
  assert.deepEqual(notes("sphinx that draws two cards"), ["sphinx"]);
  assert.deepEqual(notes("big green creature that gives all my creatures trample"), ["green", "creature"]);
  assert.deepEqual(notes("a 3-drop blue instant"), ["mana value 3", "blue", "instant"]);
  assert.deepEqual(notes("legendary elves that tap for mana"), ["legendary", "elf"]);
  assert.deepEqual(notes("destroy all creatures for four mana"), ["mana value 4"]);
  for (const query of [
    "lets me play lands from my graveyard", // "lands" is not at the start
    "board wipe", // "board" must not be read as the creature type Boar
    "red", // a colour on its own is not a filter
    "artifact that taps for two mana", // "for two mana" after "taps" is not a cost
    "protection from red",
    "token doubler",
  ]) {
    const found = notes(query);
    assert.ok(!found.some((n) => n.startsWith("mana value") || ["red", "land", "boar"].includes(n)), `${query}: ${found}`);
  }
  assert.deepEqual(extract("something about drawing cards"), { predicate: ["all"], notes: [], any: false });
});

test("plain-English filters select the right fixture cards", () => {
  const filter = (query: string) => docs.filter((d) => evaluate(extract(query).predicate, d)).map((d) => d.name);
  assert.deepEqual(filter("one mana artifact that taps for two colorless mana"), ["Sol Ring"]);
  assert.deepEqual(filter("blue sphinx"), ["Consecrated Sphinx"]);
});

test("search routing: plain words versus syntax", () => {
  assert.ok(isPlainWords(parse("sphinx that draws two cards")));
  assert.ok(isPlainWords(parse("they pay two or I get a treasure"))); // "or" is still plain English
  assert.ok(isPlainWords(parse("lightning -bolt")));
  assert.ok(!isPlainWords(parse("t:sphinx draws cards")));
  assert.ok(!isPlainWords(parse("!fire")));
  assert.ok(!isPlainWords(parse("fire or t:elf")));
  const split = splitWords(parse("c:u t:sphinx draws when opponents draw"));
  assert.deepEqual(split?.keywords.map((k) => (k.kind === "keyword" ? k.key : k.text)), ["c", "t"]);
  assert.deepEqual(split?.words.map((w) => w.text), ["draws", "when", "opponents", "draw"]);
  assert.equal(splitWords(parse("t:elf or t:goblin")), null); // not a flat list of terms
});
