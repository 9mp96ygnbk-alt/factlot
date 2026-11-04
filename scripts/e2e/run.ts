// End-to-end test of the built FactLot servers, driven the way an agent developer's MCP client
// drives them: a real MCP SDK client over stdio and over Streamable HTTP, plus REST and OpenAPI.
// It treats the servers as black boxes and imports nothing from the FactLot source.
//
//   npm run build && npm run test:e2e
//
// Environment (all optional):
//   FACTLOT_E2E_STDIO  JSON argv of the stdio server to test.
//                      Default: ["node", "packages/mcp/dist/bin.js"]
//                      e.g. '["node", "dist/mcpb/server/index.mjs"]' for the .mcpb bundle.
//   FACTLOT_E2E_URL    Base URL of an already running remote server (e.g. a Docker container,
//                      http://127.0.0.1:8787). Default: start packages/server/dist/bin.js on a
//                      free local port and stop it afterwards.
//   FACTLOT_E2E_ONLY   "stdio" or "http" to run one half.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const only = process.env.FACTLOT_E2E_ONLY;

// Tools every surface must serve without a registry database.
const REQUIRED_TOOLS = [
  "calc_rent_schedule",
  "calc_net_effective_rent",
  "calc_compare_proposals",
  "calc_percentage_rent",
  "calc_cam_reconciliation",
  "calc_debt_sizing",
  "calc_walt",
  "calc_npv",
  "calc_irr",
  "rules_tx_property_tax_protest_deadline",
  "id_parcel",
  "id_entity",
  "id_space",
  "id_building",
  "id_document",
  "id_parse",
  "fact_validate",
  "schema_get",
  "search",
  "fetch",
];

const DEBT_SIZING = {
  noi: 1_000_000,
  value: 15_000_000,
  rate_annual: 0.06,
  amortization_years: 30,
  max_ltv: 0.65,
  min_dscr: 1.25,
};
const PARCEL = { state_fips: "06", county_fips: "037", apn: "5432-001-012" };
const PARCEL_URN = "fl:parcel:us-06037:5432001012";
const CITED_FACT = {
  subject: PARCEL_URN,
  predicate: "parcel.zoning_district",
  value: "M2",
  as_of: "2026-11-02",
  provenance: {
    method: "public_record",
    sources: [{ document_id: "la-county-assessor-roll-2026", page: 1 }],
  },
};
const UNCITED_FACT = {
  ...CITED_FACT,
  provenance: { method: "extracted", sources: [] },
};

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
}

/** The MCP checks shared by every transport. */
function mcpSuite(connect: () => Promise<Client>) {
  let client: Client;
  before(async () => {
    client = await connect();
  });
  after(async () => {
    await client?.close();
  });

  test("initialize: server identifies itself and offers tools", () => {
    const info = client.getServerVersion();
    assert.equal(info?.name, "factlot");
    assert.match(info?.version ?? "", /^\d+\.\d+\.\d+/);
    assert.ok(client.getServerCapabilities()?.tools, "tools capability");
    assert.ok(
      (client.getInstructions() ?? "").length > 0,
      "server instructions",
    );
  });

  test("tools/list: every required tool, each with a described object schema", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of REQUIRED_TOOLS) assert.ok(names.includes(name), name);
    assert.equal(new Set(names).size, names.length, "tool names are unique");
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", `${t.name} input schema`);
      assert.ok((t.description ?? "").length > 20, `${t.name} description`);
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} read-only`);
    }
  });

  test("tools/call calculator: calc_debt_sizing", async () => {
    const r = (await client.callTool({
      name: "calc_debt_sizing",
      arguments: DEBT_SIZING,
    })) as ToolResult;
    assert.notEqual(r.isError, true);
    const out = r.structuredContent as {
      value: { max_loan: number; binding_constraint: string };
      formula: { id: string; version: number };
      steps: unknown[];
    };
    assert.equal(out.value.max_loan, 9_750_000);
    assert.equal(out.value.binding_constraint, "ltv");
    assert.equal(out.formula.id, "calc.debt_sizing");
    assert.ok(out.steps.length > 0, "audit trail");
    // The same result is also given as text for clients that ignore structuredContent.
    const text = r.content?.find((c) => c.type === "text")?.text ?? "";
    assert.ok(text.includes("9750000"), "text content carries the result");
  });

  test("tools/call ID: id_parcel", async () => {
    const r = (await client.callTool({
      name: "id_parcel",
      arguments: PARCEL,
    })) as ToolResult;
    assert.notEqual(r.isError, true);
    assert.equal(r.structuredContent?.urn, PARCEL_URN);
    assert.match(String(r.structuredContent?.short), /^flp_/);
  });

  test("tools/call fact_validate: cited fact passes, uncited fact fails", async () => {
    const ok = (await client.callTool({
      name: "fact_validate",
      arguments: { fact: CITED_FACT },
    })) as ToolResult;
    assert.deepEqual(ok.structuredContent, { valid: true, issues: [] });
    const bad = (await client.callTool({
      name: "fact_validate",
      arguments: { fact: UNCITED_FACT },
    })) as ToolResult;
    assert.equal(bad.structuredContent?.valid, false);
    assert.ok((bad.structuredContent?.issues as unknown[]).length > 0);
  });

  test("invalid calls: bad arguments and an unknown tool are reported, not crashes", async () => {
    const bad = (await client.callTool({
      name: "calc_debt_sizing",
      arguments: { noi: "a lot" },
    })) as ToolResult;
    assert.equal(bad.isError, true);
    const badText = bad.content?.find((c) => c.type === "text")?.text ?? "";
    assert.match(badText, /noi/, "the error names the offending field");

    const badId = (await client.callTool({
      name: "id_parse",
      arguments: { urn: "not-a-factlot-id" },
    })) as ToolResult;
    assert.equal(badId.isError, true);

    // The SDK reports an unknown tool either as an isError result or as a JSON-RPC error,
    // depending on its version; both are acceptable, a hang or a crash is not.
    const unknownRejected = await client
      .callTool({ name: "no_such_tool", arguments: {} })
      .then(
        (r) => (r as ToolResult).isError === true,
        (err: unknown) => /no_such_tool|not found/i.test(String(err)),
      );
    assert.ok(unknownRejected, "unknown tool is rejected");

    // The server still answers after the errors.
    const again = (await client.callTool({
      name: "id_parcel",
      arguments: PARCEL,
    })) as ToolResult;
    assert.equal(again.structuredContent?.urn, PARCEL_URN);
  });
}

/** Resolve a local JSON pointer such as "#/components/schemas/Fact". */
function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !(key in node))
      return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Structural OpenAPI checks that need no network: every $ref resolves, ids are unique. */
function checkOpenApi(doc: Record<string, unknown>, major: "3.0" | "3.1") {
  assert.ok(String(doc.openapi).startsWith(`${major}.`), `openapi ${major}`);
  const info = doc.info as { title?: string; version?: string };
  assert.ok(info?.title && info?.version, "info.title and info.version");
  const servers = doc.servers as { url: string }[];
  assert.ok(servers?.length > 0 && /^https?:\/\//.test(servers[0]!.url));

  const refs: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string") refs.push(v);
        else walk(v);
      }
    }
  };
  walk(doc);
  for (const ref of refs)
    assert.notEqual(resolvePointer(doc, ref), undefined, `$ref ${ref}`);

  const paths = doc.paths as Record<string, Record<string, unknown>>;
  const opIds = new Set<string>();
  const methods = ["get", "post", "put", "patch", "delete"];
  for (const [p, item] of Object.entries(paths)) {
    assert.ok(p.startsWith("/"), p);
    for (const m of methods) {
      const op = item[m] as
        { operationId?: string; responses?: object } | undefined;
      if (!op) continue;
      assert.ok(op.operationId, `${m} ${p} operationId`);
      assert.ok(!opIds.has(op.operationId!), `duplicate ${op.operationId}`);
      opIds.add(op.operationId!);
      assert.ok(
        op.responses && Object.keys(op.responses).length > 0,
        `${m} ${p} responses`,
      );
    }
  }
  return { paths, refs: refs.length, operations: opIds.size };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string, child?: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child && child.exitCode !== null)
      throw new Error(`server exited with ${child.exitCode}`);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${base}/health did not answer within 10 s`);
}

if (only !== "http") {
  describe("stdio MCP server", () => {
    const argv = process.env.FACTLOT_E2E_STDIO
      ? (JSON.parse(process.env.FACTLOT_E2E_STDIO) as string[])
      : ["node", "packages/mcp/dist/bin.js"];
    mcpSuite(async () => {
      const client = new Client({ name: "factlot-e2e", version: "0.0.0" });
      await client.connect(
        new StdioClientTransport({
          command: argv[0]!,
          args: argv.slice(1),
          cwd: root,
          stderr: "inherit",
        }),
      );
      return client;
    });
  });
}

if (only !== "stdio") {
  describe("remote server (Streamable HTTP MCP, REST, OpenAPI)", () => {
    let base = process.env.FACTLOT_E2E_URL?.replace(/\/+$/, "") ?? "";
    let child: ChildProcess | undefined;

    before(async () => {
      if (!base) {
        const port = await freePort();
        base = `http://127.0.0.1:${port}`;
        child = spawn(process.execPath, ["packages/server/dist/bin.js"], {
          cwd: root,
          env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
          stdio: ["ignore", "ignore", "inherit"],
        });
      }
      await waitForHealth(base, child);
    });
    after(() => {
      child?.kill("SIGTERM");
    });

    describe("MCP at /mcp", () => {
      mcpSuite(async () => {
        const client = new Client({ name: "factlot-e2e", version: "0.0.0" });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
        );
        return client;
      });
    });

    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    test("GET / and /health describe the service", async () => {
      const health = (await (await fetch(`${base}/health`)).json()) as {
        ok: boolean;
        version: string;
      };
      assert.equal(health.ok, true);
      const index = (await (await fetch(`${base}/`)).json()) as {
        mcp: string;
        openapi: string;
      };
      assert.match(index.mcp, /\/mcp$/);
      assert.match(index.openapi, /\/openapi\.json$/);
    });

    test("REST: /v1/tools, a calculator, an ID, fact validation, and errors", async () => {
      const list = (await (await fetch(`${base}/v1/tools`)).json()) as {
        tools: { name: string; path: string }[];
      };
      const names = list.tools.map((t) => t.name);
      for (const name of REQUIRED_TOOLS.filter(
        (n) => !["search", "fetch", "schema_get"].includes(n),
      ))
        assert.ok(names.includes(name), name);

      const calc = await post("/v1/calc/debt_sizing", DEBT_SIZING);
      assert.equal(calc.status, 200);
      assert.equal(
        ((await calc.json()) as { value: { max_loan: number } }).value.max_loan,
        9_750_000,
      );

      const id = await post("/v1/id/parcel", PARCEL);
      assert.equal(id.status, 200);
      assert.equal(((await id.json()) as { urn: string }).urn, PARCEL_URN);

      const fact = await post("/v1/facts/validate", { fact: CITED_FACT });
      assert.equal(fact.status, 200);
      assert.equal(((await fact.json()) as { valid: boolean }).valid, true);

      const bad = await post("/v1/calc/debt_sizing", { noi: "a lot" });
      assert.equal(bad.status, 400);
      const badBody = (await bad.json()) as {
        error: string;
        issues: unknown[];
      };
      assert.match(badBody.error, /InputError$/);
      assert.ok(badBody.issues.length > 0);

      const missing = await post("/v1/calc/no_such_calculator", {});
      assert.equal(missing.status, 404);
      await missing.body?.cancel();
    });

    test("OpenAPI 3.1 and 3.0: valid structure, every $ref resolves, every REST tool present", async () => {
      const list = (await (await fetch(`${base}/v1/tools`)).json()) as {
        tools: { name: string; path: string }[];
      };
      for (const [route, major] of [
        ["/openapi.json", "3.1"],
        ["/openapi-3.0.json", "3.0"],
      ] as const) {
        const r = await fetch(`${base}${route}`);
        assert.equal(r.status, 200, route);
        const doc = (await r.json()) as Record<string, unknown>;
        const { paths, operations } = checkOpenApi(doc, major);
        assert.ok(operations >= REQUIRED_TOOLS.length - 3, route);
        for (const t of list.tools.filter(
          (x) => !x.name.startsWith("registry_"),
        ))
          assert.ok(paths[t.path]?.post, `${route} has POST ${t.path}`);
      }
    });
  });
}
