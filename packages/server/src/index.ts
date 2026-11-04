/**
 * @factlot/server — the remote FactLot connector.
 *
 * One HTTP service, three faces, all backed by the same tool catalog:
 *   POST /mcp              Streamable HTTP MCP (stateless) — Claude custom connectors,
 *                          ChatGPT apps / developer mode / deep research, Microsoft Copilot
 *                          Studio, Gemini CLI, Mistral Le Chat, Cursor, and other MCP clients
 *   POST /v1/...           REST: one endpoint per tool (Custom GPT Actions, Bedrock Agents,
 *                          Copilot API plugins, Vertex AI, plain HTTP clients)
 *   GET  /openapi.json     OpenAPI 3.1, every tool
 *   GET  /openapi-3.0.json OpenAPI 3.0, the Custom GPT Actions subset (?operations=all: every tool)
 *   GET  /v1/usage         per-key, per-tool call counts (admin key required)
 *
 * The tools are pure computation over the request, so the server stores nothing durable.
 * Rate-limit windows and usage counts live in memory per instance; the usage log file is the
 * durable record.
 */
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_VERSION, createServer as createMcpServer } from "@factlot/mcp";
import {
  CATALOG_VERSION,
  INPUT_LIMITS,
  inputJsonSchema,
  inputShapeIssue,
  openApi30,
  openApi31,
  runToolAsync,
  registryPath,
  tools,
} from "@factlot/tools";

import {
  bearerToken,
  keyPrefix,
  resolveApiKey,
  safeEqual,
  type ApiKey,
} from "./auth.ts";
import { RateLimiter } from "./ratelimit.ts";
import { UsageMeter, type UsageSurface } from "./usage.ts";

export { optionsFromEnv } from "./config.ts";
export type { Env } from "./config.ts";
export {
  keyPrefix,
  mergeApiKeys,
  parseApiKeysEnv,
  parseApiKeysJson,
  resolveApiKey,
  safeEqual,
} from "./auth.ts";
export type { ApiKey } from "./auth.ts";
export { RateLimiter } from "./ratelimit.ts";
export type { RateLimitDecision } from "./ratelimit.ts";
export { UsageMeter } from "./usage.ts";
export type {
  KeyUsage,
  ToolUsage,
  UsageEvent,
  UsageReport,
  UsageSurface,
  UsageWindow,
} from "./usage.ts";

export interface FactLotServerOptions {
  /** One shared key (name "default"). Same as `apiKeys: [{ key, name: "default" }]`. */
  apiKey?: string;
  /** Named keys. When any key is configured, /mcp and /v1/* require `Authorization: Bearer <key>`. */
  apiKeys?: ApiKey[];
  /** Bearer key for `GET /v1/usage`. The endpoint answers 404 when unset. */
  adminKey?: string;
  /** Default requests per minute per key name (0 or unset = unlimited). A key's own limit wins. */
  rateLimitPerMinute?: number;
  /** Append one JSON line per metered call to this file. Ignored when `usage` is given. */
  usageLog?: string;
  /** Share or inspect the in-memory usage meter. */
  usage?: UsageMeter;
  /** `"json"` writes one JSON line per request to `logSink`. Default: no request log. */
  log?: "json" | "none";
  /** Where request log lines go (default: stdout). */
  logSink?: (line: string) => void;
  /** Clock, ms since epoch (default `Date.now`); rate-limit windows and usage buckets use it. */
  now?: () => number;
  /** Public base URL used in OpenAPI `servers` (default: derived from the request). */
  publicUrl?: string;
  /** Maximum request body in bytes (default 1 MiB). */
  maxBodyBytes?: number;
  /**
   * Trust `X-Forwarded-For`, `-Proto` and `-Host` from a reverse proxy in front of this server
   * (default false). Only set it when every request arrives through that proxy: the headers are
   * otherwise client-controlled, and they decide the per-IP limit key and the OpenAPI `servers`.
   */
  trustProxy?: boolean;
  /** Requests per minute per client IP on every route, before auth (0 or unset = no limit). */
  rateLimitPerIpPerMinute?: number;
  /** Rejected bearer tokens per minute per client IP before further attempts get 429 (default 30, 0 = off). */
  authFailuresPerIpPerMinute?: number;
  /** Most JSON-RPC messages in one POST /mcp batch (default 20). */
  maxMcpBatch?: number;
  /** Where unexpected errors are reported (default: one JSON line on stderr, error name only). */
  errorSink?: (line: string) => void;
}

const toolsByPath = new Map(tools.map((t) => [t.path, t]));

/**
 * Every field a request log line may carry, in order. This is the whole schema: the log never
 * includes a request body, tool arguments, tool results, headers, or a bearer key, and no
 * future endpoint may add them, because customer documents must never appear in logs
 * (docs/customer-documents.md, "Logging"). A test holds this list to what the logger writes.
 */
export const REQUEST_LOG_FIELDS = [
  "time",
  "msg",
  "method",
  "path",
  "tool",
  "key",
  "key_prefix",
  "status",
  "duration_ms",
] as const;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Every response is JSON for programs, never a page: no sniffing, no framing, no caching (a
 * shared cache must not keep one caller's result or an OpenAPI document built for one Host).
 */
function securityHeaders(res: ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
}

function methodNotAllowed(
  res: ServerResponse,
  allow: string,
  jsonRpc = false,
): void {
  res.setHeader("allow", allow);
  const message = `method not allowed; use ${allow.replace(", OPTIONS", "")}`;
  send(
    res,
    405,
    jsonRpc
      ? { jsonrpc: "2.0", error: { code: -32000, message }, id: null }
      : { error: "MethodNotAllowed", message },
  );
}

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  );
  res.setHeader(
    "access-control-expose-headers",
    "mcp-session-id, mcp-protocol-version, retry-after, x-ratelimit-limit, x-ratelimit-remaining",
  );
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit)
    throw new HttpError(413, `request body exceeds ${limit} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit)
      throw new HttpError(413, `request body exceeds ${limit} bytes`);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

/** A Host value: a DNS name or bracketed IPv6 literal, optional port. Nothing else is echoed. */
const HOST_RE =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function firstHeader(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(",")[0]?.trim() || undefined;
}

function baseUrl(req: IncomingMessage, opts: FactLotServerOptions): string {
  if (opts.publicUrl) return opts.publicUrl.replace(/\/$/, "");
  const fwdProto = opts.trustProxy
    ? firstHeader(req.headers["x-forwarded-proto"])
    : undefined;
  const proto = fwdProto === "https" ? "https" : "http";
  const fwdHost = opts.trustProxy
    ? firstHeader(req.headers["x-forwarded-host"])
    : undefined;
  const host = fwdHost ?? req.headers.host ?? "localhost";
  return `${proto}://${HOST_RE.test(host) ? host : "localhost"}`;
}

/**
 * The client address for per-IP limits: the socket peer, or with `trustProxy` the last
 * `X-Forwarded-For` entry (the one the proxy itself appended; earlier entries are client-supplied).
 */
function clientIp(req: IncomingMessage, opts: FactLotServerOptions): string {
  if (opts.trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const list = (Array.isArray(xff) ? xff.join(",") : (xff ?? ""))
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const last = list.at(-1);
    if (last) return last.slice(0, 64);
  }
  return req.socket.remoteAddress ?? "unknown";
}

function tooManyRequests(
  res: ServerResponse,
  jsonRpc: boolean,
  message: string,
  retryAfterSeconds: number,
): void {
  res.setHeader("retry-after", String(retryAfterSeconds));
  if (jsonRpc)
    send(res, 429, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
        data: { error: "RateLimited", retry_after_seconds: retryAfterSeconds },
      },
      id: null,
    });
  else
    send(res, 429, {
      error: "RateLimited",
      message,
      retry_after_seconds: retryAfterSeconds,
    });
}

function unauthorized(res: ServerResponse): void {
  res.setHeader("www-authenticate", 'Bearer realm="factlot"');
  send(res, 401, {
    error: "Unauthorized",
    message: "missing or invalid bearer token",
  });
}

interface MeteredCall {
  tool: string;
  surface: UsageSurface;
}

/**
 * What a POST /mcp body will call, read from the JSON-RPC envelope before the MCP SDK sees it:
 * `tools/call` is metered under the tool name, other requests as `mcp:<method>`; notifications
 * (no `id`) are not metered.
 */
function mcpCalls(body: unknown): MeteredCall[] {
  const out: MeteredCall[] = [];
  for (const item of Array.isArray(body) ? body : [body]) {
    if (typeof item !== "object" || item === null) continue;
    const { id, method, params } = item as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
    };
    if (typeof method !== "string" || id === undefined || id === null) continue;
    const name =
      typeof params === "object" && params !== null
        ? (params as { name?: unknown }).name
        : undefined;
    out.push({
      tool:
        method === "tools/call" && typeof name === "string"
          ? name
          : `mcp:${method}`,
      surface: "mcp",
    });
  }
  return out;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  // Stateless mode: a fresh server + transport per request, so any instance can serve any call.
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

/** Request handler; mount it on any Node HTTP server or framework that exposes req/res. */
export function createHandler(opts: FactLotServerOptions = {}) {
  const limit = opts.maxBodyBytes ?? 1024 * 1024;
  const keys: ApiKey[] = [
    ...(opts.apiKey ? [{ key: opts.apiKey, name: "default" }] : []),
    ...(opts.apiKeys ?? []),
  ];
  const authRequired = keys.length > 0;
  const defaultLimit = opts.rateLimitPerMinute ?? 0;
  const perIpLimit = opts.rateLimitPerIpPerMinute ?? 0;
  const authFailureLimit = opts.authFailuresPerIpPerMinute ?? 30;
  const maxBatch = opts.maxMcpBatch ?? 20;
  const limiter = new RateLimiter();
  const ipLimiter = new RateLimiter();
  const authFailures = new RateLimiter();
  const usage = opts.usage ?? new UsageMeter({ file: opts.usageLog });
  const now = opts.now ?? Date.now;
  const logSink =
    opts.logSink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const errorSink =
    opts.errorSink ??
    ((line: string) => void process.stderr.write(`${line}\n`));
  const logJson = opts.log === "json";
  // The MCP envelope adds up to four levels above the tool arguments: batch, message, params,
  // arguments. Tool-level limits apply again inside runTool.
  const envelopeLimits = {
    ...INPUT_LIMITS,
    maxDepth: INPUT_LIMITS.maxDepth + 4,
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    cors(res);
    securityHeaders(res);
    const startedAt = now();
    const startedTick = performance.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = clientIp(req, opts);
    const ctx: {
      key: string | null;
      rejectedPrefix?: string;
      calls: MeteredCall[];
    } = { key: null, calls: [] };

    res.once("close", () => {
      const durationMs = Math.round(performance.now() - startedTick);
      const status = res.headersSent ? res.statusCode : 0;
      for (const call of ctx.calls)
        usage.record({
          time: startedAt,
          key: ctx.key ?? "anonymous",
          tool: call.tool,
          surface: call.surface,
          status,
          durationMs,
        });
      if (logJson) {
        // Metadata only. Never add the body, tool arguments, results, or headers here: a
        // document-carrying endpoint would put customer documents in the log. The fields
        // are the ones in REQUEST_LOG_FIELDS; see docs/customer-documents.md, "Logging".
        const names = ctx.calls.map((c) => c.tool);
        logSink(
          JSON.stringify({
            time: new Date(startedAt).toISOString(),
            msg: "request",
            method: req.method ?? "",
            path,
            tool:
              names.length === 0 ? null : names.length === 1 ? names[0] : names,
            key: ctx.key,
            ...(ctx.rejectedPrefix ? { key_prefix: ctx.rejectedPrefix } : {}),
            status,
            duration_ms: durationMs,
          }),
        );
      }
    });

    /** Bearer check with a per-IP budget for wrong tokens; false when a response was sent. */
    const authorize = (
      check: (token: string | undefined) => boolean,
      jsonRpc: boolean,
    ): boolean => {
      if (
        authFailureLimit > 0 &&
        authFailures.count(ip, startedAt) >= authFailureLimit
      ) {
        const retry = authFailures.check(ip, authFailureLimit, startedAt);
        tooManyRequests(
          res,
          jsonRpc,
          `too many rejected tokens from this address; retry in ${retry.retryAfterSeconds}s`,
          retry.retryAfterSeconds,
        );
        return false;
      }
      const token = bearerToken(req.headers.authorization);
      if (check(token)) return true;
      if (token !== undefined) ctx.rejectedPrefix = keyPrefix(token);
      if (authFailureLimit > 0)
        authFailures.check(ip, authFailureLimit, startedAt);
      unauthorized(res);
      return false;
    };

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      if (perIpLimit > 0) {
        const d = ipLimiter.check(ip, perIpLimit, startedAt);
        if (!d.allowed) {
          tooManyRequests(
            res,
            path === "/mcp",
            `rate limit of ${d.limit} requests per minute per address exceeded; retry in ${d.retryAfterSeconds}s`,
            d.retryAfterSeconds,
          );
          return;
        }
      }
      const getOnly =
        path === "/" ||
        path === "/health" ||
        path === "/openapi.json" ||
        path === "/openapi-3.0.json" ||
        path === "/v1/tools" ||
        path === "/v1/usage";
      if (getOnly && req.method !== "GET") {
        methodNotAllowed(res, "GET, OPTIONS");
        return;
      }
      if (path === "/") {
        const base = baseUrl(req, opts);
        send(res, 200, {
          name: "FactLot",
          description:
            "The open fact layer for commercial real estate AI agents.",
          version: CATALOG_VERSION,
          mcp: `${base}/mcp`,
          openapi: `${base}/openapi.json`,
          openapi_3_0: `${base}/openapi-3.0.json`,
          tools: `${base}/v1/tools`,
          auth: authRequired ? "bearer" : "none",
        });
        return;
      }
      if (path === "/health") {
        send(res, 200, { ok: true, version: SERVER_VERSION });
        return;
      }
      if (path === "/openapi.json" || path === "/openapi-3.0.json") {
        // Same tools as /v1/tools: registry operations only when a registry is loaded. The 3.0
        // document is the Custom GPT Actions subset (at most 30 operations) unless the caller
        // asks for ?operations=all.
        const api = {
          serverUrl: baseUrl(req, opts),
          filter: (t: (typeof tools)[number]) =>
            t.requires !== "registry" || registryPath() !== undefined,
          ...(url.searchParams.get("operations") === "all"
            ? { operations: "all" as const }
            : {}),
        };
        const doc = path === "/openapi.json" ? openApi31(api) : openApi30(api);
        if (authRequired) doc.security = [{ bearerAuth: [] }];
        send(res, 200, doc);
        return;
      }

      if (path === "/v1/usage") {
        if (!opts.adminKey) {
          send(res, 404, {
            error: "NotFound",
            message: "usage endpoint is disabled; set FACTLOT_ADMIN_KEY",
          });
          return;
        }
        const adminKey = opts.adminKey;
        if (
          !authorize(
            (token) => token !== undefined && safeEqual(token, adminKey),
            false,
          )
        )
          return;
        ctx.key = "admin";
        send(
          res,
          200,
          usage.report(
            startedAt,
            url.searchParams.get("key")?.slice(0, 200) ?? undefined,
          ),
        );
        return;
      }

      const tool = toolsByPath.get(path);
      const known = path === "/mcp" || path === "/v1/tools" || tool;
      if (!known) {
        send(res, 404, {
          error: "NotFound",
          message: `no route for ${String(req.method).slice(0, 16)} ${path.slice(0, 200)}`,
        });
        return;
      }
      if (req.method !== "POST" && path !== "/v1/tools") {
        methodNotAllowed(res, "POST, OPTIONS", path === "/mcp");
        return;
      }

      let perMinute = defaultLimit;
      if (authRequired) {
        let key: ApiKey | undefined;
        const ok = authorize((token) => {
          key = resolveApiKey(token, keys);
          return key !== undefined;
        }, path === "/mcp");
        if (!ok || !key) return;
        ctx.key = key.name;
        perMinute = key.rateLimitPerMinute ?? defaultLimit;
      }
      const decision = limiter.check(
        ctx.key ?? "anonymous",
        perMinute,
        startedAt,
      );
      if (decision.limit > 0) {
        res.setHeader("x-ratelimit-limit", String(decision.limit));
        res.setHeader("x-ratelimit-remaining", String(decision.remaining));
      }
      if (!decision.allowed) {
        tooManyRequests(
          res,
          path === "/mcp",
          `rate limit of ${decision.limit} requests per minute exceeded; retry in ${decision.retryAfterSeconds}s`,
          decision.retryAfterSeconds,
        );
        return;
      }

      if (path === "/mcp") {
        const body = await readJson(req, limit);
        const shape = inputShapeIssue(body, envelopeLimits);
        const tooMany = Array.isArray(body) && body.length > maxBatch;
        if (shape || tooMany) {
          send(res, 400, {
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: tooMany
                ? `invalid request: a batch may hold at most ${maxBatch} messages`
                : `invalid request: ${shape?.path || "(root)"}: ${shape?.message}`,
            },
            id: null,
          });
          return;
        }
        ctx.calls = mcpCalls(body);
        await handleMcp(req, res, body);
        return;
      }

      if (path === "/v1/tools") {
        // Same list as MCP tools/list: registry tools only when a registry is loaded.
        const listed = tools.filter(
          (t) => t.requires !== "registry" || registryPath() !== undefined,
        );
        send(res, 200, {
          tools: listed.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            path: t.path,
            input_schema: inputJsonSchema(t),
          })),
        });
        return;
      }

      const spec = tool as (typeof tools)[number];
      ctx.calls = [{ tool: spec.name, surface: "rest" }];
      const outcome = await runToolAsync(spec.name, await readJson(req, limit));
      if (outcome.ok) send(res, 200, outcome.result);
      else {
        const code =
          { RegistryUnavailable: 503, NotFound: 404 }[
            outcome.error.error as string
          ] ?? 400;
        send(res, code, outcome.error);
      }
    } catch (err) {
      if (!(err instanceof HttpError))
        // The error name and route only: messages and stacks can carry input or paths.
        errorSink(
          JSON.stringify({
            time: new Date(startedAt).toISOString(),
            msg: "error",
            method: req.method ?? "",
            path: path.slice(0, 200),
            error: err instanceof Error ? err.name : typeof err,
          }),
        );
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError)
        send(res, err.status, {
          error: err.status === 413 ? "PayloadTooLarge" : "BadRequest",
          message: err.message,
        });
      else
        send(res, 500, { error: "InternalError", message: "unexpected error" });
    }
  };
}

/** Request timeouts for the Node server (slow clients cannot hold sockets open indefinitely). */
export const SERVER_TIMEOUTS = {
  /** Whole request, headers and body (Node default: 300 s). */
  requestTimeoutMs: 30_000,
  /** Request headers (Node default: 60 s). */
  headersTimeoutMs: 15_000,
  /** Idle keep-alive connection. */
  keepAliveTimeoutMs: 5_000,
} as const;

/** Create a Node HTTP server running the FactLot connector. */
export function createFactLotServer(opts: FactLotServerOptions = {}): Server {
  const handler = createHandler(opts);
  const server = createHttpServer(
    { maxHeaderSize: 16 * 1024 },
    (req, res) => void handler(req, res),
  );
  server.requestTimeout = SERVER_TIMEOUTS.requestTimeoutMs;
  server.headersTimeout = SERVER_TIMEOUTS.headersTimeoutMs;
  server.keepAliveTimeout = SERVER_TIMEOUTS.keepAliveTimeoutMs;
  server.maxHeadersCount = 100;
  return server;
}
