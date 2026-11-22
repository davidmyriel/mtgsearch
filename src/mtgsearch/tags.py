"""Scryfall's community Oracle tags ("mana rock", "sweeper", ...), from the oracle_tags bulk file.

Tags form a hierarchy. A card tagged `tutor-creature` should also match `otag:tutor`, so each
card gets the slugs of its direct tags and of every ancestor.
"""

from collections.abc import Iterable


def card_tags(tags: Iterable[dict]) -> dict[str, dict]:
    """Map oracle_id -> {"labels": direct tag labels, "slugs": direct + ancestor slugs and aliases}."""
    tags = list(tags)
    by_id = {t["id"]: t for t in tags}

    def ancestors(tag_id: str, seen: set[str]) -> set[str]:
        if tag_id in seen or tag_id not in by_id:
            return seen
        seen.add(tag_id)
        for parent in by_id[tag_id].get("parent_ids", []):
            ancestors(parent, seen)
        return seen

    out: dict[str, dict] = {}
    for tag in tags:
        lineage = ancestors(tag["id"], set())
        slugs = set()
        for tag_id in lineage:
            t = by_id[tag_id]
            slugs.add(t["slug"])
            slugs.update(a.replace(" ", "-") for a in t.get("aliases", []))
        label = tag["label"].replace("-", " ")
        for tagging in tag["taggings"]:
            entry = out.setdefault(tagging["oracle_id"], {"labels": set(), "slugs": set()})
            entry["labels"].add(label)
            entry["slugs"].update(slugs)
    return {k: {"labels": sorted(v["labels"]), "slugs": sorted(v["slugs"])} for k, v in out.items()}
