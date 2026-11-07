/**
 * The model-backed hosted tools (doc_extract_lease, report_narrative) with a fake Anthropic
 * transport: no network, no key, no model. Covers the client (success, invalid JSON, timeout,
 * 429, 5xx retry, refusal), FactLot's verification of model output (wrong quotes, wrong numbers,
 * advice), metering by pages, the feature switch (503 without the key), and that nothing the
 * customer sent reaches a log.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runTool } from "@factlot/tools";

import { generateKey, hashKey, writeKey, type KeyRecord } from "./keys.ts";
import {
  Meter,
  modelSubject,
  objectLimiter,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import {
  EXTRACT_LEASE_TOOL,
  extractLease,
  extractionSchema,
  extractionSystemPrompt,
  type ChargedAllowance,
} from "./ingest.ts";
import {
  ModelError,
  modelSession,
  type ModelTransport,
  type TransportResponse,
} from "./model.ts";
import { runModelTool } from "./model-tools.ts";
import {
  adviceIn,
  extractFigures,
  figureMatches,
  reportNarrative,
  resultFacts,
  verifyProse,
} from "./narrative.ts";
import { MODEL_ALLOWANCES } from "./plans.ts";
import { handle } from "./router.ts";
import type {
  Env,
  HitResult,
  KV,
  MeterService,
  QuotaKind,
  QuotaSpec,
  QuotaState,
  RateLimit,
} from "./types.ts";

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const KEY = { ANTHROPIC_API_KEY: "fake-model-key-for-tests" };

// --- Fakes ------------------------------------------------------------------------------------

type Reply =
  | { status?: number; headers?: Record<string, string>; body: unknown }
  | "hang"
  | "throw";

/** A fake Messages API: answers from a queue and records each request body. */
function fakeAnthropic(replies: Reply[]) {
  const requests: Record<string, unknown>[] = [];
  const transport: ModelTransport = async (body, init) => {
    requests.push(body);
    const r = replies.shift();
    if (r === undefined) throw new Error("no more fake replies");
    if (r === "throw") throw new TypeError("network down");
    if (r === "hang")
      return new Promise<TransportResponse>((_, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    return {
      status: r.status ?? 200,
      headers: new Headers(r.headers ?? {}),
      body: r.body,
    };
  };
  return { transport, requests };
}

/** A Messages API answer whose text block is `json` (stringified). */
function message(
  json: unknown,
  usage = { input_tokens: 1200, output_tokens: 300 },
  stop_reason = "end_turn",
) {
  return {
    body: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      stop_reason,
      content: [
        { type: "thinking", thinking: "" },
        {
          type: "text",
          text: typeof json === "string" ? json : JSON.stringify(json),
        },
      ],
      usage: {
        ...usage,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

class MemoryStore implements CounterStore {
  readonly counts = new Map<string, number>();
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
  getClaim() {
    return undefined;
  }
  setClaim() {}
  addUsage() {}
  readUsage() {
    return [];
  }
  pruneUsageBefore() {}
  getMeta() {
    return undefined;
  }
  setMeta() {}
  deleteMeta() {}
  size() {
    return this.counts.size;
  }
  clearClaims() {}
  reset() {}
}

/** MeterService over real Meter objects (one per subject), on a fixed clock. */
function memoryMeter(now = () => T0) {
  const meters = new Map<string, Meter>();
  const m = (s: string) => {
    let x = meters.get(s);
    if (!x) meters.set(s, (x = new Meter(() => new MemoryStore(), now)));
    return x;
  };
  const strip = (r: HitResult & { window_ends?: number }): HitResult => {
    const { window_ends: _, ...rest } = r;
    void _;
    return rest;
  };
  const service: MeterService = {
    hit: async (s: string, perMinute: number, q?: QuotaSpec) =>
      strip(m(s).hit(perMinute, q)),
    consume: async (s: string, q: QuotaSpec) => strip(m(s).hit(null, q)),
    quota: async (
      s: string,
      k: QuotaKind,
      limit: number,
    ): Promise<QuotaState> => {
      const { window_ends: _, ...q } = m(s).quota(k, limit);
      void _;
      return q;
    },
    refund: async (s: string, k: QuotaKind, n: number, r: string) => {
      m(s).refund(k, n, r);
    },
    claim: async (_n: string, v: string) => v,
    record: async () => {},
    usage: async () => ({
      from: "",
      to: "",
      daily: [],
      by_tool: {},
      by_region: {},
      total: 0,
    }),
    lastUsed: async () => undefined,
  };
  return { service, meters };
}

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

const allow: RateLimit = {
  limit: async () => ({ success: true }),
  peek: async () => ({ success: true }),
};

function routerEnv(over: Partial<Env> = {}) {
  const meter = memoryMeter();
  const ns: DurableObjectNamespaceLike = {
    idFromName: (n) => n,
    get: () => ({ fetch: async () => new Response("1") }),
  };
  const env: Env = {
    KEYS: new MemoryKV(),
    RL_ANON: allow,
    RL_CLAIM: objectLimiter(ns, "claim", 1),
    METER: meter.service,
    ...over,
  };
  return { env, meter };
}

async function issue(e: Env, plan: KeyRecord["plan"] = "pro") {
  const key = generateKey();
  const hash = await hashKey(key);
  const rec: KeyRecord = {
    plan,
    status: "active",
    customer: "cus_1",
    subscription: "sub_model",
    stripe_status: "active",
    created: "2026-11-03T00:00:00Z",
    checked_at: T0,
  };
  await writeKey(e.KEYS, hash, rec, T0);
  await e.KEYS.put("sub:sub_model", JSON.stringify([hash]));
  return key;
}

/** The inner handler: tools/list answers one open-source tool. */
const innerApi = {
  fetch: async (r: Request) => {
    const body = JSON.parse(await r.text()) as { id?: unknown };
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "calc_irr" }] },
      }),
      { headers: { "content-type": "application/json" } },
    );
  },
};

/** An allowance that always grants, recording charges and refunds. */
function freeAllowance() {
  const log = { charged: 0, refunded: 0 };
  const take = async (n = 1): Promise<ChargedAllowance> => {
    log.charged += n;
    return {
      quota: { test: { used: n } },
      refund: async () => {
        log.refunded += n;
      },
    };
  };
  return { take, log };
}

// --- A lease ----------------------------------------------------------------------------------

const LEASE_PAGES = [
  'This Lease Agreement is entered into by Harbor Point Owner LLC ("Landlord") and Bluefin Analytics Inc. ("Tenant").',
  "1. Term. The Term shall commence on July 1, 2026 and shall expire on June 30, 2031, unless sooner terminated.",
  "2. Premises. The Premises contain approximately 12,500 rentable square feet on the fourth floor.",
  "3. Security Deposit. Tenant shall deposit with Landlord a security deposit of $45,000.00 upon execution.",
];

/** A model answer for LEASE_PAGES: one right, one wrong quote, one wrong number, one bad JSON. */
const MODEL_FACTS = {
  facts: [
    {
      predicate: "lease.expiration_date",
      value_json: '"2031-06-30"',
      quote: "shall expire on June 30, 2031",
      page: 2,
      section: "1",
    },
    {
      predicate: "lease.landlord",
      value_json: '"Harbor Point Owner LLC"',
      quote: "made by and between Harbor Point Owner LLC as landlord",
      page: 1,
      section: "",
    },
    {
      predicate: "lease.rentable_area_sf",
      value_json: "13500",
      quote: "approximately 12,500 rentable square feet",
      page: 3,
      section: "2",
    },
    {
      predicate: "lease.security_deposit",
      value_json: "$45,000",
      quote: "a security deposit of $45,000.00 upon execution",
      page: 4,
      section: "3",
    },
  ],
  not_found: ["lease.cam_cap"],
};

const PREDICATES = [
  "lease.landlord",
  "lease.expiration_date",
  "lease.rentable_area_sf",
  "lease.security_deposit",
  "lease.cam_cap",
];

/** A minimal PDF with one Helvetica text line per entry of each page. */
function makePdf(pages: string[][]): Uint8Array {
  const objs: string[] = [];
  const n = pages.length;
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`,
  );
  const font = 3 + n * 2;
  pages.forEach((lines, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
    );
    const ops = lines
      .map(
        (l, j) =>
          `BT /F1 11 Tf 72 ${720 - j * 14} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`,
      )
      .join("\n");
    objs.push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  });
  objs.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Capture every console line written while `fn` runs. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<[T, string[]]> {
  const lines: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn };
  const grab = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.log = grab;
  console.error = grab;
  console.warn = grab;
  try {
    return [await fn(), lines];
  } finally {
    Object.assign(console, saved);
  }
}

// --- The client -------------------------------------------------------------------------------

describe("model client", () => {
  const req = {
    model: "claude-sonnet-5-5",
    system: "fixed instructions",
    user: "request data",
    schema: { type: "object" },
    maxTokens: 100,
    effort: "low" as const,
  };

  it("sends a cached system block, structured output, effort, fallbacks; no sampling params", async () => {
    const fake = fakeAnthropic([message({ ok: true })]);
    const s = modelSession(KEY, { transport: fake.transport });
    const r = await s.call(req);
    assert.equal(r.text, '{"ok":true}');
    assert.equal(r.model, "claude-sonnet-5-5");
    const body = fake.requests[0]!;
    assert.deepEqual(body.system, [
      {
        type: "text",
        text: "fixed instructions",
        cache_control: { type: "ephemeral" },
      },
    ]);
    assert.deepEqual(body.output_config, {
      effort: "low",
      format: { type: "json_schema", schema: { type: "object" } },
    });
    assert.equal(body.fallbacks, "default");
    assert.equal(body.max_tokens, 100);
    for (const k of [
      "temperature",
      "top_p",
      "top_k",
      "tool_choice",
      "thinking",
    ])
      assert.equal(k in body, false, k);
    assert.deepEqual(s.usage(), {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
    });
  });

  it("429: not retried, retry-after passed on", async () => {
    const fake = fakeAnthropic([
      { status: 429, headers: { "retry-after": "17" }, body: {} },
    ]);
    const s = modelSession(KEY, { transport: fake.transport });
    await assert.rejects(s.call(req), (e: ModelError) => {
      assert.equal(e.kind, "rate_limited");
      assert.equal(e.retryAfterSeconds, 17);
      return true;
    });
    assert.equal(fake.requests.length, 1);
  });

  it("529 overloaded: retried once", async () => {
    const fake = fakeAnthropic([{ status: 529, body: {} }, message({ ok: 1 })]);
    const s = modelSession(KEY, { transport: fake.transport });
    assert.equal((await s.call(req)).text, '{"ok":1}');
    assert.equal(s.attempts(), 2);
  });

  it("times out at the deadline", async () => {
    const fake = fakeAnthropic(["hang"]);
    const s = modelSession(KEY, { transport: fake.transport, timeoutMs: 30 });
    const t = Date.now();
    await assert.rejects(s.call(req), (e: ModelError) => e.kind === "timeout");
    assert.ok(Date.now() - t < 2_000);
  });

  it("maps 401, refusal, max_tokens and network errors", async () => {
    const cases: [Reply, string][] = [
      [{ status: 401, body: {} }, "unavailable"],
      [message("{}", undefined, "refusal"), "refused"],
      [message("{", undefined, "max_tokens"), "truncated"],
      [{ status: 400, body: { error: {} } }, "upstream"],
      ["throw", "upstream"],
    ];
    for (const [reply, kind] of cases) {
      const s = modelSession(KEY, {
        transport: fakeAnthropic([reply]).transport,
      });
      await assert.rejects(s.call(req), (e: ModelError) => e.kind === kind);
    }
  });

  it("without a key it never calls out", async () => {
    const fake = fakeAnthropic([message({})]);
    const s = modelSession({}, { transport: fake.transport });
    await assert.rejects(
      s.call(req),
      (e: ModelError) => e.kind === "unavailable",
    );
    assert.equal(fake.requests.length, 0);
  });
});

// --- doc_extract_lease ------------------------------------------------------------------------

describe("doc_extract_lease", () => {
  it("returns only what FactLot verified; wrong quotes and wrong numbers go to needs_review", async () => {
    // The value that is not JSON costs one retry; the second answer is the same.
    const fake = fakeAnthropic([message(MODEL_FACTS), message(MODEL_FACTS)]);
    const allowance = freeAllowance();
    const a = await extractLease(
      KEY,
      {
        document: { pages: LEASE_PAGES, title: "Lease" },
        predicates: PREDICATES,
        as_of: "2026-11-07",
      },
      allowance.take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(a.status, 200);
    const b = a.body as {
      facts: { fact: { predicate: string; value: unknown } }[];
      needs_review: { status: string; predicate: string; check: string }[];
      unextracted: string[];
      pages: number;
      pages_counted: number;
      model: { id: string; input_tokens: number; output_tokens: number };
      nothing_stored: boolean;
      document: { document_id: string };
    };
    assert.deepEqual(
      b.facts.map((f) => [f.fact.predicate, f.fact.value]),
      [["lease.expiration_date", "2031-06-30"]],
    );
    const review = Object.fromEntries(
      b.needs_review.map((r) => [r.predicate, [r.status, r.check]]),
    );
    assert.deepEqual(review["lease.landlord"], ["rejected", "quote"]);
    assert.deepEqual(review["lease.rentable_area_sf"], [
      "needs_review",
      "consistency",
    ]);
    assert.deepEqual(review["lease.security_deposit"], [
      "rejected",
      "value_json",
    ]);
    assert.deepEqual(b.unextracted, ["lease.cam_cap"]);
    assert.equal(b.pages, 4);
    assert.equal(b.pages_counted, 4);
    assert.equal(allowance.log.charged, 4);
    assert.equal(b.nothing_stored, true);
    assert.deepEqual(b.model, {
      id: "claude-sonnet-5-5",
      input_tokens: 4200,
      output_tokens: 600,
      cache_read_input_tokens: 1800,
    });
    assert.match(b.document.document_id, /^fl:document:sha256-[a-f0-9]{64}$/);
    assert.equal(fake.requests.length, 2);
  });

  it("the prompt: cached catalog in the system block, the document only in the user turn", async () => {
    const fake = fakeAnthropic([message({ facts: [], not_found: [] })]);
    await extractLease(
      KEY,
      { document: { pages: LEASE_PAGES }, predicates: ["lease.tenant"] },
      freeAllowance().take,
      { transport: fake.transport, log: () => {} },
    );
    const body = fake.requests[0]!;
    const system = (body.system as { text: string }[])[0]!.text;
    assert.equal(system, extractionSystemPrompt());
    assert.ok(!system.includes("Harbor Point"));
    assert.ok(system.includes("lease.base_rent_schedule"));
    const user = (body.messages as { content: string }[])[0]!.content;
    assert.ok(user.includes("[Page 2]\n1. Term."));
    assert.ok(user.includes("Requested predicates: lease.tenant"));
    // The schema does not change with the predicates asked for (cache-stable).
    assert.deepEqual(
      (body.output_config as { format: { schema: unknown } }).format.schema,
      extractionSchema(),
    );
  });

  it("retries once on invalid JSON", async () => {
    const fake = fakeAnthropic([message("not json {"), message(MODEL_FACTS)]);
    const a = await extractLease(
      KEY,
      { document: { pages: LEASE_PAGES }, predicates: PREDICATES },
      freeAllowance().take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(a.status, 200);
    assert.equal(fake.requests.length, 2);
    const retryUser = (fake.requests[1]!.messages as { content: string }[])[0]!
      .content;
    assert.match(retryUser, /^Your previous answer was not valid/);
  });

  it("invalid JSON twice: 502, and the pages are given back", async () => {
    const fake = fakeAnthropic([message("nope"), message("still nope")]);
    const allowance = freeAllowance();
    const a = await extractLease(
      KEY,
      { document: { pages: LEASE_PAGES } },
      allowance.take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(a.status, 502);
    assert.equal(a.body.error, "ModelOutputInvalid");
    assert.equal(allowance.log.refunded, allowance.log.charged);
  });

  it("a timeout or 429 answers with next, and refunds", async () => {
    for (const [reply, status, error] of [
      ["hang", 504, "ModelTimeout"],
      [{ status: 429, body: {} }, 503, "ModelBusy"],
    ] as [Reply, number, string][]) {
      const allowance = freeAllowance();
      const a = await extractLease(
        KEY,
        { document: { pages: LEASE_PAGES } },
        allowance.take,
        {
          transport: fakeAnthropic([reply]).transport,
          timeoutMs: 30,
          log: () => {},
        },
      );
      assert.equal(a.status, status);
      assert.equal(a.body.error, error);
      assert.equal(typeof a.body.next, "string");
      assert.equal(allowance.log.refunded, 4);
    }
  });

  it("reads a PDF's text layer and cites the file's SHA-256", async () => {
    const pdf = makePdf([
      ["1. Term. The Term shall expire on June 30, 2031."],
      ["Tenant: Bluefin Analytics Inc."],
    ]);
    const fake = fakeAnthropic([
      message({
        facts: [
          {
            predicate: "lease.expiration_date",
            value_json: '"2031-06-30"',
            quote: "The Term shall expire on June 30, 2031",
            page: 1,
            section: "1",
          },
        ],
        not_found: [],
      }),
    ]);
    const [a, lines] = await captureLogs(() =>
      extractLease(
        KEY,
        {
          document: { pdf_base64: b64(pdf) },
          predicates: ["lease.expiration_date"],
        },
        freeAllowance().take,
        { transport: fake.transport },
      ),
    );
    // pdf.js writes nothing; the one line is the model call's counts.
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^\{"msg":"model_call"/);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = a.body as {
      facts: { fact: { provenance: { sources: { document_id: string }[] } } }[];
      document: { document_id: string; sha256: string; source: string };
    };
    const sha = Buffer.from(
      await crypto.subtle.digest("SHA-256", pdf),
    ).toString("hex");
    assert.equal(b.document.document_id, `fl:document:sha256-${sha}`);
    assert.equal(b.document.source, "pdf");
    assert.equal(
      b.facts[0]!.fact.provenance.sources[0]!.document_id,
      b.document.document_id,
    );
  });

  it("a scanned PDF answers NeedsOcr: no model call, nothing counted", async () => {
    const fake = fakeAnthropic([]);
    const allowance = freeAllowance();
    const a = await extractLease(
      KEY,
      { document: { pdf_base64: b64(makePdf([[], [], []])) } },
      allowance.take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(a.status, 422);
    assert.equal(a.body.error, "NeedsOcr");
    assert.equal(a.body.needs_ocr, true);
    assert.match(String(a.body.next), /doc_read_pdf/);
    assert.equal(fake.requests.length, 0);
    assert.equal(allowance.log.charged, 0);
  });

  it("fetches an https URL; refuses http, IP hosts and redirects to them", async () => {
    const pdf = makePdf([["The Term shall expire on June 30, 2031."]]);
    const fetched: string[] = [];
    const fetchDocument = (async (u: string | URL) => {
      fetched.push(String(u));
      if (String(u).includes("redirect"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://10.0.0.1/lease.pdf" },
        });
      return new Response(pdf, {
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;
    const ok = await extractLease(
      KEY,
      { document: { url: "https://example.com/lease.pdf" } },
      freeAllowance().take,
      {
        transport: fakeAnthropic([message({ facts: [], not_found: [] })])
          .transport,
        fetchDocument,
        log: () => {},
      },
    );
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.pages, 1);
    const http = await extractLease(
      KEY,
      { document: { url: "http://example.com/lease.pdf" } },
      freeAllowance().take,
      { fetchDocument },
    );
    assert.equal(http.status, 400);
    const redirected = await extractLease(
      KEY,
      { document: { url: "https://example.com/redirect" } },
      freeAllowance().take,
      { fetchDocument, log: () => {} },
    );
    assert.equal(redirected.status, 400);
    assert.equal(redirected.body.error, "DocumentUnreachable");
    assert.deepEqual(fetched, [
      "https://example.com/lease.pdf",
      "https://example.com/redirect",
    ]);
  });

  it("input errors are answered before anything is counted", async () => {
    const allowance = freeAllowance();
    for (const bad of [
      {},
      { document: {} },
      { document: { pages: ["x"], text: "y" } },
      { document: { pages: ["x"] }, predicates: ["lease.nope"] },
      { document: { pages: ["x"] }, as_of: "07/11/2026" },
      { document: { pdf_base64: "%%%not base64%%%" } },
      { document: { pdf_base64: b64(new TextEncoder().encode("hello")) } },
      { document: { pages: Array(201).fill("x") } },
    ]) {
      const a = await extractLease(KEY, bad, allowance.take, { log: () => {} });
      assert.ok(a.status >= 400 && a.status < 500, JSON.stringify(a.body));
    }
    assert.equal(allowance.log.charged, 0);
  });
});

// --- Metering, the switch, and the router -----------------------------------------------------

describe("model tools on the hosted API", () => {
  const sixtyPages = Array.from(
    { length: 60 },
    (_, i) => `Page ${i + 1}. The Term shall expire on June 30, 2031.`,
  );

  it("meters by pages per subscription per month, and refunds a failed call", async () => {
    const { env, meter } = routerEnv(KEY);
    const caller = { plan: "pro" as const, subject: "sub:sub_model" };
    const counter = () =>
      meter.meters
        .get(modelSubject("ingest_pages", "sub:sub_model"))!
        .quota("month", MODEL_ALLOWANCES.pro.ingest_pages_per_month);
    const run = (replies: Reply[], pages = sixtyPages) =>
      runModelTool("doc_extract_lease", { document: { pages } }, env, caller, {
        transport: fakeAnthropic(replies).transport,
        now: () => T0,
        log: () => {},
      });
    const first = await run([message({ facts: [], not_found: [] })]);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.quota, {
      ingest_pages: {
        used: 60,
        limit: 100,
        remaining: 40,
        resets_at: "2026-12-01T00:00:00.000Z",
      },
    });
    // A failed model call gives its pages back.
    const busy = await run(
      [
        { status: 529, body: {} },
        { status: 529, body: {} },
      ],
      sixtyPages.slice(0, 30),
    );
    assert.equal(busy.status, 503);
    assert.equal(counter().used, 60);
    // 60 more do not fit in the 40 left: refused whole, nothing taken.
    const over = await run([message({ facts: [], not_found: [] })]);
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "IngestQuotaExceeded");
    assert.equal(over.body.remaining, 40);
    assert.equal(counter().used, 60);
    // Registry lookups are a different counter.
    assert.equal(meter.meters.has("sub:sub_model"), false);
  });

  it("without ANTHROPIC_API_KEY: not listed, REST 503 ModelUnavailable, MCP tool error", async () => {
    const { env } = routerEnv();
    const key = await issue(env);
    const auth = { authorization: `Bearer ${key}` };
    const rest = await handle(
      new Request("https://api.factlot.com/v1/doc/extract_lease", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ document: { pages: ["x"] } }),
      }),
      env,
      innerApi,
    );
    assert.equal(rest.status, 503);
    const body = (await rest.json()) as { error: string; next: string };
    assert.equal(body.error, "ModelUnavailable");
    assert.match(body.next, /doc_verify_facts/);
    const narrative = await handle(
      new Request("https://api.factlot.com/v1/report/narrative", {
        method: "POST",
        body: "{}",
      }),
      env,
      innerApi,
    );
    assert.equal(narrative.status, 503);
    const list = (await (
      await handle(
        new Request("https://api.factlot.com/mcp", {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        env,
        innerApi,
      )
    ).json()) as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map((t) => t.name);
    assert.ok(names.includes("account_status"));
    assert.ok(!names.includes("doc_extract_lease"));
    assert.ok(!names.includes("report_narrative"));
    const call = (await (
      await handle(
        new Request("https://api.factlot.com/mcp", {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "doc_extract_lease", arguments: {} },
          }),
        }),
        env,
        innerApi,
      )
    ).json()) as {
      result: { isError: boolean; structuredContent: { error: string } };
    };
    assert.equal(call.result.isError, true);
    assert.equal(call.result.structuredContent.error, "ModelUnavailable");
    const plans = (await (
      await handle(
        new Request("https://api.factlot.com/v1/plans"),
        env,
        innerApi,
      )
    ).json()) as { model_tools: { available: boolean } };
    assert.equal(plans.model_tools.available, false);
  });

  it("with the key: listed for Pro and Team keys only; free callers get PlanRequired", async () => {
    const { env } = routerEnv(KEY);
    const key = await issue(env, "team");
    const list = (await (
      await handle(
        new Request("https://api.factlot.com/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        env,
        innerApi,
      )
    ).json()) as { result: { tools: { name: string }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name).slice(-2), [
      "doc_extract_lease",
      "report_narrative",
    ]);
    const anon = await handle(
      new Request("https://api.factlot.com/v1/doc/extract_lease", {
        method: "POST",
        body: JSON.stringify({ document: { pages: ["x"] } }),
      }),
      env,
      innerApi,
    );
    assert.equal(anon.status, 403);
    assert.equal(
      ((await anon.json()) as { error: string }).error,
      "PlanRequired",
    );
    const anonList = (await (
      await handle(
        new Request("https://api.factlot.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        env,
        innerApi,
      )
    ).json()) as { result: { tools: { name: string }[] } };
    // report_create is listed for every caller; the model-backed tools are not.
    assert.deepEqual(
      anonList.result.tools.map((t) => t.name),
      ["calc_irr", "report_create"],
    );
  });

  it("an MCP call may carry a PDF over 1 MB; other bodies keep the 1 MB limit", async () => {
    const { env } = routerEnv(KEY);
    const key = await issue(env);
    const big = "x".repeat(1_200_000);
    const headers = {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    };
    const res = await handle(
      new Request("https://api.factlot.com/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "doc_extract_lease",
            arguments: {
              document: { pages: [big.slice(0, 90_000)], title: big },
            },
          },
        }),
      }),
      env,
      innerApi,
      { model: { transport: fakeAnthropic([]).transport, log: () => {} } },
    );
    assert.equal(res.status, 200);
    const msg = (await res.json()) as {
      id: number;
      result: { structuredContent: { error: string } };
    };
    assert.equal(msg.id, 9);
    // Answered by the tool (title over 500 characters), not refused as too large.
    assert.equal(msg.result.structuredContent.error, "InputError");
    const other = await handle(
      new Request("https://api.factlot.com/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "calc_irr", arguments: { note: big } },
        }),
      }),
      env,
      innerApi,
    );
    assert.equal(other.status, 413);
  });

  it("logs counts and latency only: no document text, quote, value or prose", async () => {
    const { env } = routerEnv(KEY);
    const key = await issue(env);
    const transport = fakeAnthropic([
      message(MODEL_FACTS),
      message(MODEL_FACTS),
      message({
        paragraphs: [
          "The NPV is $17.63 at an 8% rate. You should buy it for $9,999,999.",
        ],
      }),
      message({ paragraphs: ["The NPV is $17.63 at an 8% rate."] }),
    ]).transport;
    const [, lines] = await captureLogs(async () => {
      for (const [path, body] of [
        [
          "/v1/doc/extract_lease",
          { document: { pages: LEASE_PAGES, title: "Harbor lease" } },
        ],
        [
          "/v1/report/narrative",
          {
            tool: "calc_npv",
            input: { rate: 0.08, cash_flows: [-1000, 300, 400, 500] },
            audience: "summary",
          },
        ],
      ] as const) {
        const r = await handle(
          new Request(`https://api.factlot.com${path}`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
          }),
          env,
          innerApi,
          { model: { transport } },
        );
        assert.equal(r.status, 200, await r.clone().text());
      }
    });
    assert.ok(lines.length >= 2);
    const all = lines.join("\n");
    for (const secret of [
      "Harbor",
      "Bluefin",
      "2031",
      "12,500",
      "45,000",
      "June",
      "17.63",
      "9,999,999",
      "You should",
      "Term",
      "fake-model-key",
    ])
      assert.ok(!all.includes(secret), `log contains ${secret}`);
    for (const line of lines) {
      const o = JSON.parse(line) as Record<string, unknown>;
      assert.equal(o.msg, "model_call");
      for (const k of Object.keys(o))
        assert.ok(
          [
            "msg",
            "tool",
            "outcome",
            "model",
            "pages",
            "attempts",
            "input_tokens",
            "output_tokens",
            "latency_ms",
          ].includes(k),
          k,
        );
    }
  });

  it("CPU: verifying model output for a 60-page lease stays well under the budget", (t) => {
    const clause = (i: number) =>
      `${i}. Section ${i}. Landlord and Tenant agree that the provisions of this Section ${i} apply throughout the Term. ` +
      "Tenant shall pay all charges when due, maintain the Premises in good condition and repair, comply with all laws, and carry the insurance required by this Lease. ".repeat(
        14,
      );
    const pages = Array.from({ length: 60 }, (_, i) => clause(i + 1));
    pages[1] += " The Term shall expire on June 30, 2031.";
    pages[2] +=
      " The Premises contain approximately 12,500 rentable square feet.";
    pages[40] += " Tenant shall deposit a security deposit of $45,000.00.";
    const candidates = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0
        ? {
            predicate: "lease.expiration_date",
            value: "2031-06-30",
            quote: "The Term shall expire on June 30, 2031",
            page: 2,
          }
        : i % 3 === 1
          ? {
              predicate: "lease.rentable_area_sf",
              value: 12500,
              quote: "approximately 12,500 rentable square feet",
              page: 3,
            }
          : {
              predicate: "lease.security_deposit",
              value: 45000,
              quote: "a security deposit of $45,000.00",
              page: 30, // wrong page: found on exactly one other page
            },
    );
    const input = {
      document: { pages },
      candidates,
      as_of: "2026-11-07",
    };
    runTool("doc_verify_facts", input); // warm up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const out = runTool("doc_verify_facts", input);
      runs.push(performance.now() - t0);
      assert.equal(out.ok, true);
    }
    const median = runs.sort((a, b) => a - b)[2]!;
    const chars = pages.reduce((n, p) => n + p.length, 0);
    t.diagnostic(
      `doc_verify_facts, 60 pages (${chars} chars), 30 candidates: median ${median.toFixed(1)} ms`,
    );
    assert.ok(median < 250, `verification took ${median} ms`);
  });
});

// --- report_narrative -------------------------------------------------------------------------

describe("report_narrative", () => {
  const npvInput = { rate: 0.08, cash_flows: [-1000, 300, 400, 500] };

  it("a planted wrong number is caught and its sentence removed", async () => {
    const fake = fakeAnthropic([
      message({
        paragraphs: [
          "At an 8% discount rate the net present value is $17.63. That is $1,234,000 more than last year.",
        ],
      }),
    ]);
    const a = await reportNarrative(
      KEY,
      { tool: "calc_npv", input: npvInput, audience: "summary" },
      freeAllowance().take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(a.status, 200);
    const b = a.body as {
      text: string;
      label: string;
      unverified_sentences: { sentence: string; unmatched: string[] }[];
      verification: { figures_checked: number; figures_verified: number };
      source: { result_check: string; version: string };
    };
    assert.equal(
      b.text,
      "At an 8% discount rate the net present value is $17.63.",
    );
    assert.deepEqual(b.unverified_sentences, [
      {
        sentence: "That is $1,234,000 more than last year.",
        unmatched: ["$1,234,000"],
      },
    ]);
    assert.equal(
      b.label,
      "Drafted by a model; figures verified by FactLot against calc_npv@1",
    );
    assert.equal(b.source.result_check, "recomputed");
    assert.deepEqual(b.verification, {
      ...b.verification,
      figures_checked: 3,
      figures_verified: 2,
    });
  });

  it("keep_unverified keeps the sentence with a marker", async () => {
    const a = await reportNarrative(
      KEY,
      {
        tool: "calc_npv",
        input: npvInput,
        audience: "plain_english",
        keep_unverified: true,
      },
      freeAllowance().take,
      {
        transport: fakeAnthropic([
          message({ paragraphs: ["The value is $17.63. The rate is 9%."] }),
        ]).transport,
        log: () => {},
      },
    );
    assert.equal(
      a.body.text,
      "The value is $17.63. The rate is 9%. [unverified: 9%]",
    );
  });

  it("advice triggers one redraft; advice that survives it is removed", async () => {
    const fake = fakeAnthropic([
      message({
        paragraphs: ["The NPV is $17.63. You should invest; we recommend it."],
      }),
      message({
        paragraphs: ["The NPV is $17.63 at 8%. This deal is worth pursuing."],
      }),
    ]);
    const a = await reportNarrative(
      KEY,
      { tool: "calc_npv", input: npvInput, audience: "client_memo" },
      freeAllowance().take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(fake.requests.length, 2);
    const redraft = (fake.requests[1]!.messages as { content: string }[])[0]!
      .content;
    assert.match(redraft, /^Rewrite: a previous draft used advice/);
    assert.match(redraft, /"You should"/);
    const b = a.body as {
      text: string;
      redrafted: boolean;
      removed_sentences: { reason: string; phrases: string[] }[];
    };
    assert.equal(b.redrafted, true);
    assert.equal(b.text, "The NPV is $17.63 at 8%.");
    assert.deepEqual(b.removed_sentences, [
      {
        sentence: "This deal is worth pursuing.",
        reason: "advice",
        phrases: ["worth pursuing"],
      },
    ]);
  });

  it("a clean draft is not redrafted", async () => {
    const fake = fakeAnthropic([
      message({ paragraphs: ["The NPV is $17.63 at an 8% rate."] }),
    ]);
    const a = await reportNarrative(
      KEY,
      { tool: "calc_npv", input: npvInput, audience: "summary" },
      freeAllowance().take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(fake.requests.length, 1);
    assert.equal(a.body.redrafted, false);
  });

  it("Texas tools: arithmetic only, with the §81.101(c) notice in text and notice", async () => {
    const result = runTool("calc_tx_unequal_appraisal", {
      tax_year: 2027,
      subject: {
        id: "S",
        county_fips: "201",
        value: 1000000,
        value_basis: "appraised",
      },
      comparables: ["A", "B", "C"].map((id, i) => ({
        id,
        county_fips: "201",
        value: 900000 + i * 50000,
        value_basis: "appraised",
      })),
    });
    assert.equal(result.ok, true);
    const fake = fakeAnthropic([
      message({
        paragraphs: [
          "The median of the 3 adjusted comparable values is $950,000, $50,000 below the subject's $1,000,000 for tax year 2027. This is not an appraisal.",
          "That makes it worth protesting.",
        ],
      }),
      message({
        paragraphs: [
          "The median of the 3 adjusted comparable values is $950,000, $50,000 below the subject's $1,000,000 for tax year 2027 (Tex. Tax Code §41.43(b)(3)).",
        ],
      }),
    ]);
    const a = await reportNarrative(
      KEY,
      {
        tool: "calc_tx_unequal_appraisal",
        result: (result as { result: Record<string, unknown> }).result,
        audience: "summary",
      },
      freeAllowance().take,
      { transport: fake.transport, log: () => {} },
    );
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = a.body as { text: string; notice: string; label: string };
    assert.match(b.notice, /not a substitute for the advice of an attorney/);
    assert.ok(b.text.endsWith(b.notice));
    assert.ok(
      b.text.startsWith(
        "The median of the 3 adjusted comparable values is $950,000",
      ),
    );
    assert.equal(
      b.label,
      "Drafted by a model; figures verified by FactLot against calc_tx_unequal_appraisal@1",
    );
  });

  it("checks the result: a mismatched or foreign result is refused before any model call", async () => {
    const fake = fakeAnthropic([]);
    const allowance = freeAllowance();
    const real = (
      runTool("calc_npv", npvInput) as { result: Record<string, unknown> }
    ).result;
    const cases: [unknown, number, string][] = [
      [
        {
          tool: "calc_npv",
          input: npvInput,
          result: { ...real, value: { npv: 99 } },
          audience: "summary",
        },
        422,
        "ResultMismatch",
      ],
      [
        { tool: "calc_irr", result: real, audience: "summary" },
        400,
        "InputError",
      ],
      [
        { tool: "calc_nope", result: real, audience: "summary" },
        400,
        "InputError",
      ],
      [{ tool: "calc_npv", result: real, audience: "poem" }, 400, "InputError"],
      [
        { tool: "registry_get", input: { urn: "x" }, audience: "summary" },
        400,
        "InputError",
      ],
    ];
    for (const [args, status, error] of cases) {
      const a = await reportNarrative(KEY, args, allowance.take, {
        transport: fake.transport,
        log: () => {},
      });
      assert.equal(a.status, status, JSON.stringify(a.body));
      assert.equal(a.body.error, error);
    }
    assert.equal(fake.requests.length, 0);
    assert.equal(allowance.log.charged, 0);
  });

  it("the word limit drops whole sentences from the end", () => {
    const facts = resultFacts({ v: 17.63 });
    const v = verifyProse(
      [
        "Alpha bravo charlie delta echo.",
        "Foxtrot golf hotel india juliet kilo.",
      ],
      facts,
      { keepUnverified: false, maxWords: 6 },
    );
    assert.equal(v.text, "Alpha bravo charlie delta echo.");
    assert.equal(v.truncated, true);
  });

  it("figures: formatting-aware matching", () => {
    const facts = resultFacts({
      value: { npv: 1234567.891, rate: 0.065, ends: "2031-06-30", n: 5 },
      law: [{ section: "Tex. Tax Code §41.43(b)(3)" }],
    });
    const ok = (s: string) =>
      extractFigures(s).every((f) => figureMatches(f, facts));
    for (const s of [
      "$1,234,567.89",
      "1234567.89",
      "$1.23 million",
      "$1,235K",
      "6.5%",
      "6.50 percent",
      "0.065",
      "June 30, 2031",
      "30 June 2031",
      "6/30/2031",
      "2031-06-30",
      "June 2031",
      "2031",
      "five",
      "§41.43(b)(3)",
    ])
      assert.ok(ok(s), s);
    for (const s of [
      "$1,234,568.89",
      "7.5%",
      "June 29, 2031",
      "2030",
      "six",
      "§41.45",
    ])
      assert.ok(!ok(s), s);
  });

  it("advice and valuation wording, with negations allowed", () => {
    assert.deepEqual(adviceIn("The median is $990,000."), []);
    assert.deepEqual(
      adviceIn("This is not an appraisal or an opinion of value."),
      [],
    );
    assert.ok(adviceIn("You should protest.").length > 0);
    assert.ok(adviceIn("We recommend a protest.").length > 0);
    assert.ok(adviceIn("It is worth protesting.").length > 0);
    assert.ok(
      adviceIn("This figure represents an appraisal of the site.").length > 0,
    );
    assert.ok(adviceIn("It is an opinion of value.").length > 0);
    assert.deepEqual(
      adviceIn("The appraisal district's value is $1,000,000."),
      [],
    );
  });
});

describe("tool definitions", () => {
  it("doc_extract_lease lists every catalog predicate and needs a document", () => {
    const s = EXTRACT_LEASE_TOOL.inputSchema;
    assert.deepEqual(s.required, ["document"]);
    assert.equal(s.properties.predicates.items.enum.length, 30);
  });

  it("the extraction schema stays inside the structured-output limits", () => {
    let optional = 0;
    let unions = 0;
    const walk = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      if (o.properties) {
        const req = new Set((o.required as string[]) ?? []);
        optional += Object.keys(o.properties).filter((k) => !req.has(k)).length;
        assert.equal(o.additionalProperties, false);
      }
      if (o.anyOf || Array.isArray(o.type)) unions++;
      for (const k of ["minLength", "maxLength", "minimum", "maximum"])
        assert.equal(k in o, false, k);
      Object.values(o).forEach(walk);
    };
    walk(extractionSchema());
    assert.equal(optional, 0);
    assert.equal(unions, 0);
  });
});
