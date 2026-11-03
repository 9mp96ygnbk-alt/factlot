# Getting started

Three ways to use FactLot, depending on where your agent runs. All three serve the same tools
from one catalog: nine calculators, a Texas protest-deadline rule, FactLot IDs, fact validation,
and `search`/`fetch`/`schema_get` (plus six `registry_*` tools when a registry database is
configured). For which tool to call when, see [agents.md](agents.md).

> **Not published yet.** The npm packages and the Python package are not on npm or PyPI until
> backlog item A5 (accounts) and the first release are done. Each path below gives the
> from-source command to use in the meantime.

## 1. Hosted connector in Docker (remote MCP, REST, OpenAPI)

Build and run the remote connector from the repository root:

```bash
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
docker build -t factlot . && docker run --rm -p 8787:8787 factlot
```

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

## 2. Local MCP server for an MCP client (`npx -y @factlot/mcp`)

Once published, any MCP client can run the stdio server with no install step:

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

**Until it is published**, build from source and point the client at the built file:

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

Claude Desktop can also install the one-click extension: `npm run build:mcpb` writes
`dist/factlot.mcpb`; open it with Claude Desktop (or Settings, Extensions, Install). The server
runs locally, needs no API key, and makes no network calls.

## 3. Python (`pip install factlot`)

```bash
pip install factlot            # once published
pip install ./python           # from a clone, until then (or: pip install -e ./python)
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
