/**
 * SQLite implementation of the Store, backed by Bun's built-in `bun:sqlite`
 * (zero native deps). Runs pending migrations on construction.
 */
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";
import type {
  LeaderboardEntry,
  NewUser,
  RankInfo,
  Save,
  Session,
  Store,
  User,
} from "./store.ts";

interface UserRow {
  id: string;
  is_guest: number;
  device_id: string | null;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  created_at: number;
  updated_at: number;
}

interface SaveRow {
  user_id: string;
  high_score: number;
  currency: number;
  unlocks: string;
  settings: string;
  updated_at: number;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    isGuest: r.is_guest === 1,
    deviceId: r.device_id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toSave(r: SaveRow): Save {
  return {
    userId: r.user_id,
    highScore: r.high_score,
    currency: r.currency,
    unlocks: safeParse(r.unlocks, []),
    settings: safeParse(r.settings, {}),
    updatedAt: r.updated_at,
  };
}

function safeParse(s: string, fallback: unknown): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export class SqliteStore implements Store {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
    const applied = new Set(
      this.db
        .query<{ id: number }, []>("SELECT id FROM _migrations")
        .all()
        .map((r) => r.id),
    );
    const record = this.db.prepare(
      "INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      const tx = this.db.transaction(() => {
        this.db.exec(m.up);
        record.run(m.id, m.name, Date.now());
      });
      tx();
      console.log(`[db] applied migration ${m.id} (${m.name})`);
    }
  }

  // --- users ---

  createUser(u: NewUser): User {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO users (id, is_guest, device_id, email, password_hash, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        u.id,
        u.isGuest ? 1 : 0,
        u.deviceId ?? null,
        u.email ?? null,
        u.passwordHash ?? null,
        u.displayName,
        now,
        now,
      );
    return this.getUserById(u.id)!;
  }

  getUserById(id: string): User | null {
    const r = this.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
      .get(id);
    return r ? toUser(r) : null;
  }

  getUserByEmail(email: string): User | null {
    const r = this.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase());
    return r ? toUser(r) : null;
  }

  getUserByDeviceId(deviceId: string): User | null {
    const r = this.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE device_id = ?")
      .get(deviceId);
    return r ? toUser(r) : null;
  }

  upgradeGuest(
    userId: string,
    email: string,
    passwordHash: string,
    displayName?: string,
  ): User {
    const now = Date.now();
    if (displayName !== undefined) {
      this.db
        .prepare(
          `UPDATE users
             SET is_guest = 0, email = ?, password_hash = ?, display_name = ?,
                 device_id = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(email.toLowerCase(), passwordHash, displayName, now, userId);
    } else {
      this.db
        .prepare(
          `UPDATE users
             SET is_guest = 0, email = ?, password_hash = ?,
                 device_id = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(email.toLowerCase(), passwordHash, now, userId);
    }
    return this.getUserById(userId)!;
  }

  // --- saves ---

  getSave(userId: string): Save | null {
    const r = this.db
      .query<SaveRow, [string]>("SELECT * FROM saves WHERE user_id = ?")
      .get(userId);
    return r ? toSave(r) : null;
  }

  upsertSave(
    userId: string,
    patch: {
      highScore: number;
      currency: number;
      unlocks: unknown;
      settings: unknown;
    },
  ): Save {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO saves (user_id, high_score, currency, unlocks, settings, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           high_score = excluded.high_score,
           currency   = excluded.currency,
           unlocks    = excluded.unlocks,
           settings   = excluded.settings,
           updated_at = excluded.updated_at`,
      )
      .run(
        userId,
        patch.highScore,
        patch.currency,
        JSON.stringify(patch.unlocks ?? []),
        JSON.stringify(patch.settings ?? {}),
        now,
      );
    return this.getSave(userId)!;
  }

  // --- scores / leaderboards ---

  insertScore(id: string, userId: string, score: number, day: string): void {
    this.db
      .prepare(
        "INSERT INTO scores (id, user_id, score, day, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, userId, score, day, Date.now());
  }

  bestScore(
    userId: string,
    scope: "global" | "daily",
    day: string,
  ): number | null {
    const sql =
      scope === "daily"
        ? "SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND day = ?"
        : "SELECT MAX(score) AS best FROM scores WHERE user_id = ?";
    const r =
      scope === "daily"
        ? this.db
            .query<{ best: number | null }, [string, string]>(sql)
            .get(userId, day)
        : this.db
            .query<{ best: number | null }, [string]>(sql)
            .get(userId);
    return r?.best ?? null;
  }

  topScores(
    scope: "global" | "daily",
    day: string,
    limit: number,
  ): LeaderboardEntry[] {
    // One row per player: their best score on this board, joined to display name.
    const filter = scope === "daily" ? "WHERE s.day = ?" : "";
    const sql = /* sql */ `
      SELECT u.id AS user_id, u.display_name AS display_name, MAX(s.score) AS score
      FROM scores s
      JOIN users u ON u.id = s.user_id
      ${filter}
      GROUP BY s.user_id
      ORDER BY score DESC, MIN(s.created_at) ASC
      LIMIT ?
    `;
    const rows =
      scope === "daily"
        ? this.db
            .query<
              { user_id: string; display_name: string; score: number },
              [string, number]
            >(sql)
            .all(day, limit)
        : this.db
            .query<
              { user_id: string; display_name: string; score: number },
              [number]
            >(sql)
            .all(limit);
    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      displayName: r.display_name,
      score: r.score,
    }));
  }

  myRank(
    userId: string,
    scope: "global" | "daily",
    day: string,
  ): RankInfo {
    const best = this.bestScore(userId, scope, day);

    // Total distinct players with at least one score on this board.
    const totalSql =
      scope === "daily"
        ? "SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE day = ?"
        : "SELECT COUNT(DISTINCT user_id) AS n FROM scores";
    const total =
      (scope === "daily"
        ? this.db.query<{ n: number }, [string]>(totalSql).get(day)?.n
        : this.db.query<{ n: number }, []>(totalSql).get()?.n) ?? 0;

    if (best === null) return { rank: null, score: null, total };

    // Rank = (players whose best score is strictly greater) + 1.
    const higherSql =
      scope === "daily"
        ? /* sql */ `
            SELECT COUNT(*) AS n FROM (
              SELECT user_id, MAX(score) AS best FROM scores WHERE day = ?
              GROUP BY user_id HAVING best > ?
            )`
        : /* sql */ `
            SELECT COUNT(*) AS n FROM (
              SELECT user_id, MAX(score) AS best FROM scores
              GROUP BY user_id HAVING best > ?
            )`;
    const higher =
      (scope === "daily"
        ? this.db
            .query<{ n: number }, [string, number]>(higherSql)
            .get(day, best)?.n
        : this.db.query<{ n: number }, [number]>(higherSql).get(best)?.n) ?? 0;

    return { rank: higher + 1, score: best, total };
  }

  countScoresSince(userId: string, sinceMs: number): number {
    return (
      this.db
        .query<
          { n: number },
          [string, number]
        >("SELECT COUNT(*) AS n FROM scores WHERE user_id = ? AND created_at >= ?")
        .get(userId, sinceMs)?.n ?? 0
    );
  }

  // --- sessions ---

  createSession(s: Session): void {
    this.db
      .prepare(
        "INSERT INTO sessions (jti, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(s.jti, s.userId, s.createdAt, s.expiresAt);
  }

  getSession(jti: string): Session | null {
    const r = this.db
      .query<
        {
          jti: string;
          user_id: string;
          created_at: number;
          expires_at: number;
        },
        [string]
      >("SELECT * FROM sessions WHERE jti = ?")
      .get(jti);
    if (!r) return null;
    return {
      jti: r.jti,
      userId: r.user_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    };
  }

  deleteSession(jti: string): void {
    this.db.prepare("DELETE FROM sessions WHERE jti = ?").run(jti);
  }

  deleteSessionsForUser(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  close(): void {
    this.db.close();
  }
}
