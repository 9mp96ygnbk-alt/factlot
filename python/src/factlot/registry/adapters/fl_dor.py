"""Florida Department of Revenue NAL (Name-Address-Legal) roll: ``<County> <nn> Final NAL <year>.zip`` → ``ParcelRecord``.

The Department of Revenue's Property Tax Oversight program publishes every county's real property
assessment roll in one statewide layout (s. 193.114, F.S.), so this one adapter covers all 67
counties; the county comes from the file itself. Layout (confirmed on the 2026 final rolls,
2026-11-02, against the Department's *2026 User's Guide, Department Property Tax Data Files*): a zip
holding one comma-delimited, header-row CSV (``NAL<nn>F<year>01.csv``), 167 columns, one row per
parcel.

- ``CO_NO`` — the Department's two-digit county number (11 Alachua … 77 Washington; Miami-Dade is
  23, filed under "Dade"). ``_COUNTY_FIPS`` maps it to the Census county FIPS.
- ``PARCEL_ID`` — the property appraiser's parcel number, up to 26 alphanumerics, formatted as the
  county formats it (``0131230120020`` in Miami-Dade, ``494221010010`` in Broward). It is the
  parcel key and the ``fl_parcel_id`` account.
- ``ASMNT_YR`` — assessment year (January 1 of that year).
- ``DOR_UC`` — the Department's three-digit land use code (``000``–``099``; Field 8 of the guide),
  assigned by the property appraiser by predominant use. ``_STATE_CATEGORY`` maps it to the
  registry's categories; ``PA_UC`` is the county's own finer code and is not used.
- ``JV`` just value (the appraiser's opinion of market value under s. 193.011), ``AV_NSD``
  assessed value for non-school levies, ``TV_NSD`` taxable value.
- ``LND_SQFOOT`` land square footage (blank for condominiums, cooperatives and HOA common
  property); ``LND_UNTS_CD`` / ``NO_LND_UNTS`` the basis of land valuation.
- ``ACT_YR_BLT`` actual year built, ``EFF_YR_BLT`` effective year built, ``TOT_LVG_AREA`` total
  effective area of all improvements in square feet (base area plus factored secondary areas, so
  not a gross building area), ``NO_BULDNG``, ``NO_RES_UNTS``.
- Owner: ``OWN_NAME`` (primary owner only, 50 characters), ``OWN_ADDR1``, ``OWN_ADDR2``,
  ``OWN_CITY``, ``OWN_STATE`` (state, territory or country), ``OWN_ZIPCD`` (blank outside the US),
  ``OWN_STATE_DOM``. The fiduciary columns (``FIDU_*``) are blank since 2012.
- Situs: ``PHY_ADDR1``, ``PHY_ADDR2``, ``PHY_CITY``, ``PHY_ZIPCD``. The file has no situs state
  column; it is Florida.
- The Department removes parcels whose owners are exempt from disclosure under s. 119.071, F.S.,
  before publishing, so the file carries no confidentiality flag; a county may still publish a
  placeholder name instead, which ``_owner`` treats as withheld.

Usage: ``python -m factlot.registry.adapters.fl_dor "Dade 23 Final NAL 2026.zip" registry.db --as-of 2026-10-28``
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

STATE_FIPS = "12"
ACCOUNT_SYSTEM = "fl_parcel_id"

SOURCE = Source(
    source_id="fl-dor-nal",
    publisher="Florida Department of Revenue, Property Tax Oversight",
    title="Real property assessment roll, NAL (Name-Address-Legal) file, one per county",
    url="https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx",
    state_fips=STATE_FIPS,
    county_fips=None,  # statewide layout; the county comes from each file's CO_NO
    license="Public record (ch. 119, F.S.); the site's Conditions of Use say non-commercial use only, "
            "which a person must reconcile with the public-record status (docs/registry/sources/fl-dor-nal.md)",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # public record, but the site's Conditions of Use forbid redistribution of site material
    attribution="Florida Department of Revenue, Property Tax Oversight",
    terms_reviewed="2026-11-02",
)

# Department county number (CO_NO, assigned before Dade County was renamed) → Census county FIPS.
# The numbers run alphabetically 11–77 and the FIPS codes run alphabetically 001–133 in steps of
# two, except that Miami-Dade (23, filed as "Dade") is 086.
_COUNTY_FIPS: dict[str, str] = {f"{n:02d}": f"{2 * (n - 11) + 1:03d}" for n in range(11, 78)}
_COUNTY_FIPS["23"] = "086"

# DOR land use code (three digits, Field 8 of the user's guide) → FactLot category. The guide's
# "Commercial" group is 003 and 010–039, its "Industrial" group 040–049; 010 and 040 are vacant
# land and stay out of scope, as Texas category C1 does. 008 (multifamily, fewer than 10 units)
# sits in the guide's "Residential" group but is the publisher's small-multifamily class.
_STATE_CATEGORY: dict[str, str] = {
    "003": "B",  # Multi-family - 10 units or more
    "008": "B",  # Multi-family - fewer than 10 units
    **{f"{c:03d}": "F1" for c in range(11, 40)},  # 011 stores … 039 hotels, motels
    **{f"{c:03d}": "F2" for c in range(41, 50)},  # 041 light manufacturing … 049 open storage
}

# Names a property appraiser may publish in place of an owner whose record is withheld under
# s. 119.071, F.S., or when it has no owner of record. Matched on the whole, squeezed name.
_WITHHELD_OWNERS = re.compile(r"^(CONFIDENTIAL|WITHHELD|EXEMPT|PROTECTED|NAME WITHHELD|OWNER WITHHELD|"
                              r"CONFIDENTIAL OWNER|OWNER CONFIDENTIAL|CONFIDENTIAL PER (S\.? ?)?119\.?071.*|"
                              r"(S\.? ?)?119\.?071.*|EXEMPT PER (S\.? ?)?119\.?071.*)$")
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "CURRENT OWNER", "N/A", "NONE"})


def _rows(path: str | Path) -> Iterator[tuple[str, dict[str, str]]]:
    """Stream ``(member name, row)`` from each CSV member of the zip, or from an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for member in sorted(p.glob("*.csv")):
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
    """Areas and years: a blank or 0 entry means 'no figure', which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def use_code(raw: str | None) -> str | None:
    """The DOR land use code as a three-digit string (``3`` and ``03`` are ``003``); blank → None."""
    c = _squeeze(raw)
    if not c:
        return None
    return c.zfill(3) if c.isdigit() else c.upper()


def state_category(dor_uc: str | None) -> str | None:
    """FactLot category for a DOR land use code: ``B``, ``F1``, ``F2``, or None when out of scope."""
    c = use_code(dor_uc)
    return _STATE_CATEGORY.get(c) if c else None


def county_fips(co_no: str | None) -> str | None:
    """Census county FIPS for a Department county number (``23`` → ``086``)."""
    c = _squeeze(co_no)
    return _COUNTY_FIPS.get(c.zfill(2)) if c else None


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("PHY_ADDR1"))
    if not street:
        return None
    line = " ".join(x for x in (street, _squeeze(r.get("PHY_ADDR2"))) if x)
    city = _squeeze(r.get("PHY_CITY"))
    rest = " ".join(x for x in (city, "FL", _squeeze(r.get("PHY_ZIPCD"))) if x)
    return f"{line}, {rest}"


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [_squeeze(r.get("OWN_ADDR1")), _squeeze(r.get("OWN_ADDR2"))]
    city = _squeeze(r.get("OWN_CITY"))
    state_zip = " ".join(x for x in (_squeeze(r.get("OWN_STATE")), _squeeze(r.get("OWN_ZIPCD"))) if x)
    lines.append(", ".join(x for x in (city, state_zip) if x))
    return ", ".join(x for x in lines if x) or None


def _owner(name: str | None) -> tuple[str | None, bool]:
    """``(owner_name, owner_confidential)`` for an ``OWN_NAME`` entry."""
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None, False
    if _WITHHELD_OWNERS.match(n.upper()):
        return None, True
    return n, False


def _land_area(r: dict[str, str]) -> float | None:
    """``LND_SQFOOT``; when blank, ``NO_LND_UNTS`` if the land unit code says it is in square feet."""
    land = _positive(r.get("LND_SQFOOT"))
    if land is None and _squeeze(r.get("LND_UNTS_CD")) == "2":
        land = _positive(r.get("NO_LND_UNTS"))
    return land


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real-property parcel in scope, in file order.

    ``categories`` limits the rows kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every parcel, with ``state_category`` None for out-of-scope use codes.
    Rows whose ``CO_NO`` is not a Department county number are skipped.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    for member, r in _rows(path):
        fips = county_fips(r.get("CO_NO"))
        parcel = _squeeze(r.get("PARCEL_ID"))
        if not fips or not parcel:
            continue
        code = use_code(r.get("DOR_UC"))
        category = state_category(code)
        if not keep(category):
            continue
        owner_name, confidential = _owner(r.get("OWN_NAME"))
        yield ParcelRecord(
            county_fips=fips,
            apn=parcel,
            state_category=category,
            account=parcel,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=confidential,
            land_area_sf=_land_area(r),
            improvement_area_sf=_positive(r.get("TOT_LVG_AREA")),
            year_built=int(y) if (y := _positive(r.get("ACT_YR_BLT"))) else None,
            market_value=_num(r.get("JV")),
            appraised_value=_num(r.get("AV_NSD")),
            tax_year=int(y) if (y := _num(r.get("ASMNT_YR"))) else None,
            locator=f"{member} PARCEL_ID {parcel}",
            local_use_code=code,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = False) -> IngestStats:
    """Ingest one archived county NAL zip into a registry file (created if missing).

    Each zip is one county's roll while the source covers the state, so ``full_roll`` defaults to
    False: a county file must not retire the other counties' parcels. Pass ``full_roll=True`` only
    when ingesting a snapshot that holds every county the registry has loaded from this source.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.fl_dor", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to one '<County> <nn> Final NAL <year>.zip' as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="roll date, YYYY-MM-DD (the file's Last-Modified date on the data portal)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true",
                    help="retire parcels of this source missing from this file (only for a snapshot that holds every county loaded)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
