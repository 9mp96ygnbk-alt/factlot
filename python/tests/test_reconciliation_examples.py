"""The Excel reconciliation workbooks in examples/reconciliation.

Each case runs FactLot on SYNTHETIC inputs, evaluates the workbook's live Excel formulas with the small
evaluator in xlsx_lite.py, and requires every Difference to be 0. The committed .xlsx files must also
equal what the generator writes now, so a calculator change that moves a number fails here until the
workbooks are regenerated (python3 examples/reconciliation/build.py).
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECON = ROOT / "examples" / "reconciliation"


class ReconciliationExamples(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(RECON))
        import build  # noqa: E402

        cls.build = build

    @classmethod
    def tearDownClass(cls):
        sys.path.remove(str(RECON))

    def test_every_workbook_reconciles_and_is_current(self):
        for name in self.build.CASES:
            with self.subTest(case=name):
                filename, wb, rec = self.build.build_one(name)  # raises if any row differs
                self.assertGreater(rec.count, 0)
                path = RECON / filename
                self.assertTrue(path.exists(), f"{filename} missing: run examples/reconciliation/build.py")
                self.assertEqual(
                    self.build.members(str(path)),
                    self.build.members(wb.parts()),
                    f"{filename} is stale: run python3 examples/reconciliation/build.py",
                )

    def test_unequal_appraisal_workbook_from_user_input(self):
        import re
        import tempfile
        import zipfile

        comp = lambda i, value, cite: {  # noqa: E731
            "id": i, "value": value, "value_basis": "appraised", "improvement_area_sf": 10000,
            **({"citation": cite} if cite else {}), "adjustments": [],
        }
        args = {
            "tax_year": 2027,
            "subject": {"id": "SUBJ-9", "value": 1_000_000, "value_basis": "appraised", "improvement_area_sf": 10000},
            "normalize_by": "improvement_area_sf",
            "comparables": [
                comp("C1", 900_000, {"document_id": "doc-roll-1", "locator": "acct 77", "as_of": "2027-04-01"}),
                comp("C2", 1_100_000, None),
                comp("C3", 1_200_000, {"fact_id": "fact-3"}),
            ],
        }
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "evidence.xlsx"
            import json

            src = Path(d) / "args.json"
            src.write_text(json.dumps(args))
            self.assertEqual(self.build.build_from_input("tx_unequal_appraisal", str(src), str(out)), 0)
            with zipfile.ZipFile(out) as z:
                names = re.findall(r'<sheet name="([^"]+)"', z.read("xl/workbook.xml").decode())
                text = {n: " ".join(re.findall(r"<t[^>]*>([^<]*)</t>", z.read(f"xl/worksheets/sheet{i}.xml").decode()))
                        for i, n in enumerate(names, 1)}
        self.assertEqual(names, ["ReadMe", "Reconcile", "Grid"])
        readme = text["ReadMe"]
        self.assertIn("Unequal-appraisal arithmetic, tax year 2027", readme)
        self.assertIn("not a substitute for the advice of an attorney", readme)
        self.assertIn("(Tex. Occ. Code §1103.003(1))", readme)
        self.assertIn("§41.43(b)(3) and §42.26(a)(3)", readme)
        for gone in ("SYNTHETIC", "synthetic", "Regenerating", "build.py"):
            self.assertNotIn(gone, readme)
        grid = text["Grid"]
        for want in ("SUBJ-9", "2027", "doc-roll-1", "acct 77", "2027-04-01", "fact-3", "Locator in source"):
            self.assertIn(want, grid)

    def test_a_wrong_number_is_caught(self):
        from common import Recon
        from xlsx_lite import Workbook

        wb = Workbook("t")
        rec = Recon(wb)
        rec.add("x", "USD", "=1+1", 3.0, "x")
        rec.finish()
        with self.assertRaises(AssertionError):
            sys.modules["common"].check(wb, rec)


if __name__ == "__main__":
    unittest.main()
