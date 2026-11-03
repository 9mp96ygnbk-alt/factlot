"""Allegheny County (Pittsburgh), Pennsylvania, "Property Assessments" on WPRDC → ``ParcelRecord``.

The county's Office of Property Assessments publishes the assessment roll on the Western Pennsylvania
Regional Data Center (WPRDC, a CKAN portal at ``data.wprdc.org``) as dataset ``property-assessments``,
refreshed monthly. County FIPS 42003.

**The county withholds owner names.** The dataset description says: "Excludes name and contact
information for property owners, as required by Ordinance 3478-07." The file has no owner name; it
has ``OWNERCODE``/``OWNERDESC`` (owner type, such as ``CORPORATION`` or ``REGULAR``) and a
"change notice" mailing address, which is not copied because without an owner name it would be a bare
address that may belong to a person. Every record yielded has ``owner_name=None``;
``owner_confidential`` stays ``False`` because the withholding is the county's blanket ordinance, not
a per-owner flag (the same choice as ``wa_king``).

Layout (confirmed on ranged samples of ``data.csv``, 2026-11-03): the "for downloads" CSV
(312,706,781 bytes, one row per parcel, 86 columns, UTF-8). Its integer-looking columns can be written
as floats (``PROPERTYHOUSENUM`` ``1.0``, ``PROPERTYZIP`` ``15222.0``). Key columns, defined in the
publisher's data dictionary (``data-dictionary-open-data.csv`` on the dataset page):

- ``PARID`` — the 16-character parcel identification number; the parcel key.
- ``CLASS`` — ``R`` residential, ``C`` commercial, ``I`` industrial, ``U`` utilities, ``G`` government,
  ``F`` agricultural, ``O`` other. ``USECODE``/``USEDESC`` — the land use code (about 200 values), such as
  ``401`` ``APART: 5-19 UNITS``, ``402`` ``APART:20-39 UNITS``, ``403`` ``APART:40+ UNITS``, ``449``
  ``OFFICE-ELEVATOR -3 + STORIES``, ``350`` ``WAREHOUSE``. Mapping (``state_category``): the three apartment
  codes → ``B``; class ``C`` → ``F1``; class ``I`` → ``F2``; every other class yields no record. Retail
  and office space over apartments (``404``, ``405``, ``406``, ``431``) stays ``F1`` because the county
  classes it commercial. Parcels whose ``TAXCODE`` is not ``T`` (``E`` exempt: churches, charities) are out
  of scope.
- Situs: ``PROPERTYHOUSENUM``, ``PROPERTYFRACTION``, ``PROPERTYADDRESS`` (street name with direction and
  suffix), ``PROPERTYUNIT``, ``PROPERTYCITY``, ``PROPERTYSTATE``, ``PROPERTYZIP``.
- ``LOTAREA`` — square feet of land. ``YEARBLT`` — the year the DWELLING was built: blank for commercial
  parcels. The file has no commercial building area.
- Values: ``FAIRMARKETTOTAL`` is the base-year (2012) appraised fair market value of land and building,
  recorded as ``market_value``; ``COUNTYTOTAL`` is the county assessed value after abatements and
  preferential assessments, recorded as ``appraised_value``. Allegheny has not reassessed since the 2012
  base year, so ``market_value`` is a 2012 value. ``TAXYEAR`` is the certified tax year.

Usage: ``python -m factlot.registry.adapters.pa_allegheny data.csv registry.db --as-of 2026-11-02``
(``--as-of`` is the file's ``Last-Modified`` date or its ``ASOFDATE`` run date).
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "42"
COUNTY_FIPS = "003"
ACCOUNT_SYSTEM = "allegheny_parid"

SOURCE = Source(
    source_id="pa-allegheny-assessments",
    publisher="Allegheny County Office of Property Assessments, via the Western Pennsylvania Regional Data Center",
    title="Allegheny County Property Assessments (parcel roll, owner names excluded)",
    url="https://data.wprdc.org/dataset/property-assessments",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Creative Commons CCZero (CC0 1.0), the dataset's license field on data.wprdc.org",
    ai_use="unknown",  # not addressed; CC0 places the data in the public domain
    redistribution="permitted",  # CC0
    attribution="Allegheny County Office of Property Assessments, via WPRDC",
    terms_reviewed="2026-11-03",
)

# Allegheny land use codes that are apartment buildings of five or more units (USEDESC "APART: 5-19 UNITS",
# "APART:20-39 UNITS", "APART:40+ UNITS"; the county files them under CLASS C).
APARTMENT_CODES = frozenset({"401", "402", "403"})


def state_category(klass: str | None, use_code: str | None, tax_code: str | None = "T") -> str | None:
    """FactLot category for an Allegheny ``CLASS``/``USECODE``/``TAXCODE``, or ``None`` when out of scope.

    ``B`` for the apartment codes, ``F1`` for class ``C``, ``F2`` for class ``I``; exempt parcels
    (``TAXCODE`` ``E``) and every other class yield ``None``.
    """
    if (tax_code or "").strip().upper() != "T":
        return None
    k = (klass or "").strip().upper()
    if k == "C":
        return "B" if (use_code or "").strip() in APARTMENT_CODES else "F1"
    if k == "I":
        return "F2"
    return None


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


def _int_text(s: str | None) -> str:
    """``'1.0'`` → ``'1'``, ``'0'`` → ``''`` (a zero house number means none), ``'12A'`` stays."""
    t = _text(s)
    v = _num(t)
    if v is not None:
        return "" if v == 0 else str(int(v)) if v == int(v) else t
    return t


def _zip5(s: str | None) -> str:
    v = _num(s)
    if v is not None:
        return "" if v == 0 else f"{int(v):05d}"
    return _text(s)[:5]


def _situs(r: dict[str, str]) -> str | None:
    street = _text(r.get("PROPERTYADDRESS"))
    if not street:
        return None
    number = _int_text(r.get("PROPERTYHOUSENUM"))
    fraction = _text(r.get("PROPERTYFRACTION"))
    if fraction:
        # "-73" ends a number range, "A" is a letter suffix, "1/2" is a fraction
        joined = fraction.startswith("-") or (len(fraction) == 1 and fraction.isalpha())
        number = f"{number}{fraction}" if joined else f"{number} {fraction}".strip()
    unit = _text(r.get("PROPERTYUNIT"))
    line = " ".join(x for x in (number, street, f"UNIT {unit}" if unit else "") if x)
    city = _text(r.get("PROPERTYCITY"))
    state = _text(r.get("PROPERTYSTATE")) or "PA"
    return f"{line}, {' '.join(x for x in (city, state, _zip5(r.get('PROPERTYZIP'))) if x)}"


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        for values in reader:
            if any(v.strip() for v in values):
                yield dict(zip(header, values))


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2); ``None``
    keeps every parcel, with ``state_category`` ``None`` for out-of-scope classes.
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    for r in _rows(path):
        parid = _text(r.get("PARID"))
        if not parid:
            continue
        use = _text(r.get("USECODE"))
        category = state_category(r.get("CLASS"), use, r.get("TAXCODE"))
        if keep is not None and category not in keep:
            continue
        year = _positive(r.get("YEARBLT"))
        tax_year = _positive(r.get("TAXYEAR"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=parid,
            state_category=category,
            account=parid,
            situs_address=_situs(r),
            owner_name=None,  # excluded by county ordinance 3478-07
            owner_mailing_address=None,
            owner_confidential=False,
            land_area_sf=_positive(r.get("LOTAREA")),
            improvement_area_sf=None,  # the file's FINISHEDLIVINGAREA is dwelling area only
            year_built=int(year) if year else None,
            market_value=_positive(r.get("FAIRMARKETTOTAL")),
            appraised_value=_positive(r.get("COUNTYTOTAL")),
            tax_year=int(tax_year) if tax_year else None,
            locator=f"{Path(path).name} PARID {parid}",
            local_use_code=use or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived roll into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.pa_allegheny", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to data.csv as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date of the roll, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
