import pytest

from mtgsearch.syntax import QueryError, Unsupported, compile_query, evaluate, parse
from mtgsearch.syntax.parser import And, Keyword, Name, Not, Or

AVACYN = "Archangel Avacyn // Avacyn, the Purifier"


def matches(docs, query):
    predicate, _ = compile_query(query)
    return sorted(name for name, doc in docs.items() if evaluate(predicate, doc))


# --- parser -----------------------------------------------------------------------------------


def test_parse_keyword_and_bare_words():
    assert parse("t:elf bolt") == And((Keyword("t", ":", "elf"), Name("bolt")))


def test_parse_quotes_regex_and_exact():
    assert parse('o:"draw two cards"') == Keyword("o", ":", "draw two cards")
    assert parse(r"name:/\bizzet\b/") == Keyword("name", ":", r"\bizzet\b", regex=True)
    assert parse(r"o:/a\/b/") == Keyword("o", ":", "a/b", regex=True)
    assert parse('!"sift through sands"') == Name("sift through sands", exact=True)
    assert parse("!fire") == Name("fire", exact=True)


def test_parse_negation_or_and_nesting():
    assert parse("-t:creature") == Not(Keyword("t", ":", "creature"))
    assert parse("t:fish or t:bird") == Or((Keyword("t", ":", "fish"), Keyword("t", ":", "bird")))
    assert parse("t:legendary (t:goblin OR t:elf)") == And(
        (Keyword("t", ":", "legendary"), Or((Keyword("t", ":", "goblin"), Keyword("t", ":", "elf"))))
    )


def test_or_binds_looser_than_adjacency():
    assert parse("a b or c") == Or((And((Name("a"), Name("b"))), Name("c")))


def test_parse_comparison_operators():
    assert parse("pow>=8") == Keyword("pow", ">=", "8")
    assert parse("c!=uw") == Keyword("c", "!=", "uw")
    assert parse("pow>tou") == Keyword("pow", ">", "tou")


def test_hyphen_inside_a_word_is_not_negation():
    assert parse("lim-dul") == Name("lim-dul")


@pytest.mark.parametrize(
    "bad",
    ['o:"unterminated', "o:/unterminated", "(t:elf", "t:elf )", "t:", "bogus:value", "t:elf -", "c:purple"],
)
def test_parse_errors(bad):
    with pytest.raises(QueryError):
        compile_query(bad)


@pytest.mark.parametrize(
    "query",
    [
        "r:mythic",
        "s:2x2",
        "a:zug",
        "m:2WW",
        "is:fetchland",
        "unique:prints",
        "order:usd",
        "pow>loy",
        r"o:/\spp/",
        "is:digital",
    ],
)
def test_unsupported_keywords_are_reported_not_ignored(query):
    with pytest.raises(Unsupported):
        compile_query(query)


# --- semantics, checked with the Python evaluator ---------------------------------------------


def test_bare_words_match_the_name(docs):
    assert matches(docs, "sphinx") == ["Consecrated Sphinx"]
    assert matches(docs, "limduls") == ["Lim-Dûl's Vault"]  # punctuation and diacritics are forgiven
    assert matches(docs, "lim-dul's") == ["Lim-Dûl's Vault"]
    assert matches(docs, "SOL ring") == ["Sol Ring"]
    assert matches(docs, "onsecrated") == ["Consecrated Sphinx"]  # substring, not just a prefix


def test_exact_name_matches_a_face(docs):
    assert matches(docs, "!fire") == ["Fire // Ice"]
    assert matches(docs, '!"sol ring"') == ["Sol Ring"]
    assert matches(docs, "!sol") == []


def test_type_matches_whole_words_for_known_types_and_substrings_otherwise(docs):
    assert compile_query("t:fish include:extras")[0] == ("in", "type_words", "fish")  # not Jellyfish
    assert compile_query("t:jelly include:extras")[0] == ("has", "type_lc", "jelly")
    assert matches(docs, "t:sphinx") == ["Consecrated Sphinx"]
    assert matches(docs, "t:leg") == [AVACYN, "Jace, the Mind Sculptor"]
    assert matches(docs, 't:"creature — sphinx"') == ["Consecrated Sphinx"]


def test_oracle_text(docs):
    assert matches(docs, 'o:"draw two cards"') == ["Consecrated Sphinx"]
    assert matches(docs, 'o:"~ is dealt damage"') == ["Boros Reckoner"]
    assert matches(docs, 'o:"~ transforms"') == [AVACYN]  # "this creature transforms"
    assert matches(docs, "o:shuffle") == [] and matches(docs, "fo:shuffle") == ["Lim-Dûl's Vault"]
    assert matches(docs, "kw:flash") == [AVACYN]


def test_colour_comparisons(docs):
    assert matches(docs, "c:u") == [
        "Consecrated Sphinx",
        "Fire // Ice",
        "Jace, the Mind Sculptor",
        "Lim-Dûl's Vault",
    ]
    assert matches(docs, "c=u") == ["Consecrated Sphinx", "Jace, the Mind Sculptor"]
    assert matches(docs, "c:dimir") == ["Lim-Dûl's Vault"]
    assert matches(docs, "c:blue c:black") == ["Lim-Dûl's Vault"]
    assert matches(docs, "c:colorless") == ["Sol Ring"]
    assert matches(docs, "c=2 t:creature") == ["Boros Reckoner"]
    assert matches(docs, "c!=u t:planeswalker") == []
    assert matches(docs, "c<g") == ["Sol Ring"]


def test_colours_match_per_face_on_double_faced_cards(docs):
    # Front face is white, back face is red: either face can satisfy a condition,
    # but the card is not "white and red".
    assert AVACYN in matches(docs, "c:w") and AVACYN in matches(docs, "c:r")
    assert AVACYN in matches(docs, "c=w") and AVACYN in matches(docs, "c=1")
    assert AVACYN not in matches(docs, "c=rw") and AVACYN not in matches(docs, "c:m")
    assert AVACYN in matches(docs, "c<=izzet c>=1")
    assert matches(docs, "c:m") == ["Boros Reckoner", "Fire // Ice", "Lim-Dûl's Vault"]


def test_identity_defaults_to_subset(docs):
    assert matches(docs, "id:boros") == [AVACYN, "Boros Reckoner", "Sol Ring"]
    assert matches(docs, "id:c") == ["Sol Ring"]
    assert matches(docs, "id=rw") == [AVACYN, "Boros Reckoner"]


def test_numbers(docs):
    assert matches(docs, "mv=1") == ["Llanowar Elves", "Sol Ring"]
    assert matches(docs, "mv:odd t:creature") == [AVACYN, "Boros Reckoner", "Llanowar Elves"]
    assert matches(docs, "pow>=4") == [AVACYN, "Consecrated Sphinx"]
    assert matches(docs, "tou>pow") == [AVACYN, "Consecrated Sphinx", "Tarmogoyf"]  # 5 toughness vs 4 power
    assert matches(docs, "loy=3") == ["Jace, the Mind Sculptor"]
    assert matches(docs, "pt=10") == ["Consecrated Sphinx"]
    assert matches(docs, "edhrec<10") == ["Sol Ring"]


def test_stats_match_on_any_face(docs):
    assert matches(docs, "pow=6") == [AVACYN]  # back face
    assert AVACYN in matches(docs, "pow=4")  # front face
    assert matches(docs, "pow>tou") == [AVACYN]  # 6/5 back face
    assert AVACYN in matches(docs, "pow<=4") and AVACYN in matches(docs, "pow>=6")


def test_negation_keeps_cards_that_lack_the_field(docs):
    assert "Sol Ring" in matches(docs, "-pow>=4")
    assert "Sol Ring" in matches(docs, "-kw:flying")
    assert "Consecrated Sphinx" not in matches(docs, "-kw:flying")


def test_legality_flags_and_tags(docs):
    assert "Sol Ring" not in matches(docs, "f:modern")
    assert matches(docs, "banned:legacy") == ["Sol Ring"] and matches(docs, "restricted:vintage") == [
        "Sol Ring"
    ]
    assert matches(docs, "f:edh t:artifact") == ["Sol Ring"]
    assert matches(docs, "is:vanilla") == ["Grizzly Bears"]
    assert matches(docs, "not:permanent") == ["Fire // Ice", "Lim-Dûl's Vault"]
    assert matches(docs, "is:tdfc") == [AVACYN]
    assert matches(docs, "otag:ramp") == ["Sol Ring"] and matches(docs, 'function:"mana rock"') == [
        "Sol Ring"
    ]


def test_regex(docs):
    assert matches(docs, "o:/^{T}: add/") == ["Llanowar Elves", "Sol Ring"]
    assert matches(docs, r"name:/\bring\b/") == ["Sol Ring"]
    assert matches(docs, r"t:/elf\b/") == ["Llanowar Elves"]


def test_or_and_nesting(docs):
    assert matches(docs, "t:elf or t:bear") == ["Grizzly Bears", "Llanowar Elves"]
    assert matches(docs, "c:g (t:elf or t:lhurgoyf) -mv=1") == ["Tarmogoyf"]


def test_extras_are_hidden_unless_revealed(docs):
    assert "Goblin" not in matches(docs, "t:goblin")
    assert "Goblin" in matches(docs, "t:goblin include:extras")
    assert "Goblin" in matches(docs, "t:token")
    assert "Goblin" not in matches(docs, "t:planeswalker or c:r")  # "plane" in "planeswalker" must not reveal
    assert "Goblin" in matches(docs, "name:/^goblin$/")  # a name regex searches extras too
    assert compile_query("is:funny")[0] == ("in", "flags", "funny")  # is:funny reveals extras
    assert compile_query("not:funny")[0] == (
        "and",
        [("not", ("in", "flags", "funny")), ("eq", "extra", False)],
    )


def test_display_options():
    _, options = compile_query("t:elf order:cmc direction:desc")
    assert options.order == "cmc" and options.descending is True
    predicate, _ = compile_query("unique:cards display:grid include:extras")
    assert predicate == ("all",)
