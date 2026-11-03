"""Pierce County, Washington (FIPS 53053): Assessor-Treasurer "Data Mart" weekly extracts → ``ParcelRecord``.

Layout (confirmed 2026-11-03 against the extracts of 2026-10-30 and the table descriptions at
``https://online.co.pierce.wa.us/cfapps/atr/datamart/metadata/<table>.pdf``): the Data Mart
(``https://online.co.pierce.wa.us/cfapps/atr/datamart/downloads.cfm``, framed in the county's Data
Downloads page) offers nine zipped, pipe-delimited text tables with **no header row** (fields are
positional). The adapter reads four:

``tax_account`` (one row per account; 28 fields): 0 Parcel Number (10 digits), 1 Account Type (REAL,
STRUC, PERS, MOBIL), 2 Property Type (LNDIM, SARP, SAPP, MBLHM …), 3 Site Address, 4 Use Code (the County's
four-digit present highest-and-best-use code), 5 Use Description, 6 Tax Year - Prior, 7 Tax Code Area -
Prior, 8 Exemption Type - Prior, 9 Current Use Code - Prior, 10–13 Land / Improvement / Total Market /
Taxable Value - Prior Year, 14 Tax Year - Current, 15 Tax Code Area - Current, 16 Exemption Type - Current,
17 Current Use Code - Current, 18–21 Land / Improvement / Total Market / Taxable Value - Current Year,
22–25 Range, Township, Section, Quarter Section, 26 Subdivision Name, 27 Located On Parcel.
The adapter uses the current-year columns (Tax Year - Current is the next payable year, 2027 in the
2026-10-30 extract).

``appraisal_account`` (one row per parcel; optional, land area): 0 Parcel Number, 1 Appraisal Account Type,
2 Business Name, … 8 Land Net Acres, 9 Land Gross Square Feet, 10 Land Net Square Feet.

``improvement`` (one row per building; optional, building area): 0 Parcel Number, 1 Building ID, 2 Property
Type, … 5 Square Feet, 6 Net Square Feet.

``improvement_builtas`` (one row per built-as segment; optional, year built): 0 Parcel Number, 1 Building ID,
2 Built-As Number, 3 Built-As ID, 4 Built-As Description, 5 Built-As Square Feet, … 19 Year Built,
20 Year Remodeled, 21 Adjusted Year Built.

**The tables carry no owner names** (the Assessor-Treasurer publishes no ownership table in the Data Mart),
so every record has ``owner_name=None``. Only the Business Name on the parcel (appraisal_account field 2) is
a name, and it is not read.

Category mapping, from the four-digit use code (the first two digits follow WAC 458-53-030, the State's
standard land use code): ``1305``–``1308`` multi-family 5 or more units, including subsidized and high-rise →
``B``; ``1600`` hotels/motels, ``50xx`` non-residential condominiums (except ``5030`` detached-garage and
``5050`` marina-slip condos), ``51xx``–``59xx`` trade, ``61xx``–``66xx`` and ``69xx`` services (except ``6242``
cemeteries and ``6910`` religious services), ``72xx``–``75xx`` public assembly, amusements, recreation and
resorts → ``F1``; ``21xx``–``35xx`` and ``39xx`` manufacturing → ``F2``. Residential (single-family,
duplex to fourplex, condominium units, mobile homes), governmental (``67xx``), educational (``68xx``),
cultural (``71xx``), parks (``76xx``), agriculture, resource, transportation/utilities and undeveloped
codes are out of scope, as are accounts that are not ``REAL``, and parcels carrying a full exemption for a
public body, tribe or non-profit (``Exemption Type``). The County's code is kept verbatim in
``local_use_code``.

Usage: ``python -m factlot.registry.adapters.wa_pierce tax_account.zip registry.db --as-of 2026-10-30
--appraisal appraisal_account.zip --improvement improvement.zip --builtas improvement_builtas.zip``
"""

from __future__ import annotations

import argparse
import json
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "53"
COUNTY_FIPS = "053"
ACCOUNT_SYSTEM = "pierce_parcel"

SOURCE = Source(
    source_id="wa-pierce-assessor",
    publisher="Pierce County Assessor-Treasurer (Washington)",
    title="Assessor-Treasurer Data Mart: tax_account, appraisal_account, improvement, improvement_builtas",
    url="https://www.piercecountywa.gov/736/Data-Downloads",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (RCW 42.56); no license or terms of use stated for the downloads, only a disclaimer ('Data is provided for informational purposes only, and may be incomplete for determination of value')",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # not addressed by the publisher; public record
    attribution="Pierce County Assessor-Treasurer",
    terms_reviewed="2026-11-03",
)

_F2_PREFIXES = frozenset("21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 39".split())
_F1_PREFIXES = frozenset("51 52 53 54 55 56 57 58 59 61 62 63 64 65 66 69 72 73 74 75".split())
_F1_EXCLUDED = frozenset({"5030", "5050", "6242", "6910"})
_B_CODES = frozenset({"1305", "1306", "1307", "1308"})

# Exemption Type values that mean a public body, tribe or non-profit holds the parcel (not a taxable
# commercial owner). Other values seen on commercial accounts ("Multi-Family Housing", "Partial Ex Land",
# "Historical Designation", "Senior/Disabled 1") are tax relief for private owners and do not exclude.
_EXEMPT_PREFIXES = ("municipal corp", "rehabilitative social", "native american", "non-profit", "county owned",
                    "state of washington", "public school", "tribal lands", "tax title", "federal", "city owned")

_ENCODING = "latin-1"


def category(use_code: str | None, account_type: str | None = "REAL", exemption: str | None = None) -> str | None:
    """FactLot category for a Pierce County use code; ``None`` when out of the commercial scope."""
    code = (use_code or "").strip()
    if (account_type or "").strip().upper() != "REAL" or len(code) != 4 or not code.isdigit():
        return None
    if (exemption or "").strip().lower().startswith(_EXEMPT_PREFIXES):
        return None
    if code in _B_CODES:
        return "B"
    if code == "1600":
        return "F1"
    prefix = code[:2]
    if prefix in _F2_PREFIXES:
        return "F2"
    if code in _F1_EXCLUDED:
        return None
    if prefix == "50" or prefix in _F1_PREFIXES:
        return "F1"
    return None


def _lines(path: str | Path) -> Iterator[list[str]]:
    """Split the rows of a Data Mart table (a ``.zip`` holding one ``.txt``, or the ``.txt`` itself)."""
    p = Path(path)
    if p.suffix.lower() == ".zip":
        with zipfile.ZipFile(p) as z:
            name = next(n for n in z.namelist() if not n.endswith("/"))
            with z.open(name) as raw:
                for line in raw:
                    yield line.decode(_ENCODING).rstrip("\r\n").split("|")
    else:
        with open(p, encoding=_ENCODING, newline="") as f:
            for line in f:
                yield line.rstrip("\r\n").split("|")


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Values, areas and years: 0 and blank both mean 'no figure'."""
    v = _num(s)
    return v if v and v > 0 else None


def _field(row: list[str], i: int) -> str:
    return row[i].strip() if i < len(row) else ""


def _situs(address: str) -> str | None:
    a = " ".join(address.split())
    # "XXX" in the address means the County had no valid address and estimated one from GIS.
    if not a or "XXX" in a.upper():
        return None
    return f"{a}, WA"


def _land_areas(path: str | Path | None) -> dict[str, float]:
    out: dict[str, float] = {}
    if path:
        for r in _lines(path):
            area = _positive(_field(r, 10))
            if area and _field(r, 0):
                out[_field(r, 0)] = area
    return out


def _building_areas(path: str | Path | None) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    if path:
        for r in _lines(path):
            area = _positive(_field(r, 5))
            if area and _field(r, 0):
                out[_field(r, 0)] += area
    return out


def _years_built(path: str | Path | None) -> dict[str, int]:
    """Year built of the largest built-as segment on each parcel."""
    best: dict[str, tuple[float, int]] = {}
    if path:
        for r in _lines(path):
            year, area = _positive(_field(r, 19)), _positive(_field(r, 5)) or 0.0
            if year and _field(r, 0) and (_field(r, 0) not in best or area > best[_field(r, 0)][0]):
                best[_field(r, 0)] = (area, int(year))
    return {k: v[1] for k, v in best.items()}


def read_roll(path: str | Path, *, appraisal_path: str | Path | None = None,
              improvement_path: str | Path | None = None, builtas_path: str | Path | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per ``tax_account`` row, in file order.

    Every account is yielded; ``state_category`` is ``None`` for accounts outside the commercial scope, which
    the registry counts as skipped. The optional tables add land area, building area and year built.
    """
    land = _land_areas(appraisal_path)
    building = _building_areas(improvement_path)
    years = _years_built(builtas_path)
    for r in _lines(path):
        parcel = _field(r, 0)
        if not parcel:
            continue
        use_code = _field(r, 4)
        exemption = _field(r, 16) or _field(r, 8)
        tax_year = _positive(_field(r, 14))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=parcel,
            state_category=category(use_code, _field(r, 1), exemption),
            account=parcel,
            situs_address=_situs(_field(r, 3)),
            owner_name=None,  # the Data Mart has no ownership table
            land_area_sf=land.get(parcel),
            improvement_area_sf=building.get(parcel),
            year_built=years.get(parcel),
            market_value=_positive(_field(r, 20)),
            appraised_value=_positive(_field(r, 21)),
            tax_year=int(tax_year) if tax_year else None,
            locator=f"tax_account parcel {parcel}",
            local_use_code=use_code or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True, appraisal_path: str | Path | None = None, improvement_path: str | Path | None = None,
          builtas_path: str | Path | None = None) -> IngestStats:
    """Ingest one archived ``tax_account.zip`` (with optional companion tables) into a registry file."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        records = read_roll(snapshot_path, appraisal_path=appraisal_path, improvement_path=improvement_path,
                            builtas_path=builtas_path)
        return reg.ingest_parcels(records, snap, state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM,
                                  full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.wa_pierce", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to tax_account.zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="extract date, YYYY-MM-DD (the Data Mart's 'Date Extracted')")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--appraisal", help="path to appraisal_account.zip (land area)")
    ap.add_argument("--improvement", help="path to improvement.zip (building area)")
    ap.add_argument("--builtas", help="path to improvement_builtas.zip (year built)")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial,
                  appraisal_path=args.appraisal, improvement_path=args.improvement, builtas_path=args.builtas)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
