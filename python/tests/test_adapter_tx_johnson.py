"""Johnson CAD: the 2026 extract (one row per building), and 2025 and 2024 rolls as value history only."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters import tx_johnson
from factlot.registry.adapters.tx_tab_extract import ExtractTally, check_year
from factlot.registry.store import Registry

NAL_HEADER = ["ACCOUNT", "GEO ACCOUNT NUM", "NAME", "NAME2", "MAIL ADDRESS LINE 1", "MAIL ADDRESS LINE 2", "MAIL CITY",
              "MAIL STATE", "MAIL ZIP", "SITUS STREET NUM", "SITUS STREET NAME", "SITUS UNIT", "SITUS CITY",
              "SITUS STREET SFX", "NBHD CD", "PARCEL USE CD", "USE CD DESC", "BUILDING PTD", "LAND PTD", "LAND SQFT",
              "BLDG HEAT AREA", "YEAR_BUILT", "MKT VAL", "APPRAISED VAL"]


def _nal(acct, name, code, *, year="1984", mkt="521923"):
    return "\t".join([acct, "126.0002.02130", name, "", "PO BOX 9", "", "CLEBURNE", "TX", "76033", "3233", "MAIN", "",
                      "CLEBURNE", "ST", "126.0002", code, "label", code, code, "123841.0000", "26780", year, mkt, mkt])


def _extract(path: Path, rows: list[str]) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("externalnal.tab", "\r\n".join(["\t".join(NAL_HEADER), *rows, ""]))
        zf.writestr("externalacreage.tab", "parcel_id\tstrap\tAcreage\r\n")
    return path


class JohnsonExtract(unittest.TestCase):
    def test_repeated_building_rows_collapse_to_one_account(self):
        with tempfile.TemporaryDirectory() as d:
            path = _extract(Path(d) / "BATCH_896.all_.zip", [
                _nal("R000000492", "ACME HOLDINGS LLC", "F1", year="1990"),
                _nal("R000000492", "ACME HOLDINGS LLC", "F1", year="1984"),
                _nal("R000000500", "DUPLEX LLC", "B2"),
                _nal("R000000501", "VACANT LLC", "C2"),
                _nal("M000000001", "MINERAL LLC", ""),
            ])
            tally = ExtractTally()
            rows = {r.apn: r for r in tx_johnson.read_roll(path, 2026, tally)}
        self.assertEqual(sorted(rows), ["R000000492", "R000000500"])
        acme = rows["R000000492"]
        self.assertEqual(acme.year_built, 1984)  # the earliest building
        self.assertEqual(acme.state_category, "F1")
        self.assertEqual(acme.extra_facts, [("parcel.neighborhood_code", "126.0002", None)])
        self.assertEqual(rows["R000000500"].state_category, "B")
        self.assertEqual((tally.repeated_rows, tally.out_of_scope, tally.unmapped_code), (1, 1, 1))

    def test_a_date_in_the_name_is_not_a_tax_year(self):
        check_year("JCAD-2025-Certified-Data-2026-04-27.zip", "externalnal.tab", 2025)
        check_year("BATCH_896.all_.zip", "externalnal.tab", 2026)
        with self.assertRaises(ValueError):
            check_year("JCAD-2025-Certified-Data-2026-04-27.zip", "externalnal.tab", 2026)

    def test_history_from_the_extract_and_the_web_extract(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            current = _extract(tmp / "BATCH_896.all_.zip", [_nal("R000000492", "ACME HOLDINGS LLC", "F1"),
                                                             _nal("R000000500", "JANE PERSON", "B1")])
            db = tmp / "reg.db"
            stats, _ = tx_johnson.build(current, db, as_of="2026-08-10", tax_year=2026)
            self.assertEqual((stats.kept, stats.owners_person_or_withheld), (2, 1))
            prior = _extract(tmp / "JCAD-2025-Certified-Data-2026-04-27.zip",
                             [_nal("R000000492", "OLD NAME LLC", "F1", mkt="500000")])
            h25 = tx_johnson.build_history(prior, db, as_of="2026-04-27", tax_year=2025)
            self.assertEqual((h25.kept, h25.source_id), (1, "tx-johnson-cad-2025"))
            web = tmp / "2024-Certified-Data-Roll-1.zip"
            with zipfile.ZipFile(web, "w") as zf:
                zf.writestr("1262024072413281601WEBMAIN.CSV",
                            "APPRAISAL_YR,ACCOUNT_NUM,OWN_NAME,AAY_TOT_VAL,AAY_APPR_VAL\r\n"
                            "2024,R000000492,WEB OWNER LLC,480000,470000\r\n"
                            "2023,R000000500,JANE PERSON,1,1\r\n"
                            "2024,R000009999,OTHER LLC,1,1\r\n")
            h24 = tx_johnson.build_history(web, db, as_of="2024-07-24", tax_year=2024)
            self.assertEqual((h24.kept, h24.skipped_invalid), (1, 1))
            reg = Registry(db)
            try:
                values = [tuple(r) for r in reg.db.execute(
                    "SELECT s.source_id, f.value_json FROM facts f JOIN snapshots s ON s.document_id = f.document_id "
                    "WHERE f.predicate = 'parcel.market_value' AND f.subject LIKE '%r000000492%' ORDER BY s.source_id")]
            finally:
                reg.close()
            self.assertEqual(values, [("tx-johnson-cad", "521923.0"), ("tx-johnson-cad-2024", "480000.0"),
                                      ("tx-johnson-cad-2025", "500000.0")])
            blob = db.read_bytes()
            for name in (b"JANE PERSON", b"OLD NAME LLC", b"WEB OWNER LLC"):
                self.assertNotIn(name, blob)


if __name__ == "__main__":
    unittest.main()
