import { z } from "zod";

import {
  CalcInputError,
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

export const DirectCapInput = z
  .object({
    noi: z
      .number()
      .finite()
      .positive()
      .describe(
        "Net operating income to capitalize, USD/yr, before capital reserves (they are deducted separately below).",
      ),
    noi_basis: z
      .enum(["trailing_12", "forward_12", "stabilized"])
      .optional()
      .describe(
        "What the NOI is: trailing 12 months (T-12), forward 12 months (year 1 of a pro forma), or stabilized. The cap rate must be on the same basis; this is recorded in the steps, not checked.",
      ),
    cap_rate: z
      .number()
      .finite()
      .gt(0)
      .lt(1)
      .optional()
      .describe(
        "Capitalization rate as a decimal, e.g. 0.065 for 6.5%. Gives the value. Provide cap_rate, price, or both.",
      ),
    price: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe(
        "Purchase or asking price, USD. Gives the implied cap rate. Provide cap_rate, price, or both.",
      ),
    capex_reserve_annual: NonNegMoney.default(0).describe(
      "Annual capital (replacement) reserve deducted from NOI before capitalizing, USD/yr. 0 if the NOI is already after reserves.",
    ),
    lease_up_costs: NonNegMoney.default(0).describe(
      "One-time costs to reach the stabilized NOI (TI, leasing commissions, lost rent during lease-up), USD, deducted from the capitalized value.",
    ),
    free_rent_burn_off: NonNegMoney.default(0).describe(
      "Free rent still to be given under signed leases (rent the stabilized NOI assumes but the owner will not collect), USD, deducted from the capitalized value.",
    ),
    other_adjustments: z
      .array(
        z.object({
          label: z
            .string()
            .min(1)
            .max(200)
            .describe(
              'What the adjustment is, e.g. "deferred maintenance" or "excess land".',
            ),
          amount: z
            .number()
            .finite()
            .describe(
              "USD added to the value: negative for a deduction (deferred maintenance), positive for an addition (excess land).",
            ),
        }),
      )
      .max(20)
      .default([])
      .describe(
        "Further below-the-line value adjustments, applied after capitalizing.",
      ),
    area_sf: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Rentable area in SF, for value per SF. Optional."),
    round_value_to: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe(
        "Also report the as-is value rounded to this increment (half away from zero), e.g. 100000 as appraisers round. Optional.",
      ),
  })
  .refine((v) => v.cap_rate !== undefined || v.price !== undefined, {
    message: "provide cap_rate, price, or both",
  });
export type DirectCapInput = z.input<typeof DirectCapInput>;

export interface DirectCap {
  noi: number;
  capitalized_income: number;
  cap_rate: number | null;
  /** Capitalized income ÷ cap rate. */
  stabilized_value: number | null;
  /** Lease-up costs + free-rent burn-off − other adjustments (positive = net deduction). */
  total_deductions: number;
  /** Stabilized value − total deductions. */
  as_is_value: number | null;
  as_is_value_rounded: number | null;
  value_per_sf: number | null;
  price: number | null;
  /** Capitalized income ÷ price. */
  implied_cap_rate: number | null;
  /** NOI before reserves ÷ price. */
  implied_cap_rate_before_reserves: number | null;
  /** Capitalized income ÷ (price + total deductions): the cap rate the price implies once the below-the-line costs are paid. */
  implied_cap_rate_all_in: number | null;
  price_per_sf: number | null;
}

/** Direct capitalization: value from NOI and a cap rate, and the cap rate a price implies. */
export function directCap(raw: DirectCapInput): CalcResult<DirectCap> {
  const input = parseInput(DirectCapInput, raw);
  const t = new Trace();
  if (input.noi_basis !== undefined)
    t.step("NOI basis", input.noi_basis.replace("_", " "));
  const income = t.step(
    "Capitalized income",
    round(input.noi - input.capex_reserve_annual, 2),
    `${fmtMoney(input.noi)} NOI − ${fmtMoney(input.capex_reserve_annual)} capital reserve`,
    "USD/yr",
  );
  if (income <= 0)
    throw new CalcInputError(
      `capex_reserve_annual ${fmtMoney(input.capex_reserve_annual)} leaves no income to capitalize from NOI ${fmtMoney(input.noi)}`,
      [{ path: "capex_reserve_annual", message: "must be less than noi" }],
    );
  let others = 0;
  for (const a of input.other_adjustments) others += a.amount;
  const deductions = t.step(
    "Below-the-line deductions",
    round(input.lease_up_costs + input.free_rent_burn_off - others, 2),
    `${fmtMoney(input.lease_up_costs)} lease-up + ${fmtMoney(input.free_rent_burn_off)} free-rent burn-off${input.other_adjustments.map((a) => ` ${a.amount < 0 ? "+" : "−"} ${fmtMoney(Math.abs(a.amount))} ${a.label}`).join("")}`,
    "USD",
  );

  let stabilized: number | null = null;
  let asIs: number | null = null;
  let asIsRounded: number | null = null;
  if (input.cap_rate !== undefined) {
    stabilized = t.step(
      "Stabilized value",
      round(income / input.cap_rate, 2),
      `${fmtMoney(income)} ÷ ${fmtPct(input.cap_rate, 3)}`,
      "USD",
    );
    asIs = t.step(
      "As-is value",
      round(stabilized - deductions, 2),
      `${fmtMoney(stabilized)} − ${fmtMoney(deductions)} below-the-line`,
      "USD",
    );
    if (input.round_value_to !== undefined)
      asIsRounded = t.step(
        "As-is value, rounded",
        round(round(asIs / input.round_value_to, 0) * input.round_value_to, 2),
        `to the nearest ${fmtMoney(input.round_value_to)}`,
        "USD",
      );
    if (asIs <= 0)
      t.warn(
        "The below-the-line deductions exceed the stabilized value; the as-is value is not positive.",
      );
  }
  let implied: number | null = null;
  let impliedBefore: number | null = null;
  let impliedAllIn: number | null = null;
  if (input.price !== undefined) {
    implied = t.step(
      "Implied cap rate",
      round(income / input.price, 6),
      `${fmtMoney(income)} capitalized income ÷ ${fmtMoney(input.price)} price`,
    );
    impliedBefore = round(input.noi / input.price, 6);
    if (input.capex_reserve_annual > 0)
      t.step(
        "Implied cap rate before reserves",
        impliedBefore,
        `${fmtMoney(input.noi)} NOI ÷ ${fmtMoney(input.price)}`,
      );
    const allInBasis = round(input.price + deductions, 2);
    if (allInBasis > 0) {
      impliedAllIn = round(income / allInBasis, 6);
      if (deductions !== 0)
        t.step(
          "Implied cap rate, all-in",
          impliedAllIn,
          `${fmtMoney(income)} ÷ (${fmtMoney(input.price)} price + ${fmtMoney(deductions)} below-the-line)`,
        );
    } else
      t.warn(
        "Price plus the below-the-line adjustments is not positive, so no all-in cap rate is reported.",
      );
  }

  if (input.noi_basis === undefined)
    t.warn(
      "noi_basis not given: a cap rate applies only to NOI on the same basis (trailing 12, forward 12, or stabilized); state which one the market evidence uses.",
    );
  if (input.capex_reserve_annual === 0)
    t.warn(
      "No capital reserve deducted; if the comparable cap rates are quoted after reserves, deduct one so the bases match.",
    );
  if (
    input.cap_rate !== undefined &&
    input.price !== undefined &&
    implied !== null &&
    asIs !== null
  )
    t.step(
      "Value versus price",
      round(asIs - input.price, 2),
      `${fmtMoney(asIs)} as-is value − ${fmtMoney(input.price)} price`,
      "USD",
    );

  const area = input.area_sf;
  return t.result("calc.direct_cap", 1, {
    noi: input.noi,
    capitalized_income: income,
    cap_rate: input.cap_rate ?? null,
    stabilized_value: stabilized,
    total_deductions: deductions,
    as_is_value: asIs,
    as_is_value_rounded: asIsRounded,
    value_per_sf:
      area !== undefined && asIs !== null ? round(asIs / area, 2) : null,
    price: input.price ?? null,
    implied_cap_rate: implied,
    implied_cap_rate_before_reserves: impliedBefore,
    implied_cap_rate_all_in: impliedAllIn,
    price_per_sf:
      area !== undefined && input.price !== undefined
        ? round(input.price / area, 2)
        : null,
  });
}
