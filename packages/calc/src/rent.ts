import { z } from "zod";

import {
  CalcInputError,
  IsoDate,
  NonNegMoney,
  Rate,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { addDays, addMonths } from "./dates.ts";

export const Escalation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("percent"),
    /** e.g. 0.03 for 3% compounding bumps. */
    rate: Rate,
    every_months: z.number().int().positive().default(12),
  }),
  z.object({
    type: z.literal("fixed_psf"),
    /** Dollars per SF per year added at each bump, e.g. 0.50. */
    amount: z.number().finite(),
    every_months: z.number().int().positive().default(12),
  }),
]);

export const RentScheduleInput = z.object({
  commencement_date: IsoDate,
  term_months: z.number().int().positive().max(1200),
  area_sf: z.number().positive(),
  /** Year-one base rent in dollars per SF per year. */
  starting_rent_psf_annual: z.number().finite().nonnegative(),
  escalation: Escalation.default({ type: "none" }),
  /** Fully abated months, 1-based (e.g. [1,2,3] for three months free up front). */
  abated_months: z.array(z.number().int().positive()).default([]),
  /** Round each step's $/SF/yr to cents, as many lease rent tables do. */
  round_rate_to_cents: z.boolean().default(false),
  /** Include a month-by-month table (can be long). */
  include_monthly: z.boolean().default(false),
});
export type RentScheduleInput = z.input<typeof RentScheduleInput>;

export interface RentMonth {
  month: number;
  start_date: string;
  end_date: string;
  rent_psf_annual: number;
  scheduled_rent: number;
  abated: boolean;
  rent_due: number;
}

export interface RentStep {
  step: number;
  first_month: number;
  last_month: number;
  start_date: string;
  end_date: string;
  rent_psf_annual: number;
  monthly_rent: number;
  abated_months: number;
}

export interface RentSchedule {
  expiration_date: string;
  steps: RentStep[];
  total_scheduled_rent: number;
  total_abatement: number;
  total_rent_due: number;
  monthly?: RentMonth[];
}

/** Month-by-month schedule; shared by rent-schedule and NER. */
export function buildMonths(
  input: z.output<typeof RentScheduleInput>,
  t?: Trace,
): RentMonth[] {
  const { escalation: esc } = input;
  const abated = new Set(input.abated_months);
  for (const m of abated) {
    if (m > input.term_months) {
      throw new CalcInputError(
        `abated month ${m} is beyond the ${input.term_months}-month term`,
      );
    }
  }
  const rateFor = (month: number): number => {
    if (esc.type === "none") return input.starting_rent_psf_annual;
    const k = Math.floor((month - 1) / esc.every_months);
    const r =
      esc.type === "percent"
        ? input.starting_rent_psf_annual * (1 + esc.rate) ** k
        : input.starting_rent_psf_annual + esc.amount * k;
    return input.round_rate_to_cents ? round(r, 2) : r;
  };
  if (t) {
    if (esc.type === "percent") {
      t.step(
        "Escalation",
        `${fmtPct(esc.rate)} compounding every ${esc.every_months} months`,
        "rate_k = starting_rate × (1 + r)^k",
      );
    } else if (esc.type === "fixed_psf") {
      t.step(
        "Escalation",
        `+$${esc.amount}/SF/yr every ${esc.every_months} months`,
        "rate_k = starting_rate + amount × k",
      );
    }
  }
  const months: RentMonth[] = [];
  for (let m = 1; m <= input.term_months; m++) {
    const rate = rateFor(m);
    const scheduled = round((rate * input.area_sf) / 12, 2);
    const isAbated = abated.has(m);
    months.push({
      month: m,
      start_date: addMonths(input.commencement_date, m - 1),
      end_date: addDays(addMonths(input.commencement_date, m), -1),
      rent_psf_annual: rate,
      scheduled_rent: scheduled,
      abated: isAbated,
      rent_due: isAbated ? 0 : scheduled,
    });
  }
  return months;
}

export function rentSchedule(raw: RentScheduleInput): CalcResult<RentSchedule> {
  const input = parseInput(RentScheduleInput, raw);
  const t = new Trace();
  const months = buildMonths(input, t);

  const steps: RentStep[] = [];
  let lastRate: number | undefined;
  for (const m of months) {
    const last = steps.at(-1);
    // Compare unrounded rates; the step stores a display-rounded copy.
    if (last && lastRate === m.rent_psf_annual) {
      last.last_month = m.month;
      last.end_date = m.end_date;
      if (m.abated) last.abated_months++;
    } else {
      steps.push({
        step: steps.length,
        first_month: m.month,
        last_month: m.month,
        start_date: m.start_date,
        end_date: m.end_date,
        rent_psf_annual: round(m.rent_psf_annual, 4),
        monthly_rent: m.scheduled_rent,
        abated_months: m.abated ? 1 : 0,
      });
      lastRate = m.rent_psf_annual;
    }
  }
  const sum = (f: (m: RentMonth) => number) =>
    round(
      months.reduce((a, m) => a + f(m), 0),
      2,
    );
  const total_scheduled_rent = sum((m) => m.scheduled_rent);
  const total_rent_due = sum((m) => m.rent_due);
  const total_abatement = round(total_scheduled_rent - total_rent_due, 2);

  t.step(
    "Monthly rent",
    "rate × area_sf ÷ 12, rounded to cents",
    undefined,
    "USD",
  );
  t.step(
    "Total scheduled rent",
    total_scheduled_rent,
    "Σ monthly scheduled rent",
    "USD",
  );
  t.step(
    "Total abatement",
    total_abatement,
    `${input.abated_months.length} abated months`,
    "USD",
  );
  t.step(
    "Total rent due",
    total_rent_due,
    `${fmtMoney(total_scheduled_rent)} − ${fmtMoney(total_abatement)}`,
    "USD",
  );
  if (!input.round_rate_to_cents && input.escalation.type === "percent") {
    t.warn(
      "Escalated $/SF rates are not rounded per step; set round_rate_to_cents if the lease table rounds.",
    );
  }

  const expiration_date = months.at(-1)?.end_date ?? input.commencement_date;
  const value: RentSchedule = {
    expiration_date,
    steps,
    total_scheduled_rent,
    total_abatement,
    total_rent_due,
  };
  if (input.include_monthly) value.monthly = months;
  return t.result("calc.rent_schedule", 1, value);
}

export const NetEffectiveRentInput = z.object({
  schedule: RentScheduleInput,
  /** Landlord-funded tenant improvement allowance, $/SF. */
  ti_allowance_psf: NonNegMoney.default(0),
  /** Total leasing commissions paid by landlord, USD. */
  leasing_commissions: NonNegMoney.default(0),
  /** Any other landlord concessions paid at commencement (moving allowance, buyout), USD. */
  other_concessions: NonNegMoney.default(0),
  /** Annual discount rate; 0 gives the undiscounted (straight-line) NER. */
  discount_rate_annual: z.number().finite().min(0).lt(1).default(0),
});
export type NetEffectiveRentInput = z.input<typeof NetEffectiveRentInput>;

export interface NetEffectiveRent {
  /** Average rent actually paid, after abatement, $/SF/yr. */
  effective_rent_psf: number;
  /** After abatement and landlord costs, straight-line, $/SF/yr. */
  net_effective_rent_psf: number;
  /** Level rent with the same present value as the net cash flows, $/SF/yr. */
  discounted_net_effective_rent_psf: number;
  total_rent_due: number;
  total_landlord_costs: number;
  pv_rent: number;
}

/**
 * Net effective rent. Rent is assumed paid monthly in advance; landlord costs at
 * commencement. Discounting uses a monthly rate of annual ÷ 12 (nominal).
 */
export function netEffectiveRent(
  raw: NetEffectiveRentInput,
): CalcResult<NetEffectiveRent> {
  const input = parseInput(NetEffectiveRentInput, raw);
  const s = input.schedule;
  const t = new Trace();
  const months = buildMonths(s, t);
  const n = months.length;
  const years = t.step("Term", n / 12, `${n} months ÷ 12`, "years");

  const totalRent = t.step(
    "Total rent due",
    round(
      months.reduce((a, m) => a + m.rent_due, 0),
      2,
    ),
    "Σ rent due",
    "USD",
  );
  const ti = t.step(
    "TI allowance",
    round(input.ti_allowance_psf * s.area_sf, 2),
    `$${input.ti_allowance_psf}/SF × ${s.area_sf} SF`,
    "USD",
  );
  const costs = t.step(
    "Total landlord costs",
    round(ti + input.leasing_commissions + input.other_concessions, 2),
    `${fmtMoney(ti)} TI + ${fmtMoney(input.leasing_commissions)} LC + ${fmtMoney(input.other_concessions)} other`,
    "USD",
  );
  const effective = t.step(
    "Effective rent",
    round(totalRent / s.area_sf / years, 4),
    "total rent due ÷ area ÷ years",
    "USD/sf/yr",
  );
  const ner = t.step(
    "Net effective rent (straight-line)",
    round((totalRent - costs) / s.area_sf / years, 4),
    "(total rent due − landlord costs) ÷ area ÷ years",
    "USD/sf/yr",
  );

  const r = input.discount_rate_annual / 12;
  let pv = 0;
  let annuity = 0;
  for (let i = 0; i < n; i++) {
    const df = (1 + r) ** -i;
    pv += (months[i]?.rent_due ?? 0) * df;
    annuity += df;
  }
  const pvRent = t.step(
    "PV of rent",
    round(pv, 2),
    `Σ rent_due_t ÷ (1 + ${round(r, 6)})^t, t = 0..${n - 1}`,
    "USD",
  );
  const level = (pv - costs) / annuity;
  const dner = t.step(
    "Discounted net effective rent",
    round((level * 12) / s.area_sf, 4),
    "((PV rent − costs) ÷ Σ(1+r)^−t) × 12 ÷ area",
    "USD/sf/yr",
  );
  if (input.discount_rate_annual === 0)
    t.warn(
      "discount_rate_annual is 0, so discounted NER equals straight-line NER.",
    );

  return t.result("calc.net_effective_rent", 1, {
    effective_rent_psf: effective,
    net_effective_rent_psf: ner,
    discounted_net_effective_rent_psf: dner,
    total_rent_due: totalRent,
    total_landlord_costs: costs,
    pv_rent: pvRent,
  });
}
