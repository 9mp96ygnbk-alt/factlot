// Tool-level conformance vectors (spec/vectors/tools.json), shared with the Python SDK.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
    expect_issues?: { path: string; message: string }[];
    expect_message_contains?: string[];
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
      if (!outcome.ok) {
        assert.equal(outcome.error.error, c.expect_error, label);
        if (c.expect_issues)
          assert.deepEqual(outcome.error.issues, c.expect_issues, label);
        for (const text of c.expect_message_contains ?? [])
          assert.ok(outcome.error.message.includes(text), `${label} ${text}`);
      }
      continue;
    }
    assert.ok(outcome.ok, label);
    if (outcome.ok)
      for (const [k, v] of Object.entries(c.expect ?? {}))
        assert.deepEqual(at(outcome.result, k), v, `${label} → ${k}`);
  }
});

// The calculator conformance vectors (spec/vectors/calc), replayed through runTool: the tool
// layer must give what the calculator gives (the hosted API and MCP run tools this way).
test("vectors: calculators through runTool", () => {
  const dir = new URL("../../../spec/vectors/calc/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const spec = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as {
      calculator: string;
      cases: {
        name: string;
        input: unknown;
        expect?: Record<string, unknown>;
        expect_error?: boolean;
        tolerance?: number;
      }[];
    };
    const tool = `calc_${spec.calculator.replace(/^calc\./, "")}`;
    for (const c of spec.cases) {
      const label = `${tool}: ${c.name}`;
      const outcome = runTool(tool, c.input);
      if (c.expect_error) {
        assert.equal(outcome.ok, false, label);
        continue;
      }
      assert.ok(outcome.ok, label);
      if (!outcome.ok) continue;
      for (const [k, v] of Object.entries(c.expect ?? {})) {
        const got = at(outcome.result, k);
        if (typeof v === "number" && typeof got === "number" && c.tolerance)
          assert.ok(Math.abs(got - v) <= c.tolerance, `${label} → ${k}`);
        else assert.deepEqual(got, v, `${label} → ${k}`);
      }
    }
  }
});
