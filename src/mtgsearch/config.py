"""Runtime configuration, read from the environment."""

import os
from pathlib import Path


def _env(name: str, default: str) -> str:
    """An unset or empty variable falls back to the default. CI passes unset repository
    variables as empty strings, which must not become an empty collection name."""
    return os.environ.get(name) or default


COLLECTION = _env("MTGSEARCH_COLLECTION", "mtg-cards-v2")
REGION = _env("TOPK_REGION", "aws-us-east-1-elastica")
DATA_DIR = Path(_env("MTGSEARCH_DATA_DIR", "data"))

# Scryfall requires an accurate User-Agent that names the application.
USER_AGENT = "mtgsearch/0.0.1 (development build)"


def client():
    from topk_sdk import Client

    key = os.environ.get("TOPK_API_KEY")
    if not key:
        raise SystemExit("TOPK_API_KEY is not set; see .env.example")
    return Client(api_key=key, region=REGION)


def collection():
    return client().collection(COLLECTION)
