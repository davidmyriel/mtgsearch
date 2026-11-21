"""The catalogue of known type words (supertypes, card types and subtypes).

Scryfall matches `t:fish` against whole type words (so it does not find Jellyfish) but matches
an unknown fragment such as `t:jelly` as a substring. Telling the two apart needs the list of
real type words. It is generated from the bulk data by `mtgsearch catalog` and committed.
"""

from collections.abc import Iterable
from functools import lru_cache
from importlib import resources

FILE = "type_words.txt"


@lru_cache
def type_word_set() -> frozenset[str]:
    return frozenset(resources.files("mtgsearch").joinpath(FILE).read_text(encoding="utf-8").split())


def build(documents: Iterable[dict]) -> list[str]:
    """All type words that appear on cards Scryfall shows by default or on extras."""
    return sorted({w for d in documents for w in d.get("type_words", [])})
