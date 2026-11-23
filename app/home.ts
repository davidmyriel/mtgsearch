// What the home page shows besides the search box: a few cards chosen at random, different
// on every visit, and the newest sets. Two filters, no embeddings.

import { agg, field, filter, select } from "topk-js/query";
import { pick, toTopk, VISIBLE } from "./search.ts";
import type { Collections, Hit } from "./search.ts";

export const HOME_CARDS = 6;
export const HOME_SETS = 4;
// Sets people open packs of. Promos, tokens, commander decks and the like are not news.
const SET_TYPES = ["expansion", "core", "masters", "draft_innovation"];
// How far back a set still counts as new enough to look at.
const RECENT_DAYS = 300;
const CARD_FIELDS = ["name", "image", "set", "cn", "type_line", "artist"];

export type HomeSet = { code: string; name: string; released: string; cards: number; upcoming: boolean };
export type Home = { cards: Hit[]; sets: HomeSet[] };

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
  const recent = toTopk(["and", [["cmp", "date", ">=", since], ["oneof", "set_type", SET_TYPES], VISIBLE]]);
  const rows = await cols.printings.query(
    filter(recent!).groupBy({ set: field("set"), set_name: field("set_name") }, { date: agg.max("date"), cards: agg.count() }),
  );
  const now = asNumber(today);
  return rows
    .map((row) => ({ code: String(row.set), name: String(row.set_name), date: Number(row.date), cards: Number(row.cards) }))
    .sort((a, b) => b.date - a.date || a.name.localeCompare(b.name))
    .slice(0, n)
    .map(({ date, ...set }) => ({ ...set, released: asDate(date), upcoming: date > now }));
}

export async function home(cols: Collections): Promise<Home> {
  const [cards, sets] = await Promise.all([randomCards(cols), newestSets(cols)]);
  return { cards, sets };
}
