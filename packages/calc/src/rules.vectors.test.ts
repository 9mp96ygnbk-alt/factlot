// Rules-pack conformance vectors (spec/vectors/rules), shared with the Python SDK.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { CalcInputError, rulePacks, texasHolidays } from "./index.ts";

const dir = new URL("../../../spec/vectors/rules/", import.meta.url);
const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );

for (const file of readdirSync(dir).filter(
  (f) => f.endsWith(".json") && f !== "texas_holidays.json",
)) {
  const spec = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as {
    rule: keyof typeof rulePacks;
    version: number;
    cases: {
      name: string;
      input: unknown;
      expect?: Record<string, unknown>;
      expect_error?: boolean;
    }[];
  };
  test(`rule vectors: ${spec.rule}`, () => {
    const rule = rulePacks[spec.rule];
    assert.ok(rule, spec.rule);
    assert.equal(rule.version, spec.version);
    const run = rule.run as (i: unknown) => unknown;
    for (const c of spec.cases) {
      if (c.expect_error) {
        assert.throws(() => run(c.input), CalcInputError, c.name);
        continue;
      }
      const result = run(c.input);
      for (const [path, expected] of Object.entries(c.expect ?? {})) {
        assert.deepEqual(at(result, path), expected, `${c.name} → ${path}`);
      }
      assert.ok(
        (result as { warnings: string[] }).warnings.some((w) =>
          w.includes("DRAFT"),
        ),
        "draft rules always warn",
      );
    }
  });
}

test("Texas holiday calendar matches the vector", () => {
  const spec = JSON.parse(
    readFileSync(new URL("texas_holidays.json", dir), "utf8"),
  ) as {
    years: Record<string, Record<string, string>>;
  };
  for (const [year, expected] of Object.entries(spec.years)) {
    assert.deepEqual(Object.fromEntries(texasHolidays(Number(year))), expected);
  }
});
