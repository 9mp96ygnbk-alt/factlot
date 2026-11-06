"""lease_comp_search: the shared conformance vectors (spec/vectors/lease_comp_search.json) and checks on the bundled data."""

import json
import re
import unittest
from importlib import resources
from pathlib import Path

import factlot
from factlot import comps_search
from factlot.registry.normalize import is_organization

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "spec" / "vectors" / "lease_comp_search.json"
TS_DATA = ROOT / "packages" / "tools" / "src" / "data" / "gsa_lease_comps.ts"


def at(obj, path):
    for key in path.split("."):
        obj = obj[int(key)] if isinstance(obj, list) else obj.get(key) if isinstance(obj, dict) else None
    return obj


class LeaseCompSearchVectors(unittest.TestCase):
    def test_every_vector(self):
        cases = json.loads(SPEC.read_text("utf-8"))["cases"]
        self.assertGreater(len(cases), 10)
        for c in cases:
            with self.subTest(case=c["name"]):
                result = factlot.run_tool(c["tool"], c["arguments"])
                if "expect_error" in c:
                    self.assertEqual(result.get("error"), c["expect_error"], c["name"])
                    if "expect_issues" in c:
                        self.assertEqual(result["issues"], c["expect_issues"], c["name"])
                    if "expect_issue_paths" in c:
                        self.assertEqual([i["path"] for i in result["issues"]], c["expect_issue_paths"], c["name"])
                    continue
                self.assertNotIn("error", result, c["name"])
                for path, expected in c["expect"].items():
                    self.assertEqual(at(result, path), expected, f"{c['name']} → {path}")


class BundledData(unittest.TestCase):
    def setUp(self):
        self.tsv = resources.files("factlot").joinpath("data/gsa_lease_comps.tsv").read_text("utf-8")

    def test_typescript_copy_is_the_same_bytes(self):
        ts = TS_DATA.read_text("utf-8")
        m = re.search(r"export const GSA_LEASE_COMPS_TSV: string = `(.*)`;\n$", ts, re.S)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), self.tsv)

    def test_every_landlord_is_an_organisation(self):
        _meta, rows = comps_search._data()
        self.assertEqual(len(rows), 6994)
        landlords = [r["landlord"] for r in rows if r["landlord"] is not None]
        self.assertGreater(len(landlords), 6000)
        self.assertEqual([n for n in landlords if not is_organization(n)], [])

    def test_citation_and_caveat(self):
        cite = comps_search.citation()
        self.assertTrue(cite["document_id"].startswith("fl:document:sha256-"))
        self.assertTrue(cite["license"].startswith("Public domain"))
        self.assertEqual(cite["release"], "lease-comps-gsa-2026-11-04")
        r = factlot.run_tool("lease_comp_search", {"zip": "77002", "limit": 1})
        self.assertIn("is the tenant, not market comps for private tenants", r["caveat"])
        self.assertEqual(r["results"][0]["source"]["document_id"], cite["document_id"])

    def test_lease_ids_match_the_registry_adapter(self):
        from factlot.registry.adapters.gsa_leases import lease_urn

        for number in ("LCT00579", "LTX16707", "LDC12548"):
            self.assertEqual(comps_search.lease_urn(number), lease_urn(number))


if __name__ == "__main__":
    unittest.main()
