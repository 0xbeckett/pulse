/**
 * Minimal static file server for the built ./dist, bound to 127.0.0.1.
 * Long-lived (run under systemd --user) so the public tunnel stays alive.
 */
import { join, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";

const root = join(import.meta.dir, "..", "dist");
const port = Number(process.env.PORT || 8787);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/" || path === "") path = "/index.html";
    // Prevent path traversal.
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, safe);
    if (!file.startsWith(root)) return new Response("forbidden", { status: 403 });
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(root, "index.html"); // SPA-ish fallback
    }
    const ext = file.slice(file.lastIndexOf("."));
    const headers: Record<string, string> = {
      "content-type": TYPES[ext] || "application/octet-stream",
    };
    // sw.js and index must revalidate; hashed bundle can cache hard.
    if (file.endsWith("bundle.") || /bundle\.[a-z0-9]+\.js$/.test(file)) {
      headers["cache-control"] = "public, max-age=31536000, immutable";
    } else {
      headers["cache-control"] = "no-cache";
    }
    return new Response(Bun.file(file), { headers });
  },
});

console.log(`Pulse serving dist/ on http://127.0.0.1:${port}`);
