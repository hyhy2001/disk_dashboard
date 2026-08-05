/**
 * Fixed-window in-memory rate limiter.
 *
 * The report endpoints are unauthenticated by design, so if the server is ever
 * reachable on a network (DASHBOARD_HOST=0.0.0.0), a loop can hammer them at
 * full speed. A raw loop is exactly the attack this stops: a per-IP cap on
 * requests per wall-clock window. Fixed-window is a simple per-key counter that
 * is trivially testable and plenty for the job. The map is pruned
 * opportunistically so it cannot grow without bound.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>()

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /** Consume one slot for `key`. Returns true when within the cap. */
  allow(key: string): boolean {
    const now = Date.now()
    const hit = this.windows.get(key)
    if (!hit || now - hit.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 })
      if (this.windows.size > 10_000) this.prune(now)
      return true
    }
    hit.count += 1
    return hit.count <= this.max
  }

  private prune(now: number): void {
    for (const [k, v] of this.windows) {
      if (now - v.start >= this.windowMs) this.windows.delete(k)
    }
  }
}
