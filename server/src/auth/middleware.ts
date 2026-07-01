/**
 * Auth middleware. `requireAuth` guards protected routes: it validates the
 * bearer token, confirms the session is still live (not logged out / expired),
 * loads the user, and stashes both claims and user on the context.
 */
import type { Context, MiddlewareHandler } from "hono";
import type { Store, User } from "../db/store.ts";
import { verifyToken, type TokenClaims } from "./jwt.ts";

export interface AppVariables {
  store: Store;
  user: User;
  claims: TokenClaims;
}

export type AppEnv = { Variables: AppVariables };

function bearer(c: Context): string | null {
  const h = c.req.header("Authorization") || c.req.header("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  if (!token) {
    return c.json({ error: "missing_token" }, 401);
  }
  const claims = await verifyToken(token);
  if (!claims) {
    return c.json({ error: "invalid_token" }, 401);
  }

  const store = c.get("store");
  const session = store.getSession(claims.jti);
  if (!session || session.expiresAt < Date.now()) {
    // Logged out, revoked, or expired.
    return c.json({ error: "session_expired" }, 401);
  }

  const user = store.getUserById(claims.sub);
  if (!user) {
    return c.json({ error: "user_not_found" }, 401);
  }

  c.set("claims", claims);
  c.set("user", user);
  await next();
  return;
};
