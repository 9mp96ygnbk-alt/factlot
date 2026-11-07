"""Midland web property file: commercial real property only, no birth dates, no person names."""

import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters.tx_midland_web import read_webprop
from factlot.registry.store import Registry, Source


def _zip(rows: list[dict], fields: list[str]) -> Path:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    tmp = Path(tempfile.mkdtemp())
    path = tmp / "web.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("export_webprop.txt", buf.getvalue())
    return path


FIELDS = ["webprop_id", "webprop_ptdimp", "webprop_ptdlnd", "webprop_ptdmin", "webprop_name",
          "webprop_situs", "webprop_confidential"]


class MidlandWeb(unittest.TestCase):
    def test_mineral_code_does_not_make_a_commercial_parcel(self):
        path = _zip([
            {"webprop_id": "1", "webprop_ptdimp": "F1", "webprop_ptdlnd": "", "webprop_ptdmin": "G1",
             "webprop_name": "ACME HOLDINGS LLC", "webprop_situs": "1 MAIN", "webprop_confidential": "N"},
            {"webprop_id": "2", "webprop_ptdimp": "", "webprop_ptdlnd": "", "webprop_ptdmin": "F2",
             "webprop_name": "MINERAL CO LLC", "webprop_situs": "2 MAIN", "webprop_confidential": "N"},
            {"webprop_id": "3", "webprop_ptdimp": "F1", "webprop_ptdlnd": "A1", "webprop_ptdmin": "",
             "webprop_name": "JANE PERSON", "webprop_situs": "3 MAIN", "webprop_confidential": "N"},
            {"webprop_id": "4", "webprop_ptdimp": "B2", "webprop_ptdlnd": "", "webprop_ptdmin": "",
             "webprop_name": "SECRET OWNER LLC", "webprop_situs": "4 MAIN", "webprop_confidential": "Y"},
        ], FIELDS)
        rows = {r.apn: r for r in read_webprop(path)}
        self.assertEqual(sorted(rows), ["1", "3", "4"])
        self.assertEqual(rows["1"].state_category, "F1")
        self.assertEqual(rows["1"].owner_name, "ACME HOLDINGS LLC")
        self.assertIsNone(rows["3"].owner_name)
        self.assertTrue(rows["4"].owner_confidential)
        self.assertIsNone(rows["4"].owner_name)
        self.assertIsNone(rows["4"].situs_address)
        db = path.parent / "reg.db"
        reg = Registry(db)
        try:
            reg.ingest_roll(
                Source(source_id="tx-midland-web", publisher="Midland", title="web", url="https://midcad.org/open-records/",
                       state_fips="48", county_fips="329", license="test", ai_use="unknown", redistribution="unknown",
                       attribution="test", terms_reviewed="2026-11-06"),
                path, read_webprop(path), as_of="2026-08-06", state_fips="48",
                account_system="midland_webprop_id", full_roll=True)
        finally:
            reg.close()
        blob = db.read_bytes()
        self.assertNotIn(b"JANE PERSON", blob)
        self.assertNotIn(b"SECRET OWNER", blob)

    def test_birth_date_column_is_refused(self):
        path = _zip([
            {"webprop_id": "1", "webprop_ptdimp": "F1", "webprop_birthdate": "2000-01-01"},
        ], ["webprop_id", "webprop_ptdimp", "webprop_birthdate"])
        with self.assertRaises(ValueError):
            list(read_webprop(path))


if __name__ == "__main__":
    unittest.main()
