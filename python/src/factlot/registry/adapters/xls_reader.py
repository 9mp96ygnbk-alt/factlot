"""A small standard-library reader for the first worksheet of a legacy ``.xls`` file (Excel 97-2003, BIFF8).

The Department of Finance posts its annualized sales for 2007-2017 as ``.xls`` workbooks. Like ``xlsx_reader`` this
yields the cell values of the first worksheet row by row, with text from the shared string table and numbers as
floats; it does not evaluate formulas (a formula cell comes back as its cached number or text), read styles, or
handle dates specially (a date cell is its Excel serial number; ``xlsx_reader.excel_date`` converts it).

Two layers: the OLE2 compound file that holds the ``Workbook`` stream (sectors, the FAT, the mini stream for
small files), and the BIFF8 records in it (``SST``, ``LABELSST``, ``LABEL``, ``NUMBER``, ``RK``, ``MULRK``,
``FORMULA`` with its ``STRING``, ``BOUNDSHEET``, and ``CONTINUE`` records that split a long record or string).
Files of other kinds (a password-protected workbook, an older BIFF version) raise ``ValueError``.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from pathlib import Path

_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_FREE, _END = 0xFFFFFFFF, 0xFFFFFFFE


# --- OLE2 compound file ---------------------------------------------------------------------------------


def _chain(fat: list[int], start: int) -> Iterator[int]:
    seen = set()
    s = start
    while s < _END and s not in seen:
        seen.add(s)
        yield s
        s = fat[s] if s < len(fat) else _END


def workbook_stream(data: bytes) -> bytes:
    """The ``Workbook`` (or ``Book``) stream of an OLE2 compound file."""
    if data[:8] != _MAGIC:
        raise ValueError("not an OLE2 compound file")
    shift, mini_shift = struct.unpack_from("<HH", data, 30)
    sector, mini = 1 << shift, 1 << mini_shift
    n_fat, dir_start, _tx, cutoff, minifat_start, n_minifat, difat_start, n_difat = struct.unpack_from("<IIIIIIII", data, 44)

    def sector_bytes(n: int) -> bytes:
        off = (n + 1) * sector
        return data[off:off + sector]

    difat = list(struct.unpack_from("<109I", data, 76))
    d = difat_start
    for _ in range(n_difat):
        raw = sector_bytes(d)
        vals = struct.unpack(f"<{sector // 4}I", raw)
        difat.extend(vals[:-1])
        d = vals[-1]
    fat: list[int] = []
    for s in difat[:n_fat] if n_fat <= len(difat) else difat:
        if s >= _END:
            continue
        fat.extend(struct.unpack(f"<{sector // 4}I", sector_bytes(s)))

    def read_chain(start: int) -> bytes:
        return b"".join(sector_bytes(s) for s in _chain(fat, start))

    directory = read_chain(dir_start)
    entries = []
    for i in range(0, len(directory) - 127, 128):
        name_len = struct.unpack_from("<H", directory, i + 64)[0]
        name = directory[i:i + max(0, name_len - 2)].decode("utf-16-le", "replace")
        kind = directory[i + 66]
        start, size = struct.unpack_from("<IQ", directory, i + 116)
        entries.append((name, kind, start, size & 0xFFFFFFFF if sector == 512 else size))
    root = next((e for e in entries if e[1] == 5), None)
    target = next((e for e in entries if e[1] == 2 and e[0] in ("Workbook", "Book")), None)
    if root is None or target is None:
        raise ValueError("no Workbook stream (not an Excel 97-2003 file)")
    name, _kind, start, size = target
    if size >= cutoff:
        return read_chain(start)[:size]
    mini_stream = read_chain(root[2])
    minifat = list(struct.unpack(f"<{len(read_chain(minifat_start)) // 4}I", read_chain(minifat_start))) if n_minifat else []
    out = bytearray()
    for s in _chain(minifat, start):
        out += mini_stream[s * mini:(s + 1) * mini]
    return bytes(out[:size])


# --- BIFF8 ------------------------------------------------------------------------------------------------

_SST, _CONTINUE, _EOF, _BOF, _BOUNDSHEET = 0x00FC, 0x003C, 0x000A, 0x0809, 0x0085
_LABELSST, _LABEL, _NUMBER, _RK, _MULRK, _FORMULA, _STRING = 0x00FD, 0x0204, 0x0203, 0x027E, 0x00BD, 0x0006, 0x0207
_FILEPASS = 0x002F


def _records(stream: bytes) -> Iterator[tuple[int, int, bytes]]:
    """``(offset, id, data)`` for each record; a record's CONTINUE records are not merged here."""
    pos = 0
    n = len(stream)
    while pos + 4 <= n:
        rid, ln = struct.unpack_from("<HH", stream, pos)
        yield pos, rid, stream[pos + 4:pos + 4 + ln]
        pos += 4 + ln


def _rk(v: int) -> float:
    if v & 2:
        n = v >> 2
        if n & 0x20000000:
            n -= 0x40000000
        val = float(n)
    else:
        val = struct.unpack("<d", struct.pack("<Q", (v & 0xFFFFFFFC) << 32))[0]
    return val / 100 if v & 1 else val


class _Segments:
    """A record's data split at CONTINUE boundaries, read forward. A string that runs across a boundary restarts with
    one flag byte (its characters' width) at the start of the next segment."""

    def __init__(self, parts: list[bytes]) -> None:
        self.parts = parts
        self.i = 0
        self.pos = 0

    def left(self) -> int:
        return len(self.parts[self.i]) - self.pos

    def take(self, n: int) -> bytes:
        out = b""
        while n > 0:
            if self.left() == 0:
                if self.i + 1 >= len(self.parts):
                    raise ValueError("truncated shared string table")
                self.i += 1
                self.pos = 0
            k = min(n, self.left())
            out += self.parts[self.i][self.pos:self.pos + k]
            self.pos += k
            n -= k
        return out

    def u8(self) -> int:
        return self.take(1)[0]

    def u16(self) -> int:
        return struct.unpack("<H", self.take(2))[0]

    def u32(self) -> int:
        return struct.unpack("<I", self.take(4))[0]

    def chars(self, count: int, wide: bool) -> str:
        """``count`` characters, re-reading the width flag after a segment boundary."""
        out: list[str] = []
        while count > 0:
            if self.left() == 0:
                if self.i + 1 >= len(self.parts):
                    raise ValueError("truncated shared string table")
                self.i += 1
                self.pos = 0
                wide = bool(self.u8() & 1)
            width = 2 if wide else 1
            k = min(count, self.left() // width)
            if k == 0:  # a wide character split across the boundary does not occur in practice
                raise ValueError("character split across a CONTINUE boundary")
            raw = self.take(k * width)
            out.append(raw.decode("utf-16-le" if wide else "latin-1"))
            count -= k
        return "".join(out)


def _shared_strings(parts: list[bytes]) -> list[str]:
    seg = _Segments(parts)
    seg.take(4)  # total references
    unique = seg.u32()
    out: list[str] = []
    for _ in range(unique):
        try:
            cch = seg.u16()
            flags = seg.u8()
            runs = seg.u16() if flags & 8 else 0
            ext = seg.u32() if flags & 4 else 0
            out.append(seg.chars(cch, bool(flags & 1)))
            if runs:
                seg.take(4 * runs)
            if ext:
                seg.take(ext)
        except ValueError:
            break
    return out


def _label_text(data: bytes, offset: int) -> str:
    cch = struct.unpack_from("<H", data, offset)[0]
    flags = data[offset + 2]
    body = data[offset + 3:]
    return body[:cch * 2].decode("utf-16-le", "replace") if flags & 1 else body[:cch].decode("latin-1")


def rows(path: str | Path) -> Iterator[list[str | float | None]]:
    """Rows of the first worksheet as lists of cell values (text or number; ``None`` for an empty cell), padded on
    the left to column A. Blank rows are yielded as empty lists, as ``xlsx_reader.rows`` does."""
    stream = workbook_stream(Path(path).read_bytes())
    sst_parts: list[bytes] = []
    first_sheet: int | None = None
    in_sst = False
    for _off, rid, data in _records(stream):
        if rid == _FILEPASS:
            raise ValueError("encrypted workbook")
        if rid == _SST:
            sst_parts, in_sst = [data], True
        elif rid == _CONTINUE and in_sst:
            sst_parts.append(data)
        else:
            in_sst = False
            if rid == _BOUNDSHEET and first_sheet is None:
                first_sheet = struct.unpack_from("<I", data, 0)[0]
            if rid == _EOF and first_sheet is not None:
                break
    if first_sheet is None:
        raise ValueError("no worksheet")
    strings = _shared_strings(sst_parts) if sst_parts else []
    cells: dict[int, dict[int, str | float]] = {}
    last_formula: tuple[int, int] | None = None
    depth = 0
    for _off, rid, data in _records(stream[first_sheet:]):
        if rid == _BOF:
            depth += 1
            continue
        if rid == _EOF:
            depth -= 1
            if depth <= 0:
                break
            continue
        if depth != 1:  # a chart or other sub-stream inside the sheet
            continue
        if rid == _LABELSST:
            r, c, _xf, i = struct.unpack_from("<HHHI", data, 0)
            if i < len(strings):
                cells.setdefault(r, {})[c] = strings[i]
        elif rid == _LABEL:
            r, c, _xf = struct.unpack_from("<HHH", data, 0)
            cells.setdefault(r, {})[c] = _label_text(data, 6)
        elif rid == _NUMBER:
            r, c, _xf, v = struct.unpack_from("<HHHd", data, 0)
            cells.setdefault(r, {})[c] = v
        elif rid == _RK:
            r, c, _xf, v = struct.unpack_from("<HHHI", data, 0)
            cells.setdefault(r, {})[c] = _rk(v)
        elif rid == _MULRK:
            r, c0 = struct.unpack_from("<HH", data, 0)
            n = (len(data) - 6) // 6
            for k in range(n):
                _xf, v = struct.unpack_from("<HI", data, 4 + 6 * k)
                cells.setdefault(r, {})[c0 + k] = _rk(v)
        elif rid == _FORMULA:
            r, c = struct.unpack_from("<HH", data, 0)
            result = data[6:14]
            if result[6:8] == b"\xff\xff":
                last_formula = (r, c)  # a string result: the STRING record that follows holds it
            else:
                cells.setdefault(r, {})[c] = struct.unpack("<d", result)[0]
                last_formula = None
        elif rid == _STRING and last_formula is not None:
            cells.setdefault(last_formula[0], {})[last_formula[1]] = _label_text(data, 0)
            last_formula = None
    if not cells:
        return
    for r in range(max(cells) + 1):
        row = cells.get(r)
        if not row:
            yield []
            continue
        out: list[str | float | None] = [None] * (max(row) + 1)
        for c, v in row.items():
            out[c] = v
        yield out
