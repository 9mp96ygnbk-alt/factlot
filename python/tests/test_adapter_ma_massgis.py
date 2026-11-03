"""MassGIS Level 3 "Assess" table adapter tests on a SYNTHETIC town file.

The field list and widths are the real ones of ``M049Assess_CY25_FY26.dbf`` (dBase III, 37 fields);
the test builds a small .dbf in memory, zips it as the publisher does (``L3_SHP_M###_NAME.zip``),
and every parcel id, name, address, and value is invented to exercise the mapping.
"""

import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ma_massgis

# (name, type, width, decimals) as in the real table
FIELDS = [
    ("PROP_ID", "C", 30, 0), ("LOC_ID", "C", 18, 0), ("BLDG_VAL", "N", 10, 0), ("LAND_VAL", "N", 10, 0),
    ("OTHER_VAL", "N", 10, 0), ("TOTAL_VAL", "N", 10, 0), ("FY", "N", 5, 0), ("LOT_SIZE", "F", 19, 11),
    ("LS_DATE", "C", 8, 0), ("LS_PRICE", "N", 10, 0), ("USE_CODE", "C", 4, 0), ("SITE_ADDR", "C", 80, 0),
    ("ADDR_NUM", "C", 12, 0), ("FULL_STR", "C", 60, 0), ("LOCATION", "C", 60, 0), ("CITY", "C", 25, 0),
    ("ZIP", "C", 10, 0), ("OWNER1", "C", 80, 0), ("OWN_ADDR", "C", 80, 0), ("OWN_CITY", "C", 25, 0),
    ("OWN_STATE", "C", 2, 0), ("OWN_ZIP", "C", 10, 0), ("OWN_CO", "C", 30, 0), ("LS_BOOK", "C", 16, 0),
    ("LS_PAGE", "C", 14, 0), ("REG_ID", "C", 15, 0), ("ZONING", "C", 8, 0), ("YEAR_BUILT", "N", 5, 0),
    ("BLD_AREA", "N", 10, 0), ("UNITS", "N", 5, 0), ("RES_AREA", "N", 10, 0), ("STYLE", "C", 20, 0),
    ("STORIES", "C", 6, 0), ("NUM_ROOMS", "N", 5, 0), ("LOT_UNITS", "C", 1, 0), ("CAMA_ID", "N", 10, 0),
    ("TOWN_ID", "N", 5, 0),
]


def make_dbf(rows: list[dict[str, str]], deleted: set[int] = frozenset()) -> bytes:
    record_len = 1 + sum(w for _, _, w, _ in FIELDS)
    header_len = 32 + 32 * len(FIELDS) + 1
    head = bytearray(32)
    head[0] = 3
    head[4:8] = struct.pack("<I", len(rows))
    head[8:12] = struct.pack("<HH", header_len, record_len)
    out = bytearray(head)
    for name, kind, width, dec in FIELDS:
        d = bytearray(32)
        d[:len(name)] = name.encode()
        d[11] = ord(kind)
        d[16], d[17] = width, dec
        out += d
    out.append(0x0D)
    for i, r in enumerate(rows):
        out += b"*" if i in deleted else b" "
        for name, kind, width, _ in FIELDS:
            v = r.get(name, "").encode("utf-8")[:width]
            out += v.rjust(width) if kind in "NF" else v.ljust(width)
    out.append(0x1A)
    return bytes(out)


def town_zip(tmp: Path, rows: list[dict[str, str]], name: str = "L3_SHP_M049_CAMBRIDGE.zip",
             member: str = "L3_SHP_M049_Cambridge/M049Assess_CY25_FY26.dbf", **kw) -> Path:
    p = tmp / name
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("L3_SHP_M049_Cambridge/M049TaxPar_CY25_FY26.dbf", b"not read")
        zf.writestr(member, make_dbf(rows, **kw))
    return p


def row(**v: str) -> dict[str, str]:
    base = {"FY": "2026", "CITY": "Cambridge", "TOWN_ID": "49", "LOT_UNITS": "A", "LOC_ID": "F_1_2", "CAMA_ID": "1"}
    base.update(v)
    return base


ROWS = [
    # hotel: 300 with local digit 0, organisation owner, acres, comma in the owner name
    row(PROP_ID="7-115", USE_CODE="3000", SITE_ADDR="219-221 MONSIGNOR OBRIEN HWY", OWNER1="EXAMPLE HOTEL, LLC",
        OWN_ADDR="1 EXAMPLE RD", OWN_CITY="HOOKSETT", OWN_STATE="NH", OWN_ZIP="03106", OWN_CO="C/O PAT EXAMPLE",
        LOT_SIZE="6.80000000000e-01", BLD_AREA="22448", YEAR_BUILT="2014", TOTAL_VAL="28979300", ZIP="02141"),
    # 71-15 collapses with 7-115 once punctuation is dropped: the APN must keep them apart
    row(PROP_ID="71-15", USE_CODE="3250", SITE_ADDR="5 SMALL ST", OWNER1="SMALL RETAIL INC", LOT_SIZE="4000",
        LOT_UNITS="S", BLD_AREA="2000", TOTAL_VAL="900000"),
    # industrial warehouse, natural-person owner (yielded by the adapter, dropped by the registry)
    row(PROP_ID="12-3", USE_CODE="4010", SITE_ADDR="40 FACTORY ST", OWNER1="EXAMPLE JOHN Q", OWN_ADDR="40 FACTORY ST",
        OWN_CITY="CAMBRIDGE", OWN_STATE="MA", OWN_ZIP="02139", LOT_SIZE="1.2", TOTAL_VAL="2500000", YEAR_BUILT="0"),
    # apartments 4-8, more than 8, affordable housing units
    row(PROP_ID="1-1", USE_CODE="1110", SITE_ADDR="10 ROW ST", OWNER1="ROW STREET LLC", TOTAL_VAL="1500000"),
    row(PROP_ID="1-2", USE_CODE="1120", SITE_ADDR="12 ROW ST", OWNER1="ROW TWELVE LP", TOTAL_VAL="9500000"),
    row(PROP_ID="1-3", USE_CODE="1140", SITE_ADDR="14 ROW ST", OWNER1="AFFORDABLE HOMES CORP", TOTAL_VAL="4500000"),
    # out of scope: single family, condo, mixed use, exempt, undefined, other residential
    row(PROP_ID="2-1", USE_CODE="1010", SITE_ADDR="1 HOME ST", OWNER1="DOE JANE", TOTAL_VAL="700000"),
    row(PROP_ID="2-2", USE_CODE="1020", SITE_ADDR="2 CONDO ST", OWNER1="DOE JOHN", TOTAL_VAL="600000"),
    row(PROP_ID="2-3", USE_CODE="0310", SITE_ADDR="3 MIXED ST", OWNER1="MIXED USE LLC", TOTAL_VAL="800000"),
    row(PROP_ID="2-4", USE_CODE="9340", SITE_ADDR="4 CITY ST", OWNER1="CITY OF CAMBRIDGE", TOTAL_VAL="100"),
    row(PROP_ID="2-5", USE_CODE="", SITE_ADDR="5 BLANK ST", OWNER1="BLANK CODE LLC"),
    row(PROP_ID="2-6", USE_CODE="1990", SITE_ADDR="6 OTHER ST", OWNER1="OTHER LLC"),
    # commercial land: no number ("0 ..."), placeholder owner, zeros
    row(PROP_ID="3-1", USE_CODE="3900", SITE_ADDR="0 VACANT RD", OWNER1="UNKNOWN", LOT_SIZE="43560", LOT_UNITS="S",
        TOTAL_VAL="0", BLD_AREA="0", ZIP=""),
    # commercial with an x in the parcel id and an unknown lot unit
    row(PROP_ID="X-9/A", USE_CODE="3400", ADDR_NUM="9", FULL_STR="X ST", OWNER1="EX ONE LLC", LOT_SIZE="5", LOT_UNITS="",
        TOTAL_VAL="100000"),
    # a deleted record and a record with no parcel id
    row(PROP_ID="9-9", USE_CODE="3400", SITE_ADDR="9 GONE ST", OWNER1="GONE LLC"),
    row(PROP_ID="", USE_CODE="3400", SITE_ADDR="10 NO ID ST", OWNER1="NO ID LLC"),
]


class MassGis(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = town_zip(self.tmp, ROWS, deleted={14})

    def test_state_category(self):
        for code in ("3000", "3250", "390", "3930"):
            self.assertEqual(ma_massgis.state_category(code), "F1", code)
        for code in ("4000", "4010", "4520"):
            self.assertEqual(ma_massgis.state_category(code), "F2", code)
        for code in ("1110", "1120", "1140", "111", "112", "114"):
            self.assertEqual(ma_massgis.state_category(code), "B", code)
        for code in ("1010", "1020", "1040", "1130", "0310", "9340", "1990", "000", "", None, "ABCD", "30"):
            self.assertIsNone(ma_massgis.state_category(code), str(code))

    def test_apn_is_one_to_one(self):
        self.assertEqual(ma_massgis.apn_for(49, "7-115"), "0497x2dx115")
        self.assertNotEqual(ma_massgis.apn_for(49, "7-115"), ma_massgis.apn_for(49, "71-15"))
        self.assertEqual(ma_massgis.apn_for(49, "X-9/A"), "049xxx2dx9x2fxa", "a literal x is doubled")
        self.assertEqual(ma_massgis.apn_for(5, "12A"), "00512a")
        self.assertNotEqual(ma_massgis.apn_for(49, "x-1"), ma_massgis.apn_for(49, "xx2dx1"), "escapes cannot be forged")

    def test_read_roll_in_scope(self):
        recs = {r.account: r for r in ma_massgis.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["M049:1-1", "M049:1-2", "M049:1-3", "M049:12-3", "M049:3-1", "M049:7-115",
                                        "M049:71-15", "M049:X-9/A"])
        hotel = recs["M049:7-115"]
        self.assertEqual((hotel.county_fips, hotel.apn, hotel.state_category, hotel.local_use_code),
                         ("017", "0497x2dx115", "F1", "3000"))
        self.assertEqual(hotel.situs_address, "219-221 MONSIGNOR OBRIEN HWY, CAMBRIDGE MA 02141")
        self.assertEqual(hotel.owner_name, "EXAMPLE HOTEL, LLC")
        self.assertEqual(hotel.owner_mailing_address, "1 EXAMPLE RD, HOOKSETT, NH 03106", "the care-of line is not copied")
        self.assertEqual(hotel.land_area_sf, 29620.8, "0.68 acres")
        self.assertEqual((hotel.improvement_area_sf, hotel.year_built, hotel.market_value, hotel.tax_year),
                         (22448, 2014, 28979300, 2026))
        self.assertFalse(hotel.owner_confidential)
        self.assertEqual(hotel.locator, "L3_SHP_M049_CAMBRIDGE.zip PROP_ID 7-115")
        small = recs["M049:71-15"]
        self.assertEqual((small.land_area_sf, small.apn), (4000, "04971x2dx15"), "square feet kept as given")
        warehouse = recs["M049:12-3"]
        self.assertEqual((warehouse.state_category, warehouse.year_built), ("F2", None), "YEAR_BUILT 0 is none")
        self.assertEqual(warehouse.owner_name, "EXAMPLE JOHN Q", "the adapter passes people through; the registry drops them")
        self.assertEqual([recs[k].state_category for k in ("M049:1-1", "M049:1-2", "M049:1-3")], ["B", "B", "B"])
        land = recs["M049:3-1"]
        self.assertEqual(land.situs_address, "VACANT RD, CAMBRIDGE MA", "'0 ' is no number; blank ZIP is left out")
        self.assertIsNone(land.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(land.owner_mailing_address)
        self.assertEqual((land.market_value, land.improvement_area_sf), (None, None), "0 is not a figure")
        self.assertEqual(land.land_area_sf, 43560)
        odd = recs["M049:X-9/A"]
        self.assertEqual(odd.situs_address, "9 X ST, CAMBRIDGE MA", "ADDR_NUM and FULL_STR when SITE_ADDR is blank")
        self.assertIsNone(odd.land_area_sf, "a lot size without a unit is not recorded")

    def test_all_categories_and_skips(self):
        every = list(ma_massgis.read_roll(self.zip, categories=None))
        accounts = [r.account for r in every]
        self.assertNotIn("M049:9-9", accounts, "deleted record")
        self.assertEqual(len(every), 14, "the record with no PROP_ID is skipped too")
        self.assertEqual([r.local_use_code for r in every if r.state_category is None],
                         ["1010", "1020", "0310", "9340", None, "1990"])
        self.assertEqual([r.account for r in ma_massgis.read_roll(self.zip, categories=["F2"])], ["M049:12-3"])

    def test_bare_dbf_and_unknown_town(self):
        dbf = self.tmp / "M049Assess_CY25_FY26.dbf"
        dbf.write_bytes(make_dbf(ROWS[:2]))
        self.assertEqual(len(list(ma_massgis.read_roll(dbf))), 2)
        odd = town_zip(self.tmp, [row(PROP_ID="1", USE_CODE="3000", TOWN_ID="999")], name="L3_SHP_M999_NOWHERE.zip")
        with self.assertRaises(ValueError):
            list(ma_massgis.read_roll(odd))
        self.assertEqual(next(ma_massgis.read_roll(odd, county_fips="017")).county_fips, "017")

    def test_assessment_date_follows_the_towns_fiscal_year(self):
        self.assertEqual(ma_massgis.assessment_date(self.zip), "2025-01-01", "FY2026 → 1 January 2025")
        fy27 = town_zip(self.tmp, [row(PROP_ID="1", USE_CODE="3000", FY="2027")], name="L3_SHP_M163_LYNN.zip",
                        member="L3_SHP_M163_Lynn/M163Assess_CY26_FY27.dbf")
        self.assertEqual(ma_massgis.assessment_date(fy27), "2026-01-01")
        db = self.tmp / "fy.db"
        ma_massgis.build(fy27, db)
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.db.execute("SELECT as_of FROM snapshots").fetchone()[0], "2026-01-01")
        finally:
            reg.close()

    def test_town_table(self):
        # Every MassGIS town id (1-351) but Boston (35). Towns per county as the publisher's town layer
        # (TOWNS_POLYM.dbf, FIPS_STCO) gives them, which are also the Census county subdivision counts.
        self.assertEqual(len(ma_massgis.TOWN_COUNTY), 350)
        self.assertEqual(set(ma_massgis.TOWN_COUNTY) | set(ma_massgis.EXCLUDED_TOWNS), set(range(1, 352)))
        counts = {c: sum(1 for v in ma_massgis.TOWN_COUNTY.values() if v == c) for c in set(ma_massgis.TOWN_COUNTY.values())}
        self.assertEqual(counts, {"001": 15, "003": 32, "005": 20, "007": 7, "009": 34, "011": 26, "013": 23, "015": 20,
                                  "017": 54, "019": 1, "021": 28, "023": 27, "025": 3, "027": 60},
                         "Barnstable through Worcester; Suffolk is Chelsea, Revere and Winthrop without Boston")
        self.assertEqual(ma_massgis.TOWN_COUNTY[49], "017", "Cambridge is in Middlesex")
        expected = {57: "025", 248: "025", 346: "025", 20: "001", 236: "003", 201: "005", 89: "007", 114: "011",
                    281: "013", 214: "015", 197: "019", 44: "023"}
        self.assertEqual({t: ma_massgis.TOWN_COUNTY[t] for t in expected}, expected,
                         "Chelsea, Revere, Winthrop, Barnstable, Pittsfield, New Bedford, Edgartown, Greenfield, "
                         "Springfield, Northampton, Nantucket, Brockton")

    def test_boston_is_never_loaded_here(self):
        self.assertNotIn(35, ma_massgis.TOWN_COUNTY)
        boston = town_zip(self.tmp, [row(PROP_ID="0100001000", USE_CODE="3400", TOWN_ID="35")],
                          name="L3_SHP_M035_BOSTON.zip", member="L3_SHP_M035_Boston/M035Assess_CY25_FY26.dbf")
        for kw in ({}, {"county_fips": "025"}):
            with self.assertRaisesRegex(ValueError, "ma-boston-assessing"):
                list(ma_massgis.read_roll(boston, **kw))

    def test_new_towns_load_with_their_county(self):
        chelsea = town_zip(self.tmp, [row(PROP_ID="12-34", USE_CODE="3400", TOWN_ID="57", SITE_ADDR="1 EXAMPLE ST",
                                          CITY="CHELSEA", OWNER1="EXAMPLE OFFICE LLC")],
                           name="L3_SHP_M057_CHELSEA.zip", member="L3_SHP_M057_Chelsea/M057Assess_CY25_FY26.dbf")
        springfield = town_zip(self.tmp, [row(PROP_ID="01234-0001", USE_CODE="1120", TOWN_ID="281",
                                              SITE_ADDR="5 SAMPLE AVE", CITY="SPRINGFIELD", OWNER1="SAMPLE APTS LLC")],
                               name="L3_SHP_M281_SPRINGFIELD.zip",
                               member="L3_SHP_M281_Springfield/M281Assess_CY25_FY26.dbf")
        recs = list(ma_massgis.read_roll(chelsea)) + list(ma_massgis.read_roll(springfield))
        self.assertEqual([(r.county_fips, r.account, r.apn, r.state_category) for r in recs],
                         [("025", "M057:12-34", "05712x2dx34", "F1"), ("013", "M281:01234-0001", "28101234x2dx0001", "B")])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ma_massgis.build(self.zip, db, as_of="2025-01-01")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (8, 8, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ma-massgis-parcels'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("25", None))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'massgis_prop_id' AND external_id = 'M049:7-115'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-25017:0497x2dx115")
            other = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'massgis_prop_id' AND external_id = 'M049:71-15'").fetchone()[0]
            self.assertNotEqual(urn, other, "7-115 and 71-15 are different parcels")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE HOTEL", owner[0])
            person = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE external_id = 'M049:12-3'").fetchone()[0]
            self.assertIsNone(reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                (person,)).fetchone(), "a natural person's name is never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
