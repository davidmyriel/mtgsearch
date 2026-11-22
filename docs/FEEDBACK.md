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

## From the interface study

On 22 November 2026 the project owner asked for a study of how Scryfall's interface is built
and behaves ([SCRYFALL_UI.md](SCRYFALL_UI.md)). It lists eighteen things their interface offers
that ours does not. These are the ones worth adopting, scheduled by the same slots. They are
structure and behaviour only: their name, logo, palette, typefaces, icons and wording are their
identity and are not copied.

| Id | Item | Size | Slot | Status |
|---|---|---|---|---|
| U-1 | Say what the query was understood to mean, and when a term cannot be used, drop it with a warning and run the rest instead of refusing the whole search | M | Next boundary | Waiting: dropping a term reverses an earlier rule, asked of the owner |
| U-2 | Card page: power and toughness as text, legality by format, and the card's printings listed with their prices | L | Next boundary | Done |
| U-3 | The position in the results kept in the address, with a pager, so a reload or a shared link opens at the same place | M | Next boundary | Open |
| U-4 | Sort key, direction, and cards / printings / illustrations as separate controls | S | With U-3 | Open |
| U-5 | A table view of results (set, number, name, cost, type, rarity, artist, prices) | M | With the browse tier (v0.2) | Open |
| U-6 | A preview image when a card's address is shared in a chat | M | With the browse tier, unless asked for sooner | Open |
| U-7 | Mana symbols drawn instead of written as `{W}` | S | Needs a decision: a symbol set whose licence allows it | Waiting |
| U-8 | Rulings on the card page | L | With the browse tier: needs Scryfall's rulings file in the ingest | Open |
| U-9 | A sets index and set pages, an advanced search form, a random card | L | With the browse tier | Open |

Larger tiles, a fuller empty state and a runnable syntax reference are in the study too; they
are small and can ride along with U-1 to U-4.

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

