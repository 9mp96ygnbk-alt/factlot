# FactLot for Amazon Bedrock

## Bedrock Converse API (any tool-capable Bedrock model)

```python
import boto3, factlot

bedrock = boto3.client("bedrock-runtime")
messages = [{"role": "user", "content": [{"text": "Reconcile CAM for 2026: ..."}]}]
while True:
    response = bedrock.converse(modelId=MODEL_ID, messages=messages, toolConfig=factlot.bedrock_tool_config())
    message = response["output"]["message"]
    messages.append(message)
    if response["stopReason"] != "tool_use":
        break
    results = []
    for block in message["content"]:
        if "toolUse" in block:
            use = block["toolUse"]
            out = factlot.run_tool(use["name"], use["input"])
            results.append({"toolResult": {"toolUseId": use["toolUseId"], "content": [{"json": out}],
                                           "status": "error" if "error" in out else "success"}})
    messages.append({"role": "user", "content": results})
```

In TypeScript, use `bedrockConverseToolConfig()` from `@factlot/tools`.

## Bedrock Agents (action group)

1. Create an action group whose API schema is FactLot's OpenAPI 3.0 document:
   `https://api.factlot.com/openapi-3.0.json`, or `factlot.openapi("3.0")` saved to S3.
2. For the executor, deploy [`bedrock-agent-lambda/handler.py`](bedrock-agent-lambda/handler.py)
   with the `factlot` package installed beside it (`pip install factlot -t .`). The Lambda runs
   the tools in-process and makes no network calls.
3. The handler turns Bedrock's string-typed properties back into typed JSON. Nested inputs, such as
   a lease `schedule`, arrive as JSON text and are parsed before the tool runs.

If your agent needs fewer operations, or your account limits the number of APIs per action
group, generate a filtered spec in TypeScript:

```ts
openApi30({ filter: (t) => t.name.startsWith("calc_") });
```

Bedrock's managed agent runtimes that support MCP can also use the remote `/mcp` endpoint directly.

The handler is unit-tested against sample action-group events (`test_handler.py`). Confirm the
event format against the current Bedrock Agents documentation before production use.
