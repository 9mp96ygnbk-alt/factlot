"""Vermont: VCGI statewide standardized parcels joined to the Grand List → ParcelRecord.

Source: "VT Data - Statewide Standardized Parcel Data - parcel polygons" (Vermont Center for Geographic
Information, ArcGIS Online item 09cf47e1cf82465e99164762a04f3ce6, feature service
FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1, layer 0): the active parcel
polygons of every Vermont municipality with the municipal Grand List joined on the School Property
Account Number (SPAN). The collector archives pages of a filtered query (f=json,
returnGeometry=false, OBJECTID order, 2,000 features per page) for CAT in C, CA, I and
PROPTYPE = PARCEL. Layout confirmed against the live layer, 2026-11-03.

- SPAN — School Property Account Number (042-013-10802: municipality, group, account). The key
  and the vt_span crosswalk. A parcel with several Grand List records (a land parcel and unlanded
  buildings) is drawn as stacked polygons with the same SPAN; the adapter keeps the first.
- TOWN — the municipality's name in capitals (BARTON); TNAME is the Grand List's own town
  name, which can name a village or district (Orleans ID) and is not used. The layer has no county
  column, so the county comes from TOWN_COUNTY, built from the publisher's own town boundary layer
  (VCGI Boundary_BNDHASH_poly_towns: TOWNNAME and CNTY, 256 municipalities).
- OWNER1 / OWNER2 — owner names from the Grand List; ADDRGL1, ADDRGL2, CITYGL,
  STGL, ZIPGL the mailing address. No confidentiality flag.
- CAT — the Grand List category (Vermont Department of Taxes): C commercial, CA commercial
  apartment, I industrial (the other codes are residential, seasonal, mobile home, farm, woodland,
  utilities, miscellaneous and other). Mapped here: C → F1, CA → B, I → F2.
- E911ADDR — the emergency-911 street address (preferred for the situs); LOCAPROP the Grand List
  location text; ACRESGL total acres; LAND_LV, IMPRV_LV, REAL_FLV the listed values of land,
  improvements and real property (full); GLYEAR the Grand List year, YEAR the GIS year.

Usage: python -m factlot.registry.adapters.vt_vcgi collected/vt-vcgi-parcels registry.db --as-of 2026-11-03
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
from .arcgis_pages import SQFT_PER_ACRE, features, pages, positive, squeeze, zip_text

STATE_FIPS = "50"
ACCOUNT_SYSTEM = "vt_span"

SOURCE = Source(
    source_id="vt-vcgi-parcels",
    publisher="Vermont Center for Geographic Information (VCGI), with Vermont municipalities and the Vermont Department of Taxes",
    title="VT Data - Statewide Standardized Parcel Data - parcel polygons (Grand List joined)",
    url="https://geodata.vermont.gov/",
    state_fips=STATE_FIPS,
    license="No licence stated. ArcGIS item licenseInfo and metadata give only a use limitation and warranty disclaimer "
            "('not a legal survey ... planning purposes only'); VCGI's Parcel Program describes the data as freely available",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # disclaimer only; free public download, no restriction stated
    attribution="Vermont Center for Geographic Information (VCGI); Vermont municipalities; Vermont Department of Taxes",
    terms_reviewed="2026-11-03",
)

CATEGORY = {"C": "F1", "CA": "B", "I": "F2"}


def _towns(county_fips: int, names: str) -> dict[str, str]:
    return {n.strip(): f"{county_fips % 1000:03d}" for n in names.split("|")}


# Town name (capitals, as in the parcel layer's TOWN) → 3-digit county FIPS (Vermont 50xxx). Source: VCGI town
# boundary layer, fields TOWNNAME and CNTY, read 2026-11-03.
TOWN_COUNTY: dict[str, str] = {
    # Addison County (50001)
    **_towns(50001, "ADDISON | BRIDPORT | BRISTOL | CORNWALL | FERRISBURGH | GOSHEN | GRANVILLE | HANCOCK | LEICESTER | LINCOLN | MIDDLEBURY | MONKTON | NEW HAVEN | ORWELL | PANTON | RIPTON | SALISBURY | SHOREHAM | STARKSBORO | VERGENNES | WALTHAM | WEYBRIDGE | WHITING"),
    # Bennington County (50003)
    **_towns(50003, "ARLINGTON | BENNINGTON | DORSET | GLASTENBURY | LANDGROVE | MANCHESTER | PERU | POWNAL | READSBORO | RUPERT | SANDGATE | SEARSBURG | SHAFTSBURY | STAMFORD | SUNDERLAND | WINHALL | WOODFORD"),
    # Caledonia County (50005)
    **_towns(50005, "BARNET | BURKE | DANVILLE | GROTON | HARDWICK | KIRBY | LYNDON | NEWARK | PEACHAM | RYEGATE | SAINT JOHNSBURY | SHEFFIELD | STANNARD | SUTTON | WALDEN | WATERFORD | WHEELOCK"),
    # Chittenden County (50007)
    **_towns(50007, "BOLTON | BUELS GORE | BURLINGTON | CHARLOTTE | COLCHESTER | ESSEX | ESSEX JUNCTION | HINESBURG | HUNTINGTON | JERICHO | MILTON | RICHMOND | SAINT GEORGE | SHELBURNE | SOUTH BURLINGTON | UNDERHILL | WESTFORD | WILLISTON | WINOOSKI"),
    # Essex County (50009)
    **_towns(50009, "AVERILL | AVERY'S GORE | BLOOMFIELD | BRIGHTON | BRUNSWICK | CANAAN | CONCORD | EAST HAVEN | FERDINAND | GRANBY | GUILDHALL | LEMINGTON | LEWIS | LUNENBURG | MAIDSTONE | NORTON | VICTORY | WARNER'S GRANT | WARREN'S GORE"),
    # Franklin County (50011)
    **_towns(50011, "BAKERSFIELD | BERKSHIRE | ENOSBURGH | FAIRFAX | FAIRFIELD | FLETCHER | FRANKLIN | GEORGIA | HIGHGATE | MONTGOMERY | RICHFORD | SAINT ALBANS CITY | SAINT ALBANS TOWN | SHELDON | SWANTON"),
    # Grand Isle County (50013)
    **_towns(50013, "ALBURGH | GRAND ISLE | ISLE LA MOTTE | NORTH HERO | SOUTH HERO"),
    # Lamoille County (50015)
    **_towns(50015, "BELVIDERE | CAMBRIDGE | EDEN | ELMORE | HYDE PARK | JOHNSON | MORRISTOWN | STOWE | WATERVILLE | WOLCOTT"),
    # Orange County (50017)
    **_towns(50017, "BRADFORD | BRAINTREE | BROOKFIELD | CHELSEA | CORINTH | FAIRLEE | NEWBURY | ORANGE | RANDOLPH | STRAFFORD | THETFORD | TOPSHAM | TUNBRIDGE | VERSHIRE | WASHINGTON | WEST FAIRLEE | WILLIAMSTOWN"),
    # Orleans County (50019)
    **_towns(50019, "ALBANY | BARTON | BROWNINGTON | CHARLESTON | COVENTRY | CRAFTSBURY | DERBY | GLOVER | GREENSBORO | HOLLAND | IRASBURG | JAY | LOWELL | MORGAN | NEWPORT CITY | NEWPORT TOWN | TROY | WESTFIELD | WESTMORE"),
    # Rutland County (50021)
    **_towns(50021, "BENSON | BRANDON | CASTLETON | CHITTENDEN | CLARENDON | DANBY | FAIR HAVEN | HUBBARDTON | IRA | KILLINGTON | MENDON | MIDDLETOWN SPRINGS | MOUNT HOLLY | MOUNT TABOR | PAWLET | PITTSFIELD | PITTSFORD | POULTNEY | PROCTOR | RUTLAND CITY | RUTLAND TOWN | SHREWSBURY | SUDBURY | TINMOUTH | WALLINGFORD | WELLS | WEST HAVEN | WEST RUTLAND"),
    # Washington County (50023)
    **_towns(50023, "BARRE CITY | BARRE TOWN | BERLIN | CABOT | CALAIS | DUXBURY | EAST MONTPELIER | FAYSTON | MARSHFIELD | MIDDLESEX | MONTPELIER | MORETOWN | NORTHFIELD | PLAINFIELD | ROXBURY | WAITSFIELD | WARREN | WATERBURY | WOODBURY | WORCESTER"),
    # Windham County (50025)
    **_towns(50025, "ATHENS | BRATTLEBORO | BROOKLINE | DOVER | DUMMERSTON | GRAFTON | GUILFORD | HALIFAX | JAMAICA | LONDONDERRY | MARLBORO | NEWFANE | PUTNEY | ROCKINGHAM | SOMERSET | STRATTON | TOWNSHEND | VERNON | WARDSBORO | WESTMINSTER | WHITINGHAM | WILMINGTON | WINDHAM"),
    # Windsor County (50027)
    **_towns(50027, "ANDOVER | BALTIMORE | BARNARD | BETHEL | BRIDGEWATER | CAVENDISH | CHESTER | HARTFORD | HARTLAND | LUDLOW | NORWICH | PLYMOUTH | POMFRET | READING | ROCHESTER | ROYALTON | SHARON | SPRINGFIELD | STOCKBRIDGE | WEATHERSFIELD | WEST WINDSOR | WESTON | WINDSOR | WOODSTOCK"),
}


def state_category(cat: object) -> str | None:
    """FactLot category for a Vermont Grand List category: C → F1, CA → B, I → F2; everything else None."""
    return CATEGORY.get(squeeze(cat).upper())


def county_for(town: object) -> str | None:
    return TOWN_COUNTY.get(squeeze(town).upper())


def _situs(a: dict) -> str | None:
    street = squeeze(a.get("E911ADDR")) or squeeze(a.get("LOCAPROP"))
    town = squeeze(a.get("TOWN")).title()
    if not street:
        return None
    return f"{street}, {town}, VT" if town else f"{street}, VT"


def _mailing(a: dict) -> str | None:
    state_zip = " ".join(x for x in (squeeze(a.get("STGL")), zip_text(squeeze(a.get("ZIPGL")))) if x)
    parts = [squeeze(a.get("ADDRGL1")), squeeze(a.get("ADDRGL2")), squeeze(a.get("CITYGL")), state_zip]
    return ", ".join(p for p in parts if p) or None


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[str] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ParcelRecord per in-scope SPAN of one archived page (later stacked polygons are skipped)."""
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in features(page):
        span = squeeze(a.get("SPAN"))
        if not span or span in seen or squeeze(a.get("PROPTYPE")).upper() not in ("", "PARCEL"):
            continue
        category = state_category(a.get("CAT"))
        county = county_for(a.get("TOWN"))
        if not keep(category) or county is None:
            continue
        seen.add(span)
        name = squeeze(a.get("OWNER1")) or None
        acres = positive(a.get("ACRESGL"))
        yield ParcelRecord(
            county_fips=county,
            apn=span,
            state_category=category,
            account=span,
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=_mailing(a) if name else None,
            owner_confidential=False,  # the layer carries no confidentiality flag
            land_area_sf=round(acres * SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,
            year_built=None,
            market_value=None,
            appraised_value=positive(a.get("REAL_FLV")),  # Grand List "listed real value (full)"
            tax_year=int(a["GLYEAR"]) if positive(a.get("GLYEAR")) else None,
            locator=f"{Path(page).parent.name}/{Path(page).name} SPAN {span}",
            local_use_code=squeeze(a.get("CAT")) or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    """Yield the in-scope parcels of every page under path, each SPAN once."""
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.vt_vcgi", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/vt-vcgi-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved (the layer updates weekly), YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
