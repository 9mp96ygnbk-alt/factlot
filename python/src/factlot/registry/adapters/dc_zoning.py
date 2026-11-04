"""District of Columbia zoning map (DC Office of Zoning, via DC GIS) joined to DC lots → ``ParcelFacts``.

The District's tax roll (``dc_otr``) has no coordinates and no zoning, so the join is spatial, through the
lot's SSL (square, suffix, lot), the key both the roll and DC GIS use:

1. **Lot polygon.** The SSL of each in-scope parcel is looked up in DC GIS's *Record Lots* (layer 35) and
   *Tax Lots* (layer 39). A condominium unit has no polygon of its own (its SSL has a lot number of 2000
   or more): DC GIS's *Condo Relate* table (layer 52) names the underlying lot (``MAT_SSL``), and the
   unit takes that lot's polygon. Parcels with no polygon by either route (federal and possessory-interest
   lots, parcels, lots retired since the roll) get no zoning fact.
2. **Overlay.** Points are sampled across the lot (a 5 × 5 lattice over its bounding box, kept where inside the
   polygon, and a 12 × 12 lattice when those disagree; the outline's centroid when none falls inside) and each is located in the *Zoning
   Boundaries (Zoning Regulations of 2016)* polygons (layer 32) and the *Overlay Areas 2016* polygons
   (layer 6). A district's share of the lot is its share of the sampled points that fall in any district.
   The lot's district is the largest share; other districts with at least 10% of the points are listed as
   ``zoning.other_districts`` and mark the lot ``zoning.split_zone``; an overlay with at least 10% of the
   points is listed in ``zoning.special_district``.

The result is FactLot's own derivation from two public files, not a published fact, so each fact is
``inferred`` with a confidence: the district's share of the sampled points, at most 0.95 (sampling is not an
exact area computation, and a lot polygon is the City's tax-lot or record-lot boundary, not the zoning
administrator's determination). The fact cites the zoning file; the locator names the lot file(s)
and the number of points. Written, per lot:

- ``zoning.district`` (``ZONING``, the ZR16 district name: ``MU-4``, ``NMU-4/H-H``, ``R-3``),
  ``zoning.district_description`` (the publisher's ``ZONE_DESCRIPTION``), ``zoning.other_districts``,
  ``zoning.split_zone`` (only when true), ``zoning.special_district`` (``OVERLAY_NAME`` of each overlay).

Not read or stored: the Condo Relate table's owner, address and sale columns (they name natural persons;
only ``SSL`` and ``MAT_SSL`` are requested).

Usage::

    python -m factlot.registry.adapters.dc_zoning urls registry.db --kind lots|condos   # query URLs for the collector
    python -m factlot.registry.adapters.dc_zoning build registry.db --zoning z.geojson --overlays o.geojson \\
        --lots lots1.geojson ... --condos condo1.json ... --as-of 2026-11-04
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import urllib.parse
from collections import Counter
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelFacts, Registry, Source

STATE_FIPS = "11"
COUNTY_FIPS = "001"
SOURCE_ID = "dc-dcgis-zoning"

_BASE = "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA"
ZONING_LAYER = f"{_BASE}/Planning_Landuse_and_Zoning_WebMercator/MapServer/32"
OVERLAY_LAYER = f"{_BASE}/Planning_Landuse_and_Zoning_WebMercator/MapServer/6"
RECORD_LOTS_LAYER = f"{_BASE}/Property_and_Land_WebMercator/MapServer/35"
TAX_LOTS_LAYER = f"{_BASE}/Property_and_Land_WebMercator/MapServer/39"
CONDO_RELATE_LAYER = f"{_BASE}/Property_and_Land_WebMercator/MapServer/52"

SOURCE = Source(
    source_id=SOURCE_ID,
    publisher="District of Columbia Office of Zoning (via DC GIS and Open Data DC)",
    title="Zoning Boundaries (Zoning Regulations of 2016) and Overlay Areas 2016, joined to Record Lots and Tax Lots",
    url="https://opendata.dc.gov/datasets/DCGIS::zoning-boundaries-zoning-regulations-of-2016",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="CC-BY-4.0 (stated on the dataset pages: 'This work is licensed under a Creative Commons "
            "Attribution 4.0 International License'); District data terms: public domain, CC0 1.0 dedication "
            "unless otherwise noted",
    ai_use="permitted",  # CC-BY-4.0 permits any use with attribution; AI use is not addressed
    redistribution="attribution_required",
    attribution="District of Columbia Office of Zoning and Department of Buildings (DC GIS), Open Data DC "
                "(https://opendata.dc.gov)",
    terms_reviewed="2026-11-03",
)

MAX_CONFIDENCE = 0.95
SPLIT_SHARE = 0.10  # a district or overlay with at least this share of a lot's points counts for the lot
GRID = 12
COARSE_GRID = 5

ZONING_FIELDS = "ZONING,ZONING_STATUS,ZONE_DISTRICT,ZONE_DESCRIPTION"
LOT_FIELDS = "SSL,SQUARE,SUFFIX,LOT,STATUS"
BATCH = 100


# --- query URLs for the collector --------------------------------------------------------------------


def _geojson_url(layer: str, where: str, fields: str, *, geometry: bool = True) -> str:
    q = {"where": where, "outFields": fields, "f": "geojson" if geometry else "json"}
    if geometry:
        q.update({"outSR": "4326", "geometryPrecision": "7"})
    else:
        q["returnGeometry"] = "false"
    return layer + "/query?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def zoning_url() -> str:
    return _geojson_url(ZONING_LAYER, "1=1", ZONING_FIELDS)


def overlay_url() -> str:
    return _geojson_url(OVERLAY_LAYER, "1=1", "OVERLAY_NAME,OVERLAY_SHORT")


def raw_ssl(apn: str) -> str | None:
    """The SSL as DC GIS writes it (square, suffix padded to 4, lot) from a registry APN (spaces squeezed):
    ``'0123 0045'`` → ``'0123    0045'``, ``'0123E 0045'`` → ``'0123E   0045'``; ``None`` for SSLs of other shapes."""
    m = re.fullmatch(r"(\d{4})([A-Z]{0,4})\s*(\d{4})", apn.strip().upper())
    return f"{m[1]}{m[2].ljust(4)}{m[3]}" if m else None


def _batches(ssls: Iterable[str], size: int = BATCH) -> Iterator[list[str]]:
    batch: list[str] = []
    for s in sorted(set(ssls)):
        batch.append(s)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def _in_list(ssls: Sequence[str], column: str = "SSL") -> str:
    return f"{column} IN (" + ",".join(f"'{s}'" for s in ssls) + ")"


def lot_urls(ssls: Iterable[str]) -> list[str]:
    """Collector URLs for the lot polygons of these (raw) SSLs: record lots and tax lots, ``BATCH`` per request."""
    return [_geojson_url(layer, _in_list(b), LOT_FIELDS) for b in _batches(ssls) for layer in (RECORD_LOTS_LAYER, TAX_LOTS_LAYER)]


def condo_urls(ssls: Iterable[str]) -> list[str]:
    """Collector URLs for the condominium unit → underlying lot rows (``SSL``, ``MAT_SSL`` only)."""
    return [_geojson_url(CONDO_RELATE_LAYER, _in_list(b), "SSL,MAT_SSL", geometry=False) for b in _batches(ssls)]


def registry_ssls(db_path: str | Path) -> list[str]:
    """Raw SSLs of the DC parcels in a registry file (APNs of other shapes are left out)."""
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = db.execute(
            "SELECT json_extract(value_json, '$') FROM current_facts WHERE predicate = 'parcel.apn' "
            "AND subject LIKE 'fl:parcel:us-11001:%'")
        return [r for (a,) in rows if (r := raw_ssl(a))]
    finally:
        db.close()


# --- geometry -----------------------------------------------------------------------------------------

Ring = list[tuple[float, float]]
Polygon = list[Ring]  # first ring the outer boundary; later rings holes (the even-odd rule handles both)


def polygons_of(geometry: dict | None) -> list[Polygon]:
    """GeoJSON ``Polygon`` / ``MultiPolygon`` coordinates as lists of rings of ``(lon, lat)``."""
    if not geometry:
        return []
    coords = geometry.get("coordinates") or []
    kind = geometry.get("type")
    polys = [coords] if kind == "Polygon" else coords if kind == "MultiPolygon" else []
    return [[[(float(x), float(y)) for x, y, *_ in ring] for ring in poly] for poly in polys]


def _bbox(rings: Polygon) -> tuple[float, float, float, float]:
    xs = [x for ring in rings for x, _ in ring]
    ys = [y for ring in rings for _, y in ring]
    return min(xs), min(ys), max(xs), max(ys)


def point_in_polygon(x: float, y: float, rings: Polygon) -> bool:
    """Even-odd ray casting over all rings (holes included)."""
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def sample_points(polygons: list[Polygon], grid: int = GRID) -> list[tuple[float, float]]:  # noqa: C901
    """Points inside a lot: a ``grid`` × ``grid`` lattice over its bounding box kept where inside; when none is
    (a sliver), the centroid of the outer ring's vertices."""
    if not polygons:
        return []
    boxes = [_bbox(p) for p in polygons]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    points = []
    for i in range(grid):
        x = x0 + (x1 - x0) * (i + 0.5) / grid
        for j in range(grid):
            y = y0 + (y1 - y0) * (j + 0.5) / grid
            if any(point_in_polygon(x, y, p) for p in polygons):
                points.append((x, y))
    if not points:
        ring = polygons[0][0]
        pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
        points = [(sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts))]
    return points


class _Part:
    """One polygon (outer ring and holes) with its edges bucketed into horizontal bands, so a point is tested
    against the few edges that span its latitude rather than against every vertex of a district with 30,000."""

    BANDS = 64

    def __init__(self, rings: Polygon) -> None:
        self.x0, self.y0, self.x1, self.y1 = _bbox(rings)
        self.h = (self.y1 - self.y0) / self.BANDS or 1.0
        self.bands: list[list[tuple[float, float, float, float]]] = [[] for _ in range(self.BANDS)]
        for ring in rings:
            for (xa, ya), (xb, yb) in zip(ring, ring[1:] + ring[:1]):
                if ya == yb:
                    continue  # a horizontal edge never crosses a horizontal ray
                lo, hi = (ya, yb) if ya < yb else (yb, ya)
                for b in range(self._band(lo), self._band(hi) + 1):
                    self.bands[b].append((xa, ya, xb, yb))

    def _band(self, y: float) -> int:
        return min(self.BANDS - 1, max(0, int((y - self.y0) / self.h)))

    def contains(self, x: float, y: float) -> bool:
        if not (self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1):
            return False
        inside = False
        for xa, ya, xb, yb in self.bands[self._band(y)]:
            if (ya > y) != (yb > y) and x < (xb - xa) * (y - ya) / (yb - ya) + xa:
                inside = not inside
        return inside


class Layer:
    """Polygons with attributes, indexed on a coarse grid so a point finds its polygon quickly."""

    CELL = 0.002  # degrees, about 200 m

    def __init__(self, features: Iterable[tuple[dict, list[Polygon]]]) -> None:
        self.items: list[tuple[dict, list[_Part]]] = []
        self.cells: dict[tuple[int, int], list[int]] = {}
        for props, polys in features:
            parts = [_Part(p) for p in polys if p]
            if not parts:
                continue
            k = len(self.items)
            self.items.append((props, parts))
            x0, y0 = min(q.x0 for q in parts), min(q.y0 for q in parts)
            x1, y1 = max(q.x1 for q in parts), max(q.y1 for q in parts)
            for cx in range(int(x0 // self.CELL), int(x1 // self.CELL) + 1):
                for cy in range(int(y0 // self.CELL), int(y1 // self.CELL) + 1):
                    self.cells.setdefault((cx, cy), []).append(k)

    def at(self, x: float, y: float) -> list[dict]:
        """Attributes of every polygon containing the point."""
        out = []
        for k in self.cells.get((int(x // self.CELL), int(y // self.CELL)), ()):
            props, parts = self.items[k]
            if any(part.contains(x, y) for part in parts):
                out.append(props)
        return out


def _features(path: str | Path) -> Iterator[tuple[dict, list[Polygon]]]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for feat in data.get("features", []):
        yield feat.get("properties") or {}, polygons_of(feat.get("geometry"))


def read_layer(path: str | Path) -> Layer:
    return Layer(_features(path))


# --- the join -----------------------------------------------------------------------------------------


def _text(s: object) -> str:
    return " ".join(str(s or "").split())


def _ssl_key(s: object) -> str:
    return re.sub(r"\s+", "", str(s or "")).upper()


def _apn(s: object) -> str:
    return _text(s)  # the registry's APN: the SSL with runs of spaces squeezed (dc_otr)


def read_lots(paths: Iterable[str | Path]) -> dict[str, tuple[list[Polygon], str]]:
    """``{SSL key: (polygons, file name)}`` from lot GeoJSON files; the first file that has an SSL wins."""
    lots: dict[str, tuple[list[Polygon], str]] = {}
    for path in paths:
        for props, polys in _features(path):
            key = _ssl_key(props.get("SSL"))
            if key and polys and key not in lots:
                lots[key] = (polys, Path(path).name)
    return lots


def read_condo_units(paths: Iterable[str | Path]) -> dict[str, str]:
    """``{unit SSL key: underlying lot SSL key}`` from Condo Relate query results (``SSL`` and ``MAT_SSL`` only)."""
    out: dict[str, str] = {}
    for path in paths:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for feat in data.get("features", []):
            a = feat.get("attributes") or feat.get("properties") or {}
            unit, lot = _ssl_key(a.get("SSL")), _ssl_key(a.get("MAT_SSL"))
            if unit and lot and unit != lot:
                out[unit] = lot
    return out


def facts_for_lot(polygons: list[Polygon], zoning: Layer, overlays: Layer | None) -> tuple[list[tuple[str, object, str | None]], float | None, int]:
    """``(facts, confidence, points)`` for a lot polygon; no facts when no sampled point is in a district."""
    # A coarse lattice first: a lot whose 5 x 5 points all fall in one district and the same overlays is
    # taken as lying in them; any disagreement (or a point outside every district) is resampled finely.
    for grid in (COARSE_GRID, GRID):
        points = sample_points(polygons, grid)
        shares: Counter = Counter()
        descriptions: dict[str, str] = {}
        overlay_hits: Counter = Counter()
        signatures = set()
        for x, y in points:
            names = set()
            for z in zoning.at(x, y)[:1]:
                name = _text(z.get("ZONING"))
                if name:
                    shares[name] += 1
                    descriptions.setdefault(name, _text(z.get("ZONE_DESCRIPTION")))
                    names.add(name)
            hits = frozenset(n for o in (overlays.at(x, y) if overlays is not None else []) if (n := _text(o.get("OVERLAY_NAME"))))
            for n in hits:
                overlay_hits[n] += 1
            signatures.add((frozenset(names), hits))
        if len(signatures) == 1 and shares:
            break
    total = sum(shares.values())
    if not total:
        return [], None, len(points)
    ranked = sorted(shares.items(), key=lambda kv: (-kv[1], kv[0]))
    district, top = ranked[0]
    facts: list[tuple[str, object, str | None]] = [("zoning.district", district, None)]
    if descriptions.get(district):
        facts.append(("zoning.district_description", descriptions[district], None))
    others = [name for name, n in ranked[1:] if n / total >= SPLIT_SHARE]
    if others:
        facts.append(("zoning.other_districts", others, None))
        facts.append(("zoning.split_zone", True, None))
    special = sorted(name for name, n in overlay_hits.items() if n / len(points) >= SPLIT_SHARE)
    if special:
        facts.append(("zoning.special_district", special, None))
    return facts, round(min(MAX_CONFIDENCE, top / total), 2), len(points)


def read_zoning(zoning_path: str | Path, lot_paths: Iterable[str | Path], *, overlay_path: str | Path | None = None,
                condo_paths: Iterable[str | Path] = (), lot_docs: dict[str, str] | None = None,
                overlay_doc: str | None = None) -> Iterator[ParcelFacts]:
    """Yield one ``ParcelFacts`` per lot polygon, and one per condominium unit whose underlying lot has one.

    ``lot_docs`` maps a lot file name to its document ID, and ``overlay_doc`` is the overlay file's, so the
    locator can cite the files the polygon and the overlays came from.
    """
    zoning = read_layer(zoning_path)
    overlays = read_layer(overlay_path) if overlay_path else None
    lots = read_lots(lot_paths)
    docs = lot_docs or {}
    cache: dict[str, tuple[list[tuple[str, object, str | None]], float | None, int]] = {}

    def result(key: str):
        if key not in cache:
            cache[key] = facts_for_lot(lots[key][0], zoning, overlays)
        return cache[key]

    def cite(file: str) -> str:
        return docs.get(file) or file

    ov = f" and overlays {overlay_doc}" if overlay_doc else ""

    for key, (polys, file) in lots.items():
        facts, conf, n = result(key)
        if facts:
            yield ParcelFacts(COUNTY_FIPS, _apn(_display(key)), facts, method="inferred", confidence=conf,
                              locator=f"SSL {_display(key)}: lot polygon in {cite(file)} overlaid on the zoning map{ov} ({n} sample points)")
    for unit, lot in read_condo_units(condo_paths).items():
        if lot in lots and unit not in lots:
            facts, conf, n = result(lot)
            if facts:
                file = lots[lot][1]
                yield ParcelFacts(COUNTY_FIPS, _apn(_display(unit)), facts, method="inferred", confidence=conf,
                                  locator=(f"SSL {_display(unit)}: condominium unit, polygon of underlying lot {_display(lot)} "
                                           f"in {cite(file)} (DC GIS Condo Relate) overlaid on the zoning map{ov} ({n} sample points)"))


def _display(key: str) -> str:
    """SSL key (no spaces) → registry APN form: square, optional suffix, one space, lot: ``01230045`` → ``0123 0045``."""
    m = re.fullmatch(r"(\d{4})([A-Z]{0,4})(\d{4})", key)
    return f"{m[1]}{m[2]} {m[3]}" if m else key


def build(db_path: str | Path, zoning_path: str | Path, lot_paths: Sequence[str | Path], *, as_of: str,
          overlay_path: str | Path | None = None, condo_paths: Sequence[str | Path] = (),
          retrieved_at: str | None = None, full_roll: bool = False) -> IngestStats:
    """Add zoning facts to the DC parcels in a registry file. The snapshot is the zoning file; the lot files are
    registered as snapshots of the same source so the locator's document IDs are real citations."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, zoning_path, as_of, retrieved_at)
        # The files the locators cite are registered as snapshots too, so each document ID resolves.
        lot_docs = {Path(p).name: reg.add_snapshot(SOURCE.source_id, p, as_of, retrieved_at).document_id for p in lot_paths}
        for p in condo_paths:
            reg.add_snapshot(SOURCE.source_id, p, as_of, retrieved_at)
        overlay_doc = reg.add_snapshot(SOURCE.source_id, overlay_path, as_of, retrieved_at).document_id if overlay_path else None
        records = read_zoning(zoning_path, lot_paths, overlay_path=overlay_path, condo_paths=condo_paths,
                              lot_docs=lot_docs, overlay_doc=overlay_doc)
        return reg.ingest_parcel_facts(records, snap, state_fips=STATE_FIPS, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.dc_zoning", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("urls", help="print collector URLs")
    u.add_argument("db")
    u.add_argument("--kind", choices=["zoning", "lots", "condos"], required=True)
    u.add_argument("--ssl-file", help="condos: JSON list of raw SSLs to look up (default: the registry's)")
    b = sub.add_parser("build", help="add zoning facts to a registry")
    b.add_argument("db")
    b.add_argument("--zoning", required=True)
    b.add_argument("--overlays")
    b.add_argument("--lots", nargs="+", required=True)
    b.add_argument("--condos", nargs="*", default=[])
    b.add_argument("--as-of", required=True)
    b.add_argument("--retrieved-at")
    args = ap.parse_args(argv)
    if args.cmd == "urls":
        if args.kind == "zoning":
            urls = [zoning_url(), overlay_url()]
        else:
            ssls = json.load(open(args.ssl_file)) if args.ssl_file else registry_ssls(args.db)
            urls = lot_urls(ssls) if args.kind == "lots" else condo_urls(ssls)
        print("\n".join(urls))
        return 0
    stats = build(args.db, args.zoning, args.lots, as_of=args.as_of, overlay_path=args.overlays,
                  condo_paths=args.condos, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
