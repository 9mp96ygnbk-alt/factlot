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
 *
 * The tools are pure computation over the request, so the server stores nothing.
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

export interface FactLotServerOptions {
  /** If set, /mcp and /v1/* require `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Public base URL used in OpenAPI `servers` (default: derived from the request). */
  publicUrl?: string;
  /** Maximum request body in bytes (default 1 MiB). */
  maxBodyBytes?: number;
}

const toolsByPath = new Map(tools.map((t) => [t.path, t]));

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
    "mcp-session-id, mcp-protocol-version",
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

function authorized(req: IncomingMessage, opts: FactLotServerOptions): boolean {
  if (!opts.apiKey) return true;
  return req.headers.authorization === `Bearer ${opts.apiKey}`;
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
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    cors(res);
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
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
          auth: opts.apiKey ? "bearer" : "none",
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
        if (opts.apiKey) doc.security = [{ bearerAuth: [] }];
        send(res, 200, doc);
        return;
      }

      if (path === "/mcp" || path.startsWith("/v1/")) {
        if (!authorized(req, opts)) {
          res.setHeader("www-authenticate", 'Bearer realm="factlot"');
          send(res, 401, {
            error: "Unauthorized",
            message: "missing or invalid bearer token",
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
        await handleMcp(req, res, await readJson(req, limit));
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
