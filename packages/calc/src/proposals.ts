import { z } from "zod";

import {
  NonNegMoney,
  Rate,
  Trace,
  fmtMoney,
  fmtNum,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { RentScheduleInput, buildMonths } from "./rent.ts";
import { unitLabels, unitWarning } from "./units.ts";
import type { LeaseUnit } from "./units.ts";

const OpexGrowth = Rate.default(0).describe(
  "Annual growth of operating expenses as a decimal, e.g. 0.03, compounding each lease year from commencement (lease year 1 is expense_psf_annual).",
);
const OpexEstimate = NonNegMoney.describe(
  "Estimated operating expenses (CAM, taxes, insurance) for lease year 1, $/SF/yr on rentable area.",
);

/**
 * Who pays operating expenses under a proposal. Opex in lease year y (y = 0 first) is
 * expense_psf_annual × (1 + growth)^y; the tenant pays the part the structure passes through
 * and the landlord bears the rest.
 */
export const ProposalOperatingExpenses = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("gross"),
      expense_psf_annual: NonNegMoney.default(0).describe(
        "Estimated operating expenses the landlord pays, $/SF/yr in lease year 1 (used in the landlord perspective; the tenant pays none).",
      ),
      growth_rate_annual: OpexGrowth,
    })
    .describe(
      "Full-service gross: the landlord pays all operating expenses; the tenant pays none beyond base rent.",
    ),
  z
    .object({
      type: z.literal("nnn"),
      expense_psf_annual: OpexEstimate,
      growth_rate_annual: OpexGrowth,
    })
    .describe(
      "Net (NNN): the tenant pays all operating expenses, estimated at expense_psf_annual in lease year 1.",
    ),
  z
    .object({
      type: z.literal("base_year"),
      expense_psf_annual: OpexEstimate,
      base_year_psf_annual: NonNegMoney.optional().describe(
        "Base-year operating expenses, $/SF/yr. Defaults to expense_psf_annual (the base year is lease year 1).",
      ),
      growth_rate_annual: OpexGrowth,
    })
    .describe(
      "Gross with a base year: the tenant pays operating expenses above the base-year amount.",
    ),
  z
    .object({
      type: z.literal("expense_stop"),
      expense_psf_annual: OpexEstimate,
      stop_psf_annual: NonNegMoney.describe(
        "Expense stop, $/SF/yr: the tenant pays operating expenses above this fixed amount.",
      ),
      growth_rate_annual: OpexGrowth,
    })
    .describe(
      "Gross with an expense stop: the tenant pays operating expenses above a fixed $/SF/yr stop.",
    ),
]);
export type ProposalOperatingExpenses = z.output<
  typeof ProposalOperatingExpenses
>;

export const ProposalComparisonInput = z
  .object({
    perspective: z
      .enum(["tenant", "landlord"])
      .default("tenant")
      .describe(
        "Whose economics to rank on: tenant (effective occupancy cost, lower is better) or landlord (discounted net effective rent, higher is better).",
      ),
    discount_rate_annual: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .default(0.08)
      .describe(
        "Annual discount rate as a decimal, e.g. 0.08, applied to every proposal (monthly rate = annual ÷ 12, cash flows at the start of each month). Default 0.08, named in warnings when omitted: the ranking can change with the rate.",
      ),
    area_basis: z
      .enum(["rentable", "usable"])
      .default("rentable")
      .describe(
        "Area the $/SF/yr metric is divided by: rentable (schedule.area_sf, the default) or usable (each proposal's usable_sf, or area_sf ÷ load_factor). Rents and expenses stay quoted per rentable SF; use usable when proposals have different load factors and the tenant needs a fixed usable area.",
      ),
    proposals: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(200)
            .describe("Unique label for the proposal, e.g. building name."),
          schedule: RentScheduleInput.describe(
            "Base-rent terms of this proposal (same input as calc_rent_schedule); schedule.area_sf is the rentable area. With schedule.unit (kw, mw, unit, acre, key, room, space), area_sf and every $/SF field of this proposal are per that unit; all proposals must use the same unit.",
          ),
          usable_sf: z
            .number()
            .finite()
            .positive()
            .optional()
            .describe(
              "Usable square feet of this proposal (at most schedule.area_sf). Give this or load_factor, not both; required for area_basis usable.",
            ),
          load_factor: z
            .number()
            .finite()
            .min(1)
            .max(3)
            .optional()
            .describe(
              "Rentable ÷ usable area, e.g. 1.15 (usable_sf = area_sf ÷ load_factor). Give this or usable_sf, not both.",
            ),
          ti_allowance_psf: NonNegMoney.default(0).describe(
            "TI allowance paid by the landlord, USD per rentable SF, once at commencement (not per year).",
          ),
          other_concessions: NonNegMoney.default(0).describe(
            "Other cash concessions to the tenant at commencement (moving allowance, buyout), USD.",
          ),
          leasing_commissions: NonNegMoney.default(0).describe(
            "Leasing commissions paid by landlord at commencement, USD (landlord perspective only).",
          ),
          operating_expenses: ProposalOperatingExpenses.optional().describe(
            "Operating-expense structure of this proposal: gross, nnn, base_year, or expense_stop, with a lease-year-1 estimate and growth. Tenant perspective adds what the tenant pays; landlord perspective deducts what the landlord bears. Omit to price no operating expenses (as before).",
          ),
          additional_costs_psf_annual: NonNegMoney.default(0).describe(
            "Other costs the tenant pays on top of base rent, flat $/SF/yr on rentable area (tenant perspective only), e.g. parking. Prefer operating_expenses for opex pass-throughs, which can grow and follow a base year or stop.",
          ),
          tenant_upfront_costs: NonNegMoney.default(0).describe(
            "Tenant's own costs at commencement not covered by allowances (TI overage, moving), USD.",
          ),
          downtime_months: z
            .number()
            .int()
            .min(0)
            .max(120)
            .default(0)
            .describe(
              "Landlord perspective: vacant months before this proposal commences (no rent; the landlord carries lease-year-1 operating expenses if operating_expenses is given). The metric is then the level monthly amount over downtime plus term. Ignored for the tenant.",
            ),
        }),
      )
      .min(2)
      .max(20)
      .describe("2–20 proposals to compare.")
      .refine(
        (ps) => new Set(ps.map((p) => p.name)).size === ps.length,
        "proposal names must be unique",
      ),
  })
  .superRefine((v, ctx) => {
    const unit0 = v.proposals[0]?.schedule.unit ?? "sf";
    if (unit0 !== "sf" && v.area_basis === "usable")
      ctx.addIssue({
        code: "custom",
        path: ["area_basis"],
        message: `area_basis usable applies to square feet only, not ${unit0}`,
      });
    v.proposals.forEach((p, i) => {
      const unit = p.schedule.unit ?? "sf";
      if (unit !== unit0)
        ctx.addIssue({
          code: "custom",
          path: ["proposals", i, "schedule", "unit"],
          message: `every proposal must use the same unit; the first uses ${unit0}, this one ${unit}`,
        });
      if (
        unit !== "sf" &&
        (p.usable_sf !== undefined || p.load_factor !== undefined)
      )
        ctx.addIssue({
          code: "custom",
          path: [
            "proposals",
            i,
            p.usable_sf !== undefined ? "usable_sf" : "load_factor",
          ],
          message: `usable_sf and load_factor apply to square feet only, not ${unit}`,
        });
      if (p.usable_sf !== undefined && p.load_factor !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["proposals", i, "load_factor"],
          message: "give usable_sf or load_factor, not both",
        });
      if (p.usable_sf !== undefined && p.usable_sf > p.schedule.area_sf)
        ctx.addIssue({
          code: "custom",
          path: ["proposals", i, "usable_sf"],
          message: "usable_sf cannot exceed schedule.area_sf (rentable)",
        });
      if (
        v.area_basis === "usable" &&
        p.usable_sf === undefined &&
        p.load_factor === undefined
      )
        ctx.addIssue({
          code: "custom",
          path: ["proposals", i, "usable_sf"],
          message: "area_basis usable needs usable_sf or load_factor",
        });
    });
  });
export type ProposalComparisonInput = z.input<typeof ProposalComparisonInput>;

export interface RankedProposal {
  rank: number;
  name: string;
  /** Tenant: effective occupancy cost, $/SF/yr (lower is better). Landlord: discounted NER, $/SF/yr (higher is better). Per area_basis SF. */
  metric_psf_annual: number;
  /** Tenant: total net cost over the term. Landlord: total net rent over downtime and term. USD, undiscounted. */
  total_net: number;
  term_months: number;
  /** Rentable SF (schedule.area_sf). */
  area_sf: number;
  /** Usable SF when usable_sf or load_factor was given, else null. */
  usable_sf: number | null;
  /** Rentable ÷ usable when known, else null. */
  load_factor: number | null;
  /** The area the metric is divided by (rentable or usable, per area_basis). */
  basis_area_sf: number;
  opex_structure: ProposalOperatingExpenses["type"] | null;
  /** Landlord perspective only; 0 for the tenant. */
  downtime_months: number;
}

export interface ProposalComparison {
  perspective: "tenant" | "landlord";
  metric: "effective_occupancy_cost_psf" | "discounted_net_effective_rent_psf";
  area_basis: "rentable" | "usable";
  ranking: RankedProposal[];
  best: string;
  /** Echo of the proposals' schedule.unit; present only when it was given. */
  unit?: LeaseUnit;
  /** What metric_psf_annual is measured in, e.g. "USD/kW/yr"; present only when schedule.unit was given. */
  rate_unit?: string;
}

/** Operating expenses in lease year `year` (0 = first): [total $/SF/yr, tenant-paid $/SF/yr]. */
function opexPsf(o: ProposalOperatingExpenses, year: number): [number, number] {
  const total = o.expense_psf_annual * powInt(1 + o.growth_rate_annual, year);
  switch (o.type) {
    case "gross":
      return [total, 0];
    case "nnn":
      return [total, total];
    case "base_year":
      return [
        total,
        Math.max(0, total - (o.base_year_psf_annual ?? o.expense_psf_annual)),
      ];
    case "expense_stop":
      return [total, Math.max(0, total - o.stop_psf_annual)];
  }
}

/**
 * Normalize lease proposals with different terms, sizes, free rent, allowances, and
 * expense structures into one comparable $/SF/yr figure, discounted at one rate.
 *
 * Both perspectives annuitize: the result is the level monthly amount with the same
 * present value as the proposal's cash flows (monthly in advance, one-time items at
 * commencement), × 12 ÷ the basis area. A landlord's downtime months come first, so the
 * level amount runs over downtime plus term.
 */
export function compareProposals(
  raw: ProposalComparisonInput,
): CalcResult<ProposalComparison> {
  const input = parseInput(ProposalComparisonInput, raw);
  const t = new Trace();
  const r = input.discount_rate_annual / 12;
  const tenant = input.perspective === "tenant";
  const usable = input.area_basis === "usable";
  const unit = input.proposals.find((p) => p.schedule.unit !== undefined)
    ?.schedule.unit;
  const l = unitLabels(unit);
  const sfUnit = l === unitLabels(undefined);
  t.step(
    "Method",
    tenant
      ? "effective cost = level monthly payment with PV of (rent + tenant-paid operating expenses + additional costs + upfront − TI − concessions), × 12 ÷ area"
      : "discounted NER = level monthly payment with PV of (rent − landlord-borne operating expenses − TI − commissions − concessions), × 12 ÷ area",
  );
  t.step(
    "Discounting",
    `monthly cash flows at the start of each month (annuity due), monthly rate r = ${fmtNum(input.discount_rate_annual)} ÷ 12 = ${fmtNum(r, 8)}; one-time items at commencement${tenant ? "" : "; t = 0 is the start of any downtime"}`,
    "level amount = (PV of flows + PV of one-time items) ÷ Σ (1 + r)^−t",
  );
  t.step(
    "Lease months",
    "each month runs from the commencement day-of-month; rent is not prorated to calendar months; operating expenses grow each lease year from commencement",
  );
  t.step(
    "Area basis",
    usable
      ? "usable SF: usable_sf, or area_sf ÷ load_factor; rents, TI and expenses are per rentable SF"
      : sfUnit
        ? "rentable SF (schedule.area_sf)"
        : `${l.qty} (schedule.area_sf, unit ${unit}); rents, TI and expenses are per ${l.per}`,
  );

  const rows = input.proposals.map((p) => {
    const s = p.schedule;
    const rsf = s.area_sf;
    const months = buildMonths(s);
    const usf =
      p.usable_sf ??
      (p.load_factor !== undefined ? rsf / p.load_factor : undefined);
    const load =
      p.load_factor ??
      (p.usable_sf !== undefined ? rsf / p.usable_sf : undefined);
    const basis = usable ? (usf ?? rsf) : rsf;
    const downtime = tenant ? 0 : p.downtime_months;
    const opex = p.operating_expenses;
    const extraMonthly = tenant
      ? round((p.additional_costs_psf_annual * rsf) / 12, 2)
      : 0;
    let pv = 0;
    let annuity = 0;
    let total = 0;
    // Landlord downtime: no rent; the landlord carries lease-year-1 operating expenses.
    const carry = opex ? round((opex.expense_psf_annual * rsf) / 12, 2) : 0;
    for (let j = 0; j < downtime; j++) {
      const df = powInt(1 + r, -j);
      pv -= carry * df;
      annuity += df;
      total -= carry;
    }
    months.forEach((m, i) => {
      const df = powInt(1 + r, -(i + downtime));
      let flow: number;
      if (opex) {
        const [all, paid] = opexPsf(opex, Math.floor(i / 12));
        const tenantOpex = round((paid * rsf) / 12, 2);
        flow = tenant
          ? m.rent_due + extraMonthly + tenantOpex
          : m.rent_due - round(round((all * rsf) / 12, 2) - tenantOpex, 2);
      } else {
        flow = m.rent_due + extraMonthly;
      }
      pv += flow * df;
      annuity += df;
      total += flow;
    });
    const ti = p.ti_allowance_psf * rsf;
    const upfront = tenant
      ? p.tenant_upfront_costs - ti - p.other_concessions
      : -(ti + p.leasing_commissions + p.other_concessions);
    const upfrontPv = upfront * powInt(1 + r, -downtime);
    const level = (pv + upfrontPv) / annuity;
    const metric = round((level * 12) / basis, 4);
    const totalNet = round(total + upfront, 2);
    t.step(
      p.name,
      metric,
      `PV ${fmtMoney(pv)} ${upfrontPv < 0 ? "−" : "+"} ${fmtMoney(Math.abs(upfrontPv))} one-time; ${downtime ? `${downtime} downtime + ` : ""}${months.length} months; ${opex ? `${opex.type} opex; ` : ""}÷ ${round(basis, 2)} ${sfUnit ? `${usable ? "usable" : "rentable"} SF` : l.qty}`,
      l.rate,
    );
    return {
      row: {
        name: p.name,
        metric_psf_annual: metric,
        total_net: totalNet,
        term_months: s.term_months,
        area_sf: rsf,
        usable_sf: usf === undefined ? null : round(usf, 2),
        load_factor: load === undefined ? null : round(load, 4),
        basis_area_sf: round(basis, 2),
        opex_structure: opex ? opex.type : null,
        downtime_months: downtime,
      },
      /** The same metric per usable SF, for the cross-check when ranking on rentable. */
      usableMetric: usf === undefined ? null : round((level * 12) / usf, 4),
    };
  });

  const better = (a: number, b: number): number => (tenant ? a - b : b - a);
  const sorted = [...rows].sort((a, b) =>
    better(a.row.metric_psf_annual, b.row.metric_psf_annual),
  );
  const ranking = sorted.map(({ row }, i) => ({ rank: i + 1, ...row }));
  const best = ranking[0]?.name ?? "";
  t.step(
    "Best",
    best,
    tenant ? "lowest effective occupancy cost" : "highest discounted NER",
  );

  const sizes = new Set(rows.map((x) => x.row.basis_area_sf));
  if (sizes.size > 1)
    t.warn(
      sfUnit
        ? "Proposals differ in area; $/SF/yr normalizes size but not the value of the space itself."
        : `Proposals differ in size (${l.qty}); $/${l.per}/yr normalizes size but not the value of the space or capacity itself.`,
    );
  if (!usable && rows.every((x) => x.usableMetric !== null)) {
    const byUsable = [...rows].sort((a, b) =>
      better(a.usableMetric ?? 0, b.usableMetric ?? 0),
    )[0];
    if (byUsable && byUsable.row.name !== best)
      t.warn(
        `Ranked on rentable SF; per usable SF the best is ${byUsable.row.name} (${byUsable.usableMetric} $/USF/yr), not ${best}. Set area_basis to usable if the tenant needs a fixed usable area.`,
      );
  }
  const withOpex = input.proposals.filter((p) => p.operating_expenses);
  if (
    tenant &&
    withOpex.length === 0 &&
    input.proposals.every((p) => p.additional_costs_psf_annual === 0)
  ) {
    t.warn(
      "No operating_expenses or additional costs supplied; if any proposal is net (NNN, base year, expense stop), add its operating_expenses for a fair comparison.",
    );
  }
  if (withOpex.length > 0 && withOpex.length < input.proposals.length)
    t.warn(
      `No operating_expenses for ${input.proposals
        .filter((p) => !p.operating_expenses)
        .map((p) => p.name)
        .join(
          ", ",
        )}: priced as if no operating expenses are paid beyond base rent${tenant ? " and additional costs" : ""}.`,
    );
  const flatBase = withOpex.filter(
    (p) =>
      p.operating_expenses?.type === "base_year" &&
      p.operating_expenses.growth_rate_annual === 0,
  );
  if (flatBase.length)
    t.warn(
      `Base-year proposal(s) ${flatBase.map((p) => p.name).join(", ")} have growth_rate_annual 0, so no expense increases over the base year are priced.`,
    );
  // A gross proposal's expense estimate is the landlord's cost: it never reaches the tenant's metric.
  const grossPriced = withOpex.filter(
    (p) =>
      p.operating_expenses?.type === "gross" &&
      p.operating_expenses.expense_psf_annual > 0,
  );
  if (tenant && grossPriced.length)
    t.warn(
      `${grossPriced.map((p) => p.name).join(", ")} ${grossPriced.length > 1 ? "are" : "is"} full-service gross (operating_expenses.type gross): the landlord pays the operating expenses, so expense_psf_annual is not charged to the tenant. If the tenant pays them, set type nnn, base_year or expense_stop.`,
    );
  if (tenant && input.proposals.some((p) => p.downtime_months > 0))
    t.warn(
      "downtime_months applies to the landlord perspective only; ignored for the tenant.",
    );
  if (
    (raw as { discount_rate_annual?: unknown }).discount_rate_annual ===
    undefined
  )
    t.warn(
      `discount_rate_annual not given: the default ${fmtNum(input.discount_rate_annual)} was used. The ranking can change with the rate; pass the ${input.perspective}'s own rate.`,
    );
  const terms = input.proposals.map((p) => p.schedule.term_months);
  const shortest = Math.min(...terms);
  const longest = Math.max(...terms);
  if (longest - shortest >= 12)
    t.warn(
      `Terms differ (${shortest} to ${longest} months); annualizing compares cost per year but does not price the re-leasing, renewal, or relocation risk after the shorter term ends.`,
    );
  const starts = [
    ...new Set(input.proposals.map((p) => p.schedule.commencement_date)),
  ].sort();
  if (starts.length > 1)
    t.warn(
      `Proposals commence on different dates (${starts.join(", ")}); each is valued as of its own commencement, so the ranking ignores the timing difference.`,
    );
  const tied =
    ranking.length > 1 &&
    ranking[0]?.metric_psf_annual === ranking[1]?.metric_psf_annual;
  if (tied)
    t.warn(
      `Top proposals are tied at ${ranking[0]?.metric_psf_annual} $/${l.per}/yr.`,
    );
  const unitNote = unitWarning(unit);
  if (unitNote) t.warn(unitNote);

  const value: ProposalComparison = {
    perspective: input.perspective,
    metric: tenant
      ? "effective_occupancy_cost_psf"
      : "discounted_net_effective_rent_psf",
    area_basis: input.area_basis,
    ranking,
    best,
  };
  if (unit !== undefined) {
    value.unit = unit;
    value.rate_unit = l.rate;
  }
  return t.result("calc.compare_proposals", 2, value);
}
