// Local server for development and the browser test: the page from public/ plus /api/search.
//
//   npm run dev            http://127.0.0.1:8000
//
// On Netlify the same page is served by the CDN and the same handler runs as a function
// (netlify/functions/search.mts); `npx netlify-cli dev --offline` reproduces that setup.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { handleSearch } from "./api.ts";
import { search } from "./search.ts";
import { collectionsFromEnv } from "./topk.ts";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
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
    if (url.pathname === "/api/search") {
      const answer = await handleSearch(url, (query, options) => search(collectionsFromEnv(), query, options));
      response.writeHead(answer.status, Object.fromEntries(answer.headers));
      response.end(await answer.text());
      return;
    }
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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
