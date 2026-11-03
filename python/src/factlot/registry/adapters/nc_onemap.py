"""North Carolina counties: NC OneMap statewide parcel layer, per-county slices → ``ParcelRecord``.

Source: the NC OneMap layer "North Carolina Parcels (Polygons)" (NC Center for Geographic
Information and Analysis; ArcGIS item 1de3d7d828ce4813b838ddf055b40317, FeatureServer layer 1 on
services.nconemap.gov), which aggregates the 100 counties' parcel files into one standard schema:
owner of record and mailing address, situs, acreage, assessed value, and a use code. The use code
(``parusecode``, with ``parusedesc`` its text) is the *county's own*: its values, meanings and even its
shape differ per county, so this module holds one mapping table per county, each taken from that
county's published code definitions (see ``COUNTIES`` and ``docs/registry/sources/nc-onemap-parcels.md``).
A county without published definitions (or whose layer has no use code) has no entry and yields nothing.

The adapter reads a CSV of the layer (the Hub download of a filtered request, or the same rows from the
query service) for one county. Layout (Wake export of 2026-11-03, 70 lower-case columns, one row per
parcel polygon; the query service returns the same field names):

- ``parno`` — the county's parcel number (Wake's 10-digit PIN, Buncombe's 15-digit PIN, Gaston's
  ``3556-22-1021``, Iredell's ``4636244604.000``); ``altparno`` the county's alternate number (Wake's
  7-digit real estate ID, Gaston's and Iredell's account numbers, Buncombe's equals ``parno``);
  ``nparno`` is ``37<county>_<parno>``; ``cntyfips`` the 3-digit county code.
- ``ownname`` — owner of record, all owners in one string; ``mailadd``, ``munit``, ``mcity``, ``mstate``,
  ``mzip`` — the mailing address (Wake puts city, state and ZIP together in ``mcity``). ``owntype`` is
  blank everywhere sampled and no county's rows carry a confidentiality marker.
- ``siteadd`` / ``sunit`` / ``scity`` — situs street, unit and city (``szip`` is blank in these counties).
- ``parusecode`` / ``parusedesc`` — the county's use code and its text; ``parusecd2`` / ``parusedsc2`` — a
  second code (Wake's main-building type and use).
- ``parval`` / ``landval`` / ``improvval`` — total, land and improvement value (``parvaltype`` is
  ``Assessed``); ``gisacres`` — polygon acres; ``recareano`` — recorded acres (preferred when positive);
  ``structyear`` — year of the structure (Wake and Gaston only).

Category mapping (FactLot scope): ``B`` multifamily, ``F1`` commercial, ``F2`` industrial, only for the
codes a county's own table places in that class. Everything else yields no record. ``local_use_code``
keeps the county's code (Wake: ``<parusecode>/<parusecd2>``, ``COM/34``).

Usage: ``python -m factlot.registry.adapters.nc_onemap <county csv> registry.db --county 021 --as-of 2026-05-07``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "37"
LAYER_ITEM = "https://www.nconemap.gov/datasets/nconemap::north-carolina-parcels-polygons"
HUB_DOWNLOAD = "https://www.nconemap.gov/api/download/v1/items/1de3d7d828ce4813b838ddf055b40317/csv?layers=1&where="
_LICENSE = (
    "NC OneMap free and unrestricted use policy (https://www.nconemap.gov/pages/terms): content is shared "
    "at no charge, written release agreements are not required; public records under N.C. Gen. Stat. ch. 132"
)
_SQFT_PER_ACRE = 43560
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER", "N/A", "NONE"})


def _codes(category: str, text: str) -> dict[str, str]:
    return {c: category for c in text.split()}


@dataclass(frozen=True)
class CountyMap:
    """How one county's use codes map to FactLot categories, and where the definitions came from."""

    fips: str  # 3-digit county FIPS, as in the layer's ``cntyfips``
    name: str
    steward: str  # the county office the layer names as source agent (``sourceagnt``)
    source_id: str
    account_system: str
    categories: dict[str, str]  # county code (upper case, as in ``parusecode``) → "B" / "F1" / "F2"
    definitions_title: str
    definitions_url: str
    definitions_read: str  # date the definitions were read
    # (code, parusecd2) pairs that turn a class-B parcel into out of scope (Wake: one- to four-family houses)
    b_not_when_cd2: frozenset[str] = frozenset()
    local_code_with_cd2: bool = False  # Wake: ``local_use_code`` is ``<parusecode>/<parusecd2>``
    # The county's code has no vacant-land split (Iredell's land use codes classify the land), so a parcel
    # counts only when it carries a value for improvements.
    require_improvement: bool = False
    title: str = ""
    attribution: str = ""

    def where(self) -> str:
        """ArcGIS ``where`` clause that selects this county's in-scope parcels (for the query service or Hub export)."""
        in_list = ",".join(f"'{c}'" for c in sorted(self.categories))
        improved = " AND improvval>0" if self.require_improvement else ""
        return f"cntyfips='{self.fips}' AND parusecode IN ({in_list}){improved}"

    def hub_url(self) -> str:
        return HUB_DOWNLOAD + quote(self.where(), safe="")


# --- Wake (183): land class letters, named by NC OneMap with three letters -------------------------------
# COM = C commercial, IND = D industrial, APT = G apartment (Wake's CodeDescriptions.pdf, "LAND CLASS").
_WAKE = CountyMap(
    fips="183", name="Wake", steward="Wake County Assessor", source_id="nc-wake-parcels", account_system="wake_reid",
    categories={"COM": "F1", "IND": "F2", "APT": "B"},
    definitions_title="Wake County Tax Administration, CodeDescriptions.pdf (land class; type and use)",
    definitions_url="https://s3.us-west-1.amazonaws.com/wakegov.com.if-us-west-1/s3fs-public/documents/2020-10/CodeDescriptions.pdf",
    definitions_read="2026-11-03",
    b_not_when_cd2=frozenset({"01", "02", "03", "04"}), local_code_with_cd2=True,
    title="North Carolina Parcels (Polygons), Wake County slice (Hub CSV export)",
    attribution="NC OneMap, NC Department of Information Technology, Center for Geographic Information and Analysis; "
                "data steward Wake County",
)

# --- Buncombe (021): the County's "Parcel Class Code" table; the hundreds block is the class ---------------
# 400 COMM block (4xx), 700 INDUSTRIAL block (7xx), 411 APT. Left out of the 4xx block: 416 manufactured
# home parks, 417 camps/RV parks, 438 commercial parking lots (site only), 442 (the table says "SECT. 42
# APARTMENT", the layer's own text says "OTHER COMMERCIAL"; unresolved, so not mapped).
_BUNCOMBE = CountyMap(
    fips="021", name="Buncombe", steward="Buncombe County Assessor", source_id="nc-onemap-buncombe",
    account_system="buncombe_pin",
    categories={
        **_codes("B", "411"),
        **_codes("F1", "400 401 405 414 415 418 420 421 422 423 424 425 426 430 431 432 433 434 435 437 440 441 "
                       "444 445 446 447 448 450 454 455 456 458 460 461 462 463 464 465 466 467 468 470 471 472 "
                       "473 475 476 477 478 479 480 481 483 486 490 491 492 493 494 495"),
        **_codes("F2", "700 701 702 704 706 708 710"),
    },
    definitions_title="Buncombe County GIS, Parcel Class Code table",
    definitions_url="https://gis.buncombenc.gov/buncomap/classcode.htm",
    definitions_read="2026-11-03",
    title="North Carolina Parcels (Polygons), Buncombe County slice",
    attribution="NC OneMap, NC Department of Information Technology, Center for Geographic Information and Analysis; "
                "data steward Buncombe County",
)

# --- Gaston (071): "Property Use Codes", Schedule of Values 2023, chapter 4 (Data Inventory) --------------
# Commercial group 2xxx → F1, Industrial group 3xxx → F2, 2100 Apartment Complex/Multi-family → B.
# Left out of the commercial group: 2000 Commercial Land, 2001 Cell Tower Site, 2002 Parking Lot, 2003
# Billboard Site (sites, no building), 2004 Mobile Home Park, 2005 Golf Course, 2007 House on Commercial
# Land, 2240 Live/Work and 2250 Section 42 Housing (the definition does not say commercial use or
# multifamily). Left out of the industrial group: 3000 Industrial Land, 3001 Mining/Minerals, 3002 to 3007
# (lift station, private utilities, water/sewer treatment, solar farm, recycling, landfill).
_GASTON = CountyMap(
    fips="071", name="Gaston", steward="Gaston County Assessor", source_id="nc-onemap-gaston",
    account_system="gaston_altparno",
    categories={
        **_codes("B", "2100"),
        **_codes("F1", "2006 2010 2020 2030 2040 2050 2055 2060 2070 2080 2090 2110 2120 2130 2140 2150 2160 2170 "
                       "2180 2190 2200 2210 2220 2230 2260 2280"),
        **_codes("F2", "3010 3020 3030 3040 3050 3060"),
    },
    definitions_title="Gaston County 2023 Schedule of Values, Chapter 4 Data Inventory, Property Use Codes (pp. 66-67)",
    definitions_url="https://www.gastongov.com/DocumentCenter/View/2866/Chapter-4-Data-Inventory-PDF",
    definitions_read="2026-11-03",
    title="North Carolina Parcels (Polygons), Gaston County slice",
    attribution="NC OneMap, NC Department of Information Technology, Center for Geographic Information and Analysis; "
                "data steward Gaston County",
)

# --- Iredell (097): "Land Use Codes" of the 2019 Reappraisal Uniform Schedule of Values (chapter 4) -------
# The table is grouped under the headings MULTI-FAMILY (05xx), OFFICE (04xx), INDUSTRIAL (06xx) and
# COMMERCIAL (07xx). Left out: 0501 MULTI FAMILY COMMON AREA, 0562 DUPLEX/TRIPLEX (fewer than five units),
# 0728 PARKING and 0780 MARINA LAND (sites), and every code outside those four groups. The table classifies
# the land and has no vacant-land code, so a parcel counts only with a value for improvements (improvval > 0).
_IREDELL = CountyMap(
    fips="097", name="Iredell", steward="Iredell County Assessor", source_id="nc-onemap-iredell",
    account_system="iredell_altparno",
    categories={
        **_codes("B", "0500 0502 0503 0505 0506 0507 0508 0509 0510 0511 0513 0514 0515 0516 0560 0561 0563"),
        **_codes("F1", "0400 0418 0419 0420 0424 0431 0700 0701 0711 0712 0713 0714 0715 0716 0721 0722 0723 "
                       "0725 0726 0727 0732 0733 0734 0735 0736 0737 0738 0739 0765"),
        **_codes("F2", "0600 0601 0602 0628 0630 0641 0642 0643 0644 0645 0646 0647 0648 0649 0651 0652 0653 0657"),
    },
    require_improvement=True,
    definitions_title="Iredell County 2019 Reappraisal, Uniform Schedule of Values, Standards, and Rules, "
                      "Market Value Schedule, Land Appraisal Procedures (Land Use Codes, pp. 4-29 to 4-33)",
    definitions_url="https://iredellcountync.gov/DocumentCenter/View/11850/2019-Chapter-04-Land-Appraisal-Procedures",
    definitions_read="2026-11-03",
    title="North Carolina Parcels (Polygons), Iredell County slice",
    attribution="NC OneMap, NC Department of Information Technology, Center for Geographic Information and Analysis; "
                "data steward Iredell County",
)

COUNTIES: dict[str, CountyMap] = {c.fips: c for c in (_WAKE, _BUNCOMBE, _GASTON, _IREDELL)}


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def county_map(county_fips: str) -> CountyMap:
    """The mapping table for a 3-digit (or 5-digit ``37xxx``) county code; ``KeyError`` when the county has none."""
    key = county_fips[-3:] if len(county_fips) == 5 and county_fips.startswith(STATE_FIPS) else county_fips
    try:
        return COUNTIES[key]
    except KeyError:
        raise KeyError(f"no NC OneMap use-code mapping for county {county_fips!r} "
                       f"(mapped: {', '.join(sorted(COUNTIES))})") from None


def source(county_fips: str) -> Source:
    c = county_map(county_fips)
    return Source(
        source_id=c.source_id,
        publisher=f"NC OneMap (NC Center for Geographic Information and Analysis), from the {c.steward}",
        title=c.title,
        url=LAYER_ITEM,
        state_fips=STATE_FIPS,
        county_fips=c.fips,
        license=_LICENSE,
        ai_use="unknown",  # the publisher does not address AI use
        redistribution="permitted",
        attribution=c.attribution,
        terms_reviewed="2026-11-03",
    )


def state_category(county_fips: str, parusecode: str | None, parusecd2: str | None = None) -> str | None:
    """FactLot category for a county's use code (and second code), or ``None`` when out of scope.

    ``("183", "COM", "34")`` → ``F1``; ``("183", "APT", "01")`` → ``None`` (a one-family house on an
    apartment-class parcel); ``("021", "411")`` → ``B``; ``("071", "3020")`` → ``F2``; a county without
    a table raises ``KeyError``.
    """
    c = county_map(county_fips)
    category = c.categories.get(_squeeze(parusecode).upper())
    if category == "B" and _squeeze(parusecd2) in c.b_not_when_cd2:
        return None
    return category


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, values and years: 0 or blank means the county has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def _mailing_address(r: dict[str, str]) -> str | None:
    """``1700 BAYBERRY CT STE 300, RICHMOND VA 23226-3791``: street, unit, then city, state and ZIP."""
    state_zip = " ".join(x for x in (_squeeze(r.get("mstate")), _squeeze(r.get("mzip"))) if x)
    city = ", ".join(x for x in (_squeeze(r.get("mcity")), state_zip) if x)
    return ", ".join(x for x in (_squeeze(r.get("mailadd")), _squeeze(r.get("munit")), city) if x) or None


def _situs(r: dict[str, str]) -> str | None:
    """``300 HARVEST BOUNTY DR, WAKE FOREST NC``; the layer has no situs ZIP and often no city."""
    street = ", ".join(x for x in (_squeeze(r.get("siteadd")), _squeeze(r.get("sunit"))) if x)
    if not street:
        return None
    place = " ".join(x for x in (_squeeze(r.get("scity")), "NC") if x)
    return f"{street}, {place}"


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        for r in csv.DictReader(f):
            yield {(k or "").strip().lower(): v for k, v in r.items()}


def read_roll(path: str | Path, county_fips: str, *,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel of the county in scope, in file order (a repeated ``parno`` collapses to the first).

    ``categories`` limits the parcels kept (default: the registry's commercial scope); ``None`` keeps
    every parcel of the county with a category of ``None``. Rows of other counties are skipped.
    """
    c = county_map(county_fips)
    keep = (lambda cat: is_commercial(cat)) if categories is COMMERCIAL_CATEGORIES else (
        (lambda cat: True) if categories is None else (lambda cat, s=frozenset(x.upper() for x in categories): cat in s))
    seen: set[str] = set()
    for r in _rows(path):
        pid = _squeeze(r.get("parno"))
        if not pid or pid in seen:
            continue
        if _squeeze(r.get("cntyfips")) not in ("", c.fips):
            continue  # the statewide layer: only this county's rows belong in this source
        category = state_category(c.fips, r.get("parusecode"), r.get("parusecd2"))
        if category and c.require_improvement and not _positive(r.get("improvval")):
            category = None  # land only: the county's code does not separate vacant land
        if not keep(category or ""):
            continue
        seen.add(pid)
        owner = _owner(r.get("ownname"))
        acres = _positive(r.get("recareano")) or _positive(r.get("gisacres"))
        year = _positive(r.get("structyear"))
        value = _positive(r.get("parval"))
        if c.local_code_with_cd2:
            use = "/".join(x for x in (_squeeze(r.get("parusecode")).upper(), _squeeze(r.get("parusecd2"))) if x)
        else:
            use = _squeeze(r.get("parusecode")).upper()
        yield ParcelRecord(
            county_fips=c.fips,
            apn=pid,
            state_category=category,
            account=_squeeze(r.get("altparno")) or None,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,  # the layer carries no confidentiality marker
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # the layer has no building area
            year_built=int(year) if year else None,
            market_value=None,  # one value, typed "Assessed"; kept as the appraised value
            appraised_value=value,
            tax_year=None,  # the layer does not state the tax year
            locator=f"nc-parcels cntyfips {c.fips} parno {pid}",
            local_use_code=use or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, county_fips: str, *, as_of: str,
          retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest one archived county export into a registry file (created if missing)."""
    c = county_map(county_fips)
    src = source(c.fips)
    reg = Registry(db_path)
    try:
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, c.fips), snap, state_fips=STATE_FIPS,
                                  account_system=c.account_system, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.nc_onemap", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived county CSV (Hub export or query-service rows)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--county", required=True, choices=sorted(COUNTIES), help="3-digit county FIPS (cntyfips)")
    ap.add_argument("--as-of", required=True, help="data date, YYYY-MM-DD (the layer's transfdate for the county)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, args.county, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
