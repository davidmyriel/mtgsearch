"""Turn a Scryfall card object into the document stored in TopK.

One document per Oracle card (printings.py builds one per printing on top of this). A
document carries three kinds of field:

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
HIDDEN_SET = re.compile(r"hho|h17|unk|phtr|ph\d\d|ulst")
# Digital games other than Magic Online and Arena (a 1997 PC game and a Dreamcast game).
OTHER_GAMES = {"astral", "sega"}
# Type lines of game aids that are printed like cards but are not cards.
GAME_AIDS = {"Card", "Stickers"}

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


def price(prices: dict, *keys: str) -> float | None:
    """The first listed price among `keys`: the regular price, else the foil one."""
    for key in keys:
        if prices.get(key):
            return float(prices[key])
    return None


_SYMBOL = re.compile(r"\{([^}]+)\}")
# Mana costs are compared per part: each half of a split card, each face with a cost.
MAX_COST_PARTS = 2
NO_COST = "none"


def parse_cost(cost: str) -> tuple[int, list[str]]:
    """A mana cost as (generic amount, sorted other symbols). "{2}{W}{W}" -> (2, ["W", "W"]).

    Hybrid symbols are written with their halves in alphabetical order, so {R/W} and {W/R}
    are the same symbol.
    """
    generic, symbols = 0, []
    for symbol in _SYMBOL.findall(cost):
        if symbol.isdigit():
            generic += int(symbol)
        else:
            symbols.append("/".join(sorted(symbol.upper().split("/"))))
    return generic, sorted(symbols)


def cost_key(generic: int, symbols: list[str]) -> str:
    """Canonical text of a cost, for exact comparison."""
    return f"{generic}|{','.join(symbols)}"


def cost_parts(card: dict) -> list[str]:
    """The card's mana costs: both halves of a split card, every face that has one."""
    costs = [card.get("mana_cost") or ""] + [f.get("mana_cost") or "" for f in card.get("card_faces", [])]
    parts: list[str] = []
    for cost in costs:
        for part in cost.split(" // "):
            if part and part not in parts:
                parts.append(part)
    return parts[:MAX_COST_PARTS]


def mana_fields(card: dict) -> dict:
    """Fields behind `m:`, `devotion:` and `produces:`.

    Per cost part N: `mN_key` (the whole cost, for =), `mN_gen` (generic mana, for comparisons)
    and, in `m_syms`, one token "N:W:2" for each symbol it has at least that many of.
    Devotion counts the coloured symbols of a permanent's first part: `dev_W` for one colour,
    and `dev_WU` for devotion to two colours, where a symbol of either colour counts once.
    """
    parts = cost_parts(card)
    fields: dict = {"m_syms": []}
    for n, part in enumerate(parts):
        generic, symbols = parse_cost(part)
        fields[f"m{n}_key"] = cost_key(generic, symbols)
        fields[f"m{n}_gen"] = generic
        for symbol in sorted(set(symbols)):
            fields["m_syms"] += [f"{n}:{symbol}:{i}" for i in range(1, symbols.count(symbol) + 1)]
    front = (card.get("card_faces") or [card])[0]
    front_type = fold(front.get("type_line") or card.get("type_line") or "")
    if not parts:
        fields["m0_key"] = NO_COST
    elif any(t in front_type for t in PERMANENT_TYPES):
        # Only permanents have devotion: an instant's symbols never count.
        halves = [set(symbol.split("/")) for symbol in parse_cost(parts[0])[1]]
        for i, first in enumerate(COLORS):
            fields[f"dev_{first}"] = sum(first in half for half in halves)
            for second in COLORS[i + 1 :]:
                fields[f"dev_{first}{second}"] = sum(bool({first, second} & half) for half in halves)
    produced = [c for c in COLORS + "C" if c in (card.get("produced_mana") or [])]
    fields["produces"] = produced
    fields["produces_n"] = len(produced)
    # Zero counts are left out: a missing value reads as zero in the compiler.
    return {k: v for k, v in fields.items() if v not in (0, []) or k.endswith("_gen")}


def color_key(colors) -> str:
    """Canonical name of a colour set: letters in WUBRG order, or "C" for colourless."""
    return "".join(c for c in COLORS if c in colors) or "C"


def type_words(type_line: str) -> list[str]:
    """Lowercased words of a type line, without the dash and face separators."""
    return sorted({w for w in fold(type_line).split() if w not in ("—", "//")})


def is_extra(card: dict) -> bool:
    type_line = card.get("type_line") or ""
    # Dungeons are printed in token sets, some as double-faced tokens, but Scryfall shows them.
    dungeon = type_line.startswith("Dungeon") and card.get("set_type") == "token"
    if not dungeon and (
        card["layout"] in EXTRA_LAYOUTS
        or card.get("set_type") in EXTRA_SET_TYPES
        or type_line.startswith("Token")
    ):
        return True
    # Cards Wizards removed for offensive content, and cards from other video games.
    if card.get("content_warning") or (card.get("games") and set(card["games"]) <= OTHER_GAMES):
        return True
    if any(status != "not_legal" for status in card.get("legalities", {}).values()):
        return False
    # Legal nowhere. Un-set cards in their own sets and brand-new cards are shown; hidden are
    # playtest cards, digital-only oddities, a few promo sets, and outside the Un-sets: promo
    # printings of Un-cards, posters and game aids.
    code, promo_types = card.get("set", ""), card.get("promo_types") or []
    if bool(card.get("digital")) or HIDDEN_SET.fullmatch(code) is not None:
        return True
    if code in UN_SETS:
        return False
    return (
        "playtest" in promo_types
        or "poster" in promo_types
        or card.get("set_type") == "promo"
        or type_line in GAME_AIDS
    )


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
    # Legendary creatures, and since the 2025 rules change legendary Vehicles and Spacecraft;
    # Scryfall also counts Backgrounds, which share the command zone.
    leads = ("creature", "vehicle", "spacecraft", "background")
    if ("legendary" in front_type and any(t in front_type for t in leads)) or (
        "can be your commander" in oracle.lower()
    ):
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
    if "creature" in front_type and _only_keywords(oracle, card.get("keywords", [])):
        flags.add("frenchvanilla")
    return sorted(flags)


def _only_keywords(oracle: str, keywords: list[str]) -> bool:
    """Whether a card's rules text (reminder text removed) is nothing but keyword abilities.

    "Flying, vigilance" and "Protection from black\nCycling {2}" are; a card with no text at
    all is plain vanilla, not French vanilla.
    """
    names = [fold(k) for k in keywords]
    items = [item.strip() for item in re.split(r"[\n,;]", fold(oracle)) if item.strip()]
    if not items:
        return False
    return all(any(item == k or item.startswith((k + " ", k + "—")) for k in names) for item in items)


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


def build_document(card: dict, tags: dict | None = None, aggregate: dict | None = None) -> dict:
    """Build the TopK document for one Scryfall card object.

    `tags` is {"labels": [...], "slugs": [...]} for this card's Oracle tags (see tags.py).
    `aggregate` holds what is true across all of the card's printings (see printings.py).
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
        "layout": card["layout"],
        "otags": tags["slugs"],
        **mana_fields(card),
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
        "set_name": card.get("set_name"),
        "cn": card.get("collector_number"),
        "released": card.get("released_at"),
        "rarity": card.get("rarity"),
        "usd": price(card.get("prices") or {}, "usd", "usd_foil", "usd_etched"),
        **(aggregate or {}),
    }
    for key, prefix in (("power", "pow"), ("toughness", "tou"), ("loyalty", "loy")):
        values = _values(card, key)
        if values:
            doc[f"{prefix}_min"], doc[f"{prefix}_max"] = min(values), max(values)
    # TopK types an empty list as list<f32>, which a list<text> field rejects; drop empties and nulls.
    return {k: v for k, v in doc.items() if v is not None and v != []}
