"""Hennepin County, Minnesota (Minneapolis): ``County_Parcels.csv`` → ``ParcelRecord``.

Layout (confirmed on the Hub export last modified 2026-10-22, read 2026-11-02): one UTF-8 CSV
with a byte-order mark, LF line endings, a quoted header row, and 121 columns; one row per tax
parcel, keyed by the 13-digit ``PID``. The file is the county's ArcGIS Hub export of the "County
Parcels" layer (item ``7975aabf6e1e42998a40a4b085ffefdf``, layer 1), whose attributes come from a
monthly extract of the county property tax system. String fields are space-padded to their width.

- ``PID`` — the property identification number, the parcel key (``0102724110003``).
- ``PROPERTY_STATUS_CD`` — ``0`` current, ``3`` non-current (a divided or retired PID), ``D`` in
  process. Only current parcels are tax parcels.
- Situs: ``HOUSE_NO`` (integer, ``0`` when there is none), ``FRAC_HOUSE_NO``, ``STREET_NM``,
  ``CONDO_NO`` (unit), ``MUNIC_NM``, ``ZIP_CD``. ``MULTI_ADDR_IND`` marks parcels with several
  addresses, of which the file carries one.
- Owner: ``OWNER_NM`` (35 characters, truncated by the county at that width). ``TAXPAYER_NM`` and
  ``TAXPAYER_NM_1``..``_3`` are the taxpayer name and mailing address lines (28 characters each);
  the taxpayer is often but not always the owner, so the mailing address is kept only when the two
  names agree. The file carries no confidentiality flag: Safe at Home participants (Minn. Stat.
  § 5B, § 13.045 subd. 4a) are masked by the county before publication and cannot be told apart.
- Property type, up to four subrecords: ``PR_TYP_CD1``/``PR_TYP_NM1`` … ``PR_TYP_CD4``/``_NM4``,
  each with its own ``LAND_MV``, ``BLDG_MV``, ``TOTAL_MV``, ``HMSTD_CD``. Subrecord 1 is the primary
  use and decides the registry category; the code is kept in ``local_use_code``. The code table
  (``_CATEGORY`` below) is transcribed from the code/name pairs in the file itself; the county's
  attribute-table PDF lives on gis.hennepin.us, which forbids robots.
- ``BUILD_YR`` (``0000`` when unknown), ``PARCEL_AREA`` (polygon area in square feet from the GIS
  layer: stacked multi-PID parcels such as condominium units share one polygon and so one area),
  ``MKT_VAL_TOT`` (total estimated market value), ``TAXABLE_VAL_TOT`` (total taxable market value,
  after exclusions), ``SALE_DATE`` (``YYYYMM``), ``SALE_PRICE``. There is no building-area column
  and no assessment-year column.

Usage: ``python -m factlot.registry.adapters.mn_hennepin County_Parcels.csv registry.db --as-of 2026-10-22``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "27"
COUNTY_FIPS = "053"
ACCOUNT_SYSTEM = "hennepin_pid"

SOURCE = Source(
    source_id="mn-hennepin-assessor",
    publisher="Hennepin County",
    title="County Parcels (ArcGIS Hub export of the property tax extract, County_Parcels.csv)",
    url="https://gis-hennepin.hub.arcgis.com/datasets/hennepin::county-parcels/about",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public government data (Minn. Stat. ch. 13); furnished AS IS, no warranty, "
            "not suitable for legal, engineering or surveying purposes",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not restricted; public data, credit requested
    attribution="Hennepin County GIS, Hennepin County Survey Division, Hennepin County Property Tax",
    terms_reviewed="2026-11-02",
)

# Hennepin property type code (PR_TYP_CD) → FactLot category, from the code/name pairs published
# in the file (the names seen in the 2026-10-22 export; one code can carry two names, the
# preferred and non-preferred rate tiers of Minnesota class 3a). Only the three commercial
# categories are mapped; every other code is out of scope.
#   A   APARTMENT                                   → B   (class 4a: four or more units)
#   C   COMMERCIAL-PREFERRED / COMMERCIAL-NON PREFERRED → F1
#   I   INDUSTRIAL-PREFERRED / INDUSTRIAL-NON PREFERRED → F2
# Out of scope: R, B, D, RM, RZ RESIDENTIAL; DB RESIDENTIAL-TWO UNIT; TP TRIPLEX; X CONDOMINIUM;
# XM CONDO GARAGE/MISCELLANEOUS; Y TOWNHOUSE; K COMMON AREA; S SEASONAL-RESIDENTIAL REC;
# FM AG NHSTD MULT UNIT; LA VACANT LAND-APARTMENT, LC LAND-COMMERCIAL, LI LAND - INDUSTRIAL,
# LR VACANT LAND-RESIDENTIAL (vacant land is not improved commercial property, as Texas C1);
# HL and HR LOW INCOME RENTAL (class 4d, a tax class rather than a building type); NH MED/CARE
# FACILITY; CR RAILROAD; U UTILITY; HT, HX, HY (no name in the file).
_CATEGORY = {
    "A": "B",
    "C": "F1",
    "I": "F2",
}

# Current tax parcels only: 3 is a non-current (divided, combined or retired) PID, D in process.
_CURRENT_STATUS = "0"

# Owner names the county writes when it has no owner of record.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER"})


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the rows of the CSV (or of every ``*.csv`` in an unpacked directory)."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    members = sorted(p.glob("*.csv")) if p.is_dir() else [p]
    for member in members:
        with open(member, newline="", encoding="utf-8-sig", errors="replace") as f:
            yield from csv.DictReader(f)


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(s: str | None) -> float | None:
    s = _squeeze(s)
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years and values: the county writes 0 (or 0000) when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def state_category(code: str | None) -> str | None:
    """FactLot category for a Hennepin property type code (``A`` → ``B``); unmapped codes are out of scope."""
    return _CATEGORY.get(_squeeze(code).upper())


def _situs(r: dict[str, str]) -> str | None:
    """``2901 78TH ST E, BLOOMINGTON MN 55425``; ``None`` when the file has no street name."""
    street = _squeeze(r.get("STREET_NM"))
    if not street:
        return None
    number = _squeeze(r.get("HOUSE_NO"))
    if number in ("", "0"):
        number = ""
    fraction = _squeeze(r.get("FRAC_HOUSE_NO"))
    unit = _squeeze(r.get("CONDO_NO"))
    line = " ".join(x for x in (number, fraction, street, f"#{unit}" if unit else "") if x)
    rest = " ".join(x for x in (_squeeze(r.get("MUNIC_NM")), "MN", _squeeze(r.get("ZIP_CD"))) if x)
    return f"{line}, {rest}"


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def _mailing_address(r: dict[str, str], owner: str) -> str | None:
    """The taxpayer's mailing address lines, kept only when the taxpayer is the owner.

    ``OWNER_NM`` is cut at 35 characters and ``TAXPAYER_NM`` at 28, so the names are compared on
    their common width.
    """
    taxpayer = _squeeze(r.get("TAXPAYER_NM"))
    if not taxpayer or taxpayer[:27].upper() != owner[:27].upper():
        return None
    lines = [_squeeze(r.get(f"TAXPAYER_NM_{i}")) for i in (1, 2, 3)]
    return ", ".join(x for x in lines if x) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per current tax parcel in scope, in file order.

    ``categories`` limits the parcels kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every current parcel, with ``state_category`` ``None`` for the codes the
    adapter does not map. A PID that repeats (one polygon per address of a multi-address parcel)
    collapses to its first row.
    """
    wanted = None if categories is None else frozenset(c.upper() for c in categories)
    seen: set[str] = set()
    for n, r in enumerate(_rows(path), start=2):
        if _squeeze(r.get("PROPERTY_STATUS_CD")) != _CURRENT_STATUS:
            continue
        pid = _squeeze(r.get("PID"))
        if not pid or pid in seen:
            continue
        code = _squeeze(r.get("PR_TYP_CD1")).upper() or None
        category = state_category(code)
        if wanted is not None and category not in wanted:
            continue
        seen.add(pid)
        owner = _owner(r.get("OWNER_NM"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r, owner) if owner else None,
            owner_confidential=False,  # the export carries no confidentiality flag
            land_area_sf=round(a, 2) if (a := _positive(r.get("PARCEL_AREA"))) else None,
            improvement_area_sf=None,  # no building-area column
            year_built=int(y) if (y := _positive(r.get("BUILD_YR"))) else None,
            market_value=_positive(r.get("MKT_VAL_TOT")),
            appraised_value=_positive(r.get("TAXABLE_VAL_TOT")),
            tax_year=None,  # no assessment-year column
            locator=f"County_Parcels.csv line {n} PID {pid}",
            local_use_code=code,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``County_Parcels.csv`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.mn_hennepin", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to County_Parcels.csv as archived by the collector")
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
