# @factlot/server

The remote FactLot connector. It is one stateless HTTP service with three interfaces:

- **`POST /mcp`** is Streamable HTTP MCP. Use it from Claude custom connectors, ChatGPT apps,
  Copilot Studio, Gemini CLI, Le Chat, Cursor, and VS Code.
- **`POST /v1/...`** is REST, with one endpoint per tool.
- **`GET /openapi.json`** serves OpenAPI 3.1, and **`/openapi-3.0.json`** serves OpenAPI 3.0. Use
  these with Custom GPT Actions, Bedrock Agents, and Microsoft plugins.

```bash
docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.1.0   # prebuilt image
node packages/server/dist/bin.js     # from a source build (npm install && npm run build)
npx -y @factlot/server               # after first publish to npm
# PORT=8787; no auth, no limits, no logging until configured
```

See [connectors/](../../connectors/README.md) for per-platform setup.

## Configuration

Everything is optional. With nothing set, the server behaves as before: open, unlimited, quiet.

| Variable                        | Purpose                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                  | Listen address. Default `0.0.0.0:8787`.                                                                                                        |
| `FACTLOT_API_KEY`               | One shared bearer key, reported under the key name `default`. Still supported; combine with the two below if you like.                         |
| `FACTLOT_API_KEYS`              | Named keys: `key1:tenant-a,key2:tenant-b`. Keys may not contain `:` or `,`.                                                                    |
| `FACTLOT_API_KEYS_FILE`         | Path to a JSON keys file (format below). Use this for keys with their own rate limit.                                                          |
| `FACTLOT_RATE_LIMIT_PER_MINUTE` | Default requests per minute per key name. `0` or unset = unlimited. A key's `rate_limit_per_minute` overrides it.                              |
| `FACTLOT_ADMIN_KEY`             | Bearer key for `GET /v1/usage`. The endpoint answers 404 until this is set. Keep it distinct from API keys; an API key is never accepted here. |
| `FACTLOT_USAGE_LOG`             | Append one JSON line per metered tool call to this file (format below). The file is the durable record for billing.                            |
| `FACTLOT_LOG`                   | `json` writes one JSON line per request to stdout (format below). Default: no request log.                                                     |
| `FACTLOT_PUBLIC_URL`            | Public base URL written into the OpenAPI `servers` entry. By default it is derived from `X-Forwarded-*` headers.                               |

If any key is configured, `/mcp` and `/v1/*` require `Authorization: Bearer <key>`; discovery
routes (`/`, `/health`, `/openapi*.json`) stay open. Keys are compared in constant time (SHA-256
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
- **Per-IP limits and abuse controls** beyond per-key counting.

Part of [FactLot](https://github.com/9mp96ygnbk-alt/factlot). License: Apache-2.0.
