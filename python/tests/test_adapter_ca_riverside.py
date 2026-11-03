"""Riverside County Assessor (CREST open data tables) adapter tests on a SYNTHETIC fixture.

The headers are the publisher's (the Hub CSV export of ``CREST_GENERAL`` and ``CREST_TAXYEAR``, with
a byte-order mark and CRLF line endings); every PIN, address, and value below is invented.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ca_riverside

GENERAL_HEADER = ("OBJECTID,PIN,GEO_CD,CLASS_CODE,STREET_NAME,STREET_TYPE,STREET_PREDIRECTIONAL,STREET_NUMBER,"
                  "STREET_NUMBER_SFX,UNIT_NUMBER,CITY,POSTAL_CD,PRIME_BASE_YEAR,MULTIPLE,BUSINESS_USE_CODE")
TAXYEAR_HEADER = ("OBJECTID,PIN,TAX_YEAR,IS_TAXABLE,PRIMARY_TAG,SECONDARY_TAG,LAND,STRUCTURES,LIVING_IMPROVEMENTS,"
                  "TRADE_FIXTURES,PERSONAL_PROPERTY,LATE_FILING_10_PENALTY,LATE_FILING_15_PENALTY,HOMEOWNERS_EXMPT,"
                  "VETERANS_EXMPT,CHURCH_EXMPT,RELIGIOUS_EXMPT,PUBLIC_SCHOOL_EXMPT,PUBLIC_LIBRARY_EXMPT,"
                  "PUBLIC_MUSEUM_EXMPT,COLLEGE_EXMPT,HOSPITAL_EXMPT,PRIVATE_SCHOOL_EXMPT,CHARITY_RELIGIOUS_EXMPT,"
                  "OTHER_EXMPT")


def general(n, pin, klass, *, street="EXAMPLE", stype="AVE", pre="", number="100", sfx="", unit="", city="RIVERSIDE",
            zip5="92501"):
    return ",".join([str(n), pin, pin, f'"{klass}"' if "," in klass else klass, street, stype, pre, number, sfx, unit,
                     city, zip5, "", "", ""])


def taxyear(n, pin, land, structures, *, year="2027", personal="0"):
    return ",".join([str(n), pin, year, "1", "001", "002", land, structures, "0", "0", personal] + ["0"] * 14)


GENERAL_ROWS = [
    general(1, "900000001", "Apartment 11 - 20 Units", number="100"),
    general(2, "900000002", "Retail - General", number="200", pre="N", street="MAIN", stype="ST", unit="B"),
    general(3, "900000003", "Light Industrial", number="0", street="ROAD", sfx="A", city="PERRIS", zip5="92570"),
    general(4, "900000004", "Single Family Dwelling"),
    general(5, "900000005", "Vacant Commercial Land"),
    general(6, "900000006", "PP BUSINESS AND EQUIPMENT"),
    general(7, "900000007", "CT-Hotel"),
    general(8, "900000008", "Warehouse/Dry Storage", street="", number=""),
    general(9, "900000008", "Warehouse/Dry Storage", street="DUPLICATE ROW"),
    general(10, "900000009", "  office -   general ", number="300"),
    general(11, "900000010", "Triplex"),
]
TAXYEAR_ROWS = [
    taxyear(1, "900000001", "1000000.0", "2500000.0"),
    taxyear(2, "900000002", "400000.0", "600000.0"),
    taxyear(3, "900000003", "250000.0", ""),
    taxyear(4, "900000004", "50000.0", "150000.0"),
    taxyear(5, "900000008", "", ""),
    taxyear(6, "900000008", "1.0", "1.0"),
    taxyear(7, "900000009", "10.0", "20.0", personal="999"),
]


def write(tmp: Path, name: str, header: str, rows: list[str]) -> Path:
    p = tmp / name
    p.write_bytes(("﻿" + "\r\n".join([header, *rows, ""])).encode("utf-8"))
    return p


class Riverside(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.general = write(self.tmp, "general.csv", GENERAL_HEADER, GENERAL_ROWS)
        self.taxyear = write(self.tmp, "taxyear.csv", TAXYEAR_HEADER, TAXYEAR_ROWS)

    def test_category_mapping(self):
        sc = ca_riverside.state_category
        for d in ("Apartment 5 - 10 Units", "Apartment 11 - 20 Units", "Apartment 21 - 40 Units",
                  "Apartment 41 - 60 Units", "Apartment 61 - 100 Units", "Apartment Over 100 Units"):
            self.assertEqual(sc(d), "B", d)
        for d in ("Retail - General", "Office - Medical", "Full Service Restaurant", "Neighborhood Shopping Center",
                  "Hotel-General Commercial", "Mini-Storage", "Manufactured Home Park"):
            self.assertEqual(sc(d), "F1", d)
        for d in ("Light Industrial", "Heavy Industrial", "Warehouse/Cold Storage", "Industrial Condominium"):
            self.assertEqual(sc(d), "F2", d)
        for d in ("Single Family Dwelling", "Duplex", "Triplex", "Fourplex", "Vacant Commercial Land",
                  "Vacant Industrial Land", "Condo or PUD", "Timeshare Estate", "Irrigated Farmland",
                  "Place of Worship", "Government Property", "School - Primary", "PP BUSINESS AND EQUIPMENT",
                  "PP AIRCRAFT - COMMERCIAL", "CT-Apartment", "PI-Retail - General", "AP-Dairy Farm",
                  "MA-Office - General", "UNKNOWN", " ", "", None):
            self.assertIsNone(sc(d), d)
        self.assertEqual(sc("  office -   GENERAL "), "F1", "case and spacing do not matter")

    def test_mapping_from_the_tables(self):
        recs = {r.apn: r for r in ca_riverside.read_roll(self.general, self.taxyear)}
        self.assertEqual(sorted(recs), ["900000001", "900000002", "900000003", "900000008", "900000009"],
                         "B, F1, F2 kept; houses, vacant land, personal property, prefixed classes, triplex dropped")
        apts = recs["900000001"]
        self.assertEqual(apts.county_fips, "065")
        self.assertEqual((apts.state_category, apts.local_use_code), ("B", "Apartment 11 - 20 Units"))
        self.assertEqual(apts.account, "900000001")
        self.assertEqual(apts.situs_address, "100 EXAMPLE AVE, RIVERSIDE CA 92501")
        self.assertEqual(apts.appraised_value, 3500000, "assessed land + structures")
        self.assertIsNone(apts.market_value, "California publishes assessed values, not market estimates")
        self.assertEqual(apts.tax_year, 2027)
        self.assertEqual(apts.locator, "CREST_GENERAL PIN 900000001")
        self.assertIsNone(apts.owner_name, "the open tables carry no owner of record")
        self.assertIsNone(apts.owner_mailing_address)
        self.assertFalse(apts.owner_confidential)
        self.assertIsNone(apts.land_area_sf)
        self.assertIsNone(apts.year_built)
        retail = recs["900000002"]
        self.assertEqual(retail.state_category, "F1")
        self.assertEqual(retail.situs_address, "200 N MAIN ST UNIT B, RIVERSIDE CA 92501")
        self.assertEqual(retail.appraised_value, 1000000)
        factory = recs["900000003"]
        self.assertEqual(factory.state_category, "F2")
        self.assertEqual(factory.situs_address, "ROAD AVE, PERRIS CA 92570", "house number 0 is no number")
        self.assertEqual(factory.appraised_value, 250000, "a blank structure value is zero, not missing")
        warehouse = recs["900000008"]
        self.assertIsNone(warehouse.situs_address, "no street, no situs")
        self.assertIsNone(warehouse.appraised_value, "blank land and structures are no figure, not zero")
        self.assertEqual(recs["900000009"].appraised_value, 30, "personal property is not part of the real value")

    def test_general_only_has_no_values(self):
        recs = list(ca_riverside.read_roll(self.general))
        self.assertEqual(len(recs), 5)
        self.assertTrue(all(r.appraised_value is None and r.tax_year is None for r in recs))

    def test_all_categories_and_directory_input(self):
        every = list(ca_riverside.read_roll(self.general, categories=None))
        self.assertEqual(len(every), 10, "every distinct PIN, out-of-scope ones with no category")
        self.assertIsNone(next(r for r in every if r.apn == "900000004").state_category)
        self.assertEqual([r.apn for r in ca_riverside.read_roll(self.general, categories=["F2"])], ["900000003", "900000008"])
        d = self.tmp / "pieces"
        d.mkdir()
        write(d, "a.csv", GENERAL_HEADER, GENERAL_ROWS[:2])
        write(d, "b.csv", GENERAL_HEADER, GENERAL_ROWS[2:3])
        self.assertEqual(len(list(ca_riverside.read_roll(d))), 3, "a directory reads every *.csv in it")

    def test_build_registry_from_the_snapshots(self):
        db = self.tmp / "registry.db"
        stats = ca_riverside.build(self.general, self.taxyear, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (5, 5, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ca-riverside-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("06", "065"))
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 2,
                             "each table is its own snapshot")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'riverside_apn' AND external_id = '900000002'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-06065:900000002")
            facts = {r[0]: r[1] for r in reg.db.execute(
                "SELECT predicate, value_json FROM current_facts WHERE subject = ?", (urn,)).fetchall()}
            self.assertIn('"Retail - General"', facts["parcel.local_use_code"])
            self.assertIn('"F1"', facts["parcel.state_property_category"])
            self.assertEqual(facts["parcel.appraised_value"], "1000000.0")
            self.assertNotIn("ownership.owner_of_record", facts)
            docs = {r[0]: r[1] for r in reg.db.execute(
                "SELECT predicate, document_id FROM facts WHERE subject = ?", (urn,)).fetchall()}
            self.assertNotEqual(docs["parcel.situs_address"], docs["parcel.appraised_value"],
                                "class and situs cite the general table, values cite the tax-year table")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
