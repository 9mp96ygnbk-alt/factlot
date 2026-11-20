"""calc_reconcile_cam names a runtime batch error under cam, the same as the TypeScript (packages/calc/src/
reconcile_cam_error_path.test.ts)."""

import copy
import json
import pathlib
import unittest

from factlot import run_tool

VECTORS = pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "calc" / "reconcile_cam.json"


class ReconcileCamErrorPath(unittest.TestCase):
    def test_move_out_outside_the_period_is_reported_under_cam(self):
        inp = copy.deepcopy(json.loads(VECTORS.read_text())["cases"][0]["input"])
        inp["cam"]["tenants"][1]["occupancy"] = {"move_out_date": f"{inp['cam']['year'] + 1}-06-01"}
        out = run_tool("calc_reconcile_cam", inp)
        self.assertEqual(out["error"], "CalcInputError")
        self.assertEqual([x["path"] for x in out["issues"]], ["cam.tenants.1.occupancy.move_out_date"])


if __name__ == "__main__":
    unittest.main()
