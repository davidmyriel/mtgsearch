// End-to-end smoke test: drives the real page in Chromium at phone and laptop sizes.
//
//   node e2e/smoke.cjs http://127.0.0.1:8000          against a local `mtgsearch serve`
//   node e2e/smoke.cjs https://your-deployment        against a deployed copy
//
// Needs Playwright (`npm i -D playwright && npx playwright install chromium`) and a server
// with a TopK key and an ingested collection. Set SHOTS=<dir> to save screenshots.
const { mkdirSync } = require("node:fs");
const { chromium, devices } = require("playwright");

const base = (process.argv[2] || "http://127.0.0.1:8000").replace(/\/$/, "");
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const failures = [];
function check(condition, message) {
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures.push(message);
}

async function search(page, query) {
  await page.fill("#q", query);
  await page.press("#q", "Enter");
  await page.waitForFunction(() => !document.getElementById("status").textContent.includes("Searching"));
}

async function firstCards(page, n = 3) {
  return page.$$eval("#results img", (imgs, n) => imgs.slice(0, n).map((i) => i.alt), n);
}

async function run(name, contextOptions) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
  const shot = async (label) => {
    if (!shots) return;
    // Let every card image that is on screen finish loading (the rest are lazy).
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#results img, #card[open] img")]
        .filter((img) => {
          const box = img.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight;
        })
        .every((img) => img.complete && img.naturalWidth > 0)
    );
    await page.screenshot({ path: `${shots}/${name}-${label}.png` });
  };

  await page.goto(base);
  check(await page.isVisible("#intro"), `[${name}] home shows example searches`);
  await shot("1-home");

  await search(page, "sphinx that draws two cards");
  check((await firstCards(page, 1))[0] === "Consecrated Sphinx", `[${name}] plain English finds Consecrated Sphinx first`);
  check((await page.textContent("#status")).startsWith("Plain English"), `[${name}] status names the plain-English path`);
  check(new URL(page.url()).searchParams.get("q") === "sphinx that draws two cards", `[${name}] query is in the URL`);
  await page.waitForFunction(() => {
    const img = document.querySelector("#results img");
    return img && img.complete && img.naturalWidth > 0;
  });
  check(true, `[${name}] first card image loaded`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `[${name}] no horizontal scrolling (overflow ${overflow}px)`);
  await shot("2-results");

  await page.click("#results .tile");
  check(await page.isVisible("#card[open]"), `[${name}] tapping a card opens its details`);
  check((await page.textContent("#card-name")) === "Consecrated Sphinx", `[${name}] details show the card name`);
  check((await page.getAttribute("#card-link", "href")).startsWith("https://scryfall.com/"), `[${name}] details link to Scryfall`);
  await page.waitForFunction(() => document.getElementById("card-image").naturalWidth > 0);
  await shot("3-card");
  await page.keyboard.press("Escape");
  check(!(await page.isVisible("#card[open]")), `[${name}] Escape closes the details`);

  await search(page, 'c:u t:sphinx o:"draw two cards"');
  check((await page.textContent("#status")).startsWith("Scryfall syntax · 3 cards"), `[${name}] syntax query reports 3 cards`);
  check((await firstCards(page, 3)).includes("Consecrated Sphinx"), `[${name}] syntax results include Consecrated Sphinx`);

  // Paging and sorting, on a query with more results than one page.
  await search(page, "t:sphinx");
  const total = Number((await page.textContent("#status")).match(/(\d+) cards/)[1]);
  check(total > 48, `[${name}] t:sphinx reports its total (${total})`);
  check((await page.$$("#results .tile")).length === 24, `[${name}] first page shows 24 cards`);
  const firstPage = await firstCards(page, 24);
  await page.click("#more");
  await page.waitForFunction(() => document.querySelectorAll("#results .tile").length === 48);
  check((await page.textContent("#status")).includes("showing 48"), `[${name}] Show more appends a page and updates the count`);
  const both = await firstCards(page, 48);
  check(new Set(both).size === 48 && firstPage.every((n, i) => both[i] === n), `[${name}] the second page continues the first`);
  await page.selectOption("#sort", "cmc:desc");
  await page.waitForFunction((was) => {
    const img = document.querySelector("#results img");
    return img && img.alt !== was && !document.getElementById("status").textContent.includes("Searching");
  }, firstPage[0]);
  check(new URL(page.url()).searchParams.get("order") === "cmc" && new URL(page.url()).searchParams.get("dir") === "desc", `[${name}] the chosen sort is in the URL`);
  check((await page.$$("#results .tile")).length === 24, `[${name}] changing the sort starts again from the first page`);
  await search(page, "sphinx that draws two cards");
  check(!(await page.isVisible("#tools")), `[${name}] no sort menu for results ranked by meaning`);
  check(await page.isVisible("#more"), `[${name}] ranked results can also show more`);

  await search(page, "lightning bolt");
  check((await page.textContent("#status")).startsWith("Card name"), `[${name}] a card name takes the name path`);
  check((await firstCards(page, 1))[0] === "Lightning Bolt", `[${name}] Lightning Bolt is first`);

  await search(page, "r:mythic t:sphinx");
  check((await page.textContent("#status")).startsWith("Not supported yet"), `[${name}] unsupported keyword is explained`);
  const statusTop = await page.$eval("#status", (el) => el.getBoundingClientRect().top);
  check(statusTop < page.viewportSize().height, `[${name}] the explanation is visible without scrolling`);
  await shot("4-unsupported");

  await page.goBack();
  await page.waitForFunction(
    () =>
      document.getElementById("q").value === "lightning bolt" &&
      document.getElementById("status").textContent.startsWith("Card name")
  );
  check((await firstCards(page, 1))[0] === "Lightning Bolt", `[${name}] back button restores the previous search`);

  check(problems.length === 0, `[${name}] no console errors or failed requests${problems.length ? ": " + problems.join(" | ") : ""}`);
  await browser.close();
}

async function main() {
  await run("phone", { ...devices["iPhone 13"] });
  await run("laptop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: shots ? 2 : 1 });
  await run("laptop-dark", { viewport: { width: 1280, height: 800 }, colorScheme: "dark", deviceScaleFactor: shots ? 2 : 1 });
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
