/**
 * @factlot/calc — deterministic, traceable CRE calculators.
 *
 * Agents should never do lease or loan math in-context. Every function here is
 * pure, validates its input, and returns the answer with a step-by-step trace and
 * a versioned formula ID that can be cited in a FactLot `computed` fact.
 */
import type { z } from "zod";

import { CamReconciliationInput, camReconciliation } from "./cam.ts";
import type { CalcResult } from "./core.ts";
import { DebtSizingInput, debtSizing } from "./debt.ts";
import { IrrInput, NpvInput, irr, npv } from "./finance.ts";
import { WaltInput, walt } from "./portfolio.ts";
import { ProposalComparisonInput, compareProposals } from "./proposals.ts";
import { PercentageRentInput, percentageRent } from "./retail.ts";
import {
  NetEffectiveRentInput,
  RentScheduleInput,
  netEffectiveRent,
  rentSchedule,
} from "./rent.ts";

export * from "./cam.ts";
export * from "./core.ts";
export * from "./dates.ts";
export * from "./debt.ts";
export * from "./finance.ts";
export * from "./portfolio.ts";
export * from "./proposals.ts";
export * from "./retail.ts";
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
    version: 1,
    title: "Loan sizing (LTV / DSCR / debt yield)",
    description:
      "Size the maximum loan under any combination of max LTV, min DSCR, and min debt yield for a given NOI, rate, and amortization. Reports the binding constraint, debt service, and resulting metrics.",
    input: DebtSizingInput,
    run: debtSizing,
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
      "NPV of periodic cash flows (t = 0, 1, 2, ...) at a per-period discount rate.",
    input: NpvInput,
    run: npv,
  },
  irr: {
    id: "calc.irr",
    version: 1,
    title: "Internal rate of return",
    description:
      "Periodic and annualized IRR of periodic cash flows, solved deterministically; reports every root when cash flows have multiple IRRs.",
    input: IrrInput,
    run: irr,
  },
} as const satisfies Record<string, Calculator>;
