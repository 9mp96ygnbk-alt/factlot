"""The Texas protest deadline's status fields (as_of, its default, next_season, notes), as in packages/calc/src/rules.test.ts."""

import unittest
from datetime import datetime, timezone

from factlot.rules import (
    TX_PROTEST_DEADLINE_NOT_COVERED,
    TX_PROTEST_NEXT_SEASON_NOTE,
    texas_today,
    tx_property_tax_protest_deadline,
    tx_property_tax_protest_deadline_batch,
)

NO_NOTICE = ("No notice delivery date given: if the notice was delivered after April 15, the deadline is later than "
             "May 15.")


class TexasToday(unittest.TestCase):
    def test_central_time_with_daylight_saving(self):
        for utc, want in [("2026-01-15T05:59:00", "2026-01-14"), ("2026-01-15T06:00:00", "2026-01-15"),
                          ("2026-05-16T04:59:00", "2026-05-15"), ("2026-05-16T05:00:00", "2026-05-16"),
                          ("2026-03-08T07:59:00", "2026-03-08"), ("2026-03-09T04:30:00", "2026-03-08"),
                          ("2026-11-01T06:30:00", "2026-11-01"), ("2026-11-02T05:30:00", "2026-11-01"),
                          ("2027-01-01T03:00:00", "2026-12-31")]:
            now = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)
            self.assertEqual(texas_today(now), want, utc)

    def test_default_as_of(self):
        r = tx_property_tax_protest_deadline({"tax_year": 2026})
        self.assertEqual(r["value"]["as_of"], texas_today())


class Status(unittest.TestCase):
    def at(self, as_of, **kw):
        return tx_property_tax_protest_deadline({"tax_year": 2026, "as_of": as_of, **kw})

    def test_each_status(self):
        self.assertEqual(self.at("2025-12-31")["value"]["status"], "not_yet_open")
        self.assertEqual(self.at("2025-12-31")["value"]["days_remaining"], 135)
        self.assertEqual(self.at("2026-05-15")["value"]["status"], "open")
        self.assertEqual(self.at("2026-05-15")["value"]["days_remaining"], 0)
        passed = self.at("2026-05-16")["value"]
        self.assertEqual(passed["deadline"], "2026-05-15")
        self.assertEqual(passed["status"], "passed")
        self.assertIsNone(passed["days_remaining"])
        self.assertEqual(passed["next_season"], {"tax_year": 2027, "deadline": "2027-05-17",
                                                 "conservative_file_by": "2027-05-14", "basis": "may_15"})
        self.assertEqual(passed["notes"], [TX_PROTEST_DEADLINE_NOT_COVERED, TX_PROTEST_NEXT_SEASON_NOTE])

    def test_april_15_warning_only_before_the_deadline_passes(self):
        self.assertEqual(self.at("2026-04-01")["warnings"], [NO_NOTICE])
        self.assertEqual(self.at("2026-11-07")["warnings"], [])

    def test_batch(self):
        r = tx_property_tax_protest_deadline_batch({"as_of": "2026-06-10", "items": [
            {"id": "a", "tax_year": 2026, "notice_delivered_date": "2026-05-20"},
            {"id": "b", "tax_year": 2027}, {"id": "c", "tax_year": 2025}]})["value"]
        self.assertEqual(r["as_of"], "2026-06-10")
        self.assertEqual(r["summary"]["by_status"], {"open": 1, "passed": 1, "not_yet_open": 1})
        self.assertEqual([x["status"] for x in r["results"]], ["open", "not_yet_open", "passed"])
        self.assertNotIn("notes", r["results"][0])


if __name__ == "__main__":
    unittest.main()
