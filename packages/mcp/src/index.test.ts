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
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
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
  assert.equal(sc.provenance.formula, "calc.debt_sizing@1");
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
