# @factlot/server

The remote FactLot connector. It is one stateless HTTP service with three interfaces:

- **`POST /mcp`** is Streamable HTTP MCP. Use it from Claude custom connectors, ChatGPT apps,
  Copilot Studio, Gemini CLI, Le Chat, Cursor, and VS Code.
- **`POST /v1/...`** is REST, with one endpoint per tool.
- **`GET /openapi.json`** serves OpenAPI 3.1, and **`/openapi-3.0.json`** serves OpenAPI 3.0. Use
  these with Custom GPT Actions, Bedrock Agents, and Microsoft plugins.

```bash
npx -y @factlot/server            # PORT=8787; FACTLOT_API_KEY optional
```

See [connectors/](../../connectors/README.md) for per-platform setup.
Part of [FactLot](https://github.com/9mp96ygnbk-alt/factlot). License: Apache-2.0.
