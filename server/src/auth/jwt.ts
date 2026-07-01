/**
 * JWT issuing/verification. We use HS256 JWTs whose `jti` references a row in
 * the sessions table — the token is only accepted while that session exists,
 * which is what gives us real, server-side logout (revocation) despite JWTs
 * being nominally stateless.
 */
import { sign, verify } from "hono/jwt";
import { config } from "../config.ts";
import { newId } from "../lib/ids.ts";

export interface TokenClaims {
  sub: string; // user id
  jti: string; // session id
  guest: boolean;
  exp: number; // epoch seconds
  iat: number;
  // hono's JWTPayload is an open record; this keeps the types compatible.
  [key: string]: unknown;
}

export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: number; // epoch ms
}

export async function issueToken(
  userId: string,
  isGuest: boolean,
): Promise<IssuedToken> {
  const jti = newId();
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + config.tokenTtlSeconds;
  const payload: TokenClaims = {
    sub: userId,
    jti,
    guest: isGuest,
    iat: nowSec,
    exp: expSec,
  };
  const token = await sign(payload, config.jwtSecret, "HS256");
  return { token, jti, expiresAt: expSec * 1000 };
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  try {
    const claims = (await verify(token, config.jwtSecret, "HS256")) as unknown;
    if (
      claims &&
      typeof claims === "object" &&
      typeof (claims as TokenClaims).sub === "string" &&
      typeof (claims as TokenClaims).jti === "string"
    ) {
      return claims as TokenClaims;
    }
    return null;
  } catch {
    // Covers bad signature and expired tokens (hono throws on exp).
    return null;
  }
}
