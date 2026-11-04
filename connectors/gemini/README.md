# FactLot for Google Gemini

## Gemini API (function calling)

`factlot.gemini_tools()` returns `[{"functionDeclarations": [...]}]`. The parameters use a
conservative subset of OpenAPI 3.0:

- `type`, `description`, `enum`, `properties`, `required`, `items`, `anyOf`
- `minimum`, `maximum`, `minItems`, `maxItems`, `nullable`
- a limited set of `format` values

Unsupported keywords are dropped or folded into descriptions. For example, `format: date` becomes
"Format: YYYY-MM-DD." FactLot still validates every call strictly, so a looser hint never lets a bad
input through.

```python
from google import genai
from google.genai import types
import factlot

client = genai.Client()
config = types.GenerateContentConfig(tools=factlot.gemini_tools())
response = client.models.generate_content(model=MODEL, contents="What's the WALT of ...?", config=config)
for part in response.candidates[0].content.parts:
    if part.function_call:
        result = factlot.run_tool(part.function_call.name, dict(part.function_call.args))
        # send back as a function_response part, then continue the conversation
```

In TypeScript: `geminiTools()` from `@factlot/tools`, plus `runTool()`.

> Gemini's schema support has broadened over time. If your model accepts full JSON Schema
> (`parametersJsonSchema`), you can pass `inputJsonSchema(tool)` from `@factlot/tools` instead. The
> official Gemini docs could not be reached when this guide was written, so check the current
> function-calling reference.

## Gemini CLI (MCP)

Add FactLot to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "factlot": { "httpUrl": "https://api.factlot.com/mcp" },
    "factlot-local": { "command": "npx", "args": ["-y", "@factlot/mcp"] }
  }
}
```

## Vertex AI

- **Agent Development Kit and Agent Engine.** Connect to the remote MCP endpoint, or use the
  function declarations above.
- **OpenAPI-based tools.** Use `https://api.factlot.com/openapi-3.0.json?operations=all` (every
  tool); `/openapi-3.0.json` alone is the curated subset of at most 30 operations.
