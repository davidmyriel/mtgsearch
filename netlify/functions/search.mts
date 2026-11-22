// GET /api/search on Netlify. The TopK key stays here on the server.
import type { Config } from "@netlify/functions";
import { handleSearch } from "../../app/api.ts";
import { search } from "../../app/search.ts";
import { collectionFromEnv } from "../../app/topk.ts";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  // The collection client is created on first use and reused while the instance stays warm.
  return handleSearch(new URL(request.url), (query, options) => search(collectionFromEnv(), query, options));
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
