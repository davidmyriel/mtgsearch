// Local server for development and the browser test: the page from public/ plus /api/search,
// /api/card and /api/home.
//
//   npm run dev            http://127.0.0.1:8000
//
// On Netlify the same page is served by the CDN and the same handler runs as a function
// (netlify/functions/search.mts, card.mts and home.mts); `npx netlify-cli dev --offline` reproduces that setup.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { handleCard, handleHome, handleSearch } from "./api.ts";
import { card, randomCard } from "./card.ts";
import { home } from "./home.ts";
import { search } from "./search.ts";
import { collectionsFromEnv } from "./topk.ts";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
};
// Keep in step with [[headers]] in netlify.toml; a test compares the two.
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' https://cards.scryfall.io; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export function createDevServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api/search" || url.pathname === "/api/card" || url.pathname === "/api/home") {
      const answer =
        url.pathname === "/api/home"
          ? await handleHome(url, (example) => home(collectionsFromEnv(), Math.random, example))
          : url.pathname === "/api/card"
          ? await handleCard(url, (set, number) => card(collectionsFromEnv(), set, number), () => randomCard(collectionsFromEnv()))
          : await handleSearch(url, (query, options) => search(collectionsFromEnv(), query, options));
      response.writeHead(answer.status, Object.fromEntries(answer.headers));
      response.end(await answer.text());
      return;
    }
    // A card's page, /card/<set>/<number>/<name>, is the same page (see [[redirects]] in netlify.toml).
    // /random is the same page too: its script asks for a card and goes to that card's address.
    const isPage = url.pathname === "/" || url.pathname === "/random" || url.pathname.startsWith("/card/");
    const name = isPage ? "index.html" : url.pathname === "/syntax" ? "syntax.html" : url.pathname.slice(1);
    const type = TYPES[name.split(".").pop() ?? ""];
    try {
      if (!type || !/^[\w.-]+$/.test(name)) throw new Error("not a public file");
      const body = await readFile(PUBLIC + name);
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
      response.end("Not found");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8000);
  createDevServer().listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
}
