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
import type { CalcResult } from "./core.ts";
import { DcfProFormaInput, dcfProForma } from "./dcf.ts";
import { DebtSizingInput, debtSizing } from "./debt.ts";
import { DirectCapInput, directCap } from "./direct_cap.ts";
import { Exchange1031Input, exchange1031 } from "./exchange_1031.ts";
import { IrrInput, NpvInput, irr, npv } from "./finance.ts";
import { HotelMetricsInput, hotelMetrics } from "./hotel.ts";
import { LeaseVsOwnInput, leaseVsOwn } from "./lease_vs_own.ts";
import { WaltInput, walt } from "./portfolio.ts";
import { PrepaymentInput, prepaymentAndDefeasance } from "./prepayment.ts";
import { ProposalComparisonInput, compareProposals } from "./proposals.ts";
import { RenewVsRelocateInput, renewVsRelocate } from "./renew_vs_relocate.ts";
import { PercentageRentInput, percentageRent } from "./retail.ts";
import {
  NetEffectiveRentInput,
  RentScheduleInput,
  netEffectiveRent,
  rentSchedule,
} from "./rent.ts";
import { EquityWaterfallInput, equityWaterfall } from "./waterfall.ts";

export * from "./amortization.ts";
export * from "./asc842.ts";
export * from "./cam.ts";
export * from "./core.ts";
export * from "./dates.ts";
export * from "./dcf.ts";
export * from "./debt.ts";
export * from "./direct_cap.ts";
export * from "./exchange_1031.ts";
export * from "./finance.ts";
export * from "./hotel.ts";
export * from "./lease_vs_own.ts";
export * from "./portfolio.ts";
export * from "./prepayment.ts";
export * from "./proposals.ts";
export * from "./renew_vs_relocate.ts";
export * from "./retail.ts";
export * from "./rules.ts";
export * from "./rules-drafts/index.ts";
export * from "./rent.ts";
export * from "./waterfall.ts";

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
      "Build a base-rent schedule from commencement date, term, area, starting $/SF/yr, escalations (percent or fixed $/SF), and abated months. Lease months run from the commencement day-of-month with no calendar proration (warns when commencement is mid-month). Returns rent steps, totals, expiration date, and a calculation trace.",
    input: RentScheduleInput,
    run: rentSchedule,
  },
  net_effective_rent: {
    id: "calc.net_effective_rent",
    version: 1,
    title: "Net effective rent (NER)",
    description:
      "Compute effective rent, straight-line net effective rent, and discounted net effective rent ($/SF/yr) after free rent, TI allowance, leasing commissions, and other landlord concessions. Rent is monthly in advance from the commencement day (no calendar proration), discounted at annual rate ÷ 12.",
    input: NetEffectiveRentInput,
    run: netEffectiveRent,
  },
  compare_proposals: {
    id: "calc.compare_proposals",
    version: 2,
    title: "Compare lease proposals",
    description:
      "Rank 2–20 lease proposals with different terms, sizes, free rent, TI, concessions, and operating-expense structures (gross, NNN, base year, expense stop, with opex growth) on one discounted $/SF/yr basis, per rentable or usable SF (load factor): effective occupancy cost (tenant perspective) or discounted net effective rent after landlord-borne opex and optional pre-commencement downtime (landlord perspective). Cash flows monthly in advance at annual rate ÷ 12; warns when the usable-SF ranking differs and when terms differ.",
    input: ProposalComparisonInput,
    run: compareProposals,
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
    version: 1,
    title: "Property DCF from a rent roll",
    description:
      "Property-level discounted cash flow from an in-place rent roll: each lease's rent, escalations, remaining term, and expense recovery (NNN, gross, base year), then at expiration one blended lease weighted by the renewal probability (renewal vs new-tenant rent, free rent, TI, leasing commissions, and new-tenant downtime, rounded to whole months); market rent growth, general vacancy and credit loss, operating expenses, management fee, and capital reserves. Returns the annual cash-flow table (NOI and cash flow before debt) for the hold plus one year, the exit value at a cap rate on forward (or trailing) NOI less selling costs, the value (PV at the discount rate, end-of-year or mid-year), and with a purchase price the NPV, unlevered IRR, and equity multiple, with every lease event and convention stated.",
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
    version: 1,
    title: "1031 exchange deadlines, identification, and boot",
    description:
      "Not tax advice: arithmetic only. The 45-day identification and 180-day exchange deadlines of IRC §1031(a)(3) (the exchange period ends earlier at a given tax-return due date), the three-property, 200%, and 95% identification tests of Treas. Reg. §1.1031(k)-1(c)(4), and the cash boot, mortgage boot, debt replacement, and trade-down of an exchange, with the boot-limited gain when the basis is given.",
    input: Exchange1031Input,
    run: exchange1031,
  },
} as const satisfies Record<string, Calculator>;
