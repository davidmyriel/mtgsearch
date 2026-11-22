// `m:`, `devotion:` and `produces:`. The rules were worked out from Scryfall's answers
// (conformance/mana.txt) and match the fields built by mana_fields() in the ingest job.
import type { IR, Op } from "./lower.ts";
import { QueryError, Unsupported } from "./parser.ts";
import type { Keyword } from "./parser.ts";

const COLORS = "WUBRG";
const COLOR_NAMES: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G", colorless: "C", colourless: "C" };
// Documents hold the cost of each half of a split card, or each face that has one.
const COST_PARTS = [0, 1];
const NO_COST = "none";
// `m<=` lists every cost that fits inside the one given; refuse lists longer than this.
const MAX_SMALLER_COSTS = 200;

type Cost = { generic: number | null; symbols: Map<string, number> };

/** "2WW", "{2}{W}{W}" or "{r/w}x" -> generic amount and a count per symbol. */
export function parseCost(key: string, value: string): Cost {
  const cost: Cost = { generic: null, symbols: new Map() };
  const tokens = value.match(/\{[^}]+\}|\d+|[a-z]/gi) ?? [];
  if (tokens.join("") !== value) throw new QueryError(`'${key}' expects mana symbols such as 2WW or {R/W}, got '${value}'`);
  for (const token of tokens) {
    const symbol = token.replace(/[{}]/g, "").toUpperCase();
    if (/^\d+$/.test(symbol)) {
      cost.generic = (cost.generic ?? 0) + Number(symbol);
    } else {
      // The halves of a hybrid symbol are kept in alphabetical order, as in the documents.
      const name = symbol.split("/").sort().join("/");
      cost.symbols.set(name, (cost.symbols.get(name) ?? 0) + 1);
    }
  }
  return cost;
}

/** The canonical text of a cost; the same format as cost_key() in the ingest job. */
function costKey(generic: number, symbols: Map<string, number>): string {
  const names = [...symbols].flatMap(([name, count]) => Array<string>(count).fill(name)).sort();
  return `${generic}|${names.join(",")}`;
}

/** Every cost that fits inside `cost`: fewer or equal of each symbol and of generic mana. */
function smallerCosts(key: string, cost: Cost): string[] {
  let combos: Map<string, number>[] = [new Map()];
  for (const [name, count] of cost.symbols) {
    combos = combos.flatMap((combo) => Array.from({ length: count + 1 }, (_, n) => new Map(combo).set(name, n)));
    if (combos.length > MAX_SMALLER_COSTS) throw new Unsupported(`'${key}' with < or <= needs a shorter mana cost`);
  }
  const keys: string[] = [];
  for (let generic = 0; generic <= (cost.generic ?? 0); generic++) {
    for (const combo of combos) keys.push(costKey(generic, combo));
  }
  if (keys.length > MAX_SMALLER_COSTS) throw new Unsupported(`'${key}' with < or <= needs a shorter mana cost`);
  return keys;
}

/**
 * `m:`. A card matches when one part of its cost does. ":" and ">=" ask for at least these
 * symbols and at least this much generic mana; surplus coloured mana does not stand in for
 * generic. "=" is the exact cost, and "!=" holds when some part has a different one. "<=" is
 * any cost that fits inside this one, which a card with no cost at all does.
 */
export function mana(kw: Keyword): IR {
  const cost = parseCost(kw.key, kw.value);
  const op = kw.op === ":" ? ">=" : kw.op;
  const exact = costKey(cost.generic ?? 0, cost.symbols);
  const atLeast = (part: number): IR => {
    const tests: IR[] = [...cost.symbols].map(([name, count]): IR => ["in", "m_syms", `${part}:${name}:${count}`]);
    if (cost.generic !== null) tests.push(["cmp", `m${part}_gen`, ">=", cost.generic]);
    return ["and", tests];
  };
  const is = (part: number): IR => ["eq", `m${part}_key`, exact];
  const anyPart = (test: (part: number) => IR): IR => ["or", COST_PARTS.map(test)];
  switch (op) {
    case ">=":
      return anyPart(atLeast);
    case ">":
      return anyPart((part) => ["and", [atLeast(part), ["not", is(part)]]]);
    case "=":
      return anyPart(is);
    case "!=":
      // Some part has a different cost. Part 0 always exists (a card without a cost has the
      // key "none"); a later part exists when it has a generic amount recorded.
      return anyPart((part) => (part === 0 ? ["not", is(part)] : ["and", [["cmp", `m${part}_gen`, ">=", 0], ["not", is(part)]]]));
    case "<=":
    case "<": {
      const keys = smallerCosts(kw.key, cost).filter((key) => op === "<=" || key !== exact);
      return anyPart((part) => ["oneof", `m${part}_key`, part === 0 ? [...keys, NO_COST] : keys]);
    }
    default:
      throw new QueryError(`'${kw.key}' does not take '${kw.op}'`);
  }
}

/** A count stored only when it is above zero: a missing value reads as zero. */
function count(field: string, op: Op, n: number): IR {
  switch (op) {
    case ">=":
      return n <= 0 ? ["all"] : ["cmp", field, ">=", n];
    case ">":
      return n < 0 ? ["all"] : ["cmp", field, ">", n];
    case "<=":
      return ["not", ["cmp", field, ">", n]];
    case "<":
      return ["not", ["cmp", field, ">=", n]];
    case "=":
      return n === 0 ? ["not", ["cmp", field, ">=", 1]] : ["cmp", field, "=", n];
    case "!=":
      return ["not", count(field, "=", n)];
  }
}

/**
 * `devotion:`. The value repeats one symbol: `uuu` is devotion to blue of three or more.
 * A hybrid symbol, `{r/w}{r/w}{r/w}`, is devotion to red and white: every symbol that is red
 * or white counts once, as in the game's rules. Only permanents have devotion; the documents
 * hold no count for anything else.
 */
export function devotion(kw: Keyword): IR {
  const cost = parseCost(kw.key, kw.value);
  const [[symbol, n] = ["", 0], ...rest] = [...cost.symbols];
  const colors = symbol.split("/");
  const valid = cost.generic === null && rest.length === 0 && colors.length <= 2 && colors.every((c) => c.length === 1 && COLORS.includes(c));
  if (!valid) throw new Unsupported(`'${kw.key}' takes one colour or one two-colour hybrid symbol, repeated, such as uuu or {r/w}{r/w}`);
  const field = `dev_${colors.sort((a, b) => COLORS.indexOf(a) - COLORS.indexOf(b)).join("")}`;
  return count(field, (kw.op === ":" ? ">=" : kw.op) as Op, n);
}

/**
 * `produces:`. The colours of mana a card can make, compared as a set (":" means at least
 * these); a number compares how many different ones. A card that makes no mana never matches.
 */
export function produces(kw: Keyword): IR {
  const value = kw.value.toLowerCase();
  const op = (kw.op === ":" ? ">=" : kw.op) as Op;
  if (/^\d+$/.test(value)) return ["cmp", "produces_n", kw.op === ":" ? "=" : op, Number(value)];
  const letters = Object.hasOwn(COLOR_NAMES, value) ? COLOR_NAMES[value] : value.toUpperCase();
  if (![...letters].every((letter) => "WUBRGC".includes(letter))) throw new QueryError(`unknown colour '${kw.value}'`);
  const wanted = [...new Set(letters)];
  const others = [..."WUBRGC"].filter((letter) => !wanted.includes(letter));
  const has = (letter: string): IR => ["in", "produces", letter];
  const all: IR = ["and", wanted.map(has)];
  const nothingElse: IR = ["and", [["cmp", "produces_n", ">=", 1], ...others.map((letter): IR => ["not", has(letter)])]];
  switch (op) {
    case ">=":
      return all;
    case ">":
      return ["and", [all, ["cmp", "produces_n", ">", wanted.length]]];
    case "=":
      return ["and", [all, ["cmp", "produces_n", "=", wanted.length]]];
    case "!=":
      return ["not", ["and", [all, ["cmp", "produces_n", "=", wanted.length]]]];
    case "<=":
      return nothingElse;
    case "<":
      return ["and", [nothingElse, ["cmp", "produces_n", "<", wanted.length]]];
  }
}
