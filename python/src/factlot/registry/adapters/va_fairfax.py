"""Fairfax County, Virginia (FIPS 51059): Department of Tax Administration real estate tables →
``ParcelRecord``.

The county publishes its assessment roll as five tables on the Fairfax County GIS ArcGIS Hub
(``data-fairfaxcountygis.opendata.arcgis.com``), one CSV each, all keyed by ``PARID`` (the tax map
parcel identifier, ``0072 01  0021A``; the padding varies, so it is compared with single spaces).
Layout confirmed on the live feature services and the publisher's data dictionary
(``dta_assessment_tables.pdf``), 2026-11-02. Column names are the service field names:

- **Parcels Data** (``DTAMGR.PARCEL_GIS_PARDATALL_VIEW``): one row per parcel; ``LUC_DESC`` is the
  land use type *description* (the county's numeric land use code itself is not published in the
  table, so the description is the publisher's code here), ``LIVUNIT`` livable units,
  ``ZONING_DESC``.
- **Legal Data** (``…LEGDATALL_VIEW``): one row per parcel; site address parts (``ADRPRE``,
  ``ADRNO``, ``ADRADD``, ``ADRDIR``, ``ADRSTR``, ``ADRSUF``, ``ADRSUF2``, ``CITYNAME``, ``ZIP1``),
  deeded land area (``SQFT``, ``ACRES``).
- **Assessed Values** (``…ASMTALL_VIEW``): one row per parcel; ``APRLAND``, ``APRBLDG``, ``APRTOT``
  for the current tax year ``TAXYR`` and ``PRI*`` for the prior year. Virginia assesses at 100 % of
  fair market value (Va. Code § 58.1-3201), so ``APRTOT`` is both the appraised and the market value.
- **Land Data** (``…LANDALL_VIEW``): one row per land line (``LLINE``) with ``SF`` and ``ACRES``;
  used only when the legal table has no deeded area.
- **Commercial Data** (``…COMDATALL_VIEW``): one row per commercial improvement element with
  ``YRBLT`` and ``BUSLA`` (usable business square feet); summed/min-ed per parcel.

None of the tables carries an owner name: Fairfax County does not publish owners of record in
bulk, so every record has ``owner_name=None`` (not withheld, simply absent).

The collector archives each table as ``collected/va-fairfax-assessor/<sha16>/csv`` (the Hub
download endpoint redirects to an unnamed blob), so ``read_roll`` takes a directory or a list of
files and tells the tables apart by their headers.

Usage: ``python -m factlot.registry.adapters.va_fairfax collected/va-fairfax-assessor registry.db --as-of 2026-11-02``
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

STATE_FIPS = "51"
COUNTY_FIPS = "059"
ACCOUNT_SYSTEM = "fairfax_parcel_id"

SOURCE = Source(
    source_id="va-fairfax-assessor",
    publisher="Fairfax County Department of Tax Administration",
    title="Tax Administration Real Estate tables (Parcels, Legal, Assessed Values, Land, Commercial) on the Fairfax County GIS ArcGIS Hub",
    url="https://data-fairfaxcountygis.opendata.arcgis.com/datasets/Fairfaxcountygis::tax-administration-real-estate-parcels-data/about",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Fairfax County GIS Division disclaimer: 'Copyright by Fairfax County. Except as provided herein, all rights "
            "are reserved. Authorization to reproduce material for internal or personal use by any user of this "
            "information is granted'; public record (Va. Code § 58.1-3122.2)",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # the disclaimer grants internal or personal use only; a person must decide
    attribution="Fairfax County Department of Tax Administration / Fairfax County GIS Division",
    terms_reviewed="2026-11-02",
)

# The five tables, recognised by columns only they have (the Hub CSV header is the field names).
_TABLE_SIGNATURES = {
    "parcels": frozenset({"PARID", "LUC_DESC"}),
    "legal": frozenset({"PARID", "ADRSTR", "SQFT"}),
    "assessed": frozenset({"PARID", "APRTOT"}),
    "land": frozenset({"PARID", "LLINE", "SF"}),
    "commercial": frozenset({"PARID", "ELEMENT", "BUSLA"}),
}

# Fairfax County land use type description (``LUC_DESC``, exactly as published, compared after
# whitespace squeezing and case folding) → FactLot category. Descriptions are the publisher's; the
# 165 distinct values were listed from the live Parcels Data service on 2026-11-02 and the numeric
# land use code behind each is not in the published table. Anything not listed here is out of scope
# (residential, condominium units, vacant and agricultural land, utilities, transport rights of
# way, government, religious, educational and other exempt uses).
LAND_USE_CATEGORY: dict[str, str] = {
    # B — multifamily: the county's rental apartment classes (one parcel, many units). Condominium
    # and townhouse-development classes are per-unit or per-lot parcels and stay out.
    "Apartment, NEC including cooperatives": "B",
    "Garden Apartments rental ( =<4 story)": "B",
    "Medium rise apartments rental(5to8 stry)": "B",
    "High rise apartments rental(=>9 comm)": "B",
    "High rise apartments rental(=>9 no comm)": "B",
    # F1 — commercial: retail, office, lodging, food, automotive, services, private health care,
    # commercial recreation, self storage.
    "Apparel and accessories": "F1",
    "Auto parking": "F1",
    "Building Materials,Hardware, Farm Equip": "F1",
    "Carry-out Kitchen": "F1",
    "Carry-out with seating": "F1",
    "Cluster Office (< = 4 stories)": "F1",
    "Comm Use in Res Condo Dev": "F1",
    "Community Center": "F1",
    "Condo Center": "F1",
    "Condo office (= > 5 stories)": "F1",
    "Condo Retail (in office/Indust complex)": "F1",
    "Condominium Medical (< = 4 stories)": "F1",
    "Condominium Office (< = 4 stories)": "F1",
    "Convenience grocery": "F1",
    "Converted Residential office(exdwelling)": "F1",
    "Department Store": "F1",
    "Discount Store": "F1",
    "Drug stores": "F1",
    "Finance,insurance,real estate services": "F1",
    "Furniture, house furnishings": "F1",
    "Gasoline and Service Station": "F1",
    "Gasoline Sale Only": "F1",
    "Gasoline Sales and Car Wash": "F1",
    "General med/hi rise off (= > 5 stories)": "F1",
    "Golf Courses (commercial)": "F1",
    "Hospital & Health Facilities": "F1",
    "Hotel with restaurant & other comm": "F1",
    "Hotel without restaurant & other comm": "F1",
    "Low Rise Office(< = 4 stories)": "F1",
    "Med/dental med/hi rise(= > 5 stories)": "F1",
    "Medical office (= > 5 stories)": "F1",
    "Medical/dental low rise (< = 4 stories)": "F1",
    "Mini-Warehouses (not in IP)": "F1",
    "Motel with restaurant & other comm": "F1",
    "Motel without restaurant & other comm": "F1",
    "Motor vehicle repair separately": "F1",
    "Motor vehicle sales (new and used)": "F1",
    "Neighborhood Center": "F1",
    "Nursing homes": "F1",
    "Office Park": "F1",
    "Other automotive,marine,aircraft and NEC": "F1",
    "Other consumer/business services NEC": "F1",
    "Other cultural & entertainment NEC": "F1",
    "Other food NEC (include fruit,meat,fish)": "F1",
    "Other office NEC": "F1",
    "Other repair services NEC": "F1",
    "Other Retail NEC(not in shopping center)": "F1",
    "Permanent Exhibition": "F1",
    "Personal services (laundry,photo,beauty)": "F1",
    "Promotional Center": "F1",
    "Regional Center": "F1",
    "Restaurant with alcohol": "F1",
    "Restaurant without alcohol": "F1",
    "Retirement homes & orphanages": "F1",
    "Service Station out of operation": "F1",
    "Specialty Center": "F1",
    "Super Regional Center": "F1",
    "Supermarket": "F1",
    "Supermarket plus general merchandise": "F1",
    "Town Center": "F1",
    "Veterinary hospitals": "F1",
    # F2 — industrial and manufacturing: manufacturing, wholesale/warehousing and storage,
    # research and testing, printing, contract construction yards, freight, quarrying.
    "Contract Construction (not in IP)": "F2",
    "Contract Construction (notinIP/in condo)": "F2",
    "Durable Manufacturing (not in Ind Park)": "F2",
    "Industrial conglomeration": "F2",
    "Motor frieight transportation": "F2",
    "Nondurable Manufacturing(in clust/notIP)": "F2",
    "Nondurable Manufacturing(not in IP)": "F2",
    "Other Industrial NEC": "F2",
    "Planned industrial park": "F2",
    "Printing & Publishing": "F2",
    "Research & Testing(not in IP/in condo)": "F2",
    "Research & Testing(not in IP/not in off)": "F2",
    "Sand & Gravel Quarrying": "F2",
    "Wholesale,warehousing & stg (not in IP)": "F2",
    "Whsle,wrhsing & stg (not in IP/in condo)": "F2",
}

_SQFT_PER_ACRE = 43560


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _key(desc: str | None) -> str:
    return _squeeze(desc).casefold()


_CATEGORY_BY_KEY = {_key(k): v for k, v in LAND_USE_CATEGORY.items()}


def state_category(luc_desc: str | None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for a Fairfax land use description; ``None`` when out of scope."""
    return _CATEGORY_BY_KEY.get(_key(luc_desc))


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: 0 or blank means the county has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _int_text(s: str | None) -> str:
    """``1234.0`` → ``1234`` (the Hub writes integer columns as floats now and then)."""
    v = _num(s)
    return str(int(v)) if v is not None and v == int(v) else (s or "").strip()


def _open_rows(path: Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        yield from csv.DictReader(f)


def _header(path: Path) -> frozenset[str]:
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        try:
            return frozenset(h.strip() for h in next(csv.reader(f)))
        except StopIteration:
            return frozenset()


def find_tables(paths: str | Path | Iterable[str | Path]) -> dict[str, Path]:
    """Map table role → file for a directory (searched recursively) or an explicit list of files.

    A table that appears more than once (two archived versions in one directory) raises, so a
    mixed-vintage build cannot happen by accident.
    """
    if isinstance(paths, (str, Path)):
        p = Path(paths)
        files = sorted(f for f in p.rglob("*") if f.is_file() and not f.name.startswith(".")) if p.is_dir() else [p]
    else:
        files = [Path(x) for x in paths]
    found: dict[str, Path] = {}
    for f in files:
        if f.suffix.lower() in (".jsonl", ".json", ".part"):
            continue
        header = _header(f)
        for role, signature in _TABLE_SIGNATURES.items():
            if signature <= header:
                if role in found:
                    raise ValueError(f"two files look like the {role} table: {found[role]} and {f}")
                found[role] = f
                break
    if "parcels" not in found:
        raise FileNotFoundError(f"no Parcels Data table (columns PARID, LUC_DESC) among {paths}")
    return found


def parcel_key(parid: str | None) -> str:
    """``PARID`` with its padding normalised to single spaces (``0072 01  0021A`` → ``0072 01 0021A``)."""
    return _squeeze(parid).upper()


def _situs(r: dict[str, str]) -> str | None:
    number = _int_text(r.get("ADRNO"))
    suffix = _squeeze(r.get("ADRADD"))
    if number and suffix:
        number = number + suffix if len(suffix) == 1 and suffix.isalpha() else f"{number} {suffix}"
    street = " ".join(x for x in (_squeeze(r.get("ADRPRE")), number, _squeeze(r.get("ADRDIR")),
                                  _squeeze(r.get("ADRSTR")), _squeeze(r.get("ADRSUF")), _squeeze(r.get("ADRSUF2"))) if x)
    if not _squeeze(r.get("ADRSTR")):
        return None
    city = _squeeze(r.get("CITYNAME"))
    rest = " ".join(x for x in (city, "VA", _squeeze(r.get("ZIP1"))) if x)
    return f"{street}, {rest}"


def read_roll(paths: str | Path | Iterable[str | Path], *,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope, in Parcels Data order.

    ``categories`` limits the parcels kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every parcel whose land use is mapped at all (the same set, since only
    B/F1/F2 are mapped) plus unmapped ones with ``state_category=None``, which needs memory for
    the whole roll.
    """
    tables = find_tables(paths)
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731

    kept: dict[str, dict[str, str]] = {}
    order: list[str] = []
    for r in _open_rows(tables["parcels"]):
        key = parcel_key(r.get("PARID"))
        if not key or key in kept:
            continue
        if keep(state_category(r.get("LUC_DESC"))):
            kept[key] = r
            order.append(key)

    legal: dict[str, dict[str, str]] = {}
    if "legal" in tables:
        for r in _open_rows(tables["legal"]):
            key = parcel_key(r.get("PARID"))
            if key in kept and key not in legal:
                legal[key] = r
    assessed: dict[str, dict[str, str]] = {}
    if "assessed" in tables:
        for r in _open_rows(tables["assessed"]):
            key = parcel_key(r.get("PARID"))
            if key in kept and key not in assessed:
                assessed[key] = r
    land_sf: dict[str, float] = {}
    if "land" in tables:
        for r in _open_rows(tables["land"]):
            key = parcel_key(r.get("PARID"))
            if key in kept:
                sf = _positive(r.get("SF"))
                if sf is None:
                    acres = _positive(r.get("ACRES"))
                    sf = round(acres * _SQFT_PER_ACRE, 2) if acres else None
                if sf:
                    land_sf[key] = land_sf.get(key, 0.0) + sf
    bldg_sf: dict[str, float] = {}
    year_built: dict[str, int] = {}
    if "commercial" in tables:
        for r in _open_rows(tables["commercial"]):
            key = parcel_key(r.get("PARID"))
            if key not in kept:
                continue
            area = _positive(r.get("BUSLA"))
            if area:
                bldg_sf[key] = bldg_sf.get(key, 0.0) + area
            y = _positive(r.get("YRBLT"))
            if y and (key not in year_built or int(y) < year_built[key]):
                year_built[key] = int(y)

    for key in order:
        r = kept[key]
        lg = legal.get(key, {})
        av = assessed.get(key, {})
        land = _positive(lg.get("SQFT"))
        if land is None:
            acres = _positive(lg.get("ACRES"))
            land = round(acres * _SQFT_PER_ACRE, 2) if acres else land_sf.get(key)
        total = _num(av.get("APRTOT"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=key,
            state_category=state_category(r.get("LUC_DESC")),
            account=key,
            situs_address=_situs(lg) if lg else None,
            owner_name=None,  # Fairfax County publishes no owner of record in these tables
            owner_mailing_address=None,
            owner_confidential=False,
            land_area_sf=land,
            improvement_area_sf=bldg_sf.get(key),
            year_built=year_built.get(key),
            market_value=total,
            appraised_value=total,
            tax_year=int(y) if (y := _num(av.get("TAXYR"))) else None,
            locator=f"Parcels Data PARID {key}",
            local_use_code=_squeeze(r.get("LUC_DESC")) or None,
        )


def build(snapshot_paths: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest one set of archived tables into a registry file (created if missing).

    Every table file is registered as a snapshot; the facts cite the Parcels Data table's
    document id, and each locator names the parcel. ``snapshot_paths`` is the collector's
    ``collected/va-fairfax-assessor`` directory (or a list of the five files).
    """
    tables = find_tables(snapshot_paths)
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snaps = {role: reg.add_snapshot(SOURCE.source_id, path, as_of, retrieved_at) for role, path in tables.items()}
        return reg.ingest_parcels(read_roll(list(tables.values())), snaps["parcels"], state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.va_fairfax", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/va-fairfax-assessor directory, or the five CSV files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="extract date, YYYY-MM-DD (the tables are refreshed daily)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from these files")
    args = ap.parse_args(argv)
    paths = args.snapshot[0] if len(args.snapshot) == 1 else args.snapshot
    stats = build(paths, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
