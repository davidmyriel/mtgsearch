"""Two interpreters for the predicate IR: TopK filter expressions, and plain Python.

The Python evaluator runs the same predicates over document dicts. It is the reference
used by unit tests (no network) and to tell a semantics bug from a translation bug.
"""

import operator
import re

_COMPARE = {
    "=": operator.eq, "!=": operator.ne, "<": operator.lt,
    "<=": operator.le, ">": operator.gt, ">=": operator.ge,
}  # fmt: skip


def evaluate(p, doc: dict) -> bool:
    """Does `doc` satisfy predicate `p`?"""
    kind = p[0]
    if kind == "all":
        return True
    if kind == "and":
        return all(evaluate(k, doc) for k in p[1])
    if kind == "or":
        return any(evaluate(k, doc) for k in p[1])
    if kind == "not":
        return not evaluate(p[1], doc)
    if kind == "eq":
        return doc.get(p[1]) == p[2]
    if kind == "cmp":
        value = doc.get(p[1])
        return value is not None and _COMPARE[p[2]](value, p[3])
    if kind == "has":
        return p[2] in doc.get(p[1], "")
    if kind == "in":
        return p[2] in doc.get(p[1], [])
    if kind == "re":
        return re.search(p[2], doc.get(p[1], ""), re.IGNORECASE | re.MULTILINE) is not None
    raise ValueError(f"unknown predicate {kind!r}")


def to_topk(p):
    """Translate predicate `p` to a TopK filter expression, or None when it matches every document."""
    from topk_sdk.query import all as all_
    from topk_sdk.query import any as any_
    from topk_sdk.query import field, not_

    def compare(left, op, right):
        return {
            "=": left.eq, "!=": left.ne, "<": left.lt, "<=": left.lte, ">": left.gt, ">=": left.gte,
        }[op](right)  # fmt: skip

    def go(p):
        kind = p[0]
        if kind == "all":
            return None
        if kind == "and":
            parts = [e for e in map(go, p[1]) if e is not None]
            return all_(parts) if len(parts) > 1 else (parts[0] if parts else None)
        if kind == "or":
            parts = [go(k) for k in p[1]]
            if any(e is None for e in parts):
                return None
            return any_(parts) if len(parts) > 1 else parts[0]
        if kind == "not":
            inner = go(p[1])
            # "not everything" is nothing: `extra` is required, so it is never null
            return field("extra").is_null() if inner is None else not_(inner)
        if kind == "eq":
            return field(p[1]).eq(p[2])
        # Optional fields are guarded with is_not_null so that negation keeps cards lacking the field.
        if kind == "cmp":
            return field(p[1]).is_not_null() & compare(field(p[1]), p[2], p[3])
        if kind == "has":
            return field(p[1]).contains(p[2])
        if kind == "in":
            return field(p[1]).is_not_null() & field(p[1]).contains(p[2])
        if kind == "re":
            return field(p[1]).regexp_match("(?im)" + p[2])
        raise ValueError(f"unknown predicate {kind!r}")

    return go(p)
