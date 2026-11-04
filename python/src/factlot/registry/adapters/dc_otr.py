"""District of Columbia Office of Tax and Revenue (via Open Data DC): the "Integrated Tax System
Public Extract" (ITSPE) CSV, optionally joined to the "Computer Assisted Mass Appraisal -
Commercial" (CAMA) CSV → ``ParcelRecord``.

Layout (confirmed on the Open Data DC CSV exports of 2026-11-02): one UTF-8, header-row,
comma-delimited CSV per dataset, as exported by the ArcGIS Hub download API.

- ITSPE (the tax assessment roll): one row per SSL (square, suffix, and lot: ``0123    0045``,
  square and lot four characters, suffix up to four; the parcel key). ``USECODE`` is OTR's
  three-digit property use code (``021`` apartment walk-up); ``PREMISEADD`` the property address
  without city or ZIP (the District is one city, so ``, WASHINGTON DC`` is appended);
  ``UNITNUMBER`` the condominium unit; ``OWNERNAME`` and ``OWNNAME2`` the owners of record;
  ``ADDRESS1``, ``ADDRESS2``, ``CITYSTZIP`` the tax billing address; ``LANDAREA`` square feet;
  ``ASSESSMENT`` the current assessed value total (land plus building; the District assesses at
  estimated market value); ``NEWTOTAL`` the proposed total for the coming tax year; ``CY1YEAR``
  the current billing tax year; ``DELCODE`` ``Y`` marks a dead (retired) SSL.
- CAMA Commercial: one row per building (``BLDG_NUM``) and section on an SSL, with ``AYB`` (year
  built), ``LIVING_GBA`` (gross building area, sf), ``NUM_UNITS``, and the same ``USECODE``
  (as a number, ``21``). When the file is given, the parcel's improvement area is the sum of its
  buildings' gross area and its year built the earliest positive ``AYB``.

The use-code table ("Integrated Tax System Property Use Codes", Open Data DC) gives each code a
description and the District's historical property class in parentheses: Class 2 multifamily
residential, Class 3 transient residential (hotels), Class 4 commercial, industrial, and special
purpose. ``_CATEGORY`` below maps those to the FactLot categories ``B`` (multifamily, five or more
units), ``F1`` (commercial), ``F2`` (industrial); every other code (single-family, flats of fewer
than five units, residential condominiums, garages, vacant land) is out of scope. The publisher's
code is kept in ``local_use_code``.

Usage: ``python -m factlot.registry.adapters.dc_otr itspe.csv registry.db --cama cama_commercial.csv --as-of 2026-11-02``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from datetime import date
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "11"
COUNTY_FIPS = "001"
ACCOUNT_SYSTEM = "dc_ssl"

SOURCE = Source(
    source_id="dc-otr-real-property",
    publisher="District of Columbia Office of Tax and Revenue",
    title="Integrated Tax System Public Extract and CAMA Commercial (Open Data DC)",
    url="https://opendata.dc.gov/datasets/DCGIS::integrated-tax-system-public-extract",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="CC-BY-4.0 (stated on the dataset pages); District data policy (Mayor's Order 2017-115) classes open data as public domain, CC0, attribution requested",
    ai_use="permitted",  # CC-BY-4.0 permits any use with attribution; AI use is not addressed
    redistribution="attribution_required",
    attribution="District of Columbia Office of Tax and Revenue, Open Data DC",
    terms_reviewed="2026-11-02",
)

# OTR property use code → FactLot category. Transcribed from the publisher's use-code table
# (Open Data DC, "Integrated Tax System Property Use Codes"; also OTR's "Real Property Use Code
# Listing"). Codes ending in (NC) are the non-conforming-use variants of the same classes.
_MULTIFAMILY = (
    "002",  # Residential-Multi-Family (NC)
    "021",  # Residential-Apartment-Walk-Up (6 or more units)
    "022",  # Residential-Apartment-Elevator (12 or more units)
    "025",  # Residential-Conversion-5 units
    "026",  # Residential-Cooperative-Horizontal
    "027",  # Residential-Cooperative-Vertical
    "028",  # Residential-Cooperative-Mrth5 (more than 5 units)
    "029",  # Residential-Multifamily, Misc
    "126",  # Coop-Horizontal-Mixed Use
    "127",  # Coop-Vertical-Mixed Use
)
_COMMERCIAL = (
    "004", "005", "006", "008",  # Commercial-Retail / Office / Specific Purpose / Special Purpose (NC)
    "031", "032", "033",  # Hotel-Small, Hotel-Large, Motel
    "034",  # Club-Private
    "035",  # Tourist Homes
    "036",  # Dormitory
    "037",  # Inn
    "039",  # Residential-Transient, Misc
    "041", "042", "043", "044", "045", "046", "047", "048", "049",  # Store-* and Commercial-Retail-*
    "051", "052", "053", "056", "057", "058", "059",  # Commercial-Office-*, Office-Condo-*
    "061", "062", "063", "064", "065", "066", "067", "068", "069",  # Banks, garages, parking, service stations, theaters, restaurants
    "081", "082", "083", "084", "085", "086", "087", "088", "089",  # Special purpose: religious, medical, educational, public service, embassy, museum, recreational, health care, misc
    "165", "265", "365", "465",  # Vehicle Service Station-Kiosk / -Market variants
    "189",  # Special Purpose-Memorial
)
_INDUSTRIAL = (
    "007",  # Industrial (NC)
    "071", "072", "073", "074", "075", "076", "078", "079",  # Industrial-* (raw material, heavy, light, warehouses, truck terminal, warehouse condo, misc)
)
_CATEGORY: dict[str, str] = {
    **{c: "B" for c in _MULTIFAMILY},
    **{c: "F1" for c in _COMMERCIAL},
    **{c: "F2" for c in _INDUSTRIAL},
}

# Owner names that are placeholders rather than owners of record.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "CURRENT OWNER", "N/A", "NONE"})
_CITY = "WASHINGTON DC"


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the rows of one Hub CSV export (UTF-8, header row; a BOM is tolerated)."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years, and values: 0 or blank means the publisher has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def use_code(s: str | None) -> str | None:
    """The publisher's three-digit use code: ``'21'``, ``'21.0'``, and ``'021'`` all give ``'021'``."""
    c = _squeeze(s)
    if not c:
        return None
    if re.fullmatch(r"\d+(\.0+)?", c):
        return c.split(".")[0].zfill(3)
    return c.upper()


def state_category(code: str | None) -> str | None:
    """FactLot category for an OTR use code; ``None`` when the code is out of the commercial scope."""
    c = use_code(code)
    return _CATEGORY.get(c) if c else None


def ssl_key(s: str | None) -> str:
    """Join key for an SSL: whitespace removed, upper case (``'0123    0045'`` → ``'01230045'``)."""
    return re.sub(r"\s+", "", s or "").upper()


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("PREMISEADD"))
    if not street:
        return None
    unit = _squeeze(r.get("UNITNUMBER"))
    if unit and unit.upper() not in street.upper():
        street = f"{street} UNIT {unit}"
    if "WASHINGTON" in street.upper():  # some rows (federal and possessory-interest lots) already carry city and ZIP
        return street
    return f"{street}, {_CITY}"


def _mailing_address(r: dict[str, str]) -> str | None:
    parts = (_squeeze(r.get("ADDRESS1")), _squeeze(r.get("ADDRESS2")), _squeeze(r.get("CITYSTZIP")))
    return ", ".join(x for x in parts if x) or None


def sale_of(r: dict[str, str]) -> dict[str, object] | None:
    """The ``transaction.sale`` value for the most recent sale ITSPE records on an SSL, or ``None`` when it has
    no real date or no price. ITSPE names no buyer or seller. ``ACCEPTCODE`` is OTR's "property sale acceptance
    code" (``Market Sale``, ``Buyer = Seller``, ``Foreclosure``, ``Government Purchase``, a ``Multi-`` prefix, ...)
    and is kept verbatim as ``acceptance_code``; the extract does not say which codes are arm's-length sales, so
    none is marked so here."""
    price = _num(r.get("SALEPRICE"))
    m = re.match(r"(\d{4})[/-](\d{2})[/-](\d{2})", (r.get("SALEDATE") or "").strip())
    if price is None or price < 0 or not m or int(m[1]) <= 1900:  # 1900/01/01 is the blank date
        return None
    try:
        when = date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None
    out: dict[str, object] = {"date": when.isoformat(), "price_usd": int(round(price))}
    if code := _squeeze(r.get("ACCEPTCODE")):
        out["acceptance_code"] = code
    if kind := _squeeze(r.get("SALETYPE")):
        out["sale_type"] = kind
    return out


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def read_cama(path: str | Path) -> dict[str, dict[str, float | None]]:
    """Per-SSL building facts from the CAMA Commercial CSV: summed gross building area, earliest
    year built, summed units (each ``None`` when no building has a positive figure)."""
    out: dict[str, dict[str, float | None]] = {}
    for r in _rows(path):
        key = ssl_key(r.get("SSL"))
        if not key:
            continue
        b = out.setdefault(key, {"gba": None, "year_built": None, "units": None})
        gba = _positive(r.get("LIVING_GBA"))
        if gba:
            b["gba"] = (b["gba"] or 0) + gba
        year = _positive(r.get("AYB"))
        if year and (b["year_built"] is None or year < b["year_built"]):
            b["year_built"] = year
        units = _positive(r.get("NUM_UNITS"))
        if units:
            b["units"] = (b["units"] or 0) + units
    return out


def read_roll(path: str | Path, *, cama_path: str | Path | None = None,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per live SSL in scope, in file order.

    ``categories`` limits the rows kept by FactLot category (default: the commercial scope);
    ``None`` keeps every SSL, with ``state_category`` ``None`` for out-of-scope use codes.
    ``cama_path`` adds year built and gross building area from the CAMA Commercial export.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    buildings = read_cama(cama_path) if cama_path else {}
    for r in _rows(path):
        ssl = _squeeze(r.get("SSL"))
        if not ssl or _squeeze(r.get("DELCODE")).upper() == "Y":
            continue
        code = use_code(r.get("USECODE"))
        category = state_category(code)
        if not keep(category):
            continue
        b = buildings.get(ssl_key(ssl), {})
        owner_name = _owner(r.get("OWNERNAME"))
        year = b.get("year_built")
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=ssl,
            state_category=category,
            account=ssl,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the extract carries no withheld-owner marker
            land_area_sf=_positive(r.get("LANDAREA")),
            improvement_area_sf=b.get("gba"),
            year_built=int(year) if year else None,
            market_value=_positive(r.get("ASSESSMENT")),
            appraised_value=_positive(r.get("NEWTOTAL")),
            tax_year=int(y) if (y := _num(r.get("CY1YEAR"))) else None,
            locator=f"ITSPE SSL {ssl}",
            local_use_code=code,
            sales=[sale] if (sale := sale_of(r)) else [],
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, cama_path: str | Path | None = None,
          retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest one archived ITSPE export (plus, optionally, the CAMA Commercial export) into a
    registry file (created if missing). Facts cite the ITSPE snapshot."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, cama_path=cama_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.dc_otr", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the ITSPE CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--cama", help="path to the CAMA Commercial CSV export (year built, gross building area)")
    ap.add_argument("--as-of", required=True, help="extract date, YYYY-MM-DD (the dataset's 'data updated' date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, cama_path=args.cama, retrieved_at=args.retrieved_at,
                  full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
