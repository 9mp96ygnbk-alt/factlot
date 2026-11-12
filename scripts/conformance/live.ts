// Keyless connector conformance check of a deployed FactLot API: what each major AI client does
// when it first connects, without any account or credential.
//
//   npm run test:connectors:live                       # https://api.factlot.com
//   FACTLOT_CONFORMANCE_URL=https://... npm run test:connectors:live
//
// About 35 requests, none of them a registry lookup or a report, so it stays inside the free
// tier's minute limit and spends none of the daily registry quota. Nothing is registered or
// stored: dynamic client registration and the token endpoint are probed only with requests they
// refuse. Exit code 1 on any FAIL; WARN lines are documented limits FactLot accepts for now.
//
// Each line: PASS|WARN|FAIL, the client the rule comes from, the rule, and on failure the evidence
// (request, status, the offending part of the answer). checks.ts names each rule's documentation.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  checkBedrockAgents,
  checkGptActions,
  checkSearchFetchResult,
  checkToolList,
  type Finding,
  type McpTool,
} from "./checks.ts";

const API = (
  process.env.FACTLOT_CONFORMANCE_URL ?? "https://api.factlot.com"
).replace(/\/+$/, "");
const MCP = `${API}/mcp`;
const SIGNIN = `${API}/mcp/signin`;
const ORIGIN = "http://localhost:6274"; // the MCP Inspector's web UI
const BOTH = "application/json, text/event-stream";

let failed = 0;
let warned = 0;
let passed = 0;
let requests = 0;

function report(
  status: "PASS" | "WARN" | "FAIL",
  client: string,
  rule: string,
  evidence = "",
): void {
  if (status === "FAIL") failed++;
  else if (status === "WARN") warned++;
  else passed++;
  console.log(
    `${status}  ${client}: ${rule}${evidence ? `\n      ${evidence}` : ""}`,
  );
}

function check(
  ok: boolean,
  client: string,
  rule: string,
  evidence: () => string,
): void {
  report(ok ? "PASS" : "FAIL", client, rule, ok ? "" : evidence());
}

function findings(list: Finding[]): void {
  for (const f of list) {
    const status = f.failures.length === 0 ? "PASS" : f.warn ? "WARN" : "FAIL";
    const shown = f.failures.slice(0, 4).join("; ");
    const more =
      f.failures.length > 4 ? ` (and ${f.failures.length - 4} more)` : "";
    report(status, f.client, f.rule, f.failures.length ? shown + more : "");
  }
}

async function http(url: string, init: RequestInit = {}): Promise<Response> {
  requests++;
  return fetch(url, init);
}

async function rpc(
  body: unknown,
  headers: Record<string, string> = {},
  url = MCP,
): Promise<{ res: Response; text: string; json?: Record<string, unknown> }> {
  const res = await http(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: BOTH, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { res, text, json };
}

const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

function initialize(version: string) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: version,
      capabilities: {},
      clientInfo: { name: "factlot-conformance", version: "1" },
    },
  };
}

async function discovery(): Promise<void> {
  // The sign-in URL: the 401 that starts OAuth, as Claude, ChatGPT and VS Code read it.
  const challenge = await rpc(initialize("2025-11-25"), {}, SIGNIN);
  const www = challenge.res.headers.get("www-authenticate") ?? "";
  const params = extractWWWAuthenticateParams(challenge.res);
  check(
    challenge.res.status === 401 && !!params.resourceMetadataUrl,
    "MCP authorization, Claude",
    "POST /mcp/signin without credentials answers 401 with WWW-Authenticate resource_metadata",
    () => `status ${challenge.res.status}, www-authenticate: ${www}`,
  );
  check(
    /scope="[^"]+"/.test(www),
    "MCP authorization 2025-11-25, ChatGPT",
    "the 401 challenge names the scope",
    () => `www-authenticate: ${www}`,
  );
  check(
    /www-authenticate/i.test(
      challenge.res.headers.get("access-control-expose-headers") ?? "",
    ),
    "MCP Inspector (browser)",
    "the 401 exposes WWW-Authenticate to browser clients",
    () =>
      `access-control-expose-headers: ${challenge.res.headers.get("access-control-expose-headers")}`,
  );

  // Protected resource metadata, as the MCP SDK discovers it, for each URL a person may enter.
  for (const [url, label] of [
    [SIGNIN, "/mcp/signin"],
    [MCP, "/mcp"],
  ] as const) {
    requests++;
    const prm = await discoverOAuthProtectedResourceMetadata(url).catch(
      (e: Error) => e,
    );
    if (prm instanceof Error) {
      report(
        "FAIL",
        "MCP authorization",
        `protected resource metadata for ${label}`,
        prm.message,
      );
      continue;
    }
    check(
      prm.resource === url,
      "Claude",
      `metadata for ${label} names exactly that URL as its resource`,
      () => `resource ${prm.resource}, URL entered ${url}`,
    );
    const selected = await selectResourceURL(url, {} as never, prm).catch(
      (e: Error) => e,
    );
    check(
      !(selected instanceof Error),
      "MCP TypeScript SDK clients (Claude Code, Cursor, Inspector)",
      `the SDK accepts the resource for ${label}`,
      () => String(selected),
    );
    check(
      Array.isArray(prm.authorization_servers) &&
        prm.authorization_servers.length > 0,
      "MCP authorization",
      `metadata for ${label} lists an authorization server (Claude uses the first)`,
      () => JSON.stringify(prm),
    );
  }
  const viaHeader = params.resourceMetadataUrl
    ? await http(params.resourceMetadataUrl.href)
    : undefined;
  const viaHeaderBody = viaHeader
    ? ((await viaHeader.json()) as { resource?: string })
    : undefined;
  check(
    viaHeaderBody?.resource === SIGNIN,
    "Claude",
    "the metadata the /mcp/signin challenge points at names /mcp/signin",
    () =>
      `${params.resourceMetadataUrl} gives resource ${viaHeaderBody?.resource}`,
  );

  // Authorization server metadata, as the SDK discovers it.
  requests++;
  const as = await discoverAuthorizationServerMetadata(API).catch(
    (e: Error) => e,
  );
  if (!as || as instanceof Error) {
    report(
      "FAIL",
      "MCP authorization",
      "authorization server metadata (RFC 8414 or OIDC)",
      String(as),
    );
    return;
  }
  const m = as as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(m[k]) ? (m[k] as string[]) : []);
  check(
    m.issuer === API,
    "ChatGPT",
    "issuer equals the protected resource's authorization server exactly",
    () => `issuer ${String(m.issuer)}`,
  );
  check(
    list("code_challenge_methods_supported").includes("S256"),
    "MCP authorization, ChatGPT, Claude",
    "code_challenge_methods_supported includes S256",
    () => JSON.stringify(m.code_challenge_methods_supported),
  );
  check(
    typeof m.registration_endpoint === "string",
    "Claude, VS Code, Cursor, Gemini CLI, Copilot Studio",
    "dynamic client registration endpoint",
    () => "no registration_endpoint",
  );
  check(
    m.client_id_metadata_document_supported === true &&
      list("token_endpoint_auth_methods_supported").includes("none"),
    "Claude, ChatGPT",
    'Client ID Metadata Documents: client_id_metadata_document_supported and "none" auth',
    () =>
      `cimd ${String(m.client_id_metadata_document_supported)}, auth methods ${JSON.stringify(m.token_endpoint_auth_methods_supported)}`,
  );
  check(
    list("grant_types_supported").includes("refresh_token"),
    "Claude",
    "refresh tokens",
    () => JSON.stringify(m.grant_types_supported),
  );

  // CORS for browser clients (the Inspector's web UI does discovery and registration in the page).
  const meta = await http(`${API}/.well-known/oauth-authorization-server`, {
    headers: { origin: ORIGIN },
  });
  const reg = await http(`${API}/register`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: "{}",
  });
  check(
    !!meta.headers.get("access-control-allow-origin") &&
      !!reg.headers.get("access-control-allow-origin") &&
      reg.status === 400,
    "MCP Inspector (browser)",
    "metadata and registration answers are readable cross-origin (registration refuses an empty body)",
    () =>
      `metadata ACAO ${meta.headers.get("access-control-allow-origin")}; register ${reg.status} ACAO ${reg.headers.get("access-control-allow-origin")}`,
  );
  const pre = await http(MCP, {
    method: "OPTIONS",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
    },
  });
  const allowed = (
    pre.headers.get("access-control-allow-headers") ?? ""
  ).toLowerCase();
  check(
    pre.status < 300 &&
      ["mcp-protocol-version", "mcp-method", "mcp-name", "authorization"].every(
        (h) => allowed.includes(h) || allowed.includes("*"),
      ),
    "MCP Streamable HTTP 2026-07-28 (browser clients)",
    "the /mcp preflight allows MCP-Protocol-Version, Mcp-Method and Mcp-Name",
    () => `OPTIONS ${pre.status}, access-control-allow-headers: ${allowed}`,
  );

  // A bad token at /mcp: 401 invalid_token with the challenge, so a client signs in again.
  const bad = await rpc(initialize("2025-11-25"), {
    authorization: "Bearer not-a-real-token",
  });
  const badWww = bad.res.headers.get("www-authenticate") ?? "";
  check(
    bad.res.status === 401 &&
      /error="invalid_token"/.test(badWww) &&
      /resource_metadata=/.test(badWww),
    "MCP authorization, Claude",
    "a rejected token gets 401 invalid_token with resource_metadata",
    () => `status ${bad.res.status}, www-authenticate: ${badWww}`,
  );
}

async function transport(): Promise<void> {
  for (const v of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
    const r = await rpc(initialize(v));
    const got = (r.json?.result as { protocolVersion?: string } | undefined)
      ?.protocolVersion;
    check(
      got === v,
      "MCP lifecycle",
      `initialize with ${v} is answered with ${v}`,
      () => `status ${r.res.status}: ${short(r.text)}`,
    );
  }
  const unknown = await rpc(initialize("2099-01-01"));
  const fallback = (
    unknown.json?.result as { protocolVersion?: string } | undefined
  )?.protocolVersion;
  check(
    !!fallback && fallback !== "2099-01-01",
    "MCP lifecycle",
    "initialize with an unknown version is answered with a version the server supports",
    () => short(unknown.text),
  );
  // A 2026-07-28 client probes first and falls back to initialize unless the 400 carries a
  // recognized modern error (-32020 HeaderMismatch, -32022 UnsupportedProtocolVersion with `supported`).
  const modern = await rpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    },
    { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" },
  );
  const err = modern.json?.error as
    { code?: number; data?: { supported?: unknown } } | undefined;
  // A 400 with a recognized modern error says "I am a modern server": the client retries the
  // modern form and never falls back. Only such an answer is wrong for a server without it.
  const modernAnswer =
    modern.res.status === 400 &&
    (err?.code === -32020 ||
      err?.code === -32022 ||
      Array.isArray(err?.data?.supported));
  report(
    modernAnswer ? "FAIL" : "PASS",
    "MCP 2026-07-28 clients (AgentCore Gateway, Inspector modern mode)",
    "a 2026-07-28 request is answered, or refused so the client falls back to initialize",
    modern.res.status === 200
      ? ""
      : modernAnswer
        ? `status ${modern.res.status}: ${short(modern.text, 200)}; a modern client will not fall back`
        : `status ${modern.res.status} with no recognized modern error, as the spec says a legacy server answers (clients that speak both fall back to initialize; a 2026-07-28-only client cannot connect): ${short(modern.text, 160)}`,
  );
  const note = await rpc({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  check(
    note.res.status === 202,
    "MCP Streamable HTTP",
    "a notification is answered 202",
    () => `status ${note.res.status}`,
  );
  const get = await http(MCP, { headers: { accept: "text/event-stream" } });
  check(
    get.status === 405,
    "MCP Streamable HTTP",
    "GET /mcp is 405 (no server-initiated stream on a stateless server)",
    () => `status ${get.status}`,
  );
  const jsonOnly = await rpc(
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { accept: "application/json" },
  );
  report(
    jsonOnly.res.status === 200 ? "PASS" : "WARN",
    "Clients that send Accept: application/json only",
    "POST /mcp is answered without text/event-stream in Accept",
    jsonOnly.res.status === 200
      ? ""
      : `status ${jsonOnly.res.status}: ${short(jsonOnly.text, 160)}`,
  );
}

async function tools(): Promise<void> {
  // The official SDK client over Streamable HTTP: what Claude Code, Cursor and the Inspector run.
  const client = new Client({ name: "factlot-conformance", version: "1" });
  const t = new StreamableHTTPClientTransport(new URL(MCP));
  requests += 2; // initialize, notifications/initialized
  try {
    await client.connect(t);
  } catch (e) {
    report("FAIL", "MCP TypeScript SDK", "connect", String(e));
    return;
  }
  report(
    "PASS",
    "MCP TypeScript SDK",
    `connect (protocol ${String(t.protocolVersion ?? "")})`,
  );
  requests++;
  const { tools: list } = await client.listTools();
  const bytes = JSON.stringify(list).length;
  report(
    "PASS",
    "MCP TypeScript SDK",
    `tools/list: ${list.length} tools, ${Math.round(bytes / 1024)} KB`,
  );
  findings(checkToolList(list as McpTool[]));
  for (const [name, args] of [
    ["search", { query: "debt sizing DSCR" }],
    ["fetch", { id: "tool:calc_debt_sizing" }],
  ] as const) {
    requests++;
    // The SDK client checks structuredContent against the tool's outputSchema.
    const r = await client
      .callTool({ name, arguments: args })
      .catch((e: Error) => e);
    if (r instanceof Error)
      report("FAIL", "MCP TypeScript SDK", `${name} call`, r.message);
    else findings([checkSearchFetchResult(name, r as never)]);
  }
  requests++;
  const bad = (await client.callTool({
    name: "calc_npv",
    arguments: { rate: "x" },
  })) as { isError?: boolean; content: { text?: string }[] };
  let shape: { error?: string; issues?: unknown[] } = {};
  try {
    shape = JSON.parse(bad.content[0]?.text ?? "{}") as typeof shape;
  } catch {
    shape = {};
  }
  check(
    bad.isError === true && !!shape.error && Array.isArray(shape.issues),
    "MCP tools",
    "bad arguments come back as a tool result with isError and the error object, not a protocol error",
    () => short(JSON.stringify(bad)),
  );
  await client.close();
}

async function openapi(): Promise<void> {
  const gpt = await http(`${API}/openapi-3.0.json`);
  const gptDoc = (await gpt.json()) as Record<string, unknown>;
  findings(checkGptActions(gptDoc));
  // Bedrock Agents has no enum and at most 11 APIs per agent, so it has its own profile.
  const bedrock = await http(`${API}/openapi-3.0.json?profile=bedrock`);
  findings(
    checkBedrockAgents((await bedrock.json()) as Record<string, unknown>, 11),
  );
  const bedrockAll = await http(
    `${API}/openapi-3.0.json?profile=bedrock&operations=all`,
  );
  findings(
    checkBedrockAgents((await bedrockAll.json()) as Record<string, unknown>),
  );
  const full = await http(`${API}/openapi.json`);
  const fullDoc = (await full.json()) as { openapi?: string };
  check(
    full.ok && fullDoc.openapi === "3.1.0",
    "OpenAPI importers",
    "/openapi.json is OpenAPI 3.1.0",
    () => `status ${full.status}, openapi ${fullDoc.openapi}`,
  );
}

console.log(`Connector conformance against ${API}\n`);
await discovery();
await transport();
await tools();
await openapi();
console.log(
  `\n${passed} passed, ${warned} warnings, ${failed} failed (${requests} requests, no registry lookups)`,
);
process.exitCode = failed ? 1 : 0;
