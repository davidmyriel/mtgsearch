"""End-to-end checks against the live TopK collection.

Skipped unless selected with `pytest -m integration`, which needs TOPK_API_KEY and an ingested
collection (see README). These guard the contract the unit tests cannot: that the predicates
we generate mean the same thing to TopK as they do to the Python evaluator.
"""

import os

import pytest

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def col():
    if not os.environ.get("TOPK_API_KEY"):
        pytest.skip("TOPK_API_KEY is not set")
    from mtgsearch import config

    return config.collection()


def names(result):
    return [hit["name"] for hit in result.hits]


def test_syntax_query_returns_exactly_the_matching_cards(col):
    from mtgsearch.search import search

    result = search('c:u t:sphinx o:"draw two cards"', col=col)
    assert result.mode == "syntax"
    assert result.total == len(result.hits) >= 3
    assert "Consecrated Sphinx" in names(result)


def test_topk_agrees_with_the_python_evaluator(col):
    """Every document TopK returns for a predicate must satisfy it in Python, and counts must agree."""
    import json

    from mtgsearch import config
    from mtgsearch.conformance import topk_ids
    from mtgsearch.syntax import compile_query, evaluate

    snapshot = config.DATA_DIR / f"documents.{config.COLLECTION}.jsonl"
    if not snapshot.exists():
        pytest.skip("no local document snapshot; run `mtgsearch ingest` first")
    documents = [json.loads(line) for line in snapshot.open()]
    for query in [
        "c=1 t:angel pow>=5",
        "-kw:flying t:sphinx",
        "id<=esper o:/draws? two cards/",
        "pow>tou t:elf",
    ]:
        predicate, _ = compile_query(query)
        expected = {d["_id"] for d in documents if evaluate(predicate, d)}
        total, found = topk_ids(col, predicate)
        assert total == len(expected), query
        assert set(found) == expected, query


def test_plain_english_finds_the_card(col):
    from mtgsearch.search import search

    result = search("sphinx that draws two cards", col=col)
    assert result.mode == "semantic"
    assert names(result)[0] == "Consecrated Sphinx"


def test_card_name_takes_the_name_path(col):
    from mtgsearch.search import search

    result = search("lightning bolt", col=col)
    assert result.mode == "name"
    assert names(result)[0] == "Lightning Bolt"


def test_keywords_mixed_with_plain_words(col):
    from mtgsearch.search import search

    result = search("c:u t:sphinx draws when opponents draw", col=col)
    assert result.mode == "mixed"
    assert names(result)[0] == "Consecrated Sphinx"


def test_unsupported_keyword_is_reported(col):
    from mtgsearch.search import search

    result = search("r:mythic t:sphinx", col=col)
    assert result.mode == "unsupported" and "not supported" in result.note
