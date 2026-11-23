// GET /api/home on Netlify: a few cards and the newest sets, for the home page. With ?try=<example>
// the cards are found by the example the page's empty search box is showing.
import type { Config } from "@netlify/functions";
import { handleHome } from "../../app/api.ts";
import { home } from "../../app/home.ts";
import { collectionsFromEnv } from "../../app/topk.ts";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  return handleHome(new URL(request.url), (example) => home(collectionsFromEnv(), Math.random, example));
};

export const config: Config = {
  path: "/api/home",
  // A few filters, and one search when an example is named. Held by the CDN for a minute for
  // each example, so this is seldom reached.
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
