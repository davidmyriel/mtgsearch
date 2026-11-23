// The HTTP contract of GET /api/search and GET /api/card, independent of Netlify and of TopK
// so it can be unit-tested with a stubbed search.

import type { CardPage } from "./card.ts";
import { ORDERS } from "./search.ts";
import type { Hit, Result, SearchOptions } from "./search.ts";

export type SearchFn = (query: string, options: SearchOptions) => Promise<Result>;
export type CardFn = (set: string, number: string) => Promise<CardPage | null>;
export type RandomFn = () => Promise<CardPage | null>;

export const MAX_QUERY_CHARS = 200;
export const DEFAULT_RESULTS = 24;
export const MAX_RESULTS = 60;
// How far into a result a page can reach. TopK refuses a query whose limit plus offset is
// greater than this, so nothing beyond the first 10,000 results can be returned.
export const MAX_REACH = 10_000;
const UNIQUE = ["cards", "prints", "art"];
// Document field -> name in the response. The last block describes the printing shown.
const HIT_FIELDS: Record<string, string> = {
  name: "name", mana_cost: "mana_cost", type_line: "type_line", oracle_text: "oracle_text",
  image: "image", scryfall_uri: "scryfall_uri",
  set: "set", set_name: "set_name", cn: "collector_number", rarity: "rarity", artist: "artist",
  released: "released", usd: "usd", eur: "eur", tix: "tix", flavor_text: "flavor_text", prints: "prints",
};
// What a card's own page adds, and the columns of its list of printings.
const LISTS = ["legal", "banned", "restricted"];
const PRINTING_ROW = ["name", "set", "set_name", "collector_number", "rarity", "released", "usd"];

// Repeated queries are answered by Netlify's CDN without running the function or calling TopK.
// Card data changes once a day, so ten minutes fresh and an hour stale-while-revalidate is safe.
const CACHED = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Netlify-CDN-Cache-Control": "public, durable, max-age=600, stale-while-revalidate=3600",
};
const NOT_CACHED = { "Cache-Control": "no-store" };

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

const error = (status: number, message: string) => json({ error: message }, status, NOT_CACHED);

/** A whole-number parameter clamped to a range; the fallback when absent; null when malformed. */
function clamp(raw: string | null, fallback: number, low: number, high: number): number | null {
  if (raw === null) return fallback;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  return Math.max(low, Math.min(Number.parseInt(raw, 10), high));
}

function hit(row: Hit): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row._id };
  for (const [source, name] of Object.entries(HIT_FIELDS)) out[name] = row[source] ?? null;
  for (const currency of ["usd", "eur", "tix"]) {
    const price = out[currency];
    if (typeof price === "number") out[currency] = Math.round(price * 100) / 100; // stored in single precision
  }
  if (typeof row.score === "number") out.score = Math.round(row.score * 1000) / 1000;
  return out;
}

/**
 * A failure that only whoever runs the deployment can fix, said plainly so that it shows on
 * the page instead of only in the function's log. These reveal that the setup is wrong, never
 * a key or anything else from the error. Any other failure stays a generic 502.
 */
export function setupProblem(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("TOPK_API_KEY is not set")) {
    return "This deployment has no TopK API key. Set TOPK_API_KEY where the search function can read it, then deploy again.";
  }
  if (/unauthenticated|invalid api key|permission ?denied/i.test(message)) {
    return "TopK rejected this deployment's API key. Check TOPK_API_KEY (no quotes or spaces around it), then deploy again.";
  }
  if (/collection not found/i.test(message)) {
    return "The TopK project behind this deployment's key does not hold the card collections. Use a key from the project that does, or build them with `mtgsearch ingest`.";
  }
  return null;
}

/**
 * GET /api/card?set=<code>&cn=<collector number>: one printing, with its printed power and
 * toughness and its legality, and the card's printings newest first.
 */
export async function handleCard(url: URL, card: CardFn, random?: RandomFn): Promise<Response> {
  // ?random=1 answers with a card chosen at random, in the same shape, and is never cached.
  const atRandom = random !== undefined && url.searchParams.has("random");
  const set = (url.searchParams.get("set") ?? "").trim().toLowerCase();
  const number = (url.searchParams.get("cn") ?? "").trim();
  if (!atRandom && (!/^[a-z0-9]{2,10}$/.test(set) || !number || number.length > 20)) {
    return error(400, "A card is named by its set code and collector number: /api/card?set=mh2&cn=45.");
  }
  const started = performance.now();
  let page: CardPage | null;
  try {
    page = atRandom ? await random() : await card(set, number);
  } catch (cause) {
    console.error(atRandom ? "random card failed:" : `card lookup failed for ${set}/${JSON.stringify(number)}:`, cause);
    const setup = setupProblem(cause);
    if (setup) return error(503, setup);
    return error(502, "The search backend is unavailable. Try again shortly.");
  }
  if (!page && atRandom) return error(502, "Could not pick a card. Try again.");
  if (!page) return json({ error: `Nothing is numbered ${number} in the set "${set}".` }, 404, CACHED);
  const detail = hit(page.card);
  detail.stats = page.card.stats ?? null;
  for (const name of LISTS) detail[name] = Array.isArray(page.card[name]) ? page.card[name] : [];
  const printings = page.printings.map((row) => {
    const full = hit(row);
    return { id: full.id, ...Object.fromEntries(PRINTING_ROW.map((name) => [name, full[name]])) };
  });
  return json({ card: detail, printings, took_ms: Math.round(performance.now() - started) }, 200, atRandom ? NOT_CACHED : CACHED);
}

export async function handleSearch(url: URL, search: SearchFn): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!query) return error(400, "Type something to search for.");
  if (query.length > MAX_QUERY_CHARS) return error(400, `Queries are limited to ${MAX_QUERY_CHARS} characters.`);
  const k = clamp(url.searchParams.get("k"), DEFAULT_RESULTS, 1, MAX_RESULTS);
  const offset = clamp(url.searchParams.get("offset"), 0, 0, MAX_REACH - (k ?? 0));
  if (k === null || offset === null) return error(400, "k and offset must be whole numbers.");
  const order = url.searchParams.get("order");
  if (order !== null && !Object.hasOwn(ORDERS, order)) {
    return error(400, `order must be one of: ${Object.keys(ORDERS).join(", ")}.`);
  }
  // "asc" or "desc"; anything else leaves the direction to the order (newest first for dates).
  const direction = url.searchParams.get("dir");
  const descending = direction === "desc" ? true : direction === "asc" ? false : null;
  const unique = url.searchParams.get("unique");
  if (unique !== null && !UNIQUE.includes(unique)) return error(400, `unique must be one of: ${UNIQUE.join(", ")}.`);

  const started = performance.now();
  let result: Result;
  try {
    result = await search(query, { k, offset, order, descending, unique: unique as SearchOptions["unique"] });
  } catch (cause) {
    console.error(`search failed for ${JSON.stringify(query)}:`, cause);
    const setup = setupProblem(cause);
    if (setup) return error(503, setup);
    return error(502, "The search backend is unavailable. Try again shortly.");
  }
  return json(
    {
      query,
      mode: result.mode,
      total: result.total,
      unit: result.unit,
      note: result.note,
      understood: result.understood,
      ignored: result.ignored,
      exact: result.exact ? hit(result.exact) : null,
      hits: result.hits.map(hit),
      offset,
      // false when the next page of this size would pass the reach: it could not be served
      has_more: result.hasMore && offset + 2 * k <= MAX_REACH,
      sorted_by: result.sortedBy,
      sorted_desc: result.sortedBy === null ? null : Boolean(result.descending),
      took_ms: Math.round(performance.now() - started),
    },
    200,
    CACHED,
  );
}
