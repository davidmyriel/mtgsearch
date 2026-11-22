// The TopK collections the app reads, configured from the environment.
import { Client } from "topk-js";
import type { Collection, Collections } from "./search.ts";

export const COLLECTION = process.env.MTGSEARCH_COLLECTION || "mtg-cards-v2";
export const PRINTINGS_COLLECTION = process.env.MTGSEARCH_PRINTINGS_COLLECTION || "mtg-printings-v1";
export const REGION = process.env.TOPK_REGION || "aws-us-east-1-elastica";

let collections: Collections | null = null;

/** One client per process, created on first use. Throws if TOPK_API_KEY is missing. */
export function collectionsFromEnv(): Collections {
  if (collections === null) {
    // Trim: a secret pasted with a trailing line break is otherwise rejected as an invalid header.
    const apiKey = (process.env.TOPK_API_KEY ?? "").trim();
    if (!apiKey) throw new Error("TOPK_API_KEY is not set; see .env.example");
    const client = new Client({ apiKey, region: REGION });
    collections = {
      cards: client.collection(COLLECTION) as unknown as Collection,
      printings: client.collection(PRINTINGS_COLLECTION) as unknown as Collection,
    };
  }
  return collections;
}

export const hasKey = () => Boolean((process.env.TOPK_API_KEY ?? "").trim());
