"""The coverage matrix matches the quote-checked records and the public labels.

These tests do not set a folklore parcel total as a goal. They fail if the
generated matrix, the acceptance rules, or the marked public regions drift.
"""

import unittest
from pathlib import Path

from factlot.registry.acceptance import failures


class RegistryAcceptance(unittest.TestCase):
    def test_matrix_and_public_labels(self):
        found = failures(Path(__file__).resolve().parents[2])
        self.assertEqual(found, [], "\n".join(found))
