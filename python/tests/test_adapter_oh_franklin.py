"""Franklin County Auditor Parcel CSV adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel id, name, address and value here is invented to exercise the mapping; none is real
Franklin County data. The header is the real 67-column header of ``Parcel.csv`` (UTF-8 with BOM).
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import oh_franklin

HEADER = ("PARCEL ID,AEXMLND,AEXMBLD,AEXMTOT,APPRLND,APPRBLD,APPRTOT,AUDMAP,AUDRTG,LANDUSE,CAUV,SCHOOL,MAILAD1,"
          "MAILAD2,MAILAD3,MAILAD4,TRANDT,TRANYR,NAME1,NAME2,NAME3,OWNER_ADD1,OWNER_ADD2,NBRHD,FLOOD,PCLASS,NOCARDS,"
          "ACREA,PRICE,ANN_TAX,STHNUM,STCONT,STHSFX,STDIRE,STNAME,STSFX,STADDR,USPS_CITY,STATE,ZIPCODE,DESCR1,DESCR2,"
          "DESCR3,TAXDESI,VALID,AREA_A,DWELTYP,ROOMS,BATHS,HBATHS,BEDRMS,AIRCOND,CINBRHD,COND,FIREPLC,GRADE,HEIGHT,"
          "NOSTORY,YEARBLT,PROPTYP,WALL,TIFMLND,TIFMBLD,POINT_X,POINT_Y,HOMSTD,BANKCODE")
COLS = HEADER.split(",")
NUMERIC = {"AEXMLND", "AEXMBLD", "AEXMTOT", "APPRLND", "APPRBLD", "APPRTOT", "CAUV", "TRANYR", "NOCARDS", "ACREA", "PRICE",
           "ANN_TAX", "ZIPCODE", "AREA_A", "DWELTYP", "ROOMS", "BATHS", "HBATHS", "BEDRMS", "AIRCOND", "TIFMLND", "TIFMBLD",
           "POINT_X", "POINT_Y"}


def row(**f):
    r = {c: "" for c in COLS}
    r.update({"AEXMTOT": "0.00", "APPRTOT": "0.00", "CAUV": "0", "ACREA": "0", "AREA_A": "0", "STATE": "OH",
              "USPS_CITY": "COLUMBUS", "ZIPCODE": "43215", "PCLASS": "C", "LANDUSE": "447"})
    r.update(f)
    return ",".join(r[c] if (c in NUMERIC and r[c] != "") or r[c] == "" and c in NUMERIC else f'"{r[c]}"' for c in COLS)


ROWS = [
    # 40-plus-unit apartments owned by a company; owner address in the file's run-of-spaces format.
    row(**{"PARCEL ID": "010-100001", "PCLASS": "C", "LANDUSE": "403", "NAME1": "EXAMPLE APARTMENTS LLC",
           "NAME2": "C/O AGENT", "OWNER_ADD1": "1 SAMPLE AVE STE 2", "OWNER_ADD2": "EXAMPLEVILLE OH     43001",
           "STADDR": "100 - 110 EXAMPLE ST", "APPRTOT": "5035200.00", "ACREA": "2.5", "AREA_A": "88000", "YEARBLT": "1968"}),
    # Industrial warehouse; exempt value only.
    row(**{"PARCEL ID": "010-100002", "PCLASS": "I", "LANDUSE": "399", "NAME1": "SAMPLE LOGISTICS INC",
           "STADDR": "200 N LAKE RD", "APPRTOT": "250000.00", "YEARBLT": "OLD"}),
    row(**{"PARCEL ID": "010-100003", "PCLASS": "C", "LANDUSE": "447", "NAME1": "EXAMPLE, ALEX", "STADDR": "",
           "AEXMTOT": "90000.00", "YEARBLT": "E 99"}),
    row(**{"PARCEL ID": "010-100004", "PCLASS": "C", "LANDUSE": "400", "NAME1": ""}),
    # Out of scope.
    row(**{"PARCEL ID": "010-100005", "PCLASS": "R", "LANDUSE": "510", "NAME1": "HOME OWNER"}),
    row(**{"PARCEL ID": "010-100006", "PCLASS": "E", "LANDUSE": "686", "NAME1": "EXAMPLE CHURCH"}),
    row(**{"PARCEL ID": "010-100007", "PCLASS": "F", "LANDUSE": "101", "NAME1": "FARM CO"}),
    row(**{"PARCEL ID": "010-100008", "PCLASS": "", "LANDUSE": "", "NAME1": "UNCLASSED"}),
    # A repeat id: first wins.
    row(**{"PARCEL ID": "010-100001", "PCLASS": "C", "LANDUSE": "403", "NAME1": "OTHER LLC", "APPRTOT": "1.00"}),
]


class OhFranklinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "Parcel.csv"
        self.csv.write_text(HEADER + "\n" + "\n".join(ROWS) + "\n", encoding="utf-8-sig")

    def test_state_category(self):
        sc = oh_franklin.state_category
        self.assertEqual(sc("C", "447"), "F1")
        self.assertEqual([sc("C", c) for c in ("401", "402", "403")], ["B"] * 3, "apartments of 4+ rental units")
        self.assertEqual(sc("C", "404"), "F1")
        self.assertEqual(sc("I", "399"), "F2")
        self.assertEqual(sc("I", "403"), "F2", "only commercial parcels are apartments")
        self.assertEqual((sc("R"), sc("E"), sc("F"), sc("M"), sc("U")), ("A", "G", "D1", "D2", "G"))
        self.assertIsNone(sc(""))
        self.assertIsNone(sc("Z"))

    def test_year_built(self):
        self.assertEqual(oh_franklin.year_built("1968"), 1968)
        self.assertIsNone(oh_franklin.year_built("OLD"))
        self.assertIsNone(oh_franklin.year_built("E 99"))
        self.assertIsNone(oh_franklin.year_built(""))
        self.assertIsNone(oh_franklin.year_built("0"))

    def test_records(self):
        recs = {r.apn: r for r in oh_franklin.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["010-100001", "010-100002", "010-100003", "010-100004"])
        apts = recs["010-100001"]
        self.assertEqual((apts.county_fips, apts.state_category, apts.local_use_code), ("049", "B", "403"))
        self.assertEqual(apts.situs_address, "100 - 110 EXAMPLE ST, COLUMBUS OH 43215")
        self.assertEqual(apts.owner_name, "EXAMPLE APARTMENTS LLC", "owner line 1 only; the first row for an id wins")
        self.assertEqual(apts.owner_mailing_address, "1 SAMPLE AVE STE 2, EXAMPLEVILLE OH 43001")
        self.assertEqual((apts.appraised_value, apts.land_area_sf, apts.improvement_area_sf, apts.year_built),
                         (5035200.0, round(2.5 * 43560, 2), 88000, 1968))
        self.assertIsNone(apts.tax_year)
        self.assertEqual(apts.locator, "Parcel.csv PARCEL ID 010-100001")
        wh = recs["010-100002"]
        self.assertEqual((wh.state_category, wh.year_built, wh.land_area_sf, wh.improvement_area_sf),
                         ("F2", None, None, None), "OLD is not a year; zeros are not figures")
        exempt = recs["010-100003"]
        self.assertEqual(exempt.appraised_value, 90000.0, "the exempt total when there is no taxable total")
        self.assertIsNone(exempt.situs_address)
        blank = recs["010-100004"]
        self.assertIsNone(blank.owner_name)
        self.assertIsNone(blank.owner_mailing_address)
        self.assertIsNone(blank.appraised_value)

    def test_truncated_last_line_skipped(self):
        cut = self.tmp / "sample.csv"
        raw = self.csv.read_bytes()
        cut.write_bytes(raw[: raw.rfind(b"\n", 0, len(raw) - 1) + 40])  # ends mid-row
        self.assertEqual(len(list(oh_franklin.read_roll(cut))), 4)

    def test_all_categories(self):
        self.assertEqual(len(list(oh_franklin.read_roll(self.csv, categories=None))), 8)
        self.assertEqual([r.apn for r in oh_franklin.read_roll(self.csv, categories=["F2"])], ["010-100002"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = oh_franklin.build(self.csv, db, as_of="2026-10-28", full_roll=False)
        self.assertEqual((stats.seen, stats.kept), (4, 4))
        self.assertEqual(stats.owners_person_or_withheld, 1)
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'franklin_parcel_id' AND external_id = '010-100001'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-39049:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["EXAMPLE APARTMENTS LLC", "SAMPLE LOGISTICS INC"])
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
