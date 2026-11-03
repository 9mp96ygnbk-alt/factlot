"""Oregon Metro RLIS "Taxlots (Public)" (Multnomah 41051, Washington 41067, Clackamas 41005) →
``ParcelRecord``. Multnomah County is the Tier 2 target; the same file carries the other two Portland-area
counties, so the adapter reads all three.

Layout (confirmed 2026-11-03 on the first 30 MB of the ArcGIS Hub CSV export and on the feature-service
field list, item ``b3cabe5845ec47eab61c54e0c631313c`` layer 3): Metro's Data Resource Center compiles
the three county assessors' tax-lot files into one standardized layer, "county tax assessors tax lots with
associated property data, **excluding ownership information**". The CSV export is UTF-8 (BOM), one row per
tax lot, header row of field names:

    TLID, PRIMACCNUM, ALTACCNUM, SITEADDR, SITECITY, SITEZIP, BLDGSQFT, A_T_ACRES, YEARBUILT, PROP_CODE,
    LANDUSE, TAXCODE, SALEDATE, SALEPRICE, COUNTY, X_COORD, Y_COORD, JURIS_CITY, GIS_ACRES, STATECLASS,
    ORTAXLOT, LANDVAL, BLDGVAL, TOTALVAL, ASSESSVAL, FID, AREA, HAS_MANY, Shape__Area, Shape__Length
    (the live layer adds PUBLIC_OWN and OWNERTYPE)

``COUNTY`` is ``C`` (Clackamas), ``M`` (Multnomah) or ``W`` (Washington). ``PRIMACCNUM`` is the county's
account number (Multnomah: the property ID, e.g. ``R2223193``), unique within a county; it is the parcel
key here. ``TLID`` is the state-standard map and tax lot number. ``TOTALVAL`` is the real market value
(``LANDVAL`` + ``BLDGVAL``), ``ASSESSVAL`` the assessed value that taxes are computed on.

``PROP_CODE`` is the Oregon Department of Revenue property class (OAR 150-308.215 as listed in the layer
metadata): first digit ``2`` commercial, ``3`` industrial, ``7`` multiple-family (``1`` residential,
``4`` tract, ``5`` farm, ``6`` forest, ``8`` miscellaneous, ``9`` exempt). The last digit is the
improvement state: ``0`` vacant, ``1`` improved, ``2`` condominium, ``3`` state responsibility, ``6``
waterfront vacant, ``7`` manufactured structure (a park, for ``707``), ``8`` land only, ``9`` manufactured.
Mapping: ``2x1``/``2x2`` → ``F1``, ``3x1``/``3x2`` and ``303`` (Department of Revenue appraised industrial)
→ ``F2``, ``7x1``/``7x2`` → ``B``. Vacant, land-only, manufactured and exempt classes yield no record. The
layer's own ``LANDUSE`` is not used: its ``MFR`` also covers residential condominiums.

Usage: ``python -m factlot.registry.adapters.or_metro_rlis taxlots.csv registry.db --as-of 2026-07-17``
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "41"
ACCOUNT_SYSTEM = "or_metro_account"

COUNTY_FIPS = {"C": "005", "M": "051", "W": "067"}

SOURCE = Source(
    source_id="or-metro-rlis-taxlots",
    publisher="Metro (Oregon), Data Resource Center, RLIS",
    title="RLIS Taxlots (Public): Clackamas, Multnomah and Washington County tax lots (no ownership information)",
    url="https://rlisdiscovery.oregonmetro.gov/datasets/b3cabe5845ec47eab61c54e0c631313c/about",
    state_fips=STATE_FIPS,
    license="RLIS Open Database End User License Agreement (Open Database License, ODbL v1.0 per Metro's metadata): attribution and share-alike",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="attribution_required",  # ODbL: attribution and share-alike for derived databases
    attribution="Contains information from RLIS, Metro (Oregon), made available under the Open Database License (ODbL)",
    terms_reviewed="2026-11-03",
)

SQFT_PER_ACRE = 43560.0


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years and values: the export writes 0 or blank when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def category(prop_code: str | None) -> str | None:
    """FactLot category for an Oregon Department of Revenue property class; ``None`` when out of scope."""
    code = (prop_code or "").strip()
    if len(code) != 3 or not code.isdigit():
        return None
    if code == "303":
        return "F2"
    if code[2] not in "12":
        return None
    return {"2": "F1", "3": "F2", "7": "B"}.get(code[0])


def _situs(r: dict[str, str]) -> str | None:
    street = " ".join((r.get("SITEADDR") or "").split())
    if not street:
        return None
    city = " ".join((r.get("SITECITY") or "").split())
    return f"{street}, {city} OR" if city else f"{street}, OR"


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().upper() for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def read_roll(path: str | Path) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per tax lot with an account number in one of the three counties.

    Every such lot is yielded; ``state_category`` is ``None`` for lots outside the commercial scope,
    which the registry counts as skipped. Right-of-way and other features without an account number
    are dropped.
    """
    for r in _rows(path):
        account = (r.get("PRIMACCNUM") or "").strip()
        fips = COUNTY_FIPS.get((r.get("COUNTY") or "").strip().upper())
        if not account or not fips:
            continue
        prop_code = (r.get("PROP_CODE") or "").strip()
        acres = _positive(r.get("A_T_ACRES"))
        year = _positive(r.get("YEARBUILT"))
        yield ParcelRecord(
            county_fips=fips,
            apn=account,
            state_category=category(prop_code),
            account=f"{fips}:{account}",
            situs_address=_situs(r),
            owner_name=None,  # RLIS Taxlots (Public) excludes ownership information
            land_area_sf=round(acres * SQFT_PER_ACRE) if acres else None,
            improvement_area_sf=_positive(r.get("BLDGSQFT")),
            year_built=int(year) if year else None,
            market_value=_positive(r.get("TOTALVAL")),
            appraised_value=_positive(r.get("ASSESSVAL")),
            tax_year=None,
            locator=f"PRIMACCNUM {account} TLID {(r.get('TLID') or '').strip()}",
            local_use_code=prop_code or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived export into a registry file (created if missing).

    ``full_roll`` retires parcels that an earlier snapshot of this source covered and this one does not:
    turn it on only for a complete export of all three counties.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.or_metro_rlis", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the Taxlots (Public) CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date of last data update, YYYY-MM-DD (the layer's description)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true", help="retire parcels missing from this complete export")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
