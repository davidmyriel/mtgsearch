// Does asking TopK for more results than are shown find better ones?
//
//   node experiments/depth.ts
//
// For each plain-English query with known answers, the full search is run asking for 10, 30,
// 60, 120 and 250 results, and the first ten of each are compared: where the first accepted
// card stands, how many of the ten differ from the ten found when only ten were asked for, and
// how long the request took. The queries are the frozen set's descriptive and numeric classes
// and the searches that failed while the home page's examples were being chosen.
import { readFileSync } from "node:fs";
import { search } from "../app/search.ts";
import { collectionsFromEnv } from "../app/topk.ts";

type Item = { q: string; accept: string[] };
const frozen = JSON.parse(readFileSync(new URL("../eval/queries.json", import.meta.url), "utf8"));
const failed: Item[] = [
  { q: "three damage for one mana", accept: ["Lightning Bolt", "Chain Lightning", "Lava Spike", "Rift Bolt"] },
  { q: "two mana counterspell", accept: ["Counterspell"] },
  { q: "search for any card", accept: ["Demonic Tutor", "Diabolic Tutor", "Vampiric Tutor"] },
  { q: "elf that taps for mana", accept: ["Llanowar Elves", "Elvish Mystic", "Fyndhorn Elves"] },
  { q: "one mana artifact that taps for two colorless mana", accept: ["Sol Ring"] },
  { q: "dwarf that destroys lands", accept: ["Dwarven Miner", "Dwarven Blastminer", "Dwarven Driller"] },
  { q: "destroy all creatures", accept: ["Wrath of God", "Day of Judgment", "Damnation"] },
];
const groups: [string, Item[]][] = [
  ["descriptive", frozen.descriptive],
  ["numeric", frozen.numeric],
  ["failed on 23 November", failed],
];
const DEPTHS = [10, 30, 60, 120, 250];
const cols = collectionsFromEnv();

for (const [label, items] of groups) {
  console.log("\n=== " + label + " (" + items.length + " queries) ===");
  const totals = DEPTHS.map(() => ({ top1: 0, top3: 0, top10: 0, changed: 0, ms: [] as number[] }));
  for (const item of items) {
    const ranks: string[] = [];
    let shallow: string[] = [];
    for (const [d, depth] of DEPTHS.entries()) {
      const started = performance.now();
      const result = await search(cols, item.q, { k: depth });
      totals[d].ms.push(performance.now() - started);
      const ten = result.hits.slice(0, 10).map((hit) => hit.name);
      if (d === 0) shallow = ten;
      const rank = ten.findIndex((name) => item.accept.includes(name));
      if (rank === 0) totals[d].top1++;
      if (rank >= 0 && rank < 3) totals[d].top3++;
      if (rank >= 0) totals[d].top10++;
      totals[d].changed += ten.filter((name) => !shallow.includes(name)).length;
      ranks.push(rank < 0 ? "-" : String(rank + 1));
    }
    console.log(JSON.stringify(item.q).padEnd(64) + " rank of the first right card at each depth: " + ranks.join("  "));
  }
  for (const [d, depth] of DEPTHS.entries()) {
    const t = totals[d];
    const sorted = [...t.ms].sort((a, b) => a - b);
    console.log(
      "  asked for " + String(depth).padStart(3) + ": first " + t.top1 + ", in three " + t.top3 + ", in ten " + t.top10 + " of " + items.length +
        " | of the first ten, " + (t.changed / items.length).toFixed(1) + " differ from asking for ten | median " + Math.round(sorted[Math.floor(sorted.length / 2)]) + " ms",
    );
  }
}
