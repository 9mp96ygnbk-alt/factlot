import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BEDROCK_AGENT_MAX_OPERATIONS,
  BEDROCK_AGENT_TOOLS,
  GPT_ACTIONS_MAX_OPERATIONS,
  GPT_ACTIONS_TOOLS,
  appliesUnitPolicy,
  anthropicTools,
  bedrockConverseToolConfig,
  geminiTools,
  openApi30,
  toBedrockSchema,
  openApi31,
  openaiChatTools,
  openaiResponsesTools,
  portableInputSchema,
  runTool,
  shortenDescription,
  toGeminiSchema,
  toOpenApi30Schema,
  tools,
} from "./index.ts";

const names = tools.map((t) => t.name);

test("catalog has unique names and REST paths", () => {
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(tools.map((t) => t.path)).size, tools.length);
  for (const expected of [
    "calc_rent_schedule",
    "calc_compare_proposals",
    "id_parcel",
    "id_document",
    "fact_validate",
  ]) {
    assert.ok(names.includes(expected), expected);
  }
  for (const t of tools)
    assert.match(t.name, /^[a-z][a-z0-9_]{0,63}$/, "portable tool name");
});

test("runTool returns results and errors as data", () => {
  const ok = runTool("calc_percentage_rent", {
    gross_sales: 5_000_000,
    rate: 0.06,
    base_rent_annual: 240_000,
  });
  assert.ok(ok.ok);
  const v = ok.result as {
    value: { percentage_rent: number };
    provenance: { formula: string };
  };
  assert.equal(v.value.percentage_rent, 60_000);
  assert.equal(v.provenance.formula, "calc.percentage_rent@1");

  const parcel = runTool("id_parcel", {
    state_fips: "06",
    county_fips: "037",
    apn: "5432-001-012",
  });
  assert.ok(parcel.ok);
  assert.equal(
    (parcel.result as { urn: string }).urn,
    "fl:parcel:us-06037:5432001012",
  );

  const doc = runTool("id_document", { text: "lease text" });
  assert.ok(doc.ok);
  const both = runTool("id_document", { text: "a", content_base64: "YQ==" });
  assert.equal(both.ok, false);

  const badCalc = runTool("calc_debt_sizing", {
    noi: 1,
    rate_annual: 0.05,
    amortization_years: 0,
  });
  assert.equal(!badCalc.ok && badCalc.error.error, "CalcInputError");
  const badId = runTool("id_parcel", {
    state_fips: "6",
    county_fips: "037",
    apn: "1",
  });
  assert.equal(!badId.ok && badId.error.error, "FactLotIdError");
  const missing = runTool("id_parcel", {});
  assert.equal(!missing.ok && missing.error.error, "InputError");
  const unknown = runTool("nope", {});
  assert.equal(!unknown.ok && unknown.error.error, "UnknownTool");
  assert.equal(
    !unknown.ok && unknown.error.message,
    'no FactLot tool named "nope"',
  );

  const fact = runTool("fact_validate", {
    fact: {
      subject: "fl:parcel:us-06037:1",
      predicate: "parcel.zoning_district",
      value: "M2",
      as_of: "2026-11-02",
      provenance: { method: "extracted", sources: [] },
    },
  });
  assert.ok(fact.ok);
  assert.equal((fact.result as { valid: boolean }).valid, false);
});

test("provider formats", () => {
  const a = anthropicTools();
  assert.equal(a.length, tools.length);
  assert.equal((a[0]?.input_schema as { type: string }).type, "object");
  assert.ok(!("$schema" in (a[0]?.input_schema as object)));

  const chat = openaiChatTools()[0] as {
    type: string;
    function: { name: string; parameters: object };
  };
  assert.equal(chat.type, "function");
  assert.equal(chat.function.name, names[0]);

  const resp = openaiResponsesTools()[0] as {
    type: string;
    name: string;
    parameters: object;
  };
  assert.equal(resp.type, "function");
  assert.equal(resp.name, names[0]);

  const bedrock = bedrockConverseToolConfig() as {
    tools: { toolSpec: { name: string; inputSchema: { json: object } } }[];
  };
  assert.equal(bedrock.tools.length, tools.length);
  assert.ok(bedrock.tools[0]?.toolSpec.inputSchema.json);

  const filtered = anthropicTools((t) => t.name.startsWith("id_"));
  assert.ok(filtered.every((t) => String(t.name).startsWith("id_")));
});

const GEMINI_ALLOWED = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "properties",
  "required",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
]);

function keysDeep(s: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(s)) s.forEach((x) => keysDeep(x, out));
  else if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s)) {
      if (k === "properties")
        Object.values(v as object).forEach((x) => keysDeep(x, out));
      else {
        out.add(k);
        keysDeep(v, out);
      }
    }
  }
  return out;
}

test("Gemini schemas use only the conservative subset", () => {
  const g = geminiTools() as {
    functionDeclarations: { name: string; parameters: object }[];
  };
  assert.equal(g.functionDeclarations.length, tools.length);
  for (const fd of g.functionDeclarations) {
    for (const key of keysDeep(fd.parameters)) {
      assert.ok(GEMINI_ALLOWED.has(key), `${fd.name}: unsupported key ${key}`);
    }
  }
  const s = toGeminiSchema({
    type: "object",
    properties: {
      d: { type: "string", format: "date", description: "When." },
      n: { type: "number", exclusiveMinimum: 0 },
      r: { type: "number", minimum: 0, exclusiveMaximum: 1, default: 0.08 },
    },
    oneOf: [{ type: "object", properties: { t: { const: "x" } } }],
  });
  assert.deepEqual((s.properties as Record<string, object>).d, {
    type: "string",
    description: "When. Format: YYYY-MM-DD.",
  });
  assert.deepEqual((s.properties as Record<string, object>).n, {
    type: "number",
    minimum: 0,
    description: "Must be greater than 0.",
  });
  assert.deepEqual((s.properties as Record<string, object>).r, {
    type: "number",
    minimum: 0,
    maximum: 1,
    description: "Must be less than 1. Default: 0.08.",
  });
  assert.ok(Array.isArray(s.anyOf));
});

test("OpenAPI 3.0 conversion", () => {
  const s = toOpenApi30Schema({
    $schema: "x",
    type: "object",
    properties: {
      a: { type: "number", exclusiveMinimum: 0 },
      b: { const: "k" },
      c: { type: ["string", "null"] },
      d: { type: ["string", "number"] },
      e: { type: "object", propertyNames: { type: "string" } },
    },
  });
  assert.ok(!("$schema" in s));
  const p = s.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(p.a, { type: "number", minimum: 0, exclusiveMinimum: true });
  assert.deepEqual(p.b, { enum: ["k"] });
  assert.deepEqual(p.c, { type: "string", nullable: true });
  assert.deepEqual(p.d, { anyOf: [{ type: "string" }, { type: "number" }] });
  assert.deepEqual(p.e, { type: "object" });
});

test("OpenAPI 3.1 has one operation per tool", () => {
  const doc = openApi31({ serverUrl: "https://api.example.com" });
  const paths = doc.paths as Record<string, { post: { operationId: string } }>;
  const ops = Object.values(paths)
    .map((p) => p.post.operationId)
    .sort();
  // registry_* operations need a registry; a server with one lists them itself.
  assert.deepEqual(
    ops,
    [...names].filter((n) => !n.startsWith("registry_")).sort(),
  );
  assert.deepEqual((doc.servers as object[])[0], {
    url: "https://api.example.com",
  });
  const all30 = openApi30({ operations: "all" }).paths as object;
  assert.equal(Object.keys(all30).length, ops.length, "3.0 with every tool");
});

test("OpenAPI 3.0 is the curated Custom GPT Actions subset, at most 30 operations", () => {
  assert.ok(
    GPT_ACTIONS_TOOLS.length <= GPT_ACTIONS_MAX_OPERATIONS,
    `GPT_ACTIONS_TOOLS has ${GPT_ACTIONS_TOOLS.length} names; Custom GPT Actions allow at most ${GPT_ACTIONS_MAX_OPERATIONS} operations`,
  );
  assert.equal(new Set(GPT_ACTIONS_TOOLS).size, GPT_ACTIONS_TOOLS.length);
  for (const n of GPT_ACTIONS_TOOLS)
    assert.ok(names.includes(n), `${n} is a tool`);
  const opsOf = (doc: Record<string, unknown>) =>
    Object.values(
      doc.paths as Record<string, { post: { operationId: string } }>,
    ).map((p) => p.post.operationId);
  // Default: no registry, catalog order.
  const doc = openApi30();
  assert.equal(doc.openapi, "3.0.0");
  assert.deepEqual(
    opsOf(doc),
    names.filter(
      (n) => GPT_ACTIONS_TOOLS.includes(n) && !n.startsWith("registry_"),
    ),
  );
  // A server with a registry loaded still stays within the limit.
  const withRegistry = opsOf(openApi30({ filter: () => true }));
  assert.ok(withRegistry.length <= GPT_ACTIONS_MAX_OPERATIONS);
  assert.deepEqual([...withRegistry].sort(), [...GPT_ACTIONS_TOOLS].sort());
  assert.match(
    (doc.info as { description: string }).description,
    /curated Custom GPT Actions subset.*\/openapi\.json.*\/mcp/,
  );
  // The connector guide lists the subset, so a GPT builder knows what is in it.
  const guide = readFileSync(
    new URL("../../../connectors/chatgpt/README.md", import.meta.url),
    "utf8",
  );
  for (const n of GPT_ACTIONS_TOOLS)
    assert.ok(
      guide.includes(`\`${n}\``),
      `connectors/chatgpt/README.md lists ${n}`,
    );
});

test("the Bedrock Agents profile has no enum or const, restates them in descriptions, and stays within 11 operations", () => {
  assert.ok(BEDROCK_AGENT_TOOLS.length <= BEDROCK_AGENT_MAX_OPERATIONS);
  for (const n of BEDROCK_AGENT_TOOLS)
    assert.ok(names.includes(n), `${n} is a tool`);
  const doc = openApi30({ profile: "bedrock", filter: () => true });
  assert.equal(doc.openapi, "3.0.0");
  assert.deepEqual(
    Object.values(
      doc.paths as Record<string, { post: { operationId: string } }>,
    )
      .map((p) => p.post.operationId)
      .sort(),
    [...BEDROCK_AGENT_TOOLS].sort(),
  );
  const all = openApi30({ profile: "bedrock", operations: "all" });
  const text = JSON.stringify(all);
  assert.ok(!/"enum"|"const"/.test(text.replace(/"description":"[^"]*"/g, "")));
  assert.equal(
    Object.keys(all.paths as object).length,
    Object.keys(openApi30({ operations: "all" }).paths as object).length,
  );
  // The general document still has them: validation is untouched.
  const general = JSON.stringify(openApi30({ operations: "all" }));
  assert.match(general, /"enum":/);
  // A restated enum.
  assert.deepEqual(
    toBedrockSchema({ type: "string", enum: ["a", "b"], description: "Kind." }),
    { type: "string", description: "Kind. One of: a, b." },
  );
  assert.deepEqual(toBedrockSchema({ const: "x", type: "string" }), {
    type: "string",
    description: "One of: x.",
  });
  // Other documents are unaffected by the profile.
  assert.deepEqual(openApi30(), openApi30({ operations: undefined }));
});

test("a rate rejected as too big says rates are decimals", () => {
  const r = runTool("calc_debt_sizing", {
    noi: 1000000,
    value: 15000000,
    rate_annual: 6.5,
    amortization_years: 30,
    max_ltv: 0.65,
  });
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.match(r.error.message, /rates are decimals: pass 0\.065 for 6\.5%/);
    assert.match(r.error.issues[0]!.message, /rates are decimals/);
  }
});

test("a whole-number percent in any rate field is rejected, whatever the tool's own bound", () => {
  // npv has no upper bound and the schedules allow up to 10; one policy covers them all.
  for (const [tool, args, path] of [
    ["calc_npv", { cash_flows: [-100, 110], rate: 8 }, "rate"],
    [
      "calc_rent_schedule",
      {
        commencement_date: "2027-01-01",
        term_months: 24,
        area_sf: 10000,
        starting_rent_psf_annual: 30,
        escalation: { type: "percent", rate: 3 },
      },
      "escalation.rate",
    ],
  ] as const) {
    const r = runTool(tool, args);
    assert.ok(!r.ok, tool);
    if (!r.ok) {
      assert.equal(r.error.error, "CalcInputError");
      assert.equal(r.error.issues[0]?.path, path);
      assert.match(
        r.error.issues[0]!.message,
        /rates are decimals: pass 0\.0\d for \d%/,
      );
    }
  }
  // a decimal is still fine, and so is a rate field a tool does not police (free-form fact values)
  assert.ok(runTool("calc_npv", { cash_flows: [-100, 110], rate: 0.08 }).ok);
  assert.ok(!appliesUnitPolicy("fact_validate"));
  assert.ok(appliesUnitPolicy("lease_comp_validate"));
  assert.ok(appliesUnitPolicy("calc_anything_new"));
});

test("a share or ratio rejected as too big says to pass a decimal", () => {
  const r = runTool("calc_debt_sizing", {
    noi: 1000000,
    value: 15000000,
    rate_annual: 0.065,
    amortization_years: 30,
    max_ltv: 75,
  });
  assert.ok(!r.ok);
  if (!r.ok)
    assert.match(
      r.error.issues[0]!.message,
      /shares and ratios are decimals: pass 0\.75 for 75%/,
    );
});

test("portable MCP input schemas restate exclusive bounds", () => {
  const s = portableInputSchema({
    type: "object",
    properties: {
      n: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      m: { type: "integer", exclusiveMaximum: 10 },
      r: { type: "number", exclusiveMinimum: 0, description: "Rate." },
      q: { type: "number", minimum: 5, exclusiveMinimum: 0 },
      a: { type: "array", items: { type: "number", exclusiveMaximum: 1 } },
      o: { oneOf: [{ type: "integer", exclusiveMinimum: 2 }] },
    },
  });
  const p = s.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(p.n, { type: "integer", minimum: 1 });
  assert.deepEqual(p.m, { type: "integer", maximum: 9 });
  assert.deepEqual(p.r, {
    type: "number",
    minimum: 0,
    description: "Rate. Must be greater than 0.",
  });
  assert.deepEqual(p.q, { type: "number", minimum: 5 });
  assert.deepEqual(p.a!.items, {
    type: "number",
    maximum: 1,
    description: "Must be less than 1.",
  });
  assert.deepEqual((p.o!.oneOf as object[])[0], {
    type: "integer",
    minimum: 3,
  });
  // Applying it twice changes nothing.
  assert.deepEqual(portableInputSchema(s), s);
});

test("the Custom GPT Actions subset keeps every summary and description within 300 characters", () => {
  for (const filter of [undefined, () => true]) {
    const doc = openApi30(filter ? { filter } : {});
    for (const [path, item] of Object.entries(
      doc.paths as Record<
        string,
        { post: { summary: string; description: string } }
      >,
    )) {
      assert.ok(item.post.summary.length <= 300, `${path} summary`);
      assert.ok(item.post.description.length <= 300, `${path} description`);
      assert.ok(item.post.description.length > 40, `${path} keeps a sentence`);
    }
  }
  // Every operation in the complete documents keeps its full description.
  const full = openApi30({ operations: "all", filter: () => true })
    .paths as Record<
    string,
    { post: { operationId: string; description: string } }
  >;
  for (const item of Object.values(full))
    assert.equal(
      item.post.description,
      tools.find((t) => t.name === item.post.operationId)!.description,
    );
  assert.equal(shortenDescription("First one. Second one.", 15), "First one.");
  assert.equal(shortenDescription("abcdefghij klmnop", 12), "abcdefghij…");
  assert.equal(shortenDescription("short", 300), "short");
});
