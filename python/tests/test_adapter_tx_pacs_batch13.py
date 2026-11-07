"""Local codes that must not be treated as commercial real property."""

import unittest

from factlot.registry.adapters.tx_pacs34 import (
    DIMMIT_EXCLUDE, KIMBLE_EXCLUDE, MITCHELL_EXCLUDE, SHACKELFORD_EXCLUDE, YOAKUM_EXCLUDE,
)


class Batch13Exclusions(unittest.TestCase):
    def test_mineral_and_improvement_only_codes_are_excluded(self):
        self.assertEqual(MITCHELL_EXCLUDE, frozenset({"F3", "F4"}))
        self.assertEqual(DIMMIT_EXCLUDE, frozenset({"F3"}))
        self.assertEqual(YOAKUM_EXCLUDE, frozenset({"F3", "F4"}))
        self.assertNotIn("F1", MITCHELL_EXCLUDE)
        self.assertNotIn("F2", MITCHELL_EXCLUDE)
        self.assertNotIn("F2", DIMMIT_EXCLUDE)
        self.assertNotIn("F1L", DIMMIT_EXCLUDE)
        self.assertNotIn("F2L", DIMMIT_EXCLUDE)
        self.assertNotIn("F4", DIMMIT_EXCLUDE)
        self.assertNotIn("F2", YOAKUM_EXCLUDE)
        self.assertNotIn("F1", YOAKUM_EXCLUDE)

    def test_kimble_keeps_improvement_only_ids_and_drops_conversion_codes(self):
        self.assertNotIn("F3", KIMBLE_EXCLUDE)
        self.assertNotIn("F4", KIMBLE_EXCLUDE)
        self.assertNotIn("C2", KIMBLE_EXCLUDE)
        self.assertNotIn("F1", KIMBLE_EXCLUDE)
        self.assertIn("2 N", KIMBLE_EXCLUDE)
        self.assertIn("L2A", KIMBLE_EXCLUDE)

    def test_shackelford_does_not_treat_vacant_lots_as_commercial(self):
        self.assertNotIn("C1C", SHACKELFORD_EXCLUDE)
        self.assertNotIn("C2", SHACKELFORD_EXCLUDE)
        self.assertNotIn("F1", SHACKELFORD_EXCLUDE)
        self.assertNotIn("F2", SHACKELFORD_EXCLUDE)
        self.assertNotIn("B1", SHACKELFORD_EXCLUDE)
        for code in ("EX1", "EX8", "G1", "G2", "G3", "L2A", "L4"):
            self.assertIn(code, SHACKELFORD_EXCLUDE)


if __name__ == "__main__":
    unittest.main()
