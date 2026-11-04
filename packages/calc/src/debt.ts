import { z } from "zod";

import {
  CalcInputError,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  powInt,
  reduceNoise,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

export const DebtSizingInput = z
  .object({
    noi: z
      .number()
      .finite()
      .positive()
      .describe("Underwritten net operating income, USD/yr."),
    value: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe(
        "Appraised or underwritten value, USD. Required when max_ltv is set.",
      ),
    rate_annual: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .describe("Annual interest rate, e.g. 0.065."),
    amortization_years: z
      .number()
      .int()
      .min(0)
      .max(50)
      .describe("Amortization in years; 0 means interest-only."),
    max_ltv: z
      .number()
      .gt(0)
      .lte(1)
      .optional()
      .describe("Maximum loan-to-value, e.g. 0.65."),
    min_dscr: z
      .number()
      .gt(0)
      .optional()
      .describe("Minimum debt service coverage ratio, e.g. 1.25."),
    min_debt_yield: z
      .number()
      .gt(0)
      .lt(1)
      .optional()
      .describe("Minimum debt yield (NOI ÷ loan), e.g. 0.09."),
    round_down_to: z
      .number()
      .positive()
      .default(1)
      .describe(
        "Round the final loan amount down to this increment (lenders often use 1,000 or 10,000).",
      ),
    existing_loan_balance: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe(
        "Balance of the loan being refinanced, USD. Adds a refinance result (shortfall or excess proceeds against the max loan) and a shortfall per stress scenario.",
      ),
    stress: z
      .object({
        noi_shocks: z
          .array(z.number().finite().gt(-1).lt(10))
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Relative NOI changes as decimals, e.g. [-0.05, -0.1, -0.2] for NOI down 5%, 10%, 20%. Omit for no NOI shock.",
          ),
        rate_shocks: z
          .array(z.number().finite().gt(-1).lt(1))
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Absolute changes to rate_annual as decimals, e.g. [0.005, 0.01] for +50 and +100 bp. The stressed rate must stay at or above 0 and below 1. Omit for no rate shock.",
          ),
        value_shocks: z
          .array(z.number().finite().gt(-1).lt(10))
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Relative value changes as decimals, e.g. [-0.1, -0.2]; requires value. Omit for no value shock.",
          ),
        value_moves_with_noi: z
          .boolean()
          .default(false)
          .describe(
            "Also scale value by each NOI shock (value × (1 + noi_shock), a constant cap rate), as a lender repricing value on stressed NOI would.",
          ),
      })
      .optional()
      .describe(
        "Stress table: every combination of the NOI, rate, and value shocks (up to 1,000 scenarios), each sized under the same constraints and rounding. The base result is unchanged.",
      ),
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
  })
  .superRefine((v, ctx) => {
    const st = v.stress;
    if (!st) return;
    if (!st.noi_shocks && !st.rate_shocks && !st.value_shocks)
      ctx.addIssue({
        code: "custom",
        path: ["stress"],
        message: "give at least one of noi_shocks, rate_shocks, value_shocks",
      });
    if ((st.value_shocks || st.value_moves_with_noi) && v.value === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "value is required for value_shocks or value_moves_with_noi",
      });
    (st.rate_shocks ?? []).forEach((d, i) => {
      const r = v.rate_annual + d;
      if (!(r >= 0 && r < 1))
        ctx.addIssue({
          code: "custom",
          path: ["stress", "rate_shocks", i],
          message: `stressed rate ${r} must be at least 0 and below 1`,
        });
    });
  });
export type DebtSizingInput = z.input<typeof DebtSizingInput>;

export type Constraint = "ltv" | "dscr" | "debt_yield";

export interface StressScenario {
  noi_shock: number;
  rate_shock: number;
  value_shock: number;
  noi: number;
  rate_annual: number;
  value: number | null;
  /** 0 when the stressed constraints allow less than one rounding increment. */
  max_loan: number;
  binding_constraint: Constraint;
  annual_debt_service: number;
  ltv: number | null;
  dscr: number | null;
  debt_yield: number | null;
  /** Present when existing_loan_balance is given: max(0, existing − max_loan). */
  refinance_shortfall?: number;
}

export interface Refinance {
  existing_loan_balance: number;
  /** max(0, existing − max_loan): equity needed to retire the existing loan. */
  shortfall: number;
  /** max(0, max_loan − existing): proceeds above the existing balance. */
  excess_proceeds: number;
}

export interface DebtSizing {
  max_loan: number;
  binding_constraint: Constraint;
  loan_by_constraint: Partial<Record<Constraint, number>>;
  /** Annual debt service ÷ loan amount. */
  annual_constant: number;
  annual_debt_service: number;
  resulting: { ltv: number | null; dscr: number; debt_yield: number };
  /** Present only when existing_loan_balance is given. */
  refinance?: Refinance;
  /** Present only when stress is given. */
  stress?: StressScenario[];
}

/** Annual debt service per dollar of loan, with monthly payments. */
export function annualConstant(
  rateAnnual: number,
  amortizationYears: number,
): number {
  if (amortizationYears === 0) return rateAnnual;
  const n = amortizationYears * 12;
  const r = rateAnnual / 12;
  return r === 0 ? 12 / n : (12 * r) / (1 - powInt(1 + r, -n));
}

interface Sized {
  k: number;
  loans: Partial<Record<Constraint, number>>;
  binding: Constraint;
  minLoan: number;
  /** minLoan rounded down to the increment, after reducing binary noise. */
  loan: number;
}

/** The constraint loans and the rounded max loan for one set of NOI, value, and rate. */
function size(
  input: z.output<typeof DebtSizingInput>,
  noi: number,
  value: number | undefined,
  rate: number,
): Sized {
  const k = annualConstant(rate, input.amortization_years);
  const loans: Partial<Record<Constraint, number>> = {};
  if (input.max_ltv !== undefined && value !== undefined)
    loans.ltv = value * input.max_ltv;
  if (input.min_dscr !== undefined) loans.dscr = noi / input.min_dscr / k;
  if (input.min_debt_yield !== undefined)
    loans.debt_yield = noi / input.min_debt_yield;
  const entries = Object.entries(loans) as [Constraint, number][];
  const [binding, minLoan] = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  // Floor after reducing to 15 significant digits, so binary noise such as
  // 0.57 × 10,000,000 = 5699999.999999999 does not cost a whole increment.
  const loan =
    minLoan > 0 && Number.isFinite(minLoan)
      ? Math.floor(reduceNoise(minLoan / input.round_down_to)) *
        input.round_down_to
      : minLoan;
  return { k, loans, binding, minLoan, loan };
}

/** Maximum loan under LTV, DSCR, and debt-yield tests, and which test binds. */
export function debtSizing(raw: DebtSizingInput): CalcResult<DebtSizing> {
  const input = parseInput(DebtSizingInput, raw);
  const t = new Trace();
  const base = size(input, input.noi, input.value, input.rate_annual);
  const k = t.step(
    "Annual constant",
    base.k,
    input.amortization_years === 0
      ? `interest-only: ${fmtPct(input.rate_annual, 3)}`
      : `12 × r ÷ (1 − (1 + r)^−n), r = ${input.rate_annual}/12, n = ${input.amortization_years * 12}`,
  );

  const loans = base.loans;
  if (loans.ltv !== undefined && input.value !== undefined)
    t.step(
      "Loan at max LTV",
      loans.ltv,
      `${fmtMoney(input.value)} × ${input.max_ltv}`,
      "USD",
    );
  if (loans.dscr !== undefined)
    t.step(
      "Loan at min DSCR",
      loans.dscr,
      `(${fmtMoney(input.noi)} ÷ ${input.min_dscr}) ÷ ${round(k, 6)}`,
      "USD",
    );
  if (loans.debt_yield !== undefined)
    t.step(
      "Loan at min debt yield",
      loans.debt_yield,
      `${fmtMoney(input.noi)} ÷ ${input.min_debt_yield}`,
      "USD",
    );

  const entries = Object.entries(loans) as [Constraint, number][];
  const { binding, minLoan } = base;
  if (minLoan <= 0)
    throw new CalcInputError("constraints produce a non-positive loan");
  const loan = t.step(
    "Max loan",
    base.loan,
    `min(${entries.map(([c, v]) => `${c} ${fmtMoney(v)}`).join(", ")}), rounded down to ${input.round_down_to}`,
    "USD",
  );
  if (loan <= 0)
    throw new CalcInputError(
      `the constraints allow ${fmtMoney(minLoan)}, less than one rounding increment (round_down_to ${input.round_down_to}); check value and noi`,
    );
  t.step("Binding constraint", binding);
  const ds = round(loan * k, 2);

  const value: DebtSizing = {
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
  };

  const existing = input.existing_loan_balance;
  if (existing !== undefined) {
    const shortfall = round(Math.max(0, existing - loan), 2);
    value.refinance = {
      existing_loan_balance: existing,
      shortfall: t.step(
        "Refinance shortfall",
        shortfall,
        `max(0, existing ${fmtMoney(existing)} − max loan ${fmtMoney(loan)})`,
        "USD",
      ),
      excess_proceeds: round(Math.max(0, loan - existing), 2),
    };
    if (shortfall > 0)
      t.warn(
        `The max loan is ${fmtMoney(shortfall)} short of the existing ${fmtMoney(existing)} balance; the refinance needs that much equity or a paydown.`,
      );
  }

  const st = input.stress;
  if (st) {
    const noiShocks = st.noi_shocks ?? [0];
    const rateShocks = st.rate_shocks ?? [0];
    const valueShocks = st.value_shocks ?? [0];
    const rows: StressScenario[] = [];
    for (const dn of noiShocks)
      for (const dr of rateShocks)
        for (const dv of valueShocks) {
          const noi = input.noi * (1 + dn);
          const rate = input.rate_annual + dr;
          const v =
            input.value === undefined
              ? undefined
              : input.value * (st.value_moves_with_noi ? 1 + dn : 1) * (1 + dv);
          const sz = size(input, noi, v, rate);
          if (Object.values(sz.loans).some((x) => !Number.isFinite(x)))
            throw new CalcInputError(
              `stress scenario at rate ${rate} gives an unbounded DSCR loan (a 0% interest-only rate); use rate_shocks that keep the rate above 0`,
            );
          const ok = sz.loan > 0 && Number.isFinite(sz.loan);
          const m = ok ? sz.loan : 0;
          const sds = round(m * sz.k, 2);
          const row: StressScenario = {
            noi_shock: dn,
            rate_shock: dr,
            value_shock: dv,
            noi: round(noi, 2),
            rate_annual: round(rate, 8),
            value: v === undefined ? null : round(v, 2),
            max_loan: m,
            binding_constraint: sz.binding,
            annual_debt_service: sds,
            ltv: ok && v !== undefined ? round(m / v, 4) : null,
            dscr: ok && sds > 0 ? round(noi / sds, 4) : null,
            debt_yield: ok ? round(noi / m, 4) : null,
          };
          if (existing !== undefined)
            row.refinance_shortfall = round(Math.max(0, existing - m), 2);
          rows.push(row);
        }
    value.stress = rows;
    const worst = rows.reduce((a, b) => (b.max_loan < a.max_loan ? b : a));
    t.step(
      "Stress scenarios",
      rows.length,
      `${noiShocks.length} NOI × ${rateShocks.length} rate × ${valueShocks.length} value shocks; NOI × (1 + shock), rate + shock, value × ${st.value_moves_with_noi ? "(1 + NOI shock) × " : ""}(1 + shock); same constraints and rounding as the base`,
    );
    t.step(
      "Lowest stressed max loan",
      worst.max_loan,
      `NOI shock ${worst.noi_shock}, rate shock ${worst.rate_shock}, value shock ${worst.value_shock}; binding ${worst.binding_constraint}`,
      "USD",
    );
    if (rows.some((r) => r.max_loan === 0))
      t.warn(
        "In at least one stress scenario the constraints allow less than one rounding increment; its max_loan is 0 and its metrics are null.",
      );
    if (
      st.noi_shocks &&
      !st.value_moves_with_noi &&
      input.max_ltv !== undefined
    )
      t.warn(
        "Value is held fixed under the NOI shocks, so the LTV test ignores them; set value_moves_with_noi or add value_shocks if the lender reprices value on stressed NOI.",
      );
  }

  return t.result("calc.debt_sizing", 3, value);
}
