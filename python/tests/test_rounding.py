import unittest

from factlot._core import round_


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


if __name__ == "__main__":
    unittest.main()
