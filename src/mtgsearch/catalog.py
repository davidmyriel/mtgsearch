"""Small catalogues the search app bundles, generated from the bulk data by `mtgsearch catalog`.

Type words (supertypes, card types and subtypes). Scryfall matches `t:fish` against whole
type words (so it does not find Jellyfish) but matches an unknown fragment such as `t:jelly`
as a substring. Telling the two apart needs the list of real type words (app/type-words.json).

Set release dates, so `date>=ori` can be compared (app/sets.json), and the flags a printing can
carry, so `is:prerelease` is recognised (app/printing-flags.json). Run it after new sets appear.
"""

from collections.abc import Iterable
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
OUTPUT = APP / "type-words.json"
SETS_OUTPUT = APP / "sets.json"
FLAGS_OUTPUT = APP / "printing-flags.json"


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


def set_dates(printings: Iterable[dict]) -> dict[str, str]:
    """Set code -> release date: the date most of the set's cards share."""
    from collections import Counter, defaultdict

    dates: dict[str, Counter] = defaultdict(Counter)
    for p in printings:
        dates[p["set"]][p["released_at"]] += 1
    return {code: dates[code].most_common(1)[0][0] for code in sorted(dates)}


def printing_flags(printings: Iterable[dict]) -> list[str]:
    """Every value the `pflags` field of a printing document can hold."""
    from .printings import FLAG_KEYS

    flags = {name for _, name in FLAG_KEYS}
    for p in printings:
        flags.update(p.get("finishes") or [])
        flags.update(p.get("promo_types") or [])
    return sorted(flags)
