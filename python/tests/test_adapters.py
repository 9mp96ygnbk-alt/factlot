"""Source-adapter tests on SYNTHETIC fixtures that copy each publisher's real layout.

Every account, name, and value here is invented to exercise the mapping; none is real Texas data.
"""

import io
import re
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_comptroller, tx_dallas, tx_harris, tx_tarrant

HARRIS_REAL_ACCT_HEADER = (
    "acct\tyr\tmailto\tmail_addr_1\tmail_addr_2\tmail_city\tmail_state\tmail_zip\tmail_country\tsite_addr_1\t"
    "site_addr_2\tsite_addr_3\tstate_class\tyr_impr\tbld_ar\tland_ar\tacreage\ttot_appr_val\ttot_mkt_val\t"
    "Neighborhood_Code"
)
HARRIS_REAL_ACCT_ROWS = [
    # acct, yr, mailto, mail1, mail2, city, st, zip, country, site1, site2, site3, class, yr_impr, bld_ar, land_ar, acreage, appr, mkt,
    # Neighborhood_Code
    "0010010000001            \t2026\tEXAMPLE TOWER LLC\t100 MAIN ST STE 1\t \tHOUSTON\tTX\t77002\t \t100 MAIN ST\tHOUSTON\t77002\tF1\t1985\t250000\t40000\t0.9183\t50000000\t52000000\t8300.01",
    "0010010000002            \t2026\tCURRENT OWNER\tPO BOX 9\t \tHOUSTON\tTX\t77001\t \t0 ELM ST\tHOUSTON\t77003\tF1\t\t0\t0\t0.5000\t900000\t900000\t ",
    "0010010000003            \t2026\tJ EXAMPLE\t5 OAK LN\t \tHOUSTON\tTX\t77004\t \t5 OAK LN\tHOUSTON\t77004\tA1\t1990\t2000\t7000\t0.1607\t300000\t300000\t1.00",
    "0010010000004            \t2026\tEXAMPLE APARTMENTS LP\t1 PARK AVE\tFLOOR 2\tNEW YORK\tNY\t10001\t \t900 RIVER RD\tHOUSTON\t77005\tB1\t2005\t180000\t90000\t2.0661\t30000000\t31000000\t 6001.02 ",
    "0010010000005            \t2026\tCONFIDENTIAL\t \t \t \t \t \t \t7 SHIELD ST\tHOUSTON\t77006\tF1\t2000\t5000\t8000\t0.1837\t1000000\t1000000\t0.00",
]
HARRIS_NEIGHBORHOOD_ROWS = ["cd\tgrp_cd\tdscr", "1.00\t4326\tEXAMPLE VILLAGE", "6001.02\t6001\tEXAMPLE RIVER",
                            "8300.01\t8300\tEXAMPLE DOWNTOWN"]
HARRIS_OWNERS_HEADER = "acct\tln_num\tname\taka\tpct_own"
HARRIS_OWNERS_ROWS = [
    "0010010000001\t1\tEXAMPLE TOWER LLC\t \t1.0000",
    "0010010000002\t1\tCURRENT OWNER\t \t1.0000",
    "0010010000003\t1\tJ EXAMPLE\t \t1.0000",
    "0010010000004\t1\tEXAMPLE APARTMENTS LP\t \t0.9000",
    "0010010000004\t2\tEXAMPLE GP INC\t \t0.1000",
    "0010010000005\t1\tCONFIDENTIAL\t \t1.0000",
]


HARRIS_BUILDING_HEADER = "acct\tproperty_use_cd\tbld_num\timpr_tp\tstructure\tstructure_dscr\tqa_cd\tdscr\tdate_erected\tim_sq_ft"
HARRIS_BUILDING_OTHER_ROWS = [
    # The tower: two sections of building 1 and a smaller building 2; the largest section is masonry (C).
    "0010010000001            \tF1\t1\t4353\tD  \tWood or Light Steel\tC \tAverage\t1985\t1000",
    "0010010000001            \tF1\t1\t4354\tC  \tMasonry Bearing\tA \tExcellent\t1985\t240000",
    "0010010000001            \tF1\t2\t4354\tA  \tFireproofed Steel\tA \tExcellent\t1999\t5000",
    # The apartments: a commercial row with no class is skipped, so the residential file decides.
    "0010010000004            \tB1\t1\t4670\t   \t \tC \tAverage\t2005\t90000",
    # The withheld owner's property: two equal sections; the first in the file wins.
    "0010010000005            \tF1\t1\t4327\tS  \tOpen Steel Skeleton\tD \tLow\t2000\t2500",
    "0010010000005            \tF1\t2\t4327\tD  \tWood or Light Steel\tD \tLow\t2000\t2500",
]
HARRIS_BUILDING_RES_ROWS = [
    "0010010000004            \tB1\t1\t1001\tR  \tResidential\tB \tGood\t2005\t180000",
    # The house (A1) is not a registry parcel.
    "0010010000003            \tA1\t1\t1001\tR  \tResidential\tB \tGood\t1990\t2000",
]


def harris_buildings_zip(tmp: Path) -> Path:
    p = tmp / "Real_building_land.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("building_other.txt", "\r\n".join([HARRIS_BUILDING_HEADER, *HARRIS_BUILDING_OTHER_ROWS, ""]))
        zf.writestr("building_res.txt", "\r\n".join([HARRIS_BUILDING_HEADER, *HARRIS_BUILDING_RES_ROWS, ""]))
        zf.writestr("land.txt", "acct\tnum\r\n")
    return p


def harris_zip(tmp: Path) -> Path:
    p = tmp / "Real_acct_owner.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("real_acct.txt", "\r\n".join([HARRIS_REAL_ACCT_HEADER, *HARRIS_REAL_ACCT_ROWS, ""]))
        zf.writestr("owners.txt", "\r\n".join([HARRIS_OWNERS_HEADER, *HARRIS_OWNERS_ROWS, ""]))
        zf.writestr("deeds.txt", "acct\tdos\tclerk_yr\tclerk_id\tdeed_id\r\n")
        zf.writestr("real_neighborhood_code.txt", "\r\n".join([*HARRIS_NEIGHBORHOOD_ROWS, ""]))
    return p


class Harris(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = harris_zip(self.tmp)

    def test_mapping_from_the_zip(self):
        recs = {r.apn: r for r in tx_harris.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["0010010000001", "0010010000002", "0010010000004", "0010010000005"],
                         "commercial scope: F1 and the B1 subclass kept, A1 dropped; account padding stripped")
        tower = recs["0010010000001"]
        self.assertEqual(tower.county_fips, "201")
        self.assertEqual(tower.situs_address, "100 MAIN ST, HOUSTON TX 77002")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 MAIN ST STE 1, HOUSTON, TX 77002")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 250000, 1985))
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (52000000, 50000000, 2026))
        self.assertEqual(tower.locator, "real_acct.txt acct 0010010000001")
        placeholder = recs["0010010000002"]
        self.assertIsNone(placeholder.owner_name, "'CURRENT OWNER' is a placeholder, not an owner")
        self.assertFalse(placeholder.owner_confidential)
        self.assertIsNone(placeholder.improvement_area_sf, "0 sf is 'no figure', not a fact")
        self.assertEqual(placeholder.land_area_sf, 21780.0, "land_ar 0 falls back to acreage × 43560")
        self.assertIsNone(placeholder.year_built)
        apartments = recs["0010010000004"]
        self.assertEqual(apartments.owner_name, "EXAMPLE APARTMENTS LP", "owner line 1 wins")
        self.assertEqual(apartments.owner_mailing_address, "1 PARK AVE, FLOOR 2, NEW YORK, NY 10001")
        withheld = recs["0010010000005"]
        self.assertTrue(withheld.owner_confidential)
        self.assertIsNone(withheld.owner_name)
        self.assertIsNone(withheld.owner_mailing_address)

    def test_neighborhood_code(self):
        recs = {r.apn: r for r in tx_harris.read_roll(self.zip)}
        self.assertEqual(recs["0010010000001"].extra_facts, [("parcel.neighborhood_code", "8300.01", None)])
        self.assertEqual(recs["0010010000004"].extra_facts, [("parcel.neighborhood_code", "6001.02", None)],
                         "padding is not part of the code")
        self.assertEqual(recs["0010010000002"].extra_facts, [], "blank is no code")
        self.assertEqual(recs["0010010000005"].extra_facts, [], "0.00 is not a listed neighborhood")

    def test_building_classes(self):
        facts = {f.apn: f for f in tx_harris.read_building_classes(harris_buildings_zip(self.tmp))}
        classes = {apn: f.facts for apn, f in facts.items()}
        self.assertEqual(classes["0010010000001"], [("parcel.building_class", "C", None)], "the largest section")
        self.assertEqual(facts["0010010000001"].locator, "building_other.txt acct 0010010000001 bld_num 1")
        self.assertEqual(classes["0010010000004"], [("parcel.building_class", "R", None)],
                         "no classed commercial row: the residential file")
        self.assertEqual(facts["0010010000004"].locator, "building_res.txt acct 0010010000004 bld_num 1")
        self.assertEqual(classes["0010010000005"], [("parcel.building_class", "S", None)], "a tie keeps the first")
        self.assertNotIn("0010010000002", classes, "no building, no class")
        only = {f.apn for f in tx_harris.read_building_classes(harris_buildings_zip(self.tmp), ["0010010000001"])}
        self.assertEqual(only, {"0010010000001"})

    def test_build_building_classes_cites_the_buildings_file(self):
        db = self.tmp / "registry.db"
        tx_harris.build(self.zip, db, as_of="2026-11-01")
        bzip = harris_buildings_zip(self.tmp)
        stats = tx_harris.build_buildings(bzip, db, as_of="2026-11-01", tax_year=2026)
        self.assertEqual((stats.kept, stats.skipped_out_of_scope, stats.source_id), (3, 0, "tx-harris-cad-buildings"),
                         "the house is never read: it is not a registry parcel")
        reg = Registry.open_readonly(db)
        try:
            row = reg.db.execute(
                "SELECT f.value_json, s.source_id, s.filename FROM current_facts f JOIN snapshots s USING (document_id) "
                "WHERE f.subject = 'fl:parcel:us-48201:0010010000001' AND f.predicate = 'parcel.building_class'").fetchone()
            self.assertEqual(tuple(row), ('"C"', "tx-harris-cad-buildings", "Real_building_land.zip"))
            nbhd = reg.db.execute(
                "SELECT f.value_json, s.source_id FROM current_facts f JOIN snapshots s USING (document_id) "
                "WHERE f.subject = 'fl:parcel:us-48201:0010010000001' AND f.predicate = 'parcel.neighborhood_code'").fetchone()
            self.assertEqual(tuple(nbhd), ('"8300.01"', "tx-harris-cad"))
        finally:
            reg.close()
        self.assertEqual(tx_harris.build_buildings(bzip, db, as_of="2026-11-01", tax_year=2027).source_id,
                         "tx-harris-cad-buildings-2027", "another tax year is its own source, as for the roll")

    def test_unpacked_directory_reads_the_same(self):
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        a = [r.apn for r in tx_harris.read_roll(self.zip)]
        b = [r.apn for r in tx_harris.read_roll(self.tmp / "unpacked")]
        self.assertEqual(a, b)

    def test_all_categories(self):
        self.assertEqual(len(list(tx_harris.read_roll(self.zip, categories=None))), 5)
        self.assertEqual([r.apn for r in tx_harris.read_roll(self.zip, categories=["A1"])], ["0010010000003"])

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = tx_harris.build(self.zip, db, as_of="2026-11-01")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (4, 4, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the withheld owner; placeholders are not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-harris-cad'").fetchone()
            self.assertEqual(src["county_fips"], "201")
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'hcad_account' AND external_id = '0010010000001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48201:0010010000001")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER LLC", owner[0])
        finally:
            reg.close()



class RollSource(unittest.TestCase):
    def test_one_source_per_tax_year(self):
        from factlot.registry.store import ROLL_BASE_TAX_YEAR, ParcelRecord, roll_source, roll_tax_year
        src = tx_dallas.SOURCE
        self.assertIs(roll_source(src, ROLL_BASE_TAX_YEAR), src, "the base year keeps the id the roll was loaded under")
        self.assertIs(roll_source(src, None), src)
        nxt = roll_source(src, 2027)
        self.assertEqual((nxt.source_id, nxt.county_fips, nxt.license), ("tx-dallas-cad-2027", src.county_fips, src.license))
        self.assertIn("tax year 2027", nxt.title)
        self.assertIs(roll_source(src, 2027, base_year=2027), src, "a source first loaded for 2027 keeps its id for 2027")
        self.assertEqual(roll_source(src, 2026, base_year=2027).source_id, "tx-dallas-cad-2026")
        recs = [ParcelRecord(county_fips="113", apn=str(i), tax_year=y) for i, y in enumerate((2026, 2027, 2026, None))]
        year, kept = roll_tax_year(iter(recs))
        self.assertEqual((year, len(kept)), (2026, 4), "the year most records state; every record kept")

COMPTROLLER_HEADER = (
    '"Taxpayer Number","Taxpayer Name","Taxpayer Address","Taxpayer City","Taxpayer State","Taxpayer Zip",'
    '"Taxpayer County Code","Taxpayer Organizational Type","Record Type Code","Responsibility Beginning Date",'
    '"  Secretary of State (SOS) or COA File Number","SOS Charter Date","SOS Status Date ","SOS Status Code",'
    '"Right to Transact Business Code","Current Exempt Reason Code","Exempt Begin Date","NAICS Code"'
)
COMPTROLLER_ROWS = [
    '"32000000001","EXAMPLE TOWER LLC","100 MAIN ST STE 1","HOUSTON","TX","77002","101","CL","U","2010-01-01T00:00:00.000",'
    '"0801111111","2010-01-01T00:00:00.000","2010-01-01T00:00:00.000","A","A","00","","531110"',
    '"32000000002","OUT OF STATE HOLDINGS INC","1 PARK AVE","NEW YORK","NY","10001","","CF","V","2015-06-01T00:00:00.000",'
    '"0802222222","2015-06-01T00:00:00.000","2020-01-01T00:00:00.000","F","N","00","","531120"',
    '"32000000003","J EXAMPLE DBA EXAMPLE SHOP","5 OAK LN","HOUSTON","TX","77004","101","S","X","2018-01-01T00:00:00.000",'
    '"","","","","A","00","",""',
]


class Comptroller(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "export.csv"
        self.csv.write_text("\n".join([COMPTROLLER_HEADER, *COMPTROLLER_ROWS, ""]))

    def test_mapping(self):
        recs = list(tx_comptroller.read_entities(self.csv))
        self.assertEqual(len(recs), 3)
        texas, foreign, sole = recs
        self.assertEqual((texas.legal_name, texas.registry_number, texas.taxpayer_number), ("EXAMPLE TOWER LLC", "0801111111", "32000000001"))
        self.assertEqual((texas.registry_jurisdiction, texas.state_of_formation, texas.status), ("us-tx", "TX", "active"))
        self.assertEqual(texas.mailing_address, "100 MAIN ST STE 1, HOUSTON, TX 77002")
        self.assertEqual(texas.locator, "export.csv taxpayer 32000000001")
        self.assertEqual((foreign.registry_number, foreign.state_of_formation, foreign.status), ("0802222222", None, "forfeited_franchise_tax"),
                         "a certificate of authority is a registry number; a foreign type says nothing about the state of formation")
        self.assertIsNone(sole.registry_number, "a Comptroller-assigned number (record type X) is not a registry number")
        self.assertIsNone(sole.status)

    def test_build_links_owners_to_entities(self):
        db = self.tmp / "registry.db"
        tx_harris.build(harris_zip(self.tmp), db, as_of="2026-11-01")
        stats, links = tx_comptroller.build(self.csv, db, as_of="2026-10-31")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (3, 2, 1))
        self.assertEqual(links.get("linked"), 1, links)
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'us-tx-taxpayer' AND external_id = '32000000001'").fetchone()[0]
            self.assertEqual(urn, "fl:entity:us-tx:0801111111")
            owned = reg.db.execute("SELECT to_urn FROM relationships WHERE type = 'owns' AND from_urn = ?", (urn,)).fetchall()
            self.assertEqual([r[0] for r in owned], ["fl:parcel:us-48201:0010010000001"])
        finally:
            reg.close()


DALLAS = {
    "ACCOUNT_APPRL_YEAR.CSV": [
        '"ACCOUNT_NUM","APPRAISAL_YR","IMPR_VAL","LAND_VAL","TOT_VAL","DIVISION_CD","BLDG_CLASS_CD","SPTD_CODE"',
        '"00000100001000000","2026","4000000.00","1000000.00","5000000.00","COM","OFFICE BUILDING","F10"',
        '"00000100002000000","2026","0.00","300000.00","300000.00","COM","UNASSIGNED","C12"',
        '"00000100003000000","2026","900000.00","100000.00","1000000.00","RES","14","B11"',
        '"00000100004000000","2026","50000.00","0.00","50000.00","BPP","","F10"',
        '"00000100005000000","2026","2000000.00","500000.00","2500000.00","COM","UNASSIGNED","F20"',
    ],
    "ACCOUNT_INFO.CSV": [
        '"ACCOUNT_NUM","APPRAISAL_YR","DIVISION_CD","OWNER_NAME1","OWNER_NAME2","EXCLUDE_OWNER","OWNER_ADDRESS_LINE1",'
        '"OWNER_ADDRESS_LINE2","OWNER_ADDRESS_LINE3","OWNER_ADDRESS_LINE4","OWNER_CITY","OWNER_STATE","OWNER_ZIPCODE",'
        '"OWNER_COUNTRY","STREET_NUM","STREET_HALF_NUM","FULL_STREET_NAME","BLDG_ID","UNIT_ID","PROPERTY_CITY","PROPERTY_ZIPCODE",'
        '"NBHD_CD","LMA","IMA"',
        '"00000100001000000","2026","COM","EXAMPLE PLAZA LP","C/O EXAMPLE MGMT","N","","PO BOX 100","","","DALLAS","TEXAS",'
        '"752010100","UNITED STATES OF AMERICA","1500","","MAIN ST","","","DALLAS","75201","UNASSIGNED","120000","112000"',
        '"00000100002000000","2026","COM","VACANT LOT LLC","","N","1 LOT ST","","","","DALLAS","TEXAS","75201","","0","","ELM ST","","","DALLAS","75201",'
        '"UNASSIGNED","120000","UNASSIGNED"',
        '"00000100003000000","2026","RES","EXAMPLE DUPLEX LLC","","N","2 OAK ST","","","","DALLAS","TEXAS","75202","","200","1/2","OAK ST","","B","DALLAS","75202",'
        '"3YSS26","UNASSIGNED","UNASSIGNED"',
        '"00000100004000000","2026","BPP","EXAMPLE SHOP INC","","N","","","","","","","","","1500","","MAIN ST","","","DALLAS","75201","","",""',
        '"00000100005000000","2026","COM","WITHHELD PERSON","","Y","9 SHIELD RD","","","","DALLAS","TEXAS","75203","","9","","SHIELD RD","","","DALLAS","75203",'
        '"1HS204","130000","UNASSIGNED"',
    ],
    "LAND.CSV": [
        '"ACCOUNT_NUM","APPRAISAL_YR","SECTION_NUM","SPTD_CD","AREA_SIZE","AREA_UOM_DESC"',
        '"00000100001000000","2026","1","F10","30000.000","SQUARE FEET"',
        '"00000100001000000","2026","2","F10","10000.000","SQUARE FEET"',
        '"00000100003000000","2026","1","B11","0.250","ACRES"',
        '"00000100005000000","2026","1","F20","0","SQUARE FEET"',
    ],
    "COM_DETAIL.CSV": [
        '"TAX_OBJ_ID","ACCOUNT_NUM","APPRAISAL_YR","BLDG_CLASS_DESC","YEAR_BUILT","GROSS_BLDG_AREA"',
        '"00000100001000001","00000100001000000","2026","OFFICE","1985","120000"',
        '"00000100001000002","00000100001000000","2026","OFFICE","1999","30000"',
        '"00000100005000001","00000100005000000","2026","WAREHOUSE","0","0"',
    ],
    "RES_DETAIL.CSV": [
        '"ACCOUNT_NUM","APPRAISAL_YR","TAX_OBJ_ID","YR_BUILT","TOT_MAIN_SF"',
        '"00000100003000000","2026","00000100003000000","1960","2400"',
    ],
}


def dallas_zip(tmp: Path, year: int = 2026, values: bool = True, drop: str | None = None) -> Path:
    """The fixture export; another ``year`` relabels every row, ``values=False`` zeroes the values (as in
    DCAD's next-year working file), ``drop`` leaves one account out."""
    p = tmp / f"DCAD{year}_CURRENT{'' if values else '_ZERO'}{'_' + drop if drop else ''}.ZIP"
    with zipfile.ZipFile(p, "w") as zf:
        for name, lines in DALLAS.items():
            rows = [ln.replace('"2026"', f'"{year}"') for ln in lines if not (drop and ln.startswith(f'"{drop}"'))]
            if not values and name == "ACCOUNT_APPRL_YEAR.CSV":
                rows = [rows[0]] + [re.sub(r'"[0-9]+\.00"', '".00"', ln) for ln in rows[1:]]
            zf.writestr(name, "\r\n".join([*rows, ""]))
    return p


class Dallas(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = dallas_zip(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in tx_dallas.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["00000100001000000", "00000100003000000", "00000100005000000"],
                         "F10, B11, F20 kept; C12 and business personal property dropped")
        plaza = recs["00000100001000000"]
        self.assertEqual(plaza.county_fips, "113")
        self.assertEqual(plaza.situs_address, "1500 MAIN ST, DALLAS TX 75201")
        self.assertEqual(plaza.owner_name, "EXAMPLE PLAZA LP C/O EXAMPLE MGMT")
        self.assertEqual(plaza.owner_mailing_address, "PO BOX 100, DALLAS, TEXAS 752010100")
        self.assertEqual((plaza.land_area_sf, plaza.improvement_area_sf, plaza.year_built), (40000, 150000, 1985),
                         "land sections and buildings are summed; the oldest building dates the parcel")
        self.assertEqual((plaza.market_value, plaza.appraised_value, plaza.tax_year), (5000000, None, 2026))
        self.assertEqual(plaza.state_category, "F10")
        duplex = recs["00000100003000000"]
        self.assertEqual(duplex.situs_address, "200 1/2 OAK ST B, DALLAS TX 75202")
        self.assertEqual((duplex.land_area_sf, duplex.improvement_area_sf, duplex.year_built), (10890, 2400, 1960),
                         "acres convert to square feet; residential detail covers small multifamily")
        withheld = recs["00000100005000000"]
        self.assertTrue(withheld.owner_confidential)
        self.assertIsNone(withheld.owner_name)
        self.assertIsNone(withheld.owner_mailing_address)
        self.assertEqual((withheld.land_area_sf, withheld.improvement_area_sf, withheld.year_built), (None, None, None),
                         "zeros are not figures")

    def test_neighborhood_and_building_class(self):
        recs = {r.apn: dict(((p, v) for p, v, _u in r.extra_facts)) for r in tx_dallas.read_roll(self.zip)}
        self.assertEqual(recs["00000100001000000"], {"parcel.neighborhood_code": "112000", "parcel.building_class": "OFFICE BUILDING"},
                         "a commercial account's market area is IMA")
        self.assertEqual(recs["00000100003000000"], {"parcel.neighborhood_code": "3YSS26", "parcel.building_class": "14"},
                         "a residential-division account's is NBHD_CD")
        self.assertEqual(recs["00000100005000000"], {}, "UNASSIGNED is DCAD's blank; NBHD_CD is not read on a commercial account")

    def test_zero_values_are_not_values(self):
        recs = {r.apn: r for r in tx_dallas.read_roll(dallas_zip(self.tmp, 2027, values=False))}
        self.assertEqual({r.market_value for r in recs.values()}, {None})
        self.assertEqual({r.tax_year for r in recs.values()}, {2027})

    def test_next_year_file_does_not_retire_this_years_roll(self):
        db = self.tmp / "registry.db"
        urn = "fl:parcel:us-48113:00000100001000000"
        first = tx_dallas.build(self.zip, db, as_of="2026-10-12")
        later = tx_dallas.build(dallas_zip(self.tmp, 2027, values=False), db, as_of="2026-11-02")
        self.assertEqual((first.source_id, later.source_id), ("tx-dallas-cad", "tx-dallas-cad-2027"))
        self.assertEqual(later.retired, 0)
        reg = Registry.open_readonly(db)
        try:
            current = reg.db.execute(
                "SELECT f.predicate, f.value_json, s.source_id FROM current_facts f JOIN snapshots s USING (document_id) "
                "WHERE f.subject = ? AND f.predicate IN ('parcel.market_value', 'parcel.tax_year') ORDER BY 1, 3",
                (urn,)).fetchall()
            self.assertEqual([tuple(r) for r in current],
                             [("parcel.market_value", "5000000.0", "tx-dallas-cad"),
                              ("parcel.tax_year", "2026", "tx-dallas-cad"), ("parcel.tax_year", "2027", "tx-dallas-cad-2027")],
                             "the certified 2026 value stays current; the 2027 file has no value to state yet")
            self.assertEqual(reg.status(urn), "current")
        finally:
            reg.close()
        # Within one tax year a newer file still replaces the older one and retires what it no longer lists.
        again = tx_dallas.build(dallas_zip(self.tmp, 2026, drop="00000100005000000"), db, as_of="2026-11-09")
        self.assertEqual((again.source_id, again.retired), ("tx-dallas-cad", 1))
        reg = Registry.open_readonly(db)
        try:
            sources = reg.db.execute(
                "SELECT DISTINCT s.source_id FROM current_facts f JOIN snapshots s USING (document_id) WHERE f.subject = ?",
                ("fl:parcel:us-48113:00000100005000000",)).fetchall()
            self.assertEqual([r[0] for r in sources], ["tx-dallas-cad-2027"],
                             "its 2026 facts are history; the 2027 file still lists the account")
        finally:
            reg.close()

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = tx_dallas.build(self.zip, db, as_of="2026-10-12")
        self.assertEqual((stats.seen, stats.kept, stats.owners_person_or_withheld), (3, 3, 1))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'dcad_account' AND external_id = '00000100001000000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48113:00000100001000000")
        finally:
            reg.close()


# The 58-column header of PropertyData(Delimited).txt, as published (2026 certified files).
TARRANT_HEADER = (
    "RP|Appraisal_Year|Account_Num|Record_Type|Sequence_No|PIDN|Owner_Name|Owner_Address|Owner_CityState|Owner_Zip|"
    "Owner_Zip4|Owner_CRRT|Situs_Address|Property_Class|TAD_Map|MAPSCO|Exemption_Code|State_Use_Code|LegalDescription|"
    "Notice_Date|County|City|School|Num_Special_Dist|Spec1|Spec2|Spec3|Spec4|Spec5|Deed_Date|Deed_Book|Deed_Page|"
    "Land_Value|Improvement_Value|Total_Value|Garage_Capacity|Num_Bedrooms|Num_Bathrooms|Year_Built|Living_Area|"
    "Swimming_Pool_Ind|ARB_Indicator|Ag_Code|Land_Acres|Land_SqFt|Ag_Acres|Ag_Value|Central_Heat_Ind|Central_Air_Ind|"
    "Structure_Count|From_Accts|Appraisal_Date|Appraised_Value|GIS_Link|Instrument_No|Overlap_Flag|Gross_Building_Area|"
    "Total_Net_Rentable_Area"
)
TARRANT_COLUMNS = TARRANT_HEADER.split("|")


def tarrant_row(**fields: str) -> str:
    """One pipe-delimited row with the file's usual blanks and zeros where a value is not given."""
    r = {c: "" for c in TARRANT_COLUMNS}
    r.update(RP="C", Appraisal_Year="2026", County="220", City="026", Appraisal_Date="2026-01-01",
             Deed_Date="1900-12-31", Deed_Book="0000000", Deed_Page="0000000", Land_Value="0", Improvement_Value="0",
             Total_Value="0", Year_Built="0", Swimming_Pool_Ind="N", Land_Acres="0.0000", Land_SqFt="0.00",
             Ag_Value="0", Appraised_Value="0", Instrument_No="00000000000000", Gross_Building_Area="0.00",
             Total_Net_Rentable_Area="0.00")
    r.update(fields)
    r.setdefault("Property_Class", r["State_Use_Code"])
    r["Property_Class"] = r["Property_Class"] or r["State_Use_Code"]
    return "|".join(r[c] for c in TARRANT_COLUMNS)


TARRANT_ROWS = [
    # An office tower with two deed records: the row repeats, only the instrument differs.
    tarrant_row(Account_Num="1001", PIDN="10001----1----1", Owner_Name="EXAMPLE TOWER LLC",
                Owner_Address="100 MAIN ST STE 1", Owner_CityState="FORT WORTH ,  TX", Owner_Zip="76102-6311",
                Owner_Zip4="6311", Situs_Address="100 E MAIN ST", State_Use_Code="F1", Land_Value="10000000",
                Improvement_Value="40000000", Total_Value="50000000", Year_Built="1985", Living_Area="250000",
                Land_Acres="0.9183", Land_SqFt="40000.00", Appraised_Value="50000000", Instrument_No="D226000001",
                Gross_Building_Area="250000.00", Total_Net_Rentable_Area="230000.00"),
    tarrant_row(Account_Num="1001", PIDN="10001----1----1", Owner_Name="EXAMPLE TOWER LLC",
                Owner_Address="100 MAIN ST STE 1", Owner_CityState="FORT WORTH ,  TX", Owner_Zip="76102-6311",
                Owner_Zip4="6311", Situs_Address="100 E MAIN ST", State_Use_Code="F1", Land_Value="10000000",
                Improvement_Value="40000000", Total_Value="50000000", Year_Built="1985", Living_Area="250000",
                Land_Acres="0.9183", Land_SqFt="40000.00", Appraised_Value="50000000", Instrument_No="D226000002",
                Gross_Building_Area="250000.00", Total_Net_Rentable_Area="230000.00"),
    # Vacant commercial land (C1C → C1): out of the default scope.
    tarrant_row(Account_Num="1002", Owner_Name="VACANT LOT LLC", Owner_Address="1 LOT ST",
                Owner_CityState="ARLINGTON ,  TX", Owner_Zip="76010", Situs_Address="0  ELM ST", State_Use_Code="C1C",
                Land_Value="300000", Total_Value="300000", Land_Acres="0.1148", Land_SqFt="5000.00",
                Appraised_Value="300000"),
    # Multifamily in the commercial division (BC → B); no square-foot figure, so acres convert;
    # the ZIP has a dangling hyphen and the situs a double space, as in the file.
    tarrant_row(Account_Num="1003", Owner_Name="EXAMPLE APARTMENTS LP", Owner_Address="PO BOX 9",
                Owner_CityState="ALEDO ,  TX", Owner_Zip="76008-", Situs_Address="900  RIVER RD", State_Use_Code="BC",
                Land_Value="2000000", Improvement_Value="28000000", Total_Value="30000000", Year_Built="2005",
                Living_Area="180000", Land_Acres="2.0000", Land_SqFt="0.00", Appraised_Value="30000000",
                Gross_Building_Area="180000.00", Total_Net_Rentable_Area="175000.00"),
    # No owner of record: TAD's placeholder in every owner field, and no value or building figures.
    tarrant_row(Account_Num="1004", Owner_Name="UNKNOWN", Owner_Address="UNKNOWN", Owner_CityState=" ,  ",
                Situs_Address="0  AIRPORT FWY", State_Use_Code="F1", Land_Value="", Improvement_Value="",
                Total_Value="", Land_Acres="0.5000", Land_SqFt="21780.00", Appraisal_Date="", Appraised_Value=""),
    # Business personal property carrying a commercial code: not a parcel.
    tarrant_row(RP="P", Account_Num="1005", Owner_Name="EXAMPLE SHOP INC", Owner_Address="100 MAIN ST",
                Owner_CityState="FORT WORTH ,  TX", Owner_Zip="76102", Situs_Address="100 E MAIN ST",
                State_Use_Code="F1", Improvement_Value="50000", Total_Value="50000", Appraised_Value="50000"),
    # Multifamily in the residential division (plain B), as the full set lists it.
    tarrant_row(RP="R", Account_Num="1006", Owner_Name="EXAMPLE DUPLEX LLC", Owner_Address="2 OAK ST",
                Owner_CityState="KELLER ,  TX", Owner_Zip="76248", Situs_Address="200 OAK ST", State_Use_Code="B",
                Land_Value="100000", Improvement_Value="900000", Total_Value="1000000", Year_Built="1960",
                Living_Area="2400", Land_Acres="0.2500", Land_SqFt="10890.00", Appraised_Value="1000000",
                Gross_Building_Area="2400.00"),
    # "Reference only commercial" (ROC → F1); a quoted name with doubled inner quotes; a foreign
    # mailing address with no state or ZIP.
    tarrant_row(Account_Num="1007", Owner_Name='"TRIPLE ""T"" FARMS LTD"', Owner_Address="1840 RUE EXEMPLE",
                Owner_CityState="DORVAL ,  ", Situs_Address="7 RANCH RD", State_Use_Code="ROC", Land_Value="1",
                Total_Value="1", Land_Acres="0.0001", Land_SqFt="4.36", Appraised_Value="1"),
    # Industrial owned by a natural person.
    tarrant_row(Account_Num="1008", Owner_Name="J EXAMPLE", Owner_Address="5 OAK LN", Owner_CityState="HURST ,  TX",
                Owner_Zip="76053", Situs_Address="5 OAK LN", State_Use_Code="F2", Land_Value="200000",
                Improvement_Value="800000", Total_Value="1000000", Year_Built="2000", Land_Acres="0.1837",
                Land_SqFt="8000.00", Appraised_Value="1000000", Gross_Building_Area="5000.00"),
    # Exempt right of way.
    tarrant_row(Account_Num="1009", Owner_Name="EXAMPLE CITY OF", Owner_Address="1 CITY HALL",
                Owner_CityState="FORT WORTH ,  TX", Owner_Zip="76102", Situs_Address="0  15TH ST", State_Use_Code="X",
                Land_Value="1000", Total_Value="1000", Land_Acres="0.0100", Land_SqFt="435.60", Appraised_Value="1000"),
]


def tarrant_zip(tmp: Path) -> Path:
    p = tmp / "PropertyData(Delimited)_C.ZIP"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("PropertyData(Delimited)_C.txt", "\r\n".join([TARRANT_HEADER, *TARRANT_ROWS, ""]))
    return p


class Tarrant(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = tarrant_zip(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in tx_tarrant.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["1001", "1003", "1004", "1006", "1007", "1008"],
                         "F1, BC, B, ROC, F2 kept; C1C and X dropped; personal property dropped; deed repeats collapsed")
        tower = recs["1001"]
        self.assertEqual(tower.county_fips, "439")
        self.assertEqual((tower.account, tower.state_category, tower.tax_year), ("1001", "F1", 2026))
        self.assertEqual(tower.situs_address, "100 E MAIN ST", "the file has no situs city or ZIP")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 MAIN ST STE 1, FORT WORTH, TX 76102-6311")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 250000, 1985))
        self.assertEqual((tower.market_value, tower.appraised_value), (50000000, 50000000))
        self.assertEqual(tower.locator, "PropertyData(Delimited)_C.txt Account_Num 1001")
        apartments = recs["1003"]
        self.assertEqual(apartments.state_category, "B", "TAD's BC is the Comptroller's B")
        self.assertEqual(apartments.situs_address, "900 RIVER RD", "the blank direction prefix leaves a double space")
        self.assertEqual(apartments.owner_mailing_address, "PO BOX 9, ALEDO, TX 76008", "dangling ZIP hyphen dropped")
        self.assertEqual(apartments.land_area_sf, 87120, "acres convert when the square-foot figure is zero")
        unknown = recs["1004"]
        self.assertIsNone(unknown.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(unknown.owner_mailing_address)
        self.assertEqual((unknown.year_built, unknown.improvement_area_sf), (None, None), "zeros are not figures")
        self.assertEqual((unknown.market_value, unknown.appraised_value), (None, None), "blanks are not figures")
        self.assertEqual(unknown.land_area_sf, 21780)
        self.assertEqual(recs["1006"].state_category, "B")
        farms = recs["1007"]
        self.assertEqual(farms.owner_name, 'TRIPLE "T" FARMS LTD', "doubled quotes unwrap as in CSV")
        self.assertEqual(farms.state_category, "F1")
        self.assertEqual(farms.owner_mailing_address, "1840 RUE EXEMPLE, DORVAL")
        # The delimited export carries no confidentiality flag or withheld-owner marker, so no
        # record can be marked confidential from this file.
        self.assertFalse(any(r.owner_confidential for r in recs.values()))

    def test_state_category(self):
        self.assertEqual(tx_tarrant.state_category("BC"), "B")
        self.assertEqual(tx_tarrant.state_category("C2C"), "C1")
        self.assertEqual(tx_tarrant.state_category("J3C"), "J3")
        self.assertEqual(tx_tarrant.state_category("F1"), "F1")
        self.assertEqual(tx_tarrant.state_category("ZZ9"), "ZZ9", "an unlisted code passes through")
        self.assertIsNone(tx_tarrant.state_category(""))

    def test_all_categories_and_unpacked_directory(self):
        self.assertEqual(len(list(tx_tarrant.read_roll(self.zip, categories=None))), 8,
                         "every real-property account; personal property still dropped")
        self.assertEqual([r.apn for r in tx_tarrant.read_roll(self.zip, categories=["C1"])], ["1002"])
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        self.assertEqual([r.apn for r in tx_tarrant.read_roll(self.tmp / "unpacked")],
                         [r.apn for r in tx_tarrant.read_roll(self.zip)])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = tx_tarrant.build(self.zip, db, as_of="2026-11-02", full_roll=False)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-tarrant-ad'").fetchone()
            self.assertEqual(src["county_fips"], "439")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'tad_account' AND external_id = '1003'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48439:1003")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"B"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 4, "tower, apartments, duplex, farms; not the person or the placeholder")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
