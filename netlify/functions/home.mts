// GET /api/home on Netlify: a few cards chosen at random and the newest sets, for the home page.
import type { Config } from "@netlify/functions";
import { handleHome } from "../../app/api.ts";
import { home } from "../../app/home.ts";
import { collectionsFromEnv } from "../../app/topk.ts";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  return handleHome(() => home(collectionsFromEnv()));
};

export const config: Config = {
  path: "/api/home",
  // Two filters and no inference call. Held by the CDN for a minute, so this is seldom reached.
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
