"""Draft rules packs: shared vectors (spec/vectors/rules/drafts), reference tables, and the draft/verified separation."""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse

import factlot
from factlot import DRAFT_RULES, DRAFT_WARNING, RULES, CalcInputError, run_draft_rule
from factlot.rules_drafts import _PACKS, boston_berdo, nyc_ll97, wa_cbps

DRAFTS = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "rules" / "drafts"
OFFICIAL_HOSTS = {"www.nyc.gov", "lawfilesext.leg.wa.gov", "www.boston.gov", "statutes.capitol.texas.gov"}


def at(obj, path):
    for k in path.split("."):
        obj = obj[int(k)] if isinstance(obj, list) else obj[k]
    return obj


def load(name):
    return json.loads((DRAFTS / name).read_text("utf-8"))


class DraftVectors(unittest.TestCase):
    def test_every_pack_has_vectors(self):
        files = [f for f in DRAFTS.glob("*.json") if not f.name.endswith(".tables.json")]
        self.assertEqual(sorted(json.loads(f.read_text("utf-8"))["rule"] for f in files), sorted(DRAFT_RULES))

    def test_vectors(self):
        for f in sorted(DRAFTS.glob("*.json")):
            if f.name.endswith(".tables.json"):
                continue
            spec = json.loads(f.read_text("utf-8"))
            self.assertEqual(DRAFT_RULES[spec["rule"]], (spec["calculator"], spec["version"]))
            for case in spec["cases"]:
                with self.subTest(rule=spec["rule"], case=case["name"]):
                    if case.get("expect_error"):
                        with self.assertRaises(CalcInputError):
                            run_draft_rule(spec["rule"], case["input"], acknowledge_draft=True)
                        continue
                    result = run_draft_rule(spec["rule"], case["input"], acknowledge_draft=True)
                    for path, expected in case["expect"].items():
                        self.assertEqual(at(result, path), expected, path)
                    self.assertTrue(result["warnings"][0].startswith(DRAFT_WARNING))

    def test_reference_vectors_are_current(self):
        # The expected values come from an independent script; regenerating them must change nothing.
        r = subprocess.run([sys.executable, "-I", str(DRAFTS / "reference.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class DraftSeparation(unittest.TestCase):
    def test_metadata(self):
        for name, (_, meta) in _PACKS.items():
            v = meta["verification"]
            self.assertEqual(v["status"], "draft", name)
            self.assertNotIn("verified_by", v)
            self.assertNotIn("verified_at", v)
            self.assertTrue(meta["not_covered"])
            for c in meta["citations"]:
                self.assertIn(urlparse(c["url"]).netloc, OFFICIAL_HOSTS, c["url"])
                self.assertRegex(c["retrieved"], r"^\d{4}-\d{2}-\d{2}$")
                self.assertTrue(c["covers"])

    def test_verified_and_draft_packs_stay_separate(self):
        for name, (fn, _, _) in RULES.items():
            self.assertEqual(fn.__module__, "factlot.rules")
            self.assertNotIn(name, DRAFT_RULES)
        for name in DRAFT_RULES:
            self.assertEqual(factlot.run_tool(f"rules_{name}", {})["error"], "UnknownTool")

    def test_acknowledgement_required(self):
        inp = {"building_use": "office", "gross_floor_area_sf": 50000, "calendar_year": 2025}
        with self.assertRaises(CalcInputError):
            run_draft_rule("boston_berdo_emissions_standard", inp)
        with self.assertRaises(CalcInputError):
            run_draft_rule("boston_berdo_emissions_standard", inp, acknowledge_draft=1)
        with self.assertRaises(CalcInputError):
            run_draft_rule("no_such_pack", inp, acknowledge_draft=True)
        r = run_draft_rule("boston_berdo_emissions_standard", inp, acknowledge_draft=True)
        r["value"]["rule"]["title"] = "changed"
        self.assertNotEqual(boston_berdo.META["title"], "changed")


class DraftTables(unittest.TestCase):
    def test_nyc(self):
        ref = load("nyc_ll97.tables.json")
        self.assertEqual([list(r) for r in nyc_ll97.EMISSIONS_FACTORS],
                         [[r["property_type"], float(r["2024-2029"]), float(r["2030-2034"])]
                          for r in ref["emissions_factors_tco2e_per_sf"]])
        self.assertEqual([list(r) for r in nyc_ll97.OTHER_FUELS],
                         [[r["fuel"], r["label"], float(r["2024-2034"])] for r in ref["other_fuels_tco2e_per_kbtu"]])

    def test_wa(self):
        ref = load("wa_cbps.tables.json")
        num = lambda v: None if v is None else float(v)  # noqa: E731
        expected = []
        for a in ref["activities"]:
            s = a["shift_factor"] or {}
            expected.append([a["no"], a["type"], a["subtype"], a["detail"], num(a["eui_target_1"]["4C"]),
                             num(a["eui_target_1"]["5B"]), num(s.get("50_or_less")), num(s.get("51_to_167")),
                             num(s.get("168"))])
        self.assertEqual([list(r) for r in wa_cbps.ACTIVITIES], expected)

    def test_boston(self):
        ref = load("boston_berdo.tables.json")
        periods = ["2025-2029", "2030-2034", "2035-2039", "2040-2044", "2045-2049", "2050-"]
        self.assertEqual([list(r) for r in boston_berdo.STANDARDS],
                         [[r["building_use"], r["label"], *(float(r[p]) for p in periods)]
                          for r in ref["standards_kgco2e_per_sf"]])


if __name__ == "__main__":
    unittest.main()
