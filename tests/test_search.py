from mtgsearch.search import _split_words, is_plain_words
from mtgsearch.syntax import parse


def test_plain_words_include_or_and_negation():
    assert is_plain_words(parse("sphinx that draws two cards"))
    assert is_plain_words(parse("they pay two or I get a treasure"))  # "or" is still plain English
    assert is_plain_words(parse("lightning -bolt"))
    assert not is_plain_words(parse("t:sphinx draws cards"))
    assert not is_plain_words(parse("!fire"))
    assert not is_plain_words(parse("fire or t:elf"))


def test_split_keywords_from_words():
    keywords, words = _split_words(parse("c:u t:sphinx draws when opponents draw"))
    assert [k.key for k in keywords] == ["c", "t"]
    assert [w.text for w in words] == ["draws", "when", "opponents", "draw"]
    assert _split_words(parse("t:elf or t:goblin")) is None  # not a flat list of terms
