"""Texas appraisal "external" extract (tab-delimited ``external*.tab`` files) → ``ParcelRecord``.

Two districts that changed appraisal systems in 2026 publish their certified roll as the same extract: Bell
(``tx_bell``) and Johnson (``tx_johnson``). The publishers post no layout for it; what follows was measured on
their files (Bell 2026-10-01, Johnson 2026-08-10 and 2026-04-27) on 2026-11-12.

The zip holds tab-delimited text files with a header row, Latin-1, CRLF line ends and no quoting (Bell puts them in
a folder named for the roll, ``2026 Bell County Certified Export/``; Johnson at the top level). Only two are read:

- ``externalnal.tab``: one row per account, or one per account and building (Johnson repeats an account once per
  building, differing in ``YEAR_BUILT`` and agent columns). The account key is ``PARCEL ID`` (Bell) or ``ACCOUNT``
  (Johnson); each county's module names it, and both equal the key of the district's earlier rolls. ``NAME`` is the
  owner of record and ``MAIL ADDRESS LINE 1``, ``MAIL ADDRESS LINE 2``, ``MAIL CITY``, ``MAIL STATE``, ``MAIL ZIP``
  its mailing address; ``NAME2`` (a second owner or a "C/O" line) is not read. There is no confidentiality column; a
  withheld owner is written into ``NAME`` (Bell: ``CONFIDENTIAL OWNER``), and a name containing ``CONFIDENTIAL`` is
  treated as withheld (no owner and no address stored). ``SITUS STREET NUM``, ``SITUS STREET NAME``,
  ``SITUS STREET SFX``, ``SITUS UNIT``, ``SITUS CITY`` give the situs (no ZIP). ``PARCEL USE CD`` is the district's
  state code for the account; each county's module maps it to the Comptroller category with the district's own
  table, and a code the table does not list is left out, not guessed. ``NBHD CD`` is the district's neighborhood
  code (``parcel.neighborhood_code``). ``LAND SQFT``, ``BLDG HEAT AREA`` (heated building area), ``YEAR_BUILT``,
  ``MKT VAL`` and ``APPRAISED VAL`` are the figures read. A row with the wrong number of columns (a tab or line break
  inside a field) is left out and counted.
- ``externalacreage.tab`` (``parcel_id``, ``strap``, ``Acreage``): the land area of an account whose ``LAND SQFT`` is
  empty or 0.

Not read: ``externalowner.tab`` (every owner's name), ``externallegal.tab``, ``externalsale.tab`` (grantor and
grantee names), ``externalexemptions.tab``, ``externaldates.tab``, the building and extra-feature files, and any
business personal property extract.

The extract names no tax year. When the zip's file name or the member's folder names a year, it must be the year
the caller gives; otherwise the caller's year (from the publisher's download page) is used.
"""

from __future__ import annotations

import contextlib
import csv
import io
import re
import zipfile
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from ..normalize import is_commercial
from ..store import IngestStats, ParcelRecord, ParcelValues, Registry, Source, roll_source

STATE_FIPS = "48"
NAL = "EXTERNALNAL.TAB"
ACREAGE = "EXTERNALACREAGE.TAB"
_SQFT_PER_ACRE = 43_560
_CONFIDENTIAL = re.compile(r"\bCONFIDENTIAL\b", re.I)


@dataclass(frozen=True)
class TabExtract:
    """One district's use of the extract: its source, account key column and state-code table."""

    source: Source
    county_fips: str
    account_system: str
    id_column: str
    state_code_ptd: Mapping[str, str]


@dataclass
class ExtractTally:
    """Drops measured while reading. Not a county-wide denominator."""

    rows: int = 0
    malformed: int = 0
    repeated_rows: int = 0
    unmapped_code: int = 0
    out_of_scope: int = 0
    kept: int = 0
    confidential: int = 0
    local_codes: dict[str, int] = field(default_factory=dict)


def _member(path: Path, suffix: str) -> str | None:
    if path.is_dir():
        names = [str(f.relative_to(path)) for f in path.rglob("*") if f.is_file()]
    else:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
    hit = [n for n in names if n.upper().endswith(suffix)]
    if len(hit) > 1:
        raise ValueError(f"more than one {suffix} in {path}")
    return hit[0] if hit else None


def rows(path: str | Path, suffix: str) -> tuple[str | None, Iterator[dict[str, str] | None]]:
    """(member name, rows as dicts keyed by the header). A row with the wrong number of columns is ``None``."""
    p = Path(path)
    name = _member(p, suffix)
    if name is None:
        return None, iter(())

    def gen() -> Iterator[dict[str, str] | None]:
        with contextlib.ExitStack() as stack:
            if p.is_dir():
                raw = stack.enter_context(open(p / name, "rb"))
            else:
                raw = stack.enter_context(stack.enter_context(zipfile.ZipFile(p)).open(name))
            reader = csv.reader(io.TextIOWrapper(raw, encoding="latin-1", newline=""), delimiter="\t",
                                quoting=csv.QUOTE_NONE)
            header = [h.strip() for h in next(reader, [])]
            for row in reader:
                if not row:
                    continue
                yield dict(zip(header, row)) if len(row) == len(header) else None

    return name, gen()


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(" ".join((r.get("SITUS STREET NAME", ""), r.get("SITUS STREET SFX", ""))))
    if not street:
        return None
    line = _squeeze(" ".join((r.get("SITUS STREET NUM", ""), street, r.get("SITUS UNIT", ""))))
    city = _squeeze(r.get("SITUS CITY"))
    return f"{line}, {city} TX" if city else f"{line}, TX"


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [r.get("MAIL ADDRESS LINE 1", ""), r.get("MAIL ADDRESS LINE 2", "")]
    state_zip = " ".join(x for x in (_squeeze(r.get("MAIL STATE")), _squeeze(r.get("MAIL ZIP"))) if x)
    lines.append(", ".join(x for x in (_squeeze(r.get("MAIL CITY")), state_zip) if x))
    return ", ".join(_squeeze(x) for x in lines if _squeeze(x)) or None


def check_year(path: str | Path, member: str, tax_year: int) -> None:
    """Refuse a file whose name or folder names another tax year than the caller's. A year that starts a date
    (``2026-04-27``, the export date in ``JCAD-2025-Certified-Data-2026-04-27.zip``) is not a tax year."""
    years = set(re.findall(r"(?<!\d)(20\d\d)(?!\d)(?![-_.]\d\d[-_.]\d\d)", f"{Path(path).name}/{member}"))
    if years and years != {str(tax_year)}:
        raise ValueError(f"{Path(path).name}/{member}: names tax year(s) {sorted(years)}, not {tax_year}")


def _key(r: dict[str, str], id_column: str) -> str:
    return (r.get(id_column) or "").strip().lstrip("0")


def read_roll(path: str | Path, county: TabExtract, tax_year: int,
              tally: ExtractTally | None = None) -> Iterator[ParcelRecord]:
    """Yield one commercial real-property record per account. The first row of an account wins; its year built is
    the earliest of its rows (one row per building)."""
    tally = tally if tally is not None else ExtractTally()
    name, nal = rows(path, NAL)
    if name is None:
        raise ValueError(f"no externalnal.tab in {path}")
    check_year(path, name, tax_year)
    kept: dict[str, dict[str, str]] = {}
    skipped: set[str] = set()
    built: dict[str, int] = {}
    for r in nal:
        tally.rows += 1
        if r is None:
            tally.malformed += 1
            continue
        pid = _key(r, county.id_column)
        if not pid:
            tally.malformed += 1
            continue
        if pid in kept or pid in skipped:
            tally.repeated_rows += 1
            if pid in kept and (y := _positive(r.get("YEAR_BUILT"))) and 1700 < y <= tax_year + 1:
                built[pid] = min(built.get(pid, int(y)), int(y))
            continue
        local = (r.get("PARCEL USE CD") or "").strip().upper()
        category = county.state_code_ptd.get(local)
        if category is None:
            tally.unmapped_code += 1
            skipped.add(pid)
            continue
        if not is_commercial(category):
            tally.out_of_scope += 1
            skipped.add(pid)
            continue
        r["_code"], r["_category"] = local, category
        kept[pid] = r
        if (y := _positive(r.get("YEAR_BUILT"))) and 1700 < y <= tax_year + 1:
            built[pid] = int(y)
        tally.kept += 1
        tally.local_codes[local] = tally.local_codes.get(local, 0) + 1
    acres: dict[str, float] = {}
    _, acre_rows = rows(path, ACREAGE)
    for r in acre_rows:
        if r is None:
            continue
        pid = _key(r, "parcel_id")
        if pid in kept and pid not in acres and (a := _positive(r.get("Acreage"))):
            acres[pid] = a
    for pid, r in kept.items():
        owner = _squeeze(r.get("NAME")) or None
        confidential = bool(owner and _CONFIDENTIAL.search(owner))
        if confidential:
            tally.confidential += 1
            owner = None
        land_sf = _positive(r.get("LAND SQFT"))
        if land_sf is None and pid in acres:
            land_sf = acres[pid] * _SQFT_PER_ACRE
        nbhd = _squeeze(r.get("NBHD CD"))
        yield ParcelRecord(
            county_fips=county.county_fips,
            apn=pid,
            state_category=r["_category"],
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=confidential,
            land_area_sf=round(land_sf, 2) if land_sf else None,
            improvement_area_sf=_positive(r.get("BLDG HEAT AREA")),
            year_built=built.get(pid),
            market_value=_num(r.get("MKT VAL")),
            appraised_value=_num(r.get("APPRAISED VAL")),
            tax_year=tax_year,
            locator=f"externalnal.tab {county.id_column} {pid}",
            local_use_code=r["_code"],
            extra_facts=[("parcel.neighborhood_code", nbhd, None)] if nbhd else [],
        )


def read_value_history(path: str | Path, county: TabExtract, accounts: Iterable[str], tax_year: int,
                       tally: ExtractTally | None = None) -> Iterator[ParcelValues]:
    """Each listed account's market and appraised value from an earlier year's extract, and nothing else.

    For ``Registry.ingest_value_history``: only the account key and the two value columns are read (no owner,
    address or area). The first row of an account wins.
    """
    tally = tally if tally is not None else ExtractTally()
    name, nal = rows(path, NAL)
    if name is None:
        raise ValueError(f"no externalnal.tab in {path}")
    check_year(path, name, tax_year)
    wanted = frozenset(accounts)
    seen: set[str] = set()
    for r in nal:
        tally.rows += 1
        if r is None:
            tally.malformed += 1
            continue
        pid = _key(r, county.id_column)
        if pid not in wanted:
            tally.out_of_scope += 1
            continue
        if pid in seen:
            tally.repeated_rows += 1
            continue
        seen.add(pid)
        tally.kept += 1
        yield ParcelValues(county_fips=county.county_fips, apn=pid, tax_year=tax_year,
                           market_value=_num(r.get("MKT VAL")), appraised_value=_num(r.get("APPRAISED VAL")),
                           locator=f"externalnal.tab {county.id_column} {pid}")


def build(snapshot_path: str | Path, db_path: str | Path, county: TabExtract, *, as_of: str, tax_year: int,
          retrieved_at: str | None = None) -> tuple[IngestStats, ExtractTally]:
    """Ingest one archived extract as the county's current roll (registry file created if missing)."""
    tally = ExtractTally()
    reg = Registry(db_path)
    try:
        stats = reg.ingest_roll(county.source, snapshot_path, read_roll(snapshot_path, county, tax_year, tally),
                                as_of=as_of, retrieved_at=retrieved_at, state_fips=STATE_FIPS,
                                account_system=county.account_system, full_roll=True)
    finally:
        reg.close()
    return stats, tally


def build_history(snapshot_path: str | Path, db_path: str | Path, county: TabExtract, *, as_of: str,
                  tax_year: int, retrieved_at: str | None = None) -> tuple[IngestStats, ExtractTally]:
    """Add one earlier year's values from an archived extract to the county's parcels already loaded (history only)."""
    tally = ExtractTally()
    reg = Registry(db_path)
    try:
        src = roll_source(county.source, tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute("SELECT external_id FROM crosswalk WHERE system = ?",
                                                     (county.account_system,))]
        stats = reg.ingest_value_history(read_value_history(snapshot_path, county, accounts, tax_year, tally), snap,
                                         state_fips=STATE_FIPS)
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats, tally
    finally:
        reg.close()
