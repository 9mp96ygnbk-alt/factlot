import { z } from "zod";

import {
  CalcInputError,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

export const DebtSizingInput = z
  .object({
    /** Underwritten net operating income, USD/yr. */
    noi: z.number().finite().positive(),
    /** Appraised or underwritten value, USD. Required when max_ltv is set. */
    value: z.number().finite().positive().optional(),
    /** Annual interest rate, e.g. 0.065. */
    rate_annual: z.number().finite().min(0).lt(1),
    /** Amortization in years; 0 means interest-only. */
    amortization_years: z.number().int().min(0).max(50),
    max_ltv: z.number().gt(0).lte(1).optional(),
    min_dscr: z.number().gt(0).optional(),
    min_debt_yield: z.number().gt(0).lt(1).optional(),
    /** Round the final loan amount down to this increment (lenders often use 1,000 or 10,000). */
    round_down_to: z.number().positive().default(1),
  })
  .refine(
    (v) =>
      v.max_ltv !== undefined ||
      v.min_dscr !== undefined ||
      v.min_debt_yield !== undefined,
    {
      message: "provide at least one of max_ltv, min_dscr, min_debt_yield",
    },
  )
  .refine((v) => v.max_ltv === undefined || v.value !== undefined, {
    message: "value is required when max_ltv is set",
    path: ["value"],
  });
export type DebtSizingInput = z.input<typeof DebtSizingInput>;

export type Constraint = "ltv" | "dscr" | "debt_yield";

export interface DebtSizing {
  max_loan: number;
  binding_constraint: Constraint;
  loan_by_constraint: Partial<Record<Constraint, number>>;
  /** Annual debt service ÷ loan amount. */
  annual_constant: number;
  annual_debt_service: number;
  resulting: { ltv: number | null; dscr: number; debt_yield: number };
}

/** Annual debt service per dollar of loan, with monthly payments. */
export function annualConstant(
  rateAnnual: number,
  amortizationYears: number,
): number {
  if (amortizationYears === 0) return rateAnnual;
  const n = amortizationYears * 12;
  const r = rateAnnual / 12;
  return r === 0 ? 12 / n : (12 * r) / (1 - (1 + r) ** -n);
}

/** Maximum loan under LTV, DSCR, and debt-yield tests, and which test binds. */
export function debtSizing(raw: DebtSizingInput): CalcResult<DebtSizing> {
  const input = parseInput(DebtSizingInput, raw);
  const t = new Trace();
  const k = t.step(
    "Annual constant",
    annualConstant(input.rate_annual, input.amortization_years),
    input.amortization_years === 0
      ? `interest-only: ${fmtPct(input.rate_annual, 3)}`
      : `12 × r ÷ (1 − (1 + r)^−n), r = ${input.rate_annual}/12, n = ${input.amortization_years * 12}`,
  );

  const loans: Partial<Record<Constraint, number>> = {};
  if (input.max_ltv !== undefined && input.value !== undefined) {
    loans.ltv = t.step(
      "Loan at max LTV",
      input.value * input.max_ltv,
      `${fmtMoney(input.value)} × ${input.max_ltv}`,
      "USD",
    );
  }
  if (input.min_dscr !== undefined) {
    loans.dscr = t.step(
      "Loan at min DSCR",
      input.noi / input.min_dscr / k,
      `(${fmtMoney(input.noi)} ÷ ${input.min_dscr}) ÷ ${round(k, 6)}`,
      "USD",
    );
  }
  if (input.min_debt_yield !== undefined) {
    loans.debt_yield = t.step(
      "Loan at min debt yield",
      input.noi / input.min_debt_yield,
      `${fmtMoney(input.noi)} ÷ ${input.min_debt_yield}`,
      "USD",
    );
  }

  const entries = Object.entries(loans) as [Constraint, number][];
  const [binding, minLoan] = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (minLoan <= 0)
    throw new CalcInputError("constraints produce a non-positive loan");
  const loan = t.step(
    "Max loan",
    Math.floor(minLoan / input.round_down_to) * input.round_down_to,
    `min(${entries.map(([c, v]) => `${c} ${fmtMoney(v)}`).join(", ")}), rounded down to ${input.round_down_to}`,
    "USD",
  );
  t.step("Binding constraint", binding);
  const ds = round(loan * k, 2);

  return t.result("calc.debt_sizing", 1, {
    max_loan: loan,
    binding_constraint: binding,
    loan_by_constraint: Object.fromEntries(
      entries.map(([c, v]) => [c, round(v, 2)]),
    ),
    annual_constant: round(k, 8),
    annual_debt_service: ds,
    resulting: {
      ltv: input.value !== undefined ? round(loan / input.value, 4) : null,
      dscr: round(input.noi / ds, 4),
      debt_yield: round(input.noi / loan, 4),
    },
  });
}
