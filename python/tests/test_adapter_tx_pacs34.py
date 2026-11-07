"""PACS 8.0.34 reader: commercial scope, person suppression, and no guessed codes."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters.tx_pacs34 import GALVESTON, ExportTally, read_roll
from factlot.registry.store import Registry


def _info(pid: str, kind: str, local: str, owner: str, confidential: str = "F") -> str:
    line = [" "] * 9714
    def put(start: int, text: str) -> None:
        line[start - 1:start - 1 + len(text)] = list(text)
    put(1, f"{pid:>12}")
    put(13, f"{kind:<5}")
    put(18, "2026 ")
    put(609, f"{owner:<70}")
    put(990, confidential)
    put(991, "F")
    put(1040, "N ")
    put(1050, "MAIN")
    put(1110, "GALVESTON")
    put(1140, "77550")
    put(2732, f"{local:<10}")
    put(4214, "00000000010000")
    put(4460, "10")
    return "".join(line)


def _detail(pid: str, typ: str, desc: str, year: str, area: str) -> str:
    line = [" "] * 200
    line[0:12] = list(f"{pid:>12}")
    line[40:50] = list(f"{typ:<10}")
    line[50:75] = list(f"{desc:<25}")
    line[85:89] = list(f"{year:>4}")
    line[93:108] = list(f"{area:>15}")
    return "".join(line)


def _state(code: str, ptd: str) -> str:
    line = [" "] * 80
    line[0:len(code)] = list(code)
    line[60:60 + len(ptd)] = list(ptd)
    return "".join(line)


class Pacs34(unittest.TestCase):
    def test_keeps_commercial_organisations_and_drops_people(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "export.zip"
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr("2026_APPRAISAL_STATE_CODE.TXT", "\r\n".join((_state("F1", "F1"), _state("A1", "A"), "")))
                zf.writestr("2026_APPRAISAL_IMPROVEMENT_DETAIL.TXT",
                            _detail("1", "MA", "MAIN AREA", "1998", "1500") + "\r\n"
                            + _detail("1", "OP", "OPEN PORCH", "1998", "40") + "\r\n")
                zf.writestr("2026_APPRAISAL_INFO.TXT", "\r\n".join((
                    _info("1", "R", "F1", "ACME HOLDINGS LLC"),
                    _info("2", "R", "A1", "JANE PERSON"),
                    _info("3", "R", "F1", "JANE PERSON"),
                    _info("1", "R", "F1", "SECOND ROW LLC"),
                    _info("4", "P", "F1", "PERSONAL PROPERTY LLC"),
                    _info("5", "R", "F1", "SECRET OWNER", confidential="T"),
                    _info("6", "R", "ZZ", "UNKNOWN CODE LLC"),
                    "",
                )))
            tally = ExportTally()
            rows = list(read_roll(path, "167", tally))
            self.assertEqual([r.apn for r in rows], ["1", "3", "5"])
            self.assertEqual(rows[0].owner_name, "ACME HOLDINGS LLC")
            self.assertEqual(rows[0].improvement_area_sf, 1500)
            self.assertEqual(rows[0].year_built, 1998)
            self.assertEqual(rows[0].state_category, "F1")
            self.assertEqual(rows[0].local_use_code, "F1")
            self.assertEqual(rows[1].owner_name, "JANE PERSON")
            self.assertTrue(rows[2].owner_confidential)
            self.assertIsNone(rows[2].owner_name)
            self.assertEqual(tally.duplicate_ids, 1)
            self.assertEqual(tally.not_real, 1)
            self.assertEqual(tally.out_of_scope, 1)
            self.assertEqual(tally.unmapped_code, 1)
            db = Path(tmp) / "reg.db"
            reg = Registry(db)
            try:
                stats = reg.ingest_roll(
                    GALVESTON.source, path, read_roll(path, "167"), as_of="2026-07-20",
                    state_fips="48", account_system=GALVESTON.account_system, full_roll=True)
            finally:
                reg.close()
            self.assertEqual(stats.kept, 3)
            self.assertEqual(stats.owners_person_or_withheld, 2)
            blob = Path(db).read_bytes()
            self.assertNotIn(b"JANE PERSON", blob)
            self.assertNotIn(b"SECRET OWNER", blob)
            self.assertIn(b"ACME HOLDINGS LLC", blob)

    def test_record_break_is_crlf_and_a_short_row_is_rejected(self):
        info = _info("7", "R", "F1", "ACME\nHOLDINGS LLC")
        self.assertEqual(len(info), 9714)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "export.zip"
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr("APPRAISAL_STATE_CODE.TXT", _state("F1", "F1") + "\r\n")
                zf.writestr("APPRAISAL_INFO.TXT", (info + "\r\n" + "TOO SHORT" + "\r\n").encode("latin-1"))
            tally = ExportTally()
            rows = list(read_roll(path, "167", tally))
        self.assertEqual([r.apn for r in rows], ["7"])
        self.assertEqual(rows[0].owner_name, "ACME HOLDINGS LLC")
        self.assertEqual(tally.short_rows, 1)
        self.assertEqual(tally.info_rows, 2)


if __name__ == "__main__":
    unittest.main()
