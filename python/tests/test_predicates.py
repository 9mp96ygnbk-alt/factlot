"""The predicate catalog (doc_predicates, spec/schemas/predicates.json, generated from the TypeScript
tables) against this SDK's own checks: every predicate is listed, every example has its predicate's
shape, and this SDK checks each example exactly as the catalog states."""

import re
import unittest

import factlot
from factlot.docverify import coverage
from factlot.ingest.extract import PREDICATES
from factlot.ingest.verify import _CONSISTENCY, check_consistency, check_value
from factlot.predicates import catalog


def _generic(path):
    return re.sub(r"\.\d+(?=\.|$)", "[]", path)


class Catalog(unittest.TestCase):
    def test_every_predicate_is_listed_once(self):
        listed = [p["predicate"] for p in catalog()["predicates"]]
        self.assertEqual(sorted(listed), sorted(PREDICATES))
        self.assertTrue(set(_CONSISTENCY) <= set(listed))
        self.assertEqual(len(set(listed)), len(listed))

    def test_examples_check_as_stated(self):
        for e in catalog()["predicates"]:
            ex = e["example"]
            with self.subTest(predicate=e["predicate"]):
                self.assertIsNone(check_value(e["predicate"], ex["value"]))
                self.assertIsNone(check_consistency(e["predicate"], ex["value"], ex["quote"]))
                cov = coverage(e["predicate"], ex["value"], ex["quote"])
                self.assertEqual([c["path"] for c in cov["checked"]], ex["checked"])
                self.assertEqual(cov["not_checked"], ex["not_checked"])
                self.assertEqual(ex["outcome"], "needs_review" if cov["gaps"] else "verified")
                listed = {r["path"] for k in ("checked", "checked_if_written", "always_review") for r in e[k]}
                for p in ex["checked"] + ex["not_checked"]:
                    self.assertIn(_generic(p), listed)

    def test_doc_verify_facts_agrees(self):
        for e in catalog()["predicates"]:
            ex = e["example"]
            out = factlot.run_tool("doc_verify_facts", {
                "document": {"pages": [ex["quote"]]}, "as_of": "2026-11-06",
                "candidates": [{"predicate": e["predicate"], "value": ex["value"], "quote": ex["quote"], "page": 1}]})
            with self.subTest(predicate=e["predicate"]):
                if ex["outcome"] == "verified":
                    self.assertEqual(len(out["verified"]), 1, out)
                else:
                    self.assertEqual(out["needs_review"][0]["check"], "coverage", out)

    def test_tool_filters(self):
        self.assertEqual([p["predicate"] for p in factlot.run_tool("doc_predicates", {"prefix": "lease.rofo"})["predicates"]],
                         ["lease.rofo"])
        self.assertEqual(factlot.run_tool("doc_predicates", {"predicate": "lease.go_dark", "prefix": "lease."})["error"],
                         "InputError")


if __name__ == "__main__":
    unittest.main()
