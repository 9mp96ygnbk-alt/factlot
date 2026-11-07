"""Shared readiness vectors. Expected objects were written by hand, not by running FactLot."""

import copy
import json
import math
import subprocess
import unittest
from pathlib import Path

import factlot
from factlot.harris_building_area_readiness import harris_building_area_readiness

ROOT = Path(__file__).resolve().parents[2]
VECTORS = ROOT / "spec" / "vectors" / "harris_building_area_readiness.json"


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
            raise AssertionError("bad special")
        return {key: revive(item) for key, item in value.items()}
    return value


def expand(value, spec):
    if isinstance(value, list):
        return [expand(item, spec) for item in value]
    if isinstance(value, dict):
        if list(value) == ["$def"]:
            return spec["definitions"][value["$def"]]
        if list(value) == ["$issue"]:
            return expand(spec["issue_library"][value["$issue"]], spec)
        return {key: expand(item, spec) for key, item in value.items()}
    return value


def expect_of(spec, case):
    merged = copy.deepcopy(spec["shell"])
    merged.update(copy.deepcopy(case["set"]))
    return expand(merged, spec)


def walk_verified(test, value):
    if isinstance(value, dict):
        if "verified_against_publisher" in value:
            test.assertIs(value["verified_against_publisher"], False)
        for item in value.values():
            walk_verified(test, item)
    elif isinstance(value, list):
        for item in value:
            walk_verified(test, item)


class HarrisBuildingAreaReadinessVectors(unittest.TestCase):
    def test_vectors_match_and_do_not_certify_the_county(self):
        spec = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(spec["cases"]), 20)
        self.assertIn("by hand", spec["note"])
        self.assertIn("not a valuation", spec["note"])
        for case in spec["cases"]:
            with self.subTest(case=case["name"]):
                raw = revive(case["input"])
                self.assertNotIn('"$special"', json.dumps(raw))
                actual = harris_building_area_readiness(raw)
                self.assertEqual(actual, expect_of(spec, case))
                self.assertIs(actual["not_county_complete"], True)
                self.assertIs(actual["queryable"], False)
                self.assertIs(actual["verified_against_publisher"], False)
                self.assertIs(actual["publisher_content_checked"], False)
                self.assertIs(actual["computed"], False)
                self.assertIs(actual["imputed"], False)
                self.assertIs(actual["substituted"], False)
                self.assertIs(actual["summed"], False)
                self.assertIs(actual["repair_claimed"], False)
                self.assertIs(actual["act_ar_recommended_commercial_fill"], False)
                walk_verified(self, actual)
                blob = json.dumps(actual)
                self.assertNotIn("@", blob)
                self.assertNotIn("http", blob)
                for secret in spec["secrets"]:
                    self.assertNotIn(secret, blob)

    def test_public_import_is_not_a_calculator(self):
        self.assertIs(factlot.harris_building_area_readiness, harris_building_area_readiness)
        self.assertIn("harris_building_area_readiness", factlot.__all__)
        self.assertNotIn("harris_building_area_readiness", factlot.CALCULATORS)

    def test_python_matches_typescript_on_every_vector(self):
        spec = json.loads(VECTORS.read_text(encoding="utf-8"))
        script = r"""
import { readFileSync } from "node:fs";
import { harrisBuildingAreaReadiness } from "./packages/calc/src/harris_building_area_readiness.ts";
const spec = JSON.parse(readFileSync("spec/vectors/harris_building_area_readiness.json", "utf8"));
function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$special") {
      if (value.$special === "nan") return NaN;
      if (value.$special === "inf") return Infinity;
      if (value.$special === "-inf") return -Infinity;
      throw new Error("bad special");
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = revive(item);
    return out;
  }
  return value;
}
process.stdout.write(JSON.stringify(spec.cases.map((c) => harrisBuildingAreaReadiness(revive(c.input)))));
"""
        ran = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                "--conditions=factlot-source",
                "--input-type=module",
                "-e",
                script,
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(ran.returncode, 0, ran.stderr)
        typescript = json.loads(ran.stdout)
        self.assertEqual(len(typescript), len(spec["cases"]))
        for case, other in zip(spec["cases"], typescript, strict=True):
            with self.subTest(case=case["name"]):
                actual = harris_building_area_readiness(revive(case["input"]))
                self.assertEqual(actual, other)
                self.assertFalse(
                    any(isinstance(item, float) and math.isnan(item) for item in _numbers(actual))
                )


def _numbers(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _numbers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _numbers(item)
    elif isinstance(value, float):
        yield value
