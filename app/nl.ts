// Pull hard filters out of a plain-English query. Port of src/mtgsearch/nl.py (the reference).
//
// Embeddings are poor at numbers and mana symbols, so the opening noun phrase of a query
// ("one mana blue artifact ...") is read for mana value, colours and card types, which become
// filters. Only that opening phrase is read: "protection from red" never becomes a filter.

import { COLOR_NAMES, colors } from "./lower.ts";
import type { IR } from "./lower.ts";
import typeWords from "./type-words.json" with { type: "json" };

export type Extracted = { predicate: IR; notes: string[]; any: boolean };

const KNOWN = new Set<string>(typeWords);
const NUMBER_NAMES =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen".split(" ");
const NUMBER_WORDS = new Map(NUMBER_NAMES.map((word, n) => [word, n]));
const NUM = `(?:\\d{1,2}|${NUMBER_NAMES.join("|")})`;
const ARTICLES = new Set(["a", "an", "the", "any", "some"]);
const FILLERS = new Set(["big", "small", "cheap", "huge", "giant", "little", "good", "best", "powerful", "strong", "mono"]);
const COLOR_WORDS = new Set([...Object.keys(COLOR_NAMES), "colorless", "colourless"]);
// Words that are types in the catalogue but usually mean something else at the start of a sentence.
const NOT_TYPES = new Set(["card", "cards", "spell", "spells", "permanent", "permanents", "token", "tokens"]);
// "... for four mana" at the end of a query is a cost, unless it follows a verb about producing mana.
// \p{L}\p{N}_ stands in for Python's Unicode-aware \w.
const TRAILING_COST = new RegExp(`(?<![\\p{L}\\p{N}_])([\\p{L}\\p{N}_]+) for (${NUM}) mana$`, "u");
const MANA_PRODUCERS = new Set(["tap", "taps", "add", "adds", "produce", "produces", "make", "makes", "pay", "pays"]);
// A type word followed by one of these names what the effect is done to, not what the card
// is: "land destruction" is not a search for lands, nor "creature removal" for creatures.
const DONE_TO = new Set(
  (
    "destruction removal hate kill killer wipe wipes sweeper sweepers bounce theft steal tutor tutors " +
    "fetch search recursion reanimation protection denial token tokens sacrifice sac exile hoser lock"
  ).split(" "),
);
const MANA_VALUE = new RegExp(`^(${NUM})[- ](?:mana|cmc|mv|drop)\\b|^(?:cmc|mv|mana value) (${NUM})\\b`);

const number = (token: string) => NUMBER_WORDS.get(token) ?? Number.parseInt(token, 10);

/** The type word a possibly plural word stands for ("elves" -> "elf"), or null. */
function singular(word: string): string | null {
  const candidates: string[] = [];
  // Plural forms first: "elves" is itself a type word on one old card, but it means Elf.
  if (word.endsWith("ves")) candidates.push(`${word.slice(0, -3)}f`);
  if (word.endsWith("ies")) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) candidates.push(word.slice(0, -2));
  if (word.endsWith("s")) candidates.push(word.slice(0, -1));
  candidates.push(word);
  return candidates.find((c) => KNOWN.has(c)) ?? null;
}

/** Read mana value, colours and types from the opening noun phrase of `query`. */
export function extract(query: string): Extracted {
  const text = query.toLowerCase().trim().replace(/\s+/g, " ");
  const parts: IR[] = [];
  const notes: string[] = [];
  let manaValue: number | null = null;
  const colorWords: string[] = [];
  const types: string[] = [];

  let rest = text;
  while (rest) {
    const cost = MANA_VALUE.exec(rest);
    if (cost && manaValue === null) {
      manaValue = number(cost[1] || cost[2]);
      rest = rest.slice(cost[0].length).replace(/^[ ,]+/, "");
      continue;
    }
    const word = /^[a-z'-]+/.exec(rest);
    if (!word) break;
    const token = word[0].replace(/^[-']+|[-']+$/g, "");
    const type = NOT_TYPES.has(token) ? null : singular(token);
    if (ARTICLES.has(token) || FILLERS.has(token)) {
      // skip
    } else if (COLOR_WORDS.has(token)) {
      colorWords.push(token);
    } else if (type) {
      types.push(type);
    } else {
      break;
    }
    rest = rest.slice(word[0].length).replace(/^[ ,-]+/, "");
  }

  // "blue land destruction": the types just read are what the effect is done to. They stay
  // part of the meaning and are not a filter; a colour before them still describes the card.
  const doneTo = types.length > 0 && DONE_TO.has(/^[a-z'-]+/.exec(rest)?.[0] ?? "");
  if (doneTo) types.length = 0;

  if (manaValue === null) {
    const trailing = TRAILING_COST.exec(text);
    if (trailing && !MANA_PRODUCERS.has(trailing[1])) manaValue = number(trailing[2]);
  }

  if (manaValue !== null) {
    parts.push(["cmp", "cmc", "=", manaValue]);
    notes.push(`mana value ${manaValue}`);
  }
  // A colour only counts when it describes a card: "blue sphinx", not a query that is just "red".
  if (colorWords.length && (types.length || manaValue !== null || doneTo)) {
    for (const color of colorWords) {
      parts.push(colors("c_sets", ":", color, ">="));
      notes.push(color);
    }
  }
  for (const type of types) {
    parts.push(["in", "type_words", type]);
    notes.push(type);
  }

  if (parts.length === 0) return { predicate: ["all"], notes: [], any: false };
  return { predicate: parts.length === 1 ? parts[0] : ["and", parts], notes, any: true };
}
