"""Random inputs for the valuation calculators (dcf_pro_forma, direct_cap, amortization_schedule,
equity_waterfall, exchange_1031), on their own random stream so the cases in gen.py stay as they were.

Some inputs are deliberately invalid (wrong multiples, missing dates, bad orders) so both SDKs must
also agree on which inputs they reject.
"""
import random
from datetime import date, timedelta


def _date(r, lo=2020, hi=2035):
    return (date(lo, 1, 1) + timedelta(days=r.randint(0, (hi - lo) * 365))).isoformat()


def amortization(r):
    freq = r.choice(["monthly", "monthly", "quarterly"])
    step = 3 if freq == "quarterly" else 1
    term = r.randint(1, 200 // step) * step
    io = r.choice([0, 0, r.randint(0, term // step) * step])
    amort = r.choice([0, term - io, r.randint(term - io, 600 // step * step) // step * step if term - io <= 600 else 0, 360, 300])
    inp = {"principal": round(r.uniform(1e4, 2e8), r.choice([0, 2])), "rate_annual": r.choice([0, round(r.uniform(0.001, 0.15), 4)]),
           "payment_frequency": freq, "term_months": term, "amortization_months": amort, "interest_only_months": io,
           "day_count": r.choice(["30/360", "30/360", "actual/360", "actual/365"])}
    if inp["day_count"] != "30/360" or r.random() < 0.4:
        inp["start_date"] = f"20{r.randint(20, 35)}-{r.randint(1, 12):02d}-{r.choice([1, 15, 28, 29, 30, 31]):02d}"
        if r.random() < 0.02:
            del inp["start_date"]
    if r.random() < 0.03:
        inp["term_months"] += 1  # not a whole quarter, or io > term, or amortization too short
    return inp


def direct_cap(r):
    inp = {"noi": round(r.uniform(1e3, 5e7), 2)}
    if r.random() < 0.8:
        inp["cap_rate"] = round(r.uniform(0.03, 0.12), 4)
    if r.random() < 0.6 or "cap_rate" not in inp:
        inp["price"] = round(r.uniform(1e5, 8e8), 2)
    if r.random() < 0.1:
        inp.pop("cap_rate", None), inp.pop("price", None)
    if r.random() < 0.6:
        inp["capex_reserve_annual"] = round(r.uniform(0, inp["noi"] * (1.2 if r.random() < 0.05 else 0.2)), 2)
    for k in ("lease_up_costs", "free_rent_burn_off"):
        if r.random() < 0.5:
            inp[k] = round(r.uniform(0, 5e6), 2)
    if r.random() < 0.4:
        inp["other_adjustments"] = [{"label": f"adj {i}", "amount": round(r.uniform(-2e6, 2e6), 2)} for i in range(r.randint(1, 4))]
    if r.random() < 0.5:
        inp["area_sf"] = round(r.uniform(1e3, 1e6), 0)
    if r.random() < 0.4:
        inp["round_value_to"] = r.choice([1000, 10000, 100000])
    if r.random() < 0.6:
        inp["noi_basis"] = r.choice(["trailing_12", "forward_12", "stabilized"])
    return inp


def dcf(r):
    hold = r.randint(1, 12)
    leases = []
    for i in range(r.randint(1, 8)):
        rec = r.choice(["nnn", "gross", "base_year"])
        lease = {"name": f"Suite {i + 1}", "area_sf": round(r.uniform(500, 80000), r.choice([0, 2])),
                 "rent_psf_annual": round(r.uniform(0, 80), 2), "months_remaining": r.choice([0, r.randint(1, 160)]),
                 "market_rent_psf_annual": round(r.uniform(5, 90), 2), "recovery": rec}
        if rec == "base_year" and r.random() < 0.97:
            lease["base_year_opex_psf_annual"] = round(r.uniform(0, 20), 2)
        if r.random() < 0.5:
            lease["escalation_rate"] = round(r.uniform(0, 0.05), 4)
            lease["next_escalation_month"] = r.randint(1, 24)
        if r.random() < 0.2:
            lease["free_rent_months_remaining"] = r.randint(0, 12)
        if r.random() < 0.3:
            lease["leasing"] = {k: v for k, v in {
                "renewal_probability": round(r.uniform(0, 1), 2), "downtime_months": r.randint(0, 18),
                "ti_psf_new": round(r.uniform(0, 80), 2), "free_rent_months_new": r.randint(0, 12),
                "lease_term_months": r.choice([36, 60, 120]), "recovery": r.choice(["nnn", "gross", "base_year"]),
            }.items() if r.random() < 0.5}
        leases.append(lease)
    market = {"renewal_probability": round(r.uniform(0, 1), 2), "lease_term_months": r.choice([12, 36, 60, 84, 120]),
              "downtime_months": r.randint(0, 18)}
    for k, v in {"renewal_rent_pct_of_market": round(r.uniform(0.8, 1.1), 3), "rent_escalation_rate": round(r.uniform(0, 0.04), 4),
                 "free_rent_months_new": r.randint(0, 12), "free_rent_months_renewal": r.randint(0, 6),
                 "ti_psf_new": round(r.uniform(0, 80), 2), "ti_psf_renewal": round(r.uniform(0, 30), 2),
                 "lc_rate_new": round(r.uniform(0, 0.08), 4), "lc_rate_renewal": round(r.uniform(0, 0.05), 4),
                 "recovery": r.choice(["nnn", "gross", "base_year"])}.items():
        if r.random() < 0.7:
            market[k] = v
    inp = {"hold_years": hold, "leases": leases, "market_leasing": market, "exit_cap_rate": round(r.uniform(0.04, 0.11), 4),
           "discount_rate": round(r.uniform(0, 0.14), 4)}
    for k, v in {"market_rent_growth_rate": round(r.uniform(-0.03, 0.05), 4), "operating_expenses_psf_annual": round(r.uniform(0, 20), 2),
                 "non_recoverable_expenses_annual": round(r.uniform(0, 3e5), 2), "expense_growth_rate": round(r.uniform(-0.01, 0.05), 4),
                 "management_fee_rate": round(r.uniform(0, 0.05), 4), "general_vacancy_rate": round(r.uniform(0, 0.1), 4),
                 "credit_loss_rate": round(r.uniform(0, 0.03), 4), "capital_reserve_psf_annual": round(r.uniform(0, 1), 2),
                 "exit_noi_basis": r.choice(["forward", "trailing"]), "selling_cost_rate": round(r.uniform(0, 0.04), 4),
                 "timing": r.choice(["end_of_year", "mid_year"]), "purchase_price": round(r.uniform(1e5, 2e8), 2)}.items():
        if r.random() < 0.7:
            inp[k] = v
    return inp


def waterfall(r):
    n = r.randint(2, 60)
    flows = [-round(r.uniform(1e4, 1e7), 2)]
    for _ in range(n - 1):
        flows.append(round(r.uniform(-2e5, 2e6), 2) if r.random() < 0.85 else -round(r.uniform(0, 1e6), 2))
    if r.random() < 0.02:
        flows = [abs(x) for x in flows]
    inp = {"cash_flows": flows, "periods_per_year": r.choice([1, 4, 12]), "lp_share": r.choice([1, 0.9, 0.95, round(r.uniform(0.5, 1), 3)])}
    if r.random() < 0.8:
        inp["pref"] = {"rate_annual": round(r.uniform(0.04, 0.12), 4), "compounding": r.choice(["compound", "simple"])}
    if r.random() < 0.5:
        inp["distribution_order"] = r.choice(["pref_then_capital", "capital_then_pref"])
    if r.random() < 0.5:
        gs = r.choice([1, 0.8, 0.5])
        inp["catch_up"] = {"gp_share": gs, "target_promote": r.choice([0.2, 0.25, round(r.uniform(0.05, 0.6), 3)])}
    hurdles = sorted(r.sample([0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25], r.randint(0, 4)))
    if r.random() < 0.03 and len(hurdles) > 1:
        hurdles.reverse()
    inp["tiers"] = [{"until_irr": h, "promote": round(r.uniform(0, 0.5), 3)} for h in hurdles]
    if r.random() < 0.7:
        inp["residual_promote"] = round(r.uniform(0, 0.6), 3)
    return inp


def exchange(r):
    start = _date(r, 2024, 2030)
    inp = {"relinquished_transfer_date": start,
           "relinquished": {"sale_price": round(r.uniform(1e5, 5e7), 2)}}
    rel = inp["relinquished"]
    if r.random() < 0.7:
        rel["selling_expenses"] = round(r.uniform(0, rel["sale_price"] * 0.08), 2)
    if r.random() < 0.7:
        rel["debt_relieved"] = round(r.uniform(0, rel["sale_price"] * 1.05), 2)
    if r.random() < 0.5:
        rel["adjusted_basis"] = round(r.uniform(0, rel["sale_price"]), 2)
    if r.random() < 0.6:
        inp["tax_return_due_date"] = (date.fromisoformat(start) + timedelta(days=r.randint(-3 if r.random() < 0.03 else 0, 400))).isoformat()
    if r.random() < 0.5:
        inp["as_of"] = (date.fromisoformat(start) + timedelta(days=r.randint(-10, 200))).isoformat()
    if r.random() < 0.4:
        inp["cash_received_at_sale"] = round(r.uniform(0, 5e5), 2)
    if r.random() < 0.7:
        inp["replacement"] = {"purchase_price": round(rel["sale_price"] * r.uniform(0.5, 2), 2)}
        if r.random() < 0.5:
            inp["replacement"]["acquisition_costs"] = round(r.uniform(0, 2e5), 2)
        if r.random() < 0.7:
            inp["replacement"]["new_debt"] = round(inp["replacement"]["purchase_price"] * r.uniform(0, 1.1), 2)
    if r.random() < 0.7:
        props = []
        for i in range(r.randint(1, 7)):
            p = {"name": f"Candidate {i + 1}", "fair_market_value": round(rel["sale_price"] * r.uniform(0.1, 1.2), 2)}
            if r.random() < 0.5:
                p["identified_date"] = (date.fromisoformat(start) + timedelta(days=r.randint(0, 60))).isoformat()
            if r.random() < 0.5:
                p["received"] = True
                if r.random() < 0.6:
                    p["received_date"] = (date.fromisoformat(start) + timedelta(days=r.randint(0, 220))).isoformat()
            props.append(p)
        inp["identified_properties"] = props
    return inp


GENERATORS = {"amortization_schedule": amortization, "direct_cap": direct_cap, "dcf_pro_forma": dcf,
              "equity_waterfall": waterfall, "exchange_1031": exchange}


def valuation_cases(seed, count):
    r = random.Random(f"valuation-{seed}")
    names = sorted(GENERATORS)
    return [{"calc": (k := r.choice(names)), "input": GENERATORS[k](r)} for _ in range(max(1, count // 4))]
