"""Fixtures shared with the TypeScript app must match what the ingest job produces.

The app's unit tests run queries against fixtures/documents.json, so they exercise the real
document shape. If the document builder changes, this fails until the fixture is regenerated
(see `write_fixtures` below), and the app's tests then run against the new documents.
"""

import json
from pathlib import Path

from conftest import CARDS, TAGS

from mtgsearch.documents import build_document, fold, plain

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def documents() -> list[dict]:
    return [build_document(card, TAGS.get(card["oracle_id"])) for card in CARDS]


def write_fixtures() -> None:
    """Run with: python -c "import sys; sys.path.insert(0, 'tests'); import test_fixtures as t; t.write_fixtures()" """
    text = json.dumps(documents(), indent=1, ensure_ascii=False) + "\n"
    (FIXTURES / "documents.json").write_text(text, encoding="utf-8")


def test_document_fixture_is_current():
    committed = json.loads((FIXTURES / "documents.json").read_text(encoding="utf-8"))
    assert committed == documents(), "regenerate fixtures/documents.json (see write_fixtures)"


def test_normalisation_matches_the_shared_cases():
    for case in json.loads((FIXTURES / "normalize.json").read_text(encoding="utf-8")):
        assert fold(case["text"]) == case["fold"], case["text"]
        assert plain(case["text"]) == case["plain"], case["text"]


def test_type_word_catalogue_is_sorted_and_unique():
    words = json.loads((FIXTURES.parent / "app" / "type-words.json").read_text(encoding="utf-8"))
    assert words == sorted(set(words)) and "creature" in words and "legend" not in words
