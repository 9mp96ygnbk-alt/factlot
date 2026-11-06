"""Ector classification: only stated commercial codes, not undescribed F subclasses."""

import unittest

from factlot.registry.adapters.tx_ector import commercial_code


class EctorCodes(unittest.TestCase):
    def test_known_commercial_codes(self):
        self.assertEqual(commercial_code("F1"), "F1")
        self.assertEqual(commercial_code("f2"), "F2")
        self.assertEqual(commercial_code("B2"), "B")
        self.assertEqual(commercial_code("B1"), "B")

    def test_undescribed_f_codes_are_not_commercial(self):
        self.assertIsNone(commercial_code("F3"))
        self.assertIsNone(commercial_code("F5"))
        self.assertIsNone(commercial_code("A1"))
        self.assertIsNone(commercial_code("M1"))
        self.assertIsNone(commercial_code(""))


if __name__ == "__main__":
    unittest.main()
