/**
 * Router glue for the two model-backed hosted tools: who may call them, their monthly
 * allowances, the REST routes and the MCP answers. The tools themselves are ingest.ts
 * (doc_extract_lease) and narrative.ts (report_narrative); the model client is model.ts.
 *
 *   POST /v1/doc/extract_lease    doc_extract_lease
 *   POST /v1/report/narrative     report_narrative
 *
 * Both are listed in MCP tools/list only for a Pro or Team key while ANTHROPIC_API_KEY is set.
 * Without the secret both routes (and MCP calls) answer 503 ModelUnavailable.
 *
 * Per subscription, across both tools: at most 2 calls in flight and 6 started a minute (429
 * ModelRateLimited with retry_after_seconds), and a failed call's charge is given back for the
 * first 5 failures of a UTC day only (the 6th and later are charged), so failures cannot be
 * used to run the model for free.
 */
import {
  EXTRACT_LEASE,
  EXTRACT_LEASE_TOOL,
  extractLease,
  type ChargedAllowance,
  type ToolAnswer,
} from "./ingest.ts";
import { modelGate, modelSubject, type ModelCounter } from "./limiter.ts";
import {
  MODEL_BUDGETS,
  modelEnabled,
  modelUnavailable,
  type ModelDeps,
} from "./model.ts";
import { countEvent } from "./usage.ts";
import {
  REPORT_NARRATIVE,
  REPORT_NARRATIVE_TOOL,
  reportNarrative,
} from "./narrative.ts";
import { MODEL_ALLOWANCES, PRICING_URL, type PlanId } from "./plans.ts";
import type { Env, QuotaState } from "./types.ts";

export const MODEL_TOOL_NAMES = new Set([EXTRACT_LEASE, REPORT_NARRATIVE]);

export const MODEL_PATHS = new Map([
  ["/v1/doc/extract_lease", EXTRACT_LEASE],
  ["/v1/report/narrative", REPORT_NARRATIVE],
]);

/** Request bodies for these tools may carry a 5 MB PDF as base64 (about 6.7 MB) plus JSON. */
export const MODEL_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** The per-subscription call gate (both tools together). */
export const MODEL_CALL_LIMITS = {
  /** Calls in flight at once. */
  concurrent: 2,
  /** Calls started per minute. */
  perMinute: 6,
  /** Failed calls a UTC day whose charge is given back; later failures are charged. */
  refundedFailuresPerDay: 5,
  /** A slot expires on its own after the longest deadline plus a margin (a lost release). */
  slotTtlMs: MODEL_BUDGETS.extraction.timeoutMs + 30_000,
} as const;

/** Model-backed calls answered per MCP request; further ones get an error to send separately. */
export const MAX_MODEL_CALLS_PER_REQUEST = 2;

/** A paid caller (a live, active key): its plan and its meter subject (`sub:<id>`). */
export interface ModelCaller {
  plan: PlanId;
  subject: string;
}

/** The tool definitions tools/list adds for this caller (none while the feature is off). */
export function modelToolsFor(
  env: Pick<Env, "ANTHROPIC_API_KEY">,
  caller: ModelCaller | undefined,
): unknown[] {
  if (!caller || !modelEnabled(env)) return [];
  const a = MODEL_ALLOWANCES[caller.plan];
  return [
    ...(a.ingest_pages_per_month > 0 ? [EXTRACT_LEASE_TOOL] : []),
    ...(a.narratives_per_month > 0 ? [REPORT_NARRATIVE_TOOL] : []),
  ];
}

const COUNTERS: Record<
  string,
  { counter: ModelCounter; limit: (p: PlanId) => number; unit: string }
> = {
  [EXTRACT_LEASE]: {
    counter: "ingest_pages",
    limit: (p) => MODEL_ALLOWANCES[p].ingest_pages_per_month,
    unit: "pages",
  },
  [REPORT_NARRATIVE]: {
    counter: "narratives",
    limit: (p) => MODEL_ALLOWANCES[p].narratives_per_month,
    unit: "narratives",
  },
};

function planRequired(tool: string): ToolAnswer {
  const c = COUNTERS[tool]!;
  return {
    status: 403,
    body: {
      error: "PlanRequired",
      code: "PlanRequired",
      message: `${tool} calls a model, so it is part of the paid plans only: Pro (${c.limit("pro").toLocaleString("en-US")} ${c.unit} a month) and Team (${c.limit("team").toLocaleString("en-US")} ${c.unit} a month). Every other FactLot tool stays free.`,
      next: `send a Pro or Team key as Authorization: Bearer <key> (${PRICING_URL})${tool === EXTRACT_LEASE ? ", or extract with your own model and check the values with doc_verify_facts (free)" : ""}`,
      upgrade: PRICING_URL,
    },
  };
}

function quotaExceeded(
  tool: string,
  plan: PlanId,
  q: QuotaState,
  wanted: number,
  now: number,
): ToolAnswer {
  const c = COUNTERS[tool]!;
  const retry = Math.max(1, Math.ceil((Date.parse(q.resets_at) - now) / 1000));
  const error =
    tool === EXTRACT_LEASE ? "IngestQuotaExceeded" : "NarrativeQuotaExceeded";
  return {
    status: 429,
    body: {
      error,
      code: error,
      message: `this call needs ${wanted} ${c.unit} and the subscription has ${q.remaining} of ${q.limit.toLocaleString("en-US")} left this month; they reset at ${q.resets_at}. ${plan === "pro" ? `Team includes ${c.limit("team").toLocaleString("en-US")} a month.` : "Team is the largest plan."} Every other tool keeps working.`,
      next:
        plan === "pro"
          ? `wait until ${q.resets_at}, or upgrade: ${PRICING_URL}`
          : `wait until ${q.resets_at}, or email contact@factlot.com`,
      limit: q.limit,
      used: q.used,
      remaining: q.remaining,
      resets_at: q.resets_at,
      retry_after_seconds: retry,
    },
  };
}

const meterDown: ToolAnswer = {
  status: 503,
  body: {
    error: "ServiceUnavailable",
    code: "ServiceUnavailable",
    message:
      "the usage meter is briefly unavailable, so the request was not run; retry in a few seconds.",
    retry_after_seconds: 5,
    next: "retry after 5 seconds",
  },
};

function rateLimited(
  why: "concurrent" | "minute",
  retryAfter: number,
): ToolAnswer {
  const retry = Math.max(1, Math.ceil(retryAfter));
  return {
    status: 429,
    body: {
      error: "ModelRateLimited",
      code: "ModelRateLimited",
      message:
        why === "concurrent"
          ? `${MODEL_CALL_LIMITS.concurrent} model-backed calls are already running for this subscription (at most ${MODEL_CALL_LIMITS.concurrent} at once); this one did not run and nothing was counted.`
          : `this subscription started ${MODEL_CALL_LIMITS.perMinute} model-backed calls in the last minute (at most ${MODEL_CALL_LIMITS.perMinute} a minute); this one did not run and nothing was counted.`,
      retry_after_seconds: retry,
      next: `retry after ${retry} seconds${why === "concurrent" ? ", once a running call has finished" : ""}`,
    },
  };
}

/**
 * Give a failed call's charge back unless the subscription already had its refunded failures
 * today; true when it was given back. Meter errors give it back (the customer's favour).
 */
async function refundAllowed(env: Env, caller: ModelCaller): Promise<boolean> {
  try {
    const hit = await env.METER.consume(
      modelSubject("model_failures", caller.subject),
      {
        kind: "day",
        limit: MODEL_CALL_LIMITS.refundedFailuresPerDay,
        n: 1,
      },
    );
    return hit.granted > 0;
  } catch {
    return true;
  }
}

/** Take `n` from the caller's allowance for `tool`: the charge (refundable) or the refusal. */
async function take(
  env: Env,
  tool: string,
  caller: ModelCaller,
  n: number,
  now: number,
): Promise<ChargedAllowance | ToolAnswer> {
  const c = COUNTERS[tool]!;
  const subject = modelSubject(c.counter, caller.subject);
  const spec = { kind: "month" as const, limit: c.limit(caller.plan), n };
  let hit;
  try {
    hit = await env.METER.consume(subject, spec);
  } catch {
    return meterDown;
  }
  const q = hit.quota;
  if (!q) return meterDown;
  const giveBack = async (k: number) => {
    if (k <= 0) return;
    try {
      await env.METER.refund(subject, "month", k, q.resets_at);
    } catch {
      console.error(JSON.stringify({ msg: "model allowance refund failed" }));
    }
  };
  if (hit.granted < n) {
    await giveBack(hit.granted);
    return quotaExceeded(
      tool,
      caller.plan,
      {
        ...q,
        used: q.used - hit.granted,
        remaining: q.remaining + hit.granted,
      },
      n,
      now,
    );
  }
  return {
    quota: {
      [c.counter]: {
        used: q.used,
        limit: q.limit,
        remaining: q.remaining,
        resets_at: q.resets_at,
      },
    },
    refund: () => giveBack(n).then(() => true),
  };
}

/** `charged`, refundable once, within the daily cap of refunded failures. */
function capped(
  env: Env,
  caller: ModelCaller,
  charged: ChargedAllowance,
): ChargedAllowance {
  let settled: Promise<boolean> | undefined;
  return {
    quota: charged.quota,
    refund: (opts = {}) =>
      (settled ??= (async () => {
        if (!opts.internal && !(await refundAllowed(env, caller))) return false;
        await charged.refund();
        return true;
      })()),
  };
}

/** Run a model-backed tool for this caller: availability, plan and allowance first. */
export async function runModelTool(
  name: string,
  args: unknown,
  env: Env,
  caller: ModelCaller | undefined,
  deps: ModelDeps = {},
): Promise<ToolAnswer> {
  const answer = await runModelToolInner(name, args, env, caller, deps);
  const tier = caller?.plan ?? "anonymous";
  const code = (answer.body as { code?: unknown }).code;
  countEvent(env, "model_call", [
    name,
    answer.status < 300
      ? "ok"
      : code === "PlanRequired"
        ? "plan_required"
        : answer.status === 429
          ? "limited"
          : "error",
  ]);
  if (code === "PlanRequired")
    countEvent(env, "plan_required", ["model_tool", tier]);
  return answer;
}

async function runModelToolInner(
  name: string,
  args: unknown,
  env: Env,
  caller: ModelCaller | undefined,
  deps: ModelDeps = {},
): Promise<ToolAnswer> {
  if (!modelEnabled(env)) return modelUnavailable(name);
  if (!caller || COUNTERS[name]!.limit(caller.plan) <= 0)
    return planRequired(name);
  const now = deps.now ?? Date.now;

  // The call gate: a slot (calls in flight), then the minute count.
  const gate = modelGate(env.METER);
  if (!gate) return meterDown;
  const slotSubject = modelSubject("model_inflight", caller.subject);
  let slot;
  let minute;
  try {
    slot = await gate.acquireSlot(
      slotSubject,
      MODEL_CALL_LIMITS.concurrent,
      MODEL_CALL_LIMITS.slotTtlMs,
    );
  } catch {
    return meterDown;
  }
  if (!slot.ok || !slot.id) return rateLimited("concurrent", slot.retry_after);
  const slotId = slot.id;
  const release = () =>
    gate.releaseSlot(slotSubject, slotId).catch(() => {
      console.error(JSON.stringify({ msg: "model slot release failed" }));
    });
  try {
    minute = await env.METER.hit(
      modelSubject("model_calls", caller.subject),
      MODEL_CALL_LIMITS.perMinute,
    );
  } catch {
    await release();
    return meterDown;
  }
  if (!minute.ok) {
    await release();
    return rateLimited("minute", 60 - Math.floor((now() % 60_000) / 1000));
  }

  let charge: ChargedAllowance | undefined;
  const takeN = async (n: number) => {
    const c = await take(env, name, caller, n, now());
    if ("status" in c) return c;
    charge = capped(env, caller, c);
    return charge;
  };
  try {
    return name === EXTRACT_LEASE
      ? await extractLease(env, args, takeN, deps)
      : await reportNarrative(env, args, () => takeN(1), deps);
  } catch (err) {
    // Our own failure, not the caller's: give the charge back, outside the daily cap.
    await charge?.refund({ internal: true });
    throw err;
  } finally {
    await release();
  }
}

const jsonResponse = (status: number, body: Record<string, unknown>) => {
  const retry = body.retry_after_seconds;
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...((status === 429 || status === 503) && typeof retry === "number"
        ? { "retry-after": String(retry) }
        : {}),
    },
  });
};

/**
 * Read a body of at most `max` bytes, stopping as soon as it is longer (undefined then): a body
 * without content-length is never read past the limit.
 */
async function readCapped(
  request: Request,
  max: number,
): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? "0") > max)
    return undefined;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/** POST /v1/doc/extract_lease and POST /v1/report/narrative. */
export async function modelRestRoute(
  request: Request,
  env: Env,
  path: string,
  caller: ModelCaller | undefined,
  deps: ModelDeps = {},
): Promise<Response> {
  const name = MODEL_PATHS.get(path)!;
  if (request.method !== "POST")
    return new Response(
      JSON.stringify({
        error: "MethodNotAllowed",
        code: "MethodNotAllowed",
        message: `use POST for ${path}`,
        next: `POST ${path}`,
      }),
      {
        status: 405,
        headers: {
          allow: "POST",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  // Refuse before reading a large body when the tool cannot run for this caller.
  if (!modelEnabled(env)) {
    const a = modelUnavailable(name);
    return jsonResponse(a.status, a.body);
  }
  if (!caller) {
    const a = planRequired(name);
    return jsonResponse(a.status, a.body);
  }
  const text = await readCapped(request, MODEL_MAX_BODY_BYTES);
  if (text === undefined)
    return jsonResponse(413, {
      error: "PayloadTooLarge",
      code: "PayloadTooLarge",
      message: `request body over ${MODEL_MAX_BODY_BYTES / 1024 / 1024} MB`,
      next: "send a smaller PDF (at most 5 MB), a URL to it, or the page text",
    });
  let args: unknown;
  try {
    args = JSON.parse(text);
  } catch {
    return jsonResponse(400, {
      error: "InputError",
      code: "InputError",
      message: "invalid input: the body is not JSON",
      issues: [{ path: "(root)", message: "the body is not JSON" }],
    });
  }
  const a = await runModelTool(name, args, env, caller, deps);
  return jsonResponse(a.status, a.body);
}

/** A tools/call message for a model-backed tool. */
export function isModelCall(item: unknown): item is {
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
    typeof params?.name === "string" &&
    MODEL_TOOL_NAMES.has(params.name)
  );
}

/** The JSON-RPC answer to one model-backed tools/call (a tool error carries isError). */
export async function answerModelCall(
  env: Env,
  caller: ModelCaller | undefined,
  message: {
    id: string | number;
    params: { name: string; arguments?: unknown };
  },
  deps: ModelDeps = {},
  overLimit = false,
): Promise<unknown> {
  const a: ToolAnswer = overLimit
    ? {
        status: 400,
        body: {
          error: "TooManyModelCalls",
          code: "TooManyModelCalls",
          message: `at most ${MAX_MODEL_CALLS_PER_REQUEST} model-backed calls are answered per request`,
          next: "send this call in its own request",
        },
      }
    : await runModelTool(
        message.params.name,
        message.params.arguments ?? {},
        env,
        caller,
        deps,
      );
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: [{ type: "text", text: JSON.stringify(a.body, null, 2) }],
      structuredContent: a.body,
      ...(a.status >= 400 ? { isError: true } : {}),
    },
  };
}
