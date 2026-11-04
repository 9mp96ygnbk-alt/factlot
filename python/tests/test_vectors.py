"""Run the shared conformance vectors (spec/vectors) against the Python SDK."""

import json
import math
import unittest
from pathlib import Path

import factlot
from factlot import CALCULATORS, CalcInputError, FactLotIdError, ids

SPEC = Path(__file__).resolve().parents[2] / "spec" / "vectors"


def at(obj, path):
    for key in path.split("."):
        obj = obj[int(key)] if isinstance(obj, list) else obj.get(key) if isinstance(obj, dict) else None
    return obj


def approx(test, actual, expected, tol, where):
    if isinstance(expected, list):
        test.assertIsInstance(actual, list, where)
        test.assertEqual(len(actual), len(expected), where)
        for i, (a, e) in enumerate(zip(actual, expected)):
            approx(test, a, e, tol, f"{where}[{i}]")
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool) and tol:
        test.assertTrue(math.isclose(actual, expected, rel_tol=0, abs_tol=tol), f"{where}: {actual} != {expected} ± {tol}")
    else:
        test.assertEqual(actual, expected, where)


class CalcVectors(unittest.TestCase):
    def test_every_vector_file(self):
        files = sorted((SPEC / "calc").glob("*.json"))
        self.assertGreater(len(files), 0)
        for f in files:
            spec = json.loads(f.read_text("utf-8"))
            name = spec["calculator"].removeprefix("calc.")
            self.assertIn(name, CALCULATORS, spec["calculator"])
            fn, fid, version = CALCULATORS[name]
            self.assertEqual((fid, version), (spec["calculator"], spec["version"]))
            for case in spec["cases"]:
                with self.subTest(calculator=name, case=case["name"]):
                    if case.get("expect_error"):
                        with self.assertRaises(CalcInputError):
                            fn(case["input"])
                        continue
                    result = fn(case["input"])
                    for path, expected in case["expect"].items():
                        approx(self, at(result, path), expected, case.get("tolerance", 0), f"{case['name']} → {path}")

    def test_registry_covers_every_vector_file(self):
        names = {json.loads(f.read_text("utf-8"))["calculator"].removeprefix("calc.") for f in (SPEC / "calc").glob("*.json")}
        self.assertEqual(names, set(CALCULATORS))


FNS = {
    "parcel": lambda i: ids.parcel_id(i["state_fips"], i["county_fips"], i["apn"]).as_dict(),
    "entity": lambda i: ids.entity_id(i["jurisdiction"], i["registry_number"]).as_dict(),
    "document": lambda i: ids.document_id(i["text"]).as_dict(),
    "space": lambda i: ids.space_id(i["building_urn"], i["suite"]).as_dict(),
    "normalize_apn": lambda i: {"value": ids.normalize_apn(i["apn"], i.get("county"))},
    "normalize_apn_v1": lambda i: {"value": ids.normalize_apn_v1(i["apn"])},
    "normalize_suite": lambda i: {"value": ids.normalize_suite(i["suite"])},
    "normalize_suite_v1": lambda i: {"value": ids.normalize_suite_v1(i["suite"])},
    "normalize_street": lambda i: {"value": ids.normalize_street(i["street"])},
    "building": lambda i: ids.building_id(i["state_fips"], i["county_fips"], i["zip"], i["street"]).as_dict(),
    "parse": lambda i: {"kind": ids.parse(i["urn"])[0], "short": ids.short_id(i["urn"])},
}


class IdVectors(unittest.TestCase):
    def test_id_vectors(self):
        spec = json.loads((SPEC / "id.json").read_text("utf-8"))
        for case in spec["cases"]:
            with self.subTest(fn=case["fn"], input=case["input"]):
                fn = FNS[case["fn"]]
                if case.get("expect_error"):
                    with self.assertRaises(FactLotIdError):
                        fn(case["input"])
                    continue
                out = fn(case["input"])
                for k, v in case["expect"].items():
                    self.assertEqual(out[k], v)


class ToolVectors(unittest.TestCase):
    def test_tool_vectors(self):
        spec = json.loads((SPEC / "tools.json").read_text("utf-8"))
        for case in spec["cases"]:
            with self.subTest(tool=case["tool"], arguments=case["arguments"]):
                out = factlot.run_tool(case["tool"], case["arguments"])
                if "expect_error" in case:
                    self.assertEqual(out.get("error"), case["expect_error"])
                    if "expect_issues" in case:
                        self.assertEqual(out.get("issues"), case["expect_issues"])
                    continue
                self.assertNotIn("error", out)
                for path, expected in case["expect"].items():
                    self.assertEqual(at(out, path), expected)


class RuleVectors(unittest.TestCase):
    def test_rule_vectors(self):
        from factlot.rules import RULES

        files = [f for f in sorted((SPEC / "rules").glob("*.json")) if f.name != "texas_holidays.json"]
        self.assertGreater(len(files), 0)
        for f in files:
            spec = json.loads(f.read_text("utf-8"))
            fn, rid, version = RULES[spec["rule"]]
            self.assertEqual((rid, version), (spec["calculator"], spec["version"]))
            for case in spec["cases"]:
                with self.subTest(rule=spec["rule"], case=case["name"]):
                    if case.get("expect_error"):
                        with self.assertRaises(CalcInputError):
                            fn(case["input"])
                        continue
                    result = fn(case["input"])
                    for path, expected in case["expect"].items():
                        self.assertEqual(at(result, path), expected, path)
                    draft = result["value"]["rule"]["verification"]["status"] != "verified"
                    self.assertEqual(any("DRAFT" in w for w in result["warnings"]), draft,
                                     "draft rules always warn; verified rules never carry the draft warning")

    def test_texas_holidays(self):
        from factlot.rules import texas_holidays

        spec = json.loads((SPEC / "rules" / "texas_holidays.json").read_text("utf-8"))
        for year, expected in spec["years"].items():
            self.assertEqual(texas_holidays(int(year)), expected)


class Mint(unittest.TestCase):
    def test_mint_is_valid_and_sortable(self):
        a = factlot.mint("building", 1_700_000_000_000)
        b = factlot.mint("building", 1_700_000_000_001)
        self.assertEqual(ids.parse(a.urn)[0], "building")
        self.assertLess(a.urn, b.urn)
        self.assertEqual(ids.short_id_kind(a.short), "building")
        with self.assertRaises(FactLotIdError):
            factlot.mint("parcel")


if __name__ == "__main__":
    unittest.main()
