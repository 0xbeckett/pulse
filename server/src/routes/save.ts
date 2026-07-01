/**
 * Cloud save routes — read/write the authed player's game state. All routes are
 * scoped to the caller's identity; there is no way to read another user's save.
 */
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { emptySave, publicSave } from "../lib/serialize.ts";
import { safeNonNegInt, withinJsonSizeLimit } from "../lib/validate.ts";

export const saveRoutes = new Hono<AppEnv>();

saveRoutes.use("*", requireAuth);

/** GET /save — the caller's cloud save (empty defaults if never written). */
saveRoutes.get("/", (c) => {
  const store = c.get("store");
  const save = store.getSave(c.get("user").id);
  return c.json({ save: save ? publicSave(save) : emptySave() });
});

/** PUT /save — overwrite the caller's cloud save. */
saveRoutes.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "invalid_body" }, 400);
  }

  const highScore = safeNonNegInt(body.highScore);
  if (highScore === null) return c.json({ error: "invalid_high_score" }, 400);

  const currency = safeNonNegInt(body.currency);
  if (currency === null) return c.json({ error: "invalid_currency" }, 400);

  const unlocks = body.unlocks ?? [];
  if (!Array.isArray(unlocks)) return c.json({ error: "invalid_unlocks" }, 400);

  const settings = body.settings ?? {};
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return c.json({ error: "invalid_settings" }, 400);
  }

  if (!withinJsonSizeLimit(unlocks) || !withinJsonSizeLimit(settings)) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  const store = c.get("store");
  const saved = store.upsertSave(c.get("user").id, {
    highScore,
    currency,
    unlocks,
    settings,
  });
  return c.json({ save: publicSave(saved) });
});
