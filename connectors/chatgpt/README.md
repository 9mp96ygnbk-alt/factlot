# FactLot for ChatGPT and OpenAI

## ChatGPT app (remote MCP)

ChatGPT calls connectors "apps". FactLot's MCP server works with ChatGPT in two ways:

- **Developer mode.** Every FactLot tool is available. Open **Settings → Apps → Advanced settings →
  Developer mode**, create an app, and enter `https://<your-host>/mcp`. Developer mode requires a
  paid plan; availability varies by plan.
- **Deep research and company knowledge.** These only use read-only `search` and `fetch` tools.
  FactLot implements both over its knowledge base (tools, inputs, CRE predicates, and the ID and
  fact specs). `search` returns `{"results": [{id, title, url}]}`, and `fetch` returns
  `{id, title, text, url, metadata}`, each as a JSON string in a single text content item.

## Custom GPT with an Action (OpenAPI)

1. Create a GPT, then go to **Configure → Actions → Create new action**.
2. Choose **Import from URL** and enter `https://<your-host>/openapi.json`. This is the OpenAPI 3.1
   spec with one operation per tool, 15 in total, under the Actions limit of 30.
3. Authentication:
   - **None** for an open server.
   - **API Key → Bearer** if you set `FACTLOT_API_KEY`.
4. Paste [`gpt-instructions.md`](gpt-instructions.md) into the GPT's instructions.
5. A public GPT needs a privacy policy URL. FactLot stores nothing, so state that in the policy.

Every operation is marked `x-openai-isConsequential: false`, because every operation is a read-only
computation.

## OpenAI API

**Responses API with remote MCP.** OpenAI calls your FactLot server directly:

```python
from openai import OpenAI

client = OpenAI()
response = client.responses.create(
    model=MODEL,
    tools=[{"type": "mcp", "server_label": "factlot", "server_url": "https://<your-host>/mcp", "require_approval": "never"}],
    input="Compare these two office proposals for my client: ...",
)
```

**Function calling with local tools:**

```python
import factlot

tools = factlot.openai_responses_tools()  # Responses API
tools = factlot.openai_tools()            # Chat Completions
# for each function call the model makes:
result = factlot.run_tool(call.name, json.loads(call.arguments))
```

In TypeScript, use `openaiResponsesTools()` and `openaiChatTools()` from `@factlot/tools`, with `runTool()`.
