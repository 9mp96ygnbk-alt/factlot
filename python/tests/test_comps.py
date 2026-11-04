"""lease_comp_validate: the shared conformance vectors (spec/vectors/lease_comps.json) and a few direct checks."""

import json
import unittest
from pathlib import Path

import factlot
from factlot import comps
from factlot.facts import validate_fact

SPEC = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "lease_comps.json"


def at(obj, path):
    for key in path.split("."):
        obj = obj[int(key)] if isinstance(obj, list) else obj.get(key) if isinstance(obj, dict) else None
    return obj


class LeaseCompVectors(unittest.TestCase):
    def test_every_vector(self):
        cases = json.loads(SPEC.read_text("utf-8"))["cases"]
        self.assertGreater(len(cases), 20)
        for c in cases:
            with self.subTest(case=c["name"]):
                result = factlot.run_tool(c["tool"], c["arguments"])
                self.assertNotIn("error", result, c["name"])
                for path, expected in c["expect"].items():
                    self.assertEqual(at(result, path), expected, f"{c['name']} → {path}")

    def test_ner_fact_is_a_valid_computed_fact(self):
        case = json.loads(SPEC.read_text("utf-8"))["cases"][0]
        ner = factlot.run_tool(case["tool"], case["arguments"])["ner"]["fact"]
        self.assertEqual(validate_fact(ner), {"valid": True, "issues": []})
        self.assertEqual(ner["provenance"]["method"], "computed")
        self.assertEqual(ner["provenance"]["formula"], "calc.net_effective_rent@1")

    def test_no_party_name_field_exists(self):
        names = {k for k, _c, _r in comps._FIELDS}
        self.assertFalse(names & {"tenant", "landlord", "tenant_name", "landlord_name", "broker", "contact"})

    def test_term_from_dates(self):
        self.assertEqual(comps.implied_term_months("2022-10-01", "2032-09-30"), 120)
        self.assertEqual(comps.implied_term_months("2026-01-01", "2026-01-31"), 1)


if __name__ == "__main__":
    unittest.main()
