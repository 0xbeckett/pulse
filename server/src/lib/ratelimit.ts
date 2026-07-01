/**
 * Tiny in-memory sliding-window rate limiter. Good enough for a single-process
 * service; swap for Redis if this ever scales horizontally. Keyed by an
 * arbitrary string (IP, user id, etc.).
 */
interface Bucket {
  hits: number[];
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the request is allowed and records the hit. */
  take(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    let b = this.buckets.get(key);
    if (!b) {
      b = { hits: [] };
      this.buckets.set(key, b);
    }
    // Drop expired hits.
    b.hits = b.hits.filter((t) => t > cutoff);
    if (b.hits.length >= this.limit) return false;
    b.hits.push(now);
    return true;
  }

  /** Periodic cleanup so idle keys don't leak memory forever. */
  sweep(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, b] of this.buckets) {
      b.hits = b.hits.filter((t) => t > cutoff);
      if (b.hits.length === 0) this.buckets.delete(key);
    }
  }
}
