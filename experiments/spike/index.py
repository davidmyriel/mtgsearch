"""Index the spike corpus into TopK.

Usage: TOPK_API_KEY=... python3 -I index.py text|art <spike_dir> <art_dir>
  text: create the collection and upsert 5,000 cards (two semantic text fields)
  art:  attach art crops to the top ~1,500 cards (semantic image field)
"""
import json
import os
import sys
import time

from topk_sdk import Client
from topk_sdk import data
from topk_sdk.error import CollectionAlreadyExistsError
from topk_sdk.schema import float as float_
from topk_sdk.schema import image, keyword_index, semantic_index, text
from topk_sdk.schema import int as int_
from topk_sdk.schema import list as list_

COLLECTION = "mtg-spike-5k"
stage, spike_dir, art_dir = sys.argv[1], sys.argv[2], sys.argv[3]
client = Client(api_key=os.environ["TOPK_API_KEY"], region="aws-us-east-1-elastica")
col = client.collection(COLLECTION)
docs = json.load(open(f"{spike_dir}/cards.json"))
for d in docs:
    if not d["colors"]:
        del d["colors"]  # an empty list is typed as list<f32> and rejected by the list<text> field

if stage == "text":
    try:
        client.collections().create(
            COLLECTION,
            schema={
                "name": text().required().index(keyword_index()),
                "rules": text().required().index(semantic_index()),
                "rules_tagged": text().required().index(semantic_index()),
                "art": image().index(semantic_index()),
                "cmc": float_(),
                "edhrec_rank": int_(),
                "colors": list_("text"),
            },
        )
        print("created", COLLECTION)
    except CollectionAlreadyExistsError:
        print("collection exists, upserting into it")
    t0 = time.time()
    for i in range(0, len(docs), 250):
        lsn = col.upsert(docs[i : i + 250])
        print(f"  upserted {min(i + 250, len(docs))}/{len(docs)}  {time.time() - t0:.0f}s", flush=True)
    print("count:", col.count(lsn=lsn), "lsn:", lsn)

elif stage == "art":
    ids = [l.split("\t")[0] for l in open(f"{spike_dir}/art_urls.txt")]
    by_id = {d["_id"]: d for d in docs}
    batch, size, done, t0, lsn = [], 0, 0, time.time(), None

    def flush():
        global batch, size, done, lsn
        if batch:
            lsn = col.upsert(batch)  # upsert replaces the whole document, so send text + art together
            done += len(batch)
            print(f"  art {done}/{len(ids)}  {time.time() - t0:.0f}s", flush=True)
            batch, size = [], 0

    for _id in ids:
        raw = open(f"{art_dir}/{_id}.jpg", "rb").read()
        if size + len(raw) > 4_000_000:
            flush()
        batch.append({**by_id[_id], "art": data.image(raw)})
        size += len(raw)
    flush()
    print("count:", col.count(lsn=lsn), "lsn:", lsn)
