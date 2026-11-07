"""Registry coverage, address re-keying, and building roll-up.

All records here are SYNTHETIC test fixtures (invented names, numbers, and addresses) used only to
exercise code paths. The DC and NYC parcel numbers follow those places' lot-numbering layouts but
name no real property.
"""

import json
import tempfile
import unittest
from pathlib import Path

import factlot
from factlot.registry import ParcelRecord, Registry, Source
from factlot.registry import buildings, coverage
from factlot.registry.maintain import run as maintain
from factlot.registry.normalize import legacy_address_key, situs_street_and_zip, situs_names_unit
from factlot.tools import configure_registry


def _source(source_id: str, state: str, county: str | None) -> Source:
    return Source(source_id, "Example publisher (synthetic)", "Roll", "https://example.invalid/roll", state,
                  county_fips=county, license="Synthetic test data", ai_use="permitted", redistribution="permitted",
                  terms_reviewed="2026-11-02")


class SitusParsing(unittest.TestCase):
    def test_street_line_and_zip(self):
        self.assertEqual(situs_street_and_zip("208 MASSACHUSETTS AVE NE # E WASHINGTON DC 20002"),
                         ("208 MASSACHUSETTS AVE NE", "20002", "street_type_end"))
        self.assertEqual(situs_street_and_zip("208 MASSACHUSETTS AVE NE WASHINGTON DC 20002-4941"),
                         ("208 MASSACHUSETTS AVE NE", "20002", "street_type_end"))
        self.assertEqual(situs_street_and_zip("100 Main St Ste 4, Houston TX 77002"),
                         ("100 MAIN ST STE 4", "77002", "before_comma"))
        # A ZIP code the publisher cut short leaves its first digits.
        self.assertEqual(situs_street_and_zip("1330 NEW HAMPSHIRE AVE NW # 118 WASHINGTON DC 2003"),
                         ("1330 NEW HAMPSHIRE AVE NW", "2003", "street_type_end"))
        self.assertIsNone(situs_street_and_zip("RHODE ISLAND AVE NE WASHINGTON DC 20018"), "no house number")
        self.assertIsNone(situs_street_and_zip("100 Main Street, Suite 400"), "no ZIP code")
        self.assertIsNone(situs_street_and_zip("100 BROADWAY NEW YORK NY 10006"), "no street type and no comma")
        self.assertTrue(situs_names_unit("208 MASSACHUSETTS AVE NE # E WASHINGTON DC 20002"))
        self.assertTrue(situs_names_unit("100 Main St Ste. 4"))
        self.assertFalse(situs_names_unit("100 Suiter St"))

    def test_member_rules_follow_the_sources_lot_numbering(self):
        self.assertEqual(buildings.member_rule("fl:parcel:us-11001:01562001", "x"), ("dc_condo_lot", True))
        self.assertEqual(buildings.member_rule("fl:parcel:us-11001:0004n2032", "x"), ("dc_condo_lot", True))
        self.assertEqual(buildings.member_rule("fl:parcel:us-11001:07557029", "1 A ST NE # E"), ("same_street_address", True))
        self.assertEqual(buildings.member_rule("fl:parcel:us-11001:07550003", "1 A ST NE"), ("same_street_address", False))
        self.assertEqual(buildings.member_rule("fl:parcel:us-36061:1000091001", "x"), ("nyc_condo_unit_lot", True))
        self.assertEqual(buildings.member_rule("fl:parcel:us-36061:1000097501", "x"), ("nyc_condo_billing_lot", False))
        self.assertEqual(buildings.member_rule("fl:parcel:us-36061:1000090001", "x"), ("same_street_address", False))
        self.assertEqual(buildings.member_rule("fl:parcel:us-48201:1001", "x"), ("same_street_address", False))


class Rollup(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "registry.db"
        self.reg = Registry(self.path)
        self.reg.add_source(_source("dc-roll", "11", "001"))
        self.reg.add_source(_source("nyc-roll", "36", None))
        p = self.tmp / "dc.txt"
        p.write_text("synthetic dc")
        self.dc = self.reg.add_snapshot("dc-roll", p, as_of="2026-11-02", retrieved_at="2026-11-02T00:00:00+00:00")
        p = self.tmp / "nyc.txt"
        p.write_text("synthetic nyc")
        self.nyc = self.reg.add_snapshot("nyc-roll", p, as_of="2026-05-15", retrieved_at="2026-05-15T00:00:00+00:00")
        self.reg.ingest_parcels([
            ParcelRecord("001", "0999 2001", "F1", situs_address="10 EXAMPLE ST NW # 101 WASHINGTON DC 20001"),
            ParcelRecord("001", "0999 2002", "F1", situs_address="10 Example Street Northwest Unit 102, Washington DC 20001"),
            ParcelRecord("001", "0999 2003", "F1", situs_address="10 EXAMPLE ST NW # 103 WASHINGTON DC 2000"),
            ParcelRecord("001", "0999 0010", "F1", situs_address="10 EXAMPLE ST NW WASHINGTON DC 20001-1234"),
            ParcelRecord("001", "0999 0011", "F1", situs_address="12 EXAMPLE ST NW WASHINGTON DC 20001"),
            ParcelRecord("001", "0998 0001", "F1", situs_address="EXAMPLE ST NW WASHINGTON DC 20001"),
        ], self.dc, state_fips="11")
        self.reg.ingest_parcels([
            ParcelRecord("061", "1000091001", "F1", situs_address="5 EXAMPLE PLACE, NEW YORK NY 10004"),
            ParcelRecord("061", "1000091002", "F1", situs_address="5 EXAMPLE PL, NEW YORK NY 10004"),
            ParcelRecord("061", "1000097501", "F1", situs_address="5 EXAMPLE PL, NEW YORK NY 10004"),
        ], self.nyc, state_fips="36")

    def tearDown(self):
        self.reg.close()
        configure_registry(None)

    def test_condominium_units_roll_up_into_one_building_with_the_offline_id(self):
        out = self.reg.rollup_buildings()
        self.assertEqual(out["buildings"], 2)
        self.assertEqual(out["zip_codes_completed"], 1)
        self.assertEqual(out["by_rule"], {"dc_condo_lot": 3, "nyc_condo_billing_lot": 1, "nyc_condo_unit_lot": 2,
                                          "same_street_address": 1})
        dc = factlot.building_id("11", "001", "20001", "10 Example St NW").urn
        self.assertEqual(dc, "fl:building:us-11001:20001:10-example-st-nw")
        record = self.reg.get(dc)
        self.assertEqual((record["kind"], record["building"]["parcel_count"], record["building"]["unit_count"]), ("building", 4, 3))
        self.assertEqual(record["label"], "10 EXAMPLE ST NW, DC 20001")
        completed = [m for m in record["building"]["members"] if m["zip_found"] == "other_parcels"]
        self.assertEqual([m["urn"] for m in completed], [factlot.parcel_id("11", "001", "0999 2003").urn])
        unit = self.reg.get(factlot.parcel_id("11", "001", "0999 2002").urn)
        self.assertEqual((unit["building"]["urn"], unit["building"]["rule"]), (dc, "dc_condo_lot"))
        # A parcel alone at its address is not a rolled-up building.
        self.assertIsNone(self.reg.get(factlot.parcel_id("11", "001", "0999 0011").urn)["building"])
        nyc = self.reg.get("fl:building:us-36061:10004:5-example-pl")
        self.assertEqual((nyc["building"]["parcel_count"], nyc["building"]["unit_count"]), (3, 2))
        # Idempotent.
        self.assertEqual(self.reg.rollup_buildings()["buildings"], 2)
        self.assertEqual(self.reg.stats()["parcels"], 9)

    def test_a_land_account_names_the_improvement_account_of_its_building(self):
        """One building assessed on two accounts at one address (as 100 Light St, Baltimore, is in SDAT)."""
        self.reg.ingest_parcels([
            ParcelRecord("001", "0997 0001", "F1", situs_address="50 EXAMPLE ST NW WASHINGTON DC 20001",
                         land_area_sf=85000, market_value=4300000),
            ParcelRecord("001", "0997 0001A", "F1", situs_address="50 EXAMPLE ST NW WASHINGTON DC 20001",
                         improvement_area_sf=680000, year_built=1975, market_value=25700000),
        ], self.dc, state_fips="11")
        self.reg.rollup_buildings()
        land = factlot.parcel_id("11", "001", "0997 0001").urn
        improvements = factlot.parcel_id("11", "001", "0997 0001A").urn
        building = factlot.building_id("11", "001", "20001", "50 Example St NW").urn
        warnings = self.reg.get(land)["warnings"]
        self.assertEqual(warnings, [
            "This parcel record has no improvement facts (parcel.improvement_area_sf, parcel.year_built), so its "
            f"values may be for the land only. Another parcel of building {building} at the same address has them: "
            f"{improvements}. The building is probably assessed on that account; get it for the building's area, age "
            "and value."])
        self.assertEqual(self.reg.get(improvements)["warnings"], [])
        # Alone at its address, a record without improvement facts gets the general warning.
        alone = self.reg.get(factlot.parcel_id("11", "001", "0999 0011").urn)["warnings"]
        self.assertEqual(len(alone), 1)
        self.assertIn("it may be vacant land", alone[0])

    def test_coverage_is_stored_and_matches_a_fresh_computation(self):
        self.reg.rollup_buildings()
        computed = coverage.compute(self.reg.db)
        self.assertEqual([c["region"] for c in computed["counties"]], ["us-11001", "us-36061"])
        self.assertEqual(computed["totals"]["states"], ["DC", "NY"])
        self.reg.refresh_coverage()
        stored = json.loads(self.reg.db.execute("SELECT value FROM meta WHERE key = 'coverage'").fetchone()[0])
        self.assertEqual(stored["summary"], computed)
        self.assertEqual(coverage.stored_or_compute(self.reg.db), computed)
        # A later ingest makes the stored summary stale; readers then compute it.
        self.reg.ingest_parcels([ParcelRecord("001", "0997 0001", "F1", situs_address="1 NEW ST NE WASHINGTON DC 20002")],
                                self.dc, state_fips="11")
        self.assertEqual(coverage.stored_or_compute(self.reg.db)["totals"]["parcels"], 10)

    def test_tools_on_a_miss_say_what_is_loaded(self):
        self.reg.rollup_buildings()
        self.reg.refresh_coverage()
        self.reg.close()
        configure_registry(str(self.path))
        miss = factlot.run_tool("registry_resolve_parcel", {"state_fips": "04", "county_fips": "021", "apn": "1"})
        self.assertIsNone(miss["urn"])
        self.assertFalse(miss["coverage"]["county_loaded"])
        self.assertIn("Pinal County, AZ (04021) is not loaded in this registry", miss["coverage"]["message"])
        self.assertIn("District of Columbia, DC (11001, 6 parcels); New York County, NY (36061, 3 parcels)",
                      miss["coverage"]["message"])
        self.assertTrue(factlot.run_tool("registry_resolve_parcel", {"state_fips": "11", "county_fips": "001",
                                                                     "apn": "1"})["coverage"]["county_loaded"])
        self.assertEqual(factlot.run_tool("registry_get", {"urn": "not a urn"})["error"], "FactLotIdError")
        got = factlot.run_tool("registry_get", {"urn": "fl:entity:us-az:1"})
        self.assertEqual(got["error"], "NotFound")
        self.assertFalse(got["coverage"]["loaded"])
        cov = factlot.run_tool("registry_coverage", {})
        self.assertEqual(cov["totals"]["buildings"], 2)
        self.assertEqual(cov["address_key_version"], "2")
        self.reg = Registry(self.path)


class AddressKeys(unittest.TestCase):
    def test_a_legacy_file_is_searched_by_both_keys_until_rekeyed(self):
        tmp = Path(tempfile.mkdtemp())
        reg = Registry(tmp / "registry.db")
        reg.add_source(_source("dc-roll", "11", "001"))
        p = tmp / "dc.txt"
        p.write_text("synthetic dc")
        snap = reg.add_snapshot("dc-roll", p, as_of="2026-11-02")
        situs = "1722 Sixth Street Northwest, Suite 4, Washington DC 20001"
        reg.ingest_parcels([ParcelRecord("001", "0999 0001", "F1", situs_address=situs)], snap, state_fips="11")
        urn = factlot.parcel_id("11", "001", "0999 0001").urn
        # Simulate a file built before address key version 2.
        reg.db.execute("DELETE FROM address_index")
        reg.db.execute("INSERT INTO address_index VALUES (?, ?)", (legacy_address_key(situs), urn))
        reg.db.execute("DELETE FROM meta WHERE key = 'address_key_version'")
        self.assertEqual([r["urn"] for r in reg.search_address("1722 Sixth Street Northwest")], [urn],
                         "the version 1 key still matches the version 1 spelling")
        self.assertEqual(reg.search_address("1722 6th St NW"), [], "a version 1 key holds no NW")
        self.assertEqual(reg.rebuild_address_index(), {"addresses": 1, "keys": 1})
        self.assertEqual([r["urn"] for r in reg.search_address("1722 6th St N.W.")], [urn])
        self.assertEqual([r["urn"] for r in reg.search_address("1722 Sixth St North West Ste 9")], [urn])
        reg.close()

    def test_maintain_runs_the_new_steps(self):
        tmp = Path(tempfile.mkdtemp())
        reg = Registry(tmp / "registry.db")
        reg.close()
        out = maintain(str(tmp / "registry.db"), rebuild_addresses=True, buildings=True, coverage=True)
        self.assertLessEqual({"rebuild_address_index", "rollup_buildings", "refresh_coverage"}, set(out))


if __name__ == "__main__":
    unittest.main()
