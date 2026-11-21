"""Relevance evaluation: run the frozen query set and score each ranking strategy.

Strategies compared on every query, all restricted to cards Scryfall shows by default:

    bm25           keyword match on the rules text
    semantic       TopK semantic similarity on the rules text
    semantic+tags  the same, with Scryfall's community tags appended to the text
    both           the sum of the two semantic scores
    search         the full pipeline: name match first, parsed filters, then `both`

Single-answer classes are scored by the rank of the first accepted card. The jargon class is
scored against membership of the matching community tag (correct cards in the top 5).
"""

import json
import statistics
import time
from pathlib import Path

from . import config, scryfall
from .search import VISIBLE, search, semantic
from .syntax import to_topk
from .tags import tag_members

STRATEGIES = ["bm25", "semantic", "semantic+tags", "both", "search"]


def _run(col, strategy: str, query: str, k: int, latency: dict) -> list[dict]:
    from topk_sdk.query import field, fn, match, select

    started = time.time()
    if strategy == "bm25":
        rows = col.query(
            select("name", score=fn.bm25_score())
            .filter(match(query, field="rules"))
            .filter(to_topk(VISIBLE))
            .sort(field("score"), asc=False)
            .limit(k)
        )
    elif strategy == "semantic":
        rows = semantic(col, query, VISIBLE, k, ("rules",))
    elif strategy == "semantic+tags":
        rows = semantic(col, query, VISIBLE, k, ("rules_tagged",))
    elif strategy == "both":
        rows = semantic(col, query, VISIBLE, k, ("rules", "rules_tagged"))
    else:
        rows = search(query, k, col).hits
    latency.setdefault(strategy, []).append((time.time() - started) * 1000)
    return rows


def _first_rank(rows: list[dict], accept: set[str]) -> int | None:
    return next((i for i, r in enumerate(rows, 1) if r["name"] in accept), None)


def run(
    queries_path: Path, out_path: Path | None = None, classes: list[str] | None = None, log=print
) -> dict:
    col = config.collection()
    queries = json.loads(queries_path.read_text())
    tags = list(scryfall.read_jsonl_gz(config.DATA_DIR / "oracle_tags.jsonl.gz"))
    latency: dict[str, list[float]] = {}
    report: dict = {"collection": config.COLLECTION, "classes": {}}

    for name in classes or ["descriptive", "numeric", "jargon"]:
        items, rows_out = queries[name], []
        log(f"\n=== {name} ({len(items)} queries) ===")
        scores = {s: [] for s in STRATEGIES}
        for item in items:
            record = {"q": item["q"]}
            log(f"\n{item['q']!r}")
            for strategy in STRATEGIES:
                if "tag" in item:  # jargon: how many of the top 5 carry the community tag
                    rows = _run(col, strategy, item["q"], 5, latency)
                    members = tag_members(tags, item["tag"])
                    score = sum(r["_id"] in members for r in rows)
                    log(f"  {strategy:14} {score}/5 | " + "; ".join(r["name"] for r in rows))
                else:
                    rows = _run(col, strategy, item["q"], 10, latency)
                    score = _first_rank(rows, set(item["accept"]))
                    log(f"  {strategy:14} rank {score or '-':>2} | " + "; ".join(r["name"] for r in rows[:3]))
                scores[strategy].append(score)
                record[strategy] = {"score": score, "top": [r["name"] for r in rows[:5]]}
            rows_out.append(record)

        summary = {}
        for strategy in STRATEGIES:
            values = scores[strategy]
            if "tag" in items[0]:
                summary[strategy] = {"correct_in_top5": sum(values), "out_of": 5 * len(values)}
            else:
                summary[strategy] = {
                    f"top{k}": sum(1 for v in values if v and v <= k) for k in (1, 3, 10)
                } | {"out_of": len(values)}
        log(f"\n--- {name} summary ---")
        for strategy, s in summary.items():
            log(f"  {strategy:14} {s}")
        report["classes"][name] = {"summary": summary, "queries": rows_out}

    report["latency_ms"] = {
        s: {"median": round(statistics.median(v)), "max": round(max(v)), "n": len(v)}
        for s, v in latency.items()
    }
    log("\n--- client-side latency per query, ms (includes network) ---")
    for strategy, s in report["latency_ms"].items():
        log(f"  {strategy:14} {s}")
    if out_path:
        out_path.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    return report
