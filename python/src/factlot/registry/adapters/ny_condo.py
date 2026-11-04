"""New York City condominium unit lots inherit their building's PLUTO facts → ``ParcelFacts``.

PLUTO has one row per condominium *complex*, under its billing lot (lot 7501 and up), and none for the unit
lots (1001 and up) that the Department of Finance's roll lists as separate tax lots. So the commercial
condominium units in the registry (class ``R``) had no zoning or building facts. DOF's Digital Tax Map
publishes the mapping on NYC Open Data:

- **Digital Tax Map: Condominiums** (``p8u6-a6it``): ``condo_key`` → ``condo_billing_bbl`` (one row per condominium).
- **Digital Tax Map: Condominium Units** (``eguu-7ie3``): ``unit_bbl`` → ``condo_key`` (one row per unit lot).

For every unit lot the registry holds that has no PLUTO row of its own, whose condominium has a billing lot that
PLUTO lists, this adapter copies a subset of the billing lot's PLUTO facts to the unit:

- every ``zoning.*`` fact (the unit lies within the complex's zoning lot);
- ``parcel.num_floors`` (the tallest building of the complex), ``parcel.year_altered``,
  ``parcel.historic_district`` and ``parcel.landmark_designated``.

**Not inherited:** ``parcel.built_far``, ``parcel.num_buildings``, ``parcel.units_residential``,
``parcel.units_total``, ``parcel.area_by_use_sf`` and ``parcel.land_use_code``. They describe the whole complex
(areas, unit counts, its use), and stored on a unit they would read as the unit's own.

The inherited facts are **``inferred``**, with confidence 0.9, and say so in the locator: the unit lot, its
billing lot, the condominium key and the PLUTO version and line of the billing lot. They cite the units table
as their document; the billing lot's PLUTO file is named by a prefix of its document ID (the full ID is in the
``snapshots`` table of the PLUTO source). The fact's ``as_of`` is the PLUTO version's date, since that is
the date of the data described.

Usage: ``python -m factlot.registry.adapters.ny_condo units.csv condos.csv pluto.csv registry.db --as-of 2026-08-24``
(the registry must already hold the DOF roll and PLUTO's own facts: ``ny_nyc``, ``ny_pluto``).
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from pathlib import Path

from ..store import IngestStats, ParcelFacts, Registry, Source, file_document_id
from .ny_pluto import COUNTY_FIPS, STATE_FIPS, bbl, facts_of

SOURCE_ID = "ny-nyc-dof-condo"
CONFIDENCE = 0.9

SOURCE = Source(
    source_id=SOURCE_ID,
    publisher="New York City Department of Finance",
    title="Digital Tax Map: Condominiums and Condominium Units (unit lot to billing lot)",
    url="https://data.cityofnewyork.us/City-Government/Digital-Tax-Map-Condominium-Units/eguu-7ie3",
    state_fips=STATE_FIPS,
    county_fips=None,  # five counties; each record carries its own
    license="Published on NYC Open Data under the NYC Open Data Law (Admin. Code §23-502). NYC Open Data "
            "FAQ: 'Open Data belongs to all New Yorkers. There are no restrictions on the use of Open "
            "Data.' The facts copied from the billing lot are Department of City Planning PLUTO facts, "
            "which DCP provides for informational purposes only.",
    ai_use="unknown",  # not addressed by the publisher beyond 'no restrictions on the use'
    redistribution="permitted",  # no restrictions on use (FAQ)
    attribution="New York City Department of Finance, Digital Tax Map; New York City Department of City Planning (DCP), PLUTO",
    terms_reviewed="2026-11-04",
)

UNIT_COLUMNS = ("unit_bbl", "condo_key", "condo_base_bbl")
CONDO_COLUMNS = ("condo_key", "condo_base_bbl", "condo_billing_bbl")

# Predicates copied from the billing lot's row. Complex-wide totals are not (see the module docstring).
_INHERITED_EXACT = frozenset({"parcel.num_floors", "parcel.year_altered", "parcel.historic_district", "parcel.landmark_designated"})


def inherited(predicate: str) -> bool:
    return predicate.startswith("zoning.") or predicate in _INHERITED_EXACT


@dataclass
class Counts:
    units_in_table: int = 0
    units_without_billing_lot: int = 0
    units_with_own_pluto_row: int = 0
    units_billing_lot_not_in_pluto: int = 0
    units_inheriting: int = 0
    billing_lots_used: int = 0


def _rows(path: str | Path) -> Iterator[tuple[int, dict[str, str]]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().lower() for h in next(reader, [])]
        for n, values in enumerate(reader, 2):
            yield n, dict(zip(header, values))


def _bbl10(raw: str | None) -> str | None:
    key = bbl(raw)
    return key[1] if key else None


def read_condos(path: str | Path) -> dict[str, str]:
    """``condo_key`` → billing-lot BBL."""
    out: dict[str, str] = {}
    for _n, r in _rows(path):
        key, billing = (r.get("condo_key") or "").strip(), _bbl10(r.get("condo_billing_bbl"))
        if key and billing:
            out[key] = billing
    return out


def read_units(path: str | Path) -> Iterator[tuple[int, str, str]]:
    """``(line, unit BBL, condo_key)`` for each unit lot with a valid BBL."""
    for n, r in _rows(path):
        unit, key = _bbl10(r.get("unit_bbl")), (r.get("condo_key") or "").strip()
        if unit and key:
            yield n, unit, key


def read_pluto_rows(path: str | Path, wanted: set[str]) -> tuple[dict[str, tuple[int, list[tuple[str, object, str | None]], str]], set[str]]:
    """``({billing BBL: (line, inheritable facts, PLUTO version)}, every BBL PLUTO lists)`` for one PLUTO CSV."""
    found: dict[str, tuple[int, list[tuple[str, object, str | None]], str]] = {}
    listed: set[str] = set()
    for n, r in _rows(path):
        key = _bbl10(r.get("bbl"))
        if key is None:
            continue
        listed.add(key)
        if key in wanted and key not in found:
            facts = [f for f in facts_of(r) if inherited(f[0])]
            found[key] = (n, facts, " ".join((r.get("version") or "").split()))
    return found, listed


def read_inherited(units_path: str | Path, condos_path: str | Path, pluto_path: str | Path, *,
                   pluto_doc_prefix: str = "", counts: Counts | None = None) -> Iterator[ParcelFacts]:
    """Yield one ``ParcelFacts`` per unit lot that inherits something from its billing lot."""
    counts = counts if counts is not None else Counts()
    billing_of = read_condos(condos_path)
    units = list(read_units(units_path))
    found, listed = read_pluto_rows(pluto_path, set(billing_of.values()))
    used: set[str] = set()
    for n, unit, key in units:
        counts.units_in_table += 1
        billing = billing_of.get(key)
        if billing is None:
            counts.units_without_billing_lot += 1
            continue
        if unit in listed:  # the unit has a PLUTO row of its own: its facts are its own
            counts.units_with_own_pluto_row += 1
            continue
        row = found.get(billing)
        if row is None or not row[1]:
            counts.units_billing_lot_not_in_pluto += 1
            continue
        line, facts, version = row
        used.add(billing)
        counts.units_inheriting += 1
        county = COUNTY_FIPS[unit[0]]
        yield ParcelFacts(
            county, unit, list(facts), method="inferred", confidence=CONFIDENCE,
            locator=(f"BBL {unit}: condominium unit lot inherits from billing lot {billing} (condo {key}, units table line {n}); "
                     f"PLUTO {version} line {line} {pluto_doc_prefix}").rstrip())
    counts.billing_lots_used = len(used)


def build(units_path: str | Path, condos_path: str | Path, pluto_path: str | Path, db_path: str | Path, *,
          as_of: str, retrieved_at: str | None = None, counts: Counts | None = None) -> IngestStats:
    """Ingest the inherited facts into a registry that already holds the DOF roll (and PLUTO's own facts)."""
    counts = counts if counts is not None else Counts()
    doc, _size = file_document_id(pluto_path)
    prefix = f"({doc[:len('fl:document:sha256-') + 16]}…)"
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        reg.add_snapshot(SOURCE_ID, condos_path, as_of, retrieved_at)
        snap = reg.add_snapshot(SOURCE_ID, units_path, as_of, retrieved_at)
        return reg.ingest_parcel_facts(
            read_inherited(units_path, condos_path, pluto_path, pluto_doc_prefix=prefix, counts=counts),
            snap, state_fips=STATE_FIPS, full_roll=True)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_condo", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("units", help="Digital Tax Map: Condominium Units CSV (eguu-7ie3) as archived by the collector")
    ap.add_argument("condos", help="Digital Tax Map: Condominiums CSV (p8u6-a6it)")
    ap.add_argument("pluto", help="the PLUTO CSV the registry's PLUTO facts came from")
    ap.add_argument("db", help="registry SQLite file that already holds the DOF roll and PLUTO")
    ap.add_argument("--as-of", required=True, help="the PLUTO version's date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    counts = Counts()
    stats = build(args.units, args.condos, args.pluto, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, counts=counts)
    print(json.dumps({"ingest": asdict(stats), "reader": asdict(counts)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
