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
 */
import {
  EXTRACT_LEASE,
  EXTRACT_LEASE_TOOL,
  extractLease,
  type ChargedAllowance,
  type ToolAnswer,
} from "./ingest.ts";
import { modelSubject, type ModelCounter } from "./limiter.ts";
import { modelEnabled, modelUnavailable, type ModelDeps } from "./model.ts";
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

/** Request bodies for these tools may carry a 20 MB PDF as base64 (about 27 MB) plus JSON. */
export const MODEL_MAX_BODY_BYTES = 28 * 1024 * 1024;

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
    refund: () => giveBack(n),
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
  if (!modelEnabled(env)) return modelUnavailable(name);
  if (!caller || COUNTERS[name]!.limit(caller.plan) <= 0)
    return planRequired(name);
  const now = deps.now ?? Date.now;
  if (name === EXTRACT_LEASE)
    return extractLease(
      env,
      args,
      (pages) => take(env, name, caller, pages, now()),
      deps,
    );
  return reportNarrative(
    env,
    args,
    () => take(env, name, caller, 1, now()),
    deps,
  );
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/** Read a body of at most `max` bytes; undefined when longer. */
async function readCapped(
  request: Request,
  max: number,
): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? "0") > max)
    return undefined;
  const buf = new Uint8Array(await request.arrayBuffer());
  return buf.byteLength > max ? undefined : new TextDecoder().decode(buf);
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
      next: "send a smaller PDF (at most 20 MB), a URL to it, or the page text",
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
