"""City and County of Denver, Colorado (FIPS 08031): Assessor's real property characteristics
CSV exports → ``ParcelRecord``.

Layout (confirmed on the exports of 2026-10-29, reviewed 2026-11-02): the Denver Open Data Catalog
(an ArcGIS Hub, opendata-geospatialdenver.hub.arcgis.com) publishes two feature services whose CSV
export is a quoted, header-row, UTF-8 (BOM) file with one row per parcel:

- ``Real Property Apartment and Commercial Characteristics`` (item ``b41d9d86…``, layer 49): every
  parcel in the commercial and apartment appraisal divisions, including vacant, exempt, state-assessed
  and possessory-interest records.
- ``Real Property Residential Characteristics`` (item ``db01da75…``, layer 50): single-family,
  condominium, and small residential parcels; almost nothing in the registry's scope.

Shared columns: ``PARID`` (the 13-digit Denver schedule number, the parcel key), ``CD``/``OFCARD``
(card number and count), ``OWNER`` and ``CO_OWNER`` (owner of record), ``OWNER_NUM``, ``OWNER_DIR``,
``OWNER_ST``, ``OWNER_TYPE``, ``OWNER_APT``, ``OWNER_CITY``, ``OWNER_STATE``, ``OWNER_ZIP`` (mailing
address), ``SITE_NBR``, ``SITE_DIR``, ``SITE_NAME``, ``SITE_MODE``, ``SITE_MORE`` (situs street line;
no city or ZIP column), ``PROP_CLASS_LAND`` and ``PROP_CLASS_IMPS`` (the Colorado Division of Property
Taxation four-digit abstract subclass codes for the land and for the improvements), ``D_CLASS_CN``
(Denver's own class name), and the value columns ``ASMT_APPR_LAND``, ``ASMT_APPR_IMPR``, ``TOTAL_VALUE``
(the actual value), ``APPR_TOT_LOC`` (the value after the statutory reduction, used for local levies)
and ``ASSESS_VALUE`` / ``ASSESS_VALUE_LOC`` (assessed value). The commercial file adds
``PROPERTY_CLASS_DESC`` (the description of the land class), ``GROSS_AREA``, ``NET_AREA``,
``TOTL_SQFT``, ``NO_FLOORS``, ``ORIG_YOC``, ``REMODEL``, ``TOT_UNITS``; the residential file adds
``PROP_CLASS`` (description), ``LAND_SQFT``, ``AREA_ABG``, ``CCYRBLT``, ``UNITS``.

Property class: the improvement code decides, the land code is the fallback for a parcel with no
improvement code. The abstract codes (publisher's descriptions in ``PROPERTY_CLASS_DESC``) map to
the registry's categories as ``_CATEGORY`` below: Denver's multi-unit classes (``1220`` "MULTI-UNITS
(4-8)" and ``1225`` "MULTI-UNITS (9+)") → ``B``; commercial improvements ``2212`` merchandising,
``2215`` lodging, ``2220`` offices, ``2225`` recreation, ``2230`` special purpose, ``2235``
warehouse, ``2245`` commercial condominiums and the commercial possessory interests ``2020``–``2023``
→ ``F1``; ``3215`` manufacturing → ``F2``. Vacant land, single-family, duplex/triplex, residential
condominiums, exempt portions, agricultural, state-assessed and exempt (``9xxx``) classes are out of
scope. Both codes are kept verbatim in ``local_use_code`` as ``<improvements>/<land>``.

Usage: ``python -m factlot.registry.adapters.co_denver <commercial export>.csv registry.db --as-of 2026-10-29``
then the residential export with ``--partial``.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "08"
COUNTY_FIPS = "031"
ACCOUNT_SYSTEM = "denver_schednum"

SOURCE = Source(
    source_id="co-denver-assessor",
    publisher="City and County of Denver, Assessor's Office",
    title="Real Property Apartment and Commercial Characteristics / Residential Characteristics (Denver Open Data Catalog)",
    url="https://opendata-geospatialdenver.hub.arcgis.com/datasets/geospatialDenver::real-property-apartment-and-commercial-characteristics",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="CC BY 3.0 (City and County of Denver open data catalog); public record under the Colorado Open Records Act",
    ai_use="unknown",  # not addressed by the publisher; CC BY 3.0 does not restrict it
    redistribution="attribution_required",  # CC BY 3.0
    attribution="City and County of Denver",
    terms_reviewed="2026-11-02",
)

# Colorado Division of Property Taxation abstract subclass codes (Assessors' Reference Library
# vol. 2 ch. 6; the publisher's descriptions are the PROPERTY_CLASS_DESC / PROP_CLASS columns) that
# are in the registry's commercial scope. Improvement codes are 12xx/22xx/32xx, land codes
# 11xx/21xx/31xx; the 20xx codes are taxable possessory interests in exempt (government) land.
_CATEGORY = {
    # B: the publisher's multifamily classes
    "1220": "B", "1225": "B",  # MULTI-UNITS (4-8), MULTI-UNITS (9+) improvements
    "1120": "B", "1125": "B",  # the same classes, land
    # F1: commercial
    "2212": "F1", "2215": "F1", "2220": "F1", "2225": "F1", "2230": "F1", "2235": "F1", "2245": "F1",
    "2112": "F1", "2115": "F1", "2120": "F1", "2125": "F1", "2130": "F1", "2135": "F1", "2145": "F1",
    "2020": "F1", "2021": "F1", "2022": "F1", "2023": "F1",  # OTHER COMMERCIAL / ENTERTAINMENT / RECREATION P.I.
    # F2: industrial and manufacturing
    "3215": "F2", "3115": "F2",
}

# Owner strings Denver uses when it has no owner of record; not an owner name.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "CURRENT OWNER", "NOT AVAILABLE"})
# Owner withheld at the owner's request (C.R.S. 24-72-204(3.5), protected persons): the row says so.
_WITHHELD_MARKERS = ("CONFIDENTIAL", "WITHHELD", "PROTECTED", "REDACTED")


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the CSV export; the header is read case-insensitively because ArcGIS exports have
    changed the case of field names between releases."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().upper() for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years and counts: the export writes 0 or blank when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _code(s: str | None) -> str | None:
    """An abstract code as the export writes it (``2212``, ``2212.0`` in some exports, blank)."""
    s = (s or "").strip()
    if not s:
        return None
    if s.endswith(".0"):
        s = s[:-2]
    return s or None


def category(imps_code: str | None, land_code: str | None) -> str | None:
    """FactLot category for a parcel: the improvement class decides; the land class stands in when
    there is no improvement class. ``None`` when the parcel is out of the commercial scope."""
    code = _code(imps_code) or _code(land_code)
    return _CATEGORY.get(code) if code else None


def local_use_code(imps_code: str | None, land_code: str | None) -> str | None:
    """Both of the publisher's codes, ``<improvements>/<land>`` (``2215/2115``, ``2020/``, ``/1125``)."""
    if not imps_code and not land_code:
        return None
    return f"{imps_code or ''}/{land_code or ''}"


def _situs(r: dict[str, str]) -> str | None:
    street = r.get("SITE_NAME", "").strip()
    if not street:
        return None
    number = _positive(r.get("SITE_NBR"))
    parts = [str(int(number)) if number else "", r.get("SITE_DIR", "").strip(), street,
             r.get("SITE_MODE", "").strip(), r.get("SITE_MORE", "").strip()]
    return f"{' '.join(p for p in parts if p)}, DENVER CO"


def _mailing_address(r: dict[str, str]) -> str | None:
    number = _positive(r.get("OWNER_NUM"))
    line = " ".join(p for p in (str(int(number)) if number else "", r.get("OWNER_DIR", "").strip(),
                                r.get("OWNER_ST", "").strip(), r.get("OWNER_TYPE", "").strip(),
                                r.get("OWNER_APT", "").strip()) if p)
    city = r.get("OWNER_CITY", "").strip()
    state_zip = " ".join(p for p in (r.get("OWNER_STATE", "").strip(), r.get("OWNER_ZIP", "").strip()) if p)
    return ", ".join(p for p in (line, city, state_zip) if p) or None


def _owner(name: str | None) -> tuple[str | None, bool]:
    """(owner_name, owner_confidential) for the OWNER column."""
    n = " ".join((name or "").split())
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None, False
    if any(n.upper().startswith(m) for m in _WITHHELD_MARKERS):
        return None, True
    return n, False


def read_roll(path: str | Path) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per row of either export, in file order.

    Every parcel is yielded; ``state_category`` is ``None`` for parcels outside the commercial
    scope, which the registry counts as skipped.
    """
    for r in _rows(path):
        parid = r.get("PARID", "").strip()
        if not parid:
            continue
        imps, land = _code(r.get("PROP_CLASS_IMPS")), _code(r.get("PROP_CLASS_LAND"))
        owner_name, confidential = _owner(r.get("OWNER"))
        # Commercial export: gross building area, else the net area the apartment records carry.
        # Residential export: above-grade living area.
        area = _positive(r.get("GROSS_AREA")) or _positive(r.get("NET_AREA")) or _positive(r.get("AREA_ABG"))
        year = _positive(r.get("ORIG_YOC")) or _positive(r.get("CCYRBLT"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=parid,
            state_category=category(imps, land),
            account=parid,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=confidential,
            land_area_sf=_positive(r.get("LAND_SQFT")),
            improvement_area_sf=area,
            year_built=int(year) if year else None,
            market_value=_num(r.get("TOTAL_VALUE")),
            appraised_value=_num(r.get("APPR_TOT_LOC")),
            tax_year=None,  # the export carries no assessment year; the snapshot's as-of date does
            locator=f"PARID {parid}",
            local_use_code=local_use_code(imps, land),
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived export into a registry file (created if missing).

    The source is two files, so ``full_roll`` is off by default: turn it on only for the commercial
    export, and load the residential export with it off (``--partial``).
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.co_denver", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to a CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the feature service's data last edit date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true",
                    help="do not retire parcels missing from this file (use for the residential export)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
