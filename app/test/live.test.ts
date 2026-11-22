// End-to-end against the live TopK collection. Skipped unless TOPK_API_KEY is set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "topk-js";
import { handleSearch } from "../api.ts";
import { search } from "../search.ts";
import type { Collection } from "../search.ts";

const key = (process.env.TOPK_API_KEY ?? "").trim();
const skip = key ? false : "TOPK_API_KEY is not set";
const collection = () =>
  new Client({ apiKey: key, region: process.env.TOPK_REGION || "aws-us-east-1-elastica" }).collection(
    process.env.MTGSEARCH_COLLECTION || "mtg-cards-v2",
  ) as unknown as Collection;
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
  assert.equal((await search(col, "t:creature o:/^{T}:/ c:u mv=1", 60)).total, 13);
  assert.equal((await search(col, "t:fish", 1)).total, 59); // whole word: no Jellyfish
});

test("the handler answers end to end", { skip }, async () => {
  const col = collection();
  const response = await handleSearch(new URL("https://x.test/api/search?q=dwarf+destroys+lands&k=3"), (q, k) =>
    search(col, q, k),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "semantic");
  assert.equal(body.hits.length, 3);
  assert.ok(body.hits[0].image.startsWith("https://cards.scryfall.io/"));
});
