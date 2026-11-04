import unittest

import factlot
from factlot._core import fmt_num, round_


class Rounding(unittest.TestCase):
    def test_matches_typescript_round(self):
        cases = [
            ((95.58 * 245051) / 12, 2, 1951831.22),
            (0.1 + 0.2, 1, 0.3),
            (2.675, 2, 2.68),
            (-2.675, 2, -2.68),
            (1.5e-7, 2, 0),
            (0.000155, 4, 0.0002),
            (9.995, 2, 10),
            (123456789.125, 2, 123456789.13),
            (1234.5, 0, 1235),
            (1.005, 2, 1.01),
            (-1.005, 2, -1.01),
        ]
        for x, dp, expected in cases:
            with self.subTest(x=x, dp=dp):
                self.assertEqual(round_(x, dp), expected)
        self.assertEqual(str(round_(-0.001)), "0.0")

    def test_step_formula_numbers_read_like_typescript(self):
        self.assertEqual(fmt_num(0.07310737913780618), "0.073107")
        self.assertEqual(fmt_num(0.065), "0.065")
        self.assertEqual(fmt_num(12), "12")
        self.assertEqual(fmt_num(-0.0000001), "0")
        self.assertEqual(fmt_num(0.00004166666, 8), "0.00004167")
        f = 0.07310737913780618
        r = factlot.percentage_rent({"gross_sales": 2_000_000, "rate": 0.06, "base_rent_annual": 120_000,
                                     "period_fraction": f})
        step = next(s for s in r["steps"] if s["label"] == "Natural breakpoint")
        self.assertEqual(step["formula"], "$120,000.00 ÷ 6% × 0.073107")
        self.assertEqual(step["value"], round_((120_000 / 0.06) * f, 2))


if __name__ == "__main__":
    unittest.main()
