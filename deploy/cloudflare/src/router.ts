/**
 * The hosted FactLot front door (Cloudflare Worker), in front of the unchanged Node handler
 * from @factlot/server:
 *
 *   factlot.com, www.factlot.com   landing page (static assets) + billing pages
 *   api.factlot.com                API root (JSON for agents), /mcp, /v1/*, /openapi*.json
 *   API paths answer on every host, so factlot.com/mcp works too.
 *
 * Access: no key = free tier, rate-limited per client address. `Authorization: Bearer fl_live_...`
 * = paid tier, rate-limited per key. A bearer token that is not a live FactLot key gets 401.
 */
import {
  CONTACT,
  DISCUSSIONS,
  billingDeps,
  checkoutRoute,
  handleWebhook,
  json,
  portalUrl,
  refreshIfStale,
  rotateKey,
  successRoute,
} from "./billing.ts";
import { bearer, hashKey, looksLikeKey, readKey } from "./keys.ts";
import {
  ANONYMOUS_REQUESTS_PER_MINUTE,
  PLANS,
  publicPlans,
  type Tier,
} from "./plans.ts";
import type { Env, Fetcher } from "./types.ts";

const API_EXACT = new Set([
  "/mcp",
  "/openapi.json",
  "/openapi-3.0.json",
  "/health",
]);

const API_ROBOTS = `# api.factlot.com serves FactLot's REST API, OpenAPI and MCP endpoint. Docs: https://factlot.com/
Content-Signal: search=yes, ai-input=yes, ai-train=yes
User-agent: *
Allow: /
`;

export function isApiPath(path: string): boolean {
  return API_EXACT.has(path) || path.startsWith("/v1/") || path === "/v1";
}

function isApiHost(host: string): boolean {
  return (
    host.startsWith("api.") ||
    host.endsWith(".workers.dev") ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1")
  );
}

const UPGRADE_HINT =
  "Need more? Paid plans: https://factlot.com/#pricing (or POST /v1/billing/checkout).";

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers":
      "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
    "access-control-expose-headers":
      "mcp-session-id, mcp-protocol-version, retry-after, x-ratelimit-limit, x-factlot-tier",
  };
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

function rateLimited(path: string, limit: number, tier: Tier): Response {
  const message =
    `rate limit of ${limit} requests per minute exceeded for the ${tier} tier; retry in 60s. ${tier === "anonymous" ? UPGRADE_HINT : ""}`.trim();
  const body =
    path === "/mcp"
      ? {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message,
            data: { error: "RateLimited", retry_after_seconds: 60 },
          },
          id: null,
        }
      : { error: "RateLimited", message, retry_after_seconds: 60 };
  return json(429, body, {
    "retry-after": "60",
    "x-ratelimit-limit": String(limit),
  });
}

function unauthorized(path: string): Response {
  const message = `invalid or inactive FactLot API key. Free use needs no key; paid keys come from https://factlot.com/#pricing. Help: ${CONTACT} or ${DISCUSSIONS}`;
  const body =
    path === "/mcp"
      ? { jsonrpc: "2.0", error: { code: -32001, message }, id: null }
      : { error: "Unauthorized", message };
  return json(401, body, { "www-authenticate": 'Bearer realm="factlot"' });
}

export interface Resolved {
  tier: Tier;
  /** First 16 hex chars of the key hash, for metering; never the key. */
  keyId: string;
  hash?: string;
}

/** Who is calling: anonymous, a live paid key, or (undefined) a token that must be refused. */
export async function resolveCaller(
  env: Env,
  request: Request,
): Promise<Resolved | undefined> {
  const token = bearer(request.headers.get("authorization"));
  if (token === undefined) return { tier: "anonymous", keyId: "anonymous" };
  if (!looksLikeKey(token)) return undefined;
  const hash = await hashKey(token);
  let record = await readKey(env.KEYS, hash);
  if (!record) return undefined;
  const d = billingDeps(env);
  if (d) record = await refreshIfStale(d, hash, record);
  if (record.status !== "active") return undefined;
  return { tier: record.plan, keyId: hash.slice(0, 16), hash };
}

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export async function handle(
  request: Request,
  env: Env,
  api: Fetcher,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const host = url.host.toLowerCase();
  const apiBase = (env.API_URL ?? "https://api.factlot.com").replace(/\/$/, "");

  if (request.method === "OPTIONS" && (isApiPath(path) || isApiHost(host)))
    return new Response(null, { status: 204, headers: corsHeaders() });

  if (host === "www.factlot.com")
    return Response.redirect(
      `https://factlot.com${url.pathname}${url.search}`,
      301,
    );

  // Billing pages for people (any host). Both reach Stripe, so both count against the
  // per-address free-tier budget: a crawler following "Start Pro" cannot open sessions in bulk.
  if (path === "/billing/checkout" || path === "/billing/success") {
    const ok = await env.RL_ANON.limit({
      key: `billing:${clientAddress(request)}`,
    });
    if (!ok.success)
      return rateLimited(path, ANONYMOUS_REQUESTS_PER_MINUTE, "anonymous");
    return path === "/billing/checkout"
      ? checkoutRoute(env, request, url)
      : successRoute(env, url);
  }
  if (path === "/v1/billing/webhook") {
    if (request.method !== "POST")
      return json(405, { error: "MethodNotAllowed" }, { allow: "POST" });
    return handleWebhook(env, request);
  }

  // Landing page on the apex and www hosts.
  if (!isApiHost(host) && !isApiPath(path) && env.ASSETS)
    return env.ASSETS.fetch(request);

  // The API host's own robots.txt, so crawler rules never depend on a dashboard default.
  if (path === "/robots.txt")
    return new Response(API_ROBOTS, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

  // --- API ---------------------------------------------------------------------------------
  if (path === "/v1/plans" || (path === "/" && request.method === "GET")) {
    const plans = publicPlans(apiBase.replace("://api.", "://"));
    if (path === "/v1/plans")
      return withHeaders(json(200, { plans }), corsHeaders());
    return withHeaders(
      json(200, {
        name: "FactLot",
        description:
          "The open fact layer for commercial real estate AI agents.",
        mcp: `${apiBase}/mcp`,
        openapi: `${apiBase}/openapi.json`,
        openapi_3_0: `${apiBase}/openapi-3.0.json`,
        tools: `${apiBase}/v1/tools`,
        auth: "none for the free tier; Authorization: Bearer <FactLot key> for paid plans",
        plans,
        source: "https://github.com/9mp96ygnbk-alt/factlot",
        docs: "https://factlot.com/llms.txt",
        contact: CONTACT,
      }),
      corsHeaders(),
    );
  }
  if (path === "/v1/billing/checkout") {
    if (request.method !== "POST")
      return json(405, { error: "MethodNotAllowed" }, { allow: "POST" });
    const ok = await env.RL_ANON.limit({
      key: `checkout:${clientAddress(request)}`,
    });
    if (!ok.success)
      return rateLimited(path, ANONYMOUS_REQUESTS_PER_MINUTE, "anonymous");
    return withHeaders(await checkoutRoute(env, request, url), corsHeaders());
  }

  const caller = await resolveCaller(env, request);
  if (!caller) return withHeaders(unauthorized(path), corsHeaders());

  if (
    path === "/v1/billing/portal" ||
    path === "/v1/billing/rotate" ||
    path === "/v1/account"
  ) {
    if (caller.tier === "anonymous" || !caller.hash)
      return withHeaders(
        json(401, {
          error: "Unauthorized",
          message: "send your FactLot key as a bearer token",
        }),
        corsHeaders(),
      );
    const record = await readKey(env.KEYS, caller.hash);
    if (!record) return withHeaders(unauthorized(path), corsHeaders());
    if (path === "/v1/account")
      return withHeaders(
        json(200, {
          plan: record.plan,
          status: record.status,
          requests_per_minute: PLANS[record.plan].requestsPerMinute,
          created: record.created,
        }),
        corsHeaders(),
      );
    if (request.method !== "POST")
      return json(405, { error: "MethodNotAllowed" }, { allow: "POST" });
    const d = billingDeps(env);
    if (!d)
      return withHeaders(
        json(503, { error: "BillingNotOpen", message: `Email ${CONTACT}.` }),
        corsHeaders(),
      );
    try {
      if (path === "/v1/billing/portal")
        return withHeaders(
          json(200, { url: await portalUrl(d, record) }),
          corsHeaders(),
        );
      const key = await rotateKey(d, caller.hash, record);
      return withHeaders(
        json(200, {
          key,
          note: "Your previous key no longer works. This key is shown once.",
        }),
        corsHeaders(),
      );
    } catch {
      return withHeaders(
        json(502, {
          error: "BillingFailed",
          message: `Stripe did not answer. Email ${CONTACT}.`,
        }),
        corsHeaders(),
      );
    }
  }

  const limiter =
    caller.tier === "anonymous"
      ? env.RL_ANON
      : caller.tier === "pro"
        ? env.RL_PRO
        : env.RL_TEAM;
  const limit =
    caller.tier === "anonymous"
      ? ANONYMOUS_REQUESTS_PER_MINUTE
      : PLANS[caller.tier].requestsPerMinute;
  const limiterKey =
    caller.tier === "anonymous"
      ? `ip:${clientAddress(request)}`
      : `key:${caller.keyId}`;
  if (!(await limiter.limit({ key: limiterKey })).success)
    return withHeaders(rateLimited(path, limit, caller.tier), corsHeaders());

  // The inner handler runs open (no keys of its own): this layer already decided access.
  const inner = new Request(request);
  inner.headers.delete("authorization");
  // The inner handler trusts forwarding headers (worker.ts sets trustProxy), so this layer
  // replaces anything the client sent: the public scheme is always https, the host is the one
  // Cloudflare routed, and the client address is Cloudflare's. OpenAPI `servers` and the
  // inner per-address logic then see the real values.
  for (const h of ["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"])
    inner.headers.delete(h);
  inner.headers.set("x-forwarded-proto", "https");
  inner.headers.set("x-forwarded-host", host);
  inner.headers.set("x-forwarded-for", clientAddress(request));
  const res = await api.fetch(inner);
  env.USAGE?.writeDataPoint({
    indexes: [caller.keyId],
    blobs: [caller.tier, path.slice(0, 96), request.method],
    doubles: [res.status, 1],
  });
  return withHeaders(res, {
    "x-factlot-tier": caller.tier,
    "x-ratelimit-limit": String(limit),
  });
}
