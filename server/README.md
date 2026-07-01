# Pulse Backend

A small, self-contained REST/JSON backend for **Pulse**, the one-thumb neon
endless arcade game. Handles guest-first identity, real email/password accounts,
cloud saves, and global + daily leaderboards.

Built with [Bun](https://bun.sh) + [Hono](https://hono.dev) + `bun:sqlite`.
No native dependencies, no build step — clone, install, run.

---

## Quick start

```bash
cd server
bun install
bun run migrate      # optional: create/upgrade the DB (also runs automatically on start)
bun run start        # serves on http://127.0.0.1:8787
bun test             # run the API test suite
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

### Configuration (env vars)

| Variable                  | Default                                          | Purpose |
| ------------------------- | ------------------------------------------------ | ------- |
| `PORT`                    | `8787`                                           | Listen port |
| `HOST`                    | `127.0.0.1`                                       | Bind address (use `127.0.0.1` behind the tunnel) |
| `NODE_ENV`                | `development`                                     | `production` makes `PULSE_JWT_SECRET` mandatory |
| `PULSE_JWT_SECRET`        | *(ephemeral in dev)*                              | HMAC secret for signing tokens. **Set this in prod** (≥16 chars) |
| `PULSE_TOKEN_TTL_SECONDS` | `2592000` (30d)                                   | Token/session lifetime |
| `PULSE_DB_PATH`           | `./data/pulse.sqlite`                             | SQLite file (`:memory:` for ephemeral) |
| `PULSE_CORS_ORIGINS`      | `https://pulse.0xbeckett.me,http://localhost:5173,…` | Comma-separated allowed origins |
| `PULSE_MAX_SCORE`         | `10000000`                                        | Scores above this are rejected as tampering |
| `PULSE_SCORE_RATE`        | `20`                                              | Max score submissions per user per minute |
| `PULSE_AUTH_RATE`         | `30`                                              | Max auth attempts per IP per minute |

---

## Concepts

- **Guest-first.** A brand-new player calls `POST /v1/auth/guest` with a
  device id and immediately gets a token and identity — no signup wall. Saves
  and scores attach to that identity.
- **Upgrade in place.** `POST /v1/auth/upgrade` converts a guest into a real
  account *keeping the same user id*, so cloud saves and leaderboard history
  carry over automatically.
- **Auth.** HS256 JWTs whose `jti` references a row in a `sessions` table. A
  token is only accepted while its session exists, so `POST /v1/auth/logout`
  performs real server-side revocation. Send the token as
  `Authorization: Bearer <token>`.
- **Passwords** are hashed with **argon2id** (`Bun.password`).
- **Persistence** is SQLite with an append-only migration runner
  (`src/db/migrations.ts`). The data layer sits behind a `Store` interface
  (`src/db/store.ts`) so it can be reimplemented on Postgres without touching
  routes.

---

## API surface

Base URL: `/` for health, `/v1/*` for everything else. All request/response
bodies are JSON. Authenticated endpoints require `Authorization: Bearer <token>`.

### Health

| Method | Path      | Auth | Description |
| ------ | --------- | ---- | ----------- |
| GET    | `/health` | no   | Liveness probe → `{ "status": "ok", ... }` |

### Auth

| Method | Path                | Auth | Description |
| ------ | ------------------- | ---- | ----------- |
| POST   | `/v1/auth/guest`    | no   | Get/refresh a device-scoped guest identity |
| POST   | `/v1/auth/signup`   | no   | Create a real account (email + password) |
| POST   | `/v1/auth/login`    | no   | Log in to a real account |
| POST   | `/v1/auth/logout`   | yes  | Revoke the current session token |
| POST   | `/v1/auth/upgrade`  | yes (guest) | Convert guest → account, keep the save |
| GET    | `/v1/auth/me`       | yes  | Current identity |

**`POST /v1/auth/guest`**
```jsonc
// request
{ "deviceId": "a-stable-device-id-8+chars" }
// response 200
{ "token": "…", "expiresAt": 1700000000000,
  "user": { "id": "uuid", "isGuest": true, "email": null,
            "displayName": "Pulse-3F9A", "createdAt": 1700000000000 } }
```
Repeat calls with the same `deviceId` return the same identity. If the device
was already upgraded to an account → `409 { "error": "device_upgraded" }`.

**`POST /v1/auth/signup`**
```jsonc
// request
{ "email": "you@example.com", "password": "≥8 chars", "displayName": "optional" }
// response 201 → { token, expiresAt, user }   (isGuest:false)
// 409 { "error": "email_taken" }
```

**`POST /v1/auth/login`**
```jsonc
// request  { "email": "you@example.com", "password": "…" }
// response 200 → { token, expiresAt, user }
// 401 { "error": "invalid_credentials" }
```

**`POST /v1/auth/logout`** → `200 { "ok": true }`. The token is dead afterward.

**`POST /v1/auth/upgrade`** (guest token required)
```jsonc
// request  { "email": "you@example.com", "password": "≥8 chars", "displayName": "optional" }
// response 200 → { token, expiresAt, user }   // same user.id as the guest; new token
// 409 { "error": "already_account" | "email_taken" }
```
The old guest token is revoked; use the returned token going forward.

### Cloud saves

| Method | Path        | Auth | Description |
| ------ | ----------- | ---- | ----------- |
| GET    | `/v1/save`  | yes  | Read the caller's save (empty defaults if never written) |
| PUT    | `/v1/save`  | yes  | Overwrite the caller's save |

**`PUT /v1/save`**
```jsonc
// request
{ "highScore": 4200, "currency": 75,
  "unlocks": ["neon", "hardmode"],        // array, ≤16KB serialized
  "settings": { "sfx": false, "haptics": true } }  // object, ≤16KB serialized
// response 200
{ "save": { "highScore": 4200, "currency": 75, "unlocks": [...],
            "settings": {...}, "updatedAt": 1700000000000 } }
```
`highScore` and `currency` must be non-negative integers. Saves are strictly
scoped to the authenticated identity — there is no way to read another user's
save.

### Scores

| Method | Path         | Auth | Description |
| ------ | ------------ | ---- | ----------- |
| POST   | `/v1/scores` | yes  | Submit a run's score |

**`POST /v1/scores`**
```jsonc
// request  { "score": 4200 }
// response 201
{ "accepted": true, "score": 4200,
  "best":  { "global": 4200, "daily": 4200 },
  "rank":  { "global": { "rank": 3, "score": 4200, "total": 128 },
             "daily":  { "rank": 1, "score": 4200, "total": 12 } } }
```
Server-side validation rejects blatant tampering:
- non-integer / negative → `400 invalid_score`
- above `PULSE_MAX_SCORE` → `422 score_out_of_range`
- more than `PULSE_SCORE_RATE` submissions/min → `429 rate_limited`

### Leaderboards

| Method | Path                          | Auth | Description |
| ------ | ----------------------------- | ---- | ----------- |
| GET    | `/v1/leaderboard/global`      | no   | Top N all-time (best score per player) |
| GET    | `/v1/leaderboard/daily`       | no   | Top N for a UTC day (defaults to today) |
| GET    | `/v1/leaderboard/global/me`   | yes  | Caller's global rank |
| GET    | `/v1/leaderboard/daily/me`    | yes  | Caller's rank on today's board |

Query params: `?limit=N` (1–100, default 20); daily also accepts
`?day=YYYY-MM-DD`.

```jsonc
// GET /v1/leaderboard/global?limit=3  → 200
{ "scope": "global", "limit": 3, "entries": [
  { "rank": 1, "userId": "uuid", "displayName": "Neon Ace", "score": 9001 },
  { "rank": 2, "userId": "uuid", "displayName": "Pulse-11B2", "score": 4200 } ] }

// GET /v1/leaderboard/daily/me  → 200
{ "scope": "daily", "day": "2026-07-01", "rank": 4, "score": 3300, "total": 57 }
// rank/score are null if the caller has no score on that board yet.
```

---

## Deployment

Bind to `127.0.0.1` and run under `systemd --user` so the process survives your
shell, then expose it via the Beckett Cloudflare tunnel. Example unit
(`~/.config/systemd/user/pulse-server.service`):

```ini
[Unit]
Description=Pulse backend
After=network.target

[Service]
WorkingDirectory=%h/Projects/pulse/server
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=PULSE_JWT_SECRET=change-me-to-a-long-random-secret
Environment=PULSE_DB_PATH=%h/Projects/pulse/server/data/pulse.sqlite
ExecStart=%h/.local/bin/bun run src/index.ts
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now pulse-server
beckett deploy pulse --port 8787   # creates the tunnel ingress + DNS
```

---

## Project layout

```
server/
  src/
    index.ts              # entry: open store, build app, listen
    app.ts                # Hono app factory (CORS, routes, error handling)
    config.ts             # env-driven config
    auth/
      jwt.ts              # HS256 issue/verify (jti-backed sessions)
      password.ts         # argon2id hashing
      middleware.ts       # requireAuth guard
    db/
      migrations.ts       # ordered, append-only migrations
      store.ts            # Store interface (swappable data layer)
      sqlite-store.ts     # bun:sqlite implementation
      migrate-cli.ts      # `bun run migrate`
    routes/               # auth, save, scores, leaderboard
    lib/                  # ids, time, validation, rate limiting, serializers
  test/api.test.ts        # end-to-end API tests
```
