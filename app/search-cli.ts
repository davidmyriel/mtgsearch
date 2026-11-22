// Run a query from the command line:  npm run search -- "sphinx that draws two cards"
// or one query per line of a file:    npm run search -- --file queries.txt
import { readFileSync } from "node:fs";
import { search } from "./search.ts";
import { collectionsFromEnv } from "./topk.ts";

const args = process.argv.slice(2);
const queries =
  args[0] === "--file"
    ? readFileSync(args[1], "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    : [args.join(" ").trim()].filter(Boolean);
if (!queries.length) {
  console.error('usage: npm run search -- "<query>" | --file <path>');
  process.exit(2);
}
for (const query of queries) {
  if (queries.length > 1) console.log(`\n${query}`);
  const started = performance.now();
  const result = await search(collectionsFromEnv(), query, { k: 10 });
  const total = result.total === null ? "" : `, ${result.total} ${result.unit}`;
  console.log(`[${result.mode}${total}, ${Math.round(performance.now() - started)} ms] ${result.note}`);
  for (const hit of result.hits) {
    const score = typeof hit.score === "number" ? `${hit.score.toFixed(3)}  ` : "";
    const price = typeof hit.usd === "number" ? ` $${hit.usd.toFixed(2)}` : "";
    const printing = `${String(hit.set ?? "").toUpperCase()} #${hit.cn ?? "?"} ${hit.rarity ?? ""} ${hit.released ?? ""}${price}`;
    console.log(`  ${score}${hit.name}  ${hit.mana_cost ?? ""}  ${hit.type_line ?? ""}  [${printing}]`);
  }
}
