import assert from "node:assert/strict";
import test from "node:test";

import { RateLimiter } from "./ratelimit.ts";

const T0 = Date.UTC(2026, 10, 2, 14, 0, 0); // window start

test("fixed window: allows `limit` requests then denies with Retry-After", () => {
  const limiter = new RateLimiter();
  const a = limiter.check("tenant-a", 2, T0 + 1_000);
  assert.deepEqual(a, {
    allowed: true,
    limit: 2,
    remaining: 1,
    retryAfterSeconds: 59,
  });
  assert.equal(limiter.check("tenant-a", 2, T0 + 2_000).remaining, 0);
  const denied = limiter.check("tenant-a", 2, T0 + 30_500);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 30);
  // Still denied right before the window ends, with Retry-After never below 1.
  assert.equal(limiter.check("tenant-a", 2, T0 + 59_900).retryAfterSeconds, 1);
  // A new window resets the count.
  assert.equal(limiter.check("tenant-a", 2, T0 + 60_000).allowed, true);
});

test("windows are per key name", () => {
  const limiter = new RateLimiter();
  assert.equal(limiter.check("a", 1, T0).allowed, true);
  assert.equal(limiter.check("a", 1, T0).allowed, false);
  assert.equal(limiter.check("b", 1, T0).allowed, true);
});

test("limit 0 (or negative, or NaN) means unlimited", () => {
  const limiter = new RateLimiter();
  for (let i = 0; i < 1000; i++)
    assert.equal(limiter.check("a", 0, T0).allowed, true);
  assert.equal(limiter.check("a", -5, T0).allowed, true);
  assert.equal(limiter.check("a", Number.NaN, T0).allowed, true);
  assert.equal(limiter.check("a", 0, T0).remaining, Infinity);
});
