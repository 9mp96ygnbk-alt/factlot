"""Montgomery County (Norristown), Pennsylvania, "Montgomery County Parcels" on the county GIS portal → ``ParcelRecord``.

The county publishes its parcel layer with the assessment-database attributes (owner of record,
class, land use, values, building characteristics) as an ArcGIS feature service, refreshed monthly
(2026 schedule on the county's Parcels page). County FIPS 42091. Owner names are present.

Layout (confirmed 2026-11-03 on the Hub CSV export of ``Montgomery_County_Parcels`` layer 6, 122
columns, filtered with ``where=CLASS='A'``): one row per parcel *feature*. A parcel drawn as several
polygons appears more than once with identical attributes, so rows are de-duplicated by ``TAXPIN``
(14 of 692 apartment rows). Key columns (the county's "Parcel Codes" PDF defines the codes):

- ``TAXPIN`` — the 12-digit parcel identification number; the parcel key. ``ALTERNATEI`` is the older
  municipality-block-unit number. ``PARCELTYPE`` is ``BASE PARCEL``, ``CONDOMINIUM``, ``COMMON AREA`` or
  ``RAILROAD``.
- ``CLASS`` — ``A`` apartment ("to indicate multifamily use, five or more families") → ``B``; ``C`` commercial
  → ``F1``; ``I`` industrial → ``F2``; ``R`` residential (one to four families), ``E`` exempt, ``U``
  utility, ``F`` agricultural yield no record. ``LAND_USE`` — the four-digit land use code (``4100``
  retail/office/apartments/multi-use, ``4203`` garden apartments, ``3320`` industrial one-story
  warehouse, ``2201`` commercial vacant land under 5,000 sq ft, and so on), kept as ``local_use_code``.
- Owner: ``OWN1`` (owner of record; ``OWN2`` is a co-owner and ``CAREOF`` a care-of line, neither copied),
  mailing address ``ADDR1``, ``ADDR2``, ``ADDR3`` (city, state, ZIP) and ``ZIP1_ZIP2``. No confidentiality flag.
- Situs: ``LOCATION1`` (street address), ``LOC_UNITDE``/``LOC_UNITNO`` (unit), ``Muni_Name`` (the
  municipality, which is the situs "city": ``Ambler Borough``) and ``LOC_ZIP1_Z`` (ZIP, often blank).
- ``LAND_SF`` (``LAND_ACRES`` × 43,560 when blank), ``COMM_AREA`` (commercial building gross area),
  ``COMM_YR_BL`` (commercial year built; ``YEAR_BUILT`` is the dwelling's), ``TOTAL_APPR`` total appraised
  value (recorded as ``market_value``) and ``TOTAL_ASSE`` total assessed value (``appraised_value``).
  The county's values are from a base year, not current market value.

Usage: ``python -m factlot.registry.adapters.pa_montgomery Montgomery_County_Parcels.csv registry.db --as-of 2026-10-05``
Each class (``A``, ``C``, ``I``) is its own file at the same ``--as-of``; ``--full-roll`` is only right
when the file holds every class loaded before.
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

STATE_FIPS = "42"
COUNTY_FIPS = "091"
ACCOUNT_SYSTEM = "montco_taxpin"
SQFT_PER_ACRE = 43560

SOURCE = Source(
    source_id="pa-montgomery-parcels",
    publisher="Montgomery County, Pennsylvania (Board of Assessment Appeals and Data & Mapping Services)",
    title="Montgomery County Parcels (parcel layer with assessment attributes, owner of record)",
    url="https://gis-montcopa.hub.arcgis.com/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Custom license on the county portal: 'Montgomery County provides this data as a free and open resource.' "
            "Data as is, not a legal description; the county's catalog record on data.pa.gov states Public Domain U.S. Government",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="permitted",  # offered as a free and open resource, public record
    attribution="Montgomery County, Pennsylvania",
    terms_reviewed="2026-11-03",
)

_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "CURRENT OWNER", "N/A", "NONE"})
CATEGORY_BY_CLASS = {"A": "B", "C": "F1", "I": "F2"}


def state_category(klass: str | None) -> str | None:
    """FactLot category for a county ``CLASS`` letter, or ``None`` when out of scope."""
    return CATEGORY_BY_CLASS.get((klass or "").strip().upper())


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "").replace("$", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    v = _num(s)
    return v if v and v > 0 else None


def _owner(name: str | None) -> str | None:
    n = _text(name)
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def _situs(r: dict[str, str]) -> str | None:
    street = _text(r.get("LOCATION1"))
    if not street:
        return None
    unit_designator, unit_number = _text(r.get("LOC_UNITDE")), _text(r.get("LOC_UNITNO"))
    unit = " ".join(x for x in (unit_designator or ("UNIT" if unit_number else ""), unit_number) if x)
    line = " ".join(x for x in (street, unit) if x)
    muni = _text(r.get("Muni_Name")).upper()
    zip5 = _text(r.get("LOC_ZIP1_Z"))[:5]
    return f"{line}, {' '.join(x for x in (muni, 'PA', zip5) if x)}"


def _mailing_address(r: dict[str, str]) -> str | None:
    parts = [_text(r.get(k)) for k in ("ADDR1", "ADDR2", "ADDR3")]
    parts = [p for p in parts if p]
    zip5 = _text(r.get("ZIP1_ZIP2"))[:5]
    if zip5 and not (parts and re.search(rf"\b{re.escape(zip5)}\b", parts[-1])):
        parts.append(zip5)
    return ", ".join(parts) or None


def _land_area_sf(r: dict[str, str]) -> float | None:
    sf = _positive(r.get("LAND_SF"))
    if sf is not None:
        return sf
    acres = _positive(r.get("LAND_ACRES"))
    return round(acres * SQFT_PER_ACRE, 2) if acres is not None else None


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        for values in reader:
            if any(v.strip() for v in values):
                yield dict(zip(header, values))


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope (first feature wins when a ``TAXPIN`` repeats).

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2); ``None``
    keeps every parcel, with ``state_category`` ``None`` for out-of-scope classes.
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    seen: set[str] = set()
    for r in _rows(path):
        pin = _text(r.get("TAXPIN"))
        if not pin or pin in seen:
            continue
        category = state_category(r.get("CLASS"))
        if keep is not None and category not in keep:
            continue
        seen.add(pin)
        owner = _owner(r.get("OWN1"))
        year = _positive(r.get("COMM_YR_BL")) or _positive(r.get("YEAR_BUILT"))
        use = _text(r.get("LAND_USE"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pin,
            state_category=category,
            account=pin,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,
            land_area_sf=_land_area_sf(r),
            improvement_area_sf=_positive(r.get("COMM_AREA")),
            year_built=int(year) if year else None,
            market_value=_positive(r.get("TOTAL_APPR")),
            appraised_value=_positive(r.get("TOTAL_ASSE")),
            tax_year=None,  # the layer carries no tax-year column
            locator=f"{Path(path).name} TAXPIN {pin}",
            local_use_code=use or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived class file into a registry file (created if missing).

    ``full_roll`` defaults to ``False`` because the source is loaded one class file at a time.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.pa_montgomery", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the parcels CSV as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date of the county's monthly update, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true", help="retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
