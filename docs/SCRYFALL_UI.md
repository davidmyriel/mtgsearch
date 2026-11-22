# Scryfall interface study, for mtgsearch

Studied on 22 November 2026 (21:41 to 21:54 UTC). The purpose is to understand how Scryfall's interface is built and behaves so that mtgsearch can decide which structure and behaviour to adopt. Nothing here is meant for copying their brand: the logo, name, artwork, stylesheets and scripts were not saved. Screenshots named below were taken for reference and are not in the repository (see Files at the end).

Contents

1. Method, visit log, refusals
2. How the site is built (facts common to every page)
3. Shared chrome: header, footer, page frame
4. Page by page
5. Design tokens
6. What Scryfall's UI offers that mtgsearch's does not
7. What I could not verify

---

## 1. Method, visit log, refusals

### robots.txt

Fetched first with curl (HTTP 200). The whole file:

```
User-Agent: *
Disallow: /admin
Disallow: /admin/*/*
Disallow: /400
Disallow: /404
Disallow: /406
Disallow: /422
Disallow: /500
Disallow: /503
Disallow: /504

Sitemap: https://scryfall.com/sitemap.xml
```

Every path visited is outside those rules.

### How the pages were read

- The pre-installed Playwright Chromium, launched with no options. No user-agent change, no stealth, no extra headers.
- One browser, one tab, one page at a time. Each page was loaded once and then measured in place: computed styles read with `getComputedStyle`, the viewport resized to find breakpoints, Tab pressed to see focus styles, the pointer moved to see hover states.
- Desktop is a 1280x800 viewport and phone is a 390x844 viewport, both at device scale factor 2. The phone view is the same page load resized, not a second load, and has no touch emulation and no phone user agent. Layout that depends only on width is therefore right; anything that depends on touch or on a phone user agent is not covered.
- The Scryfall API was not called. The request log saved with each page snapshot shows only `scryfall.com`, `cards.scryfall.io` (card images) and the site's analytics hosts (Google Tag Manager and Analytics, Cloudflare Insights). Requests made after the last snapshot of a page, for example when a hover preview loaded an image, were not logged.
- Things I did on pages beyond looking: changed the "as" select on the results page twice (that is what caused loads 3 and 4 below); pressed `/`, `j`, arrow keys and Tab; opened the phone "View" panel and "Menu"; pressed "Transform" on a double-faced card; typed "sph" into the type picker of the Advanced Search form and pressed Enter (a local widget; no request was sent and the form was not submitted). I typed nothing into a Scryfall search box and submitted no form.

### Visit log (13 page loads, 19 seconds or more apart)

| # | Time (UTC) | Address | HTTP |
|---|---|---|---|
| 1 | 21:41:46 | `https://scryfall.com/` | 200 |
| 2 | 21:42:54 | `https://scryfall.com/search?q=t%3Asphinx` | 200 |
| 3 | 21:45:32 | `https://scryfall.com/search?q=t%3Asphinx&as=checklist` (reached by changing the display select) | 200 |
| 4 | 21:46:18 | `https://scryfall.com/search?q=t%3Asphinx&as=full` (same way) | 200 |
| 5 | 21:46:37 | `https://scryfall.com/card/trk/14/dr-mccoy-surly-surgeon` | 200 |
| 6 | 21:48:24 | `https://scryfall.com/sets/ima` | 200 |
| 7 | 21:49:08 | `https://scryfall.com/sets` | 200 |
| 8 | 21:49:52 | `https://scryfall.com/advanced` | 200 |
| 9 | 21:51:11 | `https://scryfall.com/docs/syntax` | 200 |
| 10 | 21:52:24 | `https://scryfall.com/docs/regular-expressions` (linked from the syntax guide; needed for the regex shorthands) | 200 |
| 11 | 21:53:08 | `https://scryfall.com/search?q=t%3Asphinx&as=text` | 200 |
| 12 | 21:53:33 | `https://scryfall.com/card/isd/51/delver-of-secrets-insectile-aberration` (a double-faced card, to see the image control) | 200 |
| 13 | 21:53:54 | `https://scryfall.com/search?q=t%3Asphinx+pow%3E20+foo%3Abar` (a search with no matches and an unknown keyword) | 404 |

Load 13 answered 404 with an ordinary, fully rendered "No cards found" page. That is how Scryfall answers a search with no results; it is not a refusal. It was also the last load planned.

Our own site, `https://topkmtg.netlify.app/`, was loaded once (200); one search and one card were opened inside it, and both viewports were measured from that load.

### Refusals

None. No 403, no challenge page, no captcha, no rate-limit response.

### Text addressed to automated agents

None found. On every page I looked at the visible text, text in hidden elements, HTML comments and meta tags. All HTML comments were empty. The word search for agent-directed language (AI, LLM, bot, crawler, automated, instructions and similar) matched only ordinary content: the footer link "Slack & Discord Bots", the help menu's "Slack Bot" and "Discord Bot", the set codes BOT (Transformers) and GPT (Guildpact), and the creature type "Robot". The only text on the site aimed at automated clients is robots.txt, quoted above.

---

## 2. How the site is built

| Fact | Value |
|---|---|
| Rendering | Server-rendered HTML. Every page arrives complete; the card grid, tables and card text are in the first response. JavaScript adds behaviour (select-to-navigate, tooltips, menus, keyboard), not content. |
| Assets | One stylesheet (1,529 top-level rules, 1,728 with nested ones), one script bundle, both fingerprinted under `/assets/`. Web fonts are self-hosted. |
| Third parties | Google Analytics / Tag Manager and Cloudflare Insights. |
| Card images | `cards.scryfall.io`, preconnected. Three sizes seen: "grid" 488x680 WebP in the results grid, "display" 672x936 WebP on the card page (shown at 336x468), "large" for hover previews. |
| Requests per page | Home: 1 document, 1 stylesheet, 1 site script, 2 fonts, 9 images, analytics. Results grid: the same plus 60 card images. Card page: 1 card image, 4 fonts. |
| Headers | Served through Cloudflare, `via: heroku-router`. HTML is `cache-control: no-store`. Strict CSP starting `default-src 'none'`, `x-frame-options: DENY`, HSTS with preload. |
| Head metadata | `viewport` width=device-width; description; Open Graph and Twitter card tags on every page (the card page sets `og:type=product`, `og:image` to the card image, `twitter:label1/data1` "Printed / Star Trek, Uncommon", `twitter:label2/data2` "Average Price / $0.22"); `rel=canonical` on the card page; an oEmbed alternate on the card page; an OpenSearch descriptor (`rel=search`), an Atom feed, a web manifest, touch icons; `format-detection` off for telephone, address, email. |
| Structured data | JSON-LD `Organization` and `WebSite` (with a search action) on every page; `BreadcrumbList` and `Product` (name, description, sku, brand, offers, image) on the card page. |
| Behaviour hooks | Elements carry `data-component` names: `header`, `homepage-search`, `search-controls`, `search-controls-mobile`, `card-tooltip`, `card-backface-button`, `notification-tray`, `deck-tray`, `reference-doc-menu-expander`. Four `template` script blocks hold markup for trays (notifications, deck, admin, caster). |
| Libraries | Select2 on the Advanced Search form's pickers (class names `select2-*`). Nothing else identifiable from the DOM. |
| `html lang` | `en`. Card name, type line and rules text carry their own `lang="en"`. |
| Dark mode | None. The stylesheet has no `prefers-color-scheme` rule and no `color-scheme` meta; emulating a dark preference changed no colour. |
| Print | 9 rules under `@media print` (not rendered). |
| Motion | No `prefers-reduced-motion` rule. Transitions are short: 0.05s on button colours, 0.2s on card faces, 0.3s on the home collage. |

---

## 3. Shared chrome

### Page frame

- `body` background is the dark header colour `#2b253a`; the content area `div#main` paints `#f5f6f7` over it. The dark shows only above and below content (header, footer, overscroll).
- Every band (header, controls, info line, grid, footer) is full width with side padding of 2.5% of the viewport (32px at 1280, 9.75px at 390) and an inner column of `max-width: 1000px`, centred. Below about 1053px the column becomes fluid.
- Body text: Lato 15px, colour `#16161d`.

### Header (every page except the home page)

Screenshot: `desktop-results.png`. Height 52px, background `#2b253a`, not sticky (it scrolls away).

Left to right at desktop width:

1. Logo mark, 34px, a link to `/` with hidden text "Scryfall" and `title="Back to homepage"`.
2. Search form (`GET /search`). One text field that fills the remaining width (547px at 1280): 16px/22px, text `#fdfdfd`, transparent background, no border, a 16px magnifier drawn as a background image at the left, placeholder "Search for Magic cards…". Attributes: `autocomplete="on" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="1024"`. A visually hidden label "Search for Magic cards" and a visually hidden submit button "Find Cards"; there is no visible button, Enter submits.
3. Hidden inputs `unique`, `as`, `order` inside the same form, holding the current display settings, so a new search from the header keeps the display mode and sort the reader had chosen.
4. A thin divider (1px, white at 40%).
5. Four links, each a 16px line icon plus a word: Advanced (`/advanced`), Syntax (`/docs/syntax`), Sets (`/sets`), Random (`/random`). 14px/22px, white at 75%; on hover or focus they turn full white and underlined.
6. Divider, then two icon-only links with hidden text: "Your decks" (`/account/decks`) and "Sign In" (`/settings`).

What the field holds: the current query on a results page (`t:sphinx`), the equivalent query on a set page (`set:ima`), nothing on a card page or docs page.

Keyboard: pressing `/` anywhere focuses the header field (verified; the slash is not typed into it).

Below 800px wide the links are replaced by a single bordered button (35x28 at 390, an icon; its "Menu" label is hidden at phone width). Pressing it opens a panel under the header row, in the document flow, so the header grows from 52px to 181px and pushes the page down. The panel holds five buttons in two columns, 182x28 each: Advanced Search, Syntax Guide, All Sets, Random Card, Your Account. Screenshot: `phone-results-menu-open.png`. The button has no `aria-expanded` and no `aria-label`, and because its "Menu" label is `display: none` at phone width it has no accessible name there.

### Footer (every page)

Background `#19181f`, padding 30px / 2.5% / 68px. Five columns, 160px each with a 10px gap: Cards (Advanced Search, Syntax Guide, All Sets, Random Card), Scryfall (bots, FAQs, blog, Tagger, MTG Wiki, Art Game, April Fools Archive), Account (Your Account, Register, Terms, Contact, Privacy), Developers (API Documentation, Card Objects, Card Imagery, Bulk Data, API Changelog), More (team, donate, Patreon, Bluesky, GitHub). Column headings are `h6`, 12px bold uppercase `#999999` with a 1px rule beneath. Links are 14px/21px `#cccccc`. Under the columns, four paragraphs of legal text, 12px, `#444444`, max-width 700px: the Wizards fan-content notice, third-party logo notice, a prices disclaimer, and the copyright line.

Below 600px the columns stack into one centred column and the legal text is centred (`phone-home-full.png`).

### Skip links

The first two focusable elements on every page are "Skip to main content" (`#main`) and "Skip to footer" (`#footer`). They sit off screen and appear at the top left when focused: 16px, `#0000ff` on `#fffae3`, 1px border, 2px radius.

### Button and select style (used everywhere)

One component, 28px tall, used for links, buttons and selects.

| State | Text | Background | Border | Other |
|---|---|---|---|---|
| Default | `#551a8b`, 14px/18px, weight 700 | `#f9f7f5` | 1px `#551a8b` at 50% | radius 3px, padding 0 10px, shadow `0 1px 1px rgba(0,0,0,.06)`, `white-space: nowrap` |
| Hover or focus | same | `#ffffff` | 1px solid `#634496` | 0.05s colour transition |
| Disabled | black at 25% | `#f5f6f7` | 1px black at 25% | `cursor: not-allowed`; rendered as a `span` with `aria-hidden="true"` |
| Primary | `#ffffff` | `#634496` | none visible | used for "Search with these options" on phone |
| On dark ("inverted") | `#ffffff` | white at 9% | 1px white at 60% | hover: white at 15%, border solid white |
| Icon only | | | | `min-width: 32px`, a 14px icon, hidden text label |

Selects use the same box with `appearance: none`, an up/down chevron as a background image at the right, and padding `0 22px 0 10px`.

---

## 4. Page by page

### 4.1 Home page

Screenshots: `desktop-home.png`, `desktop-home-full.png`, `phone-home.png`, `phone-home-full.png`.

Regions, in order:

1. Hero, a single dark panel with a background image and no header bar. At 1280x800 it is exactly one viewport tall (800px); at 760px wide and below it measured 720px, and 760px at 390x844.
   - An `h1` exists ("Scryfall is a powerful Magic: The Gathering card search") but is `display: none`.
   - A seasonal badge (a tenth-anniversary mark), 224px, 160px below 400px wide.
   - The search form (`GET /search`), max-width 524px, centred. One field, 64px tall, 30px text (56px and 24px at 760px wide and below; the switch is somewhere between 761 and 800), padding `12px 14px 12px 62px`, 1px border `#ffd041`, 2px radius, shadow `0 0 2px rgba(0,0,0,.5)`. The logo mark (44px, a link to `/`) sits inside the field at the left. No placeholder, no visible button; a visually hidden submit button "Find cards". `tabindex="1"`, `autocomplete="on"`, `maxlength="1024"`.
   - Four quick links as translucent buttons at 75% opacity: Advanced Search, Syntax Guide, All Sets, Random Card.
   - A news list: four lines, each an 11px uppercase pill ("NEW", blue `#3497be` or orange `#f64800`, 4px radius) and an italic 14px title, linking to a set page or a prepared search. White at 80%, full white on hover.
   - A collage of seven card images (168x234 each, overlapped and cropped by the bottom edge of the hero), each a link to that card's page.
2. Footer.

There is nothing else: no example queries, no explanation of syntax, no result preview. The page is a search box, four doorways and news.

Phone (390 wide): the same order. The field is 351x56 with 24px text. The four buttons wrap to two rows (three, then one). The collage shows the middle of the fan, cropped at both sides. The footer stacks.

Accessibility notes: the home field has no label, no `aria-label` and no placeholder, so it has no accessible name; the logo link inside it is the only text near it. The field appears to be focused on load (see section 7).

### 4.2 Search results, image grid (the default)

Screenshots: `desktop-results.png`, `desktop-results-full.png` (whole page, 34 MB), `desktop-results-searchfocus.png`, `phone-results.png`, `phone-results-full.png`, `phone-results-view-options.png`, `phone-results-menu-open.png`.

Regions, in order:

1. Header.
2. Controls band. Background `#f3f5f8`, 1px bottom border `#634496` at 10%, 12px vertical padding, 53px tall in total.
3. Info line. Background `#f6f4fa`, same border, 38px tall.
4. Card grid. 20px above, 15px below.
5. The controls band again, identical, under the grid.
6. Footer.

The page has no `h1` to `h5`. The only headings are the footer's `h6`s.

#### Controls band, left group (display options)

Four native selects with visible word labels between them, reading as a sentence: **[Cards] as [Images] sorted by [Name] : [Auto]**.

| Select | `name` | Tooltip (`title`) | Options (value = label) | Default |
|---|---|---|---|---|
| What counts as a result | `unique` | "Change how cards are found" | `cards` = Cards; `prints` = All prints; `art` = Unique art | `cards` |
| Display mode | `as` | "Change how cards are displayed" | `grid` = Images; `checklist` = Checklist; `text` = Text Only; `full` = Full | `grid` |
| Sort order | `order` | "Change how cards are sorted" | `name` = Name; `released` = Release Date; `set` = Set/Number; `rarity` = Rarity; `color` = Color; `usd` = Price: USD; `tix` = Price: TIX; `eur` = Price: EUR; `cmc` = Mana Value; `power` = Power; `toughness` = Toughness; `artist` = Artist Name; `edhrec` = EDHREC Rank; `review` = Set Review | `name` |
| Direction | `dir` | "Change sort direction, ascending or descending" | (empty) = Auto; `asc` = Asc; `desc` = Desc | Auto |

Labels: "Show" (visually hidden) for the first, "as", "sorted by", and ":" (with `title="Sort direction"`) for the others.

Behaviour: there is no Apply button on desktop. Changing a select navigates at once to a new address (verified with the display select). The address that results carries only what differs from the defaults: choosing Checklist went to `/search?q=t%3Asphinx&as=checklist`.

#### Controls band, right group (pagination)

Five buttons: first page (icon only, hidden text "First Page"), "Previous" with a left chevron, a shuffle icon (`title="Find a random card within this search"`, `href="#"`, handled by script), "Next 60" with a right chevron, last page (icon only, "Last Page"). On page one the first two are the disabled variant. The "Next" label states the page size, which depends on the display mode:

| Display mode | Results per page | "Next" label |
|---|---|---|
| Images | 60 | Next 60 |
| Text Only | 60 | Next 60 |
| Full | 20 | Next 20 |
| Checklist | 175 | Next 175 |

Page addresses use `page=2` alongside the other parameters (`/search?as=grid&order=name&page=2&q=t%3Asphinx+&unique=cards`).

#### Address parameters seen

`q`, `unique`, `as`, `order`, `dir`, `page`. When a search finds nothing the site also adds `extras=true` and `lang=any` (see 4.6).

#### Info line

"**1 – 60 of 91 cards** where the card types include “sphinx”". The count is `#634496`, weight 500, with "of" in italic; the rest is `#535353`, 14px. The second half is a plain-English restatement of how the query was parsed. With two conditions it read "where the card types include “sphinx” and the power > 20". In Checklist mode, where everything fits on one page, it read "91 cards where…".

#### The grid

- A flex container, `flex-wrap: wrap; justify-content: space-between`, inside the 1000px column. Items have a width in percent, so the gap is whatever is left over.
- Each item is one link (`a`) to the card's page, containing the image and nothing visible besides it. No caption, no name, no price under the image in this mode.
- Image: `alt` and `title` are both "Aerid Konstrari (Reality Fracture #121)", that is, name, set name and collector number. `border-radius: 4.75% / 3.5%`, shadow `1px 1px 6px rgba(0,0,0,.45)`. While loading, the box shows diagonal grey stripes (a repeating gradient at -55 degrees). The first 13 images are `loading="eager"`, the other 47 `loading="lazy"`.
- Over each image, at the top where the printed name is, sits a transparent text copy of the card name (14px, colour fully transparent, `aria-hidden="true"`, z-index above the image). It makes the browser's find-in-page land on the right card and lets the name be selected, while a screen reader gets the name from the image's `alt` instead.
- Hover does nothing to the tile (no lift, no shadow change). Keyboard focus draws a 4px ring in `#af7cf0` around the card (a box shadow).

Columns and sizes by viewport width:

| Viewport width | Columns | Tile size | Horizontal gap | Row pitch |
|---|---|---|---|---|
| 1920, 1600, 1440, 1280 (column fixed at 1000px) | 4 | 245 x 341 | 6.7px | 350px (tile + 9px) |
| 1000 | 4 | 233 x 324 | 6.3px | |
| 920 (smallest with 4) | 4 | 214 x 298 | | |
| 919 | 3 | 286 x 398 | | |
| 800 | 3 | 249 x 347 | 6.7px | |
| 660 (smallest with 3) | 3 | 205 x 286 | | |
| 659 | 2 | 308 x 430 | | |
| 390 | 2 | 182.5 x 254 | 5.5px | 263px |
| 320 | 2 | 150 x 209 | | |

Tile widths are 24.5%, 32.75% and 49.25% of the column for 4, 3 and 2 columns. The row gap is a fixed 9px bottom margin.

#### Phone layout (390 wide)

- Header: logo, field (298px wide), menu button.
- The desktop controls band is hidden below 860px. In its place a form (`GET /search`, with the query in a hidden input) shows one row of three buttons: Previous, **View**, Next 60, spread edge to edge.
- Pressing View opens a panel under that row (dashed top border): four labelled selects, one per line, right-aligned labels "Find", "Display as", "Sorted by", "Sort direction" (130px label, 185x28 select), then a filled button "Search with these options" and a plain button "Random card from search". Here the selects do not navigate on change; the reader sets several and presses the button. While the panel is open the View button is drawn filled. Screenshot: `phone-results-view-options.png`.
- Info line: 12px, centred, 31px tall (the smaller size starts below 760px).
- Grid: two columns.
- The same three-button row repeats under the grid.
- Controls stay 28px tall on phone.

### 4.3 Search results, Checklist

Screenshots: `desktop-results-checklist.png`, `desktop-results-checklist-full.png`, `desktop-results-checklist-hover.png`, `phone-results-checklist.png`.

A table, one row per card, all 91 results on one page.

| Column | Header | Content | Sortable (header is a link) |
|---|---|---|---|
| 1 | Set | set code, with the set's full name as an `abbr` tooltip | yes (`order=set`) |
| 2 | № (tooltip "Collector Number") | number, right-aligned | no |
| 3 | Name | card name; ellipsis if too long | yes (`order=name`); shows ▲ when it is the current sort |
| 4 | Cost | mana symbols as 15px icons | yes (`order=cmc`) |
| 5 | Type | shortened type ("Lgd. Creature", "Artifact Creature"), no subtypes | no |
| 6 | R (tooltip "Rarity") | one letter: C, U, R, M, with the word as a tooltip | yes (`order=rarity`) |
| 7 | La (tooltip "Language") | language code | no |
| 8 | Artist | artist name | yes (`order=artist`) |
| 9 | USD | price, `#124cd5`, right-aligned, links to a seller; tooltip "Nonfoil: $2.49, Foil: $3.01" | yes |
| 10 | EUR | price, `#8b3f8a`, links to a seller | yes |
| 11 | TIX | price, `#da4100`, links to a seller | yes |

Details:

- Header cells: 12px bold uppercase, padding `5px 0 5px 6px`. Clicking a sortable header loads the same search with `order` and `dir` set; clicking the current one reverses it (the Name link pointed to `dir=desc`).
- Body: 14px/20px, rows 32px tall, 1px bottom border `#e0dee3`, every second row tinted with black at 5%.
- Every cell is a link to the card page, so the whole row is clickable, but only the name link is in the tab order (the others have `tabindex="-1"`). Price cells link out instead.
- Hovering a row tints it (`rgba(101,82,0,.075)`) and shows the card image, 244x340, floating beside the pointer (`pointer-events: none`). The image address comes from a `data-card-image-front` attribute on the row.
- One row is marked as current with a 2px `#551a8b` left border. Pressing `j` moved the mark to the next row (verified). I did not test `k` or Enter.
- The table has `min-width: 768px`. On phone its wrapper scrolls sideways; the page itself does not.
- No `scope` attributes on header cells, no caption.
- After the last row, a line of small italic grey text (12px, `#aeaeae`) marks the end of the results. The wording is a joke in a card's voice and differs from page to page.

### 4.4 Search results, Text Only

Screenshots: `desktop-results-text.png`, `phone-results-text.png`.

A grid of text boxes, 60 per page, no images. Each box is one link to the card and is the same component as the text block on the card page: white, 3px black borders top and bottom, name and mana cost (16px), type line (15px), rules text (15px), power/toughness (15px bold), each part separated by a 1px line. Boxes in a row have their own heights. Three columns of 322px at desktop width, two below roughly 700 to 760px, one at phone width.

### 4.5 Search results, Full

Screenshots: `desktop-results-full-view.png`, `desktop-results-full-view-long.png`.

Twenty cards per page, each shown as the complete top section of a card page (image, text box with legality, and the prints column), separated by dashed rules. In this mode the prints column also showed a "Faces, tokens, & other parts" table for a card that makes a token (the card's other printing and the token, each a link).

### 4.6 Search with no results, and warnings

Screenshot: `desktop-results-empty.png`.

- HTTP status 404, with the normal page frame.
- The address I asked for was redirected to one with `extras=true&lang=any` added (and the default `as`, `order` and `unique` spelled out). That reads as the site retrying with extra cards and every language before reporting that nothing matched.
- The controls band stays, with every pager button disabled except shuffle.
- Info line: "**0 cards found** where the card types include “sphinx” and the power > 20".
- A second band in the same style carries the warning: "Invalid expression “foo:bar” was ignored. Unknown keyword “foo”." The unknown term is dropped and the rest of the query runs.
- The header field keeps the query exactly as typed.
- Body: a large pale icon, an `h1` "No cards found" (24px), two centred lines ("Your search didn't match any cards. Adjust your terms or try one of the links below:"), and three buttons: Go Back, Syntax Guide, Advanced Search.

### 4.7 Card page

Screenshots: `desktop-card.png`, `desktop-card-full.png`, `desktop-card-print-hover.png`, `phone-card.png`, `phone-card-full.png`, and for a double-faced card `desktop-card-dfc.png`, `desktop-card-dfc-turned.png`, `phone-card-dfc.png`.

Address pattern: `/card/<set code>/<collector number>/<name slug>`; other languages add a segment, `/card/trk/14/es/<localised slug>`. Page title: "Dr. McCoy, Surly Surgeon · Star Trek (TRK) #14 · Scryfall Magic: The Gathering Search".

Regions, in order:

1. Header (search field empty).
2. Card profile: three columns on a `#f5f6fa` band with a dashed bottom rule.
3. Toolbox: three columns of link buttons.
4. Rulings: white band with a dashed top rule.
5. Footer.

#### Column 1: the image and its controls

- One image, 336x468 (fixed width, `flex: 0 0 336px`), `border-radius: 4.75% / 3.5%` (16px at this size), shadow `1px 1px 8px rgba(0,0,0,.5)`. `alt` and `title`: "Dr. McCoy, Surly Surgeon (Star Trek #14)". It is not inside a link.
- Under the image, a centred row of buttons:
  - "Add to Deck" (`title="Add to saved cards"`) exists but is visually hidden for a signed-out visitor.
  - On a double-faced card, a visible "Transform" button (103x28, `title="Transform Card"`). Pressing it adds a class to the image container and the card turns over with a 3D flip: front and back images are stacked, each with `backface-visibility: hidden`, the back pre-rotated 180 degrees. Pressing again turns it back. The button carries no pressed state for assistive technology.
- A normal single-faced card has no visible control under the image.

#### Column 2: the text box

A white box with 3px black borders top and bottom, 4px radius, pulled 15px under the image's right edge so the two overlap slightly. Parts in order, each separated by a 1px line (black at 10%), all with 27px left padding:

1. `h1`: card name, then the mana cost as symbols. 16px/20px.
2. Type line, 15px.
3. Rules text, 15px/18px, one paragraph per ability, 8px apart. Reminder text is italic. Then flavour text in an italic serif (MPlantin with Georgia as fallback), 15px/17px.
4. Power/toughness, 15px bold.
5. "Illustrated by" and the artist's name as a link (12px, link `#3b1260`) to a search for that artist with `unique=art`.
6. Legality, a `dl` laid out as two columns of seven: Standard, Pioneer, Modern, Legacy, Vintage, Commander, Oathbreaker on the left; Alchemy, Historic, Brawl, Comp. Brawl, Timeless, Pauper, Penny on the right. Each entry is a 68x20 badge followed by the format name (12px). Badge text is 10px uppercase white: "LEGAL" on `#75986e`, "NOT LEGAL" on `#aeaeae`. I did not see a banned or restricted badge.

On a double-faced card both faces are in the same box, one after the other, each with its own `h1`, type line, text and stats; the back face's type line begins "Color Indicator: Blue". Artist and legality follow once, after both.

Mana and other symbols are `abbr` elements: the text content is the code (`{W}`), hidden by a large negative text indent; the picture is an SVG background, 16px round, with a 1px offset shadow; `title` is the name ("one white mana"). Copying the text gives the brace code.

#### Column 3: printings and prices

1. Current printing: a dark block (`#343242`, lighter on hover) that links to the set page. The set's symbol, "Star Trek (TRK)" (16px), then "#14 · Uncommon · English · Nonfoil/Foil" (12px).
2. Language pills: EN (current, `#634496`), ES, FR, DE, IT, JA, each 11px uppercase on `#343242`, linking to that language's page for the same printing, with the localised name as tooltip; each carries the same hover-preview hook as the print rows (I hovered a print row, not a pill). A last pill, "⋮", is "Show versions in all languages" (a search for the exact name in that set with `lang:any unique=prints`).
3. (When applicable, seen in Full view) a "Faces, tokens, & other parts" table of related cards.
4. Prints table. Dark header row: PRINTS (a link to the all-printings search), USD, EUR, TIX, 11px uppercase white. One row per printing, 28px: a small round rarity-coloured set symbol, "Star Trek #14" linking to that printing's page, and three prices linking to sellers (blue, purple, orange as in the checklist). The current printing's row is tinted `#cbaaf5` at 25%; other rows take the same tint on hover, and hovering a row previews that printing's image. A price that exists only in foil is prefixed with ✶. Last row: "View all prints →", a search for `!"<name>" oracleid:<id> include:extras` with `unique=prints`, ordered by release date. The table ends with a 3px `#343242` rule.

This card had three printings, all listed. I did not see how a card with dozens of printings is truncated.

#### Toolbox

Three columns, each an `h6` (14px bold uppercase) over a list of 280px-wide link buttons with a small icon:

- **Toolbox**: TCGplayer articles about this card; TCGplayer decks with this card; Search MTGTop8 for this card; Moxfield decks with this card; Archidekt decks with this card; Card analysis on EDHREC; Card stats on Cube Cobra; Open on Scryfall Tagger.
- **Buy This Card**: Buy on TCGplayer ($0.22); Buy foil on TCGplayer (✶ $0.35); Buy on Cardmarket (€0.06); Buy foil on Cardmarket (✶ €0.16); Buy on Cardhoarder (0.02). The price is right-aligned inside the button. Seller buttons use the seller's colour for text and border (blue `#124cd5` for TCGplayer, orange for Cardhoarder).
- **Images and Data**: Download PNG image (0.65 MB); Download art crop (52.36 KB); Copy-pasteable text; Copy-pasteable JSON; Report card issue. File sizes are stated in the label.

#### Rulings

`h6`: "Notes and Rules Information for <card name>:" with the name as a link. Rulings are list items (14px) in two columns of up to 500px; each ends with its date in grey italic serif, "(2026-10-07)". This card had one ruling.

#### Layout by width

| Viewport width | Card profile | Toolbox | Rulings |
|---|---|---|---|
| 980 and up | three columns in a row: image 336px, text box (flexible, max 500px), prints (max 400px) | three columns | two columns |
| 720 to 979 | image centred on top; text box then prints stacked below, each 500px wide, centred | three columns down to 765 | two columns down to 765 |
| below 765 | | one column of 280px buttons, centred | one column |
| below 720 | one column | | |
| 390 | image 336px centred; text box and prints full width | one column; **Buy This Card moves above Toolbox** | one column |

On phone the order top to bottom is: image, text box (name to legality), current printing, language pills, prints table, Buy This Card, Toolbox, Images and Data, rulings, footer.

### 4.8 Set page

Screenshots: `desktop-set.png`, `desktop-set-top.png`, `phone-set.png`.

1. Header, with the field prefilled `set:ima`.
2. Set band, background `#5f4f66`, white text: the set symbol (30px); `h1` "Iconic Masters (IMA)" (18px bold); "249 cards • Released 2017-11-17" (13px, white at 80%); "$588.15 • €440.86 • 59.22 TIX", the summed prices. On the right, three selects in the inverted style: display mode, sort order (the same list as search plus "Spoiler Date"; default Set/Number) and direction. There is no "unique" select; a set page always lists printings.
3. A section heading, `h2`: "IN BOOSTERS • 249 CARDS", 14px uppercase `#5f4f66`, centred on a horizontal rule. The count is a link (`#7b59b4`, underlined) to the equivalent search (`set:ima is:booster`, `unique=prints`, ordered by set). Larger sets presumably have more than one section; this one has one.
4. The card grid, the same component as in search, holding all 249 cards on one page (22,000px tall at desktop width; 13 images eager, 236 lazy). No pagination.
5. An end-of-list line in small italic grey.
6. The set band again.
7. Footer.

Phone: the selects in the set band are hidden and the three-button "Previous / View / Next" row appears under the band, with both pager buttons disabled. Two-column grid.

### 4.9 Sets list

Screenshots: `desktop-sets.png`, `desktop-sets-top.png`, `phone-sets.png`.

1. Header.
2. Controls band reading as a sentence: "**1081 sets in** [All languages] **sorted by** [Release Date] **of type** [Any]".
   - Language: All languages, then eleven languages by code with native names (`en` English, `es`, `fr`, `de`, `it`, `pt`, `ja`, `ko`, `ru`, `zhs`, `zht`).
   - Sort: Release Date, Name, Block/Group, No. of Cards.
   - Type: Any, then 25 set types (Cube, Alchemy, Archenemy, Arsenal, Box, Commander, Core, Draft Innovation, Duel Deck, Eternal, Expansion, From The Vault, Funny, Masterpiece, Masters, Memorabilia, Minigame, Planechase, Premium Deck, Promo, Spellbook, Starter, Token, Treasure Chest, Vanguard).
3. One table with all 1,081 sets on one page (36,000px tall). Columns: Name, Cards, Date, Languages.
   - Name cell: set symbol (20px), set name, and the set code at the right in grey monospace (about 12px, `#9b9b9b`).
   - Child sets (tokens, promos, Commander decks, art series) are indented under their parent with a "↳" arrow, two levels deep.
   - Languages: a row of eleven pills; the languages a set exists in are solid and are links, the others are faint.
   - Rows are 33px, zebra-striped, the whole row links to the set page. The same current-row mark and `j` key as the checklist.
4. The controls band again, then the footer.

Phone: the controls collapse to a single "View Options" button; the table keeps a 768px minimum and scrolls sideways inside its wrapper.

### 4.10 Advanced Search

Screenshots: `desktop-advanced.png`, `desktop-advanced-full.png`, `desktop-advanced-type-picker.png`, `desktop-advanced-type-picked.png`, `phone-advanced.png`.

One long form (`POST /advanced`, `novalidate`), white background, with an `h1` "Advanced Search" that is visually hidden. Each row is a flex pair: a 180px label column (a 20px purple line icon and the label, 16px, weight 300) and a content column. Rows are separated by thin rules. Small italic grey help text (12px, `#9b9b9b`, max 620px) sits under most fields.

| Row | Controls | Help text (shortened) |
|---|---|---|
| Card Name | text, "Any words in the name, e.g. “Fire”" | |
| Text | text, "Any text, e.g. “draw a card”"; an "Add symbol" menu (72 symbols, such as "{T} – tap this permanent") that inserts a symbol code | `~` stands for the card name; word order doesn't matter |
| Type Line | a tag picker over 722 types, grouped; checkbox "Allow partial type matches" | click IS / NOT to include or exclude |
| Colors | six checkboxes with symbols: White, Blue, Black, Red, Green, Colorless; select: Exactly these colors / Including these colors / At most these colors | explains "Including" and "At most" |
| Commander | the same six checkboxes for colour identity | |
| Mana Cost | text, "Any mana symbols, e.g. “{W}{W}”"; "Add symbol" (52 symbols) | exact mana cost |
| Stats | select Mana Value / Power / Toughness / Loyalty; select equal to / less than / greater than / less than or equal to / greater than or equal to / not equal to; number field | cards without stats are not returned |
| Games | checkboxes Paper, Arena, Magic Online | |
| Formats | select Legal / Restricted / Banned; select of 23 formats | |
| Sets | tag picker over 1,069 sets; tag picker over 43 blocks or groups | |
| Rarity | checkboxes Common, Uncommon, Rare, Mythic Rare | |
| Criteria | tag picker over 111 criteria; checkbox "Allow partial criteria matches" | IS / NOT toggle |
| Prices | select USD / Euros / MTGO Tickets; select less than / greater than / less than or equal to / greater than or equal to; number field | |
| Artist | text | |
| Flavor Text | text | word order doesn't matter |
| Lore Finder™ | text | searches every part of the card for a name or word |
| Language | select of 22: Default, Any, the eleven print languages, and nine others (Hebrew, Latin, Ancient Greek, Arabic, Sanskrit, Phyrexian, Quenya, Dwarvish, Klingon) | |
| Preferences | three selects: "Display as …" (4), "Sort by …" (14), "Prefer …" (14: No Preference, Newest, Oldest, Promo, Default Magic Frame, Atypical Magic Frame, Universes Beyond, Not Universes Beyond, Lowest/Highest USD, EUR, TIX); checkboxes "Show all card prints" and "Include extra cards (tokens, planes, schemes, etc)" | |

The submit button, "Search with these options", is in a bar with `position: sticky; bottom: 0`, so it stays at the bottom edge of the window the whole way down the form.

Field styling: inputs and selects are 38px tall, 16px text, `#343242` on `#fefefe`, 1px border `#aeaeae`, 2px radius, padding `8px 10px`; selects have a down chevron at the right. Checkboxes are custom 26x26 boxes. Focus gives a soft grey glow (`0 0 3px #aeaeae`) and, on the tag pickers, a purple border.

The tag picker (seen on Type Line): typing filters a dropdown grouped under headings ("Land Types", "Creature Types"), with the typed text itself offered first as a free entry. A chosen item becomes a chip with an × to remove it, a green "IS" badge that toggles to "NOT", and the name. Typing sent no network request; the options are in the page.

Phone: each row stacks, label above content; fields take the full width (366px).

### 4.11 Syntax guide

Screenshots: `desktop-syntax.png`, `desktop-syntax-top.png`, `phone-syntax.png`.

Page title "Search Reference". 13,000px tall at desktop width.

1. Header.
2. A jump panel on `#f5f6f7`: `h1` "Scryfall Search Reference" (36px, weight 200, centred), a two-line introduction, and 27 buttons in three columns of 300px, each with a small icon, linking to an anchor on the same page.
3. Twenty-seven sections, each a white band with a 2px `#dddddd` rule beneath and 34px vertical padding. A section has two columns inside the 1000px frame:
   - Left, 480px: an `h2` (28px, weight 200, `#343242`) with a 20px round icon, then short paragraphs (15px, line-height 1.45). Keywords and values are inline `code`: monospace 14px, coloured, on `#f5f6f7`, padding `0 3px`, 2px radius.
   - Right, 450px: a stack of example cards. Each is a link that runs the search. White, 15px padding, a 3px left border, a two-layer soft shadow; inside, the query in 16px monospace and a one-line description in 16px.
   - Each section has an accent colour used for its inline code, its example queries and the example cards' left border. In the first eight sections the colours were a teal (`#246782`), a red (`#a71f2a`), a green-grey (`#47553c`), a purple (`#521987`), and in one section the browser's default link blue.
4. Footer.

Section order: Colors and Color Identity; Card Types; Card Text; Mana Costs; Power, Toughness, and Loyalty; Multi-faced Cards; Spells, Permanents, and Effects; Extra Cards and Funny Cards; Rarity; Sets and Blocks; Cubes; Format Legality; USD/EUR/TIX prices; Artist, Flavor Text and Watermark; Border, Frame, Foil & Resolution; Games, Promos, & Spotlights; Year; Tagger Tags; Reprints; Languages; Shortcuts and Nicknames; Negating Conditions; Regular Expressions; Exact Names; Using "OR"; Nesting Conditions; Display Keywords. The page has 536 `code` elements, 101 of them inside runnable examples.

There is no side navigation and no search within the guide; the jump panel at the top is the only index, and sections do not link back to it.

Below 750px the two columns stack: explanation first, examples under it, each full width.

The content of the guide is in `syntax-reference-notes.md`.

#### Other help pages (seen on the regular-expressions page)

Screenshot: `desktop-regex-help.png`. A different, more ordinary documentation layout:

- A left menu on `#4f4255` with three groups under small uppercase headings: Site Help (Site FAQs, Syntax Guide, Tagger Tags, Regular Expressions, Random Tools, Contact Us), Tools (Slack Bot, Discord Bot, Discord Troubleshooting, Other Add-ons), Developers (API Reference, Scryfall Imagery, Bulk Data). Links are white at 80%; the current page is full white.
- A content column, max 650px: `h1` 30px/36px weight 200; `h2` 18px with a 1px rule above and 24px of space; prose 15px/22px `#323232` with paragraphs capped at 570px; links `#634496`, underlined; reference tables with small uppercase grey headers and 6px row padding, no borders or striping.
- Phone: the menu collapses behind a full-width "Help Pages" button at the top; tables fit the width.

---

## 5. Design tokens

All values were read from computed styles on the live pages. Colours with transparency are written as the base colour and its opacity.

### Typography

Families:

- Sans, used for nearly everything: `Lato, "Helvetica Neue", Arial, Helvetica, sans-serif`, followed by emoji fonts. Loaded faces: 300, 400, 400 italic, 700. Headings set at weight 200 therefore render in the 300 face.
- Serif italic for flavour text and ruling dates: `MPlantin, Georgia, "Times New Roman", serif`.
- Monospace for code in the docs: `Consolas, "Liberation Mono", Courier, monospace`. A `FiraMono` face is declared but I did not see where it is used.
- Three novelty faces are declared for fictional scripts and a pixel style (`AlcarinTengwar`, `PhyrexianHorizontal`, `m6x11`).
- Form controls on the home page and the Advanced form do not inherit Lato; in this browser they computed to Arial.

Scale in use:

| Size / line height | Weight | Where |
|---|---|---|
| 36px | 200 | syntax guide `h1` |
| 30px / 36px | 200 | help page `h1` |
| 30px / 37.5px | 400 | home search field text (24px on narrow screens) |
| 28px | 200 | syntax guide `h2` |
| 24px | 400 | "No cards found" |
| 18px | 700 | set page `h1` |
| 18px / 24px | 400 | help page `h2` |
| 16px / 20px | 400 (inside a bold heading) | card name on the card page and in text view |
| 16px / 22px | 400 | header search field |
| 16px | 400 | advanced form inputs; current-printing set name; syntax example text |
| 16px | 300 | advanced form labels |
| 15px / normal | 400 | body default |
| 15px / 18px | 400 | type line and rules text |
| 15px / 17px | 400 italic serif | flavour text |
| 15px | 700 | power/toughness |
| 15px / 22px | 400 | documentation prose |
| 14px / 18px | 700 | every button and select |
| 14px / 22px | 400 | header links |
| 14px / 21px | 400 | footer links |
| 14px / 20px | 400 | checklist and sets table body |
| 14px | 400 | info line, rulings, toolbox |
| 14px | 700 uppercase | section headings on the card page |
| 14px | 500 uppercase | grid section heading on a set page |
| 13px | 400 | set band sublines |
| 12px | 700 uppercase | table headers, footer headings |
| 12px | 400 | artist line, legality names, prints table, footer legal text, form help (italic) |
| 11px uppercase | 400 | pills, prints table header |
| 10px uppercase | 400 | legality badges |

### Colour

| Hex | Used for |
|---|---|
| `#2b253a` | page background behind everything; header |
| `#19181f` | footer |
| `#f5f6f7` | main content background; code background |
| `#f3f5f8` | controls band |
| `#f6f4fa` | info line; phone controls band |
| `#f5f6fa` | card profile band |
| `#ffffff` | card text box, prints table, docs sections, hover background of buttons |
| `#fdfdfd` | rulings band; text on dark blocks; sticky submit bar |
| `#16161d` | body text |
| `#343242` | text in forms and docs headings; dark blocks (current printing, prints header, pills) |
| `#535353` | info line text |
| `#9b9b9b` | help text, ruling dates, set codes |
| `#aeaeae` | input borders, "not legal" badge, end-of-results line |
| `#551a8b` | button and select text; current-row mark |
| `#634496` | accent: counts, primary button, hover and focus border, current language pill, links in docs prose |
| `#3b1260` | artist link, "Add symbol" |
| `#7b59b4` | link in the set page's section heading |
| `#af7cf0` | focus ring on card tiles |
| `#cbaaf5` at 25% | current or hovered row in the prints table |
| `#5f4f66` | set band; section heading text |
| `#4f4255` | help pages' side menu |
| `#75986e` | "legal" badge |
| `#124cd5` | USD prices, TCGplayer buttons |
| `#8b3f8a` | EUR prices |
| `#da4100` | TIX prices |
| `#3497be`, `#f64800` | "new" pills on the home page |
| `#ffd041` | border of the home search field |
| `#fffae3` | skip links |
| `#e0dee3`, `#e7e9ec`, `#dddddd`, `#cdcdcd` | table row lines, section rules, dashed dividers |
| `#cccccc`, `#999999`, `#444444` | footer links, footer headings, footer legal text |
| white at 75% / 40% / 9% / 60% | header links / dividers / inverted button fill / inverted button border |
| `#634496` at 10% | bottom border of the controls and info bands |
| black at 5% | zebra rows |

There is one accent hue, a purple, in three depths (`#551a8b` text, `#634496` fills and borders, `#af7cf0` ring). Blue, purple-pink and orange are reserved for the three currencies. Green and grey are reserved for legality.

Contrast ratios I calculated from those values: body text 16.6:1; button text 10.3:1; header links 8.9:1; info line 7.1:1; USD 7.0:1, EUR 6.6:1, TIX 4.4:1; "legal" badge 3.2:1; help text and ruling dates 2.8:1; "not legal" badge 2.2:1; disabled buttons 1.8:1; footer legal text 1.8:1.

### Sizes and spacing

| Thing | Value |
|---|---|
| Content column | max-width 1000px, centred |
| Side gutter | 2.5% of viewport width per side |
| Header height | 52px |
| Controls band | 53px (12px padding above and below a 28px control, 1px border) |
| Info line | 38px (10px padding); 31px and 12px text below 760px |
| Button, select | 28px tall; padding 0 10px; icon-only minimum 32px wide |
| Space between adjacent buttons | 6px; between a label and its select 8px |
| Grid | 20px above, 15px below; 9px between rows; about 6px between columns |
| Card tile | 245x341 at desktop; ratio 488:680 |
| Card image corner radius | `4.75% / 3.5%` everywhere (12px at 245 wide, 16px at 336 wide); the home collage uses `5% / 3.75%` |
| Card image shadow | grid `1px 1px 6px rgba(0,0,0,.45)`; card page `1px 1px 8px rgba(0,0,0,.5)` |
| Card page image | 336x468 |
| Hover preview | 244x340 |
| Text box | 3px black top and bottom borders, 4px radius, 27px left padding, parts separated by 1px lines |
| Legality badge | 68x20, 2px radius |
| Prints row | 28px; checklist row 32px; sets row 33px |
| Toolbox button | 280x28 |
| Advanced form | label column 180px; inputs 38px tall, 420px wide for text; checkboxes 26x26 |
| Home search field | 524x64 (351x56 on phone) |
| Radii | 2px (inputs, badges, pills), 3px (buttons), 4px (text box, news pills), fully round (symbols) |
| Shadows | buttons `0 1px 1px rgba(0,0,0,.06)`; symbols `-1px 1px 0 rgba(0,0,0,.85)`; syntax examples `0 1px 5px rgba(0,0,0,.07), 0 7px 17px rgba(0,0,0,.1)` |

### Breakpoints

The stylesheet has no small set of named breakpoints. It uses about thirty-five different widths, mostly `min-width`, each attached to one component. Counting rules per width, the busiest are 800px (29 rules), 740px (20), 980px (18), 760px (16), 765px (8), 600px (7) and 810px (5). The full list of widths that appear: 320, 350, 360, 375, 400, 420, 440, 450, 460, 500, 560, 600, 610, 660, 700, 720, 725, 740, 750, 760, 765, 800, 810, 860, 920, 950, 980, 1000, 1050, 1060, 1100.

What I observed changing, by resizing:

| Width | Change |
|---|---|
| about 1053 | content column stops being 1000px and becomes fluid |
| 980 | card page: three columns become image-on-top with text and prints stacked |
| 920 | results grid: 4 columns become 3 |
| 860 | results: desktop controls band replaced by the Previous / View / Next row |
| 800 | header: links replaced by the menu button |
| 765 | card page: toolbox 3 columns to 1; rulings 2 columns to 1 |
| 760 | info line 14px to 12px |
| between 761 and 800 | home search field 64px to 56px tall, text 30px to 24px |
| 750 | syntax guide: two columns to one |
| 720 | card page: fully single column |
| between 701 and 760 | text-only grid: 3 columns to 2 |
| 660 | results grid: 3 columns to 2 |
| 600 | footer: 5 columns (600 and up) to 1, centred |
| between 391 and 500 | text-only grid: 2 columns to 1 |
| 400 | home badge shrinks |

The grid never goes to one column; at 320px wide it is still two columns of 150px.

### Focus and other accessibility details

- `outline: none` on everything I tabbed to. The stylesheet has 73 `:focus` rules and no `:focus-visible` rules. Focus is shown by state styling instead: buttons and selects go white with a solid `#634496` border; header links go white and underlined; card tiles get the 4px `#af7cf0` ring; pills lighten. The header search field shows no ring or border on focus, only its magnifier icon changing.
- Tab order: skip links, logo, search field, hidden submit, header links, controls left to right, pager, then every card.
- Landmarks: the header is `div role="nav"` (not a valid role name; the valid one is `navigation`), the content is `div#main role="main"`, the footer is a `footer` element. No `nav`, `main` or `header` elements.
- Headings: a results page has none above `h6`. The card page has an `h1` (two on a double-faced card) and then jumps to `h6`. The set page has `h1` and `h2`. Docs pages use `h1` and `h2` properly.
- Images: every card image has descriptive `alt` text. Decorative icons are inline SVG with `aria-hidden="true"`. Icon-only links carry hidden text, except the shuffle button, which has only a `title`.
- Labels: all selects on the results page are labelled. The home page search field is not.
- Duplicate `id`s: `unique`, `as`, `order`, `dir` and `q` each occur several times on a results page (header hidden inputs, top controls, bottom controls, both phone forms).
- Disabled pager buttons are `span`s with `aria-hidden="true"`, so they vanish for assistive technology instead of being announced as unavailable.
- The phone menu button and the Transform button expose no expanded or pressed state.
- Touch target height is 28px for nearly every control, on phone as well.

---

## 6. What Scryfall's UI offers that mtgsearch's does not

Based on `/home/user/mtgsearch/public/index.html`, `app.js`, `app.css`, and one load of the live site at each viewport (`own-desktop-home.png`, `own-desktop-results.png`, `own-desktop-card.png`, `own-phone-home.png`, `own-phone-results.png`, `own-phone-card.png`).

What mtgsearch is today: one client-rendered page. A wordmark and tagline, a search field with a Search button, a status line ("Scryfall syntax · 91 cards, showing 24 · 37 ms") beside one Sort select (Default plus nine orders), eight example queries with a "What can I type?" disclosure, an image grid (six columns of 180px at 1280, two of 172px at 390, 14px gap), a "Show more" button that appends 24 at a time, and a card view at `/card/<set>/<number>/<name>` with the image, name, cost as brace codes, type line, rules text, flavour text, set / rarity / year, artist and USD price, and three actions (All N printings, Copy link, View on Scryfall).

Ordered by how much each would matter to someone searching for cards. "Structure/behaviour" means fine to adopt; "visual identity" means theirs, not to copy.

| # | What Scryfall has | What mtgsearch has now | Kind |
|---|---|---|---|
| 1 | **The query read back in plain English, plus warnings.** "91 cards where the card types include “sphinx”", and a separate line for anything ignored: "Invalid expression “foo:bar” was ignored. Unknown keyword “foo”." A bad term is dropped and the rest still runs. | A mode label and a count. An unsupported keyword stops the search with "Not supported yet". | Structure/behaviour. Matters more for mtgsearch than for Scryfall, because mtgsearch also guesses filters from plain English and the reader cannot currently see what it guessed. |
| 2 | **A complete card page.** Power/toughness as text, mana symbols drawn inline, reminder text in italic, legality in 14 formats, every printing with prices, other languages, rulings with dates, and for double-faced cards both faces and a turn-over button. | Name, cost as `{1}{R}{G}{G}`, type, rules, flavour, one printing line, artist, USD. No power/toughness outside the image, no legality, no rulings, no list of printings (only a link that runs a search), one face. | Structure/behaviour. The symbol artwork itself is not ours to take; an openly licensed symbol set would be needed. |
| 3 | **Display modes.** Images, Checklist, Text Only, Full, switchable from a control and addressable (`as=`). The Checklist is a dense, sortable table with set, number, name, cost, type, rarity, language, artist and three prices, 175 rows a page. | Image grid only. | Structure/behaviour. Checklist is the valuable one: it is how people compare many cards or scan prices. |
| 4 | **Pagination with position in the address.** "1 – 60 of 91", first / previous / next / last at the top and bottom, `page=2` in the address, page size shown on the button. | 24 results and "Show more"; the position is not in the address, so a reload or a shared link starts again at the top, and there is no way to jump to the end. | Structure/behaviour. |
| 5 | **Sorting and grouping as separate controls.** Fourteen sort keys, an independent Auto / Asc / Desc, and a Cards / All prints / Unique art control. | Nine fixed combinations of key and direction; no set/number, rarity, colour, artist, EUR or TIX; `unique:` only by typing it. | Structure/behaviour. |
| 6 | **Larger tiles.** Four per row at 245px on desktop, so the rules text printed on the card can be read in the grid. | Six per row at 180px; the text on the card is hard to read without opening it. | Structure/behaviour (a layout choice, not a style). |
| 7 | **A useful empty state.** Before giving up, the search appears to be retried more widely (extras, any language). Then a heading, a sentence, and three ways forward (Go Back, Syntax Guide, Advanced Search). | One status line: "No cards matched · Check the syntax, or describe the card in plain words." | Structure/behaviour. The wording and the icon are theirs. |
| 8 | **A syntax reference that can be run.** Twenty-seven sections with a jump index; every example is a link that performs the search. | Eight example buttons and five paragraphs behind a disclosure. | Structure/behaviour. The text of their guide is theirs; ours must describe what mtgsearch actually supports. |
| 9 | **An advanced search form** that builds a query from fields: name, text with a symbol inserter, type picker with IS/NOT, colour and identity checkboxes with a comparison mode, stats, formats, sets, rarity, criteria, prices, artist, flavour, language, display preferences. | None. | Structure/behaviour. |
| 10 | **Hover preview in dense lists.** In the checklist and the prints table, the card image follows the pointer. | No dense lists yet, so nothing to preview. | Behaviour. Needed as soon as item 3 exists. |
| 11 | **Navigation that is always there.** A header on every page with the search field and links to Advanced, Syntax, Sets, Random. A new search keeps the reader's display mode and sort. | The search field is always there; there is nowhere else to go. | Structure/behaviour. |
| 12 | **Browsing by set.** A sets index (1,081 sets, filter by language and type, four sorts, child sets nested) and a page per set with card count, release date, total value and every card. | None; `set:` works as typed syntax. | Structure/behaviour. |
| 13 | **Three currencies, foil and non-foil, per printing**, and file downloads (PNG, art crop, text, JSON). | USD of one printing. | Structure. The seller links are their affiliate arrangements and not relevant to us. |
| 14 | **Random card**, and a random card from within the current search. | None. | Behaviour. |
| 15 | **Link previews and discoverability.** Each card page has its own title, description, image and price in Open Graph / Twitter tags, a canonical address and structured data; the site has an OpenSearch descriptor so a browser can search it from the address bar. Pages arrive rendered. | One static title and description for every address; a card link pasted into a chat shows no card. Content appears only after script and an API call. | Structure. Does not change searching, but changes sharing a result. |
| 16 | **Row-by-row keyboard movement** (`j`) in tables, and skip links. | `/` focuses the field on both sites, and mtgsearch also has Escape to leave a card. No row movement (there are no tables yet) and no skip link, though the search field is already near the top. | Behaviour, minor. |
| 17 | **Names findable in the image grid.** A transparent text copy of each name sits over its image so find-in-page highlights the right card. | The name is behind the image, so find-in-page should match it with the highlight covered (read from the code, not tested). | Behaviour, minor. |
| 18 | **Other languages** as pills on the card page and `lang:` in search. | English only, and the help text says so. | Structure/behaviour, depends on data mtgsearch does not hold yet. |

**Since the study** (the table above describes mtgsearch on the day of the study and is left as written): item 1 is half done, the query is read back in words but an unusable term still stops the search; item 2 has power and toughness, legality and the list of printings, without drawn symbols, rulings or separate faces; items 4 and 5 are done, with pages of 60 in the address and three separate controls. What was adopted, and when, is in [FEEDBACK.md](FEEDBACK.md).

Visual identity, not to copy, listed once: the name and logo mark; the dark aubergine and purple palette (`#2b253a`, `#634496`, `#551a8b`); the Lato and MPlantin pairing as a recognisable look; the home page's starfield background, anniversary badge and fanned card collage; their line-icon set; set symbols and mana symbol drawings; the three currency colours as a brand cue; the joke lines at the end of result lists; the sentence-style wording of their controls and all of their documentation text.

For balance, what mtgsearch already does that Scryfall does not: plain-English search and a label saying which way a query was read; a visible Search button; a dark mode that follows the system; a 3px focus outline on every control; controls at least 35px tall (the search field and its button are 53px) against Scryfall's 28px buttons and selects; returning from a card to the results without a reload and at the same scroll position; a "Copy link" action; a timing figure.

---

## 7. What I could not verify

- **Autocomplete in the search field.** I typed nothing into a Scryfall search box, so I do not know whether it suggests card names. The field's `autocomplete="on"` is only the browser's own history.
- **The home field's focus state.** Right after load it measured background `#2d283d`, text `#ffffff`, border `#ffd041`; later, unfocused, background `#242031` and text `#d7d7d7`. That is consistent with the field being focused automatically on load, but I did not read which element had focus at load time.
- **Selects other than "as"** navigating on change. I changed only the display select. The others share the same component and markup.
- **The shuffle button, `k`, Enter on a focused row, page 2 of results.** Not pressed or loaded.
- **Submitting the Advanced form.** I do not know what address it produces.
- **Anything for signed-in users**: the deck tray, "Add to Deck", notifications. I did not sign in.
- **Banned and restricted legality badges, split or flip card controls, cards with many printings, set pages with several sections.** The cards and set I looked at did not show them.
- **Touch behaviour and a real phone.** The phone view is a desktop browser resized to 390x844; hover previews on touch, and anything served differently to a phone user agent, are untested.
- **Exact breakpoints for the text-only grid.** I have only the ranges given in section 5.
- **Print styles and behaviour with scripts disabled.** Not rendered.
- **Advanced form "Criteria" values as typed syntax.** The 111 option values are form values; I did not check each against `is:`.
- **Control fonts.** Inputs computing to Arial is what this Linux Chromium did; another system would substitute its own default control font.

## Files

The reference screenshots and the measurement scripts were kept outside the repository and are
not committed: they are pictures of someone else's site. This document is the record.
