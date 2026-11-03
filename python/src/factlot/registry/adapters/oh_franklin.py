"""Franklin County, Ohio (Columbus): Auditor's Parcel CSV → ``ParcelRecord``.

The Franklin County Auditor publishes direct downloads on an open directory listing
(``https://apps.franklincountyauditor.com/``, linked from the Auditor's "FTP" page): ``Parcel_CSV/<year>/<month>/Parcel.csv``
(about 262 MB, one row per parcel, monthly), the richer ``Outside_User_Files`` appraisal and tax-accounting
CSV/XLSX sets, and GIS shapefiles. This adapter reads ``Parcel.csv``; the field list is the Auditor's own
"Parcel CSV description of fields" PDF
(``auditor.franklincountyohio.gov/files/assets/auditor/v/1/documents/parcel-csv-description-of-fields.pdf``). The
file is UTF-8 with a BOM, fully quoted text and unquoted numbers; confirmed on the first 3 MB (5,719 rows), 2026-11-03.

Columns read:

- ``PARCEL ID`` — ``010-000005`` (three-digit tax district, a dash, six-digit parcel number); the key and the
  ``franklin_parcel_id`` crosswalk.
- ``PCLASS`` — the Auditor's property class: ``C`` commercial, ``E`` exempt, ``F`` agricultural, ``I``
  industrial, ``M`` mineral, ``R`` residential, ``U`` utility. ``LANDUSE`` — the Ohio land use code
  (Ohio Adm. Code 5703-25-10): ``401`` apartments of 4-19 rental units, ``402`` 20-39 units, ``403`` 40 or more.
  Mapped here: ``C`` → F1 (B when ``LANDUSE`` is 401-403), ``I`` → F2. Other classes are out of scope.
- ``NAME1`` (owner of record; ``NAME2``/``NAME3`` co-owners and care-of lines are not used), ``OWNER_ADD1``,
  ``OWNER_ADD2`` (the owner's address; ``OWNER_ADD2`` is ``CITY ST   ZIP`` with runs of spaces). ``MAILAD1``-``MAILAD4``
  are the tax-bill mailing lines, often a mortgage servicer, and are not used. The file has no confidentiality flag.
- ``STADDR``, ``USPS_CITY``, ``STATE``, ``ZIPCODE`` — situs; ``ACREA`` acres (0 when unknown); ``AREA_A`` primary
  building area in square feet; ``YEARBLT`` year built (a year, ``OLD`` for pre-1920 remodels, ``E 99``); ``APPRTOT``
  appraised total value of a taxable parcel and ``AEXMTOT`` of an exempt parcel (Ohio appraised value is 100 % of
  market value; the taxable value is 35 % of it). ``ANN_TAX`` is the taxable value despite its name.
  There is no roll-year column, so ``tax_year`` is not set.

Usage: ``python -m factlot.registry.adapters.oh_franklin Parcel.csv registry.db --as-of 2026-10-28``
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

STATE_FIPS = "39"
COUNTY_FIPS = "049"
ACCOUNT_SYSTEM = "franklin_parcel_id"

SOURCE = Source(
    source_id="oh-franklin-auditor",
    publisher="Franklin County Auditor's Office, Ohio",
    title="Parcel CSV (apps.franklincountyauditor.com/Parcel_CSV)",
    url="https://auditor.franklincountyohio.gov/Auditor/FTP",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Ohio R.C. 149.43); no licence is stated for the downloads. The Auditor's Disclaimer page "
            "disclaims accuracy and liability only",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; a person must decide
    attribution="Franklin County Auditor's Office",
    terms_reviewed="2026-11-03",
)

_CATEGORY_BY_PCLASS = {"C": "F1", "I": "F2", "R": "A", "E": "G", "F": "D1", "M": "D2", "U": "G"}
_APARTMENT_CODES = frozenset({"401", "402", "403"})
_SQFT_PER_ACRE = 43560


def _squeeze(s: object) -> str:
    return re.sub(r"\s+", " ", str(s) if s is not None else "").strip()


def _positive(v: object) -> float | None:
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def state_category(pclass: object, landuse: object = None) -> str | None:
    """``C`` → F1 (``LANDUSE`` 401-403 → B), ``I`` → F2; other classes map to their out-of-scope category."""
    cat = _CATEGORY_BY_PCLASS.get(_squeeze(pclass).upper())
    if cat == "F1" and _squeeze(landuse) in _APARTMENT_CODES:
        return "B"
    return cat


def year_built(v: object) -> int | None:
    """A four-digit year from ``YEARBLT``; ``OLD`` (remodelled before 1920), ``E 99`` and blanks give ``None``."""
    s = _squeeze(v)
    return int(s) if re.fullmatch(r"1[6-9]\d\d|20\d\d", s) else None


def _situs(r: dict) -> str | None:
    street = _squeeze(r.get("STADDR"))
    if not street:
        return None
    rest = " ".join(x for x in (_squeeze(r.get("USPS_CITY")), _squeeze(r.get("STATE")) or "OH",
                                _squeeze(r.get("ZIPCODE"))) if x)
    return f"{street}, {rest}"


def _mailing(r: dict) -> str | None:
    parts = [_squeeze(r.get("OWNER_ADD1")), _squeeze(r.get("OWNER_ADD2"))]
    return ", ".join(p for p in parts if p) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope parcel of ``Parcel.csv``, in file order (first row per id wins).

    ``categories`` limits by FactLot category (default: the commercial scope); ``None`` keeps every parcel.
    A truncated last line (a ranged sample) is skipped.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    csv.field_size_limit(1 << 30)
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
        width = len(header)
        for values in reader:
            if len(values) < width:
                continue  # a truncated final line
            r = dict(zip(header, values))
            pid = _squeeze(r.get("PARCEL ID"))
            if not pid or pid in seen:
                continue
            category = state_category(r.get("PCLASS"), r.get("LANDUSE"))
            if not keep(category):
                continue
            seen.add(pid)
            name = _squeeze(r.get("NAME1")) or None
            acres = _positive(r.get("ACREA"))
            value = _positive(r.get("APPRTOT")) or _positive(r.get("AEXMTOT"))
            yield ParcelRecord(
                county_fips=COUNTY_FIPS,
                apn=pid,
                state_category=category,
                account=pid,
                situs_address=_situs(r),
                owner_name=name,
                owner_mailing_address=_mailing(r) if name else None,
                owner_confidential=False,  # the file carries no confidentiality flag
                land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
                improvement_area_sf=_positive(r.get("AREA_A")),
                year_built=year_built(r.get("YEARBLT")),
                market_value=None,
                appraised_value=value,
                tax_year=None,
                locator=f"Parcel.csv PARCEL ID {pid}",
                local_use_code=_squeeze(r.get("LANDUSE")) or None,
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``Parcel.csv`` into a registry file (created if missing).

    Pass ``full_roll=False`` for a ranged sample so it does not retire parcels it does not list.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.oh_franklin", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to Parcel.csv as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="file date, YYYY-MM-DD (the directory listing's modified date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file (a sample)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
