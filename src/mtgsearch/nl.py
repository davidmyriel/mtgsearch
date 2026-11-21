"""Pull hard filters out of a plain-English query.

Embeddings are poor at numbers and mana symbols: "one mana artifact that taps for two
colorless mana" did not find Sol Ring until mana value was applied as a filter. This module
reads the leading noun phrase of a query ("one mana blue artifact ...") and turns mana value,
colours and card types into the same predicate IR the Scryfall-syntax compiler produces.

It is deliberately conservative. Only the opening noun phrase is read, so "protection from
red" or "play lands from my graveyard" never become filters. Everything else is left to
semantic ranking, and the caller tops up with unfiltered results when a filter is too strict.
"""

import re
from dataclasses import dataclass, field

from .catalog import type_word_set
from .syntax.lower import COLOR_NAMES, _colors

_NUMBER_NAMES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
)
NUMBER_WORDS = {word: n for n, word in enumerate(_NUMBER_NAMES.split())}
_NUM = r"(?:\d{1,2}|" + "|".join(NUMBER_WORDS) + ")"
ARTICLES = {"a", "an", "the", "any", "some"}
FILLERS = {"big", "small", "cheap", "huge", "giant", "little", "good", "best", "powerful", "strong", "mono"}
COLOR_WORDS = {**COLOR_NAMES, "colorless": "", "colourless": ""}
# Words that are types in the catalogue but usually mean something else at the start of a sentence.
NOT_TYPES = {"card", "cards", "spell", "spells", "permanent", "permanents", "token", "tokens"}
# "... for four mana" at the end of a query is a cost, unless it follows a verb about producing mana.
_TRAILING_COST = re.compile(rf"\b(\w+) for ({_NUM}) mana$")
_MANA_PRODUCERS = {"tap", "taps", "add", "adds", "produce", "produces", "make", "makes", "pay", "pays"}
_MANA_VALUE = re.compile(rf"^({_NUM})[- ](?:mana|cmc|mv|drop)\b|^(?:cmc|mv|mana value) ({_NUM})\b")


@dataclass
class Extracted:
    predicate: tuple = ("all",)
    notes: list[str] = field(default_factory=list)  # human-readable, e.g. ["mana value 1", "artifact"]

    @property
    def any(self) -> bool:
        return self.predicate != ("all",)


def _number(token: str) -> int:
    return NUMBER_WORDS[token] if token in NUMBER_WORDS else int(token)


def _singular(word: str, known: frozenset[str]) -> str | None:
    """The type word a possibly plural word stands for ("elves" -> "elf"), or None."""
    candidates = []
    # Plural forms first: "elves" is itself a type word on one old card, but it means Elf.
    if word.endswith("ves"):
        candidates.append(word[:-3] + "f")
    if word.endswith("ies"):
        candidates.append(word[:-3] + "y")
    if word.endswith("es"):
        candidates.append(word[:-2])
    if word.endswith("s"):
        candidates.append(word[:-1])
    candidates.append(word)
    return next((c for c in candidates if c in known), None)


def extract(query: str) -> Extracted:
    """Read mana value, colours and types from the opening noun phrase of `query`."""
    known = type_word_set()
    text = re.sub(r"\s+", " ", query.lower().strip())
    parts, notes = [], []
    mana_value, colors, types = None, [], []

    rest = text
    while rest:
        m = _MANA_VALUE.match(rest)
        if m and mana_value is None:
            mana_value = _number(m.group(1) or m.group(2))
            rest = rest[m.end() :].lstrip(" ,")
            continue
        word = re.match(r"[a-z'-]+", rest)
        if not word:
            break
        token = word.group().strip("-'")
        if token in ARTICLES or token in FILLERS:
            pass
        elif token in COLOR_WORDS:
            colors.append(token)
        elif token not in NOT_TYPES and _singular(token, known):
            types.append(_singular(token, known))
        else:
            break
        rest = rest[word.end() :].lstrip(" ,-")

    if mana_value is None:
        m = _TRAILING_COST.search(text)
        if m and m.group(1) not in _MANA_PRODUCERS:
            mana_value = _number(m.group(2))

    if mana_value is not None:
        parts.append(("cmp", "cmc", "=", float(mana_value)))
        notes.append(f"mana value {mana_value}")
    # A colour only counts when it describes a card: "blue sphinx", not a query that is just "red".
    if colors and (types or mana_value is not None):
        for color in colors:
            parts.append(_colors("c_sets", ":", color, ">="))
            notes.append(color)
    for type_word in types:
        parts.append(("in", "type_words", type_word))
        notes.append(type_word)

    if not parts:
        return Extracted()
    return Extracted(parts[0] if len(parts) == 1 else ("and", parts), notes)
