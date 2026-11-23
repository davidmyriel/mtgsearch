"""Draw the site's name, TUTORK, in the blocks of TopK's logo.

    python tools/make_wordmark.py

writes two pictures into public/:

    wordmark.svg         the name, still
    wordmark-appear.svg  the same squares, materializing from left to right

TopK's logo (docs/logo/topk.svg in TopK's repository) spells TOPK in squares of 100 with a gap
of 15 between them and 88 between letters, five rows tall; TOP is neutral and K is orange.
T, O and K below are TopK's letters; U and R are drawn to match (R is TopK's P with K's
lower arm). The header is dark on every page, so the neutral letters are light.

The moving picture uses SVG's own animation elements, not a stylesheet or a script: it is
shown through an <img>, where neither would run under the site's Content-Security-Policy.
A browser that does not animate shows every square at once.
"""

from pathlib import Path

LETTERS = {
    "T": ["#####", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#..#", "#..#", "#..#", "#..#", "####"],
    "O": ["####", "#..#", "#..#", "#..#", "####"],
    "R": ["####", "#..#", "####", "#.#.", "#..#"],
    "K": ["#..#", "#.#.", "##..", "#.#.", "#..#"],
}
WORD, IN_ORANGE = "TUTORK", "K"
BLOCK, PITCH, BETWEEN = 100, 115, 88
NEUTRAL, ORANGE = "#f4efe6", "#fe5000"
MADE_BY = "Made by tools/make_wordmark.py."

# The animation: columns appear one after another from the left, the squares of a column
# not quite together, each fading in.
PER_COLUMN, JITTER, FADE = 0.034, 0.014, 0.16


def squares() -> list[tuple[int, int, int, int, str]]:
    """Every square as (x, y, column across the whole word, row, colour)."""
    found = []
    x = column = 0
    for index, letter in enumerate(WORD):
        rows = LETTERS[letter]
        colour = ORANGE if index >= len(WORD) - len(IN_ORANGE) else NEUTRAL
        for c in range(len(rows[0])):
            for r, row in enumerate(rows):
                if row[c] == "#":
                    found.append((x + c * PITCH, r * PITCH, column + c, r, colour))
        x += (len(rows[0]) - 1) * PITCH + BLOCK + BETWEEN
        column += len(rows[0])
    return found


def size() -> tuple[int, int]:
    widths = [(len(LETTERS[letter][0]) - 1) * PITCH + BLOCK for letter in WORD]
    return sum(widths) + BETWEEN * (len(WORD) - 1), 4 * PITCH + BLOCK


def opening(note: str) -> str:
    width, height = size()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width // 10}" height="{height // 10}">\n  <!-- {note} -->\n'
    )


def still() -> str:
    out = opening("TUTORK in the blocks of TopK's logo; the K is TopK's orange. " + MADE_BY)
    for colour in (NEUTRAL, ORANGE):
        d = "".join(f"M{x} {y}h{BLOCK}v{BLOCK}h-{BLOCK}z" for x, y, _, _, c in squares() if c == colour)
        out += f'  <path fill="{colour}" d="{d}"/>\n'
    return out + "</svg>\n"


def delay(column: int, row: int) -> float:
    return round(column * PER_COLUMN + ((row * 37 + column * 17) % 5) * JITTER, 3)


def appearing() -> str:
    out = opening("wordmark.svg, its squares materializing from left to right. " + MADE_BY)
    for x, y, column, row, colour in squares():
        wait = delay(column, row)
        total = round(wait + FADE, 3)
        # invisible until its turn, then fading in; the values hold from the first instant
        out += (
            f'  <rect x="{x}" y="{y}" width="{BLOCK}" height="{BLOCK}" fill="{colour}">'
            f'<animate attributeName="opacity" values="0;0;1" keyTimes="0;{wait / total:.4f};1" '
            f'dur="{total}s" fill="freeze"/></rect>\n'
        )
    return out + "</svg>\n"


if __name__ == "__main__":
    public = Path(__file__).resolve().parent.parent / "public"
    (public / "wordmark.svg").write_text(still())
    (public / "wordmark-appear.svg").write_text(appearing())
