"""Ingest: Scryfall bulk files -> documents -> a versioned TopK collection.

Collections are never deleted and recreated under the same name (writes to a same-name
recreate can be lost for about a minute). To re-index with a new schema, bump
MTGSEARCH_COLLECTION to the next version and point the app at it once it is verified.
"""

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
    return [build_document(c, tags.get(c["oracle_id"])) for c in scryfall.read_jsonl_gz(cards_path)]


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


def changed(docs: list[dict], snapshot: Path) -> tuple[list[dict], list[str]]:
    """Compare with the last ingested snapshot. Returns (new or changed documents, removed ids)."""
    if not snapshot.exists():
        return docs, []
    previous = {d["_id"]: d for d in map(json.loads, snapshot.open())}
    current = {d["_id"] for d in docs}
    return [d for d in docs if previous.get(d["_id"]) != d], sorted(set(previous) - current)


def run(data_dir: Path = config.DATA_DIR, dry_run: bool = False, full: bool = False) -> None:
    """Refresh the collection. Only new or changed cards are re-sent unless `full` is set,
    so a daily run re-embeds a handful of cards rather than the whole set."""
    docs = build_documents(data_dir)
    snapshot = data_dir / f"documents.{config.COLLECTION}.jsonl"
    todo, removed = (docs, []) if full else changed(docs, snapshot)
    print(f"built {len(docs)} documents: {len(todo)} to upsert, {len(removed)} to delete")
    if dry_run:
        return
    if todo:
        upsert(todo, expected=len(docs) if not removed else None)
    if removed:
        config.collection().delete(removed)
    snapshot.write_text("".join(json.dumps(d) + "\n" for d in docs))
