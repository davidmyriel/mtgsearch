"""Differential testing: run the same Scryfall-syntax query on Scryfall and on TopK, compare results.

A query passes when the totals match and, where Scryfall's full result list was fetched,
the two sets of Oracle ids are identical.
"""

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import config, scryfall
from .syntax import QueryError, compile_query, to_topk

MAX_IDS = 5000


@dataclass
class Result:
    query: str
    status: str  # pass | fail | unsupported | error
    scryfall_total: int = 0
    ours_total: int = 0
    missing: list[str] = field(default_factory=list)  # names Scryfall returns and we do not
    extra: list[str] = field(default_factory=list)  # names we return and Scryfall does not
    note: str = ""


def topk_ids(col, predicate) -> tuple[int, dict[str, str]]:
    """Run a predicate on TopK. Returns (total, {oracle_id: name}) for up to MAX_IDS matches."""
    from topk_sdk.query import filter as filter_
    from topk_sdk.query import select

    expr = to_topk(predicate)
    if expr is None:
        return col.count(), {}
    total = col.query(filter_(expr).count())[0]["_count"]
    rows = col.query(select("name").filter(expr).limit(MAX_IDS)) if total else []
    return total, {r["_id"]: r["name"] for r in rows}


def read_queries(path: Path) -> list[str]:
    return [
        q for q in (line.strip() for line in path.read_text().splitlines()) if q and not q.startswith("#")
    ]


def check(col, query: str, names: dict[str, str] | None = None) -> Result:
    try:
        predicate, _ = compile_query(query)
    except QueryError as e:
        kind = "unsupported" if type(e).__name__ == "Unsupported" else "error"
        return Result(query, kind, note=str(e))
    ours_total, ours = topk_ids(col, predicate)
    sf_total, sf_ids, complete = scryfall.api_search(query)
    result = Result(query, "fail", sf_total, ours_total)
    names = names or {}
    sf_set = set(sf_ids)
    result.missing = sorted(names.get(i, i) for i in sf_set - set(ours))[:8]
    if complete:
        result.extra = sorted(ours[i] for i in set(ours) - sf_set)[:8]
    else:
        result.note = f"compared totals and the first {len(sf_ids)} Scryfall results"
    if sf_total == ours_total and not result.missing and not result.extra:
        result.status = "pass"
    return result


def run(queries_path: Path, out_path: Path | None = None, log=print) -> list[Result]:
    col = config.collection()
    documents = config.DATA_DIR / "documents.jsonl"
    names = {}
    if documents.exists():
        names = {d["_id"]: d["name"] for d in map(json.loads, documents.open())}
    results = []
    for query in read_queries(queries_path):
        r = check(col, query, names)
        results.append(r)
        detail = (
            f"scryfall {r.scryfall_total}, ours {r.ours_total}" if r.status in ("pass", "fail") else r.note
        )
        log(f"{r.status.upper():11} {query:45} {detail}")
        if r.status == "fail":
            if r.missing:
                log(f"            we miss: {'; '.join(r.missing)}")
            if r.extra:
                log(f"            we add:  {'; '.join(r.extra)}")
    counts = {s: sum(r.status == s for r in results) for s in ("pass", "fail", "unsupported", "error")}
    log(f"\n{counts['pass']}/{len(results)} queries match Scryfall exactly; {counts}")
    if out_path:
        out_path.write_text(
            json.dumps({"summary": counts, "results": [asdict(r) for r in results]}, indent=1)
        )
    return results
