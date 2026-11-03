"""Deterministic, traceable CRE calculators — Python port of @factlot/calc.

Every function takes a JSON-shaped ``dict`` (the same snake_case input the TypeScript
package and MCP tools accept) and returns ``{"value", "formula", "steps", "warnings"}``.
Both implementations are held to the shared vectors in ``spec/vectors``.
"""

from __future__ import annotations

import math
from typing import Any, Callable

from ._core import (
    CalcInputError,
    Trace,
    array,
    boolean,
    enum,
    fail,
    fmt_money,
    fmt_pct,
    iso_date,
    join,
    nth_root,
    num_str,
    number,
    obj,
    pow_int,
    round_,
    sign,
    string,
)
from .dates import add_days, add_months, days_between

Result = dict[str, Any]

# --- rent schedule & NER ----------------------------------------------------------------


def _schedule_input(raw: Any, path: str = "") -> dict[str, Any]:
    d = obj(raw, path)
    esc_raw = d.get("escalation") or {"type": "none"}
    esc_path = join(path, "escalation")
    esc = obj(esc_raw, esc_path)
    kind = enum(esc, "type", ("none", "percent", "fixed_psf"), esc_path)
    if kind == "percent":
        esc = {
            "type": kind,
            "rate": number(esc, "rate", esc_path, gt=-1, lt=10),
            "every_months": number(esc, "every_months", esc_path, default=12, integer=True, gt=0),
        }
    elif kind == "fixed_psf":
        esc = {
            "type": kind,
            "amount": number(esc, "amount", esc_path),
            "every_months": number(esc, "every_months", esc_path, default=12, integer=True, gt=0),
        }
    else:
        esc = {"type": "none"}
    abated = array(d, "abated_months", path, default=[])
    for i, m in enumerate(abated):
        number({"m": m}, "m", join(join(path, "abated_months"), i), integer=True, gt=0)
    return {
        "commencement_date": iso_date(d, "commencement_date", path),
        "term_months": number(d, "term_months", path, integer=True, gt=0, le=1200),
        "area_sf": number(d, "area_sf", path, gt=0),
        "starting_rent_psf_annual": number(d, "starting_rent_psf_annual", path, ge=0),
        "escalation": esc,
        "abated_months": [int(m) for m in abated],
        "round_rate_to_cents": boolean(d, "round_rate_to_cents", path, default=False),
        "include_monthly": boolean(d, "include_monthly", path, default=False),
    }


def _build_months(s: dict[str, Any], t: Trace | None = None) -> list[dict[str, Any]]:
    esc = s["escalation"]
    abated = set(s["abated_months"])
    for m in abated:
        if m > s["term_months"]:
            raise CalcInputError(f"abated month {m} is beyond the {s['term_months']}-month term")

    def rate_for(month: int) -> float:
        if esc["type"] == "none":
            return s["starting_rent_psf_annual"]
        k = (month - 1) // esc["every_months"]
        r = (
            s["starting_rent_psf_annual"] * pow_int(1 + esc["rate"], k)
            if esc["type"] == "percent"
            else s["starting_rent_psf_annual"] + esc["amount"] * k
        )
        return round_(r, 2) if s["round_rate_to_cents"] else r

    if t is not None:
        if esc["type"] == "percent":
            t.step("Escalation", f"{fmt_pct(esc['rate'])} compounding every {esc['every_months']} months",
                   "rate_k = starting_rate × (1 + r)^k")
        elif esc["type"] == "fixed_psf":
            t.step("Escalation", f"+${num_str(esc['amount'])}/SF/yr every {esc['every_months']} months",
                   "rate_k = starting_rate + amount × k")
    months = []
    for m in range(1, s["term_months"] + 1):
        rate = rate_for(m)
        scheduled = round_(rate * s["area_sf"] / 12, 2)
        is_abated = m in abated
        months.append({
            "month": m,
            "start_date": add_months(s["commencement_date"], m - 1),
            "end_date": add_days(add_months(s["commencement_date"], m), -1),
            "rent_psf_annual": rate,
            "scheduled_rent": scheduled,
            "abated": is_abated,
            "rent_due": 0 if is_abated else scheduled,
        })
    return months


def _sum(values: list[float]) -> float:
    total = 0.0
    for v in values:
        total += v
    return total


def rent_schedule(raw: Any) -> Result:
    s = _schedule_input(raw)
    t = Trace()
    months = _build_months(s, t)
    steps: list[dict[str, Any]] = []
    last_rate = None
    for m in months:
        if steps and last_rate == m["rent_psf_annual"]:
            steps[-1]["last_month"] = m["month"]
            steps[-1]["end_date"] = m["end_date"]
            if m["abated"]:
                steps[-1]["abated_months"] += 1
        else:
            steps.append({
                "step": len(steps),
                "first_month": m["month"],
                "last_month": m["month"],
                "start_date": m["start_date"],
                "end_date": m["end_date"],
                "rent_psf_annual": round_(m["rent_psf_annual"], 4),
                "monthly_rent": m["scheduled_rent"],
                "abated_months": 1 if m["abated"] else 0,
            })
            last_rate = m["rent_psf_annual"]
    total_sched = round_(_sum([m["scheduled_rent"] for m in months]), 2)
    total_due = round_(_sum([m["rent_due"] for m in months]), 2)
    total_abate = round_(total_sched - total_due, 2)
    t.step("Monthly rent", "rate × area_sf ÷ 12, rounded to cents", None, "USD")
    t.step("Total scheduled rent", total_sched, "Σ monthly scheduled rent", "USD")
    t.step("Total abatement", total_abate, f"{len(s['abated_months'])} abated months", "USD")
    t.step("Total rent due", total_due, f"{fmt_money(total_sched)} − {fmt_money(total_abate)}", "USD")
    if not s["round_rate_to_cents"] and s["escalation"]["type"] == "percent":
        t.warn("Escalated $/SF rates are not rounded per step; set round_rate_to_cents if the lease table rounds.")
    value: dict[str, Any] = {
        "expiration_date": months[-1]["end_date"],
        "steps": steps,
        "total_scheduled_rent": total_sched,
        "total_abatement": total_abate,
        "total_rent_due": total_due,
    }
    if s["include_monthly"]:
        value["monthly"] = months
    return t.result("calc.rent_schedule", 1, value)


def _money(d: dict[str, Any], key: str, path: str = "", default: float = 0) -> float:
    return number(d, key, path, default=default, ge=0)


def net_effective_rent(raw: Any) -> Result:
    d = obj(raw)
    s = _schedule_input(d.get("schedule"), "schedule")
    ti_psf = _money(d, "ti_allowance_psf")
    lc = _money(d, "leasing_commissions")
    other = _money(d, "other_concessions")
    disc = number(d, "discount_rate_annual", default=0, ge=0, lt=1)
    t = Trace()
    months = _build_months(s, t)
    n = len(months)
    area = s["area_sf"]
    years = t.step("Term", n / 12, f"{n} months ÷ 12", "years")
    total = t.step("Total rent due", round_(_sum([m["rent_due"] for m in months]), 2), "Σ rent due", "USD")
    ti = t.step("TI allowance", round_(ti_psf * area, 2), f"${num_str(ti_psf)}/SF × {num_str(area)} SF", "USD")
    costs = t.step("Total landlord costs", round_(ti + lc + other, 2),
                   f"{fmt_money(ti)} TI + {fmt_money(lc)} LC + {fmt_money(other)} other", "USD")
    eff = t.step("Effective rent", round_(total / area / years, 4), "total rent due ÷ area ÷ years", "USD/sf/yr")
    ner = t.step("Net effective rent (straight-line)", round_((total - costs) / area / years, 4),
                 "(total rent due − landlord costs) ÷ area ÷ years", "USD/sf/yr")
    r = disc / 12
    pv = 0.0
    annuity = 0.0
    for i in range(n):
        df = pow_int(1 + r, -i)
        pv += months[i]["rent_due"] * df
        annuity += df
    pv_rent = t.step("PV of rent", round_(pv, 2), f"Σ rent_due_t ÷ (1 + r)^t, t = 0..{n - 1}", "USD")
    level = (pv - costs) / annuity
    dner = t.step("Discounted net effective rent", round_(level * 12 / area, 4),
                  "((PV rent − costs) ÷ Σ(1+r)^−t) × 12 ÷ area", "USD/sf/yr")
    if disc == 0:
        t.warn("discount_rate_annual is 0, so discounted NER equals straight-line NER.")
    return t.result("calc.net_effective_rent", 1, {
        "effective_rent_psf": eff,
        "net_effective_rent_psf": ner,
        "discounted_net_effective_rent_psf": dner,
        "total_rent_due": total,
        "total_landlord_costs": costs,
        "pv_rent": pv_rent,
    })


# --- CAM ----------------------------------------------------------------------------------

CAP_METHODS = ("compounding_from_base", "simple_from_base", "year_over_year")


def cam_reconciliation(raw: Any) -> Result:
    d = obj(raw)
    number(d, "year", integer=True, ge=1900, le=2200)
    share = number(d, "pro_rata_share", gt=0, le=1)
    expenses = []
    for i, e in enumerate(array(d, "expenses", min_len=1)):
        p = join("expenses", i)
        e = obj(e, p)
        expenses.append({
            "category": string(e, "category", p, min_len=1),
            "amount": number(e, "amount", p, ge=0),
            "controllable": boolean(e, "controllable", p, default=True),
            "recoverable": boolean(e, "recoverable", p, default=True),
            "variable": boolean(e, "variable", p, default=False),
        })
    gross_up = None
    if d.get("gross_up") is not None:
        g = obj(d["gross_up"], "gross_up")
        gross_up = (number(g, "actual_occupancy", "gross_up", gt=0, le=1),
                    number(g, "target_occupancy", "gross_up", default=0.95, gt=0, le=1))
    st = obj(d.get("structure") or {"type": "net"}, "structure")
    st_type = enum(st, "type", ("net", "base_year", "expense_stop"), "structure")
    cap = None
    if d.get("cap") is not None:
        c = obj(d["cap"], "cap")
        cap = {
            "method": enum(c, "method", CAP_METHODS, "cap"),
            "rate": number(c, "rate", "cap", ge=0, lt=10),
            "reference_amount": number(c, "reference_amount", "cap", ge=0),
            "years_elapsed": number(c, "years_elapsed", "cap", optional=True, integer=True, ge=0),
        }
    estimates = _money(d, "estimates_paid")

    t = Trace()
    recoverable = [e for e in expenses if e["recoverable"]]
    excluded = [e for e in expenses if not e["recoverable"]]
    rec_total = t.step("Recoverable expenses", round_(_sum([e["amount"] for e in recoverable]), 2),
                       f"excludes {', '.join(e['category'] for e in excluded)}" if excluded else "all expenses recoverable",
                       "USD")
    factor = 1.0
    if gross_up:
        actual, target = gross_up
        factor = target / actual if actual < target else 1
        t.step("Gross-up factor (variable expenses)", round_(factor, 6),
               f"{fmt_pct(target)} target ÷ {fmt_pct(actual)} actual" if actual < target else "occupancy ≥ target; no gross-up")
    adjusted = [{**e, "amount": e["amount"] * factor if e["variable"] else e["amount"]} for e in recoverable]
    grossed = t.step("Recoverable expenses after gross-up", round_(_sum([e["amount"] for e in adjusted]), 2), None, "USD")
    ctrl_total = _sum([e["amount"] for e in adjusted if e["controllable"]])
    unctrl_total = _sum([e["amount"] for e in adjusted if not e["controllable"]])
    ctrl_share = t.step("Tenant share of controllable", round_(ctrl_total * share, 2),
                        f"{fmt_money(ctrl_total)} × {num_str(share)}", "USD")
    unctrl_share = t.step("Tenant share of uncontrollable", round_(unctrl_total * share, 2),
                          f"{fmt_money(unctrl_total)} × {num_str(share)}", "USD")
    cap_limit = None
    capped = ctrl_share
    if cap:
        method, rate, ref, n = cap["method"], cap["rate"], cap["reference_amount"], cap["years_elapsed"]
        if method != "year_over_year" and n is None:
            raise CalcInputError(f"cap.years_elapsed is required for {method}")
        years = 1 if n is None else n
        if method == "compounding_from_base":
            limit, formula = ref * pow_int(1 + rate, years), f"{fmt_money(ref)} × (1 + {num_str(rate)})^{years}"
        elif method == "simple_from_base":
            limit, formula = ref * (1 + rate * years), f"{fmt_money(ref)} × (1 + {num_str(rate)} × {years})"
        else:
            limit, formula = ref * (1 + rate), f"{fmt_money(ref)} × (1 + {num_str(rate)})"
        cap_limit = t.step(f"Cap limit ({method})", round_(limit, 2), formula, "USD")
        capped = t.step("Controllable after cap", min(ctrl_share, cap_limit), "min(tenant controllable, cap limit)", "USD")
    cap_reduction = round_(ctrl_share - capped, 2)
    deduction = 0.0
    if st_type == "base_year":
        base = number(st, "base_year_expenses", "structure", ge=0)
        deduction = t.step("Base-year deduction", round_(base * share, 2), f"{fmt_money(base)} × {num_str(share)}", "USD")
        if cap:
            t.warn("Cap applied before the base-year deduction; confirm the lease's order of operations.")
    elif st_type == "expense_stop":
        stop = number(st, "stop_amount", "structure", ge=0)
        deduction = t.step("Expense-stop deduction", round_(stop * share, 2), f"{fmt_money(stop)} × {num_str(share)}", "USD")
        if cap:
            t.warn("Cap applied before the expense-stop deduction; confirm the lease's order of operations.")
    charge = t.step("Tenant CAM charge", round_(max(0, capped + unctrl_share - deduction), 2),
                    f"max(0, {fmt_money(capped)} + {fmt_money(unctrl_share)} − {fmt_money(deduction)})", "USD")
    balance = t.step("Balance due", round_(charge - estimates, 2),
                     f"{fmt_money(charge)} − {fmt_money(estimates)} estimates paid", "USD")
    if not cap:
        t.warn("No CAM cap supplied; confirm the lease has none.")
    return t.result("calc.cam_reconciliation", 1, {
        "recoverable_expenses": rec_total,
        "grossed_up_expenses": grossed,
        "tenant_share_controllable": ctrl_share,
        "tenant_share_uncontrollable": unctrl_share,
        "cap_limit": cap_limit,
        "cap_reduction": cap_reduction,
        "structure_deduction": deduction,
        "tenant_charge": charge,
        "estimates_paid": estimates,
        "balance_due": balance,
    })


# --- debt -----------------------------------------------------------------------------------


def annual_constant(rate_annual: float, amortization_years: int) -> float:
    """Annual debt service per dollar of loan, with monthly payments."""
    if amortization_years == 0:
        return rate_annual
    n = amortization_years * 12
    r = rate_annual / 12
    return 12 / n if r == 0 else (12 * r) / (1 - pow_int(1 + r, -n))


def debt_sizing(raw: Any) -> Result:
    d = obj(raw)
    noi = number(d, "noi", gt=0)
    value = number(d, "value", optional=True, gt=0)
    rate = number(d, "rate_annual", ge=0, lt=1)
    amort = number(d, "amortization_years", integer=True, ge=0, le=50)
    max_ltv = number(d, "max_ltv", optional=True, gt=0, le=1)
    min_dscr = number(d, "min_dscr", optional=True, gt=0)
    min_dy = number(d, "min_debt_yield", optional=True, gt=0, lt=1)
    step = number(d, "round_down_to", default=1, gt=0)
    if max_ltv is None and min_dscr is None and min_dy is None:
        fail("", "provide at least one of max_ltv, min_dscr, min_debt_yield")
    if max_ltv is not None and value is None:
        fail("value", "value is required when max_ltv is set")

    t = Trace()
    k = t.step("Annual constant", annual_constant(rate, amort),
               f"interest-only: {fmt_pct(rate, 3)}" if amort == 0
               else f"12 × r ÷ (1 − (1 + r)^−n), r = {num_str(rate)}/12, n = {amort * 12}")
    loans: dict[str, float] = {}
    if max_ltv is not None:
        loans["ltv"] = t.step("Loan at max LTV", value * max_ltv, f"{fmt_money(value)} × {num_str(max_ltv)}", "USD")
    if min_dscr is not None:
        loans["dscr"] = t.step("Loan at min DSCR", noi / min_dscr / k,
                               f"({fmt_money(noi)} ÷ {num_str(min_dscr)}) ÷ {num_str(round_(k, 6))}", "USD")
    if min_dy is not None:
        loans["debt_yield"] = t.step("Loan at min debt yield", noi / min_dy, f"{fmt_money(noi)} ÷ {num_str(min_dy)}", "USD")
    binding, min_loan = None, math.inf
    for c, v in loans.items():
        if binding is None or v < min_loan:
            binding, min_loan = c, v
    if min_loan <= 0:
        raise CalcInputError("constraints produce a non-positive loan")
    loan = t.step("Max loan", math.floor(min_loan / step) * step,
                  "min(" + ", ".join(f"{c} {fmt_money(v)}" for c, v in loans.items()) + f"), rounded down to {num_str(step)}",
                  "USD")
    t.step("Binding constraint", binding)
    ds = round_(loan * k, 2)
    return t.result("calc.debt_sizing", 1, {
        "max_loan": loan,
        "binding_constraint": binding,
        "loan_by_constraint": {c: round_(v, 2) for c, v in loans.items()},
        "annual_constant": round_(k, 8),
        "annual_debt_service": ds,
        "resulting": {
            "ltv": round_(loan / value, 4) if value is not None else None,
            "dscr": round_(noi / ds, 4),
            "debt_yield": round_(noi / loan, 4),
        },
    })


# --- ASC 842 lease remeasurement (lessee) -----------------------------------------------------

REMEASUREMENT_EVENTS = (
    "modification_extend_term",
    "modification_shorten_term",
    "modification_change_in_payments",
    "reassessment_of_term_or_option",
    "contingency_resolved",
    "residual_value_guarantee_change",
    "index_or_rate_change",
)
_RATE_UPDATE_EVENTS = REMEASUREMENT_EVENTS[:4]
_RATE_KEEP_EVENTS = ("contingency_resolved", "residual_value_guarantee_change")
_EVENT_CITATION = {
    "modification_extend_term": "ASC 842-10-25-8 and 25-11: modification not accounted for as a separate contract; remeasure and reallocate at the effective date",
    "modification_shorten_term": "ASC 842-10-25-8 and 25-11: modification not accounted for as a separate contract; remeasure and reallocate at the effective date",
    "modification_change_in_payments": "ASC 842-10-25-8 and 25-11: modification not accounted for as a separate contract; remeasure and reallocate at the effective date",
    "reassessment_of_term_or_option": "ASC 842-10-35-1 and 35-4(c)(1)-(2): change in lease term or purchase-option assessment",
    "contingency_resolved": "ASC 842-10-35-4(b): contingency resolved so variable payments now meet the definition of lease payments",
    "residual_value_guarantee_change": "ASC 842-10-35-4(c)(3): change in amounts probable of being owed under a residual value guarantee",
    "index_or_rate_change": "ASC 842-10-35-4: index or rate changes update payments only when remeasuring for another reason",
}


def lease_remeasurement_asc842(raw: Any) -> Result:
    d = obj(raw)
    classification = enum(d, "classification", ("operating", "finance"))
    payments = []
    last = 0
    for i, p_raw in enumerate(array(d, "payments", min_len=1)):
        p = join("payments", i)
        pd = obj(p_raw, p)
        period = number(pd, "period", p, integer=True, ge=1, le=1200)
        amount = number(pd, "amount", p, ge=0)
        if period <= last:
            fail(join(p, "period"), "periods must be strictly increasing")
        last = period
        payments.append((period, amount))
    remaining = number(d, "remaining_periods", optional=True, integer=True, ge=1, le=1200)
    if remaining is not None and remaining < last:
        fail("remaining_periods", "remaining_periods must be at least the last payment period")
    timing = enum(d, "payment_timing", ("begin", "end"), default="end")
    rate_annual = number(d, "discount_rate_annual", ge=0, lt=1)
    ppy = number(d, "periods_per_year", default=12, integer=True, ge=1, le=365)
    updated = d.get("discount_rate_updated")
    if not isinstance(updated, bool):
        fail("discount_rate_updated", "required" if updated is None else "expected boolean")
    liability_before = number(d, "liability_before", ge=0)
    rou_before = number(d, "rou_asset_before", ge=0)
    event = enum(d, "event", REMEASUREMENT_EVENTS)

    n = last if remaining is None else remaining
    by_period = dict(payments)
    in_advance = timing == "begin"
    t = Trace()
    t.step("Event", event, _EVENT_CITATION[event])
    t.step("Remaining term", n, "periods after the remeasurement date")
    r = t.step("Periodic discount rate", rate_annual / ppy,
               f"{fmt_pct(rate_annual, 4)} ÷ {ppy}"
               + (" (rate updated at remeasurement, ASC 842-10-35-5)" if updated else " (original rate retained)"))
    total = 0.0
    pv = 0.0
    for k in range(1, n + 1):
        p = by_period.get(k, 0)
        total += p
        pv += p * pow_int(1 + r, -(k - 1) if in_advance else -k)
    total_payments = t.step("Remaining lease payments", round_(total, 2), "Σ payment_k, k = 1..n", "USD")
    new_liability = t.step(
        "New lease liability", round_(pv, 2),
        f"ASC 842-10-35-4 and 842-20-35-3: Σ payment_k ÷ (1 + r)^{'(k − 1)' if in_advance else 'k'}, "
        f"r = {num_str(round_(r, 8))}, payments in {'advance' if in_advance else 'arrears'}", "USD")
    liability_adj = t.step("Liability adjustment", round_(new_liability - liability_before, 2),
                           f"{fmt_money(new_liability)} − {fmt_money(liability_before)} carrying amount", "USD")
    rou_adj = t.step("ROU asset adjustment", round_(max(liability_adj, -rou_before), 2),
                     f"ASC 842-20-35-4: liability change adjusts the ROU asset, floored at −{fmt_money(rou_before)} "
                     "so the asset is not reduced below zero", "USD")
    gain = t.step("Gain recognized", round_(rou_adj - liability_adj, 2),
                  "ASC 842-20-35-4: remeasurement in excess of the ROU asset carrying amount goes to profit or loss", "USD")
    new_rou = t.step("New ROU asset", round_(rou_before + rou_adj, 2), f"{fmt_money(rou_before)} + {fmt_money(rou_adj)}", "USD")

    operating = classification == "operating"
    sl_cost = 0.0
    amort_per = 0.0
    if operating:
        sl_cost = t.step("Straight-line lease cost", round_((total + new_rou - new_liability) / n, 2),
                         f"ASC 842-20-25-6: (remaining payments {fmt_money(total)} + ROU {fmt_money(new_rou)} − "
                         f"liability {fmt_money(new_liability)}) ÷ {n}", "USD/period")
    else:
        amort_per = t.step("ROU amortization per period", round_(new_rou / n, 2),
                           f"ASC 842-20-35-7: {fmt_money(new_rou)} ÷ {n} straight-line over the remaining term", "USD/period")
    t.step("Schedule",
           "ASC 842-20-25-6 and 842-20-35-3: interest = opening liability × r; ROU amortization = straight-line cost − interest"
           if operating else
           "ASC 842-20-25-5 and 842-20-35-1: interest = opening liability × r; lease cost = interest + amortization",
           "payment in advance: interest accrues on (opening liability − payment)" if in_advance
           else "payment in arrears: interest accrues on the opening liability")

    schedule = []
    liability = new_liability
    rou = new_rou
    sum_interest = 0.0
    sum_amort = 0.0
    sl_unrounded = (total + new_rou - new_liability) / n
    amort_unrounded = new_rou / n
    for k in range(1, n + 1):
        opening = liability
        p = by_period.get(k, 0)
        interest = (opening - p if in_advance else opening) * r
        closing = opening + interest - p
        amort = sl_unrounded - interest if operating else amort_unrounded
        cost = sl_unrounded if operating else interest + amort
        rou -= amort
        sum_interest += interest
        sum_amort += amort
        schedule.append({
            "period": k,
            "opening_liability": round_(opening, 2),
            "payment": round_(p, 2),
            "interest": round_(interest, 2),
            "closing_liability": round_(closing, 2),
            "amortization": round_(amort, 2),
            "closing_rou_asset": round_(rou, 2),
            "lease_cost": round_(cost, 2),
        })
        liability = closing

    if not updated and event in _RATE_UPDATE_EVENTS:
        t.warn("ASC 842-10-35-5 (and 842-10-25-11 for modifications) require a discount rate determined at the "
               "remeasurement date for this event; discount_rate_updated is false.")
    if updated and event in _RATE_KEEP_EVENTS:
        t.warn("ASC 842-10-35-5(b)-(c): the discount rate is not updated for a contingency resolution or a change in "
               "amounts probable under a residual value guarantee; discount_rate_updated is true.")
    if event == "index_or_rate_change":
        t.warn("ASC 842-10-35-4: a change in an index or rate alone does not remeasure the liability; payments are "
               "updated for the index only when the liability is remeasured for another reason. Otherwise the "
               "difference is variable lease cost in the period incurred.")
    if event == "modification_shorten_term":
        t.warn("ASC 842-10-25-13: a modification that fully or partially terminates the lease requires a proportionate "
               "reduction of the ROU asset with a gain or loss. This result applies the ASC 842-20-35-4 "
               "liability-change adjustment only; decide whether the shortened term is a partial termination.")
    if gain > 0:
        t.warn("The liability decrease exceeded the ROU asset carrying amount; the excess is recognized in profit or "
               "loss (ASC 842-20-35-4).")
    if not operating:
        t.warn("Finance-lease amortization runs straight-line over the remaining lease term; use the remaining useful "
               "life instead when ownership transfers or a purchase option is reasonably certain (ASC 842-20-35-8).")

    return t.result("calc.lease_remeasurement_asc842", 1, {
        "classification": classification,
        "remaining_periods": n,
        "periodic_rate": round_(r, 8),
        "total_remaining_payments": total_payments,
        "new_lease_liability": new_liability,
        "liability_adjustment": liability_adj,
        "rou_asset_adjustment": rou_adj,
        "gain_recognized": gain,
        "new_rou_asset": new_rou,
        "straight_line_lease_cost": sl_cost if operating else None,
        "periodic_amortization": None if operating else amort_per,
        "total_interest": round_(sum_interest, 2),
        "total_amortization": round_(sum_amort, 2),
        "schedule": schedule,
    })


# --- prepayment and defeasance ----------------------------------------------------------------


def monthly_rate(annual: float, convention: str) -> float:
    """Monthly rate for an annual rate under a discount convention (identical to @factlot/calc ``monthlyRate``)."""
    return annual / 12 if convention == "monthly" else nth_root(1 + annual / 2, 6) - 1


def _rate(d: dict[str, Any], key: str, path: str = "", **kw: Any) -> Any:
    return number(d, key, path, ge=0, lt=1, **kw)


def prepayment_and_defeasance(raw: Any) -> Result:
    d = obj(raw)
    B = number(d, "balance", gt=0)
    note_rate = _rate(d, "note_rate_annual")
    n = number(d, "remaining_term_months", integer=True, ge=1, le=600)
    A = number(d, "amortization_months", integer=True, ge=0, le=720)
    accrued = number(d, "accrued_interest", default=0, ge=0)
    pp = obj(d.get("prepayment"), "prepayment")
    kind = enum(pp, "type", ("yield_maintenance", "step_down", "fixed_pct", "defeasance"), "prepayment")
    if kind == "yield_maintenance":
        p = {
            "treasury_rate_annual": _rate(pp, "treasury_rate_annual", "prepayment"),
            "spread_annual": _rate(pp, "spread_annual", "prepayment", default=0),
            "minimum_pct": _rate(pp, "minimum_pct", "prepayment", default=0.01),
            "basis": enum(pp, "basis", ("pv_of_payments", "rate_differential"), "prepayment", default="pv_of_payments"),
            "discount_convention": enum(pp, "discount_convention", ("monthly", "semiannual"), "prepayment", default="monthly"),
        }
    elif kind == "step_down":
        schedule = []
        last = 0
        for i, s_raw in enumerate(array(pp, "schedule", "prepayment", min_len=1)):
            sp = join(join("prepayment", "schedule"), i)
            sd = obj(s_raw, sp)
            through = number(sd, "through_month", sp, integer=True, ge=1)
            pct = _rate(sd, "pct", sp)
            if through <= last:
                fail(join(sp, "through_month"), "through_month must be strictly increasing")
            last = through
            schedule.append((through, pct))
        p = {"loan_month": number(pp, "loan_month", "prepayment", integer=True, ge=1), "schedule": schedule}
    elif kind == "fixed_pct":
        p = {"pct": _rate(pp, "pct", "prepayment")}
    else:
        ry = pp.get("replacement_yield")
        ry_path = join("prepayment", "replacement_yield")
        if isinstance(ry, list):
            curve = []
            last = 0
            for i, y_raw in enumerate(array(pp, "replacement_yield", "prepayment", min_len=1)):
                yp = join(ry_path, i)
                yd = obj(y_raw, yp)
                months = number(yd, "months", yp, integer=True, ge=1)
                rate = _rate(yd, "rate", yp)
                if months <= last:
                    fail(join(yp, "months"), "months must be strictly increasing")
                last = months
                curve.append((months, rate))
            flat = None
        else:
            flat = _rate(pp, "replacement_yield", "prepayment")
            curve = [(n, flat)]
        p = {
            "flat": flat,
            "curve": curve,
            "costs": number(pp, "costs", "prepayment", default=0, ge=0),
            "discount_convention": enum(pp, "discount_convention", ("monthly", "semiannual"), "prepayment", default="monthly"),
        }
    if A != 0 and A < n:
        fail("amortization_months", "amortization_months must be 0 (interest-only) or at least remaining_term_months")

    t = Trace()
    i = note_rate / 12
    payment = B * i if A == 0 else (B / A if i == 0 else (B * i) / (1 - pow_int(1 + i, -A)))
    pmt = t.step("Monthly payment", round_(payment, 2),
                 f"interest-only: {fmt_money(B)} × {fmt_pct(note_rate, 4)} ÷ 12" if A == 0
                 else f"{fmt_money(B)} × i ÷ (1 − (1 + i)^−{A}), i = {fmt_pct(note_rate, 4)} ÷ 12", "USD")
    openings = []
    bal = B
    for _k in range(1, n + 1):
        openings.append(bal)
        bal = bal + bal * i - payment
    balloon_raw = max(0, bal)
    balloon = t.step("Balloon at maturity", round_(balloon_raw, 2), f"scheduled balance after {n} payments", "USD")
    pays = [payment + balloon_raw if idx == n - 1 else payment for idx in range(n)]
    total_pay = 0.0
    for v in pays:
        total_pay += v
    total_payments = t.step("Remaining scheduled payments", round_(total_pay, 2), f"{n} × {fmt_money(payment)} + balloon", "USD")

    detail: dict[str, Any] = {}
    if kind == "yield_maintenance":
        dr = p["treasury_rate_annual"] + p["spread_annual"]
        m = monthly_rate(dr, p["discount_convention"])
        t.step("Discount rate", round_(m, 10),
               f"({fmt_pct(p['treasury_rate_annual'], 4)} Treasury + {fmt_pct(p['spread_annual'], 4)} spread) → monthly, "
               f"{p['discount_convention']} convention")
        if p["basis"] == "pv_of_payments":
            pv = 0.0
            for k in range(1, n + 1):
                pv += pays[k - 1] * pow_int(1 + m, -k)
            pv_rounded = t.step("PV of remaining payments", round_(pv, 2),
                                f"Σ payment_k ÷ (1 + {num_str(round_(m, 8))})^k, k = 1..{n}", "USD")
            computed = t.step("Yield maintenance (before floor)", round_(pv - B, 2),
                              f"{fmt_money(pv_rounded)} − {fmt_money(B)} balance", "USD")
            detail["pv_of_remaining_payments"] = pv_rounded
        else:
            diff = (note_rate - dr) / 12
            pv = 0.0
            for k in range(1, n + 1):
                pv += diff * openings[k - 1] * pow_int(1 + m, -k)
            computed = t.step("Yield maintenance (before floor)", round_(pv, 2),
                              f"Σ ({fmt_pct(note_rate, 4)} − {fmt_pct(dr, 4)}) ÷ 12 × balance_(k−1) ÷ "
                              f"(1 + {num_str(round_(m, 8))})^k, k = 1..{n}", "USD")
        floor = t.step("Minimum premium", round_(B * p["minimum_pct"], 2), f"{fmt_money(B)} × {fmt_pct(p['minimum_pct'], 4)}", "USD")
        premium = t.step("Prepayment premium", max(computed, floor), "max(yield maintenance, minimum)", "USD")
        detail["basis"] = p["basis"]
        detail["discount_rate_annual"] = round_(dr, 8)
        detail["discount_rate_monthly"] = round_(m, 10)
        detail["computed_premium"] = computed
        detail["minimum_premium"] = floor
        t.warn(f"Yield maintenance computed on the {p['basis']} basis, discounting {p['discount_convention']} at "
               f"Treasury{' plus spread' if p['spread_annual'] > 0 else ' flat'}; notes differ on all three, so match "
               "them to the loan documents.")
    elif kind == "step_down":
        tier = next((s for s in p["schedule"] if p["loan_month"] <= s[0]), None)
        pct = tier[1] if tier else 0
        t.step("Applicable percentage", pct,
               f"loan month {p['loan_month']} ≤ {tier[0]}" if tier
               else f"loan month {p['loan_month']} is after the last step (open)")
        premium = t.step("Prepayment premium", round_(B * pct, 2), f"{fmt_money(B)} × {fmt_pct(pct, 4)}", "USD")
        detail["applied_pct"] = pct
        detail["loan_month"] = p["loan_month"]
        t.warn("Lockout periods are not modeled: if the note is locked out in this loan month, it cannot be prepaid at any premium.")
    elif kind == "fixed_pct":
        premium = t.step("Prepayment premium", round_(B * p["pct"], 2), f"{fmt_money(B)} × {fmt_pct(p['pct'], 4)}", "USD")
        detail["applied_pct"] = p["pct"]
    else:
        curve = p["curve"]
        last_rate = curve[-1][1]

        def yield_for(k: int) -> float:
            return next((rate for months, rate in curve if k <= months), last_rate)

        cost = 0.0
        for k in range(1, n + 1):
            m = monthly_rate(yield_for(k), p["discount_convention"])
            cost += pays[k - 1] * pow_int(1 + m, -k)
        securities = t.step("Cost of replacement securities", round_(cost, 2),
                            f"Σ payment_k ÷ (1 + y)^k at {fmt_pct(p['flat'], 4)} ({p['discount_convention']})" if p["flat"] is not None
                            else f"Σ payment_k ÷ (1 + y_k)^k with y_k from the {len(curve)}-point curve ({p['discount_convention']})",
                            "USD")
        costs = t.step("Defeasance costs", round_(p["costs"], 2), "as stated", "USD")
        premium = t.step("Prepayment premium", round_(securities + costs - B, 2),
                         f"{fmt_money(securities)} + {fmt_money(costs)} − {fmt_money(B)} balance", "USD")
        detail["securities_cost"] = securities
        detail["stated_costs"] = costs
        t.warn("Securities cost approximates the defeasance portfolio by discounting each payment at the stated yield; "
               "the actual portfolio is priced from specific Treasury or agency securities and may leave a residual "
               "(float) value. Get a consultant's quote before relying on it.")
        if premium < 0:
            t.warn("Replacement yields exceed the note rate, so the securities cost less than the balance; whether the "
                   "borrower keeps that benefit depends on the loan documents.")

    payoff = t.step("Total payoff", round_(B + premium + accrued, 2),
                    f"{fmt_money(B)} balance + {fmt_money(premium)} premium + {fmt_money(accrued)} accrued interest", "USD")
    ratio = t.step("Effective cost", round_(premium / B, 6),
                   f"{fmt_money(premium)} ÷ {fmt_money(B)} = {fmt_pct(premium / B, 3)} of balance")
    return t.result("calc.prepayment_and_defeasance", 1, {
        "prepayment_type": kind,
        "monthly_payment": pmt,
        "balloon_at_maturity": balloon,
        "total_remaining_payments": total_payments,
        "prepayment_premium": premium,
        "total_payoff": payoff,
        "effective_cost_ratio": ratio,
        "detail": detail,
    })


# --- portfolio --------------------------------------------------------------------------------


def walt(raw: Any) -> Result:
    d = obj(raw)
    as_of = iso_date(d, "as_of")
    weight_by = enum(d, "weight_by", ("area", "rent"), default="area")
    key = "area_sf" if weight_by == "area" else "annual_rent"
    leases = []
    for i, lease in enumerate(array(d, "leases", min_len=1)):
        p = join("leases", i)
        lease = obj(lease, p)
        leases.append({
            "expiration_date": iso_date(lease, "expiration_date", p),
            "area_sf": number(lease, "area_sf", p, optional=True, gt=0),
            "annual_rent": number(lease, "annual_rent", p, optional=True, gt=0),
        })
    t = Trace()
    weighted = total = 0.0
    expired = 0
    for i, lease in enumerate(leases):
        w = lease[key]
        if w is None:
            raise CalcInputError(f"leases.{i}.{key} is required when weight_by is {weight_by}")
        years = max(0, days_between(as_of, lease["expiration_date"]) / 365.25)
        if years == 0:
            expired += 1
        weighted += w * years
        total += w
    t.step("Total weight", round_(total, 2), f"Σ {key}")
    result = t.step("WALT", round_(weighted / total, 4), f"Σ({key} × years remaining) ÷ Σ {key}", "years")
    if expired:
        t.warn(f"{expired} lease(s) expired on or before {as_of}; counted as 0 years remaining.")
    return t.result("calc.walt", 1, {"walt_years": result, "total_weight": round_(total, 2), "expired_count": expired})


# --- finance --------------------------------------------------------------------------------


def _cash_flows(d: dict[str, Any]) -> list[float]:
    flows = array(d, "cash_flows", min_len=2)
    for i, cf in enumerate(flows):
        number({"cf": cf}, "cf", join("cash_flows", i))
    return flows


def _npv_at(flows: list[float], r: float) -> float:
    acc = 0.0
    for i, cf in enumerate(flows):
        acc += cf / pow_int(1 + r, i)
    return acc


def npv(raw: Any) -> Result:
    d = obj(raw)
    flows = _cash_flows(d)
    rate = number(d, "rate", gt=-1)
    t = Trace()
    v = t.step("NPV", round_(_npv_at(flows, rate), 2), f"Σ CF_t ÷ (1 + {num_str(rate)})^t")
    return t.result("calc.npv", 1, {"npv": v})


def irr(raw: Any) -> Result:
    d = obj(raw)
    flows = _cash_flows(d)
    ppy = number(d, "periods_per_year", default=1, integer=True, gt=0)
    if not any(c > 0 for c in flows) or not any(c < 0 for c in flows):
        raise CalcInputError("IRR needs at least one positive and one negative cash flow")
    t = Trace()
    grid = [-0.9999] + [i / 100 for i in range(-99, 1001)]
    roots: list[float] = []
    for i in range(1, len(grid)):
        lo, hi = grid[i - 1], grid[i]
        f_lo = _npv_at(flows, lo)
        f_hi = _npv_at(flows, hi)
        if f_lo == 0:
            roots.append(lo)
            continue
        if sign(f_lo) == sign(f_hi):
            continue
        k = 0
        while k < 200 and hi - lo > 1e-12:
            mid = (lo + hi) / 2
            f_mid = _npv_at(flows, mid)
            if sign(f_mid) == sign(f_lo):
                lo, f_lo = mid, f_mid
            else:
                hi = mid
            k += 1
        roots.append(round_((lo + hi) / 2, 10))
    unique = list(dict.fromkeys(roots))
    if not unique:
        raise CalcInputError("no IRR found between -99.99% and 1000% per period")
    periodic = unique[0]
    for r in unique[1:]:
        if abs(r) < abs(periodic):
            periodic = r
    if len(unique) > 1:
        t.warn(f"Multiple IRRs exist ({', '.join(fmt_pct(r, 4) for r in unique)}); returned the one nearest 0%.")
    annual = pow_int(1 + periodic, ppy) - 1
    t.step("Periodic IRR", round_(periodic, 8), "r such that Σ CF_t ÷ (1 + r)^t = 0")
    t.step("Annualized IRR", round_(annual, 8), f"(1 + r)^{ppy} − 1 = {fmt_pct(annual, 3)}")
    return t.result("calc.irr", 1, {
        "irr_periodic": round_(periodic, 8),
        "irr_annual": round_(annual, 8),
        "roots": [round_(r, 8) for r in unique],
    })


# --- proposals & retail ---------------------------------------------------------------------------


def compare_proposals(raw: Any) -> Result:
    d = obj(raw)
    perspective = enum(d, "perspective", ("tenant", "landlord"), default="tenant")
    disc = number(d, "discount_rate_annual", default=0.08, ge=0, lt=1)
    proposals = []
    for i, p_raw in enumerate(array(d, "proposals", min_len=2, max_len=20)):
        p = join("proposals", i)
        pd = obj(p_raw, p)
        proposals.append({
            "name": string(pd, "name", p, min_len=1),
            "schedule": _schedule_input(pd.get("schedule"), join(p, "schedule")),
            "ti_allowance_psf": _money(pd, "ti_allowance_psf", p),
            "other_concessions": _money(pd, "other_concessions", p),
            "leasing_commissions": _money(pd, "leasing_commissions", p),
            "additional_costs_psf_annual": _money(pd, "additional_costs_psf_annual", p),
            "tenant_upfront_costs": _money(pd, "tenant_upfront_costs", p),
        })
    if len({p["name"] for p in proposals}) != len(proposals):
        fail("proposals", "proposal names must be unique")

    t = Trace()
    tenant = perspective == "tenant"
    r = disc / 12
    t.step("Method",
           "effective cost = level monthly payment with PV of (rent + additional costs + upfront − TI − concessions), × 12 ÷ area"
           if tenant else
           "discounted NER = level monthly payment with PV of (rent − TI − commissions − concessions), × 12 ÷ area")
    rows = []
    for p in proposals:
        s = p["schedule"]
        months = _build_months(s)
        extra = round_(p["additional_costs_psf_annual"] * s["area_sf"] / 12, 2) if tenant else 0
        pv = annuity = total = 0.0
        for i, m in enumerate(months):
            df = pow_int(1 + r, -i)
            flow = m["rent_due"] + extra
            pv += flow * df
            annuity += df
            total += flow
        ti = p["ti_allowance_psf"] * s["area_sf"]
        upfront = (p["tenant_upfront_costs"] - ti - p["other_concessions"]) if tenant \
            else -(ti + p["leasing_commissions"] + p["other_concessions"])
        metric = round_(((pv + upfront) / annuity) * 12 / s["area_sf"], 4)
        t.step(p["name"], metric,
               f"PV {fmt_money(pv)} {'−' if upfront < 0 else '+'} {fmt_money(abs(upfront))} one-time; "
               f"{len(months)} months; {num_str(s['area_sf'])} SF", "USD/sf/yr")
        rows.append({"name": p["name"], "metric_psf_annual": metric, "total_net": round_(total + upfront, 2),
                     "term_months": s["term_months"], "area_sf": s["area_sf"]})
    rows.sort(key=lambda row: row["metric_psf_annual"] if tenant else -row["metric_psf_annual"])
    ranking = [{"rank": i + 1, **row} for i, row in enumerate(rows)]
    best = ranking[0]["name"]
    t.step("Best", best, "lowest effective occupancy cost" if tenant else "highest discounted NER")
    if len({p["schedule"]["area_sf"] for p in proposals}) > 1:
        t.warn("Proposals differ in area; $/SF/yr normalizes size but not the value of the space itself.")
    if tenant and all(p["additional_costs_psf_annual"] == 0 for p in proposals):
        t.warn("No additional costs supplied; if any proposal is net (NNN/modified gross), add its expenses for a fair comparison.")
    if len(ranking) > 1 and ranking[0]["metric_psf_annual"] == ranking[1]["metric_psf_annual"]:
        t.warn(f"Top proposals are tied at {num_str(ranking[0]['metric_psf_annual'])} $/SF/yr.")
    return t.result("calc.compare_proposals", 1, {
        "perspective": perspective,
        "metric": "effective_occupancy_cost_psf" if tenant else "discounted_net_effective_rent_psf",
        "ranking": ranking,
        "best": best,
    })


def percentage_rent(raw: Any) -> Result:
    d = obj(raw)
    gross = number(d, "gross_sales", ge=0)
    excl = _money(d, "sales_exclusions")
    rate = number(d, "rate", gt=0, lt=1)
    base = number(d, "base_rent_annual", ge=0)
    bp_raw = obj(d.get("breakpoint") or {"type": "natural"}, "breakpoint")
    bp_type = enum(bp_raw, "type", ("natural", "fixed"), "breakpoint")
    bp_amount = number(bp_raw, "amount", "breakpoint", ge=0) if bp_type == "fixed" else None
    f = number(d, "period_fraction", default=1, gt=0, le=1)
    paid = _money(d, "percentage_rent_paid")

    t = Trace()
    net = t.step("Net sales", round_(max(0, gross - excl), 2), f"{fmt_money(gross)} − {fmt_money(excl)} exclusions", "USD")
    suffix = f" × {num_str(f)}" if f < 1 else ""
    if bp_type == "natural":
        bp = t.step("Natural breakpoint", round_((base / rate) * f, 2), f"{fmt_money(base)} ÷ {fmt_pct(rate)}{suffix}", "USD")
    else:
        bp = t.step("Fixed breakpoint", round_(bp_amount * f, 2), f"{fmt_money(bp_amount)}{suffix}", "USD")
    over = t.step("Sales over breakpoint", round_(max(0, net - bp), 2), "max(0, net sales − breakpoint)", "USD")
    pct = t.step("Percentage rent", round_(over * rate, 2), f"{fmt_money(over)} × {fmt_pct(rate)}", "USD")
    balance = t.step("Balance due", round_(pct - paid, 2), f"{fmt_money(pct)} − {fmt_money(paid)} paid", "USD")
    if f < 1:
        t.warn("Breakpoint prorated by period_fraction; confirm the lease prorates on that basis (days vs. months).")
    return t.result("calc.percentage_rent", 1, {
        "net_sales": net,
        "breakpoint": bp,
        "sales_over_breakpoint": over,
        "percentage_rent": pct,
        "balance_due": balance,
    })


# --- lease vs. own ----------------------------------------------------------------------


def _growth_rate(d: dict[str, Any], path: str) -> float:
    return number(d, "expense_growth_rate_annual", path, default=0, ge=0, lt=1)


def _loan_balance(amount: float, rate_annual: float, amortization_years: int, n: int) -> float:
    """Outstanding principal after ``n`` monthly payments on a level-payment loan."""
    if amortization_years == 0:
        return amount
    big_n = amortization_years * 12
    if n >= big_n:
        return 0.0
    r = rate_annual / 12
    if r == 0:
        return amount * (1 - n / big_n)
    p_n = pow_int(1 + r, big_n)
    return (amount * (p_n - pow_int(1 + r, n))) / (p_n - 1)


def lease_vs_own(raw: Any) -> Result:
    d = obj(raw)
    horizon = number(d, "horizon_years", integer=True, ge=1, le=50)
    disc = number(d, "discount_rate_annual", ge=0, lt=1)
    lease = obj(d.get("lease"), "lease")
    rent_raw = obj(lease.get("rent"), "lease.rent")
    rent_type = enum(rent_raw, "type", ("schedule", "escalating"), "lease.rent")
    if rent_type == "schedule":
        schedule = array(rent_raw, "annual_rent", "lease.rent", min_len=1, max_len=50)
        for i, v in enumerate(schedule):
            number({"v": v}, "v", join("lease.rent.annual_rent", i), ge=0)
        if len(schedule) != horizon:
            fail("lease.rent.annual_rent", f"must have exactly horizon_years ({horizon}) entries")
        rent = {"type": "schedule", "annual_rent": schedule}
    else:
        rent = {
            "type": "escalating",
            "base_rent_annual": number(rent_raw, "base_rent_annual", "lease.rent", ge=0),
            "escalation_rate_annual": number(rent_raw, "escalation_rate_annual", "lease.rent", default=0, ge=0, lt=1),
        }
    free_months = number(lease, "free_rent_months", "lease", default=0, integer=True, ge=0)
    if free_months > horizon * 12:
        fail("lease.free_rent_months", "must not exceed the horizon")
    lease_opex = _money(lease, "operating_expenses_annual", "lease")
    lease_growth = _growth_rate(lease, "lease")
    upfront = _money(lease, "upfront_costs", "lease")

    own = obj(d.get("own"), "own")
    price = number(own, "purchase_price", "own", ge=0)
    closing = _money(own, "closing_costs", "own")
    loan = None
    if own.get("loan") is not None:
        lo = obj(own["loan"], "own.loan")
        loan = {
            "amount": number(lo, "amount", "own.loan", ge=0),
            "rate_annual": number(lo, "rate_annual", "own.loan", ge=0, lt=1),
            "amortization_years": number(lo, "amortization_years", "own.loan", integer=True, ge=0, le=50),
        }
    own_opex = _money(own, "operating_expenses_annual", "own")
    capex = _money(own, "capex_reserve_annual", "own")
    prop_taxes = _money(own, "property_taxes_annual", "own")
    insurance_base = _money(own, "insurance_annual", "own")
    own_growth = _growth_rate(own, "own")
    res_raw = obj(own.get("residual"), "own.residual")
    res_type = enum(res_raw, "type", ("value", "exit_cap"), "own.residual")
    if res_type == "value":
        residual_amount = number(res_raw, "amount", "own.residual", ge=0)
        cap_rate = stabilized_noi = None
    else:
        residual_amount = None
        cap_rate = number(res_raw, "cap_rate", "own.residual", gt=0, lt=1)
        stabilized_noi = number(res_raw, "stabilized_noi", "own.residual", ge=0)
    selling_rate = number(own, "selling_costs_rate", "own", default=0, ge=0, lt=1)
    tax = None
    if own.get("tax") is not None:
        tx = obj(own["tax"], "own.tax")
        tax = {
            "marginal_tax_rate": number(tx, "marginal_tax_rate", "own.tax", ge=0, lt=1),
            "depreciation_life_years": number(tx, "depreciation_life_years", "own.tax", default=39, integer=True, ge=1, le=100),
            "land_share": number(tx, "land_share", "own.tax", default=0.2, ge=0, lt=1),
            "rent_deductible": boolean(tx, "rent_deductible", "own.tax", default=True),
            "interest_deductible": boolean(tx, "interest_deductible", "own.tax", default=True),
            "depreciation_deductible": boolean(tx, "depreciation_deductible", "own.tax", default=True),
        }
    tax_rate = tax["marginal_tax_rate"] if tax else 0

    t = Trace()
    t.step("Method",
           "cost NPV = Σ net cost_t ÷ (1 + r)^t, t = 0..H; year 0 = move-in / closing, year H includes the sale",
           "after tax" if tax else "pre-tax (no tax block supplied)")

    # --- lease case
    def rent_for(k: int) -> float:
        if rent["type"] == "schedule":
            return rent["annual_rent"][k - 1]
        return round_(rent["base_rent_annual"] * pow_int(1 + rent["escalation_rate_annual"], k - 1), 2)

    lease_years = [{"year": 0, "rent": 0, "free_rent": 0, "operating_expenses": 0, "upfront_costs": upfront,
                    "tax_savings": 0, "net": upfront}]
    for k in range(1, horizon + 1):
        rent_k = rent_for(k)
        free_k_months = min(12, max(0, free_months - 12 * (k - 1)))
        free = round_((rent_k * free_k_months) / 12, 2)
        opex = round_(lease_opex * pow_int(1 + lease_growth, k - 1), 2)
        deductible = ((rent_k - free) if tax and tax["rent_deductible"] else 0) + opex
        savings = round_(tax_rate * deductible, 2) if tax else 0
        lease_years.append({"year": k, "rent": rent_k, "free_rent": free, "operating_expenses": opex,
                            "upfront_costs": 0, "tax_savings": savings,
                            "net": round_(rent_k - free + opex - savings, 2)})
    lease_nets = [y["net"] for y in lease_years]
    lease_npv_raw = _npv_at(lease_nets, disc)
    lease_npv = t.step("Lease NPV", round_(lease_npv_raw, 2),
                       f"Σ (rent − free rent + expenses − tax savings)_t ÷ (1 + {num_str(disc)})^t, t = 0..{horizon}; "
                       f"{free_months} free months", "USD")

    # --- own case
    basis = price + closing
    loan_amount = loan["amount"] if loan else 0
    equity = round_(basis - loan_amount, 2)
    t.step("Equity at closing", equity,
           f"{fmt_money(price)} + {fmt_money(closing)} closing − {fmt_money(loan_amount)} loan", "USD")
    annual_ds = round_(loan["amount"] * annual_constant(loan["rate_annual"], loan["amortization_years"]), 2) \
        if loan and loan["amount"] > 0 else 0
    if loan and loan["amount"] > 0:
        t.step("Annual debt service", annual_ds,
               f"interest-only: {fmt_money(loan['amount'])} × {fmt_pct(loan['rate_annual'], 3)}"
               if loan["amortization_years"] == 0 else
               f"{fmt_money(loan['amount'])} × annual constant at {fmt_pct(loan['rate_annual'], 3)} over "
               f"{loan['amortization_years']} years", "USD")

    def balance_at(months: int) -> float:
        return _loan_balance(loan["amount"], loan["rate_annual"], loan["amortization_years"], months) if loan else 0.0

    depreciable = basis * (1 - tax["land_share"]) if tax else 0
    annual_dep = round_(depreciable / tax["depreciation_life_years"], 2) if tax else 0
    if tax:
        t.step("Annual depreciation", annual_dep,
               f"({fmt_money(basis)} × (1 − {num_str(tax['land_share'])})) ÷ {tax['depreciation_life_years']} years, straight-line",
               "USD")

    own_years = [{"year": 0, "equity": equity, "debt_service": 0, "interest": 0, "principal": 0,
                  "operating_expenses": 0, "capex_reserve": 0, "property_taxes": 0, "insurance": 0,
                  "depreciation": 0, "tax_savings": 0, "sale_proceeds": 0, "net": equity}]
    accumulated_dep = 0.0
    for k in range(1, horizon + 1):
        grow = pow_int(1 + own_growth, k - 1)
        ds = annual_ds if loan and (loan["amortization_years"] == 0 or k <= loan["amortization_years"]) else 0
        principal = round_(balance_at(12 * (k - 1)) - balance_at(12 * k), 2)
        interest = round_(ds - principal, 2)
        opex = round_(own_opex * grow, 2)
        capex_k = round_(capex * grow, 2)
        taxes = round_(prop_taxes * grow, 2)
        insurance = round_(insurance_base * grow, 2)
        dep = annual_dep if tax and k <= tax["depreciation_life_years"] else 0
        accumulated_dep += dep
        deductible = ((interest if tax and tax["interest_deductible"] else 0)
                      + (dep if tax and tax["depreciation_deductible"] else 0)
                      + opex + taxes + insurance)
        savings = round_(tax_rate * deductible, 2) if tax else 0
        own_years.append({"year": k, "equity": 0, "debt_service": ds, "interest": interest, "principal": principal,
                          "operating_expenses": opex, "capex_reserve": capex_k, "property_taxes": taxes,
                          "insurance": insurance, "depreciation": dep, "tax_savings": savings, "sale_proceeds": 0,
                          "net": round_(ds + opex + capex_k + taxes + insurance - savings, 2)})

    residual = residual_amount if res_type == "value" else round_(stabilized_noi / cap_rate, 2)
    t.step("Residual value", residual,
           "stated" if res_type == "value" else f"{fmt_money(stabilized_noi)} NOI ÷ {fmt_pct(cap_rate)} exit cap", "USD")
    selling_costs = round_(residual * selling_rate, 2)
    balance_h = round_(balance_at(12 * horizon), 2)
    adjusted_basis = round_(basis - accumulated_dep, 2)
    gain = round_(residual - selling_costs - adjusted_basis, 2)
    tax_on_sale = round_(gain * tax_rate, 2) if tax else 0
    proceeds = round_(residual - selling_costs - balance_h - tax_on_sale, 2)
    t.step("Net sale proceeds", proceeds,
           f"{fmt_money(residual)} − {fmt_money(selling_costs)} selling costs − {fmt_money(balance_h)} loan payoff"
           + (f" − {fmt_money(tax_on_sale)} tax on gain ({fmt_money(gain)} × {num_str(tax_rate)})" if tax else ""),
           "USD")
    own_nets_ex_sale = [y["net"] for y in own_years]
    last = own_years[horizon]
    last["sale_proceeds"] = proceeds
    last["net"] = round_(last["net"] - proceeds, 2)
    own_nets = [y["net"] for y in own_years]
    own_npv = t.step("Own NPV", round_(_npv_at(own_nets, disc), 2),
                     f"Σ (equity + debt service + expenses − tax savings − sale proceeds)_t ÷ (1 + {num_str(disc)})^t, "
                     f"t = 0..{horizon}", "USD")
    diff = t.step("Difference", round_(own_npv - lease_npv, 2),
                  f"own NPV − lease NPV = {fmt_money(own_npv)} − {fmt_money(lease_npv)}", "USD")
    cheaper = "own" if diff < 0 else "lease" if diff > 0 else "equal"
    t.step("Cheaper", cheaper, "lower NPV of cost")

    npv_own_ex_sale = _npv_at(own_nets_ex_sale, disc)
    needed = (npv_own_ex_sale - lease_npv_raw) * pow_int(1 + disc, horizon)
    break_even = t.step("Break-even residual value",
                        round_((needed + balance_h - tax_rate * adjusted_basis) / ((1 - selling_rate) * (1 - tax_rate)), 2),
                        "sale price R with (R × (1 − selling costs) − loan payoff − tax on gain) ÷ (1 + r)^H = "
                        "own NPV before sale − lease NPV", "USD")
    total_lease = round_(_sum(lease_nets), 2)
    total_own = round_(_sum(own_nets), 2)

    if not tax:
        t.warn("Pre-tax comparison: add the tax block to reflect rent deductibility versus interest and depreciation.")
    if tax:
        t.warn("Tax treatment is simplified: straight-line depreciation without a mid-month convention and one marginal "
               "rate on the gain (no depreciation recapture rate).")
    if res_type == "exit_cap":
        t.warn("Residual value is capitalized from an assumed stabilized NOI; the comparison is sensitive to the exit cap rate.")
    if break_even <= 0:
        t.warn("Owning costs less than leasing even with a zero sale price; the break-even residual is not meaningful.")
    elif break_even > residual * 2 and residual > 0:
        t.warn("Break-even residual is more than twice the assumed residual; leasing is strongly favored at these inputs.")

    return t.result("calc.lease_vs_own", 1, {
        "horizon_years": horizon,
        "after_tax": tax is not None,
        "lease": {"npv": lease_npv, "total_cost": total_lease},
        "own": {
            "npv": own_npv,
            "total_cost": total_own,
            "residual_value": residual,
            "loan_balance_at_horizon": balance_h,
            "net_sale_proceeds": proceeds,
        },
        "difference_npv": diff,
        "cheaper": cheaper,
        "break_even_residual_value": break_even,
        "cash_flows": {"lease": lease_years, "own": own_years},
    })


# --- renew vs. relocate -----------------------------------------------------------------


def _case_schedule(raw: Any, horizon: int, path: str) -> dict[str, Any]:
    d = obj(raw, path)
    return _schedule_input({**d, "term_months": horizon, "include_monthly": False}, path)


def renew_vs_relocate(raw: Any) -> Result:
    d = obj(raw)
    horizon = number(d, "horizon_months", integer=True, gt=0, le=600)
    disc = number(d, "discount_rate_annual", default=0.08, ge=0, lt=1)
    current_rent = _money(d, "current_rent_monthly")
    rn = obj(d.get("renew"), "renew")
    renew_in = {
        "schedule": _case_schedule(rn.get("schedule"), horizon, "renew.schedule"),
        "ti_cost": _money(rn, "ti_cost", "renew"),
        "ti_allowance": _money(rn, "ti_allowance", "renew"),
        "renewal_fee": _money(rn, "renewal_fee", "renew"),
    }
    rl = obj(d.get("relocate"), "relocate")
    reloc_in = {
        "schedule": _case_schedule(rl.get("schedule"), horizon, "relocate.schedule"),
        "buildout_cost": _money(rl, "buildout_cost", "relocate"),
        "ti_allowance": _money(rl, "ti_allowance", "relocate"),
        "moving_cost": _money(rl, "moving_cost", "relocate"),
        "downtime_months": number(rl, "downtime_months", "relocate", default=0, integer=True, ge=0),
        "downtime_cost_monthly": _money(rl, "downtime_cost_monthly", "relocate"),
        "overlap_months": number(rl, "overlap_months", "relocate", default=0, integer=True, ge=0),
        "termination_cost": _money(rl, "termination_cost", "relocate"),
        "disruption_cost": _money(rl, "disruption_cost", "relocate"),
    }

    t = Trace()
    r = disc / 12
    t.step("Method",
           "cost NPV = Σ rent_due_t ÷ (1 + r)^t (rent in advance, t = 0..H−1) + one-time costs at t = 0; "
           "effective rent = level monthly payment with that PV × 12 ÷ area")

    def case_math(s: dict[str, Any], one_time: float) -> dict[str, Any]:
        months = _build_months(s)
        esc = s["escalation"]
        pv = annuity = total = slope = intercept = 0.0
        for i, m in enumerate(months):
            df = pow_int(1 + r, -i)
            pv += m["rent_due"] * df
            annuity += df
            total += m["rent_due"]
            if not m["abated"]:
                k = 0 if esc["type"] == "none" else (m["month"] - 1) // esc["every_months"]
                unit = (s["area_sf"] / 12) * df
                slope += unit * pow_int(1 + esc["rate"], k) if esc["type"] == "percent" else unit
                if esc["type"] == "fixed_psf":
                    intercept += unit * esc["amount"] * k
        return {"months": months, "pv": pv, "annuity": annuity, "total": total, "one_time": one_time,
                "slope": slope, "intercept": intercept}

    R, M = renew_in, reloc_in
    renew_one_time = round_(max(0, R["ti_cost"] - R["ti_allowance"]) + R["renewal_fee"], 2)
    t.step("Renew one-time costs", renew_one_time,
           f"max(0, {fmt_money(R['ti_cost'])} TI − {fmt_money(R['ti_allowance'])} allowance) + "
           f"{fmt_money(R['renewal_fee'])} fees", "USD")
    downtime = round_(M["downtime_months"] * M["downtime_cost_monthly"], 2)
    overlap = round_(M["overlap_months"] * current_rent, 2)
    reloc_one_time = round_(max(0, M["buildout_cost"] - M["ti_allowance"]) + M["moving_cost"] + downtime + overlap
                            + M["termination_cost"] + M["disruption_cost"], 2)
    t.step("Relocate one-time costs", reloc_one_time,
           f"max(0, {fmt_money(M['buildout_cost'])} buildout − {fmt_money(M['ti_allowance'])} allowance) + "
           f"{fmt_money(M['moving_cost'])} moving + {fmt_money(downtime)} downtime ({M['downtime_months']} mo) + "
           f"{fmt_money(overlap)} double rent ({M['overlap_months']} mo) + {fmt_money(M['termination_cost'])} termination + "
           f"{fmt_money(M['disruption_cost'])} disruption", "USD")

    renew = case_math(R["schedule"], renew_one_time)
    relocate = case_math(M["schedule"], reloc_one_time)

    def summarize(label: str, c: dict[str, Any], area: float) -> dict[str, Any]:
        npv_v = t.step(f"{label} NPV", round_(c["pv"] + c["one_time"], 2),
                       f"PV of rent {fmt_money(c['pv'])} + {fmt_money(c['one_time'])} one-time", "USD")
        ner = t.step(f"{label} effective rent", round_((((c["pv"] + c["one_time"]) / c["annuity"]) * 12) / area, 4),
                     f"({fmt_money(c['pv'] + c['one_time'])} ÷ Σ(1+r)^−t) × 12 ÷ {num_str(area)} SF", "USD/sf/yr")
        return {"npv": npv_v, "total_cost": round_(c["total"] + c["one_time"], 2), "total_rent": round_(c["total"], 2),
                "one_time_costs": c["one_time"], "net_effective_rent_psf_annual": ner, "area_sf": area}

    renew_res = summarize("Renew", renew, R["schedule"]["area_sf"])
    reloc_res = summarize("Relocate", relocate, M["schedule"]["area_sf"])
    diff = t.step("Difference", round_(reloc_res["npv"] - renew_res["npv"], 2),
                  f"relocate NPV − renew NPV = {fmt_money(reloc_res['npv'])} − {fmt_money(renew_res['npv'])}", "USD")
    cheaper = "relocate" if diff < 0 else "renew" if diff > 0 else "equal"
    t.step("Cheaper", cheaper, "lower NPV of cost")

    def break_even_rate(target: float, c: dict[str, Any]) -> float | None:
        if c["slope"] == 0:
            return None
        return round_((target - c["one_time"] - c["intercept"]) / c["slope"], 4)

    be_reloc = break_even_rate(renew["pv"] + renew["one_time"], relocate)
    be_renew = break_even_rate(relocate["pv"] + relocate["one_time"], renew)
    t.step("Break-even relocation rent", "n/a" if be_reloc is None else be_reloc,
           "starting $/SF/yr for the new premises (same escalation and free rent) with relocate NPV = renew NPV",
           "USD/sf/yr")
    t.step("Break-even renewal rent", "n/a" if be_renew is None else be_renew,
           "starting $/SF/yr for the renewal (same escalation and free rent) with renew NPV = relocate NPV",
           "USD/sf/yr")

    years = -(-horizon // 12)
    cash_flows = []
    for y in range(1, years + 1):
        def sum_year(c: dict[str, Any]) -> float:
            s = 0.0
            for m in range(12 * (y - 1), min(12 * y, horizon)):
                s += c["months"][m]["rent_due"]
            return round_(s, 2)

        rr, mr = sum_year(renew), sum_year(relocate)
        ro = renew_one_time if y == 1 else 0
        mo = reloc_one_time if y == 1 else 0
        cash_flows.append({"year": y, "renew_rent": rr, "renew_one_time": ro, "renew_total": round_(rr + ro, 2),
                           "relocate_rent": mr, "relocate_one_time": mo, "relocate_total": round_(mr + mo, 2)})

    if R["schedule"]["area_sf"] != M["schedule"]["area_sf"]:
        t.warn("The two premises differ in area; NPV compares total cost, while $/SF/yr normalizes size but not the "
               "value of the space.")
    if M["disruption_cost"] == 0 and M["downtime_cost_monthly"] == 0:
        t.warn("No disruption or downtime cost supplied for relocating; the comparison counts only rent and hard costs.")
    if R["ti_allowance"] > R["ti_cost"] or M["ti_allowance"] > M["buildout_cost"]:
        t.warn("An allowance exceeds the cost it offsets; the excess is treated as not paid out.")
    if diff == 0:
        t.warn("The two cases are tied at these inputs.")

    return t.result("calc.renew_vs_relocate", 1, {
        "horizon_months": horizon,
        "renew": renew_res,
        "relocate": reloc_res,
        "difference_npv": diff,
        "cheaper": cheaper,
        "break_even": {"relocate_starting_rent_psf": be_reloc, "renew_starting_rent_psf": be_renew},
        "cash_flows": cash_flows,
    })


# --- hotel ------------------------------------------------------------------------------


def hotel_metrics(raw: Any) -> Result:
    d = obj(raw)
    nights = number(d, "nights", integer=True, gt=0)
    rooms = number(d, "rooms", integer=True, gt=0)
    ooo = number(d, "rooms_out_of_order", default=0, integer=True, ge=0)
    sold = number(d, "rooms_sold", integer=True, ge=0)
    room_rev = number(d, "room_revenue", ge=0)
    fb = _money(d, "fb_revenue")
    other = _money(d, "other_revenue")
    dept = _money(d, "departmental_expenses")
    undist = _money(d, "undistributed_expenses")
    fee_rate = number(d, "management_fee_rate", default=0, ge=0, lt=1)
    fee_fixed = _money(d, "management_fee_fixed")
    non_op = _money(d, "non_operating_expenses")
    ffe_rate = number(d, "ffe_reserve_rate", default=0, ge=0, lt=1)

    t = Trace()
    available = rooms * nights - ooo
    if available <= 0:
        raise CalcInputError("rooms_out_of_order leaves no rooms available in the period")
    if sold > available:
        raise CalcInputError(f"rooms_sold ({sold}) exceeds rooms available ({available})")
    t.step("Rooms available", available, f"{rooms} rooms × {nights} nights − {ooo} out of order", "room-nights")
    occupancy = t.step("Occupancy", round_(sold / available, 4),
                       f"{sold} sold ÷ {available} available = {fmt_pct(sold / available)}")
    adr = round_(room_rev / sold, 2) if sold > 0 else None
    t.step("ADR", "n/a" if adr is None else adr,
           "no rooms sold" if adr is None else f"{fmt_money(room_rev)} rooms revenue ÷ {sold} rooms sold", "USD")
    revpar = t.step("RevPAR", round_(room_rev / available, 2),
                    f"{fmt_money(room_rev)} ÷ {available} available (= occupancy × ADR)", "USD")
    total_rev = t.step("Total operating revenue", round_(room_rev + fb + other, 2),
                       f"{fmt_money(room_rev)} rooms + {fmt_money(fb)} F&B + {fmt_money(other)} other", "USD")
    trevpar = t.step("TRevPAR", round_(total_rev / available, 2), f"{fmt_money(total_rev)} ÷ {available} available", "USD")
    dept_profit = t.step("Departmental profit", round_(total_rev - dept, 2),
                         f"{fmt_money(total_rev)} − {fmt_money(dept)} departmental expenses (USALI Total Departmental Profit)",
                         "USD")
    gop = t.step("GOP", round_(dept_profit - undist, 2),
                 f"{fmt_money(dept_profit)} − {fmt_money(undist)} undistributed expenses (USALI Gross Operating Profit)", "USD")
    gop_margin = t.step("GOP margin", round_(gop / total_rev, 4) if total_rev > 0 else 0, "GOP ÷ total operating revenue")
    goppar = t.step("GOPPAR", round_(gop / available, 2), f"{fmt_money(gop)} ÷ {available} available", "USD")
    fee = t.step("Management fee", round_(total_rev * fee_rate + fee_fixed, 2),
                 f"{fmt_money(total_rev)} × {fmt_pct(fee_rate)} + {fmt_money(fee_fixed)} fixed (USALI Management Fees)", "USD")
    ibnoie = t.step("Income before non-operating", round_(gop - fee, 2),
                    f"{fmt_money(gop)} − {fmt_money(fee)} (USALI Income Before Non-Operating Income and Expenses)", "USD")
    ebitda = t.step("EBITDA", round_(ibnoie - non_op, 2),
                    f"{fmt_money(ibnoie)} − {fmt_money(non_op)} property taxes, insurance, other non-operating (USALI EBITDA)",
                    "USD")
    reserve = t.step("FF&E reserve", round_(total_rev * ffe_rate, 2),
                     f"{fmt_money(total_rev)} × {fmt_pct(ffe_rate)} (USALI Replacement Reserve)", "USD")
    noi = t.step("NOI", round_(ebitda - reserve, 2),
                 f"{fmt_money(ebitda)} − {fmt_money(reserve)} (USALI EBITDA Less Replacement Reserve)", "USD")
    noi_margin = t.step("NOI margin", round_(noi / total_rev, 4) if total_rev > 0 else 0, "NOI ÷ total operating revenue")

    if adr is None:
        t.warn("No rooms sold in the period; ADR is undefined.")
    if dept == 0 and undist == 0:
        t.warn("No expenses supplied; GOP and NOI equal revenue. Add departmental and undistributed expenses for a profit view.")
    if ffe_rate == 0:
        t.warn("No FF&E reserve; lenders and appraisers typically deduct 3–5% of revenue before NOI.")
    if non_op == 0:
        t.warn("No property taxes or insurance supplied; NOI is before those non-operating expenses.")

    return t.result("calc.hotel_metrics", 1, {
        "rooms_available": available,
        "rooms_sold": sold,
        "occupancy": occupancy,
        "adr": adr,
        "revpar": revpar,
        "trevpar": trevpar,
        "total_revenue": total_rev,
        "departmental_profit": dept_profit,
        "gop": gop,
        "gop_margin": gop_margin,
        "goppar": goppar,
        "management_fee": fee,
        "income_before_non_operating": ibnoie,
        "ebitda": ebitda,
        "ffe_reserve": reserve,
        "noi": noi,
        "noi_margin": noi_margin,
    })


# --- registry -------------------------------------------------------------------------------------

#: name -> (function, formula id, formula version). Names match the MCP/TypeScript registry.
CALCULATORS: dict[str, tuple[Callable[[Any], Result], str, int]] = {
    "rent_schedule": (rent_schedule, "calc.rent_schedule", 1),
    "net_effective_rent": (net_effective_rent, "calc.net_effective_rent", 1),
    "compare_proposals": (compare_proposals, "calc.compare_proposals", 1),
    "percentage_rent": (percentage_rent, "calc.percentage_rent", 1),
    "cam_reconciliation": (cam_reconciliation, "calc.cam_reconciliation", 1),
    "debt_sizing": (debt_sizing, "calc.debt_sizing", 1),
    "lease_remeasurement_asc842": (lease_remeasurement_asc842, "calc.lease_remeasurement_asc842", 1),
    "prepayment_and_defeasance": (prepayment_and_defeasance, "calc.prepayment_and_defeasance", 1),
    "walt": (walt, "calc.walt", 1),
    "npv": (npv, "calc.npv", 1),
    "irr": (irr, "calc.irr", 1),
    "lease_vs_own": (lease_vs_own, "calc.lease_vs_own", 1),
    "renew_vs_relocate": (renew_vs_relocate, "calc.renew_vs_relocate", 1),
    "hotel_metrics": (hotel_metrics, "calc.hotel_metrics", 1),
}
