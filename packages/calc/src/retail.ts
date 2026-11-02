import { z } from "zod";

import {
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

export const PercentageRentInput = z.object({
  /** Gross sales reported for the lease year (or partial year). */
  gross_sales: NonNegMoney,
  /** Sales excluded by the lease (returns, sales tax, gift cards, employee sales, …). */
  sales_exclusions: NonNegMoney.default(0),
  /** Percentage rent rate, e.g. 0.06 for 6%. */
  rate: z.number().gt(0).lt(1),
  /** Annual base rent; used for the natural breakpoint. */
  base_rent_annual: NonNegMoney,
  breakpoint: z
    .discriminatedUnion("type", [
      /** Natural breakpoint = annual base rent ÷ rate. */
      z.object({ type: z.literal("natural") }),
      /** Artificial breakpoint stated in the lease, as an annual sales amount. */
      z.object({ type: z.literal("fixed"), amount: NonNegMoney }),
    ])
    .default({ type: "natural" }),
  /** Fraction of a full lease year covered (e.g. 0.5 for a six-month partial year). Prorates the breakpoint. */
  period_fraction: z.number().gt(0).lte(1).default(1),
  /** Percentage rent already paid during the period. */
  percentage_rent_paid: NonNegMoney.default(0),
});
export type PercentageRentInput = z.input<typeof PercentageRentInput>;

export interface PercentageRent {
  net_sales: number;
  breakpoint: number;
  sales_over_breakpoint: number;
  percentage_rent: number;
  balance_due: number;
}

/** Retail percentage ("overage") rent for one lease year or partial year. */
export function percentageRent(
  raw: PercentageRentInput,
): CalcResult<PercentageRent> {
  const input = parseInput(PercentageRentInput, raw);
  const t = new Trace();
  const net = t.step(
    "Net sales",
    round(Math.max(0, input.gross_sales - input.sales_exclusions), 2),
    `${fmtMoney(input.gross_sales)} − ${fmtMoney(input.sales_exclusions)} exclusions`,
    "USD",
  );
  const f = input.period_fraction;
  const bp =
    input.breakpoint.type === "natural"
      ? t.step(
          "Natural breakpoint",
          round((input.base_rent_annual / input.rate) * f, 2),
          `${fmtMoney(input.base_rent_annual)} ÷ ${fmtPct(input.rate)}${f < 1 ? ` × ${f}` : ""}`,
          "USD",
        )
      : t.step(
          "Fixed breakpoint",
          round(input.breakpoint.amount * f, 2),
          `${fmtMoney(input.breakpoint.amount)}${f < 1 ? ` × ${f}` : ""}`,
          "USD",
        );
  const over = t.step(
    "Sales over breakpoint",
    round(Math.max(0, net - bp), 2),
    "max(0, net sales − breakpoint)",
    "USD",
  );
  const pct = t.step(
    "Percentage rent",
    round(over * input.rate, 2),
    `${fmtMoney(over)} × ${fmtPct(input.rate)}`,
    "USD",
  );
  const balance = t.step(
    "Balance due",
    round(pct - input.percentage_rent_paid, 2),
    `${fmtMoney(pct)} − ${fmtMoney(input.percentage_rent_paid)} paid`,
    "USD",
  );
  if (f < 1)
    t.warn(
      "Breakpoint prorated by period_fraction; confirm the lease prorates on that basis (days vs. months).",
    );
  return t.result("calc.percentage_rent", 1, {
    net_sales: net,
    breakpoint: bp,
    sales_over_breakpoint: over,
    percentage_rent: pct,
    balance_due: balance,
  });
}
