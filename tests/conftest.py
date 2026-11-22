"""A small hand-built card set covering the shapes the document builder has to handle."""

import pytest

from mtgsearch.documents import build_document
from mtgsearch.printings import aggregates, build_printing, oracle_id, preference_ranks

LEGAL = {"commander": "legal", "modern": "legal", "vintage": "legal", "standard": "not_legal"}


def card(name, type_line, oracle_text="", **kw):
    base = {
        "oracle_id": name.lower().replace(" ", "-"),
        "name": name,
        "layout": "normal",
        "type_line": type_line,
        "oracle_text": oracle_text,
        "mana_cost": "",
        "cmc": 0.0,
        "colors": [],
        "color_identity": [],
        "keywords": [],
        "legalities": dict(LEGAL),
        "set_type": "expansion",
        "scryfall_uri": f"https://scryfall.com/card/x/1/{name.lower().replace(' ', '-')}?utm_source=api",
    }
    base.update(kw)
    return base


CARDS = [
    card(
        "Consecrated Sphinx", "Creature — Sphinx",
        "Flying\nWhenever an opponent draws a card, you may draw two cards.",
        mana_cost="{4}{U}{U}", cmc=6.0, colors=["U"], color_identity=["U"], keywords=["Flying"],
        power="4", toughness="6", edhrec_rank=661,
    ),
    card(
        "Sol Ring", "Artifact", "{T}: Add {C}{C}.", mana_cost="{1}", cmc=1.0, edhrec_rank=1, produced_mana=["C"],
        legalities={**LEGAL, "modern": "not_legal", "vintage": "restricted", "legacy": "banned"},
    ),
    card(
        "Llanowar Elves", "Creature — Elf Druid", "{T}: Add {G}.",
        mana_cost="{G}", cmc=1.0, colors=["G"], color_identity=["G"], power="1", toughness="1",
        produced_mana=["G"],
    ),
    card(
        "Grizzly Bears", "Creature — Bear", "",
        mana_cost="{1}{G}", cmc=2.0, colors=["G"], color_identity=["G"], power="2", toughness="2",
    ),
    card(
        "Tarmogoyf", "Creature — Lhurgoyf",
        "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its "
        "toughness is equal to that number plus 1.",
        mana_cost="{1}{G}", cmc=2.0, colors=["G"], color_identity=["G"], power="*", toughness="1+*",
    ),
    card(
        "Jace, the Mind Sculptor", "Legendary Planeswalker — Jace",
        "+2: Look at the top card of target player's library.\n0: Draw three cards, then put two cards "
        "from your hand on top of your library in any order.",
        mana_cost="{2}{U}{U}", cmc=4.0, colors=["U"], color_identity=["U"], loyalty="3",
    ),
    card(
        "Lim-Dûl's Vault", "Instant",
        "Look at the top five cards of your library. (Then shuffle.)",
        mana_cost="{U}{B}", cmc=2.0, colors=["B", "U"], color_identity=["B", "U"],
    ),
    card(
        "Boros Reckoner", "Creature — Minotaur Wizard",
        "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target.",
        mana_cost="{R/W}{R/W}{R/W}", cmc=3.0, colors=["R", "W"], color_identity=["R", "W"],
        power="3", toughness="3",
    ),
    {  # transforming double-faced card: colours, cost and text live on the faces
        **card("Archangel Avacyn // Avacyn, the Purifier", "Legendary Creature — Angel // Legendary Creature — Angel"),
        "layout": "transform", "cmc": 5.0, "color_identity": ["R", "W"],
        "keywords": ["Flying", "Vigilance", "Flash"],
        "card_faces": [
            {
                "name": "Archangel Avacyn", "mana_cost": "{3}{W}{W}", "type_line": "Legendary Creature — Angel",
                "oracle_text": "Flash\nFlying, vigilance\nWhen Archangel Avacyn enters, creatures you control "
                "gain indestructible until end of turn.",
                "colors": ["W"], "power": "4", "toughness": "4",
            },
            {
                "name": "Avacyn, the Purifier", "mana_cost": "", "type_line": "Legendary Creature — Angel",
                "oracle_text": "Flying\nWhen this creature transforms into Avacyn, the Purifier, it deals 3 "
                "damage to each other creature and each opponent.",
                "colors": ["R"], "power": "6", "toughness": "5",
            },
        ],
    },
    {  # split card: one cost string for both halves
        **card("Fire // Ice", "Instant // Instant"),
        "layout": "split", "mana_cost": "{1}{R} // {1}{U}", "cmc": 4.0,
        "colors": ["R", "U"], "color_identity": ["R", "U"],
        "card_faces": [
            {"name": "Fire", "mana_cost": "{1}{R}", "type_line": "Instant",
             "oracle_text": "Fire deals 2 damage divided as you choose among one or two targets."},
            {"name": "Ice", "mana_cost": "{1}{U}", "type_line": "Instant",
             "oracle_text": "Tap target permanent.\nDraw a card."},
        ],
    },
    card("Goblin", "Token Creature — Goblin", "", layout="token", set_type="token",
         colors=["R"], color_identity=["R"], power="1", toughness="1"),
]  # fmt: skip
for _c in CARDS:
    if _c["layout"] == "transform":
        _c.pop("colors", None)
        _c.pop("mana_cost", None)
        _c.pop("oracle_text", None)

TAGS = {"sol-ring": {"labels": ["mana rock"], "slugs": ["mana-rock", "ramp"]}}

_BY_NAME = {c["name"]: c for c in CARDS}


def printing(name, set_code, number, rarity, released, **kw):
    """One printing of a card in CARDS, shaped like an object from Scryfall's default_cards file."""
    base = {
        **_BY_NAME[name],
        "id": f"{set_code}-{number}",
        "set": set_code,
        "set_name": set_code.upper(),
        "set_type": "expansion",
        "collector_number": number,
        "rarity": rarity,
        "released_at": released,
        "lang": "en",
        "artist": "Mark Zug",
        "frame": "2015",
        "border_color": "black",
        "games": ["paper", "mtgo"],
        "finishes": ["nonfoil", "foil"],
        "prices": {
            "usd": None,
            "usd_foil": None,
            "usd_etched": None,
            "eur": None,
            "eur_foil": None,
            "tix": None,
        },
        "scryfall_uri": f"https://scryfall.com/card/{set_code}/{number}/x?utm_source=api",
    }
    base.update(kw)
    return base


_AVACYN = _BY_NAME["Archangel Avacyn // Avacyn, the Purifier"]
PRINTINGS = [
    printing(
        "Consecrated Sphinx", "nph", "30", "mythic", "2011-05-13", frame="2003", artist="Mark Zug",
        flavor_text="Blessed by the hands of Jin-Gitaxias.", watermark="phyrexian",
        prices={"usd": "41.50", "usd_foil": "90.00", "eur": "30.10", "tix": "0.50"},
    ),
    printing(
        "Consecrated Sphinx", "ima", "47", "mythic", "2017-11-17", reprint=True, security_stamp="oval",
        highres_image=True, booster=True, prices={"usd": "34.97", "usd_foil": "37.56", "eur": "26.21", "tix": "0.23"},
    ),
    printing(
        "Consecrated Sphinx", "pima", "47s", "rare", "2017-11-18", reprint=True, promo=True,
        promo_types=["prerelease", "datestamped"], finishes=["foil"], games=["paper"],
        prices={"usd": None, "usd_foil": "55.00"},
    ),
    printing(
        "Sol Ring", "lea", "270", "uncommon", "1993-08-05", frame="1993", artist="Mark Tedin",
        games=["paper"], finishes=["nonfoil"], prices={"usd": "1500.00"},
    ),
    printing(
        "Sol Ring", "c21", "263", "uncommon", "2021-04-23", reprint=True, artist="Mike Bierek",
        flavor_text="Lost to time is the artificer's art of trapping light from a distant star.",
        prices={"usd": "1.29", "eur": "1.10"},
    ),
    printing(
        "Sol Ring", "sld", "1011", "rare", "2022-02-18", reprint=True, artist="Mike Bierek",
        border_color="borderless", full_art=True, frame_effects=["extendedart"],
        promo_types=["universesbeyond"], finishes=["foil", "etched"], games=["paper"],
        prices={"usd_etched": "20.00"},
    ),
    printing(
        "Llanowar Elves", "m19", "314", "common", "2018-07-13", reprint=True, artist="Chris Rahn",
        games=["paper", "mtgo", "arena"], prices={"usd": "0.25", "tix": "0.03"},
    ),
    printing(
        "Llanowar Elves", "anb", "13", "common", "2020-08-13", reprint=True, digital=True,
        artist="Chris Rahn", games=["arena"], finishes=["nonfoil"],
    ),
    printing("Grizzly Bears", "10e", "268", "common", "2007-07-13", frame="2003", artist="D. J. Cleland-Hura",
             border_color="white", flavor_text="Don't try to outrun one of Dominia's grizzlies."),
    {  # double-faced: flavour text and artist sit on the faces
        **printing("Archangel Avacyn // Avacyn, the Purifier", "soi", "5", "mythic", "2016-04-08",
                   artist="James Ryman", frame_effects=["sunmoondfc"], prices={"usd": "12.00"}),
        "card_faces": [
            {**_AVACYN["card_faces"][0], "artist": "James Ryman", "illustration_id": "art-avacyn",
             "flavor_text": "A golden helix streaked skyward."},
            {**_AVACYN["card_faces"][1], "artist": "James Ryman", "illustration_id": "art-purifier"},
        ],
    },
    printing("Goblin", "tm19", "8", "common", "2018-07-13", layout="token", set_type="token", artist="Karl Kopinski"),
]  # fmt: skip
PRINTINGS[0]["illustration_id"] = PRINTINGS[1]["illustration_id"] = PRINTINGS[2]["illustration_id"] = (
    "art-sphinx"
)
# Scryfall's bulk file of Oracle cards holds one printing per card: its pick to represent the card.
REPRESENTATIVES = {"ima-47", "c21-263", "m19-314", "10e-268", "soi-5", "tm19-8"}
AGGREGATES = aggregates(PRINTINGS)


def card_documents() -> list[dict]:
    return [build_document(c, TAGS.get(c["oracle_id"]), AGGREGATES.get(c["oracle_id"])) for c in CARDS]


def printing_documents() -> list[dict]:
    ranks = preference_ranks(PRINTINGS, REPRESENTATIVES)
    return [
        build_printing(p, TAGS.get(oracle_id(p)), AGGREGATES[oracle_id(p)], ranks[p["id"]]) for p in PRINTINGS
    ]


@pytest.fixture(scope="session")
def docs():
    return {d["name"]: d for d in card_documents()}


@pytest.fixture(scope="session")
def prints():
    return {d["_id"]: d for d in printing_documents()}
