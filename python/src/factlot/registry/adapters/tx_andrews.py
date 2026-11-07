"""Andrews County 2026 real-property workbook → ``ParcelRecord``.

Categories come from the district's own ``APPRAISAL_STATE_CODE.TXT`` in the 2025
supplement-2 PACS export (header run 2025-07-23, PACS 8.50.2.11, export 8.0.30).
That file is a prior-year reference. It is not a 2026 code table. A local code is
used only when the table gives it one Comptroller category. ``L3``, ``N``, and ``Y``
are left out: the local label says mineral and the Comptroller label does not.
A code that is not in the 2025 table is left out. Personal names are not stored.
The 2025 property, owner, agent, and sales files were not read.
"""

from __future__ import annotations

import zipfile
from collections.abc import Iterator
from pathlib import Path
from xml.etree import ElementTree as ET

from ..normalize import is_commercial, is_organization
from ..store import IngestStats, ParcelRecord, Registry, Source

# Local code, Comptroller category, local label, Comptroller label.
# Transcribed from 2025-07-23_001537_APPRAISAL_STATE_CODE.TXT. Not a 2026 file.
MAPPING_AS_OF = "2025-07-23"
MAPPING_SOURCE = "2025 supplement 2 APPRAISAL_STATE_CODE.TXT (export 8.0.30)"
_CODES: dict[str, tuple[str, str, str]] = {
    "A1": ("A", "SINGLE FAMILY RESIDENCE", "SINGLE FAMILY RESIDENCE"),
    "A2": ("A", "SINGLE FAMILY RESIDEN (MH)", "SINGLE FAMILY RESIDENCE"),
    "A3": ("A", "SINGLE FAMILY RES ONLY", "SINGLE FAMILY RESIDENCE"),
    "A4": ("A", "MISCELLANEOUS IMPV", "SINGLE FAMILY RESIDENCE"),
    "A5": ("A", "CONDOS (DETAILS)", "SINGLE FAMILY RESIDENCE"),
    "B1": ("B", "MULTIFAMILY", "MULTIFAMILY RESIDENCE"),
    "B2": ("B", "DUPLEX", "MULTIFAMILY RESIDENCE"),
    "B3": ("B", "TRI-PLEX", "MULTIFAMILY RESIDENCE"),
    "B4": ("B", "FOUR-PLEX", "MULTIFAMILY RESIDENCE"),
    "C1": ("C1", "VACANT RESIDENTIAL DEV", "VACANT LOTS AND LAND TRACTS"),
    "C2": ("C1", "VACANT LOT COMMERCIAL", "VACANT LOTS AND LAND TRACTS"),
    "C3": ("C1", "VACANT RESIDENTIAL UNDEV", "VACANT LOTS AND LAND TRACTS"),
    "C4": ("C1", "VACANT COMML UNDEV", "VACANT LOTS AND LAND TRACTS"),
    "D1": ("D1", "ACREAGE (AG) 1-D-1", "QUALIFIED OPEN-SPACE LAND"),
    "D2": ("D2", "IMPROVEMENTS ON QUALIFIED AG LAND", "IMPROVEMENTS ON QUALIFIED OPEN SPACE LAND"),
    "D3": ("D1", "AG 1-D", "QUALIFIED OPEN-SPACE LAND"),
    "E1": ("E", "FARM & RANCH IMPR", "RURAL LAND, NON QUALIFIED OPEN SPACE LAND, IMPRVS"),
    "E2": ("E", "FARM & RANCH IMPR (MH)", "RURAL LAND, NON QUALIFIED OPEN SPACE LAND, IMPRVS"),
    "E3": ("E", "FARM & RANCH IMPR (MISC)", "RURAL LAND, NON QUALIFIED OPEN SPACE LAND, IMPRVS"),
    "E4": ("E", "RURAL LAND NON QUALIFIED", "RURAL LAND, NON QUALIFIED OPEN SPACE LAND, IMPRVS"),
    "F1": ("F1", "COMMERCIAL", "COMMERCIAL REAL PROPERTY"),
    "F2": ("F2", "INDUSTRIAL", "INDUSTRIAL AND MANUFACTURING REAL PROPERTY"),
    "F3": ("F1", "COMMERCIAL (DETAILS)", "COMMERCIAL REAL PROPERTY"),
    "F4": ("F1", "COMMERCIAL (CONDO)", "COMMERCIAL REAL PROPERTY"),
    "G1": ("G1", "MINERAL", "OIL AND GAS"),
    "G2": ("G2", "Mineral", "OTHER MINERALS"),
    "G3": ("G3", "Mineral", "OTHER SUB-SURFACE INTERESTS IN LAND"),
    "J1": ("J1", "UTILITY (WATER)", "WATER SYSTEMS"),
    "J2": ("J2", "UTILITY (GAS)", "GAS DISTRIBUTION SYSTEM"),
    "J3": ("J3", "UTILITY (ELECTRIC)", "ELECTRIC COMPANY (INCLUDING CO-OP)"),
    "J4": ("J4", "UTILITY (TELEPHONE)", "TELEPHONE COMPANY (INCLUDING CO-OP)"),
    "J5": ("J5", "UTILITY (RAILROADS)", "RAILROAD"),
    "J6": ("J6", "UTILITY (PIPELINES)", "PIPELAND COMPANY"),
    "J7": ("J7", "UTILITY (CABLE)", "CABLE TELEVISION COMPANY"),
    "J8": ("J8", "UTILITY (OTHER)", "OTHER TYPE OF UTILITY"),
    "J9": ("J9", "UTILITY (RAILROAD ROLLING STOCK)", "RAILROAD ROLLING STOCK"),
    "L1": ("L1", "COMMERCIAL PP", "COMMERCIAL PERSONAL PROPERTY"),
    "L2": ("L2", "INDUSTRIAL PP", "INDUSTRIAL AND MANUFACTURING PERSONAL PROPERTY"),
    "L3": ("L2", "Mineral", "INDUSTRIAL AND MANUFACTURING PERSONAL PROPERTY"),
    "M1": ("M1", "TANGIBLE PERS PROP (MH)", "TANGIBLE OTHER PERSONAL, MOBILE HOMES"),
    "M2": ("M2", "COMMERCIAL BOAT", "TANGIBLE OTHER PERSONAL, OTHER"),
    "M3": ("M2", "COMMERCIAL AIRCRAFT", "TANGIBLE OTHER PERSONAL, OTHER"),
    "N": ("N", "Mineral", "INTANGIBLE PROPERTY AND/OR UNCERTIFIED PROPERTY"),
    "N1": ("N", "INTANGIBLE PP", "INTANGIBLE PROPERTY AND/OR UNCERTIFIED PROPERTY"),
    "N2": ("N", "RR ROLLING STOCK", "INTANGIBLE PROPERTY AND/OR UNCERTIFIED PROPERTY"),
    "O1": ("O", "RESIDENTIAL INVENTORY", "RESIDENTIAL INVENTORY"),
    "OD": ("O", "RESIDENTIAL INV DEVELOPED", "RESIDENTIAL INVENTORY"),
    "OU": ("O", "RESIDENTIAL INV UNDEVELOPED", "RESIDENTIAL INVENTORY"),
    "S": ("S", "SPECIAL INVENTORY TAX", "SPECIAL INVENTORY TAX"),
    "S1": ("S", "SPECIAL INVENTORY", "SPECIAL INVENTORY TAX"),
    "X": ("X", "EXEMPT", "TOTALLY EXEMPT PROPERTY"),
    "Y": ("Y", "Mineral", "UNIDENTIFIED CATEGORY"),
}
# Local label says mineral; Comptroller label does not. Not used either year.
AMBIGUOUS = frozenset({"L3", "N", "Y"})

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_SQFT_PER_ACRE = 43560
_HEADERS = {
    "prop_id": "prop_id",
    "prop_type_cd": "prop_type_cd",
    "owner": "file_as_name",
    "addr1": "addr_line1",
    "addr2": "addr_line2",
    "city": "addr_city",
    "state": "addr_state",
    "zip": "addr_zip",
    "situs_num": "situs_num",
    "situs_street": "situs_street",
    "situs": "situs_display",
    "state_cd": "state_cd",
    "acres": "legal_acreage",
    "land_sf": "land_total_sqft",
    "area": "SumOfliving_area",
    "year": "yr_blt",
    "appraised": "appraised_val",
    "market": "market",
    "tax_year": "owner_tax_yr",
}


def ptd_category(code: str | None) -> str | None:
    """Comptroller category from the 2025-07-23 table, or None when the code is unused.

    ``None`` means the code is absent from that table or is one of ``L3``, ``N``, and ``Y``.
    It does not mean the 2026 workbook validated the table.
    """
    key = (code or "").strip().upper()
    if key in AMBIGUOUS or key not in _CODES:
        return None
    return _CODES[key][0]


def commercial_category(code: str | None) -> str | None:
    """Commercial Comptroller category for a 2025-table code, or None."""
    ptd = ptd_category(code)
    if ptd and is_commercial(ptd):
        return ptd
    return None


def _letters(ref: str | None) -> str:
    return "".join(ch for ch in (ref or "") if ch.isalpha())


def _cell(cell: ET.Element, shared: list[str]) -> str:
    if cell.get("t") == "s":
        value = cell.find(f"{_NS}v")
        if value is None or value.text is None:
            return ""
        return shared[int(value.text)]
    inline = cell.find(f"{_NS}is/{_NS}t")
    if inline is not None and inline.text:
        return inline.text
    value = cell.find(f"{_NS}v")
    return value.text or "" if value is not None else ""


def _num(value: str) -> float | None:
    text = (value or "").strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _situs(row: dict[str, str]) -> str | None:
    full = row.get("situs", "").strip()
    if full:
        return full
    street = " ".join(part for part in (row.get("situs_num", ""), row.get("situs_street", "")) if part.strip()).strip()
    return street or None


def _mailing(row: dict[str, str]) -> str | None:
    city = " ".join(part for part in (row.get("city", ""), row.get("state", ""), row.get("zip", "")) if part.strip()).strip()
    parts = [part.strip() for part in (row.get("addr1", ""), row.get("addr2", ""), city) if part.strip()]
    return ", ".join(parts) or None


def read_roll(path: str | Path, tally: dict | None = None) -> Iterator[ParcelRecord]:
    """Yield one commercial real-property account. The first row for an id wins."""
    tally = tally if tally is not None else {}
    counts = {"not_real": 0, "missing_id": 0, "duplicate_ids": 0, "ambiguous": 0, "unmapped": 0, "out_of_scope": 0}
    rows_in = kept = orgs = 0
    seen: set[str] = set()
    with zipfile.ZipFile(path) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.iter(f"{_NS}t")) for si in root.findall(f"{_NS}si")]
        columns: dict[str, str] = {}
        with zf.open("xl/worksheets/sheet1.xml") as raw:
            first = True
            for _event, el in ET.iterparse(raw, events=("end",)):
                if el.tag != f"{_NS}row":
                    continue
                vals = {_letters(cell.get("r")): _cell(cell, shared).strip() for cell in el.findall(f"{_NS}c")}
                el.clear()
                if first:
                    first = False
                    by_name = {name: letter for letter, name in vals.items()}
                    missing = [header for header in _HEADERS.values() if header not in by_name]
                    if missing:
                        raise ValueError(f"workbook header missing {missing}")
                    columns = {key: by_name[header] for key, header in _HEADERS.items()}
                    continue
                rows_in += 1
                row = {key: vals.get(letter, "") for key, letter in columns.items()}
                if row["prop_type_cd"].strip().upper() != "R":
                    counts["not_real"] += 1
                    continue
                pid = row["prop_id"].strip().lstrip("0")
                if not pid:
                    counts["missing_id"] += 1
                    continue
                if pid in seen:
                    counts["duplicate_ids"] += 1
                    continue
                seen.add(pid)
                code = row["state_cd"].strip().upper()
                if code in AMBIGUOUS:
                    counts["ambiguous"] += 1
                    continue
                category = commercial_category(code)
                if code not in _CODES:
                    counts["unmapped"] += 1
                    continue
                if category is None:
                    counts["out_of_scope"] += 1
                    continue
                owner = row["owner"].strip()
                org = bool(owner) and is_organization(owner)
                if org:
                    orgs += 1
                land = _num(row["land_sf"])
                if not land or land <= 0:
                    acres = _num(row["acres"])
                    land = round(acres * _SQFT_PER_ACRE, 2) if acres and acres > 0 else None
                else:
                    land = round(land, 2)
                area = _num(row["area"])
                year = _num(row["year"])
                tax_year = _num(row["tax_year"])
                kept += 1
                yield ParcelRecord(
                    county_fips="003",
                    apn=pid,
                    state_category=category,
                    account=pid,
                    situs_address=_situs(row),
                    owner_name=owner if org else None,
                    owner_mailing_address=_mailing(row) if org else None,
                    land_area_sf=land,
                    improvement_area_sf=round(area, 2) if area and area > 0 else None,
                    year_built=int(year) if year and 1800 <= year <= 2100 else None,
                    market_value=_num(row["market"]),
                    appraised_value=_num(row["appraised"]),
                    tax_year=int(tax_year) if tax_year else None,
                    locator=f"2026 real workbook prop_id {pid}",
                    local_use_code=code,
                )
    counts["kept"] = kept
    tally.update(input_records=rows_in, org_owner_facts=orgs, **counts)


def build(snapshot_path: str | Path, xlsx_path: str | Path, db_path: str | Path, *, as_of: str,
          retrieved_at: str) -> tuple[IngestStats, dict]:
    tally: dict = {}
    source = Source(
        source_id="tx-andrews-cad",
        publisher="Andrews County Appraisal District",
        title="2026 certified real appraisal roll workbook",
        url="https://andrewscad.org/tax-information/",
        state_fips="48",
        county_fips="003",
        license="No license stated on the tax-information page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Andrews County Appraisal District",
        terms_reviewed="2026-11-06",
    )
    reg = Registry(db_path)
    try:
        stats = reg.ingest_roll(
            source, snapshot_path, read_roll(xlsx_path, tally), as_of=as_of, retrieved_at=retrieved_at,
            state_fips="48", account_system="andrews_prop_id", full_roll=True,
        )
    finally:
        reg.close()
    return stats, tally
