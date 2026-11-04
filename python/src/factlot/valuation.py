"""Valuation, loan-schedule, waterfall, and 1031 calculators — Python port of @factlot/calc
(dcf.ts, direct_cap.ts, amortization.ts, waterfall.ts, exchange_1031.ts).

Same inputs, outputs, and floating-point operation order as TypeScript; held to the shared
vectors in ``spec/vectors/calc`` and the differential test.
"""

from __future__ import annotations

import math
from typing import Any

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
    js_number_str,
    nth_root,
    number,
    obj,
    pow_int,
    reduce_noise,
    round_,
    string,
)
from .dates import add_days, add_months, days_between

Result = dict[str, Any]


def _opt_date(d: dict[str, Any], key: str, path: str = "") -> str | None:
    return iso_date(d, key, path) if d.get(key) is not None else None


def _irr_annual(flows: list[float], ppy: int) -> Result:
    from .calc import irr  # late import: calc imports this module for its registry

    return irr({"cash_flows": flows, "periods_per_year": ppy})


# --- amortization schedule -------------------------------------------------------------------

MAX_LOAN_MONTHS = 600
_DAY_COUNTS = ("30/360", "actual/360", "actual/365")


def amortization_schedule(raw: Any) -> Result:
    d = obj(raw)
    principal = number(d, "principal", gt=0)
    rate = number(d, "rate_annual", ge=0, lt=1)
    freq = enum(d, "payment_frequency", ("monthly", "quarterly"), default="monthly")
    term = number(d, "term_months", integer=True, ge=1, le=MAX_LOAN_MONTHS)
    amort = number(d, "amortization_months", integer=True, ge=0, le=MAX_LOAN_MONTHS)
    io_months = number(d, "interest_only_months", default=0, integer=True, ge=0, le=MAX_LOAN_MONTHS)
    day_count = enum(d, "day_count", _DAY_COUNTS, default="30/360")
    start = _opt_date(d, "start_date")
    step = 3 if freq == "quarterly" else 1
    for key, n_ in (("term_months", term), ("amortization_months", amort), ("interest_only_months", io_months)):
        if n_ % step != 0:
            fail(key, "must be a whole number of quarters (a multiple of 3) for quarterly payments")
    if io_months > term:
        fail("interest_only_months", "must not exceed term_months")
    elif amort > 0 and amort < term - io_months:
        fail("amortization_months", "must be 0 (interest-only) or at least term_months − interest_only_months")
    if day_count != "30/360" and start is None:
        fail("start_date", "start_date is required for actual/360 and actual/365")

    t = Trace()
    months_per = step
    p = 12 // months_per
    n = term // months_per
    n_io = io_months // months_per
    n_amort = amort // months_per
    io_to_maturity = n_amort == 0 or n_io >= n
    actual = day_count != "30/360"
    basis = 365 if day_count == "actual/365" else 360

    r = t.step("Periodic rate", rate / p, f"{fmt_pct(rate, 4)} ÷ {p} payments a year")
    pmt = 0.0
    if not io_to_maturity:
        pmt = t.step(
            "Amortizing payment",
            round_(principal / n_amort if r == 0 else (principal * r) / (1 - pow_int(1 + r, -n_amort)), 2),
            f"{fmt_money(principal)} ÷ {n_amort} periods (0% rate)" if r == 0
            else f"P × r ÷ (1 − (1 + r)^−n), P = {fmt_money(principal)}, r = {js_number_str(round_(r, 10))}, "
                 f"n = {n_amort} periods ({amort} months), rounded to the cent",
            "USD")
    t.step("Structure",
           f"interest-only for all {n} periods; the full principal is due at maturity" if io_to_maturity
           else f"{n_io} interest-only periods, then {n - n_io} amortizing periods on a {amort}-month schedule; "
                f"balance due at period {n}")
    t.step("Day count", day_count,
           f"interest = opening balance × {js_number_str(rate)} × actual days ÷ {basis}; the level payment is "
           "computed on a 30/360 basis" if actual
           else f"interest = opening balance × {js_number_str(round_(r, 10))} (every period is {30 * months_per} days)")
    t.step("Rounding",
           "interest is rounded to the cent half away from zero each period; principal = payment − interest; "
           "closing = opening − principal; the final period repays the whole opening balance with its interest, so "
           "the loan closes at 0.00 and total principal equals the loan amount")

    schedule: list[dict[str, Any]] = []
    balance = round_(principal, 2)
    prev_date = start
    sum_interest = sum_principal = sum_payments = 0.0
    balloon = 0.0
    io_payment = None
    negative: list[int] = []
    for k in range(1, n + 1):
        date = None if start is None else add_months(start, k * months_per)
        days = days_between(prev_date, date) if actual and date is not None and prev_date is not None else 30 * months_per
        opening = balance
        interest = round_((opening * rate * days) / basis if actual else opening * r, 2)
        io = io_to_maturity or k <= n_io
        scheduled = 0 if io else round_(pmt - interest, 2)
        principal_k = scheduled
        if k == n:
            principal_k = opening
            balloon = round_(opening - scheduled, 2)
        payment = round_(interest + principal_k, 2)
        if io and io_payment is None:
            io_payment = interest
        if principal_k < 0:
            negative.append(k)
        closing = round_(opening - principal_k, 2)
        sum_interest = round_(sum_interest + interest, 2)
        sum_principal = round_(sum_principal + principal_k, 2)
        sum_payments = round_(sum_payments + payment, 2)
        schedule.append({
            "period": k,
            "date": date,
            "days": days,
            "interest_only": io,
            "opening_balance": opening,
            "interest": interest,
            "principal": principal_k,
            "payment": payment,
            "closing_balance": closing,
        })
        balance = closing
        prev_date = date
    last = schedule[-1]
    t.step("Balloon balance", balloon,
           "the full principal, repaid at maturity" if io_to_maturity
           else f"period {n} opening balance {fmt_money(last['opening_balance'])} − its scheduled principal "
                f"{fmt_money(round_(last['opening_balance'] - balloon, 2))}", "USD")
    t.step("Final payment", last["payment"],
           f"{fmt_money(last['interest'])} interest + {fmt_money(last['principal'])} principal", "USD")
    t.step("Total interest", sum_interest, "Σ row interest = total payments − loan amount", "USD")
    t.step("Total principal", sum_principal, "Σ row principal = loan amount", "USD")

    if not io_to_maturity and n_amort > n - n_io:
        t.warn(f"A balloon of {fmt_money(balloon)} is due at maturity (period {n}); the loan must be refinanced or "
               "repaid then.")
    if io_to_maturity:
        t.warn(f"Interest-only to maturity: the full {fmt_money(principal)} is due with the final payment.")
    if not io_to_maturity and n_amort == n - n_io and actual and abs(balloon) >= 1:
        t.warn(f"The payment is computed on a 30/360 basis but interest accrues {day_count}, so a fully amortizing "
               f"schedule leaves {fmt_money(balloon)} to repay with the final payment.")
    if negative:
        t.warn(f"Interest exceeds the payment in {len(negative)} period(s) (first: period {negative[0]}), so the "
               "balance grows (negative amortization); check the day count and amortization term.")
    if start is not None and int(start[8:]) > 28:
        t.warn(f"start_date falls on day {start[8:]}: payment dates are clamped to month end in shorter months, "
               "which changes the actual-day periods; confirm the note's payment date.")

    return t.result("calc.amortization_schedule", 1, {
        "periods": n,
        "periods_per_year": p,
        "periodic_rate": round_(r, 10),
        "amortizing_payment": None if io_to_maturity else pmt,
        "interest_only_payment": io_payment,
        "balloon_balance": balloon,
        "final_payment": last["payment"],
        "maturity_date": last["date"],
        "total_interest": sum_interest,
        "total_principal": sum_principal,
        "total_payments": sum_payments,
        "schedule": schedule,
    })


# --- direct capitalization -------------------------------------------------------------------


def direct_cap(raw: Any) -> Result:
    d = obj(raw)
    noi = number(d, "noi", gt=0)
    basis = enum(d, "noi_basis", ("trailing_12", "forward_12", "stabilized"), default=None)
    cap = number(d, "cap_rate", optional=True, gt=0, lt=1)
    price = number(d, "price", optional=True, gt=0)
    reserve = number(d, "capex_reserve_annual", default=0, ge=0)
    lease_up = number(d, "lease_up_costs", default=0, ge=0)
    burn_off = number(d, "free_rent_burn_off", default=0, ge=0)
    adjustments = []
    for i, a in enumerate(array(d, "other_adjustments", default=[], max_len=20)):
        p = join("other_adjustments", i)
        a = obj(a, p)
        adjustments.append({"label": string(a, "label", p, min_len=1, max_len=200), "amount": number(a, "amount", p)})
    area = number(d, "area_sf", optional=True, gt=0)
    round_to = number(d, "round_value_to", optional=True, gt=0)
    if cap is None and price is None:
        fail("", "provide cap_rate, price, or both")

    t = Trace()
    if basis is not None:
        t.step("NOI basis", basis.replace("_", " ", 1))
    income = t.step("Capitalized income", round_(noi - reserve, 2),
                    f"{fmt_money(noi)} NOI − {fmt_money(reserve)} capital reserve", "USD/yr")
    if income <= 0:
        raise CalcInputError(
            f"capex_reserve_annual {fmt_money(reserve)} leaves no income to capitalize from NOI {fmt_money(noi)}",
            [{"path": "capex_reserve_annual", "message": "must be less than noi"}])
    others = 0.0
    for a in adjustments:
        others += a["amount"]
    deductions = t.step(
        "Below-the-line deductions", round_(lease_up + burn_off - others, 2),
        f"{fmt_money(lease_up)} lease-up + {fmt_money(burn_off)} free-rent burn-off"
        + "".join(f" {'+' if a['amount'] < 0 else '−'} {fmt_money(abs(a['amount']))} {a['label']}" for a in adjustments),
        "USD")

    stabilized = as_is = as_is_rounded = None
    if cap is not None:
        stabilized = t.step("Stabilized value", round_(income / cap, 2), f"{fmt_money(income)} ÷ {fmt_pct(cap, 3)}", "USD")
        as_is = t.step("As-is value", round_(stabilized - deductions, 2),
                       f"{fmt_money(stabilized)} − {fmt_money(deductions)} below-the-line", "USD")
        if round_to is not None:
            as_is_rounded = t.step("As-is value, rounded", round_(round_(as_is / round_to, 0) * round_to, 2),
                                   f"to the nearest {fmt_money(round_to)}", "USD")
        if as_is <= 0:
            t.warn("The below-the-line deductions exceed the stabilized value; the as-is value is not positive.")
    implied = implied_before = implied_all_in = None
    if price is not None:
        implied = t.step("Implied cap rate", round_(income / price, 6),
                         f"{fmt_money(income)} capitalized income ÷ {fmt_money(price)} price")
        implied_before = round_(noi / price, 6)
        if reserve > 0:
            t.step("Implied cap rate before reserves", implied_before, f"{fmt_money(noi)} NOI ÷ {fmt_money(price)}")
        all_in_basis = round_(price + deductions, 2)
        if all_in_basis > 0:
            implied_all_in = round_(income / all_in_basis, 6)
            if deductions != 0:
                t.step("Implied cap rate, all-in", implied_all_in,
                       f"{fmt_money(income)} ÷ ({fmt_money(price)} price + {fmt_money(deductions)} below-the-line)")
        else:
            t.warn("Price plus the below-the-line adjustments is not positive, so no all-in cap rate is reported.")

    if basis is None:
        t.warn("noi_basis not given: a cap rate applies only to NOI on the same basis (trailing 12, forward 12, or "
               "stabilized); state which one the market evidence uses.")
    if reserve == 0:
        t.warn("No capital reserve deducted; if the comparable cap rates are quoted after reserves, deduct one so the "
               "bases match.")
    if cap is not None and price is not None and implied is not None and as_is is not None:
        t.step("Value versus price", round_(as_is - price, 2), f"{fmt_money(as_is)} as-is value − {fmt_money(price)} price",
               "USD")

    return t.result("calc.direct_cap", 1, {
        "noi": noi,
        "capitalized_income": income,
        "cap_rate": cap,
        "stabilized_value": stabilized,
        "total_deductions": deductions,
        "as_is_value": as_is,
        "as_is_value_rounded": as_is_rounded,
        "value_per_sf": round_(as_is / area, 2) if area is not None and as_is is not None else None,
        "price": price,
        "implied_cap_rate": implied,
        "implied_cap_rate_before_reserves": implied_before,
        "implied_cap_rate_all_in": implied_all_in,
        "price_per_sf": round_(price / area, 2) if area is not None and price is not None else None,
    })


# --- DCF pro forma ---------------------------------------------------------------------------

MAX_DCF_LEASES = 200
MAX_HOLD_YEARS = 30
_RECOVERY = ("nnn", "gross", "base_year")


def _leasing_fields(d: dict[str, Any], path: str, market: bool) -> dict[str, Any]:
    """Parse market_leasing (with its defaults) or a lease's leasing override (all optional)."""
    def opt(default: Any) -> dict[str, Any]:
        return {"default": default} if market else {"optional": True}

    out = {
        "renewal_probability": number(d, "renewal_probability", path, **({} if market else {"optional": True}),
                                      ge=0, le=1),
        "lease_term_months": number(d, "lease_term_months", path, **({} if market else {"optional": True}),
                                    integer=True, ge=1, le=240),
        "downtime_months": number(d, "downtime_months", path, **({} if market else {"optional": True}),
                                  integer=True, ge=0, le=60),
        "renewal_rent_pct_of_market": number(d, "renewal_rent_pct_of_market", path, **opt(1), gt=0, le=2),
        "rent_escalation_rate": number(d, "rent_escalation_rate", path, **opt(0), ge=0, lt=1),
        "free_rent_months_new": number(d, "free_rent_months_new", path, **opt(0), integer=True, ge=0, le=60),
        "free_rent_months_renewal": number(d, "free_rent_months_renewal", path, **opt(0), integer=True, ge=0, le=60),
        "ti_psf_new": number(d, "ti_psf_new", path, **opt(0), ge=0),
        "ti_psf_renewal": number(d, "ti_psf_renewal", path, **opt(0), ge=0),
        "lc_rate_new": number(d, "lc_rate_new", path, **opt(0), ge=0, lt=1),
        "lc_rate_renewal": number(d, "lc_rate_renewal", path, **opt(0), ge=0, lt=1),
        "recovery": enum(d, "recovery", _RECOVERY, path, default="nnn" if market else None),
    }
    return out


def _dcf_lease(raw: Any, path: str) -> dict[str, Any]:
    d = obj(raw, path)
    lease = {
        "name": string(d, "name", path, min_len=1, max_len=200),
        "area_sf": number(d, "area_sf", path, gt=0),
        "rent_psf_annual": number(d, "rent_psf_annual", path, ge=0),
        "months_remaining": number(d, "months_remaining", path, integer=True, ge=0, le=600),
        "escalation_rate": number(d, "escalation_rate", path, default=0, ge=0, lt=1),
        "next_escalation_month": number(d, "next_escalation_month", path, default=13, integer=True, ge=1, le=600),
        "free_rent_months_remaining": number(d, "free_rent_months_remaining", path, default=0, integer=True, ge=0,
                                             le=600),
        "recovery": enum(d, "recovery", _RECOVERY, path, default="nnn"),
        "base_year_opex_psf_annual": number(d, "base_year_opex_psf_annual", path, optional=True, ge=0),
        "market_rent_psf_annual": number(d, "market_rent_psf_annual", path, ge=0),
        "leasing": None,
    }
    if d.get("leasing") is not None:
        lp = join(path, "leasing")
        lease["leasing"] = _leasing_fields(obj(d["leasing"], lp), lp, market=False)
    if lease["recovery"] == "base_year" and lease["base_year_opex_psf_annual"] is None:
        fail(join(path, "base_year_opex_psf_annual"), "required when recovery is base_year")
    return lease


def _year_of(m: int) -> int:
    return (m - 1) // 12 + 1


def dcf_pro_forma(raw: Any) -> Result:
    d = obj(raw)
    hold = number(d, "hold_years", integer=True, ge=1, le=MAX_HOLD_YEARS)
    leases = [_dcf_lease(x, join("leases", i))
              for i, x in enumerate(array(d, "leases", min_len=1, max_len=MAX_DCF_LEASES))]
    if d.get("market_leasing") is None:
        fail("market_leasing", "required")
    market = _leasing_fields(obj(d["market_leasing"], "market_leasing"), "market_leasing", market=True)
    g = number(d, "market_rent_growth_rate", default=0, gt=-1, lt=1)
    opex_psf0 = number(d, "operating_expenses_psf_annual", default=0, ge=0)
    nonrec = number(d, "non_recoverable_expenses_annual", default=0, ge=0)
    ge = number(d, "expense_growth_rate", default=0, gt=-1, lt=1)
    mgmt_rate = number(d, "management_fee_rate", default=0, ge=0, lt=1)
    vac_rate = number(d, "general_vacancy_rate", default=0, ge=0, lt=1)
    credit_rate = number(d, "credit_loss_rate", default=0, ge=0, lt=1)
    reserve_psf = number(d, "capital_reserve_psf_annual", default=0, ge=0)
    exit_cap = number(d, "exit_cap_rate", gt=0, lt=1)
    exit_basis = enum(d, "exit_noi_basis", ("forward", "trailing"), default="forward")
    sell_rate = number(d, "selling_cost_rate", default=0, ge=0, lt=1)
    r = number(d, "discount_rate", ge=0, lt=1)
    timing = enum(d, "timing", ("end_of_year", "mid_year"), default="end_of_year")
    price = number(d, "purchase_price", optional=True, gt=0)

    t = Trace()
    H = hold
    years = H + 1
    horizon = years * 12
    area = 0.0
    for lease in leases:
        area += lease["area_sf"]

    def market_growth(y: int) -> float:
        return pow_int(1 + g, y - 1)

    def expense_growth(y: int) -> float:
        return pow_int(1 + ge, y - 1)

    def opex_psf(y: int) -> float:
        return opex_psf0 * expense_growth(y)

    t.step("Conventions",
           "annual periods built from months: analysis month m is in year ⌊(m − 1) ÷ 12⌋ + 1; rent, recoveries, free "
           "rent, and downtime are monthly; TI and leasing commissions are paid in the month a rollover lease starts; "
           "a rollover lease that starts after the projection is listed in lease_events, but its TI and leasing "
           "commission are not in the cash flows")
    t.step("Blended rollover",
           "at each expiration one lease is signed with renewal and new-tenant assumptions weighted by the renewal "
           "probability p: rent = market × (p × renewal_rent_pct_of_market + (1 − p)); TI/SF and LC rate = p × "
           "renewal + (1 − p) × new; downtime D = (1 − p) × new-tenant downtime months and free rent F = p × "
           "renewal + (1 − p) × new months, both kept fractional (to six decimals), not rounded: the suite is vacant "
           "for ⌊D⌋ whole months, the lease's first month collects (1 − (D − ⌊D⌋)) of its base rent and recoveries, "
           "and lease month k (k = 0 first) has min(1, max(0, F − k)) of its base rent abated; the lease term runs "
           "from that first month. Space vacant at the start is leased to a new tenant (p = 0) after the full "
           "downtime.")
    t.step("Building area", area, "Σ lease areas", "SF")

    potential = [0.0] * (years + 1)
    free = [0.0] * (years + 1)
    recoveries = [0.0] * (years + 1)
    ti = [0.0] * (years + 1)
    lc = [0.0] * (years + 1)
    events: list[dict[str, Any]] = []
    # Rollover downtime (months) falling in the year after the hold, by suite.
    exit_downtime: list[str] = []
    # Rollover leases that start after the projection ends.
    late_starts: list[str] = []

    for lease in leases:
        L = dict(market)
        for k, v in (lease["leasing"] or {}).items():
            if v is not None:
                L[k] = v
        area_sf = lease["area_sf"]
        segments: list[dict[str, Any]] = []
        if lease["months_remaining"] > 0:
            esc, first, base = lease["escalation_rate"], lease["next_escalation_month"], lease["rent_psf_annual"]

            def in_place_psf(m: int, esc: float = esc, first: int = first, base: float = base) -> float:
                return base * pow_int(1 + esc, (m - first) // 12 + 1) if m >= first else base

            segments.append({"start": 1, "end": lease["months_remaining"], "psf": in_place_psf,
                             "free": lease["free_rent_months_remaining"], "first_share": 1, "recovery": lease["recovery"],
                             "base_psf": lease["base_year_opex_psf_annual"] or 0})
            events.append({
                "lease": lease["name"], "kind": "in_place", "start_month": 1, "end_month": lease["months_remaining"],
                "renewal_probability": None, "downtime_months": 0,
                "free_rent_months": lease["free_rent_months_remaining"], "rent_psf_annual": round_(base, 4),
                "tenant_improvements": 0, "leasing_commission": 0,
            })
        prev_end = lease["months_remaining"]
        exit_down = 0.0
        while prev_end < horizon:
            vacant_start = prev_end == 0
            p = 0 if vacant_start else L["renewal_probability"]
            # Blended downtime, kept fractional: whole months vacant, then a partly occupied first month.
            downtime = round_((1 - p) * L["downtime_months"], 6)
            whole_down = math.floor(downtime)
            frac_down = downtime - whole_down
            start = prev_end + 1 + whole_down
            end = start + L["lease_term_months"] - 1
            for m in range(prev_end + 1, min(start - 1, horizon) + 1):
                if _year_of(m) == years:
                    exit_down += 1
            if start <= horizon and _year_of(start) == years:
                exit_down += frac_down
            y0 = _year_of(start)
            start_psf = lease["market_rent_psf_annual"] * market_growth(y0) * (
                p * L["renewal_rent_pct_of_market"] + (1 - p))
            esc_rate = L["rent_escalation_rate"]

            def spec_psf(m: int, start_psf: float = start_psf, esc_rate: float = esc_rate, start: int = start) -> float:
                return start_psf * pow_int(1 + esc_rate, (m - start) // 12)

            free_months = min(round_(p * L["free_rent_months_renewal"] + (1 - p) * L["free_rent_months_new"], 6),
                              L["lease_term_months"])
            ti_psf = (p * L["ti_psf_renewal"] + (1 - p) * L["ti_psf_new"]) * market_growth(y0)
            lc_rate = p * L["lc_rate_renewal"] + (1 - p) * L["lc_rate_new"]
            ti_amount = ti_psf * area_sf
            # Commission on the base rent payable over the whole term after free rent, even beyond the
            # analysis horizon, paid when the lease starts. Downtime does not shorten the term.
            term_rent = 0.0
            for m in range(start, end + 1):
                abated = min(1, max(0, free_months - (m - start)))
                if abated < 1:
                    term_rent += ((area_sf * spec_psf(m)) / 12) * (1 - abated)
            lc_amount = lc_rate * term_rent
            kind = "new" if vacant_start else "blended"
            if start <= horizon:
                ti[_year_of(start)] += ti_amount
                lc[_year_of(start)] += lc_amount
                segments.append({"start": start, "end": end, "psf": spec_psf, "free": free_months,
                                 "first_share": 1 - frac_down, "recovery": L["recovery"], "base_psf": opex_psf(y0)})
            else:
                # Downtime runs past the projection: the suite is vacant to the end and the lease that follows
                # is reported, but its costs fall after the forward year.
                late_starts.append(f"{lease['name']} (month {start})")
            events.append({
                "lease": lease["name"], "kind": kind, "start_month": start, "end_month": end,
                "renewal_probability": None if vacant_start else p, "downtime_months": downtime,
                "free_rent_months": free_months, "rent_psf_annual": round_(start_psf, 4),
                "tenant_improvements": round_(ti_amount, 2), "leasing_commission": round_(lc_amount, 2),
            })
            prev_end = end

        if exit_down > 0:
            exit_downtime.append(f"{lease['name']}: {js_number_str(round_(exit_down, 6))} months")

        for s in segments:
            for m in range(s["start"], min(s["end"], horizon) + 1):
                y = _year_of(m)
                share = s["first_share"] if m == s["start"] else 1
                rent = ((area_sf * s["psf"](m)) / 12) * share
                potential[y] += rent
                abated = min(1, max(0, s["free"] - (m - s["start"])))
                if abated > 0:
                    free[y] -= rent * abated
                rec = 0.0
                if s["recovery"] == "nnn":
                    rec = (area_sf * opex_psf(y)) / 12
                elif s["recovery"] == "base_year":
                    rec = (area_sf * max(0, opex_psf(y) - s["base_psf"])) / 12
                recoveries[y] += rec * share

    rows: list[dict[str, Any]] = []
    for y in range(1, years + 1):
        pbr = round_(potential[y], 2)
        fr = round_(free[y], 2)
        rec = round_(recoveries[y], 2)
        gross = round_(pbr + fr + rec, 2)
        vac = round_(-vac_rate * gross, 2)
        credit = round_(-credit_rate * gross, 2)
        egr = round_(gross + vac + credit, 2)
        opex = round_(-(opex_psf(y) * area + nonrec * expense_growth(y)), 2)
        mgmt = round_(-mgmt_rate * egr, 2)
        noi = round_(egr + opex + mgmt, 2)
        ti_y = round_(-ti[y], 2)
        lc_y = round_(-lc[y], 2)
        reserves = round_(-(reserve_psf * expense_growth(y) * area), 2)
        rows.append({
            "year": y,
            "in_hold": y <= H,
            "potential_base_rent": pbr,
            "free_rent": fr,
            "expense_recoveries": rec,
            "gross_revenue": gross,
            "general_vacancy": vac,
            "credit_loss": credit,
            "effective_gross_revenue": egr,
            "operating_expenses": opex,
            "management_fee": mgmt,
            "net_operating_income": noi,
            "tenant_improvements": ti_y,
            "leasing_commissions": lc_y,
            "capital_reserves": reserves,
            "cash_flow_before_debt": round_(noi + ti_y + lc_y + reserves, 2),
        })

    def row(y: int) -> dict[str, Any]:
        return rows[y - 1]

    t.step("Annual lines",
           "gross revenue = potential base rent − free rent + recoveries; EGR = gross revenue − general vacancy − "
           "credit loss (each rate × gross revenue); NOI = EGR − operating expenses − management fee (rate × EGR); "
           "cash flow before debt = NOI − TI − leasing commissions − capital reserves",
           "each line is rounded to the cent and the subtotals are sums of the rounded lines, so every row foots")
    t.step("Recoveries",
           'recoverable expenses in year y = operating_expenses_psf_annual × (1 + expense growth)^(y − 1) per SF; '
           '"nnn" leases pay their area × that ÷ 12 each occupied month (free-rent months included), "base_year" '
           'leases the excess over their base, "gross" leases nothing; vacant months recover nothing')
    noi1 = t.step("NOI, year 1", row(1)["net_operating_income"], None, "USD")
    exit_noi = t.step("Exit NOI",
                      row(H + 1)["net_operating_income"] if exit_basis == "forward" else row(H)["net_operating_income"],
                      f"forward: NOI of year {H + 1}" if exit_basis == "forward" else f"trailing: NOI of year {H}", "USD")
    gross_sale = t.step("Gross sale price", round_(exit_noi / exit_cap, 2),
                        f"{fmt_money(exit_noi)} ÷ {fmt_pct(exit_cap, 3)} exit cap rate", "USD")
    sell_costs = t.step("Selling costs", round_(sell_rate * gross_sale, 2),
                        f"{fmt_pct(sell_rate, 3)} × {fmt_money(gross_sale)}", "USD")
    net_sale = t.step("Net sale proceeds", round_(gross_sale - sell_costs, 2), f"received at the end of year {H}", "USD")

    mid = timing == "mid_year"
    half = nth_root(1 + r, 2) if mid else 1
    pv_cf = 0.0
    for y in range(1, H + 1):
        pv_cf += (row(y)["cash_flow_before_debt"] * half) / pow_int(1 + r, y)
    rs = js_number_str(r)
    pv_cash_flows = t.step("PV of cash flows", round_(pv_cf, 2),
                           f"Σ CF_y ÷ (1 + {rs})^(y − 0.5), y = 1..{H} (mid-year)" if mid
                           else f"Σ CF_y ÷ (1 + {rs})^y, y = 1..{H} (end of year)", "USD")
    pv_rev = t.step("PV of reversion", round_(net_sale / pow_int(1 + r, H), 2),
                    f"{fmt_money(net_sale)} ÷ (1 + {rs})^{H}", "USD")
    value = t.step("Value", round_(pv_cash_flows + pv_rev, 2),
                   f"{fmt_money(pv_cash_flows)} + {fmt_money(pv_rev)} at a {fmt_pct(r, 3)} discount rate", "USD")

    npv_ = irr_annual = multiple = None
    if price is not None:
        npv_ = t.step("NPV", round_(value - price, 2), f"{fmt_money(value)} value − {fmt_money(price)} price", "USD")
        flows = [-price]
        for y in range(1, H + 1):
            flows.append(round_(row(y)["cash_flow_before_debt"] + net_sale, 2) if y == H
                         else row(y)["cash_flow_before_debt"])
        try:
            res = _irr_annual(flows, 1)
            irr_annual = res["value"]["irr_annual"]
            t.step("Unlevered IRR", irr_annual,
                   f"r such that Σ CF_t ÷ (1 + r)^t = 0 over [−price, CF_1, …, CF_{H} + net sale], end of year (Excel IRR)")
            for w in res["warnings"]:
                t.warn(w)
        except CalcInputError as e:
            t.warn(f"No unlevered IRR: {e}.")
        inflows = 0.0
        for k in range(1, len(flows)):
            inflows += flows[k]
        multiple = t.step("Equity multiple", round_(inflows / price, 4), "Σ cash flows and net sale ÷ price (unlevered)")

    if mid and price is not None:
        t.warn("timing is mid_year but the unlevered IRR uses end-of-year timing (Excel IRR), so at a price equal to "
               "the value the IRR is not the discount rate.")
    if vac_rate > 0:
        t.warn("General vacancy is charged on top of the downtime modelled at each rollover (it is not reduced by it); "
               "lower general_vacancy_rate if the market assumption already includes turnover vacancy.")
    if exit_basis == "forward":
        fwd = row(H + 1)
        items: list[str] = []
        if exit_downtime:
            items.append(f"rollover downtime ({'; '.join(exit_downtime)})")
        if fwd["free_rent"] != 0:
            items.append("free rent")
        if fwd["tenant_improvements"] != 0 or fwd["leasing_commissions"] != 0:
            items.append("TI or leasing commissions")
        if items:
            t.warn(f"The exit year (year {H + 1}) has {', '.join(items)}; its NOI is capitalized as is. Normalize it if "
                   "a buyer would not.")
    if late_starts:
        t.warn(f"Rollover leases that start after the projection ends (month {horizon}) are in lease_events, but their "
               f"TI and leasing commissions are not in the cash flows: {', '.join(late_starts)}.")
    if exit_noi <= 0:
        t.warn("The exit NOI is not positive, so the sale price is not positive.")
    if not any(e["kind"] != "in_place" for e in events):
        t.warn("No lease rolls within the projection; the result does not depend on the leasing assumptions.")
    t.warn("Conventions to confirm against your model: annual periods from monthly lease events; blended rollover "
           "assumptions with fractional downtime and free rent (whole months, then a part month for the fraction, not "
           "rounded); TI and LC paid when the rollover lease "
           "starts; free rent abates base rent only; general vacancy and credit loss on gross revenue. ARGUS and other "
           "tools differ in some of these.")

    return t.result("calc.dcf_pro_forma", 2, {
        "hold_years": H,
        "building_area_sf": area,
        "cash_flows": rows,
        "noi_year_1": noi1,
        "exit": {
            "noi_basis": exit_basis,
            "noi": exit_noi,
            "cap_rate": exit_cap,
            "gross_sale_price": gross_sale,
            "selling_costs": sell_costs,
            "net_sale_proceeds": net_sale,
        },
        "discount_rate": r,
        "timing": timing,
        "pv_cash_flows": pv_cash_flows,
        "pv_reversion": pv_rev,
        "value": value,
        "value_per_sf": round_(value / area, 2),
        "reversion_share_of_value": round_(pv_rev / value, 4) if value > 0 else None,
        "going_in_cap_rate_on_value": round_(noi1 / value, 6) if value > 0 else None,
        "purchase_price": price,
        "npv": npv_,
        "going_in_cap_rate_on_price": round_(noi1 / price, 6) if price is not None else None,
        "unlevered_irr": irr_annual,
        "equity_multiple": multiple,
        "lease_events": events,
    })


# --- equity waterfall ------------------------------------------------------------------------

MAX_WATERFALL_PERIODS = 600


def _periodic(rate: float, p: int) -> float:
    """Effective periodic rate for an annual rate: (1 + r)^(1/p) − 1 (r itself when p = 1)."""
    return rate if p == 1 else nth_root(1 + rate, p) - 1


def _irr_or_none(flows: list[float], p: int, t: Trace, who: str) -> float | None:
    try:
        res = _irr_annual(flows, p)
    except CalcInputError:
        return None
    for w in res["warnings"]:
        t.warn(f"{who}: {w}")
    return res["value"]["irr_annual"]


def equity_waterfall(raw: Any) -> Result:
    d = obj(raw)
    flows_raw = array(d, "cash_flows", min_len=2, max_len=MAX_WATERFALL_PERIODS)
    flows = [number({"v": v}, "v", join("cash_flows", i)) for i, v in enumerate(flows_raw)]
    p = number(d, "periods_per_year", default=1, integer=True, ge=1, le=12)
    s = number(d, "lp_share", gt=0, le=1)
    pref = None
    if d.get("pref") is not None:
        pd = obj(d["pref"], "pref")
        pref = {"rate_annual": number(pd, "rate_annual", "pref", gt=0, lt=1),
                "compounding": enum(pd, "compounding", ("compound", "simple"), "pref", default="compound")}
    order = enum(d, "distribution_order", ("pref_then_capital", "capital_then_pref"), default="pref_then_capital")
    cu = None
    if d.get("catch_up") is not None:
        cd = obj(d["catch_up"], "catch_up")
        cu = {"gp_share": number(cd, "gp_share", "catch_up", gt=0, le=1),
              "target_promote": number(cd, "target_promote", "catch_up", gt=0, lt=1)}
    tiers = []
    for i, x in enumerate(array(d, "tiers", default=[], max_len=10)):
        tp = join("tiers", i)
        x = obj(x, tp)
        tiers.append({"until_irr": number(x, "until_irr", tp, gt=0, lt=10),
                      "promote": number(x, "promote", tp, ge=0, lt=1)})
    residual = number(d, "residual_promote", default=0, ge=0, lt=1)
    if not any(c < 0 for c in flows):
        fail("cash_flows", "needs at least one negative cash flow (a contribution)")
    for i in range(1, len(tiers)):
        if tiers[i]["until_irr"] <= tiers[i - 1]["until_irr"]:
            fail(f"tiers.{i}.until_irr", "tiers must be in strictly increasing until_irr order")
    if cu is not None and cu["gp_share"] <= cu["target_promote"]:
        fail("catch_up.target_promote", "must be below catch_up.gp_share")

    t = Trace()
    pref_rate = _periodic(pref["rate_annual"], p) if pref else 0
    hurdle_rates = [_periodic(x["until_irr"], p) for x in tiers]

    t.step("Investors",
           f"LP {fmt_pct(s, 4)} / GP {fmt_pct(1 - s, 4)} of every contribution; capital, pref, and the non-promote "
           "part of every split go pro rata to capital")
    if pref:
        t.step("Pref",
               f"{fmt_pct(pref['rate_annual'], 4)} compounding: unpaid pref and capital accrue "
               f"{js_number_str(round_(pref_rate, 10))} a period ((1 + rate)^(1/{p}) − 1)"
               if pref["compounding"] == "compound"
               else f"{fmt_pct(pref['rate_annual'], 4)} simple: unreturned capital × {js_number_str(pref['rate_annual'])} "
                    f"÷ {p} a period; unpaid pref earns nothing",
               "accrues from the period after each contribution, on balances after the previous period's flows")
    parts_text = ((["accrued pref", "return of capital"] if order == "pref_then_capital"
                   else ["return of capital", "accrued pref"]) if pref else ["return of capital"])
    if cu:
        parts_text.append(f"catch-up ({fmt_pct(cu['gp_share'], 2)} to GP until the promote is "
                          f"{fmt_pct(cu['target_promote'], 2)} of profit)")
    parts_text += [f"{fmt_pct(1 - x['promote'], 2)}/{fmt_pct(x['promote'], 2)} until the LP IRR is "
                   f"{fmt_pct(x['until_irr'], 2)}" for x in tiers]
    parts_text.append(f"{fmt_pct(1 - residual, 2)}/{fmt_pct(residual, 2)} thereafter")
    t.step("Order of distributions", " → ".join(parts_text))
    if tiers:
        t.step("IRR hurdles",
               "each tier tracks an LP balance that grows at the hurdle's effective periodic rate ((1 + hurdle)^(1/"
               "periods_per_year) − 1), rises with LP contributions and falls with every LP distribution; the tier "
               "ends when the balance reaches zero, which is when the LP IRR (calc_irr annualization) reaches the "
               "hurdle")

    state = {"capital": 0.0, "unpaid": 0.0, "promote_total": 0.0, "profit_total": 0.0}
    balances = [0.0 for _ in tiers]
    periods: list[dict[str, Any]] = []
    sums = {"lp_c": 0.0, "gp_c": 0.0, "lp_d": 0.0, "gp_d": 0.0, "promote": 0.0}
    lp_net: list[float] = []
    gp_net: list[float] = []

    for k, cf in enumerate(flows):
        if k > 0:
            if pref:
                state["unpaid"] += ((state["capital"] + state["unpaid"]) * pref_rate if pref["compounding"] == "compound"
                                    else (state["capital"] * pref["rate_annual"]) / p)
            for i in range(len(balances)):
                balances[i] = balances[i] * (1 + hurdle_rates[i])
        lp_c = gp_c = 0.0
        parts = [0.0] * (len(tiers) + 4)  # pref, capital, catch-up, tiers…, residual
        acc = {"lp": 0.0, "promote": 0.0}

        def pay_lp(amount: float) -> None:
            acc["lp"] += amount
            for i in range(len(balances)):
                balances[i] = balances[i] - amount

        if cf < 0:
            x = -cf
            state["capital"] += x
            lp_c = round_(x * s, 2)
            gp_c = round_(x - lp_c, 2)
            for i in range(len(balances)):
                balances[i] = balances[i] + x * s
        elif cf > 0:
            rem = [cf]

            def pay_pref() -> None:
                if not pref or rem[0] <= 0:
                    return
                x = min(rem[0], state["unpaid"])
                state["unpaid"] -= x
                state["profit_total"] += x
                parts[0] = x
                pay_lp(x * s)
                rem[0] -= x

            def pay_capital() -> None:
                if rem[0] <= 0:
                    return
                x = min(rem[0], state["capital"])
                state["capital"] -= x
                parts[1] = x
                pay_lp(x * s)
                rem[0] -= x

            if order == "pref_then_capital":
                pay_pref()
                pay_capital()
            else:
                pay_capital()
                pay_pref()
            if cu and rem[0] > 0:
                need = (cu["target_promote"] * state["profit_total"] - state["promote_total"]) / (
                    cu["gp_share"] - cu["target_promote"])
                x = max(0, min(rem[0], need))
                if x > 0:
                    acc["promote"] += cu["gp_share"] * x
                    state["promote_total"] += cu["gp_share"] * x
                    state["profit_total"] += x
                    parts[2] = x
                    pay_lp((1 - cu["gp_share"]) * x * s)
                    rem[0] -= x
            for i, tier in enumerate(tiers):
                b = balances[i]
                if rem[0] <= 0 or b <= 0:
                    continue
                lp_per_dollar = (1 - tier["promote"]) * s
                x = min(rem[0], b / lp_per_dollar)
                acc["promote"] += tier["promote"] * x
                state["promote_total"] += tier["promote"] * x
                state["profit_total"] += x
                parts[3 + i] = x
                pay_lp(x * lp_per_dollar)
                rem[0] -= x
            if rem[0] > 0:
                x = rem[0]
                acc["promote"] += residual * x
                state["promote_total"] += residual * x
                state["profit_total"] += x
                parts[3 + len(tiers)] = x
                pay_lp((1 - residual) * x * s)
                rem[0] = 0
        # Cents that foot: the LP's share is rounded and the GP takes the rest of the cash flow; each
        # tier column is rounded and the last tier paid takes the rest.
        rounded = [round_(x, 2) for x in parts]
        last_paid = -1
        for i, x in enumerate(parts):
            if x > 0:
                last_paid = i
        if last_paid >= 0:
            others = 0.0
            for i, x in enumerate(rounded):
                if i != last_paid:
                    others += x
            rounded[last_paid] = round_(cf - others, 2)
        lp_dist = round_(acc["lp"], 2) if cf > 0 else 0
        gp_dist = round_(cf - lp_dist, 2) if cf > 0 else 0
        gp_promote = round_(acc["promote"], 2) if cf > 0 else 0
        periods.append({
            "period": k,
            "cash_flow": cf,
            "lp_contribution": lp_c,
            "gp_contribution": gp_c,
            "pref": rounded[0],
            "return_of_capital": rounded[1],
            "catch_up": rounded[2],
            "tiers": rounded[3:3 + len(tiers)],
            "residual": rounded[3 + len(tiers)],
            "lp_distribution": lp_dist,
            "gp_distribution": gp_dist,
            "gp_promote": gp_promote,
            "lp_net": round_(lp_dist - lp_c, 2),
            "gp_net": round_(gp_dist - gp_c, 2),
        })
        sums["lp_c"] = round_(sums["lp_c"] + lp_c, 2)
        sums["gp_c"] = round_(sums["gp_c"] + gp_c, 2)
        sums["lp_d"] = round_(sums["lp_d"] + lp_dist, 2)
        sums["gp_d"] = round_(sums["gp_d"] + gp_dist, 2)
        sums["promote"] = round_(sums["promote"] + gp_promote, 2)
        lp_net.append(round_(lp_dist - lp_c, 2))
        gp_net.append(round_(gp_dist - gp_c, 2))

    t.step("Rounding",
           "every period's LP distribution is rounded to the cent and the GP receives the rest of the cash flow; tier "
           "columns are rounded and the last tier paid in the period takes the rest, so each row foots; totals are "
           "row sums")

    def party(contrib: float, dist: float, net: list[float], who: str) -> dict[str, Any]:
        return {
            "contributions": contrib,
            "distributions": dist,
            "profit": round_(dist - contrib, 2),
            "multiple": round_(dist / contrib, 4) if contrib > 0 else None,
            "irr": _irr_or_none(net, p, t, who) if contrib > 0 else None,
        }

    lp = party(sums["lp_c"], sums["lp_d"], lp_net, "LP IRR")
    gp = {**party(sums["gp_c"], sums["gp_d"], gp_net, "GP IRR"), "promote": sums["promote"]}
    project_irr = _irr_or_none(flows, p, t, "Project IRR")
    t.step("LP", f"{fmt_money(lp['contributions'])} in, {fmt_money(lp['distributions'])} out",
           "no IRR" if lp["irr"] is None else f"IRR {fmt_pct(lp['irr'], 3)}, multiple {js_number_str(lp['multiple'])}x")
    t.step("GP", f"{fmt_money(gp['contributions'])} in, {fmt_money(gp['distributions'])} out, of which "
                 f"{fmt_money(gp['promote'])} promote",
           "no IRR" if gp["irr"] is None else f"IRR {fmt_pct(gp['irr'], 3)}, multiple {js_number_str(gp['multiple'])}x")
    if project_irr is not None:
        t.step("Project IRR", project_irr, "IRR of cash_flows before the waterfall")

    unreturned = round_(state["capital"], 2)
    unpaid_pref = round_(state["unpaid"], 2)
    if unreturned > 0:
        t.warn(f"{fmt_money(unreturned)} of contributed capital is not returned by the last period.")
    if unpaid_pref > 0:
        t.warn(f"{fmt_money(unpaid_pref)} of accrued pref is unpaid at the last period.")
    if pref:
        for x in tiers:
            if x["until_irr"] <= pref["rate_annual"]:
                t.warn(f"Tier hurdle {fmt_pct(x['until_irr'], 2)} is not above the {fmt_pct(pref['rate_annual'], 2)} "
                       "pref, so it can be reached before or while the pref is paid.")
    if cu:
        if not pref:
            t.warn("A catch-up without a pref catches up on profit from the first dollar after capital; check the "
                   "agreement.")
        nxt = tiers[0]["promote"] if tiers else residual
        if nxt != cu["target_promote"]:
            t.warn(f"The catch-up target ({fmt_pct(cu['target_promote'], 2)} of profit) differs from the promote of the "
                   f"split that follows it ({fmt_pct(nxt, 2)}).")
    if s == 1:
        t.warn("The GP contributes no capital, so the GP has no IRR or multiple.")
    t.warn("Waterfall conventions to confirm against the operating agreement: hurdles are measured on the LP's cash "
           "flows with end-of-period timing and effective periodic compounding; the GP's co-investment shares pref, "
           "capital and splits pari passu with the LP; the catch-up target is a share of all profit (pref included); "
           "distributions are not clawed back.")

    return t.result("calc.equity_waterfall", 1, {
        "periods": periods,
        "lp": lp,
        "gp": gp,
        "project_irr": project_irr,
        "unreturned_capital": unreturned,
        "unpaid_pref": unpaid_pref,
    })


# --- 1031 exchange ---------------------------------------------------------------------------

NOT_TAX_ADVICE = (
    "Not tax advice. FactLot does arithmetic on the dates and amounts given: the 45- and 180-day counts of IRC "
    "§1031(a)(3), the identification limits of Treas. Reg. §1.1031(k)-1(c)(4), and the usual boot and "
    "debt-replacement netting. It does not decide whether an exchange qualifies; confirm with a qualified "
    "intermediary and a tax adviser."
)


def exchange_1031(raw: Any) -> Result:
    d = obj(raw)
    start = iso_date(d, "relinquished_transfer_date")
    due = _opt_date(d, "tax_return_due_date")
    as_of = _opt_date(d, "as_of")
    if d.get("relinquished") is None:
        fail("relinquished", "required")
    rd = obj(d["relinquished"], "relinquished")
    rel = {
        "sale_price": number(rd, "sale_price", "relinquished", gt=0),
        "selling_expenses": number(rd, "selling_expenses", "relinquished", default=0, ge=0),
        "debt_relieved": number(rd, "debt_relieved", "relinquished", default=0, ge=0),
        "adjusted_basis": number(rd, "adjusted_basis", "relinquished", optional=True, ge=0),
    }
    cash_received = number(d, "cash_received_at_sale", default=0, ge=0)
    rep = None
    if d.get("replacement") is not None:
        pd = obj(d["replacement"], "replacement")
        rep = {
            "purchase_price": number(pd, "purchase_price", "replacement", ge=0),
            "acquisition_costs": number(pd, "acquisition_costs", "replacement", default=0, ge=0),
            "new_debt": number(pd, "new_debt", "replacement", default=0, ge=0),
        }
    props = []
    for i, x in enumerate(array(d, "identified_properties", default=[], max_len=100)):
        pp = join("identified_properties", i)
        x = obj(x, pp)
        props.append({
            "name": string(x, "name", pp, min_len=1, max_len=200),
            "fair_market_value": number(x, "fair_market_value", pp, gt=0),
            "identified_date": _opt_date(x, "identified_date", pp),
            "received": boolean(x, "received", pp, default=False),
            "received_date": _opt_date(x, "received_date", pp),
        })
    if due is not None and due < start:
        fail("tax_return_due_date", "must not be before relinquished_transfer_date")

    t = Trace()
    id_deadline = t.step("Identification deadline", add_days(start, 45), f"IRC §1031(a)(3)(A): {start} + 45 days")
    day180 = add_days(start, 180)
    due_first = due is not None and due < day180
    ex_deadline = t.step(
        "Exchange deadline", due if due_first else day180,
        f"IRC §1031(a)(3)(B)(ii): the return due date {due} is earlier than day 180 ({day180})" if due_first
        else f"IRC §1031(a)(3)(B): {start} + 180 days" + (f", before the return due date {due}" if due is not None else ""))

    def left(x: str) -> int | None:
        return None if as_of is None else days_between(as_of, x)

    if as_of is not None:
        t.step("Days remaining", f"{left(id_deadline)} to identify, {left(ex_deadline)} to close", f"from {as_of}")

    identification = None
    if props:
        total = 0.0
        received = 0.0
        for x in props:
            total += x["fair_market_value"]
            if x["received"]:
                received += x["fair_market_value"]
        three = len(props) <= 3
        two_hundred = reduce_noise(total) <= reduce_noise(2 * rel["sale_price"])
        late = [x["name"] for x in props if x["identified_date"] is not None and x["identified_date"] > id_deadline]
        late_receipts = [x["name"] for x in props
                         if x["received"] and x["received_date"] is not None and x["received_date"] > ex_deadline]
        ninety_five = reduce_noise(received) >= reduce_noise(0.95 * total) and not late_receipts
        rule = "three_property" if three else "200_percent" if two_hundred else "95_percent" if ninety_five else None
        t.step("Three-property rule", "met" if three else "not met",
               f"Treas. Reg. §1.1031(k)-1(c)(4)(i)(A): {len(props)} identified, at most 3")
        t.step("200% rule", "met" if two_hundred else "not met",
               f"Treas. Reg. §1.1031(k)-1(c)(4)(i)(B): {fmt_money(total)} identified ≤ 200% × "
               f"{fmt_money(rel['sale_price'])} = {fmt_money(2 * rel['sale_price'])}")
        if not three and not two_hundred:
            t.step("95% exception", "met" if ninety_five else "not met",
                   f"Treas. Reg. §1.1031(k)-1(c)(4)(ii)(B): {fmt_money(received)} received ≥ 95% × {fmt_money(total)} "
                   f"= {fmt_money(0.95 * total)}, each by the exchange deadline")
        identification = {
            "count": len(props),
            "total_fair_market_value": round_(total, 2),
            "ratio_to_relinquished": round_(total / rel["sale_price"], 4),
            "three_property_rule": three,
            "two_hundred_percent_rule": two_hundred,
            "received_share": round_(received / total, 4) if total > 0 else 0,
            "ninety_five_percent_exception": ninety_five,
            "rule_met": rule,
            "late_identifications": late,
            "late_receipts": late_receipts,
        }
        if rule is None:
            t.warn("The identification meets none of the three-property, 200%, or 95% tests: Treas. Reg. "
                   "§1.1031(k)-1(c)(4)(ii)(A) treats the taxpayer as having identified no replacement property.")
        if late:
            t.warn(f"Identified after the {id_deadline} deadline: {', '.join(late)}.")
        if late_receipts:
            t.warn(f"Received after the {ex_deadline} exchange deadline: {', '.join(late_receipts)}.")
        if rule == "95_percent":
            t.warn("The identification relies on the 95% exception, which counts only property actually received by "
                   "the exchange deadline.")

    exchange = None
    if rep is not None:
        realized = t.step("Amount realized", round_(rel["sale_price"] - rel["selling_expenses"], 2),
                          f"{fmt_money(rel['sale_price'])} sale price − {fmt_money(rel['selling_expenses'])} selling "
                          "expenses", "USD")
        equity = t.step("Exchange equity", round_(realized - rel["debt_relieved"], 2),
                        f"{fmt_money(realized)} − {fmt_money(rel['debt_relieved'])} debt relieved", "USD")
        qi = t.step("Funds with the qualified intermediary", round_(max(0, equity - cash_received), 2),
                    f"max(0, {fmt_money(equity)} − {fmt_money(cash_received)} cash taken at the sale)", "USD")
        needed = t.step("Funds needed at the purchase",
                        round_(rep["purchase_price"] + rep["acquisition_costs"] - rep["new_debt"], 2),
                        f"{fmt_money(rep['purchase_price'])} price + {fmt_money(rep['acquisition_costs'])} costs − "
                        f"{fmt_money(rep['new_debt'])} new debt", "USD")
        applied = round_(max(0, min(qi, needed)), 2)
        added = t.step("Additional cash paid", round_(max(0, needed - qi), 2),
                       "cash the taxpayer adds beyond the exchange funds", "USD")
        cash_boot = t.step("Cash boot", round_(cash_received + max(0, qi - max(0, needed)), 2),
                           f"{fmt_money(cash_received)} taken at the sale + exchange funds not used for the purchase; "
                           "not offset by new debt (Treas. Reg. §1.1031(d)-2, Example 2)", "USD")
        replaced = round_(rep["new_debt"] + added, 2)
        mortgage_boot = t.step("Mortgage boot", round_(max(0, rel["debt_relieved"] - replaced), 2),
                               f"max(0, {fmt_money(rel['debt_relieved'])} debt relieved − {fmt_money(rep['new_debt'])} "
                               f"new debt − {fmt_money(added)} cash added) (Treas. Reg. §1.1031(d)-2)", "USD")
        total_boot = t.step("Total boot", round_(cash_boot + mortgage_boot, 2), "cash boot + mortgage boot", "USD")
        trade_down = t.step("Trade-down", round_(max(0, realized - rep["purchase_price"]), 2),
                            f"max(0, {fmt_money(realized)} amount realized − {fmt_money(rep['purchase_price'])} "
                            "replacement price)", "USD")
        gain = limited = None
        if rel["adjusted_basis"] is not None:
            gain = t.step("Realized gain", round_(realized - rel["adjusted_basis"], 2),
                          f"{fmt_money(realized)} − {fmt_money(rel['adjusted_basis'])} adjusted basis", "USD")
            limited = t.step("Boot-limited gain", round_(max(0, min(gain, total_boot)), 2),
                             "IRC §1031(b): gain is recognized up to the boot received: min(realized gain, total boot)",
                             "USD")
        exchange = {
            "amount_realized": realized,
            "exchange_equity": equity,
            "qualified_intermediary_funds": qi,
            "funds_needed_at_purchase": needed,
            "funds_applied_from_qi": applied,
            "additional_cash_paid": added,
            "cash_boot": cash_boot,
            "debt_relieved": rel["debt_relieved"],
            "debt_replaced": replaced,
            "mortgage_boot": mortgage_boot,
            "total_boot": total_boot,
            "debt_replacement_shortfall": mortgage_boot,
            "trade_down": trade_down,
            "realized_gain": gain,
            "boot_limited_gain": limited,
        }
        if cash_boot > 0:
            t.warn(f"{fmt_money(cash_boot)} of cash boot: exchange funds not reinvested are taxable to the extent of gain.")
        if mortgage_boot > 0:
            t.warn(f"{fmt_money(mortgage_boot)} of mortgage boot: replace the relieved debt with new debt or added cash "
                   "to avoid it.")
        if trade_down > 0 and total_boot == 0:
            t.warn("The replacement price is below the amount realized but no boot results; check the debt and cash "
                   "figures.")
        if needed < 0:
            t.warn("The new debt exceeds the price plus costs; loan proceeds beyond the purchase are not counted as "
                   "boot here.")
        if equity < 0:
            t.warn("The debt relieved exceeds the amount realized (negative equity); the excess is mortgage boot unless "
                   "offset.")

    if due is None:
        t.warn(f"tax_return_due_date not given: under IRC §1031(a)(3)(B)(ii) the exchange period ends on the due date "
               f"(with extensions) of the return for the year of the transfer if that is before {day180}. Supply it, or "
               "confirm an extension is filed.")
    t.warn("The deadlines are calendar-day counts and are not moved for weekends or holidays; disaster postponements "
           "(IRC §7508A) are not applied.")
    t.warn(NOT_TAX_ADVICE)

    return t.result("calc.exchange_1031", 1, {
        "disclaimer": NOT_TAX_ADVICE,
        "deadlines": {
            "transfer_date": start,
            "identification_deadline": id_deadline,
            "exchange_deadline": ex_deadline,
            "exchange_deadline_basis": "tax_return_due_date" if due_first else "180_days",
            "day_180": day180,
            "days_to_identification_deadline": left(id_deadline),
            "days_to_exchange_deadline": left(ex_deadline),
        },
        "identification": identification,
        "exchange": exchange,
    })
