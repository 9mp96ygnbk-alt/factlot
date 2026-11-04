"""Office: rent schedule, net effective rent and compare_proposals (tenant and landlord views)."""

from __future__ import annotations

from common import Calc, Recon, readme_sheet, run
from rent_model import CONVENTIONS, factlot_opex, factlot_schedule, inputs_grid, proposal_sheet
from xlsx_lite import Workbook

FILENAME = "office-lease-proposals.xlsx"
DISCOUNT = 0.08

# SYNTHETIC proposals. Names, sizes, rents and costs are invented for illustration.
PROPOSALS = [
    dict(name="A Tower (synthetic)", area=25000, term=120, start=42.5, esc_type="percent", esc_rate=0.03, esc_amt=0, esc_every=12,
         free=6, round=1, ti=55.0, lc=350000, other=0, opex_type="base_year", exp=14.0, growth=0.03, base=14.0, stop=0,
         add=0, upfront=0, downtime=4),
    dict(name="B Campus (synthetic)", area=27500, term=84, start=38.0, esc_type="fixed_psf", esc_rate=0, esc_amt=1.0, esc_every=12,
         free=4, round=0, ti=70.0, lc=300000, other=100000, opex_type="nnn", exp=11.5, growth=0.025, base=0, stop=0,
         add=0, upfront=150000, downtime=6),
    dict(name="C Midrise (synthetic)", area=22000, term=60, start=44.0, esc_type="none", esc_rate=0, esc_amt=0, esc_every=12,
         free=3, round=0, ti=45.0, lc=190000, other=0, opex_type="expense_stop", exp=13.0, growth=0.035, base=0, stop=12.0,
         add=1.2, upfront=0, downtime=3),
    dict(name="D Plaza (synthetic)", area=25000, term=120, start=47.25, esc_type="percent", esc_rate=0.025, esc_amt=0, esc_every=12,
         free=8, round=1, ti=85.0, lc=400000, other=0, opex_type="gross", exp=15.0, growth=0.03, base=0, stop=0,
         add=0, upfront=0, downtime=0),
]
KEYS = "ABCD"


def fl_proposal(p: dict, perspective: str) -> dict:
    d = {
        "name": p["name"],
        "schedule": factlot_schedule(p),
        "ti_allowance_psf": p["ti"],
        "other_concessions": p["other"],
        "leasing_commissions": p["lc"],
        "additional_costs_psf_annual": p["add"],
        "tenant_upfront_costs": p["upfront"],
        "downtime_months": p["downtime"],
    }
    o = factlot_opex(p)
    if o:
        d["operating_expenses"] = o
    return d


def build() -> tuple[Workbook, Recon]:
    a = PROPOSALS[0]
    sched = run("calc_rent_schedule", {**factlot_schedule(a), "include_monthly": False})
    ner = run(
        "calc_net_effective_rent",
        {"schedule": factlot_schedule(a), "ti_allowance_psf": a["ti"], "leasing_commissions": a["lc"],
         "other_concessions": a["other"], "discount_rate_annual": DISCOUNT},
    )
    cmp_t = run("calc_compare_proposals", {"perspective": "tenant", "discount_rate_annual": DISCOUNT,
                                            "proposals": [fl_proposal(p, "tenant") for p in PROPOSALS]})
    cmp_l = run("calc_compare_proposals", {"perspective": "landlord", "discount_rate_annual": DISCOUNT,
                                            "proposals": [fl_proposal(p, "landlord") for p in PROPOSALS]})

    wb = Workbook("FactLot reconciliation: office lease (synthetic)")
    readme_sheet(
        wb,
        "Office lease proposals: rent schedule, net effective rent, compare_proposals",
        [
            "Four synthetic office proposals (different sizes, terms, escalations, free rent, TI and operating-expense structures: "
            "base year, NNN, expense stop, gross) are run through FactLot's calc_rent_schedule, calc_net_effective_rent and "
            "calc_compare_proposals (tenant and landlord views, with downtime).",
            "Each proposal has a month-by-month Excel sheet (Prop_A to Prop_D) built from live formulas. Reconcile compares every "
            "FactLot output (rent steps, totals, NER, the ranked metrics, total net cost and the ranking itself) with the Excel result.",
        ],
        [("calc_rent_schedule", sched), ("calc_net_effective_rent", ner), ("calc_compare_proposals (tenant)", cmp_t),
         ("calc_compare_proposals (landlord)", cmp_l)],
        CONVENTIONS,
        [
            "Ranking: tenant view ranks by lowest effective occupancy cost; landlord view by highest discounted NER. Rank in Excel is "
            "1 + the number of proposals that beat it (no ties in this data).",
            "The dates in the FactLot call (commencement 2027-01-01) do not enter any dollar figure; they only fix lease-month boundaries.",
        ],
    )
    refs, disc = inputs_grid(wb, PROPOSALS, DISCOUNT)
    res = []
    for j, p in enumerate(PROPOSALS):
        res.append(proposal_sheet(wb, f"Prop_{KEYS[j]}", f"Proposal {KEYS[j]}: {p['name']}", refs[j], disc, p["term"], p["downtime"]))

    # ---- Calc: lease A rent schedule steps and NER (reads Prop_A)
    calc = Calc(wb.sheet("Calc"), "Calc: proposal A rent schedule and net effective rent")
    A, ia = res[0], refs[0]
    rec = Recon(wb)
    rec.section("calc_rent_schedule (proposal A)")
    for st in sched["value"]["steps"]:
        row = A["dr"] + st["first_month"] - 1
        last = A["dr"] + st["last_month"] - 1
        pre = f"Step {st['step']} (months {st['first_month']}-{st['last_month']})"
        rec.add(f"{pre}: rent $/SF/yr", "$/SF/yr", f"=ROUND(Prop_A!D{row},4)", st["rent_psf_annual"], f"steps[{st['step']}].rent_psf_annual", "num4", 8)
        rec.add(f"{pre}: monthly rent", "USD", f"=Prop_A!E{row}", st["monthly_rent"], f"steps[{st['step']}].monthly_rent", "money", 8)
        rec.add(f"{pre}: abated months", "months", f"=SUM(Prop_A!F{row}:F{last})", st["abated_months"], f"steps[{st['step']}].abated_months", "int", 8)
    sv = sched["value"]
    rec.add("Total scheduled rent", "USD", f"=ROUND(SUM({A['scheduled']}),2)", sv["total_scheduled_rent"], "total_scheduled_rent")
    rec.add("Total abatement", "USD", f"=ROUND(ROUND(SUM({A['scheduled']}),2)-ROUND(SUM({A['rent_due']}),2),2)", sv["total_abatement"], "total_abatement")
    rec.add("Total rent due", "USD", f"=ROUND(SUM({A['rent_due']}),2)", sv["total_rent_due"], "total_rent_due")

    calc.section("Net effective rent, proposal A")
    years = calc.add("Term (years)", f"={ia['term']}/12", "num4")
    total = calc.add("Total rent due", f"=ROUND(SUM({A['rent_due']}),2)")
    ti = calc.add("TI allowance, total", f"=ROUND({ia['ti']}*{ia['area']},2)")
    costs = calc.add("Total landlord costs", f"=ROUND({ti}+{ia['lc']}+{ia['other']},2)")
    eff = calc.add("Effective rent $/SF/yr", f"=ROUND({total}/{ia['area']}/{years},4)", "num4")
    nerc = calc.add("Net effective rent (straight-line) $/SF/yr", f"=ROUND(({total}-{costs})/{ia['area']}/{years},4)", "num4")
    pv = calc.add("PV of rent (unrounded)", f"=SUMPRODUCT({A['rent_due']},{A['dfT']})", "money", "Month 1 at (1+r)^0: rent paid at the start of each month.")
    annuity = calc.add("Sum of discount factors", f"=SUM({A['dfT']})", "num8")
    pvr = calc.add("PV of rent", f"=ROUND({pv},2)")
    dner = calc.add("Discounted net effective rent $/SF/yr", f"=ROUND((({pv}-{costs})/{annuity})*12/{ia['area']},4)", "num4")
    nv = ner["value"]
    rec.section("calc_net_effective_rent (proposal A)")
    rec.add("Effective rent", "$/SF/yr", f"={eff}", nv["effective_rent_psf"], "effective_rent_psf", "num4")
    rec.add("Net effective rent (straight-line)", "$/SF/yr", f"={nerc}", nv["net_effective_rent_psf"], "net_effective_rent_psf", "num4")
    rec.add("Discounted net effective rent", "$/SF/yr", f"={dner}", nv["discounted_net_effective_rent_psf"], "discounted_net_effective_rent_psf", "num4")
    rec.add("Total rent due", "USD", f"={total}", nv["total_rent_due"], "total_rent_due")
    rec.add("Total landlord costs", "USD", f"={costs}", nv["total_landlord_costs"], "total_landlord_costs")
    rec.add("PV of rent", "USD", f"={pvr}", nv["pv_rent"], "pv_rent")

    # ---- comparison summary with explicit ranks
    cs = Calc(wb.sheet("Compare"), "Compare: ranking in Excel")
    cs.sh.width(2, 24)

    def ranking(label: str, key_metric: str, key_total: str, cmp: dict, lower_better: bool, field: str) -> None:
        cs.section(label)
        metric_refs = [r[key_metric] for r in res]
        ranks = []
        for j, p in enumerate(PROPOSALS):
            others = [m for k, m in enumerate(metric_refs) if k != j]
            op = "<" if lower_better else ">"
            expr = "+".join(f"IF({m}{op}{metric_refs[j]},1,0)" for m in others)
            ranks.append(cs.add(f"Rank of {p['name']}", f"=1+{expr}", "int"))
        best = ""
        for j in reversed(range(len(PROPOSALS))):
            best = f'IF({ranks[j]}=1,{refs[j]["name"] if "name" in refs[j] else repr(PROPOSALS[j]["name"])},{best or chr(34) + chr(34)})'
        best_ref = cs.add("Best proposal", "=" + best, "default")
        rec.section(f"calc_compare_proposals, {label}")
        for row in cmp["value"]["ranking"]:
            j = next(k for k, p in enumerate(PROPOSALS) if p["name"] == row["name"])
            nm = row["name"]
            rec.add(f"{nm}: rank", "rank", f"={ranks[j]}", row["rank"], "ranking[].rank", "int")
            rec.add(f"{nm}: {field}", "$/SF/yr", f"={res[j][key_metric]}", row["metric_psf_annual"], "ranking[].metric_psf_annual", "num4")
            rec.add(f"{nm}: total net", "USD", f"={res[j][key_total]}", row["total_net"], "ranking[].total_net")
        rec.add("Best proposal", "name", f"={best_ref}", cmp["value"]["best"], "best", "text")

    # names are not on the Inputs rows (they are the column headers): point at the header cells
    for j in range(len(PROPOSALS)):
        refs[j]["name"] = f"Inputs!${chr(66 + j)}$6"
    ranking("tenant view", "tenant_metric", "tenant_total", cmp_t, True, "effective occupancy cost")
    ranking("landlord view", "landlord_metric", "landlord_total", cmp_l, False, "discounted NER")

    rec.finish()
    return wb, rec
