"""Card text for embedding, with the game's symbols and numbers said in words.

The live index sends a card's cost and rules as printed: `{T}: Add {C}{C}.` and `deals 3
damage`. This module is the trial's other wordings of the same text. Nothing here chooses
words for particular searches: it is a fixed reading of the game's notation (Scryfall's
symbology), applied to every card alike.

    spell(text)           every run of symbols in braces, in words
    with_numbers(text)    every small standalone number followed by its word
    cost_line(card, ...)  the line that says what the card costs
"""

import re

NUMBERS = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty"
).split()
COLOURS = {"W": "white", "U": "blue", "B": "black", "R": "red", "G": "green", "C": "colorless", "S": "snow"}
# Symbols that are not mana: what a player calls each.
OTHER = {"T": "tap", "Q": "untap", "E": "energy", "CHAOS": "chaos", "TK": "ticket", "A": "acorn", "P": "pawprint"}
RUN = re.compile(r"(?:\{[^{}]+\})+")
SYMBOL = re.compile(r"\{([^{}]+)\}")
# A number on its own: not part of +1/+1, 2/2, 10-19, a mana symbol or a word.
NUMBER = re.compile(r"(?<![\w/+\-−–—{.])(\d{1,2})(?![\w/}\-−–—.]|,\d)")


def number(n: int) -> str:
    return NUMBERS[n] if 0 <= n < len(NUMBERS) else str(n)


def _mana(symbol: str) -> str | None:
    """One mana symbol as an adjective for 'mana', or None if it is not mana."""
    if symbol in COLOURS:
        return COLOURS[symbol]
    if "/" in symbol:
        parts = symbol.split("/")
        colours = [COLOURS.get(p, p) for p in parts if p != "P" and not p.isdigit()]
        instead = [f"{number(int(p))} generic" for p in parts if p.isdigit()] + (["two life"] if "P" in parts else [])
        return " or ".join(colours) + (f" (or {' or '.join(instead)})" if instead else "")
    return None


def _run(symbols: list[str]) -> str:
    """A run of symbols, e.g. ["2", "G", "G"], as 'two generic and two green mana'."""
    generic = 0
    variable: list[str] = []
    mana: dict[str, int] = {}
    others: dict[str, int] = {}
    unknown: list[str] = []
    for symbol in symbols:
        if symbol.isdigit():
            generic += int(symbol)
        elif symbol in ("X", "Y", "Z"):
            variable.append(symbol)
        elif (kind := _mana(symbol)) is not None:
            mana[kind] = mana.get(kind, 0) + 1
        elif symbol in OTHER:
            others[OTHER[symbol]] = others.get(OTHER[symbol], 0) + 1
        else:
            unknown.append("{" + symbol + "}")
    parts = [*variable]
    if generic or (not mana and not variable and not others and not unknown and symbols):
        parts.append(f"{number(generic)} generic")
    parts += [f"{number(count)} {kind}" for kind, count in mana.items()]
    said = []
    if parts:
        said.append(" and ".join(parts) + " mana")
    for kind, count in others.items():
        said.append(kind if count == 1 and kind in ("tap", "untap") else f"{number(count)} {kind}")
    return ", ".join(said + unknown)


def spell(text: str) -> str:
    """`text` with every run of symbols said in words; a sentence that begins with one is capitalised."""

    def said(match: re.Match) -> str:
        words = _run(SYMBOL.findall(match.group(0)))
        start = match.start()
        opens = start == 0 or text[start - 1] == "\n" or text[max(0, start - 2) : start] in (". ", "— ", "• ")
        return words[:1].upper() + words[1:] if opens else words

    return RUN.sub(said, text)


def with_numbers(text: str) -> str:
    """`text` with each small standalone number followed by its word: 'deals 3 (three) damage'."""
    return NUMBER.sub(lambda m: f"{m.group(1)} ({number(int(m.group(1)))})" if int(m.group(1)) < len(NUMBERS) else m.group(1), text)


def cost_line(cost: str, mana_value: int, colour_words: str) -> str:
    """What the card costs, in words: 'Costs two mana: one generic and one red (mana value 2), red.'"""
    if not cost:
        return f"Costs no mana (mana value {mana_value}), {colour_words}."
    faces = [(lambda said: said[:1].lower() + said[1:])(spell(part).strip()) for part in cost.split(" // ")]
    return f"Costs {number(mana_value)} mana: {' // '.join(faces)} (mana value {mana_value}), {colour_words}."
