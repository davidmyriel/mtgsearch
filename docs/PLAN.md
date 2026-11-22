# Project plan

Goal: everything Scryfall's search does, plus natural-language and art search, under our own
name and design, as a public demo of TopK.

Last updated 21 November 2026. Time estimates are rough judgement for one engineer.

## Decisions still open

| Decision | Default being assumed |
|---|---|
| What "a copy of Scryfall" means | Same capabilities, own name and visual design. Their look, name and logo are not copied. |
| Where v0.1 stops | Tier 1: search parity plus the better search |
| App stack | Python for ingest and evaluation; Next.js with `topk-js` behind a server route for the app |
| Name and branding | Working name only; nothing using "Scryfall" or official-looking Magic branding |
| Policy sign-off | A person reads Wizards' Fan Content Policy and Scryfall's terms, and tells Scryfall before launch |
| Indexing art for all 39,356 cards | Not done: roughly 3 GB of images to send and embed, cost not yet known |

## Scope tiers

| Tier | What it includes | In v0.1 |
|---|---|---|
| 1. Search parity | Full query syntax, every printing, sort and display options | Yes |
| 2. Browse parity | Card pages with printings, prices, legality, rulings; set pages; advanced search form; random card | v0.2 |
| 3. Everything else | Accounts and decks, public API, chat bots, tagging project | No |
| The better part | Plain-English search, art search, syntax mixed with plain English | Yes |

## Stages

### 0. Setup: done except key rotation
- [x] Repository on GitHub, lint, unit tests, CI workflows
- [x] `TOPK_API_KEY` secret on GitHub: integration tests and the nightly refresh run with it
- [ ] Revoke the first API key that was pasted into chat; create separate keys for CI, staging, production

### 1. Card-level search parity: mostly done
- [x] Ingest pipeline from Scryfall bulk files, incremental, versioned collections
- [x] Syntax compiler for card-level keywords (see README for the list)
- [x] Differential testing against Scryfall's API: 97/97 tuning, 74/77 held-out first run
- [ ] Mana cost keywords: `m:`, `devotion:`, `produces:`
- [ ] Remaining `is:` shortcuts (land cycles and the like) and Scryfall's regex shorthands
- [ ] Grow the held-out conformance set to about 200 queries; run it nightly

### 2. Printing-level parity: not started, the largest remaining gap (2–3 weeks)
- [ ] Second collection with one document per printing (Scryfall's `default_cards` file, about three
      times the size)
- [ ] `set:`, `rarity:`, `artist:`, `flavor:`, prices, `frame:`, `border:`, `game:`, `year:`, `in:`, `new:`
- [ ] `unique:cards|prints|art` and `prefer:`; check TopK's `group_by` can pick one printing per card
- [ ] Name search over printed and flavour names
- Exit: held-out conformance at 95% or better with printing keywords included

### 3. Relevance (about a week)
- [x] Frozen query set, evaluation harness, full-corpus baseline
- [x] Filters read from plain English: mana value, colour, type
- [ ] Spell out mana symbols in the indexed text. Known failure: "taps for two colorless mana" does
      not find Sol Ring, whose text reads `{T}: Add {C}{C}`
- [ ] Decide how to weight the plain and tagged text fields. Tags win on jargon (35 of 40 against 20),
      plain text wins on numeric queries
- [ ] Grow the query set to about 150 with a second reviewer; write art descriptions from memory
- [ ] Index art for the full set and add art to the combined score (needs the cost decision above)
- [ ] Minimum score for "no good match"
- Exit, proposed and to be confirmed on the larger set: right card in the top 3 for 80% of descriptive,
  85% of numeric and 85% of art queries; 80% correct in the top 5 for jargon

### 4. Product: thin version built, not yet deployed
- [x] API route: key server-side, rate limiting, query length cap, caching
- [x] One responsive page for phone and laptop: results grid with full card images from Scryfall,
      link back, which path the query took, example searches, what can be typed
- [x] End-to-end browser test at phone and laptop sizes, run in CI
- [x] Container image, built and started in CI
- [ ] Deploy it (needs a host account) and point a domain at it
- [ ] Anonymous query and click logging
- [ ] Pagination past the first 60 results; sort controls
- [ ] Measure p95 latency under load
- Exit: deployed, end-to-end test passes against the deployment, p95 under 500 ms

### 5. Internal alpha (3–4 days)
- [ ] Bug bash; every failed query goes into the query set

### 6. Private beta (1–2 weeks)
- [ ] 20–50 invited players and developers, feedback button
- [ ] Load test at 1, 8 and 32 concurrent users; cost per 1,000 queries
- Exit: gates hold on the grown query set, no blocking bugs, cost known

### 7. v0.1 public
- [ ] Public repository, write-up with the benchmark, launch

## Testing

| Layer | What it covers | Where |
|---|---|---|
| Unit | Document builder, syntax parser and semantics, plain-English filters | `tests/`, no network |
| Integration | TopK returns what the Python evaluator predicts; each search path end to end | `pytest -m integration` |
| Conformance | Our result set equals Scryfall's for the same query | `mtgsearch conformance` |
| Relevance regression | Ranking quality per query class against a stored baseline | `mtgsearch eval` |
| End to end | The real page in Chromium at phone and laptop sizes | `node e2e/smoke.cjs <url>` |

## CI

- Every push and pull request: lint, format check, unit tests on Python 3.10 and 3.13.
- Same-repository pushes and pull requests: integration tests and the browser test, when the TopK
  secret is configured; the container image is built and started on every run.
- Nightly: incremental ingest, conformance on the tuning set, relevance evaluation, results uploaded.
- Not yet wired: failing the nightly when relevance drops below the baseline, and a staging
  collection that is promoted to production only after the checks pass.

## Benchmarks to publish with v0.1

- Relevance per query class, with the ablation in the README.
- Baselines: Scryfall given the plain-English query, and an LLM that translates the query into
  Scryfall syntax. The second is the fair competitor.
- Latency percentiles under load, full re-index time, cost per 1,000 queries.
- The query set and grading rules, so the numbers can be reproduced.

## Risks

- **Scryfall's terms** forbid repackaging their data. The plain-English and art search have to be
  the visible point of the product, and Scryfall should hear about it before launch.
- **Printing-level parity** needs a data model TopK has not been tested against here.
- **Relevance numbers rest on 31 queries** graded by one person.
- **A public endpoint calls paid inference** on every query.
- **Hidden-card rules were reverse-engineered** from Scryfall's behaviour and will drift as sets release;
  the nightly conformance run is the alarm.
