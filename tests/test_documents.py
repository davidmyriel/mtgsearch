from mtgsearch.documents import INFINITY, color_key, fold, is_extra, plain, stat, type_words


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
