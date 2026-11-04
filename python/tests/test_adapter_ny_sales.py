"""NYC Department of Finance sales adapter tests on SYNTHETIC workbooks that copy the published layout.

Every BBL, address and value here is invented. The workbooks are written with the standard library (inline
and shared strings, numeric dates as Excel serials), as the publisher's are read.
"""

import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

from factlot.facts import validate_fact
from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import ny_nyc, ny_sales, xlsx_reader

HEADER = ["BOROUGH", "NEIGHBORHOOD", "BUILDING CLASS CATEGORY", "TAX CLASS AT PRESENT", "BLOCK", "LOT", "EASE-MENT",
          "BUILDING CLASS AT PRESENT", "ADDRESS", "APARTMENT NUMBER", "ZIP CODE", "RESIDENTIAL UNITS", "COMMERCIAL UNITS",
          "TOTAL UNITS", "LAND SQUARE FEET", "GROSS SQUARE FEET", "YEAR BUILT", "TAX CLASS AT TIME OF SALE",
          "BUILDING CLASS AT TIME OF SALE", "SALE PRICE", "SALE DATE"]


def serial(d: date) -> int:
    return (d - date(1899, 12, 30)).days


def sale(boro, block, lot, cls, price, when, *, apt="", res=0, com=0, total=0, land=0, gross=0, cat="21 OFFICE BUILDINGS",
         tax="4"):
    return [boro, "EXAMPLE", cat, tax, block, lot, " ", cls, "1 EXAMPLE STREET", apt, 10004, res, com, total, land, gross, 1950,
            tax, cls, price, serial(when)]


def write_xlsx(path: Path, rows: list[list], *, shared: bool = False) -> None:
    """A one-sheet workbook; strings are inline, or shared when ``shared``."""
    strings: list[str] = []

    def cell(ref: str, v) -> str:
        if v is None:
            return ""
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        if shared:
            strings.append(str(v))
            return f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>'

    def col(i: int) -> str:
        return chr(65 + i)

    body = "".join(f'<row r="{n}">' + "".join(cell(f"{col(i)}{n}", v) for i, v in enumerate(row)) + "</row>"
                   for n, row in enumerate(rows, 1))
    sheet = f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{body}</sheetData></worksheet>'
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                    '<sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
        if shared:
            si = "".join(f"<si><t>{escape(s)}</t></si>" for s in strings)
            zf.writestr("xl/sharedStrings.xml", f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{si}</sst>')


TITLE = [["Example title row"], [], ["Another note"]]
SALES = [
    sale(1, 9, 1, "O4", 12_500_000, date(2025, 3, 14), com=3, total=3, land=20000, gross=90000),
    sale(1, 9, 1, "O4", 0, date(2024, 6, 1), com=3, total=3),                         # $0: a transfer without cash
    sale(1, 9, 1, "O4", 12_500_000, date(2025, 3, 14), com=3, total=3, land=20000, gross=90000),  # a repeated row
    sale(3, 123, 45, "D7", 30_000_000, date(2025, 8, 1), res=60, com=0, total=60, tax="2", cat="08 RENTALS - ELEVATOR APARTMENTS"),
    sale(3, 123, 45, "D4", 450_000, date(2025, 9, 1), apt="4B", tax="2"),            # a co-op apartment: not the building
    sale(4, 567, 89, "E1", 5_000_000, date(2025, 1, 20), com=1, total=1, land=20000, gross=40000, cat="22 STORE BUILDINGS"),
    sale(3, 123, 45, "D4", 300_000, date(2025, 9, 2), tax="2", cat="09 COOPS - ELEVATOR APARTMENTS"),  # a co-op share: unit level
    sale(2, 3456, 12, "A1", 800_000, date(2025, 2, 2), res=1, total=1, tax="1", cat="01 ONE FAMILY DWELLINGS"),  # a house: out of scope
    # One deed over two Brooklyn lots, published on each at the full price; a co-op share the same day and price is a unit row.
    sale(3, 124, 1, "K1", 7_000_000, date(2025, 5, 5), com=1, total=1),
    sale(3, 124, 2, "K1", 7_000_000, date(2025, 5, 5), com=1, total=1),
    sale(3, 124, 3, "D4", 7_000_000, date(2025, 5, 5), tax="2", cat="09 COOPS - ELEVATOR APARTMENTS"),
    sale(5, 789, 34, "K1", 1_000_000, date(2025, 2, 3), com=1, total=1),             # not in the registry
    sale(9, 1, 1, "O4", 1_000_000, date(2025, 2, 3)),                                 # borough 9
    sale(1, 9, 2, "O4", None, date(2025, 2, 3)),                                      # no price
]


class TestXlsxReader(unittest.TestCase):
    def test_inline_and_shared_strings_and_numbers(self):
        for shared in (False, True):
            with self.subTest(shared=shared), tempfile.TemporaryDirectory() as d:
                p = Path(d) / "a.xlsx"
                write_xlsx(p, [["A", None, "C"], [1, "x & y", 2.5]], shared=shared)
                rows = list(xlsx_reader.rows(p))
                self.assertEqual(rows[0], ["A", None, "C"])
                self.assertEqual(rows[1], [1.0, "x & y", 2.5])

    def test_excel_date(self):
        self.assertEqual(xlsx_reader.excel_date(serial(date(2025, 3, 14))), date(2025, 3, 14))
        self.assertEqual(xlsx_reader.excel_date("45000"), date(2023, 3, 15))
        self.assertIsNone(xlsx_reader.excel_date("n/a"))
        self.assertIsNone(xlsx_reader.excel_date(None))


class TestSales(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.book = self.dir / "rollingsales_manhattan.xlsx"
        write_xlsx(self.book, TITLE + [HEADER] + SALES, shared=True)
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(ny_nyc.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic roll")
        snap = reg.add_snapshot("ny-nyc-dof", roll, as_of="2026-05-15")
        reg.ingest_parcels([
            ParcelRecord("061", "1000090001", "F1", account="1000090001"),
            ParcelRecord("047", "3001230045", "B", account="3001230045"),
            ParcelRecord("081", "4005670089", "F2", account="4005670089"),
            ParcelRecord("047", "3001240001", "F1", account="3001240001"),
            ParcelRecord("047", "3001240002", "F1", account="3001240002"),
        ], snap, state_fips="36", account_system="nyc_bbl", full_roll=True)
        reg.close()

    def sales_of(self, bbl: str, history: bool = False) -> list[dict]:
        reg = Registry(self.db)
        try:
            urn = reg.resolve_external("nyc_bbl", bbl)
            return [f for f in reg.facts(urn, history=history) if f["predicate"] == "transaction.sale"]
        finally:
            reg.close()

    def test_rows_after_the_title_and_header(self):
        rows = list(ny_sales.sales_rows(self.book))
        self.assertEqual(len(rows), len(SALES))
        self.assertEqual(rows[0][1]["price"], 12_500_000)

    def test_in_scope_sales_become_facts_newest_first(self):
        stats = ny_sales.build([self.book], self.db, series="rolling", as_of="2026-09-30",
                               retrieved_at="2026-11-04T12:00:00+00:00")
        # Manhattan lot (two distinct sales; the repeated row collapses), Brooklyn building, Queens warehouse.
        self.assertEqual(stats.kept, 5)
        self.assertEqual(stats.facts_written, 6)
        self.assertEqual(stats.skipped_out_of_scope, 1)  # the Staten Island store: not a parcel the registry holds
        manhattan = self.sales_of("1000090001")
        self.assertEqual([f["value"]["date"] for f in manhattan], ["2025-03-14", "2024-06-01"])
        newest, nominal = (f["value"] for f in manhattan)
        self.assertEqual(newest, {"date": "2025-03-14", "price_usd": 12_500_000, "building_class": "O4",
                                  "building_class_category": "21 OFFICE BUILDINGS", "tax_class": "4", "commercial_units": 3,
                                  "total_units": 3, "land_area_sf": 20000, "gross_area_sf": 90000})
        self.assertEqual(nominal["price_usd"], 0)
        self.assertIs(nominal["nominal_consideration"], True)
        self.assertNotIn("nominal_consideration", newest)
        brooklyn = self.sales_of("3001230045")
        self.assertEqual(len(brooklyn), 1)  # the co-op apartment sale (apartment number) is not a building sale
        self.assertEqual(brooklyn[0]["value"]["residential_units"], 60)
        self.assertEqual(len(self.sales_of("4005670089")), 1)

    def test_lots_sharing_a_price_and_date_are_marked_so_prices_are_not_summed(self):
        ny_sales.build([self.book], self.db, series="rolling", as_of="2026-09-30")
        for bbl in ("3001240001", "3001240002"):
            (sale_fact,) = self.sales_of(bbl)
            self.assertEqual(sale_fact["value"]["lots_sharing_price_and_date"], 2)  # the co-op share is not counted
        self.assertNotIn("lots_sharing_price_and_date", self.sales_of("1000090001")[0]["value"])
        self.assertNotIn("lots_sharing_price_and_date", self.sales_of("1000090001")[1]["value"])  # $0 sales never share

    def test_no_party_or_arms_length_field_and_every_fact_validates(self):
        ny_sales.build([self.book], self.db, series="rolling", as_of="2026-09-30")
        for bbl in ("1000090001", "3001230045", "4005670089", "3001240001"):
            for f in self.sales_of(bbl):
                self.assertTrue(validate_fact(f)["valid"], validate_fact(f))
                self.assertEqual(f["provenance"]["method"], "public_record")
                self.assertTrue(f["provenance"]["sources"][0]["document_id"].startswith("fl:document:sha256-"))
                self.assertIn("rollingsales_manhattan.xlsx row", f["provenance"]["sources"][0]["section"])
                self.assertEqual(f["rights"]["redistribution"], "permitted")
                text = " ".join(f["value"])
                for forbidden in ("buyer", "seller", "grantor", "grantee", "arm", "owner", "party"):
                    self.assertNotIn(forbidden, text)

    def test_since_skips_earlier_sales(self):
        ny_sales.build([self.book], self.db, series="rolling", as_of="2026-09-30", since="2025-01-01")
        self.assertEqual([f["value"]["date"] for f in self.sales_of("1000090001")], ["2025-03-14"])

    def test_a_series_is_its_own_source_so_years_do_not_hide_each_other(self):
        ny_sales.build([self.book], self.db, series="2024", as_of="2024-12-31", since=None)
        later = self.dir / "later.xlsx"
        write_xlsx(later, TITLE + [HEADER] + [sale(1, 9, 1, "O4", 9_000_000, date(2026, 2, 1), com=3, total=3)])
        ny_sales.build([later], self.db, series="rolling", as_of="2026-09-30")
        self.assertEqual([f["value"]["date"] for f in self.sales_of("1000090001")], ["2026-02-01", "2025-03-14", "2024-06-01"])

    def test_reingest_changes_nothing(self):
        ny_sales.build([self.book], self.db, series="rolling", as_of="2026-09-30")
        self.assertEqual(ny_sales.build([self.book], self.db, series="rolling", as_of="2026-09-30").facts_written, 0)

    def test_annualized_header_variant(self):
        header = [h.replace("AT PRESENT", "AS OF FINAL ROLL 2025/26") for h in HEADER]
        book = self.dir / "2025_brooklyn.xlsx"
        write_xlsx(book, TITLE + [header] + [sale(3, 123, 45, "D7", 1, date(2025, 1, 2), res=60, total=60, tax="2")])
        self.assertEqual(ny_sales.build([book], self.db, series="2025", as_of="2025-12-31").facts_written, 1)
        self.assertEqual(self.sales_of("3001230045")[0]["value"]["price_usd"], 1)

    def test_string_dates_and_prices(self):
        book = self.dir / "str.xlsx"
        row = sale(1, 9, 1, "O4", "$1,200,000", date(2025, 3, 14), com=1, total=1)
        row[-1] = "2025-04-01"
        write_xlsx(book, TITLE + [HEADER] + [row])
        ny_sales.build([book], self.db, series="2030", as_of="2030-12-31")
        self.assertEqual((self.sales_of("1000090001")[0]["value"]["date"], self.sales_of("1000090001")[0]["value"]["price_usd"]),
                         ("2025-04-01", 1_200_000))


if __name__ == "__main__":
    unittest.main()
