"""Cuyahoga County adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, name, address and value here is invented to exercise the mapping; none is real
Cuyahoga County data. The fixture copies the shape of an ArcGIS ``f=json`` page of the Open Data Parcels service.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import oh_cuyahoga


def feature(**f):
    base = {"OBJECTID": 1, "parcelpin": "10000001", "parcel_id": "10000001", "parcel_type": "LAND", "parcel_year": 2026,
            "deeded_owner": None, "mail_name": None, "mail_addr_street": None, "mail_unit": None, "mail_city": None,
            "mail_state": None, "mail_zip": None, "mail_country": None, "par_addr_all": "100  EXAMPLE AVE, SAMPLEVILLE, OH, 44100",
            "par_city": "SAMPLEVILLE", "par_zip": 44100, "tax_luc": "4470", "tax_luc_description": "1-2 STORY OFFCE BLDG",
            "property_class": "C", "tax_year": 2025, "gross_certified_total": 0, "total_acreage": 0,
            "total_com_use_area": 0, "total_res_liv_area": 0, "com_living_units": 0}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "OBJECTID", "exceededTransferLimit": True, "features": [
    feature(OBJECTID=1, parcelpin="31514092", deeded_owner="EXAMPLE APARTMENTS LLC", mail_addr_street="1 SAMPLE RD",
            mail_unit="STE 4", mail_city="BEACHWOOD", mail_state="OH", mail_zip="44122", mail_country="US",
            par_addr_all="1510  NEWMAN AVE, LAKEWOOD, OH, 44107", tax_luc="4070", tax_luc_description="ELEVATOR APTS 40+ U",
            gross_certified_total=1984000, total_acreage=0.876, total_com_use_area=42600, com_living_units=48),
    feature(OBJECTID=2, parcelpin="31514093", deeded_owner="SMALL APARTMENTS LLC", tax_luc="4090",
            tax_luc_description="4- 6 UNIT APARTMENTS", gross_certified_total=300000),
    feature(OBJECTID=3, parcelpin="31514094", deeded_owner="CONVALESCENT CARE INC", tax_luc="4092"),
    feature(OBJECTID=4, parcelpin="31514095", deeded_owner="SAMPLE FOUNDRY CO", property_class="I", tax_luc="3200",
            gross_certified_total=750000, total_acreage=3, mail_country="CANADA", mail_city="TORONTO"),
    feature(OBJECTID=5, parcelpin="31514096", deeded_owner="EXAMPLE, ALEX", par_addr_all="",
            tax_luc="4000", tax_year=None),
    feature(OBJECTID=6, parcelpin="31514097", deeded_owner="", tax_luc="4200"),
    # Out of scope: residential, exempt commercial, agricultural, blank class.
    feature(OBJECTID=7, parcelpin="31514098", property_class="R", tax_luc="5100"),
    feature(OBJECTID=8, parcelpin="31514099", property_class="CE", tax_luc="4470"),
    feature(OBJECTID=9, parcelpin="31514100", property_class="A", tax_luc="1000"),
    feature(OBJECTID=10, parcelpin="31514101", property_class=None, tax_luc=None),
]}
PAGE_2 = {"objectIdFieldName": "OBJECTID", "features": [
    feature(OBJECTID=11, parcelpin="31514092", deeded_owner="OTHER LLC", gross_certified_total=1),  # repeat
    feature(OBJECTID=12, parcelpin="31514110", deeded_owner="LAST CO LLC", total_res_liv_area=900),
]}


class OhCuyahogaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for i, page in enumerate((PAGE_1, PAGE_2), start=1):
            d = self.tmp / "oh-cuyahoga-parcels" / f"{i:016x}"
            d.mkdir(parents=True)
            (d / "query").write_text(json.dumps(page), encoding="utf-8")

    def test_state_category(self):
        sc = oh_cuyahoga.state_category
        self.assertEqual([sc("C", c) for c in ("4010", "4040", "4070", "4080", "4090")], ["B"] * 5)
        self.assertEqual([sc("C", c) for c in ("4092", "4095", "4100", "4470", "4000")], ["F1"] * 5)
        self.assertEqual(sc("I", "3400"), "F2")
        self.assertEqual(sc("I", "4070"), "F2")
        self.assertEqual((sc("R"), sc("CE"), sc("A"), sc("M")), ("A", "G", "D1", "D2"))
        self.assertIsNone(sc(None))
        self.assertIsNone(sc("ZZ"))

    def test_records(self):
        recs = {r.apn: r for r in oh_cuyahoga.read_roll(self.tmp)}
        self.assertEqual(sorted(recs), ["31514092", "31514093", "31514094", "31514095", "31514096", "31514097",
                                        "31514110"])
        a = recs["31514092"]
        self.assertEqual((a.county_fips, a.state_category, a.local_use_code, a.tax_year), ("035", "B", "4070", 2025))
        self.assertEqual(a.situs_address, "1510 NEWMAN AVE, LAKEWOOD, OH, 44107", "runs of spaces collapse")
        self.assertEqual(a.owner_name, "EXAMPLE APARTMENTS LLC", "the first row for a parcel wins")
        self.assertEqual(a.owner_mailing_address, "1 SAMPLE RD STE 4, BEACHWOOD, OH 44122", "US is not printed")
        self.assertEqual((a.appraised_value, a.improvement_area_sf), (1984000.0, 42600))
        self.assertEqual(a.land_area_sf, round(0.876 * 43560, 2))
        self.assertEqual(recs["31514093"].state_category, "B", "4-6 unit apartments are the publisher's multifamily class")
        self.assertEqual(recs["31514094"].state_category, "F1")
        f = recs["31514095"]
        self.assertEqual((f.state_category, f.owner_mailing_address), ("F2", "TORONTO, CANADA"))
        p = recs["31514096"]
        self.assertEqual((p.owner_name, p.situs_address, p.tax_year), ("EXAMPLE, ALEX", None, None))
        self.assertIsNone(recs["31514097"].owner_name)
        self.assertIsNone(recs["31514097"].owner_mailing_address)
        self.assertEqual(recs["31514110"].improvement_area_sf, 900, "residential living area when there is no commercial area")

    def test_all_categories(self):
        self.assertEqual(len(list(oh_cuyahoga.read_roll(self.tmp, categories=None))), 11)
        self.assertEqual([r.apn for r in oh_cuyahoga.read_roll(self.tmp, categories=["F2"])], ["31514095"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = oh_cuyahoga.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (7, 7))
        self.assertEqual(stats.owners_person_or_withheld, 1)
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'cuyahoga_ppn' AND external_id = '31514092'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-39035:31514092")
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["CONVALESCENT CARE INC", "EXAMPLE APARTMENTS LLC", "LAST CO LLC",
                                      "SAMPLE FOUNDRY CO", "SMALL APARTMENTS LLC"])
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
