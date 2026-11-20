/**
 * OAuth 2.1 for the hosted MCP server, so clients that cannot send an API-key header (Claude
 * Desktop and claude.ai custom connectors, ChatGPT developer-mode apps) can connect a paid plan:
 * add the connector, sign in, and the plan applies.
 *
 * The protocol is Cloudflare's @cloudflare/workers-oauth-provider in its authorization-server role
 * (OAuth 2.1, PKCE S256, RFC 8414 metadata, RFC 7591 registration, Client ID Metadata Documents,
 * RFC 7009 revocation, RFC 8707 resource indicators, RFC 9207 `iss`). This module adds what is
 * FactLot's own: the sign-in and consent page, who a token stands for, and the protected-resource
 * side of /mcp (RFC 9728 metadata and the 401 challenge).
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata for https://api.factlot.com/mcp
 *   GET  /.well-known/oauth-authorization-server       RFC 8414 metadata (library)
 *   GET  /authorize                                    sign-in and consent page
 *   POST /authorize                                    key, free tier, email link, or cancel
 *   GET|POST /authorize/email/<link>                   the emailed sign-in link (when email is on)
 *   POST /token                                        code and refresh grants, revocation (library)
 *   POST /register                                     dynamic client registration (library)
 *   /mcp/signin                                        /mcp, except that no credentials gets the
 *                                                      401 challenge that starts sign-in
 *
 * Identity, without passwords: the customer pastes their FactLot key once on the consent page (a
 * POST body, never a URL). The key resolves to its subscription and the grant is bound to that
 * subscription, not to the key: replacing the key keeps the connection, and the plan, status and
 * quotas are read from the subscription's newest live key on every request, exactly as a key's
 * are. "Continue on the free tier" issues a grant with the anonymous limits, metered per
 * connection instead of per address (a hosted client calls from its vendor's shared addresses).
 * With the email binding and RECOVERY_SIGNING_SECRET set, the page also offers a sign-in link
 * sent to the address the customer paid with.
 *
 * Storage: the library's records live in the KEYS namespace under the `oauth:` prefix (no extra
 * binding). Tokens, codes and client secrets are stored only as hashes and grant props are
 * encrypted with key material only the token holder can unwrap. Grant user ids are opaque: a hash
 * of the subscription for paid grants, random for free ones. No token, code, key or address is
 * ever logged.
 */
import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  authorizationErrorRedirect,
  type AuthRequest,
  type ClientRegistrationCallbackOptions,
  type GrantSummary,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

import {
  billingDeps,
  json,
  logStripeError,
  refreshIfStale,
  type BillingDeps,
} from "./billing.ts";
import { sendEmail } from "./email.ts";
import {
  base64url,
  deriveStatus,
  hashKey,
  keyId,
  liveKeys,
  ownerKeys,
  randomToken,
  stripeStatusIsTerminal,
  type KeyRecord,
} from "./keys.ts";
import { addressSubject, ipBucket } from "./limiter.ts";
import {
  consentPage,
  emailLinkPage,
  oauthMessagePage,
  type ConsentView,
} from "./pages_oauth.ts";
import { PLANS, type PlanId } from "./plans.ts";
import { recoveryState, subscriptionsForEmail } from "./recovery.ts";
import type { PaidCaller } from "./router.ts";
import type { Env, KV } from "./types.ts";

/** The one scope: use FactLot's MCP tools at the subscription's plan (or the free tier). */
export const OAUTH_SCOPE = "mcp";
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** A refresh token lasts 30 days from its issue; each refresh rotates it and starts 30 more. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * How long the consent page works as it is: its transaction (one use, bound to the browser) and
 * FactLot's record of it. Long enough to go and find a key. The library fixes its transaction at
 * ten minutes (a constant in @cloudflare/workers-oauth-provider, not an option); FactLot keeps it
 * this long by lengthening the record's storage time and the binding cookie's age
 * (`longerTransactions`, `stretchConsentCookies`).
 */
export const CONSENT_TTL_SECONDS = 60 * 60;
/**
 * After that, a post from the page still finishes, or redraws a fresh page for the same request,
 * for this long (`restartTarget`): the person never has to go back to the app because the page
 * sat open.
 */
export const RESTART_TTL_SECONDS = 24 * 60 * 60;
/** An emailed sign-in link works once, for this long. */
export const EMAIL_LINK_TTL_SECONDS = 10 * 60;
/** The URL a header-less client adds: /mcp, but asking for sign-in when called without credentials. */
export const MCP_SIGNIN_PATH = "/mcp/signin";
/** New free-tier connections one address may create per UTC day. */
export const FREE_CONNECTIONS_PER_DAY = 10;
/** Per address per minute (shared hosted-client addresses call these for many users). */
export const TOKEN_REQUESTS_PER_MINUTE = 600;
export const REGISTRATIONS_PER_MINUTE = 30;
/** One emailed sign-in link per address per this long. */
export const EMAIL_LINK_RESEND_SECONDS = 2 * 60;

const PRM_PATH = "/.well-known/oauth-protected-resource";
const OAUTH_PATHS = new Set([
  PRM_PATH,
  `${PRM_PATH}/mcp`,
  // A client that builds the metadata URL from the URL it was given (RFC 9728 §3.1).
  `${PRM_PATH}${MCP_SIGNIN_PATH}`,
  "/.well-known/oauth-authorization-server",
  "/authorize",
  "/token",
  "/register",
]);
const EMAIL_LINK_PREFIX = "/authorize/email/";

export function isOAuthPath(path: string): boolean {
  return OAUTH_PATHS.has(path) || path.startsWith(EMAIL_LINK_PREFIX);
}

export function apiBase(env: Env): string {
  return (env.API_URL ?? "https://api.factlot.com").replace(/\/$/, "");
}

/** The protected resource: the MCP endpoint, the audience of every token. */
export function mcpResource(env: Env): string {
  return `${apiBase(env)}/mcp`;
}

export function resourceMetadataUrl(env: Env): string {
  return `${apiBase(env)}${PRM_PATH}/mcp`;
}

/**
 * The sign-in URL as a protected resource of its own. A client that was given /mcp/signin reads
 * metadata whose `resource` is exactly that URL (Claude requires `resource` to equal the URL the
 * person entered, path included) and asks for a token for it; the token works on /mcp and
 * /mcp/signin alike.
 */
export function signInResource(env: Env): string {
  return `${apiBase(env)}${MCP_SIGNIN_PATH}`;
}

export function signInResourceMetadataUrl(env: Env): string {
  return `${apiBase(env)}${PRM_PATH}${MCP_SIGNIN_PATH}`;
}

/**
 * The RFC 6750 / RFC 9728 challenge for a 401 from /mcp: where the resource's metadata is, the
 * scope to ask for, and (for a rejected token) why.
 */
export function wwwAuthenticate(
  env: Env,
  error?: { code: "invalid_token"; description: string },
  /** The challenge for /mcp/signin: its own metadata, whose resource is the sign-in URL. */
  signIn = false,
): string {
  const parts = [
    'Bearer realm="factlot"',
    `resource_metadata="${signIn ? signInResourceMetadataUrl(env) : resourceMetadataUrl(env)}"`,
    `scope="${OAUTH_SCOPE}"`,
  ];
  if (error)
    parts.push(
      `error="${error.code}"`,
      `error_description="${error.description.replace(/["\\]/g, "")}"`,
    );
  return parts.join(", ");
}

// --- Storage -------------------------------------------------------------------------------------

/** The KV operations the library uses (the real binding has them; types.ts's KV is narrower). */
export interface ListableKV extends KV {
  get(key: string): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: unknown;
    },
  ): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    keys: { name: string; expiration?: number; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

const KV_PREFIX = "oauth:";

/** The library's view of KEYS: every name under `oauth:`, so nothing can meet a key record. */
export function prefixedKV(kv: ListableKV, prefix = KV_PREFIX): ListableKV {
  return {
    get: ((key: string, options?: { type: "json" }) =>
      options
        ? kv.get(prefix + key, options)
        : kv.get(prefix + key)) as ListableKV["get"],
    put: (key, value, options) => kv.put(prefix + key, value, options),
    delete: (key) => kv.delete(prefix + key),
    async list(options = {}) {
      const res = await kv.list({
        ...options,
        prefix: prefix + (options.prefix ?? ""),
      });
      return {
        ...res,
        keys: res.keys.map((k) => ({
          ...k,
          name: k.name.slice(prefix.length),
        })),
      };
    },
  };
}

/**
 * The library's consent transactions (`transaction:<hash>`) stored for `ttl` seconds instead of
 * its fixed ten minutes; every other record exactly as the library asks. The binding cookie's age
 * is lengthened to match (`stretchConsentCookies`): the transaction stays one use and bound to
 * the browser that opened the page.
 */
export function longerTransactions(
  kv: ListableKV,
  ttl = CONSENT_TTL_SECONDS,
): ListableKV {
  return {
    get: ((key: string, options?: { type: "json" }) =>
      options ? kv.get(key, options) : kv.get(key)) as ListableKV["get"],
    put: (key, value, options) =>
      kv.put(
        key,
        value,
        key.startsWith("transaction:") &&
          options?.expirationTtl !== undefined &&
          options.expirationTtl < ttl
          ? { ...options, expirationTtl: ttl }
          : options,
      ),
    delete: (key) => kv.delete(key),
    list: (options) => kv.list(options),
  };
}

/** The consent headers with the binding cookie lasting as long as the transaction. */
export function stretchConsentCookies(
  headers: Headers,
  ttl = CONSENT_TTL_SECONDS,
): Headers {
  const out = new Headers();
  for (const [k, v] of headers)
    out.append(
      k,
      k.toLowerCase() === "set-cookie"
        ? v.replace(/;\s*Max-Age=\d+/i, `; Max-Age=${ttl}`)
        : v,
    );
  return out;
}

interface OAuthEnv {
  OAUTH_KV: ListableKV;
}

const envs = new WeakMap<object, OAuthEnv>();

function oauthEnv(env: Env): OAuthEnv {
  let e = envs.get(env.KEYS);
  if (!e) {
    e = { OAUTH_KV: longerTransactions(prefixedKV(env.KEYS as ListableKV)) };
    envs.set(env.KEYS, e);
  }
  return e;
}

// --- The authorization server ----------------------------------------------------------------------

/** Registration policy on top of the library's: a name the consent page can show, few redirects. */
export function registrationPolicy({
  clientMetadata,
}: ClientRegistrationCallbackOptions) {
  const name = clientMetadata.client_name;
  if (name !== undefined && (typeof name !== "string" || name.length > 100))
    return {
      description: "client_name must be a string of at most 100 characters",
    };
  const uris = clientMetadata.redirect_uris;
  if (Array.isArray(uris) && uris.length > 10)
    return { description: "at most 10 redirect_uris" };
  return undefined;
}

const servers = new Map<string, OAuthAuthorizationServer<OAuthEnv>>();

export function authorizationServer(
  env: Env,
): OAuthAuthorizationServer<OAuthEnv> {
  const issuer = apiBase(env);
  let s = servers.get(issuer);
  if (!s) {
    s = new OAuthAuthorizationServer<OAuthEnv>({
      issuer,
      // /mcp, and /mcp/signin for clients that ask for a token for the URL they were given.
      resources: [`${issuer}/mcp`, `${issuer}${MCP_SIGNIN_PATH}`],
      defaultResource: `${issuer}/mcp`,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: [OAUTH_SCOPE],
      accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
      refreshTokenIdleTTL: REFRESH_TOKEN_TTL_SECONDS,
      clientIdMetadataDocumentEnabled: true,
      clientRegistrationCallback: registrationPolicy,
      // The library's default logs the error description; this logs the stable reason only.
      onError: ({ status, code, internal }) => {
        console.warn(
          JSON.stringify({
            msg: "oauth error",
            status,
            code,
            category: internal?.category,
            reason: internal?.reason,
          }),
        );
      },
    });
    servers.set(issuer, s);
  }
  return s;
}

export function oauthHelpers(env: Env): OAuthHelpers {
  return authorizationServer(env).getOAuthApi(oauthEnv(env));
}

// --- Who a token stands for --------------------------------------------------------------------

/**
 * Stored encrypted with the grant: the subscription, never a key. A sign-in with a guest key
 * (keys.ts) also keeps that key's public id, so the connection stays on the guest's meter.
 */
type OAuthProps =
  | { v: 1; tier: "paid"; subscription: string; guest_key?: string }
  | {
      v: 1;
      tier: "free";
      /**
       * The meter every free connection started from one address shares (freeConnectionMeter).
       * Grants made before it existed have none and must sign in again.
       */
      meter?: string;
    };

/**
 * The shared meter of the free connections started from one address (IPv6: its /64): a salted
 * hash, so the address itself is never stored. Without it each new free connection would bring a
 * fresh daily allowance, and ten connections a day would give one address ten allowances.
 */
export async function freeConnectionMeter(
  address: string,
  secret?: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `factlot-oauthfree|${secret ?? ""}|${ipBucket(address)}`,
    ),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Grant metadata (storage-visible, unencrypted): what /account shows. */
interface GrantMeta {
  tier: "paid" | "free";
  client_name: string;
  via?: "key" | "email";
}

/** A subscription's grant user id: stable (so its grants can be listed) and opaque. */
export async function paidUserId(subscription: string): Promise<string> {
  return `p${(await hashKey(`factlot-oauth-subscription|${subscription}`)).slice(0, 40)}`;
}

function freeUserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return `f${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** An access token as the library issues it: `<user>:<grant>:<secret>`. FactLot keys never match. */
export function isOAuthToken(token: string): boolean {
  return /^[^\s:]{1,128}:[^\s:]{1,128}:[^\s:]{16,512}$/.test(token);
}

export type OAuthCaller =
  | {
      tier: "free";
      grantId: string;
      clientId: string;
      /**
       * Meter subject: minute limit, daily registry lookups and monthly reports, shared by every
       * free connection started from the same address.
       */
      subject: string;
    }
  | {
      tier: "paid";
      grantId: string;
      clientId: string;
      /** Meter subject of the connection's minute limit (a key's is `key:<id>`). */
      subject: string;
      /** The subscription's newest live key: plan, status and quotas, as for a key. */
      paid: PaidCaller;
    };

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  defer?: (work: Promise<unknown>) => void;
}

/**
 * Validate an OAuth access token for /mcp and resolve who it stands for. Undefined when the token
 * is unknown, expired, revoked, for another audience, or bound to a subscription that has ended
 * (cancelled, or no live key left), in which case the grant is revoked so the client signs in
 * again. A subscription that is inactive but can recover (unpaid, paused, on hold) resolves with
 * `active: false`, and the caller answers 403 exactly as for a key.
 */
export async function resolveOAuthToken(
  env: Env,
  token: string,
  opts: ResolveOptions = {},
): Promise<OAuthCaller | undefined> {
  if (!isOAuthToken(token)) return undefined;
  // Tokens are bound to /mcp, or to /mcp/signin when the client asked for the sign-in URL; both
  // reach the same server.
  const server = authorizationServer(env);
  const v =
    (await server.validateToken(mcpResource(env), token, oauthEnv(env))) ??
    (await server.validateToken(signInResource(env), token, oauthEnv(env)));
  if (!v || !v.scope.includes(OAUTH_SCOPE)) return undefined;
  const grantId = token.split(":")[1]!;
  const props = v.props as OAuthProps | undefined;
  if (props?.tier === "free") {
    // A free grant from before the shared meter: no allowance of its own any more. The client
    // gets 401 and signs in again, which records the meter.
    if (typeof props.meter !== "string" || props.meter === "") return undefined;
    return {
      tier: "free",
      grantId,
      clientId: v.clientId,
      subject: `oauthfree:${props.meter}`,
    };
  }
  if (props?.tier !== "paid" || typeof props.subscription !== "string")
    return undefined;
  const ended = () => {
    const work = oauthHelpers(env).revokeGrant(grantId, v.userId);
    if (opts.defer) opts.defer(work);
    else void work.catch(() => {});
    return undefined;
  };
  // A guest's connection: that key while it lives. Any other: the subscription's newest own key.
  const keys = await liveKeys(env.KEYS, props.subscription);
  const newest =
    typeof props.guest_key === "string"
      ? keys.find((k) => k.record.guest && keyId(k.hash) === props.guest_key)
      : ownerKeys(keys).at(-1);
  if (!newest) return ended();
  let record: KeyRecord = newest.record;
  const d = billingDeps(env, opts.fetchImpl, opts.now);
  if (d) record = await refreshIfStale(d, newest.hash, record);
  if (stripeStatusIsTerminal(record.stripe_status)) return ended();
  return {
    tier: "paid",
    grantId,
    clientId: v.clientId,
    subject: `oauth:${grantId}`,
    paid: {
      hash: newest.hash,
      record,
      active: deriveStatus(record) === "active",
    },
  };
}

// --- Connected apps (/account, GET /v1/account) -----------------------------------------------------

export interface Connection {
  id: string;
  client: string;
  client_id: string;
  connected_at: string;
  /** When the connection ends unless the app refreshes it (each refresh adds 30 days). */
  expires_at: string | null;
  last_used_at: string | null;
}

/** The apps connected to a subscription by OAuth, newest first. */
export async function listConnections(
  env: Env,
  subscription: string,
): Promise<Connection[]> {
  const userId = await paidUserId(subscription);
  const helpers = oauthHelpers(env);
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await helpers.listUserGrants(userId, { cursor, limit: 100 });
    grants.push(...res.items);
    cursor = res.cursor;
    if (!cursor) break;
  }
  const out = await Promise.all(
    grants.map(async (g) => {
      const meta = (g.metadata ?? {}) as Partial<GrantMeta>;
      return {
        id: g.id,
        client:
          typeof meta.client_name === "string" && meta.client_name
            ? meta.client_name
            : g.clientId,
        client_id: g.clientId,
        connected_at: new Date(g.createdAt * 1000).toISOString(),
        expires_at: g.expiresAt
          ? new Date(g.expiresAt * 1000).toISOString()
          : null,
        last_used_at:
          (await env.METER.lastUsed(`oauth:${g.id}`).catch(() => undefined)) ??
          null,
      };
    }),
  );
  return out.sort((a, b) => b.connected_at.localeCompare(a.connected_at));
}

/** Disconnect one app from a subscription: its grant and every token of it. */
export async function disconnect(
  env: Env,
  subscription: string,
  grantId: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(grantId)) return false;
  const userId = await paidUserId(subscription);
  if (!(await oauthEnv(env).OAUTH_KV.get(`grant:${userId}:${grantId}`)))
    return false;
  await oauthHelpers(env).revokeGrant(grantId, userId);
  return true;
}

// --- Routes --------------------------------------------------------------------------------------

export interface OAuthRouteDeps extends ResolveOptions {
  /** router.ts's key lookup (the same one /account and the API use). */
  resolveKey: (
    env: Env,
    token: string,
    opts: { fetchImpl?: typeof fetch; now?: () => number },
  ) => Promise<PaidCaller | undefined>;
  waitUntil?: (work: Promise<unknown>) => void;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
};

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

function oauthError(
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
): Response {
  return json(
    status,
    { error, error_description: description },
    {
      "access-control-allow-origin": "*",
      ...headers,
    },
  );
}

/** RFC 9728 protected resource metadata for /mcp, or for /mcp/signin (`signIn`). */
export function protectedResourceMetadata(env: Env, signIn = false) {
  const base = apiBase(env);
  return {
    resource: signIn ? signInResource(env) : `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "FactLot",
    resource_documentation:
      "https://github.com/9mp96ygnbk-alt/factlot/blob/main/docs/getting-started.md",
  };
}

/** The 401 that starts sign-in at /mcp/signin when a request carries no credentials. */
export function signInChallenge(env: Env): Response {
  return json(
    401,
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: `Sign in to connect FactLot: with your FactLot key for your plan, or continue on the free tier. Clients that send headers can use ${mcpResource(env)} directly.`,
      },
      id: null,
    },
    {
      "www-authenticate": wwwAuthenticate(env, undefined, true),
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "www-authenticate",
    },
  );
}

/**
 * Serve an OAuth path (`isOAuthPath`), or undefined for any other. The caller routes these only on
 * API hosts.
 */
export async function oauthRoute(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  deps: OAuthRouteDeps,
): Promise<Response | undefined> {
  if (!isOAuthPath(path)) return undefined;
  const now = deps.now ?? Date.now;
  const address = () =>
    addressSubject(clientAddress(request), now(), env.IP_HASH_SALT);

  if (path.startsWith(PRM_PATH)) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return json(405, { error: "MethodNotAllowed" }, { allow: "GET, HEAD" });
    return json(
      200,
      protectedResourceMetadata(env, path === `${PRM_PATH}${MCP_SIGNIN_PATH}`),
      {
        ...CORS,
        "cache-control": "public, max-age=3600",
      },
    );
  }

  if (path === "/token" || path === "/register") {
    if (request.method === "POST") {
      const [subject, perMinute] =
        path === "/token"
          ? ["oauthtoken", TOKEN_REQUESTS_PER_MINUTE]
          : ["oauthregister", REGISTRATIONS_PER_MINUTE];
      const hit = await env.METER.hit(
        `${subject}:${await address()}`,
        perMinute,
      );
      if (!hit.ok)
        return oauthError(
          429,
          "temporarily_unavailable",
          "too many requests from this address; retry in 60 seconds",
          { "retry-after": "60" },
        );
    }
  }

  if (path === "/authorize") return authorizeRoute(request, env, url, deps);
  if (path.startsWith(EMAIL_LINK_PREFIX))
    return emailLinkRoute(
      request,
      env,
      url,
      path.slice(EMAIL_LINK_PREFIX.length),
      deps,
    );

  // Authorization-server metadata, token, revocation and registration: the library.
  const ctx = {
    waitUntil: (p: Promise<unknown>) => deps.waitUntil?.(p.catch(() => {})),
    passThroughOnException() {},
    props: {},
  };
  return authorizationServer(env).fetch(
    request,
    oauthEnv(env),
    ctx as unknown as Parameters<
      OAuthAuthorizationServer<OAuthEnv>["fetch"]
    >[2],
  );
}

/** A form POST from another origin cannot drive these pages. */
function crossOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin !== "null" && origin !== url.origin;
}

async function readForm(
  request: Request,
  max: number,
): Promise<URLSearchParams | undefined> {
  if (Number(request.headers.get("content-length") ?? "0") > max)
    return undefined;
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > max) return undefined;
  return new URLSearchParams(new TextDecoder().decode(buf));
}

function viewKey(handle: string): Promise<string> {
  return hashKey(handle).then((h) => `${KV_PREFIX}view:${h}`);
}

/**
 * FactLot's record of one consent page, kept RESTART_TTL_SECONDS: what the page shows (to redraw
 * it), and what lets a post from it start again safely after its transaction ended.
 */
interface SignInRecord {
  view: ConsentView;
  /** SHA-256 of the authorize request's query: the page's restart field must match it. */
  q: string;
  /** SHA-256 of the browser's sign-in cookie: only that browser finishes a restart in one step. */
  b: string;
  /** When the page was made (milliseconds). */
  t: number;
  /** Approved or cancelled: a later post says so instead of connecting again. */
  done?: true;
}

async function saveSignIn(env: Env, handle: string, rec: SignInRecord) {
  await env.KEYS.put(await viewKey(handle), JSON.stringify(rec), {
    expirationTtl: RESTART_TTL_SECONDS,
  });
}

async function readSignIn(
  env: Env,
  handle: string,
  now: () => number,
): Promise<SignInRecord | undefined> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(handle)) return undefined;
  const raw = await env.KEYS.get(await viewKey(handle));
  if (!raw) return undefined;
  const rec = JSON.parse(raw) as SignInRecord | ConsentView;
  // A page drawn before these records held more than the view: live, with no restart.
  return "view" in rec ? rec : { view: rec, q: "", b: "", t: now() };
}

async function markDone(env: Env, handle: string, now: () => number) {
  const rec = await readSignIn(env, handle, now);
  if (rec && !rec.done) await saveSignIn(env, handle, { ...rec, done: true });
}

/**
 * A random id for this browser (HttpOnly, this host only), so that a sign-in started again after
 * its page expired is finished in one step only by the browser that opened the page.
 */
const BROWSER_COOKIE = "__Host-factlot-signin";

function browserId(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === BROWSER_COOKIE) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : undefined;
    }
  }
  return undefined;
}

function browserCookie(id: string): string {
  return `${BROWSER_COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${RESTART_TTL_SECONDS}`;
}

/**
 * The key as pasted, forgivingly: spaces and line breaks anywhere are dropped (a key has none),
 * and a key inside a longer paste (`FACTLOT_API_KEY="fl_live_..."`, `Bearer fl_live_...`) is
 * picked out. Never logged or shown.
 */
export function normalizeKey(raw: string): string {
  const compact = raw.slice(0, 4096).replace(/\s+/g, "");
  return /fl_(?:live|free)_[A-Za-z0-9_-]{43}/.exec(compact)?.[0] ?? compact;
}

const START_AGAIN =
  "This sign-in page has expired or was already used. Start again from your app (Connect, or Reconnect).";

const REFRESHED =
  "This sign-in page had been open a long time, so here it is again for the same app. Nothing was connected: choose again.";

function errorPage(error: unknown): Response {
  if (error instanceof AuthorizationError)
    return oauthMessagePage(
      400,
      "Can't connect",
      error.description || START_AGAIN,
    );
  if (error instanceof CimdFetchError)
    return oauthMessagePage(
      400,
      "Can't connect",
      "This app could not be verified: its client metadata document did not load. Try again in a minute.",
    );
  throw error;
}

function redirect(location: string, headers?: Headers): Response {
  const h = headers ?? new Headers({ "cache-control": "no-store" });
  h.set("location", location);
  return new Response(null, { status: 302, headers: h });
}

/** Complete an approved request: store the grant, and send the browser back to the client. */
async function grant(
  env: Env,
  approved: { request: AuthRequest; headers: Headers },
  who:
    | {
        tier: "paid";
        subscription: string;
        via: "key" | "email";
        guest_key?: string;
      }
    | { tier: "free"; meter: string },
  view: ConsentView,
): Promise<Response> {
  const props: OAuthProps =
    who.tier === "paid"
      ? {
          v: 1,
          tier: "paid",
          subscription: who.subscription,
          ...(who.guest_key ? { guest_key: who.guest_key } : {}),
        }
      : { v: 1, tier: "free", meter: who.meter };
  const metadata: GrantMeta = {
    tier: who.tier,
    client_name: view.client.slice(0, 100),
    ...(who.tier === "paid" ? { via: who.via } : {}),
  };
  const { redirectTo } = await oauthHelpers(env).completeAuthorization({
    request: approved.request,
    userId:
      who.tier === "paid" ? await paidUserId(who.subscription) : freeUserId(),
    scope: [OAUTH_SCOPE],
    props,
    metadata,
  });
  return redirect(redirectTo, approved.headers);
}

interface OpenedConsent {
  handle: string;
  view: ConsentView;
  /** The page's restart field: this request's /authorize path and query. */
  restart: string;
  /** The binding cookie (lengthened) and the browser cookie, to send with the page. */
  headers: Headers;
}

/**
 * Check an authorization request (the GET, or a restart of it) and open a consent transaction
 * for it: a fresh handle bound to this browser, and FactLot's record of the page. A Response when
 * the request is refused.
 */
async function openConsent(
  env: Env,
  helpers: OAuthHelpers,
  authRequest: Request,
  browser: string,
  now: () => number,
): Promise<OpenedConsent | Response> {
  let req: AuthRequest;
  try {
    req = await helpers.parseAuthRequest(authRequest);
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo)
      return redirect(err.redirectTo);
    return errorPage(err);
  }
  // MCP requires PKCE with S256 for every client; the library requires it of public clients.
  if (!req.codeChallenge || req.codeChallengeMethod !== "S256")
    return redirect(
      authorizationErrorRedirect(
        req,
        "invalid_request",
        "PKCE with code_challenge_method=S256 is required",
      ),
    );
  let details;
  try {
    details = await helpers.describeConsent(req);
  } catch (err) {
    return errorPage(err);
  }
  const consent = await helpers.beginConsent(req);
  const view: ConsentView = {
    client: details.clientName,
    client_id: details.clientId,
    ...(details.clientDomain ? { domain: details.clientDomain } : {}),
    redirect_host: details.redirectHost,
    redirect_origin: new URL(details.redirectUri).origin,
    loopback: details.redirectIsLoopback,
  };
  const search = new URL(authRequest.url).search;
  await saveSignIn(env, consent.handle, {
    view,
    q: await hashKey(search),
    b: await hashKey(browser),
    t: now(),
  });
  const headers = stretchConsentCookies(consent.headers);
  headers.append("set-cookie", browserCookie(browser));
  return {
    handle: consent.handle,
    view,
    restart: `/authorize${search}`,
    headers,
  };
}

/**
 * The page's restart field, when it is exactly the authorize request the page was drawn for:
 * /authorize on this origin with the query unchanged (its digest is in the page's record).
 * Anything else is refused, so the field can never send the browser elsewhere or start another
 * request.
 */
async function restartTarget(
  field: string,
  rec: SignInRecord,
  url: URL,
): Promise<URL | undefined> {
  if (!rec.q || field.length > 8192 || !field.startsWith("/authorize?"))
    return undefined;
  let target: URL;
  try {
    target = new URL(field, url.origin);
  } catch {
    return undefined;
  }
  if (
    target.origin !== url.origin ||
    target.pathname !== "/authorize" ||
    target.hash
  )
    return undefined;
  return sameString(await hashKey(target.search), rec.q) ? target : undefined;
}

/** The consent transaction a post answers. */
interface Txn {
  handle: string;
  view: ConsentView;
  /**
   * The request that carries the transaction's binding cookie, for the library's approve and deny.
   * Undefined when this post may only redraw the page.
   */
  binding?: Request;
  /** A transaction opened by this post for the same request (the page's had ended). */
  fresh: boolean;
  /** For a redrawn page: a fresh transaction's cookies. */
  cookies?: Headers;
  restart?: string;
}

/**
 * Open a fresh transaction for the page's own request, after its transaction ended. The browser
 * that opened the page answers it in this same post: the fresh binding cookie is handed to the
 * library here, as the browser would hand it on its next post, so a key pasted after an hour
 * still connects. Any other browser gets the page again, bound to it.
 */
async function restartTxn(
  env: Env,
  helpers: OAuthHelpers,
  rec: SignInRecord,
  target: URL | undefined,
  browser: string | undefined,
  now: () => number,
): Promise<Txn | Response> {
  if (!target) return oauthMessagePage(400, "Can't connect", START_AGAIN);
  const opened = await openConsent(
    env,
    helpers,
    new Request(target),
    browser ?? randomToken(),
    now,
  );
  if (opened instanceof Response) return opened;
  const same =
    !!browser && !!rec.b && sameString(await hashKey(browser), rec.b);
  const bind = [...opened.headers]
    .filter(([k]) => k.toLowerCase() === "set-cookie")
    .map(([, v]) => v.split(";")[0]!.trim())
    .find((c) => !c.startsWith(`${BROWSER_COOKIE}=`));
  return {
    handle: opened.handle,
    view: opened.view,
    ...(same && bind
      ? { binding: new Request(target, { headers: { cookie: bind } }) }
      : {}),
    fresh: true,
    cookies: opened.headers,
    restart: opened.restart,
  };
}

async function authorizeRoute(
  request: Request,
  env: Env,
  url: URL,
  deps: OAuthRouteDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const helpers = oauthHelpers(env);
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "POST"
  )
    return json(405, { error: "MethodNotAllowed" }, { allow: "GET, POST" });
  const address = await addressSubject(
    clientAddress(request),
    now(),
    env.IP_HASH_SALT,
  );
  if (!(await env.RL_ANON.limit({ key: `oauth-authorize:${address}` })).success)
    return oauthMessagePage(
      429,
      "Too many tries",
      "Too many sign-in attempts from this address. Wait a minute, then start again from your app.",
    );
  const browser = browserId(request);
  const email = recoveryState(env) === "on";

  if (request.method !== "POST") {
    const opened = await openConsent(
      env,
      helpers,
      request,
      browser ?? randomToken(),
      now,
    );
    if (opened instanceof Response) return opened;
    return consentPage(opened.view, opened.handle, {
      email,
      cookies: opened.headers,
      restart: opened.restart,
    });
  }

  if (crossOrigin(request, url))
    return oauthMessagePage(
      403,
      "Can't connect",
      "This form only works on its own page.",
    );
  const form = await readForm(request, 16 * 1024);
  if (!form)
    return oauthMessagePage(413, "Can't connect", "The form is too large.");
  const handle = form.get("handle") ?? "";
  const rec = await readSignIn(env, handle, now);
  if (!rec) return oauthMessagePage(400, "Can't connect", START_AGAIN);
  const field = form.get("restart") ?? "";
  const target = field ? await restartTarget(field, rec, url) : undefined;
  if (field && !target)
    return oauthMessagePage(400, "Can't connect", START_AGAIN);
  if (rec.done)
    return oauthMessagePage(
      400,
      "Already used",
      `This sign-in page was already used. If ${rec.view.client.slice(0, 100)} shows FactLot as connected, you are done. If not, start again.`,
      target
        ? { href: `${target.pathname}${target.search}`, label: "Start again" }
        : undefined,
    );

  const key = normalizeKey(form.get("key") ?? "");
  let decision = form.get("decision") ?? "key";
  // Enter in the email box submits the form's first button, the key's: with no key, it means email.
  if (decision === "key" && !key && email && (form.get("email") ?? "").trim())
    decision = "email";

  // The page's own transaction while it has time left (an emailed link needs its ten minutes),
  // else a fresh one for the same request.
  let txn: Txn = {
    handle,
    view: rec.view,
    binding: request,
    fresh: false,
    ...(target ? { restart: `${target.pathname}${target.search}` } : {}),
  };
  const needed = (decision === "email" ? EMAIL_LINK_TTL_SECONDS : 60) * 1000;
  if (rec.t + CONSENT_TTL_SECONDS * 1000 - now() < needed) {
    const t = await restartTxn(env, helpers, rec, target, browser, now);
    if (t instanceof Response) return t;
    txn = t;
  }
  const again = (status: number, notice: string) =>
    consentPage(txn.view, txn.handle, {
      email,
      status,
      notice,
      ...(txn.cookies ? { cookies: txn.cookies } : {}),
      ...(txn.restart ? { restart: txn.restart } : {}),
    });
  /**
   * Approve or deny with the library. When the page's transaction turns out to have ended (or to
   * be bound to another browser), the same post goes on with a fresh one, or redraws the page.
   */
  const answer = async <T>(
    act: (binding: Request, handle: string) => Promise<T>,
  ): Promise<T | Response> => {
    if (txn.binding)
      try {
        return await act(txn.binding, txn.handle);
      } catch (err) {
        if (!(err instanceof AuthorizationError) || txn.fresh) throw err;
        const t = await restartTxn(env, helpers, rec, target, browser, now);
        if (t instanceof Response) return t;
        txn = t;
        if (txn.binding) return act(txn.binding, txn.handle);
      }
    return again(200, REFRESHED);
  };
  const finished = async () => {
    await markDone(env, handle, now);
    if (txn.handle !== handle) await markDone(env, txn.handle, now);
  };

  try {
    if (decision === "deny") {
      const denied = await answer((b, h) => helpers.denyConsent(b, h));
      if (denied instanceof Response) return denied;
      await finished();
      return redirect(denied.redirectTo, denied.headers);
    }

    if (decision === "free") {
      if (!txn.binding) return again(200, REFRESHED);
      const budget = await env.METER.consume(`oauthfree-new:${address}`, {
        kind: "day",
        limit: FREE_CONNECTIONS_PER_DAY,
        n: 1,
      });
      if (budget.granted < 1)
        return again(
          429,
          `This address has started ${FREE_CONNECTIONS_PER_DAY} free connections today. Connect with a FactLot key, or try again tomorrow.`,
        );
      const approved = await answer((b, h) =>
        helpers.approveConsent(b, h, { scope: [OAUTH_SCOPE] }),
      );
      if (approved instanceof Response) return approved;
      const meter = await freeConnectionMeter(
        clientAddress(request),
        env.IP_HASH_SALT,
      );
      await finished();
      return await grant(env, approved, { tier: "free", meter }, txn.view);
    }

    if (decision === "email") {
      const d = billingDeps(env, deps.fetchImpl, now, deps.defer);
      if (!email || !d)
        return again(
          503,
          "Email sign-in is being set up. Use your key, or continue on the free tier.",
        );
      const to = (form.get("email") ?? "").trim();
      if (to.length > 254 || !EMAIL_RE.test(to))
        return again(400, "Enter the email address you paid with.");
      if (!(await env.RL_ANON.limit({ key: `oauth-email:${address}` })).success)
        return again(429, "Too many tries from this address. Wait a minute.");
      d.defer(sendSignInLinks(d, to, txn.handle, txn.view));
      return again(
        200,
        "If that email has a FactLot subscription, a sign-in link is on its way. Open it in this browser within 10 minutes; this page can stay open.",
      );
    }

    // decision === "key"
    const failKey = `authfail:${address}`;
    if (!(await env.RL_ANON.peek({ key: failKey })).success)
      return again(429, "Too many keys that did not match. Wait a minute.");
    if (!key)
      return again(
        401,
        "Paste your FactLot key (it starts with fl_live_), or continue on the free tier.",
      );
    if (key.startsWith("fl_free_"))
      return again(
        400,
        "That is a free key (fl_free_...). Free keys do not sign in here: press Continue on the free tier instead.",
      );
    const caller = await deps.resolveKey(env, key, {
      fetchImpl: deps.fetchImpl,
      now,
    });
    if (!caller) {
      await env.RL_ANON.limit({ key: failKey });
      return again(
        401,
        "That key was not found. Check it and try again, or continue on the free tier.",
      );
    }
    if (!caller.active)
      return again(
        403,
        `This key's subscription is not active (${caller.record.hold ?? (caller.record.paused ? "paused" : caller.record.stripe_status)}). Fix billing at factlot.com/account, or continue on the free tier.`,
      );
    const approved = await answer((b, h) =>
      helpers.approveConsent(b, h, { scope: [OAUTH_SCOPE] }),
    );
    if (approved instanceof Response) return approved;
    await finished();
    return await grant(
      env,
      approved,
      {
        tier: "paid",
        subscription: caller.record.subscription,
        via: "key",
        ...(caller.record.guest ? { guest_key: keyId(caller.hash) } : {}),
      },
      txn.view,
    );
  } catch (err) {
    return errorPage(err);
  }
}

// --- Email sign-in links -----------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,252}\.[^\s@<>"]{2,}$/;
const LINK_RE = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

interface LinkRecord {
  subscription: string;
  handle: string;
  view: ConsentView;
  expires_at: string;
  used_at?: string;
}

async function signLink(secret: string, id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`factlot-oauth-signin|${id}`),
      ),
    ),
  );
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * After the answer: find the subscriptions of that email (recovery's Stripe lookup), and email
 * one link per subscription that continues this sign-in. Never logs the address or a link.
 */
export async function sendSignInLinks(
  d: BillingDeps,
  email: string,
  handle: string,
  view: ConsentView,
): Promise<void> {
  const { env, now } = d;
  const secret = env.RECOVERY_SIGNING_SECRET;
  if (!secret) return;
  try {
    const wait = `${KV_PREFIX}emailwait:${await hashKey(email.toLowerCase())}`;
    if (await env.KEYS.get(wait)) return;
    await env.KEYS.put(wait, "1", { expirationTtl: EMAIL_LINK_RESEND_SECONDS });
    const subs = await subscriptionsForEmail(d, email);
    if (subs.length === 0) return;
    const links: string[] = [];
    for (const s of subs) {
      const id = randomToken();
      const rec: LinkRecord = {
        subscription: s.subscription,
        handle,
        view,
        expires_at: new Date(
          now() + EMAIL_LINK_TTL_SECONDS * 1000,
        ).toISOString(),
      };
      await env.KEYS.put(
        `${KV_PREFIX}link:${await hashKey(id)}`,
        JSON.stringify(rec),
        { expirationTtl: EMAIL_LINK_TTL_SECONDS },
      );
      links.push(
        `${PLANS[s.record.plan].name}:\n${apiBase(env)}${EMAIL_LINK_PREFIX}${id}.${await signLink(secret, id)}`,
      );
    }
    const client = view.client.replace(/[\r\n]/g, " ").slice(0, 100);
    const text = [
      `Someone (we hope you) asked to connect "${client}" to a FactLot subscription with this email address.`,
      `Open the link for the plan to connect, in the browser where you started:\n\n${links.join("\n\n")}`,
      "Each link works once and expires in 10 minutes. If you did not ask for this, ignore this email: nothing is connected until a link is used.",
    ].join("\n\n");
    await sendEmail(env, "signin", {
      to: email,
      subject: "Connect your app to FactLot",
      text: `${text}\n`,
    });
  } catch (err) {
    logStripeError("oauth email lookup", err, { message: false });
  }
}

async function emailLinkRoute(
  request: Request,
  env: Env,
  url: URL,
  token: string,
  deps: OAuthRouteDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "POST"
  )
    return json(405, { error: "MethodNotAllowed" }, { allow: "GET, POST" });
  const secret = env.RECOVERY_SIGNING_SECRET;
  const m = LINK_RE.exec(token);
  const invalid = () =>
    oauthMessagePage(
      404,
      "Sign-in link",
      "This sign-in link is not valid, has expired (links last 10 minutes) or was already used. Start again from your app.",
    );
  if (recoveryState(env) !== "on" || !secret || !m) return invalid();
  if (!sameString(m[2]!, await signLink(secret, m[1]!))) return invalid();
  if (request.method === "POST") {
    if (crossOrigin(request, url))
      return oauthMessagePage(
        403,
        "Can't connect",
        "This form only works on its own page.",
      );
    const address = await addressSubject(
      clientAddress(request),
      now(),
      env.IP_HASH_SALT,
    );
    if (
      !(await env.RL_ANON.limit({ key: `oauth-authorize:${address}` })).success
    )
      return oauthMessagePage(
        429,
        "Too many tries",
        "Wait a minute, then try again.",
      );
  }
  const linkHash = await hashKey(m[1]!);
  const linkKey = `${KV_PREFIX}link:${linkHash}`;
  const raw = await env.KEYS.get(linkKey);
  if (!raw) return invalid();
  const rec = JSON.parse(raw) as LinkRecord;
  if (rec.used_at || now() > Date.parse(rec.expires_at)) return invalid();
  const newest = ownerKeys(await liveKeys(env.KEYS, rec.subscription)).at(-1);
  if (!newest) return invalid();
  const plan = PLANS[newest.record.plan as PlanId];
  const active = deriveStatus(newest.record) === "active";
  if (request.method !== "POST")
    return emailLinkPage(rec.view, plan, url.pathname, active);
  if (!active) return emailLinkPage(rec.view, plan, url.pathname, false, 403);
  // Once, even when two clicks race.
  const mine = randomToken();
  if ((await env.METER.claim(`oauthlink:${linkHash}`, mine)) !== mine)
    return invalid();
  await env.KEYS.put(
    linkKey,
    JSON.stringify({ ...rec, used_at: new Date(now()).toISOString() }),
    { expirationTtl: EMAIL_LINK_TTL_SECONDS },
  );
  try {
    const approved = await oauthHelpers(env).approveConsent(
      request,
      rec.handle,
      {
        scope: [OAUTH_SCOPE],
      },
    );
    await markDone(env, rec.handle, now);
    return await grant(
      env,
      approved,
      { tier: "paid", subscription: rec.subscription, via: "email" },
      rec.view,
    );
  } catch (err) {
    if (err instanceof AuthorizationError)
      return oauthMessagePage(
        400,
        "Can't connect",
        "Open the link in the browser where you started connecting, within an hour of opening that sign-in page. Or start again from your app.",
      );
    throw err;
  }
}
