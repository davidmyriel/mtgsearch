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
| F-4 | 23 Nov 2026 | The home page's first impression: the search bar is the focus, relaxed, discreet, with room for a flavour of the week | M | Next boundary | Done |
| F-5 | 23 Nov 2026 | The logo's blocks materialize from left to right; the empty search box shows an example to try, a different one each visit | S | Now, with F-4 | Done, with the search fixed so that all four examples find what they promise |
| F-6 | 23 Nov 2026 | The home page's cards go with the example in the search box | S | Now, with F-5 | Done |
| F-7 | 23 Nov 2026 | Say "powered by TopK AI search" somewhere | S | Now | Done, where the developer recommended; the owner asked where, not yet confirmed |

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

### F-4. The home page's first impression

- **From:** the project owner, 23 November 2026, as an annotated picture of Scryfall's home
  page under the words "some ui feedback on scryfall's first impression".
- **In their words:** "1. the focus is on the search bar. 2. needs a simple relaxed search-like
  vibe. 3. essential information/config availabel in a discrete way. 4. flavour of the week type
  changes like christmas cards, anniversary, new set, always space for this". On the picture:
  "Stylish discrete background focus on the search bar"; "The search bar is big and thick enough
  to be the centre, inside darker than outside"; "As high as a MacBook air screen"; "News of the
  week"; "Few user choices discrete colour choice"; "Magic the gathering cards cutoff cool vibe
  each time a user comes back".
- **How it was read:** as what our own first screen should do, not as a request to copy theirs.
  The qualities are taken; their badge, starfield, colours and wording are not.
- **What was done:**
  - The first screen is as tall as the window and holds the name, one sentence, the search bar,
    two quiet links, and what is new. The three ways to search are below it.
  - The search bar is one thick piece with the button inside it, darker inside than the page
    around it, in the middle of the screen. On a computer it has the focus on arrival.
  - The background is a warm glow and faint rings centred on the bar. (Replaced later: see
    "on the background and a mark" below.)
  - What is new is automatic: the four newest sets, read from the index, each a link to that
    set. A set not yet released is marked "Preview".
  - A flavour of the week is one file, `public/flavour.json`: a line of its own above the sets,
    a search to draw the home page's cards from, and a look ("winter", "anniversary").
  - A few cards chosen at random, six on a laptop and three on a phone, sit along the bottom and
    differ on each visit. Each opens its page.
- **One thing done differently, and why:** on Scryfall those cards are cut off by the page.
  Scryfall's rules for anyone using its card images say "Do not cover, crop, or clip off the
  copyright or artist name on card images", and those are at the bottom of a card. So ours are
  whole and placed across the bottom edge of the first screen: the window cuts them, which
  gives the same first impression, and scrolling shows each one complete.
- **Changed with it:** a query in which nothing can be used no longer returns to the home
  screen, where the explanation would now be below the fold; the header stays a bar.
- **The owner's reply to the first version, 23 November 2026:** "dont like rounded corners, no
  need for search instructions below the cards, also you need to cut off the cards explicit order
  do it like scryfall".
  - **Rounded corners:** gone from the whole interface, not only the home page: the search bar,
    buttons, links, panels, tables and notes are square. Two things keep their shape, and this
    is the developer's reading: a card's picture, because a card has rounded corners and the
    picture would show white triangles without them, and the symbol discs, which are discs.
  - **Search instructions:** the three panels are removed. The home page is one screen and the
    footer. The syntax guide, one link away, is where the examples are. A query in which
    nothing can be used, and an address with no card, now show a short note with links
    instead of those panels.
  - **Cards cut off:** done as on Scryfall, on the owner's explicit order: seven cards in a fan,
    every other one lower and in front, cut off by the bottom of the first screen; on a phone
    the middle of the fan shows. Each links to its page, where the card is whole. The developer
    had kept the cards whole because Scryfall's rules for users of its images say "Do not
    cover, crop, or clip off the copyright or artist name on card images"; the owner was told
    this and decided otherwise. The risk is the owner's: Scryfall could object to the home
    page. Going back is a small change to the stylesheet.
- **Later the same day:** "footer different colour, darker". The footer has a colour of its own,
  darker than the screen above it.
- **And:** "the homepage cards should have something in common, how are you picking them right
  now". They were drawn from the whole card pool with nothing to join them. Now each visit has
  a theme and its seven cards all belong to it: about one visit in three it is the newest set
  that is out, and otherwise a kind of card that shows at a glance (Dragons, Angels, Demons,
  Elves, Goblins, Zombies, Wizards, Merfolk, Vampires, Dinosaurs, Sphinxes, Planeswalkers,
  Sagas, Vehicles). The cards are drawn from the sixty most played of the theme, so they are
  ones people know. Which things can join them is the developer's choice and is one list in
  `app/home.ts`; `public/flavour.json` can still name a search of its own for an occasion.
  The theme is not named on the page, as on Scryfall's; a screen reader is told it.
- **Then, on the background and a mark:** "you see how scryfalls background is a circle that
  looks like a tunnel? the visual effect is that the user's view is centered on the search in
  the middle. can we find a creative way to get the background to get the visitor to focus on
  the search in the middle, background should be very subtle. also the search bar should have a
  circular logo just like scryfall but the topK logo or something similar".
  - **The background, first version:** a corridor seen from its far end, with the search bar
    as the far end: seven steps around the bar, each the bar's outline drawn larger and
    fainter, and a hairline from each corner of the bar out through the corners of the steps.
    The owner's reply is below; it was replaced the same day.
  - **The mark:** a disc at the left end of the search bar, where Scryfall's study records
    theirs (inside the field at the left), on the home page and in the header of every page.
    It is TopK's K, drawn in squares as in TopK's own icon (`docs/icons/topk-icon.svg` in
    TopK's repository) and in TopK's orange, on a dark disc with the bar's own outline. The
    mark is TopK's; it is used because the owner asked for it. Pressing it puts the cursor in
    the box. It does not link anywhere. The browser tab's icon is the same disc, replacing a
    magnifying glass on a rounded square.
- **The owner's reply to that, and two more things:** "theres no need to have 'back to the
  results' link. people will either return using the browser or continue to search in the
  search bar up top. i believe thats how scryfall works, look at their results. no need for the
  search button either, people will just hit enter in the real life. background looks choppy
  not smooth enough".
  - **The link back:** removed from a card's page. The browser's Back returns to the results,
    which are kept as they were, and the search bar is at the top of every page. The study of
    Scryfall's card page records no such link there either. The Escape key still leaves a card
    that was opened from results; nothing on the page says so.
  - **The Search button:** removed from the bar on every page; the box runs to the bar's right
    end. Enter searches, and a phone's keyboard shows its own search key. The study records
    the same on Scryfall: "no visible button, Enter submits", with a button kept out of sight
    for assistive technology. Ours is kept the same way, and out of the tab order.
  - **The background:** the steps and hairlines were edges, and edges are what looked choppy.
    Now nothing in it has an edge. Light gathers on the bar and eases away to nothing in every
    direction, and a few soft rings spread from the bar like ripples, each a slow rise and
    fall of that light, fading with distance. Both are drawn from the bar, so they stay
    centred on it on any screen. A very fine grain lies over the whole background
    (`public/grain.svg`): a screen has only so many dark tones, and a slow change between them
    can show as faint contour lines, which the grain hides. Measured on a laptop-sized
    picture, the largest jump between two neighbouring points fell from 8 tones (the steps)
    to 5, and that 5 is the grain itself, not a line. The "anniversary" look lost its
    hairline rings for the same reason.
- **And on the words above the bar:** "we dont need the text 'find a magic card by its
  scryfall syntax, by its name etc.....'. we do however needs a title instead of mtgsearch that
  signals its a much deeper closer version of scryfall search".
  - **The sentence:** removed. The first screen is the title, the bar, two links, what is new
    and the cards.
  - **The title:** "Scry Deeper", in place of "mtgsearch", on every page and in the browser
    tab. The choice of words is the developer's proposal: "scry" is the game's own word for
    looking ahead and the root of Scryfall's name, so it points at that kind of search
    without using their name, which their terms do not allow in a way that suggests their
    backing; "deeper" is the claim, that it also finds a card from what you remember of it.
    Others considered: "Deepscry", "Scry Closer", "Deep Scry". The project, the repository
    and the Netlify address keep the working name `mtgsearch`. Changing the title is one
    line in each of the three pages and one in `public/app.js`; a test keeps them the same.
- **The name, decided by the owner the same day:** asked for names like Scryfall's that
  stand for deep search, then of one on the list: "Tutor is great, people know whenever they
  play a tutor they are finding exacrlt what they need. give me more options", and then:
  "TutorK. and use the same design as topK on the website logo with the blocks orange and
  black".
  - **The name** is TutorK on every page and in the browser tab, in place of the stand-in
    "Scry Deeper". A tutor is what players call a card that finds exactly the card they need;
    the K is TopK's.
  - **The logo** is the name in the blocks of TopK's own logo (`docs/logo/topk.svg` in TopK's
    repository): squares on a grid five rows tall, with the same spacing. T, O and K are
    TopK's letters; U and R are drawn to match them (R is TopK's P with K's lower arm). The K
    is TopK's orange. It is a picture, `public/wordmark.svg`.
  - **One thing read by the developer:** "orange and black". TopK's logo on a light page is
    dark letters with an orange K, and on a dark page light letters with an orange K. Our
    header is dark on every page, where black blocks would not show, so TUTOR is light and K
    is orange, which is TopK's own dark-background version; the black is the ground. The
    disc in the search bar is the orange K on black. If the owner meant every block orange,
    or wants a light header so the letters can be black, it is one colour in one file.

### F-5. The logo builds itself, and the empty box shows what to try

- **From:** the project owner, 23 November 2026, in three messages.
- **In their words:** "can you do the animation where blocks materialize from left to right".
  Then, on the empty search box: "in the search box say something along the lines: 'you don't
  need the exact text to find your card'. shorter but you know what im talking about". Then,
  of the first attempt ("No exact text needed"): "No exact text needed is indirect, people
  want tget it, need to tell them what to do. give them an example thats random every time in
  the search box. sphinx that draws two cards, dwarf that destroys lands, tithe alternative,
  blue land destruction".
- **The animation:** on arrival at the home page the name's squares appear column by column
  from the left, the squares of a column not quite together, each fading in; it takes about a
  second. It is a second picture, `public/wordmark-appear.svg`, made with the still one by
  `tools/make_wordmark.py`, and it moves by SVG's own animation elements, because a picture
  shown through `<img>` may carry neither a stylesheet nor a script under the site's
  Content-Security-Policy. The developer's choices: it plays once, on the home page only
  (results and card pages show the name still); anyone who has asked their device for less
  motion gets the still picture; a browser that does not animate shows every square at once.
- **Found while testing it:** the name and the search bar jumped about 130px upward when the
  news and the cards arrived, a moment after the page opened, which the animation made
  obvious. The news and the cards now keep their room from the start, and the bar stays
  where it is (measured: within 1px at four screen sizes).
- **The empty box:** shows "Try: " and one of the owner's four examples, drawn afresh on each
  visit. The developer added one thing: Enter in the empty box tries the example shown, since
  there is no button and the example would otherwise have to be typed out. On a phone the
  example is set smaller than what is typed, so the longest one shows whole at 320px. The
  two pages without a script (the syntax guide and "not found") always show the first.
- **What the four examples found at first, said plainly:** two did what they promise and two
  did not. "sphinx that draws two cards" found Consecrated Sphinx first; "dwarf that destroys
  lands" found Dwarven Blastminer, Mine Layer, Dwarven Driller, Dwarven Miner. "tithe
  alternative" found Capenna Express, Mr. House, Alms of the Vein: the search read the two
  words by their meaning and did not know Tithe is a card whose effect is wanted. "blue land
  destruction" found blue double-faced lands: it read "land" as the kind of card wanted.
- **Both were faults of the search and are fixed, the same day, without touching the index:**
  - A query that names a card and asks for others like it ("tithe alternative", "cards like
    sol ring", "a cheaper replacement for force of will") looks the card up and searches by
    that card's own text, leaving the card out. "tithe alternative" now finds Gift of Estates,
    Land Tax, Scholar of New Horizons, Oreskos Explorer. The line above the results says
    "cards that do what Tithe does". If no card has that name the query is read as before.
  - A type word followed by what is done to it ("land destruction", "creature removal",
    "artifact hate") is not a filter; a colour before it still is. "blue land destruction"
    now finds Erosion, Volcanic Eruption, Mana Vortex.
  - The frozen relevance set gave the same results on all 31 queries before and after. The
    four examples are now checked against the live index by the tests.
- **Known limits, the developer's note:** "budget" and "cheaper" are read but do not yet
  filter by price; a nickname or part of a name ("bolt alternative") is not found; and "white
  creature tutor" still ranks poorly, because the index does not know "tutor" as the players'
  word for searching a library. That last one matters for a site of this name and is in the
  plan.

### F-6. The home page's cards go with the example in the search box

- **From:** the project owner, 23 November 2026.
- **In their words:** "wouldnt it be cool if the homepage random cards were somehow related to
  the sample semantic query in the search bar".
- **What was done:** the seven cards are the results of the example the empty box is showing.
  "Try: tithe alternative" stands over Land Tax, Gift of Estates and Knight of the White
  Orchid; "Try: dwarf that destroys lands" over Dwarven Miner and Dwarven Blastminer. So the
  first screen shows what the search does before anything is typed, and Enter in the empty
  box opens the list those cards come from.
- **How they are drawn, the developer's choices:** the first three results are always among
  the seven, and the other four are drawn from the eleven that follow, so the cards differ
  from visit to visit and stay on the point. The closest result is in the middle of the fan,
  which is the part a phone shows.
- **What it replaced:** the themes of earlier the same day (Dragons, Angels, the newest set).
  They remain as the fall-back if an example ever finds too few cards. A search named in
  `public/flavour.json` for an occasion still takes the place of both.
- **Cost:** one search per example per minute at most, since the answer is held by the CDN
  for a minute for each of the four.

### F-7. Whose search it is

- **From:** the project owner, 23 November 2026.
- **In their words:** "where should we put 'powered by topk AI search'".
- **The developer's answer, built so it can be seen:** on the home page, one small line
  directly under the name and above the search bar, with "TopK" in TopK's orange and linking
  to topk.io. It explains the orange K at a glance, shows on every size of screen and leaves
  the bar itself alone. And one sentence in the footer of every page, which had not named
  TopK at all. Not inside the bar: on a phone it would crowd out the example.
- **Open:** the owner asked where and has not yet said yes to this place. Moving it is a
  small change.

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
| U-5 | A table view of results (set, number, name, cost, type, rarity, artist, prices) | L | With the browse tier (v0.2) | Done, brought forward by the owner |
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

### U-5. Results as a table

- **Decided on 23 November 2026.** Shown a mock-up and told it follows Scryfall's "Checklist",
  the owner said: "build it with usd eur and tix".
- **What was done:** a View control beside the others switches between pictures and a table,
  and the choice is in the address (`as=table`) and carries over to the next search. A row has
  the name, the cost drawn as discs, type, set and number, rarity, artist, and prices in US
  dollars, euros and Magic Online tickets. Every row is one line; text that does not fit is
  cut short and given in full as a tooltip. The Name, Cost, Rarity and price headings sort,
  and choosing one again turns the order round. On a laptop the card's picture follows the
  pointer over a row. A row opens its card, and Back returns to the table.
- **On a phone** there is no room for nine columns, so the table is a list: name and cost,
  then type, then set and number, with one price at the right (the one the results are sorted
  by, else dollars). Scryfall keeps a wide table that scrolls sideways; this does not.
- **Size was L, not M:** card records held only a dollar price. They now carry euros and
  tickets too, written by the nightly job as field updates with no re-embedding.
- **Different from Scryfall's:** no language column (only English printings are held), 60 rows
  to a page as everywhere else, and no sorting by set or artist, which the search does not
  offer yet.

