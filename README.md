# mtg-search (working name)

Card search for Magic: The Gathering that accepts Scryfall's query syntax and also plain
English, built on [TopK](https://topk.io).

```text
c:u t:sphinx o:"draw two cards"          Scryfall syntax: the same three cards Scryfall returns
sphinx that draws two cards              plain English: Consecrated Sphinx first
c:u t:sphinx draws when opponents draw   both at once: keywords filter, words rank by meaning
lightning bolt                           a card name: name matches, most-played first
```

Status: backend only, no web app yet. See [docs/PLAN.md](docs/PLAN.md) for stages and what is next.

## How it works

One TopK collection holds one document per Oracle card (39,356 cards). Each document has:

- **semantic text**, embedded by TopK's `semantic_index()`: the card's name, cost, type and rules
  (`rules`), and the same with Scryfall's community tags appended (`rules_tagged`);
- **filter fields** the syntax compiler targets: colour sets per face, type words, mana value,
  power and toughness ranges, legalities, flags;
- **display fields**: type line, rules text, image URL, Scryfall link.

A query takes one of four paths (`src/mtgsearch/search.py`):

| The query is | What happens |
|---|---|
| Scryfall syntax (a keyword, `!exact name`, a regex) | Compiled to a TopK filter; returns exactly the matching cards |
| Plain words that match card names | Those cards, most-played first |
| Keywords plus words that match no name | Keywords become the filter; the words rank by meaning |
| Anything else | Semantic search; mana value, colour and type are read from the opening words and applied as filters |

The syntax compiler (`src/mtgsearch/syntax/`) parses a query to an AST and lowers it to a small
predicate IR. Two backends interpret the IR: TopK filter expressions, and a pure-Python
evaluator that the unit tests use, so keyword semantics are tested without a network.

## Results so far

Measured on 21 November 2026 against the full card set. Raw output is in `conformance/` and `eval/`.

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

Median client-side latency per query, network included: 35 ms keyword, 89 ms semantic, 179 ms full pipeline.

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

## Setup

```bash
pip install -e ".[dev]"
```

```bash
cp .env.example .env
```

Put your TopK API key in `.env` and export it (`set -a; . ./.env; set +a`). Then:

```bash
mtgsearch ingest
```

That downloads Scryfall's bulk files into `data/` and indexes every card (about three minutes
the first time; later runs only re-send cards that changed).

```bash
mtgsearch search "sphinx that draws two cards"
```

## Commands

| Command | Purpose |
|---|---|
| `mtgsearch ingest [--dry-run] [--full]` | Refresh the collection from Scryfall's bulk data |
| `mtgsearch catalog` | Regenerate the type-word catalogue after new sets add types |
| `mtgsearch search "<query>"` | Run one query |
| `mtgsearch conformance [file]` | Compare syntax queries with Scryfall's API |
| `mtgsearch eval` | Score the ranking strategies on `eval/queries.json` |
| `pytest` | Unit tests, no network |
| `pytest -m integration` | Tests against the live collection (needs `TOPK_API_KEY`) |

Collections are versioned (`mtg-cards-v2`). To change the schema, set `MTGSEARCH_COLLECTION`
to the next version and ingest; never delete and recreate a collection under the same name.

## Data and attribution

Card data and images come from [Scryfall](https://scryfall.com/docs/api) bulk files and remain
the property of Wizards of the Coast. This project is not produced or endorsed by Scryfall or
Wizards of the Coast. Scryfall's terms require that a project built on their data adds value
rather than repackaging it, is not paywalled, and does not crop or alter card images. Read
those terms and Wizards' Fan Content Policy before launching anything public.
