"""Source-adapter tests on SYNTHETIC fixtures that copy each publisher's real layout.

Every account, name, and value here is invented to exercise the mapping; none is real Texas data.
"""

import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_comptroller, tx_dallas, tx_harris

HARRIS_REAL_ACCT_HEADER = (
    "acct\tyr\tmailto\tmail_addr_1\tmail_addr_2\tmail_city\tmail_state\tmail_zip\tmail_country\tsite_addr_1\t"
    "site_addr_2\tsite_addr_3\tstate_class\tyr_impr\tbld_ar\tland_ar\tacreage\ttot_appr_val\ttot_mkt_val"
)
HARRIS_REAL_ACCT_ROWS = [
    # acct, yr, mailto, mail1, mail2, city, st, zip, country, site1, site2, site3, class, yr_impr, bld_ar, land_ar, acreage, appr, mkt
    "0010010000001            \t2026\tEXAMPLE TOWER LLC\t100 MAIN ST STE 1\t \tHOUSTON\tTX\t77002\t \t100 MAIN ST\tHOUSTON\t77002\tF1\t1985\t250000\t40000\t0.9183\t50000000\t52000000",
    "0010010000002            \t2026\tCURRENT OWNER\tPO BOX 9\t \tHOUSTON\tTX\t77001\t \t0 ELM ST\tHOUSTON\t77003\tF1\t\t0\t0\t0.5000\t900000\t900000",
    "0010010000003            \t2026\tJ EXAMPLE\t5 OAK LN\t \tHOUSTON\tTX\t77004\t \t5 OAK LN\tHOUSTON\t77004\tA1\t1990\t2000\t7000\t0.1607\t300000\t300000",
    "0010010000004            \t2026\tEXAMPLE APARTMENTS LP\t1 PARK AVE\tFLOOR 2\tNEW YORK\tNY\t10001\t \t900 RIVER RD\tHOUSTON\t77005\tB1\t2005\t180000\t90000\t2.0661\t30000000\t31000000",
    "0010010000005            \t2026\tCONFIDENTIAL\t \t \t \t \t \t \t7 SHIELD ST\tHOUSTON\t77006\tF1\t2000\t5000\t8000\t0.1837\t1000000\t1000000",
]
HARRIS_OWNERS_HEADER = "acct\tln_num\tname\taka\tpct_own"
HARRIS_OWNERS_ROWS = [
    "0010010000001\t1\tEXAMPLE TOWER LLC\t \t1.0000",
    "0010010000002\t1\tCURRENT OWNER\t \t1.0000",
    "0010010000003\t1\tJ EXAMPLE\t \t1.0000",
    "0010010000004\t1\tEXAMPLE APARTMENTS LP\t \t0.9000",
    "0010010000004\t2\tEXAMPLE GP INC\t \t0.1000",
    "0010010000005\t1\tCONFIDENTIAL\t \t1.0000",
]


def harris_zip(tmp: Path) -> Path:
    p = tmp / "Real_acct_owner.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("real_acct.txt", "\r\n".join([HARRIS_REAL_ACCT_HEADER, *HARRIS_REAL_ACCT_ROWS, ""]))
        zf.writestr("owners.txt", "\r\n".join([HARRIS_OWNERS_HEADER, *HARRIS_OWNERS_ROWS, ""]))
        zf.writestr("deeds.txt", "acct\tdos\tclerk_yr\tclerk_id\tdeed_id\r\n")
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
        '"ACCOUNT_NUM","APPRAISAL_YR","IMPR_VAL","LAND_VAL","TOT_VAL","DIVISION_CD","SPTD_CODE"',
        '"00000100001000000","2026","4000000.00","1000000.00","5000000.00","COM","F10"',
        '"00000100002000000","2026","0.00","300000.00","300000.00","COM","C12"',
        '"00000100003000000","2026","900000.00","100000.00","1000000.00","RES","B11"',
        '"00000100004000000","2026","50000.00","0.00","50000.00","BPP","F10"',
        '"00000100005000000","2026","2000000.00","500000.00","2500000.00","COM","F20"',
    ],
    "ACCOUNT_INFO.CSV": [
        '"ACCOUNT_NUM","APPRAISAL_YR","DIVISION_CD","OWNER_NAME1","OWNER_NAME2","EXCLUDE_OWNER","OWNER_ADDRESS_LINE1",'
        '"OWNER_ADDRESS_LINE2","OWNER_ADDRESS_LINE3","OWNER_ADDRESS_LINE4","OWNER_CITY","OWNER_STATE","OWNER_ZIPCODE",'
        '"OWNER_COUNTRY","STREET_NUM","STREET_HALF_NUM","FULL_STREET_NAME","BLDG_ID","UNIT_ID","PROPERTY_CITY","PROPERTY_ZIPCODE"',
        '"00000100001000000","2026","COM","EXAMPLE PLAZA LP","C/O EXAMPLE MGMT","N","","PO BOX 100","","","DALLAS","TEXAS",'
        '"752010100","UNITED STATES OF AMERICA","1500","","MAIN ST","","","DALLAS","75201"',
        '"00000100002000000","2026","COM","VACANT LOT LLC","","N","1 LOT ST","","","","DALLAS","TEXAS","75201","","0","","ELM ST","","","DALLAS","75201"',
        '"00000100003000000","2026","RES","EXAMPLE DUPLEX LLC","","N","2 OAK ST","","","","DALLAS","TEXAS","75202","","200","1/2","OAK ST","","B","DALLAS","75202"',
        '"00000100004000000","2026","BPP","EXAMPLE SHOP INC","","N","","","","","","","","","1500","","MAIN ST","","","DALLAS","75201"',
        '"00000100005000000","2026","COM","WITHHELD PERSON","","Y","9 SHIELD RD","","","","DALLAS","TEXAS","75203","","9","","SHIELD RD","","","DALLAS","75203"',
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


def dallas_zip(tmp: Path) -> Path:
    p = tmp / "DCAD2026_CURRENT.ZIP"
    with zipfile.ZipFile(p, "w") as zf:
        for name, lines in DALLAS.items():
            zf.writestr(name, "\r\n".join([*lines, ""]))
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


if __name__ == "__main__":
    unittest.main()
