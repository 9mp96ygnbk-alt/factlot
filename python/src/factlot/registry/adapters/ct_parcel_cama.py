"""Connecticut: OPM's statewide "Connecticut CAMA and Parcel Layer" (CC0) → ``ParcelRecord``.

Source: ArcGIS Online item ``82a733423a244c43a9d4bf552954cea9`` "Connecticut CAMA and Parcel Layer" (owner ``ctgisoffice``, the
Connecticut Office of Policy and Management GIS Office; ``licenseInfo`` "CC0"), feature service
``Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0`` on services3.arcgis.com: the 2026 parcel collection joined to the towns' CAMA
reports, 169 towns, 1,320,686 records. The collector archives pages of a filtered query (``f=json``, ``returnGeometry=false``,
``OBJECTID`` order, at most 2,000 features per page) whose ``State_Use_Description`` contains one of a list of commercial words; the
strict mapping is made here. Layout confirmed against the live layer, 2026-11-03.

- ``CAMA_Link`` (``01080-206``: the town's number and the CAMA record) — unique per CAMA record, so it is the key (each condominium
  unit is its own record); ``Parcel_ID`` is the town's parcel number and is kept in the locator. ``Town_Name`` the town.
- ``FIPS`` — the town's 11-digit county-subdivision code (``09013526102``): state 09, the **former county** 013 (Tolland), subdivision
  52610. Connecticut's counties were replaced by planning regions for Census purposes in 2022, but the layer still carries the former
  county, which is used as the county FIPS here (``001`` Fairfield ... ``015`` Windham).
- ``Owner`` / ``Co_Owner``, ``Mailing_Address`` / ``Mailing_City`` / ``Mailing_State`` / ``Mailing_Zip`` — owner of record (blank
  where the town suppresses it); no confidentiality flag.
- ``Location_1`` (``281 GILEAD RD``), ``Property_City``, ``Property_Zip`` — the property address.
- ``Appraised_Land`` + ``Appraised_Building`` + ``Appraised_Outbuilding`` — the appraised (100% market) value; ``Assessed_Total`` is 70% of it
  and is not stored. ``Valuation_Year``, ``Land_Acres``, ``AYB`` (actual year built).
- ``State_Use`` / ``State_Use_Description`` — **each town's own use code and text**; the same code means different things in
  different towns. The mapping is therefore made on the description's words, never on the code: ``LABELS`` lists the descriptions (after
  ``normalize_description``) whose own words say commercial, industrial or apartment of five or more units. Land, vacant, exempt,
  municipal, residential-with-an-apartment, mixed-use and condominium-residential descriptions are not mapped, and a record
  counts only with a value for buildings (``Appraised_Building`` > 0).

Usage: ``python -m factlot.registry.adapters.ct_parcel_cama collected/ct-parcel-cama-layer registry.db --as-of 2026-11-03``
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
from .arcgis_pages import SQFT_PER_ACRE, features, pages, positive, squeeze, zip_text

STATE_FIPS = "09"
ACCOUNT_SYSTEM = "ct_cama_link"

SOURCE = Source(
    source_id="ct-parcel-cama-layer",
    publisher="Connecticut Office of Policy and Management, GIS Office (data collected from the towns through the Councils of Governments)",
    title="Connecticut CAMA and Parcel Layer (ArcGIS item 82a733423a244c43a9d4bf552954cea9)",
    url="https://www.arcgis.com/home/item.html?id=82a733423a244c43a9d4bf552954cea9",
    state_fips=STATE_FIPS,
    license="CC0 (the ArcGIS item's licenseInfo, set by the Connecticut OPM GIS Office)",
    ai_use="unknown",  # not addressed by the publisher; CC0 does not restrict it
    redistribution="permitted",
    attribution="Connecticut Office of Policy and Management, GIS Office, and the Connecticut towns",
    terms_reviewed="2026-11-03",
)

# Strips a town's model/vendor suffix from a description: "Commercial  MDL-94", "Store/Shop M-96", "Office C", "Industrial -96", "Comm Condo 06".
_SUFFIX = re.compile(r"(\s+m-?dl-?\d{2}|\s+md\d{2}|\s+m-?\d{2}|\s+-\d{2}|\s+\d{2}|\s+c)$")


def normalize_description(text: object) -> str:
    s = re.sub(r"\s+", " ", str(text if text is not None else "")).strip().lower()
    prev = None
    while prev != s:
        prev, s = s, _SUFFIX.sub("", s)
    return s


def _group(category: str, *labels: str) -> dict[str, str]:
    return {label: category for label in labels}


LABELS: dict[str, str] = {
    **_group(
        "F1",
        "commercial", "commercial improv", "commercial improved", "comm", "gen comm", "general commercial", "other commercial",
        "comm bldg", "comm garage", "com garage shop", "comm whse", "comm whs", "comm w/ ob", "commercial w/ ob",
        "comm condo", "commercial condo", "comm condo unit", "condo-comm", "condominium commercial",
        "store/shop", "store/shp", "store", "store - single tenant", "store - multi tenant", "shop", "service shop", "svc shop",
        "retail", "retail gen", "strip retail", "retail strip/plaza", "retail store", "small retail & service",
        "sm retail and service stores", "retail/service ctrs < 10000 sq ft", "discount stores", "disc/dept stores",
        "shopping mall", "shopngmall", "shopngctr", "shopping centers", "shopping ctr", "shoppingctr", "shopping centers / malls",
        "plaza w/anchr",
        "office bld", "office bldg", "office building", "office", "general office", "gen office", "general office bldg",
        "general office buildings", "office condo", "condo-office", "medical office", "med office", "medical office bldg",
        "medical office buildings", "prof office", "professional office",
        "bank bldg", "bank", "banks", "bank buildings",
        "auto repr", "auto repair", "automobile repair", "auto repair/body shop", "auto dealership", "auto dealer", "auto dlr",
        "auto v s&s", "auto s s&s", "auto sales and service",
        "gas mart", "gas/mart", "gasmart", "rtl gas st", "gas st srv", "gas st service", "gas st ser", "gas station",
        "gas/service stations", "conv store", "gas/convenience store",
        "restaurant", "restaurant/bar", "restaurant/club", "restaurant/clb", "restaurants/drinking estabs",
        "restaurant w/ lounge", "drive in restaurant", "hotel", "hotels", "motel", "motels", "self storage",
    ),
    **_group(
        "F2",
        "industrial", "industrial condo", "indus condo unit", "industrial condominium", "industrial whse", "indust",
        "manufacturing", "manufacturing bldg", "manufacturing building", "manufacturng", "manufacturing facilities", "manufac",
        "mfg warehouse facilities", "warehouse", "warehouses", "warehouse - storage", "warehouses for mfg",
        "warehouse-distribution", "storage, whse and dist", "job shop", "ind job shop", "ind job shop(s)", "ind garage/shop",
        "ind office", "industrial general",
    ),
    **_group(
        "B",
        "apartment", "apartments", "apartment bldg", "apt 5-12", "apt5 - 12", "apt5 - 12 r", "apt over 8", "apt over12", "apt - over 8",
        "apts 5-8", "apts 9+", "apts 5+", "apt 5-8", "apt 5 - 8", "apt 5-8 units", "apts 5-8 units", "apt 8+up", "apt 5 and over",
        "apt 9+", "apt ovr 8", "apartments low rise (5-10)", "apartments low rise (21+)", "apt high rse", "walk up apt", "apts comp",
        "comm apts", "commercial apts", "comm apartments", "apartments - com", "apartment 5+", "multi units 5-8", "5-8 apts",
    ),
}


def state_category(description: object) -> str | None:
    """FactLot category for a town's ``State_Use_Description``, or ``None`` when its words do not say commercial, industrial
    or apartment (five or more units)."""
    return LABELS.get(normalize_description(description))


def county_fips(fips: object) -> str | None:
    """The 3-digit former-county code from the 11-digit county-subdivision ``FIPS`` (``09013526102`` → ``013``)."""
    s = squeeze(fips)
    return s[2:5] if len(s) == 11 and s.isdigit() and s.startswith(STATE_FIPS) else None


def _mailing(a: dict) -> str | None:
    state_zip = " ".join(x for x in (squeeze(a.get("Mailing_State")), zip_text(squeeze(a.get("Mailing_Zip")))) if x)
    parts = [squeeze(a.get("Mailing_Address")), squeeze(a.get("Mailing_City")), state_zip]
    return ", ".join(p for p in parts if p) or None


def _situs(a: dict) -> str | None:
    street = squeeze(a.get("Location_1")) or squeeze(a.get("Location"))
    if not street:
        return None
    city = squeeze(a.get("Property_City")) or squeeze(a.get("Town_Name"))
    rest = " ".join(x for x in (city, "CT", zip_text(squeeze(a.get("Property_Zip")))) if x)
    return f"{street}, {rest}"


def _owner(a: dict) -> str | None:
    return squeeze(a.get("Owner")) or None


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[str] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope CAMA record of one archived page (a repeated ``CAMA_Link`` is skipped)."""
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in features(page):
        link = squeeze(a.get("CAMA_Link"))
        county = county_fips(a.get("FIPS"))
        if not link or county is None or link in seen:
            continue
        category = state_category(a.get("State_Use_Description"))
        if not keep(category):
            continue
        if not positive(a.get("Appraised_Building")):
            continue  # a description that says commercial but no building value: land, or a town that leaves the value blank
        seen.add(link)
        name = _owner(a)
        acres = positive(a.get("Land_Acres"))
        value = sum(positive(a.get(k)) or 0 for k in ("Appraised_Land", "Appraised_Building", "Appraised_Outbuilding"))
        year = positive(a.get("AYB"))
        val_year = positive(a.get("Valuation_Year"))
        yield ParcelRecord(
            county_fips=county,
            apn=link,
            state_category=category,
            account=link,
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=_mailing(a) if name else None,
            owner_confidential=False,  # no flag; towns blank the owners they suppress
            land_area_sf=round(acres * SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # the layer has living and effective area (residential models), not a commercial building area
            year_built=int(year) if year else None,
            market_value=value or None,
            appraised_value=None,
            tax_year=int(val_year) if val_year else None,
            locator=f"{Path(page).parent.name}/{Path(page).name} CAMA_Link {link} Parcel_ID {squeeze(a.get('Parcel_ID'))} "
                    f"({squeeze(a.get('Town_Name'))})",
            local_use_code=(squeeze(a.get("State_Use")) + " " + squeeze(a.get("State_Use_Description"))).strip() or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    seen: set[str] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing); each page is a snapshot (no retirement)."""
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ct_parcel_cama", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/ct-parcel-cama-layer directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
