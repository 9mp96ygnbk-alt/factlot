"""DeKalb County, Georgia: "Tax Parcels Current" open-data layer → ``ParcelRecord``.

Source: DeKalb County GIS Division's ArcGIS Hub site (dcgis-dekalbgis.hub.arcgis.com), item
e383e80264c24402b5d5711b671acb56 "Tax Parcels Current" (FeatureServer ``TaxParcelsOD``), licensed CC0: the
tax-parcel publishing layer, "combined with assessing and tax information from CAMA and Tax systems". The
adapter reads the Hub CSV export filtered by the config to the Georgia classes ``C`` and ``I``.

Layout (confirmed on the 2026-11-03 export): UTF-8 with a BOM and a header row of 91 columns, one row per tax
parcel (condominium units repeat the parcel with ``BUILDING`` and ``UNIT`` set), keyed by ``PARCELID`` (the
Board of Assessors parcel number, ``06 248 01 003``: district, land lot, block, parcel).

- ``CLASSDSCRP`` — the Georgia digest property class (Ga. Comp. R. & Regs. 560-11-2-.21): a class letter
  (``R`` residential, ``C`` commercial, ``I`` industrial, ``E`` exempt, ``U`` utility, ``V`` conservation use,
  ``H`` historic, ``B`` brownfield) and a strata digit (``1`` improvements, ``3`` lots, ``4`` small tracts,
  ``5`` large tracts, ``9`` other). ``CLASSCD`` is empty for every row. ``USECD`` and ``USEDSCRP`` (land use)
  are empty for every row, so the file cannot separate apartments, hotels, vacant lots or offices inside
  class ``C``.
- ``OWNERNME1`` / ``OWNERNME2`` — owner of record (the second name is blank for most commercial parcels);
  ``PSTLADDRESS``, ``PSTLCITY``, ``PSTLSTATE``, ``PSTLZIP5``, ``PSTLZIP4`` — mailing address. No
  confidentiality marker exists in the file.
- ``SITEADDRESS`` — situs line with city, state and ZIP (``6106 Buford Highway Doraville, GA 30340``); blank
  for 73 of 11,352 class C and I rows (``ADDRESS_NUMBER``, ``FULL_STREET_NAME``, ``CITY``, ``STATE``, ``ZIP``
  are its parts and are used when it is blank).
- ``TOTAPR1`` — total appraised (fair market) value; ``CNTASSDVAL`` is the 40 % assessed value (Georgia taxes
  40 % of fair market value). ``ACREAGE`` — acres; ``BLDGAREA``, ``RESYRBLT`` — building area and year built
  (empty for every class C and I row on 2026-11-03, read in case the county fills them). ``LANDUSE`` is a planning
  designation (``CRC``, ``TC``, ``SUB`` …), not a parcel use, and is not read.

Category mapping (FactLot scope): ``F1`` for class ``C`` and ``F2`` for class ``I``; everything else yields no
record. ``local_use_code`` keeps ``CLASSDSCRP`` (``C3``) verbatim. Because the file has no land use, class
``C`` apartments are reported as ``F1`` rather than ``B``, and vacant class ``C`` lots are included.

Usage: ``python -m factlot.registry.adapters.ga_dekalb csv registry.db --as-of 2026-11-01``
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

STATE_FIPS = "13"
COUNTY_FIPS = "089"
ACCOUNT_SYSTEM = "dekalb_parcel_id"

SOURCE = Source(
    source_id="ga-dekalb-parcels",
    publisher="DeKalb County GIS Division (DeKalb County Board of Assessors and Tax Commissioner data)",
    title="Tax Parcels Current (DeKalb County GIS Hub, Hub CSV export)",
    url="https://dcgis-dekalbgis.hub.arcgis.com/datasets/DeKalbGIS::tax-parcels-current",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="CC0 1.0 (the dataset item's licenseInfo is 'CC0'); public records under the Georgia Open Records Act "
            "(O.C.G.A. 50-18-70 et seq.)",
    ai_use="unknown",  # the publisher does not address AI use; CC0 sets no condition
    redistribution="permitted",  # CC0
    attribution=None,
    terms_reviewed="2026-11-03",
)

_SQFT_PER_ACRE = 43560
_CLASS_CATEGORY = {"C": "F1", "I": "F2"}
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER", "N/A", "NONE"})


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def state_category(class_code: str | None) -> str | None:
    """FactLot category for a Georgia digest class, or ``None`` when out of scope.

    ``"C3"`` → ``F1``; ``"I4"`` → ``F2``; ``"R3"``, ``"E1"``, ``"V5"``, ``""`` → ``None``.
    """
    return _CLASS_CATEGORY.get(_squeeze(class_code).upper()[:1])


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    v = _num(s)
    return v if v and v > 0 else None


def _owner(r: dict[str, str]) -> str | None:
    names = [n for n in (_squeeze(r.get("OWNERNME1")), _squeeze(r.get("OWNERNME2"))) if n]
    name = " ".join(names)
    return None if not name or name.upper() in _PLACEHOLDER_OWNERS else name


def _mailing_address(r: dict[str, str]) -> str | None:
    zip_code = "-".join(x for x in (_squeeze(r.get("PSTLZIP5")), _squeeze(r.get("PSTLZIP4"))) if x)
    state_zip = " ".join(x for x in (_squeeze(r.get("PSTLSTATE")), zip_code) if x)
    city = ", ".join(x for x in (_squeeze(r.get("PSTLCITY")), state_zip) if x)
    return ", ".join(x for x in (_squeeze(r.get("PSTLADDRESS")), city) if x) or None


def _situs(r: dict[str, str]) -> str | None:
    site = _squeeze(r.get("SITEADDRESS"))
    if site:
        return site
    street = " ".join(x for x in (_squeeze(r.get("ADDRESS_NUMBER")), _squeeze(r.get("FULL_STREET_NAME"))) if x)
    if not street:
        return None
    unit = " ".join(x for x in (_squeeze(r.get("UNIT_TYPE")), _squeeze(r.get("UNIT_NO"))) if x)
    state_zip = " ".join(x for x in (_squeeze(r.get("STATE")), _squeeze(r.get("ZIP"))) if x)
    place = ", ".join(x for x in (_squeeze(r.get("CITY")), state_zip) if x)
    return ", ".join(x for x in (street, unit, place) if x)


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        for r in csv.DictReader(f):
            yield {(k or "").strip(): v for k, v in r.items()}


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope, in file order (a repeated ``PARCELID`` collapses to the first).

    ``categories=None`` keeps every parcel with a category of ``None`` for out-of-scope ones.
    """
    keep = (lambda c: is_commercial(c)) if categories is COMMERCIAL_CATEGORIES else (
        (lambda c: True) if categories is None else (lambda c, s=frozenset(x.upper() for x in categories): c in s))
    seen: set[str] = set()
    for r in _rows(path):
        pid = _squeeze(r.get("PARCELID"))
        if not pid or pid in seen:
            continue
        cls = _squeeze(r.get("CLASSDSCRP")).upper()
        category = state_category(cls)
        if not keep(category or ""):
            continue
        seen.add(pid)
        owner = _owner(r)
        acres = _positive(r.get("ACREAGE"))
        year = _positive(r.get("RESYRBLT"))
        value = _positive(r.get("TOTAPR1"))  # Georgia's appraised value is fair market value
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,  # the file carries no confidentiality marker
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=_positive(r.get("BLDGAREA")),
            year_built=int(year) if year else None,
            market_value=value,
            appraised_value=value,
            tax_year=None,  # the layer is the current digest and does not state its year
            locator=f"TaxParcelsOD PARCELID {pid}",
            local_use_code=cls or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived Hub CSV export into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ga_dekalb", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived Hub CSV export of Tax Parcels Current")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="data date, YYYY-MM-DD (the service's data last-edit date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
