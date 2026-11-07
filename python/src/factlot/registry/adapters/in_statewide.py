"""Indiana statewide parcels (IGIO / IndianaMap) → ``ParcelRecord``, commercial and industrial only.

The Indiana Geographic Information Office publishes "Parcel Boundaries of Indiana Current"
(FeatureServer ``Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0``). The collector
archives pages of that layer (``f=json``, ``returnGeometry=false``, ordered by ``objectid``, at
most 2,000 features) filtered to a 3-character DLGF property class in the 300s or 400s and to one
county. Layout confirmed on the live layer, 2026-11-06. The layer has no owner name and no value.

- ``state_parcel_id`` — the Indiana state parcel id. It is the APN. One tax parcel can be several
  polygons; the first row for a ``(county, state_parcel_id)`` is kept. ``parcel_id`` is the
  county's local id and is not the key (it is not read).
- ``county_fips`` — 5-digit FIPS (``18003`` Allen). The record stores the 3-digit county code.
  Marion County (``18097``) is not loaded: Indianapolis stays on ``in-marion-parcels``.
- ``dlgf_prop_class_code`` — the 3-digit DLGF property class (50 IAC 26, Code List 1). Mapped in
  ``state_category`` from the DLGF manual, not from Texas category letters.
- ``prop_add`` / ``prop_city`` / ``prop_state`` / ``prop_zip``, or ``dlgf_prop_address`` and its
  city, state and ZIP when the first street is blank — situs. No acres field; ``SHAPE__Area`` is
  in degrees and is not a land area.
- ``loaddate`` — the county harvest date on the feature. Each archived page is one county, and on
  2026-11-06 every commercial feature in a county carried the same ``loaddate``. That date is the
  snapshot ``as_of``. ``--as-of`` is used only when a page has no ``loaddate``.

Usage: ``python -m factlot.registry.adapters.in_statewide collected/in-statewide-parcels registry.db --as-of 2026-11-06``
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "18"
ACCOUNT_SYSTEM = "in_state_parcel"
# Indianapolis is already loaded from IndyGIS (in-marion-parcels), which has owners and assessed values.
MARION_COUNTY_FIPS = "097"

SOURCE = Source(
    source_id="in-statewide-parcels",
    publisher="Indiana Geographic Information Office (IGIO), Indiana GIS Data Harvest Program",
    title="Parcel Boundaries of Indiana Current",
    url="https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0",
    state_fips=STATE_FIPS,
    license="Service iteminfo licenseInfo, read 2026-11-06: citation of the Indiana GIS Data Harvest Program is "
            "'requested, but not required'. Provided \"AS IS\" with no warranty. AI use is not addressed",
    ai_use="unknown",  # the licenseInfo and the IGIO GIS-law page do not address AI use
    redistribution="permitted",  # the licenseInfo does not forbid redistribution; citation is requested, not required
    attribution="Indiana GIS Data Harvest Program (Indiana Geographic Information Office)",
    terms_reviewed="2026-11-06",
)

# DLGF Code List 1 names these three commercial-family codes as apartments (4-19, 20-39, 40 or more
# families). They use the registry's multifamily slot. 401 includes a 4-family building.
_APARTMENT_CODES = frozenset({401, 402, 403})


def _squeeze(value: object) -> str:
    return re.sub(r"\s+", " ", str(value) if value is not None else "").strip()


def _class_code(value: object) -> str:
    """The class code as written: an int ``403`` and a float ``403.0`` become ``\"403\"``."""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return _squeeze(value)


def state_category(code: object) -> str | None:
    """Registry slot for one Indiana DLGF property class code, or ``None`` when out of scope.

    The code is the 3-digit DLGF class (50 IAC 26 Code List 1, Property Tax Management System Code
    List Manual dated May 27, 2026), not a Texas Comptroller category letter. The hundreds digit is
    the DLGF family: 3 industrial, 4 commercial. ``401``, ``402`` and ``403`` are the apartment
    classes inside the commercial family. ``\"350\"`` → ``F2``; ``\"447\"`` → ``F1``; ``\"403\"`` →
    ``B``; ``\"510\"``, ``\"F1\"``, ``\"B\"``, ``\"40\"`` and ``\"\"`` → ``None``.
    """
    text = _class_code(code)
    if not re.fullmatch(r"\d{3}", text):
        return None
    number = int(text)
    if number in _APARTMENT_CODES:
        return "B"
    family = number // 100
    if family == 3:
        return "F2"
    if family == 4:
        return "F1"
    return None


def county_fips(raw: object) -> str | None:
    """3-digit Indiana county code from a 5-digit ``county_fips`` (``\"18003\"`` → ``\"003\"``).

    ``None`` when the value is not an Indiana county, and for Marion County (``18097``), which this
    source does not load.
    """
    digits = re.sub(r"\D", "", _squeeze(raw))
    if len(digits) != 5 or not digits.startswith(STATE_FIPS):
        return None
    code = digits[2:]
    if code == MARION_COUNTY_FIPS:
        return None
    return code


def loaddate_day(value: object) -> str | None:
    """``loaddate`` as ``YYYY-MM-DD`` in UTC. ArcGIS sends epoch milliseconds."""
    if isinstance(value, bool) or value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        seconds = float(value) / 1000.0 if float(value) > 1e11 else float(value)
        try:
            return datetime.fromtimestamp(seconds, timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    text = _squeeze(value)
    return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]) and len(text) >= 10 else None


def _situs(a: dict) -> str | None:
    def line(street: object, city: object, state: object, zip_code: object) -> str | None:
        street_s = _squeeze(street)
        if not street_s:
            return None
        tail = " ".join(part for part in (_squeeze(state), _squeeze(zip_code)) if part)
        rest = ", ".join(part for part in (_squeeze(city), tail) if part)
        return f"{street_s}, {rest}" if rest else street_s

    return line(a.get("prop_add"), a.get("prop_city"), a.get("prop_state"), a.get("prop_zip")) or line(
        a.get("dlgf_prop_address"), a.get("dlgf_prop_address_city"), a.get("dlgf_prop_address_state"),
        a.get("dlgf_prop_address_zip"))


def pages(path: str | Path | Iterable[str | Path]) -> list[Path]:
    """Archived JSON pages: a file, a list of files, or a collector directory."""
    paths = [Path(path)] if isinstance(path, (str, Path)) else [Path(p) for p in path]
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out += sorted(f for f in p.rglob("*")
                          if f.is_file() and (f.name == "query" or (f.suffix == ".json" and f.name != "discovered.json")))
        else:
            out.append(p)
    return out


def _attributes(page: Path) -> list[dict]:
    with open(page, encoding="utf-8") as f:
        doc = json.load(f)
    return [feat.get("attributes", feat) for feat in doc.get("features", [])]


def page_as_of(attrs: Iterable[dict], fallback: str) -> str:
    """Earliest ``loaddate`` among Indiana rows this source loads, else ``fallback``.

    Marion County and non-Indiana rows are ignored, so a mixed page is not dated by a county the
    adapter drops. The CLI ``--as-of`` is the fallback when none of the loaded rows has a date.
    """
    days = []
    for a in attrs:
        if county_fips(a.get("county_fips")) is None:
            continue
        day = loaddate_day(a.get("loaddate"))
        if day:
            days.append(day)
    return min(days) if days else fallback


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[tuple[str, str]] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope tax parcel on one archived page.

    Marion County and any row without an Indiana ``county_fips`` are skipped. A blank
    ``state_parcel_id`` is skipped. ``seen`` de-duplicates ``(county, state_parcel_id)`` across
    pages. The layer has no owner column; a name-like attribute on a row is ignored.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    path = Path(page)
    for a in _attributes(path):
        county = county_fips(a.get("county_fips"))
        pid = _squeeze(a.get("state_parcel_id"))
        if not county or not pid or (county, pid) in seen:
            continue
        category = state_category(a.get("dlgf_prop_class_code"))
        if not keep(category):
            continue
        seen.add((county, pid))
        code = _class_code(a.get("dlgf_prop_class_code"))
        yield ParcelRecord(
            county_fips=county,
            apn=pid,
            state_category=category,
            account=f"{county}:{pid}",
            situs_address=_situs(a),
            owner_name=None,  # the layer has no owner field; do not read one
            owner_mailing_address=None,
            owner_confidential=False,
            land_area_sf=None,
            improvement_area_sf=None,
            year_built=None,
            market_value=None,
            appraised_value=None,
            tax_year=None,
            locator=f"{path.parent.name}/{path.name} state_parcel_id {pid}",
            local_use_code=code or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    """Yield the in-scope parcels of every page under ``path``, each ``(county, state parcel id)`` once."""
    seen: set[tuple[str, str]] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages. Each page is its own snapshot, dated by its earliest ``loaddate``.

    The pages are a class-filtered extract with Marion County left out, not a full roll, so nothing
    is retired. ``as_of`` is the fallback date when a page carries no ``loaddate``.
    """
    total = IngestStats()
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        seen: set[tuple[str, str]] = set()
        for page in pages(snapshot_path):
            attrs = _attributes(page)
            snap = reg.add_snapshot(SOURCE.source_id, page, page_as_of(attrs, as_of), retrieved_at)
            stats = reg.ingest_parcels(read_page(page, seen=seen), snap, state_fips=STATE_FIPS,
                                       account_system=ACCOUNT_SYSTEM, full_roll=False)
            for field in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "owners_person_or_withheld",
                          "facts_written", "retired"):
                setattr(total, field, getattr(total, field) + getattr(stats, field))
            total.errors += stats.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.in_statewide", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="collected/in-statewide-parcels, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True,
                    help="fallback data date, YYYY-MM-DD, used only when a page has no loaddate")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
