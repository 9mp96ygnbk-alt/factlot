"""District of Columbia zoning development standards (floor-area ratio and height per zone) → ``ParcelFacts``.

The DC Office of Zoning's *Zoning Development Standards* table (DC GIS, ``Planning_Landuse_and_Zoning_WebMercator``
map service layer 36; Open Data DC item ``8d10621514e544c0b5a1ef775e7e0263``; CC-BY-4.0) lists, for each zone of the
Zoning Regulations of 2016 and each building category, the floor-area ratio, height, lot occupancy and other
standards. Every column is text (``NULL``, ``N/A`` and prose such as ``See Subtitle K Chapter 402`` stand where no
single number applies). The ArcGIS ``query`` response (``f=json``, no geometry) is the file this adapter reads.

Two steps, both stated on each fact:

1. **Standards per zone.** Only plain numbers are read; prose and ``NULL`` are not parsed, so a zone whose standard is
   conditional gets no fact for it. Building category → predicate: ``Residential`` → ``zoning.max_far_residential``;
   ``Residential (IZ)`` (inclusionary zoning) → ``zoning.max_far_affordable_residential``; ``Non-Residential`` →
   ``zoning.max_far_nonresidential``; ``Institutional`` → ``zoning.max_far_facility``; ``Industrial`` →
   ``zoning.max_far_manufacturing``; ``All Other Buildings & Structures`` in an RA (apartment) zone, where it is the
   only listed category, → ``zoning.max_far_residential``. If a zone lists a category twice with different numbers,
   that predicate is skipped. ``zoning.max_height_ft`` is the greatest plain height among the zone's categories other
   than the special-use ones (institutional, church, military, library, accessory buildings); it is skipped when any of
   the remaining rows gives a height in prose (a rule that depends on the street's width, say).
2. **The rule that a district's standard applies to the parcel.** A parcel takes the standards of its
   ``zoning.district`` fact (the district found by overlaying its lot on the zoning map, ``dc_zoning``): zone names are
   compared with case, hyphens and spaces ignored (``R-1B`` and ``R-1-B``). A district with an overlay suffix
   (``RF-1/CAP``, ``MU-4/CHC``) takes the standards of its base zone before the first ``/``, which an overlay may
   change, so such a match has lower confidence. A district the table does not list (``NMU-4`` and the like) gets
   nothing.

The facts are FactLot's derivation from two public files, so each is ``inferred``: confidence is the
parcel's district confidence, at most 0.9 for an exact zone name and 0.6 for a base zone under an overlay. The fact
cites the standards file; the locator names the parcel's district, the matched zone and the row categories.

Usage: ``python -m factlot.registry.adapters.dc_zoning_standards standards.json registry.db --as-of 2026-11-03``
(the registry must already hold DC's zoning districts: ``dc_otr``, ``dc_zoning``).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..store import IngestStats, ParcelFacts, Registry, Source

STATE_FIPS = "11"
COUNTY_FIPS = "001"
SOURCE_ID = "dc-dcgis-zoning-standards"

SOURCE = Source(
    source_id=SOURCE_ID,
    publisher="District of Columbia Office of Zoning (DC GIS)",
    title="Zoning Regulations of 2016 Development Standards table",
    url="https://opendata.dc.gov/datasets/DCGIS::zoning-development-standards",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="CC-BY-4.0 (Open Data DC item 'Zoning Development Standards'); District terms for District data: the "
            "data on the sites is public domain under a CC0 1.0 dedication. The table summarises the Zoning "
            "Regulations of 2016 (11-DCMR); the regulations and the Office of Zoning are the authority.",
    ai_use="permitted",
    redistribution="attribution_required",
    attribution="District of Columbia Office of Zoning (DC GIS), Open Data DC",
    terms_reviewed="2026-11-04",
)

MAX_CONFIDENCE_EXACT = 0.9
MAX_CONFIDENCE_OVERLAY = 0.6

_CATEGORY_PREDICATE = {
    "residential": "zoning.max_far_residential",
    "residential (iz)": "zoning.max_far_affordable_residential",
    "non-residential": "zoning.max_far_nonresidential",
    "institutional": "zoning.max_far_facility",
    "industrial": "zoning.max_far_manufacturing",
}
_ALL_OTHER = "all other buildings & structures"
# Categories whose height is for a special use, not the zone's general height.
_SPECIAL_USE = re.compile(r"institutional|church|military|library|rec center|accessory", re.I)
_NUMBER = re.compile(r"^\d*\.?\d+$")


@dataclass
class Counts:
    zones_in_table: int = 0
    parcels_with_district: int = 0
    parcels_matched_exact: int = 0
    parcels_matched_base_zone: int = 0
    parcels_district_not_in_table: int = 0
    parcels_with_facts: int = 0
    unmatched_districts: dict[str, int] = field(default_factory=dict)
    facts: dict[str, int] = field(default_factory=dict)


def zone_key(name: str) -> str:
    """``'R-1-B'`` and ``'R-1B'`` both → ``'R1B'``."""
    return re.sub(r"[^A-Z0-9]", "", (name or "").upper())


def _number(s: object) -> int | float | None:
    t = str(s if s is not None else "").strip()
    if not _NUMBER.match(t):
        return None
    v = float(t)
    return int(v) if v == int(v) else round(v, 4)


def read_standards(path: str | Path) -> dict[str, dict[str, object]]:
    """``{zone key: {'zone': name, 'facts': {predicate: number}, 'rows': [categories]}}`` from the ArcGIS response."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = [f["attributes"] for f in data["features"]]
    by_zone: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if (r.get("ZONE") or "").strip():
            by_zone[zone_key(r["ZONE"])].append(r)
    out: dict[str, dict[str, object]] = {}
    for key, zone_rows in by_zone.items():
        names = {r["ZONE"].strip() for r in zone_rows}
        values: dict[str, set[int | float]] = defaultdict(set)
        only_all_other = all((r.get("BUILDING_CATEGORY") or "").strip().lower() == _ALL_OTHER for r in zone_rows)
        for r in zone_rows:
            cat = (r.get("BUILDING_CATEGORY") or "").strip().lower()
            predicate = _CATEGORY_PREDICATE.get(cat)
            if predicate is None and cat == _ALL_OTHER and only_all_other and key.startswith("RA") and key[2:3].isdigit():
                predicate = "zoning.max_far_residential"
            if predicate and (far := _number(r.get("FLOOR_AREA_RATIO"))) is not None and far > 0:
                values[predicate].add(far)
        facts: dict[str, int | float] = {p: next(iter(v)) for p, v in values.items() if len(v) == 1}
        general = [r for r in zone_rows if not _SPECIAL_USE.search(r.get("BUILDING_CATEGORY") or "")]
        heights = [_number(r.get("HEIGHT_FT")) for r in general]
        if general and all(h is not None and h > 0 for h in heights):
            facts["zoning.max_height_ft"] = max(h for h in heights if h is not None)
        if facts:
            out[key] = {"zone": sorted(names)[0], "facts": facts,
                        "rows": sorted({(r.get("BUILDING_CATEGORY") or "").strip() or "(none)" for r in zone_rows})}
    return out


def match(district: str, standards: dict[str, dict[str, object]]) -> tuple[dict[str, object], bool] | None:
    """``(standards, via_base_zone)`` for a parcel's district name, or ``None``."""
    if (s := standards.get(zone_key(district))) is not None:
        return s, False
    base = district.split("/", 1)[0]
    if base != district and (s := standards.get(zone_key(base))) is not None:
        return s, True
    return None


def registry_districts(db_path: str | Path) -> Iterator[tuple[str, str, float | None]]:
    """``(APN, district, confidence)`` for each DC parcel with a current ``zoning.district`` fact."""
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        yield from db.execute(
            "SELECT json_extract(a.value_json, '$'), json_extract(z.value_json, '$'), z.confidence "
            "FROM current_facts z JOIN current_facts a ON a.subject = z.subject AND a.predicate = 'parcel.apn' "
            "WHERE z.predicate = 'zoning.district' AND z.subject LIKE 'fl:parcel:us-11001:%' ORDER BY a.value_json")
    finally:
        db.close()


def read_parcels(standards: dict[str, dict[str, object]], districts: Iterator[tuple[str, str, float | None]],
                 counts: Counts) -> Iterator[ParcelFacts]:
    counts.zones_in_table = len(standards)
    unmatched: dict[str, int] = defaultdict(int)
    for apn, district, district_confidence in districts:
        counts.parcels_with_district += 1
        found = match(district, standards)
        if found is None:
            counts.parcels_district_not_in_table += 1
            unmatched[district] += 1
            continue
        std, via_base = found
        counts.parcels_matched_base_zone += via_base
        counts.parcels_matched_exact += not via_base
        cap = MAX_CONFIDENCE_OVERLAY if via_base else MAX_CONFIDENCE_EXACT
        confidence = round(min(cap, district_confidence if district_confidence is not None else cap), 2)
        facts = [(p, v, "ft" if p.endswith("_ft") else None) for p, v in sorted(std["facts"].items())]  # type: ignore[union-attr]
        for p, _v, _u in facts:
            counts.facts[p] = counts.facts.get(p, 0) + 1
        counts.parcels_with_facts += 1
        base_note = f"; base zone {std['zone']} of {district}, an overlay is not applied" if via_base else ""
        yield ParcelFacts(
            COUNTY_FIPS, apn, facts, method="inferred", confidence=confidence,
            locator=f"SSL {apn}: zoning district {district} takes the ZR16 standards of zone {std['zone']} "
                    f"(categories: {', '.join(std['rows'])}){base_note}")  # type: ignore[arg-type]
    counts.unmatched_districts = dict(sorted(unmatched.items(), key=lambda kv: -kv[1]))


def build(standards_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          counts: Counts | None = None) -> IngestStats:
    counts = counts if counts is not None else Counts()
    standards = read_standards(standards_path)
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE_ID, standards_path, as_of, retrieved_at)
        districts = list(registry_districts(db_path))
        return reg.ingest_parcel_facts(read_parcels(standards, iter(districts), counts), snap, state_fips=STATE_FIPS,
                                       full_roll=True)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.dc_zoning_standards", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("standards", help="the standards layer's ArcGIS query response (JSON) as archived by the collector")
    ap.add_argument("db", help="registry SQLite file that already holds DC parcels with zoning districts")
    ap.add_argument("--as-of", required=True, help="the layer's last-modified date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    counts = Counts()
    stats = build(args.standards, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, counts=counts)
    print(json.dumps({"ingest": asdict(stats), "reader": asdict(counts)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
