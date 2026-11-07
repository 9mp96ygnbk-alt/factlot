/**
 * @factlot/calc — deterministic, traceable CRE calculators.
 *
 * Agents should never do lease or loan math in-context. Every function here is
 * pure, validates its input, and returns the answer with a step-by-step trace and
 * a versioned formula ID that can be cited in a FactLot `computed` fact.
 */
import type { z } from "zod";

import {
  AmortizationScheduleInput,
  amortizationSchedule,
} from "./amortization.ts";
import { LeaseRemeasurementInput, leaseRemeasurementAsc842 } from "./asc842.ts";
import { CamReconciliationInput, camReconciliation } from "./cam.ts";
import {
  CamReconciliationBatchInput,
  camReconciliationBatch,
} from "./cam_batch.ts";
import { CapexRecoveryInput, capexRecovery } from "./capex.ts";
import { CriticalDatesInput, criticalDates } from "./critical_dates.ts";
import type { CalcResult } from "./core.ts";
import { DcfProFormaInput, dcfProForma } from "./dcf.ts";
import { DebtSizingInput, debtSizing } from "./debt.ts";
import { DirectCapInput, directCap } from "./direct_cap.ts";
import { Exchange1031Input, exchange1031 } from "./exchange_1031.ts";
import { IrrInput, NpvInput, irr, npv } from "./finance.ts";
import { HotelMetricsInput, hotelMetrics } from "./hotel.ts";
import { LeaseVsOwnInput, leaseVsOwn } from "./lease_vs_own.ts";
import {
  MultifamilyRentRollInput,
  multifamilyRentRoll,
} from "./multifamily.ts";
import { WaltInput, walt } from "./portfolio.ts";
import { PrepaymentInput, prepaymentAndDefeasance } from "./prepayment.ts";
import { ProposalComparisonInput, compareProposals } from "./proposals.ts";
import { RenewVsRelocateInput, renewVsRelocate } from "./renew_vs_relocate.ts";
import { ReconcileCamInput, reconcileCam } from "./reconcile_cam.ts";
import { ReconcileDcfInput, reconcileDcf } from "./reconcile_dcf.ts";
import { PercentageRentInput, percentageRent } from "./retail.ts";
import {
  NetEffectiveRentInput,
  RentScheduleInput,
  netEffectiveRent,
  rentSchedule,
} from "./rent.ts";
import {
  TxUnequalAppraisalInput,
  txUnequalAppraisal,
} from "./tx_unequal_appraisal.ts";
import { EquityWaterfallInput, equityWaterfall } from "./waterfall.ts";

export * from "./amortization.ts";
export * from "./asc842.ts";
export * from "./cam.ts";
export * from "./cam_batch.ts";
export * from "./capex.ts";
export * from "./core.ts";
export * from "./critical_dates.ts";
export * from "./dates.ts";
export * from "./dcf.ts";
export * from "./debt.ts";
export * from "./direct_cap.ts";
export * from "./exchange_1031.ts";
export * from "./finance.ts";
export * from "./hotel.ts";
export * from "./lease_vs_own.ts";
export * from "./multifamily.ts";
export * from "./portfolio.ts";
export * from "./prepayment.ts";
export * from "./proposals.ts";
export * from "./reconcile_cam.ts";
export * from "./reconcile_dcf.ts";
export * from "./renew_vs_relocate.ts";
export * from "./retail.ts";
export * from "./rules.ts";
export * from "./rules-drafts/index.ts";
export * from "./rent.ts";
export * from "./tx_unequal_appraisal.ts";
export * from "./waterfall.ts";
export * from "./units.ts";

export interface Calculator {
  id: string;
  version: number;
  title: string;
  description: string;
  input: z.ZodType;
  run: (input: never) => CalcResult<unknown>;
}

/** Registry of every calculator, for tool servers and docs generators. */
export const calculators = {
  rent_schedule: {
    id: "calc.rent_schedule",
    version: 1,
    title: "Lease rent schedule",
    description:
      "Build a base-rent schedule from commencement date, term, area, starting $/SF/yr, escalations (percent or fixed $/SF), and abated months. Lease months run from the commencement day-of-month with no calendar proration (warns when commencement is mid-month). Returns rent steps, totals, expiration date, and a calculation trace. Optional unit (kw, mw, unit, acre, key, room, space) relabels area and $/SF for data-center, ground, yard, residential, hotel, or parking leases without changing any number.",
    input: RentScheduleInput,
    run: rentSchedule,
  },
  net_effective_rent: {
    id: "calc.net_effective_rent",
    version: 1,
    title: "Net effective rent (NER)",
    description:
      "Compute effective rent, straight-line net effective rent, and discounted net effective rent ($/SF/yr) after free rent, TI allowance, leasing commissions, and other landlord concessions. Rent is monthly in advance from the commencement day (no calendar proration), discounted at annual rate ÷ 12. schedule.unit (kw, mw, unit, acre, key, room, space) reports $/kW/yr, $/acre/yr and so on instead of $/SF/yr.",
    input: NetEffectiveRentInput,
    run: netEffectiveRent,
  },
  compare_proposals: {
    id: "calc.compare_proposals",
    version: 2,
    title: "Compare lease proposals",
    description:
      "Rank 2–20 lease proposals with different terms, sizes, free rent, TI, concessions, and operating-expense structures (gross, NNN, base year, expense stop, with opex growth) on one discounted $/SF/yr basis, per rentable or usable SF (load factor): effective occupancy cost (tenant perspective) or discounted net effective rent after landlord-borne opex and optional pre-commencement downtime (landlord perspective). Cash flows monthly in advance at annual rate ÷ 12; warns when the usable-SF ranking differs and when terms differ. schedule.unit (kw, mw, unit, acre, key, room, space, the same for every proposal) ranks per kW, MW, unit, acre, key, room, or space instead of per SF.",
    input: ProposalComparisonInput,
    run: compareProposals,
  },
  multifamily_rent_roll: {
    id: "calc.multifamily_rent_roll",
    version: 1,
    title: "Multifamily rent roll",
    description:
      "Analyze an apartment rent roll (up to 5,000 units with status occupied, notice, vacant, model, or down; market and lease rent per month; lease dates; concessions as weeks free, months free, or dollars): gross potential rent, vacancy, non-revenue units, loss to lease, concessions amortised straight-line over each lease term, effective rent income, physical and economic occupancy, effective rent per unit and per SF, a lease expiration schedule by month, and a per-unit-type summary. Single-lease mode (lease instead of units) returns the effective monthly rent after a weeks-free or months-free concession.",
    input: MultifamilyRentRollInput,
    run: multifamilyRentRoll,
  },
  percentage_rent: {
    id: "calc.percentage_rent",
    version: 1,
    title: "Retail percentage rent",
    description:
      "Percentage (overage) rent for a lease year: net sales after exclusions over a natural or fixed breakpoint, prorated for partial years, less amounts already paid.",
    input: PercentageRentInput,
    run: percentageRent,
  },
  cam_reconciliation: {
    id: "calc.cam_reconciliation",
    version: 2,
    title: "CAM / operating expense reconciliation",
    description:
      "Reconcile a tenant's annual CAM charge: exclusions, occupancy gross-up of variable expenses, pro rata share, controllable-expense caps (compounding_from_base, simple_from_base, year_over_year), an admin fee (before or after the cap, inside or outside it, with per-line exclusions), base year or expense stop, partial-year occupancy (move-in/move-out prorates share, cap, and base by days), and estimates paid. Returns balance due and a full trace with order-of-operations warnings.",
    input: CamReconciliationInput,
    run: camReconciliation,
  },
  cam_reconciliation_batch: {
    id: "calc.cam_reconciliation_batch",
    version: 1,
    title: "CAM reconciliation for every tenant (batch)",
    description:
      "Reconcile CAM for a whole building in one call: the expense pool and gross-up once, then up to 500 tenants each with share, base year or expense stop, cap, admin fee, occupancy, estimates paid, and lease-specific excluded categories. Returns each tenant's statement (identical to calc_cam_reconciliation for that tenant, with its trace and warnings) and a building reconciliation: total billed against the recoverable pool, the unrecovered amount, and why (unleased or vacant share, lease exclusions, gross-up, caps, base years and stops, admin fees, zero floor, rounding).",
    input: CamReconciliationBatchInput,
    run: camReconciliationBatch,
  },
  capex_recovery: {
    id: "calc.capex_recovery",
    version: 1,
    title: "Capital expenditure recovery",
    description:
      "Recoverable capital expenditure under a lease clause: amortize a capital cost over its useful life or the lease-specified period, straight-line (declining interest) or level payment, with interest on the unamortized balance or none; optionally cap each year's recovery at demonstrated cost savings (with or without carry-forward); and allocate each year to tenants by pro rata share. Every assumption is echoed with an optional lease clause citation.",
    input: CapexRecoveryInput,
    run: capexRecovery,
  },
  debt_sizing: {
    id: "calc.debt_sizing",
    version: 3,
    title: "Loan sizing (LTV / DSCR / debt yield)",
    description:
      "Size the maximum loan under any combination of max LTV, min DSCR, and min debt yield for a given NOI, rate, and amortization. Reports the binding constraint, debt service, and resulting metrics; optionally a stress table over NOI, rate, and value shocks (max loan, binding constraint, LTV, DSCR, debt yield per scenario) and the refinance shortfall against an existing loan balance.",
    input: DebtSizingInput,
    run: debtSizing,
  },
  lease_remeasurement_asc842: {
    id: "calc.lease_remeasurement_asc842",
    version: 2,
    title: "Lease remeasurement (ASC 842, lessee)",
    description:
      "Remeasure a lessee's lease liability and right-of-use asset under ASC 842 after a modification, lease-term reassessment, contingency resolution, or residual value guarantee change: new liability (PV of remaining payments), liability and ROU adjustments with any gain (ASC 842-20-35-4), and the per-period amortization table (operating: straight-line single lease cost; finance: interest plus amortization) in cents that foots: every row rolls forward exactly, totals are the row sums, and the final period trues up liability and ROU asset to zero. Warns where judgment is needed.",
    input: LeaseRemeasurementInput,
    run: leaseRemeasurementAsc842,
  },
  prepayment_and_defeasance: {
    id: "calc.prepayment_and_defeasance",
    version: 1,
    title: "Loan prepayment premium and defeasance",
    description:
      "Prepayment premium, total payoff, and cost as a share of balance for a fixed-rate amortizing or interest-only loan under yield maintenance (PV of remaining payments or rate differential, with a minimum and an explicit discounting convention), a step-down schedule, a flat percentage, or defeasance (cost of the securities portfolio that funds the remaining payments plus stated costs).",
    input: PrepaymentInput,
    run: prepaymentAndDefeasance,
  },
  walt: {
    id: "calc.walt",
    version: 1,
    title: "Weighted average lease term (WALT)",
    description:
      'Weighted average remaining lease term in years as of a date (actual days ÷ 365.25), weighted by each lease\'s area_sf (weight_by "area") or annual_rent (weight_by "rent").',
    input: WaltInput,
    run: walt,
  },
  npv: {
    id: "calc.npv",
    version: 1,
    title: "Net present value",
    description:
      "NPV of periodic cash flows (t = 0, 1, 2, ...; the t = 0 flow is not discounted) at a per-period discount rate given as a decimal.",
    input: NpvInput,
    run: npv,
  },
  irr: {
    id: "calc.irr",
    version: 2,
    title: "Internal rate of return",
    description:
      "Periodic and annualized IRR of periodic cash flows, as decimals (0.085 = 8.5%), solved deterministically by scanning a 1-point grid of per-period rates and bisecting each sign change; reports every root it finds when cash flows have multiple IRRs (two roots within one grid step can be missed). Errors when the flows do not change sign or no root lies between -99.99% and 1000% per period.",
    input: IrrInput,
    run: irr,
  },
  lease_vs_own: {
    id: "calc.lease_vs_own",
    version: 2,
    title: "Lease vs. own",
    description:
      "Compare leasing with buying over a fixed horizon: NPV of each case's annual cash costs (rent, free rent, tenant expenses, and move-in costs versus equity, debt service, owner expenses, reserves, and a sale at the horizon by stated value or exit cap rate), optionally after tax, with the year-by-year tables and the break-even residual value at which owning equals leasing.",
    input: LeaseVsOwnInput,
    run: leaseVsOwn,
  },
  renew_vs_relocate: {
    id: "calc.renew_vs_relocate",
    version: 2,
    title: "Renew vs. relocate",
    description:
      "Compare renewing in place with moving over one horizon: NPV and discounted effective rent of each case (rent schedule with free rent, TI net of allowance, fees, moving, downtime, double rent, termination, and disruption costs), the starting rent at which they break even, and year-by-year cash flows.",
    input: RenewVsRelocateInput,
    run: renewVsRelocate,
  },
  hotel_metrics: {
    id: "calc.hotel_metrics",
    version: 1,
    title: "Hotel operating metrics (USALI)",
    description:
      "Occupancy, ADR, RevPAR, TRevPAR, and a USALI-style profit ladder for a period: departmental profit, GOP and margin, GOPPAR, management fees, EBITDA, FF&E reserve, and NOI (EBITDA less replacement reserve).",
    input: HotelMetricsInput,
    run: hotelMetrics,
  },
  dcf_pro_forma: {
    id: "calc.dcf_pro_forma",
    version: 2,
    title: "Property DCF from a rent roll",
    description:
      "Property-level discounted cash flow from an in-place rent roll: each lease's rent, escalations, remaining term, and expense recovery (NNN, gross, base year), then at expiration one blended lease weighted by the renewal probability (renewal vs new-tenant rent, free rent, TI, leasing commissions, and new-tenant downtime, with fractional downtime and free rent kept as part months rather than rounded); market rent growth, general vacancy and credit loss, operating expenses, management fee, and capital reserves. Returns the annual cash-flow table (NOI and cash flow before debt) for the hold plus one year, the exit value at a cap rate on forward (or trailing) NOI less selling costs, the value (PV at the discount rate, end-of-year or mid-year), and with a purchase price the NPV, unlevered IRR, and equity multiple, with every lease event and convention stated.",
    input: DcfProFormaInput,
    run: dcfProForma,
  },
  direct_cap: {
    id: "calc.direct_cap",
    version: 1,
    title: "Direct capitalization value and implied cap rate",
    description:
      "Value by direct capitalization: (NOI − capital reserve) ÷ cap rate, then below-the-line deductions for lease-up costs, free-rent burn-off, and other adjustments to an as-is value (optionally rounded); and the cap rate a price implies, before and after reserves and all-in after the below-the-line costs. Records the NOI basis (trailing, forward, stabilized).",
    input: DirectCapInput,
    run: directCap,
  },
  amortization_schedule: {
    id: "calc.amortization_schedule",
    version: 1,
    title: "Loan amortization schedule",
    description:
      "Period-by-period schedule of a fixed-rate loan, monthly or quarterly: an optional interest-only period, then level payments on an amortization term that can run past maturity (balloon), with 30/360, actual/360, or actual/365 interest (the payment on a 30/360 basis). Rows are in cents that foot: interest is rounded each period, the final payment repays the whole balance, and the totals are the row sums.",
    input: AmortizationScheduleInput,
    run: amortizationSchedule,
  },
  equity_waterfall: {
    id: "calc.equity_waterfall",
    version: 1,
    title: "LP/GP equity distribution waterfall",
    description:
      "Split periodic project equity cash flows between LP and GP: preferred return (compounding or simple) and return of capital pro rata to capital in either order, an optional GP catch-up, IRR-hurdle tiers with promote splits measured on the LP's IRR, and a residual split. Returns per-period LP and GP contributions and distributions (with the GP's promote) that foot to the cent, and LP, GP, and project IRRs and multiples, with the conventions to confirm against the operating agreement.",
    input: EquityWaterfallInput,
    run: equityWaterfall,
  },
  exchange_1031: {
    id: "calc.exchange_1031",
    version: 2,
    title: "1031 exchange deadlines, identification, and boot",
    description:
      "Not tax advice: arithmetic only. The 45-day identification and 180-day exchange deadlines of IRC §1031(a)(3) (the exchange period ends earlier at a given tax-return due date), the three-property, 200%, and 95% identification tests of Treas. Reg. §1.1031(k)-1(c)(4), and the cash boot, mortgage boot, debt replacement, and trade-down of an exchange, with the boot-limited gain when the basis is given.",
    input: Exchange1031Input,
    run: exchange1031,
  },
  critical_dates: {
    id: "calc.critical_dates",
    version: 1,
    title: "Lease critical dates",
    description:
      "Dated list of a lease's notice deadlines and option windows, from its expiration date and options: each renewal option's notice deadline or notice window and renewal term (successive options count back from the term before), each termination option's last day to give notice, an expansion option deadline, and other deadlines (a stated date, or N days after a date such as a ROFO notice). Calendar months; N months before a date keeps the day of month, clamped to a shorter month's end (a warning gives the month-end reading when it is later). Deadlines on a weekend or US federal holiday (5 U.S.C. §6103, observed days included) are flagged, or rolled to the preceding or following business day when business_day_roll says so. With as_of: days to each event, passed deadlines warned, and the next deadline. Steps show each computation.",
    input: CriticalDatesInput,
    run: criticalDates,
  },
  reconcile_dcf: {
    id: "calc.reconcile_dcf",
    version: 1,
    title: "Tie out a DCF against another system's annual lines",
    description:
      "Reconcile FactLot's DCF with another system's export (ARGUS or any other model; parity is not claimed and is untested against real ARGUS output): give the calc_dcf_pro_forma input plus the other system's annual lines {label, values: [year 1, …]}, optionally its value, unlevered IRR and sale price, a tolerance (absolute and relative) and your label mapping. Labels map to FactLot lines by your mapping, else by common CRE line names (Potential Base Rent, Absorption & Turnover Vacancy, Free Rent, Expense Reimbursements, General Vacancy, Credit Loss, Effective Gross Revenue, Operating Expenses, Net Operating Income, Tenant Improvements, Leasing Commissions, Capital Reserves, Cash Flow Before Debt Service); positive deductions are negated (sign_convention). Returns per line and year FactLot's amount, the other amount, the difference and whether it is within tolerance; unmapped labels; and for each differing line a likely_cause from FactLot's documented conventions, worded as a hypothesis to check: differences only in rollover years (fractional downtime and free rent), a rate on a different base (general vacancy), only the exit year, a one-year shift, management fee inside operating expenses, a growth rate, a constant factor or amount, rounding; and for the value FactLot rerun with mid-year or end-of-year discounting, the other exit NOI basis, or no selling costs.",
    input: ReconcileDcfInput,
    run: reconcileDcf,
  },
  reconcile_cam: {
    id: "calc.reconcile_cam",
    version: 1,
    title: "Tie out CAM reconciliations against another system's results",
    description:
      "Reconcile FactLot's CAM reconciliation for one expense pool with another system's per-tenant results (Yardi or any other; parity is not claimed and is untested against a real export): give the calc_cam_reconciliation_batch input plus, per tenant, what the other system reported (share, gross-up, cap limit and reduction, admin fee, base-year or stop deduction, billed amount, estimates, balance; billed_amount required) and a tolerance. Returns per tenant and line FactLot's amount, the other amount, the difference and whether it is within tolerance, tenants missing on either side, and likely causes worded as hypotheses to check: a different pro rata share (and, when every share differs by one factor, the pool's denominator), or a FactLot rerun that matches the other system with lines left to the default controllable: true set uncontrollable, the cap's base year one year off, the other cap method, the other gross-up target or no gross-up, the admin fee before or after and within or outside the cap, or no fee on uncontrollable lines; and differing estimates paid.",
    input: ReconcileCamInput,
    run: reconcileCam,
  },
  tx_unequal_appraisal: {
    id: "calc.tx_unequal_appraisal",
    version: 1,
    title: "Texas unequal appraisal: median of adjusted comparables",
    description:
      "Evidence calculation only: not an appraisal or an opinion of value, not legal or tax advice, and not a substitute for the advice of an attorney. The arithmetic of Tex. Tax Code §41.43(b)(3) and §42.26(a)(3), the subject's value against the median appraised value of a reasonable number of comparable properties appropriately adjusted. Takes 3–200 comparables chosen by the caller, each with its roll value and the caller's adjustments (percent, USD amount, or $/SF, each with a reason); optionally normalizes each comparable to value per SF of improvement or land area times the subject's area; applies percentages summed or compounded, then amounts; and returns every comparable's normalized and adjusted value, the sorted list, the median (for an even count, the mean of the two middle values), and the subject's value minus the median in USD (subject_minus_median) and as a fraction of the median (subject_minus_median_pct: 0.1554 means 15.54%, a decimal like every rate in FactLot, not 0.1554%), with the statutes cited. Warns on mixed value bases, §42.26(d) and the §23.231 limitation, comparables in another county, fewer than 5 comparables, total adjustments over 25%, and a comparable identical to the subject. It does not choose comparables, invent adjustments, or say whether to protest.",
    input: TxUnequalAppraisalInput,
    run: txUnequalAppraisal,
  },
} as const satisfies Record<string, Calculator>;
