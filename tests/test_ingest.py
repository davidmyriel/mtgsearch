from mtgsearch.ingest import content_hash, plan


def doc(**changes):
    base = {"_id": "a", "name": "A", "rules": "text", "edhrec_rank": 10, "usd": 1.5}
    base.update(changes)
    out = {k: v for k, v in base.items() if v is not None}
    out["content_hash"] = content_hash(out)
    return out


def stored(*docs):
    """What the collection would report for these documents."""
    return {
        d["_id"]: {k: d[k] for k in ("_id", "content_hash", "edhrec_rank", "usd") if k in d} for d in docs
    }


def test_hash_ignores_rank_price_and_key_order():
    assert content_hash(doc()) == content_hash(doc(edhrec_rank=99, usd=7.0))
    assert content_hash({"name": "A", "rules": "t"}) == content_hash({"rules": "t", "name": "A"})
    assert content_hash(doc()) != content_hash(doc(rules="new text"))


def test_an_empty_collection_gets_everything():
    docs = [doc()]
    assert plan(docs, {}) == (docs, [], [])


def test_unchanged_cards_are_skipped():
    assert plan([doc()], stored(doc())) == ([], [], [])


def test_rank_or_price_alone_is_a_field_update_not_a_resend():
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


def test_a_card_losing_a_rank_is_resent_because_an_update_cannot_remove_a_field():
    unranked = doc(edhrec_rank=None)
    assert plan([unranked], stored(doc())) == ([unranked], [], [])


def test_any_other_change_resends_the_card():
    reworded = doc(rules="new text", edhrec_rank=11)
    assert plan([reworded], stored(doc())) == ([reworded], [], [])


def test_a_card_stored_before_hashes_existed_is_resent():
    state = stored(doc())
    del state["a"]["content_hash"]
    assert plan([doc()], state) == ([doc()], [], [])


def test_new_and_removed_cards():
    new = doc(_id="b", name="B")
    assert plan([new], stored(doc())) == ([new], [], ["a"])
