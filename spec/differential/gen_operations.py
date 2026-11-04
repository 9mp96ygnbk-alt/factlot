"""Random inputs for the operations calculators (multifamily rent roll, capex recovery, batch CAM) and
the lease calculators' unit option, for the TypeScript/Python differential test. Synthetic data only.

A separate random stream, so the cases gen.py made before these calculators existed stay as they were.
"""

import random

STATUSES = ["occupied", "occupied", "occupied", "notice", "vacant", "model", "down"]
UNITS = ["sf", "kw", "mw", "unit", "acre", "key", "room", "space"]


def _date(r, lo=2024, hi=2028):
    return f"{r.randint(lo, hi)}-{r.randint(1, 12):02d}-{r.choice([1, 14, 15, 28, 29, 30, 31]):02d}"


def _valid_date(r, lo=2024, hi=2028):
    while True:
        s = _date(r, lo, hi)
        y, m, d = map(int, s.split("-"))
        if d <= [31, 29 if y % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]:
            return s


def _concession(r, rent):
    k = r.choice(["weeks_free", "months_free", "amount"])
    if k == "weeks_free":
        return {"type": k, "weeks": r.choice([1, 2, 4, 6, 8, round(r.uniform(0.5, 10), 1)])}
    if k == "months_free":
        return {"type": k, "months": r.choice([0.5, 1, 1.5, 2, round(r.uniform(0.1, 3), 2)])}
    return {"type": k, "amount": round(r.uniform(0, rent * 2), 2)}


def _unit(r, i):
    rent = round(r.uniform(700, 4500), r.choice([0, 2]))
    u = {"unit_id": f"{100 + i}", "status": r.choice(STATUSES), "market_rent": rent}
    if r.random() < 0.7:
        u["unit_type"] = r.choice(["S", "A1", "A2", "B1", "B2", "C3"])
    elif r.random() < 0.7:
        u["bedrooms"] = r.randint(0, 4)
    if r.random() < 0.85:
        u["sf"] = round(r.uniform(380, 1800), r.choice([0, 1]))
    leased = u["status"] in ("occupied", "notice")
    if leased or r.random() < 0.1:
        u["lease_rent"] = round(rent * r.uniform(0.85, 1.08), r.choice([0, 2]))
        if r.random() < 0.8:
            start = _valid_date(r, 2024, 2026)
            u["lease_start"] = start
            if r.random() < 0.9:
                y, m, d = map(int, start.split("-"))
                months = r.choice([6, 12, 12, 13, 15, 18, 24])
                t = y * 12 + m - 1 + months
                end_day = min(d, 28) - 1 or 28
                u["lease_end"] = f"{t // 12}-{t % 12 + 1:02d}-{end_day:02d}"
        if r.random() < 0.25 or "lease_end" not in u and r.random() < 0.5:
            u["lease_term_months"] = r.choice([6, 12, 13, 14.5, 18])
        if r.random() < 0.35:
            u["concession"] = _concession(r, u["lease_rent"])
            no_term = "lease_term_months" not in u and "lease_end" not in u
            if no_term and r.random() < 0.98:  # a concession with no term is an input error
                u["lease_term_months"] = 12
    return u


def rent_roll(r):
    if r.random() < 0.25:
        lease = {"lease_rent": round(r.uniform(700, 4500), 2)}
        if r.random() < 0.6:
            lease["lease_term_months"] = r.choice([1, 6, 12, 13, 14.5, 24])
        else:
            lease["lease_start"] = _valid_date(r, 2025, 2026)
            lease["lease_end"] = _valid_date(r, 2026, 2028)
        if r.random() < 0.8:
            lease["concession"] = _concession(r, lease["lease_rent"])
        if r.random() < 0.5:
            lease["market_rent"] = round(lease["lease_rent"] * r.uniform(0.9, 1.15), 2)
        if r.random() < 0.5:
            lease["sf"] = round(r.uniform(380, 1800), 0)
        return {"lease": lease}
    units = [_unit(r, i) for i in range(r.randint(1, 60))]
    if r.random() < 0.03 and len(units) > 1:
        units[1]["unit_id"] = units[0]["unit_id"]
    inp = {"as_of": _valid_date(r, 2025, 2027), "units": units}
    if r.random() < 0.3:
        inp["include_units"] = True
    return inp


def capex(r):
    n = r.randint(1, 40)
    inp = {"cost": round(r.uniform(1, 5e6), r.choice([0, 2])), "amortization_years": n,
           "method": r.choice(["straight_line", "level_payment"]),
           "interest_rate_annual": r.choice([0, round(r.uniform(0, 0.12), 4)])}
    if r.random() < 0.3:
        inp["period_basis"] = r.choice(["useful_life", "lease_specified"])
    if r.random() < 0.4:
        inp["first_year"] = r.randint(2015, 2035)
    if r.random() < 0.5:
        base = inp["cost"] / n
        cap = {"carry_forward": r.random() < 0.5}
        if r.random() < 0.5:
            cap["annual_savings"] = round(base * r.uniform(0.3, 1.6), 2)
        else:
            cap["savings_by_year"] = [round(base * r.uniform(0, 1.8), 2) for _ in range(n if r.random() < 0.95 else n + 1)]
        inp["cost_savings_cap"] = cap
    if r.random() < 0.6:
        k = r.randint(1, 8)
        inp["tenants"] = [{"name": f"T{i}", "pro_rata_share": round(r.uniform(0.01, 1.3 / k), 4)} for i in range(k)]
    if r.random() < 0.5:
        keys = ["cost", "amortization_period", "interest", "method", "cost_savings_cap", "pro_rata_share"]
        inp["clauses"] = {k: f"Lease §{r.randint(1, 30)}.{r.randint(1, 9)}" for k in keys if r.random() < 0.5}
    return inp


def cam_batch(r):
    cats = [f"c{i}" for i in range(r.randint(1, 8))]
    expenses = [{"category": c, "amount": round(r.uniform(0, 1e6), 2), "controllable": r.random() < 0.6,
                 "recoverable": r.random() < 0.85, "variable": r.random() < 0.4,
                 "admin_fee_applies": r.random() < 0.7} for c in cats]
    inp = {"year": 2026, "expenses": expenses}
    if r.random() < 0.6:
        inp["gross_up"] = {"actual_occupancy": round(r.uniform(0.3, 1), 3), "target_occupancy": r.choice([0.9, 0.95, 1])}
    tenants = []
    for i in range(r.randint(1, 6)):
        t = {"name": f"Suite {i}", "pro_rata_share": round(r.uniform(0.01, 0.5), 5),
             "estimates_paid": round(r.uniform(0, 2e5), 2),
             "structure": r.choice([{"type": "net"}, {"type": "base_year", "base_year_expenses": round(r.uniform(0, 3e6), 2)},
                                    {"type": "expense_stop", "stop_amount": round(r.uniform(0, 3e6), 2)}])}
        if r.random() < 0.5:
            m = r.choice(["compounding_from_base", "simple_from_base", "year_over_year"])
            t["cap"] = {"method": m, "rate": round(r.uniform(0, 0.08), 3), "reference_amount": round(r.uniform(0, 2e5), 2)}
            if m != "year_over_year" or r.random() < 0.3:
                t["cap"]["years_elapsed"] = r.randint(0, 10)
        if r.random() < 0.5:
            t["admin_fee"] = {"rate": round(r.uniform(0, 0.2), 3), "applied": r.choice(["before_cap", "after_cap"]),
                              "capped": r.random() < 0.5}
        if r.random() < 0.4:
            o = {}
            if r.random() < 0.7:
                o["move_in_date"] = r.choice(["2026-01-01", "2026-04-01", "2026-07-01", "2026-11-15"])
            if r.random() < 0.5:
                o["move_out_date"] = r.choice(["2026-12-31", "2026-12-15", "2026-08-31"])
            t["occupancy"] = o
        if r.random() < 0.3:
            t["excluded_categories"] = r.sample(cats, r.randint(1, len(cats)))
        if r.random() < 0.3:
            t["admin_fee_excluded_categories"] = r.sample(cats, r.randint(1, len(cats)))
        tenants.append(t)
    # At most one deliberate error per case: TypeScript lists every issue, Python stops at the first.
    bad = r.random()
    if bad < 0.02:
        r.choice(tenants)["excluded_categories"] = ["not-a-category"]
    elif bad < 0.04:
        r.choice(tenants)["cap"] = {"method": "simple_from_base", "rate": 0.03, "reference_amount": 1000}
    inp["tenants"] = tenants
    return inp


def lease_with_unit(r, sched_any):
    def sched():
        # A valid commencement date, so a deliberate unit error is the only error (TypeScript lists
        # every issue at once; Python stops at the first).
        s = sched_any()
        s["commencement_date"] = s["commencement_date"][:8] + min(s["commencement_date"][8:], "28")
        return s

    k = r.choice(["rent_schedule", "net_effective_rent", "compare_proposals"])
    unit = r.choice(UNITS)
    if k == "rent_schedule":
        return k, {**sched(), "unit": unit}
    if k == "net_effective_rent":
        return k, {"schedule": {**sched(), "unit": unit}, "ti_allowance_psf": round(r.uniform(0, 150), 2),
                   "discount_rate_annual": round(r.uniform(0, 0.15), 4)}
    props = [{"name": f"P{i}", "schedule": {**sched(), "unit": unit}, "ti_allowance_psf": round(r.uniform(0, 100), 2)}
             for i in range(r.randint(2, 4))]
    if r.random() < 0.1:
        props[1]["schedule"]["unit"] = r.choice(UNITS)
    if r.random() < 0.1:
        props[0]["load_factor"] = 1.1
    return k, {"perspective": r.choice(["tenant", "landlord"]), "discount_rate_annual": round(r.uniform(0, 0.15), 4),
               "proposals": props}


def operation_cases(seed, count, sched):
    """`count` calculator cases plus some run_tool cases (schema parity, unknown fields, provenance)."""
    r = random.Random(f"operations-{seed}")
    out = []
    for _ in range(count):
        k = r.choice(["multifamily_rent_roll", "capex_recovery", "cam_reconciliation_batch", "unit"])
        if k == "unit":
            k, inp = lease_with_unit(r, sched)
        else:
            inp = {"multifamily_rent_roll": rent_roll, "capex_recovery": capex, "cam_reconciliation_batch": cam_batch}[k](r)
        if r.random() < 0.15:
            args = dict(inp)
            if r.random() < 0.3:
                args["unitt" if k != "capex_recovery" else "cots"] = 1
            out.append({"tool": f"calc_{k}", "arguments": args})
        else:
            out.append({"calc": k, "input": inp})
    return out
