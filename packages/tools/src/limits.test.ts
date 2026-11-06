// Structural input limits and per-field caps (security audit 2026-11-03). The Python SDK runs the
// same cases in python/tests/test_input_limits.py.
import assert from "node:assert/strict";
import test from "node:test";

import { configureRegistry } from "./registry.ts";
import {
  INPUT_LIMITS,
  inputShapeIssue,
  runTool,
  withoutNulls,
} from "./index.ts";

function errorOf(name: string, args: unknown) {
  const outcome = runTool(name, args);
  assert.equal(outcome.ok, false, `${name} should fail`);
  if (outcome.ok) throw new Error("unreachable");
  return outcome.error;
}

test("nesting deeper than maxDepth is refused before schema validation", () => {
  let deep: unknown = 1;
  for (let i = 0; i < 40; i++) deep = [deep];
  const err = errorOf("fact_validate", { fact: { value: deep } });
  assert.equal(err.error, "InputError");
  assert.match(err.message, /nested deeper than 32 levels/);
  // Level 1 is the arguments object, so the 33rd container is the first refused.
  assert.equal(err.issues[0]?.path, `fact.value${".0".repeat(30)}`);
});

test("one array over maxArrayItems is refused", () => {
  const err = errorOf("fact_validate", {
    fact: { value: new Array(INPUT_LIMITS.maxArrayItems + 1).fill(0) },
  });
  assert.equal(err.error, "InputError");
  assert.deepEqual(err.issues, [
    { path: "fact.value", message: "more than 10000 items" },
  ]);
});

test("more than maxNodes values in total are refused", () => {
  const value = Array.from({ length: 25 }, () => new Array(9000).fill(0));
  const err = errorOf("fact_validate", { fact: { value } });
  assert.deepEqual(err.issues, [
    { path: "", message: "more than 200000 values" },
  ]);
});

test("a string over maxStringLength is refused", () => {
  const err = errorOf("id_document", {
    text: "x".repeat(INPUT_LIMITS.maxStringLength + 1),
  });
  assert.equal(err.error, "InputError");
  assert.equal(err.issues[0]?.path, "text");
});

test("calculators report structural problems as CalcInputError", () => {
  assert.equal(errorOf("calc_npv", [1, 2]).error, "CalcInputError");
  assert.equal(
    errorOf("calc_npv", { cash_flows: new Array(10_001).fill(1), rate: 0 })
      .error,
    "CalcInputError",
  );
});

test("per-field caps: cash flows, leases, abated months, names, IDs", () => {
  assert.equal(
    errorOf("calc_irr", { cash_flows: [-1, ...new Array(1200).fill(1)] }).error,
    "CalcInputError",
  );
  assert.equal(
    runTool("calc_irr", { cash_flows: [-1000, ...new Array(1199).fill(1)] }).ok,
    true,
  );
  assert.equal(
    errorOf("calc_walt", {
      as_of: "2026-01-01",
      leases: new Array(10_001).fill({
        expiration_date: "2030-01-01",
        area_sf: 1,
      }),
    }).error,
    "CalcInputError",
  );
  assert.equal(
    errorOf("calc_rent_schedule", {
      commencement_date: "2026-01-01",
      term_months: 12,
      area_sf: 1000,
      starting_rent_psf_annual: 30,
      abated_months: new Array(1201).fill(1),
    }).error,
    "CalcInputError",
  );
  const parcel = errorOf("id_parcel", {
    state_fips: "06",
    county_fips: "037",
    apn: "1".repeat(201),
  });
  assert.equal(parcel.error, "InputError");
  assert.equal(parcel.issues[0]?.path, "apn");
});

test("validation issues are capped, with the remainder counted", () => {
  const err = errorOf("calc_npv", {
    cash_flows: new Array(50).fill("x"),
    rate: 0,
  });
  assert.equal(err.issues.length, INPUT_LIMITS.maxIssues);
  assert.match(err.message, /; and 30 more$/);
});

test("inputShapeIssue walks keys in sorted order and stops at the first problem", () => {
  const long = new Array(10_001).fill(0);
  assert.deepEqual(inputShapeIssue({ b: long, a: long }), {
    path: "a",
    message: "more than 10000 items",
  });
  assert.equal(inputShapeIssue({ a: [1, { b: "c" }] }), undefined);
});

test("an unopenable registry does not reveal its path", () => {
  configureRegistry("/nonexistent-factlot-dir/secret-name.db");
  try {
    const err = errorOf("registry_get", { urn: "fl:parcel:us-48201:1" });
    assert.equal(err.error, "RegistryUnavailable");
    assert.doesNotMatch(err.message, /nonexistent|secret-name/);
  } finally {
    configureRegistry(undefined);
  }
});

test("null for a named field is the field left out; open objects keep their nulls", () => {
  const schema = {
    type: "object",
    properties: {
      a: { type: "number" },
      nested: { type: "object", properties: { b: { type: "string" } } },
      rows: {
        type: "array",
        items: { type: "object", properties: { c: { type: "number" } } },
      },
      fact: { type: "object", additionalProperties: {} },
    },
  };
  assert.deepEqual(
    withoutNulls(schema, {
      a: null,
      nested: { b: null },
      rows: [{ c: null }, null],
      fact: { value: null },
      typo: null,
    }),
    { nested: {}, rows: [{}, null], fact: { value: null }, typo: null },
  );
  // Through runTool: the skipped optionals (as crewai-tools sends them) change nothing.
  const base = {
    noi: 1000000,
    rate_annual: 0.06,
    amortization_years: 30,
    max_ltv: 0.65,
    min_dscr: 1.25,
    value: 15000000,
  };
  assert.deepEqual(
    runTool("calc_debt_sizing", {
      ...base,
      min_debt_yield: null,
      existing_loan_balance: null,
      stress: null,
    }),
    runTool("calc_debt_sizing", base),
  );
});
