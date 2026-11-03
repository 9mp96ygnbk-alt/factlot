"""Mecklenburg County (NC) adapter tests on a SYNTHETIC fixture that copies the real ``Cama_Table.csv``
header (2026-11-02). Every parcel id, name, and value here is invented."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import nc_mecklenburg

HEADER = (
    "objectid,gispid,map_book,map_page,map_block,lot_num,nc_pin,condo_town_flag,parcel_type,legal_from,gisacres,parcelid,"
    "yearid,lndunitnum,landunit,revaldist,lusecode,landuse_description,neighborhood,xcoord,ycoord,saleprice,saledate,"
    "streetname,streetnumber,altstreetnum,loccity,ownrlstnme,ownrfrstnme,ownr2lstnme,ownr2frstnme,mailaddr1,mailaddr2,"
    "zipcode,state,deed_book,deed_page,totlandval,totalyardval,totalvalue,totalbldgval,totmarkval,address,legaldesc,"
    "exemption,naldesc,validsale,mailcity,taxmundist,taxspecdist,taxfiredist,commonpid,heatedarea,legalacres,neighbordesc,"
    "ownertype,ownertyped,ownernum,dateannex,grantor,vacorimprov,typeofdeed,amtstamps,extwall,storyheight,bldgcode,"
    "bldgtype,foundation,interwall,roofcover,heat,heatfuel,frame,yearbuilt,effyearblt,fullbath,halfbath,threequabath,"
    "fireplaces,basegarage,percntheat,percntac,comunits,resunits,condoflrbldgs,finisharea,totalarea,bedrooms,grade,"
    "basearea,semifinbase,unfingarag,fingarage,finattic,totgararea,totcrpoarea,shape_Length,shape_Area"
)
COLUMNS = HEADER.split(",")


def row(**kw: str) -> str:
    """One CSV line with the given columns filled and every other column blank."""
    values = {c: "" for c in COLUMNS}
    values.update(kw)
    out = []
    for c in COLUMNS:
        v = values[c]
        out.append(f'"{v}"' if "," in v or '"' in v else v)
    return ",".join(out)


ROWS = [
    # Office tower: two building rows, distinct buildings (heatedarea = sum of finished areas).
    row(gispid="00100101", parcelid="00100101", commonpid="00100101", yearid="2026", lusecode="O418",
        landuse_description="OFFICE HIGH RISE - > 6 STORIES", loccity="CHARLOTTE", ownrlstnme="EXAMPLE TOWER LLC",
        mailaddr1="100 MAIN ST", mailaddr2="STE 1", mailcity="CHARLOTTE", state="NC", zipcode="28202",
        address="100 S TRYON ST CHARLOTTE NC", totlandval="5000000", totalvalue="52000000", totalbldgval="47000000",
        totmarkval="52500000", heatedarea="250000.000000000000000", legalacres="0.918000000000000", gisacres="0.920000000000000",
        yearbuilt="1985", finisharea="200000", totalarea="210000", bldgtype="OFFICE A CLASS", grade="EXCELLENT"),
    row(gispid="00100101", parcelid="00100101", commonpid="00100101", yearid="2026", lusecode="O418",
        landuse_description="OFFICE HIGH RISE - > 6 STORIES", loccity="CHARLOTTE", ownrlstnme="EXAMPLE TOWER LLC",
        mailaddr1="100 MAIN ST", mailaddr2="STE 1", mailcity="CHARLOTTE", state="NC", zipcode="28202",
        address="100 S TRYON ST CHARLOTTE NC", totlandval="5000000", totalvalue="52000000", totalbldgval="47000000",
        totmarkval="52500000", heatedarea="250000.000000000000000", legalacres="0.918000000000000", gisacres="0.920000000000000",
        yearbuilt="1999", finisharea="50000", totalarea="60000", bldgtype="PARKING DECK", grade="AVERAGE"),
    # Warehouse: the same building row repeated three times (heatedarea = one row's finished area).
    *[row(gispid="00200202", parcelid="00200202", commonpid="00200202", yearid="2026", lusecode="I648",
          landuse_description="WAREHOUSING", loccity="UNINC", ownrlstnme="EXAMPLE LOGISTICS INC",
          mailaddr1="PO BOX 9", mailcity="ATLANTA", state="GA", zipcode="30301", address="9 FREIGHT RD UNINC NC",
          totalvalue="4000000", totmarkval="4000000", heatedarea="38352.000000000000000", legalacres="",
          gisacres="5.000000000000000", yearbuilt="2015", finisharea="38352", totalarea="53098", bldgtype="SERVICE GARAGE",
          grade="AVERAGE") for _ in range(3)],
    # Apartments, no building data, placeholder owner, ZIP stuck on the address.
    row(gispid="00300303", parcelid="00300303", commonpid="00300303", yearid="2026", lusecode="A500",
        landuse_description="MULTI FAMILY", loccity="CHARLOTTE", ownrlstnme="UNKNOWN", mailaddr1="",
        address="505 E 34TH ST, 201 CHARLOTTE NC -28205", totalvalue="0", totmarkval="0", heatedarea="0.000000000000000",
        legalacres="0", gisacres="0.000000000000000", yearbuilt="0", finisharea="0", totalarea="0"),
    # Commercial condominium unit: condo commonpid, so gisacres (the whole complex) is not its land.
    row(gispid="00400404", parcelid="00400404", commonpid="00400C01", yearid="2026", lusecode="C735",
        landuse_description="COMMERCIAL CONDOMINIUM", loccity="CHARLOTTE", ownrlstnme="BLOOM", ownrfrstnme="PAMELA E",
        mailaddr1="844 NORTH CRAIGE ST", mailcity="SALISBURY", state="NC", zipcode="28144",
        address="2115 SOUTHEND DR, 103 CHARLOTTE NC", totalvalue="366700", totmarkval="366700",
        heatedarea="850.000000000000000", legalacres="", gisacres="1.916926970000000", yearbuilt="2004", finisharea="850",
        totalarea="850", bldgtype="COMMERCIAL CONDOMINIUM"),
    # Out of scope: a house, a commercial common area, a church (numeric code), a golf course.
    row(gispid="00500505", parcelid="00500505", commonpid="00500505", yearid="2026", lusecode="R100",
        landuse_description="SINGLE FAMILY RESIDENTIAL", ownrlstnme="TEOTICO", ownrfrstnme="JOSE", address="5 OAK LN CHARLOTTE NC",
        totalvalue="300000", totmarkval="300000", yearbuilt="1990", totalarea="2000"),
    row(gispid="00600606", parcelid="00600606", commonpid="00600606", yearid="2026", lusecode="C703",
        landuse_description="COMMERCIAL COMMON AREA", ownrlstnme="EXAMPLE OWNERS ASSOCIATION INC", totalvalue="0"),
    row(gispid="00700707", parcelid="00700707", commonpid="00700707", yearid="2026", lusecode="7100",
        landuse_description="CHURCH", ownrlstnme="EXAMPLE CHURCH", totalvalue="900000"),
    row(gispid="00800808", parcelid="00800808", commonpid="00800808", yearid="2026", lusecode="GC01",
        landuse_description="GOLF COURSE CLASS 1 - CHAMPIONSHIP", ownrlstnme="EXAMPLE CLUB INC", totalvalue="9000000"),
    # Affordable multifamily (code outside the A5 family) and a new commercial code not in the PDF.
    row(gispid="00900909", parcelid="00900909", commonpid="00900909", yearid="2026", lusecode="AF60",
        landuse_description="MULTI FAMILTY AFFORDABLE HOUSING", ownrlstnme="EXAMPLE HOUSING PARTNERS LP",
        mailaddr1="1 PARK AVE", mailcity="NEW YORK", state="NY", zipcode="10001", address="ABERCROMBY ST UNINC NC",
        loccity="UNINC", totalvalue="12000000", totmarkval="12000000", yearbuilt="1972", totalarea="80000", finisharea="80000",
        heatedarea="80000.000000000000000", legalacres="3.000000000000000"),
    row(gispid="01001010", parcelid="01001010", commonpid="01001010", yearid="2026", lusecode="C782",
        landuse_description="CELL TOWER", ownrlstnme="EXAMPLE TOWERS LLC", address="", totalvalue="150000", totmarkval="150000"),
]


def cama_zip(tmp: Path) -> Path:
    p = tmp / "Cama_Table.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("Cama_Table.csv", "﻿" + "\r\n".join([HEADER, *ROWS, ""]))
    return p


class Mecklenburg(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = cama_zip(self.tmp)

    def test_category_mapping(self):
        sc = nc_mecklenburg.state_category
        self.assertEqual((sc("A500"), sc("A562"), sc("AF60")), ("B", "B", "B"))
        self.assertEqual((sc("C700"), sc("C735"), sc("C782"), sc("O400"), sc("O424")), ("F1", "F1", "F1", "F1", "F1"))
        self.assertEqual((sc("I600"), sc("I628"), sc("I647")), ("F2", "F2", "F2"))
        self.assertIsNone(sc("R100"), "residential")
        self.assertIsNone(sc("R300"), "condominium")
        self.assertIsNone(sc("7100"), "institutional (numeric codes)")
        self.assertIsNone(sc("GC01"), "golf course")
        self.assertIsNone(sc("C703"), "commercial common area")
        self.assertIsNone(sc("A501"), "multifamily common area")
        self.assertIsNone(sc(""))
        self.assertIsNone(sc(None))

    def test_mapping_from_the_zip(self):
        recs = {r.apn: r for r in nc_mecklenburg.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["00100101", "00200202", "00300303", "00400404", "00900909", "01001010"])
        tower = recs["00100101"]
        self.assertEqual((tower.county_fips, tower.state_category, tower.local_use_code), ("119", "F1", "O418"))
        self.assertEqual(tower.situs_address, "100 S TRYON ST, CHARLOTTE NC")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 MAIN ST, STE 1, CHARLOTTE, NC 28202")
        self.assertEqual(tower.land_area_sf, 39988.08, "legalacres × 43560")
        self.assertEqual(tower.improvement_area_sf, 270000, "two distinct buildings: total areas summed")
        self.assertEqual(tower.year_built, 1985, "oldest building")
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (52500000, 52000000, 2026))
        self.assertEqual(tower.locator, "Cama_Table.csv parcelid 00100101")
        self.assertFalse(tower.owner_confidential)
        warehouse = recs["00200202"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.improvement_area_sf, 53098, "a repeated building row counts once")
        self.assertEqual(warehouse.situs_address, "9 FREIGHT RD, NC", "UNINC is not a city")
        self.assertEqual(warehouse.land_area_sf, 217800, "no legal acreage: the polygon acreage of a non-condo parcel")
        self.assertEqual(warehouse.owner_mailing_address, "PO BOX 9, ATLANTA, GA 30301")
        apartments = recs["00300303"]
        self.assertEqual(apartments.state_category, "B")
        self.assertIsNone(apartments.owner_name, "UNKNOWN is a placeholder")
        self.assertIsNone(apartments.owner_mailing_address)
        self.assertEqual(apartments.situs_address, "505 E 34TH ST, 201, CHARLOTTE NC 28205", "a stray ZIP is kept")
        self.assertEqual((apartments.land_area_sf, apartments.improvement_area_sf, apartments.year_built), (None, None, None),
                         "zeros are not figures")
        self.assertEqual((apartments.market_value, apartments.appraised_value), (0, 0), "a zero value is a value")
        condo = recs["00400404"]
        self.assertEqual(condo.owner_name, "BLOOM PAMELA E", "last name then first name; the registry drops persons")
        self.assertIsNone(condo.land_area_sf, "a condominium unit does not own the complex's polygon acreage")
        self.assertEqual(condo.situs_address, "2115 SOUTHEND DR, 103, CHARLOTTE NC")
        self.assertEqual((condo.improvement_area_sf, condo.year_built), (850, 2004))
        affordable = recs["00900909"]
        self.assertEqual((affordable.state_category, affordable.local_use_code), ("B", "AF60"))
        self.assertEqual(affordable.situs_address, "ABERCROMBY ST, NC")
        self.assertEqual(affordable.land_area_sf, 130680)
        tower_site = recs["01001010"]
        self.assertEqual((tower_site.state_category, tower_site.local_use_code), ("F1", "C782"), "an unlisted code follows its family")
        self.assertIsNone(tower_site.situs_address)

    def test_unpacked_directory_and_csv_read_the_same(self):
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        a = [r.apn for r in nc_mecklenburg.read_roll(self.zip)]
        self.assertEqual(a, [r.apn for r in nc_mecklenburg.read_roll(self.tmp / "unpacked")])
        self.assertEqual(a, [r.apn for r in nc_mecklenburg.read_roll(self.tmp / "unpacked" / "Cama_Table.csv")])

    def test_all_categories(self):
        self.assertEqual(len(list(nc_mecklenburg.read_roll(self.zip, categories=None))), 10)
        self.assertEqual([r.apn for r in nc_mecklenburg.read_roll(self.zip, categories=["F2"])], ["00200202"])

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = nc_mecklenburg.build(self.zip, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the condominium's natural-person owner")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'nc-mecklenburg-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("37", "119"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'meck_parcel_id' AND external_id = '00100101'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-37119:00100101")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER LLC", owner[0])
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("O418", code[0])
            person = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE subject = 'fl:parcel:us-37119:00400404' AND predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(person, 0, "natural persons are not stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
