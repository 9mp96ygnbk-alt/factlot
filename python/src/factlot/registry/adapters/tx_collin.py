"""Collin Central Appraisal District: ``LiteDatabaseCurrent.zip`` (``AD_Public.mdb``) → ``ParcelRecord``.

Layout (confirmed on the 2026-11-02 file): a zip holding ``AD_Public.mdb``, a Microsoft Access
(Jet 4) database with one table, ``AD_Public``, one row per property, and the publisher's field
list ``AD_Public_FileLayout.pdf`` (revised 2013-04-11). Code tables are in the separate
``CodeFileLists.xls`` (sheets: Entity Codes, State Category Codes, Property Use Codes, Land Type
Codes, Imprv Type Codes).

- ``prop_id`` — the CCAD property id (an integer), the parcel key; ``geo_id`` is the geographic id
  (``R-0002-00A-0030-1``). ``prop_type_cd`` is ``R`` real, ``P`` business personal property, ``MH``
  manufactured home, ``MN`` mineral (padded with spaces).
- ``file_as_name`` — the owner of record (``OWNER OF RECORD`` is a placeholder, not an owner);
  ``addr_line1`` is "Mailing Address Line 1 / Additional Owner Name" (a care-of line), then
  ``addr_line2``, ``addr_line3``, ``addr_city``, ``addr_state``, ``addr_zip``. There is no
  confidentiality flag or withheld-owner marker in the file.
- ``situs_num``, ``situs_street_prefx``, ``situs_street``, ``situs_street_sufix``, ``situs_city``,
  ``situs_state``, ``situs_zip`` (``situs_display`` is the same address on two lines).
- ``state_cd`` — CCAD's state classification code (``F3`` office, ``F4`` commercial condo, ``B2``
  duplex, ``EX4`` city-owned); the "State Category Codes" sheet of ``CodeFileLists.xls`` gives the
  Comptroller category of each, transcribed in ``_STATE_CATEGORY`` below. ``commercial_flag`` is
  CCAD's own commercial-division indicator (``T``/``F``). ``class_cd`` ("CCAD Improvement
  Classification Code (internal CAD use)", e.g. ``RE1``, ``MM2``) is written as
  ``parcel.building_class``; the file gives one per property and no separate quality code. The file
  has no neighborhood or market-area code (``abs_subdv_cd`` is the abstract or subdivision, which is
  not recorded as one), so Collin parcels get no ``parcel.neighborhood_code``.
- ``land_total_sqft`` (``land_sqft`` is marked "DO NOT USE"), ``legal_acreage``, ``eff_size_acres``,
  ``living_area`` ("Improvement Main Area SqFt Total (of all bldgs)"), ``yr_blt`` (actual year
  built; ``eff_yr_blt`` is the appraisal's effective year).
- Values: ``cert_val_yr`` and ``cert_market``, ``cert_appraised_val`` are the last certified roll;
  ``curr_val_yr`` with ``curr_*`` is the year in progress (blank until preliminary values exist).

Reading the database needs ``mdb-export`` from mdbtools (``brew install mdbtools`` or
``apt install mdbtools``); the adapter also reads a CSV exported from it (``AD_Public.csv``).

Usage: ``python -m factlot.registry.adapters.tx_collin LiteDatabaseCurrent.zip registry.db --as-of 2026-11-02``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "48"
COUNTY_FIPS = "085"
ACCOUNT_SYSTEM = "ccad_prop_id"

SOURCE = Source(
    source_id="tx-collin-cad",
    publisher="Collin Central Appraisal District",
    title="Appraisal data export (LiteDatabaseCurrent.zip, AD_Public.mdb)",
    url="https://collincad.org/category/appraisal-data-exports/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated for the exports",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; public record
    attribution="Collin Central Appraisal District",
    terms_reviewed="2026-11-02",
)

TABLE = "AD_Public"
MDB_NAME = "AD_Public.mdb"
CSV_NAME = "AD_Public.csv"

# CCAD state code → Comptroller category, transcribed from the "State Category Codes" sheet of
# CodeFileLists.xls (2012-10-09). The sheet files its exempt codes (EX1–EX10, X) under "F1 -
# Commercial Real Property"; they are kept as the Comptroller's X (totally exempt) here, which is
# what their own names say ("Govt Owned", "Church", "Totally Exempt Property"). A code not listed
# passes through unchanged.
_STATE_CATEGORY = {
    "A1": "A", "A2": "A", "A3": "A", "A4": "A", "A6": "A", "A9": "A",
    "B1": "B", "B2": "B", "B3": "B", "B4": "B", "B6": "B", "B9": "B",
    "C1": "C1", "C2": "C1", "C3": "C1", "C4": "C1", "C5": "C1", "C6": "C1", "C9": "C1",
    "D1": "D1", "D2": "D2", "D6": "E",
    "E1": "E", "E2": "E", "E3": "E", "E4": "E", "E6": "E", "E9": "E",
    **{f"EX{i}": "X" for i in range(1, 11)}, "X": "X",
    "F1": "F1", "F2": "F2", "F3": "F1", "F4": "F1", "F6": "F1", "F7": "F1", "F9": "F1",
    "G1": "G1", "G2": "G2", "G3": "G3", "H1": "H1", "H2": "H2",
    **{f"J{i}{s}": f"J{i}" for i in (1, 2, 3, 4, 6, 7) for s in ("A", "B")}, "J5": "J5", "J8": "J8",
    "L1": "L1", "L2": "L2", "L3": "X",
    "M1": "M2", "M2": "M2", "M3": "M1", "M4": "A", "M5": "C1",
    "N1": "N", "O": "O", "S": "S",
}

# Owner names CCAD uses when it has no owner of record: the parcel keeps no owner name.
_PLACEHOLDER_OWNERS = frozenset({"OWNER OF RECORD", "UNKNOWN", "UNKNOWN OWNER", "CURRENT OWNER"})

_SQFT_PER_ACRE = 43560


def _mdb_export(mdb: Path) -> Iterator[dict[str, str]]:
    """Stream the table through ``mdb-export`` (mdbtools), which writes UTF-8 CSV with a header row."""
    exe = shutil.which("mdb-export")
    if not exe:
        raise RuntimeError("reading AD_Public.mdb needs mdb-export from mdbtools (brew install mdbtools); "
                           "or pass a CSV exported from it")
    cmd = [exe, "-D", "%Y-%m-%d", "-T", "%Y-%m-%d %H:%M:%S", str(mdb.resolve()), TABLE]  # absolute: never an option
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
        assert proc.stdout is not None and proc.stderr is not None
        with io.TextIOWrapper(proc.stdout, encoding="utf-8", errors="replace", newline="") as out:
            yield from csv.DictReader(out)
        err = proc.stderr.read()
        proc.wait()
        if proc.returncode:
            raise RuntimeError(f"mdb-export failed ({proc.returncode}): {err.decode(errors='replace').strip()}")


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the rows of ``AD_Public`` from the zip, the ``.mdb``, a CSV export, or a directory holding one."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        if (p / CSV_NAME).is_file():
            p = p / CSV_NAME
        elif (p / MDB_NAME).is_file():
            p = p / MDB_NAME
        else:
            raise FileNotFoundError(f"{p}: no {CSV_NAME} or {MDB_NAME}")
    suffix = p.suffix.lower()
    if suffix == ".csv":
        with open(p, newline="", encoding="utf-8", errors="replace") as f:
            yield from csv.DictReader(f)
    elif suffix == ".mdb":
        yield from _mdb_export(p)
    else:
        with zipfile.ZipFile(p) as zf, tempfile.TemporaryDirectory() as tmp:
            zf.extract(MDB_NAME, tmp)
            yield from _mdb_export(Path(tmp) / MDB_NAME)


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: CCAD writes 0 (or leaves blank) when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def state_category(code: str | None) -> str | None:
    """Comptroller category for a CCAD ``state_cd`` (``F3`` → ``F1``, ``B2`` → ``B``); unknown codes pass through."""
    c = _squeeze(code).upper()
    return _STATE_CATEGORY.get(c, c) or None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(" ".join((r.get("situs_street_prefx", ""), r.get("situs_street", ""), r.get("situs_street_sufix", ""))))
    if not street:
        return None
    line = _squeeze(" ".join((r.get("situs_num", ""), street)))
    state = _squeeze(r.get("situs_state")) or "TX"
    rest = " ".join(x for x in (_squeeze(r.get("situs_city")), state, _squeeze(r.get("situs_zip"))) if x)
    return f"{line}, {rest}"


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [_squeeze(r.get(f"addr_line{i}")) for i in range(1, 4)]
    state_zip = " ".join(x for x in (_squeeze(r.get("addr_state")), _squeeze(r.get("addr_zip"))) if x)
    lines.append(", ".join(x for x in (_squeeze(r.get("addr_city")), state_zip) if x))
    return ", ".join(x for x in lines if x) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real property in scope, in table order.

    ``categories`` limits the rows kept by Comptroller category (default: the registry's commercial
    scope); ``None`` keeps every real property. Personal property, manufactured homes and minerals
    are never parcels. A repeated ``prop_id`` collapses to the first row.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen: set[str] = set()
    for r in _rows(path):
        if _squeeze(r.get("prop_type_cd")).upper() != "R":
            continue
        pid = _squeeze(r.get("prop_id")).lstrip("0")
        if not pid or pid in seen:
            continue
        code = _squeeze(r.get("state_cd")).upper()
        category = state_category(code)
        if not keep(category):
            continue
        seen.add(pid)
        owner = _owner(r.get("file_as_name"))
        land = _positive(r.get("land_total_sqft"))
        if land is None:
            acres = _positive(r.get("eff_size_acres")) or _positive(r.get("legal_acreage"))
            land = round(acres * _SQFT_PER_ACRE, 2) if acres else None
        # The last certified roll; a new account with no certified year yet has only current values,
        # and only once they are preliminary (until then every value column is blank, and no year).
        market, appraised, year = r.get("cert_market"), r.get("cert_appraised_val"), r.get("cert_val_yr")
        if _num(market) is None and _num(year) is None:
            market, appraised = r.get("curr_market"), r.get("curr_appraised_val")
            year = r.get("curr_val_yr") if _num(market) is not None else None
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,  # the file carries no confidentiality flag
            land_area_sf=land,
            improvement_area_sf=_positive(r.get("living_area")),
            year_built=int(y) if (y := _positive(r.get("yr_blt"))) else None,
            market_value=_num(market),
            appraised_value=_num(appraised),
            tax_year=int(y) if (y := _num(year)) else None,
            locator=f"{TABLE} prop_id {pid}",
            local_use_code=code or None,
            extra_facts=[("parcel.building_class", cls, None)] if (cls := _squeeze(r.get("class_cd"))) else [],
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``LiteDatabaseCurrent.zip`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        # One registry source per tax year (store.roll_source): a next-year file never retires this year's roll.
        return reg.ingest_roll(SOURCE, snapshot_path, read_roll(snapshot_path), as_of=as_of, retrieved_at=retrieved_at,
                               state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_collin", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to LiteDatabaseCurrent.zip as archived by the collector (or AD_Public.mdb / .csv)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the file's Last-Modified date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
