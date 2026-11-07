"""Williamson Central Appraisal District: the WCAD open-data portal (Socrata CSV queries) → ``ParcelRecord``.

WCAD publishes its Orion appraisal tables on ``data.wcad.org``, a Socrata portal, one dataset per
table, refreshed nightly to monthly. Two datasets are used; the collector archives each as a CSV
query result (``/resource/<id>.csv?$select=…``, lower-case column names):

- **Improvement Real Property – Certified** (``2huh-jk3y``): one row per improvement of a property.
  ``fsptb`` is the improvement's state (PTD) code (``F1``, ``F2``, ``B1``–``B4``, ``A1`` …); the
  config asks only for the commercial and multifamily codes, so every row names an in-scope
  property. ``vtsgimp_comtotbldarea`` is that improvement's building area in square feet,
  ``fimptype`` its type (``C`` commercial, ``R`` residential, ``I``, ``M``, ``H``).
- **PropOwner** (``absk-uy9g``): one row per property and owner, joining the property, situs, owner
  and value tables. ``propertyid`` is the WCAD property id (the join key and the parcel key),
  ``quickrefid`` its ``R`` number, ``propertytypecode`` WCAD's class (``RES``, ``COM``, ``C1``–``C6``
  condo/commercial classes, ``L`` land, ``BPP1``–``BPP9`` business personal property …), ``situsaddress``
  the formatted situs, ``acres``, ``totallandmktvalue``, ``totalimpmktvalue``, ``totalpropmktvalue``,
  ``totalassessedvalue`` (the appraised value after the Tax Code caps), ``fullname`` the owner,
  ``primaryowner`` 1 for the primary owner and 0 for others, ``mailingaddress`` (two lines), and
  ``issecured`` (0 on every row of the 2026-11-03 file; a 1 would mark a secured/confidential owner,
  which the adapter honours by withholding the owner).

A property's category comes from its improvements: ``F2`` over ``F1`` over ``B``. A property with
no commercial or multifamily improvement is out of scope, as is one with no PropOwner row. The
portal states no licence on any dataset. The datasets carry no year built (``feffyear``, the
effective year, is not the actual year), so ``year_built`` is empty; ``improvement_area_sf`` is the
sum of the in-scope improvements' areas.

Usage: ``python -m factlot.registry.adapters.tx_williamson registry.db --as-of 2026-11-03 --improvements 2huh-jk3y.csv PROPOWNER.csv [PROPOWNER.csv ...]``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
from .tx_collin import _num, _positive, _squeeze

STATE_FIPS = "48"
COUNTY_FIPS = "491"
ACCOUNT_SYSTEM = "wcad_property_id"

# The tax year the records stated when this source was first loaded (2026-11-03): the publisher had already
# rolled to 2027. Rolls for that year keep the plain source id (store.roll_source).
BASE_TAX_YEAR = 2027

SOURCE = Source(
    source_id="tx-williamson-cad",
    publisher="Williamson Central Appraisal District",
    title="WCAD open data portal (Improvement Real Property - Certified, PropOwner)",
    url="https://data.wcad.org/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); the portal states no license or terms of use on the datasets",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # not addressed; public record
    attribution="Williamson Central Appraisal District",
    terms_reviewed="2026-11-03",
)

_SQFT_PER_ACRE = 43560

_PRIORITY = ("F2", "F1", "B")

# Owner names WCAD uses when it has no owner of record: the parcel keeps no owner name.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER"})


def state_category(code: str | None) -> str | None:
    """Comptroller category for an improvement ``fsptb`` code: ``B1``–``B4`` → ``B``; others verbatim."""
    c = _squeeze(code).upper()
    if re.fullmatch(r"B\d*", c):
        return "B"
    return c or None


def _read(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for f in sorted(x for x in p.rglob("*") if x.is_file() and not x.name.startswith(".")):
            yield from _read(f)
        return
    with open(p, newline="", encoding="utf-8-sig", errors="replace") as f:
        yield from csv.DictReader(f)


def _situs(r: dict[str, str]) -> str | None:
    """``11496 CHANDLER RD, TAYLOR, TX  76574`` → ``11496 CHANDLER RD, TAYLOR TX 76574``."""
    s = _squeeze(r.get("situsaddress")) or _squeeze(r.get("propertyaddress"))
    if not s:
        return None
    m = re.fullmatch(r"(.+), ([^,]+), ([A-Z]{2}) (\d{5}(?:-\d{4})?)", s)
    return f"{m.group(1)}, {m.group(2)} {m.group(3)} {m.group(4)}" if m else s


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = re.split(r"[\r\n]+", r.get("mailingaddress") or "")
    return ", ".join(x for x in (_squeeze(line) for line in lines) if x) or None


def improvement_categories(path: str | Path) -> dict[str, tuple[str, str, float | None]]:
    """``propertyid`` → (category, local code(s), summed building area) from the improvement dataset."""
    codes: dict[str, set[str]] = defaultdict(set)
    area: dict[str, float] = defaultdict(float)
    for r in _read(path):
        pid = _squeeze(r.get("propertyid")).lstrip("0")
        code = _squeeze(r.get("fsptb")).upper()
        if not pid or not code:
            continue
        codes[pid].add(code)
        area[pid] += _positive(r.get("vtsgimp_comtotbldarea")) or 0.0
    out: dict[str, tuple[str, str, float | None]] = {}
    for pid, cs in codes.items():
        cats = {state_category(c) for c in cs}
        category = next((w for w in _PRIORITY if w in cats), None) or state_category(sorted(cs)[0])
        out[pid] = (category or "", ",".join(sorted(cs)), area[pid] or None)
    return out


def _bare(pid: str, category: str, local: str, area: float | None) -> ParcelRecord:
    """An in-scope improvement with no PropOwner row. The property id is enough to keep it."""
    return ParcelRecord(
        county_fips=COUNTY_FIPS, apn=pid, state_category=category, account=pid,
        improvement_area_sf=area, locator=f"Improvement propertyid {pid}", local_use_code=local,
    )


def read_roll(improvements: str | Path, owners: str | Path | Iterable[str | Path], *,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              include_without_owner: bool = True, only_without_owner: bool = False) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope improvement.

    ``categories`` limits the properties kept by Comptroller category (default: the registry's
    commercial scope). A repeated ``propertyid`` collapses to the primary owner's row. A property
    the improvement file identifies and the owner file does not is still yielded, without an
    owner or a situs: absence of an owner is not a reason to drop the parcel. An owner row with
    no in-scope improvement is not a parcel.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    cats = {pid: v for pid, v in improvement_categories(improvements).items() if keep(v[0])}
    chosen: dict[str, dict[str, str]] = {}
    for src in ([owners] if isinstance(owners, (str, Path)) else list(owners)):
        for r in _read(src):
            pid = _squeeze(r.get("propertyid")).lstrip("0")
            if pid not in cats:
                continue
            prev = chosen.get(pid)
            if prev is None or (_squeeze(prev.get("primaryowner")) != "1" and _squeeze(r.get("primaryowner")) == "1"):
                chosen[pid] = r
    if not only_without_owner:
        for pid, r in chosen.items():
            category, local, area = cats[pid]
            confidential = _squeeze(r.get("issecured")) == "1"
            name = None if confidential else (_squeeze(r.get("fullname")) or None)
            if name and name.upper() in _PLACEHOLDER_OWNERS:
                name = None
            acres = _positive(r.get("acres"))
            yield ParcelRecord(
                county_fips=COUNTY_FIPS,
                apn=pid,
                state_category=category,
                account=pid,
                situs_address=None if confidential else _situs(r),
                owner_name=name,
                owner_mailing_address=_mailing_address(r) if name else None,
                owner_confidential=confidential,
                land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
                improvement_area_sf=area,
                year_built=None,
                market_value=_num(r.get("totalpropmktvalue")),
                appraised_value=_num(r.get("totalassessedvalue")),
                tax_year=int(y) if (y := _num(r.get("tax_year"))) else None,
                locator=f"PropOwner propertyid {pid}",
                local_use_code=local,
            )
    if include_without_owner or only_without_owner:
        for pid, (category, local, area) in cats.items():
            if pid not in chosen:
                yield _bare(pid, category, local, area)


def build(improvements: str | Path, owner_paths: Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the improvement file with each PropOwner page into a registry file (created if missing).

    Each PropOwner page is its own snapshot (the page the owner and values were read from), and
    none is a complete roll, so nothing is retired.
    """
    total = IngestStats()
    reg = Registry(db_path)
    try:
        pages = list(owner_paths)
        for page in pages:
            # One registry source per tax year (store.roll_source): next year's pages never supersede this year's.
            # Ownerless parcels are not repeated on every page; they are cited to the improvement file below.
            stats = reg.ingest_roll(SOURCE, page, read_roll(improvements, page, include_without_owner=False),
                                    as_of=as_of, retrieved_at=retrieved_at, state_fips=STATE_FIPS,
                                    account_system=ACCOUNT_SYSTEM, full_roll=False, base_year=BASE_TAX_YEAR)
            for k, v in asdict(stats).items():
                if k in ("source_id", "tax_year"):
                    setattr(total, k, v)
                elif isinstance(v, int):
                    setattr(total, k, getattr(total, k) + v)
                elif isinstance(v, list):
                    getattr(total, k).extend(v)
        stats = reg.ingest_roll(
            SOURCE, improvements, read_roll(improvements, pages, only_without_owner=True),
            as_of=as_of, retrieved_at=retrieved_at, state_fips=STATE_FIPS,
            account_system=ACCOUNT_SYSTEM, full_roll=False, base_year=BASE_TAX_YEAR)
        for k, v in asdict(stats).items():
            if k in ("source_id", "tax_year"):
                setattr(total, k, v)
            elif isinstance(v, int):
                setattr(total, k, getattr(total, k) + v)
            elif isinstance(v, list):
                getattr(total, k).extend(v)
    finally:
        reg.close()
    return total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_williamson", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("owners", nargs="+", help="PropOwner CSV pages as archived by the collector")
    ap.add_argument("--improvements", required=True, help="the Improvement Real Property CSV (2huh-jk3y) as archived")
    ap.add_argument("--as-of", required=True, help="date the files were retrieved, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.improvements, args.owners, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
