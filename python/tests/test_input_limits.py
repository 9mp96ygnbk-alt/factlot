"""Structural input limits and per-field caps (security audit 2026-11-03).

The same cases run against TypeScript in packages/tools/src/limits.test.ts.
"""

import unittest

import factlot
from factlot._core import INPUT_LIMITS, input_shape_issue, round_
from factlot.calc import CALCULATORS
from factlot.tools import configure_registry


def error_of(name, args):
    out = factlot.run_tool(name, args)
    assert "error" in out, f"{name} should fail: {out}"
    return out


class StructuralLimits(unittest.TestCase):
    def test_nesting_deeper_than_max_depth(self):
        deep = 1
        for _ in range(40):
            deep = [deep]
        err = error_of("fact_validate", {"fact": {"value": deep}})
        self.assertEqual(err["error"], "InputError")
        self.assertIn("nested deeper than 32 levels", err["message"])
        self.assertEqual(err["issues"][0]["path"], "fact.value" + ".0" * 30)

    def test_one_array_over_max_items(self):
        err = error_of("fact_validate", {"fact": {"value": [0] * (INPUT_LIMITS["max_array_items"] + 1)}})
        self.assertEqual(err["issues"], [{"path": "fact.value", "message": "more than 10000 items"}])

    def test_too_many_values(self):
        err = error_of("fact_validate", {"fact": {"value": [[0] * 9000 for _ in range(25)]}})
        self.assertEqual(err["issues"], [{"path": "", "message": "more than 200000 values"}])

    def test_string_over_max_length(self):
        err = error_of("id_document", {"text": "x" * (INPUT_LIMITS["max_string_length"] + 1)})
        self.assertEqual(err["error"], "InputError")
        self.assertEqual(err["issues"][0]["path"], "text")

    def test_calculators_report_calc_input_error(self):
        self.assertEqual(error_of("calc_npv", [1, 2])["error"], "CalcInputError")
        self.assertEqual(error_of("calc_npv", {"cash_flows": [1] * 10_001, "rate": 0})["error"], "CalcInputError")

    def test_sorted_walk_stops_at_first_problem(self):
        long = [0] * 10_001
        self.assertEqual(input_shape_issue({"b": long, "a": long}), {"path": "a", "message": "more than 10000 items"})
        self.assertIsNone(input_shape_issue({"a": [1, {"b": "c"}]}))

    def test_unknown_tool_is_reported_before_input_checks(self):
        self.assertEqual(factlot.run_tool("nope", [1])["error"], "UnknownTool")


class FieldCaps(unittest.TestCase):
    def test_cash_flows(self):
        self.assertEqual(error_of("calc_irr", {"cash_flows": [-1] + [1] * 1200})["error"], "CalcInputError")
        self.assertNotIn("error", factlot.run_tool("calc_irr", {"cash_flows": [-1000] + [1] * 1199}))

    def test_leases_abated_months_and_ids(self):
        leases = [{"expiration_date": "2030-01-01", "area_sf": 1}] * 10_001
        self.assertEqual(error_of("calc_walt", {"as_of": "2026-01-01", "leases": leases})["error"], "CalcInputError")
        sched = {"commencement_date": "2026-01-01", "term_months": 12, "area_sf": 1000,
                 "starting_rent_psf_annual": 30, "abated_months": [1] * 1201}
        self.assertEqual(error_of("calc_rent_schedule", sched)["error"], "CalcInputError")
        err = error_of("id_parcel", {"state_fips": "06", "county_fips": "037", "apn": "1" * 201})
        self.assertEqual((err["error"], err["issues"][0]["path"]), ("InputError", "apn"))

    def test_walt_lease_id_must_be_a_string_as_in_typescript(self):
        lease = {"expiration_date": "2030-01-01", "area_sf": 1, "id": 7}
        self.assertEqual(error_of("calc_walt", {"as_of": "2026-01-01", "leases": [lease]})["error"], "CalcInputError")

    def test_registry_error_does_not_reveal_the_path(self):
        configure_registry("/nonexistent-factlot-dir/secret-name.db")
        try:
            err = error_of("registry_get", {"urn": "fl:parcel:us-48201:1"})
            self.assertEqual(err["error"], "RegistryUnavailable")
            self.assertNotIn("secret-name", err["message"])
            self.assertNotIn("nonexistent", err["message"])
        finally:
            configure_registry(None)


class NumericEdgeCases(unittest.TestCase):
    """Inputs on which Python used to raise where TypeScript returned a result or a CalcInputError."""

    def test_irr_long_series_no_crash_and_no_spurious_roots(self):
        flows = [(1 if i % 2 else -1) * (1 + i % 7) for i in range(200)]
        out = CALCULATORS["irr"][0]({"cash_flows": flows})
        self.assertEqual(out["formula"]["version"], 2)
        self.assertTrue(all(r > -0.9 for r in out["value"]["roots"]))
        self.assertEqual(out["warnings"], [])

    def test_npv_near_minus_100_percent_is_a_calc_input_error(self):
        self.assertEqual(error_of("calc_npv", {"cash_flows": [1, -1] * 100, "rate": -0.9999})["error"],
                         "CalcInputError")

    def test_round_of_huge_values_matches_typescript(self):
        self.assertEqual(round_(1e300, 2), 1e300)
        self.assertEqual(round_(-1e30, 0), -1e30)
        self.assertEqual(round_(123456789012345678.9, 2), 123456789012346000.0)

    def test_zero_annual_constant_with_min_dscr(self):
        args = {"noi": 3713937.31, "value": 422703000.22, "rate_annual": 0.0, "amortization_years": 0,
                "max_ltv": 0.541, "min_dscr": 1.06}
        self.assertEqual(error_of("calc_debt_sizing", args)["error"], "CalcInputError")


if __name__ == "__main__":
    unittest.main()
