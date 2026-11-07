/**
 * The hosted FactLot front door (Cloudflare Worker), in front of the unchanged Node handler
 * from @factlot/server:
 *
 *   factlot.com, www.factlot.com   landing page (static assets), billing pages, /account
 *   api.factlot.com                API root (JSON for agents), /mcp, /v1/*, /openapi*.json
 *   API paths answer on every host, so factlot.com/mcp works too.
 *
 * Access: no key = free tier, rate-limited per client address (a salted hash of it; IPv6 per
 * /64). `Authorization: Bearer fl_live_...` = paid tier, rate-limited per key. A bearer token
 * that is not a FactLot key gets 401, and an address that sends many of them is refused before
 * the key store is read. A known key whose subscription lapsed gets 403 for tools but can still
 * read /v1/account and open the billing portal to fix its card.
 *
 * Registry lookups (answered calls of registry_* tools; registry_coverage, input errors, misses
 * outside loaded coverage and unanswered calls are given back) are metered on top: per
 * address per UTC day without a key, per subscription per calendar month with one. A request
 * over the cap gets 429 RegistryQuotaExceeded (REST) or the same error as an MCP tool result
 * with isError; other tools keep working.
 */
import { tools } from "@factlot/tools";

import {
  CONTACT,
  DISCUSSIONS,
  accountSummary,
  apiError,
  billingDeps,
  checkoutOpen,
  checkoutRoute,
  handleWebhook,
  json,
  logStripeError,
  mintKey,
  portalUrl,
  receiptEmail,
  refreshIfStale,
  revokeKey,
  rotateKey,
  siteUrl,
  successRoute,
} from "./billing.ts";
import {
  bearer,
  deriveStatus,
  hashKey,
  isLiveKey,
  keyId,
  looksLikeKey,
  meterSubject,
  readKey,
  type KeyRecord,
} from "./keys.ts";
import {
  ACCOUNT_TOOLS,
  ACCOUNT_TOOL_NAMES,
  accountUsage,
  answerAccountCall,
  hostedRegions,
  regionOf,
} from "./account-tools.ts";
import { claimRoute, CLAIM_POLL_MS, CLAIM_TTL_SECONDS } from "./claim.ts";
import { addressSubject } from "./limiter.ts";
import { KEY_PLACEHOLDER, guideMarkdown, setupGuide } from "./onboarding.ts";
import { accountFormPage, accountPage } from "./pages.ts";
import {
  recoverLinkRoute,
  recoverRequestRoute,
  recoveryState,
} from "./recovery.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  PLANS,
  isPlanId,
  PRICING_URL,
  QUOTA_RULES,
  isMeteredRegistryTool,
  publicPlans,
  type Tier,
} from "./plans.ts";
import type {
  Env,
  Fetcher,
  HitResult,
  QuotaSpec,
  QuotaState,
} from "./types.ts";

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

/** The catalog's registry tools, by name and by REST path. Unknown names are not metered. */
const REGISTRY_TOOLS = new Map(
  tools
    .filter((t) => t.name.startsWith("registry_"))
    .map((t) => [t.path, t.name]),
);
const REGISTRY_NAMES = new Set(REGISTRY_TOOLS.values());

/** The inner handler's limit on messages in one MCP batch (createHandler's maxMcpBatch). */
const MAX_MCP_BATCH = 20;

/** The inner handler refuses larger bodies; /mcp bodies are read here to count registry calls. */
const MAX_BODY_BYTES = 1024 * 1024;

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

const UPGRADE_HINT = `Need more? Paid plans: ${PRICING_URL} (or POST /v1/billing/checkout).`;

const QUOTA_HEADERS = [
  "x-factlot-registry-quota-limit",
  "x-factlot-registry-quota-remaining",
  "x-factlot-registry-quota-reset",
];

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers":
      "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
    "access-control-expose-headers": [
      "mcp-session-id",
      "mcp-protocol-version",
      "retry-after",
      "x-ratelimit-limit",
      "x-factlot-tier",
      ...QUOTA_HEADERS,
    ].join(", "),
  };
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

/** An error in the shape the path's callers read: JSON-RPC on /mcp, the REST object elsewhere. */
function errorResponse(
  path: string,
  status: number,
  rpcCode: number,
  raw: { error: string; message: string } & Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  const body = { ...raw, code: raw.code ?? raw.error };
  const { message, ...data } = body;
  return withHeaders(
    json(
      status,
      path === "/mcp"
        ? { jsonrpc: "2.0", error: { code: rpcCode, message, data }, id: null }
        : body,
      headers,
    ),
    corsHeaders(),
  );
}

function rateLimited(path: string, limit: number, tier: Tier): Response {
  const scope = tier === "anonymous" ? "per address" : "per key";
  const message =
    `rate limit of ${limit} requests per minute ${scope} exceeded for the ${tier} tier; retry in 60s. ${tier === "anonymous" ? UPGRADE_HINT : ""}`.trim();
  return errorResponse(
    path,
    429,
    -32000,
    {
      error: "RateLimited",
      message,
      retry_after_seconds: 60,
      next:
        tier === "anonymous"
          ? `retry after 60 seconds, or get a key: ${PRICING_URL}`
          : "retry after 60 seconds",
    },
    { "retry-after": "60", "x-ratelimit-limit": String(limit) },
  );
}

function unauthorized(path: string): Response {
  const message = `invalid or inactive FactLot API key. Free use needs no key; paid keys come from ${PRICING_URL}. Help: ${CONTACT} or ${DISCUSSIONS}`;
  return errorResponse(
    path,
    401,
    -32001,
    {
      error: "Unauthorized",
      message,
      next: "send no Authorization header for the free tier, or a live key; lost it? https://factlot.com/account#recover",
    },
    { "www-authenticate": 'Bearer realm="factlot"' },
  );
}

function inactive(path: string, record: KeyRecord, site: string): Response {
  const why = record.hold ?? (record.paused ? "paused" : record.stripe_status);
  return errorResponse(path, 403, -32003, {
    error: "SubscriptionInactive",
    message: `this FactLot key's subscription is not active (${why}). Paste the key at ${site}/account to fix billing, or email ${CONTACT}.`,
    stripe_status: record.stripe_status,
    next: `${site}/account`,
  });
}

/** A Durable Object call failed: refuse (fail closed) with a clean answer. */
class MeterUnavailable extends Error {}

async function metered<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch {
    throw new MeterUnavailable("meter");
  }
}

function serviceUnavailable(path: string): Response {
  return errorResponse(
    path,
    503,
    -32002,
    {
      error: "ServiceUnavailable",
      message:
        "the rate limiter is briefly unavailable, so the request was not run; retry in a few seconds.",
      retry_after_seconds: 5,
      next: "retry after 5 seconds",
    },
    { "retry-after": "5" },
  );
}

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export interface HandleOptions {
  /** Stripe's fetch (tests). */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** ctx.waitUntil: work that runs after the response (emails). */
  waitUntil?: (work: Promise<unknown>) => void;
}

/** Run `work` after the response when the runtime allows, never failing the request. */
function deferWith(opts: HandleOptions): (work: Promise<unknown>) => void {
  return (work) => {
    const safe = work.catch(() => {});
    if (opts.waitUntil) opts.waitUntil(safe);
  };
}

/** How an agent buys a key: the `checkout` object of the API root and /v1/plans. */
function checkoutInfo(apiBase: string) {
  return {
    method: "POST",
    url: `${apiBase}/v1/billing/checkout`,
    body: { plan: "pro | team" },
    returns: {
      url: "Stripe Checkout link: give it to your human to pay",
      claim_url: `${apiBase}/v1/billing/claim/<token>: GET it every ${CLAIM_POLL_MS / 1000} seconds or slower`,
      expires_at: `ISO time; the checkout and the claim last ${CLAIM_TTL_SECONDS / 60} minutes`,
    },
    claim: {
      pending: '202 {"status":"pending"} until the checkout is paid',
      paid: "200 {key, plan, plan_name, requests_per_minute, registry_lookups_per_month, account, mcp}, exactly once: store the key at once",
      claimed:
        '410 {"status":"claimed","by":"agent"|"page"} afterwards (the success page may have shown it first)',
      unknown: "404 when the token is unknown or expired",
    },
    onboarding: `${apiBase}/v1/onboarding`,
  };
}

/** A paid caller: a live key (it may be inactive for billing reasons). */
export interface PaidCaller {
  hash: string;
  record: KeyRecord;
  active: boolean;
}

/**
 * Look up a bearer token. Undefined for anything that is not a live FactLot key (unknown,
 * malformed, rotated away, revoked); an inactive subscription still resolves.
 */
export async function resolveKey(
  env: Env,
  token: string,
  opts: HandleOptions = {},
): Promise<PaidCaller | undefined> {
  if (!looksLikeKey(token)) return undefined;
  const hash = await hashKey(token);
  let record = await readKey(env.KEYS, hash);
  if (!record || !isLiveKey(record)) return undefined;
  const d = billingDeps(env, opts.fetchImpl, opts.now);
  if (d) record = await refreshIfStale(d, hash, record);
  return { hash, record, active: deriveStatus(record) === "active" };
}

// --- Registry metering ------------------------------------------------------------------------

/** A JSON-RPC message that calls a metered registry tool and expects an answer. */
function isMeteredCall(item: unknown): item is { id: string | number } {
  if (typeof item !== "object" || item === null) return false;
  const { id, method, params } = item as {
    id?: unknown;
    method?: unknown;
    params?: { name?: unknown } | null;
  };
  return (
    method === "tools/call" &&
    id !== undefined &&
    id !== null &&
    isMeteredRegistryTool(params?.name, REGISTRY_NAMES)
  );
}

function callsRegistry(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const { method, params } = item as {
    method?: unknown;
    params?: { name?: unknown } | null;
  };
  return (
    method === "tools/call" &&
    typeof params?.name === "string" &&
    REGISTRY_NAMES.has(params.name)
  );
}

function quotaHeaders(q: QuotaState): Record<string, string> {
  return {
    "x-factlot-registry-quota-limit": String(q.limit),
    "x-factlot-registry-quota-remaining": String(q.remaining),
    "x-factlot-registry-quota-reset": q.resets_at,
  };
}

/** The RegistryQuotaExceeded error object (REST body and MCP tool error alike). */
export function quotaError(q: QuotaState, tier: Tier, now: number) {
  const resets = q.resets_at;
  const limit = q.limit.toLocaleString("en-US");
  const free =
    "Only answered lookups count: coverage checks, misses and input errors are free.";
  const message =
    tier === "anonymous"
      ? `The free registry lookups for today are used up: ${limit} a day per IP address. They reset at ${resets}. A Pro key (${PLANS.pro.registryLookupsPerMonth.toLocaleString("en-US")} a month) or Team key (${PLANS.team.registryLookupsPerMonth.toLocaleString("en-US")} a month) lifts the cap: ${PRICING_URL}. Other tools keep working. ${free}`
      : tier === "pro"
        ? `This subscription's ${limit} registry lookups for the month are used up. They reset at ${resets}. Team (${PLANS.team.registryLookupsPerMonth.toLocaleString("en-US")} a month) lifts the cap: ${PRICING_URL}. Other tools keep working. ${free}`
        : `This subscription's ${limit} registry lookups for the month are used up. They reset at ${resets}. Team is the largest plan; for more, email ${CONTACT} (${PRICING_URL}). Other tools keep working. ${free}`;
  return {
    error: "RegistryQuotaExceeded",
    code: "RegistryQuotaExceeded",
    message,
    next:
      tier === "team"
        ? `wait until ${resets}, or email ${CONTACT}`
        : `wait until ${resets}, or upgrade: ${PRICING_URL}`,
    limit: q.limit,
    used: q.used,
    resets_at: resets,
    retry_after_seconds: retryAfter(q, now),
    upgrade: PRICING_URL,
    issues: [] as unknown[],
  };
}

function retryAfter(q: QuotaState, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(q.resets_at) - now) / 1000));
}

/** Read a request body, at most `max` bytes; undefined when it is longer. */
async function readBody(
  request: Request,
  max: number,
): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? "0") > max)
    return undefined;
  const buf = new Uint8Array(await request.arrayBuffer());
  return buf.byteLength > max ? undefined : new TextDecoder().decode(buf);
}

// --- Routes -------------------------------------------------------------------------------------

export async function handle(
  request: Request,
  env: Env,
  api: Fetcher,
  opts: HandleOptions = {},
): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  try {
    return await route(request, env, api, opts);
  } catch (err) {
    if (err instanceof MeterUnavailable) {
      console.error(JSON.stringify({ msg: "meter unavailable" }));
      return serviceUnavailable(path);
    }
    throw err;
  }
}

async function route(
  request: Request,
  env: Env,
  api: Fetcher,
  opts: HandleOptions,
): Promise<Response> {
  const now = opts.now ?? Date.now;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const host = url.host.toLowerCase();
  const apiBase = (env.API_URL ?? "https://api.factlot.com").replace(/\/$/, "");
  const site = siteUrl(env);
  let subject: string | undefined;
  const addressKey = async () =>
    (subject ??= await addressSubject(
      clientAddress(request),
      now(),
      env.IP_HASH_SALT,
    ));

  if (request.method === "OPTIONS" && (isApiPath(path) || isApiHost(host)))
    return new Response(null, { status: 204, headers: corsHeaders() });

  if (host === "www.factlot.com")
    return Response.redirect(
      `https://factlot.com${url.pathname}${url.search}`,
      301,
    );

  // The pages' stylesheet and icon, on every host (billing and account pages can be served on
  // the API host too).
  if ((path === "/styles.css" || path === "/favicon.svg") && env.ASSETS)
    return env.ASSETS.fetch(request);

  // Billing pages for people (any host). Both reach Stripe, so both count against the
  // per-address free-tier budget: a crawler following "Start Pro" cannot open sessions in bulk.
  if (path === "/billing/checkout" || path === "/billing/success") {
    const ok = await metered(
      env.RL_ANON.limit({ key: `billing:${await addressKey()}` }),
    );
    if (!ok.success)
      return rateLimited(path, ANONYMOUS_REQUESTS_PER_MINUTE, "anonymous");
    return path === "/billing/checkout"
      ? checkoutRoute(env, request, url, opts.fetchImpl, now)
      : successRoute(env, url, opts.fetchImpl, deferWith(opts));
  }
  if (path === "/account/recover" || path.startsWith("/account/recover/"))
    return recoverRoute(request, env, url, path, opts);
  if (path === "/account") return accountRoute(request, env, url, api, opts);
  if (path === "/v1/billing/webhook") {
    if (request.method !== "POST")
      return apiError(
        405,
        "MethodNotAllowed",
        `use POST for ${path}`,
        `POST ${path}`,
        {},
        { allow: "POST" },
      );
    return handleWebhook(env, request, now, opts.fetchImpl);
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
    const checkout_open = checkoutOpen(env);
    const checkout = checkoutInfo(apiBase);
    if (path === "/v1/plans")
      return withHeaders(
        json(200, { plans, quotas: QUOTA_RULES, checkout_open, checkout }),
        corsHeaders(),
      );
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
        quotas: QUOTA_RULES,
        checkout_open,
        checkout,
        onboarding: `${apiBase}/v1/onboarding`,
        account: `${site}/account`,
        source: "https://github.com/9mp96ygnbk-alt/factlot",
        docs: "https://factlot.com/llms.txt",
        contact: CONTACT,
      }),
      corsHeaders(),
    );
  }
  if (path === "/v1/billing/checkout") {
    if (request.method !== "POST")
      return apiError(
        405,
        "MethodNotAllowed",
        `use POST for ${path}`,
        `POST ${path}`,
        {},
        { allow: "POST" },
      );
    const ok = await metered(
      env.RL_ANON.limit({ key: `checkout:${await addressKey()}` }),
    );
    if (!ok.success)
      return rateLimited(path, ANONYMOUS_REQUESTS_PER_MINUTE, "anonymous");
    return withHeaders(
      await checkoutRoute(env, request, url, opts.fetchImpl, now),
      corsHeaders(),
    );
  }
  if (path.startsWith("/v1/billing/claim/")) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return withHeaders(
        json(
          405,
          {
            error: "MethodNotAllowed",
            code: "MethodNotAllowed",
            message: "GET this URL",
            next: "GET",
          },
          { allow: "GET" },
        ),
        corsHeaders(),
      );
    const ok = await metered(
      env.RL_ANON.limit({ key: `claim:${await addressKey()}` }),
    );
    if (!ok.success)
      return rateLimited(path, ANONYMOUS_REQUESTS_PER_MINUTE, "anonymous");
    const token = path.slice("/v1/billing/claim/".length);
    // One poll per token every 2 seconds (named by the token's hash, never the token).
    const perToken = await metered(
      env.RL_CLAIM.limit({ key: await hashKey(token) }),
    );
    if (!perToken.success)
      return errorResponse(
        path,
        429,
        -32000,
        {
          error: "RateLimited",
          code: "RateLimited",
          message: `poll a claim URL at most once every ${CLAIM_POLL_MS / 1000} seconds`,
          retry_after_seconds: CLAIM_POLL_MS / 1000,
          next: "wait, then GET this URL again",
        },
        { "retry-after": String(CLAIM_POLL_MS / 1000) },
      );
    return withHeaders(
      await claimRoute(env, token, {
        fetchImpl: opts.fetchImpl,
        now,
        defer: deferWith(opts),
      }),
      corsHeaders(),
    );
  }
  if (path === "/v1/onboarding") {
    const planParam = url.searchParams.get("plan");
    const guide = setupGuide({
      api: apiBase,
      site,
      plan: isPlanId(planParam) ? PLANS[planParam] : undefined,
      placeholder: KEY_PLACEHOLDER,
    });
    const markdown =
      (request.headers.get("accept") ?? "").includes("text/markdown") ||
      url.searchParams.get("format") === "md";
    return new Response(
      markdown ? guideMarkdown(guide) : JSON.stringify(guide, null, 2),
      {
        headers: {
          ...corsHeaders(),
          "content-type": markdown
            ? "text/markdown; charset=utf-8"
            : "application/json; charset=utf-8",
          "cache-control": "public, max-age=300",
          vary: "accept",
        },
      },
    );
  }

  // Who is calling. Rejected tokens spend a per-address budget, checked before the key store
  // is read, so a flood of made-up keys is refused cheaply.
  const token = bearer(request.headers.get("authorization"));
  let paid: PaidCaller | undefined;
  if (token !== undefined) {
    const failKey = `authfail:${await addressKey()}`;
    if (!(await metered(env.RL_ANON.peek({ key: failKey }))).success)
      return errorResponse(
        path,
        429,
        -32000,
        {
          error: "RateLimited",
          message:
            "too many rejected API keys from this address; retry in 60s.",
          retry_after_seconds: 60,
          next: "check the key, then retry after 60 seconds",
        },
        { "retry-after": "60" },
      );
    paid = await resolveKey(env, token, opts);
    if (!paid) {
      await metered(env.RL_ANON.limit({ key: failKey }));
      return unauthorized(path);
    }
  }

  const accountPath =
    path === "/v1/account" ||
    path === "/v1/account/usage" ||
    path === "/v1/billing/portal" ||
    path === "/v1/billing/rotate" ||
    path === "/v1/billing/keys" ||
    path.startsWith("/v1/billing/keys/");
  if (accountPath) {
    if (!paid)
      return withHeaders(
        apiError(
          401,
          "Unauthorized",
          "send your FactLot key as a bearer token",
          "Authorization: Bearer <key>; lost it? " + `${site}/account#recover`,
        ),
        corsHeaders(),
      );
    return withHeaders(await accountApi(request, env, path, paid, opts), {
      ...corsHeaders(),
    });
  }

  if (paid && !paid.active) return inactive(path, paid.record, site);
  const tier: Tier = paid ? paid.record.plan : "anonymous";
  const perMinute = paid
    ? PLANS[paid.record.plan].requestsPerMinute
    : ANONYMOUS_REQUESTS_PER_MINUTE;

  // What the request asks of the registry.
  let mcpBody: unknown;
  let mcpText: string | undefined;
  let restText: string | undefined;
  let registryRequest = false;
  let wanted = 0;
  // Hosted account tools (with a key): answered here, never by the inner handler.
  let accountCalls: AccountCall[] = [];
  let listIds: unknown[] = [];
  let mcpBatch = false;
  let onlyAccount = false;
  if (path === "/mcp" && request.method === "POST") {
    mcpText = await readBody(request, MAX_BODY_BYTES);
    if (mcpText === undefined)
      return errorResponse(path, 413, -32600, {
        error: "PayloadTooLarge",
        message: "request body over 1 MB",
      });
    try {
      mcpBody = JSON.parse(mcpText);
    } catch {
      mcpBody = undefined; // the inner handler answers the parse error
    }
    // The inner handler refuses these too; refusing here first means nothing is metered.
    if (Array.isArray(mcpBody) && mcpBody.length > MAX_MCP_BATCH)
      return errorResponse(path, 400, -32600, {
        error: "BadRequest",
        message: `invalid request: a batch may hold at most ${MAX_MCP_BATCH} messages`,
      });
    mcpBatch = Array.isArray(mcpBody);
    const items: unknown[] = Array.isArray(mcpBody) ? mcpBody : [mcpBody];
    registryRequest = items.some(callsRegistry);
    wanted = items.filter(isMeteredCall).length;
    if (paid && mcpBody !== undefined) {
      accountCalls = items.filter(isAccountCall);
      listIds = items
        .filter(
          (m) =>
            (m as { method?: unknown } | null)?.method === "tools/list" &&
            (m as { id?: unknown }).id !== undefined,
        )
        .map((m) => (m as { id: unknown }).id);
      if (accountCalls.length > 0) {
        const kept = items.filter((m) => !isAccountCall(m));
        onlyAccount = kept.length === 0;
        mcpBody = mcpBatch ? kept : kept[0];
        mcpText = onlyAccount ? undefined : JSON.stringify(mcpBody);
      }
    }
  } else if (REGISTRY_TOOLS.has(path) && request.method === "POST") {
    registryRequest = true;
    wanted = isMeteredRegistryTool(REGISTRY_TOOLS.get(path)) ? 1 : 0;
    restText = await readBody(request, MAX_BODY_BYTES);
    if (restText === undefined)
      return errorResponse(path, 413, -32600, {
        error: "PayloadTooLarge",
        message: "request body over 1 MB",
      });
  }

  // Minute limit (per address or per key), then registry quota (per address or subscription).
  let hit: HitResult;
  if (!paid) {
    const quota: QuotaSpec | undefined = registryRequest
      ? {
          kind: "day",
          limit: ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
          n: wanted,
        }
      : undefined;
    hit = await metered(env.METER.hit(await addressKey(), perMinute, quota));
  } else {
    hit = await metered(env.METER.hit(`key:${keyId(paid.hash)}`, perMinute));
    if (hit.ok && registryRequest)
      hit = await metered(
        env.METER.consume(meterSubject(paid.record, paid.hash), {
          kind: "month",
          limit: PLANS[paid.record.plan].registryLookupsPerMonth,
          n: wanted,
        }),
      );
  }
  if (!hit.ok) return rateLimited(path, perMinute, tier);

  const headers: Record<string, string> = {
    "x-factlot-tier": tier,
    "x-ratelimit-limit": String(perMinute),
  };
  let deniedError: ReturnType<typeof quotaError> | undefined;
  if (hit.quota) {
    Object.assign(headers, quotaHeaders(hit.quota));
    if (hit.granted < wanted) {
      deniedError = quotaError(hit.quota, tier, now());
      headers["retry-after"] = String(deniedError.retry_after_seconds);
    }
  }
  if (deniedError && path !== "/mcp")
    return withHeaders(json(429, deniedError), {
      ...corsHeaders(),
      ...headers,
    });

  // The inner handler runs open (no keys of its own): this layer already decided access.
  // It trusts forwarding headers (worker.ts sets trustProxy), so this layer replaces anything
  // the client sent: the public scheme is always https, the host is the one Cloudflare routed,
  // and the client address is Cloudflare's.
  const forward = (body?: string) => {
    const inner =
      body === undefined
        ? new Request(request)
        : new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body,
          });
    inner.headers.delete("authorization");
    for (const h of [
      "x-forwarded-for",
      "x-forwarded-proto",
      "x-forwarded-host",
    ])
      inner.headers.delete(h);
    inner.headers.set("x-forwarded-proto", "https");
    inner.headers.set("x-forwarded-host", host);
    inner.headers.set("x-forwarded-for", clientAddress(request));
    return api.fetch(inner);
  };
  const meterUsage = (status: number) =>
    env.USAGE?.writeDataPoint({
      indexes: [paid ? keyId(paid.hash) : "anonymous"],
      blobs: [tier, path.slice(0, 96), request.method],
      doubles: [status, 1],
    });

  let res: Response;
  if (onlyAccount) res = new Response(null, { status: 202 });
  else if (deniedError) {
    res = await mcpWithDenials(mcpBody, hit.granted, deniedError, forward);
  } else res = await forward(mcpText ?? restText);
  meterUsage(res.status);

  // Only real answers are charged: a lookup that was refused as invalid, missed outside the
  // loaded coverage, or could not be answered (RegistryUnavailable) is given back.
  if (hit.quota && hit.granted > 0) {
    const counted =
      path === "/mcp"
        ? await mcpCharges(res, mcpBody, hit.granted)
        : await restCharge(res, REGISTRY_TOOLS.get(path) ?? "", restText);
    res = counted.res;
    const unanswered = counted.free;
    // The subscription's daily usage (by tool and region) for /account and account_usage.
    if (paid && counted.charged.length > 0)
      deferWith(opts)(
        env.METER.record(
          meterSubject(paid.record, paid.hash),
          counted.charged.map((c) => ({
            tool: c.tool,
            region: regionOf(c.tool, c.args),
          })),
        ),
      );
    if (unanswered > 0) {
      try {
        await env.METER.refund(
          paid ? meterSubject(paid.record, paid.hash) : await addressKey(),
          paid ? "month" : "day",
          unanswered,
          hit.quota.resets_at,
        );
        headers["x-factlot-registry-quota-remaining"] = String(
          Math.min(hit.quota.limit, hit.quota.remaining + unanswered),
        );
      } catch {
        console.error(JSON.stringify({ msg: "quota refund failed" }));
      }
    }
  }
  if (paid && (accountCalls.length > 0 || listIds.length > 0))
    res = await withAccountTools(
      res,
      await Promise.all(
        accountCalls.map((m) =>
          metered(answerAccountCall(env, paid.hash, paid.record, m)),
        ),
      ),
      listIds,
      mcpBatch,
    );
  // Browsers read only the headers listed here: add this layer's to the inner handler's list.
  const expose = new Set(
    [
      res.headers.get("access-control-expose-headers") ?? "",
      corsHeaders()["access-control-expose-headers"]!,
    ]
      .join(",")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  return withHeaders(res, {
    ...headers,
    "access-control-expose-headers": [...expose].join(", "),
  });
}

/**
 * Run an MCP request of which only the first `granted` metered registry calls fit the quota:
 * the rest are answered here as tool errors (isError, the same error object REST returns), the
 * remaining messages go to the inner handler, and the answers are merged.
 */
async function mcpWithDenials(
  body: unknown,
  granted: number,
  error: ReturnType<typeof quotaError>,
  forward: (body?: string) => Promise<Response>,
): Promise<Response> {
  const batch = Array.isArray(body);
  const items: unknown[] = batch ? body : [body];
  const kept: unknown[] = [];
  const denied: { id: string | number }[] = [];
  let budget = granted;
  for (const item of items) {
    if (!isMeteredCall(item)) kept.push(item);
    else if (budget > 0) {
      budget--;
      kept.push(item);
    } else denied.push(item);
  }
  const answers = denied.map((m) => ({
    jsonrpc: "2.0",
    id: m.id,
    result: {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(error, null, 2) }],
    },
  }));
  const answer = (body: unknown) => withHeaders(json(200, body), corsHeaders());
  if (kept.length === 0) return answer(batch ? answers : answers[0]);
  const res = await forward(JSON.stringify(batch ? kept : kept[0]));
  if (res.status === 202) return answer(answers);
  if (
    res.status !== 200 ||
    !(res.headers.get("content-type") ?? "").includes("application/json")
  )
    return res;
  const inner = (await res.json()) as unknown;
  return answer([...(Array.isArray(inner) ? inner : [inner]), ...answers]);
}

/**
 * Whether a registry tool's answer is a real answer (charged as a lookup). Free: a miss whose
 * `coverage` says the county, state, entity registry or ID system asked about is not loaded.
 * Charged: a record, a resolved URN, owners, and a search that ran inside loaded coverage, even
 * with no results.
 */
export function isChargedAnswer(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null) return true;
  const { coverage, results } = answer as {
    coverage?: Record<string, unknown> | null;
    results?: unknown;
  };
  if (typeof coverage !== "object" || coverage === null) return true;
  if (
    coverage.county_loaded === false ||
    coverage.system_loaded === false ||
    coverage.loaded === false
  )
    return false;
  if (
    coverage.state_loaded === false &&
    (!Array.isArray(results) || results.length === 0)
  )
    return false;
  return true;
}

interface Charges {
  res: Response;
  /** Lookups to give back. */
  free: number;
  /** The calls that were charged: tool name and arguments. */
  charged: { tool: string; args: unknown }[];
}

function parseArgs(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
}

/** A REST registry answer: charged only for a 200 with a real answer. Returns a readable copy. */
async function restCharge(
  res: Response,
  tool: string,
  body: string | undefined,
): Promise<Charges> {
  const charged = [{ tool, args: parseArgs(body) }];
  if (res.status !== 200) return { res, free: 1, charged: [] };
  const text = await res.text();
  const copy = new Response(text, res);
  try {
    return isChargedAnswer(JSON.parse(text))
      ? { res: copy, free: 0, charged }
      : { res: copy, free: 1, charged: [] };
  } catch {
    return { res: copy, free: 0, charged };
  }
}

/**
 * Which of the first `granted` metered registry calls of an MCP request were real answers, and
 * how many were not: a JSON-RPC error (invalid params), a tool error (isError: bad input,
 * malformed URN, RegistryUnavailable), a coverage miss, or no answer at all. Reads the answer,
 * so it returns a fresh copy of the response.
 */
async function mcpCharges(
  res: Response,
  body: unknown,
  granted: number,
): Promise<Charges> {
  const calls = (Array.isArray(body) ? body : [body])
    .filter(isMeteredCall)
    .slice(0, granted) as {
    id: string | number;
    params: { name: string; arguments?: unknown };
  }[];
  const all = calls.map((m) => ({
    tool: m.params.name,
    args: m.params.arguments,
  }));
  if (
    res.status !== 200 ||
    !(res.headers.get("content-type") ?? "").includes("application/json")
  )
    return res.status >= 400
      ? { res, free: calls.length, charged: [] }
      : { res, free: 0, charged: all };
  const text = await res.text();
  const copy = new Response(text, res);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { res: copy, free: 0, charged: all };
  }
  const answers = new Map<unknown, unknown>();
  for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
    const id = (m as { id?: unknown } | null)?.id;
    if (id !== undefined) answers.set(id, m);
  }
  let free = 0;
  const charged: Charges["charged"] = [];
  for (const [i, call] of calls.entries()) {
    const m = answers.get(call.id) as
      | {
          error?: unknown;
          result?: { isError?: boolean; content?: { text?: unknown }[] };
        }
      | undefined;
    if (!m || m.error !== undefined || !m.result || m.result.isError === true) {
      free++;
      continue;
    }
    let real = true;
    try {
      real = isChargedAnswer(JSON.parse(String(m.result.content?.[0]?.text)));
    } catch {
      // Not JSON: an answer all the same.
    }
    if (real) charged.push(all[i]!);
    else free++;
  }
  return { res: copy, free, charged };
}

type AccountCall = {
  id: string | number;
  params: { name: string; arguments?: unknown };
};

function isAccountCall(item: unknown): item is AccountCall {
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
    ACCOUNT_TOOL_NAMES.has(params.name)
  );
}

/**
 * Merge the account tools into an MCP answer: their calls' answers, and their definitions at the
 * end of a tools/list result (the last page, when the list is paged).
 */
async function withAccountTools(
  res: Response,
  answers: unknown[],
  listIds: unknown[],
  batch: boolean,
): Promise<Response> {
  const answer = (body: unknown) => withHeaders(json(200, body), corsHeaders());
  if (res.status === 202 && answers.length > 0)
    return answer(batch ? answers : answers[0]);
  if (
    res.status !== 200 ||
    !(res.headers.get("content-type") ?? "").includes("application/json")
  )
    return res;
  let parsed: unknown;
  try {
    parsed = await res.clone().json();
  } catch {
    return res;
  }
  const inner = Array.isArray(parsed) ? parsed : [parsed];
  for (const m of inner as {
    id?: unknown;
    result?: { tools?: unknown[]; nextCursor?: unknown };
  }[])
    if (
      listIds.includes(m?.id) &&
      Array.isArray(m.result?.tools) &&
      !m.result.nextCursor
    )
      m.result.tools.push(...ACCOUNT_TOOLS);
  const all = [...inner, ...answers];
  return answer(batch ? all : all[0]);
}

/** /v1/account, /v1/account/usage and the key-management endpoints, for a live key. */
async function accountApi(
  request: Request,
  env: Env,
  path: string,
  paid: PaidCaller,
  opts: HandleOptions,
): Promise<Response> {
  const { hash, record } = paid;
  const now = opts.now ?? Date.now;
  const site = siteUrl(env);
  const wrongMethod = (allow: string) =>
    apiError(
      405,
      "MethodNotAllowed",
      `use ${allow} for ${path}`,
      `${allow} ${path}`,
      {},
      { allow },
    );
  if (path === "/v1/account") {
    if (request.method !== "GET" && request.method !== "POST")
      return wrongMethod("GET");
    return json(200, await metered(accountSummary(env, hash, record)));
  }
  if (path === "/v1/account/usage") {
    if (request.method !== "GET") return wrongMethod("GET");
    const days = Number(new URL(request.url).searchParams.get("days") ?? "30");
    return json(
      200,
      await metered(
        accountUsage(
          env,
          hash,
          record,
          Number.isInteger(days) ? Math.min(90, Math.max(1, days)) : 30,
        ),
      ),
    );
  }
  if (path === "/v1/billing/portal") {
    if (request.method !== "POST") return wrongMethod("POST");
    const d = billingDeps(env, opts.fetchImpl, now);
    if (!d)
      return apiError(
        503,
        "BillingNotOpen",
        `Billing is not configured. Email ${CONTACT}.`,
        `mailto:${CONTACT}`,
      );
    try {
      return json(200, { url: await portalUrl(d, record) });
    } catch (err) {
      logStripeError("portal session", err);
      return apiError(
        502,
        "BillingFailed",
        `Stripe did not answer. Try again in a minute, or email ${CONTACT}.`,
        "POST /v1/billing/portal again in a minute",
      );
    }
  }
  // Changing keys needs an active subscription.
  if (!paid.active) return inactive(path, record, site);
  const deps = { env, now };
  if (path === "/v1/billing/rotate") {
    if (request.method !== "POST") return wrongMethod("POST");
    const key = await rotateKey(deps, hash, record);
    return json(200, {
      key,
      id: keyId(await hashKey(key)),
      note: "Your previous key no longer works (allow up to a minute everywhere). This key is shown once.",
    });
  }
  if (path === "/v1/billing/keys") {
    if (request.method !== "POST") return wrongMethod("POST");
    const minted = await mintKey(deps, record);
    if (!minted.ok)
      return apiError(
        409,
        "KeyLimitReached",
        `${PLANS[record.plan].name} includes ${minted.limit} key${minted.limit === 1 ? "" : "s"}. Revoke one (DELETE /v1/billing/keys/{id}), replace this one (POST /v1/billing/rotate), or switch plans at ${site}/account.`,
        "POST /v1/billing/rotate",
        { limit: minted.limit },
      );
    return json(201, {
      key: minted.key,
      id: minted.id,
      note: "This key is shown once. It can take up to a minute to activate everywhere. Keys share the subscription's registry lookups.",
    });
  }
  // DELETE /v1/billing/keys/{id}
  if (request.method !== "DELETE") return wrongMethod("DELETE");
  const id = path.slice("/v1/billing/keys/".length);
  const outcome = /^[0-9a-f]{16}$/.test(id)
    ? await revokeKey(deps, record, id)
    : "not_found";
  if (outcome === "not_found")
    return apiError(
      404,
      "NotFound",
      "no live key with that id on this subscription (ids are in GET /v1/account)",
      "GET /v1/account",
    );
  if (outcome === "last_key")
    return apiError(
      409,
      "LastKey",
      "this is the subscription's only key; replace it with POST /v1/billing/rotate, or cancel the subscription in the billing portal",
      "POST /v1/billing/rotate",
    );
  return json(200, { revoked: id });
}

/**
 * /account, the customer's page: a form for the key (POSTed, never in the URL), then plan,
 * usage, keys and buttons that POST back here to open the billing portal or change keys.
 */
async function accountRoute(
  request: Request,
  env: Env,
  url: URL,
  api: Fetcher,
  opts: HandleOptions,
): Promise<Response> {
  const now = opts.now ?? Date.now;
  const formPage = (status?: number, notice?: string) =>
    accountFormPage(status, notice, recoveryState(env));
  if (request.method === "GET" || request.method === "HEAD") return formPage();
  if (request.method !== "POST")
    return apiError(
      405,
      "MethodNotAllowed",
      "use GET or POST",
      "GET this page in a browser",
      {},
      { allow: "GET, POST" },
    );
  // A form on another site cannot drive this page (it would need the key anyway).
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== url.origin)
    return formPage(403, "This form only works on its own page.");
  const address = await addressSubject(
    clientAddress(request),
    now(),
    env.IP_HASH_SALT,
  );
  if (
    !(await metered(env.RL_ANON.limit({ key: `account:${address}` }))).success
  )
    return formPage(429, "Too many tries from this address. Wait a minute.");
  const failKey = `authfail:${address}`;
  if (!(await metered(env.RL_ANON.peek({ key: failKey }))).success)
    return formPage(429, "Too many keys that did not match. Wait a minute.");
  const text = await readBody(request, 16 * 1024);
  if (text === undefined) return formPage(413, "The form is too large.");
  const form = new URLSearchParams(text);
  const key = (form.get("key") ?? "").trim();
  const action = form.get("action") ?? "view";
  const paid = await resolveKey(env, key, opts);
  if (!paid) {
    await metered(env.RL_ANON.limit({ key: failKey }));
    return formPage(
      401,
      `That key was not found. Check it and try again, or email ${CONTACT} from the address you paid with.`,
    );
  }
  const { hash, record } = paid;
  const show = async (
    k: string,
    h: string,
    r: KeyRecord,
    o: Parameters<typeof accountPage>[2] = {},
  ) => {
    const apiBase = (env.API_URL ?? "https://api.factlot.com").replace(
      /\/$/,
      "",
    );
    const [summary, receipts, usage, regions] = await Promise.all([
      metered(accountSummary(env, h, r)),
      receiptEmail(billingDeps(env, opts.fetchImpl, now), r.customer),
      env.METER.usage(meterSubject(r, h), 30).catch(() => undefined),
      hostedRegions(api, apiBase, now()),
    ]);
    return accountPage(summary, k, {
      receipts,
      usage,
      regions,
      api: apiBase,
      ...o,
    });
  };

  if (action === "portal") {
    const d = billingDeps(env, opts.fetchImpl, now);
    if (!d)
      return show(key, hash, record, {
        status: 503,
        notice: `Billing is not configured. Email ${CONTACT}.`,
      });
    try {
      const portal = await portalUrl(d, record);
      return new Response(null, {
        status: 303,
        headers: { location: portal, "cache-control": "no-store" },
      });
    } catch (err) {
      logStripeError("portal session", err);
      return show(key, hash, record, {
        status: 502,
        notice: `Stripe did not answer. Try again in a minute, or email ${CONTACT}.`,
      });
    }
  }
  if (action === "rotate" || action === "mint" || action === "revoke") {
    if (!paid.active)
      return show(key, hash, record, {
        status: 403,
        notice: "Keys can be changed only while the subscription is active.",
      });
    const deps = { env, now };
    if (action === "rotate") {
      const fresh = await rotateKey(deps, hash, record);
      const freshHash = await hashKey(fresh);
      const freshRecord = (await readKey(env.KEYS, freshHash)) ?? record;
      return show(fresh, freshHash, freshRecord, {
        newKey: fresh,
        notice: "Your previous key no longer works.",
      });
    }
    if (action === "mint") {
      const minted = await mintKey(deps, record);
      if (!minted.ok)
        return show(key, hash, record, {
          status: 409,
          notice: `Your plan includes ${minted.limit} key${minted.limit === 1 ? "" : "s"}.`,
        });
      return show(key, hash, record, { newKey: minted.key });
    }
    const id = form.get("id") ?? "";
    const outcome = await revokeKey(deps, record, id);
    if (outcome === "revoked" && id === keyId(hash))
      return formPage(200, "That key is revoked. Sign in with another key.");
    return show(key, hash, record, {
      notice:
        outcome === "revoked"
          ? `Key ${id} is revoked (allow up to a minute everywhere).`
          : outcome === "last_key"
            ? "The only key cannot be revoked; replace it instead."
            : "No key with that id.",
    });
  }
  return show(key, hash, record);
}

/** /account/recover and /account/recover/<token>: lost-key recovery by email (recovery.ts). */
async function recoverRoute(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  opts: HandleOptions,
): Promise<Response> {
  const now = opts.now ?? Date.now;
  const token =
    path === "/account/recover"
      ? undefined
      : path.slice("/account/recover/".length);
  if (token === undefined && request.method !== "POST")
    return Response.redirect(`${url.origin}/account#recover`, 303);
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "POST"
  )
    return apiError(
      405,
      "MethodNotAllowed",
      "use GET or POST",
      "GET this page in a browser",
      {},
      { allow: "GET, POST" },
    );
  const ropts = { fetchImpl: opts.fetchImpl, now, defer: deferWith(opts) };
  let body: string | undefined;
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== "null" && origin !== url.origin)
      return accountFormPage(
        403,
        "This form only works on its own page.",
        recoveryState(env),
      );
    const address = await addressSubject(
      clientAddress(request),
      now(),
      env.IP_HASH_SALT,
    );
    if (
      !(await metered(env.RL_ANON.limit({ key: `recover:${address}` }))).success
    )
      return accountFormPage(
        429,
        "Too many tries from this address. Wait a minute.",
        recoveryState(env),
      );
    body = await readBody(request, 4 * 1024);
    if (body === undefined)
      return accountFormPage(413, "The form is too large.", recoveryState(env));
  }
  if (token === undefined)
    return recoverRequestRoute(env, request, body ?? "", ropts);
  return recoverLinkRoute(env, request, token, body, ropts);
}
