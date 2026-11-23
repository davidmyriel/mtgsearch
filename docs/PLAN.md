# Project plan

Goal: everything Scryfall's search does, plus natural-language and art search, under our own
name and design, as a public demo of TopK.

Last updated 22 November 2026. Time estimates are rough judgement for one engineer.

Feedback from users is logged in [FEEDBACK.md](FEEDBACK.md), which also says when an item is
picked up: at the boundary between plan steps unless something is broken.

## Decisions still open

| Decision | Default being assumed |
|---|---|
| What "a copy of Scryfall" means | Same capabilities, own name and visual design. Their look, name and logo are not copied. |
| Where v0.1 stops | Tier 1: search parity plus the better search |
| App stack | Decided: a static page plus one TypeScript function on Netlify, with `topk-js`. TypeScript is the only implementation of search; a Python job builds the collection |
| Name and branding | Decided by the owner on 23 November 2026: the site is TutorK, in the blocks of TopK's logo, "Powered by TopK AI search". The project and repository keep the working name. Nothing uses "Scryfall" or official-looking Magic branding |
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
- [x] Differential testing against Scryfall's API: 97/97 tuning, 74/77 held-out first run (77/77 now)
- [x] Mana cost keywords: `m:`, `devotion:`, `produces:` (58/58 tuning, 18/22 held-out first run)
- [x] `is:` shortcuts: 23 land cycles with their other names, and party, outlaw, companion,
      partner, oathbreaker, duelcommander, brawler, modal, adventure, augmentation, frenchvanilla,
      masterpiece, firstprint (54/54 on the tuning set; four differences kept on purpose are in
      `conformance/known_gaps.txt`). `is:commander` now includes legendary Vehicles, Spacecraft
      and Backgrounds, as Scryfall's does
- [x] Scryfall's regex shorthands: `\spp`, `\smm`, `\spt` and the symbol ones `\sm`, `\sc`,
      `\ss`, `\smr`, `\smh`, `\smp` (16/16 on the tuning set)
- [x] Held-out conformance: 214 queries in four sets. The newest, 54 queries across cards,
      printings, mana and shortcuts, matched 52 on its first run (96%)
- [x] Run the held-out sets nightly as well as the tuning sets: each is compared with its saved
      run, and a query that matched before and no longer does fails the job

### 2. Printing-level parity: mostly done
- [x] Second collection with one document per printing (Scryfall's `default_cards` file: 120,275
      printings, no embeddings), kept up to date by the same ingest job
- [x] `set:`, `rarity:`, `cn:`, `artist:`, `flavor:`, `watermark:`, prices, `frame:`, `border:`,
      `stamp:`, `game:`, `year:`, `date:`, `in:`, `prints`, `sets`, printing-level `is:` flags
- [x] `unique:cards|prints|art`, `prefer:`, and sorting by release date, price and rarity. One
      TopK `group_by` returns each matching card and the printing that shows it
- [x] Differential testing: 79/79 tuning, 53/61 held-out first run, 59/61 after fixes
- [ ] `new:`, `lang:` and non-English printings, `block:`, `cube:`
- [ ] Name search over printed and flavour names
- [ ] The cases in `conformance/known_gaps.txt`: Arena printings that only exist to be conjured,
      Scryfall's loose match on two-letter artist fragments
- Exit: held-out conformance at 95% or better with printing keywords included. Met: a fresh
  held-out set across everything matched 52 of 54 on its first run (`conformance/heldout2.txt`)

### 3. Relevance (about a week)
- [x] Frozen query set, evaluation harness, full-corpus baseline
- [x] Filters read from plain English: mana value, colour, type
- [x] The examples the home page offers find what they promise (23 November 2026). A query that
      names a card and asks for others like it is answered from that card's own text, without
      the card; a type word followed by what is done to it ("land destruction") is not a
      filter. Changes to how the query is read, not to the index; the relevance set is unchanged
- [x] Players' words (23 November 2026). A query that is a players' word for a kind of card
      ("mana rocks", "board wipes", "tutors", some fifty in `app/jargon.ts`) is read as the
      community's tag for it and answered most played first, narrowed by a colour in front or
      a kind of card behind. The relevance set's players'-words class went from 29 of 40 to 40
      of 40 for the full search; the other classes did not change. "tutors" finds Demonic,
      Vampiric and Enlightened Tutor first
- [ ] A players' word inside a longer query ("white creature tutor", "mana rocks that draw
      cards") is still left to its meaning and ranks poorly. Use the tag as a filter and rank
      the rest by meaning
- [ ] A players' word that is also exactly a card's name (blink, flicker, fog, clone) opens that
      card. Offer the kind of card from the card's page, as the other matches already are
- [ ] "budget" and "cheaper" in a query for a card's alternatives should filter by price
- [ ] Searches that failed when examples were being chosen (23 November 2026), each a card any
      player expects: "three damage for one mana" without Lightning Bolt, "two mana counterspell"
      without Counterspell, "search for any card" without Demonic Tutor, "elf that taps for mana"
      without Llanowar Elves, "white board wipe" finding cards named Wipe. Add them to the query
      set. Most trace to mana symbols and numbers in the indexed text (the item below)
- [ ] Asking TopK for more results than are shown seems to find better ones: Fyndhorn Elves came
      first for Llanowar Elves' text when 120 were asked for and was absent when 10 were. Measure
      on the query set whether ordinary plain-English searches should ask deeper and cut
- [ ] Spell out mana symbols in the indexed text. Known failure: "taps for two colorless mana" does
      not find Sol Ring, whose text reads `{T}: Add {C}{C}`
- [ ] Decide how to weight the plain and tagged text fields. Tags win on jargon (35 of 40 against 20),
      plain text wins on numeric queries
- [ ] Grow the query set to about 150 with a second reviewer; write art descriptions from memory
- [ ] Index art for the full set and add art to the combined score (needs the cost decision above)
- [ ] Minimum score for "no good match". Measured on 22 November 2026: 23 plain-English queries
      from the evaluation set had a top score between 8.5 and 21.7, and 10 queries about nothing
      in the game (tax returns, train times, gibberish) between 3.5 and 6.6. So there is a gap,
      but the score grows with the length of the query: the lowest on-topic score belongs to
      the shortest query. A fixed cut-off would call short, good queries weak. It needs a score
      adjusted for length and the larger query set before it is switched on
- Exit, proposed and to be confirmed on the larger set: right card in the top 3 for 80% of descriptive,
  85% of numeric and 85% of art queries; 80% correct in the top 5 for jargon

### 4. Product: thin version deployed on Netlify
- [x] Search endpoint: key server-side, rate limiting, query length cap, caching
- [x] One responsive page for phone and laptop: results grid with full card images from Scryfall,
      link back, which path the query took, example searches, what can be typed
- [x] One implementation of search, in TypeScript, running as a Netlify Function
- [x] End-to-end browser test at phone and laptop sizes, run in CI on the local server and as
      Netlify serves the site; Netlify's own build exercised in CI
- [x] Connected the repository in Netlify, set `TOPK_API_KEY`, deployed. The browser test passes
      against the live URL (414 checks at phone, laptop and dark-mode sizes and on a 320-pixel
      screen, after the sixth merge on 23 November 2026, which carried the table view),
      repeated searches are
      answered from Netlify's CDN cache, and the security headers are served
- [ ] Confirm the per-client rate limit on the live site. It counts per address, so it needs a
      client with one address: about 80 different searches in a minute should start returning 429.
      Netlify validates the rule at the end of each deploy and a rule that fails validation does
      not fail the deploy, so also look for it in the deploy log
- [x] Paging and sorting. The page of results is in the address and a pager moves between
      pages of 60, so a reload or a shared link opens at the same place (U-3). Sort key,
      direction, and cards / printings / illustrations are three separate controls (U-4)
- [x] Printing details in the card view (set, number, rarity, artist, price, flavour text) and a
      link from a card to all of its printings
- [x] A page for each card at `/card/<set>/<number>/<name>`, shareable, in place of the popup
      (feedback F-1)
- [x] The card's page gives printed power and toughness (or loyalty), legality in sixteen
      formats, and the card's printings with prices, each a link to that printing's page (U-2,
      brought forward from the browse tier). It is served by a second endpoint, `GET /api/card`
- [x] The page says how a syntax query was read, each condition in plain words, and a term that
      cannot be used is left out with a warning while the rest of the query runs (U-1)
- [x] A public-facing design: a header with navigation on every view, a home page that shows
      the three ways to search, four larger tiles to a row, a three-column card page, a footer,
      a syntax guide whose examples run, a random card, and symbols drawn as lettered discs
      (feedback F-2, U-7)
- [x] A card's exact name, or a search that finds one card, opens that card's page (feedback F-3)
- [x] A table view of results with USD, EUR and TIX prices, headings that sort and a hover
      preview (U-5). Card records carry all three prices, refreshed nightly as field updates
- [x] The home page is one screen: the search bar and little else, as tall as the window, with
      the newest sets under the bar, a fan of random cards cut off by the bottom edge, and a
      flavour of the week set in one file. Square corners throughout (feedback F-4)
- [ ] Anonymous query and click logging
- [ ] Measure p95 latency under load, including function cold starts
- Exit: deployed, end-to-end test passes against the deployment, p95 under 500 ms

### 5. Internal alpha (3–4 days)
- [ ] Bug bash; every failed query goes into the query set

### 6. Private beta (1–2 weeks)
- [ ] 20–50 invited players and developers, feedback button
- [ ] Load test at 1, 8 and 32 concurrent users; cost per 1,000 queries
- Exit: gates hold on the grown query set, no blocking bugs, cost known

### 7. v0.1 public
- [ ] Public repository, write-up with the benchmark, launch

### 8. Meaning, systematically: a major milestone, for later

Set by the owner on 23 November 2026: "we shouldnt do it manyally, there needs to be a way to
systematically deal with meaning behind the scenes". Not started. Nothing below is decided;
it is written down so that the stage is ready to be planned when its turn comes.

**What is done by hand today, and should not be.** Each of these is a list a person wrote,
and each new case means another entry:

- `app/jargon.ts`: some fifty players' words, each with the tag it reads as, and hand-made
  narrowing where a tag is wider than the word ("tutors" without land fetchers, "removal"
  without board wipes).
- `app/nl.ts`: which words are colours, which are fillers, which words after a type mean the
  type is what the effect is done to ("land destruction").
- `app/search.ts`: the ways of asking for a card's alternatives, as patterns.
- The home page's examples and the cards each must find, chosen by reading results.

**Where it shows.** "burn spells" lists Commander's most played damage cards, with Shock
39th, because the tag is wide and "most played" means most played in Commander; the fix on
offer was another hand-made rule, which the owner declined. A players' word inside a
sentence ("white creature tutor", "mana rocks that draw cards") falls back to meaning and
ranks poorly. A word nobody wrote into the list is not understood at all.

**What the stage has to deliver.** Any query, however it is put, is turned behind the scenes
into what it asks for: which cards are eligible (colour, type, cost, tag, price, format), what
to rank by, and what is left to meaning; with no list of words to maintain, and a reading
that can be shown to the user as it is now.

**Directions to weigh when it is planned** (not chosen):

- Take the vocabulary from the data. The community's tags, with their names, aliases and
  descriptions, are already a dictionary of players' words several thousand entries long;
  match a query to tags by meaning instead of by a hand list.
- Have a language model read the query into a structured search (filters, a remainder to
  rank by meaning, an order), checked by the existing compiler so that it can only produce
  searches that run, and cached. The page would still say how the query was read.
- Rank with several signals at once (meaning, how central a card is to a tag, how much it
  is played and in which format, price) instead of filtering by one and sorting by another,
  with weights learned from the query set, not set by hand.
- Fix the index where meaning cannot work: mana symbols and numbers spelled out, which is
  what most of the searches that failed on 23 November trace to (stage 3).
- Learn from use: anonymous query logs to see what people actually type and where they
  give up (needs the storage decision in stage 4).

**How it will be judged.** On a query set several times the present one, written by more
than one person, with players' words alone and inside sentences, in more than one format's
idea of "most played". A hand-written rule is removed only when the systematic reading does
as well or better on that set without it. Cost and added time per query are measured, since
a model in the path of every search changes both.

**Until then.** The lists stay as they are and are not grown case by case; a word that fails
is added to the query set, not to a list.

**Words that fail today, for that query set** (run on 23 November 2026 from a list of players'
slang the owner sent). Each is something a player would type and the search does not
understand; what it finds instead is in brackets.

- pingers (cards with "sting" in the name); the tag for creatures that deal one damage exists
- vanilla creatures, french vanilla (unrelated cards); Scryfall has `is:vanilla` and
  `is:frenchvanilla`, and this search has the first
- bears (cards named Bears); Scryfall's `is:bear` is the two-mana 2/2
- stax pieces, group slug, voltron, aristocrats (cards with similar names: Strax, Ultron,
  Falkenrath Aristocrat). These are kinds of deck, not of card: what is wanted is the cards
  such a deck plays
- treasure makers, token makers, etb effects, haste enablers (loosely related cards)
- "dwarf that destroys lands" ranks Duergar Hedge-Mage fifth, which destroys an artifact or
  an enchantment; "blue land destruction" ranks Mystic Might and Blue Elemental Blast fourth
  and fifth. Both are among the examples the home page shows

Words from the same list that are about play and not about cards (goldfishing, topdecking,
win-more, chump block, durdling, scoop, curve, whiff, Timmy/Johnny/Spike) are not searches
for cards, and a glossary would serve them better than a search.

## Testing

| Layer | What it covers | Where |
|---|---|---|
| App unit tests | Parser, keyword semantics, plain-English filters, search routing, the HTTP contract, the page | `npm test`, no network |
| Compiler snapshot | The compiled predicate for about 550 inputs is unchanged unless deliberately regenerated | `fixtures/reference.json`, `npm run golden` |
| Ingest unit tests | Document builder, what a daily run re-sends, the fixtures the app tests read | `pytest`, no network |
| Live tests | Each search path against the real collection | `npm test` with `TOPK_API_KEY` |
| Conformance | Our result set equals Scryfall's for the same query | `npm run conformance` |
| Relevance regression | Ranking quality per query class against a stored baseline | `npm run eval` |
| End to end | The real page in Chromium at phone and laptop sizes | `node e2e/smoke.cjs <url>` |

## CI

- Every push and pull request: type-check and test the app, check the compiler snapshot, build the
  function bundle with Netlify's tool; lint and test the ingest job on Python 3.10 and 3.13.
- Same-repository pushes and pull requests, when the TopK secret is configured: live tests, and the
  browser test on the local server and as Netlify serves the site.
- Nightly: incremental ingest of cards and printings, conformance on the five tuning sets
  (cards, printings, mana, shortcuts, regex), the four held-out sets against their saved runs,
  relevance evaluation, results uploaded. The shortcut set matters most there: twenty land
  cycles rest on community tags, which anyone can edit.
- Not yet wired: failing the nightly when relevance drops below the baseline, and a staging
  collection that is promoted to production only after the checks pass.

## Benchmarks to publish with v0.1

- Relevance per query class, with the ablation in the README.
- Baselines: Scryfall given the plain-English query, and an LLM that translates the query into
  Scryfall syntax. The second is the fair competitor.
- Latency percentiles under load, full re-index time, cost per 1,000 queries.
- The query set and grading rules, so the numbers can be reproduced.

## Risks

- **Keyword scores after field updates.** After partial `update()` calls, BM25 scores in the
  cards collection stopped being comparable between cards (see the note under the relevance
  table in the README). Search does not use BM25, so nothing visible changed. To find out:
  whether scores recover once TopK compacts the collection, and whether this is expected
  behaviour. It matters for the published benchmark's keyword baseline and for anyone who
  adds keyword search later.

- **Two languages.** Search is TypeScript and ingest is Python, because TopK's JavaScript SDK cannot
  write whole numbers into decimal fields. If that changes, the ingest job (about 550 lines) can move
  to TypeScript and the repository becomes single-language.

- **Scryfall's terms** forbid repackaging their data. The plain-English and art search have to be
  the visible point of the product, and Scryfall should hear about it before launch.
- **Printing-level parity** needs a data model TopK has not been tested against here.
- **Relevance numbers rest on 31 queries** graded by one person.
- **A public endpoint calls paid inference** on every query.
- **Hidden-card rules were reverse-engineered** from Scryfall's behaviour and will drift as sets release;
  the nightly conformance run is the alarm.
