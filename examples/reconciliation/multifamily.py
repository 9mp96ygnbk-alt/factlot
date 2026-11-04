"""Multifamily-adjacent: a value-add hold priced with calc_npv and calc_irr.

FactLot has no multifamily-specific calculator, so this uses the two general ones on a synthetic
hold. The cash-flow build (NOI, exit value, costs) is plain Excel; FactLot discounts and solves.
"""

from __future__ import annotations

from common import Calc, Inputs, Recon, readme_sheet, run
from xlsx_lite import Workbook

FILENAME = "multifamily-value-add-npv-irr.xlsx"

# SYNTHETIC 180-unit value-add hold, annual. All figures invented.
PRICE = 27_000_000
CLOSING_COST_RATE = 0.012
CAPEX = 1_800_000
NOI = [1_420_000, 1_610_000, 1_830_000, 1_950_000, 2_010_000]
NOI_YEAR6 = 2_075_000
EXIT_CAP = 0.0525
COST_OF_SALE = 0.015
DISCOUNT = 0.085

# SYNTHETIC quarterly bridge hold (8 quarters), to show annualizing a periodic IRR.
Q_EQUITY = 9_400_000
Q_CF = [-120_000, -95_000, 60_000, 150_000, 205_000, 240_000, 265_000, 280_000]
Q_EXIT = 11_250_000
Q_DISCOUNT_QUARTERLY = 0.02

CONVENTIONS = [
    "FactLot's NPV discounts every flow, including the first: NPV = sum of CF_t / (1 + r)^t for t = 0, 1, 2, ... so the t = 0 flow is NOT discounted. "
    "Excel's NPV() discounts its first argument by one full period, so the Excel formula is CF_0 + NPV(r, CF_1:CF_n). "
    "Using =NPV(r, CF_0:CF_n) alone would give a different (wrong for this convention) number.",
    "The rate must match the period: pass 0.02 for a 2% quarterly rate; FactLot does not convert an annual rate for you.",
    "IRR: FactLot scans periodic rates from -99.99% to 1000% for sign changes, bisects to 1e-12, and returns the root nearest zero (all roots are listed). "
    "Annualized IRR = (1 + periodic IRR)^periods_per_year - 1 (compounding, not periodic x 4). Excel's IRR() is an iterative solver with its own "
    "tolerance (0.00001 percent), so the IRR rows are reconciled at 5 decimals, and the stronger check is that the net present value at FactLot's IRR is 0.00.",
    "Dollar results are rounded to cents; rates to 8 decimals.",
    "The NOI projection, exit value and costs on the Calc sheet are ordinary Excel arithmetic written for this example; they are not FactLot outputs.",
]


def build() -> tuple[Workbook, Recon]:
    closing = round(PRICE * CLOSING_COST_RATE, 2)
    exit_value = NOI_YEAR6 / EXIT_CAP * (1 - COST_OF_SALE)
    flows = [-(PRICE + closing + CAPEX)] + NOI[:4] + [NOI[4] + exit_value]
    flows = [round(x, 2) for x in flows]
    npv = run("calc_npv", {"cash_flows": flows, "rate": DISCOUNT})
    irr = run("calc_irr", {"cash_flows": flows, "periods_per_year": 1})
    qflows = [-Q_EQUITY] + Q_CF[:-1] + [Q_CF[-1] + Q_EXIT]
    npv_q = run("calc_npv", {"cash_flows": qflows, "rate": Q_DISCOUNT_QUARTERLY})
    irr_q = run("calc_irr", {"cash_flows": qflows, "periods_per_year": 4})

    wb = Workbook("FactLot reconciliation: multifamily value-add hold (synthetic)")
    readme_sheet(
        wb,
        "Multifamily-adjacent: value-add hold, NPV and IRR",
        [
            "FactLot has no multifamily-specific calculator, so this workbook uses what exists: calc_npv and calc_irr on a synthetic "
            "180-unit value-add hold (annual) and a synthetic 8-quarter bridge hold (quarterly, annualized).",
            "The cash-flow build is ordinary Excel; FactLot discounts it and solves the IRR. If you need unit-mix rent rolls, "
            "loan sizing for the acquisition or lease accounting, see the lender and lease-accounting workbooks. "
            "There is no multifamily calculator today; this example shows what the general ones cover.",
        ],
        [("calc_npv", npv), ("calc_irr", irr)],
        CONVENTIONS,
    )
    inp = Inputs(wb.sheet("Inputs"), "Inputs: annual hold")
    price = inp.add("Purchase price (USD)", PRICE, "in_money")
    cc = inp.add("Closing costs, share of price", CLOSING_COST_RATE, "in_pct")
    capex = inp.add("Renovation capex at close (USD)", CAPEX, "in_money")
    noi = [inp.add(f"NOI, year {i + 1} (USD)", v, "in_money") for i, v in enumerate(NOI)]
    noi6 = inp.add("NOI, year 6 (USD), for the exit value", NOI_YEAR6, "in_money")
    cap = inp.add("Exit cap rate", EXIT_CAP, "in_pct")
    cos = inp.add("Cost of sale, share of price", COST_OF_SALE, "in_pct")
    disc = inp.add("Discount rate, annual", DISCOUNT, "in_pct")
    inp.section("Quarterly bridge hold")
    qeq = inp.add("Equity invested at t = 0 (USD)", Q_EQUITY, "in_money")
    qcf = [inp.add(f"Quarter {i + 1} cash flow (USD)", v, "in_money") for i, v in enumerate(Q_CF)]
    qex = inp.add("Exit proceeds in quarter 8 (USD)", Q_EXIT, "in_money")
    qd = inp.add("Discount rate per QUARTER", Q_DISCOUNT_QUARTERLY, "in_pct")

    calc = Calc(wb.sheet("Calc"), "Calc: cash flows, NPV and IRR in Excel")
    calc.sh.width(3, 60)
    calc.section("Annual hold: cash-flow build")
    cl = calc.add("Closing costs", f"=ROUND({price}*{cc},2)")
    sale = calc.add("Net sale proceeds, year 5", f"={noi6}/{cap}*(1-{cos})", "money", "Year-6 NOI / exit cap, less cost of sale. Unrounded here; the year-5 flow is rounded below.")
    cfs = [calc.add("Year 0 cash flow", f"=ROUND(-({price}+{cl}+{capex}),2)")]
    for i in range(4):
        cfs.append(calc.add(f"Year {i + 1} cash flow", f"=ROUND({noi[i]},2)"))
    cfs.append(calc.add("Year 5 cash flow (NOI + sale)", f"=ROUND({noi[4]}+{sale},2)"))
    first, last = cfs[0].split("!")[1].replace("$", ""), cfs[-1].split("!")[1].replace("$", "")
    rng = f"Calc!${first[0]}${first[1:]}:${last[0]}${last[1:]}"
    rest = f"Calc!$B${int(first[1:]) + 1}:$B${int(last[1:])}"
    npv_x = calc.add("NPV (t = 0 not discounted)", f"=ROUND({cfs[0]}+NPV({disc},{rest}),2)", "money", "CF_0 + NPV(r, CF_1:CF_5): the Excel form of FactLot's convention.")
    irr_x = calc.add("IRR (Excel IRR)", f"=IRR({rng})", "num8")
    irr_ann = calc.add("IRR, annualized (1 period per year)", f"=(1+{irr_x})^1-1", "num8")
    # NPV at FactLot's IRR must be ~0; FactLot's recorded IRR is referenced from the Reconcile sheet below.
    calc.section("Quarterly bridge hold")
    qcfs = [calc.add("Quarter 0 cash flow", f"=-{qeq}")]
    for i in range(7):
        qcfs.append(calc.add(f"Quarter {i + 1} cash flow", f"={qcf[i]}"))
    qcfs.append(calc.add("Quarter 8 cash flow (cash flow + exit)", f"={qcf[7]}+{qex}"))
    qf, ql = qcfs[0].split("!")[1].replace("$", ""), qcfs[-1].split("!")[1].replace("$", "")
    qrng = f"Calc!$B${qf[1:]}:$B${ql[1:]}"
    qrest = f"Calc!$B${int(qf[1:]) + 1}:$B${int(ql[1:])}"
    qnpv = calc.add("NPV at the quarterly rate (t = 0 not discounted)", f"=ROUND({qcfs[0]}+NPV({qd},{qrest}),2)")
    qirr = calc.add("Quarterly IRR (Excel IRR)", f"=IRR({qrng})", "num8")
    qann = calc.add("IRR, annualized (compounded x 4)", f"=(1+{qirr})^4-1", "num8")

    rec = Recon(wb)
    nv, iv = npv["value"], irr["value"]
    rec.section("calc_npv and calc_irr: annual hold")
    rec.add("NPV", "USD", f"={npv_x}", nv["npv"], "npv")
    rec.add("IRR (periodic = annual)", "rate", f"={irr_x}", iv["irr_periodic"], "irr_periodic", "num8", 5, "Excel IRR is iterative.")
    rec.add("IRR annualized", "rate", f"={irr_ann}", iv["irr_annual"], "irr_annual", "num8", 5)
    rec.add("NPV of the cash flows at FactLot's IRR (should be 0.00)", "USD",
            f"=ROUND({cfs[0]}+NPV({iv['irr_periodic']},{rest}),0)", 0, "irr_periodic (check)", "money", 0,
            "Strongest check: discounting at FactLot's IRR zeroes the flows to the nearest dollar.")
    qv, qiv = npv_q["value"], irr_q["value"]
    rec.section("calc_npv and calc_irr: quarterly bridge hold")
    rec.add("NPV at the quarterly rate", "USD", f"={qnpv}", qv["npv"], "npv")
    rec.add("IRR per quarter", "rate", f"={qirr}", qiv["irr_periodic"], "irr_periodic", "num8", 5)
    rec.add("IRR annualized, (1 + quarterly)^4 - 1", "rate", f"={qann}", qiv["irr_annual"], "irr_annual", "num8", 5)
    rec.add("NPV of the quarterly flows at FactLot's IRR (should be 0.00)", "USD",
            f"=ROUND({qcfs[0]}+NPV({qiv['irr_periodic']},{qrest}),0)", 0, "irr_periodic (check)", "money", 0)
    rec.finish()
    return wb, rec
