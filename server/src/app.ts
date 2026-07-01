/**
 * Builds the Hono application. The store is injected so tests can supply an
 * in-memory database while production uses the on-disk SQLite file.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.ts";
import type { AppEnv } from "./auth/middleware.ts";
import type { Store } from "./db/store.ts";
import { authRoutes } from "./routes/auth.ts";
import { saveRoutes } from "./routes/save.ts";
import { scoreRoutes } from "./routes/scores.ts";
import { leaderboardRoutes } from "./routes/leaderboard.ts";
import { staticSite } from "./lib/static.ts";

export function createApp(store: Store): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // CORS — only the configured origins (incl. pulse.0xbeckett.me) may call us.
  app.use(
    "*",
    cors({
      origin: (origin) => (config.corsOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
      maxAge: 86400,
    }),
  );

  // Make the store available on every request context.
  app.use("*", async (c, next) => {
    c.set("store", store);
    await next();
  });

  // Health — liveness probe for the tunnel / load balancer.
  app.get("/health", (c) =>
    c.json({ status: "ok", service: "pulse-server", time: Date.now() }),
  );

  // Versioned API surface.
  app.route("/v1/auth", authRoutes);
  app.route("/v1/save", saveRoutes);
  app.route("/v1/scores", scoreRoutes);
  app.route("/v1/leaderboard", leaderboardRoutes);

  // Static game client (same origin as the API). Registered last so it only
  // catches non-API GETs. Empty staticDir ⇒ API-only (tests / headless).
  if (config.staticDir) {
    app.get("*", staticSite(config.staticDir));
  }

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error("[error]", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
