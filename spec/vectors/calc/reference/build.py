"""Write the valuation vector files from the independent decimal reference in valuation.py.

    python3 spec/vectors/calc/reference/build.py && npx prettier --write spec/vectors/calc

Each case's ``expect`` values come only from valuation.py (never from running FactLot). Hand
checks are noted in the case names where a figure can be verified on paper.
"""
import json
import sys
from decimal import Decimal as D
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import valuation as ref  # noqa: E402

OUT = Path(__file__).resolve().parents[1]
n = ref.num


def write(calc, cases, version=1):
    path = OUT / f"{calc}.json"
    path.write_text(json.dumps({"calculator": f"calc.{calc}", "version": version, "cases": cases}, indent=2,
                               ensure_ascii=False) + "\n")
    print("wrote", path.name, len(cases), "cases")


# --- amortization_schedule --------------------------------------------------------------------

def amort_case(name, inp, extra=None):
    a = ref.amortization(inp["principal"], inp["rate_annual"], inp["term_months"], inp["amortization_months"],
                         inp.get("interest_only_months", 0), inp.get("payment_frequency", "monthly"),
                         inp.get("day_count", "30/360"), inp.get("start_date"))
    rows = a["rows"]
    e = {
        "value.periods": len(rows),
        "value.amortizing_payment": n(a["payment"]) if a["payment"] is not None else None,
        "value.balloon_balance": n(a["balloon"]),
        "value.final_payment": n(rows[-1]["payment"]),
        "value.total_interest": n(a["total_interest"]),
        "value.total_principal": inp["principal"],
        "value.total_payments": n(a["total_payments"]),
        "value.schedule.0.interest": n(rows[0]["interest"]),
        "value.schedule.0.principal": n(rows[0]["principal"]),
        f"value.schedule.{len(rows) - 1}.closing_balance": 0,
    }
    for k in (extra or []):
        e[f"value.schedule.{k}.opening_balance"] = n(rows[k]["opening"])
        e[f"value.schedule.{k}.interest"] = n(rows[k]["interest"])
        e[f"value.schedule.{k}.principal"] = n(rows[k]["principal"])
        e[f"value.schedule.{k}.payment"] = n(rows[k]["payment"])
        if rows[k]["date"]:
            e[f"value.schedule.{k}.date"] = rows[k]["date"]
    return {"name": name, "input": inp, "expect": e}


amort_cases = [
    amort_case("30-year fully amortizing at 6%, monthly, 30/360: payment 5,995.51 (standard annuity tables); "
               "the final payment trues up the cents",
               {"principal": 1000000, "rate_annual": 0.06, "term_months": 360, "amortization_months": 360}, [1, 358, 359]),
    amort_case("10-year loan, 2 years interest-only, then 30-year amortization: balloon at maturity (review case B02-P11)",
               {"principal": 1000000, "rate_annual": 0.06, "term_months": 120, "amortization_months": 360,
                "interest_only_months": 24}, [23, 24, 119]),
    amort_case("actual/360 with the payment on a 30/360 basis: interest by actual days, residual repaid at maturity",
               {"principal": 1000000, "rate_annual": 0.06, "term_months": 12, "amortization_months": 12,
                "day_count": "actual/360", "start_date": "2026-01-15"}, [0, 1, 11]),
    amort_case("quarterly, interest-only to maturity, actual/365",
               {"principal": 2500000, "rate_annual": 0.0725, "payment_frequency": "quarterly", "term_months": 24,
                "amortization_months": 0, "day_count": "actual/365", "start_date": "2026-03-31"}, [0, 1, 7]),
    amort_case("0% rate: equal principal payments",
               {"principal": 120000, "rate_annual": 0, "term_months": 12, "amortization_months": 12}, [5]),
    amort_case("quarterly amortizing, 5-year term on a 25-year schedule after 1 year interest-only",
               {"principal": 8000000, "rate_annual": 0.0675, "payment_frequency": "quarterly", "term_months": 60,
                "amortization_months": 300, "interest_only_months": 12, "start_date": "2026-01-01"}, [3, 4, 19]),
]
amort_cases[0]["expect"]["value.amortizing_payment"] = 5995.51  # also in published annuity tables
amort_cases[1]["expect"]["value.interest_only_payment"] = 5000
amort_cases += [
    {"name": "quarterly term must be whole quarters", "input": {"principal": 1e6, "rate_annual": 0.05,
     "payment_frequency": "quarterly", "term_months": 61, "amortization_months": 0}, "expect_error": True},
    {"name": "amortization shorter than the amortizing period is rejected", "input": {"principal": 1e6,
     "rate_annual": 0.05, "term_months": 120, "amortization_months": 60}, "expect_error": True},
    {"name": "actual/360 needs start_date", "input": {"principal": 1e6, "rate_annual": 0.05, "term_months": 12,
     "amortization_months": 12, "day_count": "actual/360"}, "expect_error": True},
    {"name": "interest-only months beyond the term", "input": {"principal": 1e6, "rate_annual": 0.05,
     "term_months": 12, "amortization_months": 0, "interest_only_months": 24}, "expect_error": True},
]
write("amortization_schedule", amort_cases)

# --- direct_cap -------------------------------------------------------------------------------

dc_in = {"noi": 1000000, "noi_basis": "forward_12", "cap_rate": 0.065, "price": 15000000, "capex_reserve_annual": 25000,
         "lease_up_costs": 300000, "free_rent_burn_off": 100000,
         "other_adjustments": [{"label": "excess land", "amount": 50000}], "area_sf": 100000, "round_value_to": 100000}
r = ref.direct_cap(1000000, 0.065, 15000000, 25000, 300000, 100000, [50000], 100000, 100000)
dc_cases = [
    {"name": "value with reserves and below-the-line adjustments, and the cap rate the price implies "
             "(hand check: 975,000 ÷ 6.5% = 15,000,000)",
     "input": dc_in,
     "expect": {"value.capitalized_income": n(r["income"]), "value.stabilized_value": n(r["stabilized"]),
                "value.total_deductions": n(r["deductions"]), "value.as_is_value": n(r["as_is"]),
                "value.as_is_value_rounded": n(r["rounded"]), "value.value_per_sf": n(r["per_sf"]),
                "value.implied_cap_rate": n(r["implied"]), "value.implied_cap_rate_before_reserves": n(r["implied_before"]),
                "value.implied_cap_rate_all_in": n(r["implied_all_in"]), "value.price_per_sf": 150, "warnings": []}},
]
r = ref.direct_cap(208000, price=3200000)
dc_cases.append({"name": "implied cap rate from a price only (review case B02-P02: 208,000 ÷ 3,200,000 = 6.5%)",
                 "input": {"noi": 208000, "price": 3200000, "noi_basis": "trailing_12"},
                 "expect": {"value.implied_cap_rate": n(r["implied"]), "value.stabilized_value": None,
                            "value.as_is_value": None}})
r = ref.direct_cap(2450000.55, cap=0.0575, reserve=61250.25)
dc_cases.append({"name": "cap rate only, cents carried through",
                 "input": {"noi": 2450000.55, "cap_rate": 0.0575, "capex_reserve_annual": 61250.25, "noi_basis": "stabilized"},
                 "expect": {"value.capitalized_income": n(r["income"]), "value.stabilized_value": n(r["stabilized"]),
                            "value.as_is_value": n(r["as_is"]), "value.implied_cap_rate": None}})
dc_cases += [
    {"name": "needs a cap rate or a price", "input": {"noi": 100000}, "expect_error": True},
    {"name": "reserve at or above NOI leaves nothing to capitalize",
     "input": {"noi": 100000, "cap_rate": 0.07, "capex_reserve_annual": 100000}, "expect_error": True},
]
write("direct_cap", dc_cases)

# --- dcf_pro_forma ----------------------------------------------------------------------------

def dcf_case(name, inp, rows=(), extra=None):
    r = ref.dcf(inp)
    e = {"value.building_area_sf": n(r["area"]), "value.exit.noi": n(r["exit_noi"]),
         "value.exit.gross_sale_price": n(r["gross_sale"]), "value.exit.selling_costs": n(r["sell"]),
         "value.exit.net_sale_proceeds": n(r["net_sale"]), "value.pv_cash_flows": n(r["pv_cf"]),
         "value.pv_reversion": n(r["pv_rev"]), "value.value": n(r["value"]),
         "value.noi_year_1": n(r["rows"][0]["noi"])}
    for y in rows:
        row = r["rows"][y - 1]
        for k, field in (("pbr", "potential_base_rent"), ("free", "free_rent"), ("rec", "expense_recoveries"),
                         ("gross", "gross_revenue"), ("vac", "general_vacancy"), ("credit", "credit_loss"),
                         ("egr", "effective_gross_revenue"), ("opex", "operating_expenses"), ("mgmt", "management_fee"),
                         ("noi", "net_operating_income"), ("ti", "tenant_improvements"), ("lc", "leasing_commissions"),
                         ("res", "capital_reserves"), ("cf", "cash_flow_before_debt")):
            e[f"value.cash_flows.{y - 1}.{field}"] = n(row[k])
    if "purchase_price" in inp:
        e["value.npv"] = n(r["npv"])
        e["value.unlevered_irr"] = n(r["irr"])
        e["value.equity_multiple"] = n(r["multiple"])
        e["value.going_in_cap_rate_on_price"] = n(r["going_in_price"])
    for i, ev in enumerate(r["events"]):
        e[f"value.lease_events.{i}.lease"] = ev["lease"]
        e[f"value.lease_events.{i}.kind"] = ev["kind"]
        e[f"value.lease_events.{i}.start_month"] = ev["start"]
        e[f"value.lease_events.{i}.end_month"] = ev["end"]
        e[f"value.lease_events.{i}.downtime_months"] = n(ev["downtime"])
        e[f"value.lease_events.{i}.free_rent_months"] = n(ev["free"])
        e[f"value.lease_events.{i}.rent_psf_annual"] = n(ref.rq(ev["psf"], 4))
        e[f"value.lease_events.{i}.tenant_improvements"] = n(ref.r2(ev["ti"]))
        e[f"value.lease_events.{i}.leasing_commission"] = n(ref.r2(ev["lc"]))
    e.update(extra or {})
    return {"name": name, "input": inp, "expect": e}, r


single = {"hold_years": 5, "leases": [{"name": "Whole building", "area_sf": 10000, "rent_psf_annual": 20,
                                       "months_remaining": 120, "market_rent_psf_annual": 20}],
          "market_leasing": {"renewal_probability": 0.7, "lease_term_months": 60, "downtime_months": 6},
          "operating_expenses_psf_annual": 8, "exit_cap_rate": 0.08, "discount_rate": 0.08}
c1, _ = dcf_case("single NNN lease, no rollover, flat: NOI 200,000 a year, sale 2,500,000 at an 8% cap, so the value at "
                 "an 8% discount rate is 2,500,000 (hand check)", single, rows=[1, 6],
                 extra={"value.value": 2500000, "value.reversion_share_of_value": 0.6806})

multi = {"hold_years": 5, "leases": [
    {"name": "Suite 100", "area_sf": 10000, "rent_psf_annual": 30, "months_remaining": 18, "escalation_rate": 0.03,
     "market_rent_psf_annual": 32},
    {"name": "Suite 200 (vacant)", "area_sf": 5000, "rent_psf_annual": 0, "months_remaining": 0, "market_rent_psf_annual": 30},
    {"name": "Suite 300", "area_sf": 20000, "rent_psf_annual": 25, "months_remaining": 50, "recovery": "base_year",
     "base_year_opex_psf_annual": 9, "market_rent_psf_annual": 28, "next_escalation_month": 7, "escalation_rate": 0.025,
     "leasing": {"renewal_probability": 0.8, "recovery": "base_year"}}],
    "market_leasing": {"renewal_probability": 0.65, "lease_term_months": 60, "downtime_months": 6, "free_rent_months_new": 4,
                       "free_rent_months_renewal": 1, "ti_psf_new": 40, "ti_psf_renewal": 10, "lc_rate_new": 0.06,
                       "lc_rate_renewal": 0.03, "rent_escalation_rate": 0.03, "renewal_rent_pct_of_market": 0.95},
    "market_rent_growth_rate": 0.03, "operating_expenses_psf_annual": 10, "non_recoverable_expenses_annual": 15000,
    "expense_growth_rate": 0.03, "management_fee_rate": 0.03, "general_vacancy_rate": 0.05, "credit_loss_rate": 0.01,
    "capital_reserve_psf_annual": 0.25, "exit_cap_rate": 0.07, "selling_cost_rate": 0.02, "discount_rate": 0.08,
    "purchase_price": 9000000}
c2, _ = dcf_case("multi-tenant rent roll: blended rollover (65% and 80% renewal), a vacant suite leased after downtime, "
                   "base-year and NNN recoveries, vacancy, credit loss, management fee, reserves; price gives NPV and IRR",
                   multi, rows=[1, 2, 3, 4, 5, 6])
mid = dict(multi, timing="mid_year", exit_noi_basis="trailing")
mid.pop("purchase_price")
c3, _ = dcf_case("the same rent roll with mid-year discounting and a trailing exit NOI", mid)
dcf_cases = [c1, c2, c3]

# Review case H10-P02: 12-month leases, 1 month of new-tenant downtime. At p = 0.55 the blended downtime is
# 0.45 months; formula version 1 rounded it to 0, so the result equalled p = 1.0. Each rollover's first month
# now collects 55% of its rent.
annual = {"hold_years": 5, "leases": [
    {"name": "Plan A 1x1 (40 units)", "area_sf": 32000, "rent_psf_annual": 14.4, "months_remaining": 12,
     "market_rent_psf_annual": 15.12, "recovery": "gross"},
    {"name": "Plan B 2x2 (24 units)", "area_sf": 26400, "rent_psf_annual": 20.4, "months_remaining": 12,
     "market_rent_psf_annual": 21.0, "recovery": "gross"}],
    "market_leasing": {"renewal_probability": 1.0, "lease_term_months": 12, "downtime_months": 1,
                       "renewal_rent_pct_of_market": 1.0, "recovery": "gross"},
    "market_rent_growth_rate": 0.03, "operating_expenses_psf_annual": 5.7, "expense_growth_rate": 0.03,
    "management_fee_rate": 0.03, "general_vacancy_rate": 0.05, "credit_loss_rate": 0.005,
    "capital_reserve_psf_annual": 0.3, "exit_cap_rate": 0.0625, "selling_cost_rate": 0.015, "discount_rate": 0.08,
    "purchase_price": 8000000}
c4, _ = dcf_case("review case H10-P02, renewal probability 1.0: 12-month leases roll every year with no downtime",
                 annual, rows=[1, 2, 6])
annual55 = {**annual, "market_leasing": {**annual["market_leasing"], "renewal_probability": 0.55}}
c5, _ = dcf_case("review case H10-P02, renewal probability 0.55: blended downtime 0.45 months is kept (the first month "
                 "of each rollover lease collects 55%), so the value is below the p = 1.0 case",
                 annual55, rows=[1, 2, 6], extra={"value.lease_events.1.start_month": 13,
                                                  "value.lease_events.1.downtime_months": 0.45})

# Review case H13-P07: Suite 300 (vacant) is leased months 10-69; the rollover after month 69 has 3.15 months of
# blended downtime, so months 70-72 are vacant and the next lease starts in month 73, after the projection. It is
# listed in lease_events; its TI and LC are not in the cash flows, and the warnings say so. Also fractional free
# rent (2.05 months) and downtime (3.15 months) on Suite 200.
office = {"hold_years": 5, "leases": [
    {"name": "Suite 100", "area_sf": 30000, "rent_psf_annual": 32, "months_remaining": 72, "escalation_rate": 0.025,
     "next_escalation_month": 13, "recovery": "nnn", "market_rent_psf_annual": 34},
    {"name": "Suite 200", "area_sf": 20000, "rent_psf_annual": 30, "months_remaining": 24, "escalation_rate": 0.02,
     "next_escalation_month": 13, "recovery": "nnn", "market_rent_psf_annual": 33},
    {"name": "Suite 300 vacant", "area_sf": 10000, "rent_psf_annual": 0, "months_remaining": 0,
     "market_rent_psf_annual": 33}],
    "market_leasing": {"renewal_probability": 0.65, "lease_term_months": 60, "downtime_months": 9,
                       "renewal_rent_pct_of_market": 0.95, "rent_escalation_rate": 0.03, "free_rent_months_new": 4,
                       "free_rent_months_renewal": 1, "ti_psf_new": 40, "ti_psf_renewal": 10, "lc_rate_new": 0.06,
                       "lc_rate_renewal": 0.03, "recovery": "nnn"},
    "market_rent_growth_rate": 0.03, "operating_expenses_psf_annual": 12, "non_recoverable_expenses_annual": 60000,
    "expense_growth_rate": 0.03, "management_fee_rate": 0.03, "general_vacancy_rate": 0.05, "credit_loss_rate": 0.005,
    "capital_reserve_psf_annual": 0.25, "exit_cap_rate": 0.0725, "selling_cost_rate": 0.02, "discount_rate": 0.085,
    "purchase_price": 17500000}
c6, r6 = dcf_case("review case H13-P07: a second-generation lease expiring in the forward year rolls over; its "
                  "3.15 months of downtime fill months 70-72 and the next lease (month 73) is listed but outside the "
                  "cash flows", office, rows=[2, 3, 6], extra={
                      "value.lease_events.4.start_month": 73,
                      "warnings.1": "The exit year (year 6) has rollover downtime (Suite 300 vacant: 3 months); its NOI "
                                    "is capitalized as is. Normalize it if a buyer would not.",
                      "warnings.2": "Rollover leases that start after the projection ends (month 72) are in "
                                    "lease_events, but their TI and leasing commissions are not in the cash flows: "
                                    "Suite 300 vacant (month 73)."})
assert r6["events"][4]["start"] == 73 and r6["rows"][5]["ti"] == 0
dcf_cases += [c4, c5, c6]
dcf_cases += [
    {"name": "base_year recovery needs the lease's base", "input": {**single, "leases": [
        {**single["leases"][0], "recovery": "base_year"}]}, "expect_error": True},
    {"name": "hold_years must be at least 1", "input": {**single, "hold_years": 0}, "expect_error": True},
    {"name": "at least one lease", "input": {**single, "leases": []}, "expect_error": True},
    {"name": "renewal probability is between 0 and 1", "input": {**single, "market_leasing": {
        **single["market_leasing"], "renewal_probability": 65}}, "expect_error": True},
]
write("dcf_pro_forma", dcf_cases, version=2)

# --- equity_waterfall -------------------------------------------------------------------------

def wf_case(name, inp, extra=None):
    kw = {"lp_share": inp["lp_share"], "ppy": inp.get("periods_per_year", 1), "order": inp.get("distribution_order",
          "pref_then_capital"), "tiers": [(t["until_irr"], t["promote"]) for t in inp.get("tiers", [])],
          "residual": inp.get("residual_promote", 0)}
    if "pref" in inp:
        kw["pref"] = inp["pref"]["rate_annual"]
        kw["compounding"] = inp["pref"].get("compounding", "compound")
    if "catch_up" in inp:
        kw["catch_up"] = (inp["catch_up"]["gp_share"], inp["catch_up"]["target_promote"])
    r = ref.waterfall(inp["cash_flows"], **kw)
    e = {"value.lp.contributions": n(r["lp_contrib"]), "value.gp.contributions": n(r["gp_contrib"]),
         "value.lp.distributions": n(r["lp_dist"]), "value.gp.distributions": n(r["gp_dist"]),
         "value.gp.promote": n(r["promote"]), "value.lp.irr": n(r["lp_irr"]), "value.lp.multiple": n(r["lp_multiple"]),
         "value.project_irr": n(r["project_irr"]), "value.unreturned_capital": n(r["unreturned"]),
         "value.unpaid_pref": n(r["unpaid_pref"])}
    if r["gp_irr"] is not None:
        e["value.gp.irr"] = n(r["gp_irr"])
    for k, row in enumerate(r["rows"]):
        if inp["cash_flows"][k] > 0:
            e[f"value.periods.{k}.lp_distribution"] = n(row["lp_dist"])
            e[f"value.periods.{k}.gp_promote"] = n(row["gp_promote"])
    e.update(extra or {})
    return {"name": name, "input": inp, "expect": e, "tolerance": 1e-8}


wf_cases = [
    wf_case("one period, by hand: 1,000 in, 1,300 out; 8% pref 80, capital 1,000, full catch-up 20 (20% of 100 profit), "
            "then 80/20 on 200: promote 60 = 20% of 300 profit; LP 1,116, GP 184",
            {"cash_flows": [-1000, 1300], "lp_share": 0.9, "pref": {"rate_annual": 0.08},
             "catch_up": {"gp_share": 1, "target_promote": 0.2}, "residual_promote": 0.2},
            {"value.periods.1.pref": 80, "value.periods.1.return_of_capital": 1000, "value.periods.1.catch_up": 20,
             "value.periods.1.residual": 200, "value.periods.1.lp_distribution": 1116, "value.periods.1.gp_distribution": 184,
             "value.periods.1.gp_promote": 60}),
    wf_case("annual: compounding 8% pref, full catch-up to 20%, 80/20 to a 12% LP IRR, 70/30 to 15%, 60/40 after",
            {"cash_flows": [-1000000, 50000, 60000, 70000, 1800000], "lp_share": 0.9, "pref": {"rate_annual": 0.08},
             "catch_up": {"gp_share": 1, "target_promote": 0.2},
             "tiers": [{"until_irr": 0.12, "promote": 0.2}, {"until_irr": 0.15, "promote": 0.3}], "residual_promote": 0.4}),
    wf_case("quarterly: two contributions, simple 8% pref, capital before pref, 75/25 to a 13% LP IRR, 65/35 after",
            {"cash_flows": [-600000, -400000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 1500000],
             "periods_per_year": 4, "lp_share": 0.95, "pref": {"rate_annual": 0.08, "compounding": "simple"},
             "distribution_order": "capital_then_pref", "tiers": [{"until_irr": 0.13, "promote": 0.25}],
             "residual_promote": 0.35}),
    wf_case("pure IRR hurdles with no pref: 100% pro rata to a 10% IRR, then 80/20; the LP funds everything",
            {"cash_flows": [-5000000, 400000, 400000, 400000, 400000, 6500000], "lp_share": 1,
             "tiers": [{"until_irr": 0.10, "promote": 0}], "residual_promote": 0.2},
            {"value.gp.irr": None, "value.gp.multiple": None}),
    wf_case("the deal does not return capital: no promote, pref unpaid",
            {"cash_flows": [-1000000, 100000, 600000], "lp_share": 0.9, "pref": {"rate_annual": 0.08},
             "tiers": [{"until_irr": 0.12, "promote": 0.2}], "residual_promote": 0.3},
            {"value.gp.promote": 0}),
]
wf_cases += [
    {"name": "needs a contribution", "input": {"cash_flows": [100, 200], "lp_share": 0.9}, "expect_error": True},
    {"name": "tiers in increasing hurdle order", "input": {"cash_flows": [-100, 200], "lp_share": 0.9,
     "tiers": [{"until_irr": 0.15, "promote": 0.3}, {"until_irr": 0.12, "promote": 0.2}]}, "expect_error": True},
    {"name": "catch-up share must exceed its target", "input": {"cash_flows": [-100, 200], "lp_share": 0.9,
     "catch_up": {"gp_share": 0.2, "target_promote": 0.2}}, "expect_error": True},
]
write("equity_waterfall", wf_cases)

# --- exchange_1031 ----------------------------------------------------------------------------

def ex_case(name, inp, extra=None):
    rel, rep = inp["relinquished"], inp.get("replacement")
    props = [(p["fair_market_value"], p.get("received", False), p.get("identified_date"), p.get("received_date"),
              p["name"]) for p in inp.get("identified_properties", [])]
    r = ref.exchange(inp["relinquished_transfer_date"], inp.get("tax_return_due_date"), rel["sale_price"],
                     rel.get("selling_expenses", 0), rel.get("debt_relieved", 0), rel.get("adjusted_basis"),
                     inp.get("cash_received_at_sale", 0), rep["purchase_price"] if rep else None,
                     rep.get("acquisition_costs", 0) if rep else 0, rep.get("new_debt", 0) if rep else 0, props)
    e = {"value.deadlines.identification_deadline": r["id"], "value.deadlines.exchange_deadline": r["ex"],
         "value.deadlines.exchange_deadline_basis": r["basis"]}
    if props:
        e.update({"value.identification.three_property_rule": r["three"],
                  "value.identification.two_hundred_percent_rule": r["two_hundred"],
                  "value.identification.ratio_to_relinquished": n(r["ratio"]),
                  "value.identification.count": r["count"],
                  "value.identification.total_fair_market_value": n(r["total"]),
                  "value.identification.received_share": n(r["received_share"]),
                  "value.identification.rule_met": r["rule"],
                  "value.identification.late_identifications": r["late_ids"],
                  "value.identification.late_receipts": r["late_receipts"]})
    if rep:
        e.update({"value.exchange.amount_realized": n(r["realized"]), "value.exchange.exchange_equity": n(r["equity"]),
                  "value.exchange.qualified_intermediary_funds": n(r["qi"]),
                  "value.exchange.additional_cash_paid": n(r["added"]), "value.exchange.cash_boot": n(r["cash_boot"]),
                  "value.exchange.mortgage_boot": n(r["mortgage_boot"]), "value.exchange.total_boot": n(r["total_boot"]),
                  "value.exchange.trade_down": n(r["trade_down"])})
        if "gain" in r:
            e["value.exchange.realized_gain"] = n(r["gain"])
            e["value.exchange.boot_limited_gain"] = n(r["limited"])
    e.update(extra or {})
    return {"name": name, "input": inp, "expect": e}


ex_cases = [
    ex_case("transfer 2026-10-01: identify by 2026-11-15; the 2027-03-15 return due date comes before day 180 "
            "(2027-03-30); four candidates fail the three-property and 200% tests; cash boot only",
            {"relinquished_transfer_date": "2026-10-01", "tax_return_due_date": "2027-03-15", "as_of": "2026-11-03",
             "relinquished": {"sale_price": 3000000, "selling_expenses": 150000, "debt_relieved": 1200000,
                              "adjusted_basis": 1000000},
             "cash_received_at_sale": 50000,
             "replacement": {"purchase_price": 2800000, "acquisition_costs": 30000, "new_debt": 1000000},
             "identified_properties": [{"name": "A", "fair_market_value": 2800000, "received": True},
                                       {"name": "B", "fair_market_value": 2500000},
                                       {"name": "C", "fair_market_value": 2000000},
                                       {"name": "D", "fair_market_value": 900000}]},
            {"value.deadlines.days_to_identification_deadline": 12, "value.deadlines.days_to_exchange_deadline": 132,
             "value.identification.rule_met": None}),
    ex_case("three NNN candidates (review case B10-P01): trade up with more debt, no boot; 180 days with no due date given",
            {"relinquished_transfer_date": "2026-06-15",
             "relinquished": {"sale_price": 4200000, "selling_expenses": 210000, "debt_relieved": 1500000},
             "replacement": {"purchase_price": 4500000, "acquisition_costs": 45000, "new_debt": 1800000},
             "identified_properties": [{"name": "Candidate A (synthetic pharmacy)", "fair_market_value": 4500000, "received": True,
                                        "identified_date": "2026-07-20", "received_date": "2026-11-30"},
                                       {"name": "Candidate B (synthetic QSR)", "fair_market_value": 2100000},
                                       {"name": "Candidate C (synthetic dollar store)", "fair_market_value": 1600000}]},
            {"value.identification.rule_met": "three_property", "value.identification.late_identifications": []}),
    ex_case("five candidates within 200% of the relinquished value; a trade-down that does not replace the debt gives 400,000 of mortgage boot",
            {"relinquished_transfer_date": "2026-12-20",
             "relinquished": {"sale_price": 2000000, "selling_expenses": 100000, "debt_relieved": 900000,
                              "adjusted_basis": 1200000},
             "replacement": {"purchase_price": 1500000, "new_debt": 500000},
             "identified_properties": [{"name": f"P{i}", "fair_market_value": 790000} for i in range(1, 6)]},
            {"value.identification.rule_met": "200_percent", "value.deadlines.exchange_deadline": "2027-06-18"}),
    ex_case("95% exception: six candidates over 200%, but 96% of the identified value was received in time",
            {"relinquished_transfer_date": "2026-01-10", "tax_return_due_date": "2027-04-15",
             "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": "Big", "fair_market_value": 2400000, "received": True,
                                        "received_date": "2026-07-01"}] +
                                      [{"name": f"Small {i}", "fair_market_value": 20000} for i in range(1, 6)]},
            {"value.identification.rule_met": "95_percent", "value.identification.ninety_five_percent_exception": True}),
]
ex_cases += [
    ex_case("late identification (review batch H, reproduced): A, B, C identified on time, D after the 45-day "
            "deadline of 2026-10-30: D is out of the count, the value and the tests, so three on-time properties "
            "meet the three-property rule (before the fix: count 4, 9,000,000, no rule met)",
            {"relinquished_transfer_date": "2026-09-15", "as_of": "2026-11-04",
             "relinquished": {"sale_price": 4200000},
             "identified_properties": [{"name": "A", "fair_market_value": 3000000, "identified_date": "2026-10-20"},
                                       {"name": "B", "fair_market_value": 2500000, "identified_date": "2026-10-25"},
                                       {"name": "C", "fair_market_value": 2000000, "identified_date": "2026-10-28"},
                                       {"name": "D", "fair_market_value": 1500000, "identified_date": "2026-11-01"}]}),
    ex_case("deadline day itself counts: identified 2026-10-30 is on time, 2026-10-31 is late",
            {"relinquished_transfer_date": "2026-09-15", "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": "A", "fair_market_value": 500000, "identified_date": "2026-10-30"},
                                       {"name": "B", "fair_market_value": 500000, "identified_date": "2026-10-30"},
                                       {"name": "C", "fair_market_value": 500000, "identified_date": "2026-10-30"},
                                       {"name": "D", "fair_market_value": 500000, "identified_date": "2026-10-31"},
                                       {"name": "E", "fair_market_value": 500000, "identified_date": "2026-11-20"}]}),
    ex_case("every identification late: nothing counts, no rule is met",
            {"relinquished_transfer_date": "2026-09-15", "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": "A", "fair_market_value": 900000, "identified_date": "2026-11-01"},
                                       {"name": "B", "fair_market_value": 800000, "identified_date": "2026-11-02"}]}),
    ex_case("late identifications are left out of the 200% test: four on-time properties total 1,600,000 (within "
            "200% of 1,000,000); counting the late 900,000 would give 2,500,000 and fail",
            {"relinquished_transfer_date": "2026-09-15", "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": f"P{i}", "fair_market_value": 400000, "identified_date": "2026-10-01"}
                                       for i in range(1, 5)] +
                                      [{"name": "Late", "fair_market_value": 900000, "identified_date": "2026-11-10"}]}),
    ex_case("a late-identified property that was received still counts for nothing: it is out of the received share",
            {"relinquished_transfer_date": "2026-01-10", "tax_return_due_date": "2027-04-15",
             "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": "Big", "fair_market_value": 2400000, "received": True,
                                        "identified_date": "2026-03-01", "received_date": "2026-07-01"}] +
                                      [{"name": f"Small {i}", "fair_market_value": 20000, "identified_date": "2026-02-01"}
                                       for i in range(1, 6)]}),
    ex_case("late receipt of a small property: the 95% exception counts only value received by the deadline, "
            "2,400,000 of 2,500,000 = 96% (before the fix any late receipt ended the exception)",
            {"relinquished_transfer_date": "2026-01-10", "tax_return_due_date": "2027-04-15",
             "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": "Big", "fair_market_value": 2400000, "received": True,
                                        "received_date": "2026-07-01"},
                                       {"name": "Small 1", "fair_market_value": 20000, "received": True,
                                        "received_date": "2026-09-01"}] +
                                      [{"name": f"Small {i}", "fair_market_value": 20000} for i in range(2, 6)]}),
    ex_case("late receipt of the large property: received value 100,000 of 2,500,000, the exception fails and the "
            "late receipt is listed",
            {"relinquished_transfer_date": "2026-01-10", "tax_return_due_date": "2027-04-15",
             "relinquished": {"sale_price": 1000000},
             "identified_properties": [{"name": "Big", "fair_market_value": 2400000, "received": True,
                                        "received_date": "2026-09-01"}] +
                                      [{"name": f"Small {i}", "fair_market_value": 20000, "received": True,
                                        "received_date": "2026-06-01"} for i in range(1, 6)]}),
    {"name": "return due date before the transfer", "input": {"relinquished_transfer_date": "2026-10-01",
     "tax_return_due_date": "2026-04-15", "relinquished": {"sale_price": 1000000}}, "expect_error": True},
    {"name": "invalid date", "input": {"relinquished_transfer_date": "2026-02-30",
     "relinquished": {"sale_price": 1000000}}, "expect_error": True},
]
write("exchange_1031", ex_cases, version=2)

# --- tx_unequal_appraisal -----------------------------------------------------------------------

import tx_appraisal as tx  # noqa: E402

TX_LAW_URLS = ["https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm#41.43",
               "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.42.htm#42.26",
               "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.42.htm#42.26",
               "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm#41.66"]


def tx_case(name, inp):
    r = tx.unequal(inp)
    e = {
        "formula.id": "calc.tx_unequal_appraisal",
        "value.disclaimer": tx.NOTICE,
        "value.comparables_count": len(inp["comparables"]),
        "value.normalize_by": inp.get("normalize_by", "none"),
        "value.adjustment_combine": inp.get("adjustment_combine", "sum"),
    }
    for i, c in enumerate(r["comps"]):
        e[f"value.comparables.{i}.normalized_value"] = n(c["normalized"])
        e[f"value.comparables.{i}.percent_factor"] = n(c["factor"])
        e[f"value.comparables.{i}.after_percent_value"] = n(c["after"])
        e[f"value.comparables.{i}.amount_adjustments_total"] = n(c["amount_total"])
        e[f"value.comparables.{i}.adjusted_value"] = n(c["adjusted"])
        e[f"value.comparables.{i}.adjusted_value_psf"] = n(c["psf"]) if c["psf"] is not None else None
        e[f"value.comparables.{i}.total_adjustment_pct"] = n(c["pct"])
    e.update({
        "value.sorted_adjusted_values": [n(v) for v in r["sorted"]],
        "value.median_adjusted_value": n(r["median"]),
        "value.median_pair": [n(v) for v in r["pair"]] if r["pair"] is not None else None,
        "value.subject_value": inp["subject"]["value"],
        "value.subject_minus_median": n(r["diff"]),
        "value.subject_minus_median_pct": n(r["diff_pct"]),
        "value.subject_above_median": r["diff"] > 0,
        "value.law.0.url": TX_LAW_URLS[0],
        "value.law.1.url": TX_LAW_URLS[1],
        "value.law.3.url": TX_LAW_URLS[3],
        "warnings": r["warnings"],
    })
    return {"name": name, "input": inp, "expect": e}


def pct(label, v, reason):
    return {"label": label, "kind": "percent", "value": v, "reason": reason}


def amt(label, v, reason):
    return {"label": label, "kind": "amount", "value": v, "reason": reason}


def psf(label, v, reason):
    return {"label": label, "kind": "psf", "value": v, "reason": reason}


def five_whole(combine):
    return {
        "tax_year": 2027,
        "subject": {"id": "S", "county_fips": "201", "value": 1000000, "value_basis": "appraised"},
        "adjustment_combine": combine,
        "comparables": [
            {"id": "A", "county_fips": "201", "value": 900000, "value_basis": "appraised",
             "adjustments": [pct("location", 0.20, "comp on a weaker corridor"), pct("age", -0.10, "comp newer")]},
            {"id": "B", "county_fips": "201", "value": 950000, "value_basis": "appraised",
             "adjustments": [pct("condition", -0.05, "comp renovated 2024")]},
            {"id": "C", "county_fips": "201", "value": 1050000, "value_basis": "appraised"},
            {"id": "D", "county_fips": "201", "value": 980000, "value_basis": "appraised",
             "adjustments": [pct("age", 0.05, "comp older"), pct("parking", 0.03, "comp has less parking")]},
            {"id": "E", "county_fips": "201", "value": 920000, "value_basis": "appraised",
             "adjustments": [amt("excess land", -20000, "comp has a surplus pad site")]},
        ],
    }


tx_cases = [
    tx_case("odd count, whole values, percentages summed: A 900,000 × (1 + 0.20 − 0.10) = 990,000 is the 3rd of 5 "
            "(900,000; 902,500; 990,000; 1,050,000; 1,058,400), subject 1,000,000 is 10,000 above it",
            five_whole("sum")),
    tx_case("same comparables, percentages compounded: A 900,000 × 1.20 × 0.90 = 972,000 becomes the median, "
            "D 980,000 × 1.05 × 1.03 = 1,059,870",
            five_whole("compound")),
    tx_case("even count, normalized by improvement area, $/SF and amount adjustments: A 3,650,000 ÷ 29,500 × 31,000 "
            "= 3,835,593.22 × 1.03 = 3,950,661.02; B 3,875,000 − 2.50 × 31,000 = 3,797,500; median (3,797,500 + "
            "3,950,661.02) ÷ 2 = 3,874,080.51; 4 comparables warn",
            {"tax_year": 2027,
             "subject": {"id": "fl:parcel:us-48201:0420150000012", "value": 4200000, "value_basis": "appraised",
                         "improvement_area_sf": 31000},
             "normalize_by": "improvement_area_sf",
             "comparables": [
                 {"id": "fl:parcel:us-48201:0420150000034", "value": 3650000, "value_basis": "appraised",
                  "improvement_area_sf": 29500,
                  "citation": {"document_id": "fl:document:sha256-example", "locator": "account 0420150000034",
                               "as_of": "2027-04-15"},
                  "adjustments": [pct("age", 0.05, "comp built 1998, subject 2006"),
                                  pct("size", -0.02, "comp 5% smaller")]},
                 {"id": "B", "value": 4000000, "value_basis": "appraised", "improvement_area_sf": 32000,
                  "adjustments": [psf("condition", -2.5, "comp has a new roof")]},
                 {"id": "C", "value": 3900000, "value_basis": "appraised", "improvement_area_sf": 30000,
                  "adjustments": [amt("pad site", -50000, "comp includes a leased pad")]},
                 {"id": "D", "value": 3720000, "value_basis": "appraised", "improvement_area_sf": 31000},
             ]}),
    tx_case("even count of 6, normalized by land area, market values, subject below the median: (2,100,000 + "
            "2,160,000) ÷ 2 = 2,130,000, subject 2,000,000 is 130,000 below",
            {"tax_year": 2027,
             "subject": {"value": 2000000, "value_basis": "market", "land_area_sf": 100000},
             "normalize_by": "land_area_sf",
             "comparables": [
                 {"id": "L1", "value": 1100000, "value_basis": "market", "land_area_sf": 50000,
                  "adjustments": [psf("frontage", 1, "comp has less frontage")]},
                 {"id": "L2", "value": 2400000, "value_basis": "market", "land_area_sf": 120000,
                  "adjustments": [amt("access", 25000, "comp lacks a signal")]},
                 {"id": "L3", "value": 1800000, "value_basis": "market", "land_area_sf": 80000,
                  "adjustments": [pct("shape", -0.04, "comp is rectangular")]},
                 {"id": "L4", "value": 3150000, "value_basis": "market", "land_area_sf": 150000},
                 {"id": "L5", "value": 950000, "value_basis": "market", "land_area_sf": 40000,
                  "adjustments": [psf("floodplain", -0.5, "comp is outside the floodplain")]},
                 {"id": "L6", "value": 2100000, "value_basis": "market", "land_area_sf": 105000,
                  "adjustments": [amt("utilities", -10000.5, "comp has sewer at the line")]},
             ]}),
    tx_case("tax year 2026, §23.231 property: every warning except the 2027 one (mixed basis W2, other county W3, "
            "W4 adjusted 30%, W5 identical to the subject); median 1,450,000",
            {"tax_year": 2026,
             "subject": {"id": "S", "county_fips": "201", "value": 1500000, "value_basis": "appraised",
                         "improvement_area_sf": 10000, "circuit_breaker_23_231": True},
             "comparables": [
                 {"id": "W1", "county_fips": "201", "value": 1400000, "value_basis": "appraised"},
                 {"id": "W2", "county_fips": "201", "value": 1600000, "value_basis": "market"},
                 {"id": "W3", "county_fips": "157", "value": 1450000, "value_basis": "appraised"},
                 {"id": "W4", "county_fips": "201", "value": 1000000, "value_basis": "appraised",
                  "adjustments": [pct("quality", 0.30, "comp is class C, subject class A")]},
                 {"id": "W5", "county_fips": "201", "value": 1500000, "value_basis": "appraised",
                  "improvement_area_sf": 10000},
             ]}),
    tx_case("tax year 2027, §23.231 flag: the limitation is no longer in §42.26(d); comparables without ids are "
            "named #1–#3; median 790,000 × (1 − 0.025) = 770,250",
            {"tax_year": 2027,
             "subject": {"value": 800000, "value_basis": "market", "circuit_breaker_23_231": True},
             "comparables": [
                 {"value": 750000, "value_basis": "market", "adjustments": [amt("signage", 15000, "comp has none")]},
                 {"value": 820000, "value_basis": "market"},
                 {"value": 790000, "value_basis": "market",
                  "adjustments": [pct("condition", -0.025, "comp in better condition")]},
             ]}),
]
tx_cases[2]["expect"]["value.comparables.0.citation"] = {
    "document_id": "fl:document:sha256-example", "locator": "account 0420150000034", "as_of": "2027-04-15"}
tx_cases[2]["expect"]["value.comparables.0.id"] = "fl:parcel:us-48201:0420150000034"
tx_cases[3]["expect"]["value.median_pair"] = [2100000, 2160000]  # hand check

_three = [{"id": f"K{i}", "value": 1000000 + i * 10000, "value_basis": "appraised"} for i in range(1, 4)]
_subject = {"id": "S", "value": 1000000, "value_basis": "appraised"}


def tx_err(name, **over):
    inp = {"tax_year": 2027, "subject": dict(_subject), "comparables": [dict(c) for c in _three]}
    for k, v in over.items():
        inp[k] = v
    return {"name": name, "input": inp, "expect_error": True}


def _with(i, **fields):
    comps = [dict(c) for c in _three]
    comps[i].update(fields)
    return comps


tx_cases += [
    tx_err("fewer than 3 comparables (a FactLot product floor, not law)", comparables=[dict(c) for c in _three[:2]]),
    tx_err("the subject among its own comparables (same id)", comparables=_with(1, id="S")),
    tx_err("duplicate comparable ids", comparables=_with(2, id="K1")),
    tx_err("normalize_by needs the area on every comparable", normalize_by="improvement_area_sf",
           subject={**_subject, "improvement_area_sf": 10000},
           comparables=[{**c, "improvement_area_sf": 9000} for c in _three[:2]] + [dict(_three[2])]),
    tx_err("normalize_by needs the subject's area", normalize_by="land_area_sf",
           comparables=[{**c, "land_area_sf": 40000} for c in _three]),
    tx_err("a $/SF adjustment needs a normalizing area", comparables=_with(0, adjustments=[psf("size", 2, "smaller")])),
    tx_err("a whole-number percent (5 for 5%) is rejected", comparables=_with(0, adjustments=[pct("age", 5, "older")])),
    tx_err("adjustments may not take a value to zero or below",
           comparables=_with(0, adjustments=[amt("contamination", -1010000, "remediation")])),
    tx_err("percentages totalling -100% or less", comparables=_with(0, adjustments=[pct("a", -0.6, "x"),
                                                                                  pct("b", -0.5, "y")])),
    tx_err("every adjustment needs a reason", comparables=_with(0, adjustments=[{"label": "age", "kind": "percent",
                                                                                "value": 0.05}])),
    tx_err("unknown field on a comparable", comparables=_with(0, adjustment=[pct("age", 0.05, "older")])),
    tx_err("county FIPS is 3 digits, not the 5-digit state+county code", subject={**_subject, "county_fips": "48201"}),
    tx_err("tax year before the Tax Code took effect", tax_year=1981),
]
write("tx_unequal_appraisal", tx_cases)
