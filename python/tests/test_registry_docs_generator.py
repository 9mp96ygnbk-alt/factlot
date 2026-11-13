"""scripts/registry/gen_coverage_docs.py builds docs/registry/rights.md and coverage.md.

The generator refuses to run if a count in docs/registry/coverage-data.json is not quoted from the
document it cites, so this test also proves the counts are not invented. It does not require the
committed pages to be current (a new source config would make them stale); run
``python3 scripts/registry/gen_coverage_docs.py --check`` for that.
"""

import importlib.util
import json
import re
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
        # What is hosted comes from site/_data/hosted.json (the hosted pack's manifest, via scripts/site/gen-hosted.ts).
        hosted = self.gen.hosted_summary()
        self.assertIn(hosted["places"], text)
        self.assertIn(hosted["totals"], text)
        hosted_ids = set(hosted["sources"])
        queryable_rows = [ln for ln in text.splitlines() if ln.startswith("| ") and "Yes: hosted on api.factlot.com" in ln]
        self.assertTrue(queryable_rows)
        for ln in queryable_rows:
            self.assertTrue(any(i in hosted_ids for i in re.findall(r"`([a-z0-9-]+)`", ln)), ln)
        # A source hosted for some counties only lists those counties (Utah: Juab and Summit).
        utah = [ln for ln in queryable_rows if "ut-ugrc-lir" in ln]
        utah_hosted = [c["name"] for c in hosted["counties"] if c["fips"].startswith("49")]
        self.assertEqual(len(utah), len(utah_hosted))
        self.assertTrue(all(any(n in ln for n in utah_hosted) for ln in utah))
        # Texas: the counties in the hosted pack, and never Tarrant (withheld)
        texas = sorted(ln.split("|")[1].strip() for ln in queryable_rows if "`tx-" in ln)
        self.assertEqual(texas, sorted(c["name"] for c in hosted["counties"] if c["fips"].startswith("48")))
        tarrant = [ln for ln in text.splitlines() if ln.startswith("| ") and "`tx-tarrant-ad`" in ln]
        self.assertTrue(tarrant)
        self.assertTrue(all("Yes: hosted" not in ln for ln in tarrant))

    def test_every_hosted_county_has_a_queryable_source(self):
        # coverage-data.json says which sources are hosted ("queryable", "hosted_areas"); a county the hosted pack
        # serves must be among them, so a new hosted region cannot be missing from coverage.md and the map.
        _cfg, data, _rows = self.gen.coverage_rows(self.configs)
        areas = data.get("hosted_areas", {})
        queryable = data.get("queryable", {})

        def listed(source_id, fips):
            parts = source_id.split("-")
            for n in range(len(parts), 1, -1):  # a per-year or companion source ("tx-harris-cad-2022") counts as its base
                sid = "-".join(parts[:n])
                if sid in queryable:
                    return True
                h = areas.get(sid)
                if h and (h["areas"] == "all" or fips in h["areas"]):
                    return True
            return False

        for c in self.gen.hosted_summary()["counties"]:
            self.assertTrue(any(listed(s, c["fips"]) for s in c["sources"]),
                            f"{c['name']} ({c['fips']}) is hosted but none of {c['sources']} is in coverage-data.json "
                            "hosted_areas or queryable")

    def test_every_hosted_entity_registry_says_whether_it_is_served_in_part(self):
        # An entity file served in part (the hosted pack's entity_scope, which gen-hosted.ts writes as `total`) is
        # "Partly" in coverage-data.json's "queryable", one served whole is "Yes".
        _cfg, data, _rows = self.gen.coverage_rows(self.configs)
        with open(self.gen.HOSTED_JSON, encoding="utf-8") as fh:
            hosted = json.load(fh)
        by_state = {e["state"]: e["source_id"] for e in data["entity_registries"]}
        for r in hosted["entity_registries"]:
            state = r["jurisdiction"].split("-")[1].upper()
            sid = by_state.get(state)
            self.assertIsNotNone(sid, f"{r['jurisdiction']} is hosted but has no entity_registries entry")
            text = data["queryable"].get(sid, "")
            want = "Partly" if "total" in r else "Yes"
            self.assertTrue(text.startswith(want), f"{sid}: {text!r} should start with {want!r} (hosted.json entity_registries)")

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
        # The map marks exactly the hosted pack's counties (site/_data/hosted.json, the source of registry_coverage),
        # with the pack's parcel count and as-of date; a county loaded only in part (Suffolk County: the City of
        # Boston) is hosted and says which part.
        pack = json.loads((ROOT / "site" / "_data" / "hosted.json").read_text(encoding="utf-8"))
        partial = {p["fips"]: p["area"] for p in pack["partial"]}
        self.assertEqual(hosted, sorted(c["fips"] for c in pack["counties"]))
        self.assertEqual(data["counts"]["hosted"], pack["totals"]["counties"])
        for c in pack["counties"]:
            row = data["counties"][c["fips"]]
            self.assertEqual((row["commercial_parcels"], row["data_as_of"]), (c["parcels"], c["as_of"]), c["name"])
            self.assertEqual(row.get("area"), partial.get(c["fips"]), c["name"])
        self.assertEqual(data["counties"]["25025"]["area"], "the City of Boston")
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
