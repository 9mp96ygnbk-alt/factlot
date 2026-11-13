import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { createHandler } from "@factlot/server";
import {
  TX_EQUITY_NOTICE,
  TX_EQUITY_RULE,
  configureRegistry,
  configureRegistryRunner,
  runTool,
  runToolAsync,
} from "@factlot/tools";

import {
  RECHECK_BACKOFF_MS,
  RECHECK_MS,
  billingDeps,
  createCheckout,
  ensurePrice,
  handleWebhook,
  logStripeError,
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
  CLAIM_TTL_MS,
  Meter,
  RateLimiterObject,
  WindowCounter,
  addressSubject,
  ipBucket,
  modelSubject,
  objectLimiter,
  objectMeter,
  quotaWindow,
  sqlStore,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import { resetCoverageCache } from "./account-tools.ts";
import { CLAIM_POLL_MS } from "./claim.ts";
import { HOSTING_NOTE, WHATS_NEW } from "./news.ts";
import { EXTRACT_LEASE_STEP, REPORTS_STEP } from "./onboarding.ts";
import { REPORT_RULE, escapeHtml, onboardingPage } from "./pages.ts";
import {
  MESSAGES,
  PROMO_DAILY_CAP,
  freeConsentText,
  optionalMessages,
  encodeQuery,
  freeWeekMessage,
  paidConsentText,
  paidWeekMessage,
  unusedPaidMessage,
  withheldMessage,
} from "./lifecycle-copy.ts";
import {
  MARK_TTL_DAYS,
  MAX_DUE_RETRIES,
  SWEEP_BATCH,
  addressHash,
  deliverPromo,
  lifecycleSweep,
  recordConsent,
} from "./lifecycle.ts";
import { body } from "./email.ts";
import {
  PLANS,
  REPORTS_PER_MONTH,
  planForLookupKey,
  priceText,
} from "./plans.ts";
import { createRecoveryToken } from "./recovery.ts";
import {
  BATCH_CONCURRENCY,
  REGISTRY_RUN_URL,
  TX_EQUITY_BATCH_TOOL,
  registryRunner,
} from "./registry.ts";
import { handle } from "./router.ts";
import {
  STRIPE_API_VERSION,
  StripeError,
  hmacSha256Hex,
  verifyStripeSignature,
} from "./stripe.ts";
import type { Env, KV, MeterService, RateLimit } from "./types.ts";
import { resetUsageForTests, snapshot } from "./usage.ts";

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
  async list(o: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const all = [...this.data.keys()]
      .filter((k) => k.startsWith(o.prefix ?? ""))
      .sort()
      .filter((k) => o.cursor === undefined || k > o.cursor);
    const page = o.limit === undefined ? all : all.slice(0, o.limit);
    const complete = page.length === all.length;
    return {
      keys: page.map((name) => ({ name })),
      list_complete: complete,
      ...(complete ? {} : { cursor: page[page.length - 1] }),
    };
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
    REPORTS_ENABLED: "true",
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
    // Claims outlive the 365-day KV marker (395 days), then are deleted.
    await meterService.claim("session:y", "k");
    const c = lim.object("claim:session:y");
    assert.ok(c.alarm! >= clock.t + CLAIM_TTL_MS - 1000);
    assert.ok(CLAIM_TTL_MS >= INACTIVE_RETENTION_SECONDS * 1000);
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

  it("redirects retired site addresses permanently and serves every other page as before", async () => {
    const { api } = innerApi();
    const get = (u: string, init?: RequestInit) =>
      handle(new Request(u, init), env({ ASSETS: assets }), api);
    for (const [from, to] of [
      ["https://factlot.com/markets/houston/zip/77002", "/texas/harris/"],
      ["https://factlot.com/markets/phoenix?x=1", "/coverage/"],
      ["https://factlot.com/questions/office-rent-in-el-paso", "/texas/"],
      ["https://factlot.com/buildings/fl:building:us-48201:abc", "/coverage/"],
    ] as const) {
      const res = await get(from);
      assert.equal(res.status, 301, from);
      assert.equal(res.headers.get("location"), `https://factlot.com${to}`);
    }
    for (const live of [
      "https://factlot.com/pricing/",
      "https://factlot.com/texas/",
      "https://factlot.com/account",
    ])
      assert.notEqual((await get(live)).status, 301, live);
    assert.equal((await get("https://factlot.com/pricing/")).status, 200);
    // Not a page request: a POST, or the API host.
    assert.notEqual(
      (await get("https://factlot.com/markets/houston", { method: "POST" }))
        .status,
      301,
    );
    assert.notEqual(
      (await get("https://api.factlot.com/markets/houston")).status,
      301,
    );
  });

  it("answers a browser's GET /mcp with a page, and keeps the JSON-RPC 405 for other GETs", async () => {
    const rpc405 = JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
    const api = {
      fetch: async () =>
        new Response(rpc405, {
          status: 405,
          headers: { "content-type": "application/json", allow: "POST" },
        }),
    };
    const e = env({ ASSETS: assets });
    for (const host of ["api.factlot.com", "factlot.com"]) {
      const res = await handle(
        new Request(`https://${host}/mcp`, {
          headers: { accept: "text/html,application/xhtml+xml;q=0.9" },
        }),
        e,
        api,
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assert.match(html, /https:\/\/factlot\.com\/mcp-server\//);
      assert.match(html, /Add custom connector/);
    }
    for (const accept of [undefined, "application/json", "text/event-stream"]) {
      const res = await handle(
        new Request("https://api.factlot.com/mcp", {
          headers: accept ? { accept } : {},
        }),
        e,
        api,
      );
      assert.equal(res.status, 405);
      assert.equal(await res.text(), rpc405);
    }
  });

  it("answers HEAD /health with 200 and no body", async () => {
    const api = {
      fetch: async (r: Request) =>
        r.method === "GET"
          ? new Response(JSON.stringify({ ok: true }), {
              headers: { "content-type": "application/json" },
            })
          : new Response("{}", { status: 405 }),
    };
    const e = env({ ASSETS: assets });
    const head = await handle(
      new Request("https://api.factlot.com/health", { method: "HEAD" }),
      e,
      api,
    );
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const get = await handle(
      new Request("https://api.factlot.com/health"),
      e,
      api,
    );
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { ok: true });
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
      /factlot\.com\/pricing\//,
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

  it("a present but malformed Authorization header answers 401 and spends no rejected-key budget", async () => {
    const { api } = innerApi();
    const e = env({ RL_ANON: new CountingLimit(60) });
    const key = `fl_live_${"A".repeat(43)}`;
    const send = (authorization: string, path = "/v1/calc/irr") =>
      handle(
        new Request(`https://api.factlot.com${path}`, {
          method: "POST",
          body: "{}",
          headers: { authorization, "cf-connecting-ip": IP },
        }),
        e,
        api,
        { now: () => e.clock.t },
      );
    for (let i = 0; i < 100; i++) {
      for (const h of [`Token ${key}`, "Bearer", "Bearer ", key, "Basic abc"]) {
        const r = await send(h);
        assert.equal(r.status, 401, h);
        assert.equal(
          r.headers.get("www-authenticate"),
          'Bearer realm="factlot"',
        );
        assert.match(await r.text(), /Bearer <your FactLot key>/);
      }
    }
    // No lockout: a client that fixes its header is served.
    assert.equal((await call(e, api, "/v1/calc/irr")).status, 200);
    // Public pages that ignore auth are untouched.
    const plans = await handle(
      new Request("https://api.factlot.com/v1/plans", {
        headers: { authorization: `Token ${key}`, "cf-connecting-ip": IP },
      }),
      e,
      api,
      { now: () => e.clock.t },
    );
    assert.equal(plans.status, 200);
    // /mcp keeps its OAuth path: an OAuth-shaped value without "Bearer" is not refused here.
    const oauthShaped = `a:b:${"c".repeat(32)}`;
    const mcp = await send(oauthShaped, "/mcp");
    assert.notEqual(
      (await mcp.clone().text()).includes("Bearer <your FactLot key>"),
      true,
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
      forget: async () => {
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

describe("same-origin registry lookups for the /try/ page", () => {
  const post = (
    host: string,
    path: string,
    e: ReturnType<typeof env>,
    api: ReturnType<typeof innerApi>["api"],
    headers: Record<string, string> = {},
  ) =>
    handle(
      new Request(`https://${host}${path}`, {
        method: "POST",
        body: JSON.stringify({ query: "1000 Louisiana St" }),
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": IP,
          origin: "https://factlot.com",
          ...headers,
        },
      }),
      e,
      api,
      { now: () => e.clock.t },
    );

  it("factlot.com answers the two registry routes from the API, not the static site", async () => {
    const { api, seen } = innerApi();
    const e = env({ ASSETS: { fetch: async () => new Response("site") } });
    for (const path of ["/v1/registry/search_address", "/v1/registry/get"]) {
      const r = await post("factlot.com", path, e, api);
      assert.equal(r.status, 200, path);
      assert.equal(await r.text(), '{"ok":true}', path);
    }
    assert.equal(seen.length, 2);
    const page = await handle(new Request("https://factlot.com/try/"), e, api);
    assert.equal(await page.text(), "site");
  });

  it("meters a keyless page visitor exactly like a keyless API caller, one counter for both hosts", async () => {
    const { api } = innerApi();
    const e = env({ ASSETS: { fetch: async () => new Response("site") } });
    const first = await post(
      "factlot.com",
      "/v1/registry/search_address",
      e,
      api,
    );
    assert.equal(first.headers.get("x-factlot-tier"), "anonymous");
    assert.equal(first.headers.get("x-factlot-registry-quota-limit"), "25");
    assert.equal(first.headers.get("x-factlot-registry-quota-remaining"), "24");
    const viaApiHost = await post(
      "api.factlot.com",
      "/v1/registry/get",
      e,
      api,
    );
    assert.equal(
      viaApiHost.headers.get("x-factlot-registry-quota-remaining"),
      "23",
    );
    for (let i = 0; i < 23; i++) {
      if (i % 50 === 49) e.clock.t += 60_000;
      assert.equal(
        (await post("factlot.com", "/v1/registry/get", e, api)).status,
        200,
      );
    }
    const over = await post("factlot.com", "/v1/registry/get", e, api);
    assert.equal(over.status, 429);
    const body = (await over.json()) as Record<string, unknown>;
    assert.equal(body.error, "RegistryQuotaExceeded");
    assert.equal(typeof body.message, "string");
    assert.equal(body.upgrade, "https://factlot.com/pricing/");
    assert.match(
      over.headers.get("access-control-expose-headers") ?? "",
      /x-factlot-registry-quota-remaining/,
    );
  });

  it("needs no key and never sets a cookie or allows credentialed CORS", async () => {
    const { api } = innerApi();
    const e = env({ ASSETS: { fetch: async () => new Response("site") } });
    const r = await post("factlot.com", "/v1/registry/get", e, api);
    assert.equal(r.headers.get("set-cookie"), null);
    assert.equal(r.headers.get("access-control-allow-credentials"), null);
  });

  it("a page does not need CORS, and the routes that move money or accounts stay without a wildcard origin on the site host", async () => {
    const { api } = innerApi();
    const e = env({ ASSETS: { fetch: async () => new Response("site") } });
    // Billing and account pages are served for people on factlot.com, not as cross-origin reads.
    for (const path of ["/account", "/billing/success"]) {
      const r = await handle(new Request(`https://factlot.com${path}`), e, api);
      assert.equal(r.headers.get("access-control-allow-origin"), null, path);
    }
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
    assert.equal(body.upgrade, "https://factlot.com/pricing/");
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

  it("refuses an MCP batch whose requests share an id, before metering anything", async () => {
    const { api, seen } = innerApi();
    const e = env();
    // A real lookup and a malformed call under one id: matching answers by id would let the
    // error answer stand for the real one, and the lookup would go uncharged.
    const res = await call(e, api, "/mcp", {
      body: [toolCall("registry_get", 1), toolCall("registry_get", 1)],
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as {
      error: { code: number; message: string };
    };
    assert.equal(body.error.code, -32600);
    assert.match(body.error.message, /its own id/);
    assert.equal(e.limiter.objects.size, 0, "no meter was touched");
    assert.equal(seen.length, 0);
    // 1 and "1" are different ids; notifications (no id) may repeat.
    const ok = await call(e, api, "/mcp", {
      body: [
        toolCall("calc_irr", 1),
        toolCall("calc_irr", "1"),
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ],
    });
    assert.notEqual(ok.status, 400);
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

describe("registry runner: the candidate batch, one service call per subject", () => {
  const BATCH = TX_EQUITY_BATCH_TOOL;
  const SINGLE = "registry_tx_equity_candidates";
  const PATH = "/v1/registry/tx_equity_candidates/batch";
  const specDir = fileURLToPath(
    new URL("../../../spec/registry/", import.meta.url),
  );
  // The shared registry fixture (Texas county 997), built once; the fake registry service answers
  // each single-subject call from it with the SDK, as the registry Worker answers from its pack.
  let fixture: string | undefined;
  const fixtureDb = () =>
    (fixture ??= (() => {
      const db = join(mkdtempSync(join(tmpdir(), "factlot-fanout-")), "f.db");
      execFileSync("python3", [join(specDir, "build_fixture.py"), db]);
      return db;
    })());

  /** A fake REGISTRY binding: counts calls and the most in flight at once. */
  function registryService(
    opts: {
      /** Milliseconds the k-th call (0-based) takes. */
      delay?: (k: number) => number;
      /** The answer to a call; the SDK's runTool on the fixture by default. */
      answer?: (tool: string, input: unknown) => unknown;
    } = {},
  ) {
    const calls: { tool: string; input: Record<string, unknown> }[] = [];
    const stats = { inFlight: 0, maxInFlight: 0 };
    const binding = {
      async fetch(r: Request) {
        assert.equal(r.url, REGISTRY_RUN_URL);
        const { tool, input } = (await r.json()) as {
          tool: string;
          input: Record<string, unknown>;
        };
        const k = calls.push({ tool, input }) - 1;
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        try {
          await new Promise((res) => setTimeout(res, opts.delay?.(k) ?? 0));
          const a = opts.answer
            ? opts.answer(tool, input)
            : runTool(tool, input);
          return a instanceof Response ? a : new Response(JSON.stringify(a));
        } finally {
          stats.inFlight--;
        }
      },
    };
    return { calls, stats, binding };
  }

  /** Run `fn` with the fixture loaded and the hosted runner over `binding`; restore after. */
  async function withRunner<T>(
    binding: { fetch(r: Request): Promise<Response> },
    fn: () => Promise<T>,
  ): Promise<T> {
    configureRegistry(fixtureDb());
    configureRegistryRunner(registryRunner(binding));
    try {
      return await fn();
    } finally {
      configureRegistryRunner(undefined);
      configureRegistry(undefined);
    }
  }

  const vectors = JSON.parse(
    readFileSync(join(specDir, "calls_tx_batch.json"), "utf8"),
  ) as { tool: string; arguments: Record<string, unknown> }[];

  it("answers every shared batch vector exactly as the SDK's batch, subject by subject", async () => {
    for (const v of vectors) {
      const label = JSON.stringify(v.arguments).slice(0, 120);
      // The SDK's own batch against the same fixture (runTool never uses the runner).
      configureRegistry(fixtureDb());
      const sdk = runTool(v.tool, v.arguments);
      configureRegistry(undefined);
      // Later calls finish first, so the answers come back out of order.
      const service = registryService({ delay: (k) => Math.max(0, 12 - k) });
      const hosted = await withRunner(service.binding, () =>
        runToolAsync(v.tool, v.arguments),
      );
      assert.equal(JSON.stringify(hosted), JSON.stringify(sdk), label);
      if (!sdk.ok) {
        // The batch envelope's input errors (0 or 51 subjects, a duplicate id, a missing id,
        // unknown fields, a whole-number band) are answered here, before any service call.
        assert.equal(service.calls.length, 0, label);
        continue;
      }
      // One single-subject call per subject, never the batch tool, with the shared parameters
      // and the defaults the catalog applied to the batch.
      const { subjects, ...params } = v.arguments as {
        subjects: Record<string, unknown>[];
      };
      assert.equal(service.calls.length, subjects.length, label);
      assert.ok(
        service.calls.every((c) => c.tool === SINGLE),
        label,
      );
      assert.ok(service.stats.maxInFlight <= BATCH_CONCURRENCY, label);
      for (const { id: _id, ...subject } of subjects) {
        void _id;
        const input = service.calls.find((c) =>
          Object.entries(subject).every(([k, val]) => c.input[k] === val),
        )?.input;
        assert.ok(input, `${label}: a call for ${JSON.stringify(subject)}`);
        assert.equal(input.id, undefined, "the batch id is not sent");
        for (const [k, val] of Object.entries(params))
          assert.deepEqual(input[k], val, `${label}: ${k}`);
        assert.equal(typeof input.area_band, "number");
        assert.equal(typeof input.year_band, "number");
        assert.equal(typeof input.min_matches, "number");
        assert.equal(typeof input.limit, "number");
      }
    }
  });

  it("keeps input order, strips notice and selection.rule, and runs at most 4 calls at once", async () => {
    const service = registryService({ delay: (k) => (k % 3) * 4 });
    const subjects = [
      { id: "A", urn: "fl:parcel:us-48997:1000001" },
      { id: "T", urn: "fl:parcel:us-48439:00001234" }, // Tarrant: withheld
      { id: "B", county_fips: "997", apn: "1000004" },
      { id: "X", urn: "fl:parcel:us-04021:50101001" }, // not Texas
      { id: "M", urn: "fl:parcel:us-48997:9999999" }, // not in the registry
      { id: "W", urn: "fl:parcel:us-48997:1000001", apn: "1000001" }, // which parcel?
      { id: "C", urn: "fl:parcel:us-48997:1000010" },
      { id: "D", urn: "fl:parcel:us-48997:1000001" },
      { id: "E", urn: "fl:parcel:us-48997:1000010" },
      { id: "F", county_fips: "997", apn: "1000004" },
    ];
    const out = await withRunner(service.binding, () =>
      runToolAsync(BATCH, { subjects, tax_year: 2026 }),
    );
    assert.ok(out.ok);
    assert.equal(service.calls.length, 10);
    assert.equal(service.stats.maxInFlight, BATCH_CONCURRENCY);
    const r = out.result as {
      results: Record<string, unknown>[];
      summary: unknown;
      rule: string;
      notice: string;
    };
    assert.deepEqual(Object.keys(r), ["results", "summary", "rule", "notice"]);
    assert.deepEqual(
      r.results.map((x) => x.id),
      subjects.map((s) => s.id),
    );
    assert.deepEqual(r.summary, { subjects: 10, answered: 6, errors: 4 });
    assert.equal(r.rule, TX_EQUITY_RULE);
    assert.equal(r.notice, TX_EQUITY_NOTICE);
    configureRegistry(fixtureDb());
    try {
      for (const [k, s] of subjects.entries()) {
        const { id, ...subject } = s;
        const single = runTool(SINGLE, { ...subject, tax_year: 2026 });
        if (!single.ok) {
          // The subject's own error object, coverage and all.
          assert.deepEqual(r.results[k], { id, error: single.error }, id);
          continue;
        }
        const { notice, selection, ...rest } = single.result as Record<
          string,
          unknown
        >;
        const { rule, ...perSubject } = selection as Record<string, unknown>;
        assert.equal(notice, TX_EQUITY_NOTICE);
        assert.equal(rule, TX_EQUITY_RULE);
        assert.deepEqual(r.results[k], { id, ...rest, selection: perSubject });
        assert.equal(Object.keys(r.results[k]!).at(-1), "selection");
        assert.ok(!("notice" in r.results[k]!));
      }
      const err = (id: string) =>
        r.results.find((x) => x.id === id)!.error as {
          error: string;
          message: string;
          coverage?: unknown;
        };
      assert.match(err("T").message, /Tarrant/);
      assert.equal(err("X").error, "InputError");
      assert.equal(err("M").error, "NotFound");
      assert.ok(err("M").coverage, "a miss carries coverage");
      assert.equal(err("W").error, "InputError");
    } finally {
      configureRegistry(undefined);
    }
  });

  it("a subject the registry cannot answer fails the whole call, as the SDK's batch does", async () => {
    const subjects = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      urn: `fl:parcel:us-48997:${1000001 + i}`,
    }));
    const unavailable = {
      ok: false,
      error: {
        error: "RegistryUnavailable",
        message: "the hosted registry cannot answer this subject",
        issues: [],
      },
    };
    // The registry answers RegistryUnavailable for one subject: that outcome is the call's.
    const one = registryService({
      answer: (tool, input) =>
        (input as { urn?: string }).urn === subjects[1]!.urn
          ? unavailable
          : runTool(tool, input),
    });
    const out = await withRunner(one.binding, () =>
      runToolAsync(BATCH, { subjects }),
    );
    assert.deepEqual(out, unavailable);
    assert.ok(
      one.calls.length < subjects.length,
      `no further subjects are sent (${one.calls.length} calls)`,
    );
    // The service fails for one subject (a 503 from the binding): the catalog's RegistryUnavailable.
    const down = registryService({
      answer: (tool, input) =>
        (input as { urn?: string }).urn === subjects[2]!.urn
          ? new Response("no", { status: 503 })
          : runTool(tool, input),
    });
    const out2 = await withRunner(down.binding, () =>
      runToolAsync(BATCH, { subjects }),
    );
    assert.equal(out2.ok, false);
    if (!out2.ok) {
      assert.equal(out2.error.error, "RegistryUnavailable");
      assert.equal(
        out2.error.message,
        "the registry service did not answer; retry in a moment",
      );
    }
    assert.ok(down.calls.length < subjects.length);
    // The single tool still goes through as one call.
    const single = registryService();
    const s = await withRunner(single.binding, () =>
      runToolAsync(SINGLE, { urn: subjects[0]!.urn }),
    );
    assert.equal(s.ok, true);
    assert.deepEqual(
      single.calls.map((c) => c.tool),
      [SINGLE],
    );
  });

  /** The real @factlot/server handler, as the Worker runs it, on a local port. */
  async function realInnerApi(): Promise<{
    api: { fetch(r: Request): Promise<Response> };
    close: () => void;
  }> {
    const handler = createHandler({
      maxBodyBytes: 1024 * 1024,
      trustProxy: true,
      logSink: () => {},
    });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const { port } = server.address() as AddressInfo;
    return {
      close: () => server.close(),
      api: {
        fetch: async (r: Request) => {
          const u = new URL(r.url);
          const headers = new Headers(r.headers);
          headers.delete("host");
          headers.delete("content-length");
          return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
            method: r.method,
            headers,
            body:
              r.method === "GET" || r.method === "HEAD"
                ? undefined
                : await r.text(),
          });
        },
      },
    };
  }
  const usedThisMonth = (e: ReturnType<typeof env>) =>
    e.limiter.object("meter:sub:sub_1").store.counts.get("month:2026-11") ?? 0;

  it("through the router: one lookup per answered subject, REST and MCP", async () => {
    const subjects = [
      { id: "A", urn: "fl:parcel:us-48997:1000001" },
      { id: "B", county_fips: "997", apn: "1000004" },
      { id: "C", urn: "fl:parcel:us-48997:1000010" },
      { id: "D", urn: "fl:parcel:us-48439:00001234" }, // Tarrant
      { id: "E", urn: "fl:parcel:us-04021:50101001" }, // not Texas
      { id: "F", urn: "fl:parcel:us-48997:9999999" }, // a miss
    ];
    const inner = await realInnerApi();
    const service = registryService();
    try {
      await withRunner(service.binding, async () => {
        const e = env();
        const { key } = await issue(e);
        const res = await call(e, inner.api, PATH, {
          key,
          body: { subjects },
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { summary: unknown };
        assert.deepEqual(body.summary, {
          subjects: 6,
          answered: 3,
          errors: 3,
        });
        assert.equal(service.calls.length, 6, "one service call per subject");
        assert.equal(usedThisMonth(e), 3, "three answered subjects charged");
        assert.equal(
          res.headers.get("x-factlot-registry-quota-remaining"),
          "4997",
        );

        const mcp = await handle(
          new Request("https://api.factlot.com/mcp", {
            method: "POST",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: BATCH, arguments: { subjects } },
            }),
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "cf-connecting-ip": IP,
              authorization: `Bearer ${key}`,
            },
          }),
          e,
          inner.api,
          { now: () => e.clock.t },
        );
        assert.equal(mcp.status, 200);
        const m = (await mcp.json()) as {
          result: { isError?: boolean; content: { text: string }[] };
        };
        assert.notEqual(m.result.isError, true);
        assert.deepEqual(
          (JSON.parse(m.result.content[0]!.text) as { summary: unknown })
            .summary,
          { subjects: 6, answered: 3, errors: 3 },
        );
        assert.equal(service.calls.length, 12);
        assert.equal(usedThisMonth(e), 6);
      });
    } finally {
      inner.close();
    }
  });

  it("through the router: a service failure answers RegistryUnavailable and charges nothing", async () => {
    const inner = await realInnerApi();
    const service = registryService({
      answer: () => new Response("no", { status: 503 }),
    });
    try {
      await withRunner(service.binding, async () => {
        const e = env();
        const { key } = await issue(e);
        const res = await call(e, inner.api, PATH, {
          key,
          body: {
            subjects: [
              { id: "A", urn: "fl:parcel:us-48997:1000001" },
              { id: "C", urn: "fl:parcel:us-48997:1000010" },
            ],
          },
        });
        assert.equal(res.status, 503);
        assert.equal(
          ((await res.json()) as { error: string }).error,
          "RegistryUnavailable",
        );
        assert.equal(usedThisMonth(e), 0);
        assert.equal(
          res.headers.get("x-factlot-registry-quota-remaining"),
          "5000",
        );
      });
    } finally {
      inner.close();
    }
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

  it("HEAD (or any non-GET) on the claim URL and the success page never redeems; GET still yields the key", async () => {
    const s = stripe({ session: paid });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const { claim_url } = await start(e, s.fetchImpl);
    const successUrl = `https://factlot.com/billing/success?session_id=${SESSION}`;
    for (const method of ["HEAD", "POST", "PUT", "DELETE"]) {
      e.clock.t += CLAIM_POLL_MS;
      const r = await run(
        e,
        new Request(claim_url, {
          method,
          headers: { "cf-connecting-ip": IP },
        }),
        s.fetchImpl,
      );
      assert.equal(r.status, 405, `claim ${method}`);
      assert.equal(r.headers.get("allow"), "GET");
      const p = await run(
        e,
        new Request(successUrl, {
          method,
          headers: { "cf-connecting-ip": IP },
        }),
        s.fetchImpl,
      );
      assert.equal(p.status, 405, `success ${method}`);
      assert.equal(p.headers.get("allow"), "GET");
    }
    assert.equal(
      [...e.KEYS.data.keys()].filter((k) => k.startsWith("key:")).length,
      0,
      "nothing was redeemed",
    );
    assert.equal(e.KEYS.data.has(`session:${SESSION}`), false);
    e.clock.t += CLAIM_POLL_MS;
    const got = await poll(e, claim_url, s.fetchImpl);
    assert.equal(got.status, 200);
    assert.ok(
      looksLikeKey(String(((await got.json()) as { key: string }).key)),
    );
  });

  it("a paid session older than the 365-day marker cannot mint a key", async () => {
    const s = stripe({
      session: {
        ...paid,
        // The success page reads the wall clock (successRoute takes no test clock), so the
        // session is made old against both clocks.
        created: Math.floor(Math.min(T0, Date.now()) / 1000) - 366 * 86_400,
      },
    });
    const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
    e.RL_ANON = new CountingLimit(100);
    const page = await run(
      e,
      new Request(`https://factlot.com/billing/success?session_id=${SESSION}`, {
        headers: { "cf-connecting-ip": IP },
      }),
      s.fetchImpl,
    );
    assert.equal(page.status, 410);
    assert.equal(
      [...e.KEYS.data.keys()].filter((k) => k.startsWith("key:")).length,
      0,
    );
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
      /ChatGPT developer-mode apps have no header field: they sign in instead/,
    );
    assert.ok(html.includes("https://api.factlot.com/mcp/signin"));
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

  /** The console.error lines written while `fn` runs. */
  async function errorLines(fn: () => Promise<unknown> | unknown) {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => void lines.push(String(line));
    try {
      await fn();
    } finally {
      console.error = original;
    }
    return lines;
  }

  it("a Stripe error that echoes the typed address is logged with status, type and code only", async () => {
    const { e } = setup();
    const echo = fakeStripe({
      "GET /customers": () => [
        400,
        {
          error: {
            type: "invalid_request_error",
            code: "email_invalid",
            message: "Invalid email address: buyer@example.com",
          },
        },
      ],
    });
    const lines = await errorLines(async () => {
      const post = await ask(e, "buyer@example.com", echo.fetchImpl);
      assert.equal(post.status, 200, "the same page as for any address");
      await post.text();
    });
    const stripe = lines.filter((l) => l.includes("stripe call failed"));
    assert.equal(stripe.length, 1, "the failure is still logged");
    assert.ok(!lines.join("\n").includes("example.com"), "no address logged");
    const logged = JSON.parse(stripe[0]!) as Record<string, unknown>;
    assert.equal(logged.where, "recovery lookup");
    assert.equal(logged.status, 400);
    assert.equal(logged.type, "invalid_request_error");
    assert.equal(logged.code, "email_invalid");
    assert.equal(logged.error, undefined, "no message");
  });

  it("logStripeError removes anything shaped like an email address from a message it logs", async () => {
    const lines = await errorLines(() => {
      logStripeError(
        "portal session",
        new StripeError(
          400,
          "Invalid email address: Some.One+tag@sub.example.org, also (other@example.net).",
        ),
      );
      logStripeError("checkout create", new StripeError(404, "No such price"));
    });
    const joined = lines.join("\n");
    assert.ok(!/@/.test(joined), "no @ left in the log");
    assert.ok(!joined.includes("example"), "no address left in the log");
    assert.match(lines[0]!, /Invalid email address: \[email\]/);
    assert.match(lines[1]!, /No such price/, "other messages are kept");
  });

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

describe("batch registry tools: one lookup per answered subject", () => {
  const BATCH = "registry_tx_equity_candidates_batch";
  const PATH = "/v1/registry/tx_equity_candidates/batch";
  const flush = () => new Promise((r) => setTimeout(r, 0));
  // The inner handler's batch answer: a subject whose urn ends in ":miss" is a coverage miss.
  const answerFor = (args: { subjects?: { id: string; urn?: string }[] }) => {
    const results = (args.subjects ?? []).map((s) =>
      s.urn?.endsWith(":miss")
        ? {
            id: s.id,
            error: {
              error: "NotFound",
              message: "not loaded",
              issues: [],
              coverage: { county_loaded: false },
            },
          }
        : { id: s.id, subject: { id: s.urn ?? s.id }, candidates: [] },
    );
    const errors = results.filter((r) => "error" in r).length;
    return {
      results,
      summary: {
        subjects: results.length,
        answered: results.length - errors,
        errors,
      },
      rule: "rule",
      notice: "notice",
    };
  };
  function batchApi() {
    const seen: string[] = [];
    return {
      seen,
      fetch: async (r: Request) => {
        const path = new URL(r.url).pathname;
        const text = await r.text();
        seen.push(path);
        const body = (x: unknown) =>
          new Response(JSON.stringify(x), {
            headers: { "content-type": "application/json" },
          });
        if (path !== "/mcp") {
          const args = JSON.parse(text) as { subjects?: unknown };
          if (!Array.isArray(args.subjects))
            return new Response(
              JSON.stringify({ error: "InputError", message: "subjects" }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              },
            );
          return body(answerFor(args as never));
        }
        const parsed = JSON.parse(text) as unknown;
        const items = (Array.isArray(parsed) ? parsed : [parsed]) as {
          id: number;
          params: { name: string; arguments: never };
        }[];
        const out = items.map((m) => ({
          jsonrpc: "2.0",
          id: m.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  m.params.name === BATCH
                    ? answerFor(m.params.arguments)
                    : { record: { urn: "fl:parcel:us-11001:x" } },
                ),
              },
            ],
          },
        }));
        return body(Array.isArray(parsed) ? out : out[0]);
      },
    };
  }
  const subjects = (...urns: string[]) =>
    urns.map((urn, i) => ({ id: `s${i}`, urn }));
  const batchCall = (id: number, args: unknown) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: BATCH, arguments: args },
  });
  const remaining = (r: Response) =>
    Number(r.headers.get("x-factlot-registry-quota-remaining"));

  it("REST: reserves one per subject, keeps one per answered subject, gives back the misses", async () => {
    const e = env();
    e.RL_ANON = new CountingLimit(100);
    const api = batchApi();
    const res = await call(e, api, PATH, {
      body: {
        subjects: subjects(
          "fl:parcel:us-48201:1",
          "fl:parcel:us-48201:miss",
          "fl:parcel:us-48113:2",
        ),
      },
    });
    assert.equal(res.status, 200);
    assert.equal(remaining(res), 23, "two answered subjects are charged");
    const q = await e.METER.quota(await addressSubject(IP, T0), "day", 25);
    assert.equal(q.used, 2, "the meter agrees with the headers");
    // An invalid subject list reserves one lookup and, as an input error, is free.
    const bad = await call(e, api, PATH, { body: { subjects: "x" } });
    assert.equal(bad.status, 400);
    assert.equal(remaining(bad), 23);
  });

  it("REST: a batch larger than what remains is refused whole and takes nothing", async () => {
    const e = env();
    e.RL_ANON = new CountingLimit(100);
    const api = batchApi();
    const who = await addressSubject(IP, T0);
    await e.METER.consume(who, { kind: "day", limit: 25, n: 24 });
    const res = await call(e, api, PATH, {
      body: {
        subjects: subjects("fl:parcel:us-48201:1", "fl:parcel:us-48201:2"),
      },
    });
    assert.equal(res.status, 429);
    const err = (await res.json()) as { error: string; message: string };
    assert.equal(err.error, "RegistryQuotaExceeded");
    assert.match(
      err.message,
      /needs 2 registry lookups \(one per subject\) but only 1 of today's 25 free lookups for this IP address are left/,
    );
    assert.match(err.message, /Send 1 subjects or fewer/);
    assert.equal(remaining(res), 1);
    assert.deepEqual(api.seen, [], "the inner handler never ran");
    assert.equal((await e.METER.quota(who, "day", 25)).used, 24);
  });

  it("MCP with a key: charges answered subjects; account usage records each subject's region", async () => {
    const e = env();
    const { key } = await issue(e);
    const api = batchApi();
    const res = await call(e, api, "/mcp", {
      key,
      body: [
        batchCall(1, {
          subjects: [
            { id: "a", urn: "fl:parcel:us-48201:1" },
            { id: "b", county_fips: "113", apn: "2" },
            { id: "c", urn: "fl:parcel:us-48201:miss" },
          ],
        }),
        toolCall("registry_get", 2),
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(remaining(res), 4997, "two subjects and one record");
    await flush();
    const u = (await (
      await call(e, api, "/v1/account/usage", { key, method: "GET" })
    ).json()) as {
      by_tool: Record<string, number>;
      by_region: Record<string, number>;
      month: { used: number };
    };
    assert.deepEqual(u.by_tool, { [BATCH]: 2, registry_get: 1 });
    assert.equal(u.by_region["us-48"], 2);
    assert.equal(u.month.used, 3);
  });

  it("MCP: a batch that does not fit is refused as a tool error while smaller calls run", async () => {
    const e = env();
    e.RL_ANON = new CountingLimit(100);
    const api = batchApi();
    const who = await addressSubject(IP, T0);
    await e.METER.consume(who, { kind: "day", limit: 25, n: 23 });
    const res = await call(e, api, "/mcp", {
      body: [
        batchCall(1, {
          subjects: subjects(
            "fl:parcel:us-48201:1",
            "fl:parcel:us-48201:2",
            "fl:parcel:us-48201:3",
          ),
        }),
        toolCall("registry_get", 2),
      ],
    });
    assert.equal(res.status, 200);
    const out = (await res.json()) as {
      id: number;
      result: { isError?: boolean; content: { text: string }[] };
    }[];
    const refused = out.find((m) => m.id === 1)!;
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0]!.text, /needs 3 registry lookups/);
    assert.notEqual(out.find((m) => m.id === 2)!.result.isError, true);
    assert.equal(
      (await e.METER.quota(who, "day", 25)).used,
      24,
      "only the record is charged; the unused lookup is given back",
    );
  });
});

describe("account, onboarding and OpenAPI: reports and the model-backed tools", () => {
  const MODEL = { ANTHROPIC_API_KEY: "test-placeholder" };
  async function used(e: ReturnType<typeof env>) {
    await e.METER.consume(modelSubject("ingest_pages", "sub:sub_1"), {
      kind: "month",
      limit: 100,
      n: 7,
    });
    await e.METER.consume("sub:sub_1", {
      kind: "month",
      limit: 50,
      n: 1,
      counter: "reports",
    });
  }
  type Summary = {
    model_tools: { available: boolean; tools: string[] };
    ingest_pages: { used: number; limit: number; resets_at: string };
    narratives: { used: number; limit: number };
    reports: { used: number; limit: number };
    registry_lookups: { used: number };
  };

  it("/v1/account and account_status: allowances used, the model tools while they are on", async () => {
    const e = env(MODEL);
    const { key } = await issue(e);
    await used(e);
    const { api } = innerApi();
    const a = (await (
      await call(e, api, "/v1/account", { key, method: "GET" })
    ).json()) as Summary;
    assert.deepEqual(a.model_tools, {
      available: true,
      tools: ["doc_extract_lease", "report_narrative"],
    });
    assert.deepEqual([a.ingest_pages.used, a.ingest_pages.limit], [7, 100]);
    assert.equal(a.ingest_pages.resets_at, "2026-12-01T00:00:00.000Z");
    assert.deepEqual([a.narratives.used, a.narratives.limit], [0, 50]);
    assert.deepEqual([a.reports.used, a.reports.limit], [1, 50]);
    assert.equal(a.registry_lookups.used, 0, "counters stay apart");
    const status = (await (
      await call(e, api, "/mcp", { key, body: toolCall("account_status") })
    ).json()) as { result: { structuredContent: Summary } };
    assert.deepEqual(
      status.result.structuredContent.model_tools,
      a.model_tools,
    );
    assert.equal(status.result.structuredContent.reports.used, 1);
    const off = env();
    const k2 = (await issue(off)).key;
    const b = (await (
      await call(off, api, "/v1/account", { key: k2, method: "GET" })
    ).json()) as Summary;
    assert.deepEqual(b.model_tools, { available: false, tools: [] });
    assert.equal(
      b.ingest_pages.limit,
      100,
      "the allowance is shown either way",
    );
  });

  it("/account shows reports, the model tools and what counts", async () => {
    const e = env(MODEL);
    e.RL_ANON = new CountingLimit(100);
    const { key } = await issue(e);
    await used(e);
    const res = await handle(
      new Request("https://factlot.com/account", {
        method: "POST",
        body: new URLSearchParams({ key }).toString(),
        headers: { origin: "https://factlot.com", "cf-connecting-ip": IP },
      }),
      e,
      innerApi().api,
      { now: () => T0 },
    );
    const html = await res.text();
    assert.match(
      html,
      /1 of 50 built this month with <code>report_create<\/code>/,
    );
    assert.match(html, /<code>doc_extract_lease<\/code>: 7 of 100 pages used/);
    assert.ok(html.includes(escapeHtml(REPORT_RULE)));
  });

  it("the key page numbers the reports step and keeps the limits step last", async () => {
    const html = await onboardingPage({}).text();
    assert.match(html, /Five steps/);
    assert.match(
      html,
      /<span class="n">4<\/span>Build a report: XLSX, PDF or ICS/,
    );
    assert.match(html, /<span class="n">5<\/span>Know your limits/);
    assert.match(html, /critical-dates calendar for this lease as an ICS file/);
    assert.ok(!/Claude, which/.test(html));
  });

  it("/v1/onboarding: the extract-lease step and report_create, in JSON and Markdown", async () => {
    const e = env();
    const { api } = innerApi();
    const g = (await (
      await call(e, api, "/v1/onboarding?plan=pro", { method: "GET" })
    ).json()) as {
      extract_lease: { title: string; available: boolean; rest: string };
      reports: { mcp_tool: string; per_month: { pro: number } };
    };
    assert.equal(g.extract_lease.title, EXTRACT_LEASE_STEP);
    assert.equal(g.extract_lease.available, false);
    assert.equal(
      g.extract_lease.rest,
      "POST https://api.factlot.com/v1/doc/extract_lease",
    );
    assert.equal(g.reports.mcp_tool, "report_create");
    assert.equal(g.reports.per_month.pro, 50);
    const md = await (
      await call(e, api, "/v1/onboarding?format=md", { method: "GET" })
    ).text();
    assert.ok(md.includes(`## ${EXTRACT_LEASE_STEP}`));
    assert.match(md, /report_create/);
    assert.ok(md.includes(`## 4. ${REPORTS_STEP}`));
    assert.ok(md.includes("## 5. Know your limits"));
    assert.match(
      md,
      /Pro: \$49 a month for 5,000 registry lookups.*50 reports a month/,
    );
    assert.ok(!/Claude, which|with Claude, verified/.test(md));
    const on = (await (
      await call(env(MODEL), api, "/v1/onboarding", { method: "GET" })
    ).json()) as { extract_lease: { available: boolean } };
    assert.equal(on.extract_lease.available, true);
  });

  it("OpenAPI: report_create always, the model tools while they are on", async () => {
    const inner = {
      fetch: async (r: Request) =>
        new Response(
          JSON.stringify({
            openapi:
              new URL(r.url).pathname === "/openapi.json" ? "3.1.0" : "3.0.3",
            paths: { "/v1/calc/irr": { post: { operationId: "calc_irr" } } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };
    const paths = async (e: ReturnType<typeof env>, doc: string) =>
      (
        (await (await call(e, inner, doc, { method: "GET" })).json()) as {
          paths: Record<string, { post?: { operationId: string } }>;
        }
      ).paths;
    const on = await paths(env(MODEL), "/openapi.json");
    assert.equal(on["/v1/calc/irr"]!.post!.operationId, "calc_irr");
    assert.equal(on["/v1/reports"]!.post!.operationId, "report_create");
    assert.ok(on["/v1/reports/d/{token}"]);
    assert.equal(
      on["/v1/doc/extract_lease"]!.post!.operationId,
      "doc_extract_lease",
    );
    assert.equal(
      on["/v1/report/narrative"]!.post!.operationId,
      "report_narrative",
    );
    const off = await paths(env(), "/openapi.json");
    assert.ok(off["/v1/reports"]);
    assert.equal(off["/v1/doc/extract_lease"], undefined);
    const all30 = await paths(env(MODEL), "/openapi-3.0.json?operations=all");
    assert.ok(all30["/v1/doc/extract_lease"] && all30["/v1/reports"]);
    const bedrock = await paths(
      env(MODEL),
      "/openapi-3.0.json?profile=bedrock&operations=all",
    );
    assert.ok(bedrock["/v1/doc/extract_lease"] && bedrock["/v1/reports"]);
    assert.ok(
      !/"enum"/.test(JSON.stringify(bedrock)),
      "the Bedrock profile has no enum in the Worker's own operations",
    );
    assert.match(JSON.stringify(all30), /"enum"/);
    const subset = await paths(env(MODEL), "/openapi-3.0.json");
    assert.deepEqual(
      Object.keys(subset),
      ["/v1/calc/irr"],
      "the GPT subset is unchanged",
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
    // The "Hosted regions" note is generated from site/_data/hosted.json (scripts/site/gen-hosted.ts).
    assert.ok(
      html.includes(escapeHtml(HOSTING_NOTE)),
      "the account page states the generated hosted note",
    );
    assert.match(HOSTING_NOTE, /^Hosted regions: .*Texas counties \(Harris, /);
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
    // Unreleased and the latest release: a release moves the lines out of Unreleased.
    const start = changelog.indexOf("## [Unreleased]");
    const latest = changelog.indexOf("\n## [", start + 5);
    const end = changelog.indexOf("\n## [", latest + 5);
    const recent = changelog.slice(start, end === -1 ? undefined : end);
    for (const w of WHATS_NEW)
      assert.ok(recent.includes(w.changelog), w.changelog);
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

describe("per-subject metering: registry_tx_equity_candidates_batch", () => {
  const BATCH = "registry_tx_equity_candidates_batch";
  const PATH = "/v1/registry/tx_equity_candidates/batch";
  const flush = () => new Promise((r) => setTimeout(r, 0));
  type Subject = {
    id: string;
    urn?: string;
    county_fips?: string;
    apn?: string;
  };
  // Loaded: county 997 in Texas. Anything else is a per-subject error.
  const loaded = (s: Subject) =>
    s.urn?.startsWith("fl:parcel:us-48997:") === true ||
    s.county_fips === "997";
  const batchAnswer = (args: { subjects?: Subject[] }) => {
    const subjects = args.subjects ?? [];
    const results = subjects.map((s) =>
      loaded(s)
        ? { id: s.id, subject: { id: s.urn ?? s.apn }, candidates: [] }
        : {
            id: s.id,
            error: {
              error: "NotFound",
              message: "not in the registry",
              coverage: { county_loaded: false },
            },
          },
    );
    const answered = results.filter((r) => !("error" in r)).length;
    return {
      results,
      summary: {
        subjects: subjects.length,
        answered,
        errors: subjects.length - answered,
      },
      rule: "rule",
      notice: "notice",
    };
  };
  /** Lookups taken from sub_1's month at this moment. */
  const used = (e: ReturnType<typeof env>) =>
    e.limiter.object("meter:sub:sub_1").store.counts.get("month:2026-11") ?? 0;
  /** The inner handler; `seen` records each forwarded request and the lookups held meanwhile. */
  function batchApi(e: ReturnType<typeof env>, opts: { down?: boolean } = {}) {
    const seen: { path: string; body: string; held: number }[] = [];
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const api = {
      fetch: async (r: Request) => {
        const path = new URL(r.url).pathname;
        const body = await r.text();
        seen.push({ path, body, held: used(e) });
        if (opts.down)
          return reply(503, {
            error: "RegistryUnavailable",
            message: "registry service answered 503",
            issues: [],
          });
        if (path === PATH) {
          try {
            return reply(200, batchAnswer(JSON.parse(body)));
          } catch {
            return reply(400, { error: "BadRequest", message: "not JSON" });
          }
        }
        if (path === "/mcp") {
          const parsed = JSON.parse(body) as unknown;
          const items = (Array.isArray(parsed) ? parsed : [parsed]) as {
            id: number;
            params: { name: string; arguments?: { subjects?: Subject[] } };
          }[];
          const out = items.map((m) => ({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    m.params.name === BATCH
                      ? batchAnswer(m.params.arguments ?? {})
                      : { record: { urn: "fl:parcel:us-24510:0001" } },
                  ),
                },
              ],
            },
          }));
          return reply(200, Array.isArray(parsed) ? out : out[0]);
        }
        return reply(200, {});
      },
    };
    return { api, seen };
  }
  const five: Subject[] = [
    { id: "A", urn: "fl:parcel:us-48997:1000001" },
    { id: "B", county_fips: "997", apn: "1000004" },
    { id: "C", urn: "fl:parcel:us-48997:1000010" },
    { id: "D", urn: "fl:parcel:us-48439:00001234" }, // Tarrant: withheld
    { id: "E", urn: "fl:parcel:us-04021:50101001" }, // not Texas
  ];
  const remaining = (r: Response) =>
    r.headers.get("x-factlot-registry-quota-remaining");
  async function usage(e: ReturnType<typeof env>, key: string) {
    await flush();
    const res = await call(e, innerApi().api, "/v1/account/usage", {
      key,
      method: "GET",
    });
    return (await res.json()) as {
      total: number;
      by_tool: Record<string, number>;
      by_region: Record<string, number>;
    };
  }

  it("REST: 5 subjects, 3 answered: 5 held, 3 charged, 2 given back, usage ×3 in us-48", async () => {
    const e = env();
    const { key } = await issue(e);
    const { api, seen } = batchApi(e);
    const res = await call(e, api, PATH, { key, body: { subjects: five } });
    assert.equal(res.status, 200);
    assert.equal(
      seen[0]!.held,
      5,
      "the whole batch was reserved before it ran",
    );
    assert.deepEqual(
      (JSON.parse(seen[0]!.body) as { subjects: Subject[] }).subjects,
      five,
      "the body reached the inner handler unchanged",
    );
    assert.equal(used(e), 3);
    assert.equal(remaining(res), "4997");
    const body = (await res.json()) as { summary: { answered: number } };
    assert.equal(body.summary.answered, 3, "the answer is readable");
    const u = await usage(e, key);
    assert.equal(u.total, 3);
    assert.deepEqual(u.by_tool, { [BATCH]: 3 });
    assert.deepEqual(u.by_region, { "us-48": 3 });
  });

  it("REST: a batch where every subject misses is free", async () => {
    const e = env();
    const { key } = await issue(e);
    const { api, seen } = batchApi(e);
    const res = await call(e, api, PATH, {
      key,
      body: { subjects: five.slice(3) },
    });
    assert.equal(res.status, 200);
    assert.equal(seen[0]!.held, 2);
    assert.equal(used(e), 0);
    assert.equal(remaining(res), "5000");
    assert.equal((await usage(e, key)).total, 0);
  });

  it("REST: an unreadable body holds 1 lookup and gives it back on the 4xx", async () => {
    const e = env();
    const { key } = await issue(e);
    const { api, seen } = batchApi(e);
    const res = await handle(
      new Request(`https://api.factlot.com${PATH}`, {
        method: "POST",
        body: "{not json",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": IP,
          authorization: `Bearer ${key}`,
        },
      }),
      e,
      api,
      { now: () => e.clock.t },
    );
    assert.equal(res.status, 400);
    assert.equal(seen[0]!.held, 1);
    assert.equal(used(e), 0);
    assert.equal(remaining(res), "5000");
  });

  it("REST: RegistryUnavailable gives every reserved lookup back", async () => {
    const e = env();
    const { key } = await issue(e);
    const { api, seen } = batchApi(e, { down: true });
    const res = await call(e, api, PATH, { key, body: { subjects: five } });
    assert.equal(res.status, 503);
    assert.equal(seen[0]!.held, 5);
    assert.equal(used(e), 0);
    assert.equal(remaining(res), "5000");
  });

  it("MCP: a 4-subject batch call and a registry_get hold 5 and are charged per answer", async () => {
    const e = env();
    const { key } = await issue(e);
    const { api, seen } = batchApi(e);
    const res = await call(e, api, "/mcp", {
      key,
      body: [
        {
          ...toolCall(BATCH, 1),
          params: { name: BATCH, arguments: { subjects: five.slice(1) } },
        },
        toolCall("registry_get", 2),
        toolCall("calc_irr", 3),
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(seen[0]!.held, 5);
    assert.equal(used(e), 3, "B and C answered, plus the record");
    assert.equal(remaining(res), "4997");
    const u = await usage(e, key);
    assert.deepEqual(u.by_tool, { [BATCH]: 2, registry_get: 1 });
    assert.deepEqual(u.by_region, { "us-48": 2, other: 1 });
  });

  it("over the cap: fewer lookups left than subjects refuses the whole call and names the shortfall", async () => {
    const e = env();
    const { key } = await issue(e);
    e.limiter.object("meter:sub:sub_1").store.setCount("month:2026-11", 4_998);
    const { api, seen } = batchApi(e);
    const res = await call(e, api, PATH, { key, body: { subjects: five } });
    assert.equal(res.status, 429);
    assert.equal(seen.length, 0, "nothing ran");
    assert.equal(used(e), 4_998, "the 2 granted were given back");
    assert.equal(remaining(res), "2");
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    const err = (await res.json()) as {
      error: string;
      message: string;
      needed: number;
      available: number;
      next: string;
    };
    assert.equal(err.error, "RegistryQuotaExceeded");
    assert.deepEqual([err.needed, err.available], [5, 2]);
    assert.match(err.message, /needs 5 registry lookups \(one per subject\)/);
    assert.match(err.message, /only 2 of this subscription's 5,000/);
    assert.match(err.next, /send 2 subjects or fewer/);
    // Two subjects still fit.
    const ok = await call(e, api, PATH, {
      key,
      body: { subjects: five.slice(0, 2) },
    });
    assert.equal(ok.status, 200);
    assert.equal(used(e), 5_000);
  });

  it("over the cap on MCP: the batch call is a tool error; a call that fits still runs", async () => {
    const e = env();
    const { key } = await issue(e);
    e.limiter.object("meter:sub:sub_1").store.setCount("month:2026-11", 4_998);
    const { api, seen } = batchApi(e);
    const res = await call(e, api, "/mcp", {
      key,
      body: [
        {
          ...toolCall(BATCH, 1),
          params: { name: BATCH, arguments: { subjects: five } },
        },
        toolCall("registry_get", 2),
      ],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      (JSON.parse(seen[0]!.body) as { id: number }[]).map((m) => m.id),
      [2],
    );
    const answers = (await res.json()) as {
      id: number;
      result: { isError?: boolean; content: { text: string }[] };
    }[];
    const refused = answers.find((a) => a.id === 1)!;
    assert.equal(refused.result.isError, true);
    const err = JSON.parse(refused.result.content[0]!.text) as {
      error: string;
      needed: number;
      available: number;
    };
    assert.equal(err.error, "RegistryQuotaExceeded");
    assert.equal(err.needed, 5);
    assert.equal(
      used(e),
      4_999,
      "the record is charged; the unused one went back",
    );
    assert.equal(remaining(res), "1");
  });

  it("free tier: 50 subjects need more than the 25 a day; refused whole", async () => {
    const e = env();
    const { api, seen } = batchApi(e);
    const subjects = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      urn: `fl:parcel:us-48997:${1000000 + i}`,
    }));
    const res = await call(e, api, PATH, { body: { subjects } });
    assert.equal(res.status, 429);
    assert.equal(seen.length, 0);
    assert.equal(remaining(res), "25");
    const err = (await res.json()) as { needed: number; available: number };
    assert.deepEqual([err.needed, err.available], [50, 25]);
    const q = await e.METER.quota(await addressSubject(IP, T0), "day", 25);
    assert.equal(q.used, 0);
  });
});

describe("paid gating (GATING_ENABLED)", () => {
  const record = {
    urn: "fl:parcel:us-48201:1",
    facts: [{ id: "f2", predicate: "parcel.market_value", value: 200 }],
    value_history: [
      { tax_year: 2026, market_value: 200, appraised_value: 190 },
      { tax_year: 2025, market_value: 1234567, appraised_value: 1111111 },
      { tax_year: 2024, market_value: 7654321, appraised_value: 7000001 },
    ],
    history: [
      { id: "f2", predicate: "parcel.market_value", value: 200 },
      { id: "f1", predicate: "parcel.market_value", value: 1234567 },
    ],
    coverage: { county_loaded: true },
  };
  const BATCH = "registry_tx_equity_candidates_batch";
  const BATCH_PATH = "/v1/registry/tx_equity_candidates/batch";

  /** A free answer must not carry any value from an earlier roll year, in any form. */
  function assertNoWithheldValues(answer: unknown) {
    const text = JSON.stringify(answer);
    for (const v of ["1234567", "1111111", "7654321", "7000001"])
      assert.ok(!text.includes(v), `free answer leaks ${v}`);
  }

  /** An inner handler that answers registry_get with a parcel carrying prior years. */
  function historyApi() {
    const seen: string[] = [];
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    const api = {
      fetch: async (r: Request) => {
        const body = await r.text();
        const path = new URL(r.url).pathname;
        seen.push(path === "/mcp" ? `mcp:${body}` : path);
        if (path === "/v1/registry/get") return json(record);
        if (path === BATCH_PATH) return json({ results: [{ id: "a" }] });
        if (path === "/mcp") {
          const parsed = JSON.parse(body) as unknown;
          const items = (Array.isArray(parsed) ? parsed : [parsed]) as {
            id: number;
          }[];
          const answers = items.map((m) => ({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(record) }],
              structuredContent: record,
            },
          }));
          return json(answers.length === 1 ? answers[0] : answers);
        }
        return json({ ok: true });
      },
    };
    return { api, seen };
  }

  const on = () => env({ GATING_ENABLED: "true" });

  it("REST: a free caller gets the current roll year only; Pro keeps everything", async () => {
    const { api } = historyApi();
    const free = (await (
      await call(on(), api, "/v1/registry/get", { body: { urn: "x" } })
    ).json()) as typeof record & Record<string, unknown>;
    assert.deepEqual(free.value_history, [record.value_history[0]]);
    assert.deepEqual(free.history, [record.history[0]]);
    assert.equal(free.history_available, "pro");
    assert.deepEqual(free.history_withheld, {
      tax_years: [2025, 2024],
      count: 2,
      facts: 1,
    });
    assert.equal(
      free.history_note,
      "2 earlier roll years, 2024 and 2025, and 1 earlier fact in history, are available with a Pro or Team key: https://factlot.com/pricing/",
    );
    assertNoWithheldValues(free);
    assert.deepEqual(free.coverage, record.coverage);
    assert.deepEqual(free.facts, record.facts);

    const e = on();
    const { key } = await issue(e);
    const pro = (await (
      await call(e, api, "/v1/registry/get", { key, body: { urn: "x" } })
    ).json()) as Record<string, unknown>;
    assert.deepEqual(pro, record);
  });

  it("candidates: a free caller's subject.value_history is cut to the newest year with the note; Pro keeps every year; candidates untouched; flag off unchanged", async () => {
    const cand = {
      subject: { urn: "s", value_history: record.value_history },
      candidates: [{ urn: "c1" }, { urn: "c2" }],
      calc_args: { comparables: [1, 2] },
    };
    const api = {
      fetch: async (r: Request) => {
        const body = await r.text();
        const path = new URL(r.url).pathname;
        const j = (b: unknown) =>
          new Response(JSON.stringify(b), {
            headers: { "content-type": "application/json" },
          });
        if (path === "/mcp") {
          const m = JSON.parse(body) as { id: number };
          return j({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(cand) }],
              structuredContent: cand,
            },
          });
        }
        return j(cand);
      },
    };
    const rest = (await (
      await call(on(), api, "/v1/registry/tx_equity_candidates", {
        body: { urn: "s" },
      })
    ).json()) as typeof cand & Record<string, unknown>;
    assert.deepEqual(rest.subject.value_history, [record.value_history[0]]);
    assert.deepEqual(rest.candidates, cand.candidates);
    assert.deepEqual(rest.calc_args, cand.calc_args);
    assert.equal(rest.history_available, "pro");
    assert.deepEqual(rest.history_withheld, {
      tax_years: [2025, 2024],
      count: 2,
    });
    assert.equal(
      rest.history_note,
      "2 earlier roll years, 2024 and 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
    );
    assertNoWithheldValues(rest);
    assert.equal(rest.subject.urn, "s");

    const mcpFree = (await (
      await call(on(), api, "/mcp", {
        body: toolCall("registry_tx_equity_candidates", 1),
      })
    ).json()) as { result: { structuredContent: typeof rest } };
    assert.equal(
      mcpFree.result.structuredContent.subject.value_history.length,
      1,
    );
    assert.equal(mcpFree.result.structuredContent.history_available, "pro");

    const e = on();
    const { key } = await issue(e);
    const pro = (await (
      await call(e, api, "/v1/registry/tx_equity_candidates", {
        key,
        body: { urn: "s" },
      })
    ).json()) as unknown;
    assert.deepEqual(pro, cand);
    const mcpPro = (await (
      await call(e, api, "/mcp", {
        key,
        body: toolCall("registry_tx_equity_candidates", 1),
      })
    ).json()) as { result: { structuredContent: unknown } };
    assert.deepEqual(mcpPro.result.structuredContent, cand);
    assert.deepEqual(
      await (
        await call(env(), api, "/v1/registry/tx_equity_candidates", {
          body: { urn: "s" },
        })
      ).json(),
      cand,
    );
  });

  /** An inner handler that answers every registry call (REST and MCP) with the given answer. */
  function answerApi(answer: unknown) {
    const j = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    return {
      fetch: async (r: Request) => {
        const body = await r.text();
        if (new URL(r.url).pathname === "/mcp") {
          const m = JSON.parse(body) as { id: number };
          return j({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(answer) }],
              structuredContent: answer,
            },
          });
        }
        return j(answer);
      },
    };
  }

  /** The answer a free caller gets over REST, MCP structuredContent and MCP text. */
  async function freeAnswers(
    answer: unknown,
    tool = "registry_get",
    path = "/v1/registry/get",
  ) {
    const api = answerApi(answer);
    const rest = await (
      await call(on(), api, path, { body: { urn: "x" } })
    ).json();
    const mcp = (await (
      await call(on(), api, "/mcp", { body: toolCall(tool, 1) })
    ).json()) as {
      result: { content: { text: string }[]; structuredContent: unknown };
    };
    return [
      rest,
      mcp.result.structuredContent,
      JSON.parse(mcp.result.content[0]!.text),
    ] as Record<string, unknown>[];
  }

  it("a parcel with one roll year gets no note and no withheld block (REST, MCP structuredContent and text)", async () => {
    const one = {
      urn: "fl:parcel:us-48201:2",
      facts: [{ id: "f2", predicate: "parcel.market_value", value: 200 }],
      value_history: [
        { tax_year: 2026, market_value: 200, appraised_value: 190 },
      ],
      history: [{ id: "f2", predicate: "parcel.market_value", value: 200 }],
    };
    for (const a of await freeAnswers(one)) {
      assert.deepEqual(a, one);
      assert.ok(!("history_note" in a) && !("history_withheld" in a));
      assert.ok(!("history_available" in a));
    }
  });

  it("several roll years: years newest first and a count, in words, and no earlier value anywhere (REST and MCP)", async () => {
    const many = {
      ...record,
      value_history: [
        ...record.value_history,
        { tax_year: 2023, market_value: 3141592, appraised_value: 2718281 },
        { tax_year: 2022, market_value: 1618033, appraised_value: 1414213 },
      ],
      history: [record.history[0]],
    };
    for (const a of await freeAnswers(many)) {
      assert.deepEqual(a.history_withheld, {
        tax_years: [2025, 2024, 2023, 2022],
        count: 4,
      });
      assert.equal(
        a.history_note,
        "4 earlier roll years, 2022 to 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assert.equal(a.history_available, "pro");
      assert.deepEqual(a.value_history, [many.value_history[0]]);
      const text = JSON.stringify(a);
      for (const v of [
        "1234567",
        "1111111",
        "7654321",
        "7000001",
        "3141592",
        "2718281",
        "1618033",
        "1414213",
      ])
        assert.ok(!text.includes(v), `free answer leaks ${v}`);
    }
  });

  it("a parcel whose earlier years are not consecutive lists them", async () => {
    const gap = {
      urn: "u",
      value_history: [
        { tax_year: 2026, market_value: 1 },
        { tax_year: 2024, market_value: 2 },
        { tax_year: 2022, market_value: 3 },
      ],
    };
    const [rest] = await freeAnswers(gap);
    assert.equal(
      rest!.history_note,
      "2 earlier roll years, 2022 and 2024, are available with a Pro or Team key: https://factlot.com/pricing/",
    );
  });

  it("include_history facts removed with no earlier value years: says so, with a count only", async () => {
    const onlyFacts = {
      urn: "u",
      facts: record.facts,
      value_history: [{ tax_year: 2026, market_value: 200 }],
      history: record.history,
    };
    for (const a of await freeAnswers(onlyFacts)) {
      assert.deepEqual(a.history_withheld, { facts: 1 });
      assert.equal(
        a.history_note,
        "1 earlier fact in history is available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assertNoWithheldValues(a);
    }
    const noValues = { urn: "u", facts: record.facts, history: record.history };
    const [rest] = await freeAnswers(noValues);
    assert.deepEqual(rest!.history_withheld, { facts: 1 });
  });

  it("candidates: a one-year subject gets no note; several years get the withheld years; no earlier value (REST and MCP)", async () => {
    const oneYear = {
      subject: {
        urn: "s",
        value_history: [{ tax_year: 2026, market_value: 200 }],
      },
      candidates: [{ urn: "c1" }],
    };
    for (const a of await freeAnswers(
      oneYear,
      "registry_tx_equity_candidates",
      "/v1/registry/tx_equity_candidates",
    )) {
      assert.deepEqual(a, oneYear);
    }
    const several = {
      subject: { urn: "s", value_history: record.value_history },
      candidates: [{ urn: "c1" }],
    };
    for (const a of await freeAnswers(
      several,
      "registry_tx_equity_candidates",
      "/v1/registry/tx_equity_candidates",
    )) {
      assert.deepEqual(a.history_withheld, {
        tax_years: [2025, 2024],
        count: 2,
      });
      assert.equal(a.history_available, "pro");
      assert.ok(!("history_note" in (a.subject as object)));
      assertNoWithheldValues(a);
    }
  });

  /** An owner's portfolio of `n` parcels: two buildings (the first holds parcels 1, 2 and 5), the rest stand alone. */
  function portfolio(n: number) {
    const results = Array.from({ length: n }, (_, i) => ({
      urn: `fl:parcel:us-48201:${9000000 + i + 1}`,
      label: `${100 + i} Example Way`,
      confidence: 1,
      as_of: "2026-01-01",
      building:
        i === 0 || i === 1 || i === 4
          ? "fl:building:us-48201:b1"
          : i === 2 || i === 3
            ? "fl:building:us-48201:b2"
            : null,
    }));
    const count = (b: string) => results.filter((r) => r.building === b).length;
    const buildings = [
      { urn: "fl:building:us-48201:b1", label: "Example Holdings LLC tower" },
      { urn: "fl:building:us-48201:b2", label: "Example Plaza" },
    ]
      .map((b) => ({
        ...b,
        owned_parcels: count(b.urn),
        parcel_count: 8,
        unit_count: 6,
      }))
      .filter((b) => b.owned_parcels > 0);
    return { results, buildings };
  }
  const OWNED = "registry_owned_by";
  const OWNED_PATH = "/v1/registry/owned_by";

  it("registry_owned_by: a free caller keeps the first three parcels, their buildings only, and a note (REST, MCP structuredContent and text)", async () => {
    const big = portfolio(15);
    const answers = await freeAnswers(big, OWNED, OWNED_PATH);
    assert.equal(answers.length, 3);
    for (const a of answers) {
      assert.deepEqual(a.results, big.results.slice(0, 3));
      assert.deepEqual(a.buildings, [
        { ...big.buildings[0]!, owned_parcels: 2 },
        { ...big.buildings[1]!, owned_parcels: 1 },
      ]);
      assert.deepEqual(a.portfolio_withheld, { count: 12, total: 15 });
      assert.equal(
        a.portfolio_note,
        "12 more parcels of this owner are available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assert.ok(!("history_withheld" in a) && !("history_available" in a));
      const text = JSON.stringify(a);
      for (const p of big.results.slice(3))
        assert.ok(!text.includes(p.urn), `free answer leaks ${p.urn}`);
    }
    // MCP text and structuredContent agree.
    assert.deepEqual(answers[1], answers[2]);
    assert.deepEqual(answers[0], answers[1]);
    // One parcel over: the note is singular.
    const [rest] = await freeAnswers(portfolio(4), OWNED, OWNED_PATH);
    assert.deepEqual(rest!.portfolio_withheld, { count: 1, total: 4 });
    assert.equal(
      rest!.portfolio_note,
      "1 more parcel of this owner is available with a Pro or Team key: https://factlot.com/pricing/",
    );
  });

  it("registry_owned_by: a portfolio of three parcels or fewer, or a miss, is unchanged with no note", async () => {
    const miss = {
      results: [],
      buildings: [],
      coverage: { jurisdiction: "us-tx", entity_known: false },
    };
    for (const answer of [portfolio(3), portfolio(1), miss])
      for (const a of await freeAnswers(answer, OWNED, OWNED_PATH)) {
        assert.deepEqual(a, answer);
        assert.ok(!("portfolio_withheld" in a) && !("portfolio_note" in a));
      }
  });

  it("registry_owned_by: a Pro key and gating off get the whole portfolio (REST and MCP)", async () => {
    const big = portfolio(15);
    const api = answerApi(big);
    const e = on();
    const { key } = await issue(e);
    for (const [en, k] of [
      [e, key],
      [env(), undefined],
      [env({ GATING_ENABLED: "yes" }), undefined],
    ] as const) {
      const rest = await (
        await call(en, api, OWNED_PATH, {
          ...(k ? { key: k } : {}),
          body: { entity_urn: "fl:entity:us-tx:1" },
        })
      ).json();
      assert.deepEqual(rest, big);
      const mcp = (await (
        await call(en, api, "/mcp", {
          ...(k ? { key: k } : {}),
          body: toolCall(OWNED, 1),
        })
      ).json()) as {
        result: { content: { text: string }[]; structuredContent: unknown };
      };
      assert.deepEqual(mcp.result.structuredContent, big);
      assert.deepEqual(JSON.parse(mcp.result.content[0]!.text), big);
    }
  });

  it("registry_owned_by: paging arguments do not widen a free answer; the call is answered and cut, not refused", async () => {
    const big = portfolio(15);
    const seen: string[] = [];
    const inner = answerApi(big);
    const api = {
      fetch: async (r: Request) => {
        seen.push(new URL(r.url).pathname);
        return inner.fetch(r);
      },
    };
    const args = {
      entity_urn: "fl:entity:us-tx:1",
      limit: 50,
      offset: 3,
      cursor: "page-2",
      page: 2,
    };
    const rest = await call(on(), api, OWNED_PATH, { body: args });
    assert.equal(rest.status, 200);
    const restBody = (await rest.json()) as Record<string, unknown>;
    assert.deepEqual(restBody.results, big.results.slice(0, 3));
    assert.deepEqual(restBody.portfolio_withheld, { count: 12, total: 15 });
    const mcp = (await (
      await call(on(), api, "/mcp", {
        body: {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: OWNED, arguments: args },
        },
      })
    ).json()) as {
      result: {
        content: { text: string }[];
        structuredContent: Record<string, unknown>;
      };
    };
    for (const a of [
      mcp.result.structuredContent,
      JSON.parse(mcp.result.content[0]!.text) as Record<string, unknown>,
    ]) {
      assert.deepEqual(a.results, big.results.slice(0, 3));
      assert.deepEqual(a.portfolio_withheld, { count: 12, total: 15 });
    }
    assert.deepEqual(seen, [OWNED_PATH, "/mcp"]);
  });

  it("MCP batch: registry_owned_by and registry_get in one request each get their own cut", async () => {
    const big = portfolio(15);
    const j = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    const api = {
      fetch: async (r: Request) => {
        const items = JSON.parse(await r.text()) as {
          id: number;
          params: { name: string };
        }[];
        return j(
          items.map((m) => {
            const answer = m.params.name === OWNED ? big : record;
            return {
              jsonrpc: "2.0",
              id: m.id,
              result: {
                content: [{ type: "text", text: JSON.stringify(answer) }],
                structuredContent: answer,
              },
            };
          }),
        );
      },
    };
    const res = (await (
      await call(on(), api, "/mcp", {
        body: [toolCall(OWNED, 1), toolCall("registry_get", 2)],
      })
    ).json()) as {
      id: number;
      result: { structuredContent: Record<string, unknown> };
    }[];
    const owned = res.find((m) => m.id === 1)!.result.structuredContent;
    const got = res.find((m) => m.id === 2)!.result.structuredContent;
    assert.deepEqual(owned.portfolio_withheld, { count: 12, total: 15 });
    assert.ok(!("history_withheld" in owned));
    assert.equal((got.value_history as unknown[]).length, 1);
    assert.ok(!("portfolio_withheld" in got));
  });

  /** An entity's registry_get record with `n` "owns" rows to parcels, plus rows of other kinds. */
  function entityRecord(n: number) {
    const urn = "fl:entity:us-tx:0809999999";
    const owns = Array.from({ length: n }, (_, i) => ({
      from_urn: urn,
      type: "owns",
      to_urn: `fl:parcel:us-48201:${8000000 + i + 1}`,
      as_of: `2026-01-${String(20 - i).padStart(2, "0")}`,
      method: "name_match",
      confidence: 0.9,
      basis: "owner of record name matches the entity's legal name",
      document_id: "doc-roll-2026",
    }));
    const other = [
      {
        from_urn: urn,
        type: "successor_of",
        to_urn: "fl:entity:us-tx:0808888888",
        as_of: "2025-06-01",
      },
      {
        from_urn: "fl:entity:us-tx:0807777777",
        type: "owns",
        to_urn: urn,
        as_of: "2025-05-01",
      },
    ];
    return {
      urn,
      kind: "entity",
      label: "Example Holdings LLC",
      facts: [
        {
          id: "e1",
          predicate: "entity.legal_name",
          value: "Example Holdings LLC",
        },
      ],
      // Other rows sit between the owns rows, so order is checked too.
      relationships: [
        ...owns.slice(0, 2),
        other[0],
        ...owns.slice(2),
        other[1],
      ],
      crosswalk: [],
    };
  }

  it("registry_get on an entity: a free caller keeps the first three owns rows to parcels, other rows untouched, with a note (REST, MCP structuredContent and text)", async () => {
    const ent = entityRecord(11);
    const answers = await freeAnswers(ent);
    for (const a of answers) {
      assert.deepEqual(a.relationships, [
        ent.relationships[0],
        ent.relationships[1],
        ent.relationships[2],
        ent.relationships[3],
        ent.relationships.at(-1),
      ]);
      assert.deepEqual(a.portfolio_withheld, { count: 8, total: 11 });
      assert.equal(
        a.portfolio_note,
        "8 more parcels of this owner are available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assert.deepEqual(a.facts, ent.facts);
      const text = JSON.stringify(a);
      for (const r of ent.relationships.slice(4, -1))
        assert.ok(!text.includes(r!.to_urn), `free answer leaks ${r!.to_urn}`);
    }
    assert.deepEqual(answers[0], answers[1]);
    assert.deepEqual(answers[1], answers[2]);
  });

  it("registry_get: an entity with three owned parcels or fewer, and a parcel with many relationships, are unchanged", async () => {
    const parcel = {
      urn: "fl:parcel:us-48201:8000001",
      kind: "parcel",
      relationships: entityRecord(6).relationships.map((r) => ({
        ...r,
        from_urn: "fl:entity:us-tx:0809999999",
        to_urn: "fl:parcel:us-48201:8000001",
      })),
    };
    for (const answer of [entityRecord(3), entityRecord(0), parcel])
      for (const a of await freeAnswers(answer)) {
        assert.deepEqual(a, answer);
        assert.ok(!("portfolio_withheld" in a) && !("portfolio_note" in a));
      }
  });

  it("registry_get on an entity: a Pro key and gating off get every relationship (REST and MCP)", async () => {
    const ent = entityRecord(11);
    const api = answerApi(ent);
    const e = on();
    const { key } = await issue(e);
    for (const [en, k] of [
      [e, key],
      [env(), undefined],
    ] as const) {
      const auth = k ? { key: k } : {};
      assert.deepEqual(
        await (
          await call(en, api, "/v1/registry/get", {
            ...auth,
            body: { urn: ent.urn },
          })
        ).json(),
        ent,
      );
      const mcp = (await (
        await call(en, api, "/mcp", {
          ...auth,
          body: toolCall("registry_get", 1),
        })
      ).json()) as {
        result: { content: { text: string }[]; structuredContent: unknown };
      };
      assert.deepEqual(mcp.result.structuredContent, ent);
      assert.deepEqual(JSON.parse(mcp.result.content[0]!.text), ent);
    }
  });

  it("registry_get on an entity with include_history: the history cut and the portfolio cut together", async () => {
    const base = entityRecord(5);
    const ent = {
      ...base,
      history: [
        base.facts[0],
        {
          id: "e0",
          predicate: "entity.legal_name",
          value: "Example Holdings Ltd",
        },
      ],
    };
    for (const a of await freeAnswers(ent)) {
      assert.deepEqual(a.history, [base.facts[0]]);
      assert.deepEqual(a.history_withheld, { facts: 1 });
      assert.equal(a.history_available, "pro");
      assert.equal(
        a.history_note,
        "1 earlier fact in history is available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assert.deepEqual(a.portfolio_withheld, { count: 2, total: 5 });
      assert.equal(
        a.portfolio_note,
        "2 more parcels of this owner are available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assert.equal((a.relationships as unknown[]).length, 3 + 2);
    }
  });

  /** Parcel numbers of `rows` link rows, one per roll-year document; the parcel of row i is parcelOf[i]. */
  function repeated(parcelOf: number[]) {
    return parcelOf.map((p, i) => ({
      urn: `fl:parcel:us-48041:${7000000 + p}`,
      as_of: `${2022 + (i % 5)}-01-01`,
      document_id: `doc-roll-${2022 + (i % 5)}`,
    }));
  }
  // 10 rows over 2 parcels; 12 rows over 5 parcels, first seen in the order 1, 2, 3, 4, 5.
  const TEN_ON_TWO = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2];
  const TWELVE_ON_FIVE = [1, 2, 1, 3, 2, 4, 3, 1, 5, 4, 5, 3];

  it("registry_owned_by with repeated rows: parcels are counted by distinct URN", async () => {
    const owned = (parcelOf: number[]) => {
      const results = repeated(parcelOf).map((r) => ({
        ...r,
        building:
          r.urn.endsWith("7000001") || r.urn.endsWith("7000002")
            ? "fl:building:us-48041:b1"
            : null,
      }));
      return {
        results,
        buildings: [
          {
            urn: "fl:building:us-48041:b1",
            label: "Example Plaza",
            owned_parcels: results.filter((r) => r.building !== null).length,
            parcel_count: 4,
            unit_count: 2,
          },
        ],
      };
    };
    const small = owned(TEN_ON_TWO);
    for (const a of await freeAnswers(small, OWNED, OWNED_PATH)) {
      assert.deepEqual(a, small);
      assert.ok(!("portfolio_withheld" in a) && !("portfolio_note" in a));
    }
    const big = owned(TWELVE_ON_FIVE);
    const keep = new Set(
      [1, 2, 3].map((p) => `fl:parcel:us-48041:${7000000 + p}`),
    );
    for (const a of await freeAnswers(big, OWNED, OWNED_PATH)) {
      assert.deepEqual(
        a.results,
        big.results.filter((r) => keep.has(r.urn)),
      );
      assert.equal((a.results as unknown[]).length, 8);
      assert.deepEqual(a.buildings, [
        { ...big.buildings[0]!, owned_parcels: 2 },
      ]);
      assert.deepEqual(a.portfolio_withheld, { count: 2, total: 5 });
      assert.equal(
        a.portfolio_note,
        "2 more parcels of this owner are available with a Pro or Team key: https://factlot.com/pricing/",
      );
      const text = JSON.stringify(a);
      for (const p of [7000004, 7000005])
        assert.ok(!text.includes(String(p)), `free answer leaks ${p}`);
    }
  });

  it("registry_get on an entity with repeated owns rows: parcels are counted by distinct to_urn", async () => {
    const urn = "fl:entity:us-tx:0806666666";
    const record = (parcelOf: number[]) => ({
      urn,
      kind: "entity",
      label: "Example Holdings LLC",
      relationships: [
        ...repeated(parcelOf).map((r) => ({
          from_urn: urn,
          type: "owns",
          to_urn: r.urn,
          as_of: r.as_of,
          document_id: r.document_id,
        })),
        {
          from_urn: urn,
          type: "successor_of",
          to_urn: "fl:entity:us-tx:0805555555",
          as_of: "2025-06-01",
        },
      ],
    });
    const small = record(TEN_ON_TWO);
    for (const a of await freeAnswers(small)) {
      assert.deepEqual(a, small);
      assert.ok(!("portfolio_withheld" in a) && !("portfolio_note" in a));
    }
    const big = record(TWELVE_ON_FIVE);
    const keep = new Set(
      [1, 2, 3].map((p) => `fl:parcel:us-48041:${7000000 + p}`),
    );
    for (const a of await freeAnswers(big)) {
      assert.deepEqual(
        a.relationships,
        big.relationships.filter(
          (r) => r.type !== "owns" || keep.has(r.to_urn),
        ),
      );
      assert.equal((a.relationships as unknown[]).length, 8 + 1);
      assert.deepEqual(a.portfolio_withheld, { count: 2, total: 5 });
    }
  });

  // --- recorded sales and documents ------------------------------------------------------------------

  /** One recorded-document fact, shaped as registry_get returns it (provenance cut down). */
  function recorded(
    id: string,
    predicate: string,
    value: Record<string, unknown>,
  ) {
    return {
      id,
      subject: "fl:parcel:us-36061:1012920015",
      predicate,
      value,
      as_of: "2026-09-30",
      provenance: {
        method: "public_record",
        sources: [
          {
            document_id: `doc-${id}`,
            section: `row of ${String(value.document_id ?? id)}`,
          },
        ],
      },
    };
  }
  // The newest transfer is the deed of 2026-01-28 (kept); everything else is withheld. Every withheld
  // price, party, document number, CRFN and full date below is a sentinel that must never reach a
  // free answer.
  const KEPT_DEED = recorded("s01", "transaction.deed", {
    date: "2026-01-28",
    document_date: "2026-01-20",
    doc_type: "DEED",
    doc_type_description: "DEED",
    amount_usd: 4242424,
    crfn: "2026000011111",
    document_id: "2026012800111001",
    grantors: ["KEPT GRANTOR LLC"],
    grantees: ["KEPT GRANTEE LLC"],
    organizations_only: true,
  });
  const SALES_FACTS = [
    KEPT_DEED,
    recorded("s02", "transaction.sale", {
      date: "2026-01-15",
      price_usd: 9111111,
      building_class: "K4",
    }),
    recorded("s03", "debt.mortgage_recorded", {
      date: "2025-03-03",
      doc_type: "MTGE",
      amount_usd: 9222222,
      crfn: "2025000022222",
      document_id: "2025030300222002",
      borrowers: ["WITHHELD BORROWER LLC"],
      lenders: ["WITHHELD LENDER BANK"],
      organizations_only: true,
    }),
    recorded("s04", "debt.mortgage_satisfaction_recorded", {
      date: "2024-08-08",
      doc_type: "SAT",
      crfn: "2024000033333",
      document_id: "2024080800333003",
      lenders: ["WITHHELD SATISFIED BANK"],
      organizations_only: true,
    }),
    recorded("s05", "transaction.deed", {
      date: "2019-12-19",
      doc_type: "DEED",
      amount_usd: 0,
      crfn: "2019000044444",
      document_id: "2019121900444004",
      grantors: ["WITHHELD OLD GRANTOR LLC"],
      grantees: [],
      grantees_withheld: { count: 2, kinds: ["personal trust", "estate"] },
      organizations_only: true,
    }),
    recorded("s06", "transaction.sale", {
      date: "2019-12-05",
      price_usd: 9333333,
      nominal_consideration: false,
    }),
    recorded("s07", "transaction.sale", {
      date: "2009-06-30",
      price_usd: 0,
      nominal_consideration: true,
    }),
    recorded("s08", "debt.mortgage_recorded", {
      date: "2013-02-14",
      doc_type: "MTGE",
      amount_usd: 9444444,
      crfn: "2013000055555",
      document_id: "2013021400555005",
      borrowers: ["WITHHELD BORROWER TWO LLC"],
      lenders: ["WITHHELD LENDER TWO BANK"],
      organizations_only: true,
    }),
  ];
  const SALES_RECORD = {
    urn: "fl:parcel:us-36061:1012920015",
    kind: "parcel",
    facts: [
      { id: "p1", predicate: "parcel.apn", value: "1012920015" },
      ...SALES_FACTS,
      { id: "p2", predicate: "parcel.tax_year", value: 2026 },
    ],
    value_history: [{ tax_year: 2026, market_value: 200 }],
    relationships: [],
  };
  const SALES_SENTINELS = [
    "9111111",
    "9222222",
    "9333333",
    "9444444",
    "WITHHELD",
    "2025000022222",
    "2025030300222002",
    "2024080800333003",
    "2019121900444004",
    "2013021400555005",
    "doc-s02",
    "doc-s03",
    "doc-s05",
    "s02",
    "s08",
    "2026-01-15",
    "2025-03-03",
    "2024-08-08",
    "2019-12-19",
    "2019-12-05",
    "2009-06-30",
    "2013-02-14",
    "personal trust",
  ];
  function assertNoWithheldSales(answer: unknown) {
    const text = JSON.stringify(answer);
    for (const v of SALES_SENTINELS)
      assert.ok(!text.includes(v), `free answer leaks ${v}`);
  }
  const SALES_NOTE =
    "This answer keeps the newest recorded sale or deed only; 3 more recorded sales, 2009 to 2026, and 4 recorded documents (deeds, mortgages and mortgage satisfactions), 2013 to 2025, are available with a Pro or Team key: https://factlot.com/pricing/";

  it("recorded sales: a free caller keeps the newest sale or deed whole and in place, with counts and years only (REST, MCP structuredContent and text)", async () => {
    for (const a of await freeAnswers(SALES_RECORD)) {
      assert.deepEqual(a.facts, [
        SALES_RECORD.facts[0],
        KEPT_DEED,
        SALES_RECORD.facts.at(-1),
      ]);
      assert.deepEqual(a.sales_withheld, {
        count: 3,
        from_year: 2009,
        to_year: 2026,
      });
      assert.deepEqual(a.documents_withheld, {
        count: 4,
        from_year: 2013,
        to_year: 2025,
        by_predicate: {
          "transaction.deed": 1,
          "debt.mortgage_recorded": 2,
          "debt.mortgage_satisfaction_recorded": 1,
        },
      });
      assert.equal(a.sales_note, SALES_NOTE);
      assert.equal(a.history_available, "pro");
      assert.ok(!("history_withheld" in a) && !("history_note" in a));
      assertNoWithheldSales(a);
      // No claim about the market: nothing says arm's length, valuation or comparable.
      assert.doesNotMatch(
        JSON.stringify(a),
        /arm'?s.length|valuation|comparable/i,
      );
    }
  });

  it("recorded sales: a Pro key and gating off get every recorded fact unchanged (REST and MCP)", async () => {
    const api = answerApi(SALES_RECORD);
    const e = on();
    const { key } = await issue(e);
    assert.deepEqual(
      await (
        await call(e, api, "/v1/registry/get", { key, body: { urn: "x" } })
      ).json(),
      SALES_RECORD,
    );
    const mcp = (await (
      await call(e, api, "/mcp", { key, body: toolCall("registry_get", 1) })
    ).json()) as {
      result: { content: { text: string }[]; structuredContent: unknown };
    };
    assert.deepEqual(mcp.result.structuredContent, SALES_RECORD);
    assert.deepEqual(JSON.parse(mcp.result.content[0]!.text), SALES_RECORD);
    for (const off of [env(), env({ GATING_ENABLED: "yes" })])
      assert.deepEqual(
        await (
          await call(off, api, "/v1/registry/get", { body: { urn: "x" } })
        ).json(),
        SALES_RECORD,
      );
  });

  it("recorded sales with include_history: history keeps the kept sale only; the history and sales notes each say their own part", async () => {
    const superseded = {
      id: "old1",
      predicate: "parcel.market_value",
      value: 1234567,
    };
    const withHistory = {
      ...SALES_RECORD,
      history: [...SALES_RECORD.facts, superseded],
    };
    for (const a of await freeAnswers(withHistory)) {
      assert.deepEqual(
        (a.history as { id: string }[]).map((f) => f.id),
        ["p1", "s01", "p2"],
      );
      assert.deepEqual(a.history_withheld, { facts: 1 });
      assert.equal(
        a.history_note,
        "1 earlier fact in history is available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assert.equal(a.sales_note, SALES_NOTE);
      assertNoWithheldSales(a);
      assert.ok(!JSON.stringify(a).includes("1234567"));
    }
  });

  it("recorded sales: no recorded fact, or a single sale (a roll's latest sale), is unchanged with no note", async () => {
    const none = {
      urn: "u",
      facts: [{ id: "p1", predicate: "parcel.apn", value: "1" }],
    };
    const single = {
      urn: "u",
      facts: [
        ...none.facts,
        recorded("dc1", "transaction.sale", {
          date: "2021-04-01",
          price_usd: 0,
          acceptance_code: "BUYER=SELLER",
        }),
      ],
    };
    for (const rec of [none, single])
      for (const a of await freeAnswers(rec)) {
        assert.deepEqual(a, rec);
        for (const k of [
          "sales_withheld",
          "documents_withheld",
          "sales_note",
          "history_available",
        ])
          assert.ok(!(k in a), k);
      }
  });

  it("recorded sales: mortgages only keep nothing and say so; the newest of a sale and a deed on one date is the higher amount", async () => {
    const mortgages = {
      urn: "u",
      facts: [SALES_FACTS[2], SALES_FACTS[7]],
    };
    for (const a of await freeAnswers(mortgages)) {
      assert.deepEqual(a.facts, []);
      assert.deepEqual(a.documents_withheld, {
        count: 2,
        from_year: 2013,
        to_year: 2025,
        by_predicate: { "debt.mortgage_recorded": 2 },
      });
      assert.ok(!("sales_withheld" in a));
      assert.equal(
        a.sales_note,
        "2 recorded mortgages, 2013 to 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
      );
      assertNoWithheldSales(a);
    }
    const sameDay = {
      urn: "u",
      facts: [
        recorded("d1", "transaction.deed", {
          date: "2024-05-01",
          amount_usd: 10,
        }),
        recorded("d2", "transaction.sale", {
          date: "2024-05-01",
          price_usd: 20,
        }),
      ],
    };
    const [rest] = await freeAnswers(sameDay);
    assert.deepEqual(
      (rest!.facts as { id: string }[]).map((f) => f.id),
      ["d2"],
    );
    assert.deepEqual(rest!.documents_withheld, {
      count: 1,
      from_year: 2024,
      to_year: 2024,
      by_predicate: { "transaction.deed": 1 },
    });
    assert.equal(
      rest!.sales_note,
      "This answer keeps the newest recorded sale or deed only; 1 recorded deed, 2024, is available with a Pro or Team key: https://factlot.com/pricing/",
    );
  });

  it("recorded sales: withheld-party markers pass through unchanged, free and Pro, when every party or some parties are withheld", async () => {
    const allWithheld = recorded("w1", "transaction.deed", {
      date: "2026-05-01",
      doc_type: "DEED",
      amount_usd: 10,
      grantors: [],
      grantors_withheld: { count: 1, kinds: ["estate"] },
      grantees: [],
      grantees_withheld: { count: 2, kinds: ["personal trust"] },
      organizations_only: true,
    });
    const mixed = recorded("w2", "debt.mortgage_recorded", {
      date: "2026-04-01",
      doc_type: "MTGE",
      amount_usd: 20,
      borrowers: ["SOME BORROWER LLC"],
      borrowers_withheld: { count: 1, kinds: ["individual"] },
      lenders: ["SOME BANK"],
      organizations_only: true,
    });
    const rec = { urn: "u", facts: [allWithheld, mixed] };
    for (const a of await freeAnswers(rec)) {
      assert.deepEqual(a.facts, [allWithheld]);
      assert.deepEqual(a.documents_withheld, {
        count: 1,
        from_year: 2026,
        to_year: 2026,
        by_predicate: { "debt.mortgage_recorded": 1 },
      });
      assert.ok(!JSON.stringify(a).includes("SOME BORROWER"));
    }
    const e = on();
    const { key } = await issue(e);
    assert.deepEqual(
      await (
        await call(e, answerApi(rec), "/v1/registry/get", {
          key,
          body: { urn: "x" },
        })
      ).json(),
      rec,
    );
  });

  it("recorded sales: entity records, registry_owned_by and the candidates tool carry no recorded facts and are unchanged by the sales cut", async () => {
    const ent = entityRecord(2);
    for (const a of await freeAnswers(ent)) assert.deepEqual(a, ent);
    const owned = portfolio(2);
    for (const a of await freeAnswers(owned, OWNED, OWNED_PATH))
      assert.deepEqual(a, owned);
    const cand = {
      subject: { urn: "s", value_history: [{ tax_year: 2026 }] },
      candidates: [{ urn: "c1" }],
    };
    for (const a of await freeAnswers(
      cand,
      "registry_tx_equity_candidates",
      "/v1/registry/tx_equity_candidates",
    ))
      assert.deepEqual(a, cand);
  });

  it("recorded sales: an MCP batch of two registry_get calls cuts each; a dated get is still refused", async () => {
    const api = answerApi(SALES_RECORD);
    const j = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    const batchApi = {
      fetch: async (r: Request) => {
        const items = JSON.parse(await r.text()) as { id: number }[];
        return j(
          items.map((m) => ({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(SALES_RECORD) }],
              structuredContent: SALES_RECORD,
            },
          })),
        );
      },
    };
    const res = (await (
      await call(on(), batchApi, "/mcp", {
        body: [toolCall("registry_get", 1), toolCall("registry_get", 2)],
      })
    ).json()) as {
      result: { content: { text: string }[]; structuredContent: unknown };
    }[];
    assert.equal(res.length, 2);
    for (const m of res) {
      assert.equal(
        (m.result.structuredContent as Record<string, unknown>).sales_note,
        SALES_NOTE,
      );
      assertNoWithheldSales(m.result);
    }
    const dated = await call(on(), api, "/v1/registry/get", {
      body: { urn: "x", as_of: "2020-01-01" },
    });
    assert.equal(dated.status, 403);
    assertNoWithheldSales(await dated.json());
  });

  it("REST: flag unset or not exactly true leaves the answer as it is", async () => {
    const { api } = historyApi();
    for (const e of [env(), env({ GATING_ENABLED: "yes" })])
      assert.deepEqual(
        await (
          await call(e, api, "/v1/registry/get", { body: { urn: "x" } })
        ).json(),
        record,
      );
  });

  it("MCP: registry_get results (text and structuredContent) are cut for a free caller, in a batch too", async () => {
    const { api } = historyApi();
    const res = await call(on(), api, "/mcp", {
      body: [toolCall("registry_get", 1), toolCall("calc_irr", 2)],
    });
    const [first] = (await res.json()) as {
      result: { content: { text: string }[]; structuredContent: typeof record };
    }[];
    const text = JSON.parse(first!.result.content[0]!.text) as typeof record;
    for (const a of [first!.result.structuredContent, text]) {
      assert.equal(a.value_history.length, 1);
      assert.equal(a.value_history[0]!.tax_year, 2026);
      assert.equal(a.history.length, 1);
      assert.equal((a as Record<string, unknown>).history_available, "pro");
    }
    const off = (await (
      await call(env(), api, "/mcp", { body: toolCall("registry_get", 1) })
    ).json()) as { result: { structuredContent: unknown } };
    assert.deepEqual(off.result.structuredContent, record);
    const e = on();
    const { key } = await issue(e);
    const pro = (await (
      await call(e, api, "/mcp", { key, body: toolCall("registry_get", 1) })
    ).json()) as { result: { structuredContent: unknown } };
    assert.deepEqual(pro.result.structuredContent, record);
  });

  it("REST batch: a free caller gets 403 PlanRequired, nothing is metered and nothing reaches the registry", async () => {
    const { api, seen } = historyApi();
    const e = on();
    const res = await call(e, api, BATCH_PATH, {
      body: { subjects: [{ id: "a", urn: "x" }] },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as {
      error: string;
      upgrade: string;
      message: string;
      next: string;
    };
    assert.equal(body.error, "PlanRequired");
    assert.equal(body.upgrade, "https://factlot.com/pricing/");
    assert.match(body.message, /Pro and Team/);
    assert.match(body.message, /Nothing was counted/);
    assert.match(body.next, /https:\/\/factlot\.com\/pricing\//);
    assert.deepEqual(seen, []);
    assert.equal(
      (await e.METER.quota(await addressSubject(IP, T0), "day", 25)).used,
      0,
    );
    // Flag off: the call runs as before.
    const off = await call(env(), api, BATCH_PATH, {
      body: { subjects: [{ id: "a", urn: "x" }] },
    });
    assert.equal(off.status, 200);
  });

  it("MCP batch: a free caller's batch call answers PlanRequired as a tool error and costs no lookup; other calls in the request run", async () => {
    const { api, seen } = historyApi();
    const e = on();
    const res = await call(e, api, "/mcp", {
      body: [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: BATCH, arguments: { subjects: [{ id: "a" }] } },
        },
        toolCall("registry_get", 2),
      ],
    });
    const answers = (await res.json()) as {
      id: number;
      result: { isError?: boolean; structuredContent: { error?: string } };
    }[];
    const refused = answers.find((a) => a.id === 1)!;
    assert.equal(refused.result.isError, true);
    assert.equal(refused.result.structuredContent.error, "PlanRequired");
    assert.ok(answers.find((a) => a.id === 2));
    assert.ok(!seen.join("").includes(BATCH), "never forwarded");
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "24");
    // Alone: no registry quota is touched at all.
    const only = await call(on(), api, "/mcp", {
      body: { ...toolCall(BATCH, 5), params: { name: BATCH, arguments: {} } },
    });
    assert.equal(only.status, 200);
    assert.equal(only.headers.get("x-factlot-registry-quota-limit"), null);
  });

  it("candidates with tax_year: a free caller gets PlanRequired on REST and MCP, unmetered and never forwarded; without tax_year, with a key or with gating off it runs", async () => {
    const CANDIDATES = "/v1/registry/tx_equity_candidates";
    const { api, seen } = historyApi();
    const e = on();
    const res = await call(e, api, CANDIDATES, {
      body: { urn: "x", tax_year: 2018, limit: 200 },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as {
      error: string;
      upgrade: string;
      message: string;
      next: string;
    };
    assert.equal(body.error, "PlanRequired");
    assert.equal(body.upgrade, "https://factlot.com/pricing/");
    assert.match(body.message, /tax_year/);
    assert.match(body.message, /Nothing was counted/);
    assert.match(body.next, /without tax_year/);
    assert.deepEqual(seen, []);
    assert.equal(
      (await e.METER.quota(await addressSubject(IP, T0), "day", 25)).used,
      0,
    );
    // The roll year the tool picks by itself stays free.
    const current = await call(e, api, CANDIDATES, { body: { urn: "x" } });
    assert.equal(current.status, 200);
    // MCP: a tool error for the call that names a year; the call beside it runs.
    const mcp = await call(on(), api, "/mcp", {
      body: [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "registry_tx_equity_candidates",
            arguments: { urn: "x", tax_year: 2018 },
          },
        },
        toolCall("registry_get", 2),
      ],
    });
    const answers = (await mcp.json()) as {
      id: number;
      result: { isError?: boolean; structuredContent: { error?: string } };
    }[];
    const refused = answers.find((a) => a.id === 1)!;
    assert.equal(refused.result.isError, true);
    assert.equal(refused.result.structuredContent.error, "PlanRequired");
    assert.ok(answers.find((a) => a.id === 2));
    assert.ok(!seen.join("").includes("2018"), "never forwarded");
    assert.equal(mcp.headers.get("x-factlot-registry-quota-remaining"), "24");
    // A Pro key may name the year.
    const { key } = await issue(e);
    const pro = await call(e, api, CANDIDATES, {
      key,
      body: { urn: "x", tax_year: 2018 },
    });
    assert.equal(pro.status, 200);
    // Flag off: the call runs as before.
    const off = await call(env(), api, CANDIDATES, {
      body: { urn: "x", tax_year: 2018 },
    });
    assert.equal(off.status, 200);
  });

  it("REST dated get: a free caller's registry_get with as_of gets 403 PlanRequired, unmetered and never forwarded; without as_of, with a key or with gating off it runs", async () => {
    const { api, seen } = historyApi();
    const e = on();
    const res = await call(e, api, "/v1/registry/get", {
      body: { urn: "x", as_of: "2025-12-31" },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as {
      error: string;
      upgrade: string;
      message: string;
      next: string;
    };
    assert.equal(body.error, "PlanRequired");
    assert.equal(body.upgrade, "https://factlot.com/pricing/");
    assert.match(body.message, /as_of/);
    assert.match(body.message, /Nothing was counted/);
    assert.match(body.next, /without as_of/);
    assert.deepEqual(seen, []);
    assert.equal(
      (await e.METER.quota(await addressSubject(IP, T0), "day", 25)).used,
      0,
    );
    // The current record stays free.
    const current = await call(e, api, "/v1/registry/get", {
      body: { urn: "x" },
    });
    assert.equal(current.status, 200);
    // A Pro key gets the dated record, whole.
    const { key } = await issue(e);
    const pro = await call(e, api, "/v1/registry/get", {
      key,
      body: { urn: "x", as_of: "2025-12-31" },
    });
    assert.equal(pro.status, 200);
    assert.deepEqual(await pro.json(), record);
    // Flag off: the call runs as before.
    const off = await call(env(), api, "/v1/registry/get", {
      body: { urn: "x", as_of: "2025-12-31" },
    });
    assert.equal(off.status, 200);
  });

  it("MCP dated get: a free caller's registry_get with as_of answers PlanRequired as a tool error and costs no lookup; an undated one in the same request runs", async () => {
    const { api, seen } = historyApi();
    const res = await call(on(), api, "/mcp", {
      body: [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "registry_get",
            arguments: { urn: "x", as_of: "2025-12-31" },
          },
        },
        toolCall("registry_get", 2),
      ],
    });
    const answers = (await res.json()) as {
      id: number;
      result: {
        isError?: boolean;
        structuredContent: { error?: string; value_history?: unknown[] };
      };
    }[];
    const refused = answers.find((a) => a.id === 1)!;
    assert.equal(refused.result.isError, true);
    assert.equal(refused.result.structuredContent.error, "PlanRequired");
    const ran = answers.find((a) => a.id === 2)!;
    assert.equal(ran.result.structuredContent.value_history?.length, 1);
    assert.ok(!seen.join("").includes("2025-12-31"), "never forwarded");
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "24");
  });

  it("batch tools stay available to Pro with gating on", async () => {
    const { api, seen } = historyApi();
    const e = on();
    const { key } = await issue(e);
    const res = await call(e, api, BATCH_PATH, {
      key,
      body: { subjects: [{ id: "a", urn: "x" }] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(seen, [BATCH_PATH]);
  });

  describe("yearly Pro checkout", () => {
    function yearlyStripe() {
      let session: URLSearchParams | undefined;
      let price: URLSearchParams | undefined;
      const s = fakeStripe({
        "GET /prices": () => [200, { data: [] }],
        "POST /products": () => [200, { id: "prod_y" }],
        "POST /prices": (b) => {
          price = b;
          return [200, { id: "price_year" }];
        },
        "POST /checkout/sessions": (b) => {
          session = b;
          return [
            200,
            { id: "cs_live_y", url: "https://checkout.stripe.com/y" },
          ];
        },
      });
      return { ...s, price: () => price, session: () => session };
    }
    const ask = (
      e: ReturnType<typeof env>,
      fetchImpl: typeof fetch,
      method: "GET" | "POST",
      plan: string,
      interval?: string,
    ) =>
      handle(
        method === "GET"
          ? new Request(
              `https://factlot.com/billing/checkout?plan=${plan}${interval ? `&interval=${interval}` : ""}`,
            )
          : new Request("https://api.factlot.com/v1/billing/checkout", {
              method: "POST",
              body: JSON.stringify({ plan, ...(interval ? { interval } : {}) }),
              headers: { "cf-connecting-ip": IP },
            }),
        e,
        innerApi().api,
        { fetchImpl, now: () => T0 },
      );

    it("flag on: GET and POST accept interval=year and create the $490 yearly price under factlot_pro_yearly_v1", async () => {
      const s = yearlyStripe();
      const e = env({ STRIPE_SECRET_KEY: "sk_live_x", GATING_ENABLED: "true" });
      const page = await ask(e, s.fetchImpl, "GET", "pro", "year");
      assert.equal(page.status, 303);
      assert.equal(s.price()?.get("unit_amount"), "49000");
      assert.equal(s.price()?.get("recurring[interval]"), "year");
      assert.equal(s.price()?.get("lookup_key"), "factlot_pro_yearly_v1");
      assert.equal(s.session()?.get("line_items[0][price]"), "price_year");
      assert.equal(s.session()?.get("metadata[factlot_plan]"), "pro");
      const agent = await ask(e, s.fetchImpl, "POST", "pro", "year");
      assert.equal(agent.status, 200);
      assert.equal(
        ((await agent.json()) as { interval: string }).interval,
        "year",
      );
      const monthly = await ask(e, s.fetchImpl, "POST", "pro", "month");
      assert.equal(monthly.status, 200);
    });

    it("flag on: yearly is Pro only, and the interval must be month or year", async () => {
      const s = yearlyStripe();
      const e = env({ STRIPE_SECRET_KEY: "sk_live_x", GATING_ENABLED: "true" });
      assert.equal(
        (await ask(e, s.fetchImpl, "POST", "team", "year")).status,
        400,
      );
      assert.equal(
        (await ask(e, s.fetchImpl, "POST", "pro", "week")).status,
        400,
      );
      assert.equal(s.calls.length, 0, "Stripe is never asked");
    });

    it("flag off: interval=year answers 400 with a clear message and Stripe is not called", async () => {
      const s = yearlyStripe();
      const e = env({ STRIPE_SECRET_KEY: "sk_live_x" });
      const agent = await ask(e, s.fetchImpl, "POST", "pro", "year");
      assert.equal(agent.status, 400);
      assert.match(
        ((await agent.json()) as { message: string }).message,
        /yearly billing is not available/,
      );
      const page = await ask(e, s.fetchImpl, "GET", "pro", "year");
      assert.equal(page.status, 400);
      assert.equal(s.calls.length, 0);
    });
  });

  it("the production wrangler config turns gating on, in the one vars block", () => {
    const text = readFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    assert.match(text, /^\s*"GATING_ENABLED": "true",/m);
    assert.equal(text.match(/"GATING_ENABLED"/g)?.length, 1);
    assert.equal(text.match(/"vars"/g)?.length, 1);
    assert.doesNotMatch(text, /^\s*"env"/m);
  });

  it("a free caller over the daily lookups is told what happened, what lifts it and where", async () => {
    const { api } = historyApi();
    const e = on();
    for (let i = 0; i < 25; i++)
      assert.equal(
        (await call(e, api, "/v1/registry/get", { body: { urn: "x" } })).status,
        200,
      );
    const over = await call(e, api, "/v1/registry/get", { body: { urn: "x" } });
    assert.equal(over.status, 429);
    const body = (await over.json()) as { message: string; upgrade: string };
    assert.match(body.message, /free registry lookups for today are used up/);
    assert.match(body.message, /Pro key .* or Team key .* lifts the cap/);
    assert.equal(body.upgrade, "https://factlot.com/pricing/");
  });

  it("the yearly lookup key maps to pro, so webhooks and rechecks give it the same limits", () => {
    assert.equal(planForLookupKey("factlot_pro_yearly_v1"), "pro");
    assert.equal(planForLookupKey("factlot_pro_monthly_v1"), "pro");
    assert.equal(planForLookupKey("factlot_team_monthly_v1"), "team");
    assert.equal(planForLookupKey("factlot_team_yearly_v1"), undefined);
  });

  it("/v1/plans: gating block and the yearly price only when enabled", async () => {
    const { api } = historyApi();
    type P = {
      gating?: {
        enabled: boolean;
        free_history: string;
        free_portfolio: string;
        free_sales: string;
        batch: string;
        dated_get: string;
        candidates_tax_year: string;
        pricing: string;
      };
      plans: {
        free: Record<string, unknown>;
        pro: Record<string, unknown>;
        team: Record<string, unknown>;
      };
      quotas: unknown;
    };
    const enabled = (await (
      await call(on(), api, "/v1/plans", { method: "GET" })
    ).json()) as P;
    assert.deepEqual(enabled.gating, {
      enabled: true,
      free_history: "current roll year only",
      free_portfolio: "first 3 parcels of an owner (registry_owned_by)",
      free_sales:
        "newest recorded sale or deed of a parcel, with counts and years of the rest (registry_get)",
      batch: "Pro and Team",
      dated_get: "Pro and Team",
      candidates_tax_year: "Pro and Team",
      pricing: "https://factlot.com/pricing/",
    });
    assert.match(String(enabled.plans.free.note), /current roll year/);
    assert.match(
      String(enabled.plans.free.note),
      /batch tools need Pro or Team/,
    );
    for (const p of [enabled.plans.pro, enabled.plans.team])
      assert.match(String(p.note), /full registry value history/);
    assert.equal(enabled.plans.pro.price_yearly, "$490 per year");
    assert.equal(
      enabled.plans.pro.checkout_yearly,
      "https://factlot.com/billing/checkout?plan=pro&interval=year",
    );
    const off = (await (
      await call(env(), api, "/v1/plans", { method: "GET" })
    ).json()) as P;
    assert.equal(off.gating, undefined);
    assert.doesNotMatch(String(off.plans.free.note), /roll year/);
    assert.equal(off.plans.pro.price_yearly, undefined);
    assert.deepEqual(off.quotas, enabled.quotas, "counting rules unchanged");
  });
});

describe("usage counters (USAGE_COUNTERS_ENABLED)", () => {
  const urn = "fl:parcel:us-48-453-0001";
  /** An inner handler whose registry_get answer carries two roll years. */
  const historyApi = () => {
    const parcel = {
      urn,
      value_history: [
        { tax_year: 2026, market_value: 200 },
        { tax_year: 2025, market_value: 100 },
      ],
      coverage: { county_loaded: true },
    };
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    return {
      api: {
        fetch: async (r: Request) => {
          const body = await r.text();
          if (new URL(r.url).pathname === "/mcp") {
            const m = JSON.parse(body) as { id: number };
            return json({
              jsonrpc: "2.0",
              id: m.id,
              result: {
                content: [{ type: "text", text: JSON.stringify(parcel) }],
                structuredContent: parcel,
              },
            });
          }
          return json(parcel);
        },
      },
    };
  };
  const flows = async (e: ReturnType<typeof env>) => {
    const { api } = historyApi();
    const out: unknown[] = [];
    const seen = async (p: Promise<Response>) => {
      const r = await p;
      out.push([r.status, await r.text()]);
    };
    await seen(call(e, api, "/v1/registry/get", { body: { urn } }));
    await seen(
      call(e, api, "/v1/registry/get", { body: { urn, as_of: "2024-01-01" } }),
    );
    await seen(call(e, api, "/v1/plans", { method: "GET" }));
    await seen(call(e, api, "/mcp", { body: toolCall("registry_get") }));
    for (let i = 0; i < 26; i++)
      await seen(call(e, api, "/v1/registry/get", { body: { urn } }));
    return out;
  };
  const withUsage = (over: Partial<Env> = {}) =>
    env({ GATING_ENABLED: "true", ...over });

  it("on: counts requests, lookups by tool and region, history notes, refusals and exhausted quota", async () => {
    resetUsageForTests({ waitUntil: () => {}, sleep: async () => {} });
    const e = withUsage({ USAGE_COUNTERS_ENABLED: "true" });
    await flows(e);
    const c = snapshot().counters;
    assert.equal(c["req|rest|/v1/plans|2xx"], 1);
    assert.equal(c["req|mcp|/mcp|2xx"], 1);
    assert.equal((c["req|rest|/v1/registry/get|2xx"] ?? 0) >= 20, true);
    assert.equal((c["req|rest|/v1/registry/get|4xx"] ?? 0) >= 2, true);
    assert.equal(c["mcp_call|registry_get|keyless"], 1);
    assert.equal((c["lookup|registry_get|us-48|keyless"] ?? 0) >= 20, true);
    assert.equal((c["history_note|rest|keyless"] ?? 0) >= 20, true);
    assert.equal(c["plan_required|dated|keyless"], 1);
    assert.equal((c["quota_exhausted|keyless|day"] ?? 0) >= 1, true);
    assert.equal(
      Object.keys(c).every((k) => !k.includes(IP) && !k.includes(urn)),
      true,
    );
    const sketch = snapshot();
    assert.ok(sketch.callers["keyless"], "a distinct-caller sketch was kept");
    assert.equal(JSON.stringify(sketch).includes(IP), false);
  });

  it("off (unset or not exactly true): nothing counted, nothing written, answers identical to on", async () => {
    resetUsageForTests({ waitUntil: () => {}, sleep: async () => {} });
    const on = withUsage({ USAGE_COUNTERS_ENABLED: "true" });
    const onAnswers = await flows(on);
    for (const v of [undefined, "false", "1"]) {
      resetUsageForTests({ waitUntil: () => {}, sleep: async () => {} });
      const off = withUsage(
        v === undefined ? {} : { USAGE_COUNTERS_ENABLED: v },
      );
      const answers = await flows(off);
      assert.deepEqual(snapshot().counters, {});
      assert.deepEqual(
        [...(off.KEYS as unknown as MemoryKV).data.keys()].filter((k) =>
          k.startsWith("usage:"),
        ),
        [],
      );
      assert.deepEqual(answers, onAnswers);
    }
  });

  it("a failing counter store never breaks a request", async () => {
    resetUsageForTests({ sleep: async () => {} });
    const e = withUsage({ USAGE_COUNTERS_ENABLED: "true" });
    (e.KEYS as unknown as MemoryKV).put = async () => {
      throw new Error("kv down");
    };
    const { api } = historyApi();
    const r = await call(e, api, "/v1/registry/get", { body: { urn } });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 5));
  });

  it("the production wrangler config has the counters on, and the privacy notice describes them", () => {
    const text = readFileSync(
      fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
      "utf8",
    );
    assert.match(
      text.replace(/\/\/[^\n]*/g, ""),
      /"USAGE_COUNTERS_ENABLED": "true"/,
    );
    const privacy = readFileSync(
      fileURLToPath(new URL("../../../site/privacy.html", import.meta.url)),
      "utf8",
    );
    assert.match(privacy, /Daily usage totals/);
    assert.doesNotMatch(privacy, /uses no analytics/);
  });
});

describe("free key by email", () => {
  const SECRET = "test-recovery-secret";
  function setup(over: Partial<Env> = {}) {
    const mail = fakeEmail();
    const e = env({
      EMAIL: mail.binding,
      RECOVERY_SIGNING_SECRET: SECRET,
      FREE_KEY_ENABLED: "true",
      ...over,
    });
    e.RL_ANON = new CountingLimit(1000);
    return { mail, e, api: innerApi().api };
  }
  const ask = (
    e: ReturnType<typeof env>,
    email: unknown,
    ip = IP,
    extra: Record<string, unknown> = { accept_terms: true },
  ) =>
    run(
      e,
      new Request("https://api.factlot.com/v1/keys/free", {
        method: "POST",
        body: JSON.stringify({ email, ...extra }),
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": ip,
        },
      }),
    );
  /** MemoryKV ignores TTLs: drop the resend waits the way KV would after 5 minutes. */
  const waitPassed = (e: ReturnType<typeof env>) => {
    e.clock.t += 6 * 60_000;
    for (const k of [...e.KEYS.data.keys()])
      if (k.startsWith("freewait:")) e.KEYS.data.delete(k);
  };
  const linkOf = (text: string) =>
    text.match(
      /https:\/\/factlot\.com\/account\/free-key\/[A-Za-z0-9_.-]+/,
    )?.[0];
  const open = (
    e: ReturnType<typeof env>,
    url: string,
    method = "GET",
    ip = IP,
  ) =>
    run(
      e,
      new Request(url, {
        method,
        body: method === "POST" ? "" : undefined,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://factlot.com",
          "cf-connecting-ip": ip,
        },
      }),
    );
  /** Ask for a link and redeem it; the key. */
  async function mint(
    e: ReturnType<typeof env>,
    mail: ReturnType<typeof fakeEmail>,
    email: string,
    ip = IP,
  ): Promise<string> {
    const before = mail.sent.length;
    assert.equal((await ask(e, email, ip)).status, 202);
    assert.equal(mail.sent.length, before + 1, "one email");
    const url = linkOf(mail.sent[before]!.text)!;
    const res = await open(e, url, "POST", ip);
    assert.equal(res.status, 200);
    const key = (await res.text()).match(/fl_free_[A-Za-z0-9_-]{43}/)?.[0];
    assert.ok(key, "key shown");
    return key;
  }
  const lookups = (
    e: ReturnType<typeof env>,
    api: ReturnType<typeof innerApi>["api"],
    key: string,
    ip = IP,
  ) => call(e, api, "/v1/registry/get", { key, ip, body: { urn: "x" } });

  it("answers 202 sent_if_valid the same for every well-formed address, and sends one transactional email", async () => {
    const { e, mail } = setup();
    const a = await ask(e, "new@example.com");
    const b = await ask(e, "someone.else@example.org");
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    const ja = (await a.json()) as { sent_if_valid: boolean };
    assert.equal(ja.sent_if_valid, true);
    assert.deepEqual(await b.json(), ja);
    // After a key exists the answer is still the same.
    const { mail: m2, e: e2 } = setup();
    await mint(e2, m2, "have@example.com");
    waitPassed(e2);
    const again = await ask(e2, "have@example.com");
    assert.equal(again.status, 202);
    assert.deepEqual(await again.json(), ja);
    const text = mail.sent[0]!.text;
    assert.match(text, /transactional/);
    assert.doesNotMatch(text, /fl_free_/, "no key in the email");
    assert.doesNotMatch(text, /newsletter|subscribe|unsubscribe/i);
    assert.ok(linkOf(text));
    assert.match(text, /30 minutes/);
  });

  it("refuses a bad address or missing terms with 400, and says so when email is off", async () => {
    const { e, mail } = setup();
    assert.equal((await ask(e, "not-an-email")).status, 400);
    assert.equal((await ask(e, 5)).status, 400);
    assert.equal((await ask(e, "a@example.com", IP, {})).status, 400);
    assert.equal(
      (await ask(e, "a@example.com", IP, { accept_terms: "yes" })).status,
      400,
    );
    assert.equal(mail.sent.length, 0);
    for (const over of [
      { EMAIL: undefined },
      { RECOVERY_SIGNING_SECRET: undefined },
    ]) {
      const { e: off } = setup(over);
      assert.equal((await ask(off, "a@example.com")).status, 503);
    }
  });

  it("waits per address before sending again, and rate limits per network address", async () => {
    const { e, mail } = setup();
    await ask(e, "wait@example.com");
    await ask(e, "WAIT@example.com");
    assert.equal(
      mail.sent.length,
      1,
      "same address (any case): one per 5 minutes",
    );
    waitPassed(e);
    await ask(e, "wait@example.com");
    assert.equal(mail.sent.length, 2);
    const tight = setup();
    tight.e.RL_ANON = new CountingLimit(2);
    const ips = [IP, IP, IP].map((ip) => ask(tight.e, "x@example.com", ip));
    const codes: number[] = [];
    for (const r of ips) codes.push((await r).status);
    // The three run at once: which one meets the limit depends on scheduling.
    assert.deepEqual([...codes].sort(), [202, 202, 429]);
  });

  it("a GET or HEAD of the link redeems nothing; the POST does, once", async () => {
    const { e, mail } = setup();
    await ask(e, "once@example.com");
    const url = linkOf(mail.sent[0]!.text)!;
    for (const method of ["GET", "HEAD", "GET"]) {
      const r = await open(e, url, method);
      assert.equal(r.status, 200);
      if (method === "GET")
        assert.doesNotMatch(await r.text(), /fl_free_/, "no key on GET");
    }
    const kv = e.KEYS;
    assert.equal(
      [...kv.data.keys()].filter((k) => k.startsWith("freekey:")).length,
      0,
      "nothing minted yet",
    );
    const post = await open(e, url, "POST");
    assert.equal(post.status, 200);
    assert.match(await post.text(), /fl_free_[A-Za-z0-9_-]{43}/);
    const second = await open(e, url, "POST");
    assert.equal(second.status, 410);
    assert.equal((await open(e, url, "GET")).status, 410);
  });

  it("rejects forged links, expired links, and a recovery link used here", async () => {
    const { e, mail } = setup();
    await ask(e, "forge@example.com");
    const url = linkOf(mail.sent[0]!.text)!;
    // Change the last character to a different one (a fixed "A" would sometimes be a no-op).
    const forged = `${url.slice(0, -1)}${url.endsWith("A") ? "B" : "A"}`;
    assert.equal((await open(e, forged, "POST")).status, 404);
    const rec = await createRecoveryToken(e, "sub_1", e.clock.t);
    assert.equal(
      (await open(e, `https://factlot.com/account/free-key/${rec}`, "POST"))
        .status,
      404,
      "a recovery link is not a free-key link",
    );
    e.clock.t += 31 * 60_000;
    assert.equal((await open(e, url, "POST")).status, 410);
  });

  it("refuses a link POST from another site", async () => {
    const { e, mail } = setup();
    await ask(e, "csrf@example.com");
    const url = linkOf(mail.sent[0]!.text)!;
    const r = await run(
      e,
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "cf-connecting-ip": IP,
        },
      }),
    );
    assert.equal(r.status, 403);
  });

  it("the site's free-key paths check Origin for JSON bodies too; the JSON API paths do not", async () => {
    const { e, mail } = setup();
    const post = (url: string, headers: Record<string, string>) =>
      run(
        e,
        new Request(url, {
          method: "POST",
          body: JSON.stringify({
            email: "origin@example.com",
            accept_terms: true,
          }),
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": IP,
            ...headers,
          },
        }),
      );
    for (const path of ["/account/free-key", "/account/free-key-delete"]) {
      const bad = await post(`https://factlot.com${path}`, {
        origin: "https://evil.example",
      });
      assert.equal(bad.status, 403, `${path} from another site`);
      const good = await post(`https://factlot.com${path}`, {
        origin: "https://factlot.com",
      });
      assert.notEqual(good.status, 403, `${path} from its own page`);
      const none = await post(`https://factlot.com${path}`, {});
      assert.notEqual(none.status, 403, `${path} without an Origin header`);
    }
    assert.equal(mail.sent.length, 1, "only the same-origin request mailed");
    // The API path is for programs and stays open to JSON from anywhere.
    waitPassed(e);
    const api = await post("https://api.factlot.com/v1/keys/free", {
      origin: "https://evil.example",
    });
    assert.equal(api.status, 202);
  });

  it("one active key per address: a new key revokes the old one", async () => {
    const { e, mail, api } = setup();
    const k1 = await mint(e, mail, "Pair@Example.com");
    assert.equal((await lookups(e, api, k1)).status, 200);
    waitPassed(e);
    const k2 = await mint(e, mail, "pair@example.com");
    assert.notEqual(k1, k2);
    assert.equal((await lookups(e, api, k1)).status, 401, "old key revoked");
    assert.equal((await lookups(e, api, k2)).status, 200);
    // A different address has its own key and does not touch this one.
    const k3 = await mint(e, mail, "other@example.com");
    assert.equal((await lookups(e, api, k2)).status, 200);
    assert.equal((await lookups(e, api, k3)).status, 200);
  });

  it("meters per key, not per address: the free day is 25 for each key", async () => {
    const { e, mail, api } = setup();
    const a = await mint(e, mail, "a@example.com", "203.0.113.1");
    const b = await mint(e, mail, "b@example.com", "203.0.113.2");
    const ip = "198.51.100.7";
    for (let i = 0; i < 25; i++) {
      if (i % 50 === 49) e.clock.t += 60_000;
      assert.equal((await lookups(e, api, a, ip)).status, 200, `a ${i + 1}`);
    }
    const over = await lookups(e, api, a, ip);
    assert.equal(over.status, 429);
    const body = (await over.json()) as { error: string; message: string };
    assert.equal(body.error, "RegistryQuotaExceeded");
    assert.match(body.message, /25 a day per free key/);
    // The other key, from the same address, still has its own allowance.
    const other = await lookups(e, api, b, ip);
    assert.equal(other.status, 200);
    assert.equal(other.headers.get("x-factlot-tier"), "anonymous");
    assert.equal(other.headers.get("x-factlot-registry-quota-limit"), "25");
    assert.equal(other.headers.get("x-factlot-registry-quota-remaining"), "24");
    // The per-IP anonymous allowance was never touched by free-key calls.
    const anon = await call(e, api, "/v1/registry/get", {
      ip,
      body: { urn: "x" },
    });
    assert.equal(anon.headers.get("x-factlot-registry-quota-remaining"), "24");
    // Next UTC day starts fresh.
    e.clock.t = Date.UTC(2026, 10, 8, 0, 0, 0);
    assert.equal((await lookups(e, api, a, ip)).status, 200);
  });

  it("caps all the free keys used from one address at 100 lookups a day", async () => {
    const { e, mail, api } = setup();
    const keys: string[] = [];
    for (let i = 0; i < 5; i++)
      keys.push(
        await mint(e, mail, `k${i}@example.com`, `203.0.113.${20 + i}`),
      );
    const ip = "198.51.100.9";
    let ok = 0;
    for (const key of keys.slice(0, 4))
      for (let i = 0; i < 25; i++) {
        e.clock.t += 1_000;
        if ((await lookups(e, api, key, ip)).status === 200) ok++;
      }
    assert.equal(ok, 100);
    e.clock.t += 1_000;
    const over = await lookups(e, api, keys[4]!, ip);
    assert.equal(over.status, 429, "the fifth key's own allowance is blocked");
    const body = (await over.json()) as { message: string; limit: number };
    assert.equal(body.limit, 100);
    assert.match(body.message, /IP address \(all free keys/);
    // Another address is unaffected, and nothing was charged to the fifth key.
    e.clock.t += 1_000;
    const fresh = await lookups(e, api, keys[4]!, "198.51.100.10");
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("x-factlot-registry-quota-remaining"), "24");
  });

  it("the minute limit is per key and per address: rotating keys does not multiply it", async () => {
    const { e, mail, api } = setup();
    const a = await mint(e, mail, "m1@example.com", "203.0.113.31");
    const b = await mint(e, mail, "m2@example.com", "203.0.113.32");
    const ip = "198.51.100.20";
    const calc = (key: string, from = ip) =>
      call(e, api, "/v1/calc/irr", { key, ip: from });
    for (let i = 0; i < 60; i++)
      assert.equal((await calc(a)).status, 200, `call ${i + 1}`);
    assert.equal((await calc(a)).status, 429);
    assert.equal((await calc(b)).status, 429, "same address, second key");
    assert.equal((await calc(b, "198.51.100.21")).status, 200, "other address");
    e.clock.t += 60_000;
    assert.equal((await calc(b)).status, 200, "next minute");
  });

  it("mints at most 3 keys per address a day, and a refusal keeps the link", async () => {
    const { e, mail } = setup();
    const ip = "198.51.100.30";
    for (let i = 0; i < 3; i++) await mint(e, mail, `d${i}@example.com`, ip);
    await ask(e, "d3@example.com", ip);
    const url = linkOf(mail.sent[3]!.text)!;
    const refused = await open(e, url, "POST", ip);
    assert.equal(refused.status, 429);
    const elsewhere = await open(e, url, "POST", "198.51.100.31");
    assert.equal(elsewhere.status, 200, "the link was not spent");
    assert.match(await elsewhere.text(), /fl_free_/);
  });

  it("a free key never reaches account or paid features, and an unknown free key is 401", async () => {
    const { e, mail, api } = setup();
    const key = await mint(e, mail, "plain@example.com");
    const acct = await call(e, api, "/v1/account", { key, method: "GET" });
    assert.equal(acct.status, 401);
    const bad = await lookups(e, api, `fl_free_${"A".repeat(43)}`);
    assert.equal(bad.status, 401);
    const plans = (await (
      await call(e, api, "/v1/plans", { method: "GET" })
    ).json()) as { plans: { free: { free_key: { note: string } } } };
    assert.match(plans.plans.free.free_key.note, /100 lookups a day/);
  });

  it("stores no email address in KV, and logs none", async () => {
    const { e, mail } = setup();
    const logs = await captureLogs(async () => {
      await mint(e, mail, "Secret.Person@Example.com");
      waitPassed(e);
      await mint(e, mail, "secret.person@example.com");
    });
    assert.doesNotMatch(logs, /secret\.person|example\.com/i);
    for (const name of e.limiter.objects.keys())
      assert.doesNotMatch(
        String(name),
        /secret\.person|example\.com|@/i,
        "no address in a counter name",
      );
    const names = [...e.KEYS.data.keys()];
    assert.ok(names.some((k) => k.startsWith("freekey:")));
    assert.ok(names.some((k) => k.startsWith("freeemail:")));
    for (const [k, v] of e.KEYS.data)
      assert.doesNotMatch(
        `${k} ${v}`,
        /secret\.person|example\.com|@/i,
        `no address in ${k.split(":")[0]}`,
      );
    for (const v of e.KEYS.data.values())
      assert.doesNotMatch(v, /fl_free_/, "no plaintext key either");
    const rec = [...e.KEYS.data.entries()].find(([k]) =>
      k.startsWith("freekey:"),
    )![1];
    assert.deepEqual(
      Object.keys(JSON.parse(rec)).sort(),
      ["created", "email_hash", "revoked_at", "tier"]
        .filter((k) => k in JSON.parse(rec))
        .sort(),
    );
    assert.equal(JSON.parse(rec).tier, "free");
  });

  it("the /account page offers the form only when email can be sent", async () => {
    const { e } = setup();
    const on = await (
      await run(e, new Request("https://factlot.com/account"))
    ).text();
    assert.match(on, /action="\/account\/free-key"/);
    assert.match(on, /name="accept_terms"/);
    const off = setup({ EMAIL: undefined });
    const html = await (
      await run(off.e, new Request("https://factlot.com/account"))
    ).text();
    assert.doesNotMatch(html, /action="\/account\/free-key"/);
  });

  describe("deleting a free key", () => {
    const askDelete = (
      e: ReturnType<typeof env>,
      email: unknown,
      ip = IP,
      form = false,
    ) =>
      run(
        e,
        form
          ? new Request("https://factlot.com/account/free-key-delete", {
              method: "POST",
              body: new URLSearchParams({ email: String(email) }).toString(),
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                origin: "https://factlot.com",
                "cf-connecting-ip": ip,
              },
            })
          : new Request("https://api.factlot.com/v1/keys/free/delete", {
              method: "POST",
              body: JSON.stringify({ email }),
              headers: {
                "content-type": "application/json",
                "cf-connecting-ip": ip,
              },
            }),
      );
    const delLinkOf = (text: string) =>
      text.match(
        /https:\/\/factlot\.com\/account\/free-key-delete\/[A-Za-z0-9_.-]+/,
      )?.[0];
    const withKey = (
      e: ReturnType<typeof env>,
      key: string | undefined,
      ip = IP,
    ) =>
      run(
        e,
        new Request("https://api.factlot.com/v1/keys/free", {
          method: "DELETE",
          headers: {
            "cf-connecting-ip": ip,
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
        }),
      );
    const freeNames = (e: ReturnType<typeof env>) =>
      [...e.KEYS.data.keys()].filter((k) => /^(freekey|freeemail):/.test(k));
    const counted = (e: ReturnType<typeof env>, prefix: string) =>
      [...e.limiter.objects.entries()]
        .filter(([n]) => n.startsWith(prefix))
        .reduce((a, [, o]) => a + o.store.counts.size, 0);

    it("emails a link only when the address has a key, and answers the same either way", async () => {
      const { e, mail, api } = setup();
      const key = await mint(e, mail, "Has.Key@Example.com");
      assert.equal((await lookups(e, api, key)).status, 200);
      mail.sent.length = 0;
      const known = await askDelete(e, "has.key@example.com");
      const unknown = await askDelete(e, "never.asked@example.org");
      assert.equal(known.status, 202);
      assert.equal(unknown.status, 202);
      assert.deepEqual(await known.json(), await unknown.json());
      assert.equal(
        mail.sent.length,
        1,
        "only the address with a key is mailed",
      );
      assert.equal(mail.sent[0]!.to, "has.key@example.com");
      const text = mail.sent[0]!.text;
      assert.match(text, /transactional/);
      assert.match(text, /30 minutes/);
      assert.doesNotMatch(text, /fl_free_/, "no key in the email");
      assert.doesNotMatch(text, /newsletter|subscribe|unsubscribe/i);
      assert.ok(delLinkOf(text));
      // The form answers the same page for both, and a bad address is a 400.
      const a = await (
        await askDelete(e, "has.key@example.com", IP, true)
      ).text();
      const b = await (
        await askDelete(e, "nobody@example.org", IP, true)
      ).text();
      const bare = (t: string) => t.replace(/nonce="[^"]*"/g, "");
      assert.equal(bare(a), bare(b));
      assert.equal((await askDelete(e, "not-an-email")).status, 400);
      assert.equal(mail.sent.length, 1, "the second request waits 5 minutes");
    });

    it("full flow by email: GET and HEAD delete nothing, the POST deletes, the key stops at once", async () => {
      const { e, mail, api } = setup();
      const key = await mint(e, mail, "gone@example.com");
      assert.equal((await lookups(e, api, key)).status, 200);
      const eh = JSON.parse(
        [...e.KEYS.data.entries()].find(([k]) => k.startsWith("freekey:"))![1],
      ).email_hash as string;
      e.limiter
        .object(`meter:freemail:${eh.slice(0, 32)}`)
        .store.setCount("month:2026-11", 2);
      assert.ok(counted(e, "meter:freemail:") > 0);
      assert.ok(counted(e, "meter:freekey:") > 0);
      await askDelete(e, "gone@example.com");
      const url = delLinkOf(mail.sent.at(-1)!.text)!;
      for (const method of ["GET", "HEAD", "GET"]) {
        const r = await open(e, url, method);
        assert.equal(r.status, 200);
        if (method === "GET")
          assert.match(await r.text(), /Delete my free key/);
      }
      assert.equal(freeNames(e).length, 2, "nothing deleted by GET or HEAD");
      assert.equal((await lookups(e, api, key)).status, 200);
      const post = await open(e, url, "POST");
      assert.equal(post.status, 200);
      assert.match(await post.text(), /deleted/);
      assert.equal((await lookups(e, api, key)).status, 401, "stops at once");
      assert.deepEqual(freeNames(e), []);
      assert.equal(counted(e, "meter:freemail:"), 0, "report counter gone");
      assert.equal(counted(e, "meter:freekey:"), 0, "key meter gone");
      assert.equal((await open(e, url, "POST")).status, 410, "single use");
      assert.equal((await open(e, url, "GET")).status, 410);
      // The address can start again, and no earlier state comes back.
      waitPassed(e);
      const again = await mint(e, mail, "gone@example.com");
      assert.equal((await lookups(e, api, again)).status, 200);
      assert.equal((await lookups(e, api, key)).status, 401);
    });

    it("deletes replaced keys too, and leaves other addresses alone", async () => {
      const { e, mail, api } = setup();
      const other = await mint(e, mail, "other@example.com", "203.0.113.90");
      const ks: string[] = [];
      for (let i = 0; i < 3; i++) {
        ks.push(
          await mint(e, mail, "chain@example.com", `203.0.113.${91 + i}`),
        );
        waitPassed(e);
      }
      assert.equal(
        [...e.KEYS.data.keys()].filter((k) => k.startsWith("freekey:")).length,
        4,
        "three keys for the address (two revoked) and one for the other",
      );
      await askDelete(e, "chain@example.com");
      await open(e, delLinkOf(mail.sent.at(-1)!.text)!, "POST");
      assert.equal(
        [...e.KEYS.data.keys()].filter((k) => k.startsWith("freekey:")).length,
        1,
        "every key of the address is gone, revoked ones included",
      );
      for (const k of ks) assert.equal((await lookups(e, api, k)).status, 401);
      assert.equal((await lookups(e, api, other)).status, 200);
    });

    it("the key holder deletes with DELETE and the key as bearer: same result, no email", async () => {
      const { e, mail, api } = setup();
      const k1 = await mint(e, mail, "bearer@example.com");
      waitPassed(e);
      const k2 = await mint(e, mail, "bearer@example.com");
      const other = await mint(e, mail, "keep@example.com");
      const sent = mail.sent.length;
      assert.equal((await lookups(e, api, k2)).status, 200);
      const res = await withKey(e, k2);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { deleted: boolean };
      assert.equal(body.deleted, true);
      assert.equal(mail.sent.length, sent, "no email");
      assert.equal((await lookups(e, api, k2)).status, 401);
      assert.equal((await lookups(e, api, k1)).status, 401, "replaced key too");
      assert.equal((await lookups(e, api, other)).status, 200);
      assert.equal(
        freeNames(e).filter((k) => k.startsWith("freeemail:")).length,
        1,
      );
      assert.equal(
        (await withKey(e, k2)).status,
        401,
        "a second delete is 401",
      );
      assert.equal((await withKey(e, undefined)).status, 401);
      assert.equal((await withKey(e, `fl_free_${"A".repeat(43)}`)).status, 401);
      assert.equal((await lookups(e, api, other)).status, 200);
    });

    it("a deletion link cannot create a key and an issuance link cannot delete", async () => {
      const { e, mail, api } = setup();
      const key = await mint(e, mail, "purpose@example.com");
      waitPassed(e);
      await ask(e, "purpose@example.com");
      const issue = linkOf(mail.sent.at(-1)!.text)!;
      await askDelete(e, "purpose@example.com");
      const del = delLinkOf(mail.sent.at(-1)!.text)!;
      const tokenOf = (u: string) => u.split("/").at(-1)!;
      const crossDel = `https://factlot.com/account/free-key-delete/${tokenOf(issue)}`;
      const crossIssue = `https://factlot.com/account/free-key/${tokenOf(del)}`;
      assert.equal((await open(e, crossDel, "POST")).status, 404);
      assert.equal((await open(e, crossDel, "GET")).status, 404);
      assert.equal((await open(e, crossIssue, "POST")).status, 404);
      assert.equal((await open(e, crossIssue, "GET")).status, 404);
      assert.equal((await lookups(e, api, key)).status, 200, "nothing deleted");
      assert.equal(
        [...e.KEYS.data.keys()].filter((k) => k.startsWith("freekey:")).length,
        1,
        "nothing minted",
      );
      // Each still does its own job.
      assert.equal((await open(e, del, "POST")).status, 200);
      assert.equal((await lookups(e, api, key)).status, 401);
    });

    it("rejects forged and expired links, and a recovery link", async () => {
      const { e, mail, api } = setup();
      const key = await mint(e, mail, "forge2@example.com");
      await askDelete(e, "forge2@example.com");
      const url = delLinkOf(mail.sent.at(-1)!.text)!;
      const forged = `${url.slice(0, -1)}${url.endsWith("A") ? "B" : "A"}`;
      assert.equal((await open(e, forged, "POST")).status, 404);
      const [id] = url.split("/").at(-1)!.split(".");
      assert.equal(
        (
          await open(
            e,
            `https://factlot.com/account/free-key-delete/${id}.${"A".repeat(43)}`,
            "POST",
          )
        ).status,
        404,
      );
      assert.equal((await open(e, `${url}x`, "POST")).status, 404);
      const rec = await createRecoveryToken(e, "sub_1", e.clock.t);
      assert.equal(
        (
          await open(
            e,
            `https://factlot.com/account/free-key-delete/${rec}`,
            "POST",
          )
        ).status,
        404,
      );
      assert.equal((await lookups(e, api, key)).status, 200);
      e.clock.t += 31 * 60_000;
      assert.equal((await open(e, url, "POST")).status, 410);
      assert.equal((await open(e, url, "GET")).status, 410);
      assert.equal((await lookups(e, api, key)).status, 200, "expired: kept");
    });

    it("refuses a link POST from another site", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "csrf2@example.com");
      await askDelete(e, "csrf2@example.com");
      const url = delLinkOf(mail.sent.at(-1)!.text)!;
      const r = await run(
        e,
        new Request(url, {
          method: "POST",
          headers: { origin: "https://evil.example", "cf-connecting-ip": IP },
        }),
      );
      assert.equal(r.status, 403);
      assert.equal(freeNames(e).length, 2);
    });

    it("waits per address between deletion emails, and rate limits per network address", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "slow@example.com");
      const before = mail.sent.length;
      await askDelete(e, "slow@example.com");
      await askDelete(e, "SLOW@example.com");
      assert.equal(mail.sent.length, before + 1, "one per 5 minutes");
      waitPassed(e);
      for (const k of [...e.KEYS.data.keys()])
        if (k.startsWith("freedelwait:")) e.KEYS.data.delete(k);
      await askDelete(e, "slow@example.com");
      assert.equal(mail.sent.length, before + 2);
      const tight = setup();
      tight.e.RL_ANON = new CountingLimit(2);
      const codes: number[] = [];
      for (let i = 0; i < 3; i++)
        codes.push((await askDelete(tight.e, "x@example.com")).status);
      assert.deepEqual(codes, [202, 202, 429]);
      const keyLimited = setup();
      const k = await mint(keyLimited.e, keyLimited.mail, "lim@example.com");
      keyLimited.e.RL_ANON = new CountingLimit(0);
      assert.equal((await withKey(keyLimited.e, k)).status, 429);
    });

    it("stores nothing personal and logs nothing personal", async () => {
      const { e, mail } = setup();
      const logs = await captureLogs(async () => {
        const k = await mint(e, mail, "Private.Name@Example.com");
        await askDelete(e, "private.name@example.com");
        await open(e, delLinkOf(mail.sent.at(-1)!.text)!, "POST");
        await askDelete(e, "nobody.at.all@example.net");
        await withKey(e, k);
      });
      assert.doesNotMatch(logs, /private\.name|nobody\.at|example\./i);
      for (const [k, v] of e.KEYS.data)
        assert.doesNotMatch(`${k} ${v}`, /private\.name|nobody\.at|@/i);
      for (const name of e.limiter.objects.keys())
        assert.doesNotMatch(String(name), /private\.name|nobody\.at|@/i);
      for (const v of e.KEYS.data.values()) assert.doesNotMatch(v, /fl_free_/);
      assert.ok(
        [...e.KEYS.data.keys()].some((k) => k.startsWith("freedel:")),
        "the used deletion link marker is kept (random id, no address)",
      );
    });

    it("says so when email is off, and sends nothing for a malformed address", async () => {
      const { e: off } = setup({ EMAIL: undefined });
      assert.equal((await askDelete(off, "a@example.com")).status, 503);
      const { e, mail } = setup();
      assert.equal((await askDelete(e, 5)).status, 400);
      assert.equal(mail.sent.length, 0);
    });

    it("the /account page offers the deletion form next to the issuance form", async () => {
      const { e } = setup();
      const on = await (
        await run(e, new Request("https://factlot.com/account"))
      ).text();
      assert.match(on, /action="\/account\/free-key-delete"/);
      assert.match(on, /DELETE \/v1\/keys\/free/);
      const off = setup({ EMAIL: undefined });
      const html = await (
        await run(off.e, new Request("https://factlot.com/account"))
      ).text();
      assert.doesNotMatch(html, /free-key-delete/);
    });

    it("answers 404 and sends nothing with the variable off", async () => {
      for (const over of [
        { FREE_KEY_ENABLED: undefined },
        { FREE_KEY_ENABLED: "TRUE" },
        { FREE_KEY_ENABLED: "" },
      ]) {
        const { e, mail } = setup(over);
        const token = `${"A".repeat(43)}.${"B".repeat(43)}`;
        const tries: [string, string][] = [
          ["POST", "https://api.factlot.com/v1/keys/free/delete"],
          ["DELETE", "https://api.factlot.com/v1/keys/free"],
          ["POST", "https://factlot.com/account/free-key-delete"],
          ["GET", "https://factlot.com/account/free-key-delete"],
          ["GET", `https://factlot.com/account/free-key-delete/${token}`],
          ["POST", `https://factlot.com/account/free-key-delete/${token}`],
        ];
        for (const [method, url] of tries) {
          const res = await handle(
            new Request(url, {
              method,
              body:
                method === "POST"
                  ? JSON.stringify({ email: "a@example.com" })
                  : undefined,
              headers: {
                "content-type": "application/json",
                "cf-connecting-ip": IP,
              },
            }),
            e,
            {
              fetch: async () =>
                new Response('{"error":"NotFound"}', { status: 404 }),
            },
            { now: () => e.clock.t },
          );
          assert.equal(res.status, 404, `${method} ${url}`);
        }
        assert.equal(mail.sent.length, 0);
        assert.equal(e.KEYS.data.size, 0);
      }
    });

    it("an issuance request does not use up the deletion wait, and a deletion request not the issuance one", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "both@example.com");
      waitPassed(e);
      await ask(e, "both@example.com");
      const n = mail.sent.length;
      await askDelete(e, "both@example.com");
      assert.equal(mail.sent.length, n + 1);
    });
  });

  describe("with the variable off", () => {
    const dark = [
      {},
      { FREE_KEY_ENABLED: undefined },
      { FREE_KEY_ENABLED: "TRUE" },
      { FREE_KEY_ENABLED: "yes" },
      { FREE_KEY_ENABLED: "1" },
      { FREE_KEY_ENABLED: "" },
    ];
    // What the real inner handler answers for a path it does not serve.
    const notFoundApi = {
      fetch: async () =>
        new Response('{"error":"NotFound"}', {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    };
    // setup() turns the feature on; these override it.
    const darkSetup = (over: Partial<Env>) =>
      setup({ ...over, FREE_KEY_ENABLED: over.FREE_KEY_ENABLED });

    it("answers 404 on every endpoint, sends nothing and stores nothing", async () => {
      for (const over of dark) {
        const { e, mail } = darkSetup(
          "FREE_KEY_ENABLED" in over ? over : { FREE_KEY_ENABLED: undefined },
        );
        const token = `${"A".repeat(43)}.${"B".repeat(43)}`;
        const tries: [string, string][] = [
          ["POST", "https://api.factlot.com/v1/keys/free"],
          ["POST", "https://factlot.com/account/free-key"],
          ["GET", "https://factlot.com/account/free-key"],
          ["GET", `https://factlot.com/account/free-key/${token}`],
          ["POST", `https://factlot.com/account/free-key/${token}`],
        ];
        for (const [method, url] of tries) {
          const res = await handle(
            new Request(url, {
              method,
              body:
                method === "POST"
                  ? JSON.stringify({
                      email: "a@example.com",
                      accept_terms: true,
                    })
                  : undefined,
              headers: {
                "content-type": "application/json",
                "cf-connecting-ip": IP,
              },
            }),
            e,
            notFoundApi,
            { now: () => e.clock.t },
          );
          assert.equal(
            res.status,
            404,
            `${method} ${url} with ${JSON.stringify(over)}`,
          );
        }
        assert.equal(mail.sent.length, 0);
        assert.equal(e.KEYS.data.size, 0);
      }
    });

    it("hides the form on /account and the option in /v1/plans", async () => {
      for (const over of dark) {
        const { e } = darkSetup(
          "FREE_KEY_ENABLED" in over ? over : { FREE_KEY_ENABLED: undefined },
        );
        const html = await (
          await run(e, new Request("https://factlot.com/account"))
        ).text();
        assert.doesNotMatch(html, /free-key|accept_terms|Get a free key/);
        const plans = (await (
          await call(e, innerApi().api, "/v1/plans", { method: "GET" })
        ).json()) as { plans: { free: Record<string, unknown> } };
        assert.equal("free_key" in plans.plans.free, false);
      }
      const { e } = setup();
      const shown = (await (
        await call(e, innerApi().api, "/v1/plans", { method: "GET" })
      ).json()) as { plans: { free: { free_key?: { note: string } } } };
      assert.ok(shown.plans.free.free_key);
    });

    it("is on in the shipped wrangler config", () => {
      const text = readFileSync(
        new URL("../wrangler.jsonc", import.meta.url),
        "utf8",
      );
      assert.match(text, /^\s*"FREE_KEY_ENABLED": "true",$/m);
    });

    it("turning it off stops new keys; a key already issued keeps working", async () => {
      const { e, mail, api } = setup();
      const key = await mint(e, mail, "keep@example.com");
      e.FREE_KEY_ENABLED = undefined;
      assert.equal((await lookups(e, api, key)).status, 200);
      const after = await handle(
        new Request("https://api.factlot.com/v1/keys/free", {
          method: "POST",
          body: JSON.stringify({
            email: "again@example.com",
            accept_terms: true,
          }),
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": IP,
          },
        }),
        e,
        { fetch: async () => new Response("{}", { status: 404 }) },
        { now: () => e.clock.t },
      );
      assert.equal(after.status, 404);
      assert.equal(mail.sent.length, 1, "no second email");
    });
  });

  describe("under paid gating", () => {
    const record = {
      urn: "fl:parcel:us-48201:1",
      value_history: [
        { tax_year: 2026, market_value: 200 },
        { tax_year: 2025, market_value: 1234567 },
      ],
      history: [
        { id: "f2", value: 200 },
        { id: "f1", value: 1234567 },
      ],
    };
    const j = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    const gatedApi = () => {
      const seen: string[] = [];
      return {
        seen,
        api: {
          fetch: async (r: Request) => {
            const body = await r.text();
            const path = new URL(r.url).pathname;
            seen.push(path);
            if (path === "/mcp") {
              const m = JSON.parse(body) as { id: number };
              return j({
                jsonrpc: "2.0",
                id: m.id,
                result: {
                  content: [{ type: "text", text: JSON.stringify(record) }],
                  structuredContent: record,
                },
              });
            }
            return j(
              path.endsWith("/batch") ? { results: [{ id: "a" }] } : record,
            );
          },
        },
      };
    };
    const gated = () => setup({ GATING_ENABLED: "true" });
    const mcp = (
      e: ReturnType<typeof env>,
      api: { fetch(r: Request): Promise<Response> },
      name: string,
      args: Record<string, unknown>,
      key?: string,
    ) =>
      call(e, api, "/mcp", {
        key,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
      });

    it("REST registry_get: the same answer as no key, current roll year only, tier anonymous", async () => {
      const { e, mail } = gated();
      const { api } = gatedApi();
      const key = await mint(e, mail, "gate@example.com");
      const keyless = await call(e, api, "/v1/registry/get", {
        ip: "198.51.100.50",
        body: { urn: "x" },
      });
      const withKey = await call(e, api, "/v1/registry/get", {
        key,
        ip: "198.51.100.51",
        body: { urn: "x" },
      });
      assert.equal(withKey.status, 200);
      assert.equal(withKey.headers.get("x-factlot-tier"), "anonymous");
      assert.equal(
        withKey.headers.get("x-factlot-registry-quota-limit"),
        keyless.headers.get("x-factlot-registry-quota-limit"),
      );
      const a = (await withKey.json()) as Record<string, unknown>;
      assert.deepEqual(a, await keyless.json());
      assert.equal((a.value_history as unknown[]).length, 1);
      assert.equal(a.history_available, "pro");
      assert.ok(a.history_note);
      assert.ok(a.history_withheld);
      assert.ok(!JSON.stringify(a).includes("1234567"));
    });

    it("REST: batch and dated registry_get are PlanRequired and not metered", async () => {
      const { e, mail } = gated();
      const { api, seen } = gatedApi();
      const key = await mint(e, mail, "gate2@example.com");
      const batch = await call(
        e,
        api,
        "/v1/registry/tx_equity_candidates/batch",
        {
          key,
          body: { subjects: [] },
        },
      );
      assert.equal(batch.status, 403);
      assert.equal(
        ((await batch.json()) as { error: string }).error,
        "PlanRequired",
      );
      const dated = await call(e, api, "/v1/registry/get", {
        key,
        body: { urn: "x", as_of: "2025-06-01" },
      });
      assert.equal(dated.status, 403);
      assert.equal(
        ((await dated.json()) as { error: string }).error,
        "PlanRequired",
      );
      assert.deepEqual(seen, [], "never reached the registry");
      const after = await call(e, api, "/v1/registry/get", {
        key,
        body: { urn: "x" },
      });
      assert.equal(
        after.headers.get("x-factlot-registry-quota-remaining"),
        "24",
      );
    });

    it("MCP: batch, dated registry_get, model and account tools are not available; plain registry_get is cut", async () => {
      const { e, mail } = gated();
      const { api, seen } = gatedApi();
      const key = await mint(e, mail, "gate3@example.com");
      for (const [name, args] of [
        ["registry_tx_equity_candidates_batch", {}],
        ["registry_get", { urn: "x", as_of: "2025-06-01" }],
      ] as const) {
        const res = (await (await mcp(e, api, name, args, key)).json()) as {
          result: { isError: boolean; structuredContent: { error: string } };
        };
        assert.equal(res.result.isError, true, name);
        assert.equal(res.result.structuredContent.error, "PlanRequired", name);
      }
      const model = await (
        await mcp(e, api, "doc_extract_lease", { text: "x" }, key)
      ).text();
      assert.match(model, /PlanRequired|ModelUnavailable/);
      const acct = await (await mcp(e, api, "account_usage", {}, key)).text();
      assert.doesNotMatch(acct, /"plan"\s*:\s*"(pro|team)"/);
      assert.ok(!seen.includes("/mcp") || seen.length <= 1);
      const list = (await (
        await call(e, api, "/mcp", {
          key,
          body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
        })
      ).json()) as { result?: { tools?: { name: string }[] } };
      const names = (list.result?.tools ?? []).map((t) => t.name);
      assert.ok(!names.includes("account_usage"));
      assert.ok(!names.includes("account_rotate_key"));
      const ok = (await (
        await mcp(e, api, "registry_get", { urn: "x" }, key)
      ).json()) as {
        result: { structuredContent: Record<string, unknown> };
      };
      assert.equal(
        ok.result.structuredContent.value_history instanceof Array,
        true,
      );
      assert.equal(
        (ok.result.structuredContent.value_history as unknown[]).length,
        1,
      );
      assert.equal(ok.result.structuredContent.history_available, "pro");
    });

    it("has exactly a keyless caller's minute limit, daily lookups and report allowance", async () => {
      const { e, mail } = gated();
      const { api } = gatedApi();
      const key = await mint(e, mail, "gate4@example.com");
      const ip = "198.51.100.60";
      const headers = async (k?: string, from = ip) => {
        const r = await call(e, api, "/v1/registry/get", {
          key: k,
          ip: from,
          body: { urn: "x" },
        });
        return [
          r.headers.get("x-factlot-tier"),
          r.headers.get("x-factlot-registry-quota-limit"),
        ];
      };
      assert.deepEqual(
        await headers(key),
        await headers(undefined, "198.51.100.61"),
      );
      // Reports: the free allowance (3 a month), counted for the address behind the key, so a
      // replaced key does not restart it.
      const report = (k: string, from = ip) =>
        call(e, api, "/v1/reports", {
          key: k,
          ip: from,
          body: {
            kind: "debt_sizing",
            format: "pdf",
            arguments: {
              noi: 2_205_000,
              value: 36_000_000,
              rate_annual: 0.0625,
              amortization_years: 30,
              max_ltv: 0.7,
              min_dscr: 1.25,
              min_debt_yield: 0.085,
              round_down_to: 1000,
            },
          },
        });
      for (let i = 0; i < 3; i++)
        assert.equal((await report(key)).status, 201, `report ${i + 1}`);
      const over = await report(key);
      assert.equal(over.status, 429);
      const err = (await over.json()) as {
        code: string;
        message: string;
        limit: number;
      };
      assert.equal(err.code, "ReportQuotaExceeded");
      assert.equal(err.limit, REPORTS_PER_MONTH.anonymous);
      assert.match(
        err.message,
        /3 a month per email address behind a free key/,
      );
      assert.equal(over.headers.get("x-factlot-tier"), "anonymous");
      // A new key for the same address does not restart the month.
      waitPassed(e);
      const again = await mint(e, mail, "gate4@example.com", "203.0.113.77");
      assert.equal((await report(again, "198.51.100.62")).status, 429);
      // A keyless caller from another address has its own allowance.
      assert.equal(
        (await report(undefined as unknown as string, "198.51.100.63")).status,
        201,
      );
    });

    it("/v1/plans names a free key a free caller under gating, and lists no paid feature for it", async () => {
      const { e } = gated();
      const plans = (await (
        await call(e, innerApi().api, "/v1/plans", { method: "GET" })
      ).json()) as {
        plans: { free: { free_key: { note: string; auth: string } } };
      };
      const note = plans.plans.free.free_key.note;
      assert.match(note, /free caller/);
      assert.match(note, /no access to paid tools/);
      assert.match(
        note,
        /earlier roll years in value history, an owner's parcels beyond the first three, a parcel's recorded sales and documents beyond the newest sale or deed, registry batch tools or dated registry_get/,
      );
      assert.equal(plans.plans.free.free_key.auth, "bearer");
    });

    it("a free key is never a paid caller: no key sent to account routes, billing or OAuth sign-in works", async () => {
      const { e, mail, api } = gated();
      const key = await mint(e, mail, "gate5@example.com");
      for (const [path, method] of [
        ["/v1/account", "GET"],
        ["/v1/account/usage", "GET"],
        ["/v1/billing/portal", "POST"],
        ["/v1/billing/rotate", "POST"],
        ["/v1/billing/keys", "GET"],
      ] as const)
        assert.equal(
          (await call(e, api, path, { key, method })).status,
          401,
          path,
        );
      const fake = fakeStripe({});
      const res = await run(
        e,
        new Request("https://factlot.com/account", {
          method: "POST",
          body: new URLSearchParams({ key, action: "view" }).toString(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://factlot.com",
            "cf-connecting-ip": IP,
          },
        }),
        fake.fetchImpl,
      );
      assert.ok(
        res.status >= 400,
        "the account page does not open for a free key",
      );
      assert.equal(fake.calls.length, 0, "Stripe was never called");
    });
  });

  it("two clicks on one link at the same time make one key", async () => {
    const { e, mail } = setup();
    await ask(e, "race@example.com");
    const url = linkOf(mail.sent[0]!.text)!;
    const [a, b] = await Promise.all([
      open(e, url, "POST"),
      open(e, url, "POST"),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 410]);
    assert.equal(
      [...e.KEYS.data.keys()].filter((k) => k.startsWith("freekey:")).length,
      1,
    );
  });

  it("an unused link creates no key and expires with its record", async () => {
    const { e, mail } = setup();
    await ask(e, "unused@example.com");
    assert.equal(
      [...e.KEYS.data.keys()].filter((k) => k.startsWith("freekey:")).length,
      0,
    );
    assert.ok([...e.KEYS.data.keys()].some((k) => k.startsWith("freelink:")));
    const url = linkOf(mail.sent[0]!.text)!;
    e.clock.t += 31 * 60_000;
    const gone = await open(e, url, "GET");
    assert.equal(gone.status, 410);
    assert.equal(
      [...e.KEYS.data.keys()].filter((k) => k.startsWith("freekey:")).length,
      0,
    );
  });
});

describe("MCP resources and prompts on the hosted /mcp", () => {
  /** The real @factlot/server handler as worker.ts creates it (hosted), on a local port. */
  async function hostedInnerApi() {
    const handler = createHandler({
      maxBodyBytes: 1024 * 1024,
      trustProxy: true,
      hosted: true,
      logSink: () => {},
    });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const { port } = server.address() as AddressInfo;
    return {
      close: () => server.close(),
      api: {
        fetch: async (r: Request) => {
          const u = new URL(r.url);
          const headers = new Headers(r.headers);
          headers.delete("host");
          headers.delete("content-length");
          return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
            method: r.method,
            headers,
            body: r.method === "GET" ? undefined : await r.text(),
          });
        },
      },
    };
  }

  /** A registry service that answers registry_get with a parcel record. */
  const service = {
    async fetch(r: Request) {
      const { tool, input } = (await r.json()) as {
        tool: string;
        input: { urn?: string };
      };
      assert.equal(tool, "registry_get");
      return new Response(
        JSON.stringify({
          ok: true,
          result: { urn: input.urn, status: "current", facts: [] },
        }),
      );
    },
  };

  type Rpc = {
    id?: unknown;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };

  const post = async (
    e: ReturnType<typeof env>,
    api: { fetch(r: Request): Promise<Response> },
    body: unknown,
  ) => {
    const res = await handle(
      new Request("https://api.factlot.com/mcp", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "cf-connecting-ip": IP,
        },
      }),
      e,
      api,
      { now: () => e.clock.t },
    );
    assert.equal(res.status, 200);
    return (await res.json()) as Rpc | Rpc[];
  };
  const rpc = async (
    e: ReturnType<typeof env>,
    api: { fetch(r: Request): Promise<Response> },
    method: string,
    params: Record<string, unknown> = {},
  ) => (await post(e, api, { jsonrpc: "2.0", id: 1, method, params })) as Rpc;
  const text = (r: Rpc) => (r.result!.contents as { text: string }[])[0]!.text;

  /** Registry lookups counted so far, over every meter object. */
  const lookups = (e: ReturnType<typeof env>) =>
    [...e.limiter.objects]
      .filter(([name]) => name.startsWith("meter:"))
      .reduce(
        (a, [, o]) =>
          a + [...o.store.counts.values()].reduce((x, n) => x + n, 0),
        0,
      );

  const URN = "fl:parcel:us-48201:0011440000001";
  const getCall = (id: number) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "registry_get", arguments: { urn: URN } },
  });

  async function withHosted(
    fn: (
      e: ReturnType<typeof env>,
      api: { fetch(r: Request): Promise<Response> },
    ) => Promise<void>,
  ) {
    const inner = await hostedInnerApi();
    configureRegistryRunner(registryRunner(service));
    try {
      await fn(env({ RL_ANON: new CountingLimit(1000) }), inner.api);
    } finally {
      configureRegistryRunner(undefined);
      inner.close();
    }
  }

  it("keyless: declared in initialize, every resource reads, prompts validate, and no lookup is used where a registry call uses one", async () => {
    await withHosted(async (e, api) => {
      // A metered call first: the counter moves, so the checks below can see a lookup.
      const get = (await post(e, api, getCall(9))) as Rpc;
      assert.notEqual(
        (get.result as { isError?: boolean }).isError,
        true,
        JSON.stringify(get),
      );
      const afterGet = lookups(e);
      assert.equal(afterGet, 1, "the registry_get was counted");

      const init = await rpc(e, api, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "check", version: "1" },
      });
      const caps = init.result!.capabilities as Record<string, unknown>;
      assert.ok(caps.resources && caps.prompts && caps.tools);
      assert.match(String(init.result!.instructions), /factlot:\/\/coverage/);

      // Exactly the expected resources for the current hosted.json.
      const hosted = JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL("../../../site/_data/hosted.json", import.meta.url),
          ),
          "utf8",
        ),
      ) as { totals: unknown; places: { key: string }[] };
      const { RESOURCE_DATA, hostedMarkets } = await import("@factlot/mcp");
      const want = [
        "factlot://coverage",
        "factlot://sources",
        "factlot://markets",
        "factlot://schemas/fact",
        "factlot://schemas/tools",
        "factlot://spec/id",
        "factlot://plans",
        ...hosted.places.map((p) => `factlot://coverage/${p.key}`),
        ...hostedMarkets(RESOURCE_DATA).map(
          (m: { slug: string }) => `factlot://markets/${m.slug}`,
        ),
      ].sort();
      const resources = (await rpc(e, api, "resources/list")).result!
        .resources as { uri: string }[];
      assert.deepEqual(resources.map((r) => r.uri).sort(), want);
      for (const r of resources)
        assert.ok(
          text(await rpc(e, api, "resources/read", { uri: r.uri })).length > 0,
          r.uri,
        );
      const cov = JSON.parse(
        text(
          await rpc(e, api, "resources/read", { uri: "factlot://coverage" }),
        ),
      ) as { this_server: string; totals: unknown };
      assert.equal(cov.this_server, "hosted");
      assert.deepEqual(cov.totals, hosted.totals);

      const prompts = (await rpc(e, api, "prompts/list")).result!.prompts as {
        name: string;
      }[];
      assert.ok(prompts.some((p) => p.name === "property_owner"));
      const got = await rpc(e, api, "prompts/get", {
        name: "parcel_value_history",
        arguments: { parcel: "1000 Louisiana St, Houston" },
      });
      const msg = (got.result!.messages as { content: { text: string } }[])[0]!;
      assert.match(msg.content.text, /registry_coverage/);
      assert.doesNotMatch(msg.content.text, /has no registry loaded/);
      const bad = await rpc(e, api, "prompts/get", {
        name: "parcel_value_history",
        arguments: { parcel: "x\u0000", as_of: "yesterday" },
      });
      assert.equal(bad.error?.code, -32602);

      assert.equal(
        lookups(e),
        afterGet,
        "resources and prompts used no lookup",
      );
    });
  });

  it("a batch mixing resources/read and tools/call charges the tool call only", async () => {
    await withHosted(async (e, api) => {
      const answers = (await post(e, api, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: "factlot://coverage" },
        },
        getCall(2),
        {
          jsonrpc: "2.0",
          id: 3,
          method: "prompts/get",
          params: { name: "property_owner", arguments: { property: "x" } },
        },
      ])) as Rpc[];
      assert.deepEqual(answers.map((a) => a.id).sort(), [1, 2, 3]);
      for (const a of answers) assert.ok(a.result, JSON.stringify(a.error));
      assert.equal(lookups(e), 1);
    });
  });

  it("hostile resource URIs get a clean JSON-RPC error", async () => {
    await withHosted(async (e, api) => {
      for (const uri of [
        "factlot://sources/__proto__",
        "factlot://coverage/constructor",
        "factlot://markets/toString",
        "factlot://schemas/tools/__proto__",
        `factlot://markets/${"a".repeat(100_000)}`,
        "factlot://__proto__",
      ]) {
        const r = await rpc(e, api, "resources/read", { uri });
        assert.ok(r.error, uri.slice(0, 60));
        assert.ok(
          [-32002, -32602].includes(r.error.code),
          `${uri.slice(0, 60)}: ${r.error.code}`,
        );
        assert.ok(r.error.message.length < 300, "no echo of a long URI");
      }
      assert.equal(lookups(e), 0);
    });
  });

  it("the tool index lists what tools/list lists, the hosted tools included", async () => {
    await withHosted(async (e, api) => {
      const listed = (
        (await rpc(e, api, "tools/list")).result!.tools as { name: string }[]
      ).map((t) => t.name);
      const index = JSON.parse(
        text(
          await rpc(e, api, "resources/read", {
            uri: "factlot://schemas/tools",
          }),
        ),
      ) as { tools: { name: string; hosted_extra?: boolean }[] };
      assert.deepEqual(
        index.tools.map((t) => t.name).sort(),
        [...listed].sort(),
      );
      assert.ok(listed.includes("report_create"));
      assert.ok(listed.includes("registry_get"));
      assert.equal(
        index.tools.find((t) => t.name === "report_create")?.hosted_extra,
        true,
      );
    });
  });
});

describe("lifecycle emails", () => {
  const SECRET = "test-recovery-secret";
  const ADDRESS = "1 Test Way, Austin, TX 78701";
  const PARCEL = "fl:parcel:us-48201:0001";
  const j = (b: unknown) =>
    new Response(JSON.stringify(b), {
      headers: { "content-type": "application/json" },
    });
  /** A registry whose get answer has three roll years, so a free key's answer is cut. */
  const gatedApi = {
    fetch: async (r: Request) => {
      await r.text();
      return j({
        urn: PARCEL,
        value_history: [
          { tax_year: 2025, market_value: 3 },
          { tax_year: 2024, market_value: 2 },
          { tax_year: 2023, market_value: 1 },
        ],
      });
    },
  };
  function setup(over: Partial<Env> = {}) {
    const mail = fakeEmail();
    const e = env({
      EMAIL: mail.binding,
      RECOVERY_SIGNING_SECRET: SECRET,
      FREE_KEY_ENABLED: "true",
      LIFECYCLE_EMAILS_ENABLED: "true",
      GATING_ENABLED: "true",
      POSTAL_ADDRESS: ADDRESS,
      ...over,
    });
    e.RL_ANON = new CountingLimit(100000);
    return { mail, e };
  }
  type E = ReturnType<typeof env>;
  const ask = (e: E, email: string, optional: boolean, ip = IP) =>
    run(
      e,
      new Request("https://api.factlot.com/v1/keys/free", {
        method: "POST",
        body: JSON.stringify({
          email,
          accept_terms: true,
          ...(optional ? { lifecycle_emails: true } : {}),
        }),
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      }),
    );
  const linkOf = (text: string) =>
    text.match(
      /https:\/\/factlot\.com\/account\/free-key\/[A-Za-z0-9_.-]+/,
    )?.[0];
  const open = (e: E, url: string, method = "GET", body = "", ip = IP) =>
    run(
      e,
      new Request(url, {
        method,
        body: method === "POST" ? body : undefined,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://factlot.com",
          "cf-connecting-ip": ip,
        },
      }),
    );
  const waitPassed = (e: E) => {
    e.clock.t += 6 * 60_000;
    for (const k of [...e.KEYS.data.keys()])
      if (k.startsWith("freewait:")) e.KEYS.data.delete(k);
  };
  async function mint(
    e: E,
    mail: ReturnType<typeof fakeEmail>,
    email: string,
    optional: boolean,
  ): Promise<string> {
    const before = mail.sent.length;
    assert.equal((await ask(e, email, optional)).status, 202);
    assert.equal(mail.sent.length, before + 1, "one link email");
    const res = await open(e, linkOf(mail.sent[before]!.text)!, "POST");
    const key = (await res.text()).match(/fl_free_[A-Za-z0-9_-]{43}/)?.[0];
    assert.ok(key, "key shown");
    return key;
  }
  const flush = () => new Promise((r) => setImmediate(r));
  /** A lookup, with the deferred work (the router defers emails) awaited. */
  async function lookup(e: E, key: string, api = gatedApi, ip = IP) {
    const deferred: Promise<unknown>[] = [];
    const res = await handle(
      new Request("https://api.factlot.com/v1/registry/get", {
        method: "POST",
        body: JSON.stringify({ urn: PARCEL }),
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": ip,
          authorization: `Bearer ${key}`,
        },
      }),
      e,
      api,
      { now: () => e.clock.t, waitUntil: (p) => deferred.push(p) },
    );
    await Promise.all(deferred);
    await flush();
    return res;
  }
  const optionalMails = (mail: ReturnType<typeof fakeEmail>) =>
    mail.sent.filter((m) =>
      m.text.includes("Stop these emails with one click"),
    );
  const lcKeys = (e: E, prefix = "lc") =>
    [...e.KEYS.data.keys()].filter((k) => k.startsWith(`${prefix}:`));
  const DAY = 86_400_000;

  it("sorts every message into one of two classes, and optional ones are the promotional ones", () => {
    assert.equal(MESSAGES.A0.class, "transactional");
    assert.equal(MESSAGES.B0.class, "transactional");
    for (const id of ["A1", "A2", "A3", "A4", "B1", "B2"] as const)
      assert.equal(MESSAGES[id].class, "promotional", id);
    assert.deepEqual(optionalMessages("free"), ["A1", "A2", "A3", "A4"]);
    assert.deepEqual(optionalMessages("paid"), ["B1", "B2"]);
    assert.equal(PROMO_DAILY_CAP, 1);
  });

  it("is dark unless the variable is exactly true: no boxes, no stop route, no connect line, nothing sent", async () => {
    for (const v of [undefined, "TRUE", "1", "yes", ""]) {
      const { e, mail } = setup({ LIFECYCLE_EMAILS_ENABLED: v });
      const page = await (
        await run(e, new Request("https://factlot.com/account"))
      ).text();
      assert.match(page, /accept_terms/);
      assert.doesNotMatch(page, /lifecycle_emails|account\/stop/);
      const unknown = await run(
        e,
        new Request("https://factlot.com/account/nothing-here"),
      );
      for (const path of [
        "/account/stop",
        "/account/stop/x",
        "/account/lifecycle",
      ]) {
        const r = await run(e, new Request(`https://factlot.com${path}`));
        assert.equal(r.status, unknown.status, path);
        assert.doesNotMatch(
          await r.text(),
          /Stop optional emails|Optional emails/,
        );
      }
      const key = await mint(e, mail, "dark@example.com", true);
      assert.doesNotMatch(mail.sent[0]!.text, /connect it to your assistant/);
      assert.equal(lcKeys(e).length, 0, "no consent record");
      await lookup(e, key);
      assert.equal(optionalMails(mail).length, 0);
      e.clock.t += 8 * DAY;
      assert.deepEqual(await lifecycleSweep(e, e.clock.t), {
        checked: 0,
        sent: {},
        removed: 0,
        errors: 0,
        complete: true,
      });
      // Strict equivalence: no free-key tally, no address in the link record, no lifecycle writes.
      assert.equal(
        (await e.METER.usage(`freekey:${keyId(await hashKey(key))}`, 7)).total,
        0,
        "no tally",
      );
      for (const [k, v] of e.KEYS.data)
        if (k.startsWith("freelink:")) assert.doesNotMatch(v, /lc_to|dark@/);
      assert.deepEqual(
        [...e.KEYS.data.keys()].filter((k) => /^lc/.test(k)),
        [],
        "no lifecycle keys",
      );
      assert.equal(mail.sent.length, 1, "only the link email");
    }
  });

  it("is not in the shipped wrangler config", () => {
    const text = readFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(text, /^\s*"LIFECYCLE_EMAILS_ENABLED"/m);
    assert.doesNotMatch(text, /^\s*"POSTAL_ADDRESS"/m);
  });

  it("shows an unticked consent box on the free key form and a stop form on /account when on", async () => {
    const { e } = setup();
    const page = await (
      await run(e, new Request("https://factlot.com/account"))
    ).text();
    const box = page.match(
      /<input type="checkbox" name="lifecycle_emails"[^>]*>/,
    )?.[0];
    assert.ok(box, "box present");
    assert.doesNotMatch(box, /checked|required/);
    assert.ok(page.includes(escapeHtml(freeConsentText())));
    assert.match(page, /action="\/account\/stop"/);
    assert.match(
      page,
      /We email one link, once, unless you tick the box above/,
    );
  });

  it("A0 (key link email) is transactional: it carries the connect line with or without the box, and needs no consent", async () => {
    for (const optional of [false, true]) {
      const { e, mail } = setup();
      await ask(e, `a0-${optional}@example.com`, optional);
      const text = mail.sent[0]!.text;
      assert.match(text, /connect it to your assistant/);
      assert.match(text, /https:\/\/factlot\.com\/mcp-server\//);
      assert.doesNotMatch(text, /Stop these emails/);
      assert.match(text, /transactional/);
      assert.equal(
        lcKeys(e).length,
        0,
        "nothing recorded before the link is opened",
      );
    }
  });

  it("records consent only when the link is opened, only if the box was ticked, and no extra personal data", async () => {
    const { e, mail } = setup();
    await ask(e, "yes@example.com", true);
    assert.equal(lcKeys(e).length, 0, "not at request");
    const link = linkOf(mail.sent[0]!.text)!;
    const key = (await (await open(e, link, "POST")).text()).match(
      /fl_free_[A-Za-z0-9_-]{43}/,
    )?.[0];
    assert.ok(key);
    const [name] = lcKeys(e);
    assert.match(name!, /^lc:free:[0-9a-f]{64}$/);
    const rec = JSON.parse(e.KEYS.data.get(name!)!) as Record<string, unknown>;
    assert.equal(rec.to, "yes@example.com");
    assert.equal(typeof rec.consent_at, "string");
    assert.deepEqual(Object.keys(rec).sort(), [
      "consent_at",
      "key_hash",
      "kind",
      "since",
      "subject",
      "to",
      "v",
    ]);
    await mint(e, mail, "no@example.com", false);
    assert.equal(lcKeys(e).length, 1, "an unticked box records nothing");
  });

  it("A1: the first gated answer to a consenting free key sends one note with the facts of the answer, once", async () => {
    const { e, mail } = setup();
    const key = await mint(e, mail, "a1@example.com", true);
    assert.equal((await lookup(e, key)).status, 200);
    const sent = optionalMails(mail);
    assert.equal(sent.length, 1);
    const m = sent[0]!;
    assert.equal(m.to, "a1@example.com");
    assert.match(
      m.text,
      /2 earlier roll years for that record \(2023 to 2024\)/,
    );
    assert.match(
      m.text,
      new RegExp(
        `https://factlot\\.com/billing/checkout\\?plan=pro&urn=${encodeQuery(PARCEL).replaceAll(".", "\\.")}`,
      ),
    );
    assert.ok(
      m.text.includes(`${priceText(PLANS.pro)}`),
      "price from plans.ts",
    );
    assert.ok(m.text.includes(ADDRESS), "postal address");
    assert.match(
      m.text,
      /https:\/\/factlot\.com\/account\/stop\/[0-9a-f]{64}\.[0-9a-f]{64}/,
    );
    assert.doesNotMatch(m.text, /fl_free_/);
    // Once per person per message, even on the next day.
    e.clock.t += DAY;
    await lookup(e, key);
    assert.equal(optionalMails(mail).length, 1);
    // A free key whose owner did not tick the box gets nothing.
    const other = await mint(e, mail, "a1-no@example.com", false);
    await lookup(e, other, gatedApi, "198.51.100.4");
    assert.equal(optionalMails(mail).length, 1);
  });

  it("A3: running out of the day's lookups sends one note with the limit; the daily cap holds one note a day", async () => {
    const { e, mail } = setup();
    const plain = innerApi().api;
    const key = await mint(e, mail, "a3@example.com", true);
    const ip = "198.51.100.7";
    for (let i = 0; i < 25; i++)
      assert.equal(
        (await lookup(e, key, plain as typeof gatedApi, ip)).status,
        200,
        `${i}`,
      );
    assert.equal(optionalMails(mail).length, 0);
    assert.equal(
      (await lookup(e, key, plain as typeof gatedApi, ip)).status,
      429,
    );
    const sent = optionalMails(mail);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /used its 25 registry lookups for today/);
    assert.match(sent[0]!.text, /5,000 registry lookups a month/);
    // Again the same day: once only.
    await lookup(e, key, plain as typeof gatedApi, ip);
    assert.equal(optionalMails(mail).length, 1);
    // The cap: another person gets A1 and then, the same day, A3 is held back.
    const { e: e2, mail: mail2 } = setup();
    const k2 = await mint(e2, mail2, "cap@example.com", true);
    await lookup(e2, k2); // A1
    assert.equal(optionalMails(mail2).length, 1);
    for (let i = 0; i < 24; i++) await lookup(e2, k2, plain as typeof gatedApi);
    assert.equal((await lookup(e2, k2, plain as typeof gatedApi)).status, 429);
    assert.equal(
      optionalMails(mail2).length,
      1,
      "A3 waits: one optional note a day",
    );
  });

  it("the daily cap is per person per UTC day: the held note goes out the next day it is triggered", async () => {
    const { e, mail } = setup();
    const k = await mint(e, mail, "cap2@example.com", true);
    const h = lcKeys(e)[0]!.split(":")[2]!;
    const now = e.clock.t;
    const build = (_r: unknown, ctx: { stopUrl: string }) => ({
      subject: "x",
      text: ctx.stopUrl,
      html: "x",
    });
    assert.equal(await deliverPromo(e, "free", h, "A1", now, build), "sent");
    assert.equal(
      await deliverPromo(e, "free", h, "A3", now + 1000, build),
      "cap",
    );
    assert.equal(
      await deliverPromo(e, "free", h, "A3", now + DAY, build),
      "sent",
    );
    assert.equal(
      await deliverPromo(e, "free", h, "A3", now + 2 * DAY, build),
      "already",
    );
    assert.equal(k.startsWith("fl_free_"), true);
  });

  it("A2 and A4: the daily sweep sends the unused-key note after 2 days and the recap after 7, with the key's own numbers", async () => {
    const { e, mail } = setup();
    const idle = await mint(e, mail, "idle@example.com", true);
    const busy = await mint(e, mail, "busy@example.com", true);
    for (let i = 0; i < 3; i++)
      await lookup(e, busy, innerApi().api as typeof gatedApi, "198.51.100.9");
    assert.ok(idle);
    assert.deepEqual(
      (await lifecycleSweep(e, e.clock.t)).sent,
      {},
      "too early",
    );
    e.clock.t += 3 * DAY;
    const r2 = await lifecycleSweep(e, e.clock.t);
    assert.deepEqual(r2.sent, { A2: 1 });
    const a2 = optionalMails(mail).find((m) => m.to === "idle@example.com")!;
    assert.match(a2.text, /has not made a lookup yet/);
    // Once only, and the active key never gets A2.
    assert.deepEqual((await lifecycleSweep(e, e.clock.t)).sent, {});
    e.clock.t += 5 * DAY;
    const r4 = await lifecycleSweep(e, e.clock.t);
    assert.deepEqual(r4.sent, { A4: 1 });
    const a4 = optionalMails(mail).find((m) => m.to === "busy@example.com")!;
    assert.match(a4.text, /has made 3 registry lookups/);
    assert.match(a4.text, /registry_get/);
    assert.match(a4.subject, /3 lookups/);
    assert.deepEqual((await lifecycleSweep(e, e.clock.t)).sent, {});
  });

  it("B1 and B2: a consenting paid plan gets the day-1 and day-7 notes; consent is recorded from the page after checkout", async () => {
    const paid = {
      status: "complete",
      payment_status: "paid",
      mode: "subscription",
      subscription: "sub_9",
      customer: "cus_9",
      customer_details: { email: "buyer@example.com" },
      metadata: { factlot_plan: "pro" },
    };
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [200, paid],
    });
    const { e, mail } = setup({ STRIPE_SECRET_KEY: "sk_test_x" });
    const page = await (
      await run(
        e,
        new Request(
          `https://factlot.com/billing/success?session_id=${SESSION}`,
        ),
        s.fetchImpl,
      )
    ).text();
    assert.ok(page.includes(escapeHtml(paidConsentText())));
    assert.match(page, /name="lifecycle_emails"/);
    assert.doesNotMatch(
      page.match(/<input type="checkbox" name="lifecycle_emails"[^>]*>/)![0],
      /checked/,
    );
    assert.equal(
      mail.sent.length,
      1,
      "the welcome email, sent without consent",
    );
    // Unticked: nothing recorded.
    // The success page stamps its proof with the real clock; bring the test clock to it.
    e.clock.t = Date.now();
    const proof = {
      t: page.match(/name="t" value="(\d+)"/)![1]!,
      p: page.match(/name="proof" value="([0-9a-f]+)"/)![1]!,
    };
    const form = (extra: string) =>
      run(
        e,
        new Request("https://factlot.com/account/lifecycle", {
          method: "POST",
          body: `session_id=${SESSION}&t=${proof.t}&proof=${proof.p}${extra}`,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://factlot.com",
            "cf-connecting-ip": IP,
          },
        }),
        s.fetchImpl,
      );
    assert.equal((await form("")).status, 200);
    assert.equal(lcKeys(e).length, 0);
    assert.equal((await form("&lifecycle_emails=1")).status, 200);
    const [name] = lcKeys(e);
    assert.match(name!, /^lc:paid:/);
    // The plan's key (written by the redemption) is active; B1 after a day with no lookups.
    e.clock.t += 2 * DAY;
    // Refresh the key record's check time so no Stripe re-check is needed.
    const sub = JSON.parse(e.KEYS.data.get("sub:sub_9")!) as string[];
    const kr = JSON.parse(e.KEYS.data.get(`key:${sub[0]}`)!) as KeyRecord;
    await writeKey(
      e.KEYS,
      sub[0]!,
      { ...kr, checked_at: e.clock.t },
      e.clock.t,
    );
    const r1 = await lifecycleSweep(e, e.clock.t);
    assert.deepEqual(r1.sent, { B1: 1 });
    const b1 = optionalMails(mail)[0]!;
    assert.equal(b1.to, "buyer@example.com");
    assert.match(b1.text, /\/v1\/onboarding\?plan=pro/);
    assert.match(b1.text, /Stop these emails/);
    // Usage in the plan's meter, then day 7: B2 with the plan's own numbers.
    await e.METER.record("sub:sub_9", [
      { tool: "registry_get", region: "us-48" },
      { tool: "registry_get", region: "us-48" },
    ]);
    e.clock.t += 6 * DAY;
    await writeKey(
      e.KEYS,
      sub[0]!,
      { ...kr, checked_at: e.clock.t },
      e.clock.t,
    );
    assert.deepEqual((await lifecycleSweep(e, e.clock.t)).sent, { B2: 1 });
    const b2 = optionalMails(mail)[1]!;
    assert.match(b2.text, /has made 2 registry lookups/);
    assert.ok(
      b2.text.includes(
        PLANS.pro.registryLookupsPerMonth.toLocaleString("en-US"),
      ),
    );
  });

  it("promotional notes need consent; with no record the sweep and the triggers send nothing; welcome (B0) needs none", async () => {
    const { e, mail } = setup();
    const key = await mint(e, mail, "plain@example.com", false);
    await lookup(e, key);
    e.clock.t += 9 * DAY;
    assert.deepEqual((await lifecycleSweep(e, e.clock.t)).sent, {});
    assert.equal(optionalMails(mail).length, 0);
    assert.equal(mail.sent.length, 1);
    // B0: the welcome email is sent on checkout with the box never shown or ticked.
    const s = fakeStripe({
      [`GET /checkout/sessions/${SESSION}`]: () => [
        200,
        {
          status: "complete",
          payment_status: "paid",
          mode: "subscription",
          subscription: "sub_1",
          customer: "cus_1",
          customer_details: { email: "buyer@example.com" },
          metadata: { factlot_plan: "pro" },
        },
      ],
    });
    const e2 = env({
      STRIPE_SECRET_KEY: "sk_test_x",
      EMAIL: mail.binding,
      LIFECYCLE_EMAILS_ENABLED: "true",
    });
    await run(
      e2,
      new Request(`https://factlot.com/billing/success?session_id=${SESSION}`),
      s.fetchImpl,
    );
    assert.equal(mail.sent.at(-1)!.subject, "Welcome to FactLot Pro");
    assert.doesNotMatch(mail.sent.at(-1)!.text, /Stop these emails/);
  });

  it("optional notes are not sent without a postal address, a sender or the signing secret", async () => {
    for (const over of [
      { POSTAL_ADDRESS: undefined },
      { POSTAL_ADDRESS: "   " },
    ]) {
      const { e, mail } = setup(over);
      const key = await mint(e, mail, "noaddr@example.com", true);
      await lookup(e, key);
      assert.equal(optionalMails(mail).length, 0);
      assert.equal(mail.sent.length, 1);
    }
  });

  it("the stop link works without signing in, is single-purpose, and is idempotent", async () => {
    const { e, mail } = setup();
    const key = await mint(e, mail, "stop@example.com", true);
    await lookup(e, key);
    const m = optionalMails(mail)[0]!;
    const stop = m.text.match(
      /https:\/\/factlot\.com\/account\/stop\/[0-9a-f.]+/,
    )![0];
    assert.match(m.html ?? "", /account\/stop\//);
    // A HEAD (mail scanner) changes nothing, and neither does a GET: it shows a button.
    assert.equal((await open(e, stop, "HEAD")).status, 200);
    const shown = await open(e, stop);
    assert.equal(shown.status, 200);
    assert.match(await shown.text(), /<button[^>]*>Stop optional emails/);
    assert.equal(lcKeys(e).length, 1, "a GET stops nothing");
    const first = await open(e, stop, "POST", "List-Unsubscribe=One-Click");
    assert.equal(first.status, 200);
    assert.match(await first.text(), /Optional emails stopped/);
    assert.equal(lcKeys(e).length, 0, "consent record and address deleted");
    assert.equal(lcKeys(e, "lcstop").length, 1);
    const marker = [...e.KEYS.data.entries()].find(([k]) =>
      k.startsWith("lcstop:"),
    )!;
    assert.match(marker[1], /^2026-/, "only a time");
    // Again, by POST (one-click): the same.
    assert.equal(
      (await open(e, stop, "POST", "List-Unsubscribe=One-Click")).status,
      200,
    );
    assert.equal(lcKeys(e, "lcstop").length, 1);
    // Single purpose: a forged or cut token does nothing; the stop token is not a key link.
    const forged = `${stop.slice(0, -1)}${stop.endsWith("a") ? "b" : "a"}`;
    assert.equal((await open(e, forged)).status, 404);
    assert.equal(
      (await open(e, "https://factlot.com/account/stop/nonsense")).status,
      404,
    );
    const token = stop.split("/").pop()!;
    assert.equal(
      (await open(e, `https://factlot.com/account/free-key/${token}`, "POST"))
        .status,
      404,
      "a stop token cannot mint a key",
    );
    assert.equal(
      (
        await open(
          e,
          `https://factlot.com/account/free-key-delete/${token}`,
          "POST",
        )
      ).status,
      404,
      "a stop token cannot delete a key",
    );
    assert.equal(
      (await open(e, `https://factlot.com/account/recover/${token}`, "POST"))
        .status,
      404,
    );
    // And a key-link token cannot stop.
    await ask(e, "someone@example.com", false);
    const link = linkOf(mail.sent.at(-1)!.text)!;
    assert.equal(
      (
        await open(
          e,
          `https://factlot.com/account/stop/${link.split("/").pop()}`,
        )
      ).status,
      404,
    );
  });

  it("the account page stops optional emails by address, with the same answer for every address", async () => {
    const { e, mail } = setup();
    await mint(e, mail, "form@example.com", true);
    assert.equal(lcKeys(e).length, 1);
    const stop = (email: string) =>
      open(
        e,
        "https://factlot.com/account/stop",
        "POST",
        `email=${encodeURIComponent(email)}`,
      );
    const a = await stop("form@example.com");
    const b = await stop("never-signed-up@example.com");
    assert.equal(a.status, 200);
    const bare = (r: string) => r.replace(/nonce="[^"]*"/g, "");
    assert.equal(bare(await a.text()), bare(await b.text()));
    assert.equal(lcKeys(e).length, 0);
    assert.equal((await stop("not an email")).status, 400);
  });

  it("a stopped address never gets an optional note again: not after a new key, not after deleting the key, not after ticking again", async () => {
    const { e, mail } = setup();
    const k1 = await mint(e, mail, "gone@example.com", true);
    await open(
      e,
      "https://factlot.com/account/stop",
      "POST",
      "email=gone%40example.com",
    );
    assert.equal(lcKeys(e).length, 0);
    // A new key with the box ticked: the key and the link email are fine, no consent is recorded.
    waitPassed(e);
    const k2 = await mint(e, mail, "gone@example.com", true);
    assert.notEqual(k1, k2);
    assert.equal(lcKeys(e).length, 0);
    await lookup(e, k2);
    assert.equal(optionalMails(mail).length, 0);
    e.clock.t += 9 * DAY;
    assert.deepEqual((await lifecycleSweep(e, e.clock.t)).sent, {});
    // Deleting the key does not delete the stop marker.
    const del = await handle(
      new Request("https://api.factlot.com/v1/keys/free", {
        method: "DELETE",
        headers: { authorization: `Bearer ${k2}`, "cf-connecting-ip": IP },
      }),
      e,
      innerApi().api,
      { now: () => e.clock.t },
    );
    assert.equal(del.status, 200);
    assert.equal(lcKeys(e, "lcstop").length, 1);
    waitPassed(e);
    const k3 = await mint(e, mail, "gone@example.com", true);
    assert.equal(lcKeys(e).length, 0);
    await lookup(e, k3);
    assert.equal(optionalMails(mail).length, 0);
  });

  it("re-issuing a key keeps the consent and the sent history; deleting the key deletes the consent record and its address", async () => {
    const { e, mail } = setup();
    const k1 = await mint(e, mail, "reissue@example.com", true);
    await lookup(e, k1); // A1
    assert.equal(optionalMails(mail).length, 1);
    waitPassed(e);
    e.clock.t += DAY;
    const k2 = await mint(e, mail, "reissue@example.com", false);
    const [name] = lcKeys(e);
    const rec = JSON.parse(e.KEYS.data.get(name!)!) as { key_hash: string };
    const marks = JSON.parse(
      e.KEYS.data.get(name!.replace("lc:", "lcmark:"))!,
    ) as Record<string, string>;
    assert.ok(marks.A1, "history kept");
    assert.equal(rec.key_hash, await hashKey(k2), "points at the new key");
    await lookup(e, k2);
    assert.equal(
      optionalMails(mail).length,
      1,
      "A1 is not sent again for the new key",
    );
    const del = await handle(
      new Request("https://api.factlot.com/v1/keys/free", {
        method: "DELETE",
        headers: { authorization: `Bearer ${k2}`, "cf-connecting-ip": IP },
      }),
      e,
      innerApi().api,
      { now: () => e.clock.t },
    );
    assert.equal(del.status, 200);
    assert.equal(lcKeys(e).length, 0);
    assert.ok(
      ![...e.KEYS.data.values()].some((v) => v.includes("reissue@example.com")),
    );
  });

  it("turning the variable off stops everything already recorded", async () => {
    const { e, mail } = setup();
    const key = await mint(e, mail, "off@example.com", true);
    e.LIFECYCLE_EMAILS_ENABLED = undefined;
    await lookup(e, key);
    e.clock.t += 9 * DAY;
    assert.deepEqual((await lifecycleSweep(e, e.clock.t)).sent, {});
    assert.equal(optionalMails(mail).length, 0);
  });

  it("the sweep removes records whose key is gone", async () => {
    const { e, mail } = setup();
    await mint(e, mail, "swept@example.com", true);
    for (const k of [...e.KEYS.data.keys()])
      if (k.startsWith("freekey:")) e.KEYS.data.delete(k);
    e.clock.t += 3 * DAY;
    const r = await lifecycleSweep(e, e.clock.t);
    assert.equal(r.removed, 1);
    assert.equal(lcKeys(e).length, 0);
  });

  it("each optional message carries the postal address, a stop link and the one-click headers", async () => {
    const seen: Record<string, string>[] = [];
    const { e, mail } = setup();
    const send = e.EMAIL!.send.bind(e.EMAIL);
    e.EMAIL = {
      send: async (m) => {
        seen.push((m as { headers?: Record<string, string> }).headers ?? {});
        return send(m);
      },
    };
    const key = await mint(e, mail, "hdr@example.com", true);
    await lookup(e, key);
    const m = optionalMails(mail)[0]!;
    assert.ok(m.text.includes(ADDRESS));
    const h = seen.at(-1)!;
    assert.match(
      h["List-Unsubscribe"]!,
      /^<https:\/\/factlot\.com\/account\/stop\//,
    );
    assert.equal(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });

  it("no email address or key appears in any URL in any message, or in any log line", async () => {
    const { e, mail } = setup();
    let key = "";
    const logs = await captureLogs(async () => {
      key = await mint(e, mail, "private.person@example.com", true);
      await lookup(e, key);
      await open(
        e,
        "https://factlot.com/account/stop",
        "POST",
        "email=private.person%40example.com",
      );
      e.clock.t += 9 * DAY;
      await lifecycleSweep(e, e.clock.t);
    });
    for (const m of mail.sent) {
      for (const url of m.text.match(/https?:\/\/\S+/g) ?? []) {
        assert.doesNotMatch(
          url,
          /@|private|example\.com|fl_free_|fl_live_/i,
          url,
        );
      }
    }
    assert.doesNotMatch(
      logs,
      /private\.person|example\.com|fl_free_|fl_live_|account\/stop\/[0-9a-f]/,
    );
    assert.ok(key);
  });

  describe("the checkout return link", () => {
    const paid = {
      status: "complete",
      payment_status: "paid",
      mode: "subscription",
      subscription: "sub_1",
      customer: "cus_1",
      customer_details: { email: "buyer@example.com" },
      metadata: { factlot_plan: "pro" },
    };
    function stripe() {
      const created: URLSearchParams[] = [];
      return {
        created,
        ...fakeStripe({
          "GET /prices": () => [200, { data: [{ id: "price_1" }] }],
          "POST /checkout/sessions": (b) => {
            created.push(b);
            return [
              200,
              { id: "cs_live_x1", url: "https://checkout.stripe.com/c/x" },
            ];
          },
          [`GET /checkout/sessions/${SESSION}`]: () => [200, paid],
        }),
      };
    }
    const start = (e: E, qs: string, s: ReturnType<typeof stripe>) =>
      run(
        e,
        new Request(`https://factlot.com/billing/checkout?plan=pro${qs}`, {
          headers: { "cf-connecting-ip": IP },
        }),
        s.fetchImpl,
      );

    it("carries a sanitised address or parcel through Stripe's success URL, and the success page and welcome email link back", async () => {
      const s = stripe();
      const { e, mail } = setup({
        STRIPE_SECRET_KEY: "sk_live_x",
        PROPERTY_PAGES_ENABLED: "true",
      } as Partial<Env>);
      const res = await start(e, "&q=1000+Louisiana+St", s);
      assert.equal(res.status, 303);
      const success = s.created[0]!.get("success_url")!;
      assert.equal(
        success,
        "https://factlot.com/billing/success?session_id={CHECKOUT_SESSION_ID}&q=1000%20Louisiana%20St",
      );
      const page = await (
        await run(
          e,
          new Request(
            `https://factlot.com/billing/success?session_id=${SESSION}&q=1000+Louisiana+St`,
          ),
          s.fetchImpl,
        )
      ).text();
      assert.match(
        page,
        /href="https:\/\/factlot\.com\/try\/\?q=1000%20Louisiana%20St"/,
      );
      assert.match(page, /Back to your lookup/);
      assert.match(
        mail.sent[0]!.text,
        /Back to your lookup: https:\/\/factlot\.com\/try\/\?q=1000%20Louisiana%20St/,
      );
      // A parcel: the property page when those are on.
      const s2 = stripe();
      await start(e, `&urn=${encodeURIComponent(PARCEL)}`, s2);
      assert.match(
        s2.created[0]!.get("success_url")!,
        /&urn=fl%3Aparcel%3Aus%2D48201%3A0001$/,
      );
      e.KEYS.data.delete(`session:${SESSION}`);
      for (const k of [...e.KEYS.data.keys()])
        if (k.startsWith("key:") || k.startsWith("sub:")) e.KEYS.data.delete(k);
      const page2 = await (
        await run(
          e,
          new Request(
            `https://factlot.com/billing/success?session_id=${SESSION}&urn=${encodeURIComponent(PARCEL)}`,
          ),
          s.fetchImpl,
        )
      ).text();
      assert.match(
        page2,
        /href="https:\/\/factlot\.com\/property\/us-48201\/0001"/,
      );
    });

    it("sanitises and length-limits what it carries; an email address or key cannot ride along", async () => {
      const s = stripe();
      const { e } = setup({ STRIPE_SECRET_KEY: "sk_live_x" });
      await start(
        e,
        `&q=${encodeURIComponent("<script>alert(1)</script> bob@example.com fl_live_abc " + "x".repeat(500))}`,
        s,
      );
      const success = s.created[0]!.get("success_url")!;
      const q = decodeURIComponent(success.split("&q=")[1]!);
      assert.ok(q.length <= 120, `${q.length}`);
      assert.doesNotMatch(q, /[<>@_]/);
      assert.doesNotMatch(success, /@|%40|fl_live|fl_free/);
      // A parcel id that is not one is dropped; nothing left means no extra parameter.
      const s2 = stripe();
      await start(
        e,
        `&urn=${encodeURIComponent("javascript:alert(1)")}&q=%00%01`,
        s2,
      );
      assert.equal(
        s2.created[0]!.get("success_url"),
        "https://factlot.com/billing/success?session_id={CHECKOUT_SESSION_ID}",
      );
    });

    it("does nothing with the variable off", async () => {
      const s = stripe();
      const { e, mail } = setup({
        STRIPE_SECRET_KEY: "sk_live_x",
        LIFECYCLE_EMAILS_ENABLED: undefined,
      });
      await start(e, "&q=1000+Louisiana+St", s);
      assert.equal(
        s.created[0]!.get("success_url"),
        "https://factlot.com/billing/success?session_id={CHECKOUT_SESSION_ID}",
      );
      const page = await (
        await run(
          e,
          new Request(
            `https://factlot.com/billing/success?session_id=${SESSION}&q=1000+Louisiana+St`,
          ),
          s.fetchImpl,
        )
      ).text();
      assert.doesNotMatch(
        page,
        /Back to your lookup|try\/\?q=|lifecycle_emails/,
      );
      assert.doesNotMatch(mail.sent[0]!.text, /Back to your lookup/);
    });
  });

  describe("/try/?q=", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../../site/try/try.js", import.meta.url)),
      "utf8",
    );
    const heads: unknown[] = [];
    /** Run try.js in a stub page; the bodies of the fetches it makes. */
    function runTry(search: string): string[] {
      const bodies: string[] = [];
      heads.length = 0;
      const node = () => {
        const n: Record<string, unknown> = {
          children: [],
          value: "",
          textContent: "",
          disabled: false,
          firstChild: null,
          addEventListener() {},
          appendChild() {},
          setAttribute(k: string, v: string) {
            ((n.attrs ??= {}) as Record<string, string>)[k] = v;
          },
        };
        return n;
      };
      const ids: Record<string, ReturnType<typeof node>> = {};
      const sandbox = {
        document: {
          location: { search },
          head: { appendChild: (n: unknown) => heads.push(n) },
          getElementById: (id: string) => (ids[id] ??= node()),
          createElement: () => node(),
          createTextNode: () => node(),
          querySelectorAll: () => [],
        },
        fetch: (_u: string, init: { body: string }) => {
          bodies.push(init.body);
          return new Promise(() => {});
        },
        Array,
        JSON,
        String,
        Object,
        Promise,
        decodeURIComponent,
        setTimeout,
        clearTimeout,
      };
      vm.runInNewContext(src, sandbox);
      return bodies;
    }
    it("runs no lookup without the parameter, or with nothing left of it", () => {
      for (const s of [
        "",
        "?",
        "?x=1",
        "?q=",
        "?q=%3C%3E%40%40",
        "?Q=1000+Main",
        "?q=%E0%A4%A",
      ])
        assert.deepEqual(runTry(s), [], s);
    });
    it("runs the lookup on load with the cleaned text", () => {
      const bodies = runTry("?q=1000+Louisiana+St");
      assert.deepEqual(
        bodies.map((b) => JSON.parse(b)),
        [{ query: "1000 Louisiana St", limit: 5 }],
      );
    });
    it("sanitises: markup, an email address and a key lose their characters; length is limited", () => {
      const [a] = runTry(
        `?q=${encodeURIComponent("<img src=x onerror=1> a@b.com fl_free_" + "y".repeat(300))}`,
      );
      const q = (JSON.parse(a!) as { query: string }).query;
      assert.ok(q.length <= 120, `${q.length}`);
      assert.doesNotMatch(q, /[<>@_=]/);
    });
  });

  it("the legal text says what is sent, what is stored, how to stop, and keeps the no-marketing sentence conditional", () => {
    const read = (p: string) =>
      readFileSync(
        fileURLToPath(new URL(`../../../site/${p}`, import.meta.url)),
        "utf8",
      ).replace(/\s+/g, " ");
    const privacy = read("privacy.html");
    const terms = read("terms.html");
    assert.match(
      privacy,
      /We send no marketing email unless you tick the separate box for optional emails/,
    );
    assert.match(
      terms,
      /We send no marketing email unless you tick the separate box for optional emails/,
    );
    assert.ok(
      privacy.includes(
        `up to ${optionalMessages("free").length} optional notes about a free key`,
      ),
    );
    assert.ok(
      privacy.includes(`up to ${optionalMessages("paid").length} about a plan`),
    );
    assert.ok(privacy.includes("never more than one a day"));
    assert.ok(privacy.includes("factlot.com/account/stop"));
    assert.match(privacy, /we keep one marker: the hash of your address/);
    assert.match(
      privacy,
      /even if you later ask for a new key or tick the box again/,
    );
    assert.match(privacy, /Their legal basis is your consent/);
    assert.match(privacy, /Checkout return link/);
  });

  describe("review fixes", () => {
    const stopOf = (text: string) =>
      text.match(/https:\/\/factlot\.com\/account\/stop\/[0-9a-f.]+/)![0];
    const flaky = (
      e: E,
      rule: (m: { text: string; headers?: object }) => unknown,
    ) => {
      const send = e.EMAIL!.send.bind(e.EMAIL);
      const calls: { text: string; headers?: object }[] = [];
      e.EMAIL = {
        send: async (m) => {
          const c = m as unknown as { text: string; headers?: object };
          calls.push(c);
          const err = rule(c);
          if (err) throw err;
          return send(m);
        },
      };
      return calls;
    };
    const build = (_r: unknown, ctx: { stopUrl: string }) => ({
      subject: "x",
      text: `Stop these emails with one click ${ctx.stopUrl}`,
      html: "x",
    });
    const hashOf = (e: E) => lcKeys(e)[0]!.split(":")[2]!;

    it("S1: the legal text is true with the variable off and lists the new records", () => {
      const read = (p: string) =>
        readFileSync(
          fileURLToPath(new URL(`../../../site/${p}`, import.meta.url)),
          "utf8",
        ).replace(/\s+/g, " ");
      const privacy = read("privacy.html");
      assert.match(
        privacy,
        /When FactLot offers optional emails, the free key form/,
      );
      assert.match(privacy, /if you see no such box, they are not on offer/);
      assert.match(
        privacy,
        /factlot\.com\/account\/stop \(that page exists only then;/,
      );
      assert.match(privacy, /press the button on the page that the link/);
      for (const row of [
        "Optional-email consent records",
        "Optional-email stop markers",
        "Kept until you ask us to remove them",
        "Optional-email once-only and daily markers",
        "395 days; not deleted by a stop or a key deletion",
        "Free key lookup tally",
        "Up to 90 days",
        "Watch-list stop-link records",
        "at most 32 days after it falls due",
        "and at most 395 days",
      ])
        assert.ok(privacy.includes(row), row);
      assert.doesNotMatch(
        privacy,
        /\beach have a separate box, unticked, that says what is sent:/,
      );
    });

    it("S2: a send in flight during a stop does not put the record (and the address) back", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "race@example.com", true);
      const h = hashOf(e);
      flaky(e, (m) => {
        // The person presses stop while the send is under way (synchronously enough for KV).
        const stop = stopOf(m.text);
        void stop;
        e.KEYS.data.delete(`lc:free:${h}`);
        e.KEYS.data.set(`lcstop:${h}`, "2026-11-07T00:00:00.000Z");
        return undefined;
      });
      const r = await deliverPromo(e, "free", h, "A1", e.clock.t, build);
      assert.equal(r, "sent");
      assert.equal(lcKeys(e).length, 0, "record not restored");
      assert.ok(
        ![...e.KEYS.data.values()].some((v) => v.includes("race@example.com")),
      );
      // And in recordConsent: a stop that lands between the check and the write wins.
      const { e: e2, mail: mail2 } = setup();
      const put = e2.KEYS.put.bind(e2.KEYS);
      e2.KEYS.put = async (k, v, o) => {
        await put(k, v, o);
        if (k.startsWith("lc:free:"))
          e2.KEYS.data.set(`lcstop:${k.split(":")[2]}`, "t");
      };
      await mint(e2, mail2, "race2@example.com", true);
      assert.equal(lcKeys(e2).length, 0);
    });

    it("S3: a failed send is marked, never retried, and does not hold the day's slot or block other notes", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "fail@example.com", true);
      const h = hashOf(e);
      const calls = flaky(e, () =>
        Object.assign(new Error("x"), { code: "E_DELIVERY" }),
      );
      const t = e.clock.t;
      assert.equal(await deliverPromo(e, "free", h, "A1", t, build), "failed");
      assert.equal(
        calls.length,
        1,
        "no header-less retry for a non-header error",
      );
      const marks = JSON.parse(e.KEYS.data.get(`lcmark:free:${h}`)!) as Record<
        string,
        string
      >;
      assert.match(marks.A1!, /^failed:/);
      // Next day: A1 is no longer due and does not take the slot; A2 goes out.
      calls.length = 0;
      e.EMAIL = setup().e.EMAIL;
      const mail2 = fakeEmail();
      e.EMAIL = mail2.binding;
      assert.equal(
        await deliverPromo(e, "free", h, "A1", t + DAY, build),
        "already",
      );
      assert.equal(
        await deliverPromo(e, "free", h, "A2", t + DAY, build),
        "sent",
      );
      assert.equal(mail2.sent.length, 1);
      // A KV write that throws after the send is survived too.
      const put = e.KEYS.put.bind(e.KEYS);
      e.KEYS.put = async (k, v, o) => {
        if (k.startsWith("lcmark:")) throw new Error("kv down");
        return put(k, v, o);
      };
      assert.equal(
        await deliverPromo(e, "free", h, "A3", t + 2 * DAY, build),
        "sent",
      );
    });

    it("S4: the sweep reads only due items, in date order and in batches, survives a bad one and leaves nothing behind", async () => {
      const { e, mail } = setup();
      const emails = ["a", "b", "c", "d", "e"].map((x) => `${x}@example.com`);
      for (const [i, em] of emails.entries()) {
        const ip = `198.51.100.${i + 10}`;
        await ask(e, em, true, ip);
        const link = linkOf(mail.sent.at(-1)!.text)!;
        assert.equal((await open(e, link, "POST", "", ip)).status, 200);
      }
      const names = lcKeys(e);
      assert.equal(names.length, 5);
      // Two due items per record (A2 and A4), keyed by their due hour.
      const due = () => lcKeys(e, "lcdue");
      assert.equal(due().length, 10);
      for (const d of due())
        assert.match(d, /^lcdue:\d{10}:free:[0-9a-f]{64}:(A2|A4)$/);
      // One record whose meter read throws.
      const bad = JSON.parse(e.KEYS.data.get(names[1]!)!) as Record<
        string,
        unknown
      >;
      bad.subject = "boom";
      e.KEYS.data.set(names[1]!, JSON.stringify(bad));
      const usage = e.METER.usage.bind(e.METER);
      let usageCalls = 0;
      e.METER.usage = async (subject, days) => {
        usageCalls++;
        if (subject === "boom") throw new Error("do down");
        return usage(subject, days);
      };
      // Nothing is due yet: the run stops at the first item, reading nothing else.
      const early = await lifecycleSweep(e, e.clock.t, 10);
      assert.equal(early.checked, 0);
      assert.equal(early.complete, true);
      e.clock.t += 3 * DAY;
      const seen: number[] = [];
      let complete = false;
      let errors = 0;
      for (let run = 0; run < 10 && !complete; run++) {
        const r = await lifecycleSweep(e, e.clock.t, 2);
        seen.push(r.checked);
        errors += r.errors;
        complete = r.complete;
      }
      // Only the five A2 items were due; the A4 ones wait.
      assert.deepEqual(seen, [2, 2, 1]);
      assert.equal(errors, 1, "the bad record was counted, not fatal");
      const to = new Set(optionalMails(mail).map((m) => m.to));
      assert.equal(to.size, 4, "every other record was reached across runs");
      // Handled items are deleted; the bad one is put back for the next hour.
      assert.equal(due().length, 6);
      assert.equal(due().filter((d) => d.endsWith(":r1")).length, 1);
      // A record whose address was stopped is deleted when its item comes up.
      e.KEYS.data.set(`lcstop:${names[0]!.split(":")[2]}`, "t");
      // Past the time-based window: the remaining items go unsent, with no meter read.
      usageCalls = 0;
      e.clock.t += 40 * DAY;
      const old = await lifecycleSweep(e, e.clock.t, 10);
      assert.equal(old.checked, 6);
      assert.equal(old.removed, 1);
      assert.equal(usageCalls, 0);
      assert.ok(!e.KEYS.data.has(names[0]!));
      assert.equal(due().length, 0, "nothing left in the index");
      assert.ok(
        ![...e.KEYS.data.keys()].some((k) => k.startsWith("lcsweep:")),
        "no cursor",
      );
    });

    it("S5: the consent form of the page after checkout needs its proof: genuine, for that session, within the hour, from its own origin", async () => {
      const paid = {
        status: "complete",
        payment_status: "paid",
        mode: "subscription",
        subscription: "sub_5",
        customer: "cus_5",
        customer_details: { email: "p5@example.com" },
        metadata: { factlot_plan: "pro" },
      };
      const s = fakeStripe({
        [`GET /checkout/sessions/${SESSION}`]: () => [200, paid],
      });
      const { e } = setup({ STRIPE_SECRET_KEY: "sk_test_x" });
      const page = await (
        await run(
          e,
          new Request(
            `https://factlot.com/billing/success?session_id=${SESSION}`,
          ),
          s.fetchImpl,
        )
      ).text();
      const t = page.match(/name="t" value="(\d+)"/)![1]!;
      const proof = page.match(/name="proof" value="([0-9a-f]+)"/)![1]!;
      e.clock.t = Number(t) + 1000;
      const post = (body: string, origin = "https://factlot.com") =>
        run(
          e,
          new Request("https://factlot.com/account/lifecycle", {
            method: "POST",
            body,
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              origin,
              "cf-connecting-ip": IP,
            },
          }),
          s.fetchImpl,
        );
      const ok = `session_id=${SESSION}&lifecycle_emails=1`;
      assert.equal((await post(ok)).status, 400, "no proof");
      assert.equal(
        (await post(`${ok}&t=${t}&proof=${"0".repeat(64)}`)).status,
        400,
        "wrong proof",
      );
      assert.equal(
        (
          await post(
            `session_id=cs_live_otherSession1234&lifecycle_emails=1&t=${t}&proof=${proof}`,
          )
        ).status,
        400,
        "another session",
      );
      assert.equal(
        (await post(`${ok}&t=${Number(t) + 5000}&proof=${proof}`)).status,
        400,
        "changed time",
      );
      assert.equal(
        (await post(`${ok}&t=${t}&proof=${proof}`, "null")).status,
        403,
        "Origin null",
      );
      assert.equal(
        (await post(`${ok}&t=${t}&proof=${proof}`, "https://evil.example"))
          .status,
        403,
      );
      assert.equal(lcKeys(e).length, 0);
      e.clock.t = Number(t) + 61 * 60_000;
      assert.equal(
        (await post(`${ok}&t=${t}&proof=${proof}`)).status,
        400,
        "after the hour",
      );
      e.clock.t = Number(t) + 1000;
      assert.equal((await post(`${ok}&t=${t}&proof=${proof}`)).status, 200);
      assert.equal(lcKeys(e).length, 1);
    });

    it("S6: the stop and consent posts are rate limited per address and body capped, so a loop cannot write unbounded stop markers", async () => {
      const { e } = setup();
      e.RL_ANON = new CountingLimit(2);
      const stop = (email: string, ip = IP) =>
        run(
          e,
          new Request("https://factlot.com/account/stop", {
            method: "POST",
            body: `email=${encodeURIComponent(email)}`,
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              origin: "https://factlot.com",
              "cf-connecting-ip": ip,
            },
          }),
        );
      const codes: number[] = [];
      for (let i = 0; i < 6; i++)
        codes.push((await stop(`loop${i}@example.com`)).status);
      assert.deepEqual(codes, [200, 200, 429, 429, 429, 429]);
      // Addresses FactLot holds nothing for get no marker at all through the form.
      assert.equal(
        lcKeys(e, "lcstop").length,
        0,
        "no marker for an address with no consent, key or plan",
      );
      e.RL_ANON = new CountingLimit(100);
      assert.equal(
        (await stop("x".repeat(5000) + "@example.com", "198.51.100.77")).status,
        413,
      );
      const life = await run(
        e,
        new Request("https://factlot.com/account/lifecycle", {
          method: "POST",
          body: "a=".padEnd(6000, "b"),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://factlot.com",
            "cf-connecting-ip": IP,
          },
        }),
      );
      assert.equal(life.status, 413);
    });

    it("S8: a header Email Sending rejects does not lose the note: it is sent once more without custom headers", async () => {
      const { e, mail } = setup();
      const calls = flaky(e, (m) =>
        m.headers
          ? Object.assign(new Error("no"), { code: "E_HEADER_NOT_ALLOWED" })
          : undefined,
      );
      const key = await mint(e, mail, "hdr2@example.com", true);
      calls.length = 0;
      const logs = await captureLogs(async () => {
        await lookup(e, key);
      });
      assert.equal(optionalMails(mail).length, 1);
      assert.equal(calls.length, 2);
      assert.ok(calls[0]!.headers);
      assert.equal(calls[1]!.headers, undefined);
      assert.match(logs, /email headers rejected/);
      assert.doesNotMatch(logs, /hdr2@/);
    });

    it("F1: A1 says only what was cut, B1 claims nothing about the key, A4 and B2 are titled by what they are", () => {
      const ctx = {
        site: "https://factlot.com",
        api: "https://api.factlot.com",
        stopUrl: "https://factlot.com/account/stop/x",
        address: ADDRESS,
        audience: "free" as const,
      };
      const owner = withheldMessage(ctx, {
        portfolio: { count: 7, total: 10 },
      });
      assert.doesNotMatch(owner.text, /current roll year|earlier roll/);
      assert.match(
        owner.text,
        /3 of that owner's 10 parcels; 7 more were not shown/,
      );
      const years = withheldMessage(ctx, { years: [2024, 2023] });
      assert.match(years.text, /returned the current roll year/);
      assert.doesNotMatch(years.text, /owner's/);
      const both = withheldMessage(ctx, {
        years: [2024],
        portfolio: { count: 1, total: 4 },
      });
      assert.match(
        both.text,
        /current roll year[\s\S]*Another answer showed 3 of that owner's 4 parcels/,
      );
      const b1 = unusedPaidMessage({ ...ctx, audience: "paid" }, PLANS.pro);
      assert.doesNotMatch(b1.text, /reached your assistant|usually means/);
      assert.match(b1.text, /has not recorded a registry lookup from it yet/);
      const a4 = freeWeekMessage(ctx, { lookups: 3, tools: ["registry_get"] });
      const b2 = paidWeekMessage({ ...ctx, audience: "paid" }, PLANS.pro, {
        lookups: 3,
        tools: [],
      });
      for (const m of [a4, b2]) assert.doesNotMatch(m.subject, /first week/i);
      assert.match(a4.subject, /so far/);
      assert.match(b2.subject, /so far/);
      assert.doesNotMatch(a4.text, /Since you created/);
      assert.match(
        a4.text,
        /Your current free key has made 3 registry lookups/,
      );
    });

    it("F3: a free key without consent reaching its limit costs one consent read and nothing else", async () => {
      const { e, mail } = setup();
      const key = await mint(e, mail, "nocons@example.com", false);
      const plain = innerApi().api as typeof gatedApi;
      const ip = "198.51.100.31";
      for (let i = 0; i < 25; i++) await lookup(e, key, plain, ip);
      const gets: string[] = [];
      const get = e.KEYS.get.bind(e.KEYS);
      e.KEYS.get = async (k: string) => {
        gets.push(k);
        return get(k);
      };
      let claims = 0;
      const claim = e.METER.claim.bind(e.METER);
      e.METER.claim = async (n: string, v: string) => {
        claims++;
        return claim(n, v);
      };
      assert.equal((await lookup(e, key, plain, ip)).status, 429);
      assert.deepEqual(
        gets.filter((k) => k.startsWith("lc")).map((k) => k.slice(0, 8)),
        ["lc:free:"],
      );
      assert.equal(claims, 0);
    });

    it("F4: links in mail keep their trailing punctuation out of the anchor, and /try/ queries are kept out of search indexes", () => {
      const { html } = body([
        "See https://factlot.com/try/?q=O%27Brien'. Then (https://factlot.com/x).",
      ]);
      assert.match(
        html,
        /<a href="https:\/\/factlot\.com\/try\/\?q=O%27Brien">https:\/\/factlot\.com\/try\/\?q=O%27Brien<\/a>&#39;\./,
      );
      assert.match(
        html,
        /<a href="https:\/\/factlot\.com\/x">https:\/\/factlot\.com\/x<\/a>\)\./,
      );
      assert.equal(encodeQuery("1200 Main St."), "1200%20Main%20St%2E");
      assert.equal(encodeQuery("O'Brien-Way"), "O%27Brien%2DWay");
      const robots = readFileSync(
        fileURLToPath(new URL("../../../site/robots.txt", import.meta.url)),
        "utf8",
      );
      assert.match(robots, /^Disallow: \/try\/\?q=$/m);
    });

    it("F4: try.js adds a noindex robots tag only when it runs a lookup from a link", () => {
      const src = readFileSync(
        fileURLToPath(new URL("../../../site/try/try.js", import.meta.url)),
        "utf8",
      );
      assert.match(src, /setAttribute\("content", "noindex"\)/);
    });

    it("F2: the key email does not promise notes to an address that has stopped", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "stopped@example.com", true);
      await open(
        e,
        "https://factlot.com/account/stop",
        "POST",
        "email=stopped%40example.com",
      );
      waitPassed(e);
      const before = mail.sent.length;
      await ask(e, "stopped@example.com", true);
      const text = mail.sent[before]!.text;
      assert.doesNotMatch(text, /optional notes|start only once/);
      assert.match(text, /We will not add you to any mailing list/);
      for (const [k, v] of e.KEYS.data)
        if (k.startsWith("freelink:")) assert.doesNotMatch(v, /stopped@/);
    });
  });

  describe("second review", () => {
    const deleteFree = (e: E, key: string) =>
      handle(
        new Request("https://api.factlot.com/v1/keys/free", {
          method: "DELETE",
          headers: { authorization: `Bearer ${key}`, "cf-connecting-ip": IP },
        }),
        e,
        innerApi().api,
        { now: () => e.clock.t },
      );

    it("L1: consent writes its due items with an expiry; a plan's cancellation deletes its record, even with the variable off", async () => {
      const { e } = setup();
      const h = await addressHash(e, "buyer@example.com");
      assert.equal(
        await recordConsent(e, {
          kind: "paid",
          h,
          to: "buyer@example.com",
          subject: "sub:sub_9",
          subscription: "sub_9",
          plan: "pro",
          now: e.clock.t,
        }),
        "recorded",
      );
      const due = lcKeys(e, "lcdue");
      assert.equal(due.length, 2);
      for (const d of due) assert.ok((e.KEYS.ttl.get(d) ?? 0) > 30 * 86_400);
      assert.equal(e.KEYS.data.get("lcsub:sub_9"), h);
      e.LIFECYCLE_EMAILS_ENABLED = undefined;
      e.STRIPE_WEBHOOK_SECRET = "whsec_x";
      const res = await handleWebhook(
        e,
        await signed(
          {
            id: "evt_9",
            type: "customer.subscription.deleted",
            created: Math.floor(e.clock.t / 1000),
            data: { object: { id: "sub_9", status: "canceled" } },
          },
          "whsec_x",
          Math.floor(e.clock.t / 1000),
        ),
        () => e.clock.t,
      );
      assert.equal(res.status, 200);
      assert.deepEqual(
        [...e.KEYS.data.keys()].filter((k) => /^lc(:|due:|sub:|mark:)/.test(k)),
        [],
      );
      assert.ok(SWEEP_BATCH <= 40);
    });

    it("L1: a run touches only what is due, at most SWEEP_BATCH items", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "one@example.com", true);
      e.clock.t += 3 * DAY;
      const list = e.KEYS.list.bind(e.KEYS);
      let limit = 0;
      e.KEYS.list = async (o: { prefix?: string; limit?: number }) => {
        limit = o.limit ?? 0;
        assert.equal(o.prefix, "lcdue:");
        return list(o);
      };
      const r = await lifecycleSweep(e, e.clock.t, 500);
      assert.equal(limit, SWEEP_BATCH);
      assert.equal(r.checked, 1, "the A4 item is not due yet");
    });

    it("L2: deleting a free key removes its consent record with the variable off, in exactly two KV deletes", async () => {
      const { e, mail } = setup();
      const key = await mint(e, mail, "dark2@example.com", true);
      assert.equal(lcKeys(e).length, 1);
      e.LIFECYCLE_EMAILS_ENABLED = undefined;
      const del = e.KEYS.delete.bind(e.KEYS);
      const deleted: string[] = [];
      e.KEYS.delete = async (k: string) => {
        deleted.push(k);
        return del(k);
      };
      assert.equal((await deleteFree(e, key)).status, 200);
      assert.equal(lcKeys(e).length, 0);
      assert.equal(deleted.filter((k) => k.startsWith("lc")).length, 2);
    });

    it("L3: the consent text names both things a free answer can leave out", () => {
      assert.match(
        freeConsentText(),
        /earlier roll years or some of an owner's parcels/,
      );
    });

    it("L4: sent marks expire with the once-only claims", async () => {
      const { e, mail } = setup();
      const key = await mint(e, mail, "marks@example.com", true);
      await lookup(e, key);
      const [mark] = lcKeys(e, "lcmark");
      assert.ok(mark);
      assert.equal(e.KEYS.ttl.get(mark), MARK_TTL_DAYS * 86_400);
    });

    it("L5: a stop marker seen when consenting or sending deletes the consent record", async () => {
      const { e, mail } = setup();
      const key = await mint(e, mail, "race@example.com", true);
      const [name] = lcKeys(e);
      const h = name!.split(":")[2]!;
      e.KEYS.data.set(`lcstop:${h}`, "t");
      assert.equal(
        await deliverPromo(e, "free", h, "A1", e.clock.t, () => undefined),
        "suppressed",
      );
      assert.equal(lcKeys(e).length, 0);
      // A record written elsewhere a moment later is taken out by the next consent attempt.
      e.KEYS.data.set(
        name!,
        JSON.stringify({
          v: 1,
          kind: "free",
          to: "race@example.com",
          consent_at: "x",
          subject: "s",
          since: new Date(e.clock.t).toISOString(),
        }),
      );
      assert.equal(
        await recordConsent(e, {
          kind: "free",
          h,
          subject: "s",
          now: e.clock.t,
        }),
        "suppressed",
      );
      assert.equal(lcKeys(e).length, 0);
      assert.ok(key);
    });

    it("L7: the address form refuses a foreign origin, marks only addresses FactLot knows, within an hourly ceiling", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "known@example.com", false);
      const post = (email: string, origin = "https://factlot.com") =>
        run(
          e,
          new Request("https://factlot.com/account/stop", {
            method: "POST",
            body: `email=${encodeURIComponent(email)}`,
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              origin,
              "cf-connecting-ip": IP,
            },
          }),
        );
      assert.equal(
        (await post("known@example.com", "https://evil.example")).status,
        403,
      );
      assert.equal(lcKeys(e, "lcstop").length, 0);
      const a = await post("stranger@example.com");
      const b = await post("known@example.com");
      assert.equal(a.status, 200);
      assert.equal(
        await a.text().then((t) => t.replace(/nonce-[^']+|nonce="[^"]+"/g, "")),
        await b.text().then((t) => t.replace(/nonce-[^']+|nonce="[^"]+"/g, "")),
      );
      assert.equal(lcKeys(e, "lcstop").length, 1, "only the known address");
      // The hour's ceiling used up: a known address with no consent gets no new marker.
      await mint(e, mail, "known2@example.com", false);
      const hour = new Date(e.clock.t).toISOString().slice(0, 13);
      await e.METER.consume(`lcstopform:${hour}`, {
        kind: "day",
        limit: 100,
        n: 100,
      });
      await post("known2@example.com");
      assert.equal(lcKeys(e, "lcstop").length, 1);
    });
  });

  describe("third review", () => {
    const stopPost = (e: E, email: string, origin = "https://factlot.com") =>
      new Request("https://factlot.com/account/stop", {
        method: "POST",
        body: `email=${encodeURIComponent(email)}`,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
          "cf-connecting-ip": IP,
        },
      });

    it("1: the stop form answers before any lookup of the address, and the stop still happens", async () => {
      const { e, mail } = setup();
      await mint(e, mail, "timed@example.com", true);
      const get = e.KEYS.get.bind(e.KEYS);
      let open = () => {};
      const gate = new Promise<void>((r) => (open = r));
      let looked = false;
      e.KEYS.get = async (k: string) => {
        if (/^(lc:|lcstop:|freeemail:)/.test(k)) {
          looked = true;
          await gate;
        }
        return get(k);
      };
      const deferred: Promise<unknown>[] = [];
      const res = await handle(
        stopPost(e, "timed@example.com"),
        e,
        innerApi().api,
        {
          now: () => e.clock.t,
          waitUntil: (p) => deferred.push(p),
        },
      );
      assert.equal(res.status, 200);
      assert.equal(
        lcKeys(e, "lcstop").length,
        0,
        "nothing done before the answer",
      );
      assert.equal(deferred.length > 0, true);
      open();
      await Promise.all(deferred);
      assert.ok(looked);
      assert.equal(lcKeys(e, "lcstop").length, 1);
      assert.equal(lcKeys(e).length, 0);
    });

    it("5: the stop form refuses Origin null", async () => {
      const { e } = setup();
      assert.equal(
        (await run(e, stopPost(e, "x@example.com", "null"))).status,
        403,
      );
    });

    const consented = async (email: string) => {
      const { e, mail } = setup();
      await mint(e, mail, email, true);
      const [name] = lcKeys(e);
      return { e, mail, h: name!.split(":")[2]! };
    };
    const a2Sent = (mail: ReturnType<typeof fakeEmail>) =>
      optionalMails(mail).filter((m) =>
        /has not made a lookup yet/.test(m.text),
      ).length;

    it("2: when the day's slot is taken, A2 goes out the next UTC day", async () => {
      const { e, mail, h } = await consented("cap@example.com");
      e.clock.t += 2 * DAY + 2 * 3_600_000;
      // Another optional note takes today's slot first.
      assert.equal(
        await deliverPromo(e, "free", h, "A1", e.clock.t, (_r, ctx) => ({
          subject: "x",
          text: `x ${ctx.stopUrl}`,
          html: "x",
        })),
        "sent",
      );
      const r = await lifecycleSweep(e, e.clock.t);
      assert.equal(r.retried, 1);
      assert.equal(a2Sent(mail), 0);
      e.clock.t = (Math.floor(e.clock.t / DAY) + 1) * DAY + 3_600_000;
      await lifecycleSweep(e, e.clock.t);
      assert.equal(a2Sent(mail), 1);
    });

    it("2: a missing postal address or a thrown call does not lose the item", async () => {
      const { e, mail } = await consented("later@example.com");
      e.clock.t += 2 * DAY + 2 * 3_600_000;
      e.POSTAL_ADDRESS = undefined;
      await lifecycleSweep(e, e.clock.t);
      assert.equal(a2Sent(mail), 0);
      e.POSTAL_ADDRESS = ADDRESS;
      const usage = e.METER.usage.bind(e.METER);
      let fail = true;
      e.METER.usage = async (subject, days) => {
        if (fail) {
          fail = false;
          throw new Error("do down");
        }
        return usage(subject, days);
      };
      e.clock.t += 2 * 3_600_000;
      const thrown = await lifecycleSweep(e, e.clock.t);
      assert.equal(thrown.errors, 1);
      assert.equal(a2Sent(mail), 0);
      e.clock.t += 2 * 3_600_000;
      await lifecycleSweep(e, e.clock.t);
      assert.equal(a2Sent(mail), 1);
    });

    it("2: an item that keeps failing is put back a bounded number of times", async () => {
      const { e } = await consented("never@example.com");
      e.POSTAL_ADDRESS = undefined;
      e.clock.t += 2 * DAY + 2 * 3_600_000;
      let retried = 0;
      for (let i = 0; i < MAX_DUE_RETRIES + 5; i++) {
        retried += (await lifecycleSweep(e, e.clock.t)).retried ?? 0;
        e.clock.t += 2 * 3_600_000;
      }
      assert.equal(retried, MAX_DUE_RETRIES);
      assert.ok(
        !lcKeys(e, "lcdue").some(
          (d) => d.endsWith(":A2") || /:A2:r\d+$/.test(d),
        ),
      );
    });

    it("3: a paid record moved to another subscription drops the old pointer", async () => {
      const { e } = setup();
      const h = await addressHash(e, "mover@example.com");
      const consent = (subscription: string) =>
        recordConsent(e, {
          kind: "paid",
          h,
          to: "mover@example.com",
          subject: `sub:${subscription}`,
          subscription,
          plan: "pro",
          now: e.clock.t,
        });
      await consent("sub_a");
      assert.equal(await consent("sub_b"), "refreshed");
      assert.equal(e.KEYS.data.get("lcsub:sub_b"), h);
      assert.equal(e.KEYS.data.has("lcsub:sub_a"), false);
    });
  });
});
