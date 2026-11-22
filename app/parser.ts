// Lexer and recursive-descent parser for Scryfall's search syntax.
//
// fixtures/reference.json is a snapshot of what this and lower.ts produce (see golden.ts).

export class QueryError extends Error {}

/** Valid Scryfall syntax that is not handled yet. The message is shown to the user. */
export class Unsupported extends QueryError {}

export type Keyword = { kind: "keyword"; key: string; op: string; value: string; regex: boolean };
export type Name = { kind: "name"; text: string; exact: boolean };
export type Node =
  | Keyword
  | Name
  | { kind: "not"; child: Node }
  | { kind: "and"; children: Node[] }
  | { kind: "or"; children: Node[] };

type Token = Node | "(" | ")" | "-" | "or";

const SUPPORTED: Record<string, string> = {
  c: "color", color: "color",
  id: "identity", identity: "identity", ci: "identity",
  t: "type", type: "type",
  o: "oracle", oracle: "oracle",
  fo: "fulloracle", fulloracle: "fulloracle",
  kw: "keyword", keyword: "keyword",
  name: "name",
  mv: "manavalue", manavalue: "manavalue", cmc: "manavalue",
  pow: "power", power: "power",
  tou: "toughness", toughness: "toughness",
  pt: "powtou", powtou: "powtou",
  loy: "loyalty", loyalty: "loyalty",
  f: "format", format: "format", legal: "format",
  banned: "banned", restricted: "restricted",
  is: "is", not: "not",
  otag: "otag", oracletag: "otag", function: "otag",
  edhrec: "edhrec", edhrecrank: "edhrec",
  // printing-level: one printing of the card has to satisfy these
  r: "rarity", rarity: "rarity",
  s: "set", e: "set", set: "set", edition: "set",
  st: "settype",
  cn: "number", number: "number",
  a: "artist", artist: "artist",
  ft: "flavor", flavor: "flavor",
  wm: "watermark", watermark: "watermark",
  border: "border", frame: "frame", stamp: "stamp", game: "game",
  year: "year", date: "date",
  usd: "usd", eur: "eur", tix: "tix",
  // true of the card across all its printings
  in: "in", prints: "prints", sets: "sets",
  include: "include", order: "order", sort: "order", direction: "direction", dir: "direction",
  unique: "unique", prefer: "prefer", display: "display",
};

const NOT_YET =
  "m mana devotion produces b block cube new lang language has art atag arttag cheapest " +
  "paperprints papersets illustrations artists";

/** alias -> canonical keyword. A null value means recognised but not implemented yet. */
export const KEYWORDS = new Map<string, string | null>(Object.entries(SUPPORTED));
for (const key of NOT_YET.split(" ")) {
  if (!KEYWORDS.has(key)) KEYWORDS.set(key, null);
}

const KEYWORD_HEAD = /([A-Za-z]+)(!=|<=|>=|:|=|<|>)/y;
const isSpace = (ch: string) => /\s/.test(ch);

/** Read a value starting at q[i]. Returns [text, isRegex, next index]. */
function readValue(q: string, i: number): [string, boolean, number] {
  if (i < q.length && q[i] === '"') {
    const end = q.indexOf('"', i + 1);
    if (end < 0) throw new QueryError("unterminated quote");
    return [q.slice(i + 1, end), false, end + 1];
  }
  if (i < q.length && q[i] === "/") {
    let j = i + 1;
    while (j < q.length && !(q[j] === "/" && q[j - 1] !== "\\")) j++;
    if (j >= q.length) throw new QueryError("unterminated regular expression");
    return [q.slice(i + 1, j).replaceAll("\\/", "/"), true, j + 1];
  }
  let j = i;
  while (j < q.length && !isSpace(q[j]) && q[j] !== "(" && q[j] !== ")") j++;
  return [q.slice(i, j), false, j];
}

function tokens(q: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (isSpace(ch)) {
      i++;
    } else if (ch === "(" || ch === ")") {
      out.push(ch);
      i++;
    } else if (ch === "-" && i + 1 < q.length && !isSpace(q[i + 1])) {
      out.push("-");
      i++;
    } else if (ch === "!" && i + 1 < q.length && !isSpace(q[i + 1])) {
      const [text, , next] = readValue(q, i + 1);
      out.push({ kind: "name", text, exact: true });
      i = next;
    } else {
      KEYWORD_HEAD.lastIndex = i;
      const head = KEYWORD_HEAD.exec(q);
      if (head && KEYWORDS.has(head[1].toLowerCase())) {
        const [value, regex, next] = readValue(q, KEYWORD_HEAD.lastIndex);
        if (value === "") throw new QueryError(`'${head[1]}${head[2]}' needs a value`);
        out.push({ kind: "keyword", key: head[1].toLowerCase(), op: head[2], value, regex });
        i = next;
      } else if (head && ch !== '"') {
        throw new QueryError(`unknown keyword '${head[1]}'`);
      } else {
        const [text, , next] = readValue(q, i);
        if (text === "-") throw new QueryError("'-' must be followed by a term");
        out.push(text.toLowerCase() === "or" && ch !== '"' ? "or" : { kind: "name", text, exact: false });
        i = next;
      }
    }
  }
  return out;
}

/** Parse a query string into an AST. Throws QueryError on malformed input. */
export function parse(query: string): Node {
  const toks = tokens(query);
  let pos = 0;
  const peek = (): Token | undefined => toks[pos];
  const atEnd = (tok: Token | undefined) => tok === undefined || tok === ")" || tok === "or";

  function term(): Node {
    const tok = toks[pos++];
    if (tok === "-") {
      if (atEnd(peek())) throw new QueryError("'-' must be followed by a term");
      return { kind: "not", child: term() };
    }
    if (tok === "(") {
      const node = either();
      if (peek() !== ")") throw new QueryError("missing ')'");
      pos++;
      return node;
    }
    return tok as Node;
  }

  function both(): Node {
    const children: Node[] = [];
    while (!atEnd(peek())) children.push(term());
    return children.length === 1 ? children[0] : { kind: "and", children };
  }

  function either(): Node {
    const children = [both()];
    while (peek() === "or") {
      pos++;
      children.push(both());
    }
    return children.length === 1 ? children[0] : { kind: "or", children };
  }

  const node = either();
  if (pos < toks.length) throw new QueryError("unexpected token");
  return node;
}
