"""Small catalogues the search app bundles, generated from the bulk data by `mtgsearch catalog`.

Type words (supertypes, card types and subtypes). Scryfall matches `t:fish` against whole
type words (so it does not find Jellyfish) but matches an unknown fragment such as `t:jelly`
as a substring. Telling the two apart needs the list of real type words (app/type-words.json).

Set release dates, so `date>=ori` can be compared (app/sets.json), and the flags a printing can
carry, so `is:prerelease` is recognised (app/printing-flags.json). Run it after new sets appear.

Blocks of sets, so `block:zen` finds Zendikar, Worldwake and Rise of the Eldrazi
(app/blocks.json). The bulk files do not say which block a set belongs to; Scryfall's list
of sets does.
"""

from collections.abc import Iterable
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
OUTPUT = APP / "type-words.json"
SETS_OUTPUT = APP / "sets.json"
BLOCKS_OUTPUT = APP / "blocks.json"
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


def blocks(sets: Iterable[dict]) -> dict:
    """What `block:` needs, from Scryfall's set objects.

    `sets` maps every set code to the block it stands for: its own block, else its parent
    set's, else the set at the top of its line of parents. `blocks` gives each block's name
    and its sets. A set outside every block is not listed there: it stands for itself alone,
    which is what Scryfall answers (`block:dom` is the Dominaria set, and so is
    `block:pdom`, its promos' set). `names` maps each set's name to its code, because a
    block can be asked for by the name of any of its sets (`block:worldwake`).
    """
    from .documents import fold

    sets = list(sets)
    by_code = {s["code"]: s for s in sets}

    def stands_for(code: str) -> str:
        seen = set()
        while code not in seen:
            seen.add(code)
            entry = by_code[code]
            if entry.get("block_code"):
                return entry["block_code"]
            parent = entry.get("parent_set_code")
            if not parent or parent not in by_code:
                break
            code = parent
        return code

    found: dict[str, dict] = {}
    for s in sets:
        if s.get("block_code"):
            block = found.setdefault(s["block_code"], {"name": s["block"], "sets": []})
            block["sets"].append(s["code"])
    for block in found.values():
        block["sets"].sort()
    names: dict[str, str] = {}
    for code in sorted(by_code):
        names.setdefault(fold(by_code[code].get("name") or code), code)
    return {
        "sets": {code: stands_for(code) for code in sorted(by_code)},
        "blocks": {code: found[code] for code in sorted(found)},
        "names": dict(sorted(names.items())),
    }
