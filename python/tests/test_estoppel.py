"""estoppel_prepare: the same invented cases as packages/tools/src/estoppel.test.ts, with the expected
figures worked by hand there. Every party and number is invented."""

import copy
import json
import unittest

from factlot import run_tool, run_with_exchange_caller
from factlot.estoppel import estoppel_summary

DOC_A = "fl:document:sha256-" + "a" * 64
DOC_B = "fl:document:sha256-" + "b" * 64
SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4"


def fact(id_, predicate, value, quote, doc=DOC_A, page=1, valid_from=None, supersedes=None):
    f = {"id": id_, "subject": SUBJECT, "predicate": predicate, "value": value, "as_of": "2026-03-01",
         "provenance": {"method": "extracted", "sources": [{"document_id": doc, "page": page, "quote": quote}]}}
    if valid_from:
        f["valid_from"] = valid_from
    if supersedes:
        f["supersedes"] = supersedes
    return f


def lease_facts():
    return [
        fact("flf_landlord", "lease.landlord", "Alder Court Holdings LLC", "entered into by Alder Court Holdings LLC (“Landlord”)"),
        fact("flf_tenant", "lease.tenant", "Birchwood Analytics Inc", "and Birchwood Analytics Inc (“Tenant”)"),
        fact("flf_comm", "lease.commencement_date", "2023-07-01", "The Commencement Date is July 1, 2023."),
        fact("flf_exp_old", "lease.expiration_date", "2028-06-30", "The Term shall expire on June 30, 2028.", page=2),
        fact("flf_exp_new", "lease.expiration_date", "2033-06-30", "The Term shall expire on June 30, 2033.", doc=DOC_B,
             valid_from="2026-01-01", supersedes=["flf_exp_old"]),
        fact("flf_area", "lease.rentable_area_sf", 8400, "containing approximately 8,400 rentable square feet"),
        fact("flf_rent_old", "lease.base_rent_schedule", [
            {"from": "2023-07-01", "to": "2024-06-30", "annual_rent_psf": 30},
            {"from": "2024-07-01", "to": "2025-06-30", "annual_rent_psf": 30.9},
            {"from": "2025-07-01", "to": "2026-06-30", "annual_rent_psf": 31.83},
            {"from": "2026-07-01", "to": "2027-06-30", "annual_rent_psf": 32.78},
            {"from": "2027-07-01", "to": "2028-06-30", "annual_rent_psf": 33.76}],
             "July 1, 2023 to June 30, 2024: $30.00 per RSF; July 1, 2024 to June 30, 2025: $30.90 per RSF; July 1, 2025 to June 30, 2026: $31.83 per RSF; July 1, 2026 to June 30, 2027: $32.78 per RSF; July 1, 2027 to June 30, 2028: $33.76 per RSF",
             page=3),
        fact("flf_rent_new", "lease.base_rent_schedule", [{"from": "2028-07-01", "to": "2033-06-30", "annual_rent_psf": 36}],
             "July 1, 2028 to June 30, 2033: $36.00 per RSF", doc=DOC_B, valid_from="2026-01-01", supersedes=["flf_rent_old"]),
        fact("flf_dep", "lease.security_deposit", 30000, "a security deposit of $30,000.00", page=4),
        fact("flf_free", "lease.free_rent", {"months": 3, "applies_to": "base_rent"},
             "Base Rent shall be abated for the first three (3) months of the Term", page=3),
        fact("flf_ti", "lease.ti_allowance", 168000, "Landlord shall provide a tenant improvement allowance of $168,000.00", page=5),
        fact("flf_renew", "lease.renewal_option",
             {"count": 1, "term_months": 60, "notice_months": 12, "rent": "95% of Fair Market Rent"},
             "Tenant shall have one (1) option to extend the Term for sixty (60) months by notice given not less than twelve (12) months before expiration, at 95% of Fair Market Rent",
             page=6),
    ]


def args(facts=None, **extra):
    a = {"lease_facts": facts if facts is not None else lease_facts(),
         "parties": {"tenant": {"organisation": "Birchwood Analytics Inc"}, "landlord": {"organisation": "Alder Court Holdings LLC"},
                     "requested_by": {"organisation": "Northfield Credit Partners LLC", "role": "lender"}},
         "premises": {"label": "Alder Court, Suite 210"}, "as_of": "2026-11-20"}
    a.update(extra)
    return a


def run(a=None):
    o = run_tool("estoppel_prepare", a if a is not None else args())
    assert "error" not in o, json.dumps(o)
    return o


def st(r, code):
    return next(s for s in r["statements"] if s["code"] == code)


def flags(s):
    return [f["code"] for f in s["flags"]]


class EstoppelTests(unittest.TestCase):
    def test_full_lease_with_amendment(self):
        r = run()
        self.assertEqual((r["totals"]["conflicts"], r["totals"]["gaps"]), (0, 0))
        for s in r["statements"]:
            if s["basis"] == "tenant":
                self.assertEqual((s["fact_ids"], s["sources"], s["status"]), ([], [], "tenant_to_confirm"))
            else:
                self.assertTrue(s["sources"])
        exp = st(r, "EXPIRATION")
        self.assertEqual(exp["value"], "2033-06-30")
        self.assertEqual([(x["fact_id"], x["role"]) for x in exp["sources"]], [("flf_exp_new", "lease"), ("flf_exp_old", "superseded")])
        rent = st(r, "BASE_RENT")
        self.assertEqual(rent["value"], 275352)
        self.assertIn("$275,352.00 ($32.78 per rentable square foot), payable at $22,946.00 per month", rent["text"])
        nxt = st(r, "NEXT_RENT_STEP")
        self.assertEqual(nxt["value"], 283584)
        self.assertEqual(r["key_figures"]["monthly_base_rent"], 22946)
        self.assertEqual([d["role"] for d in r["documents"]], ["original", "amendment"])
        self.assertIn("one option to extend the term for 60 months on 12 months' notice at 95% of Fair Market Rent",
                      st(r, "OPTION_RENEWAL")["text"])
        self.assertIn("3 months of abated base rent", st(r, "FREE_RENT")["text"])

    def test_rent_paid_through(self):
        a = st(run(), "RENT_PAID_THROUGH")
        self.assertTrue(a["needs_tenant_value"])
        b = st(run(args(landlord_records={"rent_paid_through": "2026-11-30", "security_deposit_held": 31000})), "RENT_PAID_THROUGH")
        self.assertEqual((b["needs_tenant_value"], b["value"], b["sources"]), (False, "2026-11-30", []))
        r = run(args(landlord_records={"security_deposit_held": 31000}))
        self.assertIn("DEPOSIT_LEDGER_DIFFERS", flags(st(r, "SECURITY_DEPOSIT_PAID")))

    def test_gaps(self):
        drop = {"lease.security_deposit", "lease.rentable_area_sf", "lease.renewal_option", "lease.ti_allowance", "lease.free_rent"}
        r = run(args([f for f in lease_facts() if f["predicate"] not in drop]))
        self.assertEqual(st(r, "SECURITY_DEPOSIT")["status"], "gap")
        self.assertFalse(st(r, "PREMISES")["sendable"])
        rent = st(r, "BASE_RENT")
        self.assertEqual((rent["unit"], rent["value"]), ("USD per SF per year", 32.78))
        self.assertEqual((r["totals"]["gaps"], len(r["statements_withheld"])), (2, 2))
        self.assertIn("NO_OPTION_FACTS", flags(st(r, "OPTIONS_COMPLETE")))

    def test_conflict_and_pending(self):
        facts = lease_facts()
        del next(f for f in facts if f["id"] == "flf_exp_new")["supersedes"]
        r = run(args(facts))
        self.assertEqual(st(r, "EXPIRATION")["status"], "conflict")
        self.assertEqual(len(r["conflicts"]), 1)
        p = run(args(as_of="2025-11-20"))
        self.assertEqual(st(p, "EXPIRATION")["value"], "2028-06-30")
        self.assertEqual(st(p, "BASE_RENT")["value"], 267372)
        self.assertEqual(len(p["documents"]), 1)

    def test_schedule_coverage_and_gaps(self):
        r = run(args(as_of="2034-01-01"))
        self.assertEqual(st(r, "BASE_RENT")["status"], "gap")
        self.assertIn("TERM_EXPIRED", flags(st(r, "EXPIRATION")))
        r = run(args([f for f in lease_facts() if f["id"] != "flf_rent_new"]))
        self.assertIn("RENT_SCHEDULE_ENDS_EARLY", flags(st(r, "BASE_RENT")))

    def test_names_and_notice_dates(self):
        a = args(parties={"tenant": {"organisation": "Birchwood Data Inc"}, "landlord": {"organisation": "Alder Court Holdings LLC"}})
        self.assertIn("TENANT_NAME_DIFFERS", flags(st(run(a), "LEASE_DOCUMENTS")))
        facts = lease_facts()
        facts.append(fact("flf_renew_dl", "lease.renewal_notice_deadline", "2026-06-30",
                          "the exercise notice must be received no later than June 30, 2026", page=6))
        self.assertIn("OPTION_NOTICE_DATE_PASSED", flags(st(run(args(facts)), "OPTION_RENEWAL")))

    def test_items_and_determinism(self):
        r = run()
        self.assertEqual(len(r["package_items"]), r["totals"]["sendable"])
        for it in r["package_items"]:
            self.assertEqual(it["position"], "state_ours")
            if it.get("tenant_to_confirm"):
                self.assertEqual(it["fact_ids"], [])
        self.assertEqual(run(), run())
        a = run(args(list(reversed(lease_facts()))))
        self.assertEqual([s["text"] for s in a["statements"]], [s["text"] for s in r["statements"]])

    def test_refusals(self):
        bad = lease_facts()
        bad[0]["provenance"]["sources"][0]["quote"] = ""
        self.assertIn("error", run_tool("estoppel_prepare", args(bad)))
        dup = lease_facts()
        dup[1]["id"] = dup[0]["id"]
        self.assertIn("error", run_tool("estoppel_prepare", args(dup)))
        same = args(parties={"tenant": {"organisation": "X Co"}, "landlord": {"organisation": "x co"}})
        self.assertIn("error", run_tool("estoppel_prepare", same))

    def test_hosted_summary(self):
        full = run()
        with run_with_exchange_caller(None, full_audit=False):
            r = run_tool("estoppel_prepare", args())
        self.assertTrue(r["limited"])
        self.assertEqual(r, estoppel_summary(full))
        self.assertNotIn("Fair Market Rent", json.dumps(r))
        with run_with_exchange_caller(None, full_audit=True):
            self.assertEqual(run_tool("estoppel_prepare", args()), full)


if __name__ == "__main__":
    unittest.main()
