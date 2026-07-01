/**
 * Leaderboard reads: top-N for the global all-time board and the rolling daily
 * board, plus the authed caller's own rank on either board.
 *
 * Top-N is public (no auth); "my rank" requires auth.
 */
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { utcDay } from "../lib/time.ts";

export const leaderboardRoutes = new Hono<AppEnv>();

function parseLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

/** GET /leaderboard/global?limit=N */
leaderboardRoutes.get("/global", (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const store = c.get("store");
  return c.json({
    scope: "global",
    limit,
    entries: store.topScores("global", utcDay(), limit),
  });
});

/** GET /leaderboard/daily?limit=N[&day=YYYY-MM-DD] */
leaderboardRoutes.get("/daily", (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("day") ?? "")
    ? (c.req.query("day") as string)
    : utcDay();
  const store = c.get("store");
  return c.json({
    scope: "daily",
    day,
    limit,
    entries: store.topScores("daily", day, limit),
  });
});

/** GET /leaderboard/global/me — the caller's global rank. */
leaderboardRoutes.get("/global/me", requireAuth, (c) => {
  const store = c.get("store");
  return c.json({
    scope: "global",
    ...store.myRank(c.get("user").id, "global", utcDay()),
  });
});

/** GET /leaderboard/daily/me — the caller's rank on today's board. */
leaderboardRoutes.get("/daily/me", requireAuth, (c) => {
  const store = c.get("store");
  const day = utcDay();
  return c.json({
    scope: "daily",
    day,
    ...store.myRank(c.get("user").id, "daily", day),
  });
});
