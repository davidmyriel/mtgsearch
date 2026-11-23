from mtgsearch.catalog import blocks


def s(code, block=None, parent=None, name=None):
    entry = {"code": code, "name": name or code.upper()}
    if block:
        entry |= {"block_code": block[0], "block": block[1]}
    if parent:
        entry["parent_set_code"] = parent
    return entry


ZEN = ("zen", "Zendikar")
SETS = [
    s("zen", ZEN),
    s("wwk", ZEN, name="Worldwake"),
    s("roe", ZEN),
    s("pwwk", ZEN, parent="wwk"),
    s("dom", name="Dominaria"),
    s("pdom", parent="dom"),
    s("tdom", parent="dom"),
    s("ptdom", parent="pdom"),
    s("orphan", parent="gone"),
]


def test_a_block_lists_its_sets_and_any_of_them_stands_for_it():
    found = blocks(SETS)
    assert found["blocks"] == {"zen": {"name": "Zendikar", "sets": ["pwwk", "roe", "wwk", "zen"]}}
    assert {found["sets"][code] for code in ("zen", "wwk", "roe", "pwwk")} == {"zen"}


def test_a_set_outside_every_block_stands_for_the_set_at_the_top_of_its_parents():
    found = blocks(SETS)
    assert [found["sets"][code] for code in ("dom", "pdom", "tdom", "ptdom")] == ["dom"] * 4
    assert "dom" not in found["blocks"]
    # a parent that Scryfall does not list ends the line
    assert found["sets"]["orphan"] == "orphan"


def test_a_child_set_takes_its_parents_block():
    found = blocks([s("grn", ("grn", "Guilds of Ravnica")), s("tgrn", parent="grn")])
    assert found["sets"]["tgrn"] == "grn" and found["blocks"]["grn"]["sets"] == ["grn"]


def test_every_set_is_known_by_its_name_folded():
    found = blocks(SETS)
    assert (found["names"]["worldwake"], found["names"]["dominaria"]) == ("wwk", "dom")
    # two sets of one name: the first by code keeps it
    twice = blocks([s("b", name="Urza's Saga"), s("a", name="URZA'S SAGA")])
    assert twice["names"] == {"urza's saga": "a"}
