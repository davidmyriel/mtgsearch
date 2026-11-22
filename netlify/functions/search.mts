// GET /api/search on Netlify. The TopK key stays here on the server.
import type { Config } from "@netlify/functions";
import { Client } from "topk-js";
import { handleSearch } from "../lib/api.ts";
import { search } from "../lib/search.ts";
import type { Collection } from "../lib/search.ts";

// Created on first use and reused while the function instance stays warm.
let collection: Collection | null = null;

function getCollection(): Collection {
  if (collection === null) {
    // Trim: a secret pasted with a trailing line break is otherwise rejected as an invalid header.
    const apiKey = (process.env.TOPK_API_KEY ?? "").trim();
    if (!apiKey) throw new Error("TOPK_API_KEY is not set");
    const client = new Client({ apiKey, region: process.env.TOPK_REGION || "aws-us-east-1-elastica" });
    collection = client.collection(process.env.MTGSEARCH_COLLECTION || "mtg-cards-v2") as unknown as Collection;
  }
  return collection;
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  return handleSearch(new URL(request.url), (query, k) => search(getCollection(), query, k));
};

export const config: Config = {
  path: "/api/search",
  // Every uncached plain-English query costs an inference call, so limit each client.
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
