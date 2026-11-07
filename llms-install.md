# Installing FactLot for an AI coding agent

FactLot is a commercial real estate MCP server: deterministic calculators that return every step
and a versioned formula ID, lease-document verification, canonical property IDs and cited
public-record facts. No API key is needed.

## Option 1: hosted server (nothing to install)

Add a remote MCP server with this URL (Streamable HTTP, no authentication):

```
https://api.factlot.com/mcp
```

The free tier allows 60 requests a minute per IP address. Use the client's own setting for a
remote or HTTP MCP server; for example, Cursor's `.cursor/mcp.json`:

```json
{ "mcpServers": { "factlot": { "url": "https://api.factlot.com/mcp" } } }
```

## Option 2: local stdio server (Node.js 22.6 or newer)

The release build runs as a stdio server with its dependencies bundled. It makes no network calls.

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

## Check that it works

Ask the agent to call `calc_debt_sizing` with `noi` 1000000, `value` 15000000, `rate_annual`
0.065, `amortization_years` 30, `max_ltv` 0.65 and `min_dscr` 1.25. The result is a maximum loan
of 9,750,000, bound by loan-to-value, with every step listed.

More clients and frameworks: https://factlot.com/mcp-server/
