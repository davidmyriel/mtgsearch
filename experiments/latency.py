"""How long the deployed site takes to answer searches nobody has asked before.

    python experiments/latency.py https://topkmtg.netlify.app

Every query is different and carries a word that makes it new, so Netlify's cache cannot
answer it and each one reaches the function and TopK. Two times are taken for each: the whole
request as this machine sees it (which includes this machine's own route to Netlify), and the
time the function itself reports spending on the search (`took_ms`). They are run one at a
time and then four at a time. Requests go through curl, so that the machine's proxy settings
apply.

This is a measurement of the site as it stands, kept well under its rate limit, not a load test.
"""

import json
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

COLOURS = ["white", "blue", "black", "red", "green"]
KINDS = ["angel", "wizard", "zombie", "goblin", "elf", "knight", "dragon", "merfolk"]
DOES = ["draws cards", "gains life", "destroys an artifact", "makes tokens", "deals damage", "returns from the graveyard"]
WORDS = ["mana rocks", "board wipes", "counterspells", "tutors", "removal", "ramp", "card draw", "blink effects"]
NAMED = ["shock", "brainstorm", "llanowar", "tithe", "counterspell", "sol ring"]
# A request whose time outside the search is longer than this was waiting for a function to start.
COLD_START_MS = 900


def queries(stamp: str) -> list[tuple[str, str]]:
    """(kind of search, query), all different from one another and from any run before."""
    out = []
    # Scryfall syntax: filters on cards, and on printings
    for i, kind in enumerate(KINDS):
        out.append(("syntax", f"t:{kind} mv={i % 6 + 1} -o:{stamp}"))
        out.append(("syntax", f"t:{kind} c:{COLOURS[i % 5][0] if COLOURS[i % 5] != 'blue' else 'u'} usd<{i + 2} -o:{stamp}"))
    # plain English, ranked by meaning (the stamp is a word no card has, so results are unchanged in kind)
    for i, kind in enumerate(KINDS):
        for j in range(2):
            out.append(("meaning", f"{COLOURS[(i + j) % 5]} {kind} that {DOES[(i * 2 + j) % len(DOES)]} {stamp}"))
    # a keyword with words ranked by meaning
    for i, kind in enumerate(KINDS[:6]):
        out.append(("mixed", f"t:{kind} {DOES[i % len(DOES)]} {stamp}"))
    # players' words narrowed by a colour, and a named card's alternatives
    for i, word in enumerate(WORDS):
        out.append(("players' word", f"{COLOURS[i % 5]} {word}"))
    for name in NAMED:
        out.append(("alternatives", f"{name} alternative"))
    return out


def ask(base: str, kind: str, query: str) -> dict:
    url = f"{base}/api/search?{urlencode({'q': query, 'k': 60})}"
    started = time.perf_counter()
    done = subprocess.run(["curl", "-s", "--max-time", "30", "-w", "\n%{http_code}", url], capture_output=True, text=True, check=False)
    wall = (time.perf_counter() - started) * 1000
    body, _, status = done.stdout.rpartition("\n")
    took = None
    if status == "200":
        took = json.loads(body).get("took_ms")
    return {"kind": kind, "query": query, "status": status, "wall": wall, "took": took}


def summary(label: str, rows: list[dict]) -> None:
    good = [row for row in rows if row["status"] == "200"]
    if not good:
        print(f"{label}: no successful requests ({[row['status'] for row in rows][:5]})")
        return

    def cut(values: list[float], share: float) -> float:
        ordered = sorted(values)
        return ordered[min(len(ordered) - 1, int(len(ordered) * share))]

    wall = [row["wall"] for row in good]
    took = [row["took"] for row in good if row["took"] is not None]
    # a request that took a second longer than its search was waiting for the function to start
    cold = [row for row in good if row["took"] is not None and row["wall"] - row["took"] > COLD_START_MS]
    warm = [row["wall"] for row in good if row not in cold] or wall
    print(
        f"{label}: {len(good)} of {len(rows)} answered | whole request: median {statistics.median(wall):.0f} ms, "
        f"95 in 100 under {cut(wall, 0.95):.0f} ms, slowest {max(wall):.0f} ms | "
        f"the search itself: median {statistics.median(took):.0f} ms, 95 in 100 under {cut(took, 0.95):.0f} ms, slowest {max(took):.0f} ms | "
        f"{len(cold)} waited for the function to start; without them 95 in 100 under {cut(warm, 0.95):.0f} ms"
    )


def main() -> None:
    base = sys.argv[1].rstrip("/")
    stamp = f"zq{int(time.time()) % 100000}"
    todo = queries(stamp)
    half = len(todo) // 2
    print(f"{len(todo)} searches, none asked before (stamp {stamp})")

    first = ask(base, *todo[0])
    print(f"the very first request: {first['wall']:.0f} ms whole, {first['took']} ms the search itself (status {first['status']})")

    one_at_a_time = [first]
    for kind, query in todo[1:half]:
        one_at_a_time.append(ask(base, kind, query))
        time.sleep(0.7)  # well under the site's limit for one address
    summary("one at a time ", one_at_a_time)

    with ThreadPoolExecutor(max_workers=4) as pool:
        four_at_a_time = list(pool.map(lambda item: ask(base, *item), todo[half:]))
    summary("four at a time", four_at_a_time)

    everything = one_at_a_time + four_at_a_time
    for kind in dict.fromkeys(row["kind"] for row in everything):
        summary(f"  {kind:<14}", [row for row in everything if row["kind"] == kind])
    refused = [row for row in everything if row["status"] != "200"]
    if refused:
        print("not answered:", [(row["status"], row["query"]) for row in refused][:8])

    # the same search again: Netlify's cache should answer without the function
    # the same search again, a few times: Netlify's cache answers without the function, so this
    # is what this machine's own route to Netlify costs, and the least any request can take from here
    floor = statistics.median(ask(base, *todo[1])["wall"] for _ in range(5))
    print(f"a search repeated, answered from the cache: {floor:.0f} ms (this machine's route to Netlify)")


if __name__ == "__main__":
    main()
