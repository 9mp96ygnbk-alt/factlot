"""Lender: calc_debt_sizing (LTV, DSCR, debt yield, refinance, stress) plus amortization checks in Excel."""

from __future__ import annotations

from common import Recon, readme_sheet, run
from xlsx_lite import Workbook

FILENAME = "lender-debt-sizing.xlsx"

CONVENTIONS = [
    "Annual constant = 12 x r / (1 - (1 + r)^-n) with r = rate / 12 and n = amortization years x 12 (monthly payments in arrears); for an "
    "interest-only loan (amortization 0) the constant is the rate. Annual debt service = ROUND(loan x constant, 2).",
    "Three loans are sized: LTV = value x max LTV; DSCR = NOI / min DSCR / constant; debt yield = NOI / min debt yield. The maximum loan is the "
    "smallest, rounded DOWN to the increment (round_down_to). A tie goes to the earlier of ltv, dscr, debt_yield.",
    "Flooring: FactLot first reduces loan / increment to 15 significant digits, so binary noise cannot cost an increment "
    "(0.57 x 10,000,000 = 5,699,999.999999999 floors to 5,700,000). The Excel side uses INT(ROUND(x, 6)) x increment, which agrees unless the "
    "quotient sits within 5e-7 of a whole number without being one. Neither tie case occurs in these examples.",
    "Resulting ratios are rounded to 4 decimals (annual constant to 8). Stress rows apply NOI x (1 + shock), rate + shock, and, when value "
    "moves with NOI, value x (1 + NOI shock), each re-sized with the same constraints and rounding.",
    "Amortization checks (a table of 360 monthly payments, the balance after the term, the first-month interest and principal) are Excel-only "
    "identities: calc_debt_sizing does not return a schedule or a balloon balance. They are shown so the constant can be audited against a payment table.",
]

SC1 = dict(sheet="Lender_1", title="Scenario 1: 30-year amortizing loan sized on LTV, DSCR and debt yield, with a refinance and a stress table",
           noi=1_900_000.0, value=33_000_000.0, rate=0.0635, am=30, ltv=0.65, dscr=1.30, dy=0.09, inc=10_000.0, existing=20_500_000.0,
           noi_shocks=[-0.10, -0.20], rate_shocks=[0.0, 0.01])
SC2 = dict(sheet="Lender_2", title="Scenario 2: interest-only bridge loan sized on DSCR and debt yield only (no value)",
           noi=1_100_000.0, value=None, rate=0.0775, am=0, ltv=None, dscr=1.20, dy=0.10, inc=25_000.0, existing=None,
           noi_shocks=None, rate_shocks=None)


def fl_args(s: dict) -> dict:
    a = {"noi": s["noi"], "rate_annual": s["rate"], "amortization_years": s["am"], "round_down_to": s["inc"]}
    if s["value"]:
        a["value"] = s["value"]
    if s["ltv"]:
        a["max_ltv"] = s["ltv"]
    if s["dscr"]:
        a["min_dscr"] = s["dscr"]
    if s["dy"]:
        a["min_debt_yield"] = s["dy"]
    if s["existing"]:
        a["existing_loan_balance"] = s["existing"]
    if s["noi_shocks"]:
        a["stress"] = {"noi_shocks": s["noi_shocks"], "rate_shocks": s["rate_shocks"], "value_moves_with_noi": True}
    return a


def sizing_sheet(wb: Workbook, s: dict) -> dict:
    sh = wb.sheet(s["sheet"])
    sh.width(1, 52)
    sh.width(2, 22)
    sh.width(3, 56)
    for c in range(4, 22):
        sh.width(c, 15)
    sh.put(1, 1, s["title"], "title")
    sh.put(2, 1, "SYNTHETIC. Blue on yellow = inputs; the rest are live formulas.", "warn")
    R: dict[str, str] = {}
    row = [4]

    def put(key, label, v, style, note=""):
        r = row[0]
        sh.put(r, 1, label, "text")
        R[key] = sh.put(r, 2, v, style)
        if note:
            sh.put(r, 3, note, "note")
        row[0] += 1

    put("noi", "Underwritten NOI (USD/yr)", s["noi"], "in_money")
    if s["value"]:
        put("value", "Value (USD)", s["value"], "in_money")
    put("rate", "Interest rate, annual", s["rate"], "in_pct")
    put("am", "Amortization (years; 0 = interest-only)", s["am"], "in_int")
    if s["ltv"]:
        put("ltv", "Maximum LTV", s["ltv"], "in_pct")
    if s["dscr"]:
        put("dscr", "Minimum DSCR", s["dscr"], "in_num4")
    if s["dy"]:
        put("dy", "Minimum debt yield", s["dy"], "in_pct")
    put("inc", "Round the loan down to (USD)", s["inc"], "in_money")
    if s["existing"]:
        put("existing", "Existing loan balance to refinance (USD)", s["existing"], "in_money")
    row[0] += 1
    sh.put(row[0], 1, "Sizing", "bold")
    row[0] += 1
    put("k", "Annual constant", f'=IF({R["am"]}=0,{R["rate"]},12*({R["rate"]}/12)/(1-(1+{R["rate"]}/12)^(-{R["am"]}*12)))', "num8")
    names = []
    if s["ltv"]:
        put("l_ltv", "Loan at max LTV", f"={R['value']}*{R['ltv']}", "money")
        names.append(("ltv", R["l_ltv"]))
    if s["dscr"]:
        put("l_dscr", "Loan at min DSCR", f"={R['noi']}/{R['dscr']}/{R['k']}", "money")
        names.append(("dscr", R["l_dscr"]))
    if s["dy"]:
        put("l_dy", "Loan at min debt yield", f"={R['noi']}/{R['dy']}", "money")
        names.append(("debt_yield", R["l_dy"]))
    refs = [n[1] for n in names]
    put("min", "Smallest of the constraint loans", f"=MIN({','.join(refs)})", "money")
    put("loan", "Maximum loan (rounded down)", f"=INT(ROUND({R['min']}/{R['inc']},6))*{R['inc']}", "money")
    # binding: earliest minimal
    expr = f'"{names[-1][0]}"'
    for i in range(len(names) - 2, -1, -1):
        others = [n[1] for n in names[i + 1:]]
        cond = "AND(" + ",".join(f"{names[i][1]}<={o}" for o in others) + ")"
        expr = f'IF({cond},"{names[i][0]}",{expr})'
    put("binding", "Binding constraint", "=" + expr, "default")
    put("ds", "Annual debt service", f"=ROUND({R['loan']}*{R['k']},2)", "money")
    if s["value"]:
        put("r_ltv", "Resulting LTV", f"=ROUND({R['loan']}/{R['value']},4)", "num4")
    put("r_dscr", "Resulting DSCR", f"=ROUND({R['noi']}/{R['ds']},4)", "num4")
    put("r_dy", "Resulting debt yield", f"=ROUND({R['noi']}/{R['loan']},4)", "num4")
    if s["existing"]:
        put("short", "Refinance shortfall", f"=ROUND(MAX(0,{R['existing']}-{R['loan']}),2)", "money")
        put("excess", "Refinance excess proceeds", f"=ROUND(MAX(0,{R['loan']}-{R['existing']}),2)", "money")
    # Excel PMT cross-check
    row[0] += 1
    sh.put(row[0], 1, "Amortization checks (Excel-only identities)", "bold")
    row[0] += 1
    if s["am"]:
        put("pmt", "Monthly payment, Excel PMT", f"=-PMT({R['rate']}/12,{R['am']}*12,{R['loan']})", "num6")
        put("ds_pmt", "Annual debt service from PMT x 12", f"=ROUND(12*{R['pmt']},2)", "money")
    else:
        put("pmt", "Monthly interest-only payment", f"={R['loan']}*{R['rate']}/12", "num6")
        put("ds_pmt", "Annual debt service from payment x 12", f"=ROUND(12*{R['pmt']},2)", "money")
    put("i1", "First-month interest", f"=ROUND({R['loan']}*{R['rate']}/12,2)", "money")
    put("p1", "First-month principal", f"=ROUND({R['pmt']}-{R['i1']},2)", "money")
    if s["am"]:
        put("bal10", "Balance after 120 payments (balloon of a 10-year term)",
            f"=ROUND({R['loan']}*(1+{R['rate']}/12)^120-{R['pmt']}*((1+{R['rate']}/12)^120-1)/({R['rate']}/12),2)", "money",
            "Excel-only: calc_debt_sizing returns no balance.")
    return R


def stress_block(sh, s: dict, R: dict, fl: dict) -> list[dict]:
    """Stress table below the sizing block; returns refs per row for reconciliation."""
    r0 = 40
    heads = ["NOI shock", "Rate shock", "Value shock", "NOI", "Rate", "Value", "Constant", "Loan at LTV", "Loan at DSCR", "Loan at debt yield",
             "Smallest", "Max loan", "Binding", "Debt service", "LTV", "DSCR", "Debt yield", "Refi shortfall"]
    sh.put(r0 - 1, 1, "Stress table (value moves with NOI, as in the FactLot call)", "bold")
    for c, h in enumerate(heads, 1):
        sh.put(r0, c, h, "header")
    out = []
    k = 0
    for dn in s["noi_shocks"]:
        for dr in s["rate_shocks"]:
            r = r0 + 1 + k
            k += 1
            sh.put(r, 1, dn, "in_pct")
            sh.put(r, 2, dr, "in_pct")
            sh.put(r, 3, 0.0, "in_pct")
            sh.put(r, 4, f"={R['noi']}*(1+A{r})", "money")
            sh.put(r, 5, f"={R['rate']}+B{r}", "num8")
            sh.put(r, 6, f"={R['value']}*(1+A{r})*(1+C{r})", "money")
            sh.put(r, 7, f'=IF({R["am"]}=0,E{r},12*(E{r}/12)/(1-(1+E{r}/12)^(-{R["am"]}*12)))', "num8")
            sh.put(r, 8, f"=F{r}*{R['ltv']}", "money")
            sh.put(r, 9, f"=D{r}/{R['dscr']}/G{r}", "money")
            sh.put(r, 10, f"=D{r}/{R['dy']}", "money")
            sh.put(r, 11, f"=MIN(H{r},I{r},J{r})", "money")
            sh.put(r, 12, f"=INT(ROUND(K{r}/{R['inc']},6))*{R['inc']}", "money")
            sh.put(r, 13, f'=IF(AND(H{r}<=I{r},H{r}<=J{r}),"ltv",IF(I{r}<=J{r},"dscr","debt_yield"))', "default")
            sh.put(r, 14, f"=ROUND(L{r}*G{r},2)", "money")
            sh.put(r, 15, f"=ROUND(L{r}/F{r},4)", "num4")
            sh.put(r, 16, f"=ROUND(D{r}/N{r},4)", "num4")
            sh.put(r, 17, f"=ROUND(D{r}/L{r},4)", "num4")
            sh.put(r, 18, f"=ROUND(MAX(0,{R['existing']}-L{r}),2)", "money")
            out.append({"row": r, "sheet": s["sheet"], "dn": dn, "dr": dr})
    return out


def amort_sheet(wb: Workbook, name: str, loan_ref: str, rate_ref: str, n: int) -> dict:
    sh = wb.sheet(name)
    for c, w in zip(range(1, 7), (10, 20, 18, 18, 18, 20)):
        sh.width(c, w)
    sh.put(1, 1, "Amortization table (Excel-only check, unrounded)", "title")
    sh.put(2, 1, "SYNTHETIC. Opening balance, interest, level payment (PMT), principal, closing balance for each month.", "note")
    for c, h in enumerate(("Month", "Opening", "Interest", "Payment", "Principal", "Closing"), 1):
        sh.put(4, c, h, "header")
    r0 = 5
    for m in range(1, n + 1):
        r = r0 + m - 1
        sh.put(r, 1, m, "int")
        sh.put(r, 2, f"={loan_ref}" if m == 1 else f"=F{r - 1}", "money")
        sh.put(r, 3, f"=B{r}*{rate_ref}/12", "money")
        sh.put(r, 4, f"=-PMT({rate_ref}/12,{n},{loan_ref})", "money")
        sh.put(r, 5, f"=D{r}-C{r}", "money")
        sh.put(r, 6, f"=B{r}-E{r}", "money")
    sh.freeze = "A5"
    last = r0 + n - 1
    return {"first12": f"{name}!$D${r0}:$D${r0 + 11}", "final": f"{name}!$F${last}", "principal": f"{name}!$E${r0}:$E${last}"}


def build() -> tuple[Workbook, Recon]:
    res1 = run("calc_debt_sizing", fl_args(SC1))
    res2 = run("calc_debt_sizing", fl_args(SC2))
    wb = Workbook("FactLot reconciliation: lender debt sizing (synthetic)")
    readme_sheet(
        wb,
        "Lender: debt sizing, refinance, stress and amortization checks",
        [
            "Scenario 1 sizes a synthetic 30-year amortizing loan on LTV, DSCR and debt yield, tests a refinance against an existing balance, "
            "and stresses NOI (-10%, -20%) and rate (+0, +100 bp) with value moving with NOI. Scenario 2 sizes a synthetic interest-only bridge "
            "loan on DSCR and debt yield. Every FactLot output (loans by constraint, binding constraint, constant, debt service, resulting ratios, "
            "refinance, each stress row) is rebuilt in Excel.",
            "An amortization table (360 payments) checks that the constant corresponds to a loan that repays to 0.00.",
        ],
        [("calc_debt_sizing", res1)],
        CONVENTIONS,
        ["FactLot sizes the maximum loan a lender's tests would allow; it does not model a lender's fees, reserves, rate floors or covenants."],
    )
    rec = Recon(wb)
    R1 = sizing_sheet(wb, SC1)
    sh1 = wb.get(SC1["sheet"])
    stress_rows = stress_block(sh1, SC1, R1, res1)
    am = amort_sheet(wb, "Amort_1", R1["loan"], R1["rate"], 360)
    R2 = sizing_sheet(wb, SC2)

    def sizing_rows(R: dict, v: dict, s: dict, title: str) -> None:
        rec.section(f"calc_debt_sizing: {title}")
        rec.add("Annual constant", "ratio", f"=ROUND({R['k']},8)", v["annual_constant"], "annual_constant", "num8")
        lbc = v["loan_by_constraint"]
        if "ltv" in lbc:
            rec.add("Loan at max LTV", "USD", f"=ROUND({R['l_ltv']},2)", lbc["ltv"], "loan_by_constraint.ltv")
        if "dscr" in lbc:
            rec.add("Loan at min DSCR", "USD", f"=ROUND({R['l_dscr']},2)", lbc["dscr"], "loan_by_constraint.dscr")
        if "debt_yield" in lbc:
            rec.add("Loan at min debt yield", "USD", f"=ROUND({R['l_dy']},2)", lbc["debt_yield"], "loan_by_constraint.debt_yield")
        rec.add("Maximum loan", "USD", f"={R['loan']}", v["max_loan"], "max_loan")
        rec.add("Binding constraint", "text", f"={R['binding']}", v["binding_constraint"], "binding_constraint", "text")
        rec.add("Annual debt service", "USD", f"={R['ds']}", v["annual_debt_service"], "annual_debt_service")
        if s["value"]:
            rec.add("Resulting LTV", "ratio", f"={R['r_ltv']}", v["resulting"]["ltv"], "resulting.ltv", "num4")
        rec.add("Resulting DSCR", "ratio", f"={R['r_dscr']}", v["resulting"]["dscr"], "resulting.dscr", "num4")
        rec.add("Resulting debt yield", "ratio", f"={R['r_dy']}", v["resulting"]["debt_yield"], "resulting.debt_yield", "num4")
        rec.add("Annual debt service from the payment (PMT x 12, or interest x 12)", "USD", f"={R['ds_pmt']}", v["annual_debt_service"],
                "annual_debt_service", "money", 8, "Independent route: Excel PMT, not loan x constant.")
        if s["existing"]:
            rec.add("Refinance shortfall", "USD", f"={R['short']}", v["refinance"]["shortfall"], "refinance.shortfall")
            rec.add("Refinance excess proceeds", "USD", f"={R['excess']}", v["refinance"]["excess_proceeds"], "refinance.excess_proceeds")

    sizing_rows(R1, res1["value"], SC1, SC1["title"])
    rec.section("Amortization checks, scenario 1 (identities; the 'FactLot' column is the identity's expected value)")
    rec.add("Debt service from the first 12 rows of the 360-payment table", "USD", f"=ROUND(SUM({am['first12']}),2)",
            res1["value"]["annual_debt_service"], "annual_debt_service")
    rec.add("Closing balance after payment 360", "USD", f"=ROUND({am['final']},2)", 0.0, "identity: a fully amortizing loan repays to 0.00")
    rec.add("Sum of principal repaid over 360 payments less the loan", "USD", f"=ROUND(SUM({am['principal']})-{R1['loan']},2)", 0.0,
            "identity: principal repaid equals the loan")
    for st, row in zip(res1["value"]["stress"], stress_rows):
        r = row["row"]
        sn = SC1["sheet"]
        rec.section(f"Stress row: NOI {st['noi_shock']:+.0%}, rate {st['rate_shock'] * 10000:+.0f} bp")
        rec.add("Stressed NOI", "USD", f"=ROUND({sn}!D{r},2)", st["noi"], "stress[].noi")
        rec.add("Stressed rate", "rate", f"=ROUND({sn}!E{r},8)", st["rate_annual"], "stress[].rate_annual", "num8")
        rec.add("Stressed value", "USD", f"=ROUND({sn}!F{r},2)", st["value"], "stress[].value")
        rec.add("Max loan", "USD", f"={sn}!L{r}", st["max_loan"], "stress[].max_loan")
        rec.add("Binding constraint", "text", f"={sn}!M{r}", st["binding_constraint"], "stress[].binding_constraint", "text")
        rec.add("Annual debt service", "USD", f"={sn}!N{r}", st["annual_debt_service"], "stress[].annual_debt_service")
        rec.add("LTV", "ratio", f"={sn}!O{r}", st["ltv"], "stress[].ltv", "num4")
        rec.add("DSCR", "ratio", f"={sn}!P{r}", st["dscr"], "stress[].dscr", "num4")
        rec.add("Debt yield", "ratio", f"={sn}!Q{r}", st["debt_yield"], "stress[].debt_yield", "num4")
        rec.add("Refinance shortfall", "USD", f"={sn}!R{r}", st["refinance_shortfall"], "stress[].refinance_shortfall")
    sizing_rows(R2, res2["value"], SC2, SC2["title"])
    rec.finish()
    return wb, rec
