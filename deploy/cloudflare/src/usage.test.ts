import assert from "node:assert/strict";
import { test } from "node:test";

import type { Env } from "./types.ts";
import {
  MAX_KEYS,
  FLUSH_MS,
  classifyPath,
  countEvent,
  countHistoryWithheld,
  countToolCalls,
  countCheckoutStart,
  dim,
  noteCaller,
  parseUsageRecord,
  recordRequest,
  regionDim,
  resetUsageForTests,
  snapshot,
} from "./usage.ts";
import {
  newSketch,
  sketchAdd,
  sketchEstimate,
  sketchFromString,
  sketchMerge,
  sketchToString,
} from "./usage-sketch.ts";

interface Put {
  key: string;
  value: string;
  ttl?: number;
}

function harness(enabled: string | null = "true") {
  const puts: Put[] = [];
  const points: { indexes?: string[]; blobs?: string[]; doubles?: number[] }[] =
    [];
  let clock = Date.parse("2026-11-12T10:00:00Z");
  const pending: Promise<unknown>[] = [];
  const env = {
    USAGE_COUNTERS_ENABLED: enabled ?? undefined,
    KEYS: {
      put: async (
        key: string,
        value: string,
        o?: { expirationTtl?: number },
      ) => {
        puts.push({ key, value, ttl: o?.expirationTtl });
      },
    },
    USAGE: { writeDataPoint: (p: (typeof points)[number]) => points.push(p) },
  } as unknown as Env;
  resetUsageForTests({
    now: () => clock,
    sleep: async () => {},
    waitUntil: (p) => void pending.push(p),
  });
  return {
    env,
    puts,
    points,
    advance: (ms: number) => (clock += ms),
    settle: () => Promise.all(pending.splice(0)),
  };
}

test("off unless the variable is exactly true: nothing is counted or written", async () => {
  for (const v of [null, "", "TRUE", "1", "yes", "true "]) {
    const h = harness(v);
    countEvent(h.env, "lookup", ["registry_get", "us-48", "pro"]);
    noteCaller(h.env, "pro", "key:abc");
    recordRequest(h.env, {
      host: "api.factlot.com",
      path: "/mcp",
      status: 200,
    });
    await h.settle();
    assert.equal(h.puts.length, 0, `value ${String(v)}`);
    assert.equal(h.points.length, 0);
    assert.deepEqual(snapshot().counters, {});
  }
});

test("counts add up; one write now, then at most one per interval, to the day-and-isolate key with a TTL", async () => {
  const h = harness();
  const key = "lookup|registry_get|us-48|pro";
  countEvent(h.env, "lookup", ["registry_get", "us-48", "pro"]);
  await h.settle();
  assert.equal(h.puts.length, 1);
  assert.match(h.puts[0]!.key, /^usage:v1:2026-11-12:[0-9a-f]{12}$/);
  assert.equal(h.puts[0]!.ttl, 40 * 24 * 60 * 60);
  assert.equal(parseUsageRecord(h.puts[0]!.value)!.counters[key], 1);
  // events inside the interval share one later write
  for (let i = 0; i < 5; i++)
    countEvent(h.env, "lookup", ["registry_get", "us-48", "pro"]);
  await h.settle();
  assert.equal(h.puts.length, 2);
  assert.equal(parseUsageRecord(h.puts[1]!.value)!.counters[key], 6);
  h.advance(FLUSH_MS + 1);
  countEvent(h.env, "report", ["created", "pro"]);
  await h.settle();
  assert.equal(h.puts.length, 3);
});

test("a new UTC day starts a new key", async () => {
  const h = harness();
  countEvent(h.env, "report", ["created", "pro"]);
  await h.settle();
  h.advance(24 * 3600 * 1000);
  countEvent(h.env, "report", ["created", "pro"]);
  await h.settle();
  const days = h.puts.map((p) => p.key.split(":")[2]);
  assert.deepEqual([...new Set(days)].sort(), ["2026-11-12", "2026-11-13"]);
});

test("cardinality: every dimension is cleaned and distinct counters are capped", async () => {
  const h = harness();
  assert.equal(dim("registry_get"), "registry_get");
  assert.equal(dim("/texas/*"), "/texas/*");
  assert.equal(dim("https://x.test/a?b=c"), "other");
  assert.equal(dim("a@b.co"), "other");
  assert.equal(dim("x".repeat(33)), "other");
  assert.equal(dim("with space"), "other");
  assert.equal(dim("a|b"), "other");
  assert.equal(dim("203.0.113.77"), "other");
  assert.equal(dim("0123456789abcdef0123"), "other");
  assert.equal(dim("5125550123"), "other");
  assert.equal(dim(42), "other");
  assert.equal(regionDim("us-48"), "us-48");
  assert.equal(regionDim("us-tx"), "us-tx");
  assert.equal(regionDim("fl:parcel:us-48-453"), "other");
  for (let i = 0; i < MAX_KEYS + 50; i++)
    countEvent(h.env, "mcp_call", [`tool_${i}`, "pro"]);
  const counters = snapshot().counters;
  assert.ok(Object.keys(counters).length <= MAX_KEYS + 1);
  assert.equal(counters["overflow"], 50);
});

test("path classes are bounded and carry no identifiers", () => {
  const api = (p: string, s = 200) => classifyPath(p, true, s);
  const site = (p: string, s = 200) => classifyPath(p, false, s);
  assert.deepEqual(api("/mcp"), { surface: "mcp", group: "/mcp" });
  assert.deepEqual(api("/v1/registry/get"), {
    surface: "rest",
    group: "/v1/registry/get",
  });
  // opaque tokens in the path are dropped, not kept
  assert.equal(
    api("/v1/reports/Zm9vYmFyMTIzNDU2Nzg5MA0123").group,
    "/v1/reports",
  );
  assert.equal(api("/v1/billing/claim/ab12cd34ef").group, "/v1/billing/claim");
  assert.equal(api("/v1/nope/zzz", 404).group, "unknown");
  assert.deepEqual(site("/"), { surface: "site", group: "/" });
  assert.equal(site("/pricing/").group, "/pricing");
  assert.equal(site("/try/").group, "/try");
  assert.equal(site("/texas/travis-county/").group, "/texas/*");
  assert.equal(site("/texas/").group, "/texas");
  assert.equal(site("/property/some-parcel-slug").group, "/property/*");
  assert.equal(site("/styles.css").group, "/styles.css");
  assert.equal(site("/try/try.js").group, "asset");
  assert.equal(site("/wp-login.php").group, "other");
  assert.equal(site("/random/path/with?query").group, "other");
});

test("requests: surface, group and status class only", async () => {
  const h = harness();
  recordRequest(h.env, {
    host: "factlot.com",
    path: "/texas/harris-county/",
    status: 200,
  });
  recordRequest(h.env, { host: "api.factlot.com", path: "/mcp", status: 429 });
  await h.settle();
  assert.deepEqual(snapshot().counters, {
    "req|site|/texas/*|2xx": 1,
    "req|mcp|/mcp|4xx": 1,
  });
  // request counts are not duplicated into Analytics Engine; events are
  assert.equal(h.points.length, 0);
  countEvent(h.env, "quota_exhausted", ["keyless", "day"]);
  assert.deepEqual(h.points, [
    {
      indexes: ["evt"],
      blobs: ["quota_exhausted", "keyless", "day", ""],
      doubles: [1],
    },
  ]);
});

test("nothing personal in counter keys, values or the stored record", async () => {
  const h = harness();
  const ip = "203.0.113.77";
  const email = "someone@example.com";
  const key = "flk_live_SECRETKEYVALUE1234567890";
  const urn = "fl:parcel:us-48-453-123456";
  recordRequest(h.env, {
    host: "api.factlot.com",
    path: `/v1/registry/get/${ip}/${email}`,
    status: 200,
  });
  countEvent(h.env, "lookup", [urn, ip, email]);
  countEvent(h.env, "mcp_call", [key, "pro"]);
  noteCaller(h.env, "keyless", `ip:${ip}`);
  noteCaller(h.env, "pro", `key:${key}`);
  await h.settle();
  const stored =
    h.puts.map((p) => p.key + p.value).join("\n") + JSON.stringify(h.points);
  for (const secret of [ip, email, "SECRETKEY", "453-123456", "someone"])
    assert.equal(stored.includes(secret), false, secret);
});

test("distinct callers: sketches keep no subject and merge across isolates", async () => {
  const h = harness();
  for (let i = 0; i < 40; i++) noteCaller(h.env, "keyless", `ip:hash-${i}`);
  noteCaller(h.env, "keyless", "ip:hash-3"); // a repeat
  await h.settle();
  const rec = parseUsageRecord(h.puts.at(-1)!.value)!;
  const sk = sketchFromString(rec.callers["keyless"])!;
  assert.ok(Math.abs(sketchEstimate(sk) - 40) <= 3, String(sketchEstimate(sk)));
  assert.equal(h.puts.at(-1)!.value.includes("hash-3"), false);
});

test("a failing KV write never throws, and is retried at the next interval", async () => {
  const h = harness();
  (h.env.KEYS as unknown as { put: () => Promise<void> }).put = async () => {
    throw new Error("kv down");
  };
  assert.doesNotThrow(() => countEvent(h.env, "report", ["created", "pro"]));
  await h.settle();
  // a throwing waitUntil and a throwing AE binding are swallowed too
  resetUsageForTests({
    waitUntil: () => {
      throw new Error("ctx gone");
    },
  });
  (h.env as { USAGE: unknown }).USAGE = {
    writeDataPoint: () => {
      throw new Error("ae down");
    },
  };
  assert.doesNotThrow(() => countEvent(h.env, "report", ["created", "pro"]));
  assert.doesNotThrow(() => noteCaller(h.env, "pro", "key:x"));
});

test("helpers: tool calls by known name, history notes, checkout starts", async () => {
  const h = harness();
  const known = new Set(["registry_get", "registry_search"]);
  countToolCalls(
    h.env,
    [
      { method: "tools/call", params: { name: "registry_get" } },
      { method: "tools/call", params: { name: "evil/../name" } },
      { method: "tools/list" },
    ],
    "anonymous",
    known,
  );
  assert.deepEqual(snapshot().counters, {
    "mcp_call|registry_get|anonymous": 1,
    "mcp_call|other|anonymous": 1,
  });

  const rest = Response.json({ history_available: "pro", history_note: "x" });
  await countHistoryWithheld(h.env, rest, "rest", "keyless");
  assert.equal(
    await rest
      .json()
      .then((b) => (b as { history_available: string }).history_available),
    "pro",
  ); // body still readable
  const mcp = Response.json([
    { id: 1, result: { structuredContent: { history_available: "pro" } } },
    { id: 2, result: { structuredContent: { value: 1 } } },
    {
      id: 3,
      result: { structuredContent: { subject: { history_available: "pro" } } },
    },
  ]);
  await countHistoryWithheld(h.env, mcp, "mcp", "oauth_free");
  const c = snapshot().counters;
  assert.equal(c["history_note|rest|keyless"], 1);
  assert.equal(c["history_note|mcp|oauth_free"], 2);

  const url = new URL(
    "https://factlot.com/billing/checkout?plan=pro&interval=year",
  );
  await countCheckoutStart(
    h.env,
    new Request(url),
    url,
    new Response(null, { status: 303 }),
  );
  const post = new URL("https://api.factlot.com/v1/billing/checkout");
  await countCheckoutStart(
    h.env,
    new Request(post, { method: "POST" }),
    post,
    Response.json({ plan: "team", url: "https://stripe.example/secret" }),
  );
  await countCheckoutStart(
    h.env,
    new Request(post, { method: "POST" }),
    post,
    Response.json({ error: "CheckoutClosed" }, { status: 503 }),
  );
  const c2 = snapshot().counters;
  assert.equal(c2["checkout_start|pro|year"], 1);
  assert.equal(c2["checkout_start|team|month"], 1);
  assert.equal(
    Object.keys(c2).filter((k) => k.startsWith("checkout_start")).length,
    2,
  );
});

test("sketch accuracy and round trip", () => {
  for (const n of [1, 10, 100, 1000, 20000]) {
    const s = newSketch();
    for (let i = 0; i < n; i++) sketchAdd(s, `caller-${i}`);
    const est = sketchEstimate(s);
    assert.ok(Math.abs(est - n) <= Math.max(1, n * 0.12), `${n}: ${est}`);
    assert.deepEqual(sketchFromString(sketchToString(s)), s);
  }
  const a = newSketch();
  const b = newSketch();
  for (let i = 0; i < 300; i++) sketchAdd(a, `x-${i}`);
  for (let i = 150; i < 450; i++) sketchAdd(b, `x-${i}`);
  sketchMerge(a, b);
  assert.ok(Math.abs(sketchEstimate(a) - 450) <= 450 * 0.12);
  assert.equal(sketchFromString("short"), undefined);
});
