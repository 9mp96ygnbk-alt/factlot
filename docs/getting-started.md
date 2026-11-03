# Getting started

Three ways to use FactLot, depending on where your agent runs. All three serve the same core
tools from one catalog: fourteen calculators, a Texas protest-deadline rule, FactLot IDs, and fact
validation. The MCP servers (local and `/mcp`) add `search`/`fetch`/`schema_get` and list the six
`registry_*` tools only when a registry database is configured (`FACTLOT_REGISTRY_DB`). REST,
OpenAPI, and the TypeScript and Python tool exports always include the registry tools, which
return `RegistryUnavailable` until a database is configured. For which tool to call when, see [agents.md](agents.md).

> **What works today.** FactLot is not on npm or PyPI yet (backlog item A5). Each section
> below lists the commands that work now first: from a clone, from git, or from the files
> attached to each [GitHub release](https://github.com/9mp96ygnbk-alt/factlot/releases). The
> `npx -y @factlot/mcp` and `pip install factlot` forms are marked **after first publish**.
> Release files and `git+https` installs need the repository to be public and, for release
> files, a release such as `v0.1.0` to exist. Every path here was run end to end; see
> [install-verification.md](install-verification.md).

## 1. Hosted connector in Docker (remote MCP, REST, OpenAPI)

Build and run the remote connector from the repository root:

```bash
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
docker build -t factlot . && docker run --rm -p 8787:8787 factlot
```

Or pull the prebuilt image (linux/amd64 and linux/arm64), published to the GitHub Container
Registry for each release:

```bash
docker run --rm -p 8787:8787 ghcr.io/9mp96ygnbk-alt/factlot:0.1.0
```

The same image also runs the stdio MCP server, for MCP clients that start servers with Docker:
`docker run --rm -i ghcr.io/9mp96ygnbk-alt/factlot:0.1.0 node packages/mcp/dist/bin.js`.

It listens on port **8787** and serves:

| Endpoint                                 | Use                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /mcp`                              | Streamable HTTP MCP: Claude custom connectors, ChatGPT apps, Copilot Studio, Gemini CLI, Cursor, VS Code |
| `POST /v1/calc/<name>` and other `/v1/`  | REST, one endpoint per tool; `GET /v1/tools` lists them                                                  |
| `GET /openapi.json`, `/openapi-3.0.json` | OpenAPI 3.1 and 3.0 for Custom GPT Actions, Bedrock Agents, Microsoft plugins                            |
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
| `FACTLOT_API_KEY`                                       | unset             | If set, `/mcp` and `/v1/*` require `Authorization: Bearer <key>`                |
| `FACTLOT_PUBLIC_URL`                                    | unset             | Public base URL written into the OpenAPI `servers` list                         |
| `FACTLOT_REGISTRY_DB`                                   | unset             | Path to a registry SQLite file; enables the `registry_*` tools                  |
| `FACTLOT_API_KEYS`, `FACTLOT_API_KEYS_FILE`             | unset             | Named keys (`key:tenant,...` or a JSON file) for per-tenant limits and metering |
| `FACTLOT_RATE_LIMIT_PER_MINUTE`                         | `0` (unlimited)   | Default per-key limit; over it, 429 with `Retry-After`                          |
| `FACTLOT_ADMIN_KEY`, `FACTLOT_USAGE_LOG`, `FACTLOT_LOG` | unset             | Enable `GET /v1/usage`, a jsonl usage record, and JSON request logs             |

The full configuration reference, including the keys-file format, is in
[packages/server/README.md](../packages/server/README.md).

Point a public HTTPS URL at it (backlog A4) and follow [connectors/](../connectors/README.md)
for each platform's setup. Without Docker: `npm install && npm run build && node packages/server/dist/bin.js`.

## 2. Local MCP server for an MCP client (stdio)

The server runs locally, needs no API key, and makes no network calls. Node.js 22.6 or newer.

**From a GitHub release, with `npx` (no clone, no npm account).** Each release attaches
`factlot-mcp-standalone-X.Y.Z.tgz`, the stdio server in one file with its dependencies bundled:

```bash
claude mcp add factlot -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0/factlot-mcp-standalone-0.1.0.tgz
```

```json
{
  "mcpServers": {
    "factlot": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0/factlot-mcp-standalone-0.1.0.tgz"
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

**Claude Desktop extension.** Download `factlot-0.1.0.mcpb` from the release (or build it with
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
base=https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0
npm install $base/factlot-schema-0.1.0.tgz $base/factlot-id-0.1.0.tgz \
  $base/factlot-calc-0.1.0.tgz $base/factlot-tools-0.1.0.tgz
# add $base/factlot-mcp-0.1.0.tgz and $base/factlot-server-0.1.0.tgz for the servers
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
pip install "factlot @ git+https://github.com/9mp96ygnbk-alt/factlot.git@v0.1.0#subdirectory=python"
# Or the wheel attached to a release:
pip install https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0/factlot-0.1.0-py3-none-any.whl
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

## Next

- [connectors/](../connectors/README.md): per-platform setup (Claude, ChatGPT, Gemini, Copilot, Bedrock).
- [agents.md](agents.md): mapping lease language to tool inputs.
- [release-process.md](release-process.md): how versions reach npm and PyPI.
