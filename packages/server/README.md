# @factlot/server

The remote FactLot connector. It is one stateless HTTP service with three interfaces:

- **`POST /mcp`** is Streamable HTTP MCP. Use it from Claude custom connectors, ChatGPT apps,
  Copilot Studio, Gemini CLI, Le Chat, Cursor, and VS Code.
- **`POST /v1/...`** is REST, with one endpoint per tool.
- **`GET /openapi.json`** serves OpenAPI 3.1, and **`/openapi-3.0.json`** serves OpenAPI 3.0. Use
  these with Custom GPT Actions, Bedrock Agents, and Microsoft plugins.

```bash
docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.1.1   # prebuilt image
node packages/server/dist/bin.js     # from a source build (npm install && npm run build)
npx -y @factlot/server               # after first publish to npm
# PORT=8787; OPEN (no auth) and no request log until configured
```

> **No key configured means open.** Without `FACTLOT_API_KEY`, `FACTLOT_API_KEYS`, or
> `FACTLOT_API_KEYS_FILE`, anyone who can reach the port can call every tool, `/` reports
> `"auth": "none"`, and the server prints a warning on stderr at startup. That is the right default
> for a laptop or a private network; configure a key before exposing the port.

See [connectors/](../../connectors/README.md) for per-platform setup.

## Configuration

Everything is optional. With nothing set the server is open (no auth), has no per-key or per-IP
request limit, and writes no request log; the always-on protections are listed under
[Hardening](#hardening).

| Variable                                  | Purpose                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                            | Listen address. Default `0.0.0.0:8787`.                                                                                                                                                                 |
| `FACTLOT_API_KEY`                         | One shared bearer key, reported under the key name `default`. Still supported; combine with the two below if you like.                                                                                  |
| `FACTLOT_API_KEYS`                        | Named keys: `key1:tenant-a,key2:tenant-b`. Keys may not contain `:` or `,`.                                                                                                                             |
| `FACTLOT_API_KEYS_FILE`                   | Path to a JSON keys file (format below). Use this for keys with their own rate limit.                                                                                                                   |
| `FACTLOT_RATE_LIMIT_PER_MINUTE`           | Default requests per minute per key name. `0` or unset = unlimited. A key's `rate_limit_per_minute` overrides it.                                                                                       |
| `FACTLOT_ADMIN_KEY`                       | Bearer key for `GET /v1/usage`. The endpoint answers 404 until this is set. Keep it distinct from API keys; an API key is never accepted here.                                                          |
| `FACTLOT_USAGE_LOG`                       | Append one JSON line per metered tool call to this file (format below). The file is the durable record for billing.                                                                                     |
| `FACTLOT_LOG`                             | `json` writes one JSON line per request to stdout (format below). Default: no request log.                                                                                                              |
| `FACTLOT_PUBLIC_URL`                      | Public base URL written into the OpenAPI `servers` entry. Set it in production. Without it the URL comes from the `Host` header (validated), or from `X-Forwarded-*` when `FACTLOT_TRUST_PROXY=1`.      |
| `FACTLOT_TRUST_PROXY`                     | `1` = trust `X-Forwarded-For`, `-Proto`, `-Host` from a reverse proxy. Set it only when every request arrives through that proxy; otherwise clients can forge their address and host.                   |
| `FACTLOT_RATE_LIMIT_PER_IP_PER_MINUTE`    | Requests per minute per client IP on every route, counted before auth, so unauthenticated callers are limited too. `0` or unset = no per-IP limit.                                                      |
| `FACTLOT_AUTH_FAILURES_PER_IP_PER_MINUTE` | Rejected bearer tokens per minute per client IP; after that every request from the address gets 429 until the minute ends, even with a valid key, so guessing gets no answers. Default `30`; `0` = off. |

If any key is configured, `/mcp` and `/v1/*` require `Authorization: Bearer <key>`; discovery
routes (`/`, `/health`, `/openapi*.json`) stay open. `FACTLOT_ADMIN_KEY` must differ from every
API key (startup fails otherwise), and keys shorter than 24 characters draw a startup warning. Keys are compared in constant time (SHA-256
of both sides, then `timingSafeEqual`), every configured key is checked on every request, and a
malformed key list stops the process at startup rather than running with fewer keys than
intended. Logs show at most a short prefix of a key, never the key.

### Keys file

```json
[
  {
    "key": "fl_live_8f3a…",
    "name": "acme-engagement-2026",
    "rate_limit_per_minute": 600
  },
  { "key": "fl_live_c01d…", "name": "acme-engagement-2026" },
  { "key": "fl_live_77e2…", "name": "internal-eval" }
]
```

- `key` must be unique across all sources. `name` need not be: two keys with one name are one
  tenant, which is how you rotate a key without a gap (add the new key, move clients, remove the
  old).
- `rate_limit_per_minute` is optional and overrides `FACTLOT_RATE_LIMIT_PER_MINUTE` for that key
  (`0` = unlimited for that key even when a default is set).
- Generate keys with something like `openssl rand -hex 24`; the server has no opinion on format.

### Rate limiting

Fixed one-minute windows aligned to the clock, counted in memory per key name (or `anonymous`
when no keys are configured, so a default limit then applies to all callers together). Each HTTP
request counts once, whether it is a REST call or an MCP message. Over the limit the server
answers **429** with a `Retry-After` header (seconds) and `X-RateLimit-Limit` /
`X-RateLimit-Remaining` on every limited route:

```json
{
  "error": "RateLimited",
  "message": "rate limit of 600 requests per minute exceeded; retry in 23s",
  "retry_after_seconds": 23
}
```

`/mcp` gets the same status and headers with a JSON-RPC error body (`code: -32000`,
`error.data.retry_after_seconds`). Counts are per instance: with N instances behind a load
balancer a key can reach N × limit. Run one instance or limit at the edge when the number must be
exact.

### Usage metering

Every tool call is counted per key name, per tool, in hourly buckets kept in memory for 48 hours.
REST calls are counted under the tool name; MCP `tools/call` requests under the called tool;
other MCP requests (`initialize`, `tools/list`, …) under `mcp:<method>`. Notifications, rejected
(401) and rate-limited (429) requests, and non-tool routes are not metered; they appear in the
request log.

**`GET /v1/usage[?key=<name>]`** with `Authorization: Bearer <FACTLOT_ADMIN_KEY>` returns the
current UTC hour and day:

```json
{
  "key": "acme-engagement-2026",
  "generated_at": "2026-11-02T14:21:09.004Z",
  "hour": {
    "start": "2026-11-02T14:00:00.000Z",
    "end": "2026-11-02T15:00:00.000Z",
    "keys": {
      "acme-engagement-2026": {
        "calls": 41,
        "errors": 2,
        "duration_ms": 97,
        "tools": {
          "calc_debt_sizing": { "calls": 30, "errors": 2, "duration_ms": 80 },
          "mcp:tools/list": { "calls": 11, "errors": 0, "duration_ms": 17 }
        }
      }
    }
  },
  "day": {
    "start": "2026-11-02T00:00:00.000Z",
    "end": "2026-11-03T00:00:00.000Z",
    "keys": {}
  }
}
```

`errors` counts HTTP statuses of 400 and above. Omit `key` for all keys.

**Usage log (`FACTLOT_USAGE_LOG`)**: one JSON object per line, UTF-8, `\n`-terminated, appended
in request order, safe to rotate with `logrotate` (`copytruncate`) between writes. Fields, always
in this order:

```json
{
  "time": "2026-11-02T14:03:07.412Z",
  "key": "acme-engagement-2026",
  "tool": "calc_debt_sizing",
  "surface": "rest",
  "status": 200,
  "duration_ms": 3
}
```

| Field         | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `time`        | ISO 8601 UTC, when the request started.                                                   |
| `key`         | Key name (tenant), or `anonymous` when no keys are configured.                            |
| `tool`        | Catalog tool name, or `mcp:<method>` for MCP requests that are not tool calls.            |
| `surface`     | `rest` (`POST /v1/...`) or `mcp` (`POST /mcp`).                                           |
| `status`      | HTTP status of the response. MCP tool errors travel inside a 200 (`isError` in the body). |
| `duration_ms` | Whole milliseconds from request start to response close.                                  |

A billing job can read it with `jq`:
`jq -r 'select(.status < 400) | [.key, .tool] | @tsv' usage.jsonl | sort | uniq -c`. Write
failures are reported on stderr and do not fail the request.

### Request log (`FACTLOT_LOG=json`)

One line per request, every route, to stdout:

```json
{
  "time": "2026-11-02T14:03:07.412Z",
  "msg": "request",
  "method": "POST",
  "path": "/v1/calc/debt_sizing",
  "tool": "calc_debt_sizing",
  "key": "acme-engagement-2026",
  "status": 200,
  "duration_ms": 3
}
```

`tool` is `null` for non-tool routes and an array for an MCP batch; `key` is `null` for
unauthenticated and rejected requests, `admin` for `/v1/usage`. A rejected bearer token adds
`key_prefix` (a few leading characters). Startup emits one `{"msg":"listening",…}` line listing
key names and prefixes.

These fields are the whole schema (`REQUEST_LOG_FIELDS` in `src/index.ts`). Neither log ever
carries a request body, tool arguments, results, headers, or a key, and no future endpoint may
add them: see the [customer documents policy](../../docs/customer-documents.md), "Logging". A
test sends a sentinel through REST bodies, MCP arguments, and a bearer token and checks that it
reaches no log line.

## Hardening

Always on, whatever is configured:

- **Body size**: 1 MiB per request (`maxBodyBytes`); a larger `Content-Length` is refused with
  **413** `PayloadTooLarge` before the body is read.
- **Input shape**: tool arguments may nest at most 32 levels, hold at most 200,000 values, 10,000
  items per array, and 16 MiB per string; input schemas add per-field caps (for example 1,200
  IRR cash flows, 10,000 leases for WALT). Refusals are ordinary `CalcInputError` / `InputError`
  results. `POST /mcp` also checks the JSON-RPC envelope and accepts at most 20 messages per batch.
- **Timeouts**: 30 s per request, 15 s for headers, 5 s keep-alive (`SERVER_TIMEOUTS`).
  Calculators are synchronous; the input caps bound their running time instead.
- **Headers**: every response is JSON with `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`.
- **Methods**: wrong methods get **405** with an `Allow` header; unknown routes **404**.
- **Errors**: unexpected failures answer `500 {"error":"InternalError","message":"unexpected error"}`
  (or an MCP `isError` result with the same text) and write one stderr line with the route and the
  error's name only, never its message or stack.
- **CORS**: `Access-Control-Allow-Origin: *`. Auth is a bearer header, never a cookie, so a page
  on another origin cannot use a visitor's credentials; restrict origins at the edge if you want to.

TLS is not terminated here: run behind a proxy or load balancer that does, set
`FACTLOT_PUBLIC_URL` to the `https://` URL, and see
[docs/security/audit-2026-11-03.md](../../docs/security/audit-2026-11-03.md) for what a public
deployment must add (TLS, WAF or edge limits, log retention).

## Programmatic use

```ts
import {
  createFactLotServer,
  optionsFromEnv,
  UsageMeter,
} from "@factlot/server";

const usage = new UsageMeter({ file: "/var/log/factlot/usage.jsonl" });
createFactLotServer({ ...optionsFromEnv(), usage }).listen(8787);
// usage.report(Date.now(), "tenant-a") gives the same data as GET /v1/usage
```

`createHandler(opts)` returns a plain `(req, res)` function for mounting on an existing server.

## What is still missing

- **OAuth / SSO.** Authentication is bearer keys only. There is no OAuth 2.1 authorization server,
  no dynamic client registration, and no SSO (SAML/OIDC) in front of the MCP endpoint, so
  platforms that require OAuth for remote MCP must sit behind a gateway that provides it.
- **Durable, shared state.** Rate-limit windows and usage counts are per process and lost on
  restart; the usage log file is the only durable record.
- **Key management.** Keys are static configuration; there is no API to issue, rotate, or revoke
  them at runtime (restart to reload the file).
- **SOC 2 or any other compliance attestation.** None exists for this service.
- **Shared limits**: per-key and per-IP counts are per instance; with N instances a client can
  reach N × limit. Limit at the edge when the number must be exact.

Part of [FactLot](https://github.com/9mp96ygnbk-alt/factlot). License: Apache-2.0.
