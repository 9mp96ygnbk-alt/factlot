"""A city's zoning districts joined to parcels by the parcel's own coordinates → ``ParcelFacts``.

Some assessor files carry a coordinate for each parcel but no zoning, and the city publishes a zoning map as
polygons. This adapter locates each parcel's point in the zoning polygons (the point-in-polygon code of
``dc_zoning``) and writes the district it falls in. It is a *point* join, not the polygon overlay ``dc_zoning`` does:
the point is whatever the assessor's file gives (a label point or centroid), so a lot a zoning boundary splits gets
one district, and a point near a boundary can land on the wrong side.

Facts per parcel, **``inferred``** with confidence 0.8: ``zoning.district`` (the polygon's district code) and
``zoning.district_description`` (the polygon's name for it). The fact cites the zoning file; its locator names the
parcel, the point, the polygon and the points file by document ID (that file is already a snapshot of the assessor
source in the registry, so the ID resolves). A parcel whose point lies in no polygon (outside the city that publishes
the map) gets nothing; a point in two polygons (overlapping features) gets nothing, since the file does not say which
governs.

Configured cities (``CITIES``): Minneapolis / Hennepin County, MN (zoning: MapIT Minneapolis *Planning Primary
Zoning*, CC0 1.0; points: the county's ``County_Parcels.csv``, columns ``PID``, ``LAT``, ``LON``).

Usage: ``python -m factlot.registry.adapters.zoning_points minneapolis zoning.geojson County_Parcels.csv registry.db --as-of 2026-10-30``
(the registry must already hold the county's parcels: ``mn_hennepin``).
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..store import IngestStats, ParcelFacts, Registry, Source, file_document_id
from .dc_zoning import Layer, polygons_of

CONFIDENCE = 0.8


@dataclass(frozen=True)
class City:
    key: str
    state_fips: str
    county_fips: str
    id_column: str
    lat_column: str
    lon_column: str
    code_field: str
    description_field: str
    source: Source


MINNEAPOLIS = City(
    key="minneapolis", state_fips="27", county_fips="053", id_column="PID", lat_column="LAT", lon_column="LON",
    code_field="Land_Use_Code", description_field="Land_Use",
    source=Source(
        source_id="mn-minneapolis-planning-zoning",
        publisher="City of Minneapolis, MapIT Minneapolis",
        title="Planning Primary Zoning",
        url="https://opendata.minneapolismn.gov/datasets/cityoflakes::planning-primary-zoning",
        state_fips="27",
        county_fips="053",
        license="CC0 1.0 Universal (Minneapolis Open Data item 'Planning Primary Zoning'). The City's zoning map is "
                "the authority; this layer is a copy for information.",
        ai_use="permitted",
        redistribution="permitted",
        attribution="City of Minneapolis, MapIT Minneapolis, Planning Primary Zoning",
        terms_reviewed="2026-11-04",
    ),
)
CITIES = {MINNEAPOLIS.key: MINNEAPOLIS}


@dataclass
class Counts:
    zoning_polygons: int = 0
    points_read: int = 0
    points_without_coordinates: int = 0
    points_in_no_polygon: int = 0
    points_in_several_polygons: int = 0
    parcels_with_district: int = 0
    districts: dict[str, int] = field(default_factory=dict)


def _text(s: object) -> str:
    return " ".join(str(s or "").split())


def read_zoning(path: str | Path, city: City) -> tuple[Layer, int]:
    """The zoning polygons (GeoJSON, WGS84) as a ``dc_zoning.Layer`` keyed by district code, and how many there are."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    feats: list[tuple[dict, list]] = []
    for n, feat in enumerate(data.get("features", []), 1):
        props = feat.get("properties") or {}
        code = _text(props.get(city.code_field))
        if not code:
            continue
        feats.append(({"code": code, "name": _text(props.get(city.description_field)),
                       "feature": props.get("OBJECTID", n)}, polygons_of(feat.get("geometry"))))
    return Layer(feats), len(feats)


def read_points(path: str | Path, city: City) -> Iterator[tuple[int, str, float | None, float | None]]:
    """``(line, id, lat, lon)`` for each row of the points file; the first row of an ID wins."""
    csv.field_size_limit(1 << 30)
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader, [])]
        index = {h: i for i, h in enumerate(header)}
        want = [index.get(c) for c in (city.id_column, city.lat_column, city.lon_column)]
        if None in want:
            raise ValueError(f"{path}: missing one of {city.id_column}, {city.lat_column}, {city.lon_column}")
        for n, row in enumerate(reader, 2):
            ident = _text(row[want[0]]) if want[0] < len(row) else ""
            if not ident or ident in seen:
                continue
            seen.add(ident)
            yield n, ident, _float(row, want[1]), _float(row, want[2])


def _float(row: list[str], i: int) -> float | None:
    try:
        v = float(row[i])
    except (ValueError, IndexError):
        return None
    return v if v != 0 else None


def read_parcels(layer: Layer, points: Iterator[tuple[int, str, float | None, float | None]], city: City, *,
                 zoning_name: str, points_doc: str, counts: Counts) -> Iterator[ParcelFacts]:
    for n, ident, lat, lon in points:
        counts.points_read += 1
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            counts.points_without_coordinates += 1
            continue
        hits = layer.at(lon, lat)
        if not hits:
            counts.points_in_no_polygon += 1
            continue
        if len({h["code"] for h in hits}) > 1:
            counts.points_in_several_polygons += 1
            continue
        hit = hits[0]
        counts.parcels_with_district += 1
        counts.districts[hit["code"]] = counts.districts.get(hit["code"], 0) + 1
        facts: list[tuple[str, object, str | None]] = [("zoning.district", hit["code"], None)]
        if hit["name"]:
            facts.append(("zoning.district_description", hit["name"], None))
        yield ParcelFacts(
            city.county_fips, ident, facts, method="inferred", confidence=CONFIDENCE,
            locator=f"{city.id_column} {ident}: point ({lat:.6f}, {lon:.6f}) from line {n} of {points_doc} lies in "
                    f"{zoning_name} feature {hit['feature']}")


def build(city: City, zoning_path: str | Path, points_path: str | Path, db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None, counts: Counts | None = None) -> IngestStats:
    counts = counts if counts is not None else Counts()
    layer, counts.zoning_polygons = read_zoning(zoning_path, city)
    points_doc, _size = file_document_id(points_path)
    reg = Registry(db_path)
    try:
        reg.add_source(city.source)
        snap = reg.add_snapshot(city.source.source_id, zoning_path, as_of, retrieved_at)
        return reg.ingest_parcel_facts(
            read_parcels(layer, read_points(points_path, city), city, zoning_name=Path(zoning_path).name,
                         points_doc=points_doc, counts=counts),
            snap, state_fips=city.state_fips, full_roll=True)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.zoning_points", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("city", choices=sorted(CITIES))
    ap.add_argument("zoning", help="the zoning layer as GeoJSON, as archived by the collector")
    ap.add_argument("points", help="the assessor file with a coordinate per parcel (the file the registry's parcels came from)")
    ap.add_argument("db", help="registry SQLite file that already holds the county's parcels")
    ap.add_argument("--as-of", required=True, help="the zoning layer's last-edit date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    counts = Counts()
    stats = build(CITIES[args.city], args.zoning, args.points, args.db, as_of=args.as_of,
                  retrieved_at=args.retrieved_at, counts=counts)
    print(json.dumps({"ingest": asdict(stats), "reader": asdict(counts)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
