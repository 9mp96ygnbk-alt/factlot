"""Wake County, North Carolina (Raleigh): NC OneMap statewide parcels, Wake slice → ``ParcelRecord``.

A thin wrapper over :mod:`factlot.registry.adapters.nc_onemap`, which holds the Wake mapping together with
the mappings of the other North Carolina counties. Wake keeps its own source id (``nc-wake-parcels``), account
system (``wake_reid``) and config (``registry/sources/nc/nc-wake-parcels.json``); the review record is
``docs/registry/sources/nc-wake-parcels.md``.

Wake's ``parusecode`` is NC OneMap's three-letter name for the Wake County land class: ``COM`` = ``C`` commercial
→ ``F1``, ``IND`` = ``D`` industrial → ``F2``, ``APT`` = ``G`` apartment → ``B`` (except parcels whose main
building, ``parusecd2``, is a one- to four-family house: 01-04). ``local_use_code`` is ``<parusecode>/<parusecd2>``
(``COM/34``). Layout and the code tables are in the ``nc_onemap`` docstring and the review record.

Usage: ``python -m factlot.registry.adapters.nc_wake "North_Carolina_Parcels_(Polygons).csv" registry.db --as-of 2026-05-17``
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord
from . import nc_onemap

STATE_FIPS = nc_onemap.STATE_FIPS
COUNTY_FIPS = "183"
ACCOUNT_SYSTEM = nc_onemap.COUNTIES[COUNTY_FIPS].account_system
SOURCE = nc_onemap.source(COUNTY_FIPS)


def state_category(parusecode: str | None, parusecd2: str | None = None) -> str | None:
    """FactLot category for a Wake land class (and main-building type and use), or ``None`` when out of scope.

    ``("COM", "34")`` → ``F1``; ``("IND", "83")`` → ``F2``; ``("APT", "07")`` → ``B``; ``("APT", "01")`` →
    ``None`` (a one-family house on an apartment-class parcel); ``("RHS", "")`` → ``None``.
    """
    return nc_onemap.state_category(COUNTY_FIPS, parusecode, parusecd2)


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per Wake parcel in scope (see :func:`nc_onemap.read_roll`)."""
    return nc_onemap.read_roll(path, COUNTY_FIPS, categories=categories)


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived Hub CSV export into a registry file (created if missing)."""
    return nc_onemap.build(snapshot_path, db_path, COUNTY_FIPS, as_of=as_of, retrieved_at=retrieved_at,
                           full_roll=full_roll)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.nc_wake", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived Hub CSV export (North_Carolina_Parcels_(Polygons).csv)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="data date, YYYY-MM-DD (the layer's transfdate, 2026-05-17 on the first run)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
