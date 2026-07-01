/**
 * Score submission. Scores are validated server-side against blatant tampering
 * (type/range sanity + per-user rate limiting) before being accepted onto the
 * leaderboards. This is intentionally basic anti-abuse, not full anti-cheat.
 */
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { config } from "../config.ts";
import { newId } from "../lib/ids.ts";
import { utcDay } from "../lib/time.ts";
import { safeNonNegInt } from "../lib/validate.ts";

export const scoreRoutes = new Hono<AppEnv>();

scoreRoutes.use("*", requireAuth);

/**
 * POST /scores — submit a run's score. Returns the caller's refreshed best
 * scores and ranks on both boards.
 */
scoreRoutes.post("/", async (c) => {
  const user = c.get("user");
  const store = c.get("store");

  const body = await c.req.json().catch(() => null);
  const score = safeNonNegInt(body?.score);
  if (score === null) {
    return c.json({ error: "invalid_score", message: "score must be a non-negative integer" }, 400);
  }
  if (score > config.maxPlausibleScore) {
    // Blatantly out of range — reject as tampering.
    return c.json({ error: "score_out_of_range", message: "score exceeds plausible maximum" }, 422);
  }

  // Per-user rate limit, persistence-backed so it survives restarts.
  const recent = store.countScoresSince(user.id, Date.now() - 60_000);
  if (recent >= config.scoreRateLimitPerMinute) {
    return c.json({ error: "rate_limited", message: "too many score submissions" }, 429);
  }

  const day = utcDay();
  store.insertScore(newId(), user.id, score, day);

  return c.json(
    {
      accepted: true,
      score,
      best: {
        global: store.bestScore(user.id, "global", day),
        daily: store.bestScore(user.id, "daily", day),
      },
      rank: {
        global: store.myRank(user.id, "global", day),
        daily: store.myRank(user.id, "daily", day),
      },
    },
    201,
  );
});
