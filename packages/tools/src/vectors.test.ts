// Tool-level conformance vectors (spec/vectors/tools.json), shared with the Python SDK.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runTool } from "./index.ts";

const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/tools.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    tool: string;
    arguments: unknown;
    expect?: Record<string, unknown>;
    expect_error?: string;
  }[];
};

const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );

test("vectors: factlot-tools", () => {
  for (const c of spec.cases) {
    const label = `${c.tool} ${JSON.stringify(c.arguments)}`;
    const outcome = runTool(c.tool, c.arguments);
    if (c.expect_error) {
      assert.equal(outcome.ok, false, label);
      if (!outcome.ok) assert.equal(outcome.error.error, c.expect_error, label);
      continue;
    }
    assert.ok(outcome.ok, label);
    if (outcome.ok)
      for (const [k, v] of Object.entries(c.expect ?? {}))
        assert.deepEqual(at(outcome.result, k), v, `${label} → ${k}`);
  }
});
