"""registry_lookup_batch on the shared synthetic fixture (spec/registry/build_fixture.py).

Every record here is SYNTHETIC: invented accounts, values and names. The TypeScript twin answers the same calls
(spec/registry/calls_lookup_batch.json, packages/tools/src/registry.test.ts).
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import factlot
import factlot.tools as tools_module
from factlot.tools import LOOKUP_BATCH_NOTICE, configure_registry, lookup_same_street

SPEC = Path(__file__).resolve().parents[2] / "spec" / "registry"
TOOL = "registry_lookup_batch"
# A parcel whose roll owner is a natural person (not stored) and one whose owner is withheld under §25.025.
PERSON_PARCEL, WITHHELD_PARCEL = "fl:parcel:us-48997:1000014", "fl:parcel:us-48997:1000015"


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

    def test_owner_is_what_registry_get_gives(self):
        # The registry keeps no owner for these two (a person; an owner withheld): the row says none.
        out = factlot.run_tool(TOOL, {"items": [{"urn": PERSON_PARCEL}, {"urn": WITHHELD_PARCEL}]})
        for e, urn in zip(out["results"], (PERSON_PARCEL, WITHHELD_PARCEL)):
            self.assertEqual(e["status"], "found")
            self.assertIsNone(e["parcel"]["owner_of_record"])
            record = factlot.run_tool("registry_get", {"urn": urn})
            self.assertFalse(any(f["predicate"] == "ownership.owner_of_record" for f in record["facts"]))

    def test_place_and_unit(self):
        out = factlot.run_tool(TOOL, {"items": [
            {"address": "12 Tower Ct, Shoreville, MD 21999"},
            {"address": "100 Main St"},
            {"address": "100 Main St, Houston, TX"},
            {"address": "700 Bayou Dr #1001"},
        ]})
        self.assertEqual([(e["status"], e.get("reason")) for e in out["results"]],
                         [("ambiguous", "place_differs"), ("ambiguous", "several_places"),
                          ("ambiguous", "place_differs"), ("found", None)])
        self.assertEqual(out["results"][3]["parcel"]["urn"], "fl:parcel:us-48999:0008-000-1001")

    def test_unavailable_item_is_its_own_error(self):
        real = tools_module.run_tool
        down = "fl:parcel:us-48997:1000002"

        def fake(name, args):
            if name == "registry_get" and (args or {}).get("urn") == down:
                return {"error": "RegistryUnavailable", "message": "cannot answer", "issues": []}
            return real(name, args)

        tools_module.run_tool = fake
        try:
            items = [{"urn": "fl:parcel:us-48997:1000001"}, {"urn": down}]
            out = real(TOOL, {"items": items})
        finally:
            tools_module.run_tool = real
        self.assertEqual([e["status"] for e in out["results"]], ["found", "error"])
        self.assertEqual(out["results"][1]["error"]["error"], "RegistryUnavailable")

    def test_exact(self):
        same = lookup_same_street
        self.assertTrue(same("100 Main St", "100 Main Street, Shoreville MD 21999"))
        self.assertFalse(same("100 Main St", "100 Main Street, Suite 400"))
        self.assertTrue(same("300 Harbor Drive Unit 102", "300 Harbor Dr Ste 102, Example City TX 77999-1234"))
        self.assertTrue(same("1200 Main St Houston TX 77002", "1200 Main Street, Houston TX 77002"))
        self.assertTrue(same("700 Bayou Dr Unit 1001, Example City TX", "700 Bayou Drive 1001 Example City TX 77999"))
        self.assertFalse(same("700 Bayou Dr", "700 Bayou Drive 1001 Example City TX 77999"))
        self.assertFalse(same("500 Market St", None))

    def test_no_registry_fails_the_whole_call(self):
        configure_registry(None)
        try:
            out = factlot.run_tool(TOOL, {"items": [{"urn": "fl:parcel:us-48201:1"}]})
            self.assertEqual(out["error"], "RegistryUnavailable")
        finally:
            configure_registry(str(self.db))


if __name__ == "__main__":
    unittest.main()
