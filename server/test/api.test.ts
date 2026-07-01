/**
 * End-to-end API tests against an in-memory SQLite store. Exercises every
 * acceptance criterion: guest auth, accounts, cloud saves, upgrade-keeps-save,
 * leaderboards (global + daily + my rank), score validation, and health.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { SqliteStore } from "../src/db/sqlite-store.ts";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.ts";

let store: SqliteStore;
let app: Hono<AppEnv>;

beforeAll(() => {
  store = new SqliteStore(":memory:");
  app = createApp(store);
});
afterAll(() => store.close());

// --- helpers ---
function req(path: string, init: RequestInit = {}) {
  return app.request(
    "http://localhost" + path,
    init,
  );
}
async function json(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  const res = await req(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: data };
}

describe("health", () => {
  test("GET /health returns ok", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.status).toBe("ok");
  });
});

describe("guest auth", () => {
  test("guest gets a token without signup, and is stable per device", async () => {
    const r1 = await json("/v1/auth/guest", "POST", { deviceId: "device-aaaaaaaa" });
    expect(r1.status).toBe(200);
    expect(r1.body.token).toBeString();
    expect(r1.body.user.isGuest).toBe(true);

    const r2 = await json("/v1/auth/guest", "POST", { deviceId: "device-aaaaaaaa" });
    expect(r2.status).toBe(200);
    // Same device → same identity.
    expect(r2.body.user.id).toBe(r1.body.user.id);
  });

  test("guest rejects bad device id", async () => {
    const r = await json("/v1/auth/guest", "POST", { deviceId: "x" });
    expect(r.status).toBe(400);
  });

  test("protected route rejects missing token", async () => {
    const r = await json("/v1/save", "GET");
    expect(r.status).toBe(401);
  });
});

describe("cloud saves", () => {
  let token: string;
  beforeAll(async () => {
    const r = await json("/v1/auth/guest", "POST", { deviceId: "device-save-1234" });
    token = r.body.token;
  });

  test("empty save by default", async () => {
    const r = await json("/v1/save", "GET", undefined, token);
    expect(r.status).toBe(200);
    expect(r.body.save.highScore).toBe(0);
  });

  test("PUT then GET round-trips state", async () => {
    const put = await json(
      "/v1/save",
      "PUT",
      { highScore: 4200, currency: 75, unlocks: ["neon", "pulse2"], settings: { sfx: false } },
      token,
    );
    expect(put.status).toBe(200);
    expect(put.body.save.highScore).toBe(4200);

    const get = await json("/v1/save", "GET", undefined, token);
    expect(get.body.save.currency).toBe(75);
    expect(get.body.save.unlocks).toEqual(["neon", "pulse2"]);
    expect(get.body.save.settings).toEqual({ sfx: false });
  });

  test("rejects negative/invalid save fields", async () => {
    const r = await json("/v1/save", "PUT", { highScore: -1, currency: 0 }, token);
    expect(r.status).toBe(400);
  });

  test("save is scoped to identity (other guest can't see it)", async () => {
    const other = await json("/v1/auth/guest", "POST", { deviceId: "device-other-9999" });
    const r = await json("/v1/save", "GET", undefined, other.body.token);
    expect(r.body.save.highScore).toBe(0); // not 4200
  });
});

describe("accounts: signup / login / logout", () => {
  test("signup, login, and logout revokes the token", async () => {
    const signup = await json("/v1/auth/signup", "POST", {
      email: "player@example.com",
      password: "supersecret",
      displayName: "Neon Ace",
    });
    expect(signup.status).toBe(201);
    expect(signup.body.user.isGuest).toBe(false);
    expect(signup.body.user.email).toBe("player@example.com");

    // Duplicate email rejected.
    const dup = await json("/v1/auth/signup", "POST", {
      email: "player@example.com",
      password: "anotherpass",
    });
    expect(dup.status).toBe(409);

    // Login works.
    const login = await json("/v1/auth/login", "POST", {
      email: "player@example.com",
      password: "supersecret",
    });
    expect(login.status).toBe(200);
    const token = login.body.token;

    // Authed call works...
    const me = await json("/v1/auth/me", "GET", undefined, token);
    expect(me.status).toBe(200);

    // ...until we log out, after which the same token is rejected.
    const logout = await json("/v1/auth/logout", "POST", undefined, token);
    expect(logout.status).toBe(200);
    const meAfter = await json("/v1/auth/me", "GET", undefined, token);
    expect(meAfter.status).toBe(401);
  });

  test("wrong password rejected", async () => {
    await json("/v1/auth/signup", "POST", { email: "wp@example.com", password: "correcthorse" });
    const bad = await json("/v1/auth/login", "POST", { email: "wp@example.com", password: "nope" });
    expect(bad.status).toBe(401);
  });
});

describe("guest → account upgrade keeps save", () => {
  test("upgrade preserves the same identity + save", async () => {
    const guest = await json("/v1/auth/guest", "POST", { deviceId: "device-upgrade-42" });
    const guestId = guest.body.user.id;
    const gtoken = guest.body.token;

    await json("/v1/save", "PUT", { highScore: 9001, currency: 12, unlocks: ["x"], settings: {} }, gtoken);
    // Also post a score so we can prove leaderboard identity carries over.
    await json("/v1/scores", "POST", { score: 9001 }, gtoken);

    const up = await json("/v1/auth/upgrade", "POST", {
      email: "upgraded@example.com",
      password: "hunter2hunter2",
    }, gtoken);
    expect(up.status).toBe(200);
    expect(up.body.user.id).toBe(guestId); // same id
    expect(up.body.user.isGuest).toBe(false);
    const newToken = up.body.token;

    // Save carried over.
    const save = await json("/v1/save", "GET", undefined, newToken);
    expect(save.body.save.highScore).toBe(9001);

    // Old guest token was rotated out (revoked).
    const oldCall = await json("/v1/save", "GET", undefined, gtoken);
    expect(oldCall.status).toBe(401);

    // Can now log in with the account.
    const login = await json("/v1/auth/login", "POST", {
      email: "upgraded@example.com",
      password: "hunter2hunter2",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(guestId);

    // The upgraded device no longer hands out a guest token; it tells the
    // client to log in instead.
    const reGuest = await json("/v1/auth/guest", "POST", { deviceId: "device-upgrade-42" });
    expect(reGuest.status).toBe(409);
    expect(reGuest.body.error).toBe("device_upgraded");
  });
});

describe("leaderboards + score validation", () => {
  let a: string, b: string, cc: string;
  beforeAll(async () => {
    a = (await json("/v1/auth/guest", "POST", { deviceId: "lb-player-a-0001" })).body.token;
    b = (await json("/v1/auth/guest", "POST", { deviceId: "lb-player-b-0002" })).body.token;
    cc = (await json("/v1/auth/guest", "POST", { deviceId: "lb-player-c-0003" })).body.token;
  });

  test("submit scores and fetch top N (global + daily)", async () => {
    await json("/v1/scores", "POST", { score: 100 }, a);
    await json("/v1/scores", "POST", { score: 300 }, b);
    await json("/v1/scores", "POST", { score: 200 }, cc);

    const global = await json("/v1/leaderboard/global?limit=3", "GET");
    expect(global.status).toBe(200);
    const scores = global.body.entries.map((e: { score: number }) => e.score);
    // Sorted descending; b(300) should be at/near the top.
    expect(scores[0]).toBeGreaterThanOrEqual(scores[scores.length - 1]);
    expect(scores).toContain(300);

    const daily = await json("/v1/leaderboard/daily?limit=3", "GET");
    expect(daily.status).toBe(200);
    expect(daily.body.entries.length).toBeGreaterThan(0);
  });

  test("my rank reflects standing", async () => {
    const rankB = await json("/v1/leaderboard/global/me", "GET", undefined, b);
    expect(rankB.status).toBe(200);
    expect(rankB.body.rank).toBeGreaterThanOrEqual(1);
    expect(rankB.body.score).toBe(300);

    const dailyRank = await json("/v1/leaderboard/daily/me", "GET", undefined, b);
    expect(dailyRank.body.rank).toBeGreaterThanOrEqual(1);
  });

  test("best score only improves ranking, lower resubmits don't hurt", async () => {
    await json("/v1/scores", "POST", { score: 50 }, b); // lower than 300
    const rankB = await json("/v1/leaderboard/global/me", "GET", undefined, b);
    expect(rankB.body.score).toBe(300); // still best
  });

  test("rejects tampered scores (non-int, negative, absurd)", async () => {
    expect((await json("/v1/scores", "POST", { score: -5 }, a)).status).toBe(400);
    expect((await json("/v1/scores", "POST", { score: 3.5 }, a)).status).toBe(400);
    expect((await json("/v1/scores", "POST", { score: "999" }, a)).status).toBe(400);
    expect((await json("/v1/scores", "POST", { score: 999999999999 }, a)).status).toBe(422);
  });
});
