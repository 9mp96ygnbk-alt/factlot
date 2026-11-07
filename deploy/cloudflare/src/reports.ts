/**
 * Hosted reports: client-ready XLSX, PDF and ICS documents built from FactLot tool results by
 * @factlot/reports (no model involved). Two ways in, both metered against the plan's
 * reports_per_month:
 *
 *   MCP   report_create   listed in tools/list for every caller, answered here (never by the
 *                        inner handler)
 *   REST  POST /v1/reports  { kind, format, input?, arguments?, context?, inline? }
 *
 * The answer is { download_url, expires_at, bytes, sha256, filename, ... }. The file is kept in
 * KV under the SHA-256 of a random 256-bit token for 24 hours (KV's expiry, and an expiry time
 * checked on every read) and served by GET /v1/reports/d/<token> with no-store. Nothing else is
 * kept. With inline: true a file under 1 MiB also comes back as base64 (an embedded resource over
 * MCP).
 *
 * Quota: without a key, per IP address per calendar month (a month-salted hash, `ipm:`), with a
 * key per subscription per month. A used-up month is refused before any work. The request is
 * then checked (input errors are free), the report is charged, and only then is the file built:
 * a build that is killed (CPU or memory limit) stays charged, so it cannot be repeated for free.
 * A failure this code sees (a size limit, a fault in the engine, the store) gives the report
 * back, as the registry gives back unanswered lookups.
 */
import {
  MAX_REPORT_BYTES,
  ReportInputError,
  prepareReport,
  renderReport,
  reportRequestJsonSchema,
  type PreparedReport,
  type ReportFile,
} from "@factlot/reports";

import { CONTACT, json } from "./billing.ts";
import { hashKey, randomToken } from "./keys.ts";
import {
  PLANS,
  PRICING_URL,
  REPORTS_PER_MONTH,
  REPORT_DOWNLOAD_HOURS,
  type Tier,
} from "./plans.ts";
import type { Env, QuotaSpec, QuotaState } from "./types.ts";

export const REPORT_TOOL_NAME = "report_create";

/** Reports are open only when the deployer sets REPORTS_ENABLED to "true" (a kill switch while the engine is reviewed). */
export function reportsEnabled(env: Pick<Env, "REPORTS_ENABLED">): boolean {
  return env.REPORTS_ENABLED === "true";
}

/** Seconds a stored report lives. */
export const REPORT_TTL_SECONDS = REPORT_DOWNLOAD_HOURS * 60 * 60;
/** Largest file returned inline (base64). */
export const INLINE_MAX_BYTES = 1024 * 1024;
export const DOWNLOAD_PATH = "/v1/reports/d/";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const REPORT_QUOTA_HEADERS = [
  "x-factlot-reports-quota-limit",
  "x-factlot-reports-quota-remaining",
  "x-factlot-reports-quota-reset",
];

/** The MCP tool definition, listed for every caller (hosted only; not in the open catalog). */
export const REPORT_TOOL = {
  name: REPORT_TOOL_NAME,
  title: "Create a client-ready report (XLSX, PDF, ICS)",
  description:
    "Hosted FactLot tool (api.factlot.com only). Builds a client-ready document by code, with no model: tx_unequal_appraisal (calc_tx_unequal_appraisal: evidence packet PDF or adjustment-grid workbook with live formulas; send registry_tx_equity_candidates' sources as context.sources to print each cited source's as-of date, URL and rights), lease_abstract (doc_abstract_lease), cam_reconciliation (calc_cam_reconciliation or _batch), debt_sizing (calc_debt_sizing), asc842_schedule (calc_lease_remeasurement_asc842), compare_proposals (calc_compare_proposals), dcf_summary (calc_dcf_pro_forma), critical_dates (calc_critical_dates; also ics: a calendar with each notice window and deadline dated on its contractual day and a reminder 30 days before; dates before today are left out unless include_past is true), tx_protest_deadline (rules_tx_property_tax_protest_deadline on tax_year, notice_delivered_date?, as_of?, or the _batch rule when arguments has items: ics, one calendar with each notice's statutory filing deadline and conservative file-by date as all-day events, reminders 30 and 7 days before the file-by date, the rule's basis, status, warnings and notes in each description, and the rule's next_season dates when the requested year has passed; or pdf, a deadline sheet). Every kind but lease_abstract requires the tool's arguments: FactLot runs the tool on them and builds the document from that run only, so its numbers are FactLot's results; a result sent as input is not used (the answer's result_mismatch says whether it differs). lease_abstract takes doc_abstract_lease's arguments, or its result as input: built from a supplied result, every page says the abstract values are as supplied by the caller and FactLot did not recompute them. Caller text (title, prepared_for, citation locators, comparable ids, labels and reasons, tx_protest_deadline item ids) is printed as supplied by the caller; advice or valuation wording in it is refused (TextNotAllowed). One report per request (one report_create per MCP batch). Returns download_url (works 24 hours), expires_at, bytes, sha256, filename and billed (true when this request counted against the month; every refusal has billed: false); inline: true also returns files under 1 MiB as base64. Counts against reports_per_month (free: 3 a month per IP address; Pro 50; Team 1,000); input errors are free.",
  inputSchema: (() => {
    const s = reportRequestJsonSchema() as {
      properties: Record<string, unknown>;
    };
    s.properties.inline = {
      type: "boolean",
      default: false,
      description:
        "Also return the file as base64 (an embedded resource) when it is under 1 MiB.",
    };
    return s;
  })(),
  annotations: {
    title: "Create a report",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

/** KV with the binary values and metadata Workers KV supports. */
interface BinaryKV {
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  getWithMetadata<M>(
    key: string,
    type: "arrayBuffer",
  ): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
}

interface StoredMeta {
  content_type: string;
  filename: string;
  expires_at: string;
  sha256: string;
}

/** Who is asking, for the quota. */
export interface ReportCaller {
  tier: Tier;
  /** The meter subject: `sub:<subscription>` with a key, `ipm:<hash>` without. */
  subject: () => Promise<string>;
}

export interface ReportOptions {
  apiBase: string;
  now: () => number;
}

function quotaSpec(tier: Tier): QuotaSpec {
  return {
    kind: "month",
    limit: REPORTS_PER_MONTH[tier],
    n: 1,
    counter: "reports",
  };
}

export function reportQuotaHeaders(q: QuotaState): Record<string, string> {
  return {
    "x-factlot-reports-quota-limit": String(q.limit),
    "x-factlot-reports-quota-remaining": String(q.remaining),
    "x-factlot-reports-quota-reset": q.resets_at,
  };
}

/** The ReportQuotaExceeded error object (REST body and MCP tool error alike). */
export function reportQuotaError(q: QuotaState, tier: Tier, now: number) {
  const n = (x: number) => x.toLocaleString("en-US");
  const lift =
    tier === "anonymous"
      ? `A Pro key (${n(REPORTS_PER_MONTH.pro)} a month) or Team key (${n(REPORTS_PER_MONTH.team)} a month) lifts the cap: ${PRICING_URL}.`
      : tier === "pro"
        ? `Team (${n(REPORTS_PER_MONTH.team)} a month) lifts the cap: ${PRICING_URL}.`
        : `Team is the largest plan; for more, email ${CONTACT}.`;
  const who =
    tier === "anonymous"
      ? `The free reports for this month are used up: ${n(q.limit)} a month per IP address.`
      : `This subscription's ${n(q.limit)} reports for the month (${PLANS[tier].name}) are used up.`;
  return {
    error: "ReportQuotaExceeded",
    code: "ReportQuotaExceeded",
    message: `${who} They reset at ${q.resets_at}. ${lift} Every other tool keeps working.`,
    next:
      tier === "team"
        ? `wait until ${q.resets_at}, or email ${CONTACT}`
        : `wait until ${q.resets_at}, or upgrade: ${PRICING_URL}`,
    limit: q.limit,
    used: q.used,
    resets_at: q.resets_at,
    retry_after_seconds: Math.max(
      1,
      Math.ceil((Date.parse(q.resets_at) - now) / 1000),
    ),
    upgrade: PRICING_URL,
    issues: [] as unknown[],
  };
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type ReportOutcome =
  | {
      ok: true;
      body: Record<string, unknown>;
      quota: QuotaState;
      file: ReportFile;
      base64?: string;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
      quota?: QuotaState;
    };

const UNAVAILABLE: ReportOutcome = {
  ok: false,
  status: 503,
  body: {
    error: "ServiceUnavailable",
    code: "ServiceUnavailable",
    message:
      "the report quota or storage is briefly unavailable, so nothing was charged; retry in a few seconds.",
    retry_after_seconds: 5,
    next: "retry after 5 seconds",
  },
};

const FAILED: ReportOutcome = {
  ok: false,
  status: 500,
  body: {
    error: "ReportFailed",
    code: "ReportFailed",
    message:
      "FactLot could not build this report (a fault on our side, not in the request). Nothing was charged.",
    next: `retry once; if it fails again, email ${CONTACT}`,
    issues: [],
  },
};

class Unavailable extends Error {}

/** A meter or KV call; a failure becomes a 503 (nothing charged that was not given back). */
async function infra<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch {
    throw new Unavailable("infra");
  }
}

function inputError(err: ReportInputError): ReportOutcome {
  return {
    ok: false,
    status:
      err.code === "TooLarge" ? 413 : err.code === "TextNotAllowed" ? 422 : 400,
    body: {
      error: err.code,
      code: err.code,
      message: err.message,
      issues: err.issues,
      next:
        err.next ??
        (err.code === "ArgumentsRequired"
          ? "send the tool's arguments as arguments (the same arguments you called the tool with)"
          : err.code === "FormulaVersion"
            ? "call the tool again and send its result unchanged (or send its arguments)"
            : err.code === "NotAToolResult"
              ? "send the tool's result exactly as it was returned, or send the tool's arguments instead"
              : err.code === "TextNotAllowed"
                ? "remove the advice or valuation wording from the fields listed in issues and retry"
                : "fix the fields listed in issues and retry"),
    },
  };
}

/**
 * Build, store and charge one report. `request` is the parsed body (or MCP arguments). Never
 * throws for bad input; a failing meter or store throws (the router answers 503).
 */
export async function runReport(
  env: Env,
  caller: ReportCaller,
  request: unknown,
  o: ReportOptions,
): Promise<ReportOutcome> {
  const out = await runReportInner(env, caller, request, o);
  // Every answer says whether it counted against the month: only a stored build does.
  return { ...out, body: { ...out.body, billed: out.ok } } as ReportOutcome;
}

async function runReportInner(
  env: Env,
  caller: ReportCaller,
  request: unknown,
  o: ReportOptions,
): Promise<ReportOutcome> {
  try {
    return await buildAndStore(env, caller, request, o);
  } catch (err) {
    if (err instanceof Unavailable) {
      console.error(
        JSON.stringify({ msg: "reports: meter or store unavailable" }),
      );
      return UNAVAILABLE;
    }
    // A fault in the engine: the caller gets no internal detail, and the log only its name.
    console.error(
      JSON.stringify({
        msg: "reports: build failed",
        error: err instanceof Error ? err.name : typeof err,
      }),
    );
    return FAILED;
  }
}

/** Give one charged report back; a failure to do so is logged, never thrown. */
async function refundReport(
  env: Env,
  subject: string,
  quota: QuotaState,
): Promise<void> {
  try {
    await env.METER.refund(subject, "month", 1, quota.resets_at, "reports");
  } catch {
    console.error(JSON.stringify({ msg: "reports: refund failed" }));
  }
}

async function buildAndStore(
  env: Env,
  caller: ReportCaller,
  request: unknown,
  o: ReportOptions,
): Promise<ReportOutcome> {
  if (typeof request !== "object" || request === null || Array.isArray(request))
    return inputError(
      new ReportInputError(
        "InputError",
        "send a JSON object: { kind, format, input, arguments?, context?, inline? }",
      ),
    );
  const { inline, ...rest } = request as Record<string, unknown>;
  if (inline !== undefined && typeof inline !== "boolean")
    return inputError(
      new ReportInputError("InputError", "inline must be true or false", [
        { path: "inline", message: "expected a boolean" },
      ]),
    );
  const subject = await caller.subject();
  const spec = quotaSpec(caller.tier);
  // Refuse at once when the month is used up, before any work.
  const before = await infra(
    env.METER.quota(subject, "month", spec.limit, "reports"),
  );
  if (before.remaining <= 0)
    return {
      ok: false,
      status: 429,
      body: reportQuotaError(before, caller.tier, o.now()),
      quota: before,
    };
  let prepared: PreparedReport;
  try {
    prepared = prepareReport(rest, { now: o.now() });
  } catch (err) {
    // The quota is known here, so a refused request carries the quota headers too.
    if (err instanceof ReportInputError)
      return { ...inputError(err), quota: before } as ReportOutcome;
    throw err;
  }
  // Charge before building: a build the runtime kills is not free.
  const charged = await infra(env.METER.consume(subject, spec));
  if (charged.granted < 1 || !charged.quota)
    return {
      ok: false,
      status: 429,
      body: reportQuotaError(charged.quota ?? before, caller.tier, o.now()),
      ...(charged.quota ? { quota: charged.quota } : {}),
    };
  const quota = charged.quota;
  let file: ReportFile;
  try {
    file = await renderReport(prepared, { now: o.now() });
    if (file.bytes.byteLength > MAX_REPORT_BYTES)
      throw new ReportInputError("TooLarge", "the report is over 25 MiB");
  } catch (err) {
    await refundReport(env, subject, quota);
    if (err instanceof ReportInputError)
      return {
        ...inputError(err),
        quota: {
          ...quota,
          used: quota.used - 1,
          remaining: quota.remaining + 1,
        },
      } as ReportOutcome;
    throw err;
  }
  const token = randomToken();
  const sha256 = hex(
    await crypto.subtle.digest("SHA-256", file.bytes as unknown as ArrayBuffer),
  );
  const expiresAt = new Date(o.now() + REPORT_TTL_SECONDS * 1000).toISOString();
  const meta: StoredMeta = {
    content_type: file.content_type,
    filename: file.filename,
    expires_at: expiresAt,
    sha256,
  };
  try {
    const copy = file.bytes.slice().buffer as ArrayBuffer;
    await (env.KEYS as unknown as BinaryKV).put(
      `report:${await hashKey(token)}`,
      copy,
      { expirationTtl: REPORT_TTL_SECONDS, metadata: meta },
    );
  } catch {
    // Not stored: give the report back.
    await refundReport(env, subject, quota);
    throw new Unavailable("store");
  }
  const body: Record<string, unknown> = {
    download_url: `${o.apiBase}${DOWNLOAD_PATH}${token}`,
    expires_at: expiresAt,
    bytes: file.bytes.byteLength,
    sha256,
    filename: file.filename,
    content_type: file.content_type,
    kind: file.kind,
    format: file.format,
    source: file.source,
    check: file.check,
    ...(file.result_mismatch !== undefined
      ? { result_mismatch: file.result_mismatch }
      : {}),
    generated_at: file.generated_at,
    reports: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      resets_at: quota.resets_at,
    },
  };
  let base64: string | undefined;
  if (inline === true) {
    if (file.bytes.byteLength < INLINE_MAX_BYTES) base64 = toBase64(file.bytes);
    else body.inline_omitted = "the file is 1 MiB or more; use download_url";
  }
  return { ok: true, body, quota, file, ...(base64 ? { base64 } : {}) };
}

/** POST /v1/reports. */
export async function reportsRest(
  request: Request,
  env: Env,
  caller: ReportCaller,
  o: ReportOptions & { maxBodyBytes: number },
): Promise<Response> {
  if (request.method !== "POST")
    return json(
      405,
      {
        error: "MethodNotAllowed",
        code: "MethodNotAllowed",
        message: "use POST for /v1/reports",
        next: "POST /v1/reports",
      },
      { allow: "POST" },
    );
  if (Number(request.headers.get("content-length") ?? "0") > o.maxBodyBytes)
    return json(413, {
      error: "PayloadTooLarge",
      code: "PayloadTooLarge",
      message: "request body over 1 MB",
    });
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > o.maxBodyBytes)
    return json(413, {
      error: "PayloadTooLarge",
      code: "PayloadTooLarge",
      message: "request body over 1 MB",
    });
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return json(400, {
      error: "InputError",
      code: "InputError",
      message: "the body is not JSON",
      issues: [],
      next: "send a JSON object: { kind, format, input, arguments?, context?, inline? }",
    });
  }
  const out = await runReport(env, caller, body, o);
  const headers = out.quota ? reportQuotaHeaders(out.quota) : {};
  if (!out.ok) {
    if (out.status === 429 || out.status === 503)
      headers["retry-after"] = String(out.body.retry_after_seconds ?? 60);
    return json(out.status, out.body, headers);
  }
  return json(
    201,
    out.base64 ? { ...out.body, content_base64: out.base64 } : out.body,
    headers,
  );
}

/**
 * Requests that already build a report. The router makes one ReportOptions object per HTTP
 * request and passes it to every report_create call of an MCP batch, so it names the request:
 * the first call claims it (synchronously, before any await) and the others are refused, which
 * keeps one request from building a batch's worth of documents at once.
 */
const claimed = new WeakSet<ReportOptions>();

export const ONE_REPORT_PER_REQUEST = {
  error: "OneReportPerRequest",
  code: "OneReportPerRequest",
  message:
    "one report per request: this MCP batch already has a report_create call, so this one was not run and nothing was charged.",
  next: "send each report_create in its own request",
  issues: [] as unknown[],
};

/** The answer to one report_create MCP call (a JSON-RPC message). */
export async function answerReportCall(
  env: Env,
  caller: ReportCaller,
  message: { id: string | number; params?: { arguments?: unknown } },
  o: ReportOptions,
): Promise<unknown> {
  if (claimed.has(o))
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(ONE_REPORT_PER_REQUEST, null, 2),
          },
        ],
      },
    };
  claimed.add(o);
  const out = await runReport(env, caller, message.params?.arguments ?? {}, o);
  if (!out.ok)
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(out.body, null, 2) }],
      },
    };
  const content: unknown[] = [
    { type: "text", text: JSON.stringify(out.body, null, 2) },
  ];
  if (out.base64)
    content.push({
      type: "resource",
      resource: {
        uri: String(out.body.download_url),
        mimeType: out.file.content_type,
        blob: out.base64,
      },
    });
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: { content, structuredContent: out.body },
  };
}

/** A tools/call of report_create that expects an answer. */
export function isReportCall(item: unknown): item is {
  id: string | number;
  params: { name: string; arguments?: unknown };
} {
  if (typeof item !== "object" || item === null) return false;
  const { id, method, params } = item as {
    id?: unknown;
    method?: unknown;
    params?: { name?: unknown } | null;
  };
  return (
    method === "tools/call" &&
    (typeof id === "string" || typeof id === "number") &&
    params?.name === REPORT_TOOL_NAME
  );
}

function notFound(): Response {
  return json(404, {
    error: "NotFound",
    code: "NotFound",
    message: `no report at this link: it is unknown or older than ${REPORT_DOWNLOAD_HOURS} hours (links expire)`,
    next: "create the report again (POST /v1/reports or report_create)",
  });
}

/** Content-Disposition with an ASCII fallback and the RFC 5987 form. */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * GET /v1/reports/d/<token>: the stored file. The caller's limits (per token and per address)
 * are applied by the router before this runs; `now` checks the expiry KV may not have applied yet.
 */
export async function reportDownload(
  request: Request,
  env: Env,
  token: string,
  now: number,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json(
      405,
      {
        error: "MethodNotAllowed",
        code: "MethodNotAllowed",
        message: "GET this URL",
        next: "GET",
      },
      { allow: "GET, HEAD" },
    );
  if (!TOKEN_RE.test(token)) return notFound();
  const kv = env.KEYS as unknown as BinaryKV;
  const { value, metadata } = await kv.getWithMetadata<StoredMeta>(
    `report:${await hashKey(token)}`,
    "arrayBuffer",
  );
  if (!value || !metadata || Date.parse(metadata.expires_at) <= now)
    return notFound();
  return new Response(request.method === "HEAD" ? null : value, {
    headers: {
      "content-type": metadata.content_type,
      "content-disposition": disposition(metadata.filename),
      "content-length": String(value.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-factlot-report-sha256": metadata.sha256,
      expires: new Date(Date.parse(metadata.expires_at)).toUTCString(),
    },
  });
}

/** The token's limiter key: named by a hash of the token, never the token. */
export async function downloadLimitKey(token: string): Promise<string> {
  return `reportdl:${(await hashKey(token)).slice(0, 32)}`;
}
