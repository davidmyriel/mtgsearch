// Step 1 of the trial: choose the cards.
//
//   node experiments/trial/sample.ts      (needs TOPK_API_KEY; writes data/trial/sample.json)
//
// The sample has to hold, for every search the trial is judged on, the right answers and the
// cards that outrank them today: otherwise a small collection makes every search look good.
// So each search is run against the live collection and its first forty results are taken,
// together with every accepted card by name. The build step adds cards at random on top.
import { mkdirSync, writeFileSync } from "node:fs";
import { search } from "../../app/search.ts";
import { collectionsFromEnv } from "../../app/topk.ts";
import { NAMED, TRIALS } from "./queries.ts";

const cols = collectionsFromEnv();
const ids = new Set<string>();
const names = new Set<string>(NAMED);
for (const trial of TRIALS) {
  const result = await search(cols, trial.q, { k: 40 });
  for (const hit of result.hits) ids.add(hit._id);
  for (const name of trial.accept) names.add(name);
  console.log(trial.group.padEnd(12) + JSON.stringify(trial.q) + " -> " + result.mode + ", " + result.hits.length + " results");
}
mkdirSync(new URL("../../data/trial/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../data/trial/sample.json", import.meta.url), JSON.stringify({ ids: [...ids], names: [...names] }, null, 1));
console.log(TRIALS.length + " searches; " + ids.size + " cards from their results, " + names.size + " named as answers");
