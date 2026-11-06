"""Bastrop vendor tab: commercial use codes only, no sale parties, no person names."""

import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters.tx_bastrop import read_roll
from factlot.registry.store import Registry, Source


def _zip(members: dict[str, list[dict]]) -> Path:
    tmp = Path(tempfile.mkdtemp())
    path = tmp / "bastrop.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for name, rows in members.items():
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=list(rows[0]), delimiter="\t", lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
            zf.writestr(name, buf.getvalue())
    return path


class BastropTab(unittest.TestCase):
    def test_keeps_commercial_use_codes_and_drops_person_and_sale_names(self):
        nal = [
            {"PARCEL ID": "1", "PARCEL USE CD": "F1", "USE CD DESC": "REAL, Commercial",
             "SITUS STREET NUM": "10", "SITUS STREET NAME": "MAIN", "SITUS STREET SFX": "ST",
             "SITUS UNIT": "", "SITUS CITY": "BASTROP", "BLDG HEAT AREA": "1000", "YEAR_BUILT": "1990",
             "LAND SQFT": "5000", "MKT VAL": "10", "APPRAISED VAL": "9"},
            {"PARCEL ID": "1", "PARCEL USE CD": "F1", "USE CD DESC": "REAL, Commercial",
             "SITUS STREET NUM": "10", "SITUS STREET NAME": "MAIN", "SITUS STREET SFX": "",
             "SITUS UNIT": "", "SITUS CITY": "BASTROP", "BLDG HEAT AREA": "", "YEAR_BUILT": "",
             "LAND SQFT": "", "MKT VAL": "", "APPRAISED VAL": ""},
            {"PARCEL ID": "2", "PARCEL USE CD": "A1", "USE CD DESC": "REAL, RESIDENTIAL",
             "SITUS STREET NUM": "2", "SITUS STREET NAME": "OAK", "SITUS STREET SFX": "",
             "SITUS UNIT": "", "SITUS CITY": "BASTROP", "BLDG HEAT AREA": "", "YEAR_BUILT": "",
             "LAND SQFT": "", "MKT VAL": "", "APPRAISED VAL": ""},
            {"PARCEL ID": "3", "PARCEL USE CD": "B2", "USE CD DESC": "DUPLEX",
             "SITUS STREET NUM": "3", "SITUS STREET NAME": "ELM", "SITUS STREET SFX": "",
             "SITUS UNIT": "", "SITUS CITY": "BASTROP", "BLDG HEAT AREA": "800", "YEAR_BUILT": "2001",
             "LAND SQFT": "4000", "MKT VAL": "8", "APPRAISED VAL": "8"},
        ]
        owners = [
            {"parcel_id": "1", "strap": "1", "own_num": "2", "own_name": "JANE PERSON"},
            {"parcel_id": "1", "strap": "1", "own_num": "1", "own_name": "ACME HOLDINGS LLC"},
            {"parcel_id": "3", "strap": "3", "own_num": "1", "own_name": "JOHN OWNER"},
        ]
        sales = [{"parcel_id": "1", "grantee": "SECRET BUYER", "grantor": "SECRET SELLER", "price": "99"}]
        path = _zip({"externalnal.tab": nal, "externalowner.tab": owners, "externalsale.tab": sales})
        tally: dict = {}
        rows = {r.apn: r for r in read_roll(path, tally)}
        self.assertEqual(sorted(rows), ["1", "3"])
        self.assertEqual(rows["1"].owner_name, "ACME HOLDINGS LLC")
        self.assertIsNone(rows["3"].owner_name)
        self.assertEqual(rows["1"].state_category, "F1")
        self.assertEqual(rows["3"].state_category, "B")
        self.assertEqual(tally["input_records"], 4)
        self.assertEqual(tally["kept"], 2)
        self.assertEqual(tally["duplicate_ids"], 1)
        self.assertEqual(tally["out_of_scope"], 1)
        self.assertTrue(tally["input_records"] == tally["kept"] + tally["duplicate_ids"] + tally["out_of_scope"])
        db = path.parent / "reg.db"
        reg = Registry(db)
        try:
            reg.ingest_roll(
                Source(source_id="tx-bastrop-cad", publisher="Bastrop", title="tab", url="https://bastropcad.org/exports-valuation-reports/",
                       state_fips="48", county_fips="021", license="test", ai_use="unknown", redistribution="unknown",
                       attribution="test", terms_reviewed="2026-11-06"),
                path, read_roll(path), as_of="2026-10-01", state_fips="48", account_system="bastrop_parcel_id", full_roll=True)
        finally:
            reg.close()
        blob = db.read_bytes()
        self.assertNotIn(b"JANE PERSON", blob)
        self.assertNotIn(b"JOHN OWNER", blob)
        self.assertNotIn(b"SECRET BUYER", blob)
        self.assertNotIn(b"SECRET SELLER", blob)


if __name__ == "__main__":
    unittest.main()
