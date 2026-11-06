// Shared readiness vectors. Expected objects were written by hand, not by running FactLot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { countyEvidenceGate, harrisReadiness } from "./harris_readiness.ts";

const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/harris_readiness.json", import.meta.url),
    "utf8",
  ),
) as {
  note: string;
  cases: {
    fn: string;
    name: string;
    input: unknown;
    expect: Record<string, unknown>;
  }[];
};

const fns: Record<string, (input: unknown) => Record<string, unknown>> = {
  harris_readiness: harrisReadiness,
  county_evidence_gate: countyEvidenceGate,
};

test("harris readiness vectors", () => {
  assert.ok(spec.cases.length >= 12);
  assert.match(spec.note, /by hand/);
  for (const c of spec.cases) {
    const actual = fns[c.fn]!(c.input);
    assert.deepEqual(actual, c.expect, c.name);
    assert.equal(actual.not_county_complete, true, c.name);
    assert.equal(actual.queryable, false, c.name);
    assert.equal(actual.verified_against_publisher, false, c.name);
    const blob = JSON.stringify(actual);
    assert.equal(blob.includes("QX7"), false, c.name);
    assert.equal(blob.includes("owner@example.test"), false, c.name);
  }
});
