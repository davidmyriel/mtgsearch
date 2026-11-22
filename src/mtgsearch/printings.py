"""Turn a Scryfall printing into the document stored in the printings collection.

A printing is a card as it appears in one set: the same Oracle card with its own set,
collector number, rarity, artist, frame, flavour text and price. One document per printing.
Each document also carries every card-level filter field, so a query that mixes card and
printing conditions (`t:sphinx set:ima r:mythic`) is answered by one filter on one collection.
Nothing here is embedded: plain-English search runs on the cards collection.
"""

import re
from collections import defaultdict
from collections.abc import Iterable

from .documents import build_document, fold, is_extra, price

RARITY_RANK = {"common": 0, "uncommon": 1, "rare": 2, "special": 3, "mythic": 4, "bonus": 5}
# Scryfall card fields that become `is:` flags on a printing.
FLAG_KEYS = (
    ("promo", "promo"),
    ("reprint", "reprint"),
    ("digital", "digital"),
    ("full_art", "fullart"),
    ("textless", "textless"),
    ("story_spotlight", "spotlight"),
    ("booster", "booster"),
    ("oversized", "oversized"),
    ("variation", "variation"),
    ("highres_image", "hires"),
)
# A reversible card keeps its card fields on its faces, which are two copies of the same card.
FACE_FIELDS = (
    "oracle_id",
    "cmc",
    "type_line",
    "mana_cost",
    "colors",
    "oracle_text",
    "power",
    "toughness",
    "loyalty",
    "image_uris",
)
SPECIAL_FRAMES = {"showcase", "extendedart"}
# `in:rare` asks whether a card was ever printed at rare. Observed on Scryfall: printings in
# these kinds of set, and Secret Lair drops, do not count (their rarity is nominal).
NO_RARITY_SET_TYPES = {
    "promo",
    "masterpiece",
    "from_the_vault",
    "memorabilia",
    "token",
    "minigame",
    "vanguard",
}
NO_RARITY_SETS = {"sld"}
_DIGITS = re.compile(r"\d+")


def cents(prices: dict, *keys: str) -> int | None:
    """A price in whole cents. Integers compare exactly; TopK stores decimals in single precision."""
    value = price(prices, *keys)
    return None if value is None else round(value * 100)


def as_card(printing: dict) -> dict:
    """The printing shaped like an ordinary card object, so the card document builder can read it."""
    if printing.get("oracle_id"):
        return printing
    face = printing["card_faces"][0]
    card = {k: v for k, v in printing.items() if k != "card_faces"}
    card.update({k: face[k] for k in FACE_FIELDS if k in face})
    return card


def oracle_id(printing: dict) -> str:
    return printing.get("oracle_id") or printing["card_faces"][0]["oracle_id"]


def aggregates(printings: Iterable[dict]) -> dict[str, dict]:
    """Per Oracle card, what is true across all of its printings: `in:`, `prints`, `sets`."""
    sets, rarities, games, counts = defaultdict(set), defaultdict(set), defaultdict(set), defaultdict(int)
    for p in printings:
        oid = oracle_id(p)
        sets[oid].add(p["set"])
        if p["set_type"] not in NO_RARITY_SET_TYPES and p["set"] not in NO_RARITY_SETS:
            rarities[oid].add(p["rarity"])
        games[oid].update(p.get("games", []))
        counts[oid] += 1
    return {
        oid: {
            "in_sets": sorted(sets[oid]),
            "in_rarities": sorted(rarities[oid]),
            "in_games": sorted(games[oid]),
            "prints": counts[oid],
            "sets": len(sets[oid]),
        }
        for oid in counts
    }


def _number(printing: dict) -> float | None:
    digits = _DIGITS.search(printing["collector_number"])
    return float(digits.group()) if digits else None


def preference(printing: dict, representatives: set[str]) -> tuple:
    """Sort key for choosing which printing shows a card: smaller is preferred.

    Scryfall's own pick for the card comes first, then English, paper, regular-looking
    printings, newest first.
    """
    plain_frame = (
        printing["border_color"] == "black"
        and not printing.get("full_art")
        and not printing.get("textless")
        and not SPECIAL_FRAMES & set(printing.get("frame_effects") or [])
    )
    return (
        printing["id"] not in representatives,
        printing["lang"] != "en",
        bool(printing.get("digital")),
        is_extra(printing),
        bool(printing.get("promo")),
        not plain_frame,
        -int(printing["released_at"].replace("-", "")),
        printing["set"],
        printing["collector_number"],
        printing["id"],
    )


def preference_ranks(printings: Iterable[dict], representatives: set[str]) -> dict[str, int]:
    """Printing id -> its rank among the printings of its card, 0 being the one to show first."""
    by_card = defaultdict(list)
    for p in printings:
        by_card[oracle_id(p)].append((preference(p, representatives), p["id"]))
    return {pid: rank for group in by_card.values() for rank, (_, pid) in enumerate(sorted(group))}


def build_printing(printing: dict, tags: dict | None, aggregate: dict | None, pref_rank: int) -> dict:
    """Build the document for one printing: the card's filter fields plus the printing's own."""
    doc = build_document(as_card(printing), tags, aggregate)
    del doc["rules"], doc["rules_tagged"]  # semantic text lives in the cards collection only
    doc.pop("usd", None)  # prices are kept in cents here

    faces = printing.get("card_faces") or []
    flavor = printing.get("flavor_text") or "\n".join(f["flavor_text"] for f in faces if f.get("flavor_text"))
    watermarks = {printing.get("watermark"), *(f.get("watermark") for f in faces)} - {None}
    illustration = printing.get("illustration_id") or next(
        (f["illustration_id"] for f in faces if f.get("illustration_id")), None
    )
    released = printing["released_at"]
    flags = {name for key, name in FLAG_KEYS if printing.get(key)}
    flags |= set(printing.get("finishes") or []) | set(printing.get("promo_types") or [])
    prices = printing.get("prices") or {}

    doc.update(
        {
            "_id": printing["id"],
            "oracle_id": oracle_id(printing),
            "set": printing["set"],
            "set_name": printing["set_name"],
            "set_type": printing["set_type"],
            "cn": fold(printing["collector_number"]),
            "cn_num": _number(printing),
            "rarity": printing["rarity"],
            "rarity_rank": RARITY_RANK[printing["rarity"]],
            "artist": printing.get("artist"),
            "artist_lc": fold(printing.get("artist") or "") or None,
            "flavor_text": flavor or None,
            "flavor_lc": fold(flavor) or None,
            "watermarks": sorted(watermarks),
            "frame": printing["frame"],
            "frame_effects": sorted(printing.get("frame_effects") or []),
            "border": printing["border_color"],
            "stamp": printing.get("security_stamp"),
            "games": sorted(printing.get("games") or []),
            "lang": printing["lang"],
            "released": released,
            "date": int(released.replace("-", "")),
            "year": int(released[:4]),
            "usd_c": cents(prices, "usd", "usd_foil", "usd_etched"),
            "eur_c": cents(prices, "eur", "eur_foil"),
            "tix_c": cents(prices, "tix"),
            "pflags": sorted(flags),
            # What `unique:art` groups by; printings without an illustration id stand alone.
            "art": illustration or printing["id"],
            "pref_rank": pref_rank,
        }
    )
    return {k: v for k, v in doc.items() if v is not None and v != []}
