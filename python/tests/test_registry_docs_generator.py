"""scripts/registry/gen_coverage_docs.py builds docs/registry/rights.md and coverage.md.

The generator refuses to run if a count in docs/registry/coverage-data.json is not quoted from the
document it cites, so this test also proves the counts are not invented. It does not require the
committed pages to be current (a new source config would make them stale); run
``python3 scripts/registry/gen_coverage_docs.py --check`` for that.
"""

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_generator():
    spec = importlib.util.spec_from_file_location("gen_coverage_docs", ROOT / "scripts" / "registry" / "gen_coverage_docs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class RegistryDocsGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = load_generator()
        cls.configs = cls.gen.load_configs()

    def test_rights_lists_every_source(self):
        text = self.gen.gen_rights(self.configs)
        for s in self.configs:
            self.assertIn(f"`{s['source_id']}`", text)
        self.assertIn("not legal advice", text)

    def test_coverage_quotes_verify_and_only_the_hosted_regions_are_queryable(self):
        text = self.gen.gen_coverage(self.configs)  # raises SystemExit if a quote or number does not check out
        self.assertIn("run only on a self-hosted FactLot", text)
        queryable_rows = [ln for ln in text.splitlines() if ln.startswith("| ") and "Yes: hosted on api.factlot.com" in ln]
        self.assertTrue(queryable_rows)
        for ln in queryable_rows:
            self.assertTrue("dc-" in ln or "md-sdat-real-property" in ln or "ut-ugrc-lir" in ln or "`tx-" in ln, ln)
        utah = [ln for ln in queryable_rows if "ut-ugrc-lir" in ln]
        self.assertEqual(len(utah), 2)  # Juab and Summit only
        self.assertTrue(all("Juab" in ln or "Summit" in ln for ln in utah))
        # Texas: the six counties in the hosted pack, and never Tarrant (withheld)
        texas = sorted(ln.split("|")[1].strip() for ln in queryable_rows if "`tx-" in ln)
        self.assertEqual(
            texas,
            sorted(f"{n} County" for n in [
                "Harris", "Dallas", "Travis", "Collin", "Denton", "Williamson", "Cameron", "Nueces", "Galveston",
                "Jefferson", "Brazos", "Midland", "Ector", "Grayson", "Guadalupe", "Kaufman",
            ]),
        )
        tarrant = [ln for ln in text.splitlines() if ln.startswith("| ") and "`tx-tarrant-ad`" in ln]
        self.assertTrue(tarrant)
        self.assertTrue(all("Yes: hosted" not in ln for ln in tarrant))

    def test_an_unquoted_count_is_rejected(self):
        entry = {"source_id": "x", "parcels": 123456789, "cites": [{"doc": "docs/registry/sources/README.md", "quote": "87,717; 56,792"}]}
        with self.assertRaises(SystemExit):
            self.gen.verify_cites(entry, "test")
        bad_quote = {"source_id": "x", "parcels": 1, "cites": [{"doc": "docs/registry/sources/README.md", "quote": "this sentence is not in the document"}]}
        with self.assertRaises(SystemExit):
            self.gen.verify_cites(bad_quote, "test")


if __name__ == "__main__":
    unittest.main()


class CoverageMapGenerator(unittest.TestCase):
    """scripts/registry/gen_coverage_map.py: county classes for the factlot.com/coverage/ map."""

    def test_county_file_is_current_and_honest(self):
        import json
        import subprocess
        import sys

        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "registry" / "gen_coverage_map.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        data = json.loads((ROOT / "docs" / "registry" / "coverage-counties.json").read_text(encoding="utf-8"))
        hosted = sorted(f for f, c in data["counties"].items() if c["class"] == "hosted")
        # Maryland's 24 jurisdictions, DC, Juab and Summit counties in Utah, and sixteen Texas counties
        self.assertEqual(len(hosted), 43)
        self.assertIn("11001", hosted)
        self.assertEqual([f for f in hosted if f.startswith("49")], ["49023", "49043"])
        self.assertEqual(len([f for f in hosted if f.startswith("24")]), 24)
        # Harris, Dallas, Travis, Collin, Denton, Williamson, Cameron, Nueces, Galveston, Jefferson, Brazos,
        # Midland, Ector, Grayson, Guadalupe and Kaufman; Tarrant (48439) is withheld
        self.assertEqual(
            [f for f in hosted if f.startswith("48")],
            sorted(["48201", "48113", "48453", "48085", "48121", "48491", "48061", "48355", "48167", "48245",
                    "48041", "48329", "48135", "48181", "48187", "48257"]),
        )
        tarrant = data["counties"]["48439"]
        self.assertNotEqual(tarrant["class"], "hosted")
        self.assertFalse(tarrant["hosted"])
        self.assertIn("not served by the hosted registry", tarrant["withheld"])
        for fips, c in data["counties"].items():
            self.assertRegex(fips, r"^\d{5}$")
            self.assertGreater(c["commercial_parcels"], 0)
        not_counted = {(n["source_id"], n["reason"].split(":")[0]) for n in data["not_counted"]}
        self.assertIn(("pa-philadelphia-opa", "source not verified (publisher terms gate open)"), not_counted)
        self.assertIn(("ar-gis-parcels", "statewide or multi-county aggregate"), not_counted)
