"""Nashville and Davidson County, Tennessee: Metro Open Data Portal "Parcels" → ``ParcelRecord``.

Source: the Nashville Open Data Portal dataset "Parcels" (ArcGIS Hub item fa26cd9326c446179be059e00449cb1f,
FeatureServer layer ``Parcels_view/0``), "Parcel Boundaries within Nashville and Davidson County including
location, ownership, and assessment information", maintained by the Planning Department from the Assessor of
Property's rolls and updated daily. The adapter reads the Hub CSV export (``csv`` in the collector archive),
filtered by the config to land-use codes 021-079.

Layout (confirmed on the 2026-11-03 export): UTF-8 with a BOM and a header row of 43 columns, one row per
parcel polygon (condominium units and floors repeat the parent's parcel shape; ``Feature Type`` says which).
The Hub export writes the portal's field *aliases* as the header (``Assessor Parcel Number``, ``Owner Name``);
the service's own field names (``STANPAR``, ``Owner``) are accepted too.

- ``Assessor Parcel Number`` (``STANPAR``) — the Assessor's parcel number (``09314011800``; condominium
  units end in ``CO``: ``093140A11200CO``). ``Parcel ID`` (``ParID``) is a numeric record id.
- ``Owner Name`` (``Owner``), ``Owner Address 1``-``3``, ``Owner City``, ``Owner State``, ``Owner Country``,
  ``Owner Zip Code`` — owner of record and mailing address. No confidentiality marker exists in the file.
- ``Parcel Address`` (``PropAddr``; condominium units carry ``#101``), ``Parcel City``, ``Parcel State``,
  ``Parcel Zip Code`` — situs.
- ``Acres`` — deeded acres (0 for condominium units).
- ``Land Use Code`` (``LUCode``) / ``Land Use Description`` (``LUDesc``) — the Assessor's land-use code
  (95 distinct values on 2026-11-03; the table is the portal's own domain, reproduced in the review record).
  ``001``-``008`` government and parks, ``010``-``019`` residential, ``020``-``029`` retail, ``030``
  vacant multi-family, ``031``-``036`` banks and offices, ``037``-``039`` apartments, ``041``-``049``
  automotive and parking, ``051``-``059`` restaurants, entertainment, hotels, ``061``-``069`` camp
  grounds, mobile home parks, storage, wholesale, ``070``-``078`` industrial, ``080``-``089`` rural,
  ``090``-``099`` exempt.
- ``Land Appraised Value``, ``Improvement Appraised Value``, ``Total Appraised Value`` — the Assessor's
  appraisal (whole dollars). The file has no building area and no year built.

Category mapping (FactLot scope): ``B`` for apartments (``037``-``039``); ``F2`` for the industrial family
(``071``-``078``: light and heavy manufacturing, lumber, packing, business center, mineral processing,
terminal/distribution warehouse, open storage); ``F1`` for retail, offices, banks, automotive,
restaurants, entertainment, hotels, parking, camp grounds, mobile home parks, storage, wholesale and event
and marina uses (``021``-``029``, ``031``-``036``, ``041``-``049``, ``051``-``059``, ``061``-``065``,
``067``, ``069``). Vacant land (``010``, ``020``, ``030``, ``070``, ``080``, ``090``), residential
(including duplexes to quadplexes), greenhouses (``066``), rural, exempt and government codes yield no
record. ``local_use_code`` keeps the code verbatim.

Usage: ``python -m factlot.registry.adapters.tn_davidson csv registry.db --as-of 2026-09-30``
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

STATE_FIPS = "47"
COUNTY_FIPS = "037"
ACCOUNT_SYSTEM = "davidson_stanpar"

SOURCE = Source(
    source_id="tn-davidson-assessor",
    publisher="Metropolitan Government of Nashville and Davidson County (Planning Department; Assessor of Property)",
    title="Parcels (Nashville Open Data Portal, Hub CSV export)",
    url="https://data.nashville.gov/datasets/parcels-1/about",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Metro Nashville Open Data Portal data; the Nashville.gov Terms of Service exclude 'publicly available "
            "data on Metro's Open Data Portal' from the commercial-use prohibition. Executive Order 18 (2024): "
            "informational use, show the retrieval date, no implied Metro approval, as is. Public records",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="permitted",
    attribution="Metropolitan Government of Nashville and Davidson County, Nashville Open Data Portal "
                "(retrieved 2026-11-03)",
    terms_reviewed="2026-11-03",
)

_SQFT_PER_ACRE = 43560

# Land-use code → FactLot category (see the module docstring). Codes absent from the table yield no record.
_APARTMENTS = frozenset({"037", "038", "039"})
_INDUSTRIAL = frozenset({"071", "072", "073", "074", "075", "076", "077", "078"})
_COMMERCIAL = frozenset(
    {f"{n:03d}" for n in range(21, 30)}       # 021-029 retail, day care, mall, convenience
    | {f"{n:03d}" for n in range(31, 37)}     # 031-036 bank, offices, medical, office condominium
    | {f"{n:03d}" for n in range(41, 50)}     # 041-049 automotive, parking
    | {f"{n:03d}" for n in range(51, 60)}     # 051-059 restaurants, entertainment, hotel/motel
    | {"061", "062", "063", "064", "065", "067", "069"}  # camp ground, mobile home park, storage, wholesale, marina, events
)

# Header aliases (the Hub export) and service field names, by logical key.
_COLUMNS = {
    "apn": ("Assessor Parcel Number", "STANPAR"),
    "owner": ("Owner Name", "Owner"),
    "own1": ("Owner Address 1", "OwnAddr1"),
    "own2": ("Owner Address 2", "OwnAddr2"),
    "own3": ("Owner Address 3", "OwnAddr3"),
    "owncity": ("Owner City", "OwnCity"),
    "ownstate": ("Owner State", "OwnState"),
    "owncountry": ("Owner Country", "OwnCountry"),
    "ownzip": ("Owner Zip Code", "OwnZip"),
    "addr": ("Parcel Address", "PropAddr"),
    "city": ("Parcel City", "PropCity"),
    "state": ("Parcel State", "PropState"),
    "zip": ("Parcel Zip Code", "PropZip"),
    "acres": ("Acres",),
    "lucode": ("Land Use Code", "LUCode"),
    "total": ("Total Appraised Value", "TotlAppr"),
}

_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER", "N/A", "NONE"})
_US_COUNTRY = frozenset({"", "US", "USA", "UNITED STATES"})


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def state_category(lucode: str | None) -> str | None:
    """FactLot category for a Davidson County land-use code, or ``None`` when out of scope.

    ``"038"`` → ``B``; ``"032"`` → ``F1``; ``"072"`` → ``F2``; ``"020"`` (vacant commercial land) → ``None``.
    """
    code = _squeeze(lucode).upper()
    if code in _APARTMENTS:
        return "B"
    if code in _INDUSTRIAL:
        return "F2"
    if code in _COMMERCIAL:
        return "F1"
    return None


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    v = _num(s)
    return v if v and v > 0 else None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Rows keyed by logical name (``apn``, ``owner`` …); the header may use aliases or field names."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader, [])]
        index = {h.lower(): i for i, h in enumerate(header)}
        pick = {key: next((index[c.lower()] for c in names if c.lower() in index), None) for key, names in _COLUMNS.items()}
        for values in reader:
            yield {key: (values[i] if i is not None and i < len(values) else "") for key, i in pick.items()}


def _mailing_address(r: dict[str, str]) -> str | None:
    state_zip = " ".join(x for x in (_squeeze(r["ownstate"]), _squeeze(r["ownzip"])) if x)
    country = _squeeze(r["owncountry"])
    parts = [_squeeze(r["own1"]), _squeeze(r["own2"]), _squeeze(r["own3"]),
             ", ".join(x for x in (_squeeze(r["owncity"]), state_zip) if x),
             "" if country.upper() in _US_COUNTRY else country]
    return ", ".join(x for x in parts if x) or None


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r["addr"])
    if not street:
        return None
    state_zip = " ".join(x for x in (_squeeze(r["state"]), _squeeze(r["zip"])) if x)
    place = " ".join(x for x in (_squeeze(r["city"]), state_zip) if x)
    return f"{street}, {place}" if place else street


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope, in file order (repeated parcel numbers collapse to the first:
    condominium floors and units share a polygon). ``categories=None`` keeps every parcel with a category of ``None``
    for out-of-scope ones.
    """
    keep = (lambda c: is_commercial(c)) if categories is COMMERCIAL_CATEGORIES else (
        (lambda c: True) if categories is None else (lambda c, s=frozenset(x.upper() for x in categories): c in s))
    seen: set[str] = set()
    for r in _rows(path):
        pid = _squeeze(r["apn"])
        if not pid or pid in seen:
            continue
        category = state_category(r["lucode"])
        if not keep(category or ""):
            continue
        seen.add(pid)
        owner = _owner(r["owner"])
        acres = _positive(r["acres"])
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,  # the file carries no confidentiality marker
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # the file has no building area
            year_built=None,  # nor a year built
            market_value=None,
            appraised_value=_positive(r["total"]),
            tax_year=None,  # the file does not state the tax year
            locator=f"Parcels STANPAR {pid}",
            local_use_code=_squeeze(r["lucode"]) or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived Hub CSV export into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tn_davidson", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived Hub CSV export of the Parcels dataset")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="data date, YYYY-MM-DD (the dataset's last-edited date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
