"""Arkansas GIS Office statewide cadastre adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel id, name, address and value here is invented; none is real Arkansas data. The fixture copies the shape of
an ArcGIS ``f=json`` page of the PARCEL_CENTROID_CAMP layer (lower-case field names).
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ar_gis


def feature(**f):
    base = {"objectid": 1, "countyfips": "119", "countyid": "119-999-00001-000", "parcelid": "999-00001-000", "ownername": None,
            "adrnum": 0, "predir": None, "pstrnam": None, "pstrtype": None, "psufdir": None, "adrcity": None, "adrzip5": 0,
            "adrlabel": None, "parceltype": "CI", "assessvalue": 0.0, "impvalue": 0.0, "landvalue": 0.0, "totalvalue": 0.0,
            "subdivision": None, "taxcode": None, "camakey": 1.0, "county": "Pulaski", "dataprov": "SYNTHETIC",
            "camadate": 1787806800000, "pubdate": 1790830800000}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "objectid", "exceededTransferLimit": True, "features": [
    feature(objectid=1, countyid="119-999-00001-000", parcelid="999-00001-000", ownername="EXAMPLE RETAIL HOLDINGS, LLC",
            adrlabel="1203  SAMPLE AVE W", adrcity="LITTLE ROCK", adrzip5=72201, parceltype="CI", assessvalue=100000.0,
            impvalue=400000.0, landvalue=100000.0, totalvalue=500000.0),
    # The same county parcel id again (a second card): kept once.
    feature(objectid=2, countyid="119-999-00001-000", parcelid="999-00001-000", parceltype="CI"),
    feature(objectid=3, countyfips="007", countyid="007-5", parcelid="5", ownername="SAMPLE FABRICATION INC", parceltype="II",
            adrlabel="55  MILL RD", adrcity="BENTONVILLE", adrzip5=0, totalvalue=2500000.0),
    # A person owner and a blank label; the same parcel id in another county is a different parcel.
    feature(objectid=4, countyfips="023", countyid="023-5", parcelid="5", ownername="EXAMPLE, ALEX & PAT", parceltype="CI"),
    # Out of scope or undefined codes: residential, vacant commercial, commercial miscellaneous, a code the 2004 standard lacks.
    feature(objectid=5, parcelid="a", countyid="119-a", parceltype="RI"),
    feature(objectid=6, parcelid="b", countyid="119-b", parceltype="CV"),
    feature(objectid=7, parcelid="c", countyid="119-c", parceltype="CM"),
    feature(objectid=8, parcelid="d", countyid="119-d", parceltype="CR"),
    feature(objectid=9, parcelid="", countyid="119-", parceltype="CI"),
    feature(objectid=10, parcelid="e", countyid="119-e", parceltype=None),
]}


class ArGisTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        d = self.tmp / "ar-gis-parcels" / "0000000000000001"
        d.mkdir(parents=True)
        (d / "query").write_text(json.dumps(PAGE_1), encoding="utf-8")
        (self.tmp / "ar-gis-parcels" / "manifest.jsonl").write_text("{}\n")

    def recs(self):
        return {(r.county_fips, r.apn): r for r in ar_gis.read_roll(self.tmp)}

    def test_state_category(self):
        sc = ar_gis.state_category
        self.assertEqual((sc("CI"), sc("II"), sc(" ci ")), ("F1", "F2", "F1"))
        for code in ("CV", "CM", "IV", "IM", "RI", "RV", "AI", "EX", "PS", "MN", "MH", "CR", "CA", "", None):
            self.assertIsNone(sc(code), code)

    def test_records(self):
        recs = self.recs()
        self.assertEqual(sorted(recs), [("007", "5"), ("023", "5"), ("119", "999-00001-000")])
        shop = recs[("119", "999-00001-000")]
        self.assertEqual((shop.state_category, shop.local_use_code, shop.account), ("F1", "CI", "119-999-00001-000"))
        self.assertEqual(shop.situs_address, "1203 SAMPLE AVE W, LITTLE ROCK AR 72201")
        self.assertEqual((shop.market_value, shop.appraised_value), (500000.0, None))
        self.assertIsNone(shop.owner_mailing_address, "the layer has no owner mailing address")
        plant = recs[("007", "5")]
        self.assertEqual((plant.state_category, plant.situs_address), ("F2", "55 MILL RD, BENTONVILLE AR"))
        self.assertEqual(recs[("023", "5")].owner_name, "EXAMPLE, ALEX & PAT", "persons pass through; the registry drops them")
        self.assertIsNone(recs[("023", "5")].situs_address)
        self.assertIsNone(recs[("023", "5")].market_value, "zero is not a figure")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ar_gis.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (3, 3))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'ar_countyid' AND external_id = '119-999-00001-000'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-05119:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["EXAMPLE RETAIL HOLDINGS, LLC", "SAMPLE FABRICATION INC"], "organisations only")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
