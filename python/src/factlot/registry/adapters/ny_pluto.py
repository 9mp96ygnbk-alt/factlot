"""New York City Department of City Planning: PLUTO (Primary Land Use Tax Lot Output) → ``ParcelFacts``.

PLUTO is DCP's tax-lot file: one row per tax lot (one per condominium complex, under its billing
lot), built from the Department of Finance roll plus DCP's zoning, landmark and land-use layers. The
registry already holds the commercial, industrial and multifamily lots from the DOF roll
(``ny_nyc``); this adapter adds what the roll lacks, to the lots that match by borough-block-lot
(BBL), and never creates a parcel.

Layout (confirmed on version 26v2, NYC Open Data dataset ``64uk-42ks``, 2026-11-03): a UTF-8 CSV with
a lower-case header row, as exported by the Socrata ``/resource/64uk-42ks.csv`` endpoint with a
``$select`` of the columns used below (the full file also carries a lot polygon in ``geom``, owner
names in ``ownername`` and many administrative codes, none of which are read or stored). The same
columns, in any case, make up the ``pluto.csv`` of DCP's own Bytes of the Big Apple release.
``bbl`` is written as a decimal (``1000010010.00000000``).

Facts written (all ``public_record``, all cited to the file and the BBL):

- ``zoning.district`` (``zonedist1``) and ``zoning.other_districts`` (``zonedist2``-``4``, a list, only
  for lots split by a district boundary), ``zoning.commercial_overlay`` (``overlay1``-``2``),
  ``zoning.special_district`` (``spdist1``-``3``), ``zoning.limited_height_district``,
  ``zoning.split_zone`` (true when DCP flags the lot as split by a zoning boundary),
  ``zoning.e_designation`` (``edesignum``).
- ``zoning.max_far_residential``, ``_commercial``, ``_facility``, ``_manufacturing`` and
  ``_affordable_residential``: the maximum floor-area ratios the zoning allows (``residfar``,
  ``commfar``, ``facilfar``, ``mnffar``, ``affresfar``). A ratio of 0 means DCP lists none and is
  not stored.
- ``parcel.built_far`` (``builtfar``), ``parcel.num_buildings`` (``numbldgs``), ``parcel.num_floors``
  (``numfloors``: the floors of the tallest building on the lot), ``parcel.units_residential`` and
  ``parcel.units_total``, ``parcel.area_by_use_sf`` (``comarea``, ``resarea``, ``officearea``,
  ``retailarea``, ``garagearea``, ``strgearea``, ``factryarea``, ``otherarea``: an object of the
  positive ones), ``parcel.land_use_code`` (DCP's 2-digit land use category), ``parcel.year_altered``
  (the later of ``yearalter1`` and ``yearalter2``), ``parcel.historic_district`` (``histdist``, the
  district's name) and ``parcel.landmark_designated`` (true when ``landmark`` is filled in; the
  designation's name is not stored, since some are named for people).

Not written, because the DOF roll already supplies them under ``parcel.land_area_sf``,
``parcel.improvement_area_sf`` and ``parcel.year_built`` (PLUTO's ``lotarea``, ``bldgarea`` and
``yearbuilt`` are DOF's figures, so a second copy would only be a second source for the same number):
lot area, building area, year built. Owner fields are never read.

Usage: ``python -m factlot.registry.adapters.ny_pluto 64uk-42ks.csv registry.db --as-of 2026-08-24``
(the registry must already hold the DOF roll: ``ny_nyc``).
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelFacts, Registry, Source

STATE_FIPS = "36"
# Borough digit of the BBL → county FIPS (1 Manhattan = New York, 2 Bronx, 3 Brooklyn = Kings,
# 4 Queens, 5 Staten Island = Richmond); the same table as the DOF roll's.
COUNTY_FIPS = {"1": "061", "2": "005", "3": "047", "4": "081", "5": "085"}

SOURCE = Source(
    source_id="ny-nyc-dcp-pluto",
    publisher="New York City Department of City Planning",
    title="Primary Land Use Tax Lot Output (PLUTO)",
    url="https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks",
    state_fips=STATE_FIPS,
    county_fips=None,  # five counties; each record carries its own
    license="Published on NYC Open Data under the NYC Open Data Law (Admin. Code §23-502). NYC Open Data "
            "FAQ: 'Open Data belongs to all New Yorkers. There are no restrictions on the use of Open "
            "Data.' DCP provides PLUTO for informational purposes only and does not warrant its "
            "completeness, accuracy or fitness for any purpose.",
    ai_use="unknown",  # not addressed by the publisher beyond 'no restrictions on the use'
    redistribution="permitted",  # no restrictions on use (FAQ)
    attribution="New York City Department of City Planning (DCP), PLUTO",
    terms_reviewed="2026-11-03",
)

# Columns the download asks for (the Socrata $select); the adapter reads nothing else.
COLUMNS = (
    "bbl", "zonedist1", "zonedist2", "zonedist3", "zonedist4", "overlay1", "overlay2", "spdist1",
    "spdist2", "spdist3", "ltdheight", "splitzone", "landuse", "comarea", "resarea", "officearea", "retailarea", "garagearea", "strgearea", "factryarea",
    "otherarea", "numbldgs", "numfloors", "unitsres", "unitstotal", "yearalter1", "yearalter2",
    "histdist", "landmark", "builtfar", "residfar", "commfar", "facilfar", "mnffar", "affresfar",
    "edesignum", "version", "zoningdate",
)

_AREA_BY_USE = (
    ("commercial", "comarea"), ("residential", "resarea"), ("office", "officearea"),
    ("retail", "retailarea"), ("garage", "garagearea"), ("storage", "strgearea"),
    ("factory", "factryarea"), ("other", "otherarea"),
)
_FAR = (
    ("zoning.max_far_residential", "residfar"), ("zoning.max_far_commercial", "commfar"),
    ("zoning.max_far_facility", "facilfar"), ("zoning.max_far_manufacturing", "mnffar"),
    ("zoning.max_far_affordable_residential", "affresfar"),
)


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, ratios, counts and years: 0 or blank means DCP lists none, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _clean(v: float) -> int | float:
    """``6.0`` → ``6``; ``2.5`` stays; ratios are rounded to the 2 decimals DCP publishes."""
    v = round(v, 4)
    return int(v) if v == int(v) else v


def bbl(raw: str | None) -> tuple[str, str] | None:
    """``('061', '1000010010')`` for ``'1000010010.00000000'``; ``None`` when it is not a BBL."""
    head = (raw or "").strip().split(".")[0]
    if len(head) != 10 or not head.isdigit() or head[0] not in COUNTY_FIPS:
        return None
    return COUNTY_FIPS[head[0]], head


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def _text_list(*values: str | None) -> list[str]:
    out: list[str] = []
    for v in values:
        t = _text(v)
        if t and t not in out:
            out.append(t)
    return out


def facts_of(row: dict[str, str]) -> list[tuple[str, object, str | None]]:
    """The ``(predicate, value, unit)`` facts one PLUTO row yields."""
    g = lambda k: row.get(k)  # noqa: E731
    out: list[tuple[str, object, str | None]] = []
    districts = _text_list(g("zonedist1"), g("zonedist2"), g("zonedist3"), g("zonedist4"))
    if districts:
        out.append(("zoning.district", districts[0], None))
        if len(districts) > 1:
            out.append(("zoning.other_districts", districts[1:], None))
    for predicate, values in (
        ("zoning.commercial_overlay", _text_list(g("overlay1"), g("overlay2"))),
        ("zoning.special_district", _text_list(g("spdist1"), g("spdist2"), g("spdist3"))),
    ):
        if values:
            out.append((predicate, values, None))
    if _text(g("ltdheight")):
        out.append(("zoning.limited_height_district", _text(g("ltdheight")), None))
    if _text(g("splitzone")).upper() in {"Y", "YES", "TRUE"}:  # Socrata writes the flag true/false
        out.append(("zoning.split_zone", True, None))
    if _text(g("edesignum")):
        out.append(("zoning.e_designation", _text(g("edesignum")), None))
    for predicate, col in _FAR:
        if (v := _positive(g(col))) is not None:
            out.append((predicate, _clean(v), None))
    if (v := _positive(g("builtfar"))) is not None:
        out.append(("parcel.built_far", _clean(v), None))
    for predicate, col in (("parcel.num_buildings", "numbldgs"), ("parcel.num_floors", "numfloors"),
                           ("parcel.units_residential", "unitsres"), ("parcel.units_total", "unitstotal")):
        if (v := _positive(g(col))) is not None:
            out.append((predicate, _clean(v), None))
    areas = {name: _clean(v) for name, col in _AREA_BY_USE if (v := _positive(g(col))) is not None}
    if areas:
        out.append(("parcel.area_by_use_sf", areas, "sf"))
    if _text(g("landuse")):
        out.append(("parcel.land_use_code", _text(g("landuse")).zfill(2), None))
    altered = [v for col in ("yearalter1", "yearalter2") if (v := _positive(g(col))) is not None]
    if altered:
        out.append(("parcel.year_altered", int(max(altered)), None))
    if _text(g("histdist")):
        out.append(("parcel.historic_district", _text(g("histdist")), None))
    if _text(g("landmark")):
        out.append(("parcel.landmark_designated", True, None))
    return out


def read_pluto(path: str | Path) -> Iterator[ParcelFacts]:
    """Yield one ``ParcelFacts`` per PLUTO row with a valid BBL, in file order (a lot listed twice is
    yielded twice). Rows without a BBL, and rows that yield no fact, are skipped."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().lower() for h in next(reader, [])]
        for n, values in enumerate(reader, 2):
            row = dict(zip(header, values))
            key = bbl(row.get("bbl"))
            if key is None:
                continue
            facts = facts_of(row)
            if not facts:
                continue
            version = _text(row.get("version"))
            county, number = key
            yield ParcelFacts(county, number, facts, locator=f"line {n} BBL {number}" + (f" (PLUTO {version})" if version else ""))


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived PLUTO CSV into a registry file that already holds the DOF roll."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcel_facts(read_pluto(snapshot_path), snap, state_fips=STATE_FIPS, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_pluto", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="PLUTO CSV as archived by the collector")
    ap.add_argument("db", help="registry SQLite file that already holds the DOF roll")
    ap.add_argument("--as-of", required=True, help="date the file describes, YYYY-MM-DD (the dataset's 'data last updated')")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
