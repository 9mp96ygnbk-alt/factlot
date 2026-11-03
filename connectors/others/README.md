# FactLot for Mistral, xAI, Meta Llama, DeepSeek, and other platforms

Most model APIs accept OpenAI-style function definitions, and most agent apps and IDEs now speak
MCP. FactLot covers both.

## OpenAI-compatible function calling

The following APIs accept the Chat Completions `tools` format:

- Mistral (La Plateforme)
- xAI (Grok API)
- DeepSeek
- Groq, Together, Fireworks, OpenRouter
- Meta Llama through Llama API or Llama Stack's OpenAI-compatible endpoints
- self-hosted models served by vLLM, SGLang, or Ollama

```python
import factlot

tools = factlot.openai_tools()
# ... when the model returns tool_calls:
result = factlot.run_tool(call.function.name, json.loads(call.function.arguments))
```

TypeScript: `openaiChatTools()` and `runTool()` from `@factlot/tools`.

## MCP clients

Use the remote URL `https://<your-host>/mcp`, or run locally with
`npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0/factlot-mcp-standalone-0.1.0.tgz`
(`npx -y @factlot/mcp` after first publish to npm). See
[getting started](../../docs/getting-started.md) for the other local options.

| Client                                 | Where to add it                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Mistral Le Chat                        | Connectors → add a custom MCP connector with the remote URL                                         |
| Cursor                                 | `.cursor/mcp.json` → `{"mcpServers": {"factlot": {"url": "https://<your-host>/mcp"}}}`              |
| VS Code (agent mode)                   | `.vscode/mcp.json` → `{"servers": {"factlot": {"type": "http", "url": "https://<your-host>/mcp"}}}` |
| Windsurf, Zed, Cline, others           | Add an MCP server with the remote URL or the `npx` command                                          |
| Llama Stack and other agent frameworks | Register the remote MCP endpoint as a tool group, or use the function definitions above             |

Menu paths change often. If a step doesn't match what you see, follow the client's MCP
documentation; the URL and command stay the same.

## Plain HTTP

Every tool is also a REST endpoint (`POST /v1/calc/<name>`, `/v1/id/<kind>`, `/v1/facts/validate`),
described at `/openapi.json`. The tool list is at `GET /v1/tools`.
