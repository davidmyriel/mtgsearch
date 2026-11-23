# mtgsearch (working name)

Card search for Magic: The Gathering that accepts Scryfall's query syntax and also plain
English, built on [TopK](https://topk.io).

The site itself is titled **Scry Deeper**; `mtgsearch` remains the name of the project, the
package and the repository.

```text
c:u t:sphinx o:"draw two cards"          Scryfall syntax: the same three cards Scryfall returns
sphinx that draws two cards              plain English: Consecrated Sphinx first
c:u t:sphinx draws when opponents draw   both at once: keywords filter, words rank by meaning
lightning bolt                           a card name: name matches, most-played first
t:dragon r:mythic usd<5                  printings: set, rarity, artist, price, frame, date
!"lightning bolt" unique:prints          every printing of a card
```

Status: working search over cards and printings with a thin web app, deployed on Netlify. See
[docs/PLAN.md](docs/PLAN.md) for stages and what is next.

## How it is put together

| Part | Language | Where | What it does |
|---|---|---|---|
| Search app | TypeScript | `app/`, `netlify/functions/`, `public/` | Everything that answers a search: the query compiler, plain-English filters, ranking, the HTTP endpoint and the page |
| Ingest job | Python | `src/mtgsearch/` | Builds the two TopK collections from Scryfall's bulk files, once a day |

Each piece of logic exists once. The ingest job is Python because TopK's JavaScript SDK sends
whole numbers as integers, which the collection's decimal fields (mana value, power) reject.
The two halves meet at the collections: `fixtures/documents.json` and `fixtures/printings.json`
hold documents the ingest job builds for a small card set, the app's tests run against those
files, and a Python test fails if they no longer match the document builders.

There are two TopK collections:

| Collection | One document per | Count | Answers |
|---|---|---|---|
| `mtg-cards-v2` | Oracle card | 39,412 | Plain English, card names, and syntax about the card itself |
| `mtg-printings-v1` | printing (a card in one set) | 120,275 | Anything about a printing: set, rarity, artist, frame, date, price |

A card document has:

- **semantic text**, embedded by TopK's `semantic_index()`: the card's name, cost, type and rules
  (`rules`), and the same with Scryfall's community tags appended (`rules_tagged`);
- **filter fields** the syntax compiler targets: colour sets per face, type words, mana value,
  power and toughness ranges, legalities, flags, and what is true across the card's printings
  (the sets, rarities and games it has appeared in);
- **display fields**: type line, rules text, image URL, Scryfall link.

A printing document has no embeddings. It carries every filter field of its card plus its own
set, collector number, rarity, artist, flavour text, frame, border, games, release date and
prices, so a query that mixes card and printing conditions (`t:sphinx set:ima r:mythic`) is one
filter on one collection, with no join.

A query takes one of four paths (`app/search.ts`):

| The query is | What happens |
|---|---|
| Scryfall syntax (a keyword, `!exact name`, a regex) | Compiled to a TopK filter; returns exactly the matching cards |
| Plain words that match card names | Those cards, most-played first |
| Keywords plus words that match no name | Keywords become the filter; the words rank by meaning |
| Anything else | Semantic search; mana value, colour and type are read from the opening words and applied as filters |

Syntax that mentions a printing runs on the printings collection. Scryfall's rule is that a
card matches when one of its printings satisfies the whole query, and the card is shown by
that printing. One TopK `group_by` over the matching printings returns each card, its sort
key and which printing to show; a second query fetches those printings for the page.
`unique:prints` skips the grouping and lists printings. When printing keywords are mixed
with plain words, the matching cards are found first and then ranked by meaning in the
cards collection, where the embeddings are.

The compiler (`app/parser.ts`, `app/lower.ts`) parses a query to an AST and lowers it to a
small predicate IR. TopK runs the predicates in production (`toTopk` in `app/search.ts`);
`app/evaluate.ts` runs the same predicates in plain TypeScript, so keyword semantics are
unit-tested without a network.

## Results so far

Measured on 22 November 2026 against the full card set. Raw output is in `conformance/` and `eval/`.

**Syntax conformance** (same query on Scryfall's API and on ours; pass means identical result sets):

| Query set | First run, untuned | Now |
|---|---|---|
| Card-level tuning set, 97 queries (rules were tuned on these) | | 97 match |
| Card-level held-out set, 77 queries | 74 match | 77 match |
| Printing tuning set, 75 queries, plus 4 price queries | 75 of 79 | 79 match |
| Printing held-out set, 61 queries | 53 match | 59 match |
| Mana tuning set, 58 queries | | 58 match |
| Mana held-out set, 22 queries | 18 match | 19 match |
| `is:` shortcuts, 54 queries (land cycles, party, modal and so on) | 35 of 49 | 54 match |
| Second held-out set, 54 queries across all of the above | 52 match | 52 match |
| Regex shorthands tuning set, 16 queries (`\spp`, `\smr` and so on) | | 16 match |

The first-run column is the honest measure of how well the rules generalise; the earlier
held-out sets have since been used to fix rules, so they are no longer untouched. The second
held-out set was written after every rule was fixed and has not been tuned on: 52 of 54 (96%),
and both misses belong to differences already listed as known gaps. Differences that
remain are listed with reasons in `conformance/known_gaps.txt`.

The nightly run repeats all of it. A tuning set must match in full. A held-out set is compared
with its saved run (`--baseline`), and fails only if a query that matched then no longer does.

**Relevance** (frozen query set; an accepted card's rank):

| Strategy | 15 descriptive: first / top 3 / top 10 | 8 numeric: first / top 3 / top 10 | 8 jargon: correct in top 5, of 40 |
|---|---|---|---|
| Keyword match (BM25) | 1 / 2 / 5 | 2 / 2 / 2 | 11 |
| Semantic, rules text | 8 / 10 / 11 | 4 / 6 / 7 | 20 |
| Semantic, rules text + tags | 8 / 10 / 11 | 2 / 4 / 6 | 35 |
| Sum of both semantic scores | 8 / 10 / 11 | 2 / 6 / 8 | 29 |
| Full pipeline (`search`) | 9 / 13 / 14 | 5 / 7 / 8 | 29 |

Median client-side latency per query, network included: 39 ms keyword, 123 ms semantic, 245 ms full pipeline.
A printing query typically takes 80 to 150 ms; the broadest one tried (`game:paper`, 33,375
cards grouped from their printings) takes about 500 ms.

Re-measured after the collection had received several rounds of field updates (new filter
fields, no re-embedding; `eval/after_field_updates.mtg-cards-v2.json`): every semantic row is
unchanged except that the full pipeline's first-place count rose from 9 to 10, and each
strategy's top five are identical for 30 of the 31 queries. The keyword row dropped to
0 / 0 / 2, 1 / 1 / 2 and 7. BM25 scores on the updated collection are no longer comparable
between cards: `match("lightning bolt")` on the name field ranks "Riddle of Lightning" above
"Lightning Bolt", while the older collection that was never updated ranks it first. Nothing
in the app's search path uses BM25, so results are unaffected, but the keyword baseline
should be re-measured on a freshly written collection before it is published.

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

| Area | Supported |
|---|---|
| Names and logic | Card names, `!exact`, `name:`, `-negation`, `or`, parentheses, regex on name, type, text and flavour text, with Scryfall's shorthands (`\spp` `\smm` `\spt` `\sm` `\sc` `\ss` `\smr` `\smh` `\smp`) |
| Colour | `c:` `id:` with every comparison, colour names, guilds, shards, wedges, counts |
| Text and type | `t:` `o:` `fo:` `kw:` including `~` |
| Numbers | `mv` `pow` `tou` `pt` `loy`, `pow>tou`, `mv:even` |
| Mana | `m:` with every comparison (`m:2WW`, `m={R/W}{R/W}`, `m<=1G`), `devotion:`, `produces:` as a set of colours or a count |
| Legality and tags | `f:` `banned:` `restricted:`, `edhrec`, `otag:` / `function:` |
| Card flags | `is:` split, flip, transform, meld, leveler, mdfc, dfc, permanent, spell, historic, vanilla, frenchvanilla, bear, commander, hybrid, phyrexian, reserved, gamechanger, funny |
| Shortcuts | Land cycles: `is:` fetchland, shockland, dual, checkland, fastland, painland, filterland, bounceland, bikeland, canopyland, gainland, scryland, shadowland, storageland, creatureland, triland, tangoland, triome, slowland, bondland, pathway, surveilland, vergeland (and their other names, such as `is:manland`). Groups: `is:` party, outlaw, companion, partner, oathbreaker, duelcommander, brawler, modal, adventure, augmentation, masterpiece, firstprint |
| Printings | `set:` `st:` `cn:` `r:` (with comparisons) `a:` `ft:` `wm:` `frame:` `border:` `stamp:` `game:` `year` `date` (a day, a year or a set code) `usd` `eur` `tix` |
| Printing flags | `is:` foil, nonfoil, etched, promo, reprint, digital, fullart, textless, spotlight, booster, hires, showcase, extended, borderless, old, new, ub, and every promo type (`is:prerelease`, `is:buyabox`, ...) |
| Across printings | `in:` a set, rarity or game; `prints`, `sets` |
| Results | `unique:cards`, `unique:prints`, `unique:art`, `prefer:` oldest, newest, usd-low, usd-high (and eur, tix), `include:extras` |
| Sorting | `order:` name, cmc, power, toughness, edhrec, released, usd, eur, tix, rarity; `direction:` |

Not yet: `lang:` and non-English printings, `new:`, `block:`, `cube:`, art tags (`art:`), and
`order:` by set or artist. A term that cannot be used, one of these or a value that makes no
sense (`c:purple`), is never silently ignored: it is left out, the page says which term and
why, and the rest of the query runs. If nothing is left, the search is refused with the reasons.

Known differences from Scryfall are listed with reasons in `conformance/known_gaps.txt`.

## Running the app

Needs Node 22.18 or later and a TopK API key for a project that holds the two collections.

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

Open http://127.0.0.1:8000. The page (`public/`) is one responsive page over two endpoints,
`GET /api/search` and `GET /api/card`, and works the same on a phone and a laptop. The key
stays on the server.
A search lives at `/?q=...`, with its sort, direction, what a result is and the page of results
in the address too (`/?q=t:sphinx&order=cmc&dir=desc&page=2`), so a reload or a shared link
opens at the same place. Results are drawn as pictures or, with `as=table` in the address, as a
table: a row for each with its cost, type, set, rarity, artist and the three prices, headings
that sort, and on a laptop the card's picture beside the pointer. On a phone the table is a
compact list. Each card has its own address, `/card/<set>/<number>/<name>` (for
example `/card/ima/47/consecrated-sphinx`), which can be shared and opened directly.

| Parameter | Meaning |
|---|---|
| `q` | The query, up to 200 characters |
| `k`, `offset` | Page size (default 24, at most 60) and how many results to skip |
| `order`, `dir` | Sort by `name`, `cmc`, `power`, `toughness`, `edhrec`, `released`, `usd`, `eur`, `tix` or `rarity`; `dir` is `asc` or `desc`, and without it release dates run newest first and everything else ascends. An `order:` or `direction:` keyword in the query wins. Ignored for results ranked by meaning |
| `unique` | What a result is: `cards` (the default), `prints` or `art`. A `unique:` keyword in the query wins |

The answer carries `understood`, a syntax query said back in words with one entry for each
condition (`t:sphinx mv<=3` is "the type includes “sphinx”" and "the mana value is 3 or less"),
which the page shows under the status line so that a wrong reading is easy to spot. `ignored`
lists each term that was left out, with the reason. `exact` is the card whose whole name is
what was typed, if there is one: the page opens that card instead of listing every card with
those words in its name (as it does when a search finds exactly one card), unless the address
asks for the list with `list=1`. It also
carries `total`, `unit` (what the total counts: cards, printings or illustrations),
`has_more` and `sorted_by` (null when ranked by meaning), which drive the page's status line,
pager and its three controls (show, sort, direction). The page asks for 60 results at a time.
Each hit names the printing shown: set, collector number, rarity, artist, release date and
three prices (`usd`, `eur`, `tix`). `sorted_desc` says which way the order runs. Results ranked by meaning stop at 120. TopK returns nothing beyond the first 10,000 of
a result, so `k` plus `offset` is held to that and `has_more` is false there.

`GET /api/card?set=<code>&cn=<collector number>` is what a card's own page shows: `card`, that
printing with its printed power and toughness (`stats`, also loyalty or defense) and three
lists of formats (`legal`, `banned`, `restricted`); and `printings`, the card's printings
newest first with set, number, rarity, date and price, at most 60. An address with no card
is a 404. `GET /api/card?random=1` answers in the same shape with a card chosen at random,
and is never cached.

`GET /api/home` gives the home page seven cards that have something in common, the `theme`
that joins them, and the newest sets (those still to be released are marked `upcoming`). The
theme is the newest set that is out about one visit in three, and otherwise a kind of card
from the list in `app/home.ts` (Dragons, Angels, Planeswalkers and so on). The cards are drawn
from the sixty most played of the theme. It is held by the CDN for a minute, so a return visit
sees other cards.

The home page's flavour of the week is one file, `public/flavour.json`: a `featured` line shown
above the newest sets, a `cards` search to draw the home page's cards from (`set:trk` for a new
set, `t:snow` in winter), and a `theme` (`winter`, `anniversary`). Edit it and deploy; no code
changes. The cards on the home page are a fan cut off by the bottom of the first screen, as on
Scryfall's own home page. That is the owner's decision, taken knowing that Scryfall's rules
for users of its card images say not to cover, crop or clip off the artist's name and
copyright (see F-4 in [docs/FEEDBACK.md](docs/FEEDBACK.md)). Each card in the fan links to its
page, where the card is shown whole.

The site has three addresses besides a search: `/card/<set>/<number>/<name>`, `/syntax` (the
syntax guide, a static page whose examples are links that run the search) and `/random`.
Mana and other symbols in a card's cost and text are drawn as small lettered discs of the
site's own design. They are not Wizards of the Coast's symbols: see U-7 in
[docs/FEEDBACK.md](docs/FEEDBACK.md) for why.

To run a single query from the terminal:

```bash
npm run search -- "sphinx that draws two cards"
```

## Deploying on Netlify

1. In Netlify, add a new project from this Git repository. `netlify.toml` already sets the
   publish directory, the function and the headers; leave the build command empty.
2. Under Project configuration > Environment variables, add `TOPK_API_KEY`. On plans that ask
   for a scope, include Functions. `TOPK_REGION`, `MTGSEARCH_COLLECTION` and
   `MTGSEARCH_PRINTINGS_COLLECTION` are optional.
3. Deploy. Changing a variable needs a new deploy to take effect.

If a search on the deployed site answers "This deployment has no TopK API key" or "TopK
rejected this deployment's API key", the variable is missing, was added after the last
deploy, is not shared with Functions, or has stray quotes or spaces. Fix it and deploy again.
Any other failure shows a generic message; the cause is in the function's log in Netlify.

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

## Building the collections

Needs Python 3.10 or later. This is only required to create the collections or refresh them;
the nightly workflow does the refresh.

```bash
pip install -e ".[dev]"
```

```bash
mtgsearch ingest
```

That downloads Scryfall's bulk files into `data/` and brings both collections up to date. It
compares today's documents with what each collection already holds (each document stores a
hash of its embedded text and a hash of everything else):

- a new card, or one whose embedded text changed, is sent in full and embedded;
- any other change is a field update that leaves the embedding alone. That covers popularity
  rank and prices, which move daily, and also fields the job has only just started to produce,
  so adding a filter field to every card takes about two minutes and no inference;
- cards and printings Scryfall no longer lists are deleted.

A first run takes about three minutes for the cards (they are embedded) and two for the
printings (they are not). A daily run takes a few minutes, most of it price updates, and
embeds a few dozen cards. `mtgsearch ingest --only cards` or `--only printings` refreshes one.

Collections are versioned (`mtg-cards-v2`, `mtg-printings-v1`). To change a schema, set
`MTGSEARCH_COLLECTION` or `MTGSEARCH_PRINTINGS_COLLECTION` to the next version and ingest;
never delete and recreate a collection under the same name.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Serve the page and the search endpoint locally |
| `npm run search -- "<query>"` | Run one query (`--file <path>` runs one per line) |
| `npm test` | App tests: keyword semantics, the compiler snapshot, the HTTP contract, the page; live tests when `TOPK_API_KEY` is set |
| `npm run typecheck` | Type-check the TypeScript |
| `npm run golden` | Rewrite the compiler snapshot, `fixtures/reference.json`, after an intended change in behaviour |
| `npm run conformance [-- <file>]` | Compare syntax queries with Scryfall's API |
| `npm run eval` | Score the ranking strategies on `eval/queries.json` |
| `node e2e/smoke.cjs <url>` | Drive the running app in a browser at phone and laptop sizes (needs Playwright) |
| `mtgsearch ingest [--dry-run] [--full] [--only cards\|printings]` | Refresh the collections from Scryfall's bulk data |
| `mtgsearch catalog` | Regenerate the catalogues in `app/` (type words, set release dates, printing flags) after new sets appear |
| `pytest` | Ingest job tests, no network |

## Data and attribution

Card data and images come from [Scryfall](https://scryfall.com/docs/api) bulk files and remain
the property of Wizards of the Coast. This project is not produced or endorsed by Scryfall or
Wizards of the Coast. Scryfall's terms require that a project built on their data adds value
rather than repackaging it, is not paywalled, and does not crop or alter card images. Read
those terms and Wizards' Fan Content Policy before launching anything public.
