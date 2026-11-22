// One search box: Scryfall-compatible first, natural language otherwise.
// Port of src/mtgsearch/search.py and syntax/backends.py (the reference).
//
//   1. Scryfall syntax (any keyword, `!exact`, regex)  -> exactly what Scryfall would return.
//   2. Plain words that match card names             -> those cards, most-played first.
//   3. Syntax keywords plus words that match no name  -> keywords filter, words rank by meaning.
//   4. Anything else                                  -> semantic search, with mana value,
//                                                        colour and type read from the query.

import { all, any, field, filter, fn, not, select } from "topk-js/query";
import { lower } from "./lower.ts";
import type { IR, Op } from "./lower.ts";
import { extract } from "./nl.ts";
import { parse, QueryError, Unsupported } from "./parser.ts";
import type { Keyword, Name, Node } from "./parser.ts";

export type Hit = Record<string, unknown> & { _id: string; name: string; score?: number };
export type Result = {
  mode: string; // syntax | name | mixed | semantic | unsupported
  hits: Hit[];
  total: number | null; // exact for syntax and name modes; null when ranked by meaning
  note: string; // what was understood, or why the query was refused
  hasMore: boolean;
  sortedBy: string | null; // an ORDERS key, or null when ranked by meaning
};
export type SearchOptions = {
  k?: number;
  offset?: number;
  order?: string | null; // an ORDERS key chosen in the page; an `order:` in the query wins
  descending?: boolean;
  fields?: string[];
};

/** Sort orders offered to the page, and the document field each one sorts on. */
export const ORDERS: Record<string, string> = {
  name: "name_lc",
  cmc: "cmc",
  power: "pow_max",
  toughness: "tou_max",
  edhrec: "edhrec_rank",
};
// Results ranked by meaning are paged by fetching a longer list, so they stop here.
export const MAX_RANKED = 120;

/** The part of a TopK collection client that search needs; lets tests pass a fake. */
export type Collection = {
  query(query: unknown): Promise<Hit[]>;
  count(): Promise<number>;
};

const DISPLAY = ["name", "mana_cost", "type_line", "oracle_text", "image", "scryfall_uri", "edhrec_rank"];
// Semantic score is the sum over these fields: the plain rules text is more precise for
// descriptions, the tagged text understands jargon ("mana rock").
export const SEMANTIC_FIELDS = ["rules", "rules_tagged"];
export const VISIBLE: IR = ["eq", "extra", false];
const UNRANKED = 1_000_000; // sorts cards without a popularity rank last

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

/** Translate a predicate to a TopK filter expression, or null when it matches every document. */
export function toTopk(p: IR): Expr | null {
  switch (p[0]) {
    case "all":
      return null;
    case "and": {
      const parts = p[1].map(toTopk).filter((e): e is Expr => e !== null);
      if (parts.length === 0) return null;
      return parts.length > 1 ? all(parts) : parts[0];
    }
    case "or": {
      const parts = p[1].map(toTopk);
      if (parts.some((e) => e === null)) return null;
      return parts.length > 1 ? any(parts as Expr[]) : (parts[0] as Expr);
    }
    case "not": {
      const inner = toTopk(p[1]);
      // "not everything" is nothing: `extra` is required, so it is never null
      return inner === null ? field("extra").isNull() : not(inner);
    }
    case "eq":
      return field(p[1]).eq(p[2]);
    // Optional fields are guarded with isNotNull so that negation keeps cards lacking the field.
    case "cmp":
      return field(p[1]).isNotNull().and(compare(field(p[1]), p[2], p[3]));
    case "has":
      return field(p[1]).contains(p[2]);
    case "in":
      return field(p[1]).isNotNull().and(field(p[1]).contains(p[2]));
    case "re":
      return field(p[1]).regexpMatch(`(?im)${p[2]}`);
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

const displayFields = () => Object.fromEntries(DISPLAY.map((name) => [name, field(name)]));

/** One page of the cards matching a predicate, sorted on a document field. */
async function filtered(col: Collection, predicate: IR, k: number, offset: number, sortField: string, descending: boolean) {
  let query = select(displayFields());
  const expr = toTopk(predicate);
  if (expr !== null) query = query.filter(expr);
  // Cards without a popularity rank sort last rather than first.
  const key = sortField === "edhrec_rank" ? field(sortField).coalesce(UNRANKED) : field(sortField);
  return col.query(query.sort(key, !descending).limit(k).offset(offset));
}

/** Rank the cards matching `predicate` by similarity of meaning to `text`. */
export async function semantic(col: Collection, text: string, predicate: IR, k: number, fields = SEMANTIC_FIELDS) {
  const aliases = fields.map((name) => `score_${name}`);
  const scores = Object.fromEntries(fields.map((name, i) => [aliases[i], fn.semanticSimilarity(name, text)]));
  let query = select({ ...displayFields(), ...scores });
  const expr = toTopk(predicate);
  if (expr !== null) query = query.filter(expr);
  // combine inside sort(); arithmetic in a second select() is unreliable
  const total = aliases.map((alias) => field(alias)).reduce((sum, score) => sum.add(score));
  const rows = await col.query(query.sort(total, false).limit(k));
  for (const row of rows) {
    row.score = aliases.reduce((sum, alias) => sum + Number(row[alias]), 0);
    for (const alias of aliases) delete row[alias];
  }
  return rows;
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

const fieldName = (order: string | null | undefined) => (order && Object.hasOwn(ORDERS, order) ? ORDERS[order] : null);
const orderName = (sortField: string) => Object.keys(ORDERS).find((name) => ORDERS[name] === sortField) ?? null;

export async function search(col: Collection, query: string, options: SearchOptions = {}): Promise<Result> {
  const { k = 20, offset = 0, fields = SEMANTIC_FIELDS } = options;
  const none = { hits: [], total: null, hasMore: false, sortedBy: null };
  let ast: Node | null = null;
  let predicate: IR = ["all"];
  let parsed = { includeExtras: false, order: null as string | null, descending: false };
  try {
    ast = parse(query);
    [predicate, parsed] = lower(ast);
  } catch (error) {
    if (error instanceof Unsupported) return { ...none, mode: "unsupported", note: error.message };
    if (!(error instanceof QueryError)) throw error;
    ast = null; // not Scryfall syntax: treat as plain English
  }

  if (ast !== null) {
    const plainWords = isPlainWords(ast);
    const total = await count(col, predicate);
    if (total) {
      // An `order:` in the query wins over the page's menu. Names default to most-played first.
      const fromQuery = parsed.order !== null;
      const sortField = parsed.order ?? fieldName(options.order) ?? (plainWords ? "edhrec_rank" : "name_lc");
      const descending = fromQuery ? parsed.descending : Boolean(options.order && options.descending);
      const hits = await filtered(col, predicate, k, offset, sortField, descending);
      const hasMore = offset + hits.length < total;
      return { mode: plainWords ? "name" : "syntax", hits, total, note: "", hasMore, sortedBy: orderName(sortField) };
    }
    if (!plainWords) {
      const split = splitWords(ast);
      if (!(split && split.keywords.length && split.words.length)) {
        return { ...none, mode: "syntax", total: 0, note: "" };
      }
      // Keywords matched nothing together with the name words: let the words rank by meaning.
      const keywordAst: Node =
        split.keywords.length === 1 ? split.keywords[0] : { kind: "and", children: split.keywords };
      const [keywordPredicate] = lower(keywordAst);
      const words = split.words.map((w) => w.text).join(" ");
      const ranked = await semantic(col, words, keywordPredicate, Math.min(offset + k, MAX_RANKED), fields);
      const hits = ranked.slice(offset, offset + k);
      const hasMore = ranked.length === offset + k && offset + k < MAX_RANKED;
      return { ...none, mode: "mixed", hits, hasMore, note: `filtered by keywords, ranked by '${words}'` };
    }
  }

  const extracted = extract(query);
  const wanted = Math.min(offset + k, MAX_RANKED);
  let ranked = await semantic(col, query, and(extracted.predicate, VISIBLE), wanted, fields);
  if (extracted.any && ranked.length < wanted) {
    // the filter was too strict: top up without it
    const seen = new Set(ranked.map((h) => h._id));
    const more = await semantic(col, query, VISIBLE, wanted, fields);
    ranked = ranked.concat(more.filter((h) => !seen.has(h._id))).slice(0, wanted);
  }
  const hits = ranked.slice(offset, offset + k);
  const hasMore = ranked.length === offset + k && offset + k < MAX_RANKED;
  return { ...none, mode: "semantic", hits, hasMore, note: extracted.notes.join(", ") };
}
