"""Orange County Orion property export → ``ParcelRecord``.

The certified zip's vendor member includes ``Orion Appraisal Export Layout.xlsx``.
That layout names ``StateCodeImp`` and ``StateCodeLand`` as the PTD code.
Owner, sales, exemption, and agent files are not opened.
"""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

from .tx_ector import commercial_code
from ..store import ParcelRecord

_PROPERTY = "PropertyExport.txt"


def read_property(path: str | Path, tally: dict | None = None):
    """Yield commercial real rows. The first character of the quick-reference id is the property type."""
    tally = tally if tally is not None else {}
    p = Path(path)
    rows = kept = out = not_real = dups = 0
    seen: set[str] = set()
    with zipfile.ZipFile(p) as outer:
        vendor = next(n for n in outer.namelist() if n.endswith("Export Vendor.zip"))
        with zipfile.ZipFile(io.BytesIO(outer.read(vendor))) as inner:
            member = next(n for n in inner.namelist() if n.endswith(_PROPERTY))
            reader = csv.DictReader(io.TextIOWrapper(inner.open(member), encoding="latin-1", newline=""))
            for row in reader:
                rows += 1
                quick = (row.get("PropertyQuickRefID") or "").strip()
                if not quick.upper().startswith("R"):
                    not_real += 1
                    continue
                local = (row.get("StateCodeImp") or "").strip().upper() or (row.get("StateCodeLand") or "").strip().upper()
                category = commercial_code(local)
                if category is None:
                    out += 1
                    continue
                pid = (row.get("PropertyNumber") or "").strip() or quick
                if pid in seen:
                    dups += 1
                    continue
                seen.add(pid)
                kept += 1
                street = (row.get("SitusStreetAddress") or "").strip()
                city = (row.get("SitusCity") or "").strip()
                situs = ", ".join(part for part in (street, city, "TX") if part) or None
                year = (row.get("TaxYear") or "").strip()
                yield ParcelRecord(
                    county_fips="361",
                    apn=pid,
                    state_category=category,
                    account=quick,
                    situs_address=situs,
                    tax_year=int(year) if year.isdigit() else None,
                    locator=f"PropertyExport PropertyNumber {pid}",
                    local_use_code=local or None,
                )
    tally.update(input_records=rows, kept=kept, not_real=not_real, out_of_scope=out, duplicate_ids=dups)
