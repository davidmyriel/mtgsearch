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

test("the search bar shows no button, and a card's page no link back to the results", () => {
  for (const page of ["public/index.html", "public/syntax.html", "public/404.html"]) {
    const html = root(page);
    // Enter searches; the one button is out of sight and out of the tab order
    assert.deepEqual(html.match(/<button type="submit"[^>]*>/g), ['<button type="submit" class="sr-only" tabindex="-1">'], page);
    assert.ok(html.includes('enterkeyhint="search"'), `${page}: a phone's keyboard should offer its search key`);
  }
  assert.ok(!root("public/index.html").includes("Back to results") && !root("public/app.js").includes("card-back"));
  // nothing styles a button in the bar back into view
  assert.ok(!/\.search button/.test(root("public/app.css")));
});

test("the site shows one name on every page, in TopK's blocks, and no sentence under it", () => {
  const still = /<a class="wordmark" href="\/"><img src="\/wordmark\.svg" alt="([^"]+)" width="334" height="56"><\/a>/;
  // the home page's builds itself, and stands still for anyone who asked for less motion
  const moving =
    /<a class="wordmark" href="\/"><picture><source media="\(prefers-reduced-motion: reduce\)" srcset="\/wordmark\.svg"><img src="\/wordmark-appear\.svg" alt="([^"]+)" width="334" height="56"><\/picture><\/a>/;
  const name = (root("public/index.html").match(moving) ?? [])[1];
  assert.equal(name, "TutorK");
  assert.ok(root("public/index.html").includes(`<title>${name}</title>`));
  for (const page of ["public/syntax.html", "public/404.html"]) {
    const html = root(page);
    assert.equal((html.match(still) ?? [])[1], name, page);
    assert.match(html, new RegExp(`<title>[^<]+ · ${name}</title>`), page);
  }
  // the script titles the tab with the same name
  assert.ok(root("public/app.js").includes(`const SITE = "${name}";`));
  assert.ok(!root("public/index.html").includes("tagline") && !root("public/app.css").includes("tagline"));
  // the picture: six letters of squares, the last of them in TopK's orange and the rest light
  const picture = root("public/wordmark.svg");
  const squares = (colour: string) => ((picture.match(new RegExp(`<path fill="${colour}" d="([^"]+)"`)) ?? [])[1] ?? "").split("z").length - 1;
  assert.equal(squares("#fe5000"), 10, "K is ten squares, as in TopK's icon");
  assert.equal(squares("#f4efe6"), 9 + 12 + 9 + 14 + 14, "T, U, T, O and R");
  assert.match(picture, /viewBox="0 0 3340 560"/);
});

test("the empty search box shows something to try: a card described in plain words", async () => {
  const { parse } = await import("../parser.ts");
  const script = root("public/app.js");
  const examples: string[] = JSON.parse((script.match(/const EXAMPLES = (\[[^\]]+\]);/) ?? [])[1] ?? "[]");
  assert.deepEqual(examples, ["sphinx that draws two cards", "dwarf that destroys lands", "tithe alternative", "blue land destruction"]);
  assert.ok(script.includes("input.placeholder = `Try: ${example}`;"));
  for (const example of examples) {
    // plain words: nothing in it is Scryfall syntax, so the search reads it by meaning
    assert.ok(!/[:=<>!"()]/.test(example), example);
    assert.doesNotThrow(() => parse(example), example);
  }
  // before the script runs, and on the pages that have no script, the box shows the first of them
  for (const page of ["public/index.html", "public/syntax.html", "public/404.html"]) {
    assert.ok(root(page).includes(`placeholder="Try: ${examples[0]}"`), page);
  }
});

test("the moving name is the still one, its squares appearing from left to right", () => {
  // the still picture's squares, by colour
  const still = new Set<string>();
  for (const [, colour, d] of root("public/wordmark.svg").matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"/g)) {
    for (const [, x, y] of d.matchAll(/M(\d+) (\d+)h100v100h-100z/g)) still.add(`${x},${y},${colour}`);
  }
  // the moving picture's, each with the moment it starts to show
  const moving = [...root("public/wordmark-appear.svg").matchAll(
    /<rect x="(\d+)" y="(\d+)" width="100" height="100" fill="(#[0-9a-f]{6})"><animate attributeName="opacity" values="0;0;1" keyTimes="0;([\d.]+);1" dur="([\d.]+)s" fill="freeze"\/><\/rect>/g,
  )].map(([, x, y, colour, wait, total]) => ({ key: `${x},${y},${colour}`, x: Number(x), starts: Number(wait) * Number(total), ends: Number(total) }));
  assert.equal(moving.length, 68);
  assert.deepEqual(new Set(moving.map((square) => square.key)), still);
  // six letters, left to right: each begins to appear after the one before it has begun
  const letters = [0, 648, 1181, 1829, 2362, 2895].map((left, index, lefts) => moving.filter((square) => square.x >= left && square.x < (lefts[index + 1] ?? Infinity)));
  const first = letters.map((letter) => Math.min(...letter.map((square) => square.starts)));
  assert.deepEqual([...first].sort((a, b) => a - b), first);
  assert.ok(first[0] < 0.01 && new Set(first).size === 6, `letters begin at ${first.map((t) => t.toFixed(2)).join(", ")}`);
  // within a letter too, a square further right never starts more than a blink earlier
  for (const a of moving) for (const b of moving) if (b.x > a.x) assert.ok(b.starts > a.starts - 0.06, `${b.key} before ${a.key}`);
  // and it is over quickly
  assert.ok(Math.max(...moving.map((square) => square.ends)) <= 1.5);
  // a square shows from the start in a browser that does not animate: nothing hides it but the animation
  assert.ok(!/opacity="0"/.test(root("public/wordmark-appear.svg")));
});

test("the home page's background has no hard edge: gradients, and a grain the page can load", () => {
  const css = root("public/app.css");
  const home = css.slice(css.indexOf("/* Home: a fine grain"), css.indexOf(".masthead-inner {"));
  assert.ok(home.includes("radial-gradient(") && home.includes("repeating-radial-gradient("));
  assert.ok(!home.includes("box-shadow") && !home.includes("linear-gradient"), "steps and hairlines are edges");
  assert.ok(home.includes('url("/grain.svg")') && root("public/grain.svg").includes("feTurbulence"));
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
