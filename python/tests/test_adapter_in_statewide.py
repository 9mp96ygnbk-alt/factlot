"""Indiana statewide parcel adapter tests on a SYNTHETIC fixture.

The fixture copies the shape of an ArcGIS ``f=json`` page of IGIO "Parcel Boundaries of Indiana
Current" (fields confirmed 2026-11-06). Every parcel id, address and name here is invented. The
live layer has no owner column; the fixture plants name-like attributes to prove they are not stored.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.ids import parcel_id
from factlot.registry import Registry
from factlot.registry.adapters import in_statewide

FIXTURE = Path(__file__).parent / "fixtures" / "in_statewide"
KEPT = [
    "01-00-00-000-001.000-001",
    "01-00-00-000-002.000-001",
    "32-00-00-000-003.000-001",
    "01-00-00-000-004.000-001",
    "01-00-00-000-005.000-001",
    "01-00-00-000-006.000-001",
    "01-00-00-000-007.000-001",
    "01-00-00-000-008.000-001",
    "01-00-00-000-009.000-001",
    "---",
    "45-00-00-000-023.000-001",
    "45-00-00-000-024.000-001",
]


class IndianaStatewide(unittest.TestCase):
    def setUp(self):
        pages = sorted(FIXTURE.glob("*.json"))
        self.assertGreaterEqual(len(pages), 1)
        n = 0
        for page in pages:
            n += len(json.loads(page.read_text())["features"])
        self.assertLessEqual(n, 50, "the synthetic fixture stays at or under 50 rows")
        self.assertEqual(n, 25)

    def test_state_category_from_dlgf_codes(self):
        sc = in_statewide.state_category
        for code in ("300", "309", "310", "350", "390", "395", "399", 350, 395.0):
            self.assertEqual(sc(code), "F2", code)
        for code in ("400", "409", "410", "420", "447", "499", " 447 "):
            self.assertEqual(sc(code), "F1", code)
        for code in ("401", "402", "403", 403):
            self.assertEqual(sc(code), "B", code)
        for code in ("100", "101", "200", "500", "510", "520", "600", "640", "820", "40", "3", "F1", "F2", "B",
                     "A", "", None):
            self.assertIsNone(sc(code), code)

    def test_commercial_rows_and_drops(self):
        recs = {r.apn: r for r in in_statewide.read_roll(FIXTURE)}
        self.assertEqual(sorted(recs), sorted(KEPT))
        apt = recs["01-00-00-000-001.000-001"]
        self.assertEqual((apt.county_fips, apt.state_category, apt.local_use_code), ("003", "B", "403"))
        self.assertEqual(apt.situs_address, "100 EXAMPLE ST, FORT WAYNE, IN 46802")
        self.assertIsNone(apt.owner_name, "a name planted on the row is not an owner field")
        self.assertIsNone(apt.owner_mailing_address)
        self.assertEqual((apt.land_area_sf, apt.market_value, apt.appraised_value, apt.year_built),
                         (None, None, None, None))
        self.assertEqual(apt.account, "003:01-00-00-000-001.000-001")
        works = recs["01-00-00-000-002.000-001"]
        self.assertEqual((works.state_category, works.county_fips), ("F2", "003"))
        self.assertIsNone(works.owner_name)
        office = recs["32-00-00-000-003.000-001"]
        self.assertEqual((office.county_fips, office.state_category), ("063", "F1"))
        self.assertEqual(office.situs_address, "200 SAMPLE AVE, AVON, IN 46123", "DLGF situs when prop_add is blank")
        self.assertIsNone(recs["01-00-00-000-004.000-001"].situs_address)
        self.assertEqual(recs["01-00-00-000-005.000-001"].state_category, "B")
        self.assertEqual(recs["01-00-00-000-006.000-001"].state_category, "B")
        self.assertEqual(recs["01-00-00-000-009.000-001"].state_category, "F2", "395 is industrial by family")
        self.assertEqual(recs["45-00-00-000-024.000-001"].state_category, "F1")
        self.assertNotIn("49-00-00-000-017.000-001", recs, "Marion County is left to in-marion-parcels")
        self.assertNotIn("17-00-00-000-021.000-001", recs)
        self.assertNotIn("97-00-00-000-022.000-001", recs)

    def test_all_categories_still_drops_marion_and_blank_ids(self):
        every = list(in_statewide.read_roll(FIXTURE, categories=None))
        apns = [r.apn for r in every]
        self.assertEqual(len(apns), 19, "25 rows, minus one duplicate polygon, one later-page duplicate, "
                         "Marion, a blank state id, a non-Indiana county, and a 3-digit county code")
        self.assertEqual(sum(1 for r in every if r.state_category is None), 7)
        self.assertNotIn("49-00-00-000-017.000-001", apns)
        self.assertTrue(all(r.owner_name is None for r in every))

    def test_county_fips_and_loaddate(self):
        self.assertEqual(in_statewide.county_fips("18003"), "003")
        self.assertEqual(in_statewide.county_fips("18097"), None)
        self.assertIsNone(in_statewide.county_fips("097"))
        self.assertIsNone(in_statewide.county_fips("17031"))
        self.assertEqual(in_statewide.loaddate_day(1756425600000), "2025-08-29")
        self.assertEqual(in_statewide.loaddate_day("2025-10-27"), "2025-10-27")
        self.assertIsNone(in_statewide.loaddate_day(None))

    def test_build_rejects_invalid_id_and_stores_no_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "registry.db"
            stats = in_statewide.build(FIXTURE, db, as_of="2026-11-06")
            self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope),
                             (12, 11, 1, 0))
            self.assertEqual(stats.owners_person_or_withheld, 0)
            self.assertEqual(len(stats.errors), 1)
            self.assertIn('APN "---" is empty after normalization', stats.errors[0])
            reg = Registry.open_readonly(db)
            try:
                src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'in-statewide-parcels'").fetchone()
                self.assertEqual(src["state_fips"], "18")
                self.assertIsNone(src["county_fips"])
                dates = [row[0] for row in reg.db.execute("SELECT DISTINCT as_of FROM snapshots")]
                self.assertEqual(dates, ["2025-08-29"], "the page loaddate, not the fallback --as-of")
                urn = parcel_id("18", "003", "01-00-00-000-001.000-001").urn
                self.assertEqual(urn, "fl:parcel:us-18003:01-00-00-000-001-000-001")
                stored = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'in_state_parcel' "
                                        "AND external_id = '003:01-00-00-000-001.000-001'").fetchone()[0]
                self.assertEqual(stored, urn)
                owners = reg.db.execute(
                    "SELECT COUNT(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
                self.assertEqual(owners, 0)
                leaked = reg.db.execute(
                    "SELECT COUNT(*) FROM facts WHERE value_json LIKE '%EXAMPLE, ALEX%' "
                    "OR value_json LIKE '%EXAMPLE WORKS LLC%'").fetchone()[0]
                self.assertEqual(leaked, 0, "planted names are not stored")
                marion = reg.db.execute(
                    "SELECT COUNT(*) FROM current_facts WHERE subject LIKE 'fl:parcel:us-18097:%'").fetchone()[0]
                self.assertEqual(marion, 0)
            finally:
                reg.close()

    def test_page_without_loaddate_uses_the_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "query"
            page.write_text(json.dumps({"features": [{"attributes": {
                "state_parcel_id": "01-00-00-000-030.000-001", "county_fips": "18003",
                "dlgf_prop_class_code": "447", "prop_add": "30 PLAIN ST", "prop_city": "FORT WAYNE",
                "prop_state": "IN", "prop_zip": "46802"}}]}), encoding="utf-8")
            db = Path(tmp) / "registry.db"
            in_statewide.build(page, db, as_of="2026-11-06")
            reg = Registry.open_readonly(db)
            try:
                self.assertEqual(reg.db.execute("SELECT as_of FROM snapshots").fetchone()[0], "2026-11-06")
            finally:
                reg.close()


if __name__ == "__main__":
    unittest.main()
