"""UGRC land information record (LIR) adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, address and value here is invented to exercise the mapping; none is real Utah
data. The header is the real alias header of the Hub CSV export (2026-11-03); the second fixture uses the
feature service's field names and the Utah County layer's shorter column list.
"""

import contextlib
import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ut_ugrc

HUB_HEADER = (
    "OBJECTID,County Name,County ID,County Assessor Info URL,County Recorder Info URL,Disclaimer URL,Current As Of,"
    "Parcel ID,Serial Number,Parcel Address,Parcel City,Tax Exempt Type,Tax District,Total Market Value,"
    "Land Market Value,Parcel Acres,Property Class,Primary Residence,Number of Housing Units,Subdivision Name,"
    "Square Footage,Square Footage Note,Number of Floors,Number of Floors Note,Year Built,Effective Year Built,"
    "Construction Material,Property Type,Shape__Area,Shape__Length"
).split(",")

SERVICE_HEADER = (
    "OBJECTID,COUNTY_NAME,COUNTY_ID,ASSESSOR_SRC,BOUNDARY_SRC,DISCLAIMER,CURRENT_ASOF,PARCEL_ID,SERIAL_NUM,PARCEL_ADD,"
    "PARCEL_CITY,TAXEXEMPT_TYPE,TAX_DISTRICT,TOTAL_MKT_VALUE,LAND_MKT_VALUE,PARCEL_ACRES,PROP_CLASS,PRIMARY_RES,"
    "HOUSE_CNT,SUBDIV_NAME,BLDG_SQFT,BLDG_SQFT_INFO,FLOORS_CNT,FLOORS_INFO,BUILT_YR,EFFBUILT_YR,CONST_MATERIAL,"
    "Shape__Area,Shape__Length"
).split(",")

COMMON = {"County Name": "Salt Lake County", "County ID": "18", "Current As Of": "9/29/2026 12:00:00 AM"}

HUB_ROWS = [
    # retail, with a city
    {**COMMON, "OBJECTID": "1", "Parcel ID": "08153760150001", "Parcel Address": "2217 N Example Rd",
     "Parcel City": "Salt Lake City", "Total Market Value": "9061600", "Land Market Value": "2134300",
     "Parcel Acres": "4.09", "Property Class": "Commercial - Retail", "Number of Housing Units": "2",
     "Square Footage": "38645", "Year Built": "2008", "Construction Material": "Cn"},
    # generic commercial, no city
    {**COMMON, "OBJECTID": "2", "Parcel ID": "08153760150002", "Parcel Address": "100 W Sample St",
     "Total Market Value": "1500000", "Parcel Acres": "0.5", "Property Class": "Commercial",
     "Square Footage": "0", "Year Built": "0"},
    # industrial, both spellings
    {**COMMON, "OBJECTID": "3", "Parcel ID": "08153760150003", "Parcel Address": "5 S Plant Ln",
     "Parcel City": "West Valley City", "Total Market Value": "3000000", "Parcel Acres": "10",
     "Property Class": "Industrial", "Square Footage": "90000", "Year Built": "1999"},
    {**COMMON, "OBJECTID": "4", "Parcel ID": "08153760150004", "Parcel Address": "6 S Plant Ln",
     "Parcel City": "West Valley City", "Total Market Value": "2000000", "Parcel Acres": "5",
     "Property Class": "Commercial - Industrial", "Square Footage": "40000"},
    # the publisher's multi-housing class
    {**COMMON, "OBJECTID": "5", "Parcel ID": "08153760150005", "Parcel Address": "77 E Apartment Way",
     "Parcel City": "Murray", "Total Market Value": "11641200", "Parcel Acres": "1.2",
     "Property Class": "Commercial - Apartment & Condo", "Number of Housing Units": "4", "Square Footage": "65103",
     "Year Built": "1985"},
    # office owned by a local government: out of scope
    {**COMMON, "OBJECTID": "6", "Parcel ID": "08153760150006", "Parcel Address": "1 S City Hall Plz",
     "Parcel City": "Sandy", "Tax Exempt Type": "Local Government", "Total Market Value": "5000000",
     "Property Class": "Commercial - Office Space"},
    # residential, vacant, exempt classes: out of scope
    {**COMMON, "OBJECTID": "7", "Parcel ID": "08153760150007", "Parcel Address": "9 N House St", "Property Class": "Residential",
     "Total Market Value": "500000"},
    {**COMMON, "OBJECTID": "8", "Parcel ID": "08153760150008", "Property Class": "Vacant", "Total Market Value": "100000"},
    {**COMMON, "OBJECTID": "9", "Parcel ID": "08153760150009", "Property Class": "Tax Exempt - Government"},
    # no parcel id: dropped
    {**COMMON, "OBJECTID": "10", "Parcel ID": "", "Property Class": "Commercial"},
    # not a Utah county id: dropped
    {"OBJECTID": "11", "County ID": "", "Parcel ID": "X1", "Property Class": "Commercial"},
]

SERVICE_ROWS = [
    {"OBJECTID": "1", "COUNTY_NAME": "Utah County", "COUNTY_ID": "25", "PARCEL_ID": "123450001",
     "PARCEL_ADD": "1 N Main St", "PARCEL_CITY": "Provo", "TOTAL_MKT_VALUE": "2500000", "PARCEL_ACRES": "1",
     "PROP_CLASS": "Commercial", "BLDG_SQFT": "12000", "BUILT_YR": "1990"},
    {"OBJECTID": "2", "COUNTY_NAME": "Utah County", "COUNTY_ID": "25", "PARCEL_ID": "123450002",
     "PARCEL_ADD": "2 N Main St", "PARCEL_CITY": "Provo", "TOTAL_MKT_VALUE": "", "PROP_CLASS": "Residential"},
]


def write_csv(path: Path, header: list[str], rows: list[dict[str, str]]) -> Path:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([r.get(h, "") for h in header])
    path.write_text("﻿" + buf.getvalue(), encoding="utf-8")  # the Hub export starts with a BOM
    return path


class UtahLir(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.hub = write_csv(self.tmp / "salt_lake.csv", HUB_HEADER, HUB_ROWS)
        self.service = write_csv(self.tmp / "utah.csv", SERVICE_HEADER, SERVICE_ROWS)

    def test_category_mapping(self):
        recs = {r.apn: r for r in ut_ugrc.read_roll(self.hub)}
        self.assertEqual(len(recs), 9, "rows without a parcel id or a Utah county id are dropped")
        self.assertEqual(recs["08153760150001"].state_category, "F1")
        self.assertEqual(recs["08153760150002"].state_category, "F1")
        self.assertEqual(recs["08153760150003"].state_category, "F2")
        self.assertEqual(recs["08153760150004"].state_category, "F2")
        self.assertEqual(recs["08153760150005"].state_category, "B")
        self.assertIsNone(recs["08153760150006"].state_category, "a government-exempt owner is out of scope")
        for apn in ("08153760150007", "08153760150008", "08153760150009"):
            self.assertIsNone(recs[apn].state_category)
        self.assertEqual(recs["08153760150005"].local_use_code, "Commercial - Apartment & Condo")
        self.assertIsNone(ut_ugrc.category(None))
        self.assertEqual(ut_ugrc.category("  commercial   - RETAIL "), "F1", "class text is compared case- and space-insensitively")

    def test_county_fips(self):
        self.assertEqual(ut_ugrc.county_fips("18"), "035", "Salt Lake")
        self.assertEqual(ut_ugrc.county_fips("25"), "049", "Utah")
        self.assertEqual(ut_ugrc.county_fips("1"), "001")
        self.assertEqual(ut_ugrc.county_fips("29"), "057", "Weber")
        for bad in ("0", "30", "", None, "x"):
            self.assertIsNone(ut_ugrc.county_fips(bad))

    def test_every_county_id(self):
        # COUNTY_ID and COUNTY_NAME as the 29 LIR layers carry them (group-by statistics, 2026-11-03), with the
        # Census county FIPS codes.
        layers = {
            1: ("Beaver", "001"), 2: ("Box Elder", "003"), 3: ("Cache", "005"), 4: ("Carbon", "007"),
            5: ("Daggett", "009"), 6: ("Davis", "011"), 7: ("Duchesne", "013"), 8: ("Emery", "015"),
            9: ("Garfield", "017"), 10: ("Grand", "019"), 11: ("Iron", "021"), 12: ("Juab", "023"),
            13: ("Kane", "025"), 14: ("Millard", "027"), 15: ("Morgan", "029"), 16: ("Piute", "031"),
            17: ("Rich", "033"), 18: ("Salt Lake", "035"), 19: ("San Juan", "037"), 20: ("Sanpete", "039"),
            21: ("Sevier", "041"), 22: ("Summit", "043"), 23: ("Tooele", "045"), 24: ("Uintah", "047"),
            25: ("Utah", "049"), 26: ("Wasatch", "051"), 27: ("Washington", "053"), 28: ("Wayne", "055"),
            29: ("Weber", "057"),
        }
        self.assertEqual({n: ut_ugrc.county_fips(str(n)) for n in layers}, {n: f for n, (_, f) in layers.items()})

    def test_other_counties_classes(self):
        # Class values seen in the other counties' layers (group-by statistics, 2026-11-03).
        self.assertEqual(ut_ugrc.category("Commercial", None, "057"), "F1", "Weber")
        self.assertEqual(ut_ugrc.category("Commercial - Office Space", None, "021"), "F1", "Iron")
        self.assertEqual(ut_ugrc.category("Commercial - Industrial", None, "047"), "F2", "Uintah")
        self.assertEqual(ut_ugrc.category("Commercial - Apartment & Condo", None, "011"), "B", "Davis")
        for exempt in ("Unknown", "UNKNOWN"):
            self.assertEqual(ut_ugrc.category("Commercial", exempt, "041"), "F1",
                             "eleven counties write Unknown (Millard UNKNOWN) as the exempt type of every commercial row")
        self.assertIsNone(ut_ugrc.category("Commercial", "State Government", "049"), "Utah County's exempt owners drop")
        for cls in ("NON-FAA", "FAA Mkt", "Vacant - Commercial", "Vacant - Agricultural", "Centrally Assessed",
                    "Mixed Use", "Personal Property", "Privilege Tax", "Greenbelt", "Tax Exempt - Other", "Unknown",
                    "Undeveloped", "Recreational", "New"):
            self.assertIsNone(ut_ugrc.category(cls, None, "003"), cls)

    def test_apn_keeps_punctuation_differences(self):
        apn = ut_ugrc.apn_for
        self.assertEqual(apn("08153760150001"), "08153760150001", "Salt Lake's digit ids are unchanged")
        self.assertNotEqual(apn("1-2-23"), apn("1-22-3"), "two Sevier parcels")
        self.assertNotEqual(apn("2-J11-6"), apn("2-J1-16"))
        self.assertNotEqual(apn("K-3-11-ANNEX"), apn("K-3-1-1-ANNEX"), "two Kane parcels")
        self.assertEqual(apn("1-2-23"), "1x2dx2x2dx23")
        self.assertEqual(apn("A-0001-0002-0003"), "ax2dx0001x2dx0002x2dx0003")
        self.assertNotEqual(apn("A-X1"), apn("ax1"), "a literal x is escaped")
        sevier = write_csv(self.tmp / "sevier.csv", SERVICE_HEADER, [
            {"OBJECTID": "1", "COUNTY_ID": "21", "PARCEL_ID": "1-2-23", "PROP_CLASS": "Commercial", "PARCEL_ADD": "1 N Main"},
            {"OBJECTID": "2", "COUNTY_ID": "21", "PARCEL_ID": "1-22-3", "PROP_CLASS": "Commercial", "PARCEL_ADD": "2 N Main"},
        ])
        db = self.tmp / "sevier.db"
        stats = ut_ugrc.build(sevier, db, as_of="2025-10-23")
        self.assertEqual(stats.kept, 2)
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.resolve_external("ugrc_lir", "041:1-2-23"), "fl:parcel:us-49041:1x2dx2x2dx23")
            self.assertEqual(reg.resolve_external("ugrc_lir", "041:1-22-3"), "fl:parcel:us-49041:1x2dx22x2dx3")
        finally:
            reg.close()

    def test_carbon_classes_are_not_mapped(self):
        self.assertIn("007", ut_ugrc.UNMAPPED_COUNTIES)
        for cls in ("Commercial", "Apartments", "Multi-Family", "Subsidized Housing", "Vacant Commercial"):
            self.assertIsNone(ut_ugrc.category(cls, None, "007"), cls)
        carbon = write_csv(self.tmp / "carbon.csv", SERVICE_HEADER, [
            {"OBJECTID": "1", "COUNTY_NAME": "Carbon County", "COUNTY_ID": "4", "PARCEL_ID": "01-0001-0000",
             "PARCEL_ADD": "1 E Main St", "PARCEL_CITY": "Price", "PROP_CLASS": "Commercial"},
            {"OBJECTID": "2", "COUNTY_NAME": "Weber County", "COUNTY_ID": "29", "PARCEL_ID": "010010001",
             "PARCEL_ADD": "1 Washington Blvd", "PARCEL_CITY": "Ogden", "PROP_CLASS": "Commercial",
             "TOTAL_MKT_VALUE": "750000"},
        ])
        recs = list(ut_ugrc.read_roll(carbon))
        self.assertEqual([(r.county_fips, r.state_category, r.local_use_code) for r in recs],
                         [("007", None, "Commercial"), ("057", "F1", "Commercial")],
                         "Carbon is read but kept out of scope; Weber's Commercial loads")
        self.assertEqual(recs[1].situs_address, "1 WASHINGTON BLVD, OGDEN UT")

    def test_command_line_never_retires_by_default(self):
        db = self.tmp / "cli.db"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ut_ugrc.main([str(self.hub), str(db), "--as-of", "2026-09-29"]), 0)
            self.assertEqual(ut_ugrc.main([str(self.service), str(db), "--as-of", "2026-09-30"]), 0)
            self.assertEqual(ut_ugrc.main([str(self.service), str(db), "--as-of", "2026-09-30", "--partial"]), 0)
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.status("fl:parcel:us-49035:08153760150005"), "current",
                             "a second county file run without flags does not retire the first county")
        finally:
            reg.close()

    def test_addresses_and_values(self):
        recs = {r.apn: r for r in ut_ugrc.read_roll(self.hub)}
        retail = recs["08153760150001"]
        self.assertEqual(retail.county_fips, "035")
        self.assertEqual(retail.account, "035:08153760150001", "county-qualified, so ids from two counties cannot collide")
        self.assertEqual(retail.situs_address, "2217 N EXAMPLE RD, SALT LAKE CITY UT")
        self.assertEqual(retail.market_value, 9061600)
        self.assertIsNone(retail.appraised_value, "the LIR carries market value only")
        self.assertEqual(retail.land_area_sf, round(4.09 * 43560))
        self.assertEqual((retail.improvement_area_sf, retail.year_built), (38645, 2008))
        self.assertEqual(retail.locator, "county 035 Parcel ID 08153760150001")
        self.assertEqual(recs["08153760150002"].situs_address, "100 W SAMPLE ST, UT", "no city column value")
        self.assertIsNone(recs["08153760150008"].situs_address)

    def test_zero_blank_and_owners(self):
        recs = {r.apn: r for r in ut_ugrc.read_roll(self.hub)}
        generic = recs["08153760150002"]
        self.assertIsNone(generic.improvement_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(generic.year_built, "year 0 is 'no figure'")
        for r in recs.values():
            self.assertIsNone(r.owner_name, "the LIR schema carries no owner")
            self.assertFalse(r.owner_confidential, "nothing is withheld: the publisher has no owner column")

    def test_feature_service_field_names(self):
        recs = {r.apn: r for r in ut_ugrc.read_roll(self.service)}
        self.assertEqual(recs["123450001"].county_fips, "049")
        self.assertEqual(recs["123450001"].state_category, "F1")
        self.assertEqual(recs["123450001"].situs_address, "1 N MAIN ST, PROVO UT")
        self.assertEqual((recs["123450001"].market_value, recs["123450001"].improvement_area_sf), (2500000, 12000))
        self.assertEqual(recs["123450001"].year_built, 1990)
        self.assertIsNone(recs["123450002"].market_value)

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ut_ugrc.build(self.hub, db, as_of="2026-09-29")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (9, 5, 4))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        more = ut_ugrc.build(self.service, db, as_of="2026-09-30")
        self.assertEqual((more.seen, more.kept, more.retired), (2, 1, 0), "a second county file does not retire the first")
        reg = Registry.open_readonly(db)
        try:
            urn = reg.resolve_external("ugrc_lir", "035:08153760150005")
            self.assertEqual(urn, "fl:parcel:us-49035:08153760150005")
            facts = {f["predicate"]: f["value"] for f in reg.facts(urn)}
            self.assertEqual(facts["parcel.state_property_category"], "B")
            self.assertEqual(facts["parcel.local_use_code"], "Commercial - Apartment & Condo")
            self.assertEqual(facts["parcel.market_value"], 11641200)
            self.assertNotIn("ownership.owner_of_record", facts)
            utah = reg.resolve_external("ugrc_lir", "049:123450001")
            self.assertEqual(utah, "fl:parcel:us-49049:123450001")
            self.assertEqual(reg.status(urn), "current")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
