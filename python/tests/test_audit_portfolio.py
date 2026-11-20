"""audit_expense_portfolio: each location is the single audit's own answer, the totals add up, a bad location
never fails the call, and the hosted summary. The same cases as packages/tools/src/audit_portfolio.test.ts. Every
party and number is invented."""

import copy
import unittest

from factlot import run_tool, run_with_exchange_caller
from factlot.free_document import document_id

DOC = "fl:document:sha256-"
SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4"


def fact(tag, n, predicate, value, page=1):
    if predicate == "lease.pro_rata_share":
        quote = f"Tenant's Proportionate Share is {value * 100:.2f}%"
    elif predicate == "lease.cam_cap":
        quote = ("Controllable Operating Expenses shall not increase by more than five percent (5%) per year, "
                 "on a cumulative and compounding basis")
    else:
        quote = f"Synthetic clause stating {predicate} number {n}"
    return {"id": f"flf_{tag}{n}", "subject": SUBJECT, "predicate": predicate, "value": value, "as_of": "2026-03-01",
            "provenance": {"method": "extracted", "sources": [
                {"document_id": DOC + (tag * 64)[:64], "page": page, "quote": quote}]}}


def location(tag, label, landlord=None, fee_base=28000, received="2026-03-10", year=2025, window=120):
    lease = [
        ("lease.pro_rata_share", 0.08),
        ("lease.cam_cap", {"method": "compounding_from_base", "rate": 0.05}),
        ("lease.cam_admin_fee", {"rate": 0.1, "base": "actual", "excluded_from_base": ["real estate taxes", "insurance"]}),
        ("lease.audit_right", {"window_days": window, "starts_from": "statement_receipt",
                               "notice_form": "written notice by certified mail"}),
    ]
    lines = [
        {"label": "Real estate taxes", "amount": 400000, "controllable": False, "variable": False},
        {"label": "Insurance", "amount": 100000, "controllable": False, "variable": False},
        {"label": "Janitorial", "amount": 150000, "controllable": True, "variable": True},
        {"label": "Repairs and maintenance", "amount": 120000, "controllable": True, "variable": False},
        {"label": "Landscaping", "amount": 80000, "controllable": True, "variable": False},
    ]
    st = [
        ("statement.period", {"year": year, "statement_date": "2026-03-01", "received_date": received}),
        ("statement.share_applied", {"share": 0.08}),
        ("statement.total", {"amount": 850000}),
        ("statement.admin_fee", {"rate": 0.1, "base_amount": fee_base, "amount": fee_base / 10}),
        ("statement.cap_reference", {"year": 2022, "amount": 24000}),
        ("statement.cap_applied", {"limit": 27783}),
    ] + [("statement.line", l) for l in lines]
    n = 0
    lf, sf = [], []
    for p, v in lease:
        n += 1
        lf.append(fact(tag, n, p, v))
    for p, v in st:
        n += 1
        sf.append(fact(tag, n, p, v, 2))
    e = {"label": label, "lease_facts": lf, "statement_facts": sf}
    if landlord:
        e["landlord"] = landlord
    return e


def run(args):
    r = run_tool("audit_expense_portfolio", args)
    assert "error" not in r, r
    return r


def single(loc, as_of):
    a = {k: v for k, v in loc.items() if k not in ("label", "landlord")}
    r = run_tool("audit_expense_statement", {**a, "as_of": as_of})
    assert "error" not in r, r
    return r


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.audits = [
            location("a", "Store 1", "Alder Court Holdings LLC", fee_base=68000),
            location("b", "Store 2 (2024)", "alder court holdings, llc", fee_base=68000, year=2024, received="2025-03-14"),
            location("c", "Store 3", "Northgate Property Partners", received="2026-01-12", window=90),
            location("d", "Store 4"),
        ]
        self.args = {"audits": self.audits, "as_of": "2026-04-01"}

    def test_each_location_is_the_single_audit_and_totals_add_up(self):
        r = run(self.args)
        total = 0
        for loc, l in zip(self.audits, r["locations"]):
            s = single(loc, "2026-04-01")
            self.assertEqual(l["summary"]["finding_count"], s["totals"]["finding_count"])
            self.assertEqual(l["package"]["package_items"], s["package_items"])
            self.assertEqual(l["result_ref"]["result_digest"], document_id(s))
            total += s["totals"]["total_difference"]
        self.assertEqual(r["portfolio"]["total_difference"], round(total, 2))
        # the fee-base finding: 10% x (68,000 - 28,000) = 4,000 at each of the two Alder locations; the 2024
        # statement is also over the cap (reference 2022, two years: 24,000 x 1.05^2 = 26,460; the landlord
        # applied 27,783): 1,323
        self.assertEqual(r["by_landlord"][0]["landlord"], "Alder Court Holdings LLC")
        self.assertEqual(r["by_landlord"][0]["locations"], 2)
        self.assertEqual(r["by_landlord"][0]["total_difference"], 9323)
        fee = [x for x in r["repeated_issues"] if x["check"] == "management_fee"]
        self.assertEqual(fee[0]["scope"], "landlord")
        self.assertEqual(fee[0]["statement_years"], [2024, 2025])
        self.assertTrue(fee[0]["across_years"])
        self.assertEqual(run(copy.deepcopy(self.args)), r)

    def test_deadlines_in_date_order_from_as_of(self):
        r = run(self.args)
        days = [d["last_day"] for d in r["deadlines"]]
        self.assertEqual(days, sorted(days))
        c = [d for d in r["deadlines"] if d["label"] == "Store 3"][0]
        self.assertEqual((c["last_day"], c["days_remaining"]), ("2026-04-12", 11))
        self.assertEqual(r["portfolio"]["earliest_deadline"]["label"], "Store 3")

    def test_a_bad_location_is_reported_alone(self):
        a = copy.deepcopy(self.audits)
        a[1]["lease_facts"] = [{"nonsense": True}]
        a[2] = {"label": "Store 3", "lease_facts": a[2]["lease_facts"]}
        a[3]["label"] = "store 1"
        r = run({"audits": a, "as_of": "2026-04-01"})
        self.assertEqual(r["portfolio"]["locations_audited"], 1)
        self.assertEqual([x["index"] for x in r["locations_invalid"]], [1, 2, 3])
        self.assertTrue(r["locations_invalid"][0]["issues"][0]["path"].startswith("audits.1.lease_facts.0"))
        self.assertIn("duplicate label", r["locations_invalid"][2]["issues"][0]["message"])
        self.assertEqual(r["report_units"], 1)
        for bad in ({"as_of": "2026-04-01"}, {"audits": [], "as_of": "2026-04-01"}, {"audits": [{}], "as_of": "April 1"}):
            self.assertIn("error", run_tool("audit_expense_portfolio", bad))

    def test_hosted_summary_is_counts_and_totals_only(self):
        with run_with_exchange_caller(None, False):
            r = run_tool("audit_expense_portfolio", self.args)
        self.assertTrue(r["limited"])
        self.assertEqual(r["summary"]["locations_audited"], 4)
        self.assertNotIn("locations", r)
        self.assertNotIn("ranking", r)
        self.assertIn("single audit", r["free_document"]["note"])
        self.assertEqual(r["summary"]["total_difference"], run(self.args)["portfolio"]["total_difference"])


if __name__ == "__main__":
    unittest.main()
