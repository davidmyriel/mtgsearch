// A parsed query said back in plain words, so the reader can see how it was read:
//
//   t:sphinx mv<=3 -c:u   ->   the type includes “sphinx”, the mana value is 3 or less
//                              and its colours do not include blue
//
// It is called only for a query the compiler accepted, describes what was typed rather than
// how it is answered, and never throws: a keyword without wording of its own is quoted as typed.

import { blockOf, BLOCKS, COLOR_NAMES, COLOR_SETS, FORMAT_ALIASES, RARITIES, RARITY_ALIASES } from "./lower.ts";
import { KEYWORDS } from "./parser.ts";
import type { Keyword, Node } from "./parser.ts";

/** A condition as it reads when it holds, and when it is negated. */
type Clause = [is: string, isNot: string];

const NEGATED: Record<string, string> = {
  is: "is not",
  are: "are not",
  includes: "does not include",
  include: "do not include",
  matches: "does not match",
  has: "does not have",
  produces: "does not produce",
  "was released": "was not released",
  "has been printed": "has not been printed",
};

const says = (subject: string, verb: string, rest: string): Clause => [
  `${subject} ${verb} ${rest}`,
  `${subject} ${NEGATED[verb] ?? `not ${verb}`} ${rest}`,
];
const quote = (value: string) => `“${value}”`;
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** "3 or less", "more than 3": how much, for a comparison with a number. */
function amount(op: string, n: string): string {
  switch (op) {
    case "<":
      return `less than ${n}`;
    case "<=":
      return `${n} or less`;
    case ">":
      return `more than ${n}`;
    case ">=":
      return `${n} or more`;
    default:
      return n;
  }
}

/** A comparison of something with a number: "the mana value is 3 or less". */
function compare(subject: string, op: string, value: string): Clause {
  const [is, isNot] = says(subject, "is", amount(op === "!=" ? "=" : op, value));
  return op === "!=" ? [isNot, is] : [is, isNot];
}

/** Text that is contained, or a regular expression that matches. */
const text = (subject: string, kw: Keyword): Clause =>
  kw.regex ? says(subject, "matches", `/${kw.value}/`) : says(subject, "includes", quote(kw.value));

const COLOR_WORDS: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

/** The colours a value names, in WUBRG order; null when it is not a set of colours. */
function colorsOf(value: string): string[] | null {
  const v = value.toLowerCase();
  const letters = Object.hasOwn(COLOR_NAMES, v)
    ? COLOR_NAMES[v]
    : Object.hasOwn(COLOR_SETS, v)
      ? COLOR_SETS[v]
      : [...v].every((ch) => "wubrg".includes(ch))
        ? v.toUpperCase()
        : null;
  return letters === null ? null : [..."WUBRG"].filter((c) => letters.includes(c)).map((c) => COLOR_WORDS[c]);
}

/** `c:` and `id:`. With a bare colon, colours are "at least these" and identity is "within these". */
function colors(kw: Keyword, identity: boolean): Clause {
  const subject = identity ? "its colour identity" : "its colours";
  const [is, includes] = identity ? ["is", "includes"] : ["are", "include"];
  const v = kw.value.toLowerCase();
  if (v === "m" || v === "multicolor" || v === "multicolour") {
    return identity ? says(subject, "has", "two or more colours") : says("it", "is", "multicoloured");
  }
  if (/^\d+$/.test(v)) {
    const one = v === "1" && (kw.op === ":" || kw.op === "=" || kw.op === "!=");
    const count = `${amount(kw.op === "!=" ? "=" : kw.op, v).replace("less than", "fewer than")} ${one ? "colour" : "colours"}`;
    const [has, hasNot] = says(identity ? subject : "it", "has", count);
    return kw.op === "!=" ? [hasNot, has] : [has, hasNot];
  }
  if (v === "c" || v === "colorless" || v === "colourless") {
    const colourless = identity ? says(subject, "is", "colourless") : says("it", "is", "colourless");
    if (kw.op === ">") return [colourless[1], colourless[0]]; // more than no colours
    if (kw.op === ">=") return says("it", "has", "any colours or none");
    if (kw.op === "<") return says("it", "has", "fewer than no colours");
    return kw.op === "!=" ? [colourless[1], colourless[0]] : colourless;
  }
  const named = colorsOf(v);
  if (named === null) return says(subject, is, quote(kw.value));
  const these = list(named);
  const op = kw.op === ":" ? (identity ? "<=" : ">=") : kw.op;
  switch (op) {
    case ">=":
      return says(subject, includes, these);
    case ">":
      return says(subject, includes, `${these} and at least one more`);
    case "<=":
      return says(subject, is, `within ${these}`);
    case "<":
      return says(subject, is, `within ${these}, but not all of them`);
    case "!=": {
      const [exactly, not] = says(subject, is, `exactly ${these}`);
      return [not, exactly];
    }
    default:
      return says(subject, is, `exactly ${these}`);
  }
}

const STAT_NAMES: Record<string, string> = { power: "power", toughness: "toughness", loyalty: "loyalty", powtou: "power plus toughness" };

/** Power, toughness and loyalty, compared with a number or with one another. */
function stat(kw: Keyword, canonical: string): Clause {
  const subject = `its ${STAT_NAMES[canonical]}`;
  const other = KEYWORDS.get(kw.value.toLowerCase());
  if (other == null || !Object.hasOwn(STAT_NAMES, other)) return compare(subject, kw.op, kw.value);
  const than: Record<string, string> = {
    "<": "less than", "<=": "no more than", ">": "more than", ">=": "no less than", "!=": "equal to", "=": "equal to", ":": "equal to",
  };
  const [is, isNot] = says(subject, "is", `${than[kw.op]} its ${STAT_NAMES[other]}`);
  return kw.op === "!=" ? [isNot, is] : [is, isNot];
}

const FORMAT_NAMES: Record<string, string> = {
  standardbrawl: "Standard Brawl", paupercommander: "Pauper Commander", duel: "Duel Commander", oldschool: "Old School",
  penny: "Penny Dreadful", predh: "PreDH",
};
function format(value: string): string {
  const name = FORMAT_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
  return FORMAT_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

// `is:` words that read badly as they stand. Anything else is quoted: it is “fetchland”.
const FLAG_WORDS: Record<string, string> = {
  commander: "a card that can be a commander",
  spell: "a spell",
  permanent: "a permanent",
  vanilla: "a creature with no rules text",
  frenchvanilla: "a creature with only keyword abilities",
  historic: "historic",
  hybrid: "a card with hybrid mana",
  phyrexian: "a card with Phyrexian mana",
  reserved: "on the Reserved List",
  funny: "a joke card",
  modal: "modal",
  foil: "available in foil",
  nonfoil: "available in non-foil",
  etched: "available in etched foil",
  promo: "a promotional printing",
  reprint: "a reprint",
  firstprint: "a card's first printing",
  digital: "a digital-only printing",
  fullart: "a full-art printing",
  borderless: "a borderless printing",
  showcase: "a showcase printing",
  dfc: "double-faced",
  mdfc: "a modal double-faced card",
  transform: "a transforming card",
  split: "a split card",
};

const GAME_NAMES: Record<string, string> = { paper: "paper", mtgo: "Magic Online", arena: "Arena" };
const CURRENCIES: Record<string, string> = { usd: "US dollars", eur: "euros", tix: "Magic Online tickets" };

/** When a printing was released, against a year, a day or another set. */
function released(kw: Keyword, isYear: boolean): Clause {
  const value = kw.value.toLowerCase();
  const year = /^\d{4}$/.test(value);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const when = isYear || year || day ? value : `the set ${value.toUpperCase()}`;
  const at = year || isYear ? "in" : day ? "on" : "with";
  const how: Record<string, string> = {
    "<": `before ${when}`, ">": `after ${when}`, "<=": `${at} ${when} or earlier`, ">=": `${at} ${when} or later`,
  };
  const [was, wasNot] = says("it", "was released", how[kw.op] ?? `${at} ${when}`);
  return kw.op === "!=" ? [wasNot, was] : [was, wasNot];
}

/** Rarity, which has an order: common, uncommon, rare, special, mythic, bonus. */
function rarity(kw: Keyword): Clause {
  const value = kw.value.toLowerCase();
  const name = RARITY_ALIASES[value] ?? value;
  const how: Record<string, string> = {
    "<": `lower than ${name}`, ">": `higher than ${name}`, "<=": `${name} or lower`, ">=": `${name} or higher`,
  };
  const [is, isNot] = says("its rarity", "is", how[kw.op] ?? name);
  return kw.op === "!=" ? [isNot, is] : [is, isNot];
}

/** A mana cost or a devotion: a bare colon means "at least this". */
function cost(subject: string, kw: Keyword): Clause {
  const symbols = quote(kw.value.toUpperCase());
  const how: Record<string, string> = {
    ":": `at least ${symbols}`, ">=": `at least ${symbols}`, ">": `more than ${symbols}`,
    "<=": `at most ${symbols}`, "<": `less than ${symbols}`, "=": `exactly ${symbols}`, "!=": `exactly ${symbols}`,
  };
  const [is, isNot] = says(subject, "is", how[kw.op] ?? symbols);
  return kw.op === "!=" ? [isNot, is] : [is, isNot];
}

function produces(kw: Keyword): Clause {
  if (/^\d+$/.test(kw.value)) return compare("the number of colours of mana it produces", kw.op, kw.value);
  const named = colorsOf(kw.value);
  const mana = kw.value.toLowerCase() === "c" ? "colourless mana" : named ? `${list(named)} mana` : `${quote(kw.value)} mana`;
  const how: Record<string, string> = { "=": `exactly ${mana}`, "!=": `exactly ${mana}`, "<=": `only ${mana}, or less`, "<": `less than ${mana}`, ">": `${mana} and more` };
  const [does, doesNot] = says("it", "produces", how[kw.op] ?? mana);
  return kw.op === "!=" ? [doesNot, does] : [does, doesNot];
}

/** `in:` a game, at a rarity, or in a set, across all of the card's printings. */
function printedIn(kw: Keyword): Clause {
  const value = kw.value.toLowerCase();
  if (Object.hasOwn(GAME_NAMES, value)) return says("it", "has been printed", `in ${GAME_NAMES[value]}`);
  const name = RARITY_ALIASES[value] ?? value;
  if (RARITIES.includes(name)) return says("it", "has been printed", `at ${name}`);
  return says("it", "has been printed", `in the set ${value.toUpperCase()}`);
}

/** One keyword term in words; null for a keyword that changes the display, not which cards match. */
function keyword(kw: Keyword): Clause | null {
  const canonical = KEYWORDS.get(kw.key.toLowerCase());
  const value = kw.value;
  switch (canonical) {
    case "color":
      return colors(kw, false);
    case "identity":
      return colors(kw, true);
    case "type":
      return text("the type", kw);
    case "oracle":
      return text("the text", kw);
    case "fulloracle":
      return text("the text, reminder text included,", kw);
    case "name":
      return text("the name", kw);
    case "keyword":
      return says("it", "has", `the keyword ${quote(value)}`);
    case "manavalue":
      return /^(even|odd)$/i.test(value) ? says("the mana value", "is", value.toLowerCase()) : compare("the mana value", kw.op, value);
    case "power":
    case "toughness":
    case "loyalty":
    case "powtou":
      return stat(kw, canonical);
    case "format":
      return says("it", "is", `legal in ${format(value)}`);
    case "banned":
      return says("it", "is", `banned in ${format(value)}`);
    case "restricted":
      return says("it", "is", `restricted in ${format(value)}`);
    case "is":
    case "not": {
      const [is, isNot] = says("it", "is", FLAG_WORDS[value.toLowerCase()] ?? quote(value.toLowerCase()));
      return canonical === "is" ? [is, isNot] : [isNot, is];
    }
    case "otag":
      return says("it", "has", `the tag ${quote(value.toLowerCase())}`);
    case "edhrec":
      return compare("its EDHREC rank", kw.op, value);
    case "rarity":
      return rarity(kw);
    case "set":
      return says("the set", "is", value.toUpperCase());
    case "settype":
      return says("the kind of set", "is", quote(value.toLowerCase()));
    case "new": {
      const what: Record<string, string> = { art: "with this art", flavor: "with this flavour text", frame: "in this frame", rarity: "at this rarity" };
      return says("it", "is", `the card's first printing ${what[value.toLowerCase()] ?? `with this ${value.toLowerCase()}`}`);
    }
    case "block": {
      const code = blockOf(value);
      if (code === null) return says("the set", "is", `in a block called ${quote(value)} (there is none)`);
      const known = BLOCKS.blocks[code];
      return known ? says("the set", "is", `in the ${known.name} block`) : says("the set", "is", code.toUpperCase());
    }
    case "number":
      return kw.op === ":" || kw.op === "=" ? says("the collector number", "is", value) : compare("the collector number", kw.op, value);
    case "artist":
      return text("the artist's name", kw);
    case "flavor":
      return text("the flavour text", kw);
    case "watermark":
      return says("the watermark", "is", quote(value.toLowerCase()));
    case "border":
      return says("the border", "is", value.toLowerCase());
    case "frame":
      return says("the frame", "is", quote(value.toLowerCase()));
    case "stamp":
      return says("the security stamp", "is", value.toLowerCase());
    case "game":
      return says("it", "is", `available in ${GAME_NAMES[value.toLowerCase()] ?? quote(value)}`);
    case "year":
      return released(kw, true);
    case "date":
      return released(kw, false);
    case "usd":
    case "eur":
    case "tix":
      return compare(`its price in ${CURRENCIES[canonical]}`, kw.op, value);
    case "mana":
      return cost("its mana cost", kw);
    case "devotion":
      return cost("its devotion", kw);
    case "produces":
      return produces(kw);
    case "in":
      return printedIn(kw);
    case "prints":
      return compare("its number of printings", kw.op, value);
    case "sets":
      return compare("the number of sets it is in", kw.op, value);
    case "include":
    case "order":
    case "direction":
    case "unique":
    case "prefer":
    case "display":
      return null;
    default:
      return says(quote(kw.key), "is", quote(`${kw.op === ":" ? "" : kw.op}${value}`));
  }
}

/** Bare words side by side all look in the name: say so once. */
function names(words: string[]): string {
  return `the name includes ${list(words.map(quote))}`;
}

/** The conditions of an "and" or an "or", in order, with side-by-side bare words gathered. */
function parts(node: Extract<Node, { kind: "and" | "or" }>, top = false): string[] {
  const out: string[] = [];
  let words: string[] = [];
  const flush = () => {
    if (words.length) out.push(names(words));
    words = [];
  };
  for (const child of node.children) {
    // plain words of an "and" are gathered, so that three words are not three sentences
    if (node.kind === "and" && child.kind === "name" && !child.exact) {
      words.push(child.text);
      continue;
    }
    flush();
    // each condition of the query stands on its own, so a group among them needs no brackets
    const part = clause(child, false, !top);
    if (part !== null) out.push(part);
  }
  flush();
  return out;
}

function clause(node: Node, negated: boolean, nested: boolean): string | null {
  switch (node.kind) {
    case "name": {
      const [is, isNot] = node.exact ? says("the name", "is", quote(node.text)) : says("the name", "includes", quote(node.text));
      return negated ? isNot : is;
    }
    case "keyword": {
      const described = keyword(node);
      return described === null ? null : described[negated ? 1 : 0];
    }
    case "not":
      return clause(node.child, !negated, nested);
    case "and":
    case "or": {
      const conditions = parts(node);
      if (!conditions.length) return null;
      if (conditions.length === 1) return negated ? `not (${conditions[0]})` : conditions[0];
      const joined = conditions.join(node.kind === "or" ? " or " : " and ");
      return negated || nested ? `${negated ? "not " : ""}(${joined})` : joined;
    }
  }
}

/**
 * What a query asks for, in words: one entry for each condition that has to hold. A query that
 * is a single "or" is one entry. Empty when there is no condition (only `order:` and the like).
 */
export function explain(ast: Node): string[] {
  try {
    if (ast.kind === "and") return parts(ast, true);
    const only = clause(ast, false, false);
    return only === null ? [] : [only];
  } catch {
    return [];
  }
}
