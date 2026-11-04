"""scripts/registry/gen_coverage_docs.py builds docs/registry/rights.md and coverage.md.

The generator refuses to run if a count in docs/registry/coverage-data.json is not quoted from the
document it cites, so this test also proves the counts are not invented. It does not require the
committed pages to be current (a new source config would make them stale); run
``python3 scripts/registry/gen_coverage_docs.py --check`` for that.
"""

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_generator():
    spec = importlib.util.spec_from_file_location("gen_coverage_docs", ROOT / "scripts" / "registry" / "gen_coverage_docs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class RegistryDocsGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = load_generator()
        cls.configs = cls.gen.load_configs()

    def test_rights_lists_every_source(self):
        text = self.gen.gen_rights(self.configs)
        for s in self.configs:
            self.assertIn(f"`{s['source_id']}`", text)
        self.assertIn("not legal advice", text)

    def test_coverage_quotes_verify_and_dc_is_the_only_queryable_region(self):
        text = self.gen.gen_coverage(self.configs)  # raises SystemExit if a quote or number does not check out
        self.assertIn("No other region is hosted", text)
        queryable_rows = [ln for ln in text.splitlines() if ln.startswith("| ") and "Yes: the DC registry sample" in ln]
        self.assertTrue(queryable_rows)
        for ln in queryable_rows:
            self.assertIn("dc-", ln)

    def test_an_unquoted_count_is_rejected(self):
        entry = {"source_id": "x", "parcels": 123456789, "cites": [{"doc": "docs/registry/sources/README.md", "quote": "87,717; 56,792"}]}
        with self.assertRaises(SystemExit):
            self.gen.verify_cites(entry, "test")
        bad_quote = {"source_id": "x", "parcels": 1, "cites": [{"doc": "docs/registry/sources/README.md", "quote": "this sentence is not in the document"}]}
        with self.assertRaises(SystemExit):
            self.gen.verify_cites(bad_quote, "test")


if __name__ == "__main__":
    unittest.main()
