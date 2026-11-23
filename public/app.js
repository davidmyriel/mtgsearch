// One page, no framework. All card data is inserted with textContent, never as HTML.
//
// The page has two views. The results view lives at /?q=... and the card view at
// /card/<set>/<number>/<name>, so a card has an address that can be shared and opened directly.
// A search's address also holds its sort, direction, what a result is, and the page of results.
"use strict";

const form = document.getElementById("search");
const input = document.getElementById("q");
const intro = document.getElementById("intro");
const statusLine = document.getElementById("status");
const results = document.getElementById("results");
const tools = document.getElementById("tools");
const sortSelect = document.getElementById("sort");
const dirSelect = document.getElementById("dir");
const uniqueSelect = document.getElementById("unique");
const pager = document.getElementById("pager");
const sorters = document.getElementById("sorters");
const viewSwitch = document.getElementById("view-switch");
const tableWrap = document.getElementById("table");
const rows = document.getElementById("rows");
const preview = document.getElementById("preview");
const understood = document.getElementById("understood");
const news = document.getElementById("news");
const homeCards = document.getElementById("home-cards");
const ignored = document.getElementById("ignored");
const emptyState = document.getElementById("empty");
const cardView = document.getElementById("card");
const backButton = document.getElementById("card-back");
const printsButton = document.getElementById("card-prints");
const copyButton = document.getElementById("card-copy");
const legalitySection = document.getElementById("card-legality");
const printingsSection = document.getElementById("card-printings");
const printingsList = document.getElementById("printings-list");

const IMAGE_HOST = "https://cards.scryfall.io/";
const CARD_HOST = "https://scryfall.com/";
// Results on one page, and how far into a result the endpoint will go. Keep in step with
// MAX_RESULTS and MAX_REACH in app/api.ts; a test compares them.
const PAGE_SIZE = 60;
const MAX_REACH = 10000;
const LAST_PAGE = Math.floor(MAX_REACH / PAGE_SIZE); // the last page that fits whole
// What a result is, as the endpoint names it: the word for one, and its value in the "Show" menu.
const UNITS = { cards: "card", printings: "printing", illustrations: "illustration" };
const UNIQUE_OF = { cards: "", printings: "prints", illustrations: "art" };
// The formats a card's page gives the legality for, in the order they are listed.
const FORMATS = [
  ["standard", "Standard"], ["pioneer", "Pioneer"], ["modern", "Modern"], ["legacy", "Legacy"],
  ["vintage", "Vintage"], ["pauper", "Pauper"], ["commander", "Commander"], ["oathbreaker", "Oathbreaker"],
  ["brawl", "Brawl"], ["standardbrawl", "Standard Brawl"], ["historic", "Historic"], ["timeless", "Timeless"],
  ["alchemy", "Alchemy"], ["penny", "Penny Dreadful"], ["premodern", "Premodern"], ["oldschool", "Old School"],
];
// /api/card lists at most this many printings; a card with more gets a link to search for all.
const MAX_LISTED = 60;
// Sort orders decided by a printing rather than by the card.
const PRINTING_ORDERS = new Set(["released", "usd", "eur", "tix", "rarity"]);
// A search as its address names it. Empty strings are the defaults and are left out of the address.
// `list` asks for the list of results even when the query is a card's exact name, which
// otherwise opens that card.
// `as` is how results are drawn: pictures, or "table".
const EMPTY = { query: "", order: "", dir: "", unique: "", list: "", as: "", page: 1 };
// The reader's choice of pictures or table carries over to the next search they make.
let viewMode = "";
let inFlight = null;
let current = { ...EMPTY, unit: "cards" }; // what the grid is showing
let resultsScroll = 0; // where the results were scrolled to when a card was opened

function plural(n, word) {
  return `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
}

/** An amount with two decimals, or as whole units with separators once it reaches a thousand. */
const amount = (n) =>
  n.toLocaleString("en", n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = { usd: (n) => `$${amount(n)}`, eur: (n) => `€${amount(n)}`, tix: (n) => amount(n) };
const price = (usd) => (typeof usd === "number" ? money.usd(usd) : "");
const year = (released) => (released ? released.slice(0, 4) : "");
const capital = (word) => (word ? word[0].toUpperCase() + word.slice(1) : "");
const setAndNumber = (hit) => (hit.set ? `${hit.set.toUpperCase()}${hit.collector_number ? ` #${hit.collector_number}` : ""}` : "");
/** A click that should be left to the browser: it opens the link in a new tab or window. */
const modified = (event) => event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

// --- addresses -------------------------------------------------------------------------

/** "Dr. McCoy, Surly Surgeon" -> "dr-mccoy-surly-surgeon". Only for readability: it is not looked up. */
function slug(name) {
  const plain = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card";
}

/** The address of a card's page, or null if the hit does not say which printing it is. */
function cardPath(hit) {
  if (!hit.set || !hit.collector_number) return null;
  return `/card/${encodeURIComponent(hit.set)}/${encodeURIComponent(hit.collector_number)}/${slug(hit.name)}`;
}

/** The set and collector number in a card address, or null for any other address. */
function parseCardPath(pathname) {
  const match = /^\/card\/([^/]+)\/([^/]+)(?:\/[^/]*)?\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return { set: decodeURIComponent(match[1]), number: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

/** The search the address bar names. Anything it does not understand falls back to the default. */
function readAddress() {
  const params = new URLSearchParams(location.search);
  const page = Number.parseInt(params.get("page") || "1", 10);
  const dir = params.get("dir");
  const unique = params.get("unique");
  return {
    query: (params.get("q") || "").trim(),
    order: params.get("order") || "",
    dir: dir === "asc" || dir === "desc" ? dir : "",
    unique: unique === "prints" || unique === "art" ? unique : "",
    list: params.get("list") === "1" ? "1" : "",
    as: params.get("as") === "table" ? "table" : "",
    page: page > 1 ? Math.min(page, LAST_PAGE) : 1,
  };
}

/** The address of a search, so that it can be shared, reloaded, and reached with Back. */
function searchPath(view) {
  const params = new URLSearchParams();
  if (view.query) params.set("q", view.query);
  for (const key of ["order", "dir", "unique", "list", "as"]) if (view[key]) params.set(key, view[key]);
  if (view.page > 1) params.set("page", String(view.page));
  const text = params.toString();
  return text ? `/?${text}` : "/";
}

const sameSearch = (a, b) => ["query", "order", "dir", "unique", "list", "as", "page"].every((key) => a[key] === b[key]);
/** How many results are on screen, as pictures or as rows. */
const shownCount = () => results.children.length + rows.children.length;

// --- results view ----------------------------------------------------------------------

// What the status line says for each path a query can take.
function describe(data, view) {
  const first = (view.page - 1) * PAGE_SIZE + 1;
  const range = `${first.toLocaleString("en")}–${(first + data.hits.length - 1).toLocaleString("en")}`;
  const total = () => `${plural(data.total, UNITS[data.unit] || "card")}${data.total > data.hits.length ? `, showing ${range}` : ""}`;
  const ranked = view.page === 1 ? `top ${data.hits.length}` : `results ${range}`;
  switch (data.mode) {
    case "syntax":
      return ["Scryfall syntax", total()];
    case "name":
      return ["Card name", total()];
    case "mixed":
      return ["Syntax and plain English", `${data.note}, ${ranked}`];
    case "semantic":
      return ["Plain English", data.note ? `filtered to ${data.note}, ${ranked}` : `${ranked} by meaning`];
    default:
      return ["", ""];
  }
}

function setStatus(label, detail, isError = false, tookMs = null) {
  statusLine.replaceChildren();
  statusLine.classList.toggle("error", isError);
  if (label) {
    const strong = document.createElement("strong");
    strong.textContent = label;
    statusLine.append(strong, detail ? " · " : "");
  }
  statusLine.append(detail || "");
  if (tookMs !== null) {
    const took = document.createElement("span");
    took.className = "took";
    took.textContent = `· ${tookMs} ms`;
    statusLine.append(" ", took);
  }
}

// `captioned` adds the printing under the image: set, number, year and price. It is used when
// the printing is the point of the search (a list of printings, or a sort by price or date).
function tile(hit, captioned) {
  const item = document.createElement("li");
  // A link, so a card can be opened in a new tab or its address copied from the results.
  const link = document.createElement("a");
  link.className = "tile";
  link.href = cardPath(hit) || "#";
  // The name sits behind the image, so it shows while the image loads or if it fails.
  const label = document.createElement("span");
  label.className = "label";
  const name = document.createElement("strong");
  name.textContent = hit.name;
  const line = document.createElement("small");
  line.textContent = hit.type_line || "";
  label.append(name, line);
  link.append(label);
  if (hit.image && hit.image.startsWith(IMAGE_HOST)) {
    const image = new Image(488, 680);
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = hit.name;
    image.addEventListener("error", () => image.remove());
    image.src = hit.image;
    label.setAttribute("aria-hidden", "true");
    link.append(image);
  }
  link.addEventListener("click", (event) => {
    if (modified(event)) return;
    event.preventDefault();
    openCard(hit);
  });
  item.append(link);
  if (captioned) {
    const caption = document.createElement("p");
    caption.className = "caption";
    caption.textContent = [setAndNumber(hit), year(hit.released), price(hit.usd)].filter(Boolean).join(" · ");
    item.append(caption);
  }
  return item;
}

/** A search that found nothing: say so in the page, with what to try. No arguments hides it. */
function showEmpty(title = "", detail = "") {
  document.getElementById("empty-title").textContent = title;
  document.getElementById("empty-detail").textContent = detail;
  emptyState.hidden = !title;
}

/** Terms that could not be used: the search ran without them, and this says which and why. */
function showIgnored(terms) {
  ignored.replaceChildren(
    ...(terms || []).map(({ term, reason }) => {
      const item = document.createElement("li");
      const typed = document.createElement("strong");
      typed.textContent = term;
      item.append(typed, ` was left out: ${reason}.`);
      return item;
    }),
  );
  ignored.hidden = ignored.children.length === 0;
}

/** How a syntax query was read: each condition in words. Nothing for plain English. */
function showUnderstood(conditions) {
  understood.replaceChildren(
    ...(conditions || []).map((condition) => {
      const item = document.createElement("li");
      item.textContent = condition;
      return item;
    }),
  );
  understood.hidden = understood.children.length === 0;
}

// --- home page -------------------------------------------------------------------------

// A device with a pointer rather than a finger: the search box can take the focus on arrival
// without a keyboard sliding up, and rows of a table can show a picture on hover.
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const HOME_CARDS = 6;
let homeAsked = false;

/** GET a JSON file or endpoint of this site; null if it cannot be had. */
async function getJson(path) {
  try {
    const response = await fetch(path);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** One line of what is new: a small tag and a few words, linking to a search on this site. */
function newsLine(tag, words, href, className) {
  const item = document.createElement("li");
  if (className) item.className = className;
  const link = document.createElement("a");
  link.href = href;
  const label = document.createElement("span");
  label.className = tag.toLowerCase() === "preview" ? "tag upcoming" : "tag";
  label.textContent = tag;
  link.append(label, words);
  // A link to a search is answered in the page; anything else is followed as a link.
  const url = new URL(link.href);
  if (url.origin === location.origin && url.pathname === "/" && url.searchParams.get("q")) {
    link.addEventListener("click", (event) => {
      if (modified(event)) return;
      event.preventDefault();
      run({ query: url.searchParams.get("q") });
    });
  }
  item.append(link);
  return item;
}

/**
 * What the home page shows around the search box: what is new, and a few cards that differ
 * on every visit. public/flavour.json can put a line of its own first, choose where the
 * cards are drawn from, and give the page another look: the flavour of the week.
 */
async function loadHome() {
  if (homeAsked) return;
  homeAsked = true;
  const [flavour, found] = await Promise.all([getJson("/flavour.json"), getJson("/api/home")]);
  const taste = flavour || {};
  if (typeof taste.theme === "string" && /^[a-z]{1,20}$/.test(taste.theme)) document.body.dataset.flavour = taste.theme;

  const lines = [];
  const featured = taste.featured;
  if (featured && typeof featured.text === "string" && typeof featured.href === "string" && featured.href.startsWith("/")) {
    lines.push(newsLine(String(featured.label || "New"), featured.text, featured.href, "featured"));
  }
  for (const set of (found && found.sets) || []) {
    lines.push(newsLine(set.upcoming ? "Preview" : "New", set.name, searchPath({ ...EMPTY, query: `set:${set.code}` })));
  }
  news.replaceChildren(...lines);
  news.hidden = lines.length === 0;

  // The cards: drawn from the flavour's own search when it names one, else from anywhere.
  let cards = (found && found.cards) || [];
  if (typeof taste.cards === "string" && taste.cards.trim()) {
    const themed = await getJson(`/api/search?${new URLSearchParams({ q: taste.cards.trim(), k: String(PAGE_SIZE) })}`);
    const pool = ((themed && themed.hits) || []).filter((hit) => hit.image && cardPath(hit));
    const drawn = [];
    while (pool.length && drawn.length < HOME_CARDS) drawn.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    if (drawn.length) cards = drawn;
  }
  const strip = cards
    .filter((hit) => hit.image && hit.image.startsWith(IMAGE_HOST) && cardPath(hit))
    .slice(0, HOME_CARDS)
    .map((hit) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = cardPath(hit);
      const image = new Image(488, 680);
      image.alt = hit.name;
      image.decoding = "async";
      image.src = hit.image;
      link.append(image);
      link.addEventListener("click", (event) => {
        if (modified(event)) return;
        event.preventDefault();
        history.pushState(null, "", link.getAttribute("href"));
        loadCard({ set: hit.set, number: hit.collector_number });
      });
      item.append(link);
      return item;
    });
  homeCards.replaceChildren(...strip);
  homeCards.hidden = strip.length === 0;
  document.body.classList.toggle("has-strip", strip.length > 0);
}

// --- results as a table ----------------------------------------------------------------

/** One result as a row of the table. Clicking anywhere on the row opens the card. */
function row(hit) {
  const tr = document.createElement("tr");
  const cell = (className, content, title) => {
    const td = document.createElement("td");
    td.className = className;
    if (title) td.title = title; // the whole text, for a cell that is cut short
    td.append(...[].concat(content));
    tr.append(td);
  };
  const link = document.createElement("a");
  link.href = cardPath(hit) || "#";
  link.textContent = hit.name;
  cell("t-name", link, hit.name);
  cell("t-cost", withSymbols(hit.mana_cost || ""));
  cell("t-type", hit.type_line || "", hit.type_line);
  const code = document.createElement("strong");
  code.textContent = (hit.set || "").toUpperCase();
  cell("t-set", [code, hit.collector_number ? ` #${hit.collector_number}` : ""], hit.set_name);
  cell("t-rarity", capital(hit.rarity));
  cell("t-artist", hit.artist || "", hit.artist);
  for (const currency of ["usd", "eur", "tix"]) {
    cell(`t-price t-${currency}`, typeof hit[currency] === "number" ? money[currency](hit[currency]) : "—");
  }
  if (hit.image && hit.image.startsWith(IMAGE_HOST)) tr.dataset.image = hit.image;
  tr.addEventListener("click", (event) => {
    // Leave modified clicks on the name alone: they open the card's page in a new tab.
    if (modified(event)) return;
    event.preventDefault();
    preview.hidden = true;
    openCard(hit);
  });
  return tr;
}

/**
 * The table's headings. One with an order is a link that sorts by it; the one the results
 * are sorted by says which way, and choosing it again turns the order round.
 */
function showHeadings(view, data) {
  const priced = ["eur", "tix"].includes(data.sorted_by) ? data.sorted_by : "usd";
  tableWrap.querySelector("table").dataset.price = priced; // the one price a phone has room for
  for (const th of tableWrap.querySelectorAll("th")) {
    const order = th.dataset.order;
    th.dataset.label = th.dataset.label || th.textContent;
    // Results ranked by meaning have no other order to offer.
    if (!order || data.sorted_by === null) {
      th.textContent = th.dataset.label;
      th.removeAttribute("aria-sort");
      continue;
    }
    const active = data.sorted_by === order;
    const dir = active ? (data.sorted_desc ? "asc" : "desc") : "";
    const link = document.createElement("a");
    link.href = searchPath({ ...view, order, dir, page: 1 });
    link.textContent = th.dataset.label;
    link.addEventListener("click", (event) => {
      if (modified(event)) return;
      event.preventDefault();
      run({ ...view, order, dir, page: 1 });
    });
    th.replaceChildren(link);
    th.setAttribute("aria-sort", active ? (data.sorted_desc ? "descending" : "ascending") : "none");
  }
}

// On a device with a pointer, the card under it is shown beside it while a row is hovered.
if (finePointer) {
  rows.addEventListener("pointermove", (event) => {
    const tr = event.target.closest("tr");
    if (!tr || !tr.dataset.image) return void (preview.hidden = true);
    if (preview.getAttribute("src") !== tr.dataset.image) preview.src = tr.dataset.image;
    const width = 240;
    const height = Math.round((width * 680) / 488);
    // To the right of the pointer, or to its left near the edge; kept inside the window.
    const left = event.clientX + 20 + width > window.innerWidth ? event.clientX - 20 - width : event.clientX + 20;
    const top = Math.min(Math.max(8, event.clientY - height / 3), window.innerHeight - height - 8);
    preview.style.left = `${Math.max(8, left)}px`;
    preview.style.top = `${top}px`;
    preview.hidden = false;
  });
  rows.addEventListener("pointerleave", () => (preview.hidden = true));
  window.addEventListener("scroll", () => (preview.hidden = true), { passive: true });
}

/** Take the results off the screen: pictures, rows, and the controls that go with them. */
function clearHits() {
  results.replaceChildren();
  rows.replaceChildren();
  tableWrap.hidden = preview.hidden = true;
  tools.hidden = pager.hidden = true;
}

/** Show the results view. The grid is left as it was, so coming back from a card is instant. */
function showResults() {
  document.body.classList.remove("viewing-card");
  cardView.hidden = true;
}

/**
 * The links between pages of results. With a total, the number of pages is known; results
 * ranked by meaning have none, and there is a next page for as long as the endpoint says so.
 */
function showPager(view, data) {
  const pages = data.total === null ? null : Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const reach = pages === null ? null : Math.min(pages, LAST_PAGE); // the endpoint stops at MAX_REACH
  const hasNext = reach === null ? Boolean(data.has_more) : view.page < reach;
  pager.hidden = view.page === 1 && !hasNext;
  const link = (id, page, enabled) => {
    const element = document.getElementById(id);
    if (enabled) {
      element.href = searchPath({ ...view, page });
      element.dataset.page = String(page);
      element.removeAttribute("aria-disabled");
    } else {
      element.removeAttribute("href");
      element.setAttribute("aria-disabled", "true");
    }
  };
  link("page-first", 1, view.page > 1);
  link("page-prev", Math.min(view.page - 1, reach ?? view.page - 1), view.page > 1);
  link("page-next", view.page + 1, hasNext);
  link("page-last", reach ?? view.page, reach !== null && view.page < reach);
  document.getElementById("page-last").hidden = reach === null;
  const now = pages === null ? `Page ${view.page}` : `Page ${view.page.toLocaleString("en")} of ${pages.toLocaleString("en")}`;
  const capped = reach !== null && reach < pages && view.page >= reach;
  document.getElementById("page-now").textContent = capped ? `${now}. Narrow the search to see further.` : now;
}

// Run a search and show one page of its results. `push` adds it to the history; it is false
// when the address already names this search (a reload, a shared link, Back and Forward).
async function run(search, { push = true } = {}) {
  const view = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) if (search[key]) view[key] = search[key];
  view.query = view.query.trim();
  // A search that does not say how to draw its results keeps the reader's last choice.
  if (search.as === undefined) view.as = viewMode;
  viewMode = view.as;
  showResults();
  input.value = view.query;
  sortSelect.value = view.order;
  dirSelect.value = view.dir;
  uniqueSelect.value = view.unique;
  for (const button of viewSwitch.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.as === view.as));
  }
  if (push) history.pushState(null, "", searchPath(view));
  document.title = view.query ? `${view.query} · mtgsearch` : "mtgsearch";
  document.body.classList.toggle("searched", Boolean(view.query));
  if (inFlight) inFlight.abort();
  if (!view.query) {
    intro.hidden = false;
    clearHits();
    showUnderstood([]);
    showIgnored([]);
    showEmpty();
    current = { ...EMPTY, unit: "cards" };
    setStatus("", "");
    // The home page: the search box is what it is for.
    loadHome();
    if (finePointer) input.focus();
    return;
  }

  intro.hidden = true;
  setStatus("", "Searching…");
  const controller = new AbortController();
  inFlight = controller;
  const fail = (label, detail) => {
    clearHits();
    showUnderstood([]);
    showIgnored([]);
    showEmpty();
    current = { ...EMPTY, unit: "cards" };
    setStatus(label, detail, true);
  };
  try {
    const params = new URLSearchParams({ q: view.query, k: String(PAGE_SIZE), offset: String((view.page - 1) * PAGE_SIZE) });
    for (const key of ["order", "dir", "unique"]) if (view[key]) params.set(key, view[key]);
    const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) return fail("", data.error || "Something went wrong.");
    if (data.mode === "unsupported") {
      // The header stays a bar, so that the explanation is in view, with the examples under it.
      intro.hidden = false;
      // Every term was one that cannot be used, so there is nothing left to search for.
      return fail("Nothing here could be used", `${data.note}. The syntax guide lists what can be typed.`);
    }
    // A card's exact name, or a search that finds one card and nothing else, goes straight to
    // that card's page. Not when the list was asked for, a control was changed, or a term was
    // left out: then the reader is looking at the list on purpose, or needs to see the warning.
    const only = data.unit === "cards" && data.total === 1 && data.hits.length === 1 ? data.hits[0] : null;
    const target = data.exact || only;
    const asTyped = view.page === 1 && !view.list && !view.order && !view.dir && !view.unique;
    if (target && asTyped && cardPath(target) && !(data.ignored && data.ignored.length)) {
      clearHits();
      showUnderstood([]);
      showIgnored([]);
      showEmpty();
      current = { ...EMPTY, unit: "cards" };
      setStatus("", "");
      const others = (data.total || 1) - 1;
      // The card takes the search's place in the history, as a redirect would: Back leaves both.
      history.replaceState({ card: target, also: others > 0 ? { query: view.query, others } : null }, "", cardPath(target));
      showCard(target);
      return;
    }
    // The same results as pictures or as rows of a table; only one of the two is filled.
    const table = view.as === "table";
    const captioned = data.unit !== "cards" || PRINTING_ORDERS.has(data.sorted_by);
    results.replaceChildren(...(table ? [] : data.hits.map((hit) => tile(hit, captioned))));
    rows.replaceChildren(...(table ? data.hits.map(row) : []));
    results.hidden = table;
    tableWrap.hidden = !table || data.hits.length === 0;
    preview.hidden = true;
    if (table) showHeadings(view, data);
    current = { ...view, unit: data.unit };
    // The menu shows what the results are, also when the query itself says so (`unique:prints`).
    uniqueSelect.value = UNIQUE_OF[data.unit] ?? "";
    tools.hidden = data.hits.length === 0;
    // Results ranked by meaning have no other order to offer.
    sorters.hidden = data.sorted_by === null;
    showPager(view, data);
    showUnderstood(data.understood);
    showIgnored(data.ignored);
    showEmpty();
    if (push) window.scrollTo(0, 0);
    if (!data.hits.length) {
      const beyond = view.page > 1 && (data.total === null || data.total > 0);
      setStatus(beyond ? "Nothing on this page" : "No cards matched", "", false, data.took_ms);
      showEmpty(
        beyond ? "Nothing on this page" : "No cards matched",
        beyond
          ? "The results end before this page. Go back to an earlier one."
          : data.understood && data.understood.length > 1
            ? "No card meets every condition above at once. Take one out, or describe the card in plain words instead."
            : "Check the spelling and the syntax, or describe the card in plain words instead.",
      );
      return;
    }
    const [label, detail] = describe(data, view);
    setStatus(label, detail, false, data.took_ms);
  } catch (error) {
    if (error.name === "AbortError") return;
    fail("", "Could not reach the server. Check your connection and try again.");
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

// --- symbols ---------------------------------------------------------------------------

const COLOUR_NAMES = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const SYMBOL_NAMES = { T: "tap", Q: "untap", E: "energy", C: "colourless mana", S: "snow mana", X: "X generic mana" };

/** What one part of a symbol pays with, in words: "white", "2 generic", "colourless". */
function partName(part) {
  if (COLOUR_NAMES[part]) return COLOUR_NAMES[part];
  if (/^\d+$/.test(part)) return `${part} generic`;
  return part === "C" ? "colourless" : part;
}

/**
 * A symbol such as {W}, {2}, {T} or {G/U/P} as a small lettered disc of this site's own
 * drawing. The brace code stays inside it, out of sight, so that copying the card's text or
 * finding "{T}" in the page still works; a screen reader is given the symbol's name instead.
 */
function pip(code) {
  const parts = code.toUpperCase().split("/");
  const phyrexian = parts.length > 1 && parts[parts.length - 1] === "P";
  const paid = phyrexian ? parts.slice(0, -1) : parts;
  let name;
  if (parts.length === 1) {
    name = SYMBOL_NAMES[parts[0]] || (COLOUR_NAMES[parts[0]] ? `${COLOUR_NAMES[parts[0]]} mana` : /^\d+$/.test(parts[0]) ? `${parts[0]} generic mana` : `{${code}}`);
  } else {
    name = `${paid.map(partName).join(" or ")} mana${phyrexian ? ", or 2 life" : ""}`;
  }
  const element = document.createElement("span");
  element.className = "pip";
  // One colour fills the disc; two split it corner to corner.
  const [first, second] = paid;
  if (COLOUR_NAMES[first]) element.classList.add(`a-${first.toLowerCase()}`);
  if (second !== undefined && COLOUR_NAMES[second]) element.classList.add(`b-${second.toLowerCase()}`);
  else if (second !== undefined) element.classList.add("b-n");
  element.dataset.label = parts.join("/");
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", name);
  const hidden = document.createElement("span");
  hidden.className = "code";
  hidden.textContent = `{${code}}`;
  element.append(hidden);
  return element;
}

/** Text with its {symbols} drawn: the pieces to put in an element, in order. */
function withSymbols(value) {
  const pieces = [];
  let last = 0;
  for (const match of value.matchAll(/\{([^{}\s]{1,12})\}/g)) {
    if (match.index > last) pieces.push(value.slice(last, match.index));
    pieces.push(pip(match[1]));
    last = match.index + match[0].length;
  }
  if (last < value.length) pieces.push(value.slice(last));
  return pieces;
}

// --- card view -------------------------------------------------------------------------

/** Set an element's text, and hide it when there is none. With `symbols`, {W} and the like are drawn. */
function text(id, value, symbols = false) {
  const element = document.getElementById(id);
  if (symbols && value) element.replaceChildren(...withSymbols(value));
  else element.textContent = value || "";
  element.hidden = !value;
}

/** Legality by format: the word says it, for every format in FORMATS. */
function showLegality(card) {
  const rows = FORMATS.map(([key, label]) => {
    const [status, word] = card.restricted.includes(key)
      ? ["restricted", "Restricted"]
      : card.banned.includes(key)
        ? ["banned", "Banned"]
        : card.legal.includes(key)
          ? ["legal", "Legal"]
          : ["not", "Not legal"];
    const row = document.createElement("div");
    const format = document.createElement("dt");
    format.textContent = label;
    const value = document.createElement("dd");
    value.className = status;
    value.textContent = word;
    row.append(format, value);
    return row;
  });
  document.getElementById("legality-list").replaceChildren(...rows);
  legalitySection.hidden = false;
}

/** The card's printings, newest first, each a link to that printing's page. */
function showPrintings(card, printings) {
  const rows = printings.map((printing) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = cardPath(printing) || "#";
    if (printing.set === card.set && printing.collector_number === card.collector_number) link.setAttribute("aria-current", "page");
    const set = document.createElement("span");
    set.className = "set";
    set.textContent = printing.set_name || printing.set.toUpperCase();
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [setAndNumber(printing), capital(printing.rarity), year(printing.released)].filter(Boolean).join(" · ");
    const cost = document.createElement("span");
    cost.className = "price";
    cost.textContent = price(printing.usd) || "—";
    link.append(set, meta, cost);
    link.addEventListener("click", (event) => {
      if (modified(event)) return;
      event.preventDefault();
      if (link.hasAttribute("aria-current")) return;
      history.pushState(null, "", link.getAttribute("href"));
      loadCard({ set: printing.set, number: printing.collector_number });
    });
    item.append(link);
    return item;
  });
  printingsList.replaceChildren(...rows);
  document.getElementById("printings-title").textContent =
    rows.length >= MAX_LISTED ? `Printings (the newest ${rows.length})` : `Printings (${rows.length})`;
  // A card with more printings than the list holds links to a search for all of them.
  offerAllPrintings(card, rows.length >= MAX_LISTED);
  printingsSection.hidden = rows.length === 0 && printsButton.hidden;
}

/** The link to a search for every printing. A name holding a double quote cannot be searched exactly. */
function offerAllPrintings(card, wanted) {
  const possible = wanted && card.prints > 1 && !card.name.includes('"');
  printsButton.hidden = !possible;
  if (possible) {
    printsButton.textContent = `All ${card.prints} printings`;
    printsButton.dataset.q = `!"${card.name}" unique:prints order:released`;
  }
}

/**
 * Fill the card view and show it in place of the results. A hit from the results shows at
 * once; what only the card's page has (printed stats, legality, the printings) is fetched and
 * filled in when it arrives. `printings` is given when that has already happened.
 */
function showCard(hit, printings = null, { keepScroll = false } = {}) {
  const image = document.getElementById("card-image");
  const hasImage = Boolean(hit.image && hit.image.startsWith(IMAGE_HOST));
  image.hidden = !hasImage;
  if (image.getAttribute("src") !== (hasImage ? hit.image : "")) image.src = hasImage ? hit.image : "";
  image.alt = hit.name;
  document.getElementById("card-name").textContent = hit.name;
  text("card-cost", hit.mana_cost, true);
  text("card-line", hit.type_line);
  text("card-rules", hit.oracle_text, true);
  text("card-stats", hit.stats);
  text("card-flavor", hit.flavor_text);
  // The printing shown: its set, number, rarity and year, then artist and price.
  const set = hit.set_name ? `${hit.set_name}${setAndNumber(hit) ? ` (${setAndNumber(hit)})` : ""}` : setAndNumber(hit);
  text("card-printing", [set, capital(hit.rarity), year(hit.released)].filter(Boolean).join(" · "));
  text("card-artist", [hit.artist ? `Illustrated by ${hit.artist}` : "", price(hit.usd)].filter(Boolean).join(" · "));
  const link = document.getElementById("card-link");
  const hasLink = Boolean(hit.scryfall_uri && hit.scryfall_uri.startsWith(CARD_HOST));
  link.hidden = !hasLink;
  if (hasLink) link.href = hit.scryfall_uri;
  copyButton.textContent = "Copy link";
  // "Back to results" only when there are results to go back to.
  backButton.hidden = shownCount() === 0;
  preview.hidden = true;
  showAlso(history.state && history.state.also);
  document.title = `${hit.name} · mtgsearch`;
  document.body.classList.add("viewing-card", "searched");
  intro.hidden = true;
  cardView.hidden = false;
  if (!keepScroll) window.scrollTo(0, 0);

  if (printings) {
    showLegality(hit);
    showPrintings(hit, printings);
  } else {
    legalitySection.hidden = printingsSection.hidden = true;
    loadDetails(hit);
  }
}

/**
 * When a search for an exact name came straight to this card and other cards matched as well:
 * say so, with a link to the list. `also` is { query, others }, kept with the history entry.
 */
function showAlso(also) {
  const note = document.getElementById("card-also");
  note.hidden = !also;
  if (!also) return note.replaceChildren();
  const link = document.createElement("a");
  link.href = searchPath({ ...EMPTY, query: also.query, list: "1" });
  link.textContent = `See all ${also.others + 1}`;
  link.addEventListener("click", (event) => {
    if (modified(event)) return;
    event.preventDefault();
    run({ query: also.query, list: "1" });
  });
  const cards = also.others === 1 ? "1 other card" : `${also.others.toLocaleString("en")} other cards`;
  note.replaceChildren(`“${also.query}” is also part of the name of ${cards}. `, link);
}

/** Fetch what the card's page shows beyond a search result, for the card now on screen. */
async function loadDetails(hit) {
  const path = cardPath(hit);
  if (!path) return;
  const data = await fetchCard(hit.set, hit.collector_number);
  if (location.pathname !== path) return; // the reader has moved on
  if (!data || !data.card) {
    // Without the list, at least offer the search for the card's printings.
    offerAllPrintings(hit, true);
    printingsSection.hidden = printsButton.hidden;
    document.getElementById("printings-title").textContent = "Printings";
    printingsList.replaceChildren();
    return;
  }
  // Kept with the history entry, so Back and Forward show the whole page without asking again.
  history.replaceState({ ...(history.state || {}), card: data.card, printings: data.printings }, "");
  showCard(data.card, data.printings, { keepScroll: true });
}

/** GET /api/card. Null when the request fails; `{ error }` when the server says why. */
async function fetchCard(set, number) {
  try {
    const response = await fetch(`/api/card?${new URLSearchParams({ set: set.toLowerCase(), cn: number })}`);
    const data = await response.json();
    return response.ok ? data : { error: data.error || "Something went wrong.", missing: response.status === 404 };
  } catch {
    return null;
  }
}

/** Open a card from the results: go to its address and show it. */
function openCard(hit) {
  resultsScroll = window.scrollY;
  // The hit travels with the history entry, so Back and Forward need no request.
  history.pushState({ card: hit }, "", cardPath(hit) || location.href);
  showCard(hit);
}

/** A card's address was opened directly, or another printing was chosen: fetch it and show it. */
async function loadCard({ set, number }) {
  if (inFlight) inFlight.abort();
  inFlight = null;
  const path = location.pathname;
  const fromCard = !cardView.hidden; // moving between printings: keep the page while it loads
  if (!fromCard) {
    showResults();
    intro.hidden = true;
    document.body.classList.add("searched");
    setStatus("", "Loading the card…");
  }
  const data = await fetchCard(set, number);
  if (location.pathname !== path) return;
  if (!data || data.error) {
    showResults();
    if (data && data.missing) {
      intro.hidden = false;
      return setStatus("No card at this address", `Nothing is numbered ${number} in the set "${set}".`, true);
    }
    return setStatus("", data ? data.error : "Could not reach the server. Check your connection and try again.", true);
  }
  setStatus("", "");
  history.replaceState({ card: data.card, printings: data.printings }, "");
  showCard(data.card, data.printings);
}

/** /random: ask for a card chosen at random, then make its own address the current one. */
async function loadRandom() {
  if (inFlight) inFlight.abort();
  inFlight = null;
  if (cardView.hidden) {
    showResults();
    intro.hidden = true;
    document.body.classList.add("searched");
    setStatus("", "Picking a card…");
  }
  let data = null;
  try {
    const response = await fetch("/api/card?random=1", { cache: "no-store" });
    data = await response.json();
    if (!response.ok) data = { error: data.error || "Something went wrong." };
  } catch {
    data = null;
  }
  if (location.pathname !== "/random") return; // the reader has moved on
  if (!data || data.error) {
    showResults();
    return setStatus("", data ? data.error : "Could not reach the server. Check your connection and try again.", true);
  }
  setStatus("", "");
  // The card's own address replaces /random, so Back does not pick again and the link can be shared.
  history.replaceState({ card: data.card, printings: data.printings }, "", cardPath(data.card) || "/random");
  showCard(data.card, data.printings);
}

for (const id of ["nav-random", "empty-random"]) {
  document.getElementById(id).addEventListener("click", (event) => {
    if (modified(event)) return;
    event.preventDefault();
    resultsScroll = window.scrollY;
    history.pushState(null, "", "/random");
    loadRandom();
  });
}

backButton.addEventListener("click", () => history.back());

printsButton.addEventListener("click", () => run({ query: printsButton.dataset.q }));

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    copyButton.textContent = "Link copied";
  } catch {
    copyButton.textContent = "Copy it from the address bar";
  }
});

// --- navigation ------------------------------------------------------------------------

/** Show whatever the current address names. `state` is the history entry's, if it has one. */
function route(state) {
  const card = parseCardPath(location.pathname);
  if (state && state.card) return showCard(state.card, state.printings || null);
  if (card) return loadCard(card);
  if (location.pathname === "/random") return loadRandom();
  const view = readAddress();
  // Coming back from a card to the search that is still on screen: no need to ask again.
  if (view.query && sameSearch(view, current) && shownCount()) {
    showResults();
    document.title = `${view.query} · mtgsearch`;
    window.scrollTo(0, resultsScroll);
    return;
  }
  run(view, { push: false });
}

// A new query starts from the defaults: first page, default order, cards.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  run({ query: input.value });
  input.blur(); // dismiss the phone keyboard so results are visible
});

intro.addEventListener("click", (event) => {
  const example = event.target.closest("button[data-q]");
  if (example) run({ query: example.dataset.q });
});

// Changing what is shown or how it is sorted keeps the query and goes back to the first page.
for (const select of [sortSelect, dirSelect, uniqueSelect]) {
  select.addEventListener("change", () =>
    run({ query: current.query, order: sortSelect.value, dir: dirSelect.value, unique: uniqueSelect.value, list: current.list }),
  );
}

// Pictures or a table: the same search and the same page of it, drawn the other way.
viewSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-as]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  run({ ...current, as: button.dataset.as });
});

// The pager's links are real addresses; an ordinary click is answered without leaving the page.
pager.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || modified(event)) return;
  event.preventDefault();
  run({ ...current, page: Number(link.dataset.page) });
});

window.addEventListener("popstate", (event) => route(event.state));

document.addEventListener("keydown", (event) => {
  // "/" focuses the search box, as on most search sites.
  if (event.key === "/" && document.activeElement !== input) {
    event.preventDefault();
    input.focus();
    input.select();
  }
  // Escape leaves a card that was opened from the results.
  if (event.key === "Escape" && !cardView.hidden && !backButton.hidden) history.back();
});

route(history.state);
