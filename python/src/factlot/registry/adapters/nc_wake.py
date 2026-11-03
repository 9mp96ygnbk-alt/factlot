"""Wake County, North Carolina (Raleigh): NC OneMap statewide parcels, Wake slice → ``ParcelRecord``.

Source: the NC OneMap layer "North Carolina Parcels (Polygons)" (NC Center for Geographic
Information and Analysis; item 1de3d7d828ce4813b838ddf055b40317, FeatureServer layer 1 on
services.nconemap.gov), which aggregates the 100 counties' parcel files into one standard schema. For
Wake County the attributes come from the Wake County Assessor (``sourceagnt`` = "Wake County Assessor").
The adapter reads the Hub CSV export of the layer filtered to Wake (``cntyfips`` 183) and the three Wake
land classes in scope, the file named in ``registry/sources/nc/nc-wake-parcels.json``.

Layout (confirmed on the 2026-11-03 export): UTF-8 with a BOM, header row of 70 lower-case field names,
one row per parcel polygon.

- ``parno`` — the 10-digit Wake parcel identification number (PIN, ``1840459547``); ``altparno`` is the
  7-digit real estate ID the county's own site uses (``0491184``); ``nparno`` is ``37183_<parno>``.
- ``ownname`` — owner of record, all owners in one string, last name first for people
  (``LAST, FIRST``); organisations as registered. ``mailadd``, ``munit``, ``mcity``, ``mstate``,
  ``mzip`` — the mailing address; Wake puts city, state and ZIP together in ``mcity``
  (``RICHMOND VA 23226-3791``) and leaves ``mstate`` and ``mzip`` blank. ``owntype`` is blank. The file
  carries no confidentiality marker.
- ``siteadd`` / ``sunit`` / ``scity`` — situs street, unit and city (``szip`` is blank, ``scity`` is
  blank for unincorporated parcels).
- ``parusecode`` / ``parusedesc`` — NC OneMap's three-letter name for the Wake County *land class* and
  the county's one-letter class (Wake's CodeDescriptions.pdf, "LAND CLASS"): ``COM`` = ``C`` commercial,
  ``IND`` = ``D`` industrial, ``APT`` = ``G`` apartment; the others in the Wake slice are ``RHS`` ``R``
  (residential, under 10 acres with homesite), ``AHS`` ``B`` and ``AWI`` ``A`` (acreage), ``VAC`` ``V``
  vacant, ``HOA`` ``I``, ``XMT`` ``E`` exempt, ``PTX`` ``P`` part exempt, ``AGR`` ``F`` farm, ``MFG``
  ``M`` (manufactured home, not manufacturing), ``COX`` ``O`` (master accounts of condominiums, no value
  of their own), ``CEM``, ``STA``, ``WSS``, ``FOR``, ``MHP``, ``HRT``, ``GOL``, ``HIS``, ``RET``, ``CON``.
- ``parusecd2`` / ``parusedsc2`` — the county's "type and use" code of the main building (CodeDescriptions.pdf,
  "TYPE & USE": ``34`` typical office, ``47`` single tenant retail, ``83`` warehouse, ``07`` garden
  apartments, ``09`` elevator apartments, ``01``-``04`` one to four family, ``05`` multi-family …).
- ``parval`` / ``landval`` / ``improvval`` — total, land and improvement value; ``parvaltype`` is
  ``Assessed`` (Wake's assessed value, which North Carolina sets at appraised value as of the last
  revaluation). Whole dollars.
- ``gisacres`` — polygon acres; ``recareano`` — the recorded acreage (preferred when positive).
  ``structyear`` — year of the structure (0 when none), ``structno`` — number of structures.

Category mapping (FactLot scope): ``F1`` for class ``C`` (commercial: offices, retail, restaurants,
hotels, service, medical), ``F2`` for class ``D`` (industrial: warehouse, flex, manufacturing), ``B``
for class ``G`` (apartment) except parcels whose main building is a one- to four-family house
(``parusecd2`` 01-04). Everything else yields no record. ``local_use_code`` keeps
``<parusecode>/<parusecd2>`` (``COM/34``).

Usage: ``python -m factlot.registry.adapters.nc_wake "North_Carolina_Parcels_(Polygons).csv" registry.db --as-of 2026-05-17``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "37"
COUNTY_FIPS = "183"
ACCOUNT_SYSTEM = "wake_reid"

SOURCE = Source(
    source_id="nc-wake-parcels",
    publisher="NC OneMap (NC Center for Geographic Information and Analysis), from the Wake County Assessor",
    title="North Carolina Parcels (Polygons), Wake County slice (Hub CSV export)",
    url="https://www.nconemap.gov/datasets/nconemap::north-carolina-parcels-polygons",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="NC OneMap free and unrestricted use policy (https://www.nconemap.gov/pages/terms): content is shared "
            "at no charge, written release agreements are not required; public records under N.C. Gen. Stat. ch. 132",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="permitted",
    attribution="NC OneMap, NC Department of Information Technology, Center for Geographic Information and Analysis; "
                "data steward Wake County",
    terms_reviewed="2026-11-03",
)

_SQFT_PER_ACRE = 43560
# Wake land classes (NC OneMap code → category). The three-letter codes are NC OneMap's names for the
# county's one-letter classes C, D and G.
_CLASS_CATEGORY = {"COM": "F1", "IND": "F2", "APT": "B"}
# Main-building type-and-use codes that make an apartment-class parcel a one- to four-family house.
_SMALL_RESIDENTIAL = frozenset({"01", "02", "03", "04"})

_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER", "N/A", "NONE"})


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def state_category(parusecode: str | None, parusecd2: str | None = None) -> str | None:
    """FactLot category for a Wake land class (and main-building type and use), or ``None`` when out of scope.

    ``("COM", "34")`` → ``F1``; ``("IND", "83")`` → ``F2``; ``("APT", "07")`` → ``B``; ``("APT", "01")`` →
    ``None`` (a one-family house on an apartment-class parcel); ``("RHS", "")`` → ``None``.
    """
    category = _CLASS_CATEGORY.get(_squeeze(parusecode).upper())
    if category == "B" and _squeeze(parusecd2) in _SMALL_RESIDENTIAL:
        return None
    return category


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, values and years: 0 or blank means the county has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def _mailing_address(r: dict[str, str]) -> str | None:
    """``1700 BAYBERRY CT STE 300, RICHMOND VA 23226-3791``: street, unit, then Wake's combined city/state/ZIP."""
    state_zip = " ".join(x for x in (_squeeze(r.get("mstate")), _squeeze(r.get("mzip"))) if x)
    city = ", ".join(x for x in (_squeeze(r.get("mcity")), state_zip) if x)
    return ", ".join(x for x in (_squeeze(r.get("mailadd")), _squeeze(r.get("munit")), city) if x) or None


def _situs(r: dict[str, str]) -> str | None:
    """``300 HARVEST BOUNTY DR, WAKE FOREST NC``; the layer has no situs ZIP and no city for unincorporated parcels."""
    street = ", ".join(x for x in (_squeeze(r.get("siteadd")), _squeeze(r.get("sunit"))) if x)
    if not street:
        return None
    place = " ".join(x for x in (_squeeze(r.get("scity")), "NC") if x)
    return f"{street}, {place}"


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        for r in csv.DictReader(f):
            yield {(k or "").strip().lower(): v for k, v in r.items()}


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per Wake parcel in scope, in file order (a repeated ``parno`` collapses to the first).

    ``categories`` limits the parcels kept (default: the registry's commercial scope); ``None`` keeps
    every Wake parcel with a category of ``None``.
    """
    keep = (lambda c: is_commercial(c)) if categories is COMMERCIAL_CATEGORIES else (
        (lambda c: True) if categories is None else (lambda c, s=frozenset(x.upper() for x in categories): c in s))
    seen: set[str] = set()
    for r in _rows(path):
        pid = _squeeze(r.get("parno"))
        if not pid or pid in seen:
            continue
        if _squeeze(r.get("cntyfips")) not in ("", COUNTY_FIPS):
            continue  # the statewide layer: only Wake rows belong in this source
        category = state_category(r.get("parusecode"), r.get("parusecd2"))
        if not keep(category or ""):
            continue
        seen.add(pid)
        owner = _owner(r.get("ownname"))
        acres = _positive(r.get("recareano")) or _positive(r.get("gisacres"))
        year = _positive(r.get("structyear"))
        value = _positive(r.get("parval"))
        use = "/".join(x for x in (_squeeze(r.get("parusecode")).upper(), _squeeze(r.get("parusecd2"))) if x)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=category,
            account=_squeeze(r.get("altparno")) or None,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,  # the layer carries no confidentiality marker
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # the layer has no building area
            year_built=int(year) if year else None,
            market_value=None,  # one value, typed "Assessed"; kept as the appraised value
            appraised_value=value,
            tax_year=None,  # the layer does not state the tax year
            locator=f"nc-parcels cntyfips {COUNTY_FIPS} parno {pid}",
            local_use_code=use or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived Hub CSV export into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


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
