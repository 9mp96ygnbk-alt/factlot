import { z } from "zod";

import {
  CalcInputError,
  NonNegMoney,
  Rate,
  Share,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

/**
 * CAM cap methods, named for what they compute rather than the ambiguous lease
 * terms "cumulative" / "non-cumulative", which landlords and tenants use differently.
 *
 * - `compounding_from_base`: limit = reference × (1 + rate)^years_elapsed.
 *   Unused headroom carries forward. Often called "cumulative, compounding".
 * - `simple_from_base`: limit = reference × (1 + rate × years_elapsed).
 *   Often called "cumulative, non-compounding".
 * - `year_over_year`: limit = prior year's capped amount × (1 + rate).
 *   No carry-forward. Often called "non-cumulative".
 */
export const CapMethod = z.enum([
  "compounding_from_base",
  "simple_from_base",
  "year_over_year",
]);

export const CamReconciliationInput = z.object({
  year: z
    .number()
    .int()
    .min(1900)
    .max(2200)
    .describe("Calendar or lease year being reconciled."),
  pro_rata_share: Share.describe(
    "Tenant's pro rata share, 0 < share ≤ 1 (e.g. 12,000 / 150,000 = 0.08).",
  ),
  expenses: z
    .array(
      z.object({
        category: z
          .string()
          .min(1)
          .max(200)
          .describe(
            'Expense line as named in the operating statement, e.g. "janitorial".',
          ),
        amount: NonNegMoney.describe(
          "Building-level actual expense for the year, USD.",
        ),
        controllable: z
          .boolean()
          .default(true)
          .describe(
            "Subject to the cap. Taxes, insurance, and utilities are typically uncontrollable.",
          ),
        recoverable: z
          .boolean()
          .default(true)
          .describe(
            "Excluded expenses (capital items, landlord-only costs) are dropped entirely.",
          ),
        variable: z
          .boolean()
          .default(false)
          .describe(
            "Varies with occupancy, so eligible for gross-up (janitorial, utilities, management fee).",
          ),
      }),
    )
    .min(1)
    .max(1000)
    .describe("Building operating expense lines for the year."),
  gross_up: z
    .object({
      actual_occupancy: Share.describe(
        "Average occupancy for the year, e.g. 0.82.",
      ),
      target_occupancy: Share.default(0.95).describe(
        "Gross-up occupancy stated in the lease (commonly 0.95 or 1.0).",
      ),
    })
    .optional()
    .describe(
      "Gross up variable expenses to the target occupancy when actual occupancy is lower. Omit if the lease has no gross-up.",
    ),
  structure: z
    .discriminatedUnion("type", [
      z
        .object({ type: z.literal("net") })
        .describe(
          "Tenant pays its full share of recoverable expenses (NNN / net).",
        ),
      z
        .object({
          type: z.literal("base_year"),
          base_year_expenses: NonNegMoney.describe(
            "Total building recoverable expenses in the base year, already grossed up, USD.",
          ),
        })
        .describe(
          "Tenant pays its share of the excess over base-year expenses.",
        ),
      z
        .object({
          type: z.literal("expense_stop"),
          stop_amount: NonNegMoney.describe(
            "Building-level expense stop, USD per year.",
          ),
        })
        .describe(
          "Tenant pays its share of the excess over a fixed expense stop.",
        ),
    ])
    .default({ type: "net" })
    .describe("Expense structure from the lease. Default: net."),
  cap: z
    .object({
      method: CapMethod.describe(
        "compounding_from_base: reference × (1+rate)^years (often called cumulative, compounding). simple_from_base: reference × (1 + rate × years) (cumulative, non-compounding). year_over_year: prior year's capped amount × (1+rate) (non-cumulative). Map the lease language to one of these explicitly.",
      ),
      rate: Rate.refine((r) => r >= 0, "cap rate must be ≥ 0").describe(
        "Annual cap as a decimal, e.g. 0.05.",
      ),
      reference_amount: NonNegMoney.describe(
        "Tenant's share of controllable expenses in the reference year: the base year for *_from_base, or the prior year's capped amount for year_over_year, USD.",
      ),
      years_elapsed: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Years since the base year (required for `*_from_base`)."),
    })
    .optional()
    .describe(
      "Cap on the tenant's share of controllable expenses. Omit if the lease has no cap.",
    ),
  estimates_paid: NonNegMoney.default(0).describe(
    "Estimated CAM payments the tenant made during the year.",
  ),
});
export type CamReconciliationInput = z.input<typeof CamReconciliationInput>;

export interface CamReconciliation {
  recoverable_expenses: number;
  grossed_up_expenses: number;
  tenant_share_controllable: number;
  tenant_share_uncontrollable: number;
  cap_limit: number | null;
  cap_reduction: number;
  structure_deduction: number;
  tenant_charge: number;
  estimates_paid: number;
  /** Positive: tenant owes. Negative: landlord owes a credit/refund. */
  balance_due: number;
}

export function camReconciliation(
  raw: CamReconciliationInput,
): CalcResult<CamReconciliation> {
  const input = parseInput(CamReconciliationInput, raw);
  const t = new Trace();
  const share = input.pro_rata_share;

  const recoverable = input.expenses.filter((e) => e.recoverable);
  const excluded = input.expenses.filter((e) => !e.recoverable);
  const recoverableTotal = t.step(
    "Recoverable expenses",
    round(
      recoverable.reduce((a, e) => a + e.amount, 0),
      2,
    ),
    excluded.length
      ? `excludes ${excluded.map((e) => e.category).join(", ")}`
      : "all expenses recoverable",
    "USD",
  );

  let factor = 1;
  if (input.gross_up) {
    const { actual_occupancy: actual, target_occupancy: target } =
      input.gross_up;
    factor = actual < target ? target / actual : 1;
    t.step(
      "Gross-up factor (variable expenses)",
      round(factor, 6),
      actual < target
        ? `${fmtPct(target)} target ÷ ${fmtPct(actual)} actual`
        : "occupancy ≥ target; no gross-up",
    );
  }
  const adjusted = recoverable.map((e) => ({
    ...e,
    amount: e.variable ? e.amount * factor : e.amount,
  }));
  const grossed = t.step(
    "Recoverable expenses after gross-up",
    round(
      adjusted.reduce((a, e) => a + e.amount, 0),
      2,
    ),
    undefined,
    "USD",
  );

  const ctrlTotal = adjusted
    .filter((e) => e.controllable)
    .reduce((a, e) => a + e.amount, 0);
  const unctrlTotal = adjusted
    .filter((e) => !e.controllable)
    .reduce((a, e) => a + e.amount, 0);
  const ctrlShare = t.step(
    "Tenant share of controllable",
    round(ctrlTotal * share, 2),
    `${fmtMoney(ctrlTotal)} × ${share}`,
    "USD",
  );
  const unctrlShare = t.step(
    "Tenant share of uncontrollable",
    round(unctrlTotal * share, 2),
    `${fmtMoney(unctrlTotal)} × ${share}`,
    "USD",
  );

  let capLimit: number | null = null;
  let cappedCtrl = ctrlShare;
  if (input.cap) {
    const { method, rate, reference_amount: ref, years_elapsed: n } = input.cap;
    if (method !== "year_over_year" && n === undefined) {
      throw new CalcInputError(`cap.years_elapsed is required for ${method}`);
    }
    const years = n ?? 1;
    const [limit, formula] =
      method === "compounding_from_base"
        ? [
            ref * powInt(1 + rate, years),
            `${fmtMoney(ref)} × (1 + ${rate})^${years}`,
          ]
        : method === "simple_from_base"
          ? [
              ref * (1 + rate * years),
              `${fmtMoney(ref)} × (1 + ${rate} × ${years})`,
            ]
          : [ref * (1 + rate), `${fmtMoney(ref)} × (1 + ${rate})`];
    capLimit = t.step(`Cap limit (${method})`, round(limit, 2), formula, "USD");
    cappedCtrl = t.step(
      "Controllable after cap",
      Math.min(ctrlShare, capLimit),
      "min(tenant controllable, cap limit)",
      "USD",
    );
  }
  const capReduction = round(ctrlShare - cappedCtrl, 2);

  let deduction = 0;
  const s = input.structure;
  if (s.type === "base_year") {
    deduction = t.step(
      "Base-year deduction",
      round(s.base_year_expenses * share, 2),
      `${fmtMoney(s.base_year_expenses)} × ${share}`,
      "USD",
    );
    if (input.cap)
      t.warn(
        "Cap applied before the base-year deduction; confirm the lease's order of operations.",
      );
  } else if (s.type === "expense_stop") {
    deduction = t.step(
      "Expense-stop deduction",
      round(s.stop_amount * share, 2),
      `${fmtMoney(s.stop_amount)} × ${share}`,
      "USD",
    );
    if (input.cap)
      t.warn(
        "Cap applied before the expense-stop deduction; confirm the lease's order of operations.",
      );
  }

  const charge = t.step(
    "Tenant CAM charge",
    round(Math.max(0, cappedCtrl + unctrlShare - deduction), 2),
    `max(0, ${fmtMoney(cappedCtrl)} + ${fmtMoney(unctrlShare)} − ${fmtMoney(deduction)})`,
    "USD",
  );
  const balance = t.step(
    "Balance due",
    round(charge - input.estimates_paid, 2),
    `${fmtMoney(charge)} − ${fmtMoney(input.estimates_paid)} estimates paid`,
    "USD",
  );
  if (!input.cap) t.warn("No CAM cap supplied; confirm the lease has none.");

  return t.result("calc.cam_reconciliation", 1, {
    recoverable_expenses: recoverableTotal,
    grossed_up_expenses: grossed,
    tenant_share_controllable: ctrlShare,
    tenant_share_uncontrollable: unctrlShare,
    cap_limit: capLimit,
    cap_reduction: capReduction,
    structure_deduction: deduction,
    tenant_charge: charge,
    estimates_paid: input.estimates_paid,
    balance_due: balance,
  });
}
