"""Industrial: rent schedule with percent and fixed-dollar bumps, net effective rent, and WALT of a rent roll."""

from __future__ import annotations

from common import Calc, Recon, readme_sheet, run
from rent_model import CONVENTIONS, factlot_schedule, inputs_grid, proposal_sheet
from xlsx_lite import Workbook, excel_serial

FILENAME = "industrial-lease-and-walt.xlsx"
DISCOUNT = 0.07
AS_OF = "2027-01-01"

# SYNTHETIC leases; every figure is invented.
LEASES = [
    dict(name="Distribution lease (synthetic)", area=120000, term=84, start=8.4, esc_type="percent", esc_rate=0.035, esc_amt=0, esc_every=12,
         free=3, round=0, ti=4.0, lc=265000, other=0, opex_type="nnn", exp=2.1, growth=0.03, base=0, stop=0,
         add=0, upfront=0, downtime=0, date="2027-04-01"),
    dict(name="Flex lease (synthetic)", area=45000, term=60, start=11.75, esc_type="fixed_psf", esc_rate=0, esc_amt=0.5, esc_every=24,
         free=2, round=1, ti=9.5, lc=90000, other=25000, opex_type="nnn", exp=3.4, growth=0.03, base=0, stop=0,
         add=0, upfront=0, downtime=0, date="2027-02-01"),
]
KEYS = "AB"

# SYNTHETIC rent roll: (id, expiration, area_sf, annual_rent). The first row expired before AS_OF.
ROLL = [
    ("Tenant 1", "2026-09-30", 18000, 144000.00),
    ("Tenant 2", "2027-07-31", 40000, 340000.00),
    ("Tenant 3", "2029-03-31", 120000, 1020000.00),
    ("Tenant 4", "2031-12-31", 65000, 585000.00),
    ("Tenant 5", "2028-01-15", 22500, 213750.00),
    ("Tenant 6", "2034-06-30", 80000, 736000.00),
]


def build() -> tuple[Workbook, Recon]:
    scheds, ners = [], []
    for p in LEASES:
        scheds.append(run("calc_rent_schedule", factlot_schedule(p)))
        ners.append(run("calc_net_effective_rent", {"schedule": factlot_schedule(p), "ti_allowance_psf": p["ti"],
                                                   "leasing_commissions": p["lc"], "other_concessions": p["other"],
                                                   "discount_rate_annual": DISCOUNT}))
    leases = [{"id": i, "expiration_date": e, "area_sf": a, "annual_rent": r} for i, e, a, r in ROLL]
    walt_area = run("calc_walt", {"as_of": AS_OF, "weight_by": "area", "leases": leases})
    walt_rent = run("calc_walt", {"as_of": AS_OF, "weight_by": "rent", "leases": leases})

    wb = Workbook("FactLot reconciliation: industrial lease and WALT (synthetic)")
    readme_sheet(
        wb,
        "Industrial: rent schedule, net effective rent and WALT",
        [
            "Two synthetic industrial leases (a 7-year distribution lease with 3.5% compounding bumps and a 5-year flex lease with "
            "$0.50/SF bumps every 24 months) go through calc_rent_schedule and calc_net_effective_rent.",
            "A synthetic six-tenant rent roll goes through calc_walt, weighted by area and by rent.",
        ],
        [("calc_rent_schedule", scheds[0]), ("calc_net_effective_rent", ners[0]), ("calc_walt", walt_area)],
        CONVENTIONS + [
            "WALT = sum(weight x years remaining) / sum(weight); years remaining = MAX(0, (expiration - as-of) in actual days / 365.25). "
            "An already expired lease counts zero years but keeps its weight. Rounded to 4 decimals.",
        ],
        ["Operating-expense rows on the Inputs sheet are carried for context; the rent schedule and NER do not use them (use the office workbook for compare_proposals)."],
    )
    refs, disc = inputs_grid(wb, LEASES, DISCOUNT)
    res = [proposal_sheet(wb, f"Lease_{KEYS[j]}", f"Lease {KEYS[j]}: {p['name']}", refs[j], disc, p["term"], 0) for j, p in enumerate(LEASES)]

    calc = Calc(wb.sheet("Calc"), "Calc: net effective rent per lease")
    rec = Recon(wb)
    for j, p in enumerate(LEASES):
        S, I, sv, nv = res[j], refs[j], scheds[j]["value"], ners[j]["value"]
        sn = S["sheet"].name
        rec.section(f"calc_rent_schedule: {p['name']}")
        for st in sv["steps"]:
            row = S["dr"] + st["first_month"] - 1
            last = S["dr"] + st["last_month"] - 1
            pre = f"Step {st['step']} (months {st['first_month']}-{st['last_month']})"
            rec.add(f"{pre}: rent $/SF/yr", "$/SF/yr", f"=ROUND({sn}!D{row},4)", st["rent_psf_annual"], f"steps[{st['step']}].rent_psf_annual", "num4")
            rec.add(f"{pre}: monthly rent", "USD", f"={sn}!E{row}", st["monthly_rent"], f"steps[{st['step']}].monthly_rent")
            rec.add(f"{pre}: abated months", "months", f"=SUM({sn}!F{row}:F{last})", st["abated_months"], f"steps[{st['step']}].abated_months", "int")
        rec.add("Total scheduled rent", "USD", f"=ROUND(SUM({S['scheduled']}),2)", sv["total_scheduled_rent"], "total_scheduled_rent")
        rec.add("Total abatement", "USD", f"=ROUND(ROUND(SUM({S['scheduled']}),2)-ROUND(SUM({S['rent_due']}),2),2)", sv["total_abatement"], "total_abatement")
        rec.add("Total rent due", "USD", f"=ROUND(SUM({S['rent_due']}),2)", sv["total_rent_due"], "total_rent_due")

        calc.section(f"Net effective rent: {p['name']}")
        years = calc.add("Term (years)", f"={I['term']}/12", "num4")
        total = calc.add("Total rent due", f"=ROUND(SUM({S['rent_due']}),2)")
        ti = calc.add("TI allowance, total", f"=ROUND({I['ti']}*{I['area']},2)")
        costs = calc.add("Total landlord costs", f"=ROUND({ti}+{I['lc']}+{I['other']},2)")
        eff = calc.add("Effective rent $/SF/yr", f"=ROUND({total}/{I['area']}/{years},4)", "num4")
        nerc = calc.add("Net effective rent (straight-line)", f"=ROUND(({total}-{costs})/{I['area']}/{years},4)", "num4")
        pv = calc.add("PV of rent (unrounded)", f"=SUMPRODUCT({S['rent_due']},{S['dfT']})")
        annuity = calc.add("Sum of discount factors", f"=SUM({S['dfT']})", "num8")
        dner = calc.add("Discounted net effective rent", f"=ROUND((({pv}-{costs})/{annuity})*12/{I['area']},4)", "num4")
        rec.section(f"calc_net_effective_rent: {p['name']}")
        rec.add("Effective rent", "$/SF/yr", f"={eff}", nv["effective_rent_psf"], "effective_rent_psf", "num4")
        rec.add("Net effective rent (straight-line)", "$/SF/yr", f"={nerc}", nv["net_effective_rent_psf"], "net_effective_rent_psf", "num4")
        rec.add("Discounted net effective rent", "$/SF/yr", f"={dner}", nv["discounted_net_effective_rent_psf"], "discounted_net_effective_rent_psf", "num4")
        rec.add("Total landlord costs", "USD", f"={costs}", nv["total_landlord_costs"], "total_landlord_costs")
        rec.add("PV of rent", "USD", f"=ROUND({pv},2)", nv["pv_rent"], "pv_rent")

    # ---- WALT sheet
    w = wb.sheet("Walt")
    for c, wd in zip(range(1, 8), (16, 16, 14, 16, 18, 14, 14)):
        w.width(c, wd)
    w.put(1, 1, "WALT of a synthetic rent roll", "title")
    w.put(2, 1, "SYNTHETIC. As-of date and every row are blue inputs.", "warn")
    w.put(3, 1, "As-of date", "text")
    asof = w.put(3, 2, excel_serial(AS_OF), "in_date")
    for c, h in enumerate(("Tenant", "Expiration", "Area SF", "Annual rent", "Years remaining", "Expired (1/0)"), 1):
        w.put(5, c, h, "header")
    r0 = 6
    for k, (tid, exp, area, rent) in enumerate(ROLL):
        r = r0 + k
        w.put(r, 1, tid, "in_text")
        w.put(r, 2, excel_serial(exp), "in_date")
        w.put(r, 3, area, "in_int")
        w.put(r, 4, rent, "in_money")
        w.put(r, 5, f"=MAX(0,(B{r}-{asof})/365.25)", "num8")
        w.put(r, 6, f"=IF(E{r}=0,1,0)", "int")
    r1 = r0 + len(ROLL) - 1
    base = r1 + 2
    w.put(base, 1, "Total area", "text")
    w.put(base, 2, f"=ROUND(SUM(C{r0}:C{r1}),2)", "money")
    w.put(base + 1, 1, "Total rent", "text")
    w.put(base + 1, 2, f"=ROUND(SUM(D{r0}:D{r1}),2)", "money")
    w.put(base + 2, 1, "WALT by area (years)", "text")
    w.put(base + 2, 2, f"=ROUND(SUMPRODUCT(C{r0}:C{r1},E{r0}:E{r1})/SUM(C{r0}:C{r1}),4)", "num4")
    w.put(base + 3, 1, "WALT by rent (years)", "text")
    w.put(base + 3, 2, f"=ROUND(SUMPRODUCT(D{r0}:D{r1},E{r0}:E{r1})/SUM(D{r0}:D{r1}),4)", "num4")
    w.put(base + 4, 1, "Expired leases", "text")
    w.put(base + 4, 2, f"=SUM(F{r0}:F{r1})", "int")
    rec.section("calc_walt (weighted by area)")
    rec.add("WALT", "years", f"=Walt!$B${base + 2}", walt_area["value"]["walt_years"], "walt_years", "num4")
    rec.add("Total weight (SF)", "SF", f"=Walt!$B${base}", walt_area["value"]["total_weight"], "total_weight")
    rec.add("Expired leases", "count", f"=Walt!$B${base + 4}", walt_area["value"]["expired_count"], "expired_count", "int")
    rec.section("calc_walt (weighted by rent)")
    rec.add("WALT", "years", f"=Walt!$B${base + 3}", walt_rent["value"]["walt_years"], "walt_years", "num4")
    rec.add("Total weight (USD)", "USD", f"=Walt!$B${base + 1}", walt_rent["value"]["total_weight"], "total_weight")
    rec.add("Expired leases", "count", f"=Walt!$B${base + 4}", walt_rent["value"]["expired_count"], "expired_count", "int")
    rec.finish()
    return wb, rec
