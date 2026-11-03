/**
 * @factlot/calc — deterministic, traceable CRE calculators.
 *
 * Agents should never do lease or loan math in-context. Every function here is
 * pure, validates its input, and returns the answer with a step-by-step trace and
 * a versioned formula ID that can be cited in a FactLot `computed` fact.
 */
import type { z } from "zod";

import { LeaseRemeasurementInput, leaseRemeasurementAsc842 } from "./asc842.ts";
import { CamReconciliationInput, camReconciliation } from "./cam.ts";
import type { CalcResult } from "./core.ts";
import { DebtSizingInput, debtSizing } from "./debt.ts";
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

export * from "./asc842.ts";
export * from "./cam.ts";
export * from "./core.ts";
export * from "./dates.ts";
export * from "./debt.ts";
export * from "./finance.ts";
export * from "./hotel.ts";
export * from "./lease_vs_own.ts";
export * from "./portfolio.ts";
export * from "./prepayment.ts";
export * from "./proposals.ts";
export * from "./renew_vs_relocate.ts";
export * from "./retail.ts";
export * from "./rules.ts";
export * from "./rent.ts";

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
      "Build a base-rent schedule from commencement date, term, area, starting $/SF/yr, escalations (percent or fixed $/SF), and abated months. Returns rent steps, totals, expiration date, and a calculation trace.",
    input: RentScheduleInput,
    run: rentSchedule,
  },
  net_effective_rent: {
    id: "calc.net_effective_rent",
    version: 1,
    title: "Net effective rent (NER)",
    description:
      "Compute effective rent, straight-line net effective rent, and discounted net effective rent ($/SF/yr) after free rent, TI allowance, leasing commissions, and other landlord concessions.",
    input: NetEffectiveRentInput,
    run: netEffectiveRent,
  },
  compare_proposals: {
    id: "calc.compare_proposals",
    version: 1,
    title: "Compare lease proposals",
    description:
      "Rank 2–20 lease proposals with different terms, sizes, free rent, TI, concessions, and expense structures on one discounted $/SF/yr basis: effective occupancy cost (tenant perspective) or discounted net effective rent (landlord perspective).",
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
    version: 1,
    title: "CAM / operating expense reconciliation",
    description:
      "Reconcile a tenant's annual CAM charge: exclusions, occupancy gross-up of variable expenses, pro rata share, controllable-expense caps (compounding_from_base, simple_from_base, year_over_year), base year or expense stop, and estimates paid. Returns balance due and a full trace.",
    input: CamReconciliationInput,
    run: camReconciliation,
  },
  debt_sizing: {
    id: "calc.debt_sizing",
    version: 2,
    title: "Loan sizing (LTV / DSCR / debt yield)",
    description:
      "Size the maximum loan under any combination of max LTV, min DSCR, and min debt yield for a given NOI, rate, and amortization. Reports the binding constraint, debt service, and resulting metrics.",
    input: DebtSizingInput,
    run: debtSizing,
  },
  lease_remeasurement_asc842: {
    id: "calc.lease_remeasurement_asc842",
    version: 1,
    title: "Lease remeasurement (ASC 842, lessee)",
    description:
      "Remeasure a lessee's lease liability and right-of-use asset under ASC 842 after a modification, lease-term reassessment, contingency resolution, or residual value guarantee change: new liability (PV of remaining payments), liability and ROU adjustments with any gain (ASC 842-20-35-4), and the per-period amortization table (operating: straight-line single lease cost; finance: interest plus amortization). Warns where judgment is needed.",
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
      "Weighted average remaining lease term in years, weighted by area or annual rent, as of a date.",
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
    version: 1,
    title: "Internal rate of return",
    description:
      "Periodic and annualized IRR of periodic cash flows, as decimals (0.085 = 8.5%), solved deterministically; reports every root when cash flows have multiple IRRs. Errors when the flows do not change sign or no root lies between -99.99% and 1000% per period.",
    input: IrrInput,
    run: irr,
  },
  lease_vs_own: {
    id: "calc.lease_vs_own",
    version: 1,
    title: "Lease vs. own",
    description:
      "Compare leasing with buying over a fixed horizon: NPV of each case's annual cash costs (rent, free rent, tenant expenses, and move-in costs versus equity, debt service, owner expenses, reserves, and a sale at the horizon by stated value or exit cap rate), optionally after tax, with the year-by-year tables and the break-even residual value at which owning equals leasing.",
    input: LeaseVsOwnInput,
    run: leaseVsOwn,
  },
  renew_vs_relocate: {
    id: "calc.renew_vs_relocate",
    version: 1,
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
} as const satisfies Record<string, Calculator>;
