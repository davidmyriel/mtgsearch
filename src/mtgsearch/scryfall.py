"""Scryfall bulk-data downloads, the only source for ingest.

Requests are throttled to stay well inside Scryfall's published rate limit.
"""

import gzip
import json
import time
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


def sets() -> list[dict]:
    """Every set Scryfall knows, as its set objects. One request."""
    return json.loads(_get(f"{API}/sets"))["data"]


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
