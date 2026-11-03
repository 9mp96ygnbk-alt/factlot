"""San Francisco Assessor-Recorder secured roll (DataSF dataset ``wv5m-vpq2``) → ``ParcelRecord``.

Layout (confirmed on the 2025 roll, 2026-11-02): the Socrata SODA CSV for ``closed_roll_year = 2025``,
one row per parcel per roll year, header row, UTF-8, quoted CSV. ``closed_roll_year`` is the leading
year of the fiscal year the assessed value applies to (2025 = fiscal 2025-26). The collector archives
a projection of 23 of the dataset's 46 columns, filtered to the in-scope ``property_class_code`` values
(``_B``, ``_BY_UNITS``, ``_F1``, ``_F2`` below), so the file is an extract, not the whole roll year.

- ``parcel_number`` — block + lot (``0012003A``; 7–9 characters), the parcel key. ``block`` and ``lot``
  are its parts. One row per parcel per roll year.
- ``property_location`` — a fixed-width situs string of 36 or more characters, not a street address:
  ``[0:4]`` the highest street number of a range (``0000`` when the parcel has one number), ``[5:9]`` the
  lowest street number, ``[10:30]`` the street name padded to 20, ``[30:32]`` the street suffix (``ST``,
  ``AV``; blank for ``BROADWAY``), ``[32:]`` the unit, 4 or 5 characters (``0000`` for none, ``0302``, ``0001G``, ``A-07``).
  The file has no situs city or ZIP; every parcel is in the City and County of San Francisco.
- ``use_code`` / ``property_class_code`` — the Assessor's use group (``MRES``, ``COMR``, ``IND``…) and
  its finer class code (``A15`` apartments of 15+ units). The publisher's code table is the reference
  dataset ``pa56-ek2h`` (145 rows); ``_B``, ``_F1``, ``_F2`` and ``_BY_UNITS`` below are transcribed
  from it. The roll carries NO owner name: the Assessor-Recorder publishes none in this dataset, so
  ``owner_name`` is always ``None``.
- ``property_area`` (building square feet), ``lot_area`` (square feet), ``year_property_built``,
  ``number_of_units``, ``assessed_land_value`` and ``assessed_improvement_value`` (Proposition 13
  assessed values, not market values), ``status_code`` (``NA`` taxable, ``L`` senior lien taxable, ``N``
  non-taxable or government owned, ``S`` assessed by the State Board of Equalization).

Scope: FactLot categories ``B`` (multifamily of 5 or more units), ``F1`` (commercial) and ``F2``
(industrial). Government-owned class codes (the ``…G`` classes), vacant land, schools, churches, clubs,
timeshares and every residential class are out of scope. Parcels with ``status_code`` ``N`` or ``S``
(non-taxable, government owned, or state-assessed utility property) are dropped too.

Usage: ``python -m factlot.registry.adapters.ca_san_francisco wv5m-vpq2.csv registry.db --as-of 2026-06-26``
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
COUNTY_FIPS = "075"
ACCOUNT_SYSTEM = "sf_parcel"

SOURCE = Source(
    source_id="ca-san-francisco-assessor",
    publisher="City and County of San Francisco, Office of the Assessor-Recorder (via DataSF)",
    title="Assessor Historical Secured Property Tax Rolls (DataSF wv5m-vpq2)",
    url="https://data.sf.gov/d/wv5m-vpq2",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Open Data Commons Public Domain Dedication and License (PDDL 1.0)",
    ai_use="permitted",  # PDDL grants the right to Use the Work; the dataset carries no AI clause
    redistribution="permitted",  # PDDL
    attribution=None,  # none required; the registry still cites the DataSF dataset
    terms_reviewed="2026-11-02",
)

# Publisher class code (reference dataset pa56-ek2h) → FactLot category.
# B: multifamily classes the publisher bands at 5 or more units.
_B = frozenset({
    "A5", "A15", "DA5", "DA15", "DD5", "DD15", "F5", "F15", "FA5", "FA15", "FS5", "FS15",
    "OA5", "OA15", "TIC5", "TI15",
})
# Multifamily classes with no unit band in their name: B only when the roll says 5 or more units.
_BY_UNITS = frozenset({"CO", "DCON", "DF", "F2", "FA", "TIA", "TIF", "XV"})
# F1: commercial retail, office, hotel and the commercial classes under use code COMM.
_F1 = frozenset({
    # COMR retail
    "B", "BZ", "C", "C1", "CD", "CM", "CZ", "CZEU", "EC", "OC",
    # COMO office
    "O", "O35", "OAH", "OAL", "OAM", "OAT", "OBH", "OBL", "OBM", "OCH", "OCL", "OCM", "OMD", "OZ", "OZEU",
    # COMH hotels
    "H", "H1", "H2", "HC", "M", "RH", "RH1",
    # COMM miscellaneous commercial: apartment over store, garages and parking, golf, hospitals and
    # nursing homes, gas stations, theatres
    "AC", "G", "GG", "GZ", "GZEU", "GC", "N1", "N2", "PL", "PZ", "S", "T",
})
# F2: the publisher's industrial group (use code IND).
_F2 = frozenset({"I", "IDC", "IW", "IX", "IZ"})

_CLASS_CATEGORY: dict[str, str] = {
    **{c: "B" for c in _B},
    **{c: "F1" for c in _F1},
    **{c: "F2" for c in _F2},
}

# status_code N = non-taxable / government owned, S = assessed by the State Board of Equalization.
_OUT_OF_SCOPE_STATUS = frozenset({"N", "S"})

_LOCATION_LEN = 36


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years and values: the roll writes 0 (or leaves blank) when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def category(class_code: str | None, units: float | None = None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for an Assessor class code, or ``None`` when out of scope."""
    c = _squeeze(class_code).upper()
    if c in _CLASS_CATEGORY:
        return _CLASS_CATEGORY[c]
    if c in _BY_UNITS and units is not None and units >= 5:
        return "B"
    return None


def situs(location: str | None) -> str | None:
    """Street address from the fixed-width ``property_location`` (``0550 0544 FILBERT … ST0000`` →
    ``544-550 FILBERT ST, SAN FRANCISCO, CA``); ``None`` when the string is blank or shorter than 36 characters."""
    loc = (location or "").rstrip("\r\n")
    if len(loc) < _LOCATION_LEN:
        return None
    high, low = loc[0:4].strip(), loc[5:9].strip()
    name, suffix, unit = _squeeze(loc[10:30]), loc[30:32].strip(), loc[32:].strip()
    if not name:
        return None
    number = ""
    low_n = int(low) if low.isdigit() else 0
    high_n = int(high) if high.isdigit() else 0
    if low_n and high_n and high_n != low_n:
        number = f"{low_n}-{high_n}"
    elif low_n or high_n:
        number = str(low_n or high_n)
    if unit.startswith("0"):
        unit = unit.lstrip("0")  # 0302 → 302, 0001G → 1G, 0000 → no unit
    line = " ".join(x for x in (number, name, suffix) if x)
    if unit:
        line += f" #{unit}"
    return f"{line}, SAN FRANCISCO, CA"


def read_roll(path: str | Path) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in the registry's commercial scope, in file order.

    A parcel number repeated within the file collapses to the first row.
    """
    csv.field_size_limit(1 << 30)
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            apn = _squeeze(r.get("parcel_number")).upper()
            if not apn or apn in seen:
                continue
            if _squeeze(r.get("status_code")).upper() in _OUT_OF_SCOPE_STATUS:
                continue
            cat = category(r.get("property_class_code"), _num(r.get("number_of_units")))
            if cat is None:
                continue
            seen.add(apn)
            land_v, imp_v = _num(r.get("assessed_land_value")), _num(r.get("assessed_improvement_value"))
            assessed = (land_v or 0) + (imp_v or 0) if (land_v or imp_v) else None
            year = _num(r.get("closed_roll_year"))
            built = _positive(r.get("year_property_built"))
            yield ParcelRecord(
                county_fips=COUNTY_FIPS,
                apn=apn,
                state_category=cat,
                account=apn,
                situs_address=situs(r.get("property_location")),
                owner_name=None,  # the dataset publishes no owner names
                owner_mailing_address=None,
                owner_confidential=False,
                land_area_sf=_positive(r.get("lot_area")),
                improvement_area_sf=_positive(r.get("property_area")),
                year_built=int(built) if built else None,
                market_value=None,  # the Assessor publishes assessed (Proposition 13) values, not market values
                appraised_value=assessed,
                tax_year=int(year) if year else None,
                locator=f"row_id {_squeeze(r.get('row_id')) or apn}",
                local_use_code=f"{_squeeze(r.get('use_code'))}/{_squeeze(r.get('property_class_code'))}",
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived roll-year CSV into a registry file (created if missing).

    The collector archives the in-scope-class extract of the roll year, which omits every other class, so
    by default parcels an earlier snapshot covered but this one omits are NOT retired. Pass ``full_roll=True``
    only for an unfiltered download of the whole roll year.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ca_san_francisco", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the archived roll-year CSV (wv5m-vpq2.csv)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the Assessor-Recorder data was loaded, YYYY-MM-DD (data_as_of)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true",
                    help="the file is the whole roll year (not the class extract): retire parcels it omits")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
