// Text normalisation shared by indexing (Python) and querying. Port of fold() and plain()
// in src/mtgsearch/documents.py; the golden fixture checks the two agree.

/** Lowercase and strip diacritics, so "Lim-Dûl" matches "lim-dul". */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** fold() plus punctuation removal, so "urza's" matches "urzas". */
export function plain(text: string): string {
  return fold(text)
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
