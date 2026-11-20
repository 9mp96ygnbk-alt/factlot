"""fact_package_send and fact_package_status against a fake exchange (no network). Mirrors
packages/tools/src/exchange.test.ts. Every party and document is invented."""

import copy
import json
import unittest

import factlot
from factlot import (
    ExchangeUnavailable,
    configure_exchange,
    run_tool,
    run_with_exchange_caller,
)

PAGES = [
    "Tenant's Proportionate Share is 8.00% of Operating Expenses.\n"
    "Operating Expenses shall not include capital expenditures, including the replacement of the roof."
]
SHA = "a" * 64
OK_ID = "11111111-2222-3333-4444-555555555555"


def make_package():
    v = run_tool("doc_verify_facts", {
        "document": {"pages": PAGES, "sha256": SHA, "title": "Synthetic lease"},
        "as_of": "2026-11-19",
        "candidates": [
            {"predicate": "lease.pro_rata_share", "value": 0.08,
             "quote": "Tenant's Proportionate Share is 8.00%", "page": 1},
            {"predicate": "lease.cam_exclusion",
             "value": "capital expenditures, including the replacement of the roof",
             "quote": "shall not include capital expenditures, including the replacement of the roof", "page": 1},
        ],
    })
    assert "error" not in v, v
    facts = [x["fact"] for x in v["verified"]]
    made = run_tool("fact_package_create", {"facts": facts, "title": "Synthetic", "created_at": "2026-11-19T12:00:00Z"})
    assert "error" not in made, made
    return made["package"], [f["id"] for f in facts]


def base_input(pkg, ids):
    return {
        "package": pkg, "kind": "expense_reconciliation", "title": "2025 reconciliation (synthetic)",
        "subject": {"label": "Suite 400 (synthetic)"},
        "from": {"organisation": "Tenant Co", "person": "Pat Tenant", "email": "pat@example.invalid"},
        "to": {"organisation": "Landlord Co", "person": "Lee Landlord", "email": "lee@example.invalid"},
        "items": [
            {"key": "share", "label": "Tenant's share", "value": "8.00%", "position": "accept_theirs",
             "their_value": "8.00%", "fact_ids": [ids[0]]},
            {"key": "roof", "label": "Roof", "value": 0, "unit": "USD", "position": "state_ours",
             "their_value": 20000, "fact_ids": [ids[1]]},
        ],
        "approved_by": "Pat Tenant", "approval_confirmed": True,
    }


class Fake:
    def __init__(self, reply):
        self.reply, self.seen = reply, []

    def __call__(self, url, headers, body):
        b = json.loads(body)
        self.seen.append({"url": url, "headers": headers, "body": b})
        r = self.reply(b)
        if r == "throw":
            raise OSError("network down")
        return r


def sent_ok(sandbox, reason=None):
    result = {"id": OK_ID, "digest": "d" * 64, "package_root": "r" * 64, "status": "sent", "sandbox": sandbox,
              "owner_token": "ownertoken1", "counterparty_token": "countertoken2",
              "reliances_recorded": [{"item": "share", "reliance_id": 1}]}
    if reason:
        result["test_mode_reason"] = reason
    return lambda b: (200, {"ok": True, "result": result})


class ExchangeTools(unittest.TestCase):
    def setUp(self):
        self.pkg, self.ids = make_package()
        self.inp = base_input(self.pkg, self.ids)

    def tearDown(self):
        configure_exchange()

    def test_refusals_call_nothing(self):
        fake = Fake(sent_ok(True))
        configure_exchange(transport=fake)
        for patch in ({"approval_confirmed": False}, {"approved_by": ""}, {"approved_by": None}, {"approval_confirmed": None}):
            inp = copy.deepcopy(self.inp)
            for k, v in patch.items():
                if v is None:
                    inp.pop(k)
                else:
                    inp[k] = v
            self.assertEqual(run_tool("fact_package_send", inp)["error"], "InputError", patch)
        same = copy.deepcopy(self.inp)
        same["to"]["organisation"] = " tenant co "
        self.assertEqual(run_tool("fact_package_send", same)["error"], "InputError")
        dup = copy.deepcopy(self.inp)
        dup["items"][1]["key"] = "share"
        self.assertEqual(run_tool("fact_package_send", dup)["error"], "InputError")
        nothave = copy.deepcopy(self.inp)
        del nothave["items"][1]["their_value"]
        self.assertEqual(run_tool("fact_package_send", nothave)["error"], "InputError")
        unknown = copy.deepcopy(self.inp)
        unknown["items"][0]["fact_ids"] = ["fact:not-in-package"]
        self.assertEqual(run_tool("fact_package_send", unknown)["error"], "InputError")
        tampered = copy.deepcopy(self.inp)
        tampered["package"]["facts"][0]["value"] = 0.09
        self.assertEqual(run_tool("fact_package_send", tampered)["error"], "InputError")
        self.assertEqual(fake.seen, [])

    def test_sandbox_without_caller(self):
        fake = Fake(sent_ok(True))
        configure_exchange(transport=fake, token="apptoken-should-not-travel")
        r = run_tool("fact_package_send", self.inp)
        self.assertNotIn("error", r, r)
        self.assertTrue(r["test_mode"])
        self.assertEqual(r["recorded_as"], "sandbox")
        self.assertIn("TEST MODE", r["message"])
        self.assertIn("a full FactLot account key", r["message"])
        self.assertNotIn("authorization", fake.seen[0]["headers"])
        self.assertNotIn("sender_account", fake.seen[0]["body"])
        self.assertEqual(r["link_for_counterparty"], f"https://cre-record.vercel.app/#/r/{OK_ID}/countertoken2")

    def test_not_connected_is_test_mode_even_with_account(self):
        fake = Fake(sent_ok(True))
        configure_exchange(transport=fake)
        with run_with_exchange_caller("acct_fictional_0001"):
            r = run_tool("fact_package_send", self.inp)
        self.assertTrue(r["test_mode"])
        self.assertIn("not connected to the Record", r["message"])
        self.assertNotIn("authorization", fake.seen[0]["headers"])
        self.assertNotIn("sender_account", fake.seen[0]["body"])

    def test_guest_key_is_test_mode_with_its_reason(self):
        fake = Fake(sent_ok(True))
        configure_exchange(transport=fake, token="apptoken-fictional")
        with run_with_exchange_caller(None, test_reason="the call came with a guest key"):
            r = run_tool("fact_package_send", self.inp)
        self.assertTrue(r["test_mode"])
        self.assertEqual(r["recorded_as"], "sandbox")
        self.assertTrue(r["message"].endswith(
            "because the call came with a guest key. The counterparty can still open the link and answer."))
        self.assertNotIn("authorization", fake.seen[0]["headers"])
        self.assertNotIn("sender_account", fake.seen[0]["body"])

    def test_token_and_account_forward_and_say_sent_for_real(self):
        fake = Fake(sent_ok(False))
        configure_exchange(transport=fake, token="apptoken-fictional")
        with run_with_exchange_caller("acct_fictional_0001"):
            r = run_tool("fact_package_send", self.inp)
        self.assertFalse(r["test_mode"])
        self.assertEqual(r["recorded_as"], "real")
        self.assertTrue(r["message"].startswith("SENT FOR REAL"))
        self.assertTrue(r["recorded"]["counts_in_the_measure"])
        self.assertEqual(fake.seen[0]["headers"]["authorization"], "Bearer apptoken-fictional")
        self.assertEqual(fake.seen[0]["body"]["sender_account"], "acct_fictional_0001")
        self.assertNotIn("acct_fictional_0001", json.dumps(r))

    def test_platform_test_mode_reason_and_errors(self):
        configure_exchange(transport=Fake(sent_ok(True, "the application token is not valid")), token="t")
        with run_with_exchange_caller("acct_fictional_0001"):
            r = run_tool("fact_package_send", self.inp)
        self.assertIn("the application token is not valid", r["message"])
        configure_exchange(transport=Fake(lambda b: (400, {"ok": False, "error": "item share is not in the package"})))
        self.assertEqual(run_tool("fact_package_send", self.inp)["error"], "InputError")
        configure_exchange(transport=Fake(lambda b: (503, {"ok": False, "error": "down"})))
        self.assertEqual(run_tool("fact_package_send", self.inp)["error"], "ExchangeUnavailable")
        configure_exchange(transport=Fake(lambda b: "throw"))
        self.assertEqual(run_tool("fact_package_send", self.inp)["error"], "ExchangeUnavailable")

    def test_status(self):
        status = {"id": OK_ID, "title": "t", "status": "responded", "sandbox": True, "to": {"organisation": "Landlord Co"},
                  "package_root": "r" * 64, "integrity": {"ok": True}, "responded_at": "2026-11-20T00:00:00Z",
                  "reliances": [],
                  "items": [
                      {"key": "share", "label": "Share", "position": "accept_theirs", "value": "8%", "their_value": "8%"},
                      {"key": "roof", "label": "Roof", "position": "state_ours", "value": 0, "their_value": 20000,
                       "response": {"decision": "dispute", "note": "n", "responded_by_name": "Lee", "responded_at": "x"}},
                      {"key": "fee", "label": "Fee", "position": "state_ours", "value": 1, "their_value": 2}]}
        fake = Fake(lambda b: (200, {"ok": True, "result": status}))
        configure_exchange(transport=fake, token="apptoken-fictional")
        out = run_tool("fact_package_status", {"status_link": f"https://cre-record.vercel.app/#/r/{OK_ID}/ownertoken1"})
        self.assertNotIn("error", out, out)
        r = out
        self.assertEqual((r["agreed"], r["disputed"], r["awaiting_answer"]), (0, 1, 1))
        self.assertTrue(r["test_mode"])
        self.assertNotIn("authorization", fake.seen[0]["headers"])
        self.assertEqual(run_tool("fact_package_status", {})["error"], "InputError")

    def test_caller_context_is_scoped(self):
        self.assertIsNone(factlot.current_exchange_caller() or None)
        with run_with_exchange_caller("acct_x_00000001"):
            self.assertEqual(factlot.current_exchange_caller(), {"account_id": "acct_x_00000001"})
        self.assertFalse(factlot.current_exchange_caller())

    def test_exception_exported(self):
        self.assertTrue(issubclass(ExchangeUnavailable, RuntimeError))


if __name__ == "__main__":
    unittest.main()
