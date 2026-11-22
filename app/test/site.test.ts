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
  // relative paths would resolve under /card/... and fail
  const html = root("public/index.html");
  for (const reference of html.match(/(?:src|href)="[^"]+"/g) ?? []) {
    assert.match(reference, /="(?:\/|https:\/\/)/, reference);
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
    for (const asset of ["app.js", "app.css", "icon.svg"]) assert.equal((await fetch(`${base}/${asset}`)).status, 200, asset);
    // a card's own address is the same page; its script reads the address
    const card = await fetch(`${base}/card/ima/47/consecrated-sphinx`);
    assert.equal(card.status, 200);
    assert.ok((await card.text()).includes('id="card"'));
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/missing.html`)).status, 404);
    const bad = await fetch(`${base}/api/search`);
    assert.equal(bad.status, 400); // answered by the handler without needing a TopK key
  } finally {
    server.close();
  }
});

test("the Scryfall comparison stays inside Scryfall's published rate limit", async () => {
  // /cards/search allows 2 requests a second: https://scryfall.com/docs/api/rate-limits
  const { MIN_INTERVAL_MS } = await import("../conformance.ts");
  assert.ok(MIN_INTERVAL_MS >= 500, `one request every ${MIN_INTERVAL_MS} ms is faster than 2 a second`);
});
