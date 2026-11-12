"""Utah Geospatial Resource Center (UGRC), State Geographic Information Database (SGID): county
"land information record" (LIR) parcels → ``ParcelRecord``. One source, one adapter, every Utah county.

Layout (confirmed 2026-11-03 against the ArcGIS Hub CSV export of the Salt Lake County LIR layer and
the feature-service field lists of the Salt Lake and Utah County layers): UGRC republishes each
county assessor's tax-year parcel file as the layer ``Parcels_<County>_LIR`` (ArcGIS Online items
owned by ``UtahAGRC``, listed at https://gis.utah.gov/products/sgid/cadastre/parcels/). The Hub CSV
export (``https://opendata.gis.utah.gov/api/download/v1/items/<item>/csv?layers=0``) is a UTF-8 (BOM)
quoted file with one row per tax parcel or per building (see "Several rows for one parcel" below) and the
**field aliases** as its header:

    OBJECTID, County Name, County ID, County Assessor Info URL, County Recorder Info URL, Disclaimer URL,
    Current As Of, Parcel ID, Serial Number, Parcel Address, Parcel City, Tax Exempt Type, Tax District,
    Total Market Value, Land Market Value, Parcel Acres, Property Class, Primary Residence,
    Number of Housing Units, Subdivision Name, Square Footage, Square Footage Note, Number of Floors,
    Number of Floors Note, Year Built, Effective Year Built, Construction Material, Property Type,
    Shape__Area, Shape__Length

The feature service uses the **field names** (``PARCEL_ID``, ``TOTAL_MKT_VALUE``, ``PROP_CLASS`` …);
both spellings are read. The Utah County layer has no ``Property Type`` column. The LIR schema has
**no owner field**, so every record has ``owner_name=None`` and nothing here is "withheld": the
publisher simply does not carry owners (they are on each county's own web search).

``Parcel ID`` is the county's own id; the APN escapes its punctuation (``apn_for``), because Sevier and Kane
ids differ by punctuation alone, and the account is ``<county FIPS>:<Parcel ID>``.

``County ID`` is the alphabetical county number (Beaver 1 … Weber 29); the county FIPS code is
``49`` + ``2 * id - 1`` (Salt Lake 18 → 035, Utah 25 → 049).

Category mapping (``Property Class`` is each county's own class, standardized by the county's
assessor; the publisher's schema only says "Residential, Commercial, Industrial, Mixed, Agricultural,
Vacant, Open Space, Other"): ``Commercial``, ``Commercial - Office Space``, ``Commercial - Retail`` →
``F1``; ``Commercial - Industrial`` and ``Industrial`` → ``F2``; ``Commercial - Apartment & Condo`` →
``B`` (Salt Lake County's multi-housing class; the label also covers some commercial condominiums, so the
publisher's class is kept verbatim in ``local_use_code``). Utah County has only ``Commercial`` and
``Commercial - Apartment & Condo``; its ``Commercial`` includes industrial uses and maps to ``F1``.
Residential, Vacant, Greenbelt, Recreational, Undeveloped, Unknown and every ``Tax Exempt*`` class are
out of scope, as are commercial classes whose ``Tax Exempt Type`` says government or non-profit.

Counties (statewide extension, 2026-11-03): UGRC publishes an LIR layer for all 29 counties. The other
counties' layers use the same vocabulary (Iron, Uintah and Davis use Salt Lake's ``Commercial - …``
subclasses; the rest use plain ``Commercial``), so the same table maps them. Three counties yield no
commercial record: Emery and San Juan carry no class at all (every row ``Unknown`` or blank), and Carbon
uses its own vocabulary (``Single Family``, ``Multi-Family``, ``Apartments``, ``Subsidized Housing``,
``Vacant Commercial``, ``Land``, ``DEFAULT``) with no published definitions, and its ``Commercial`` holds 24%
of the county's rows. Carbon's classes are therefore not mapped (``UNMAPPED_COUNTIES``): its rows are read
but every one is out of scope, and the config does not list its file.

Several rows for one parcel (2026-11-12). The standard's goal is one row per tax notice, but most counties
write one row per building, and some repeat a row for each polygon part of one tax parcel; the rows of one
parcel need not be next to each other in the file. ``read_roll`` therefore groups the rows of a file by
(county FIPS, ``Parcel ID``) and yields one record per parcel, rows taken in ``OBJECTID`` order (file order
when there is none), so the result does not depend on row order:

- building area: the sum of ``Square Footage`` (the publisher's "Square footage of primary bldg(s)") over the
  parcel's distinct buildings, a building being one combination of the ``_BUILDING_KEYS`` fields; rows that
  repeat a combination (a duplicate row or another polygon part) are counted once;
- year built: the earliest ``Year Built`` of any row;
- market value: ``Total Market Value`` is the publisher's "Total market value of parcel's land, structures,
  and other improvements", so it is taken once, from whichever rows carry one; when rows carry different
  positive values (Rich County writes one per building row with no land value) no market value is written,
  since no row is the parcel's total and adding them up is not what the field means;
- category: the in-scope categories of the parcel's rows, the first in ``CATEGORY_PRECEDENCE`` (``F2``, then
  ``F1``, then ``B``); a parcel is in scope when any row is. ``local_use_code`` keeps every distinct row class
  in row order, joined by ``CLASS_SEPARATOR``, so the choice can be audited;
- situs address and land area (``Parcel Acres``): from the first row (in row order) that has one.

A parcel with one row yields exactly what that row yielded before the grouping.

Usage: ``python -m factlot.registry.adapters.ut_ugrc <county>.csv registry.db --as-of 2026-09-29``
(one file per county; nothing is retired unless ``--full-roll`` is given, which is right only for a file
that holds every county loaded before).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "49"
ACCOUNT_SYSTEM = "ugrc_lir"

SOURCE = Source(
    source_id="ut-ugrc-lir",
    publisher="Utah Geospatial Resource Center (UGRC), Utah Department of Technology Services",
    title="Utah Parcels, land information record (LIR) layers of the State Geographic Information Database",
    url="https://gis.utah.gov/products/sgid/cadastre/parcels/",
    state_fips=STATE_FIPS,
    license="Creative Commons Attribution 4.0 International (ArcGIS item license of the LIR layers); the UGRC product page states 'There are no constraints or warranties with regard to the use of this dataset'",
    ai_use="unknown",  # not addressed by the publisher; CC BY 4.0 does not restrict it
    redistribution="attribution_required",  # CC BY 4.0; UGRC asks users to attribute 'State of Utah, SGID'
    attribution="State of Utah, SGID (Utah Geospatial Resource Center) and the county assessors that supply the data",
    terms_reviewed="2026-11-03",
)

_CATEGORY = {
    "commercial": "F1",
    "commercial - office space": "F1",
    "commercial - retail": "F1",
    "commercial - industrial": "F2",
    "industrial": "F2",
    "commercial - apartment & condo": "B",
}

# County FIPS codes whose class vocabulary is not the LIR one and has no published definitions: no class of
# theirs is mapped, so none of their rows is in scope. 007 Carbon: see the module docstring.
UNMAPPED_COUNTIES = frozenset({"007"})

# Tax Exempt Type values that mean the owner is a government or a non-profit (not a taxable commercial owner).
_EXEMPT_OWNERS = ("local government", "state government", "federal government", "non profit")

# Header spellings (alias from the Hub CSV, field name from the feature service) → one internal key.
_KEYS = {
    "countyname": "county_name", "countyid": "county_id", "currentasof": "as_of",
    "parcelid": "parcel_id", "serialnum": "serial", "serialnumber": "serial",
    "parceladd": "address", "parceladdress": "address", "parcelcity": "city",
    "taxexempttype": "exempt", "totalmktvalue": "total_value", "totalmarketvalue": "total_value",
    "landmktvalue": "land_value", "landmarketvalue": "land_value", "parcelacres": "acres",
    "propclass": "prop_class", "propertyclass": "prop_class", "proptype": "prop_type",
    "propertytype": "prop_type", "bldgsqft": "sqft", "squarefootage": "sqft",
    "builtyr": "year_built", "yearbuilt": "year_built", "housecnt": "units", "numberofhousingunits": "units",
    "effbuiltyr": "effective_year", "effectiveyearbuilt": "effective_year", "floorscnt": "floors",
    "numberoffloors": "floors", "constmaterial": "material", "constructionmaterial": "material",
}

# The fields that describe a row's building. Rows of one parcel that agree on all of them describe one building
# (a repeated row, or another polygon part of the same tax parcel), so its area is counted once.
_BUILDING_KEYS = ("sqft", "year_built", "effective_year", "floors", "material")

# When a parcel's in-scope rows map to different categories, the first of these that one of them maps to wins.
CATEGORY_PRECEDENCE = ("F2", "F1", "B")

# Separator between a parcel's distinct row classes in ``local_use_code`` when its rows carry more than one.
CLASS_SEPARATOR = "; "

SQFT_PER_ACRE = 43560.0


def _key(header: str) -> str:
    h = re.sub(r"[^a-z0-9]+", "", header.strip().lower())
    return _KEYS.get(h, h)


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Values, areas and years: 0 and blank both mean 'no figure'."""
    v = _num(s)
    return v if v and v > 0 else None


def county_fips(county_id: str | None) -> str | None:
    """Three-digit county FIPS from UGRC's alphabetical county number (1–29); ``None`` if not a Utah county."""
    try:
        n = int((county_id or "").strip())
    except ValueError:
        return None
    return f"{2 * n - 1:03d}" if 1 <= n <= 29 else None


def category(prop_class: str | None, exempt_type: str | None = None, county: str | None = None) -> str | None:
    """FactLot category for a county class; ``None`` when out of the commercial scope.

    ``county`` (three-digit FIPS) turns every class of a county in ``UNMAPPED_COUNTIES`` into ``None``.
    """
    if county in UNMAPPED_COUNTIES:
        return None
    cls = " ".join((prop_class or "").lower().split())
    cat = _CATEGORY.get(cls)
    if cat and (exempt_type or "").strip().lower().startswith(_EXEMPT_OWNERS):
        return None
    return cat


def apn_for(parcel_id: str) -> str:
    """Registry APN for a county ``Parcel ID``: lower case, every character that is not a letter or digit
    written ``x<hex>x`` and a literal ``x`` written ``xx``.

    The registry reduces an APN to letters and digits, and some counties' ids differ by punctuation alone
    (Sevier ``1-2-23`` and ``1-22-3``, Kane ``K-3-11-ANNEX`` and ``K-3-1-1-ANNEX``), which would merge two
    parcels. Ids made only of digits (Salt Lake, Utah, Davis, Weber, Box Elder, Uintah, Beaver) are unchanged.
    """
    out = []
    for ch in parcel_id.strip().lower():
        if ch == "x":
            out.append("xx")
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        else:
            out.append(f"x{ord(ch):x}x")
    return "".join(out)


def _situs(r: dict[str, str]) -> str | None:
    street = " ".join((r.get("address") or "").split())
    if not street:
        return None
    city = " ".join((r.get("city") or "").split()).upper()
    return f"{street.upper()}, {city} UT" if city else f"{street.upper()}, UT"


_KEPT_KEYS = ("prop_class", "exempt", "address", "city", "acres", "total_value") + _BUILDING_KEYS


def _row_order(r: dict[str, str], index: int) -> tuple[int, float, int]:
    """Sort key of a row within its parcel: ``OBJECTID`` ascending, rows without one after, in file order."""
    oid = _num(r.get("objectid"))
    return (0, oid, index) if oid is not None else (1, 0.0, index)


def _parcel_record(fips: str, parcel: str, rows: list[dict[str, str]]) -> ParcelRecord:
    """One record from the rows of one parcel, already in row order (see "Several rows for one parcel")."""
    classes = [" ".join((r.get("prop_class") or "").split()) for r in rows]
    cats = {category(c, r.get("exempt"), fips) for c, r in zip(classes, rows)}
    acres = next((a for r in rows if (a := _positive(r.get("acres")))), None)
    years = [y for r in rows if (y := _positive(r.get("year_built")))]
    values = {v for r in rows if (v := _positive(r.get("total_value")))}
    area, buildings = 0.0, set()
    for r in rows:
        building = tuple(" ".join((r.get(k) or "").split()) for k in _BUILDING_KEYS)
        if building not in buildings:
            buildings.add(building)
            area += _positive(r.get("sqft")) or 0.0
    return ParcelRecord(
        county_fips=fips,
        apn=apn_for(parcel),
        state_category=next((c for c in CATEGORY_PRECEDENCE if c in cats), None),
        account=f"{fips}:{parcel}",
        situs_address=next((s for r in rows if (s := _situs(r))), None),
        owner_name=None,  # the LIR schema carries no owner
        land_area_sf=round(acres * SQFT_PER_ACRE) if acres else None,
        improvement_area_sf=area or None,
        year_built=int(min(years)) if years else None,
        market_value=next(iter(values)) if len(values) == 1 else None,
        tax_year=None,
        locator=f"county {fips} Parcel ID {parcel}",
        local_use_code=CLASS_SEPARATOR.join(dict.fromkeys(c for c in classes if c)) or None,
    )


def read_roll(path: str | Path) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel of a county LIR export, in the order of each parcel's first row.

    The rows of a parcel are grouped by (county FIPS, ``Parcel ID``) over the whole file and collapsed as the
    module docstring says ("Several rows for one parcel"). Every parcel is yielded; ``state_category`` is
    ``None`` for parcels outside the commercial scope, which the registry counts as skipped. Rows without a
    parcel id or a Utah county id are dropped.
    """
    parcels: dict[tuple[str, str], list[tuple[tuple[int, float, int], dict[str, str]]]] = {}
    for i, r in enumerate(_rows(path)):
        parcel = (r.get("parcel_id") or "").strip()
        fips = county_fips(r.get("county_id"))
        if not parcel or not fips:
            continue
        kept = {k: r[k] for k in _KEPT_KEYS if r.get(k)}
        parcels.setdefault((fips, parcel), []).append((_row_order(r, i), kept))
    for (fips, parcel), rows in parcels.items():
        rows.sort(key=lambda x: x[0])
        yield _parcel_record(fips, parcel, [r for _, r in rows])


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived county export into a registry file (created if missing).

    The source is one file per county, so ``full_roll`` is off by default: retiring is per source, and a
    county file must not retire another county's parcels.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ut_ugrc", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to a county LIR CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="the layer's 'Current As Of' date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true",
                    help="retire parcels missing from this file (only for a file that holds every county loaded before)")
    ap.add_argument("--partial", action="store_true",
                    help="accepted for older commands; county files are always loaded without retiring (the default)")
    args = ap.parse_args(argv)
    if args.full_roll and args.partial:
        ap.error("--full-roll and --partial contradict each other")
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
