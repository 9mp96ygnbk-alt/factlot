// A runtime check inside the CAM batch names its path under cam in calc_reconcile_cam's input, the
// same as the schema's own issues do (the Python port always did; differential seed 7 found the
// TypeScript answering tenants.N.occupancy... without the cam prefix).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CalcInputError, reconcileCam } from "./index.ts";

const vectors = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/calc/reconcile_cam.json", import.meta.url),
    "utf8",
  ),
) as { cases: { input: Record<string, unknown> }[] };

test("reconcile_cam: a move-out outside the period is reported under cam", () => {
  const input = JSON.parse(JSON.stringify(vectors.cases[0]!.input)) as {
    cam: { year: number; tenants: Record<string, unknown>[] };
  };
  input.cam.tenants[1]!.occupancy = {
    move_out_date: `${input.cam.year + 1}-06-01`,
  };
  assert.throws(
    () => reconcileCam(input as never),
    (e: unknown) => {
      assert.ok(e instanceof CalcInputError);
      assert.deepEqual(
        e.issues.map((x) => x.path),
        ["cam.tenants.1.occupancy.move_out_date"],
      );
      assert.match(
        e.message,
        /^invalid input: cam\.tenants\.1\.occupancy\.move_out_date: must be within the reconciliation period$/,
      );
      return true;
    },
  );
});
