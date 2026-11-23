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

/** The examples the empty search box draws from, read out of the script the page itself runs. */
async function examplesOffered(page) {
  return page.evaluate(async () => {
    const script = await (await fetch("/app.js")).text();
    const list = (script.match(/const EXAMPLES = \[([^\]]+)\];/) || [])[1] || "";
    return [...list.matchAll(/"([^"]+)"/g)].map((found) => found[1]);
  });
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

  // The first screen: the search bar at its centre, what is new, and a few cards at the bottom edge.
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll("#home-cards img")].filter((img) => img.getBoundingClientRect().width > 0);
    return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0);
  });
  const home = await page.evaluate(() => {
    const box = (element) => element.getBoundingClientRect();
    // the card itself, not its slot in the row: the slot is only as tall as what shows
    const cards = [...document.querySelectorAll("#home-cards a")].filter((a) => box(a).width > 0).map((a) => box(a));
    const bar = box(document.getElementById("search"));
    return {
      hero: box(document.querySelector(".masthead")).height,
      window: innerHeight,
      barCentre: Math.abs((bar.left + bar.right) / 2 - innerWidth / 2),
      barHeight: bar.height,
      cards: cards.length,
      // the fan is cut off by the bottom of the first screen: every card runs past that edge
      cutOff:
        getComputedStyle(document.getElementById("home-cards")).overflow === "hidden" &&
        cards.every((card) => card.top < innerHeight && card.bottom > box(document.getElementById("home-cards")).bottom),
      fanBottom: box(document.getElementById("home-cards")).bottom,
      theme: document.getElementById("home-cards").dataset.query,
      themeLabel: document.getElementById("home-cards").getAttribute("aria-label"),
      names: [...document.querySelectorAll("#home-cards img")].map((img) => img.alt),
      pageBelow: Boolean(document.getElementById("main").offsetHeight),
      news: [...document.querySelectorAll("#news li")].map((li) => li.textContent),
      hint: document.getElementById("q").placeholder,
      focused: document.activeElement ? document.activeElement.id : "",
    };
  });
  check(home.hero >= home.window - 1, `[${name}] the first screen is the search and nothing below it (${Math.round(home.hero)} of ${home.window}px)`);
  check(home.barCentre <= 2 && home.barHeight >= 60, `[${name}] the search bar is in the middle and thick (${Math.round(home.barHeight)}px)`);
  check(home.news.length >= 2 && home.news.every((line) => /^(New|Preview)\S/.test(line)), `[${name}] what is new is listed under it (${home.news.length} lines)`);
  // Each line says what state the set is in, and one still to come how many cards are shown and when it is out.
  check(
    home.news.every((line) => (line.startsWith("Preview") ? /(first look|previews) \d+ cards? so far, out \d+ \w+$/ : /(out now since \d+ \w+|released in \w+)$/).test(line.replace(/\s+/g, " "))),
    `[${name}] and each says where the set stands (${home.news.map((line) => line.replace(/\s+/g, " ").replace(/^(New|Preview)/, "")).join("; ")})`,
  );
  check(home.cards === 7, `[${name}] a fan of cards sits along the bottom (${home.cards})`);
  // The seven are found by the example the empty search box is showing: each is among the
  // first results of that search, and its closest result is in the middle of the fan.
  const common = await page.evaluate(async ({ query, names }) => {
    if (!query) return { query, found: 0, first: "" };
    const response = await fetch(`/api/search?${new URLSearchParams({ q: query, k: "14" })}`);
    const results = ((await response.json()).hits || []).map((hit) => hit.name);
    return { query, found: names.filter((cardName) => results.includes(cardName)).length, first: results[0] };
  }, { query: home.theme, names: home.names });
  check(home.hint === `Try: ${home.theme}` && home.themeLabel === `A few cards: ${home.theme}`, `[${name}] the cards go with the example in the search box (${home.hint})`);
  check(common.found === 7 && home.names[3] === common.first, `[${name}] and are what that search finds, the closest in the middle (${common.first})`);
  check(home.cutOff && Math.abs(home.fanBottom - home.window) <= 4, `[${name}] cut off by the bottom edge of the first screen`);
  check(!home.pageBelow, `[${name}] and nothing but the footer follows: no search instructions`);
  if (!contextOptions.isMobile) check(home.focused === "q", `[${name}] the search box has the focus on arrival`);
  // The mark is a disc inside the bar at its left end, and there is no button: Enter searches.
  // The background is drawn from the bar: light that gathers on it, and soft rings around it.
  const lookAtBar = () => page.evaluate(() => {
    const box = (element) => element.getBoundingClientRect();
    const form = document.getElementById("search");
    const image = form.querySelector(".mark img");
    const [disc, bar, field, button] = [box(image), box(form), box(document.getElementById("q")), box(form.querySelector("button"))];
    // how far the middle of a layer drawn behind the bar is from the middle of the bar
    const offCentre = (pseudo) => {
      const style = getComputedStyle(form, pseudo);
      if (style.content === "none" || !style.backgroundImage.includes("radial-gradient")) return null;
      const px = (value) => parseFloat(value) || 0;
      const across = px(style.left) + px(style.marginLeft) + px(style.width) / 2 - form.clientWidth / 2;
      const down = px(style.top) + px(style.marginTop) + px(style.height) / 2 - form.clientHeight / 2;
      return Math.max(Math.abs(across), Math.abs(down));
    };
    return {
      drawn: image.complete && image.naturalWidth > 0,
      size: disc.width,
      round: Math.abs(disc.width - disc.height) < 0.5,
      inside: disc.left >= bar.left && disc.right <= field.left + 1 && disc.top >= bar.top && disc.bottom <= bar.bottom,
      // the box runs from the mark to the bar's right end: nothing to press takes its place
      noButton: button.width <= 1 && button.height <= 1 && bar.right - field.right < 12,
      light: offCentre("::before"),
      rings: offCentre("::after"),
    };
  });
  // The name is a picture of block letters above the bar, and the tab carries the same name.
  const title = await page.evaluate(() => {
    const image = document.querySelector(".wordmark img");
    const [name, bar] = [image.getBoundingClientRect(), document.getElementById("search").getBoundingClientRect()];
    return {
      name: image.alt,
      drawn: image.complete && image.naturalWidth > 0,
      above: name.bottom <= bar.top && name.left >= 0 && name.right <= innerWidth,
      centred: Math.abs((name.left + name.right) / 2 - innerWidth / 2) <= 2,
      tab: document.title,
      picture: new URL(image.currentSrc).pathname,
      hint: document.getElementById("q").placeholder,
      // whose search it is: one line between the name and the bar, linking to TopK
      powered: (() => {
        const line = document.querySelector(".powered");
        const box = line.getBoundingClientRect();
        return { says: line.textContent, link: line.querySelector("a").href, between: box.top >= name.bottom && box.bottom <= bar.top && box.height > 0 };
      })(),
    };
  });
  check(title.powered.says === "Powered by TopK AI search" && title.powered.link === "https://topk.io/" && title.powered.between, `[${name}] under the name it says whose search this is (${title.powered.says})`);
  check(title.drawn && title.above && title.centred && title.name === "TutorK" && title.tab === "TutorK", `[${name}] the name stands above the bar in block letters (${title.name}), and titles the tab`);
  check(title.picture === "/wordmark-appear.svg", `[${name}] on arrival at the home page the name builds itself (${title.picture})`);
  // The empty box says what to do: try something players look for, said in plain words. The
  // list is the one in the page's own script.
  const examples = await examplesOffered(page);
  const shownExample = title.hint.replace(/^Try: /, "");
  check(examples.length >= 20 && title.hint.startsWith("Try: ") && examples.includes(shownExample), `[${name}] the empty box shows something to try, one of ${examples.length} ("${title.hint}")`);
  // Whichever is drawn, all of it shows in the box.
  const tooLong = await page.evaluate((examples) => {
    const box = document.getElementById("q");
    const [style, hint] = [getComputedStyle(box), getComputedStyle(box, "::placeholder")];
    const pen = document.createElement("canvas").getContext("2d");
    pen.font = `${hint.fontWeight} ${hint.fontSize} ${hint.fontFamily}`;
    const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return examples.filter((example) => pen.measureText(`Try: ${example}`).width > room);
  }, examples);
  check(tooLong.length === 0, `[${name}] every example fits in the box (${tooLong.join(", ") || `all ${examples.length}`})`);
  const mark = await lookAtBar();
  check(mark.drawn && mark.round && mark.inside, `[${name}] the mark is a disc inside the search bar, at its left end (${Math.round(mark.size)}px)`);
  check(mark.noButton, `[${name}] the bar has no button: the box fills it, and Enter searches`);
  check(mark.light !== null && mark.light <= 1 && mark.rings !== null && mark.rings <= 1, `[${name}] the background's light and rings are centred on the bar (off by ${mark.light}px and ${mark.rings}px)`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.click("#search .mark");
  check((await page.evaluate(() => document.activeElement && document.activeElement.id)) === "q", `[${name}] pressing the mark puts the cursor in the box`);
  await shot("1-home");
  // Under the bar: four searches people often need, in players' words. The syntax guide is in
  // the footer and a random card is not offered here.
  const under = await page.evaluate(() => {
    const box = (element) => element.getBoundingClientRect();
    const bar = box(document.getElementById("search"));
    const row = box(document.querySelector(".needs"));
    const links = [...document.querySelectorAll(".needs a")];
    return {
      words: links.map((link) => link.textContent),
      // the row is one line: the ones that fit are shown whole, and the rest are out of sight
      shown: links.filter((link) => box(link).top < row.bottom - 1).map((link) => link.textContent),
      whole: links.filter((link) => box(link).top < row.bottom - 1).every((link) => box(link).left >= 0 && box(link).right <= innerWidth && box(link).bottom <= row.bottom + 1),
      below: links.every((link) => box(link).top >= bar.bottom && box(link).height > 0),
      headerLinks: [...document.querySelectorAll("header .nav a")].filter((link) => box(link).height > 0).length,
      guideInHeader: document.querySelectorAll('header a[href="/syntax"]').length,
      guideInFooter: document.querySelectorAll('footer a[href="/syntax"]').length,
    };
  });
  // Four of nine, a different draw on each visit. Each is a players' word, with a card it has to find.
  const staples = {
    "Mana rocks": "Sol Ring", "Bounce spells": "Cyclonic Rift", "Blink effects": "Ephemerate", "Board wipes": "Blasphemous Act",
    Ramp: "Arcane Signet", "Card draw": "Rhystic Study", Removal: "Swords to Plowshares", Counterspells: "Counterspell", Tutors: "Demonic Tutor",
  };
  check(under.words.length === 4 && new Set(under.words).size === 4 && under.words.every((words) => words in staples) && under.below, `[${name}] under the bar are four searches people often need (${under.words.join(", ")})`);
  check(under.shown.length >= 2 && under.whole, `[${name}] in one row, as many as fit and each one whole (${under.shown.length} of 4)`);
  check(under.headerLinks === 0 && under.guideInHeader === 0 && under.guideInFooter === 1, `[${name}] and neither the syntax guide nor a random card: the guide is in the footer`);
  // Another visit draws again: of five more, at least one differs from this one.
  const again = await context.newPage();
  const draws = new Set([under.words.join(", ")]);
  for (let visit = 0; visit < 5; visit++) {
    await again.goto(base);
    draws.add((await again.$$eval(".needs a", (links) => links.map((link) => link.textContent))).join(", "));
  }
  await again.close();
  check(draws.size >= 2, `[${name}] and a different four on another visit (${draws.size} different draws in 6 visits)`);
  // Each finds the cards players mean by it, most played first.
  for (const words of under.shown) {
    const staple = staples[words];
    await page.click(`.needs a:has-text("${words}")`);
    await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Players' words"));
    const found = await firstCards(page, 6);
    check(found.includes(staple) && new URL(page.url()).searchParams.get("q") === words.toLowerCase(), `[${name}] "${words}" finds ${found.slice(0, 3).join(", ")}`);
    if (words === under.shown[0]) {
      const said = await page.textContent("#status");
      check(said.startsWith("Players' words · ") && said.includes(" cards, showing 1–60, the same as otag:"), `[${name}] and says how it was read (${said})`);
      check((await page.isVisible("#nav-random")) && (await page.$$('header a[href="/syntax"]')).length === 0, `[${name}] with a random card offered in the header, where the results are`);
    }
    await page.goBack();
    await page.waitForFunction(() => !document.body.classList.contains("searched"));
  }
  // A line of news runs its search; a card opens its page; Back returns home each time.
  await page.click("#news li:last-child a");
  await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Scryfall syntax"));
  check(new URL(page.url()).searchParams.get("q").startsWith("set:"), `[${name}] a line of news searches for that set (${new URL(page.url()).searchParams.get("q")})`);
  await page.goBack();
  await page.waitForFunction(() => !document.body.classList.contains("searched"));
  const stripHref = await page.getAttribute("#home-cards li:nth-child(4) a", "href");
  await page.click("#home-cards li:nth-child(4) a");
  await page.waitForFunction(() => !document.getElementById("card").hidden);
  check(new URL(page.url()).pathname === stripHref && (await page.textContent("#card-name")).length > 0, `[${name}] a card on the home page opens its page (${stripHref})`);
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("card").hidden && !document.body.classList.contains("searched"));
  check((await page.getAttribute("#home-cards li:nth-child(4) a", "href")) === stripHref, `[${name}] and Back returns to the same home page`);

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
  const barMark = await lookAtBar();
  check(!(await page.isVisible(".powered")) && (await page.textContent("footer")).replace(/\s+/g, " ").includes("powered by TopK AI search"), `[${name}] as a bar the header drops that line, and the footer still says it`);
  check(barMark.drawn && barMark.round && barMark.inside && barMark.size < mark.size && barMark.noButton && barMark.light === null && barMark.rings === null, `[${name}] as a bar the header keeps the mark, smaller, with no button and nothing drawn behind it (${Math.round(barMark.size)}px)`);
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
  const stillName = await fresh.$eval(".wordmark img", (image) => new URL(image.currentSrc).pathname);
  check(stillName === "/wordmark.svg", `[${name}] where the name stands still in the header (${stillName})`);
  check((await fresh.textContent("#card-printing")) === (await page.textContent("#card-printing")), `[${name}] and the same printing of it`);
  check((await fresh.$("#card-back")) === null && !(await fresh.isVisible("text=Back to results")), `[${name}] a card's page has no link back: the browser's Back and the search bar do that`);
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
  check(!(await fresh.isVisible("#card-also")), `[${name}] with nothing else to offer when no other card matches`);
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
  check((await fresh.isVisible("#empty")) && (await fresh.textContent("#empty-title")) === "No card at this address", `[${name}] an address with no card says so and offers where to go`);
  // The moving name, opened as a picture of its own so its clock can be set: the squares
  // materialize from left to right, and all of them are there at the end.
  await fresh.goto(`${base}/wordmark-appear.svg`);
  const shownAt = (seconds) => fresh.evaluate((seconds) => {
    const svg = document.documentElement;
    svg.pauseAnimations();
    svg.setCurrentTime(seconds);
    const shown = (from, to) => [...svg.querySelectorAll("rect")]
      .filter((square) => square.x.baseVal.value >= from && square.x.baseVal.value < to)
      .filter((square) => Number(getComputedStyle(square).opacity) > 0.5).length;
    return { first: shown(0, 648), last: shown(2895, 9999), all: shown(0, 9999) };
  }, seconds);
  const [early, midway, done] = [await shownAt(0.02), await shownAt(0.45), await shownAt(1.5)];
  check(early.all === 0 && midway.first === 9 && midway.last === 0 && done.all === 68, `[${name}] the name's squares materialize from left to right (${early.all}, then ${midway.all} with the T whole and no K, then ${done.all})`);
  // Someone who has asked their device for less motion gets the name standing still.
  await fresh.emulateMedia({ reducedMotion: "reduce" });
  await fresh.goto(base);
  await fresh.waitForFunction(() => { const image = document.querySelector(".wordmark img"); return image.complete && image.naturalWidth > 0; });
  const calmName = await fresh.$eval(".wordmark img", (image) => new URL(image.currentSrc).pathname);
  check(calmName === "/wordmark.svg", `[${name}] and stands still for anyone who asked for less motion (${calmName})`);
  // Nothing on the first screen moves when the news and the cards arrive: they are held back
  // here, and the bar is where it will be before they come.
  let letThrough;
  const held = new Promise((resolve) => { letThrough = resolve; });
  await fresh.route("**/api/home", async (route) => { await held; await route.continue(); });
  await fresh.goto(base);
  const barTop = () => fresh.$eval("#search", (bar) => bar.getBoundingClientRect().top);
  const barBefore = await barTop();
  const waiting = await fresh.evaluate(() => document.getElementById("news").hidden && document.getElementById("home-cards").hidden);
  letThrough();
  await fresh.waitForFunction(() => document.querySelectorAll("#home-cards img").length === 7 && !document.getElementById("news").hidden);
  const barAfter = await barTop();
  check(waiting && Math.abs(barAfter - barBefore) <= 2, `[${name}] the search bar does not move when the news and cards arrive (${Math.round(barBefore)}px, then ${Math.round(barAfter)}px)`);
  await fresh.unroute("**/api/home");
  // Enter in the empty box tries the example it shows.
  const offered = (await fresh.getAttribute("#q", "placeholder")).replace(/^Try: /, "");
  await fresh.focus("#q");
  await fresh.press("#q", "Enter");
  // an example is plain English or a players' word
  await fresh.waitForFunction(() => ["Plain English", "Players' words"].some((kind) => document.getElementById("status").textContent.startsWith(kind)));
  check(new URL(fresh.url()).searchParams.get("q") === offered && (await fresh.inputValue("#q")) === offered, `[${name}] Enter in the empty box tries the example it shows (${offered})`);
  // A query that names a card and asks for others like it says so above the results.
  await fresh.fill("#q", "tithe alternative");
  await fresh.press("#q", "Enter");
  await fresh.waitForFunction(() => document.getElementById("status").textContent.includes("Tithe"));
  const likeStatus = await fresh.textContent("#status");
  check(likeStatus.startsWith("Plain English · cards that do what Tithe does"), `[${name}] asking for a card's alternatives is said back in words (${likeStatus})`);
  await fresh.close();

  await page.goBack();
  await page.waitForFunction(() => document.getElementById("card").hidden);
  check(page.url() === resultsUrl, `[${name}] the browser's Back returns to the results`);

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
  check((await page.textContent("#card-name")) === rowName, `[${name}] a row opens its card (${rowName})`);
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
  check((await page.isVisible("#empty")) && (await page.textContent("#empty-detail")).includes("syntax guide") && (await page.$$("#results .tile")).length === 0, `[${name}] pointing to the syntax guide, with no stale results`);
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
    if (path !== "/" && path !== "/syntax") continue;
    // the widest example still shows whole in the empty box, on the home page and in a header
    const spare = await page.evaluate((examples) => {
      const box = document.getElementById("q");
      const [style, hint] = [getComputedStyle(box), getComputedStyle(box, "::placeholder")];
      const pen = document.createElement("canvas").getContext("2d");
      pen.font = `${hint.fontWeight} ${hint.fontSize} ${hint.fontFamily}`;
      const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return Math.floor(room - Math.max(...examples.map((example) => pen.measureText(`Try: ${example}`).width)));
    }, await examplesOffered(page));
    check(spare >= 0, `[320 wide] ${what}: the widest example fits in the empty box (${spare}px to spare)`);
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
