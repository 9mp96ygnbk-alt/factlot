"""Wayne County, Michigan adapter tests on a SYNTHETIC fixture that copies the publisher's real layout.

Every parcel number, name, and value here is invented to exercise the mapping; none is real
Wayne County data. The header is the 130-column header of the 2026 BS&A export.
"""

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import mi_wayne

WAYNE_HEADER = (
    "Parcels.pnum,ParcelMaster.totalacres,Parcels.land_acres_0,Parcels.land_acres_1,ParcelMaster.frontage,"
    "Parcels.land_front_0,Parcels.land_front_1,Parcels.land_front_2,Parcels.land_depth_0,Parcels.land_depth_1,"
    "Parcels.land_depth_2,ParcelMaster.vacant,Parcels.oldprop,Parcels.propclass,Parcels.propstatus,"
    "ParcelMaster.extraZoning_0,ParcelMaster.extraZoning_1,ParcelMaster.extraZoning_2,ParcelMaster.extraZoning_3,"
    "ParcelMaster.zoning,Parcels.useCode,Parcels.exemptcode,ParcelMaster.dateoflastsplit,Parcels.schooldist,"
    "ParcelMaster.lastSalePrice,ParcelMaster.lastSaleDate,ParcelReadonly.AdjPRE_0_3,Parcels.hometaxyear,"
    "ParcelMaster.agb_numagb,ParcelMaster.agb_value,ParcelMaster.cib_numcib,ParcelMaster.cib_floorarea,"
    "ParcelMaster.cib_occ_String,ParcelMaster.cib_yearbuilt,ParcelMaster.esttcv,ParcelMaster.resb_numresb,"
    "ParcelMaster.resb_floorarea,ParcelMaster.resb_groundarea,ParcelMaster.resb_occ_String,"
    "ParcelMaster.resb_yearbuilt,ParcelMaster.resb_value,ParcelMaster.bldgimprval,ParcelMaster.landvalue,"
    "ParcelMaster.landivalue,ParcelReadonly.mborsev_1,ParcelReadonly.adjsev_0_3,ParcelReadonly.ass_1,"
    "ParcelReadonly.mborass_1,ParcelReadonly.adjass_0_3,ParcelReadonly.bldass_1,ParcelReadonly.landass_1,"
    "ParcelReadonly.tax_1,ParcelReadonly.adjtax_0_3,ParcelReadonly.mbortax_1,ParcelReadonly.tax_2,"
    "ParcelReadonly.adjtax_1_3,ParcelReadonly.mbortax_2,ParcelReadonly.tax_3,ParcelReadonly.adjtax_2_3,"
    "ParcelReadonly.mbortax_3,ParcelReadonly.adjsev_1_3,ParcelReadonly.mborsev_2,ParcelReadonly.adjsev_2_3,"
    "ParcelReadonly.mborsev_3,Parcels.secondaryunit,ParcelMaster.ownercareof,ParcelMaster.ownername1,"
    "ParcelMaster.ownername2,ParcelMaster.ownercity,ParcelMaster.ownerstate,ParcelMaster.ownerstreetaddr,"
    "ParcelMaster.ownerzip,ParcelMaster.unitorapt,ParcelMaster.propcity,ParcelMaster.propstreetcombined,"
    "ParcelMaster.propaddrnum,ParcelMaster.propstate,ParcelMaster.propstreetname,ParcelMaster.propzip,"
    "ParcelMaster.sub,Parcels.publ_9,Parcels.publ_0,Parcels.publ_7,Parcels.publ_8,Parcels.publ_1,Parcels.publ_2,"
    "Parcels.publ_6,Parcels.publ_5,Parcels.publ_4,Parcels.publ_11,Parcels.publ_3,Parcels.publ_10,Parcels.publ_12,"
    "ParcelMaster.agb_calcvalue,ParcelMaster.cib_bldgclass_String,ParcelMaster.cib_pricefloor,"
    "ParcelMaster.cib_calcvalue,ParcelMaster.resb_bldgclass_String,ParcelMaster.resb_plusminus,"
    "ParcelMaster.resb_style,ParcelMaster.resb_pricefloor,ParcelMaster.resb_calcvalue,ParcelMaster.resb_priceground,"
    "ParcelMaster.propaddrdirect,ParcelMaster.resb_garagearea,ParcelMaster.r_or_p,Parcels.isExempt,"
    "ParcelReadonly.adjass_1_3,ParcelReadonly.adjass_2_3,ParcelReadonly.bldass_2,ParcelReadonly.landass_2,"
    "ParcelReadonly.ass_3,ParcelReadonly.bldass_3,ParcelReadonly.landass_3,ParcelMaster.cib_stories,"
    "ParcelMaster.cib_value,Parcels.homedate,ParcelMaster.resb_basementarea,ParcelMaster.resb_effage,"
    "ParcelMaster.resb_exterior_String,ParcelMaster.resb_fireplaces,ParcelMaster.resb_fullbaths,"
    "ParcelMaster.resb_garType_String,ParcelMaster.resb_halfbaths,ParcelMaster.resb_heat_String,"
    "ParcelMaster.resb_styhgt,ParcelMaster.resb_nbed,ParcelMaster.resb_avestyht,ParcelMaster.resb_depr,"
    "ParcelReadonly.legalDescription"
)
WAYNE_COLUMNS = WAYNE_HEADER.split(",")
assert len(WAYNE_COLUMNS) == 130


def wayne_row(**fields: str) -> str:
    """One quoted CSV row with the export's usual zeros and defaults where a value is not given."""
    r = {c: "" for c in WAYNE_COLUMNS}
    r.update({"ParcelMaster.totalacres": "0", "Parcels.propstatus": "Active", "Parcels.exemptcode": "TAXABLE",
              "ParcelMaster.lastSalePrice": "0", "ParcelMaster.cib_numcib": "0", "ParcelMaster.cib_floorarea": "0",
              "ParcelMaster.cib_occ_String": "Apartment", "ParcelMaster.cib_yearbuilt": "0",
              "ParcelMaster.esttcv": "0", "ParcelMaster.resb_numresb": "0", "ParcelMaster.resb_floorarea": "0",
              "ParcelMaster.resb_occ_String": "D", "ParcelMaster.resb_yearbuilt": "0",
              "ParcelReadonly.mborsev_1": "0", "ParcelReadonly.ass_1": "0", "ParcelReadonly.tax_1": "0",
              "Parcels.secondaryunit": "31", "ParcelMaster.propcity": "EXAMPLEVILLE", "ParcelMaster.propstate": "MI",
              "ParcelMaster.propzip": "48111", "ParcelMaster.r_or_p": "0", "Parcels.isExempt": "0"})
    r.update(fields)
    r.setdefault("Parcels.oldprop", r["Parcels.propclass"])
    return ",".join(f'"{r[c]}"' for c in WAYNE_COLUMNS)


WAYNE_ROWS = [
    # An office building (201, commercial improved) owned by a company; one commercial building.
    wayne_row(**{"Parcels.pnum": "31 084 01 0001 000", "ParcelMaster.totalacres": "0.447", "Parcels.propclass": "201",
                 "ParcelMaster.cib_numcib": "1", "ParcelMaster.cib_floorarea": "11531",
                 "ParcelMaster.cib_occ_String": "Office Buildings", "ParcelMaster.cib_yearbuilt": "1968",
                 "ParcelMaster.esttcv": "1218547", "ParcelReadonly.mborsev_1": "609200", "ParcelReadonly.ass_1": "609200",
                 "ParcelReadonly.tax_1": "500000", "ParcelMaster.ownername1": "EXAMPLE TOWER LLC",
                 "ParcelMaster.ownercity": "EXAMPLEVILLE", "ParcelMaster.ownerstate": "MI",
                 "ParcelMaster.ownerstreetaddr": "100 MAIN ST STE 1", "ParcelMaster.ownerzip": "48111-2683",
                 "ParcelMaster.propstreetcombined": "476 W COLUMBIA AVE", "ParcelMaster.propaddrnum": "476.0",
                 "ParcelMaster.propstreetname": "COLUMBIA", "ParcelMaster.propaddrdirect": "W"}),
    # An apartment complex classed commercial (201) with "Multiple Residences" buildings: category B.
    wayne_row(**{"Parcels.pnum": "31 084 03 0075 301", "ParcelMaster.totalacres": "2.0000", "Parcels.propclass": "201",
                 "ParcelMaster.cib_numcib": "3", "ParcelMaster.cib_floorarea": "6152",
                 "ParcelMaster.cib_occ_String": "Multiple Residences", "ParcelMaster.cib_yearbuilt": "1972",
                 "ParcelMaster.esttcv": "900000", "ParcelMaster.ownercareof": "C/O EXAMPLE MGMT",
                 "ParcelMaster.ownername1": "EXAMPLE LAKE HOUSE LLC", "ParcelMaster.ownername2": "J EXAMPLE",
                 "ParcelMaster.ownercity": "DETROIT", "ParcelMaster.ownerstate": "MI",
                 "ParcelMaster.ownerstreetaddr": "PO BOX 9", "ParcelMaster.ownerzip": "48226",
                 "ParcelMaster.propstreetcombined": "380 N LIBERTY ST", "ParcelMaster.unitorapt": "BLDG A"}),
    # A church classed 201 and exempt: no commercial building, so the default occupancy string
    # "Apartment" does not make it multifamily; no values or areas.
    wayne_row(**{"Parcels.pnum": "31 084 01 0229 001", "Parcels.propclass": "201", "Parcels.exemptcode": "EXEMPT (211.7S)",
                 "Parcels.isExempt": "1", "ParcelMaster.ownername1": "EXAMPLE CHURCH OF GOD",
                 "ParcelMaster.ownercity": "EXAMPLEVILLE", "ParcelMaster.ownerstate": "MI",
                 "ParcelMaster.ownerstreetaddr": "494 W COLUMBIA AVE", "ParcelMaster.ownerzip": "48111",
                 "ParcelMaster.propstreetcombined": "494 W COLUMBIA AVE"}),
    # Vacant commercial land (202) owned by a natural person, with no situs street.
    wayne_row(**{"Parcels.pnum": "31 084 01 0284 002", "ParcelMaster.totalacres": "0.5", "Parcels.propclass": "202",
                 "ParcelMaster.esttcv": "60000", "ParcelMaster.ownername1": "EXAMPLE, ALEX",
                 "ParcelMaster.ownercity": "EXAMPLEVILLE", "ParcelMaster.ownerstate": "MI",
                 "ParcelMaster.ownerstreetaddr": "430 N LIBERTY ST", "ParcelMaster.ownerzip": "48111",
                 "ParcelMaster.propstreetcombined": "", "ParcelMaster.propstreetname": "LIBERTY"}),
    # Industrial (301): a warehouse plus an old residential building on the same parcel.
    wayne_row(**{"Parcels.pnum": "31 107 99 0008 001", "ParcelMaster.totalacres": "3.25", "Parcels.propclass": "301",
                 "ParcelMaster.cib_numcib": "1", "ParcelMaster.cib_floorarea": "40000",
                 "ParcelMaster.cib_occ_String": "Warehouses - Storage", "ParcelMaster.cib_yearbuilt": "1995",
                 "ParcelMaster.resb_numresb": "1", "ParcelMaster.resb_floorarea": "1200",
                 "ParcelMaster.resb_yearbuilt": "1950", "ParcelMaster.esttcv": "2500000",
                 "ParcelMaster.ownername1": "UNKNOWN", "ParcelMaster.propstreetcombined": "955 SUMPTER RD"}),
    # A house (401): residential, out of scope.
    wayne_row(**{"Parcels.pnum": "31 084 01 0212 001", "ParcelMaster.totalacres": "0.127", "Parcels.propclass": "401",
                 "ParcelMaster.resb_numresb": "1", "ParcelMaster.resb_floorarea": "1400",
                 "ParcelMaster.resb_yearbuilt": "1961", "ParcelMaster.esttcv": "190400",
                 "ParcelMaster.ownername1": "EXAMPLE, KAY", "ParcelMaster.propstreetcombined": "329 W COLUMBIA AVE"}),
    # Commercial personal property (251): not a parcel.
    wayne_row(**{"Parcels.pnum": "31 999 00 0003 100", "Parcels.propclass": "251", "ParcelMaster.r_or_p": "1",
                 "ParcelMaster.esttcv": "50000", "ParcelMaster.ownername1": "EXAMPLE SHOP INC",
                 "ParcelMaster.propstreetcombined": "6 MAIN ST"}),
    # An industrial parcel listed again (a repeated parcel number collapses to the first row).
    wayne_row(**{"Parcels.pnum": "31 107 99 0008 001", "Parcels.propclass": "301", "ParcelMaster.esttcv": "1"}),
]


def wayne_zip(tmp: Path, name: str = "2026-wayne-county-assessments-exampleville-city.zip") -> Path:
    p = tmp / name
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("EXAMPLEVILLE.CSV", "\r\n".join([WAYNE_HEADER, *WAYNE_ROWS, "\x1a", ""]))
    return p


class Wayne(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = wayne_zip(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in mi_wayne.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["31 084 01 0001 000", "31 084 01 0229 001", "31 084 01 0284 002",
                                        "31 084 03 0075 301", "31 107 99 0008 001"],
                         "201, 202, 301 kept; 401 dropped; personal property dropped; the EOF line and the repeat skipped")
        tower = recs["31 084 01 0001 000"]
        self.assertEqual(tower.county_fips, "163")
        self.assertEqual((tower.account, tower.state_category, tower.local_use_code, tower.tax_year),
                         ("31 084 01 0001 000", "F1", "201", 2026))
        self.assertEqual(tower.situs_address, "476 W COLUMBIA AVE, EXAMPLEVILLE MI 48111")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 MAIN ST STE 1, EXAMPLEVILLE, MI 48111-2683")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (19471.32, 11531, 1968))
        self.assertEqual((tower.market_value, tower.appraised_value), (1218547, None),
                         "true cash value is the market value; SEV and taxable value have no registry field")
        self.assertEqual(tower.locator, "EXAMPLEVILLE.CSV pnum 31 084 01 0001 000")
        apartments = recs["31 084 03 0075 301"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "201"),
                         "commercial-class parcels whose buildings are apartments are multifamily")
        self.assertEqual(apartments.situs_address, "380 N LIBERTY ST BLDG A, EXAMPLEVILLE MI 48111")
        self.assertEqual(apartments.owner_name, "EXAMPLE LAKE HOUSE LLC", "owner line 1 wins")
        self.assertEqual(apartments.owner_mailing_address, "C/O EXAMPLE MGMT, PO BOX 9, DETROIT, MI 48226")
        self.assertEqual(apartments.land_area_sf, 87120)
        church = recs["31 084 01 0229 001"]
        self.assertEqual(church.state_category, "F1", "the default occupancy string without a building is not a fact")
        self.assertEqual((church.market_value, church.land_area_sf, church.improvement_area_sf, church.year_built),
                         (None, None, None, None), "zeros are not figures")
        vacant = recs["31 084 01 0284 002"]
        self.assertEqual(vacant.state_category, "F1")
        self.assertIsNone(vacant.situs_address, "no street line, so no situs")
        self.assertEqual(vacant.owner_name, "EXAMPLE, ALEX", "the adapter passes persons through; the registry drops them")
        warehouse = recs["31 107 99 0008 001"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual((warehouse.improvement_area_sf, warehouse.year_built), (41200, 1950),
                         "commercial and residential buildings add up; the oldest year is the year built")
        self.assertEqual(warehouse.market_value, 2500000, "the first row for a repeated parcel number wins")
        self.assertIsNone(warehouse.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(warehouse.owner_mailing_address)
        self.assertFalse(any(r.owner_confidential for r in recs.values()), "the export carries no confidentiality flag")

    def test_state_category(self):
        row = lambda **f: {"Parcels.propclass": "201", "ParcelMaster.cib_numcib": "0",  # noqa: E731
                           "ParcelMaster.cib_occ_String": "Apartment", **f}
        self.assertEqual(mi_wayne.state_category(row()), "F1")
        self.assertEqual(mi_wayne.state_category(row(**{"ParcelMaster.cib_numcib": "2"})), "B")
        self.assertEqual(mi_wayne.state_category(row(**{"ParcelMaster.cib_numcib": "1",
                                                        "ParcelMaster.cib_occ_String": "Stores - Retail"})), "F1")
        self.assertEqual(mi_wayne.state_category({"Parcels.propclass": "207"}), "F1", "commercial condominium")
        self.assertEqual(mi_wayne.state_category({"Parcels.propclass": "302"}), "F2", "industrial vacant")
        self.assertEqual(mi_wayne.state_category({"Parcels.propclass": "401"}), "A")
        self.assertEqual(mi_wayne.state_category({"Parcels.propclass": "101"}), "D1")
        self.assertIsNone(mi_wayne.state_category({"Parcels.propclass": "251"}), "personal property")
        self.assertIsNone(mi_wayne.state_category({"Parcels.propclass": "003"}), "a local code outside the STC list")
        self.assertIsNone(mi_wayne.state_category({"Parcels.propclass": ""}))

    def test_roll_year(self):
        self.assertEqual(mi_wayne.roll_year("2026-wayne-county-assessments-names-addresses-legal.zip"), 2026)
        self.assertIsNone(mi_wayne.roll_year("BELLEVILLE.CSV"))
        self.assertEqual([r.tax_year for r in mi_wayne.read_roll(self.zip, tax_year=2025)][:1], [2025])

    def test_all_categories_and_unpacked_directory(self):
        self.assertEqual(len(list(mi_wayne.read_roll(self.zip, categories=None))), 6,
                         "every real-property parcel; personal property still dropped")
        self.assertEqual([r.apn for r in mi_wayne.read_roll(self.zip, categories=["B"])], ["31 084 03 0075 301"])
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        unpacked = list(mi_wayne.read_roll(self.tmp / "unpacked", tax_year=2026))
        self.assertEqual([r.apn for r in unpacked], [r.apn for r in mi_wayne.read_roll(self.zip)])
        self.assertIsNone(next(iter(mi_wayne.read_roll(self.tmp / "unpacked"))).tax_year,
                          "no year in the directory name")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = mi_wayne.build(self.zip, db, as_of="2026-06-05", full_roll=False)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (5, 5, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person is counted, not stored")
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'wayne_parcel_no' AND external_id = '31 084 01 0001 000'"
            ).fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-26163:31084010001000")
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["EXAMPLE CHURCH OF GOD", "EXAMPLE LAKE HOUSE LLC", "EXAMPLE TOWER LLC"],
                             "organisations only; the person and the placeholder are not stored")
            codes = {json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'parcel.local_use_code'")}
            self.assertEqual(codes, {"201", "202", "301"})
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
