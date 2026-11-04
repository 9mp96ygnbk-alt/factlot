import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "./index.ts";

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: unknown;
};

test("lists calculator, ID, and schema tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const expected of [
    "calc_cam_reconciliation",
    "calc_debt_sizing",
    "calc_irr",
    "calc_net_effective_rent",
    "calc_npv",
    "calc_rent_schedule",
    "calc_walt",
    "fact_validate",
    "id_document",
    "id_entity",
    "id_parcel",
    "id_parse",
    "id_space",
    "schema_get",
    "search",
    "fetch",
    "calc_compare_proposals",
    "calc_lease_vs_own",
    "calc_renew_vs_relocate",
    "calc_hotel_metrics",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  const cam = tools.find((t) => t.name === "calc_cam_reconciliation");
  const capProps = (cam?.inputSchema.properties?.cap ?? {}) as {
    description?: string;
  };
  assert.match(
    capProps.description ?? "",
    /cap/i,
    "field descriptions reach agents",
  );
  const debt = tools.find((t) => t.name === "calc_debt_sizing");
  assert.equal(debt?.inputSchema.type, "object");
  assert.ok(
    debt?.inputSchema.properties && "noi" in debt.inputSchema.properties,
  );
  await client.close();
});

test("calc tool returns value, trace, and computed provenance", async () => {
  const client = await connect();
  const r = (await client.callTool({
    name: "calc_debt_sizing",
    arguments: {
      noi: 1_000_000,
      value: 15_000_000,
      rate_annual: 0.06,
      amortization_years: 30,
      max_ltv: 0.65,
      min_dscr: 1.25,
    },
  })) as ToolResult;
  assert.notEqual(r.isError, true);
  const sc = r.structuredContent as {
    value: { max_loan: number };
    provenance: { formula: string };
    steps: unknown[];
  };
  assert.equal(sc.value.max_loan, 9_750_000);
  assert.equal(sc.provenance.formula, "calc.debt_sizing@3");
  assert.ok(sc.steps.length > 0);
  await client.close();
});

test("calc tool reports domain errors as tool errors", async () => {
  const client = await connect();
  const r = (await client.callTool({
    name: "calc_rent_schedule",
    arguments: {
      commencement_date: "2026-01-01",
      term_months: 12,
      area_sf: 1000,
      starting_rent_psf_annual: 20,
      abated_months: [24],
    },
  })) as ToolResult;
  assert.equal(r.isError, true);
  await client.close();
});

test("id tools are deterministic", async () => {
  const client = await connect();
  const call = async (apn: string) =>
    (
      (await client.callTool({
        name: "id_parcel",
        arguments: { state_fips: "06", county_fips: "037", apn },
      })) as ToolResult
    ).structuredContent;
  assert.deepEqual(await call("5432-001-012"), await call("5432 001 012"));
  const parsed = (await client.callTool({
    name: "id_parse",
    arguments: { urn: "fl:parcel:us-06037:5432001012" },
  })) as ToolResult;
  assert.equal(parsed.structuredContent?.kind, "parcel");
  const bad = (await client.callTool({
    name: "id_parse",
    arguments: { urn: "nope" },
  })) as ToolResult;
  assert.equal(bad.isError, true);
  await client.close();
});

test("fact_validate flags uncited facts", async () => {
  const client = await connect();
  const r = (await client.callTool({
    name: "fact_validate",
    arguments: {
      fact: {
        subject: "fl:parcel:us-06037:5432001012",
        predicate: "parcel.zoning_district",
        value: "M2",
        as_of: "2026-11-02",
        provenance: { method: "extracted", sources: [] },
      },
    },
  })) as ToolResult;
  assert.equal(r.structuredContent?.valid, false);
  await client.close();
});

test("search and fetch follow the ChatGPT deep research contract", async () => {
  const client = await connect();
  const s = (await client.callTool({
    name: "search",
    arguments: { query: "CAM cap non-cumulative" },
  })) as {
    content: { type: string; text: string }[];
  };
  const { results } = JSON.parse(s.content[0]?.text ?? "{}") as {
    results: { id: string; title: string; url: string }[];
  };
  assert.ok(results.length > 0);
  assert.ok(results.some((r) => r.id === "tool:calc_cam_reconciliation"));
  for (const r of results)
    assert.ok(r.id && r.title && r.url.startsWith("https://"));
  const f = (await client.callTool({
    name: "fetch",
    arguments: { id: "tool:calc_cam_reconciliation" },
  })) as {
    content: { type: string; text: string }[];
  };
  const doc = JSON.parse(f.content[0]?.text ?? "{}") as {
    id: string;
    text: string;
    url: string;
    metadata: Record<string, string>;
  };
  assert.equal(doc.id, "tool:calc_cam_reconciliation");
  assert.match(doc.text, /year_over_year/);
  assert.equal(doc.metadata.formula, "calc.cam_reconciliation@2");
  const missing = (await client.callTool({
    name: "fetch",
    arguments: { id: "nope" },
  })) as { isError?: boolean };
  assert.equal(missing.isError, true);
  await client.close();
});

test("input errors come back as the REST error object, not plain text", async () => {
  const client = await connect();
  for (const [name, args, path] of [
    ["calc_npv", { rate: "x", cash_flows: [1] }, "rate"],
    ["id_parcel", { state_fips: "06", county_fips: "037" }, "apn"],
    ["id_parcel", { state_fips: "06", county_fips: "037", apn: 7 }, "apn"],
    ["search", { query: 5 }, "query"],
    ["fetch", {}, "id"],
  ] as const) {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    assert.equal(r.isError, true, name);
    const text = r.content[0]?.text ?? "";
    assert.doesNotMatch(text, /MCP error|-32602/, name);
    const error = JSON.parse(text) as {
      error: string;
      message: string;
      issues: { path: string; message: string }[];
    };
    assert.match(error.error, /InputError/, name);
    assert.match(error.message, /^invalid input: /, name);
    assert.ok(
      error.issues.some((i) => i.path === path),
      `${name}: ${JSON.stringify(error.issues)}`,
    );
  }
  // A domain error keeps its shape too.
  const lei = (await client.callTool({
    name: "id_entity",
    arguments: { jurisdiction: "lei", registry_number: "5493001KJTIIGC8Y1R13" },
  })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(lei.isError, true);
  assert.equal(
    (JSON.parse(lei.content[0]?.text ?? "{}") as { error: string }).error,
    "FactLotIdError",
  );
  const unknown = (await client.callTool({
    name: "no_such_tool",
    arguments: {},
  })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(unknown.isError, true);
  assert.equal(
    (JSON.parse(unknown.content[0]?.text ?? "{}") as { error: string }).error,
    "UnknownTool",
  );
  await client.close();
});

test("search says so when nothing matches, and fetch explains a document ID without a registry", async () => {
  const client = await connect();
  const s = (await client.callTool({
    name: "search",
    arguments: { query: "how to bake a sourdough cake" },
  })) as { content: { text: string }[] };
  const body = JSON.parse(s.content[0]?.text ?? "{}") as {
    results: unknown[];
    note?: string;
  };
  assert.deepEqual(body.results, []);
  assert.match(body.note ?? "", /No FactLot knowledge document matches/);
  const f = (await client.callTool({
    name: "fetch",
    arguments: { id: `fl:document:sha256-${"a".repeat(64)}` },
  })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(f.isError, true);
  const error = JSON.parse(f.content[0]?.text ?? "{}") as {
    error: string;
    message: string;
  };
  assert.equal(error.error, "RegistryUnavailable");
  assert.match(error.message, /no FactLot Registry|has none/);
  await client.close();
});
