"""Minnesota: MnGeo "Parcels, Compiled from Opt-In Open Data Counties" → ``ParcelRecord``.

Source: the MnGeo (Minnesota Geospatial Information Office) compilation of the parcel data of counties that
opted in to open data (ArcGIS Online item 69148d3959194a05a23964cc60f6517b, feature service
``plan_parcels_open``, layer 1 "Plan Parcels Open", 59 counties on 2026-11-03), with every county's attributes mapped
by MnGeo to the Geospatial Advisory Council (GAC) parcel standard. The collector archives pages of a filtered query
(``f=json``, ``returnGeometry=false``, ``objectid`` order, 2,000 features per page). Layout confirmed against the live
layer, 2026-11-03.

- ``county_pin`` — the county's own parcel number; ``state_pin`` is ``<co_code>-<county_pin>`` (``27123-293023220043``).
  ``co_code`` is the 5-digit county FIPS code (``27123`` Ramsey); the key is ``county_pin`` and the account the ``state_pin``.
- ``owner_name`` (+ ``owner_more``) — owner of record; ``own_add_l1`` to ``own_add_l4`` its mailing address (``tax_name`` and
  ``tax_add_l*`` the taxpayer, not used). No confidentiality flag.
- ``anumberpre``, ``anumber``, ``anumbersuf``, ``st_pre_mod``, ``st_pre_dir``, ``st_pre_typ``, ``st_pre_sep``, ``st_name``,
  ``st_pos_typ``, ``st_pos_dir``, ``st_pos_mod``, ``ctu_name``, ``state_code``, ``zip`` — the situs (GAC address parts).
- ``emv_land``, ``emv_bldg``, ``emv_total`` — estimated market value (dollars) for ``mkt_year``; ``tax_year`` the payable year;
  ``acres_poly`` / ``acres_deed`` — acres; ``year_built``; ``num_units``; ``fin_sq_ft`` (finished square feet, mostly residential).
- ``useclass1`` — the county's own text for the parcel's first use class. **The wording is the county's**, so the table below is
  per label, not per code: only labels whose own words say commercial, industrial or "apartment ... 4 or more units" are mapped,
  and only in the counties listed in ``COUNTIES`` (those whose labels were read in full on 2026-11-03). Counties that use bare
  numeric codes (Washington), combined commercial/industrial/public-utility classes (Isanti, Morrison, Rice) or mixed multi-use
  strings (Clay) are not mapped. Hennepin County is in the compilation but is loaded from its own source (``mn-hennepin-assessor``)
  and is excluded here.

Usage: ``python -m factlot.registry.adapters.mn_opt_in collected/mn-opt-in-parcels registry.db --as-of 2026-11-03``
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
from .arcgis_pages import SQFT_PER_ACRE, features, pages, positive, squeeze

STATE_FIPS = "27"
ACCOUNT_SYSTEM = "mn_state_pin"

SOURCE = Source(
    source_id="mn-opt-in-parcels",
    publisher="Minnesota Geospatial Information Office (MnGeo), compiled from the parcel data of Minnesota counties that opted in to open data",
    title="Parcels, Compiled from Opt-In Open Data Counties, Minnesota (plan_parcels_open)",
    url="https://gisdata.mn.gov/dataset/plan-parcels-open",
    state_fips=STATE_FIPS,
    license="No licence; the counties opted in to open data and the State of Minnesota makes 'no representation or warranties, "
            "express or implied, with respect to the use or reuse of data' (item description); data provided as is",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # opt-in open data, no licence text
    attribution="Minnesota Geospatial Information Office (MnGeo) and the contributing Minnesota counties",
    terms_reviewed="2026-11-03",
)

# 5-digit county FIPS → name, for the counties whose use-class labels were read in full and are mapped below.
COUNTIES: dict[str, str] = {
    "27001": "Aitkin", "27003": "Anoka", "27005": "Becker", "27019": "Carver", "27021": "Cass", "27023": "Chippewa",
    "27025": "Chisago", "27031": "Cook", "27037": "Dakota", "27045": "Fillmore", "27075": "Lake", "27085": "McLeod",
    "27099": "Mower", "27109": "Olmsted", "27111": "Otter Tail", "27117": "Pipestone", "27123": "Ramsey",
    "27129": "Renville", "27137": "St. Louis", "27139": "Scott", "27141": "Sherburne", "27145": "Stearns",
    "27161": "Waseca", "27171": "Wright",
}

# The counties' own use-class labels (lower case, whitespace squeezed) → FactLot category. Every label is a literal wording
# seen in ``useclass1`` in one of ``COUNTIES``. Not mapped, though near: seasonal recreational commercial (resort),
# telephone, railroad and public-utility classes, manufactured home parks, low-income rental housing (4d), community land
# trusts, nursing-home and mobile-home "Apartment-..." classes of Dakota, and "Vacant Land - ..." classes.
LABELS: dict[str, str] = {
    # commercial → F1
    "3a commercial land and building": "F1", "3a commercial preferential": "F1", "3a commercial non preferential": "F1",
    "233 3a commercial preferential": "F1", "233 - commercial land and building (1st $150,000)": "F1",
    "commercial": "F1", "commercial preferred": "F1", "commercial non-preferred": "F1", "commercial-preferred": "F1",
    "commercial-open space": "F1", "commercial-preferred-open space": "F1",
    # industrial → F2
    "3a industrial land and building": "F2", "3a industrial preferential": "F2", "3a industial preferential": "F2",
    "3a industrial non preferential": "F2", "234 3a industrial preferential": "F2",
    "234 - industrial land and building (1st $150,000)": "F2",
    "industrial": "F2", "industrial preferred": "F2", "industrial non-preferred": "F2", "industrial-preferred": "F2",
    # apartments of four or more units → B
    "4a apartment 4 or more units": "B", "205 4a apartment 4 or more units": "B", "apartment (4 or more units)": "B",
    "apartment": "B",
}


def state_category(county_fips: object, useclass1: object) -> str | None:
    """FactLot category for a county's ``useclass1`` label; ``None`` outside ``COUNTIES`` or when the label is not mapped."""
    if squeeze(county_fips) not in COUNTIES:
        return None
    return LABELS.get(squeeze(useclass1).lower())


def _situs(a: dict) -> str | None:
    street = " ".join(x for x in (
        squeeze(a.get("anumberpre")), squeeze(a.get("anumber")) if a.get("anumber") not in (None, 0, "0") else "",
        squeeze(a.get("anumbersuf")), squeeze(a.get("st_pre_mod")), squeeze(a.get("st_pre_dir")),
        squeeze(a.get("st_pre_typ")), squeeze(a.get("st_pre_sep")), squeeze(a.get("st_name")),
        squeeze(a.get("st_pos_typ")), squeeze(a.get("st_pos_dir")), squeeze(a.get("st_pos_mod"))) if x)
    if not squeeze(a.get("st_name")):
        return None
    city, zip5 = squeeze(a.get("ctu_name")), squeeze(a.get("zip"))
    rest = " ".join(x for x in (city, squeeze(a.get("state_code")) or "MN", zip5) if x)
    return f"{street}, {rest}"


def _owner(a: dict) -> str | None:
    name = squeeze(a.get("owner_name"))
    return name or None


def _mailing(a: dict) -> str | None:
    parts = [squeeze(a.get(f"own_add_l{i}")) for i in range(1, 5)]
    return ", ".join(p for p in parts if p) or None


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[str] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel of one archived page (a repeated county PIN is skipped)."""
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in features(page):
        co = squeeze(a.get("co_code"))
        pin = squeeze(a.get("county_pin"))
        if not co or not pin or co == "27053":  # Hennepin: its own source
            continue
        key = f"{co}-{pin}"
        category = state_category(co, a.get("useclass1"))
        if key in seen or not keep(category):
            continue
        seen.add(key)
        name = _owner(a)
        acres = positive(a.get("acres_deed")) or positive(a.get("acres_poly"))
        yield ParcelRecord(
            county_fips=co[2:],
            apn=pin,
            state_category=category,
            account=squeeze(a.get("state_pin")) or key,
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=_mailing(a) if name else None,
            owner_confidential=False,  # the compilation carries no confidentiality flag
            land_area_sf=round(acres * SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # fin_sq_ft is finished living area, mostly residential: not a building area
            year_built=int(a["year_built"]) if positive(a.get("year_built")) else None,
            market_value=positive(a.get("emv_total")),
            appraised_value=None,
            tax_year=int(a["mkt_year"]) if positive(a.get("mkt_year")) else None,
            locator=f"{Path(page).parent.name}/{Path(page).name} state_pin {squeeze(a.get('state_pin')) or key}",
            local_use_code=squeeze(a.get("useclass1")) or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    seen: set[str] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing); each page is a snapshot.

    The pages are a label-filtered extract of 24 counties, not whole rolls, so no parcel is retired.
    """
    total = IngestStats()
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        seen: set[str] = set()
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.mn_opt_in", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/mn-opt-in-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved (the layer updates quarterly), YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
