/**
 * Exact fixed-window rate limiting: one Durable Object per caller (client address or key
 * hash), holding a counter for the current minute in memory. If the object is evicted the window
 * restarts, which only ever errs in the caller's favour.
 */
import type { RateLimit } from "./types.ts";

export interface DurableObjectStubLike {
  fetch(input: string): Promise<Response>;
}
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export class WindowCounter {
  private windowStart = 0;
  private count = 0;

  /** Count one request at `now`; true when it is within `limit` for its `periodMs` window. */
  hit(limit: number, periodMs: number, now: number): boolean {
    if (now - this.windowStart >= periodMs) {
      this.windowStart = now - (now % periodMs);
      this.count = 0;
    }
    this.count++;
    return this.count <= limit;
  }
}

/** The Durable Object class (bound as LIMITER). */
export class RateLimiterObject {
  private readonly counter = new WindowCounter();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "60");
    const ok = this.counter.hit(limit, 60_000, Date.now());
    return new Response(ok ? "1" : "0");
  }
}

/** A RateLimit backed by the LIMITER namespace; `prefix` keeps tiers apart. */
export function objectLimiter(
  ns: DurableObjectNamespaceLike,
  prefix: string,
  limit: number,
): RateLimit {
  return {
    async limit({ key }) {
      const stub = ns.get(ns.idFromName(`${prefix}:${key}`));
      const res = await stub.fetch(`https://limiter/?limit=${limit}`);
      return { success: (await res.text()) === "1" };
    },
  };
}
