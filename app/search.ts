// One search box: Scryfall-compatible first, natural language otherwise.
//
//   1. Scryfall syntax (any keyword, `!exact`, regex)  -> exactly what Scryfall would return.
//   2. Plain words that match card names             -> those cards, most-played first.
//   3. Syntax keywords plus words that match no name  -> keywords filter, words rank by meaning.
//   4. Anything else                                  -> semantic search, with mana value,
//                                                        colour and type read from the query.

import { agg, all, any, field, filter, fn, not, select } from "topk-js/query";
import { lower, ORDER_FIELDS, PREFER, PRINTING_FIELDS, usable } from "./lower.ts";
import type { Ignored, IR, Op, Unique } from "./lower.ts";
import { explain } from "./explain.ts";
import { extract } from "./nl.ts";
import { plain } from "./normalize.ts";
import { KEYWORDS, parse, QueryError, Unsupported } from "./parser.ts";
import type { Keyword, Name, Node } from "./parser.ts";

export type Hit = Record<string, unknown> & { _id: string; name: string; score?: number };
export type Unit = "cards" | "printings" | "illustrations";
export type Result = {
  mode: string; // syntax | name | mixed | semantic | unsupported
  hits: Hit[];
  total: number | null; // exact for syntax and name modes; null when ranked by meaning
  note: string; // what was understood, or why the query was refused
  understood: string[]; // a syntax query said back in words, one entry for each condition
  ignored: Ignored[]; // terms that could not be used and were left out, each with the reason
  exact: Hit | null; // the card whose name is exactly what was typed, if the query is a name
  hasMore: boolean;
  sortedBy: string | null; // an ORDERS key, or null when ranked by meaning
  descending?: boolean; // the direction of that order, as it was applied
  unit: Unit; // what `total` counts and each hit is
};
export type SearchOptions = {
  k?: number;
  offset?: number;
  order?: string | null; // an ORDERS key chosen in the page; an `order:` in the query wins
  descending?: boolean | null; // null: the order's usual direction. A `direction:` in the query wins
  unique?: Unique | null; // what a result is, chosen in the page; a `unique:` in the query wins
  fields?: string[];
};

/** Sort orders offered to the page, and the document field each one sorts on. */
export const ORDERS: Record<string, string> = Object.fromEntries(
  ["name", "cmc", "power", "toughness", "edhrec", "released", "usd", "eur", "tix", "rarity"].map((name) => [name, ORDER_FIELDS[name]]),
);
// Results ranked by meaning are paged by fetching a longer list, so they stop here.
export const MAX_RANKED = 120;

/** The part of a TopK collection client that search needs; lets tests pass a fake. */
export type Collection = {
  query(query: unknown): Promise<Hit[]>;
  count(): Promise<number>;
};
/**
 * `cards` holds one embedded document per card and answers plain English and card-level syntax.
 * `printings` holds one per printing and answers anything about sets, rarity, artists or prices.
 */
export type Collections = { cards: Collection; printings: Collection };

const SHARED = [
  "name", "mana_cost", "type_line", "oracle_text", "image", "scryfall_uri", "edhrec_rank",
  "set", "set_name", "cn", "rarity", "artist", "released", "prints",
];
const CARD_DISPLAY = [...SHARED, "usd", "eur", "tix"];
export const PRINTING_DISPLAY = [...SHARED, "usd_c", "eur_c", "tix_c", "flavor_text", "oracle_id", "pref_rank"];
// Semantic score is the sum over these fields: the plain rules text is more precise for
// descriptions, the tagged text understands jargon ("mana rock").
export const SEMANTIC_FIELDS = ["rules", "rules_tagged"];
export const VISIBLE: IR = ["eq", "extra", false];
// Fields a document may lack. Sorting puts cards without the value last, in either direction.
const OPTIONAL_SORT = new Set(["edhrec_rank", "pow_max", "tou_max", "usd_c", "eur_c", "tix_c"]);
const FAR = 1_000_000_000;
// Room for a card's printings when a value and a printing are packed into one number.
const SLOTS = 4096;
// Above this many cards, an id list is too long to send as a filter.
const MAX_ID_FILTER = 3000;
const WIDE = 400;

type Expr = ReturnType<typeof field>;

function compare(left: Expr, op: Op, right: number): Expr {
  switch (op) {
    case "=":
      return left.eq(right);
    case "!=":
      return left.ne(right);
    case "<":
      return left.lt(right);
    case "<=":
      return left.lte(right);
    case ">":
      return left.gt(right);
    case ">=":
      return left.gte(right);
  }
}

// TopK accepts a limited number of operands in one any() or all(); longer lists are nested.
const MAX_OPERANDS = 30;

function nested(combine: (exprs: Expr[]) => Expr, exprs: Expr[]): Expr {
  if (exprs.length === 1) return exprs[0];
  if (exprs.length <= MAX_OPERANDS) return combine(exprs);
  const chunks: Expr[] = [];
  for (let i = 0; i < exprs.length; i += MAX_OPERANDS) chunks.push(nested(combine, exprs.slice(i, i + MAX_OPERANDS)));
  return nested(combine, chunks);
}

/** Translate a predicate to a TopK filter expression, or null when it matches every document. */
export function toTopk(p: IR): Expr | null {
  switch (p[0]) {
    case "all":
      return null;
    case "and": {
      const parts = p[1].map(toTopk).filter((e): e is Expr => e !== null);
      return parts.length === 0 ? null : nested(all, parts);
    }
    case "or": {
      const parts = p[1].map(toTopk);
      return parts.some((e) => e === null) ? null : nested(any, parts as Expr[]);
    }
    case "not": {
      const inner = toTopk(p[1]);
      // "not everything" is nothing: `extra` is required, so it is never null
      return inner === null ? field("extra").isNull() : not(inner);
    }
    // Every test is guarded with isNotNull, so that negating it keeps documents lacking the field.
    case "eq":
      return field(p[1]).isNotNull().and(field(p[1]).eq(p[2]));
    case "cmp":
      return field(p[1]).isNotNull().and(compare(field(p[1]), p[2], p[3]));
    case "has":
    case "in":
      return field(p[1]).isNotNull().and(field(p[1]).contains(p[2]));
    case "oneof":
      return field(p[1]).isNotNull().and(field(p[1]).in(p[2]));
    case "re":
      return field(p[1]).isNotNull().and(field(p[1]).regexpMatch(`(?im)${p[2]}`));
  }
}

function and(...predicates: IR[]): IR {
  return ["and", predicates.filter((p) => p[0] !== "all")];
}

async function count(col: Collection, predicate: IR): Promise<number> {
  const expr = toTopk(predicate);
  if (expr === null) return col.count();
  const rows = await col.query(filter(expr).count());
  return Number(rows[0]._count);
}

export const pick = (names: string[]) => Object.fromEntries(names.map((name) => [name, field(name)]));

/** Sort on a field, cards lacking it last, ties by name (and newest first among printings). */
function ordering(sortField: string, descending: boolean, printings = false) {
  const key = OPTIONAL_SORT.has(sortField) ? field(sortField).coalesce(descending ? -FAR : FAR) : field(sortField);
  const keys: { expr: Expr; order: "asc" | "desc" }[] = [{ expr: key, order: descending ? "desc" : "asc" }];
  if (sortField !== "name_lc") keys.push({ expr: field("name_lc"), order: "asc" });
  if (printings && sortField !== "date") keys.push({ expr: field("date"), order: "desc" });
  return keys;
}

type Page = { hits: Hit[]; total: number };

/** One page of the cards matching a predicate, from the cards collection. */
async function cardPage(col: Collection, predicate: IR, k: number, offset: number, sortField: string, descending: boolean): Promise<Page> {
  const total = await count(col, predicate);
  if (!total) return { hits: [], total };
  let query = select(pick(CARD_DISPLAY));
  const expr = toTopk(predicate);
  if (expr !== null) query = query.filter(expr);
  return { hits: await col.query(query.sort(ordering(sortField, descending)).limit(k).offset(offset)), total };
}

/** A printing document as a hit: the same shape as a card hit. */
export function printingHit(row: Hit): Hit {
  const { usd_c: usd, eur_c: eur, tix_c: tix, pref_rank: _rank, ...hit } = row;
  // prices are whole cents on a printing; a hit gives them in the currency's own units
  const price = (cents: unknown) => (typeof cents === "number" ? cents / 100 : null);
  return { ...hit, usd: price(usd), eur: price(eur), tix: price(tix) } as Hit;
}

export type PrintingOptions = { unique: Unique; prefer: string | null; sortField: string; descending: boolean };
/** A card (or one illustration of it) with at least one matching printing. */
export type Group = { oracle_id: string; name_lc: string; key: number | string | null; rank: number };

/**
 * Every card with a printing that matches, each with the printing that should show it, in order.
 *
 * One group-by over the matching printings. Which printing shows a card: the one that decides
 * the sort when sorting on a printing field (the cheapest, when sorting by price), else the
 * `prefer:` choice, else the most presentable one (lowest pref_rank). To find a value and the
 * printing holding it with a single min or max, the two are packed as value * SLOTS + slot.
 */
export async function grouped(col: Collection, predicate: IR, o: PrintingOptions): Promise<Group[]> {
  const printingSort = PRINTING_FIELDS.has(o.sortField);
  const chooser = printingSort ? ([o.sortField, o.descending] as const) : o.prefer ? PREFER[o.prefer] : null;
  const aggs: Record<string, ReturnType<typeof agg.min>> = { rank: agg.min("pref_rank") };
  let query = null;
  if (chooser) {
    const [name, highest] = chooser;
    const slot = highest ? field("pref_rank").mul(-1).add(SLOTS - 1) : field("pref_rank");
    query = select({ choice: field(name).mul(SLOTS).add(slot) });
    aggs.choice = highest ? agg.max("choice") : agg.min("choice");
  }
  if (!printingSort && o.sortField !== "name_lc") aggs.key = agg.min(o.sortField);
  const keys: Record<string, Expr> = { oracle_id: field("oracle_id"), name_lc: field("name_lc") };
  if (o.unique === "art") keys.art = field("art");
  const expr = toTopk(predicate);
  if (expr !== null) query = query ? query.filter(expr) : filter(expr);
  const rows = await col.query(query ? query.groupBy(keys, aggs) : select({}).groupBy(keys, aggs));

  // A card's printings can carry different names (a reversible printing is "X // X"), which
  // splits the card over several rows. Keep, per card, the row holding the printing to show.
  const best = new Map<string, { group: Group; choice: number | null }>();
  for (const row of rows) {
    const group: Group = { oracle_id: String(row.oracle_id), name_lc: String(row.name_lc), key: null, rank: Number(row.rank) };
    if (o.sortField === "name_lc") group.key = group.name_lc;
    else if (!printingSort) group.key = row.key == null ? null : Number(row.key);
    const choice = chooser && row.choice != null ? Number(row.choice) : null;
    if (chooser && choice !== null) {
      const slot = ((choice % SLOTS) + SLOTS) % SLOTS;
      group.rank = chooser[1] ? SLOTS - 1 - slot : slot;
      if (printingSort) group.key = Math.floor(choice / SLOTS);
    }
    const id = o.unique === "art" ? `${group.oracle_id} ${row.art}` : group.oracle_id;
    const seen = best.get(id);
    const wins =
      !seen ||
      (choice !== null && seen.choice !== null
        ? chooser?.[1] ? choice > seen.choice : choice < seen.choice
        : choice !== null || (seen.choice === null && group.rank < seen.group.rank));
    if (wins) best.set(id, { group, choice });
  }
  const groups = [...best.values()].map((entry) => entry.group);
  const direction = o.descending ? -1 : 1;
  const byName = (a: Group, b: Group) => (a.name_lc < b.name_lc ? -1 : a.name_lc > b.name_lc ? 1 : a.rank - b.rank);
  return groups.sort((a, b) => {
    if (a.key === b.key) return byName(a, b);
    if (a.key === null) return 1; // cards lacking the value go last, in either direction
    if (b.key === null) return -1;
    return (a.key < b.key ? -1 : 1) * direction;
  });
}

/** The printing documents that show these groups, in the same order. */
async function shown(col: Collection, groups: Group[]): Promise<Hit[]> {
  if (!groups.length) return [];
  const id = (oracle: unknown, rank: unknown) => `${oracle}:${rank}`;
  // A card's printings have distinct pref_ranks, so each pair names exactly one printing.
  const pairs = groups.map((g) => field("oracle_id").eq(g.oracle_id).and(field("pref_rank").eq(g.rank)));
  const rows = await col.query(select(pick(PRINTING_DISPLAY)).filter(nested(any, pairs)).limit(groups.length));
  const found = new Map(rows.map((row) => [id(row.oracle_id, row.pref_rank), row]));
  return groups.flatMap((g) => {
    const row = found.get(id(g.oracle_id, g.rank));
    return row ? [printingHit(row)] : [];
  });
}

/** One page of results from the printings collection: printings, or cards shown by one printing. */
async function printingPage(col: Collection, predicate: IR, k: number, offset: number, o: PrintingOptions): Promise<Page> {
  if (o.unique === "prints") {
    const total = await count(col, predicate);
    if (!total) return { hits: [], total };
    let query = select(pick(PRINTING_DISPLAY));
    const expr = toTopk(predicate);
    if (expr !== null) query = query.filter(expr);
    const rows = await col.query(query.sort(ordering(o.sortField, o.descending, true)).limit(k).offset(offset));
    return { hits: rows.map(printingHit), total };
  }
  const groups = await grouped(col, predicate, o);
  return { hits: await shown(col, groups.slice(offset, offset + k)), total: groups.length };
}

/** Rank the cards matching `predicate` by similarity of meaning to `text`; optionally only these ids. */
export async function semantic(col: Collection, text: string, predicate: IR, k: number, fields = SEMANTIC_FIELDS, ids?: string[]) {
  const aliases = fields.map((name) => `score_${name}`);
  const scores = Object.fromEntries(fields.map((name, i) => [aliases[i], fn.semanticSimilarity(name, text)]));
  let query = select({ ...pick(CARD_DISPLAY), ...scores });
  const expr = toTopk(predicate);
  if (expr !== null) query = query.filter(expr);
  if (ids) query = query.filter(field("_id").in(ids));
  // combine inside sort(); arithmetic in a second select() is unreliable
  const total = aliases.map((alias) => field(alias)).reduce((sum, score) => sum.add(score));
  const rows = await col.query(query.sort(total, false).limit(k));
  for (const row of rows) {
    row.score = aliases.reduce((sum, alias) => sum + Number(row[alias]), 0);
    for (const alias of aliases) delete row[alias];
  }
  return rows;
}

/**
 * Rank by meaning among the cards that have a printing matching `predicate`. The embeddings
 * live in the cards collection, so the matching cards are found first and ranked there; each
 * hit is then shown by its matching printing.
 */
async function semanticOverPrintings(cols: Collections, text: string, predicate: IR, prefer: string | null, k: number, fields: string[]) {
  const groups = await grouped(cols.printings, predicate, { unique: "cards", prefer, sortField: "name_lc", descending: false });
  if (!groups.length) return [];
  const byCard = new Map(groups.map((g) => [g.oracle_id, g]));
  let ranked: Hit[];
  if (groups.length <= MAX_ID_FILTER) {
    ranked = await semantic(cols.cards, text, ["all"], k, fields, [...byCard.keys()]);
  } else {
    // Too many ids to send: rank a wide slice of all cards and keep those with a matching printing.
    ranked = (await semantic(cols.cards, text, ["all"], WIDE, fields)).filter((hit) => byCard.has(hit._id)).slice(0, k);
  }
  const printings = await shown(cols.printings, ranked.map((hit) => byCard.get(hit._id) as Group));
  const scores = new Map(ranked.map((hit) => [hit._id, hit.score]));
  return printings.map((hit) => ({ ...hit, score: scores.get(String(hit.oracle_id)) }));
}

function* nodes(ast: Node): Generator<Node> {
  yield ast;
  if (ast.kind === "and" || ast.kind === "or") for (const child of ast.children) yield* nodes(child);
  else if (ast.kind === "not") yield* nodes(ast.child);
}

/** No keywords, exact names or regexes: could be a card name, could be plain English. */
export function isPlainWords(ast: Node): boolean {
  for (const n of nodes(ast)) {
    if (n.kind === "keyword" || (n.kind === "name" && n.exact)) return false;
  }
  return true;
}

/** For a flat `keyword ... word ...` query, return its keyword terms and bare words; else null. */
export function splitWords(ast: Node): { keywords: (Keyword | Name)[]; words: Name[] } | null {
  const children = ast.kind === "and" ? ast.children : [ast];
  if (!children.every((c) => c.kind === "keyword" || c.kind === "name")) return null;
  const terms = children as (Keyword | Name)[];
  const words = terms.filter((c): c is Name => c.kind === "name" && !c.exact);
  return { keywords: terms.filter((c) => !(c.kind === "name" && !c.exact)), words };
}

/** Whether the query itself holds this keyword, under any of its spellings (`dir:`, `direction:`). */
const given = (ast: Node, canonical: string) =>
  [...nodes(ast)].some((n) => n.kind === "keyword" && KEYWORDS.get(n.key.toLowerCase()) === canonical);

/**
 * The card whose whole name is what was typed, ignoring case, accents and punctuation
 * ("urzas saga" is Urza's Saga). Only for words on their own: no `or`, no negation. The page
 * opens this card instead of listing every card with those words in its name.
 */
async function exactName(col: Collection, ast: Node): Promise<Hit | null> {
  const names = ast.kind === "name" ? [ast] : ast.kind === "and" ? ast.children : [];
  if (!names.length || !names.every((n): n is Name => n.kind === "name" && !n.exact)) return null;
  const wanted = plain(names.map((n) => n.text).join(" "));
  if (!wanted) return null;
  const whole = toTopk(["and", [["eq", "name_plain", wanted], VISIBLE]]);
  const rows = await col.query(select(pick(CARD_DISPLAY)).filter(whole!).limit(1));
  return rows[0] ?? null;
}

const fieldName = (order: string | null | undefined) => (order && Object.hasOwn(ORDERS, order) ? ORDERS[order] : null);
const orderName = (sortField: string) => Object.keys(ORDERS).find((name) => ORDERS[name] === sortField) ?? null;
const UNITS: Record<Unique, Unit> = { cards: "cards", prints: "printings", art: "illustrations" };

export async function search(cols: Collections, query: string, options: SearchOptions = {}): Promise<Result> {
  const { k = 20, offset = 0, fields = SEMANTIC_FIELDS } = options;
  const none = {
    hits: [], total: null, hasMore: false, sortedBy: null, unit: "cards" as Unit, understood: [] as string[], ignored: [] as Ignored[],
    exact: null as Hit | null,
  };
  let ast: Node | null = null;
  let predicate: IR = ["all"];
  let parsed: ReturnType<typeof lower>[1] | null = null;
  try {
    // A term that cannot be used is left out and reported; the rest of the query runs.
    const kept = usable(parse(query));
    none.ignored = kept.ignored;
    if (kept.ast === null) {
      return { ...none, mode: "unsupported", note: kept.ignored.map((left) => left.reason).join("; ") };
    }
    ast = kept.ast;
    [predicate, parsed] = lower(ast);
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    ast = null; // not Scryfall syntax: treat as plain English
    none.ignored = [];
  }

  if (ast !== null && parsed !== null) {
    const plainWords = isPlainWords(ast);
    // What the query says wins over the page's controls. Names default to most-played first.
    const sortField = parsed.order ?? fieldName(options.order) ?? (plainWords ? "edhrec_rank" : "name_lc");
    // With no direction from either, newest printings come first and everything else ascends.
    const descending =
      parsed.order !== null || given(ast, "direction") ? parsed.descending : (options.descending ?? sortField === "date");
    const unique: Unique = given(ast, "unique") ? parsed.unique : (options.unique ?? "cards");
    // Anything about a printing, including sorting by price or date, is answered from the printings.
    const printings = parsed.printings || PRINTING_FIELDS.has(sortField) || unique !== "cards";
    const [page, exact] = await Promise.all([
      printings
        ? printingPage(cols.printings, predicate, k, offset, { unique, prefer: parsed.prefer, sortField, descending })
        : cardPage(cols.cards, predicate, k, offset, sortField, descending),
      plainWords && offset === 0 ? exactName(cols.cards, ast) : null,
    ]);
    if (page.total) {
      const hasMore = offset + page.hits.length < page.total;
      const mode = plainWords ? "name" : "syntax";
      const understood = explain(ast);
      return { ...none, mode, hits: page.hits, total: page.total, hasMore, note: "", sortedBy: orderName(sortField), descending, unit: UNITS[unique], understood, exact };
    }
    if (!plainWords) {
      const split = splitWords(ast);
      if (!(split && split.keywords.length && split.words.length)) {
        return { ...none, mode: "syntax", total: 0, note: "", unit: UNITS[unique], understood: explain(ast) };
      }
      // Keywords matched nothing together with the name words: let the words rank by meaning.
      const keywordAst: Node =
        split.keywords.length === 1 ? split.keywords[0] : { kind: "and", children: split.keywords };
      const [keywordPredicate, keywordOptions] = lower(keywordAst);
      const words = split.words.map((w) => w.text).join(" ");
      const wanted = Math.min(offset + k, MAX_RANKED);
      const ranked = keywordOptions.printings
        ? await semanticOverPrintings(cols, words, keywordPredicate, keywordOptions.prefer, wanted, fields)
        : await semantic(cols.cards, words, keywordPredicate, wanted, fields);
      const hits = ranked.slice(offset, offset + k);
      const hasMore = ranked.length === offset + k && offset + k < MAX_RANKED;
      return { ...none, mode: "mixed", hits, hasMore, note: `filtered by keywords, ranked by '${words}'`, understood: explain(keywordAst) };
    }
  }

  // Ranked by meaning: the query as typed, or only its words when a term was left out.
  const text =
    ast !== null && none.ignored.length
      ? [...nodes(ast)].flatMap((n) => (n.kind === "name" ? [n.text] : [])).join(" ")
      : query;
  const extracted = extract(text);
  const wanted = Math.min(offset + k, MAX_RANKED);
  let ranked = await semantic(cols.cards, text, and(extracted.predicate, VISIBLE), wanted, fields);
  if (extracted.any && ranked.length < wanted) {
    // the filter was too strict: top up without it
    const seen = new Set(ranked.map((h) => h._id));
    const more = await semantic(cols.cards, text, VISIBLE, wanted, fields);
    ranked = ranked.concat(more.filter((h) => !seen.has(h._id))).slice(0, wanted);
  }
  const hits = ranked.slice(offset, offset + k);
  const hasMore = ranked.length === offset + k && offset + k < MAX_RANKED;
  return { ...none, mode: "semantic", hits, hasMore, note: extracted.notes.join(", ") };
}
