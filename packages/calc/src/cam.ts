import { z } from "zod";

import {
  CalcInputError,
  IsoDate,
  NonNegMoney,
  Rate,
  Share,
  Trace,
  fmtMoney,
  fmtNum,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { daysBetween } from "./dates.ts";

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
        admin_fee_applies: z
          .boolean()
          .default(true)
          .describe(
            "Included in the admin_fee base. Set false for lines the lease excludes from the fee (often taxes, insurance, utilities, or a management fee already charged).",
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
  admin_fee: z
    .object({
      rate: Rate.refine((r) => r >= 0, "admin fee rate must be ≥ 0").describe(
        "Administrative or management fee as a decimal of the fee base, e.g. 0.15 for 15%. The base is the tenant's share of recoverable lines with admin_fee_applies (after gross-up).",
      ),
      applied: z
        .enum(["before_cap", "after_cap"])
        .default("after_cap")
        .describe(
          "Fee on controllable lines computed on the tenant's share before the cap (before_cap) or on the capped amount (after_cap). Fees on uncontrollable lines are never capped. Irrelevant without a cap.",
        ),
      capped: z
        .boolean()
        .default(false)
        .describe(
          "True when the fee on controllable lines counts toward the controllable cap (controllable share plus fee may not exceed the cap limit); false adds it outside the cap.",
        ),
    })
    .optional()
    .describe(
      "Administrative fee the lease adds to the tenant's share. Omit if the lease has none.",
    ),
  occupancy: z
    .object({
      move_in_date: IsoDate.optional().describe(
        "Date the tenant's share starts within the reconciliation period, YYYY-MM-DD (inclusive). Defaults to period_start_date.",
      ),
      move_out_date: IsoDate.optional().describe(
        "Last day of the tenant's share within the period, YYYY-MM-DD (inclusive). Defaults to period_end_date.",
      ),
      period_start_date: IsoDate.optional().describe(
        "First day of the reconciliation period, YYYY-MM-DD. Defaults to January 1 of year; set it for a lease year.",
      ),
      period_end_date: IsoDate.optional().describe(
        "Last day of the reconciliation period, YYYY-MM-DD (at most 366 days after the start). Defaults to December 31 of year.",
      ),
    })
    .optional()
    .describe(
      "Partial-year occupancy: the tenant's share, cap limit, and base-year or stop deduction are prorated by occupied days ÷ period days (both inclusive), so a full-year cap and base are not applied to a part year. Omit for a full year.",
    ),
  estimates_paid: NonNegMoney.default(0).describe(
    "Estimated CAM payments the tenant made during the year, USD (total for the year, not monthly).",
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
  /** Admin fee computed on the fee base (before any cut by a cap that it counts toward), USD. */
  admin_fee: number;
  /** Occupied days ÷ period days; 1 for a full year. */
  occupancy_fraction: number;
  structure_deduction: number;
  tenant_charge: number;
  estimates_paid: number;
  /** Positive: tenant owes. Negative: landlord owes a credit/refund. */
  balance_due: number;
}

/** Occupied days ÷ period days for `occupancy`, validated against the reconciliation period. */
function occupancyFraction(
  input: z.output<typeof CamReconciliationInput>,
  t: Trace,
): number {
  const o = input.occupancy;
  if (!o) return 1;
  const start = o.period_start_date ?? `${input.year}-01-01`;
  const end = o.period_end_date ?? `${input.year}-12-31`;
  const from = o.move_in_date ?? start;
  const to = o.move_out_date ?? end;
  const bad = (path: string, message: string): never => {
    throw new CalcInputError(`invalid input: occupancy.${path}: ${message}`, [
      { path: `occupancy.${path}`, message },
    ]);
  };
  const periodDays = daysBetween(start, end) + 1;
  if (periodDays < 1)
    bad("period_end_date", "must be on or after period_start_date");
  if (periodDays > 366)
    bad("period_end_date", "the period is longer than 366 days");
  if (daysBetween(start, from) < 0)
    bad("move_in_date", "must be within the reconciliation period");
  if (daysBetween(to, end) < 0)
    bad("move_out_date", "must be within the reconciliation period");
  const occupiedDays = daysBetween(from, to) + 1;
  if (occupiedDays < 1)
    bad("move_out_date", "must be on or after move_in_date");
  const f = occupiedDays / periodDays;
  t.step(
    "Occupancy fraction",
    round(f, 6),
    `${occupiedDays} occupied days (${from} to ${to}) ÷ ${periodDays} days in the period (${start} to ${end})`,
  );
  if (f < 1)
    t.warn(
      `Prorated for partial occupancy (${occupiedDays} of ${periodDays} days): the tenant's share, the cap limit, and any base-year or stop deduction are each scaled by the same fraction; confirm the lease prorates by days and that cap.reference_amount is a full-year amount.`,
    );
  return f;
}

export function camReconciliation(
  raw: CamReconciliationInput,
): CalcResult<CamReconciliation> {
  const input = parseInput(CamReconciliationInput, raw);
  const t = new Trace();
  const share = input.pro_rata_share;
  const f = occupancyFraction(input, t);
  const prorated = f < 1;
  const shareText = prorated
    ? `${fmtNum(share)} × ${fmtNum(f)}`
    : fmtNum(share);

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

  const sumOf = (keep: (e: (typeof adjusted)[number]) => boolean): number =>
    adjusted.filter(keep).reduce((a, e) => a + e.amount, 0);
  const ctrlTotal = sumOf((e) => e.controllable);
  const unctrlTotal = sumOf((e) => !e.controllable);
  const ctrlShare = t.step(
    "Tenant share of controllable",
    round(ctrlTotal * share * f, 2),
    `${fmtMoney(ctrlTotal)} × ${shareText}`,
    "USD",
  );
  const unctrlShare = t.step(
    "Tenant share of uncontrollable",
    round(unctrlTotal * share * f, 2),
    `${fmtMoney(unctrlTotal)} × ${shareText}`,
    "USD",
  );

  const fee = input.admin_fee;
  let ctrlFeeBase = 0;
  let feeUnctrl = 0;
  if (fee) {
    ctrlFeeBase = round(
      sumOf((e) => e.controllable && e.admin_fee_applies) * share * f,
      2,
    );
    const unctrlFeeBase = round(
      sumOf((e) => !e.controllable && e.admin_fee_applies) * share * f,
      2,
    );
    feeUnctrl = t.step(
      "Admin fee on uncontrollable",
      round(fee.rate * unctrlFeeBase, 2),
      `${fmtNum(fee.rate)} × ${fmtMoney(unctrlFeeBase)} fee-eligible uncontrollable share (never capped)`,
      "USD",
    );
  }

  let capLimit: number | null = null;
  let cappedCtrl = ctrlShare;
  let feeCtrl = 0;
  let feeInCap = false;
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
            `${fmtMoney(ref)} × (1 + ${fmtNum(rate)})^${years}`,
          ]
        : method === "simple_from_base"
          ? [
              ref * (1 + rate * years),
              `${fmtMoney(ref)} × (1 + ${fmtNum(rate)} × ${years})`,
            ]
          : [ref * (1 + rate), `${fmtMoney(ref)} × (1 + ${fmtNum(rate)})`];
    capLimit = t.step(`Cap limit (${method})`, round(limit, 2), formula, "USD");
    if (prorated)
      capLimit = t.step(
        "Cap limit prorated for occupancy",
        round(capLimit * f, 2),
        `${fmtMoney(capLimit)} × ${fmtNum(f)}`,
        "USD",
      );
    const limitNow = capLimit;
    if (fee && fee.applied === "before_cap") {
      feeCtrl = t.step(
        "Admin fee on controllable (before cap)",
        round(fee.rate * ctrlFeeBase, 2),
        `${fmtNum(fee.rate)} × ${fmtMoney(ctrlFeeBase)} fee-eligible controllable share`,
        "USD",
      );
      feeInCap = fee.capped;
      cappedCtrl = t.step(
        "Controllable after cap",
        Math.min(
          feeInCap ? round(ctrlShare + feeCtrl, 2) : ctrlShare,
          limitNow,
        ),
        feeInCap
          ? "min(tenant controllable + admin fee on it, cap limit)"
          : "min(tenant controllable, cap limit); admin fee added outside the cap",
        "USD",
      );
    } else {
      const base = t.step(
        "Controllable after cap",
        Math.min(ctrlShare, limitNow),
        "min(tenant controllable, cap limit)",
        "USD",
      );
      cappedCtrl = base;
      if (fee) {
        // The cap reduction is spread over controllable lines in proportion to their amounts.
        const eligible = ctrlShare > 0 ? (base * ctrlFeeBase) / ctrlShare : 0;
        feeCtrl = t.step(
          "Admin fee on controllable (after cap)",
          round(fee.rate * eligible, 2),
          `${fmtNum(fee.rate)} × ${fmtMoney(base)} capped × ${fmtMoney(ctrlFeeBase)} fee-eligible ÷ ${fmtMoney(ctrlShare)} controllable`,
          "USD",
        );
        feeInCap = fee.capped;
        if (feeInCap)
          cappedCtrl = t.step(
            "Controllable with admin fee, capped",
            Math.min(round(base + feeCtrl, 2), limitNow),
            "min(capped controllable + admin fee on it, cap limit)",
            "USD",
          );
      }
    }
  } else if (fee) {
    feeCtrl = t.step(
      "Admin fee on controllable",
      round(fee.rate * ctrlFeeBase, 2),
      `${fmtNum(fee.rate)} × ${fmtMoney(ctrlFeeBase)} fee-eligible controllable share (no cap)`,
      "USD",
    );
  }
  const capReduction = round(
    (feeInCap ? round(ctrlShare + feeCtrl, 2) : ctrlShare) - cappedCtrl,
    2,
  );
  const feeOutside = feeInCap ? 0 : feeCtrl;
  const adminFee = fee
    ? t.step(
        "Admin fee",
        round(feeCtrl + feeUnctrl, 2),
        feeInCap
          ? "fee on controllable (subject to the cap) + fee on uncontrollable"
          : "fee on controllable + fee on uncontrollable",
        "USD",
      )
    : 0;

  let deduction = 0;
  const s = input.structure;
  if (s.type === "base_year") {
    deduction = t.step(
      "Base-year deduction",
      round(s.base_year_expenses * share * f, 2),
      `${fmtMoney(s.base_year_expenses)} × ${shareText}`,
      "USD",
    );
    if (input.cap)
      t.warn(
        "Cap applied before the base-year deduction; confirm the lease's order of operations.",
      );
  } else if (s.type === "expense_stop") {
    deduction = t.step(
      "Expense-stop deduction",
      round(s.stop_amount * share * f, 2),
      `${fmtMoney(s.stop_amount)} × ${shareText}`,
      "USD",
    );
    if (input.cap)
      t.warn(
        "Cap applied before the expense-stop deduction; confirm the lease's order of operations.",
      );
  }
  if (fee) {
    if (input.cap)
      t.warn(
        `Admin fee on controllable lines computed ${fee.applied === "before_cap" ? "before" : "after"} the cap and ${fee.capped ? "counted within" : "added outside"} it; confirm the lease's order of operations.`,
      );
    if (s.type !== "net")
      t.warn(
        `Admin fee added to the current-year share before the ${s.type === "base_year" ? "base-year" : "expense-stop"} deduction; confirm whether ${s.type === "base_year" ? "base_year_expenses" : "stop_amount"} already includes a fee.`,
      );
    const onFee = adjusted.filter(
      (e) => e.admin_fee_applies && /admin|manag/i.test(e.category),
    );
    if (onFee.length)
      t.warn(
        `Admin fee charged on ${onFee.map((e) => e.category).join(", ")}; confirm the lease allows a fee on a fee, or set admin_fee_applies false on those lines.`,
      );
    if (adjusted.some((e) => !e.controllable && e.admin_fee_applies))
      t.warn(
        "Admin fee base includes uncontrollable lines; many leases exclude taxes, insurance, and utilities from the fee. Set admin_fee_applies false on lines the lease excludes.",
      );
  }

  const charge = t.step(
    "Tenant CAM charge",
    round(
      Math.max(
        0,
        cappedCtrl + feeOutside + unctrlShare + feeUnctrl - deduction,
      ),
      2,
    ),
    fee
      ? `max(0, ${fmtMoney(cappedCtrl)} + ${fmtMoney(feeOutside)} fee + ${fmtMoney(unctrlShare)} + ${fmtMoney(feeUnctrl)} fee − ${fmtMoney(deduction)})`
      : `max(0, ${fmtMoney(cappedCtrl)} + ${fmtMoney(unctrlShare)} − ${fmtMoney(deduction)})`,
    "USD",
  );
  const balance = t.step(
    "Balance due",
    round(charge - input.estimates_paid, 2),
    `${fmtMoney(charge)} − ${fmtMoney(input.estimates_paid)} estimates paid`,
    "USD",
  );
  t.step(
    "Rounding",
    "each tenant share, fee, cap limit, and deduction is rounded to the cent half away from zero before it is combined",
  );
  if (!input.cap) t.warn("No CAM cap supplied; confirm the lease has none.");

  return t.result("calc.cam_reconciliation", 2, {
    recoverable_expenses: recoverableTotal,
    grossed_up_expenses: grossed,
    tenant_share_controllable: ctrlShare,
    tenant_share_uncontrollable: unctrlShare,
    cap_limit: capLimit,
    cap_reduction: capReduction,
    admin_fee: adminFee,
    occupancy_fraction: round(f, 6),
    structure_deduction: deduction,
    tenant_charge: charge,
    estimates_paid: input.estimates_paid,
    balance_due: balance,
  });
}
