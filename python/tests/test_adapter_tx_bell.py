"""Bell CAD: the 2026 tab-delimited extract, and earlier PACS rolls as value history only."""

import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters import tx_bell, tx_pacs34
from factlot.registry.adapters.tx_bell import read_roll
from factlot.registry.adapters.tx_tab_extract import ExtractTally
from factlot.registry.store import Registry

FOLDER = "2026 Bell County Certified Export/"
NAL_HEADER = ["PARCEL ID", "STRAP", "NAME", "NAME2", "MAIL ADDRESS LINE 1", "MAIL ADDRESS LINE 2", "MAIL CITY",
              "MAIL STATE", "MAIL ZIP", "SITUS STREET NUM", "SITUS STREET NAME", "SITUS UNIT", "SITUS CITY",
              "SITUS STREET SFX", "NBHD CD", "MKT AREA CD", "PARCEL USE CD", "USE CD DESC", "LAND SQFT",
              "BLDG HEAT AREA", "YEAR_BUILT", "MKT VAL", "APPRAISED VAL"]


def _nal(pid, name, code, *, land="10000.0000", area="5000", year="1999", nbhd="CTE01", mkt="900000",
         appr="850000", name2=""):
    return "\t".join([pid, pid.zfill(10), name, name2, "PO BOX 1", "", "TEMPLE", "TX", "76501", "100", "MAIN",
                      "", "TEMPLE", "ST", nbhd, "TE01", code, "label", land, area, year, mkt, appr])


def _export(tmp: Path, rows: list[str], *, folder: str = FOLDER, acreage: list[str] = ()) -> Path:
    path = tmp / "2026-Bell-County-Certified-Export-3.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(folder + "externalnal.tab", "\r\n".join(["\t".join(NAL_HEADER), *rows, ""]).encode("latin-1"))
        zf.writestr(folder + "externalacreage.tab", "\r\n".join(["parcel_id\tstrap\tAcreage", *acreage, ""]))
        zf.writestr(folder + "externalowner.tab", "parcel_id\tstrap\town_num\town_name\r\n9\t9\t1\tJANE PERSON\r\n")
    return path


def _info(pid: str, year: str, market: str, appraised: str, kind: str = "R") -> str:
    """A PACS property record (9,247 characters, as Bell's 2025 file), with the columns history reads."""
    line = [" "] * 9247

    def put(start: int, text: str) -> None:
        line[start - 1:start - 1 + len(text)] = list(text)
    put(1, f"{pid:>12}")
    put(13, f"{kind:<5}")
    put(18, year)
    put(609, f"{'OLD OWNER LLC':<70}")
    put(1916, f"{appraised:>15}")
    put(4214, f"{market:>14}")
    return "".join(line)


class BellExtract(unittest.TestCase):
    def test_commercial_scope_owner_rules_and_neighborhood(self):
        with tempfile.TemporaryDirectory() as d:
            path = _export(Path(d), [
                _nal("0101", "ACME HOLDINGS LLC", "F1"),
                _nal("102", "JANE PERSON", "B2"),
                _nal("103", "CONFIDENTIAL OWNER", "F2"),
                _nal("104", "HOMES LLC", "A1"),
                _nal("105", "LOTS LLC", "C2"),
                _nal("106", "ODD CODE LLC", "ZZ"),
                _nal("107", "SHELL LLC", "F3", land="", area="0", year="0", nbhd=""),
                _nal("101", "SECOND ROW LLC", "F1"),
                "108\tbroken row",
            ], acreage=["107\t0000000107\t2.5000"])
            tally = ExtractTally()
            rows = {r.apn: r for r in read_roll(path, 2026, tally)}
        self.assertEqual(sorted(rows), ["101", "102", "103", "107"])
        acme = rows["101"]
        self.assertEqual((acme.state_category, acme.local_use_code), ("F1", "F1"))
        self.assertEqual(acme.owner_name, "ACME HOLDINGS LLC")
        self.assertEqual(acme.owner_mailing_address, "PO BOX 1, TEMPLE, TX 76501")
        self.assertEqual(acme.situs_address, "100 MAIN ST, TEMPLE TX")
        self.assertEqual((acme.land_area_sf, acme.improvement_area_sf, acme.year_built), (10000.0, 5000.0, 1999))
        self.assertEqual((acme.market_value, acme.appraised_value, acme.tax_year), (900000.0, 850000.0, 2026))
        self.assertEqual(acme.extra_facts, [("parcel.neighborhood_code", "CTE01", None)])
        self.assertEqual(rows["102"].state_category, "B")
        self.assertTrue(rows["103"].owner_confidential)
        self.assertIsNone(rows["103"].owner_name)
        self.assertIsNone(rows["103"].owner_mailing_address)
        shell = rows["107"]
        self.assertEqual(shell.state_category, "F1")  # the district reports F3 under F1
        self.assertEqual(shell.land_area_sf, 108900.0)  # 2.5 acres from externalacreage.tab
        self.assertIsNone(shell.improvement_area_sf)
        self.assertIsNone(shell.year_built)
        self.assertEqual(shell.extra_facts, [])
        self.assertEqual((tally.malformed, tally.repeated_rows, tally.unmapped_code, tally.out_of_scope),
                         (1, 1, 1, 2))
        self.assertEqual(tally.confidential, 1)

    def test_folder_year_must_match(self):
        with tempfile.TemporaryDirectory() as d:
            path = _export(Path(d), [_nal("1", "ACME HOLDINGS LLC", "F1")], folder="2025 Bell County Certified Export/")
            with self.assertRaises(ValueError):
                list(read_roll(path, 2026))

    def test_ingest_drops_people_and_history_adds_values_only(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            path = _export(tmp, [_nal("1", "ACME HOLDINGS LLC", "F1"), _nal("2", "JANE PERSON", "B1")])
            db = tmp / "reg.db"
            stats, _ = tx_bell.build(path, db, as_of="2026-10-01", tax_year=2026)
            self.assertEqual(stats.kept, 2)
            self.assertEqual(stats.owners_person_or_withheld, 1)
            prior = tmp / "2025_export.zip"
            with zipfile.ZipFile(prior, "w") as zf:
                zf.writestr("2025-07-22_002320_APPRAISAL_INFO.TXT", "\r\n".join((
                    _info("1", "2025", "800000", "780000"),
                    _info("1", "2025", "1", "1"),  # a second row of the same account: the first wins
                    _info("3", "2025", "500000", "500000"),  # not a registry parcel
                    _info("2", "2025", "300000", "300000", kind="P"),  # not real property
                    "",
                )))
            hstats, htally = tx_bell.build_history(prior, db, as_of="2025-07-22", tax_year=2025)
            self.assertEqual(hstats.kept, 1)
            self.assertEqual(hstats.source_id, "tx-bell-cad-2025")
            self.assertEqual((htally.duplicate_ids, htally.not_real), (1, 1))
            reg = Registry(db)
            try:
                facts = reg.db.execute(
                    "SELECT f.predicate, f.value_json FROM facts f JOIN snapshots s ON s.document_id = f.document_id "
                    "WHERE s.source_id = 'tx-bell-cad-2025' ORDER BY f.predicate").fetchall()
            finally:
                reg.close()
            self.assertEqual([p for p, _ in facts], ["parcel.appraised_value", "parcel.market_value", "parcel.tax_year"])
            blob = db.read_bytes()
            self.assertNotIn(b"JANE PERSON", blob)
            self.assertNotIn(b"OLD OWNER LLC", blob)
            self.assertIn(b"ACME HOLDINGS LLC", blob)

    @unittest.skipIf(shutil.which("bsdtar") is None, "bsdtar is not installed")
    def test_history_streams_a_7z_archive(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            src = tmp / "src"
            src.mkdir()
            (src / "2025-07-22_002320_APPRAISAL_INFO.TXT").write_bytes(
                (_info("1", "2025", "800000", "780000") + "\r\n").encode("latin-1"))
            archive = tmp / "2025-Bell-County-Certified-Export.7z"
            subprocess.run(["bsdtar", "--format", "7zip", "-cf", str(archive), "-C", str(src), "."], check=True)
            values = list(tx_pacs34.read_value_history(archive, ["1"], "027"))
        self.assertEqual([(v.apn, v.tax_year, v.market_value, v.appraised_value) for v in values],
                         [("1", 2025, 800000.0, 780000.0)])


if __name__ == "__main__":
    unittest.main()
