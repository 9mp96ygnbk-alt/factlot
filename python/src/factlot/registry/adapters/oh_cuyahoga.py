"""Cuyahoga County, Ohio (Cleveland): "Open Data Parcels" composite tax parcels → ``ParcelRecord``.

The Cuyahoga County Fiscal Officer and County GIS publish composite tax parcels with CAMA (appraisal)
characteristics as an ArcGIS Server map service, ``Open_Data_Parcels/MapServer``: layer 0 "Combined
Parcels - Cleveland Only" and layer 1 "Combined Parcels - Non-Cleveland Only". The collector archives
pages of both layers (``f=json``, ``returnGeometry=false``, ordered by ``OBJECTID``, at most 2,000
features each: ``{"features": [{"attributes": {…}}, …]}``) filtered to ``property_class`` C or I.
Layout confirmed against the live service, 2026-11-03.

- ``parcelpin`` — the 8-digit parcel number (``31514092`` is permanent parcel number 315-14-092); the key
  and the ``cuyahoga_ppn`` crosswalk. ``parcel_id`` repeats it.
- ``property_class`` — the Fiscal Officer's class: ``C`` commercial, ``I`` industrial, ``R`` residential,
  ``E`` exempt (``CE``/``IE``/``RE`` exempt commercial/industrial/residential), ``A`` agricultural, ``M``
  mineral, ``P`` public utility, ``H``/``LW`` other. ``tax_luc`` — the 4-digit Ohio land use code with the
  county's sub-codes (``tax_luc_description`` names them): ``3xxx`` industrial; ``4xxx`` commercial; the
  apartment codes ``4010``-``4090`` (walk-up, elevator and garden apartments of 7 or more units, and
  ``4090`` "4-6 UNIT APARTMENTS"). Mapped here: ``C`` → F1 (B for ``4010``-``4090``), ``I`` → F2.
- ``deeded_owner`` — the owner of record (``mail_name`` is the tax-bill addressee, ``grantee``/``grantor``
  the last transfer). ``mail_addr_street``, ``mail_unit``, ``mail_city``, ``mail_state``, ``mail_zip``,
  ``mail_country`` — the tax-bill mailing address. The service has no confidentiality flag.
- ``par_addr_all`` (``1510  NEWMAN AVE, LAKEWOOD, OH, 44107``) — the situs; ``par_city``, ``par_zip``.
- ``gross_certified_total`` (land + building, dollars, before exemption and abatement) — the certified
  appraised value; ``certified_tax_total`` the taxable part. ``total_acreage``, ``total_com_use_area`` /
  ``total_res_liv_area`` (building area, square feet), ``com_living_units``, ``tax_year`` (the certified
  tax year), ``total_square_ft`` (the parcel's GIS area).

Usage: ``python -m factlot.registry.adapters.oh_cuyahoga collected/oh-cuyahoga-parcels registry.db --as-of 2026-11-03``
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "39"
COUNTY_FIPS = "035"
ACCOUNT_SYSTEM = "cuyahoga_ppn"

SOURCE = Source(
    source_id="oh-cuyahoga-parcels",
    publisher="Cuyahoga County Fiscal Officer and Cuyahoga County GIS, Ohio",
    title="Open Data Parcels (Open_Data_Parcels/MapServer)",
    url="https://gis.cuyahogacounty.gov/server/rest/services/Open_Data_Parcels/MapServer",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Ohio R.C. 149.43); no licence is stated for the service (empty licenseInfo). The county "
            "website Disclaimer disclaims accuracy and liability only",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; a person must decide
    attribution="Cuyahoga County Fiscal Officer and Cuyahoga County GIS",
    terms_reviewed="2026-11-03",
)

_CATEGORY_BY_PCLASS = {"C": "F1", "I": "F2", "R": "A", "A": "D1", "M": "D2", "E": "G", "CE": "G", "IE": "G", "RE": "G",
                       "P": "G"}
_SQFT_PER_ACRE = 43560
_APARTMENT_RANGE = range(4010, 4100)  # 4010-4090 (4092 convalescent home etc. are not apartments)


def _squeeze(s: object) -> str:
    return re.sub(r"\s+", " ", str(s) if s is not None else "").strip()


def _positive(v: object) -> float | None:
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def is_apartment(luc: object) -> bool:
    """Land use codes 4010-4090: apartment buildings (walk-up, elevator, garden; 4090 is 4-6 units)."""
    s = _squeeze(luc)
    return s.isdigit() and int(s) in _APARTMENT_RANGE and int(s) <= 4090


def state_category(pclass: object, luc: object = None) -> str | None:
    """``C`` → F1 (apartment land use codes → B), ``I`` → F2; other classes map to their out-of-scope category."""
    cat = _CATEGORY_BY_PCLASS.get(_squeeze(pclass).upper())
    if cat == "F1" and is_apartment(luc):
        return "B"
    return cat


def _situs(a: dict) -> str | None:
    s = _squeeze(a.get("par_addr_all"))
    if s:
        return s.replace(", ,", ",").strip(", ")
    return None


def _mailing(a: dict) -> str | None:
    street = " ".join(x for x in (_squeeze(a.get("mail_addr_street")), _squeeze(a.get("mail_unit"))) if x)
    state_zip = " ".join(x for x in (_squeeze(a.get("mail_state")), _squeeze(a.get("mail_zip"))) if x)
    country = _squeeze(a.get("mail_country"))
    if country.upper() in ("US", "USA", "UNITED STATES"):
        country = ""
    parts = [street, _squeeze(a.get("mail_city")), state_zip, country]
    return ", ".join(p for p in parts if p) or None


def pages(path: str | Path | Iterable[str | Path]) -> list[Path]:
    """The archived JSON page files: a file, a list of files, or a collector directory (searched
    recursively for the files the collector names ``query`` and for ``*.json``)."""
    paths = [Path(path)] if isinstance(path, (str, Path)) else [Path(p) for p in path]
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out += sorted(f for f in p.rglob("*")
                          if f.is_file() and (f.name == "query" or (f.suffix == ".json" and f.name != "discovered.json")))
        else:
            out.append(p)
    return out


def _features(page: Path) -> Iterator[dict]:
    with open(page, encoding="utf-8") as f:
        doc = json.load(f)
    for feat in doc.get("features", []):
        yield feat.get("attributes", feat)


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[str] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel of one archived page (first row per parcel number wins)."""
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in _features(Path(page)):
        pin = _squeeze(a.get("parcelpin")) or _squeeze(a.get("parcel_id"))
        if not pin or pin in seen:
            continue
        category = state_category(a.get("property_class"), a.get("tax_luc"))
        if not keep(category):
            continue
        seen.add(pin)
        name = _squeeze(a.get("deeded_owner")) or None
        acres = _positive(a.get("total_acreage"))
        area = _positive(a.get("total_com_use_area")) or _positive(a.get("total_res_liv_area"))
        year = a.get("tax_year")
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pin,
            state_category=category,
            account=pin,
            situs_address=_situs(a),
            owner_name=name,
            owner_mailing_address=_mailing(a) if name else None,
            owner_confidential=False,  # the service carries no confidentiality flag
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=area,
            year_built=None,  # the service has no year built
            market_value=None,
            appraised_value=_positive(a.get("gross_certified_total")),
            tax_year=int(year) if isinstance(year, (int, float)) and year else None,
            locator=f"{Path(page).parent.name}/{Path(page).name} parcelpin {pin}",
            local_use_code=_squeeze(a.get("tax_luc")) or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    """Yield the in-scope parcels of every page under ``path``, each parcel number once."""
    seen: set[str] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing); each page is a snapshot.

    The pages are a class-filtered extract, not the whole roll, so no parcel is retired.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.oh_cuyahoga", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/oh-cuyahoga-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the pages were retrieved, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
