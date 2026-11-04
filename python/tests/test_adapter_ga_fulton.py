"""Fulton County (GA) adapter tests on a SYNTHETIC fixture that copies the publisher's real layout.

Every parcel number, name, and value here is invented to exercise the mapping; none is real Fulton
County data. The header is the Hub CSV export of the ``Tax_Parcels_2025`` layer; the structure
member copies ``Tax_StructureCommercial.txt`` from ``Tax_CAMAInfo.zip``.
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ga_fulton

HEADER = (
    "OBJECTID,ParcelID,TaxYear,Address,AddrNumber,AddrPreDir,AddrStreet,AddrSuffix,AddrPosDir,AddrUntTyp,AddrUnit,"
    "Owner,OwnerAddr1,OwnerAddr2,TaxDist,TotAssess,LandAssess,ImprAssess,TotAppr,LandAppr,ImprAppr,LUCode,ClassCode,"
    "ExCode,LivUnits,LandAcres,NbrHood,Subdiv,SubdivNum,SubdivLot,SubdivBlck,FeatureID,Shape__Area,Shape__Length"
)
ROWS = [
    # office tower: C3 / 3C3 → F1, organisation owner, two structure cards
    '1,14 0001  LL0001,2025,100 PEACHTREE ST NE,100,,PEACHTREE,ST,NE,,,EXAMPLE TOWER LLC,100 PEACHTREE ST NE STE 100,'
    '"ATLANTA, GA 30303",05,20000000,4000000,16000000,50000000,10000000,40000000,3C3,C3,,0,0.9183,,,,,,F1,40000,800',
    # garden apartments: C3 / 2C1 → B, 120 living units, natural-person owner (not stored by the registry)
    '2,17 0002  LL0002,2025,900 RIVER RD,900,,RIVER,RD,,,,"EXAMPLE, JANE Q",PO BOX 9,"ROSWELL, GA 30075",'
    '17,12000000,2000000,10000000,30000000,5000000,25000000,2C1,C3,,120,2.0,,,,,,F2,87120,1200',
    # apartments on a residential-class parcel: R4 / 211 → B
    '3,22 0003  LL0003,2025,7 OAK LN,7,,OAK,LN,,,,EXAMPLE APARTMENTS LP,1 PARK AVE,"NEW YORK, NY 10001",'
    '22,800000,100000,700000,2000000,250000,1750000,211,R4,,24,1.0,,,,,,F3,43560,900',
    # single family: R3 / 101 → out of scope
    '4,14 0004  LL0004,2025,5 ELM ST,5,,ELM,ST,,,,EXAMPLE JOHN,5 ELM ST,"ATLANTA, GA 30310",'
    '05,120000,30000,90000,300000,75000,225000,101,R3,,1,0.25,,,,,,F4,10890,400',
    # vacant commercial land: C3 / 300 → out of scope (vacant), as is the tie-back 999
    '5,14 0005  LL0005,2025,0 MAIN ST,0,,MAIN,ST,,,,EXAMPLE HOLDINGS INC,PO BOX 1,"ATLANTA, GA 30301",'
    '05,200000,200000,0,500000,500000,0,300,C3,,0,0.5,,,,,,F5,21780,600',
    '6,14 0006  LL0006,2025,0 MAIN ST,0,,MAIN,ST,,,,EXAMPLE HOLDINGS INC,PO BOX 1,"ATLANTA, GA 30301",'
    '05,0,0,0,0,0,0,999,C3,,0,0,,,,,,F6,0,0',
    # hotel: C3 / 251 → F1 (hotels are commercial, not multifamily)
    '7,14 0007  LL0007,2025,200 HOTEL WAY,200,,HOTEL,WAY,,,,EXAMPLE HOSPITALITY LLC,200 HOTEL WAY,"ATLANTA, GA 30303",'
    '05,8000000,1000000,7000000,20000000,2500000,17500000,251,C3,,0,1.5,,,,,,F7,65340,1000',
    # manufacturing plant: I3 / 401 → F2; placeholder owner; zero values and acres are not figures
    '8,09F0008  LL0008,2025,1 FACTORY RD,1,,FACTORY,RD,,,,UNKNOWN,,,09,0,0,0,0,0,0,401,I3,,0,0,,,,,,F8,0,0',
    # warehouse in the commercial land-use series on an industrial-class parcel: I4 / 398 → F2
    '9,09F0009  LL0009,2025,2 DEPOT RD,2,,DEPOT,RD,,,,EXAMPLE LOGISTICS LLC,2 DEPOT RD,"UNION CITY, GA 30291",'
    '09,2000000,500000,1500000,5000000,1250000,3750000,398,I4,,0,5.0,,,,,,F9,217800,2000',
    # exempt government office: E1 / 699 → out of scope; apartments owned by a church: E2 / 2A1 → out
    '10,14 0010  LL0010,2025,141 PRYOR ST SW,141,,PRYOR,ST,SW,,,FULTON COUNTY,141 PRYOR ST SW,"ATLANTA, GA 30303",'
    '05,0,0,0,10000000,2000000,8000000,699,E1,,0,1.0,,,,,,F10,43560,900',
    '11,14 0011  LL0011,2025,3 CHURCH ST,3,,CHURCH,ST,,,,EXAMPLE CHURCH INC,3 CHURCH ST,"ATLANTA, GA 30303",'
    '05,0,0,0,4000000,500000,3500000,2A1,E2,,40,1.0,,,,,,F11,43560,900',
    # the office tower's parcel repeated (a second polygon for the same parcel number) collapses to the first
    '12,14 0001  LL0001,2025,100 PEACHTREE ST NE,100,,PEACHTREE,ST,NE,,,EXAMPLE TOWER LLC,100 PEACHTREE ST NE STE 100,'
    '"ATLANTA, GA 30303",05,20000000,4000000,16000000,50000000,10000000,40000000,3C3,C3,,0,0.9183,,,,,,F12,40000,800',
]

STRUCTURE_HEADER = "ObjectID\tFeatureID\tParcelID\tCard\tYrBlt\tParkCover\tParkUncov\tAreaSF\tBusla\tTaxYear"
STRUCTURE_ROWS = [
    "1\tXSL0000001\t14 0001  LL0001\t1\t1985\t0\t0\t250000\t250000\t2025",
    "2\tXSL0000002\t14 0001  LL0001\t2\t1999\t0\t0\t5000\t5000\t2025",
    "3\tXSL0000003\t17 0002  LL0002\t1\t0\t0\t0\t0\t0\t2025",  # zeros: no year, no area
    "4\tXSL0000004\t09F0009  LL0009\t1\t2010\t0\t0\t120000\t120000\t2025",
]


def fixture(tmp: Path) -> tuple[Path, Path]:
    csv_path = tmp / "Tax_Parcels_2025.csv"
    csv_path.write_text("\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    zip_path = tmp / "Tax_CAMAInfo.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("Tax_StructureCommercial.txt", "\r\n".join([STRUCTURE_HEADER, *STRUCTURE_ROWS, ""]))
        zf.writestr("Tax_StructureApartment.txt", "ObjectID\tFeatureID\tParcelID\tCard\tUnits\tBed\tBath\tHalf\tTaxYear\r\n")
    return csv_path, zip_path


class Fulton(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv, self.zip = fixture(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in ga_fulton.read_roll(self.csv, structures=self.zip)}
        self.assertEqual(sorted(recs), ["09F0008  LL0008", "09F0009  LL0009", "14 0001  LL0001", "14 0007  LL0007",
                                        "17 0002  LL0002", "22 0003  LL0003"],
                         "F1, B, B, F1, F2, F2 kept; residential, vacant, tie-back and exempt dropped; repeats collapsed")
        tower = recs["14 0001  LL0001"]
        self.assertEqual(tower.county_fips, "121")
        self.assertEqual((tower.account, tower.state_category, tower.local_use_code, tower.tax_year),
                         ("14 0001  LL0001", "F1", "C3/3C3", 2025))
        self.assertEqual(tower.situs_address, "100 PEACHTREE ST NE", "the layer has no situs city or ZIP")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 PEACHTREE ST NE STE 100, ATLANTA, GA 30303")
        self.assertEqual(tower.land_area_sf, 40001.15, "acres × 43560")
        self.assertEqual((tower.improvement_area_sf, tower.year_built), (255000, 1985),
                         "area sums the cards; the year is the largest card's")
        self.assertEqual((tower.market_value, tower.appraised_value), (50000000, 50000000))
        self.assertEqual(tower.locator, "ParcelID 14 0001  LL0001")
        self.assertFalse(tower.owner_confidential)
        apartments = recs["17 0002  LL0002"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "C3/2C1"))
        self.assertEqual(apartments.owner_name, "EXAMPLE, JANE Q", "the adapter passes persons through; the registry drops them")
        self.assertEqual((apartments.year_built, apartments.improvement_area_sf), (None, None), "zero cards are not figures")
        self.assertEqual(recs["22 0003  LL0003"].state_category, "B", "an apartment land use on a residential-class parcel")
        self.assertEqual(recs["14 0007  LL0007"].state_category, "F1", "hotels are commercial")
        plant = recs["09F0008  LL0008"]
        self.assertEqual(plant.state_category, "F2")
        self.assertIsNone(plant.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(plant.owner_mailing_address)
        self.assertEqual((plant.market_value, plant.appraised_value, plant.land_area_sf), (None, None, None),
                         "zeros are not figures")
        self.assertEqual((plant.year_built, plant.improvement_area_sf), (None, None), "no structure card")
        warehouse = recs["09F0009  LL0009"]
        self.assertEqual((warehouse.state_category, warehouse.local_use_code), ("F2", "I4/398"))
        self.assertEqual((warehouse.year_built, warehouse.improvement_area_sf, warehouse.land_area_sf), (2010, 120000, 217800))

    def test_state_category(self):
        sc = ga_fulton.state_category
        self.assertEqual(sc("C3", "355"), "F1")
        self.assertEqual(sc("C1", "88R"), "F1", "economic-development retail on a taxable commercial parcel")
        self.assertEqual(sc("C3", "401"), "F2", "industrial land use on a commercial-class parcel")
        self.assertEqual(sc("I5", "339"), "F2", "industrial class wins over a commercial land use")
        self.assertEqual(sc("C3", "2X0"), "B")
        self.assertEqual(sc("C3", "254"), "F1", "motels are commercial")
        self.assertIsNone(sc("C3", "200"), "vacant apartment land")
        self.assertIsNone(sc("C3", "299"), "tie-back")
        self.assertIsNone(sc("I3", "400"), "vacant industrial land")
        self.assertIsNone(sc("C3", "105"), "a dwelling on a commercial-class parcel is residential use")
        self.assertIsNone(sc("R3", "102"), "two-family residential is not multifamily")
        self.assertIsNone(sc("E1", "3C3"), "exempt")
        self.assertIsNone(sc("U3", "700"))
        self.assertIsNone(sc("B3", "889"), "Georgia's class B is brownfield, not multifamily")
        self.assertIsNone(sc("", "355"))
        self.assertIsNone(sc("C3", ""))

    def test_without_structures_and_all_parcels(self):
        recs = list(ga_fulton.read_roll(self.csv))
        self.assertEqual(len(recs), 6)
        self.assertTrue(all(r.year_built is None and r.improvement_area_sf is None for r in recs))
        every = list(ga_fulton.read_roll(self.csv, all_parcels=True))
        self.assertEqual(len(every), 11, "every distinct parcel; the repeat still collapses")
        self.assertEqual(sum(1 for r in every if r.state_category is None), 5)
        self.assertEqual(next(r.local_use_code for r in every if r.apn == "14 0004  LL0004"), "R3/101")
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        self.assertEqual(ga_fulton.read_structures(self.tmp / "unpacked"), ga_fulton.read_structures(self.zip))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ga_fulton.build(self.csv, db, as_of="2025-06-24", structures=self.zip)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ga-fulton-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("13", "121"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'fulton_parcel_id' AND external_id = ?",
                                 ("14 0001  LL0001",)).fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-13121:14-0001-ll0001")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER LLC", owner[0])
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'",
                (urn,)).fetchone()
            self.assertIn("C3/3C3", code[0])
            apartments = reg.db.execute("SELECT urn FROM crosswalk WHERE external_id = ?", ("17 0002  LL0002",)).fetchone()[0]
            self.assertIsNone(reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                (apartments,)).fetchone(), "a natural person is never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
