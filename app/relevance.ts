// Relevance evaluation: run the frozen query set and score each ranking strategy.
//
//   npm run eval                               eval/queries.json
//   npm run eval -- --out eval/baseline.json
//
// Strategies, all restricted to cards Scryfall shows by default:
//
//   bm25           keyword match on the rules text
//   semantic       TopK semantic similarity on the rules text
//   semantic+tags  the same, with Scryfall's community tags appended to the text
//   both           the sum of the two semantic scores
//   search         the full pipeline: name match first, parsed filters, then `both`
//
// Single-answer classes are scored by the rank of the first accepted card. The jargon class is
// scored against the matching community tag: how many of the top 5 carry it.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { field, fn, match, select } from "topk-js/query";
import { search, semantic, toTopk, VISIBLE } from "./search.ts";
import type { Collection, Hit } from "./search.ts";
import { COLLECTION, collectionFromEnv } from "./topk.ts";

const STRATEGIES = ["bm25", "semantic", "semantic+tags", "both", "search"] as const;
type Strategy = (typeof STRATEGIES)[number];
type Item = { q: string; accept?: string[]; tag?: string };

const latency = new Map<Strategy, number[]>();

async function rank(col: Collection, strategy: Strategy, query: string, k: number): Promise<Hit[]> {
  const started = performance.now();
  let rows: Hit[];
  if (strategy === "bm25") {
    rows = await col.query(
      select({ name: field("name"), score: fn.bm25Score() })
        .filter(match(query, { field: "rules" }))
        .filter(toTopk(VISIBLE)!)
        .sort(field("score"), false)
        .limit(k),
    );
  } else if (strategy === "semantic") rows = await semantic(col, query, VISIBLE, k, ["rules"]);
  else if (strategy === "semantic+tags") rows = await semantic(col, query, VISIBLE, k, ["rules_tagged"]);
  else if (strategy === "both") rows = await semantic(col, query, VISIBLE, k, ["rules", "rules_tagged"]);
  else rows = (await search(col, query, { k })).hits;
  latency.set(strategy, [...(latency.get(strategy) ?? []), performance.now() - started]);
  return rows;
}

/** Ids of the visible cards carrying a community tag or one of its descendants. */
async function tagMembers(col: Collection, tag: string): Promise<Set<string>> {
  // Documents store each card's tag slugs together with every ancestor's, so one filter is the closure.
  const slug = tag.toLowerCase().replaceAll(" ", "-");
  const expr = toTopk(["and", [["in", "otags", slug], VISIBLE]])!;
  const rows = await col.query(select({ name: field("name") }).filter(expr).limit(5000));
  return new Set(rows.map((row) => row._id));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export async function run(queriesPath: string, outPath: string | null, classes: string[], log = console.log) {
  const col = collectionFromEnv();
  const queries = JSON.parse(readFileSync(queriesPath, "utf8")) as Record<string, Item[]>;
  const report: any = { collection: COLLECTION, classes: {} };

  for (const name of classes) {
    const items = queries[name];
    log(`\n=== ${name} (${items.length} queries) ===`);
    const scores = new Map<Strategy, (number | null)[]>(STRATEGIES.map((s) => [s, []]));
    const records: any[] = [];
    for (const item of items) {
      const record: any = { q: item.q };
      log(`\n${JSON.stringify(item.q)}`);
      const members = item.tag ? await tagMembers(col, item.tag) : null;
      for (const strategy of STRATEGIES) {
        let score: number | null;
        const rows = await rank(col, strategy, item.q, members ? 5 : 10);
        if (members) {
          score = rows.filter((row) => members.has(row._id)).length;
          log(`  ${strategy.padEnd(14)} ${score}/5 | ${rows.map((r) => r.name).join("; ")}`);
        } else {
          const index = rows.findIndex((row) => item.accept!.includes(row.name));
          score = index < 0 ? null : index + 1;
          log(`  ${strategy.padEnd(14)} rank ${String(score ?? "-").padStart(2)} | ${rows.slice(0, 3).map((r) => r.name).join("; ")}`);
        }
        scores.get(strategy)!.push(score);
        record[strategy] = { score, top: rows.slice(0, 5).map((r) => r.name) };
      }
      records.push(record);
    }

    const summary: any = {};
    for (const strategy of STRATEGIES) {
      const values = scores.get(strategy)!;
      if (items[0].tag) {
        summary[strategy] = { correct_in_top5: values.reduce((sum: number, v) => sum + (v ?? 0), 0), out_of: 5 * values.length };
      } else {
        const within = (k: number) => values.filter((v) => v !== null && v <= k).length;
        summary[strategy] = { top1: within(1), top3: within(3), top10: within(10), out_of: values.length };
      }
    }
    log(`\n--- ${name} summary ---`);
    for (const strategy of STRATEGIES) log(`  ${strategy.padEnd(14)} ${JSON.stringify(summary[strategy])}`);
    report.classes[name] = { summary, queries: records };
  }

  report.latency_ms = Object.fromEntries(
    [...latency].map(([s, v]) => [s, { median: Math.round(median(v)), max: Math.round(Math.max(...v)), n: v.length }]),
  );
  log("\n--- client-side latency per query, ms (includes network) ---");
  for (const [strategy, stats] of Object.entries(report.latency_ms)) log(`  ${strategy.padEnd(14)} ${JSON.stringify(stats)}`);
  if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const classes = value("--classes")?.split(",") ?? ["descriptive", "numeric", "jargon"];
  const file = args.find((a, i) => !a.startsWith("--") && !["--out", "--classes"].includes(args[i - 1])) ?? "eval/queries.json";
  await run(file, value("--out"), classes);
}
