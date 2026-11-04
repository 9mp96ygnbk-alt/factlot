import { z } from "zod";

import {
  CamReconciliationInput,
  camReconciliation,
  occupancyFraction,
} from "./cam.ts";
import type { CamReconciliation } from "./cam.ts";
import { CalcInputError, Trace, fmtMoney, parseInput, round } from "./core.ts";
import type { CalcResult } from "./core.ts";

const single = CamReconciliationInput.shape;

const Categories = z.array(z.string().min(1).max(200)).max(1000).default([]);

export const CamBatchTenant = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Tenant or suite label, unique, e.g. "Suite 200 – Acme".'),
  pro_rata_share: single.pro_rata_share,
  structure: single.structure,
  cap: single.cap,
  admin_fee: single.admin_fee,
  occupancy: single.occupancy,
  estimates_paid: single.estimates_paid,
  excluded_categories: Categories.describe(
    "Expense categories this tenant's lease excludes, treated as recoverable: false for this tenant only. Each must match a category in expenses.",
  ),
  admin_fee_excluded_categories: Categories.describe(
    "Expense categories this tenant's lease keeps out of the admin fee base, treated as admin_fee_applies: false for this tenant only. Each must match a category in expenses.",
  ),
});

export const CamReconciliationBatchInput = z
  .object({
    year: single.year,
    expenses: single.expenses.describe(
      "The building's operating expense pool for the year, entered once for every tenant: category, amount, controllable, recoverable, variable, admin_fee_applies.",
    ),
    gross_up: single.gross_up,
    tenants: z
      .array(CamBatchTenant)
      .min(1)
      .max(500)
      .describe(
        "Every tenant to reconcile (up to 500): each one's share, structure (base year or stop), cap, admin fee, occupancy, estimates paid, and lease-specific exclusions. Each statement equals calc_cam_reconciliation for that tenant.",
      ),
  })
  .superRefine((v, ctx) => {
    const categories = new Set(v.expenses.map((e) => e.category));
    const names = new Set<string>();
    v.tenants.forEach((t, i) => {
      if (names.has(t.name))
        ctx.addIssue({
          code: "custom",
          path: ["tenants", i, "name"],
          message: `duplicate tenant name "${t.name}"`,
        });
      names.add(t.name);
      for (const key of [
        "excluded_categories",
        "admin_fee_excluded_categories",
      ] as const)
        t[key].forEach((c, j) => {
          if (!categories.has(c))
            ctx.addIssue({
              code: "custom",
              path: ["tenants", i, key, j],
              message: `"${c}" is not a category in expenses`,
            });
        });
    });
  });
export type CamReconciliationBatchInput = z.input<
  typeof CamReconciliationBatchInput
>;

export type UnrecoveredReason =
  | "unleased_or_vacant"
  | "tenant_exclusions"
  | "gross_up"
  | "caps"
  | "base_year_and_expense_stop"
  | "admin_fees"
  | "zero_floor"
  | "rounding";

export interface CamBuildingReconciliation {
  total_expenses: number;
  non_recoverable_expenses: number;
  recoverable_expenses: number;
  grossed_up_expenses: number;
  tenant_count: number;
  /** Σ pro_rata_share. */
  total_pro_rata_share: number;
  /** Σ pro_rata_share × occupancy fraction. */
  occupied_share: number;
  total_tenant_charges: number;
  total_estimates_paid: number;
  total_balance_due: number;
  /** total_tenant_charges ÷ recoverable_expenses. */
  recovery_ratio: number;
  /** recoverable_expenses − total_tenant_charges; negative is over-recovery. */
  unrecovered: number;
  /** Why: the amounts sum to unrecovered. Negative amounts add to recovery. */
  unrecovered_reasons: {
    reason: UnrecoveredReason;
    amount: number;
    explanation: string;
  }[];
}

export interface CamTenantStatement {
  name: string;
  /** Exactly what calc_cam_reconciliation returns for this tenant. */
  statement: CalcResult<CamReconciliation>;
}

export interface CamReconciliationBatch {
  year: number;
  building: CamBuildingReconciliation;
  tenants: CamTenantStatement[];
}

type BatchInput = z.output<typeof CamReconciliationBatchInput>;

/** The single-tenant calc_cam_reconciliation input for tenant `i` of a batch. */
export function camBatchTenantInput(
  input: BatchInput,
  i: number,
): z.output<typeof CamReconciliationInput> {
  const t = input.tenants[i];
  if (!t) throw new CalcInputError(`no tenant ${i}`);
  const excluded = new Set(t.excluded_categories);
  const noFee = new Set(t.admin_fee_excluded_categories);
  const out: z.output<typeof CamReconciliationInput> = {
    year: input.year,
    pro_rata_share: t.pro_rata_share,
    expenses: input.expenses.map((e) => ({
      ...e,
      recoverable: e.recoverable && !excluded.has(e.category),
      admin_fee_applies: e.admin_fee_applies && !noFee.has(e.category),
    })),
    structure: t.structure,
    estimates_paid: t.estimates_paid,
  };
  if (input.gross_up) out.gross_up = input.gross_up;
  if (t.cap) out.cap = t.cap;
  if (t.admin_fee) out.admin_fee = t.admin_fee;
  if (t.occupancy) out.occupancy = t.occupancy;
  return out;
}

/** Prefix an input error from one tenant's reconciliation with its path in the batch. */
function inTenant(i: number, err: CalcInputError): CalcInputError {
  const issues = err.issues.map((x) => ({
    path: `tenants.${i}.${x.path}`,
    message: x.message,
  }));
  return new CalcInputError(
    issues.length
      ? `invalid input: ${issues.map((x) => `${x.path}: ${x.message}`).join("; ")}`
      : `tenants.${i}: ${err.message}`,
    issues,
  );
}

/**
 * CAM reconciliation for a whole building: the expense pool once, every tenant's statement
 * from the single-tenant calculator (identical to calling it per tenant), and a building
 * reconciliation of what the tenants are billed against the recoverable pool, with the
 * unrecovered amount split by cause.
 */
export function camReconciliationBatch(
  raw: CamReconciliationBatchInput,
): CalcResult<CamReconciliationBatch> {
  const input = parseInput(CamReconciliationBatchInput, raw);
  const t = new Trace();

  const statements: CamTenantStatement[] = input.tenants.map((x, i) => {
    let statement: CalcResult<CamReconciliation>;
    try {
      statement = camReconciliation(camBatchTenantInput(input, i));
    } catch (err) {
      if (err instanceof CalcInputError) throw inTenant(i, err);
      throw err;
    }
    return { name: x.name, statement };
  });

  const sumOf = (xs: number[]): number => xs.reduce((a, v) => a + v, 0);
  const total = t.step(
    "Total expenses",
    round(sumOf(input.expenses.map((e) => e.amount)), 2),
    `Σ ${input.expenses.length} expense lines`,
    "USD",
  );
  const pool = t.step(
    "Recoverable expenses",
    round(
      sumOf(input.expenses.filter((e) => e.recoverable).map((e) => e.amount)),
      2,
    ),
    "Σ lines with recoverable true (before any tenant's own exclusions)",
    "USD",
  );
  const nonRecoverable = round(total - pool, 2);
  let factor = 1;
  if (input.gross_up) {
    const { actual_occupancy: a, target_occupancy: g } = input.gross_up;
    factor = a < g ? g / a : 1;
  }
  const grossed = round(
    sumOf(
      input.expenses
        .filter((e) => e.recoverable)
        .map((e) => (e.variable ? e.amount * factor : e.amount)),
    ),
    2,
  );

  // Unrounded drivers per tenant: occupancy fraction, own exclusions, own gross-up uplift.
  let occupied = 0;
  let exclusions = 0;
  let uplift = 0;
  let floor = 0;
  input.tenants.forEach((x, i) => {
    const one = camBatchTenantInput(input, i);
    const f = occupancyFraction(one, new Trace());
    const w = x.pro_rata_share * f;
    occupied += w;
    const excluded = new Set(x.excluded_categories);
    const lines = input.expenses.filter((e) => e.recoverable);
    exclusions +=
      w *
      sumOf(lines.filter((e) => excluded.has(e.category)).map((e) => e.amount));
    uplift +=
      w *
      sumOf(
        lines
          .filter((e) => e.variable && !excluded.has(e.category))
          .map((e) => e.amount * (factor - 1)),
      );
    const v = statements[i]?.statement.value;
    if (v) {
      const preFloor = round(
        v.tenant_share_controllable +
          v.tenant_share_uncontrollable +
          v.admin_fee -
          v.cap_reduction -
          v.structure_deduction,
        2,
      );
      floor += round(v.tenant_charge - preFloor, 2);
    }
  });
  const values = statements.map((s) => s.statement.value);
  const charges = t.step(
    "Total tenant charges",
    round(sumOf(values.map((v) => v.tenant_charge)), 2),
    `Σ tenant_charge, ${values.length} tenants`,
    "USD",
  );
  const estimates = round(sumOf(values.map((v) => v.estimates_paid)), 2);
  const balance = t.step(
    "Total balance due",
    round(sumOf(values.map((v) => v.balance_due)), 2),
    `Σ balance_due (${fmtMoney(charges)} charges − ${fmtMoney(estimates)} estimates paid)`,
    "USD",
  );
  const unrecovered = t.step(
    "Unrecovered",
    round(pool - charges, 2),
    `${fmtMoney(pool)} recoverable − ${fmtMoney(charges)} billed; negative is over-recovery`,
    "USD",
  );

  const occ = round(occupied, 6);
  const parts: [UnrecoveredReason, number, string][] = [
    [
      "unleased_or_vacant",
      round(pool * (1 - occupied), 2),
      `share of the pool not leased or not occupied in the period: ${fmtMoney(pool)} × (1 − ${occ} Σ share × occupancy fraction)`,
    ],
    [
      "tenant_exclusions",
      round(exclusions, 2),
      "lines individual leases exclude (excluded_categories) × each tenant's share and occupancy",
    ],
    [
      "gross_up",
      round(-uplift, 2),
      "gross-up of variable lines to the target occupancy billed above actual (negative adds to recovery)",
    ],
    [
      "caps",
      round(sumOf(values.map((v) => v.cap_reduction)), 2),
      "controllable-expense caps: Σ cap_reduction",
    ],
    [
      "base_year_and_expense_stop",
      round(sumOf(values.map((v) => v.structure_deduction)), 2),
      "base-year and expense-stop deductions: Σ structure_deduction",
    ],
    [
      "admin_fees",
      round(-sumOf(values.map((v) => v.admin_fee)), 2),
      "admin fees billed on top of expenses (negative adds to recovery)",
    ],
    [
      "zero_floor",
      round(-floor, 2),
      "charges floored at zero where a deduction exceeded the tenant's share (negative adds to recovery)",
    ],
  ];
  const explained = sumOf(parts.map((p) => p[1]));
  parts.push([
    "rounding",
    round(unrecovered - explained, 2),
    "cent rounding of each tenant's shares, fees, and deductions",
  ]);
  for (const [reason, amount, why] of parts)
    t.step(`Unrecovered: ${reason}`, amount, why, "USD");

  if (occupied > 1 + 1e-9)
    t.warn(
      `Pro rata shares weighted by occupancy sum to ${occ}, more than 1: shares overlap or use different denominators, so tenants are billed for more than the whole pool.`,
    );
  if (charges > pool)
    t.warn(
      `Tenants are billed ${fmtMoney(charges - pool)} more than the actual recoverable expenses (over-recovery), usually from gross-up or admin fees; many leases bar the landlord from recovering more than 100% of actual costs.`,
    );
  const withWarnings = statements
    .filter((s) => s.statement.warnings.length > 0)
    .map((s) => s.name);
  if (withWarnings.length)
    t.warn(
      `Statements for ${withWarnings.slice(0, 10).join(", ")}${withWarnings.length > 10 ? ` and ${withWarnings.length - 10} more` : ""} carry warnings (tenants[i].statement.warnings); relay them with each statement.`,
    );

  return t.result("calc.cam_reconciliation_batch", 1, {
    year: input.year,
    building: {
      total_expenses: total,
      non_recoverable_expenses: nonRecoverable,
      recoverable_expenses: pool,
      grossed_up_expenses: grossed,
      tenant_count: statements.length,
      total_pro_rata_share: round(
        sumOf(input.tenants.map((x) => x.pro_rata_share)),
        6,
      ),
      occupied_share: occ,
      total_tenant_charges: charges,
      total_estimates_paid: estimates,
      total_balance_due: balance,
      recovery_ratio: pool > 0 ? round(charges / pool, 4) : 0,
      unrecovered,
      unrecovered_reasons: parts.map(([reason, amount, explanation]) => ({
        reason,
        amount,
        explanation,
      })),
    },
    tenants: statements,
  });
}
