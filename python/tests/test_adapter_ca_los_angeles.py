"""Los Angeles County Assessor adapter tests on a SYNTHETIC fixture that copies the real export layout.

The header is the publisher's (field aliases, two columns named "Zip Code", a leading space on
" Location Longitude"); every AIN, address, and value below is invented.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ca_los_angeles

HEADER = (
    "Zip Code,City Tax Rate Area,AIN,Roll Year,Tax Rate Area Code,Assessor ID,Property Location,Property Use Type,"
    "Property Use Code,Use Code 1st Digit,Use Code 2nd Digit,Use Code 3rd Digit,Use Code 4th Digit,Number of Buildings,"
    "Year Built,Effective Year,Square Footage,Number of Bedrooms,Number of Bathrooms,Number of Units,Recording Date,"
    "Land Value,Land Base Year,Improvement Value,Improvement Base Year,Total Value Land Improvement,Home Owners Exemption,"
    "Real Estate Exemption,Fixture Value,Fixture Exemption,Personal Property Value,Personal Property Exemption,"
    "Property taxable?,Total Value,Total Exemption,Taxable Value,Classification,Region Number,Cluster Code,"
    "Parcel Legal Description,Address House Number,Address House Number Fraction,Direction,Street,Unit Number,City,"
    "Zip Code,Row ID,Location Latitude, Location Longitude,OBJECTID"
)


def row(ain, use_type, code, d1, d2, *, house="100", fraction=" ", direction=" ", street="EXAMPLE BLVD", unit=" ",
        city="LOS ANGELES CA", zip5="90001", year="1985", sqft="25000", units="0", land="1000000", imp="2000000",
        persprop="5000"):
    tot = str(int(land) + int(imp))
    total = str(int(tot) + int(persprop))
    return ",".join([
        f"{zip5}-1234", "LOS ANGELES", ain, "2026", "00016", f"{ain[:4]}-{ain[4:7]}-{ain[7:]}",
        f'"{house} {street}  {city}  {zip5}"', use_type, code, d1, f'"{d2}"', "4 Stories or Less", " ", "1",
        year, year, sqft, "0", "0", units, "5/14/1981 7:00:00 AM", land, "2011", imp, "2011", tot, "0", "0", "0", "0",
        persprop, "0", "Y", total, "0", total, " ", "02", "2411", '"TRACT NO 1 LOT 1"', house, fraction, direction,
        street, unit, city, zip5, f"2026{ain}", "34.0", "-118.0", "1",
    ])


ROWS = [
    row("2010004040", "R-I", "0501", "Residential", "Five or More Units or Apartments (Any Combination)", units="59"),
    row("2010004041", "C/I", "1700", "Commercial", "Office Building", house="200", direction="N", street="MAIN ST",
        unit="300", zip5="90012", year="1999", sqft="120000"),
    row("2010004042", "C/I", "3300", "Industrial", "Warehousing, Distribution, Storage", house="0", street="ELM AVE",
        city="VERNON CA", zip5="90058", year="0", sqft="0", land="500000", imp="0", persprop="0"),
    row("2010004043", "SFR", "0100", "Residential", "Single Family Residence", units="1"),
    row("2010004044", "VAC", "100V", "Commercial", "Commercial"),
    row("2010004045", "C/I", "2100", "Commercial", '"Restaurant, Cocktail Lounge"', fraction="1/2", street="",
        year="1966", sqft="1950"),
    row("2010004046", "OTH", "7100", "Institutional", "Church"),
]
BLANK_ROW = "," * (HEADER.count(",") - 1) + ",,"


def fixture(tmp: Path, name: str = "csv") -> Path:
    p = tmp / name
    p.write_bytes(("﻿" + "\r\n".join([HEADER, *ROWS, BLANK_ROW, BLANK_ROW, ""])).encode("utf-8"))
    return p


class LosAngeles(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = fixture(self.tmp)

    def test_category_mapping(self):
        sc = ca_los_angeles.state_category
        self.assertEqual((sc("0500"), sc("0501"), sc("055C")), ("B", "B", "B"), "05xx: five or more units")
        self.assertEqual((sc("1100"), sc("1700"), sc("2100"), sc("2700")), ("F1", "F1", "F1", "F1"))
        self.assertEqual((sc("3100"), sc("3300"), sc("38V0")), ("F2", "F2", "F2"))
        for code in ("0100", "0200", "0400", "010C", "4100", "5300", "6600", "7100", "8800", "LA00", " ", "", None):
            self.assertIsNone(sc(code), code)
        self.assertIsNone(sc("100V", "VAC"), "vacant land is out of scope whatever its zoning code")
        self.assertIsNone(sc("050V", "vac"))
        self.assertEqual(sc("1700", "C/I"), "F1")

    def test_mapping_from_the_export(self):
        recs = {r.apn: r for r in ca_los_angeles.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["2010004040", "2010004041", "2010004042", "2010004045"],
                         "B, F1, F2 kept; single family, vacant land, institutional, blank rows dropped")
        apts = recs["2010004040"]
        self.assertEqual(apts.county_fips, "037")
        self.assertEqual((apts.state_category, apts.local_use_code), ("B", "0501"))
        self.assertEqual(apts.account, "2010004040")
        self.assertEqual(apts.situs_address, "100 EXAMPLE BLVD, LOS ANGELES CA 90001")
        self.assertEqual((apts.improvement_area_sf, apts.year_built), (25000, 1985))
        self.assertEqual(apts.appraised_value, 3000000, "roll land + improvement value, without personal property")
        self.assertIsNone(apts.market_value, "California publishes assessed values, not market estimates")
        self.assertIsNone(apts.land_area_sf, "no land area in the file")
        self.assertEqual(apts.tax_year, 2026)
        self.assertEqual(apts.locator, "Row ID 20262010004040")
        self.assertIsNone(apts.owner_name, "the public file has no owner of record")
        self.assertIsNone(apts.owner_mailing_address)
        self.assertFalse(apts.owner_confidential)
        office = recs["2010004041"]
        self.assertEqual((office.state_category, office.local_use_code), ("F1", "1700"))
        self.assertEqual(office.situs_address, "200 N MAIN ST UNIT 300, LOS ANGELES CA 90012")
        warehouse = recs["2010004042"]
        self.assertEqual((warehouse.state_category, warehouse.local_use_code), ("F2", "3300"))
        self.assertEqual(warehouse.situs_address, "ELM AVE, VERNON CA 90058", "house number 0 is no number")
        self.assertIsNone(warehouse.improvement_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(warehouse.year_built)
        self.assertEqual(warehouse.appraised_value, 500000)
        restaurant = recs["2010004045"]
        self.assertIsNone(restaurant.situs_address, "no street, no situs")
        self.assertEqual(restaurant.local_use_code, "2100")

    def test_all_categories_and_directory_input(self):
        every = list(ca_los_angeles.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 7, "every non-blank row, out-of-scope ones with no category")
        self.assertEqual([r.state_category for r in every if r.apn == "2010004044"], [None])
        self.assertEqual([r.apn for r in ca_los_angeles.read_roll(self.csv, categories=["F2"])], ["2010004042"])
        d = self.tmp / "pieces"
        d.mkdir()
        fixture(d, "a.csv")
        fixture(d, "b.csv")
        self.assertEqual(len(list(ca_los_angeles.read_roll(d))), 8, "a directory reads every *.csv in it")

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = ca_los_angeles.build(self.csv, db, as_of="2026-10-14")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (4, 4, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        self.assertEqual(stats.retired, 0, "pieces of the roll never retire parcels")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ca-los-angeles-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("06", "037"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'la_ain' AND external_id = '2010004041'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-06037:2010004041")
            facts = {r[0]: r[1] for r in reg.db.execute(
                "SELECT predicate, value_json FROM current_facts WHERE subject = ?", (urn,)).fetchall()}
            self.assertIn('"1700"', facts["parcel.local_use_code"])
            self.assertIn('"F1"', facts["parcel.state_property_category"])
            self.assertNotIn("ownership.owner_of_record", facts)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
