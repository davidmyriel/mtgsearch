"""The web layer, tested with a stubbed search function: no network and no TopK key."""

import pytest
from starlette.testclient import TestClient

from mtgsearch.search import Result
from mtgsearch.web import MAX_QUERY_CHARS, MAX_RESULTS, RateLimiter, TTLCache, create_app

HIT = {
    "_id": "abc",
    "name": "Consecrated Sphinx",
    "mana_cost": "{4}{U}{U}",
    "type_line": "Creature — Sphinx",
    "oracle_text": "Flying\nWhenever an opponent draws a card, you may draw two cards.",
    "image": "https://cards.scryfall.io/normal/front/x.jpg",
    "scryfall_uri": "https://scryfall.com/card/2x2/43/consecrated-sphinx",
    "edhrec_rank": 661,
    "score": 4.25219,
}


class Stub:
    def __init__(self, result=None, error=None):
        self.calls, self.result, self.error = [], result or Result("semantic", [HIT], None, "sphinx"), error

    def __call__(self, query, k):
        self.calls.append((query, k))
        if self.error:
            raise self.error
        return self.result


def client(stub=None, **kwargs):
    stub = stub or Stub()
    return TestClient(create_app(stub, **kwargs)), stub


def test_search_returns_the_documented_shape():
    http, stub = client()
    response = http.get("/api/search", params={"q": "  sphinx   that draws two cards "})
    assert response.status_code == 200
    body = response.json()
    assert stub.calls == [("sphinx that draws two cards", 24)]  # whitespace is normalised
    assert body["mode"] == "semantic" and body["note"] == "sphinx" and body["total"] is None
    assert body["query"] == "sphinx that draws two cards" and isinstance(body["took_ms"], int)
    assert body["hits"] == [
        {
            "id": "abc",
            "name": "Consecrated Sphinx",
            "mana_cost": "{4}{U}{U}",
            "type_line": "Creature — Sphinx",
            "oracle_text": "Flying\nWhenever an opponent draws a card, you may draw two cards.",
            "image": "https://cards.scryfall.io/normal/front/x.jpg",
            "scryfall_uri": "https://scryfall.com/card/2x2/43/consecrated-sphinx",
            "score": 4.252,
        }
    ]


@pytest.mark.parametrize(
    "params", [{}, {"q": ""}, {"q": "   "}, {"q": "x" * (MAX_QUERY_CHARS + 1)}, {"q": "elf", "k": "many"}]
)
def test_bad_requests_are_rejected_without_searching(params):
    http, stub = client()
    response = http.get("/api/search", params=params)
    assert response.status_code == 400 and "error" in response.json()
    assert stub.calls == []


def test_result_count_is_clamped():
    http, stub = client()
    http.get("/api/search", params={"q": "elf", "k": 5000})
    http.get("/api/search", params={"q": "goblin", "k": -3})
    assert stub.calls == [("elf", MAX_RESULTS), ("goblin", 1)]


def test_repeated_queries_are_served_from_cache():
    http, stub = client()
    first = http.get("/api/search", params={"q": "elf"}).json()
    second = http.get("/api/search", params={"q": "elf"}).json()
    assert len(stub.calls) == 1 and first == second


def test_rate_limit_applies_to_uncached_queries_only():
    http, stub = client(rate_limit=2)
    assert http.get("/api/search", params={"q": "one"}).status_code == 200
    assert http.get("/api/search", params={"q": "two"}).status_code == 200
    blocked = http.get("/api/search", params={"q": "three"})
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) >= 1
    assert http.get("/api/search", params={"q": "one"}).status_code == 200  # cached, costs nothing
    assert len(stub.calls) == 2


def test_backend_failure_is_a_502_that_leaks_nothing():
    http, _ = client(Stub(error=RuntimeError("secret internal detail")))
    response = http.get("/api/search", params={"q": "elf"})
    assert response.status_code == 502
    assert "secret" not in response.text


def test_failures_are_not_cached():
    stub = Stub(error=RuntimeError("down"))
    http, _ = client(stub)
    assert http.get("/api/search", params={"q": "elf"}).status_code == 502
    stub.error = None
    assert http.get("/api/search", params={"q": "elf"}).status_code == 200


def test_unsupported_syntax_is_passed_through_for_the_page_to_explain():
    http, _ = client(Stub(Result("unsupported", note="'r:' is not supported yet")))
    body = http.get("/api/search", params={"q": "r:mythic"}).json()
    assert body["mode"] == "unsupported" and body["hits"] == [] and "not supported" in body["note"]


def test_page_and_assets_are_served_with_security_headers():
    http, _ = client()
    page = http.get("/")
    assert page.status_code == 200 and 'id="search"' in page.text
    assert "https://cards.scryfall.io" in page.headers["content-security-policy"]
    assert "unsafe-inline" not in page.headers["content-security-policy"]
    assert page.headers["x-content-type-options"] == "nosniff"
    for asset in ("app.js", "app.css", "icon.svg"):
        response = http.get(f"/static/{asset}")
        assert response.status_code == 200 and "max-age" in response.headers["cache-control"]
    assert http.get("/api/search", params={"q": "elf"}).headers["cache-control"] == "no-store"
    assert http.get("/healthz").json() == {"ok": True}


def test_page_has_no_inline_script_or_style():
    """The Content-Security-Policy forbids inline code, so the page must not rely on any."""
    http, _ = client()
    html = http.get("/").text
    assert "<style" not in html and "style=" not in html and "onclick=" not in html
    assert html.count("<script") == 1 and 'src="/static/app.js"' in html


def test_ttl_cache_expires_and_evicts():
    now = [0.0]
    cache = TTLCache(max_items=2, ttl_seconds=10, clock=lambda: now[0])
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1
    cache.put("c", 3)  # evicts "b", the least recently used
    assert cache.get("b") is None and cache.get("a") == 1 and cache.get("c") == 3
    now[0] = 11
    assert cache.get("a") is None


def test_rate_limiter_window_slides():
    now = [0.0]
    limiter = RateLimiter(limit=2, window_seconds=60, clock=lambda: now[0])
    assert limiter.check("ip") == 0 and limiter.check("ip") == 0
    assert limiter.check("ip") > 0
    assert limiter.check("other") == 0  # per client
    now[0] = 61
    assert limiter.check("ip") == 0
