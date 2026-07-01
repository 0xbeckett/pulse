/**
 * Ordered, append-only migration list. Each migration runs exactly once and is
 * recorded in the `_migrations` table. Never edit a migration that has already
 * shipped — add a new one instead.
 *
 * SQL here is written for SQLite but deliberately kept simple/portable so the
 * store can be reimplemented on Postgres later (see db/store.ts for the
 * swappable interface the rest of the app talks to).
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly up: string;
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    up: /* sql */ `
      -- Every identity — guest or real account — is a row here.
      -- Guests have a device_id and no email/password. On upgrade the same row
      -- gains an email + password_hash, so saves and scores carry over for free.
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        is_guest      INTEGER NOT NULL DEFAULT 1,
        device_id     TEXT,
        email         TEXT,
        password_hash TEXT,
        display_name  TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      -- Emails are unique among real accounts (case-insensitive, stored lower).
      CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
      -- A device maps to at most one guest identity.
      CREATE UNIQUE INDEX idx_users_device ON users(device_id) WHERE device_id IS NOT NULL;

      -- One cloud-save row per user (1:1). unlocks/settings are opaque JSON blobs.
      CREATE TABLE saves (
        user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        high_score INTEGER NOT NULL DEFAULT 0,
        currency   INTEGER NOT NULL DEFAULT 0,
        unlocks    TEXT NOT NULL DEFAULT '[]',
        settings   TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );

      -- Every accepted score submission. Leaderboards are derived from this.
      -- The 'day' column is the UTC date (YYYY-MM-DD) used for the daily board.
      CREATE TABLE scores (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score      INTEGER NOT NULL,
        day        TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_scores_score ON scores(score DESC);
      CREATE INDEX idx_scores_day_score ON scores(day, score DESC);
      CREATE INDEX idx_scores_user ON scores(user_id);

      -- Active auth sessions. A JWT is only honoured while its jti exists here,
      -- which is what makes logout (row delete) actually revoke a token.
      CREATE TABLE sessions (
        jti        TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
    `,
  },
];
