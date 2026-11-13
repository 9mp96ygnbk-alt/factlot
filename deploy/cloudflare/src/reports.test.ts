// Hosted reports: POST /v1/reports, report_create over MCP, downloads, quotas and expiry.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENTITY_NOT_PRINTED,
  SHEET_CONTACT,
  SHEET_PRICING_URL,
  unzip,
} from "@factlot/reports";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import { inflateSync } from "node:zlib";
import { runTool } from "@factlot/tools";

import { CONTACT } from "./contact.ts";
import {
  generateKey,
  hashKey,
  keyId,
  writeKey,
  type KeyRecord,
} from "./keys.ts";
import {
  Meter,
  RateLimiterObject,
  addressSubject,
  objectMeter,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import {
  FREE_KEY_NOTE,
  GATING_PRICING_URL,
  REPORTS_PER_MONTH,
} from "./plans.ts";
import { renderPropertyPage } from "./property-pages.ts";
import { lookupForSheet, type SheetLookupOutcome } from "./property-sheet.ts";
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

  it("every answer says whether it was billed; a refused request carries the quota headers", async () => {
    const t = env();
    const ok = await call(t, "/v1/reports", { body: request() });
    assert.equal(ok.status, 201);
    assert.equal(((await ok.json()) as { billed: boolean }).billed, true);
    const bad = await call(t, "/v1/reports", {
      body: request({ format: "ics" }),
    });
    assert.equal(bad.status, 400);
    const err = (await bad.json()) as { billed: boolean; next: string };
    assert.equal(err.billed, false);
    assert.match(err.next, /"xlsx", "pdf"/);
    assert.equal(bad.headers.get("x-factlot-reports-quota-remaining"), "2");
    assert.equal(bad.headers.get("x-factlot-reports-quota-limit"), "3");
    const args = await call(t, "/v1/reports", {
      body: request({ arguments: 7 }),
    });
    const ae = (await args.json()) as {
      code: string;
      billed: boolean;
      issues: { path: string }[];
    };
    assert.equal(ae.code, "ArgumentsError");
    assert.equal(ae.billed, false);
    assert.equal(ae.issues[0]?.path, "arguments");
  });

  it("tx_protest_deadline: an ICS from the rule, billed as one report; bad arguments answer 400 free", async () => {
    const t = env();
    const ok = await call(t, "/v1/reports", {
      body: {
        kind: "tx_protest_deadline",
        format: "ics",
        arguments: {
          items: [
            { id: "HCAD 0412340010025", tax_year: 2027 },
            { id: "TAD 41234567", tax_year: 2026 },
          ],
        },
        inline: true,
      },
    });
    assert.equal(ok.status, 201);
    const body = (await ok.json()) as Created & { billed: boolean };
    assert.equal(body.billed, true);
    assert.equal(body.content_type, "text/calendar; charset=utf-8");
    assert.equal(body.source, "rules_tx_property_tax_protest_deadline_batch@1");
    assert.deepEqual([body.reports.used, body.reports.remaining], [1, 2]);
    const ics = new TextDecoder().decode(
      Uint8Array.from(atob(body.content_base64!), (c) => c.charCodeAt(0)),
    );
    // Status measured from the Worker's clock (2026-11-07), not the machine's.
    assert.match(ics.replace(/\r\n /g, ""), /Status as of 2026-11-07/);
    assert.match(
      ics,
      /SUMMARY:Texas protest filing deadline\\, tax year 2027 \(TAD 41234567\)/,
    );
    const bad = await call(t, "/v1/reports", {
      body: {
        kind: "tx_protest_deadline",
        format: "ics",
        arguments: { items: [{ id: "A", tax_year: 1999 }] },
      },
    });
    assert.equal(bad.status, 400);
    const err = (await bad.json()) as {
      code: string;
      billed: boolean;
      issues: { path: string }[];
      next: string;
    };
    assert.equal(err.code, "ArgumentsError");
    assert.equal(err.billed, false);
    assert.equal(err.issues[0]?.path, "arguments.items.0.tax_year");
    assert.match(err.next, /rules_tx_property_tax_protest_deadline_batch/);
    assert.equal(bad.headers.get("x-factlot-reports-quota-remaining"), "2");
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
    const kinds = (tool.inputSchema!.properties.kind as { enum: string[] })
      .enum;
    assert.ok(kinds.includes("tx_protest_deadline"));

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

describe("free-key reports count against the address's month too", () => {
  /** A free key as freekey.ts stores it, for the (hashed) address `who`. */
  async function freeKey(e: Env, who: string): Promise<string> {
    const key = `fl_free_${(await hashKey(who))
      .replace(/[^A-Za-z0-9]/g, "A")
      .padEnd(43, "A")
      .slice(0, 43)}`;
    await e.KEYS.put(
      `freekey:${await hashKey(key)}`,
      JSON.stringify({
        tier: "free",
        email_hash: await hashKey(`audit-address-${who}`),
        created: new Date(T0).toISOString(),
      }),
    );
    return key;
  }
  const make = async (
    t: ReturnType<typeof env>,
    key: string | undefined,
    ip = IP,
  ) => {
    const res = await call(t, "/v1/reports", {
      body: request(),
      ...(key ? { key } : {}),
      ip,
    });
    await res.body?.cancel();
    return res.status;
  };

  it("gating audit F2: five free keys used from one address together get the keyless month (3 reports), not 15", async () => {
    const t = env();
    (t.e as { FREE_KEY_ENABLED?: string }).FREE_KEY_ENABLED = "true";
    let made = 0;
    for (let k = 0; k < 5; k++) {
      const key = await freeKey(t.e, `k${k}`);
      for (let i = 0; i < 3; i++) if ((await make(t, key)) === 201) made++;
    }
    assert.equal(made, 3);
  });

  it("FREE_KEY_NOTE says what the meters do: a free key's reports count per email address and against the keyless month of its IP address", async () => {
    const n = REPORTS_PER_MONTH.anonymous;
    assert.ok(FREE_KEY_NOTE.includes(`${n} a month per email address`));
    assert.ok(
      FREE_KEY_NOTE.includes(
        `the same ${n} a month per IP address that calls without a key share`,
      ),
    );
    // Per IP address: keyless reports use up the month a free key from that address draws on.
    const t = env();
    const key = await freeKey(t.e, "note");
    for (let i = 0; i < n; i++) assert.equal(await make(t, undefined), 201);
    assert.equal(await make(t, key), 429, "the free key shares the IP month");
    // Per email address: the key's own month follows it to another IP address.
    const u = env();
    const k2 = await freeKey(u.e, "note2");
    for (let i = 0; i < n; i++)
      assert.equal(await make(u, k2, `203.0.113.${100 + i}`), 201);
    assert.equal(await make(u, k2, "203.0.113.200"), 429, "per email address");
  });

  it("keyless and free-key reports from one address share the one month", async () => {
    const t = env();
    const key = await freeKey(t.e, "a");
    assert.equal(await make(t, undefined), 201);
    assert.equal(await make(t, undefined), 201);
    assert.equal(await make(t, key), 201, "the third is the last");
    const over = await call(t, "/v1/reports", { body: request(), key });
    assert.equal(over.status, 429);
    const body = (await over.json()) as { message: string };
    assert.match(body.message, /keyless and free-key reports together/);
    assert.equal(await make(t, undefined), 429, "keyless is used up too");
  });

  it("a new key for the same address (plus-addressing, delete and reissue) starts no new month", async () => {
    const t = env();
    const first = await freeKey(t.e, "one");
    for (let i = 0; i < 3; i++) assert.equal(await make(t, first), 201);
    assert.equal(await make(t, first), 429);
    // Another address hash (a plus-addressed email) or a reissued key, from the same address.
    const second = await freeKey(t.e, "one+tag");
    assert.equal(await make(t, second), 429);
  });

  it("a different address is unaffected, and so is a different month", async () => {
    const t = env();
    const key = await freeKey(t.e, "x");
    for (let i = 0; i < 3; i++) assert.equal(await make(t, key), 201);
    assert.equal(await make(t, key), 429);
    const other = await freeKey(t.e, "y");
    assert.equal(await make(t, other, "203.0.113.77"), 201);
    t.clock.t += 40 * DAY;
    assert.equal(await make(t, key), 201, "the next month counts afresh");
  });

  it("a refused request charges neither meter, and the per-email count is kept", async () => {
    const t = env();
    const key = await freeKey(t.e, "p");
    const bad = await call(t, "/v1/reports", {
      body: request({ arguments: { noi: -1 } }),
      key,
    });
    assert.equal(bad.status, 400);
    await bad.body?.cancel();
    const subject = await addressSubject(IP, T0, undefined, "month");
    assert.equal(
      (await t.e.METER.quota(subject, "month", 3, "reports")).used,
      0,
    );
    // The address meter fills up from another key; this key's own month is still counted per email.
    for (let i = 0; i < 3; i++) assert.equal(await make(t, key), 201);
    const emailSubject = `freemail:${(await hashKey("audit-address-p")).slice(0, 32)}`;
    assert.equal(
      (await t.e.METER.quota(emailSubject, "month", 3, "reports")).used,
      3,
    );
    assert.equal(
      (await t.e.METER.quota(subject, "month", 3, "reports")).used,
      3,
    );
  });
});

describe("property_sheet: registry_get as the caller's own call", () => {
  const URN = "fl:parcel:us-48201:0010010000001";
  const ENTITY = "fl:entity:us-tx:32001234567";
  /** Earlier roll years' values: a free caller's sheet must never carry them. */
  const EARLIER = [7_777_777, 7_676_767, 6_666_666, 6_565_656];
  const fact = (
    id: string,
    predicate: string,
    value: unknown,
    subject = URN,
    doc = "fld_harris2026",
    rights: Record<string, string> = {
      license: "Public record; no licence stated by the publisher",
    },
  ) => ({
    id,
    subject,
    predicate,
    value,
    as_of: "2026-07-25",
    provenance: {
      method: "extracted",
      sources: [
        {
          document_id: doc,
          title: "Harris Central Appraisal District: Real property roll 2026",
          uri: "https://hcad.org/pdata/",
        },
      ],
    },
    rights,
  });
  const record = (owner = "LOUISIANA TOWER HOLDINGS LLC") => ({
    urn: URN,
    kind: "parcel",
    label: "1000 LOUISIANA ST HOUSTON TX 77002",
    status: "current",
    facts: [
      fact("f1", "parcel.situs_address", "1000 LOUISIANA ST HOUSTON TX 77002"),
      fact("f2", "parcel.apn", "0010010000001"),
      fact("f3", "parcel.year_built", 1983),
      fact("f4", "ownership.owner_of_record", owner),
    ],
    relationships: [
      {
        from_urn: ENTITY,
        type: "owns",
        to_urn: URN,
        method: "inferred",
        confidence: 0.9,
        document_id: "fld_harris2026",
      },
    ],
    crosswalk: [],
    building: null,
    value_history: [
      {
        tax_year: 2026,
        market_value: 10_101_010,
        appraised_value: 10_202_020,
        as_of: "2026-07-25",
        citations: {
          market_value: {
            fact_id: "f9",
            document_id: "fld_harris2026",
            as_of: "2026-07-25",
          },
        },
      },
      {
        tax_year: 2025,
        market_value: EARLIER[0],
        appraised_value: EARLIER[1],
        as_of: "2025-07-25",
        citations: {},
      },
      {
        tax_year: 2024,
        market_value: EARLIER[2],
        appraised_value: EARLIER[3],
        as_of: "2024-07-25",
        citations: {},
      },
    ],
    warnings: [],
  });
  /** The entity, its facts cited to the Comptroller's file with the recorded redistribution. */
  const entityOf = (redistribution: string) => {
    const e = (id: string, p: string, v: string) =>
      fact(id, p, v, ENTITY, "fld_txsos", {
        license: "Public record",
        redistribution,
        ai_use: "unknown",
      });
    return {
      urn: ENTITY,
      kind: "entity",
      facts: [
        e("e1", "entity.legal_name", "LOUISIANA TOWER HOLDINGS LLC"),
        e("e2", "entity.status", "Active"),
        e("e3", "entity.registry_number", "32001234567"),
        e("e4", "entity.mailing_address", "PO BOX 4 HOUSTON TX"),
      ],
    };
  };

  /** The inner handler: registry_get answers `answer` (a record, or a tool error with isError). */
  function registryApi(answer: unknown, isError = false, raw?: string) {
    const calls: { name: string; arguments: Record<string, unknown> }[] = [];
    const api = {
      fetch: async (r: Request) => {
        const body = JSON.parse((await r.text()) || "{}") as {
          id: number;
          params?: { name: string; arguments: Record<string, unknown> };
        };
        if (body.params) calls.push(body.params);
        if (raw !== undefined)
          return new Response(raw, {
            headers: { "content-type": "application/json" },
          });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(answer) }],
              ...(isError ? { isError: true } : { structuredContent: answer }),
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    };
    return { api, calls };
  }
  /** The registry service binding: the entity record, unmetered (as the property pages read it). */
  function registryBinding(redistribution: string) {
    const seen: unknown[] = [];
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        headers: { "content-type": "application/json" },
      });
    return {
      seen,
      fetch: async (r: Request) => {
        const b = (await r.json()) as {
          tool?: string;
          input?: { urn: string };
          refs?: unknown[];
        };
        seen.push(b);
        // The pages' source lookup: the Comptroller file's source id.
        if (new URL(r.url).pathname === "/pages/sources")
          return json({ sources: { fld_txsos: "tx-comptroller-entities" } });
        return json(
          b.input?.urn === ENTITY
            ? { ok: true, result: entityOf(redistribution) }
            : { ok: false, error: { error: "NotFound", message: "no" } },
        );
      },
    };
  }
  function setup(
    answer: unknown = record(),
    isError = false,
    o: {
      raw?: string;
      redistribution?: string;
      env?: Record<string, string>;
    } = {},
  ) {
    const t = env();
    const binding = registryBinding(o.redistribution ?? "permitted");
    Object.assign(t.e, {
      GATING_ENABLED: "true",
      REGISTRY: binding,
      ...(o.env ?? {}),
    });
    const { api, calls } = registryApi(answer, isError, o.raw);
    const send = (
      path: string,
      init: {
        body?: unknown;
        key?: string;
        method?: string;
        host?: string;
      } = {},
    ) =>
      handle(
        new Request(`https://${init.host ?? "api.factlot.com"}${path}`, {
          method: init.method ?? "POST",
          body:
            init.method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": IP,
            ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
          },
        }),
        t.e,
        api,
        { now: () => t.clock.t },
      );
    return { t, calls, binding, send };
  }
  const sheet = (format = "xlsx") => ({
    kind: "property_sheet",
    format,
    arguments: { urn: URN },
  });
  async function fileText(
    send: ReturnType<typeof setup>["send"],
    created: Created,
  ): Promise<string> {
    const dl = await send(new URL(created.download_url).pathname, {
      method: "GET",
    });
    assert.equal(dl.status, 200);
    const files = await unzip(new Uint8Array(await dl.arrayBuffer()));
    return [...files.values()]
      .map((d) => new TextDecoder().decode(d))
      .join("\n");
  }
  const lookupsUsed = async (t: ReturnType<typeof env>) =>
    (await t.e.METER.quota(await addressSubject(IP, T0, undefined), "day", 25))
      .used;

  it("free: one lookup and one report; the sheet has the current roll year only and names the earlier ones", async () => {
    const { t, calls, send } = setup();
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as Created & { billed: boolean };
    assert.equal(body.billed, true);
    assert.equal(body.source, "registry_get");
    assert.equal(body.reports.used, 1);
    assert.deepEqual(calls, [
      { name: "registry_get", arguments: { urn: URN } },
    ]);
    assert.equal(await lookupsUsed(t), 1, "costs what a registry_get costs");
    const x = await fileText(send, body);
    for (const v of EARLIER) assert.ok(!x.includes(String(v)), `leaks ${v}`);
    assert.ok(x.includes("10101010"));
    assert.ok(
      x.includes(
        "2 earlier roll years, 2024 and 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
      ),
    );
    assert.equal(SHEET_PRICING_URL, GATING_PRICING_URL);
    assert.ok(x.includes("LOUISIANA TOWER HOLDINGS LLC"));
    assert.ok(x.includes("Active") && x.includes("32001234567"));
    assert.ok(
      !x.includes("PO BOX"),
      "only the entity's name, status and number",
    );
  });

  it("the record the sheet is built from is the gated answer (the router's free cut, not only the sheet's)", async () => {
    const { send } = setup();
    const got = await lookupForSheet(URN, {
      plan: "free",
      callMcp: (body) => send("/mcp", { body: JSON.parse(body) as unknown }),
    });
    assert.ok(got.ok);
    const rec = got.lookup.record as {
      value_history: unknown[];
      history_withheld: { tax_years: number[] };
    };
    assert.equal(rec.value_history.length, 1);
    assert.deepEqual(rec.history_withheld.tax_years, [2025, 2024]);
    for (const v of EARLIER)
      assert.ok(!JSON.stringify(rec).includes(String(v)), `leaks ${v}`);
  });

  it("Pro: every roll year, history asked for, one lookup of the month", async () => {
    const { t, calls, send } = setup();
    const key = await issue(t.e);
    const res = await send("/v1/reports", { body: sheet(), key });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Created;
    assert.deepEqual(calls, [
      {
        name: "registry_get",
        arguments: { urn: URN, include_history: true },
      },
    ]);
    const x = await fileText(send, body);
    for (const v of EARLIER) assert.ok(x.includes(String(v)), `has ${v}`);
    assert.equal(body.reports.limit, REPORTS_PER_MONTH.pro);
  });

  it("over MCP too, with the same gating", async () => {
    const { t, calls, send } = setup();
    const ans = (await (
      await send("/mcp", {
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "report_create", arguments: sheet() },
        },
      })
    ).json()) as { result: { structuredContent: Created } };
    assert.equal(calls.length, 1);
    assert.equal(await lookupsUsed(t), 1);
    const x = await fileText(send, ans.result.structuredContent);
    for (const v of EARLIER) assert.ok(!x.includes(String(v)), `leaks ${v}`);
  });

  it("an owner written like a person's trust is not printed, and the entity is not read", async () => {
    const { binding, send } = setup(record("SMITH FAMILY TRUST DTD 1999"));
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 201);
    const x = await fileText(send, (await res.json()) as Created);
    assert.ok(!x.includes("SMITH"));
    assert.ok(!x.includes("LOUISIANA TOWER HOLDINGS"));
    assert.equal(binding.seen.length, 0);
  });

  it("a miss is the API's own answer, charges no report, and gives the lookup back", async () => {
    const miss = {
      error: "NotFound",
      message: "no parcel fl:parcel:us-48201:0010010000001 in this registry",
      coverage: { county_loaded: false },
    };
    const { t, send } = setup(miss, true);
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { billed: boolean; message: string };
    assert.equal(body.billed, false);
    assert.equal(body.message, miss.message);
    assert.equal(res.headers.get("x-factlot-reports-quota-remaining"), "3");
    assert.equal(await lookupsUsed(t), 0);
  });

  it("Tarrant County stays withheld: refused before any lookup, nothing charged", async () => {
    const { t, calls, send } = setup();
    const res = await send("/v1/reports", {
      body: { ...sheet(), arguments: { urn: "fl:parcel:us-48439:00001234" } },
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { code: string; billed: boolean };
    assert.equal(body.code, "CountyWithheld");
    assert.equal(body.billed, false);
    assert.equal(calls.length, 0);
    assert.equal(await lookupsUsed(t), 0);
  });

  it("with the day's lookups used up, the sheet is refused like the lookup, and no report is charged", async () => {
    const { t, send } = setup();
    for (let i = 0; i < 25; i++) {
      const r = await send("/v1/registry/get", { body: { urn: URN } });
      await r.body?.cancel();
    }
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: string; billed: boolean };
    assert.equal(body.error, "RegistryQuotaExceeded");
    assert.equal(body.billed, false);
    assert.equal(
      (
        await t.e.METER.quota(
          await addressSubject(IP, T0, undefined, "month"),
          "month",
          3,
          "reports",
        )
      ).used,
      0,
    );
  });

  it("takes no context and no input (nothing personal reaches the sheet)", async () => {
    const { calls, send } = setup();
    const res = await send("/v1/reports", {
      body: { ...sheet(), context: { prepared_for: "Jane Doe" } },
    });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0, "refused before the lookup");
  });
  /** The text a PDF draws (pdf-lib writes standard-font text as hex strings). */
  async function pdfText(bytes: ArrayBuffer): Promise<string> {
    const doc = await PDFDocument.load(new Uint8Array(bytes));
    let text = "";
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      let data: Buffer;
      try {
        data = obj.dict.toString().includes("FlateDecode")
          ? inflateSync(obj.contents)
          : Buffer.from(obj.contents);
      } catch {
        continue;
      }
      for (const m of data.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g))
        text += Buffer.from(m[1]!, "hex").toString("latin1") + " ";
    }
    return text.replace(/\s+/g, " ");
  }
  const reportsUsed = async (t: ReturnType<typeof env>, subject?: string) =>
    (
      await t.e.METER.quota(
        subject ?? (await addressSubject(IP, T0, undefined, "month")),
        "month",
        3,
        "reports",
      )
    ).used;

  // --- the charge at every failure point ------------------------------------------------------

  it("an answer that is not JSON: no sheet, and the report and the lookup are both given back", async () => {
    const { t, send } = setup(record(), false, { raw: "not json" });
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 502);
    const body = (await res.json()) as {
      code: string;
      billed: boolean;
      message: string;
    };
    assert.equal(body.code, "LookupUnreadable");
    assert.equal(body.billed, false);
    assert.match(body.message, /the report and the lookup were given back/);
    assert.ok(!/nothing was charged/i.test(body.message));
    assert.equal(await reportsUsed(t), 0);
    assert.equal(await lookupsUsed(t), 0);
  });

  it("a record for another parcel: no sheet, both given back", async () => {
    const other = { ...record(), urn: "fl:parcel:us-48201:other" };
    const { t, send } = setup(other);
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 502);
    assert.equal(await reportsUsed(t), 0);
    assert.equal(await lookupsUsed(t), 0);
  });

  /** A caller whose lookup answers `record`, counting give-backs. */
  function fakeCaller(rec: unknown, back = true) {
    const state = { lookups: 0, refunds: 0 };
    const caller = {
      tier: "anonymous" as const,
      subject: async () => "ipm:sheet-fault",
      sheet: async (): Promise<SheetLookupOutcome> => {
        state.lookups++;
        return {
          ok: true,
          headers: {},
          lookup: { record: rec, plan: "free" },
          refundLookup: async () => {
            state.refunds++;
            return back;
          },
        };
      },
    };
    return { caller, state };
  }
  const opts = { apiBase: "https://api.factlot.com", now: () => T0 };
  const broken = () => {
    const r = record();
    // A fact whose sources are not a list: the build fails on FactLot's side.
    (r.facts[0] as { provenance: unknown }).provenance = { sources: "x" };
    return r;
  };

  it("a build that fails after the lookup gives back the report and the lookup, or says the lookup stays counted", async () => {
    const t = env();
    const error = console.error;
    console.error = () => {};
    try {
      const a = fakeCaller(broken());
      const out = await runReport(t.e, a.caller, sheet("pdf"), opts);
      assert.ok(!out.ok && out.status === 500);
      assert.equal(a.state.refunds, 1, "the lookup was given back");
      assert.equal(
        (await t.e.METER.quota("ipm:sheet-fault", "month", 3, "reports")).used,
        0,
      );
      const b = fakeCaller(broken(), false);
      const kept = await runReport(t.e, b.caller, sheet("pdf"), opts);
      assert.ok(!kept.ok && kept.status === 500);
      assert.match(
        String(kept.body.message),
        /could not be given back and stays counted/,
      );
      assert.equal(
        (await t.e.METER.quota("ipm:sheet-fault", "month", 3, "reports")).used,
        0,
      );
    } finally {
      console.error = error;
    }
  });

  it("a store that fails gives back the report and the lookup, or says the lookup stays counted", async () => {
    for (const back of [true, false]) {
      const t = env();
      t.kv.put = async () => {
        throw new Error("kv down");
      };
      const error = console.error;
      console.error = () => {};
      try {
        const a = fakeCaller(record(), back);
        const out = await runReport(t.e, a.caller, sheet(), opts);
        assert.ok(!out.ok && out.status === 503);
        assert.equal(a.state.refunds, 1);
        assert.equal(
          (await t.e.METER.quota("ipm:sheet-fault", "month", 3, "reports"))
            .used,
          0,
        );
        if (!back) assert.match(String(out.body.message), /stays counted/);
        else assert.match(String(out.body.message), /nothing was charged/);
      } finally {
        console.error = error;
      }
    }
  });

  it("the report is reserved first: a full month, a full address month or a meter that fails runs no lookup", async () => {
    const t = env();
    const full = fakeCaller(record());
    for (let i = 0; i < 3; i++)
      await t.e.METER.consume("ipm:sheet-fault", {
        kind: "month",
        limit: 3,
        n: 1,
        counter: "reports",
      });
    assert.equal((await runReport(t.e, full.caller, sheet(), opts)).ok, false);
    const shared = fakeCaller(record());
    const out = await runReport(
      t.e,
      {
        ...shared.caller,
        subject: async () => "freemail:x",
        also: { subject: async () => "ipm:sheet-fault", per: "IP address" },
      },
      sheet(),
      opts,
    );
    assert.ok(!out.ok && out.status === 429);
    const down = fakeCaller(record());
    const meter = t.e.METER;
    t.e.METER = {
      ...meter,
      quota: meter.quota.bind(meter),
      consume: async () => {
        throw new Error("meter down");
      },
    } as typeof meter;
    const error = console.error;
    console.error = () => {};
    try {
      const d = await runReport(
        t.e,
        { ...down.caller, subject: async () => "ipm:other" },
        sheet(),
        opts,
      );
      assert.ok(!d.ok && d.status === 503);
    } finally {
      console.error = error;
      t.e.METER = meter;
    }
    assert.equal(
      full.state.lookups + shared.state.lookups + down.state.lookups,
      0,
    );
  });

  it("two requests for the last report: one sheet, one refusal, one lookup", async () => {
    const { t, calls, send } = setup();
    const month = await addressSubject(IP, T0, undefined, "month");
    for (let i = 0; i < 2; i++)
      await t.e.METER.consume(month, {
        kind: "month",
        limit: 3,
        n: 1,
        counter: "reports",
      });
    const [a, b] = await Promise.all([
      send("/v1/reports", { body: sheet() }),
      send("/v1/reports", { body: sheet() }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 429]);
    await a.body?.cancel();
    await b.body?.cancel();
    assert.equal(calls.length, 1, "the refused one never looked up");
    assert.equal(await lookupsUsed(t), 1);
    assert.equal(await reportsUsed(t), 3);
  });

  it("passes the lookup's registry quota headers through, so a page's count stays current", async () => {
    const { send } = setup();
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "24");
    assert.equal(res.headers.get("x-factlot-registry-quota-limit"), "25");
    await res.body?.cancel();
  });

  // --- the linked entity, by the property pages' rule -----------------------------------------

  it("the entity is printed only when its sources may be republished (pages off, source not allowed: the owner and one sentence)", async () => {
    const { send } = setup(record(), false, { redistribution: "unknown" });
    const res = await send("/v1/reports", { body: sheet() });
    const x = await fileText(send, (await res.json()) as Created);
    assert.ok(x.includes("LOUISIANA TOWER HOLDINGS LLC"), "the owner stays");
    assert.ok(x.includes(ENTITY_NOT_PRINTED));
    assert.ok(!x.includes("32001234567") && !x.includes("Active"));
    // Listed in PROPERTY_PAGES_EXTRA_SOURCES, as the pages allow it: printed.
    const listed = setup(record(), false, {
      redistribution: "unknown",
      env: { PROPERTY_PAGES_EXTRA_SOURCES: "tx-comptroller-entities" },
    });
    const ok = await listed.send("/v1/reports", { body: sheet() });
    const y = await fileText(listed.send, (await ok.json()) as Created);
    assert.ok(y.includes("32001234567") && y.includes("Active"));
    assert.ok(!y.includes(ENTITY_NOT_PRINTED));
  });

  it("the PDF too: a trust-style owner is not printed, and no entity mailing address ever is", async () => {
    for (const [owner, want] of [
      ["SMITH FAMILY TRUST DTD 1999", false],
      ["LOUISIANA TOWER HOLDINGS LLC", true],
    ] as const) {
      const { send } = setup(record(owner));
      const res = await send("/v1/reports", { body: sheet("pdf") });
      const created = (await res.json()) as Created;
      const dl = await send(new URL(created.download_url).pathname, {
        method: "GET",
      });
      const text = await pdfText(await dl.arrayBuffer());
      assert.equal(text.includes("SMITH"), false);
      assert.equal(text.includes("LOUISIANA TOWER HOLDINGS LLC"), want);
      assert.ok(!text.includes("PO BOX"));
    }
  });

  it("the boundary is the property pages' own sentences, with the same contact", () => {
    assert.equal(SHEET_CONTACT, CONTACT);
    const page = renderPropertyPage({
      site: "https://factlot.com",
      rec: { urn: "fl:parcel:us-11001:x", facts: [] },
      place: { region: "us-11001", name: "District of Columbia", state: "DC" },
      entity: null,
      otherCount: null,
      links: [],
      sourceOf: () => null,
    })
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ");
    assert.ok(
      page.includes(
        `A record shown here is a public-record fact as its publisher released it. It is not an appraisal or an opinion of value, not legal or tax advice, and not a substitute for checking the source. If a record names you as a person, or is wrong, email ${CONTACT} and we will remove or correct it.`,
      ),
    );
  });

  // --- callers ----------------------------------------------------------------------------------

  it("a free key: one lookup on the key and on its address, one report on its email and its address month", async () => {
    const { t, send } = setup();
    (t.e as { FREE_KEY_ENABLED?: string }).FREE_KEY_ENABLED = "true";
    const key = `fl_free_${"S".repeat(43)}`;
    await t.e.KEYS.put(
      `freekey:${await hashKey(key)}`,
      JSON.stringify({
        tier: "free",
        email_hash: await hashKey("sheet-free-key"),
        created: new Date(T0).toISOString(),
      }),
    );
    const res = await send("/v1/reports", { body: sheet(), key });
    assert.equal(res.status, 201, await res.clone().text());
    await res.body?.cancel();
    const day = await addressSubject(IP, T0, undefined);
    assert.equal(
      (await t.e.METER.quota(`freekey:${keyId(await hashKey(key))}`, "day", 25))
        .used,
      1,
    );
    assert.equal(
      (await t.e.METER.quota(`freeaddr:${day}`, "day", 100)).used,
      1,
    );
    assert.equal(
      await reportsUsed(
        t,
        `freemail:${(await hashKey("sheet-free-key")).slice(0, 32)}`,
      ),
      1,
    );
    assert.equal(await reportsUsed(t), 1);
  });

  it("Team: every roll year, one report of the Team month", async () => {
    const { t, send } = setup();
    const key = await issue(t.e, "team");
    const res = await send("/v1/reports", { body: sheet(), key });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Created;
    assert.equal(body.reports.limit, REPORTS_PER_MONTH.team);
    const x = await fileText(send, body);
    for (const v of EARLIER) assert.ok(x.includes(String(v)));
  });

  it("on the site host (factlot.com/v1/reports, as /try/ sends it): the same lookup and report", async () => {
    const { t, calls, send } = setup();
    const res = await send("/v1/reports", {
      body: sheet(),
      host: "factlot.com",
    });
    assert.equal(res.status, 201);
    await res.body?.cancel();
    assert.equal(calls.length, 1);
    assert.equal(await lookupsUsed(t), 1);
    assert.equal(await reportsUsed(t), 1);
  });

  it("the per-minute limit: exactly two units, both from the caller's own subject", async () => {
    const { t, send } = setup();
    const seen: [string, unknown][] = [];
    const meter = t.e.METER;
    const hit = meter.hit.bind(meter);
    meter.hit = ((subject: string, perMinute: unknown, ...rest: unknown[]) => {
      seen.push([subject, perMinute]);
      return (hit as (...a: unknown[]) => unknown)(subject, perMinute, ...rest);
    }) as typeof meter.hit;
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 201);
    await res.body?.cancel();
    const day = await addressSubject(IP, T0, undefined);
    const minute = seen.filter(([, n]) => typeof n === "number");
    assert.deepEqual(minute, [
      [day, 60],
      [day, 60],
    ]);
  });

  it("counts one lookup usage event, labelled registry_get", async () => {
    const points: { blobs: string[] }[] = [];
    const t2 = setup(record(), false, {
      env: { USAGE_COUNTERS_ENABLED: "true" },
    });
    // The usage dataset, written once per event.
    Object.assign(t2.t.e, {
      USAGE: { writeDataPoint: (d: { blobs: string[] }) => points.push(d) },
    });
    const res = await t2.send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 201);
    await res.body?.cancel();
    const lookups = points.filter((p) => p.blobs[0] === "lookup");
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0]!.blobs[1], "registry_get");
  });

  it("with gating turned off, a free sheet still shows the current roll year only", async () => {
    const { send } = setup(record(), false, {
      env: { GATING_ENABLED: "false" },
    });
    const res = await send("/v1/reports", { body: sheet() });
    assert.equal(res.status, 201);
    const x = await fileText(send, (await res.json()) as Created);
    for (const v of EARLIER) assert.ok(!x.includes(String(v)), `leaks ${v}`);
    assert.ok(x.includes("available with a Pro or Team key"));
  });
});
