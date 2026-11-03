"""Fulton County, Georgia (Atlanta) Board of Assessors tax-digest parcels → ``ParcelRecord``.

Source: the county's ArcGIS Hub open-data site (gisdata.fultoncountyga.gov), item "Tax Parcels
<year>" (the completed digest for that tax year; the CAMA attributes the county joins to its parcel
polygons). The adapter reads the Hub CSV export of the layer (``Tax_Parcels_<year>.csv``) and, when
given, the structure tables from the county's ``Tax_CAMAInfo.zip`` extract for year built and
building area.

Layout (confirmed on the 2025 digest export, 2026-11-02): a comma-separated, quoted CSV with a
header row and UTF-8 bytes, one row per parcel polygon, keyed by ``ParcelID`` (the Board of
Assessors parcel number, ``14 0135  LL0034`` or ``17 006000010786``; spaces are significant in the
county's own display form but not in the identifier).

- ``Address`` — situs street line (``AddrNumber``..``AddrUnit`` are its parts); there is no situs
  city or ZIP column.
- ``Owner``, ``OwnerAddr1``, ``OwnerAddr2`` — owner of record and mailing address. No
  confidentiality flag exists in the file.
- ``ClassCode`` — the Georgia digest property class (Ga. Comp. R. & Regs. 560-11-2-.21): a class
  letter (``R`` residential, ``C`` commercial, ``I`` industrial, ``A`` agricultural, ``E`` exempt,
  ``U`` utility, ``V``/``J`` conservation, ``H`` historic, ``B`` brownfield) and a strata digit
  (``1`` improvements, ``3`` lots, ``4`` small tracts, ``5`` large tracts). Fulton keys nearly every
  parcel to the land stratum (``R3``, ``C3``, ``I3``), so only the letter is read here.
- ``LUCode`` — the county's own land-use code, three characters whose first character is the use
  family: ``1`` residential, ``2`` apartments and hotels, ``3`` commercial, ``4`` industrial,
  ``5`` taxable institutional, ``6`` exempt, ``7`` utility, ``8`` special (brownfield, economic
  development), ``9`` tie-back. ``x00`` is vacant land in each family and ``x99``/``999`` are
  tie-back (secondary) parcels.
- ``TotAppr``, ``LandAppr``, ``ImprAppr`` — the county's appraised fair market value (whole
  dollars); ``TotAssess`` etc. are the 40 % assessed values Georgia taxes on. ``LivUnits`` is the
  number of living units, ``LandAcres`` the land area in acres. ``TaxYear`` is the digest year.

Category mapping (FactLot scope): ``B`` for the county's apartment land-use codes (family ``2``
except hotels/motels ``25x``, vacant ``200`` and tie-back ``299``) on a taxable parcel; ``F2`` for
class ``I`` and for industrial land uses (family ``4``); ``F1`` for the remaining class ``C``
parcels. Vacant land, tie-backs, residential, exempt, utility, agricultural, conservation,
historic, and brownfield parcels are out of scope and yield no record. ``local_use_code`` keeps
``<ClassCode>/<LUCode>`` verbatim.

Usage: ``python -m factlot.registry.adapters.ga_fulton Tax_Parcels_2025.csv registry.db --as-of 2025-06-24 [--structures Tax_CAMAInfo.zip]``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "13"
COUNTY_FIPS = "121"
ACCOUNT_SYSTEM = "fulton_parcel_id"

SOURCE = Source(
    source_id="ga-fulton-assessor",
    publisher="Fulton County Board of Assessors (via Fulton County GIS open data)",
    title="Tax Parcels <year> digest export (ArcGIS Hub CSV of the Tax_Parcels_<year> layer)",
    url="https://gisdata.fultoncountyga.gov/datasets/fulcogis::tax-parcels-2025",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (O.C.G.A. § 50-18-70 et seq.). The open-data site declares CC-BY-SA; the dataset "
            "item carries only an 'as is' disclaimer. Pending confirmation with the publisher",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # CC-BY-SA at site level; the item itself states no license (pending review)
    attribution="Fulton County Board of Assessors; Fulton County Department of Information Technology, GIS Division",
    terms_reviewed="2026-11-02",
)

# Georgia digest class letters whose parcels are taxable real property in the registry's scope.
_TAXABLE_CLASSES = frozenset({"C", "I"})
# Residential-class parcels can carry an apartment land use (one R4/211 parcel in 2025); keep those.
_APARTMENT_HOST_CLASSES = _TAXABLE_CLASSES | {"R"}
# Land-use family 2 is apartments and hotels; 25x are hotels/motels (commercial, not multifamily).
_HOTEL_PREFIX = "25"
# Owner strings the county uses when it has no owner of record.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "N/A", "NONE"})

_SQFT_PER_ACRE = 43560


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the CSV rows from the archived file (``.csv``), a zip holding it, or an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for member in sorted(p.glob("*.csv")):
            with open(member, newline="", encoding="utf-8-sig", errors="replace") as f:
                yield from csv.DictReader(f)
        return
    if p.suffix.lower() == ".zip":
        with zipfile.ZipFile(p) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".csv"):
                    with zf.open(name) as raw:
                        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline=""))
        return
    with open(p, newline="", encoding="utf-8-sig", errors="replace") as f:
        yield from csv.DictReader(f)


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: a 0 (or blank) means the county has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def is_vacant_or_tieback(lu_code: str) -> bool:
    """``x00`` is the vacant-land code of each land-use family; ``x99``/``999`` are tie-back parcels."""
    return bool(re.fullmatch(r"\d00|\d99|999", lu_code))


def state_category(class_code: str | None, lu_code: str | None) -> str | None:
    """FactLot category for a Fulton ``ClassCode``/``LUCode`` pair, or ``None`` when out of scope.

    ``("C3", "2C1")`` → ``B``; ``("C3", "355")`` → ``F1``; ``("I3", "401")`` → ``F2``; ``("C3", "300")`` → ``None``.
    """
    cls = _squeeze(class_code).upper()
    lu = _squeeze(lu_code).upper()
    letter = cls[:1]
    if not letter or not lu or is_vacant_or_tieback(lu) or lu[0] == "1":
        return None  # vacant, tie-back, or a residential land use (dwellings, 2–4 family, condos, HOA land)
    if lu[0] == "2" and not lu.startswith(_HOTEL_PREFIX):
        return "B" if letter in _APARTMENT_HOST_CLASSES else None
    if letter not in _TAXABLE_CLASSES:
        return None
    if letter == "I" or lu[0] == "4":
        return "F2"
    return "F1"


def _situs(r: dict[str, str]) -> str | None:
    """The situs street line as published; the layer has no situs city or ZIP."""
    return _squeeze(r.get("Address")) or None


def _mailing_address(r: dict[str, str]) -> str | None:
    return ", ".join(x for x in (_squeeze(r.get("OwnerAddr1")), _squeeze(r.get("OwnerAddr2"))) if x) or None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def read_structures(path: str | Path) -> dict[str, tuple[int | None, float | None]]:
    """``ParcelID`` → ``(year built, building area sf)`` from ``Tax_StructureCommercial.txt`` in the
    county's ``Tax_CAMAInfo.zip`` (tab-delimited, one row per building card: ``YrBlt``, ``AreaSF``).

    Area is the sum over a parcel's cards; the year is that of the largest card. Zeros are not figures.
    """
    csv.field_size_limit(1 << 30)
    p = Path(path)
    name = "Tax_StructureCommercial.txt"
    if p.is_dir():
        f = open(p / name, newline="", encoding="utf-8", errors="replace")
    else:
        zf = zipfile.ZipFile(p)
        f = io.TextIOWrapper(zf.open(name), encoding="utf-8", errors="replace", newline="")
    cards: dict[str, list[tuple[float, int | None]]] = defaultdict(list)
    with f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            pid = (r.get("ParcelID") or "").strip()
            if not pid:
                continue
            area = _positive(r.get("AreaSF"))
            year = _positive(r.get("YrBlt"))
            cards[pid].append((area or 0.0, int(year) if year else None))
    out: dict[str, tuple[int | None, float | None]] = {}
    for pid, lst in cards.items():
        total = sum(a for a, _ in lst)
        largest = max(lst, key=lambda t: t[0])
        year = largest[1] or next((y for _, y in lst if y), None)
        out[pid] = (year, total or None)
    return out


def read_roll(path: str | Path, *, structures: str | Path | None = None,
              all_parcels: bool = False) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel, in file order (repeated ``ParcelID`` rows collapse
    to the first). With ``all_parcels=True`` every parcel is yielded; out-of-scope ones carry
    ``state_category=None``.
    """
    built = read_structures(structures) if structures else {}
    seen: set[str] = set()
    for r in _rows(path):
        pid = (r.get("ParcelID") or "").strip()  # inner spacing is part of the county's own form
        if not pid or pid in seen:
            continue
        cls, lu = _squeeze(r.get("ClassCode")).upper(), _squeeze(r.get("LUCode")).upper()
        category = state_category(cls, lu)
        if category is None and not all_parcels:
            continue
        seen.add(pid)
        owner_name = _owner(r.get("Owner"))
        acres = _positive(r.get("LandAcres"))
        year_built, area = built.get(pid, (None, None))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the export carries no confidentiality flag
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=area,
            year_built=year_built,
            market_value=_positive(r.get("TotAppr")),  # Georgia's appraised value is fair market value
            appraised_value=_positive(r.get("TotAppr")),
            tax_year=int(y) if (y := _num(r.get("TaxYear"))) else None,
            locator=f"ParcelID {pid}",
            local_use_code="/".join(x for x in (cls, lu) if x) or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          structures: str | Path | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest one archived digest export (and optionally the CAMA structure zip) into a registry file."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, structures=structures), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ga_fulton", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived Tax_Parcels_<year>.csv (Hub export)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="digest date, YYYY-MM-DD (the export's Last-Modified date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--structures", help="archived Tax_CAMAInfo.zip for year built and building area")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  structures=args.structures, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
