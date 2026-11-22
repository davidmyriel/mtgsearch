// The HTTP contract, with a stubbed search: no network and no TopK key.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSearch, MAX_OFFSET, MAX_QUERY_CHARS, MAX_RESULTS } from "../api.ts";
import type { Result, SearchOptions } from "../search.ts";

const HIT = {
  _id: "abc",
  name: "Consecrated Sphinx",
  mana_cost: "{4}{U}{U}",
  type_line: "Creature — Sphinx",
  oracle_text: "Flying\nWhenever an opponent draws a card, you may draw two cards.",
  image: "https://cards.scryfall.io/normal/front/x.jpg",
  scryfall_uri: "https://scryfall.com/card/2x2/43/consecrated-sphinx",
  edhrec_rank: 661,
  set: "2x2",
  set_name: "Double Masters 2022",
  cn: "43",
  rarity: "mythic",
  artist: "Mark Zug",
  released: "2022-07-08",
  usd: 20.489999771118164, // decimals come back from TopK in single precision
  prints: 11,
  score: 4.25219,
};
const SEMANTIC: Result = { mode: "semantic", hits: [HIT], total: null, note: "sphinx", hasMore: true, sortedBy: null, unit: "cards" };

function stub(result: Result = SEMANTIC) {
  const calls: [string, SearchOptions][] = [];
  const search = async (query: string, options: SearchOptions) => {
    calls.push([query, options]);
    return result;
  };
  return { calls, search };
}

const get = (params: Record<string, string>, search: Parameters<typeof handleSearch>[1]) =>
  handleSearch(new URL(`https://example.test/api/search?${new URLSearchParams(params)}`), search);

test("returns the documented shape", async () => {
  const { calls, search } = stub();
  const response = await get({ q: "  sphinx   that draws two cards " }, search);
  assert.equal(response.status, 200);
  const body = await response.json();
  // whitespace is normalised; defaults are filled in
  assert.deepEqual(calls, [["sphinx that draws two cards", { k: 24, offset: 0, order: null, descending: false }]]);
  assert.equal(typeof body.took_ms, "number");
  delete body.took_ms;
  assert.deepEqual(body, {
    query: "sphinx that draws two cards",
    mode: "semantic",
    total: null,
    unit: "cards",
    note: "sphinx",
    hits: [
      {
        id: "abc",
        name: "Consecrated Sphinx",
        mana_cost: "{4}{U}{U}",
        type_line: "Creature — Sphinx",
        oracle_text: "Flying\nWhenever an opponent draws a card, you may draw two cards.",
        image: "https://cards.scryfall.io/normal/front/x.jpg",
        scryfall_uri: "https://scryfall.com/card/2x2/43/consecrated-sphinx",
        set: "2x2",
        set_name: "Double Masters 2022",
        collector_number: "43",
        rarity: "mythic",
        artist: "Mark Zug",
        released: "2022-07-08",
        usd: 20.49,
        flavor_text: null,
        prints: 11,
        score: 4.252,
      },
    ],
    offset: 0,
    has_more: true,
    sorted_by: null,
  });
});

test("bad requests are rejected without searching", async () => {
  const bad = [
    {},
    { q: "" },
    { q: "   " },
    { q: "x".repeat(MAX_QUERY_CHARS + 1) },
    { q: "elf", k: "many" },
    { q: "elf", offset: "1.5" },
    { q: "elf", order: "price" },
    { q: "elf", order: "__proto__" },
  ];
  for (const params of bad) {
    const { calls, search } = stub();
    const response = await get(params as Record<string, string>, search);
    assert.equal(response.status, 400, JSON.stringify(params));
    assert.ok((await response.json()).error);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 0);
  }
});

test("page size and offset are clamped", async () => {
  const { calls, search } = stub();
  await get({ q: "elf", k: "5000", offset: "999999" }, search);
  await get({ q: "goblin", k: "-3", offset: "-5" }, search);
  assert.deepEqual(
    calls.map(([, o]) => [o.k, o.offset]),
    [[MAX_RESULTS, MAX_OFFSET], [1, 0]],
  );
});

test("paging and sort parameters reach the search and come back in the answer", async () => {
  const sorted: Result = { mode: "syntax", hits: [HIT], total: 91, note: "", hasMore: true, sortedBy: "cmc", unit: "cards" };
  const { calls, search } = stub(sorted);
  const body = await (await get({ q: "t:sphinx", offset: "24", order: "cmc", dir: "desc" }, search)).json();
  assert.deepEqual(calls[0][1], { k: 24, offset: 24, order: "cmc", descending: true });
  assert.deepEqual([body.offset, body.has_more, body.sorted_by, body.total], [24, true, "cmc", 91]);
});

test("successful answers may be cached by the CDN, never by the browser alone", async () => {
  const response = await get({ q: "elf" }, stub().search);
  assert.match(response.headers.get("netlify-cdn-cache-control") ?? "", /max-age=600/);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("a backend failure is a 502 that leaks nothing and is not cached", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const response = await get({ q: "elf" }, async () => {
      throw new Error("secret internal detail");
    });
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("secret"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("netlify-cdn-cache-control"), null);
  } finally {
    console.error = quiet;
  }
});

test("unsupported syntax is passed through for the page to explain", async () => {
  const refused: Result = {
    mode: "unsupported", hits: [], total: null, note: "'lang:' is not supported yet", hasMore: false, sortedBy: null, unit: "cards",
  };
  const body = await (await get({ q: "lang:ja" }, stub(refused).search)).json();
  assert.equal(body.mode, "unsupported");
  assert.deepEqual(body.hits, []);
  assert.match(body.note, /not supported/);
});

test("a missing image is null, not absent", async () => {
  const { image: _unused, ...withoutImage } = HIT;
  const named: Result = { mode: "name", hits: [withoutImage], total: 1, note: "", hasMore: false, sortedBy: "edhrec", unit: "cards" };
  const body = await (await get({ q: "sphinx" }, stub(named).search)).json();
  assert.equal(body.hits[0].image, null);
  assert.equal(body.total, 1);
});

test("a printing search says what its total counts and returns the printing's details", async () => {
  const printing = { ...HIT, _id: "p1", oracle_id: "abc", flavor_text: "Blessed by the hands of Jin-Gitaxias.", usd: 34.97 };
  const prints: Result = { mode: "syntax", hits: [printing], total: 11, note: "", hasMore: false, sortedBy: "released", unit: "printings" };
  const body = await (await get({ q: '!"consecrated sphinx" unique:prints', order: "released", dir: "desc" }, stub(prints).search)).json();
  assert.deepEqual([body.unit, body.total, body.sorted_by], ["printings", 11, "released"]);
  assert.deepEqual(
    [body.hits[0].id, body.hits[0].flavor_text, body.hits[0].usd, body.hits[0].collector_number],
    ["p1", "Blessed by the hands of Jin-Gitaxias.", 34.97, "43"],
  );
});
