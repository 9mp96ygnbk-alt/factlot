"""Alameda County Assessor secured roll (county open-data table) → ``ParcelRecord``.

STATUS: written against the live field list and three sampled rows of the 2025-26 table, and tested on a
synthetic fixture. It has NOT been run on a full download: the table carries no licence (``verified:
false`` in ``registry/sources/ca/ca-alameda-assessor.json``), so the collector will not snapshot it.
See ``docs/registry/sources/ca-alameda-assessor.md``.

Layout (confirmed on the ``Assessor_Office_Secured_Tax_Roll_2025_to_2026`` hosted table, 472,690
records, 2026-11-02): one row per parcel, header row. The table is an ArcGIS feature-service table on
the county's Open Data Hub; export it as CSV. Header names are matched case-insensitively with
punctuation folded to ``_`` (``Sort_Parcel`` and ``Sort Parcel`` are the same column). The file has
NO year column: pass ``tax_year`` (2025 for the 2025-26 roll).

- ``Sort_Parcel`` (``001 011100100``) is the zero-padded parcel key; ``Print_Parcel`` (``1-111-1``) is the
  printed APN. Printed APNs cannot serve as the ID key: dropping the hyphens makes ``1-111-5-2`` and
  ``1-111-52`` collide. ``apn`` is the sort form without its space (``001011100100``), ``account`` the printed form.
- ``Use_Code`` — the Assessor's four-digit use code. The publisher's table is the Property Search
  "Use Codes" page (``propinfo.acgov.org/UseCodeList``); ``_B``, ``_F1`` and ``_F2`` below are
  transcribed from it. ``7x`` is "Multiple Residential, 5 or more units"; ``3x``, ``8x``, ``9x`` are
  commercial; ``4x`` is industrial. The Assessor says these codes are for its own appraisal use.
- ``Situs_Street_Number``, ``Situs_Street_Name`` (street type included), ``Situs_Unit``,
  ``Situs_City``, ``Situs_Zip``.
- ``Land``, ``Imps`` — assessed land and improvement values (Proposition 13 assessed values, not market
  values); ``CLCA_Land``/``CLCA_Imps`` (Williamson Act), ``Fixtures``, ``BPP`` and the exemptions are ignored.
- ``Delete_Date`` — non-blank when the parcel was deleted from the roll; such rows are dropped.
- NO owner name: the table has only the owner's mailing address, which is not stored without a name.
  The file has no building area, lot area or year built.

Usage: ``python -m factlot.registry.adapters.ca_alameda roll.csv registry.db --as-of 2025-07-07 --tax-year 2025``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "06"
COUNTY_FIPS = "001"
ACCOUNT_SYSTEM = "alameda_apn"

SOURCE = Source(
    source_id="ca-alameda-assessor",
    publisher="Alameda County Assessor (county Open Data Hub)",
    title="Assessor Office Secured Tax Roll (hosted table, one per roll year)",
    url="https://data.acgov.org/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="None stated on the dataset (license field 'none'); California public record. Not cleared for the registry",
    ai_use="unknown",
    redistribution="unknown",
    attribution="Alameda County Assessor",
    terms_reviewed="2026-11-02",
)

# Assessor use code (propinfo.acgov.org/UseCodeList) → FactLot category.
# B: multiple residential, 5 or more units (the publisher's 7x series), buildings only: not condominium
# units (73xx), vacant land (70xx), common areas (xx90), fraternities (7600) or church homes (7900).
_B = frozenset({7100, 7200, 7400, 7430, 7500, 7700, 7701, 7705, 7706, 7800})
# F1: commercial (3x, 8x, 9x series), improved only; plus golf course 6300 and historical commercial 6850.
_F1 = frozenset({
    3100, 3120, 3200, 3300, 3400, 3500, 3600, 3605, 3610, 3620, 3700, 3701, 3702, 3703, 3704, 3705, 3800, 3900,
    6300, 6850,
    8000, 8100, 8200, 8300, 8400, 8500, 8600, 8700, 8800, 8801, 8802, 8900, 8901,
    9000, 9100, 9200, 9300, 9301, 9400, 9401, 9405, 9500, 9600, 9700, 9800, 9801, 9802, 9900, 9905,
})
# F2: industrial (4x series), improved only, excluding nurseries, quarries, landfill and salt ponds.
_F2 = frozenset({4100, 4101, 4102, 4103, 4200, 4201, 4202, 4205, 4300, 4400, 4800, 4900})

_CODE_CATEGORY: dict[int, str] = {
    **{c: "B" for c in _B},
    **{c: "F1" for c in _F1},
    **{c: "F2" for c in _F2},
}


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def category(use_code: str | int | None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for an Assessor use code, or ``None`` when out of scope."""
    try:
        return _CODE_CATEGORY.get(int(str(use_code).strip()))
    except (TypeError, ValueError):
        return None


def situs(r: dict[str, str]) -> str | None:
    """``229 BRUSH ST #5, OAKLAND, CA 94607``; ``None`` without a street name. The number may be blank."""
    name = _squeeze(r.get("situs_street_name"))
    if not name:
        return None
    street = " ".join(x for x in (_squeeze(r.get("situs_street_number")), name) if x)
    if unit := _squeeze(r.get("situs_unit")):
        street += f" #{unit}"
    zip_code = _squeeze(r.get("situs_zip"))
    zip_code = zip_code[:-2] if re.fullmatch(r"\d{5}\.0", zip_code) else zip_code  # a float export gives 94607.0
    state_zip = " ".join(x for x in ("CA", zip_code) if x)
    return ", ".join(x for x in (street, _squeeze(r.get("situs_city")), state_zip) if x)


def read_roll(path: str | Path, *, tax_year: int) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per undeleted parcel in the registry's commercial scope, in file order."""
    csv.field_size_limit(1 << 30)
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            r = dict(zip(header, values))
            if _squeeze(r.get("delete_date")):
                continue
            apn = re.sub(r"\s+", "", r.get("sort_parcel") or "")
            cat = category(r.get("use_code"))
            if not apn or cat is None or apn in seen:
                continue
            seen.add(apn)
            land, imps = _num(r.get("land")), _num(r.get("imps"))
            assessed = (land or 0) + (imps or 0) if (land or imps) else None
            yield ParcelRecord(
                county_fips=COUNTY_FIPS,
                apn=apn,
                state_category=cat,
                account=_squeeze(r.get("print_parcel")) or apn,
                situs_address=situs(r),
                owner_name=None,  # the table publishes no owner names
                owner_mailing_address=None,
                owner_confidential=False,
                market_value=None,  # assessed (Proposition 13) values only
                appraised_value=assessed,
                tax_year=tax_year,
                locator=f"Sort_Parcel {apn}",
                local_use_code=str(int(r["use_code"])).zfill(4),
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
          retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest one archived roll CSV into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, tax_year=tax_year), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ca_alameda", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived roll CSV")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date of the roll file (hosted-table modified date), YYYY-MM-DD")
    ap.add_argument("--tax-year", required=True, type=int, help="leading year of the roll's fiscal year (2025 for 2025-26)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, tax_year=args.tax_year, retrieved_at=args.retrieved_at,
                  full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
