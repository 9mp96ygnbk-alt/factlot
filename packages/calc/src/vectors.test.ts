// Runs the language-neutral conformance vectors in spec/vectors/calc against @factlot/calc.
// Every FactLot SDK must pass these same files.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { CalcInputError, calculators } from "./index.ts";

const dir = new URL("../../../spec/vectors/calc/", import.meta.url);

interface VectorFile {
  calculator: string;
  version: number;
  cases: {
    name: string;
    input: unknown;
    expect?: Record<string, unknown>;
    expect_error?: boolean;
    tolerance?: number;
  }[];
}

function at(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );
}

function approx(
  actual: unknown,
  expected: unknown,
  tol: number,
  where: string,
): void {
  if (typeof expected === "number" && typeof actual === "number" && tol > 0) {
    assert.ok(
      Math.abs(actual - expected) <= tol,
      `${where}: ${actual} != ${expected} ± ${tol}`,
    );
  } else if (Array.isArray(expected)) {
    assert.ok(
      Array.isArray(actual) && actual.length === expected.length,
      `${where}: length mismatch`,
    );
    expected.forEach((e, i) =>
      approx((actual as unknown[])[i], e, tol, `${where}[${i}]`),
    );
  } else {
    assert.deepEqual(actual, expected, where);
  }
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const spec = JSON.parse(
    readFileSync(new URL(file, dir), "utf8"),
  ) as VectorFile;
  const name = spec.calculator.replace(
    /^calc\./,
    "",
  ) as keyof typeof calculators;
  const calc = calculators[name];
  test(`vectors: ${spec.calculator}`, () => {
    assert.ok(calc, `no calculator registered for ${spec.calculator}`);
    assert.equal(calc.version, spec.version, `${spec.calculator} version`);
    const run = calc.run as (input: unknown) => unknown;
    for (const c of spec.cases) {
      if (c.expect_error) {
        assert.throws(() => run(c.input), CalcInputError, c.name);
        continue;
      }
      const result = run(c.input);
      for (const [path, expected] of Object.entries(c.expect ?? {})) {
        approx(
          at(result, path),
          expected,
          c.tolerance ?? 0,
          `${c.name} → ${path}`,
        );
      }
    }
  });
}
