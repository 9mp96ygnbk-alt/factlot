// The documented client rules (checks.ts) against what this commit would serve: the MCP server's
// tools/list with the hosted tools added, search and fetch answers, and the OpenAPI 3.0
// documents. The same checks run against the live service in live.ts.
import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "@factlot/mcp";
import { openApi30, portableInputSchema } from "@factlot/tools";

import { ACCOUNT_TOOLS } from "../../deploy/cloudflare/src/account-tools.ts";
import { EXTRACT_LEASE_TOOL } from "../../deploy/cloudflare/src/ingest.ts";
import { REPORT_NARRATIVE_TOOL } from "../../deploy/cloudflare/src/narrative.ts";
import { REPORT_TOOL } from "../../deploy/cloudflare/src/reports.ts";
import {
  checkBedrockAgents,
  checkGptActions,
  checkSearchFetchResult,
  checkToolList,
  type Finding,
  type McpTool,
} from "./checks.ts";

function assertPasses(findings: Finding[]): void {
  const failed = findings.filter((f) => !f.warn && f.failures.length > 0);
  assert.deepEqual(
    failed.map(
      (f) => `${f.client}: ${f.rule}: ${f.failures.slice(0, 5).join(", ")}`,
    ),
    [],
  );
}

async function client(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ registry: true }).connect(b);
  const c = new Client({ name: "conformance", version: "0" });
  await c.connect(a);
  return c;
}

test("the hosted tools/list meets every documented client rule", async () => {
  const c = await client();
  const { tools } = await c.listTools();
  const hosted = [
    REPORT_TOOL,
    REPORT_NARRATIVE_TOOL,
    EXTRACT_LEASE_TOOL,
    ...ACCOUNT_TOOLS,
  ].map((t) => ({
    ...t,
    inputSchema: portableInputSchema(t.inputSchema),
  })) as unknown as McpTool[];
  assertPasses(checkToolList([...(tools as McpTool[]), ...hosted]));
  await c.close();
});

test("search and fetch answers meet the ChatGPT contract", async () => {
  const c = await client();
  for (const [name, args] of [
    ["search", { query: "debt sizing DSCR" }],
    ["fetch", { id: "tool:calc_debt_sizing" }],
  ] as const) {
    const r = await c.callTool({ name, arguments: args });
    assertPasses([checkSearchFetchResult(name, r as never)]);
  }
  await c.close();
});

test("the OpenAPI 3.0 documents meet the Custom GPT Actions and Bedrock Agents rules", () => {
  // The default document is the GPT Actions import; ?profile=bedrock is the Bedrock Agents one.
  assertPasses(checkGptActions(openApi30({ filter: () => true })));
  assertPasses(checkGptActions(openApi30()));
  assertPasses(
    checkBedrockAgents(
      openApi30({ profile: "bedrock", filter: () => true }),
      11,
    ),
  );
  assertPasses(
    checkBedrockAgents(openApi30({ profile: "bedrock", operations: "all" })),
  );
  // The general document keeps its enums, so it is not a Bedrock document.
  assert.ok(
    checkBedrockAgents(openApi30({ operations: "all" })).some(
      (f) => f.failures.length > 0,
    ),
  );
});

test("the checks catch what they are for", () => {
  const bad: McpTool[] = [
    {
      name: "a.very.long.name".padEnd(70, "x"),
      inputSchema: {
        type: "object",
        properties: {
          n: { type: "integer", exclusiveMinimum: 0 },
          r: { $ref: "#/$defs/x" },
          t: { type: ["string", "null"] },
        },
      },
    },
  ];
  const failed = checkToolList(bad)
    .filter((f) => f.failures.length)
    .map((f) => f.rule);
  for (const rule of [
    "tool names match [a-zA-Z0-9_-]{1,64}",
    "no numeric exclusiveMinimum (System.FormatException)",
    "no reference types ($ref): such tools are dropped from the list",
    "a single type per schema, not a type array (the schema is truncated)",
    "every tool has a title and readOnlyHint or destructiveHint",
  ])
    assert.ok(failed.includes(rule), rule);
  const long = checkGptActions({
    openapi: "3.0.3",
    paths: {
      "/x": { post: { operationId: "x", description: "y".repeat(301) } },
    },
  });
  assert.ok(long.some((f) => f.failures.length > 0));
  assert.ok(
    checkBedrockAgents({ openapi: "3.0.3", paths: {} })[0]!.failures.length,
  );
});
