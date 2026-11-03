"""Vermont (VCGI statewide parcels with the Grand List) adapter tests on a SYNTHETIC fixture.

Every SPAN, name, address and value here is invented to exercise the mapping; none is real Vermont
data. The fixture copies the shape of an ArcGIS ``f=json`` page of the VCGI layer.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import vt_vcgi


def feature(**f):
    base = {"OBJECTID": 1, "SPAN": "999-001-00001", "GLIST_SPAN": "999-001-00001", "PARCID": "A-1", "PROPTYPE": "PARCEL",
            "YEAR": 2026, "GLYEAR": 2025, "TOWN": "BARTON", "TNAME": "Barton", "OWNER1": None, "OWNER2": None,
            "ADDRGL1": None, "ADDRGL2": None, "CITYGL": None, "STGL": None, "ZIPGL": None, "DESCPROP": "LAND AND BUILDINGS",
            "LOCAPROP": None, "CAT": "C", "ACRESGL": 0.0, "REAL_FLV": 0, "LAND_LV": 0, "IMPRV_LV": 0, "E911ADDR": None}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "OBJECTID", "exceededTransferLimit": True, "features": [
    feature(OBJECTID=1, SPAN="999-001-10001", TOWN="BURLINGTON", OWNER1="EXAMPLE APARTMENTS LLC", CAT="CA",
            ADDRGL1="1 SAMPLE ST", ADDRGL2="SUITE 2", CITYGL="BURLINGTON", STGL="VT", ZIPGL="054011234",
            E911ADDR="10 EXAMPLE ST", ACRESGL=0.5, REAL_FLV=900000, GLYEAR=2025),
    # The same SPAN again, a stacked polygon: kept once.
    feature(OBJECTID=2, SPAN="999-001-10001", TOWN="BURLINGTON", OWNER1="EXAMPLE APARTMENTS LLC", CAT="CA", ACRESGL=9),
    feature(OBJECTID=3, SPAN="999-002-10002", TOWN="BARTON", OWNER1="SAMPLE INDUSTRIES INC", CAT="I",
            LOCAPROP="55 MILL RD", ACRESGL=2.0, REAL_FLV=450000),
    # A natural person (the registry drops the name) and a blank owner; a commercial parcel with no street.
    feature(OBJECTID=4, SPAN="999-003-10003", TOWN="STOWE", OWNER1="EXAMPLE ALEX", CAT="C", E911ADDR="3 TEST LN"),
    feature(OBJECTID=5, SPAN="999-003-10004", TOWN="STOWE", OWNER1=None, CAT="C", ADDRGL1="PO BOX 1"),
    # Out of scope: residential, miscellaneous, other, utility, a blank category; a right-of-way polygon; an unknown town.
    feature(OBJECTID=6, SPAN="999-004-10005", CAT="R1"),
    feature(OBJECTID=7, SPAN="999-004-10006", CAT="M"),
    feature(OBJECTID=8, SPAN="999-004-10007", CAT="O"),
    feature(OBJECTID=9, SPAN="999-004-10008", CAT="UE"),
    feature(OBJECTID=10, SPAN="999-004-10009", CAT=None),
    feature(OBJECTID=11, SPAN="999-005-10010", CAT="C", PROPTYPE="ROW_RAIL"),
    feature(OBJECTID=12, SPAN="999-006-10011", CAT="C", TOWN="NOWHERE"),
]}


class VtVcgiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        d = self.tmp / "vt-vcgi-parcels" / "0000000000000001"
        d.mkdir(parents=True)
        (d / "query").write_text(json.dumps(PAGE_1), encoding="utf-8")
        (self.tmp / "vt-vcgi-parcels" / "manifest.jsonl").write_text("{}\n")

    def recs(self):
        return {r.apn: r for r in vt_vcgi.read_roll(self.tmp)}

    def test_state_category(self):
        sc = vt_vcgi.state_category
        self.assertEqual((sc("C"), sc("CA"), sc("I")), ("F1", "B", "F2"))
        self.assertEqual(sc(" ca "), "B")
        for code in ("R1", "R2", "MHU", "MHL", "S1", "S2", "F", "W", "UE", "UO", "M", "O", "", None):
            self.assertIsNone(sc(code), code)

    def test_every_town_has_a_county(self):
        self.assertEqual(len(vt_vcgi.TOWN_COUNTY), 256)
        self.assertEqual(set(vt_vcgi.TOWN_COUNTY.values()),
                         {f"{n:03d}" for n in range(1, 28, 2)}, "Vermont's 14 counties are FIPS 001 to 027, odd")
        self.assertEqual(vt_vcgi.county_for("burlington"), "007")
        self.assertEqual(vt_vcgi.county_for("Barton"), "019")
        self.assertIsNone(vt_vcgi.county_for("NOWHERE"))

    def test_records(self):
        recs = self.recs()
        self.assertEqual(sorted(recs), ["999-001-10001", "999-002-10002", "999-003-10003", "999-003-10004"])
        apts = recs["999-001-10001"]
        self.assertEqual((apts.county_fips, apts.state_category, apts.local_use_code), ("007", "B", "CA"))
        self.assertEqual(apts.situs_address, "10 EXAMPLE ST, Burlington, VT")
        self.assertEqual(apts.owner_mailing_address, "1 SAMPLE ST, SUITE 2, BURLINGTON, VT 05401-1234")
        self.assertEqual((apts.appraised_value, apts.tax_year, apts.land_area_sf), (900000.0, 2025, round(0.5 * 43560, 2)))
        self.assertIsNone(apts.market_value)
        self.assertEqual(apts.locator, "0000000000000001/query SPAN 999-001-10001")
        factory = recs["999-002-10002"]
        self.assertEqual((factory.county_fips, factory.state_category), ("019", "F2"))
        self.assertEqual(factory.situs_address, "55 MILL RD, Barton, VT", "no 911 address: the Grand List location")
        self.assertIsNone(recs["999-003-10003"].improvement_area_sf)
        blank = recs["999-003-10004"]
        self.assertIsNone(blank.owner_name)
        self.assertIsNone(blank.owner_mailing_address, "no owner, no mailing address")
        self.assertIsNone(blank.situs_address)
        self.assertIsNone(blank.appraised_value, "zero is not a figure")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = vt_vcgi.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (4, 4))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'vt_span' AND external_id = '999-001-10001'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-50007:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["EXAMPLE APARTMENTS LLC", "SAMPLE INDUSTRIES INC"], "organisations only")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
