"""Unit tests for run.py. ALL DATA HERE IS SYNTHETIC: made-up text written for these tests, not
lease text from any filing."""
import unittest

import run

SYNTHETIC_PAGES = [
    "SYNTHETIC TEST DOCUMENT - NOT A REAL LEASE\nThe Premises contain 10,000 rentable square feet.",
    "SYNTHETIC. The Term expires on March 31, 2030.\nThe security deposit is $50,000.",
]


class Wilson(unittest.TestCase):
    def test_known_values(self):
        lo, hi = run.wilson(8, 10)
        self.assertAlmostEqual(lo, 0.4902, places=3)
        self.assertAlmostEqual(hi, 0.9433, places=3)
        lo, hi = run.wilson(0, 10)
        self.assertEqual(lo, 0.0)
        self.assertAlmostEqual(hi, 0.2775, places=3)
        self.assertIsNone(run.wilson(0, 0))


class Matching(unittest.TestCase):
    def test_values(self):
        self.assertTrue(run.values_match("lease.rentable_area_sf", 10000, 10000.0))
        self.assertFalse(run.values_match("lease.rentable_area_sf", 10001, 10000))
        self.assertTrue(run.values_match("lease.tenant", "Synthetic  Co., Inc.", "synthetic co., inc."))
        self.assertTrue(run.values_match("lease.renewal_option",
                                         {"count": 1, "term_months": 60, "notice_months": 9, "rent": "FMV"},
                                         {"count": 1, "term_months": 60, "notice_months": 9, "rent": "95% of fair market"}))
        self.assertFalse(run.values_match("lease.cam_cap", {"method": "year_over_year", "rate": 0.05},
                                          {"method": "compounding_from_base", "rate": 0.05}))

    def test_classify(self):
        labels = [{"predicate": "lease.expiration_date", "value": "2030-03-31"}]
        cands = [{"predicate": "lease.expiration_date", "value": "2030-03-31"},
                 {"predicate": "lease.expiration_date", "value": "2031-03-31"},
                 {"predicate": "lease.security_deposit", "value": 50000},
                 {"predicate": "lease.rofr", "value": "x"}]
        self.assertEqual(run.classify(cands, labels), ["correct", "wrong", "unlabeled", "summary"])


class HarnessFixes(unittest.TestCase):
    def test_boolean_is_not_a_number(self):
        self.assertFalse(run.values_match("lease.rentable_area_sf", True, 1))
        self.assertFalse(run.values_match("lease.rentable_area_sf", 1, True))
        self.assertTrue(run.values_match("x.flag", True, True))

    def test_empty_document_counts_toward_coverage(self):
        labels = [{"predicate": "lease.expiration_date", "value": "2030-03-31"}]
        s = run.score({"S1": {"labels": labels, "candidates": [], "outcomes": []}})
        self.assertEqual((s["coverage"]["k"], s["coverage"]["n"]), (0, 1))
        self.assertEqual(s["coverage_detail"]["in_documents_with_no_candidates"], 1)
        self.assertEqual(s["coverage_without_empty_documents"]["n"], 0)

    def test_descriptor_sensitivity(self):
        c, lab = "Synthetic Co., Inc., a Delaware corporation", "SYNTHETIC CO., INC."
        self.assertFalse(run.values_match("lease.tenant", c, lab))
        self.assertTrue(run.values_match("lease.tenant", c, lab, strip_descriptors=True))
        self.assertTrue(run.values_match("lease.landlord", "Synth LLC, a Delaware limited liability company",
                                         "Synth LLC", strip_descriptors=True))
        self.assertFalse(run.values_match("lease.landlord", "Other LLC, a Delaware limited liability company",
                                          "Synth LLC", strip_descriptors=True))

    def test_quote_plants_are_seeded(self):
        cands = {"S1": [{"predicate": "lease.rentable_area_sf", "value": 10000,
                         "quote": "contain 10,000 rentable square feet", "page": 1}]}
        labels = {"S1": [{"predicate": "lease.rentable_area_sf", "value": 10000}]}
        a = run.build_quote_plants(cands, labels, 7)
        self.assertEqual(a, run.build_quote_plants(cands, labels, 7))
        self.assertEqual(len(a), 1)
        copy = run.apply_plant(cands["S1"][0], a[0])
        self.assertNotEqual(copy["quote"], cands["S1"][0]["quote"])
        self.assertEqual(copy["value"], 10000)
        self.assertEqual(sum(x != y for x, y in zip(copy["quote"], cands["S1"][0]["quote"])), 1)

    def test_value_plant_error_type(self):
        cands = {"S1": [{"predicate": "lease.rentable_area_sf", "value": 10000,
                         "quote": "contain 10,000 rentable square feet", "page": 1}]}
        labels = {"S1": [{"predicate": "lease.rentable_area_sf", "value": 10000}]}
        (r,) = run.build_value_plants(cands, labels)
        self.assertEqual((r["planted_part"], r["error_type"], r["leaf_kind"]), (11000, "number_in_quote", "integer_ge_100"))


class Planting(unittest.TestCase):
    def test_alterations(self):
        self.assertEqual(run.plant_error("lease.expiration_date", "2030-03-31"), ("2030-04-01", "value"))
        self.assertEqual(run.plant_error("lease.rentable_area_sf", 10000), (11000, "value"))
        self.assertEqual(run.plant_error("lease.pro_rata_share", 0.125), (0.135, "value"))
        self.assertEqual(run.plant_error("lease.renewal_option", {"count": 2, "term_months": 60})[1], "value.count")
        sched = [{"from": "2025-01-01", "to": "2025-12-31", "annual_rent_psf": 30}]
        new, path = run.plant_error("lease.base_rent_schedule", sched)
        self.assertEqual(path, "value[0].from")
        self.assertEqual(new[0]["from"], "2025-01-02")
        self.assertIsNone(run.plant_error("lease.rofr", "summary"))
        self.assertIsNone(run.plant_error("lease.landlord", "Synthetic Co."))


class Splitting(unittest.TestCase):
    def test_html_breaks(self):
        html = (b"<html><body><p>SYNTHETIC page one</p><p style='page-break-before:always'>page two</p>"
                b"<hr><p>page &amp; three</p></body></html>")
        self.assertEqual(run.split_pages(html, ".htm"), ["SYNTHETIC page one", "page two", "page & three"])

    def test_text_and_fallback(self):
        self.assertEqual(run.split_pages(b"a\fb<PAGE>c", ".txt"), ["a", "b", "c"])
        long = ("SYNTHETIC paragraph. " * 50 + "\n\n") * 20
        pages = run.split_pages(long.encode(), ".txt")
        self.assertGreater(len(pages), 2)
        self.assertTrue(all(len(p) <= 4100 for p in pages))


class EndToEndSynthetic(unittest.TestCase):
    def test_score_with_real_verifier(self):
        labels = [{"predicate": "lease.rentable_area_sf", "value": 10000},
                  {"predicate": "lease.expiration_date", "value": "2030-03-31"},
                  {"predicate": "lease.security_deposit", "value": 50000}]
        cands = [
            {"predicate": "lease.rentable_area_sf", "value": 10000, "quote": "contain 10,000 rentable square feet", "page": 1},
            {"predicate": "lease.expiration_date", "value": "2030-03-30", "quote": "The Term expires on March 31, 2030.", "page": 2},
            {"predicate": "lease.security_deposit", "value": 50000, "quote": "deposit is $50,000 exactly", "page": 2},
        ]
        res = run._verify(SYNTHETIC_PAGES, cands)
        outs = run.outcomes(res, 3)
        self.assertEqual(outs, ["verified", "needs_review", "rejected"])
        s = run.score({"S1": {"labels": labels, "candidates": cands, "outcomes": outs,
                              "planted": [{"outcome": "needs_review", "original_outcome": "verified"}]}})
        self.assertEqual(s["precision_of_verified"]["k"], 1)
        self.assertEqual(s["precision_of_verified"]["n"], 1)
        self.assertEqual((s["catch_rate"]["k"], s["catch_rate"]["n"]), (1, 1))
        self.assertEqual((s["false_rejection_rate"]["k"], s["false_rejection_rate"]["n"]), (1, 2))
        self.assertEqual((s["coverage"]["k"], s["coverage"]["n"]), (1, 3))
        self.assertEqual((s["planted_catch_rate"]["k"], s["planted_catch_rate"]["n"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
