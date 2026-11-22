// The TopK collection the app reads, configured from the environment.
import { Client } from "topk-js";
import type { Collection } from "./search.ts";

export const COLLECTION = process.env.MTGSEARCH_COLLECTION || "mtg-cards-v2";
export const REGION = process.env.TOPK_REGION || "aws-us-east-1-elastica";

let collection: Collection | null = null;

/** One client per process, created on first use. Throws if TOPK_API_KEY is missing. */
export function collectionFromEnv(): Collection {
  if (collection === null) {
    // Trim: a secret pasted with a trailing line break is otherwise rejected as an invalid header.
    const apiKey = (process.env.TOPK_API_KEY ?? "").trim();
    if (!apiKey) throw new Error("TOPK_API_KEY is not set; see .env.example");
    collection = new Client({ apiKey, region: REGION }).collection(COLLECTION) as unknown as Collection;
  }
  return collection;
}

export const hasKey = () => Boolean((process.env.TOPK_API_KEY ?? "").trim());
