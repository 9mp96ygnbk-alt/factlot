/**
 * Fixed-window rate limiter, in memory, one window per key name.
 *
 * Windows are aligned to the clock (the minute starting at :00), so every instance behind a
 * load balancer agrees on window boundaries even though each keeps its own counts. With N
 * instances a key can therefore make up to N × limit requests per minute; put the limiter in
 * front of the fleet (or run one instance) when the limit must be exact.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** The limit applied; 0 when unlimited. */
  limit: number;
  /** Requests left in this window (Infinity when unlimited). */
  remaining: number;
  /** Whole seconds until the window resets (at least 1). */
  retryAfterSeconds: number;
}

export class RateLimiter {
  readonly #windowMs: number;
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(windowMs = 60_000) {
    this.#windowMs = windowMs;
  }

  /** Count one request for `name` against `limit` at time `now` (ms since epoch). */
  check(name: string, limit: number, now: number): RateLimitDecision {
    if (!(limit > 0))
      return {
        allowed: true,
        limit: 0,
        remaining: Infinity,
        retryAfterSeconds: 0,
      };
    const start = Math.floor(now / this.#windowMs) * this.#windowMs;
    let window = this.#windows.get(name);
    if (!window || window.start !== start) {
      window = { start, count: 0 };
      this.#windows.set(name, window);
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((start + this.#windowMs - now) / 1000),
    );
    if (window.count >= limit)
      return { allowed: false, limit, remaining: 0, retryAfterSeconds };
    window.count += 1;
    return {
      allowed: true,
      limit,
      remaining: limit - window.count,
      retryAfterSeconds,
    };
  }
}
