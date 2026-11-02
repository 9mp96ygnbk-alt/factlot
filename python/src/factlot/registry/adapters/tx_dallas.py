"""Dallas Central Appraisal District: ``DCAD<year>_CURRENT.ZIP`` → ``ParcelRecord``.

Layout (confirmed on the 2027 and 2026 files, 2026-11-02): a zip of quoted CSV files with a
header row, one row set per appraisal year, keyed by the 17-character ``ACCOUNT_NUM``.

- ``ACCOUNT_INFO.CSV`` — owner of record (``OWNER_NAME1``/``2``, ``EXCLUDE_OWNER``), owner mailing
  address, situs (``STREET_NUM``, ``FULL_STREET_NAME``, ``UNIT_ID``, ``PROPERTY_CITY``,
  ``PROPERTY_ZIPCODE``), and ``DIVISION_CD`` (``RES``, ``COM``, or ``BPP`` for business personal
  property, which is not real property).
- ``ACCOUNT_APPRL_YEAR.CSV`` — values (``TOT_VAL`` is the total market value) and ``SPTD_CODE``, the
  state property category with DCAD's subclass digit (``F10``, ``F20``, ``B11``, ``B12``).
- ``LAND.CSV`` — one row per land section with ``AREA_SIZE`` and ``AREA_UOM_DESC``.
- ``COM_DETAIL.CSV`` — commercial buildings: ``YEAR_BUILT``, ``GROSS_BLDG_AREA``.
- ``RES_DETAIL.CSV`` — residential buildings (small multifamily): ``YR_BUILT``, ``TOT_MAIN_SF``.

Usage: ``python -m factlot.registry.adapters.tx_dallas DCAD2026_CURRENT.ZIP registry.db --as-of 2026-10-12``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "48"
COUNTY_FIPS = "113"
ACCOUNT_SYSTEM = "dcad_account"

SOURCE = Source(
    source_id="tx-dallas-cad",
    publisher="Dallas Central Appraisal District",
    title="Appraisal data export (DCAD<year>_CURRENT.ZIP)",
    url="https://www.dallascad.org/DataProducts.aspx",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; public record
    attribution="Dallas Central Appraisal District",
    terms_reviewed="2026-11-02",
)

_SQFT_PER_ACRE = 43560


def _rows(path: str | Path, name: str) -> Iterator[dict[str, str]]:
    """Stream one CSV member from the zip or from an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        with open(p / name, newline="", encoding="latin-1") as f:
            yield from csv.DictReader(f)
        return
    with zipfile.ZipFile(p) as zf, zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """DCAD writes 0 when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _situs(r: dict[str, str]) -> str | None:
    number = " ".join(x for x in (r.get("STREET_NUM", "").strip(), r.get("STREET_HALF_NUM", "").strip()) if x)
    street = r.get("FULL_STREET_NAME", "").strip()
    if not street:
        return None
    unit = " ".join(x for x in (r.get("BLDG_ID", "").strip(), r.get("UNIT_ID", "").strip()) if x)
    line = " ".join(x for x in (number, street, unit) if x)
    city = r.get("PROPERTY_CITY", "").strip()
    rest = " ".join(x for x in (city, "TX", r.get("PROPERTY_ZIPCODE", "").strip()) if x)
    return f"{line}, {rest}"


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [r.get(f"OWNER_ADDRESS_LINE{i}", "").strip() for i in range(1, 5)]
    city = r.get("OWNER_CITY", "").strip()
    state_zip = " ".join(x for x in (r.get("OWNER_STATE", "").strip(), r.get("OWNER_ZIPCODE", "").strip()) if x)
    lines.append(", ".join(x for x in (city, state_zip) if x))
    country = r.get("OWNER_COUNTRY", "").strip()
    if country and country.upper() not in ("US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"):
        lines.append(country)
    return ", ".join(x for x in lines if x) or None


def read_roll(path: str | Path) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real-property account in the registry's commercial scope."""
    # 1. Which accounts are in scope, and their values (ACCOUNT_APPRL_YEAR is the smaller file).
    values: dict[str, dict[str, str]] = {}
    for r in _rows(path, "ACCOUNT_APPRL_YEAR.CSV"):
        if r.get("DIVISION_CD", "").strip().upper() == "BPP":
            continue
        if is_commercial(r.get("SPTD_CODE")):
            values[r["ACCOUNT_NUM"].strip()] = r
    # 2. Land area, buildings.
    land: dict[str, float] = defaultdict(float)
    for r in _rows(path, "LAND.CSV"):
        acct = r["ACCOUNT_NUM"].strip()
        if acct not in values:
            continue
        size = _positive(r.get("AREA_SIZE"))
        uom = r.get("AREA_UOM_DESC", "").strip().upper()
        if size and uom.startswith("SQ"):
            land[acct] += size
        elif size and uom.startswith("ACRE"):
            land[acct] += size * _SQFT_PER_ACRE
    area: dict[str, float] = defaultdict(float)
    built: dict[str, int] = {}
    for name, year_col, area_col in (("COM_DETAIL.CSV", "YEAR_BUILT", "GROSS_BLDG_AREA"),
                                     ("RES_DETAIL.CSV", "YR_BUILT", "TOT_MAIN_SF")):
        for r in _rows(path, name):
            acct = r["ACCOUNT_NUM"].strip()
            if acct not in values:
                continue
            if a := _positive(r.get(area_col)):
                area[acct] += a
            if y := _positive(r.get(year_col)):
                built[acct] = min(built.get(acct, int(y)), int(y))
    # 3. Owner and situs, then yield.
    for r in _rows(path, "ACCOUNT_INFO.CSV"):
        acct = r["ACCOUNT_NUM"].strip()
        v = values.get(acct)
        if v is None:
            continue
        confidential = r.get("EXCLUDE_OWNER", "").strip().upper() == "Y"
        owner = " ".join(x for x in (r.get("OWNER_NAME1", "").strip(), r.get("OWNER_NAME2", "").strip()) if x)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=acct,
            state_category=v.get("SPTD_CODE", "").strip() or None,
            account=acct,
            situs_address=_situs(r),
            owner_name=None if confidential else (owner or None),
            owner_mailing_address=None if confidential or not owner else _mailing_address(r),
            owner_confidential=confidential,
            land_area_sf=round(land[acct], 2) if land.get(acct) else None,
            improvement_area_sf=area[acct] if area.get(acct) else None,
            year_built=built.get(acct),
            market_value=_num(v.get("TOT_VAL")),
            tax_year=int(y) if (y := _num(v.get("APPRAISAL_YR"))) else None,
            locator=f"ACCOUNT_INFO.CSV account {acct}",
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived DCAD export into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_dallas", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to DCAD<year>_CURRENT.ZIP as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the date on the files inside the zip)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
