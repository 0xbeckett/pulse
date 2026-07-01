# Pulse

A one-thumb neon endless arcade game for mobile web. **Hold to rise, release to
fall**, and weave your glowing avatar through an endless, procedurally-generated
neon gauntlet that keeps speeding up. Thread the gaps, hug the edges for
near-miss bonuses, and pump your multiplier before the run ends.

Play: **https://pulse.0xbeckett.me**

## Feel

- **One-thumb control** — tap/hold anywhere to thrust; that's the whole game.
- **Juice everywhere** — screen-shake on near-misses & crashes, particle
  bursts, a combo/multiplier that climbs as you survive and resets on a hit,
  synthesized WebAudio SFX (with a mute toggle), and `navigator.vibrate` haptics
  on hits and milestones.
- **Instant restart** — die → tap → playing again, no menus in the way.
- **Endless & escalating** — gaps drift via a smooth random walk, shrink and
  arrive faster over time.
- **Persistent** — high score and best combo saved to `localStorage`, and
  synced to the cloud when online (see **Accounts & leaderboards**).
- **Mobile-native** — portrait, safe-area insets respected, installable PWA that
  works fully offline as a static build.

## Accounts & leaderboards

Pulse talks to its own backend (`server/`, see `server/README.md`):

- **Guest-first.** On first load the game silently claims a device-scoped guest
  identity — no signup wall. Your high score, currency, unlocks and settings
  are pulled from the cloud on load and pushed back at the end of every run.
- **Optional accounts.** The ◐ chip opens a lightweight panel to create an
  account (guest → account *keeps your progress*) or log in on another device;
  logging out drops you back to guest play.
- **Leaderboards.** The 🏆 panel shows the global all-time and daily boards with
  your own rank highlighted.

Every backend call degrades gracefully: if the server is unreachable the game
stays fully playable from `localStorage` and syncs when it's back.

## Tech

Vanilla TypeScript + Canvas 2D, no game engine. Fixed-timestep physics and a
pooled particle system keep it at 60fps on a mid phone. Bundled to a single
minified JS file with `bun build`.

## Develop

```sh
bun install
bun run build          # -> dist/ (static, offline-capable)
bun run scripts/serve.ts   # serve dist/ on http://127.0.0.1:8787
node scripts/smoke.mjs     # headless play-through smoke test (needs Chromium)
```

Controls for desktop testing: **Space** or **↑** to thrust.

## Deploy

The live instance serves **both** the built game (`dist/`) and the `/v1` API
from the one backend process, so the whole app sits behind a single localhost
port and Cloudflare tunnel — same-origin, no CORS. The `systemd --user` unit
(`deploy/pulse.service`) runs `server/src/index.ts` with `PULSE_STATIC_DIR`
pointed at `dist/`; `beckett deploy pulse --port 8787` wires the tunnel + DNS.

```sh
bun run build                              # -> dist/
systemctl --user restart pulse.service     # backend serves dist/ + /v1
beckett deploy pulse --port 8787           # tunnel ingress + DNS
curl -fsS https://pulse.0xbeckett.me       # expect 200
```

`dist/` is also a self-contained static bundle if you only want the offline
game — `bun run scripts/serve.ts` serves it standalone (API disabled).
