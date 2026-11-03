"""Montana: Montana State Library statewide Cadastral Framework (Department of Revenue ORION attributes) → ``ParcelRecord``.

Source: ``MTParcels_SHP.zip`` on ftpgeoinfo.msl.mt.gov (the statewide parcel layer, one polygon per taxable or exempt parcel,
monthly). The collector archives the zip; this module reads only the shapefile's dBASE attribute table
(``Montana_Parcels/Montana_Parcels.dbf``, 920,986 records, 1.6 GB uncompressed, streamed from the zip with the standard
library; no geometry is read). Field names are the shapefile's 10-character names. Layout confirmed 2026-11-03.

- ``COUNTYCD`` / ``CountyName`` — the Department of Revenue's county number and the county name; ``CountyName`` is mapped to
  the county FIPS code (``COUNTY_FIPS``). ``PARCELID`` — the geocode (17 characters), the key within a county; ``PropertyID``
  the ORION property id, used as the account.
- ``OwnerName`` — the taxpayer of record (``VINE PATRICIA A``; the registry drops natural persons); ``OwnerAddre``,
  ``OwnerAdd_1``, ``OwnerAdd_2``, ``OwnerCity``, ``OwnerState``, ``OwnerZipCo`` its mailing address. ``DbaName`` and
  ``CareOfTaxp`` are not used. No confidentiality flag.
- ``AddressLin`` / ``AddressL_1`` / ``CityStateZ`` — the property address; ``TotalValue`` the total reappraisal value
  (``TotalLandV`` + ``TotalBuild``), stored as the market value; ``TaxYear``; ``TotalAcres`` (taxable acres) or ``GISAcres``.
- ``PropType`` — the property type. The State Library's metadata lists the legacy two-letter codes (``CU`` commercial urban,
  ``CR``, ``BU``/``BR`` commercial condominium, ``IU``/``IR`` industrial, ``MU``/``MR`` mixed use ...), but the 2026 file carries
  the Department of Revenue's words (``Vacant Land``, ``Improved Property``, ``Exempt Property``, ``Apartment``,
  ``Industrial Property`` ...). ``Improved Property`` covers every improved parcel, residential and commercial alike, so
  commercial parcels cannot be told apart in this file; only the classes that name themselves are mapped: ``Apartment`` →
  B, ``Industrial Property`` → F2 and the legacy codes ``CU``/``CR``/``BU``/``BR`` → F1, ``IU``/``IR`` → F2 where they remain.

Usage: ``python -m factlot.registry.adapters.mt_msl MTParcels_SHP.zip registry.db --as-of 2026-10-06``
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
from .dbf_reader import open_dbf

STATE_FIPS = "30"
ACCOUNT_SYSTEM = "mt_orion_property_id"
SQFT_PER_ACRE = 43560

SOURCE = Source(
    source_id="mt-msl-cadastral",
    publisher="Montana State Library, with the Montana Department of Revenue and Flathead, Missoula, Ravalli, Silver Bow and Yellowstone Counties",
    title="Montana Cadastral Framework (statewide parcels with Department of Revenue ORION attributes)",
    url="https://mslservices.mt.gov/Geographic_Information/Data/DataList/datalist_Details.aspx?did={b2b3c906-8c40-4a9f-980e-48680a23c165}",
    state_fips=STATE_FIPS,
    license="No licence; the State Library record gives a warranty disclaimer and notes that Montana law bars using a list of persons "
            "prepared by a public agency as a mailing list without the persons' permission (MCA 2-6-109). Public records, free download",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # disclaimer and a mailing-list statute only
    attribution="Montana State Library; Montana Department of Revenue",
    terms_reviewed="2026-11-03",
)

# Montana's 56 counties, alphabetical FIPS (30001, 30003 ... 30111), keyed by the name in ``CountyName`` (lower case).
_NAMES = ("Beaverhead|Big Horn|Blaine|Broadwater|Carbon|Carter|Cascade|Chouteau|Custer|Daniels|Dawson|Deer Lodge|Fallon|Fergus|"
          "Flathead|Gallatin|Garfield|Glacier|Golden Valley|Granite|Hill|Jefferson|Judith Basin|Lake|Lewis and Clark|Liberty|"
          "Lincoln|McCone|Madison|Meagher|Mineral|Missoula|Musselshell|Park|Petroleum|Phillips|Pondera|Powder River|Powell|"
          "Prairie|Ravalli|Richland|Roosevelt|Rosebud|Sanders|Sheridan|Silver Bow|Stillwater|Sweet Grass|Teton|Toole|Treasure|"
          "Valley|Wheatland|Wibaux|Yellowstone")
COUNTY_FIPS: dict[str, str] = {n.lower(): f"{2 * i + 1:03d}" for i, n in enumerate(_NAMES.split("|"))}

# PropType (lower case, as published) → FactLot category.
LABELS: dict[str, str] = {
    "apartment": "B",
    "industrial property": "F2",
    "cu - commercial urban": "F1", "cr - commercial rural": "F1", "bu - commercial condo urban": "F1",
    "br - commercial condo rural": "F1", "iu - industrial urban": "F2", "ir - industrial rural": "F2",
}


def state_category(proptype: object) -> str | None:
    """FactLot category for a Montana ``PropType``; ``None`` for every class that does not name itself commercial."""
    return LABELS.get(re.sub(r"\s+", " ", str(proptype if proptype is not None else "")).strip().lower())


def county_fips(name: object) -> str | None:
    return COUNTY_FIPS.get(re.sub(r"\s+", " ", str(name if name is not None else "")).strip().lower())


def _s(v: object) -> str:
    return re.sub(r"\s+", " ", str(v) if v is not None else "").strip()


def _pos(v: object) -> float | None:
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def _situs(r: dict) -> str | None:
    street = ", ".join(x for x in (_s(r.get("AddressLin")), _s(r.get("AddressL_1"))) if x)
    if not street:
        return None
    city = _s(r.get("CityStateZ"))
    return f"{street}, {city}" if city else f"{street}, MT"


def _mailing(r: dict) -> str | None:
    state_zip = " ".join(x for x in (_s(r.get("OwnerState")), _s(r.get("OwnerZipCo"))) if x)
    city = ", ".join(x for x in (_s(r.get("OwnerCity")), state_zip) if x)
    parts = [_s(r.get("OwnerAddre")), _s(r.get("OwnerAdd_1")), _s(r.get("OwnerAdd_2")), city]
    return ", ".join(p for p in parts if p) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              rows: Iterable[dict] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel, in file order (a repeated county geocode collapses to the first).

    ``rows`` replaces the dBASE table (tests only); by default the table is streamed from ``path`` (a zip or a ``.dbf``).
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen: set[tuple[str, str]] = set()
    for r in (rows if rows is not None else open_dbf(path)):
        category = state_category(r.get("PropType"))
        if not keep(category):
            continue
        county = county_fips(r.get("CountyName"))
        pid = _s(r.get("PARCELID"))
        if county is None or not pid or (county, pid) in seen:
            continue
        seen.add((county, pid))
        name = _s(r.get("OwnerName")) or None
        acres = _pos(r.get("TotalAcres")) or _pos(r.get("GISAcres"))
        year = _pos(r.get("TaxYear"))
        prop_id = _pos(r.get("PropertyID"))
        yield ParcelRecord(
            county_fips=county,
            apn=pid,
            state_category=category,
            account=f"{county}-{int(prop_id)}" if prop_id else None,
            situs_address=_situs(r),
            owner_name=name,
            owner_mailing_address=_mailing(r) if name else None,
            owner_confidential=False,
            land_area_sf=round(acres * SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,
            year_built=None,
            market_value=_pos(r.get("TotalValue")),
            appraised_value=None,
            tax_year=int(year) if year else None,
            locator=f"MTParcels_SHP.zip PARCELID {pid} (county {_s(r.get('CountyName'))})",
            local_use_code=_s(r.get("PropType")) or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest the archived zip into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.mt_msl", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived MTParcels_SHP.zip")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="the State Library's metadata date, YYYY-MM-DD (2026-10-06 on the first run)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
