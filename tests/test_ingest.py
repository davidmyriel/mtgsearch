from mtgsearch.ingest import content_hash, plan, text_hash

STORED = ("_id", "content_hash", "text_hash", "edhrec_rank", "usd")


def doc(**changes):
    base = {
        "_id": "a",
        "name": "A",
        "rules": "text",
        "rules_tagged": "text. tags",
        "edhrec_rank": 10,
        "usd": 1.5,
    }
    base.update(changes)
    out = {k: v for k, v in base.items() if v is not None}
    out["content_hash"] = content_hash(out)
    out["text_hash"] = text_hash(out)
    return out


def stored(*docs):
    """What the collection would report for these documents."""
    return {d["_id"]: {k: d[k] for k in STORED if k in d} for d in docs}


def fields(d, **overrides):
    """The field update that brings a stored card up to date: everything but the embedded text."""
    return {k: v for k, v in d.items() if k not in ("rules", "rules_tagged")} | overrides


def test_hashes_ignore_rank_price_and_key_order():
    assert content_hash(doc()) == content_hash(doc(edhrec_rank=99, usd=7.0))
    assert content_hash({"name": "A", "rules": "t"}) == content_hash({"rules": "t", "name": "A"})
    assert content_hash(doc()) != content_hash(doc(rules="new text"))
    assert content_hash(doc()) != content_hash(doc(name="B"))


def test_the_text_hash_covers_only_the_embedded_text():
    assert text_hash(doc()) == text_hash(doc(name="B", edhrec_rank=99, extra_field=["x"]))
    assert text_hash(doc()) != text_hash(doc(rules="new text"))
    assert text_hash(doc()) != text_hash(doc(rules_tagged="text. other tags"))


def test_an_empty_collection_gets_everything():
    docs = [doc()]
    assert plan(docs, {}) == (docs, [], [])


def test_unchanged_cards_are_skipped():
    assert plan([doc()], stored(doc())) == ([], [], [])


def test_rank_or_price_alone_is_a_small_field_update():
    assert plan([doc(edhrec_rank=11)], stored(doc())) == ([], [{"_id": "a", "edhrec_rank": 11}], [])
    assert plan([doc(edhrec_rank=12, usd=2.5)], stored(doc())) == (
        [],
        [{"_id": "a", "edhrec_rank": 12, "usd": 2.5}],
        [],
    )


def test_a_price_read_back_at_lower_precision_is_not_a_change():
    state = stored(doc())
    state["a"]["usd"] = 1.5000000596046448
    assert plan([doc()], state) == ([], [], [])


def test_a_card_gaining_a_rank_is_a_field_update():
    assert plan([doc()], stored(doc(edhrec_rank=None))) == ([], [{"_id": "a", "edhrec_rank": 10}], [])


def test_a_card_losing_a_rank_has_it_removed_by_a_null():
    assert plan([doc(edhrec_rank=None)], stored(doc())) == ([], [{"_id": "a", "edhrec_rank": None}], [])


def test_changed_text_resends_the_card():
    reworded = doc(rules="new text", edhrec_rank=11)
    assert plan([reworded], stored(doc())) == ([reworded], [], [])
    retagged = doc(rules_tagged="text. other tags")
    assert plan([retagged], stored(doc())) == ([retagged], [], [])


def test_a_change_outside_the_text_is_a_field_update_without_the_text():
    renamed = doc(name="B", edhrec_rank=11)
    assert plan([renamed], stored(doc())) == ([], [fields(renamed)], [])


def test_a_new_field_reaches_existing_cards_as_a_field_update():
    extended = doc(mana=["{u}", "{u}"])
    upserts, updates, removed = plan([extended], stored(doc()))
    assert (upserts, removed) == ([], [])
    assert updates == [fields(extended)]
    assert "rules" not in updates[0] and updates[0]["mana"] == ["{u}", "{u}"]


def test_a_field_one_card_lost_is_removed_by_a_null():
    # Another card still has the field, so the job knows to clear it on this one.
    was = doc(banned=["legacy"])
    now, other = doc(), doc(_id="b", name="B", banned=["modern"])
    upserts, updates, removed = plan([now, other], stored(was, other))
    assert (upserts, removed) == ([], [])
    assert updates == [fields(now, banned=None)]


def test_a_card_stored_without_hashes_is_updated_not_resent_when_its_text_is_unchanged():
    # stored_state derives the text hash from the stored text and marks the row.
    state = {"a": {"_id": "a", "text_hash": text_hash(doc()), "backfill": True}}
    assert plan([doc()], state) == ([], [fields(doc())], [])
    state["a"]["text_hash"] = text_hash(doc(rules="older text"))
    assert plan([doc()], state) == ([doc()], [], [])


def test_new_and_removed_cards():
    new = doc(_id="b", name="B")
    assert plan([new], stored(doc())) == ([new], [], ["a"])
