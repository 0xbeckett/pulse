/**
 * Serves the built static game client from disk on the same origin as the API,
 * so the game and backend live behind a single port/tunnel with no CORS.
 *
 * Registered as a catch-all *after* the `/v1` and `/health` API routes, so it
 * only ever handles non-API paths. Unknown paths fall back to index.html.
 */
import type { MiddlewareHandler } from "hono";
import { join, normalize } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function headersFor(file: string): Record<string, string> {
  const ext = file.slice(file.lastIndexOf("."));
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] || "application/octet-stream",
  };
  // Content-hashed bundle can cache hard; everything else must revalidate.
  if (/bundle\.[a-z0-9]+\.js$/.test(file)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else {
    headers["cache-control"] = "no-cache";
  }
  return headers;
}

/** Build a middleware that serves files from `root` (absolute path). */
export function staticSite(root: string): MiddlewareHandler {
  return async (c) => {
    let path = decodeURIComponent(new URL(c.req.url).pathname);
    if (path === "/" || path === "") path = "/index.html";

    // Prevent path traversal, then confine to the root.
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, safe);
    if (!file.startsWith(root)) return c.text("forbidden", 403);

    let f = Bun.file(file);
    if (!(await f.exists())) {
      // SPA-ish fallback so deep links / refreshes still load the game.
      file = join(root, "index.html");
      f = Bun.file(file);
      if (!(await f.exists())) return c.json({ error: "not_found" }, 404);
    }
    return new Response(f, { headers: headersFor(file) });
  };
}
