import { z } from "zod";

import {
  IsoDate,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { addMonths, daysBetween } from "./dates.ts";

export const MAX_LOAN_MONTHS = 600;

const DAY_COUNTS = ["30/360", "actual/360", "actual/365"] as const;

export const AmortizationScheduleInput = z
  .object({
    principal: z
      .number()
      .finite()
      .positive()
      .describe("Loan amount funded, USD."),
    rate_annual: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .describe(
        "Fixed nominal annual interest rate as a decimal, e.g. 0.065 for 6.5%.",
      ),
    payment_frequency: z
      .enum(["monthly", "quarterly"])
      .default("monthly")
      .describe(
        "Payment period: monthly (12 a year) or quarterly (4 a year). Term, amortization, and interest-only months must be whole periods.",
      ),
    term_months: z
      .number()
      .int()
      .min(1)
      .max(MAX_LOAN_MONTHS)
      .describe(
        "Months from funding to maturity, when any remaining balance (the balloon) is repaid.",
      ),
    amortization_months: z
      .number()
      .int()
      .min(0)
      .max(MAX_LOAN_MONTHS)
      .describe(
        "Amortization period in months that sets the level payment after any interest-only period, e.g. 360 for a 30-year schedule; 0 means interest-only to maturity. Must be at least term_months − interest_only_months (a shorter schedule would repay the loan before maturity).",
      ),
    interest_only_months: z
      .number()
      .int()
      .min(0)
      .max(MAX_LOAN_MONTHS)
      .default(0)
      .describe(
        "Months of interest-only payments at the start of the loan; amortization over amortization_months begins after them. At most term_months.",
      ),
    day_count: z
      .enum(DAY_COUNTS)
      .default("30/360")
      .describe(
        'Interest day count: "30/360" (each period is 30 days a month: interest = balance × rate ÷ periods a year), "actual/360" or "actual/365" (balance × rate × actual days in the period ÷ 360 or 365; needs start_date). Under actual day counts the level payment is still computed on a 30/360 basis, as US commercial loans usually are, so the balloon absorbs the difference.',
      ),
    start_date: IsoDate.optional().describe(
      "Funding date, YYYY-MM-DD. Payment k falls k periods later on the same day of the month (clamped to month end); the first period runs from this date to the first payment date. Required for actual/360 and actual/365; optional for 30/360, where it only dates the rows.",
    ),
  })
  .superRefine((v, ctx) => {
    const step = v.payment_frequency === "quarterly" ? 3 : 1;
    for (const key of [
      "term_months",
      "amortization_months",
      "interest_only_months",
    ] as const) {
      const n = v[key] ?? 0;
      if (n % step !== 0)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `must be a whole number of quarters (a multiple of 3) for quarterly payments`,
        });
    }
    const io = v.interest_only_months ?? 0;
    if (io > v.term_months)
      ctx.addIssue({
        code: "custom",
        path: ["interest_only_months"],
        message: "must not exceed term_months",
      });
    else if (
      v.amortization_months > 0 &&
      v.amortization_months < v.term_months - io
    )
      ctx.addIssue({
        code: "custom",
        path: ["amortization_months"],
        message:
          "must be 0 (interest-only) or at least term_months − interest_only_months",
      });
    if ((v.day_count ?? "30/360") !== "30/360" && v.start_date === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["start_date"],
        message: "start_date is required for actual/360 and actual/365",
      });
  });
export type AmortizationScheduleInput = z.input<
  typeof AmortizationScheduleInput
>;

export interface AmortizationRow {
  period: number;
  /** Payment date, when start_date is given. */
  date: string | null;
  /** Days of interest accrual: actual days, or 30 × months per period under 30/360. */
  days: number;
  interest_only: boolean;
  opening_balance: number;
  interest: number;
  principal: number;
  payment: number;
  closing_balance: number;
}

export interface AmortizationSchedule {
  periods: number;
  periods_per_year: number;
  periodic_rate: number;
  /** Level payment after the interest-only period (cents); null when interest-only to maturity. */
  amortizing_payment: number | null;
  /** First interest-only payment (cents); null without an interest-only period. */
  interest_only_payment: number | null;
  /** Principal repaid at maturity beyond the regular final payment's principal. */
  balloon_balance: number;
  final_payment: number;
  maturity_date: string | null;
  total_interest: number;
  total_principal: number;
  total_payments: number;
  schedule: AmortizationRow[];
}

/**
 * A fixed-rate loan schedule with an optional interest-only period and a balloon at maturity,
 * in cents that foot: every row rolls forward exactly and the totals are the row sums.
 */
export function amortizationSchedule(
  raw: AmortizationScheduleInput,
): CalcResult<AmortizationSchedule> {
  const input = parseInput(AmortizationScheduleInput, raw);
  const t = new Trace();
  const quarterly = input.payment_frequency === "quarterly";
  const monthsPer = quarterly ? 3 : 1;
  const p = 12 / monthsPer;
  const n = input.term_months / monthsPer;
  const nIo = input.interest_only_months / monthsPer;
  const nAmort = input.amortization_months / monthsPer;
  const ioToMaturity = nAmort === 0 || nIo >= n;
  const actual = input.day_count !== "30/360";
  const basis = input.day_count === "actual/365" ? 365 : 360;

  const r = t.step(
    "Periodic rate",
    input.rate_annual / p,
    `${fmtPct(input.rate_annual, 4)} ÷ ${p} payments a year`,
  );
  let pmt = 0;
  if (!ioToMaturity) {
    pmt = t.step(
      "Amortizing payment",
      round(
        r === 0
          ? input.principal / nAmort
          : (input.principal * r) / (1 - powInt(1 + r, -nAmort)),
        2,
      ),
      r === 0
        ? `${fmtMoney(input.principal)} ÷ ${nAmort} periods (0% rate)`
        : `P × r ÷ (1 − (1 + r)^−n), P = ${fmtMoney(input.principal)}, r = ${round(r, 10)}, n = ${nAmort} periods (${input.amortization_months} months), rounded to the cent`,
      "USD",
    );
  }
  t.step(
    "Structure",
    ioToMaturity
      ? `interest-only for all ${n} periods; the full principal is due at maturity`
      : `${nIo} interest-only periods, then ${n - nIo} amortizing periods on a ${input.amortization_months}-month schedule; balance due at period ${n}`,
  );
  t.step(
    "Day count",
    input.day_count,
    actual
      ? `interest = opening balance × ${input.rate_annual} × actual days ÷ ${basis}; the level payment is computed on a 30/360 basis`
      : `interest = opening balance × ${round(r, 10)} (every period is ${30 * monthsPer} days)`,
  );
  t.step(
    "Rounding",
    "interest is rounded to the cent half away from zero each period; principal = payment − interest; closing = opening − principal; the final period repays the whole opening balance with its interest, so the loan closes at 0.00 and total principal equals the loan amount",
  );

  const schedule: AmortizationRow[] = [];
  let balance = round(input.principal, 2);
  let prevDate = input.start_date ?? null;
  let sumInterest = 0;
  let sumPrincipal = 0;
  let sumPayments = 0;
  let balloon = 0;
  let ioPayment: number | null = null;
  const negative: number[] = [];
  for (let k = 1; k <= n; k++) {
    const date =
      input.start_date === undefined
        ? null
        : addMonths(input.start_date, k * monthsPer);
    const days =
      actual && date !== null && prevDate !== null
        ? daysBetween(prevDate, date)
        : 30 * monthsPer;
    const opening = balance;
    const interest = round(
      actual ? (opening * input.rate_annual * days) / basis : opening * r,
      2,
    );
    const io = ioToMaturity || k <= nIo;
    const scheduled = io ? 0 : round(pmt - interest, 2);
    let principal = scheduled;
    if (k === n) {
      principal = opening;
      balloon = round(opening - scheduled, 2);
    }
    const payment = round(interest + principal, 2);
    if (io && ioPayment === null) ioPayment = interest;
    if (principal < 0) negative.push(k);
    const closing = round(opening - principal, 2);
    sumInterest = round(sumInterest + interest, 2);
    sumPrincipal = round(sumPrincipal + principal, 2);
    sumPayments = round(sumPayments + payment, 2);
    schedule.push({
      period: k,
      date,
      days,
      interest_only: io,
      opening_balance: opening,
      interest,
      principal,
      payment,
      closing_balance: closing,
    });
    balance = closing;
    prevDate = date;
  }
  const last = schedule[schedule.length - 1] as AmortizationRow;
  t.step(
    "Balloon balance",
    balloon,
    ioToMaturity
      ? "the full principal, repaid at maturity"
      : `period ${n} opening balance ${fmtMoney(last.opening_balance)} − its scheduled principal ${fmtMoney(round(last.opening_balance - balloon, 2))}`,
    "USD",
  );
  t.step(
    "Final payment",
    last.payment,
    `${fmtMoney(last.interest)} interest + ${fmtMoney(last.principal)} principal`,
    "USD",
  );
  t.step(
    "Total interest",
    sumInterest,
    "Σ row interest = total payments − loan amount",
    "USD",
  );
  t.step(
    "Total principal",
    sumPrincipal,
    "Σ row principal = loan amount",
    "USD",
  );

  if (!ioToMaturity && nAmort > n - nIo)
    t.warn(
      `A balloon of ${fmtMoney(balloon)} is due at maturity (period ${n}); the loan must be refinanced or repaid then.`,
    );
  if (ioToMaturity)
    t.warn(
      `Interest-only to maturity: the full ${fmtMoney(input.principal)} is due with the final payment.`,
    );
  if (!ioToMaturity && nAmort === n - nIo && actual && Math.abs(balloon) >= 1)
    t.warn(
      `The payment is computed on a 30/360 basis but interest accrues ${input.day_count}, so a fully amortizing schedule leaves ${fmtMoney(balloon)} to repay with the final payment.`,
    );
  if (negative.length > 0)
    t.warn(
      `Interest exceeds the payment in ${negative.length} period(s) (first: period ${negative[0]}), so the balance grows (negative amortization); check the day count and amortization term.`,
    );
  if (input.start_date !== undefined && Number(input.start_date.slice(8)) > 28)
    t.warn(
      `start_date falls on day ${input.start_date.slice(8)}: payment dates are clamped to month end in shorter months, which changes the actual-day periods; confirm the note's payment date.`,
    );

  return t.result("calc.amortization_schedule", 1, {
    periods: n,
    periods_per_year: p,
    periodic_rate: round(r, 10),
    amortizing_payment: ioToMaturity ? null : pmt,
    interest_only_payment: ioPayment,
    balloon_balance: balloon,
    final_payment: last.payment,
    maturity_date: last.date,
    total_interest: sumInterest,
    total_principal: sumPrincipal,
    total_payments: sumPayments,
    schedule,
  });
}
