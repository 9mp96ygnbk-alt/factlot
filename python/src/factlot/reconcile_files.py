"""Read another system's export (CSV or XLSX) into the input of the tie-out tools.

    python3 -m factlot.reconcile_files annual.csv                       # {"lines": [...]} for other.lines
    python3 -m factlot.reconcile_files annual.xlsx --dcf dcf.json \\
        --system "my export" --value 10250000 --irr 0.0815 --run        # the calc_reconcile_dcf input, run
    python3 -m factlot.reconcile_files --cam-rows tenants.csv --cam cam.json --run

Annual lines: the first column holds the line labels and the next columns the years, year 1 first.
Blank rows and rows whose first cell starts with "#" are ignored. A first row with a blank first cell,
letters among its other cells ("Year 1", "FY2027", "Total") or consecutive calendar years (2027, 2028, ...)
is a header and is skipped; a column whose header is "Total" is dropped. Rows with a label and no amounts
(section headings) are skipped and reported. Amounts may be numbers or text such as "1,234.50",
"$1,234.50", "(1,234.50)" or "-1,234.50" (both negative); "-", an en or em dash and empty cells read as 0.
A percent ("5%") is an error, since the lines are amounts.

CAM rows: a header row naming the fields of other.tenants (tenant, pool, pro_rata_share,
gross_up_applied, grossed_up_expenses, cap_applied, cap_limit, cap_reduction, admin_fee_applied,
admin_fee, structure_deduction, billed_amount, estimates_paid, balance_due), then one row per tenant.
Unknown columns are an error; empty cells are left out.

CSV uses the standard library; XLSX uses FactLot's own reader (the first worksheet; formula cells give
the value Excel last saved). Nothing is sent anywhere: this only reads the file.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any

_NUMBER = re.compile(r"[0-9]+(\.[0-9]*)?|\.[0-9]+")
_DASHES = {"-", "–", "—", ""}
_YEAR_LABEL = re.compile(r"^(year|yr|fy)\s*[0-9]+$", re.IGNORECASE)

CAM_FIELDS = ("tenant", "pool", "pro_rata_share", "gross_up_applied", "grossed_up_expenses", "cap_applied", "cap_limit",
              "cap_reduction", "admin_fee_applied", "admin_fee", "structure_deduction", "billed_amount", "estimates_paid",
              "balance_due")
_CAM_TEXT = ("tenant", "pool")
_CAM_FLAGS = ("gross_up_applied", "cap_applied", "admin_fee_applied")


class ExportError(ValueError):
    """The file cannot be read as the tool's input; the message says which row and column."""


def read_rows(path: str | Path) -> list[list[Any]]:
    """Every row of a .csv (or .tsv) file, or of the first worksheet of an .xlsx file, as lists of cells."""
    p = Path(path)
    ext = p.suffix.lower()
    if ext in (".csv", ".tsv", ".txt"):
        with open(p, newline="", encoding="utf-8-sig") as f:
            return [list(r) for r in csv.reader(f, delimiter="\t" if ext == ".tsv" else ",")]
    if ext in (".xlsx", ".xlsm"):
        from .registry.adapters.xlsx_reader import rows

        return [list(r) for r in rows(p)]
    raise ExportError(f"{p.name}: expected a .csv, .tsv or .xlsx file")


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def parse_amount(v: Any, where: str = "") -> float:
    """A cell as an amount: numbers as they are; text with $, thousands commas and (negative) parentheses."""
    if isinstance(v, bool):
        raise ExportError(f"{where}: expected an amount, got {v!r}")
    if isinstance(v, (int, float)):
        return float(v)
    s = _text(v).replace(" ", "").replace("\u00a0", "").replace("\u2212", "-")
    if s in _DASHES:
        return 0.0
    if s.endswith("%"):
        raise ExportError(f"{where}: {s!r} is a percent; the annual lines must be amounts")
    t = s
    negative = False
    if t.startswith("(") and t.endswith(")"):
        negative, t = True, t[1:-1]
    t = t.replace("$", "").replace(",", "")
    if t.startswith("-"):
        negative, t = True, t[1:]
    elif t.endswith("-"):
        negative, t = True, t[:-1]
    if not _NUMBER.fullmatch(t):
        raise ExportError(f"{where}: {s!r} is not an amount")
    x = float(t)
    return -x if negative and x != 0 else x


def _is_amount(v: Any) -> bool:
    try:
        parse_amount(v)
        return _text(v) not in _DASHES or isinstance(v, (int, float))
    except ExportError:
        return False


def _content(rows: list[list[Any]]) -> list[list[Any]]:
    """Rows without blank rows and comment rows (a first cell starting with "#")."""
    return [r for r in rows if any(_text(c) != "" for c in r) and not (r and _text(r[0]).startswith("#"))]


def _is_header(row: list[Any]) -> bool:
    if not row:
        return False
    cells = [c for c in row[1:] if _text(c) != ""]
    if _text(row[0]) == "" and cells:
        return True
    if not cells:
        return False
    if any(_YEAR_LABEL.match(_text(c)) or _text(c).lower() == "total" for c in cells):
        return True
    if any(re.search(r"[A-Za-z]", _text(c)) for c in cells):
        return True
    if not all(_is_amount(c) for c in cells):
        return False
    nums = [parse_amount(c) for c in cells]
    return all(x.is_integer() and 1900 <= x <= 2200 for x in nums) and all(b == a + 1 for a, b in zip(nums, nums[1:]))


def lines_from_rows(rows: list[list[Any]], source: str = "file") -> dict[str, Any]:
    """``{"lines": [{label, values}], "notes": [...]}`` from rows of an annual cash-flow export."""
    rows = _content(rows)
    notes: list[str] = []
    drop: set[int] = set()
    if rows and _is_header(rows[0]):
        header = rows.pop(0)
        drop = {j for j, c in enumerate(header) if j > 0 and _text(c).lower() in ("total", "totals", "sum")}
        if drop:
            notes.append(f"dropped the total column{'s' if len(drop) > 1 else ''} ({len(drop)})")
    lines: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for i, r in enumerate(rows):
        label = _text(r[0]) if r else ""
        cells = [c for j, c in enumerate(r[1:], start=1) if j not in drop]
        while cells and _text(cells[-1]) == "" and not isinstance(cells[-1], (int, float)):
            cells.pop()
        if label == "":
            raise ExportError(f"{source} row {i + 1}: amounts with no label in the first column")
        if not cells:
            notes.append(f"skipped \"{label}\" (no amounts: a heading?)")
            continue
        values = [parse_amount(c, f"{source} row {i + 1} \"{label}\" column {j + 2}") for j, c in enumerate(cells)]
        key = label.lower()
        if key in seen:
            raise ExportError(f"{source}: the label \"{label}\" appears twice (rows {seen[key] + 1} and {i + 1}); rename one")
        seen[key] = i
        lines.append({"label": label, "values": values})
    if not lines:
        raise ExportError(f"{source}: no line with a label and amounts")
    return {"lines": lines, "notes": notes}


def lines_from_file(path: str | Path) -> dict[str, Any]:
    """``{"lines": [...], "notes": [...]}`` from a CSV or XLSX of annual lines."""
    return lines_from_rows(read_rows(path), Path(path).name)


def _flag(v: Any, where: str) -> bool:
    if isinstance(v, bool):
        return v
    s = _text(v).lower()
    if s in ("true", "yes", "y", "1"):
        return True
    if s in ("false", "no", "n", "0"):
        return False
    raise ExportError(f"{where}: expected true or false, got {_text(v)!r}")


def cam_rows_from_rows(rows: list[list[Any]], source: str = "file") -> list[dict[str, Any]]:
    """other.tenants for calc_reconcile_cam from rows with a header of field names."""
    rows = _content(rows)
    if not rows:
        raise ExportError(f"{source}: empty")
    header = [_text(c).lower() for c in rows[0]]
    for c in header:
        if c and c not in CAM_FIELDS:
            raise ExportError(f"{source}: unknown column \"{c}\"; known: {', '.join(CAM_FIELDS)}")
    if "tenant" not in header or "billed_amount" not in header:
        raise ExportError(f"{source}: the header needs tenant and billed_amount columns")
    out = []
    for i, r in enumerate(rows[1:], start=2):
        row: dict[str, Any] = {}
        for j, name in enumerate(header):
            if not name or j >= len(r) or _text(r[j]) == "":
                continue
            where = f"{source} row {i} column {name}"
            if name in _CAM_TEXT:
                row[name] = _text(r[j])
            elif name in _CAM_FLAGS:
                row[name] = _flag(r[j], where)
            else:
                row[name] = parse_amount(r[j], where)
        out.append(row)
    return out


def cam_rows_from_file(path: str | Path) -> list[dict[str, Any]]:
    return cam_rows_from_rows(read_rows(path), Path(path).name)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m factlot.reconcile_files", description=__doc__.split("\n\n")[0])
    ap.add_argument("annual", nargs="?", help="CSV or XLSX of annual lines (labels, then years)")
    ap.add_argument("--dcf", help="JSON file with the calc_dcf_pro_forma input; prints the full calc_reconcile_dcf input")
    ap.add_argument("--system", help="name of the other system, echoed in the result")
    ap.add_argument("--value", type=float, help="the other system's present value")
    ap.add_argument("--irr", type=float, help="the other system's unlevered IRR, as a decimal")
    ap.add_argument("--gross-sale-price", type=float)
    ap.add_argument("--net-sale-proceeds", type=float)
    ap.add_argument("--mapping", help='JSON file: [{"label": ..., "line": ...}] label mappings')
    ap.add_argument("--cam-rows", help="CSV or XLSX of the other system's per-tenant CAM results")
    ap.add_argument("--cam", help="JSON file with the calc_cam_reconciliation_batch input")
    ap.add_argument("--run", action="store_true", help="run the tool locally and print its result")
    a = ap.parse_args(argv)
    try:
        if a.cam_rows:
            other: dict[str, Any] = {"tenants": cam_rows_from_file(a.cam_rows)}
            if a.system:
                other["system"] = a.system
            if not a.cam:
                out: Any = other
                tool = None
            else:
                out = {"cam": json.loads(Path(a.cam).read_text("utf-8")), "other": other}
                tool = "calc_reconcile_cam"
        elif a.annual:
            got = lines_from_file(a.annual)
            for n in got["notes"]:
                print(f"note: {n}", file=sys.stderr)
            other = {"lines": got["lines"]}
            if a.system:
                other["system"] = a.system
            for key, v in (("value", a.value), ("unlevered_irr", a.irr), ("gross_sale_price", a.gross_sale_price),
                           ("net_sale_proceeds", a.net_sale_proceeds)):
                if v is not None:
                    other[key] = v
            if not a.dcf:
                out, tool = other, None
            else:
                out = {"dcf": json.loads(Path(a.dcf).read_text("utf-8")), "other": other}
                if a.mapping:
                    out["mapping"] = json.loads(Path(a.mapping).read_text("utf-8"))
                tool = "calc_reconcile_dcf"
        else:
            ap.error("give an annual-lines file, or --cam-rows")
            return 2
    except (ExportError, OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if a.run:
        if tool is None:
            print("error: --run needs --dcf (or --cam with --cam-rows)", file=sys.stderr)
            return 2
        from .tools import run_tool

        out = run_tool(tool, out)
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 1 if a.run and "error" in out and set(out) == {"error", "message", "issues"} else 0


if __name__ == "__main__":
    sys.exit(main())
