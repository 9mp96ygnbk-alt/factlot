"""New York City Department of Finance: Rolling Sales and Annualized Sales (``.xlsx``) → ``ParcelFacts``.

DOF posts every recorded sale of tax class 1, 2 and 4 property: the *rolling* files (the last twelve
months, one workbook per borough) and the *annualized* files (one workbook per borough and calendar year,
back to 2003), under ``nyc.gov/assets/finance/downloads/pdf/rolling_sales/``. The same files are on NYC
Open Data (``usep-8jbt`` and ``w2pb-icbu``). Layout (confirmed on the 2025 annualized and the October
2025 - September 2026 rolling workbooks, 2026-11-04): one worksheet with a few title rows, then a header
row, then one row per sale; headers (upper case) ``BOROUGH``, ``NEIGHBORHOOD``, ``BUILDING CLASS
CATEGORY``, ``TAX CLASS AT PRESENT`` (annualized: ``... AS OF FINAL ROLL``), ``BLOCK``, ``LOT``,
``EASE-MENT``, ``BUILDING CLASS AT PRESENT``, ``ADDRESS``, ``APARTMENT NUMBER``, ``ZIP CODE``,
``RESIDENTIAL UNITS``, ``COMMERCIAL UNITS``, ``TOTAL UNITS``, ``LAND SQUARE FEET``, ``GROSS SQUARE
FEET``, ``YEAR BUILT``, ``TAX CLASS AT TIME OF SALE``, ``BUILDING CLASS AT TIME OF SALE``, ``SALE
PRICE``, ``SALE DATE``. **The files name no buyer, seller or other party**, so there is nothing to
screen for natural persons and nothing stored about parties.

What is kept: a sale of a lot whose building class at the time of sale is multifamily, commercial or
industrial under the same mapping as the assessment roll (``ny_nyc.category``), that is not a sale of one apartment
(a row with an apartment number, or in a cooperative building class category, is a sale of a unit, not of the
building the lot's BBL names; a condominium unit is a lot of its own and is kept).
Each sale becomes one ``transaction.sale`` fact on the parcel with the registry's BBL (borough, 5-digit
block, 4-digit lot), valued:

    {"date": "2025-03-14", "price_usd": 12500000, "building_class": "O4",
     "building_class_category": "21 OFFICE BUILDINGS", "tax_class": "4", "residential_units": 0,
     "commercial_units": 3, "total_units": 3, "land_area_sf": 20000, "gross_area_sf": 90000,
     "lots_sharing_price_and_date": 3}

``lots_sharing_price_and_date`` is written only when other lots in the same workbook have a sale on the same date
at the same non-zero price (see ``read_sales``): a deed covering several lots is published on each lot at the full
price. ``nominal_consideration`` is written only for a price of $0, which DOF's glossary defines as "a transfer of
ownership without a cash consideration" (for example from parents to children). Whether a sale was at arm's
length is **not** stated in the files, so it is not stated here: every sale is recorded as published, and a
reader screening for market sales must treat $0 and other nominal prices as non-market and cannot rely on the
file for the rest. Counts of zero and blank areas are omitted.

Usage: ``python -m factlot.registry.adapters.ny_sales rollingsales_manhattan.xlsx ... registry.db --series rolling --as-of 2026-09-30``
(the registry must already hold the DOF roll: ``ny_nyc``). ``--since 2026-01-01`` skips sales before a date,
to avoid loading the same sale from an annualized file and the overlapping rolling file.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import asdict
from datetime import date
from pathlib import Path

from ..store import IngestStats, ParcelFacts, Registry, Source
from . import xlsx_reader
from .ny_nyc import COUNTY_FIPS, STATE_FIPS, category

PREDICATE = "transaction.sale"

_BASE = "https://www.nyc.gov/site/finance/property/"


def source_for(series: str) -> Source:
    """The source record for one DOF publication: ``rolling`` or a calendar year (``2025``)."""
    rolling = series == "rolling"
    return Source(
        source_id=f"ny-nyc-dof-sales-{series}",
        publisher="New York City Department of Finance",
        title=("Rolling Sales (last 12 months), tax classes 1, 2 and 4" if rolling
               else f"Annualized Sales {series}, tax classes 1, 2 and 4"),
        url=_BASE + ("property-rolling-sales-data.page" if rolling else "property-annualized-sales-update.page"),
        state_fips=STATE_FIPS,
        county_fips=None,
        license="Public record published by DOF and on NYC Open Data (usep-8jbt rolling, w2pb-icbu annualized) under "
                "the NYC Open Data Law (Admin. Code §23-502). NYC Open Data FAQ: 'Open Data belongs to all New "
                "Yorkers. There are no restrictions on the use of Open Data.'",
        ai_use="unknown",  # not addressed by the publisher beyond 'no restrictions on the use'
        redistribution="permitted",
        attribution="New York City Department of Finance",
        terms_reviewed="2026-11-04",
    )


# Header (upper case, single-spaced) → field. The annualized files say "AS OF FINAL ROLL" where the rolling
# files say "AT PRESENT"; matching is by prefix.
_PREFIXES = (
    ("BOROUGH", "borough"), ("BUILDING CLASS CATEGORY", "category"), ("TAX CLASS AT TIME OF SALE", "tax_class"),
    ("BUILDING CLASS AT TIME OF SALE", "bldg_class"), ("BLOCK", "block"), ("LOT", "lot"),
    ("APARTMENT NUMBER", "apt"), ("RESIDENTIAL UNITS", "res_units"), ("COMMERCIAL UNITS", "com_units"),
    ("TOTAL UNITS", "total_units"), ("LAND SQUARE FEET", "land_sf"), ("GROSS SQUARE FEET", "gross_sf"),
    ("SALE PRICE", "price"), ("SALE DATE", "date"),
)


def _norm(h: object) -> str:
    return " ".join(str(h or "").upper().replace("\n", " ").split())


def _field(header: str) -> str | None:
    h = _norm(header)
    for prefix, name in _PREFIXES:
        if h.startswith(prefix):
            return name
    return None


def _number(v: object) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[,$\s]", "", str(v or ""))
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _sale_date(v: object) -> date | None:
    if isinstance(v, (int, float)):
        return xlsx_reader.excel_date(v)
    s = str(v or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", s):
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return date(int(m[3]), int(m[1]), int(m[2]))
        except ValueError:
            return None
    return xlsx_reader.excel_date(s)


def _positive(v: object) -> int | None:
    n = _number(v)
    return int(n) if n and n > 0 else None


def sale_value(r: dict[str, object], units: float | None) -> dict[str, object] | None:
    """The ``transaction.sale`` value for a row dict (field names as in ``_PREFIXES``), or ``None`` when the row
    has no usable date or price."""
    when = _sale_date(r.get("date"))
    price = _number(r.get("price"))
    if when is None or price is None or price < 0:
        return None
    out: dict[str, object] = {"date": when.isoformat(), "price_usd": int(round(price))}
    if (cls := str(r.get("bldg_class") or "").strip().upper()):
        out["building_class"] = cls
    if (cat := " ".join(str(r.get("category") or "").split())):
        out["building_class_category"] = cat
    if (tc := str(r.get("tax_class") or "").strip()):
        out["tax_class"] = tc.split(".")[0]
    for name, key in (("residential_units", "res_units"), ("commercial_units", "com_units"), ("total_units", "total_units")):
        if (n := _positive(r.get(key))) is not None:
            out[name] = n
    if (n := _positive(r.get("land_sf"))) is not None:
        out["land_area_sf"] = n
    if (n := _positive(r.get("gross_sf"))) is not None:
        out["gross_area_sf"] = n
    if out["price_usd"] == 0:
        out["nominal_consideration"] = True
    return out


def _bbl(r: dict[str, object]) -> tuple[str, str] | None:
    boro, block, lot = (_number(r.get(k)) for k in ("borough", "block", "lot"))
    if boro is None or block is None or lot is None:
        return None
    b = str(int(boro))
    if b not in COUNTY_FIPS:
        return None
    return COUNTY_FIPS[b], f"{b}{int(block):05d}{int(lot):04d}"


def sales_rows(path: str | Path) -> Iterator[tuple[int, dict[str, object]]]:
    """``(row number, fields)`` for the data rows of one workbook, after its header row."""
    names: dict[int, str] | None = None
    for n, row in enumerate(xlsx_reader.rows(path), 1):
        if names is None:
            found = {i: f for i, h in enumerate(row) if h is not None and (f := _field(str(h)))}
            if {"block", "lot", "price", "date"} <= set(found.values()):
                names = found
            continue
        if not any(v not in (None, "") for v in row):
            continue
        yield n, {name: (row[i] if i < len(row) else None) for i, name in names.items()}


def _unit_sale(r: dict[str, object]) -> bool:
    """A sale of one apartment, not of the building the lot's BBL names: the row has an apartment number, or its
    building class category is a cooperative (DOF's note: "Condominium and cooperative sales are on the unit level";
    a co-op's apartment number is written into ``ADDRESS``). Condominium units are lots of their own and are kept."""
    return bool(str(r.get("apt") or "").strip()) or "COOP" in " ".join(str(r.get("category") or "").upper().split())


def read_sales(path: str | Path, *, since: str | None = None) -> Iterator[ParcelFacts]:
    """Yield one ``ParcelFacts`` per lot with at least one in-scope sale in the workbook (sales grouped by BBL).

    A sale that shares its date and (non-zero) price with sales of other lots in the same workbook carries
    ``lots_sharing_price_and_date``: the number of lots, this one included. A deed covering several lots is
    published on each lot at the full price, and the files do not say which rows belong together; summing such
    prices or dividing one by a single lot's area would be wrong. The count is an observation about the file, not
    a statement that the lots were one deed (any unit-level rows are left out of it)."""
    floor = date.fromisoformat(since) if since else None
    rows = [(n, r) for n, r in sales_rows(path) if not _unit_sale(r)]
    sharing: dict[tuple[str, int], set[str]] = defaultdict(set)
    for _n, r in rows:
        key = _bbl(r)
        when, price = _sale_date(r.get("date")), _number(r.get("price"))
        if key is not None and when is not None and price:
            sharing[(when.isoformat(), int(round(price)))].add(key[1])
    grouped: dict[tuple[str, str], list[tuple[str, dict[str, object]]]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for n, r in rows:
        key = _bbl(r)
        if key is None:
            continue
        units = _number(r.get("total_units"))
        if category(str(r.get("bldg_class") or ""), units) is None:
            continue
        value = sale_value(r, units)
        if value is None or (floor is not None and date.fromisoformat(str(value["date"])) < floor):
            continue
        if (lots := len(sharing.get((str(value["date"]), int(value["price_usd"])), ()))) > 1 and value["price_usd"]:
            value["lots_sharing_price_and_date"] = lots
        fingerprint = (key[1], json.dumps(value, sort_keys=True))
        if fingerprint in seen:  # the same sale listed twice in one file
            continue
        seen.add(fingerprint)
        grouped[key].append((f"row {n}", value))
    name = Path(path).name
    for (county, bbl), sales in grouped.items():
        yield ParcelFacts(county, bbl, [(PREDICATE, v, None) for _loc, v in sales],
                          locator=f"{name} {sales[0][0]}" + (f" (+{len(sales) - 1} more)" if len(sales) > 1 else "") + f" BBL {bbl}")


def build(paths: list[str | Path], db_path: str | Path, *, series: str, as_of: str, since: str | None = None,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the borough workbooks of one DOF publication into a registry that already holds the DOF roll."""
    source = source_for(series)
    reg = Registry(db_path)
    total = IngestStats()
    try:
        reg.add_source(source)
        for path in paths:
            snap = reg.add_snapshot(source.source_id, path, as_of, retrieved_at)
            s = reg.ingest_parcel_facts(read_sales(path, since=since), snap, state_fips=STATE_FIPS)
            for f in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "facts_written"):
                setattr(total, f, getattr(total, f) + getattr(s, f))
            total.errors += s.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_sales", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="borough workbooks (.xlsx) followed by the registry file")
    ap.add_argument("--series", required=True, help="'rolling' or the calendar year, e.g. 2025")
    ap.add_argument("--as-of", required=True, help="end of the period the files cover, YYYY-MM-DD")
    ap.add_argument("--since", help="skip sales before this date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at")
    args = ap.parse_args(argv)
    *paths, db = args.files
    stats = build(paths, db, series=args.series, as_of=args.as_of, since=args.since, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
