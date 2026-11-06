"""The holiday calendar calc_critical_dates rolls deadlines past (critical_dates.test.ts in TypeScript)."""

import unittest

from factlot.critical_dates import us_federal_holidays


class Holidays(unittest.TestCase):
    def test_2026_with_observed_day(self):
        self.assertEqual(sorted(us_federal_holidays(2026)), [
            "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-07-04",
            "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"])
        self.assertEqual(us_federal_holidays(2026)["2026-07-03"], "Independence Day (observed)")
        self.assertNotIn("2020-06-19", us_federal_holidays(2020))


if __name__ == "__main__":
    unittest.main()
