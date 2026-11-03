"""Denver assessor adapter tests on a SYNTHETIC fixture that copies the real export layout.

Every schedule number, name, and value here is invented to exercise the mapping; none is real
Denver data. The headers are the real column lists of the two CSV exports (2026-10-29).
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import co_denver

COMMERCIAL_HEADER = (
    "OBJECTID,PARID,CD,OFCARD,OWNER,CO_OWNER,OWNER_NUM,OWNER_DIR,OWNER_ST,OWNER_TYPE,OWNER_APT,OWNER_CITY,"
    "OWNER_STATE,OWNER_ZIP,SITE_NBR,SITE_DIR,SITE_NAME,SITE_MODE,SITE_MORE,TAX_DIST,PROP_CLASS_LAND,"
    "PROP_CLASS_IMPS,PROPERTY_CLASS_DESC,BLD_NAME,GROSS_AREA,NET_AREA,BSMT_AREA,FBSMT_SQFT,NO_FLOORS,TOTL_SQFT,"
    "ZONE10,D_CLASS_CN,ORIG_YOC,REMODEL,ASMT_APPR_LAND,ASMT_APPR_IMPR,TOTAL_VALUE,TOT_ASMT_RED,APPR_LAND_LOC,"
    "APPR_IMPR_LOC,APPR_TOT_LOC,ASMT_LAND_LOC,ASDIMPR_LOC,ASSESS_VALUE_LOC,ASMT_TAXABLE_LOC,ASMT_EXEMPT_AMT_LOC,"
    "TOT_UNITS,NBHD_CD,NBHD_1_CN,LEGL_DESCRIPTION,APPR_LAND_SCH,APPR_IMPR_SCH,APPR_TOT_SCH,ASDLAND_SCH,ASDIMPR_SCH,"
    "ASSESS_VALUE_SCH,ASMT_TAXABLE_SCH,ASMT_EXEMPT_AMT_SCH"
).split(",")

RESIDENTIAL_HEADER = (
    "OBJECTID,PARID,CD,OFCARD,OWNER,CO_OWNER,OWNER_NUM,OWNER_DIR,OWNER_ST,OWNER_TYPE,OWNER_APT,OWNER_CITY,"
    "OWNER_STATE,OWNER_ZIP,SITE_NBR,SITE_DIR,SITE_NAME,SITE_MODE,SITE_MORE,TAX_DIST,PROP_CLASS_LAND,"
    "PROP_CLASS_IMPS,PROP_CLASS,ZONE10,D_CLASS_CN,LAND_SQFT,AREA_ABG,BSMT_AREA,FBSMT_SQFT,GRD_AREA,STORY,STYLE_CN,"
    "BED_RMS,FULL_B,HLF_B,CCYRBLT,CCAGE_RM,UNITS,ASMT_APPR_LAND,ASMT_APPR_IMPR,TOTAL_VALUE,TOT_ASMT_RED,"
    "APPR_LAND_LOC,APPR_IMPR_LOC,APPR_TOT_LOC,ASDLAND,ASDIMPR,ASSESS_VALUE,ASMT_TAXABLE,ASMT_EXEMPT_AMT,NBHD_1,"
    "NBHD_1_CN,LEGL_DESCRIPTION,APPR_LAND_SCH,APPR_IMPR_SCH,APPR_TOT_SCH,ASDLAND_SCH,ASDIMPR_SCH,ASSESS_VALUE_SCH,"
    "ASMT_TAXABLE_SCH,ASMT_EXEMPT_AMT_SCH"
).split(",")

COMMERCIAL_ROWS = [
    # hotel: lodging improvements on lodging land, LLC owner with a suite in the mailing address
    dict(OBJECTID="1", PARID="0003100025000", CD="1", OFCARD="2", OWNER="EXAMPLE HOSPITALITY LLC", OWNER_NUM="100",
         OWNER_DIR="N", OWNER_ST="MAIN", OWNER_TYPE="ST", OWNER_APT="STE 200", OWNER_CITY="DENVER", OWNER_STATE="CO",
         OWNER_ZIP="80202", SITE_NBR="6805", SITE_DIR="N", SITE_NAME="ARGONNE", SITE_MODE="ST", TAX_DIST="DENV",
         PROP_CLASS_LAND="2115", PROP_CLASS_IMPS="2215", PROPERTY_CLASS_DESC="LODGING", BLD_NAME="EXAMPLE INN",
         GROSS_AREA="58930", NET_AREA="14772992", NO_FLOORS="4", TOTL_SQFT="152183", D_CLASS_CN="COMMERCIAL-HOTEL",
         ORIG_YOC="2009", ASMT_APPR_LAND="2891500", ASMT_APPR_IMPR="7668500", TOTAL_VALUE="10560000",
         APPR_TOT_LOC="10560000", ASSESS_VALUE_LOC="2640010"),
    # apartments: 9+ units, no gross area (apartment rows carry NET_AREA), value reduced for local levies
    dict(OBJECTID="2", PARID="0003105005000", CD="1", OFCARD="1", OWNER="EXAMPLE APARTMENTS OWNER LLC", OWNER_NUM="1",
         OWNER_ST="PARK", OWNER_TYPE="AVE", OWNER_CITY="NEW YORK", OWNER_STATE="NY", OWNER_ZIP="10001", SITE_NBR="6496",
         SITE_DIR="N", SITE_NAME="ARGONNE", SITE_MODE="ST", PROP_CLASS_LAND="1125", PROP_CLASS_IMPS="1225",
         PROPERTY_CLASS_DESC="MULTI-UNITS (9+)", NET_AREA="96417", NO_FLOORS="4", D_CLASS_CN="RESIDENTIAL-MULTI UNIT APTS",
         ORIG_YOC="2020", TOT_UNITS="91", TOTAL_VALUE="26572700", APPR_TOT_LOC="26502700"),
    # 4-8 unit building owned by a person: kept as B, owner not stored by the registry
    dict(OBJECTID="3", PARID="0512300017000", CD="1", OFCARD="1", OWNER="J EXAMPLE", CO_OWNER="M EXAMPLE",
         OWNER_NUM="5", OWNER_ST="OAK", OWNER_TYPE="LN", OWNER_CITY="DENVER", OWNER_STATE="CO", OWNER_ZIP="80203",
         SITE_NBR="5", SITE_NAME="OAK", SITE_MODE="LN", PROP_CLASS_LAND="1120", PROP_CLASS_IMPS="1220",
         PROPERTY_CLASS_DESC="MULTI-UNITS (4-8)", NET_AREA="4000", ORIG_YOC="1925", TOT_UNITS="4", TOTAL_VALUE="900000",
         APPR_TOT_LOC="900000"),
    # manufacturing: industrial, zero year and area are 'no figure'
    dict(OBJECTID="4", PARID="0223200236000", CD="1", OFCARD="1", OWNER="EXAMPLE FOODS INC", OWNER_NUM="4655",
         OWNER_ST="HUMBOLDT", OWNER_TYPE="ST", OWNER_CITY="DENVER", OWNER_STATE="CO", OWNER_ZIP="80216", SITE_NBR="4655",
         SITE_NAME="HUMBOLDT", SITE_MODE="ST", PROP_CLASS_LAND="3115", PROP_CLASS_IMPS="3215",
         PROPERTY_CLASS_DESC="MANUFACTURING", GROSS_AREA="0", ORIG_YOC="0", TOTAL_VALUE="3000000", APPR_TOT_LOC="3000000"),
    # commercial possessory interest: no land code, no situs number, 2020-series improvement code
    dict(OBJECTID="5", PARID="0121300143000", CD="1", OFCARD="0", OWNER="EXAMPLE TRANSIT SERVICES INC", OWNER_NUM="7500",
         OWNER_ST="41ST", OWNER_TYPE="AV", OWNER_CITY="DENVER", OWNER_STATE="CO", OWNER_ZIP="80216", SITE_NBR="0",
         SITE_NAME="41ST", SITE_MODE="AV", PROP_CLASS_IMPS="2020", D_CLASS_CN="OTHER COMMERCIAL P.I.", GROSS_AREA="0",
         TOTAL_VALUE="139900", APPR_TOT_LOC="139900"),
    # vacant commercial land: out of scope
    dict(OBJECTID="6", PARID="0227916043000", CD="1", OFCARD="0", OWNER="EXAMPLE LAND HOLDINGS LLC", OWNER_NUM="1",
         OWNER_ST="LOT", OWNER_TYPE="ST", OWNER_CITY="DENVER", OWNER_STATE="CO", OWNER_ZIP="80202", SITE_NBR="2001",
         SITE_NAME="BLAKE", SITE_MODE="ST", PROP_CLASS_LAND="200", PROPERTY_CLASS_DESC="COMMERCIAL VACANT LAND",
         D_CLASS_CN="VACANT LAND", TOTAL_VALUE="500000", APPR_TOT_LOC="500000"),
    # county-exempt commercial: out of scope
    dict(OBJECTID="7", PARID="0231425041000", CD="1", OFCARD="1", OWNER="CITY AND COUNTY OF DENVER", SITE_NBR="201",
         SITE_DIR="W", SITE_NAME="COLFAX", SITE_MODE="AVE", PROP_CLASS_LAND="9139", PROP_CLASS_IMPS="9239",
         PROPERTY_CLASS_DESC="COUNTY EXEMPT COMMERCIAL", GROSS_AREA="400000", ORIG_YOC="1932", TOTAL_VALUE="90000000"),
    # merchandising land with no improvement code: the land class stands in; owner withheld
    dict(OBJECTID="8", PARID="0218300004000", CD="1", OFCARD="1", OWNER="CONFIDENTIAL", OWNER_CITY="DENVER",
         OWNER_STATE="CO", SITE_NBR="4600", SITE_NAME="50TH", SITE_MODE="AVE", SITE_MORE="UNIT B",
         PROP_CLASS_LAND="2112", PROPERTY_CLASS_DESC="MERCHANDISING", TOTAL_VALUE="208600", APPR_TOT_LOC="208600"),
    # warehouse with the 'unknown' owner placeholder and a blank situs name
    dict(OBJECTID="9", PARID="0003126001000", CD="1", OFCARD="6", OWNER="UNKNOWN", PROP_CLASS_LAND="2135",
         PROP_CLASS_IMPS="2235", PROPERTY_CLASS_DESC="WAREHOUSE", GROSS_AREA="1233453", ORIG_YOC="2022",
         TOTAL_VALUE="96761900", APPR_TOT_LOC="96761900"),
]

RESIDENTIAL_ROWS = [
    dict(OBJECTID="1", PARID="0613400010000", CD="1", OFCARD="1", OWNER="A EXAMPLE", OWNER_NUM="10", OWNER_ST="ELM",
         OWNER_TYPE="ST", OWNER_CITY="DENVER", OWNER_STATE="CO", OWNER_ZIP="80205", SITE_NBR="10", SITE_NAME="ELM",
         SITE_MODE="ST", PROP_CLASS_LAND="1112", PROP_CLASS_IMPS="1212", PROP_CLASS="SINGLE FAMILY RESIDENCE",
         LAND_SQFT="6250", AREA_ABG="1800", CCYRBLT="1952", UNITS="1", TOTAL_VALUE="650000", APPR_TOT_LOC="595000"),
    dict(OBJECTID="2", PARID="0613400011000", CD="1", OFCARD="1", OWNER="EXAMPLE FOURPLEX LLC", OWNER_NUM="12",
         OWNER_ST="ELM", OWNER_TYPE="ST", OWNER_CITY="DENVER", OWNER_STATE="CO", OWNER_ZIP="80205", SITE_NBR="12",
         SITE_NAME="ELM", SITE_MODE="ST", PROP_CLASS_LAND="1120", PROP_CLASS_IMPS="1220", PROP_CLASS="MULTI-UNITS (4-8)",
         LAND_SQFT="6250", AREA_ABG="3600", CCYRBLT="1910", UNITS="4", TOTAL_VALUE="1200000", APPR_TOT_LOC="1200000"),
]


def write_csv(path: Path, header: list[str], rows: list[dict[str, str]]) -> Path:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([r.get(h, "") for h in header])
    path.write_text("﻿" + buf.getvalue(), encoding="utf-8")  # the export starts with a BOM
    return path


class Denver(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.commercial = write_csv(self.tmp / "commercial.csv", COMMERCIAL_HEADER, COMMERCIAL_ROWS)
        self.residential = write_csv(self.tmp / "residential.csv", RESIDENTIAL_HEADER, RESIDENTIAL_ROWS)

    def test_category_mapping(self):
        recs = {r.apn: r for r in co_denver.read_roll(self.commercial)}
        self.assertEqual(len(recs), 9, "every row is yielded; the registry applies the scope")
        self.assertEqual(recs["0003100025000"].state_category, "F1")
        self.assertEqual(recs["0003105005000"].state_category, "B")
        self.assertEqual(recs["0512300017000"].state_category, "B", "the publisher's 4-8 unit class is multifamily")
        self.assertEqual(recs["0223200236000"].state_category, "F2")
        self.assertEqual(recs["0121300143000"].state_category, "F1", "a commercial possessory interest")
        self.assertIsNone(recs["0227916043000"].state_category, "vacant land is out of scope")
        self.assertIsNone(recs["0231425041000"].state_category, "exempt classes are out of scope")
        self.assertEqual(recs["0218300004000"].state_category, "F1", "the land class stands in when there is no improvement class")
        self.assertEqual(recs["0003126001000"].state_category, "F1", "warehouses are a commercial class in Colorado")
        self.assertEqual(recs["0003100025000"].local_use_code, "2215/2115")
        self.assertEqual(recs["0121300143000"].local_use_code, "2020/")
        self.assertEqual(recs["0218300004000"].local_use_code, "/2112")

    def test_addresses_and_values(self):
        recs = {r.apn: r for r in co_denver.read_roll(self.commercial)}
        hotel = recs["0003100025000"]
        self.assertEqual(hotel.county_fips, "031")
        self.assertEqual(hotel.account, "0003100025000")
        self.assertEqual(hotel.situs_address, "6805 N ARGONNE ST, DENVER CO")
        self.assertEqual(hotel.owner_name, "EXAMPLE HOSPITALITY LLC")
        self.assertEqual(hotel.owner_mailing_address, "100 N MAIN ST STE 200, DENVER, CO 80202")
        self.assertEqual((hotel.improvement_area_sf, hotel.year_built), (58930, 2009), "gross area wins over net area")
        self.assertEqual((hotel.market_value, hotel.appraised_value), (10560000, 10560000))
        self.assertIsNone(hotel.land_area_sf, "the commercial export has no land area column")
        self.assertIsNone(hotel.tax_year)
        self.assertEqual(hotel.locator, "PARID 0003100025000")
        apartments = recs["0003105005000"]
        self.assertEqual(apartments.improvement_area_sf, 96417, "net area when there is no gross area")
        self.assertEqual((apartments.market_value, apartments.appraised_value), (26572700, 26502700),
                         "actual value and the value after the statutory reduction")
        self.assertEqual(apartments.owner_mailing_address, "1 PARK AVE, NEW YORK, NY 10001")
        pi = recs["0121300143000"]
        self.assertEqual(pi.situs_address, "41ST AV, DENVER CO", "a 0 site number is 'none'")
        unit = recs["0218300004000"]
        self.assertEqual(unit.situs_address, "4600 50TH AVE UNIT B, DENVER CO")

    def test_zero_blank_and_owner_handling(self):
        recs = {r.apn: r for r in co_denver.read_roll(self.commercial)}
        plant = recs["0223200236000"]
        self.assertIsNone(plant.improvement_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(plant.year_built, "year 0 is 'no figure'")
        person = recs["0512300017000"]
        self.assertEqual(person.owner_name, "J EXAMPLE", "the adapter passes persons through; the registry drops them")
        self.assertFalse(person.owner_confidential)
        withheld = recs["0218300004000"]
        self.assertTrue(withheld.owner_confidential)
        self.assertIsNone(withheld.owner_name)
        self.assertIsNone(withheld.owner_mailing_address)
        placeholder = recs["0003126001000"]
        self.assertIsNone(placeholder.owner_name, "'UNKNOWN' is a placeholder, not an owner")
        self.assertFalse(placeholder.owner_confidential)
        self.assertIsNone(placeholder.situs_address, "no street name, no situs")
        self.assertIsNone(placeholder.owner_mailing_address)

    def test_residential_export(self):
        recs = {r.apn: r for r in co_denver.read_roll(self.residential)}
        house, fourplex = recs["0613400010000"], recs["0613400011000"]
        self.assertIsNone(house.state_category)
        self.assertEqual(house.local_use_code, "1212/1112")
        self.assertEqual(fourplex.state_category, "B")
        self.assertEqual((fourplex.land_area_sf, fourplex.improvement_area_sf, fourplex.year_built), (6250, 3600, 1910))
        self.assertEqual(fourplex.situs_address, "12 ELM ST, DENVER CO")

    def test_code_helpers(self):
        self.assertEqual(co_denver.category("2212.0", None), "F1", "some ArcGIS exports write integers as 2212.0")
        self.assertEqual(co_denver._code("2212.0"), "2212")
        self.assertIsNone(co_denver.category(None, None))
        self.assertIsNone(co_denver.local_use_code(None, None))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = co_denver.build(self.commercial, db, as_of="2026-10-29", full_roll=True)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (9, 7, 2))
        self.assertEqual(stats.owners_person_or_withheld, 2, "one person, one withheld owner")
        more = co_denver.build(self.residential, db, as_of="2026-10-29")
        self.assertEqual((more.seen, more.kept, more.retired), (2, 1, 0), "the residential export does not retire the commercial parcels")
        reg = Registry.open_readonly(db)
        try:
            urn = reg.resolve_external("denver_schednum", "0003100025000")
            self.assertEqual(urn, "fl:parcel:us-08031:0003100025000")
            facts = {f["predicate"]: f["value"] for f in reg.facts(urn)}
            self.assertEqual(facts["parcel.state_property_category"], "F1")
            self.assertEqual(facts["parcel.local_use_code"], "2215/2115")
            self.assertEqual(facts["ownership.owner_of_record"], "EXAMPLE HOSPITALITY LLC")
            self.assertEqual(facts["parcel.market_value"], 10560000)
            fourplex = reg.resolve_external("denver_schednum", "0613400011000")
            self.assertEqual(fourplex, "fl:parcel:us-08031:0613400011000")
            person = reg.resolve_external("denver_schednum", "0512300017000")
            self.assertNotIn("ownership.owner_of_record", {f["predicate"] for f in reg.facts(person)},
                             "a natural person's name is never stored")
            self.assertEqual(reg.status(urn), "current")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
