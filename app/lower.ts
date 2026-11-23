// Lower a parsed Scryfall query to a small predicate IR over document fields.
//
// All keyword semantics live here. Field names are those of the documents the ingest job
// builds: card fields exist in both collections, printing fields only in the printings one.
//
//   ["all"]                         every card
//   ["and", [p...]] ["or", [p...]] ["not", p]
//   ["eq", field, value]            scalar equality
//   ["cmp", field, op, number]      numeric comparison; a missing value never matches
//   ["has", field, text]            substring of a text field
//   ["in", field, value]            membership in a list field
//   ["oneof", field, values]        a text field equal to one of several values
//   ["re", field, pattern]          case-insensitive, multi-line regular expression

import { devotion, mana, produces } from "./mana.ts";
import { fold, plain } from "./normalize.ts";
import { KEYWORDS, QueryError, Unsupported } from "./parser.ts";
import { shortcut } from "./shortcuts.ts";
import type { Keyword, Node } from "./parser.ts";
import printingFlags from "./printing-flags.json" with { type: "json" };
import setDates from "./sets.json" with { type: "json" };
import blocks from "./blocks.json" with { type: "json" };
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
  | ["oneof", string, string[]]
  | ["re", string, string];

export type Unique = "cards" | "prints" | "art";
export type Options = {
  includeExtras: boolean;
  order: string | null; // the document field to sort on
  descending: boolean;
  unique: Unique; // what a result is: a card, a printing, or a distinct illustration
  prefer: string | null; // which printing shows a card: a PREFER key
  printings: boolean; // the query can only be answered from the printings collection
};

const TYPE_WORDS = new Set<string>(typeWords);
const COLORS = "WUBRG";
export const COLOR_NAMES: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
export const COLOR_SETS: Record<string, string> = {
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
export const FORMAT_ALIASES: Record<string, string> = { edh: "commander", pdh: "paupercommander" };
const FLAGS = new Set([
  "split", "flip", "transform", "meld", "leveler", "mdfc", "dfc", "permanent", "spell", "historic",
  "vanilla", "bear", "commander", "hybrid", "phyrexian", "reserved", "gamechanger", "funny",
]);
const FLAG_ALIASES: Record<string, string> = { tdfc: "transform" };
const STATS: Record<string, string> = { power: "pow", toughness: "tou", loyalty: "loy" };
export const ORDER_FIELDS: Record<string, string> = {
  name: "name_lc", cmc: "cmc", mv: "cmc", power: "pow_max", toughness: "tou_max", edhrec: "edhrec_rank",
  released: "date", usd: "usd_c", eur: "eur_c", tix: "tix_c", rarity: "rarity_rank",
};
/** Fields that only printing documents have. A predicate or sort that uses one needs that collection. */
export const PRINTING_FIELDS = new Set([
  "set", "set_type", "cn", "cn_num", "rarity", "rarity_rank", "artist_lc", "flavor_lc", "watermarks",
  "border", "frame", "frame_effects", "stamp", "games", "year", "date", "usd_c", "eur_c", "tix_c", "pflags",
]);
/** `prefer:` values: the field that picks a card's printing, and whether the highest value wins. */
export const PREFER: Record<string, [string, boolean]> = {
  oldest: ["date", false], newest: ["date", true],
  "usd-low": ["usd_c", false], "usd-high": ["usd_c", true],
  "eur-low": ["eur_c", false], "eur-high": ["eur_c", true],
  "tix-low": ["tix_c", false], "tix-high": ["tix_c", true],
};
export const RARITIES = ["common", "uncommon", "rare", "special", "mythic", "bonus"]; // in rank order
export const RARITY_ALIASES: Record<string, string> = { c: "common", u: "uncommon", r: "rare", s: "special", m: "mythic", b: "bonus" };
const GAMES = new Set(["paper", "mtgo", "arena", "astral", "sega"]);
const FRAMES = new Set(["1993", "1997", "2003", "2015", "future"]);
const PRINTING_FLAGS = new Set<string>(printingFlags);
// `is:` words that are not stored under their own name.
const PRINTING_FLAG_ALIASES: Record<string, IR> = {
  full: ["in", "pflags", "fullart"],
  ub: ["in", "pflags", "universesbeyond"],
  showcase: ["in", "frame_effects", "showcase"],
  extended: ["in", "frame_effects", "extendedart"],
  extendedart: ["in", "frame_effects", "extendedart"],
  borderless: ["eq", "border", "borderless"],
  old: ["or", [["eq", "frame", "1993"], ["eq", "frame", "1997"]]],
  new: ["eq", "frame", "2015"],
};
const SET_DATES: Record<string, string> = setDates;
// Blocks of sets, from Scryfall's list of sets (`mtgsearch catalog`). `sets` says which block
// each set stands for; a set outside every block stands for itself and is not in `blocks`.
// `names` is every set's name, folded, and its code.
export const BLOCKS: {
  sets: Record<string, string>;
  blocks: Record<string, { name: string; sets: string[] }>;
  names: Record<string, string>;
} = blocks;
const BLOCK_NAMES = new Map(Object.entries(BLOCKS.blocks).map(([code, block]) => [fold(block.name), code]));
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
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

// Scryfall's regex shorthands (its "Scryfall Extensions"), written out as ordinary regex.
// Its help page describes what each one matches but not the expression, so these were
// checked against its answers (conformance/regex.txt). The fields they run on are lowercased.
const COLOR_SYMBOL = String.raw`[wubrg]`;
const HYBRID = String.raw`(?:[wubrgc2]/[wubrg](?:/p)?)`;
const PHYREXIAN = String.raw`(?:p|[wubrg]/p|[wubrg]/[wubrg]/p)`;
const MANA = String.raw`(?:[wubrgcsxyz]|[0-9]+|h[wubrg]|${HYBRID}|${PHYREXIAN})`;
// A repeated symbol would need a back-reference, which TopK's regex engine does not have.
// Every symbol that occurs twice in a row is listed: single letters, two-colour hybrids,
// {2/W} and Phyrexian.
const REPEATABLE = [
  ..."wubrgcsx",
  ...[..."wubrg"].flatMap((a) => [..."wubrg"].filter((b) => b !== a).map((b) => `${a}/${b}`)),
  ...[..."wubrg"].flatMap((a) => [`2/${a}`, `${a}/p`]),
];
const REPEATED = REPEATABLE.map((symbol) => String.raw`\{${symbol}\}\{${symbol}\}`).join("|");
const SHORTHANDS: [string, string][] = [
  // longest first, so that \smr is not read as \sm followed by r
  [String.raw`\smr`, `(?:${REPEATED})`], // a mana symbol twice in a row
  [String.raw`\smh`, String.raw`\{${HYBRID}\}`], // a hybrid symbol
  // a Phyrexian symbol with its colour; a bare {P} is the pawprint on the Seasons, which Scryfall leaves out
  [String.raw`\smp`, String.raw`\{(?:[wubrg]/p|[wubrg]/[wubrg]/p)\}`],
  [String.raw`\smm`, String.raw`[-−][0-9x]+/[-−][0-9x]+`], // -X/-X
  [String.raw`\spp`, String.raw`\+[0-9x]+/\+[0-9x]+`], // +X/+X
  [String.raw`\spt`, String.raw`[0-9x*]+/[0-9x*]+`], // X/X
  [String.raw`\sm`, String.raw`\{${MANA}\}`], // any mana symbol
  [String.raw`\sc`, String.raw`\{(?:${COLOR_SYMBOL}|${HYBRID}|[wubrg]/p|[wubrg]/[wubrg]/p)\}`], // a coloured mana symbol
  [String.raw`\ss`, String.raw`\{[^}]+\}`], // any symbol, {T} included
];

/**
 * A user's regex made ready for TopK. Scryfall allows literal symbols such as {T} in a regex,
 * so those braces are escaped; then its shorthands are written out.
 */
function regex(pattern: string): string {
  let out = pattern.replace(/\{([^}\d,][^}]*)\}/g, "\\{$1\\}");
  for (const [shorthand, expansion] of SHORTHANDS) out = out.replaceAll(shorthand, expansion);
  return out;
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

/**
 * Name contains the text, ignoring case, diacritics and punctuation ("urzas" finds "Urza's").
 * A flavour name counts as well: "godzilla" finds the cards that were printed as one. A name
 * that is only printed on a card (Rick, Steadfast Leader) does not: Scryfall finds those by
 * the whole name alone (see `whole`).
 *
 * `alt_plain` holds a card's flavour names from all of its printings, and on a printing that
 * printing's own. A name that is ruled out is looked for in `alt_own_plain`, which only
 * printings have: `-godzilla` drops Zilortha's Godzilla printing and keeps the card, whose
 * other printings are not Godzilla, as Scryfall does.
 */
function name(value: string, negated: boolean): IR {
  const words = plain(value);
  if (!words) return ["has", "name_lc", fold(value)];
  const own: IR[] = words === fold(value) ? [] : [["has", "name_lc", fold(value)]];
  return ["or", [...own, ["has", "name_plain", words], ["has", negated ? "alt_own_plain" : "alt_plain", words]]];
}

/**
 * `!"..."`: the whole name of the card, of one of its faces, or any other name one of its
 * printings goes by. Punctuation may be left out, as on Scryfall: `!"urzas saga"`.
 */
function whole(value: string, negated: boolean): IR {
  const words = plain(value);
  if (!words) return ["in", "names_lc", fold(value)];
  const other = negated ? "alt_own_names_plain" : "alt_names_plain";
  return ["or", [["in", "names_lc", fold(value)], ["eq", "name_plain", words], ["in", other, words]]];
}

/**
 * The code of the block a `block:` value names. The value is a block's code, the code or
 * the whole name of any set (`worldwake` is the Zendikar block), or a block's name.
 */
export function blockOf(value: string): string | null {
  const wanted = fold(value);
  // a block's code need not be a set's: From the Vault is `ftv`, and no set is
  if (Object.hasOwn(BLOCKS.blocks, wanted)) return wanted;
  if (Object.hasOwn(BLOCKS.sets, wanted)) return BLOCKS.sets[wanted];
  if (Object.hasOwn(BLOCKS.names, wanted)) return BLOCKS.sets[BLOCKS.names[wanted]];
  return BLOCK_NAMES.get(wanted) ?? null;
}

/**
 * `block:` takes the code of any set in the block (`b:wwk` is the Zendikar block) or the
 * block's name. A set that belongs to no block stands for itself. As on Scryfall, a value
 * that names nothing finds nothing; it is not an error.
 */
function block(kw: Keyword): IR {
  if (kw.regex || (kw.op !== ":" && kw.op !== "=")) throw new QueryError(`'${kw.key}' does not take '${kw.regex ? "a regular expression" : kw.op}'`);
  const code = blockOf(kw.value);
  if (code === null) return ["not", ["all"]];
  return ["oneof", "set", BLOCKS.blocks[code]?.sets ?? [code]];
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

function rarity(kw: Keyword): IR {
  const value = kw.value.toLowerCase();
  const name = RARITY_ALIASES[value] ?? value;
  const rank = RARITIES.indexOf(name);
  if (rank < 0) throw new QueryError(`unknown rarity '${kw.value}'`);
  if (kw.op === ":" || kw.op === "=") return ["eq", "rarity", name];
  return ["cmp", "rarity_rank", kw.op as Op, rank];
}

/** `date` takes a day (2015-08-18), a year, or a set code standing for that set's release date. */
function date(kw: Keyword): IR {
  const value = kw.value.toLowerCase();
  const op = (kw.op === ":" ? "=" : kw.op) as Op;
  if (/^\d{4}$/.test(value)) return ["cmp", "year", op, Number(value)];
  const day = ISO_DATE.test(value) ? value : Object.hasOwn(SET_DATES, value) ? SET_DATES[value] : null;
  if (day === null) throw new QueryError(`'${kw.key}' expects a date such as 2015-08-18, a year or a set code`);
  return ["cmp", "date", op, Number(day.replaceAll("-", ""))];
}

/** `in:` asks about the card across all its printings: a game, a rarity, or a set. */
function printedIn(kw: Keyword): IR {
  const value = word(kw);
  if (GAMES.has(value)) return ["in", "in_games", value];
  const name = RARITY_ALIASES[value] ?? value;
  if (RARITIES.includes(name) && !Object.hasOwn(SET_DATES, value)) return ["in", "in_rarities", name];
  if (Object.hasOwn(SET_DATES, value)) return ["in", "in_sets", value];
  throw new Unsupported(`'in:${kw.value}' is not supported yet (games, rarities and set codes are)`);
}

/** The lowercased value of a keyword that only takes ":" or "=". */
function word(kw: Keyword): string {
  if (kw.op !== ":" && kw.op !== "=") throw new QueryError(`'${kw.key}' does not take '${kw.op}'`);
  return kw.value.toLowerCase();
}

const exact = (field: string, kw: Keyword): IR => ["eq", field, word(kw)];

type Working = Options & { direction: string | null; negated: boolean };

function keyword(kw: Keyword, options: Working): IR {
  const canonical = KEYWORDS.get(kw.key);
  if (canonical == null) throw new Unsupported(`'${kw.key}:' is not supported yet`);
  const { op, value } = kw;
  const numericOp = (op === ":" ? "=" : op) as Op;
  if (kw.regex && !["type", "oracle", "fulloracle", "name", "flavor"].includes(canonical)) {
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
    return name(value, options.negated);
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
    // Observed on Scryfall: the seven cards removed for offensive content are hidden like
    // extras, except from a search for banned cards.
    if (canonical === "banned" && !options.negated) options.includeExtras = true;
    const format = FORMAT_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
    return ["in", canonical === "format" ? "legal" : canonical, format];
  }
  if (canonical === "is" || canonical === "not") {
    const flag = FLAG_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
    let test: IR;
    if (FLAGS.has(flag)) test = ["in", "flags", flag];
    else if (Object.hasOwn(PRINTING_FLAG_ALIASES, flag)) test = PRINTING_FLAG_ALIASES[flag];
    else if (PRINTING_FLAGS.has(flag)) test = ["in", "pflags", flag];
    else if (shortcut(flag)) test = shortcut(flag) as IR;
    else throw new Unsupported(`'${kw.key}:${value}' is not supported yet`);
    // playtest and holiday cards are only findable this way
    if (canonical === "is" && flag === "funny") options.includeExtras = true;
    return canonical === "is" ? test : ["not", test];
  }
  if (canonical === "otag") return ["in", "otags", value.toLowerCase().replaceAll(" ", "-")];
  if (canonical === "edhrec") return ["cmp", "edhrec_rank", numericOp, number(kw.key, value)];
  if (canonical === "mana") return mana(kw);
  if (canonical === "devotion") return devotion(kw);
  if (canonical === "produces") return produces(kw);

  // printing-level keywords
  if (canonical === "rarity") return rarity(kw);
  // Observed on Scryfall: naming a set, an artist or a watermark also searches the hidden
  // extras (tokens, memorabilia), so `set:tm19` lists that set's tokens.
  // Excluding one (`-set:ima`) does not.
  if (!options.negated && (canonical === "set" || canonical === "artist" || canonical === "watermark")) {
    options.includeExtras = true;
  }
  if (canonical === "set") return exact("set", kw);
  if (canonical === "block") {
    options.includeExtras = true; // observed: a block lists its tokens too, ruled in or out
    return block(kw);
  }
  if (canonical === "settype") return exact("set_type", kw);
  if (canonical === "border") return exact("border", kw);
  if (canonical === "stamp") return exact("stamp", kw);
  if (canonical === "number") {
    if (op === ":" || op === "=") return ["eq", "cn", fold(value)];
    return ["cmp", "cn_num", op as Op, number(kw.key, value)];
  }
  if (canonical === "artist") return text("artist_lc", kw);
  if (canonical === "flavor") return text("flavor_lc", kw);
  if (canonical === "watermark") return ["in", "watermarks", word(kw)];
  if (canonical === "game") return ["in", "games", word(kw)];
  if (canonical === "frame") {
    const frame = word(kw);
    return FRAMES.has(frame) ? ["eq", "frame", frame] : ["in", "frame_effects", frame];
  }
  if (canonical === "year") return ["cmp", "year", numericOp, number(kw.key, value)];
  if (canonical === "date") return date(kw);
  if (canonical === "usd" || canonical === "eur" || canonical === "tix") {
    // Prices are stored in whole cents, so comparisons are exact.
    return ["cmp", `${canonical}_c`, numericOp, Math.round(number(kw.key, value) * 100)];
  }
  // card-level facts about its printings
  if (canonical === "in") return printedIn(kw);
  if (canonical === "prints" || canonical === "sets") return ["cmp", canonical, numericOp, number(kw.key, value)];

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
    const direction = value.toLowerCase();
    if (!["asc", "desc", "auto"].includes(direction)) throw new QueryError(`unknown direction '${value}'`);
    options.direction = direction === "auto" ? null : direction;
  } else if (canonical === "unique") {
    const unique = value.toLowerCase();
    if (unique !== "cards" && unique !== "prints" && unique !== "art") {
      throw new QueryError(`'unique' takes cards, prints or art, got '${value}'`);
    }
    options.unique = unique;
  } else if (canonical === "prefer") {
    if (!Object.hasOwn(PREFER, value.toLowerCase())) throw new Unsupported(`'prefer:${value}' is not supported yet`);
    options.prefer = value.toLowerCase();
  }
  return ["all"];
}

function lowerNode(node: Node, options: Working): IR {
  switch (node.kind) {
    case "and":
      return ["and", node.children.map((c) => lowerNode(c, options))];
    case "or":
      return ["or", node.children.map((c) => lowerNode(c, options))];
    case "not": {
      options.negated = !options.negated;
      const child = lowerNode(node.child, options);
      options.negated = !options.negated;
      return ["not", child];
    }
    case "name":
      return node.exact ? whole(node.text, options.negated) : name(node.text, options.negated);
    case "keyword":
      return keyword(node, options);
  }
}

/** A term that was left out of a query, and why. */
export type Ignored = { term: string; reason: string };

/** A keyword term as it was typed: `lang:ja`, `o:"draw two"`, `name:/^the /`. */
function typed(kw: Keyword): string {
  const value = kw.regex ? `/${kw.value}/` : /\s/.test(kw.value) ? `"${kw.value}"` : kw.value;
  return `${kw.key}${kw.op}${value}`;
}

/**
 * The query without the terms that cannot be used, and what was taken out: a keyword that is
 * not supported yet, or one whose value makes no sense (`c:purple`). The rest of the query
 * still runs, and the reader is told what was left out. A group that loses all of its terms
 * goes with them; `ast` is null when nothing is left.
 */
export function usable(ast: Node): { ast: Node | null; ignored: Ignored[] } {
  const ignored: Ignored[] = [];
  const keep = (node: Node): Node | null => {
    switch (node.kind) {
      case "name":
        return node;
      case "keyword":
        try {
          lower(node);
          return node;
        } catch (error) {
          if (!(error instanceof QueryError)) throw error;
          ignored.push({ term: typed(node), reason: error.message });
          return null;
        }
      case "not": {
        const child = keep(node.child);
        return child === null ? null : { kind: "not", child };
      }
      case "and":
      case "or": {
        const children = node.children.map(keep).filter((child): child is Node => child !== null);
        if (children.length === 0) return null;
        return children.length === 1 ? children[0] : { kind: node.kind, children };
      }
    }
  };
  return { ast: keep(ast), ignored };
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

/** Whether a predicate mentions a field that only printing documents have. */
export function usesPrintings(p: IR): boolean {
  if (p[0] === "all") return false;
  if (p[0] === "and" || p[0] === "or") return p[1].some(usesPrintings);
  if (p[0] === "not") return usesPrintings(p[1]);
  return PRINTING_FIELDS.has(p[1]);
}

/** AST -> [predicate IR, display options]. Extras are hidden unless the query reveals them. */
export function lower(ast: Node): [IR, Options] {
  const working: Working = {
    includeExtras: false, order: null, descending: false, unique: "cards", prefer: null, printings: false,
    direction: null, negated: false,
  };
  let predicate = lowerNode(ast, working);
  if (!working.includeExtras) predicate = ["and", [predicate, ["eq", "extra", false]]];
  predicate = simplify(predicate);
  const { direction, negated: _negated, ...options } = working;
  // Unless a direction is given, newest printings come first and everything else ascends.
  options.descending = direction === null ? options.order === "date" : direction === "desc";
  options.printings =
    usesPrintings(predicate) ||
    options.unique !== "cards" ||
    options.prefer !== null ||
    (options.order !== null && PRINTING_FIELDS.has(options.order));
  return [predicate, options];
}
