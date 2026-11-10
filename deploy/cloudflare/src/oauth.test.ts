import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateKey,
  hashKey,
  readKey,
  writeKey,
  type KeyRecord,
} from "./keys.ts";
import {
  RateLimiterObject,
  objectLimiter,
  objectMeter,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  FREE_CONNECTIONS_PER_DAY,
  isOAuthToken,
  listConnections,
  paidUserId,
  prefixedKV,
  type ListableKV,
} from "./oauth.ts";
import { handle } from "./router.ts";
import type { Env, Fetcher, RateLimit } from "./types.ts";

// --- Fakes ---------------------------------------------------------------------------------------

/** KV with what the OAuth library uses: JSON reads, metadata, TTLs and prefix listing. */
class MemoryKV implements ListableKV {
  readonly data = new Map<string, { value: string; metadata?: unknown }>();
  readonly ttl = new Map<string, number | undefined>();
  async get(k: string, o?: { type: "json" }): Promise<never> {
    const v = this.data.get(k)?.value;
    if (v === undefined) return null as never;
    return (o?.type === "json" ? JSON.parse(v) : v) as never;
  }
  async put(
    k: string,
    value: string,
    o?: { expirationTtl?: number; metadata?: unknown },
  ) {
    this.data.set(k, { value, metadata: o?.metadata });
    this.ttl.set(k, o?.expirationTtl);
  }
  async delete(k: string) {
    this.data.delete(k);
  }
  async list(o: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const all = [...this.data.keys()]
      .filter((k) => k.startsWith(o.prefix ?? ""))
      .sort();
    const start = o.cursor ? Number(o.cursor) : 0;
    const limit = o.limit ?? 1000;
    const page = all.slice(start, start + limit);
    const done = start + limit >= all.length;
    return {
      keys: page.map((name) => ({
        name,
        metadata: this.data.get(name)?.metadata,
      })),
      list_complete: done,
      ...(done ? {} : { cursor: String(start + limit) }),
    };
  }
}

class CountingLimit implements RateLimit {
  readonly seen: string[] = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async limit({ key }: { key: string }) {
    this.seen.push(key);
    return { success: this.seen.filter((k) => k === key).length <= this.max };
  }
  async peek({ key }: { key: string }) {
    return { success: this.seen.filter((k) => k === key).length < this.max };
  }
}

class MemoryStore implements CounterStore {
  readonly counts = new Map<string, number>();
  readonly claims = new Map<string, string>();
  readonly usage = new Map<string, number>();
  readonly meta = new Map<string, string>();
  getCount(w: string) {
    return this.counts.get(w) ?? 0;
  }
  setCount(w: string, n: number) {
    this.counts.set(w, n);
  }
  pruneBefore(w: string) {
    const kind = w.slice(0, w.indexOf(":") + 1);
    for (const k of [...this.counts.keys()])
      if (k.startsWith(kind) && k < w) this.counts.delete(k);
  }
  getClaim(n: string) {
    return this.claims.get(n);
  }
  setClaim(n: string, v: string) {
    if (!this.claims.has(n)) this.claims.set(n, v);
  }
  addUsage(day: string, tool: string, region: string, n: number) {
    const k = `${day}|${tool}|${region}`;
    this.usage.set(k, (this.usage.get(k) ?? 0) + n);
  }
  readUsage(fromDay: string) {
    return [...this.usage.entries()]
      .map(([k, n]) => {
        const [day, tool, region] = k.split("|") as [string, string, string];
        return { day, tool, region, n };
      })
      .filter((r) => r.day >= fromDay);
  }
  pruneUsageBefore() {}
  getMeta(n: string) {
    return this.meta.get(n);
  }
  setMeta(n: string, v: string) {
    this.meta.set(n, v);
  }
  deleteMeta(n: string) {
    this.meta.delete(n);
  }
  size() {
    return this.counts.size + this.claims.size + this.usage.size;
  }
  clearClaims() {
    this.claims.clear();
  }
  reset() {}
}

/** The LIMITER namespace: real RateLimiterObjects over memory stores, on the real clock. */
function fakeLimiter(): DurableObjectNamespaceLike {
  const objects = new Map<string, RateLimiterObject>();
  const object = (name: string) => {
    let o = objects.get(name);
    if (!o) {
      o = new RateLimiterObject(
        {
          storage: {
            sql: {
              exec() {
                throw new Error("memory store in tests");
              },
            },
            getAlarm: async () => null,
            setAlarm: async () => {},
            deleteAll: async () => {},
          },
        },
        {},
        { store: new MemoryStore(), now: () => Date.now() },
      );
      objects.set(name, o);
    }
    return o;
  };
  return {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (input: string, init?: RequestInit) =>
        object(String(id)).fetch(new Request(input, init)),
    }),
  };
}

type TestEnv = Env & { KEYS: MemoryKV; RL_ANON: CountingLimit };

function env(over: Partial<Env> = {}): TestEnv {
  const ns = fakeLimiter();
  return {
    KEYS: new MemoryKV(),

    REPORTS_ENABLED: "true",
    RL_ANON: new CountingLimit(20),
    RL_CLAIM: objectLimiter(ns, "claim", 1, 2000),
    METER: objectMeter(ns),
    IP_HASH_SALT: "salt",
    ...over,
  } as TestEnv;
}

/** The inner handler: every MCP message with an id gets `{}` (a charged answer for registry tools). */
const inner: Fetcher = {
  fetch: async (r: Request) => {
    const text = await r.text();
    if (new URL(r.url).pathname !== "/mcp")
      return new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      });
    const parsed = JSON.parse(text) as { id?: unknown; method?: string };
    if (parsed.id === undefined) return new Response(null, { status: 202 });
    const result =
      parsed.method === "tools/list"
        ? { tools: [{ name: "calc_noi" }] }
        : { content: [{ type: "text", text: "{}" }] };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  },
};

const API = "https://api.factlot.com";
const IP = "198.51.100.7";
const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function send(
  e: Env,
  path: string,
  init: RequestInit & { ip?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? IP);
  return handle(new Request(`${API}${path}`, { ...init, headers }), e, inner);
}

const record = (over: Partial<KeyRecord> = {}): KeyRecord => ({
  plan: "pro",
  status: "active",
  customer: "cus_1",
  subscription: "sub_1",
  stripe_status: "active",
  created: "2026-11-03T00:00:00Z",
  checked_at: Date.now(),
  ...over,
});

async function issue(
  e: Env,
  over: Partial<KeyRecord> = {},
): Promise<{ key: string; hash: string }> {
  const key = generateKey();
  const hash = await hashKey(key);
  const rec = record(over);
  await writeKey(e.KEYS, hash, rec);
  const listKey = `sub:${rec.subscription}`;
  const list = JSON.parse((await e.KEYS.get(listKey)) ?? "[]") as string[];
  await e.KEYS.put(listKey, JSON.stringify([...list, hash]));
  return { key, hash };
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function register(
  e: Env,
  body: Record<string, unknown> = {},
): Promise<{ res: Response; client_id: string }> {
  const res = await send(e, "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [CLAUDE_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...body,
    }),
  });
  const json = (await res.clone().json()) as { client_id?: string };
  return { res, client_id: json.client_id ?? "" };
}

interface Consent {
  res: Response;
  handle: string;
  cookie: string;
  html: string;
}

async function authorize(
  e: Env,
  clientId: string,
  challenge: string,
  over: Record<string, string> = {},
): Promise<Consent> {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-123",
    scope: "mcp",
    resource: `${API}/mcp`,
    ...over,
  });
  const res = await send(e, `/authorize?${q}`);
  const html = await res.clone().text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { res, handle, cookie, html };
}

function decide(
  e: Env,
  c: Consent,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  ip?: string,
): Promise<Response> {
  return send(e, "/authorize", {
    method: "POST",
    ...(ip ? { ip } : {}),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: API,
      cookie: c.cookie,
      ...headers,
    },
    body: new URLSearchParams({ handle: c.handle, ...fields }).toString(),
  });
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function token(
  e: Env,
  fields: Record<string, string>,
): Promise<{ res: Response; body: Tokens & { error?: string } }> {
  const res = await send(e, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return {
    res,
    body: (await res.clone().json()) as Tokens & { error?: string },
  };
}

/** Register, sign in with `decision`, exchange the code: the whole dance a client performs. */
async function connect(
  e: Env,
  fields: Record<string, string>,
  /** The address the person signs in from (the consent page). */
  ip?: string,
): Promise<{ client_id: string; tokens: Tokens }> {
  const { client_id } = await register(e);
  const p = await pkce();
  const c = await authorize(e, client_id, p.challenge);
  const res = await decide(e, c, fields, {}, ip);
  assert.equal(res.status, 302, await res.clone().text());
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const { body } = await token(e, {
    grant_type: "authorization_code",
    code,
    redirect_uri: CLAUDE_REDIRECT,
    client_id,
    code_verifier: p.verifier,
    resource: `${API}/mcp`,
  });
  assert.ok(body.access_token, JSON.stringify(body));
  return { client_id, tokens: body };
}

function mcp(
  e: Env,
  bearer: string | undefined,
  message: unknown,
  path = "/mcp",
  ip = IP,
): Promise<Response> {
  return send(e, path, {
    method: "POST",
    ip,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(message),
  });
}

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const lookup = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "registry_get", arguments: { urn: "fl:parcel:us-24-005:1" } },
});

// --- Tests ---------------------------------------------------------------------------------------

describe("OAuth discovery", () => {
  it("serves RFC 9728 protected resource metadata at the path-aware and root URLs", async () => {
    const e = env();
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const res = await send(e, path);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.resource, `${API}/mcp`);
      assert.deepEqual(body.authorization_servers, [API]);
      assert.deepEqual(body.scopes_supported, ["mcp"]);
      assert.deepEqual(body.bearer_methods_supported, ["header"]);
    }
  });

  it("serves RFC 8414 authorization server metadata", async () => {
    const res = await send(env(), "/.well-known/oauth-authorization-server");
    assert.equal(res.status, 200);
    const m = (await res.json()) as Record<string, unknown>;
    assert.equal(m.issuer, API);
    assert.equal(m.authorization_endpoint, `${API}/authorize`);
    assert.equal(m.token_endpoint, `${API}/token`);
    assert.equal(m.registration_endpoint, `${API}/register`);
    assert.equal(m.revocation_endpoint, `${API}/token`);
    assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(m.scopes_supported, ["mcp"]);
    assert.deepEqual(m.response_types_supported, ["code"]);
    assert.ok((m.grant_types_supported as string[]).includes("refresh_token"));
    assert.equal(m.authorization_response_iss_parameter_supported, true);
    assert.equal(m.client_id_metadata_document_supported, true);
  });

  it("is only on the API host: factlot.com/authorize is the landing site", async () => {
    let served = "";
    const assets: Fetcher = {
      fetch: async (r) => {
        served = new URL(r.url).pathname;
        return new Response("site");
      },
    };
    const res = await handle(
      new Request("https://factlot.com/.well-known/oauth-authorization-server"),
      env({ ASSETS: assets }),
      inner,
    );
    assert.equal(await res.text(), "site");
    assert.equal(served, "/.well-known/oauth-authorization-server");
  });
});

describe("the 401 challenge", () => {
  it("bare /mcp without credentials stays open on the free tier", async () => {
    const res = await mcp(env(), undefined, LIST);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-factlot-tier"), "anonymous");
  });

  it("/mcp/signin without credentials answers 401 with resource_metadata and scope", async () => {
    const res = await mcp(env(), undefined, LIST, "/mcp/signin");
    assert.equal(res.status, 401);
    const h = res.headers.get("www-authenticate") ?? "";
    assert.match(h, /^Bearer /);
    assert.match(
      h,
      /resource_metadata="https:\/\/api\.factlot\.com\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
    assert.match(h, /scope="mcp"/);
    assert.doesNotMatch(h, /error=/);
    assert.match(
      res.headers.get("access-control-expose-headers") ?? "",
      /www-authenticate/i,
    );
  });

  it("a bad token at /mcp answers 401 invalid_token with the challenge", async () => {
    const e = env();
    for (const bad of ["u:g:not-a-real-token-secret", generateKey()]) {
      const res = await mcp(e, bad, LIST);
      assert.equal(res.status, 401);
      const h = res.headers.get("www-authenticate") ?? "";
      assert.match(h, /error="invalid_token"/);
      assert.match(h, /resource_metadata="[^"]+\/mcp"/);
      const body = (await res.json()) as { error: { code: number } };
      assert.equal(body.error.code, -32001);
    }
  });

  it("REST keeps the plain challenge, and OAuth tokens are refused there", async () => {
    const e = env();
    const { tokens } = await connect(e, { decision: "free" });
    const res = await send(e, "/v1/tools", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="factlot"');
    assert.match(
      ((await res.json()) as { message: string }).message,
      /only at \/mcp/,
    );
  });
});

describe("dynamic client registration", () => {
  it("registers a public client with an https redirect", async () => {
    const { res, client_id } = await register(env());
    assert.equal(res.status, 201);
    assert.ok(client_id);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.token_endpoint_auth_method, "none");
    assert.deepEqual(body.redirect_uris, [CLAUDE_REDIRECT]);
  });

  it("accepts loopback redirects (local clients) and refuses remote http", async () => {
    const e = env();
    assert.equal(
      (
        await register(e, {
          redirect_uris: ["http://localhost:6274/oauth/callback"],
        })
      ).res.status,
      201,
    );
    assert.equal(
      (await register(e, { redirect_uris: ["http://127.0.0.1:33418/"] })).res
        .status,
      201,
    );
    assert.equal(
      (await register(e, { redirect_uris: ["http://evil.example/cb"] })).res
        .status,
      400,
    );
    assert.equal(
      (await register(e, { redirect_uris: ["javascript:alert(1)"] })).res
        .status,
      400,
    );
  });

  it("refuses an oversized name or too many redirects", async () => {
    const e = env();
    assert.equal(
      (await register(e, { client_name: "x".repeat(101) })).res.status,
      400,
    );
    const many = Array.from(
      { length: 11 },
      (_, i) => `https://a.example/cb${i}`,
    );
    assert.equal((await register(e, { redirect_uris: many })).res.status, 400);
  });

  it("is rate limited per address", async () => {
    const e = env();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await register(e)).res.status;
    assert.equal(last, 429);
  });
});

describe("sign in with a key: authorization code + PKCE", () => {
  it("runs the whole flow and the token gets the plan of the key", async () => {
    const e = env();
    const { key } = await issue(e);
    const { client_id } = await register(e);
    const p = await pkce();
    const c = await authorize(e, client_id, p.challenge);

    // The consent page: who asks, where access goes, strict headers, the browser-bound cookie.
    assert.equal(c.res.status, 200);
    assert.match(c.html, /Connect Claude to FactLot/);
    assert.match(c.html, /<code>claude\.ai<\/code>/);
    assert.match(c.html, /registered itself/);
    assert.match(c.html, /Continue on the free tier/);
    assert.doesNotMatch(c.html, /Email me a sign-in link/);
    const csp = c.res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self' https:\/\/claude\.ai/);
    assert.match(c.cookie, /^__Host-oauth-consent-/);
    assert.match(c.res.headers.get("set-cookie") ?? "", /HttpOnly/i);

    const res = await decide(e, c, { decision: "key", key });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location")!);
    assert.equal(loc.origin + loc.pathname, CLAUDE_REDIRECT);
    assert.equal(loc.searchParams.get("state"), "st-123");
    assert.equal(loc.searchParams.get("iss"), API);
    const code = loc.searchParams.get("code")!;
    assert.ok(code);

    // A wrong verifier is refused.
    const wrong = await token(e, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id,
      code_verifier: (await pkce()).verifier,
    });
    assert.equal(wrong.res.status, 400);
    assert.equal(wrong.body.error, "invalid_grant");

    // A fresh flow, then the right verifier.
    const c2 = await authorize(e, client_id, p.challenge);
    const res2 = await decide(e, c2, { decision: "key", key });
    const code2 = new URL(res2.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const ok = await token(e, {
      grant_type: "authorization_code",
      code: code2,
      redirect_uri: CLAUDE_REDIRECT,
      client_id,
      code_verifier: p.verifier,
      resource: `${API}/mcp`,
    });
    assert.equal(ok.res.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.token_type.toLowerCase(), "bearer");
    assert.equal(ok.body.expires_in, ACCESS_TOKEN_TTL_SECONDS);
    assert.equal(ok.body.scope, "mcp");
    assert.ok(ok.body.refresh_token);
    assert.ok(isOAuthToken(ok.body.access_token));
    assert.ok(
      !ok.body.access_token.includes("sub_1"),
      "no Stripe ids in tokens",
    );

    // The token is the plan: tier, rate limit and the hosted account tools.
    const call = await mcp(e, ok.body.access_token, LIST);
    assert.equal(call.status, 200);
    assert.equal(call.headers.get("x-factlot-tier"), "pro");
    assert.equal(call.headers.get("x-ratelimit-limit"), "600");
    const names = (
      (await call.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((t) => t.name);
    assert.ok(names.includes("account_status"));

    // The same token through the sign-in alias.
    const alias = await mcp(e, ok.body.access_token, LIST, "/mcp/signin");
    assert.equal(alias.status, 200);
    assert.equal(alias.headers.get("x-factlot-tier"), "pro");
    // The code works once; replaying it revokes what it issued (OAuth 2.1 section 4.1.3).
    const replay = await token(e, {
      grant_type: "authorization_code",
      code: code2,
      redirect_uri: CLAUDE_REDIRECT,
      client_id,
      code_verifier: p.verifier,
    });
    assert.equal(replay.body.error, "invalid_grant");

    assert.equal((await mcp(e, ok.body.access_token, LIST)).status, 401);
  });

  it("refuses a request without PKCE S256, back to the client", async () => {
    const e = env();
    const { client_id } = await register(e);
    const plain = await authorize(e, client_id, "x".repeat(43), {
      code_challenge_method: "plain",
    });
    assert.equal(plain.res.status, 302);
    const loc = new URL(plain.res.headers.get("location")!);
    assert.equal(loc.searchParams.get("error"), "invalid_request");
    assert.equal(loc.searchParams.get("state"), "st-123");
    const none = await send(
      e,
      `/authorize?${new URLSearchParams({ response_type: "code", client_id, redirect_uri: CLAUDE_REDIRECT, state: "s" })}`,
    );
    assert.equal(none.status, 302);
    assert.equal(
      new URL(none.headers.get("location")!).searchParams.get("error"),
      "invalid_request",
    );
  });

  it("never redirects to an unregistered redirect URI", async () => {
    const e = env();
    const { client_id } = await register(e);
    const c = await authorize(e, client_id, (await pkce()).challenge, {
      redirect_uri: "https://claude.ai/api/mcp/auth_callback/other",
    });
    assert.equal(c.res.status, 400);
    assert.equal(c.res.headers.get("location"), null);
  });

  it("redraws the page for a wrong key, and binds the form to the browser", async () => {
    const e = env();
    await issue(e);
    const { client_id } = await register(e);
    const c = await authorize(e, client_id, (await pkce()).challenge);
    const bad = await decide(e, c, { decision: "key", key: generateKey() });
    assert.equal(bad.status, 401);
    const html = await bad.text();
    assert.match(html, /That key was not found/);
    assert.match(html, /Connect Claude to FactLot/);
    // Another browser (no cookie) cannot use the handle.
    const other = await decide(e, { ...c, cookie: "" }, { decision: "free" });
    assert.equal(other.status, 400);
    // A form on another site cannot post it.
    const forged = await decide(
      e,
      c,
      { decision: "free" },
      { origin: "https://evil.example" },
    );
    assert.equal(forged.status, 403);
  });

  it("refuses a key whose subscription is inactive", async () => {
    const e = env();
    const { key } = await issue(e, { stripe_status: "unpaid" });
    const { client_id } = await register(e);
    const c = await authorize(e, client_id, (await pkce()).challenge);
    const res = await decide(e, c, { decision: "key", key });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /not active \(unpaid\)/);
  });

  it("cancel sends access_denied back to the client", async () => {
    const e = env();
    const { client_id } = await register(e);
    const c = await authorize(e, client_id, (await pkce()).challenge);
    const res = await decide(e, c, { decision: "deny" });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location")!);
    assert.equal(loc.searchParams.get("error"), "access_denied");
    assert.equal(loc.searchParams.get("state"), "st-123");
  });
});

describe("refresh tokens", () => {
  it("rotate on use, and the replaced one stops once the new one is used", async () => {
    const e = env();
    const { key } = await issue(e);
    const { client_id, tokens } = await connect(e, { decision: "key", key });
    const first = await token(e, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id,
    });
    assert.equal(first.res.status, 200, JSON.stringify(first.body));
    assert.notEqual(first.body.refresh_token, tokens.refresh_token);
    assert.notEqual(first.body.access_token, tokens.access_token);
    assert.equal((await mcp(e, first.body.access_token, LIST)).status, 200);
    const second = await token(e, {
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id,
    });
    assert.equal(second.res.status, 200);
    const stale = await token(e, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id,
    });
    assert.equal(stale.body.error, "invalid_grant");
  });

  it("are bound to the client they were issued to", async () => {
    const e = env();
    const { key } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    const { client_id: other } = await register(e, { client_name: "Other" });
    const res = await token(e, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: other,
    });
    assert.equal(res.res.status, 400);
    assert.equal(res.body.error, "invalid_grant");
  });

  it("are revoked with RFC 7009 at the token endpoint", async () => {
    const e = env();
    const { key } = await issue(e);
    const { client_id, tokens } = await connect(e, { decision: "key", key });
    const res = await send(e, "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: tokens.refresh_token,
        client_id,
      }).toString(),
    });
    assert.equal(res.status, 200);
    assert.equal((await mcp(e, tokens.access_token, LIST)).status, 401);
  });
});

describe("the connection follows the subscription, not the key", () => {
  it("keeps working after the key is replaced, and takes the new plan", async () => {
    const e = env();
    const { key, hash } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    const old = (await readKey(e.KEYS, hash))!;
    await writeKey(e.KEYS, hash, { ...old, replaced_by: "abc" });
    await issue(e, { plan: "team", created: "2026-11-05T00:00:00Z" });
    const res = await mcp(e, tokens.access_token, LIST);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-factlot-tier"), "team");
    assert.equal(res.headers.get("x-ratelimit-limit"), "3000");
  });

  it("answers 403 while the subscription is unpaid, like a key", async () => {
    const e = env();
    const { key, hash } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    await writeKey(e.KEYS, hash, {
      ...(await readKey(e.KEYS, hash))!,
      stripe_status: "unpaid",
    });
    const res = await mcp(e, tokens.access_token, LIST);
    assert.equal(res.status, 403);
    assert.match(await res.text(), /SubscriptionInactive/);
  });

  it("is revoked once the subscription is cancelled: 401, and the client signs in again", async () => {
    const e = env();
    const { key, hash } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    assert.equal((await listConnections(e, "sub_1")).length, 1);
    await writeKey(e.KEYS, hash, {
      ...(await readKey(e.KEYS, hash))!,
      stripe_status: "canceled",
    });
    const res = await mcp(e, tokens.access_token, LIST);
    assert.equal(res.status, 401);
    assert.match(
      res.headers.get("www-authenticate") ?? "",
      /error="invalid_token"/,
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal((await listConnections(e, "sub_1")).length, 0);
  });
});

describe("free tier through OAuth", () => {
  it("issues a token with the anonymous limits, one allowance per sign-in address", async () => {
    const e = env();
    const a = await connect(e, { decision: "free" });
    const b = await connect(e, { decision: "free" });
    const res = await mcp(e, a.tokens.access_token, lookup(1));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-factlot-tier"), "anonymous");
    assert.equal(res.headers.get("x-ratelimit-limit"), "60");
    assert.equal(res.headers.get("x-factlot-registry-quota-limit"), "25");
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "24");
    // A second free connection started from the same address shares the allowance: a new
    // connection is not a new day's lookups. Keyless calls (a hosted client's own address)
    // count apart.
    const other = await mcp(e, b.tokens.access_token, lookup(2));
    assert.equal(other.headers.get("x-factlot-registry-quota-remaining"), "23");
    const keyless = await mcp(e, undefined, lookup(3));
    assert.equal(
      keyless.headers.get("x-factlot-registry-quota-remaining"),
      "24",
    );
    const again = await mcp(e, a.tokens.access_token, lookup(4));
    assert.equal(again.headers.get("x-factlot-registry-quota-remaining"), "22");
    // No account tools for a free connection.
    const list = await mcp(e, a.tokens.access_token, LIST);
    assert.doesNotMatch(await list.text(), /account_status/);
  });

  it("gives free connections started from different addresses their own allowance", async () => {
    const e = env();
    const a = await connect(e, { decision: "free" });
    const b = await connect(e, { decision: "free" }, "198.51.100.77");
    await mcp(e, a.tokens.access_token, lookup(1));
    const res = await mcp(e, b.tokens.access_token, lookup(2));
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "24");
  });

  it("caps new free connections per address per day", async () => {
    const e = env({ RL_ANON: new CountingLimit(1000) });
    const { client_id } = await register(e);
    let status = 0;
    for (let i = 0; i <= FREE_CONNECTIONS_PER_DAY; i++) {
      const c = await authorize(e, client_id, (await pkce()).challenge);
      status = (await decide(e, c, { decision: "free" })).status;
    }
    assert.equal(status, 429);
  });

  it("says 'per connection' when the daily lookups run out", async () => {
    const e = env();
    const { tokens } = await connect(e, { decision: "free" });
    let res: Response | undefined;
    for (let i = 0; i < 26; i++)
      res = await mcp(e, tokens.access_token, lookup(i + 10));
    const body = (await res!.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(body.result.isError, true);
    assert.match(
      body.result.content[0]!.text,
      /25 a day per sign-in address \(shared by its free connections\)/,
    );
  });

  it("gives unanswered per-subject lookups back to the connection, and names its shortfall", async () => {
    const e = env();
    const { tokens } = await connect(e, { decision: "free" });
    const batch = (id: number, n: number) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "registry_tx_equity_candidates_batch",
        arguments: {
          subjects: Array.from({ length: n }, (_, i) => ({
            id: `s${i}`,
            county_fips: "48453",
            apn: String(i),
          })),
        },
      },
    });
    // The stub answers without `results`: all three reserved lookups go back to this connection.
    const res = await mcp(e, tokens.access_token, batch(1, 3));
    assert.equal(res.headers.get("x-factlot-registry-quota-remaining"), "25");
    const next = await mcp(e, tokens.access_token, lookup(2));
    assert.equal(next.headers.get("x-factlot-registry-quota-remaining"), "24");
    for (let i = 0; i < 22; i++)
      await mcp(e, tokens.access_token, lookup(i + 10));
    const short = await mcp(e, tokens.access_token, batch(3, 3));
    const body = (await short.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(body.result.isError, true);
    const error = JSON.parse(body.result.content[0]!.text) as {
      message: string;
      needed: number;
      available: number;
    };
    assert.match(
      error.message,
      /needs 3 registry lookups .* only 2 of today's 25 free lookups for this sign-in address \(shared by its free connections\) are left/,
    );
    assert.equal(error.needed, 3);
    assert.equal(error.available, 2);
  });
});

describe("quota accounting", () => {
  it("a lookup through a token counts exactly like one through a key", async () => {
    const e = env();
    const { key } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    const viaKey = await mcp(e, key, lookup(1));
    assert.equal(viaKey.headers.get("x-factlot-registry-quota-limit"), "5000");
    assert.equal(
      viaKey.headers.get("x-factlot-registry-quota-remaining"),
      "4999",
    );
    const viaToken = await mcp(e, tokens.access_token, lookup(2));
    assert.equal(
      viaToken.headers.get("x-factlot-registry-quota-remaining"),
      "4998",
    );
    const viaKeyAgain = await mcp(e, key, lookup(3));
    assert.equal(
      viaKeyAgain.headers.get("x-factlot-registry-quota-remaining"),
      "4997",
    );
    const q = await e.METER.quota("sub:sub_1", "month", 5000);
    assert.equal(q.used, 3);
    // registry_coverage stays free either way.
    const coverage = await mcp(e, tokens.access_token, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "registry_coverage", arguments: {} },
    });
    assert.equal(
      coverage.headers.get("x-factlot-registry-quota-remaining"),
      "4997",
    );
  });
});

describe("connected apps", () => {
  it("are listed by GET /v1/account and disconnected by DELETE", async () => {
    const e = env();
    const { key } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    await mcp(e, tokens.access_token, LIST);
    const acct = await send(e, "/v1/account", {
      headers: { authorization: `Bearer ${key}` },
    });
    const body = (await acct.json()) as {
      plan: string;
      connections: {
        id: string;
        client: string;
        last_used_at: string | null;
      }[];
    };
    assert.equal(body.plan, "pro");
    assert.equal(body.connections.length, 1);
    assert.equal(body.connections[0]!.client, "Claude");
    assert.ok(body.connections[0]!.last_used_at);
    const id = body.connections[0]!.id;
    const nope = await send(e, "/v1/account/connections/nope", {
      method: "DELETE",
      headers: { authorization: `Bearer ${key}` },
    });
    assert.equal(nope.status, 404);
    const del = await send(e, `/v1/account/connections/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${key}` },
    });
    assert.equal(del.status, 200);
    assert.equal((await mcp(e, tokens.access_token, LIST)).status, 401);
  });

  it("are shown on /account with a Disconnect button that works", async () => {
    const e = env();
    const { key } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    const page = await send(e, "/account", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: API,
      },
      body: new URLSearchParams({ key }).toString(),
    });
    const html = await page.text();
    assert.match(html, /Connected apps/);
    const id =
      /name="id" value="([^"]+)"><button type="submit" class="link" name="action" value="disconnect"/.exec(
        html,
      )?.[1];
    assert.ok(id, "a disconnect form");
    const res = await send(e, "/account", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: API,
      },
      body: new URLSearchParams({ key, action: "disconnect", id }).toString(),
    });
    assert.match(await res.text(), /The app is disconnected/);
    assert.equal((await mcp(e, tokens.access_token, LIST)).status, 401);
  });

  it("re-connecting the same app replaces its earlier grant", async () => {
    const e = env();
    const { key } = await issue(e);
    const { client_id } = await register(e);
    for (let i = 0; i < 2; i++) {
      const c = await authorize(e, client_id, (await pkce()).challenge);
      assert.equal((await decide(e, c, { decision: "key", key })).status, 302);
    }
    assert.equal((await listConnections(e, "sub_1")).length, 1);
  });
});

describe("storage", () => {
  it("keeps the library's records under oauth: in KEYS, with no secrets in names or values", async () => {
    const e = env();
    const { key } = await issue(e);
    const { tokens } = await connect(e, { decision: "key", key });
    const names = [...e.KEYS.data.keys()];
    const oauthNames = names.filter((n) => n.startsWith("oauth:"));
    assert.ok(oauthNames.some((n) => n.startsWith("oauth:grant:")));
    assert.ok(oauthNames.some((n) => n.startsWith("oauth:token:")));
    assert.ok(oauthNames.some((n) => n.startsWith("oauth:client:")));
    const secret = tokens.access_token.split(":")[2]!;
    const refresh = tokens.refresh_token.split(":")[2]!;
    for (const [n, v] of e.KEYS.data) {
      for (const s of [secret, refresh, key]) {
        assert.ok(!n.includes(s), `name ${n}`);
        assert.ok(!v.value.includes(s), `value of ${n}`);
      }
      if (n.startsWith("oauth:"))
        assert.ok(!v.value.includes("sub_1"), `props encrypted in ${n}`);
    }
    const user = await paidUserId("sub_1");
    assert.ok(oauthNames.some((n) => n.startsWith(`oauth:grant:${user}:`)));
  });

  it("prefixedKV lists and strips the prefix", async () => {
    const kv = new MemoryKV();
    const p = prefixedKV(kv, "x:");
    await p.put("a:1", "1", { metadata: { m: 1 } });
    await kv.put("a:2", "outside");
    const listed = await p.list({ prefix: "a:" });
    assert.deepEqual(
      listed.keys.map((k) => k.name),
      ["a:1"],
    );
    assert.deepEqual(listed.keys[0]!.metadata, { m: 1 });
    assert.equal(await p.get("a:1"), "1");
  });
});

describe("email sign-in link", () => {
  it("is offered only when email recovery is on, and connects the subscription", async () => {
    const sent: { to: unknown; text: string }[] = [];
    const stripe = (async (input: string | URL) => {
      const u = new URL(String(input));
      if (u.pathname === "/v1/customers")
        return Response.json({ data: [{ id: "cus_1" }] });
      if (u.pathname === "/v1/subscriptions")
        return Response.json({ data: [{ id: "sub_1" }] });
      return Response.json({}, { status: 404 });
    }) as typeof fetch;
    const deferred: Promise<unknown>[] = [];
    const e = env({
      EMAIL: {
        send: async (m) => {
          sent.push({ to: m.to, text: m.text });
          return { messageId: "1" };
        },
      },
      RECOVERY_SIGNING_SECRET: "s".repeat(64),
      STRIPE_SECRET_KEY: "sk_live_x",
    });
    await issue(e);
    const { client_id } = await register(e);
    const p = await pkce();
    const c = await authorize(e, client_id, p.challenge);
    assert.match(c.html, /Email me a sign-in link/);
    const ask = await handle(
      new Request(`${API}/authorize`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: API,
          cookie: c.cookie,
          "cf-connecting-ip": IP,
        },
        body: new URLSearchParams({
          handle: c.handle,
          decision: "email",
          email: "buyer@example.com",
        }).toString(),
      }),
      e,
      inner,
      { fetchImpl: stripe, waitUntil: (w) => void deferred.push(w) },
    );
    assert.equal(ask.status, 200);
    assert.match(await ask.text(), /a sign-in link is on its way/);
    await Promise.all(deferred);
    assert.equal(sent.length, 1);
    const link = /https:\/\/api\.factlot\.com(\/authorize\/email\/\S+)/.exec(
      sent[0]!.text,
    )![1]!;
    const view = await send(e, link);
    assert.equal(view.status, 200);
    assert.match(await view.text(), /Connect Claude to FactLot Pro/);
    const go = await send(e, link, {
      method: "POST",
      headers: { origin: API, cookie: c.cookie },
    });
    assert.equal(go.status, 302, await go.clone().text());
    const code = new URL(go.headers.get("location")!).searchParams.get("code")!;
    const t = await token(e, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id,
      code_verifier: p.verifier,
    });
    assert.equal(
      (await mcp(e, t.body.access_token, LIST)).headers.get("x-factlot-tier"),
      "pro",
    );
    // The link works once.
    assert.equal(
      (
        await send(e, link, {
          method: "POST",
          headers: { origin: API, cookie: c.cookie },
        })
      ).status,
      404,
    );
  });
});
