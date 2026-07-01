/**
 * Server entry point. Opens the SQLite store (running migrations), builds the
 * app, and starts listening. Designed to run under `bun run src/index.ts` and
 * to sit behind the Beckett Cloudflare tunnel bound to 127.0.0.1.
 */
import { config } from "./config.ts";
import { createApp } from "./app.ts";
import { SqliteStore } from "./db/sqlite-store.ts";

const store = new SqliteStore(config.dbPath);
const app = createApp(store);

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
});

console.log(
  `[pulse-server] listening on http://${config.host}:${server.port} ` +
    `(env=${config.nodeEnv}, db=${config.dbPath})`,
);
console.log(`[pulse-server] CORS origins: ${config.corsOrigins.join(", ")}`);

function shutdown(sig: string) {
  console.log(`\n[pulse-server] ${sig} received, shutting down`);
  server.stop();
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
