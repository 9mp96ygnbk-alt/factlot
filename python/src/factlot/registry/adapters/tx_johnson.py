"""Central Appraisal District of Johnson County (Cleburne, Burleson): certified rolls → ``ParcelRecord``.

The district's downloads page (https://johnsoncad.com/downloads/) lists each certified roll. It moved to a new
appraisal system in 2026, and its 2026 certified roll (``BATCH_896.all_.zip``, "2026 Certified Records", members
dated 2026-08-10) and a re-export of the 2025 certified roll (``JCAD-2025-Certified-Data-2026-04-27.zip``, "JCAD
2025 Certified Data") are the tab-delimited "external" extract read by ``tx_tab_extract`` (see that module for the
columns). Johnson's account key is ``ACCOUNT`` (``R000000492``), the ``ACCOUNT_NUM`` of its earlier rolls. Measured on
the 2026 file on 2026-11-12: 111,072 rows for 108,508 accounts (``R`` real 102,903, ``M`` mineral 5,605); an account
repeats once per building, the repeats differing in ``YEAR_BUILT`` and agent columns. ``NBHD CD`` is a map-area code
(``126.0002``), the same value the earlier rolls give as ``CTM_NBHD_CDX``. No owner reads ``CONFIDENTIAL``.

``PARCEL USE CD`` is the district's state code; ``STATE_CODE_PTD`` maps it to the Comptroller category with the
district's own code names, as its 2024 certified roll states them (``CTM_IMPR_SPTD_NM``, ``CTM_LAND_SPTD_NM``:
``B2 - Real, Residential, Duplexes``, ``F1 - Real, Commercial``). The commercial scope is ``B1`` to ``B4`` (category
B), ``F1`` and ``F2``. ``C2`` "Real, Vacant Lots/Tracts - Commercial" is a vacant lot (C), out of scope.

Prior years, as value history only (``--history-only``, ``Registry.ingest_value_history``):

- 2025: the 2026-04-27 re-export, read by ``tx_tab_extract.read_value_history`` (account and the two values).
- 2024: ``2024-Certified-Data-Roll-1.zip``, the earlier system's web extract. Only ``...WEBMAIN.CSV`` is read (comma
  delimited, quoted, header row, one row per account): ``APPRAISAL_YR``, ``ACCOUNT_NUM``, ``AAY_TOT_VAL`` (total
  market value) and ``AAY_APPR_VAL`` (appraised value). Owner, address and legal columns are never read.
- 2021 to 2023 (``Certified Data Roll (Run 1st)`` CSVs, 326 to 327 columns) are not read: most rows do not split
  into the header's column count with a standard CSV reader, and the layout workbook in the 2023 zip has not been
  checked against them.

Usage: ``python -m factlot.registry.adapters.tx_johnson BATCH_896.all_.zip registry.db --as-of 2026-08-10
--tax-year 2026``
Prior year: ``python -m factlot.registry.adapters.tx_johnson JCAD-2025-Certified-Data-2026-04-27.zip registry.db
--as-of 2026-04-27 --history-only 2025``
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import io
import json
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelValues, Registry, Source, roll_source
from .tx_tab_extract import (
    ExtractTally,
    TabExtract,
    _num,
    build as build_extract,
    build_history as build_extract_history,
    read_roll as read_extract,
)

STATE_FIPS = "48"
COUNTY_FIPS = "251"
ACCOUNT_SYSTEM = "johnsoncad_account"

SOURCE = Source(
    source_id="tx-johnson-cad",
    publisher="Central Appraisal District of Johnson County",
    title="Certified data roll (2025 and 2026: tab-delimited extract; 2024: web extract)",
    url="https://johnsoncad.com/downloads/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated for the roll files (read 2026-11-12)",
    ai_use="unknown",  # not addressed by the publisher; robots.txt has no Content-Signal
    redistribution="unknown",  # not addressed; public record
    attribution="Central Appraisal District of Johnson County",
    terms_reviewed="2026-11-12",
)

# District state code → Comptroller category, from the district's code names in its 2024 certified roll
# ("B2 - Real, Residential, Duplexes"). Every code the 2026 real-property accounts use is listed.
STATE_CODE_PTD = {
    "A1": "A", "A2": "A", "A3": "A", "A4": "A", "B1": "B", "B2": "B", "B3": "B", "B4": "B",
    "C1": "C1", "C2": "C1", "C3": "C1", "D1": "D1", "D2": "D2", "D3": "D1",
    "E1": "E", "E2": "E", "E3": "E", "E4": "E", "F1": "F1", "F2": "F2", "G1": "G1",
    "J1": "J1", "J2": "J2", "J3": "J3", "J4": "J4", "J5": "J5", "J6": "J6", "J7": "J7",
    "L1": "L1", "L2": "L2", "M2": "M2", "M3": "M1", "M4": "M2", "O1": "O", "O2": "O", "S1": "S",
    **{f"X{n:02d}": "X" for n in range(1, 24)},
}

JOHNSON = TabExtract(source=SOURCE, county_fips=COUNTY_FIPS, account_system=ACCOUNT_SYSTEM, id_column="ACCOUNT",
                     state_code_ptd=STATE_CODE_PTD)

_WEBMAIN = "WEBMAIN.CSV"


def read_roll(path: str | Path, tax_year: int, tally: ExtractTally | None = None):
    """The commercial accounts of a 2026-format Johnson extract (``tx_tab_extract.read_roll``)."""
    return read_extract(path, JOHNSON, tax_year, tally)


def read_webmain_history(path: str | Path, accounts: Iterable[str]) -> Iterator[ParcelValues]:
    """Each listed account's tax year, market and appraised value from a ``...WEBMAIN.CSV`` web extract, and
    nothing else (for ``Registry.ingest_value_history``). The first row of an account wins."""
    p = Path(path)
    wanted = frozenset(accounts)
    seen: set[str] = set()
    with contextlib.ExitStack() as stack:
        if p.suffix.lower() == ".csv":
            raw = stack.enter_context(open(p, "rb"))
        else:
            zf = stack.enter_context(zipfile.ZipFile(p))
            names = [n for n in zf.namelist() if n.upper().endswith(_WEBMAIN)]
            if len(names) != 1:
                raise ValueError(f"{p.name}: expected one {_WEBMAIN}, found {names}")
            raw = stack.enter_context(zf.open(names[0]))
        for r in csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline="")):
            acct = (r.get("ACCOUNT_NUM") or "").strip().lstrip("0")
            if acct not in wanted or acct in seen:
                continue
            seen.add(acct)
            yield ParcelValues(
                county_fips=COUNTY_FIPS, apn=acct,
                tax_year=int(y) if (y := _num(r.get("APPRAISAL_YR"))) else None,
                market_value=_num(r.get("AAY_TOT_VAL")), appraised_value=_num(r.get("AAY_APPR_VAL")),
                locator=f"WEBMAIN.CSV ACCOUNT_NUM {acct}",
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
          retrieved_at: str | None = None) -> tuple[IngestStats, ExtractTally]:
    """Ingest the archived 2026-format certified extract into a registry file (created if missing)."""
    return build_extract(snapshot_path, db_path, JOHNSON, as_of=as_of, tax_year=tax_year, retrieved_at=retrieved_at)


def build_history(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
                  retrieved_at: str | None = None) -> IngestStats:
    """Add one earlier year's values (history only): an extract zip, or a web extract holding ``WEBMAIN.CSV``.

    A web-extract row whose ``APPRAISAL_YR`` is not ``tax_year`` is not loaded and is named in ``stats.errors``.
    """
    if _is_extract(snapshot_path):
        stats, _ = build_extract_history(snapshot_path, db_path, JOHNSON, as_of=as_of, tax_year=tax_year,
                                         retrieved_at=retrieved_at)
        return stats
    reg = Registry(db_path)
    try:
        src = roll_source(SOURCE, tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute("SELECT external_id FROM crosswalk WHERE system = ?",
                                                     (ACCOUNT_SYSTEM,))]
        wrong: list[str] = []

        def in_year(rows: Iterable[ParcelValues]) -> Iterator[ParcelValues]:
            for r in rows:
                if r.tax_year == tax_year:
                    yield r
                else:
                    wrong.append(f"{r.locator}: tax year {r.tax_year}, expected {tax_year}")

        stats = reg.ingest_value_history(in_year(read_webmain_history(snapshot_path, accounts)), snap,
                                         state_fips=STATE_FIPS)
        stats.seen += len(wrong)
        stats.skipped_invalid += len(wrong)
        stats.errors.extend(wrong[:20])
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats
    finally:
        reg.close()


def _is_extract(path: str | Path) -> bool:
    p = Path(path)
    if p.is_dir():
        return any(f.name.upper() == "EXTERNALNAL.TAB" for f in p.rglob("*"))
    if p.suffix.lower() != ".zip":
        return False
    with zipfile.ZipFile(p) as zf:
        return any(n.upper().endswith("EXTERNALNAL.TAB") for n in zf.namelist())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_johnson", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="the certified roll zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the date on the files inside)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--tax-year", type=int, help="the tax year of a 2026-format extract (from the downloads page)")
    group.add_argument("--history-only", type=int, metavar="TAX_YEAR",
                       help="the file is the roll of this earlier tax year: add its values to parcels already loaded "
                            "and change nothing else")
    args = ap.parse_args(argv)
    if args.history_only:
        stats = build_history(args.snapshot, args.db, as_of=args.as_of, tax_year=args.history_only,
                              retrieved_at=args.retrieved_at)
        print(json.dumps(asdict(stats), indent=2))
        return 0
    stats, tally = build(args.snapshot, args.db, as_of=args.as_of, tax_year=args.tax_year,
                         retrieved_at=args.retrieved_at)
    print(json.dumps({"stats": asdict(stats), "tally": asdict(tally)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
