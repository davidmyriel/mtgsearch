// The HTTP contract, with a stubbed search: no network and no TopK key.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCard, handleSearch, MAX_QUERY_CHARS, MAX_REACH, MAX_RESULTS } from "../api.ts";
import type { CardPage } from "../card.ts";
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
const SEMANTIC: Result = { mode: "semantic", hits: [HIT], total: null, note: "sphinx", hasMore: true, sortedBy: null, unit: "cards", understood: [], ignored: [], exact: null };

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
  assert.deepEqual(calls, [["sphinx that draws two cards", { k: 24, offset: 0, order: null, descending: null, unique: null }]]);
  assert.equal(typeof body.took_ms, "number");
  delete body.took_ms;
  assert.deepEqual(body, {
    query: "sphinx that draws two cards",
    mode: "semantic",
    total: null,
    unit: "cards",
    note: "sphinx",
    understood: [], ignored: [], exact: null,
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
    [[MAX_RESULTS, MAX_REACH - MAX_RESULTS], [1, 0]],
  );
});

test("a page never reaches past what TopK will return, and says there is no more at that point", async () => {
  const many: Result = { mode: "syntax", hits: [HIT], total: 19_000, note: "", hasMore: true, sortedBy: "name", unit: "cards", understood: [], ignored: [], exact: null };
  const { calls, search } = stub(many);
  const last = await (await get({ q: "t:creature", k: "60", offset: String(MAX_REACH - 60) }, search)).json();
  const before = await (await get({ q: "t:creature", k: "60", offset: String(MAX_REACH - 120) }, search)).json();
  const small = await (await get({ q: "t:creature", k: "10", offset: String(MAX_REACH) }, search)).json();
  // limit + offset stays within the reach, whatever the page size
  assert.ok(calls.every(([, o]) => (o.k ?? 0) + (o.offset ?? 0) <= MAX_REACH));
  assert.deepEqual([last.offset, last.has_more], [MAX_REACH - 60, false]);
  assert.deepEqual([before.offset, before.has_more], [MAX_REACH - 120, true]);
  assert.deepEqual([small.offset, small.has_more], [MAX_REACH - 10, false]);
});

test("paging and sort parameters reach the search and come back in the answer", async () => {
  const sorted: Result = { mode: "syntax", hits: [HIT], total: 91, note: "", hasMore: true, sortedBy: "cmc", unit: "cards", understood: [], ignored: [], exact: null };
  const { calls, search } = stub(sorted);
  const body = await (await get({ q: "t:sphinx", offset: "24", order: "cmc", dir: "desc" }, search)).json();
  assert.deepEqual(calls[0][1], { k: 24, offset: 24, order: "cmc", descending: true, unique: null });
  assert.deepEqual([body.offset, body.has_more, body.sorted_by, body.total], [24, true, "cmc", 91]);
});

test("direction is ascending, descending or left to the order; unique is cards, prints or art", async () => {
  const { calls, search } = stub();
  await get({ q: "t:sphinx", order: "released", dir: "asc", unique: "prints" }, search);
  await get({ q: "t:sphinx", order: "released", unique: "art" }, search);
  await get({ q: "t:sphinx", dir: "sideways", unique: "cards" }, search);
  assert.deepEqual(
    calls.map(([, o]) => [o.order, o.descending, o.unique]),
    [["released", false, "prints"], ["released", null, "art"], [null, null, "cards"]],
  );
  const bad = await get({ q: "t:sphinx", unique: "everything" }, search);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /unique must be one of: cards, prints, art/);
  assert.equal(calls.length, 3);
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

test("a setup problem is named, so it shows on the page and not only in the log", async () => {
  const quiet = console.error;
  console.error = () => {};
  const failing = (message: string) => get({ q: "elf" }, async () => { throw new Error(message); });
  try {
    // the messages are what the app and TopK's client actually raise
    const cases: [string, RegExp][] = [
      ["TOPK_API_KEY is not set; see .env.example", /has no TopK API key/],
      ['TopkError(Unauthenticated("Invalid api key"))', /rejected this deployment's API key/],
      ["collection not found", /does not hold the card collections/],
    ];
    for (const [message, expected] of cases) {
      const response = await failing(message);
      assert.equal(response.status, 503, message);
      assert.match((await response.json()).error, expected);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    // the reply is a fixed sentence: nothing from the error itself is passed on
    const leaky = await failing('TopkError(Unauthenticated("Invalid api key")) for key sk-secret-123');
    assert.ok(!(await leaky.text()).includes("sk-secret-123"));
    // anything else stays a generic 502
    assert.equal((await failing("connection reset by peer")).status, 502);
  } finally {
    console.error = quiet;
  }
});

test("terms that were left out come back with their reasons, beside the results", async () => {
  const partial: Result = {
    mode: "syntax", hits: [HIT], total: 91, note: "", hasMore: true, sortedBy: "name", unit: "cards",
    understood: ["the type includes “sphinx”"], ignored: [{ term: "lang:ja", reason: "'lang:' is not supported yet" }], exact: null,
  };
  const response = await get({ q: "lang:ja t:sphinx" }, stub(partial).search);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.ignored, [{ term: "lang:ja", reason: "'lang:' is not supported yet" }]);
  assert.deepEqual([body.mode, body.total, body.hits.length, body.understood], ["syntax", 91, 1, ["the type includes “sphinx”"]]);
});

test("the card named exactly by the query comes back beside the results, shaped like a hit", async () => {
  const named: Result = {
    mode: "name", hits: [HIT, { ...HIT, _id: "def", name: "Sphinx of the Second Sun" }], total: 2, note: "", hasMore: false, sortedBy: "edhrec",
    unit: "cards", understood: [], ignored: [], exact: HIT,
  };
  const body = await (await get({ q: "consecrated sphinx" }, stub(named).search)).json();
  assert.deepEqual([body.exact.id, body.exact.name, body.exact.set, body.exact.collector_number], ["abc", "Consecrated Sphinx", "2x2", "43"]);
  assert.equal(body.total, 2);
  // and is null when the query names no card exactly
  assert.equal((await (await get({ q: "sphinx" }, stub().search)).json()).exact, null);
});

test("unsupported syntax is passed through for the page to explain", async () => {
  const refused: Result = {
    mode: "unsupported", hits: [], total: null, note: "'lang:' is not supported yet", hasMore: false, sortedBy: null, unit: "cards", understood: [], ignored: [], exact: null,
  };
  const body = await (await get({ q: "lang:ja" }, stub(refused).search)).json();
  assert.equal(body.mode, "unsupported");
  assert.deepEqual(body.hits, []);
  assert.match(body.note, /not supported/);
});

test("a missing image is null, not absent", async () => {
  const { image: _unused, ...withoutImage } = HIT;
  const named: Result = { mode: "name", hits: [withoutImage], total: 1, note: "", hasMore: false, sortedBy: "edhrec", unit: "cards", understood: [], ignored: [], exact: null };
  const body = await (await get({ q: "sphinx" }, stub(named).search)).json();
  assert.equal(body.hits[0].image, null);
  assert.equal(body.total, 1);
});

test("a printing search says what its total counts and returns the printing's details", async () => {
  const printing = { ...HIT, _id: "p1", oracle_id: "abc", flavor_text: "Blessed by the hands of Jin-Gitaxias.", usd: 34.97 };
  const prints: Result = { mode: "syntax", hits: [printing], total: 11, note: "", hasMore: false, sortedBy: "released", unit: "printings", understood: [], ignored: [], exact: null };
  const body = await (await get({ q: '!"consecrated sphinx" unique:prints', order: "released", dir: "desc" }, stub(prints).search)).json();
  assert.deepEqual([body.unit, body.total, body.sorted_by], ["printings", 11, "released"]);
  assert.deepEqual(
    [body.hits[0].id, body.hits[0].flavor_text, body.hits[0].usd, body.hits[0].collector_number],
    ["p1", "Blessed by the hands of Jin-Gitaxias.", 34.97, "43"],
  );
});

// --- GET /api/card ---------------------------------------------------------------------

const PRINTING = {
  ...HIT, _id: "p1", oracle_id: "abc", usd: 20.49, flavor_text: "Blessed by the hands of Jin-Gitaxias.",
  stats: "4/6", legal: ["commander", "legacy", "vintage"], banned: ["duel"],
};
const OLDER = { _id: "p0", name: "Consecrated Sphinx", set: "mbs", set_name: "Mirrodin Besieged", cn: "21", rarity: "mythic", released: "2011-02-04", usd: null };
const PAGE: CardPage = { card: PRINTING, printings: [PRINTING, OLDER] };
const getCard = (params: Record<string, string>, card: Parameters<typeof handleCard>[1]) =>
  handleCard(new URL(`https://example.test/api/card?${new URLSearchParams(params)}`), card);

test("a card's page: the printing with its stats and legality, and the card's printings", async () => {
  const calls: string[][] = [];
  const response = await getCard({ set: " 2X2 ", cn: "43" }, async (set, number) => {
    calls.push([set, number]);
    return PAGE;
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["2x2", "43"]]); // the set code is lowercased and trimmed
  assert.match(response.headers.get("Netlify-CDN-Cache-Control") ?? "", /max-age=600/);
  const body = await response.json();
  assert.equal(typeof body.took_ms, "number");
  assert.deepEqual(
    [body.card.id, body.card.name, body.card.collector_number, body.card.stats, body.card.usd],
    ["p1", "Consecrated Sphinx", "43", "4/6", 20.49],
  );
  // every legality list is present, empty when the card has none of that status
  assert.deepEqual([body.card.legal, body.card.banned, body.card.restricted], [["commander", "legacy", "vintage"], ["duel"], []]);
  assert.deepEqual(body.printings, [
    { id: "p1", name: "Consecrated Sphinx", set: "2x2", set_name: "Double Masters 2022", collector_number: "43", rarity: "mythic", released: "2022-07-08", usd: 20.49 },
    { id: "p0", name: "Consecrated Sphinx", set: "mbs", set_name: "Mirrodin Besieged", collector_number: "21", rarity: "mythic", released: "2011-02-04", usd: null },
  ]);
});

test("a card without a size has null stats", async () => {
  const { stats: _none, ...spell } = PRINTING;
  const body = await (await getCard({ set: "2x2", cn: "43" }, async () => ({ card: spell, printings: [] }))).json();
  assert.equal(body.card.stats, null);
  assert.deepEqual(body.printings, []);
});

test("?random=1 answers with a card chosen at random, in the same shape, and is never cached", async () => {
  let looked = false;
  const lookup = async () => {
    looked = true;
    return PAGE;
  };
  const response = await handleCard(new URL("https://example.test/api/card?random=1"), lookup, async () => PAGE);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Netlify-CDN-Cache-Control"), null);
  const body = await response.json();
  assert.deepEqual([body.card.name, body.card.set, body.printings.length], ["Consecrated Sphinx", "2x2", 2]);
  assert.equal(looked, false); // no set or number is needed, and none is looked up
  // nothing could be picked: an error, not a 404 that would be cached
  const none = await handleCard(new URL("https://example.test/api/card?random=1"), lookup, async () => null);
  assert.equal(none.status, 502);
  // without a way to pick one, random is not on offer and the address rules apply
  assert.equal((await handleCard(new URL("https://example.test/api/card?random=1"), lookup)).status, 400);
});

test("an address with no card is a 404 that says so", async () => {
  const response = await getCard({ set: "nosuchset", cn: "999" }, async () => null);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Nothing is numbered 999 in the set "nosuchset"/);
});

test("a malformed card address is refused without a lookup", async () => {
  let called = false;
  const card = async () => {
    called = true;
    return PAGE;
  };
  for (const params of [{}, { set: "mh2" }, { cn: "45" }, { set: "m h2", cn: "45" }, { set: "mh2", cn: "x".repeat(21) }, { set: "a".repeat(11), cn: "1" }]) {
    assert.equal((await getCard(params as Record<string, string>, card)).status, 400, JSON.stringify(params));
  }
  assert.equal(called, false);
});

test("a failed card lookup is a 502, or a 503 that names a setup problem", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const down = await getCard({ set: "mh2", cn: "45" }, async () => {
      throw new Error("connection reset");
    });
    assert.equal(down.status, 502);
    assert.equal(down.headers.get("Cache-Control"), "no-store");
    const noKey = await getCard({ set: "mh2", cn: "45" }, async () => {
      throw new Error("TOPK_API_KEY is not set");
    });
    assert.equal(noKey.status, 503);
    assert.match((await noKey.json()).error, /no TopK API key/);
  } finally {
    console.error = quiet;
  }
});
