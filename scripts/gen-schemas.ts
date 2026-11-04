// Generates spec/schemas from the TypeScript source of truth (the @factlot/tools catalog):
//   tools.json                 every tool: name, title, description, REST path, formula, input_schema
//   fact.json                  the FactLot data model as JSON Schema
//   providers/<platform>.json  native tool definitions for each AI platform
//   openapi-3.1.json           every tool: API gateways and HTTP clients
//   openapi-3.0.json           the Custom GPT Actions subset (GPT_ACTIONS_TOOLS, at most 30
//                              operations); openApi30({ operations: "all" }) gives every tool
// Run: npm run schemas   (CI fails if the committed files are stale)
import { mkdirSync, writeFileSync } from "node:fs";

import { jsonSchemas } from "@factlot/schema";
import {
  anthropicTools,
  bedrockConverseToolConfig,
  geminiTools,
  inputJsonSchema,
  openApi30,
  openApi31,
  openaiChatTools,
  openaiResponsesTools,
  tools,
} from "@factlot/tools";

const out = new URL("../spec/schemas/", import.meta.url);
mkdirSync(new URL("providers/", out), { recursive: true });

const write = (file: string, data: unknown) =>
  writeFileSync(new URL(file, out), `${JSON.stringify(data, null, 2)}\n`);

const generated_by = "scripts/gen-schemas.ts";
write("tools.json", {
  generated_by,
  tools: tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    path: t.path,
    ...(t.formula ? { formula: t.formula } : {}),
    input_schema: inputJsonSchema(t),
  })),
});
write("fact.json", { generated_by, schemas: jsonSchemas() });
write("providers/anthropic.json", { generated_by, tools: anthropicTools() });
write("providers/openai-chat.json", { generated_by, tools: openaiChatTools() });
write("providers/openai-responses.json", {
  generated_by,
  tools: openaiResponsesTools(),
});
write("providers/gemini.json", { generated_by, tools: [geminiTools()] });
write("providers/bedrock-converse.json", {
  generated_by,
  toolConfig: bedrockConverseToolConfig(),
});
write("openapi-3.1.json", openApi31());
write("openapi-3.0.json", openApi30());
console.log(
  `wrote ${tools.length} tools in 5 provider formats + OpenAPI 3.1/3.0`,
);
