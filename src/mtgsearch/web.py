"""The web app: one JSON search endpoint and one static page.

    uvicorn mtgsearch.web:app            (or: mtgsearch serve)

The TopK key stays on the server. The endpoint is public, and every plain-English query costs
an inference call, so it caps query length, caches repeated queries and rate-limits per client.
"""

import logging
import os
import threading
import time
from collections import OrderedDict, deque
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

log = logging.getLogger("mtgsearch.web")

STATIC = Path(__file__).with_name("static")
MAX_QUERY_CHARS = 200
DEFAULT_RESULTS, MAX_RESULTS = 24, 60
HIT_FIELDS = ("name", "mana_cost", "type_line", "oracle_text", "image", "scryfall_uri")
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' https://cards.scryfall.io; base-uri 'none'; "
        "form-action 'self'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}


class TTLCache:
    """A small thread-safe cache: popular queries are answered without calling TopK again."""

    def __init__(self, max_items: int = 512, ttl_seconds: float = 600, clock=time.monotonic):
        self._items: OrderedDict = OrderedDict()
        self._max, self._ttl, self._clock, self._lock = max_items, ttl_seconds, clock, threading.Lock()

    def get(self, key):
        with self._lock:
            entry = self._items.get(key)
            if entry is None or entry[0] < self._clock():
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return entry[1]

    def put(self, key, value) -> None:
        with self._lock:
            self._items[key] = (self._clock() + self._ttl, value)
            self._items.move_to_end(key)
            while len(self._items) > self._max:
                self._items.popitem(last=False)


class RateLimiter:
    """Sliding-window limit per client. In-process, so it is per server instance."""

    def __init__(
        self, limit: int = 30, window_seconds: float = 60, max_clients: int = 10_000, clock=time.monotonic
    ):
        self._limit, self._window, self._max_clients, self._clock = limit, window_seconds, max_clients, clock
        self._seen: OrderedDict[str, deque] = OrderedDict()
        self._lock = threading.Lock()

    def check(self, client: str) -> float:
        """Record a request. Returns 0 if allowed, else the seconds to wait."""
        now = self._clock()
        with self._lock:
            times = self._seen.setdefault(client, deque())
            self._seen.move_to_end(client)
            while times and times[0] <= now - self._window:
                times.popleft()
            if len(times) >= self._limit:
                return max(1.0, times[0] + self._window - now)
            times.append(now)
            while len(self._seen) > self._max_clients:
                self._seen.popitem(last=False)
            return 0.0


def _default_search():
    """Search against TopK with one shared client, created on first use."""
    from . import config
    from .search import search

    lock, holder = threading.Lock(), {}

    def run(query: str, k: int):
        with lock:
            if "col" not in holder:
                holder["col"] = config.collection()
        return search(query, k, holder["col"])

    return run


def _hit(hit: dict) -> dict:
    out = {"id": hit["_id"], **{f: hit.get(f) for f in HIT_FIELDS}}
    if "score" in hit:
        out["score"] = round(hit["score"], 3)
    return out


def create_app(search_fn=None, rate_limit: int | None = None, cache: TTLCache | None = None) -> Starlette:
    search_fn = search_fn or _default_search()
    limit = rate_limit if rate_limit is not None else int(os.environ.get("MTGSEARCH_RATE_LIMIT") or 30)
    limiter = RateLimiter(limit=limit)
    cache = cache or TTLCache()

    def with_headers(response: Response, cache_control: str = "no-store") -> Response:
        response.headers.update(SECURITY_HEADERS)
        response.headers.setdefault("Cache-Control", cache_control)
        return response

    def error(status: int, message: str, **headers) -> Response:
        return with_headers(JSONResponse({"error": message}, status_code=status, headers=headers))

    def api_search(request: Request) -> Response:
        query = " ".join(request.query_params.get("q", "").split())
        if not query:
            return error(400, "Type something to search for.")
        if len(query) > MAX_QUERY_CHARS:
            return error(400, f"Queries are limited to {MAX_QUERY_CHARS} characters.")
        try:
            k = int(request.query_params.get("k", DEFAULT_RESULTS))
        except ValueError:
            return error(400, "k must be a number.")
        k = max(1, min(k, MAX_RESULTS))

        body = cache.get((query, k))
        if body is None:
            wait = limiter.check(request.client.host if request.client else "unknown")
            if wait:
                return error(
                    429, "Too many searches. Try again in a moment.", **{"Retry-After": str(int(wait) + 1)}
                )
            started = time.perf_counter()
            try:
                result = search_fn(query, k)
            except Exception:
                log.exception("search failed for %r", query)
                return error(502, "The search backend is unavailable. Try again shortly.")
            body = {
                "query": query,
                "mode": result.mode,
                "total": result.total,
                "note": result.note,
                "hits": [_hit(h) for h in result.hits],
                "took_ms": round((time.perf_counter() - started) * 1000),
            }
            cache.put((query, k), body)
        return with_headers(JSONResponse(body))

    def index(request: Request) -> Response:
        return with_headers(FileResponse(STATIC / "index.html"), "no-cache")

    def healthz(request: Request) -> Response:
        return with_headers(JSONResponse({"ok": True}))

    class Static(StaticFiles):
        async def get_response(self, path, scope):
            return with_headers(await super().get_response(path, scope), "public, max-age=3600")

    return Starlette(
        routes=[
            Route("/", index),
            Route("/api/search", api_search),
            Route("/healthz", healthz),
            Mount("/static", Static(directory=STATIC), name="static"),
        ]
    )


app = create_app()
