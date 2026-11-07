"""Local codes that must not be treated as commercial real property."""

import unittest

from factlot.registry.adapters.tx_pacs34 import DIMMIT_EXCLUDE, MITCHELL_EXCLUDE, YOAKUM_EXCLUDE


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


if __name__ == "__main__":
    unittest.main()
