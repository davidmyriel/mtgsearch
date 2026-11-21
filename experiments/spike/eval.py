"""Score the frozen query set against the spike collection.

Usage: TOPK_API_KEY=... python3 -I eval.py <spike_dir> [text] [jargon] [art] [scryfall]
"""
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.parse

from topk_sdk import Client
from topk_sdk.query import field, fn, match, select

spike_dir, parts = sys.argv[1], set(sys.argv[2:]) or {"text", "jargon", "art", "scryfall"}
client = Client(api_key=os.environ["TOPK_API_KEY"], region="aws-us-east-1-elastica")
col = client.collection("mtg-spike-5k")
Q = json.load(open(f"{spike_dir}/queries.json"))
truth = {k: set(v) for k, v in json.load(open(f"{spike_dir}/tag_truth.json")).items()}
lat = {}


def run(mode, q, k=10):
    if mode == "bm25":
        query = select("name", score=fn.bm25_score()).filter(match(q, field="rules"))
    elif mode == "semantic":
        query = select("name", score=fn.semantic_similarity("rules", q))
    elif mode == "semantic+tags":
        query = select("name", score=fn.semantic_similarity("rules_tagged", q))
    elif mode == "art":
        query = select("name", score=fn.semantic_similarity("art", q)).filter(field("edhrec_rank") <= 1500)
    t0 = time.time()
    rows = col.query(query.sort(field("score"), asc=False).limit(k))
    lat.setdefault(mode, []).append((time.time() - t0) * 1000)
    return rows


def first_rank(rows, accept):
    for i, r in enumerate(rows, 1):
        if r["name"] in accept:
            return i
    return None


def scryfall(q, accept):
    url = "https://api.scryfall.com/cards/search?q=" + urllib.parse.quote(q)
    out = subprocess.run(
        ["curl", "-sS", "-H", "User-Agent: demo-research/1.0", "-H", "Accept: application/json", url],
        capture_output=True, text=True,
    ).stdout
    time.sleep(0.15)
    d = json.loads(out)
    if d.get("object") == "error":
        return 0, False
    return d.get("total_cards", 0), any(c["name"] in accept for c in d.get("data", []))


def summary(label, ranks):
    n = len(ranks)
    h = lambda k: sum(1 for r in ranks if r and r <= k)
    print(f"  {label:14} top-1 {h(1):2}/{n}   top-3 {h(3):2}/{n}   top-10 {h(10):2}/{n}")


out = {}
for part, modes in (("text", ["bm25", "semantic", "semantic+tags"]), ("art", ["art"])):
    if part not in parts:
        continue
    print(f"\n=== {part} queries ===")
    ranks = {m: [] for m in modes}
    sf_hits = []
    for item in Q[part]:
        accept = set(item["accept"])
        print(f"\n{item['q']!r}  -> want {item['accept'][0]}{' (+%d more)' % (len(accept) - 1) if len(accept) > 1 else ''}")
        rec = {"q": item["q"], "accept": item["accept"]}
        if part == "text" and "scryfall" in parts:
            total, hit = scryfall(item["q"], accept)
            sf_hits.append(hit)
            rec["scryfall"] = {"total": total, "hit": hit}
            print(f"  {'scryfall':14} {total} results, target {'found' if hit else 'not found'}")
        for m in modes:
            rows = run(m, item["q"])
            r = first_rank(rows, accept)
            ranks[m].append(r)
            rec[m] = {"rank": r, "top": [(x["name"], round(x["score"], 3)) for x in rows[:5]]}
            print(f"  {m:14} rank {str(r or '-'):>2} | " + "; ".join(x["name"] for x in rows[:3]))
        out.setdefault(part, []).append(rec)
    print(f"\n--- {part} summary ---")
    if sf_hits:
        print(f"  {'scryfall':14} target returned at all: {sum(sf_hits)}/{len(sf_hits)}")
    for m in modes:
        summary(m, ranks[m])

if "jargon" in parts:
    print("\n=== jargon queries (graded against Scryfall community tag membership) ===")
    modes = ["bm25", "semantic", "semantic+tags"]
    p5 = {m: [] for m in modes}
    for item in Q["jargon"]:
        members = truth[item["tag"]]
        print(f"\n{item['q']!r}  ({len(members)} tagged cards in corpus)")
        rec = {"q": item["q"], "tag": item["tag"]}
        for m in modes:
            rows = run(m, item["q"], k=5)
            good = sum(1 for x in rows if x["_id"] in members)
            p5[m].append(good)
            rec[m] = {"correct_in_top5": good, "top": [x["name"] for x in rows]}
            print(f"  {m:14} {good}/5 correct | " + "; ".join(x["name"] for x in rows))
        out.setdefault("jargon", []).append(rec)
    print("\n--- jargon summary (correct cards in top 5, summed over 8 queries) ---")
    for m in modes:
        print(f"  {m:14} {sum(p5[m])}/{5 * len(p5[m])}")

print("\n--- client-side latency per query (ms, includes network) ---")
for m, v in lat.items():
    print(f"  {m:14} median {statistics.median(v):.0f}  max {max(v):.0f}  n={len(v)}")
out["latency_ms"] = {m: {"median": statistics.median(v), "max": max(v)} for m, v in lat.items()}
json.dump(out, open(f"{spike_dir}/results_{'_'.join(sorted(parts))}.json", "w"), indent=1)
