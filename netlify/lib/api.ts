// The HTTP contract of GET /api/search, independent of Netlify and of TopK so it can be
// unit-tested with a stubbed search. It mirrors src/mtgsearch/web.py: the page works against
// either server.

import type { Hit, Result } from "./search.ts";

export type SearchFn = (query: string, k: number) => Promise<Result>;

export const MAX_QUERY_CHARS = 200;
export const DEFAULT_RESULTS = 24;
export const MAX_RESULTS = 60;
const HIT_FIELDS = ["name", "mana_cost", "type_line", "oracle_text", "image", "scryfall_uri"];

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

function hit(row: Hit): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row._id };
  for (const name of HIT_FIELDS) out[name] = row[name] ?? null;
  if (typeof row.score === "number") out.score = Math.round(row.score * 1000) / 1000;
  return out;
}

export async function handleSearch(url: URL, search: SearchFn): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!query) return error(400, "Type something to search for.");
  if (query.length > MAX_QUERY_CHARS) return error(400, `Queries are limited to ${MAX_QUERY_CHARS} characters.`);
  const rawK = url.searchParams.get("k");
  if (rawK !== null && !/^-?\d+$/.test(rawK.trim())) return error(400, "k must be a number.");
  const k = Math.max(1, Math.min(rawK === null ? DEFAULT_RESULTS : Number.parseInt(rawK, 10), MAX_RESULTS));

  const started = performance.now();
  let result: Result;
  try {
    result = await search(query, k);
  } catch (cause) {
    console.error(`search failed for ${JSON.stringify(query)}:`, cause);
    return error(502, "The search backend is unavailable. Try again shortly.");
  }
  return json(
    {
      query,
      mode: result.mode,
      total: result.total,
      note: result.note,
      hits: result.hits.map(hit),
      took_ms: Math.round(performance.now() - started),
    },
    200,
    CACHED,
  );
}
