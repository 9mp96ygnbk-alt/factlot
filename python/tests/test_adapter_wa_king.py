"""King County Assessor adapter tests on SYNTHETIC fixtures.

Every PIN, name, address and value here is invented to exercise the mapping; none is real King
County data. The headers copy the Assessor's published extract layouts as written in the adapter's
docstring, which have not yet been confirmed against a real download (the download is gated; see
docs/registry/sources/wa-king-assessor.md).
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import wa_king

ACCOUNT_NAME = "EXTR_RPAcct_NoName.csv"
ACCOUNT_HEADER = ("AcctNbr,Major,Minor,AttnLine,AddrLine,CityState,ZipCode,LevyCode,Status,BillYr,"
                  "NewConstructionFlag,TaxValReason,ApprLandVal,ApprImpsVal,TaxableLandVal,TaxableImpsVal")
ACCOUNT_ROWS = [
    '"123456001001","123456","0010","C/O EXAMPLE MGMT","100 MAIN ST STE 1","SEATTLE WA","98104-1000","0010","A","2026","N","","20000000","30000000","20000000","30000000"',
    '"123456002002","123456","0020","","900 RIVER RD","SEATTLE WA","98105","0010","A","2026","N","","10000000","21000000","10000000","21000000"',
    '"123456003003","123456","0030","","5 OAK LN","SEATTLE WA","98106","0010","A","2026","N","","300000","400000","300000","400000"',
    '"123456004004","123456","0040","","PO BOX 9","KENT WA","98032","1234","A","2026","N","","900000","0","900000","0"',
    '"123456005005","123456","0050","","1 PARK AVE","NEW YORK NY","10001","0010","A","2026","N","","750000","0","750000","0"',
    '"654321000506","654321","0005","","77 PINE ST","BELLEVUE WA","98004","0330","A","2026","N","EX","2000000","3000000","0","0"',
    '"000080000507","80","5","","1 FLEX WAY","TUKWILA WA","98188","2100","A","2026","N","","1500000","2500000","1500000","2500000"',
    '"123456001001","123456","0010","","DUPLICATE ACCOUNT ROW","SEATTLE WA","98104","0010","A","2026","N","","1","1","1","1"',
]
ACCOUNT_HEADER_WITH_NAME = ACCOUNT_HEADER.replace("AcctNbr,", "AcctNbr,TaxpayerName,")
ACCOUNT_ROWS_WITH_NAME = [
    '"123456001001","EXAMPLE TOWER LLC","123456","0010","C/O EXAMPLE MGMT","100 MAIN ST STE 1","SEATTLE WA","98104-1000","0010","A","2026","N","","20000000","30000000","20000000","30000000"',
    '"123456002002","UNKNOWN","123456","0020","","900 RIVER RD","SEATTLE WA","98105","0010","A","2026","N","","10000000","21000000","10000000","21000000"',
    '"123456004004","J EXAMPLE","123456","0040","","PO BOX 9","KENT WA","98032","1234","A","2026","N","","900000","0","900000","0"',
]

PARCEL_NAME = "EXTR_Parcel.csv"
PARCEL_HEADER = ("Major,Minor,PropName,PlatName,PlatLot,PlatBlock,Range,Township,Section,QuarterSection,PropType,Area,"
                 "SubArea,SpecArea,SpecSubArea,DistrictName,LevyCode,CurrentZoning,HBUAsIfVacant,HBUAsImproved,PresentUse,"
                 "SqFtLot,WaterSystem,SewerSystem,Access,Topography,StreetSurface")
PARCEL_ROWS = [
    '"123456","0010","EXAMPLE TOWER","","","","4","25","6","NE","C","10","","","","SEATTLE","0010","DMC","2","2","59","40000","2","2","4","0","1"',
    '"123456","0020","EXAMPLE APARTMENTS","","","","4","25","6","NE","C","10","","","","SEATTLE","0010","LR3","2","2","10","90000","2","2","4","0","1"',
    '"123456","0030","","EXAMPLE ADD","1","2","4","25","6","NE","R","10","","","","SEATTLE","0010","SF 5000","2","2","2","7000","2","2","4","0","1"',
    '"123456","0040","","","","","4","22","12","SW","C","20","","","","KENT","1234","M1","2","2","180","0","2","2","4","0","1"',
    '"123456","0050","","","","","4","25","6","NE","C","10","","","","SEATTLE","0010","NC2","2","2","23","5000","2","2","4","0","1"',
    '"654321","0005","EXAMPLE SHOP","","","","5","24","30","NW","C","30","","","","BELLEVUE","0330","CB","2","2","101","12000","2","2","4","0","1"',
    '"80","5","","","","","4","23","14","SE","C","25","","","","TUKWILA","2100","TUC","2","2","181","65000","2","2","4","0","1"',
]

COMMBLDG_NAME = "EXTR_CommBldg.csv"
COMMBLDG_HEADER = ("Major,Minor,BldgNbr,NbrBldgs,Address,BuildingNumber,Fraction,DirectionPrefix,StreetName,StreetType,"
                   "DirectionSuffix,ZipCode,Stories,PredominantUse,Shape,ConstrClass,BldgQuality,YrBuilt,EffYr,"
                   "BldgGrossSqFt,BldgNetSqFt,HeatingSystem,Sprinklers,Elevators,PcntComplete")
COMMBLDG_ROWS = [
    '"123456","0010","1","2","100 MAIN ST","100","","","MAIN","ST","","98104","20","344","1","3","4","1985","1995","250000","230000","1","Y","4","100"',
    '"123456","0010","2","2","102 MAIN ST","102","","","MAIN","ST","","98104","3","344","1","3","3","1990","1990","50000","45000","1","Y","1","100"',
    '"123456","0040","1","1","","500","","S","INDUSTRIAL","WAY","","98108","1","406","1","4","2","0","0","0","0","0","N","0","100"',
    '"999999","0001","1","1","1 NOWHERE RD","1","","","NOWHERE","RD","","98000","1","344","1","3","3","1970","1970","1000","900","1","N","0","100"',
]

APT_NAME = "EXTR_AptComplex.csv"
APT_HEADER = ("Major,Minor,ComplexDescr,NbrBldgs,NbrStories,NbrUnits,AvgUnitSize,ProjectLocation,ProjectAppeal,PcntWithView,"
              "ConstrClass,BldgQuality,Condition,YrBuilt,EffYr,PcntComplete,Elevators,SectionUse,Address,BuildingNumber,"
              "Fraction,DirectionPrefix,StreetName,StreetType,DirectionSuffix,ZipCode")
APT_ROWS = [
    '"123456","0020","EXAMPLE APARTMENTS","2","6","120","750","3","3","0","3","3","3","2005","2005","100","2","300","900 RIVER RD","900","","","RIVER","RD","","98105"',
]

LOOKUP_NAME = "EXTR_LookUp.csv"
LOOKUP_HEADER = "LUType,LUItem,LUDescription"
# Synthetic code numbers; the descriptions are the Assessor's PresentUse wording, which the mapping keys on.
LOOKUP_ROWS = [
    '"1","C","Commercial"',
    '"102","2","Single Family(Res Use/Zone)"',
    '"102","10","Apartment"',
    '"102","11","Apartment(Mixed Use)"',
    '"102","18","Condominium(Residential)"',
    '"102","23","Vacant(Commercial)"',
    '"102","59","Office Building"',
    '"102","101","Retail Store"',
    '"102","180","Warehouse"',
    '"102","181","Industrial(Light)"',
    '"102","190","Church/Welfare/Relig Srvc"',
]

FIXTURE = {
    "Real Property Account.zip": (ACCOUNT_NAME, ACCOUNT_HEADER, ACCOUNT_ROWS),
    "Parcel.zip": (PARCEL_NAME, PARCEL_HEADER, PARCEL_ROWS),
    "Commercial Building.zip": (COMMBLDG_NAME, COMMBLDG_HEADER, COMMBLDG_ROWS),
    "Apartment Complex.zip": (APT_NAME, APT_HEADER, APT_ROWS),
    "Lookup.zip": (LOOKUP_NAME, LOOKUP_HEADER, LOOKUP_ROWS),
}


def _csv(header: str, rows: list[str]) -> str:
    return "\r\n".join([header, *rows, ""])


class KingCounty(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zips = []
        for zip_name, (member, header, rows) in FIXTURE.items():
            path = self.tmp / zip_name
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr(member, _csv(header, rows))
            self.zips.append(path)

    def test_category_rules(self):
        cases = {
            "Apartment": "B", "Apartment(Mixed Use)": "B", "Apartment (Subsidized)": "B", "Rooming House": "B",
            "Office Building": "F1", "Retail(Big Box)": "F1", "Shopping Ctr(Nghbr)": "F1", "Hotel/Motel": "F1",
            "Restaurant(Fast Food)": "F1", "Parking(Garage)": "F1", "Hist Prop(Office)": "F1", "Conv Store with Gas": "F1",
            "Warehouse": "F2", "Mini Warehouse": "F2", "Industrial(Gen Purpose)": "F2", "Industrial Park": "F2",
            "Terminal(Marine/Comm Fish)": "F2", "Hist Prop(Loft/Warehouse)": "F2",
            "Single Family(Res Use/Zone)": None, "Duplex": None, "4-Plex": None, "Condominium(Residential)": None,
            "Condominium(Mixed Use)": None, "Vacant(Commercial)": None, "Vacant(Industrial)": None,
            "Vacant(Multi-family)": None, "Hist Prop(Residence)": None, "Church/Welfare/Relig Srvc": None,
            "Open Space(Curr Use-RCW 84.34)": None, "Utility, Public": None, "Right of Way/Utility, Road": None,
            "": None, None: None,
        }
        for desc, expected in cases.items():
            with self.subTest(desc=desc):
                self.assertEqual(wa_king.category_for(desc), expected)

    def test_mapping_from_the_zips(self):
        recs = {r.apn: r for r in wa_king.read_roll(self.zips)}
        self.assertEqual(sorted(recs), ["0000800005", "1234560010", "1234560020", "1234560040", "6543210005"],
                         "single family, vacant land and the account without a parcel row are out of scope")
        tower = recs["1234560010"]
        self.assertEqual((tower.county_fips, tower.account, tower.state_category, tower.local_use_code), ("033", "1234560010", "F1", "59"))
        self.assertEqual(tower.situs_address, "100 MAIN ST, WA 98104", "the first building's address; no situs city in the extracts")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 300000, 1985),
                         "gross area sums the buildings; the oldest year built wins")
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (50000000, 50000000, 2026))
        self.assertIsNone(tower.owner_name, "the NoName extract publishes no taxpayer name")
        self.assertIsNone(tower.owner_mailing_address)
        self.assertFalse(tower.owner_confidential)
        self.assertEqual(tower.locator, "EXTR_RPAcct_NoName.csv PIN 1234560010")
        apartments = recs["1234560020"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "10"))
        self.assertEqual(apartments.situs_address, "900 RIVER RD, WA 98105", "apartment complexes carry their own address")
        self.assertEqual((apartments.year_built, apartments.improvement_area_sf), (2005, None),
                         "the apartment extract has no gross area; nothing is estimated from units")
        warehouse = recs["1234560040"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.situs_address, "500 S INDUSTRIAL WAY, WA 98108", "built from the address parts")
        self.assertIsNone(warehouse.land_area_sf, "SqFtLot 0 is 'no figure'")
        self.assertIsNone(warehouse.improvement_area_sf)
        self.assertIsNone(warehouse.year_built)
        self.assertEqual((warehouse.market_value, warehouse.appraised_value), (900000, 900000))
        shop = recs["6543210005"]
        self.assertEqual((shop.state_category, shop.situs_address, shop.year_built), ("F1", None, None), "no building row")
        self.assertEqual((shop.market_value, shop.appraised_value), (5000000, 0), "taxable value 0 is the exempt figure, kept")
        flex = recs["0000800005"]
        self.assertEqual((flex.state_category, flex.local_use_code, flex.land_area_sf), ("F2", "181", 65000), "Major/Minor zero-padded")

    def test_taxpayer_name_when_published(self):
        d = self.tmp / "named"
        d.mkdir()
        (d / ACCOUNT_NAME).write_text(_csv(ACCOUNT_HEADER_WITH_NAME, ACCOUNT_ROWS_WITH_NAME))
        (d / PARCEL_NAME).write_text(_csv(PARCEL_HEADER, PARCEL_ROWS))
        (d / LOOKUP_NAME).write_text(_csv(LOOKUP_HEADER, LOOKUP_ROWS))
        recs = {r.apn: r for r in wa_king.read_roll([d])}
        self.assertEqual(recs["1234560010"].owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(recs["1234560010"].owner_mailing_address, "C/O EXAMPLE MGMT, 100 MAIN ST STE 1, SEATTLE WA 98104-1000")
        self.assertIsNone(recs["1234560020"].owner_name, "'UNKNOWN' is a placeholder, not an owner")
        self.assertIsNone(recs["1234560020"].owner_mailing_address)
        self.assertEqual(recs["1234560040"].owner_name, "J EXAMPLE", "persons are dropped by the registry, not the adapter")
        self.assertIsNone(recs["1234560010"].situs_address, "no building extracts in this run")

    def test_unpacked_directory_reads_the_same(self):
        d = self.tmp / "unpacked"
        for z in self.zips:
            with zipfile.ZipFile(z) as zf:
                zf.extractall(d)
        a = [(r.apn, r.situs_address, r.market_value) for r in wa_king.read_roll(self.zips)]
        b = [(r.apn, r.situs_address, r.market_value) for r in wa_king.read_roll([d])]
        self.assertEqual(a, b)

    def test_all_categories(self):
        recs = {r.apn: r for r in wa_king.read_roll(self.zips, categories=None)}
        self.assertEqual(len(recs), 7)
        self.assertEqual((recs["1234560030"].state_category, recs["1234560030"].local_use_code), (None, "2"))
        self.assertEqual([r for r in wa_king.read_roll(self.zips, categories=["B"])][0].apn, "1234560020")

    def test_check_lookup(self):
        report = wa_king.check_lookup(self.zips)
        self.assertEqual(report["B"], ["10 Apartment", "11 Apartment(Mixed Use)"])
        self.assertEqual(report["F2"], ["180 Warehouse", "181 Industrial(Light)"])
        self.assertEqual(report["F1"], ["59 Office Building", "101 Retail Store"])
        self.assertIn("190 Church/Welfare/Relig Srvc", report["out_of_scope"])
        self.assertNotIn("C Commercial", sum(report.values(), []), "only lookup type 102 is PresentUse")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = wa_king.build(self.zips, db, as_of="2026-10-30")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (5, 5, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'wa-king-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("53", "033"))
            self.assertEqual(reg.db.execute("SELECT count(*) FROM snapshots").fetchone()[0], 5, "every extract is a snapshot")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'king_pin' AND external_id = '1234560010'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-53033:1234560010")
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("59", code[0])
            owners = reg.db.execute("SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 0)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
