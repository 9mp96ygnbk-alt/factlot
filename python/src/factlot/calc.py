"""Deterministic, traceable CRE calculators — Python port of @factlot/calc.

Every function takes a JSON-shaped ``dict`` (the same snake_case input the TypeScript
package and MCP tools accept) and returns ``{"value", "formula", "steps", "warnings"}``.
Both implementations are held to the shared vectors in ``spec/vectors``.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable

from ._core import (
    CalcInputError,
    Trace,
    array,
    boolean,
    enum,
    fail,
    fmt_money,
    fmt_num,
    fmt_pct,
    ieee_div,
    iso_date,
    join,
    js_number_str,
    nth_root,
    num_str,
    number,
    obj,
    pow_int,
    reduce_noise,
    round_,
    sign,
    string,
)
from .dates import add_days, add_months, days_between

Result = dict[str, Any]

# --- lease units -----------------------------------------------------------------------------

LEASE_UNITS = ("sf", "kw", "mw", "unit", "acre", "key", "room", "space")
#: unit -> (quantity label, per-unit label, step unit); mirrors packages/calc/src/units.ts.
_UNIT_LABELS = {
    "sf": ("SF", "SF", "USD/sf/yr"),
    "kw": ("kW", "kW", "USD/kW/yr"),
    "mw": ("MW", "MW", "USD/MW/yr"),
    "unit": ("units", "unit", "USD/unit/yr"),
    "acre": ("acres", "acre", "USD/acre/yr"),
    "key": ("keys", "key", "USD/key/yr"),
    "room": ("rooms", "room", "USD/room/yr"),
    "space": ("spaces", "space", "USD/space/yr"),
}


def _unit_labels(unit: str | None) -> tuple[str, str, str]:
    return _UNIT_LABELS[unit or "sf"]


def _unit_warning(unit: str | None) -> str | None:
    """How a non-SF unit was read (identical to @factlot/calc ``unitWarning``), or None for square feet."""
    if unit is None or unit == "sf":
        return None
    qty, per, rate = _UNIT_LABELS[unit]
    base = (f"Unit is {unit}: area_sf was read as {qty} and every *_psf rate as $/{per}/yr; results are in {rate}. "
            "Field names keep _sf and _psf.")
    if unit in ("kw", "mw"):
        return (f"{base} Data-center rents are often quoted per {per} per month: starting_rent_psf_annual must be "
                "annual (monthly × 12). Power, cooling (PUE) and other pass-throughs are not priced unless added as costs.")
    if unit == "acre":
        return f"{base} Confirm whether the ground or yard lease measures gross or usable acres."
    if unit == "unit":
        return f"{base} For an apartment rent roll with concessions and occupancy, use calc_multifamily_rent_roll."
    return base


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
    abated = array(d, "abated_months", path, default=[], max_len=1200)
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
        "unit": enum(d, "unit", LEASE_UNITS, path, default=None),
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
            t.step("Escalation", f"+${fmt_num(esc['amount'])}/{_unit_labels(s['unit'])[1]}/yr every {esc['every_months']} months",
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


def _warn_mid_month(commencement: str, t: Trace) -> None:
    """Warn when commencement is not the first of a month (identical to @factlot/calc ``warnMidMonth``)."""
    day = int(commencement[8:10])
    if day != 1:
        t.warn(f"Commencement {commencement} is mid-month: each lease month runs from day {day} to the day before it in "
               "the next month (clamped to month end), and rent is not prorated to calendar months; if rent is billed "
               "by calendar month, the first and last partial months need proration outside this result.")


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
    _warn_mid_month(s["commencement_date"], t)
    unit_note = _unit_warning(s["unit"])
    if unit_note:
        t.warn(unit_note)
    value: dict[str, Any] = {
        "expiration_date": months[-1]["end_date"],
        "steps": steps,
        "total_scheduled_rent": total_sched,
        "total_abatement": total_abate,
        "total_rent_due": total_due,
    }
    if s["include_monthly"]:
        value["monthly"] = months
    if s["unit"] is not None:
        value["unit"] = s["unit"]
        value["rate_unit"] = _unit_labels(s["unit"])[2]
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
    qty, per, rate_unit = _unit_labels(s["unit"])
    years = t.step("Term", n / 12, f"{n} months ÷ 12", "years")
    total = t.step("Total rent due", round_(_sum([m["rent_due"] for m in months]), 2), "Σ rent due", "USD")
    ti = t.step("TI allowance", round_(ti_psf * area, 2), f"${fmt_num(ti_psf)}/{per} × {fmt_num(area)} {qty}", "USD")
    costs = t.step("Total landlord costs", round_(ti + lc + other, 2),
                   f"{fmt_money(ti)} TI + {fmt_money(lc)} LC + {fmt_money(other)} other", "USD")
    eff = t.step("Effective rent", round_(total / area / years, 4), "total rent due ÷ area ÷ years", rate_unit)
    ner = t.step("Net effective rent (straight-line)", round_((total - costs) / area / years, 4),
                 "(total rent due − landlord costs) ÷ area ÷ years", rate_unit)
    r = disc / 12
    pv = 0.0
    annuity = 0.0
    for i in range(n):
        df = pow_int(1 + r, -i)
        pv += months[i]["rent_due"] * df
        annuity += df
    pv_rent = t.step("PV of rent", round_(pv, 2), f"Σ rent_due_t ÷ (1 + {js_number_str(round_(r, 6))})^t, t = 0..{n - 1}", "USD")
    level = (pv - costs) / annuity
    dner = t.step("Discounted net effective rent", round_(level * 12 / area, 4),
                  "((PV rent − costs) ÷ Σ(1+r)^−t) × 12 ÷ area", rate_unit)
    if disc == 0:
        t.warn("discount_rate_annual is 0, so discounted NER equals straight-line NER.")
    _warn_mid_month(s["commencement_date"], t)
    unit_note = _unit_warning(s["unit"])
    if unit_note:
        t.warn(unit_note)
    value: dict[str, Any] = {
        "effective_rent_psf": eff,
        "net_effective_rent_psf": ner,
        "discounted_net_effective_rent_psf": dner,
        "total_rent_due": total,
        "total_landlord_costs": costs,
        "pv_rent": pv_rent,
    }
    if s["unit"] is not None:
        value["unit"] = s["unit"]
        value["rate_unit"] = rate_unit
    return t.result("calc.net_effective_rent", 1, value)


# --- multifamily rent roll ------------------------------------------------------------------

UNIT_STATUSES = ("occupied", "vacant", "notice", "model", "down")


def _opt_date(d: dict[str, Any], key: str, path: str) -> str | None:
    return iso_date(d, key, path) if d.get(key) is not None else None


def _mf_concession(raw: Any, path: str) -> dict[str, Any] | None:
    if raw is None:
        return None
    c = obj(raw, path)
    kind = enum(c, "type", ("weeks_free", "months_free", "amount"), path)
    if kind == "weeks_free":
        return {"type": kind, "weeks": number(c, "weeks", path, gt=0, le=104)}
    if kind == "months_free":
        return {"type": kind, "months": number(c, "months", path, gt=0, le=24)}
    return {"type": kind, "amount": number(c, "amount", path, ge=0)}


def _mf_lease_terms(d: dict[str, Any], path: str) -> dict[str, Any]:
    return {
        "lease_start": _opt_date(d, "lease_start", path),
        "lease_end": _opt_date(d, "lease_end", path),
        "lease_term_months": number(d, "lease_term_months", path, optional=True, gt=0, le=120),
        "concession": _mf_concession(d.get("concession"), join(path, "concession")),
    }


def lease_term_months(start: str, end: str) -> float:
    """Whole months from start to the day after end, plus remaining days ÷ days in the next lease month."""
    after = add_days(end, 1)
    if days_between(start, after) < 1:
        raise CalcInputError("lease_end must be on or after lease_start")
    n = 0
    while n < 1200 and days_between(add_months(start, n + 1), after) >= 0:
        n += 1
    frm = add_months(start, n)
    rem = days_between(frm, after)
    return n if rem == 0 else n + rem / days_between(frm, add_months(start, n + 1))


def _mf_amortise(lease_rent: float, l: dict[str, Any], path: str) -> dict[str, Any]:
    term = l["lease_term_months"]
    if term is None and l["lease_start"] and l["lease_end"]:
        if days_between(l["lease_start"], l["lease_end"]) < 0:
            fail(join(path, "lease_end"), "must be on or after lease_start")
        term = lease_term_months(l["lease_start"], l["lease_end"])
    c = l["concession"]
    if not c:
        return {"term": term, "total": 0, "monthly": 0, "effective": round_(lease_rent, 2)}
    if term is None:
        fail(join(path, "concession"), "a concession needs lease_term_months or lease_start and lease_end to amortise over")
    if c["type"] == "weeks_free":
        total = round_(lease_rent * 12 / 52 * c["weeks"], 2)
    elif c["type"] == "months_free":
        total = round_(lease_rent * c["months"], 2)
    else:
        total = round_(c["amount"], 2)
    if total > round_(lease_rent * term, 2):
        fail(join(path, "concession"),
             f"concession {fmt_money(total)} exceeds the rent for the {js_number_str(round_(term, 4))}-month term")
    monthly = round_(total / term, 2)
    return {"term": term, "total": total, "monthly": monthly, "effective": round_(lease_rent - monthly, 2)}


def _mf_concession_text(c: dict[str, Any], rent: float) -> str:
    if c["type"] == "weeks_free":
        return f"{fmt_money(rent)} × 12 ÷ 52 × {js_number_str(c['weeks'])} weeks"
    if c["type"] == "months_free":
        return f"{fmt_money(rent)} × {js_number_str(c['months'])} months"
    return "stated amount"


def _mf_avg(total: float, n: int) -> float | None:
    return round_(total / n, 2) if n > 0 else None


def _mf_single_lease(d: dict[str, Any]) -> Result:
    p = "lease"
    lease_rent = number(d, "lease_rent", p, ge=0)
    market = number(d, "market_rent", p, optional=True, ge=0)
    sf = number(d, "sf", p, optional=True, gt=0)
    terms = _mf_lease_terms(d, p)
    if terms["lease_term_months"] is None and (terms["lease_start"] is None or terms["lease_end"] is None):
        fail("lease.lease_term_months", "give lease_term_months, or lease_start and lease_end")
    t = Trace()
    a = _mf_amortise(lease_rent, terms, p)
    exact = a["term"] or 0
    term = t.step("Lease term", round_(exact, 4),
                  "lease_term_months" if terms["lease_term_months"] is not None else
                  f"whole months from {terms['lease_start']} to the day after {terms['lease_end']}, plus remaining days "
                  "÷ days in that lease month", "months")
    t.step("Concession", a["total"], _mf_concession_text(terms["concession"], lease_rent) if terms["concession"] else "none",
           "USD")
    t.step("Concession per month", a["monthly"], f"{fmt_money(a['total'])} ÷ {js_number_str(term)} months", "USD")
    effective = t.step("Effective monthly rent", a["effective"], f"{fmt_money(lease_rent)} − {fmt_money(a['monthly'])}", "USD")
    annual = t.step("Effective annual rent", round_(effective * 12, 2), f"{fmt_money(effective)} × 12", "USD")
    psf = t.step("Effective rent per SF (monthly)", round_(effective / sf, 4), f"{fmt_money(effective)} ÷ {js_number_str(sf)} SF",
                 "USD/sf/mo") if sf is not None else None
    ltl = t.step("Loss to lease", round_(market - lease_rent, 2),
                 f"{fmt_money(market)} market − {fmt_money(lease_rent)} lease", "USD") if market is not None else None
    if terms["concession"]:
        t.warn("The concession is amortised straight-line over the whole lease term; in the free weeks or months the "
               "resident pays nothing, so a cash view of those months differs.")
    if exact != math.floor(exact):
        t.warn(f"The lease term is {js_number_str(term)} months (not whole months); confirm the dates or give lease_term_months.")
    return t.result("calc.multifamily_rent_roll", 1, {
        "mode": "single_lease",
        "lease_rent": lease_rent,
        "term_months": term,
        "concession_total": a["total"],
        "concession_monthly": a["monthly"],
        "effective_monthly_rent": effective,
        "effective_annual_rent": annual,
        "effective_rent_psf": psf,
        "loss_to_lease": ltl,
    })


def multifamily_rent_roll(raw: Any) -> Result:
    d = obj(raw)
    as_of = _opt_date(d, "as_of", "")
    include_units = boolean(d, "include_units", default=False)
    has_units, has_lease = d.get("units") is not None, d.get("lease") is not None
    if has_units == has_lease:
        fail("units", "give units (rent roll mode) or lease (single-lease mode)")
    if has_lease:
        return _mf_single_lease(obj(d["lease"], "lease"))
    if as_of is None:
        fail("as_of", "as_of is required with units")
    units = []
    seen: set[str] = set()
    for i, u_raw in enumerate(array(d, "units", min_len=1, max_len=5000)):
        p = join("units", i)
        u = obj(u_raw, p)
        unit = {
            "unit_id": string(u, "unit_id", p, min_len=1, max_len=100),
            "unit_type": string(u, "unit_type", p, optional=True, min_len=1, max_len=100),
            "bedrooms": number(u, "bedrooms", p, optional=True, integer=True, ge=0, le=20),
            "sf": number(u, "sf", p, optional=True, gt=0),
            "status": enum(u, "status", UNIT_STATUSES, p),
            "market_rent": number(u, "market_rent", p, ge=0),
            "lease_rent": number(u, "lease_rent", p, optional=True, ge=0),
            **_mf_lease_terms(u, p),
        }
        if unit["unit_id"] in seen:
            fail(join(p, "unit_id"), f"duplicate unit_id \"{unit['unit_id']}\"")
        seen.add(unit["unit_id"])
        if unit["status"] in ("occupied", "notice") and unit["lease_rent"] is None:
            fail(join(p, "lease_rent"), f"lease_rent is required for a unit with status {unit['status']}")
        units.append(unit)

    t = Trace()
    rows = []
    for i, u in enumerate(units):
        leased = u["status"] in ("occupied", "notice")
        rent = u["lease_rent"] or 0
        a = _mf_amortise(rent, u, join("units", i)) if leased else None
        if u["unit_type"] is not None:
            group = u["unit_type"]
        elif u["bedrooms"] is None:
            group = "unspecified"
        else:
            group = "studio" if u["bedrooms"] == 0 else f"{u['bedrooms']}BR"
        rows.append({
            "unit_id": u["unit_id"],
            "unit_type": group,
            "status": u["status"],
            "market_rent": u["market_rent"],
            "lease_rent": rent if leased else None,
            "loss_to_lease": round_(u["market_rent"] - rent, 2) if leased else None,
            "term_months": round_(a["term"], 4) if a and a["term"] is not None else None,
            "concession_total": a["total"] if a and u["concession"] else None,
            "concession_monthly": a["monthly"] if a and u["concession"] else None,
            "effective_rent": a["effective"] if a else None,
            "lease_end": u["lease_end"] if leased else None,
            "sf": u["sf"],
        })

    def is_leased(r: dict[str, Any]) -> bool:
        return r["status"] in ("occupied", "notice")

    leased_rows = [r for r in rows if is_leased(r)]
    by_status = {s: sum(1 for r in rows if r["status"] == s) for s in UNIT_STATUSES}
    n = len(rows)
    n_leased = len(leased_rows)
    t.step("Units", n, f"{by_status['occupied']} occupied + {by_status['notice']} notice + {by_status['vacant']} vacant + "
                       f"{by_status['model']} model + {by_status['down']} down")
    t.step("Lease term", "lease_term_months, else whole months from lease_start to the day after lease_end plus remaining "
                         "days ÷ days in that lease month")
    t.step("Concessions", "weeks free = lease_rent × 12 ÷ 52 × weeks; months free = lease_rent × months; amount as stated; "
                          "amortised straight-line: ÷ term months, rounded to cents")
    gpr = t.step("Gross potential rent (monthly)", round_(_sum([r["market_rent"] for r in rows]), 2),
                 f"Σ market_rent, all {n} units", "USD")
    vacancy = t.step("Vacancy loss", round_(_sum([r["market_rent"] for r in rows if r["status"] == "vacant"]), 2),
                     f"Σ market_rent, {by_status['vacant']} vacant units", "USD")
    non_rev = t.step("Non-revenue units",
                     round_(_sum([r["market_rent"] for r in rows if r["status"] in ("model", "down")]), 2),
                     f"Σ market_rent, {by_status['model']} model + {by_status['down']} down units", "USD")
    ltl = t.step("Loss to lease", round_(_sum([r["loss_to_lease"] or 0 for r in leased_rows]), 2),
                 f"Σ (market_rent − lease_rent), {n_leased} leased units; negative is gain to lease", "USD")
    with_conc = sum(1 for r in leased_rows if r["concession_total"] is not None)
    conc = t.step("Concessions (amortised)", round_(_sum([r["concession_monthly"] or 0 for r in leased_rows]), 2),
                  f"Σ concession ÷ term, {with_conc} leases with a concession", "USD")
    income = t.step("Effective rent income (monthly)", round_(_sum([r["effective_rent"] or 0 for r in leased_rows]), 2),
                    f"{fmt_money(gpr)} GPR − {fmt_money(vacancy)} vacancy − {fmt_money(non_rev)} non-revenue − "
                    f"{fmt_money(ltl)} loss to lease − {fmt_money(conc)} concessions", "USD")
    physical = t.step("Physical occupancy", round_(n_leased / n, 4),
                      f"{n_leased} occupied or notice ÷ {n} units = {fmt_pct(n_leased / n)}")
    economic = t.step("Economic occupancy", round_(income / gpr, 4) if gpr > 0 else 0,
                      f"{fmt_money(income)} effective rent income ÷ {fmt_money(gpr)} GPR = {fmt_pct(income / gpr)}"
                      if gpr > 0 else "GPR is 0")
    per_unit = _mf_avg(income, n_leased)
    t.step("Effective rent per leased unit", "n/a" if per_unit is None else per_unit,
           f"{fmt_money(income)} ÷ {n_leased} leased units" if n_leased else "no leased units", "USD")
    leased_sf = _sum([r["sf"] for r in leased_rows]) if all(r["sf"] is not None for r in leased_rows) else None
    psf = round_(income / leased_sf, 4) if leased_sf is not None and leased_sf > 0 else None
    t.step("Effective rent per SF (monthly)", "n/a" if psf is None else psf,
           f"{fmt_money(income)} ÷ {js_number_str(leased_sf)} leased SF" if psf is not None
           else "sf missing on a leased unit, or no leased units", "USD/sf/mo")

    exp: dict[str, dict[str, Any]] = {}
    mtm = no_end = 0
    for r in leased_rows:
        if r["lease_end"] is None:
            no_end += 1
            continue
        if days_between(as_of, r["lease_end"]) < 0:
            mtm += 1
            continue
        month = r["lease_end"][:7]
        e = exp.setdefault(month, {"month": month, "units": 0, "lease_rent_monthly": 0})
        e["units"] += 1
        e["lease_rent_monthly"] = round_(e["lease_rent_monthly"] + (r["lease_rent"] or 0), 2)
    expirations = [exp[k] for k in sorted(exp)]
    t.step("Lease expirations", f"{len(expirations)} months with expirations; {mtm} month-to-month; {no_end} without lease_end",
           "leased units grouped by the calendar month of lease_end on or after as_of")

    groups: list[str] = []
    for r in rows:
        if r["unit_type"] not in groups:
            groups.append(r["unit_type"])
    unit_types = []
    for g in groups:
        al = [r for r in rows if r["unit_type"] == g]
        lr = [r for r in al if is_leased(r)]
        eff = _sum([r["effective_rent"] or 0 for r in lr])
        lsf = _sum([r["sf"] for r in lr]) if all(r["sf"] is not None for r in lr) else None
        unit_types.append({
            "unit_type": g,
            "units": len(al),
            "leased_units": len(lr),
            "vacant_units": sum(1 for r in al if r["status"] == "vacant"),
            "non_revenue_units": sum(1 for r in al if r["status"] in ("model", "down")),
            "average_sf": round_(_sum([r["sf"] for r in al]) / len(al), 2) if all(r["sf"] is not None for r in al) else None,
            "average_market_rent": round_(_sum([r["market_rent"] for r in al]) / len(al), 2),
            "average_lease_rent": _mf_avg(_sum([r["lease_rent"] or 0 for r in lr]), len(lr)),
            "average_effective_rent": _mf_avg(eff, len(lr)),
            "loss_to_lease_monthly": round_(_sum([r["loss_to_lease"] or 0 for r in lr]), 2),
            "concessions_monthly": round_(_sum([r["concession_monthly"] or 0 for r in lr]), 2),
            "physical_occupancy": round_(len(lr) / len(al), 4),
            "effective_rent_psf": round_(eff / lsf, 4) if lsf is not None and lsf > 0 else None,
        })

    if conc > 0:
        t.warn("Concessions are amortised straight-line over each lease's full term (effective rent), not recognised as they "
               "burn off; a cash view of the current month differs.")
    if by_status["notice"] > 0:
        t.warn(f"{by_status['notice']} unit(s) on notice are counted as leased and occupied at their lease rent; they will "
               "become vacant.")
    if mtm > 0:
        t.warn(f"{mtm} lease(s) ended before as_of {as_of} and are treated as month-to-month at their lease_rent.")
    ignored = [u["unit_id"] for u in units if u["status"] not in ("occupied", "notice")
               and (u["lease_rent"] is not None or u["concession"] is not None)]
    if ignored:
        more = f" and {len(ignored) - 10} more" if len(ignored) > 10 else ""
        t.warn(f"Units {', '.join(ignored[:10])}{more} are vacant, model, or down but carry lease_rent or a concession; those "
               "lease terms were ignored (a pre-leased unit counts as vacant until move-in).")
    if ltl < 0:
        t.warn(f"Lease rents exceed market rents in total (gain to lease of {fmt_money(-ltl)} a month); check that "
               "market_rent is current.")
    if any(r["sf"] is None for r in rows):
        t.warn("Some units have no sf; per-SF figures and average sf are null for the property or unit types missing it.")
    t.warn("Economic occupancy here is effective lease rent ÷ gross potential rent, before delinquency, bad debt, and other "
           "income; it is not collections.")
    value: dict[str, Any] = {
        "mode": "rent_roll",
        "as_of": as_of,
        "unit_count": n,
        "units_by_status": by_status,
        "leased_units": n_leased,
        "gross_potential_rent_monthly": gpr,
        "vacancy_loss_monthly": vacancy,
        "non_revenue_units_monthly": non_rev,
        "loss_to_lease_monthly": ltl,
        "concessions_monthly": conc,
        "effective_rent_income_monthly": income,
        "gross_potential_rent_annual": round_(gpr * 12, 2),
        "effective_rent_income_annual": round_(income * 12, 2),
        "physical_occupancy": physical,
        "economic_occupancy": economic,
        "average_market_rent": round_(gpr / n, 2),
        "average_lease_rent": _mf_avg(_sum([r["lease_rent"] or 0 for r in leased_rows]), n_leased),
        "effective_rent_per_unit": per_unit,
        "effective_rent_psf": psf,
        "lease_expirations": expirations,
        "month_to_month_units": mtm,
        "no_lease_end_units": no_end,
        "unit_types": unit_types,
    }
    if include_units:
        value["units"] = [{k: v for k, v in r.items() if k != "sf"} for r in rows]
    return t.result("calc.multifamily_rent_roll", 1, value)


# --- CAM ----------------------------------------------------------------------------------

CAP_METHODS = ("compounding_from_base", "simple_from_base", "year_over_year")
_FEE_LINE = re.compile(r"admin|manag", re.IGNORECASE)


def _occupancy_fraction(d: dict[str, Any], year: int, t: Trace) -> float:
    """Occupied days ÷ period days for ``occupancy``, validated against the reconciliation period."""
    if d.get("occupancy") is None:
        return 1
    o = obj(d["occupancy"], "occupancy")
    dates = {k: iso_date(o, k, "occupancy") if o.get(k) is not None else None
             for k in ("move_in_date", "move_out_date", "period_start_date", "period_end_date")}
    start = dates["period_start_date"] or f"{year:04d}-01-01"
    end = dates["period_end_date"] or f"{year:04d}-12-31"
    frm = dates["move_in_date"] or start
    to = dates["move_out_date"] or end
    period_days = days_between(start, end) + 1
    if period_days < 1:
        fail("occupancy.period_end_date", "must be on or after period_start_date")
    if period_days > 366:
        fail("occupancy.period_end_date", "the period is longer than 366 days")
    if days_between(start, frm) < 0:
        fail("occupancy.move_in_date", "must be within the reconciliation period")
    if days_between(to, end) < 0:
        fail("occupancy.move_out_date", "must be within the reconciliation period")
    occupied = days_between(frm, to) + 1
    if occupied < 1:
        fail("occupancy.move_out_date", "must be on or after move_in_date")
    f = occupied / period_days
    t.step("Occupancy fraction", round_(f, 6),
           f"{occupied} occupied days ({frm} to {to}) ÷ {period_days} days in the period ({start} to {end})")
    if f < 1:
        t.warn(f"Prorated for partial occupancy ({occupied} of {period_days} days): the tenant's share, the cap limit, "
               "and any base-year or stop deduction are each scaled by the same fraction; confirm the lease prorates "
               "by days and that cap.reference_amount is a full-year amount.")
    return f


def cam_reconciliation(raw: Any) -> Result:
    d = obj(raw)
    year = number(d, "year", integer=True, ge=1900, le=2200)
    share = number(d, "pro_rata_share", gt=0, le=1)
    expenses = []
    for i, e in enumerate(array(d, "expenses", min_len=1, max_len=1000)):
        p = join("expenses", i)
        e = obj(e, p)
        expenses.append({
            "category": string(e, "category", p, min_len=1, max_len=200),
            "amount": number(e, "amount", p, ge=0),
            "controllable": boolean(e, "controllable", p, default=True),
            "recoverable": boolean(e, "recoverable", p, default=True),
            "variable": boolean(e, "variable", p, default=False),
            "admin_fee_applies": boolean(e, "admin_fee_applies", p, default=True),
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
    fee = None
    if d.get("admin_fee") is not None:
        a = obj(d["admin_fee"], "admin_fee")
        fee = {
            "rate": number(a, "rate", "admin_fee", ge=0, lt=10),
            "applied": enum(a, "applied", ("before_cap", "after_cap"), "admin_fee", default="after_cap"),
            "capped": boolean(a, "capped", "admin_fee", default=False),
        }
    estimates = _money(d, "estimates_paid")
    if st_type == "base_year":
        base = number(st, "base_year_expenses", "structure", ge=0)
    elif st_type == "expense_stop":
        stop = number(st, "stop_amount", "structure", ge=0)

    t = Trace()
    f = _occupancy_fraction(d, year, t)
    prorated = f < 1
    share_text = f"{fmt_num(share)} × {fmt_num(f)}" if prorated else fmt_num(share)
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

    def sum_of(keep: Callable[[dict[str, Any]], bool]) -> float:
        return _sum([e["amount"] for e in adjusted if keep(e)])

    ctrl_total = sum_of(lambda e: e["controllable"])
    unctrl_total = sum_of(lambda e: not e["controllable"])
    ctrl_share = t.step("Tenant share of controllable", round_(ctrl_total * share * f, 2),
                        f"{fmt_money(ctrl_total)} × {share_text}", "USD")
    unctrl_share = t.step("Tenant share of uncontrollable", round_(unctrl_total * share * f, 2),
                          f"{fmt_money(unctrl_total)} × {share_text}", "USD")
    ctrl_fee_base = 0.0
    fee_unctrl = 0.0
    if fee:
        ctrl_fee_base = round_(sum_of(lambda e: e["controllable"] and e["admin_fee_applies"]) * share * f, 2)
        unctrl_fee_base = round_(sum_of(lambda e: not e["controllable"] and e["admin_fee_applies"]) * share * f, 2)
        fee_unctrl = t.step("Admin fee on uncontrollable", round_(fee["rate"] * unctrl_fee_base, 2),
                            f"{fmt_num(fee['rate'])} × {fmt_money(unctrl_fee_base)} fee-eligible uncontrollable share "
                            "(never capped)", "USD")
    cap_limit = None
    capped = ctrl_share
    fee_ctrl = 0.0
    fee_in_cap = False
    if cap:
        method, rate, ref, n = cap["method"], cap["rate"], cap["reference_amount"], cap["years_elapsed"]
        if method != "year_over_year" and n is None:
            raise CalcInputError(f"cap.years_elapsed is required for {method}")
        years = 1 if n is None else n
        if method == "compounding_from_base":
            limit, formula = ref * pow_int(1 + rate, years), f"{fmt_money(ref)} × (1 + {fmt_num(rate)})^{years}"
        elif method == "simple_from_base":
            limit, formula = ref * (1 + rate * years), f"{fmt_money(ref)} × (1 + {fmt_num(rate)} × {years})"
        else:
            limit, formula = ref * (1 + rate), f"{fmt_money(ref)} × (1 + {fmt_num(rate)})"
        cap_limit = t.step(f"Cap limit ({method})", round_(limit, 2), formula, "USD")
        if prorated:
            cap_limit = t.step("Cap limit prorated for occupancy", round_(cap_limit * f, 2),
                               f"{fmt_money(cap_limit)} × {fmt_num(f)}", "USD")
        if fee and fee["applied"] == "before_cap":
            fee_ctrl = t.step("Admin fee on controllable (before cap)", round_(fee["rate"] * ctrl_fee_base, 2),
                              f"{fmt_num(fee['rate'])} × {fmt_money(ctrl_fee_base)} fee-eligible controllable share", "USD")
            fee_in_cap = fee["capped"]
            capped = t.step("Controllable after cap",
                            min(round_(ctrl_share + fee_ctrl, 2) if fee_in_cap else ctrl_share, cap_limit),
                            "min(tenant controllable + admin fee on it, cap limit)" if fee_in_cap
                            else "min(tenant controllable, cap limit); admin fee added outside the cap", "USD")
        else:
            base_capped = t.step("Controllable after cap", min(ctrl_share, cap_limit), "min(tenant controllable, cap limit)", "USD")
            capped = base_capped
            if fee:
                # The cap reduction is spread over controllable lines in proportion to their amounts.
                eligible = base_capped * ctrl_fee_base / ctrl_share if ctrl_share > 0 else 0
                fee_ctrl = t.step("Admin fee on controllable (after cap)", round_(fee["rate"] * eligible, 2),
                                  f"{fmt_num(fee['rate'])} × {fmt_money(base_capped)} capped × {fmt_money(ctrl_fee_base)} "
                                  f"fee-eligible ÷ {fmt_money(ctrl_share)} controllable", "USD")
                fee_in_cap = fee["capped"]
                if fee_in_cap:
                    capped = t.step("Controllable with admin fee, capped", min(round_(base_capped + fee_ctrl, 2), cap_limit),
                                    "min(capped controllable + admin fee on it, cap limit)", "USD")
    elif fee:
        fee_ctrl = t.step("Admin fee on controllable", round_(fee["rate"] * ctrl_fee_base, 2),
                          f"{fmt_num(fee['rate'])} × {fmt_money(ctrl_fee_base)} fee-eligible controllable share (no cap)", "USD")
    cap_reduction = round_((round_(ctrl_share + fee_ctrl, 2) if fee_in_cap else ctrl_share) - capped, 2)
    fee_outside = 0 if fee_in_cap else fee_ctrl
    admin_fee = t.step("Admin fee", round_(fee_ctrl + fee_unctrl, 2),
                       "fee on controllable (subject to the cap) + fee on uncontrollable" if fee_in_cap
                       else "fee on controllable + fee on uncontrollable", "USD") if fee else 0
    deduction = 0.0
    if st_type == "base_year":
        deduction = t.step("Base-year deduction", round_(base * share * f, 2), f"{fmt_money(base)} × {share_text}", "USD")
        if cap:
            t.warn("Cap applied before the base-year deduction; confirm the lease's order of operations.")
    elif st_type == "expense_stop":
        deduction = t.step("Expense-stop deduction", round_(stop * share * f, 2), f"{fmt_money(stop)} × {share_text}", "USD")
        if cap:
            t.warn("Cap applied before the expense-stop deduction; confirm the lease's order of operations.")
    if fee:
        if cap:
            t.warn(f"Admin fee on controllable lines computed {'before' if fee['applied'] == 'before_cap' else 'after'} "
                   f"the cap and {'counted within' if fee['capped'] else 'added outside'} it; confirm the lease's order "
                   "of operations.")
        if st_type != "net":
            t.warn(f"Admin fee added to the current-year share before the "
                   f"{'base-year' if st_type == 'base_year' else 'expense-stop'} deduction; confirm whether "
                   f"{'base_year_expenses' if st_type == 'base_year' else 'stop_amount'} already includes a fee.")
        on_fee = [e["category"] for e in adjusted if e["admin_fee_applies"] and _FEE_LINE.search(e["category"])]
        if on_fee:
            t.warn(f"Admin fee charged on {', '.join(on_fee)}; confirm the lease allows a fee on a fee, or set "
                   "admin_fee_applies false on those lines.")
        if any(not e["controllable"] and e["admin_fee_applies"] for e in adjusted):
            t.warn("Admin fee base includes uncontrollable lines; many leases exclude taxes, insurance, and utilities "
                   "from the fee. Set admin_fee_applies false on lines the lease excludes.")
    charge = t.step("Tenant CAM charge", round_(max(0, capped + fee_outside + unctrl_share + fee_unctrl - deduction), 2),
                    f"max(0, {fmt_money(capped)} + {fmt_money(fee_outside)} fee + {fmt_money(unctrl_share)} + "
                    f"{fmt_money(fee_unctrl)} fee − {fmt_money(deduction)})" if fee else
                    f"max(0, {fmt_money(capped)} + {fmt_money(unctrl_share)} − {fmt_money(deduction)})", "USD")
    balance = t.step("Balance due", round_(charge - estimates, 2),
                     f"{fmt_money(charge)} − {fmt_money(estimates)} estimates paid", "USD")
    t.step("Rounding", "each tenant share, fee, cap limit, and deduction is rounded to the cent half away from zero "
           "before it is combined")
    if not cap:
        t.warn("No CAM cap supplied; confirm the lease has none.")
    return t.result("calc.cam_reconciliation", 2, {
        "recoverable_expenses": rec_total,
        "grossed_up_expenses": grossed,
        "tenant_share_controllable": ctrl_share,
        "tenant_share_uncontrollable": unctrl_share,
        "cap_limit": cap_limit,
        "cap_reduction": cap_reduction,
        "admin_fee": admin_fee,
        "occupancy_fraction": round_(f, 6),
        "structure_deduction": deduction,
        "tenant_charge": charge,
        "estimates_paid": estimates,
        "balance_due": balance,
    })


# --- CAM for every tenant (batch) -----------------------------------------------------------


def _string_list(d: dict[str, Any], key: str, path: str) -> list[str]:
    items = array(d, key, path, default=[], max_len=1000)
    p = join(path, key)
    return [string({"v": v}, "v", join(p, j), min_len=1, max_len=200) for j, v in enumerate(items)]


def _batch_tenant_input(d: dict[str, Any], tenant: dict[str, Any]) -> dict[str, Any]:
    """The single-tenant cam_reconciliation input for one batch tenant (as ``camBatchTenantInput``)."""
    excluded = set(tenant["excluded_categories"])
    no_fee = set(tenant["admin_fee_excluded_categories"])
    out: dict[str, Any] = {
        "year": d["year"],
        "pro_rata_share": tenant["raw"].get("pro_rata_share"),
        "expenses": [{**e, "recoverable": e["recoverable"] and e["category"] not in excluded,
                      "admin_fee_applies": e["admin_fee_applies"] and e["category"] not in no_fee}
                     for e in d["expenses"]],
        "estimates_paid": tenant["raw"].get("estimates_paid"),
    }
    for key in ("structure", "cap", "admin_fee", "occupancy"):
        if tenant["raw"].get(key) is not None:
            out[key] = tenant["raw"][key]
    if d.get("gross_up") is not None:
        out["gross_up"] = d["gross_up"]
    return out


def cam_reconciliation_batch(raw: Any) -> Result:
    d = obj(raw)
    year = number(d, "year", integer=True, ge=1900, le=2200)
    expenses = []
    for i, e in enumerate(array(d, "expenses", min_len=1, max_len=1000)):
        p = join("expenses", i)
        e = obj(e, p)
        expenses.append({
            "category": string(e, "category", p, min_len=1, max_len=200),
            "amount": number(e, "amount", p, ge=0),
            "controllable": boolean(e, "controllable", p, default=True),
            "recoverable": boolean(e, "recoverable", p, default=True),
            "variable": boolean(e, "variable", p, default=False),
            "admin_fee_applies": boolean(e, "admin_fee_applies", p, default=True),
        })
    gross_up = None
    if d.get("gross_up") is not None:
        g = obj(d["gross_up"], "gross_up")
        gross_up = {"actual_occupancy": number(g, "actual_occupancy", "gross_up", gt=0, le=1),
                    "target_occupancy": number(g, "target_occupancy", "gross_up", default=0.95, gt=0, le=1)}
    categories = {e["category"] for e in expenses}
    tenants = []
    names: set[str] = set()
    for i, t_raw in enumerate(array(d, "tenants", min_len=1, max_len=500)):
        p = join("tenants", i)
        tr = obj(t_raw, p)
        name = string(tr, "name", p, min_len=1, max_len=200)
        if name in names:
            fail(join(p, "name"), f"duplicate tenant name \"{name}\"")
        names.add(name)
        tenant = {"name": name, "raw": tr,
                  "excluded_categories": _string_list(tr, "excluded_categories", p),
                  "admin_fee_excluded_categories": _string_list(tr, "admin_fee_excluded_categories", p)}
        for key in ("excluded_categories", "admin_fee_excluded_categories"):
            for j, c in enumerate(tenant[key]):
                if c not in categories:
                    fail(join(join(p, key), j), f"\"{c}\" is not a category in expenses")
        tenants.append(tenant)
    base = {"year": year, "expenses": expenses, "gross_up": gross_up}

    statements = []
    for i, tenant in enumerate(tenants):
        try:
            statement = cam_reconciliation(_batch_tenant_input(base, tenant))
        except CalcInputError as err:
            issues = [{"path": f"tenants.{i}.{x['path']}", "message": x["message"]} for x in err.issues]
            message = ("invalid input: " + "; ".join(f"{x['path']}: {x['message']}" for x in issues) if issues
                       else f"tenants.{i}: {err}")
            raise CalcInputError(message, issues) from None
        statements.append({"name": tenant["name"], "statement": statement})

    t = Trace()
    total = t.step("Total expenses", round_(_sum([e["amount"] for e in expenses]), 2), f"Σ {len(expenses)} expense lines",
                   "USD")
    pool = t.step("Recoverable expenses", round_(_sum([e["amount"] for e in expenses if e["recoverable"]]), 2),
                  "Σ lines with recoverable true (before any tenant's own exclusions)", "USD")
    non_recoverable = round_(total - pool, 2)
    factor = 1.0
    if gross_up:
        a, g = gross_up["actual_occupancy"], gross_up["target_occupancy"]
        factor = g / a if a < g else 1
    grossed = round_(_sum([e["amount"] * factor if e["variable"] else e["amount"] for e in expenses if e["recoverable"]]), 2)

    occupied = exclusions = uplift = floor = 0.0
    lines = [e for e in expenses if e["recoverable"]]
    for i, tenant in enumerate(tenants):
        f = _occupancy_fraction(_batch_tenant_input(base, tenant), year, Trace())
        w = tenant["raw"]["pro_rata_share"] * f
        occupied += w
        excluded = set(tenant["excluded_categories"])
        exclusions += w * _sum([e["amount"] for e in lines if e["category"] in excluded])
        uplift += w * _sum([e["amount"] * (factor - 1) for e in lines if e["variable"] and e["category"] not in excluded])
        v = statements[i]["statement"]["value"]
        pre_floor = round_(v["tenant_share_controllable"] + v["tenant_share_uncontrollable"] + v["admin_fee"]
                           - v["cap_reduction"] - v["structure_deduction"], 2)
        floor += round_(v["tenant_charge"] - pre_floor, 2)
    values = [s["statement"]["value"] for s in statements]
    charges = t.step("Total tenant charges", round_(_sum([v["tenant_charge"] for v in values]), 2),
                     f"Σ tenant_charge, {len(values)} tenants", "USD")
    estimates = round_(_sum([v["estimates_paid"] for v in values]), 2)
    balance = t.step("Total balance due", round_(_sum([v["balance_due"] for v in values]), 2),
                     f"Σ balance_due ({fmt_money(charges)} charges − {fmt_money(estimates)} estimates paid)", "USD")
    unrecovered = t.step("Unrecovered", round_(pool - charges, 2),
                         f"{fmt_money(pool)} recoverable − {fmt_money(charges)} billed; negative is over-recovery", "USD")
    occ = round_(occupied, 6)
    parts = [
        ("unleased_or_vacant", round_(pool * (1 - occupied), 2),
         f"share of the pool not leased or not occupied in the period: {fmt_money(pool)} × (1 − {js_number_str(occ)} Σ share × "
         "occupancy fraction)"),
        ("tenant_exclusions", round_(exclusions, 2),
         "lines individual leases exclude (excluded_categories) × each tenant's share and occupancy"),
        ("gross_up", round_(-uplift, 2),
         "gross-up of variable lines to the target occupancy billed above actual (negative adds to recovery)"),
        ("caps", round_(_sum([v["cap_reduction"] for v in values]), 2), "controllable-expense caps: Σ cap_reduction"),
        ("base_year_and_expense_stop", round_(_sum([v["structure_deduction"] for v in values]), 2),
         "base-year and expense-stop deductions: Σ structure_deduction"),
        ("admin_fees", round_(-_sum([v["admin_fee"] for v in values]), 2),
         "admin fees billed on top of expenses (negative adds to recovery)"),
        ("zero_floor", round_(-floor, 2),
         "charges floored at zero where a deduction exceeded the tenant's share (negative adds to recovery)"),
    ]
    explained = _sum([x[1] for x in parts])
    parts.append(("rounding", round_(unrecovered - explained, 2), "cent rounding of each tenant's shares, fees, and deductions"))
    for reason, amount, why in parts:
        t.step(f"Unrecovered: {reason}", amount, why, "USD")
    if occupied > 1 + 1e-9:
        t.warn(f"Pro rata shares weighted by occupancy sum to {js_number_str(occ)}, more than 1: shares overlap or use different "
               "denominators, so tenants are billed for more than the whole pool.")
    if charges > pool:
        t.warn(f"Tenants are billed {fmt_money(charges - pool)} more than the actual recoverable expenses (over-recovery), "
               "usually from gross-up or admin fees; many leases bar the landlord from recovering more than 100% of actual "
               "costs.")
    with_warnings = [s["name"] for s in statements if s["statement"]["warnings"]]
    if with_warnings:
        more = f" and {len(with_warnings) - 10} more" if len(with_warnings) > 10 else ""
        t.warn(f"Statements for {', '.join(with_warnings[:10])}{more} carry warnings (tenants[i].statement.warnings); relay "
               "them with each statement.")
    return t.result("calc.cam_reconciliation_batch", 1, {
        "year": year,
        "building": {
            "total_expenses": total,
            "non_recoverable_expenses": non_recoverable,
            "recoverable_expenses": pool,
            "grossed_up_expenses": grossed,
            "tenant_count": len(statements),
            "total_pro_rata_share": round_(_sum([x["raw"]["pro_rata_share"] for x in tenants]), 6),
            "occupied_share": occ,
            "total_tenant_charges": charges,
            "total_estimates_paid": estimates,
            "total_balance_due": balance,
            "recovery_ratio": round_(charges / pool, 4) if pool > 0 else 0,
            "unrecovered": unrecovered,
            "unrecovered_reasons": [{"reason": r, "amount": a, "explanation": e} for r, a, e in parts],
        },
        "tenants": statements,
    })


# --- capital expenditure recovery -------------------------------------------------------------

CAPEX_ASSUMPTIONS = ("cost", "amortization_period", "interest", "method", "cost_savings_cap", "pro_rata_share")


def capex_recovery(raw: Any) -> Result:
    d = obj(raw)
    cost_in = number(d, "cost", gt=0)
    n = number(d, "amortization_years", integer=True, ge=1, le=100)
    basis_kind = enum(d, "period_basis", ("useful_life", "lease_specified"), default="useful_life")
    method = enum(d, "method", ("straight_line", "level_payment"), default="straight_line")
    r = number(d, "interest_rate_annual", default=0, ge=0, lt=10)
    first_year = number(d, "first_year", optional=True, integer=True, ge=1900, le=2200)
    cap = None
    if d.get("cost_savings_cap") is not None:
        c = obj(d["cost_savings_cap"], "cost_savings_cap")
        annual = number(c, "annual_savings", "cost_savings_cap", optional=True, ge=0)
        by_year = None
        if c.get("savings_by_year") is not None:
            items = array(c, "savings_by_year", "cost_savings_cap", min_len=1, max_len=100)
            by_year = [number({"v": v}, "v", join("cost_savings_cap.savings_by_year", j), ge=0) for j, v in enumerate(items)]
        if (annual is None) == (by_year is None):
            fail("cost_savings_cap.annual_savings", "give annual_savings or savings_by_year, not both")
        if by_year is not None and len(by_year) != n:
            fail("cost_savings_cap.savings_by_year", f"needs one amount per recovery year ({n})")
        cap = {"annual_savings": annual, "savings_by_year": by_year,
               "carry_forward": boolean(c, "carry_forward", "cost_savings_cap", default=False)}
    tenants = None
    if d.get("tenants") is not None:
        tenants = []
        names: set[str] = set()
        for i, x in enumerate(array(d, "tenants", min_len=1, max_len=1000)):
            p = join("tenants", i)
            x = obj(x, p)
            name = string(x, "name", p, min_len=1, max_len=200)
            if name in names:
                fail(join(p, "name"), f"duplicate tenant name \"{name}\"")
            names.add(name)
            tenants.append({"name": name, "pro_rata_share": number(x, "pro_rata_share", p, gt=0, le=1)})
    clauses: dict[str, Any] = {}
    if d.get("clauses") is not None:
        cl = obj(d["clauses"], "clauses")
        clauses = {k: string(cl, k, "clauses", optional=True, min_len=1, max_len=500) for k in CAPEX_ASSUMPTIONS}

    t = Trace()
    cost = round_(cost_in, 2)
    level = method == "level_payment" and r > 0
    share_sum = _sum([x["pro_rata_share"] for x in tenants or []])
    if round_(share_sum, 9) > 1:
        raise CalcInputError(f"invalid input: tenants: pro rata shares sum to {js_number_str(round_(share_sum, 6))}, more than 1",
                             [{"path": "tenants", "message": "pro rata shares sum to more than 1"}])
    t.step("Method",
           "straight-line: principal = cost ÷ years each year; interest = rate × unamortized balance at the start of the year"
           if method == "straight_line" else
           "level payment: payment = cost × r ÷ (1 − (1 + r)^−years); interest = rate × balance at the start of the year; "
           "principal = payment − interest")
    if level:
        payment = t.step("Level annual payment", round_(cost * r / (1 - pow_int(1 + r, -n)), 2),
                         f"{fmt_money(cost)} × {js_number_str(r)} ÷ (1 − (1 + {js_number_str(r)})^−{n})", "USD")
    else:
        payment = t.step("Annual principal", round_(cost / n, 2),
                         f"{fmt_money(cost)} ÷ {n} years"
                         + (" (no interest, so level payment equals straight-line)" if method == "level_payment" else ""),
                         "USD")
    schedule = []
    balance = cost
    carry = 0.0
    for k in range(1, n + 1):
        opening = balance
        interest = round_(opening * r, 2)
        principal = opening if k == n else min(round_(payment - interest, 2) if level else payment, opening)
        amortization = round_(principal + interest, 2)
        if cap is None:
            savings = None
        elif cap["annual_savings"] is not None:
            savings = cap["annual_savings"]
        else:
            savings = cap["savings_by_year"][k - 1]
        eligible = round_(amortization + carry, 2)
        recoverable = eligible if savings is None else round_(min(eligible, savings), 2)
        excess = round_(eligible - recoverable, 2)
        carry = excess if cap and cap["carry_forward"] and k < n else 0
        balance = round_(opening - principal, 2)
        schedule.append({
            "year_index": k,
            "year": None if first_year is None else first_year + k - 1,
            "opening_balance": opening,
            "principal": principal,
            "interest": interest,
            "amortization": amortization,
            "savings_cap": savings,
            "recoverable": recoverable,
            "excess_over_cap": excess,
            "carried_forward": carry,
            "closing_balance": balance,
        })
        t.step(f"Year {k}" + ("" if first_year is None else f" ({first_year + k - 1})"), recoverable,
               f"{fmt_money(principal)} principal + {fmt_money(interest)} interest on {fmt_money(opening)}"
               + (f" + {fmt_money(eligible - amortization)} carried in" if eligible != amortization else "")
               + ("" if savings is None else f", capped at {fmt_money(savings)} savings"), "USD")

    def total(key: str) -> float:
        return round_(_sum([y[key] for y in schedule]), 2)

    total_principal = total("principal")
    total_interest = t.step("Total interest", total("interest"), "Σ interest", "USD")
    total_amortization = t.step("Total amortization", total("amortization"),
                                f"{fmt_money(total_principal)} principal + {fmt_money(total_interest)} interest", "USD")
    total_recoverable = t.step("Total recoverable", total("recoverable"), "Σ recoverable", "USD")
    unrecovered = t.step("Total unrecovered", round_(total_amortization - total_recoverable, 2),
                         f"{fmt_money(total_amortization)} − {fmt_money(total_recoverable)}", "USD")
    tenant_rows = []
    for x in tenants or []:
        by_year = [round_(y["recoverable"] * x["pro_rata_share"], 2) for y in schedule]
        sum_t = round_(_sum(by_year), 2)
        t.step(f"Tenant {x['name']}", sum_t, f"recoverable each year × {js_number_str(x['pro_rata_share'])}, rounded to cents", "USD")
        tenant_rows.append({"name": x["name"], "pro_rata_share": x["pro_rata_share"], "by_year": by_year, "total": sum_t})
    if tenants is not None and round_(share_sum, 9) < 1:
        t.step("Landlord-retained share", round_(1 - share_sum, 6), "1 − Σ tenant pro rata shares")

    basis = "useful life" if basis_kind == "useful_life" else "lease-specified period"
    if cap is None:
        cap_text = "none"
    else:
        carried = "carried forward" if cap["carry_forward"] else "not carried forward"
        cap_text = (f"recovery limited to {fmt_money(cap['annual_savings'])} of demonstrated savings a year; excess {carried}"
                    if cap["annual_savings"] is not None else
                    f"recovery limited to demonstrated savings by year "
                    f"({', '.join(fmt_money(s) for s in cap['savings_by_year'])}); excess {carried}")
    values = {
        "cost": fmt_money(cost),
        "amortization_period": f"{n} years ({basis})",
        "interest": "none" if r == 0 else f"{fmt_pct(r)} a year on the unamortized balance at the start of each year",
        "method": "straight-line principal plus interest on the declining balance" if method == "straight_line"
        else "level annual payment (principal and interest)",
        "cost_savings_cap": cap_text,
        "pro_rata_share": f"{len(tenants)} tenant(s), shares sum to {js_number_str(round_(share_sum, 6))}" if tenants is not None
        else "building level only (no tenants given)",
    }
    assumptions = [{"assumption": k, "value": values[k], "clause": clauses.get(k)} for k in CAPEX_ASSUMPTIONS]

    t.warn("Recovery assumes the lease passes this capital expenditure through; many leases allow only capital items that "
           "cut operating costs or are required by law, and only their annual amortized portion. Confirm the clause.")
    uncited = [a["assumption"] for a in assumptions if a["clause"] is None
               and (a["assumption"] != "cost_savings_cap" or cap is not None)
               and (a["assumption"] != "pro_rata_share" or tenants is not None)]
    if uncited:
        t.warn(f"No lease clause cited for {', '.join(uncited)}; give clauses so each assumption can be checked against the "
               "lease.")
    if r == 0:
        t.warn("No interest on the unamortized balance (interest_rate_annual 0); confirm the lease allows no interest or "
               "carrying charge.")
    else:
        t.warn("Interest is charged once a year on the unamortized balance at the start of the year; a lease that charges "
               "interest monthly or on the average balance gives a different amount.")
    if unrecovered > 0:
        t.warn(f"The cost-savings cap disallows {fmt_money(unrecovered)} of the amortized cost"
               + (" (carried forward but not recovered by the end of the period)" if cap and cap["carry_forward"] else "")
               + "; savings must be demonstrated as the lease requires.")
    return t.result("calc.capex_recovery", 1, {
        "method": method,
        "annual_payment": payment,
        "schedule": schedule,
        "total_principal": total_principal,
        "total_interest": total_interest,
        "total_amortization": total_amortization,
        "total_recoverable": total_recoverable,
        "total_unrecovered": unrecovered,
        "tenants": tenant_rows,
        "assumptions": assumptions,
    })


# --- debt -----------------------------------------------------------------------------------


def annual_constant(rate_annual: float, amortization_years: int) -> float:
    """Annual debt service per dollar of loan, with monthly payments."""
    if amortization_years == 0:
        return rate_annual
    n = amortization_years * 12
    r = rate_annual / 12
    return 12 / n if r == 0 else (12 * r) / (1 - pow_int(1 + r, -n))


def _size_loan(noi: float, value: float | None, rate: float, amort: int, max_ltv: float | None,
               min_dscr: float | None, min_dy: float | None, step: float) -> dict[str, Any]:
    """The constraint loans and the rounded max loan for one set of NOI, value and rate."""
    k = annual_constant(rate, amort)
    loans: dict[str, float] = {}
    if max_ltv is not None and value is not None:
        loans["ltv"] = value * max_ltv
    if min_dscr is not None:
        loans["dscr"] = ieee_div(noi / min_dscr, k)
    if min_dy is not None:
        loans["debt_yield"] = noi / min_dy
    binding, min_loan = None, math.inf
    for c, v in loans.items():
        if binding is None or v < min_loan:
            binding, min_loan = c, v
    # Floor after reducing to 15 significant digits, so binary noise such as
    # 0.57 * 10_000_000 == 5699999.999999999 does not cost a whole increment.
    loan = math.floor(reduce_noise(min_loan / step)) * step if 0 < min_loan < math.inf else min_loan
    return {"k": k, "loans": loans, "binding": binding, "min_loan": min_loan, "loan": loan}


def _shocks(st: dict[str, Any], key: str, gt: float, lt: float) -> list[float] | None:
    if st.get(key) is None:
        return None
    path = join("stress", key)
    values = array(st, key, "stress", min_len=1, max_len=10)
    return [number({"v": v}, "v", join(path, i), gt=gt, lt=lt) for i, v in enumerate(values)]


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
    existing = number(d, "existing_loan_balance", optional=True, gt=0)
    if max_ltv is None and min_dscr is None and min_dy is None:
        fail("", "provide at least one of max_ltv, min_dscr, min_debt_yield")
    if max_ltv is not None and value is None:
        fail("value", "value is required when max_ltv is set")
    st = None
    if d.get("stress") is not None:
        sd = obj(d["stress"], "stress")
        st = {
            "noi_shocks": _shocks(sd, "noi_shocks", -1, 10),
            "rate_shocks": _shocks(sd, "rate_shocks", -1, 1),
            "value_shocks": _shocks(sd, "value_shocks", -1, 10),
            "value_moves_with_noi": boolean(sd, "value_moves_with_noi", "stress", default=False),
        }
        if st["noi_shocks"] is None and st["rate_shocks"] is None and st["value_shocks"] is None:
            fail("stress", "give at least one of noi_shocks, rate_shocks, value_shocks")
        if (st["value_shocks"] is not None or st["value_moves_with_noi"]) and value is None:
            fail("value", "value is required for value_shocks or value_moves_with_noi")
        for i, dr in enumerate(st["rate_shocks"] or []):
            r = rate + dr
            if not (r >= 0 and r < 1):
                fail(f"stress.rate_shocks.{i}", f"stressed rate {num_str(r)} must be at least 0 and below 1")

    t = Trace()
    base = _size_loan(noi, value, rate, amort, max_ltv, min_dscr, min_dy, step)
    k = t.step("Annual constant", base["k"],
               f"interest-only: {fmt_pct(rate, 3)}" if amort == 0
               else f"12 × r ÷ (1 − (1 + r)^−n), r = {fmt_num(rate)}/12, n = {amort * 12}")
    loans = base["loans"]
    if "ltv" in loans:
        t.step("Loan at max LTV", loans["ltv"], f"{fmt_money(value)} × {fmt_num(max_ltv)}", "USD")
    if "dscr" in loans:
        t.step("Loan at min DSCR", loans["dscr"],
               f"({fmt_money(noi)} ÷ {fmt_num(min_dscr)}) ÷ {fmt_num(k)}", "USD")
    if "debt_yield" in loans:
        t.step("Loan at min debt yield", loans["debt_yield"], f"{fmt_money(noi)} ÷ {fmt_num(min_dy)}", "USD")
    for v in loans.values():
        if not math.isfinite(v):
            # A 0% interest-only loan has a zero annual constant; TypeScript fails rounding the
            # infinite DSCR loan, and so do we (Python's math.floor would raise OverflowError).
            raise CalcInputError(f"cannot round non-finite value {v}")
    binding, min_loan = base["binding"], base["min_loan"]
    if min_loan <= 0:
        raise CalcInputError("constraints produce a non-positive loan")
    loan = t.step("Max loan", base["loan"],
                  "min(" + ", ".join(f"{c} {fmt_money(v)}" for c, v in loans.items()) + f"), rounded down to {fmt_num(step)}",
                  "USD")
    if loan <= 0:
        raise CalcInputError(f"the constraints allow {fmt_money(min_loan)}, less than one rounding increment "
                             f"(round_down_to {num_str(step)}); check value and noi")
    t.step("Binding constraint", binding)
    ds = round_(loan * k, 2)
    out: dict[str, Any] = {
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
    }
    if existing is not None:
        shortfall = round_(max(0, existing - loan), 2)
        out["refinance"] = {
            "existing_loan_balance": existing,
            "shortfall": t.step("Refinance shortfall", shortfall,
                                f"max(0, existing {fmt_money(existing)} − max loan {fmt_money(loan)})", "USD"),
            "excess_proceeds": round_(max(0, loan - existing), 2),
        }
        if shortfall > 0:
            t.warn(f"The max loan is {fmt_money(shortfall)} short of the existing {fmt_money(existing)} balance; "
                   "the refinance needs that much equity or a paydown.")
    if st is not None:
        noi_shocks = st["noi_shocks"] or [0]
        rate_shocks = st["rate_shocks"] or [0]
        value_shocks = st["value_shocks"] or [0]
        rows = []
        for dn in noi_shocks:
            for dr in rate_shocks:
                for dv in value_shocks:
                    s_noi = noi * (1 + dn)
                    s_rate = rate + dr
                    s_value = None if value is None else value * ((1 + dn) if st["value_moves_with_noi"] else 1) * (1 + dv)
                    sz = _size_loan(s_noi, s_value, s_rate, amort, max_ltv, min_dscr, min_dy, step)
                    if any(not math.isfinite(x) for x in sz["loans"].values()):
                        raise CalcInputError(f"stress scenario at rate {num_str(s_rate)} gives an unbounded DSCR loan "
                                             "(a 0% interest-only rate); use rate_shocks that keep the rate above 0")
                    ok = sz["loan"] > 0 and math.isfinite(sz["loan"])
                    m = sz["loan"] if ok else 0
                    sds = round_(m * sz["k"], 2)
                    row: dict[str, Any] = {
                        "noi_shock": dn,
                        "rate_shock": dr,
                        "value_shock": dv,
                        "noi": round_(s_noi, 2),
                        "rate_annual": round_(s_rate, 8),
                        "value": None if s_value is None else round_(s_value, 2),
                        "max_loan": m,
                        "binding_constraint": sz["binding"],
                        "annual_debt_service": sds,
                        "ltv": round_(m / s_value, 4) if ok and s_value is not None else None,
                        "dscr": round_(s_noi / sds, 4) if ok and sds > 0 else None,
                        "debt_yield": round_(s_noi / m, 4) if ok else None,
                    }
                    if existing is not None:
                        row["refinance_shortfall"] = round_(max(0, existing - m), 2)
                    rows.append(row)
        out["stress"] = rows
        worst = rows[0]
        for row in rows[1:]:
            if row["max_loan"] < worst["max_loan"]:
                worst = row
        t.step("Stress scenarios", len(rows),
               f"{len(noi_shocks)} NOI × {len(rate_shocks)} rate × {len(value_shocks)} value shocks; NOI × (1 + shock), "
               f"rate + shock, value × {'(1 + NOI shock) × ' if st['value_moves_with_noi'] else ''}(1 + shock); "
               "same constraints and rounding as the base")
        t.step("Lowest stressed max loan", worst["max_loan"],
               f"NOI shock {fmt_num(worst['noi_shock'])}, rate shock {fmt_num(worst['rate_shock'])}, value shock "
               f"{fmt_num(worst['value_shock'])}; binding {worst['binding_constraint']}", "USD")
        if any(row["max_loan"] == 0 for row in rows):
            t.warn("In at least one stress scenario the constraints allow less than one rounding increment; its "
                   "max_loan is 0 and its metrics are null.")
        if st["noi_shocks"] is not None and not st["value_moves_with_noi"] and max_ltv is not None:
            t.warn("Value is held fixed under the NOI shocks, so the LTV test ignores them; set value_moves_with_noi "
                   "or add value_shocks if the lender reprices value on stressed NOI.")
    return t.result("calc.debt_sizing", 3, out)


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
    for i, p_raw in enumerate(array(d, "payments", min_len=1, max_len=1200)):
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
    # Payments are taken to the cent, so every schedule row is in whole cents.
    def pay(k: int) -> float:
        return round_(by_period.get(k, 0), 2)

    for k in range(1, n + 1):
        p = pay(k)
        total += p
        pv += p * pow_int(1 + r, -(k - 1) if in_advance else -k)
    total_payments = t.step("Remaining lease payments", round_(total, 2), "Σ payment_k, k = 1..n", "USD")
    new_liability = t.step(
        "New lease liability", round_(pv, 2),
        f"ASC 842-10-35-4 and 842-20-35-3: Σ payment_k ÷ (1 + r)^{'(k − 1)' if in_advance else 'k'}, "
        f"r = {fmt_num(r, 8)}, payments in {'advance' if in_advance else 'arrears'}", "USD")
    liability_adj = t.step("Liability adjustment", round_(new_liability - liability_before, 2),
                           f"{fmt_money(new_liability)} − {fmt_money(liability_before)} carrying amount", "USD")
    rou_adj = t.step("ROU asset adjustment", round_(max(liability_adj, -rou_before), 2),
                     f"ASC 842-20-35-4: liability change adjusts the ROU asset, floored at −{fmt_money(rou_before)} "
                     "so the asset is not reduced below zero", "USD")
    gain = t.step("Gain recognized", round_(rou_adj - liability_adj, 2),
                  "ASC 842-20-35-4: remeasurement in excess of the ROU asset carrying amount goes to profit or loss", "USD")
    new_rou = t.step("New ROU asset", round_(rou_before + rou_adj, 2), f"{fmt_money(rou_before)} + {fmt_money(rou_adj)}", "USD")

    operating = classification == "operating"
    # Operating: the total lease cost over the remaining term is fixed in cents; every period
    # takes the straight-line amount and the last takes what is left (ASC 842-20-25-6).
    total_cost = round_(total_payments + new_rou - new_liability, 2)
    sl_cost = 0.0
    amort_per = 0.0
    if operating:
        sl_cost = t.step("Straight-line lease cost", round_(total_cost / n, 2),
                         f"ASC 842-20-25-6: (remaining payments {fmt_money(total_payments)} + ROU {fmt_money(new_rou)} − "
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
    t.step("Rounding",
           "every row is in cents and rolls forward exactly: closing liability = opening − payment + interest, "
           "closing ROU = opening ROU − amortization; interest is rounded to the cent half away from zero each period; "
           "the final period's interest is the amount that closes the liability at 0.00, "
           + ("and its lease cost is total lease cost less the earlier periods, so the ROU asset also closes at 0.00"
              if operating else "and its amortization is the ROU asset left, so the ROU asset also closes at 0.00")
           + "; totals are the sums of the rows")

    schedule = []
    liability = new_liability
    rou = new_rou
    sum_interest = sum_amort = sum_cost = true_up = 0.0
    for k in range(1, n + 1):
        last = k == n
        opening = liability
        p = pay(k)
        accrued = round_((opening - p if in_advance else opening) * r, 2)
        interest = round_(p - opening, 2) if last else accrued
        if last:
            true_up = round_(interest - accrued, 2)
        closing = round_(opening - p + interest, 2)
        if operating:
            cost = round_(total_cost - sum_cost, 2) if last else sl_cost
            amort = round_(cost - interest, 2)
        else:
            amort = round_(new_rou - sum_amort, 2) if last else amort_per
            cost = round_(interest + amort, 2)
        rou = round_(rou - amort, 2)
        sum_interest = round_(sum_interest + interest, 2)
        sum_amort = round_(sum_amort + amort, 2)
        sum_cost = round_(sum_cost + cost, 2)
        schedule.append({
            "period": k,
            "opening_liability": opening,
            "payment": p,
            "interest": interest,
            "closing_liability": closing,
            "amortization": amort,
            "closing_rou_asset": rou,
            "lease_cost": cost,
        })
        liability = closing
    last_interest = schedule[n - 1]["interest"]
    t.step("Final-period interest true-up", true_up,
           f"period {n} interest {fmt_money(last_interest)} versus {fmt_money(round_(last_interest - true_up, 2))} "
           "at opening liability × r: the cents left by rounding each period", "USD")
    t.step("Total interest", sum_interest, "Σ row interest = remaining payments − new lease liability", "USD")
    t.step("Total lease cost", sum_cost,
           "Σ row lease cost = remaining payments + new ROU asset − new lease liability" if operating
           else "Σ row lease cost = total interest + new ROU asset", "USD")

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

    return t.result("calc.lease_remeasurement_asc842", 2, {
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
        "total_interest": sum_interest,
        "total_amortization": sum_amort,
        "total_lease_cost": sum_cost,
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
        for i, s_raw in enumerate(array(pp, "schedule", "prepayment", min_len=1, max_len=1200)):
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
            for i, y_raw in enumerate(array(pp, "replacement_yield", "prepayment", min_len=1, max_len=1200)):
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
                                f"Σ payment_k ÷ (1 + {fmt_num(m, 8)})^k, k = 1..{n}", "USD")
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
                              f"(1 + {fmt_num(m, 8)})^k, k = 1..{n}", "USD")
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
    for i, lease in enumerate(array(d, "leases", min_len=1, max_len=10000)):
        p = join("leases", i)
        lease = obj(lease, p)
        string(lease, "id", p, optional=True, max_len=200)  # not used in the math; validated as in TypeScript
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
    result = t.step("WALT", round_(weighted / total, 4), f"Σ({key} × years remaining) ÷ Σ {key}; years remaining = actual days ÷ 365.25", "years")
    if expired:
        t.warn(f"{expired} lease(s) expired on or before {as_of}; counted as 0 years remaining.")
    return t.result("calc.walt", 1, {"walt_years": result, "total_weight": round_(total, 2), "expired_count": expired})


# --- finance --------------------------------------------------------------------------------


MAX_NPV_CASH_FLOWS = 10_000  # linear cost
MAX_IRR_CASH_FLOWS = 1_200  # 100 years monthly; the root scan evaluates the NPV ~1,100 times


def _cash_flows(d: dict[str, Any], max_len: int) -> list[float]:
    flows = array(d, "cash_flows", min_len=2, max_len=max_len)
    for i, cf in enumerate(flows):
        number({"cf": cf}, "cf", join("cash_flows", i))
    return flows


def _npv_at(flows: list[float], r: float) -> float:
    acc = 0.0
    for i, cf in enumerate(flows):
        acc += ieee_div(cf, pow_int(1 + r, i))
    return acc


def npv(raw: Any) -> Result:
    d = obj(raw)
    flows = _cash_flows(d, MAX_NPV_CASH_FLOWS)
    rate = number(d, "rate", gt=-1)
    t = Trace()
    v = t.step("NPV", round_(_npv_at(flows, rate), 2), f"Σ CF_t ÷ (1 + {fmt_num(rate)})^t")
    return t.result("calc.npv", 1, {"npv": v})


def irr(raw: Any) -> Result:
    d = obj(raw)
    flows = _cash_flows(d, MAX_IRR_CASH_FLOWS)
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
        if not (math.isfinite(f_lo) and math.isfinite(f_hi)):
            # Near -100% a long series underflows (1 + r)^t to 0 and the NPV is ±inf or nan:
            # no sign to bracket, so no root is reported there (calc.irr@2).
            continue
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
    return t.result("calc.irr", 2, {
        "irr_periodic": round_(periodic, 8),
        "irr_annual": round_(annual, 8),
        "roots": [round_(r, 8) for r in unique],
    })


# --- proposals & retail ---------------------------------------------------------------------------


OPEX_TYPES = ("gross", "nnn", "base_year", "expense_stop")


def _proposal_opex(raw: Any, path: str) -> dict[str, Any] | None:
    if raw is None:
        return None
    o = obj(raw, path)
    kind = enum(o, "type", OPEX_TYPES, path)
    out = {
        "type": kind,
        "expense_psf_annual": number(o, "expense_psf_annual", path, ge=0, **({"default": 0} if kind == "gross" else {})),
        "growth_rate_annual": number(o, "growth_rate_annual", path, default=0, gt=-1, lt=10),
    }
    if kind == "base_year":
        out["base_year_psf_annual"] = number(o, "base_year_psf_annual", path, optional=True, ge=0)
    elif kind == "expense_stop":
        out["stop_psf_annual"] = number(o, "stop_psf_annual", path, ge=0)
    return out


def _opex_psf(o: dict[str, Any], year: int) -> tuple[float, float]:
    """Operating expenses in lease year ``year`` (0 = first): (total $/SF/yr, tenant-paid $/SF/yr)."""
    total = o["expense_psf_annual"] * pow_int(1 + o["growth_rate_annual"], year)
    if o["type"] == "gross":
        return total, 0
    if o["type"] == "nnn":
        return total, total
    if o["type"] == "base_year":
        base = o["base_year_psf_annual"]
        return total, max(0, total - (o["expense_psf_annual"] if base is None else base))
    return total, max(0, total - o["stop_psf_annual"])


def compare_proposals(raw: Any) -> Result:
    d = obj(raw)
    perspective = enum(d, "perspective", ("tenant", "landlord"), default="tenant")
    disc = number(d, "discount_rate_annual", default=0.08, ge=0, lt=1)
    area_basis = enum(d, "area_basis", ("rentable", "usable"), default="rentable")
    proposals = []
    for i, p_raw in enumerate(array(d, "proposals", min_len=2, max_len=20)):
        p = join("proposals", i)
        pd = obj(p_raw, p)
        sched = _schedule_input(pd.get("schedule"), join(p, "schedule"))
        usf = number(pd, "usable_sf", p, optional=True, gt=0)
        load = number(pd, "load_factor", p, optional=True, ge=1, le=3)
        if usf is not None and load is not None:
            fail(join(p, "load_factor"), "give usable_sf or load_factor, not both")
        if usf is not None and usf > sched["area_sf"]:
            fail(join(p, "usable_sf"), "usable_sf cannot exceed schedule.area_sf (rentable)")
        if area_basis == "usable" and usf is None and load is None:
            fail(join(p, "usable_sf"), "area_basis usable needs usable_sf or load_factor")
        proposals.append({
            "name": string(pd, "name", p, min_len=1, max_len=200),
            "schedule": sched,
            "usable_sf": usf,
            "load_factor": load,
            "ti_allowance_psf": _money(pd, "ti_allowance_psf", p),
            "other_concessions": _money(pd, "other_concessions", p),
            "leasing_commissions": _money(pd, "leasing_commissions", p),
            "operating_expenses": _proposal_opex(pd.get("operating_expenses"), join(p, "operating_expenses")),
            "additional_costs_psf_annual": _money(pd, "additional_costs_psf_annual", p),
            "tenant_upfront_costs": _money(pd, "tenant_upfront_costs", p),
            "downtime_months": number(pd, "downtime_months", p, default=0, integer=True, ge=0, le=120),
        })
    if len({p["name"] for p in proposals}) != len(proposals):
        fail("proposals", "proposal names must be unique")
    unit0 = proposals[0]["schedule"]["unit"] or "sf"
    if unit0 != "sf" and area_basis == "usable":
        fail("area_basis", f"area_basis usable applies to square feet only, not {unit0}")
    for i, pr in enumerate(proposals):
        u = pr["schedule"]["unit"] or "sf"
        if u != unit0:
            fail(join(join(join("proposals", i), "schedule"), "unit"),
                 f"every proposal must use the same unit; the first uses {unit0}, this one {u}")
        if u != "sf" and (pr["usable_sf"] is not None or pr["load_factor"] is not None):
            fail(join(join("proposals", i), "usable_sf" if pr["usable_sf"] is not None else "load_factor"),
                 f"usable_sf and load_factor apply to square feet only, not {u}")

    t = Trace()
    tenant = perspective == "tenant"
    usable = area_basis == "usable"
    unit = next((p["schedule"]["unit"] for p in proposals if p["schedule"]["unit"] is not None), None)
    qty, per, rate_unit = _unit_labels(unit)
    sf_unit = (unit or "sf") == "sf"
    r = disc / 12
    t.step("Method",
           "effective cost = level monthly payment with PV of (rent + tenant-paid operating expenses + additional costs "
           "+ upfront − TI − concessions), × 12 ÷ area"
           if tenant else
           "discounted NER = level monthly payment with PV of (rent − landlord-borne operating expenses − TI − "
           "commissions − concessions), × 12 ÷ area")
    t.step("Discounting",
           f"monthly cash flows at the start of each month (annuity due), monthly rate r = {fmt_num(disc)} ÷ 12 = "
           f"{fmt_num(r, 8)}; one-time items at commencement" + ("" if tenant else "; t = 0 is the start of any downtime"),
           "level amount = (PV of flows + PV of one-time items) ÷ Σ (1 + r)^−t")
    t.step("Lease months",
           "each month runs from the commencement day-of-month; rent is not prorated to calendar months; "
           "operating expenses grow each lease year from commencement")
    t.step("Area basis",
           "usable SF: usable_sf, or area_sf ÷ load_factor; rents, TI and expenses are per rentable SF" if usable
           else "rentable SF (schedule.area_sf)" if sf_unit
           else f"{qty} (schedule.area_sf, unit {unit}); rents, TI and expenses are per {per}")
    rows = []
    for p in proposals:
        s = p["schedule"]
        rsf = s["area_sf"]
        months = _build_months(s)
        usf = p["usable_sf"] if p["usable_sf"] is not None else (
            rsf / p["load_factor"] if p["load_factor"] is not None else None)
        load = p["load_factor"] if p["load_factor"] is not None else (
            rsf / p["usable_sf"] if p["usable_sf"] is not None else None)
        basis = (rsf if usf is None else usf) if usable else rsf
        downtime = 0 if tenant else p["downtime_months"]
        opex = p["operating_expenses"]
        extra = round_(p["additional_costs_psf_annual"] * rsf / 12, 2) if tenant else 0
        pv = annuity = total = 0.0
        # Landlord downtime: no rent; the landlord carries lease-year-1 operating expenses.
        carry = round_(opex["expense_psf_annual"] * rsf / 12, 2) if opex else 0
        for j in range(downtime):
            df = pow_int(1 + r, -j)
            pv -= carry * df
            annuity += df
            total -= carry
        for i, m in enumerate(months):
            df = pow_int(1 + r, -(i + downtime))
            if opex:
                all_psf, paid = _opex_psf(opex, i // 12)
                tenant_opex = round_(paid * rsf / 12, 2)
                flow = (m["rent_due"] + extra + tenant_opex if tenant
                        else m["rent_due"] - round_(round_(all_psf * rsf / 12, 2) - tenant_opex, 2))
            else:
                flow = m["rent_due"] + extra
            pv += flow * df
            annuity += df
            total += flow
        ti = p["ti_allowance_psf"] * rsf
        upfront = (p["tenant_upfront_costs"] - ti - p["other_concessions"]) if tenant \
            else -(ti + p["leasing_commissions"] + p["other_concessions"])
        upfront_pv = upfront * pow_int(1 + r, -downtime)
        level = (pv + upfront_pv) / annuity
        metric = round_(level * 12 / basis, 4)
        t.step(p["name"], metric,
               f"PV {fmt_money(pv)} {'−' if upfront_pv < 0 else '+'} {fmt_money(abs(upfront_pv))} one-time; "
               + (f"{downtime} downtime + " if downtime else "") + f"{len(months)} months; "
               + (f"{opex['type']} opex; " if opex else "")
               + f"÷ {num_str(round_(basis, 2))} " + (f"{'usable' if usable else 'rentable'} SF" if sf_unit else qty),
               rate_unit)
        rows.append(({
            "name": p["name"], "metric_psf_annual": metric, "total_net": round_(total + upfront, 2),
            "term_months": s["term_months"], "area_sf": rsf,
            "usable_sf": None if usf is None else round_(usf, 2),
            "load_factor": None if load is None else round_(load, 4),
            "basis_area_sf": round_(basis, 2),
            "opex_structure": opex["type"] if opex else None,
            "downtime_months": downtime,
        }, None if usf is None else round_(level * 12 / usf, 4)))

    def key(v: float) -> float:
        return v if tenant else -v

    ranked = sorted(rows, key=lambda x: key(x[0]["metric_psf_annual"]))
    ranking = [{"rank": i + 1, **row} for i, (row, _) in enumerate(ranked)]
    best = ranking[0]["name"]
    t.step("Best", best, "lowest effective occupancy cost" if tenant else "highest discounted NER")
    if len({row["basis_area_sf"] for row, _ in rows}) > 1:
        t.warn("Proposals differ in area; $/SF/yr normalizes size but not the value of the space itself." if sf_unit
               else f"Proposals differ in size ({qty}); $/{per}/yr normalizes size but not the value of the space or "
               "capacity itself.")
    if not usable and all(u is not None for _, u in rows):
        row_u, best_u = sorted(rows, key=lambda x: key(x[1]))[0]
        if row_u["name"] != best:
            t.warn(f"Ranked on rentable SF; per usable SF the best is {row_u['name']} ({num_str(best_u)} $/USF/yr), "
                   f"not {best}. Set area_basis to usable if the tenant needs a fixed usable area.")
    with_opex = [p for p in proposals if p["operating_expenses"]]
    if tenant and not with_opex and all(p["additional_costs_psf_annual"] == 0 for p in proposals):
        t.warn("No operating_expenses or additional costs supplied; if any proposal is net (NNN, base year, expense stop), add its operating_expenses for a fair comparison.")
    if 0 < len(with_opex) < len(proposals):
        t.warn(f"No operating_expenses for {', '.join(p['name'] for p in proposals if not p['operating_expenses'])}: "
               "priced as if no operating expenses are paid beyond base rent" + (" and additional costs" if tenant else "") + ".")
    flat_base = [p["name"] for p in with_opex
                 if p["operating_expenses"]["type"] == "base_year" and p["operating_expenses"]["growth_rate_annual"] == 0]
    if flat_base:
        t.warn(f"Base-year proposal(s) {', '.join(flat_base)} have growth_rate_annual 0, so no expense increases over "
               "the base year are priced.")
    if tenant and any(p["downtime_months"] > 0 for p in proposals):
        t.warn("downtime_months applies to the landlord perspective only; ignored for the tenant.")
    terms = [p["schedule"]["term_months"] for p in proposals]
    if max(terms) - min(terms) >= 12:
        t.warn(f"Terms differ ({min(terms)} to {max(terms)} months); annualizing compares cost per year but does not "
               "price the re-leasing, renewal, or relocation risk after the shorter term ends.")
    starts = sorted({p["schedule"]["commencement_date"] for p in proposals})
    if len(starts) > 1:
        t.warn(f"Proposals commence on different dates ({', '.join(starts)}); each is valued as of its own commencement, "
               "so the ranking ignores the timing difference.")
    if len(ranking) > 1 and ranking[0]["metric_psf_annual"] == ranking[1]["metric_psf_annual"]:
        t.warn(f"Top proposals are tied at {num_str(ranking[0]['metric_psf_annual'])} $/{per}/yr.")
    unit_note = _unit_warning(unit)
    if unit_note:
        t.warn(unit_note)
    value: dict[str, Any] = {
        "perspective": perspective,
        "metric": "effective_occupancy_cost_psf" if tenant else "discounted_net_effective_rent_psf",
        "area_basis": area_basis,
        "ranking": ranking,
        "best": best,
    }
    if unit is not None:
        value["unit"] = unit
        value["rate_unit"] = rate_unit
    return t.result("calc.compare_proposals", 2, value)


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
    suffix = f" × {fmt_num(f)}" if f < 1 else ""
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
                       f"Σ (rent − free rent + expenses − tax savings)_t ÷ (1 + {fmt_num(disc)})^t, t = 0..{horizon}; "
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
               f"({fmt_money(basis)} × (1 − {fmt_num(tax['land_share'])})) ÷ {tax['depreciation_life_years']} years, straight-line",
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
           + (f" − {fmt_money(tax_on_sale)} tax on gain ({fmt_money(gain)} × {fmt_num(tax_rate)})" if tax else ""),
           "USD")
    own_nets_ex_sale = [y["net"] for y in own_years]
    last = own_years[horizon]
    last["sale_proceeds"] = proceeds
    last["net"] = round_(last["net"] - proceeds, 2)
    own_nets = [y["net"] for y in own_years]
    own_npv = t.step("Own NPV", round_(_npv_at(own_nets, disc), 2),
                     f"Σ (equity + debt service + expenses − tax savings − sale proceeds)_t ÷ (1 + {fmt_num(disc)})^t, "
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
    if loan and loan["amount"] > basis:
        t.warn("The loan exceeds the purchase price plus closing costs, so equity at closing is negative (cash out at year 0); check the loan amount.")

    return t.result("calc.lease_vs_own", 2, {
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
    # The case schedule has no unit (as CaseScheduleInput omits it in TypeScript).
    return _schedule_input({**{k: v for k, v in d.items() if k != "unit"}, "term_months": horizon,
                            "include_monthly": False}, path)


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
                     f"({fmt_money(c['pv'] + c['one_time'])} ÷ Σ(1+r)^−t) × 12 ÷ {fmt_num(area)} SF", "USD/sf/yr")
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
    if M["overlap_months"] > 0 and current_rent == 0:
        t.warn(f"relocate.overlap_months is {M['overlap_months']} but current_rent_monthly is 0 (or not given), so the double "
               "rent during the overlap counts as $0; pass the existing lease's total monthly rent.")
    if diff == 0:
        t.warn("The two cases are tied at these inputs.")
    if be_reloc is not None and be_reloc < 0:
        t.warn("Relocating costs more than renewing even at a $0/SF starting rent (its one-time costs alone exceed t"
               "he renewal's NPV); the negative break-even relocation rent is not achievable.")
    if be_renew is not None and be_renew < 0:
        t.warn("Renewing costs more than relocating even at a $0/SF starting rent (its one-time costs alone exceed t"
               "he relocation's NPV); the negative break-even renewal rent is not achievable.")

    return t.result("calc.renew_vs_relocate", 2, {
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

from .valuation import (  # noqa: E402  (valuation.py imports irr from this module lazily)
    amortization_schedule,
    dcf_pro_forma,
    direct_cap,
    equity_waterfall,
    exchange_1031,
)

#: name -> (function, formula id, formula version). Names match the MCP/TypeScript registry.
CALCULATORS: dict[str, tuple[Callable[[Any], Result], str, int]] = {
    "rent_schedule": (rent_schedule, "calc.rent_schedule", 1),
    "net_effective_rent": (net_effective_rent, "calc.net_effective_rent", 1),
    "compare_proposals": (compare_proposals, "calc.compare_proposals", 2),
    "multifamily_rent_roll": (multifamily_rent_roll, "calc.multifamily_rent_roll", 1),
    "percentage_rent": (percentage_rent, "calc.percentage_rent", 1),
    "cam_reconciliation": (cam_reconciliation, "calc.cam_reconciliation", 2),
    "cam_reconciliation_batch": (cam_reconciliation_batch, "calc.cam_reconciliation_batch", 1),
    "capex_recovery": (capex_recovery, "calc.capex_recovery", 1),
    "debt_sizing": (debt_sizing, "calc.debt_sizing", 3),
    "lease_remeasurement_asc842": (lease_remeasurement_asc842, "calc.lease_remeasurement_asc842", 2),
    "prepayment_and_defeasance": (prepayment_and_defeasance, "calc.prepayment_and_defeasance", 1),
    "walt": (walt, "calc.walt", 1),
    "npv": (npv, "calc.npv", 1),
    "irr": (irr, "calc.irr", 2),
    "lease_vs_own": (lease_vs_own, "calc.lease_vs_own", 2),
    "renew_vs_relocate": (renew_vs_relocate, "calc.renew_vs_relocate", 2),
    "hotel_metrics": (hotel_metrics, "calc.hotel_metrics", 1),
    "dcf_pro_forma": (dcf_pro_forma, "calc.dcf_pro_forma", 1),
    "direct_cap": (direct_cap, "calc.direct_cap", 1),
    "amortization_schedule": (amortization_schedule, "calc.amortization_schedule", 1),
    "equity_waterfall": (equity_waterfall, "calc.equity_waterfall", 1),
    "exchange_1031": (exchange_1031, "calc.exchange_1031", 2),
}
