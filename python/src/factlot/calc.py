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


# --- registry -------------------------------------------------------------------------------------

#: name -> (function, formula id, formula version). Names match the MCP/TypeScript registry.
CALCULATORS: dict[str, tuple[Callable[[Any], Result], str, int]] = {
    "rent_schedule": (rent_schedule, "calc.rent_schedule", 1),
    "net_effective_rent": (net_effective_rent, "calc.net_effective_rent", 1),
    "compare_proposals": (compare_proposals, "calc.compare_proposals", 1),
    "percentage_rent": (percentage_rent, "calc.percentage_rent", 1),
    "cam_reconciliation": (cam_reconciliation, "calc.cam_reconciliation", 1),
    "debt_sizing": (debt_sizing, "calc.debt_sizing", 1),
    "walt": (walt, "calc.walt", 1),
    "npv": (npv, "calc.npv", 1),
    "irr": (irr, "calc.irr", 1),
}
