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
