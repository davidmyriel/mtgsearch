// The searches the trial is judged on, each with the cards that count as the right answer.
//
// Three sources: the frozen set's descriptive and numeric classes; the searches that failed
// while the home page's examples were being chosen; and the home page's own examples that are
// ranked by meaning, with the cards the live tests say each must find.
import { readFileSync } from "node:fs";
import { jargon } from "../../app/jargon.ts";

export type Trial = { group: string; q: string; accept: string[] };

const here = (path: string) => new URL(path, import.meta.url);
const frozen = JSON.parse(readFileSync(here("../../eval/queries.json"), "utf8"));

const failed: Omit<Trial, "group">[] = [
  { q: "three damage for one mana", accept: ["Lightning Bolt", "Chain Lightning", "Lava Spike", "Rift Bolt"] },
  { q: "two mana counterspell", accept: ["Counterspell"] },
  { q: "search for any card", accept: ["Demonic Tutor", "Diabolic Tutor", "Vampiric Tutor"] },
  { q: "elf that taps for mana", accept: ["Llanowar Elves", "Elvish Mystic", "Fyndhorn Elves"] },
  { q: "destroy all creatures", accept: ["Wrath of God", "Day of Judgment", "Damnation"] },
  { q: "artifact that taps for two mana", accept: ["Sol Ring", "Mana Vault", "Worn Powerstone", "Thran Dynamo"] },
  { q: "deals two damage to any target", accept: ["Shock"] },
];

/** The examples' expected cards, read out of the live test so there is one copy of them. */
function examples(): Omit<Trial, "group">[] {
  const source = readFileSync(here("../../app/test/live.test.ts"), "utf8");
  const block = source.slice(source.indexOf("const FINDS"), source.indexOf("};", source.indexOf("const FINDS")));
  const found: Omit<Trial, "group">[] = [];
  for (const line of block.split("\n")) {
    const entry = /^\s*"([^"]+)": \[(.*)\],$/.exec(line);
    // a players' word is answered from tags, not from the embedded text: nothing to compare
    if (entry && !jargon(entry[1])) found.push({ q: entry[1], accept: JSON.parse("[" + entry[2] + "]") });
  }
  return found;
}

export const TRIALS: Trial[] = [
  ...frozen.descriptive.map((item: Omit<Trial, "group">) => ({ group: "descriptive", ...item })),
  ...frozen.numeric.map((item: Omit<Trial, "group">) => ({ group: "numeric", ...item })),
  ...failed.map((item) => ({ group: "failed", ...item })),
  ...examples().map((item) => ({ group: "examples", ...item })),
];

/** Cards a query names, which have to be in the sample for "X alternative" to be read at all. */
export const NAMED = ["Tithe", "Shock", "Brainstorm", "Dark Ritual", "Llanowar Elves", "Sol Ring", "Counterspell", "Lightning Bolt"];
