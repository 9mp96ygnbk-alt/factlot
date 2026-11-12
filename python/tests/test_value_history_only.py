"""Prior-year rolls load as value history only: they add history rows and change nothing else."""

from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_dallas, tx_harris, tx_travis

from test_adapter_tx_travis import travis_zip
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

    def test_member_names_in_lower_case(self):
        z = self.tmp / "DCAD2022_CERTIFIED.ZIP"  # DCAD's 2022 export names its members in lower case
        with zipfile.ZipFile(z, "w") as zf:
            for name, lines in DALLAS.items():
                zf.writestr(name.lower(), "\r\n".join([*(ln.replace('"2026"', '"2022"') for ln in lines), ""]))
        stats = tx_dallas.build_history(z, self.db, as_of="2022-07-25", tax_year=2022)
        self.assertGreater(stats.kept, 0)

    def test_wrong_year_and_zero_values(self):
        stats = tx_dallas.build_history(dallas_zip(self.tmp, 2027, values=False), self.db, as_of="2026-11-02", tax_year=2025)
        self.assertEqual(stats.kept, 0, "a 2027 file is not tax year 2025, and its zero values are not values")
        self.assertGreater(stats.skipped_invalid, 0)


# EARS (Comptroller form 96-1051) AJR field numbers, 1-based, copied from the manual's Appendix 1, not from
# the adapter: a wrong position in the adapter fails here. A 2025 record has 102 fields.
AJR = {"record_type": 1, "year": 2, "district": 3, "unit_id": 4, "unit_type": 5, "fund": 6, "account": 7,
       "short_account": 8, "address": 10, "confidential": 11, "legal": 12, "owner_id": 30, "category": 31,
       "previous_category": 32, "previous_market": 33, "exempt": 34, "land": 35, "improvement": 36, "mineral": 37,
       "personal": 38, "gis_parcel_id": 102}


def ajr(short_account: str, category: str, *, year: int = 2025, unit: tuple[str, str, str] = ("227000", "00", "A"),
        land: str = "0", improvement: str = "0", exempt: str = "0", mineral: str = "0", personal: str = "0",
        **other: str) -> list[str]:
    row = [""] * 102
    fields = dict(record_type="AJR", year=str(year), district="227", unit_id=unit[0], unit_type=unit[1], fund=unit[2],
                  account=f"01{short_account}", short_account=short_account, address="1201 S LAMAR BLVD",
                  confidential="N", legal="LOT 1-4, TEMPLER LOTS", owner_id="1600885", category=category,
                  previous_category=category, previous_market="1", exempt=exempt, land=land, improvement=improvement,
                  mineral=mineral, personal=personal, gis_parcel_id=short_account, **other)
    for name, value in fields.items():
        row[AJR[name] - 1] = value
    return row


SCHOOL = ("227901", "02", "")
EARS_ROWS = [
    # The restaurant: one category. The school district's record states less (a part of the lot) and is not read.
    ajr("100008", "F1", unit=SCHOOL, land="4000000", improvement="90000"),
    ajr("100008", "F1", land="4232160", improvement="99906"),
    # The apartments: two categories in the county unit add up.
    ajr("100012", "B", land="18467437", improvement="42305683"),
    ajr("100012", "F1", land="1000000", improvement="716880"),
    # The condo: wholly exempt that year; the exempt amount is its market value.
    ajr("100040", "XV", exempt="850000"),
    # The house is not a registry parcel; business personal property is not either.
    ajr("100050", "A", land="100000", improvement="150000"),
    ajr("900001", "L1", personal="50000"),
    # The storage lot: no value at all that year.
    ajr("100090", "F1"),
]


def ears_zip(tmp: Path, rows: list[list[str]] = EARS_ROWS, name: str = "227EARS090425", *, nested: bool = True) -> Path:
    """An EARS submission the way TCAD posts it: the csv in a zip, in a zip that also holds attachments.
    The legal description has a comma."""
    text = io.StringIO(newline="")
    csv.writer(text, lineterminator="\r\n").writerows(rows)
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}.csv", text.getvalue().encode("latin-1"))
    p = tmp / f"{name}{'' if nested else '-single'}.zip"
    if not nested:
        p.write_bytes(inner.getvalue())
        return p
    with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}.zip", inner.getvalue())
        # TCAD's outer zip also carries recaps and another zip; neither is the roll.
        zf.writestr("2025_PTD_COUNTY_50_105_TOTALS.pdf", b"%PDF-1.4")
        zf.writestr("2025_PTD_50_897.zip", inner.getvalue()[:0] + b"PK\x05\x06" + b"\0" * 18)
    return p


class TravisHistoryOnly(unittest.TestCase):
    """Travis prior years come as EARS submissions, a different file from the Legacy export of the current roll."""

    CAFE = "fl:parcel:us-48453:100008"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "registry.db"
        tx_travis.build(travis_zip(self.tmp), self.db, as_of="2026-07-18")

    def history(self, urn: str) -> list[tuple]:
        reg = Registry.open_readonly(self.db)
        try:
            return [(e["tax_year"], e["market_value"], e["appraised_value"]) for e in reg.value_history(urn)]
        finally:
            reg.close()

    def test_adds_market_value_history_and_changes_nothing_else(self):
        before = snapshot_of(self.db)
        stats = tx_travis.build_history(ears_zip(self.tmp), self.db, as_of="2025-09-04", tax_year=2025)
        self.assertEqual(stats.source_id, "tx-travis-cad-2025")
        # Registry accounts in the county unit: 100008, 100012, 100040 (kept) and 100090 (no value).
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (4, 3, 1, 0))
        after = snapshot_of(self.db)
        for t in UNTOUCHED:
            self.assertEqual(after[t], before[t], f"{t} must not change")
        self.assertEqual(after["record"], before["record"], "the current records (value_history aside) must not change")
        added = set(after["facts"]) - set(before["facts"])
        self.assertTrue(before["facts"] and set(before["facts"]) <= set(after["facts"]))
        self.assertEqual({f[2] for f in added}, {"parcel.tax_year", "parcel.market_value"})
        self.assertFalse([f for f in added if "LAMAR" in str(f) or "TEMPLER" in str(f) or "1600885" in str(f)],
                         "addresses, legal descriptions and owner ID codes are never written")
        # The county's record, not the school district's; categories add up; the exempt amount counts.
        self.assertEqual(self.history(self.CAFE), [(2026, 4336640, 4336640), (2025, 4332066, None)])
        self.assertEqual(self.history("fl:parcel:us-48453:100012")[1], (2025, 62490000, None))
        self.assertEqual(self.history("fl:parcel:us-48453:100040")[1], (2025, 850000, None))
        self.assertEqual([y for y, *_ in self.history("fl:parcel:us-48453:100090")], [2026])
        reg = Registry.open_readonly(self.db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-travis-cad-2025'").fetchone()
            self.assertIn("EARS submission", src["title"])
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM subjects WHERE urn LIKE '%:100050'").fetchone()[0], 0)
            fact = reg.db.execute("SELECT locator FROM facts WHERE subject = ? AND predicate = 'parcel.market_value' "
                                  "AND locator LIKE '%EARS%'", (self.CAFE,)).fetchone()
            self.assertEqual(fact[0], "227EARS090425.csv AJR short account 100008, taxing unit 227000 (county)")
        finally:
            reg.close()

    def test_single_zip_and_plain_csv_read_the_same(self):
        accounts = ["100008", "100012"]
        want = list(tx_travis.read_ears_value_history(ears_zip(self.tmp), accounts))
        self.assertEqual([(r.apn, r.tax_year, r.market_value) for r in want],
                         [("100008", 2025, 4332066), ("100012", 2025, 62490000)])
        single = ears_zip(self.tmp, nested=False)
        self.assertEqual(list(tx_travis.read_ears_value_history(single, accounts)), want)
        with zipfile.ZipFile(single) as zf:
            zf.extractall(self.tmp / "x")
        self.assertEqual(list(tx_travis.read_ears_value_history(self.tmp / "x" / "227EARS090425.csv", accounts)), want)

    def test_another_year_bad_numbers_and_short_records_are_not_loaded(self):
        stats = tx_travis.build_history(ears_zip(self.tmp, name="227EARS082824"), self.db, as_of="2024-08-28", tax_year=2024)
        self.assertEqual(stats.kept, 0, "a 2025 file is not tax year 2024")
        self.assertTrue(any("expected 2024" in e for e in stats.errors))
        rows = [ajr("100008", "F1", land="12x", improvement="5"), ajr("100008", "F2", land="7"),
                ["AJR", "2025", "227"], ["AUD", "2025"], ajr("100012", "B", land="10")]
        problems: list[str] = []
        got = list(tx_travis.read_ears_value_history(ears_zip(self.tmp, rows, name="227EARS010125"), ["100008", "100012"],
                                                     problems=problems))
        self.assertEqual([(r.apn, r.market_value) for r in got], [("100012", 10)],
                         "an account with an unreadable value is dropped whole, not loaded with a partial sum")
        self.assertEqual(len(problems), 2)
        self.assertEqual(self.history(self.CAFE), [(2026, 4336640, 4336640)])

    def test_rerun_is_idempotent(self):
        z = ears_zip(self.tmp)
        tx_travis.build_history(z, self.db, as_of="2025-09-04", tax_year=2025)
        once = snapshot_of(self.db)
        tx_travis.build_history(z, self.db, as_of="2025-09-04", tax_year=2025)
        self.assertEqual(snapshot_of(self.db), once)

    def test_cli_flag(self):
        self.assertEqual(tx_travis.main([str(ears_zip(self.tmp)), str(self.db), "--as-of", "2025-09-04",
                                         "--history-only", "2025"]), 0)
        self.assertEqual([y for y, *_ in self.history(self.CAFE)], [2026, 2025])


if __name__ == "__main__":
    unittest.main()
