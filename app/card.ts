// One card's page: a printing with everything the page shows about it, and the card's
// printings with their prices. Two filters on the printings collection, no embeddings.

import { field, select } from "topk-js/query";
import { fold } from "./normalize.ts";
import { pick, printingHit, PRINTING_DISPLAY, toTopk } from "./search.ts";
import type { Collections, Hit } from "./search.ts";

/** The page lists this many printings; a card with more links to a search for all of them. */
export const MAX_PRINTINGS = 60;
const FAR = 1_000_000_000;
// Beyond what a search result shows: printed power and toughness, and legality by format.
const DETAIL = [...PRINTING_DISPLAY, "stats", "legal", "banned", "restricted"];
const ROW = ["name", "set", "set_name", "cn", "rarity", "released", "usd_c"];

export type CardPage = { card: Hit; printings: Hit[] };

/** The printing with this set code and collector number, or null when there is none. */
export async function card(cols: Collections, set: string, number: string): Promise<CardPage | null> {
  const which = toTopk(["and", [["eq", "set", set.toLowerCase()], ["eq", "cn", fold(number)]]]);
  const [row] = await cols.printings.query(select(pick(DETAIL)).filter(which!).limit(1));
  if (!row) return null;
  // Newest first, as a card's printings are usually listed; the hidden ones (see `extra`) stay out.
  const same = toTopk(["and", [["eq", "oracle_id", String(row.oracle_id)], ["eq", "extra", false]]]);
  const rows = await cols.printings.query(
    select(pick(ROW))
      .filter(same!)
      .sort([
        { expr: field("date"), order: "desc" },
        { expr: field("set"), order: "asc" },
        { expr: field("cn_num").coalesce(FAR), order: "asc" },
      ])
      .limit(MAX_PRINTINGS),
  );
  return { card: printingHit(row), printings: rows.map(printingHit) };
}
