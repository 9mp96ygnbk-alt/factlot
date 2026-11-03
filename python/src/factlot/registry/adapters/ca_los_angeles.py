"""Los Angeles County Office of the Assessor: ``Assessor Parcel Data Roll <year>`` CSV → ``ParcelRecord``.

Layout (confirmed on the Roll 2026 exports, 2026-11-02): the County of Los Angeles Open Data
portal (data.lacounty.gov, an ArcGIS Hub) publishes the secured roll as a hosted table; its CSV
export is UTF-8 with a byte-order mark, CRLF line endings, a header row of the publisher's field
*aliases* (``AIN``, ``Property Use Code``, ``Total Value Land Improvement``...), one row per parcel
for the roll year. The full export is 1.1 GB and half its rows are entirely blank (no AIN), so the
collector fetches it in four pieces filtered on the use-code prefix (``where=UseCode LIKE
'05%'``, ``'1%'``, ``'2%'``, ``'3%'``); each piece is its own snapshot and each is built with
``full_roll=False``.

- ``AIN`` — the 10-digit Assessor Identification Number (``2010004040``), the parcel key;
  ``Assessor ID`` is its dashed form (``2010-004-040``). ``Row ID`` is roll year + AIN.
- ``Property Use Code`` — the Assessor's four-character use code. The first character is the
  property class, as the publisher spells out in ``Use Code 1st Digit``: ``0`` Residential, ``1``
  and ``2`` Commercial, ``3`` Industrial, ``4`` Irrigated Farm, ``5`` Dry Farm, ``6`` Recreational,
  ``7`` Institutional, ``8`` Miscellaneous. The second character refines it (``05`` = ``Five or More
  Units or Apartments (Any Combination)``, ``11`` Store, ``17`` Office Building, ``31`` Light
  Manufacturing, ``33`` Warehousing...), the third and fourth add design and amenities. ``Property
  Use Type`` is the publisher's coarse class: ``SFR``, ``CND``, ``R-I`` (residential income),
  ``C/I``, ``OTH``, ``VAC`` (vacant land, which also carries the use code of its zoning, e.g.
  ``050V``, ``100V``).
- Situs: ``Address House Number``, ``Address House Number Fraction``, ``Direction``, ``Street``,
  ``Unit Number``, ``City`` (already carries the state, ``LOS ANGELES CA``), and two columns both
  aliased ``Zip Code`` (ZIP+4 first, five-digit ZIP later: the later one wins in ``csv.DictReader``).
  ``Property Location`` is the same address on one line.
- Values: ``Land Value``, ``Improvement Value``, and ``Total Value Land Improvement`` are the roll
  (assessed, Proposition 13 factored base-year) values of the real property; ``Total Value`` adds
  fixtures and personal property. California publishes no market value, so these go to
  ``appraised_value`` and ``market_value`` stays empty.
- ``Square Footage`` (main building area), ``Year Built``, ``Number of Units``. There is no land
  area in the file.
- **No owner of record**: the public file carries no owner name, mailing address, or
  confidentiality flag, so every record is ownerless.

Mapping to the registry's categories: use codes ``05xx`` (five or more units) → ``B``; ``1xxx`` and
``2xxx`` (commercial) → ``F1``; ``3xxx`` (industrial) → ``F2``; rows whose ``Property Use Type`` is
``VAC`` (vacant land) are out of scope, as are all other codes. The publisher's code is kept in
``local_use_code``.

Usage: ``python -m factlot.registry.adapters.ca_los_angeles collected/ca-los-angeles-assessor/<sha>/csv ... registry.db --as-of 2026-10-14``
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "06"
COUNTY_FIPS = "037"
ACCOUNT_SYSTEM = "la_ain"

SOURCE = Source(
    source_id="ca-los-angeles-assessor",
    publisher="Los Angeles County Office of the Assessor",
    title="Assessor Parcel Data Roll 2026 (County of Los Angeles Open Data)",
    url="https://data.lacounty.gov/datasets/lacounty::assessor-parcel-data-roll-2026/about",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="County of Los Angeles eGIS Hub Terms of Use: license to copy, publish, distribute, transmit, adapt "
            "and exploit the data for commercial and/or personal use; provided as is",
    ai_use="unknown",  # not addressed by the publisher; the license permits adaptation and commercial use
    redistribution="permitted",  # explicit license to copy, publish, distribute and transmit
    attribution="County of Los Angeles, Office of the Assessor. Assessor Parcel Data Roll 2026 [dataset]. "
                "County of Los Angeles Open Data, https://data.lacounty.gov",
    terms_reviewed="2026-11-02",
)

# The publisher's first use-code character → registry category (data policy §3). ``05`` is the
# only residential prefix in scope: ``Five or More Units or Apartments (Any Combination)``.
_FIRST_CHAR_CATEGORY = {"1": "F1", "2": "F1", "3": "F2"}
_MULTIFAMILY_PREFIX = "05"
_VACANT_USE_TYPE = "VAC"


def state_category(use_code: str | None, use_type: str | None = None) -> str | None:
    """Registry category for an Assessor use code, or ``None`` when the parcel is out of scope.

    >>> state_category("0500"), state_category("1700"), state_category("3300"), state_category("0100")
    ('B', 'F1', 'F2', None)
    >>> state_category("100V", "VAC") is None
    True
    """
    code = (use_code or "").strip().upper()
    if not code or (use_type or "").strip().upper() == _VACANT_USE_TYPE:
        return None
    if code.startswith(_MULTIFAMILY_PREFIX):
        return "B"
    return _FIRST_CHAR_CATEGORY.get(code[0])


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Stream the rows of one export (or of every ``*.csv`` directly inside a directory).

    Header names are stripped of surrounding whitespace (the export spells one `` Location
    Longitude``); when a name repeats (``Zip Code`` twice) the later column wins, as in
    ``csv.DictReader``.
    """
    csv.field_size_limit(1 << 30)
    p = Path(path)
    files = sorted(p.glob("*.csv")) if p.is_dir() else [p]
    for f in files:
        with open(f, newline="", encoding="utf-8-sig") as fh:
            reader = csv.reader(fh)
            header = [h.strip() for h in next(reader, [])]
            for values in reader:
                if not any(v.strip() for v in values):
                    continue  # the export pads the roll with entirely blank rows
                yield dict(zip(header, values))


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years, and counts: the Assessor writes 0 when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _situs(r: dict[str, str]) -> str | None:
    street = r.get("Street", "").strip()
    if not street:
        return None
    number = r.get("Address House Number", "").strip()
    number = "" if number in ("", "0") else number
    fraction = r.get("Address House Number Fraction", "").strip()
    unit = r.get("Unit Number", "").strip()
    line = " ".join(x for x in (number, fraction, r.get("Direction", "").strip(), street) if x)
    if unit:
        line = f"{line} UNIT {unit}"
    city = r.get("City", "").strip()  # already "LOS ANGELES CA"
    zip5 = r.get("Zip Code", "").strip()[:5]
    rest = " ".join(x for x in (city, zip5) if x)
    return f"{line}, {rest}" if rest else line


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2);
    ``None`` keeps every non-blank row, with ``state_category`` empty for out-of-scope use codes.
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    for r in _rows(path):
        ain = r.get("AIN", "").strip()
        if not ain:
            continue
        code = r.get("Property Use Code", "").strip() or None
        category = state_category(code, r.get("Property Use Type"))
        if keep is not None and category not in keep:
            continue
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=ain,
            state_category=category,
            account=ain,
            situs_address=_situs(r),
            owner_name=None,  # the public file carries no owner of record
            owner_mailing_address=None,
            owner_confidential=False,
            land_area_sf=None,  # not published
            improvement_area_sf=_positive(r.get("Square Footage")),
            year_built=int(y) if (y := _positive(r.get("Year Built"))) else None,
            market_value=None,  # California publishes assessed (base-year) values, not market estimates
            appraised_value=_num(r.get("Total Value Land Improvement")),
            tax_year=int(y) if (y := _num(r.get("Roll Year"))) else None,
            locator=f"Row ID {r.get('Row ID', '').strip() or ain}",
            local_use_code=code,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived export into a registry file (created if missing).

    The roll arrives as several use-code-filtered exports, so the default is ``full_roll=False``:
    no parcel is retired for being absent from one piece. Pass ``full_roll=True`` only for a file
    that holds the whole roll.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ca_los_angeles", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="archived CSV export(s) as saved by the collector (one snapshot each)")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="roll date, YYYY-MM-DD (the item's modified date on the portal)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full", action="store_true", help="the file is the whole roll: retire parcels missing from it")
    args = ap.parse_args(argv)
    out = {}
    for path in args.snapshot:
        stats = build(path, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full)
        out[path] = asdict(stats)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
