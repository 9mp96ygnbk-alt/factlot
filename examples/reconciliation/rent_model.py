"""The Excel model of a lease proposal, used by the office and industrial workbooks.

One proposal gets one sheet with a month-by-month table. The formulas follow FactLot's stated
conventions (see CONVENTIONS) and are written generically (IF on the escalation and expense
structure), so changing a blue input on the Inputs sheet recalculates the Excel side.
The month count (term) is structural: the table has one row per month.
"""

from __future__ import annotations

from xlsx_lite import Workbook, Sheet, addr

CONVENTIONS = [
    "Monthly rent = ROUND(rate $/SF/yr x area / 12, 2): annual rent divided by 12, rounded to the cent, half away from zero (Excel ROUND).",
    "Escalation: 'percent' compounds, rate_k = start x (1 + r)^k; 'fixed_psf' adds amount x k; k = INT((month - 1) / every_months), so the first bump is in month every_months + 1. 'Round rate to cents' rounds each step's $/SF/yr to the cent before the monthly rent is taken.",
    "Free rent: the listed months (here the first n) pay zero base rent; operating-expense pass-throughs are still owed.",
    "Discounting: monthly rate = annual / 12 (nominal). Cash flows fall at the START of each month, so month 1 is discounted by (1 + r)^0 = 1. One-time items (TI, commissions, concessions) fall at commencement and are not discounted.",
    "Net effective rent and the proposal metrics are the level monthly amount whose present value equals the net cash flows: (PV of flows + PV of one-time items) / sum of discount factors, times 12, divided by the area.",
    "Operating expenses grow at the stated rate each lease year from commencement (year 1 = the estimate). Tenant pays: gross 0; nnn all; base_year the excess over the base; expense_stop the excess over the stop. The landlord bears the rest.",
    "Dates: lease months run from the commencement day-of-month. Rent is not prorated to calendar months (all synthetic leases here commence on the 1st).",
    "Rounding of outputs: $/SF/yr metrics to 4 decimals, dollar totals to cents. Intermediate monthly amounts are rounded to the cent where FactLot rounds them, and not otherwise.",
]

INPUT_ROWS = [
    ("name", "Name", "in_text", ""),
    ("area", "Rentable area (SF)", "in_int", ""),
    ("term", "Term (months)", "in_int", "Structural: the month table has this many rows; regenerate to change it."),
    ("start", "Starting base rent ($/SF/yr)", "in_money", "Annual, not monthly."),
    ("esc_type", "Escalation type", "in_text", "none | percent | fixed_psf"),
    ("esc_rate", "Escalation rate (percent type)", "in_pct", ""),
    ("esc_amt", "Escalation amount $/SF/yr (fixed_psf type)", "in_money", ""),
    ("esc_every", "Months between bumps", "in_int", ""),
    ("free", "Free rent (first n months)", "in_int", "FactLot abated_months = 1..n."),
    ("round", "Round each step's rate to cents (1 = yes)", "in_int", ""),
    ("ti", "TI allowance ($/SF, once at commencement)", "in_money", ""),
    ("lc", "Leasing commissions (USD)", "in_money", "Landlord cost; used by net effective rent and the landlord view."),
    ("other", "Other concessions (USD)", "in_money", ""),
    ("opex_type", "Operating-expense structure", "in_text", "none | gross | nnn | base_year | expense_stop"),
    ("exp", "Operating expenses, lease year 1 ($/SF/yr)", "in_money", ""),
    ("growth", "Operating-expense growth per year", "in_pct", ""),
    ("base", "Base-year expenses ($/SF/yr)", "in_money", "base_year type"),
    ("stop", "Expense stop ($/SF/yr)", "in_money", "expense_stop type"),
    ("add", "Additional tenant costs ($/SF/yr)", "in_money", "e.g. parking; tenant view only"),
    ("upfront", "Tenant upfront costs (USD)", "in_money", "Tenant view only"),
    ("downtime", "Landlord downtime before commencement (months)", "in_int", "Structural (landlord view); regenerate to change it."),
]


def inputs_grid(wb: Workbook, proposals: list[dict], discount: float) -> tuple[list[dict], str]:
    """Inputs sheet: one column per proposal. Returns (refs per proposal, discount-rate ref)."""
    sh = wb.sheet("Inputs")
    sh.width(1, 48)
    for c in range(2, 2 + len(proposals)):
        sh.width(c, 22)
    sh.width(2 + len(proposals), 60)
    sh.put(1, 1, "Inputs", "title")
    sh.put(2, 1, "SYNTHETIC inputs. Blue on yellow = edit me. Not real leases, buildings or tenants.", "warn")
    sh.put(4, 1, "Discount rate, annual (nominal)", "text")
    disc = sh.put(4, 2, discount, "in_pct")
    sh.put(4, 3, "Monthly rate = annual / 12.", "note")
    sh.put(6, 1, "Proposal", "header")
    for j, p in enumerate(proposals):
        sh.put(6, 2 + j, p["name"], "header")
    sh.put(6, 2 + len(proposals), "Note", "header")
    refs: list[dict] = [{} for _ in proposals]
    row = 7
    for key, label, style, note in INPUT_ROWS:
        if key == "name":
            continue
        sh.put(row, 1, label, "text")
        for j, p in enumerate(proposals):
            refs[j][key] = sh.put(row, 2 + j, p[key], style)
        if note:
            sh.put(row, 2 + len(proposals), note, "note")
        row += 1
    return refs, disc


def proposal_sheet(wb: Workbook, sheet_name: str, title: str, I: dict, disc: str, term: int, downtime: int) -> dict:
    """Build one proposal's month table and summary. Returns addresses of the results."""
    sh = wb.sheet(sheet_name)
    sh.put(1, 1, title, "title")
    sh.put(2, 1, "SYNTHETIC. Live formulas; inputs come from the Inputs sheet.", "note")
    sh.width(1, 44)
    for c in range(2, 23):
        sh.width(c, 15)
    sh.put(3, 1, "Monthly discount rate r", "text")
    sh.put(3, 2, f"={disc}/12", "num8")
    sh.put(4, 1, "Additional tenant costs, monthly", "text")
    sh.put(4, 2, f"=ROUND({I['add']}*{I['area']}/12,2)", "money")
    sh.put(5, 1, "Landlord downtime carry, monthly", "text")
    sh.put(5, 2, f'=IF({I["opex_type"]}="none",0,ROUND({I["exp"]}*{I["area"]}/12,2))', "money")

    hr, dr = 22, 23
    last = dr + term - 1
    heads = [
        "Month", "Bump step k", "Rate raw $/SF/yr", "Rate used $/SF/yr", "Scheduled rent", "Abated (1/0)", "Rent due",
        "Opex year", "Opex total $/SF/yr", "Tenant pays $/SF/yr", "Tenant opex monthly", "Tenant flow",
        "Discount factor (tenant)", "PV tenant flow", "Landlord bears monthly", "Landlord flow",
        "Discount factor (landlord)", "PV landlord flow",
    ]
    for c, h in enumerate(heads, 1):
        sh.put(hr, c, h, "header")
    sh.put(hr - 1, 1, "Month-by-month table", "bold")
    ot = I["opex_type"]
    for i in range(1, term + 1):
        r = dr + i - 1
        sh.put(r, 1, i, "int")
        sh.put(r, 2, f"=INT((A{r}-1)/{I['esc_every']})", "int")
        sh.put(
            r, 3,
            f'=IF({I["esc_type"]}="percent",{I["start"]}*(1+{I["esc_rate"]})^B{r},'
            f'IF({I["esc_type"]}="fixed_psf",{I["start"]}+{I["esc_amt"]}*B{r},{I["start"]}))',
            "num6",
        )
        sh.put(r, 4, f"=IF({I['round']}=1,ROUND(C{r},2),C{r})", "num6")
        sh.put(r, 5, f"=ROUND(D{r}*{I['area']}/12,2)", "money")
        sh.put(r, 6, f"=IF(A{r}<={I['free']},1,0)", "int")
        sh.put(r, 7, f"=IF(F{r}=1,0,E{r})", "money")
        sh.put(r, 8, f"=INT((A{r}-1)/12)", "int")
        sh.put(r, 9, f'=IF({ot}="none",0,{I["exp"]}*(1+{I["growth"]})^H{r})', "num6")
        sh.put(
            r, 10,
            f'=IF(OR({ot}="none",{ot}="gross"),0,IF({ot}="nnn",I{r},IF({ot}="base_year",MAX(0,I{r}-{I["base"]}),MAX(0,I{r}-{I["stop"]}))))',
            "num6",
        )
        sh.put(r, 11, f"=ROUND(J{r}*{I['area']}/12,2)", "money")
        sh.put(r, 12, f"=G{r}+$B$4+K{r}", "money")
        sh.put(r, 13, f"=(1+$B$3)^(-(A{r}-1))", "num8")
        sh.put(r, 14, f"=L{r}*M{r}", "money")
        sh.put(r, 15, f'=IF({ot}="none",0,ROUND(ROUND(I{r}*{I["area"]}/12,2)-K{r},2))', "money")
        sh.put(r, 16, f"=G{r}-O{r}", "money")
        sh.put(r, 17, f"=(1+$B$3)^(-(A{r}-1+{I['downtime']}))", "num8")
        sh.put(r, 18, f"=P{r}*Q{r}", "money")
    sh.freeze = f"B{dr}"

    # landlord downtime table (columns T:V)
    sh.put(hr, 20, "Downtime month j", "header")
    sh.put(hr, 21, "Carry", "header")
    sh.put(hr, 22, "Discount factor", "header")
    for j in range(downtime):
        r = dr + j
        sh.put(r, 20, j, "int")
        sh.put(r, 21, "=$B$5", "money")
        sh.put(r, 22, f"=(1+$B$3)^(-T{r})", "num8")
    if downtime:
        dlast = dr + downtime - 1
        pv_down = f"SUMPRODUCT(U{dr}:U{dlast},V{dr}:V{dlast})"
        an_down = f"SUM(V{dr}:V{dlast})"
    else:
        pv_down, an_down = "0", "0"

    rng = lambda col: f"{col}{dr}:{col}{last}"  # noqa: E731
    rows = [
        (7, "Tenant view: PV of monthly flows", f"=SUM({rng('N')})", "money"),
        (8, "Tenant view: sum of discount factors", f"=SUM({rng('M')})", "num8"),
        (9, "Tenant view: one-time items (upfront - TI - concessions)", f"={I['upfront']}-{I['ti']}*{I['area']}-{I['other']}", "money"),
        (10, "Tenant view: level monthly amount", "=(B7+B9)/B8", "num6"),
        (11, "Tenant view: effective occupancy cost $/SF/yr", f"=ROUND(B10*12/{I['area']},4)", "num4"),
        (12, "Tenant view: total net cost, undiscounted", f"=ROUND(SUM({rng('L')})+B9,2)", "money"),
        (13, "Landlord view: PV of flows less downtime carry", f"=SUM({rng('R')})-{pv_down}", "money"),
        (14, "Landlord view: sum of discount factors (downtime + term)", f"=SUM({rng('Q')})+{an_down}", "num8"),
        (15, "Landlord view: one-time items (-(TI + commissions + concessions))", f"=-({I['ti']}*{I['area']}+{I['lc']}+{I['other']})", "money"),
        (16, "Landlord view: one-time items, PV at commencement", f"=B15*(1+B3)^(-{I['downtime']})", "money"),
        (17, "Landlord view: level monthly amount", "=(B13+B16)/B14", "num6"),
        (18, "Landlord view: discounted NER $/SF/yr", f"=ROUND(B17*12/{I['area']},4)", "num4"),
        (19, "Landlord view: total net, undiscounted", f"=ROUND(SUM({rng('P')})-{I['downtime']}*B5+B15,2)", "money"),
    ]
    for r, label, f, st in rows:
        sh.put(r, 1, label, "text")
        sh.put(r, 2, f, st)
    return {
        "sheet": sh, "dr": dr, "last": last, "rng": rng,
        "tenant_metric": f"{sheet_name}!$B$11", "tenant_total": f"{sheet_name}!$B$12",
        "landlord_metric": f"{sheet_name}!$B$18", "landlord_total": f"{sheet_name}!$B$19",
        "dfT": f"{sheet_name}!{rng('M')}", "rent_due": f"{sheet_name}!{rng('G')}",
        "scheduled": f"{sheet_name}!{rng('E')}", "abated": f"{sheet_name}!{rng('F')}",
        "rate": f"{sheet_name}!{rng('D')}",
    }


def factlot_schedule(p: dict, start_date: str = "2027-01-01") -> dict:
    esc: dict
    if p["esc_type"] == "percent":
        esc = {"type": "percent", "rate": p["esc_rate"], "every_months": p["esc_every"]}
    elif p["esc_type"] == "fixed_psf":
        esc = {"type": "fixed_psf", "amount": p["esc_amt"], "every_months": p["esc_every"]}
    else:
        esc = {"type": "none"}
    return {
        "commencement_date": p.get("date", start_date),
        "term_months": p["term"],
        "area_sf": p["area"],
        "starting_rent_psf_annual": p["start"],
        "escalation": esc,
        "abated_months": list(range(1, p["free"] + 1)),
        "round_rate_to_cents": bool(p["round"]),
    }


def factlot_opex(p: dict) -> dict | None:
    t = p["opex_type"]
    if t == "none":
        return None
    o = {"type": t, "expense_psf_annual": p["exp"], "growth_rate_annual": p["growth"]}
    if t == "base_year":
        o["base_year_psf_annual"] = p["base"]
    if t == "expense_stop":
        o["stop_psf_annual"] = p["stop"]
    return o
