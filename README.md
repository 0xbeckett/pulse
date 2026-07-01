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
- **Persistent** — high score and best combo saved to `localStorage`.
- **Mobile-native** — portrait, safe-area insets respected, installable PWA that
  works fully offline as a static build.

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

`dist/` is a plain static bundle — host it anywhere. The live instance runs
behind a `systemd --user` unit (`deploy/pulse.service`) serving `dist/` on
localhost, exposed via a Cloudflare tunnel.
