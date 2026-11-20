"""The first full document free (python/src/factlot/free_document.py): the same rule as the TypeScript tool.
The document id of the invented rent roll in fixtures/rentroll/plain_args.json was computed by the TypeScript documentId (SHA-256 of the
canonical JSON of the whole answer), so the two ports agree on what "the same document" means."""

import json
import pathlib
import unittest

from factlot import run_tool
from factlot.exchange import run_with_exchange_caller
from factlot.free_document import document_id

FIX = pathlib.Path(__file__).parent / "fixtures" / "rentroll"
TS_DOCUMENT_ID = "457f8503922ba70fafe2928b9f776e0c0fdf9e02a2581865296718b27a8ac9c4"


class Host:
    def __init__(self):
        self.asked = []

    def use(self, tool, doc_id):
        self.asked.append((tool, doc_id))
        if len(self.asked) == 1:
            return {"granted": True, "covers_until": "2026-11-21T00:00:00.000Z"}
        return {"granted": False, "used_at": "2026-11-20T00:00:00.000Z", "used_tool": tool}


class FreeDocument(unittest.TestCase):
    def args(self):
        return json.loads((FIX / "plain_args.json").read_text())

    def test_document_id_matches_the_typescript_one(self):
        whole = run_tool("rent_roll_certify", self.args())
        self.assertEqual(document_id(whole), TS_DOCUMENT_ID)

    def test_first_whole_with_a_plain_note_then_the_summary(self):
        local = run_tool("rent_roll_certify", self.args())
        host = Host()
        with run_with_exchange_caller(None, full_audit=False, free_document=host):
            first = run_tool("rent_roll_certify", self.args())
            second = run_tool("rent_roll_certify", self.args())
        note = first.pop("free_document")
        self.assertEqual(first, local)
        self.assertTrue(note["free_document"])
        self.assertIn("one free full document", note["note"])
        self.assertIn("Pro or Team", note["note"])
        self.assertTrue(second["limited"])
        self.assertFalse(second["free_document"]["free_document"])
        self.assertIn("already used", second["free_document"]["note"])
        self.assertEqual(host.asked[0], ("rent_roll_certify", TS_DOCUMENT_ID))

    def test_not_asked_for_a_paid_or_local_caller_and_summary_without_a_host(self):
        host = Host()
        with run_with_exchange_caller(None, full_audit=True, free_document=host):
            run_tool("rent_roll_certify", self.args())
        run_tool("rent_roll_certify", self.args())
        self.assertEqual(host.asked, [])
        with run_with_exchange_caller(None, full_audit=False):
            r = run_tool("rent_roll_certify", self.args())
        self.assertTrue(r["limited"])
        self.assertNotIn("free_document", r)
