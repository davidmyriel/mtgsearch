import pytest

from mtgsearch.nl import extract
from mtgsearch.syntax import evaluate


def notes(query):
    return extract(query).notes


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("one mana artifact that taps for two colorless mana", ["mana value 1", "artifact"]),
        ("two mana sorcery that searches my library for any card", ["mana value 2", "sorcery"]),
        ("one mana elf that taps for one green mana", ["mana value 1", "elf"]),
        ("sphinx that draws two cards", ["sphinx"]),
        ("big green creature that gives all my creatures trample", ["green", "creature"]),
        ("a 3-drop blue instant", ["mana value 3", "blue", "instant"]),
        ("4 cmc white sorcery that destroys all creatures", ["mana value 4", "white", "sorcery"]),
        ("legendary elves that tap for mana", ["legendary", "elf"]),
        ("zero mana artifact that taps for mana", ["mana value 0", "artifact"]),
        ("destroy all creatures for four mana", ["mana value 4"]),
        ("enchantment that doubles the tokens I create", ["enchantment"]),
    ],
)
def test_reads_the_opening_noun_phrase(query, expected):
    assert notes(query) == expected


@pytest.mark.parametrize(
    "query",
    [
        "lets me play lands from my graveyard",  # "lands" is not at the start
        "whenever an opponent draws a card they pay two or I get a treasure",
        "stops opponents from casting spells during my turn",
        "exile a creature and its controller gains life equal to its power",
        "win the game when my library has no cards",
        "board wipe",  # "board" must not be read as the creature type Boar
        "mana rock",
        "red",  # a colour on its own is not a filter
        "artifact that taps for two mana",  # "for two mana" after "taps" is not a cost
        "protection from red",
        "spell that counters a spell",
        "token doubler",
    ],
)
def test_leaves_everything_else_alone(query):
    extracted = extract(query)
    assert all("mana value" not in n and n not in ("red", "land", "boar") for n in extracted.notes), (
        extracted.notes
    )


def test_predicate_filters_documents(docs):
    predicate = extract("one mana artifact that taps for two colorless mana").predicate
    assert [name for name, doc in docs.items() if evaluate(predicate, doc)] == ["Sol Ring"]
    predicate = extract("blue sphinx").predicate
    assert [name for name, doc in docs.items() if evaluate(predicate, doc)] == ["Consecrated Sphinx"]


def test_no_filters_means_match_everything():
    assert extract("something about drawing cards").predicate == ("all",)
    assert not extract("something about drawing cards").any
