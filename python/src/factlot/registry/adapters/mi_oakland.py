"""Oakland County, Michigan: "OC Tax Parcels (Public)" open data → ``ParcelRecord``.

Oakland County publishes its tax parcels as Open Data under an Open Data Terms of Use Agreement that
allows reuse and distribution "for any lawful purpose". The layer is ArcGIS Server
``Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1`` ("Tax Parcel Plus", 490,784 parcels).
The collector archives pages of it (``f=json``, ``returnGeometry=false``, ordered by ``OBJECTID_12``,
at most 2,000 features each: ``{"features": [{"attributes": {…}}, …]}``) filtered to Michigan class
codes 2xx and 3xx. Layout confirmed against the live layer, 2026-11-03.

- ``PIN`` / ``KEYPIN`` — the 10-digit Oakland County parcel number (``2536483012``: the first two
  digits are the municipality's code, ``25`` Hazel Park). ``PIN`` is the key and the
  ``oakland_pin`` crosswalk; condominium units can share a ``KEYPIN``.
- ``CLASSCODE`` — the Michigan State Tax Commission property class (MCL 211.34c): ``1xx``
  agricultural, ``2xx`` commercial, ``3xx`` industrial, ``4xx`` residential, ``5xx`` timber-cutover,
  ``6xx`` developmental, ``x01`` improved, ``x02`` vacant, ``207`` commercial condominium, ``210``
  commercial building on leased land; ``001``-``007`` are the county's exempt/special classes. The
  layer does not give unit counts, and Michigan classes apartments of more than four units as
  commercial, so apartments are F1 here (the Wayne adapter can tell them apart from its building
  occupancy column; this layer has none). The code is kept verbatim in ``local_use_code``.
- ``NAME1`` / ``NAME2`` — owner names. They are NULL on every row of the open layer (the county
  publishes no owner names here); the adapter reads them if a later release fills them.
  ``POSTALADDRESS`` is the owner's mailing street line only.
- ``SITEADDRESS``, ``SITECITY``, ``SITESTATE``, ``SITEZIP5`` — situs; ``ASSESSEDVALUE`` and
  ``TAXABLEVALUE`` (dollars; Michigan assessed value is 50 % of true cash value, so the layer gives
  no market value); ``STRUCTURE_DESC``, ``NUM_BEDS``, ``NUM_BATHS``, ``LIVING_AREA_SQFT`` are
  residential building fields, mostly blank on commercial parcels.

Usage: ``python -m factlot.registry.adapters.mi_oakland collected/mi-oakland-parcels registry.db --as-of 2026-11-03``
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

STATE_FIPS = "26"
COUNTY_FIPS = "125"
ACCOUNT_SYSTEM = "oakland_pin"

SOURCE = Source(
    source_id="mi-oakland-parcels",
    publisher="Oakland County, Michigan (Access Oakland Open Data)",
    title="OC Tax Parcels (Public) (EnterpriseOpenParcelDataMapService/MapServer/1)",
    url="https://www.arcgis.com/home/item.html?id=e2910cc3a8f84549ab7f0f8e8f99817b",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Oakland County Open Data Terms of Use Agreement, section 3: 'You may retrieve, download, copy, modify, "
            "translate, adapt, distribute, sort, search, and reuse Open Data for any lawful purpose.' As-is "
            "disclaimers and an indemnification clause apply",
    ai_use="unknown",  # the terms do not address AI use; reuse for any lawful purpose is permitted
    redistribution="permitted",
    attribution="Oakland County, Michigan",
    terms_reviewed="2026-11-03",
)

# Michigan classification (first digit) → FactLot category. Real property only.
_CATEGORY_BY_CLASS_PREFIX = {
    "1": "D1",  # agricultural (out of scope)
    "2": "F1",  # commercial
    "3": "F2",  # industrial
    "4": "A",   # residential (out of scope)
    "5": "D2",  # timber-cutover (out of scope)
    "6": "C1",  # developmental (out of scope)
}
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER"})


def _squeeze(s: object) -> str:
    return re.sub(r"\s+", " ", str(s) if s is not None else "").strip()


def _positive(v: object) -> float | None:
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def state_category(code: object) -> str | None:
    """``2xx`` → F1, ``3xx`` → F2; other first digits map to their out-of-scope category.

    Personal-property codes (``x51``) and codes outside the STC list (``001``, ``002``, …) give ``None``.
    """
    c = _squeeze(code)
    if len(c) != 3 or not c.isdigit() or c.endswith("51"):
        return None
    return _CATEGORY_BY_CLASS_PREFIX.get(c[0])


def _situs(a: dict) -> str | None:
    street = _squeeze(a.get("SITEADDRESS"))
    if not street:
        return None
    rest = " ".join(x for x in (_squeeze(a.get("SITECITY")), _squeeze(a.get("SITESTATE")) or "MI",
                                _squeeze(a.get("SITEZIP5"))) if x)
    return f"{street}, {rest}"


def _owner(a: dict) -> str | None:
    n = _squeeze(a.get("NAME1"))
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


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


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[str] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel of one archived page (first row per PIN wins)."""
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in _features(Path(page)):
        pin = _squeeze(a.get("PIN")) or _squeeze(a.get("KEYPIN"))
        if not pin or pin in seen:
            continue
        category = state_category(a.get("CLASSCODE"))
        if not keep(category):
            continue
        seen.add(pin)
        name = _owner(a)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pin,
            state_category=category,
            account=pin,
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=_squeeze(a.get("POSTALADDRESS")) or None if name else None,
            owner_confidential=False,
            land_area_sf=None,  # the layer has no acreage column
            improvement_area_sf=_positive(a.get("LIVING_AREA_SQFT")),
            year_built=None,
            market_value=None,  # Michigan assessed value is 50 % of true cash value; none is published here
            appraised_value=_positive(a.get("ASSESSEDVALUE")),
            tax_year=None,
            locator=f"{Path(page).parent.name}/{Path(page).name} PIN {pin}",
            local_use_code=_squeeze(a.get("CLASSCODE")) or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    """Yield the in-scope parcels of every page under ``path``, each PIN once."""
    seen: set[str] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing); each page is a snapshot.

    The pages are a class-filtered extract, not the whole roll, so no parcel is retired.
    """
    total = IngestStats()
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        seen: set[str] = set()
        for page in pages(snapshot_path):
            snap = reg.add_snapshot(SOURCE.source_id, page, as_of, retrieved_at)
            s = reg.ingest_parcels(read_page(page, seen=seen), snap, state_fips=STATE_FIPS,
                                   account_system=ACCOUNT_SYSTEM, full_roll=False)
            for f in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "owners_person_or_withheld",
                      "facts_written", "retired"):
                setattr(total, f, getattr(total, f) + getattr(s, f))
            total.errors += s.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.mi_oakland", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/mi-oakland-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
