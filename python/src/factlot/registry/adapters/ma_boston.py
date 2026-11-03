"""City of Boston Assessing Department, "Property Assessment" on Analyze Boston → ``ParcelRecord``.

Boston is one of four municipalities in Suffolk County, Massachusetts (FIPS 25025). Chelsea,
Revere, and Winthrop assess separately and are not in this file.

Layout (confirmed on ``fy2026-property-assessment-data_rev.csv``, 2026-11-02): one UTF-8 CSV with a
header row (67 columns) and one row per parcel, condominium unit, or building (``BLDG_SEQ`` of
``NUM_BLDGS``) for the fiscal year; FY2026 values are as of 1 January 2025. Numbers carry thousands
separators (``5,000``) and ``GROSS_TAX`` a dollar sign. Key columns:

- ``PID`` — the 10-digit parcel id (ward, parcel, unit suffix), the parcel key. ``CM_ID`` is the
  condominium main parcel of a unit; ``GIS_ID`` the map parcel. The publisher's notes say these
  identifiers end in an underscore to preserve leading zeros; the FY2026 file has none, and one
  is stripped if present.
- ``LUC`` — the property type (occupancy) code: the Massachusetts state use code (DOR property
  type classification: 1xx residential, 3xx commercial, 4xx industrial, 9xx exempt) as Boston
  refines it; the publisher's table is ``propertyoccupancycodes.pdf`` on the dataset page. ``LU``
  is Boston's land-use letter code, defined in the publisher's data key
  (``property-assessment-fy2026-data-key.pdf``): ``R1``–``R3`` one- to three-family, ``R4``
  "Residential 4 or more family", ``A`` "Residential 7 or more units", ``C`` commercial, ``CL``
  commercial land, ``CC`` commercial condominium, ``I`` industrial, ``E``/``EA`` tax-exempt,
  ``RC`` mixed use, ``CD`` residential condominium unit, ``CM`` condominium main (no assessed
  value), ``CP`` condo parking, ``RL`` residential land, ``AH`` agricultural; ``LU_DESC`` is the
  occupancy-code description.
- Situs: ``ST_NUM``, ``ST_ALPHA`` (number suffix), ``ST_NUM2`` (end of a number range), ``ST_NAME``,
  ``UNIT_NUM``, ``CITY`` (the postal neighbourhood: ``EAST BOSTON``, ``DORCHESTER``), ``ZIP_CODE``.
- Owner: ``OWNER`` (owner of record, upper case, surname first for people), ``MAIL_ADDRESSEE``
  (a care-of line, often a person's name, so it is not copied), ``MAIL_STREET_ADDRESS``,
  ``MAIL_CITY``, ``MAIL_STATE``, ``MAIL_ZIP_CODE``. The file carries no owner-confidentiality flag.
- ``LAND_SF``, ``GROSS_AREA`` (building gross area, per building row), ``LIVING_AREA``,
  ``YR_BUILT``, ``YR_REMODEL``, ``LAND_VALUE``, ``BLDG_VALUE``, ``TOTAL_VALUE`` (the assessed
  value; Massachusetts assesses at full and fair cash value, so it is the market value).

Usage: ``python -m factlot.registry.adapters.ma_boston fy2026-property-assessment-data_rev.csv registry.db --as-of 2025-01-01 --fiscal-year 2026``
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from itertools import groupby
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "25"
COUNTY_FIPS = "025"
ACCOUNT_SYSTEM = "boston_pid"

SOURCE = Source(
    source_id="ma-boston-assessing",
    publisher="City of Boston Assessing Department",
    title="Property Assessment (Analyze Boston), fiscal-year parcel file",
    url="https://data.boston.gov/dataset/property-assessment",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Open Data Commons Public Domain Dedication and License (ODC-PDDL), stated on the dataset page",
    ai_use="unknown",  # not addressed by the publisher; PDDL places the data in the public domain
    redistribution="permitted",  # PDDL
    attribution="City of Boston Assessing Department, Analyze Boston",
    terms_reviewed="2026-11-02",
)

# Boston occupancy codes that are multifamily, from the publisher's "Apartment Property" group in
# propertyoccupancycodes.pdf: apartments by unit count (111 APT 4-6 UNITS, 112 APT 7-30, 113 APT
# 31-99, 114 APT 100+), 115 CO-OP APARTMENT, 120 APARTMENT, 125-127 APT SUBSIDIZED HOUSING, and
# 128 CONDO APARTMENT. Boston files 111 under its residential land-use class R4 (four to six
# units), the others under A; 111 is kept because the state code is an apartment code. The other
# 1xx codes in the group (parking, day care, elderly home, rooming house, dormitory, rectory,
# vacant land) are not apartment buildings and stay out of scope.
MULTIFAMILY_CODES = frozenset({"111", "112", "113", "114", "115", "120", "125", "126", "127", "128"})

# Owner strings a publisher uses when it has no owner of record. None was seen in the FY2026
# file (every row has an owner), so this is a guard, not a finding.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "CURRENT OWNER", "N/A"})


def state_category(luc: str | None) -> str | None:
    """FactLot category for a Boston occupancy (state use) code, or ``None`` when out of scope.

    ``B`` for the apartment codes in ``MULTIFAMILY_CODES``, ``F1`` for commercial (3xx), ``F2`` for
    industrial (4xx). Other residential (1xx), mixed use (0xx), and exempt (9xx) codes yield ``None``.
    """
    code = (luc or "").strip()
    if not code:
        return None
    if code in MULTIFAMILY_CODES:
        return "B"
    if code[0] == "3":
        return "F1"
    if code[0] == "4":
        return "F2"
    return None


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "").replace("$", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years, and values: the publisher writes 0 or blank when it has no figure."""
    v = _num(s)
    return v if v and v > 0 else None


def _ident(s: str | None) -> str:
    """An identifier column: the publisher may append ``_`` to PID, CM_ID, GIS_ID, and ZIP codes."""
    return (s or "").strip().rstrip("_").strip()


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def _situs(r: dict[str, str]) -> str | None:
    street = _text(r.get("ST_NAME"))
    if not street:
        return None
    number = _text(r.get("ST_NUM"))
    alpha = _text(r.get("ST_ALPHA"))
    if alpha:
        number = f"{number}{alpha}" if number and alpha.isalpha() else " ".join(x for x in (number, alpha) if x)
    end = _text(r.get("ST_NUM2"))
    if end and number:
        number = f"{number}-{end}"
    unit = _text(r.get("UNIT_NUM"))
    line = " ".join(x for x in (number, street, f"UNIT {unit}" if unit else "") if x)
    city = _text(r.get("CITY")) or "BOSTON"
    rest = " ".join(x for x in (city, "MA", _ident(r.get("ZIP_CODE"))) if x)
    return f"{line}, {rest}"


def _mailing_address(r: dict[str, str]) -> str | None:
    """Street, city, state ZIP. ``MAIL_ADDRESSEE`` (a care-of line) is left out: it often names a
    natural person, and the registry does not store people's names (data policy §3)."""
    street = _text(r.get("MAIL_STREET_ADDRESS"))
    city = _text(r.get("MAIL_CITY"))
    state_zip = " ".join(x for x in (_text(r.get("MAIL_STATE")), _ident(r.get("MAIL_ZIP_CODE"))) if x)
    return ", ".join(x for x in (street, city, state_zip) if x) or None


def _owner(name: str | None) -> str | None:
    n = _text(name)
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        for values in reader:
            if any(v.strip() for v in values):
                yield dict(zip(header, values))


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              fiscal_year: int | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel (or condominium unit) in scope.

    A parcel with several buildings has one row per building (``BLDG_SEQ``), consecutive in the
    file: the parcel's identity, owner, land, and value come from the first row, the building
    gross areas are summed, and the earliest year built is kept.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2);
    ``None`` keeps every parcel, with ``state_category`` ``None`` for out-of-scope codes.
    ``fiscal_year`` is recorded as ``tax_year`` (the file has no year column).
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    for pid, group in groupby(_rows(path), key=lambda r: _ident(r.get("PID"))):
        if not pid:
            continue
        rows = list(group)
        r = rows[0]
        luc = r.get("LUC", "").strip()
        category = state_category(luc)
        if keep is not None and category not in keep:
            continue
        owner = _owner(r.get("OWNER"))
        area = sum(a for row in rows if (a := _positive(row.get("GROSS_AREA"))))
        years = [int(y) for row in rows if (y := _positive(row.get("YR_BUILT")))]
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,
            land_area_sf=_positive(r.get("LAND_SF")),
            improvement_area_sf=area or None,
            year_built=min(years) if years else None,
            market_value=_positive(r.get("TOTAL_VALUE")),
            tax_year=fiscal_year,
            locator=f"{Path(path).name} PID {pid}",
            local_use_code=luc or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          fiscal_year: int | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest one archived fiscal-year CSV into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, fiscal_year=fiscal_year), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ma_boston", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the fiscal-year CSV as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True,
                    help="assessment date, YYYY-MM-DD (1 January of the calendar year before the fiscal year)")
    ap.add_argument("--fiscal-year", type=int, help="fiscal year of the file (recorded as tax_year), e.g. 2026")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  fiscal_year=args.fiscal_year, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
