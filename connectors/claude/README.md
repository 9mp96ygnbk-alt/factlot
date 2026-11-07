# FactLot for Claude

## Claude.ai, Claude Desktop, and mobile: custom connector (remote MCP)

Custom connectors cannot send an API-key header, so a paid plan connects by signing in (OAuth 2.1):

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name it FactLot and enter the URL `https://api.factlot.com/mcp/signin`. Leave the OAuth client ID
   and secret empty: Claude registers itself.
3. Click **Connect**. A FactLot page opens and shows which app is asking and where access goes.
   - **Connect with my key**: paste your FactLot API key once. The connection gets your plan (Pro or
     Team limits, the subscription's monthly registry lookups, the `account_status` and
     `account_usage` tools). It is tied to your subscription, not to the key: replacing the key keeps
     it connected; if the subscription ends, the connection ends and Claude asks you to connect
     again. While a payment is failing, tool calls answer that the subscription is not active.
   - **Continue on the free tier**: no key. The connection gets the free limits (60 requests a minute
     and 25 registry lookups a day), counted for this connection.
   - **Email me a sign-in link** (once email is set up on the hosted service): a link to the address
     you paid with connects your subscription; open it in the same browser within 10 minutes.
4. Enable FactLot in a chat from the tools menu.

Connected apps are listed at <https://factlot.com/account> (and in `GET /v1/account`, under
`connections`), each with a **Disconnect** button (`DELETE /v1/account/connections/{id}`).

The plain URL `https://api.factlot.com/mcp` also works here, on the free tier without signing in:
Claude starts sign-in only when a server answers `401`, and `/mcp` stays open to keyless use.
`/mcp/signin` is the same server; it answers `401` (with the OAuth discovery header) to a client that
sends no credentials.

To use your own server instead, deploy the remote connector (see [connectors/README.md](../README.md))
on a public HTTPS URL and enter that URL in step 2. Claude connects from Anthropic's cloud, not from
your device, so the URL must be publicly reachable.

FactLot's tools are read-only computations, annotated `readOnlyHint: true`, so Claude can call
them without a confirmation step, depending on your settings. The exception is the hosted
`report_create`, which builds a file and keeps it for 24 hours; it is not annotated read-only.

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
# Remote (free, keyless)
claude mcp add --transport http factlot https://api.factlot.com/mcp
# Local, from a GitHub release (no npm account needed)
claude mcp add factlot -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.5.0/factlot-mcp-standalone-0.5.0.tgz
# Local, from a source build
claude mcp add factlot -- node "$PWD/packages/mcp/dist/bin.js"
# Local, after first publish to npm
claude mcp add factlot -- npx -y @factlot/mcp
```

### Using a paid key

Claude Code sends headers, so it takes the key directly (no sign-in needed). Add the server under the
name `factlot` with your key in the header:

```bash
claude mcp add --scope user --transport http factlot https://api.factlot.com/mcp --header "Authorization: Bearer <key>"
```

If you also installed the [FactLot plugin](../../plugins/factlot/README.md), keep this one server name, `factlot`, and run `/mcp`: turn off the plugin's keyless `factlot` server if it is still listed (Claude Code skips a plugin server that points at the same URL as an enabled server of yours). The plugin's skills call tools by name, so they use your server and stay installed. The plugin cannot carry the key itself.

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
    mcp_servers=[{"type": "url", "url": "https://api.factlot.com/mcp", "name": "factlot"}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "factlot"}],
    messages=[{"role": "user", "content": "Size a loan: NOI $1.0M, value $15M, 6% / 30-yr, 65% LTV, 1.25x DSCR."}],
)
```

**Option B: local tools.** Run the tools in your own process; no server is needed.

```python
import factlot  # tools=factlot.anthropic_tools(); results via factlot.run_tool(name, input)
```

See [docs/agents.md](../../docs/agents.md) for a complete tool-use loop.
