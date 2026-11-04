// lease_comp_validate conformance vectors (spec/vectors/lease_comps.json), shared with the Python SDK.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LeaseComp } from "@factlot/schema";

import { runTool } from "./index.ts";

const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/lease_comps.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    tool: string;
    arguments: unknown;
    expect: Record<string, unknown>;
  }[];
};

const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );

test("vectors: lease_comp_validate", () => {
  assert.ok(spec.cases.length > 20);
  for (const c of spec.cases) {
    const outcome = runTool(c.tool, c.arguments);
    assert.ok(outcome.ok, c.name);
    if (outcome.ok)
      for (const [k, v] of Object.entries(c.expect))
        assert.deepEqual(at(outcome.result, k), v, `${c.name} → ${k}`);
  }
});

test("a derived NER fact is a valid FactLot fact and cites its formula", () => {
  const c = spec.cases[0];
  assert.ok(c);
  const outcome = runTool(c.tool, c.arguments);
  assert.ok(outcome.ok);
  const ner = (outcome.result as { ner: { fact: unknown } }).ner.fact;
  assert.equal(runTool("fact_validate", { fact: ner }).ok, true);
  const check = runTool("fact_validate", { fact: ner });
  assert.ok(check.ok);
  assert.deepEqual((check.result as { valid: boolean }).valid, true);
});

test("the published LeaseComp schema rejects an unknown field and accepts a minimal comp", () => {
  const minimal = {
    comp_type: "new",
    area_sf: 1000,
    commencement_date: "2026-01-01",
    confirming_party: "tenant",
    verification: "unverified",
  };
  assert.equal(LeaseComp.safeParse(minimal).success, true);
  assert.equal(
    LeaseComp.safeParse({ ...minimal, tenant_name: "Acme" }).success,
    false,
  );
});
