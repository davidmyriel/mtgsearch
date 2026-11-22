# mtgsearch (working name)

Card search for Magic: The Gathering that accepts Scryfall's query syntax and also plain
English, built on [TopK](https://topk.io).

```text
c:u t:sphinx o:"draw two cards"          Scryfall syntax: the same three cards Scryfall returns
sphinx that draws two cards              plain English: Consecrated Sphinx first
c:u t:sphinx draws when opponents draw   both at once: keywords filter, words rank by meaning
lightning bolt                           a card name: name matches, most-played first
```

Status: working search with a thin web app, ready to deploy on Netlify. See
[docs/PLAN.md](docs/PLAN.md) for stages and what is next.

## How it is put together

| Part | Language | Where | What it does |
|---|---|---|---|
| Search app | TypeScript | `app/`, `netlify/functions/`, `public/` | Everything that answers a search: the query compiler, plain-English filters, ranking, the HTTP endpoint and the page |
| Ingest job | Python | `src/mtgsearch/` | Builds the TopK collection from Scryfall's bulk files, once a day |

Each piece of logic exists once. The ingest job is Python because TopK's JavaScript SDK sends
whole numbers as integers, which the collection's decimal fields (mana value, power) reject.
The two halves meet at the collection: `fixtures/documents.json` holds documents the ingest
job builds for a small card set, the app's tests run against that file, and a Python test
fails if the file no longer matches the document builder.

One TopK collection holds one document per Oracle card (39,412 cards). Each document has:

- **semantic text**, embedded by TopK's `semantic_index()`: the card's name, cost, type and rules
  (`rules`), and the same with Scryfall's community tags appended (`rules_tagged`);
- **filter fields** the syntax compiler targets: colour sets per face, type words, mana value,
  power and toughness ranges, legalities, flags;
- **display fields**: type line, rules text, image URL, Scryfall link.

A query takes one of four paths (`app/search.ts`):

| The query is | What happens |
|---|---|
| Scryfall syntax (a keyword, `!exact name`, a regex) | Compiled to a TopK filter; returns exactly the matching cards |
| Plain words that match card names | Those cards, most-played first |
| Keywords plus words that match no name | Keywords become the filter; the words rank by meaning |
| Anything else | Semantic search; mana value, colour and type are read from the opening words and applied as filters |

The compiler (`app/parser.ts`, `app/lower.ts`) parses a query to an AST and lowers it to a
small predicate IR. TopK runs the predicates in production (`toTopk` in `app/search.ts`);
`app/evaluate.ts` runs the same predicates in plain TypeScript, so keyword semantics are
unit-tested without a network.

## Results so far

Measured on 22 November 2026 against the full card set. Raw output is in `conformance/` and `eval/`.

**Syntax conformance** (same query on Scryfall's API and on ours; pass means identical card sets):

| Query set | Result |
|---|---|
| Tuning set, 97 queries (rules were tuned on these) | 97 match |
| Held-out set, 77 queries, first run, untuned | 74 match |

**Relevance** (frozen query set; an accepted card's rank):

| Strategy | 15 descriptive: first / top 3 / top 10 | 8 numeric: first / top 3 / top 10 | 8 jargon: correct in top 5, of 40 |
|---|---|---|---|
| Keyword match (BM25) | 1 / 2 / 5 | 2 / 2 / 2 | 11 |
| Semantic, rules text | 8 / 10 / 11 | 4 / 6 / 7 | 20 |
| Semantic, rules text + tags | 8 / 10 / 11 | 2 / 4 / 6 | 35 |
| Sum of both semantic scores | 8 / 10 / 11 | 2 / 6 / 8 | 29 |
| Full pipeline (`search`) | 9 / 13 / 14 | 5 / 7 / 8 | 29 |

Median client-side latency per query, network included: 39 ms keyword, 123 ms semantic, 245 ms full pipeline.

Read these with care:

- The query set is small (31 queries) and its accepted answers come from one person's card
  knowledge. It needs to grow to about 150 and get a second reviewer before it gates a release.
- The pipeline's choices (summing both fields, the filter rules) were made while looking at
  this same set.
- Jargon grading uses the community tags as ground truth, and those tags are also in the
  indexed text, so the tag-based rows are partly circular.
- Art search is not measured here: the full set's art is not indexed yet. On a 1,489-card
  sample, 12 of 12 art descriptions ranked the right card first (`experiments/spike/`).

## Supported Scryfall syntax

| Supported | Not yet (reported as unsupported, never silently ignored) |
|---|---|
| Card names, `!exact`, `name:`, `-negation`, `or`, parentheses, regex on name, type and text | Everything about a printing: `set:`, `rarity:`, `artist:`, `flavor:`, prices, `frame:`, `border:`, `game:`, `year:`, `lang:`, `in:`, `unique:prints` |
| `c:` `id:` with every comparison, colour names, guilds, shards, wedges, counts | Mana cost symbols: `m:`, `devotion:`, `produces:` |
| `t:` `o:` `fo:` `kw:` including `~` | Land-cycle shortcuts such as `is:fetchland`; art tags (`art:`) |
| `mv` `pow` `tou` `pt` `loy`, `pow>tou`, `mv:even` | Scryfall's `\spp`, `\smm`, `\spt` regex shorthands |
| `f:` `banned:` `restricted:`, `edhrec`, `otag:` / `function:` | `order:` by price, rarity, set or release date |
| `is:` split, flip, transform, meld, leveler, mdfc, dfc, permanent, spell, historic, vanilla, bear, commander, hybrid, phyrexian, reserved, gamechanger, funny | |
| `include:extras`, `order:` name, cmc, power, toughness, edhrec; `direction:` | |

Known differences from Scryfall are listed with reasons in `conformance/known_gaps.txt`.

## Running the app

Needs Node 22.18 or later and a TopK API key for a project that holds the collection.

```bash
npm ci
```

```bash
cp .env.example .env
```

Put your key in `.env` and export it (`set -a; . ./.env; set +a`). Then:

```bash
npm run dev
```

Open http://127.0.0.1:8000. The page (`public/`) is one responsive view over one endpoint,
`GET /api/search?q=...`, and works the same on a phone and a laptop. The key stays on the
server. To run a single query from the terminal:

```bash
npm run search -- "sphinx that draws two cards"
```

## Deploying on Netlify

1. In Netlify, add a new project from this Git repository. `netlify.toml` already sets the
   publish directory, the function and the headers; leave the build command empty.
2. Under Project configuration > Environment variables, add `TOPK_API_KEY`. On plans that ask
   for a scope, include Functions. `TOPK_REGION` and `MTGSEARCH_COLLECTION` are optional.
3. Deploy. Changing a variable needs a new deploy to take effect.

The endpoint is public and plain-English queries cost an inference call, so queries are capped
at 200 characters, successful answers are cached at Netlify's CDN for ten minutes, and the
function declares a limit of 30 requests a minute per client. To check a deployment:

```bash
node e2e/smoke.cjs https://your-site.netlify.app
```

To run the site locally the way Netlify serves it:

```bash
npx netlify-cli dev --offline
```

## Building the collection

Needs Python 3.10 or later. This is only required to create the collection or refresh it;
the nightly workflow does the refresh.

```bash
pip install -e ".[dev]"
```

```bash
mtgsearch ingest
```

That downloads Scryfall's bulk files into `data/` and brings the collection up to date. It
compares today's cards with what the collection already holds: new or changed cards are sent
in full, cards whose popularity rank or price moved get a small field update, and everything
else is left alone. A first run takes about three minutes; a daily run takes under a minute
and re-embeds a few dozen cards.

Collections are versioned (`mtg-cards-v2`). To change the schema, set `MTGSEARCH_COLLECTION`
to the next version and ingest; never delete and recreate a collection under the same name.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Serve the page and the search endpoint locally |
| `npm run search -- "<query>"` | Run one query |
| `npm test` | App tests: keyword semantics, the compiler snapshot, the HTTP contract, the page; live tests when `TOPK_API_KEY` is set |
| `npm run typecheck` | Type-check the TypeScript |
| `npm run golden` | Rewrite the compiler snapshot, `fixtures/reference.json`, after an intended change in behaviour |
| `npm run conformance [-- <file>]` | Compare syntax queries with Scryfall's API |
| `npm run eval` | Score the ranking strategies on `eval/queries.json` |
| `node e2e/smoke.cjs <url>` | Drive the running app in a browser at phone and laptop sizes (needs Playwright) |
| `mtgsearch ingest [--dry-run] [--full]` | Refresh the collection from Scryfall's bulk data |
| `mtgsearch catalog` | Regenerate `app/type-words.json` after new sets add card types |
| `pytest` | Ingest job tests, no network |

## Data and attribution

Card data and images come from [Scryfall](https://scryfall.com/docs/api) bulk files and remain
the property of Wizards of the Coast. This project is not produced or endorsed by Scryfall or
Wizards of the Coast. Scryfall's terms require that a project built on their data adds value
rather than repackaging it, is not paywalled, and does not crop or alter card images. Read
those terms and Wizards' Fan Content Policy before launching anything public.
