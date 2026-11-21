"""Build the spike corpus: the 5,000 most-played Commander cards (by EDHREC rank).

Usage: python3 -I prep.py <download_dir> <out_dir>
Writes <out_dir>/cards.json (documents without images), tag_truth.json and art_urls.txt.
"""
import gzip
import json
import sys

DL, OUT = sys.argv[1], sys.argv[2]
N_TEXT, N_ART = 5000, 1500
COLOR = {"W": "white", "U": "blue", "B": "black", "R": "red", "G": "green"}

cards = [json.loads(l) for l in gzip.open(f"{DL}/oracle_cards.jsonl.gz", "rt", encoding="utf-8")]
tags = [json.loads(l) for l in gzip.open(f"{DL}/oracle_tags.jsonl.gz", "rt", encoding="utf-8")]

ranked = sorted((c for c in cards if c.get("edhrec_rank")), key=lambda c: c["edhrec_rank"])[:N_TEXT]

# oracle_id -> direct tag labels
direct = {}
for t in tags:
    for g in t["taggings"]:
        direct.setdefault(g["oracle_id"], set()).add(t["label"].replace("-", " "))

by_id = {t["id"]: t for t in tags}


def closure(tag):
    seen, stack, ids = set(), [tag["id"]], set()
    while stack:
        x = stack.pop()
        if x in seen or x not in by_id:
            continue
        seen.add(x)
        ids.update(g["oracle_id"] for g in by_id[x]["taggings"])
        stack.extend(by_id[x]["child_ids"])
    return ids


def faces(c):
    return c.get("card_faces") or [c]


def rules_text(c):
    parts = [c["name"]]
    colors = c.get("colors")
    if colors is None:
        colors = sorted({x for f in faces(c) for x in f.get("colors", [])})
    color_words = ", ".join(COLOR[x] for x in colors) or "colorless"
    cost = c.get("mana_cost") or " // ".join(f.get("mana_cost", "") for f in faces(c))
    parts.append(f"Mana cost {cost or 'none'} (mana value {int(c.get('cmc', 0))}), {color_words}.")
    for f in faces(c):
        line = f.get("type_line", c.get("type_line", ""))
        if f.get("power") is not None:
            line += f" {f['power']}/{f['toughness']}"
        if f.get("loyalty"):
            line += f" (loyalty {f['loyalty']})"
        parts.append(line)
        if f.get("oracle_text"):
            parts.append(f["oracle_text"])
    return "\n".join(parts)


docs, art = [], []
for c in ranked:
    text = rules_text(c)
    labels = sorted(direct.get(c["oracle_id"], []))
    img = c.get("image_uris") or faces(c)[0].get("image_uris") or {}
    doc = {
        "_id": c["oracle_id"],
        "name": c["name"],
        "rules": text,
        "rules_tagged": text + ("\nTags: " + ", ".join(labels) if labels else ""),
        "type_line": c.get("type_line", ""),
        "cmc": float(c.get("cmc", 0)),
        "colors": c.get("color_identity", []),
        "edhrec_rank": c["edhrec_rank"],
        "artist": c.get("artist", ""),
        "scryfall_uri": c["scryfall_uri"].split("?")[0],
    }
    docs.append(doc)
    if c["edhrec_rank"] <= N_ART and img.get("art_crop"):
        art.append((c["oracle_id"], img["art_crop"]))

in_corpus = {d["_id"] for d in docs}
JARGON_TAGS = ["sweeper", "mana rock", "mana dork", "wheel", "tutor", "fog", "sacrifice outlet", "reanimate"]
truth = {}
for slug in JARGON_TAGS:
    hit = [t for t in tags if t["label"] == slug or slug in t["aliases"]]
    if not hit:
        hit = [t for t in tags if slug in t["label"]]
        print(f"no exact tag for {slug}; candidates: {[t['label'] for t in hit][:12]}")
        continue
    ids = closure(hit[0]) & in_corpus
    truth[slug] = sorted(ids)
    print(f"tag {slug:18} -> {hit[0]['label']:18} members in corpus: {len(ids)}")

json.dump(docs, open(f"{OUT}/cards.json", "w"))
json.dump(truth, open(f"{OUT}/tag_truth.json", "w"))
open(f"{OUT}/art_urls.txt", "w").write("".join(f"{i}\t{u}\n" for i, u in art))

lens = [len(d["rules_tagged"]) for d in docs]
print(f"docs: {len(docs)}  art: {len(art)}  max chars rules_tagged: {max(lens)}  mean: {sum(lens)//len(lens)}")
names = {d["name"]: d["edhrec_rank"] for d in docs}
for n in sys.argv[3:]:
    print(f"  {n!r}: rank {names.get(n, 'NOT IN CORPUS')}")
