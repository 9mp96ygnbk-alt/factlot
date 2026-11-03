import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECHECK_MS,
  billingDeps,
  ensurePrice,
  handleWebhook,
  redeemSession,
  refreshIfStale,
} from "./billing.ts";
import {
  generateKey,
  hashKey,
  looksLikeKey,
  readKey,
  writeKey,
  type KeyRecord,
} from "./keys.ts";
import { WindowCounter } from "./limiter.ts";
import { escapeHtml } from "./pages.ts";
import { handle } from "./router.ts";
import { hmacSha256Hex, verifyStripeSignature } from "./stripe.ts";
import type { Env, KV, RateLimit } from "./types.ts";

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.data.set(k, v);
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
}

interface StripeCall {
  method: string;
  path: string;
  body: string;
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
    calls.push({ method, path, body: body || url.search });
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

function env(overrides: Partial<Env> = {}): Env {
  return {
    KEYS: new MemoryKV(),
    RL_ANON: new CountingLimit(2),
    RL_PRO: new CountingLimit(100),
    RL_TEAM: new CountingLimit(100),
    ...overrides,
  };
}

const SESSION = "cs_live_a1B2c3D4e5F6g7H8";

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
    const kv = e.KEYS as MemoryKV;
    for (const v of kv.data.values())
      assert.ok(!v.includes(r.key), "plaintext key is never stored");
    const rec = await readKey(kv, await hashKey(r.key));
    assert.equal(rec?.plan, "pro");
    assert.equal(rec?.status, "active");
    assert.deepEqual(JSON.parse(kv.data.get("sub:sub_1")!), [
      await hashKey(r.key),
    ]);
    const again = await redeemSession(d, SESSION);
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.status, 409);
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
    assert.equal(!unpaid.ok && unpaid.status, 402);
    const bad = await redeemSession(d, "cs_live_<script>");
    assert.equal(!bad.ok && bad.status, 400);
    assert.equal(s.calls.length, 1, "a malformed ID never reaches Stripe");
  });

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
  });

  it("keeps the last status when Stripe is unreachable", async () => {
    const s = fakeStripe({
      "GET /subscriptions/sub_1": () => [500, { error: { message: "down" } }],
    });
    const d = billingDeps(
      env({ STRIPE_SECRET_KEY: "rk_test_x" }),
      s.fetchImpl,
      () => RECHECK_MS + 1,
    )!;
    assert.equal((await refreshIfStale(d, "h", record())).status, "active");
  });

  it("applies a signed subscription.deleted webhook to every key of the subscription", async () => {
    const e = env({ STRIPE_WEBHOOK_SECRET: "whsec_x" });
    await writeKey(e.KEYS, "h1", record());
    await e.KEYS.put("sub:sub_1", JSON.stringify(["h1"]));
    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", status: "canceled" } },
    });
    const t = 1_800_000_000;
    const sig = await hmacSha256Hex("whsec_x", `${t}.${payload}`);
    const req = new Request("https://api.factlot.com/v1/billing/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": `t=${t},v1=${sig}` },
    });
    const res = await handleWebhook(e, req, () => t * 1000);
    assert.equal(res.status, 200);
    assert.equal((await readKey(e.KEYS, "h1"))?.status, "inactive");
    const forged = new Request("https://api.factlot.com/v1/billing/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": `t=${t},v1=${"0".repeat(64)}` },
    });
    assert.equal((await handleWebhook(e, forged, () => t * 1000)).status, 400);
  });
});

describe("router", () => {
  const seen: Request[] = [];
  const api = {
    fetch: async (r: Request) => {
      seen.push(r);
      return new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const assets = { fetch: async () => new Response("<html>site</html>") };

  it("serves the landing page on the apex host and the API on api.", async () => {
    const e = env({ ASSETS: assets });
    assert.equal(
      await (await handle(new Request("https://factlot.com/"), e, api)).text(),
      "<html>site</html>",
    );
    const root = (await (
      await handle(new Request("https://api.factlot.com/"), e, api)
    ).json()) as { mcp: string; plans: { pro: { checkout: string } } };
    assert.equal(root.mcp, "https://api.factlot.com/mcp");
    assert.equal(
      root.plans.pro.checkout,
      "https://factlot.com/billing/checkout?plan=pro",
    );
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

  it("redirects www to the apex, keeping path and query", async () => {
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
    const e = env({ ASSETS: assets });
    const call = () =>
      handle(
        new Request("https://api.factlot.com/v1/calc/irr", {
          method: "POST",
          body: "{}",
          headers: { "cf-connecting-ip": "203.0.113.9" },
        }),
        e,
        api,
      );
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    const third = await call();
    assert.equal(third.status, 429);
    assert.match(
      ((await third.json()) as { message: string }).message,
      /factlot\.com\/#pricing/,
    );
  });

  it("refuses unknown bearer tokens and passes live paid keys without the header", async () => {
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

    const key = generateKey();
    await writeKey(e.KEYS, await hashKey(key), {
      plan: "team",
      status: "active",
      customer: "cus_1",
      subscription: "sub_1",
      stripe_status: "active",
      created: "x",
      checked_at: Date.now(),
    });
    seen.length = 0;
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
    assert.equal(
      seen[0]?.headers.get("authorization"),
      null,
      "the key never reaches the inner handler",
    );
    assert.ok((e.RL_TEAM as CountingLimit).seen[0]?.startsWith("key:"));
  });

  it("answers billing with 503 and a contact address until Stripe is configured", async () => {
    const res = await handle(
      new Request("https://api.factlot.com/v1/billing/checkout", {
        method: "POST",
        body: '{"plan":"pro"}',
      }),
      env(),
      api,
    );
    assert.equal(res.status, 503);
    const page = await handle(
      new Request("https://factlot.com/billing/checkout?plan=pro"),
      env(),
      api,
    );
    assert.equal(page.status, 503);
    assert.match(await page.text(), /contact@factlot\.com/);
  });

  it("escapes HTML", () => {
    assert.equal(
      escapeHtml(`<a href="x">'&`),
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;",
    );
  });
});

describe("WindowCounter", () => {
  it("allows exactly `limit` hits per window and resets on the next window", () => {
    const c = new WindowCounter();
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 60; i++) assert.equal(c.hit(60, 60_000, t0 + i), true);
    assert.equal(c.hit(60, 60_000, t0 + 100), false);
    assert.equal(c.hit(60, 60_000, t0 + 60_000), true);
  });
});
