// Differential testing: run the same Scryfall-syntax query on Scryfall and on TopK and compare.
//
//   npm run conformance                        conformance/queries.txt
//   npm run conformance -- conformance/heldout.txt --out results.json
//
// A query passes when the totals match and, where Scryfall's full result list was fetched,
// the two sets of ids are identical: Oracle ids for cards, printing ids for `unique:prints`. Scryfall's API is used only for this comparison:
// requests are paced below their published limit for the search endpoint, answers are cached
// for a day, and the run stops if Scryfall says it is being rate-limited.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { field, filter, select } from "topk-js/query";
import { lower } from "./lower.ts";
import type { IR, Options } from "./lower.ts";
import { parse, QueryError, Unsupported } from "./parser.ts";
import { grouped, toTopk } from "./search.ts";
import type { Collection, Collections } from "./search.ts";
import { collectionsFromEnv } from "./topk.ts";

const API = "https://api.scryfall.com";
// Scryfall requires an accurate User-Agent that names the application.
const HEADERS = { "User-Agent": "mtgsearch/0.1 (conformance tests)", Accept: "application/json" };
// Scryfall's hard limit for /cards/search is 2 requests a second (https://scryfall.com/docs/api/rate-limits).
export const MIN_INTERVAL_MS = 600;
// They also ask clients to cache what they download for at least 24 hours.
const CACHE_DIR = fileURLToPath(new URL("../data/scryfall-cache/", import.meta.url));
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES = 4;
const MAX_IDS = 5000;

export type Outcome = {
  query: string;
  status: "pass" | "fail" | "unsupported" | "error";
  scryfall_total: number;
  ours_total: number;
  missing: string[]; // names Scryfall returns and we do not
  extra: string[]; // names we return and Scryfall does not
  note: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

async function scryfall(url: string): Promise<{ status: number; body: any }> {
  const cached = `${CACHE_DIR}${createHash("sha256").update(url).digest("hex")}.json`;
  if (existsSync(cached) && Date.now() - statSync(cached).mtimeMs < CACHE_MS) {
    return JSON.parse(readFileSync(cached, "utf8"));
  }
  for (let attempt = 0; ; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    let response: Response;
    try {
      response = await fetch(url, { headers: HEADERS });
    } finally {
      lastCall = Date.now();
    }
    if (response.status === 429) {
      // Scryfall limits access for 30 seconds after a 429 and may ban clients that keep going.
      if (attempt > 0) throw new Error("Scryfall is still rate-limiting us after a pause; stop and try again later");
      const pause = Math.max(Number(response.headers.get("retry-after")) || 0, 30) + 5;
      console.error(`Scryfall answered 429; pausing ${pause} seconds before one retry`);
      await sleep(pause * 1000);
      continue;
    }
    const answer = { status: response.status, body: await response.json() };
    if (response.status === 200 || response.status === 404) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cached, JSON.stringify(answer));
    }
    return answer;
  }
}

/** Run a query on Scryfall. Returns the total, the results fetched, and whether that list is complete. */
async function scryfallSearch(query: string, printings: boolean) {
  // Without a `unique:` in the query, Scryfall's API returns one result per card.
  let url: string | null = `${API}/cards/search?${new URLSearchParams({ q: query })}`;
  const found = new Map<string, string>(); // oracle id (or printing id) -> name
  let total = 0;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { status, body } = await scryfall(url);
    if (status === 404) return { total: 0, found, complete: true }; // "no cards matched"
    if (status !== 200) throw new Error(`Scryfall answered ${status} for ${query}`);
    total = body.total_cards ?? 0;
    for (const card of body.data) {
      found.set(printings ? card.id : (card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? card.id), card.name);
    }
    url = body.has_more ? body.next_page : null;
  }
  return { total, found, complete: url === null };
}

/** Run a predicate on TopK. Returns the total and up to MAX_IDS matches as id -> name. */
export async function topkMatches(cols: Collections, predicate: IR, options: Options) {
  if (options.printings && options.unique !== "prints") {
    // one result per card (or per illustration) that has a matching printing
    const groups = await grouped(cols.printings, predicate, {
      unique: options.unique, prefer: options.prefer, sortField: "name_lc", descending: false,
    });
    return { total: groups.length, found: new Map(groups.map((g) => [g.oracle_id, g.name_lc])) };
  }
  const col: Collection = options.printings ? cols.printings : cols.cards;
  const expr = toTopk(predicate);
  if (expr === null) return { total: await col.count(), found: new Map<string, string>() };
  const total = Number((await col.query(filter(expr).count()))[0]._count);
  const rows = total ? await col.query(select({ name: field("name") }).filter(expr).limit(MAX_IDS)) : [];
  return { total, found: new Map(rows.map((row) => [row._id, row.name])) };
}

export function readQueries(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export async function check(cols: Collections, query: string): Promise<Outcome> {
  const outcome: Outcome = { query, status: "fail", scryfall_total: 0, ours_total: 0, missing: [], extra: [], note: "" };
  let predicate: IR;
  let options: Options;
  try {
    [predicate, options] = lower(parse(query));
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return { ...outcome, status: error instanceof Unsupported ? "unsupported" : "error", note: error.message };
  }
  const ours = await topkMatches(cols, predicate, options);
  const theirs = await scryfallSearch(query, options.unique === "prints");
  outcome.scryfall_total = theirs.total;
  outcome.ours_total = ours.total;
  const names = (ids: Map<string, string>, other: Map<string, string>) =>
    [...ids].filter(([id]) => !other.has(id)).map(([, name]) => name).sort().slice(0, 8);
  // `unique:art` results are compared by total and by card: an illustration has no id in common.
  outcome.missing = names(theirs.found, ours.found);
  if (theirs.complete && ours.found.size >= Math.min(ours.total, MAX_IDS)) {
    outcome.extra = names(ours.found, theirs.found);
  } else {
    outcome.note = `compared totals and the first ${theirs.found.size} Scryfall results`;
  }
  if (theirs.total === ours.total && !outcome.missing.length && !outcome.extra.length) outcome.status = "pass";
  return outcome;
}

export async function run(queriesPath: string, outPath: string | null, log = console.log): Promise<Outcome[]> {
  const cols = collectionsFromEnv();
  const outcomes: Outcome[] = [];
  for (const query of readQueries(queriesPath)) {
    const o = await check(cols, query);
    outcomes.push(o);
    const detail = o.status === "pass" || o.status === "fail" ? `scryfall ${o.scryfall_total}, ours ${o.ours_total}` : o.note;
    log(`${o.status.toUpperCase().padEnd(11)} ${query.padEnd(45)} ${detail}`);
    if (o.status === "fail") {
      if (o.missing.length) log(`            we miss: ${o.missing.join("; ")}`);
      if (o.extra.length) log(`            we add:  ${o.extra.join("; ")}`);
    }
  }
  const summary = Object.fromEntries(
    ["pass", "fail", "unsupported", "error"].map((s) => [s, outcomes.filter((o) => o.status === s).length]),
  );
  log(`\n${summary.pass}/${outcomes.length} queries match Scryfall exactly; ${JSON.stringify(summary)}`);
  if (outPath) writeFileSync(outPath, `${JSON.stringify({ summary, results: outcomes }, null, 1)}\n`);
  return outcomes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out") ?? "conformance/queries.txt";
  const outcomes = await run(file, out);
  process.exit(outcomes.every((o) => o.status === "pass") ? 0 : 1);
}
