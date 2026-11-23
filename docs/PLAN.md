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
- [ ] **The TopK account ran out of credits on 23 November 2026, about 04:50 UTC.** Every
      request is refused ("You have run out of credits. Please add a payment method"), so
      search on the live site answers "The search backend is unavailable" and the nightly
      run will fail until credits are added at console.topk.io/billing. It happened during a
      day of heavy use from this branch: the trial's seven collections (18,200 cards
      embedded), about 80,000 field updates to printings, and several thousand comparison
      and test queries. Before more of that: find out what a field update, a query and an
      embedded card cost, and budget for it (the nightly run included)
- [ ] When credits are back: run the live tests, the browser checks and CI for the `new:`
      commit, which went in without them
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
- [x] `block:` and `b:` (23 November 2026). The value is a block's code, or the code or whole
      name of any set in it (`b:wwk` and `block:worldwake` are the Zendikar block); a set
      outside every block stands for itself; a block lists its tokens. The blocks come from
      Scryfall's list of sets (`mtgsearch catalog` writes `app/blocks.json`: 44 blocks over
      1,069 sets), because the bulk files do not say which block a set is in. 102 of 102 in
      `conformance/blocks.txt`, which the nightly run repeats. One difference, on purpose:
      we accept every block's name (`block:alara`), Scryfall only some
- [x] `new:art`, `new:flavor`, `new:frame`, `new:rarity` (23 November 2026): the printing
      that was the first of its card to have that art, flavour text, frame or rarity. The
      ingest job works it out for every printing (`first_printings`), from a rule found by
      comparing with Scryfall's answers for 23 sets: 17 cards differ out of several thousand,
      none in rarity. 59 of 74 on the first run of `conformance/new.txt`, 79 of 79 now, and
      the nightly run repeats it. A field on 68,000 printings, written as field updates;
      the printings hold no embeddings. Left out on purpose: `new:artist` (Scryfall's own
      answer follows no rule: 69 of Lightning Bolt's 72 printings) and `new:language`
      (needs other languages). Known differences are in `known_gaps.txt`: which of two
      same-day twins is the new one, and Tenth Edition's promos
- [ ] `lang:` and non-English printings, `cube:`
- [ ] `app/type-words.json` is behind the card data by fifteen words (seen when the
      catalogues were regenerated for blocks). Some are ordinary (`pigeon`, `bottle`), some
      would change how short type searches read (`a`, `in`, `city`). Not taken with the block
      catalogue; needs each word checked against Scryfall before it goes in
- [x] Name search over printed and flavour names (23 November 2026). 720 cards go by another
      name on some printing. A flavour name (Godzilla, King of the Monsters on a Zilortha,
      Strength Incarnate) is found by its words and whole; a name that is only printed on the
      card (Rick, Steadfast Leader on a Greymond, Avacyn's Stalwart) only whole, as on
      Scryfall. The card is shown as the printing that carries the name, and its page says
      "Printed as". Ruling a name out (`-godzilla`) keeps the card, whose other printings are
      not called that. An exact name may leave out its punctuation (`!"urzas saga"`). Fields
      added to 720 cards and 933 printings as field updates; nothing was embedded again.
      42 of 42 in `conformance/names.txt`, which the nightly run repeats
- [ ] The cases in `conformance/known_gaps.txt`: Arena printings that only exist to be conjured,
      Scryfall's loose match on two-letter artist fragments, and variant printings that
      Scryfall leaves out of a list of printings (`godzilla unique:prints`: 14 against our 15)
- [ ] `!"avacyn the purifier"`: the exact name of one face of a double-faced card, typed
      without its punctuation, is not found (with the comma it is). Needs the faces' names in
      plain form on every card, a field update of the whole index
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
      player expects. Still failing: "three damage for one mana" without Lightning Bolt, "search
      for any card" without Demonic Tutor, "elf that taps for mana" without Llanowar Elves,
      "destroy all creatures" without Wrath of God. Fixed since, without touching them one by
      one: "two mana counterspell" finds Counterspell first (asking deeper, below) and "white
      board wipe" is a players' word. Add the rest to the query set. Most trace to mana symbols
      and numbers in the indexed text (two items below)
- [x] Ask TopK for more results than are shown (23 November 2026). Its search by meaning is
      approximate: the first ten of 60 or more are not the ten it returns when asked for ten.
      Measured with `experiments/depth.ts` at 10, 30, 60, 120 and 250 on the frozen descriptive
      and numeric classes and on the searches above: from 60 up, about two of the first ten
      differ, no query got worse, and it takes no longer up to 120 (248 against 253 ms). Every
      search ranked by meaning now asks for 120 and cuts. On the frozen set the full search
      went from 13 to 14 of 15 with the right card in the first three and from 14 to 15 in the
      first ten (`eval/after_full_depth.mtg-cards-v2.json`); numeric and players' words are
      unchanged. It also makes pages agree: before, a second page was cut from a list asked to
      another depth and could repeat or skip cards
- [x] Spell out mana symbols and numbers in the indexed text: tried, and not adopted (trial of
      23 November 2026, on the owner's go; `experiments/trial/`, results in `results.txt`).
      Seven throwaway collections of the same 2,600 cards (what 60 test searches find today,
      their right answers, and 408 at random), differing only in the text TopK embeds. Right
      card first / in the first three / in the first ten, of 60, and searches better or worse
      than with today's text:
      - today's text: 36 / 48 / 54
      - symbols in words, cost line and rules: 36 / 44 / 54; 10 better, 13 worse
      - the same with numbers in words: 34 / 45 / 55; 9 better, 16 worse
      - today's text with the words added underneath: 39 / 50 / 53; 12 better, 9 worse
      - symbols in words in the rules only: 34 / 50 / 56; 10 better, 8 worse
      - the same with numbers in words: 35 / 49 / 56; 10 better, 10 worse
      - today's text again, in a second collection (the control): 36 / 48 / 54; none better,
        none worse. So the differences above are the text and not chance.
      Every wording does what it was meant to: Sol Ring comes first for "one mana artifact that
      taps for two colorless mana", "artifact that taps for two mana" and "elf that taps for
      mana" find their cards where they found none. And every wording makes eight to sixteen
      searches worse that work today and have nothing to do with symbols ("vehicle with
      flying" from first to fourth or lower, "fight target creature" from first to seventh,
      "sphinx that draws two cards" from first to second): the added words change what every
      card is about. The rule set beforehand was to go on only if no working search got worse.
      None passed, so the cards were not embedded again and the live index is as it was.
      The seven collections were deleted the same day, on the owner's word
- [ ] **To be fixed, on the owner's word** (23 November 2026, after the trial failed: "remember
      for the future to do something to fix this issue"). The issue: searches that speak of
      mana, tapping or amounts miss the card every player means. "three damage for one mana"
      does not find Lightning Bolt, "elf that taps for mana" does not find Llanowar Elves,
      "search for any card" does not find Demonic Tutor, "deals two damage to any target" does
      not find Shock, "destroy all creatures" does not find Wrath of God. It is open, it is not
      to be forgotten, and it is not to be patched search by search. Two ways the trial points
      to, neither tried: say the notation on the side of the query, not the card (a query
      that speaks of tapping for mana is given the notation as well), which touches only the
      searches that are about symbols and needs nothing embedded again; or keep the worded
      text as a field of its own beside today's two, so that it adds to a card's score
      without replacing what works. Whatever is tried is judged as the trial was: the same
      cards, the same searches, a control, and nothing that works today made worse. It
      belongs with stage 8 and is the first thing that stage should show it can do
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
  85% of numeric and 85% of art queries; 80% correct in the top 5 for jargon. On the present
  small set, as of 23 November 2026: descriptive 14 of 15 (93%), numeric 7 of 8 (88%), players'
  words 40 of 40. Art is not indexed for the full set, so that class is not measured

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
- [x] Measure response time on the live site, including the function's cold start (23 November
      2026, `experiments/latency.py`, twice, 52 searches each that had never been asked, so the
      cache could not answer them; this is a measurement, not the load test of stage 6).
      - The search itself, as the function reports it: filters (Scryfall syntax, players' words)
        a median of about 50 to 65 ms; ranked by meaning a median of about 300 ms. Of all
        kinds together, 95 in 100 under about 410 ms one at a time, and under 570 ms four at
        a time, where the searches by meaning stretch to 650 ms.
      - The whole request from the machine that measured: a median of 315 to 335 ms, 95 in
        100 under 640 to 780 ms one at a time and under 960 ms four at a time. About 200 ms
        of every one of those is that machine's own route to Netlify (a search answered from
        the cache took 201 ms), so a visitor nearer to Netlify sees less.
      - The first request after the site has been idle waited for the function to start: 1.7 s
        for a search that itself took 0.16 s.
- [ ] Bring the slow end down. The exit below is met by filter searches and by the search
      itself one at a time, and missed by searches by meaning when several run at once and by
      the first request after idle. To look at: a plain-English query first asks whether its
      words are a card name and only then ranks by meaning, one request after the other, where
      the two could be asked together; and whether the function can be kept warm
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

**The whole of what was put in by hand, as of 23 November 2026.** The owner, the same day:
"all of this should be systematic though, so if you manually scaffolded something, thats not
good enough because the site should be dynamic, do not do anything else right now but just
note for the future what can be improved". Nothing here is to be changed now. Each line says
what a person decided and what would make it follow from the data or from use instead.

*What the search understands*

- Players' words: fifty entries and their narrowing, in `app/jargon.ts`. Could come from the
  community's own tags, their aliases and descriptions, matched by meaning.
- Reading plain English: the lists of colour words, filler words, number words, words that
  are not card types, and the words that make a type the thing an effect is done to, in
  `app/nl.ts`. Could be one reading of the query by a model, checked by the compiler.
- Asking for a card's alternatives: three patterns in `app/search.ts`; and how the two
  rankings are merged, a number chosen by reading the results for seven cards. Could be
  recognised as an intent like any other, and the merge weighed on the query set.
- "Most played" is EDHREC's ranking, which is Commander's. Could be by format, or follow
  what the person searching plays.
- The `is:` shortcuts in `app/shortcuts.ts` are rules a person wrote to match what Scryfall
  returns. They are checked against Scryfall every night, so they are kept honest, but each
  new one is still written by hand.

*What the home page shows*

- The 33 examples in the search box: chosen by running candidates and reading the results;
  the list is kept twice, in `app/home.ts` and `public/app.js`, with a test that they agree.
  Could be drawn from what people actually search and then open, or made from the data and
  shown only when a measure of their results says they are good.
- The cards each example must find, in `app/test/live.test.ts`: written by hand. Could come
  from a judged query set, kept apart from the code.
- The nine searches under the bar, and which four of them the page arrives with: the owner's
  list, typed into the page and its script. Could be the kinds of card most searched for.
- How many cards the home page shows (five) and that they are the first five results: set by
  the owner after two wrong cards. Could show however many the search is sure of.
- The news lines' wording and its thresholds: "first look" under sixty cards shown, "out now"
  for forty-five days, decks and sheets named from ten cards, five lines, sets from the last
  three hundred days. And what counts as news is a list of set types, with "decks" and "bonus
  sheet" attached by type. Could come from Scryfall's own record of each set (how many cards
  it will have, which set it belongs with, when previews begin), which would also let the
  page say "full preview" truthfully, as the owner's example did.
- The fallback themes (fourteen kinds of card, the newest set one time in three) for when an
  example finds too few cards. Could be whatever is being searched for that week.
- The flavour of the week is a file a person edits (`public/flavour.json`). Could follow the
  calendar and the release schedule.
- The syntax guide's page was written once by a script from examples typed by hand. Could be
  built from the keywords the compiler supports, so the guide cannot fall behind it.

*What is already drawn from the data, for contrast:* the newest sets and their dates, the
cards under each example, the tags themselves, the list of real type words (made from
Scryfall's catalogue on each ingest), prices and printings, and the nightly comparison with
Scryfall.

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
