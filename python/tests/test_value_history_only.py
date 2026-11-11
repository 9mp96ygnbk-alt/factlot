"""Prior-year rolls load as value history only: they add history rows and change nothing else."""

from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_dallas, tx_harris

from test_adapters import (
    DALLAS,
    HARRIS_NEIGHBORHOOD_ROWS,
    HARRIS_OWNERS_HEADER,
    HARRIS_REAL_ACCT_HEADER,
    HARRIS_REAL_ACCT_ROWS,
    dallas_zip,
    harris_zip,
)

TOWER = "fl:parcel:us-48201:0010010000001"
DALLAS_1 = "fl:parcel:us-48113:00000100001000000"
# Every table a prior-year roll must leave exactly as it was (facts are compared per document below).
UNTOUCHED = ("subjects", "crosswalk", "relationships", "coverage", "name_index", "address_index", "name_tokens")


def prior_harris_zip(tmp: Path, year: int = 2022, extra_rows: tuple[str, ...] = ()) -> Path:
    """The Harris fixture as an earlier roll: other values, another owner, a changed address, an account the
    registry does not hold, and a person's name on the owner file."""
    rows = []
    for ln in HARRIS_REAL_ACCT_ROWS:
        ln = ln.replace("\t2026\t", f"\t{year}\t").replace("EXAMPLE TOWER LLC", "OLD OWNER JANE DOE").replace("100 MAIN ST STE 1", "9 OLD RD")
        rows.append(ln.replace("\t52000000\t", "\t41000000\t").replace("\t50000000\t", "\t40000000\t"))
    rows.append(f"0099990000001            \t{year}\tSOMEONE ELSE LLC\t1 X ST\t \tHOUSTON\tTX\t77002\t \t1 X ST\tHOUSTON\t77002\tF1\t1990\t100\t100\t0.1\t10\t10\t ")
    rows.extend(extra_rows)
    p = tmp / f"Real_acct_owner_{year}{len(extra_rows)}.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("real_acct.txt", "\r\n".join([HARRIS_REAL_ACCT_HEADER, *rows, ""]))
        zf.writestr("owners.txt", "\r\n".join([HARRIS_OWNERS_HEADER, "0010010000001\t1\tJANE Q DOE\t \t1.0", ""]))
        zf.writestr("real_neighborhood_code.txt", "\r\n".join([*HARRIS_NEIGHBORHOOD_ROWS, ""]))
    return p


def snapshot_of(db: Path) -> dict[str, list[tuple]]:
    reg = Registry.open_readonly(db)
    try:
        out = {t: sorted(tuple(r) for r in reg.db.execute(f"SELECT * FROM {t}")) for t in UNTOUCHED}
        # Facts of every document that existed before: the prior-year load must not alter or delete any.
        out["facts"] = sorted(tuple(r) for r in reg.db.execute("SELECT * FROM facts"))
        out["record"] = [json.dumps({k: v for k, v in reg.get(u).items() if k != "value_history"}, sort_keys=True, default=str)
                         for (u,) in reg.db.execute("SELECT urn FROM subjects WHERE kind = 'parcel' ORDER BY urn")]
        return out
    finally:
        reg.close()


class HarrisHistoryOnly(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "registry.db"
        tx_harris.build(harris_zip(self.tmp), self.db, as_of="2026-11-01")

    def test_adds_history_and_changes_nothing_else(self):
        before = snapshot_of(self.db)
        stats = tx_harris.build_history(prior_harris_zip(self.tmp), self.db, as_of="2022-07-25", tax_year=2022)
        self.assertEqual(stats.source_id, "tx-harris-cad-2022")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (4, 4, 0))
        # Only registry parcels are read: the A1 house and the account 0099990000001 are not loaded.
        after = snapshot_of(self.db)
        for t in UNTOUCHED:
            self.assertEqual(after[t], before[t], f"{t} must not change")
        self.assertEqual(after["record"], before["record"], "the current records (value_history aside) must not change")
        added = set(after["facts"]) - set(before["facts"])
        self.assertTrue(before["facts"] and set(before["facts"]) <= set(after["facts"]))
        self.assertEqual({f[2] for f in added}, {"parcel.tax_year", "parcel.market_value", "parcel.appraised_value"})
        self.assertFalse([f for f in added if "OLD OWNER" in f[3] or "OLD RD" in f[3] or "DOE" in f[3]])

    def test_value_history_spans_the_years_and_current_stays(self):
        tx_harris.build_history(prior_harris_zip(self.tmp), self.db, as_of="2022-07-25", tax_year=2022)
        reg = Registry.open_readonly(self.db)
        try:
            hist = reg.value_history(TOWER)
            self.assertEqual([(e["tax_year"], e["market_value"], e["appraised_value"]) for e in hist],
                             [(2026, 52000000, 50000000), (2022, 41000000, 40000000)])
            current = {f["predicate"]: f["value"] for f in reg.facts(TOWER)}
            self.assertEqual((current["parcel.market_value"], current["parcel.tax_year"]), (52000000, 2026))
            self.assertEqual(current["ownership.owner_of_record"], "EXAMPLE TOWER LLC")
            self.assertEqual(reg.status(TOWER), "current")
        finally:
            reg.close()

    def test_an_older_value_never_becomes_current_even_with_a_later_as_of(self):
        # HCAD regenerates old folders, so an archived prior-year file can be dated after the current roll.
        tx_harris.build_history(prior_harris_zip(self.tmp), self.db, as_of="2026-11-09", tax_year=2022)
        reg = Registry.open_readonly(self.db)
        try:
            current = {f["predicate"]: f["value"] for f in reg.facts(TOWER)}
            self.assertEqual((current["parcel.market_value"], current["parcel.tax_year"]), (52000000, 2026))
        finally:
            reg.close()

    def test_rerun_is_idempotent_and_replaces_its_own_facts(self):
        z = prior_harris_zip(self.tmp)
        tx_harris.build_history(z, self.db, as_of="2022-07-25", tax_year=2022)
        once = snapshot_of(self.db)
        again = tx_harris.build_history(z, self.db, as_of="2022-07-25", tax_year=2022)
        self.assertEqual(again.facts_written, 0)
        self.assertEqual(snapshot_of(self.db), once)

    def test_a_row_of_another_year_is_not_loaded(self):
        wrong = HARRIS_REAL_ACCT_ROWS[0].replace("\t2026\t", "\t2021\t").replace("0010010000001", "0010010000004")
        z = prior_harris_zip(self.tmp, extra_rows=(wrong,))  # a second, 2021 row for the apartments account
        stats = tx_harris.build_history(z, self.db, as_of="2022-07-25", tax_year=2022)
        self.assertEqual(stats.skipped_invalid, 1)
        self.assertIn("tax year 2021, expected 2022", stats.errors[0])
        reg = Registry.open_readonly(self.db)
        try:
            years = [e["tax_year"] for e in reg.value_history("fl:parcel:us-48201:0010010000004")]
            self.assertEqual(sorted(years), [2022, 2026])
        finally:
            reg.close()

    def test_owner_file_is_never_read(self):
        z = self.tmp / "no_owners.zip"
        with zipfile.ZipFile(z, "w") as zf:
            zf.writestr("real_acct.txt", "\r\n".join([HARRIS_REAL_ACCT_HEADER, *[ln.replace("\t2026\t", "\t2023\t") for ln in HARRIS_REAL_ACCT_ROWS], ""]))
        stats = tx_harris.build_history(z, self.db, as_of="2023-07-25", tax_year=2023)  # no owners.txt member: fine
        self.assertGreater(stats.kept, 0)

    def test_cli_flag(self):
        z = prior_harris_zip(self.tmp)
        self.assertEqual(tx_harris.main([str(z), str(self.db), "--as-of", "2022-07-25", "--history-only", "2022"]), 0)
        reg = Registry.open_readonly(self.db)
        try:
            self.assertEqual(len(reg.value_history(TOWER)), 2)
        finally:
            reg.close()


class StoreGuard(unittest.TestCase):
    def test_a_parcel_the_registry_does_not_hold_is_dropped_not_created(self):
        from factlot.registry import ParcelValues

        tmp = Path(tempfile.mkdtemp())
        db = tmp / "registry.db"
        tx_harris.build(harris_zip(tmp), db, as_of="2026-11-01")
        reg = Registry(db)
        try:
            src = tx_harris.roll_source(tx_harris.SOURCE, 2022)
            reg.add_source(src)
            snap = reg.add_snapshot(src.source_id, harris_zip(tmp), "2022-07-25")
            subjects = reg.db.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
            stats = reg.ingest_value_history(
                [ParcelValues("201", "0099990000001", 2022, 10.0, 10.0), ParcelValues("201", "0010010000001", 2022, None, None)],
                snap, state_fips="48")
            self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (2, 0, 1, 1))
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM subjects").fetchone()[0], subjects)
        finally:
            reg.close()


class DallasHistoryOnly(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "registry.db"
        tx_dallas.build(dallas_zip(self.tmp), self.db, as_of="2026-10-12")

    def prior(self, year: int) -> Path:
        z = self.tmp / f"DCAD{year}_CERTIFIED.zip"
        with zipfile.ZipFile(z, "w") as zf:
            for name, lines in DALLAS.items():
                rows = [ln.replace('"2026"', f'"{year}"').replace("OWNER", "OLDOWNER") for ln in lines]
                zf.writestr(name, "\r\n".join([*rows, ""]))
        return z

    def test_adds_history_and_changes_nothing_else(self):
        before = snapshot_of(self.db)
        stats = tx_dallas.build_history(self.prior(2023), self.db, as_of="2023-07-25", tax_year=2023)
        self.assertEqual(stats.source_id, "tx-dallas-cad-2023")
        self.assertGreater(stats.kept, 0)
        after = snapshot_of(self.db)
        for t in UNTOUCHED:
            self.assertEqual(after[t], before[t], f"{t} must not change")
        self.assertEqual(after["record"], before["record"])
        added = set(after["facts"]) - set(before["facts"])
        self.assertEqual({f[2] for f in added} - {"parcel.tax_year", "parcel.market_value"}, set())
        reg = Registry.open_readonly(self.db)
        try:
            self.assertEqual([e["tax_year"] for e in reg.value_history(DALLAS_1)], [2026, 2023])
        finally:
            reg.close()

    def test_wrong_year_and_zero_values(self):
        stats = tx_dallas.build_history(dallas_zip(self.tmp, 2027, values=False), self.db, as_of="2026-11-02", tax_year=2025)
        self.assertEqual(stats.kept, 0, "a 2027 file is not tax year 2025, and its zero values are not values")
        self.assertGreater(stats.skipped_invalid, 0)


if __name__ == "__main__":
    unittest.main()
