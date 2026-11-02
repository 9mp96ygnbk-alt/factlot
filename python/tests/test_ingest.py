"""Lease ingestion tests on SYNTHETIC documents (tests/fixtures/leases) with a scripted extractor.

The scripted extractor stands in for a model so the deterministic parts (verification,
supersession, provenance) are tested exactly; it includes deliberate errors a real model makes.
"""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

import factlot
from factlot.ingest import Candidate, ClaudeExtractor, evaluate, ingest_lease, load_document, verify

FIX = Path(__file__).parent / "fixtures" / "leases"
LEASE_URN = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4"

SCRIPT = {
    "synthetic_lease": [
        Candidate("lease.rentable_area_sf", 12500, "containing 12,500 rentable square feet", 1, "1"),
        Candidate("lease.commencement_date", "2026-03-01", "The Term shall commence on March 1, 2026", 1, "2.1"),
        Candidate("lease.expiration_date", "2031-02-28", "shall expire on February 28, 2031", 1, "2.1"),
        Candidate("lease.base_rent_schedule", [
            {"from": "2026-03-01", "to": "2027-02-28", "annual_rent_psf": 38.0},
            {"from": "2027-03-01", "to": "2028-02-29", "annual_rent_psf": 39.14},
            {"from": "2028-03-01", "to": "2031-02-28", "annual_rent_psf": 40.31}],
            "March 1, 2026 through February 28, 2027: $38.00", 2, "3.1"),
        Candidate("lease.free_rent", {"months": 3, "applies_to": "base_rent"},
                  "Base Rent only shall be abated for the first three (3) full calendar months", 2, "3.2"),
        # wrong page cited (it is on page 2): verifier corrects it
        Candidate("lease.security_deposit", 95000, "a security deposit of $95,000", 3, "3.3"),
        Candidate("lease.pro_rata_share", 0.0825, "Tenant's Share is 8.25%", 2, "4.1"),
        Candidate("lease.cam_cap", {"method": "year_over_year", "rate": 0.05},
                  "shall not increase by more than five percent (5%) per year over the prior year, on a non-cumulative basis",
                  2, "4.2"),
        Candidate("lease.renewal_option", {"count": 1, "term_months": 60, "notice_months": 12, "rent": "95% of FMV"},
                  "Tenant shall have one (1) option to extend the Term for sixty (60) months", 3, "5.1"),
        Candidate("lease.assignment_sublease", "Landlord consent required, not to be unreasonably withheld",
                  "which shall not be unreasonably withheld", 3, "6"),
        # hallucinated: this text is not in the lease
        Candidate("lease.rofr", "Tenant has a ROFR on Suite 500", "Tenant shall have a right of first refusal on Suite 500", 3),
        # malformed value: verifier rejects the shape even though the quote is real
        Candidate("lease.commencement_date", "March 1, 2026", "The Term shall commence on March 1, 2026", 1),
    ],
    "synthetic_first_amendment": [
        Candidate("lease.expiration_date", "2036-02-28", "it shall expire on February 28, 2036", 1, "1"),
        Candidate("lease.rentable_area_sf", 15000, "the Premises shall contain 15,000 rentable square feet", 1, "3"),
        # typographic differences (curly quotes, line breaks) still verify
        Candidate("lease.base_rent_schedule", [{"from": "2031-03-01", "to": "2036-02-28", "annual_rent_psf": 44.0}],
                  "Base Rent shall be $44.00 per rentable\n square foot per year", 1, "2"),
    ],
}


class ScriptedExtractor:
    name = "test.scripted"
    version = "1"

    def extract(self, doc):
        return SCRIPT[doc.title]


def docs():
    return [
        load_document(FIX / "synthetic_first_amendment.txt", role="amendment", effective_date="2030-01-15"),
        load_document(FIX / "synthetic_lease.txt"),  # order given doesn't matter
    ]


class Ingest(unittest.TestCase):
    def setUp(self):
        self.result = ingest_lease(LEASE_URN, docs(), ScriptedExtractor(), as_of="2026-11-02",
                                   rights={"ai_use": "permitted", "redistribution": "prohibited"})

    def test_verification_rejects_and_corrects(self):
        self.assertEqual(self.result.summary(), {"accepted": 13, "current": 10, "rejected": 2, "page_corrected": 1})
        reasons = sorted(v.reason for v in self.result.rejected)
        self.assertEqual(reasons, ["expected YYYY-MM-DD date", "quote not found in the document"])
        deposit = self.result.current["lease.security_deposit"]
        self.assertEqual(deposit["provenance"]["sources"][0]["page"], 2)

    def test_amendments_supersede_with_history(self):
        cur = self.result.current
        self.assertEqual(cur["lease.expiration_date"]["value"], "2036-02-28")
        self.assertEqual(cur["lease.rentable_area_sf"]["value"], 15000)
        self.assertEqual(cur["lease.expiration_date"]["valid_from"], "2030-01-15")
        original = next(f for f in self.result.facts
                        if f["predicate"] == "lease.expiration_date" and f["value"] == "2031-02-28")
        self.assertEqual(cur["lease.expiration_date"]["supersedes"], [original["id"]])
        self.assertEqual(cur["lease.commencement_date"]["value"], "2026-03-01", "unamended terms stay in force")

    def test_every_fact_is_cited_and_valid(self):
        for f in self.result.facts:
            self.assertEqual(factlot.validate_fact(f), {"valid": True, "issues": []})
            src = f["provenance"]["sources"][0]
            self.assertTrue(src["document_id"].startswith("fl:document:sha256-"))
            self.assertIn("quote", src)
            self.assertEqual(f["provenance"]["method"], "extracted")
            self.assertEqual(f["rights"]["redistribution"], "prohibited")

    def test_feeds_the_calculators(self):
        steps = self.result.current["lease.base_rent_schedule"]["value"]
        self.assertEqual(steps[0]["annual_rent_psf"], 44.0, "current schedule is the amendment's extension rent")
        cap = self.result.current["lease.cam_cap"]["value"]
        limit = factlot.cam_reconciliation({
            "year": 2027, "pro_rata_share": self.result.current["lease.pro_rata_share"]["value"],
            "expenses": [{"category": "janitorial", "amount": 500000}],
            "cap": {"method": cap["method"], "rate": cap["rate"], "reference_amount": 40000},
        })["value"]["cap_limit"]
        self.assertEqual(limit, 42000)

    def test_evaluation_against_gold(self):
        gold = {"lease.expiration_date": "2036-02-28", "lease.rentable_area_sf": 15000,
                "lease.security_deposit": 95000, "lease.rofr": None, "lease.exclusive_use": "medical"}
        gold.pop("lease.rofr")
        e = evaluate(self.result, gold)
        self.assertEqual(e["correct"], ["lease.expiration_date", "lease.rentable_area_sf", "lease.security_deposit"])
        self.assertEqual(e["missed"], ["lease.exclusive_use"])
        self.assertEqual(e["recall"], 0.75)

    def test_document_ids_are_content_addressed(self):
        d = load_document(FIX / "synthetic_lease.txt")
        self.assertEqual(d.document_id, factlot.document_id((FIX / "synthetic_lease.txt").read_bytes()).urn)
        self.assertEqual(len(d.pages), 3)


class Verifier(unittest.TestCase):
    def test_short_and_ambiguous_quotes(self):
        d = load_document(FIX / "synthetic_lease.txt")
        self.assertEqual(verify(d, Candidate("lease.rofr", "x", "Tenant", 1)).reason, "quote shorter than 12 characters")
        v = verify(d, Candidate("lease.exclusive_use", "x", "SYNTHETIC TEST DOCUMENT", 1))
        self.assertTrue(v.accepted)
        moved = verify(d, Candidate("lease.exclusive_use", "x", "rentable square foot", 1))
        self.assertEqual((moved.accepted, moved.page, moved.page_corrected), (True, 2, True))
        multi = verify(d, Candidate("lease.exclusive_use", "x", "Tenant shall", 1))  # on pages 2 and 3
        self.assertFalse(multi.accepted)
        self.assertIn("several pages", multi.reason)


class ClaudeExtractorContract(unittest.TestCase):
    """The Claude extractor's request and parsing, against a simulated client (no API call)."""

    def test_request_shape_and_parsing(self):
        sent = {}

        def create(**params):
            sent.update(params)
            text = json.dumps({"facts": [{"predicate": "lease.security_deposit", "value_json": "95000",
                                          "quote": "a security deposit of $95,000", "page": 2, "section": "3.3"}]})
            return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)])

        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        ex = ClaudeExtractor(model="test-model", client=client, effort="high")
        cands = ex.extract(load_document(FIX / "synthetic_lease.txt"))
        self.assertEqual(cands[0].value, 95000)
        self.assertEqual(sent["model"], "test-model")
        self.assertEqual(sent["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(sent["output_config"]["effort"], "high")
        self.assertIn("[Page 2]", sent["messages"][0]["content"])

    def test_refusal_and_truncation_raise(self):
        for reason in ("refusal", "max_tokens"):
            client = SimpleNamespace(messages=SimpleNamespace(
                create=lambda **p: SimpleNamespace(stop_reason=reason, content=[])))
            with self.assertRaises(RuntimeError):
                ClaudeExtractor(model="m", client=client).extract(load_document(FIX / "synthetic_lease.txt"))


if __name__ == "__main__":
    unittest.main()
