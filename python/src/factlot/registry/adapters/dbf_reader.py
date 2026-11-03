"""Minimal stdlib reader for dBASE III/IV ``.dbf`` attribute tables, including a ``.dbf`` inside a zip archive.

Shapefile attribute tables are plain dBASE files: a 32-byte header, 32-byte field descriptors ending in ``0x0D``, then
fixed-width records (a leading byte ``0x20`` for live rows and ``*`` for deleted ones). Only character, numeric,
float, date and logical fields are decoded; everything else is returned as the raw text. No geometry is read.
"""

from __future__ import annotations

import struct
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import IO


def _fields(f: IO[bytes]) -> tuple[int, int, list[tuple[str, str, int, int]]]:
    head = f.read(32)
    if len(head) < 32:
        raise ValueError("not a dBASE file: header too short")
    nrec, hlen, rlen = struct.unpack("<IHH", head[4:12])
    fields: list[tuple[str, str, int, int]] = []
    while True:
        d = f.read(32)
        if not d or d[0] == 0x0D:
            break
        name = d[:11].split(b"\0", 1)[0].decode("ascii", "replace")
        fields.append((name, chr(d[11]), d[16], d[17]))
    return nrec, rlen, fields


def _decode(kind: str, raw: bytes, encoding: str) -> object:
    text = raw.decode(encoding, "replace").strip()
    if kind in "NF":
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    if kind == "L":
        return {"T": True, "Y": True, "F": False, "N": False}.get(text.upper())
    return text


def read_dbf(stream: IO[bytes], *, encoding: str = "cp1252") -> Iterator[dict[str, object]]:
    """Yield one dict per live record of an open ``.dbf`` stream (field names as stored, case kept)."""
    nrec, rlen, fields = _fields(stream)
    for _ in range(nrec):
        rec = stream.read(rlen)
        if len(rec) < rlen:
            break
        if rec[:1] == b"*":
            continue
        pos = 1
        row: dict[str, object] = {}
        for name, kind, width, _dec in fields:
            row[name] = _decode(kind, rec[pos:pos + width], encoding)
            pos += width
        yield row


def open_dbf(path: str | Path, *, member: str | None = None, encoding: str = "cp1252") -> Iterator[dict[str, object]]:
    """Yield the records of a ``.dbf`` file, or of the ``.dbf`` inside a zip (``member`` or the only ``*.dbf``)."""
    p = Path(path)
    if zipfile.is_zipfile(p):
        with zipfile.ZipFile(p) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".dbf")]
            if member is None:
                if len(names) != 1:
                    raise ValueError(f"{p.name}: expected one .dbf member, found {names}")
                member = names[0]
            with z.open(member) as f:
                yield from read_dbf(f, encoding=encoding)
    else:
        with open(p, "rb") as f:
            yield from read_dbf(f, encoding=encoding)
