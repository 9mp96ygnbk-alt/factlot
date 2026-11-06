"""Midland certified web property file → ``ParcelRecord``.

Only ``export_webprop.txt`` is opened. Category comes from ``webprop_ptdimp`` and
``webprop_ptdlnd``. Mineral, personal, and production code columns are not used for
scope, so a mineral row is not kept merely because a mineral code says F2. The
collectors file, which carries birth dates, is not opened. Owner names that are
not organisations are not stored.
"""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

from ..normalize import is_commercial, is_organization
from ..store import ParcelRecord

_MEMBER = "export_webprop.txt"
_PRIORITY = ("F2", "F1", "B")


def _mapped(code: str) -> str | None:
    c = (code or "").strip().upper()
    if not c or not is_commercial(c):
        return None
    if c.startswith("B"):
        return "B"
    if c.startswith("F1"):
        return "F1"
    if c.startswith("F2"):
        return "F2"
    return None


def _category(imp: str, land: str) -> tuple[str | None, str | None]:
    found = []
    for raw in (imp, land):
        mapped = _mapped(raw)
        if mapped:
            found.append((mapped, raw.strip().upper()))
    for wanted in _PRIORITY:
        for mapped, raw in found:
            if mapped == wanted:
                return mapped, raw
    return None, None


def read_webprop(path: str | Path):
    """Yield in-scope rows. Birth-date columns are refused if present."""
    p = Path(path)
    zf = zipfile.ZipFile(p) if not p.is_dir() else None
    try:
        if zf is not None:
            raw = zf.open(_MEMBER)
        else:
            raw = open(next(p.rglob(_MEMBER)), "rb")
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""))
        fields = [name or "" for name in (reader.fieldnames or [])]
        if any("birth" in name.lower() for name in fields):
            raise ValueError("refusing a file that contains a birth-date column")
        seen: set[str] = set()
        for row in reader:
            pid = (row.get("webprop_id") or "").strip()
            if not pid or pid in seen:
                continue
            category, local = _category(row.get("webprop_ptdimp") or "", row.get("webprop_ptdlnd") or "")
            if category is None:
                continue
            seen.add(pid)
            confidential = (row.get("webprop_confidential") or "").strip().upper() in {"Y", "T", "1"}
            name = None if confidential else (row.get("webprop_name") or "").strip() or None
            if name and not is_organization(name):
                name = None
            situs = None if confidential else (row.get("webprop_situs") or "").strip() or None
            yield ParcelRecord(
                county_fips="329",
                apn=pid,
                state_category=category,
                account=pid,
                situs_address=situs,
                owner_name=name,
                owner_confidential=confidential,
                local_use_code=local,
                locator=f"export_webprop webprop_id {pid}",
            )
    finally:
        if zf is not None:
            zf.close()
