"""Philadelphia Office of Property Assessment: ``opa_properties_public.csv`` → ``ParcelRecord``.

Layout (confirmed on the nightly file of 2026-11-02): one UTF-8 CSV with a header row, 78
columns, and one row per OPA account (583,722 rows, about 294 MB; the last column, ``shape``, is
the parcel point as EWKT and is ignored). The same table is served by the City's Carto SQL API
(``phl.carto.com``, table ``opa_properties_public``, with ``the_geom`` columns instead of
``shape``); this adapter reads that export too, since it goes by column name.

- ``parcel_number`` — the 9-digit OPA account number, the parcel key (leading zeros kept).
  ``pin`` is the City's 10-digit property index number.
- ``category_code`` / ``category_code_description`` — OPA's property category (``1`` SINGLE
  FAMILY, ``2`` MULTI FAMILY, ``3`` MIXED USE, ``4`` COMMERCIAL, ``5`` INDUSTRIAL, ``6`` VACANT
  LAND, ``7`` GARAGE - COMMERCIAL, ``8`` GARAGE - RESIDENTIAL, ``9`` HOTEL, ``10`` OFFICES,
  ``11`` SPECIAL PURPOSE, ``12``/``13`` VACANT LAND non-residential/residential, ``14``
  APARTMENTS > 4 UNITS, ``15`` RETAIL, ``16`` unlabelled).
- ``building_code`` / ``building_code_description`` — OPA's building type (``CA0`` APTS 5-50
  UNITS MASONRY, ``LC0`` IND WAREHOUSE MASONRY, ``S30`` ROW W/OFF STR 2 STY MASON, ``SC``
  VACANT LAND COMMER < ACRE). ``building_code_new`` is a newer numeric scheme, not yet filled
  for every row.
- Situs: ``location`` (street line, ``1312-14 S JUNIPER ST``), ``unit``, ``zip_code``; the
  parts (``house_number``, ``street_direction``, ``street_name``, ...) are also published.
- Owner: ``owner_1`` (owner of record), ``owner_2`` (co-owner or continuation line),
  ``mailing_care_of`` (a c/o line: a servicer or agent), ``mailing_address_1`` (an addressee
  line: usually the owner's name again, or the e-recording vendor), ``mailing_address_2``,
  ``mailing_street``, ``mailing_city_state`` (``PHILADELPHIA PA``), ``mailing_zip``. There is
  no confidentiality flag.
- ``market_value`` (the certified market value; ``market_value_date`` is always empty and the
  file names no tax year), ``assessment_date``, ``total_area`` (land, square feet),
  ``total_livable_area`` (building, square feet), ``year_built`` (``0000`` when unknown) and
  ``year_built_estimate`` (``Y`` when the year is OPA's estimate).

Usage: ``python -m factlot.registry.adapters.pa_philadelphia opa_properties_public.csv registry.db --as-of 2026-11-02``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "42"
COUNTY_FIPS = "101"
ACCOUNT_SYSTEM = "opa_account"

SOURCE = Source(
    source_id="pa-philadelphia-opa",
    publisher="City of Philadelphia, Office of Property Assessment",
    title="Properties (opa_properties_public.csv, nightly)",
    url="https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="City of Philadelphia License: the City reserves all rights in the database, provides the data "
            "as is, and states no redistribution right; public record",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # the City reserves all rights in the database; needs a person's decision
    attribution="City of Philadelphia, Office of Property Assessment",
    terms_reviewed="2026-11-02",
)

# OPA category code → FactLot category, from the publisher's category_code_description column.
# Vacant land (6, 12, 13), single family (1), residential garages (8), special purpose (11:
# parks, playgrounds, clubs, utilities) and the unlabelled 16 are out of scope.
_CATEGORY = {
    "2": "B",    # MULTI FAMILY (2-4 unit buildings and apartment houses alike)
    "14": "B",   # APARTMENTS > 4 UNITS
    "3": "F1",   # MIXED USE (store or office with apartments)
    "4": "F1",   # COMMERCIAL
    "7": "F1",   # GARAGE - COMMERCIAL
    "9": "F1",   # HOTEL
    "10": "F1",  # OFFICES
    "15": "F1",  # RETAIL
    "5": "F2",   # INDUSTRIAL
}
# Within the commercial categories the building code refines the mapping: OPA's industrial
# building types (LA0 IND LOFT ... LU0 IND BLDG MINI WHSE, LR* COLD STORAGE, 7 / 7C1 INDUS CONDO)
# are F2, and its apartment-house types (CA0 APTS 5-50 UNITS, CB0 51-100, CC0 100+) are B.
# Office/store rows coded L30-L58 (S/D OFF/STR) have a digit second, so they stay F1.
_REFINED_CATEGORIES = frozenset({"3", "4", "7", "9", "10", "15"})
_INDUSTRIAL_BUILDING = re.compile(r"L[A-Z]|7")
_APARTMENT_BUILDING = re.compile(r"C[A-C]")

_CITY, _STATE = "PHILADELPHIA", "PA"


def _rows(path: str | Path) -> Iterator[tuple[str, dict[str, str]]]:
    """Stream ``(file name, row)`` from the CSV, or from every ``*.csv`` in an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    members = sorted(p.glob("*.csv")) if p.is_dir() else [p]
    for member in members:
        with open(member, newline="", encoding="utf-8-sig", errors="replace") as f:
            for r in csv.DictReader(f):
                yield member.name, r


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: OPA writes 0 (or leaves blank) when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _zip(s: str | None) -> str:
    """``19147`` or ``19147-2908``; OPA sometimes writes ZIP+4 without the hyphen."""
    z = _squeeze(s).rstrip("-")
    if re.fullmatch(r"\d{9}", z):
        return f"{z[:5]}-{z[5:]}"
    return z


def state_category(category_code: str | None, building_code: str | None = None) -> str | None:
    """FactLot category for an OPA category code, refined by the building code; ``None`` when out of scope."""
    cat = _squeeze(category_code)
    base = _CATEGORY.get(cat)
    if base is None:
        return None
    code = _squeeze(building_code).upper()
    if cat in _REFINED_CATEGORIES and code:
        if _INDUSTRIAL_BUILDING.match(code):
            return "F2"
        if _APARTMENT_BUILDING.match(code):
            return "B"
    return base


def local_use_code(category_code: str | None, building_code: str | None) -> str | None:
    """The publisher's own codes, ``<category>/<building>`` (``4/AA0``), or just the category."""
    cat, bld = _squeeze(category_code), _squeeze(building_code).upper()
    if not cat:
        return None
    return f"{cat}/{bld}" if bld else cat


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("location"))
    if not street:
        return None
    unit = _squeeze(r.get("unit"))
    line = f"{street} {unit}" if unit else street
    rest = " ".join(x for x in (_CITY, _STATE, _zip(r.get("zip_code"))) if x)
    return f"{line}, {rest}"


def _mailing_address(r: dict[str, str]) -> str | None:
    """c/o line, addressee line(s), street, city/state ZIP. The addressee line is dropped when it only repeats the owner."""
    lines = [_squeeze(r.get("mailing_care_of"))]
    addressee = _squeeze(r.get("mailing_address_1"))
    if addressee.upper() != _squeeze(r.get("owner_1")).upper():
        lines.append(addressee)
    lines += [_squeeze(r.get("mailing_address_2")), _squeeze(r.get("mailing_street"))]
    city_state = _squeeze(r.get("mailing_city_state"))
    lines.append(" ".join(x for x in (city_state, _zip(r.get("mailing_zip"))) if x))
    return ", ".join(x for x in lines if x) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per OPA account in scope, in file order.

    ``categories`` limits the rows kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every account (``state_category`` is then ``None`` for out-of-scope
    rows). Repeated account numbers collapse to the first row.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen: set[str] = set()
    for member, r in _rows(path):
        acct = _squeeze(r.get("parcel_number"))
        if not acct or acct in seen:
            continue
        category = state_category(r.get("category_code"), r.get("building_code"))
        if not keep(category):
            continue
        seen.add(acct)
        owner_name = _squeeze(r.get("owner_1")) or None
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=acct,
            state_category=category,
            account=acct,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the file carries no confidentiality flag
            land_area_sf=_positive(r.get("total_area")),
            improvement_area_sf=_positive(r.get("total_livable_area")),
            year_built=int(y) if (y := _positive(r.get("year_built"))) else None,
            market_value=_num(r.get("market_value")),
            tax_year=None,  # the file names no tax year (market_value_date is empty)
            locator=f"{member} parcel_number {acct}",
            local_use_code=local_use_code(r.get("category_code"), r.get("building_code")),
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``opa_properties_public.csv`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.pa_philadelphia", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to opa_properties_public.csv as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="file date, YYYY-MM-DD (the file's Last-Modified date; it is rebuilt nightly)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
