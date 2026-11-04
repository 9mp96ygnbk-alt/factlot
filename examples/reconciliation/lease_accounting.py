"""Lease accounting: ASC 842 lessee remeasurement (calc_lease_remeasurement_asc842), two scenarios."""

from __future__ import annotations

from common import Recon, readme_sheet, run
from xlsx_lite import Workbook, col_letter

FILENAME = "lease-accounting-asc842-remeasurement.xlsx"

CONVENTIONS = [
    "Periodic rate r = annual rate / periods per year (nominal). Payments are taken to the cent. The new lease liability is the sum of "
    "payment_k / (1 + r)^k for payments in arrears, or / (1 + r)^(k - 1) for payments in advance, rounded to cents (ASC 842-10-35-4, 842-20-35-3).",
    "Liability adjustment = new liability - carrying amount. ROU asset adjustment = the liability adjustment, but not lower than minus the ROU "
    "asset carrying amount (ASC 842-20-35-4); the part that cannot be absorbed is a gain recognized in profit or loss.",
    "Operating lease: total lease cost = remaining payments + new ROU asset - new liability; the straight-line cost per period = ROUND(total / n, 2); "
    "the last period takes what is left. ROU amortization = straight-line cost - interest. Finance lease: ROU amortization = ROUND(new ROU / n, 2) per "
    "period (the last takes what is left), lease cost = interest + amortization.",
    "Interest each period = ROUND(opening liability x r, 2) (arrears) or ROUND((opening - payment) x r, 2) (advance). Every row rolls forward in whole "
    "cents: closing = opening - payment + interest. The final period's interest is the amount that closes the liability at exactly 0.00 "
    "(the 'final-period true-up' of a few cents is part of the schedule).",
    "FactLot does not decide whether an event is a modification, a reassessment or a separate contract, whether the discount rate must be updated, "
    "or whether a lease is operating or finance: you supply those inputs. It computes the numbers they imply.",
]

# SYNTHETIC. Payments are listed per period; periods not listed are rent-free.
SC = [
    dict(sheet="ASC_1", title="Scenario 1: operating lease, term extended, payments in arrears, rate updated at the remeasurement date",
         classification="operating", event="modification_extend_term", timing="end", rate=0.0625, ppy=12, updated=True,
         liability_before=1_310_000.00, rou_before=1_245_000.00,
         payments=[(k, 41250.00) for k in range(1, 13)] + [(k, 42487.50) for k in range(13, 25)] + [(k, 43762.13) for k in range(25, 37)],
         remaining=None),
    dict(sheet="ASC_2", title="Scenario 2: finance lease, payments cut, in advance, last 2 periods rent-free, liability falls by more than the ROU asset",
         classification="finance", event="modification_change_in_payments", timing="begin", rate=0.055, ppy=12, updated=True,
         liability_before=1_150_000.00, rou_before=200_000.00,
         payments=[(k, 38000.00) for k in range(1, 23)], remaining=24),
]
COLS = ["period", "opening_liability", "payment", "interest", "closing_liability", "amortization", "closing_rou_asset", "lease_cost"]


def fl_args(s: dict) -> dict:
    a = {
        "classification": s["classification"], "event": s["event"], "payment_timing": s["timing"],
        "discount_rate_annual": s["rate"], "periods_per_year": s["ppy"], "discount_rate_updated": s["updated"],
        "liability_before": s["liability_before"], "rou_asset_before": s["rou_before"],
        "payments": [{"period": k, "amount": v} for k, v in s["payments"]],
    }
    if s["remaining"]:
        a["remaining_periods"] = s["remaining"]
    return a


def asc_sheet(wb: Workbook, s: dict, fl: dict) -> dict:
    sh = wb.sheet(s["sheet"])
    sh.width(1, 52)
    sh.width(2, 20)
    sh.width(3, 4)
    for c in range(4, 40):
        sh.width(c, 15)
    sh.put(1, 1, s["title"], "title")
    sh.put(2, 1, "SYNTHETIC. Blue on yellow = inputs (payments are in the table); everything else is a live formula.", "warn")
    R: dict[str, str] = {}
    row = [4]

    def put(key, label, v, style):
        r = row[0]
        sh.put(r, 1, label, "text")
        R[key] = sh.put(r, 2, v, style)
        row[0] += 1

    n = fl["value"]["remaining_periods"]
    op = s["classification"] == "operating"
    adv = s["timing"] == "begin"
    put("rate", "Discount rate, annual", s["rate"], "in_pct")
    put("ppy", "Periods per year", s["ppy"], "in_int")
    put("lbefore", "Lease liability before (USD)", s["liability_before"], "in_money")
    put("rbefore", "ROU asset before (USD)", s["rou_before"], "in_money")
    put("n", "Remaining periods (structural: the table has n rows)", n, "in_int")
    put("r", "Periodic rate r", f"={R['rate']}/{R['ppy']}", "num8")

    # schedule table, rows from T0
    t0 = 20
    heads = ["Period", "Payment", "Discount factor", "Opening liability", "Accrued interest", "Interest", "Closing liability",
             "Lease cost", "ROU amortization", "Closing ROU asset", "Cum. interest", "Cum. amortization", "Cum. lease cost"]
    for c, h in enumerate(heads, 4):
        sh.put(t0 - 1, c, h, "header")
    pay = dict(s["payments"])
    t1 = t0 + n - 1
    # column letters: D period, E payment, F df, G opening, H accrued, I interest, J closing, K cost, L amort, M rou, N cumI, O cumA, P cumC
    for k in range(1, n + 1):
        r = t0 + k - 1
        sh.put(r, 4, k, "int")
        sh.put(r, 5, pay.get(k, 0.0), "in_money")
        sh.put(r, 6, f"=(1+{R['r']})^(-(D{r}-{1 if adv else 0}))" if adv else f"=(1+{R['r']})^(-D{r})", "num8")
    # summary needs ranges
    E_, F_ = f"E{t0}:E{t1}", f"F{t0}:F{t1}"
    put("total", "Remaining lease payments", f"=ROUND(SUM({E_}),2)", "money")
    put("newl", "New lease liability", f"=ROUND(SUMPRODUCT({E_},{F_}),2)", "money")
    put("ladj", "Liability adjustment", f"=ROUND({R['newl']}-{R['lbefore']},2)", "money")
    put("radj", "ROU asset adjustment", f"=ROUND(MAX({R['ladj']},-{R['rbefore']}),2)", "money")
    put("gain", "Gain recognized", f"=ROUND({R['radj']}-{R['ladj']},2)", "money")
    put("newr", "New ROU asset", f"=ROUND({R['rbefore']}+{R['radj']},2)", "money")
    put("tcost", "Total lease cost (remaining payments + new ROU - new liability)", f"=ROUND({R['total']}+{R['newr']}-{R['newl']},2)", "money")
    if op:
        put("slc", "Straight-line lease cost per period", f"=ROUND({R['tcost']}/{R['n']},2)", "money")
    else:
        put("amper", "ROU amortization per period", f"=ROUND({R['newr']}/{R['n']},2)", "money")
    for k in range(1, n + 1):
        r = t0 + k - 1
        last = k == n
        sh.put(r, 7, f"={R['newl']}" if k == 1 else f"=J{r - 1}", "money")
        sh.put(r, 8, f"=ROUND(({'G' + str(r) + '-E' + str(r) if adv else 'G' + str(r)})*{R['r']},2)", "money")
        sh.put(r, 9, f"=ROUND(E{r}-G{r},2)" if last else f"=H{r}", "money")
        sh.put(r, 10, f"=ROUND(G{r}-E{r}+I{r},2)", "money")
        prevC = f"P{r - 1}" if k > 1 else "0"
        prevA = f"O{r - 1}" if k > 1 else "0"
        prevI = f"N{r - 1}" if k > 1 else "0"
        prevR = f"M{r - 1}" if k > 1 else R["newr"]
        if op:
            sh.put(r, 11, f"=ROUND({R['tcost']}-{prevC},2)" if last else f"={R['slc']}", "money")
            sh.put(r, 12, f"=ROUND(K{r}-I{r},2)", "money")
        else:
            sh.put(r, 12, f"=ROUND({R['newr']}-{prevA},2)" if last else f"={R['amper']}", "money")
            sh.put(r, 11, f"=ROUND(I{r}+L{r},2)", "money")
        sh.put(r, 13, f"=ROUND({prevR}-L{r},2)", "money")
        sh.put(r, 14, f"=ROUND({prevI}+I{r},2)", "money")
        sh.put(r, 15, f"=ROUND({prevA}+L{r},2)", "money")
        sh.put(r, 16, f"=ROUND({prevC}+K{r},2)", "money")
    put("tint", "Total interest", f"=N{t1}", "money")
    put("tamort", "Total amortization", f"=O{t1}", "money")
    put("tcost2", "Total lease cost (sum of rows)", f"=P{t1}", "money")
    put("trueup", "Final-period interest true-up", f"=ROUND(I{t1}-ROUND(({'G' + str(t1) + '-E' + str(t1) if adv else 'G' + str(t1)})*{R['r']},2),2)", "money")

    # FactLot's schedule, recorded, side by side with per-cell differences
    sched = fl["value"]["schedule"]
    c0 = 18  # column R
    sh.put(t0 - 2, c0, "FactLot schedule (recorded)", "bold")
    sh.put(t0 - 2, c0 + 8, "Difference (Excel - FactLot)", "bold")
    for i, nm in enumerate(COLS):
        sh.put(t0 - 1, c0 + i, nm, "header")
        sh.put(t0 - 1, c0 + 8 + i, nm, "header")
    sh.put(t0 - 1, c0 + 16, "Row matches", "header")
    # Excel column for each COL: period D, opening G, payment E, interest I, closing J, amort L, rou M, cost K
    xl = {"period": "D", "opening_liability": "G", "payment": "E", "interest": "I", "closing_liability": "J",
          "amortization": "L", "closing_rou_asset": "M", "lease_cost": "K"}
    styles = {"period": "fl_int"}
    for k, rowd in enumerate(sched):
        r = t0 + k
        for i, nm in enumerate(COLS):
            sh.put(r, c0 + i, rowd[nm], styles.get(nm, "fl_money"))
            a = f"{xl[nm]}{r}"
            sh.put(r, c0 + 8 + i, f"=ROUND({a}-{col_letter(c0 + i)}{r},8)", "money")
        dc = [col_letter(c0 + 8 + i) + str(r) for i in range(8)]
        sh.put(r, c0 + 16, "=IF(AND(" + ",".join(f"{d}=0" for d in dc) + "),1,0)", "int")
    R["match_sum"] = f"{s['sheet']}!${col_letter(c0 + 16)}${t0}:${col_letter(c0 + 16)}${t1}"
    R["cells"] = n * len(COLS)
    sh.freeze = None
    return R


def build() -> tuple[Workbook, Recon]:
    fls = [run("calc_lease_remeasurement_asc842", fl_args(s)) for s in SC]
    wb = Workbook("FactLot reconciliation: ASC 842 lease remeasurement (synthetic)")
    readme_sheet(
        wb,
        "Lease accounting: ASC 842 lessee remeasurement",
        [
            "Two synthetic lessee remeasurements go through calc_lease_remeasurement_asc842: an operating lease whose term is extended "
            "(36 remaining months, payments in arrears) and a finance lease whose payments are cut (24 remaining months, payments in "
            "advance, the last two rent-free) so the liability falls by more than the ROU asset and a gain is recognized.",
            "Each scenario sheet rebuilds the new liability, the adjustments, the ROU asset and the full amortization table with live Excel "
            "formulas. FactLot's own schedule is pasted beside it, cell by cell, with a difference for every cell of every row.",
        ],
        [("calc_lease_remeasurement_asc842", fls[0])],
        CONVENTIONS,
        ["This reconciles arithmetic, not accounting judgement. Have the accounting conclusions (classification, event, rate) reviewed by the "
         "person responsible for your financial statements."],
    )
    rec = Recon(wb)
    for s, fl in zip(SC, fls):
        R = asc_sheet(wb, s, fl)
        v = fl["value"]
        rec.section(f"calc_lease_remeasurement_asc842: {s['title']}")
        rec.add("Periodic rate", "rate", f"=ROUND({R['r']},8)", v["periodic_rate"], "periodic_rate", "num8")
        rec.add("Total remaining payments", "USD", f"={R['total']}", v["total_remaining_payments"], "total_remaining_payments")
        rec.add("New lease liability", "USD", f"={R['newl']}", v["new_lease_liability"], "new_lease_liability")
        rec.add("Liability adjustment", "USD", f"={R['ladj']}", v["liability_adjustment"], "liability_adjustment")
        rec.add("ROU asset adjustment", "USD", f"={R['radj']}", v["rou_asset_adjustment"], "rou_asset_adjustment")
        rec.add("Gain recognized", "USD", f"={R['gain']}", v["gain_recognized"], "gain_recognized")
        rec.add("New ROU asset", "USD", f"={R['newr']}", v["new_rou_asset"], "new_rou_asset")
        if s["classification"] == "operating":
            rec.add("Straight-line lease cost per period", "USD", f"={R['slc']}", v["straight_line_lease_cost"], "straight_line_lease_cost")
        else:
            rec.add("ROU amortization per period", "USD", f"={R['amper']}", v["periodic_amortization"], "periodic_amortization")
        rec.add("Total interest", "USD", f"={R['tint']}", v["total_interest"], "total_interest")
        rec.add("Total amortization", "USD", f"={R['tamort']}", v["total_amortization"], "total_amortization")
        rec.add("Total lease cost", "USD", f"={R['tcost2']}", v["total_lease_cost"], "total_lease_cost")
        rec.add("Schedule cells that agree (of rows x 8 columns)", "cells", f"=SUM({R['match_sum']})*8", R["cells"], "schedule[] (every row, every column)", "int", 0,
                "Each row's 8 fields must all agree.")
        rec.add("Closing liability, last period", "USD", f"={s['sheet']}!$J${20 + v['remaining_periods'] - 1}", v["schedule"][-1]["closing_liability"],
                "schedule[-1].closing_liability")
        rec.add("Closing ROU asset, last period", "USD", f"={s['sheet']}!$M${20 + v['remaining_periods'] - 1}", v["schedule"][-1]["closing_rou_asset"],
                "schedule[-1].closing_rou_asset")
    rec.finish()
    return wb, rec
