"""Lexer and recursive-descent parser for Scryfall's search syntax.

Grammar:
    query := or
    or    := and ("or" and)*
    and   := term*
    term  := "-" term | "(" or ")" | keyword | name
    keyword := KEY OP VALUE          KEY in KEYWORDS, OP in : = != < <= > >=
    name  := "!"? (WORD | QUOTED)    a bare word matches the card name; "!" asks for the exact name
    VALUE := WORD | QUOTED | /REGEX/
"""

import re
from dataclasses import dataclass


class QueryError(ValueError):
    """The query is not valid Scryfall syntax."""


class Unsupported(QueryError):
    """Valid Scryfall syntax that this implementation does not handle yet."""


@dataclass(frozen=True)
class Keyword:
    key: str
    op: str
    value: str
    regex: bool = False


@dataclass(frozen=True)
class Name:
    text: str
    exact: bool = False


@dataclass(frozen=True)
class Not:
    child: object


@dataclass(frozen=True)
class And:
    children: tuple


@dataclass(frozen=True)
class Or:
    children: tuple


# alias -> canonical keyword. Keys mapped to None are recognised but not implemented yet.
KEYWORDS: dict[str, str | None] = {
    "c": "color", "color": "color",
    "id": "identity", "identity": "identity", "ci": "identity",
    "t": "type", "type": "type",
    "o": "oracle", "oracle": "oracle",
    "fo": "fulloracle", "fulloracle": "fulloracle",
    "kw": "keyword", "keyword": "keyword",
    "name": "name",
    "mv": "manavalue", "manavalue": "manavalue", "cmc": "manavalue",
    "pow": "power", "power": "power",
    "tou": "toughness", "toughness": "toughness",
    "pt": "powtou", "powtou": "powtou",
    "loy": "loyalty", "loyalty": "loyalty",
    "f": "format", "format": "format", "legal": "format",
    "banned": "banned", "restricted": "restricted",
    "is": "is", "not": "not",
    "otag": "otag", "oracletag": "otag", "function": "otag",
    "edhrec": "edhrec", "edhrecrank": "edhrec",
    "include": "include", "order": "order", "sort": "order", "direction": "direction",
    "unique": "unique", "display": "display",
}  # fmt: skip
for _key in (
    "m mana devotion produces r rarity s e set edition b block cube a artist ft flavor wm watermark "
    "border frame stamp game in new lang language year date usd eur tix cn number st has art atag "
    "arttag cheapest prefer"
).split():
    KEYWORDS.setdefault(_key, None)

_KEYWORD_HEAD = re.compile(r"([A-Za-z]+)(!=|<=|>=|:|=|<|>)")


def _read_value(q: str, i: int) -> tuple[str, bool, int]:
    """Read a value starting at q[i]. Returns (text, is_regex, next index)."""
    if i < len(q) and q[i] == '"':
        end = q.find('"', i + 1)
        if end < 0:
            raise QueryError("unterminated quote")
        return q[i + 1 : end], False, end + 1
    if i < len(q) and q[i] == "/":
        j = i + 1
        while j < len(q) and not (q[j] == "/" and q[j - 1] != "\\"):
            j += 1
        if j >= len(q):
            raise QueryError("unterminated regular expression")
        return q[i + 1 : j].replace("\\/", "/"), True, j + 1
    j = i
    while j < len(q) and not q[j].isspace() and q[j] not in "()":
        j += 1
    return q[i:j], False, j


def _tokens(q: str) -> list:
    out, i = [], 0
    while i < len(q):
        ch = q[i]
        if ch.isspace():
            i += 1
        elif ch in "()":
            out.append(ch)
            i += 1
        elif ch == "-" and i + 1 < len(q) and not q[i + 1].isspace():
            out.append("-")
            i += 1
        elif ch == "!" and i + 1 < len(q) and not q[i + 1].isspace():
            text, _, i = _read_value(q, i + 1)
            out.append(Name(text, exact=True))
        else:
            head = _KEYWORD_HEAD.match(q, i)
            if head and head.group(1).lower() in KEYWORDS:
                value, is_regex, i = _read_value(q, head.end())
                if value == "":
                    raise QueryError(f"'{head.group(1)}{head.group(2)}' needs a value")
                out.append(Keyword(head.group(1).lower(), head.group(2), value, is_regex))
            elif head and ch != '"':
                raise QueryError(f"unknown keyword '{head.group(1)}'")
            else:
                text, _, i = _read_value(q, i)
                if text == "-":
                    raise QueryError("'-' must be followed by a term")
                out.append("or" if text.lower() == "or" and ch != '"' else Name(text))
    return out


def parse(query: str):
    """Parse a query string into an AST. Raises QueryError on malformed input."""
    tokens, pos = _tokens(query), 0

    def peek():
        return tokens[pos] if pos < len(tokens) else None

    def term():
        nonlocal pos
        tok = peek()
        pos += 1
        if tok == "-":
            if peek() in (None, ")", "or"):
                raise QueryError("'-' must be followed by a term")
            return Not(term())
        if tok == "(":
            node = either()
            if peek() != ")":
                raise QueryError("missing ')'")
            pos += 1
            return node
        return tok

    def both():
        children = []
        while peek() not in (None, ")", "or"):
            children.append(term())
        return children[0] if len(children) == 1 else And(tuple(children))

    def either():
        nonlocal pos
        children = [both()]
        while peek() == "or":
            pos += 1
            children.append(both())
        return children[0] if len(children) == 1 else Or(tuple(children))

    node = either()
    if pos < len(tokens):
        raise QueryError(f"unexpected '{tokens[pos]}'")
    return node
