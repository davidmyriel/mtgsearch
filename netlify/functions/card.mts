// GET /api/card on Netlify: one printing and the card's other printings, for a card's own page.
import type { Config } from "@netlify/functions";
import { handleCard } from "../../app/api.ts";
import { card, randomCard } from "../../app/card.ts";
import { collectionsFromEnv } from "../../app/topk.ts";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const cols = collectionsFromEnv();
  return handleCard(new URL(request.url), (set, number) => card(cols, set, number), () => randomCard(cols));
};

export const config: Config = {
  path: "/api/card",
  // Two filters and no inference call, so more generous than the search limit.
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
