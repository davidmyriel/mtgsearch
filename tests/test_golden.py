"""The fixture the TypeScript port is tested against must match what this code produces now."""

import json

from mtgsearch import catalog, golden


def test_golden_fixture_is_current():
    committed = golden.FIXTURE.read_text(encoding="utf-8")
    assert committed == golden.dumps(golden.build()), "stale fixture: run `mtgsearch golden` and commit it"


def test_function_bundles_the_same_type_words():
    bundled = json.loads((golden.ROOT / "netlify" / "lib" / "type-words.json").read_text(encoding="utf-8"))
    assert bundled == sorted(catalog.type_word_set()), "run `mtgsearch catalog` to regenerate both files"


def test_fixture_covers_every_outcome():
    data = golden.build()
    outcomes = {case.get("error", "ok") for case in data["syntax"]}
    assert outcomes == {"ok", "QueryError", "Unsupported"}
    assert any(case["predicate"] != ["all"] for case in data["nl"])
    assert any(case["predicate"] == ("all",) for case in data["nl"])
