"""Williamson CAD adapter tests on a SYNTHETIC fixture that copies the two WCAD open-data CSV layouts.

Every property id, name and value here is invented to exercise the mapping; none is real Williamson
County data. The fixtures have the real headers of the two Socrata queries the collector archives
(lower-case column names, all values quoted, numbers with six decimals, null as an empty field).
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_williamson

IMP_HEADER = "propertyid,fsptb,fdescription,fimptype,vtsgimp_comtotbldarea,feffyear,vtsgimp_sequencenumber".split(",")
OWN_HEADER = ("propertyid,tax_year,quickrefid,propertynumber,situsaddress,acres,propertytypecode,totallandmktvalue,"
              "totalimpmktvalue,totalpropmktvalue,totalassessedvalue,totalsqftlivingarea,primaryowner,fullname,"
              "mailingaddress,issecured,dba,datadate").split(",")


def imp(pid, code, area="", seq="1.000000", typ="C"):
    return dict(propertyid=pid, fsptb=code, fdescription="", fimptype=typ, vtsgimp_comtotbldarea=area, feffyear="",
                vtsgimp_sequencenumber=seq)


def own(pid, name, **f):
    r = {c: "" for c in OWN_HEADER}
    r.update(propertyid=pid, tax_year="2027", quickrefid=f"R{pid}", propertynumber=f"R-00-{pid}", primaryowner="1",
             issecured="0", fullname=name, datadate="2026-11-02T06:52:53.343")
    r.update(f)
    return r


IMPROVEMENTS = [
    imp("1001", "F1", "16304.000000"),
    imp("1001", "F1", "1310.000000", seq="2.000000"),
    imp("1002", "B1", "90000.000000"),
    imp("1003", "B2", "2116.000000", typ="R"),
    imp("1004", "F2", "40000.000000"),
    imp("1004", "F1", "500.000000", seq="2.000000"),
    imp("1005", "F1", "0.000000"),
    imp("1006", "F1", "1200.000000"),   # no PropOwner row; the property id is still enough
    imp("", "F1", "10.000000"),         # no identifier
    imp("000", "F1", "10.000000"),      # zeros are not an identifier
    imp("1007", "F1", "800.000000"),    # secured owner
    imp("1008", "A1", "2000.000000"),   # out of scope
    imp("1009", "F3", "300.000000"),    # unmapped code: out of scope
]
OWNERS = [
    own("1001", "EXAMPLE RETAIL HOLDINGS LLC", situsaddress="100 EXAMPLE BLVD, ROUND ROCK, TX  78664", acres="2.50",
        propertytypecode="C2", totallandmktvalue="1000000.000000", totalimpmktvalue="3000000.000000",
        totalpropmktvalue="4000000.000000", totalassessedvalue="3900000.000000",
        mailingaddress="1 SAMPLE PLZ STE 5\nDALLAS, TX 75201"),
    own("1002", "EXAMPLE APARTMENTS LP", situsaddress="200 SAMPLE DR, GEORGETOWN, TX  78626", acres="4.00",
        propertytypecode="C5", totalpropmktvalue="9000000.000000", totalassessedvalue="9000000.000000",
        mailingaddress="9 PARK AVE\nNEW YORK, NY 10001"),
    # A duplex typed RES, with a secondary owner row listed first: the primary owner wins.
    own("1003", "SECONDARY PERSON", primaryowner="0", situsaddress="300 OAK ST, CEDAR PARK, TX  78613",
        propertytypecode="RES", totalpropmktvalue="400000.000000", totalassessedvalue="380000.000000"),
    own("1003", "EXAMPLE DUPLEX HOLDINGS LLC", situsaddress="300 OAK ST, CEDAR PARK, TX  78613", acres="0.2",
        propertytypecode="RES", totalpropmktvalue="400000.000000", totalassessedvalue="380000.000000",
        mailingaddress="PO BOX 7\nCEDAR PARK, TX 78630"),
    own("1004", "EXAMPLE LOGISTICS INC", situsaddress="400 FREIGHT RD, TAYLOR, TX  76574", acres="10.0",
        propertytypecode="COM", totalpropmktvalue="2500000.000000", totalassessedvalue="2500000.000000"),
    own("1005", "UNKNOWN", situsaddress="", propertytypecode="C1", totalpropmktvalue="0.000000",
        totalassessedvalue="0.000000", acres="0"),
    own("1007", "SECURED OWNER NAME LLC", issecured="1", situsaddress="700 HIDDEN WAY, LEANDER, TX  78641",
        propertytypecode="C1", totalpropmktvalue="500000.000000", totalassessedvalue="500000.000000",
        mailingaddress="PO BOX 1\nLEANDER, TX 78646"),
    own("1008", "A PERSON", situsaddress="800 ELM LN, ROUND ROCK, TX  78664", propertytypecode="RES"),
    own("1009", "EXAMPLE CONDO LLC", situsaddress="900 CENTRAL EXPY, TAYLOR, TX  76574", propertytypecode="C1"),
    own("9999", "NOT IN THE IMPROVEMENT FILE LLC", situsaddress="1 NOWHERE RD, TAYLOR, TX  76574", propertytypecode="C1"),
]


def write(path: Path, rows, header) -> Path:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    path.write_text(buf.getvalue(), "utf-8")
    return path


class Williamson(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.imp = write(self.tmp / "2huh-jk3y.csv", IMPROVEMENTS, IMP_HEADER)
        self.own = write(self.tmp / "absk-uy9g.csv", OWNERS, OWN_HEADER)

    def test_mapping(self):
        recs = {r.apn: r for r in tx_williamson.read_roll(self.imp, self.own)}
        self.assertEqual(sorted(recs), ["1001", "1002", "1003", "1004", "1005", "1006", "1007"],
                         "in-scope improvements are kept, including one with no owner row; A1, F3, a blank id and an owner-only row are not")
        missing = recs["1006"]
        self.assertEqual((missing.state_category, missing.local_use_code, missing.improvement_area_sf), ("F1", "F1", 1200))
        self.assertEqual((missing.owner_name, missing.situs_address, missing.owner_confidential), (None, None, False))
        self.assertEqual(missing.locator, "Improvement propertyid 1006")
        self.assertNotIn("9999", recs)
        retail = recs["1001"]
        self.assertEqual(retail.county_fips, "491")
        self.assertEqual((retail.account, retail.state_category, retail.local_use_code, retail.tax_year),
                         ("1001", "F1", "F1", 2027))
        self.assertEqual(retail.situs_address, "100 EXAMPLE BLVD, ROUND ROCK TX 78664", "the double space before the ZIP goes")
        self.assertEqual(retail.owner_name, "EXAMPLE RETAIL HOLDINGS LLC")
        self.assertEqual(retail.owner_mailing_address, "1 SAMPLE PLZ STE 5, DALLAS, TX 75201", "the two lines join")
        self.assertEqual(retail.land_area_sf, 108900)
        self.assertEqual(retail.improvement_area_sf, 17614, "areas of the property's in-scope improvements add up")
        self.assertEqual((retail.market_value, retail.appraised_value), (4000000, 3900000))
        self.assertEqual((retail.year_built, retail.locator), (None, "PropOwner propertyid 1001"))
        self.assertEqual((recs["1002"].state_category, recs["1002"].local_use_code), ("B", "B1"))
        duplex = recs["1003"]
        self.assertEqual((duplex.state_category, duplex.local_use_code), ("B", "B2"))
        self.assertEqual(duplex.owner_name, "EXAMPLE DUPLEX HOLDINGS LLC", "the primary owner's row wins over a secondary owner")
        mixed = recs["1004"]
        self.assertEqual((mixed.state_category, mixed.local_use_code), ("F2", "F1,F2"), "industrial wins over commercial")
        self.assertEqual(mixed.improvement_area_sf, 40500)
        blank = recs["1005"]
        self.assertIsNone(blank.owner_name, "'UNKNOWN' is a placeholder, not an owner")
        self.assertIsNone(blank.owner_mailing_address)
        self.assertEqual((blank.situs_address, blank.land_area_sf, blank.improvement_area_sf), (None, None, None),
                         "zeros and blanks are not figures")
        secured = recs["1007"]
        self.assertTrue(secured.owner_confidential)
        self.assertEqual((secured.owner_name, secured.owner_mailing_address, secured.situs_address), (None, None, None))
        self.assertFalse(retail.owner_confidential)

    def test_state_category(self):
        self.assertEqual(tx_williamson.state_category("F1"), "F1")
        self.assertEqual(tx_williamson.state_category("B4"), "B")
        self.assertEqual(tx_williamson.state_category("a1"), "A1")
        self.assertIsNone(tx_williamson.state_category(""))

    def test_pages_and_all_categories(self):
        first = write(self.tmp / "p1.csv", OWNERS[:3], OWN_HEADER)
        second = write(self.tmp / "p2.csv", OWNERS[3:], OWN_HEADER)
        both = {r.apn for p in (first, second) for r in tx_williamson.read_roll(self.imp, p)}
        self.assertEqual(both, {r.apn for r in tx_williamson.read_roll(self.imp, self.own)})
        self.assertEqual({r.apn for r in tx_williamson.read_roll(self.imp, [first, second])}, both,
                         "a list of pages reads the same")
        self.assertEqual([r.apn for r in tx_williamson.read_roll(self.imp, self.own, categories=["A1"])], ["1008"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = tx_williamson.build(self.imp, [self.own], db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (7, 7, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the secured owner; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-williamson-cad'").fetchone()
            self.assertEqual(src["county_fips"], "491")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'wcad_property_id' AND external_id = '1001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48491:1001")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"F1"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 4, "retail, apartments, duplex holdings and logistics")
            bare = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'wcad_property_id' AND external_id = '1006'").fetchone()[0]
            self.assertIsNone(reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                (bare,)).fetchone())
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
