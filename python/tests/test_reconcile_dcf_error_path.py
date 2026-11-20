"""calc_reconcile_dcf reports every base-year lease that lacks its base-year expense, the same as the
TypeScript schema does (packages/calc/src/reconcile_dcf_error_path.test.ts; differential seed 3 found the
Python port stopping at the first: 2 issues against 1)."""

import copy
import json
import pathlib
import unittest

from factlot import run_tool

VECTORS = pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "calc" / "reconcile_dcf.json"


class ReconcileDcfErrorPath(unittest.TestCase):
    def test_every_missing_base_year_expense_is_an_issue(self):
        inp = copy.deepcopy(json.loads(VECTORS.read_text())["cases"][0]["input"])
        for i in (0, 1):
            inp["dcf"]["leases"][i]["recovery"] = "base_year"
            inp["dcf"]["leases"][i].pop("base_year_opex_psf_annual", None)
        out = run_tool("calc_reconcile_dcf", inp)
        self.assertEqual(out["error"], "CalcInputError")
        self.assertEqual([x["path"] for x in out["issues"]],
                         ["dcf.leases.0.base_year_opex_psf_annual", "dcf.leases.1.base_year_opex_psf_annual"])
        self.assertIn("required when recovery is base_year; dcf.leases.1", out["message"] if "message" in out else str(out))

    def test_a_single_one_is_still_one_issue(self):
        inp = copy.deepcopy(json.loads(VECTORS.read_text())["cases"][0]["input"])
        inp["dcf"]["leases"][0]["recovery"] = "base_year"
        inp["dcf"]["leases"][0].pop("base_year_opex_psf_annual", None)
        for l in inp["dcf"]["leases"][1:]:
            if l.get("recovery") == "base_year":
                l.setdefault("base_year_opex_psf_annual", 5)
        out = run_tool("calc_reconcile_dcf", inp)
        self.assertEqual([x["path"] for x in out["issues"]], ["dcf.leases.0.base_year_opex_psf_annual"])


if __name__ == "__main__":
    unittest.main()
