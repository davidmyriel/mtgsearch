from conftest import AGGREGATES, PRINTINGS, REPRESENTATIVES

from mtgsearch.printings import aggregates, as_card, preference_ranks


def test_a_printing_carries_the_card_fields_and_its_own(prints):
    d = prints["ima-47"]
    assert d["oracle_id"] == "consecrated-sphinx" and d["name"] == "Consecrated Sphinx"
    assert d["type_words"] == ["creature", "sphinx"] and d["cmc"] == 6.0 and d["c_sets"] == ["U"]
    assert (d["set"], d["cn"], d["cn_num"], d["rarity"], d["rarity_rank"]) == ("ima", "47", 47.0, "mythic", 4)
    assert (d["released"], d["date"], d["year"]) == ("2017-11-17", 20171117, 2017)
    assert d["artist_lc"] == "mark zug" and d["frame"] == "2015" and d["border"] == "black"
    assert d["games"] == ["mtgo", "paper"] and d["lang"] == "en" and d["stamp"] == "oval"
    assert (d["usd_c"], d["eur_c"], d["tix_c"]) == (3497, 2621, 23) and "usd" not in d
    assert d["pflags"] == ["booster", "foil", "hires", "nonfoil", "reprint"]


def test_semantic_text_stays_out_of_printings(prints):
    assert all("rules" not in d and "rules_tagged" not in d for d in prints.values())


def test_flavour_watermark_and_frame(prints):
    d = prints["nph-30"]
    assert d["flavor_lc"] == "blessed by the hands of jin-gitaxias." and d["watermarks"] == ["phyrexian"]
    assert d["frame"] == "2003" and "flavor_lc" not in prints["ima-47"]
    assert (
        prints["sld-1011"]["frame_effects"] == ["extendedart"]
        and prints["sld-1011"]["border"] == "borderless"
    )


def test_empty_card_text_is_kept_because_the_collection_requires_those_fields(prints):
    bears = prints["10e-268"]
    assert bears["oracle_lc"] == "" and bears["fulloracle_lc"] == "" and bears["oracle_text"] == ""


def test_promo_types_and_finishes_become_flags(prints):
    assert prints["pima-47s"]["pflags"] == ["datestamped", "foil", "prerelease", "promo", "reprint"]
    assert {"etched", "foil", "fullart", "universesbeyond"} <= set(prints["sld-1011"]["pflags"])
    assert "digital" in prints["anb-13"]["pflags"]


def test_collector_numbers_keep_their_text_and_a_number(prints):
    assert (prints["pima-47s"]["cn"], prints["pima-47s"]["cn_num"]) == ("47s", 47.0)


def test_price_falls_back_to_foil_then_etched(prints):
    assert prints["pima-47s"]["usd_c"] == 5500
    assert prints["sld-1011"]["usd_c"] == 2000
    assert "usd_c" not in prints["anb-13"] and "eur_c" not in prints["sld-1011"]


def test_double_faced_printings_read_flavour_and_art_from_faces(prints):
    d = prints["soi-5"]
    assert d["flavor_lc"] == "a golden helix streaked skyward."
    assert d["art"] == "art-avacyn" and d["c_sets"] == ["R", "W"]


def test_a_printing_without_an_illustration_stands_alone_for_unique_art(prints):
    assert prints["lea-270"]["art"] == "lea-270"
    assert prints["nph-30"]["art"] == prints["ima-47"]["art"] == "art-sphinx"


def test_tokens_are_extras(prints):
    assert prints["tm19-8"]["extra"] is True and prints["ima-47"]["extra"] is False


def test_card_totals_cover_every_printing(docs, prints):
    sphinx = {"in_sets": ["ima", "nph", "pima"], "in_rarities": ["mythic", "rare"], "prints": 3, "sets": 3}
    assert AGGREGATES["consecrated-sphinx"] == {**sphinx, "in_games": ["mtgo", "paper"]}
    assert AGGREGATES["llanowar-elves"]["in_games"] == ["arena", "mtgo", "paper"]
    for doc in (docs["Consecrated Sphinx"], prints["nph-30"], prints["pima-47s"]):
        assert {k: doc[k] for k in sphinx} == sphinx
    assert "prints" not in docs["Tarmogoyf"]  # no printing of it in the test data


def test_preference_puts_scryfalls_pick_first_then_regular_recent_printings(prints):
    ranks = preference_ranks(PRINTINGS, REPRESENTATIVES)
    assert [ranks[i] for i in ("ima-47", "nph-30", "pima-47s")] == [0, 1, 2]  # pick, regular, promo
    assert [ranks[i] for i in ("c21-263", "lea-270", "sld-1011")] == [0, 1, 2]  # borderless foil last
    assert [ranks[i] for i in ("m19-314", "anb-13")] == [0, 1]  # digital after paper
    assert prints["ima-47"]["pref_rank"] == 0
    # Without Scryfall's pick, the newest regular paper printing wins.
    assert (
        preference_ranks(PRINTINGS, set())["ima-47"] == 0
        and preference_ranks(PRINTINGS, set())["c21-263"] == 0
    )


def test_a_reversible_card_is_read_from_its_first_face():
    face = {"oracle_id": "x", "cmc": 2.0, "type_line": "Land", "oracle_text": "{T}: Add {G}.", "colors": []}
    card = as_card(
        {"id": "p1", "layout": "reversible_card", "name": "X // X", "card_faces": [face, dict(face)]}
    )
    assert card["oracle_id"] == "x" and card["cmc"] == 2.0 and "card_faces" not in card


def test_in_rarity_ignores_promos_and_special_products():
    def p(set_type, rarity):
        return {
            "oracle_id": "x",
            "set": set_type[:3],
            "set_type": set_type,
            "rarity": rarity,
            "games": ["paper"],
        }

    totals = aggregates([p("expansion", "uncommon"), p("from_the_vault", "rare"), p("promo", "mythic")])["x"]
    assert totals["in_rarities"] == ["uncommon"]
    assert (
        totals["in_sets"] == ["exp", "fro", "pro"] and totals["prints"] == 3
    )  # sets and counts cover everything
    assert aggregates([p("commander", "rare"), p("masterpiece", "mythic")])["x"]["in_rarities"] == ["rare"]
    # box sets count, except Secret Lair drops
    lair = {**p("box", "rare"), "set": "sld"}
    assert aggregates([p("box", "common"), lair])["x"]["in_rarities"] == ["common"]
