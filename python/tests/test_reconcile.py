"""Tie-out tools (calc_reconcile_dcf, calc_reconcile_cam) and the export reader, on SYNTHETIC data.

The fixtures in examples/reconciliation/tie-out are built by tie_out.py from FactLot's own output with a
planted convention change; no real ARGUS, Yardi or other export is used or implied.
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from factlot import reconcile_dcf, run_tool
from factlot.reconcile import DEFAULT_LINE_LABELS, normalize_label
from factlot.reconcile_files import (
    ExportError,
    cam_rows_from_rows,
    lines_from_file,
    lines_from_rows,
    main,
    parse_amount,
)

ROOT = Path(__file__).resolve().parents[2]
TIE = ROOT / "examples" / "reconciliation" / "tie-out"


class ExportReader(unittest.TestCase):
    def test_header_total_column_comments_and_headings(self):
        rows = [
            ["# SYNTHETIC test rows"],
            ["", "Year 1", "Year 2", "Total"],
            ["REVENUE"],
            ["Potential Base Rent", "1,000.00", "$1,100.50", "2,100.50"],
            ["Free Rent", "(100.00)", "-", "(100.00)"],
            [],
            ["Operating Expenses", "-250", "—", ""],
        ]
        got = lines_from_rows(rows)
        self.assertEqual(got["lines"], [
            {"label": "Potential Base Rent", "values": [1000.0, 1100.5]},
            {"label": "Free Rent", "values": [-100.0, 0.0]},
            {"label": "Operating Expenses", "values": [-250.0, 0.0]},
        ])
        self.assertTrue(any("REVENUE" in n for n in got["notes"]))
        self.assertTrue(any("total" in n for n in got["notes"]))

    def test_calendar_year_header_is_a_header(self):
        got = lines_from_rows([["Line", 2027, 2028, 2029], ["NOI", 1, 2, 3]])
        self.assertEqual(got["lines"], [{"label": "NOI", "values": [1.0, 2.0, 3.0]}])
        got = lines_from_rows([["NOI", 2027, 2029], ["EGR", 1, 2]])  # not consecutive years: data
        self.assertEqual(len(got["lines"]), 2)

    def test_amounts(self):
        for text, want in [("1,234.50", 1234.5), ("$1,234.50", 1234.5), ("(1,234.50)", -1234.5), ("($12)", -12),
                           ("-$12", -12), ("$-12", -12), ("12-", -12), ("", 0), ("–", 0), (".5", 0.5), (7, 7)]:
            self.assertEqual(parse_amount(text), want, text)
        for bad in ("5%", "abc", "1.2.3", True):
            with self.assertRaises(ExportError):
                parse_amount(bad, "here")

    def test_errors_name_the_row(self):
        with self.assertRaisesRegex(ExportError, "twice"):
            lines_from_rows([["NOI", 1], ["noi", 2]])
        with self.assertRaisesRegex(ExportError, "row 1"):
            lines_from_rows([["NOI", "5%"]])
        with self.assertRaisesRegex(ExportError, "no label"):
            lines_from_rows([["Line", "Year 1"], ["", 5]])

    def test_cam_rows(self):
        rows = cam_rows_from_rows([["tenant", "pro_rata_share", "cap_applied", "billed_amount", "cap_limit"],
                                   ["Suite 100", "0.12", "yes", "1,000.00", ""]])
        self.assertEqual(rows, [{"tenant": "Suite 100", "pro_rata_share": 0.12, "cap_applied": True, "billed_amount": 1000.0}])
        with self.assertRaisesRegex(ExportError, "unknown column"):
            cam_rows_from_rows([["tenant", "billed", "billed_amount"]])

    def test_xlsx_fixture_reads_like_the_csv(self):
        x = lines_from_file(TIE / "dcf-vacancy-base.xlsx")
        c = lines_from_file(TIE / "dcf-exact.csv")
        self.assertEqual([line["label"] for line in x["lines"]], [line["label"] for line in c["lines"]])
        self.assertEqual(len(x["lines"]), 14)
        self.assertEqual(len(x["lines"][0]["values"]), 8)  # the Total column is dropped
        self.assertEqual(x["lines"][0], c["lines"][0])  # potential base rent is not changed in that fixture

    def test_command_line_runs_the_tool(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = main([str(TIE / "dcf-exact.csv"), "--dcf", str(TIE / "dcf-input.json"), "--system", "SYNTHETIC", "--run"])
        self.assertEqual(code, 0)
        res = json.loads(out.getvalue())
        self.assertTrue(res["value"]["all_within_tolerance"])
        self.assertEqual(res["provenance"]["formula"], "calc.reconcile_dcf@1")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--cam-rows", str(TIE / "cam-admin-fee-before-cap.csv"), "--cam", str(TIE / "cam-input.json"), "--run"])
        res = json.loads(out.getvalue())
        self.assertEqual(res["value"]["tenants"][0]["likely_causes"][0]["cause"], "admin_fee_cap_order")

    def test_command_line_reports_a_bad_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.csv"
            p.write_text("NOI,5%\n", "utf-8")
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                self.assertEqual(main([str(p)]), 1)
            self.assertIn("percent", err.getvalue())


class ReconcileTools(unittest.TestCase):
    def test_labels_compare_ignoring_case_and_punctuation(self):
        self.assertEqual(normalize_label("Absorption & Turnover Vacancy"), "absorption and turnover vacancy")
        self.assertEqual(normalize_label("  NET operating-income: "), "net operating income")
        self.assertEqual(normalize_label("—"), "")
        self.assertIn(("Cash Flow Before Debt Service", "cash_flow_before_debt"), DEFAULT_LINE_LABELS)

    def test_unknown_fields_and_whole_number_rates_are_rejected_inside_the_dcf(self):
        inp = json.loads((TIE / "dcf-input.json").read_text("utf-8"))
        args = {"dcf": {**inp, "discount_rate": 8}, "other": {"lines": [{"label": "NOI", "values": [1]}]}}
        r = run_tool("calc_reconcile_dcf", args)
        self.assertEqual(r["error"], "CalcInputError")
        self.assertEqual(r["issues"][0]["path"], "dcf.discount_rate")
        r = run_tool("calc_reconcile_dcf", {**args, "dcf": inp, "tolerence": 1})
        self.assertIn("tolerance", r["message"])

    def test_dcf_errors_carry_the_dcf_path(self):
        inp = json.loads((TIE / "dcf-input.json").read_text("utf-8"))
        r = run_tool("calc_reconcile_dcf", {"dcf": {**inp, "hold_years": 0}, "other": {"lines": [{"label": "NOI", "values": [1]}]}})
        self.assertEqual(r["issues"][0]["path"], "dcf.hold_years")

    def test_nothing_mapped_is_not_a_tie_out(self):
        inp = json.loads((TIE / "dcf-input.json").read_text("utf-8"))
        res = reconcile_dcf({"dcf": inp, "other": {"lines": [{"label": "Parking", "values": [1]}]}})
        self.assertFalse(res["value"]["all_within_tolerance"])
        self.assertEqual(res["value"]["unmapped_labels"], ["Parking"])

    def test_fixtures_are_current_and_name_every_planted_cause(self):
        sys.path.insert(0, str(ROOT / "examples" / "reconciliation"))
        try:
            import tie_out

            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(tie_out.main(["--check"]), 0, "run python3 examples/reconciliation/tie_out.py")
        finally:
            sys.path.remove(str(ROOT / "examples" / "reconciliation"))


if __name__ == "__main__":
    unittest.main()
