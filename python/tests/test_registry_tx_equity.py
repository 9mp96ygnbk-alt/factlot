"""registry_tx_equity_candidates and parcel value history, on the shared synthetic fixture.

Every record here is SYNTHETIC (spec/registry/build_fixture.py): invented accounts, values and names.
The TypeScript twin answers the same calls (spec/registry/calls.json, packages/tools/src/registry.test.ts).
"""

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

import factlot
from factlot.registry.tx_equity import NOTICE, PARCEL_PREDICATES, situs_zip5
from factlot.tools import configure_registry

SPEC = Path(__file__).resolve().parents[2] / "spec" / "registry"
CALLS = json.loads((SPEC / "calls.json").read_text())
TOOL = "registry_tx_equity_candidates"
SUBJECT = "fl:parcel:us-48997:1000001"
PERSON_PARCEL, WITHHELD_PARCEL = "fl:parcel:us-48997:1000014", "fl:parcel:us-48997:1000015"
# What the roll gives for owners the registry does not keep (a natural person; an owner withheld under §25.025).
NOT_STORED = {"Jane Q Example", "Jane", "12 Quiet Lane", "CONFIDENTIAL"}


def walk(value: Any, path: str = ""):
    """Every (path, key, leaf) in a JSON value; key is None for list items and the root."""
    if isinstance(value, dict):
        for k, v in value.items():
            yield f"{path}.{k}", k, v
            yield from walk(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield f"{path}.{i}", None, v
            yield from walk(v, f"{path}.{i}")


class TxEquity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = Path(tempfile.mkdtemp()) / "fixture.db"
        subprocess.run([sys.executable, str(SPEC / "build_fixture.py"), str(cls.db)], check=True, capture_output=True)
        configure_registry(str(cls.db))

    @classmethod
    def tearDownClass(cls):
        configure_registry(None)

    def run_tool(self, args: dict[str, Any]) -> dict[str, Any]:
        return factlot.run_tool(TOOL, args)

    def test_tiers_order_and_effective_parameters(self):
        r = self.run_tool({"urn": SUBJECT, "tax_year": 2026})
        self.assertEqual(r["selection"]["parameters"],
                         {"area_band": 0.35, "year_band": 15, "min_matches": 10, "limit": 50, "tax_year": 2026})
        tiers = {t["tier"]: t for t in r["selection"]["tiers"]}
        self.assertEqual(tiers["neighborhood"]["ids"], ["fl:parcel:us-48997:1000002", "fl:parcel:us-48997:1000003"])
        # Same ZIP code: nearest area first, and a tie in area (40,000 and 60,000 sf) broken by URN.
        self.assertEqual([i[-2:] for i in tiers["zip"]["ids"]], ["15", "14", "04", "05"])
        self.assertEqual(tiers["county"]["ids"], ["fl:parcel:us-48997:1000009"])  
        self.assertTrue(r["selection"]["widened_to_county"])  # 6 < min_matches
        ids = [c["id"] for c in r["candidates"]]
        for excluded in ("1000006", "1000007", "1000008", "1000010", "1000011", "1000012", "1000013", SUBJECT[-7:]):
            self.assertNotIn(f"fl:parcel:us-48997:{excluded}", ids)
        criteria = r["selection"]["criteria"]
        self.assertEqual((criteria["tax_year"], criteria["state_property_category"], criteria["zip"]), (2026, "F1", "77001"))
        self.assertEqual(criteria["year_built"], {"subject": 2005, "min": 1990, "max": 2020})
        # Not widened when the first two tiers hold min_matches.
        r6 = self.run_tool({"urn": SUBJECT, "min_matches": 6, "tax_year": 2026})
        self.assertFalse(r6["selection"]["widened_to_county"])
        self.assertEqual(len(r6["candidates"]), 6)
        self.assertTrue(self.run_tool({"urn": SUBJECT, "limit": 2, "tax_year": 2026})["selection"]["truncated"])

    def test_candidates_drop_into_the_calculator(self):
        r = self.run_tool({"urn": SUBJECT, "tax_year": 2026})
        keys = {"id", "county_fips", "value", "value_basis", "market_value", "appraised_value", "improvement_area_sf",
                "land_area_sf", "year_built", "state_property_category", "neighborhood_code", "building_class",
                "situs_address", "tax_year", "citation"}
        for c in r["candidates"]:
            self.assertEqual(set(c), keys)
            self.assertEqual(c["county_fips"], "997")
            self.assertEqual(c["value"], c["appraised_value"] if c["value_basis"] == "appraised" else c["market_value"])
        market_only = next(c for c in r["candidates"] if c["id"].endswith("1000003"))
        self.assertEqual((market_only["value_basis"], market_only["appraised_value"]), ("market", None))
        self.assertEqual(set(r["subject"]), keys | {"value_history"})
        self.assertEqual(r["subject"]["value"], 9800000)  # the corrected 2026 roll
        self.assertEqual(r["notice"], NOTICE)
        # Each candidate's citation names a snapshot in sources, which states every right of its source.
        by_doc = {s["document_id"]: s for s in r["sources"]}
        for c in [r["subject"], *r["candidates"]]:
            self.assertEqual(by_doc[c["citation"]["document_id"]]["source_id"], "test-cad-997")
            rights = by_doc[c["citation"]["document_id"]]["rights"]
            self.assertEqual(rights, {"ai_use": "unknown", "redistribution": "attribution_required",
                                      "license": "Synthetic test data", "attribution": "Example Central Appraisal District"})
        # A source that asks for no attribution says so (null), rather than leaving the field out.
        other = self.run_tool({"urn": "fl:parcel:us-48999:0004-000-0001"})["sources"]
        self.assertEqual({(s["source_id"], s["rights"]["attribution"]) for s in other}, {("test-roll", None)})

    def test_never_returns_owner_data(self):
        con = sqlite3.connect(self.db)
        rows = con.execute("SELECT fact_id, value_json FROM facts WHERE predicate LIKE 'ownership.%'").fetchall()
        allowed_facts = {r[0] for r in con.execute(
            f"SELECT fact_id FROM facts WHERE predicate IN ({','.join('?' * len(PARCEL_PREDICATES))})", PARCEL_PREDICATES)}
        # The owners the registry does not keep leave no ownership fact at all.
        kept = con.execute("SELECT COUNT(*) FROM facts WHERE predicate LIKE 'ownership.%' AND subject IN (?, ?)",
                           (PERSON_PARCEL, WITHHELD_PARCEL)).fetchone()[0]
        con.close()
        self.assertEqual(kept, 0)
        owner_ids = {r[0] for r in rows}
        owner_strings = {v for v in (json.loads(r[1]) for r in rows) if isinstance(v, str)} | NOT_STORED
        self.assertIn("Bayou Equity Holdings LLC", owner_strings)  # the fixture does hold owners
        outputs = [factlot.run_tool(c["tool"], c["arguments"]) for c in CALLS if c["tool"] == TOOL]
        self.assertGreater(sum("candidates" in o for o in outputs), 5)
        for out in outputs:
            ok = "error" not in out
            for path, key, leaf in walk(out):
                if key is not None:
                    self.assertFalse(key.startswith("ownership") or "owner" in key or "mailing" in key
                                     or key in ("relationships", "owns"), path)
                if isinstance(leaf, str):
                    self.assertNotIn(leaf, owner_ids, path)
                    self.assertFalse(any(v.upper() in leaf.upper() for v in owner_strings), path)
                    self.assertNotIn("ownership.", leaf, path)
                    if ok:  # an error may quote the entity URN it was given; a result names no entity
                        self.assertNotIn("fl:entity:", leaf, path)
                if key == "fact_id":
                    self.assertIn(leaf, allowed_facts, path)

    def test_person_and_withheld_owners_are_not_revealed(self):
        listed = [c["id"] for c in self.run_tool({"urn": SUBJECT, "tax_year": 2026})["candidates"]]
        self.assertIn(PERSON_PARCEL, listed)
        self.assertIn(WITHHELD_PARCEL, listed)
        for urn in (PERSON_PARCEL, WITHHELD_PARCEL):
            r = self.run_tool({"urn": urn})
            self.assertTrue(r["subject"]["value_history"])
            text = json.dumps(r).upper()
            for s in NOT_STORED:
                self.assertNotIn(s.upper(), text, urn)

    def test_inputs(self):
        self.assertEqual(self.run_tool({"county_fips": "997", "apn": "1000004"})["subject"]["id"], "fl:parcel:us-48997:1000004")
        err = self.run_tool({"urn": "fl:parcel:us-04021:50101001"})
        self.assertEqual(err["error"], "InputError")
        self.assertIn("Texas-only", err["message"])
        # Tarrant: its published signals leave AI-agent use unclear, so no parcel there is served (subject or candidate).
        for args in ({"urn": "fl:parcel:us-48439:00001234"}, {"county_fips": "439", "apn": "00001234"}):
            err = self.run_tool(args)
            self.assertEqual(err["error"], "InputError", args)
            self.assertIn("Tarrant Appraisal District's published signals do not say whether serving its data to AI "
                          "agents is allowed; FactLot does not serve Tarrant comparables until that is clarified",
                          err["message"])
        self.assertEqual(self.run_tool({"urn": "fl:entity:us-tx:0807777777"})["error"], "FactLotIdError")
        self.assertEqual(self.run_tool({"urn": "fl:parcel:us-48997:9999999"})["error"], "NotFound")
        for bad in ({}, {"apn": "1"}, {"urn": SUBJECT, "apn": "1"}, {"urn": SUBJECT, "area_band": 35},
                    {"urn": SUBJECT, "limit": 0}, {"urn": SUBJECT, "year_band": True}):
            self.assertEqual(self.run_tool(bad)["error"], "InputError", bad)
        missing = self.run_tool({"urn": "fl:parcel:us-48997:1000012"})
        self.assertEqual(missing["candidates"], [])
        self.assertIn("parcel.improvement_area_sf", missing["warnings"][0])

    def test_value_history(self):
        hist = factlot.run_tool("registry_get", {"urn": SUBJECT})["value_history"]
        # One roll source per tax year; tax year 2026 valued twice (the July roll, then the corrected October
        # roll): both, newest first.
        self.assertEqual([(e["tax_year"], e["appraised_value"], e["as_of"]) for e in hist],
                         [(2027, 10500000, "2027-04-15"), (2026, 9800000, "2026-10-15"), (2026, 10000000, "2026-07-25"),
                          (2025, 9000000, "2025-07-25")])
        # Never mixing years: each entry's values are cited to a snapshot whose own tax year is the entry's.
        con = sqlite3.connect(self.db)
        for e in hist:
            for cite in e["citations"].values():
                year = con.execute("SELECT value_json FROM facts WHERE subject = ? AND document_id = ? AND predicate = "
                                   "'parcel.tax_year'", (SUBJECT, cite["document_id"])).fetchone()
                self.assertEqual(json.loads(year[0]), e["tax_year"])
        con.close()
        self.assertTrue(all(e["citations"]["market_value"]["document_id"].startswith("fl:document:") for e in hist))
        # Restated unchanged by the corrected roll: listed once, cited to the newer snapshot.
        same = factlot.run_tool("registry_get", {"urn": "fl:parcel:us-48997:1000002"})["value_history"]
        self.assertEqual([(e["tax_year"], e["as_of"]) for e in same],
                         [(2027, "2027-04-15"), (2026, "2026-10-15"), (2025, "2025-07-25")])
        # as_of stops the history at that date.
        early = factlot.run_tool("registry_get", {"urn": SUBJECT, "as_of": "2026-08-01"})["value_history"]  # 2025, 2026
        self.assertEqual([e["as_of"] for e in early], ["2026-07-25", "2025-07-25"])
        # Market value only: appraised is null, with no citation.
        mv = factlot.run_tool("registry_get", {"urn": "fl:parcel:us-48997:1000003"})["value_history"][0]
        self.assertEqual((mv["appraised_value"], mv["citations"]["appraised_value"]), (None, None))
        self.assertNotIn("value_history", factlot.run_tool("registry_get", {"urn": "fl:entity:us-tx:0807777777"}))

    def test_every_field_comes_from_one_tax_year(self):
        """Subject and candidates are read from the chosen year's roll (and that year's buildings file) only."""
        con = sqlite3.connect(self.db)

        def expected(urn: str, sources: list[str], companions: list[str]) -> dict[str, Any]:
            def newest(predicate: str, among: list[str]) -> Any:
                if not among:
                    return None
                row = con.execute(
                    "SELECT f.value_json FROM current_facts f JOIN snapshots s ON s.document_id = f.document_id WHERE "
                    f"f.subject = ? AND f.predicate = ? AND s.source_id IN ({','.join('?' * len(among))}) "
                    "ORDER BY f.as_of DESC, f.fact_id LIMIT 1", (urn, predicate, *among)).fetchone()
                return json.loads(row[0]) if row else None

            fields = {k: newest(f"parcel.{k}", sources) for k in (
                "tax_year", "market_value", "appraised_value", "improvement_area_sf", "land_area_sf", "year_built",
                "state_property_category", "neighborhood_code", "situs_address")}
            fields["building_class"] = newest("parcel.building_class", sources) or newest("parcel.building_class", companions)
            return fields

        seen = {}
        for year, rolls, companions in ((2027, ["test-cad-997-2027"], ["test-cad-997-buildings-2027"]),
                                        (2026, ["test-cad-997"], ["test-cad-997-buildings"]),
                                        (2025, ["test-cad-997-2025"], [])):
            for args in ({"urn": SUBJECT, "tax_year": year}, *(({"urn": SUBJECT},) if year == 2027 else ())):
                r = self.run_tool(args)
                sel = r["selection"]
                self.assertEqual((sel["tax_year"], sel["roll_sources"], sel["building_class_sources"]),
                                 (year, rolls, companions), args)
                by_doc = {s["document_id"]: s["source_id"] for s in r["sources"]}
                for c in [r["subject"], *r["candidates"]]:
                    want = expected(c["id"], rolls, companions)
                    got = {k: c[k] for k in want}
                    self.assertEqual(got, want, (args, c["id"]))
                    self.assertEqual(c["tax_year"], year)
                    self.assertIn(by_doc[c["citation"]["document_id"]], rolls)
                    seen[(year, c["id"])] = got
        con.close()
        p02 = "fl:parcel:us-48997:1000002"
        # The test means something: the years differ for these parcels, and no field leaked across.
        self.assertEqual((seen[(2027, p02)]["neighborhood_code"], seen[(2026, p02)]["neighborhood_code"]), ("N150", "N100"))
        self.assertEqual((seen[(2027, p02)]["building_class"], seen[(2026, p02)]["building_class"]), ("A", "B"))
        self.assertEqual((seen[(2027, SUBJECT)]["building_class"], seen[(2026, SUBJECT)]["building_class"],
                          seen[(2025, SUBJECT)]["building_class"]), ("C", "B", None))
        self.assertEqual({seen[(y, p02)]["appraised_value"] for y in (2025, 2026, 2027)}, {8500000, 9100000, 9500000})
        # The default is the newest year with a value; 2027's reclassified and enlarged parcels drop out.
        default = self.run_tool({"urn": SUBJECT})
        self.assertEqual([c["id"][-2:] for c in default["candidates"]], ["02", "09"])
        self.assertEqual(default["selection"]["available_tax_years"], [2027, 2026, 2025])
        none = self.run_tool({"urn": SUBJECT, "tax_year": 2024})
        self.assertEqual((none["candidates"], none["selection"]["tax_year"]), ([], None))
        self.assertIn("no current roll for tax year 2024", none["warnings"][0])

    def test_situs_zip(self):
        self.assertEqual(situs_zip5("907 COMMERCE ST, HOUSTON TX 77002"), "77002")
        self.assertEqual(situs_zip5("300 Harbor Dr Ste 102, Example City TX 77999-1234"), "77999")
        self.assertEqual(situs_zip5("208 MASSACHUSETTS AVE NE # E WASHINGTON DC 20002"), "20002")
        self.assertIsNone(situs_zip5("100 Main Street, Suite 400"))
        self.assertIsNone(situs_zip5("12345 MAIN ST"))
        self.assertIsNone(situs_zip5(None))


if __name__ == "__main__":
    unittest.main()
