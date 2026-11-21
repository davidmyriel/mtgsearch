"""A small hand-built card set covering the shapes the document builder has to handle."""

import pytest

from mtgsearch.documents import build_document

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
        "Sol Ring", "Artifact", "{T}: Add {C}{C}.", mana_cost="{1}", cmc=1.0, edhrec_rank=1,
        legalities={**LEGAL, "modern": "not_legal", "vintage": "restricted", "legacy": "banned"},
    ),
    card(
        "Llanowar Elves", "Creature — Elf Druid", "{T}: Add {G}.",
        mana_cost="{G}", cmc=1.0, colors=["G"], color_identity=["G"], power="1", toughness="1",
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


@pytest.fixture(scope="session")
def docs():
    return {c["name"]: build_document(c, TAGS.get(c["oracle_id"])) for c in CARDS}
