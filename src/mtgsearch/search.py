"""One search box: Scryfall-compatible first, natural language otherwise.

1. Scryfall syntax (any keyword, `!exact`, regex)  -> exactly what Scryfall would return.
2. Plain words that match card names             -> those cards, most-played first.
3. Syntax keywords plus words that match no name  -> keywords filter, words rank by meaning.
4. Anything else                                  -> semantic search, with mana value,
                                                     colour and type read from the query.
"""

from dataclasses import dataclass, field

from . import config, nl
from .syntax import QueryError, Unsupported, lower, parse, to_topk
from .syntax.parser import And, Keyword, Name, Not, Or

DISPLAY = ["name", "mana_cost", "type_line", "oracle_text", "image", "scryfall_uri", "edhrec_rank"]
# Semantic score is the sum over these fields: the plain rules text is more precise for
# descriptions, the tagged text understands jargon ("mana rock"). See eval/ for the numbers.
SEMANTIC_FIELDS = ("rules", "rules_tagged")
VISIBLE = ("eq", "extra", False)
UNRANKED = 1_000_000  # sorts cards without a popularity rank last


@dataclass
class Result:
    mode: str  # syntax | name | mixed | semantic | unsupported
    hits: list[dict] = field(default_factory=list)
    total: int | None = None  # exact count for syntax and name modes
    note: str = ""  # what was understood, or why the query was refused


def _and(*predicates):
    return ("and", [p for p in predicates if p != ("all",)])


def _count(col, predicate) -> int:
    from topk_sdk.query import filter as filter_

    expr = to_topk(predicate)
    return col.count() if expr is None else col.query(filter_(expr).count())[0]["_count"]


def _filtered(col, predicate, k: int, order: str | None = None, descending: bool = False) -> list[dict]:
    """Cards matching a predicate, by a document field or, by default, most-played first."""
    from topk_sdk.query import field as f
    from topk_sdk.query import select

    query = select(*DISPLAY)
    expr = to_topk(predicate)
    if expr is not None:
        query = query.filter(expr)
    key = f(order) if order else f("edhrec_rank").coalesce(UNRANKED)
    return col.query(query.sort(key, asc=not descending).limit(k))


def semantic(col, text: str, predicate=VISIBLE, k: int = 20, fields=SEMANTIC_FIELDS) -> list[dict]:
    """Rank the cards matching `predicate` by similarity of meaning to `text`."""
    from topk_sdk.query import field as f
    from topk_sdk.query import fn, select

    scores = {f"score_{name}": fn.semantic_similarity(name, text) for name in fields}
    query = select(*DISPLAY, **scores)
    expr = to_topk(predicate)
    if expr is not None:
        query = query.filter(expr)
    total = None
    for alias in scores:  # combine inside sort(); arithmetic in a second select() is unreliable
        total = f(alias) if total is None else total + f(alias)
    rows = col.query(query.sort(total, asc=False).limit(k))
    for row in rows:
        row["score"] = sum(row.pop(alias) for alias in scores)
    return rows


def _nodes(ast):
    yield ast
    if isinstance(ast, And | Or):
        for child in ast.children:
            yield from _nodes(child)
    elif isinstance(ast, Not):
        yield from _nodes(ast.child)


def is_plain_words(ast) -> bool:
    """No keywords, exact names or regexes: could be a card name, could be plain English."""
    return all(not isinstance(n, Keyword) and not (isinstance(n, Name) and n.exact) for n in _nodes(ast))


def _split_words(ast):
    """For a flat `keyword ... word ...` query, return (keyword terms, bare words); else None."""
    children = ast.children if isinstance(ast, And) else (ast,)
    if not all(isinstance(c, Keyword | Name) for c in children):
        return None
    words = [c for c in children if isinstance(c, Name) and not c.exact]
    return [c for c in children if c not in words], words


def search(query: str, k: int = 20, col=None, fields=SEMANTIC_FIELDS) -> Result:
    col = col or config.collection()
    try:
        ast = parse(query)
        predicate, options = lower(ast)
    except Unsupported as e:
        return Result("unsupported", note=str(e))
    except QueryError:
        ast = None  # not Scryfall syntax: treat as plain English

    if ast is not None and is_plain_words(ast):
        total = _count(col, predicate)
        if total:
            return Result("name", _filtered(col, predicate, k), total)
    elif ast is not None:
        total = _count(col, predicate)
        if total:
            hits = _filtered(col, predicate, k, options.order or "name_lc", options.descending)
            return Result("syntax", hits, total)
        split = _split_words(ast)
        if not (split and split[0] and split[1]):
            return Result("syntax", [], 0)
        # Keywords matched nothing together with the name words: let the words rank by meaning.
        keyword_predicate, _ = lower(split[0][0] if len(split[0]) == 1 else And(tuple(split[0])))
        words = " ".join(w.text for w in split[1])
        hits = semantic(col, words, keyword_predicate, k, fields)
        return Result("mixed", hits, note=f"filtered by keywords, ranked by '{words}'")

    extracted = nl.extract(query)
    hits = semantic(col, query, _and(extracted.predicate, VISIBLE), k, fields)
    if extracted.any and len(hits) < k:  # the filter was too strict: top up without it
        seen = {h["_id"] for h in hits}
        hits += [h for h in semantic(col, query, VISIBLE, k, fields) if h["_id"] not in seen]
    return Result("semantic", hits[:k], note=", ".join(extracted.notes))
