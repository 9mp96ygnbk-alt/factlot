// Shared readiness vectors. Expected objects were written by hand, not by running FactLot.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  calculators,
  harrisBuildingAreaReadiness as harrisFromPackage,
} from "./index.ts";
import { harrisBuildingAreaReadiness } from "./harris_building_area_readiness.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const spec = JSON.parse(
  readFileSync(
    new URL(
      "../../../spec/vectors/harris_building_area_readiness.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  note: string;
  secrets: string[];
  definitions: Record<string, string>;
  issue_library: Record<string, unknown>;
  shell: Record<string, unknown>;
  cases: { name: string; input: unknown; set: Record<string, unknown> }[];
};

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$special") {
      if (record.$special === "nan") return Number.NaN;
      if (record.$special === "inf") return Number.POSITIVE_INFINITY;
      if (record.$special === "-inf") return Number.NEGATIVE_INFINITY;
      throw new Error("bad special");
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = revive(item);
    return out;
  }
  return value;
}

function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$def")
      return spec.definitions[String(record.$def)];
    if (keys.length === 1 && keys[0] === "$issue")
      return expand(spec.issue_library[String(record.$issue)]);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = expand(item);
    return out;
  }
  return value;
}

function expectOf(set: Record<string, unknown>): Record<string, unknown> {
  return expand({
    ...structuredClone(spec.shell),
    ...structuredClone(set),
  }) as Record<string, unknown>;
}

function walkVerified(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walkVerified(item);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("verified_against_publisher" in record)
      assert.equal(record.verified_against_publisher, false);
    for (const item of Object.values(record)) walkVerified(item);
  }
}

test("harris commercial building-area readiness vectors", () => {
  assert.ok(spec.cases.length >= 20);
  assert.match(spec.note, /by hand/);
  assert.match(spec.note, /not a valuation/);
  for (const c of spec.cases) {
    const input = revive(c.input);
    assert.equal(JSON.stringify(input).includes('"$special"'), false, c.name);
    const actual = harrisBuildingAreaReadiness(input);
    assert.deepEqual(actual, expectOf(c.set), c.name);
    assert.equal(actual.not_county_complete, true, c.name);
    assert.equal(actual.queryable, false, c.name);
    assert.equal(actual.verified_against_publisher, false, c.name);
    assert.equal(actual.publisher_content_checked, false, c.name);
    assert.equal(actual.computed, false, c.name);
    assert.equal(actual.imputed, false, c.name);
    assert.equal(actual.substituted, false, c.name);
    assert.equal(actual.summed, false, c.name);
    assert.equal(actual.repair_claimed, false, c.name);
    assert.equal(actual.act_ar_recommended_commercial_fill, false, c.name);
    walkVerified(actual);
    const blob = JSON.stringify(actual);
    assert.equal(blob.includes("@"), false, c.name);
    assert.equal(blob.includes("http"), false, c.name);
    for (const secret of spec.secrets)
      assert.equal(blob.includes(secret), false, `${c.name} ${secret}`);
  }
});

test("package export does not register a calculator", () => {
  assert.equal(harrisFromPackage, harrisBuildingAreaReadiness);
  assert.equal(
    Object.hasOwn(calculators, "harris_building_area_readiness"),
    false,
  );
  assert.equal(
    Object.hasOwn(calculators, "harrisBuildingAreaReadiness"),
    false,
  );
});

test("typescript matches python on every vector", () => {
  const script = `
import json
from factlot.harris_building_area_readiness import harris_building_area_readiness
spec = json.load(open("spec/vectors/harris_building_area_readiness.json", encoding="utf-8"))

def revive(value):
    if isinstance(value, list):
        return [revive(item) for item in value]
    if isinstance(value, dict):
        if list(value) == ["$special"]:
            kind = value["$special"]
            if kind == "nan":
                return float("nan")
            if kind == "inf":
                return float("inf")
            if kind == "-inf":
                return float("-inf")
            raise SystemExit("bad special")
        return {key: revive(item) for key, item in value.items()}
    return value

out = [harris_building_area_readiness(revive(case["input"])) for case in spec["cases"]]
print(json.dumps(out))
`;
  const ran = spawnSync("python3", ["-c", script], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: `${root}/python/src` },
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr);
  const python = JSON.parse(ran.stdout) as unknown[];
  spec.cases.forEach((c, i) => {
    assert.deepEqual(
      harrisBuildingAreaReadiness(revive(c.input)),
      python[i],
      c.name,
    );
  });
});
