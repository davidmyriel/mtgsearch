"""Ingest: Scryfall bulk files -> documents -> versioned TopK collections.

Two collections are maintained: one document per Oracle card (embedded, for plain-English
search and card-level syntax) and one per printing (filter fields only, for set, rarity,
artist, price and the other printing-level syntax).

Collections are never deleted and recreated under the same name (writes to a same-name
recreate can be lost for about a minute). To re-index with a new schema, bump the collection
name to the next version and point the app at it once it is verified.
"""

import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import config, scryfall
from .documents import build_document
from .printings import aggregates, build_printing, oracle_id, preference_ranks
from .tags import card_tags

BATCH = 250
HASHES = ("content_hash", "text_hash")
ID_PREFIXES = "0123456789abcdef"  # document ids are UUIDs
BUCKET_LIMIT = 5000


def cards_schema() -> dict:
    from topk_sdk.schema import bool as bool_
    from topk_sdk.schema import float as float_
    from topk_sdk.schema import image, keyword_index, semantic_index, text
    from topk_sdk.schema import int as int_
    from topk_sdk.schema import list as list_

    fields = {
        "name": text().required().index(keyword_index()),
        "rules": text().required().index(semantic_index()),
        "rules_tagged": text().required().index(semantic_index()),
        "art": image().index(semantic_index()),
        "name_lc": text().required(),
        "name_plain": text().required(),
        "names_lc": list_("text"),
        "type_lc": text().required(),
        "type_words": list_("text"),
        "oracle_lc": text().required(),
        "oracle_tilde_lc": text().required(),
        "fulloracle_lc": text().required(),
        "keywords_lc": list_("text"),
        "cmc": float_().required(),
        "cmc_even": bool_().required(),
        "c_sets": list_("text"),
        "id_sets": list_("text"),
        "stat_rel": list_("text"),
        "pt_num": float_(),
        "legal": list_("text"),
        "banned": list_("text"),
        "restricted": list_("text"),
        "flags": list_("text"),
        "otags": list_("text"),
        "extra": bool_().required(),
        "edhrec_rank": int_(),
        "usd": float_(),
    }
    for stat in ("pow", "tou", "loy"):
        fields[f"{stat}_min"] = float_()
        fields[f"{stat}_max"] = float_()
    return fields


def printings_schema() -> dict:
    """Filter fields only: nothing in the printings collection is embedded or keyword-indexed."""
    from topk_sdk.schema import bool as bool_
    from topk_sdk.schema import float as float_
    from topk_sdk.schema import int as int_
    from topk_sdk.schema import list as list_
    from topk_sdk.schema import text

    fields = {
        name: spec
        for name, spec in cards_schema().items()
        if name not in ("name", "rules", "rules_tagged", "art", "usd")
    }
    fields |= {
        "name": text().required(),
        "oracle_id": text().required(),
        "set": text().required(),
        "set_type": text().required(),
        "cn": text().required(),
        "cn_num": float_(),
        "rarity": text().required(),
        "rarity_rank": int_().required(),
        "artist_lc": text(),
        "flavor_lc": text(),
        "watermarks": list_("text"),
        "frame": text().required(),
        "frame_effects": list_("text"),
        "border": text().required(),
        "games": list_("text"),
        "lang": text().required(),
        "date": int_().required(),
        "year": int_().required(),
        "usd_c": int_(),
        "eur_c": int_(),
        "tix_c": int_(),
        "pflags": list_("text"),
        "in_sets": list_("text"),
        "in_rarities": list_("text"),
        "in_games": list_("text"),
        "prints": int_(),
        "sets": int_(),
        "art": text().required(),
        "pref_rank": int_().required(),
        "extra": bool_().required(),
    }
    return fields


@dataclass(frozen=True)
class Target:
    """One collection the job keeps up to date."""

    label: str
    collection: str
    schema: Callable[[], dict]
    # Fields TopK embeds. Writing them costs an inference call per document, so they are only
    # re-sent when their text changes; every other field can be written with a field update.
    embedded: tuple[str, ...]
    # Fields that move daily for most documents.
    volatile: tuple[str, ...]


CARDS = Target("cards", config.COLLECTION, cards_schema, ("rules", "rules_tagged"), ("edhrec_rank", "usd"))
PRINTINGS = Target(
    "printings", config.PRINTINGS_COLLECTION, printings_schema, (), ("edhrec_rank", "usd_c", "eur_c", "tix_c")
)
TARGETS = {t.label: t for t in (CARDS, PRINTINGS)}


def _digest(value) -> str:
    text = json.dumps(value, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:20]


def content_hash(doc: dict, target: Target = CARDS) -> str:
    """Fingerprint of everything in a document except the volatile fields."""
    return _digest({k: v for k, v in doc.items() if k not in target.volatile and k not in HASHES})


def text_hash(doc: dict, target: Target = CARDS) -> str:
    """Fingerprint of the embedded text alone."""
    return _digest([doc.get(k) for k in target.embedded])


def _hashed(docs: list[dict], target: Target) -> list[dict]:
    for doc in docs:
        doc["content_hash"] = content_hash(doc, target)
        doc["text_hash"] = text_hash(doc, target)
    return docs


def build_documents(data_dir: Path, labels=tuple(TARGETS)) -> dict[str, list[dict]]:
    """Download the bulk files if needed and build the documents for each collection."""
    cards_path = scryfall.download_bulk("oracle_cards", data_dir)
    tags_path = scryfall.download_bulk("oracle_tags", data_dir)
    printings_path = scryfall.download_bulk("default_cards", data_dir)
    tags = card_tags(scryfall.read_jsonl_gz(tags_path))
    # The printings file is large; it is read as a stream each time rather than held in memory.
    totals = aggregates(scryfall.read_jsonl_gz(printings_path))

    built = {}
    cards = list(scryfall.read_jsonl_gz(cards_path))
    if CARDS.label in labels:
        docs = [build_document(c, tags.get(c["oracle_id"]), totals.get(c["oracle_id"])) for c in cards]
        built[CARDS.label] = _hashed(docs, CARDS)
    if PRINTINGS.label in labels:
        ranks = preference_ranks(scryfall.read_jsonl_gz(printings_path), {c["id"] for c in cards})
        docs = [
            build_printing(p, tags.get(oracle_id(p)), totals[oracle_id(p)], ranks[p["id"]])
            for p in scryfall.read_jsonl_gz(printings_path)
        ]
        built[PRINTINGS.label] = _hashed(docs, PRINTINGS)
    return built


def stored_state(col, target: Target = CARDS) -> dict[str, dict]:
    """What the collection holds now: id -> its hashes and volatile fields.

    The collection itself is the record of what has been ingested, so a run needs no local
    snapshot and behaves the same from any machine. Read in buckets by id prefix; a bucket
    that comes back full is split into sixteen narrower ones.
    """
    from topk_sdk.query import field, select

    state: dict[str, dict] = {}

    def read(prefix: str, fields: tuple[str, ...], only_unhashed: bool = False) -> list[dict]:
        query = select(*fields).filter(field("_id").starts_with(prefix))
        if only_unhashed:
            query = query.filter(field("text_hash").is_null())
        rows = col.query(query.limit(BUCKET_LIMIT))
        if len(rows) < BUCKET_LIMIT:
            return rows
        return [row for digit in ID_PREFIXES for row in read(prefix + digit, fields, only_unhashed)]

    for prefix in ID_PREFIXES:
        state.update({row["_id"]: row for row in read(prefix, (*HASHES, *target.volatile))})
    if len(state) != col.count():
        raise SystemExit("could not read every document's state by id prefix; refusing to guess what changed")

    # Documents written without a text hash (before it existed, or by an older version of this
    # job): derive it from the stored text, so they are not re-embedded just to record it.
    if any(row.get("text_hash") is None for row in state.values()):
        for prefix in (a + b for a in ID_PREFIXES for b in ID_PREFIXES):
            for row in read(prefix, target.embedded or ("_id",), only_unhashed=True):
                state[row["_id"]].update(text_hash=text_hash(row, target), backfill=True)
    return state


def _same(new, old) -> bool:
    """Equality that tolerates a price read back at lower float precision than it was written."""
    if isinstance(new, float) and isinstance(old, int | float):
        return abs(new - old) < 0.005
    return new == old


def plan(
    docs: list[dict], state: dict[str, dict], target: Target = CARDS
) -> tuple[list[dict], list[dict], list[str]]:
    """Decide what to write. Returns (documents to send in full, field updates, ids to delete).

    A field update merges into the stored document and a null removes a field, so an update
    of every field except the embedded text brings a document fully up to date without
    embedding it again.
    """
    fields = sorted(set().union(*docs) - set(target.embedded))
    upserts, updates = [], []
    for doc in docs:
        old = state.get(doc["_id"])
        if old is None or old.get("text_hash") != doc["text_hash"]:
            upserts.append(doc)  # new, or its embedded text changed
        elif old.get("content_hash") != doc["content_hash"] or old.get("backfill"):
            updates.append({k: doc.get(k) for k in fields})
        else:
            moved = {k: doc.get(k) for k in target.volatile if not _same(doc.get(k), old.get(k))}
            if moved:
                updates.append({"_id": doc["_id"], **moved})
    removed = sorted(set(state) - {d["_id"] for d in docs})
    return upserts, updates, removed


def _write(col, method: str, docs: list[dict], what: str, log=print) -> None:
    t0 = time.time()
    for i in range(0, len(docs), BATCH):
        batch = docs[i : i + BATCH]
        if method == "upsert":
            col.upsert(batch)
        else:
            col.update(batch, False)  # False: do not fail on an id that is missing
        if (i // BATCH) % 40 == 0 or i + BATCH >= len(docs):
            log(f"  {min(i + BATCH, len(docs))}/{len(docs)} {what}, {time.time() - t0:.0f}s")


def sync(target: Target, docs: list[dict], dry_run: bool = False, full: bool = False, log=print) -> None:
    """Bring one collection up to date with `docs`."""
    from topk_sdk.error import CollectionAlreadyExistsError

    client = config.client()
    exists = any(c.name == target.collection for c in client.collections().list())
    col = client.collection(target.collection)
    state = {} if full or not exists else stored_state(col, target)
    upserts, updates, removed = plan(docs, state, target)
    log(
        f"{target.label} ({target.collection}): {len(docs)} documents, {len(upserts)} to send in full, "
        f"{len(updates)} field updates, {len(removed)} to delete"
    )
    if dry_run:
        return
    if not exists:
        try:
            client.collections().create(target.collection, schema=target.schema())
            log(f"  created collection {target.collection}")
        except CollectionAlreadyExistsError:
            pass
    if upserts:
        _write(col, "upsert", upserts, "documents sent in full", log)
    if updates:
        _write(col, "update", updates, "field updates", log)
    for i in range(0, len(removed), BATCH):
        col.delete(removed[i : i + BATCH])
    # A strongly consistent count, so it includes the writes above.
    count = col.count(consistency="strong")
    if count != len(docs):
        raise SystemExit(f"{target.collection} has {count} documents, expected {len(docs)}")


def run(
    data_dir: Path = config.DATA_DIR, dry_run: bool = False, full: bool = False, only: str | None = None
) -> None:
    """Refresh the collections from today's bulk files.

    Unless `full` is set, each collection is compared with what it already holds. Only
    documents that are new or whose embedded text changed are sent in full; any other change,
    including a field this job has only just started to produce, is a field update. A daily
    run therefore embeds a few dozen cards rather than the whole set.
    """
    labels = (only,) if only else tuple(TARGETS)
    built = build_documents(data_dir, labels)
    for label in labels:
        sync(TARGETS[label], built[label], dry_run=dry_run, full=full)
