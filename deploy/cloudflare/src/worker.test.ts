import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECHECK_BACKOFF_MS,
  RECHECK_MS,
  billingDeps,
  createCheckout,
  ensurePrice,
  handleWebhook,
  redeemSession,
  refreshIfStale,
  successRoute,
} from "./billing.ts";
import {
  INACTIVE_RETENTION_SECONDS,
  generateKey,
  hashKey,
  keyId,
  looksLikeKey,
  readKey,
  stripeStatusIsActive,
  writeKey,
  type KeyRecord,
} from "./keys.ts";
import {
  Meter,
  RateLimiterObject,
  WindowCounter,
  addressSubject,
  ipBucket,
  objectLimiter,
  objectMeter,
  quotaWindow,
  sqlStore,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import { resetCoverageCache } from "./account-tools.ts";
import { CLAIM_POLL_MS } from "./claim.ts";
import { WHATS_NEW } from "./news.ts";
import { escapeHtml } from "./pages.ts";
import { PLANS } from "./plans.ts";
import { REGISTRY_RUN_URL, registryRunner } from "./registry.ts";
import { handle } from "./router.ts";
import {
  STRIPE_API_VERSION,
  hmacSha256Hex,
  verifyStripeSignature,
} from "./stripe.ts";
import type { Env, KV, MeterService, RateLimit } from "./types.ts";

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  readonly ttl = new Map<string, number | undefined>();
  reads = 0;
  async get(k: string) {
    this.reads++;
    return this.data.get(k) ?? null;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.data.set(k, v);
    this.ttl.set(k, o?.expirationTtl);
  }
  async delete(k: string) {
    this.data.delete(k);
  }
}

class CountingLimit implements RateLimit {
  readonly seen: string[] = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async limit({ key }: { key: string }) {
    this.seen.push(key);
    return { success: this.seen.filter((k) => k === key).length <= this.max };
  }
  async peek({ key }: { key: string }) {
    return { success: this.seen.filter((k) => k === key).length < this.max };
  }
}

class MemoryStore implements CounterStore {
  readonly counts = new Map<string, number>();
  readonly claims = new Map<string, string>();
  getCount(w: string) {
    return this.counts.get(w) ?? 0;
  }
  setCount(w: string, n: number) {
    this.counts.set(w, n);
  }
  pruneBefore(w: string) {
    const kind = w.slice(0, w.indexOf(":") + 1);
    for (const k of [...this.counts.keys()])
      if (k.startsWith(kind) && k < w) this.counts.delete(k);
  }
  getClaim(n: string) {
    return this.claims.get(n);
  }
  setClaim(n: string, v: string) {
    if (!this.claims.has(n)) this.claims.set(n, v);
  }
  readonly usage = new Map<string, number>();
  readonly meta = new Map<string, string>();
  addUsage(day: string, tool: string, region: string, n: number) {
    const k = `${day}|${tool}|${region}`;
    this.usage.set(k, (this.usage.get(k) ?? 0) + n);
  }
  readUsage(fromDay: string) {
    return [...this.usage.entries()]
      .map(([k, n]) => {
        const [day, tool, region] = k.split("|") as [string, string, string];
        return { day, tool, region, n };
      })
      .filter((r) => r.day >= fromDay)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  pruneUsageBefore(day: string) {
    for (const k of [...this.usage.keys()])
      if (k.split("|")[0]! < day) this.usage.delete(k);
  }
  getMeta(n: string) {
    return this.meta.get(n);
  }
  setMeta(n: string, v: string) {
    this.meta.set(n, v);
  }
  deleteMeta(n: string) {
    this.meta.delete(n);
  }
  size() {
    return (
      this.counts.size + this.claims.size + this.usage.size + this.meta.size
    );
  }
  clearClaims() {
    this.claims.clear();
  }
  reset() {}
}

/** 2026-11-07 12:00 UTC, moved by tests. */
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
interface Clock {
  t: number;
}

/** A LIMITER namespace of real RateLimiterObjects over memory stores, on a shared clock. */
function fakeLimiter(clock: Clock) {
  const objects = new Map<
    string,
    { obj: RateLimiterObject; store: MemoryStore; alarm: number | null }
  >();
  const object = (name: string) => {
    let o = objects.get(name);
    if (!o) {
      const store = new MemoryStore();
      const entry = {
        store,
        alarm: null as number | null,
        obj: undefined as unknown as RateLimiterObject,
      };
      entry.obj = new RateLimiterObject(
        {
          storage: {
            sql: {
              exec() {
                throw new Error("memory store in tests");
              },
            },
            getAlarm: async () => entry.alarm,
            setAlarm: async (t: number) => {
              entry.alarm = t;
            },
            deleteAll: async () => {
              store.counts.clear();
              store.claims.clear();
              store.usage.clear();
              store.meta.clear();
              entry.alarm = null;
            },
          },
        },
        {},
        { store, now: () => clock.t },
      );
      objects.set(name, entry);
      o = entry;
    }
    return o;
  };
  const ns: DurableObjectNamespaceLike = {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (input: string, init?: RequestInit) =>
        object(String(id)).obj.fetch(new Request(input, init)),
    }),
  };
  return { ns, object, objects };
}

interface StripeCall {
  method: string;
  path: string;
  body: string;
  signal?: AbortSignal | null;
}

/** A fake Stripe API: routes on method + path, records every call. */
function fakeStripe(
  routes: Record<string, (body: URLSearchParams) => [number, unknown]>,
) {
  const calls: StripeCall[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = String(init?.body ?? "");
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({
      method,
      path,
      body: body || url.search,
      signal: init?.signal,
    });
    const handler = routes[`${method} ${path}`];
    if (!handler)
      return new Response(
        JSON.stringify({ error: { message: "no such route" } }),
        { status: 404 },
      );
    const [status, json] = handler(new URLSearchParams(body || url.search));
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

type TestEnv = Env & { KEYS: MemoryKV; RL_ANON: CountingLimit };

function env(
  overrides: Partial<Env> = {},
  clock: Clock = { t: T0 },
): TestEnv & { limiter: ReturnType<typeof fakeLimiter>; clock: Clock } {
  const limiter = fakeLimiter(clock);
  return {
    KEYS: new MemoryKV(),
    RL_ANON: new CountingLimit(2),
    RL_CLAIM: objectLimiter(limiter.ns, "claim", 1, CLAIM_POLL_MS),
    METER: objectMeter(limiter.ns),
    ...overrides,
    limiter,
    clock,
  } as TestEnv & { limiter: ReturnType<typeof fakeLimiter>; clock: Clock };
}

const SESSION = "cs_live_a1B2c3D4e5F6g7H8";

const record = (over: Partial<KeyRecord> = {}): KeyRecord => ({
  plan: "pro",
  status: "active",
  customer: "cus_1",
  subscription: "sub_1",
  stripe_status: "active",
  created: "2026-11-03T00:00:00Z",
  checked_at: 0,
  ...over,
});

/** A key with a fresh record (no Stripe re-check), listed under its subscription. */
async function issue(
  e: Env,
  over: Partial<KeyRecord> = {},
  now = T0,
): Promise<{ key: string; hash: string }> {
  const key = generateKey();
  const hash = await hashKey(key);
  const rec = record({ checked_at: now, ...over });
  await writeKey(e.KEYS, hash, rec, now);
  const listKey = `sub:${rec.subscription}`;
  const list = JSON.parse((await e.KEYS.get(listKey)) ?? "[]") as string[];
  await e.KEYS.put(listKey, JSON.stringify([...list, hash]));
  return { key, hash };
}

async function signed(
  payload: unknown,
  secret = "whsec_x",
  t = Math.floor(T0 / 1000),
): Promise<Request> {
  const body = JSON.stringify(payload);
  const sig = await hmacSha256Hex(secret, `${t}.${body}`);
  return new Request("https://api.factlot.com/v1/billing/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": `t=${t},v1=${sig}` },
  });
}

/** The inner handler: REST answers {ok:true}; MCP answers each request message. */
function innerApi(opts: { registryDown?: boolean } = {}) {
  const seen: { request: Request; body: string }[] = [];
  const unavailable = JSON.stringify({
    error: "RegistryUnavailable",
    message: "registry service answered 503",
    issues: [],
  });
  const api = {
    fetch: async (r: Request) => {
      const body = await r.text();
      seen.push({ request: r, body });
      const path = new URL(r.url).pathname;
      if (opts.registryDown && path.startsWith("/v1/registry/"))
        return new Response(unavailable, {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      if (path === "/mcp") {
        const parsed = JSON.parse(body) as unknown;
        const items = (Array.isArray(parsed) ? parsed : [parsed]) as {
          id?: unknown;
          params?: { name?: string };
        }[];
        const answers = items
          .filter((m) => m.id !== undefined)
          .map((m) => ({
            jsonrpc: "2.0",
            id: m.id,
            result:
              opts.registryDown && m.params?.name?.startsWith("registry_")
                ? {
                    isError: true,
                    content: [{ type: "text", text: unavailable }],
                  }
                : { content: [{ type: "text", text: "{}" }] },
          }));
        if (answers.length === 0) return new Response(null, { status: 202 });
        return new Response(
          JSON.stringify(answers.length === 1 ? answers[0] : answers),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      });
    },
  };
  return { api, seen };
}

const IP = "203.0.113.9";

function call(
  e: ReturnType<typeof env>,
  api: { fetch(r: Request): Promise<Response> },
  path: string,
  init: { body?: unknown; key?: string; ip?: string; method?: string } = {},
): Promise<Response> {
  return handle(
    new Request(`https://api.factlot.com${path}`, {
      method: init.method ?? "POST",
      body:
        init.method === "GET" || init.method === "DELETE"
          ? undefined
          : JSON.stringify(init.body ?? {}),
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": init.ip ?? IP,
        ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      },
    }),
    e,
    api,
    { now: () => e.clock.t },
  );
}

const toolCall = (name: string, id: number | string = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: {} },
});

describe("keys", () => {
  it("generates fl_live_ keys with 256 bits and hashes them to hex", async () => {
    const a = generateKey();
    const b = generateKey();
    assert.ok(looksLikeKey(a), a);
    assert.notEqual(a, b);
    assert.match(await hashKey(a), /^[0-9a-f]{64}$/);
    assert.equal(looksLikeKey("fl_live_short"), false);
    assert.equal(looksLikeKey("sk_live_" + "x".repeat(43)), false);
  });

  it("treats a subscription with pause_collection as inactive; past_due stays active", () => {
    assert.equal(stripeStatusIsActive("active"), true);
    assert.equal(stripeStatusIsActive("past_due"), true);
    assert.equal(stripeStatusIsActive("active", { behavior: "void" }), false);
    assert.equal(stripeStatusIsActive("active", null), true);
    assert.equal(stripeStatusIsActive("unpaid"), false);
    assert.equal(stripeStatusIsActive("paused"), false);
  });

  it("stores inactive records with a 365-day expiry and active ones with none", async () => {
    const kv = new MemoryKV();
    await writeKey(kv, "a", record(), T0);
    assert.equal(kv.ttl.get("key:a"), undefined);
    await writeKey(kv, "c", record({ stripe_status: "canceled" }), T0);
    assert.equal(kv.ttl.get("key:c"), INACTIVE_RETENTION_SECONDS);
    const stored = JSON.parse(kv.data.get("key:c")!) as KeyRecord;
    assert.equal(stored.status, "inactive");
    assert.equal(stored.inactive_since, new Date(T0).toISOString());
    // A later write keeps the original date, so the 365 days do not restart.
    await writeKey(kv, "c", stored, T0 + 86_400_000);
    assert.equal(kv.ttl.get("key:c"), INACTIVE_RETENTION_SECONDS - 86_400);
    // Reactivation removes the expiry.
    await writeKey(kv, "c", { ...stored, stripe_status: "active" }, T0);
    assert.equal(kv.ttl.get("key:c"), undefined);
    assert.equal(
      (JSON.parse(kv.data.get("key:c")!) as KeyRecord).inactive_since,
      undefined,
    );
  });
});

describe("Stripe webhook signatures", () => {
  const secret = "whsec_test_secret";
  const payload = '{"type":"ping"}';
  it("accepts a valid v1 signature inside the tolerance", async () => {
    const t = 1_800_000_000;
    const sig = await hmacSha256Hex(secret, `${t}.${payload}`);
    assert.equal(
      await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t + 10),
      true,
    );
    assert.equal(
      await verifyStripeSignature(
        payload,
        `t=${t},v1=bad,v1=${sig}`,
        secret,
        t,
      ),
      true,
    );
  });
  it("rejects a wrong secret, a changed body, a stale timestamp and malformed headers", async () => {
    const t = 1_800_000_000;
    const sig = await hmacSha256Hex(secret, `${t}.${payload}`);
    assert.equal(
      await verifyStripeSignature(
        payload,
        `t=${t},v1=${sig}`,
        "whsec_other",
        t,
      ),
      false,
    );
    assert.equal(
      await verifyStripeSignature(payload + " ", `t=${t},v1=${sig}`, secret, t),
      false,
    );
    assert.equal(
      await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t + 301),
      false,
    );
    assert.equal(await verifyStripeSignature(payload, null, secret, t), false);
    assert.equal(
      await verifyStripeSignature(payload, `v1=${sig}`, secret, t),
      false,
    );
  });
});

describe("billing", () => {
  it("is closed (no deps) until STRIPE_SECRET_KEY is set", () => {
    assert.equal(billingDeps(env()), undefined);
  });

  it("finds an existing price by lookup key and caches it", async () => {
    const s = fakeStripe({
      "GET /prices": () => [200, { data: [{ id: "price_pro" }] }],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const d = billingDeps(e, s.fetchImpl)!;
    assert.equal(await ensurePrice(d, "pro"), "price_pro");
    assert.equal(await ensurePrice(d, "pro"), "price_pro");
    assert.equal(s.calls.length, 1, "second lookup comes from KV");
    assert.match(s.calls[0]!.body, /lookup_keys%5B%5D=factlot_pro_monthly_v1/);
  });

  it("creates the product and a $49 monthly price when none exists", async () => {
    let priceBody: URLSearchParams | undefined;
    const s = fakeStripe({
      "GET /prices": () => [200, { data: [] }],
      "POST /products": () => [200, { id: "prod_1" }],
      "POST /prices": (b) => {
        priceBody = b;
        return [200, { id: "price_new" }];
      },
    });
    const d = billingDeps(
      env({ STRIPE_SECRET_KEY: "rk_test_x" }),
      s.fetchImpl,
    )!;
    assert.equal(await ensurePrice(d, "pro"), "price_new");
    assert.equal(priceBody?.get("unit_amount"), "4900");
    assert.equal(priceBody?.get("recurring[interval]"), "month");
    assert.equal(priceBody?.get("product"), "prod_1");
  });

  it("opens checkout with terms consent, renewal text, address and tax ID collection, promotion codes", async () => {
    let body: URLSearchParams | undefined;
    const s = fakeStripe({
      "GET /prices": () => [200, { data: [{ id: "price_team" }] }],
      "POST /checkout/sessions": (b) => {
        body = b;
        return [200, { url: "https://checkout.stripe.com/c/pay/x" }];
      },
    });
    const d = billingDeps(
      env({ STRIPE_SECRET_KEY: "sk_live_x" }),
      s.fetchImpl,
    )!;
    assert.equal(
      await createCheckout(d, "team"),
      "https://checkout.stripe.com/c/pay/x",
    );
    assert.equal(body?.get("consent_collection[terms_of_service]"), "required");
    assert.match(
      body?.get("custom_text[terms_of_service_acceptance][message]") ?? "",
      /https:\/\/factlot\.com\/terms/,
    );
    assert.equal(
      body?.get("custom_text[submit][message]"),
      "$599 a month, renews monthly until cancelled. Cancel any time at factlot.com/account.",
    );
    assert.equal(body?.get("billing_address_collection"), "auto");
    assert.equal(body?.get("allow_promotion_codes"), "true");
    assert.equal(body?.get("tax_id_collection[enabled]"), "true");
    assert.equal(body?.get("automatic_tax[enabled]"), null);
    assert.equal(
      body?.get("subscription_data[metadata][factlot_plan]"),
      "team",
    );
  });

  const paidSession = {
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    subscription: "sub_1",
    customer: "cus_1",
    metadata: { factlot_plan: "pro" },
  };

  it("redeems a paid session once: stores only the hash, refuses a second redemption", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paidSession],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const d = billingDeps(e, s.fetchImpl, () => 1_000)!;
    const r = await redeemSession(d, SESSION);
    assert.ok(r.ok);
    const kv = e.KEYS;
    for (const v of kv.data.values())
      assert.ok(!v.includes(r.key), "plaintext key is never stored");
    const hash = await hashKey(r.key);
    const rec = await readKey(kv, hash);
    assert.equal(rec?.plan, "pro");
    assert.equal(rec?.status, "active");
    assert.deepEqual(JSON.parse(kv.data.get("sub:sub_1")!), [hash]);
    assert.deepEqual(
      JSON.parse(kv.data.get(`session:${SESSION}`)!).key_id,
      keyId(hash),
    );
    const again = await redeemSession(d, SESSION);
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.status, 409);
  });

  it("mints exactly one key when the success page loads twice at once (two regions)", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paidSession],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const d = billingDeps(e, s.fetchImpl, () => T0)!;
    const [a, b] = await Promise.all([
      redeemSession(d, SESSION),
      redeemSession(d, SESSION),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    assert.equal([a, b].filter((r) => !r.ok && r.status === 409).length, 1);
    const keys = [...e.KEYS.data.keys()].filter((k) => k.startsWith("key:"));
    assert.equal(keys.length, 1, "the losing attempt removed its record");
    assert.equal(JSON.parse(e.KEYS.data.get("sub:sub_1")!).length, 1);
  });

  it("takes plan and status from the expanded subscription at redemption", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [
        200,
        {
          ...paidSession,
          subscription: {
            id: "sub_9",
            status: "active",
            items: {
              data: [{ price: { lookup_key: "factlot_team_monthly_v1" } }],
            },
          },
        },
      ],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const r = await redeemSession(
      billingDeps(e, s.fetchImpl, () => T0)!,
      SESSION,
    );
    assert.ok(r.ok);
    assert.equal(r.plan, "team");
    assert.match(s.calls[0]!.body, /expand%5B%5D=subscription/);
    assert.equal(
      (await readKey(e.KEYS, await hashKey(r.key)))?.subscription,
      "sub_9",
    );
  });

  it("refuses an open (unpaid, not completed) session with 402", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [
        200,
        { ...paidSession, status: "open", payment_status: "unpaid" },
      ],
    });
    const d = billingDeps(
      env({ STRIPE_SECRET_KEY: "rk_test_x" }),
      s.fetchImpl,
    )!;
    const r = await redeemSession(d, SESSION);
    assert.equal(!r.ok && r.status, 402);
  });

  it("refuses unpaid sessions, malformed IDs and unknown plans", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [
        200,
        { ...paidSession, payment_status: "unpaid" },
      ],
    });
    const d = billingDeps(
      env({ STRIPE_SECRET_KEY: "rk_test_x" }),
      s.fetchImpl,
    )!;
    const unpaid = await redeemSession(d, SESSION);
    assert.equal(
      !unpaid.ok && unpaid.status,
      202,
      "a completed bank payment is processing",
    );
    assert.match(
      !unpaid.ok ? unpaid.message : "",
      /bank payment is processing/,
    );
    const bad = await redeemSession(d, "cs_live_<script>");
    assert.equal(!bad.ok && bad.status, 400);
    assert.equal(s.calls.length, 1, "a malformed ID never reaches Stripe");
  });

  it("says a failed bank payment failed (async_payment_failed), not that it is processing", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [
        200,
        { ...paidSession, payment_status: "unpaid" },
      ],
    });
    const e = env({
      STRIPE_SECRET_KEY: "rk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    });
    const res = await handleWebhook(
      e,
      await signed({
        type: "checkout.session.async_payment_failed",
        created: 1,
        data: { object: { id: SESSION } },
      }),
      () => T0,
    );
    assert.equal(res.status, 200);
    const page = await successRoute(
      e,
      new URL(`https://factlot.com/billing/success?session_id=${SESSION}`),
      s.fetchImpl,
    );
    assert.equal(page.status, 402);
    const text = await page.text();
    assert.match(text, /did not go through/);
    assert.doesNotMatch(text, /processing/);
  });

  it("re-checks a stale key and deactivates a cancelled subscription", async () => {
    const s = fakeStripe({
      "GET /subscriptions/sub_1": () => [200, { status: "canceled" }],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const d = billingDeps(e, s.fetchImpl, () => RECHECK_MS + 1)!;
    const next = await refreshIfStale(d, "h", record());
    assert.equal(next.status, "inactive");
    const fresh = await refreshIfStale(
      billingDeps(e, s.fetchImpl, () => 10)!,
      "h",
      record(),
    );
    assert.equal(fresh.status, "active");
    assert.equal(s.calls.length, 1, "a fresh record is not re-checked");
    assert.ok(
      s.calls[0]!.signal instanceof AbortSignal,
      "the re-check has a timeout",
    );
  });

  it("re-check: takes a plan change from the price lookup key, and pause_collection deactivates", async () => {
    const s = fakeStripe({
      "GET /subscriptions/sub_1": () => [
        200,
        {
          status: "active",
          metadata: { factlot_plan: "pro" },
          items: {
            data: [{ price: { lookup_key: "factlot_team_monthly_v1" } }],
          },
          pause_collection: { behavior: "void" },
        },
      ],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const next = await refreshIfStale(
      billingDeps(e, s.fetchImpl, () => RECHECK_MS + 1)!,
      "h",
      record(),
    );
    assert.equal(next.plan, "team");
    assert.equal(next.paused, true);
    assert.equal(next.status, "inactive");
  });

  it("keeps the last status when Stripe is unreachable and backs off 10 minutes", async () => {
    const s = fakeStripe({
      "GET /subscriptions/sub_1": () => [500, { error: { message: "down" } }],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    let now = RECHECK_MS + 1;
    const d = billingDeps(e, s.fetchImpl, () => now)!;
    const first = await refreshIfStale(d, "h", record());
    assert.equal(first.status, "active");
    assert.equal(s.calls.length, 1);
    assert.equal(
      (await readKey(e.KEYS, "h"))?.checked_at,
      first.checked_at,
      "the backoff is stored",
    );
    now += RECHECK_BACKOFF_MS - 1;
    await refreshIfStale(d, "h", first);
    assert.equal(s.calls.length, 1, "no retry inside the backoff");
    now += 2;
    await refreshIfStale(d, "h", first);
    assert.equal(s.calls.length, 2, "retried after the backoff");
  });

  it("deactivates a key whose subscription Stripe does not know", async () => {
    const s = fakeStripe({
      "GET /subscriptions/sub_1": () => [
        404,
        {
          error: {
            type: "invalid_request_error",
            message: "No such subscription",
          },
        },
      ],
    });
    const d = billingDeps(
      env({ STRIPE_SECRET_KEY: "rk_live_x" }),
      s.fetchImpl,
      () => RECHECK_MS + 1,
    )!;
    const next = await refreshIfStale(d, "h", record());
    assert.equal(next.status, "inactive");
    assert.equal(next.stripe_status, "missing");
  });
});

describe("webhooks", () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    id: "sub_1",
    status: "active",
    items: { data: [{ price: { lookup_key: "factlot_pro_monthly_v1" } }] },
    ...over,
  });

  it("applies a signed subscription.deleted webhook to every key of the subscription", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    await writeKey(e.KEYS, "h1", record());
    await e.KEYS.put("sub:sub_1", JSON.stringify(["h1"]));
    const payload = {
      type: "customer.subscription.deleted",
      created: 100,
      data: { object: { id: "sub_1", status: "canceled" } },
    };
    const res = await handleWebhook(e, await signed(payload), () => T0);
    assert.equal(res.status, 200);
    assert.equal((await readKey(e.KEYS, "h1"))?.status, "inactive");
    assert.equal(e.KEYS.ttl.get("key:h1"), INACTIVE_RETENTION_SECONDS);
    assert.equal(
      e.KEYS.ttl.get("sub:sub_1"),
      INACTIVE_RETENTION_SECONDS,
      "the key list of a subscription with no active key expires too",
    );
    const body = JSON.stringify(payload);
    const forged = new Request("https://api.factlot.com/v1/billing/webhook", {
      method: "POST",
      body,
      headers: {
        "stripe-signature": `t=${Math.floor(T0 / 1000)},v1=${"0".repeat(64)}`,
      },
    });
    assert.equal((await handleWebhook(e, forged, () => T0)).status, 400);
  });

  it("changes the plan (and its limits) when the portal switches the price", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const { key } = await issue(e);
    const res = await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 100,
        data: {
          object: sub({
            metadata: { factlot_plan: "pro" },
            items: {
              data: [{ price: { lookup_key: "factlot_team_monthly_v1" } }],
            },
          }),
        },
      }),
      () => T0,
    );
    assert.equal(res.status, 200);
    const { api } = innerApi();
    const acct = (await (
      await call(e, api, "/v1/account", { key, method: "GET" })
    ).json()) as {
      plan: string;
      requests_per_minute: number;
      keys: { limit: number };
    };
    assert.equal(acct.plan, "team");
    assert.equal(acct.requests_per_minute, 3000);
    assert.equal(acct.keys.limit, 5);
  });

  it("deactivates a paused subscription (pause_collection) and reactivates on resume", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const { hash } = await issue(e);
    await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 100,
        data: { object: sub({ pause_collection: { behavior: "void" } }) },
      }),
      () => T0,
    );
    assert.equal((await readKey(e.KEYS, hash))?.status, "inactive");
    await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 200,
        data: { object: sub({ pause_collection: null }) },
      }),
      () => T0,
    );
    assert.equal((await readKey(e.KEYS, hash))?.status, "active");
  });

  it("skips an event older than the last one applied (out-of-order delivery)", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const { hash } = await issue(e);
    await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 200,
        data: { object: sub({ status: "unpaid" }) },
      }),
      () => T0,
    );
    const late = await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 150,
        data: { object: sub({ status: "active" }) },
      }),
      () => T0,
    );
    assert.equal(
      ((await late.json()) as { skipped?: string }).skipped,
      "older than applied",
    );
    assert.equal((await readKey(e.KEYS, hash))?.stripe_status, "unpaid");
  });

  it("keeps canceled final even when a same-second update arrives after it", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const { hash } = await issue(e);
    await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.deleted",
        created: 300,
        data: { object: sub({ status: "canceled" }) },
      }),
      () => T0,
    );
    await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 300,
        data: { object: sub({ status: "active" }) },
      }),
      () => T0,
    );
    assert.equal((await readKey(e.KEYS, hash))?.status, "inactive");
  });

  it("holds the keys of a fully refunded charge (via its invoice); a partial refund changes nothing", async () => {
    const s = fakeStripe({
      "GET /invoices/in_1": () => [
        200,
        { parent: { subscription_details: { subscription: "sub_1" } } },
      ],
    });
    const e = env({
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_SECRET_KEY: "rk_test_x",
    });
    const { hash } = await issue(e);
    const partial = await handleWebhook(
      e,
      await signed({
        type: "charge.refunded",
        created: 1,
        data: { object: { id: "ch_1", refunded: false, invoice: "in_1" } },
      }),
      () => T0,
      s.fetchImpl,
    );
    assert.equal(partial.status, 200);
    assert.equal((await readKey(e.KEYS, hash))?.status, "active");
    await handleWebhook(
      e,
      await signed({
        type: "charge.refunded",
        created: 2,
        data: { object: { id: "ch_1", refunded: true, invoice: "in_1" } },
      }),
      () => T0,
      s.fetchImpl,
    );
    const held = await readKey(e.KEYS, hash);
    assert.equal(held?.hold, "refunded");
    assert.equal(held?.status, "inactive");
    // Stripe still reports the subscription active; the hold stays.
    const s2 = fakeStripe({
      "GET /subscriptions/sub_1": () => [200, sub()],
    });
    const after = await refreshIfStale(
      billingDeps(e, s2.fetchImpl, () => T0 + RECHECK_MS + 1)!,
      hash,
      held!,
    );
    assert.equal(after.status, "inactive");
  });

  it("holds the keys of a disputed charge (charge → customer → subscriptions)", async () => {
    const s = fakeStripe({
      "GET /charges/ch_2": () => [200, { id: "ch_2", customer: "cus_1" }],
      "GET /subscriptions": (q) => {
        assert.equal(q.get("customer"), "cus_1");
        return [200, { data: [{ id: "sub_1" }] }];
      },
    });
    const e = env({
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_SECRET_KEY: "rk_test_x",
    });
    const { key } = await issue(e);
    const res = await handleWebhook(
      e,
      await signed({
        type: "charge.dispute.created",
        created: 1,
        data: { object: { id: "dp_1", charge: "ch_2" } },
      }),
      () => T0,
      s.fetchImpl,
    );
    assert.equal(
      ((await res.json()) as { keys_updated: number }).keys_updated,
      1,
    );
    const { api } = innerApi();
    const tool = await call(e, api, "/v1/calc/irr", { key });
    assert.equal(tool.status, 403);
    assert.match(
      ((await tool.json()) as { message: string }).message,
      /disputed/,
    );
  });

  it("records a failed invoice payment without switching the key off, and clears it once paid", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const { hash } = await issue(e);
    await handleWebhook(
      e,
      await signed({
        type: "invoice.payment_failed",
        created: 1_800_000_000,
        data: { object: { id: "in_2", subscription: "sub_1" } },
      }),
      () => T0,
    );
    let rec = await readKey(e.KEYS, hash);
    assert.equal(
      rec?.payment_failed_at,
      new Date(1_800_000_000_000).toISOString(),
    );
    assert.equal(rec?.status, "active");
    await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 1_800_000_100,
        data: { object: sub({ status: "active" }) },
      }),
      () => T0,
    );
    rec = await readKey(e.KEYS, hash);
    assert.equal(rec?.payment_failed_at, undefined);
  });

  it("refuses a body over 1 MB before computing the signature", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const big = "x".repeat(1024 * 1024 + 1);
    const res = await handleWebhook(
      e,
      new Request("https://api.factlot.com/v1/billing/webhook", {
        method: "POST",
        body: big,
        headers: { "stripe-signature": "t=1,v1=00" },
      }),
      () => T0,
    );
    assert.equal(res.status, 413);
    // A stream with no content-length is cut off at the cap as well.
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(64 * 1024));
        c.close();
      },
    });
    const chunked = await handleWebhook(
      e,
      new Request("https://api.factlot.com/v1/billing/webhook", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
      () => T0,
    );
    assert.equal(chunked.status, 413);
  });
});

describe("meter", () => {
  const meter = (clock: Clock) =>
    new Meter(
      () => new MemoryStore(),
      () => clock.t,
    );

  it("grants up to the limit, partly when a batch runs over, and nothing past it", () => {
    const clock = { t: T0 };
    const m = meter(clock);
    const q = { kind: "day" as const, limit: 3, n: 2 };
    assert.deepEqual(
      { ...m.hit(1000, q), window_ends: undefined },
      {
        ok: true,
        granted: 2,
        quota: {
          used: 2,
          limit: 3,
          remaining: 1,
          resets_at: "2026-11-08T00:00:00.000Z",
        },
        window_ends: undefined,
      },
    );
    assert.equal(m.hit(1000, q).granted, 1, "only one left");
    assert.equal(m.hit(1000, q).granted, 0);
    assert.equal(m.hit(1000, { ...q, n: 0 }).quota?.remaining, 0, "n=0 reads");
  });

  it("takes no lookups from a request the minute limit refuses", () => {
    const clock = { t: T0 };
    const m = meter(clock);
    const q = { kind: "month" as const, limit: 10, n: 1 };
    assert.equal(m.hit(1, q).granted, 1);
    const refused = m.hit(1, q);
    assert.equal(refused.ok, false);
    assert.equal(refused.granted, 0);
    assert.equal(refused.quota?.used, 1);
  });

  it("rolls the month over at 00:00 UTC on the 1st and the day at 00:00 UTC", () => {
    const clock = { t: Date.UTC(2026, 10, 30, 23, 59, 59, 999) };
    const m = meter(clock);
    const month = { kind: "month" as const, limit: 2, n: 2 };
    assert.equal(m.hit(null, month).granted, 2);
    assert.equal(m.hit(null, month).granted, 0);
    assert.equal(m.quota("month", 2).resets_at, "2026-12-01T00:00:00.000Z");
    clock.t = Date.UTC(2026, 11, 1, 0, 0, 0, 0);
    assert.equal(m.hit(null, month).granted, 2, "new month");
    assert.equal(m.quota("month", 2).resets_at, "2027-01-01T00:00:00.000Z");
    assert.deepEqual(quotaWindow("day", Date.UTC(2026, 11, 31, 23, 59)), {
      window: "day:2026-12-31",
      resetsAt: Date.UTC(2027, 0, 1),
    });
  });

  it("claims: the first writer wins", () => {
    const m = meter({ t: T0 });
    assert.equal(m.claim("session:x", "a"), "a");
    assert.equal(m.claim("session:x", "b"), "a");
  });

  it("deletes ended windows at the alarm and empties the object", async () => {
    const clock = { t: T0 };
    const lim = fakeLimiter(clock);
    const meterService: MeterService = objectMeter(lim.ns);
    await meterService.hit("ip:abc", 60, { kind: "day", limit: 100, n: 1 });
    const o = lim.object("meter:ip:abc");
    assert.equal(o.alarm, Date.UTC(2026, 10, 8), "alarm at the end of the day");
    assert.equal(o.store.counts.get("day:2026-11-07"), 1);
    clock.t = Date.UTC(2026, 10, 8, 0, 0, 1);
    await o.obj.alarm();
    assert.equal(o.store.counts.size, 0, "the ended day's count is gone");
    assert.equal(o.alarm, null);
    // Month counters live until the month ends; the alarm is rescheduled while one remains.
    await meterService.consume("sub:sub_1", { kind: "month", limit: 10, n: 1 });
    const m = lim.object("meter:sub:sub_1");
    assert.equal(m.alarm, Date.UTC(2026, 11, 1));
    clock.t = Date.UTC(2026, 11, 1, 0, 0, 1);
    await m.obj.alarm();
    assert.equal(m.store.counts.size, 0);
    // Claims are deleted after 30 days.
    await meterService.claim("session:y", "k");
    const c = lim.object("claim:session:y");
    assert.ok(c.alarm! > clock.t + 29 * 86_400_000);
    await c.obj.alarm();
    assert.equal(c.store.claims.size, 0);
  });

  it("runs the same statements on SQLite", async (t) => {
    let DatabaseSync:
      | (new (p: string) => {
          prepare(q: string): {
            all(...b: unknown[]): Record<string, unknown>[];
          };
        })
      | undefined;
    try {
      ({ DatabaseSync } = (await import("node:sqlite")) as unknown as {
        DatabaseSync: typeof DatabaseSync;
      });
    } catch {
      t.skip("node:sqlite is not available in this Node version");
      return;
    }
    const db = new DatabaseSync!(":memory:");
    const store = sqlStore({
      // Like Cloudflare's exec, the statement runs at once.
      exec: (q, ...b) => {
        const rows = db.prepare(q).all(...b);
        return { toArray: () => rows };
      },
    });
    const clock = { t: Date.UTC(2026, 9, 31, 23, 0) };
    const m = new Meter(
      () => store,
      () => clock.t,
    );
    assert.equal(m.hit(10, { kind: "month", limit: 5, n: 3 }).granted, 3);
    assert.equal(m.hit(10, { kind: "day", limit: 5, n: 1 }).granted, 1);
    assert.equal(m.quota("month", 5).used, 3);
    assert.equal(m.claim("a", "1"), "1");
    assert.equal(m.claim("a", "2"), "1");
    assert.equal(store.size(), 3);
    clock.t = Date.UTC(2026, 10, 1, 0, 0, 1);
    assert.equal(
      m.cleanup(),
      undefined,
      "October's counts and the claim are gone",
    );
    assert.equal(store.size(), 0);
    // Usage and last-use rows on the same SQLite: kept 90 days, then pruned by the alarm.
    m.record([
      { tool: "registry_get", region: "us-24" },
      { tool: "registry_get", region: "us-24" },
      { tool: "registry_search_address", region: "search" },
    ]);
    assert.ok(m.touch());
    assert.equal(m.touch(), false, "at most one write a minute");
    const u = m.usage(30);
    assert.equal(u.total, 3);
    assert.deepEqual(u.by_region, { "us-24": 2, search: 1 });
    assert.equal(u.daily.at(-1)!.date, "2026-11-01");
    assert.equal(u.daily.at(-1)!.lookups, 3);
    assert.equal(m.lastUsed(), "2026-11-01T00:00:00.000Z");
    clock.t += 89 * 24 * 3600_000;
    assert.notEqual(m.cleanup(), undefined, "still kept on day 90");
    clock.t += 2 * 24 * 3600_000;
    assert.equal(m.cleanup(), undefined, "gone after 90 days");
    assert.equal(store.size(), 0);
  });
});

describe("addresses", () => {
  it("buckets IPv6 by /64 and leaves IPv4 alone", () => {
    assert.equal(ipBucket("203.0.113.9"), "203.0.113.9");
    assert.equal(ipBucket("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
    assert.equal(ipBucket("2001:0DB8:0001:0002::ffff"), "2001:db8:1:2::/64");
    assert.equal(ipBucket("2001:db8:1:2::"), "2001:db8:1:2::/64");
    assert.equal(ipBucket("2001:db8::1"), "2001:db8:0:0::/64");
    assert.notEqual(ipBucket("2001:db8:1:3::1"), ipBucket("2001:db8:1:2::1"));
    assert.equal(ipBucket("::ffff:198.51.100.7"), "198.51.100.7");
    assert.equal(ipBucket("fe80::1%eth0"), "fe80:0:0:0::/64");
    assert.equal(ipBucket("not:an:address::x"), "not:an:address::x");
  });

  it("names the meter by a salted hash, never the address; it changes with the UTC day", async () => {
    const a = await addressSubject("2001:db8:1:2::1", T0);
    assert.equal(a, await addressSubject("2001:db8:1:2:ffff::9", T0));
    assert.match(a, /^ip:[0-9a-f]{32}$/);
    assert.ok(!a.includes("2001"));
    assert.notEqual(
      a,
      await addressSubject("2001:db8:1:2::1", T0 + 86_400_000),
    );
  });
});

describe("router", () => {
  const assets = { fetch: async () => new Response("<html>site</html>") };

  it("serves its own robots.txt on the API host", async () => {
    const { api } = innerApi();
    const res = await handle(
      new Request("https://api.factlot.com/robots.txt"),
      env({ ASSETS: assets }),
      api,
    );
    assert.equal(res.status, 200);
    assert.match(await res.text(), /User-agent: \*\nAllow: \//);
  });

  it("serves the landing page on the apex host and the API on api.", async () => {
    const { api } = innerApi();
    const e = env({ ASSETS: assets });
    assert.equal(
      await (await handle(new Request("https://factlot.com/"), e, api)).text(),
      "<html>site</html>",
    );
    const root = (await (
      await handle(new Request("https://api.factlot.com/"), e, api)
    ).json()) as {
      mcp: string;
      plans: { pro: { checkout: string } };
      checkout_open: boolean;
    };
    assert.equal(root.mcp, "https://api.factlot.com/mcp");
    assert.equal(
      root.plans.pro.checkout,
      "https://factlot.com/billing/checkout?plan=pro",
    );
    assert.equal(root.checkout_open, false);
    const viaApex = await handle(
      new Request("https://factlot.com/mcp", { method: "POST", body: "{}" }),
      e,
      api,
    );
    assert.equal(
      viaApex.headers.get("x-factlot-tier"),
      "anonymous",
      "API paths work on the apex too",
    );
  });

  it("publishes the plans, the counting rules and whether checkout is open", async () => {
    const { api } = innerApi();
    const body = (await (
      await call(env(), api, "/v1/plans", { method: "GET" })
    ).json()) as {
      plans: Record<
        string,
        { note: string; registry_lookups_per_month?: number }
      >;
      quotas: Record<string, string>;
      checkout_open: boolean;
    };
    assert.equal(
      body.plans.free!.note,
      "Every calculator, ID, fact, rules and document tool at 60 requests a minute per IP address, and 25 registry lookups a day per IP address.",
    );
    assert.equal(
      body.plans.pro!.note,
      "1 API key, 600 requests a minute, 5,000 registry lookups a month, email support.",
    );
    assert.equal(
      body.plans.team!.note,
      "Up to 5 API keys, 3,000 requests a minute, 100,000 registry lookups a month, priority support, and a vote on which regions open next.",
    );
    assert.equal(body.plans.team!.registry_lookups_per_month, 100_000);
    assert.match(body.quotas.counted!, /registry_coverage/);
    assert.equal(body.checkout_open, false);
  });

  it("redirects www to the apex, keeping path and query", async () => {
    const { api } = innerApi();
    const res = await handle(
      new Request("https://www.factlot.com/llms.txt?x=1"),
      env({ ASSETS: assets }),
      api,
    );
    assert.equal(res.status, 301);
    assert.equal(
      res.headers.get("location"),
      "https://factlot.com/llms.txt?x=1",
    );
  });

  it("rate-limits anonymous callers per address, with an upgrade hint", async () => {
    const { api } = innerApi();
    const e = env({ ASSETS: assets });
    for (let i = 0; i < 60; i++)
      assert.equal((await call(e, api, "/v1/calc/irr")).status, 200);
    const over = await call(e, api, "/v1/calc/irr");
    assert.equal(over.status, 429);
    assert.match(
      ((await over.json()) as { message: string }).message,
      /factlot\.com\/#pricing/,
    );
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { ip: "198.51.100.1" })).status,
      200,
      "another address has its own budget",
    );
  });

  it("refuses unknown bearer tokens and passes live paid keys without the header", async () => {
    const { api, seen } = innerApi();
    const e = env();
    const bad = await handle(
      new Request("https://api.factlot.com/mcp", {
        method: "POST",
        body: "{}",
        headers: { authorization: "Bearer sk_live_nope" },
      }),
      e,
      api,
    );
    assert.equal(bad.status, 401);
    assert.equal(
      ((await bad.json()) as { jsonrpc?: string }).jsonrpc,
      "2.0",
      "MCP callers get a JSON-RPC error",
    );

    const { key, hash } = await issue(e, { plan: "team" }, Date.now());
    const ok = await handle(
      new Request("https://api.factlot.com/v1/calc/irr", {
        method: "POST",
        body: "{}",
        headers: { authorization: `Bearer ${key}` },
      }),
      e,
      api,
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-factlot-tier"), "team");
    assert.equal(ok.headers.get("x-ratelimit-limit"), "3000");
    const inner = seen.at(-1)!.request;
    assert.equal(
      inner.headers.get("authorization"),
      null,
      "the key never reaches the inner handler",
    );
    assert.equal(inner.headers.get("x-forwarded-proto"), "https");
    assert.equal(inner.headers.get("x-forwarded-host"), "api.factlot.com");
    assert.ok(
      e.limiter.objects.has(`meter:key:${keyId(hash)}`),
      "paid callers are limited per key",
    );
  });

  it("limits rejected keys per address before reading the key store", async () => {
    const { api } = innerApi();
    const e = env({ RL_ANON: new CountingLimit(60) });
    const bogus = `fl_live_${"A".repeat(43)}`;
    for (let i = 0; i < 60; i++)
      assert.equal(
        (await call(e, api, "/v1/calc/irr", { key: bogus })).status,
        401,
      );
    const reads = e.KEYS.reads;
    const blocked = await call(e, api, "/v1/calc/irr", { key: bogus });
    assert.equal(blocked.status, 429);
    assert.equal(e.KEYS.reads, reads, "no KV read once the budget is spent");
    assert.equal(
      (await call(e, api, "/v1/calc/irr")).status,
      200,
      "the same address without a key still works",
    );
  });

  it("answers a clean 503 ServiceUnavailable when the meter fails (fail closed)", async () => {
    const { api, seen } = innerApi();
    const broken: MeterService = {
      hit: async () => {
        throw new Error("DO down");
      },
      consume: async () => {
        throw new Error("DO down");
      },
      quota: async () => {
        throw new Error("DO down");
      },
      record: async () => {
        throw new Error("DO down");
      },
      usage: async () => {
        throw new Error("DO down");
      },
      lastUsed: async () => {
        throw new Error("DO down");
      },
      claim: async () => {
        throw new Error("DO down");
      },
      refund: async () => {
        throw new Error("DO down");
      },
    };
    const e = env({ METER: broken });
    const res = await call(e, api, "/v1/calc/irr");
    assert.equal(res.status, 503);
    assert.equal(
      ((await res.json()) as { error: string }).error,
      "ServiceUnavailable",
    );
    assert.equal(seen.length, 0, "nothing ran");
    const mcp = await call(e, api, "/mcp", { body: toolCall("calc_irr") });
    assert.equal(mcp.status, 503);
    assert.equal(
      ((await mcp.json()) as { error: { data: { error: string } } }).error.data
        .error,
      "ServiceUnavailable",
    );
  });

  it("escapes HTML", () => {
    assert.equal(
      escapeHtml(`<a href="x">'&`),
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;",
    );
  });
});

describe("registry quota", () => {
  /** Calls spread over minutes so the 60/min free limit never interferes. */
  async function spend(
    e: ReturnType<typeof env>,
    api: ReturnType<typeof innerApi>["api"],
    n: number,
    init: { key?: string; ip?: string } = {},
  ) {
    for (let i = 0; i < n; i++) {
      if (i % 50 === 49) e.clock.t += 60_000;
      const r = await call(e, api, "/v1/registry/get", {
        ...init,
        body: { urn: "x" },
      });
      assert.equal(r.status, 200, `lookup ${i + 1}`);
    }
  }

  it("free: 25 lookups per address per UTC day, then 429 RegistryQuotaExceeded; other tools keep working", async () => {
    const { api } = innerApi();
    const e = env();
    const first = await call(e, api, "/v1/registry/get", {
      body: { urn: "x" },
    });
    assert.equal(first.headers.get("x-factlot-registry-quota-limit"), "25");
    assert.equal(first.headers.get("x-factlot-registry-quota-remaining"), "24");
    assert.match(
      first.headers.get("access-control-expose-headers") ?? "",
      /x-factlot-registry-quota-remaining/,
      "browsers may read the quota headers",
    );
    assert.equal(
      first.headers.get("x-factlot-registry-quota-reset"),
      "2026-11-08T00:00:00.000Z",
    );
    await spend(e, api, 24);
    e.clock.t += 60_000;
    const over = await call(e, api, "/v1/registry/search_address", {
      body: {},
    });
    assert.equal(over.status, 429);
    assert.equal(over.headers.get("x-factlot-registry-quota-remaining"), "0");
    const retry = Number(over.headers.get("retry-after"));
    assert.equal(retry, (Date.UTC(2026, 10, 8) - e.clock.t) / 1000);
    const body = (await over.json()) as Record<string, unknown>;
    assert.equal(body.error, "RegistryQuotaExceeded");
    assert.equal(body.limit, 25);
    assert.equal(body.resets_at, "2026-11-08T00:00:00.000Z");
    assert.equal(body.upgrade, "https://factlot.com/#pricing");
    assert.match(String(body.message), /25 a day per IP address/);
    assert.match(String(body.message), /2026-11-08T00:00:00\.000Z/);
    assert.match(String(body.message), /Pro .*5,000.*Team .*100,000/);
    // Not counted, still answered: the discovery call and every other tool.
    const coverage = await call(e, api, "/v1/registry/coverage");
    assert.equal(coverage.status, 200);
    assert.equal(
      coverage.headers.get("x-factlot-registry-quota-remaining"),
      "0",
    );
    assert.equal((await call(e, api, "/v1/calc/irr")).status, 200);
    assert.equal(
      (await call(e, api, "/v1/calc/irr")).headers.get(
        "x-factlot-registry-quota-limit",
      ),
      null,
      "quota headers are for registry calls",
    );
    // The next UTC day starts fresh.
    e.clock.t = Date.UTC(2026, 10, 8, 0, 0, 0);
    assert.equal(
      (await call(e, api, "/v1/registry/get", { body: {} })).status,
      200,
    );
  });

  it("free: registry_coverage never counts", async () => {
    const { api } = innerApi();
    const e = env();
    for (let i = 0; i < 3; i++) await call(e, api, "/v1/registry/coverage");
    const r = await call(e, api, "/v1/registry/get", { body: {} });
    assert.equal(r.headers.get("x-factlot-registry-quota-remaining"), "24");
  });

  it("free: an IPv6 /64 shares one daily allowance", async () => {
    const { api } = innerApi();
    const e = env();
    await call(e, api, "/v1/registry/get", { ip: "2001:db8:1:2::1" });
    const other = await call(e, api, "/v1/registry/get", {
      ip: "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
    });
    assert.equal(other.headers.get("x-factlot-registry-quota-remaining"), "23");
    const elsewhere = await call(e, api, "/v1/registry/get", {
      ip: "2001:db8:1:3::1",
    });
    assert.equal(
      elsewhere.headers.get("x-factlot-registry-quota-remaining"),
      "24",
    );
  });

  it("pro: 5,000 lookups per calendar month, then 429 naming Team", async () => {
    const { api } = innerApi();
    const e = env();
    const { key } = await issue(e);
    e.limiter.object("meter:sub:sub_1").store.setCount("month:2026-11", 4_999);
    const last = await call(e, api, "/v1/registry/get", { key });
    assert.equal(last.status, 200);
    assert.equal(last.headers.get("x-factlot-registry-quota-limit"), "5000");
    assert.equal(last.headers.get("x-factlot-registry-quota-remaining"), "0");
    assert.equal(
      last.headers.get("x-factlot-registry-quota-reset"),
      "2026-12-01T00:00:00.000Z",
    );
    const over = await call(e, api, "/v1/registry/get", { key });
    assert.equal(over.status, 429);
    const body = (await over.json()) as { error: string; message: string };
    assert.equal(body.error, "RegistryQuotaExceeded");
    assert.match(body.message, /5,000 registry lookups for the month/);
    assert.match(body.message, /Team \(100,000 a month\) lifts the cap/);
    assert.equal((await call(e, api, "/v1/calc/irr", { key })).status, 200);
    e.clock.t = Date.UTC(2026, 11, 1);
    assert.equal(
      (await call(e, api, "/v1/registry/get", { key })).status,
      200,
      "new month",
    );
  });

  it("team: 100,000 a month shared by the subscription's keys; minute limits stay per key", async () => {
    const { api } = innerApi();
    const e = env();
    const a = await issue(e, { plan: "team", subscription: "sub_t" });
    const b = await issue(e, { plan: "team", subscription: "sub_t" });
    e.limiter.object("meter:sub:sub_t").store.setCount("month:2026-11", 99_999);
    assert.equal(
      (await call(e, api, "/v1/registry/get", { key: a.key })).status,
      200,
    );
    const over = await call(e, api, "/v1/registry/get", { key: b.key });
    assert.equal(over.status, 429);
    assert.match(
      ((await over.json()) as { message: string }).message,
      /largest plan/,
    );
    assert.ok(e.limiter.objects.has(`meter:key:${keyId(a.hash)}`));
    assert.ok(e.limiter.objects.has(`meter:key:${keyId(b.hash)}`));
  });

  it("MCP: an over-quota registry call is a tool error (isError), not a transport failure", async () => {
    const { api, seen } = innerApi();
    const e = env();
    const { key } = await issue(e);
    e.limiter.object("meter:sub:sub_1").store.setCount("month:2026-11", 5_000);
    const res = await call(e, api, "/mcp", {
      key,
      body: toolCall("registry_get", 7),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "0");
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    const msg = (await res.json()) as {
      id: number;
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(msg.id, 7);
    assert.equal(msg.result.isError, true);
    const err = JSON.parse(msg.result.content[0]!.text) as {
      error: string;
      resets_at: string;
    };
    assert.equal(err.error, "RegistryQuotaExceeded");
    assert.equal(err.resets_at, "2026-12-01T00:00:00.000Z");
    assert.equal(seen.length, 0, "the inner handler never ran the call");
    // Other tools, and registry_coverage, still run over MCP.
    const calc = await call(e, api, "/mcp", {
      key,
      body: toolCall("calc_irr", 8),
    });
    assert.equal(((await calc.json()) as { id: number }).id, 8);
    const cov = await call(e, api, "/mcp", {
      key,
      body: toolCall("registry_coverage", 9),
    });
    assert.equal(
      ((await cov.json()) as { result: { isError?: boolean } }).result.isError,
      undefined,
    );
  });

  it("MCP batch: runs what fits, answers the rest as tool errors, keeps other calls", async () => {
    const { api, seen } = innerApi();
    const e = env();
    const { key } = await issue(e);
    e.limiter.object("meter:sub:sub_1").store.setCount("month:2026-11", 4_999);
    const res = await call(e, api, "/mcp", {
      key,
      body: [
        toolCall("registry_get", 1),
        toolCall("registry_owned_by", 2),
        toolCall("calc_irr", 3),
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ],
    });
    assert.equal(res.status, 200);
    const forwarded = JSON.parse(seen[0]!.body) as { id?: number }[];
    assert.deepEqual(
      forwarded.map((m) => m.id),
      [1, 3, undefined],
      "the call that fits, the calculator and the notification went through",
    );
    const answers = (await res.json()) as {
      id: number;
      result: { isError?: boolean };
    }[];
    assert.deepEqual(
      answers.map((a) => [a.id, a.result.isError ?? false]),
      [
        [1, false],
        [3, false],
        [2, true],
      ],
    );
    assert.equal(
      e.limiter.object("meter:sub:sub_1").store.counts.get("month:2026-11"),
      5_000,
    );
  });
});

describe("checkout gate", () => {
  const stripe = () =>
    fakeStripe({
      "GET /prices": () => [200, { data: [{ id: "price_pro" }] }],
      "POST /checkout/sessions": () => [
        200,
        { url: "https://checkout.stripe.com/c/pay/cs_live_x" },
      ],
    });
  const closedText =
    "Paid plans open shortly. Email contact@factlot.com to be told when they do.";

  for (const [label, secret] of [
    ["no key", undefined],
    ["a test secret key", "sk_test_x"],
    ["a test restricted key", "rk_test_x"],
  ] as const)
    it(`is closed with ${label}: 503 CheckoutClosed, and /v1/plans says so`, async () => {
      const s = stripe();
      const e = env(secret ? { STRIPE_SECRET_KEY: secret } : {});
      const opts = { fetchImpl: s.fetchImpl, now: () => T0 };
      const { api } = innerApi();
      const res = await handle(
        new Request("https://api.factlot.com/v1/billing/checkout", {
          method: "POST",
          body: '{"plan":"pro"}',
        }),
        e,
        api,
        opts,
      );
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), {
        error: "CheckoutClosed",
        code: "CheckoutClosed",
        message: closedText,
        next: "mailto:contact@factlot.com",
      });
      const page = await handle(
        new Request("https://factlot.com/billing/checkout?plan=pro"),
        e,
        api,
        opts,
      );
      assert.equal(page.status, 503);
      assert.ok((await page.text()).includes(escapeHtml(closedText)));
      assert.equal(s.calls.length, 0, "Stripe is never asked");
      const plans = (await (
        await call(e, api, "/v1/plans", { method: "GET" })
      ).json()) as { checkout_open: boolean };
      assert.equal(plans.checkout_open, false);
    });

  it("is open with a live key: the page redirects to Stripe and agents get the URL", async () => {
    const s = stripe();
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    const opts = { fetchImpl: s.fetchImpl, now: () => T0 };
    const { api } = innerApi();
    const page = await handle(
      new Request("https://factlot.com/billing/checkout?plan=pro"),
      e,
      api,
      opts,
    );
    assert.equal(page.status, 303);
    assert.equal(
      page.headers.get("location"),
      "https://checkout.stripe.com/c/pay/cs_live_x",
    );
    const agent = await handle(
      new Request("https://api.factlot.com/v1/billing/checkout", {
        method: "POST",
        body: '{"plan":"team"}',
      }),
      e,
      api,
      opts,
    );
    assert.equal(agent.status, 200);
    assert.equal(
      ((await agent.json()) as { url: string }).url,
      "https://checkout.stripe.com/c/pay/cs_live_x",
    );
    const plans = (await (
      await call(e, api, "/v1/plans", { method: "GET" })
    ).json()) as { checkout_open: boolean };
    assert.equal(plans.checkout_open, true);
  });

  it("a test key still serves existing customers: portal, account and rotation", async () => {
    const s = fakeStripe({
      "POST /billing_portal/sessions": () => [
        200,
        { url: "https://billing.stripe.com/p/session/x" },
      ],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_test_x" });
    const { key } = await issue(e);
    const { api } = innerApi();
    const opts = { fetchImpl: s.fetchImpl, now: () => T0 };
    const portal = await handle(
      new Request("https://api.factlot.com/v1/billing/portal", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
      }),
      e,
      api,
      opts,
    );
    assert.equal(portal.status, 200);
    assert.equal(
      (await call(e, api, "/v1/account", { key, method: "GET" })).status,
      200,
    );
    assert.equal(
      (await call(e, api, "/v1/billing/rotate", { key })).status,
      200,
    );
  });
});

describe("accounts and keys", () => {
  it("/v1/account reports plan, registry lookups and keys", async () => {
    const { api } = innerApi();
    const e = env();
    const { key, hash } = await issue(e);
    await call(e, api, "/v1/registry/get", { key });
    await call(e, api, "/v1/registry/coverage", { key });
    const acct = (await (
      await call(e, api, "/v1/account", { key, method: "GET" })
    ).json()) as Record<string, unknown>;
    assert.equal(acct.plan, "pro");
    assert.equal(acct.status, "active");
    assert.equal(acct.requests_per_minute, 600);
    assert.deepEqual(acct.registry_lookups, {
      used: 1,
      limit: 5_000,
      resets_at: "2026-12-01T00:00:00.000Z",
    });
    assert.deepEqual(acct.keys, {
      count: 1,
      limit: 1,
      items: [
        {
          id: keyId(hash),
          created: "2026-11-03T00:00:00Z",
          current: true,
          // This very request used the key (stored to the minute).
          last_used_at: "2026-11-07T12:00:00.000Z",
        },
      ],
    });
    assert.match(String(acct.data_retention), /365 days/);
    assert.equal(acct.deletes_at, undefined);
  });

  it("an inactive key can read its account and open the portal, but not call tools or change keys", async () => {
    const s = fakeStripe({
      "POST /billing_portal/sessions": (b) => {
        assert.equal(b.get("customer"), "cus_1");
        assert.equal(b.get("return_url"), "https://factlot.com/account");
        return [200, { url: "https://billing.stripe.com/p/session/y" }];
      },
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    const { key } = await issue(e, { stripe_status: "unpaid" });
    const { api, seen } = innerApi();
    const opts = { fetchImpl: s.fetchImpl, now: () => T0 };
    const req = (path: string, method = "POST") =>
      handle(
        new Request(`https://api.factlot.com${path}`, {
          method,
          headers: { authorization: `Bearer ${key}` },
        }),
        e,
        api,
        opts,
      );
    const acct = await req("/v1/account", "GET");
    assert.equal(acct.status, 200);
    const a = (await acct.json()) as { status: string; deletes_at?: string };
    assert.equal(a.status, "inactive");
    assert.equal(
      a.deletes_at,
      new Date(T0 + INACTIVE_RETENTION_SECONDS * 1000).toISOString(),
    );
    const portal = await req("/v1/billing/portal");
    assert.equal(portal.status, 200);
    assert.equal(
      ((await portal.json()) as { url: string }).url,
      "https://billing.stripe.com/p/session/y",
    );
    const tool = await req("/v1/calc/irr");
    assert.equal(tool.status, 403);
    const err = (await tool.json()) as { error: string; message: string };
    assert.equal(err.error, "SubscriptionInactive");
    assert.match(err.message, /factlot\.com\/account/);
    assert.equal((await req("/v1/billing/rotate")).status, 403);
    assert.equal((await req("/v1/billing/keys")).status, 403);
    assert.equal(seen.length, 0);
  });

  it("team mints up to 5 keys, lists them, revokes one but never the last", async () => {
    const { api } = innerApi();
    const e = env();
    const first = await issue(e, { plan: "team" });
    const minted: { key: string; id: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await call(e, api, "/v1/billing/keys", { key: first.key });
      assert.equal(r.status, 201);
      minted.push((await r.json()) as { key: string; id: string });
    }
    const sixth = await call(e, api, "/v1/billing/keys", { key: first.key });
    assert.equal(sixth.status, 409);
    assert.equal(
      ((await sixth.json()) as { error: string }).error,
      "KeyLimitReached",
    );
    // Every minted key works.
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: minted[3]!.key })).status,
      200,
    );
    const acct = (await (
      await call(e, api, "/v1/account", { key: first.key, method: "GET" })
    ).json()) as {
      keys: { count: number; limit: number; items: { id: string }[] };
    };
    assert.equal(acct.keys.count, 5);
    assert.equal(acct.keys.limit, 5);
    assert.deepEqual(
      acct.keys.items.map((k) => k.id).sort(),
      [keyId(first.hash), ...minted.map((m) => m.id)].sort(),
    );
    // Revoke the minted keys, then the last one is refused.
    for (const m of minted) {
      const r = await call(e, api, `/v1/billing/keys/${m.id}`, {
        key: first.key,
        method: "DELETE",
      });
      assert.equal(r.status, 200);
    }
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: minted[0]!.key })).status,
      401,
    );
    const last = await call(e, api, `/v1/billing/keys/${keyId(first.hash)}`, {
      key: first.key,
      method: "DELETE",
    });
    assert.equal(last.status, 409);
    assert.equal(
      (
        await call(e, api, "/v1/billing/keys/0000000000000000", {
          key: first.key,
          method: "DELETE",
        })
      ).status,
      404,
    );
  });

  it("pro holds one key: minting is refused, rotation replaces it", async () => {
    const { api } = innerApi();
    const e = env();
    const { key } = await issue(e);
    assert.equal((await call(e, api, "/v1/billing/keys", { key })).status, 409);
    const rotated = (await (
      await call(e, api, "/v1/billing/rotate", { key })
    ).json()) as {
      key: string;
    };
    assert.equal((await call(e, api, "/v1/calc/irr", { key })).status, 401);
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: rotated.key })).status,
      200,
    );
    const acct = (await (
      await call(e, api, "/v1/account", { key: rotated.key, method: "GET" })
    ).json()) as { keys: { count: number } };
    assert.equal(acct.keys.count, 1);
  });

  it("rotation and new keys share the subscription's monthly lookups", async () => {
    const { api } = innerApi();
    const e = env();
    const { key } = await issue(e);
    await call(e, api, "/v1/registry/get", { key });
    const rotated = (await (
      await call(e, api, "/v1/billing/rotate", { key })
    ).json()) as {
      key: string;
    };
    const r = await call(e, api, "/v1/registry/get", { key: rotated.key });
    assert.equal(r.headers.get("x-factlot-registry-quota-remaining"), "4998");
  });
});

describe("pages", () => {
  it("the key page links to /account and states the renewal terms", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [
        200,
        {
          status: "complete",
          payment_status: "paid",
          mode: "subscription",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: { factlot_plan: "pro" },
        },
      ],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_test_x" });
    const res = await successRoute(
      e,
      new URL(`https://factlot.com/billing/success?session_id=${SESSION}`),
      s.fetchImpl,
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(
      html,
      /href="https:\/\/factlot\.com\/account">Manage billing \/ cancel</,
    );
    assert.match(
      html,
      /Your key can take up to a minute to activate everywhere/,
    );
    assert.match(
      html,
      /\$49 a month, renews monthly until cancelled; cancel any time at <a href="https:\/\/factlot\.com\/account">factlot\.com\/account<\/a>/,
    );
  });

  const form = (
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    new Request("https://factlot.com/account", {
      method: "POST",
      body: new URLSearchParams(body).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://factlot.com",
        "cf-connecting-ip": IP,
        ...headers,
      },
    });

  it("/account: a key form (POST only), then plan, usage and keys", async () => {
    const { api } = innerApi();
    const e = env({ ASSETS: { fetch: async () => new Response("site") } });
    e.RL_ANON = new CountingLimit(100);
    const get = await handle(
      new Request("https://factlot.com/account"),
      e,
      api,
    );
    assert.equal(get.status, 200);
    const html = await get.text();
    assert.match(html, /<form method="post" action="\/account">/);
    assert.match(html, /type="password"/);
    assert.match(
      get.headers.get("content-security-policy") ?? "",
      /form-action 'self' https:\/\/billing\.stripe\.com/,
    );
    assert.equal(get.headers.get("cache-control"), "no-store");
    const { key } = await issue(e, { plan: "team" });
    const view = await handle(form({ key }), e, api, { now: () => T0 });
    assert.equal(view.status, 200);
    const page = await view.text();
    assert.match(page, /FactLot Team/);
    assert.match(page, /0 of 100,000 used this month/);
    assert.match(page, /3,000 requests a minute per key/);
    assert.match(page, /value="portal"/);
    assert.match(page, /value="mint"/);
    const unknown = await handle(
      form({ key: `fl_live_${"B".repeat(43)}` }),
      e,
      api,
    );
    assert.equal(unknown.status, 401);
    assert.match(await unknown.text(), /That key was not found/);
    const foreign = await handle(
      form({ key }, { origin: "https://evil.example" }),
      e,
      api,
    );
    assert.equal(foreign.status, 403);
  });

  it("/account: the billing button redirects to the Stripe portal; new keys are shown once", async () => {
    const s = fakeStripe({
      "POST /billing_portal/sessions": () => [
        200,
        { url: "https://billing.stripe.com/p/session/z" },
      ],
    });
    const { api } = innerApi();
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { key } = await issue(e, { plan: "team" });
    const opts = { fetchImpl: s.fetchImpl, now: () => T0 };
    const portal = await handle(form({ key, action: "portal" }), e, api, opts);
    assert.equal(portal.status, 303);
    assert.equal(
      portal.headers.get("location"),
      "https://billing.stripe.com/p/session/z",
    );
    const mint = await handle(form({ key, action: "mint" }), e, api, opts);
    const html = await mint.text();
    const shown = html.match(
      /<pre class="key" id="new-key">(fl_live_[A-Za-z0-9_-]{43})<\/pre>/,
    )?.[1];
    assert.ok(shown, "the new key is on the page");
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: shown })).status,
      200,
    );
    const rotate = await handle(form({ key, action: "rotate" }), e, api, opts);
    assert.match(await rotate.text(), /previous key no longer works/);
    assert.equal((await call(e, api, "/v1/calc/irr", { key })).status, 401);
    assert.equal(PLANS.team.maxKeys, 5);
  });
});

/** A Durable Object state over real SQLite; deleteAll drops the tables, as Cloudflare's does. */
async function sqliteState() {
  const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (p: string) => {
      prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] };
      exec(q: string): void;
    };
  };
  const db = new DatabaseSync(":memory:");
  let alarm: number | null = null;
  const tables = () =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => String(r.name));
  const state = {
    storage: {
      sql: {
        exec: (q: string, ...b: (string | number)[]) => {
          const rows = db.prepare(q).all(...b);
          return { toArray: () => rows };
        },
      },
      getAlarm: async () => alarm,
      setAlarm: async (t: number) => {
        alarm = t;
      },
      deleteAll: async () => {
        for (const t of tables()) db.exec(`DROP TABLE "${t}"`);
        alarm = null;
      },
    },
  };
  return { state, tables, alarm: () => alarm };
}

let sqliteAvailable = true;
try {
  await import("node:sqlite");
} catch {
  sqliteAvailable = false;
}

describe("review fixes", () => {
  const hitReq = (n: number) =>
    new Request("https://limiter/hit", {
      method: "POST",
      body: JSON.stringify({
        perMinute: 60,
        quota: { kind: "day", limit: 100, n },
      }),
    });

  it(
    "a resident object keeps counting after its alarm wiped the storage (SQLite)",
    { skip: !sqliteAvailable },
    async () => {
      const clock = { t: T0 };
      const sql = await sqliteState();
      const obj = new RateLimiterObject(sql.state, {}, { now: () => clock.t });
      const first = (await (await obj.fetch(hitReq(1))).json()) as {
        granted: number;
      };
      assert.equal(first.granted, 1);
      assert.equal(sql.alarm(), Date.UTC(2026, 10, 8));
      clock.t = Date.UTC(2026, 10, 8, 0, 0, 1);
      await obj.alarm();
      assert.deepEqual(sql.tables(), [], "deleteAll dropped the tables");
      const again = await obj.fetch(hitReq(1));
      assert.equal(again.status, 200);
      const body = (await again.json()) as {
        granted: number;
        quota: { used: number };
      };
      assert.equal(body.granted, 1);
      assert.equal(body.quota.used, 1, "a new day's count");
      const quota = await obj.fetch(
        new Request("https://limiter/quota", {
          method: "POST",
          body: JSON.stringify({ kind: "month", limit: 5 }),
        }),
      );
      assert.equal(quota.status, 200);
    },
  );

  it(
    "an object touched without counting (coverage, over the cap) still empties at the window end",
    { skip: !sqliteAvailable },
    async () => {
      const clock = { t: T0 };
      const sql = await sqliteState();
      const obj = new RateLimiterObject(sql.state, {}, { now: () => clock.t });
      await obj.fetch(hitReq(0));
      assert.ok(sql.tables().length > 0, "the read created the tables");
      assert.equal(sql.alarm(), Date.UTC(2026, 10, 8), "and scheduled cleanup");
      clock.t = Date.UTC(2026, 10, 8, 0, 0, 1);
      await obj.alarm();
      assert.deepEqual(sql.tables(), []);
    },
  );

  it("a re-check never erases a hold, revocation or rotation written while Stripe answered", async () => {
    const s = fakeStripe({
      "GET /subscriptions/sub_1": () => [200, { status: "active" }],
    });
    const e = env({ STRIPE_SECRET_KEY: "rk_test_x" });
    const stale = record({ checked_at: 0 });
    await writeKey(e.KEYS, "h", { ...stale, hold: "refunded" }, T0);
    const d = billingDeps(e, s.fetchImpl, () => T0 + RECHECK_MS)!;
    const next = await refreshIfStale(d, "h", stale);
    assert.equal(next.hold, "refunded");
    assert.equal(next.status, "inactive");
    assert.equal((await readKey(e.KEYS, "h"))?.hold, "refunded");

    await writeKey(
      e.KEYS,
      "r",
      { ...stale, revoked_at: "2026-11-07T00:00:00.000Z" },
      T0,
    );
    const before = e.KEYS.data.get("key:r");
    const revoked = await refreshIfStale(d, "r", stale);
    assert.equal(revoked.status, "inactive");
    assert.equal(e.KEYS.data.get("key:r"), before, "a dead key is not written");
  });

  it("pins the Stripe API version and logs Stripe's status and message on failure", async (t) => {
    const headers: Headers[] = [];
    const fetchImpl = (async (_: string | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return new Response(
        JSON.stringify({
          error: { message: "No configuration provided for the portal" },
        }),
        { status: 400 },
      );
    }) as typeof fetch;
    const logged: string[] = [];
    t.mock.method(console, "error", (line: string) => logged.push(line));
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    const { key } = await issue(e);
    const { api } = innerApi();
    const res = await handle(
      new Request("https://api.factlot.com/v1/billing/portal", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
      }),
      e,
      api,
      { fetchImpl, now: () => T0 },
    );
    assert.equal(res.status, 502);
    assert.equal(headers[0]?.get("stripe-version"), STRIPE_API_VERSION);
    assert.equal(STRIPE_API_VERSION, "2026-07-29.dahlia");
    const entry = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    assert.equal(entry.where, "portal session");
    assert.equal(entry.status, 400);
    assert.match(String(entry.error), /No configuration provided/);
  });

  it("MCP quota answers carry CORS headers (all denied, and a mixed batch)", async () => {
    const { api } = innerApi();
    const e = env();
    const { key } = await issue(e);
    e.limiter.object("meter:sub:sub_1").store.setCount("month:2026-11", 5_000);
    const all = await call(e, api, "/mcp", {
      key,
      body: toolCall("registry_get"),
    });
    assert.equal(all.headers.get("access-control-allow-origin"), "*");
    const mixed = await call(e, api, "/mcp", {
      key,
      body: [toolCall("registry_get", 1), toolCall("calc_irr", 2)],
    });
    assert.equal(mixed.headers.get("access-control-allow-origin"), "*");
  });

  it("refuses an MCP batch over 20 messages before metering anything", async () => {
    const { api, seen } = innerApi();
    const e = env();
    const batch = Array.from({ length: 21 }, (_, i) =>
      toolCall("registry_get", i),
    );
    const res = await call(e, api, "/mcp", { body: batch });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: number } };
    assert.equal(body.error.code, -32600);
    assert.equal(e.limiter.objects.size, 0, "no meter was touched");
    assert.equal(seen.length, 0);
  });

  it("gives back a lookup the registry could not answer (REST 503, MCP RegistryUnavailable)", async () => {
    const { api } = innerApi({ registryDown: true });
    const e = env();
    const rest = await call(e, api, "/v1/registry/get", { body: {} });
    assert.equal(rest.status, 503);
    assert.equal(rest.headers.get("x-factlot-registry-quota-remaining"), "25");
    const anon = [...e.limiter.objects.entries()].find(([n]) =>
      n.startsWith("meter:ip:"),
    )![1];
    assert.equal(anon.store.counts.get("day:2026-11-07"), 0);

    const { key } = await issue(e);
    const mcp = await call(e, api, "/mcp", {
      key,
      body: [
        toolCall("registry_get", 1),
        toolCall("registry_owned_by", 2),
        toolCall("calc_irr", 3),
      ],
    });
    assert.equal(mcp.status, 200);
    assert.equal(mcp.headers.get("x-factlot-registry-quota-remaining"), "5000");
    assert.equal(
      e.limiter.object("meter:sub:sub_1").store.counts.get("month:2026-11"),
      0,
    );
    const answers = (await mcp.json()) as { id: number }[];
    assert.equal(answers.length, 3, "the answers are passed on unchanged");
  });

  it("salts the address hash with the IP_HASH_SALT secret", async () => {
    const ip = "198.51.100.20";
    const a = await addressSubject(ip, T0, "secret-one");
    assert.notEqual(a, await addressSubject(ip, T0, "secret-two"));
    assert.notEqual(a, await addressSubject(ip, T0));
    assert.equal(a, await addressSubject(ip, T0, "secret-one"));
  });

  it("a downgrade to Pro keeps the oldest key and revokes the rest", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const keys = [];
    for (const day of ["01", "02", "03"])
      keys.push(
        await issue(e, {
          plan: "team",
          created: `2026-11-${day}T00:00:00.000Z`,
        }),
      );
    const res = await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: 100,
        data: {
          object: {
            id: "sub_1",
            status: "active",
            items: {
              data: [{ price: { lookup_key: "factlot_pro_monthly_v1" } }],
            },
          },
        },
      }),
      () => T0,
    );
    assert.equal(
      ((await res.json()) as { keys_revoked: number }).keys_revoked,
      2,
    );
    const { api } = innerApi();
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: keys[0]!.key })).status,
      200,
    );
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: keys[2]!.key })).status,
      401,
    );
  });
});

describe("WindowCounter", () => {
  it("allows exactly `limit` hits per window and resets on the next window", () => {
    const c = new WindowCounter();
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 60; i++) assert.equal(c.hit(60, 60_000, t0 + i), true);
    assert.equal(c.peek(60, 60_000, t0 + 99), false);
    assert.equal(c.hit(60, 60_000, t0 + 100), false);
    assert.equal(c.peek(60, 60_000, t0 + 60_000), true);
    assert.equal(c.hit(60, 60_000, t0 + 60_000), true);
  });
});

describe("registry runner", () => {
  it("posts the tool and checked input to the registry service and returns its outcome", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const service = {
      async fetch(r: Request) {
        seen.push({ url: r.url, body: await r.json() });
        return new Response(JSON.stringify({ ok: true, result: { n: 1 } }));
      },
    };
    const run = registryRunner(service);
    assert.deepEqual(await run("registry_coverage", {}), {
      ok: true,
      result: { n: 1 },
    });
    assert.deepEqual(seen, [
      {
        url: REGISTRY_RUN_URL,
        body: { tool: "registry_coverage", input: {} },
      },
    ]);
  });

  it("throws on a failed or malformed answer so the catalog reports RegistryUnavailable", async () => {
    const failing = registryRunner({
      fetch: async () => new Response("no", { status: 503 }),
    });
    await assert.rejects(failing("registry_coverage", {}));
    const malformed = registryRunner({
      fetch: async () => new Response(JSON.stringify({ hello: 1 })),
    });
    await assert.rejects(malformed("registry_coverage", {}));
  });
});

// --- Onboarding: agent claims, the onboarding page, recovery by email ---------------------------

/** A fake Email Service binding that records what it sends. */
function fakeEmail(fail?: string) {
  const sent: { to: string; subject: string; text: string; html?: string }[] =
    [];
  return {
    sent,
    binding: {
      send: async (m: {
        to: unknown;
        subject: string;
        text: string;
        html?: string;
      }) => {
        if (fail) throw Object.assign(new Error("send failed"), { code: fail });
        sent.push({
          to: String(m.to),
          subject: m.subject,
          text: m.text,
          html: m.html,
        });
        return { messageId: `m${sent.length}` };
      },
    },
  };
}

/** Run `handle` collecting the work it defers (emails), and wait for it. */
async function run(
  e: ReturnType<typeof env>,
  request: Request,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const deferred: Promise<unknown>[] = [];
  const { api } = innerApi();
  const res = await handle(request, e, api, {
    fetchImpl,
    now: () => e.clock.t,
    waitUntil: (p) => deferred.push(p),
  });
  await Promise.all(deferred);
  return res;
}

/** Everything the Worker writes to the console while `fn` runs. */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  const grab = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.log = console.warn = console.error = console.info = grab;
  try {
    await fn();
  } finally {
    Object.assign(console, orig);
  }
  return lines.join("\n");
}

describe("agent claim flow", () => {
  const paid = {
    id: SESSION,
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    subscription: "sub_1",
    customer: "cus_1",
    customer_details: { email: "buyer@example.com" },
    metadata: { factlot_plan: "pro" },
  };
  function stripe(state: { session: Record<string, unknown> }) {
    let checkoutBody: URLSearchParams | undefined;
    const s = fakeStripe({
      "GET /prices": () => [200, { data: [{ id: "price_pro" }] }],
      "POST /checkout/sessions": (b) => {
        checkoutBody = b;
        return [
          200,
          { id: SESSION, url: `https://checkout.stripe.com/c/pay/${SESSION}` },
        ];
      },
      [`GET /checkout/sessions/${SESSION}`]: () => [200, state.session],
    });
    return { ...s, body: () => checkoutBody };
  }
  const open = { ...paid, status: "open", payment_status: "unpaid" };

  async function start(e: ReturnType<typeof env>, fetchImpl: typeof fetch) {
    const res = await run(
      e,
      new Request("https://api.factlot.com/v1/billing/checkout", {
        method: "POST",
        body: '{"plan":"pro"}',
        headers: { "cf-connecting-ip": IP },
      }),
      fetchImpl,
    );
    assert.equal(res.status, 200);
    return (await res.json()) as {
      url: string;
      claim_url: string;
      expires_at: string;
    };
  }
  const poll = (e: ReturnType<typeof env>, url: string, f: typeof fetch) =>
    run(e, new Request(url, { headers: { "cf-connecting-ip": IP } }), f);

  it("checkout returns url, claim_url and expires_at; only the token's hash is stored", async () => {
    const state = { session: open as Record<string, unknown> };
    const s = stripe(state);
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const out = await start(e, s.fetchImpl);
    assert.equal(out.url, `https://checkout.stripe.com/c/pay/${SESSION}`);
    const m = out.claim_url.match(
      /^https:\/\/api\.factlot\.com\/v1\/billing\/claim\/([A-Za-z0-9_-]{43})$/,
    );
    assert.ok(m, out.claim_url);
    const token = m[1]!;
    assert.equal(Date.parse(out.expires_at), T0 + 3600_000);
    const hash = await hashKey(token);
    assert.equal(s.body()?.get("metadata[factlot_claim]"), hash.slice(0, 16));
    assert.equal(s.body()?.get("expires_at"), String(T0 / 1000 + 3600));
    const stored = JSON.parse(e.KEYS.data.get(`claim:${hash}`)!);
    assert.equal(stored.session, SESSION);
    assert.equal(e.KEYS.ttl.get(`claim:${hash}`), 3600 + 900);
    for (const [k, v] of e.KEYS.data)
      assert.ok(!k.includes(token) && !v.includes(token), "no plaintext token");
  });

  it("pending until paid, the key once, then 410 by agent; the success page then has no key", async () => {
    const state = { session: open as Record<string, unknown> };
    const s = stripe(state);
    const mail = fakeEmail();
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x", EMAIL: mail.binding });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    const pending = await poll(e, claim_url, s.fetchImpl);
    assert.equal(pending.status, 202);
    assert.equal(
      ((await pending.json()) as { status: string }).status,
      "pending",
    );
    assert.equal(pending.headers.get("retry-after"), "2");
    state.session = paid;
    e.clock.t += CLAIM_POLL_MS;
    const got = await poll(e, claim_url, s.fetchImpl);
    assert.equal(got.status, 200);
    const body = (await got.json()) as Record<string, unknown>;
    assert.ok(looksLikeKey(String(body.key)));
    assert.equal(body.plan, "pro");
    assert.equal(body.plan_name, "FactLot Pro");
    assert.equal(body.requests_per_minute, 600);
    assert.equal(body.registry_lookups_per_month, 5000);
    assert.equal(body.account, "https://factlot.com/account");
    assert.equal(body.mcp, "https://api.factlot.com/mcp");
    assert.equal(
      (await call(e, innerApi().api, "/v1/calc/irr", { key: String(body.key) }))
        .status,
      200,
    );
    e.clock.t += CLAIM_POLL_MS;
    const again = await poll(e, claim_url, s.fetchImpl);
    assert.equal(again.status, 410);
    assert.deepEqual(
      ((await again.json()) as { status: string; by: string }).by,
      "agent",
    );
    const page = await run(
      e,
      new Request(`https://factlot.com/billing/success?session_id=${SESSION}`, {
        headers: { "cf-connecting-ip": IP },
      }),
      s.fetchImpl,
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Your agent already collected this key/);
    assert.doesNotMatch(html, /fl_live_[A-Za-z0-9_-]{43}/);
    assert.match(html, /&lt;your key&gt;/);
    assert.equal(mail.sent.length, 1, "one welcome email, on the redemption");
    assert.ok(!mail.sent[0]!.text.includes(String(body.key)));
  });

  it("the page first: a later agent claim gets 410 by page", async () => {
    const s = stripe({ session: paid });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    const page = await run(
      e,
      new Request(`https://factlot.com/billing/success?session_id=${SESSION}`, {
        headers: { "cf-connecting-ip": IP },
      }),
      s.fetchImpl,
    );
    assert.match(await page.text(), /<pre id="key"><code>fl_live_/);
    const res = await poll(e, claim_url, s.fetchImpl);
    assert.equal(res.status, 410);
    const b = (await res.json()) as Record<string, unknown>;
    assert.equal(b.status, "claimed");
    assert.equal(b.by, "page");
    assert.ok(b.next, "tells the agent what to do next");
  });

  it("the page and the agent at the same moment: exactly one key", async () => {
    const s = stripe({ session: paid });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    const [a, p] = await Promise.all([
      poll(e, claim_url, s.fetchImpl),
      run(
        e,
        new Request(
          `https://factlot.com/billing/success?session_id=${SESSION}`,
        ),
        s.fetchImpl,
      ),
    ]);
    const shown = [
      a.status === 200,
      /<pre id="key">/.test(await p.text()),
    ].filter(Boolean);
    assert.equal(shown.length, 1);
    assert.equal(
      [...e.KEYS.data.keys()].filter((k) => k.startsWith("key:")).length,
      1,
    );
  });

  it("404 for an unknown or malformed token and for an expired, unpaid claim", async () => {
    const state = { session: open as Record<string, unknown> };
    const s = stripe(state);
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    const unknown = await poll(
      e,
      `https://api.factlot.com/v1/billing/claim/${"A".repeat(43)}`,
      s.fetchImpl,
    );
    assert.equal(unknown.status, 404);
    const bad = await poll(
      e,
      "https://api.factlot.com/v1/billing/claim/short",
      s.fetchImpl,
    );
    assert.equal(bad.status, 404);
    e.clock.t += 3600_000 + 1000;
    state.session = { ...open, status: "expired" };
    const expired = await poll(e, claim_url, s.fetchImpl);
    assert.equal(expired.status, 404);
    // Once KV drops the record (after the grace), it is unknown too.
    e.KEYS.data.clear();
    e.clock.t += CLAIM_POLL_MS;
    assert.equal((await poll(e, claim_url, s.fetchImpl)).status, 404);
  });

  it("a payment finished just before expiry is still collected during the grace", async () => {
    const s = stripe({ session: paid });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    e.clock.t += 3600_000 + 60_000;
    assert.equal((await poll(e, claim_url, s.fetchImpl)).status, 200);
  });

  it("rate-limits polling to one request per 2 seconds per token, and per address", async () => {
    const s = stripe({ session: open });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    assert.equal((await poll(e, claim_url, s.fetchImpl)).status, 202);
    const fast = await poll(e, claim_url, s.fetchImpl);
    assert.equal(fast.status, 429);
    assert.equal(fast.headers.get("retry-after"), "2");
    e.clock.t += CLAIM_POLL_MS;
    assert.equal((await poll(e, claim_url, s.fetchImpl)).status, 202);
    e.RL_ANON = new CountingLimit(0);
    e.clock.t += CLAIM_POLL_MS;
    assert.equal((await poll(e, claim_url, s.fetchImpl)).status, 429);
  });

  it("never logs the claim token or the key, even when Stripe fails", async () => {
    const state = { session: paid as Record<string, unknown> };
    let fail = true;
    const s = fakeStripe({
      "GET /prices": () => [200, { data: [{ id: "price_pro" }] }],
      "POST /checkout/sessions": () => [
        200,
        { id: SESSION, url: "https://checkout.stripe.com/c/pay/x" },
      ],
      [`GET /checkout/sessions/${SESSION}`]: () =>
        fail ? [500, { error: { message: "boom" } }] : [200, state.session],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    let token = "";
    let key = "";
    const logs = await captureLogs(async () => {
      const { claim_url } = await start(e, s.fetchImpl);
      token = claim_url.split("/").pop()!;
      assert.equal((await poll(e, claim_url, s.fetchImpl)).status, 502);
      fail = false;
      e.clock.t += CLAIM_POLL_MS;
      key = String(
        (
          (await (await poll(e, claim_url, s.fetchImpl)).json()) as {
            key: string;
          }
        ).key,
      );
    });
    assert.ok(logs.includes("stripe call failed"), "the failure is logged");
    assert.ok(!logs.includes(token), "no token in logs");
    assert.ok(!logs.includes(key), "no key in logs");
  });

  it("documents the checkout object in the API root and /v1/plans", async () => {
    const e = env();
    const { api } = innerApi();
    for (const path of ["/", "/v1/plans"]) {
      const body = (await (
        await call(e, api, path, { method: "GET" })
      ).json()) as {
        checkout: {
          method: string;
          url: string;
          claim: Record<string, string>;
        };
      };
      assert.equal(body.checkout.method, "POST");
      assert.equal(
        body.checkout.url,
        "https://api.factlot.com/v1/billing/checkout",
      );
      assert.match(body.checkout.claim.claimed!, /410/);
    }
  });
});

describe("onboarding page", () => {
  const paidSession = {
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    subscription: "sub_1",
    customer: "cus_1",
    metadata: { factlot_plan: "team" },
  };

  it("shows the key once with copy buttons, per-client setup with the real key, and a key test", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paidSession],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_test_x" });
    const res = await successRoute(
      e,
      new URL(`https://factlot.com/billing/success?session_id=${SESSION}`),
      s.fetchImpl,
    );
    const html = await res.text();
    const key = html.match(
      /<pre id="key"><code>(fl_live_[A-Za-z0-9_-]{43})</,
    )?.[1];
    assert.ok(key);
    for (const client of [
      "Claude Code",
      "Claude Desktop and claude.ai",
      "ChatGPT",
      "Cursor and VS Code",
      "Python",
      "curl",
    ])
      assert.ok(html.includes(`<summary>${client}</summary>`), client);
    assert.ok(
      html.includes(
        `claude mcp add --scope user --transport http factlot https://api.factlot.com/mcp --header &quot;Authorization: Bearer ${key}&quot;`,
      ),
    );
    assert.match(
      html,
      /Then open Claude Code and type \/mcp; factlot should show as connected\./,
    );
    assert.match(html, /never paste its output into email/);
    assert.match(
      html,
      /Claude Code, Cursor, VS Code, Windsurf, agent SDKs and any REST client/,
    );
    assert.match(
      html,
      /ChatGPT developer-mode apps have no header field today/,
    );
    assert.ok(
      html.includes(
        "&quot;-y&quot;,\n        &quot;mcp-remote&quot;,\n        &quot;https://api.factlot.com/mcp&quot;,\n        &quot;--header&quot;,\n        &quot;Authorization:${AUTH_HEADER}&quot;",
      ),
    );
    assert.ok(
      html.includes(`&quot;AUTH_HEADER&quot;: &quot;Bearer ${key}&quot;`),
    );
    assert.match(html, /its server is keyless; after adding your key, disable/);
    assert.match(
      html,
      /When is my 2027 Texas protest deadline if the notice arrived April 28\?/,
    );
    assert.match(html, /1300 Pennsylvania Ave NW in Washington, DC/);
    assert.match(
      html,
      /A lookup is one answered call to a registry tool; coverage checks, misses and input errors are free\./,
    );
    assert.ok(html.includes(`export FACTLOT_API_KEY=&quot;${key}&quot;`));
    assert.ok(
      !html.includes("&lt;your key&gt;"),
      "no placeholder when the key is known",
    );
    assert.match(
      html,
      /<button type="button" class="copy" data-copy="key">Copy<\/button>/,
    );
    assert.match(html, /id="test-key" type="password"[^>]* value="fl_live_/);
    assert.match(html, /Give this URL to your agent/);
    assert.ok(html.includes("https://api.factlot.com/v1/onboarding?plan=team"));
    assert.match(html, /<link rel="stylesheet" href="\/styles.css">/);
    const csp = res.headers.get("content-security-policy")!;
    const nonce = csp.match(/script-src 'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    assert.ok(nonce);
    assert.ok(html.includes(`<script nonce="${nonce}">`));
    assert.ok(html.includes(`<style nonce="${nonce}">`));
    assert.match(csp, /connect-src https:\/\/api\.factlot\.com;/);
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(html, / style="/, "no inline style attributes (CSP)");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("a revisit after the page showed the key renders the guide with a recovery link, not a bare 409", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paidSession],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_test_x" });
    const url = new URL(
      `https://factlot.com/billing/success?session_id=${SESSION}`,
    );
    await (await successRoute(e, url, s.fetchImpl)).text();
    const again = await successRoute(e, url, s.fetchImpl);
    assert.equal(again.status, 200);
    const html = await again.text();
    assert.match(html, /Your key was already shown/);
    assert.match(
      html,
      /href="https:\/\/factlot\.com\/account#recover">Recover access</,
    );
    assert.match(html, /Set up FactLot Team/);
    assert.doesNotMatch(html, /fl_live_[A-Za-z0-9_-]{43}/);
    assert.match(html, /Bearer &lt;your key&gt;/);
  });

  it("GET /v1/onboarding: the guide as JSON with <key> placeholders, or Markdown", async () => {
    const e = env();
    const { api } = innerApi();
    const res = await call(e, api, "/v1/onboarding?plan=pro", {
      method: "GET",
    });
    assert.equal(res.status, 200);
    const g = (await res.json()) as {
      plan: { id: string; registry_lookups_per_month: number };
      clients: { id: string; snippets: { code: string }[] }[];
      test: { url: string };
      lookups: Record<string, string>;
      links: Record<string, string>;
    };
    assert.equal(g.plan.id, "pro");
    assert.equal(g.plan.registry_lookups_per_month, 5000);
    assert.deepEqual(
      g.clients.map((c) => c.id),
      ["claude-code", "claude", "chatgpt", "cursor-vscode", "python", "curl"],
    );
    assert.ok(
      g.clients.every((c) =>
        c.snippets.every((sn) => !/fl_live_/.test(sn.code)),
      ),
    );
    assert.match(g.clients[0]!.snippets[0]!.code, /Bearer <key>/);
    assert.equal(g.test.url, "https://api.factlot.com/v1/account");
    assert.match(g.lookups.counted!, /registry_coverage/);
    assert.equal(g.links.account, "https://factlot.com/account");
    const md = await handle(
      new Request("https://api.factlot.com/v1/onboarding", {
        headers: { accept: "text/markdown" },
      }),
      e,
      api,
    );
    assert.match(md.headers.get("content-type")!, /text\/markdown/);
    const text = await md.text();
    assert.match(text, /^# Set up FactLot/);
    assert.match(text, /## 2\. Connect your client/);
    assert.match(text, /```bash\nclaude mcp add/);
  });
});

describe("recovery by email", () => {
  const SECRET = "test-recovery-secret";
  function setup(
    over: Partial<Env> = {},
    customers: Record<string, string[]> = { "buyer@example.com": ["cus_1"] },
  ) {
    const s = fakeStripe({
      "GET /customers": (q) => [
        200,
        { data: (customers[q.get("email") ?? ""] ?? []).map((id) => ({ id })) },
      ],
      "GET /subscriptions": (q) => [
        200,
        {
          data:
            q.get("customer") === "cus_1"
              ? [{ id: "sub_1" }, { id: "sub_gone" }]
              : [],
        },
      ],
      "POST /billing_portal/sessions": () => [
        200,
        { url: "https://billing.stripe.com/p/session/r" },
      ],
    });
    const mail = fakeEmail();
    const e = env({
      STRIPE_SECRET_KEY: "sk_live_x",
      EMAIL: mail.binding,
      RECOVERY_SIGNING_SECRET: SECRET,
      ...over,
    });
    e.RL_ANON = new CountingLimit(100);
    return { s, mail, e };
  }
  const ask = (e: ReturnType<typeof env>, email: string, f: typeof fetch) =>
    run(
      e,
      new Request("https://factlot.com/account/recover", {
        method: "POST",
        body: new URLSearchParams({ email }).toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://factlot.com",
          "cf-connecting-ip": IP,
        },
      }),
      f,
    );
  const link = (text: string) =>
    text.match(
      /https:\/\/factlot\.com\/account\/recover\/([A-Za-z0-9_.-]+)/,
    )?.[0];
  const issueVia = (e: ReturnType<typeof env>, url: string, f: typeof fetch) =>
    run(
      e,
      new Request(url, {
        method: "POST",
        body: "action=issue",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://factlot.com",
          "cf-connecting-ip": IP,
        },
      }),
      f,
    );

  it("the form is off with a clear notice until the binding and the secret are set", async () => {
    for (const over of [
      { EMAIL: undefined },
      { RECOVERY_SIGNING_SECRET: undefined },
    ]) {
      const { e, s } = setup(over);
      const form = await run(e, new Request("https://factlot.com/account"));
      const html = await form.text();
      assert.match(
        html,
        /Email recovery is being set up; email contact@factlot\.com/,
      );
      assert.doesNotMatch(html, /action="\/account\/recover"/);
      const post = await ask(e, "buyer@example.com", s.fetchImpl);
      assert.equal(post.status, 503);
      assert.equal(s.calls.length, 0, "Stripe is never asked");
    }
    const { e } = setup();
    const on = await (
      await run(e, new Request("https://factlot.com/account"))
    ).text();
    assert.match(on, /<form method="post" action="\/account\/recover">/);
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    const { e, s, mail } = setup();
    await issue(e);
    const known = await ask(e, "buyer@example.com", s.fetchImpl);
    const unknown = await ask(e, "nobody@example.com", s.fetchImpl);
    assert.equal(known.status, unknown.status);
    const a = (await known.text()).replace(/nonce="[^"]*"/g, "");
    const b = (await unknown.text()).replace(/nonce="[^"]*"/g, "");
    assert.equal(a, b, "identical pages");
    assert.match(
      a,
      /If that email has a FactLot subscription, a link is on its way/,
    );
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0]!.to, "buyer@example.com");
  });

  it("a link shows the account; issuing consumes it; Pro's one key is replaced and says so", async () => {
    const { e, s, mail } = setup();
    const { key: old } = await issue(e);
    const logs = await captureLogs(async () => {
      await ask(e, "buyer@example.com", s.fetchImpl);
    });
    const url = link(mail.sent[0]!.text)!;
    assert.ok(url);
    assert.ok(!mail.sent[0]!.text.includes("fl_live_"), "no key in the email");
    assert.ok(!logs.includes(url.split("/").pop()!), "no token in logs");
    assert.ok(!logs.includes("buyer@example.com"), "no address in logs");
    const view = await run(e, new Request(url), s.fetchImpl);
    assert.equal(view.status, 200);
    const page = await view.text();
    assert.match(page, /FactLot Pro/);
    assert.match(
      page,
      /replaces key <code>[0-9a-f]{16}<\/code>, which stops working/,
    );
    assert.match(page, /value="issue"/);
    const done = await issueVia(e, url, s.fetchImpl);
    const html = await done.text();
    const fresh = html.match(
      /<pre id="key"><code>(fl_live_[A-Za-z0-9_-]{43})</,
    )?.[1];
    assert.ok(fresh, "the new key is shown");
    assert.match(html, /no longer works/);
    const { api } = innerApi();
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: fresh })).status,
      200,
    );
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: old })).status,
      401,
    );
    const reuse = await issueVia(e, url, s.fetchImpl);
    assert.equal(reuse.status, 410);
    assert.match(await reuse.text(), /already used/);
    assert.equal((await run(e, new Request(url), s.fetchImpl)).status, 410);
  });

  it("Team with room adds a key and keeps the others working", async () => {
    const { e, s, mail } = setup();
    const { key: old } = await issue(e, { plan: "team" });
    await ask(e, "buyer@example.com", s.fetchImpl);
    const url = link(mail.sent[0]!.text)!;
    const html = await (await issueVia(e, url, s.fetchImpl)).text();
    assert.match(html, /Your other keys keep working/);
    const { api } = innerApi();
    assert.equal(
      (await call(e, api, "/v1/calc/irr", { key: old })).status,
      200,
    );
  });

  it("links expire after 15 minutes; forged links are refused before KV is read", async () => {
    const { e, s, mail } = setup();
    await issue(e);
    await ask(e, "buyer@example.com", s.fetchImpl);
    const url = link(mail.sent[0]!.text)!;
    const [id, sig] = url.split("/").pop()!.split(".");
    const forged = `https://factlot.com/account/recover/${id}.${sig!.slice(1)}A`;
    const reads = e.KEYS.reads;
    assert.equal((await run(e, new Request(forged), s.fetchImpl)).status, 404);
    assert.equal(e.KEYS.reads, reads, "no KV read for a bad signature");
    e.clock.t += 15 * 60_000 + 1000;
    const late = await run(e, new Request(url), s.fetchImpl);
    assert.equal(late.status, 410);
    assert.match(await late.text(), /expired/);
  });

  it("one email per address every 5 minutes", async () => {
    const { e, s, mail } = setup();
    await issue(e);
    await ask(e, "buyer@example.com", s.fetchImpl);
    await ask(e, "Buyer@Example.com", s.fetchImpl);
    assert.equal(mail.sent.length, 1);
  });

  it("refuses a recovery POST from another site", async () => {
    const { e, s } = setup();
    const res = await run(
      e,
      new Request("https://factlot.com/account/recover", {
        method: "POST",
        body: "email=buyer%40example.com",
        headers: { origin: "https://evil.example", "cf-connecting-ip": IP },
      }),
      s.fetchImpl,
    );
    assert.equal(res.status, 403);
  });
});

describe("welcome email", () => {
  const paid = {
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    subscription: "sub_1",
    customer: "cus_1",
    customer_details: { email: "buyer@example.com" },
    metadata: { factlot_plan: "pro" },
  };

  it("is sent on redemption with the setup steps and the account link, never the key", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paid],
    });
    const mail = fakeEmail();
    const e = env({ STRIPE_SECRET_KEY: "sk_test_x", EMAIL: mail.binding });
    const res = await run(
      e,
      new Request(`https://factlot.com/billing/success?session_id=${SESSION}`),
      s.fetchImpl,
    );
    const key = (await res.text()).match(/fl_live_[A-Za-z0-9_-]{43}/)?.[0];
    assert.ok(key);
    assert.equal(mail.sent.length, 1);
    const m = mail.sent[0]!;
    assert.equal(m.to, "buyer@example.com");
    assert.equal(m.subject, "Welcome to FactLot Pro");
    assert.match(m.text, /https:\/\/factlot\.com\/account/);
    assert.match(m.text, /https:\/\/api\.factlot\.com\/mcp/);
    assert.doesNotMatch(
      m.text,
      /recover\//,
      "no recovery token in the welcome email",
    );
    assert.ok(!m.text.includes(key) && !(m.html ?? "").includes(key));
  });

  it("is skipped without the binding, and a failed send never fails the page", async () => {
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paid],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_test_x" });
    const ok = await run(
      e,
      new Request(`https://factlot.com/billing/success?session_id=${SESSION}`),
      s.fetchImpl,
    );
    assert.equal(ok.status, 200);
    const broken = fakeEmail("E_SENDER_NOT_VERIFIED");
    const e2 = env({ STRIPE_SECRET_KEY: "sk_test_x", EMAIL: broken.binding });
    let res: Response | undefined;
    const logs = await captureLogs(async () => {
      res = await run(
        e2,
        new Request(
          `https://factlot.com/billing/success?session_id=${SESSION}`,
        ),
        s.fetchImpl,
      );
    });
    assert.equal(res!.status, 200);
    assert.match(logs, /"code":"E_SENDER_NOT_VERIFIED"/);
    assert.ok(!logs.includes("buyer@example.com"));
  });
});

describe("quota fairness: only answered lookups are charged", () => {
  const miss = (coverage: Record<string, unknown>, extra = {}) => ({
    ...extra,
    coverage,
  });
  // What the inner handler answers, by REST path (MCP uses the same table by tool name).
  const answers: Record<string, [number, unknown]> = {
    "/v1/registry/get": [200, { record: { urn: "fl:parcel:us-11001:x" } }],
    "/v1/registry/resolve_parcel": [
      200,
      miss({ county_loaded: false, state_loaded: false }, { urn: null }),
    ],
    "/v1/registry/resolve_external": [
      200,
      miss({ system: "x", system_loaded: false }, { urn: null }),
    ],
    "/v1/registry/search_address": [
      200,
      miss({ state: "TX", state_loaded: false }, { results: [] }),
    ],
    "/v1/registry/search_entities": [
      200,
      miss({ loaded_jurisdictions: ["us-md"] }, { results: [] }),
    ],
    "/v1/registry/owned_by": [
      400,
      { error: "BadRequest", message: '"x" is not a FactLot URN' },
    ],
  };
  const toolOf = (p: string) => `registry_${p.split("/").pop()}`;
  function fairApi() {
    return {
      fetch: async (r: Request) => {
        const path = new URL(r.url).pathname;
        const text = await r.text();
        if (path === "/mcp") {
          const parsed = JSON.parse(text) as unknown;
          const items = (Array.isArray(parsed) ? parsed : [parsed]) as {
            id: number;
            params: { name: string };
          }[];
          const out = items.map((m) => {
            const entry = Object.entries(answers).find(
              ([p]) => toolOf(p) === m.params.name,
            );
            const [status, body] = entry?.[1] ?? [200, {}];
            if (m.id === 7)
              return {
                jsonrpc: "2.0",
                id: m.id,
                error: { code: -32602, message: "invalid params" },
              };
            return {
              jsonrpc: "2.0",
              id: m.id,
              result: {
                ...(status !== 200 ? { isError: true } : {}),
                content: [{ type: "text", text: JSON.stringify(body) }],
              },
            };
          });
          return new Response(
            JSON.stringify(Array.isArray(parsed) ? out : out[0]),
            {
              headers: { "content-type": "application/json" },
            },
          );
        }
        const [status, body] = answers[path] ?? [200, {}];
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      },
    };
  }
  const remaining = (r: Response) =>
    Number(r.headers.get("x-factlot-registry-quota-remaining"));

  it("REST: a real answer and a search inside coverage are charged; misses and errors are free", async () => {
    const e = env();
    e.RL_ANON = new CountingLimit(100);
    const api = fairApi();
    const got = await call(e, api, "/v1/registry/get", { body: { urn: "x" } });
    assert.equal(remaining(got), 24, "a record is charged");
    for (const p of [
      "/v1/registry/resolve_parcel",
      "/v1/registry/resolve_external",
      "/v1/registry/search_address",
      "/v1/registry/owned_by",
    ]) {
      const r = await call(e, api, p, { body: {} });
      assert.equal(remaining(r), 24, `${p} is free`);
    }
    const ran = await call(e, api, "/v1/registry/search_entities", {
      body: {},
    });
    assert.equal(
      remaining(ran),
      23,
      "a search inside coverage is charged with no results",
    );
    const q = await e.METER.quota(await addressSubject(IP, T0), "day", 25);
    assert.equal(q.used, 2, "the meter agrees with the headers");
  });

  it("MCP batch: charges the answers, gives back misses, tool errors and invalid params", async () => {
    const e = env();
    e.RL_ANON = new CountingLimit(100);
    const api = fairApi();
    const res = await call(e, api, "/mcp", {
      body: [
        toolCall("registry_get", 1),
        toolCall("registry_resolve_parcel", 2),
        toolCall("registry_search_address", 3),
        toolCall("registry_owned_by", 4),
        toolCall("registry_search_entities", 5),
        toolCall("registry_coverage", 6),
        toolCall("registry_get", 7), // answered with a JSON-RPC invalid-params error
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(remaining(res), 23, "get and the entity search are charged");
    const q = await e.METER.quota(await addressSubject(IP, T0), "day", 25);
    assert.equal(q.used, 2);
  });

  it("paid: the monthly quota and the 429 text state the rule", async () => {
    const e = env();
    const { key } = await issue(e);
    const api = fairApi();
    const r = await call(e, api, "/v1/registry/resolve_parcel", {
      key,
      body: {},
    });
    assert.equal(remaining(r), 5000);
    const plans = (await (
      await call(e, innerApi().api, "/v1/plans", { method: "GET" })
    ).json()) as { quotas: { counted: string } };
    assert.match(plans.quotas.counted, /answered call/);
    assert.match(
      plans.quotas.counted,
      /input errors, misses outside loaded coverage/,
    );
    await e.METER.consume(`sub:sub_1`, { kind: "month", limit: 5000, n: 5000 });
    const over = await call(e, api, "/v1/registry/get", { key, body: {} });
    assert.equal(over.status, 429);
    assert.match(
      String(((await over.json()) as { message: string }).message),
      /coverage checks, misses and input errors are free/,
    );
  });
});

describe("renewal date and receipts", () => {
  const END = Date.UTC(2026, 11, 3) / 1000;
  it("a subscription webhook stores the period end; /v1/account reports renewal_at, support and changelog", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    const { key, hash } = await issue(e);
    const res = await handleWebhook(
      e,
      await signed({
        type: "customer.subscription.updated",
        created: Math.floor(T0 / 1000),
        data: {
          object: {
            id: "sub_1",
            status: "active",
            items: {
              data: [
                {
                  current_period_end: END,
                  price: { lookup_key: "factlot_pro_monthly_v1" },
                },
              ],
            },
          },
        },
      }),
      () => T0,
    );
    assert.equal(res.status, 200);
    assert.equal(
      (await readKey(e.KEYS, hash))?.period_end,
      "2026-12-03T00:00:00.000Z",
    );
    const body = (await (
      await call(e, innerApi().api, "/v1/account", { key, method: "GET" })
    ).json()) as Record<string, unknown>;
    assert.equal(body.renewal_at, "2026-12-03T00:00:00.000Z");
    assert.equal(body.support, "mailto:contact@factlot.com");
    assert.match(String(body.changelog), /CHANGELOG\.md$/);
  });

  it("a subscription set to cancel has no renewal date, only an end date", async () => {
    const e = env();
    const { key } = await issue(e, {
      period_end: "2026-12-03T00:00:00.000Z",
      cancel_at_period_end: true,
    });
    const body = (await (
      await call(e, innerApi().api, "/v1/account", { key, method: "GET" })
    ).json()) as Record<string, unknown>;
    assert.equal(body.renewal_at, null);
    assert.equal(body.ends_at, "2026-12-03T00:00:00.000Z");
  });

  it("/account shows the renewal date and the masked receipt address", async () => {
    const s = fakeStripe({
      "GET /customers/cus_1": () => [
        200,
        { id: "cus_1", email: "buyer@example.com" },
      ],
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { key } = await issue(e, { period_end: "2026-12-03T00:00:00.000Z" });
    const res = await handle(
      new Request("https://factlot.com/account", {
        method: "POST",
        body: new URLSearchParams({ key }).toString(),
        headers: { origin: "https://factlot.com", "cf-connecting-ip": IP },
      }),
      e,
      innerApi().api,
      { fetchImpl: s.fetchImpl, now: () => T0 },
    );
    const html = await res.text();
    assert.match(html, /Renews on December 3, 2026/);
    assert.match(html, /Stripe emails receipts to b•••r@example\.com/);
    assert.ok(!html.includes("buyer@example.com"));
  });
});

describe("account usage, tools and page", () => {
  const regionsApi = (counties: unknown[]) => {
    const base = innerApi().api;
    return {
      fetch: async (r: Request) =>
        new URL(r.url).pathname === "/v1/registry/coverage"
          ? new Response(JSON.stringify({ counties }), {
              headers: { "content-type": "application/json" },
            })
          : base.fetch(r),
    };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("records charged lookups by tool and region; /v1/account/usage reports 30 days", async () => {
    const e = env();
    const { key } = await issue(e);
    const { api } = innerApi();
    await call(e, api, "/v1/registry/get", {
      key,
      body: { urn: "fl:parcel:us-24510:0001" },
    });
    await call(e, api, "/v1/registry/resolve_parcel", {
      key,
      body: { state_fips: "11", county_fips: "001", apn: "x" },
    });
    await call(e, api, "/mcp", {
      key,
      body: [
        toolCall("registry_search_address", 1),
        toolCall("registry_coverage", 2),
      ],
    });
    await flush();
    const res = await call(e, api, "/v1/account/usage", {
      key,
      method: "GET",
    });
    assert.equal(res.status, 200);
    const u = (await res.json()) as {
      daily: { date: string; lookups: number }[];
      by_tool: Record<string, number>;
      by_region: Record<string, number>;
      total: number;
      month: { used: number; limit: number };
    };
    assert.equal(u.daily.length, 30);
    assert.equal(u.daily.at(-1)!.date, "2026-11-07");
    assert.equal(u.total, 3);
    assert.deepEqual(u.by_tool, {
      registry_get: 1,
      registry_resolve_parcel: 1,
      registry_search_address: 1,
    });
    assert.deepEqual(u.by_region, { "us-24": 1, "us-11": 1, search: 1 });
    assert.deepEqual(
      [u.month.used, u.month.limit],
      [3, 5000],
      "agrees with the quota",
    );
    const anon = await call(e, api, "/v1/account/usage", { method: "GET" });
    assert.equal(anon.status, 401);
    const err = (await anon.json()) as Record<string, string>;
    assert.equal(err.code, "Unauthorized");
    assert.match(err.next!, /Bearer/);
  });

  it("MCP: account tools are listed only with a key (report_create for everyone), answered here, and never metered", async () => {
    const e = env();
    const { key } = await issue(e, { plan: "team" });
    const { api, seen } = innerApi();
    const listApi = {
      fetch: async (r: Request) => {
        const body = JSON.parse(await r.clone().text()) as { method?: string };
        if (body.method === "tools/list")
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { tools: [{ name: "calc_irr" }] },
            }),
            { headers: { "content-type": "application/json" } },
          );
        return api.fetch(r);
      },
    };
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const keyed = (await (
      await call(e, listApi, "/mcp", { key, body: list })
    ).json()) as { result: { tools: { name: string }[] } };
    assert.deepEqual(
      keyed.result.tools.map((t) => t.name),
      ["calc_irr", "account_status", "account_usage", "report_create"],
    );
    const anon = (await (
      await call(e, listApi, "/mcp", { body: list })
    ).json()) as { result: { tools: { name: string }[] } };
    assert.deepEqual(
      anon.result.tools.map((t) => t.name),
      ["calc_irr", "report_create"],
    );
    const before = seen.length;
    const status = (await (
      await call(e, api, "/mcp", { key, body: toolCall("account_status", 7) })
    ).json()) as {
      id: number;
      result: { structuredContent: Record<string, unknown> };
    };
    assert.equal(seen.length, before, "the inner handler never sees it");
    assert.equal(status.id, 7);
    assert.equal(status.result.structuredContent.plan, "team");
    assert.ok(status.result.structuredContent.registry_lookups);
    const mixed = (await (
      await call(e, api, "/mcp", {
        key,
        body: [toolCall("calc_irr", 1), toolCall("account_usage", 2)],
      })
    ).json()) as {
      id: number;
      result: { structuredContent?: { daily: unknown[] } };
    }[];
    assert.deepEqual(mixed.map((m) => m.id).sort(), [1, 2]);
    assert.equal(
      mixed.find((m) => m.id === 2)!.result.structuredContent!.daily.length,
      30,
    );
    const q = await e.METER.quota("sub:sub_1", "month", 100_000);
    assert.equal(q.used, 0, "account tools are free");
  });

  it("/account shows the month's bar, 30 days, keys with last use, hosted regions and what's new", async () => {
    resetCoverageCache();
    const e = env();
    e.RL_ANON = new CountingLimit(100);
    const { key } = await issue(e, { plan: "team" });
    const api = regionsApi([
      { state: "DC", parcels: 18077, sources: [{ as_of: "2026-11-04" }] },
      { state: "MD", parcels: 3434, sources: [{ as_of: "2026-11-05" }] },
      { state: "MD", parcels: 100, sources: [{ as_of: "2026-11-02" }] },
    ]);
    await call(e, api, "/v1/registry/get", {
      key,
      body: { urn: "fl:parcel:us-11001:02570824" },
    });
    await flush();
    const res = await handle(
      new Request("https://factlot.com/account", {
        method: "POST",
        body: new URLSearchParams({ key }).toString(),
        headers: { origin: "https://factlot.com", "cf-connecting-ip": IP },
      }),
      e,
      api,
      { now: () => T0 },
    );
    const html = await res.text();
    resetCoverageCache();
    assert.match(html, /<progress max="100000" value="1"/);
    assert.match(
      html,
      /<svg class="spark"[^>]*aria-label="1 registry lookup from 2026-10-09 to 2026-11-07; most on 2026-11-07 \(1\)"/,
    );
    assert.match(html, /<code>us-11<\/code> 1/);
    assert.match(html, /2026-11-07 12:00 UTC/, "the key's last use");
    assert.match(
      html,
      /<strong>DC<\/strong>: 1 county, 18,077 parcels, as of 2026-11-04/,
    );
    assert.match(
      html,
      /<strong>MD<\/strong>: 2 counties, 3,534 parcels, as of 2026-11-05/,
    );
    assert.match(html, /Texas hosting opens with this release\./);
    assert.match(html, /What's new/);
    assert.match(html, /Get help/);
    assert.doesNotMatch(html, / style="/);
  });

  it("every What's new line is recorded in CHANGELOG.md", async () => {
    const { readFileSync } = await import("node:fs");
    const changelog = readFileSync(
      new URL("../../../CHANGELOG.md", import.meta.url),
      "utf8",
    );
    const unreleased = changelog.slice(
      changelog.indexOf("## [Unreleased]"),
      changelog.indexOf("\n## [", changelog.indexOf("## [Unreleased]") + 5),
    );
    for (const w of WHATS_NEW)
      assert.ok(unreleased.includes(w.changelog), w.changelog);
  });

  it("billing and account errors carry code, message and next", async () => {
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    const { key } = await issue(e);
    const { api } = innerApi();
    const checks: [Response, string][] = [
      [
        await call(e, api, "/v1/billing/checkout", { body: { plan: "gold" } }),
        "BadRequest",
      ],
      [await call(e, api, "/v1/billing/keys", { key }), "KeyLimitReached"],
      [
        await call(e, api, "/v1/billing/keys/0000000000000000", {
          key,
          method: "DELETE",
        }),
        "NotFound",
      ],
      [
        await call(e, api, "/v1/billing/rotate", { key, method: "GET" }),
        "MethodNotAllowed",
      ],
      [
        await call(e, api, `/v1/billing/claim/${"A".repeat(43)}`, {
          method: "GET",
        }),
        "NotFound",
      ],
      [
        await call(e, api, "/v1/account", {
          key: `fl_live_${"Z".repeat(43)}`,
          method: "GET",
        }),
        "Unauthorized",
      ],
    ];
    for (const [res, code] of checks) {
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.code, code, JSON.stringify(body));
      assert.equal(typeof body.message, "string");
      assert.ok(typeof body.next === "string" && body.next.length > 0, code);
    }
  });
});
