"""New York City Department of Finance: Final Assessment Roll (``fy<YY>_tc234.zip``) → ``ParcelRecord``.

Layout (confirmed on the FY27 final roll, 2026-11-02): each zip from
``nyc.gov/assets/finance/downloads/tar/`` holds one tab-delimited text file
(``PROPMAST_*_T<year>_FIN.TXT``) with a header row of column names, CRLF line endings, Latin-1
bytes, a trailing tab on every line, and 139 columns in the order of the publisher's
``layout-pts-property-master.xlsx`` (transcribed in ``LAYOUT`` below, and checked against the
header; the same columns, lower-cased, make up NYC Open Data dataset ``8y4t-faws``).
``fy<YY>_tc234.zip`` is the roll for tax classes 2, 3 and 4 (every apartment, utility, commercial and
industrial lot); ``fy<YY>_tc1.zip`` the 1–3 family class; ``fy<YY>_avroll1234.zip`` all four.

- ``PARID`` / ``BORO`` + ``BLOCK`` + ``LOT`` (+ ``EASE``) — the borough-block-lot (BBL) is the parcel
  key; an easement letter makes a separate record (``1000090001E``). ``RECTYPE`` 1 is ordinary real
  estate; 2 and 3 are Real Estate of Utility Corporation idents, which are not parcels.
- ``BORO`` 1 Manhattan, 2 Bronx, 3 Brooklyn, 4 Queens, 5 Staten Island → county FIPS below.
- ``BLDG_CLASS`` — DOF's two-character building class (letter group + digit), the use code mapped
  to the FactLot category by ``_CATEGORY``; ``FINTAXCLASS`` the NYS tax class (1, 2, 2A–2C, 3, 4).
- ``OWNER`` — owner of record (80 characters; no mailing address and no confidentiality flag). A name
  longer than 40 characters is wrapped into two 40-character halves joined by one space, and the break
  often falls inside a word (``... LIABILITY COMPA NY``, ``... REVOCABLE LIVING TRU ST``: 9,436 of
  461,249 FY27 rows). ``_owner`` closes the break when the two fragments make a word that the
  unwrapped names of the same file use more often than the first fragment alone.
- Situs: ``HOUSENUM_LO``, ``HOUSENUM_HI``, ``STREET_NAME``, ``ZIP_CODE`` (no city column; the
  borough gives it).
- ``LAND_AREA`` and ``GROSS_SQFT`` (square feet), ``YRBUILT``, ``UNITS``; ``FINMKTTOT`` is the final
  market value and ``FINACTTOT`` the final actual assessed value (45% of market value for classes 2
  and 4; the taxable base before transition and exemptions). ``TAXYR`` 2027 is fiscal year 2026/27.
  Numbers are signed and zero-padded (``+00000000000``); 0 means no figure.

Usage: ``python -m factlot.registry.adapters.ny_nyc fy27_tc234.zip registry.db --as-of 2026-05-15``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "36"
ACCOUNT_SYSTEM = "nyc_bbl"

# DOF borough code → county FIPS (New York, Bronx, Kings, Queens, Richmond).
COUNTY_FIPS = {"1": "061", "2": "005", "3": "047", "4": "081", "5": "085"}
BOROUGH_NAME = {"1": "MANHATTAN", "2": "BRONX", "3": "BROOKLYN", "4": "QUEENS", "5": "STATEN ISLAND"}
# Postal city for the situs line (USPS uses NEW YORK for Manhattan).
_SITUS_CITY = {"1": "NEW YORK", "2": "BRONX", "3": "BROOKLYN", "4": "QUEENS", "5": "STATEN ISLAND"}

SOURCE = Source(
    source_id="ny-nyc-dof",
    publisher="New York City Department of Finance",
    title="Final Assessment Roll, tax classes 2, 3 and 4 (fy<YY>_tc234.zip)",
    url="https://www.nyc.gov/site/finance/property/property-assessments.page",
    state_fips=STATE_FIPS,
    county_fips=None,  # five counties; each record carries its own
    license="Public record (N.Y. RPTL §516; FOIL) published under the NYC Open Data Law (Admin. Code "
            "§23-502). NYC Open Data FAQ: 'Open Data belongs to all New Yorkers. There are no "
            "restrictions on the use of Open Data.'",
    ai_use="unknown",  # not addressed by the publisher beyond 'no restrictions on the use'
    redistribution="permitted",  # no restrictions on use (FAQ); Open Data Law forbids license requirements
    attribution="New York City Department of Finance",
    terms_reviewed="2026-11-02",
)

# Column order of the Property Master file, from the publisher's layout-pts-property-master.xlsx
# (139 columns; the file has no header row).
LAYOUT = (
    "PARID", "BORO", "BLOCK", "LOT", "EASE", "SUBIDENT_REUC", "RECTYPE", "TAXYR", "IDENT",
    "SUBIDENT", "ROLL_SECTION", "SECVOL", "PYMKTLAND", "PYMKTTOT", "PYACTLAND", "PYACTTOT",
    "PYACTEXTOT", "PYTRNLAND", "PYTRNTOT", "PYTRNEXTOT", "PYTXBTOT", "PYTXBEXTOT", "PYTAXCLASS",
    "TENMKTLAND", "TENMKTTOT", "TENACTLAND", "TENACTTOT", "TENACTEXTOT", "TENTRNLAND", "TENTRNTOT",
    "TENTRNEXTOT", "TENTXBTOT", "TENTXBEXTOT", "TENTAXCLASS", "CBNMKTLAND", "CBNMKTTOT",
    "CBNACTLAND", "CBNACTTOT", "CBNACTEXTOT", "CBNTRNLAND", "CBNTRNTOT", "CBNTRNEXTOT",
    "CBNTXBTOT", "CBNTXBEXTOT", "CBNTAXCLASS", "FINMKTLAND", "FINMKTTOT", "FINACTLAND",
    "FINACTTOT", "FINACTEXTOT", "FINTRNLAND", "FINTRNTOT", "FINTRNEXTOT", "FINTXBTOT",
    "FINTXBEXTOT", "FINTAXCLASS", "CURMKTLAND", "CURMKTTOT", "CURACTLAND", "CURACTTOT",
    "CURACTEXTOT", "CURTRNLAND", "CURTRNTOT", "CURTRNEXTOT", "CURTXBTOT", "CURTXBEXTOT",
    "CURTAXCLASS", "PERIOD", "NEWDROP", "NOAV", "VALREF", "BLDG_CLASS", "OWNER", "ZONING",
    "HOUSENUM_LO", "HOUSENUM_HI", "STREET_NAME", "ZIP_CODE", "GEOSUPPORT_RC", "STCODE", "LOT_FRT",
    "LOT_DEP", "LOT_IRREG", "BLD_FRT", "BLD_DEP", "BLD_EXT", "BLD_STORY", "CORNER", "LAND_AREA",
    "NUM_BLDGS", "YRBUILT", "YRBUILT_RANGE", "YRBUILT_FLAG", "YRALT1", "YRALT1_RANGE", "YRALT2",
    "YRALT2_RANGE", "COOP_APTS", "UNITS", "REUC_REF", "APTNO", "COOP_NUM", "CPB_BORO", "CPB_DIST",
    "APPT_DATE", "APPT_BORO", "APPT_BLOCK", "APPT_LOT", "APPT_EASE", "CONDO_NUMBER", "CONDO_SFX1",
    "CONDO_SFX2", "CONDO_SFX3", "UAF_LAND", "UAF_BLDG", "PROTEST_1", "PROTEST_2", "PROTEST_OLD",
    "ATTORNEY_GROUP1", "ATTORNEY_GROUP2", "ATTORNEY_GROUP_OLD", "GROSS_SQFT", "HOTEL_AREA_GROSS",
    "OFFICE_AREA_GROSS", "RESIDENTIAL_AREA_GROSS", "RETAIL_AREA_GROSS", "LOFT_AREA_GROSS",
    "FACTORY_AREA_GROSS", "WAREHOUSE_AREA_GROSS", "STORAGE_AREA_GROSS", "GARAGE_AREA",
    "OTHER_AREA_GROSS", "REUC_DESCRIPTION", "EXTRACTDT", "PYTAXFLAG", "TENTAXFLAG", "CBNTAXFLAG",
    "FINTAXFLAG", "CURTAXFLAG",
)
_COL = {name: i for i, name in enumerate(LAYOUT)}

# DOF building class → FactLot category, from the publisher's building classification list
# (nyc.gov/assets/finance/jump/hlpbldgcode.html, read 2026-11-02). Classes not listed are out of
# scope: A/B (1–2 family), C0/C3/CM (3–4 family, trailer parks), M religious, N asylums and homes,
# P indoor public assembly, Q outdoor recreation, R residential condo units and co-ops (R0–R4, R6,
# R9), RA/RT condo common areas, S0–S4 (1–4 family with a store), T transportation, U utilities,
# V vacant land, W education, Y government, Z miscellaneous, and G0 (residential garage).
_B_CLASSES = frozenset({
    "C1", "C2", "C4", "C5", "C6", "C7", "C8", "C9",   # walk-up apartments (C2 is 5–6 families)
    "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9",  # elevator apartments
    "S5",  # primarily 5–6 family with one store or office
    "RR",  # condominium rentals (a rental building held as a condominium)
})
# Small apartment classes ("less than 11 units", "single or multiple dwelling"): multifamily only
# when the roll shows five or more units.
_B_IF_5_UNITS = frozenset({"CB", "CC", "DB", "DC", "S9"})
_F1_PREFIXES = ("G", "H", "I", "J", "K", "L", "O")  # garages, hotels, health, theatres, stores, lofts, offices
_F1_CLASSES = frozenset({"R5", "R8", "RB", "RG", "RH", "RK", "RP", "RS"})  # commercial condo units
_F2_PREFIXES = ("E", "F")  # warehouses, factories and industrial buildings
_F2_CLASSES = frozenset({"RW"})  # warehouse/factory/industrial condo units
_NOT_COMMERCIAL = frozenset({"G0"})  # garage on a tax class 1 residence

# Owner strings DOF writes when it has no owner of record: the parcel keeps no owner name.
_PLACEHOLDER_OWNERS = frozenset({
    "", "UNAVAILABLE OWNER", "OWNER NOT ON FILE", "NAME NOT ON FILE", "NOT ON FILE", "UNKNOWN",
    "UNKNOWN OWNER", "N/A", "NA", "NONE",
})


def category(bldg_class: str | None, units: float | None = None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for a DOF building class, or ``None`` when out of scope."""
    c = (bldg_class or "").strip().upper()
    if not c or c in _NOT_COMMERCIAL:
        return None
    if c in _B_CLASSES or (c in _B_IF_5_UNITS and units is not None and units >= 5):
        return "B"
    if c in _F2_CLASSES or c[0] in _F2_PREFIXES:
        return "F2"
    if c in _F1_CLASSES or c[0] in _F1_PREFIXES:
        return "F1"
    return None


def _rows(path: str | Path) -> Iterator[tuple[str, int, list[str]]]:
    """Stream ``(member name, line number, fields)`` from the zip's text member(s), or from an
    unpacked directory. The header row is dropped, and so is the empty field after each line's
    trailing tab."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for member in sorted(p.glob("*.TXT")) + sorted(p.glob("*.txt")):
            with open(member, newline="", encoding="latin-1") as f:
                for n, fields in enumerate(csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE), 1):
                    if (fields := _data_fields(fields)) is not None:
                        yield member.name, n, fields
        return
    with zipfile.ZipFile(p) as zf:
        for name in zf.namelist():
            base = name.rsplit("/", 1)[-1]
            if not base.lower().endswith(".txt") or base.startswith("._"):
                continue
            with zf.open(name) as raw:
                text = io.TextIOWrapper(raw, encoding="latin-1", newline="")
                for n, fields in enumerate(csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE), 1):
                    if (fields := _data_fields(fields)) is not None:
                        yield base, n, fields


def _data_fields(fields: list[str]) -> list[str] | None:
    """``None`` for the header row; otherwise the fields without the trailing tab's empty field."""
    if fields[:1] == ["PARID"]:
        return None
    if len(fields) == len(LAYOUT) + 1 and fields[-1] == "":
        return fields[:-1]
    return fields


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years and units: DOF writes 0 when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _house_number(lo: str, hi: str) -> str:
    """``34`` → ``34``; ``34``/``50`` → ``34-50``; Queens hyphenated numbers ``37-10``/``37-20`` → ``37-10 TO 37-20``."""
    lo, hi = _squeeze(lo).lstrip("0") or _squeeze(lo), _squeeze(hi).lstrip("0") or _squeeze(hi)
    if not hi or hi == lo:
        return lo
    if not lo:
        return hi
    return f"{lo}-{hi}" if "-" not in lo + hi else f"{lo} TO {hi}"


def _situs(f: list[str]) -> str | None:
    street = _squeeze(f[_COL["STREET_NAME"]])
    if not street:
        return None
    number = _house_number(f[_COL["HOUSENUM_LO"]], f[_COL["HOUSENUM_HI"]])
    line = " ".join(x for x in (number, street) if x)
    city = _SITUS_CITY.get(_squeeze(f[_COL["BORO"]]), "")
    zip_code = _squeeze(f[_COL["ZIP_CODE"]])
    rest = " ".join(x for x in (city, "NY", zip_code) if x)
    return f"{line}, {rest}"


_OWNER_HALF = 40


def _wrapped(raw: str) -> bool:
    """A 40-character first half that runs on into a second half: the break may be inside a word."""
    return len(raw) > _OWNER_HALF + 1 and raw[_OWNER_HALF - 1] != " " and raw[_OWNER_HALF] == " " \
        and raw[_OWNER_HALF + 1] != " "


def owner_vocabulary(rows: Iterable[list[str]]) -> Counter:
    """Words of the owner names that were not wrapped, to tell a broken word from two words."""
    vocab: Counter = Counter()
    for f in rows:
        raw = f[_COL["OWNER"]]
        if not _wrapped(raw):
            vocab.update(raw.split())
    return vocab


def _owner(raw: str | None, vocab: Counter | None = None) -> str | None:
    raw = raw or ""
    if vocab is not None and _wrapped(raw):
        first, second = raw[:_OWNER_HALF].split(), raw[_OWNER_HALF + 1:].split()
        joined = first[-1] + second[0]
        if vocab[joined] >= 2 and vocab[joined] >= vocab[first[-1]]:
            raw = raw[:_OWNER_HALF] + raw[_OWNER_HALF + 1:]
    n = _squeeze(raw)
    return None if n.upper() in _PLACEHOLDER_OWNERS else n


def _bbl(f: list[str]) -> str | None:
    """10-digit BBL (borough, 5-digit block, 4-digit lot) plus the easement letter when present."""
    boro, block, lot = (_squeeze(f[_COL[k]]) for k in ("BORO", "BLOCK", "LOT"))
    if not (boro.isdigit() and block.isdigit() and lot.isdigit()):
        return None
    return f"{boro}{int(block):05d}{int(lot):04d}{_squeeze(f[_COL['EASE']]).upper()}"


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per ordinary real-estate lot in scope, in file order.

    ``categories`` limits the lots kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every lot, with ``state_category`` ``None`` for the out-of-scope building
    classes. Rows with the wrong column count and utility idents (``RECTYPE`` 2 and 3) are skipped.
    """
    wanted = None if categories is None else frozenset(c.upper() for c in categories)
    vocab = owner_vocabulary(f for _m, _n, f in _rows(path) if len(f) == len(LAYOUT))
    for member, line, f in _rows(path):
        if len(f) != len(LAYOUT):
            continue
        if _squeeze(f[_COL["RECTYPE"]]) != "1":
            continue
        bbl = _bbl(f)
        if not bbl:
            continue
        units = _positive(f[_COL["UNITS"]])
        bldg_class = _squeeze(f[_COL["BLDG_CLASS"]]).upper() or None
        cat = category(bldg_class, units)
        if wanted is not None and cat not in wanted:
            continue
        boro = _squeeze(f[_COL["BORO"]])
        yield ParcelRecord(
            county_fips=COUNTY_FIPS[boro],
            apn=bbl,
            state_category=cat,
            account=bbl,
            situs_address=_situs(f),
            owner_name=_owner(f[_COL["OWNER"]], vocab),
            owner_mailing_address=None,  # the roll carries no mailing address
            owner_confidential=False,  # the roll carries no confidentiality marker
            land_area_sf=_positive(f[_COL["LAND_AREA"]]),
            improvement_area_sf=_positive(f[_COL["GROSS_SQFT"]]),
            year_built=int(y) if (y := _positive(f[_COL["YRBUILT"]])) else None,
            market_value=_num(f[_COL["FINMKTTOT"]]),
            appraised_value=_num(f[_COL["FINACTTOT"]]),
            tax_year=int(y) if (y := _num(f[_COL["TAXYR"]])) else None,
            locator=f"{member} line {line} PARID {_squeeze(f[_COL['PARID']])}",
            local_use_code=bldg_class,
        )


def _tallied(records: Iterable[ParcelRecord], tally: Counter) -> Iterator[ParcelRecord]:
    for r in records:
        tally[(r.county_fips, r.state_category)] += 1
        yield r


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True, tally: Counter | None = None) -> IngestStats:
    """Ingest one archived ``fy<YY>_tc234.zip`` (or ``_avroll1234.zip``) into a registry file.

    ``tally``, when given, receives the count of records read per ``(county_fips, category)``.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        records = read_roll(snapshot_path)
        if tally is not None:
            records = _tallied(records, tally)
        return reg.ingest_parcels(records, snap, state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM,
                                  full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_nyc", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to fy<YY>_tc234.zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="roll date, YYYY-MM-DD (the EXTRACTDT in the file, or the final roll date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    tally: Counter = Counter()
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  full_roll=not args.partial, tally=tally)
    out = asdict(stats)
    out["read_by_county_and_category"] = {f"{county} {cat}": n for (county, cat), n in sorted(tally.items())}
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
