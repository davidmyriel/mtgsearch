// The TypeScript port must reproduce what the Python reference produces for every case in
// fixtures/golden.json. Regenerate the fixture with `mtgsearch golden` after changing Python.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { lower } from "../lib/lower.ts";
import { extract } from "../lib/nl.ts";
import { fold, plain } from "../lib/normalize.ts";
import { parse, QueryError, Unsupported } from "../lib/parser.ts";
import { isPlainWords, splitWords } from "../lib/search.ts";
import typeWords from "../lib/type-words.json" with { type: "json" };

const golden = JSON.parse(readFileSync(new URL("../../fixtures/golden.json", import.meta.url), "utf8"));

test("type-word catalogue matches the reference", () => {
  assert.deepEqual(typeWords, golden.catalog);
});

test("fold and plain match the reference", () => {
  for (const { text, fold: folded, plain: plained } of golden.normalize) {
    assert.equal(fold(text), folded, `fold(${JSON.stringify(text)})`);
    assert.equal(plain(text), plained, `plain(${JSON.stringify(text)})`);
  }
});

function compile(query: string) {
  try {
    const ast = parse(query);
    const [ir, options] = lower(ast);
    const split = splitWords(ast);
    return {
      query,
      ir,
      options: { include_extras: options.includeExtras, order: options.order, descending: options.descending },
      plain: isPlainWords(ast),
      split: split && {
        keywords: split.keywords.map((k) => (k.kind === "keyword" ? k.key : `!${k.text}`)),
        words: split.words.map((w) => w.text),
      },
    };
  } catch (error) {
    if (error instanceof Unsupported) return { query, error: "Unsupported", message: error.message };
    if (error instanceof QueryError) return { query, error: "QueryError" };
    throw error;
  }
}

test(`syntax: ${golden.syntax.length} queries compile to the reference predicate`, () => {
  const wrong: string[] = [];
  for (const expected of golden.syntax) {
    try {
      assert.deepEqual(compile(expected.query), expected);
    } catch {
      wrong.push(`${expected.query}\n   got      ${JSON.stringify(compile(expected.query))}\n   expected ${JSON.stringify(expected)}`);
    }
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ:\n${wrong.slice(0, 8).join("\n")}`);
});

test(`plain English: ${golden.nl.length} queries extract the reference filters`, () => {
  const wrong: string[] = [];
  for (const expected of golden.nl) {
    const { predicate, notes } = extract(expected.query);
    try {
      assert.deepEqual({ query: expected.query, predicate, notes }, expected);
    } catch {
      wrong.push(`${expected.query}: got ${JSON.stringify({ predicate, notes })} expected ${JSON.stringify(expected)}`);
    }
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ:\n${wrong.slice(0, 8).join("\n")}`);
});
