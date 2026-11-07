"""Andrews categories follow the 2025-07-23 code table and leave disagreements out."""

import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from factlot.registry.adapters.tx_andrews import (
    AMBIGUOUS,
    MAPPING_AS_OF,
    commercial_category,
    ptd_category,
    read_roll,
)


def _sheet(rows: list[list[tuple[str, str]]]) -> str:
    body = []
    for r, cells in enumerate(rows, start=1):
        bits = []
        for letter, text in cells:
            bits.append(f'<c r="{letter}{r}" t="inlineStr"><is><t>{escape(text)}</t></is></c>')
        body.append(f'<row r="{r}">{"".join(bits)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(body)}</sheetData></worksheet>'
    )


class AndrewsCodes(unittest.TestCase):
    def test_mapping_is_dated_and_does_not_use_disagreements(self):
        self.assertEqual(MAPPING_AS_OF, "2025-07-23")
        self.assertEqual(commercial_category("F1"), "F1")
        self.assertEqual(commercial_category("f2"), "F2")
        self.assertEqual(commercial_category("B2"), "B")
        self.assertEqual(commercial_category("F3"), "F1")
        self.assertEqual(commercial_category("F4"), "F1")
        self.assertEqual(ptd_category("C2"), "C1")
        self.assertIsNone(commercial_category("C2"))
        self.assertIsNone(commercial_category("A1"))
        self.assertIsNone(commercial_category("L1"))
        self.assertIsNone(commercial_category("X"))
        self.assertIsNone(commercial_category("J3"))
        self.assertIsNone(ptd_category("L3"))
        self.assertIsNone(ptd_category("N"))
        self.assertIsNone(ptd_category("Y"))
        self.assertIsNone(ptd_category("Z9"))
        self.assertIsNone(ptd_category(""))
        self.assertEqual(AMBIGUOUS, frozenset({"L3", "N", "Y"}))

    def test_reader_keeps_commercial_real_rows_and_drops_the_rest(self):
        header = [
            ("C", "prop_id"), ("E", "prop_type_cd"), ("G", "file_as_name"),
            ("H", "addr_line1"), ("I", "addr_line2"), ("K", "addr_city"),
            ("L", "addr_state"), ("M", "addr_zip"), ("N", "situs_num"),
            ("O", "situs_street"), ("P", "situs_display"), ("S", "state_cd"),
            ("T", "legal_acreage"), ("U", "land_total_sqft"), ("Z", "SumOfliving_area"),
            ("AA", "yr_blt"), ("AB", "appraised_val"), ("AD", "market"), ("AF", "owner_tax_yr"),
        ]
        rows = [
            header,
            [("C", "10"), ("E", "R"), ("G", "NORTH SIDE LLC"), ("P", "10 MAIN"), ("S", "F1"),
             ("U", "1000"), ("Z", "400"), ("AA", "1990"), ("AB", "10"), ("AD", "12"), ("AF", "2026")],
            [("C", "11"), ("E", "R"), ("G", "JANE DOE"), ("H", "9 OAK"), ("S", "F1"), ("AF", "2026")],
            [("C", "12"), ("E", "R"), ("S", "L3"), ("AF", "2026")],
            [("C", "13"), ("E", "R"), ("S", "A1"), ("AF", "2026")],
            [("C", "14"), ("E", "R"), ("S", ""), ("AF", "2026")],
            [("C", "15"), ("E", "P"), ("S", "F1"), ("AF", "2026")],
            [("C", "16"), ("E", "R"), ("S", "F3"), ("AF", "2026")],
            [("C", "10"), ("E", "R"), ("S", "F2"), ("AF", "2026")],
        ]
        dest = Path(tempfile.mkdtemp()) / "andrews.xlsx"
        with zipfile.ZipFile(dest, "w") as zf:
            zf.writestr("xl/worksheets/sheet1.xml", _sheet(rows))
        tally: dict = {}
        kept = list(read_roll(dest, tally))
        self.assertEqual([r.apn for r in kept], ["10", "11", "16"])
        self.assertEqual(kept[0].state_category, "F1")
        self.assertEqual(kept[0].owner_name, "NORTH SIDE LLC")
        self.assertEqual(kept[0].situs_address, "10 MAIN")
        self.assertIsNone(kept[1].owner_name)
        self.assertIsNone(kept[1].owner_mailing_address)
        self.assertEqual(kept[2].state_category, "F1")
        self.assertEqual(kept[2].local_use_code, "F3")
        self.assertTrue(all(r.owner_name != "JANE DOE" for r in kept))
        self.assertEqual(tally["input_records"], 8)
        self.assertEqual(tally["kept"], 3)
        self.assertEqual(tally["not_real"], 1)
        self.assertEqual(tally["ambiguous"], 1)
        self.assertEqual(tally["out_of_scope"], 1)
        self.assertEqual(tally["unmapped"], 1)
        self.assertEqual(tally["duplicate_ids"], 1)
        self.assertEqual(tally["missing_id"], 0)
        self.assertEqual(tally["org_owner_facts"], 1)
        self.assertEqual(tally["input_records"], tally["kept"] + tally["not_real"] + tally["ambiguous"]
                         + tally["out_of_scope"] + tally["unmapped"] + tally["duplicate_ids"] + tally["missing_id"])


if __name__ == "__main__":
    unittest.main()
