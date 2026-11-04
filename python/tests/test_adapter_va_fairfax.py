"""Fairfax County adapter tests on a SYNTHETIC fixture that copies the real Hub CSV headers.

Every parcel id, address, and value here is invented; the land use descriptions are the
publisher's real vocabulary (that is what the mapping is keyed on).
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import va_fairfax

# Headers are the feature-service field names, as the Hub CSV export writes them (2026-11-02).
PARCELS = [
    "OBJECTID,PARID,TAXYR,LIVUNIT,LOCATION_DESC,STREET1_DESC,LUC_DESC,UTIL1_DESC,UTIL2_DESC,UTIL3_DESC,ZONING_DESC",
    '1,"0011 01  0001",2027,,COMMERCIAL RANK #1,PAVED,General med/hi rise off (= > 5 stories),Water Connected,Sewer Connected,Gas Available,C-4(Comm High Int)',
    '2,"0011 01  0002",2027,240,COMMERCIAL RANK #2,PAVED,Garden Apartments rental ( =<4 story),Water Connected,Sewer Connected,Gas Available,R-20(Res 20 DU/AC)',
    '3,"0011 01  0003",2027,1,RESIDENTIAL RANK #3,PAVED,"Single-family, Detached ",Water Connected,Sewer Connected,Gas Available,R-3(Res 3 DU/AC)',
    '4,"0011 01  0004",2027,,COMMERCIAL RANK #1,PAVED,"Wholesale,warehousing & stg (not in IP)",Water Connected,Sewer Connected,Gas Not Available,I-5(Ind General)',
    '5,"0011 01  0005",2027,,COMMERCIAL RANK #1,UNPAVED,Vacant Land,Water not available,Sewer not available,Gas not available,C-8(Comm Highway)',
    '6,"0011 01  0006",2027,,COMMERCIAL RANK #2,PAVED,Restaurant with alcohol,Water Connected,Sewer Connected,Gas Available,C-6(Comm Retail)',
    '7,"0011 01  0001",2027,,COMMERCIAL RANK #1,PAVED,General med/hi rise off (= > 5 stories),Water Connected,Sewer Connected,Gas Available,C-4(Comm High Int)',
]
LEGAL = [
    "OBJECTID,PARID,TAXYR,ACRES,ADRPRE,ADRNO,ADRADD,ADRDIR,ADRSTR,ADRSUF,ADRSUF2,CITYNAME,ZIP1,SQFT,TAXDIST,LEGAL1,LEGAL2,LEGAL3,TAXDIST_DESC",
    '1,"0011 01  0001",2027,,,8000,,,EXAMPLE,BLVD,,TYSONS,22102,120000,70100,EXAMPLE CENTER,PCL A,,',
    '2,"0011 01  0002",2027,12.5,,100,A,N,SAMPLE,ST,,ANNANDALE,22003,,80100,SAMPLE GARDENS,,,',
    '3,"0011 01  0003",2027,,,5,,,OAK,LN,,FAIRFAX,22030,9000,60100,OAK WOODS,LT 3,,',
    '4,"0011 01  0004",2027,,,,,,,,,LORTON,22079,0,60200,INDUSTRIAL PK,PCL 4,,',
    '6,"0011 01  0006",2027,,,7,1/2,,MAIN,ST,,HERNDON,20170,6000,20100,MAIN SQUARE,,,',
]
ASSESSED = [
    "OBJECTID,PARID,TAXYR,APRLAND,APRBLDG,APRTOT,PRILAND,PRIBLDG,PRITOT,FLAG4_DESC",
    '1,"0011 01  0001",2026,20000000,80000000,100000000,19000000,75000000,94000000,No Exemption',
    '2,"0011 01  0002",2026,9000000,41000000,50000000,8500000,40000000,48500000,No Exemption',
    '3,"0011 01  0003",2026,200000,400000,600000,190000,390000,580000,No Exemption',
    '4,"0011 01  0004",2026,3000000,0,3000000,2900000,0,2900000,No Exemption',
    '6,"0011 01  0006",2026,900000,1100000,2000000,880000,1050000,1930000,No Exemption',
]
LAND = [
    "OBJECTID,PARID,TAXYR,LLINE,SF,ACRES,UNITS,CODE_DESC",
    '1,"0011 01  0001",2027,1,120000,2.7548,1,COMMERCIAL',
    '2,"0011 01  0004",2027,1,100000,2.2957,1,INDUSTRIAL',
    '3,"0011 01  0004",2027,2,50000,1.1478,1,INDUSTRIAL',
    '4,"0011 01  0006",2027,1,6000,0.1377,1,COMMERCIAL',
]
COMMERCIAL = [
    "OBJECTID,PARID,TAXYR,ELEMENT,UNITS,YRBLT,IMPRNAME,USER1,USER8,BUSLA,USER3_DESC,USER4_DESC,USER6_DESC,USER7_DESC",
    '1,"0011 01  0001",2027,E00001001,1,1998,EXAMPLE TOWER,12,6,300000,Steel,Glass,Built-up,Concrete',
    '2,"0011 01  0001",2027,E00001002,1,2005,EXAMPLE ANNEX,2,1,20000,Steel,Glass,Built-up,Concrete',
    '3,"0011 01  0002",2027,E00002001,240,1972,SAMPLE GARDENS,3,0,210000,Frame,Brick,Shingle,Wood',
    '4,"0011 01  0004",2027,E00004001,1,0,WAREHOUSE A,1,0,0,Metal,Metal,Metal,Concrete',
    '5,"0011 01  0006",2027,E00006001,1,1960,MAIN SQUARE,1,0,4500,Block,Brick,Built-up,Concrete',
]


def fairfax_dir(tmp: Path) -> Path:
    """Lay the five tables out as the collector does: <source>/<sha16>/csv, one directory per file."""
    root = tmp / "va-fairfax-assessor"
    for i, rows in enumerate((PARCELS, LEGAL, ASSESSED, LAND, COMMERCIAL)):
        d = root / f"{i:016x}"
        d.mkdir(parents=True)
        (d / "csv").write_text("\n".join([*rows, ""]), encoding="utf-8")
    (root / "manifest.jsonl").write_text('{"status": "archived"}\n')
    return root


class Fairfax(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = fairfax_dir(self.tmp)

    def test_tables_are_recognised_by_header(self):
        tables = va_fairfax.find_tables(self.root)
        self.assertEqual(sorted(tables), ["assessed", "commercial", "land", "legal", "parcels"])
        self.assertEqual(tables["parcels"].read_text().splitlines()[0][:14], "OBJECTID,PARID")

    def test_category_mapping(self):
        self.assertEqual(va_fairfax.state_category("General med/hi rise off (= > 5 stories)"), "F1")
        self.assertEqual(va_fairfax.state_category("  garden apartments RENTAL ( =<4 story) "), "B",
                         "matched after whitespace squeezing and case folding")
        self.assertEqual(va_fairfax.state_category("High rise apartments rental(=>9  comm)"), "B",
                         "the publisher's double space is squeezed")
        self.assertEqual(va_fairfax.state_category("Wholesale,warehousing & stg (not in IP)"), "F2")
        self.assertIsNone(va_fairfax.state_category("Single-family, Detached "))
        self.assertIsNone(va_fairfax.state_category("Townhouse in rental development"), "per-lot parcels stay out")
        self.assertIsNone(va_fairfax.state_category("Vacant Land"))
        self.assertIsNone(va_fairfax.state_category(None))
        self.assertTrue(set(va_fairfax.LAND_USE_CATEGORY.values()) <= {"B", "F1", "F2"})

    def test_mapping_from_the_tables(self):
        recs = {r.apn: r for r in va_fairfax.read_roll(self.root)}
        self.assertEqual(sorted(recs), ["0011 01 0001", "0011 01 0002", "0011 01 0004", "0011 01 0006"],
                         "commercial scope: office, apartments, warehouse, restaurant; house and vacant land dropped; "
                         "PARID padding normalised; the repeated parcel row collapses")
        office = recs["0011 01 0001"]
        self.assertEqual((office.county_fips, office.state_category, office.local_use_code),
                         ("059", "F1", "General med/hi rise off (= > 5 stories)"))
        self.assertEqual(office.account, "0011 01 0001")
        self.assertEqual(office.situs_address, "8000 EXAMPLE BLVD, TYSONS VA 22102")
        self.assertIsNone(office.owner_name, "Fairfax publishes no owner of record")
        self.assertFalse(office.owner_confidential)
        self.assertIsNone(office.owner_mailing_address)
        self.assertEqual(office.land_area_sf, 120000, "deeded square feet from the legal table")
        self.assertEqual(office.improvement_area_sf, 320000, "BUSLA summed over the two commercial elements")
        self.assertEqual(office.year_built, 1998, "the oldest element")
        self.assertEqual((office.market_value, office.appraised_value, office.tax_year), (100000000, 100000000, 2026))
        self.assertEqual(office.locator, "Parcels Data PARID 0011 01 0001")
        apartments = recs["0011 01 0002"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.situs_address, "100A N SAMPLE ST, ANNANDALE VA 22003", "a letter suffix joins the number")
        self.assertEqual(apartments.land_area_sf, 544500.0, "SQFT blank falls back to deeded ACRES × 43560")
        warehouse = recs["0011 01 0004"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertIsNone(warehouse.situs_address, "no street name, no situs")
        self.assertEqual(warehouse.land_area_sf, 150000, "SQFT 0 and ACRES blank fall back to the land lines summed")
        self.assertIsNone(warehouse.improvement_area_sf, "BUSLA 0 is 'no figure'")
        self.assertIsNone(warehouse.year_built, "YRBLT 0 is 'no figure'")
        restaurant = recs["0011 01 0006"]
        self.assertEqual(restaurant.situs_address, "7 1/2 MAIN ST, HERNDON VA 20170", "a fraction suffix keeps its space")
        self.assertEqual((restaurant.improvement_area_sf, restaurant.year_built), (4500, 1960))

    def test_explicit_file_list_and_all_categories(self):
        tables = va_fairfax.find_tables(self.root)
        a = [r.apn for r in va_fairfax.read_roll(self.root)]
        b = [r.apn for r in va_fairfax.read_roll(list(tables.values()))]
        self.assertEqual(a, b)
        everything = list(va_fairfax.read_roll(self.root, categories=None))
        self.assertEqual(len(everything), 6)
        self.assertEqual([r.apn for r in va_fairfax.read_roll(self.root, categories=["B"])], ["0011 01 0002"])
        house = next(r for r in everything if r.apn == "0011 01 0003")
        self.assertIsNone(house.state_category)
        self.assertEqual(house.local_use_code, "Single-family, Detached")

    def test_missing_parcels_table_is_an_error(self):
        with self.assertRaises(FileNotFoundError):
            va_fairfax.find_tables([va_fairfax.find_tables(self.root)["legal"]])

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = va_fairfax.build(self.root, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (4, 4, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'va-fairfax-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("51", "059"))
            snaps = reg.db.execute("SELECT document_id FROM snapshots").fetchall()
            self.assertEqual(len(snaps), 5, "every table file is a snapshot")
            self.assertTrue(all(s[0].startswith("fl:document:sha256-") for s in snaps))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'fairfax_parcel_id' AND external_id = '0011 01 0001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-51059:0011-01-0001")
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("General med/hi rise off", code[0])
            owners = reg.db.execute("SELECT COUNT(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 0)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
