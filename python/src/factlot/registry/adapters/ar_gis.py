"""Arkansas: Arkansas GIS Office statewide cadastre (county assessor CAMA attributes) → ``ParcelRecord``.

Source: the Arkansas Geographic Information Systems Office (AGISO) statewide parcel publication, ArcGIS feature
service ``FEATURESERVICES/Planning_Cadastre/FeatureServer`` layer 0 ``PARCEL_CENTROID_CAMP`` on gis.arkansas.gov (the
polygon layer, 6, carries the same attributes): one record per tax parcel, populated from each county assessor's CAMA
system, conforming to the Arkansas Digital Cadastral Mapping Standard. The collector archives pages of a filtered query
(``f=json``, ``returnGeometry=false``, ``objectid`` order, at most 200 features per page; ``maxRecordCount`` is 200) for
``parceltype`` in CI, II. Layout confirmed against the live layer, 2026-11-03. Field names are lower case in the service.

- ``countyfips`` (3 digits; the state is 05), ``parcelid`` — the county's parcel number; ``countyid`` is
  ``<countyfips>-<parcelid>``. The key is ``(countyfips, parcelid)``; a repeated key (condominium and multi-card
  records) collapses to the first.
- ``ownername`` — owner of record (``DAVIS, JIMMY & DIANE``; the registry drops natural persons). The layer has **no owner
  mailing address and no confidentiality flag**.
- ``adrlabel`` (``94  CENTRAL AVE E``), ``adrcity``, ``adrzip5`` (an integer; 0 means none) — the physical address.
- ``parceltype`` — the two-letter property type code. The Cadastral Mapping Standard (SS-40, revised 2004-05-14,
  http://www.gis.arkansas.gov/Docs/CAMP/Cad_standard_FINAL.pdf) defines ``CI`` Commercial Improved, ``CM`` Commercial
  Miscellaneous, ``CV`` Commercial Vacant, ``II`` Industrial Improved, ``IM``, ``IV`` ... Mapped here: ``CI`` → F1, ``II`` → F2.
  The 2019 revision says the list of approved codes is held by the Arkansas Assessment Coordination Department and
  county-specific, so codes the 2004 table does not define (``CR``, ``CG``, ``CA``, ``CP``, ``CB``, ``IF``, ``IA``,
  ``IG`` ...) are not mapped, and apartments have no code of their own (they sit inside ``CI``).
- ``totalvalue`` (= ``landvalue`` + ``impvalue``) the county's appraised market value; ``assessvalue`` the assessed value
  (20% of it), not stored. ``camadate`` / ``pubdate`` (epoch milliseconds) the CAMA receipt and publication dates.

Usage: ``python -m factlot.registry.adapters.ar_gis collected/ar-gis-parcels registry.db --as-of 2026-11-03``
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
from .arcgis_pages import features, pages, positive, squeeze

STATE_FIPS = "05"
ACCOUNT_SYSTEM = "ar_countyid"

SOURCE = Source(
    source_id="ar-gis-parcels",
    publisher="Arkansas Geographic Information Systems Office (AGISO), with the county assessors",
    title="Arkansas statewide parcels with CAMA attributes (Planning_Cadastre PARCEL_CENTROID_CAMP)",
    url="https://gis.arkansas.gov/",
    state_fips=STATE_FIPS,
    license="No licence; the metadata's 'Distribution liability' is a warranty disclaimer ('provided \"as is\" without warranty "
            "of any kind'). Published under Arkansas Code 15-21-502 as a statewide resource for digital cadastral data",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # disclaimer only; free public download, no restriction stated
    attribution="Arkansas Geographic Information Systems Office and the Arkansas county assessors",
    terms_reviewed="2026-11-03",
)

CATEGORY = {"CI": "F1", "II": "F2"}


def state_category(parceltype: object) -> str | None:
    """FactLot category for an Arkansas property type code: CI → F1, II → F2; every other code ``None``."""
    return CATEGORY.get(squeeze(parceltype).upper())


def _situs(a: dict) -> str | None:
    street = squeeze(a.get("adrlabel"))
    if not street:
        return None
    city = squeeze(a.get("adrcity"))
    zip5 = f"{int(a['adrzip5']):05d}" if positive(a.get("adrzip5")) else ""
    rest = " ".join(x for x in (city, "AR", zip5) if x)
    return f"{street}, {rest}"


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[tuple[str, str]] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel of one archived page (a repeated county parcel id is skipped)."""
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in features(page):
        county = squeeze(a.get("countyfips"))
        pid = squeeze(a.get("parcelid"))
        if not county or not pid or (county, pid) in seen:
            continue
        category = state_category(a.get("parceltype"))
        if not keep(category):
            continue
        seen.add((county, pid))
        name = squeeze(a.get("ownername")) or None
        yield ParcelRecord(
            county_fips=county,
            apn=pid,
            state_category=category,
            account=squeeze(a.get("countyid")) or f"{county}-{pid}",
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=None,  # the layer has no owner mailing address
            owner_confidential=False,
            land_area_sf=None,  # the layer has no acreage
            improvement_area_sf=None,
            year_built=None,
            market_value=positive(a.get("totalvalue")),
            appraised_value=None,
            tax_year=None,
            locator=f"{Path(page).parent.name}/{Path(page).name} countyid {squeeze(a.get('countyid')) or f'{county}-{pid}'}",
            local_use_code=squeeze(a.get("parceltype")).upper() or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    seen: set[tuple[str, str]] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing); each page is a snapshot.

    The pages are a type-filtered extract, not whole rolls, so no parcel is retired.
    """
    total = IngestStats()
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        seen: set[tuple[str, str]] = set()
        for page in pages(snapshot_path):
            snap = reg.add_snapshot(SOURCE.source_id, page, as_of, retrieved_at)
            s = reg.ingest_parcels(read_page(page, seen=seen), snap, state_fips=STATE_FIPS,
                                   account_system=ACCOUNT_SYSTEM, full_roll=False)
            for f in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "owners_person_or_withheld",
                      "facts_written", "retired"):
                setattr(total, f, getattr(total, f) + getattr(s, f))
            total.errors += s.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ar_gis", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/ar-gis-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved (published semi-annually), YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
