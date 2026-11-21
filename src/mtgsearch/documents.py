"""Turn a Scryfall card object into the document stored in TopK.

One document per Oracle card. A document carries three kinds of field:

* semantic text (`rules`, `rules_tagged`) that TopK embeds for natural-language search;
* normalised filter fields (`type_lc`, `c_sets`, `cmc`, ...) that the Scryfall-syntax compiler targets;
* display fields (`type_line`, `image`, ...) returned to the UI untouched.

Scryfall matches each search condition against every face of a multi-faced card, so the
filter fields keep per-face values where faces differ (colours, power, toughness, loyalty).
"""

import re
import unicodedata

COLORS = "WUBRG"
COLOR_WORDS = {"W": "white", "U": "blue", "B": "black", "R": "red", "G": "green"}
PERMANENT_TYPES = ("artifact", "creature", "enchantment", "land", "planeswalker", "battle")

# Cards Scryfall hides from searches unless `include:extras` is given. The rules below were
# derived by comparing results with Scryfall's API (see conformance/), not from documentation.
EXTRA_LAYOUTS = {"art_series", "token", "double_faced_token", "emblem", "planar", "scheme", "vanguard"}
EXTRA_SET_TYPES = {"memorabilia", "token", "minigame", "vanguard"}
UN_SETS = {"ugl", "unh", "ust", "und", "unf"}
HIDDEN_SET = re.compile(r"hho|h17|unk|phtr|ph\d\d")

# What "~" stands for besides the card's own name: "this creature", "this artifact", ...
SELF_NOUNS = (
    "creature|artifact|enchantment|land|planeswalker|battle|permanent|spell|card|aura|equipment|vehicle|"
    "saga|class|case|room|spacecraft|planet|mount|fortification|token|emblem"
)
_SELF = re.compile(rf"\bthis (?:{SELF_NOUNS})\b")
_REMINDER = re.compile(r"\s*\([^()]*\)")
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
INFINITY = 1_000_000.0


def fold(text: str) -> str:
    """Lowercase and strip diacritics, so 'Lim-Dûl' matches 'lim-dul'."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def plain(text: str) -> str:
    """fold() plus punctuation removal, so "urza's" matches "urzas"."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", fold(text))).strip()


def stat(value: str | None) -> float | None:
    """Numeric value of a power, toughness or loyalty box. Scryfall treats '*' as 0."""
    if value is None:
        return None
    if "∞" in value:
        return INFINITY
    m = _NUMBER.search(value)
    return float(m.group()) if m else 0.0


def color_key(colors) -> str:
    """Canonical name of a colour set: letters in WUBRG order, or "C" for colourless."""
    return "".join(c for c in COLORS if c in colors) or "C"


def type_words(type_line: str) -> list[str]:
    """Lowercased words of a type line, without the dash and face separators."""
    return sorted({w for w in fold(type_line).split() if w not in ("—", "//")})


def is_extra(card: dict) -> bool:
    if card["layout"] in EXTRA_LAYOUTS or card.get("set_type") in EXTRA_SET_TYPES:
        return True
    if (card.get("type_line") or "").startswith("Token"):
        return True
    if any(status != "not_legal" for status in card.get("legalities", {}).values()):
        return False
    # Legal nowhere: hidden if it is a playtest card, a digital-only oddity, or from a promo set.
    code = card.get("set", "")
    playtest = "playtest" in (card.get("promo_types") or []) and code not in UN_SETS
    return playtest or bool(card.get("digital")) or HIDDEN_SET.fullmatch(code) is not None


def _faces(card: dict) -> list[dict]:
    return card.get("card_faces") or [card]


def _first(card: dict, key: str):
    """Top-level value, else the first face that has one."""
    if card.get(key) is not None:
        return card[key]
    for face in _faces(card):
        if face.get(key) is not None:
            return face[key]
    return None


def _values(card: dict, key: str) -> list[float]:
    """Every value of a stat across the card and its faces."""
    raw = [card.get(key)] + [f.get(key) for f in card.get("card_faces", [])]
    return [stat(v) for v in raw if v is not None]


def _flags(card: dict, type_lc: str, oracle: str, full_oracle: str) -> list[str]:
    # Front face (or first half) only: a hybrid symbol on an adventure half does not count.
    layout, cost = card["layout"], (_first(card, "mana_cost") or "").split(" // ")[0]
    front = _faces(card)[0]
    front_type = fold(front.get("type_line") or card.get("type_line") or "")
    power, toughness = stat(_first(card, "power")), stat(_first(card, "toughness"))
    flags = set()
    for name in ("split", "flip", "transform", "meld", "leveler"):
        if layout == name:
            flags.add(name)
    if layout == "modal_dfc":
        flags.add("mdfc")
    if layout in ("transform", "modal_dfc"):
        flags.add("dfc")
    if any(t in front_type for t in PERMANENT_TYPES):
        flags.add("permanent")
    if "land" not in front_type and layout not in EXTRA_LAYOUTS:
        flags.add("spell")
    if "legendary" in type_lc or "artifact" in type_lc or "saga" in type_lc:
        flags.add("historic")
    if "creature" in front_type and not oracle.strip():
        flags.add("vanilla")
    if "creature" in front_type and (power, toughness, card.get("cmc")) == (2.0, 2.0, 2.0):
        flags.add("bear")
    if ("legendary" in front_type and "creature" in front_type) or "can be your commander" in oracle.lower():
        flags.add("commander")
    if re.search(r"\{[^}/]+/[^}P/]+\}", cost):
        flags.add("hybrid")
    if "/P}" in cost or "/P}" in full_oracle:
        flags.add("phyrexian")
    for key, name in (("reserved", "reserved"), ("game_changer", "gamechanger")):
        if card.get(key):
            flags.add(name)
    if card.get("set_type") == "funny" or "playtest" in (card.get("promo_types") or []):
        flags.add("funny")
    return sorted(flags)


def rules_text(card: dict) -> str:
    """Human-readable card text for embedding: name, cost in words, type line, rules."""
    colors = card.get("colors")
    if colors is None:
        colors = sorted({c for f in _faces(card) for c in f.get("colors", [])}, key=COLORS.index)
    color_words = ", ".join(COLOR_WORDS[c] for c in colors) or "colorless"
    cost = card.get("mana_cost") or " // ".join(f.get("mana_cost", "") for f in _faces(card)).strip(" /")
    mana_value = int(card.get("cmc") or 0)
    lines = [card["name"], f"Mana cost {cost or 'none'} (mana value {mana_value}), {color_words}."]
    for face in _faces(card):
        line = face.get("type_line") or card.get("type_line") or ""
        if face.get("power") is not None:
            line += f" {face['power']}/{face['toughness']}"
        if face.get("loyalty"):
            line += f" (loyalty {face['loyalty']})"
        lines.append(line)
        if face.get("oracle_text"):
            lines.append(face["oracle_text"])
    return "\n".join(lines)


def build_document(card: dict, tags: dict | None = None) -> dict:
    """Build the TopK document for one Scryfall card object.

    `tags` is {"labels": [...], "slugs": [...]} for this card's Oracle tags (see tags.py).
    """
    tags = tags or {"labels": [], "slugs": []}
    faces = _faces(card)
    name = card["name"]
    type_line = card.get("type_line") or " // ".join(f.get("type_line", "") for f in faces)
    full_oracle = "\n".join(f["oracle_text"] for f in faces if f.get("oracle_text"))
    oracle = _REMINDER.sub("", full_oracle)

    # "~" stands for the card's own name, or for "this creature" and the like.
    tilde = fold(oracle)
    for face in faces:
        own = face.get("name") or name
        for alias in sorted({own, own.split(",")[0]}, key=len, reverse=True):
            tilde = tilde.replace(fold(alias), "~")
    tilde = _SELF.sub("~", tilde)

    # Colours are per face when the faces differ (transforming and modal double-faced cards).
    if card.get("colors") is not None:
        color_sets = [color_key(card["colors"])]
    else:
        color_sets = sorted({color_key(f.get("colors", [])) for f in faces})

    # Power and toughness match on any face. Scryfall also compares them across faces:
    # `pow>tou` holds when some face's power exceeds some face's toughness.
    relations = set()
    for p in _values(card, "power"):
        for t in _values(card, "toughness"):
            relations.add("pow>tou" if p > t else "pow<tou" if p < t else "pow=tou")
    front_p, front_t = stat(faces[0].get("power")), stat(faces[0].get("toughness"))

    legal = card.get("legalities", {})
    text = rules_text(card)
    image = (card.get("image_uris") or faces[0].get("image_uris") or {}).get("normal")
    usd = (card.get("prices") or {}).get("usd")

    doc = {
        "_id": card["oracle_id"],
        "name": name,
        # semantic text
        "rules": text,
        "rules_tagged": text + ("\nTags: " + ", ".join(tags["labels"]) if tags["labels"] else ""),
        # filter fields
        "name_lc": fold(name),
        "name_plain": plain(name),
        "names_lc": sorted({fold(name)} | {fold(f["name"]) for f in faces if f.get("name")}),
        "type_lc": fold(type_line),
        "type_words": type_words(type_line),
        "oracle_lc": fold(oracle),
        "oracle_tilde_lc": tilde,
        "fulloracle_lc": fold(full_oracle),
        "keywords_lc": [fold(k) for k in card.get("keywords", [])],
        "cmc": float(card.get("cmc") or 0),
        "cmc_even": int(card.get("cmc") or 0) % 2 == 0,
        "c_sets": color_sets,
        "id_sets": [color_key(card.get("color_identity", []))],
        "stat_rel": sorted(relations),
        "pt_num": front_p + front_t if front_p is not None and front_t is not None else None,
        "legal": sorted(f for f, s in legal.items() if s in ("legal", "restricted")),
        "banned": sorted(f for f, s in legal.items() if s == "banned"),
        "restricted": sorted(f for f, s in legal.items() if s == "restricted"),
        "flags": _flags(card, fold(type_line), oracle, full_oracle),
        "otags": tags["slugs"],
        "extra": is_extra(card),
        "edhrec_rank": card.get("edhrec_rank"),
        # display fields
        "mana_cost": _first(card, "mana_cost") or "",
        "type_line": type_line,
        "oracle_text": full_oracle,
        "image": image,
        "scryfall_uri": card["scryfall_uri"].split("?")[0],
        "artist": card.get("artist"),
        "set": card.get("set"),
        "rarity": card.get("rarity"),
        "usd": float(usd) if usd else None,
    }
    for key, prefix in (("power", "pow"), ("toughness", "tou"), ("loyalty", "loy")):
        values = _values(card, key)
        if values:
            doc[f"{prefix}_min"], doc[f"{prefix}_max"] = min(values), max(values)
    # TopK types an empty list as list<f32>, which a list<text> field rejects; drop empties and nulls.
    return {k: v for k, v in doc.items() if v is not None and v != []}
