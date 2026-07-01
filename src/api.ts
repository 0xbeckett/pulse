/**
 * Backend client for Pulse. Talks to the same-origin API under `/v1`:
 * guest-first identity, optional account signup/login/upgrade, cloud saves,
 * score submission, and leaderboards.
 *
 * Everything here degrades gracefully: if the network or backend is down the
 * game stays fully playable (local storage keeps working); API calls just
 * reject and callers swallow the error.
 */

const API = "/v1";
const TOKEN_KEY = "pulse.token";
const DEVICE_KEY = "pulse.deviceId";

export interface User {
  id: string;
  isGuest: boolean;
  email: string | null;
  displayName: string;
  createdAt: number;
}

export interface CloudSave {
  highScore: number;
  currency: number;
  unlocks: unknown[];
  settings: Record<string, unknown>;
  updatedAt: number;
}

export interface RankInfo {
  rank: number | null;
  score: number | null;
  total: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
}

/** A thrown API error carrying the server's machine-readable error code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public info?: string,
  ) {
    super(info || code);
  }
}

function ensureDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || id.length < 8) {
      id =
        (crypto.randomUUID?.() ?? "") ||
        `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked (private mode): fall back to an ephemeral per-session id.
    return `eph-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

export class Api {
  user: User | null = null;
  /** True once we've learned this device is linked to a real account and so
   *  can no longer get a guest identity — the player must log in. */
  deviceUpgraded = false;
  private token: string | null = null;
  private deviceId: string;

  constructor() {
    this.deviceId = ensureDeviceId();
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      this.token = null;
    }
  }

  get isAuthed(): boolean {
    return !!this.token && !!this.user;
  }

  get isGuest(): boolean {
    return !this.user || this.user.isGuest;
  }

  private setToken(token: string | null) {
    this.token = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  private async req<T>(
    path: string,
    opts: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.auth !== false && this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const res = await fetch(API + path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      throw new ApiError(res.status, data?.error ?? "http_error", data?.message);
    }
    return data as T;
  }

  /**
   * Establish identity on first load. Reuses a stored token if it's still
   * valid; otherwise grabs a fresh device-scoped guest identity. On a 401 the
   * stale token is dropped and we re-guest. Returns the current user, or null
   * if the backend is unreachable (offline play).
   */
  async init(): Promise<User | null> {
    if (this.token) {
      try {
        const { user } = await this.req<{ user: User }>("/auth/me");
        this.user = user;
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          this.setToken(null);
        } else {
          return null; // network/server error — stay offline, keep the token
        }
      }
    }
    return this.guest();
  }

  /** Device-scoped anonymous identity. */
  async guest(): Promise<User | null> {
    try {
      const r = await this.req<{ token: string; user: User }>("/auth/guest", {
        auth: false,
        body: { deviceId: this.deviceId },
      });
      this.setToken(r.token);
      this.user = r.user;
      this.deviceUpgraded = false;
      return r.user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Device already upgraded to a real account — the player must log in.
        this.user = null;
        this.deviceUpgraded = true;
        throw e;
      }
      return null; // offline
    }
  }

  async signup(email: string, password: string, displayName?: string): Promise<User> {
    const r = await this.req<{ token: string; user: User }>("/auth/signup", {
      auth: false,
      body: { email, password, displayName: displayName || undefined },
    });
    this.setToken(r.token);
    this.user = r.user;
    this.deviceUpgraded = false;
    return r.user;
  }

  async login(email: string, password: string): Promise<User> {
    const r = await this.req<{ token: string; user: User }>("/auth/login", {
      auth: false,
      body: { email, password },
    });
    this.setToken(r.token);
    this.user = r.user;
    this.deviceUpgraded = false;
    return r.user;
  }

  /** Convert the current guest into a real account, keeping the same id/save. */
  async upgrade(email: string, password: string, displayName?: string): Promise<User> {
    const r = await this.req<{ token: string; user: User }>("/auth/upgrade", {
      body: { email, password, displayName: displayName || undefined },
    });
    this.setToken(r.token);
    this.user = r.user;
    this.deviceUpgraded = false;
    return r.user;
  }

  async logout(): Promise<void> {
    try {
      await this.req("/auth/logout", { method: "POST" });
    } catch {
      /* revoke best-effort */
    }
    this.setToken(null);
    this.user = null;
    // Drop back to a fresh guest identity so the game keeps syncing.
    await this.guest().catch(() => null);
  }

  async getSave(): Promise<CloudSave | null> {
    try {
      const { save } = await this.req<{ save: CloudSave }>("/save");
      return save;
    } catch {
      return null;
    }
  }

  async putSave(save: {
    highScore: number;
    currency: number;
    unlocks: unknown[];
    settings: Record<string, unknown>;
  }): Promise<CloudSave | null> {
    try {
      const { save: saved } = await this.req<{ save: CloudSave }>("/save", {
        method: "PUT",
        body: save,
      });
      return saved;
    } catch {
      return null;
    }
  }

  async submitScore(score: number): Promise<{
    best: { global: number | null; daily: number | null };
    rank: { global: RankInfo; daily: RankInfo };
  } | null> {
    try {
      return await this.req("/scores", { body: { score: Math.floor(score) } });
    } catch {
      return null;
    }
  }

  async leaderboard(
    scope: "global" | "daily",
    limit = 20,
  ): Promise<LeaderboardEntry[]> {
    try {
      const { entries } = await this.req<{ entries: LeaderboardEntry[] }>(
        `/leaderboard/${scope}?limit=${limit}`,
        { auth: false },
      );
      return entries;
    } catch {
      return [];
    }
  }

  async myRank(scope: "global" | "daily"): Promise<RankInfo | null> {
    try {
      return await this.req<RankInfo>(`/leaderboard/${scope}/me`);
    } catch {
      return null;
    }
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
