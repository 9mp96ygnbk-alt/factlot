"""Independent reference for the valuation vectors (calc.dcf_pro_forma, calc.direct_cap,
calc.amortization_schedule, calc.equity_waterfall, calc.exchange_1031).

Written from the documented conventions, not from the FactLot code: exact decimal arithmetic
(Python ``decimal`` at 60 digits), rounding half up on the exact value, a month-by-month state walk
for the DCF, and a bisection IRR. It imports nothing from FactLot. ``build.py`` beside it runs these
functions on the vector inputs and writes the expected values into ``spec/vectors/calc/*.json``:

    python3 spec/vectors/calc/reference/build.py
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal as D, getcontext

getcontext().prec = 60
CENT = D("0.01")


def r2(x):
    return (x).quantize(CENT, rounding=ROUND_HALF_UP)


def rq(x, places):
    return x.quantize(D(1).scaleb(-places), rounding=ROUND_HALF_UP)


def num(x):
    """JSON number for a Decimal: int when whole, else float of the decimal string."""
    if isinstance(x, D):
        return int(x) if x == x.to_integral_value() else float(x)
    return x


def irr_annual(flows, ppy=1):
    """Bisection on NPV(r) for the periodic rate in (-0.99, 10), annualized as (1 + r)^ppy − 1."""
    flows = [D(str(f)) if not isinstance(f, D) else f for f in flows]

    def npv(r):
        return sum(cf / (1 + r) ** t for t, cf in enumerate(flows))
    lo, hi = D("-0.99"), D("10")
    # Scan for the sign change closest to zero, as calc.irr reports the root nearest 0%.
    grid = [D(i) / 100 for i in range(-99, 1001)]
    roots = []
    for a, b in zip(grid, grid[1:]):
        fa, fb = npv(a), npv(b)
        if fa == 0:
            roots.append(a)
            continue
        if (fa > 0) == (fb > 0):
            continue
        lo, hi = a, b
        for _ in range(120):
            mid = (lo + hi) / 2
            if (npv(mid) > 0) == (fa > 0):
                lo = mid
            else:
                hi = mid
        roots.append((lo + hi) / 2)
    r = min(roots, key=abs)
    return rq((1 + r) ** ppy - 1, 8)


def add_months(iso, months):
    d = date.fromisoformat(iso)
    y, m = divmod(d.year * 12 + d.month - 1 + months, 12)
    import calendar
    return date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1])).isoformat()


# --- amortization -----------------------------------------------------------------------------

def amortization(principal, rate, term, amort, io=0, freq="monthly", day_count="30/360", start=None):
    mpp = 3 if freq == "quarterly" else 1
    p = 12 // mpp
    n, n_io, n_am = term // mpp, io // mpp, amort // mpp
    P, R = D(str(principal)), D(str(rate))
    r = R / p
    io_all = n_am == 0 or n_io >= n
    pmt = None
    if not io_all:
        pmt = r2(P / n_am if r == 0 else P * r / (1 - (1 + r) ** -n_am))
    bal = r2(P)
    rows = []
    prev = start
    for k in range(1, n + 1):
        dt = add_months(start, k * mpp) if start else None
        if day_count == "30/360":
            interest = r2(bal * r)
        else:
            days = (date.fromisoformat(dt) - date.fromisoformat(prev)).days
            interest = r2(bal * R * days / (365 if day_count == "actual/365" else 360))
        io_row = io_all or k <= n_io
        sched = D(0) if io_row else pmt - interest
        prin = bal if k == n else sched
        balloon = bal - sched if k == n else None
        rows.append({"opening": bal, "interest": interest, "principal": prin, "payment": interest + prin,
                     "closing": bal - prin, "date": dt})
        bal = bal - prin
        prev = dt
    return {"payment": pmt, "rows": rows, "balloon": balloon,
            "total_interest": sum(x["interest"] for x in rows), "total_payments": sum(x["payment"] for x in rows)}


# --- direct cap --------------------------------------------------------------------------------

def direct_cap(noi, cap=None, price=None, reserve=0, lease_up=0, burn=0, others=(), area=None, round_to=None):
    noi, reserve, lease_up, burn = (D(str(x)) for x in (noi, reserve, lease_up, burn))
    income = noi - reserve
    ded = lease_up + burn - sum((D(str(a)) for a in others), D(0))
    out = {"income": income, "deductions": ded}
    if cap is not None:
        stab = r2(income / D(str(cap)))
        out["stabilized"] = stab
        out["as_is"] = stab - ded
        if round_to is not None:
            out["rounded"] = (out["as_is"] / D(round_to)).quantize(D(1), rounding=ROUND_HALF_UP) * D(round_to)
        if area is not None:
            out["per_sf"] = r2(out["as_is"] / D(str(area)))
    if price is not None:
        P = D(str(price))
        out["implied"] = rq(income / P, 6)
        out["implied_before"] = rq(noi / P, 6)
        out["implied_all_in"] = rq(income / (P + ded), 6)
    return out


# --- DCF ---------------------------------------------------------------------------------------

def abate(free, k):
    """Share of lease month k (0 = first) that is free rent: the whole months, then the fraction."""
    return min(D(1), max(D(0), D(free) - k))


def dcf(inp):
    H = inp["hold_years"]
    months = (H + 1) * 12
    dd = lambda k, default=0: D(str(inp.get(k, default)))  # noqa: E731
    g, ge = dd("market_rent_growth_rate"), dd("expense_growth_rate")
    opex0 = dd("operating_expenses_psf_annual")
    mk = {"renewal_rent_pct_of_market": 1, "rent_escalation_rate": 0, "free_rent_months_new": 0,
          "free_rent_months_renewal": 0, "ti_psf_new": 0, "ti_psf_renewal": 0, "lc_rate_new": 0, "lc_rate_renewal": 0,
          "recovery": "nnn", **inp["market_leasing"]}
    area = sum(D(str(l["area_sf"])) for l in inp["leases"])
    year = lambda m: (m - 1) // 12 + 1  # noqa: E731
    opex = lambda y: opex0 * (1 + ge) ** (y - 1)  # noqa: E731
    lines = {k: [D(0)] * (H + 2) for k in ("pbr", "free", "rec", "ti", "lc")}
    events = []
    for l in inp["leases"]:
        A = D(str(l["area_sf"]))
        a = {**mk, **l.get("leasing", {})}
        # state walk: occupancy record for the current lease, or the month the next one starts
        rem = l["months_remaining"]
        cur = None
        if rem > 0:
            cur = {"start": 1, "end": rem, "free": l.get("free_rent_months_remaining", 0), "rec": l.get("recovery", "nnn"),
                   "base": D(str(l.get("base_year_opex_psf_annual", 0))), "kind": "in_place"}
            esc, first, r0 = D(str(l.get("escalation_rate", 0))), l.get("next_escalation_month", 13), D(str(l["rent_psf_annual"]))
            cur["psf"] = lambda m, esc=esc, first=first, r0=r0: r0 * (1 + esc) ** ((m - first) // 12 + 1) if m >= first else r0
            events.append({"lease": l["name"], "kind": "in_place", "start": 1, "end": rem, "downtime": 0,
                           "free": cur["free"], "psf": r0, "ti": D(0), "lc": D(0)})
        next_start = None
        last_end = rem

        def sign_lease(prev_end):
            vacant = prev_end == 0
            p = D(0) if vacant else D(str(a["renewal_probability"]))
            # fractional blended downtime: floor(D) vacant months, then the first lease month at 1 - frac(D)
            down = rq((1 - p) * a["downtime_months"], 6)
            wd = int(down.to_integral_value(rounding=ROUND_FLOOR))
            share0 = 1 - (down - wd)
            s = prev_end + 1 + wd
            T = a["lease_term_months"]
            y0 = year(s)
            mrent = D(str(l["market_rent_psf_annual"])) * (1 + g) ** (y0 - 1)
            psf0 = mrent * (p * D(str(a["renewal_rent_pct_of_market"])) + 1 - p)
            e = D(str(a["rent_escalation_rate"]))
            fr = min(rq(p * a["free_rent_months_renewal"] + (1 - p) * a["free_rent_months_new"], 6), D(T))
            ti = (p * D(str(a["ti_psf_renewal"])) + (1 - p) * D(str(a["ti_psf_new"]))) * (1 + g) ** (y0 - 1) * A
            lcr = p * D(str(a["lc_rate_renewal"])) + (1 - p) * D(str(a["lc_rate_new"]))
            psf = lambda m, psf0=psf0, e=e, s=s: psf0 * (1 + e) ** ((m - s) // 12)  # noqa: E731
            lc = lcr * sum(A * psf(m) / 12 * (1 - abate(fr, m - s)) for m in range(s, s + T))
            ev = {"lease": l["name"], "kind": "new" if vacant else "blended", "start": s, "end": s + T - 1, "downtime": down, "free": fr,
                  "psf": psf0, "ti": ti, "lc": lc}
            return {"start": s, "end": s + T - 1, "free": fr, "rec": a["recovery"], "base": opex(y0), "psf": psf,
                    "kind": ev["kind"], "ti": ti, "lc": lc, "share0": share0}, ev

        if cur is None:
            nxt, ev = sign_lease(0)
            events.append(ev)  # listed even when it starts after the projection
            if nxt["start"] <= months:
                next_start = nxt
        for m in range(1, months + 1):
            if cur is None and next_start is not None and m == next_start["start"]:
                cur, next_start = next_start, None
                lines["ti"][year(m)] += cur["ti"]
                lines["lc"][year(m)] += cur["lc"]
            if cur is not None:
                y = year(m)
                share = cur.get("share0", D(1)) if m == cur["start"] else D(1)
                rent = A * cur["psf"](m) / 12 * share
                lines["pbr"][y] += rent
                lines["free"][y] -= rent * abate(cur["free"], m - cur["start"])
                if cur["rec"] == "nnn":
                    lines["rec"][y] += A * opex(y) / 12 * share
                elif cur["rec"] == "base_year":
                    lines["rec"][y] += A * max(D(0), opex(y) - cur["base"]) / 12 * share
                if m == cur["end"]:
                    last_end = cur["end"]
                    cur = None
                    if last_end < months:
                        nxt, ev = sign_lease(last_end)
                        events.append(ev)  # listed even when it starts after the projection
                        if nxt["start"] <= months:
                            next_start = nxt
    rows = []
    for y in range(1, H + 2):
        pbr, fr, rec = r2(lines["pbr"][y]), r2(lines["free"][y]), r2(lines["rec"][y])
        gross = pbr + fr + rec
        vac = r2(-dd("general_vacancy_rate") * gross)
        cl = r2(-dd("credit_loss_rate") * gross)
        egr = gross + vac + cl
        ox = r2(-(opex(y) * area + dd("non_recoverable_expenses_annual") * (1 + ge) ** (y - 1)))
        mg = r2(-dd("management_fee_rate") * egr)
        noi = egr + ox + mg
        ti, lc = r2(-lines["ti"][y]), r2(-lines["lc"][y])
        res = r2(-(dd("capital_reserve_psf_annual") * (1 + ge) ** (y - 1) * area))
        rows.append({"pbr": pbr, "free": fr, "rec": rec, "gross": gross, "vac": vac, "credit": cl, "egr": egr,
                     "opex": ox, "mgmt": mg, "noi": noi, "ti": ti, "lc": lc, "res": res, "cf": noi + ti + lc + res})
    exit_noi = rows[H]["noi"] if inp.get("exit_noi_basis", "forward") == "forward" else rows[H - 1]["noi"]
    gross_sale = r2(exit_noi / dd("exit_cap_rate"))
    sell = r2(dd("selling_cost_rate") * gross_sale)
    net = gross_sale - sell
    r = dd("discount_rate")
    mid = inp.get("timing", "end_of_year") == "mid_year"
    pv_cf = r2(sum(rows[y - 1]["cf"] / (1 + r) ** (D(y) - (D("0.5") if mid else 0)) for y in range(1, H + 1)))
    pv_rev = r2(net / (1 + r) ** H)
    value = pv_cf + pv_rev
    out = {"rows": rows, "exit_noi": exit_noi, "gross_sale": gross_sale, "sell": sell, "net_sale": net,
           "pv_cf": pv_cf, "pv_rev": pv_rev, "value": value, "events": events, "area": area}
    if "purchase_price" in inp:
        price = dd("purchase_price")
        flows = [-price] + [rows[y - 1]["cf"] + (net if y == H else 0) for y in range(1, H + 1)]
        out["npv"] = value - price
        out["irr"] = irr_annual(flows)
        out["multiple"] = rq(sum(flows[1:]) / price, 4)
        out["going_in_price"] = rq(rows[0]["noi"] / price, 6)
    return out


# --- waterfall ---------------------------------------------------------------------------------

def waterfall(flows, lp_share, ppy=1, pref=None, compounding="compound", order="pref_then_capital",
              catch_up=None, tiers=(), residual=0):
    s = D(str(lp_share))
    eff = lambda rate: D(str(rate)) if ppy == 1 else (1 + D(str(rate))) ** (D(1) / ppy) - 1  # noqa: E731
    pr = D(str(pref)) if pref is not None else None
    hurdle = [eff(h) for h, _ in tiers]
    C = A = PROM = PROF = D(0)
    B = [D(0)] * len(tiers)
    out = []
    for k, cf in enumerate(D(str(f)) for f in flows):
        if k:
            if pr is not None:
                A += (C + A) * eff(pref) if compounding == "compound" else C * pr / ppy
            B = [b * (1 + h) for b, h in zip(B, hurdle)]
        row = {"lp_c": D(0), "gp_c": D(0), "lp_d": D(0), "promote": D(0), "parts": [D(0)] * (len(tiers) + 4)}
        if cf < 0:
            C += -cf
            row["lp_c"] = r2(-cf * s)
            row["gp_c"] = -cf - row["lp_c"]
            B = [b + (-cf) * s for b in B]
        left = cf if cf > 0 else D(0)

        def lp(amount):
            row["lp_d"] += amount
            for i in range(len(B)):
                B[i] -= amount

        steps = ["pref", "capital"] if order == "pref_then_capital" else ["capital", "pref"]
        for st in steps:
            if left <= 0:
                break
            if st == "pref" and pr is not None:
                x = min(left, A)
                A -= x
                PROF += x
                row["parts"][0] = x
                lp(x * s)
                left -= x
            elif st == "capital":
                x = min(left, C)
                C -= x
                row["parts"][1] = x
                lp(x * s)
                left -= x
        if catch_up and left > 0:
            gs, tgt = D(str(catch_up[0])), D(str(catch_up[1]))
            x = max(D(0), min(left, (tgt * PROF - PROM) / (gs - tgt)))
            if x > 0:
                row["promote"] += gs * x
                PROM += gs * x
                PROF += x
                row["parts"][2] = x
                lp((1 - gs) * x * s)
                left -= x
        for i, (_, promote) in enumerate(tiers):
            pm = D(str(promote))
            if left <= 0 or B[i] <= 0:
                continue
            x = min(left, B[i] / ((1 - pm) * s))
            row["promote"] += pm * x
            PROM += pm * x
            PROF += x
            row["parts"][3 + i] = x
            lp(x * (1 - pm) * s)
            left -= x
        if left > 0:
            rp = D(str(residual))
            row["promote"] += rp * left
            PROM += rp * left
            PROF += left
            row["parts"][-1] = left
            lp((1 - rp) * left * s)
        if cf > 0:
            row["lp_dist"] = r2(row["lp_d"])
            row["gp_dist"] = cf - row["lp_dist"]
            row["gp_promote"] = r2(row["promote"])
        else:
            row["lp_dist"] = row["gp_dist"] = row["gp_promote"] = D(0)
        row["parts"] = [r2(x) for x in row["parts"]]
        out.append(row)
    lp_net = [r["lp_dist"] - r["lp_c"] for r in out]
    gp_net = [r["gp_dist"] - r["gp_c"] for r in out]
    tot = lambda key: sum(r[key] for r in out)  # noqa: E731
    res = {"rows": out, "lp_contrib": tot("lp_c"), "gp_contrib": tot("gp_c"), "lp_dist": tot("lp_dist"),
           "gp_dist": tot("gp_dist"), "promote": tot("gp_promote"), "lp_irr": irr_annual(lp_net, ppy),
           "unreturned": r2(C), "unpaid_pref": r2(A)}
    res["gp_irr"] = irr_annual(gp_net, ppy) if res["gp_contrib"] > 0 else None
    res["lp_multiple"] = rq(res["lp_dist"] / res["lp_contrib"], 4)
    res["project_irr"] = irr_annual(flows, ppy)
    return res


# --- 1031 --------------------------------------------------------------------------------------

def exchange(transfer, due=None, sale=0, costs=0, debt=0, basis=None, cash_out=0, price=None, acq=0, new_debt=0,
             props=()):
    t = date.fromisoformat(transfer)
    id_dl = (t + timedelta(days=45)).isoformat()
    d180 = (t + timedelta(days=180)).isoformat()
    ex_dl = min(d180, due) if due else d180
    out = {"id": id_dl, "ex": ex_dl, "basis": "tax_return_due_date" if due and due < d180 else "180_days"}
    S = D(str(sale))
    if props:
        total = sum(D(str(v)) for v, _ in props)
        received = sum(D(str(v)) for v, r in props if r)
        out["three"] = len(props) <= 3
        out["two_hundred"] = total <= 2 * S
        out["ninety_five"] = received >= D("0.95") * total
        out["ratio"] = rq(total / S, 4)
    if price is not None:
        realized = S - D(str(costs))
        equity = realized - D(str(debt))
        qi = max(D(0), equity - D(str(cash_out)))
        need = D(str(price)) + D(str(acq)) - D(str(new_debt))
        added = max(D(0), need - qi)
        cash_boot = D(str(cash_out)) + max(D(0), qi - max(D(0), need))
        mortgage_boot = max(D(0), D(str(debt)) - D(str(new_debt)) - added)
        out.update(realized=realized, equity=equity, qi=qi, need=need, added=added, cash_boot=cash_boot,
                   mortgage_boot=mortgage_boot, total_boot=cash_boot + mortgage_boot,
                   trade_down=max(D(0), realized - D(str(price))))
        if basis is not None:
            gain = realized - D(str(basis))
            out["gain"] = gain
            out["limited"] = max(D(0), min(gain, out["total_boot"]))
    return out
