"""A small .xlsx writer and formula evaluator, Python standard library only.

The reconciliation workbooks need live Excel formulas (not pasted values). This module writes the
OOXML directly and also evaluates the supported formulas in Python, so the generator can

* store each formula's cached result in the file (viewers that do not recalculate still show
  numbers; Excel recalculates everything on open), and
* prove, before a workbook is written, that every "Difference" cell is 0.

Supported formula syntax: numbers, "strings", TRUE/FALSE, A1 / $A$1 / Sheet!A1 / ranges,
+ - * / ^ & = <> < > <= >=, unary minus, and the functions listed in FUNCTIONS. Anything else
raises, so a workbook can never contain a formula this module did not evaluate.
"""

from __future__ import annotations

import math
import re
import sys
import zipfile
from decimal import ROUND_HALF_UP, Decimal
from xml.sax.saxutils import escape

# ---------------------------------------------------------------- addresses


def col_letter(n: int) -> str:
    """1 -> A, 27 -> AA."""
    s = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def col_number(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def addr(row: int, col: int, absolute: bool = False) -> str:
    return f"${col_letter(col)}${row}" if absolute else f"{col_letter(col)}{row}"


def split_addr(a: str) -> tuple[int, int]:
    m = re.fullmatch(r"\$?([A-Z]{1,3})\$?(\d+)", a)
    if not m:
        raise ValueError(f"bad address {a!r}")
    return int(m.group(2)), col_number(m.group(1))


def excel_serial(iso: str) -> int:
    """Excel's 1900 date system: 2027-01-01 -> 46388."""
    y, m, d = (int(x) for x in iso.split("-"))
    # days since 1899-12-30 (this absorbs Excel's phantom 1900-02-29 for dates after March 1900)
    from datetime import date

    return (date(y, m, d) - date(1899, 12, 30)).days


# ---------------------------------------------------------------- styles

# name: (font, fill, numFmt, wrap)
FONTS = ["normal", "bold", "blue", "white_bold", "red_bold", "grey_italic", "title"]
FILLS = ["none", "gray125", "header", "input", "good", "warn"]
NUMFMTS = {
    "general": 0,
    "money": 164,  # #,##0.00
    "num4": 165,  # 0.0000
    "pct": 166,  # 0.0000%
    "int": 167,  # #,##0
    "date": 168,  # yyyy-mm-dd
    "num6": 169,  # 0.000000
    "num8": 170,  # 0.00000000
}
NUMFMT_CODES = {
    164: "#,##0.00",
    165: "0.0000",
    166: "0.0000%",
    167: "#,##0",
    168: "yyyy\\-mm\\-dd",
    169: "0.000000",
    170: "0.00000000",
}
STYLES: dict[str, tuple[str, str, str, bool]] = {
    "default": ("normal", "none", "general", False),
    "text": ("normal", "none", "general", True),
    "bold": ("bold", "none", "general", False),
    "title": ("title", "none", "general", False),
    "header": ("white_bold", "header", "general", True),
    "note": ("grey_italic", "none", "general", True),
    "warn": ("red_bold", "warn", "general", True),
    "money": ("normal", "none", "money", False),
    "num4": ("normal", "none", "num4", False),
    "num6": ("normal", "none", "num6", False),
    "num8": ("normal", "none", "num8", False),
    "pct": ("normal", "none", "pct", False),
    "int": ("normal", "none", "int", False),
    "date": ("normal", "none", "date", False),
    "in_text": ("blue", "input", "general", False),
    "in_money": ("blue", "input", "money", False),
    "in_num4": ("blue", "input", "num4", False),
    "in_pct": ("blue", "input", "pct", False),
    "in_int": ("blue", "input", "int", False),
    "in_date": ("blue", "input", "date", False),
    "fl_money": ("bold", "good", "money", False),
    "fl_num4": ("bold", "good", "num4", False),
    "fl_num6": ("bold", "good", "num6", False),
    "fl_num8": ("bold", "good", "num8", False),
    "fl_pct": ("bold", "good", "pct", False),
    "fl_int": ("bold", "good", "int", False),
    "fl_text": ("bold", "good", "general", False),
    "diff": ("bold", "none", "money", False),
}
STYLE_NAMES = list(STYLES)


def styles_xml() -> str:
    fonts = {
        "normal": '<font><sz val="11"/><name val="Calibri"/></font>',
        "bold": '<font><b/><sz val="11"/><name val="Calibri"/></font>',
        "blue": '<font><sz val="11"/><color rgb="FF0000FF"/><name val="Calibri"/></font>',
        "white_bold": '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
        "red_bold": '<font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>',
        "grey_italic": '<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font>',
        "title": '<font><b/><sz val="14"/><name val="Calibri"/></font>',
    }
    fills = {
        "none": '<fill><patternFill patternType="none"/></fill>',
        "gray125": '<fill><patternFill patternType="gray125"/></fill>',
        "header": '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill>',
        "input": '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>',
        "good": '<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/></patternFill></fill>',
        "warn": '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/></patternFill></fill>',
    }
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n']
    out.append('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    out.append(f'<numFmts count="{len(NUMFMT_CODES)}">')
    for fid, code in NUMFMT_CODES.items():
        out.append(f'<numFmt numFmtId="{fid}" formatCode="{escape(code, {chr(34): "&quot;"})}"/>')
    out.append("</numFmts>")
    out.append(f'<fonts count="{len(FONTS)}">' + "".join(fonts[f] for f in FONTS) + "</fonts>")
    out.append(f'<fills count="{len(FILLS)}">' + "".join(fills[f] for f in FILLS) + "</fills>")
    out.append('<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>')
    out.append('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>')
    out.append(f'<cellXfs count="{len(STYLE_NAMES)}">')
    for name in STYLE_NAMES:
        font, fill, fmt, wrap = STYLES[name]
        align = '<alignment vertical="top" wrapText="1"/>' if wrap else ""
        out.append(
            f'<xf numFmtId="{NUMFMTS[fmt]}" fontId="{FONTS.index(font)}" fillId="{FILLS.index(fill)}" '
            f'borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"'
            f'{" applyAlignment=\"1\"" if wrap else ""}>{align}</xf>'
        )
    out.append("</cellXfs>")
    out.append('<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>')
    out.append("</styleSheet>")
    return "".join(out)


# ---------------------------------------------------------------- model


class Cell:
    __slots__ = ("value", "formula", "style", "cached")

    def __init__(self, value=None, formula: str | None = None, style: str = "default"):
        self.value = value
        self.formula = formula
        self.style = style
        self.cached = None


class Sheet:
    def __init__(self, name: str):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
            raise ValueError("sheet names are letters, digits and underscores (no quoting needed)")
        self.name = name
        self.cells: dict[tuple[int, int], Cell] = {}
        self.widths: dict[int, float] = {}
        self.freeze: str | None = None

    def put(self, row: int, col: int, content=None, style: str = "default") -> str:
        """Write a value, or a formula when `content` is a string starting with '='."""
        if style not in STYLES:
            raise KeyError(style)
        if isinstance(content, str) and content.startswith("="):
            self.cells[(row, col)] = Cell(formula=content[1:], style=style)
        else:
            self.cells[(row, col)] = Cell(value=content, style=style)
        return f"{self.name}!{addr(row, col, True)}"

    def width(self, col: int, w: float) -> None:
        self.widths[col] = w


class Workbook:
    def __init__(self, title: str):
        self.title = title
        self.sheets: list[Sheet] = []

    def sheet(self, name: str) -> Sheet:
        s = Sheet(name)
        self.sheets.append(s)
        return s

    def get(self, name: str) -> Sheet:
        for s in self.sheets:
            if s.name == name:
                return s
        raise KeyError(name)

    # ---- evaluation
    def evaluate(self) -> None:
        sys.setrecursionlimit(max(sys.getrecursionlimit(), 20000))
        ev = Evaluator(self)
        # Reconcile last, each sheet top to bottom: chains of dependent rows then evaluate one link at a time.
        for s in sorted(self.sheets, key=lambda x: x.name == "Reconcile"):
            for (r, c) in sorted(s.cells):
                cell = s.cells[(r, c)]
                if cell.formula is not None:
                    cell.cached = ev.cell_value(s.name, r, c)

    def value_at(self, ref: str):
        sheet, a = ref.replace("$", "").split("!")
        r, c = split_addr(a)
        cell = self.get(sheet).cells.get((r, c))
        if cell is None:
            return None
        return cell.cached if cell.formula is not None else cell.value

    # ---- writing
    def save(self, path: str) -> None:
        self.evaluate()
        parts = self.parts()
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in parts:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                z.writestr(info, data)

    def parts(self) -> list[tuple[str, str]]:
        n = len(self.sheets)
        ct = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        ]
        for i in range(1, n + 1):
            ct.append(
                f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            )
        ct.append("</Types>")
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            "</Relationships>"
        )
        core = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{escape(self.title)}</dc:title><dc:creator>FactLot reconciliation generator</dc:creator>"
            '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>'
            "</cp:coreProperties>"
        )
        wb = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            "<sheets>",
        ]
        wbrels = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        ]
        for i, s in enumerate(self.sheets, 1):
            wb.append(f'<sheet name="{s.name}" sheetId="{i}" r:id="rId{i}"/>')
            wbrels.append(
                f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                f'Target="worksheets/sheet{i}.xml"/>'
            )
        wbrels.append(
            f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
            'Target="styles.xml"/></Relationships>'
        )
        wb.append('</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')
        out = [
            ("[Content_Types].xml", "".join(ct)),
            ("_rels/.rels", rels),
            ("docProps/core.xml", core),
            ("xl/workbook.xml", "".join(wb)),
            ("xl/_rels/workbook.xml.rels", "".join(wbrels)),
            ("xl/styles.xml", styles_xml()),
        ]
        for i, s in enumerate(self.sheets, 1):
            out.append((f"xl/worksheets/sheet{i}.xml", sheet_xml(s)))
        return out


def fmt_num(x: float) -> str:
    if isinstance(x, bool):
        return "1" if x else "0"
    if isinstance(x, int):
        return str(x)
    return repr(float(x))


def sheet_xml(s: Sheet) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n']
    out.append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    if s.freeze:
        r, c = split_addr(s.freeze)
        pane = f'<pane{f" xSplit=\"{c - 1}\"" if c > 1 else ""}{f" ySplit=\"{r - 1}\"" if r > 1 else ""} topLeftCell="{s.freeze}" activePane="bottomRight" state="frozen"/>'
        out.append(f'<sheetViews><sheetView workbookViewId="0">{pane}</sheetView></sheetViews>')
    if s.widths:
        out.append("<cols>")
        for c in sorted(s.widths):
            out.append(f'<col min="{c}" max="{c}" width="{s.widths[c]}" customWidth="1"/>')
        out.append("</cols>")
    out.append("<sheetData>")
    rows: dict[int, list[int]] = {}
    for r, c in s.cells:
        rows.setdefault(r, []).append(c)
    for r in sorted(rows):
        out.append(f'<row r="{r}">')
        for c in sorted(rows[r]):
            cell = s.cells[(r, c)]
            sid = STYLE_NAMES.index(cell.style)
            a = addr(r, c)
            if cell.formula is not None:
                v = cell.cached
                f = escape(cell.formula)
                if isinstance(v, bool):
                    out.append(f'<c r="{a}" s="{sid}" t="b"><f>{f}</f><v>{int(v)}</v></c>')
                elif isinstance(v, str):
                    out.append(f'<c r="{a}" s="{sid}" t="str"><f>{f}</f><v>{escape(v)}</v></c>')
                elif v is None:
                    out.append(f'<c r="{a}" s="{sid}"><f>{f}</f></c>')
                else:
                    out.append(f'<c r="{a}" s="{sid}"><f>{f}</f><v>{fmt_num(v)}</v></c>')
            elif cell.value is None:
                out.append(f'<c r="{a}" s="{sid}"/>')
            elif isinstance(cell.value, bool):
                out.append(f'<c r="{a}" s="{sid}" t="b"><v>{int(cell.value)}</v></c>')
            elif isinstance(cell.value, (int, float)):
                out.append(f'<c r="{a}" s="{sid}"><v>{fmt_num(cell.value)}</v></c>')
            else:
                out.append(
                    f'<c r="{a}" s="{sid}" t="inlineStr"><is><t xml:space="preserve">{escape(str(cell.value))}</t></is></c>'
                )
        out.append("</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out)


# ---------------------------------------------------------------- evaluator

TOKEN = re.compile(
    r"""\s*(?:
    (?P<num>\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)
   |(?P<str>"(?:[^"]|"")*")
   |(?P<ref>(?:[A-Za-z][A-Za-z0-9_]*!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(])
   |(?P<fn>[A-Z][A-Z0-9.]*)\(
   |(?P<bool>TRUE|FALSE)(?![A-Za-z0-9_(])
   |(?P<op><>|<=|>=|[-+*/^&=<>(),%])
    )""",
    re.X,
)


class Rng:
    """A rectangular block of values."""

    def __init__(self, rows: list[list]):
        self.rows = rows

    def flat(self):
        for r in self.rows:
            yield from r


def num(v) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    raise ValueError(f"#VALUE!: expected a number, got {v!r}")


def excel_round(x: float, dp: int) -> float:
    """Spreadsheet ROUND: reduce to 15 significant digits, then round half away from zero."""
    if x == 0:
        return 0.0
    d = Decimal(format(x, ".15g"))
    q = Decimal(1).scaleb(-dp)
    return float(d.quantize(q, rounding=ROUND_HALF_UP))


def _flat_numbers(args):
    for a in args:
        if isinstance(a, Rng):
            for v in a.flat():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    yield float(v)
        else:
            yield num(a)


def _pmt(rate, nper, pv, fv=0.0, typ=0.0):
    if rate == 0:
        return -(pv + fv) / nper
    g = (1 + rate) ** nper
    return -(rate * (pv * g + fv)) / ((1 + rate * typ) * (g - 1))


def _npv(rate, *vals):
    return sum(v / (1 + rate) ** (i + 1) for i, v in enumerate(_flat_numbers(vals)))


def _irr(vals, guess=0.1):
    cf = list(_flat_numbers([vals]))
    r = guess
    for _ in range(200):
        f = sum(c / (1 + r) ** t for t, c in enumerate(cf))
        df = sum(-t * c / (1 + r) ** (t + 1) for t, c in enumerate(cf))
        if df == 0:
            break
        nr = r - f / df
        if abs(nr - r) < 1e-14:
            return nr
        r = nr
    return r


def _crit_match(v, crit) -> bool:
    if isinstance(crit, str):
        return isinstance(v, str) and v == crit
    return isinstance(v, (int, float)) and not isinstance(v, bool) and float(v) == float(crit)


def _median(xs):
    """Excel MEDIAN: the middle number, or the mean of the two middle numbers for an even count."""
    s = sorted(xs)
    if not s:
        raise ValueError("#NUM!: MEDIAN of no numbers")
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _sumproduct(*rs):
    rows = [list(r.flat()) if isinstance(r, Rng) else [r] for r in rs]
    n = len(rows[0])
    if any(len(r) != n for r in rows):
        raise ValueError("#VALUE!: SUMPRODUCT arrays differ in size")
    total = 0.0
    for i in range(n):
        p = 1.0
        for r in rows:
            v = r[i]
            p *= float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0
        total += p
    return total


FUNCTIONS = {
    "SUM": lambda *a: sum(_flat_numbers(a)),
    "SUMPRODUCT": _sumproduct,
    "ROUND": lambda x, d: excel_round(num(x), int(num(d))),
    "ABS": lambda x: abs(num(x)),
    "MEDIAN": lambda *a: _median(_flat_numbers(a)),
    "PRODUCT": lambda *a: math.prod(_flat_numbers(a)),
    "MIN": lambda *a: min(_flat_numbers(a)),
    "MAX": lambda *a: max(_flat_numbers(a)),
    "INT": lambda x: float(math.floor(num(x))),
    "POWER": lambda x, y: num(x) ** num(y),
    "PMT": lambda r, n, pv, fv=0, t=0: _pmt(num(r), num(n), num(pv), num(fv), num(t)),
    "NPV": lambda r, *v: _npv(num(r), *v),
    "IRR": lambda v, g=0.1: _irr(v, num(g)),
    "COUNTIF": lambda rng, crit: float(sum(1 for v in rng.flat() if _crit_match(v, crit))),
    "SUMIF": lambda rng, crit, sr: sum(
        float(b) for a, b in zip(rng.flat(), sr.flat()) if _crit_match(a, crit) and isinstance(b, (int, float))
    ),
    "ROWS": lambda rng: float(len(rng.rows)),
    "AND": lambda *a: all(bool(x) for x in a),
    "OR": lambda *a: any(bool(x) for x in a),
    "NOT": lambda x: not bool(x),
}
LAZY = {"IF"}  # evaluated by the parser so only the chosen branch runs


class Evaluator:
    def __init__(self, wb: Workbook):
        self.wb = wb
        self.memo: dict[tuple[str, int, int], object] = {}
        self.stack: set[tuple[str, int, int]] = set()

    def cell_value(self, sheet: str, r: int, c: int):
        key = (sheet, r, c)
        if key in self.memo:
            return self.memo[key]
        cell = self.wb.get(sheet).cells.get((r, c))
        if cell is None:
            return None
        if cell.formula is None:
            return cell.value
        if key in self.stack:
            raise ValueError(f"circular reference at {sheet}!{addr(r, c)}")
        self.stack.add(key)
        try:
            v = Parser(self, sheet, cell.formula).parse()
        except Exception as e:
            raise ValueError(f"{sheet}!{addr(r, c)}: ={cell.formula}: {e}") from e
        finally:
            self.stack.discard(key)
        self.memo[key] = v
        return v

    def range_value(self, sheet: str, a: str):
        parts = a.replace("$", "").split(":")
        r1, c1 = split_addr(parts[0])
        if len(parts) == 1:
            return self.cell_value(sheet, r1, c1)
        r2, c2 = split_addr(parts[1])
        return Rng([[self.cell_value(sheet, r, c) for c in range(c1, c2 + 1)] for r in range(r1, r2 + 1)])


class Parser:
    def __init__(self, ev: Evaluator, sheet: str, text: str):
        self.ev, self.sheet, self.text = ev, sheet, text
        self.toks: list[tuple[str, str]] = []
        pos = 0
        while pos < len(text):
            if text[pos:].strip() == "":
                break
            m = TOKEN.match(text, pos)
            if not m:
                raise ValueError(f"cannot tokenize at {text[pos:pos + 20]!r}")
            kind = m.lastgroup
            self.toks.append((kind, m.group(kind)))
            pos = m.end()
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def take(self):
        t = self.peek()
        self.i += 1
        return t

    def expect(self, op):
        k, v = self.take()
        if k != "op" or v != op:
            raise ValueError(f"expected {op!r}, got {v!r}")

    def parse(self):
        v = self.compare(True)
        if self.i != len(self.toks):
            raise ValueError(f"unexpected {self.peek()[1]!r}")
        return v

    # `live` is False while skipping the unchosen branch of IF: parse for syntax, do not evaluate.
    def compare(self, live):
        left = self.concat(live)
        while self.peek()[0] == "op" and self.peek()[1] in ("=", "<>", "<", ">", "<=", ">="):
            op = self.take()[1]
            right = self.concat(live)
            if live:
                left = self.cmp(op, left, right)
        return left

    @staticmethod
    def cmp(op, a, b):
        if isinstance(a, Rng) or isinstance(b, Rng):
            raise ValueError("array comparison is not supported")
        if a is None:
            a = "" if isinstance(b, str) else 0.0
        if b is None:
            b = "" if isinstance(a, str) else 0.0
        if isinstance(a, str) != isinstance(b, str):
            # Excel orders text after numbers; equality is simply False
            eq = False
            lt = not isinstance(a, str)
        else:
            if isinstance(a, str):
                eq, lt = a.lower() == b.lower(), a.lower() < b.lower()
            else:
                eq, lt = float(a) == float(b), float(a) < float(b)
        return {"=": eq, "<>": not eq, "<": lt and not eq, ">": not lt and not eq, "<=": lt or eq, ">=": not lt or eq}[op]

    def concat(self, live):
        left = self.additive(live)
        while self.peek() == ("op", "&"):
            self.take()
            right = self.additive(live)
            if live:
                left = self.text_of(left) + self.text_of(right)
        return left

    @staticmethod
    def text_of(v):
        if v is None:
            return ""
        if isinstance(v, float) and v == int(v):
            return str(int(v))
        return str(v)

    def additive(self, live):
        left = self.term(live)
        while self.peek()[0] == "op" and self.peek()[1] in "+-" and len(self.peek()[1]) == 1:
            op = self.take()[1]
            right = self.term(live)
            if live:
                left = num(left) + num(right) if op == "+" else num(left) - num(right)
        return left

    def term(self, live):
        left = self.power(live)
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.take()[1]
            right = self.power(live)
            if live:
                if op == "*":
                    left = num(left) * num(right)
                else:
                    d = num(right)
                    if d == 0:
                        raise ZeroDivisionError("#DIV/0!")
                    left = num(left) / d
        return left

    def power(self, live):
        left = self.unary(live)
        while self.peek() == ("op", "^"):
            self.take()
            right = self.unary(live)
            if live:
                left = num(left) ** num(right)
        return left

    def unary(self, live):
        if self.peek() == ("op", "-"):
            self.take()
            v = self.unary(live)
            return -num(v) if live else v
        if self.peek() == ("op", "+"):
            self.take()
            return self.unary(live)
        v = self.primary(live)
        while self.peek() == ("op", "%"):
            self.take()
            v = num(v) / 100 if live else v
        return v

    def primary(self, live):
        kind, val = self.take()
        if kind == "num":
            return float(val)
        if kind == "str":
            return val[1:-1].replace('""', '"')
        if kind == "bool":
            return val == "TRUE"
        if kind == "ref":
            if not live:
                return None
            sheet = self.sheet
            a = val
            if "!" in a:
                sheet, a = a.split("!", 1)
            return self.ev.range_value(sheet, a)
        if kind == "fn":
            if val == "IF":
                cond = self.compare(live)
                self.expect(",")
                chosen = bool(cond) if live else True
                a = self.compare(live and chosen)
                b = None
                if self.peek() == ("op", ","):
                    self.take()
                    b = self.compare(live and not chosen)
                self.expect(")")
                return a if chosen else b
            args = []
            if self.peek() != ("op", ")"):
                while True:
                    args.append(self.compare(live))
                    if self.peek() == ("op", ","):
                        self.take()
                        continue
                    break
            self.expect(")")
            if not live:
                return None
            fn = FUNCTIONS.get(val)
            if fn is None:
                raise ValueError(f"unsupported function {val}")
            return fn(*args)
        if kind == "op" and val == "(":
            v = self.compare(live)
            self.expect(")")
            return v
        raise ValueError(f"unexpected token {val!r}")
