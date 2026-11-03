"""Marion County, Indiana (Indianapolis): IndyGIS parcels with owner and assessed values → ``ParcelRecord``.

IndyGIS and the Marion County Assessor's Office publish "Parcels w/ Owner Information & Assessed
Values", updated nightly (ArcGIS Server ``MapIndy/MapIndyProperty/MapServer/10``). The collector
archives pages of that layer (``f=json``, ``returnGeometry=false``, ordered by ``OBJECTID``, at most
1,000 features each) filtered to Indiana property class 300-499 (``{"features": [{"attributes":
{…}}, …]}``). Layout confirmed against the live layer, 2026-11-03.

- ``STATEPARCELNUMBER`` — the Indiana 18-digit state parcel number (``49-13-16-111-003.000-200``;
  county ``49`` is Marion's Indiana county number, ``097`` its FIPS code). It is the key and the
  ``marion_state_parcel`` crosswalk. One tax parcel can be drawn as several polygons (several
  ``OBJECTID`` rows with the same number and the same values); the adapter keeps the first row and
  sums the polygons' ``ESTSQFT``.
- ``PROPERTY_SUB_CLASS`` — the Indiana DLGF property class code (3 digits; description in
  ``PROPERTY_SUB_CLASS_DESCRIPTION``, e.g. ``COM - APT 40 OR MORE UNITS-403``) and ``PROPERTY_CLASS``
  its family (``COMMERCIAL``, ``INDUSTRIAL``, ``RESIDENTIAL``, ``AGRICULTURAL``, ``EXEMPT``, …). The
  code families are 1xx agricultural, 2xx mineral, 3xx industrial, 4xx commercial, 5xx residential,
  6xx exempt, 8xx utilities. Mapped here: 3xx → F2; 400, 409 (vacant commercial) and 410-499 → F1;
  401, 402, 403 (apartments of 4-19, 20-39 and 40 or more units) → B.
- ``FULLOWNERNAME`` — up to four owner-name lines joined with ``", "`` (``"HPI BRISTOL LLC, , , "``).
  The first line is the owner of record; a following segment that is only a company suffix
  (``INC``, ``LLC``…) belongs to it. ``OWNERADDRESS``, ``OWNERADDRESS2``, ``OWNERCITY``,
  ``OWNERSTATE``, ``OWNERZIP`` are the owner's mailing address. No confidentiality flag.
- ``ASSESSORYEAR_LANDTOTAL`` / ``ASSESSORYEAR_IMPTOTAL`` / ``ASSESSORYEAR_TOTALAV`` — the current
  assessed values (dollars); the layer has no roll-year column, so ``tax_year`` is not set.
- ``ACREAGE`` (text, acres; ``0`` on multi-polygon parcels), ``ESTSQFT`` (estimated polygon area in
  square feet), ``STNUMBER``/``PRE_DIR``/``STREET_NAME``/``SUFFIX``/``SUF_DIR``/``CITY``/``ZIPCODE``
  (situs). The layer has no year built or building area.

Usage: ``python -m factlot.registry.adapters.in_marion collected/in-marion-parcels registry.db --as-of 2026-11-03``
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

STATE_FIPS = "18"
COUNTY_FIPS = "097"
ACCOUNT_SYSTEM = "marion_state_parcel"

SOURCE = Source(
    source_id="in-marion-parcels",
    publisher="City of Indianapolis and Marion County, Indiana (IndyGIS, with the Marion County Assessor's Office)",
    title="Parcels w/ Owner Information & Assessed Values (MapIndy/MapIndyProperty/MapServer/10)",
    url="https://www.arcgis.com/home/item.html?id=0d28e222479743baa97f8f4456da7bb4",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="'There are no restrictions on the use of Data provided via data download, map or service; any data "
            "derived from the Data must acknowledge the City of Indianapolis/Marion County, IN' (ArcGIS item "
            "licenseInfo). Provided as is, for reference only",
    ai_use="unknown",  # the publisher does not address AI use; it states no restrictions on use
    redistribution="attribution_required",
    attribution="City of Indianapolis/Marion County, IN (IndyGIS and the Marion County Assessor's Office)",
    terms_reviewed="2026-11-03",
)

_SQFT_PER_ACRE = 43560
_COMPANY_SUFFIXES = frozenset({"INC", "LLC", "LP", "LLP", "LTD", "CO", "CORP", "PC", "PLLC", "NA", "LLLP", "TRUST"})


def _squeeze(s: object) -> str:
    return re.sub(r"\s+", " ", str(s) if s is not None else "").strip()


def _positive(v: object) -> float | None:
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def state_category(sub_class: object) -> str | None:
    """FactLot category for an Indiana DLGF property class code.

    3xx industrial → F2; 401-403 apartments → B; other 4xx commercial (and 400/409 vacant) → F1.
    Residential (5xx), agricultural (1xx), mineral (2xx), exempt (6xx) and utility (8xx) codes map to
    their out-of-scope category; anything else is ``None``.
    """
    m = re.match(r"\s*(\d{3})", str(sub_class if sub_class is not None else ""))
    if not m:
        return None
    code = int(m.group(1))
    if code in (401, 402, 403):
        return "B"
    family = code // 100
    return {1: "D1", 2: "D2", 3: "F2", 4: "F1", 5: "A", 6: "G", 8: "G"}.get(family)


def owner_name(raw: object) -> str | None:
    """The owner of record from ``FULLOWNERNAME`` (name lines joined with ``", "``).

    The first non-empty segment is the owner; a next segment that is only a company suffix
    (``"ACME"``, ``"INC"``) continues it (``"ACME, INC"``). A trailing ``&`` (joint owners listed on
    the next line) is dropped. Blank values give ``None``.
    """
    segments = [s.strip() for s in _squeeze(raw).split(",")]
    segments = [s for s in segments if s]
    if not segments:
        return None
    name = segments[0]
    for nxt in segments[1:]:
        if nxt.upper().rstrip(".") in _COMPANY_SUFFIXES:
            name = f"{name}, {nxt}"
        else:
            break
    name = re.sub(r"\s*(&|\bAND)\s*$", "", name).strip()
    return name or None


def _situs(a: dict) -> str | None:
    street = " ".join(x for x in (_squeeze(a.get("STNUMBER")), _squeeze(a.get("PRE_DIR")), _squeeze(a.get("STREET_NAME")),
                                  _squeeze(a.get("SUFFIX")), _squeeze(a.get("SUF_DIR"))) if x)
    if not _squeeze(a.get("STREET_NAME")):
        street = " ".join(x for x in (_squeeze(a.get("STNUMBER")), _squeeze(a.get("FULL_STNAME"))) if x)
    if not street:
        return None
    city, zip5 = _squeeze(a.get("CITY")), _squeeze(a.get("ZIPCODE"))
    rest = " ".join(x for x in (city, "IN" if city or zip5 else "", zip5) if x)
    return f"{street}, {rest}" if rest else street


def _zip(z: str) -> str:
    digits = re.sub(r"\D", "", z)
    return f"{digits[:5]}-{digits[5:]}" if len(digits) == 9 else z


def _mailing(a: dict) -> str | None:
    state_zip = " ".join(x for x in (_squeeze(a.get("OWNERSTATE")) or _squeeze(a.get("OWNERFOREIGNSTATE")),
                                     _zip(_squeeze(a.get("OWNERZIP")))) if x)
    parts = [_squeeze(a.get("OWNERADDRESS")), _squeeze(a.get("OWNERADDRESS2")), _squeeze(a.get("OWNERCITY")), state_zip,
             _squeeze(a.get("OWNERFOREIGNCOUNTRY"))]
    return ", ".join(p for p in parts if p) or None


def pages(path: str | Path | Iterable[str | Path]) -> list[Path]:
    """The archived JSON page files: a file, a list of files, or a collector directory (searched
    recursively for the files the collector names ``query`` and for ``*.json``)."""
    paths = [Path(path)] if isinstance(path, (str, Path)) else [Path(p) for p in path]
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out += sorted(f for f in p.rglob("*")
                          if f.is_file() and (f.name == "query" or (f.suffix == ".json" and f.name != "discovered.json")))
        else:
            out.append(p)
    return out


def _features(page: Path) -> Iterator[dict]:
    with open(page, encoding="utf-8") as f:
        doc = json.load(f)
    for feat in doc.get("features", []):
        yield feat.get("attributes", feat)


def polygon_areas(all_pages: Iterable[Path]) -> dict[str, float]:
    """Total ``ESTSQFT`` per state parcel number across all polygons (a parcel can be several)."""
    total: dict[str, float] = {}
    for page in all_pages:
        for a in _features(page):
            pid = _squeeze(a.get("STATEPARCELNUMBER"))
            area = _positive(a.get("ESTSQFT"))
            if pid and area:
                total[pid] = total.get(pid, 0.0) + area
    return total


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[str] | None = None, areas: dict[str, float] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope tax parcel of one archived page.

    ``seen`` de-duplicates across pages (a parcel's later polygons are skipped); ``areas`` is
    ``polygon_areas`` of all pages, used when a parcel's ``ACREAGE`` is 0.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in _features(Path(page)):
        pid = _squeeze(a.get("STATEPARCELNUMBER"))
        if not pid or pid in seen:
            continue
        category = state_category(a.get("PROPERTY_SUB_CLASS"))
        if not keep(category):
            continue
        seen.add(pid)
        name = owner_name(a.get("FULLOWNERNAME"))
        acres = _positive(a.get("ACREAGE"))
        area = round(acres * _SQFT_PER_ACRE, 2) if acres else (areas or {}).get(pid) or _positive(a.get("ESTSQFT"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=_mailing(a) if name else None,
            owner_confidential=False,  # the layer carries no confidentiality flag
            land_area_sf=round(area, 2) if area else None,
            improvement_area_sf=None,
            year_built=None,
            market_value=None,  # the layer publishes assessed values, not market values
            appraised_value=_positive(a.get("ASSESSORYEAR_TOTALAV")),
            tax_year=None,
            locator=f"{Path(page).parent.name}/{Path(page).name} STATEPARCELNUMBER {pid}",
            local_use_code=_squeeze(a.get("PROPERTY_SUB_CLASS")) or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    """Yield the in-scope parcels of every page under ``path``, each parcel number once."""
    all_pages = pages(path)
    areas = polygon_areas(all_pages)
    seen: set[str] = set()
    for page in all_pages:
        yield from read_page(page, seen=seen, areas=areas, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing); each page is a snapshot.

    The pages are a class-filtered extract, not the whole roll, so no parcel is retired.
    """
    total = IngestStats()
    all_pages = pages(snapshot_path)
    areas = polygon_areas(all_pages)
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        seen: set[str] = set()
        for page in all_pages:
            snap = reg.add_snapshot(SOURCE.source_id, page, as_of, retrieved_at)
            s = reg.ingest_parcels(read_page(page, seen=seen, areas=areas), snap, state_fips=STATE_FIPS,
                                   account_system=ACCOUNT_SYSTEM, full_roll=False)
            for f in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "owners_person_or_withheld",
                      "facts_written", "retired"):
                setattr(total, f, getattr(total, f) + getattr(s, f))
            total.errors += s.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.in_marion", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/in-marion-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved (the layer updates nightly), YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
