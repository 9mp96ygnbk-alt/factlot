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

export const ProposalComparisonInput = z.object({
  perspective: z
    .enum(["tenant", "landlord"])
    .default("tenant")
    .describe("Whose economics to rank on."),
  discount_rate_annual: z
    .number()
    .finite()
    .min(0)
    .lt(1)
    .default(0.08)
    .describe(
      "Annual discount rate as a decimal, e.g. 0.08, applied to every proposal (monthly rate = annual ÷ 12).",
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
          "Base-rent terms of this proposal (same input as calc_rent_schedule).",
        ),
        ti_allowance_psf: NonNegMoney.default(0).describe(
          "TI allowance paid by the landlord, USD per SF, once at commencement (not per year).",
        ),
        other_concessions: NonNegMoney.default(0).describe(
          "Other cash concessions to the tenant at commencement (moving allowance, buyout), USD.",
        ),
        leasing_commissions: NonNegMoney.default(0).describe(
          "Leasing commissions paid by landlord, USD (landlord perspective only).",
        ),
        additional_costs_psf_annual: NonNegMoney.default(0).describe(
          "Costs the tenant pays on top of base rent, $/SF/yr, e.g. estimated operating expenses and taxes on a NNN proposal. Use 0 for full-service gross.",
        ),
        tenant_upfront_costs: NonNegMoney.default(0).describe(
          "Tenant's own costs at commencement not covered by allowances (TI overage, moving), USD.",
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
});
export type ProposalComparisonInput = z.input<typeof ProposalComparisonInput>;

export interface RankedProposal {
  rank: number;
  name: string;
  /** Tenant: effective occupancy cost, $/SF/yr (lower is better). Landlord: discounted NER, $/SF/yr (higher is better). */
  metric_psf_annual: number;
  /** Tenant: total net cost over the term. Landlord: total net rent over the term. USD, undiscounted. */
  total_net: number;
  term_months: number;
  area_sf: number;
}

export interface ProposalComparison {
  perspective: "tenant" | "landlord";
  metric: "effective_occupancy_cost_psf" | "discounted_net_effective_rent_psf";
  ranking: RankedProposal[];
  best: string;
}

/**
 * Normalize lease proposals with different terms, sizes, free rent, allowances, and
 * expense structures into one comparable $/SF/yr figure, discounted at one rate.
 *
 * Both perspectives annuitize: the result is the level monthly amount with the same
 * present value as the proposal's cash flows (rent in advance, one-time items at
 * commencement), × 12 ÷ area.
 */
export function compareProposals(
  raw: ProposalComparisonInput,
): CalcResult<ProposalComparison> {
  const input = parseInput(ProposalComparisonInput, raw);
  const t = new Trace();
  const r = input.discount_rate_annual / 12;
  const tenant = input.perspective === "tenant";
  t.step(
    "Method",
    tenant
      ? "effective cost = level monthly payment with PV of (rent + additional costs + upfront − TI − concessions), × 12 ÷ area"
      : "discounted NER = level monthly payment with PV of (rent − TI − commissions − concessions), × 12 ÷ area",
  );

  const rows = input.proposals.map((p) => {
    const s = p.schedule;
    const months = buildMonths(s);
    const extraMonthly = tenant
      ? round((p.additional_costs_psf_annual * s.area_sf) / 12, 2)
      : 0;
    let pv = 0;
    let annuity = 0;
    let total = 0;
    months.forEach((m, i) => {
      const df = powInt(1 + r, -i);
      const flow = m.rent_due + extraMonthly;
      pv += flow * df;
      annuity += df;
      total += flow;
    });
    const ti = p.ti_allowance_psf * s.area_sf;
    const upfront = tenant
      ? p.tenant_upfront_costs - ti - p.other_concessions
      : -(ti + p.leasing_commissions + p.other_concessions);
    const metric = round((((pv + upfront) / annuity) * 12) / s.area_sf, 4);
    const totalNet = round(total + upfront, 2);
    t.step(
      p.name,
      metric,
      `PV ${fmtMoney(pv)} ${upfront < 0 ? "−" : "+"} ${fmtMoney(Math.abs(upfront))} one-time; ${months.length} months; ${s.area_sf} SF`,
      "USD/sf/yr",
    );
    return {
      name: p.name,
      metric_psf_annual: metric,
      total_net: totalNet,
      term_months: s.term_months,
      area_sf: s.area_sf,
    };
  });

  rows.sort((a, b) =>
    tenant
      ? a.metric_psf_annual - b.metric_psf_annual
      : b.metric_psf_annual - a.metric_psf_annual,
  );
  const ranking = rows.map((row, i) => ({ rank: i + 1, ...row }));
  const best = ranking[0]?.name ?? "";
  t.step(
    "Best",
    best,
    tenant ? "lowest effective occupancy cost" : "highest discounted NER",
  );

  const sizes = new Set(input.proposals.map((p) => p.schedule.area_sf));
  if (sizes.size > 1)
    t.warn(
      "Proposals differ in area; $/SF/yr normalizes size but not the value of the space itself.",
    );
  if (
    tenant &&
    input.proposals.every((p) => p.additional_costs_psf_annual === 0)
  ) {
    t.warn(
      "No additional costs supplied; if any proposal is net (NNN/modified gross), add its expenses for a fair comparison.",
    );
  }
  const tied =
    ranking.length > 1 &&
    ranking[0]?.metric_psf_annual === ranking[1]?.metric_psf_annual;
  if (tied)
    t.warn(
      `Top proposals are tied at ${ranking[0]?.metric_psf_annual} $/SF/yr.`,
    );

  return t.result("calc.compare_proposals", 1, {
    perspective: input.perspective,
    metric: tenant
      ? "effective_occupancy_cost_psf"
      : "discounted_net_effective_rent_psf",
    ranking,
    best,
  });
}
