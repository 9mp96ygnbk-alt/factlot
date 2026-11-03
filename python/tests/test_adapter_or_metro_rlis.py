"""Metro RLIS Taxlots (Public) adapter tests on a SYNTHETIC fixture that copies the real layout.

Every account number, address and value here is invented to exercise the mapping; none is real
Multnomah, Washington or Clackamas County data. The header is the real header of the Hub CSV export
(2026-11-03).
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import or_metro_rlis

HEADER = (
    "TLID,PRIMACCNUM,ALTACCNUM,SITEADDR,SITECITY,SITEZIP,BLDGSQFT,A_T_ACRES,YEARBUILT,PROP_CODE,LANDUSE,TAXCODE,"
    "SALEDATE,SALEPRICE,COUNTY,X_COORD,Y_COORD,JURIS_CITY,GIS_ACRES,STATECLASS,ORTAXLOT,LANDVAL,BLDGVAL,TOTALVAL,"
    "ASSESSVAL,FID,AREA,HAS_MANY,Shape__Area,Shape__Length"
).split(",")

ROWS = [
    # Multnomah: commercial, improved
    dict(TLID="1N2E21CC  -05700", PRIMACCNUM="R260993", SITEADDR="3520 NE 82ND AVE", SITECITY="PORTLAND",
         SITEZIP="97220", BLDGSQFT="768", A_T_ACRES="0.11", YEARBUILT="1960", PROP_CODE="201", LANDUSE="COM",
         COUNTY="M", LANDVAL="197160", BLDGVAL="173870", TOTALVAL="371030", ASSESSVAL="153840", STATECLASS="201"),
    # Multnomah: multiple-family, improved
    dict(TLID="1N1E36BC  -01000", PRIMACCNUM="R313834", SITEADDR="2858 NE SANDY BLVD", SITECITY="PORTLAND",
         BLDGSQFT="52000", A_T_ACRES="0.9", YEARBUILT="2000", PROP_CODE="701", LANDUSE="MFR", COUNTY="M",
         LANDVAL="706440", BLDGVAL="9132800", TOTALVAL="9839240", ASSESSVAL="4414980"),
    # Multnomah: industrial, improved; zeros are 'no figure'
    dict(TLID="1N1E01  -00100", PRIMACCNUM="R100001", SITEADDR="10 N PLANT ST", SITECITY="PORTLAND", BLDGSQFT="0",
         A_T_ACRES="3", YEARBUILT="0", PROP_CODE="301", LANDUSE="IND", COUNTY="M", TOTALVAL="2000000", ASSESSVAL="0"),
    # Washington County: commercial condominium and DOR-appraised industrial
    dict(TLID="1S1W01  -00200", PRIMACCNUM="R200002", SITEADDR="5 SW OFFICE CT", SITECITY="BEAVERTON",
         PROP_CODE="232", COUNTY="W", TOTALVAL="400000"),
    dict(TLID="1S1W01  -00300", PRIMACCNUM="R200003", SITEADDR="6 SW MILL RD", SITECITY="TUALATIN",
         PROP_CODE="303", COUNTY="W", TOTALVAL="8000000"),
    # Clackamas: commercial improved
    dict(TLID="2S1E01  -00400", PRIMACCNUM="00400001", SITEADDR="7 SE MAIN ST", SITECITY="MILWAUKIE",
         PROP_CODE="221", COUNTY="C", TOTALVAL="750000"),
    # out of scope: vacant commercial, vacant multiple-family, manufactured park, residential, farm, exempt
    dict(TLID="a", PRIMACCNUM="R1", PROP_CODE="200", COUNTY="M"),
    dict(TLID="b", PRIMACCNUM="R2", PROP_CODE="700", COUNTY="M"),
    dict(TLID="c", PRIMACCNUM="R3", PROP_CODE="707", COUNTY="M"),
    dict(TLID="d", PRIMACCNUM="R4", PROP_CODE="101", COUNTY="M", LANDUSE="SFR"),
    dict(TLID="e", PRIMACCNUM="R5", PROP_CODE="551", COUNTY="M"),
    dict(TLID="f", PRIMACCNUM="R6", PROP_CODE="941", COUNTY="M"),
    # right of way: no account number, dropped; unknown county code, dropped; blank class
    dict(TLID="1N1E23CC  -TR-A", PRIMACCNUM=" ", PROP_CODE=" ", COUNTY="M"),
    dict(TLID="g", PRIMACCNUM="R7", PROP_CODE="201", COUNTY="X"),
    dict(TLID="h", PRIMACCNUM="R8", PROP_CODE=" ", COUNTY="M"),
]


def write_csv(path: Path) -> Path:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(HEADER)
    for r in ROWS:
        w.writerow([r.get(h, "") for h in HEADER])
    path.write_text("﻿" + buf.getvalue(), encoding="utf-8")  # the Hub export starts with a BOM
    return path


class MetroRlis(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp / "taxlots.csv")

    def test_category_mapping(self):
        recs = {r.apn: r for r in or_metro_rlis.read_roll(self.csv)}
        self.assertEqual(len(recs), 13, "right-of-way features and unknown counties are dropped")
        self.assertEqual(recs["R260993"].state_category, "F1")
        self.assertEqual(recs["R313834"].state_category, "B")
        self.assertEqual(recs["R100001"].state_category, "F2")
        self.assertEqual(recs["R200002"].state_category, "F1", "x32 is a commercial condominium")
        self.assertEqual(recs["R200003"].state_category, "F2", "303 is Department of Revenue appraised industrial")
        self.assertEqual(recs["00400001"].state_category, "F1")
        for apn in ("R1", "R2", "R3", "R4", "R5", "R6", "R8"):
            self.assertIsNone(recs[apn].state_category, apn)
        self.assertEqual(recs["R260993"].local_use_code, "201")
        for code, expected in (("2.0", None), ("", None), (None, None), ("20", None), ("291", "F1"), ("781", "B"), ("382", "F2")):
            self.assertEqual(or_metro_rlis.category(code), expected, code)

    def test_counties(self):
        recs = {r.apn: r for r in or_metro_rlis.read_roll(self.csv)}
        self.assertEqual(recs["R260993"].county_fips, "051", "Multnomah")
        self.assertEqual(recs["R200002"].county_fips, "067", "Washington")
        self.assertEqual(recs["00400001"].county_fips, "005", "Clackamas")
        self.assertEqual(recs["R260993"].account, "051:R260993")

    def test_addresses_and_values(self):
        recs = {r.apn: r for r in or_metro_rlis.read_roll(self.csv)}
        shop = recs["R260993"]
        self.assertEqual(shop.situs_address, "3520 NE 82ND AVE, PORTLAND OR")
        self.assertEqual((shop.market_value, shop.appraised_value), (371030, 153840))
        self.assertEqual(shop.land_area_sf, round(0.11 * 43560))
        self.assertEqual((shop.improvement_area_sf, shop.year_built), (768, 1960))
        self.assertEqual(shop.locator, "PRIMACCNUM R260993 TLID 1N2E21CC  -05700")
        self.assertIsNone(recs["R1"].situs_address)

    def test_zero_blank_and_owners(self):
        plant = {r.apn: r for r in or_metro_rlis.read_roll(self.csv)}["R100001"]
        self.assertIsNone(plant.improvement_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(plant.year_built)
        self.assertIsNone(plant.appraised_value, "an assessed value of 0 is 'no figure'")
        for r in or_metro_rlis.read_roll(self.csv):
            self.assertIsNone(r.owner_name, "RLIS Taxlots (Public) excludes ownership information")
            self.assertFalse(r.owner_confidential)

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = or_metro_rlis.build(self.csv, db, as_of="2026-07-17")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (13, 6, 7))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.resolve_external("or_metro_account", "051:R313834")
            self.assertEqual(urn, "fl:parcel:us-41051:r313834")
            facts = {f["predicate"]: f["value"] for f in reg.facts(urn)}
            self.assertEqual(facts["parcel.state_property_category"], "B")
            self.assertEqual(facts["parcel.local_use_code"], "701")
            self.assertEqual(facts["parcel.market_value"], 9839240)
            self.assertEqual(facts["parcel.appraised_value"], 4414980)
            self.assertNotIn("ownership.owner_of_record", facts)
            self.assertEqual(reg.status(urn), "current")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
