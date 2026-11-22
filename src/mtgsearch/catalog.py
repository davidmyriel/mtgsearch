"""The catalogue of known type words (supertypes, card types and subtypes).

Scryfall matches `t:fish` against whole type words (so it does not find Jellyfish) but matches
an unknown fragment such as `t:jelly` as a substring. Telling the two apart needs the list of
real type words. `mtgsearch catalog` writes it to app/type-words.json, which the search app
bundles; run it after new sets add types.
"""

from collections.abc import Iterable
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[2] / "app" / "type-words.json"


def build(cards: Iterable[dict]) -> list[str]:
    """Type words from Scryfall card objects: cards shown by default, plus real game extras.

    Words that only occur on memorabilia and other hidden oddities ("Summon Legend") are left
    out, otherwise `t:legend` would stop matching "Legendary".
    """
    from .documents import is_extra, type_words

    game_extras = {"token", "double_faced_token", "emblem", "planar", "scheme", "vanguard"}
    words: set[str] = set()
    for card in cards:
        if not is_extra(card) or card["layout"] in game_extras:
            line = card.get("type_line") or " // ".join(
                f.get("type_line", "") for f in card.get("card_faces", [])
            )
            words.update(type_words(line))
    return sorted(words)
