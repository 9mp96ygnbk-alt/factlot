import { z } from "zod";

import {
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  nthRoot,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

const AnnualRate = z.number().finite().min(0).lt(1);

/**
 * How an annual discount or reinvestment yield becomes a monthly rate. Notes differ:
 * most discount monthly at the stated rate ÷ 12; some quote a Treasury yield on its
 * semiannual bond-equivalent basis and discount at the equivalent monthly rate.
 */
export const DiscountConvention = z
  .enum(["monthly", "semiannual"])
  .default("monthly")
  .describe(
    "Compounding convention for the discount rate. monthly (default): monthly rate = annual ÷ 12. semiannual: annual is a bond-equivalent yield, monthly rate = (1 + annual ÷ 2)^(1/6) − 1. Lenders differ; read the note.",
  );

const YieldPoint = z.object({
  months: z
    .number()
    .int()
    .min(1)
    .describe(
      "Months from the payoff date up to and including which this yield applies; points in ascending order.",
    ),
  rate: AnnualRate.describe(
    "Annual yield on replacement securities maturing at or before that month, e.g. 0.042.",
  ),
});

export const PrepaymentInput = z
  .object({
    balance: z
      .number()
      .finite()
      .positive()
      .describe("Outstanding principal balance at the payoff date, USD."),
    note_rate_annual: AnnualRate.describe(
      "Fixed annual note rate, e.g. 0.055.",
    ),
    remaining_term_months: z
      .number()
      .int()
      .min(1)
      .max(600)
      .describe(
        "Months from the payoff date to the loan's maturity date (the balloon is due with the final payment).",
      ),
    amortization_months: z
      .number()
      .int()
      .min(0)
      .max(720)
      .describe(
        "Remaining amortization basis in months at the payoff date (e.g. 300 for a 30-year schedule with 5 years elapsed); 0 for interest-only. Must be at least remaining_term_months.",
      ),
    accrued_interest: NonNegMoney.default(0).describe(
      "Accrued but unpaid interest to the payoff date, USD; added to the total payoff.",
    ),
    prepayment: z
      .discriminatedUnion("type", [
        z
          .object({
            type: z.literal("yield_maintenance"),
            treasury_rate_annual: AnnualRate.describe(
              "Yield on the reference Treasury (usually the one maturing closest to the loan's maturity), e.g. 0.041.",
            ),
            spread_annual: AnnualRate.default(0).describe(
              "Spread added to the Treasury yield for discounting, e.g. 0.005 when the note says 'Treasury plus 50 basis points'. Default 0 (Treasury flat).",
            ),
            minimum_pct: z
              .number()
              .finite()
              .min(0)
              .lt(1)
              .default(0.01)
              .describe(
                "Minimum premium as a fraction of the balance, e.g. 0.01 for a 1% floor (default). 0 for no floor.",
              ),
            basis: z
              .enum(["pv_of_payments", "rate_differential"])
              .default("pv_of_payments")
              .describe(
                "pv_of_payments (default): premium = PV of the remaining scheduled payments at the discount rate − balance. rate_differential: premium = PV of (note rate − discount rate) ÷ 12 × scheduled balance for each remaining month.",
              ),
            discount_convention: DiscountConvention,
          })
          .describe("Yield maintenance."),
        z
          .object({
            type: z.literal("step_down"),
            loan_month: z
              .number()
              .int()
              .min(1)
              .describe(
                "Loan month (1 = first month after origination) in which the payoff occurs.",
              ),
            schedule: z
              .array(
                z.object({
                  through_month: z
                    .number()
                    .int()
                    .min(1)
                    .describe(
                      "Last loan month in which this percentage applies.",
                    ),
                  pct: z
                    .number()
                    .finite()
                    .min(0)
                    .lt(1)
                    .describe(
                      "Premium as a fraction of the balance, e.g. 0.05 for 5%.",
                    ),
                }),
              )
              .min(1)
              .describe(
                "Step-down schedule in ascending through_month order, e.g. 5-4-3-2-1. After the last through_month the loan is open (0%).",
              ),
          })
          .describe("Step-down (declining percentage) premium."),
        z
          .object({
            type: z.literal("fixed_pct"),
            pct: z
              .number()
              .finite()
              .min(0)
              .lt(1)
              .describe("Premium as a fraction of the balance, e.g. 0.02."),
          })
          .describe("Flat percentage premium."),
        z
          .object({
            type: z.literal("defeasance"),
            replacement_yield: z
              .union([
                AnnualRate.describe(
                  "One flat annual yield for all replacement securities.",
                ),
                z
                  .array(YieldPoint)
                  .min(1)
                  .describe(
                    "Yield curve as a step function: each payment uses the first point whose months ≥ its month; beyond the last point, the last rate.",
                  ),
              ])
              .describe(
                "Yield on the government securities bought to fund the remaining payments: a flat annual rate, or a list of {months, rate} points.",
              ),
            costs: NonNegMoney.default(0).describe(
              "Stated transaction costs, USD: defeasance consultant, legal, accountant, rating agency, servicer and custodian fees.",
            ),
            discount_convention: DiscountConvention,
          })
          .describe(
            "Defeasance: buy securities that replicate the remaining payments.",
          ),
      ])
      .describe("Prepayment provision from the note."),
  })
  .superRefine((v, ctx) => {
    if (
      v.amortization_months !== 0 &&
      v.amortization_months < v.remaining_term_months
    )
      ctx.addIssue({
        code: "custom",
        path: ["amortization_months"],
        message:
          "amortization_months must be 0 (interest-only) or at least remaining_term_months",
      });
    const p = v.prepayment;
    if (p.type === "step_down") {
      let last = 0;
      p.schedule.forEach((s, i) => {
        if (s.through_month <= last)
          ctx.addIssue({
            code: "custom",
            path: ["prepayment", "schedule", i, "through_month"],
            message: "through_month must be strictly increasing",
          });
        last = s.through_month;
      });
    }
    if (p.type === "defeasance" && Array.isArray(p.replacement_yield)) {
      let last = 0;
      p.replacement_yield.forEach((y, i) => {
        if (y.months <= last)
          ctx.addIssue({
            code: "custom",
            path: ["prepayment", "replacement_yield", i, "months"],
            message: "months must be strictly increasing",
          });
        last = y.months;
      });
    }
  });
export type PrepaymentInput = z.input<typeof PrepaymentInput>;

export interface Prepayment {
  prepayment_type:
    "yield_maintenance" | "step_down" | "fixed_pct" | "defeasance";
  monthly_payment: number;
  balloon_at_maturity: number;
  total_remaining_payments: number;
  prepayment_premium: number;
  total_payoff: number;
  /** Premium ÷ balance, as a fraction (0.0321 = 3.21%). */
  effective_cost_ratio: number;
  detail: Record<string, number | string | null>;
}

/** Monthly rate for an annual rate under a discount convention. */
export function monthlyRate(
  annual: number,
  convention: "monthly" | "semiannual",
): number {
  return convention === "monthly"
    ? annual / 12
    : nthRoot(1 + annual / 2, 6) - 1;
}

/**
 * Prepayment premium and total payoff on a fixed-rate loan under yield maintenance,
 * step-down, flat percentage, or defeasance, with the standard formulas shown.
 */
export function prepaymentAndDefeasance(
  raw: PrepaymentInput,
): CalcResult<Prepayment> {
  const input = parseInput(PrepaymentInput, raw);
  const t = new Trace();
  const B = input.balance;
  const n = input.remaining_term_months;
  const i = input.note_rate_annual / 12;
  const A = input.amortization_months;

  const payment =
    A === 0 ? B * i : i === 0 ? B / A : (B * i) / (1 - powInt(1 + i, -A));
  const pmt = t.step(
    "Monthly payment",
    round(payment, 2),
    A === 0
      ? `interest-only: ${fmtMoney(B)} × ${fmtPct(input.note_rate_annual, 4)} ÷ 12`
      : `${fmtMoney(B)} × i ÷ (1 − (1 + i)^−${A}), i = ${fmtPct(input.note_rate_annual, 4)} ÷ 12`,
    "USD",
  );

  // Scheduled opening balances and payments for months 1..n; the balloon rides on month n.
  const openings: number[] = [];
  let bal = B;
  for (let k = 1; k <= n; k++) {
    openings.push(bal);
    bal = bal + bal * i - payment;
  }
  const balloonRaw = Math.max(0, bal);
  const balloon = t.step(
    "Balloon at maturity",
    round(balloonRaw, 2),
    `scheduled balance after ${n} payments`,
    "USD",
  );
  const pays: number[] = openings.map((_, idx) =>
    idx === n - 1 ? payment + balloonRaw : payment,
  );
  let totalPay = 0;
  for (const p of pays) totalPay += p;
  const totalPayments = t.step(
    "Remaining scheduled payments",
    round(totalPay, 2),
    `${n} × ${fmtMoney(payment)} + balloon`,
    "USD",
  );

  const p = input.prepayment;
  let premium: number;
  const detail: Record<string, number | string | null> = {};

  if (p.type === "yield_maintenance") {
    const d = p.treasury_rate_annual + p.spread_annual;
    const m = monthlyRate(d, p.discount_convention);
    t.step(
      "Discount rate",
      round(m, 10),
      `(${fmtPct(p.treasury_rate_annual, 4)} Treasury + ${fmtPct(p.spread_annual, 4)} spread) → monthly, ${p.discount_convention} convention`,
    );
    let computed: number;
    if (p.basis === "pv_of_payments") {
      let pv = 0;
      for (let k = 1; k <= n; k++)
        pv += (pays[k - 1] as number) * powInt(1 + m, -k);
      const pvRounded = t.step(
        "PV of remaining payments",
        round(pv, 2),
        `Σ payment_k ÷ (1 + ${round(m, 8)})^k, k = 1..${n}`,
        "USD",
      );
      computed = t.step(
        "Yield maintenance (before floor)",
        round(pv - B, 2),
        `${fmtMoney(pvRounded)} − ${fmtMoney(B)} balance`,
        "USD",
      );
      detail.pv_of_remaining_payments = pvRounded;
    } else {
      const diff = (input.note_rate_annual - d) / 12;
      let pv = 0;
      for (let k = 1; k <= n; k++)
        pv += diff * (openings[k - 1] as number) * powInt(1 + m, -k);
      computed = t.step(
        "Yield maintenance (before floor)",
        round(pv, 2),
        `Σ (${fmtPct(input.note_rate_annual, 4)} − ${fmtPct(d, 4)}) ÷ 12 × balance_(k−1) ÷ (1 + ${round(m, 8)})^k, k = 1..${n}`,
        "USD",
      );
    }
    const floor = t.step(
      "Minimum premium",
      round(B * p.minimum_pct, 2),
      `${fmtMoney(B)} × ${fmtPct(p.minimum_pct, 4)}`,
      "USD",
    );
    premium = t.step(
      "Prepayment premium",
      Math.max(computed, floor),
      "max(yield maintenance, minimum)",
      "USD",
    );
    detail.basis = p.basis;
    detail.discount_rate_annual = round(d, 8);
    detail.discount_rate_monthly = round(m, 10);
    detail.computed_premium = computed;
    detail.minimum_premium = floor;
    t.warn(
      `Yield maintenance computed on the ${p.basis} basis, discounting ${p.discount_convention} at Treasury${p.spread_annual > 0 ? " plus spread" : " flat"}; notes differ on all three, so match them to the loan documents.`,
    );
  } else if (p.type === "step_down") {
    const tier = p.schedule.find((s) => p.loan_month <= s.through_month);
    const pct = tier ? tier.pct : 0;
    t.step(
      "Applicable percentage",
      pct,
      tier
        ? `loan month ${p.loan_month} ≤ ${tier.through_month}`
        : `loan month ${p.loan_month} is after the last step (open)`,
    );
    premium = t.step(
      "Prepayment premium",
      round(B * pct, 2),
      `${fmtMoney(B)} × ${fmtPct(pct, 4)}`,
      "USD",
    );
    detail.applied_pct = pct;
    detail.loan_month = p.loan_month;
    t.warn(
      "Lockout periods are not modeled: if the note is locked out in this loan month, it cannot be prepaid at any premium.",
    );
  } else if (p.type === "fixed_pct") {
    premium = t.step(
      "Prepayment premium",
      round(B * p.pct, 2),
      `${fmtMoney(B)} × ${fmtPct(p.pct, 4)}`,
      "USD",
    );
    detail.applied_pct = p.pct;
  } else {
    const curve =
      typeof p.replacement_yield === "number"
        ? [{ months: n, rate: p.replacement_yield }]
        : p.replacement_yield;
    const lastRate = (curve[curve.length - 1] as { rate: number }).rate;
    const yieldFor = (k: number): number =>
      curve.find((pt) => k <= pt.months)?.rate ?? lastRate;
    let cost = 0;
    for (let k = 1; k <= n; k++) {
      const m = monthlyRate(yieldFor(k), p.discount_convention);
      cost += (pays[k - 1] as number) * powInt(1 + m, -k);
    }
    const securities = t.step(
      "Cost of replacement securities",
      round(cost, 2),
      typeof p.replacement_yield === "number"
        ? `Σ payment_k ÷ (1 + y)^k at ${fmtPct(p.replacement_yield, 4)} (${p.discount_convention})`
        : `Σ payment_k ÷ (1 + y_k)^k with y_k from the ${curve.length}-point curve (${p.discount_convention})`,
      "USD",
    );
    const costs = t.step(
      "Defeasance costs",
      round(p.costs, 2),
      "as stated",
      "USD",
    );
    premium = t.step(
      "Prepayment premium",
      round(securities + costs - B, 2),
      `${fmtMoney(securities)} + ${fmtMoney(costs)} − ${fmtMoney(B)} balance`,
      "USD",
    );
    detail.securities_cost = securities;
    detail.stated_costs = costs;
    t.warn(
      "Securities cost approximates the defeasance portfolio by discounting each payment at the stated yield; the actual portfolio is priced from specific Treasury or agency securities and may leave a residual (float) value. Get a consultant's quote before relying on it.",
    );
    if (premium < 0)
      t.warn(
        "Replacement yields exceed the note rate, so the securities cost less than the balance; whether the borrower keeps that benefit depends on the loan documents.",
      );
  }

  const payoff = t.step(
    "Total payoff",
    round(B + premium + input.accrued_interest, 2),
    `${fmtMoney(B)} balance + ${fmtMoney(premium)} premium + ${fmtMoney(input.accrued_interest)} accrued interest`,
    "USD",
  );
  const ratio = t.step(
    "Effective cost",
    round(premium / B, 6),
    `${fmtMoney(premium)} ÷ ${fmtMoney(B)} = ${fmtPct(premium / B, 3)} of balance`,
  );

  return t.result("calc.prepayment_and_defeasance", 1, {
    prepayment_type: p.type,
    monthly_payment: pmt,
    balloon_at_maturity: balloon,
    total_remaining_payments: totalPayments,
    prepayment_premium: premium,
    total_payoff: payoff,
    effective_cost_ratio: ratio,
    detail,
  });
}
