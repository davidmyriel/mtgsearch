# Feedback log

Feedback from people using the site, written down as it arrives and scheduled so that it does
not derail the work in [PLAN.md](PLAN.md).

## How it works

1. **Record.** Every item is logged the day it arrives: who it came from, their words as given,
   and, kept separate, how it was read. The reading is an interpretation and is labelled as one.
2. **Size and slot.** Each item gets a size and one of the slots below. The slot decides when it
   is done, not how much anyone wants it.
3. **Review.** Open items are reviewed at every step boundary: when a plan step is finished,
   tested and pushed. Nothing is picked up in the middle of a step, except the first slot.

| Slot | For | When it is done |
|---|---|---|
| Now | Something users see that is wrong or broken: wrong results, an error on the live site | Interrupts the current step |
| Next boundary | Self-contained changes to the page or the endpoint that do not touch the index or the compiler's rules | Between plan steps, before the next one starts |
| With a stage | Belongs with work the plan already holds | As part of that stage |
| Needs a decision | Costs money (re-embedding, art), changes the scope, or reverses an earlier decision | Waits for the owner's answer |
| Declined | Not going to be done | Never; the reason is recorded |

Sizes: **S** is the page only. **M** is the page plus the endpoint, routing or tests. **L**
changes the documents, the ingest job or the compiler, and needs the collections refreshed.

A fix that follows from feedback is tested like any other change: unit tests, the browser test,
and the Scryfall comparison where results could move.

## Items

| Id | Received | Item | Size | Slot | Status |
|---|---|---|---|---|---|
| F-1 | 22 Nov 2026 | A page for each card, in place of the popup | M | Next boundary | Done |
| F-2 | 22 Nov 2026 | The site has to look polished enough for the public; layout closer to Scryfall's first | L | Now, on the owner's word | Done (first pass) |
| F-3 | 22 Nov 2026 | Typing a card's exact name opens the card's page, not a list of results | M | Next boundary | Done |

### F-1. A page for each card

- **From:** a user, relayed by the project owner, 22 November 2026.
- **In their words:** "individual card page". "you are currently doing a popup, but it would be
  better to have a page, because a page can be shared: like here
  https://scryfall.com/card/trk/14/dr-mccoy-surly-surgeon"
- **How it was read:** every card should have its own address that shows the card and can be
  sent to someone, who then sees the same card. Opening a card from the results should go to
  that address instead of covering the results with a panel.
- **Slot and why:** next boundary, taken straight away. No plan step was in progress, the change
  is confined to the page and its routing, and the popup would otherwise have gathered more
  features that then need moving. The plan's browse tier (v0.2) already holds "card pages"; this
  brings the page itself forward and leaves rulings, legality and set pages there.
- **What was done:** a card lives at `/card/<set>/<number>/<name>`, the same shape Scryfall uses.
  Opening a card from the results goes there and Back returns to the results as they were. The
  address can be opened directly or shared, and the page has a "Copy link" button. The popup
  is gone.
- **Not included, and not asked for:** a shared link shows no preview image in chat apps,
  because the page is static and the preview tags would have to be written on the server per
  card. That is a suggestion from the developer, not feedback; it would be size M and belongs
  with the browse tier unless asked for sooner.

### F-2. A site polished enough for the public

- **From:** the project owner, 22 November 2026, after asking whether the study of Scryfall's
  interface had been done and hearing that its look had been recorded but not applied.
- **In their words:** asked "the remaining features in the order above, or the layout brought
  closer to theirs first?", the answer was "the layout brought closer to theirs first" and
  "needs to look like a polished site for the public".
- **How it was read:** the structure of the pages should follow Scryfall's, which people who
  search for cards already know: a header with the search box and navigation on every page, a
  home page built around the search box, large tiles, a card page in columns, a proper footer.
  The colours, typefaces, wordmark and drawings stay this site's own, because theirs are their
  brand. That last part is the developer's reading, not something the owner said.
- **Slot and why:** taken at once. The owner set the order, and no plan step was in progress.
- **What was done:**
  - One masthead on every view. With no search showing it is the home page's centrepiece: the
    name, one sentence, the search box, and links to the syntax guide and a random card. Once
    there is a search it is a bar across the top with the same three things.
  - The home page shows the three ways to search (describe the card, Scryfall syntax, both at
    once), each with examples that run.
  - Results: four tiles to a row on a laptop, three on a tablet, two on a phone, large enough
    to read the card. What was found and the three controls sit in a band under the header.
  - The card page is three columns on a wide screen: the picture, which stays in view while the
    page scrolls; the card's text with cost, type, rules, stats, printing, legality in two
    columns and the actions; and the printings with prices. Narrower, the printings go
    underneath; on a phone everything is one column.
  - A syntax guide at `/syntax`: fourteen sections and fifty examples, each a link that runs
    the search. A test compiles every example, so the guide cannot describe something that
    does not work.
  - A random card at `/random`, also in the header.
  - A footer with the same links, what the site is, where the data comes from, and the
    fan-content notice.
  - A search that finds nothing says so in the page, with the conditions it looked for and what
    to try, and an address with nothing at it has a page of its own.
- **Not in this pass:** a table view of results, an advanced search form, set pages, rulings,
  both faces of a two-faced card set out separately, and a preview when a link is shared.

### F-3. A card's exact name opens its page

- **From:** the project owner, 22 November 2026, after the redesign went live.
- **In their words:** "when you type in the name of the card "consecrated sphinx", if its an
  exact result, the card page will open instead of the search result".
- **How it was read:** a query that is a card's whole name should go to that card. "Exact" was
  taken to mean the name, not the number of results, because the two differ more often than
  expected: "consecrated sphinx" finds one card, but "lightning bolt" finds two (a second card
  has a face of that name) and "sol ring" three (Solemn Offering contains both words). Opening
  the card only when one card is found would have worked for the owner's example and failed
  for those. This reading is the developer's.
- **Slot and why:** next boundary, taken at once: nothing was in progress, and it is confined to
  the search, the endpoint and the page.
- **What was done:**
  - A query of plain words that is exactly a card's name, ignoring case, accents and
    punctuation ("urzas saga"), opens that card's page. The search returns the card as `exact`.
  - If other cards have those words in their names too, the card's page says so and links to
    the list ("See all 3"), which is the same search with `list=1` in the address.
  - A search of any kind that finds exactly one card also opens it, as on Scryfall.
  - The card takes the search's place in the browser's history, as a redirect would, so Back
    goes to where the search was made from and not to a list that would open the card again.
  - It does not happen when a term was left out with a warning, when a sort or "Show" control
    is set, or on a later page: then the list is what the reader asked for.
- **A consequence to know about:** a short name that is also part of many other names now opens
  the card: "shock" goes to Shock, "opt" to Opt, "forest" to Forest, each with the link to the
  others. Part of a name ("bolt", "lightning bol") still lists the cards.
- **Confirmed by the owner on 23 November 2026:** asked whether those short names should show
  the list instead, the answer was "open the card". It stays as built.

## From the interface study

On 22 November 2026 the project owner asked for a study of how Scryfall's interface is built
and behaves ([SCRYFALL_UI.md](SCRYFALL_UI.md)). It lists eighteen things their interface offers
that ours does not. These are the ones worth adopting, scheduled by the same slots. They are
structure and behaviour only: their name, logo, palette, typefaces, icons and wording are their
identity and are not copied.

| Id | Item | Size | Slot | Status |
|---|---|---|---|---|
| U-1 | Say what the query was understood to mean, and when a term cannot be used, drop it with a warning and run the rest instead of refusing the whole search | M | Next boundary | Done |
| U-2 | Card page: power and toughness as text, legality by format, and the card's printings listed with their prices | L | Next boundary | Done |
| U-3 | The position in the results kept in the address, with a pager, so a reload or a shared link opens at the same place | M | Next boundary | Done |
| U-4 | Sort key, direction, and cards / printings / illustrations as separate controls | S | With U-3 | Done |
| U-5 | A table view of results (set, number, name, cost, type, rarity, artist, prices) | M | With the browse tier (v0.2) | Open |
| U-6 | A preview image when a card's address is shared in a chat | M | With the browse tier, unless asked for sooner | Open |
| U-7 | Mana symbols drawn instead of written as `{W}` | S | Needs a decision: a symbol set whose licence allows it | Done with our own discs, which the owner chose to keep |
| U-8 | Rulings on the card page | L | With the browse tier: needs Scryfall's rulings file in the ingest | Open |
| U-9 | A sets index and set pages, an advanced search form, a random card | L | With the browse tier | Random card done with F-2; the rest open |

Larger tiles, a fuller empty state and a runnable syntax reference are in the study too; they
are small and can ride along with U-1 to U-4. (Larger tiles and the syntax reference were done
with F-2.)

### U-2. What the card's page shows

- **Taken on 22 November 2026**, at the boundary after the regex shorthands. It was scheduled
  after U-1, but U-1 waits for an answer and nothing in U-2 depends on it.
- **Size was L, not M:** printed power and toughness were not in the documents, only the numbers
  used for filtering. A display field was added and both collections were refreshed as field
  updates, with no re-embedding.
- **What was done:** the page gives power and toughness as printed ("*/1+*"), or loyalty or
  defense; legality in sixteen formats, as a word with a colour, not a colour alone; and the
  card's printings newest first with set, number, rarity, year and price. Each printing is a link
  to its own page, the one on screen is marked, and Back returns to the previous printing. A card
  with more than 60 printings lists the newest 60 and links to a search for all of them. A card
  opened from the results shows at once and the rest fills in when it arrives.
- **Not included:** rulings (U-8), and each face of a two-faced card set out separately.

### U-3 and U-4. Pages of results, and three controls

- **Taken on 22 November 2026**, at the boundary after U-2.
- **What was done:** results come 60 to a page. The page is in the address (`page=2`) and a pager
  below the results has First, Previous, Next and Last, which are links, so a page can be opened
  in a new tab, reloaded or shared. "Show more", which added to the grid and was lost on a
  reload, is gone. Above the results, one menu became three: what a result is (cards, printings
  or illustrations), the sort key, and the direction. All three are in the address.
- **What wins:** `unique:`, `order:` or `direction:` written in the query wins over the controls,
  and the "Show" control then shows what the query asked for.
- **Size was M, not S, for U-4:** the endpoint had no way to be asked for printings or
  illustrations except in the query, and a direction with no sort key was ignored.
- **Limits, said on the page:** results ranked by meaning have no total, so their pager has no
  Last and they end at 120. No result can be paged past 10,000; the pager says to narrow the
  search there.

### U-1. Saying how the query was read, and leaving out what cannot be used

- **Taken on 22 November 2026**, at the boundary after U-3 and U-4. Only the half that changes
  no earlier decision.
- **What was done:** a query in Scryfall syntax, or a card name, is said back in words under the
  status line, one entry for each condition that has to hold: `id:rg t:dragon -c:g` reads "its
  colour identity is within red and green", "the type includes “dragon”", "its colours do not
  include green". It says what was typed, including the defaults that are easy to forget (a bare
  `c:` means at least these colours, a bare `id:` means within them, a bare `m:` means at least
  this cost). Plain-English searches keep their own line ("filtered to ...").
- **The wording is ours.** Scryfall's sentence was not copied; only the idea of saying the query
  back.
- **Second half, decided and done on 22 November 2026.** Asked whether a term that cannot be
  used should be dropped with a warning instead of refusing the search, the owner answered
  "yes". This replaces the early rule that an unsupported keyword stops the search. What stays
  from that rule: nothing is ignored silently.
- **What was done:** a term is left out when its keyword is not supported yet (`lang:ja`) or its
  value makes no sense (`c:purple`, `mv:abc`). The page shows a line for each, with the term as
  typed and the reason, above the results, and the rest of the query runs: as syntax, as a card
  name, or by meaning, whichever the remaining words call for. A group that loses all of its
  terms goes with them. If nothing is left, the search is refused and every reason is given.
- **Before, for comparison:** an unsupported keyword refused the whole search, and a value that
  made no sense sent the whole query to plain-English search with no explanation.

### U-7. Symbols drawn instead of `{W}`

- **Decided on 22 November 2026:** asked whether to look for a symbol set with a licence the
  site can use, the owner answered "yes".
- **What the search found** (primary sources read on that day; this is a reading of the texts,
  not legal advice):
  - The Mana font by Andrew Gioia (github.com/andrewgioia/mana, version 1.18.0) covers every
    symbol the cards use. Its README licenses the font under SIL OFL 1.1 and the CSS under MIT,
    and says the symbol images themselves are copyright Wizards of the Coast.
  - Wizards' Fan Content Policy (last updated 15 November 2017) allows free fan content to use
    Wizards' material, but its FAQ lists the mana symbols among the "trademarks and logos that
    you may not include in your Fan Content" without prior written permission. Symbols inside a
    card image that is shown unchanged are allowed; that covers the card pictures this site
    already shows, not symbols drawn on their own.
  - Scryfall publishes symbol images, but its documentation refused to be read by a program
    and no licence for re-hosting those files was found.
  - So an open licence exists for a drawing of the symbols, but none of the candidates comes
    with Wizards' permission to use the symbols themselves. Most fan sites show them anyway;
    on the policy's wording that is tolerance, not permission.
- **What was done:** symbols are drawn as small discs of this site's own design, with the letter
  or number inside and a tint for each colour; a hybrid symbol is split corner to corner. They
  use no Wizards artwork. The brace code stays in the text, out of sight, so copying a card's
  text still gives `{T}: Add {G}`, and a screen reader hears "tap" and "green mana".
- **Decided by the owner on 23 November 2026:** "own lettered discs". Wizards' actual symbols
  are not used. Should that change, the Mana font is the candidate and the same hook draws
  either; it would rest on the policy question above.

