/**
 * Pooled particle system. Pre-allocates a fixed array and reuses slots so the
 * hot loop never allocates — key to holding 60fps on a mid phone.
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  gravity: number;
  active: boolean;
}

export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor(max = 320) {
    for (let i = 0; i < max; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 1,
        r: 255, g: 255, b: 255,
        drag: 0.9, gravity: 0, active: false,
      });
    }
  }

  private next(): Particle {
    // Round-robin the pool; oldest slot gets recycled if we run dry.
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.cursor + i) % this.pool.length;
      if (!this.pool[idx].active) {
        this.cursor = (idx + 1) % this.pool.length;
        return this.pool[idx];
      }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return p;
  }

  /** Emit a radial burst of `count` particles. */
  burst(
    x: number,
    y: number,
    count: number,
    color: [number, number, number],
    opts: { speed?: number; size?: number; life?: number; gravity?: number } = {}
  ) {
    const speed = opts.speed ?? 4;
    const size = opts.size ?? 3;
    const life = opts.life ?? 0.6;
    const gravity = opts.gravity ?? 0;
    for (let i = 0; i < count; i++) {
      const p = this.next();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = life * (0.6 + Math.random() * 0.4);
      p.life = p.maxLife;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.r = color[0];
      p.g = color[1];
      p.b = color[2];
      p.drag = 0.9;
      p.gravity = gravity;
      p.active = true;
    }
  }

  /** Emit a directional trail speck. */
  trail(x: number, y: number, vx: number, vy: number, color: [number, number, number]) {
    const p = this.next();
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.maxLife = 0.4;
    p.life = p.maxLife;
    p.size = 2 + Math.random() * 2;
    p.r = color[0];
    p.g = color[1];
    p.b = color[2];
    p.drag = 0.86;
    p.gravity = 0;
    p.active = true;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pool) {
      if (!p.active) continue;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      const s = p.size * a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.pool) p.active = false;
  }
}
