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

/** Choose a value in one of the controls above the results and wait for the new results. */
async function choose(page, selector, value) {
  await page.selectOption(selector, value);
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
  // The cost is drawn as symbols; the brace codes stay in the text for copying and for screen readers' names.
  const cost = await page.$$eval("#card-cost .pip", (pips) => pips.map((p) => p.getAttribute("aria-label")));
  check(cost.join(", ") === "4 generic mana, blue mana, blue mana", `[${name}] the mana cost is drawn as symbols (${cost.join(", ")})`);
  check((await page.textContent("#card-cost")) === "{4}{U}{U}", `[${name}] with the codes still in the text`);
  check((await page.textContent("#card-line")) === "Creature — Sphinx", `[${name}] and the type line on its own`);
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
  await fresh.fill("#q", "bolt");
  await fresh.press("#q", "Enter");
  await fresh.waitForFunction(() => document.getElementById("status").textContent.startsWith("Card name"));
  check(new URL(fresh.url()).pathname === "/" && new URL(fresh.url()).searchParams.get("q") === "bolt", `[${name}] searching from a card's page goes to the results address`);

  // A card's exact name opens that card's page instead of a list.
  const before = fresh.url();
  await fresh.fill("#q", "Consecrated Sphinx");
  await fresh.press("#q", "Enter");
  await fresh.waitForFunction(() => !document.getElementById("card").hidden && location.pathname.startsWith("/card/"));
  check((await fresh.textContent("#card-name")) === "Consecrated Sphinx", `[${name}] typing a card's exact name opens its page (${new URL(fresh.url()).pathname})`);
  check(!(await fresh.isVisible("#card-also")) && !(await fresh.isVisible("#card-back")), `[${name}] with nothing else to offer when no other card matches`);
  check((await fresh.inputValue("#q")) === "Consecrated Sphinx", `[${name}] and what was typed stays in the box`);
  await fresh.goBack();
  await fresh.waitForFunction(() => document.getElementById("card").hidden);
  check(fresh.url() === before, `[${name}] Back goes to where the search was made from, not to a list of one`);
  // The name is exact but other cards contain it too: still the card, with a way to the list.
  await fresh.fill("#q", "lightning bolt");
  await fresh.press("#q", "Enter");
  await fresh.waitForFunction(() => !document.getElementById("card").hidden && location.pathname.startsWith("/card/"));
  check((await fresh.textContent("#card-name")) === "Lightning Bolt", `[${name}] an exact name opens its card even when other cards contain it`);
  check(/also part of the name of \d+ other cards?\. See all \d+$/.test(await fresh.textContent("#card-also")), `[${name}] and says the other cards exist (${await fresh.textContent("#card-also")})`);
  await fresh.waitForFunction(() => !document.getElementById("card-printings").hidden);
  check(await fresh.isVisible("#card-also"), `[${name}] which is still there once the card's details arrive`);
  await fresh.click("#card-also a");
  await fresh.waitForFunction(() => document.getElementById("status").textContent.startsWith("Card name"));
  check(new URL(fresh.url()).searchParams.get("list") === "1" && (await fresh.$$("#results .tile")).length >= 2, `[${name}] the link lists every card with the name in it`);
  check((await firstCards(fresh, 1))[0] === "Lightning Bolt", `[${name}] the exact card first`);
  await choose(fresh, "#sort", "name");
  check(!(await fresh.isVisible("#card")) && new URL(fresh.url()).searchParams.get("list") === "1", `[${name}] and sorting the list keeps it a list`);
  // Punctuation and case do not matter; a name that is only part of a card's does not jump.
  await fresh.fill("#q", "urzas saga");
  await fresh.press("#q", "Enter");
  await fresh.waitForFunction(() => !document.getElementById("card").hidden && location.pathname.startsWith("/card/"));
  check((await fresh.textContent("#card-name")) === "Urza's Saga", `[${name}] "urzas saga" opens Urza's Saga`);
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
  const read = await page.$$eval("#understood li", (items) => items.map((li) => li.textContent));
  check(
    read.join(" | ") === "its colours include blue | the type includes “sphinx” | the text includes “draw two cards”",
    `[${name}] the page says how the query was read (${read.join(" | ")})`
  );

  // Paging and sorting, on a query with more results than one page.
  await search(page, "t:sphinx");
  const total = Number((await page.textContent("#status")).match(/(\d+) cards/)[1]);
  check(total > 60 && total <= 120, `[${name}] t:sphinx reports its total (${total})`);
  check((await page.$$("#results .tile")).length === 60, `[${name}] first page shows 60 cards`);
  check((await page.textContent("#status")).includes("showing 1–60"), `[${name}] the status says which results are showing`);
  check((await page.textContent("#page-now")) === "Page 1 of 2", `[${name}] the pager counts the pages`);
  check((await page.getAttribute("#page-prev", "aria-disabled")) === "true" && (await page.getAttribute("#page-prev", "href")) === null, `[${name}] there is no previous page to go to`);
  const firstPage = await firstCards(page, 60);
  const firstUrl = page.url();
  await page.click("#page-next");
  await page.waitForFunction(() => document.getElementById("page-now").textContent === "Page 2 of 2");
  check(new URL(page.url()).searchParams.get("page") === "2", `[${name}] the page of results is in the address`);
  const secondPage = await firstCards(page, 60);
  check(secondPage.length === total - 60 && secondPage.every((n) => !firstPage.includes(n)), `[${name}] the second page continues the first (${secondPage.length} more)`);
  check((await page.textContent("#status")).includes(`showing 61–${total}`), `[${name}] and says so`);
  check((await page.evaluate(() => window.scrollY)) === 0, `[${name}] a new page starts at the top`);
  check((await page.getAttribute("#page-next", "aria-disabled")) === "true", `[${name}] the last page has no next`);
  // The address is enough: opened fresh, it shows the same page of results.
  const reopened = await context.newPage();
  await reopened.goto(page.url());
  await reopened.waitForFunction(() => document.getElementById("page-now").textContent === "Page 2 of 2");
  check((await firstCards(reopened, 60)).join("|") === secondPage.join("|"), `[${name}] a shared address opens at the same page`);
  await reopened.close();
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("page-now").textContent === "Page 1 of 2");
  check(page.url() === firstUrl && (await firstCards(page, 1))[0] === firstPage[0], `[${name}] Back returns to the first page`);
  await page.click("#page-last");
  await page.waitForFunction(() => document.getElementById("page-now").textContent === "Page 2 of 2");

  // Sort key and direction are separate controls; changing either starts again from page one.
  await choose(page, "#sort", "cmc");
  const cheapest = (await firstCards(page, 1))[0];
  check(new URL(page.url()).searchParams.get("order") === "cmc" && !new URL(page.url()).searchParams.has("page"), `[${name}] the chosen sort is in the address, back on page one`);
  await choose(page, "#dir", "desc");
  check(new URL(page.url()).searchParams.get("order") === "cmc" && new URL(page.url()).searchParams.get("dir") === "desc", `[${name}] and so is the direction`);
  check((await firstCards(page, 1))[0] !== cheapest, `[${name}] descending puts a different card first`);
  check((await page.$$("#results .tile")).length === 60 && (await page.textContent("#page-now")) === "Page 1 of 2", `[${name}] changing the sort starts again from the first page`);

  // The same results as a table: a row for each, with three prices. The choice is in the address.
  const amounts = (cells) => cells.filter((c) => c !== "—").map((c) => Number(c.replace(/[^\d.]/g, "")));
  await search(page, "t:sphinx");
  await page.click('#view-switch button[data-as="table"]');
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 60);
  check(new URL(page.url()).searchParams.get("as") === "table" && !(await page.isVisible("#results")), `[${name}] choosing Table shows the results as rows, and the address says so`);
  const firstRow = await page.$$eval("#rows tr:first-child td", (cells) => cells.map((c) => c.textContent));
  check(firstRow.length === 9 && firstRow[0].length > 0 && /^[A-Z0-9]+ #\S+$/.test(firstRow[3]), `[${name}] a row has name, cost, type, set, rarity, artist and three prices (${firstRow[0]}, ${firstRow[3]})`);
  check((await page.$$("#rows tr:first-child td.t-cost .pip")).length > 0, `[${name}] with the cost drawn as symbols`);
  const tableOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(tableOverflow <= 0, `[${name}] the table does not scroll sideways (overflow ${tableOverflow}px)`);
  if (contextOptions.isMobile) {
    // A phone has no room for headings: the table is a list, sorted from the menus.
    check(!(await page.isVisible("#table thead")), `[${name}] on a phone the table is a list without headings`);
    await choose(page, "#sort", "eur");
    await choose(page, "#dir", "desc");
    check((await page.isVisible("#rows tr:first-child td.t-eur")) && !(await page.isVisible("#rows tr:first-child td.t-usd")), `[${name}] showing the price the list is sorted by`);
  } else {
    // A heading sorts by its column; choosing it again turns the order round.
    await page.click('#table th[data-order="usd"] a');
    await page.waitForFunction(() => document.querySelector('#table th[data-order="usd"]').getAttribute("aria-sort") === "ascending");
    const rising = amounts(await page.$$eval("#rows td.t-usd", (cells) => cells.map((c) => c.textContent)));
    check(new URL(page.url()).searchParams.get("order") === "usd" && rising.length > 5 && rising.every((p, i) => i === 0 || p >= rising[i - 1]), `[${name}] a heading sorts by its column, cheapest first`);
    await page.click('#table th[data-order="usd"] a');
    await page.waitForFunction(() => document.querySelector('#table th[data-order="usd"]').getAttribute("aria-sort") === "descending");
    const falling = amounts(await page.$$eval("#rows td.t-usd", (cells) => cells.map((c) => c.textContent)));
    check(new URL(page.url()).searchParams.get("dir") === "desc" && falling.every((p, i) => i === 0 || p <= falling[i - 1]), `[${name}] choosing it again turns the order round`);
    check((await page.inputValue("#sort")) === "usd" && (await page.inputValue("#dir")) === "desc", `[${name}] and the menus agree with the headings`);
    // The card under the pointer is shown beside it.
    await page.hover("#rows tr:nth-child(2) td.t-type");
    await page.waitForFunction(() => {
      const img = document.getElementById("preview");
      return !img.hidden && img.complete && img.naturalWidth > 0;
    });
    check(true, `[${name}] hovering a row shows that card's picture`);
  }
  // A row opens its card; Back returns to the table as it was.
  const rowName = await page.textContent("#rows tr:nth-child(3) td.t-name");
  const tableUrl = page.url();
  await page.click("#rows tr:nth-child(3) td.t-type");
  await page.waitForFunction(() => !document.getElementById("card").hidden);
  check((await page.textContent("#card-name")) === rowName && (await page.isVisible("#card-back")), `[${name}] a row opens its card (${rowName}), with a way back`);
  check(!(await page.isVisible("#table")) && !(await page.isVisible("#preview")), `[${name}] and the table is out of the way`);
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("card").hidden);
  check(page.url() === tableUrl && (await page.$$("#rows tr")).length === 60, `[${name}] Back returns to the table`);
  // The next search stays a table; Images goes back to pictures.
  await search(page, "t:dragon");
  check((await page.$$("#rows tr")).length === 60 && new URL(page.url()).searchParams.get("as") === "table", `[${name}] the next search is a table too`);
  await page.click('#view-switch button[data-as=""]');
  await page.waitForFunction(() => document.querySelectorAll("#results .tile").length === 60);
  check(!new URL(page.url()).searchParams.has("as") && !(await page.isVisible("#table")), `[${name}] choosing Images goes back to pictures`);

  // Cards, printings or illustrations: the "Show" control, or `unique:` in the query.
  await search(page, "t:sphinx c:w mv<=4");
  const cardCount = Number(((await page.textContent("#status")).match(/(\d+) cards/) || [])[1]);
  check(cardCount > 1 && cardCount < 60, `[${name}] a search with a handful of cards (${cardCount})`);
  check(!(await page.isVisible("#pager")), `[${name}] one page of results needs no pager`);
  await choose(page, "#unique", "prints");
  const printCount = Number(((await page.textContent("#status")).match(/(\d+) printings/) || [])[1]);
  check(printCount > cardCount && new URL(page.url()).searchParams.get("unique") === "prints", `[${name}] choosing printings lists them (${printCount}), and the address says so`);
  check((await page.$$("#results .caption")).length === Math.min(printCount, 60), `[${name}] each with its caption`);
  await choose(page, "#unique", "art");
  const artCount = Number(((await page.textContent("#status")).match(/(\d+) illustrations/) || [])[1]);
  check(artCount >= cardCount && artCount <= printCount, `[${name}] choosing illustrations lists those (${artCount})`);
  await search(page, '!"consecrated sphinx" unique:prints');
  check((await page.inputValue("#unique")) === "prints", `[${name}] the control shows what the query itself asked for`);
  // A search that finds one card and nothing else goes to that card, as an exact name does.
  await search(page, '!"consecrated sphinx"');
  await page.waitForFunction(() => !document.getElementById("card").hidden && location.pathname.startsWith("/card/"));
  check((await page.textContent("#card-name")) === "Consecrated Sphinx", `[${name}] a search that finds exactly one card opens it`);

  // Results ranked by meaning have no total: no sort controls, and a next page while there is one.
  await search(page, "sphinx that draws two cards");
  check(!(await page.isVisible("#sorters")) && (await page.isVisible("#view-switch")), `[${name}] no sort controls for results ranked by meaning, only the choice of pictures or table`);
  check(!(await page.isVisible("#understood")), `[${name}] and no reading of it as syntax`);
  check((await page.textContent("#page-now")) === "Page 1" && !(await page.isVisible("#page-last")), `[${name}] ranked results have pages but no last page`);
  await page.click("#page-next");
  await page.waitForFunction(() => document.getElementById("page-now").textContent === "Page 2");
  check((await page.textContent("#status")).includes("results 61–"), `[${name}] the second page of ranked results says which they are`);
  check((await firstCards(page, 1))[0] !== "Consecrated Sphinx", `[${name}] and does not repeat the first`);
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("page-now").textContent === "Page 1");

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
  // (An exact name finds one card, so the search goes straight to its page.)
  await search(page, "!forest");
  await page.waitForFunction(() => !document.getElementById("card").hidden && !document.getElementById("card-prints").hidden);
  check((await page.textContent("#card-name")) === "Forest", `[${name}] !forest opens Forest`);
  check((await page.$$("#printings-list a")).length === 60, `[${name}] a basic land lists its newest 60 printings`);
  check(/^All \d+ printings$/.test(await page.textContent("#card-prints")), `[${name}] and offers all of them`);
  check(!(await page.isVisible("#card-stats")), `[${name}] a land has no power and toughness line`);
  const inRules = await page.$$eval("#card-rules .pip", (pips) => pips.map((p) => p.getAttribute("aria-label")));
  check(inRules.join(", ") === "tap, green mana", `[${name}] symbols in the rules text are drawn too (${inRules.join(", ")})`);
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
  await choose(page, "#sort", "usd");
  await choose(page, "#dir", "desc");
  check((await page.$$("#results .caption")).length > 0, `[${name}] a price sort captions the cards with the printing that decides it`);
  const prices = await page.$$eval("#results .caption", (nodes) => nodes.map((n) => Number(((n.textContent.match(/\$([\d,.]+)/) || [])[1] || "").replaceAll(",", "") || NaN)));
  const priced = prices.filter((p) => !Number.isNaN(p));
  check(priced.length > 5 && priced.every((p, i) => i === 0 || p <= priced[i - 1]), `[${name}] price sort lists the dearest printings first`);

  await search(page, "m=4UU t:sphinx");
  check((await page.textContent("#status")).startsWith("Scryfall syntax"), `[${name}] a mana cost is read as syntax`);
  check((await firstCards(page, 24)).includes("Consecrated Sphinx"), `[${name}] a mana cost search finds Consecrated Sphinx`);

  // Words that are part of names, not a whole one, list the cards, most played first.
  await search(page, "lightning bol");
  check((await page.textContent("#status")).startsWith("Card name"), `[${name}] part of a name takes the name path and lists the cards`);
  check((await firstCards(page, 1))[0] === "Lightning Bolt", `[${name}] Lightning Bolt is first`);
  check((await page.textContent("#understood")) === "the name includes “lightning” and “bol”", `[${name}] a name search says where it looked`);

  // A term that cannot be used is left out, the page says which and why, and the rest runs.
  await search(page, "lang:ja t:sphinx");
  check((await page.textContent("#status")).startsWith(`Scryfall syntax · ${total} cards`), `[${name}] the rest of a query runs without the unusable term`);
  check((await page.textContent("#ignored")) === "lang:ja was left out: 'lang:' is not supported yet.", `[${name}] and the page says what was left out and why`);
  check((await page.textContent("#understood")) === "the type includes “sphinx”", `[${name}] and how the rest was read`);
  const warningTop = await page.$eval("#ignored", (el) => el.getBoundingClientRect().top);
  check(warningTop < page.viewportSize().height, `[${name}] the warning is visible without scrolling`);
  await shot("4-left-out");
  await search(page, "t:sphinx");
  check(!(await page.isVisible("#ignored")), `[${name}] the warning goes when the next search has nothing left out`);

  // A search that finds nothing says so in the page, with how it was read and what to try.
  await search(page, "t:sphinx c:r mv=1 pow>=9");
  check((await page.textContent("#status")).startsWith("No cards matched"), `[${name}] a search with no results says so`);
  check((await page.isVisible("#empty")) && (await page.textContent("#empty-detail")).includes("every condition"), `[${name}] and suggests what to change`);
  check((await page.$$("#understood li")).length === 4 && (await page.$$("#results .tile")).length === 0, `[${name}] with the conditions it looked for and no stale cards`);
  await search(page, "t:sphinx");
  check(!(await page.isVisible("#empty")), `[${name}] the message goes when the next search finds cards`);

  // Nothing left to search for: refused, with the reason and the help in view.
  await search(page, "lang:ja");
  check((await page.textContent("#status")).startsWith("Nothing here could be used · 'lang:' is not supported yet"), `[${name}] a query with nothing usable is explained`);
  check((await page.isVisible("#intro")) && (await page.$$("#results .tile")).length === 0, `[${name}] with the examples and no stale results`);
  const statusTop = await page.$eval("#status", (el) => el.getBoundingClientRect().top);
  check(statusTop < page.viewportSize().height, `[${name}] the explanation is visible without scrolling`);

  // The header is on every view: a random card from the results, and Back to them.
  await search(page, "t:sphinx");
  const beforeRandom = page.url();
  await page.click("#nav-random");
  await page.waitForFunction(() => !document.getElementById("card").hidden && location.pathname.startsWith("/card/"));
  check((await page.textContent("#card-name")).length > 0, `[${name}] "Random card" opens a card at its own address (${new URL(page.url()).pathname})`);
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("card").hidden);
  check(page.url() === beforeRandom && (await page.$$("#results .tile")).length === 60, `[${name}] and Back returns to the results`);
  // /random opened directly lands on a card too, and the address it leaves can be shared.
  const lucky = await context.newPage();
  await lucky.goto(`${base}/random`);
  await lucky.waitForFunction(() => !document.getElementById("card").hidden && location.pathname.startsWith("/card/"));
  check(await lucky.isVisible("#card-image"), `[${name}] /random opened directly shows a card`);

  // The syntax guide is a page of its own; its examples run.
  await lucky.goto(`${base}/syntax`);
  check((await lucky.textContent("h1")) === "Syntax guide" && (await lucky.$$("a.example")).length >= 40, `[${name}] the syntax guide lists its examples`);
  const guideOverflow = await lucky.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(guideOverflow <= 0, `[${name}] the guide does not scroll sideways (overflow ${guideOverflow}px)`);
  await lucky.click('a.example[href="/?q=t%3Asphinx"]');
  await lucky.waitForFunction(() => document.getElementById("status").textContent.startsWith("Scryfall syntax"));
  check((await lucky.$$("#results .tile")).length === 60, `[${name}] an example in the guide runs the search`);
  await lucky.goto(`${base}/syntax`);
  await lucky.fill("#q", "sphinx");
  await lucky.press("#q", "Enter");
  await lucky.waitForFunction(() => document.getElementById("status") && document.getElementById("status").textContent.startsWith("Card name"));
  check(new URL(lucky.url()).searchParams.get("q") === "sphinx", `[${name}] the guide's own search box searches`);
  await lucky.close();

  await search(page, "t:sphinx mv=6");
  const sixes = await firstCards(page, 1);
  await search(page, "lang:ja");
  await page.goBack();
  await page.waitForFunction(
    () =>
      document.getElementById("q").value === "t:sphinx mv=6" &&
      document.getElementById("status").textContent.startsWith("Scryfall syntax")
  );
  check((await firstCards(page, 1))[0] === sixes[0], `[${name}] back button restores the previous search`);

  check(problems.length === 0, `[${name}] no console errors or failed requests${problems.length ? ": " + problems.join(" | ") : ""}`);
  await browser.close();
}

/**
 * The smallest phones, 320 pixels wide. Nothing may make the page wider than the screen,
 * whatever fonts the device has: a header that fits at 390 with one set of fonts can overflow
 * with another, and 320 leaves room for that difference.
 */
async function narrow() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  const visits = [
    ["the home page", "/", null],
    ["results", "/?q=t%3Asphinx", () => document.querySelectorAll("#results .tile").length > 0],
    ["a card's page", "/card/ima/47/consecrated-sphinx", () => !document.getElementById("card-printings").hidden],
    ["the syntax guide", "/syntax", null],
    ["results as a table", "/?q=t%3Asphinx&as=table", () => document.querySelectorAll("#rows tr").length > 0],
  ];
  for (const [what, path, ready] of visits) {
    await page.goto(base + path);
    if (ready) await page.waitForFunction(ready);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `[320 wide] ${what} does not scroll sideways (overflow ${overflow}px)`);
  }
  await browser.close();
}

async function main() {
  await narrow();
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
