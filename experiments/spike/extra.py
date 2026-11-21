"""Two follow-up probes: (1) do metadata filters rescue the numeric misses, (2) one-word art queries graded by creature type."""
import os
from topk_sdk import Client
from topk_sdk.query import field, fn, select

col = Client(api_key=os.environ["TOPK_API_KEY"], region="aws-us-east-1-elastica").collection("mtg-spike-5k")

print("--- numeric misses, re-run with a mana-value filter ---")
for q, want, cmc in [
    ("one mana artifact that taps for two colorless mana", "Sol Ring", 1.0),
    ("one mana elf that taps for one green mana", "Llanowar Elves / Elvish Mystic / Fyndhorn Elves", 1.0),
    ("two mana sorcery that searches my library for any card and puts it into my hand", "Demonic Tutor", 2.0),
]:
    rows = col.query(
        select("name", score=fn.semantic_similarity("rules", q))
        .filter(field("cmc") == cmc)
        .sort(field("score"), asc=False)
        .limit(5)
    )
    print(f"{q!r}\n   want {want}\n   got  " + "; ".join(r["name"] for r in rows))

print("\n--- one-word art queries: how many of the top 5 are that creature type ---")
total = 0
for word in ["sphinx", "dragon", "angel", "goblin", "zombie", "elf"]:
    rows = col.query(
        select("name", "type_line", score=fn.semantic_similarity("art", word))
        .filter(field("edhrec_rank") <= 1500)
        .sort(field("score"), asc=False)
        .limit(5)
    )
    good = sum(1 for r in rows if word in r["type_line"].lower())
    total += good
    print(f"{word:7} {good}/5 | " + "; ".join(f"{r['name']} [{r['type_line'].split('—')[-1].strip()}]" for r in rows))
print(f"total {total}/30")
