"""Travis Central Appraisal District (Austin): the certified appraisal export zip → ``ParcelRecord``.

Layout (confirmed on the 2026 certified export, supplement 0, 2026-11-02): a zip of fixed-width
text files with CRLF line endings and Latin-1 bytes, in the True Prodigy "Legacy 8.0.33" appraisal
export layout, which TCAD publishes next to the data (``Website_Legacy8.0.33-AppraisalExportLayout``
zip: a PDF and a spreadsheet, one sheet per file, with the 1-based start and end column of every
field). The column positions below are transcribed from that spreadsheet.

- ``PROP.TXT`` (file #2, 9,922 characters per record) — one record per property **and owner**: a
  property with several owners repeats, and ``prop_owner_sequence`` (``100301``, ``100301-1``) tells
  them apart; the first owner's sequence equals the ``prop_id``. ``prop_type_cd`` is ``R`` real,
  ``P`` business personal property, ``MH`` mobile home, ``MN`` mineral. The owner for the
  appraisal year is ``py_owner_name`` with the ``py_addr_*`` mailing address, a
  ``py_confidential_flag`` (Tax Code §25.025) and a ``py_address_suppress_flag``; situs is
  ``situs_num``, ``situs_street_prefx``, ``situs_street``, ``situs_street_suffix``, ``situs_unit``,
  ``situs_city`` (blank on most records), ``situs_zip``. ``imprv_state_cd`` and ``land_state_cd``
  carry TCAD's own state codes (``F4``), ``land_acres`` the acreage, ``market_value`` and
  ``appraised_val`` the values, ``prop_val_yr`` the year. ``hood_cd`` (columns 1686–1695,
  "Neighborhood code") is written as ``parcel.neighborhood_code``. ``sup_num`` is 0 on certified records and
  the supplement number otherwise; the supplemental export is a full re-export of the roll, not a
  delta (``sup_action`` is blank on every record of the 2026 supplement 3 file; a ``D`` would mark
  a deletion).
- ``STATE_CD.TXT`` (file #6) — TCAD's code table: each CAD state code with the Comptroller (PTD)
  category it reports it under. TCAD reports ``F3`` commercial details, ``F4`` commercial condos
  and ``F5`` commercial residential conversions as ``F2``, and all ``B1``–``B5`` as ``B``.
- ``LAND_DET.TXT`` (file #10, 199 characters) — one record per land segment: ``size_acres`` (four
  implied decimals) and ``size_square_feet``.
- ``IMP_DET.TXT`` (file #8, 622 characters) — one record per improvement detail (a floor, a canopy,
  paved area, a fence, ...): ``imprv_det_type_cd``, ``yr_built``, ``imprv_det_area``. Building area
  is the sum of the floor details (``1ST``, ``2ND``, ..., ``ADDL``, ``MEZZ``, basements); the
  oldest floor dates the parcel. ``imprv_det_class_cd`` (columns 76–85, "Class Code") of the main
  improvement is written as ``parcel.building_class``: the class of the largest floor detail (first in
  file order on a tie), or of the largest detail of any type when the property has no floor detail
  with a class (a class with no letter or digit, such as ``*``, is skipped). TCAD's export has no
  separate quality code.

Prior years. TCAD posts no earlier Legacy export; the only prior-year rolls on its public information
page are its yearly EARS submissions to the Comptroller (``227EARS<mmddyy>.zip``, tax years 2022 to
2025). An EARS file is one comma-delimited text file (the Comptroller's *Electronic Appraisal Roll
Submission Record Layout and Instructions Manual*, form 96-1051; TCAD zips the csv and zips that zip
again). It holds ``AJR`` records, one per account, taxing unit and Comptroller category, with the
fields in the manual's order (``EARS_FIELDS`` below, 1-based): AJR002 the tax year, AJR004 to AJR006
the taxing unit (ID, type ``00`` for the county, county fund type), AJR008 the short account number,
which is TCAD's ``prop_id``, AJR031 the category, and the market value of that category in that unit
as AJR034 (totally exempt), AJR035 (land), AJR036 (improvements), AJR037 (minerals) and AJR038
(personal property), in whole dollars, after ARB changes and before any cap. The file carries no
owner name. ``read_ears_value_history`` reads the county's records only (every Travis property is in
the county unit; another unit's record can cover only the part of a property inside that unit) and
adds the categories of an account up to its market value. EARS has no appraised value (it reports
cap losses per taxing unit instead), so a prior year carries the market value alone. These files load
as value history only (``--history-only``, ``Registry.ingest_value_history``).

Usage: ``python -m factlot.registry.adapters.tx_travis "2026 Certified Appraisal Export Supp 0.zip" registry.db --as-of 2026-07-18``
Prior year: ``python -m factlot.registry.adapters.tx_travis 227EARS090425.zip registry.db --as-of 2025-09-04 --history-only 2025``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import asdict, replace
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, ParcelValues, Registry, Source

STATE_FIPS = "48"
COUNTY_FIPS = "453"
ACCOUNT_SYSTEM = "tcad_prop_id"

SOURCE = Source(
    source_id="tx-travis-cad",
    publisher="Travis Central Appraisal District",
    title="Certified appraisal export (True Prodigy Legacy 8.0.33 layout)",
    url="https://traviscad.org/publicinformation",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license or terms of use stated for the exports",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; public record
    attribution="Travis Central Appraisal District",
    terms_reviewed="2026-11-02",
)

# EARS (form 96-1051) AJR fields read here, by their 1-based position in the comma-delimited record.
EARS_FIELDS = {
    "record_type": 1, "year": 2, "taxing_unit_id": 4, "taxing_unit_type": 5, "county_fund_type": 6,
    "short_account": 8, "category": 31,
    "totally_exempt": 34, "land_market": 35, "improvement_market": 36, "mineral_market": 37, "personal_market": 38,
}
_EARS_VALUE_FIELDS = ("totally_exempt", "land_market", "improvement_market", "mineral_market", "personal_market")
EARS_COUNTY_UNIT_TYPE = "00"
EARS_PUBLISHER_URL = "https://traviscad.org/publicinformation"


def ears_source(tax_year: int) -> Source:
    """The registry source of one year's EARS submission (``tx-travis-cad-<year>``)."""
    return replace(SOURCE, source_id=f"{SOURCE.source_id}-{tax_year}",
                   title=f"EARS submission to the Comptroller (electronic appraisal roll), tax year {tax_year}",
                   url=EARS_PUBLISHER_URL)


# Fixed-width fields as (start, end), 1-based and inclusive, from the Legacy 8.0.33 layout.
PROP_FIELDS = {
    "prop_id": (1, 12), "prop_type_cd": (13, 17), "prop_val_yr": (18, 22), "sup_num": (23, 34), "sup_action": (35, 36),
    "geo_id": (547, 596), "hood_cd": (1686, 1695),
    "py_owner_name": (609, 678), "partial_owner": (679, 679),
    "py_addr_line1": (694, 753), "py_addr_line2": (754, 813), "py_addr_line3": (814, 873),
    "py_addr_city": (874, 923), "py_addr_state": (924, 973), "py_addr_country": (974, 978),
    "py_addr_zip": (979, 983), "py_addr_zip_cass": (984, 987),
    "py_confidential_flag": (990, 990), "py_address_suppress_flag": (991, 991),
    "situs_street_prefx": (1040, 1049), "situs_street": (1050, 1099), "situs_street_suffix": (1100, 1109),
    "situs_city": (1110, 1139), "situs_zip": (1140, 1149),
    "appraised_val": (1916, 1930),
    "imprv_state_cd": (2732, 2741), "land_state_cd": (2742, 2751), "land_acres": (2772, 2791),
    "prop_owner_sequence": (4051, 4090), "market_value": (4214, 4227),
    "situs_num": (4460, 4474), "situs_unit": (4475, 4479),
}
PROP_RECORD_LENGTH = 9922
STATE_CD_FIELDS = {"state_cd": (1, 10), "ptd_state_cd": (61, 70)}
LAND_DET_FIELDS = {"prop_id": (1, 12), "size_acres": (70, 83), "size_square_feet": (84, 97)}
IMP_DET_FIELDS = {"prop_id": (1, 12), "imprv_det_type_cd": (41, 50), "imprv_det_class_cd": (76, 85), "yr_built": (86, 89),
                  "imprv_det_area": (94, 108)}

# Improvement detail types that are building floors; everything else (canopies, paved area,
# fences, pools, parking garages, plumbing counts) is not building area.
_FLOOR_DETAIL_TYPES = frozenset({"1ST", "2ND", "3RD", "4TH", "5TH", "ADDL", "1/2", "MEZZ", "FBSMT", "UBSMT"})

# TCAD state code → Comptroller (PTD) category, transcribed from STATE_CD.TXT in the 2026 export.
# The export's own STATE_CD.TXT takes precedence when it is present; this is the fallback.
_STATE_CATEGORY = {
    "A1": "A", "A2": "A", "A3": "A", "A4": "A", "A5": "A", "A9": "A",
    "B1": "B", "B2": "B", "B3": "B", "B4": "B", "B5": "B",
    "C1": "C1", "C2": "C2", "D1": "D1", "D2": "D2", "D3": "D2",
    "E1": "E", "E2": "E", "E3": "E",
    "F1": "F1", "F2": "F2", "F3": "F2", "F4": "F2", "F5": "F2",
    "G1": "G1", "G2": "G2", "G3": "G3",
    **{f"J{i}": f"J{i}" for i in range(1, 10)},
    "L1": "L1", "L2": "L2", "M1": "M1", "M2": "M2", "N1": "N", "N2": "N", "O1": "O", "S1": "S", "X": "X",
}

_SQFT_PER_ACRE = 43560


def _lines(path: str | Path, name: str) -> Iterator[str]:
    """Stream the records of one fixed-width member, from the zip or from an unpacked directory."""
    p = Path(path)
    if p.is_dir():
        with open(p / name, "rb") as f:
            for line in f:
                yield line.decode("latin-1").rstrip("\r\n")
        return
    with zipfile.ZipFile(p) as zf, zf.open(name) as raw:
        for line in io.BufferedReader(raw, 1 << 22):
            yield line.decode("latin-1").rstrip("\r\n")


def _has_member(path: str | Path, name: str) -> bool:
    p = Path(path)
    if p.is_dir():
        return (p / name).is_file()
    with zipfile.ZipFile(p) as zf:
        return name in zf.namelist()


def _field(line: str, span: tuple[int, int]) -> str:
    start, end = span
    return line[start - 1:end].strip()


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(s: str, decimals: int = 0) -> float | None:
    """A fixed-width numeric: digits with ``decimals`` implied decimal places, or an explicit point."""
    s = s.strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v / 10 ** decimals if decimals and "." not in s else v


def _positive(s: str, decimals: int = 0) -> float | None:
    """Areas and years: TCAD writes 0 when it has no figure, which is not a fact."""
    v = _num(s, decimals)
    return v if v and v > 0 else None


def read_state_codes(path: str | Path) -> dict[str, str]:
    """TCAD state code → Comptroller category from the export's ``STATE_CD.TXT``, or the fallback table."""
    if not _has_member(path, "STATE_CD.TXT"):
        return dict(_STATE_CATEGORY)
    table = dict(_STATE_CATEGORY)
    for line in _lines(path, "STATE_CD.TXT"):
        code = _field(line, STATE_CD_FIELDS["state_cd"]).upper()
        ptd = _field(line, STATE_CD_FIELDS["ptd_state_cd"]).upper()
        if code and ptd:
            table[code] = ptd
    return table


def state_category(code: str | None, table: dict[str, str] | None = None) -> str | None:
    """Comptroller category for a TCAD state code (``F4`` → ``F2``, ``B2`` → ``B``); unknown codes pass through."""
    c = _squeeze(code).upper()
    return (table or _STATE_CATEGORY).get(c, c) or None


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(" ".join((r["situs_street_prefx"], r["situs_street"], r["situs_street_suffix"])))
    if not street:
        return None
    line = _squeeze(" ".join((r["situs_num"], street, r["situs_unit"])))
    rest = " ".join(x for x in (r["situs_city"], "TX", r["situs_zip"]) if x)
    return f"{line}, {rest}"


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [r["py_addr_line1"], r["py_addr_line2"], r["py_addr_line3"]]
    zip_code = r["py_addr_zip"]
    if zip_code and r["py_addr_zip_cass"]:
        zip_code = f"{zip_code}-{r['py_addr_zip_cass']}"
    state_zip = " ".join(x for x in (r["py_addr_state"], zip_code) if x)
    lines.append(", ".join(x for x in (r["py_addr_city"], state_zip) if x))
    country = r["py_addr_country"].upper()
    if country and country not in ("US", "USA", "UNITED STATES"):
        lines.append(country)
    return ", ".join(_squeeze(x) for x in lines if x.strip()) or None


def _parse(line: str, fields: dict[str, tuple[int, int]]) -> dict[str, str]:
    return {name: _field(line, span) for name, span in fields.items()}


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real property in scope, in ``PROP.TXT`` order.

    ``categories`` limits the properties kept by Comptroller category (default: the registry's
    commercial scope); ``None`` keeps every real property, which needs memory for the whole roll.
    Business personal property, mobile homes and minerals are never parcels. Repeated records for
    one property (one per owner) collapse to the first.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    table = read_state_codes(path)
    # 1. The properties in scope, with their PROP.TXT fields.
    kept: dict[str, dict[str, str]] = {}
    for line in _lines(path, "PROP.TXT"):
        if _field(line, PROP_FIELDS["prop_type_cd"]).upper() != "R":
            continue
        if _field(line, PROP_FIELDS["sup_action"]).upper() == "D":  # a supplement deleting the property
            continue
        pid = _field(line, PROP_FIELDS["prop_id"]).lstrip("0")
        if not pid or pid in kept:
            continue
        code = _field(line, PROP_FIELDS["imprv_state_cd"]) or _field(line, PROP_FIELDS["land_state_cd"])
        category = state_category(code, table)
        if not keep(category):
            continue
        r = _parse(line, PROP_FIELDS)
        r["_code"], r["_category"] = code.upper(), category or ""
        kept[pid] = r
    # 2. Land segments and improvement details for those properties.
    land: dict[str, float] = defaultdict(float)
    if _has_member(path, "LAND_DET.TXT"):
        for line in _lines(path, "LAND_DET.TXT"):
            pid = _field(line, LAND_DET_FIELDS["prop_id"]).lstrip("0")
            if pid not in kept:
                continue
            if sf := _positive(_field(line, LAND_DET_FIELDS["size_square_feet"])):
                land[pid] += sf
            elif acres := _positive(_field(line, LAND_DET_FIELDS["size_acres"]), 4):
                land[pid] += acres * _SQFT_PER_ACRE
    area: dict[str, float] = defaultdict(float)
    built: dict[str, int] = {}
    built_any: dict[str, int] = {}
    # Main improvement class: (is a floor, area) of the best detail with a class so far, and its class.
    main_class: dict[str, tuple[tuple[bool, float], str]] = {}
    if _has_member(path, "IMP_DET.TXT"):
        for line in _lines(path, "IMP_DET.TXT"):
            pid = _field(line, IMP_DET_FIELDS["prop_id"]).lstrip("0")
            if pid not in kept:
                continue
            floor = _field(line, IMP_DET_FIELDS["imprv_det_type_cd"]).upper() in _FLOOR_DETAIL_TYPES
            year = _positive(_field(line, IMP_DET_FIELDS["yr_built"]))
            cls = _squeeze(_field(line, IMP_DET_FIELDS["imprv_det_class_cd"]))
            if re.search(r"[A-Za-z0-9]", cls):  # a bare "*" (20 commercial properties in 2026) is not a class
                rank = (floor, _positive(_field(line, IMP_DET_FIELDS["imprv_det_area"])) or 0.0)
                if pid not in main_class or rank > main_class[pid][0]:
                    main_class[pid] = (rank, cls)
            if floor:
                if a := _positive(_field(line, IMP_DET_FIELDS["imprv_det_area"])):
                    area[pid] += a
                if year:
                    built[pid] = min(built.get(pid, int(year)), int(year))
            elif year:
                built_any[pid] = min(built_any.get(pid, int(year)), int(year))
    # 3. Yield.
    for pid, r in kept.items():
        confidential = r["py_confidential_flag"].upper() == "T"
        owner = None if confidential else (_squeeze(r["py_owner_name"]) or None)
        suppressed = confidential or r["py_address_suppress_flag"].upper() == "T"
        land_sf = round(land[pid], 2) if land.get(pid) else None
        if land_sf is None and (acres := _positive(r["land_acres"], 4)):
            land_sf = round(acres * _SQFT_PER_ACRE, 2)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pid,
            state_category=r["_category"] or None,
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner and not suppressed else None,
            owner_confidential=confidential,
            land_area_sf=land_sf,
            improvement_area_sf=round(area[pid], 2) if area.get(pid) else None,
            year_built=built.get(pid, built_any.get(pid)),
            market_value=_num(r["market_value"]),
            appraised_value=_num(r["appraised_val"]),
            tax_year=int(y) if (y := _num(r["prop_val_yr"])) else None,
            locator=f"PROP.TXT prop_id {pid}",
            local_use_code=r["_code"] or None,
            extra_facts=[(p, v, None) for p, v in (("parcel.neighborhood_code", _squeeze(r["hood_cd"])),
                                                    ("parcel.building_class", main_class.get(pid, ((), ""))[1])) if v],
        )


def _ears_text(path: str | Path) -> tuple[str, io.TextIOBase]:
    """The csv of an EARS submission as (member name, text stream): a ``.csv`` file, or a zip holding the csv
    or holding the zip that holds it. TCAD's files are zipped twice, and the outer zip also carries PDF recaps
    and other attachments, so the member is chosen by name: the one ``.csv`` or ``.zip`` with ``EARS`` in it
    (or the only ``.csv``). Latin-1, like the Legacy export."""
    p = Path(path)
    if p.suffix.lower() == ".csv":
        return p.name, open(p, encoding="latin-1", newline="")
    zf = zipfile.ZipFile(p)
    for _ in range(2):
        names = [n for n in zf.namelist() if not n.endswith("/")]
        csvs = [n for n in names if n.lower().endswith(".csv")]
        named = [n for n in csvs if "ears" in Path(n).name.lower()]
        pick = named if len(named) == 1 else csvs
        if len(pick) == 1:
            return Path(pick[0]).name, io.TextIOWrapper(zf.open(pick[0]), encoding="latin-1", newline="")
        inner = [n for n in names if n.lower().endswith(".zip") and "ears" in Path(n).name.lower()]
        if pick or len(inner) != 1:
            break
        zf = zipfile.ZipFile(io.BytesIO(zf.read(inner[0])))
    raise ValueError(f"{p.name}: expected one EARS .csv, or one EARS .zip holding it; found {zf.namelist()[:10]}")


def read_ears_value_history(path: str | Path, accounts: Iterable[str], *,
                            problems: list[str] | None = None) -> Iterator[ParcelValues]:
    """Yield each listed account's tax year and market value from an EARS submission, and nothing else.

    For a prior-year roll (``Registry.ingest_value_history``). Only the county's ``AJR`` records are read
    (taxing unit type ``00``; with several county funds, fund ``A`` or else the first in code order), and an
    account's categories are added up: totally exempt, land, improvement, mineral and personal property
    market value. Addresses, legal descriptions and owner ID codes in the file are never read. An account
    whose records state more than one year, or a value that is not a number, is not yielded and is named
    in ``problems``; so is a record with too few fields. A total of 0 is not a figure.
    """
    wanted = frozenset(a.lstrip("0") for a in accounts)
    f = EARS_FIELDS
    last = max(f.values())
    totals: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))  # account → fund → market value
    years: dict[str, set[str]] = defaultdict(set)
    unit_ids: dict[str, str] = {}
    bad: set[str] = set()
    note = problems.append if problems is not None else (lambda _m: None)
    name, text = _ears_text(path)
    with text:
        for n, row in enumerate(csv.reader(text), 1):
            if not row or row[0].strip().upper() != "AJR":
                continue
            if len(row) < last:
                note(f"{name} line {n}: {len(row)} fields, expected at least {last}")
                continue
            if row[f["taxing_unit_type"] - 1].strip() != EARS_COUNTY_UNIT_TYPE:
                continue
            acct = row[f["short_account"] - 1].strip().lstrip("0")
            if acct not in wanted:
                continue
            try:
                value = sum(float(v) for name_ in _EARS_VALUE_FIELDS if (v := row[f[name_] - 1].strip()))
            except ValueError:
                bad.add(acct)
                note(f"{name} line {n}: account {acct} has a value that is not a number")
                continue
            fund = row[f["county_fund_type"] - 1].strip().upper()
            totals[acct][fund] += value
            years[acct].add(row[f["year"] - 1].strip())
            unit_ids.setdefault(acct, row[f["taxing_unit_id"] - 1].strip())
    for acct, by_fund in totals.items():
        if acct in bad:
            continue
        if len(years[acct]) != 1 or not (y := next(iter(years[acct]))).isdigit():
            note(f"{name}: account {acct} states tax years {sorted(years[acct])}")
            continue
        fund = "A" if "A" in by_fund else min(by_fund)
        total = by_fund[fund]
        yield ParcelValues(
            county_fips=COUNTY_FIPS, apn=acct, tax_year=int(y),
            market_value=total if total > 0 else None, appraised_value=None,
            locator=f"{name} AJR short account {acct}, taxing unit {unit_ids[acct]} (county)",
        )


def build_history(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, tax_year: int,
                  retrieved_at: str | None = None) -> IngestStats:
    """Add one prior year's market values from an archived EARS submission to the Travis parcels already loaded.

    History only (``Registry.ingest_value_history``): the current record, owners and addresses are not touched.
    An account whose records are not of ``tax_year`` is not loaded and is named in ``stats.errors``.
    """
    reg = Registry(db_path)
    try:
        src = ears_source(tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute("SELECT external_id FROM crosswalk WHERE system = ?", (ACCOUNT_SYSTEM,))]
        problems: list[str] = []
        wrong: list[str] = []

        def in_year(rows: Iterable[ParcelValues]) -> Iterator[ParcelValues]:
            for r in rows:
                if r.tax_year == tax_year:
                    yield r
                else:
                    wrong.append(f"{r.locator}: tax year {r.tax_year}, expected {tax_year}")

        stats = reg.ingest_value_history(in_year(read_ears_value_history(snapshot_path, accounts, problems=problems)),
                                         snap, state_fips=STATE_FIPS)
        stats.seen += len(wrong) + len(problems)
        stats.skipped_invalid += len(wrong) + len(problems)
        stats.errors.extend((wrong + problems)[:20])
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats
    finally:
        reg.close()


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived certified export into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        # One registry source per tax year (store.roll_source): a next-year file never retires this year's roll.
        return reg.ingest_roll(SOURCE, snapshot_path, read_roll(snapshot_path), as_of=as_of, retrieved_at=retrieved_at,
                               state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_travis", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the certified appraisal export zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the run date in APPR_HDR.TXT)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    ap.add_argument("--history-only", type=int, metavar="TAX_YEAR",
                    help="the file is the EARS submission of this earlier tax year (227EARS<mmddyy>.zip): add its market "
                         "values to parcels already loaded and change nothing else (owners, addresses, other facts "
                         "and parcels are not written)")
    args = ap.parse_args(argv)
    if args.history_only:
        print(json.dumps(asdict(build_history(args.snapshot, args.db, as_of=args.as_of, tax_year=args.history_only,
                                              retrieved_at=args.retrieved_at)), indent=2))
        return 0
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
