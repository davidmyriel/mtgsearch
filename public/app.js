// One page, no framework. All card data is inserted with textContent, never as HTML.
"use strict";

const form = document.getElementById("search");
const input = document.getElementById("q");
const intro = document.getElementById("intro");
const statusLine = document.getElementById("status");
const results = document.getElementById("results");
const tools = document.getElementById("tools");
const sort = document.getElementById("sort");
const more = document.getElementById("more");
const sheet = document.getElementById("card");
const printsButton = document.getElementById("card-prints");

const IMAGE_HOST = "https://cards.scryfall.io/";
const CARD_HOST = "https://scryfall.com/";
// What a result is, as the endpoint names it, and the word for one of them.
const UNITS = { cards: "card", printings: "printing", illustrations: "illustration" };
// Sort orders decided by a printing rather than by the card.
const PRINTING_ORDERS = new Set(["released", "usd", "eur", "tix", "rarity"]);
let inFlight = null;
let current = { query: "", sort: "", unit: "cards" }; // what the grid is showing

function plural(n, word) {
  return `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
}

const price = (usd) => (typeof usd === "number" ? `$${usd.toFixed(2)}` : "");
const year = (released) => (released ? released.slice(0, 4) : "");
const capital = (word) => (word ? word[0].toUpperCase() + word.slice(1) : "");
const setAndNumber = (hit) => (hit.set ? `${hit.set.toUpperCase()}${hit.collector_number ? ` #${hit.collector_number}` : ""}` : "");

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
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tile";
  // The name sits behind the image, so it shows while the image loads or if it fails.
  const label = document.createElement("span");
  label.className = "label";
  const name = document.createElement("strong");
  name.textContent = hit.name;
  const line = document.createElement("small");
  line.textContent = hit.type_line || "";
  label.append(name, line);
  button.append(label);
  if (hit.image && hit.image.startsWith(IMAGE_HOST)) {
    const image = new Image(488, 680);
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = hit.name;
    image.addEventListener("error", () => image.remove());
    image.src = hit.image;
    label.setAttribute("aria-hidden", "true");
    button.append(image);
  }
  button.addEventListener("click", () => openCard(hit));
  item.append(button);
  if (captioned) {
    const caption = document.createElement("p");
    caption.className = "caption";
    caption.textContent = [setAndNumber(hit), year(hit.released), price(hit.usd)].filter(Boolean).join(" · ");
    item.append(caption);
  }
  return item;
}

function openCard(hit) {
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
  sheet.showModal();
}

printsButton.addEventListener("click", () => {
  sheet.close();
  run(printsButton.dataset.q);
});

// Clicking the dimmed area outside the sheet closes it.
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) sheet.close();
});

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

// Fetch one page of results. `append` adds to the grid (Show more); otherwise the grid is replaced.
async function run(query, { push = true, append = false, sortValue = "" } = {}) {
  query = query.trim();
  if (!append) {
    input.value = query;
    sort.value = sortValue;
    if (push) history.pushState(null, "", query ? `?${address(query, sortValue)}` : location.pathname);
    document.title = query ? `${query} · mtgsearch` : "mtgsearch";
    document.body.classList.toggle("searched", Boolean(query));
  }
  if (inFlight) inFlight.abort();
  if (!query) {
    intro.hidden = false;
    tools.hidden = more.hidden = true;
    results.replaceChildren();
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

window.addEventListener("popstate", () => {
  const { query, sort: sortValue } = readAddress();
  run(query, { push: false, sortValue });
});

// "/" focuses the search box, as on most search sites.
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== input && !sheet.open) {
    event.preventDefault();
    input.focus();
    input.select();
  }
});

{
  const { query, sort: sortValue } = readAddress();
  run(query, { push: false, sortValue });
}
