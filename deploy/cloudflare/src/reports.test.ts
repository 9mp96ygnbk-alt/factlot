// Hosted reports: POST /v1/reports, report_create over MCP, downloads, quotas and expiry.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runTool } from "@factlot/tools";

import { generateKey, hashKey, writeKey, type KeyRecord } from "./keys.ts";
import {
  Meter,
  RateLimiterObject,
  addressSubject,
  objectMeter,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import { REPORTS_PER_MONTH } from "./plans.ts";
import { REPORT_TTL_SECONDS, runReport } from "./reports.ts";
import { handle } from "./router.ts";
import type { Env, KV, RateLimit } from "./types.ts";

/** Workers KV in memory: string or binary values, metadata and expiry. */
class MemoryKV implements KV {
  readonly data = new Map<
    string,
    { value: string | ArrayBuffer; metadata?: unknown; ttl?: number }
  >();
  async get(k: string) {
    const v = this.data.get(k)?.value;
    return typeof v === "string" ? v : null;
  }
  async put(
    k: string,
    value: string | ArrayBuffer,
    o?: { expirationTtl?: number; metadata?: unknown },
  ) {
    this.data.set(k, { value, metadata: o?.metadata, ttl: o?.expirationTtl });
  }
  async delete(k: string) {
    this.data.delete(k);
  }
  async getWithMetadata(k: string) {
    const e = this.data.get(k);
    return {
      value: e && typeof e.value !== "string" ? e.value : null,
      metadata: e?.metadata ?? null,
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
  readonly meta = new Map<string, string>();
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
  addUsage() {}
  readUsage() {
    return [];
  }
  pruneUsageBefore() {}
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
    return this.counts.size + this.claims.size + this.meta.size;
  }
  clearClaims() {
    this.claims.clear();
  }
  reset() {}
}

/** 2026-11-07 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const IP = "203.0.113.9";

function env(clock = { t: T0 }) {
  const objects = new Map<string, RateLimiterObject>();
  const ns: DurableObjectNamespaceLike = {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (input: string, init?: RequestInit) => {
        let o = objects.get(String(id));
        if (!o) {
          const store = new MemoryStore();
          o = new RateLimiterObject(
            {
              storage: {
                sql: {
                  exec() {
                    throw new Error("memory store in tests");
                  },
                },
                getAlarm: async () => null,
                setAlarm: async () => {},
                deleteAll: async () => {},
              },
            },
            {},
            { store, now: () => clock.t },
          );
          objects.set(String(id), o);
        }
        return o.fetch(new Request(input, init));
      },
    }),
  };
  const kv = new MemoryKV();
  const e = {
    KEYS: kv,

    REPORTS_ENABLED: "true",
    RL_ANON: new CountingLimit(100),
    RL_CLAIM: new CountingLimit(100),
    METER: objectMeter(ns),
  } as unknown as Env & { KEYS: MemoryKV; RL_ANON: CountingLimit };
  return { e, clock, kv };
}

/** The inner handler: tools/list answers one tool; other MCP calls answer {ok: true}. */
const inner = {
  seen: [] as string[],
  fetch: async (r: Request) => {
    const body = await r.text();
    inner.seen.push(body);
    const parsed = JSON.parse(body || "{}") as unknown;
    const items = (Array.isArray(parsed) ? parsed : [parsed]) as {
      id?: unknown;
      method?: string;
    }[];
    const answers = items
      .filter((m) => m.id !== undefined)
      .map((m) => ({
        jsonrpc: "2.0",
        id: m.id,
        result:
          m.method === "tools/list"
            ? { tools: [{ name: "calc_irr" }] }
            : { content: [{ type: "text", text: '{"ok":true}' }] },
      }));
    return new Response(
      JSON.stringify(Array.isArray(parsed) ? answers : answers[0]),
      {
        headers: { "content-type": "application/json" },
      },
    );
  },
};

function call(
  t: ReturnType<typeof env>,
  path: string,
  init: { body?: unknown; key?: string; ip?: string; method?: string } = {},
): Promise<Response> {
  const method = init.method ?? "POST";
  return handle(
    new Request(`https://api.factlot.com${path}`, {
      method,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : JSON.stringify(init.body ?? {}),
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": init.ip ?? IP,
        ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      },
    }),
    t.e,
    inner,
    { now: () => t.clock.t },
  );
}

async function issue(e: Env, plan: "pro" | "team" = "pro"): Promise<string> {
  const key = generateKey();
  const rec: KeyRecord = {
    plan,
    status: "active",
    customer: "cus_1",
    subscription: "sub_1",
    stripe_status: "active",
    created: "2026-11-03T00:00:00Z",
    checked_at: T0,
  };
  await writeKey(e.KEYS, await hashKey(key), rec, T0);
  return key;
}

const debtArgs = {
  noi: 2_205_000,
  value: 36_000_000,
  rate_annual: 0.0625,
  amortization_years: 30,
  max_ltv: 0.7,
  min_dscr: 1.25,
  min_debt_yield: 0.085,
  round_down_to: 1000,
};
const debtResult = (() => {
  const out = runTool("calc_debt_sizing", debtArgs);
  assert.ok(out.ok);
  return out.result;
})();
const request = (over: Record<string, unknown> = {}) => ({
  kind: "debt_sizing",
  format: "pdf",
  arguments: debtArgs,
  ...over,
});

const sha256 = async (b: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

type Created = {
  download_url: string;
  expires_at: string;
  bytes: number;
  sha256: string;
  filename: string;
  content_type: string;
  source: string;
  check: string;
  result_mismatch?: boolean;
  reports: { used: number; limit: number; remaining: number };
  content_base64?: string;
};

describe("reports counter", () => {
  it("counts reports apart from registry lookups in the same subject, by calendar month", () => {
    let now = T0;
    const store = new MemoryStore();
    const m = new Meter(
      () => store,
      () => now,
    );
    m.hit(null, { kind: "month", limit: 5000, n: 2 });
    const r = m.hit(null, {
      kind: "month",
      limit: 50,
      n: 1,
      counter: "reports",
    });
    assert.equal(r.granted, 1);
    assert.equal(m.quota("month", 50, "reports").used, 1);
    assert.equal(m.quota("month", 5000).used, 2);
    assert.ok(store.counts.has("reports:month:2026-11"));
    assert.equal(m.refund("month", 1, r.quota!.resets_at, "reports")?.used, 0);
    assert.equal(
      m.quota("month", 5000).used,
      2,
      "a report refund leaves lookups alone",
    );
    m.hit(null, { kind: "month", limit: 50, n: 1, counter: "reports" });
    now = Date.UTC(2026, 11, 1, 0, 0, 1);
    m.cleanup();
    assert.ok(
      !store.counts.has("reports:month:2026-11"),
      "the month's count goes when the month ends",
    );
    assert.equal(m.quota("month", 50, "reports").used, 0);
  });

  it("the free tier's address subject is stable for the month and rotates with it", async () => {
    const a = await addressSubject(IP, T0, "salt", "month");
    assert.match(a, /^ipm:[0-9a-f]{32}$/);
    assert.equal(await addressSubject(IP, T0 + 10 * DAY, "salt", "month"), a);
    assert.notEqual(
      await addressSubject(IP, Date.UTC(2026, 11, 2), "salt", "month"),
      a,
    );
    assert.notEqual(
      await addressSubject(IP, T0, "salt"),
      a,
      "not the daily lookup subject",
    );
  });
});

describe("POST /v1/reports and downloads", () => {
  it("builds, stores under the token's hash for 24 hours, and serves the file", async () => {
    const t = env();
    const res = await call(t, "/v1/reports", { body: request() });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Created;
    assert.match(
      body.download_url,
      /^https:\/\/api\.factlot\.com\/v1\/reports\/d\/[A-Za-z0-9_-]{43}$/,
    );
    assert.equal(
      body.expires_at,
      new Date(T0 + REPORT_TTL_SECONDS * 1000).toISOString(),
    );
    assert.equal(body.content_type, "application/pdf");
    assert.equal(body.source, "calc_debt_sizing@3");
    assert.equal(body.check, "computed");
    assert.equal(body.result_mismatch, undefined);
    assert.deepEqual(
      [body.reports.used, body.reports.limit, body.reports.remaining],
      [1, 3, 2],
    );
    assert.equal(res.headers.get("x-factlot-reports-quota-remaining"), "2");
    const token = body.download_url.split("/").pop()!;
    const [stored] = [...t.kv.data.entries()].filter(([k]) =>
      k.startsWith("report:"),
    );
    assert.ok(stored, "stored");
    assert.equal(
      stored[0],
      `report:${await hashKey(token)}`,
      "named by the token's hash",
    );
    assert.ok(
      ![...t.kv.data.keys()].some((k) => k.includes(token)),
      "the token itself is never a key",
    );
    assert.equal(stored[1].ttl, 86_400);

    const dl = await call(t, `/v1/reports/d/${token}`, { method: "GET" });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "application/pdf");
    assert.equal(dl.headers.get("cache-control"), "no-store");
    assert.match(
      dl.headers.get("content-disposition")!,
      /^attachment; filename="factlot-debt-sizing-2026-11-07\.pdf"/,
    );
    const bytes = await dl.arrayBuffer();
    assert.equal(bytes.byteLength, body.bytes);
    assert.equal(await sha256(bytes), body.sha256);
    assert.equal(dl.headers.get("x-factlot-report-sha256"), body.sha256);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    const head = await call(t, `/v1/reports/d/${token}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(body.bytes));
  });

  it("links expire after 24 hours; unknown and malformed tokens are 404", async () => {
    const t = env();
    const body = (await (
      await call(t, "/v1/reports", { body: request({ format: "xlsx" }) })
    ).json()) as Created;
    const path = new URL(body.download_url).pathname;
    t.clock.t = T0 + REPORT_TTL_SECONDS * 1000 - 1000;
    assert.equal((await call(t, path, { method: "GET" })).status, 200);
    t.clock.t = T0 + REPORT_TTL_SECONDS * 1000 + 1000;
    const gone = await call(t, path, { method: "GET" });
    assert.equal(gone.status, 404, "expired even while KV still holds it");
    assert.equal(((await gone.json()) as { code: string }).code, "NotFound");
    assert.equal(
      (await call(t, `/v1/reports/d/${"A".repeat(43)}`, { method: "GET" }))
        .status,
      404,
    );
    assert.equal(
      (await call(t, "/v1/reports/d/short", { method: "GET" })).status,
      404,
    );
    assert.equal((await call(t, path, { method: "DELETE" })).status, 405);
  });

  it("downloads are rate limited per token", async () => {
    const t = env();
    const body = (await (
      await call(t, "/v1/reports", { body: request() })
    ).json()) as Created;
    t.e.RL_ANON = new CountingLimit(2) as never;
    const path = new URL(body.download_url).pathname;
    assert.equal(
      (await call(t, path, { method: "GET", ip: "198.51.100.1" })).status,
      200,
    );
    assert.equal(
      (await call(t, path, { method: "GET", ip: "198.51.100.2" })).status,
      200,
    );
    const third = await call(t, path, { method: "GET", ip: "198.51.100.3" });
    assert.equal(
      third.status,
      429,
      "the token's budget is spent, whatever the address",
    );
    assert.equal(third.headers.get("retry-after"), "60");
  });

  it("free tier: 3 reports a month per address; input errors are free; the next month resets", async () => {
    const t = env();
    for (let i = 0; i < 3; i++) {
      const bad = await call(t, "/v1/reports", {
        body: request({ arguments: undefined, input: debtResult }),
      });
      assert.equal(bad.status, 400);
      assert.equal(
        ((await bad.json()) as { code: string }).code,
        "ArgumentsRequired",
      );
      assert.equal(
        (await call(t, "/v1/reports", { body: request() })).status,
        201,
      );
    }
    t.clock.t = T0 + 3 * DAY; // a new UTC day, same month
    const over = await call(t, "/v1/reports", { body: request() });
    assert.equal(over.status, 429);
    const err = (await over.json()) as {
      code: string;
      limit: number;
      resets_at: string;
      message: string;
    };
    assert.equal(err.code, "ReportQuotaExceeded");
    assert.equal(err.limit, REPORTS_PER_MONTH.anonymous);
    assert.equal(err.resets_at, "2026-12-01T00:00:00.000Z");
    assert.match(err.message, /3 a month per IP address/);
    assert.equal(over.headers.get("x-factlot-reports-quota-remaining"), "0");
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    assert.equal(
      (await call(t, "/v1/reports", { body: request(), ip: "198.51.100.7" }))
        .status,
      201,
      "another address",
    );
    t.clock.t = Date.UTC(2026, 11, 1, 0, 0, 5);
    assert.equal(
      (await call(t, "/v1/reports", { body: request() })).status,
      201,
      "a new month",
    );
  });

  it("with a key: the plan's monthly limit per subscription, separate from registry lookups", async () => {
    const t = env();
    const key = await issue(t.e, "pro");
    const res = await call(t, "/v1/reports", {
      key,
      body: request({ input: debtResult }),
    });
    assert.equal(res.status, 201);
    assert.equal(
      res.headers.get("x-factlot-reports-quota-limit"),
      String(REPORTS_PER_MONTH.pro),
    );
    assert.equal(res.headers.get("x-factlot-tier"), "pro");
    const made = (await res.json()) as Created;
    assert.equal(made.check, "computed");
    assert.equal(made.result_mismatch, false);
    assert.equal(
      (await t.e.METER.quota("sub:sub_1", "month", 50, "reports")).used,
      1,
    );
    assert.equal(
      (await t.e.METER.quota("sub:sub_1", "month", 5000)).used,
      0,
      "no lookup charged",
    );
    assert.equal(REPORTS_PER_MONTH.team, 1000);
  });

  it("inline: base64 of a file under 1 MiB; bad requests answer 400 with issues", async () => {
    const t = env();
    const body = (await (
      await call(t, "/v1/reports", { body: request({ inline: true }) })
    ).json()) as Created;
    const bytes = Uint8Array.from(atob(body.content_base64!), (c) =>
      c.charCodeAt(0),
    );
    assert.equal(await sha256(bytes.buffer), body.sha256);
    const bad = await call(t, "/v1/reports", {
      body: request({ format: "ics" }),
    });
    assert.equal(bad.status, 400);
    const err = (await bad.json()) as {
      code: string;
      issues: { path: string }[];
    };
    assert.equal(err.code, "InputError");
    assert.equal(err.issues[0]?.path, "format");
    assert.equal(
      (await call(t, "/v1/reports", { body: request({ inline: "yes" }) }))
        .status,
      400,
    );
    assert.equal((await call(t, "/v1/reports", { method: "GET" })).status, 405);
    const advice = await call(t, "/v1/reports", {
      body: request({ context: { title: "Refinance: we recommend it" } }),
    });
    assert.equal(advice.status, 422);
    const a = (await advice.json()) as {
      code: string;
      issues: { path: string }[];
      next: string;
    };
    assert.equal(a.code, "TextNotAllowed");
    assert.equal(a.issues[0]?.path, "context.title");
    assert.match(a.next, /remove the advice/);
  });

  it("a fault while building answers 500 ReportFailed with no detail, logs only the error's name, and gives the report back", async () => {
    const t = env();
    const subject = "ipm:fault-test";
    const logged: string[] = [];
    const error = console.error;
    console.error = (...a: unknown[]) =>
      void logged.push(a.map(String).join(" "));
    let out: Awaited<ReturnType<typeof runReport>>;
    try {
      out = await runReport(
        t.e,
        { tier: "anonymous", subject: async () => subject },
        request(),
        {
          apiBase: "https://api.factlot.com",
          // Read once the report is charged, to build it: a stand-in for a fault in the engine.
          now: () => {
            throw new RangeError("secret internal detail");
          },
        },
      );
    } finally {
      console.error = error;
    }
    assert.equal(out.ok, false);
    assert.ok(!out.ok);
    assert.equal(out.status, 500);
    assert.equal(out.body.code, "ReportFailed");
    assert.ok(!JSON.stringify(out.body).includes("secret"), "no detail");
    assert.deepEqual(logged, [
      JSON.stringify({ msg: "reports: build failed", error: "RangeError" }),
    ]);
    assert.equal(
      (await t.e.METER.quota(subject, "month", 3, "reports")).used,
      0,
      "given back",
    );
    // An input error before the charge is free and never logged as a fault.
    const bad = await runReport(
      t.e,
      { tier: "anonymous", subject: async () => subject },
      request({ format: "ics" }),
      { apiBase: "https://api.factlot.com", now: () => T0 },
    );
    assert.ok(!bad.ok && bad.status === 400);
  });

  it("/v1/plans states the report limits", async () => {
    const t = env();
    const plans = (await (
      await call(t, "/v1/plans", { method: "GET" })
    ).json()) as {
      reports: { per_month: Record<string, number> };
    };
    assert.deepEqual(plans.reports.per_month, { free: 3, pro: 50, team: 1000 });
  });
});

describe("MCP report_create", () => {
  const rpc = (id: number, name: string, args: unknown) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });

  it("is listed for every caller and answered here", async () => {
    const t = env();
    const list = (await (
      await call(t, "/mcp", {
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      })
    ).json()) as {
      result: {
        tools: {
          name: string;
          inputSchema?: { properties: Record<string, unknown> };
        }[];
      };
    };
    const tool = list.result.tools.find((x) => x.name === "report_create");
    assert.ok(tool, "listed without a key");
    for (const p of [
      "kind",
      "format",
      "input",
      "arguments",
      "context",
      "inline",
    ])
      assert.ok(p in tool.inputSchema!.properties, p);

    const before = inner.seen.length;
    const ans = (await (
      await call(t, "/mcp", {
        body: rpc(7, "report_create", { ...request(), inline: true }),
      })
    ).json()) as {
      id: number;
      result: {
        structuredContent: Created;
        content: {
          type: string;
          resource?: { blob: string; mimeType: string; uri: string };
        }[];
      };
    };
    assert.equal(inner.seen.length, before, "the inner handler never sees it");
    assert.equal(ans.id, 7);
    assert.match(
      ans.result.structuredContent.download_url,
      /\/v1\/reports\/d\//,
    );
    const res = ans.result.content.find(
      (c) => c.type === "resource",
    )!.resource!;
    assert.equal(res.mimeType, "application/pdf");
    assert.equal(res.uri, ans.result.structuredContent.download_url);
    const bytes = Uint8Array.from(atob(res.blob), (c) => c.charCodeAt(0));
    assert.equal(
      await sha256(bytes.buffer),
      ans.result.structuredContent.sha256,
    );
  });

  it("one report per request: a batch's second report_create is a tool error, not run and not charged", async () => {
    const t = env();
    const answers = (await (
      await call(t, "/mcp", {
        body: [
          rpc(1, "report_create", request()),
          rpc(2, "calc_irr", { cash_flows: [-1, 2] }),
          rpc(3, "report_create", request({ format: "xlsx" })),
          rpc(4, "report_create", request()),
        ],
      })
    ).json()) as {
      id: number;
      result: { isError?: boolean; content: { text: string }[] };
    }[];
    const by = (id: number) => answers.find((a) => a.id === id)!;
    assert.ok(!by(1).result.isError, "the first is built");
    assert.ok(!by(2).result.isError, "other tools still answer");
    for (const id of [3, 4]) {
      assert.equal(by(id).result.isError, true);
      assert.equal(
        (JSON.parse(by(id).result.content[0]!.text) as { code: string }).code,
        "OneReportPerRequest",
      );
    }
    const subject = await addressSubject(IP, T0, undefined, "month");
    assert.equal(
      (await t.e.METER.quota(subject, "month", 3, "reports")).used,
      1,
      "only one charged",
    );
    // The next request may build one again.
    const next = (await (
      await call(t, "/mcp", { body: rpc(5, "report_create", request()) })
    ).json()) as { result: { isError?: boolean } };
    assert.ok(!next.result.isError);
  });

  it("errors are tool errors, never charged; a batch mixes it with other tools; the quota applies", async () => {
    const t = env();
    const bad = (await (
      await call(t, "/mcp", {
        body: rpc(1, "report_create", request({ arguments: { noi: -1 } })),
      })
    ).json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(bad.result.isError, true);
    assert.equal(
      (JSON.parse(bad.result.content[0]!.text) as { code: string }).code,
      "ArgumentsError",
    );
    const mixed = (await (
      await call(t, "/mcp", {
        body: [
          rpc(1, "calc_irr", { cash_flows: [-1, 2] }),
          rpc(2, "report_create", request()),
        ],
      })
    ).json()) as { id: number; result: { isError?: boolean } }[];
    assert.deepEqual(mixed.map((m) => m.id).sort(), [1, 2]);
    assert.ok(!mixed.find((m) => m.id === 2)!.result.isError);
    await call(t, "/mcp", { body: rpc(3, "report_create", request()) });
    await call(t, "/mcp", { body: rpc(4, "report_create", request()) });
    const over = (await (
      await call(t, "/mcp", { body: rpc(5, "report_create", request()) })
    ).json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(over.result.isError, true);
    assert.equal(
      (JSON.parse(over.result.content[0]!.text) as { code: string }).code,
      "ReportQuotaExceeded",
    );
  });
});

describe("reports kill switch", () => {
  it("without REPORTS_ENABLED the route answers 503, plans say unavailable, downloads still serve", async () => {
    const t = env();
    (t.e as { REPORTS_ENABLED?: string }).REPORTS_ENABLED = undefined;
    const res = await call(t, "/v1/reports", { body: request() });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code: string; next: string };
    assert.equal(body.code, "ReportsUnavailable");
    assert.ok(body.next);
    const plans = (await (
      await call(t, "/v1/plans", { method: "GET" })
    ).json()) as {
      reports: { available: boolean };
    };
    assert.equal(plans.reports.available, false);
    const dl = await call(t, "/v1/reports/d/0123456789abcdef0123456789abcdef", {
      method: "GET",
    });
    assert.equal(dl.status, 404);
  });
});
