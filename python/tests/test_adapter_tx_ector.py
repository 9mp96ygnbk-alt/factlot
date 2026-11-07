"""Ector classification: only stated commercial codes, not undescribed F subclasses."""

import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from factlot.registry.adapters.tx_ector import commercial_code, read_roll


def _workbook(rows: list[dict[str, str]]) -> Path:
    """A one-sheet workbook with inline strings. Keys are column letters."""
    body = []
    for r, cells in enumerate(rows, start=1):
        bits = "".join(f'<c r="{col}{r}" t="inlineStr"><is><t>{escape(text)}</t></is></c>' for col, text in cells.items())
        body.append(f'<row r="{r}">{bits}</row>')
    sheet = ('<?xml version="1.0" encoding="UTF-8"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f'<sheetData>{"".join(body)}</sheetData></worksheet>')
    path = Path(tempfile.mkdtemp()) / "ector.xlsx"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return path


class EctorCodes(unittest.TestCase):
    def test_known_commercial_codes(self):
        self.assertEqual(commercial_code("F1"), "F1")
        self.assertEqual(commercial_code("f2"), "F2")
        self.assertEqual(commercial_code("B2"), "B")
        self.assertEqual(commercial_code("B1"), "B")

    def test_undescribed_f_codes_are_not_commercial(self):
        self.assertIsNone(commercial_code("F3"))
        self.assertIsNone(commercial_code("F5"))
        self.assertIsNone(commercial_code("A1"))
        self.assertIsNone(commercial_code("M1"))
        self.assertIsNone(commercial_code(""))

    def test_reader_collapses_accounts_and_drops_person_names(self):
        path = _workbook([
            {"B": "ACCOUNT"},
            {"B": "10", "E": "NORTH SIDE LLC", "M": "F1", "S": "10 MAIN", "AE": "400", "AF": "1990", "AA": "50", "AH": "1"},
            {"B": "10", "E": "NORTH SIDE LLC", "M": "F1", "AE": "100", "AF": "1985"},
            {"B": "11", "E": "JANE DOE", "M": "B2", "S": "9 OAK"},
            {"B": "12", "E": "SOUTH SIDE LLC", "M": "F3"},
            {"B": "13", "E": "EAST SIDE LLC", "M": "A1"},
        ])
        tally: dict = {}
        rows = {r.apn: r for r in read_roll(path, tally)}
        self.assertEqual(sorted(rows), ["10", "11"])
        self.assertEqual(rows["10"].owner_name, "NORTH SIDE LLC")
        self.assertEqual(rows["10"].improvement_area_sf, 500)
        self.assertEqual(rows["10"].year_built, 1985)
        self.assertEqual(rows["10"].land_area_sf, 43560)
        self.assertEqual(rows["11"].state_category, "B")
        self.assertIsNone(rows["11"].owner_name)
        self.assertEqual((tally["input_records"], tally["kept"], tally["duplicate_ids"], tally["out_of_scope"]), (5, 2, 1, 2))

    def test_outer_zip_is_refused(self):
        with self.assertRaises(ValueError):
            list(read_roll("roll.zip"))


if __name__ == "__main__":
    unittest.main()
