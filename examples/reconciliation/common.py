"""Shared pieces for the reconciliation workbooks: running FactLot, the Read me and Reconcile sheets."""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "python", "src"))

import factlot  # noqa: E402  (the repository's own SDK, no install needed)

from xlsx_lite import Workbook, Sheet, addr  # noqa: E402

FACTLOT_VERSION = factlot.__version__


class FactLotError(RuntimeError):
    pass


def run(tool: str, args: dict) -> dict:
    """Run one FactLot tool and return its result; raise if the tool reported an error."""
    r = factlot.run_tool(tool, args)
    if "error" in r:
        raise FactLotError(f"{tool}: {r.get('message')}")
    return r


ARGUS_NOTE = [
    "ARGUS parity is UNTESTED. These workbooks reconcile FactLot to Excel formulas that follow FactLot's "
    "stated conventions. They were not compared with ARGUS Enterprise output, and nothing here claims "
    "that FactLot matches ARGUS.",
    "Where to look if you want to compare with ARGUS yourself: how ARGUS timing of rent (start or end of "
    "period) and discounting (monthly or annual, start or end of period) are set in your model; whether "
    "it prorates a part month by days or by months; whether it escalates rent on the lease anniversary "
    "or on a calendar date; how it rounds (cents per month, or unrounded); how free rent, TI and "
    "commissions are timed; and which discount rate it applies to a net effective rent. Check each "
    "against your ARGUS version's own help; this repository does not reproduce ARGUS documentation.",
    "To set FactLot inputs to a given ARGUS setup, change the Inputs sheet (blue cells) and read the "
    "ReadMe conventions list to see what FactLot assumes. Where a convention cannot be changed by an input "
    "(for example FactLot discounts rent at the start of each month), the difference from your ARGUS "
    "setting is a known, documented gap, not something these workbooks hide.",
]


def put_lines(sh: Sheet, row: int, lines: list[str], style: str = "text", col: int = 1) -> int:
    for ln in lines:
        sh.put(row, col, ln, style)
        row += 1
    return row


def readme_sheet(
    wb: Workbook,
    title: str,
    purpose: list[str],
    formulas: list[tuple[str, dict]],
    conventions: list[str],
    extra: list[str] | None = None,
) -> Sheet:
    sh = wb.sheet("ReadMe")
    sh.width(1, 120)
    sh.put(1, 1, title, "title")
    sh.put(2, 1, "SYNTHETIC EXAMPLE. Every input is made up for illustration; none is a real lease, property, loan or hotel.", "warn")
    r = 4
    sh.put(r, 1, "What this workbook does", "bold")
    r = put_lines(sh, r + 1, purpose)
    r += 1
    sh.put(r, 1, "How to read it", "bold")
    r = put_lines(
        sh,
        r + 1,
        [
            "Blue cells on a yellow background (Inputs) are the synthetic inputs; change them and every Excel formula recalculates.",
            "Calc (and any table sheets) hold the Excel model: live formulas only, no pasted values.",
            "Reconcile puts the Excel result next to the number FactLot returned for the same inputs (green cells are FactLot's output, "
            "pasted from the run on the date of generation), with a Difference column and a Status. Difference is "
            "ROUND(Excel - FactLot, n), n shown in the Tolerance column; 0.00 means the two agree to the decimals FactLot reports.",
            "If you change an input, the FactLot column does not change (it is a recorded output); re-run build.py or call the tool to refresh it.",
        ],
    )
    r += 1
    sh.put(r, 1, f"FactLot version {FACTLOT_VERSION}. Calculators reconciled", "bold")
    r += 1
    for tool, res in formulas:
        f = res["formula"]
        sh.put(r, 1, f"{tool}  ({f['id']}@{f['version']})", "text")
        r += 1
    r += 1
    sh.put(r, 1, "Conventions (stated, not hidden)", "bold")
    r = put_lines(sh, r + 1, conventions)
    if extra:
        r += 1
        sh.put(r, 1, "Notes", "bold")
        r = put_lines(sh, r + 1, extra)
    r += 1
    sh.put(r, 1, "ARGUS", "bold")
    r = put_lines(sh, r + 1, ARGUS_NOTE)
    r += 1
    sh.put(r, 1, "Regenerating", "bold")
    put_lines(
        sh,
        r + 1,
        [
            "python3 examples/reconciliation/build.py   (Python standard library only; runs FactLot from this repository, rewrites the "
            ".xlsx files, and refuses to write one unless every Difference is 0).",
            "No Excel is needed to build. Excel recalculates every formula when the file opens.",
        ],
    )
    return sh


class Inputs:
    """Label / value / note rows on an Inputs sheet; add() returns the value's absolute address."""

    def __init__(self, sh: Sheet, title: str):
        self.sh = sh
        sh.width(1, 44)
        sh.width(2, 18)
        sh.width(3, 70)
        sh.put(1, 1, title, "title")
        sh.put(2, 1, "SYNTHETIC inputs. Blue on yellow = edit me.", "warn")
        sh.put(3, 1, "Input", "header")
        sh.put(3, 2, "Value", "header")
        sh.put(3, 3, "Note", "header")
        self.row = 4

    def section(self, label: str) -> None:
        self.row += 1
        self.sh.put(self.row, 1, label, "bold")
        self.row += 1

    def add(self, label: str, value, style: str, note: str = "") -> str:
        self.sh.put(self.row, 1, label, "text")
        ref = self.sh.put(self.row, 2, value, style)
        if note:
            self.sh.put(self.row, 3, note, "note")
        self.row += 1
        return ref


class Calc:
    """Label / formula / note rows on a calculation sheet; add() returns the value's absolute address."""

    def __init__(self, sh: Sheet, title: str):
        self.sh = sh
        sh.width(1, 44)
        sh.width(2, 20)
        sh.width(3, 80)
        sh.put(1, 1, title, "title")
        sh.put(2, 1, "Live Excel formulas. No pasted values.", "note")
        self.row = 4

    def section(self, label: str) -> None:
        self.row += 1
        self.sh.put(self.row, 1, label, "bold")
        self.row += 1

    def add(self, label: str, formula: str, style: str = "money", note: str = "") -> str:
        self.sh.put(self.row, 1, label, "text")
        ref = self.sh.put(self.row, 2, formula, style)
        if note:
            self.sh.put(self.row, 3, note, "note")
        self.row += 1
        return ref


FL_STYLE = {"money": "fl_money", "num4": "fl_num4", "num6": "fl_num6", "num8": "fl_num8", "pct": "fl_pct", "int": "fl_int", "text": "fl_text"}


class Recon:
    """Collects (output, Excel formula, FactLot value) rows and writes the Reconcile sheet."""

    HEADER_ROW = 6

    def __init__(self, wb: Workbook):
        self.wb = wb
        self.sh = wb.sheet("Reconcile")
        sh = self.sh
        for c, w in zip(range(1, 9), (46, 12, 22, 22, 14, 12, 28, 40)):
            sh.width(c, w)
        sh.put(1, 1, "Reconciliation: Excel formulas vs FactLot output", "title")
        sh.put(2, 1, "SYNTHETIC inputs. Excel column = live formulas on the Calc sheets. FactLot column = the number FactLot returned (recorded).", "note")
        for i, h in enumerate(("Output", "Unit", "Excel (live formula)", "FactLot (recorded)", "Difference", "Status", "FactLot field", "Tolerance / note"), 1):
            sh.put(self.HEADER_ROW, i, h, "header")
        self.row = self.HEADER_ROW + 1
        self.count = 0
        self.first = self.row

    def section(self, label: str) -> None:
        self.sh.put(self.row, 1, label, "bold")
        self.row += 1

    def add(self, label: str, unit: str, excel: str, factlot, field: str, style: str = "money", tol_dp: int = 8, note: str = "") -> None:
        """excel: a formula string starting with '='. factlot: the tool's number (or text)."""
        sh, r = self.sh, self.row
        sh.put(r, 1, label, "text")
        sh.put(r, 2, unit, "text")
        sh.put(r, 3, excel, "bold" if isinstance(factlot, str) else style)
        if isinstance(factlot, str):
            sh.put(r, 4, factlot, "fl_text")
            sh.put(r, 5, f"=IF({addr(r, 3)}={addr(r, 4)},0,1)", "diff")
            tol = "exact text match"
        else:
            sh.put(r, 4, factlot, FL_STYLE[style])
            sh.put(r, 5, f"=ROUND({addr(r, 3)}-{addr(r, 4)},{tol_dp})", "diff")
            tol = f"rounded to {tol_dp} decimals"
        sh.put(r, 6, f'=IF({addr(r, 5)}=0,"match","DIFFERENT")', "bold")
        sh.put(r, 7, field, "note")
        sh.put(r, 8, (note + " " if note else "") + tol, "note")
        self.row += 1
        self.count += 1

    def finish(self) -> None:
        sh = self.sh
        last = self.row - 1
        sh.put(3, 1, "Rows compared", "bold")
        sh.put(3, 3, f'=COUNTIF(F{self.first}:F{last},"match")+COUNTIF(F{self.first}:F{last},"DIFFERENT")', "int")
        sh.put(4, 1, "Rows that differ", "bold")
        sh.put(4, 3, f'=COUNTIF(F{self.first}:F{last},"DIFFERENT")', "int")
        sh.freeze = f"A{self.HEADER_ROW + 1}"
        self.last = last


def check(wb: Workbook, rec: Recon) -> None:
    """Fail loudly unless every compared row matched."""
    wb.evaluate()
    bad = []
    for r in range(rec.first, rec.last + 1):
        c = rec.sh.cells.get((r, 6))
        if c is not None and c.cached != "match":
            bad.append((rec.sh.cells[(r, 1)].value, rec.sh.cells[(r, 3)].cached, rec.sh.cells[(r, 4)].value, rec.sh.cells[(r, 5)].cached))
    if bad:
        lines = "\n".join(f"  {b[0]}: Excel {b[1]!r} vs FactLot {b[2]!r} (diff {b[3]!r})" for b in bad)
        raise AssertionError(f"{len(bad)} reconciliation rows differ:\n{lines}")
