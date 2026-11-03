"""Denton Central Appraisal District: the county's published parcel layer (ArcGIS REST pages) → ``ParcelRecord``.

DCAD's appraisal data is published through the Denton County GIS server as the layer ``Parcels_FC``
(``https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0``, "Parcels from the
Denton Central Appraisal District" in the county's GIS Hub). The collector archives query results
as JSON pages (``resultOffset`` paging, 2,000 features a page, no geometry); each page is an ArcGIS
``query`` response, ``{"features": [{"attributes": {...}}, ...]}``. Layout (confirmed 2026-11-03):

- ``pid`` — the DCAD property id (an integer), the parcel key; ``geoID`` the geographic id.
  ``propType`` is ``R`` for real property (the layer holds nothing else on the pages the config
  requests, but the adapter checks).
- ``stateCodes`` — a comma-separated list of the state codes of the account's improvements and land
  (``F1``, ``B2``, ``A1,F1``, ``D1,D2,E1``). An account can mix commercial and residential codes.
  The code table is in DCAD's data schema document (``DCAD data schema`` on the Data Extracts page),
  which the district's site did not serve to the collector; ``F1``, ``F2`` and ``B1``/``B2`` are the
  Comptroller's own codes (commercial, industrial, multifamily) and the only ones mapped. ``F3``,
  ``F4`` and ``F010`` (about 100 accounts) are kept verbatim and fall out of scope until the
  district's table is read.
- ``name`` is the owner of record (``nameSecondary`` a second owner, ignored); ``confidential`` is
  1 for an owner who made a Tax Code §25.025 election (the name is withheld, the adapter drops
  whatever the row carries and marks the owner confidential). ``addrDeliveryLine``,
  ``addrUnitDesignator`` and ``addrFreeForm3`` (``CITY, ST ZIP``) are the mailing address.
- Situs: ``situs_street_address`` and ``situsCity``, ``situsState``, ``situsZip``.
- ``landTotalSqft`` (``land_sqft`` and ``legalAcreage`` as fallbacks), ``imprvMainArea`` (main area
  of all buildings; ``imprvTotalArea`` also counts porches and pavement and is not used),
  ``imprvActualYearBuilt``, ``ownerMarketValue`` and ``ownerAppraisedValue`` (the owner's values for
  the account), ``pYear`` (the appraisal year of the record).

Usage: ``python -m factlot.registry.adapters.tx_denton registry.db --as-of 2026-11-03 PAGE.json [PAGE.json ...]``
(a directory of pages also works).
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
from .tx_collin import _num, _positive, _squeeze

STATE_FIPS = "48"
COUNTY_FIPS = "121"
ACCOUNT_SYSTEM = "dcad_prop_id"

SOURCE = Source(
    source_id="tx-denton-cad",
    publisher="Denton Central Appraisal District (published by Denton County GIS)",
    title="Parcels from the Denton Central Appraisal District (Parcels_FC, ArcGIS REST pages)",
    url="https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); the county GIS Hub lists the layer as Open Data with no license or terms of use stated",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # not addressed; public record
    attribution="Denton Central Appraisal District; Denton County GIS",
    terms_reviewed="2026-11-03",
)

_SQFT_PER_ACRE = 43560

# Priority when an account carries several state codes: industrial, then commercial, then multifamily.
_PRIORITY = ("F2", "F1", "B")


def _code_category(code: str) -> str:
    """Comptroller category of one DCAD state code: ``B1``/``B2`` → ``B``; everything else is kept verbatim."""
    c = code.strip().upper()
    if re.fullmatch(r"B\d*", c):
        return "B"
    return c


def state_category(codes: str | None) -> str | None:
    """Category for a ``stateCodes`` list: the first of F2, F1, B present, else the first code listed."""
    parts = [_code_category(p) for p in (codes or "").split(",") if p.strip()]
    for wanted in _PRIORITY:
        if wanted in parts:
            return wanted
    return parts[0] if parts else None


def _situs(a: dict) -> str | None:
    street = _squeeze(a.get("situs_street_address"))
    if not street:
        return None
    state = _squeeze(a.get("situsState")) or "TX"
    rest = " ".join(x for x in (_squeeze(a.get("situsCity")), state, _squeeze(a.get("situsZip"))) if x)
    return f"{street}, {rest}"


def _mailing_address(a: dict) -> str | None:
    parts = [_squeeze(a.get("addrDeliveryLine")), _squeeze(a.get("addrUnitDesignator")), _squeeze(a.get("addrFreeForm3"))]
    return ", ".join(p for p in parts if p) or None


def _pages(paths: str | Path | Iterable[str | Path]) -> Iterator[tuple[Path, dict]]:
    """Each ArcGIS ``query`` JSON page among the given files (a directory contributes every file in it)."""
    items = [paths] if isinstance(paths, (str, Path)) else list(paths)
    for item in items:
        p = Path(item)
        files = sorted(f for f in p.rglob("*") if f.is_file() and not f.name.startswith(".")) if p.is_dir() else [p]
        for f in files:
            try:
                doc = json.loads(f.read_text("utf-8"))
            except ValueError:
                continue
            if isinstance(doc, dict) and isinstance(doc.get("features"), list):
                yield f, doc


def _keeper(categories: Iterable[str] | None):
    if categories is COMMERCIAL_CATEGORIES:
        return is_commercial
    if categories is None:
        return lambda code: True
    wanted = frozenset(c.upper() for c in categories)
    return lambda code: (code or "") in wanted


def _page_records(doc: dict, keep, seen: set[str]) -> Iterator[ParcelRecord]:
    for feature in doc["features"]:
        a = feature.get("attributes") or {}
        if _squeeze(a.get("propType")).upper() not in ("", "R"):
            continue
        pid = _squeeze(str(a.get("pid") if a.get("pid") is not None else "")).lstrip("0")
        if not pid or pid in seen:
            continue
        codes = _squeeze(a.get("stateCodes")).upper()
        category = state_category(codes)
        if not keep(category):
            continue
        seen.add(pid)
        confidential = bool(_num(str(a.get("confidential") or 0)))
        owner = None if confidential else (_squeeze(a.get("name")) or None)
        land = _positive(str(a.get("landTotalSqft") or "")) or _positive(str(a.get("land_sqft") or ""))
        if land is None:
            acres = _positive(str(a.get("legalAcreage") or ""))
            land = round(acres * _SQFT_PER_ACRE, 2) if acres else None
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=None if confidential else _situs(a),
            owner_name=owner,
            owner_mailing_address=_mailing_address(a) if owner else None,
            owner_confidential=confidential,
            land_area_sf=land,
            improvement_area_sf=_positive(str(a.get("imprvMainArea") or "")),
            year_built=int(y) if (y := _positive(str(a.get("imprvActualYearBuilt") or ""))) else None,
            market_value=_num(str(a["ownerMarketValue"])) if a.get("ownerMarketValue") is not None else None,
            appraised_value=_num(str(a["ownerAppraisedValue"])) if a.get("ownerAppraisedValue") is not None else None,
            tax_year=int(y) if (y := _num(str(a.get("pYear") or ""))) else None,
            locator=f"Parcels_FC pid {pid}",
            local_use_code=codes or None,
        )


def read_roll(paths: str | Path | Iterable[str | Path], *,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real-property account in scope, page by page.

    ``categories`` limits the rows kept by Comptroller category (default: the registry's commercial
    scope); ``None`` keeps every real-property account. A repeated ``pid`` (an account with several
    parcel polygons, which differ only in situs) collapses to its first row across all pages.
    """
    keep = _keeper(categories)
    seen: set[str] = set()
    for _, doc in _pages(paths):
        yield from _page_records(doc, keep, seen)


def build(page_paths: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest archived query pages into a registry file (created if missing), one snapshot per page.

    Each page cites its own document (the page holding the account's first row), so no page is a
    complete roll: nothing is retired. Parcels
    that leave scope between loads stay as they were until a later full-roll pass.
    """
    total = IngestStats()
    seen: set[str] = set()
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        for page, doc in _pages(page_paths):
            snap = reg.add_snapshot(SOURCE.source_id, page, as_of, retrieved_at)
            stats = reg.ingest_parcels(_page_records(doc, is_commercial, seen), snap, state_fips=STATE_FIPS,
                                       account_system=ACCOUNT_SYSTEM, full_roll=False)
            for k, v in asdict(stats).items():
                if isinstance(v, int):
                    setattr(total, k, getattr(total, k) + v)
                elif isinstance(v, list):
                    getattr(total, k).extend(v)
    finally:
        reg.close()
    return total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_denton", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("pages", nargs="+", help="query pages as archived by the collector (files or directories)")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.pages, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
