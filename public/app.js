// One page, no framework. All card data is inserted with textContent, never as HTML.
"use strict";

const form = document.getElementById("search");
const input = document.getElementById("q");
const intro = document.getElementById("intro");
const statusLine = document.getElementById("status");
const results = document.getElementById("results");
const sheet = document.getElementById("card");

const IMAGE_HOST = "https://cards.scryfall.io/";
const CARD_HOST = "https://scryfall.com/";
let inFlight = null;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// What the status line says for each path a query can take.
function describe(data) {
  const shown = data.hits.length;
  const more = data.total > shown ? `, showing the first ${shown}` : "";
  switch (data.mode) {
    case "syntax":
      return ["Scryfall syntax", `${plural(data.total, "card")}${more}`];
    case "name":
      return ["Card name", `${plural(data.total, "card")}${more}, most-played first`];
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

function tile(hit) {
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
  return item;
}

function openCard(hit) {
  const image = document.getElementById("card-image");
  const hasImage = Boolean(hit.image && hit.image.startsWith(IMAGE_HOST));
  image.hidden = !hasImage;
  image.src = hasImage ? hit.image : "";
  image.alt = hit.name;
  document.getElementById("card-name").textContent = hit.name;
  document.getElementById("card-line").textContent = [hit.mana_cost, hit.type_line].filter(Boolean).join("  ·  ");
  document.getElementById("card-rules").textContent = hit.oracle_text || "";
  const link = document.getElementById("card-link");
  const hasLink = Boolean(hit.scryfall_uri && hit.scryfall_uri.startsWith(CARD_HOST));
  link.hidden = !hasLink;
  if (hasLink) link.href = hit.scryfall_uri;
  sheet.showModal();
}

// Clicking the dimmed area outside the sheet closes it.
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) sheet.close();
});

async function run(query, { push = true } = {}) {
  query = query.trim();
  input.value = query;
  if (push) {
    const url = query ? `?q=${encodeURIComponent(query)}` : location.pathname;
    history.pushState({ q: query }, "", url);
  }
  document.title = query ? `${query} · mtgsearch` : "mtgsearch";
  document.body.classList.toggle("searched", Boolean(query));
  if (inFlight) inFlight.abort();
  if (!query) {
    intro.hidden = false;
    results.replaceChildren();
    setStatus("", "");
    return;
  }

  intro.hidden = true;
  setStatus("", "Searching…");
  const controller = new AbortController();
  inFlight = controller;
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      results.replaceChildren();
      setStatus("", data.error || "Something went wrong.", true);
      return;
    }
    if (data.mode === "unsupported") {
      results.replaceChildren();
      intro.hidden = false;
      document.body.classList.remove("searched");
      setStatus("Not supported yet", `${data.note}. See "What can I type?" below.`, true);
      return;
    }
    results.replaceChildren(...data.hits.map(tile));
    if (!data.hits.length) {
      setStatus("No cards matched", "Check the syntax, or describe the card in plain words.");
      return;
    }
    const [label, detail] = describe(data);
    setStatus(label, detail, false, data.took_ms);
  } catch (error) {
    if (error.name === "AbortError") return;
    results.replaceChildren();
    setStatus("", "Could not reach the server. Check your connection and try again.", true);
  } finally {
    if (inFlight === controller) inFlight = null;
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

window.addEventListener("popstate", () => {
  run(new URLSearchParams(location.search).get("q") || "", { push: false });
});

// "/" focuses the search box, as on most search sites.
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== input && !sheet.open) {
    event.preventDefault();
    input.focus();
    input.select();
  }
});

run(new URLSearchParams(location.search).get("q") || "", { push: false });
