from mtgsearch.documents import (
    INFINITY,
    _only_keywords,
    color_key,
    cost_parts,
    fold,
    is_extra,
    mana_fields,
    parse_cost,
    plain,
    stat,
    stats_text,
    type_words,
)


def test_fold_and_plain():
    assert fold("Lim-Dûl's Vault") == "lim-dul's vault"
    assert plain("Lim-Dûl's Vault") == "limduls vault"


def test_stat_parses_star_expressions_and_infinity():
    assert stat(None) is None
    assert stat("4") == 4.0
    assert stat("*") == 0.0
    assert stat("1+*") == 1.0
    assert stat("-1") == -1.0
    assert stat("∞") == INFINITY


def test_color_key_is_canonical():
    assert color_key(["U", "W"]) == "WU" and color_key("GR") == "RG" and color_key([]) == "C"


def test_type_words():
    assert type_words("Legendary Creature — Elf Druid // Land") == [
        "creature",
        "druid",
        "elf",
        "land",
        "legendary",
    ]


def test_normal_creature(docs):
    d = docs["Consecrated Sphinx"]
    assert d["type_lc"] == "creature — sphinx"
    assert d["type_words"] == ["creature", "sphinx"]
    assert d["c_sets"] == ["U"] and d["id_sets"] == ["U"]
    assert (d["pow_min"], d["pow_max"], d["tou_min"], d["pt_num"]) == (4.0, 4.0, 6.0, 10.0)
    assert d["stat_rel"] == ["pow<tou"]
    assert d["keywords_lc"] == ["flying"]
    assert "mana value 6" in d["rules"] and "blue" in d["rules"]
    assert d["rules_tagged"] == d["rules"]  # no tags for this card in the fixture
    assert d["scryfall_uri"].endswith("consecrated-sphinx")
    assert d["extra"] is False


def test_colourless_card_drops_empty_and_null_fields(docs):
    d = docs["Sol Ring"]
    assert d["c_sets"] == ["C"] and d["id_sets"] == ["C"]
    assert "colorless" in d["rules"]
    assert "keywords_lc" not in d  # an empty list would be rejected by TopK
    assert "pow_min" not in d and "loy_min" not in d and "stat_rel" not in d
    assert d["rules_tagged"].endswith("Tags: mana rock")
    assert d["otags"] == ["mana-rock", "ramp"]


def test_legalities(docs):
    d = docs["Sol Ring"]
    assert "commander" in d["legal"] and "vintage" in d["legal"]  # restricted still counts as legal
    assert d["restricted"] == ["vintage"] and d["banned"] == ["legacy"]
    assert "modern" not in d["legal"]


def test_transform_card_keeps_per_face_values(docs):
    d = docs["Archangel Avacyn // Avacyn, the Purifier"]
    assert d["c_sets"] == ["R", "W"]  # one colour set per face, not their union
    assert d["id_sets"] == ["WR"]
    assert (d["pow_min"], d["pow_max"]) == (4.0, 6.0)
    assert d["stat_rel"] == ["pow<tou", "pow=tou", "pow>tou"]  # 4/4 and 6/5, compared across faces
    assert d["pt_num"] == 8.0  # front face only
    assert d["mana_cost"] == "{3}{W}{W}"
    assert "indestructible" in d["oracle_lc"] and "deals 3 damage" in d["oracle_lc"]
    assert d["names_lc"] == [
        "archangel avacyn",
        "archangel avacyn // avacyn, the purifier",
        "avacyn, the purifier",
    ]
    assert {"transform", "dfc", "commander", "historic", "permanent", "spell"} <= set(d["flags"])


def test_split_card_uses_card_level_colours(docs):
    d = docs["Fire // Ice"]
    assert d["c_sets"] == ["UR"]
    assert "split" in d["flags"] and "permanent" not in d["flags"]
    assert "fire" in d["names_lc"] and "ice" in d["names_lc"]


def test_reminder_text_is_removed_from_oracle_but_kept_in_full(docs):
    d = docs["Lim-Dûl's Vault"]
    assert "shuffle" not in d["oracle_lc"]
    assert "shuffle" in d["fulloracle_lc"]


def test_tilde_replaces_own_name_and_self_references(docs):
    assert docs["Boros Reckoner"]["oracle_tilde_lc"].startswith("whenever ~ is dealt damage")
    assert docs["Tarmogoyf"]["oracle_tilde_lc"].startswith("~'s power")
    back_face = docs["Archangel Avacyn // Avacyn, the Purifier"]["oracle_tilde_lc"]
    assert "when ~ transforms into ~, it deals 3 damage" in back_face  # "this creature" and its name


def test_flags(docs):
    assert "vanilla" in docs["Grizzly Bears"]["flags"] and "bear" in docs["Grizzly Bears"]["flags"]
    assert "bear" not in docs["Tarmogoyf"]["flags"]
    assert "hybrid" in docs["Boros Reckoner"]["flags"]
    assert "historic" in docs["Sol Ring"]["flags"]


def test_extras():
    base = {"layout": "normal", "set_type": "expansion", "set": "abc", "legalities": {"vintage": "legal"}}
    nowhere = {"legalities": {"vintage": "not_legal"}}
    assert not is_extra(base)
    assert is_extra({**base, "layout": "token"})
    assert is_extra({**base, "set_type": "memorabilia"})
    assert is_extra({**base, "type_line": "Token Enchantment — Aura Role"})
    assert not is_extra({**base, **nowhere, "set": "ust", "set_type": "funny"})  # Un-sets stay visible
    assert is_extra({**base, **nowhere, "promo_types": ["playtest"], "set": "cmb2"})
    assert not is_extra({**base, **nowhere, "promo_types": ["playtest"], "set": "und"})
    assert is_extra({**base, **nowhere, "digital": True})
    assert is_extra({**base, **nowhere, "set": "ph19"}) and is_extra({**base, **nowhere, "set": "hho"})
    assert not is_extra({**base, "digital": True})  # digital but legal somewhere, e.g. Alchemy


def test_hidden_extras_follow_what_scryfall_shows():
    def card(**kw):
        return {
            "layout": "normal",
            "set_type": "expansion",
            "set": "xyz",
            "legalities": {"vintage": "legal"},
            **kw,
        }

    nowhere = {"vintage": "not_legal", "commander": "not_legal"}
    assert not is_extra(card())
    assert is_extra(card(layout="token")) and is_extra(card(set_type="memorabilia"))
    # dungeons live in token sets, yet are shown
    assert not is_extra(card(set_type="token", type_line="Dungeon", legalities=nowhere))
    assert not is_extra(
        card(set_type="token", layout="double_faced_token", type_line="Dungeon — Undercity // Card")
    )
    assert is_extra(card(set_type="memorabilia", type_line="Dungeon"))
    # legal nowhere: Un-set cards in their own sets and brand-new cards are shown
    assert not is_extra(card(set="unh", set_type="funny", legalities=nowhere))
    assert not is_extra(card(set="unf", set_type="funny", promo_types=["playtest"], legalities=nowhere))
    assert not is_extra(card(set="slc", set_type="box", legalities=nowhere))
    # ... the rest is hidden
    assert is_extra(card(set="pal04", set_type="promo", legalities=nowhere))  # promo printing of an Un-card
    assert is_extra(card(set="sld", set_type="box", promo_types=["poster"], legalities=nowhere))
    assert is_extra(card(set="sld", set_type="box", type_line="Stickers", legalities=nowhere))
    assert is_extra(card(set="ulst", set_type="funny", legalities=nowhere))
    assert is_extra(card(set="cmb1", set_type="masters", promo_types=["playtest"], legalities=nowhere))
    assert is_extra(card(digital=True, legalities=nowhere))
    assert not is_extra(card(set="pal04", set_type="promo"))  # a legal card's promo is an ordinary printing
    # removed for offensive content; printed only in another video game
    assert is_extra(card(content_warning=True))
    assert is_extra(card(games=["sega"], digital=True)) and is_extra(card(games=["astral"]))
    assert not is_extra(card(games=["arena"], digital=True)) and not is_extra(card(games=[]))


def test_a_mana_cost_is_generic_plus_symbols_and_hybrids_have_one_spelling():
    assert parse_cost("{2}{W}{W}") == (2, ["W", "W"])
    assert parse_cost("{X}{X}{10}{R}") == (10, ["R", "X", "X"])
    assert parse_cost("{W/R}{R/W}{G/U/P}{2/W}") == (0, ["2/W", "G/P/U", "R/W", "R/W"])
    assert parse_cost("") == (0, [])


def test_cost_parts_are_split_halves_and_faces_with_a_cost(docs):
    assert cost_parts({"mana_cost": "{1}{R} // {1}{U}"}) == ["{1}{R}", "{1}{U}"]
    faces = [{"mana_cost": "{3}{W}{W}"}, {"mana_cost": ""}]
    assert cost_parts({"card_faces": faces}) == ["{3}{W}{W}"]  # a back face without a cost is not a part
    assert cost_parts({"mana_cost": ""}) == []


def test_mana_fields(docs):
    sphinx = docs["Consecrated Sphinx"]  # {4}{U}{U}
    assert (sphinx["m0_key"], sphinx["m0_gen"]) == ("4|U,U", 4)
    assert sphinx["m_syms"] == ["0:U:1", "0:U:2"]
    assert (sphinx["dev_U"], sphinx["dev_WU"], sphinx["dev_UR"]) == (2, 2, 2)
    assert "dev_W" not in sphinx and "m1_key" not in sphinx and "produces" not in sphinx
    reckoner = docs["Boros Reckoner"]  # three {R/W}
    assert reckoner["m_syms"] == ["0:R/W:1", "0:R/W:2", "0:R/W:3"] and reckoner["m0_gen"] == 0
    assert (reckoner["dev_R"], reckoner["dev_W"], reckoner["dev_WR"], reckoner["dev_WU"]) == (3, 3, 3, 3)
    assert "dev_U" not in reckoner and "dev_UB" not in reckoner
    fire = docs["Fire // Ice"]  # {1}{R} // {1}{U}, an instant
    assert (fire["m0_key"], fire["m1_key"]) == ("1|R", "1|U")
    assert fire["m_syms"] == ["0:R:1", "1:U:1"]
    assert not any(key.startswith("dev_") for key in fire)  # only permanents have devotion
    ring = docs["Sol Ring"]  # {1}
    assert (ring["m0_key"], ring["m0_gen"]) == ("1|", 1) and "m_syms" not in ring


def test_a_card_without_a_cost_and_what_a_card_produces():
    land = mana_fields({"mana_cost": "", "produced_mana": ["G", "W", "C"]})
    assert land == {"m0_key": "none", "produces": ["W", "G", "C"], "produces_n": 3}
    assert mana_fields({"mana_cost": "{0}"}) == {"m0_key": "0|", "m0_gen": 0}


def test_devotion_to_two_colours_counts_each_symbol_once():
    # {R}{R/W}{W}: two red, two white, and three symbols that are red or white
    scrollsmith = mana_fields({"mana_cost": "{R}{R/W}{W}", "type_line": "Creature — Dwarf Cleric"})
    assert (scrollsmith["dev_R"], scrollsmith["dev_W"], scrollsmith["dev_WR"]) == (2, 2, 3)


def test_french_vanilla_is_text_made_only_of_keywords(docs):
    assert _only_keywords("Flying, vigilance", ["Flying", "Vigilance"])
    assert _only_keywords("Protection from black\nCycling {2}", ["Cycling", "Protection"])
    assert _only_keywords("Flash\nFlying; trample", ["Flash", "Flying", "Trample"])
    assert not _only_keywords("", ["Flying"])  # no text at all is plain vanilla
    assert not _only_keywords("Flying\nWhen this creature dies, draw a card.", ["Flying"])
    assert not _only_keywords("Flying, vigilance", ["Flying"])  # vigilance is not among its keywords
    # a cost may follow a keyword, and a cost after a dash may contain commas
    assert _only_keywords(
        "Cascade\nHaste\nEscape—{3}{R}{G}, Exile three other cards from your graveyard.",
        ["Haste", "Escape", "Cascade"],
    )
    assert _only_keywords("Flying\nSlivercycling {3}", ["Flying", "Typecycling", "Cycling"])
    assert _only_keywords("Prototype {2}{R} — 3/2\nHaste", ["Prototype", "Haste"])
    # a number, other words, or an ability with its own text is not a bare keyword
    assert not _only_keywords("Bushido 1", ["Bushido"])
    assert not _only_keywords("Affinity for artifacts", ["Affinity"])
    assert not _only_keywords(
        "Trample\nPower-up — {5}{R}: Put a +1/+1 counter on it.", ["Trample", "Power-up"]
    )
    assert not _only_keywords("Suspend 3—{2}{G}", ["Suspend"])
    assert "frenchvanilla" not in docs["Consecrated Sphinx"]["flags"]
    assert docs["Consecrated Sphinx"]["layout"] == "normal" and docs["Fire // Ice"]["layout"] == "split"


def test_who_can_be_a_commander():
    from mtgsearch.documents import _flags

    def flags(type_line, text="", **kw):
        card = {
            "layout": "normal",
            "type_line": type_line,
            "oracle_text": text,
            "mana_cost": "{2}",
            "cmc": 2.0,
            **kw,
        }
        return _flags(card, type_line.lower(), text, text)

    assert "commander" in flags("Legendary Creature — Elf Druid", power="1", toughness="1")
    assert "commander" not in flags("Creature — Elf Druid", power="1", toughness="1")
    assert "commander" in flags("Legendary Enchantment — Background")
    assert "commander" in flags("Legendary Artifact — Vehicle", power="4", toughness="4")
    assert "commander" not in flags("Legendary Artifact — Spacecraft")  # no power and toughness box
    assert "commander" in flags("Legendary Planeswalker — Teferi", "Teferi can be your commander.")
    grist = "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types."
    assert "commander" in flags("Legendary Planeswalker — Grist", grist)
    assert "commander" not in flags("Legendary Planeswalker — Jace")


def test_stats_are_kept_as_printed_for_each_face_that_has_one():
    assert stats_text({"power": "*", "toughness": "1+*"}) == "*/1+*"
    assert stats_text({"loyalty": "4"}) == "Loyalty 4"
    assert stats_text({"defense": "5"}) == "Defense 5"
    assert stats_text({"oracle_text": "Draw a card."}) is None
    # a creature that transforms into a planeswalker; a creature with a land on the back
    faces = [{"power": "2", "toughness": "3"}, {"loyalty": "5"}]
    assert stats_text({"card_faces": faces}) == "2/3 // Loyalty 5"
    assert stats_text({"card_faces": [{"power": "3", "toughness": "2"}, {"type_line": "Land"}]}) == "3/2"
    # a Vehicle has a size too
    assert stats_text({"type_line": "Artifact — Vehicle", "power": "5", "toughness": "5"}) == "5/5"
