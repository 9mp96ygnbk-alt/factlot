"""Ector County real-property workbook → ``ParcelRecord``.

The certified real-property zip holds one worksheet, ``SearchResults``. Category is
``PROPERTY_CLASSIFICATION_CODE`` (Comptroller-style codes such as ``F1`` and ``B2``).
``F3`` and ``F5`` are not treated as commercial, because this file has no code table
that says what they are. Personal-property and mineral zips are not opened. Owner
names that are not organisations are not stored. Sale dates are not stored.
"""

from __future__ import annotations

import zipfile
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from xml.etree import ElementTree as ET

from ..normalize import is_commercial, is_organization
from ..store import IngestStats, ParcelRecord, Registry, Source

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_SQFT_PER_ACRE = 43560
# Header order in 2026_Certified_RE_Appraisal_Roll.xlsx. Empty cells are omitted, so rows are
# read by these column letters rather than by position in the cell list.
_COLS = {
    "acct": "B",
    "owner": "E",
    "cls": "M",
    "situs": "S",
    "street_num": "T",
    "street_dir": "U",
    "street_name": "V",
    "street_suffix": "W",
    "total": "AA",
    "area": "AE",
    "year": "AF",
    "acres": "AH",
}


def commercial_code(code: str) -> str | None:
    """Comptroller category for a classification this file states, or None."""
    c = (code or "").strip().upper()
    if c in {"F1", "F2"}:
        return c
    if len(c) >= 2 and c[0] == "B" and c[1:].isdigit() and is_commercial(c):
        return "B"
    return None


def _letters(ref: str | None) -> str:
    return "".join(ch for ch in (ref or "") if ch.isalpha())


def _text(cell: ET.Element) -> str:
    inline = cell.find(f"{_NS}is/{_NS}t")
    if inline is not None:
        return inline.text or ""
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
    street = " ".join(
        part for part in (row.get("street_num", ""), row.get("street_dir", ""), row.get("street_name", ""), row.get("street_suffix", "")) if part.strip()
    ).strip()
    return street or None


def read_roll(path: str | Path, tally: dict | None = None) -> Iterator[ParcelRecord]:
    """Yield one commercial account. Repeated worksheet rows for that account collapse."""
    tally = tally if tally is not None else {}
    p = Path(path)
    workbook = p
    if p.suffix.lower() == ".zip":
        with zipfile.ZipFile(p) as outer:
            names = [n for n in outer.namelist() if n.lower().endswith(".xlsx")]
            if len(names) != 1:
                raise ValueError(f"expected one workbook in {p}")
            # The workbook is read from a temporary extraction by the caller when huge.
            raise ValueError("pass the xlsx path, not the zip")
    rows_in = commercial_rows = 0
    accounts: dict[str, dict] = {}
    with zipfile.ZipFile(workbook) as zf, zf.open("xl/worksheets/sheet1.xml") as raw:
        first = True
        for _event, el in ET.iterparse(raw, events=("end",)):
            if el.tag != f"{_NS}row":
                continue
            if first:
                first = False
                el.clear()
                continue
            rows_in += 1
            vals = {}
            for cell in el.findall(f"{_NS}c"):
                col = _letters(cell.get("r"))
                key = next((name for name, letter in _COLS.items() if letter == col), None)
                if key:
                    vals[key] = _text(cell).strip()
            el.clear()
            acct = vals.get("acct", "").strip()
            category = commercial_code(vals.get("cls", ""))
            if not acct or category is None:
                continue
            commercial_rows += 1
            slot = accounts.get(acct)
            if slot is None:
                accounts[acct] = {"row": vals, "category": category, "areas": [], "years": []}
                slot = accounts[acct]
            if (area := _num(vals.get("area", ""))) and area > 0:
                slot["areas"].append(area)
            if (year := _num(vals.get("year", ""))) and 1800 <= year <= 2026:
                slot["years"].append(int(year))
    tally.update(input_records=rows_in, commercial_rows=commercial_rows, kept=len(accounts),
                 out_of_scope=rows_in - commercial_rows, duplicate_ids=commercial_rows - len(accounts))
    for acct, slot in accounts.items():
        row = slot["row"]
        owner = row.get("owner", "").strip()
        if owner and not is_organization(owner):
            owner = ""
        acres = _num(row.get("acres", ""))
        land = round(acres * _SQFT_PER_ACRE, 2) if acres and acres > 0 else None
        yield ParcelRecord(
            county_fips="135",
            apn=acct,
            state_category=slot["category"],
            account=acct,
            situs_address=_situs(row),
            owner_name=owner or None,
            land_area_sf=land,
            improvement_area_sf=round(sum(slot["areas"]), 2) if slot["areas"] else None,
            year_built=min(slot["years"]) if slot["years"] else None,
            market_value=_num(row.get("total", "")),
            tax_year=2026,
            locator=f"SearchResults ACCOUNT_NUMBER {acct}",
            local_use_code=row.get("cls", "").strip().upper() or None,
        )


def build(snapshot_path: str | Path, xlsx_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str) -> tuple[IngestStats, dict]:
    tally: dict = {}
    source = Source(
        source_id="tx-ector-cad",
        publisher="Ector County Appraisal District",
        title="2026 certified real-property workbook",
        url="https://www.ectorcad.org/home/downloads",
        state_fips="48",
        county_fips="135",
        license="No license stated on the downloads page (read 2026-11-06). The site footer says all rights reserved. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Ector County Appraisal District",
        terms_reviewed="2026-11-06",
    )
    reg = Registry(db_path)
    try:
        stats = reg.ingest_roll(
            source, snapshot_path, read_roll(xlsx_path, tally), as_of=as_of, retrieved_at=retrieved_at,
            state_fips="48", account_system="ector_account_number", full_roll=True,
        )
    finally:
        reg.close()
    return stats, tally
