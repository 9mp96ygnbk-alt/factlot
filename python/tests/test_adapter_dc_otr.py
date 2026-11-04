"""District of Columbia OTR adapter tests on a SYNTHETIC fixture that copies the real layout.

The headers are the Open Data DC CSV exports' (ITSPE and CAMA Commercial); every SSL, name, and
value is invented to exercise the mapping. None of it is real District data.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import dc_otr

# The real ITSPE export has about 230 columns; the fixture keeps the ones the adapter reads plus a
# few neighbours, in the publisher's order.
ITSPE_HEADER = (
    "OBJECTID,SSL,SQUARE,SUFFIX,LOT,ARN,ASRNAME,PROPTYPE,TRIGROUP,USECODE,LANDAREA,PREMISEADD,NBHD,SUBNBHD,"
    "UNITNUMBER,OWNERNAME,CAREOFNAME,ADDRESS1,ADDRESS2,CITYSTZIP,OLDLAND,OLDIMPR,OLDTOTAL,NEWLAND,NEWIMPR,"
    "NEWTOTAL,VACLNDUSE,DELCODE,HSTDCODE,CLASSTYPE,MIXEDUSE,SALEPRICE,SALEDATE,ASSESSMENT,ANNUALTAX,"
    "EXTRACTDAT,CY1YEAR,OWNNAME2"
)
ITSPE_ROWS = [
    # office tower: F1, owner an LLC, two buildings in CAMA
    '1,0100    0010,0100,,0010,,EXAMPLE A,Commercial,1,052,20000,1200 EXAMPLE ST NW,1,1A,,EXAMPLE TOWER LLC,'
    'C/O EXAMPLE MGMT,100 MAIN ST,STE 400,NEW YORK NY 10001,1000000,9000000,10000000,1100000,9900000,11000000,'
    'N,N,,2,N,25000000,2019/06/01 00:00:00+00,10000000,185000,2026/11/01 00:00:00+00,2026,',
    # apartment building: B (021), use code without leading zero in the file, owner an LP
    '2,0100E   0020,0100,E,0020,,EXAMPLE A,Residential,1,21,9000,15 EXAMPLE AVE SE,2,2B,,EXAMPLE APARTMENTS LP,,'
    'PO BOX 9,,WASHINGTON DC 20001,2000000,3000000,5000000,0,0,0,N,N,,2,N,0,,5000000,42500,'
    '2026/11/01 00:00:00+00,2026,',
    # warehouse: F2, owner a natural person (kept as a parcel, name dropped by the registry), no CAMA row
    '3,0200    0800,0200,,0800,,EXAMPLE B,Commercial,2,074,0,900 EXAMPLE RD NE,3,3C,,J EXAMPLE,,900 EXAMPLE RD NE,,'
    'WASHINGTON DC 20002,500000,700000,1200000,520000,730000,1250000,N,N,,2,N,0,,1200000,22200,'
    '2026/11/01 00:00:00+00,2026,',
    # single-family row house: out of scope
    '4,0300    0005,0300,,0005,,EXAMPLE C,Residential,3,011,1500,7 EXAMPLE PL NW,4,4A,,J EXAMPLE,,7 EXAMPLE PL NW,,'
    'WASHINGTON DC 20003,600000,300000,900000,0,0,0,N,N,1,1,N,0,,900000,7650,2026/11/01 00:00:00+00,2026,',
    # commercial condo unit with a placeholder owner and a unit number
    '5,0400    2001,0400,,2001,,EXAMPLE D,Commercial,1,058,0,500 EXAMPLE ST NW,5,5A,201,UNKNOWN,,,,,0,0,0,0,0,0,'
    'N,N,,2,N,0,,750000,13875,2026/11/01 00:00:00+00,2026,',
    # dead SSL (DELCODE Y): skipped even though its use code is commercial
    '6,0500    0001,0500,,0001,,EXAMPLE E,Commercial,1,041,3000,1 EXAMPLE WAY SW,6,6A,,EXAMPLE STORE INC,,'
    '1 EXAMPLE WAY SW,,WASHINGTON DC 20004,0,0,0,0,0,0,N,Y,,2,N,0,,0,0,2026/11/01 00:00:00+00,2026,',
    # vacant lot: out of scope
    '7,0600    0050,0600,,0050,,EXAMPLE F,Vacant,2,091,8000,0 EXAMPLE ST NE,7,7A,,EXAMPLE LAND LLC,,PO BOX 1,,'
    'WASHINGTON DC 20005,400000,0,400000,0,0,0,Y,N,,3,N,0,,400000,20000,2026/11/01 00:00:00+00,2026,',
]

CAMA_HEADER = (
    "SSL,BLDG_NUM,SECT_NUM,STRUCT_CL,STRUCT_CL_D,GRADE,GRADE_D,EXTWALL,EXTWALL_D,WALL_HGT,NUM_UNITS,SALEDATE,PRICE,"
    "QUALIFIED,AYB,YR_RMDL,EYB,SALE_NUM,LIVING_GBA,USECODE,LANDAREA,GIS_LAST_MOD_DTTM,OBJECTID"
)
CAMA_ROWS = [
    "0100    0010,1,1,2,Class C,3,Average,14,Brick,12,0,2019/06/01 00:00:00+00,25000000,Q,1985,2010,1995,1,"
    "200000,52,20000,2026/11/01 00:00:00+00,1",
    "0100    0010,2,1,2,Class C,3,Average,14,Brick,12,0,2019/06/01 00:00:00+00,25000000,Q,1990,0,1990,1,"
    "50000,52,20000,2026/11/01 00:00:00+00,2",
    "0100E   0020,1,1,3,Class D,2,Fair,14,Brick,10,24,,0,,1962,0,1975,0,30000,21,9000,2026/11/01 00:00:00+00,3",
    # a building with no figures: 0 is "no figure", not a fact
    "0400    2001,1,1,2,Class C,3,Average,14,Brick,12,0,,0,,0,0,0,0,0,58,0,2026/11/01 00:00:00+00,4",
]


def write_fixture(tmp: Path) -> tuple[Path, Path]:
    itspe = tmp / "itspe.csv"
    itspe.write_text("﻿" + "\n".join([ITSPE_HEADER, *ITSPE_ROWS, ""]), encoding="utf-8")
    cama = tmp / "cama_commercial.csv"
    cama.write_text("\n".join([CAMA_HEADER, *CAMA_ROWS, ""]), encoding="utf-8")
    return itspe, cama


class UseCodes(unittest.TestCase):
    def test_category_mapping(self):
        self.assertEqual(dc_otr.state_category("021"), "B", "apartment walk-up")
        self.assertEqual(dc_otr.state_category("21"), "B", "the CAMA file writes the code as a number")
        self.assertEqual(dc_otr.state_category("21.0"), "B")
        self.assertEqual(dc_otr.state_category("022"), "B", "apartment elevator")
        self.assertEqual(dc_otr.state_category("027"), "B", "cooperative")
        self.assertEqual(dc_otr.state_category("052"), "F1", "office large")
        self.assertEqual(dc_otr.state_category("032"), "F1", "hotel large")
        self.assertEqual(dc_otr.state_category("048"), "F1", "commercial retail condo")
        self.assertEqual(dc_otr.state_category("085"), "F1", "embassy: the publisher's commercial class")
        self.assertEqual(dc_otr.state_category("074"), "F2", "warehouse")
        self.assertEqual(dc_otr.state_category("007"), "F2", "industrial, non-conforming use")
        for code in ("011", "012", "016", "017", "023", "024", "091", "096", "116", "214", "995", "000", ""):
            self.assertIsNone(dc_otr.state_category(code), code)
        self.assertIsNone(dc_otr.state_category(None))

    def test_use_code_normalisation(self):
        self.assertEqual(dc_otr.use_code(" 21 "), "021")
        self.assertEqual(dc_otr.use_code("021"), "021")
        self.assertEqual(dc_otr.use_code("995"), "995")
        self.assertIsNone(dc_otr.use_code(""))

    def test_ssl_key(self):
        self.assertEqual(dc_otr.ssl_key("0100    0010"), "01000010")
        self.assertEqual(dc_otr.ssl_key("0100E   0020"), "0100E0020")


class Roll(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.itspe, self.cama = write_fixture(self.tmp)

    def test_mapping_with_cama(self):
        recs = {r.apn: r for r in dc_otr.read_roll(self.itspe, cama_path=self.cama)}
        self.assertEqual(sorted(recs), ["0100 0010", "0100E 0020", "0200 0800", "0400 2001"],
                         "commercial scope: F1, B, F2 kept; single-family, vacant, and dead SSLs dropped")
        tower = recs["0100 0010"]
        self.assertEqual((tower.county_fips, tower.account, tower.state_category, tower.local_use_code),
                         ("001", "0100 0010", "F1", "052"))
        self.assertEqual(tower.situs_address, "1200 EXAMPLE ST NW, WASHINGTON DC")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 MAIN ST, STE 400, NEW YORK NY 10001")
        self.assertFalse(tower.owner_confidential)
        self.assertEqual(tower.land_area_sf, 20000)
        self.assertEqual(tower.improvement_area_sf, 250000, "gross building area summed over the SSL's buildings")
        self.assertEqual(tower.year_built, 1985, "earliest year built across the buildings")
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (10000000, 11000000, 2026))
        self.assertEqual(tower.locator, "ITSPE SSL 0100 0010")
        apartments = recs["0100E 0020"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "021"),
                         "a use code written without its leading zero is still the publisher's three-digit code")
        self.assertEqual(apartments.owner_mailing_address, "PO BOX 9, WASHINGTON DC 20001")
        self.assertEqual((apartments.improvement_area_sf, apartments.year_built), (30000, 1962))
        self.assertIsNone(apartments.appraised_value, "NEWTOTAL 0 is 'no figure', not a value")
        warehouse = recs["0200 0800"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.owner_name, "J EXAMPLE", "the adapter passes persons through; the registry drops them")
        self.assertIsNone(warehouse.land_area_sf, "LANDAREA 0 is 'no figure'")
        self.assertIsNone(warehouse.improvement_area_sf, "no CAMA row")
        self.assertIsNone(warehouse.year_built)
        condo = recs["0400 2001"]
        self.assertEqual(condo.situs_address, "500 EXAMPLE ST NW UNIT 201, WASHINGTON DC")
        self.assertIsNone(condo.owner_name, "'UNKNOWN' is a placeholder, not an owner")
        self.assertIsNone(condo.owner_mailing_address)
        self.assertIsNone(condo.improvement_area_sf, "a CAMA row with 0 sf adds nothing")
        self.assertIsNone(condo.year_built)
        self.assertEqual(condo.market_value, 750000)

    def test_without_cama(self):
        recs = {r.apn: r for r in dc_otr.read_roll(self.itspe)}
        self.assertEqual(len(recs), 4)
        self.assertIsNone(recs["0100 0010"].improvement_area_sf)
        self.assertIsNone(recs["0100 0010"].year_built)

    def test_all_categories(self):
        recs = {r.apn: r for r in dc_otr.read_roll(self.itspe, categories=None)}
        self.assertEqual(len(recs), 6, "every live SSL; only the dead one is skipped")
        self.assertIsNone(recs["0300 0005"].state_category)
        self.assertEqual(recs["0300 0005"].local_use_code, "011")
        only_b = {r.apn for r in dc_otr.read_roll(self.itspe, categories=["B"])}
        self.assertEqual(only_b, {"0100E 0020"})

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = dc_otr.build(self.itspe, db, as_of="2026-11-02", cama_path=self.cama)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (4, 4, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the warehouse's natural-person owner is not stored")
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'dc_ssl' AND external_id = '0100 0010'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-11001:01000010")
            facts = {row["predicate"]: row["value_json"] for row in reg.db.execute(
                "SELECT predicate, value_json FROM current_facts WHERE subject = ?", (urn,))}
            self.assertEqual(facts["parcel.state_property_category"], '"F1"')
            self.assertEqual(facts["parcel.local_use_code"], '"052"')
            self.assertEqual(facts["ownership.owner_of_record"], '"EXAMPLE TOWER LLC"')
            self.assertEqual(facts["parcel.improvement_area_sf"], "250000.0")
            source = reg.db.execute("SELECT license, redistribution FROM sources WHERE source_id = 'dc-otr-real-property'").fetchone()
            self.assertIn("CC-BY-4.0", source["license"])
            self.assertEqual(source["redistribution"], "attribution_required")
            warehouse = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE subject = 'fl:parcel:us-11001:02000800' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(warehouse, 0, "a natural person's name is never stored")
        finally:
            reg.close()


class Sales(unittest.TestCase):
    """The most recent sale ITSPE records on an SSL becomes a transaction.sale fact; no parties, no arm's-length claim."""

    def test_sale_of(self):
        row = {"SALEPRICE": "25000000", "SALEDATE": "2019/06/01 00:00:00+00", "ACCEPTCODE": "Market Sale",
               "SALETYPE": "Improved"}
        self.assertEqual(dc_otr.sale_of(row), {"date": "2019-06-01", "price_usd": 25_000_000,
                                               "acceptance_code": "Market Sale", "sale_type": "Improved"})
        # The publisher's code is kept verbatim; nothing is called arm's length.
        self.assertNotIn("arms_length", dc_otr.sale_of(row))
        self.assertEqual(dc_otr.sale_of({"SALEPRICE": "0", "SALEDATE": "2021/05/04", "ACCEPTCODE": "Buyer = Seller"}),
                         {"date": "2021-05-04", "price_usd": 0, "acceptance_code": "Buyer = Seller"})

    def test_blank_and_placeholder_sales_are_not_facts(self):
        self.assertIsNone(dc_otr.sale_of({"SALEPRICE": "", "SALEDATE": ""}))
        self.assertIsNone(dc_otr.sale_of({"SALEPRICE": "500000", "SALEDATE": "1900/01/01 05:00:00+00"}))
        self.assertIsNone(dc_otr.sale_of({"SALEPRICE": "", "SALEDATE": "2020/01/01"}))
        self.assertIsNone(dc_otr.sale_of({"SALEPRICE": "100", "SALEDATE": "2020/13/45"}))
        self.assertIsNone(dc_otr.sale_of({"SALEPRICE": "-5", "SALEDATE": "2020/01/01"}))

    def test_roll_ingest_writes_the_sale_with_the_roll_citation(self):
        with tempfile.TemporaryDirectory() as d:
            itspe, cama = write_fixture(Path(d))
            db = Path(d) / "r.db"
            dc_otr.build(itspe, db, as_of="2026-11-02", cama_path=cama)
            reg = Registry.open_readonly(db)
            try:
                sales = [f for f in reg.facts("fl:parcel:us-11001:01000010") if f["predicate"] == "transaction.sale"]
                self.assertEqual(len(sales), 1)
                self.assertEqual(sales[0]["value"], {"date": "2019-06-01", "price_usd": 25_000_000})
                self.assertEqual(sales[0]["provenance"]["sources"][0]["section"], "ITSPE SSL 0100 0010")
                self.assertEqual(sales[0]["provenance"]["method"], "public_record")
                self.assertEqual(sales[0]["rights"]["redistribution"], "attribution_required")
            finally:
                reg.close()


if __name__ == "__main__":
    unittest.main()
