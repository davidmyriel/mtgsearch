// Evaluate a predicate against a document in plain TypeScript.
//
// TopK is what runs predicates in production (toTopk in search.ts). This is the reference
// used by the unit tests, so keyword semantics are tested without a network, and by the live
// tests to check that TopK means the same thing by a predicate as we do.
import type { IR } from "./lower.ts";

export type Doc = Record<string, unknown>;

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};

export function evaluate(p: IR, doc: Doc): boolean {
  switch (p[0]) {
    case "all":
      return true;
    case "and":
      return p[1].every((k) => evaluate(k, doc));
    case "or":
      return p[1].some((k) => evaluate(k, doc));
    case "not":
      return !evaluate(p[1], doc);
    case "eq":
      return doc[p[1]] === p[2];
    case "cmp": {
      const value = doc[p[1]];
      return typeof value === "number" && COMPARE[p[2]](value, p[3]);
    }
    case "has":
      return String(doc[p[1]] ?? "").includes(p[2]);
    case "in":
      return Array.isArray(doc[p[1]]) && (doc[p[1]] as unknown[]).includes(p[2]);
    case "re":
      return new RegExp(p[2], "im").test(String(doc[p[1]] ?? ""));
  }
}
