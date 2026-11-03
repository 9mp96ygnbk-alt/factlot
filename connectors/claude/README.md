# FactLot for Claude

## Claude.ai, Claude Desktop, and mobile: custom connector (remote MCP)

1. Deploy the remote connector (see [connectors/README.md](../README.md)) on a public HTTPS URL.
2. In Claude, open **Settings → Connectors → Add custom connector**.
3. Enter the URL `https://<your-host>/mcp`. Leave OAuth empty for an open server.
4. Enable FactLot in a chat from the tools menu.

Claude connects from Anthropic's cloud, not from your device, so the URL must be publicly reachable.

FactLot's tools are read-only computations. Each one is annotated `readOnlyHint: true`, so Claude
can call them without a confirmation step, depending on your settings.

## Claude Desktop: one-click extension (local, no server)

Download `factlot-X.Y.Z.mcpb` from the
[latest release](https://github.com/9mp96ygnbk-alt/factlot/releases), or build it from a clone:

```bash
npm run build:mcpb    # → dist/factlot.mcpb
```

Double-click the `.mcpb` file, or drag it into **Claude Desktop → Settings → Extensions**. The bundle
is a single self-contained file that is validated with Anthropic's `mcpb` CLI. It runs locally, with
no account, no API key, and no network access.

## Claude Code

```bash
# Remote
claude mcp add --transport http factlot https://<your-host>/mcp
# Local, from a GitHub release (no npm account needed)
claude mcp add factlot -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.1/factlot-mcp-standalone-0.1.1.tgz
# Local, from a source build
claude mcp add factlot -- node "$PWD/packages/mcp/dist/bin.js"
# Local, after first publish to npm
claude mcp add factlot -- npx -y @factlot/mcp
```

## Claude API

**Option A: MCP connector.** Claude calls your remote FactLot server directly. This is a beta
feature; check the current beta header in the Claude API docs.

```python
import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model=MODEL,
    max_tokens=16000,
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{"type": "url", "url": "https://<your-host>/mcp", "name": "factlot"}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "factlot"}],
    messages=[{"role": "user", "content": "Size a loan: NOI $1.0M, value $15M, 6% / 30-yr, 65% LTV, 1.25x DSCR."}],
)
```

**Option B: local tools.** Run the tools in your own process; no server is needed.

```python
import factlot  # tools=factlot.anthropic_tools(); results via factlot.run_tool(name, input)
```

See [docs/agents.md](../../docs/agents.md) for a complete tool-use loop.
