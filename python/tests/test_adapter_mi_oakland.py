"""Oakland County adapter tests on a SYNTHETIC fixture that copies the real layout.

Every PIN, name, address and value here is invented to exercise the mapping; none is real Oakland
County data. The fixture copies the shape of an ArcGIS ``f=json`` page of "OC Tax Parcels (Public)".
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import mi_oakland


def feature(**f):
    base = {"OBJECTID_12": 1, "KEYPIN": "2500000001", "REVISIONDATE": None, "CVTTAXCODE": "28",
            "CVTTAXDESCRIPTION": "CITY OF EXAMPLEVILLE", "PIN": "2500000001", "CLASSCODE": "201", "NAME1": None,
            "NAME2": None, "SITEADDRESS": "100 E EXAMPLE RD", "SITECITY": "EXAMPLEVILLE", "SITESTATE": "MI",
            "SITEZIP5": "48000", "POSTALADDRESS": "1 SAMPLE TRL", "ASSESSEDVALUE": 0, "TAXABLEVALUE": 0,
            "NUM_BEDS": 0, "NUM_BATHS": 0, "STRUCTURE_DESC": "", "LIVING_AREA_SQFT": 0}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "OBJECTID_12", "exceededTransferLimit": True, "features": [
    feature(OBJECTID_12=1, PIN="2500000001", KEYPIN="2500000001", CLASSCODE="201", ASSESSEDVALUE=1024850,
            TAXABLEVALUE=868050, LIVING_AREA_SQFT=0),
    # Vacant industrial with an owner name (the open layer has none today; a later release might).
    feature(OBJECTID_12=2, PIN="2500000002", KEYPIN="2500000002", CLASSCODE="302", NAME1="SAMPLE FOUNDRY LLC",
            NAME2="C/O AGENT", ASSESSEDVALUE=262280, SITEADDRESS=""),
    feature(OBJECTID_12=3, PIN="2500000003", KEYPIN="2500000003", CLASSCODE="207", ASSESSEDVALUE=5000,
            LIVING_AREA_SQFT=1200, NAME1="UNKNOWN"),
    feature(OBJECTID_12=4, PIN="2500000004", KEYPIN="2500000004", CLASSCODE="310", NAME1="EXAMPLE, ALEX"),
    # Out of scope: residential, agricultural, county exempt codes, personal property, blank.
    feature(OBJECTID_12=5, PIN="2500000005", CLASSCODE="401"),
    feature(OBJECTID_12=6, PIN="2500000006", CLASSCODE="102"),
    feature(OBJECTID_12=7, PIN="2500000007", CLASSCODE="002"),
    feature(OBJECTID_12=8, PIN="2500000008", CLASSCODE="251"),
    feature(OBJECTID_12=9, PIN="2500000009", CLASSCODE=None),
]}
PAGE_2 = {"objectIdFieldName": "OBJECTID_12", "features": [
    feature(OBJECTID_12=10, PIN="2500000001", CLASSCODE="201", ASSESSEDVALUE=1),  # repeat: first wins
    feature(OBJECTID_12=11, PIN="2500000011", CLASSCODE="203", ASSESSEDVALUE=777, SITEADDRESS="9 N MAIN ST",
            SITECITY="OTHERTOWN", SITEZIP5=""),
]}


class MiOaklandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for i, page in enumerate((PAGE_1, PAGE_2), start=1):
            d = self.tmp / "mi-oakland-parcels" / f"{i:016x}"
            d.mkdir(parents=True)
            (d / "query").write_text(json.dumps(page), encoding="utf-8")

    def test_state_category(self):
        sc = mi_oakland.state_category
        self.assertEqual([sc(c) for c in ("201", "202", "207", "210")], ["F1"] * 4)
        self.assertEqual([sc(c) for c in ("301", "302", "310")], ["F2"] * 3)
        self.assertEqual(sc("401"), "A")
        self.assertEqual(sc("101"), "D1")
        self.assertEqual(sc(201), "F1", "numbers work")
        self.assertIsNone(sc("251"), "personal property")
        self.assertIsNone(sc("002"), "the county's own special code")
        self.assertIsNone(sc(None))
        self.assertIsNone(sc("20"))

    def test_records(self):
        recs = {r.apn: r for r in mi_oakland.read_roll(self.tmp)}
        self.assertEqual(sorted(recs), ["2500000001", "2500000002", "2500000003", "2500000004", "2500000011"])
        a = recs["2500000001"]
        self.assertEqual((a.county_fips, a.state_category, a.local_use_code), ("125", "F1", "201"))
        self.assertEqual(a.situs_address, "100 E EXAMPLE RD, EXAMPLEVILLE MI 48000")
        self.assertEqual(a.appraised_value, 1024850, "the first row for a repeated PIN wins")
        self.assertIsNone(a.market_value)
        self.assertIsNone(a.owner_name, "the open layer carries no owner names")
        self.assertIsNone(a.owner_mailing_address, "no owner, no mailing address")
        self.assertIsNone(a.improvement_area_sf, "zero is not an area")
        self.assertEqual(a.locator, "0000000000000001/query PIN 2500000001")
        b = recs["2500000002"]
        self.assertEqual((b.state_category, b.owner_name, b.owner_mailing_address), ("F2", "SAMPLE FOUNDRY LLC", "1 SAMPLE TRL"))
        self.assertIsNone(b.situs_address, "no street, no situs")
        c = recs["2500000003"]
        self.assertEqual((c.improvement_area_sf, c.owner_name), (1200, None), "UNKNOWN is a placeholder")
        self.assertEqual(recs["2500000004"].owner_name, "EXAMPLE, ALEX", "persons pass through; the registry drops them")
        self.assertEqual(recs["2500000011"].situs_address, "9 N MAIN ST, OTHERTOWN MI")

    def test_all_categories(self):
        self.assertEqual(len(list(mi_oakland.read_roll(self.tmp, categories=None))), 9 + 1)
        self.assertEqual([r.apn for r in mi_oakland.read_roll(self.tmp, categories=["F2"])], ["2500000002", "2500000004"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = mi_oakland.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (5, 5))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the person is counted, not stored")
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'oakland_pin' AND external_id = '2500000001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-26125:2500000001")
            owners = [json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'")]
            self.assertEqual(owners, ["SAMPLE FOUNDRY LLC"])
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
