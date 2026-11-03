"""Minnesota opt-in open-data parcels adapter tests on a SYNTHETIC fixture that copies the real layout.

Every PIN, name, address and value here is invented; none is real Minnesota data. The fixture copies the shape of an
ArcGIS ``f=json`` page of the MnGeo ``plan_parcels_open`` layer.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import mn_opt_in


def feature(**f):
    base = {"objectid": 1, "county_pin": "000000000001", "state_pin": "27123-000000000001", "anumberpre": None,
            "anumber": 100, "anumbersuf": None, "st_pre_mod": None, "st_pre_dir": None, "st_pre_typ": None,
            "st_pre_sep": None, "st_name": "Example", "st_pos_typ": "Street", "st_pos_dir": None, "st_pos_mod": None,
            "ctu_name": "Sampleville", "zip": "55100", "zip4": None, "co_code": "27123", "co_name": "Ramsey",
            "state_code": "MN", "owner_name": None, "owner_more": None, "own_add_l1": None, "own_add_l2": None,
            "own_add_l3": None, "own_add_l4": None, "tax_name": None, "acres_poly": 0.0, "acres_deed": 0.0, "emv_land": 0,
            "emv_bldg": 0, "emv_total": 0, "tax_year": 2026, "mkt_year": 2025, "useclass1": "3a Commercial Land And Building",
            "tax_exempt": "N", "fin_sq_ft": 0, "year_built": 0, "num_units": 0, "edit_date": 1775606400000}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "objectid", "exceededTransferLimit": True, "features": [
    feature(objectid=1, county_pin="293023220043", state_pin="27123-293023220043", anumber=1203, st_name="10th",
            st_pos_typ="Street", st_pos_dir="Northwest", owner_name="Garden View Apartments Llc",
            own_add_l1="478 Hazel St N Apt 101", own_add_l3="Saint Paul, MN 55119-3465", acres_poly=0.8, acres_deed=0.81,
            emv_total=3589100, year_built=1970, num_units=36, useclass1="4a Apartment 4 Or More Units"),
    # The same county PIN again (a second polygon): kept once.
    feature(objectid=2, county_pin="293023220043", state_pin="27123-293023220043", useclass1="4a Apartment 4 Or More Units"),
    feature(objectid=3, county_pin="111", state_pin="27037-111", co_code="27037", co_name="Dakota", owner_name="Sample Industries Inc",
            useclass1="Industrial-Preferred", anumberpre="W", anumber=0, st_name="Mill", st_pos_typ="Road", acres_poly=2.5),
    # Dakota's "Apartment-Mobile Home Park" and Ramsey's community land trust: not mapped.
    feature(objectid=4, county_pin="112", state_pin="27037-112", co_code="27037", useclass1="Apartment-Mobile Home Park"),
    feature(objectid=5, county_pin="113", state_pin="27123-113", useclass1="4d2 Homestead Community Land Trust"),
    # A person owner, a blank street; a county outside COUNTIES; Hennepin; a blank PIN.
    feature(objectid=6, county_pin="114", state_pin="27123-114", owner_name="Example Alex", st_name=None,
            useclass1="3a Commercial Land And Building"),
    feature(objectid=7, county_pin="115", state_pin="27163-115", co_code="27163", useclass1="Commercial"),
    feature(objectid=8, county_pin="116", state_pin="27053-116", co_code="27053", useclass1="Commercial"),
    feature(objectid=9, county_pin="", state_pin="27123-", useclass1="3a Commercial Land And Building"),
    feature(objectid=10, county_pin="117", state_pin="27123-117", useclass1=None),
]}


class MnOptInTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        d = self.tmp / "mn-opt-in-parcels" / "0000000000000001"
        d.mkdir(parents=True)
        (d / "query").write_text(json.dumps(PAGE_1), encoding="utf-8")
        (self.tmp / "mn-opt-in-parcels" / "manifest.jsonl").write_text("{}\n")

    def recs(self):
        return {r.apn: r for r in mn_opt_in.read_roll(self.tmp)}

    def test_state_category(self):
        sc = mn_opt_in.state_category
        self.assertEqual(sc("27123", "3a Commercial Land And Building"), "F1")
        self.assertEqual(sc("27003", "3a COMMERCIAL PREFERENTIAL"), "F1")
        self.assertEqual(sc("27003", "3a INDUSTIAL PREFERENTIAL"), "F2", "Anoka's own spelling")
        self.assertEqual(sc("27137", "Industrial Non-Preferred"), "F2")
        self.assertEqual(sc("27037", "Apartment"), "B")
        self.assertEqual(sc("27137", "Apartment (4 Or More Units)"), "B")
        self.assertEqual(sc("27123", "4a Apartment 4 Or More Units"), "B")
        for label in ("Apartment-Mobile Home Park", "Apartment-Nursing Home", "4d2 Homestead Community Land Trust",
                      "Commercial Seasonal Res Rec (Resort)", "Telephone Preferred (Commercial)", "Vacant Land - Commercial",
                      "Residential Single Unit", "", None):
            self.assertIsNone(sc("27123", label), label)
        self.assertIsNone(sc("27163", "Commercial"), "a county whose labels were not read")
        self.assertIsNone(sc("27053", "Commercial"), "Hennepin has its own source")

    def test_records(self):
        recs = self.recs()
        self.assertEqual(sorted(recs), ["111", "114", "293023220043"])
        apts = recs["293023220043"]
        self.assertEqual((apts.county_fips, apts.state_category, apts.local_use_code), ("123", "B", "4a Apartment 4 Or More Units"))
        self.assertEqual(apts.account, "27123-293023220043")
        self.assertEqual(apts.situs_address, "1203 10th Street Northwest, Sampleville MN 55100")
        self.assertEqual(apts.owner_mailing_address, "478 Hazel St N Apt 101, Saint Paul, MN 55119-3465")
        self.assertEqual((apts.market_value, apts.tax_year, apts.year_built), (3589100.0, 2025, 1970))
        self.assertEqual(apts.land_area_sf, round(0.81 * 43560, 2), "deeded acres beat polygon acres")
        self.assertIsNone(apts.appraised_value)
        factory = recs["111"]
        self.assertEqual((factory.county_fips, factory.state_category), ("037", "F2"))
        self.assertEqual(factory.situs_address, "W Mill Road, Sampleville MN 55100", "a zero house number is no number")
        self.assertEqual(factory.land_area_sf, round(2.5 * 43560, 2))
        self.assertIsNone(factory.year_built)
        person = recs["114"]
        self.assertIsNone(person.situs_address, "no street name, no situs")
        self.assertEqual(person.owner_name, "Example Alex")
        self.assertIsNone(person.market_value, "zero is not a figure")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = mn_opt_in.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (3, 3))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'mn_state_pin' AND external_id = '27123-293023220043'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-27123:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["Garden View Apartments Llc", "Sample Industries Inc"], "organisations only")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
