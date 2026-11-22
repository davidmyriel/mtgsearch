// One page, no framework. All card data is inserted with textContent, never as HTML.
//
// The page has two views. The results view lives at /?q=... and the card view at
// /card/<set>/<number>/<name>, so a card has an address that can be shared and opened directly.
"use strict";

const form = document.getElementById("search");
const input = document.getElementById("q");
const intro = document.getElementById("intro");
const statusLine = document.getElementById("status");
const results = document.getElementById("results");
const tools = document.getElementById("tools");
const sort = document.getElementById("sort");
const more = document.getElementById("more");
const cardView = document.getElementById("card");
const backButton = document.getElementById("card-back");
const printsButton = document.getElementById("card-prints");
const copyButton = document.getElementById("card-copy");

const IMAGE_HOST = "https://cards.scryfall.io/";
const CARD_HOST = "https://scryfall.com/";
// What a result is, as the endpoint names it, and the word for one of them.
const UNITS = { cards: "card", printings: "printing", illustrations: "illustration" };
// Sort orders decided by a printing rather than by the card.
const PRINTING_ORDERS = new Set(["released", "usd", "eur", "tix", "rarity"]);
let inFlight = null;
let current = { query: "", sort: "", unit: "cards" }; // what the grid is showing
let resultsScroll = 0; // where the results were scrolled to when a card was opened

function plural(n, word) {
  return `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
}

const price = (usd) => (typeof usd === "number" ? `$${usd.toFixed(2)}` : "");
const year = (released) => (released ? released.slice(0, 4) : "");
const capital = (word) => (word ? word[0].toUpperCase() + word.slice(1) : "");
const setAndNumber = (hit) => (hit.set ? `${hit.set.toUpperCase()}${hit.collector_number ? ` #${hit.collector_number}` : ""}` : "");

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

// The address bar holds the query and the sort, so a search can be shared and the back button works.
function readAddress() {
  const params = new URLSearchParams(location.search);
  const order = params.get("order") || "";
  return { query: params.get("q") || "", sort: order && params.get("dir") === "desc" ? `${order}:desc` : order };
}

function address(query, sortValue) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const [order, direction] = sortValue.split(":");
  if (order) params.set("order", order);
  if (direction) params.set("dir", direction);
  return params;
}

// --- results view ----------------------------------------------------------------------

// What the status line says for each path a query can take.
function describe(data, shown) {
  const partial = data.total > shown ? `, showing ${shown}` : "";
  const total = () => `${plural(data.total, UNITS[data.unit] || "card")}${partial}`;
  switch (data.mode) {
    case "syntax":
      return ["Scryfall syntax", total()];
    case "name":
      return ["Card name", total()];
    case "mixed":
      return ["Syntax and plain English", `${data.note}, top ${shown}`];
    case "semantic":
      return ["Plain English", data.note ? `filtered to ${data.note}, top ${shown}` : `top ${shown} by meaning`];
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
    // Leave modified clicks alone: they open the card's page in a new tab or window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
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

/** Show the results view. The grid is left as it was, so coming back from a card is instant. */
function showResults() {
  document.body.classList.remove("viewing-card");
  cardView.hidden = true;
}

// Fetch one page of results. `append` adds to the grid (Show more); otherwise the grid is replaced.
async function run(query, { push = true, append = false, sortValue = "" } = {}) {
  query = query.trim();
  if (!append) {
    showResults();
    input.value = query;
    sort.value = sortValue;
    // Absolute, so that a search started from a card's page goes back to the results address.
    if (push) history.pushState(null, "", query ? `/?${address(query, sortValue)}` : "/");
    document.title = query ? `${query} · mtgsearch` : "mtgsearch";
    document.body.classList.toggle("searched", Boolean(query));
  }
  if (inFlight) inFlight.abort();
  if (!query) {
    intro.hidden = false;
    tools.hidden = more.hidden = true;
    results.replaceChildren();
    current = { query: "", sort: "", unit: "cards" };
    setStatus("", "");
    return;
  }

  intro.hidden = true;
  more.disabled = true;
  if (!append) setStatus("", "Searching…");
  const controller = new AbortController();
  inFlight = controller;
  const fail = (label, detail) => {
    if (!append) results.replaceChildren();
    tools.hidden = more.hidden = true;
    setStatus(label, detail, true);
  };
  try {
    const params = address(query, sortValue);
    if (append) params.set("offset", String(results.children.length));
    const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) return fail("", data.error || "Something went wrong.");
    if (data.mode === "unsupported") {
      intro.hidden = false;
      document.body.classList.remove("searched");
      return fail("Not supported yet", `${data.note}. See "What can I type?" below.`);
    }
    const captioned = data.unit !== "cards" || PRINTING_ORDERS.has(data.sorted_by);
    const tiles = data.hits.map((hit) => tile(hit, captioned));
    if (append) results.append(...tiles);
    else results.replaceChildren(...tiles);
    current = { query, sort: sortValue, unit: data.unit };
    const shown = results.children.length;
    more.hidden = !data.has_more;
    // Results ranked by meaning have no other order to offer.
    tools.hidden = data.sorted_by === null || shown === 0;
    if (!shown) {
      setStatus("No cards matched", "Check the syntax, or describe the card in plain words.");
      return;
    }
    const [label, detail] = describe(data, shown);
    setStatus(label, detail, false, data.took_ms);
  } catch (error) {
    if (error.name === "AbortError") return;
    fail("", "Could not reach the server. Check your connection and try again.");
  } finally {
    if (inFlight === controller) inFlight = null;
    more.disabled = false;
  }
}

// --- card view -------------------------------------------------------------------------

/** Fill the card view from a hit and show it in place of the results. */
function showCard(hit) {
  const text = (id, value) => {
    const element = document.getElementById(id);
    element.textContent = value || "";
    element.hidden = !value;
  };
  const image = document.getElementById("card-image");
  const hasImage = Boolean(hit.image && hit.image.startsWith(IMAGE_HOST));
  image.hidden = !hasImage;
  image.src = hasImage ? hit.image : "";
  image.alt = hit.name;
  document.getElementById("card-name").textContent = hit.name;
  text("card-line", [hit.mana_cost, hit.type_line].filter(Boolean).join("  ·  "));
  text("card-rules", hit.oracle_text);
  text("card-flavor", hit.flavor_text);
  // The printing shown: its set, number, rarity and year, then artist and price.
  const set = hit.set_name ? `${hit.set_name}${setAndNumber(hit) ? ` (${setAndNumber(hit)})` : ""}` : setAndNumber(hit);
  text("card-printing", [set, capital(hit.rarity), year(hit.released)].filter(Boolean).join(" · "));
  text("card-artist", [hit.artist ? `Illustrated by ${hit.artist}` : "", price(hit.usd)].filter(Boolean).join(" · "));
  // Offer the card's other printings, unless the grid already lists printings. A name holding
  // a double quote cannot be written as an exact-name search.
  const others = current.unit === "cards" && hit.prints > 1 && !hit.name.includes('"');
  printsButton.hidden = !others;
  if (others) {
    printsButton.textContent = `All ${hit.prints} printings`;
    printsButton.dataset.q = `!"${hit.name}" unique:prints order:released`;
  }
  const link = document.getElementById("card-link");
  const hasLink = Boolean(hit.scryfall_uri && hit.scryfall_uri.startsWith(CARD_HOST));
  link.hidden = !hasLink;
  if (hasLink) link.href = hit.scryfall_uri;
  copyButton.textContent = "Copy link";
  // "Back to results" only when there are results to go back to.
  backButton.hidden = results.children.length === 0;
  document.title = `${hit.name} · mtgsearch`;
  document.body.classList.add("viewing-card", "searched");
  intro.hidden = true;
  cardView.hidden = false;
  window.scrollTo(0, 0);
}

/** Open a card from the results: go to its address and show it. */
function openCard(hit) {
  resultsScroll = window.scrollY;
  // The hit travels with the history entry, so Back and Forward need no request.
  history.pushState({ card: hit }, "", cardPath(hit) || location.href);
  showCard(hit);
}

/** A card's address was opened directly: fetch that printing and show it. */
async function loadCard({ set, number }) {
  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  showResults();
  intro.hidden = true;
  document.body.classList.add("searched");
  setStatus("", "Loading the card…");
  try {
    const query = `set:${set.toLowerCase()} cn:"${number.replaceAll('"', "")}" unique:prints`;
    const response = await fetch(`/api/search?${new URLSearchParams({ q: query, k: "1" })}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) return setStatus("", data.error || "Something went wrong.", true);
    if (!data.hits || !data.hits.length) {
      intro.hidden = false;
      return setStatus("No card at this address", `Nothing is numbered ${number} in the set "${set}".`, true);
    }
    setStatus("", "");
    showCard(data.hits[0]);
  } catch (error) {
    if (error.name !== "AbortError") setStatus("", "Could not reach the server. Check your connection and try again.", true);
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

backButton.addEventListener("click", () => history.back());

printsButton.addEventListener("click", () => run(printsButton.dataset.q));

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
  if (state && state.card) return showCard(state.card);
  if (card) return loadCard(card);
  const { query, sort: sortValue } = readAddress();
  // Coming back from a card to the search that is still on screen: no need to ask again.
  if (query && query === current.query && sortValue === current.sort && results.children.length) {
    showResults();
    document.title = `${query} · mtgsearch`;
    window.scrollTo(0, resultsScroll);
    return;
  }
  run(query, { push: false, sortValue });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  run(input.value);
  input.blur(); // dismiss the phone keyboard so results are visible
});

intro.addEventListener("click", (event) => {
  const example = event.target.closest("button[data-q]");
  if (example) run(example.dataset.q);
});

sort.addEventListener("change", () => run(current.query, { sortValue: sort.value }));
more.addEventListener("click", () => run(current.query, { append: true, sortValue: current.sort }));

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
