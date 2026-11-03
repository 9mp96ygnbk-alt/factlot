"""Davidson County (Nashville, TN) adapter tests on a SYNTHETIC fixture that copies the real layout of the
Metro Open Data Portal "Parcels" Hub CSV export (43 columns headed by the portal's field aliases,
2026-11-03). Every parcel number, name, and value here is invented."""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tn_davidson

HEADER = (
    "Object ID,Assessor Parcel Number,Feature Type,Floor Number,Parcel ID,Census Tract,Council District,Tax District,"
    "Owner Name,Sale Date,Sale Price,Owner Instrument,Owner Address 1,Owner Address 2,Owner Address 3,Owner City,"
    "Owner State,Owner Country,Owner Zip Code,Parcel Address,Parcel House Number,House Number Extension,"
    "Parcel Street Name,Parcel Suite/Unit Number,Parcel City,Parcel State,Parcel Zip Code,Legal Description,"
    "Parcel Instrument,Parcel Date,Acres,Frontage (ft),Side (ft),Is Regular Shape?,Land Use Code,Land Use Description,"
    "Land Appraised Value,Improvement Appraised Value,Total Appraised Value,Zoning,Shape Area,Latitude,Longitude"
)
COLUMNS = HEADER.split(",")


def row(**kw: str) -> str:
    """One CSV line; keyword names are the header with spaces and punctuation replaced by underscores."""
    values = {c: "" for c in COLUMNS}
    for k, v in kw.items():
        values[k.replace("__", " ").replace("_", " ").replace("Suite Unit Number", "Suite/Unit Number")] = v
    out = []
    for c in COLUMNS:
        v = values[c]
        out.append(f'"{v}"' if "," in v or '"' in v else v)
    return ",".join(out)


def r(apn, lu, desc, owner, **kw):
    base = dict(Object_ID="1", Assessor_Parcel_Number=apn, Feature_Type="Lot", Owner_Name=owner, Land_Use_Code=lu,
                Land_Use_Description=desc, Parcel_City="NASHVILLE", Parcel_State="TN", Parcel_Zip_Code="37203",
                Owner_Address_1="1 EXAMPLE PLZ", Owner_City="NASHVILLE", Owner_State="TN", Owner_Zip_Code="37201",
                Owner_Country="US        ")
    base.update(kw)
    return row(**base)


ROWS = [
    # office building (3+ stories): 033 → F1
    r("09301000100", "033", "OFFICE BLDG (3 OR MORE STORIES)", "EXAMPLE TOWER LLC", Parcel_Address="100 EXAMPLE AVE",
      Acres="0.75", Land_Appraised_Value="2000000", Improvement_Appraised_Value="18000000", Total_Appraised_Value="20000000"),
    # apartments: 038 → B; mailing address outside the US
    r("09301000200", "038", "APARTMENT: LOW RISE (BUILT SINCE 1960)", "EXAMPLE RESIDENTIAL PARTNERS LP",
      Parcel_Address="200 EXAMPLE AVE", Acres="3.2", Total_Appraised_Value="9000000", Owner_Address_1="5 SAMPLE ROAD",
      Owner_City="TORONTO", Owner_State="ON", Owner_Zip_Code="M5V 1A1", Owner_Country="CA"),
    # light manufacturing → F2
    r("09301000300", "071", "LIGHT MANUFACTURING", "EXAMPLE WORKS INC", Parcel_Address="300 FACTORY ST", Acres="5",
      Total_Appraised_Value="3000000"),
    # commercial condominium unit (two floors, same parcel number): first row wins; unit address, zero acres
    r("093140A11200CO", "036", "CONDOMINIUM OFC OR OTHER COM CONDO", "EXAMPLE HOLDINGS, LP", Feature_Type="Multistory Cond",
      Floor_Number="1", Parcel_Address="635 7TH AVE S #101", Parcel_Suite_Unit_Number="101", Acres="0",
      Total_Appraised_Value="861900"),
    r("093140A11200CO", "036", "CONDOMINIUM OFC OR OTHER COM CONDO", "EXAMPLE HOLDINGS, LP", Feature_Type="Multistory Cond",
      Floor_Number="2", Parcel_Address="635 7TH AVE S #101", Total_Appraised_Value="861900"),
    # natural-person owner of a small shop: kept as a record, name dropped by the registry
    r("09301000400", "025", "ONE STORY GENERAL RETAIL STORE", "DOE, JANE Q", Parcel_Address="400 SHOP ST", Acres="0.2",
      Total_Appraised_Value="450000"),
    # blank owner, no address, zero appraisal (not a figure)
    r("09301000500", "064", "SMALL WAREHOUSE", "", Acres="0", Total_Appraised_Value="0"),
    # out of scope: vacant commercial land, single family, duplex, church, greenhouse, park, vacant industrial
    r("09301000600", "020", "VACANT COMMERCIAL LAND", "EXAMPLE LAND LLC", Total_Appraised_Value="100000"),
    r("09301000700", "011", "SINGLE FAMILY", "ROE, RICHARD", Total_Appraised_Value="300000"),
    r("09301000800", "012", "DUPLEX", "EXAMPLE DUPLEX LLC", Total_Appraised_Value="400000"),
    r("09301000900", "091", "CHURCH", "EXAMPLE CHURCH INC", Total_Appraised_Value="2000000"),
    r("09301001000", "066", "GREENHOUSE/NURSERY", "EXAMPLE NURSERY LLC", Total_Appraised_Value="50000"),
    r("09301001100", "001", "PARK OR RECREATION", "METRO GOVERNMENT", Total_Appraised_Value="0"),
    r("09301001200", "070", "VACANT INDUSTRIAL LAND", "EXAMPLE LAND LLC", Total_Appraised_Value="100000"),
]


def fixture(tmp: Path) -> Path:
    p = tmp / "csv"
    p.write_text("﻿" + "\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    return p


class Davidson(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = fixture(self.tmp)

    def test_mapping(self):
        recs = {x.apn: x for x in tn_davidson.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["09301000100", "09301000200", "09301000300", "09301000400", "09301000500",
                                        "093140A11200CO"],
                         "F1, B, F2, F1 (condo), F1, F1 kept; vacant, residential, exempt, greenhouse, park dropped; "
                         "the second condo floor collapsed")
        tower = recs["09301000100"]
        self.assertEqual((tower.county_fips, tower.state_category, tower.local_use_code), ("037", "F1", "033"))
        self.assertEqual(tower.situs_address, "100 EXAMPLE AVE, NASHVILLE TN 37203")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "1 EXAMPLE PLZ, NASHVILLE, TN 37201")
        self.assertEqual(tower.land_area_sf, round(0.75 * 43560, 2))
        self.assertEqual((tower.appraised_value, tower.market_value), (20000000, None))
        self.assertEqual(tower.account, "09301000100")
        self.assertEqual(tower.locator, "Parcels STANPAR 09301000100")
        self.assertFalse(tower.owner_confidential)
        apartments = recs["09301000200"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.owner_mailing_address, "5 SAMPLE ROAD, TORONTO, ON M5V 1A1, CA",
                         "a non-US country is part of the mailing address")
        self.assertEqual(recs["09301000300"].state_category, "F2")
        condo = recs["093140A11200CO"]
        self.assertEqual((condo.state_category, condo.local_use_code), ("F1", "036"))
        self.assertEqual(condo.situs_address, "635 7TH AVE S #101, NASHVILLE TN 37203")
        self.assertIsNone(condo.land_area_sf, "a zero acreage is not a figure")
        self.assertEqual(recs["09301000400"].owner_name, "DOE, JANE Q",
                         "the adapter passes persons through; the registry drops them")

    def test_blank_and_zero_values_are_not_facts(self):
        warehouse = {x.apn: x for x in tn_davidson.read_roll(self.csv)}["09301000500"]
        self.assertEqual(warehouse.state_category, "F1")
        self.assertIsNone(warehouse.owner_name)
        self.assertIsNone(warehouse.owner_mailing_address)
        self.assertIsNone(warehouse.situs_address)
        self.assertEqual((warehouse.appraised_value, warehouse.land_area_sf), (None, None))

    def test_state_category(self):
        sc = tn_davidson.state_category
        for code in ("037", "038", "039"):
            self.assertEqual(sc(code), "B", code)
        for code in ("021", "022", "023", "024", "025", "026", "027", "028", "029", "031", "032", "033", "034", "035",
                     "036", "041", "042", "043", "044", "045", "046", "047", "048", "049", "051", "052", "053", "054",
                     "055", "056", "057", "058", "059", "061", "062", "063", "064", "065", "067", "069"):
            self.assertEqual(sc(code), "F1", code)
        for code in ("071", "072", "073", "074", "075", "076", "077", "078"):
            self.assertEqual(sc(code), "F2", code)
        for code in ("001", "008", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "020", "030",
                     "066", "070", "080", "081", "085", "090", "091", "093", "094", "099", "80M", "", None):
            self.assertIsNone(sc(code), code)

    def test_service_field_names_are_accepted(self):
        header = "OBJECTID,STANPAR,Owner,OwnAddr1,OwnCity,OwnState,OwnZip,PropAddr,PropCity,PropState,PropZip,Acres,LUCode,TotlAppr"
        line = "1,09301000100,EXAMPLE TOWER LLC,1 EXAMPLE PLZ,NASHVILLE,TN,37201,100 EXAMPLE AVE,NASHVILLE,TN,37203,1,032,5000000"
        p = self.tmp / "fields.csv"
        p.write_text(header + "\n" + line + "\n", encoding="utf-8")
        [rec] = list(tn_davidson.read_roll(p))
        self.assertEqual((rec.apn, rec.state_category, rec.owner_name, rec.appraised_value), ("09301000100", "F1",
                                                                                          "EXAMPLE TOWER LLC", 5000000))
        self.assertEqual(rec.situs_address, "100 EXAMPLE AVE, NASHVILLE TN 37203")

    def test_all_parcels_option(self):
        every = list(tn_davidson.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 13, "fourteen rows minus the second condominium floor")
        self.assertEqual(sum(1 for x in every if x.state_category is None), 7)

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = tn_davidson.build(self.csv, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the shop's natural-person owner")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tn-davidson-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("47", "037"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'davidson_stanpar' AND external_id = '09301000100'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-47037:09301000100")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER LLC", owner[0])
            person = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE subject = 'fl:parcel:us-47037:09301000400' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(person, 0, "natural persons are not stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
