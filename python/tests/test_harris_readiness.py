"""Shared readiness vectors. Expected objects were written by hand, not by running FactLot."""

import json
import unittest
from pathlib import Path

from factlot.harris_readiness import county_evidence_gate, harris_readiness

VECTORS = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "harris_readiness.json"
FNS = {"harris_readiness": harris_readiness, "county_evidence_gate": county_evidence_gate}


class HarrisReadinessVectors(unittest.TestCase):
    def test_vectors_match_and_do_not_certify_the_county(self):
        spec = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(spec["cases"]), 12)
        self.assertIn("by hand", spec["note"])
        for case in spec["cases"]:
            with self.subTest(case=case["name"]):
                actual = FNS[case["fn"]](case["input"])
                self.assertEqual(actual, case["expect"])
                self.assertIs(actual["not_county_complete"], True)
                self.assertIs(actual["queryable"], False)
                self.assertIs(actual["verified_against_publisher"], False)
                blob = json.dumps(actual)
                self.assertNotIn("QX7", blob)
                self.assertNotIn("owner@example.test", blob)
