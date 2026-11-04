"""Retail: CAM reconciliation (three lease structures) and percentage rent."""

from __future__ import annotations

from common import Recon, readme_sheet, run
from xlsx_lite import Workbook, addr, excel_serial

FILENAME = "retail-cam-and-percentage-rent.xlsx"

CONVENTIONS = [
    "Every tenant share, fee, cap limit and deduction is rounded to the cent (half away from zero) before it is combined; "
    "building-level amounts are summed unrounded and rounded once.",
    "Order of operations: recoverable lines only; gross-up of variable lines when actual occupancy is below the target "
    "(factor = target / actual); tenant share = line total x pro rata share x occupancy fraction; cap on the controllable "
    "share; admin fee on the fee-eligible share; base-year or expense-stop deduction last; floor at zero.",
    "Cap methods (named for what they compute): compounding_from_base = reference x (1 + rate)^years; simple_from_base = "
    "reference x (1 + rate x years); year_over_year = reference x (1 + rate), with no carry-forward.",
    "Partial-year occupancy: fraction = occupied days / days in the period, both ends inclusive, actual days. The tenant's "
    "share, the cap limit and the base-year or stop deduction are all scaled by that fraction.",
    "Percentage rent: net sales = max(0, gross - exclusions); natural breakpoint = annual base rent / rate x period fraction; "
    "percentage rent = max(0, net - breakpoint) x rate; balance due = percentage rent - already paid.",
    "Which lease clauses exist (cap, admin fee and when it applies, gross-up, base year or stop) is fixed per scenario sheet; "
    "the numbers, rates, dates and the cap method are live inputs.",
]

# SYNTHETIC lines: (category, amount, controllable, recoverable, variable, admin_fee_applies)
LINES = [
    ("Janitorial", 410000, 1, 1, 1, 1),
    ("Utilities", 275000, 1, 1, 1, 0),
    ("Landscaping and snow", 96000, 1, 1, 0, 1),
    ("Security", 140000, 1, 1, 1, 1),
    ("Property management", 180000, 1, 1, 1, 0),
    ("Real estate taxes", 520000, 0, 1, 0, 1),
    ("Insurance", 145000, 0, 1, 0, 1),
    ("Roof replacement (capital)", 220000, 0, 0, 0, 0),
]

SCENARIOS = [
    dict(sheet="CAM_1", title="Scenario 1: full year, net lease, gross-up, compounding cap, 15% fee after the cap (outside it)",
         share=0.08, lines=LINES, gross_up=(0.82, 0.95), structure=("net", 0), cap=("compounding_from_base", 0.05, 61000, 3),
         fee=(0.15, "after_cap", False), occupancy=None, estimates=145000, year=2026),
    dict(sheet="CAM_2", title="Scenario 2: part year (moved in 15 Sep), base year, simple cap, 10% fee before the cap and counted in it",
         share=0.08, lines=LINES, gross_up=(0.88, 1.0), structure=("base_year", 1350000), cap=("simple_from_base", 0.04, 60000, 2),
         fee=(0.10, "before_cap", True), occupancy=("2026-09-15", "2027-06-30", "2026-07-01", "2027-06-30"), estimates=15000, year=2026),
    dict(sheet="CAM_3", title="Scenario 3: full year, expense stop, year-over-year cap, 8% fee after the cap and counted in it",
         share=0.065, lines=LINES, gross_up=None, structure=("expense_stop", 1500000), cap=("year_over_year", 0.03, 52000, None),
         fee=(0.08, "after_cap", True), occupancy=None, estimates=4000, year=2026),
]

PCT_SCENARIOS = [
    dict(name="Pct 1: natural breakpoint, full year", gross=4825000, excl=118000, rate=0.05, base=180000, bp=("natural", 0), frac=1.0, paid=20000),
    dict(name="Pct 2: fixed breakpoint, half year", gross=2100000, excl=35000, rate=0.06, base=150000, bp=("fixed", 3000000), frac=0.5, paid=0),
]


def fl_cam(s: dict) -> dict:
    a = {
        "year": s["year"],
        "pro_rata_share": s["share"],
        "expenses": [
            {"category": c, "amount": amt, "controllable": bool(ct), "recoverable": bool(rc), "variable": bool(v), "admin_fee_applies": bool(af)}
            for c, amt, ct, rc, v, af in s["lines"]
        ],
        "estimates_paid": s["estimates"],
    }
    if s["gross_up"]:
        a["gross_up"] = {"actual_occupancy": s["gross_up"][0], "target_occupancy": s["gross_up"][1]}
    t, amt = s["structure"]
    a["structure"] = {"type": t} if t == "net" else (
        {"type": "base_year", "base_year_expenses": amt} if t == "base_year" else {"type": "expense_stop", "stop_amount": amt})
    if s["cap"]:
        m, rate, ref, yrs = s["cap"]
        a["cap"] = {"method": m, "rate": rate, "reference_amount": ref}
        if yrs is not None:
            a["cap"]["years_elapsed"] = yrs
    if s["fee"]:
        r, ap, cp = s["fee"]
        a["admin_fee"] = {"rate": r, "applied": ap, "capped": cp}
    if s["occupancy"]:
        mi, mo, ps, pe = s["occupancy"]
        a["occupancy"] = {"move_in_date": mi, "move_out_date": mo, "period_start_date": ps, "period_end_date": pe}
    return a


def cam_sheet(wb: Workbook, s: dict) -> dict:
    sh = wb.sheet(s["sheet"])
    sh.width(1, 46)
    sh.width(2, 20)
    sh.width(3, 56)
    sh.width(4, 3)
    for c, w in zip(range(5, 16), (26, 15, 13, 13, 11, 13, 15, 15, 15, 15, 15)):
        sh.width(c, w)
    sh.put(1, 1, s["title"], "title")
    sh.put(2, 1, "SYNTHETIC. Blue on yellow = inputs. Everything else is a live formula.", "warn")
    row = [4]
    R: dict[str, str] = {}

    def put(key, label, v, style, note=""):
        r = row[0]
        sh.put(r, 1, label, "text")
        R[key] = sh.put(r, 2, v, style)
        if note:
            sh.put(r, 3, note, "note")
        row[0] += 1

    def sec(label):
        row[0] += 1
        sh.put(row[0], 1, label, "bold")
        row[0] += 1

    sec("Inputs")
    put("share", "Pro rata share", s["share"], "in_pct")
    put("estimates", "Estimated payments made (USD, whole period)", s["estimates"], "in_money")
    if s["gross_up"]:
        put("actual", "Actual average occupancy", s["gross_up"][0], "in_pct")
        put("target", "Gross-up target occupancy", s["gross_up"][1], "in_pct")
    if s["structure"][0] != "net":
        put("deduct_amt", "Base-year expenses (building, USD)" if s["structure"][0] == "base_year" else "Expense stop (building, USD)", s["structure"][1], "in_money")
    if s["cap"]:
        put("cap_method", "Cap method", s["cap"][0], "in_text", "compounding_from_base | simple_from_base | year_over_year")
        put("cap_rate", "Cap rate", s["cap"][1], "in_pct")
        put("cap_ref", "Cap reference amount (tenant's share, reference year)", s["cap"][2], "in_money")
        put("cap_years", "Years elapsed since the base year", s["cap"][3] if s["cap"][3] is not None else 1, "in_int", "Ignored by year_over_year (FactLot uses 1)." if s["cap"][3] is None else "")
    if s["fee"]:
        put("fee_rate", "Admin fee rate", s["fee"][0], "in_pct")
    if s["occupancy"]:
        mi, mo, ps, pe = s["occupancy"]
        put("move_in", "Tenant's first day in the period", excel_serial(mi), "in_date")
        put("move_out", "Tenant's last day in the period", excel_serial(mo), "in_date")
        put("p_start", "Period start", excel_serial(ps), "in_date")
        put("p_end", "Period end", excel_serial(pe), "in_date")

    # expense table at E4
    th = ("Category", "Amount (USD)", "Controllable", "Recoverable", "Variable", "Admin fee applies", "Adjusted (grossed up)",
          "Controllable adj.", "Uncontrollable adj.", "Ctrl. fee-eligible", "Unctrl. fee-eligible")
    for c, h in enumerate(th, 5):
        sh.put(4, c, h, "header")
    t0 = 5
    for k, (cat, amt, ct, rc, v, af) in enumerate(s["lines"]):
        r = t0 + k
        sh.put(r, 5, cat, "in_text")
        sh.put(r, 6, amt, "in_money")
        for c, val in zip((7, 8, 9, 10), (ct, rc, v, af)):
            sh.put(r, c, val, "in_int")
        sh.put(r, 11, f"=IF(H{r}=1,IF(I{r}=1,F{r}*$B${{factor}},F{r}),0)", "money")  # factor patched below
        sh.put(r, 12, f"=K{r}*G{r}", "money")
        sh.put(r, 13, f"=K{r}*(1-G{r})", "money")
        sh.put(r, 14, f"=L{r}*J{r}", "money")
        sh.put(r, 15, f"=M{r}*J{r}", "money")
    t1 = t0 + len(s["lines"]) - 1
    rg = lambda col: f"{col}{t0}:{col}{t1}"  # noqa: E731

    sec("Calculation")
    if s["occupancy"]:
        put("frac", "Occupancy fraction (occupied days / period days)", f"=({R['move_out']}-{R['move_in']}+1)/({R['p_end']}-{R['p_start']}+1)", "num8", "Inclusive days; unrounded in later steps.")
    else:
        put("frac", "Occupancy fraction", "=1", "num8", "Full year.")
    if s["gross_up"]:
        put("factor", "Gross-up factor (variable lines)", f"=IF({R['actual']}<{R['target']},{R['target']}/{R['actual']},1)", "num8")
    else:
        put("factor", "Gross-up factor (variable lines)", "=1", "num8", "No gross-up clause.")
    # patch the factor reference in the table formulas
    fr = int(R["factor"].split("$")[-1])
    for k in range(len(s["lines"])):
        r = t0 + k
        sh.cells[(r, 11)].formula = f"IF(H{r}=1,IF(I{r}=1,F{r}*$B${fr},F{r}),0)"

    put("recoverable", "Recoverable expenses", f"=ROUND(SUMPRODUCT({rg('F')},{rg('H')}),2)", "money")
    put("grossed", "Recoverable expenses after gross-up", f"=ROUND(SUM({rg('K')}),2)", "money")
    put("ctrl", "Tenant share of controllable", f"=ROUND(SUM({rg('L')})*{R['share']}*{R['frac']},2)", "money")
    put("unctrl", "Tenant share of uncontrollable", f"=ROUND(SUM({rg('M')})*{R['share']}*{R['frac']},2)", "money")
    fee = s["fee"]
    if fee:
        put("ctrl_fee_base", "Fee-eligible controllable share", f"=ROUND(SUM({rg('N')})*{R['share']}*{R['frac']},2)", "money")
        put("unctrl_fee_base", "Fee-eligible uncontrollable share", f"=ROUND(SUM({rg('O')})*{R['share']}*{R['frac']},2)", "money")
        put("fee_unctrl", "Admin fee on uncontrollable (never capped)", f"=ROUND({R['fee_rate']}*{R['unctrl_fee_base']},2)", "money")
    fee_in_cap = False
    if s["cap"]:
        raw = (f'IF({R["cap_method"]}="compounding_from_base",{R["cap_ref"]}*(1+{R["cap_rate"]})^{R["cap_years"]},'
               f'IF({R["cap_method"]}="simple_from_base",{R["cap_ref"]}*(1+{R["cap_rate"]}*{R["cap_years"]}),{R["cap_ref"]}*(1+{R["cap_rate"]})))')
        put("cap_full", "Cap limit (full year)", f"=ROUND({raw},2)", "money")
        if s["occupancy"]:
            put("cap_limit", "Cap limit prorated for occupancy", f"=ROUND({R['cap_full']}*{R['frac']},2)", "money")
        else:
            R["cap_limit"] = R["cap_full"]
        if fee and fee[1] == "before_cap":
            put("fee_ctrl", "Admin fee on controllable (before cap)", f"=ROUND({R['fee_rate']}*{R['ctrl_fee_base']},2)", "money")
            fee_in_cap = fee[2]
            inner = f"ROUND({R['ctrl']}+{R['fee_ctrl']},2)" if fee_in_cap else R["ctrl"]
            put("capped", "Controllable after cap", f"=MIN({inner},{R['cap_limit']})", "money")
        else:
            put("capped", "Controllable after cap", f"=MIN({R['ctrl']},{R['cap_limit']})", "money")
            if fee:
                put("fee_ctrl", "Admin fee on controllable (after cap)",
                    f"=ROUND({R['fee_rate']}*IF({R['ctrl']}>0,{R['capped']}*{R['ctrl_fee_base']}/{R['ctrl']},0),2)", "money",
                    "The cap reduction is spread over controllable lines in proportion to their amounts.")
                fee_in_cap = fee[2]
                if fee_in_cap:
                    put("capped2", "Controllable with fee, capped", f"=MIN(ROUND({R['capped']}+{R['fee_ctrl']},2),{R['cap_limit']})", "money")
                    R["capped"] = R["capped2"]
    else:
        R["capped"] = R["ctrl"]
        if fee:
            put("fee_ctrl", "Admin fee on controllable (no cap)", f"=ROUND({R['fee_rate']}*{R['ctrl_fee_base']},2)", "money")
    inner = f"ROUND({R['ctrl']}+{R['fee_ctrl']},2)" if fee_in_cap else R["ctrl"]
    put("cap_red", "Cap reduction", f"=ROUND({inner}-{R['capped']},2)", "money")
    if fee:
        put("admin_fee", "Admin fee", f"=ROUND({R['fee_ctrl']}+{R['fee_unctrl']},2)", "money")
        fee_outside = "0" if fee_in_cap else R["fee_ctrl"]
        fee_unctrl = R["fee_unctrl"]
    else:
        fee_outside, fee_unctrl = "0", "0"
    if s["structure"][0] != "net":
        put("deduction", "Base-year / expense-stop deduction", f"=ROUND({R['deduct_amt']}*{R['share']}*{R['frac']},2)", "money")
        ded = R["deduction"]
    else:
        ded = "0"
    put("charge", "Tenant CAM charge", f"=ROUND(MAX(0,{R['capped']}+{fee_outside}+{R['unctrl']}+{fee_unctrl}-{ded}),2)", "money")
    put("balance", "Balance due (positive = tenant owes)", f"=ROUND({R['charge']}-{R['estimates']},2)", "money")
    R["_ded"] = ded
    return R


def build() -> tuple[Workbook, Recon]:
    cams = [run("calc_cam_reconciliation", fl_cam(s)) for s in SCENARIOS]
    pcts = []
    for p in PCT_SCENARIOS:
        a = {"gross_sales": p["gross"], "sales_exclusions": p["excl"], "rate": p["rate"], "base_rent_annual": p["base"],
             "breakpoint": {"type": p["bp"][0]} if p["bp"][0] == "natural" else {"type": "fixed", "amount": p["bp"][1]},
             "period_fraction": p["frac"], "percentage_rent_paid": p["paid"]}
        pcts.append(run("calc_percentage_rent", a))

    wb = Workbook("FactLot reconciliation: retail CAM and percentage rent (synthetic)")
    readme_sheet(
        wb,
        "Retail: CAM reconciliation and percentage rent",
        [
            "Three synthetic CAM reconciliations exercise the branches a retail lease usually has: net vs base year vs expense stop; "
            "gross-up; the three cap methods; an admin fee before or after the cap, inside or outside it; partial-year occupancy by days. "
            "The expense lines and pro rata share are invented (a 12,000 SF tenant in a 150,000 SF centre is the 8% case).",
            "Two percentage-rent cases (natural and fixed breakpoint, full and half year) go through calc_percentage_rent.",
        ],
        [("calc_cam_reconciliation", cams[0]), ("calc_percentage_rent", pcts[0])],
        CONVENTIONS,
        ["FactLot does not decide what a lease means: map the lease's cap and fee language to the named method yourself. A cap that "
         "reads 'cumulative' or 'non-cumulative' is ambiguous; see the calc_cam_reconciliation tool description."],
    )
    rec = Recon(wb)
    for s, res in zip(SCENARIOS, cams):
        R = cam_sheet(wb, s)
        v = res["value"]
        rec.section(f"calc_cam_reconciliation: {s['title']}")
        rec.add("Recoverable expenses", "USD", f"={R['recoverable']}", v["recoverable_expenses"], "recoverable_expenses")
        rec.add("Recoverable expenses after gross-up", "USD", f"={R['grossed']}", v["grossed_up_expenses"], "grossed_up_expenses")
        rec.add("Tenant share of controllable", "USD", f"={R['ctrl']}", v["tenant_share_controllable"], "tenant_share_controllable")
        rec.add("Tenant share of uncontrollable", "USD", f"={R['unctrl']}", v["tenant_share_uncontrollable"], "tenant_share_uncontrollable")
        if v["cap_limit"] is not None:
            rec.add("Cap limit", "USD", f"={R['cap_limit']}", v["cap_limit"], "cap_limit")
        rec.add("Cap reduction", "USD", f"={R['cap_red']}", v["cap_reduction"], "cap_reduction")
        if s["fee"]:
            rec.add("Admin fee", "USD", f"={R['admin_fee']}", v["admin_fee"], "admin_fee")
        rec.add("Occupancy fraction", "ratio", f"=ROUND({R['frac']},6)", v["occupancy_fraction"], "occupancy_fraction", "num6")
        rec.add("Structure deduction", "USD", f"={R['_ded']}" if R["_ded"] != "0" else "=0", v["structure_deduction"], "structure_deduction")
        rec.add("Tenant CAM charge", "USD", f"={R['charge']}", v["tenant_charge"], "tenant_charge")
        rec.add("Estimates paid", "USD", f"={R['estimates']}", v["estimates_paid"], "estimates_paid")
        rec.add("Balance due", "USD", f"={R['balance']}", v["balance_due"], "balance_due")

    sh = wb.sheet("PctRent")
    sh.width(1, 44)
    for c in (2, 3):
        sh.width(c, 22)
    sh.put(1, 1, "Percentage rent", "title")
    sh.put(2, 1, "SYNTHETIC. Blue on yellow = inputs.", "warn")
    sh.put(4, 1, "", "text")
    for j, p in enumerate(PCT_SCENARIOS):
        sh.put(4, 2 + j, p["name"], "header")
    sh.put(4, 1, "Item", "header")
    labels = [
        ("gross", "Gross sales", "in_money"), ("excl", "Sales exclusions", "in_money"), ("rate", "Rate", "in_pct"),
        ("base", "Annual base rent", "in_money"), ("bp_amt", "Fixed breakpoint (0 if natural)", "in_money"),
        ("frac", "Fraction of a lease year", "in_num4"), ("paid", "Percentage rent already paid", "in_money"),
    ]
    for i, (k, lab, st) in enumerate(labels):
        sh.put(5 + i, 1, lab, "text")
        for j, p in enumerate(PCT_SCENARIOS):
            val = {"bp_amt": p["bp"][1]}.get(k, p.get(k))
            sh.put(5 + i, 2 + j, val, st)
    sh.put(12, 1, "Breakpoint type", "text")
    for j, p in enumerate(PCT_SCENARIOS):
        sh.put(12, 2 + j, p["bp"][0], "in_text")
    outs = [("net", "Net sales"), ("bp", "Breakpoint"), ("over", "Sales over breakpoint"), ("pct", "Percentage rent"), ("bal", "Balance due")]
    for i, (k, lab) in enumerate(outs):
        sh.put(14 + i, 1, lab, "bold")
    for j, p in enumerate(PCT_SCENARIOS):
        c = chr(66 + j)
        sh.put(14, 2 + j, f"=ROUND(MAX(0,{c}5-{c}6),2)", "money")
        sh.put(15, 2 + j, f'=IF({c}12="natural",ROUND({c}8/{c}7*{c}10,2),ROUND({c}9*{c}10,2))', "money")
        sh.put(16, 2 + j, f"=ROUND(MAX(0,{c}14-{c}15),2)", "money")
        sh.put(17, 2 + j, f"=ROUND({c}16*{c}7,2)", "money")
        sh.put(18, 2 + j, f"=ROUND({c}17-{c}11,2)", "money")
        v = pcts[j]["value"]
        rec.section(f"calc_percentage_rent: {p['name']}")
        rec.add("Net sales", "USD", f"=PctRent!{c}14", v["net_sales"], "net_sales")
        rec.add("Breakpoint", "USD", f"=PctRent!{c}15", v["breakpoint"], "breakpoint")
        rec.add("Sales over breakpoint", "USD", f"=PctRent!{c}16", v["sales_over_breakpoint"], "sales_over_breakpoint")
        rec.add("Percentage rent", "USD", f"=PctRent!{c}17", v["percentage_rent"], "percentage_rent")
        rec.add("Balance due", "USD", f"=PctRent!{c}18", v["balance_due"], "balance_due")
    rec.finish()
    return wb, rec
