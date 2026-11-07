/**
 * The hosted API's only model client: Anthropic's Messages API over fetch, for the two opt-in
 * model-backed tools (doc_extract_lease in ingest.ts, report_narrative in narrative.ts). Every
 * other tool runs without a model, here and self-hosted.
 *
 * Rules this module keeps:
 * - Off unless the Worker secret ANTHROPIC_API_KEY is set: the tools are not listed and their
 *   routes answer 503 ModelUnavailable.
 * - One deadline per tool call (60 s by default) covers every attempt; a request that runs past it
 *   is aborted.
 * - Nothing the customer sent or the model returned is logged: `logModelCall` takes only counts,
 *   latencies and fixed outcome names, so no document text, quote, figure or prose can reach a log.
 * - The system prompt is sent as a cached block (prompt caching), so repeated calls pay the
 *   cache-read rate for it.
 */
import type { Env } from "./types.ts";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";
/** Server-side fallback on a policy decline (`fallbacks: "default"`); Claude API only. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Model ids. Haiku is reserved for cheap classification; no tool uses it today. */
export const MODEL_IDS = {
  extraction: "claude-sonnet-5-5",
  narrative: "claude-sonnet-5-5",
  classification: "claude-haiku-5-5",
} as const;

/** Per-call budgets. Effort `low` is the recommended start for extraction and short writing. */
export const MODEL_BUDGETS = {
  /** Wall time for one tool call, every attempt included. */
  timeoutMs: 60_000,
  extraction: { maxTokens: 12_000, effort: "low" },
  narrative: { maxTokens: 4_000, effort: "low" },
} as const;

/** Published prices (USD per million tokens) used for the cost estimates in the docs. */
export const MODEL_PRICES_PER_MTOK = {
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheWrite: 2.5,
    cacheRead: 0.2,
  },
} as const;

/** Whether the model-backed tools are on: the ANTHROPIC_API_KEY secret is set. */
export function modelEnabled(env: Pick<Env, "ANTHROPIC_API_KEY">): boolean {
  return (
    typeof env.ANTHROPIC_API_KEY === "string" &&
    env.ANTHROPIC_API_KEY.trim().length > 0
  );
}

/** What the transport returns: status, headers, and the parsed JSON body (undefined if none). */
export interface TransportResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/** One HTTP exchange with the Messages API. Tests pass a fake; production uses `fetchTransport`. */
export type ModelTransport = (
  body: Record<string, unknown>,
  init: { apiKey: string; signal: AbortSignal },
) => Promise<TransportResponse>;

export const fetchTransport: ModelTransport = async (body, init) => {
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": init.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": FALLBACK_BETA,
    },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  return { status: res.status, headers: res.headers, body: parsed };
};

/** Injected by the router (tests swap the transport, clock, deadline and document fetch). */
export interface ModelDeps {
  transport?: ModelTransport;
  now?: () => number;
  /** Override MODEL_BUDGETS.timeoutMs (tests). */
  timeoutMs?: number;
  /** fetch for `document.url` (tests). */
  fetchDocument?: typeof fetch;
  /** Where `logModelCall` writes (tests capture it); console.log by default. */
  log?: (line: string) => void;
}

export type ModelFailure =
  | "unavailable" // no key, or the key was refused
  | "rate_limited" // 429 from the provider
  | "overloaded" // 5xx / 529 after the one retry
  | "timeout" // the deadline passed
  | "refused" // stop_reason refusal
  | "truncated" // stop_reason max_tokens
  | "upstream"; // anything else (a 400, an unreadable answer)

export class ModelError extends Error {
  readonly kind: ModelFailure;
  readonly retryAfterSeconds?: number;
  constructor(kind: ModelFailure, retryAfterSeconds?: number) {
    super(kind);
    this.name = "ModelError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ModelReply {
  /** The text blocks of the answer, joined. */
  text: string;
  /** The model that answered (a server-side fallback can name another). */
  model: string;
  usage: Usage;
}

export function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens:
      a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
  };
}

/** The `model` object a tool returns: every input token counted (cached ones included). */
export function modelSummary(id: string, usage: Usage) {
  return {
    id,
    input_tokens:
      usage.input_tokens +
      usage.cache_read_input_tokens +
      usage.cache_creation_input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
  };
}

export interface ModelRequest {
  model: string;
  /** Fixed instructions: sent as one cached system block. Never put request data here. */
  system: string;
  /** The user turn (request data). */
  user: string;
  /** JSON Schema for structured output (output_config.format). */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

/** A deadline-bound session: every attempt of one tool call shares `deadline`. */
export interface ModelSession {
  call(req: ModelRequest): Promise<ModelReply>;
  /** Usage of every attempt so far, the failed ones included. */
  usage(): Usage;
  attempts(): number;
  deadline: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function usageOf(body: unknown): Usage {
  const u = (body as { usage?: Record<string, unknown> } | undefined)?.usage;
  return {
    input_tokens: num(u?.input_tokens),
    output_tokens: num(u?.output_tokens),
    cache_read_input_tokens: num(u?.cache_read_input_tokens),
    cache_creation_input_tokens: num(u?.cache_creation_input_tokens),
  };
}

function retryAfter(headers: Headers): number | undefined {
  const v = Number(headers.get("retry-after") ?? "");
  return Number.isFinite(v) && v > 0 ? Math.ceil(v) : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a session for one tool call. Each `call` is one Messages request, retried once on a 5xx or
 * 529 when at least 10 seconds of the deadline remain. A 429 is not retried here: the caller is
 * told when to come back.
 */
export function modelSession(
  env: Pick<Env, "ANTHROPIC_API_KEY">,
  deps: ModelDeps = {},
): ModelSession {
  const now = deps.now ?? Date.now;
  const transport = deps.transport ?? fetchTransport;
  const deadline = now() + (deps.timeoutMs ?? MODEL_BUDGETS.timeoutMs);
  let total = emptyUsage();
  let attempts = 0;
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";

  async function once(body: Record<string, unknown>): Promise<ModelReply> {
    const remaining = deadline - now();
    if (remaining <= 0) throw new ModelError("timeout");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remaining);
    attempts++;
    let res: TransportResponse;
    try {
      res = await Promise.race([
        transport(body, { apiKey, signal: controller.signal }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(new ModelError("timeout")),
          ),
        ),
      ]);
    } catch (err) {
      if (timedOut || err instanceof ModelError)
        throw new ModelError("timeout");
      throw new ModelError("upstream");
    } finally {
      clearTimeout(timer);
    }
    total = addUsage(total, usageOf(res.body));
    if (res.status === 401 || res.status === 403)
      throw new ModelError("unavailable");
    if (res.status === 429)
      throw new ModelError("rate_limited", retryAfter(res.headers) ?? 30);
    if (res.status >= 500)
      throw new ModelError("overloaded", retryAfter(res.headers) ?? 10);
    if (res.status !== 200) throw new ModelError("upstream");
    const b = res.body as {
      model?: unknown;
      stop_reason?: unknown;
      content?: { type?: unknown; text?: unknown }[];
    };
    if (b?.stop_reason === "refusal") throw new ModelError("refused");
    if (b?.stop_reason === "max_tokens") throw new ModelError("truncated");
    const text = (Array.isArray(b?.content) ? b.content : [])
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
    return {
      text,
      model: typeof b?.model === "string" ? b.model : String(body.model),
      usage: usageOf(res.body),
    };
  }

  return {
    deadline,
    usage: () => total,
    attempts: () => attempts,
    async call(req) {
      if (!apiKey) throw new ModelError("unavailable");
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        system: [
          {
            type: "text",
            text: req.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: req.user }],
        output_config: {
          effort: req.effort,
          format: { type: "json_schema", schema: req.schema },
        },
        fallbacks: "default",
      };
      try {
        return await once(body);
      } catch (err) {
        if (
          err instanceof ModelError &&
          err.kind === "overloaded" &&
          deadline - now() > 10_000
        ) {
          await sleep(500);
          return once(body);
        }
        throw err;
      }
    },
  };
}

/** The one log line a model-backed call writes: numbers and fixed names only, never content. */
export interface ModelLogEvent {
  tool: "doc_extract_lease" | "report_narrative";
  outcome: "ok" | ModelFailure | "invalid_output" | "needs_ocr";
  model: string;
  pages?: number;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export function logModelCall(event: ModelLogEvent, deps: ModelDeps = {}) {
  // Rebuilt field by field so nothing else can ride along.
  const line = JSON.stringify({
    msg: "model_call",
    tool: event.tool,
    outcome: event.outcome,
    model: event.model,
    ...(event.pages !== undefined ? { pages: event.pages } : {}),
    attempts: event.attempts,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    latency_ms: Math.round(event.latency_ms),
  });
  (deps.log ?? console.log)(line);
}

/** The error a tool answers when the model step fails: status, and the body agents act on. */
export function modelFailureAnswer(
  err: ModelError,
  tool: string,
): { status: number; body: Record<string, unknown> } {
  const fallback =
    tool === "doc_extract_lease"
      ? "extract the terms with your own model and check them with doc_verify_facts (free, no model)"
      : "write the summary yourself from the result; FactLot's numbers are in it";
  switch (err.kind) {
    case "unavailable":
      return modelUnavailable(tool);
    case "rate_limited":
    case "overloaded":
      return {
        status: 503,
        body: {
          error: "ModelBusy",
          code: "ModelBusy",
          message: `the model provider is busy, so ${tool} did not run and nothing was counted; retry in ${err.retryAfterSeconds ?? 30} seconds.`,
          retry_after_seconds: err.retryAfterSeconds ?? 30,
          next: `retry after ${err.retryAfterSeconds ?? 30} seconds, or ${fallback}`,
        },
      };
    case "timeout":
      return {
        status: 504,
        body: {
          error: "ModelTimeout",
          code: "ModelTimeout",
          message: `${tool} did not finish within ${MODEL_BUDGETS.timeoutMs / 1000} seconds; nothing was counted.`,
          next:
            tool === "doc_extract_lease"
              ? "retry with fewer predicates or a shorter document (split it), or " +
                fallback
              : "retry with a smaller max_words, or " + fallback,
        },
      };
    case "refused":
      return {
        status: 422,
        body: {
          error: "ModelRefused",
          code: "ModelRefused",
          message: `the model declined this request, so ${tool} returned nothing; nothing was counted.`,
          next: fallback,
        },
      };
    case "truncated":
      return {
        status: 422,
        body: {
          error: "ModelOutputTooLong",
          code: "ModelOutputTooLong",
          message: `the model's answer exceeded ${tool}'s output budget; nothing was counted.`,
          next:
            tool === "doc_extract_lease"
              ? "ask for fewer predicates per call (predicates: [...])"
              : "ask for fewer words (max_words)",
        },
      };
    default:
      return {
        status: 502,
        body: {
          error: "ModelError",
          code: "ModelError",
          message: `the model step of ${tool} failed; nothing was counted.`,
          next: `retry once, or ${fallback}`,
        },
      };
  }
}

/** 503 when the feature is off (no ANTHROPIC_API_KEY): safe to deploy before the key is set. */
export function modelUnavailable(tool: string): {
  status: number;
  body: Record<string, unknown>;
} {
  return {
    status: 503,
    body: {
      error: "ModelUnavailable",
      code: "ModelUnavailable",
      message: `${tool} is not enabled on this server: it needs a model, and none is configured. Every other FactLot tool works without one.`,
      next:
        tool === "doc_extract_lease"
          ? "extract the terms with your own model and check them with doc_verify_facts (same checks, free, no model)"
          : "write the summary from the result yourself; FactLot's numbers are in it",
    },
  };
}
