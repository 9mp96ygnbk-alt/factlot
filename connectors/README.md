# FactLot connectors

FactLot runs as a connector wherever AI agents run. Every connector exposes the **same tools,
generated from one catalog**, so a CAM reconciliation returns the identical answer, steps, and
formula ID whether it was called from Claude, ChatGPT, Gemini, Copilot, Bedrock, or your own code.

## Three ways to connect

| Surface                                      | What it is                                                                                                                                   | Use it from                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remote MCP** (`https://<host>/mcp`)        | Streamable HTTP and stateless. Serves 15 tools plus `search`, `fetch`, and `schema_get`, and 6 registry tools when a registry is configured. | Claude custom connectors, ChatGPT apps (developer mode, deep research), Microsoft Copilot Studio, Gemini CLI, Mistral Le Chat, Cursor, VS Code    |
| **Local MCP** (stdio)                        | `npx -y @factlot/mcp`, or a one-click Claude Desktop extension (`factlot.mcpb`).                                                             | Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Gemini CLI                                                                                |
| **REST and OpenAPI** (`https://<host>/v1/…`) | One POST endpoint per tool. `/openapi.json` (3.1) and `/openapi-3.0.json`.                                                                   | Custom GPT Actions, Amazon Bedrock Agents, Microsoft API plugins, Vertex AI, any HTTP client                                                      |
| **Native function calling**                  | Tool definitions in each provider's own format, plus `run_tool()` in Python and `runTool()` in TypeScript.                                   | Claude API, OpenAI (Chat Completions and Responses), Gemini API, Bedrock Converse, Mistral, xAI, DeepSeek, Groq, and other OpenAI-compatible APIs |

## Per-platform guides

- [Claude](claude/README.md): custom connector, Claude Desktop extension, Claude Code, Claude API
- [ChatGPT and OpenAI](chatgpt/README.md): ChatGPT app (developer mode and deep research), Custom GPT Action, Responses API remote MCP, function calling
- [Google Gemini](gemini/README.md): Gemini API function calling, Gemini CLI, Vertex AI
- [Microsoft Copilot](microsoft/README.md): Copilot Studio (MCP), Power Platform custom connector, Microsoft 365 Copilot
- [Amazon Bedrock](amazon/README.md): Converse API, Bedrock Agents action group (Lambda)
- [Mistral, xAI, Meta Llama, DeepSeek, and others](others/README.md)

## Run the remote connector

```bash
docker build -t factlot . && docker run -p 8787:8787 factlot
# or, from a source build:
npm run build && node packages/server/dist/bin.js
```

| Variable             | Purpose                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`       | Listen address. Default `0.0.0.0:8787`.                                                                                                |
| `FACTLOT_API_KEY`    | Optional. Requires `Authorization: Bearer <key>` on `/mcp` and `/v1/*`. Discovery routes (`/`, `/health`, `/openapi*.json`) stay open. |
| `FACTLOT_PUBLIC_URL` | Optional. Public base URL written into the OpenAPI `servers` entry. By default it is derived from `X-Forwarded-*` headers.             |

The tools are pure computation, so the server stores nothing, needs no database, and scales
horizontally behind any load balancer. Remote platforms connect from their own cloud, so the
server must be reachable on a public HTTPS URL.

## What has been verified

| Check                                                                                                      | Status                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP over Streamable HTTP with the official MCP SDK client (list, call, auth)                               | Tested in CI (`packages/server`)                                                                                                                                                |
| Raw JSON-RPC over HTTP, as a remote platform sends it (`initialize`, `tools/list`, `tools/call`, `search`) | Tested by hand against the built server                                                                                                                                         |
| Docker runtime image (non-root user, auth, MCP, REST)                                                      | Tested by hand. The full multi-stage build could not run in the development sandbox (no registry access from build containers). Its build steps were run separately and passed. |
| Claude Desktop extension: `mcpb validate`, `mcpb pack`, and a standalone stdio run of the unpacked bundle  | Tested by hand (`npm run build:mcpb`)                                                                                                                                           |
| Provider tool formats and the Gemini schema subset                                                         | Unit-tested (`packages/tools`, `python/tests`)                                                                                                                                  |
| Live connection from the claude.ai, ChatGPT, Copilot Studio, Gemini, and Bedrock consoles                  | **Not yet.** This needs a public deployment and accounts on each platform. Steps follow each platform's documentation as of Nov 2026; confirm the menu paths when you connect.  |
