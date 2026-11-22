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
export type Result = { mode: string; hits: Hit[]; total: number | null; note: string };

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

/** Cards matching a predicate, by a document field or, by default, most-played first. */
async function filtered(col: Collection, predicate: IR, k: number, order: string | null = null, descending = false) {
  let query = select(displayFields());
  const expr = toTopk(predicate);
  if (expr !== null) query = query.filter(expr);
  const key = order ? field(order) : field("edhrec_rank").coalesce(UNRANKED);
  return col.query(query.sort(key, !descending).limit(k));
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

export async function search(col: Collection, query: string, k = 20, fields = SEMANTIC_FIELDS): Promise<Result> {
  let ast: Node | null = null;
  let predicate: IR = ["all"];
  let options = { includeExtras: false, order: null as string | null, descending: false };
  try {
    ast = parse(query);
    [predicate, options] = lower(ast);
  } catch (error) {
    if (error instanceof Unsupported) return { mode: "unsupported", hits: [], total: null, note: error.message };
    if (!(error instanceof QueryError)) throw error;
    ast = null; // not Scryfall syntax: treat as plain English
  }

  if (ast !== null && isPlainWords(ast)) {
    const total = await count(col, predicate);
    if (total) return { mode: "name", hits: await filtered(col, predicate, k), total, note: "" };
  } else if (ast !== null) {
    const total = await count(col, predicate);
    if (total) {
      const hits = await filtered(col, predicate, k, options.order ?? "name_lc", options.descending);
      return { mode: "syntax", hits, total, note: "" };
    }
    const split = splitWords(ast);
    if (!(split && split.keywords.length && split.words.length)) {
      return { mode: "syntax", hits: [], total: 0, note: "" };
    }
    // Keywords matched nothing together with the name words: let the words rank by meaning.
    const keywordAst: Node =
      split.keywords.length === 1 ? split.keywords[0] : { kind: "and", children: split.keywords };
    const [keywordPredicate] = lower(keywordAst);
    const words = split.words.map((w) => w.text).join(" ");
    const hits = await semantic(col, words, keywordPredicate, k, fields);
    return { mode: "mixed", hits, total: null, note: `filtered by keywords, ranked by '${words}'` };
  }

  const extracted = extract(query);
  let hits = await semantic(col, query, and(extracted.predicate, VISIBLE), k, fields);
  if (extracted.any && hits.length < k) {
    // the filter was too strict: top up without it
    const seen = new Set(hits.map((h) => h._id));
    const more = await semantic(col, query, VISIBLE, k, fields);
    hits = hits.concat(more.filter((h) => !seen.has(h._id)));
  }
  return { mode: "semantic", hits: hits.slice(0, k), total: null, note: extracted.notes.join(", ") };
}
