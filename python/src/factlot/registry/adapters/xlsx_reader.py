"""A small standard-library reader for the first worksheet of an ``.xlsx`` file.

The registry's runtime uses the Python standard library only, and a few publishers (NYC Department of
Finance's sales files) post Excel workbooks. This reads cell values from ``xl/worksheets/sheet1.xml`` (the
first sheet listed in the workbook) with shared strings, inline strings and numbers, streaming the rows;
it does not evaluate formulas, read styles or handle dates specially (a date cell comes back as its Excel
serial number, a string as text). ``excel_date`` converts a serial number.
"""

from __future__ import annotations

import re
import zipfile
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_COL = re.compile(r"([A-Z]+)")


def _col_index(ref: str) -> int:
    m = _COL.match(ref)
    n = 0
    for ch in m.group(1) if m else "":
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _first_sheet_path(zf: zipfile.ZipFile) -> str:
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        first = wb.find(f"{_NS}sheets/{_NS}sheet")
        rid = first.get(f"{_REL}id") if first is not None else None
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target") or ""
                return target.lstrip("/") if target.startswith("/") else "xl/" + target
    except (KeyError, ET.ParseError):
        pass
    return "xl/worksheets/sheet1.xml"


def _shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        raw = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    out: list[str] = []
    for si in ET.fromstring(raw).iter(f"{_NS}si"):
        out.append("".join(t.text or "" for t in si.iter(f"{_NS}t")))
    return out


def rows(path: str | Path) -> Iterator[list[str | float | None]]:
    """Rows of the first worksheet as lists of cell values (text or number; ``None`` for an empty cell),
    padded on the left to column A. Blank rows are yielded as empty lists."""
    with zipfile.ZipFile(path) as zf:
        strings = _shared_strings(zf)
        with zf.open(_first_sheet_path(zf)) as sheet:
            for _event, el in ET.iterparse(sheet, events=("end",)):
                if el.tag != f"{_NS}row":
                    continue
                row: list[str | float | None] = []
                for c in el.findall(f"{_NS}c"):
                    idx = _col_index(c.get("r") or "")
                    while len(row) < idx:
                        row.append(None)
                    kind = c.get("t")
                    v = c.find(f"{_NS}v")
                    value: str | float | None = None
                    if kind == "s" and v is not None and v.text is not None:
                        value = strings[int(v.text)]
                    elif kind == "inlineStr":
                        value = "".join(t.text or "" for t in c.iter(f"{_NS}t"))
                    elif kind in ("str", "e", "b"):
                        value = v.text if v is not None else None
                    elif v is not None and v.text not in (None, ""):
                        try:
                            value = float(v.text)
                        except ValueError:
                            value = v.text
                    row.append(value)
                yield row
                el.clear()


def excel_date(serial: float | str | None) -> date | None:
    """An Excel serial day number (1900 date system) as a date; ``None`` when it is not a number."""
    if isinstance(serial, str):
        try:
            serial = float(serial)
        except ValueError:
            return None
    if serial is None or serial < 1:
        return None
    return date(1899, 12, 30) + timedelta(days=int(serial))
