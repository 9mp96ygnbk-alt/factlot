# Getting started

Three ways to use FactLot, depending on where your agent runs. All three serve the same core
tools from one catalog: twenty-six calculators, the Texas protest-deadline rule and its batch form,
FactLot IDs, fact validation, document tools and lease comps (46 tools). The MCP servers (local and `/mcp`) always add
`search`/`fetch`/`schema_get`. The nine `registry_*` tools are listed (in MCP `tools/list`,
`GET /v1/tools`, and both OpenAPI documents) only when a registry is available: a registry database
configured with `FACTLOT_REGISTRY_DB`, or the hosted API's registry service. Without one, their REST
routes answer `503 RegistryUnavailable`. The hosted API at `https://api.factlot.com` serves the
regions `registry_coverage` lists (<!-- hosted:places -->Maryland (all 24 jurisdictions), the District of Columbia, Juab and Summit counties in Utah, sixteen Texas counties (Harris, Dallas, Travis, Collin, Denton, Williamson, Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman), New York City (all five boroughs), Los Angeles County, San Francisco, the City of Boston, Denver, and Connecticut (statewide, by town)<!-- /hosted:places -->; <!-- hosted:withheld -->Tarrant County is not served by the hosted registry while the publisher's terms for AI use are unclear.<!-- /hosted:withheld -->), so it lists
55 tools over REST (`GET /v1/tools`) and 59 over MCP: those, `search`/`fetch`/`schema_get`, and the
hosted `report_create` (also `POST /v1/reports`; see [reports](reports.md)). A key adds
`account_status` and `account_usage` over MCP, and on Pro and Team `doc_extract_lease` and
`report_narrative` once the model-backed tools are on. The TypeScript and Python tool exports always
include the registry tools. For which tool to call when, see [agents.md](agents.md).

## 0. The hosted API (nothing to install)

`https://api.factlot.com` serves the same tools, free with no key at 60 requests a minute and 25
registry lookups a day per IP address ([Pro and Team keys](https://factlot.com/pricing/) raise both). When the hosted API offers it, an optional free key by email (`POST /v1/keys/free` or factlot.com/account) counts the same free limits per key instead of per IP address; it is a free caller, so it gets the same free rules and no paid features. `DELETE /v1/keys/free` with the key deletes it, or `POST /v1/keys/free/delete` emails a deletion link. Two registry features are for Pro and Team: the full multi-year `value_history` of `registry_get` (without a key it returns the current roll year only, and the answer says so) and `registry_tx_equity_candidates_batch` (without a key it answers `PlanRequired`). A lookup is one answered call to a `registry_` tool. `registry_coverage`, coverage misses (a county or system that is not loaded) and input errors are not counted. Remote MCP is `https://api.factlot.com/mcp`; REST is
`POST https://api.factlot.com/v1/<group>/<name>` (paths in `GET /v1/tools`); OpenAPI is
`/openapi.json` (3.1, every tool) and `/openapi-3.0.json` (the Custom GPT subset of 30 operations).

```bash
curl -s https://api.factlot.com/v1/calc/irr -H 'content-type: application/json' \
  -d '{"cash_flows":[-100,10,10,110]}'
```

Send a descriptive `User-Agent` header from scripts (for example `my-agent/1.0`), so the operator
can tell your traffic from a script's and contact you if it misbehaves. Default library agents,
including Python's `urllib`, are accepted.

> **What works today.** FactLot is not on npm or PyPI yet. Each section
> below lists the commands that work now first: from a clone, from git, or from the files
> attached to each [GitHub release](https://github.com/9mp96ygnbk-alt/factlot/releases). The
> `npx -y @factlot/mcp` and `pip install factlot` forms are marked **after first publish**.
> Release files and `git+https` installs need the repository to be public and, for release
> files, a release such as `v0.1.0` to exist. Every path here was run end to end; see
> [install-verification.md](install-verification.md).

### After you buy

The page Stripe returns to after checkout shows your API key **once**, with copy buttons, setup for
Claude Code, Claude Desktop and claude.ai, ChatGPT, Cursor and VS Code, Python and curl, and a
"Test my key" button that calls `GET /v1/account`. FactLot keeps only a hash of the key. A new key
can take up to a minute to work everywhere.

- **Connect.** Send the key as `Authorization: Bearer <key>` to `https://api.factlot.com/mcp` (or
  any `/v1/…` route). Claude Code, Cursor, VS Code, Windsurf, agent SDKs and REST clients send the
  header. Claude (Desktop, claude.ai and mobile custom connectors) and ChatGPT developer-mode apps
  have no header field: they **sign in** instead (below).
- **Connect Claude or ChatGPT by signing in.** Add a custom connector with the URL
  `https://api.factlot.com/mcp/signin`, then click **Connect**. A FactLot page opens: paste your key
  once and choose **Connect with my key** (or **Continue on the free tier** without a plan). The
  connection gets your plan's limits and is tied to your subscription, not to the key: replacing the
  key keeps it connected, cancelling the subscription ends it, and factlot.com/account lists
  connected apps with a **Disconnect** button.
  - Claude Desktop, claude.ai, Claude mobile: **Settings → Connectors → Add custom connector** →
    URL `https://api.factlot.com/mcp/signin` (leave the OAuth client ID and secret empty) →
    **Add** → **Connect** → sign in with your FactLot key, or continue free.
  - ChatGPT developer mode: **Settings → Apps → Advanced settings → Developer mode**, then create an
    app with the same URL and **OAuth** authentication (no client ID or secret: ChatGPT registers
    itself) → **Connect** → sign in.
  - Why `/mcp/signin`: Claude starts sign-in only when the server answers `401`, and the plain
    `/mcp` stays open for the free tier without signing in. `/mcp/signin` is the same server; it asks
    a client without credentials to sign in. Both accept a key header or a sign-in token.
  - Use the header, not sign-in, for Claude Code, Cursor, VS Code and agent SDKs (they take the key
    in their MCP config), Custom GPT Actions (API key, Bearer) and REST clients. Sign-in tokens work
    only at `/mcp`, not on the REST API.
- **Give the guide to your agent.** `GET https://api.factlot.com/v1/onboarding?plan=pro` returns
  the same steps as JSON (`Accept: text/markdown` for Markdown), with `<key>` placeholders.
- **If an agent bought the plan,** it collects the key from the `claim_url` that
  `POST /v1/billing/checkout` returned, and the success page says so instead of showing the key.
  See [connectors/README.md](../connectors/README.md#agents-buy-and-collect-a-key).
- **What counts.** A lookup is one answered call to a registry tool; coverage checks, misses
  outside the loaded coverage and input errors are free. Calculators and other tools never count.
- **Your account.** <https://factlot.com/account>: paste the key to see the plan, this month's
  lookups, a 30-day history, keys and their last use, connected apps, the renewal date, and to
  manage billing, cancel, replace or add keys, or disconnect an app. Agents read the same from `GET /v1/account`,
  `GET /v1/account/usage`, or the `account_status` and `account_usage` MCP tools.
- **Lost the key.** On the account page, enter the email you paid with. If it has a subscription,
  a link arrives that works once for 15 minutes; it shows the account and issues a new key (on a
  plan at its key limit, the new key replaces the oldest one). No email ever contains a key.
  Until email is set up, write to contact@factlot.com from that address.

## 1. Hosted connector in Docker (remote MCP, REST, OpenAPI)

Build and run the remote connector from the repository root:

```bash
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
docker build -t factlot . && docker run --rm -p 8787:8787 factlot
```

Or pull the prebuilt image (linux/amd64 and linux/arm64), published to the GitHub Container
Registry for each release:

```bash
docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.5.0
```

The same image also runs the stdio MCP server, for MCP clients that start servers with Docker:
`docker run --rm -i ghcr.io/9mp96ygnbk-alt/factlot:0.5.0 node packages/mcp/dist/bin.js`.

It listens on port **8787** and serves:

| Endpoint                                 | Use                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /mcp`                              | Streamable HTTP MCP: Claude custom connectors, ChatGPT apps, Copilot Studio, Gemini CLI, Cursor, VS Code |
| `POST /v1/calc/<name>` and other `/v1/`  | REST, one endpoint per tool; `GET /v1/tools` lists them                                                  |
| `GET /openapi.json`, `/openapi-3.0.json` | OpenAPI 3.1 (all tools); 3.0 is the GPT Actions subset (`?operations=all` for all)                       |
| `GET /health`                            | `{"ok": true, "version": "..."}`                                                                         |

Try it:

```bash
curl -s localhost:8787/health
curl -s localhost:8787/v1/calc/debt_sizing -H 'content-type: application/json' -d '{
  "noi": 1000000, "value": 15000000, "rate_annual": 0.06,
  "amortization_years": 30, "max_ltv": 0.65, "min_dscr": 1.25
}'
```

Environment variables (pass with `docker run -e`):

| Variable                                                | Default           | Meaning                                                                         |
| ------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `PORT`, `HOST`                                          | `8787`, `0.0.0.0` | Where to listen                                                                 |
| `FACTLOT_API_KEY`                                       | unset (open)      | If set, `/mcp` and `/v1/*` require `Authorization: Bearer <key>`                |
| `FACTLOT_PUBLIC_URL`                                    | unset             | Public base URL written into the OpenAPI `servers` list; set it in production   |
| `FACTLOT_TRUST_PROXY`                                   | unset             | `1` = trust `X-Forwarded-*` from your reverse proxy                             |
| `FACTLOT_RATE_LIMIT_PER_IP_PER_MINUTE`                  | `0` (unlimited)   | Per-client-IP limit on every route, before auth                                 |
| `FACTLOT_REGISTRY_DB`                                   | unset             | Path to a registry SQLite file; enables the `registry_*` tools                  |
| `FACTLOT_API_KEYS`, `FACTLOT_API_KEYS_FILE`             | unset             | Named keys (`key:tenant,...` or a JSON file) for per-tenant limits and metering |
| `FACTLOT_RATE_LIMIT_PER_MINUTE`                         | `0` (unlimited)   | Default per-key limit; over it, 429 with `Retry-After`                          |
| `FACTLOT_ADMIN_KEY`, `FACTLOT_USAGE_LOG`, `FACTLOT_LOG` | unset             | Enable `GET /v1/usage`, a jsonl usage record, and JSON request logs             |

The full configuration reference, including the keys-file format, is in
[packages/server/README.md](../packages/server/README.md).

Point a public HTTPS URL at it and follow [connectors/](../connectors/README.md)
for each platform's setup. Without Docker: `npm install && npm run build && node packages/server/dist/bin.js`.

## 2. Local MCP server for an MCP client (stdio)

The server runs locally, needs no API key, and makes no network calls. Node.js 22.6 or newer.

**From a GitHub release, with `npx` (no clone, no npm account).** Each release attaches
`factlot-mcp-standalone-X.Y.Z.tgz`, the stdio server in one file with its dependencies bundled:

```bash
claude mcp add factlot -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-mcp-standalone-0.5.0.tgz
```

```json
{
  "mcpServers": {
    "factlot": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-mcp-standalone-0.5.0.tgz"
      ]
    }
  }
}
```

**From source:**

```bash
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
npm install && npm run build
claude mcp add factlot -- node "$PWD/packages/mcp/dist/bin.js"
```

```json
{
  "mcpServers": {
    "factlot": {
      "command": "node",
      "args": ["/absolute/path/to/factlot/packages/mcp/dist/bin.js"]
    }
  }
}
```

**Claude Desktop extension.** Download `factlot-0.5.0.mcpb` from the release (or build it with
`npm run build:mcpb`, which writes `dist/factlot.mcpb`) and open it with Claude Desktop, or use
Settings, Extensions, Install.

**After first publish to npm:**

Requires Python 3.10 or newer.

```bash
claude mcp add factlot -- npx -y @factlot/mcp        # Claude Code
```

```json
{
  "mcpServers": {
    "factlot": { "command": "npx", "args": ["-y", "@factlot/mcp"] }
  }
}
```

### The TypeScript libraries before npm

The six packages (`@factlot/schema`, `id`, `calc`, `tools`, `mcp`, `server`) are attached to each
release as the tarballs `npm pack` produces. Install the ones you need **in one command**, because
each depends on the others at the exact version:

```bash
base=https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0
npm install $base/factlot-schema-0.5.0.tgz $base/factlot-id-0.5.0.tgz \
  $base/factlot-calc-0.5.0.tgz $base/factlot-tools-0.5.0.tgz
# add $base/factlot-mcp-0.5.0.tgz and $base/factlot-server-0.5.0.tgz for the servers
```

`@factlot/schema`, `id`, and `calc` stand alone; `tools` needs those three, and `mcp` and
`server` need `tools` and its dependencies (`server` also needs `mcp`). Check downloads against the release's
`SHA256SUMS` (`sha256sum -c SHA256SUMS --ignore-missing`). After first publish:
`npm install @factlot/calc @factlot/id`.

## 3. Python

```bash
# From git (once the repository is public):
pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git#subdirectory=python"
# Pin a release:
pip install "factlot @ git+https://github.com/9mp96ygnbk-alt/factlot.git@v0.5.0#subdirectory=python"
# Or the wheel attached to a release:
pip install https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-0.5.0-py3-none-any.whl
# From a clone:
pip install ./python           # or: pip install -e ./python

pip install factlot            # after first publish to PyPI
```

The package has no dependencies. It gives you the calculators and IDs directly, and the tool
definitions and runner for a tool-use loop with the Claude Messages API (`anthropic_tools()`) or
OpenAI-style APIs (`openai_tools()`):

```python
import factlot

tools = factlot.anthropic_tools()            # pass as `tools=` to client.messages.create(...)

# When the model calls a tool, run it and return the result as the tool_result:
result = factlot.run_tool("calc_debt_sizing", {
    "noi": 1_000_000, "value": 15_000_000, "rate_annual": 0.06,
    "amortization_years": 30, "max_ltv": 0.65, "min_dscr": 1.25,
})
result["value"]["max_loan"]          # 9750000
result["steps"]                      # the audit trail
result["provenance"]                 # attach to a computed FactLot fact

factlot.parcel_id("06", "037", "5432-001-012").urn   # "fl:parcel:us-06037:5432001012"
```

`run_tool` returns input errors as data (`{"error": "CalcInputError", "issues": [...]}`) so the
model can correct its arguments. A complete Messages API loop is in
[agents.md](agents.md#example-claude-messages-api-with-the-python-sdk); the package README is at
[python/README.md](../python/README.md).

## Claude Code plugin

In Claude Code, `/plugin marketplace add 9mp96ygnbk-alt/factlot` then `/plugin install factlot@factlot` adds the hosted
MCP server plus twelve CRE skills that call the calculators. See [plugins/factlot/README.md](../plugins/factlot/README.md).

## Next

- [connectors/](../connectors/README.md): per-platform setup (Claude, ChatGPT, Gemini, Copilot, Bedrock).
- [agents.md](agents.md): mapping lease language to tool inputs.
- [release-process.md](release-process.md): how versions reach npm and PyPI.
