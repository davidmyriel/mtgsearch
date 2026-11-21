"""Scryfall access: bulk-data downloads for ingest, and the search API for conformance tests.

Bulk files are the only source for ingest. The search API is used solely to compare our
results against Scryfall's, and is throttled to stay well inside their published rate limit.
"""

import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from pathlib import Path

from .config import USER_AGENT

API = "https://api.scryfall.com"
_HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
_MIN_INTERVAL = 0.12  # seconds between API calls
_last_call = 0.0


def _get(url: str) -> bytes:
    global _last_call
    wait = _MIN_INTERVAL - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=_HEADERS), timeout=120) as r:
            return r.read()
    finally:
        _last_call = time.monotonic()


def bulk_index() -> dict[str, dict]:
    """Map bulk type (oracle_cards, oracle_tags, ...) to its listing entry."""
    return {b["type"]: b for b in json.loads(_get(f"{API}/bulk-data"))["data"]}


def download_bulk(kind: str, dest: Path) -> Path:
    """Download one bulk file as gzipped JSON Lines. Skips the download if it is already current."""
    entry = bulk_index()[kind]
    dest.mkdir(parents=True, exist_ok=True)
    path, stamp = dest / f"{kind}.jsonl.gz", dest / f"{kind}.updated_at"
    if path.exists() and stamp.exists() and stamp.read_text() == entry["updated_at"]:
        return path
    path.write_bytes(_get(entry["jsonl_download_uri"]))
    stamp.write_text(entry["updated_at"])
    return path


def read_jsonl_gz(path: Path) -> Iterator[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def api_search(query: str, max_pages: int = 4) -> tuple[int, list[str], bool]:
    """Run a query on Scryfall. Returns (total, oracle ids fetched, whether the id list is complete)."""
    url = f"{API}/cards/search?" + urllib.parse.urlencode({"q": query, "unique": "cards"})
    ids: list[str] = []
    total = 0
    for _ in range(max_pages):
        try:
            page = json.loads(_get(url))
        except urllib.error.HTTPError as e:
            if e.code == 404:  # Scryfall answers "no cards matched" with a 404
                return 0, [], True
            raise
        total = page.get("total_cards", 0)
        ids += [c.get("oracle_id") or c["card_faces"][0].get("oracle_id") or c["id"] for c in page["data"]]
        if not page.get("has_more"):
            return total, ids, True
        url = page["next_page"]
    return total, ids, False
