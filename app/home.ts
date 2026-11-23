// What the home page shows besides the search box: a few cards that have something in
// common, different on every visit, and the newest sets. The cards are found by the example
// the empty search box is showing, so the page shows what the search does before anything is
// typed; without an example they share a theme instead (a kind of card, or the newest set).

import { agg, field, filter, select } from "topk-js/query";
import { lower } from "./lower.ts";
import { parse } from "./parser.ts";
import { pick, search, toTopk, VISIBLE } from "./search.ts";
import type { Collections, Hit } from "./search.ts";

export const HOME_CARDS = 5;
export const HOME_SETS = 5;
// What counts as news, and what each is: the sets people open packs of, and what comes out
// beside them, the Commander decks and the bonus sheet. Promos, tokens and the like are not news.
const KINDS: Record<string, SetKind> = {
  expansion: "set",
  core: "set",
  masters: "set",
  draft_innovation: "set",
  commander: "commander",
  masterpiece: "bonus",
};
// The decks and the sheet are named once there is something of them to look at. A set itself
// is news from its first card.
const WORTH_NAMING = 10;
// How far back a set still counts as new enough to look at.
const RECENT_DAYS = 300;
const CARD_FIELDS = ["name", "image", "set", "cn", "type_line", "artist"];

/** A set people open packs of, the Commander decks that come out with one, or its bonus sheet. */
export type SetKind = "set" | "commander" | "bonus";
export type HomeSet = {
  code: string;
  name: string;
  kind: SetKind;
  released: string;
  /** How many printings the index holds: a card in three frames counts three times. */
  cards: number;
  upcoming: boolean;
  /** For a set still to come, how many different cards have been shown so far; otherwise null. */
  revealed: number | null;
};
/** What the cards have in common: a name for it, and the search that finds them all. */
export type Theme = { label: string; query: string };
export type Home = { cards: Hit[]; sets: HomeSet[]; theme: Theme | null };

// What the empty search box offers to try: things players look for, said in plain words. The
// page shows one of these on each visit (public/app.js has the same list) and names it when
// it asks for the home page's cards. Each was kept because of what it finds: the tests hold a
// card or two that each one must find, so one that stops working is noticed. Keep them short:
// the longest has to show whole in the box on a narrow phone.
export const EXAMPLES = [
  // white
  "angel that gains life", "knight with first strike", "white enchantment removal", "creature that taxes spells",
  "tithe alternative",
  // blue
  "sphinx that draws two cards", "blue land destruction", "wizard that copies spells", "merfolk that draws cards",
  "brainstorm alternative",
  // black
  "black creature removal", "reanimate a creature", "demon with a drawback", "zombie that comes back",
  "ritual alternative",
  // red
  "dwarf that destroys lands", "goblin that makes goblins", "dragon with haste", "damage to each creature",
  "shock alternative",
  // green
  "hydra with x in its cost", "druid that untaps lands", "fight target creature", "search for a basic land",
  "llanowar alternative",
  // artifacts
  "equipment that gives haste", "vehicle with flying", "artifact that draws cards", "mana rocks",
  // more than one colour
  "izzet dragon", "orzhov vampire", "simic hydra", "dimir rogue",
];
// The cards shown are the example's first results and nothing from further down: the further
// down, the less a card is what the example asks for, and a home page that shows a dwarf that
// fetches lands under "dwarf that destroys lands" says the search is worse than it is. A few
// more are asked for than are shown, in case one has no picture.
const SPARE = 3;

// What a visit's cards can have in common, apart from being the newest set's. Each is a
// search, so a theme is anything the search box understands, and a kind of card that shows
// at a glance: the reader should see the link between them without being told.
export const THEMES: Theme[] = [
  { label: "Dragons", query: "t:dragon" },
  { label: "Angels", query: "t:angel" },
  { label: "Demons", query: "t:demon" },
  { label: "Elves", query: "t:elf" },
  { label: "Goblins", query: "t:goblin" },
  { label: "Zombies", query: "t:zombie" },
  { label: "Wizards", query: "t:wizard" },
  { label: "Merfolk", query: "t:merfolk" },
  { label: "Vampires", query: "t:vampire" },
  { label: "Dinosaurs", query: "t:dinosaur" },
  { label: "Sphinxes", query: "t:sphinx" },
  { label: "Planeswalkers", query: "t:planeswalker" },
  { label: "Sagas", query: "t:saga" },
  { label: "Vehicles", query: "t:vehicle" },
];
// The cards are drawn from the most played of a theme, so that they are ones people know.
const POOL = 60;
// How often the theme is the newest released set, when there is one.
const NEW_SET_SHARE = 1 / 3;
const FAR = 1_000_000_000;

const asNumber = (day: Date) => Number(day.toISOString().slice(0, 10).replaceAll("-", ""));
const asDate = (n: number) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;

/**
 * A few cards at random, each with a picture and the printing that shows it. A card's id is a
 * random identifier, so the cards whose id starts with two random characters are a random
 * handful (about 150), and `n` of those are drawn.
 */
export async function randomCards(cols: Collections, n = HOME_CARDS, random: () => number = Math.random): Promise<Hit[]> {
  const drawn: Hit[] = [];
  for (let attempt = 0; attempt < 3 && drawn.length < n; attempt++) {
    const prefix = Math.floor(random() * 256).toString(16).padStart(2, "0");
    const some = field("_id").startsWith(prefix).and(field("extra").eq(false));
    const rows = await cols.cards.query(select(pick(CARD_FIELDS)).filter(some).limit(500));
    // TopK returns them in no particular order; sorting first makes a draw repeatable.
    const usable = rows.filter((row) => row.image && row.set && row.cn).sort((a, b) => (a._id < b._id ? -1 : 1));
    while (usable.length && drawn.length < n) {
      drawn.push(...usable.splice(Math.floor(random() * usable.length), 1));
    }
  }
  return drawn;
}

/** The newest sets, newest first. A set whose release date is still ahead is marked upcoming. */
export async function newestSets(cols: Collections, n = HOME_SETS, today: Date = new Date()): Promise<HomeSet[]> {
  const since = asNumber(new Date(today.getTime() - RECENT_DAYS * 86_400_000));
  const recent = toTopk(["and", [["cmp", "date", ">=", since], ["oneof", "set_type", Object.keys(KINDS)], VISIBLE]]);
  const rows = await cols.printings.query(
    filter(recent!).groupBy(
      { set: field("set"), set_name: field("set_name"), set_type: field("set_type") },
      { date: agg.max("date"), cards: agg.count() },
    ),
  );
  const now = asNumber(today);
  const order: SetKind[] = ["set", "commander", "bonus"];
  const newest = rows
    .map((row) => ({
      code: String(row.set), name: String(row.set_name), kind: KINDS[String(row.set_type)], date: Number(row.date), cards: Number(row.cards),
    }))
    .filter((set) => set.kind === "set" || set.cards >= WORTH_NAMING)
    // newest first; of things out on the same day, the set, then its decks, then its sheet
    .sort((a, b) => b.date - a.date || order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name))
    .slice(0, n);
  // For the ones still to come, how many different cards have been shown: one row for each
  // card of each such set, however many printings it has.
  const coming = newest.filter((set) => set.date > now).map((set) => set.code);
  const revealed = new Map<string, number>();
  if (coming.length) {
    const shown = toTopk(["and", [["oneof", "set", coming], VISIBLE]]);
    const cards = await cols.printings.query(filter(shown!).groupBy({ set: field("set"), card: field("oracle_id") }, { printings: agg.count() }));
    for (const card of cards) revealed.set(String(card.set), (revealed.get(String(card.set)) ?? 0) + 1);
  }
  return newest.map(({ date, ...set }) => ({
    ...set, released: asDate(date), upcoming: date > now, revealed: date > now ? (revealed.get(set.code) ?? set.cards) : null,
  }));
}

/**
 * A few of the most played cards a search finds, drawn at random among them. A search about
 * printings (`set:trk`) is answered from the printings, one card for each, shown by that printing.
 */
export async function themedCards(cols: Collections, query: string, n = HOME_CARDS, random: () => number = Math.random): Promise<Hit[]> {
  const [predicate, options] = lower(parse(query));
  const where = toTopk(predicate);
  const byPlay = [{ expr: field("edhrec_rank").coalesce(FAR), order: "asc" as const }];
  let rows: Hit[];
  if (options.printings) {
    const found = await cols.printings.query(
      (where === null ? select(pick([...CARD_FIELDS, "oracle_id"])) : select(pick([...CARD_FIELDS, "oracle_id"])).filter(where)).sort(byPlay).limit(POOL * 4),
    );
    const seen = new Set<unknown>();
    rows = found.filter((row) => !seen.has(row.oracle_id) && seen.add(row.oracle_id)).slice(0, POOL);
  } else {
    rows = await cols.cards.query((where === null ? select(pick(CARD_FIELDS)) : select(pick(CARD_FIELDS)).filter(where)).sort(byPlay).limit(POOL));
  }
  const usable = rows.filter((row) => row.image && row.set && row.cn);
  const drawn: Hit[] = [];
  while (usable.length && drawn.length < n) drawn.push(...usable.splice(Math.floor(random() * usable.length), 1));
  return drawn;
}

/** The theme of a visit: sometimes the newest set that is out, otherwise one of THEMES. */
export function chooseTheme(sets: HomeSet[], random: () => number = Math.random): Theme {
  const out = sets.find((set) => set.kind === "set" && !set.upcoming && set.cards >= 100);
  if (out && random() < NEW_SET_SHARE) return { label: out.name, query: `set:${out.code}` };
  return THEMES[Math.floor(random() * THEMES.length)];
}

/**
 * Cards found by one of the examples: its first results, arranged with the closest in the
 * middle, where a narrow screen shows the fan.
 */
export async function exampleCards(cols: Collections, example: string, n = HOME_CARDS): Promise<Hit[]> {
  const chosen = (await search(cols, example, { k: n + SPARE })).hits.filter((hit) => hit.image).slice(0, n);
  if (chosen.length < n) return [];
  // middle out: the first goes in the middle, the next either side of it, and so on
  const arranged: Hit[] = [];
  chosen.forEach((card, rank) => (rank % 2 ? arranged.unshift(card) : arranged.push(card)));
  return arranged;
}

export async function home(cols: Collections, random: () => number = Math.random, example: string | null = null): Promise<Home> {
  const [sets, found] = await Promise.all([
    newestSets(cols),
    example !== null && EXAMPLES.includes(example) ? exampleCards(cols, example, HOME_CARDS) : [],
  ]);
  if (example !== null && found.length === HOME_CARDS) return { cards: found, sets, theme: { label: example, query: example } };
  const theme = chooseTheme(sets, random);
  const cards = await themedCards(cols, theme.query, HOME_CARDS, random);
  // A theme that somehow finds too few cards gives way to cards from anywhere.
  if (cards.length < HOME_CARDS) return { cards: await randomCards(cols, HOME_CARDS, random), sets, theme: null };
  return { cards, sets, theme };
}
