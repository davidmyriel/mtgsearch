// Step 3 of the trial: run the same searches against each wording and compare them one by one.
//
//   node experiments/trial/evaluate.ts            (needs TOPK_API_KEY)
//
// Each search goes through the whole search (the same code the site runs) against a trial
// collection, and the place of the first right card among the first ten is noted. The
// wordings are then set against today's text, search by search: which got better, which got
// worse, and by how much. The collections hold the same cards, so any difference is the text.
import { Client } from "topk-js";
import { search } from "../../app/search.ts";
import type { Collection, Collections } from "../../app/search.ts";
import { TRIALS } from "./queries.ts";

const VARIANTS: [string, string][] = [
  ["a", "today's text"],
  ["b", "symbols in words"],
  ["c", "symbols and numbers in words"],
  ["d", "today's text with the words added"],
];
const key = (process.env.TOPK_API_KEY ?? "").trim();
const client = new Client({ apiKey: key, region: process.env.TOPK_REGION || "aws-us-east-1-elastica" });
const printings = client.collection(process.env.MTGSEARCH_PRINTINGS_COLLECTION || "mtg-printings-v1") as unknown as Collection;
const cols = (variant: string): Collections => ({ cards: client.collection("mtg-trial-t1-" + variant) as unknown as Collection, printings });

const NOT_FOUND = 99;
const ranks = new Map<string, number[]>(); // query -> its rank under each wording
const firsts = new Map<string, string[]>(); // query -> the first card under each wording
for (const trial of TRIALS) {
  const row: number[] = [];
  const top: string[] = [];
  for (const [variant] of VARIANTS) {
    const result = await search(cols(variant), trial.q, { k: 10 });
    const names = result.hits.map((hit) => hit.name);
    const rank = names.findIndex((name) => trial.accept.includes(name));
    row.push(rank < 0 ? NOT_FOUND : rank + 1);
    top.push(names[0] ?? "(nothing)");
  }
  ranks.set(trial.q, row);
  firsts.set(trial.q, top);
}

const show = (rank: number) => (rank === NOT_FOUND ? " -" : String(rank).padStart(2));
console.log("place of the first right card among the first ten, under each wording (a b c d):\n");
for (const group of [...new Set(TRIALS.map((trial) => trial.group))]) {
  console.log("=== " + group + " ===");
  for (const trial of TRIALS.filter((item) => item.group === group)) {
    const row = ranks.get(trial.q)!;
    const moved = row.slice(1).map((rank) => (rank < row[0] ? "+" : rank > row[0] ? "-" : " ")).join("");
    console.log("  " + row.map(show).join(" ") + "  " + moved + "  " + trial.q);
  }
}

console.log("\ntotals over " + TRIALS.length + " searches:");
for (const [index, [variant, label]] of VARIANTS.entries()) {
  const all = [...ranks.values()].map((row) => row[index]);
  const within = (n: number) => all.filter((rank) => rank <= n).length;
  const better = [...ranks.values()].filter((row) => row[index] < row[0]).length;
  const worse = [...ranks.values()].filter((row) => row[index] > row[0]).length;
  console.log(
    "  " + variant + " (" + label + "): first " + within(1) + ", in three " + within(3) + ", in ten " + within(10) +
      (index ? " | against today: " + better + " better, " + worse + " worse" : ""),
  );
}

for (const [index, [variant, label]] of VARIANTS.entries()) {
  if (!index) continue;
  console.log("\n" + variant + " (" + label + "), search by search against today:");
  for (const trial of TRIALS) {
    const row = ranks.get(trial.q)!;
    if (row[index] === row[0]) continue;
    const top = firsts.get(trial.q)!;
    console.log(
      "  " + (row[index] < row[0] ? "better" : "WORSE ") + "  " + show(row[0]) + " -> " + show(row[index]) + "  " + trial.q +
        "   (first card: " + top[0] + " -> " + top[index] + ")",
    );
  }
}
