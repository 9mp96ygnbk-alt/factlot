"""Harris Central Appraisal District (Houston): ``Real_acct_owner.zip`` → ``ParcelRecord``.

Layout (confirmed on the 2026 roll, 2026-11-02): a zip of tab-delimited, header-row text files
with CRLF line endings and Latin-1 bytes.

- ``real_acct.txt`` — one row per account (the 13-digit HCAD account number is the parcel key):
  mailing address (``mailto``, ``mail_*``), situs (``site_addr_1`` street, ``_2`` city, ``_3``
  ZIP), ``state_class`` (Comptroller category with HCAD subclass, e.g. ``F1``, ``B1``),
  ``yr_impr``, ``bld_ar`` and ``land_ar`` (square feet), ``acreage``, and the value columns
  (``tot_mkt_val``, ``tot_appr_val``).
- ``owners.txt`` — owner-of-record lines per account (``ln_num``, ``name``, ``pct_own``). The
  ``mailto`` column of ``real_acct.txt`` is only the addressee, so owners come from here.

Usage: ``python -m factlot.registry.adapters.tx_harris Real_acct_owner.zip registry.db --as-of 2026-11-01``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "48"
COUNTY_FIPS = "201"
ACCOUNT_SYSTEM = "hcad_account"

SOURCE = Source(
    source_id="tx-harris-cad",
    publisher="Harris Central Appraisal District",
    title="Real property appraisal roll export (Real_acct_owner.zip)",
    url="https://hcad.org/pdata/pdata-property-downloads.html",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; public record
    attribution="Harris Central Appraisal District",
    terms_reviewed="2026-11-02",
)

# Owner names HCAD uses when it has no owner of record (for example a deed not yet processed):
# the parcel keeps no owner name rather than a placeholder.
_PLACEHOLDER_OWNERS = frozenset({"CURRENT OWNER", "UNKNOWN", "UNKNOWN OWNER"})
# Owner information withheld under Tax Code §25.025 (data policy §3).
_WITHHELD_PREFIX = "CONFIDENTIAL"


def _rows(path: str | Path, name: str) -> Iterator[dict[str, str]]:
    """Stream the rows of one tab-delimited member, from the zip or from an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        with open(p / name, newline="", encoding="latin-1") as f:
            yield from csv.DictReader(f, delimiter="\t")
        return
    with zipfile.ZipFile(p) as zf, zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""), delimiter="\t")


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: HCAD writes 0 or blank when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [r.get("mail_addr_1", "").strip(), r.get("mail_addr_2", "").strip()]
    city = " ".join(x for x in (r.get("mail_city", "").strip(),) if x)
    state_zip = " ".join(x for x in (r.get("mail_state", "").strip(), r.get("mail_zip", "").strip()) if x)
    lines.append(", ".join(x for x in (city, state_zip) if x))
    country = r.get("mail_country", "").strip()
    if country and country.upper() not in ("US", "USA", "UNITED STATES"):
        lines.append(country)
    return ", ".join(x for x in lines if x) or None


def _situs(r: dict[str, str]) -> str | None:
    street = r.get("site_addr_1", "").strip()
    if not street:
        return None
    rest = " ".join(x for x in (r.get("site_addr_2", "").strip(), "TX", r.get("site_addr_3", "").strip()) if x)
    return f"{street}, {rest}"


def _owner(name: str | None) -> tuple[str | None, bool]:
    """(owner_name, owner_confidential) for an owners.txt name."""
    n = (name or "").strip()
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None, False
    if n.upper().startswith(_WITHHELD_PREFIX):
        return None, True
    return n, False


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per account in scope.

    ``categories`` limits the rows kept (default: the registry's commercial scope, including HCAD's
    B subclasses); ``None`` keeps every account, which needs memory for the whole roll.
    """
    keep = (lambda code: is_commercial(code)) if categories is COMMERCIAL_CATEGORIES else (
        (lambda code: True) if categories is None else (lambda code, s=frozenset(c.upper() for c in categories): code in s))
    kept: dict[str, dict[str, str]] = {}
    for r in _rows(path, "real_acct.txt"):
        code = r.get("state_class", "").strip().upper()
        if keep(code):
            kept[r["acct"].strip()] = r
    owners: dict[str, str] = {}
    for o in _rows(path, "owners.txt"):
        acct = o["acct"].strip()
        if acct in kept and o.get("ln_num", "").strip() == "1":
            owners[acct] = o.get("name", "")
    for acct, r in kept.items():
        owner_name, confidential = _owner(owners.get(acct))
        land = _positive(r.get("land_ar"))
        if land is None:
            acreage = _positive(r.get("acreage"))
            land = round(acreage * 43560, 2) if acreage else None
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=acct,
            state_category=r.get("state_class", "").strip() or None,
            account=acct,
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=confidential,
            land_area_sf=land,
            improvement_area_sf=_positive(r.get("bld_ar")),
            year_built=int(y) if (y := _positive(r.get("yr_impr"))) else None,
            market_value=_num(r.get("tot_mkt_val")),
            appraised_value=_num(r.get("tot_appr_val")),
            tax_year=int(y) if (y := _num(r.get("yr"))) else None,
            locator=f"real_acct.txt acct {acct}",
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``Real_acct_owner.zip`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_harris", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to Real_acct_owner.zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="roll date, YYYY-MM-DD (HCAD's 'last updated' date for the file)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
