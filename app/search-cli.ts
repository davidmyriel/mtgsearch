// Run one query from the command line:  npm run search -- "sphinx that draws two cards"
import { search } from "./search.ts";
import { collectionFromEnv } from "./topk.ts";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('usage: npm run search -- "<query>"');
  process.exit(2);
}
const result = await search(collectionFromEnv(), query, 10);
console.log(`[${result.mode}${result.total === null ? "" : `, ${result.total} total`}] ${result.note}`);
for (const hit of result.hits) {
  const score = typeof hit.score === "number" ? `${hit.score.toFixed(3)}  ` : "";
  console.log(`  ${score}${hit.name}  ${hit.mana_cost ?? ""}  ${hit.type_line ?? ""}`);
}
