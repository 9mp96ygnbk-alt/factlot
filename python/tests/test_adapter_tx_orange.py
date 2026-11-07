"""Orange property export: real property with a stated commercial code, no owner fields."""

import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters.tx_orange import read_property

FIELDS = ["PropertyQuickRefID", "PropertyNumber", "StateCodeImp", "StateCodeLand", "SitusStreetAddress",
          "SitusCity", "TaxYear"]


def _export(rows: list[dict]) -> Path:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as zf:
        zf.writestr("data/PropertyExport.txt", buf.getvalue())
    path = Path(tempfile.mkdtemp()) / "orange.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("2026 Export Vendor.zip", inner.getvalue())
    return path


def _row(quick: str, number: str, imp: str, land: str = "") -> dict:
    return {"PropertyQuickRefID": quick, "PropertyNumber": number, "StateCodeImp": imp, "StateCodeLand": land,
            "SitusStreetAddress": "10 MAIN", "SitusCity": "ORANGE", "TaxYear": "2026"}


class OrangeExport(unittest.TestCase):
    def test_keeps_commercial_real_rows_only(self):
        path = _export([
            _row("R1", "1", "F1"),
            _row("R2", "2", "", "B2"),
            _row("R3", "3", "A1"),
            _row("R4", "4", "F3"),
            _row("P5", "5", "F1"),
            _row("R1", "1", "F2"),
        ])
        tally: dict = {}
        rows = list(read_property(path, tally))
        self.assertEqual([r.apn for r in rows], ["1", "2"])
        self.assertEqual([r.state_category for r in rows], ["F1", "B"])
        self.assertEqual(rows[0].situs_address, "10 MAIN, ORANGE, TX")
        self.assertTrue(all(r.owner_name is None for r in rows))
        self.assertEqual((tally["input_records"], tally["kept"], tally["not_real"], tally["out_of_scope"],
                          tally["duplicate_ids"]), (6, 2, 1, 2, 1))


if __name__ == "__main__":
    unittest.main()
