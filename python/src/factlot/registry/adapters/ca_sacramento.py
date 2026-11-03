"""Sacramento County parcel layer with Assessor land-use classes (county GIS open data) → ``ParcelRecord``.

Layout (confirmed on the hosted feature layer ``Parcels`` of the Sacramento County GIS Open Data site, item
``8d011b99aebc46d48060b2e5bdd7f4a0``, 502,447 parcels, 2026-11-03, and on a filtered CSV export of its Office
class): one row per parcel with a header row. The Hub CSV export uses the field ALIASES as column names
(``Street Name``); the raw field names (``STREET_NAM``) are accepted too. Header names are matched
case-insensitively with punctuation folded to ``_``.

- ``APN`` — 14 digits (book 3, page 4, parcel 3, split 4: ``00100110010000``), the parcel key. ``account`` is the
  printed form ``001-0011-001-0000``.
- ``Landuse`` (six-character code such as ``CBB00E``), ``Landuse General``, ``Landuse Specific``,
  ``Landuse Detail`` — the county's land-use classification of the parcel (the publisher's text; no code
  table is posted with the layer, so the mapping below is by the descriptive classes). The file's
  ``Landuse Use`` column says whether the class is the "Most probable use" or a status such as "Unfinished".
- ``Street Number``, ``Street Name`` (direction and unit text included), ``City``, ``Zip`` — situs.
- ``Lot Size`` — square feet (the median ratio to the polygon area is 1.00); 0 for condominium sub-parcels.
- NO assessed value, NO owner name, NO year built or building area: the layer is a parcel fabric. The Assessor
  gives the secured roll by e-mail request (``docs/registry/sources/ca-sacramento-assessor.md``).

Category mapping (descriptive classes, see the review record): ``B`` = Residential / Low Rise Apartment and
High Rise Apartment (the county files two- to four-family parcels under their own classes);
``F1`` = Retail / Commercial, Office, hotels, motels and mobile home parks, hospitals, nursing and retirement
homes, theaters, bowling, skating, golf, marinas, race tracks, stadiums and health spas; ``F2`` = Industrial.
Common areas, vacant land, agricultural, church, public and utility classes are out of scope.

Usage: ``python -m factlot.registry.adapters.ca_sacramento office.csv apartments.csv care.csv registry.db --as-of 2026-11-01``
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

STATE_FIPS = "06"
COUNTY_FIPS = "067"
ACCOUNT_SYSTEM = "sacramento_apn"

SOURCE = Source(
    source_id="ca-sacramento-assessor",
    publisher="Sacramento County GIS (parcel layer with Assessor land-use classes, county GIS Open Data site)",
    title="Parcels (Sacramento County GIS Open Data)",
    url="https://data.saccounty.gov/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Creative Commons CC0 1.0 public-domain dedication (item licenseInfo); the Hub search record tags it CC-BY-4.0",
    ai_use="unknown",  # not addressed by the publisher; CC0 places no restriction
    redistribution="permitted",
    attribution="Sacramento County GIS",
    terms_reviewed="2026-11-03",
)

_F1_RETAIL_EXCLUDED = frozenset({"common area", "nursery", "advertising"})
_F1_CARE = frozenset({"acute care hospital", "skilled nursing facility", "retirement home"})
_F1_RECREATION = frozenset({"theater", "bowling", "skating", "golf course", "marina", "race track",
                            "sport court / field / stadium"})
_B_RESIDENTIAL = frozenset({"low rise apartment", "high rise apartment"})
_F1_RESIDENTIAL = frozenset({"hotel", "motel", "mobile home park"})
_F2_EXCLUDED = frozenset({"common area", "mining", "airport (private)", "railroad spur"})


def _key(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return _ALIASES.get(key, key)


# Raw ArcGIS field names → the alias-style names the code uses.
_ALIASES = {
    "street_nbr": "street_number", "street_nam": "street_name", "lot_size": "lot_size",
    "lu_general": "landuse_general", "lu_specif": "landuse_specific", "lu_detail": "landuse_detail",
    "lu_use": "landuse_use", "lu_sec_use": "landuse_secondary_use",
}


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _positive(s: str | None) -> float | None:
    try:
        v = float((s or "").strip())
    except ValueError:
        return None
    return v if v > 0 else None


def category(general: str | None, specific: str | None = None, detail: str | None = None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for a Sacramento land-use class, or ``None`` when out of scope."""
    g, s = _squeeze(general).lower(), _squeeze(specific).lower()
    if g == "residential":
        if s in _B_RESIDENTIAL:
            return "B"
        return "F1" if s in _F1_RESIDENTIAL else None
    if g in ("retail / commercial", "office"):
        return None if s in _F1_RETAIL_EXCLUDED else "F1"
    if g == "care / health":
        return "F1" if s in _F1_CARE else None
    if g == "recreational":
        if s in _F1_RECREATION:
            return "F1"
        return "F1" if s == "private club" and _squeeze(detail).lower() == "health spa" else None
    if g == "industrial":
        return None if s in _F2_EXCLUDED else "F2"
    return None


def account(apn: str) -> str:
    """``00100110010000`` → ``001-0011-001-0000``; anything not 14 digits is returned unchanged."""
    return f"{apn[0:3]}-{apn[3:7]}-{apn[7:10]}-{apn[10:14]}" if re.fullmatch(r"\d{14}", apn) else apn


def situs(r: dict[str, str]) -> str | None:
    """``600 N 10TH ST, SACRAMENTO, CA 95811``; ``None`` without a street name. The number may be blank."""
    name = _squeeze(r.get("street_name"))
    if not name:
        return None
    street = " ".join(x for x in (_squeeze(r.get("street_number")), name) if x)
    zip_code = _squeeze(r.get("zip"))
    zip_code = zip_code[:-2] if re.fullmatch(r"\d{5}\.0", zip_code) else zip_code
    state_zip = " ".join(x for x in ("CA", zip_code) if x)
    return ", ".join(x for x in (street, _squeeze(r.get("city")), state_zip) if x)


def read_roll(path: str | Path) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel of one CSV export, in file order."""
    csv.field_size_limit(1 << 30)
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            r = dict(zip(header, values))
            apn = re.sub(r"\s+", "", r.get("apn") or "")
            cat = category(r.get("landuse_general"), r.get("landuse_specific"), r.get("landuse_detail"))
            if not apn or cat is None or apn in seen:
                continue
            seen.add(apn)
            yield ParcelRecord(
                county_fips=COUNTY_FIPS,
                apn=apn,
                state_category=cat,
                account=account(apn),
                situs_address=situs(r),
                owner_name=None,  # the layer publishes no owner names
                owner_mailing_address=None,
                owner_confidential=False,
                land_area_sf=_positive(r.get("lot_size")),
                locator=f"APN {apn}",
                local_use_code=_squeeze(r.get("landuse")) or None,
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived export into a registry file (created if missing).

    The layer arrives as several class-filtered exports, so the default is ``full_roll=False``: no parcel
    is retired for being absent from one piece.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ca_sacramento", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="archived CSV export(s) as saved by the collector (one snapshot each)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date of the layer (item modified date), YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full", action="store_true", help="the file is the whole layer: retire parcels missing from it")
    args = ap.parse_args(argv)
    out = {}
    for path in args.snapshot:
        out[path] = asdict(build(path, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full))
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
