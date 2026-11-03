"""Mecklenburg County, North Carolina (Charlotte): ``Cama_Table.zip`` → ``ParcelRecord``.

Layout (confirmed on the 2026-11-02 file, from the publisher's Open Mapping listing
``https://maps.mecklenburgcountync.gov/opendata/data.json``, "Tax Parcel CAMA Data"): a zip holding
one UTF-8 CSV with a BOM and a header row, ``Cama_Table.csv``, one row per parcel **and building**
("Be aware of multiple buildings per parcel; like apartment complexes"): parcel-level columns repeat
on every building row, building columns differ.

- ``parcelid`` — the Assessor's parcel id (``06121412``; condominium units ``12106414`` share a
  ``commonpid`` of the form ``12106C97`` with the complex). ``gispid`` is the same number.
- ``lusecode`` / ``landuse_description`` — the Assessor's land-use code and a use description. The
  code table is the publisher's ``Parcel_LandUseCodes.pdf`` (listed next to the file): ``A5xx`` multi
  family, ``C7xx`` commercial, ``O4xx`` office, ``I6xx`` industrial, ``R1xx``–``R3xx`` residential,
  numeric codes for institutional, exempt, utility, and waste parcels. The description column does
  not always agree with the code (it tracks the building use), so the code decides the category.
- Owner: ``ownrlstnme`` / ``ownrfrstnme`` (organisations have the whole name in the last-name
  column; ``UNKNOWN`` is a placeholder); ``mailaddr1``, ``mailaddr2``, ``mailcity``, ``state``,
  ``zipcode``. The file carries no confidentiality marker.
- Situs: ``address`` (``2821 REID MEADOWS DR CHARLOTTE NC``, ``2115 SOUTHEND DR, 103 CHARLOTTE NC``;
  no ZIP; blank when the parcel has no address), ``loccity`` (``UNINC`` for unincorporated areas).
- Areas and values: ``legalacres`` (the Assessor's legal acreage; blank for condominium units),
  ``gisacres`` (polygon acreage, the whole complex for a condominium unit), ``totalarea`` (total
  building area, finished and unfinished, per building row), ``heatedarea`` (parcel total of the
  finished area), ``yearbuilt`` (``0`` or blank when unknown), ``totalvalue`` (total assessed
  value: land + building + yard), ``totmarkval`` (market value), ``yearid`` (assessment year).

Usage: ``python -m factlot.registry.adapters.nc_mecklenburg Cama_Table.zip registry.db --as-of 2026-11-02``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "37"
COUNTY_FIPS = "119"
ACCOUNT_SYSTEM = "meck_parcel_id"

SOURCE = Source(
    source_id="nc-mecklenburg-assessor",
    publisher="Mecklenburg County Geospatial Information Services (County Assessor's Office data)",
    title="Tax Parcel CAMA Data (Cama_Table.zip)",
    url="https://maps.mecklenburgcountync.gov/openmapping/data.html",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Open data (gis.mecknc.gov/data-center: 'You have the right to redistribute the data' and to make "
            "derivative works); public record (N.C. Gen. Stat. ch. 132). robots.txt Content-Signal: search=yes, "
            "ai-train=no, use=reference",
    ai_use="unknown",  # the publisher signals no AI training and allows use as reference; the registry does not train
    redistribution="attribution_required",
    attribution="Mecklenburg County GIS / Mecklenburg County Assessor's Office",
    terms_reviewed="2026-11-02",
)

_SQFT_PER_ACRE = 43560
_MEMBER = "Cama_Table.csv"

# Land-use code families (publisher's Parcel_LandUseCodes.pdf) → FactLot category. The first two
# characters identify the family; codes outside the table (new codes such as C782 "CELL TOWER")
# follow their family.
_FAMILY_CATEGORY = {"A5": "B", "C7": "F1", "O4": "F1", "I6": "F2"}
# Codes outside those families that the publisher defines as multifamily.
_EXTRA_CATEGORY = {"AF60": "B"}  # MULTI FAMILY AFFORDABLE HOUSING
# Common-area parcels of a complex (no building, no value of their own): out of scope.
_COMMON_AREA = frozenset({"A501", "C703", "C731", "I603", "I640", "O421", "O425"})

_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER"})


def state_category(lusecode: str | None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for a Mecklenburg land-use code, or None when out of scope."""
    code = (lusecode or "").strip().upper()
    if not code or code in _COMMON_AREA:
        return None
    return _EXTRA_CATEGORY.get(code) or _FAMILY_CATEGORY.get(code[:2])


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the CSV rows from the zip, from an unpacked directory, or from the CSV itself."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        p = p / _MEMBER
    if p.suffix.lower() == ".csv":
        with open(p, newline="", encoding="utf-8-sig") as f:
            yield from csv.DictReader(f)
        return
    with zipfile.ZipFile(p) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".csv")), _MEMBER)
        with zf.open(name) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: 0 or blank means the Assessor has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _money(s: str | None) -> float | None:
    v = _num(s)
    return round(v, 2) if v is not None else None


def _owner(r: dict[str, str]) -> str | None:
    last = re.sub(r"\s+", " ", r.get("ownrlstnme", "")).strip()
    first = re.sub(r"\s+", " ", r.get("ownrfrstnme", "")).strip()
    name = " ".join(x for x in (last, first) if x)
    return None if not name or name.upper() in _PLACEHOLDER_OWNERS else name


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [re.sub(r"\s+", " ", r.get("mailaddr1", "")).strip(), re.sub(r"\s+", " ", r.get("mailaddr2", "")).strip()]
    state_zip = " ".join(x for x in (r.get("state", "").strip(), r.get("zipcode", "").strip()) if x)
    lines.append(", ".join(x for x in (r.get("mailcity", "").strip(), state_zip) if x))
    return ", ".join(x for x in lines if x) or None


def _situs(r: dict[str, str]) -> str | None:
    """``2115 SOUTHEND DR, 103 CHARLOTTE NC`` → ``2115 SOUTHEND DR, 103, CHARLOTTE NC``.

    A few rows end in a stray ZIP (``... CHARLOTTE NC -28205``), which is kept as a ZIP; ``UNINC``
    (unincorporated) is not a city.
    """
    address = re.sub(r"\s+", " ", r.get("address", "")).strip()
    if not address:
        return None
    zip_code = ""
    if m := re.search(r"\s*-?\s*(\d{5}(?:-\d{4})?)$", address):
        zip_code, address = m.group(1), address[: m.start()].strip()
    city = r.get("loccity", "").strip()
    tail = f" {city} NC"
    if city and address.upper().endswith(tail.upper()):
        street = address[: -len(tail)].strip(" ,")
        place = " ".join(x for x in ("" if city.upper() == "UNINC" else city, "NC", zip_code) if x)
        return f"{street}, {place}" if street else None
    return " ".join(x for x in (address, zip_code) if x)


_BUILDING_KEYS = ("yearbuilt", "totalarea", "finisharea", "bldgtype", "storyheight", "grade", "extwall", "basearea")


def _improvement_area(rows: list[dict[str, str]]) -> float | None:
    """Total building area of a parcel from its building rows.

    The file sometimes repeats one building's row several times (the parcel-level ``heatedarea``
    equals one row's finished area, not the sum), and sometimes lists several identical buildings
    (``heatedarea`` equals the sum). ``heatedarea`` decides: when the finished areas of all rows add
    up to it, every row is a building; when only the distinct rows add up to it, the repeats are
    dropped; without a usable ``heatedarea`` every row counts.
    """
    heated = _positive(rows[0].get("heatedarea"))
    distinct = list({tuple(r.get(k, "").strip() for k in _BUILDING_KEYS): r for r in rows}.values())
    use = rows
    if heated is not None and len(distinct) < len(rows):
        fin_all = sum(_positive(r.get("finisharea")) or 0.0 for r in rows)
        fin_distinct = sum(_positive(r.get("finisharea")) or 0.0 for r in distinct)
        if abs(fin_all - heated) >= 1 and abs(fin_distinct - heated) < 1:
            use = distinct
    total = sum(_positive(r.get("totalarea")) or 0.0 for r in use)
    return total if total > 0 else None


def _land_area(r: dict[str, str]) -> float | None:
    """Land area in square feet from ``legalacres`` (acres), with its two known faults handled.

    The Assessor's legal acreage is blank for condominium units, where the polygon (``gisacres``) is the
    whole complex, so it is used only for a parcel that owns its polygon. On 139 parcels in scope the
    "acres" figure is plainly square feet (37,330.92 "acres" beside a 0.858-acre polygon: 1.6 billion square
    feet): when it is over 50 times the polygon and at least 500, it is read as square feet if that agrees
    with the polygon to 10%, and replaced by the polygon otherwise. A condominium unit with a figure of 500 or
    more has none (21 units).
    """
    legal, polygon = _positive(r.get("legalacres")), _positive(r.get("gisacres"))
    own_polygon = r.get("commonpid", "").strip() == r.get("parcelid", "").strip()
    if legal and legal >= 500:
        if not own_polygon:
            return None  # a condominium unit's figure this large is not an acreage (21 units read as billions of square feet)
        if polygon and legal > 50 * polygon:
            if abs(legal / _SQFT_PER_ACRE - polygon) <= 0.1 * polygon:
                return round(legal, 2)
            return round(polygon * _SQFT_PER_ACRE, 2)
    acres = legal if legal is not None else (polygon if own_polygon else None)
    return round(acres * _SQFT_PER_ACRE, 2) if acres else None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope, folding the building rows of a parcel together.

    ``categories`` limits the parcels kept (default: the registry's commercial scope); ``None`` keeps
    every parcel, which needs memory for the whole roll. Building rows are summed for the improvement
    area (see ``_improvement_area``); the oldest year built is kept.
    """
    keep = (lambda c: is_commercial(c)) if categories is COMMERCIAL_CATEGORIES else (
        (lambda c: True) if categories is None else (lambda c, s=frozenset(x.upper() for x in categories): c in s))
    buildings: dict[str, list[dict[str, str]]] = {}
    for r in _rows(path):
        pid = r.get("parcelid", "").strip()
        if not pid:
            continue
        if not keep(state_category(r.get("lusecode")) or ""):
            continue
        buildings.setdefault(pid, []).append(r)
    for pid, rows in buildings.items():
        r = rows[0]
        years = [int(y) for b in rows if (y := _positive(b.get("yearbuilt"))) is not None]
        owner = _owner(r)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=state_category(r.get("lusecode")),
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,
            land_area_sf=_land_area(r),
            improvement_area_sf=_improvement_area(rows),
            year_built=min(years) if years else None,
            market_value=_money(r.get("totmarkval")),
            appraised_value=_money(r.get("totalvalue")),
            tax_year=int(y) if (y := _num(r.get("yearid"))) else None,
            locator=f"{_MEMBER} parcelid {pid}",
            local_use_code=r.get("lusecode", "").strip() or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``Cama_Table.zip`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.nc_mecklenburg", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to Cama_Table.zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="file date, YYYY-MM-DD (the 'updated' date in the Open Mapping listing)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file (use for a sample)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
