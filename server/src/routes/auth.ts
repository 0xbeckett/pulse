/**
 * Auth routes: guest identity, signup, login, logout, guest→account upgrade,
 * and "who am I". Sessions are persisted so logout genuinely revokes a token.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { issueToken } from "../auth/jwt.ts";
import { config } from "../config.ts";
import { defaultDisplayName, newId } from "../lib/ids.ts";
import { RateLimiter } from "../lib/ratelimit.ts";
import { publicUser } from "../lib/serialize.ts";
import {
  isValidDeviceId,
  isValidDisplayName,
  isValidEmail,
  isValidPassword,
} from "../lib/validate.ts";

const authLimiter = new RateLimiter(config.authRateLimitPerMinute, 60_000);

function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

export const authRoutes = new Hono<AppEnv>();

async function issueForUser(store: AppEnv["Variables"]["store"], userId: string, isGuest: boolean) {
  const issued = await issueToken(userId, isGuest);
  store.createSession({
    jti: issued.jti,
    userId,
    createdAt: Date.now(),
    expiresAt: issued.expiresAt,
  });
  return issued;
}

/**
 * POST /auth/guest — device-scoped anonymous identity. No signup wall.
 * Returns the same identity for a repeat device so saves/scores stick.
 */
authRoutes.post("/guest", async (c) => {
  if (!authLimiter.take(`guest:${clientIp(c)}`)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const deviceId = body?.deviceId;
  if (!isValidDeviceId(deviceId)) {
    return c.json({ error: "invalid_device_id" }, 400);
  }
  const store = c.get("store");

  let user = store.getUserByDeviceId(deviceId);
  if (!user) {
    user = store.createUser({
      id: newId(),
      isGuest: true,
      deviceId,
      displayName: defaultDisplayName(),
    });
  } else if (!user.isGuest) {
    // Device was already upgraded to a real account; don't hand back a token
    // without a password. Client should log in instead.
    return c.json({ error: "device_upgraded", message: "log in with your account" }, 409);
  }

  const issued = await issueForUser(store, user.id, true);
  return c.json({ token: issued.token, expiresAt: issued.expiresAt, user: publicUser(user) });
});

/** POST /auth/signup — brand-new real account (email + password). */
authRoutes.post("/signup", async (c) => {
  if (!authLimiter.take(`signup:${clientIp(c)}`)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const { email, password, displayName } = body ?? {};
  if (!isValidEmail(email)) return c.json({ error: "invalid_email" }, 400);
  if (!isValidPassword(password)) {
    return c.json({ error: "invalid_password", message: "8-200 characters" }, 400);
  }
  if (displayName !== undefined && !isValidDisplayName(displayName)) {
    return c.json({ error: "invalid_display_name" }, 400);
  }
  const store = c.get("store");
  if (store.getUserByEmail(email)) {
    return c.json({ error: "email_taken" }, 409);
  }
  const passwordHash = await hashPassword(password);
  const user = store.createUser({
    id: newId(),
    isGuest: false,
    email: email.toLowerCase(),
    passwordHash,
    displayName: displayName ?? defaultDisplayName(),
  });
  const issued = await issueForUser(store, user.id, false);
  return c.json({ token: issued.token, expiresAt: issued.expiresAt, user: publicUser(user) }, 201);
});

/** POST /auth/login — real account login. */
authRoutes.post("/login", async (c) => {
  if (!authLimiter.take(`login:${clientIp(c)}`)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body ?? {};
  if (!isValidEmail(email) || typeof password !== "string") {
    return c.json({ error: "invalid_credentials" }, 400);
  }
  const store = c.get("store");
  const user = store.getUserByEmail(email);
  if (!user || !user.passwordHash) {
    // Uniform error to avoid leaking which emails exist.
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return c.json({ error: "invalid_credentials" }, 401);

  const issued = await issueForUser(store, user.id, false);
  return c.json({ token: issued.token, expiresAt: issued.expiresAt, user: publicUser(user) });
});

/**
 * POST /auth/upgrade — convert the authed guest into a real account, keeping
 * the same user id so cloud saves and leaderboard scores carry over.
 */
authRoutes.post("/upgrade", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user.isGuest) {
    return c.json({ error: "already_account" }, 409);
  }
  const body = await c.req.json().catch(() => ({}));
  const { email, password, displayName } = body ?? {};
  if (!isValidEmail(email)) return c.json({ error: "invalid_email" }, 400);
  if (!isValidPassword(password)) {
    return c.json({ error: "invalid_password", message: "8-200 characters" }, 400);
  }
  if (displayName !== undefined && !isValidDisplayName(displayName)) {
    return c.json({ error: "invalid_display_name" }, 400);
  }
  const store = c.get("store");
  const existing = store.getUserByEmail(email);
  if (existing && existing.id !== user.id) {
    return c.json({ error: "email_taken" }, 409);
  }
  const passwordHash = await hashPassword(password);
  const upgraded = store.upgradeGuest(
    user.id,
    email,
    passwordHash,
    displayName,
  );
  // Rotate sessions: invalidate the old guest token, issue a fresh account one.
  store.deleteSessionsForUser(user.id);
  const issued = await issueForUser(store, upgraded.id, false);
  return c.json({ token: issued.token, expiresAt: issued.expiresAt, user: publicUser(upgraded) });
});

/** POST /auth/logout — revoke the current session (delete it server-side). */
authRoutes.post("/logout", requireAuth, async (c) => {
  const store = c.get("store");
  const claims = c.get("claims");
  store.deleteSession(claims.jti);
  return c.json({ ok: true });
});

/** GET /auth/me — the current identity. */
authRoutes.get("/me", requireAuth, (c) => {
  return c.json({ user: publicUser(c.get("user")) });
});
