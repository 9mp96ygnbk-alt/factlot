"""Tax Appraisal District of Bell County (Killeen, Temple, Belton): certified exports → ``ParcelRecord``.

The district's data portal (https://bellcad.org/data-portal/) posts each certified roll. It changed appraisal
systems in 2026: its PACS export layout ("Appraisal Export Layout – 8.0.33") is labelled "Files Created Prior to
5/1/2026", and the 2026 certified export (``2026-Bell-County-Certified-Export-3.zip``, members dated 2026-10-01) is
the tab-delimited "external" extract read by ``tx_tab_extract`` (see that module for the columns). Bell's account
key is ``PARCEL ID``, the same number as the PACS ``prop_id`` of its earlier rolls (13,096 of the 13,685 commercial
accounts of 2026 are commercial accounts of the 2025 PACS roll too). Measured on the 2026 file on 2026-11-12:
167,084 rows, 19 with the wrong number of columns, one ``CONFIDENTIAL OWNER`` (not in the commercial scope).

``PARCEL USE CD`` carries the codes of the district's own state-code table, and the 2026 file has no Comptroller
(PTD) column. ``STATE_CODE_PTD`` is transcribed from that table as the district published it in the 2025 certified
PACS export (``APPRAISAL_STATE_CODE.TXT``, 2025-07-22), whose codes and labels the 2026 file repeats. The commercial
scope is ``B1`` and ``B2`` (category B), ``F1`` and ``F3`` (``F3`` "IMPROVEMENTS ONLY COMMERICAL" is reported by the
district as F1) and ``F2``. ``C2`` "VACANT COMMERCIAL LOT" is reported as C1, so it is out of scope.

Prior years. The 2025 (``2025-Bell-County-Certified-Export.7z``) and 2024 (``BellCAD-Certified-Appraisal-Export-
2024.rar``) certified exports are PACS exports (header "8.0.0.30", 9,247-character property records); they load as
value history only through ``tx_pacs34.build_history``, which streams the archive through bsdtar and reads the
account, year and values alone.

Usage: ``python -m factlot.registry.adapters.tx_bell 2026-Bell-County-Certified-Export-3.zip registry.db
--as-of 2026-10-01 --tax-year 2026``
Prior year: ``python -m factlot.registry.adapters.tx_bell 2025-Bell-County-Certified-Export.7z registry.db
--as-of 2025-07-22 --history-only 2025``
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, Source
from . import tx_pacs34
from .tx_tab_extract import ExtractTally, TabExtract, build as build_extract, read_roll as read_extract

STATE_FIPS = "48"
COUNTY_FIPS = "027"
ACCOUNT_SYSTEM = "bellcad_prop_id"

SOURCE = Source(
    source_id="tx-bell-cad",
    publisher="Tax Appraisal District of Bell County",
    title="Certified appraisal export (2026: tab-delimited extract; 2024 and 2025: PACS export)",
    url="https://bellcad.org/data-portal/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated on the data portal (read 2026-11-12)",
    ai_use="unknown",  # not addressed by the publisher; robots.txt has no Content-Signal
    redistribution="unknown",  # not addressed; public record
    attribution="Tax Appraisal District of Bell County",
    terms_reviewed="2026-11-12",
)

# District state code → Comptroller (PTD) category, transcribed from APPRAISAL_STATE_CODE.TXT of the 2025 certified
# PACS export (2025-07-22). Exempt sub-codes (CH, CI, ... WS) and Z1 (no PTD category) are not listed.
STATE_CODE_PTD = {
    "A1": "A", "A2": "A", "A3": "A", "B1": "B", "B2": "B", "C1": "C1", "C2": "C1",
    "D1": "D1", "D2": "D2", "D3": "D1", "D4": "D2", "E": "E", "E1": "E", "E2": "E", "E3": "E",
    "F1": "F1", "F2": "F2", "F3": "F1", "G3": "G3",
    "J1": "J1", "J2": "J2", "J3": "J3", "J4": "J4", "J5": "J5", "J6": "J6", "J7": "J7", "J8": "J8", "J9": "J9",
    "L1": "L1", "L2": "L2", "M1": "M1", "M2": "M2", "N1": "N", "O1": "O", "O2": "O", "S": "S", "X": "X",
}

BELL = TabExtract(source=SOURCE, county_fips=COUNTY_FIPS, account_system=ACCOUNT_SYSTEM, id_column="PARCEL ID",
                  state_code_ptd=STATE_CODE_PTD)


def read_roll(path: str | Path, tax_year: int, tally: ExtractTally | None = None):
    """The commercial accounts of a 2026-format Bell extract (``tx_tab_extract.read_roll``)."""
    return read_extract(path, BELL, tax_year, tally)


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
          retrieved_at: str | None = None) -> tuple[IngestStats, ExtractTally]:
    """Ingest the archived 2026-format certified extract into a registry file (created if missing)."""
    return build_extract(snapshot_path, db_path, BELL, as_of=as_of, tax_year=tax_year, retrieved_at=retrieved_at)


def build_history(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
                  retrieved_at: str | None = None) -> tuple[IngestStats, tx_pacs34.ExportTally]:
    """Add one earlier year's values from an archived PACS certified export (history only)."""
    return tx_pacs34.build_history(snapshot_path, db_path, SOURCE, county_fips=COUNTY_FIPS,
                                   account_system=ACCOUNT_SYSTEM, as_of=as_of, tax_year=tax_year,
                                   retrieved_at=retrieved_at)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_bell", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="the certified export as archived by the collector (.zip, .7z or .rar)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the date on the files inside)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--tax-year", type=int, help="the tax year of a 2026-format extract")
    group.add_argument("--history-only", type=int, metavar="TAX_YEAR",
                       help="the file is the PACS roll of this earlier tax year: add its values to parcels already "
                            "loaded and change nothing else")
    args = ap.parse_args(argv)
    if args.history_only:
        stats, ptally = build_history(args.snapshot, args.db, as_of=args.as_of, tax_year=args.history_only,
                                      retrieved_at=args.retrieved_at)
        print(json.dumps({"stats": asdict(stats), "tally": asdict(ptally)}, indent=2))
        return 0
    stats, tally = build(args.snapshot, args.db, as_of=args.as_of, tax_year=args.tax_year,
                         retrieved_at=args.retrieved_at)
    print(json.dumps({"stats": asdict(stats), "tally": asdict(tally)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
