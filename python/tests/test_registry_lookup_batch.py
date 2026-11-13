"""registry_lookup_batch on the shared synthetic fixture (spec/registry/build_fixture.py).

Every record here is SYNTHETIC: invented accounts, values and names. The TypeScript twin answers the same calls
(spec/registry/calls_lookup_batch.json, packages/tools/src/registry.test.ts).
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import factlot
from factlot.tools import LOOKUP_BATCH_NOTICE, configure_registry, lookup_exact

SPEC = Path(__file__).resolve().parents[2] / "spec" / "registry"
TOOL = "registry_lookup_batch"
# A parcel whose roll owner is a natural person (not stored) and one whose owner is withheld under §25.025.
PERSON_PARCEL, WITHHELD_PARCEL = "fl:parcel:us-48997:1000014", "fl:parcel:us-48997:1000015"
NOT_STORED = {"Jane Q Example", "12 Quiet Lane", "CONFIDENTIAL"}


class LookupBatch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = Path(tempfile.mkdtemp()) / "fixture.db"
        subprocess.run([sys.executable, str(SPEC / "build_fixture.py"), str(cls.db)], check=True, capture_output=True)
        configure_registry(str(cls.db))

    @classmethod
    def tearDownClass(cls):
        configure_registry(None)

    def test_items_in_order_with_status(self):
        out = factlot.run_tool(TOOL, {"items": [
            {"ref": "a", "urn": "fl:parcel:us-48999:0001-000-0001"},
            {"ref": "b", "apn": "0001-000-0001", "county_fips": "48999"},
            {"ref": "c", "address": "500 Market St"},
            {"ref": "d", "apn": "501-01-001", "state_fips": "04", "county_fips": "021"},
            {"ref": "e", "urn": "fl:entity:us-tx:0801111111"},
        ]})
        self.assertEqual([(e["index"], e["ref"], e["status"]) for e in out["results"]],
                         [(0, "a", "found"), (1, "b", "found"), (2, "c", "ambiguous"), (3, "d", "not_found"),
                          (4, "e", "error")])
        self.assertEqual(out["summary"], {"items": 5, "found": 2, "not_found": 1, "ambiguous": 1, "errors": 1})
        self.assertEqual(out["notice"], LOOKUP_BATCH_NOTICE)
        row = out["results"][0]["parcel"]
        record = factlot.run_tool("registry_get", {"urn": "fl:parcel:us-48999:0001-000-0001"})
        owner = next(f for f in record["facts"] if f["predicate"] == "ownership.owner_of_record")
        self.assertEqual(row["owner_of_record"]["name"], owner["value"])
        self.assertEqual(row["value"], record["value_history"][0])
        self.assertEqual(out["results"][1]["parcel"], row)
        resolve = factlot.run_tool("registry_resolve_parcel", {"state_fips": "04", "county_fips": "021",
                                                              "apn": "501-01-001"})
        self.assertEqual(out["results"][3]["coverage"], resolve["coverage"])

    def test_owners_not_stored_stay_out(self):
        out = factlot.run_tool(TOOL, {"items": [{"urn": PERSON_PARCEL}, {"urn": WITHHELD_PARCEL}]})
        text = json.dumps(out)
        for s in NOT_STORED:
            self.assertNotIn(s, text)
        for e in out["results"]:
            self.assertEqual(e["status"], "found")
            self.assertIsNone(e["parcel"]["owner_of_record"])

    def test_exact(self):
        self.assertTrue(lookup_exact("100 Main St", "100 Main Street, Shoreville MD 21999"))
        self.assertFalse(lookup_exact("100 Main St", "100 Main Street, Suite 400"))
        self.assertTrue(lookup_exact("300 Harbor Drive Unit 102", "300 Harbor Dr Ste 102, Example City TX 77999-1234"))
        self.assertTrue(lookup_exact("1200 Main St Houston TX 77002", "1200 Main Street, Houston TX 77002"))
        self.assertFalse(lookup_exact("500 Market St", None))

    def test_no_registry_fails_the_whole_call(self):
        configure_registry(None)
        try:
            out = factlot.run_tool(TOOL, {"items": [{"urn": "fl:parcel:us-48201:1"}]})
            self.assertEqual(out["error"], "RegistryUnavailable")
        finally:
            configure_registry(str(self.db))


if __name__ == "__main__":
    unittest.main()
