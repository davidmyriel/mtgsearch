"""Fixtures shared with the TypeScript app must match what the ingest job produces.

The app's unit tests run queries against fixtures/documents.json (cards) and
fixtures/printings.json (printings), so they exercise the real document shapes. If the document builder changes, this fails until the fixture is regenerated
(see `write_fixtures` below), and the app's tests then run against the new documents.
"""

import json
from pathlib import Path

import pytest
from conftest import card_documents, printing_documents

from mtgsearch.documents import fold, plain

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
BUILDERS = {"documents.json": card_documents, "printings.json": printing_documents}


def write_fixtures() -> None:
    """Run with: python -c "import sys; sys.path.insert(0, 'tests'); import test_fixtures as t; t.write_fixtures()" """
    for name, build in BUILDERS.items():
        text = json.dumps(build(), indent=1, ensure_ascii=False) + "\n"
        (FIXTURES / name).write_text(text, encoding="utf-8")


@pytest.mark.parametrize("name", BUILDERS)
def test_document_fixture_is_current(name):
    committed = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    assert committed == BUILDERS[name](), f"regenerate fixtures/{name} (see write_fixtures)"


def test_normalisation_matches_the_shared_cases():
    for case in json.loads((FIXTURES / "normalize.json").read_text(encoding="utf-8")):
        assert fold(case["text"]) == case["fold"], case["text"]
        assert plain(case["text"]) == case["plain"], case["text"]


def test_type_word_catalogue_is_sorted_and_unique():
    words = json.loads((FIXTURES.parent / "app" / "type-words.json").read_text(encoding="utf-8"))
    assert words == sorted(set(words)) and "creature" in words and "legend" not in words
