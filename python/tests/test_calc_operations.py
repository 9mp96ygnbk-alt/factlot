"""Operations calculators: units change labels not numbers, schedules foot, batch CAM equals single-tenant CAM."""

import unittest

from factlot import CalcInputError
from factlot.calc import (
    LEASE_UNITS,
    cam_reconciliation,
    cam_reconciliation_batch,
    capex_recovery,
    compare_proposals,
    multifamily_rent_roll,
    net_effective_rent,
    rent_schedule,
)

SCHEDULE = {
    "commencement_date": "2026-01-15",
    "term_months": 60,
    "area_sf": 2400,
    "starting_rent_psf_annual": 1740,
    "escalation": {"type": "fixed_psf", "amount": 36},
    "abated_months": [1, 2],
}


def numbers(x):
    """Every number in a result, in order, ignoring labels."""
    if isinstance(x, bool) or isinstance(x, str) or x is None:
        return []
    if isinstance(x, (int, float)):
        return [x]
    if isinstance(x, list):
        return [n for v in x for n in numbers(v)]
    return [n for k in sorted(x) if k not in ("unit", "rate_unit") for n in numbers(x[k])]


class Units(unittest.TestCase):
    def test_absent_unit_adds_nothing(self):
        r = rent_schedule(SCHEDULE)
        self.assertNotIn("unit", r["value"])
        self.assertNotIn("rate_unit", net_effective_rent({"schedule": SCHEDULE})["value"])

    def test_every_unit_gives_square_foot_numbers(self):
        base = rent_schedule(SCHEDULE)["value"]
        ner = net_effective_rent({"schedule": SCHEDULE, "ti_allowance_psf": 50, "discount_rate_annual": 0.08})["value"]
        for unit in LEASE_UNITS:
            r = rent_schedule({**SCHEDULE, "unit": unit})
            self.assertEqual(numbers(r["value"]), numbers(base), unit)
            n = net_effective_rent({"schedule": {**SCHEDULE, "unit": unit}, "ti_allowance_psf": 50,
                                    "discount_rate_annual": 0.08})
            self.assertEqual(numbers(n["value"]), numbers(ner), unit)
            self.assertEqual(n["value"]["rate_unit"], r["value"]["rate_unit"])
            if unit != "sf":
                self.assertTrue(any(w.startswith(f"Unit is {unit}:") for w in r["warnings"]), unit)

    def test_mixed_units_are_an_error(self):
        p = [{"name": "A", "schedule": {**SCHEDULE, "unit": "kw"}}, {"name": "B", "schedule": SCHEDULE}]
        with self.assertRaises(CalcInputError):
            compare_proposals({"proposals": p})


class RentRoll(unittest.TestCase):
    def test_waterfall_foots(self):
        v = multifamily_rent_roll({"as_of": "2026-11-01", "units": [
            {"unit_id": "1", "status": "occupied", "market_rent": 1500, "lease_rent": 1450, "lease_start": "2026-03-01",
             "lease_end": "2027-02-28", "concession": {"type": "weeks_free", "weeks": 6}},
            {"unit_id": "2", "status": "vacant", "market_rent": 1500},
            {"unit_id": "3", "status": "model", "market_rent": 1600},
        ]})["value"]
        w = (v["gross_potential_rent_monthly"] - v["vacancy_loss_monthly"] - v["non_revenue_units_monthly"]
             - v["loss_to_lease_monthly"] - v["concessions_monthly"])
        self.assertEqual(round(w * 100), round(v["effective_rent_income_monthly"] * 100))


class Capex(unittest.TestCase):
    def test_principal_sums_to_cost(self):
        for method in ("straight_line", "level_payment"):
            for cost, years, rate in ((100000, 5, 0.08), (987654.32, 12, 0.065), (1000.01, 3, 0), (50, 30, 0.1)):
                v = capex_recovery({"cost": cost, "amortization_years": years, "interest_rate_annual": rate,
                                    "method": method})["value"]
                self.assertEqual(v["total_principal"], cost)
                self.assertEqual(v["schedule"][-1]["closing_balance"], 0)


BATCH = {
    "year": 2026,
    "expenses": [
        {"category": "taxes", "amount": 300000, "controllable": False},
        {"category": "janitorial", "amount": 120000, "variable": True},
        {"category": "repairs", "amount": 80000},
        {"category": "marketing", "amount": 15000},
    ],
    "gross_up": {"actual_occupancy": 0.82},
    "tenants": [
        {"name": "A", "pro_rata_share": 0.3, "estimates_paid": 50000, "admin_fee": {"rate": 0.12, "capped": True},
         "cap": {"method": "simple_from_base", "rate": 0.05, "reference_amount": 40000, "years_elapsed": 2},
         "excluded_categories": ["marketing"]},
        {"name": "B", "pro_rata_share": 0.45, "structure": {"type": "base_year", "base_year_expenses": 400000},
         "occupancy": {"move_out_date": "2026-06-30"}},
    ],
}


class CamBatch(unittest.TestCase):
    def test_statement_equals_single_tenant(self):
        r = cam_reconciliation_batch(BATCH)["value"]
        single = cam_reconciliation({
            "year": 2026, "pro_rata_share": 0.3, "estimates_paid": 50000, "admin_fee": {"rate": 0.12, "capped": True},
            "cap": BATCH["tenants"][0]["cap"], "gross_up": {"actual_occupancy": 0.82},
            "expenses": [
                {"category": "taxes", "amount": 300000, "controllable": False},
                {"category": "janitorial", "amount": 120000, "variable": True},
                {"category": "repairs", "amount": 80000},
                {"category": "marketing", "amount": 15000, "recoverable": False},
            ],
        })
        self.assertEqual(r["tenants"][0]["statement"], single)
        b = r["building"]
        self.assertEqual(round(sum(x["amount"] for x in b["unrecovered_reasons"]) * 100), round(b["unrecovered"] * 100))

    def test_tenant_error_carries_its_path(self):
        bad = {**BATCH, "tenants": [{"name": "A", "pro_rata_share": 0.3,
                                     "cap": {"method": "simple_from_base", "rate": 0.05, "reference_amount": 1}}]}
        with self.assertRaisesRegex(CalcInputError, r"tenants\.0"):
            cam_reconciliation_batch(bad)


if __name__ == "__main__":
    unittest.main()
