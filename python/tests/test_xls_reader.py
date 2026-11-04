"""Legacy .xls (BIFF8) reader tests on a SYNTHETIC workbook built in the test (an OLE2 compound file with one sheet).

Every cell value here is invented; the builder writes only the records the reader reads.
"""

import struct
import tempfile
import unittest
from pathlib import Path

from factlot.registry.adapters import ny_sales, xls_reader

END, FREE, FATSECT = 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD


def rec(rid: int, data: bytes) -> bytes:
    return struct.pack("<HH", rid, len(data)) + data


def bof(kind: int) -> bytes:
    return rec(0x0809, struct.pack("<HHHHII", 0x0600, kind, 0x0DBB, 0x07CC, 0, 0x06))


def rk_int(n: int) -> int:
    return ((n & 0x3FFFFFFF) << 2) | 2


def sst_records(strings: list[str], split_in_first: int | None = None) -> bytes:
    """An SST (and CONTINUE) record. ``split_in_first`` cuts the first string's characters there, to test a boundary."""
    body = b""
    for s in strings:
        wide = any(ord(c) > 255 for c in s)
        body += struct.pack("<HB", len(s), 1 if wide else 0) + (s.encode("utf-16-le") if wide else s.encode("latin-1"))
    head = struct.pack("<II", len(strings), len(strings))
    if split_in_first is None:
        return rec(0x00FC, head + body)
    cut = 2 + 1 + split_in_first  # length, flags, then characters
    return rec(0x00FC, head + body[:cut]) + rec(0x003C, b"\x00" + body[cut:])


def workbook(strings: list[str], sheet_cells: bytes, split_in_first: int | None = None) -> bytes:
    sst = sst_records(strings, split_in_first)

    def globals_(sheet_offset: int) -> bytes:
        name = b"Sheet1"
        boundsheet = rec(0x0085, struct.pack("<IBBBB", sheet_offset, 0, 0, len(name), 0) + name)
        return bof(0x0005) + boundsheet + sst + rec(0x000A, b"")

    glob = globals_(len(globals_(0)))  # the sheet starts right after the globals
    return glob + bof(0x0010) + sheet_cells + rec(0x000A, b"")


def compound(stream: bytes) -> bytes:
    """An OLE2 compound file (512-byte sectors) holding ``stream`` as 'Workbook'; padded to the 4096 mini-stream cutoff."""
    stream = stream.ljust(4096, b"\x00")
    n = (len(stream) + 511) // 512
    stream = stream.ljust(n * 512, b"\x00")
    fat = [FATSECT, END] + [i + 3 for i in range(n - 1)] + [END]
    fat_sector = struct.pack("<128I", *(fat + [FREE] * (128 - len(fat))))
    header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 16 + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\x00" * 6
    header += struct.pack("<I", 0)  # directory sectors (version 3: 0)
    header += struct.pack("<IIIIIIII", 1, 1, 0, 4096, END, 0, END, 0)  # FAT count, dir start, tx, cutoff, minifat, n, difat, n
    header += struct.pack("<109I", 0, *([FREE] * 108))
    assert len(header) == 512, len(header)

    def entry(name: str, kind: int, start: int, size: int) -> bytes:
        raw = name.encode("utf-16-le") + b"\x00\x00"
        out = (raw.ljust(64, b"\x00") + struct.pack("<HBB", len(raw), kind, 1) + struct.pack("<III", FREE, FREE, FREE) + b"\x00" * 16
               + struct.pack("<I", 0) + b"\x00" * 16 + struct.pack("<IQ", start, size))
        assert len(out) == 128, len(out)
        return out

    directory = (entry("Root Entry", 5, END, 0) + entry("Workbook", 2, 2, len(stream))).ljust(512, b"\x00")
    return header + fat_sector + directory + stream


def write(d: Path, name: str, strings: list[str], cells: bytes, split_in_first: int | None = None) -> Path:
    p = d / name
    p.write_bytes(compound(workbook(strings, cells, split_in_first)))
    return p


class TestXlsReader(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_strings_numbers_rk_and_mulrk(self):
        cells = (
            rec(0x00FD, struct.pack("<HHHI", 0, 0, 0, 0)) + rec(0x00FD, struct.pack("<HHHI", 0, 2, 0, 1))
            + rec(0x0203, struct.pack("<HHHd", 1, 1, 0, 1234.5))
            + rec(0x027E, struct.pack("<HHHI", 2, 0, 0, rk_int(42)))
            + rec(0x027E, struct.pack("<HHHI", 2, 1, 0, rk_int(1250) | 1))  # 12.50 (the /100 flag)
            + rec(0x00BD, struct.pack("<HH", 4, 0) + struct.pack("<HI", 0, rk_int(7)) + struct.pack("<HI", 0, rk_int(-3)) + struct.pack("<H", 1))
        )
        p = write(self.dir, "a.xls", ["BOROUGH\n", "Zoë Ångström"], cells)
        rows = list(xls_reader.rows(p))
        self.assertEqual(rows[0], ["BOROUGH\n", None, "Zoë Ångström"])
        self.assertEqual(rows[1], [None, 1234.5])
        self.assertEqual(rows[2], [42.0, 12.5])
        self.assertEqual(rows[3], [])  # a blank row is an empty list
        self.assertEqual(rows[4], [7.0, -3.0])

    def test_a_string_split_across_a_continue_record(self):
        cells = rec(0x00FD, struct.pack("<HHHI", 0, 0, 0, 0)) + rec(0x00FD, struct.pack("<HHHI", 0, 1, 0, 1))
        p = write(self.dir, "b.xls", ["ABCDEFGHIJ", "next"], cells, split_in_first=5)
        self.assertEqual(list(xls_reader.rows(p)), [["ABCDEFGHIJ", "next"]])

    def test_a_formula_with_a_cached_number(self):
        cells = rec(0x0006, struct.pack("<HHH", 0, 0, 0) + struct.pack("<d", 99.0) + b"\x00" * 6)
        p = write(self.dir, "c.xls", ["x"], cells)
        self.assertEqual(list(xls_reader.rows(p)), [[99.0]])

    def test_other_files_are_refused(self):
        junk = self.dir / "d.xls"
        junk.write_bytes(b"not a workbook" * 100)
        with self.assertRaises(ValueError):
            list(xls_reader.rows(junk))

    def test_the_sales_adapter_reads_an_xls_workbook(self):
        header = ["BOROUGH\n", "NEIGHBORHOOD\n", "BUILDING CLASS CATEGORY\n", "TAX CLASS AT PRESENT", "BLOCK\n", "LOT\n", "EASE-MENT\n",
                  "BUILDING CLASS AT PRESENT", "ADDRESS\n", "APARTMENT NUMBER\n", "ZIP CODE\n", "RESIDENTIAL UNITS\n", "COMMERCIAL UNITS\n",
                  "TOTAL UNITS\n", "LAND SQUARE FEET\n", "GROSS SQUARE FEET\n", "YEAR BUILT\n", "TAX CLASS AT TIME OF SALE\n",
                  "BUILDING CLASS AT TIME OF SALE\n", "SALE PRICE\n", "SALE DATE\n"]
        strings = ["SYNTHETIC SALES FOR 2017", *header, "INVENTED", "21 OFFICE BUILDINGS      ", "O4", " "]
        idx = {s: i for i, s in enumerate(strings)}
        cells = rec(0x00FD, struct.pack("<HHHI", 0, 0, 0, 0))
        for c, h in enumerate(header):
            cells += rec(0x00FD, struct.pack("<HHHI", 1, c, 0, idx[h]))
        # one data row: Manhattan block 9 lot 1, class O4, $12.5 million, 2017-03-14 (serial 42808)
        values = {0: 1.0, 4: 9.0, 5: 1.0, 11: 0.0, 12: 3.0, 13: 3.0, 14: 20000.0, 15: 90000.0, 16: 1980.0, 17: 4.0, 19: 12500000.0, 20: 42808.0}
        text = {1: "INVENTED", 2: "21 OFFICE BUILDINGS      ", 7: "O4", 9: " ", 18: "O4"}
        for c, v in values.items():
            cells += rec(0x0203, struct.pack("<HHHd", 2, c, 0, v))
        for c, t in text.items():
            cells += rec(0x00FD, struct.pack("<HHHI", 2, c, 0, idx[t]))
        p = write(self.dir, "2017_manhattan.xls", strings, cells)
        out = list(ny_sales.read_sales(p))
        self.assertEqual(len(out), 1)
        (pred, value, _unit), = out[0].facts
        self.assertEqual((out[0].county_fips, out[0].apn, pred), ("061", "1000090001", "transaction.sale"))
        self.assertEqual((value["date"], value["price_usd"], value["building_class"], value["tax_class"]), ("2017-03-14", 12500000, "O4", "4"))
        self.assertEqual((value["commercial_units"], value["gross_area_sf"]), (3, 90000))


if __name__ == "__main__":
    unittest.main()
