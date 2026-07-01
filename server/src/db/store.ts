/**
 * The data-access contract the rest of the app depends on. Routes never touch
 * SQL directly — they go through a `Store`. Swapping SQLite for Postgres later
 * means writing a new implementation of this interface, nothing else.
 */

export interface User {
  id: string;
  isGuest: boolean;
  deviceId: string | null;
  email: string | null;
  passwordHash: string | null;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export interface Save {
  userId: string;
  highScore: number;
  currency: number;
  unlocks: unknown;
  settings: unknown;
  updatedAt: number;
}

export interface Session {
  jti: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
}

export interface RankInfo {
  rank: number | null; // null when the user has no qualifying score
  score: number | null;
  total: number; // total ranked players on this board
}

export interface NewUser {
  id: string;
  isGuest: boolean;
  deviceId?: string | null;
  email?: string | null;
  passwordHash?: string | null;
  displayName: string;
}

export interface Store {
  // --- users ---
  createUser(u: NewUser): User;
  getUserById(id: string): User | null;
  getUserByEmail(email: string): User | null;
  getUserByDeviceId(deviceId: string): User | null;
  /** Convert a guest into a real account in place (keeps the same id). */
  upgradeGuest(
    userId: string,
    email: string,
    passwordHash: string,
    displayName?: string,
  ): User;

  // --- saves ---
  getSave(userId: string): Save | null;
  upsertSave(
    userId: string,
    patch: {
      highScore: number;
      currency: number;
      unlocks: unknown;
      settings: unknown;
    },
  ): Save;

  // --- scores / leaderboards ---
  insertScore(id: string, userId: string, score: number, day: string): void;
  /** Best (max) score this user has ever posted. */
  bestScore(userId: string, scope: "global" | "daily", day: string): number | null;
  topScores(scope: "global" | "daily", day: string, limit: number): LeaderboardEntry[];
  myRank(userId: string, scope: "global" | "daily", day: string): RankInfo;
  /** Count of a user's score submissions since a given epoch-ms timestamp. */
  countScoresSince(userId: string, sinceMs: number): number;

  // --- sessions ---
  createSession(s: Session): void;
  getSession(jti: string): Session | null;
  deleteSession(jti: string): void;
  deleteSessionsForUser(userId: string): void;

  close(): void;
}
