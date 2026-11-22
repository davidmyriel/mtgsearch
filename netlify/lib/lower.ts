// Lower a parsed Scryfall query to a small predicate IR over document fields.
//
// Port of src/mtgsearch/syntax/lower.py (the reference). All keyword semantics live here.
//
//   ["all"]                         every card
//   ["and", [p...]] ["or", [p...]] ["not", p]
//   ["eq", field, value]            scalar equality
//   ["cmp", field, op, number]      numeric comparison; a missing value never matches
//   ["has", field, text]            substring of a text field
//   ["in", field, value]            membership in a list field
//   ["re", field, pattern]          case-insensitive, multi-line regular expression

import { fold, plain } from "./normalize.ts";
import { KEYWORDS, QueryError, Unsupported } from "./parser.ts";
import type { Keyword, Node } from "./parser.ts";
import typeWords from "./type-words.json" with { type: "json" };

export type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";
export type IR =
  | ["all"]
  | ["and", IR[]]
  | ["or", IR[]]
  | ["not", IR]
  | ["eq", string, string | number | boolean]
  | ["cmp", string, Op, number]
  | ["has", string, string]
  | ["in", string, string]
  | ["re", string, string];

export type Options = { includeExtras: boolean; order: string | null; descending: boolean };

const TYPE_WORDS = new Set<string>(typeWords);
const COLORS = "WUBRG";
export const COLOR_NAMES: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const COLOR_SETS: Record<string, string> = {
  // guilds
  azorius: "WU", dimir: "UB", rakdos: "BR", gruul: "RG", selesnya: "GW",
  orzhov: "WB", izzet: "UR", golgari: "BG", boros: "RW", simic: "GU",
  // shards and wedges
  bant: "GWU", esper: "WUB", grixis: "UBR", jund: "BRG", naya: "RGW",
  abzan: "WBG", jeskai: "URW", sultai: "BGU", mardu: "RWB", temur: "GUR",
  // colleges
  silverquill: "WB", prismari: "UR", witherbloom: "BG", lorehold: "RW", quandrix: "GU",
  // four colours, named for the colour they lack
  chaos: "UBRG", aggression: "WBRG", altruism: "WURG", growth: "WUBG", artifice: "WUBR",
};
const FORMAT_ALIASES: Record<string, string> = { edh: "commander", pdh: "paupercommander" };
const FLAGS = new Set([
  "split", "flip", "transform", "meld", "leveler", "mdfc", "dfc", "permanent", "spell", "historic",
  "vanilla", "bear", "commander", "hybrid", "phyrexian", "reserved", "gamechanger", "funny",
]);
const FLAG_ALIASES: Record<string, string> = { tdfc: "transform" };
const STATS: Record<string, string> = { power: "pow", toughness: "tou", loyalty: "loy" };
const ORDER_FIELDS: Record<string, string> = {
  name: "name_lc", cmc: "cmc", mv: "cmc", power: "pow_max", toughness: "tou_max", edhrec: "edhrec_rank",
};
// Card types whose mention reveals cards that are otherwise hidden as extras.
const EXTRA_TYPES = /\b(vanguard|plane|scheme|phenomenon|token|emblem)\b/;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const FLIP: Record<string, Op> = { ">": "<", "<": ">", ">=": "<=", "<=": ">=", "=": "=", "!=": "!=" };
const RELATIONS: Record<string, string[]> = {
  ">": [">"], "<": ["<"], "=": ["="], ">=": [">", "="], "<=": ["<", "="], "!=": [">", "<"],
};

// A colour set is a bitmask over WUBRG. ALL_COLOR_SETS is ordered as Python's
// itertools.combinations yields them (by size, then by position), because the order of the
// generated "or" must match the reference.
type ColorSet = { mask: number; size: number; key: string };

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === k) {
      out.push(chosen);
      return;
    }
    for (let i = start; i < n; i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return out;
}

const ALL_COLOR_SETS: ColorSet[] = [];
for (let size = 0; size <= COLORS.length; size++) {
  for (const indexes of combinations(COLORS.length, size)) {
    ALL_COLOR_SETS.push({
      mask: indexes.reduce((m, i) => m | (1 << i), 0),
      size,
      key: indexes.map((i) => COLORS[i]).join("") || "C",
    });
  }
}

const maskOf = (letters: string) => [...letters.toUpperCase()].reduce((m, ch) => m | (1 << COLORS.indexOf(ch)), 0);

const SET_COMPARE: Record<string, (s: number, w: number) => boolean> = {
  ">=": (s, w) => (s & w) === w,
  ">": (s, w) => (s & w) === w && s !== w,
  "<=": (s, w) => (s & w) === s,
  "<": (s, w) => (s & w) === s && s !== w,
  "=": (s, w) => s === w,
  "!=": (s, w) => s !== w,
};
const NUM_COMPARE: Record<string, (a: number, b: number) => boolean> = {
  ">=": (a, b) => a >= b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  "<": (a, b) => a < b,
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

/** A plain decimal number: no "inf", "nan", "1_000" or padding. */
function number(key: string, value: string): number {
  if (!DECIMAL.test(value)) throw new QueryError(`'${key}' expects a number, got '${value}'`);
  return Number.parseFloat(value);
}

function anyOf(field: string, values: string[]): IR {
  if (values.length === 0) return ["not", ["all"]];
  return ["or", values.map((v): IR => ["in", field, v])];
}

/**
 * `c:` and `id:`. A card matches when any of its faces' colour sets satisfies the comparison.
 * Documents store each face's colours as one string ("WU", "C" for colourless), so every
 * comparison becomes: is one of the satisfying colour sets present?
 */
export function colors(field: string, op: string, value: string, defaultOp: string): IR {
  const v = value.toLowerCase();
  let keep: ColorSet[];
  if (v === "m" || v === "multicolor" || v === "multicolour") {
    keep = ALL_COLOR_SETS.filter((s) => s.size > 1);
  } else if (/^\d+$/.test(v)) {
    const compare = NUM_COMPARE[op === ":" ? "=" : op];
    keep = ALL_COLOR_SETS.filter((s) => compare(s.size, Number.parseInt(v, 10)));
  } else {
    let wanted: number;
    if (v === "c" || v === "colorless" || v === "colourless") {
      wanted = 0;
      if (op === ":") op = "=";
    } else if (Object.hasOwn(COLOR_NAMES, v)) {
      wanted = maskOf(COLOR_NAMES[v]);
    } else if (Object.hasOwn(COLOR_SETS, v)) {
      wanted = maskOf(COLOR_SETS[v]);
    } else if ([...v].every((ch) => "wubrg".includes(ch))) {
      wanted = maskOf(v);
    } else {
      throw new QueryError(`unknown colour '${value}'`);
    }
    const compare = SET_COMPARE[op === ":" ? defaultOp : op];
    keep = ALL_COLOR_SETS.filter((s) => compare(s.mask, wanted));
  }
  if (keep.length === ALL_COLOR_SETS.length) return ["all"];
  return anyOf(field, keep.map((s) => s.key));
}

/** Scryfall allows literal mana symbols such as {T} in a regex; escape those braces. */
function regex(pattern: string): string {
  if (/\\s(pp|mm|pt)/.test(pattern)) {
    throw new Unsupported("Scryfall's \\spp, \\smm and \\spt regex shorthands are not supported yet");
  }
  return pattern.replace(/\{([^}\d,][^}]*)\}/g, "\\{$1\\}");
}

function text(field: string, kw: Keyword): IR {
  if (kw.op !== ":" && kw.op !== "=") throw new QueryError(`'${kw.key}' does not take '${kw.op}'`);
  return kw.regex ? ["re", field, regex(kw.value)] : ["has", field, fold(kw.value)];
}

/** A complete type word ("fish") matches whole words only; anything else matches as a substring. */
function type(kw: Keyword): IR {
  if (kw.regex || (kw.op !== ":" && kw.op !== "=")) return text("type_lc", kw);
  const value = fold(kw.value);
  return TYPE_WORDS.has(value) ? ["in", "type_words", value] : ["has", "type_lc", value];
}

/** Name contains the text, ignoring case, diacritics and punctuation ("urzas" finds "Urza's"). */
function name(value: string): IR {
  if (plain(value) === fold(value)) return ["has", "name_plain", plain(value)];
  if (!plain(value)) return ["has", "name_lc", fold(value)];
  return ["or", [["has", "name_lc", fold(value)], ["has", "name_plain", plain(value)]]];
}

/** pow, tou and loy match when any face satisfies the comparison; pow can be compared with tou. */
function stat(kw: Keyword, canonical: string): IR {
  const prefix = STATS[canonical];
  let op = (kw.op === ":" ? "=" : kw.op) as Op;
  const other = KEYWORDS.get(kw.value.toLowerCase());
  if (other != null && (Object.hasOwn(STATS, other) || other === "powtou")) {
    const pair = new Set([canonical, other]);
    if (!(pair.size === 2 && pair.has("power") && pair.has("toughness"))) {
      throw new Unsupported(`comparing ${canonical} with ${other} is not supported yet`);
    }
    if (canonical === "toughness") op = FLIP[op]; // tou>pow is pow<tou
    return anyOf("stat_rel", RELATIONS[op].map((r) => `pow${r}tou`));
  }
  const n = number(kw.key, kw.value);
  const low = `${prefix}_min`;
  const high = `${prefix}_max`;
  if (op === ">" || op === ">=") return ["cmp", high, op, n];
  if (op === "<" || op === "<=") return ["cmp", low, op, n];
  return ["or", [["cmp", low, op, n], ["cmp", high, op, n]]];
}

function keyword(kw: Keyword, options: Options): IR {
  const canonical = KEYWORDS.get(kw.key);
  if (canonical == null) throw new Unsupported(`'${kw.key}:' is not supported yet`);
  const { op, value } = kw;
  const numericOp = (op === ":" ? "=" : op) as Op;
  if (kw.regex && !["type", "oracle", "fulloracle", "name"].includes(canonical)) {
    throw new QueryError(`'${kw.key}' does not take a regular expression`);
  }

  if (canonical === "color") return colors("c_sets", op, value, ">=");
  if (canonical === "identity") return colors("id_sets", op, value, "<=");
  if (canonical === "type") {
    if (!kw.regex && EXTRA_TYPES.test(value.toLowerCase())) options.includeExtras = true;
    return type(kw);
  }
  if (canonical === "oracle") return text(value.includes("~") ? "oracle_tilde_lc" : "oracle_lc", kw);
  if (canonical === "fulloracle") return text("fulloracle_lc", kw);
  if (canonical === "name") {
    if (kw.regex) {
      options.includeExtras = true; // observed: a name regex on Scryfall also searches extras
      return ["re", "name_lc", regex(value)];
    }
    return name(value);
  }
  if (canonical === "keyword") return ["in", "keywords_lc", fold(value)];
  if (canonical === "manavalue") {
    const parity = value.toLowerCase();
    if (parity === "even" || parity === "odd") return ["eq", "cmc_even", parity === "even"];
    return ["cmp", "cmc", numericOp, number(kw.key, value)];
  }
  if (Object.hasOwn(STATS, canonical)) return stat(kw, canonical);
  if (canonical === "powtou") return ["cmp", "pt_num", numericOp, number(kw.key, value)];
  if (canonical === "format" || canonical === "banned" || canonical === "restricted") {
    const format = FORMAT_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
    return ["in", canonical === "format" ? "legal" : canonical, format];
  }
  if (canonical === "is" || canonical === "not") {
    const flag = FLAG_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
    if (!FLAGS.has(flag)) throw new Unsupported(`'${kw.key}:${value}' is not supported yet`);
    // playtest and holiday cards are only findable this way
    if (canonical === "is" && flag === "funny") options.includeExtras = true;
    const test: IR = ["in", "flags", flag];
    return canonical === "is" ? test : ["not", test];
  }
  if (canonical === "otag") return ["in", "otags", value.toLowerCase().replaceAll(" ", "-")];
  if (canonical === "edhrec") return ["cmp", "edhrec_rank", numericOp, number(kw.key, value)];

  // display directives: they change options, not which cards match
  if (canonical === "include") {
    if (value.toLowerCase() !== "extras") throw new Unsupported(`'include:${value}' is not supported yet`);
    options.includeExtras = true;
  } else if (canonical === "order") {
    if (!Object.hasOwn(ORDER_FIELDS, value.toLowerCase())) {
      throw new Unsupported(`'order:${value}' is not supported yet`);
    }
    options.order = ORDER_FIELDS[value.toLowerCase()];
  } else if (canonical === "direction") {
    options.descending = value.toLowerCase().startsWith("desc");
  } else if (canonical === "unique" && value.toLowerCase() !== "cards") {
    throw new Unsupported(`'unique:${value}' is not supported yet`);
  }
  return ["all"];
}

function lowerNode(node: Node, options: Options): IR {
  switch (node.kind) {
    case "and":
      return ["and", node.children.map((c) => lowerNode(c, options))];
    case "or":
      return ["or", node.children.map((c) => lowerNode(c, options))];
    case "not":
      return ["not", lowerNode(node.child, options)];
    case "name":
      return node.exact ? ["in", "names_lc", fold(node.text)] : name(node.text);
    case "keyword":
      return keyword(node, options);
  }
}

const isAll = (p: IR) => p[0] === "all";

/** Flatten nested and/or and drop ["all"] from conjunctions. */
export function simplify(p: IR): IR {
  if (p[0] === "and" || p[0] === "or") {
    let kids: IR[] = [];
    for (const kid of p[1].map(simplify)) {
      if (kid[0] === p[0]) kids.push(...(kid[1] as IR[]));
      else kids.push(kid);
    }
    if (p[0] === "and") {
      kids = kids.filter((k) => !isAll(k));
      if (kids.length === 0) return ["all"];
    } else if (kids.some(isAll)) {
      return ["all"];
    }
    return kids.length === 1 ? kids[0] : [p[0], kids];
  }
  if (p[0] === "not") return ["not", simplify(p[1])];
  return p;
}

/** AST -> [predicate IR, display options]. Extras are hidden unless the query reveals them. */
export function lower(ast: Node): [IR, Options] {
  const options: Options = { includeExtras: false, order: null, descending: false };
  let predicate = lowerNode(ast, options);
  if (!options.includeExtras) predicate = ["and", [predicate, ["eq", "extra", false]]];
  return [simplify(predicate), options];
}
