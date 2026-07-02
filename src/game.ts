/**
 * Pulse — core game. A one-thumb neon gauntlet: hold to thrust up, release to
 * fall, weave through the gaps in an endless procedurally-generated wall of
 * neon. Speeds up over time. Combo/multiplier builds as you thread gates and
 * near-misses; a hit ends the run and everything resets. Instant restart.
 */
import { Audio } from "./audio";
import { Particles } from "./particles";
import { Storage } from "./storage";

type State = "menu" | "playing" | "dead";

interface Gate {
  x: number;
  gapY: number;
  gapH: number;
  scored: boolean;
  cleared: boolean; // blasted open by a Pulse — no longer lethal
  clearT: number; // 0..1 open animation progress
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
}

const CYAN: [number, number, number] = [125, 249, 255];
const MAGENTA: [number, number, number] = [255, 47, 185];
const GOLD: [number, number, number] = [255, 214, 92];
const WHITE: [number, number, number] = [235, 246, 255];

// Combo needed to bump the multiplier by one whole step.
const COMBO_PER_MULT = 6;
const MAX_MULT = 12;

// --- The Pulse (signature mechanic) ---
// Seconds of pure survival to fill the meter from empty. Near-misses fill it
// much faster (see PULSE_NEAR_GAIN), so aggressive play is rewarded with a
// quicker recharge — risk feeds the panic button.
const PULSE_CHARGE = 13;
const PULSE_NEAR_GAIN = 0.14;
const PULSE_PASS_GAIN = 0.02;

function rgb(c: [number, number, number], a = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: Audio;
  private particles = new Particles(360);
  readonly storage: Storage;

  /** Fired when a run ends, with the final score, best combo, and whether it
   *  set a new local record. The host wires this to cloud save + score submit. */
  onRunEnd: ((score: number, combo: number, isRecord: boolean) => void) | null = null;
  /** Fired whenever the play state changes (menu / playing / dead). */
  onStateChange: ((state: State) => void) | null = null;

  // Logical (CSS px) dimensions and device pixel ratio.
  private W = 0;
  private H = 0;
  private insetTop = 0;

  private state: State = "menu";

  // Player.
  private px = 0;
  private py = 0;
  private vy = 0;
  private pr = 14;
  private thrusting = false;

  // The Pulse: metered radial shockwave.
  private pulseEnergy = 0; // 0..1
  private pulseReadyPinged = false; // chime once when it fills
  private invuln = 0; // brief post-Pulse safe window (seconds)
  private shockwaves: Shockwave[] = [];
  // Double-tap detection (deliberate tap-tap, distinct from hold-to-thrust).
  private pressAt = 0;
  private lastReleaseAt = -1;
  private lastTapWasShort = false;

  // World.
  private gates: Gate[] = [];
  private lastGapY = 0;
  private speed = 1; // grows over time
  private distance = 0;
  private scrollSpeed = 0;
  private gateSpacing = 0;

  // Scoring.
  private score = 0;
  private combo = 0;
  private mult = 1;
  private newRecord = false;

  // Juice.
  private shakeTime = 0;
  private shakeMag = 0;
  private flash = 0;
  private flashColor: [number, number, number] = CYAN;
  private hue = 0;
  private deadAt = 0;
  private now = 0;
  private trailTick = 0;
  private nextMilestone = 500;
  private popups: { x: number; y: number; text: string; life: number; c: [number, number, number] }[] = [];

  // Fixed-timestep accumulator.
  private acc = 0;
  private last = 0;
  private readonly step = 1 / 120; // physics tick

  private starLayers: { x: number; y: number; z: number }[] = [];

  constructor(canvas: HTMLCanvasElement, audio: Audio, storage?: Storage) {
    this.canvas = canvas;
    this.audio = audio;
    this.storage = storage ?? new Storage();
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.resize();
    this.seedStars();
  }

  private seedStars() {
    this.starLayers = [];
    for (let i = 0; i < 60; i++) {
      this.starLayers.push({
        x: Math.random(),
        y: Math.random(),
        z: 0.3 + Math.random() * 0.7,
      });
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.W = w;
    this.H = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cs = getComputedStyle(document.documentElement);
    this.insetTop = parseFloat(cs.getPropertyValue("--safe-top")) || 0;

    this.pr = Math.max(10, Math.min(this.W, this.H) * 0.028);
    this.px = this.W * 0.3;
    if (this.state !== "playing") this.py = this.H * 0.5;
  }

  // ---- input -----------------------------------------------------------

  press() {
    this.audio.unlock();
    if (this.state === "playing") {
      // A quick tap-tap (short first tap, small gap) fires the Pulse when the
      // meter is full. The tightness of the gesture keeps it from triggering
      // on the normal hold/release cadence of thrusting.
      const gap = this.now - this.lastReleaseAt;
      if (this.pulseEnergy >= 1 && this.lastTapWasShort && gap >= 0 && gap < 0.22) {
        this.firePulse();
        this.lastTapWasShort = false; // consume the chain
      }
      this.pressAt = this.now;
      this.thrusting = true;
      return;
    }
    // Menu or dead: (re)start. Small lockout after death avoids the fatal
    // tap instantly restarting before the player registers the crash.
    if (this.state === "dead" && this.now - this.deadAt < 0.18) return;
    this.start();
  }

  release() {
    if (this.state === "playing") {
      const dur = this.now - this.pressAt;
      this.lastTapWasShort = dur >= 0 && dur < 0.18;
      this.lastReleaseAt = this.now;
    }
    this.thrusting = false;
  }

  // ---- lifecycle -------------------------------------------------------

  private start() {
    this.state = "playing";
    this.py = this.H * 0.5;
    this.vy = 0;
    this.thrusting = true; // first tap also gives lift
    this.gates = [];
    this.lastGapY = this.H * 0.5;
    this.speed = 1;
    this.distance = 0;
    this.score = 0;
    this.combo = 0;
    this.mult = 1;
    this.newRecord = false;
    this.flash = 0;
    this.shakeTime = 0;
    this.nextMilestone = 500;
    this.popups.length = 0;
    this.pulseEnergy = 0;
    this.pulseReadyPinged = false;
    this.invuln = 0;
    this.shockwaves.length = 0;
    this.lastReleaseAt = -1;
    this.lastTapWasShort = false;
    this.pressAt = this.now;
    this.particles.clear();
    this.gateSpacing = this.W * 0.62;
    // Seed a few gates ahead so the first one isn't instantly in your face.
    let x = this.W + this.W * 0.35;
    for (let i = 0; i < 4; i++) {
      this.gates.push(this.makeGate(x));
      x += this.gateSpacing;
    }
    this.audio.start();
    this.storage.countPlay();
    this.onStateChange?.(this.state);
  }

  private die() {
    if (this.state !== "playing") return;
    this.state = "dead";
    this.deadAt = this.now;
    this.thrusting = false;
    const finalScore = Math.floor(this.score);
    this.newRecord = this.storage.submit(this.score, this.combo);
    this.onRunEnd?.(finalScore, this.combo, this.newRecord);
    this.onStateChange?.(this.state);
    this.audio.hit();
    this.buzz([40, 60, 40]);
    this.addShake(0.5, 22);
    this.flashColor = MAGENTA;
    this.flash = 1;
    this.particles.burst(this.px, this.py, 60, MAGENTA, {
      speed: 9,
      size: 4,
      life: 0.9,
    });
    this.particles.burst(this.px, this.py, 30, WHITE, { speed: 6, size: 3, life: 0.6 });
  }

  /** Grow the Pulse meter and chime the moment it tops off. */
  private addEnergy(amount: number) {
    if (this.pulseEnergy >= 1) return;
    this.pulseEnergy = Math.min(1, this.pulseEnergy + amount);
    if (this.pulseEnergy >= 1 && !this.pulseReadyPinged) {
      this.pulseReadyPinged = true;
      this.audio.pulseReady();
      this.buzz(18);
      this.pushPopup(this.px, this.py - this.pr * 2.6, "PULSE READY", CYAN);
    }
  }

  /** Discharge the meter: a radial shockwave that blasts nearby gates open,
   *  grants a brief safe window, and pays out combo — the signature move. */
  private firePulse() {
    this.pulseEnergy = 0;
    this.pulseReadyPinged = false;
    this.invuln = 0.55;
    const r = Math.max(this.W, this.H) * 0.62;
    this.shockwaves.push({ x: this.px, y: this.py, r: this.pr, maxR: r, life: 0.55, maxLife: 0.55 });

    // Blast open every not-yet-cleared gate within the shockwave radius.
    const gw = this.W * 0.06;
    for (const g of this.gates) {
      if (g.cleared) continue;
      const dx = g.x + gw / 2 - this.px;
      if (dx > -gw && dx < r) {
        g.cleared = true;
        g.clearT = 0;
        this.particles.burst(g.x + gw / 2, g.gapY, 8, CYAN, { speed: 6, size: 3, life: 0.6 });
      }
    }

    // Juice — this is the money moment, so lean into it.
    this.audio.pulse();
    this.buzz([30, 20, 60]);
    this.addShake(0.42, 26);
    this.flashColor = CYAN;
    this.flash = 1;
    this.particles.burst(this.px, this.py, 48, CYAN, { speed: 11, size: 4, life: 0.85 });
    this.particles.burst(this.px, this.py, 22, WHITE, { speed: 7, size: 3, life: 0.5 });

    // Reward: a combo bump so a well-placed Pulse feeds the multiplier loop.
    this.combo += 3;
    this.mult = Math.min(MAX_MULT, 1 + Math.floor(this.combo / COMBO_PER_MULT));
    this.score += 60 * this.mult;
    this.pushPopup(this.px, this.py - this.pr * 2.4, "PULSE!", CYAN);
  }

  private buzz(pattern: number | number[]) {
    if (this.audio.muted) return; // treat mute as "quiet mode"
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  // ---- world gen -------------------------------------------------------

  private makeGate(x: number): Gate {
    // Gap shrinks as speed rises; capped so it stays fair.
    const shrink = Math.min(0.14, (this.speed - 1) * 0.03);
    const gapH = this.H * (0.36 - shrink);
    const margin = gapH * 0.5 + this.H * 0.06;
    // Smooth-ish random walk keeps consecutive gaps reachable.
    const drift = (Math.random() * 2 - 1) * this.H * 0.26;
    let gapY = this.lastGapY + drift;
    gapY = Math.max(margin, Math.min(this.H - margin, gapY));
    this.lastGapY = gapY;
    return { x, gapY, gapH, scored: false, cleared: false, clearT: 0 };
  }

  // ---- update ----------------------------------------------------------

  private update(dt: number) {
    this.now += dt;
    this.hue = (this.hue + dt * 30) % 360;

    // Decay juice timers regardless of state.
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].life -= dt;
      this.popups[i].y -= dt * 40;
      if (this.popups[i].life <= 0) this.popups.splice(i, 1);
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      const t = 1 - s.life / s.maxLife;
      s.r = s.maxR * (1 - Math.pow(1 - t, 3)); // ease-out expansion
      if (s.life <= 0) this.shockwaves.splice(i, 1);
    }
    this.particles.update(dt);

    if (this.state !== "playing") {
      // Gentle idle bob on the menu/death screens.
      this.py = this.H * 0.5 + Math.sin(this.now * 1.8) * this.H * 0.02;
      return;
    }

    // The Pulse: passive charge, safe-window decay, cleared-gate open anim.
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    this.addEnergy(dt / PULSE_CHARGE);

    // Difficulty ramp.
    this.speed = Math.min(3.4, this.speed + dt * 0.055);
    this.scrollSpeed = this.W * 0.6 * this.speed;
    this.distance += this.scrollSpeed * dt;

    // Physics.
    const gravity = this.H * 2.6;
    const thrust = this.H * 5.4;
    this.vy += gravity * dt;
    if (this.thrusting) this.vy -= thrust * dt;
    const maxVy = this.H * 0.95;
    this.vy = Math.max(-maxVy, Math.min(maxVy, this.vy));
    this.py += this.vy * dt;

    // Clamp to bounds (ceiling/floor are safe — only gates are lethal).
    if (this.py < this.pr) {
      this.py = this.pr;
      this.vy = Math.max(this.vy, 0);
    } else if (this.py > this.H - this.pr) {
      this.py = this.H - this.pr;
      this.vy = Math.min(this.vy, 0);
    }

    // Thruster trail.
    this.trailTick += dt;
    if (this.thrusting && this.trailTick > 0.016) {
      this.trailTick = 0;
      this.particles.trail(
        this.px - this.pr * 0.6,
        this.py + this.pr * 0.5,
        -this.scrollSpeed * 0.004 - Math.random() * 1.5,
        1 + Math.random() * 2,
        MAGENTA
      );
    }

    // Passive score from distance survived, scaled by multiplier.
    this.score += this.scrollSpeed * dt * 0.06 * this.mult;

    // Move gates and handle scoring/collision.
    const gw = this.W * 0.06;
    for (const g of this.gates) {
      g.x -= this.scrollSpeed * dt;
      if (g.cleared && g.clearT < 1) g.clearT = Math.min(1, g.clearT + dt * 3.5);
      if (!g.scored && g.x + gw < this.px) {
        g.scored = true;
        this.onGatePassed(g);
      }
      // Cleared gates and the post-Pulse window are non-lethal.
      if (!g.cleared && this.invuln <= 0 && this.collides(g, gw)) {
        this.die();
        return;
      }
    }
    // Recycle off-screen gates and spawn ahead to keep the field full.
    while (this.gates.length && this.gates[0].x + gw < -10) this.gates.shift();
    const lastX = this.gates.length ? this.gates[this.gates.length - 1].x : this.W;
    if (lastX < this.W - this.gateSpacing) {
      this.gates.push(this.makeGate(lastX + this.gateSpacing));
    }

    // Milestone check.
    if (this.score >= this.nextMilestone) {
      this.onMilestone();
    }
  }

  private collides(g: Gate, gw: number): boolean {
    // Broad phase: only gates overlapping the player's x band matter.
    if (g.x > this.px + this.pr || g.x + gw < this.px - this.pr) return false;
    const gapTop = g.gapY - g.gapH / 2;
    const gapBot = g.gapY + g.gapH / 2;
    // Circle vs the two wall rects (top: 0..gapTop, bottom: gapBot..H).
    return (
      this.circleRect(g.x, 0, gw, gapTop) ||
      this.circleRect(g.x, gapBot, gw, this.H - gapBot)
    );
  }

  private circleRect(rx: number, ry: number, rw: number, rh: number): boolean {
    const cx = Math.max(rx, Math.min(this.px, rx + rw));
    const cy = Math.max(ry, Math.min(this.py, ry + rh));
    const dx = this.px - cx;
    const dy = this.py - cy;
    return dx * dx + dy * dy < this.pr * this.pr;
  }

  private onGatePassed(g: Gate) {
    // A gate blasted open by a Pulse isn't a skill pass — small credit only.
    if (g.cleared) {
      this.combo += 1;
      this.mult = Math.min(MAX_MULT, 1 + Math.floor(this.combo / COMBO_PER_MULT));
      this.score += 4 * this.mult;
      return;
    }
    const gapTop = g.gapY - g.gapH / 2;
    const gapBot = g.gapY + g.gapH / 2;
    const clearance = Math.min(this.py - this.pr - gapTop, gapBot - (this.py + this.pr));
    const near = clearance < this.pr * 0.9;

    this.addEnergy(near ? PULSE_NEAR_GAIN : PULSE_PASS_GAIN);
    this.combo += near ? 2 : 1;
    this.mult = Math.min(MAX_MULT, 1 + Math.floor(this.combo / COMBO_PER_MULT));
    const gain = (near ? 25 : 10) * this.mult;
    this.score += gain;

    if (near) {
      this.audio.nearMiss();
      this.addShake(0.18, 8);
      this.buzz(12);
      this.particles.burst(this.px, this.py, 14, GOLD, { speed: 5, size: 3, life: 0.5 });
      this.pushPopup(this.px, this.py - this.pr * 2, "NEAR!", GOLD);
    } else {
      this.audio.pass(this.combo);
      this.particles.burst(this.px + this.pr, this.py, 6, CYAN, { speed: 3, size: 2, life: 0.4 });
    }
  }

  private onMilestone() {
    this.nextMilestone += 500;
    this.audio.milestone();
    this.buzz([25, 40, 25]);
    this.addShake(0.22, 10);
    this.flashColor = CYAN;
    this.flash = 0.8;
    this.particles.burst(this.px, this.py, 24, CYAN, { speed: 7, size: 3, life: 0.7 });
    this.pushPopup(this.W * 0.5, this.H * 0.32, `${Math.floor(this.score / 500) * 500}`, CYAN);
  }

  private pushPopup(x: number, y: number, text: string, c: [number, number, number]) {
    this.popups.push({ x, y, text, life: 0.9, c });
  }

  private addShake(time: number, mag: number) {
    if (time > this.shakeTime) this.shakeTime = time;
    this.shakeMag = Math.max(this.shakeMag * (this.shakeTime > 0 ? 1 : 0), mag);
  }

  // ---- render ----------------------------------------------------------

  private render() {
    const ctx = this.ctx;
    ctx.save();

    // Screen shake.
    if (this.shakeTime > 0) {
      const m = this.shakeMag * (this.shakeTime / 0.5);
      ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
    }

    this.drawBackground(ctx);
    if (this.state === "playing" || this.state === "dead") this.drawGates(ctx);
    this.drawShockwaves(ctx);
    this.particles.render(ctx);
    if (this.state !== "dead") this.drawPlayer(ctx);
    this.drawPopups(ctx);

    ctx.restore(); // undo shake before UI so HUD stays steady

    this.drawHud(ctx);

    // Full-screen flash.
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgb(this.flashColor, this.flash * 0.35);
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }

    if (this.state === "menu") this.drawMenu(ctx);
    else if (this.state === "dead") this.drawGameOver(ctx);
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    // Deep vertical gradient.
    const grad = ctx.createLinearGradient(0, 0, 0, this.H);
    grad.addColorStop(0, "#0a0420");
    grad.addColorStop(0.5, "#05010f");
    grad.addColorStop(1, "#0c0326");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);

    // Parallax stars streak with speed.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const streak = this.state === "playing" ? this.scrollSpeed * 0.02 : 2;
    for (const s of this.starLayers) {
      const x = s.x * this.W;
      const y = s.y * this.H;
      const a = 0.25 * s.z;
      ctx.strokeStyle = rgb(CYAN, a);
      ctx.lineWidth = s.z * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - streak * s.z, y);
      ctx.stroke();
      if (this.state === "playing") {
        s.x -= (this.scrollSpeed * s.z * 0.00016) / 1;
        if (s.x < 0) {
          s.x = 1;
          s.y = Math.random();
        }
      }
    }
    ctx.restore();
  }

  private drawGates(ctx: CanvasRenderingContext2D) {
    const gw = this.W * 0.06;
    // Combo-driven color shift: cooler at low combo, hotter as it climbs.
    const t = Math.min(1, this.combo / 40);
    const col: [number, number, number] = [
      Math.round(CYAN[0] + (MAGENTA[0] - CYAN[0]) * t),
      Math.round(CYAN[1] + (MAGENTA[1] - CYAN[1]) * t),
      Math.round(CYAN[2] + (MAGENTA[2] - CYAN[2]) * t),
    ];
    ctx.save();
    for (const g of this.gates) {
      if (g.x > this.W || g.x + gw < 0) continue;
      const gapTop = g.gapY - g.gapH / 2;
      const gapBot = g.gapY + g.gapH / 2;
      if (g.cleared) {
        // Blasted open: walls recede off-screen and fade to nothing.
        const e = g.clearT;
        const a = (1 - e) * 0.7;
        if (a <= 0.02) continue;
        ctx.save();
        ctx.globalAlpha = a;
        this.neonRect(ctx, g.x, -gapTop * e, gw, gapTop, CYAN);
        this.neonRect(ctx, g.x, gapBot + (this.H - gapBot) * e, gw, this.H - gapBot, CYAN);
        ctx.restore();
        continue;
      }
      this.neonRect(ctx, g.x, 0, gw, gapTop, col);
      this.neonRect(ctx, g.x, gapBot, gw, this.H - gapBot, col);
      // Glowing gap edges to read the opening clearly.
      ctx.strokeStyle = rgb(WHITE, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(g.x, gapTop);
      ctx.lineTo(g.x + gw, gapTop);
      ctx.moveTo(g.x, gapBot);
      ctx.lineTo(g.x + gw, gapBot);
      ctx.stroke();
    }
    ctx.restore();
  }

  private neonRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    col: [number, number, number]
  ) {
    if (h <= 0) return;
    ctx.fillStyle = rgb(col, 0.16);
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.shadowColor = rgb(col, 0.9);
    ctx.shadowBlur = 16;
    ctx.strokeStyle = rgb(col, 0.95);
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.restore();
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D) {
    if (!this.shockwaves.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.shockwaves) {
      const a = Math.max(0, s.life / s.maxLife);
      ctx.strokeStyle = rgb(CYAN, a * 0.9);
      ctx.lineWidth = 6 * a + 1;
      ctx.shadowColor = rgb(CYAN, a);
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
      // Inner trailing ring for a bit of depth.
      ctx.strokeStyle = rgb(WHITE, a * 0.5);
      ctx.lineWidth = 2 * a + 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    // Charge ring: an arc around the core that fills as the Pulse builds.
    if (this.state === "playing") {
      const ready = this.pulseEnergy >= 1;
      const rr = this.pr * 1.7 + (ready ? Math.sin(this.now * 12) * 1.5 + 1.5 : 0);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // Track.
      ctx.strokeStyle = rgb(WHITE, 0.12);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.px, this.py, rr, 0, Math.PI * 2);
      ctx.stroke();
      // Fill arc from the top, clockwise.
      const col = ready ? GOLD : CYAN;
      ctx.strokeStyle = rgb(col, ready ? 0.95 : 0.85);
      ctx.lineWidth = 3.5;
      ctx.shadowColor = rgb(col, 0.9);
      ctx.shadowBlur = ready ? 16 : 8;
      ctx.beginPath();
      const a0 = -Math.PI / 2;
      ctx.arc(this.px, this.py, rr, a0, a0 + Math.PI * 2 * this.pulseEnergy);
      ctx.stroke();
      ctx.restore();
    }
    // A halo during the brief post-Pulse safe window.
    if (this.invuln > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgb(CYAN, Math.min(1, this.invuln / 0.55) * 0.7);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.px, this.py, this.pr * 2.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const col = this.thrusting ? CYAN : WHITE;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // Outer glow.
    const g = ctx.createRadialGradient(this.px, this.py, 0, this.px, this.py, this.pr * 3);
    g.addColorStop(0, rgb(col, 0.8));
    g.addColorStop(0.4, rgb(MAGENTA, 0.35));
    g.addColorStop(1, rgb(MAGENTA, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.px, this.py, this.pr * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Core.
    ctx.fillStyle = rgb(WHITE, 1);
    ctx.beginPath();
    ctx.arc(this.px, this.py, this.pr * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(CYAN, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(this.px, this.py, this.pr, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawPopups(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.textAlign = "center";
    for (const p of this.popups) {
      const a = Math.min(1, p.life / 0.9);
      ctx.globalAlpha = a;
      ctx.fillStyle = rgb(p.c, 1);
      ctx.font = `700 ${Math.round(this.W * 0.05)}px system-ui, sans-serif`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    const top = this.insetTop + 14;
    ctx.save();
    ctx.textBaseline = "top";

    // Score, top-left.
    ctx.textAlign = "left";
    ctx.fillStyle = rgb(WHITE, 0.96);
    ctx.font = `800 ${Math.round(this.W * 0.09)}px system-ui, sans-serif`;
    ctx.fillText(String(Math.floor(this.score)), this.insetTop ? 18 : 16, top);

    // Best, small under score.
    ctx.fillStyle = rgb(CYAN, 0.65);
    ctx.font = `600 ${Math.round(this.W * 0.035)}px system-ui, sans-serif`;
    ctx.fillText(`BEST ${this.storage.highScore}`, 18, top + this.W * 0.1);

    // Multiplier + combo, top-center, only while it matters.
    if (this.state === "playing" && this.combo > 0) {
      ctx.textAlign = "center";
      const pulse = 1 + Math.sin(this.now * 10) * 0.04 * Math.min(1, this.combo / 10);
      const size = Math.round(this.W * 0.075 * pulse);
      ctx.fillStyle = rgb(GOLD, 0.95);
      ctx.font = `900 ${size}px system-ui, sans-serif`;
      ctx.fillText(`x${this.mult}`, this.W * 0.5, top);
      ctx.fillStyle = rgb(WHITE, 0.7);
      ctx.font = `600 ${Math.round(this.W * 0.032)}px system-ui, sans-serif`;
      ctx.fillText(`${this.combo} COMBO`, this.W * 0.5, top + this.W * 0.085);
    }
    ctx.restore();
  }

  private drawMenu(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.textAlign = "center";
    const cx = this.W * 0.5;

    ctx.fillStyle = rgb(WHITE, 1);
    ctx.shadowColor = rgb(CYAN, 0.9);
    ctx.shadowBlur = 24;
    ctx.font = `900 ${Math.round(this.W * 0.2)}px system-ui, sans-serif`;
    ctx.fillText("PULSE", cx, this.H * 0.3);
    ctx.shadowBlur = 0;

    ctx.fillStyle = rgb(CYAN, 0.85);
    ctx.font = `600 ${Math.round(this.W * 0.045)}px system-ui, sans-serif`;
    ctx.fillText("HOLD to rise · RELEASE to fall", cx, this.H * 0.42);

    ctx.fillStyle = rgb(GOLD, 0.85);
    ctx.font = `700 ${Math.round(this.W * 0.042)}px system-ui, sans-serif`;
    ctx.fillText("DOUBLE-TAP when charged → PULSE blast", cx, this.H * 0.485);

    const pulse = 0.6 + Math.sin(this.now * 3) * 0.4;
    ctx.fillStyle = rgb(WHITE, pulse);
    ctx.font = `800 ${Math.round(this.W * 0.06)}px system-ui, sans-serif`;
    ctx.fillText("TAP TO PLAY", cx, this.H * 0.62);

    if (this.storage.highScore > 0) {
      ctx.fillStyle = rgb(GOLD, 0.8);
      ctx.font = `600 ${Math.round(this.W * 0.04)}px system-ui, sans-serif`;
      ctx.fillText(
        `BEST ${this.storage.highScore}  ·  COMBO ${this.storage.bestCombo}`,
        cx,
        this.H * 0.72
      );
    }
    ctx.restore();
  }

  private drawGameOver(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.textAlign = "center";
    const cx = this.W * 0.5;

    ctx.fillStyle = rgb(MAGENTA, 0.12);
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.fillStyle = rgb(WHITE, 1);
    ctx.font = `900 ${Math.round(this.W * 0.12)}px system-ui, sans-serif`;
    ctx.fillText(this.newRecord ? "NEW BEST!" : "WASTED", cx, this.H * 0.3);

    ctx.fillStyle = rgb(CYAN, 0.95);
    ctx.font = `800 ${Math.round(this.W * 0.16)}px system-ui, sans-serif`;
    ctx.fillText(String(Math.floor(this.score)), cx, this.H * 0.4);

    ctx.fillStyle = rgb(GOLD, 0.85);
    ctx.font = `600 ${Math.round(this.W * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(`COMBO x${this.combo}  ·  BEST ${this.storage.highScore}`, cx, this.H * 0.52);

    const ready = this.now - this.deadAt >= 0.18;
    const pulse = 0.5 + Math.sin(this.now * 4) * 0.5;
    ctx.fillStyle = rgb(WHITE, ready ? 0.5 + pulse * 0.5 : 0.25);
    ctx.font = `800 ${Math.round(this.W * 0.06)}px system-ui, sans-serif`;
    ctx.fillText("TAP TO RETRY", cx, this.H * 0.66);
    ctx.restore();
  }

  // ---- loop ------------------------------------------------------------

  start_loop() {
    this.last = performance.now();
    const frame = (t: number) => {
      let dt = (t - this.last) / 1000;
      this.last = t;
      // Guard against tab-switch spikes.
      if (dt > 0.1) dt = 0.1;
      this.acc += dt;
      // Fixed-timestep physics for deterministic, jitter-free motion.
      let steps = 0;
      while (this.acc >= this.step && steps < 8) {
        this.update(this.step);
        this.acc -= this.step;
        steps++;
      }
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
