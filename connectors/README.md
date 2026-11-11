# FactLot connectors

FactLot runs as a connector wherever AI agents run. Every connector exposes the **same tools,
generated from one catalog**, so a CAM reconciliation returns the identical answer, steps, and
formula ID whether it was called from Claude, ChatGPT, Gemini, Copilot, Bedrock, or your own code.

**Hosted endpoint:** `https://api.factlot.com` serves the remote MCP server at `/mcp` and REST
and OpenAPI at `/v1/…` and `/openapi.json`. The free tier needs no key and allows 60 requests a
minute and 25 registry lookups a day per address; paid keys go in `Authorization: Bearer <key>` ([plans](https://factlot.com/#pricing)).
Registry lookups are hosted for Maryland, the District of Columbia, Juab and Summit counties in Utah, and
sixteen Texas counties (Harris, Dallas, Travis, Collin, Denton, Williamson, Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman) (`registry_coverage` lists exactly
what is hosted). Tarrant County is not served by the hosted registry while the publisher's terms for AI use are unclear.
To self-host, run the Docker image or `@factlot/server` and use your own host in place of
`api.factlot.com` in every guide below.

**Sign in with OAuth (hosted).** Clients that cannot send a key header (Claude Desktop, claude.ai
and mobile custom connectors, ChatGPT developer-mode apps) connect to
`https://api.factlot.com/mcp/signin`. Without credentials it answers `401` with
`WWW-Authenticate: Bearer resource_metadata="https://api.factlot.com/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
which starts OAuth 2.1 in the client: protected-resource metadata (RFC 9728) at
`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`,
authorization-server metadata (RFC 8414) at `/.well-known/oauth-authorization-server`, the
sign-in page at `/authorize` (paste a key once, continue on the free tier, or, once email is set
up, get a sign-in link), code and refresh grants and revocation (RFC 7009) at `/token`, and
dynamic client registration at `/register` (Client ID Metadata Documents also work). PKCE S256
only, exact redirect URIs, one scope (`mcp`); access tokens last an hour and refresh tokens 30
days, rotated on each refresh. A connection carries its subscription's plan, keeps working when
the key is replaced, and is listed with **Disconnect** at factlot.com/account
(`DELETE /v1/account/connections/{id}`). Tokens work only at `/mcp`; bare `/mcp` stays open on the
free tier.

## Three ways to connect

| Surface                                               | What it is                                                                                                                                                                                                            | Use it from                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remote MCP** (`https://api.factlot.com/mcp`)        | Streamable HTTP and stateless. Serves 46 tools plus 9 registry tools, the hosted `report_create` and `search`, `fetch` and `schema_get` (59 in all). Registry tools answer for the regions `registry_coverage` lists. | Claude custom connectors, ChatGPT apps (developer mode, deep research), Microsoft Copilot Studio, Gemini CLI, Mistral Le Chat, Cursor, VS Code    |
| **Local MCP** (stdio)                                 | `npx -y <release URL>/factlot-mcp-standalone-X.Y.Z.tgz` (`npx -y @factlot/mcp` after first publish), or a one-click Claude Desktop extension (`factlot-X.Y.Z.mcpb`).                                                  | Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Gemini CLI                                                                                |
| **REST and OpenAPI** (`https://api.factlot.com/v1/…`) | One POST endpoint per tool. `/openapi.json` (3.1, all tools); `/openapi-3.0.json` (the GPT Actions subset; `?operations=all` for all).                                                                                | Custom GPT Actions, Amazon Bedrock Agents, Microsoft API plugins, Vertex AI, any HTTP client                                                      |
| **Native function calling**                           | Tool definitions in each provider's own format, plus `run_tool()` in Python and `runTool()` in TypeScript.                                                                                                            | Claude API, OpenAI (Chat Completions and Responses), Gemini API, Bedrock Converse, Mistral, xAI, DeepSeek, Groq, and other OpenAI-compatible APIs |

## Per-platform guides

- [Claude](claude/README.md): custom connector, Claude Desktop extension, Claude Code, Claude API
- [ChatGPT and OpenAI](chatgpt/README.md): ChatGPT app (developer mode and deep research), Custom GPT Action, Responses API remote MCP, function calling
- [Google Gemini](gemini/README.md): Gemini API function calling, Gemini CLI, Vertex AI
- [Microsoft Copilot](microsoft/README.md): Copilot Studio (MCP), Power Platform custom connector, Microsoft 365 Copilot
- [Amazon Bedrock](amazon/README.md): Converse API, Bedrock Agents action group (Lambda)
- [Mistral, xAI, Meta Llama, DeepSeek, and others](others/README.md)
- [Agent frameworks](frameworks/README.md): LangGraph / LangChain, OpenAI Agents SDK, CrewAI, the MCP Python and TypeScript SDKs, and the Vercel AI SDK, with tested recipes, a 429 policy, and a rerunnable script

## Agents: buy and collect a key

An agent can start a paid plan and collect the key itself; a person only pays.

1. `POST https://api.factlot.com/v1/billing/checkout` with `{"plan":"pro"}` or `{"plan":"team"}`.
   The answer has `url` (the Stripe Checkout page: give it to your human), `claim_url` and
   `expires_at` (the checkout and the claim last an hour).
2. Poll `GET <claim_url>` at most every 2 seconds. It answers `202 {"status":"pending"}` until the
   checkout is paid, then `200` once with `key`, `plan`, `plan_name`, `requests_per_minute`,
   `registry_lookups_per_month`, `account` and `mcp`. Store the key at once: it is not shown again.
3. Afterwards the claim answers `410 {"status":"claimed","by":"agent"}`; if the buyer's success page
   showed the key first, `by` is `"page"` and your human has it. `404` means the claim is unknown or
   expired; start a new checkout.
4. Send the key as `Authorization: Bearer <key>`. `GET /v1/onboarding?plan=pro` is the whole setup
   guide as JSON (`Accept: text/markdown` for Markdown), with client snippets and the limits.

With a key, the MCP server also lists two hosted-only account tools, `account_status` (plan, limits,
lookups used this month, renewal date, keys, holds) and `account_usage` (lookups per day for the last
30 days, by tool and by region). Neither counts as a lookup. `GET /v1/account` and
`GET /v1/account/usage` are the REST forms. Billing and account errors carry `code`, `message` and
`next`, the URL or exact action that fixes them. A lost key is recovered by email at
<https://factlot.com/account>.

## Run the remote connector

```bash
docker run -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.5.0    # prebuilt image, each release
# or build the image yourself, and in production run it hardened:
docker build -t factlot .
docker run --rm -p 8787:8787 --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e FACTLOT_API_KEY="$(openssl rand -hex 24)" -e FACTLOT_PUBLIC_URL=https://factlot.example.com factlot
# or, from a source build:
npm run build && node packages/server/dist/bin.js
```

| Variable                               | Purpose                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                         | Listen address. Default `0.0.0.0:8787`.                                                                                                         |
| `FACTLOT_API_KEY`                      | Optional. One shared bearer key (key name `default`). Any configured key makes `/mcp` and `/v1/*` require `Authorization: Bearer <key>`.        |
| `FACTLOT_API_KEYS`                     | Optional. Named keys, one per client or engagement: `key1:tenant-a,key2:tenant-b`.                                                              |
| `FACTLOT_API_KEYS_FILE`                | Optional. JSON keys file (example below), the place for per-key rate limits.                                                                    |
| `FACTLOT_RATE_LIMIT_PER_MINUTE`        | Optional. Default requests per minute per key; `0` = unlimited. Over the limit: HTTP 429 with `Retry-After`.                                    |
| `FACTLOT_ADMIN_KEY`                    | Optional. Enables `GET /v1/usage?key=<name>`: per-key, per-tool call counts for the current hour and day.                                       |
| `FACTLOT_USAGE_LOG`                    | Optional. Append one JSON line per tool call (`time, key, tool, surface, status, duration_ms`) to this file for billing.                        |
| `FACTLOT_LOG`                          | Optional. `json` for one JSON line per request on stdout.                                                                                       |
| `FACTLOT_PUBLIC_URL`                   | Set it in production: the public `https://` base URL written into the OpenAPI `servers` entry. Without it the URL comes from the `Host` header. |
| `FACTLOT_TRUST_PROXY`                  | Optional. `1` = trust `X-Forwarded-For/-Proto/-Host` from your reverse proxy (only when all traffic goes through it).                           |
| `FACTLOT_RATE_LIMIT_PER_IP_PER_MINUTE` | Optional. Per-client-IP limit on every route, counted before auth; `0` = unlimited.                                                             |

Discovery routes (`/`, `/health`, `/openapi*.json`) stay open. With nothing set the server is
**open** (no auth; a warning is printed at startup) with no per-key or per-IP limit; body size,
input shape, timeouts, and rejected-token limits always apply (see the
[server README](../packages/server/README.md#hardening)). A keys file:

```json
[
  {
    "key": "fl_live_8f3a…",
    "name": "acme-engagement-2026",
    "rate_limit_per_minute": 600
  },
  { "key": "fl_live_77e2…", "name": "internal-eval" }
]
```

Two keys may share a `name` (that is how you rotate without a gap); the name is what rate
limits, the usage endpoint, the usage log, and the request log report, so make it the thing you
bill: a client, an engagement, a team. Full keys are never logged. Field-by-field formats for the
usage log, `/v1/usage`, and the request log are in
[packages/server/README.md](../packages/server/README.md).

The tools are pure computation, so the server needs no database and scales horizontally behind
any load balancer; rate-limit windows and usage counts are per instance and in memory, and the
usage log file is the durable record. Remote platforms connect from their own cloud, so the
server must be reachable on a public HTTPS URL.

**Not provided yet (self-hosted server):** OAuth 2.1 / SSO for the MCP endpoint (bearer keys
only; the hosted API's OAuth sign-in is not part of `@factlot/server`; put an OAuth gateway in
front if a platform or a security review requires it), runtime key issuance or
revocation (keys are static config), shared or persistent rate-limit state, and any SOC 2 or
similar attestation.

## What has been verified

| Check                                                                                                      | Status                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP over Streamable HTTP with the official MCP SDK client (list, call, auth)                               | Tested in CI (`packages/server`)                                                                                                                                                 |
| Raw JSON-RPC over HTTP, as a remote platform sends it (`initialize`, `tools/list`, `tools/call`, `search`) | Tested by hand against the built server                                                                                                                                          |
| Docker image: full multi-stage build, non-root user, MCP over HTTP and stdio, REST, OpenAPI                | `docker build` and the end-to-end test run by hand ([install verification](../docs/install-verification.md)) and on every release tag (`container.yml`)                          |
| Docker runtime image (non-root user, auth, MCP, REST)                                                      | Built and run in the 2026-11-03 security review: uid 1000, `--read-only`, `--cap-drop ALL`, healthcheck healthy, open and keyed modes, 413 and input caps, rejected-token limit. |
| Claude Desktop extension: `mcpb validate`, `mcpb pack`, and the end-to-end test on the unpacked bundle     | Tested in CI; `npm run build:mcpb` also starts the bundled server and checks `tools/list`                                                                                        |
| Provider tool formats and the Gemini schema subset                                                         | Unit-tested (`packages/tools`, `python/tests`)                                                                                                                                   |
| Live connection from the claude.ai, ChatGPT, Copilot Studio, Gemini, and Bedrock consoles                  | **Not yet.** This needs a public deployment and accounts on each platform. Steps follow each platform's documentation as of Nov 2026; confirm the menu paths when you connect.   |
