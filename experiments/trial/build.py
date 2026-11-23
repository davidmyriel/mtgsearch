"""Step 2 of the trial: build the throwaway collections.

    python experiments/trial/build.py            (needs TOPK_API_KEY and data/trial/sample.json)
    python experiments/trial/build.py --dry-run  (prints what would be sent and a few cards)
    python experiments/trial/build.py --only=e,f (builds only those wordings)

One collection for each wording, all holding the same cards and differing only in the two
fields TopK embeds:

    a  the text as the live index sends it today
    b  cost and rules with every symbol said in words
    c  as b, and each small number in the rules followed by its word
    d  today's text, with the wording of c added underneath it
    e  today's cost line untouched; only the symbols inside the rules said in words
    f  as e, and each small number in the rules followed by its word

    a2 a second collection with exactly the text of a: the control. TopK's search by meaning
       is approximate, so two collections of the same text need not rank alike, and what
       they disagree on is not a difference between wordings

e and f were added after a to d had been compared: b and c made searches worse that have
nothing to do with symbols, and the one thing they change on every card is the cost line.

The cards are the ones step 1 chose (what the test searches find today and their right
answers) and cards drawn at random on top, so that the collections are not made only of
cards the searches like. The live collections are not touched. Collections are named for
the trial and are not reused: one that already exists is filled again, never recreated.
"""

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import json  # noqa: E402

from words import cost_line, spell, with_numbers  # noqa: E402

from mtgsearch import config, scryfall  # noqa: E402
from mtgsearch.documents import COLOR_WORDS, COLORS, _faces, build_document  # noqa: E402
from mtgsearch.ingest import BATCH, CARDS, _hashed, cards_schema  # noqa: E402
from mtgsearch.printings import aggregates  # noqa: E402
from mtgsearch.tags import card_tags  # noqa: E402

TRIAL = "t1"
VARIANTS = ("a", "b", "c", "d", "e", "f", "a2")
SIZE = 2600
SEED = 23


def collection(variant: str) -> str:
    return f"mtg-trial-{TRIAL}-{variant}"


def worded(card: dict, numbers: bool) -> tuple[str, list[str]]:
    """The cost line in words, and each face's rules with symbols (and numbers) in words."""
    colours = card.get("colors")
    if colours is None:
        colours = sorted({c for f in _faces(card) for c in f.get("colors", [])}, key=COLORS.index)
    colour_words = ", ".join(COLOR_WORDS[c] for c in colours) or "colorless"
    cost = card.get("mana_cost") or " // ".join(f.get("mana_cost", "") for f in _faces(card)).strip(" /")
    rules = []
    for face in _faces(card):
        said = spell(face.get("oracle_text") or "")
        rules.append(with_numbers(said) if numbers else said)
    return cost_line(cost, int(card.get("cmc") or 0), colour_words), rules


def text_for(card: dict, today: str, variant: str) -> str:
    """The card's embedded text in one of the wordings. `today` is what the live index sends."""
    if variant in ("a", "a2"):
        return today
    cost, rules = worded(card, numbers=variant not in ("b", "e"))
    lines = today.split("\n")
    if variant in ("e", "f"):
        cost = lines[1]  # the cost line as it is sent today
    if variant == "d":
        changed = [said for face, said in zip(_faces(card), rules, strict=True) if said and said != (face.get("oracle_text") or "")]
        return "\n".join([today, "In words: " + cost, *changed])
    # b and c: the same lines as today, with the cost line and each face's rules replaced
    out = [lines[0], cost]
    for face, said in zip(_faces(card), rules, strict=True):
        line = face.get("type_line") or card.get("type_line") or ""
        if face.get("power") is not None:
            line += f" {face['power']}/{face['toughness']}"
        if face.get("loyalty"):
            line += f" (loyalty {face['loyalty']})"
        out.append(line)
        if said:
            out.append(said)
    return "\n".join(out)


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    data = config.DATA_DIR if config.DATA_DIR.is_absolute() else ROOT / config.DATA_DIR
    sample = json.loads((data / "trial" / "sample.json").read_text())
    wanted_ids, wanted_names = set(sample["ids"]), set(sample["names"])

    tags = card_tags(scryfall.read_jsonl_gz(data / "oracle_tags.jsonl.gz"))
    totals = aggregates(scryfall.read_jsonl_gz(data / "default_cards.jsonl.gz"))
    cards = list(scryfall.read_jsonl_gz(data / "oracle_cards.jsonl.gz"))
    docs = {c["oracle_id"]: build_document(c, tags.get(c["oracle_id"]), totals.get(c["oracle_id"])) for c in cards}
    by_id = {c["oracle_id"]: c for c in cards}

    chosen = {i for i, doc in docs.items() if i in wanted_ids or doc["name"] in wanted_names}
    missing = wanted_names - {docs[i]["name"] for i in chosen}
    others = sorted(i for i, doc in docs.items() if i not in chosen and not doc["extra"])
    random.Random(SEED).shuffle(others)
    from_searches = len(chosen)
    chosen |= set(others[: max(0, SIZE - len(chosen))])
    print(f"{len(chosen)} cards: {from_searches} from the test searches and their answers, {len(chosen) - from_searches} at random")
    if missing:
        print(f"  answers not found by name: {sorted(missing)}")

    client = None if dry_run else config.client()
    existing = set() if dry_run else {c.name for c in client.collections().list()}
    only = next((arg.split("=", 1)[1].split(",") for arg in sys.argv if arg.startswith("--only=")), VARIANTS)
    for variant in VARIANTS:
        if variant not in only:
            continue
        batch = []
        for i in sorted(chosen):
            doc = dict(docs[i])
            text = text_for(by_id[i], doc["rules"], variant)
            tagline = doc["rules_tagged"][len(doc["rules"]) :]  # "\nTags: ..." or nothing
            doc["rules"], doc["rules_tagged"] = text, text + tagline
            batch.append(doc)
        batch = _hashed(batch, CARDS)
        size = sum(len(doc["rules"]) for doc in batch)
        print(f"{collection(variant)}: {len(batch)} cards, {size:,} characters of rules text")
        if dry_run:
            for name in ("Lightning Bolt", "Sol Ring", "Llanowar Elves"):
                shown = next(doc for doc in batch if doc["name"] == name and not doc["extra"])
                print("   " + repr(shown["rules"]))
            continue
        if collection(variant) not in existing:
            client.collections().create(collection(variant), schema=cards_schema())
        col = client.collection(collection(variant))
        for start in range(0, len(batch), BATCH):
            col.upsert(batch[start : start + BATCH])
        count = col.count(consistency="strong")
        print(f"   holds {count} documents")
        if count != len(batch):
            raise SystemExit(f"{collection(variant)} holds {count}, expected {len(batch)}")


if __name__ == "__main__":
    main()
