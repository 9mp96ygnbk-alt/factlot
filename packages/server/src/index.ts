/**
 * @factlot/server — the remote FactLot connector.
 *
 * One HTTP service, three faces, all backed by the same tool catalog:
 *   POST /mcp              Streamable HTTP MCP (stateless) — Claude custom connectors,
 *                          ChatGPT apps / developer mode / deep research, Microsoft Copilot
 *                          Studio, Gemini CLI, Mistral Le Chat, Cursor, and other MCP clients
 *   POST /v1/...           REST: one endpoint per tool (Custom GPT Actions, Bedrock Agents,
 *                          Copilot API plugins, Vertex AI, plain HTTP clients)
 *   GET  /openapi.json     OpenAPI 3.1  (…/openapi-3.0.json for 3.0 consumers)
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
  inputJsonSchema,
  openApi30,
  openApi31,
  runTool,
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

function baseUrl(req: IncomingMessage, opts: FactLotServerOptions): string {
  if (opts.publicUrl) return opts.publicUrl.replace(/\/$/, "");
  const proto =
    String(req.headers["x-forwarded-proto"] ?? "http")
      .split(",")[0]
      ?.trim() ?? "http";
  const host = String(
    req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost",
  );
  return `${proto}://${host}`;
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
  const limiter = new RateLimiter();
  const usage = opts.usage ?? new UsageMeter({ file: opts.usageLog });
  const now = opts.now ?? Date.now;
  const logSink =
    opts.logSink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const logJson = opts.log === "json";

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    cors(res);
    const startedAt = now();
    const startedTick = performance.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
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

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      if (req.method === "GET" && path === "/") {
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
      if (req.method === "GET" && path === "/health") {
        send(res, 200, { ok: true, version: SERVER_VERSION });
        return;
      }
      if (
        req.method === "GET" &&
        (path === "/openapi.json" || path === "/openapi-3.0.json")
      ) {
        const doc =
          path === "/openapi.json"
            ? openApi31({ serverUrl: baseUrl(req, opts) })
            : openApi30({ serverUrl: baseUrl(req, opts) });
        if (authRequired) doc.security = [{ bearerAuth: [] }];
        send(res, 200, doc);
        return;
      }

      if (path === "/v1/usage") {
        if (req.method !== "GET") {
          send(res, 405, { error: "MethodNotAllowed", message: "use GET" });
          return;
        }
        if (!opts.adminKey) {
          send(res, 404, {
            error: "NotFound",
            message: "usage endpoint is disabled; set FACTLOT_ADMIN_KEY",
          });
          return;
        }
        const token = bearerToken(req.headers.authorization);
        if (token === undefined || !safeEqual(token, opts.adminKey)) {
          if (token !== undefined) ctx.rejectedPrefix = keyPrefix(token);
          unauthorized(res);
          return;
        }
        ctx.key = "admin";
        send(
          res,
          200,
          usage.report(startedAt, url.searchParams.get("key") ?? undefined),
        );
        return;
      }

      if (path === "/mcp" || path.startsWith("/v1/")) {
        let perMinute = defaultLimit;
        if (authRequired) {
          const token = bearerToken(req.headers.authorization);
          const key = resolveApiKey(token, keys);
          if (!key) {
            if (token !== undefined) ctx.rejectedPrefix = keyPrefix(token);
            unauthorized(res);
            return;
          }
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
          res.setHeader("retry-after", String(decision.retryAfterSeconds));
          const message = `rate limit of ${decision.limit} requests per minute exceeded; retry in ${decision.retryAfterSeconds}s`;
          if (path === "/mcp")
            send(res, 429, {
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message,
                data: {
                  error: "RateLimited",
                  retry_after_seconds: decision.retryAfterSeconds,
                },
              },
              id: null,
            });
          else
            send(res, 429, {
              error: "RateLimited",
              message,
              retry_after_seconds: decision.retryAfterSeconds,
            });
          return;
        }
      }

      if (path === "/mcp") {
        if (req.method !== "POST") {
          send(res, 405, {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message:
                "Method not allowed: this server is stateless; use POST.",
            },
            id: null,
          });
          return;
        }
        const body = await readJson(req, limit);
        ctx.calls = mcpCalls(body);
        await handleMcp(req, res, body);
        return;
      }

      if (req.method === "GET" && path === "/v1/tools") {
        send(res, 200, {
          tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            path: t.path,
            input_schema: inputJsonSchema(t),
          })),
        });
        return;
      }

      const tool = toolsByPath.get(path);
      if (tool) {
        if (req.method !== "POST") {
          send(res, 405, {
            error: "MethodNotAllowed",
            message: "use POST with a JSON body",
          });
          return;
        }
        ctx.calls = [{ tool: tool.name, surface: "rest" }];
        const outcome = runTool(tool.name, await readJson(req, limit));
        if (outcome.ok) send(res, 200, outcome.result);
        else {
          const code =
            { RegistryUnavailable: 503, NotFound: 404 }[
              outcome.error.error as string
            ] ?? 400;
          send(res, code, outcome.error);
        }
        return;
      }

      send(res, 404, {
        error: "NotFound",
        message: `no route for ${req.method} ${path}`,
      });
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError)
        send(res, err.status, { error: "BadRequest", message: err.message });
      else
        send(res, 500, { error: "InternalError", message: "unexpected error" });
    }
  };
}

/** Create a Node HTTP server running the FactLot connector. */
export function createFactLotServer(opts: FactLotServerOptions = {}): Server {
  const handler = createHandler(opts);
  return createHttpServer((req, res) => void handler(req, res));
}
