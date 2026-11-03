"""Marion County (Indianapolis) adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, name, address and value here is invented to exercise the mapping; none is real
Marion County data. The fixture copies the shape of an ArcGIS ``f=json`` page of the IndyGIS
"Parcels w/ Owner Information & Assessed Values" layer.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import in_marion


def feature(**f):
    base = {"OBJECTID": 1, "PARCEL_I": 1000001, "STATEPARCELNUMBER": "49-00-00-000-001.000-000", "STNUMBER": "100",
            "PRE_DIR": None, "STREET_NAME": "EXAMPLE", "SUFFIX": "ST", "SUF_DIR": None, "FULL_STNAME": "EXAMPLE ST",
            "CITY": "INDIANAPOLIS", "ZIPCODE": "46200", "FULLOWNERNAME": "", "OWNERADDRESS": "", "OWNERADDRESS2": "",
            "OWNERCITY": "", "OWNERSTATE": "", "OWNERZIP": "", "OWNERFOREIGNSTATE": "", "OWNERFOREIGNCOUNTRY": "",
            "PROPERTY_CLASS": "COMMERCIAL", "PROPERTY_SUB_CLASS": 447,
            "PROPERTY_SUB_CLASS_DESCRIPTION": "COM OFF BLDG 1 OR 2 STY-447", "ASSESSORYEAR_LANDTOTAL": 0.0,
            "ASSESSORYEAR_IMPTOTAL": 0.0, "ASSESSORYEAR_TOTALAV": 0.0, "ACREAGE": "0", "ESTSQFT": 0, "STATUS": None,
            "MODDATE": None, "TOWNSHIP": "CENTER"}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "OBJECTID", "exceededTransferLimit": True, "features": [
    # A 40-plus-unit apartment complex drawn as two polygons: one parcel, areas add up.
    feature(OBJECTID=1, STATEPARCELNUMBER="49-13-16-111-003.000-200", STNUMBER="7880", STREET_NAME="CANFORD",
            SUFFIX="ST", FULL_STNAME="CANFORD ST", FULLOWNERNAME="EXAMPLE APARTMENTS LLC, , , ",
            OWNERADDRESS="1 SAMPLE AVE STE 350", OWNERCITY="INDIANAPOLIS", OWNERSTATE="IN", OWNERZIP="462202034",
            PROPERTY_SUB_CLASS=403, PROPERTY_SUB_CLASS_DESCRIPTION="COM - APT 40 OR MORE UNITS-403",
            ASSESSORYEAR_LANDTOTAL=1100100.0, ASSESSORYEAR_IMPTOTAL=20173100.0, ASSESSORYEAR_TOTALAV=21273200.0,
            ACREAGE="0", ESTSQFT=400000),
    feature(OBJECTID=2, STATEPARCELNUMBER="49-13-16-111-003.000-200", STNUMBER="7900", STREET_NAME="CANFORD",
            SUFFIX="ST", FULLOWNERNAME="EXAMPLE APARTMENTS LLC, , , ", PROPERTY_SUB_CLASS=403,
            ASSESSORYEAR_TOTALAV=21273200.0, ACREAGE="0", ESTSQFT=172956),
    # An industrial warehouse with a deeded acreage; a directional prefix; foreign owner state.
    feature(OBJECTID=3, STATEPARCELNUMBER="49-03-28-133-002.000-800", STNUMBER="2002", PRE_DIR="W",
            STREET_NAME="76TH", SUFFIX="ST", FULLOWNERNAME="SAMPLE LOGISTICS, INC, , , ",
            OWNERADDRESS="11 E 44TH ST FL 1000", OWNERCITY="NEW YORK", OWNERSTATE="NY", OWNERZIP="10017-0058",
            PROPERTY_CLASS="INDUSTRIAL", PROPERTY_SUB_CLASS=350, ACREAGE="2.5", ESTSQFT=108000,
            ASSESSORYEAR_TOTALAV=500000.0),
    # Joint owners listed on two lines: the first line is the owner of record, the trailing & is dropped.
    feature(OBJECTID=4, STATEPARCELNUMBER="49-01-01-001-001.000-101", FULLOWNERNAME="ALPHA TIC 1 LLC &, ALPHA TIC 2 LLC, , ",
            PROPERTY_SUB_CLASS=425, ACREAGE="1", ASSESSORYEAR_TOTALAV=0.0),
    # Natural person: passed through; the registry drops the name. Blank street: no situs.
    feature(OBJECTID=5, STATEPARCELNUMBER="49-01-01-002-002.000-101", STREET_NAME="", FULL_STNAME="", STNUMBER="",
            FULLOWNERNAME="EXAMPLE, ALEX, , ", PROPERTY_SUB_CLASS=400),
    # Blank owner line.
    feature(OBJECTID=6, STATEPARCELNUMBER="49-01-01-003-003.000-101", FULLOWNERNAME=" , , , ",
            OWNERADDRESS="PO BOX 1", PROPERTY_SUB_CLASS=499),
    # Out of scope: single-family, exempt church, agricultural, a bad code.
    feature(OBJECTID=7, STATEPARCELNUMBER="49-01-01-004-004.000-101", PROPERTY_SUB_CLASS=510, PROPERTY_CLASS="RESIDENTIAL"),
    feature(OBJECTID=8, STATEPARCELNUMBER="49-01-01-005-005.000-101", PROPERTY_SUB_CLASS=686, PROPERTY_CLASS="EXEMPT"),
    feature(OBJECTID=9, STATEPARCELNUMBER="49-01-01-006-006.000-101", PROPERTY_SUB_CLASS=101),
    feature(OBJECTID=10, STATEPARCELNUMBER="49-01-01-007-007.000-101", PROPERTY_SUB_CLASS=None),
]}
PAGE_2 = {"objectIdFieldName": "OBJECTID", "features": [
    # The same parcel again on a later page: kept once.
    feature(OBJECTID=11, STATEPARCELNUMBER="49-03-28-133-002.000-800", PROPERTY_SUB_CLASS=350, ACREAGE="9"),
    feature(OBJECTID=12, STATEPARCELNUMBER="49-01-01-008-008.000-101", PROPERTY_SUB_CLASS=311,
            FULLOWNERNAME="SAMPLE FOODS CORP, , , ", ACREAGE="0", ESTSQFT=9000),
]}


class InMarionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for i, page in enumerate((PAGE_1, PAGE_2), start=1):
            d = self.tmp / "in-marion-parcels" / f"{i:016x}"
            d.mkdir(parents=True)
            (d / "query").write_text(json.dumps(page), encoding="utf-8")
        (self.tmp / "in-marion-parcels" / "manifest.jsonl").write_text("{}\n")

    def recs(self):
        return {r.apn: r for r in in_marion.read_roll(self.tmp)}

    def test_state_category(self):
        sc = in_marion.state_category
        self.assertEqual([sc(c) for c in (401, 402, 403)], ["B", "B", "B"], "apartments of 4+ units")
        self.assertEqual([sc(c) for c in (400, 409, 411, 419, 447, 499)], ["F1"] * 6)
        self.assertEqual([sc(c) for c in (300, 309, 350, 399)], ["F2"] * 4)
        self.assertEqual(sc("403 "), "B", "text values work")
        self.assertEqual(sc(510), "A")
        self.assertEqual(sc(101), "D1")
        self.assertEqual(sc(686), "G", "exempt")
        self.assertIsNone(sc(None))
        self.assertIsNone(sc(""))
        self.assertIsNone(sc(999))

    def test_owner_name(self):
        on = in_marion.owner_name
        self.assertEqual(on("HPI BRISTOL LLC, , , "), "HPI BRISTOL LLC")
        self.assertEqual(on("SAMPLE LOGISTICS, INC, , , "), "SAMPLE LOGISTICS, INC", "a suffix segment continues the name")
        self.assertEqual(on("ALPHA TIC 1 LLC &, ALPHA TIC 2 LLC, , "), "ALPHA TIC 1 LLC", "joint owners: first line, no &")
        self.assertEqual(on("EXAMPLE, ALEX, , "), "EXAMPLE", "a person: the registry drops it whatever the text")
        self.assertIsNone(on(" , , , "))
        self.assertIsNone(on(None))

    def test_records(self):
        recs = self.recs()
        self.assertEqual(sorted(recs), ["49-01-01-001-001.000-101", "49-01-01-002-002.000-101", "49-01-01-003-003.000-101",
                                        "49-01-01-008-008.000-101", "49-03-28-133-002.000-800",
                                        "49-13-16-111-003.000-200"])
        apts = recs["49-13-16-111-003.000-200"]
        self.assertEqual((apts.county_fips, apts.state_category, apts.local_use_code), ("097", "B", "403"))
        self.assertEqual(apts.situs_address, "7880 CANFORD ST, INDIANAPOLIS IN 46200")
        self.assertEqual(apts.owner_name, "EXAMPLE APARTMENTS LLC")
        self.assertEqual(apts.owner_mailing_address, "1 SAMPLE AVE STE 350, INDIANAPOLIS, IN 46220-2034")
        self.assertEqual(apts.appraised_value, 21273200.0)
        self.assertIsNone(apts.market_value, "assessed values are not market values")
        self.assertEqual(apts.land_area_sf, 572956, "the parcel's two polygons add up when ACREAGE is 0")
        self.assertEqual(apts.locator, "0000000000000001/query STATEPARCELNUMBER 49-13-16-111-003.000-200")
        warehouse = recs["49-03-28-133-002.000-800"]
        self.assertEqual((warehouse.state_category, warehouse.situs_address), ("F2", "2002 W 76TH ST, INDIANAPOLIS IN 46200"))
        self.assertEqual(warehouse.land_area_sf, round(2.5 * 43560, 2), "the first row wins; acreage beats polygon area")
        self.assertEqual(warehouse.owner_name, "SAMPLE LOGISTICS, INC")
        self.assertEqual(recs["49-01-01-001-001.000-101"].owner_name, "ALPHA TIC 1 LLC")
        person = recs["49-01-01-002-002.000-101"]
        self.assertIsNone(person.situs_address, "a blank street is no situs")
        self.assertEqual(person.owner_name, "EXAMPLE")
        blank = recs["49-01-01-003-003.000-101"]
        self.assertIsNone(blank.owner_name)
        self.assertIsNone(blank.owner_mailing_address, "no owner, no mailing address")
        self.assertIsNone(blank.appraised_value, "zero is not a figure")
        self.assertEqual(recs["49-01-01-008-008.000-101"].land_area_sf, 9000, "a lone polygon's area when no acreage")
        self.assertFalse(any(r.owner_confidential for r in recs.values()))

    def test_all_categories(self):
        self.assertEqual(len(list(in_marion.read_roll(self.tmp, categories=None))), 10)
        self.assertEqual([r.apn for r in in_marion.read_roll(self.tmp, categories=["B"])], ["49-13-16-111-003.000-200"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = in_marion.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (6, 6))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'marion_state_parcel' "
                "AND external_id = '49-13-16-111-003.000-200'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-18097:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["ALPHA TIC 1 LLC", "EXAMPLE APARTMENTS LLC", "SAMPLE FOODS CORP",
                                      "SAMPLE LOGISTICS, INC"], "organisations only")
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 2)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
