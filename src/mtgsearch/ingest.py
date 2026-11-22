"""Ingest: Scryfall bulk files -> documents -> a versioned TopK collection.

Collections are never deleted and recreated under the same name (writes to a same-name
recreate can be lost for about a minute). To re-index with a new schema, bump
MTGSEARCH_COLLECTION to the next version and point the app at it once it is verified.
"""

import hashlib
import json
import time
from collections.abc import Iterable
from pathlib import Path

from . import config, scryfall
from .documents import build_document
from .tags import card_tags

BATCH = 250


def schema() -> dict:
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


def build_documents(data_dir: Path) -> list[dict]:
    """Download the bulk files if needed and build one document per Oracle card."""
    cards_path = scryfall.download_bulk("oracle_cards", data_dir)
    tags_path = scryfall.download_bulk("oracle_tags", data_dir)
    tags = card_tags(scryfall.read_jsonl_gz(tags_path))
    docs = [build_document(c, tags.get(c["oracle_id"])) for c in scryfall.read_jsonl_gz(cards_path)]
    for doc in docs:
        doc["content_hash"] = content_hash(doc)
    return docs


def upsert(docs: Iterable[dict], log=print, expected: int | None = None) -> str | None:
    from topk_sdk.error import CollectionAlreadyExistsError

    client = config.client()
    try:
        client.collections().create(config.COLLECTION, schema=schema())
        log(f"created collection {config.COLLECTION}")
    except CollectionAlreadyExistsError:
        log(f"collection {config.COLLECTION} exists; upserting into it")
    col, docs, lsn, t0 = client.collection(config.COLLECTION), list(docs), None, time.time()
    for i in range(0, len(docs), BATCH):
        lsn = col.upsert(docs[i : i + BATCH])
        if (i // BATCH) % 20 == 0 or i + BATCH >= len(docs):
            log(f"  {min(i + BATCH, len(docs))}/{len(docs)} documents, {time.time() - t0:.0f}s")
    count = col.count(lsn=lsn)
    log(f"collection count {count}")
    if count < (expected or len(docs)):
        raise SystemExit(f"expected at least {expected or len(docs)} documents, collection has {count}")
    return lsn


# Fields that move daily for most cards and are never part of the embedded text. A card whose
# only change is in these gets a small field update instead of being re-sent and re-embedded.
VOLATILE = ("edhrec_rank", "usd")
UPDATE_BATCH = 1000
ID_PREFIXES = "0123456789abcdef"  # document ids are UUIDs
BUCKET_LIMIT = 5000


def content_hash(doc: dict) -> str:
    """Fingerprint of everything in a document except the volatile fields."""
    stable = {k: v for k, v in doc.items() if k not in VOLATILE and k != "content_hash"}
    text = json.dumps(stable, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:20]


def stored_state(col) -> dict[str, dict]:
    """What the collection holds now: id -> its content hash and volatile fields.

    The collection itself is the record of what has been ingested, so a run needs no local
    snapshot and behaves the same from any machine. Read in one query per id prefix.
    """
    from topk_sdk.query import field, select

    state: dict[str, dict] = {}
    for prefix in ID_PREFIXES:
        rows = col.query(
            select("content_hash", *VOLATILE).filter(field("_id").starts_with(prefix)).limit(BUCKET_LIMIT)
        )
        if len(rows) >= BUCKET_LIMIT:
            raise SystemExit(
                f"id prefix {prefix!r} holds {BUCKET_LIMIT} or more documents; read it in smaller buckets"
            )
        state.update({row["_id"]: row for row in rows})
    if len(state) != col.count():
        raise SystemExit("could not read every document's state by id prefix; refusing to guess what changed")
    return state


def _same(new, old) -> bool:
    """Equality that tolerates a price read back at lower float precision than it was written."""
    if isinstance(new, float) and isinstance(old, int | float):
        return abs(new - old) < 0.005
    return new == old


def plan(docs: list[dict], state: dict[str, dict]) -> tuple[list[dict], list[dict], list[str]]:
    """Decide what to write. Returns (documents to send in full, field updates, ids to delete)."""
    upserts, updates = [], []
    for doc in docs:
        old = state.get(doc["_id"])
        if old is None or old.get("content_hash") != doc["content_hash"]:
            upserts.append(doc)  # new, changed, or stored before hashes existed
        elif any(old.get(k) is not None and k not in doc for k in VOLATILE):
            upserts.append(doc)  # an update merges fields, so it cannot remove a rank or price
        else:
            moved = {k: doc[k] for k in VOLATILE if k in doc and not _same(doc[k], old.get(k))}
            if moved:
                updates.append({"_id": doc["_id"], **moved})
    removed = sorted(set(state) - {d["_id"] for d in docs})
    return upserts, updates, removed


def update_fields(updates: list[dict], log=print) -> None:
    col, t0 = config.collection(), time.time()
    for i in range(0, len(updates), UPDATE_BATCH):
        col.update(updates[i : i + UPDATE_BATCH], False)  # False: do not fail on a missing id
    log(f"  {len(updates)} rank or price updates, {time.time() - t0:.0f}s")


def run(data_dir: Path = config.DATA_DIR, dry_run: bool = False, full: bool = False) -> None:
    """Refresh the collection from today's bulk files.

    Unless `full` is set, the run compares against what the collection already holds: only new
    or changed cards are re-sent, and cards whose rank or price moved get a field update. A
    daily run therefore re-embeds a few dozen cards rather than the whole set.
    """
    docs = build_documents(data_dir)
    exists = any(c.name == config.COLLECTION for c in config.client().collections().list())
    state = {} if full or not exists else stored_state(config.collection())
    upserts, updates, removed = plan(docs, state)
    print(
        f"built {len(docs)} documents: {len(upserts)} to send in full, "
        f"{len(updates)} rank or price updates, {len(removed)} to delete"
    )
    if dry_run:
        return
    if upserts:
        upsert(upserts, expected=len(upserts) if not state else None)
    if updates:
        update_fields(updates)
    if removed:
        config.collection().delete(removed)
    count = config.collection().count()
    if count != len(docs) and not full:
        raise SystemExit(f"collection has {count} documents, expected {len(docs)}")
