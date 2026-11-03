# FactLot for Microsoft Copilot

## Copilot Studio (MCP, recommended)

Copilot Studio supports MCP servers over **Streamable HTTP**, which is what FactLot's `/mcp`
endpoint serves.

1. Open your agent, then go to **Tools → Add a tool → New tool → Model Context Protocol**.
2. Enter the server URL `https://api.factlot.com/mcp`, a name ("FactLot"), and a description. Set
   authentication to **None**, or to **API key** (header `Authorization`, value `Bearer <key>`) if
   you set `FACTLOT_API_KEY`.
3. Generative orchestration must be on for the agent. FactLot's 18 tools fit under Copilot Studio's
   per-agent tool limit.
4. Publish the agent to Microsoft 365 Copilot or Teams as needed.

## Power Platform custom connector

If your tenant requires a custom connector, import
[`copilot-studio-connector.swagger.yaml`](copilot-studio-connector.swagger.yaml). It is a
Swagger 2.0 definition with a single `/mcp` operation marked
`x-ms-agentic-protocol: mcp-streamable-1.0`. Replace `YOUR-FACTLOT-HOST` with your host. Copilot
Studio then discovers the tools over MCP, so the connector needs no per-tool schema.

## Microsoft 365 Copilot declarative agents and Azure AI Foundry

- **API plugins for declarative agents** take an OpenAPI 3.0 description: use
  `https://api.factlot.com/openapi-3.0.json`.
- **Azure AI Foundry Agent Service** can attach FactLot as an MCP tool, using the same `/mcp` URL,
  or as an OpenAPI tool.
