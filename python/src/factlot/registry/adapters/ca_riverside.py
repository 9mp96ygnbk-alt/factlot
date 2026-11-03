"""Riverside County Assessor-County Clerk-Recorder: CREST assessor tables (county Open Data Portal) → ``ParcelRecord``.

Layout (confirmed on the Hub CSV exports of the REST layers ``OpenData/Assessor/MapServer/70`` and
``/100``, 2026-11-02): the county GIS publishes the Assessor's CREST system as ArcGIS tables. Each
export is UTF-8 (with a byte-order mark), CRLF, one header row, one row per record. Two tables are
joined on ``PIN``:

``CREST_GENERAL`` (layer 70, one row per assessment):

- ``PIN`` — the assessment number (nine digits); ``GEO_CD`` — the parcel number the assessment sits
  on. Real property has ``PIN`` equal to ``GEO_CD``; business personal property, boats and aircraft
  carry their own ``PIN`` and the parcel they are located on in ``GEO_CD``. The registry's APN is
  ``PIN`` for real property.
- ``CLASS_CODE`` — despite the name, the Assessor's class **description** in words (``Light
  Industrial``, ``Apartment 11 - 20 Units``, ``PP BUSINESS AND EQUIPMENT``). There is no numeric
  code in the open table, and the county publishes no separate code list. Prefixes mark special
  assessments: ``PI-`` possessory interest, ``AP-`` agricultural preserve, ``CT-`` and ``MA-`` (the
  publisher does not define them in the open data); ``PP`` rows are personal property.
- Situs: ``STREET_NUMBER``, ``STREET_NUMBER_SFX``, ``STREET_PREDIRECTIONAL``, ``STREET_NAME``,
  ``STREET_TYPE``, ``UNIT_NUMBER``, ``CITY``, ``POSTAL_CD``.
- ``BUSINESS_USE_CODE`` (business personal property use, ``FQB - Warehouses & Wholesales...``),
  ``PRIME_BASE_YEAR``, ``MULTIPLE``.

``CREST_TAXYEAR`` (layer 100, one row per assessment and tax year): ``PIN``, ``TAX_YEAR`` (the roll
year as the county labels it, currently 2027), ``IS_TAXABLE``, ``LAND`` and ``STRUCTURES`` (assessed
values of the real property), ``LIVING_IMPROVEMENTS``, ``TRADE_FIXTURES``, ``PERSONAL_PROPERTY``,
penalties and exemption amounts.

**No owner of record**: the open tables carry no owner name or mailing address (the county sells them
in separate paid files), so every record is ownerless. California publishes assessed (Proposition 13
base-year) values, not market estimates, so ``LAND + STRUCTURES`` goes to ``appraised_value`` and
``market_value`` stays empty. There is no land area, building area, or year built in the open tables
(``CREST_PROPERTY_CHAR`` is served by the REST service but not as a Hub item).

Mapping to the registry's categories (data policy §3), by the publisher's class description with no
prefix: the six apartment classes (5 units and up) → ``B``; retail, office, restaurant, hotel,
service-station, automotive, storage, and other commercial improved classes → ``F1``; light and
heavy industrial, manufacturing, and warehouse classes → ``F2``. Vacant land, residential, agricultural,
exempt (church, school, government), personal-property, and every prefixed class are out of scope.
The description goes verbatim into ``local_use_code``.

Usage: ``python -m factlot.registry.adapters.ca_riverside <CREST_GENERAL csv> <CREST_TAXYEAR csv> registry.db --as-of 2026-11-02``
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

STATE_FIPS = "06"
COUNTY_FIPS = "065"
ACCOUNT_SYSTEM = "riverside_apn"

SOURCE = Source(
    source_id="ca-riverside-assessor",
    publisher="Riverside County Assessor-County Clerk-Recorder",
    title="CREST General Table and CREST Tax Year Table (County of Riverside GIS Open Data Portal)",
    url="https://gisopendata-countyofriverside.opendata.arcgis.com/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license='Public Use (ArcGIS item license text; no named open-data license); public record. '
            'County Data Distribution Disclaimer: reference only, no warranty',
    ai_use="unknown",  # not addressed on the portal; rivcoacr.org robots.txt disallows named AI crawlers
    redistribution="unknown",  # "Public Use" is undefined; public record
    attribution="County of Riverside, Assessor-County Clerk-Recorder (CREST) via Riverside County GIS / RCIT",
    terms_reviewed="2026-11-02",
)

_MULTIFAMILY = frozenset({
    "apartment 5 - 10 units", "apartment 11 - 20 units", "apartment 21 - 40 units",
    "apartment 41 - 60 units", "apartment 61 - 100 units", "apartment over 100 units",
})
_COMMERCIAL = frozenset({
    "retail - general", "retail - multi-tenant", "retail/office mixed use", "retail w/living unit",
    "commercial/residential mixed use", "neighborhood shopping center", "community shopping center",
    "department store", "grocery/produce store", "supermarket", "convenience store",
    "convenience store w/gas pumps", "service station w/c-store", "service station - self-service",
    "service station - full-service", "automotive repair", "automotive agency", "car wash", "mini-lube",
    "full service restaurant", "fast food restaurant", "cocktail lounge/bar", "office - general",
    "office - medical", "office - multi-tenant", "office condominium - general",
    "office condominium - medical", "medical complex", "veterinary clinic", "bank",
    "commercial parking lot", "other commercial use", "commercial land / misc imps",
    "hotel-general commercial", "mini-storage", "mini storage condominium", "manufactured home park",
    "other amusement", "other sports center", "fitness center", "theater", "golf course",
    "outdoor recreational", "private campground", "mortuary/funeral home", "assisted living",
    "rv/mobile home sales", "storage yard",
})
_INDUSTRIAL = frozenset({
    "light industrial", "heavy industrial", "manufacturing", "industrial condominium",
    "industrial land / misc imps", "warehouse/dry storage", "warehouse/cold storage", "warehouse/mega",
    "recycling center",
})
_CLASS_CATEGORY = {
    **dict.fromkeys(_MULTIFAMILY, "B"),
    **dict.fromkeys(_COMMERCIAL, "F1"),
    **dict.fromkeys(_INDUSTRIAL, "F2"),
}


def state_category(class_description: str | None) -> str | None:
    """Registry category for a CREST class description, or ``None`` when the parcel is out of scope.

    >>> state_category("Light Industrial"), state_category("Apartment 11 - 20 Units"), state_category("Retail - General")
    ('F2', 'B', 'F1')
    >>> state_category("Vacant Commercial Land") is None and state_category("CT-Hotel") is None
    True
    """
    key = re.sub(r"\s+", " ", class_description or "").strip().lower()
    return _CLASS_CATEGORY.get(key)


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the rows of one CSV export (or of every ``*.csv`` directly inside a directory)."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    files = sorted(p.glob("*.csv")) if p.is_dir() else [p]
    for f in files:
        with open(f, newline="", encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                yield r


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _situs(r: dict[str, str]) -> str | None:
    """``3788 MCCRAY ST UNIT 5, RIVERSIDE CA 92506``; ``None`` when there is no street name."""
    street = _squeeze(r.get("STREET_NAME"))
    if not street:
        return None
    number = _squeeze(r.get("STREET_NUMBER"))
    number = "" if number in ("", "0") else number + _squeeze(r.get("STREET_NUMBER_SFX"))
    line = " ".join(x for x in (number, _squeeze(r.get("STREET_PREDIRECTIONAL")), street,
                                _squeeze(r.get("STREET_TYPE"))) if x)
    unit = _squeeze(r.get("UNIT_NUMBER"))
    if unit:
        line = f"{line} UNIT {unit}"
    city = _squeeze(r.get("CITY"))
    zip5 = _squeeze(r.get("POSTAL_CD"))[:5]
    rest = " ".join(x for x in (city, "CA" if city else "", zip5) if x)
    return f"{line}, {rest}" if rest else line


def _keep(categories: Iterable[str] | None):
    if categories is None:
        return lambda c: True
    wanted = frozenset(x.upper() for x in categories)
    return lambda c: c in wanted


def _general(path: str | Path, categories: Iterable[str] | None) -> Iterator[tuple[dict[str, str], str | None]]:
    keep = _keep(categories)
    seen: set[str] = set()
    for r in _rows(path):
        pin = _squeeze(r.get("PIN"))
        if not pin or pin in seen:
            continue
        category = state_category(r.get("CLASS_CODE"))
        if category is None and categories is not None:
            continue
        if category is not None and not keep(category):
            continue
        seen.add(pin)
        yield r, category


def read_general(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one value-less ``ParcelRecord`` per in-scope assessment in ``CREST_GENERAL``, in file order."""
    for r, category in _general(path, categories):
        pin = _squeeze(r.get("PIN"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pin,
            state_category=category,
            account=pin,
            situs_address=_situs(r),
            owner_name=None,  # the open tables carry no owner of record
            owner_mailing_address=None,
            owner_confidential=False,
            locator=f"CREST_GENERAL PIN {pin}",
            local_use_code=_squeeze(r.get("CLASS_CODE")) or None,
        )


def read_values(taxyear_path: str | Path, categories_by_pin: dict[str, str]) -> Iterator[ParcelRecord]:
    """Yield a values-only ``ParcelRecord`` for each ``CREST_TAXYEAR`` row whose PIN is in ``categories_by_pin``."""
    seen: set[str] = set()
    for r in _rows(taxyear_path):
        pin = _squeeze(r.get("PIN"))
        category = categories_by_pin.get(pin)
        if category is None or pin in seen:
            continue
        seen.add(pin)
        land, structures = _num(r.get("LAND")), _num(r.get("STRUCTURES"))
        total = None if land is None and structures is None else (land or 0.0) + (structures or 0.0)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pin,
            state_category=category,
            account=pin,
            appraised_value=total,
            tax_year=int(y) if (y := _num(r.get("TAX_YEAR"))) else None,
            locator=f"CREST_TAXYEAR PIN {pin}",
        )


def read_roll(general_path: str | Path, taxyear_path: str | Path | None = None, *,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one merged ``ParcelRecord`` per in-scope assessment: class, situs, and (when the tax-year
    table is given) the assessed value and tax year.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2);
    ``None`` keeps every assessment, with ``state_category`` empty for out-of-scope classes.
    """
    values: dict[str, ParcelRecord] = {}
    if taxyear_path is not None:
        general = {r.apn: r.state_category for r in read_general(general_path, categories=categories)}
        values = {v.apn: v for v in read_values(taxyear_path, general)}
    for rec in read_general(general_path, categories=categories):
        v = values.get(rec.apn)
        if v is not None:
            rec.appraised_value = v.appraised_value
            rec.tax_year = v.tax_year
        yield rec


def build(general_path: str | Path, taxyear_path: str | Path, db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest the two archived CSVs into a registry file (created if missing).

    Each table is its own snapshot, so class and situs facts cite ``CREST_GENERAL`` and value facts
    cite ``CREST_TAXYEAR``. ``full_roll`` applies to the general table (one row per assessment, the
    whole roll): parcels an earlier snapshot covered but this one does not list are retired.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        general_snap = reg.add_snapshot(SOURCE.source_id, general_path, as_of, retrieved_at)
        records = list(read_general(general_path))
        stats = reg.ingest_parcels(records, general_snap, state_fips=STATE_FIPS,
                                   account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
        tax_snap = reg.add_snapshot(SOURCE.source_id, taxyear_path, as_of, retrieved_at)
        values = reg.ingest_parcels(read_values(taxyear_path, {r.apn: r.state_category for r in records}),
                                    tax_snap, state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM)
        stats.facts_written += values.facts_written
        stats.errors.extend(values.errors)
        return stats
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ca_riverside", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("general", help="archived CREST General Table CSV (layer 70) as saved by the collector")
    ap.add_argument("taxyear", help="archived CREST Tax Year Table CSV (layer 100) as saved by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the file's retrieval or Last-Modified date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.general, args.taxyear, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
