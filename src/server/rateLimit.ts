// Fixed-window in-memory rate limiter. Enough for one Node process; it resets
// on restart, and is not a substitute for a gateway limit in a real deployment.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly clock: () => number = Date.now) {}

  // Returns 0 when allowed, otherwise seconds until the window resets.
  take(key: string): number {
    const now = this.clock();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
      return 0;
    }
    if (entry.count >= this.max) return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    entry.count += 1;
    return 0;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
