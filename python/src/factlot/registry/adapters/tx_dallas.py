"""Dallas Central Appraisal District: ``DCAD<year>_CURRENT.ZIP`` → ``ParcelRecord``.

Layout (confirmed on the 2027 and 2026 files, 2026-11-02): a zip of quoted CSV files with a
header row, one row set per appraisal year, keyed by the 17-character ``ACCOUNT_NUM``.

- ``ACCOUNT_INFO.CSV`` — owner of record (``OWNER_NAME1``/``2``, ``EXCLUDE_OWNER``), owner mailing
  address, situs (``STREET_NUM``, ``FULL_STREET_NAME``, ``UNIT_ID``, ``PROPERTY_CITY``,
  ``PROPERTY_ZIPCODE``), and ``DIVISION_CD`` (``RES``, ``COM``, or ``BPP`` for business personal
  property, which is not real property). ``NBHD_CD`` ("DCAD Neighborhood identifier") is assigned on
  residential-division accounts and ``IMA`` ("DCAD Improved Market Area Identifier (Commercial
  Only)") on commercial ones; ``parcel.neighborhood_code`` is ``IMA`` for a ``COM`` account and
  ``NBHD_CD`` otherwise, as written. ``UNASSIGNED`` is DCAD's blank and writes no fact. The land
  market area (``LMA``) is not recorded.
- ``ACCOUNT_APPRL_YEAR.CSV`` — values (``TOT_VAL`` is the total market value) and ``SPTD_CODE``, the
  state property category with DCAD's subclass digit (``F10``, ``F20``, ``B11``, ``B12``).
  ``BLDG_CLASS_CD`` ("Primary building class description" in DCAD's ``TABLES AND FIELD NAMES.xlsx``)
  is written as ``parcel.building_class``: a description such as ``OFFICE BUILDING`` on commercial
  accounts, a numeric residential class (``14``) on residential-division ones. DCAD chooses the
  primary building itself; the per-building quality (``COM_DETAIL.CSV`` ``PROPERTY_QUAL_DESC``) and
  construction type (``CONSTR_TYP_DESC``) are not recorded. ``HMSTD_CAP_VAL`` ("Capped total value
  of account") is not read: it differs from ``TOT_VAL`` on about a fifth of the commercial accounts
  of the 2026 file and is the candidate for ``parcel.appraised_value``.
  A ``TOT_VAL`` of 0 is not a value: DCAD's next-year working file (``DCAD2027_CURRENT.zip`` in
  November 2026) lists every account with zero values until appraisal.
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
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import is_commercial
from ..store import IngestStats, ParcelRecord, ParcelValues, Registry, Source, roll_source

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
    with zipfile.ZipFile(p) as zf:
        # The 2022 certified export names its members in lower case (account_apprl_year.csv); later years in upper case.
        member = next((n for n in zf.namelist() if n.upper() == name.upper()), name)
        with zf.open(member) as raw:
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


def _code(s: str | None) -> str | None:
    """A DCAD code as written; blank and ``UNASSIGNED`` (DCAD's blank) are no code."""
    c = " ".join((s or "").split())
    return c if c and c.upper() != "UNASSIGNED" else None


def _class_and_area(values: dict[str, str], info: dict[str, str]) -> list[tuple[str, str, None]]:
    """``parcel.neighborhood_code`` and ``parcel.building_class`` for one account (see the module docstring)."""
    commercial = (info.get("DIVISION_CD") or values.get("DIVISION_CD") or "").strip().upper() == "COM"
    area = _code(info.get("IMA")) if commercial else _code(info.get("NBHD_CD"))
    facts: list[tuple[str, str, None]] = []
    if area:
        facts.append(("parcel.neighborhood_code", area, None))
    if cls := _code(values.get("BLDG_CLASS_CD")):
        facts.append(("parcel.building_class", cls, None))
    return facts


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
            market_value=_positive(v.get("TOT_VAL")),
            tax_year=int(y) if (y := _num(v.get("APPRAISAL_YR"))) else None,
            locator=f"ACCOUNT_INFO.CSV account {acct}",
            extra_facts=_class_and_area(v, r),
        )


def read_value_history(path: str | Path, accounts: Iterable[str]) -> Iterator[ParcelValues]:
    """Yield each listed account's tax year and market value from ``ACCOUNT_APPRL_YEAR.CSV``, and nothing else.

    For a prior-year roll (``Registry.ingest_value_history``): ``ACCOUNT_INFO.CSV`` (owners, addresses) is never
    read. Business personal property is skipped; a ``TOT_VAL`` of 0 is not a value.
    """
    wanted = frozenset(accounts)
    for r in _rows(path, "ACCOUNT_APPRL_YEAR.CSV"):
        acct = r["ACCOUNT_NUM"].strip()
        if acct not in wanted or r.get("DIVISION_CD", "").strip().upper() == "BPP":
            continue
        yield ParcelValues(
            county_fips=COUNTY_FIPS, apn=acct,
            tax_year=int(y) if (y := _num(r.get("APPRAISAL_YR"))) else None,
            market_value=_positive(r.get("TOT_VAL")),
            locator=f"ACCOUNT_APPRL_YEAR.CSV account {acct}",
        )


def build_history(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
                  retrieved_at: str | None = None) -> IngestStats:
    """Add one prior year's market values from an archived DCAD export to the Dallas parcels already loaded.

    History only (``Registry.ingest_value_history``): the current record, owners and addresses are not touched.
    A row whose ``APPRAISAL_YR`` is not ``tax_year`` is not loaded and is named in ``stats.errors``.
    """
    reg = Registry(db_path)
    try:
        src = roll_source(SOURCE, tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute("SELECT external_id FROM crosswalk WHERE system = ?", (ACCOUNT_SYSTEM,))]
        wrong: list[str] = []

        def in_year(rows: Iterable[ParcelValues]) -> Iterator[ParcelValues]:
            for r in rows:
                if r.tax_year == tax_year:
                    yield r
                else:
                    wrong.append(f"{r.locator}: tax year {r.tax_year}, expected {tax_year}")

        stats = reg.ingest_value_history(in_year(read_value_history(snapshot_path, accounts)), snap, state_fips=STATE_FIPS)
        stats.seen += len(wrong)
        stats.skipped_invalid += len(wrong)
        stats.errors.extend(wrong[:20])
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats
    finally:
        reg.close()


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived DCAD export into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        # One registry source per tax year (store.roll_source): a next-year file never retires this year's roll.
        return reg.ingest_roll(SOURCE, snapshot_path, read_roll(snapshot_path), as_of=as_of, retrieved_at=retrieved_at,
                               state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
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
    ap.add_argument("--history-only", type=int, metavar="TAX_YEAR",
                    help="the file is the roll of this earlier tax year: add its values to parcels already loaded and "
                         "change nothing else (owners, addresses, other facts and parcels are not written)")
    args = ap.parse_args(argv)
    if args.history_only:
        print(json.dumps(asdict(build_history(args.snapshot, args.db, as_of=args.as_of, tax_year=args.history_only,
                                              retrieved_at=args.retrieved_at)), indent=2))
        return 0
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
