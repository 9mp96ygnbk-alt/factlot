// A DCF input with more than one base-year lease that lacks its base-year expense reports every one
// of them, not just the first (differential seed 3 found the Python port stopping at the first: 2
// issues against 1). The schema's issues list every problem, so the Python port now does too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CalcInputError, reconcileDcf } from "./index.ts";

const vectors = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/calc/reconcile_dcf.json", import.meta.url),
    "utf8",
  ),
) as { cases: { input: Record<string, unknown> }[] };

test("reconcile_dcf: every base-year lease without its base-year expense is an issue", () => {
  const input = JSON.parse(JSON.stringify(vectors.cases[0]!.input)) as {
    dcf: { leases: Record<string, unknown>[] };
  };
  const leases = input.dcf.leases;
  assert.ok(leases.length >= 2);
  for (const i of [0, 1]) {
    leases[i]!.recovery = "base_year";
    delete leases[i]!.base_year_opex_psf_annual;
  }
  assert.throws(
    () => reconcileDcf(input as never),
    (e: unknown) => {
      assert.ok(e instanceof CalcInputError);
      assert.deepEqual(
        e.issues.map((x) => x.path),
        [
          "dcf.leases.0.base_year_opex_psf_annual",
          "dcf.leases.1.base_year_opex_psf_annual",
        ],
      );
      assert.match(
        e.message,
        /required when recovery is base_year; dcf\.leases\.1/,
      );
      return true;
    },
  );
});
