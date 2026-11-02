// Generates spec/schemas from the TypeScript source of truth:
//   spec/schemas/tools.json — every calculator as an agent tool definition
//                             ({ name, title, description, input_schema, formula })
//   spec/schemas/fact.json  — the FactLot data model as JSON Schema
// Run: npm run schemas   (CI fails if the committed files are stale)
import { mkdirSync, writeFileSync } from "node:fs";

import { calculators } from "@factlot/calc";
import { jsonSchemas } from "@factlot/schema";
import { z } from "zod";

const out = new URL("../spec/schemas/", import.meta.url);
mkdirSync(out, { recursive: true });

const tools = Object.entries(calculators).map(([name, c]) => ({
  name: `calc_${name}`,
  title: c.title,
  description: c.description,
  formula: { id: c.id, version: c.version },
  input_schema: z.toJSONSchema(c.input, { io: "input", unrepresentable: "any" }),
}));

const write = (file: string, data: unknown) =>
  writeFileSync(new URL(file, out), `${JSON.stringify(data, null, 2)}\n`);
write("tools.json", { generated_by: "scripts/gen-schemas.ts", tools });
write("fact.json", { generated_by: "scripts/gen-schemas.ts", schemas: jsonSchemas() });
console.log(`wrote ${tools.length} tool schemas and ${Object.keys(jsonSchemas()).length} fact schemas`);
