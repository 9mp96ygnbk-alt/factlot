import { z } from "zod";

import {
  CalcInputError,
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
import { irr } from "./finance.ts";

export const MAX_DCF_LEASES = 200;
export const MAX_HOLD_YEARS = 30;

const Recovery = z.enum(["nnn", "gross", "base_year"]);
const Probability = z.number().finite().min(0).max(1);
const Months = (max: number) => z.number().int().min(0).max(max);
const UnitRate = z.number().finite().min(0).lt(1);

/** Leasing assumptions applied when a lease expires; every field can be overridden per lease. */
const leasingFields = {
  renewal_probability: Probability.describe(
    "Probability the tenant renews at expiration, 0 to 1 (e.g. 0.65). Blends the renewal and new-tenant assumptions below.",
  ),
  lease_term_months: z
    .number()
    .int()
    .min(1)
    .max(240)
    .describe(
      "Term of each lease signed at rollover (renewal or new tenant), months.",
    ),
  downtime_months: Months(60).describe(
    "Months vacant before a new tenant starts paying (no downtime is assumed on renewal). Blended downtime = (1 − renewal_probability) × this, rounded to whole months.",
  ),
  renewal_rent_pct_of_market: z
    .number()
    .finite()
    .gt(0)
    .max(2)
    .describe(
      "Renewal rent as a share of market rent, e.g. 0.95 for a 5% renewal discount; new tenants pay market rent.",
    ),
  rent_escalation_rate: UnitRate.describe(
    "Annual bump in a rollover lease's base rent, compounding every 12 months from its start, e.g. 0.03.",
  ),
  free_rent_months_new: Months(60).describe(
    "Months of free base rent for a new tenant at the start of its lease.",
  ),
  free_rent_months_renewal: Months(60).describe(
    "Months of free base rent on a renewal.",
  ),
  ti_psf_new: NonNegMoney.describe(
    "Tenant improvement allowance for a new tenant, USD/SF in today's dollars (grown at market_rent_growth_rate to the lease start).",
  ),
  ti_psf_renewal: NonNegMoney.describe(
    "Tenant improvement allowance on a renewal, USD/SF in today's dollars.",
  ),
  lc_rate_new: UnitRate.describe(
    "Leasing commission for a new tenant as a share of the base rent payable over the lease term after free rent, e.g. 0.06.",
  ),
  lc_rate_renewal: UnitRate.describe(
    "Leasing commission on a renewal, same basis, e.g. 0.03.",
  ),
  recovery: Recovery.describe(
    'Expense recovery on rollover leases: "nnn" (tenant pays its share of operating expenses), "gross" (none), or "base_year" (expenses above the lease\'s first-year level).',
  ),
};

const MarketLeasing = z
  .object({
    renewal_probability: leasingFields.renewal_probability,
    lease_term_months: leasingFields.lease_term_months,
    downtime_months: leasingFields.downtime_months,
    renewal_rent_pct_of_market:
      leasingFields.renewal_rent_pct_of_market.default(1),
    rent_escalation_rate: leasingFields.rent_escalation_rate.default(0),
    free_rent_months_new: leasingFields.free_rent_months_new.default(0),
    free_rent_months_renewal: leasingFields.free_rent_months_renewal.default(0),
    ti_psf_new: leasingFields.ti_psf_new.default(0),
    ti_psf_renewal: leasingFields.ti_psf_renewal.default(0),
    lc_rate_new: leasingFields.lc_rate_new.default(0),
    lc_rate_renewal: leasingFields.lc_rate_renewal.default(0),
    recovery: leasingFields.recovery.default("nnn"),
  })
  .describe(
    "Market leasing assumptions applied at every lease expiration (and to space vacant at the start). A lease's own `leasing` object overrides any of them.",
  );

const LeasingOverride = z
  .object({
    renewal_probability: leasingFields.renewal_probability.optional(),
    lease_term_months: leasingFields.lease_term_months.optional(),
    downtime_months: leasingFields.downtime_months.optional(),
    renewal_rent_pct_of_market:
      leasingFields.renewal_rent_pct_of_market.optional(),
    rent_escalation_rate: leasingFields.rent_escalation_rate.optional(),
    free_rent_months_new: leasingFields.free_rent_months_new.optional(),
    free_rent_months_renewal: leasingFields.free_rent_months_renewal.optional(),
    ti_psf_new: leasingFields.ti_psf_new.optional(),
    ti_psf_renewal: leasingFields.ti_psf_renewal.optional(),
    lc_rate_new: leasingFields.lc_rate_new.optional(),
    lc_rate_renewal: leasingFields.lc_rate_renewal.optional(),
    recovery: leasingFields.recovery.optional(),
  })
  .describe(
    "Per-lease overrides of market_leasing (any subset of its fields).",
  );

const DcfLease = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Suite or tenant label, e.g. "Suite 200".'),
  area_sf: z.number().finite().positive().describe("Leased area, SF."),
  rent_psf_annual: NonNegMoney.describe(
    "Current in-place base rent, USD/SF/yr (0 for space vacant at the start).",
  ),
  months_remaining: Months(600).describe(
    "Months left on the lease from the analysis start: the lease runs through this month (1 = expires at the end of month 1). 0 means the space is vacant at the start and is leased to a new tenant after downtime_months.",
  ),
  escalation_rate: UnitRate.default(0).describe(
    "Annual bump in the in-place rent, e.g. 0.03, applied first in next_escalation_month and every 12 months after.",
  ),
  next_escalation_month: z
    .number()
    .int()
    .min(1)
    .max(600)
    .default(13)
    .describe(
      "Analysis month of the next in-place rent bump (default 13, the start of year 2). Use the lease's anniversary month.",
    ),
  free_rent_months_remaining: Months(600)
    .default(0)
    .describe(
      "Months of in-place free base rent still to run from the analysis start (months 1 to this are abated).",
    ),
  recovery: Recovery.default("nnn").describe(
    'In-place expense recovery: "nnn", "gross", or "base_year" (needs base_year_opex_psf_annual).',
  ),
  base_year_opex_psf_annual: NonNegMoney.optional().describe(
    "Operating expenses in the lease's base year, USD/SF/yr: the tenant pays the excess above it. Required when recovery is base_year.",
  ),
  market_rent_psf_annual: NonNegMoney.describe(
    "Market rent for this space today, USD/SF/yr. Grows at market_rent_growth_rate each analysis year.",
  ),
  leasing: LeasingOverride.optional(),
});

export const DcfProFormaInput = z
  .object({
    hold_years: z
      .number()
      .int()
      .min(1)
      .max(MAX_HOLD_YEARS)
      .describe(
        "Holding period in years. The property is sold at the end of the last year; one more year is projected for the forward NOI.",
      ),
    leases: z
      .array(DcfLease)
      .min(1)
      .max(MAX_DCF_LEASES)
      .describe(
        `Rent roll: one entry per lease or vacant suite (at most ${MAX_DCF_LEASES}). The building area is the sum of their areas.`,
      ),
    market_leasing: MarketLeasing,
    market_rent_growth_rate: z
      .number()
      .finite()
      .gt(-1)
      .lt(1)
      .default(0)
      .describe(
        "Annual market rent growth, e.g. 0.03. Market rent and TI in analysis year y = today's × (1 + g)^(y − 1).",
      ),
    operating_expenses_psf_annual: NonNegMoney.default(0).describe(
      "Year-1 recoverable operating expenses, USD/SF/yr over the whole building area.",
    ),
    non_recoverable_expenses_annual: NonNegMoney.default(0).describe(
      "Year-1 operating expenses no tenant reimburses, USD/yr.",
    ),
    expense_growth_rate: z
      .number()
      .finite()
      .gt(-1)
      .lt(1)
      .default(0)
      .describe(
        "Annual growth of operating expenses and capital reserves, e.g. 0.03: year y = year 1 × (1 + g)^(y − 1).",
      ),
    management_fee_rate: UnitRate.default(0).describe(
      "Management fee as a share of effective gross revenue, e.g. 0.03; not recovered.",
    ),
    general_vacancy_rate: UnitRate.default(0).describe(
      "General vacancy allowance as a share of gross revenue (base rent after free rent, plus recoveries), on top of the downtime modelled at rollover.",
    ),
    credit_loss_rate: UnitRate.default(0).describe(
      "Credit loss as a share of gross revenue, on top of general vacancy.",
    ),
    capital_reserve_psf_annual: NonNegMoney.default(0).describe(
      "Year-1 capital reserve, USD/SF/yr over the building area, below NOI. Grows with expense_growth_rate.",
    ),
    exit_cap_rate: z
      .number()
      .finite()
      .gt(0)
      .lt(1)
      .describe("Exit (terminal) cap rate applied to the exit NOI, e.g. 0.07."),
    exit_noi_basis: z
      .enum(["forward", "trailing"])
      .default("forward")
      .describe(
        '"forward": the NOI of the year after the hold (the usual convention); "trailing": the NOI of the final hold year.',
      ),
    selling_cost_rate: UnitRate.default(0).describe(
      "Selling costs as a share of the gross sale price, e.g. 0.02.",
    ),
    discount_rate: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .describe(
        "Annual unlevered discount rate, e.g. 0.08. The present value at this rate is the value.",
      ),
    timing: z
      .enum(["end_of_year", "mid_year"])
      .default("end_of_year")
      .describe(
        '"end_of_year": each year\'s cash flow is discounted (1 + r)^y (Excel NPV). "mid_year": operating cash flows at (1 + r)^(y − 0.5); the sale is always discounted at the end of the hold.',
      ),
    purchase_price: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe(
        "Price paid at the start, USD. Adds the NPV (value − price), the unlevered IRR and the going-in cap rate on price.",
      ),
  })
  .superRefine((v, ctx) => {
    v.leases.forEach((l, i) => {
      if (
        l.recovery === "base_year" &&
        l.base_year_opex_psf_annual === undefined
      )
        ctx.addIssue({
          code: "custom",
          path: ["leases", i, "base_year_opex_psf_annual"],
          message: "required when recovery is base_year",
        });
    });
  });
export type DcfProFormaInput = z.input<typeof DcfProFormaInput>;

type Leasing = z.output<typeof MarketLeasing>;

export interface DcfYear {
  year: number;
  /** False for the year after the hold, projected only for the forward NOI. */
  in_hold: boolean;
  potential_base_rent: number;
  free_rent: number;
  expense_recoveries: number;
  gross_revenue: number;
  general_vacancy: number;
  credit_loss: number;
  effective_gross_revenue: number;
  operating_expenses: number;
  management_fee: number;
  net_operating_income: number;
  tenant_improvements: number;
  leasing_commissions: number;
  capital_reserves: number;
  cash_flow_before_debt: number;
}

export interface DcfLeaseEvent {
  lease: string;
  kind: "in_place" | "new" | "blended";
  start_month: number;
  end_month: number;
  renewal_probability: number | null;
  downtime_months: number;
  free_rent_months: number;
  rent_psf_annual: number;
  tenant_improvements: number;
  leasing_commission: number;
}

export interface DcfProForma {
  hold_years: number;
  building_area_sf: number;
  cash_flows: DcfYear[];
  noi_year_1: number;
  exit: {
    noi_basis: "forward" | "trailing";
    noi: number;
    cap_rate: number;
    gross_sale_price: number;
    selling_costs: number;
    net_sale_proceeds: number;
  };
  discount_rate: number;
  timing: "end_of_year" | "mid_year";
  pv_cash_flows: number;
  pv_reversion: number;
  /** Present value of the hold-period cash flows and the net sale proceeds. */
  value: number;
  value_per_sf: number;
  reversion_share_of_value: number | null;
  going_in_cap_rate_on_value: number | null;
  purchase_price: number | null;
  npv: number | null;
  going_in_cap_rate_on_price: number | null;
  /** Annual IRR of [−price, CF_1, …, CF_n + net sale], end-of-year (Excel IRR). */
  unlevered_irr: number | null;
  equity_multiple: number | null;
  lease_events: DcfLeaseEvent[];
}

/** One occupancy segment of a suite: an in-place lease or a lease signed at rollover. */
interface Segment {
  kind: "in_place" | "new" | "blended";
  start: number;
  end: number;
  /** Base rent per SF per year for analysis month m. */
  psf: (m: number) => number;
  free: number;
  recovery: "nnn" | "gross" | "base_year";
  basePsf: number;
}

const yearOf = (m: number): number => Math.floor((m - 1) / 12) + 1;

/**
 * Property-level discounted cash flow from a rent roll: monthly lease events rolled up into
 * annual cash flows, with blended renewal and new-tenant assumptions at each expiration, an
 * exit at a cap rate on forward NOI, the present value at a discount rate, and the unlevered IRR.
 */
export function dcfProForma(raw: DcfProFormaInput): CalcResult<DcfProForma> {
  const input = parseInput(DcfProFormaInput, raw);
  const t = new Trace();
  const H = input.hold_years;
  const years = H + 1;
  const horizon = years * 12;
  const g = input.market_rent_growth_rate;
  const ge = input.expense_growth_rate;
  let area = 0;
  for (const l of input.leases) area += l.area_sf;
  const marketGrowth = (y: number): number => powInt(1 + g, y - 1);
  const expenseGrowth = (y: number): number => powInt(1 + ge, y - 1);
  const opexPsf = (y: number): number =>
    input.operating_expenses_psf_annual * expenseGrowth(y);

  t.step(
    "Conventions",
    "annual periods built from months: analysis month m is in year ⌊(m − 1) ÷ 12⌋ + 1; rent, recoveries, free rent, and downtime are monthly; TI and leasing commissions are paid in the month a rollover lease starts",
  );
  t.step(
    "Blended rollover",
    "at each expiration one lease is signed with renewal and new-tenant assumptions weighted by the renewal probability p: rent = market × (p × renewal_rent_pct_of_market + (1 − p)); TI/SF and LC rate = p × renewal + (1 − p) × new; free rent = round(p × renewal + (1 − p) × new) months; downtime = round((1 − p) × new-tenant downtime) months (rounding half up to whole months). Space vacant at the start is leased to a new tenant (p = 0) after the full downtime.",
  );
  t.step("Building area", area, "Σ lease areas", "SF");

  const potential = new Array<number>(years + 1).fill(0);
  const free = new Array<number>(years + 1).fill(0);
  const recoveries = new Array<number>(years + 1).fill(0);
  const ti = new Array<number>(years + 1).fill(0);
  const lc = new Array<number>(years + 1).fill(0);
  const events: DcfLeaseEvent[] = [];

  for (const lease of input.leases) {
    const L: Leasing = { ...input.market_leasing };
    for (const [k, v] of Object.entries(lease.leasing ?? {}))
      if (v !== undefined) (L as Record<string, unknown>)[k] = v;
    const segments: Segment[] = [];
    if (lease.months_remaining > 0) {
      const esc = lease.escalation_rate;
      const first = lease.next_escalation_month;
      const base = lease.rent_psf_annual;
      segments.push({
        kind: "in_place",
        start: 1,
        end: lease.months_remaining,
        psf: (m) =>
          m >= first
            ? base * powInt(1 + esc, Math.floor((m - first) / 12) + 1)
            : base,
        free: lease.free_rent_months_remaining,
        recovery: lease.recovery,
        basePsf: lease.base_year_opex_psf_annual ?? 0,
      });
      events.push({
        lease: lease.name,
        kind: "in_place",
        start_month: 1,
        end_month: lease.months_remaining,
        renewal_probability: null,
        downtime_months: 0,
        free_rent_months: lease.free_rent_months_remaining,
        rent_psf_annual: round(base, 4),
        tenant_improvements: 0,
        leasing_commission: 0,
      });
    }
    let prevEnd = lease.months_remaining;
    while (prevEnd < horizon) {
      const vacantStart = prevEnd === 0;
      const p = vacantStart ? 0 : L.renewal_probability;
      const downtime = round((1 - p) * L.downtime_months, 0);
      const start = prevEnd + 1 + downtime;
      // Downtime runs past the projection: the suite stays vacant to the end.
      if (start > horizon) break;
      const end = start + L.lease_term_months - 1;
      const y0 = yearOf(start);
      const startPsf =
        lease.market_rent_psf_annual *
        marketGrowth(y0) *
        (p * L.renewal_rent_pct_of_market + (1 - p));
      const escRate = L.rent_escalation_rate;
      const psf = (m: number): number =>
        startPsf * powInt(1 + escRate, Math.floor((m - start) / 12));
      const freeMonths = Math.min(
        round(
          p * L.free_rent_months_renewal + (1 - p) * L.free_rent_months_new,
          0,
        ),
        L.lease_term_months,
      );
      const tiPsf =
        (p * L.ti_psf_renewal + (1 - p) * L.ti_psf_new) * marketGrowth(y0);
      const lcRate = p * L.lc_rate_renewal + (1 - p) * L.lc_rate_new;
      const tiAmount = tiPsf * lease.area_sf;
      // Commission on the base rent payable over the whole term after free rent, even beyond
      // the analysis horizon, paid when the lease starts.
      let termRent = 0;
      for (let m = start + freeMonths; m <= end; m++)
        termRent += (lease.area_sf * psf(m)) / 12;
      const lcAmount = lcRate * termRent;
      ti[yearOf(start)] = (ti[yearOf(start)] as number) + tiAmount;
      lc[yearOf(start)] = (lc[yearOf(start)] as number) + lcAmount;
      segments.push({
        kind: vacantStart ? "new" : "blended",
        start,
        end,
        psf,
        free: freeMonths,
        recovery: L.recovery,
        basePsf: opexPsf(y0),
      });
      events.push({
        lease: lease.name,
        kind: vacantStart ? "new" : "blended",
        start_month: start,
        end_month: end,
        renewal_probability: vacantStart ? null : p,
        downtime_months: downtime,
        free_rent_months: freeMonths,
        rent_psf_annual: round(startPsf, 4),
        tenant_improvements: round(tiAmount, 2),
        leasing_commission: round(lcAmount, 2),
      });
      prevEnd = end;
    }

    for (const s of segments) {
      const last = Math.min(s.end, horizon);
      for (let m = s.start; m <= last; m++) {
        const y = yearOf(m);
        const rent = (lease.area_sf * s.psf(m)) / 12;
        potential[y] = (potential[y] as number) + rent;
        if (m < s.start + s.free) free[y] = (free[y] as number) - rent;
        let rec = 0;
        if (s.recovery === "nnn") rec = (lease.area_sf * opexPsf(y)) / 12;
        else if (s.recovery === "base_year")
          rec = (lease.area_sf * Math.max(0, opexPsf(y) - s.basePsf)) / 12;
        recoveries[y] = (recoveries[y] as number) + rec;
      }
    }
  }

  const rows: DcfYear[] = [];
  for (let y = 1; y <= years; y++) {
    const pbr = round(potential[y] as number, 2);
    const fr = round(free[y] as number, 2);
    const rec = round(recoveries[y] as number, 2);
    const gross = round(pbr + fr + rec, 2);
    const vac = round(-input.general_vacancy_rate * gross, 2);
    const credit = round(-input.credit_loss_rate * gross, 2);
    const egr = round(gross + vac + credit, 2);
    const opex = round(
      -(
        opexPsf(y) * area +
        input.non_recoverable_expenses_annual * expenseGrowth(y)
      ),
      2,
    );
    const mgmt = round(-input.management_fee_rate * egr, 2);
    const noi = round(egr + opex + mgmt, 2);
    const tiY = round(-(ti[y] as number), 2);
    const lcY = round(-(lc[y] as number), 2);
    const reserves = round(
      -(input.capital_reserve_psf_annual * expenseGrowth(y) * area),
      2,
    );
    rows.push({
      year: y,
      in_hold: y <= H,
      potential_base_rent: pbr,
      free_rent: fr,
      expense_recoveries: rec,
      gross_revenue: gross,
      general_vacancy: vac,
      credit_loss: credit,
      effective_gross_revenue: egr,
      operating_expenses: opex,
      management_fee: mgmt,
      net_operating_income: noi,
      tenant_improvements: tiY,
      leasing_commissions: lcY,
      capital_reserves: reserves,
      cash_flow_before_debt: round(noi + tiY + lcY + reserves, 2),
    });
  }
  const row = (y: number): DcfYear => rows[y - 1] as DcfYear;
  t.step(
    "Annual lines",
    "gross revenue = potential base rent − free rent + recoveries; EGR = gross revenue − general vacancy − credit loss (each rate × gross revenue); NOI = EGR − operating expenses − management fee (rate × EGR); cash flow before debt = NOI − TI − leasing commissions − capital reserves",
    "each line is rounded to the cent and the subtotals are sums of the rounded lines, so every row foots",
  );
  t.step(
    "Recoveries",
    'recoverable expenses in year y = operating_expenses_psf_annual × (1 + expense growth)^(y − 1) per SF; "nnn" leases pay their area × that ÷ 12 each occupied month (free-rent months included), "base_year" leases the excess over their base, "gross" leases nothing; vacant months recover nothing',
  );
  const noi1 = t.step(
    "NOI, year 1",
    row(1).net_operating_income,
    undefined,
    "USD",
  );

  const exitNoi = t.step(
    "Exit NOI",
    input.exit_noi_basis === "forward"
      ? row(H + 1).net_operating_income
      : row(H).net_operating_income,
    input.exit_noi_basis === "forward"
      ? `forward: NOI of year ${H + 1}`
      : `trailing: NOI of year ${H}`,
    "USD",
  );
  const grossSale = t.step(
    "Gross sale price",
    round(exitNoi / input.exit_cap_rate, 2),
    `${fmtMoney(exitNoi)} ÷ ${fmtPct(input.exit_cap_rate, 3)} exit cap rate`,
    "USD",
  );
  const sellCosts = t.step(
    "Selling costs",
    round(input.selling_cost_rate * grossSale, 2),
    `${fmtPct(input.selling_cost_rate, 3)} × ${fmtMoney(grossSale)}`,
    "USD",
  );
  const netSale = t.step(
    "Net sale proceeds",
    round(grossSale - sellCosts, 2),
    `received at the end of year ${H}`,
    "USD",
  );

  const r = input.discount_rate;
  const mid = input.timing === "mid_year";
  const half = mid ? nthRoot(1 + r, 2) : 1;
  let pvCf = 0;
  for (let y = 1; y <= H; y++)
    pvCf += (row(y).cash_flow_before_debt * half) / powInt(1 + r, y);
  const pvCashFlows = t.step(
    "PV of cash flows",
    round(pvCf, 2),
    mid
      ? `Σ CF_y ÷ (1 + ${r})^(y − 0.5), y = 1..${H} (mid-year)`
      : `Σ CF_y ÷ (1 + ${r})^y, y = 1..${H} (end of year)`,
    "USD",
  );
  const pvRev = t.step(
    "PV of reversion",
    round(netSale / powInt(1 + r, H), 2),
    `${fmtMoney(netSale)} ÷ (1 + ${r})^${H}`,
    "USD",
  );
  const value = t.step(
    "Value",
    round(pvCashFlows + pvRev, 2),
    `${fmtMoney(pvCashFlows)} + ${fmtMoney(pvRev)} at a ${fmtPct(r, 3)} discount rate`,
    "USD",
  );

  const price = input.purchase_price;
  let npv: number | null = null;
  let irrAnnual: number | null = null;
  let multiple: number | null = null;
  if (price !== undefined) {
    npv = t.step(
      "NPV",
      round(value - price, 2),
      `${fmtMoney(value)} value − ${fmtMoney(price)} price`,
      "USD",
    );
    const flows = [-price];
    for (let y = 1; y <= H; y++)
      flows.push(
        y === H
          ? round(row(y).cash_flow_before_debt + netSale, 2)
          : row(y).cash_flow_before_debt,
      );
    try {
      const res = irr({ cash_flows: flows, periods_per_year: 1 });
      irrAnnual = res.value.irr_annual;
      t.step(
        "Unlevered IRR",
        irrAnnual,
        `r such that Σ CF_t ÷ (1 + r)^t = 0 over [−price, CF_1, …, CF_${H} + net sale], end of year (Excel IRR)`,
      );
      for (const w of res.warnings) t.warn(w);
    } catch (e) {
      if (!(e instanceof CalcInputError)) throw e;
      t.warn(`No unlevered IRR: ${e.message}.`);
    }
    let inflows = 0;
    for (let k = 1; k < flows.length; k++) inflows += flows[k] as number;
    multiple = t.step(
      "Equity multiple",
      round(inflows / price, 4),
      "Σ cash flows and net sale ÷ price (unlevered)",
    );
  }

  if (mid && price !== undefined)
    t.warn(
      "timing is mid_year but the unlevered IRR uses end-of-year timing (Excel IRR), so at a price equal to the value the IRR is not the discount rate.",
    );
  if (input.general_vacancy_rate > 0)
    t.warn(
      "General vacancy is charged on top of the downtime modelled at each rollover (it is not reduced by it); lower general_vacancy_rate if the market assumption already includes turnover vacancy.",
    );
  if (
    input.exit_noi_basis === "forward" &&
    (row(H + 1).tenant_improvements !== 0 ||
      row(H + 1).leasing_commissions !== 0 ||
      row(H + 1).free_rent !== 0)
  )
    t.warn(
      `The exit year (year ${H + 1}) has rollover costs or free rent; its NOI is capitalized as is. Normalize it if a buyer would not.`,
    );
  if (exitNoi <= 0)
    t.warn("The exit NOI is not positive, so the sale price is not positive.");
  if (!events.some((e) => e.kind !== "in_place"))
    t.warn(
      "No lease rolls within the projection; the result does not depend on the leasing assumptions.",
    );
  t.warn(
    "Conventions to confirm against your model: annual periods from monthly lease events; blended rollover assumptions with downtime and free rent rounded to whole months; TI and LC paid when the rollover lease starts; free rent abates base rent only; general vacancy and credit loss on gross revenue. ARGUS and other tools differ in some of these.",
  );

  return t.result("calc.dcf_pro_forma", 1, {
    hold_years: H,
    building_area_sf: area,
    cash_flows: rows,
    noi_year_1: noi1,
    exit: {
      noi_basis: input.exit_noi_basis,
      noi: exitNoi,
      cap_rate: input.exit_cap_rate,
      gross_sale_price: grossSale,
      selling_costs: sellCosts,
      net_sale_proceeds: netSale,
    },
    discount_rate: r,
    timing: input.timing,
    pv_cash_flows: pvCashFlows,
    pv_reversion: pvRev,
    value,
    value_per_sf: round(value / area, 2),
    reversion_share_of_value: value > 0 ? round(pvRev / value, 4) : null,
    going_in_cap_rate_on_value: value > 0 ? round(noi1 / value, 6) : null,
    purchase_price: price ?? null,
    npv,
    going_in_cap_rate_on_price:
      price !== undefined ? round(noi1 / price, 6) : null,
    unlevered_irr: irrAnnual,
    equity_multiple: multiple,
    lease_events: events,
  });
}
