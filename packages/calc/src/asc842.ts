import { z } from "zod";

import {
  CalcInputError,
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

/**
 * Remeasurement events a lessee can state deterministically. Each maps to the ASC 842
 * paragraph that requires (or, for an index change alone, does not require) remeasurement.
 */
export const RemeasurementEvent = z.enum([
  "modification_extend_term",
  "modification_shorten_term",
  "modification_change_in_payments",
  "reassessment_of_term_or_option",
  "contingency_resolved",
  "residual_value_guarantee_change",
  "index_or_rate_change",
]);
export type RemeasurementEvent = z.infer<typeof RemeasurementEvent>;

/** Events for which ASC 842-10-35-5 (and 842-10-25-11 for modifications) require an updated discount rate. */
const RATE_UPDATE_EVENTS: readonly RemeasurementEvent[] = [
  "modification_extend_term",
  "modification_shorten_term",
  "modification_change_in_payments",
  "reassessment_of_term_or_option",
];
/** Events for which ASC 842-10-35-5(b)-(c) keep the original discount rate. */
const RATE_KEEP_EVENTS: readonly RemeasurementEvent[] = [
  "contingency_resolved",
  "residual_value_guarantee_change",
];

export const LeaseRemeasurementInput = z
  .object({
    classification: z
      .enum(["operating", "finance"])
      .describe(
        "Lessee classification (ASC 842-10-25-2): operating (single straight-line lease cost) or finance (interest on the liability plus straight-line ROU amortization).",
      ),
    payments: z
      .array(
        z.object({
          period: z
            .number()
            .int()
            .min(1)
            .max(1200)
            .describe(
              "Period index counted from the remeasurement date (1 = first remaining period).",
            ),
          amount: NonNegMoney.describe(
            "Lease payment due in that period after the event, USD for the period (a monthly amount when periods_per_year is 12, not annualized): fixed and in-substance fixed payments, less incentives receivable (ASC 842-10-30-5).",
          ),
        }),
      )
      .min(1)
      .max(1200)
      .describe(
        "Remaining lease payments after the event, in ascending period order. Periods not listed carry no payment (rent-free).",
      ),
    remaining_periods: z
      .number()
      .int()
      .min(1)
      .max(1200)
      .optional()
      .describe(
        "Remaining lease term in periods after the event. Defaults to the last period index in payments; set it higher when the final periods are rent-free.",
      ),
    payment_timing: z
      .enum(["begin", "end"])
      .default("end")
      .describe(
        "Whether each payment falls at the beginning (in advance) or end (in arrears) of its period.",
      ),
    discount_rate_annual: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .describe(
        "Annual discount rate applied to the remaining payments, e.g. 0.06. Nominal: the periodic rate is this ÷ periods_per_year.",
      ),
    periods_per_year: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(12)
      .describe("Payment periods per year (12 for monthly, 4 for quarterly)."),
    discount_rate_updated: z
      .boolean()
      .describe(
        "True when discount_rate_annual was determined at the remeasurement date (ASC 842-10-35-5: required for modifications and lease-term or purchase-option reassessments); false when it is the rate from commencement (kept for contingency resolutions and residual value guarantee changes).",
      ),
    liability_before: NonNegMoney.describe(
      "Carrying amount of the lease liability immediately before the remeasurement, USD.",
    ),
    rou_asset_before: NonNegMoney.describe(
      "Carrying amount of the right-of-use asset immediately before the remeasurement, USD (after any impairment).",
    ),
    event: RemeasurementEvent.describe(
      "What triggered the remeasurement: modification_extend_term / modification_shorten_term / modification_change_in_payments (a modification not accounted for as a separate contract, ASC 842-10-25-8 and 25-11), reassessment_of_term_or_option (ASC 842-10-35-1 and 35-4(c)), contingency_resolved (variable payments became fixed, ASC 842-10-35-4(b)), residual_value_guarantee_change (ASC 842-10-35-4(c)(3)), or index_or_rate_change (ASC 842-10-35-4: not a remeasurement trigger by itself; computed as if remeasured for another reason).",
    ),
  })
  .superRefine((v, ctx) => {
    let last = 0;
    v.payments.forEach((p, i) => {
      if (p.period <= last)
        ctx.addIssue({
          code: "custom",
          path: ["payments", i, "period"],
          message: "periods must be strictly increasing",
        });
      last = p.period;
    });
    if (v.remaining_periods !== undefined && v.remaining_periods < last)
      ctx.addIssue({
        code: "custom",
        path: ["remaining_periods"],
        message: "remaining_periods must be at least the last payment period",
      });
  });
export type LeaseRemeasurementInput = z.input<typeof LeaseRemeasurementInput>;

export interface RemeasurementPeriod {
  period: number;
  opening_liability: number;
  payment: number;
  interest: number;
  closing_liability: number;
  amortization: number;
  closing_rou_asset: number;
  lease_cost: number;
}

export interface LeaseRemeasurement {
  classification: "operating" | "finance";
  remaining_periods: number;
  periodic_rate: number;
  total_remaining_payments: number;
  new_lease_liability: number;
  liability_adjustment: number;
  rou_asset_adjustment: number;
  gain_recognized: number;
  new_rou_asset: number;
  /** Operating leases: the single straight-line lease cost per period (ASC 842-20-25-6). */
  straight_line_lease_cost: number | null;
  /** Finance leases: straight-line ROU amortization per period (ASC 842-20-35-7). */
  periodic_amortization: number | null;
  /** Σ schedule interest (the schedule foots: every total is the sum of its rows, in cents). */
  total_interest: number;
  total_amortization: number;
  total_lease_cost: number;
  schedule: RemeasurementPeriod[];
}

/**
 * Lessee remeasurement of a lease liability and right-of-use asset under ASC 842
 * (842-10-35-4 triggers, 842-20-35-4 asset adjustment), with the post-remeasurement
 * amortization table.
 */
export function leaseRemeasurementAsc842(
  raw: LeaseRemeasurementInput,
): CalcResult<LeaseRemeasurement> {
  const input = parseInput(LeaseRemeasurementInput, raw);
  const t = new Trace();
  const lastPeriod = input.payments[input.payments.length - 1]?.period ?? 1;
  const n = input.remaining_periods ?? lastPeriod;
  const byPeriod = new Map(input.payments.map((p) => [p.period, p.amount]));
  // Payments are taken to the cent, so every schedule row is in whole cents.
  const pay = (k: number): number => round(byPeriod.get(k) ?? 0, 2);
  const inAdvance = input.payment_timing === "begin";

  t.step("Event", input.event, eventCitation(input.event));
  t.step("Remaining term", n, "periods after the remeasurement date");
  const r = t.step(
    "Periodic discount rate",
    input.discount_rate_annual / input.periods_per_year,
    `${fmtPct(input.discount_rate_annual, 4)} ÷ ${input.periods_per_year}${input.discount_rate_updated ? " (rate updated at remeasurement, ASC 842-10-35-5)" : " (original rate retained)"}`,
  );

  let total = 0;
  let pv = 0;
  for (let k = 1; k <= n; k++) {
    const p = pay(k);
    total += p;
    pv += p * powInt(1 + r, inAdvance ? -(k - 1) : -k);
  }
  const totalPayments = t.step(
    "Remaining lease payments",
    round(total, 2),
    "Σ payment_k, k = 1..n",
    "USD",
  );
  const newLiability = t.step(
    "New lease liability",
    round(pv, 2),
    `ASC 842-10-35-4 and 842-20-35-3: Σ payment_k ÷ (1 + r)^${inAdvance ? "(k − 1)" : "k"}, r = ${round(r, 8)}, payments in ${inAdvance ? "advance" : "arrears"}`,
    "USD",
  );
  const liabilityAdj = t.step(
    "Liability adjustment",
    round(newLiability - input.liability_before, 2),
    `${fmtMoney(newLiability)} − ${fmtMoney(input.liability_before)} carrying amount`,
    "USD",
  );
  const rouAdj = t.step(
    "ROU asset adjustment",
    round(Math.max(liabilityAdj, -input.rou_asset_before), 2),
    `ASC 842-20-35-4: liability change adjusts the ROU asset, floored at −${fmtMoney(input.rou_asset_before)} so the asset is not reduced below zero`,
    "USD",
  );
  const gain = t.step(
    "Gain recognized",
    round(rouAdj - liabilityAdj, 2),
    "ASC 842-20-35-4: remeasurement in excess of the ROU asset carrying amount goes to profit or loss",
    "USD",
  );
  const newRou = t.step(
    "New ROU asset",
    round(input.rou_asset_before + rouAdj, 2),
    `${fmtMoney(input.rou_asset_before)} + ${fmtMoney(rouAdj)}`,
    "USD",
  );

  const operating = input.classification === "operating";
  // Operating: the total lease cost over the remaining term is fixed in cents; every period
  // takes the straight-line amount and the last takes what is left (ASC 842-20-25-6).
  const totalCost = round(totalPayments + newRou - newLiability, 2);
  let slCost = 0;
  let amortPer = 0;
  if (operating) {
    slCost = t.step(
      "Straight-line lease cost",
      round(totalCost / n, 2),
      `ASC 842-20-25-6: (remaining payments ${fmtMoney(totalPayments)} + ROU ${fmtMoney(newRou)} − liability ${fmtMoney(newLiability)}) ÷ ${n}`,
      "USD/period",
    );
  } else {
    amortPer = t.step(
      "ROU amortization per period",
      round(newRou / n, 2),
      `ASC 842-20-35-7: ${fmtMoney(newRou)} ÷ ${n} straight-line over the remaining term`,
      "USD/period",
    );
  }
  t.step(
    "Schedule",
    operating
      ? "ASC 842-20-25-6 and 842-20-35-3: interest = opening liability × r; ROU amortization = straight-line cost − interest"
      : "ASC 842-20-25-5 and 842-20-35-1: interest = opening liability × r; lease cost = interest + amortization",
    inAdvance
      ? "payment in advance: interest accrues on (opening liability − payment)"
      : "payment in arrears: interest accrues on the opening liability",
  );
  t.step(
    "Rounding",
    `every row is in cents and rolls forward exactly: closing liability = opening − payment + interest, closing ROU = opening ROU − amortization; interest is rounded to the cent half away from zero each period; the final period's interest is the amount that closes the liability at 0.00, ${operating ? "and its lease cost is total lease cost less the earlier periods, so the ROU asset also closes at 0.00" : "and its amortization is the ROU asset left, so the ROU asset also closes at 0.00"}; totals are the sums of the rows`,
  );

  const schedule: RemeasurementPeriod[] = [];
  let liability = newLiability;
  let rou = newRou;
  let sumInterest = 0;
  let sumAmort = 0;
  let sumCost = 0;
  let trueUp = 0;
  for (let k = 1; k <= n; k++) {
    const last = k === n;
    const opening = liability;
    const p = pay(k);
    const accrued = round((inAdvance ? opening - p : opening) * r, 2);
    const interest = last ? round(p - opening, 2) : accrued;
    if (last) trueUp = round(interest - accrued, 2);
    const closing = round(opening - p + interest, 2);
    let amort: number;
    let cost: number;
    if (operating) {
      cost = last ? round(totalCost - sumCost, 2) : slCost;
      amort = round(cost - interest, 2);
    } else {
      amort = last ? round(newRou - sumAmort, 2) : amortPer;
      cost = round(interest + amort, 2);
    }
    rou = round(rou - amort, 2);
    sumInterest = round(sumInterest + interest, 2);
    sumAmort = round(sumAmort + amort, 2);
    sumCost = round(sumCost + cost, 2);
    schedule.push({
      period: k,
      opening_liability: opening,
      payment: p,
      interest,
      closing_liability: closing,
      amortization: amort,
      closing_rou_asset: rou,
      lease_cost: cost,
    });
    liability = closing;
  }
  t.step(
    "Final-period interest true-up",
    trueUp,
    `period ${n} interest ${fmtMoney(schedule[n - 1]?.interest ?? 0)} versus ${fmtMoney(round((schedule[n - 1]?.interest ?? 0) - trueUp, 2))} at opening liability × r: the cents left by rounding each period`,
    "USD",
  );
  t.step(
    "Total interest",
    sumInterest,
    "Σ row interest = remaining payments − new lease liability",
    "USD",
  );
  t.step(
    "Total lease cost",
    sumCost,
    operating
      ? "Σ row lease cost = remaining payments + new ROU asset − new lease liability"
      : "Σ row lease cost = total interest + new ROU asset",
    "USD",
  );

  if (!input.discount_rate_updated && RATE_UPDATE_EVENTS.includes(input.event))
    t.warn(
      "ASC 842-10-35-5 (and 842-10-25-11 for modifications) require a discount rate determined at the remeasurement date for this event; discount_rate_updated is false.",
    );
  if (input.discount_rate_updated && RATE_KEEP_EVENTS.includes(input.event))
    t.warn(
      "ASC 842-10-35-5(b)-(c): the discount rate is not updated for a contingency resolution or a change in amounts probable under a residual value guarantee; discount_rate_updated is true.",
    );
  if (input.event === "index_or_rate_change")
    t.warn(
      "ASC 842-10-35-4: a change in an index or rate alone does not remeasure the liability; payments are updated for the index only when the liability is remeasured for another reason. Otherwise the difference is variable lease cost in the period incurred.",
    );
  if (input.event === "modification_shorten_term")
    t.warn(
      "ASC 842-10-25-13: a modification that fully or partially terminates the lease requires a proportionate reduction of the ROU asset with a gain or loss. This result applies the ASC 842-20-35-4 liability-change adjustment only; decide whether the shortened term is a partial termination.",
    );
  if (gain > 0)
    t.warn(
      "The liability decrease exceeded the ROU asset carrying amount; the excess is recognized in profit or loss (ASC 842-20-35-4).",
    );
  if (!operating)
    t.warn(
      "Finance-lease amortization runs straight-line over the remaining lease term; use the remaining useful life instead when ownership transfers or a purchase option is reasonably certain (ASC 842-20-35-8).",
    );

  return t.result("calc.lease_remeasurement_asc842", 2, {
    classification: input.classification,
    remaining_periods: n,
    periodic_rate: round(r, 8),
    total_remaining_payments: totalPayments,
    new_lease_liability: newLiability,
    liability_adjustment: liabilityAdj,
    rou_asset_adjustment: rouAdj,
    gain_recognized: gain,
    new_rou_asset: newRou,
    straight_line_lease_cost: operating ? slCost : null,
    periodic_amortization: operating ? null : amortPer,
    total_interest: sumInterest,
    total_amortization: sumAmort,
    total_lease_cost: sumCost,
    schedule,
  });
}

function eventCitation(event: RemeasurementEvent): string {
  switch (event) {
    case "modification_extend_term":
    case "modification_shorten_term":
    case "modification_change_in_payments":
      return "ASC 842-10-25-8 and 25-11: modification not accounted for as a separate contract; remeasure and reallocate at the effective date";
    case "reassessment_of_term_or_option":
      return "ASC 842-10-35-1 and 35-4(c)(1)-(2): change in lease term or purchase-option assessment";
    case "contingency_resolved":
      return "ASC 842-10-35-4(b): contingency resolved so variable payments now meet the definition of lease payments";
    case "residual_value_guarantee_change":
      return "ASC 842-10-35-4(c)(3): change in amounts probable of being owed under a residual value guarantee";
    case "index_or_rate_change":
      return "ASC 842-10-35-4: index or rate changes update payments only when remeasuring for another reason";
    default:
      throw new CalcInputError(`unknown event ${String(event)}`);
  }
}
