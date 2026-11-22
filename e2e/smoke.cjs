// End-to-end smoke test: drives the real page in Chromium at phone and laptop sizes.
//
//   node e2e/smoke.cjs http://127.0.0.1:8000          against a local `npm run dev`
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
      [...document.querySelectorAll("#results img, #card img")]
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

  // A card has its own page, at an address that can be shared.
  const resultsUrl = page.url();
  const shownBefore = (await page.$$("#results .tile")).length;
  await page.click("#results .tile");
  check(await page.isVisible("#card"), `[${name}] tapping a card opens its page`);
  check(!(await page.isVisible("#results")), `[${name}] the card's page replaces the results`);
  const cardUrl = page.url();
  check(/\/card\/[a-z0-9]+\/[^/]+\/consecrated-sphinx$/.test(new URL(cardUrl).pathname), `[${name}] the card has its own address (${new URL(cardUrl).pathname})`);
  check((await page.title()).startsWith("Consecrated Sphinx"), `[${name}] the tab is titled with the card's name`);
  check((await page.textContent("#card-name")) === "Consecrated Sphinx", `[${name}] the page shows the card name`);
  check((await page.getAttribute("#card-link", "href")).startsWith("https://scryfall.com/"), `[${name}] the page links to Scryfall`);
  check(/ \(\w+ #\S+\) · \w+ · \d{4}$/.test(await page.textContent("#card-printing")), `[${name}] the page names the printing shown: set, number, rarity, year`);
  check((await page.textContent("#card-artist")).startsWith("Illustrated by "), `[${name}] the page credits the artist`);
  // What only the card's page has arrives a moment after the card itself.
  await page.waitForFunction(() => !document.getElementById("card-printings").hidden);
  check((await page.textContent("#card-stats")) === "4/6", `[${name}] the page gives power and toughness`);
  const legality = await page.$$eval("#legality-list div", (rows) =>
    Object.fromEntries(rows.map((r) => [r.querySelector("dt").textContent, r.querySelector("dd").textContent]))
  );
  check(legality.Commander === "Legal" && legality.Standard === "Not legal", `[${name}] and legality by format (Commander ${legality.Commander}, Standard ${legality.Standard})`);
  const listed = await page.$$eval("#printings-list a", (links) =>
    links.map((a) => ({ text: a.textContent, current: a.hasAttribute("aria-current"), href: a.getAttribute("href") }))
  );
  check(listed.length >= 8 && listed.filter((p) => p.current).length === 1, `[${name}] and the card's printings, with the one shown marked (${listed.length})`);
  check((listed.find((p) => p.current) || {}).href === new URL(cardUrl).pathname, `[${name}] the marked printing is this page`);
  check(listed.some((p) => /\$\d+\.\d\d$/.test(p.text)), `[${name}] printings carry their prices`);
  check(!(await page.isVisible("#card-prints")), `[${name}] a complete list needs no link to a search`);
  await page.waitForFunction(() => document.getElementById("card-image").naturalWidth > 0);
  const cardOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(cardOverflow <= 0, `[${name}] the card page does not scroll sideways (overflow ${cardOverflow}px)`);
  await shot("3-card");
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("card").hidden);
  check(page.url() === resultsUrl && (await page.$$("#results .tile")).length === shownBefore, `[${name}] Back returns to the same results`);
  await page.goForward();
  await page.waitForFunction(() => !document.getElementById("card").hidden);
  check((await page.textContent("#card-name")) === "Consecrated Sphinx", `[${name}] Forward shows the card again`);
  check((await page.$$("#printings-list a")).length === listed.length, `[${name}] with its printings, kept with the history entry`);

  // The address works on its own: opened fresh, as someone following a shared link would.
  const fresh = await context.newPage();
  await fresh.goto(cardUrl);
  await fresh.waitForFunction(() => !document.getElementById("card").hidden);
  check((await fresh.textContent("#card-name")) === "Consecrated Sphinx", `[${name}] a shared card address opens that card`);
  check((await fresh.textContent("#card-printing")) === (await page.textContent("#card-printing")), `[${name}] and the same printing of it`);
  check(!(await fresh.isVisible("#card-back")), `[${name}] with no "Back to results", as there are none`);
  check((await fresh.textContent("#card-stats")) === "4/6" && (await fresh.$$("#printings-list a")).length === listed.length, `[${name}] and the same stats and printings`);
  // Another printing is one tap away, at its own address; Back returns to the first.
  const marked = (href) => document.querySelector("#printings-list a[aria-current]")?.getAttribute("href") === href;
  const other = listed.find((p) => !p.current);
  await fresh.click(`#printings-list a[href="${other.href}"]`);
  await fresh.waitForFunction(marked, other.href);
  check(new URL(fresh.url()).pathname === other.href, `[${name}] choosing another printing goes to its address (${other.href})`);
  check(
    (await fresh.textContent("#card-name")) === "Consecrated Sphinx" && (await fresh.textContent("#card-printing")) !== (await page.textContent("#card-printing")),
    `[${name}] and shows that printing`
  );
  await fresh.goBack();
  await fresh.waitForFunction(marked, new URL(cardUrl).pathname);
  check((await fresh.textContent("#card-printing")) === (await page.textContent("#card-printing")), `[${name}] Back returns to the first printing`);
  await fresh.fill("#q", "lightning bolt");
  await fresh.press("#q", "Enter");
  await fresh.waitForFunction(() => document.getElementById("status").textContent.startsWith("Card name"));
  check(new URL(fresh.url()).pathname === "/" && new URL(fresh.url()).searchParams.get("q") === "lightning bolt", `[${name}] searching from a card's page goes to the results address`);
  await fresh.goto(`${base}/card/nosuchset/999/nothing`);
  await fresh.waitForFunction(() => document.getElementById("status").textContent.startsWith("No card at this address"));
  check(await fresh.isVisible("#intro"), `[${name}] an address with no card says so and offers the examples`);
  await fresh.close();

  await page.click("#card-back");
  await page.waitForFunction(() => document.getElementById("card").hidden);
  check(page.url() === resultsUrl, `[${name}] "Back to results" returns to the results`);

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

  // Printings: a set search shows each card by its printing in that set, and a card's
  // page lists its printings.
  await search(page, "t:sphinx set:ima");
  check((await page.textContent("#status")).startsWith("Scryfall syntax · 3 cards"), `[${name}] a set search reports cards`);
  check((await page.$$("#results .caption")).length === 0, `[${name}] card results carry no printing captions`);
  await page.click("#results .tile");
  check((await page.textContent("#card-printing")).startsWith("Iconic Masters (IMA #"), `[${name}] the card is shown by its printing in that set`);
  check(new URL(page.url()).pathname.startsWith("/card/ima/"), `[${name}] and its address names that set`);
  await page.waitForFunction(() => !document.getElementById("card-printings").hidden);
  check((await page.getAttribute("#printings-list a[aria-current]", "href")).startsWith("/card/ima/"), `[${name}] and that printing is the one marked in its list`);

  // A card with more printings than the page lists links to a search for all of them.
  await search(page, "!forest");
  await page.click("#results .tile");
  await page.waitForFunction(() => !document.getElementById("card-prints").hidden);
  check((await page.$$("#printings-list a")).length === 60, `[${name}] a basic land lists its newest 60 printings`);
  check(/^All \d+ printings$/.test(await page.textContent("#card-prints")), `[${name}] and offers all of them`);
  check(!(await page.isVisible("#card-stats")), `[${name}] a land has no power and toughness line`);
  await page.click("#card-prints");
  await page.waitForFunction(() => /\d+ printings/.test(document.getElementById("status").textContent));
  check(!(await page.isVisible("#card")), `[${name}] choosing them leaves the card's page`);
  check(new URL(page.url()).searchParams.get("q").endsWith("unique:prints order:released"), `[${name}] and runs a printings search`);
  const tiles = (await page.$$("#results .tile")).length;
  const captions = await page.$$eval("#results .caption", (nodes) => nodes.map((n) => n.textContent));
  check(tiles > 5 && captions.length === tiles, `[${name}] every printing has a caption (${captions.length} of ${tiles})`);
  check(captions.every((c) => /^[A-Z0-9]+ #\S+ · \d{4}/.test(c)), `[${name}] captions give set, number and year`);
  const years = captions.map((c) => Number(c.match(/· (\d{4})/)[1]));
  check(years.every((y, i) => i === 0 || y <= years[i - 1]), `[${name}] printings are listed newest first`);
  await shot("5-printings");
  await page.click("#results .tile");
  await page.waitForFunction(() => !document.getElementById("card-printings").hidden);
  check((await page.$$("#printings-list a[aria-current]")).length === 1, `[${name}] a printing's page marks itself among the printings`);
  await page.waitForFunction(() => document.getElementById("card-image").naturalWidth > 0);
  await shot("6-printing");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("card").hidden);
  check((await page.$$("#results .tile")).length === tiles, `[${name}] Escape returns to the list of printings`);

  // Sorting cards by price shows the printing that decides the order, with its price.
  await search(page, "t:sphinx r:mythic");
  await page.selectOption("#sort", "usd:desc");
  await page.waitForFunction(() => document.querySelectorAll("#results .caption").length > 0);
  const prices = await page.$$eval("#results .caption", (nodes) => nodes.map((n) => Number((n.textContent.match(/\$([\d.]+)/) || [])[1])));
  const priced = prices.filter((p) => !Number.isNaN(p));
  check(priced.length > 5 && priced.every((p, i) => i === 0 || p <= priced[i - 1]), `[${name}] price sort lists the dearest printings first`);

  await search(page, "m=4UU t:sphinx");
  check((await page.textContent("#status")).startsWith("Scryfall syntax"), `[${name}] a mana cost is read as syntax`);
  check((await firstCards(page, 24)).includes("Consecrated Sphinx"), `[${name}] a mana cost search finds Consecrated Sphinx`);

  await search(page, "lightning bolt");
  check((await page.textContent("#status")).startsWith("Card name"), `[${name}] a card name takes the name path`);
  check((await firstCards(page, 1))[0] === "Lightning Bolt", `[${name}] Lightning Bolt is first`);

  await search(page, "lang:ja t:sphinx");
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
