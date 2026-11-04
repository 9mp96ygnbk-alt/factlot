import { z } from "zod";

import {
  CalcInputError,
  NonNegMoney,
  Rate,
  Share,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

const Clause = z
  .string()
  .min(1)
  .max(500)
  .optional()
  .describe(
    'Free-text lease reference for this assumption, e.g. "Lease §6.2(b)" or "First Amendment ¶4". Echoed with the assumption.',
  );

export const CapexRecoveryInput = z
  .object({
    cost: z
      .number()
      .finite()
      .positive()
      .describe(
        "Capital cost of the improvement to recover, USD (building level).",
      ),
    amortization_years: z
      .number()
      .int()
      .min(1)
      .max(100)
      .describe(
        "Years over which the cost is recovered: the useful life, or the amortization period the lease specifies.",
      ),
    period_basis: z
      .enum(["useful_life", "lease_specified"])
      .default("useful_life")
      .describe(
        "Where amortization_years comes from: useful_life (e.g. under GAAP or tax guidance) or lease_specified (a period the lease states). Labels only.",
      ),
    method: z
      .enum(["straight_line", "level_payment"])
      .default("straight_line")
      .describe(
        "straight_line: equal principal (cost ÷ years) plus interest on the declining unamortized balance, so recovery falls each year. level_payment: a level annual payment like a mortgage, cost × r ÷ (1 − (1 + r)^−years), split into interest and principal. Identical when interest_rate_annual is 0.",
      ),
    interest_rate_annual: Rate.refine(
      (r) => r >= 0,
      "interest rate must be ≥ 0",
    )
      .default(0)
      .describe(
        "Annual interest on the unamortized balance as a decimal, e.g. 0.08; 0 (default) for none. Charged on the balance at the start of each year.",
      ),
    first_year: z
      .number()
      .int()
      .min(1900)
      .max(2200)
      .optional()
      .describe(
        "Calendar or lease year of the first recovery year, e.g. 2026; labels the schedule rows. Omit to number years 1, 2, 3.",
      ),
    cost_savings_cap: z
      .object({
        annual_savings: NonNegMoney.optional().describe(
          "Demonstrated operating-cost savings per year, USD, the same every year. Give this or savings_by_year.",
        ),
        savings_by_year: z
          .array(NonNegMoney)
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Demonstrated savings for each recovery year, USD, one per year of amortization_years. Give this or annual_savings.",
          ),
        carry_forward: z
          .boolean()
          .default(false)
          .describe(
            "True if amortization disallowed by the cap in one year may be recovered in a later year of the period (still within that year's savings); false (default) if it is lost.",
          ),
      })
      .optional()
      .describe(
        "Cost-savings limit: recovery in each year may not exceed the operating-cost savings the improvement demonstrably produces. Omit if the lease has none.",
      ),
    tenants: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(200)
            .describe("Tenant or suite label, unique."),
          pro_rata_share: Share.describe(
            "Tenant's pro rata share of the recoverable amount, 0 < share ≤ 1.",
          ),
        }),
      )
      .min(1)
      .max(1000)
      .optional()
      .describe(
        "Tenants to allocate the annual recoverable amount to by pro rata share. Shares may sum to less than 1 (the landlord bears the rest), not more. Omit for the building-level schedule only.",
      ),
    clauses: z
      .object({
        cost: Clause,
        amortization_period: Clause,
        interest: Clause,
        method: Clause,
        cost_savings_cap: Clause,
        pro_rata_share: Clause,
      })
      .optional()
      .describe(
        "Lease clause behind each assumption, free text, echoed in the result's assumptions so a reviewer can check each against the lease.",
      ),
  })
  .superRefine((v, ctx) => {
    const c = v.cost_savings_cap;
    if (
      c &&
      (c.annual_savings === undefined) === (c.savings_by_year === undefined)
    )
      ctx.addIssue({
        code: "custom",
        path: ["cost_savings_cap", "annual_savings"],
        message: "give annual_savings or savings_by_year, not both",
      });
    if (
      c?.savings_by_year !== undefined &&
      c.savings_by_year.length !== v.amortization_years
    )
      ctx.addIssue({
        code: "custom",
        path: ["cost_savings_cap", "savings_by_year"],
        message: `needs one amount per recovery year (${v.amortization_years})`,
      });
    if (v.tenants) {
      const names = new Set<string>();
      v.tenants.forEach((t, i) => {
        if (names.has(t.name))
          ctx.addIssue({
            code: "custom",
            path: ["tenants", i, "name"],
            message: `duplicate tenant name "${t.name}"`,
          });
        names.add(t.name);
      });
    }
  });
export type CapexRecoveryInput = z.input<typeof CapexRecoveryInput>;

export interface CapexRecoveryYear {
  year_index: number;
  /** first_year + year_index − 1, or null without first_year. */
  year: number | null;
  opening_balance: number;
  principal: number;
  interest: number;
  /** principal + interest: the amount recoverable before any savings cap. */
  amortization: number;
  /** Demonstrated savings that cap this year, or null without a cap. */
  savings_cap: number | null;
  recoverable: number;
  /** Amortization (plus any carry-in) above the savings cap this year. */
  excess_over_cap: number;
  /** Excess carried to the next year (carry_forward only). */
  carried_forward: number;
  closing_balance: number;
}

export interface CapexTenantRecovery {
  name: string;
  pro_rata_share: number;
  /** Recoverable × share for each schedule year, rounded to cents. */
  by_year: number[];
  total: number;
}

export interface CapexAssumption {
  assumption:
    | "cost"
    | "amortization_period"
    | "interest"
    | "method"
    | "cost_savings_cap"
    | "pro_rata_share";
  value: string;
  /** The lease clause given in clauses, or null. */
  clause: string | null;
}

export interface CapexRecovery {
  method: "straight_line" | "level_payment";
  /** Level payment, or the straight-line principal per year (before interest). */
  annual_payment: number;
  schedule: CapexRecoveryYear[];
  total_principal: number;
  total_interest: number;
  total_amortization: number;
  total_recoverable: number;
  /** total_amortization − total_recoverable: what the savings cap disallows by the end of the period. */
  total_unrecovered: number;
  tenants: CapexTenantRecovery[];
  assumptions: CapexAssumption[];
}

/**
 * Recoverable capital expenditure under a lease: the annual amortization of a capital cost
 * (straight-line or level payment, with interest on the unamortized balance), limited by
 * demonstrated savings when the lease says so, and each tenant's pro rata share per year.
 */
export function capexRecovery(
  raw: CapexRecoveryInput,
): CalcResult<CapexRecovery> {
  const input = parseInput(CapexRecoveryInput, raw);
  const t = new Trace();
  const n = input.amortization_years;
  const r = input.interest_rate_annual;
  const cost = round(input.cost, 2);
  const level = input.method === "level_payment" && r > 0;
  const shareSum = (input.tenants ?? []).reduce(
    (a, x) => a + x.pro_rata_share,
    0,
  );
  if (round(shareSum, 9) > 1)
    throw new CalcInputError(
      `invalid input: tenants: pro rata shares sum to ${round(shareSum, 6)}, more than 1`,
      [{ path: "tenants", message: "pro rata shares sum to more than 1" }],
    );

  t.step(
    "Method",
    input.method === "straight_line"
      ? "straight-line: principal = cost ÷ years each year; interest = rate × unamortized balance at the start of the year"
      : "level payment: payment = cost × r ÷ (1 − (1 + r)^−years); interest = rate × balance at the start of the year; principal = payment − interest",
  );
  const payment = level
    ? t.step(
        "Level annual payment",
        round((cost * r) / (1 - powInt(1 + r, -n)), 2),
        `${fmtMoney(cost)} × ${r} ÷ (1 − (1 + ${r})^−${n})`,
        "USD",
      )
    : t.step(
        "Annual principal",
        round(cost / n, 2),
        `${fmtMoney(cost)} ÷ ${n} years${input.method === "level_payment" ? " (no interest, so level payment equals straight-line)" : ""}`,
        "USD",
      );

  const cap = input.cost_savings_cap;
  const schedule: CapexRecoveryYear[] = [];
  let balance = cost;
  let carry = 0;
  for (let k = 1; k <= n; k++) {
    const opening = balance;
    const interest = round(opening * r, 2);
    const principal =
      k === n
        ? opening
        : Math.min(level ? round(payment - interest, 2) : payment, opening);
    const amortization = round(principal + interest, 2);
    const savings =
      cap === undefined
        ? null
        : (cap.annual_savings ?? cap.savings_by_year?.[k - 1] ?? 0);
    const eligible = round(amortization + carry, 2);
    const recoverable =
      savings === null ? eligible : round(Math.min(eligible, savings), 2);
    const excess = round(eligible - recoverable, 2);
    carry = cap?.carry_forward && k < n ? excess : 0;
    balance = round(opening - principal, 2);
    schedule.push({
      year_index: k,
      year: input.first_year === undefined ? null : input.first_year + k - 1,
      opening_balance: opening,
      principal,
      interest,
      amortization,
      savings_cap: savings,
      recoverable,
      excess_over_cap: excess,
      carried_forward: carry,
      closing_balance: balance,
    });
    t.step(
      `Year ${k}${input.first_year === undefined ? "" : ` (${input.first_year + k - 1})`}`,
      recoverable,
      `${fmtMoney(principal)} principal + ${fmtMoney(interest)} interest on ${fmtMoney(opening)}${eligible !== amortization ? ` + ${fmtMoney(eligible - amortization)} carried in` : ""}${savings === null ? "" : `, capped at ${fmtMoney(savings)} savings`}`,
      "USD",
    );
  }
  const total = (f: (y: CapexRecoveryYear) => number): number =>
    round(
      schedule.reduce((a, y) => a + f(y), 0),
      2,
    );
  const totalPrincipal = total((y) => y.principal);
  const totalInterest = t.step(
    "Total interest",
    total((y) => y.interest),
    "Σ interest",
    "USD",
  );
  const totalAmortization = t.step(
    "Total amortization",
    total((y) => y.amortization),
    `${fmtMoney(totalPrincipal)} principal + ${fmtMoney(totalInterest)} interest`,
    "USD",
  );
  const totalRecoverable = t.step(
    "Total recoverable",
    total((y) => y.recoverable),
    "Σ recoverable",
    "USD",
  );
  const unrecovered = t.step(
    "Total unrecovered",
    round(totalAmortization - totalRecoverable, 2),
    `${fmtMoney(totalAmortization)} − ${fmtMoney(totalRecoverable)}`,
    "USD",
  );

  const tenants: CapexTenantRecovery[] = (input.tenants ?? []).map((x) => {
    const byYear = schedule.map((y) =>
      round(y.recoverable * x.pro_rata_share, 2),
    );
    const sumT = round(
      byYear.reduce((a, v) => a + v, 0),
      2,
    );
    t.step(
      `Tenant ${x.name}`,
      sumT,
      `recoverable each year × ${x.pro_rata_share}, rounded to cents`,
      "USD",
    );
    return {
      name: x.name,
      pro_rata_share: x.pro_rata_share,
      by_year: byYear,
      total: sumT,
    };
  });
  if (input.tenants && round(shareSum, 9) < 1)
    t.step(
      "Landlord-retained share",
      round(1 - shareSum, 6),
      "1 − Σ tenant pro rata shares",
    );

  const clauses = input.clauses ?? {};
  const basis =
    input.period_basis === "useful_life"
      ? "useful life"
      : "lease-specified period";
  const capText = !cap
    ? "none"
    : cap.annual_savings !== undefined
      ? `recovery limited to ${fmtMoney(cap.annual_savings)} of demonstrated savings a year; excess ${cap.carry_forward ? "carried forward" : "not carried forward"}`
      : `recovery limited to demonstrated savings by year (${cap.savings_by_year?.map((s) => fmtMoney(s)).join(", ")}); excess ${cap.carry_forward ? "carried forward" : "not carried forward"}`;
  const assumptions: CapexAssumption[] = [
    ["cost", fmtMoney(cost)],
    ["amortization_period", `${n} years (${basis})`],
    [
      "interest",
      r === 0
        ? "none"
        : `${fmtPct(r)} a year on the unamortized balance at the start of each year`,
    ],
    [
      "method",
      input.method === "straight_line"
        ? "straight-line principal plus interest on the declining balance"
        : "level annual payment (principal and interest)",
    ],
    ["cost_savings_cap", capText],
    [
      "pro_rata_share",
      input.tenants
        ? `${input.tenants.length} tenant(s), shares sum to ${round(shareSum, 6)}`
        : "building level only (no tenants given)",
    ],
  ].map(([assumption, value]) => ({
    assumption: assumption as CapexAssumption["assumption"],
    value: value as string,
    clause: clauses[assumption as keyof typeof clauses] ?? null,
  }));

  t.warn(
    "Recovery assumes the lease passes this capital expenditure through; many leases allow only capital items that cut operating costs or are required by law, and only their annual amortized portion. Confirm the clause.",
  );
  const uncited = assumptions
    .filter(
      (a) =>
        a.clause === null &&
        (a.assumption !== "cost_savings_cap" || cap !== undefined) &&
        (a.assumption !== "pro_rata_share" || input.tenants !== undefined),
    )
    .map((a) => a.assumption);
  if (uncited.length)
    t.warn(
      `No lease clause cited for ${uncited.join(", ")}; give clauses so each assumption can be checked against the lease.`,
    );
  if (r === 0)
    t.warn(
      "No interest on the unamortized balance (interest_rate_annual 0); confirm the lease allows no interest or carrying charge.",
    );
  else
    t.warn(
      "Interest is charged once a year on the unamortized balance at the start of the year; a lease that charges interest monthly or on the average balance gives a different amount.",
    );
  if (unrecovered > 0)
    t.warn(
      `The cost-savings cap disallows ${fmtMoney(unrecovered)} of the amortized cost${cap?.carry_forward ? " (carried forward but not recovered by the end of the period)" : ""}; savings must be demonstrated as the lease requires.`,
    );

  return t.result("calc.capex_recovery", 1, {
    method: input.method,
    annual_payment: payment,
    schedule,
    total_principal: totalPrincipal,
    total_interest: totalInterest,
    total_amortization: totalAmortization,
    total_recoverable: totalRecoverable,
    total_unrecovered: unrecovered,
    tenants,
    assumptions,
  });
}
