"""Bastrop Central Appraisal District vendor tab export → ``ParcelRecord``.

The October 2026 workbook ``PUBLIC-EXTRACT-PROCESS-AND-FILE-LAYOUT.xlsx`` is the layout.
The 8.0.30 fixed-width export is not this file. Category is ``PARCEL USE CD`` on
``externalnal.tab``. Sale, exemption, and extra-feature files are not opened. Owner
names that are not organisations are not stored.
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections.abc import Iterator
from pathlib import Path

from ..normalize import is_commercial, is_organization
from ..store import IngestStats, ParcelRecord, Registry, Source

_NAL = "externalnal.tab"
_OWNER = "externalowner.tab"


def _open(path: Path, name: str):
    csv.field_size_limit(1 << 30)
    if path.is_dir():
        return open(path / name, encoding="latin-1", newline="")
    zf = zipfile.ZipFile(path)
    return io.TextIOWrapper(zf.open(name), encoding="latin-1", newline="")


def _num(value: str | None) -> float | None:
    text = (value or "").strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _positive(value: str | None) -> float | None:
    number = _num(value)
    return number if number and number > 0 else None


def _situs(row: dict[str, str]) -> str | None:
    street = " ".join(
        part
        for part in (
            (row.get("SITUS STREET NUM") or "").strip(),
            (row.get("SITUS STREET NAME") or "").strip(),
            (row.get("SITUS STREET SFX") or "").strip(),
            (row.get("SITUS UNIT") or "").strip(),
        )
        if part
    )
    city = (row.get("SITUS CITY") or "").strip()
    tail = ", ".join(part for part in (city, "TX") if part)
    if not street:
        return None
    return f"{street}, {tail}" if tail else street


def read_roll(path: str | Path, tally: dict | None = None, *, county_fips: str = "021",
              id_field: str = "PARCEL ID") -> Iterator[ParcelRecord]:
    """Yield one commercial real-property row per parcel id. The first row wins."""
    tally = tally if tally is not None else {}
    p = Path(path)
    kept: dict[str, dict[str, str]] = {}
    codes: dict[str, int] = {}
    rows = dups = out = 0
    with _open(p, _NAL) as raw:
        for row in csv.DictReader(raw, delimiter="\t"):
            rows += 1
            pid = (row.get(id_field) or "").strip()
            code = (row.get("PARCEL USE CD") or "").strip().upper()
            if not pid or not is_commercial(code):
                out += 1
                continue
            if pid in kept:
                dups += 1
                continue
            kept[pid] = row
            codes[code] = codes.get(code, 0) + 1
    owners: dict[str, str] = {}
    with _open(p, _OWNER) as raw:
        ranked: dict[str, tuple[int, str]] = {}
        for row in csv.DictReader(raw, delimiter="\t"):
            pid = (row.get("parcel_id") or "").strip()
            if pid not in kept:
                continue
            name = (row.get("own_name") or "").strip()
            if not name or not is_organization(name):
                continue
            try:
                order = int((row.get("own_num") or "0").strip() or "0")
            except ValueError:
                order = 0
            current = ranked.get(pid)
            if current is None or order < current[0]:
                ranked[pid] = (order, name)
        owners = {pid: name for pid, (_, name) in ranked.items()}
    tally.update(input_records=rows, kept=len(kept), duplicate_ids=dups, out_of_scope=out, local_codes=codes)
    for pid, row in kept.items():
        code = (row.get("PARCEL USE CD") or "").strip().upper()
        heat = _positive(row.get("BLDG HEAT AREA"))
        year = _positive(row.get("YEAR_BUILT"))
        yield ParcelRecord(
            county_fips=county_fips,
            apn=pid,
            state_category="B" if code.startswith("B") else code,
            account=pid,
            situs_address=_situs(row),
            owner_name=owners.get(pid),
            land_area_sf=_positive(row.get("LAND SQFT")),
            improvement_area_sf=heat,
            year_built=int(year) if year else None,
            market_value=_num(row.get("MKT VAL")),
            appraised_value=_num(row.get("APPRAISED VAL")),
            tax_year=2026,
            locator=f"externalnal PARCEL ID {pid}",
            local_use_code=code,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str) -> tuple[IngestStats, dict]:
    tally: dict = {}
    source = Source(
        source_id="tx-bastrop-cad",
        publisher="Bastrop Central Appraisal District",
        title="2026 real-property public extract as of 2026-10-01 (vendor tab)",
        url="https://bastropcad.org/exports-valuation-reports/",
        state_fips="48",
        county_fips="021",
        license="Disclaimer accepted 2026-11-06 by the site's visible accept link: no responsibility for downloading, no technical support, as-is, no warranty, no liability for errors. No fee, use, resale, or indemnity clause. Public redistribution is not granted",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Bastrop Central Appraisal District",
        terms_reviewed="2026-11-06",
    )
    reg = Registry(db_path)
    try:
        stats = reg.ingest_roll(
            source, snapshot_path, read_roll(snapshot_path, tally), as_of=as_of, retrieved_at=retrieved_at,
            state_fips="48", account_system="bastrop_parcel_id", full_roll=True,
        )
    finally:
        reg.close()
    return stats, tally
