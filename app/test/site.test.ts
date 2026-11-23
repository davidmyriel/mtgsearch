// The static page and its configuration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDevServer, SECURITY_HEADERS } from "../dev-server.ts";

const root = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the page has no inline script or style, as its Content-Security-Policy requires", () => {
  const html = root("public/index.html");
  assert.ok(!html.includes("<style") && !html.includes("style=") && !html.includes("onclick="));
  assert.equal(html.split("<script").length - 1, 1);
  assert.ok(html.includes('src="/app.js"') && html.includes('href="/app.css"'));
  assert.ok(!SECURITY_HEADERS["Content-Security-Policy"].includes("unsafe-inline"));
});

test("netlify.toml sends the same security headers as the dev server", () => {
  const toml = root("netlify.toml");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.ok(toml.includes(`${name} = "${value}"`), `${name} differs between netlify.toml and app/dev-server.ts`);
  }
  assert.ok(toml.includes('publish = "public"'));
});

test("a card's address is served the page on Netlify, and the page uses absolute asset paths", () => {
  const toml = root("netlify.toml");
  assert.match(toml, /\[\[redirects\]\]\s+from = "\/card\/\*"\s+to = "\/index.html"\s+status = 200/);
  assert.match(toml, /\[\[redirects\]\]\s+from = "\/random"\s+to = "\/index.html"\s+status = 200/);
  assert.match(toml, /\[\[redirects\]\]\s+from = "\/syntax"\s+to = "\/syntax.html"\s+status = 200/);
  // relative paths would resolve under /card/... and fail; a link within the page (#main) is fine
  for (const page of ["public/index.html", "public/syntax.html", "public/404.html"]) {
    for (const reference of root(page).match(/(?:src|href)="[^"]+"/g) ?? []) {
      assert.match(reference, /="(?:\/|https:\/\/|#)/, `${page}: ${reference}`);
    }
  }
});

test("every page's search bar carries the mark, which is a disc and names the box", () => {
  const icon = root("public/icon.svg");
  // a disc: one circle that fills the square it is drawn in
  assert.match(icon, /viewBox="0 0 64 64"/);
  assert.match(icon, /<circle cx="32" cy="32" r="3\d(?:\.\d+)?"/);
  for (const page of ["public/index.html", "public/syntax.html", "public/404.html"]) {
    // inside the form, before the box, as the box's label: pressing it puts the cursor there
    assert.match(
      root(page),
      /<form[^>]*class="search"[^>]*>\s*(?:<!--[^]*?-->\s*)?<label class="mark" for="q"><img src="\/icon\.svg" alt="" width="44" height="44"><span class="sr-only">Search cards<\/span><\/label>\s*<input id="q"/,
      page,
    );
  }
});

test("the dev server serves the page, its assets and nothing else", async () => {
  const server = createDevServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('id="search"'));
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    for (const asset of ["app.js", "app.css", "icon.svg", "flavour.json"]) assert.equal((await fetch(`${base}/${asset}`)).status, 200, asset);
    // a card's own address is the same page; its script reads the address
    const card = await fetch(`${base}/card/ima/47/consecrated-sphinx`);
    assert.equal(card.status, 200);
    assert.ok((await card.text()).includes('id="card"'));
    // so is /random, and the syntax guide is a page of its own
    assert.ok((await (await fetch(`${base}/random`)).text()).includes('id="card"'));
    const guide = await fetch(`${base}/syntax`);
    assert.equal(guide.status, 200);
    assert.ok((await guide.text()).includes("<h1>Syntax guide</h1>"));
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/missing.html`)).status, 404);
    const bad = await fetch(`${base}/api/search`);
    assert.equal(bad.status, 400); // answered by the handler without needing a TopK key
    assert.equal((await fetch(`${base}/api/card?set=mh2`)).status, 400); // likewise: no collector number
  } finally {
    server.close();
  }
});

test("the Scryfall comparison stays inside Scryfall's published rate limit", async () => {
  // /cards/search allows 2 requests a second: https://scryfall.com/docs/api/rate-limits
  const { MIN_INTERVAL_MS } = await import("../conformance.ts");
  assert.ok(MIN_INTERVAL_MS >= 500, `one request every ${MIN_INTERVAL_MS} ms is faster than 2 a second`);
});

test("every example in the syntax guide is a search that can be run", async () => {
  const { readFileSync } = await import("node:fs");
  const { lower } = await import("../lower.ts");
  const { parse } = await import("../parser.ts");
  const read = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
  const unescape = (text: string) => text.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  // the guide's examples are links to /?q=..., and the link's words are the query itself
  const guide = [...read("syntax.html").matchAll(/<a class="example" href="\/\?q=([^"]+)">([^<]+)<\/a>/g)];
  assert.ok(guide.length >= 40, `only ${guide.length} examples found in the guide`);
  for (const [, href, label] of guide) {
    const query = new URLSearchParams(`q=${unescape(href)}`).get("q") ?? "";
    assert.equal(query, unescape(label), "the link runs the query it shows");
    assert.doesNotThrow(() => lower(parse(query)), query);
  }
  // the home page itself carries no instructions: the guide is where they are
  assert.ok(!read("index.html").includes("data-q="));
});

test("the flavour of the week is a file the home page can read", async () => {
  const { readFileSync } = await import("node:fs");
  const flavour = JSON.parse(readFileSync(new URL("../../public/flavour.json", import.meta.url), "utf8"));
  // a line of its own, or none; it may only link within this site
  const featured = flavour.featured;
  assert.ok(featured === null || (typeof featured.text === "string" && typeof featured.href === "string" && featured.href.startsWith("/")));
  // a search to draw the home page's cards from, which has to be one that can be run
  assert.equal(typeof flavour.cards, "string");
  if (flavour.cards) {
    const { lower } = await import("../lower.ts");
    const { parse } = await import("../parser.ts");
    assert.doesNotThrow(() => lower(parse(flavour.cards)), flavour.cards);
  }
  // a look the stylesheet knows
  const css = readFileSync(new URL("../../public/app.css", import.meta.url), "utf8");
  assert.ok(flavour.theme === "" || css.includes(`body[data-flavour="${flavour.theme}"]`), flavour.theme);
});

test("the page asks for pages the endpoint will serve", async () => {
  const { MAX_REACH, MAX_RESULTS } = await import("../api.ts");
  const { MAX_PRINTINGS } = await import("../card.ts");
  const { readFileSync } = await import("node:fs");
  const script = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
  const constant = (name: string) => Number((script.match(new RegExp(`const ${name} = (\\d+);`)) ?? [])[1]);
  assert.equal(constant("PAGE_SIZE"), MAX_RESULTS);
  assert.equal(constant("MAX_REACH"), MAX_REACH);
  assert.equal(constant("MAX_LISTED"), MAX_PRINTINGS);
});

test("a held-out set fails only when a query that matched before stops matching", async () => {
  const { againstBaseline } = await import("../conformance.ts");
  const outcome = (query: string, status: "pass" | "fail" | "unsupported") =>
    ({ query, status, scryfall_total: 0, ours_total: 0, missing: [], extra: [], note: "" });
  const baseline = [
    { query: "matched", status: "pass" },
    { query: "differed", status: "fail" },
    { query: "fixed since", status: "fail" },
    { query: "broke", status: "pass" },
  ];
  const result = againstBaseline(
    [outcome("matched", "pass"), outcome("differed", "fail"), outcome("fixed since", "pass"), outcome("broke", "fail"), outcome("new and wrong", "unsupported")],
    baseline,
  );
  // a query the baseline has never seen is held to the same standard as one that matched
  assert.deepEqual(result.regressed, ["broke", "new and wrong"]);
  assert.deepEqual(result.stillDiffer, ["differed"]);
  assert.deepEqual(result.nowMatch, ["fixed since"]);
  assert.deepEqual(againstBaseline([outcome("matched", "pass")], baseline).regressed, []);
});
