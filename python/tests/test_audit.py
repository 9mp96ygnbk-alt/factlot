"""audit_expense_statement: every finding code with a case that triggers it and one that does not, three
complete invented cases, the refusals and the hosted summary. The same cases as
packages/tools/src/audit.test.ts, with the expected figures worked by hand there. Every party and number
is invented."""

import copy
import json
import unittest

import factlot
from factlot import run_tool, run_with_exchange_caller
from factlot.audit import audit_summary

DOC = "fl:document:sha256-" + "a" * 64
SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4"


def quote_for(n, predicate, value):
    if predicate == "lease.pro_rata_share":
        return f"Tenant's Proportionate Share is {value * 100:.2f}%"
    if predicate == "lease.cam_cap":
        return ("Controllable Operating Expenses shall not increase by more than five percent (5%) per year, "
                "on a cumulative and compounding basis")
    if predicate == "lease.operating_expense_base_year":
        return f"the Base Year shall be calendar year {value}"
    return f"Synthetic clause stating {predicate} number {n}"


def fact(n, predicate, value, page=1):
    return {"id": f"flf_t{n}", "subject": SUBJECT, "predicate": predicate, "value": value, "as_of": "2026-03-01",
            "provenance": {"method": "extracted", "sources": [
                {"document_id": DOC, "page": page, "quote": quote_for(n, predicate, value)}]}}


def clean_case():
    return {
        "lease": {
            "lease.pro_rata_share": 0.08,
            "lease.cam_cap": {"method": "compounding_from_base", "rate": 0.05},
            "lease.cam_admin_fee": {"rate": 0.1, "base": "actual", "excluded_from_base": ["real estate taxes", "insurance"]},
            "lease.cam_exclusion": [{"category": "advertising"}],
            "lease.capex_treatment": {"keywords": ["roof", "replacement"], "recoverable": "excluded"},
            "lease.cam_gross_up": {"target_occupancy": 0.95, "applies_to": "variable_expenses"},
            "lease.audit_right": {"window_days": 120, "starts_from": "statement_receipt",
                                  "notice_form": "written notice to Landlord's notice address by certified mail",
                                  "cost_shift_threshold": {"type": "percent_of_billed", "value": 0.03}},
        },
        "lines": [
            {"label": "Real estate taxes", "amount": 400000, "controllable": False, "variable": False},
            {"label": "Insurance", "amount": 100000, "controllable": False, "variable": False},
            {"label": "Janitorial", "amount": 150000, "controllable": True, "variable": True},
            {"label": "Repairs and maintenance", "amount": 120000, "controllable": True, "variable": False},
            {"label": "Landscaping", "amount": 80000, "controllable": True, "variable": False},
        ],
        "st": {
            "statement.period": {"year": 2025, "statement_date": "2026-03-01", "received_date": "2026-03-10"},
            "statement.share_applied": {"share": 0.08},
            "statement.total": {"amount": 850000},
            "statement.admin_fee": {"rate": 0.1, "base_amount": 28000, "amount": 2800},
            "statement.cap_reference": {"year": 2022, "amount": 24000},
            "statement.cap_applied": {"limit": 27783},
            "statement.tenant_charge": {"amount": 70583},
            "statement.estimates_credited": {"amount": 66000},
            "statement.estimates_paid": {"amount": 66000},
            "statement.balance_claimed": {"amount": 4583},
        },
    }


def flawed_case():
    c = clean_case()
    c["st"]["statement.cap_applied"] = {"limit": None}
    c["st"]["statement.admin_fee"] = {"rate": 0.1, "base_amount": 68000, "amount": 6800}
    c["st"]["statement.tenant_charge"] = {"amount": 74800}
    c["st"]["statement.balance_claimed"] = {"amount": 8800}
    return c


def build(c, **extra):
    n = 0
    lease_facts = []
    for p, v in c["lease"].items():
        for x in (v if p == "lease.cam_exclusion" else [v]):
            n += 1
            lease_facts.append(fact(n, p, x))
    statement_facts = []
    for p, v in c["st"].items():
        n += 1
        statement_facts.append(fact(n, p, v, 2))
    for l in c["lines"]:
        n += 1
        statement_facts.append(fact(n, "statement.line", l, 2))
    for s in c.get("separately", []):
        n += 1
        statement_facts.append(fact(n, "statement.separately_billed", s, 3))
    args = {"lease_facts": lease_facts, "statement_facts": statement_facts, "as_of": "2026-04-01", **extra}
    if c.get("prior"):
        prior = []
        if c.get("priorPeriod"):
            n += 1
            prior.append(fact(n, "statement.period", c["priorPeriod"], 2))
        for l in c["prior"]:
            n += 1
            prior.append(fact(n, "statement.line", l, 2))
        args["prior_statement_facts"] = prior
    return args


def run(c, **extra):
    r = run_tool("audit_expense_statement", build(c, **extra))
    assert "error" not in r, r
    return r


def codes(r):
    return [f["code"] for f in r["findings"]]


def find(r, code):
    return next((f for f in r["findings"] if f["code"] == code), None)


def check_of(r, name):
    return next(c for c in r["checks"] if c["check"] == name)


class AuditTests(unittest.TestCase):
    def test_clean_statement(self):
        r = run(clean_case())
        self.assertEqual(codes(r), [])
        self.assertEqual(r["totals"]["finding_count"], 0)
        d = r["deadlines"][0]
        self.assertEqual((d["last_day"], d["days_remaining"], d["status"]), ("2026-07-08", 98, "open"))
        not_run = [x["check"] for x in r["checks_not_run"]]
        self.assertIn("base_year_or_stop", not_run)
        self.assertIn("year_over_year", not_run)
        self.assertEqual(check_of(r, "management_fee")["status"], "ran")
        self.assertTrue(all(i["position"] == "accept_theirs" for i in r["package_items"]))
        self.assertEqual(len(r["package_items"]), 5)
        self.assertFalse(r["cost_shifting"]["crosses_on_firm_findings"])

    def test_fee_base_and_cap_errors(self):
        r = run(flawed_case())
        self.assertEqual(find(r, "FEE_ON_EXCLUDED_LINES")["difference"], 4000)
        cap = find(r, "CAP_EXCEEDED")
        self.assertEqual((cap["landlord_figure"], cap["lease_figure"], cap["difference"]), (28000, 27783, 217))
        self.assertEqual(sorted(codes(r)), ["CAP_EXCEEDED", "FEE_ON_EXCLUDED_LINES"])
        self.assertEqual((r["totals"]["firm_difference"], r["totals"]["total_difference"]), (217, 4217))
        cs = r["cost_shifting"]
        self.assertEqual(cs["threshold_amount"], 2244)
        self.assertFalse(cs["crosses_on_firm_findings"])
        self.assertTrue(cs["crosses_if_readings_hold"])
        for f in r["findings"]:
            self.assertTrue(f["lease_fact_ids"])
            self.assertTrue(all(s["quote"] and s["page"] for s in f["sources"] if s["side"] == "lease"))
        self.assertEqual(run(flawed_case()), r)

    def test_missing_lease_terms(self):
        c = flawed_case()
        for k in ("lease.cam_cap", "lease.cam_admin_fee", "lease.audit_right"):
            del c["lease"][k]
        r = run(c)
        self.assertEqual(codes(r), [])
        self.assertEqual(check_of(r, "cap")["status"], "not_run")
        self.assertIn("lease.cam_cap", check_of(r, "cap")["reason"])
        self.assertIn("lease.cam_admin_fee", check_of(r, "management_fee")["reason"])
        self.assertIn("lease.audit_right", check_of(r, "deadlines")["reason"])
        self.assertEqual(r["deadlines"], [])

    def test_no_share(self):
        c = flawed_case()
        del c["lease"]["lease.pro_rata_share"]
        r = run(c)
        self.assertEqual(codes(r), [])
        self.assertIn("lease.pro_rata_share", check_of(r, "cap")["reason"])

    def test_refusals(self):
        ok = build(clean_case())

        def bad(patch):
            a = copy.deepcopy(ok)
            patch(a)
            r = run_tool("audit_expense_statement", a)
            self.assertEqual(r["error"], "InputError")

        bad(lambda a: a["lease_facts"][0]["provenance"].pop("sources"))
        bad(lambda a: a["lease_facts"][0]["provenance"].__setitem__("sources", []))
        bad(lambda a: a["lease_facts"][0]["provenance"]["sources"][0].__setitem__("quote", ""))
        bad(lambda a: a["lease_facts"][0].__setitem__("value", 7))
        bad(lambda a: a["statement_facts"].append(a["lease_facts"][0]))
        bad(lambda a: a["lease_facts"].append({**a["lease_facts"][0], "id": "flf_dupe"}))
        bad(lambda a: a["statement_facts"][0].__setitem__("predicate", "lease.pro_rata_share"))
        bad(lambda a: a.__setitem__("as_of", "April 1"))
        bad(lambda a: a["lease_facts"].append({"nonsense": True}))

    def test_fee_codes(self):
        c = clean_case()
        c["st"]["statement.admin_fee"] = {"rate": 0.12, "base_amount": 28000, "amount": 3360}
        f = find(run(c), "FEE_RATE_ABOVE_CAP")
        self.assertEqual((f["landlord_figure"], f["lease_figure"], f["difference"]), (3360, 2800, 560))
        self.assertIsNone(find(run(clean_case()), "FEE_RATE_ABOVE_CAP"))
        c = clean_case()
        c["lines"][2]["grossed_up_amount"] = 158333.33
        c["st"]["statement.admin_fee"] = {"rate": 0.1, "base_amount": 28666.67, "amount": 2866.67}
        self.assertEqual(find(run(c), "FEE_ON_GROSSED_UP_BASE")["difference"], 66.67)
        c = clean_case()
        c["st"]["statement.admin_fee"] = {"rate": 0.1, "base_amount": 31000, "amount": 3100}
        f = find(run(c), "FEE_BASE_UNRECONCILED")
        self.assertEqual((f["difference"], f["class"]), (300, "depends_on_reading"))

    def test_cap_codes(self):
        c = flawed_case()
        del c["lease"]["lease.cam_cap"]
        c["lease"]["lease.cam_cap_rate"] = {"rate": 0.05}
        f = find(run(c), "CAP_METHOD_AMBIGUOUS")
        self.assertEqual((f["difference"], f["class"]), (217, "depends_on_reading"))
        steps = "\n".join(f["steps"])
        self.assertIn("$27,783.00", steps)
        self.assertIn("$27,600.00", steps)
        self.assertIn("$25,200.00", steps)
        self.assertIsNone(find(run(clean_case()), "CAP_METHOD_AMBIGUOUS"))
        c = flawed_case()
        del c["lines"][3]["controllable"]
        r = run(c)
        self.assertIsNone(find(r, "CAP_EXCEEDED"))
        self.assertIn("Repairs and maintenance", check_of(r, "cap")["reason"])

    def test_capex_codes(self):
        c = clean_case()
        c["lines"].append({"label": "Roof replacement, north wing", "amount": 50000, "controllable": False, "variable": False})
        c["st"]["statement.total"] = {"amount": 900000}
        self.assertEqual(find(run(c), "CAPEX_BILLED_AS_OPERATING")["difference"], 4000)
        self.assertIsNone(find(run(clean_case()), "CAPEX_BILLED_AS_OPERATING"))
        treat = {"keywords": ["roof"], "recoverable": "amortized", "amortization_years": 10, "interest_rate": 0.06}
        c = clean_case()
        c["lease"]["lease.capex_treatment"] = treat
        c["lines"].append({"label": "Roof work", "amount": 50000, "controllable": False, "variable": False})
        c["st"]["statement.total"] = {"amount": 900000}
        lump = find(run(c), "CAPEX_BILLED_AS_OPERATING")
        self.assertEqual((lump["lease_figure"], lump["difference"]), (543.47, 3456.53))
        d = clean_case()
        d["lease"]["lease.capex_treatment"] = treat
        d["lines"].append({"label": "Roof work", "amount": 9000, "controllable": False, "variable": False,
                           "amortization": {"cost": 50000, "years": 5, "rate": 0.06}})
        d["st"]["statement.total"] = {"amount": 859000}
        self.assertEqual(find(run(d), "CAPEX_AMORTIZATION")["difference"], 176.53)
        e = clean_case()
        e["lease"]["lease.capex_treatment"] = {**treat, "method": "straight_line"}
        self.assertEqual(check_of(run(e), "capital_items")["status"], "not_run")

    def test_gross_up_codes(self):
        c = clean_case()
        c["lines"][3]["grossed_up_amount"] = 126000
        self.assertEqual(find(run(c), "GROSSUP_ON_FIXED_EXPENSE")["difference"], 480)
        c = clean_case()
        c["st"]["statement.gross_up"] = {"actual_occupancy": 0.8, "target_occupancy": 1}
        self.assertEqual(find(run(c), "GROSSUP_WRONG_OCCUPANCY")["difference"], 750)
        c["st"]["statement.gross_up"] = {"actual_occupancy": 0.8, "target_occupancy": 0.95}
        self.assertIsNone(find(run(c), "GROSSUP_WRONG_OCCUPANCY"))
        c = clean_case()
        c["lease"]["lease.cam_gross_up"] = {"target_occupancy": 0.95, "applies_to": "variable_expenses",
                                            "base_year_grossed_up": True}
        c["st"]["statement.gross_up"] = {"actual_occupancy": 0.95, "target_occupancy": 0.95}
        c["st"]["statement.base_year_applied"] = {"base_year": 2022, "deduction": 0, "grossed_up": False}
        f = find(run(c), "GROSSUP_BASE_YEAR_INCONSISTENT")
        self.assertEqual((f["class"], f["difference"]), ("question_to_ask", None))

    def test_share_exclusion_duplicates(self):
        c = clean_case()
        c["lease"]["lease.pro_rata_basis"] = {"tenant_sf": 8000, "building_sf": 100000}
        c["st"]["statement.share_applied"] = {"share": 0.085, "building_sf": 94000}
        f = find(run(c), "SHARE_DIFFERS")
        self.assertEqual(f["difference"], 4250)
        self.assertIn("94000 SF", " ".join(f["steps"]))
        self.assertIsNone(find(run(clean_case()), "SHARE_DIFFERS"))
        c = clean_case()
        c["lines"].append({"label": "Advertising and promotion", "amount": 25000, "controllable": True, "variable": False})
        c["st"]["statement.total"] = {"amount": 875000}
        self.assertEqual(find(run(c), "EXCLUDED_CATEGORY_BILLED")["difference"], 2000)
        c = clean_case()
        c["lines"].append({"label": "janitorial", "amount": 150000, "controllable": True, "variable": True})
        c["st"]["statement.total"] = {"amount": 1000000}
        self.assertEqual(find(run(c), "DUPLICATE_LINE")["difference"], 12000)
        d = clean_case()
        d["separately"] = [{"label": "Landscaping", "amount": 6400}]
        self.assertEqual(find(run(d), "DUPLICATE_OF_SEPARATE_BILL")["difference"], 6400)
        r = run(clean_case())
        self.assertIsNone(find(r, "DUPLICATE_LINE"))
        self.assertIsNone(find(r, "DUPLICATE_OF_SEPARATE_BILL"))

    def test_base_year_and_stop(self):
        c = clean_case()
        c["lease"]["lease.operating_expense_base_year"] = 2023
        c["st"]["statement.base_year_applied"] = {"base_year": 2024, "deduction": 50000}
        self.assertIsNone(find(run(c), "BASE_YEAR_DIFFERS")["difference"])
        c["st"]["statement.base_year_total"] = {"year": 2023, "amount": 700000}
        self.assertEqual(find(run(c), "BASE_YEAR_DIFFERS")["difference"], 6000)
        d = clean_case()
        d["lease"]["lease.operating_expense_base_year"] = 2023
        d["st"]["statement.base_year_applied"] = {"base_year": 2023, "deduction": 50000}
        d["st"]["statement.base_year_total"] = {"year": 2023, "amount": 700000}
        self.assertEqual(find(run(d), "BASE_YEAR_DEDUCTION")["difference"], 6000)
        d["st"]["statement.base_year_applied"] = {"base_year": 2023, "deduction": 56000}
        self.assertIsNone(find(run(d), "BASE_YEAR_DEDUCTION"))
        e = clean_case()
        e["lease"]["lease.expense_stop"] = {"amount": 700000}
        e["st"]["statement.base_year_applied"] = {"stop_amount": 600000, "deduction": 48000}
        self.assertEqual(find(run(e), "STOP_DIFFERS")["difference"], 8000)
        e["st"]["statement.base_year_applied"] = {"stop_amount": 700000, "deduction": 56000}
        self.assertIsNone(find(run(e), "STOP_DIFFERS"))

    def test_arithmetic(self):
        c = clean_case()
        c["st"]["statement.total"] = {"amount": 860000}
        self.assertEqual(find(run(c), "ARITH_LINES_VS_TOTAL")["difference"], 800)
        c = clean_case()
        c["st"]["statement.estimates_credited"] = {"amount": 64000}
        self.assertEqual(find(run(c), "ARITH_ESTIMATES")["difference"], 2000)
        c = clean_case()
        c["st"]["statement.balance_claimed"] = {"amount": 5000}
        self.assertEqual(find(run(c), "ARITH_BALANCE")["difference"], 417)
        c = clean_case()
        c["st"]["statement.admin_fee"] = {"rate": 0.1, "base_amount": 28000, "amount": 3000}
        self.assertEqual(find(run(c), "ARITH_FEE")["difference"], 200)
        r = run(clean_case())
        for k in ("ARITH_LINES_VS_TOTAL", "ARITH_ESTIMATES", "ARITH_BALANCE", "ARITH_FEE"):
            self.assertIsNone(find(r, k))

    def test_year_over_year(self):
        c = clean_case()
        c["priorPeriod"] = {"year": 2024, "statement_date": "2025-03-01", "received_date": "2025-03-10"}
        c["prior"] = [{"label": "Janitorial", "amount": 140000}, {"label": "Landscaping", "amount": 60000},
                      {"label": "Insurance", "amount": 99000}]
        r = run(c)
        ys = [f for f in r["findings"] if f["code"] == "YOY_RISE"]
        self.assertEqual(len(ys), 1)
        self.assertIsNone(ys[0]["difference"])
        self.assertEqual(ys[0]["class"], "question_to_ask")
        self.assertEqual(r["questions_not_sent"], ["YOY_RISE.1"])
        self.assertEqual(r["totals"]["total_difference"], 0)
        strict = [f for f in run(c, yoy_threshold=0.05)["findings"] if f["code"] == "YOY_RISE"]
        self.assertEqual(len(strict), 2)

    def test_deadlines_and_cost_shifting(self):
        c = clean_case()
        d = run(c, as_of="2026-08-01")["deadlines"][0]
        self.assertEqual((d["status"], d["days_remaining"]), ("passed", -24))
        c["lease"]["lease.audit_right"] = {"window_days": 60, "starts_from": "statement_date", "notice_form": "written notice"}
        r = run(c)
        self.assertEqual(r["deadlines"][0]["last_day"], "2026-04-30")
        self.assertEqual(check_of(r, "cost_shifting")["status"], "not_run")
        c = flawed_case()
        c["lease"]["lease.audit_right"] = {"window_days": 120, "starts_from": "statement_receipt", "notice_form": "written notice",
                                           "cost_shift_threshold": {"type": "amount", "value": 200}}
        cs = run(c)["cost_shifting"]
        self.assertEqual(cs["threshold_amount"], 200)
        self.assertTrue(cs["crosses_on_firm_findings"])

    def test_hosted_summary(self):
        args = build(flawed_case())
        with run_with_exchange_caller(None, full_audit=False):
            r = run_tool("audit_expense_statement", args)
        self.assertTrue(r["limited"])
        self.assertEqual(r["audit_available"], "pro")
        self.assertEqual((r["summary"]["finding_count"], r["summary"]["total_difference"]), (2, 4217))
        self.assertNotIn("findings", r)
        self.assertNotIn("package_items", r)
        text = json.dumps(r)
        self.assertNotIn("Proportionate Share", text)
        self.assertNotIn("CAP_EXCEEDED", text)
        local = run_tool("audit_expense_statement", args)
        self.assertNotIn("limited", local)
        with run_with_exchange_caller(None, full_audit=True):
            paid = run_tool("audit_expense_statement", args)
        self.assertIn("findings", paid)
        self.assertEqual(audit_summary(local), r)
        self.assertTrue(factlot.audit_limited() is False)


if __name__ == "__main__":
    unittest.main()
