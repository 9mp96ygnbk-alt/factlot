"""The customer-documents controls (docs/customer-documents.md) on the SYNTHETIC lease fixtures.

Two promises the policy makes are enforced in code and checked here: a redacted ingest report
carries document text only as the quotes that are evidence, and every report says when a hosted
copy of the source documents is deleted. Expected dates are computed by hand.
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from factlot.ingest import (DEFAULT_RETENTION_DAYS, Candidate, IngestResult, ingest_lease, load_document,
                            redact_report, retain_until, retention_header, review_queue)
from factlot.ingest import __main__ as cli
try:
    from test_ingest import FIX, LEASE_URN  # `unittest discover -s tests`
except ImportError:  # `python -m unittest tests.test_ingest_policy`
    from tests.test_ingest import FIX, LEASE_URN

HALLUCINATED = "Tenant shall have a right of first refusal on Suite 500"  # not in the lease: rejected
DEPOSIT_QUOTE = "a security deposit of $95,000"
# On page 1 of the synthetic lease, cited by no candidate: must never be persisted.
PAGE_TEXT_NOT_QUOTED = "unless sooner terminated"

SCRIPT = {
    "synthetic_lease": [
        Candidate("lease.rentable_area_sf", 12500, "containing 12,500 rentable square feet", 1, "1"),
        Candidate("lease.security_deposit", 95000, DEPOSIT_QUOTE, 2, "3.3"),
        Candidate("lease.security_deposit", 59000, DEPOSIT_QUOTE, 2, "3.3"),  # queued for review
        Candidate("lease.rofr", "Tenant has a ROFR on Suite 500", HALLUCINATED, 3),  # rejected
    ],
    "synthetic_first_amendment": [
        Candidate("lease.rentable_area_sf", 15000, "the Premises shall contain 15,000 rentable square feet", 1, "3"),
    ],
}


class ScriptedExtractor:
    name = "test.scripted"
    version = "1"

    def extract(self, doc):
        return SCRIPT[doc.title]


def run(**kwargs):
    docs = [load_document(FIX / "synthetic_lease.txt"),
            load_document(FIX / "synthetic_first_amendment.txt", role="amendment", effective_date="2030-01-15")]
    assert any(PAGE_TEXT_NOT_QUOTED in p.text for p in docs[0].pages), "fixture changed"
    return ingest_lease(LEASE_URN, docs, ScriptedExtractor(), as_of="2026-11-03", **kwargs)


class Redaction(unittest.TestCase):
    def test_redacted_report_keeps_only_evidence_quotes(self):
        result = run()
        full, redacted = result.to_report(), result.to_report(redact=True)

        # The unredacted report still carries the rejected candidate's quote (useful for debugging
        # an extractor on your own machine).
        self.assertEqual([r["quote"] for r in full["rejected"]], [HALLUCINATED])
        self.assertNotIn("redacted", full)

        # The redacted one does not; everything that is evidence stays.
        self.assertTrue(redacted["redacted"])
        # A rejected candidate's value goes too: it is model output, and a value refused by the
        # shape check can be exactly what the check keeps out (a guarantor's home address).
        self.assertEqual(redacted["rejected"], [{"predicate": "lease.rofr", "page": 3, "check": "quote",
                                                 "reason": full["rejected"][0]["reason"]}])
        self.assertEqual({f["provenance"]["sources"][0]["quote"] for f in redacted["facts"]},
                         {"containing 12,500 rentable square feet", DEPOSIT_QUOTE,
                          "the Premises shall contain 15,000 rentable square feet"})
        self.assertEqual([r["quote"] for r in redacted["review"]], [DEPOSIT_QUOTE])
        for key in ("lease_urn", "as_of", "retention", "documents", "summary", "current", "review"):
            self.assertEqual(redacted[key], full[key], key)

        # Page text that no candidate quoted is in neither report.
        for report in (full, redacted):
            self.assertNotIn(PAGE_TEXT_NOT_QUOTED, json.dumps(report))
        self.assertNotIn(HALLUCINATED, json.dumps(redacted))

    def test_redaction_strips_page_text_wherever_a_document_entry_carries_it(self):
        report = run().to_report()
        report["documents"][0]["text"] = "the whole lease"
        report["documents"][0]["pages"] = [{"number": 1, "ocr": True, "text": "page one"}]
        redacted = redact_report(report)
        self.assertNotIn("text", redacted["documents"][0])
        self.assertEqual(redacted["documents"][0]["pages"], [{"number": 1, "ocr": True}])
        self.assertEqual(report["documents"][0]["text"], "the whole lease")  # the input is not changed

    def test_redacted_report_reads_back_and_keeps_decisions(self):
        result = run()
        redacted = json.loads(json.dumps(result.to_report(redact=True)))
        back = IngestResult.from_report(redacted)
        self.assertEqual(back.to_report(redact=True), redacted)
        self.assertEqual(back.summary(), result.summary())
        self.assertEqual([v.candidate.predicate for v in back.rejected], ["lease.rofr"])
        self.assertEqual(back.rejected[0].candidate.quote, "")
        self.assertEqual([r.id for r in review_queue(back)], [r.id for r in review_queue(result)])


class Retention(unittest.TestCase):
    def test_retain_until_is_as_of_plus_the_policy_default(self):
        self.assertEqual(DEFAULT_RETENTION_DAYS, 30)
        self.assertEqual(retain_until("2026-11-03"), "2026-12-03")
        self.assertEqual(retain_until("2026-12-15", 30), "2027-01-14")
        self.assertEqual(retain_until("2026-11-03", 0), "2026-11-03")
        with self.assertRaises(ValueError):
            retain_until("2026-11-03", -1)
        self.assertEqual(retention_header("2026-11-03"),
                         {"policy": "docs/customer-documents.md", "policy_version": "1", "documents_days": 30,
                          "retain_until": "2026-12-03"})

    def test_report_header_and_round_trip(self):
        report = run().to_report()
        self.assertEqual(report["retention"], retention_header("2026-11-03"))
        self.assertEqual(list(report)[:3], ["lease_urn", "as_of", "retention"])

        short = run(retention_days=7).to_report()
        self.assertEqual(short["retention"]["retain_until"], "2026-11-10")
        back = IngestResult.from_report(json.loads(json.dumps(short)))
        self.assertEqual(back.retention_days, 7)
        self.assertEqual(back.to_report()["retention"], short["retention"])

        # An older report without the header reads back with the default.
        legacy = {k: v for k, v in report.items() if k != "retention"}
        self.assertEqual(IngestResult.from_report(legacy).retention_days, DEFAULT_RETENTION_DAYS)


class Cli(unittest.TestCase):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def extract(self, out, *extra):
        with mock.patch.object(cli, "ClaudeExtractor", lambda model, effort=None: ScriptedExtractor()), \
                mock.patch.object(cli, "date") as today:
            today.today.return_value.isoformat.return_value = "2026-11-03"
            return self.run_cli("--model", "synthetic-model", "--lease", str(FIX / "synthetic_lease.txt"),
                                "--amendment", f"{FIX / 'synthetic_first_amendment.txt'}@2030-01-15",
                                "--out", str(out), *extra)

    def test_prints_retention_and_honours_retain_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "facts.json"
            code, text, _ = self.extract(out)
            self.assertEqual(code, 0)
            shown = json.loads(text)
            self.assertEqual(shown["retention"], retention_header("2026-11-03"))
            self.assertEqual(json.loads(out.read_text())["retention"]["retain_until"], "2026-12-03")

            code, text, _ = self.extract(out, "--retain-days", "0")
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(text)["retention"]["retain_until"], "2026-11-03")

            with self.assertRaises(SystemExit):
                self.extract(out, "--retain-days", "-1")

    def test_redact_flag_writes_a_redacted_file_that_review_still_works_on(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "facts.json"
            code, text, _ = self.extract(out, "--redact")
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(text)["redacted"])
            written = out.read_text()
            self.assertNotIn(HALLUCINATED, written)
            self.assertNotIn(PAGE_TEXT_NOT_QUOTED, written)
            self.assertIn(DEPOSIT_QUOTE, written)  # the review item's evidence

            item = json.loads(written)["review"][0]["id"]
            code, text, _ = self.run_cli("--accept", item, "--by", "A. Reviewer", "--out", str(out), "--redact")
            self.assertEqual(code, 0)
            self.assertIn("decided: accepted by A. Reviewer", text)
            after = json.loads(out.read_text())
            self.assertTrue(after["redacted"])
            self.assertEqual(after["summary"]["review_accepted"], 1)
            self.assertNotIn(HALLUCINATED, out.read_text())


if __name__ == "__main__":
    unittest.main()
