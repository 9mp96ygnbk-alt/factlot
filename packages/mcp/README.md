# @factlot/mcp

An MCP server exposing FactLot calculators, IDs, and fact validation to any MCP-capable agent. It runs locally over stdio, needs no API key, and makes no network calls.

Part of [FactLot](https://github.com/9mp96ygnbk-alt/factlot): the open fact layer for commercial real estate AI agents.

## Run it

```bash
# From a GitHub release (no npm account needed): the server in one file, dependencies bundled
npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0/factlot-mcp-standalone-0.1.0.tgz

# From a source build
node packages/mcp/dist/bin.js

# In Docker
docker run --rm -i ghcr.io/9mp96ygnbk-alt/factlot:0.1.0 node packages/mcp/dist/bin.js

# After first publish to npm
npx -y @factlot/mcp
```

Claude Desktop: install `factlot-0.1.0.mcpb` from the
[release](https://github.com/9mp96ygnbk-alt/factlot/releases). MCP client configuration and the
other install options are in [getting started](../../docs/getting-started.md).

License: Apache-2.0
