"""The ingest review queue, on the SYNTHETIC lease fixtures with a scripted extractor.

Candidates whose quote is on the page but whose value is not written in it, or whose extractor
confidence is below the threshold, wait for a human decision instead of being dropped or
accepted. Every document, value and quote here is invented; expected outcomes are decided by
hand from docs/ingest.md.
"""

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import factlot
from factlot.ingest import (REVIEW_CONFIDENCE_THRESHOLD, Candidate, IngestResult, ReviewItem, decide, ingest_lease,
                            load_document, review_queue)
from factlot.ingest import __main__ as cli
try:
    from test_ingest import FIX, LEASE_URN  # `unittest discover -s tests`
except ImportError:  # `python -m unittest tests.test_ingest_review`
    from tests.test_ingest import FIX, LEASE_URN

DEPOSIT_QUOTE = "a security deposit of $95,000"
AMENDED_EXPIRY_QUOTE = "it shall expire on February 28, 2036"

SCRIPT = {
    "synthetic_lease": [
        # passes outright; its confidence is kept on the fact
        Candidate("lease.rentable_area_sf", 12500, "containing 12,500 rentable square feet", 1, "1", confidence=0.95),
        Candidate("lease.expiration_date", "2031-02-28", "shall expire on February 28, 2031", 1, "2.1"),
        Candidate("lease.security_deposit", 95000, DEPOSIT_QUOTE, 2, "3.3"),
        # real quote, wrong value (transposed digits), and the wrong page too: queued, page corrected
        Candidate("lease.security_deposit", 59000, DEPOSIT_QUOTE, 3, "3.3"),
        # verifies, but the extractor was unsure: queued
        Candidate("lease.pro_rata_share", 0.0825, "Tenant's Share is 8.25%", 2, "4.1", confidence=0.5),
        # the quote is not in the lease: rejected, never queued
        Candidate("lease.rofr", "Tenant has a ROFR on Suite 500", "Tenant shall have a right of first refusal on Suite 500", 3),
        # malformed value: rejected by the shape check, never queued
        Candidate("lease.commencement_date", "March 1, 2026", "The Term shall commence on March 1, 2026", 1),
    ],
    "synthetic_first_amendment": [
        Candidate("lease.rentable_area_sf", 15000, "the Premises shall contain 15,000 rentable square feet", 1, "3"),
        # verifies, low confidence: queued; accepting it must supersede the original expiry
        Candidate("lease.expiration_date", "2036-02-28", AMENDED_EXPIRY_QUOTE, 1, "1", confidence=0.3),
    ],
}


class ScriptedExtractor:
    name = "test.scripted"
    version = "1"

    def __init__(self, script=SCRIPT):
        self.script = script

    def extract(self, doc):
        return self.script[doc.title]


def docs():
    return [load_document(FIX / "synthetic_lease.txt"),
            load_document(FIX / "synthetic_first_amendment.txt", role="amendment", effective_date="2030-01-15")]


def run(extractor=None, review=None, **kw):
    return ingest_lease(LEASE_URN, docs(), extractor or ScriptedExtractor(), as_of="2026-11-03", review=review, **kw)


def by_predicate(items):
    return {(r.candidate.predicate, r.candidate.value): r for r in items}


class Queue(unittest.TestCase):
    def setUp(self):
        self.result = run()

    def test_what_is_queued_and_what_is_rejected(self):
        self.assertEqual(self.result.summary(), {"accepted": 4, "current": 3, "rejected": 2, "page_corrected": 1,
                                                 "review_pending": 3, "review_accepted": 0, "review_rejected": 0})
        self.assertEqual(sorted(v.check for v in self.result.rejected), ["quote", "value"])
        q = by_predicate(review_queue(self.result))
        deposit = q[("lease.security_deposit", 59000)]
        self.assertEqual((deposit.check, deposit.reason), ("consistency", "value 59000 not found in quote"))
        self.assertEqual((deposit.page, deposit.quote, deposit.title), (2, DEPOSIT_QUOTE, "synthetic_lease"))
        self.assertEqual(deposit.candidate.section, "3.3")
        share = q[("lease.pro_rata_share", 0.0825)]
        self.assertEqual(share.check, "confidence")
        self.assertEqual(share.reason, f"extractor confidence 0.5 is below {REVIEW_CONFIDENCE_THRESHOLD}")
        expiry = q[("lease.expiration_date", "2036-02-28")]
        self.assertEqual((expiry.title, expiry.effective_date), ("synthetic_first_amendment", "2030-01-15"))
        for item in self.result.review:
            self.assertTrue(item.id.startswith("rv_"), item.id)
            self.assertEqual(item.status, "pending")
        self.assertNotIn("lease.pro_rata_share", self.result.current, "a queued candidate is not a fact")
        self.assertEqual(self.result.current["lease.expiration_date"]["value"], "2031-02-28")
        area = self.result.facts[0]
        self.assertEqual((area["predicate"], area["provenance"]["confidence"]), ("lease.rentable_area_sf", 0.95))

    def test_threshold_is_configurable(self):
        low = run(confidence_threshold=0.5)
        self.assertEqual(low.summary()["review_pending"], 2, "0.5 is not below 0.5; 0.3 still is")
        self.assertEqual(low.current["lease.pro_rata_share"]["provenance"]["confidence"], 0.5)
        none = run(confidence_threshold=0)
        self.assertEqual(none.summary()["review_pending"], 1, "only the consistency failure is left")

    def test_accept_makes_a_reviewed_fact_with_supersession(self):
        q = by_predicate(review_queue(self.result))
        item = decide(self.result, q[("lease.expiration_date", "2036-02-28")].id, True, " Alice Reviewer ",
                      now="2026-11-03T10:00:00+00:00")
        self.assertEqual((item.status, item.decided_by, item.decided_at),
                         ("accepted", "Alice Reviewer", "2026-11-03T10:00:00+00:00"))
        self.assertEqual(review_queue(self.result, "accepted"), [item])
        fact = self.result.current["lease.expiration_date"]
        self.assertEqual(fact["value"], "2036-02-28")
        self.assertEqual(fact["valid_from"], "2030-01-15")
        prov = fact["provenance"]
        self.assertEqual(prov["method"], "extracted")
        self.assertEqual(prov["confidence"], 0.3)
        self.assertEqual(prov["verified_by"], f"Alice Reviewer (accepted in ingest review {item.id} after failing the "
                                              f"confidence check: extractor confidence 0.3 is below 0.8)")
        self.assertEqual(prov["verified_at"], "2026-11-03T10:00:00+00:00")
        self.assertEqual(prov["sources"][0], {"document_id": self.result.documents[1]["document_id"],
                                              "title": "synthetic_first_amendment", "page": 1,
                                              "quote": AMENDED_EXPIRY_QUOTE, "section": "1"})
        original = next(f for f in self.result.facts if f["predicate"] == "lease.expiration_date"
                        and f["value"] == "2031-02-28")
        self.assertEqual(fact["supersedes"], [original["id"]])
        self.assertEqual(factlot.validate_fact(fact), {"valid": True, "issues": []})
        self.assertEqual(self.result.summary()["accepted"], 5)
        self.assertEqual(self.result.summary()["review_accepted"], 1)

    def test_accept_of_an_earlier_instrument_does_not_displace_a_later_one(self):
        # the lease's share is accepted after the run; nothing later states it, so it becomes current
        q = by_predicate(review_queue(self.result))
        decide(self.result, q[("lease.pro_rata_share", 0.0825)].id, True, "bob")
        self.assertEqual(self.result.current["lease.pro_rata_share"]["value"], 0.0825)
        self.assertNotIn("supersedes", self.result.current["lease.pro_rata_share"])
        # a reviewed original-lease fact for a term the amendment restates stays superseded
        script = copy.deepcopy(SCRIPT)
        script["synthetic_lease"].append(Candidate("lease.rentable_area_sf", 12500,
                                                   "containing 12,500 rentable square feet", 1, "1", confidence=0.1))
        script["synthetic_lease"].pop(0)  # so the low-confidence one is the only lease-level area candidate
        r = run(ScriptedExtractor(script))
        self.assertEqual(r.current["lease.rentable_area_sf"]["value"], 15000)
        item = by_predicate(review_queue(r))[("lease.rentable_area_sf", 12500)]
        decide(r, item.id, True, "bob")
        current = r.current["lease.rentable_area_sf"]
        self.assertEqual(current["value"], 15000, "the amendment's fact stays current")
        reviewed = next(f for f in r.facts if f["predicate"] == "lease.rentable_area_sf" and f["value"] == 12500)
        self.assertEqual(current["supersedes"], [reviewed["id"]])
        self.assertIn("bob (accepted in ingest review", reviewed["provenance"]["verified_by"])

    def test_reject_records_the_decision_only(self):
        q = by_predicate(review_queue(self.result))
        item = decide(self.result, q[("lease.security_deposit", 59000)].id, False, "Bob")
        self.assertEqual((item.status, item.decided_by), ("rejected", "Bob"))
        self.assertIsNotNone(item.decided_at)
        self.assertEqual(self.result.current["lease.security_deposit"]["value"], 95000)
        self.assertEqual(self.result.summary()["accepted"], 4)
        self.assertEqual(self.result.summary()["review_rejected"], 1)
        self.assertEqual(review_queue(self.result, "rejected"), [item])
        self.assertEqual(len(review_queue(self.result)), 2)

    def test_decisions_are_final_and_named(self):
        item = review_queue(self.result)[0]
        with self.assertRaises(ValueError):
            decide(self.result, item.id, True, "  ")
        with self.assertRaises(ValueError):
            decide(self.result, "rv_nope", True, "alice")
        decide(self.result, item.id, False, "alice")
        with self.assertRaises(ValueError) as cm:
            decide(self.result, item.id, True, "alice")
        self.assertIn("already rejected", str(cm.exception))


class Persistence(unittest.TestCase):
    """Decisions survive a re-run (through the JSON report) and re-running changes nothing."""

    def decided(self):
        first = run()
        q = by_predicate(review_queue(first))
        decide(first, q[("lease.expiration_date", "2036-02-28")].id, True, "alice", now="2026-11-03T10:00:00+00:00")
        decide(first, q[("lease.security_deposit", 59000)].id, False, "bob", now="2026-11-03T10:01:00+00:00")
        return first

    def test_report_round_trips(self):
        first = self.decided()
        report = json.loads(json.dumps(first.to_report()))
        back = IngestResult.from_report(report)
        self.assertEqual(back.to_report(), report)
        self.assertEqual([r.to_dict() for r in back.review], [r.to_dict() for r in first.review])
        self.assertEqual(back.summary(), first.summary())
        self.assertEqual({v.check for v in back.rejected}, {"quote", "value"})

    def test_rerun_with_decisions_is_idempotent(self):
        first = self.decided()
        reloaded = IngestResult.from_report(json.loads(json.dumps(first.to_report())))
        second = run(review=reloaded.review)
        self.assertEqual(second.summary(), first.summary())
        self.assertEqual(second.summary(), {"accepted": 5, "current": 3, "rejected": 2, "page_corrected": 1,
                                            "review_pending": 1, "review_accepted": 1, "review_rejected": 1})
        self.assertEqual([r.to_dict() for r in second.review], [r.to_dict() for r in first.review],
                         "same IDs, statuses and decisions")
        self.assertEqual({f["id"] for f in second.facts}, {f["id"] for f in first.facts})
        expiry = second.current["lease.expiration_date"]
        self.assertEqual(expiry["value"], "2036-02-28")
        self.assertIn("alice (accepted in ingest review", expiry["provenance"]["verified_by"])
        self.assertEqual(expiry["provenance"]["verified_at"], "2026-11-03T10:00:00+00:00")
        self.assertEqual(second.to_report(), first.to_report())
        third = run(review=second.review)
        self.assertEqual(third.to_report(), second.to_report())

    def test_rejected_pair_is_never_requeued(self):
        first = self.decided()
        rejected = review_queue(first, "rejected")[0]
        # the same candidate again, and a different wrong value with the same (predicate, quote)
        script = copy.deepcopy(SCRIPT)
        script["synthetic_lease"].append(Candidate("lease.security_deposit", 9500, DEPOSIT_QUOTE, 2, "3.3"))
        second = run(ScriptedExtractor(script), review=first.review)
        pending = by_predicate(review_queue(second))
        self.assertNotIn(("lease.security_deposit", 59000), pending)
        self.assertNotIn(("lease.security_deposit", 9500), pending)
        self.assertEqual(len(second.review), 3, "the rejected item is kept as a record, not duplicated")
        self.assertEqual(second.review_item(rejected.id).status, "rejected")
        self.assertEqual(second.current["lease.security_deposit"]["value"], 95000,
                         "the consistent candidate with that quote is unaffected")

    def test_a_rejection_holds_when_the_extractor_becomes_confident(self):
        first = run()
        share = by_predicate(review_queue(first))[("lease.pro_rata_share", 0.0825)]
        decide(first, share.id, False, "bob")
        script = copy.deepcopy(SCRIPT)
        c = script["synthetic_lease"][4]
        script["synthetic_lease"][4] = Candidate(c.predicate, c.value, c.quote, c.page, c.section, confidence=0.99)
        for second in (run(ScriptedExtractor(script), review=first.review),
                       run(review=first.review, confidence_threshold=0.1)):
            self.assertNotIn("lease.pro_rata_share", second.current)
            self.assertEqual(second.review_item(share.id).status, "rejected")

    def test_two_values_for_one_quote_cannot_both_be_accepted(self):
        script = copy.deepcopy(SCRIPT)
        script["synthetic_lease"].append(Candidate("lease.pro_rata_share", 0.825, "Tenant's Share is 8.25%", 2, "4.1"))
        first = run(ScriptedExtractor(script))
        q = by_predicate(review_queue(first))
        decide(first, q[("lease.pro_rata_share", 0.0825)].id, True, "alice")
        with self.assertRaisesRegex(ValueError, "same predicate and quote was already accepted"):
            decide(first, q[("lease.pro_rata_share", 0.825)].id, True, "alice")
        self.assertEqual(review_queue(first, "pending").count(q[("lease.pro_rata_share", 0.825)]), 1,
                         "the refused item is still pending, to be rejected")

    def test_accepted_fact_stands_when_the_candidate_does_not_reappear(self):
        first = self.decided()
        script = copy.deepcopy(SCRIPT)
        script["synthetic_first_amendment"].pop()  # the model no longer returns the amended expiry
        second = run(ScriptedExtractor(script), review=first.review)
        self.assertEqual(second.current["lease.expiration_date"]["value"], "2036-02-28")
        self.assertIn("alice", second.current["lease.expiration_date"]["provenance"]["verified_by"])
        self.assertEqual(second.summary()["review_accepted"], 1)

    def test_pending_item_is_dropped_when_the_candidate_verifies_on_its_own(self):
        first = run()
        script = copy.deepcopy(SCRIPT)
        share = script["synthetic_lease"][4]
        script["synthetic_lease"][4] = Candidate(share.predicate, share.value, share.quote, share.page, share.section,
                                                 confidence=0.9)
        second = run(ScriptedExtractor(script), review=first.review)
        self.assertNotIn(("lease.pro_rata_share", 0.0825), by_predicate(review_queue(second)))
        self.assertEqual(second.current["lease.pro_rata_share"]["provenance"]["confidence"], 0.9)
        self.assertEqual(second.summary()["review_pending"], 2)

    def test_review_items_are_plain_records(self):
        item = review_queue(run())[0]
        d = item.to_dict()
        self.assertEqual(set(d), {"id", "status", "check", "reason", "predicate", "value", "quote", "page",
                                  "document_id", "title", "section"})
        self.assertEqual(ReviewItem.from_dict(d).to_dict(), d)
        with self.assertRaises(ValueError):
            ReviewItem.from_dict(d | {"status": "maybe"})


class Cli(unittest.TestCase):
    """--review / --accept / --reject operate on the output file without a model call; a later
    extraction with the same --out keeps the decisions."""

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def extract(self, tmp, *extra):
        with mock.patch.object(cli, "ClaudeExtractor", lambda model, effort=None: ScriptedExtractor()):
            return self.run_cli("--model", "synthetic-model", "--lease", str(FIX / "synthetic_lease.txt"),
                                "--amendment", f"{FIX / 'synthetic_first_amendment.txt'}@2030-01-15",
                                "--out", str(Path(tmp) / "facts.json"), *extra)

    def test_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "facts.json"
            code, text, _ = self.extract(tmp)
            self.assertEqual(code, 0)
            self.assertIn("3 item(s) wait for a decision: --review", text)
            report = json.loads(out.read_text())
            self.assertEqual(report["summary"]["review_pending"], 3)
            self.assertEqual(len(report["review"]), 3)
            urn = report["lease_urn"]

            code, text, _ = self.run_cli("--review", "--out", str(out))
            self.assertEqual(code, 0)
            items = {r["predicate"]: r for r in report["review"]}
            for r in items.values():
                self.assertIn(r["id"], text)
            self.assertIn("failed:  consistency (value 59000 not found in quote)", text)
            self.assertIn("cited:   synthetic_lease, page 2, section 3.3", text)

            deposit, expiry = items["lease.security_deposit"]["id"], items["lease.expiration_date"]["id"]
            code, text, _ = self.run_cli("--reject", deposit, "--by", "Bob", "--out", str(out))
            self.assertEqual(code, 0)
            self.assertIn("decided: rejected by Bob", text)
            code, text, _ = self.run_cli("--accept", expiry, "--by", "Alice", "--out", str(out))
            self.assertEqual(code, 0)
            self.assertIn("decided: accepted by Alice", text)
            self.assertIn("(current)", text)
            report = json.loads(out.read_text())
            self.assertEqual(report["current"]["lease.expiration_date"]["value"], "2036-02-28")
            self.assertIn("Alice (accepted in ingest review", report["current"]["lease.expiration_date"]["provenance"]["verified_by"])
            self.assertEqual(report["summary"], {"accepted": 5, "current": 3, "rejected": 2, "page_corrected": 1,
                                                 "review_pending": 1, "review_accepted": 1, "review_rejected": 1})

            # decisions are final
            code, _, err = self.run_cli("--accept", deposit, "--by", "Alice", "--out", str(out))
            self.assertEqual(code, 2)
            self.assertIn("already rejected", err)

            # a second extraction into the same file keeps the decisions and the lease URN
            code, _, _ = self.extract(tmp)
            self.assertEqual(code, 0)
            again = json.loads(out.read_text())
            self.assertEqual(again["lease_urn"], urn)
            self.assertEqual(again["summary"], report["summary"])
            self.assertEqual(again["review"], report["review"])
            self.assertEqual(again["facts"], report["facts"])

    def test_flags_need_a_file_and_a_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "none.json"
            code, _, err = self.run_cli("--review", "--out", str(out))
            self.assertEqual(code, 2)
            self.assertIn("does not exist", err)
            self.extract(tmp)
            with self.assertRaises(SystemExit):
                self.run_cli("--accept", "rv_x", "--out", str(Path(tmp) / "facts.json"))  # no --by
            with self.assertRaises(SystemExit):
                self.run_cli("--review", "--lease", "x.txt", "--out", str(Path(tmp) / "facts.json"))
            code, _, err = self.run_cli("--reject", "rv_nope", "--by", "x", "--out", str(Path(tmp) / "facts.json"))
            self.assertEqual(code, 2)
            self.assertIn("no review item rv_nope", err)

    def test_amendment_date_is_checked_before_any_model_call(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(cli, "ClaudeExtractor", side_effect=AssertionError("no model call")):
            for bad in ("2030-1-15", "2030-02-30", "Jan 15 2030"):
                with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                    cli.main(["--model", "m", "--lease", str(FIX / "synthetic_lease.txt"),
                              "--amendment", f"{FIX / 'synthetic_first_amendment.txt'}@{bad}",
                              "--out", str(Path(tmp) / "facts.json")])

    def test_a_decision_on_a_redacted_file_keeps_it_redacted(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "facts.json"
            self.extract(tmp, "--redact")
            item = json.loads(out.read_text())["review"][0]["id"]
            code, _, _ = self.run_cli("--reject", item, "--by", "Bob", "--out", str(out))  # no --redact this time
            self.assertEqual(code, 0)
            self.assertIs(json.loads(out.read_text()).get("redacted"), True)


if __name__ == "__main__":
    unittest.main()
