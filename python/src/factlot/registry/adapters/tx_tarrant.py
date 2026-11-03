"""Tarrant Appraisal District (Fort Worth): ``PropertyData(Delimited).ZIP`` → ``ParcelRecord``.

Layout (confirmed on the 2026 certified files, 2026-11-02): each zip holds one pipe-delimited,
header-row text file with CRLF line endings and UTF-8 bytes, 58 columns, one row per account
**and deed record** (an account with several recorded instruments repeats its row; only
``Instrument_No``, ``Deed_Book``, and ``Deed_Page`` differ). Fields that contain a quote are wrapped
in quotes with the inner quotes doubled, as in CSV. ``PropertyData(Delimited).ZIP`` is the full set;
``PropertyData(Delimited)_C.ZIP`` is the rows of the commercial division only.

- ``RP`` — the appraisal division: ``R`` residential, ``C`` commercial, ``P`` business personal
  property, ``M`` minerals, or blank (minerals and utilities). Only ``R`` and ``C`` are real property.
- ``Account_Num`` — the TAD account number (4–8 digits), the parcel key. ``PIDN`` is the legacy
  geographic ID (``14437----2----1``), ``GIS_Link`` its short form.
- ``State_Use_Code`` (identical to ``Property_Class``) — TAD's own class code, which refines the
  Comptroller's state property category with a division suffix: ``BC`` multifamily commercial,
  ``C1C`` vacant commercial land, ``C2C``, ``EC``, ``AC``, ``ROC``; ``F1`` and ``F2`` carry no suffix.
  The publisher's code table (``APPRAISAL_STATE_CODE.TXT`` in its True Prodigy export) maps each to
  the Comptroller category; ``_STATE_CATEGORY`` below is transcribed from it. Multifamily coded plain
  ``B`` sits in the residential division, so the commercial extract alone does not reach it.
- Owner: ``Owner_Name``, ``Owner_Address``, ``Owner_CityState`` (``FORT WORTH ,  TX``), ``Owner_Zip``
  (``76102`` or ``76102-6311``). ``UNKNOWN`` is a placeholder, not an owner. The file carries no
  confidentiality flag and no withheld-owner marker (Tax Code §25.025 accounts are not identifiable).
- ``Situs_Address`` — street line only (``117 E BELKNAP ST``; ``0`` where there is no number). There
  is no situs city or ZIP column; ``City`` and ``County`` are taxing-unit codes.
- ``Land_SqFt``, ``Land_Acres``, ``Gross_Building_Area``, ``Year_Built`` (``0`` when unknown),
  ``Total_Value`` (= ``Land_Value`` + ``Improvement_Value``), ``Appraised_Value``, ``Appraisal_Year``.

Usage: ``python -m factlot.registry.adapters.tx_tarrant "PropertyData(Delimited)_C.ZIP" registry.db --as-of 2026-11-02``
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

STATE_FIPS = "48"
COUNTY_FIPS = "439"
ACCOUNT_SYSTEM = "tad_account"

SOURCE = Source(
    source_id="tx-tarrant-ad",
    publisher="Tarrant Appraisal District",
    title="Property data export (PropertyData(Delimited).ZIP; _C is the commercial division)",
    url="https://www.tad.org/resources/data-downloads",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated. "
            "robots.txt Content-Signal: search=yes, ai-train=no, use=reference",
    ai_use="unknown",  # the publisher signals no AI training and allows use as reference; the registry does not train
    redistribution="unknown",  # not addressed; public record
    attribution="Tarrant Appraisal District",
    terms_reviewed="2026-11-02",
)

# Real-property divisions. P (business personal property) and M (minerals) are not parcels.
_REAL_PROPERTY_DIVISIONS = frozenset({"R", "C"})

# TAD class code → Comptroller state property category, from the publisher's own code table
# (APPRAISAL_STATE_CODE.TXT, 2026). Real-property codes only; a code not listed here is kept as is.
_STATE_CATEGORY = {
    "A": "A", "AC": "A", "RO": "A",
    "B": "B", "BC": "B",
    "C1": "C1", "C1C": "C1", "C2C": "C1",
    "D1": "D1", "D2": "D2",
    "E": "E", "EC": "E",
    "F1": "F1", "F1C": "F1", "F1X": "F1", "ROC": "F1",
    "F2": "F2",
    "G1": "G1",
    "M1": "M1", "O": "O", "X": "X",
    **{f"J{i}{s}": f"J{i}" for i in range(1, 9) for s in ("", "C", "X")},
}

# Owner names TAD uses when it has no owner of record: the parcel keeps no owner name.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN"})

_SQFT_PER_ACRE = 43560


def _rows(path: str | Path) -> Iterator[tuple[str, dict[str, str]]]:
    """Stream ``(member name, row)`` from the zip's text member, or from an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for member in sorted(p.glob("*.txt")):
            with open(member, newline="", encoding="utf-8", errors="replace") as f:
                for r in csv.DictReader(f, delimiter="|"):
                    yield member.name, r
        return
    with zipfile.ZipFile(p) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".txt"):
                continue
            with zf.open(name) as raw:
                for r in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""),
                                        delimiter="|"):
                    yield name, r


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: TAD writes 0 (or leaves blank) when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def state_category(code: str | None) -> str | None:
    """Comptroller category for a TAD ``State_Use_Code`` (``BC`` → ``B``); unknown codes pass through."""
    c = _squeeze(code).upper()
    return _STATE_CATEGORY.get(c, c) or None


def _situs(r: dict[str, str]) -> str | None:
    """The street line as published; the file has no situs city or ZIP."""
    return _squeeze(r.get("Situs_Address")) or None


def _mailing_address(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("Owner_Address"))
    city, _, state = _squeeze(r.get("Owner_CityState")).partition(",")
    zip_code = _squeeze(r.get("Owner_Zip")).rstrip("-")
    state_zip = " ".join(x for x in (state.strip(), zip_code) if x)
    return ", ".join(x for x in (street, city.strip(), state_zip) if x) or None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real-property account in scope, in file order.

    ``categories`` limits the rows kept by Comptroller category (default: the registry's commercial
    scope); ``None`` keeps every real-property account. Repeated rows for one account (one per deed
    record) collapse to the first.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen: set[str] = set()
    for member, r in _rows(path):
        if _squeeze(r.get("RP")).upper() not in _REAL_PROPERTY_DIVISIONS:
            continue
        acct = _squeeze(r.get("Account_Num"))
        if not acct or acct in seen:
            continue
        category = state_category(r.get("State_Use_Code"))
        if not keep(category):
            continue
        seen.add(acct)
        owner_name = _owner(r.get("Owner_Name"))
        land = _positive(r.get("Land_SqFt"))
        if land is None:
            acreage = _positive(r.get("Land_Acres"))
            land = round(acreage * _SQFT_PER_ACRE, 2) if acreage else None
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=acct,
            state_category=category,
            account=acct,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the delimited export carries no confidentiality flag
            land_area_sf=land,
            improvement_area_sf=_positive(r.get("Gross_Building_Area")),
            year_built=int(y) if (y := _positive(r.get("Year_Built"))) else None,
            market_value=_num(r.get("Total_Value")),
            appraised_value=_num(r.get("Appraised_Value")),
            tax_year=int(y) if (y := _num(r.get("Appraisal_Year"))) else None,
            locator=f"{member} Account_Num {acct}",
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``PropertyData(Delimited)*.ZIP`` into a registry file (created if missing).

    Pass ``full_roll=False`` for the commercial extract when the full set has been ingested before:
    the extract omits the residential division, so it must not retire the ``B`` parcels found there.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_tarrant", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to PropertyData(Delimited).ZIP or PropertyData(Delimited)_C.ZIP as archived")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the file's Last-Modified date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true",
                    help="do not retire parcels missing from this file (use for the commercial extract)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
