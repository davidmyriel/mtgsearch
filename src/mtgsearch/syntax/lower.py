"""Lower a parsed Scryfall query to a small predicate IR over document fields.

All keyword semantics live here. The IR is deliberately tiny so that each backend
(TopK filter expressions, pure-Python evaluation) is a few lines:

    ("all",)                         every card
    ("and", [p...]) ("or", [p...]) ("not", p)
    ("eq", field, value)             scalar equality
    ("cmp", field, op, number)       numeric comparison; a missing value never matches
    ("has", field, text)             substring of a text field
    ("in", field, value)             membership in a list field
    ("re", field, pattern)           case-insensitive, multi-line regular expression
"""

import re
from dataclasses import dataclass
from itertools import combinations

from ..catalog import type_word_set
from ..documents import COLORS, color_key, fold, plain
from .parser import KEYWORDS, And, Keyword, Name, Not, Or, QueryError, Unsupported

COLOR_NAMES = {"white": "W", "blue": "U", "black": "B", "red": "R", "green": "G"}
COLOR_SETS = {
    # guilds
    "azorius": "WU", "dimir": "UB", "rakdos": "BR", "gruul": "RG", "selesnya": "GW",
    "orzhov": "WB", "izzet": "UR", "golgari": "BG", "boros": "RW", "simic": "GU",
    # shards and wedges
    "bant": "GWU", "esper": "WUB", "grixis": "UBR", "jund": "BRG", "naya": "RGW",
    "abzan": "WBG", "jeskai": "URW", "sultai": "BGU", "mardu": "RWB", "temur": "GUR",
    # colleges
    "silverquill": "WB", "prismari": "UR", "witherbloom": "BG", "lorehold": "RW", "quandrix": "GU",
    # four colours, named for the colour they lack
    "chaos": "UBRG", "aggression": "WBRG", "altruism": "WURG", "growth": "WUBG", "artifice": "WUBR",
}  # fmt: skip
ALL_COLOR_SETS = [frozenset(c) for n in range(6) for c in combinations(COLORS, n)]
FORMAT_ALIASES = {"edh": "commander", "pdh": "paupercommander"}
FLAGS = {
    "split", "flip", "transform", "meld", "leveler", "mdfc", "dfc", "permanent", "spell", "historic",
    "vanilla", "bear", "commander", "hybrid", "phyrexian", "reserved", "gamechanger", "digital", "funny",
}  # fmt: skip
FLAG_ALIASES = {"tdfc": "transform"}
STATS = {"power": "pow", "toughness": "tou", "loyalty": "loy"}
ORDER_FIELDS = {
    "name": "name_lc", "cmc": "cmc", "mv": "cmc", "power": "pow_max",
    "toughness": "tou_max", "edhrec": "edhrec_rank",
}  # fmt: skip
# Card types whose mention reveals cards that are otherwise hidden as extras.
EXTRA_TYPES = re.compile(r"\b(vanguard|plane|scheme|phenomenon|token|emblem)\b")
_OPS = {":", "=", "!=", "<", "<=", ">", ">="}
_SET_COMPARE = {
    ">=": lambda s, w: s >= w, ">": lambda s, w: s > w, "<=": lambda s, w: s <= w,
    "<": lambda s, w: s < w, "=": lambda s, w: s == w, "!=": lambda s, w: s != w,
}  # fmt: skip
_NUM_COMPARE = {
    ">=": lambda a, b: a >= b, ">": lambda a, b: a > b, "<=": lambda a, b: a <= b,
    "<": lambda a, b: a < b, "=": lambda a, b: a == b, "!=": lambda a, b: a != b,
}  # fmt: skip
_FLIP = {">": "<", "<": ">", ">=": "<=", "<=": ">=", "=": "=", "!=": "!="}
_RELATIONS = {">": [">"], "<": ["<"], "=": ["="], ">=": [">", "="], "<=": ["<", "="], "!=": [">", "<"]}


@dataclass
class Options:
    include_extras: bool = False
    order: str | None = None  # document field to sort by
    descending: bool = False


def _number(key: str, value: str) -> float:
    try:
        return float(value)
    except ValueError:
        raise QueryError(f"'{key}' expects a number, got '{value}'") from None


def _any_of(field: str, values: list[str]):
    if not values:
        return ("not", ("all",))
    return ("or", [("in", field, v) for v in values])


def _colors(field: str, op: str, value: str, default_op: str):
    """`c:` and `id:`. A card matches when any of its faces' colour sets satisfies the comparison.

    Documents store each face's colours as one string ("WU", "C" for colourless), so every
    comparison becomes: is one of the satisfying colour sets present?
    """
    v = value.lower()
    if v in ("m", "multicolor", "multicolour"):
        keep = [s for s in ALL_COLOR_SETS if len(s) > 1]
    elif v.isdigit():
        compare = _NUM_COMPARE["=" if op == ":" else op]
        keep = [s for s in ALL_COLOR_SETS if compare(len(s), int(v))]
    else:
        if v in ("c", "colorless", "colourless"):
            wanted, op = frozenset(), "=" if op == ":" else op
        elif v in COLOR_NAMES:
            wanted = frozenset(COLOR_NAMES[v])
        elif v in COLOR_SETS:
            wanted = frozenset(COLOR_SETS[v])
        elif all(ch in "wubrg" for ch in v):
            wanted = frozenset(v.upper())
        else:
            raise QueryError(f"unknown colour '{value}'")
        compare = _SET_COMPARE[default_op if op == ":" else op]
        keep = [s for s in ALL_COLOR_SETS if compare(s, wanted)]
    if len(keep) == len(ALL_COLOR_SETS):
        return ("all",)
    return _any_of(field, [color_key(s) for s in keep])


def _regex(pattern: str) -> str:
    """Scryfall allows literal mana symbols such as {T} in a regex; escape those braces."""
    if re.search(r"\\s(pp|mm|pt)", pattern):
        raise Unsupported("Scryfall's \\spp, \\smm and \\spt regex shorthands are not supported yet")
    return re.sub(r"\{([^}\d,][^}]*)\}", r"\\{\1\\}", pattern)


def _text(field: str, kw: Keyword):
    if kw.op not in (":", "="):
        raise QueryError(f"'{kw.key}' does not take '{kw.op}'")
    if kw.regex:
        return ("re", field, _regex(kw.value))
    return ("has", field, fold(kw.value))


def _type(kw: Keyword):
    """A complete type word ("fish") matches whole words only; anything else matches as a substring."""
    if kw.regex or kw.op not in (":", "="):
        return _text("type_lc", kw)
    value = fold(kw.value)
    return ("in", "type_words", value) if value in type_word_set() else ("has", "type_lc", value)


def _name(text: str):
    """Name contains the text, ignoring case, diacritics and punctuation ("urzas" finds "Urza's")."""
    if plain(text) == fold(text):  # no punctuation typed: the punctuation-free name is enough
        return ("has", "name_plain", plain(text))
    if not plain(text):
        return ("has", "name_lc", fold(text))
    return ("or", [("has", "name_lc", fold(text)), ("has", "name_plain", plain(text))])


def _stat(kw: Keyword, canonical: str):
    """pow, tou and loy match when any face satisfies the comparison; pow can be compared with tou."""
    prefix, op = STATS[canonical], "=" if kw.op == ":" else kw.op
    other = KEYWORDS.get(kw.value.lower())
    if other in STATS or other == "powtou":
        if {canonical, other} != {"power", "toughness"}:
            raise Unsupported(f"comparing {canonical} with {other} is not supported yet")
        if canonical == "toughness":  # tou>pow is pow<tou
            op = _FLIP[op]
        return _any_of("stat_rel", [f"pow{r}tou" for r in _RELATIONS[op]])
    n = _number(kw.key, kw.value)
    low, high = f"{prefix}_min", f"{prefix}_max"
    if op in (">", ">="):
        return ("cmp", high, op, n)
    if op in ("<", "<="):
        return ("cmp", low, op, n)
    return ("or", [("cmp", low, op, n), ("cmp", high, op, n)])


def _keyword(kw: Keyword, options: Options):
    canonical = KEYWORDS[kw.key]
    if canonical is None:
        raise Unsupported(f"'{kw.key}:' is not supported yet")
    op, value = kw.op, kw.value
    if op not in _OPS:
        raise QueryError(f"bad operator '{op}'")
    if kw.regex and canonical not in ("type", "oracle", "fulloracle", "name"):
        raise QueryError(f"'{kw.key}' does not take a regular expression")

    if canonical == "color":
        return _colors("c_sets", op, value, ">=")
    if canonical == "identity":
        return _colors("id_sets", op, value, "<=")
    if canonical == "type":
        if not kw.regex and EXTRA_TYPES.search(value.lower()):
            options.include_extras = True
        return _type(kw)
    if canonical == "oracle":
        return _text("oracle_tilde_lc" if "~" in value else "oracle_lc", kw)
    if canonical == "fulloracle":
        return _text("fulloracle_lc", kw)
    if canonical == "name":
        if kw.regex:
            options.include_extras = True  # observed: a name regex on Scryfall also searches extras
            return ("re", "name_lc", _regex(value))
        return _name(value)
    if canonical == "keyword":
        return ("in", "keywords_lc", fold(value))
    if canonical == "manavalue":
        if value.lower() in ("even", "odd"):
            return ("eq", "cmc_even", value.lower() == "even")
        return ("cmp", "cmc", "=" if op == ":" else op, _number(kw.key, value))
    if canonical in STATS:
        return _stat(kw, canonical)
    if canonical == "powtou":
        return ("cmp", "pt_num", "=" if op == ":" else op, _number(kw.key, value))
    if canonical in ("format", "banned", "restricted"):
        fmt = FORMAT_ALIASES.get(value.lower(), value.lower())
        return ("in", "legal" if canonical == "format" else canonical, fmt)
    if canonical in ("is", "not"):
        flag = FLAG_ALIASES.get(value.lower(), value.lower())
        if flag not in FLAGS:
            raise Unsupported(f"'{kw.key}:{value}' is not supported yet")
        test = ("in", "flags", flag)
        return test if canonical == "is" else ("not", test)
    if canonical == "otag":
        return ("in", "otags", value.lower().replace(" ", "-"))
    if canonical == "edhrec":
        return ("cmp", "edhrec_rank", "=" if op == ":" else op, _number(kw.key, value))

    # display directives: they change options, not which cards match
    if canonical == "include":
        if value.lower() != "extras":
            raise Unsupported(f"'include:{value}' is not supported yet")
        options.include_extras = True
    elif canonical == "order":
        if value.lower() not in ORDER_FIELDS:
            raise Unsupported(f"'order:{value}' is not supported yet")
        options.order = ORDER_FIELDS[value.lower()]
    elif canonical == "direction":
        options.descending = value.lower().startswith("desc")
    elif canonical == "unique" and value.lower() != "cards":
        raise Unsupported(f"'unique:{value}' is not supported yet")
    return ("all",)


def _lower(node, options: Options):
    if isinstance(node, And):
        return ("and", [_lower(c, options) for c in node.children])
    if isinstance(node, Or):
        return ("or", [_lower(c, options) for c in node.children])
    if isinstance(node, Not):
        return ("not", _lower(node.child, options))
    if isinstance(node, Name):
        return ("in", "names_lc", fold(node.text)) if node.exact else _name(node.text)
    return _keyword(node, options)


def simplify(p):
    """Flatten nested and/or and drop ("all",) from conjunctions."""
    if p[0] in ("and", "or"):
        kids = []
        for kid in map(simplify, p[1]):
            kids.extend(kid[1] if kid[0] == p[0] else [kid])
        if p[0] == "and":
            kids = [k for k in kids if k != ("all",)]
            if not kids:
                return ("all",)
        elif ("all",) in kids:
            return ("all",)
        return kids[0] if len(kids) == 1 else (p[0], kids)
    if p[0] == "not":
        return ("not", simplify(p[1]))
    return p


def lower(ast) -> tuple[tuple, Options]:
    """AST -> (predicate IR, display options). Extras are hidden unless the query reveals them."""
    options = Options()
    predicate = _lower(ast, options)
    if not options.include_extras:
        predicate = ("and", [predicate, ("eq", "extra", False)])
    return simplify(predicate), options
