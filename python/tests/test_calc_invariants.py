"""Properties the shared vectors cannot express: schedules that foot, and output shapes kept stable."""

import random
import unittest

from factlot.calc import compare_proposals, debt_sizing, lease_remeasurement_asc842


def cents(x):
    return round(x * 100)


class Asc842Footing(unittest.TestCase):
    def test_every_row_rolls_forward_and_totals_foot(self):
        rng = random.Random(7)
        for c in range(300):
            n = rng.randint(1, 120)
            payments = [{"period": k, "amount": round(rng.uniform(0, 90_000), 2)} for k in range(1, n + 1) if rng.random() < 0.85]
            payments = payments or [{"period": n, "amount": 1000}]
            v = lease_remeasurement_asc842({
                "classification": rng.choice(["operating", "finance"]),
                "payments": payments,
                "remaining_periods": n,
                "payment_timing": rng.choice(["begin", "end"]),
                "discount_rate_annual": 0 if rng.random() < 0.1 else round(rng.uniform(0, 0.15), 4),
                "periods_per_year": rng.choice([12, 4, 1]),
                "discount_rate_updated": True,
                "liability_before": round(rng.uniform(0, 3e6), 2),
                "rou_asset_before": round(rng.uniform(0, 3e6), 2),
                "event": "modification_extend_term",
            })["value"]
            liability, rou = cents(v["new_lease_liability"]), cents(v["new_rou_asset"])
            interest = amort = cost = 0
            for row in v["schedule"]:
                self.assertEqual(cents(row["opening_liability"]), liability)
                liability = cents(row["opening_liability"]) - cents(row["payment"]) + cents(row["interest"])
                self.assertEqual(cents(row["closing_liability"]), liability, c)
                rou -= cents(row["amortization"])
                self.assertEqual(cents(row["closing_rou_asset"]), rou, c)
                interest += cents(row["interest"])
                amort += cents(row["amortization"])
                cost += cents(row["lease_cost"])
            self.assertEqual((liability, rou), (0, 0))
            self.assertEqual(cents(v["total_interest"]), interest)
            self.assertEqual(cents(v["total_amortization"]), amort)
            self.assertEqual(cents(v["total_lease_cost"]), cost)


class StableShapes(unittest.TestCase):
    def test_debt_sizing_without_stress_keeps_the_v2_keys(self):
        v = debt_sizing({"noi": 1_000_000, "value": 15_000_000, "rate_annual": 0.06, "amortization_years": 30, "max_ltv": 0.65})["value"]
        self.assertEqual(sorted(v), ["annual_constant", "annual_debt_service", "binding_constraint", "loan_by_constraint",
                                     "max_loan", "resulting"])

    def test_compare_proposals_states_its_discounting(self):
        sched = {"commencement_date": "2027-01-01", "term_months": 60, "area_sf": 5000, "starting_rent_psf_annual": 30}
        r = compare_proposals({"proposals": [{"name": "A", "schedule": sched}, {"name": "B", "schedule": sched}]})
        step = next(s for s in r["steps"] if s["label"] == "Discounting")
        self.assertIn("start of each month", step["value"])


if __name__ == "__main__":
    unittest.main()
