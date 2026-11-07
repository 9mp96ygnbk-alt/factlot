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
  objectMeter,
  quotaWindow,
  sqlStore,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
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
  size() {
    return this.counts.size + this.claims.size;
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
      "Every calculator, ID, fact, rules and document tool at 60 requests a minute per IP address, and 100 registry lookups a day per IP address.",
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

  it("free: 100 lookups per address per UTC day, then 429 RegistryQuotaExceeded; other tools keep working", async () => {
    const { api } = innerApi();
    const e = env();
    const first = await call(e, api, "/v1/registry/get", {
      body: { urn: "x" },
    });
    assert.equal(first.headers.get("x-factlot-registry-quota-limit"), "100");
    assert.equal(first.headers.get("x-factlot-registry-quota-remaining"), "99");
    assert.match(
      first.headers.get("access-control-expose-headers") ?? "",
      /x-factlot-registry-quota-remaining/,
      "browsers may read the quota headers",
    );
    assert.equal(
      first.headers.get("x-factlot-registry-quota-reset"),
      "2026-11-08T00:00:00.000Z",
    );
    await spend(e, api, 99);
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
    assert.equal(body.limit, 100);
    assert.equal(body.resets_at, "2026-11-08T00:00:00.000Z");
    assert.equal(body.upgrade, "https://factlot.com/#pricing");
    assert.match(String(body.message), /100 a day per IP address/);
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
    assert.equal(r.headers.get("x-factlot-registry-quota-remaining"), "99");
  });

  it("free: an IPv6 /64 shares one daily allowance", async () => {
    const { api } = innerApi();
    const e = env();
    await call(e, api, "/v1/registry/get", { ip: "2001:db8:1:2::1" });
    const other = await call(e, api, "/v1/registry/get", {
      ip: "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
    });
    assert.equal(other.headers.get("x-factlot-registry-quota-remaining"), "98");
    const elsewhere = await call(e, api, "/v1/registry/get", {
      ip: "2001:db8:1:3::1",
    });
    assert.equal(
      elsewhere.headers.get("x-factlot-registry-quota-remaining"),
      "99",
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
        message: closedText,
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
        { id: keyId(hash), created: "2026-11-03T00:00:00Z", current: true },
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
      /<pre class="key">(fl_live_[A-Za-z0-9_-]{43})<\/pre>/,
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
    assert.equal(rest.headers.get("x-factlot-registry-quota-remaining"), "100");
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
