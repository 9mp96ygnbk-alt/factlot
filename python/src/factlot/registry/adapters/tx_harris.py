"""Harris Central Appraisal District (Houston): ``Real_acct_owner.zip`` → ``ParcelRecord``.

Layout (confirmed on the 2026 roll, 2026-11-02): a zip of tab-delimited, header-row text files
with CRLF line endings and Latin-1 bytes.

- ``real_acct.txt`` — one row per account (the 13-digit HCAD account number is the parcel key):
  mailing address (``mailto``, ``mail_*``), situs (``site_addr_1`` street, ``_2`` city, ``_3``
  ZIP), ``state_class`` (Comptroller category with HCAD subclass, e.g. ``F1``, ``B1``),
  ``yr_impr``, ``bld_ar`` and ``land_ar`` (square feet), ``acreage``, the value columns
  (``tot_mkt_val``, ``tot_appr_val``), and ``Neighborhood_Code`` (HCAD's neighborhood number, such as
  ``5900.05``; ``real_neighborhood_code.txt`` lists them), written as ``parcel.neighborhood_code`` when
  that list has it: the 2026 file also writes ``0.00``, which is not a listed code, on 4 commercial
  accounts.
  ``Market_Area_1``/``_2`` and ``econ_bld_class`` are not read.
- ``owners.txt`` — owner-of-record lines per account (``ln_num``, ``name``, ``pct_own``). The
  ``mailto`` column of ``real_acct.txt`` is only the addressee, so owners come from here.

Building class comes from a second file, ``Real_building_land.zip`` (same folder, same layout
conventions), loaded as its own registry source (``tx-harris-cad-buildings``) so each fact cites
the file it was read from:

- ``building_other.txt`` — commercial improvements, one row per building section (``acct``,
  ``bld_num``, ``structure``, ``qa_cd``, ``im_sq_ft``); ``building_res.txt`` — residential-type
  improvements with the same columns. ``structure`` is the building class (``A`` fireproofed steel,
  ``B`` reinforced concrete, ``C`` masonry bearing, ``D`` wood or light steel, ``S`` open steel
  skeleton, ... in ``desc_r_04_building_class.txt``); ``qa_cd`` is the quality (``A`` excellent ...
  ``F`` poor, ``desc_r_07_quality_code.txt``) and is not recorded. ``parcel.building_class`` is the
  ``structure`` of the main improvement: the section with the largest ``im_sq_ft`` among the
  account's ``building_other.txt`` rows, or among its ``building_res.txt`` rows when it has none
  (first in file order on a tie; rows with no class are skipped).

Usage: ``python -m factlot.registry.adapters.tx_harris Real_acct_owner.zip registry.db --as-of 2026-11-01
[--buildings Real_building_land.zip]``
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
from ..store import IngestStats, ParcelFacts, ParcelRecord, ParcelValues, Registry, Source, roll_source

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

BUILDINGS_SOURCE = Source(
    source_id="tx-harris-cad-buildings",
    publisher="Harris Central Appraisal District",
    title="Real property building and land export (Real_building_land.zip)",
    url="https://hcad.org/pdata/pdata-property-downloads.html",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license=SOURCE.license,
    ai_use=SOURCE.ai_use,
    redistribution=SOURCE.redistribution,
    attribution=SOURCE.attribution,
    terms_reviewed=SOURCE.terms_reviewed,
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
    listed = _neighborhoods(path)
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
            extra_facts=[("parcel.neighborhood_code", nbhd, None)]
            if (nbhd := _code(r.get("Neighborhood_Code"))) and (listed is None or nbhd in listed) else [],
        )


def read_value_history(path: str | Path, accounts: Iterable[str]) -> Iterator[ParcelValues]:
    """Yield each listed account's tax year and values from ``real_acct.txt``, and nothing else.

    For a prior-year roll (``Registry.ingest_value_history``): ``owners.txt`` and the owner and address
    columns of ``real_acct.txt`` are never read. A value of 0 is not a figure (see ``_positive``).
    """
    wanted = frozenset(accounts)
    for r in _rows(path, "real_acct.txt"):
        acct = r["acct"].strip()
        if acct not in wanted:
            continue
        yield ParcelValues(
            county_fips=COUNTY_FIPS, apn=acct,
            tax_year=int(y) if (y := _num(r.get("yr"))) else None,
            market_value=_positive(r.get("tot_mkt_val")), appraised_value=_positive(r.get("tot_appr_val")),
            locator=f"real_acct.txt acct {acct}",
        )


def _neighborhoods(path: str | Path) -> frozenset[str] | None:
    """The neighborhood codes ``real_neighborhood_code.txt`` lists, or ``None`` when the file has no such member."""
    p = Path(path)
    if p.is_dir():
        present = (p / "real_neighborhood_code.txt").is_file()
    else:
        with zipfile.ZipFile(p) as zf:
            present = "real_neighborhood_code.txt" in zf.namelist()
    if not present:
        return None
    return frozenset(c for r in _rows(path, "real_neighborhood_code.txt") if (c := _code(r.get("cd"))))


def _code(s: str | None) -> str | None:
    """An HCAD code as written (padding removed); blank is no code."""
    return " ".join((s or "").split()) or None


def read_building_classes(path: str | Path, accounts: Iterable[str] | None = None) -> Iterator[ParcelFacts]:
    """Yield ``parcel.building_class`` for each account's main improvement (see the module docstring).

    ``accounts`` limits the accounts read (the registry's Harris parcels); ``None`` reads every account.
    """
    wanted = None if accounts is None else frozenset(accounts)
    best: dict[str, tuple[float, str, str, str]] = {}  # acct -> (area, class, member, bld_num)
    for member in ("building_other.txt", "building_res.txt"):
        found: dict[str, tuple[float, str, str, str]] = {}
        for r in _rows(path, member):
            acct = r["acct"].strip()
            if (wanted is not None and acct not in wanted) or acct in best:
                continue  # building_res.txt is read only for accounts with no commercial improvement
            cls = _code(r.get("structure"))
            if not cls:
                continue
            area = _num(r.get("im_sq_ft")) or 0.0
            if acct not in found or area > found[acct][0]:
                found[acct] = (area, cls, member, (r.get("bld_num") or "").strip())
        best.update(found)
    for acct, (_area, cls, member, bld) in best.items():
        yield ParcelFacts(county_fips=COUNTY_FIPS, apn=acct, facts=[("parcel.building_class", cls, None)],
                          locator=f"{member} acct {acct} bld_num {bld}")


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived ``Real_acct_owner.zip`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        # One registry source per tax year (store.roll_source): a next-year file never retires this year's roll.
        return reg.ingest_roll(SOURCE, snapshot_path, read_roll(snapshot_path), as_of=as_of, retrieved_at=retrieved_at,
                               state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def build_history(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
                  retrieved_at: str | None = None) -> IngestStats:
    """Add one prior year's values from an archived ``Real_acct_owner.zip`` to the Harris parcels already loaded.

    History only (``Registry.ingest_value_history``): the current record, owners and addresses are not touched.
    A row whose ``yr`` is not ``tax_year`` is not loaded and is named in ``stats.errors``.
    """
    reg = Registry(db_path)
    try:
        src = roll_source(SOURCE, tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute("SELECT external_id FROM crosswalk WHERE system = ?", (ACCOUNT_SYSTEM,))]
        wrong: list[str] = []

        def in_year(rows: Iterable[ParcelValues]) -> Iterator[ParcelValues]:
            for r in rows:
                if r.tax_year == tax_year:
                    yield r
                else:
                    wrong.append(f"{r.locator}: tax year {r.tax_year}, expected {tax_year}")

        stats = reg.ingest_value_history(in_year(read_value_history(snapshot_path, accounts)), snap, state_fips=STATE_FIPS)
        stats.seen += len(wrong)
        stats.skipped_invalid += len(wrong)
        stats.errors.extend(wrong[:20])
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats
    finally:
        reg.close()


def build_buildings(buildings_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int | None,
                    retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Add building classes from an archived ``Real_building_land.zip`` to the Harris parcels already loaded.

    ``tax_year`` is the year of the roll the file was published with (the ``data/CAMA/<year>/`` folder);
    it picks the registry source, as for the roll.
    """
    reg = Registry(db_path)
    try:
        src = roll_source(BUILDINGS_SOURCE, tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, buildings_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute(
            "SELECT external_id FROM crosswalk WHERE system = ?", (ACCOUNT_SYSTEM,))]
        stats = reg.ingest_parcel_facts(read_building_classes(buildings_path, accounts), snap, state_fips=STATE_FIPS,
                                        full_roll=full_roll)
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats
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
    ap.add_argument("--buildings", help="Real_building_land.zip from the same folder: adds building classes")
    ap.add_argument("--history-only", type=int, metavar="TAX_YEAR",
                    help="the file is the roll of this earlier tax year: add its values to parcels already loaded and "
                         "change nothing else (owners, addresses, other facts and parcels are not written)")
    ap.add_argument("--buildings-as-of", help="its 'last updated' date, YYYY-MM-DD (default: --as-of)")
    args = ap.parse_args(argv)
    if args.history_only:
        if args.buildings:
            ap.error("--history-only does not take --buildings")
        print(json.dumps(asdict(build_history(args.snapshot, args.db, as_of=args.as_of, tax_year=args.history_only,
                                              retrieved_at=args.retrieved_at)), indent=2))
        return 0
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    out = {"roll": asdict(stats)}
    if args.buildings:
        b = build_buildings(args.buildings, args.db, as_of=args.buildings_as_of or args.as_of, tax_year=stats.tax_year,
                            retrieved_at=args.retrieved_at, full_roll=not args.partial)
        out["buildings"] = asdict(b)
    print(json.dumps(out if args.buildings else out["roll"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
