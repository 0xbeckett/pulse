/**
 * Runtime configuration, sourced from environment variables with sane
 * local-dev defaults. Everything here is read once at startup.
 */
import { randomBytes } from "node:crypto";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

// A stable secret is required in production. For local dev we generate an
// ephemeral one so the server still boots, but tokens won't survive a restart.
function jwtSecret(): string {
  const v = process.env.PULSE_JWT_SECRET;
  if (v && v.length >= 16) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PULSE_JWT_SECRET must be set (>=16 chars) in production",
    );
  }
  const ephemeral = randomBytes(32).toString("hex");
  console.warn(
    "[config] PULSE_JWT_SECRET not set — using an ephemeral dev secret. " +
      "Tokens will be invalidated on restart. Set PULSE_JWT_SECRET for real use.",
  );
  return ephemeral;
}

export const config = {
  port: Number(env("PORT", "8787")),
  host: env("HOST", "127.0.0.1"),
  nodeEnv: env("NODE_ENV", "development"),

  jwtSecret: jwtSecret(),
  // How long an issued session/token is valid.
  tokenTtlSeconds: Number(env("PULSE_TOKEN_TTL_SECONDS", String(60 * 60 * 24 * 30))), // 30 days

  // SQLite database file. ":memory:" is honoured for tests.
  dbPath: env("PULSE_DB_PATH", "./data/pulse.sqlite"),

  // Comma-separated list of allowed CORS origins.
  corsOrigins: env(
    "PULSE_CORS_ORIGINS",
    "https://pulse.0xbeckett.me,http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Server-side score sanity ceiling. Any submitted score above this is
  // rejected outright as blatant tampering. Tune to the game's real ceiling.
  maxPlausibleScore: Number(env("PULSE_MAX_SCORE", "10000000")),

  // Score submissions per user per rolling minute.
  scoreRateLimitPerMinute: Number(env("PULSE_SCORE_RATE", "20")),
  // Auth attempts (login/signup/guest) per IP per rolling minute.
  authRateLimitPerMinute: Number(env("PULSE_AUTH_RATE", "30")),
} as const;

export type Config = typeof config;
