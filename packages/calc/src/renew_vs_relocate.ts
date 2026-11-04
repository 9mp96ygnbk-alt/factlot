import { z } from "zod";

import {
  NonNegMoney,
  Trace,
  fmtMoney,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { RentScheduleInput, buildMonths } from "./rent.ts";
import type { RentMonth } from "./rent.ts";

/** A case's rent terms: the rent-schedule input without a term (the horizon supplies it). */
export const CaseScheduleInput = RentScheduleInput.omit({
  term_months: true,
  include_monthly: true,
  unit: true,
});

export const RenewVsRelocateInput = z.object({
  horizon_months: z
    .number()
    .int()
    .positive()
    .max(600)
    .describe(
      "Analysis horizon in months; both cases run for this term (e.g. 120 for a ten-year renewal versus a ten-year new lease).",
    ),
  discount_rate_annual: z
    .number()
    .finite()
    .min(0)
    .lt(1)
    .default(0.08)
    .describe(
      "Annual discount rate as a decimal, e.g. 0.08, applied to both cases (monthly rate = annual ÷ 12).",
    ),
  current_rent_monthly: NonNegMoney.default(0).describe(
    "Total monthly rent under the existing lease, USD per month for the whole premises (not $/SF). Prices the double-rent overlap in the relocate case.",
  ),
  renew: z
    .object({
      schedule: CaseScheduleInput.describe(
        "Renewal rent terms: commencement date, area, starting $/SF/yr, escalation, and abated (free) months. The term is horizon_months.",
      ),
      ti_cost: NonNegMoney.default(0).describe(
        "Refurbishment or TI the tenant would spend on the current premises at renewal, USD, before any allowance.",
      ),
      ti_allowance: NonNegMoney.default(0).describe(
        "Landlord renewal allowance, USD. Offsets ti_cost; any excess is not paid out.",
      ),
      renewal_fee: NonNegMoney.default(0).describe(
        "Fees to renew (legal, brokerage paid by tenant), USD.",
      ),
    })
    .describe("Stay and renew the existing lease."),
  relocate: z
    .object({
      schedule: CaseScheduleInput.describe(
        "New-premises rent terms: commencement date, area, starting $/SF/yr, escalation, and abated (free) months. The term is horizon_months.",
      ),
      buildout_cost: NonNegMoney.default(0).describe(
        "Total cost to build out the new premises, USD, before any allowance.",
      ),
      ti_allowance: NonNegMoney.default(0).describe(
        "Landlord TI allowance at the new premises, USD. Offsets buildout_cost; any excess is not paid out.",
      ),
      moving_cost: NonNegMoney.default(0).describe(
        "Moving, IT, cabling, signage, and stationery costs, USD.",
      ),
      downtime_months: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          "Months the business runs at reduced capacity around the move.",
        ),
      downtime_cost_monthly: NonNegMoney.default(0).describe(
        "Cost of a month of downtime (lost margin, temporary space), USD per month. Multiplied by downtime_months.",
      ),
      overlap_months: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          "Months of double rent: the old premises are still paid (at current_rent_monthly) after the new lease starts.",
        ),
      termination_cost: NonNegMoney.default(0).describe(
        "Early termination fee, holdover premium, or restoration obligation at the old premises, USD.",
      ),
      disruption_cost: NonNegMoney.default(0).describe(
        "Explicit one-time cost of business disruption beyond rent and downtime (lost customers, staff turnover), USD.",
      ),
    })
    .describe("Move to new premises."),
});
export type RenewVsRelocateInput = z.input<typeof RenewVsRelocateInput>;

export interface CaseResult {
  /** NPV of rent plus one-time costs (positive = cost), USD. */
  npv: number;
  /** Undiscounted rent plus one-time costs, USD. */
  total_cost: number;
  total_rent: number;
  one_time_costs: number;
  /** Level $/SF/yr with the same present value as all costs (discounted effective occupancy cost). */
  net_effective_rent_psf_annual: number;
  area_sf: number;
}

export interface CashFlowYear {
  year: number;
  renew_rent: number;
  renew_one_time: number;
  renew_total: number;
  relocate_rent: number;
  relocate_one_time: number;
  relocate_total: number;
}

export interface RenewVsRelocate {
  horizon_months: number;
  renew: CaseResult;
  relocate: CaseResult;
  /** relocate NPV − renew NPV; negative means relocating costs less. */
  difference_npv: number;
  cheaper: "renew" | "relocate" | "equal";
  break_even: {
    /** Starting rent ($/SF/yr) for the new premises at which relocating equals renewing; null if every month is abated. */
    relocate_starting_rent_psf: number | null;
    /** Starting rent ($/SF/yr) for the renewal at which renewing equals relocating; null if every month is abated. */
    renew_starting_rent_psf: number | null;
  };
  cash_flows: CashFlowYear[];
}

interface CaseMath {
  months: RentMonth[];
  pv: number;
  annuity: number;
  total: number;
  oneTime: number;
  /** PV of rent per $1/SF/yr of starting rent (slope) and PV of fixed $/SF bumps (intercept). */
  slope: number;
  intercept: number;
}

/**
 * Renew vs. relocate over one horizon: NPV of rent and one-time costs for each case, the
 * discounted effective rent of each, and the starting rent at which they break even.
 */
export function renewVsRelocate(
  raw: RenewVsRelocateInput,
): CalcResult<RenewVsRelocate> {
  const input = parseInput(RenewVsRelocateInput, raw);
  const t = new Trace();
  const H = input.horizon_months;
  const r = input.discount_rate_annual / 12;
  t.step(
    "Method",
    "cost NPV = Σ rent_due_t ÷ (1 + r)^t (rent in advance, t = 0..H−1) + one-time costs at t = 0; effective rent = level monthly payment with that PV × 12 ÷ area",
  );

  const caseMath = (
    s: z.output<typeof CaseScheduleInput>,
    oneTime: number,
  ): CaseMath => {
    const full = { ...s, term_months: H, include_monthly: false };
    const months = buildMonths(full);
    const esc = s.escalation;
    let pv = 0;
    let annuity = 0;
    let total = 0;
    let slope = 0;
    let intercept = 0;
    months.forEach((m, i) => {
      const df = powInt(1 + r, -i);
      pv += m.rent_due * df;
      annuity += df;
      total += m.rent_due;
      if (!m.abated) {
        const k =
          esc.type === "none"
            ? 0
            : Math.floor((m.month - 1) / esc.every_months);
        const unit = (s.area_sf / 12) * df;
        slope += esc.type === "percent" ? unit * powInt(1 + esc.rate, k) : unit;
        if (esc.type === "fixed_psf") intercept += unit * esc.amount * k;
      }
    });
    return { months, pv, annuity, total, oneTime, slope, intercept };
  };

  const R = input.renew;
  const M = input.relocate;
  const renewOneTime = round(
    Math.max(0, R.ti_cost - R.ti_allowance) + R.renewal_fee,
    2,
  );
  t.step(
    "Renew one-time costs",
    renewOneTime,
    `max(0, ${fmtMoney(R.ti_cost)} TI − ${fmtMoney(R.ti_allowance)} allowance) + ${fmtMoney(R.renewal_fee)} fees`,
    "USD",
  );
  const downtime = round(M.downtime_months * M.downtime_cost_monthly, 2);
  const overlap = round(M.overlap_months * input.current_rent_monthly, 2);
  const relocateOneTime = round(
    Math.max(0, M.buildout_cost - M.ti_allowance) +
      M.moving_cost +
      downtime +
      overlap +
      M.termination_cost +
      M.disruption_cost,
    2,
  );
  t.step(
    "Relocate one-time costs",
    relocateOneTime,
    `max(0, ${fmtMoney(M.buildout_cost)} buildout − ${fmtMoney(M.ti_allowance)} allowance) + ${fmtMoney(M.moving_cost)} moving + ${fmtMoney(downtime)} downtime (${M.downtime_months} mo) + ${fmtMoney(overlap)} double rent (${M.overlap_months} mo) + ${fmtMoney(M.termination_cost)} termination + ${fmtMoney(M.disruption_cost)} disruption`,
    "USD",
  );

  const renew = caseMath(R.schedule, renewOneTime);
  const relocate = caseMath(M.schedule, relocateOneTime);
  const summarize = (label: string, c: CaseMath, area: number): CaseResult => {
    const npv = t.step(
      `${label} NPV`,
      round(c.pv + c.oneTime, 2),
      `PV of rent ${fmtMoney(c.pv)} + ${fmtMoney(c.oneTime)} one-time`,
      "USD",
    );
    const ner = t.step(
      `${label} effective rent`,
      round((((c.pv + c.oneTime) / c.annuity) * 12) / area, 4),
      `(${fmtMoney(c.pv + c.oneTime)} ÷ Σ(1+r)^−t) × 12 ÷ ${area} SF`,
      "USD/sf/yr",
    );
    return {
      npv,
      total_cost: round(c.total + c.oneTime, 2),
      total_rent: round(c.total, 2),
      one_time_costs: c.oneTime,
      net_effective_rent_psf_annual: ner,
      area_sf: area,
    };
  };
  const renewResult = summarize("Renew", renew, R.schedule.area_sf);
  const relocateResult = summarize("Relocate", relocate, M.schedule.area_sf);

  const diff = t.step(
    "Difference",
    round(relocateResult.npv - renewResult.npv, 2),
    `relocate NPV − renew NPV = ${fmtMoney(relocateResult.npv)} − ${fmtMoney(renewResult.npv)}`,
    "USD",
  );
  const cheaper = diff < 0 ? "relocate" : diff > 0 ? "renew" : "equal";
  t.step("Cheaper", cheaper, "lower NPV of cost");

  // Each case's PV of rent is linear in its starting rate: PV = slope × rate + intercept.
  const breakEvenRate = (target: number, c: CaseMath): number | null =>
    c.slope === 0
      ? null
      : round((target - c.oneTime - c.intercept) / c.slope, 4);
  const beRelocate = breakEvenRate(renew.pv + renew.oneTime, relocate);
  const beRenew = breakEvenRate(relocate.pv + relocate.oneTime, renew);
  t.step(
    "Break-even relocation rent",
    beRelocate ?? "n/a",
    "starting $/SF/yr for the new premises (same escalation and free rent) with relocate NPV = renew NPV",
    "USD/sf/yr",
  );
  t.step(
    "Break-even renewal rent",
    beRenew ?? "n/a",
    "starting $/SF/yr for the renewal (same escalation and free rent) with renew NPV = relocate NPV",
    "USD/sf/yr",
  );

  const years = Math.ceil(H / 12);
  const cashFlows: CashFlowYear[] = [];
  for (let y = 1; y <= years; y++) {
    const sumYear = (c: CaseMath): number => {
      let s = 0;
      for (let m = 12 * (y - 1); m < Math.min(12 * y, H); m++)
        s += (c.months[m] as RentMonth).rent_due;
      return round(s, 2);
    };
    const rr = sumYear(renew);
    const mr = sumYear(relocate);
    const ro = y === 1 ? renewOneTime : 0;
    const mo = y === 1 ? relocateOneTime : 0;
    cashFlows.push({
      year: y,
      renew_rent: rr,
      renew_one_time: ro,
      renew_total: round(rr + ro, 2),
      relocate_rent: mr,
      relocate_one_time: mo,
      relocate_total: round(mr + mo, 2),
    });
  }

  if (R.schedule.area_sf !== M.schedule.area_sf)
    t.warn(
      "The two premises differ in area; NPV compares total cost, while $/SF/yr normalizes size but not the value of the space.",
    );
  if (M.disruption_cost === 0 && M.downtime_cost_monthly === 0)
    t.warn(
      "No disruption or downtime cost supplied for relocating; the comparison counts only rent and hard costs.",
    );
  if (R.ti_allowance > R.ti_cost || M.ti_allowance > M.buildout_cost)
    t.warn(
      "An allowance exceeds the cost it offsets; the excess is treated as not paid out.",
    );
  if (M.overlap_months > 0 && input.current_rent_monthly === 0)
    t.warn(
      `relocate.overlap_months is ${M.overlap_months} but current_rent_monthly is 0 (or not given), so the double rent during the overlap counts as $0; pass the existing lease's total monthly rent.`,
    );
  if (diff === 0) t.warn("The two cases are tied at these inputs.");
  if (beRelocate !== null && beRelocate < 0)
    t.warn(
      "Relocating costs more than renewing even at a $0/SF starting rent (its one-time costs alone exceed the renewal's NPV); the negative break-even relocation rent is not achievable.",
    );
  if (beRenew !== null && beRenew < 0)
    t.warn(
      "Renewing costs more than relocating even at a $0/SF starting rent (its one-time costs alone exceed the relocation's NPV); the negative break-even renewal rent is not achievable.",
    );

  return t.result("calc.renew_vs_relocate", 2, {
    horizon_months: H,
    renew: renewResult,
    relocate: relocateResult,
    difference_npv: diff,
    cheaper,
    break_even: {
      relocate_starting_rent_psf: beRelocate,
      renew_starting_rent_psf: beRenew,
    },
    cash_flows: cashFlows,
  });
}
