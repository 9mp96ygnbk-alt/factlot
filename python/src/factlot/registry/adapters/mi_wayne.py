"""Wayne County, Michigan (Detroit): annual assessment export → ``ParcelRecord``.

Layout (confirmed on the 2026 files, 2026-11-02): the county's Equalization Division publishes one
zip per municipality and one county-wide zip (``2026-wayne-county-assessments-names-addresses-legal.zip``,
132 MB) on its Annual Assessment Data page. Each zip holds one or more quoted CSV files with a
130-column header row, one row per parcel **or personal-property account**, exported from the
BS&A assessing system (column names are ``Table.field``: ``Parcels.*``, ``ParcelMaster.*``,
``ParcelReadonly.*``). The last line of each file is a lone 0x1A end-of-file byte, which is skipped.

- ``Parcels.pnum`` — the Wayne County parcel number (``31 084 01 0212 001``; the first two digits
  are the municipality's county code). It is the parcel key and the ``wayne_parcel_no`` crosswalk.
- ``ParcelMaster.r_or_p`` — ``0`` real property, ``1`` personal property (not a parcel).
- ``Parcels.propclass`` — the Michigan property classification (MCL 211.34c, State Tax
  Commission codes): ``1xx`` agricultural, ``2xx`` commercial, ``3xx`` industrial, ``4xx``
  residential, ``5xx`` timber-cutover, ``6xx`` developmental; ``x01`` improved, ``x02`` vacant,
  ``207`` commercial condominium, ``210`` commercial building on leased land; ``x51`` personal
  property. Michigan has no multifamily class: the STC's *Property Classification* guidance
  (December 2011) puts "apartment buildings or a complex with more than 4 units" in the commercial
  class and buildings of four or fewer units in the residential class. The code is kept verbatim
  in ``local_use_code``.
- ``ParcelMaster.cib_numcib``, ``cib_occ_String``, ``cib_floorarea``, ``cib_yearbuilt`` — the
  commercial/industrial building count, occupancy type, floor area, and year built.
  ``cib_occ_String`` is the BS&A occupancy enumeration whose default (``Apartment``) also appears on
  parcels with no commercial building, so it only counts when ``cib_numcib`` is at least 1.
  ``resb_*`` are the same for residential buildings.
- ``ParcelMaster.totalacres`` — land area in acres (``0`` when not given).
- ``ParcelMaster.esttcv`` — the assessor's estimated true cash value (market value; ``0`` for
  exempt parcels and where no estimate exists). ``ParcelReadonly.ass_1`` / ``mborsev_1`` / ``tax_1``
  are the assessed, state-equalized, and taxable values (50 % of true cash value by law) for the
  roll year; ``_2`` and ``_3`` are the two prior years. The registry has no field for them.
- Situs: ``ParcelMaster.propstreetcombined`` (``409 W COLUMBIA AVE``; blank when there is none),
  ``unitorapt``, ``propcity``, ``propstate``, ``propzip``.
- Owner: ``ParcelMaster.ownername1`` (line 1 is the owner of record; ``ownername2`` may be a
  co-owner, a continuation, or a care-of name and is not used), ``ownercareof``,
  ``ownerstreetaddr``, ``ownercity``, ``ownerstate``, ``ownerzip``. The file carries no
  confidentiality flag or withheld-owner marker.
- The roll year is not a column: it is taken from the file name (``2026-wayne-county-…``) or
  passed as ``tax_year``.

Usage: ``python -m factlot.registry.adapters.mi_wayne 2026-wayne-county-assessments-names-addresses-legal.zip registry.db --as-of 2026-06-05``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "26"
COUNTY_FIPS = "163"
ACCOUNT_SYSTEM = "wayne_parcel_no"

SOURCE = Source(
    source_id="mi-wayne-parcels",
    publisher="Wayne County, Michigan, Division of Assessment and Equalization",
    title="Annual assessment data (2026-wayne-county-assessments-*.zip)",
    url="https://www.waynecountymi.gov/Government/Departments/Management-Budget/Assessment-Equalization/Annual-Assessment-Data",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Michigan FOIA, MCL 15.231 et seq.; assessment rolls are public under the General "
            "Property Tax Act). The county web portal's terms of use allow saving materials for personal, "
            "non-commercial use only and prohibit use on another website; whether they apply to these bulk "
            "files is unresolved",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # the portal terms restrict reuse; the facts are public record; pending a licence decision
    attribution="Wayne County, Michigan, Division of Assessment and Equalization",
    terms_reviewed="2026-11-02",
)

# Michigan classification (first digit) → FactLot category. Real property only; a parcel whose
# commercial buildings are apartments becomes B (see ``state_category``).
_CATEGORY_BY_CLASS_PREFIX = {
    "1": "D1",  # agricultural (out of scope)
    "2": "F1",  # commercial
    "3": "F2",  # industrial
    "4": "A",   # residential (out of scope)
    "5": "D2",  # timber-cutover (out of scope)
    "6": "C1",  # developmental (out of scope)
}

# BS&A commercial-building occupancy types that are multifamily housing. Michigan classes
# apartment buildings of more than four units as commercial (2xx), so these parcels are category B.
_MULTIFAMILY_OCCUPANCIES = frozenset({"APARTMENT", "MULTIPLE RESIDENCES"})

# Owner names that stand for "no owner of record" rather than naming one.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER"})

_SQFT_PER_ACRE = 43560
_EOF_MARK = "\x1a"


def _rows(path: str | Path) -> Iterator[tuple[str, dict[str, str]]]:
    """Stream ``(member name, row)`` from every CSV member of the zip, or from an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for member in sorted(x for x in p.iterdir() if x.suffix.lower() == ".csv"):
            with open(member, newline="", encoding="latin-1") as f:
                for r in csv.DictReader(f):
                    yield member.name, r
        return
    with zipfile.ZipFile(p) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".csv"):
                continue
            with zf.open(name) as raw:
                for r in csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline="")):
                    yield name, r


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years, and values: the export writes 0 where it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def roll_year(path: str | Path) -> int | None:
    """The roll year in a file or directory name (``2026-wayne-county-assessments-…``), if any."""
    m = re.search(r"(?<!\d)(20\d\d)(?!\d)", Path(path).name)
    return int(m.group(1)) if m else None


def state_category(r: dict[str, str]) -> str | None:
    """FactLot category for a row: ``2xx`` → F1 (B when its buildings are apartments), ``3xx`` → F2.

    Residential, agricultural, timber-cutover, and developmental classes map to their nearest
    out-of-scope category; personal-property classes (``x51``) and unlisted codes map to ``None``.
    """
    code = _squeeze(r.get("Parcels.propclass"))
    if not code or code.endswith("51"):
        return None
    category = _CATEGORY_BY_CLASS_PREFIX.get(code[0])
    if category == "F1":
        buildings = _positive(r.get("ParcelMaster.cib_numcib"))
        occupancy = _squeeze(r.get("ParcelMaster.cib_occ_String")).upper()
        if buildings and occupancy in _MULTIFAMILY_OCCUPANCIES:
            return "B"
    return category


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("ParcelMaster.propstreetcombined"))
    if not street:
        return None
    unit = _squeeze(r.get("ParcelMaster.unitorapt"))
    line = " ".join(x for x in (street, unit) if x)
    city = _squeeze(r.get("ParcelMaster.propcity"))
    state = _squeeze(r.get("ParcelMaster.propstate")) or "MI"
    rest = " ".join(x for x in (city, state, _squeeze(r.get("ParcelMaster.propzip"))) if x)
    return f"{line}, {rest}" if rest else line


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def _mailing_address(r: dict[str, str]) -> str | None:
    care_of = _squeeze(r.get("ParcelMaster.ownercareof"))
    street = _squeeze(r.get("ParcelMaster.ownerstreetaddr"))
    city = _squeeze(r.get("ParcelMaster.ownercity"))
    state_zip = " ".join(x for x in (_squeeze(r.get("ParcelMaster.ownerstate")),
                                     _squeeze(r.get("ParcelMaster.ownerzip")).rstrip("-")) if x)
    return ", ".join(x for x in (care_of, street, city, state_zip) if x) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              tax_year: int | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real-property parcel in scope, in file order.

    ``categories`` limits the parcels kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every real-property parcel. ``tax_year`` defaults to the year in the
    file name. A parcel number repeated across members (none seen in the 2026 files) is kept once.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    year = tax_year if tax_year is not None else roll_year(path)
    seen: set[str] = set()
    for member, r in _rows(path):
        pnum = _squeeze(r.get("Parcels.pnum"))
        if not pnum or pnum.startswith(_EOF_MARK) or pnum in seen:
            continue
        if _squeeze(r.get("ParcelMaster.r_or_p")) != "0":
            continue  # personal property
        category = state_category(r)
        if not keep(category):
            continue
        seen.add(pnum)
        owner_name = _owner(r.get("ParcelMaster.ownername1"))
        acres = _positive(r.get("ParcelMaster.totalacres"))
        area = sum(a for a in (_positive(r.get("ParcelMaster.cib_floorarea")),
                               _positive(r.get("ParcelMaster.resb_floorarea"))) if a)
        years = [int(y) for y in (_positive(r.get("ParcelMaster.cib_yearbuilt")),
                                  _positive(r.get("ParcelMaster.resb_yearbuilt"))) if y]
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pnum,
            state_category=category,
            account=pnum,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the export carries no confidentiality flag
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=area or None,
            year_built=min(years) if years else None,
            market_value=_positive(r.get("ParcelMaster.esttcv")),
            tax_year=year,
            locator=f"{member} pnum {pnum}",
            local_use_code=_squeeze(r.get("Parcels.propclass")) or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True, tax_year: int | None = None) -> IngestStats:
    """Ingest one archived assessment zip into a registry file (created if missing).

    Pass ``full_roll=False`` for a single-municipality zip: it covers one city or township, so it
    must not retire the parcels of the others.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, tax_year=tax_year), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.mi_wayne", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to a 2026-wayne-county-assessments-*.zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the file's Last-Modified date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--tax-year", type=int, help="roll year when the file name does not carry it")
    ap.add_argument("--partial", action="store_true",
                    help="do not retire parcels missing from this file (use for a single-municipality zip)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  full_roll=not args.partial, tax_year=args.tax_year)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
