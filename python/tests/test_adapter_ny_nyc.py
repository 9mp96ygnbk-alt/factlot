"""NYC Department of Finance adapter tests on a SYNTHETIC fixture that copies the real layout.

Every BBL, name and value here is invented to exercise the mapping; none is real New York City data.
The real file has no header row: 139 tab-separated columns in the order of ``ny_nyc.LAYOUT``.
"""

import tempfile
import unittest
import zipfile
from collections import Counter
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ny_nyc

N = len(ny_nyc.LAYOUT)
assert N == 139


def row(**values: str) -> str:
    """One tab-delimited line with every column blank except those given (names from LAYOUT)."""
    fields = [""] * N
    for name, v in values.items():
        fields[ny_nyc._COL[name]] = v
    return "\t".join(fields)


def lot(parid, boro, block, lot_, bldg_class, owner, *, ease="", rectype="1", units="+000000",
        land="+0000000000", gross="+0000000000", built="0000", mkt="+00000000000", act="+00000000000",
        lo="", hi="", street="", zip_code="", taxclass="4"):
    return row(PARID=parid.ljust(30), BORO=boro, BLOCK=block, LOT=lot_, EASE=ease, RECTYPE=rectype,
               TAXYR="2027", FINTAXCLASS=taxclass, FINMKTTOT=mkt, FINACTTOT=act, PERIOD="3",
               BLDG_CLASS=bldg_class, OWNER=owner.ljust(80), HOUSENUM_LO=lo, HOUSENUM_HI=hi,
               STREET_NAME=street, ZIP_CODE=zip_code, LAND_AREA=land, GROSS_SQFT=gross, YRBUILT=built,
               UNITS=units, EXTRACTDT="20260515")


ROWS = [
    # Manhattan office tower: F1, organisation owner, house-number range, all figures present.
    lot("1000090001", "1", "00009", "0001", "O4", "EXAMPLE TOWER OWNER LLC", land="+0000029481",
        gross="+0000692431", built="1970", mkt="+00185249000", act="+00083362050", lo="34", hi="50",
        street="WHITEHALL STREET", zip_code="10004", units="+000014"),
    # Same block and lot with an air-rights easement: a separate record.
    lot("1000090001A", "1", "00009", "0001", "O4", "EXAMPLE TOWER OWNER LLC", ease="A", lo="34", hi="50",
        street="WHITEHALL STREET", zip_code="10004", mkt="+00000100000", act="+00000045000"),
    # Brooklyn elevator apartment building: B; zero area, year and units are 'no figure'.
    lot("3001230045", "3", "00123", "0045", "D7", "EXAMPLE APARTMENTS LP", lo="100", hi="100",
        street="EXAMPLE AVENUE", zip_code="11201", mkt="+00030000000", act="+00013500000", taxclass="2"),
    # Queens warehouse: F2, hyphenated house numbers, placeholder owner.
    lot("4005670089", "4", "00567", "0089", "E1", "UNAVAILABLE OWNER", lo="37-10", hi="37-20",
        street="EXAMPLE BOULEVARD", zip_code="11101", land="+0000020000", gross="+0000040000", built="1955",
        mkt="+00005000000", act="+00002250000"),
    # Bronx one-family house (tax class 1 building class): out of scope.
    lot("2034560012", "2", "03456", "0012", "A1", "J EXAMPLE", lo="12", hi="12", street="EXAMPLE PLACE",
        zip_code="10461", mkt="+00000800000", act="+00000048000", taxclass="1"),
    # Staten Island small walk-up 'less than 11 units' with 8 units: B by the unit count.
    lot("5007890034", "5", "00789", "0034", "CB", "EXAMPLE REALTY CORP", units="+000008", lo="7", hi="7",
        street="EXAMPLE STREET", zip_code="10301", mkt="+00002000000", act="+00000900000", taxclass="2B"),
    # Same class with 4 units: out of scope.
    lot("5007890035", "5", "00789", "0035", "CB", "EXAMPLE REALTY CORP", units="+000004", lo="9", hi="9",
        street="EXAMPLE STREET", zip_code="10301", mkt="+00001000000", act="+00000450000", taxclass="2A"),
    # Manhattan church: out of scope (M).
    lot("1004560078", "1", "00456", "0078", "M1", "EXAMPLE CHURCH", lo="1", hi="1", street="EXAMPLE SQUARE",
        zip_code="10010"),
    # Person-owned Brooklyn store: F1; the registry drops the person's name downstream.
    lot("3009990001", "3", "00999", "0001", "K1", "J EXAMPLE", lo="55", hi="55", street="EXAMPLE ROAD",
        zip_code="11235", mkt="+00001500000", act="+00000675000"),
    # Utility ident (RECTYPE 2): not a parcel.
    lot("1141-E1", "1", "00000", "0000", "U2", "EXAMPLE UTILITY CO", rectype="2"),
    # Residential garage of a tax class 1 house: out of scope even though G is a commercial group.
    lot("2011110022", "2", "01111", "0022", "G0", "J EXAMPLE", taxclass="1"),
]


def nyc_zip(tmp: Path) -> Path:
    p = tmp / "fy27_tc234.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("PROPMAST_TC234_T2027_FIN.TXT", "\r\n".join([*ROWS, ""]))
        zf.writestr("__MACOSX/._PROPMAST_TC234_T2027_FIN.TXT", "Mac OS X resource fork, not data")
    return p


class Nyc(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = nyc_zip(self.tmp)

    def test_category_mapping(self):
        self.assertEqual(ny_nyc.category("O4"), "F1")
        self.assertEqual(ny_nyc.category("K1"), "F1")
        self.assertEqual(ny_nyc.category("H2"), "F1")
        self.assertEqual(ny_nyc.category("G6"), "F1", "parking lot")
        self.assertEqual(ny_nyc.category("RK"), "F1", "retail condo unit")
        self.assertEqual(ny_nyc.category("E1"), "F2")
        self.assertEqual(ny_nyc.category("F5"), "F2")
        self.assertEqual(ny_nyc.category("RW"), "F2", "industrial condo unit")
        self.assertEqual(ny_nyc.category("D7"), "B")
        self.assertEqual(ny_nyc.category("C2"), "B", "five to six families")
        self.assertEqual(ny_nyc.category("S5"), "B")
        self.assertEqual(ny_nyc.category("RR"), "B")
        self.assertEqual(ny_nyc.category("CB", 8), "B")
        self.assertIsNone(ny_nyc.category("CB", 4))
        self.assertIsNone(ny_nyc.category("CB", None), "unit count unknown: not shown to be 5+")
        for out in ("A1", "B2", "C0", "C3", "G0", "M1", "P7", "Q5", "R4", "R0", "RA", "S2", "T2", "U2", "V1",
                    "W1", "Y2", "Z9", "", None):
            self.assertIsNone(ny_nyc.category(out), out)

    def test_mapping_from_the_zip(self):
        recs = {r.apn: r for r in ny_nyc.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["1000090001", "1000090001A", "3001230045", "3009990001", "4005670089",
                                        "5007890034"])
        tower = recs["1000090001"]
        self.assertEqual((tower.county_fips, tower.state_category, tower.local_use_code), ("061", "F1", "O4"))
        self.assertEqual(tower.account, "1000090001")
        self.assertEqual(tower.situs_address, "34-50 WHITEHALL STREET, NEW YORK NY 10004")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER OWNER LLC")
        self.assertIsNone(tower.owner_mailing_address, "the roll has no mailing address")
        self.assertFalse(tower.owner_confidential)
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (29481, 692431, 1970))
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (185249000, 83362050, 2027))
        self.assertEqual(tower.locator, "PROPMAST_TC234_T2027_FIN.TXT line 1 PARID 1000090001")
        easement = recs["1000090001A"]
        self.assertEqual(easement.county_fips, "061")
        self.assertEqual(easement.market_value, 100000, "the easement is its own record")
        apartments = recs["3001230045"]
        self.assertEqual((apartments.county_fips, apartments.state_category), ("047", "B"))
        self.assertEqual(apartments.situs_address, "100 EXAMPLE AVENUE, BROOKLYN NY 11201")
        self.assertIsNone(apartments.land_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(apartments.improvement_area_sf)
        self.assertIsNone(apartments.year_built, "0000 is 'no figure'")
        warehouse = recs["4005670089"]
        self.assertEqual((warehouse.county_fips, warehouse.state_category), ("081", "F2"))
        self.assertEqual(warehouse.situs_address, "37-10 TO 37-20 EXAMPLE BOULEVARD, QUEENS NY 11101")
        self.assertIsNone(warehouse.owner_name, "'UNAVAILABLE OWNER' is a placeholder, not an owner")
        walkup = recs["5007890034"]
        self.assertEqual((walkup.county_fips, walkup.state_category, walkup.local_use_code), ("085", "B", "CB"))
        self.assertEqual(walkup.situs_address, "7 EXAMPLE STREET, STATEN ISLAND NY 10301")
        store = recs["3009990001"]
        self.assertEqual(store.owner_name, "J EXAMPLE", "the adapter passes persons through; the registry drops them")

    def test_all_categories_and_unpacked_directory(self):
        every = list(ny_nyc.read_roll(self.zip, categories=None))
        self.assertEqual(len(every), 10, "every RECTYPE 1 lot, the utility ident excluded")
        self.assertEqual({r.apn: r.state_category for r in every}["2034560012"], None)
        self.assertEqual({r.apn: r.local_use_code for r in every}["2034560012"], "A1")
        self.assertEqual([r.apn for r in ny_nyc.read_roll(self.zip, categories=["F2"])], ["4005670089"])
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        a = [r.apn for r in ny_nyc.read_roll(self.zip)]
        b = [r.apn for r in ny_nyc.read_roll(self.tmp / "unpacked")]
        self.assertEqual(a, b)

    def test_house_numbers(self):
        self.assertEqual(ny_nyc._house_number("34", "50"), "34-50")
        self.assertEqual(ny_nyc._house_number("34", "34"), "34")
        self.assertEqual(ny_nyc._house_number("34", ""), "34")
        self.assertEqual(ny_nyc._house_number("", "50"), "50")
        self.assertEqual(ny_nyc._house_number("000000000034", "000000000050"), "34-50", "leading zeros dropped")
        self.assertEqual(ny_nyc._house_number("37-10", "37-10"), "37-10")
        self.assertEqual(ny_nyc._house_number("37-10", "37-20"), "37-10 TO 37-20")

    def test_short_rows_are_skipped(self):
        p = self.tmp / "short.zip"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("PROPMAST_X.TXT", "\r\n".join([ROWS[0], "1000000001\t1\t1", ""]))
        self.assertEqual([r.apn for r in ny_nyc.read_roll(p)], ["1000090001"])

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        tally = Counter()
        stats = ny_nyc.build(self.zip, db, as_of="2026-05-15", tally=tally)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the person-owned store; placeholders are not counted")
        self.assertEqual(tally, {("061", "F1"): 2, ("047", "B"): 1, ("047", "F1"): 1, ("081", "F2"): 1, ("085", "B"): 1})
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ny-nyc-dof'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("36", None))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'nyc_bbl' AND external_id = '1000090001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-36061:1000090001")
            urn_q = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'nyc_bbl' AND external_id = '4005670089'").fetchone()[0]
            self.assertEqual(urn_q, "fl:parcel:us-36081:4005670089")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER OWNER LLC", owner[0])
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("O4", code[0])
            store = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'nyc_bbl' AND external_id = '3009990001'").fetchone()[0]
            self.assertIsNone(reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                (store,)).fetchone(), "a natural person's name is never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
