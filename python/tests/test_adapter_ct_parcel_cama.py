"""Connecticut CAMA and Parcel Layer adapter tests on a SYNTHETIC fixture that copies the real layout.

Every link, parcel id, name, address and value here is invented; none is real Connecticut data. The fixture copies the shape of
an ArcGIS ``f=json`` page of the OPM layer (town-specific ``State_Use`` codes and descriptions).
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ct_parcel_cama


def feature(**f):
    base = {"OBJECTID": 1, "Town_Name": "Andover", "Parcel_ID": "00/000/000001", "FIPS": "09013526102", "CAMA_Link": "99001-1",
            "Location_1": "1 EXAMPLE RD", "Property_City": "Andover", "Property_Zip": "06232", "Owner": None, "Co_Owner": None,
            "Mailing_Address": None, "Mailing_City": None, "Mailing_State": None, "Mailing_Zip": None, "Assessed_Total": 0,
            "Appraised_Land": 0, "Appraised_Building": 0, "Appraised_Outbuilding": 0, "Valuation_Year": 2021, "Land_Acres": 0,
            "State_Use": "200", "State_Use_Description": "Commercial", "AYB": 0}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "OBJECTID", "exceededTransferLimit": True, "features": [
    feature(OBJECTID=1, CAMA_Link="99001-1", Owner="EXAMPLE PLAZA LLC", Mailing_Address="1 SAMPLE ST", Mailing_City="HARTFORD",
            Mailing_State="CT", Mailing_Zip="061031234", Appraised_Land=200000, Appraised_Building=1500000, Appraised_Outbuilding=5000,
            Land_Acres=2.0, AYB=1988, State_Use="200", State_Use_Description="Commercial  MDL-94"),
    # Another town, another county, its own code and words.
    feature(OBJECTID=2, CAMA_Link="99002-7", Town_Name="West Hartford", FIPS="09003082000", Parcel_ID="A-7", Owner="SAMPLE MILL INC",
            Appraised_Building=900000, Appraised_Land=100000, State_Use="301", State_Use_Description="Industrial"),
    feature(OBJECTID=3, CAMA_Link="99003-3", Town_Name="Hartford", FIPS="09003376400", Owner="EXAMPLE APARTMENTS LP",
            Appraised_Building=4000000, State_Use="801.0", State_Use_Description="Apt over 8"),
    # The same record again; a person; a blank street.
    feature(OBJECTID=4, CAMA_Link="99001-1", State_Use_Description="Commercial"),
    feature(OBJECTID=5, CAMA_Link="99004-4", Owner="EXAMPLE, ALEX", Appraised_Building=300000, Location_1="",
            State_Use_Description="Office Bld M-01"),
    # Commercial words but no building value (land or blank); land, vacant, exempt, residential and ambiguous descriptions.
    feature(OBJECTID=6, CAMA_Link="99005-5", Appraised_Building=0, State_Use_Description="Commercial"),
    feature(OBJECTID=7, CAMA_Link="99006-6", Appraised_Building=100, State_Use_Description="Comm Land"),
    feature(OBJECTID=8, CAMA_Link="99007-7", Appraised_Building=100, State_Use_Description="Commercial Vacant"),
    feature(OBJECTID=9, CAMA_Link="99008-8", Appraised_Building=100, State_Use_Description="Exempt Comm"),
    feature(OBJECTID=10, CAMA_Link="99009-9", Appraised_Building=100, State_Use_Description="Single Family"),
    feature(OBJECTID=11, CAMA_Link="99010-0", Appraised_Building=100, State_Use_Description="Mixed Use"),
    feature(OBJECTID=12, CAMA_Link="99011-1", Appraised_Building=100, State_Use_Description="SFR w/Acc Apt"),
    feature(OBJECTID=13, CAMA_Link="99012-2", Appraised_Building=100, State_Use_Description="Planned Community"),
    feature(OBJECTID=14, CAMA_Link="99013-3", Appraised_Building=100, State_Use_Description="Apt 4-Unit"),
    feature(OBJECTID=15, CAMA_Link="", Appraised_Building=100, State_Use_Description="Commercial"),
    feature(OBJECTID=16, CAMA_Link="99014-4", FIPS="", Appraised_Building=100, State_Use_Description="Commercial"),
]}


class CtTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        d = self.tmp / "ct-parcel-cama-layer" / "0000000000000001"
        d.mkdir(parents=True)
        (d / "query").write_text(json.dumps(PAGE_1), encoding="utf-8")
        (self.tmp / "ct-parcel-cama-layer" / "manifest.jsonl").write_text("{}\n")

    def test_normalize_and_category(self):
        n = ct_parcel_cama.normalize_description
        self.assertEqual(n("Commercial  MDL-94"), "commercial")
        self.assertEqual(n("Store/Shop M-96"), "store/shop")
        self.assertEqual(n("Industrial -96"), "industrial")
        self.assertEqual(n("COMM CONDO 06"), "comm condo")
        self.assertEqual(n("Office C"), "office")
        self.assertEqual(n(None), "")
        sc = ct_parcel_cama.state_category
        self.assertEqual((sc("Commercial"), sc("COMMERCIAL  MDL-94"), sc("Store/Shop M94"), sc("Office Bld")), ("F1",) * 4)
        self.assertEqual((sc("Industrial"), sc("Warehouse"), sc("Manufacturing")), ("F2",) * 3)
        self.assertEqual((sc("Apartment"), sc("Apt Over 8"), sc("Comm Apts"), sc("Apts 5-8")), ("B",) * 4)
        for text in ("Single Family", "Residential", "Condo", "Comm Land", "Commercial Vacant", "Vac Comm Lnd", "Exempt Comm",
                     "Mixed Use", "SFR w/Acc Apt", "Planned Community", "Apt 4-Unit", "Industrial Vacant", "Industrial Land",
                     "Manufactured Home", "Multi Hses", "Municipal  MDL-00", "Nursing Home", "", None):
            self.assertIsNone(sc(text), text)

    def test_county_fips(self):
        self.assertEqual(ct_parcel_cama.county_fips("09013526102"), "013")
        self.assertEqual(ct_parcel_cama.county_fips("09003082000"), "003")
        for bad in ("", None, "13526102", "36013526102", "0901352610X"):
            self.assertIsNone(ct_parcel_cama.county_fips(bad), bad)

    def test_zip_codes_from_the_numeric_field(self):
        # The layer stores ZIP codes as numbers: floats, and values that lost their leading zero.
        cases = {
            "06232": "06232", "6103.0": "06103", "6702": "06702", "67021915": "06702-1915",
            "67021915.0": "06702-1915", "067021915": "06702-1915", "06702-1915": "06702-1915",
            6103.0: "06103", 6232: "06232", "": None, None: None, "abc": None, "123": None, "1234567": None,
        }
        for raw, want in cases.items():
            self.assertEqual(ct_parcel_cama.zip_code(raw), want, raw)

    def test_situs_zip_is_repaired_or_left_out(self):
        base = {"Location_1": "302 EXAMPLE MILL RD", "Property_City": "Waterbury"}
        situs = ct_parcel_cama._situs
        self.assertEqual(situs({**base, "Property_Zip": "67021915.0"}), "302 EXAMPLE MILL RD, Waterbury CT 06702-1915")
        self.assertEqual(situs({**base, "Property_Zip": 6702.0}), "302 EXAMPLE MILL RD, Waterbury CT 06702")
        # Not a Connecticut ZIP code: left out rather than shown wrong.
        self.assertEqual(situs({**base, "Property_Zip": "19406"}), "302 EXAMPLE MILL RD, Waterbury CT")
        self.assertEqual(situs({**base, "Property_Zip": None}), "302 EXAMPLE MILL RD, Waterbury CT")

    def test_records(self):
        recs = {r.apn: r for r in ct_parcel_cama.read_roll(self.tmp)}
        self.assertEqual(sorted(recs), ["99001-1", "99002-7", "99003-3", "99004-4"])
        plaza = recs["99001-1"]
        self.assertEqual((plaza.county_fips, plaza.state_category, plaza.account), ("013", "F1", "99001-1"))
        self.assertEqual(plaza.local_use_code, "200 Commercial MDL-94")
        self.assertEqual(plaza.situs_address, "1 EXAMPLE RD, Andover CT 06232")
        self.assertEqual(plaza.owner_mailing_address, "1 SAMPLE ST, HARTFORD, CT 06103-1234")
        self.assertEqual((plaza.market_value, plaza.tax_year, plaza.year_built), (1705000.0, 2021, 1988))
        self.assertEqual(plaza.land_area_sf, round(2.0 * 43560, 2))
        self.assertEqual((recs["99002-7"].county_fips, recs["99002-7"].state_category), ("003", "F2"))
        self.assertEqual(recs["99003-3"].state_category, "B")
        self.assertIsNone(recs["99004-4"].situs_address)
        self.assertEqual(recs["99004-4"].owner_name, "EXAMPLE, ALEX")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ct_parcel_cama.build(self.tmp, db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept), (4, 4))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'ct_cama_link' AND external_id = '99001-1'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-09013:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["EXAMPLE APARTMENTS LP", "EXAMPLE PLAZA LLC", "SAMPLE MILL INC"], "organisations only")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
