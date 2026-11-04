import { z } from "zod";

import {
  CalcInputError,
  IsoDate,
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { addDays, addMonths, daysBetween } from "./dates.ts";

/** A residential concession, valued against the lease's monthly rent. */
export const MultifamilyConcession = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("weeks_free"),
      weeks: z
        .number()
        .finite()
        .positive()
        .max(104)
        .describe("Weeks of free rent, e.g. 6."),
    })
    .describe(
      "Weeks free: worth lease_rent × 12 ÷ 52 per week (a week of a year's rent).",
    ),
  z
    .object({
      type: z.literal("months_free"),
      months: z
        .number()
        .finite()
        .positive()
        .max(24)
        .describe("Months of free rent, e.g. 1 or 1.5."),
    })
    .describe("Months free: worth lease_rent × months."),
  z
    .object({
      type: z.literal("amount"),
      amount: NonNegMoney.describe(
        "Total concession over the lease in USD, e.g. a $500 look-and-lease credit.",
      ),
    })
    .describe("A dollar concession for the whole lease."),
]);
export type MultifamilyConcession = z.output<typeof MultifamilyConcession>;

const LeaseRent = NonNegMoney.describe(
  "Contract (lease) rent per month, USD, before concessions.",
);
const MarketRent = NonNegMoney.describe(
  "Market (asking) rent per month for the unit, USD.",
);
const LeaseStart = IsoDate.describe("Lease start date, YYYY-MM-DD.");
const LeaseEnd = IsoDate.describe(
  "Lease end date (last day), YYYY-MM-DD. A lease that ended before as_of is month-to-month.",
);
const LeaseTermMonths = z
  .number()
  .finite()
  .positive()
  .max(120)
  .describe(
    "Lease term in months for amortising the concession, e.g. 12. Defaults to the term from lease_start to lease_end.",
  );
const UnitConcession = MultifamilyConcession.describe(
  "Concession on this lease: weeks_free, months_free, or a dollar amount. Amortised straight-line over the lease term; needs lease_term_months or lease_start and lease_end.",
);

export const UNIT_STATUSES = [
  "occupied",
  "vacant",
  "notice",
  "model",
  "down",
] as const;

export const MultifamilyUnit = z.object({
  unit_id: z
    .string()
    .min(1)
    .max(100)
    .describe('Unit number or ID as on the rent roll, e.g. "101".'),
  unit_type: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Floor plan or type, e.g. "1x1" or "A2". Groups the per-type summary; defaults to the bedroom count.',
    ),
  bedrooms: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe(
      "Bedrooms (0 = studio). Used to group units when unit_type is absent.",
    ),
  sf: z
    .number()
    .finite()
    .positive()
    .optional()
    .describe("Unit square feet. Needed for per-SF figures."),
  status: z
    .enum(UNIT_STATUSES)
    .describe(
      "occupied (leased and in place), notice (leased, the resident has given notice to vacate), vacant, model, or down (offline). Occupied and notice units are leased; model and down units are non-revenue.",
    ),
  market_rent: MarketRent,
  lease_rent: LeaseRent.optional().describe(
    "Contract (lease) rent per month, USD, before concessions. Required for occupied and notice units; ignored for vacant, model, and down units.",
  ),
  lease_start: LeaseStart.optional(),
  lease_end: LeaseEnd.optional(),
  lease_term_months: LeaseTermMonths.optional(),
  concession: UnitConcession.optional(),
});
export type MultifamilyUnit = z.output<typeof MultifamilyUnit>;

export const MultifamilySingleLease = z.object({
  lease_rent: LeaseRent,
  market_rent: MarketRent.optional().describe(
    "Market (asking) rent per month, USD, for the loss to lease. Optional.",
  ),
  sf: z
    .number()
    .finite()
    .positive()
    .optional()
    .describe("Unit square feet, for effective rent per SF. Optional."),
  lease_start: LeaseStart.optional(),
  lease_end: LeaseEnd.optional(),
  lease_term_months: LeaseTermMonths.optional().describe(
    "Lease term in months, e.g. 12. Give this, or lease_start and lease_end.",
  ),
  concession: MultifamilyConcession.optional().describe(
    "Concession: weeks_free, months_free, or a dollar amount, amortised straight-line over the term. Omit for none.",
  ),
});

export const MultifamilyRentRollInput = z
  .object({
    as_of: IsoDate.optional().describe(
      "Rent roll date, YYYY-MM-DD. Required with units: leases that ended before it are month-to-month, and expirations are scheduled from it.",
    ),
    units: z
      .array(MultifamilyUnit)
      .min(1)
      .max(5000)
      .optional()
      .describe(
        "Rent roll mode: every unit in the property, one row each (up to 5,000). Give units or lease, not both.",
      ),
    lease: MultifamilySingleLease.optional().describe(
      "Single-lease mode: the effective monthly rent of one lease after a weeks-free, months-free, or dollar concession. Give units or lease, not both.",
    ),
    include_units: z
      .boolean()
      .default(false)
      .describe(
        "Rent roll mode: include a per-unit table with loss to lease, amortised concession, and effective rent (can be long).",
      ),
  })
  .superRefine((v, ctx) => {
    if ((v.units === undefined) === (v.lease === undefined))
      ctx.addIssue({
        code: "custom",
        path: ["units"],
        message: "give units (rent roll mode) or lease (single-lease mode)",
      });
    if (v.units !== undefined && v.as_of === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["as_of"],
        message: "as_of is required with units",
      });
    const seen = new Set<string>();
    v.units?.forEach((u, i) => {
      if (seen.has(u.unit_id))
        ctx.addIssue({
          code: "custom",
          path: ["units", i, "unit_id"],
          message: `duplicate unit_id "${u.unit_id}"`,
        });
      seen.add(u.unit_id);
      if (
        (u.status === "occupied" || u.status === "notice") &&
        u.lease_rent === undefined
      )
        ctx.addIssue({
          code: "custom",
          path: ["units", i, "lease_rent"],
          message: `lease_rent is required for a unit with status ${u.status}`,
        });
    });
  });
export type MultifamilyRentRollInput = z.input<typeof MultifamilyRentRollInput>;

export interface MultifamilyUnitDetail {
  unit_id: string;
  unit_type: string;
  status: (typeof UNIT_STATUSES)[number];
  market_rent: number;
  lease_rent: number | null;
  loss_to_lease: number | null;
  term_months: number | null;
  concession_total: number | null;
  concession_monthly: number | null;
  effective_rent: number | null;
  lease_end: string | null;
}

export interface MultifamilyUnitTypeSummary {
  unit_type: string;
  units: number;
  leased_units: number;
  vacant_units: number;
  non_revenue_units: number;
  /** Null unless every unit of the type has sf. */
  average_sf: number | null;
  average_market_rent: number;
  /** Null when no unit of the type is leased. */
  average_lease_rent: number | null;
  average_effective_rent: number | null;
  loss_to_lease_monthly: number;
  concessions_monthly: number;
  physical_occupancy: number;
  /** Monthly effective rent ÷ leased SF; null unless every leased unit of the type has sf. */
  effective_rent_psf: number | null;
}

export interface MultifamilyExpiration {
  /** Calendar month of lease_end, YYYY-MM. */
  month: string;
  units: number;
  lease_rent_monthly: number;
}

export interface MultifamilyRentRoll {
  mode: "rent_roll";
  as_of: string;
  unit_count: number;
  units_by_status: Record<(typeof UNIT_STATUSES)[number], number>;
  leased_units: number;
  gross_potential_rent_monthly: number;
  vacancy_loss_monthly: number;
  non_revenue_units_monthly: number;
  /** Market minus lease rent on leased units; negative is gain to lease. */
  loss_to_lease_monthly: number;
  /** Concessions amortised straight-line over each lease's term. */
  concessions_monthly: number;
  /** Lease rent after amortised concessions on leased units = GPR − vacancy − non-revenue − loss to lease − concessions. */
  effective_rent_income_monthly: number;
  gross_potential_rent_annual: number;
  effective_rent_income_annual: number;
  physical_occupancy: number;
  economic_occupancy: number;
  average_market_rent: number;
  average_lease_rent: number | null;
  /** Average monthly effective rent per leased unit. */
  effective_rent_per_unit: number | null;
  /** Monthly effective rent ÷ leased SF; null unless every leased unit has sf. */
  effective_rent_psf: number | null;
  lease_expirations: MultifamilyExpiration[];
  month_to_month_units: number;
  no_lease_end_units: number;
  unit_types: MultifamilyUnitTypeSummary[];
  units?: MultifamilyUnitDetail[];
}

export interface MultifamilySingleLeaseResult {
  mode: "single_lease";
  lease_rent: number;
  term_months: number;
  concession_total: number;
  concession_monthly: number;
  effective_monthly_rent: number;
  effective_annual_rent: number;
  /** Monthly effective rent ÷ sf; null without sf. */
  effective_rent_psf: number | null;
  /** market_rent − lease_rent; null without market_rent. */
  loss_to_lease: number | null;
}

/**
 * Lease term in months from start to end (inclusive): whole months from lease_start to the
 * day after lease_end, plus the remaining days ÷ the days in the next lease month.
 */
export function leaseTermMonths(start: string, end: string): number {
  const after = addDays(end, 1);
  if (daysBetween(start, after) < 1)
    throw new CalcInputError("lease_end must be on or after lease_start");
  let n = 0;
  while (n < 1200 && daysBetween(addMonths(start, n + 1), after) >= 0) n++;
  const from = addMonths(start, n);
  const rem = daysBetween(from, after);
  return rem === 0 ? n : n + rem / daysBetween(from, addMonths(start, n + 1));
}

interface LeaseTerms {
  lease_rent: number;
  lease_start?: string | undefined;
  lease_end?: string | undefined;
  lease_term_months?: number | undefined;
  concession?: MultifamilyConcession | undefined;
}

interface Amortised {
  term: number | null;
  total: number;
  monthly: number;
  effective: number;
}

function bad(path: string, message: string): never {
  throw new CalcInputError(`invalid input: ${path}: ${message}`, [
    { path, message },
  ]);
}

/** Concession value and straight-line amortisation for one lease (all USD per month, cents). */
function amortise(l: LeaseTerms, path: string): Amortised {
  let term: number | null = l.lease_term_months ?? null;
  if (term === null && l.lease_start && l.lease_end) {
    if (daysBetween(l.lease_start, l.lease_end) < 0)
      bad(`${path}.lease_end`, "must be on or after lease_start");
    term = leaseTermMonths(l.lease_start, l.lease_end);
  }
  const c = l.concession;
  if (!c)
    return { term, total: 0, monthly: 0, effective: round(l.lease_rent, 2) };
  if (term === null)
    bad(
      `${path}.concession`,
      "a concession needs lease_term_months or lease_start and lease_end to amortise over",
    );
  const total =
    c.type === "weeks_free"
      ? round(((l.lease_rent * 12) / 52) * c.weeks, 2)
      : c.type === "months_free"
        ? round(l.lease_rent * c.months, 2)
        : round(c.amount, 2);
  if (total > round(l.lease_rent * term, 2))
    bad(
      `${path}.concession`,
      `concession ${fmtMoney(total)} exceeds the rent for the ${round(term, 4)}-month term`,
    );
  const monthly = round(total / term, 2);
  return {
    term,
    total,
    monthly,
    effective: round(l.lease_rent - monthly, 2),
  };
}

function concessionText(c: MultifamilyConcession, rent: number): string {
  return c.type === "weeks_free"
    ? `${fmtMoney(rent)} × 12 ÷ 52 × ${c.weeks} weeks`
    : c.type === "months_free"
      ? `${fmtMoney(rent)} × ${c.months} months`
      : "stated amount";
}

const sum = (xs: number[]): number => xs.reduce((a, x) => a + x, 0);
const avg = (total: number, n: number): number | null =>
  n > 0 ? round(total / n, 2) : null;

function groupOf(u: MultifamilyUnit): string {
  if (u.unit_type !== undefined) return u.unit_type;
  if (u.bedrooms === undefined) return "unspecified";
  return u.bedrooms === 0 ? "studio" : `${u.bedrooms}BR`;
}

function singleLease(
  l: z.output<typeof MultifamilySingleLease>,
): CalcResult<MultifamilySingleLeaseResult> {
  if (
    l.lease_term_months === undefined &&
    (l.lease_start === undefined || l.lease_end === undefined)
  )
    bad(
      "lease.lease_term_months",
      "give lease_term_months, or lease_start and lease_end",
    );
  const t = new Trace();
  const a = amortise(l, "lease");
  const exact = a.term ?? 0;
  const term = t.step(
    "Lease term",
    round(exact, 4),
    l.lease_term_months !== undefined
      ? "lease_term_months"
      : `whole months from ${l.lease_start} to the day after ${l.lease_end}, plus remaining days ÷ days in that lease month`,
    "months",
  );
  t.step(
    "Concession",
    a.total,
    l.concession ? concessionText(l.concession, l.lease_rent) : "none",
    "USD",
  );
  t.step(
    "Concession per month",
    a.monthly,
    `${fmtMoney(a.total)} ÷ ${term} months`,
    "USD",
  );
  const effective = t.step(
    "Effective monthly rent",
    a.effective,
    `${fmtMoney(l.lease_rent)} − ${fmtMoney(a.monthly)}`,
    "USD",
  );
  const annual = t.step(
    "Effective annual rent",
    round(effective * 12, 2),
    `${fmtMoney(effective)} × 12`,
    "USD",
  );
  const psf =
    l.sf !== undefined
      ? t.step(
          "Effective rent per SF (monthly)",
          round(effective / l.sf, 4),
          `${fmtMoney(effective)} ÷ ${l.sf} SF`,
          "USD/sf/mo",
        )
      : null;
  const ltl =
    l.market_rent !== undefined
      ? t.step(
          "Loss to lease",
          round(l.market_rent - l.lease_rent, 2),
          `${fmtMoney(l.market_rent)} market − ${fmtMoney(l.lease_rent)} lease`,
          "USD",
        )
      : null;
  if (l.concession)
    t.warn(
      "The concession is amortised straight-line over the whole lease term; in the free weeks or months the resident pays nothing, so a cash view of those months differs.",
    );
  if (exact !== Math.floor(exact))
    t.warn(
      `The lease term is ${term} months (not whole months); confirm the dates or give lease_term_months.`,
    );
  return t.result("calc.multifamily_rent_roll", 1, {
    mode: "single_lease",
    lease_rent: l.lease_rent,
    term_months: term,
    concession_total: a.total,
    concession_monthly: a.monthly,
    effective_monthly_rent: effective,
    effective_annual_rent: annual,
    effective_rent_psf: psf,
    loss_to_lease: ltl,
  });
}

/**
 * Multifamily rent roll: gross potential rent to effective rent income (vacancy, non-revenue
 * units, loss to lease, amortised concessions), physical and economic occupancy, a lease
 * expiration schedule by month, and a per-unit-type summary. With `lease` instead of `units`,
 * the effective monthly rent of one lease after its concession.
 */
export function multifamilyRentRoll(
  raw: MultifamilyRentRollInput,
): CalcResult<MultifamilyRentRoll | MultifamilySingleLeaseResult> {
  const input = parseInput(MultifamilyRentRollInput, raw);
  if (input.lease) return singleLease(input.lease);
  const asOf = input.as_of as string;
  const units = input.units ?? [];
  const t = new Trace();

  const rows: (MultifamilyUnitDetail & { sf: number | undefined })[] =
    units.map((u, i) => {
      const leased = u.status === "occupied" || u.status === "notice";
      const a = leased
        ? amortise({ ...u, lease_rent: u.lease_rent ?? 0 }, `units.${i}`)
        : null;
      return {
        unit_id: u.unit_id,
        unit_type: groupOf(u),
        status: u.status,
        market_rent: u.market_rent,
        lease_rent: leased ? (u.lease_rent ?? 0) : null,
        loss_to_lease: leased
          ? round(u.market_rent - (u.lease_rent ?? 0), 2)
          : null,
        term_months: a && a.term !== null ? round(a.term, 4) : null,
        concession_total: a && u.concession ? a.total : null,
        concession_monthly: a && u.concession ? a.monthly : null,
        effective_rent: a ? a.effective : null,
        lease_end: leased ? (u.lease_end ?? null) : null,
        sf: u.sf,
      };
    });
  const isLeased = (r: (typeof rows)[number]): boolean =>
    r.status === "occupied" || r.status === "notice";
  const leasedRows = rows.filter(isLeased);
  const byStatus = Object.fromEntries(
    UNIT_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]),
  ) as Record<(typeof UNIT_STATUSES)[number], number>;
  const n = rows.length;
  const nLeased = leasedRows.length;
  t.step(
    "Units",
    n,
    `${byStatus.occupied} occupied + ${byStatus.notice} notice + ${byStatus.vacant} vacant + ${byStatus.model} model + ${byStatus.down} down`,
  );
  t.step(
    "Lease term",
    "lease_term_months, else whole months from lease_start to the day after lease_end plus remaining days ÷ days in that lease month",
  );
  t.step(
    "Concessions",
    "weeks free = lease_rent × 12 ÷ 52 × weeks; months free = lease_rent × months; amount as stated; amortised straight-line: ÷ term months, rounded to cents",
  );

  const gpr = t.step(
    "Gross potential rent (monthly)",
    round(sum(rows.map((r) => r.market_rent)), 2),
    `Σ market_rent, all ${n} units`,
    "USD",
  );
  const vacancy = t.step(
    "Vacancy loss",
    round(
      sum(rows.filter((r) => r.status === "vacant").map((r) => r.market_rent)),
      2,
    ),
    `Σ market_rent, ${byStatus.vacant} vacant units`,
    "USD",
  );
  const nonRevenue = t.step(
    "Non-revenue units",
    round(
      sum(
        rows
          .filter((r) => r.status === "model" || r.status === "down")
          .map((r) => r.market_rent),
      ),
      2,
    ),
    `Σ market_rent, ${byStatus.model} model + ${byStatus.down} down units`,
    "USD",
  );
  const ltl = t.step(
    "Loss to lease",
    round(sum(leasedRows.map((r) => r.loss_to_lease ?? 0)), 2),
    `Σ (market_rent − lease_rent), ${nLeased} leased units; negative is gain to lease`,
    "USD",
  );
  const concessions = t.step(
    "Concessions (amortised)",
    round(sum(leasedRows.map((r) => r.concession_monthly ?? 0)), 2),
    `Σ concession ÷ term, ${leasedRows.filter((r) => r.concession_total !== null).length} leases with a concession`,
    "USD",
  );
  const income = t.step(
    "Effective rent income (monthly)",
    round(sum(leasedRows.map((r) => r.effective_rent ?? 0)), 2),
    `${fmtMoney(gpr)} GPR − ${fmtMoney(vacancy)} vacancy − ${fmtMoney(nonRevenue)} non-revenue − ${fmtMoney(ltl)} loss to lease − ${fmtMoney(concessions)} concessions`,
    "USD",
  );
  const physical = t.step(
    "Physical occupancy",
    round(nLeased / n, 4),
    `${nLeased} occupied or notice ÷ ${n} units = ${fmtPct(nLeased / n)}`,
  );
  const economic = t.step(
    "Economic occupancy",
    gpr > 0 ? round(income / gpr, 4) : 0,
    gpr > 0
      ? `${fmtMoney(income)} effective rent income ÷ ${fmtMoney(gpr)} GPR = ${fmtPct(income / gpr)}`
      : "GPR is 0",
  );
  const perUnit = avg(income, nLeased);
  t.step(
    "Effective rent per leased unit",
    perUnit ?? "n/a",
    nLeased
      ? `${fmtMoney(income)} ÷ ${nLeased} leased units`
      : "no leased units",
    "USD",
  );
  const leasedSf = leasedRows.every((r) => r.sf !== undefined)
    ? sum(leasedRows.map((r) => r.sf ?? 0))
    : null;
  const psf =
    leasedSf !== null && leasedSf > 0 ? round(income / leasedSf, 4) : null;
  t.step(
    "Effective rent per SF (monthly)",
    psf ?? "n/a",
    psf !== null
      ? `${fmtMoney(income)} ÷ ${leasedSf} leased SF`
      : "sf missing on a leased unit, or no leased units",
    "USD/sf/mo",
  );

  // Lease expirations by calendar month of lease_end.
  const expMap = new Map<string, MultifamilyExpiration>();
  let mtm = 0;
  let noEnd = 0;
  for (const r of leasedRows) {
    if (r.lease_end === null) {
      noEnd++;
      continue;
    }
    if (daysBetween(asOf, r.lease_end) < 0) {
      mtm++;
      continue;
    }
    const month = r.lease_end.slice(0, 7);
    const e = expMap.get(month) ?? { month, units: 0, lease_rent_monthly: 0 };
    e.units++;
    e.lease_rent_monthly = round(e.lease_rent_monthly + (r.lease_rent ?? 0), 2);
    expMap.set(month, e);
  }
  const expirations = [...expMap.values()].sort((a, b) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : 0,
  );
  t.step(
    "Lease expirations",
    `${expirations.length} months with expirations; ${mtm} month-to-month; ${noEnd} without lease_end`,
    "leased units grouped by the calendar month of lease_end on or after as_of",
  );

  const groups: string[] = [];
  for (const r of rows)
    if (!groups.includes(r.unit_type)) groups.push(r.unit_type);
  const unitTypes: MultifamilyUnitTypeSummary[] = groups.map((g) => {
    const all = rows.filter((r) => r.unit_type === g);
    const lr = all.filter(isLeased);
    const eff = sum(lr.map((r) => r.effective_rent ?? 0));
    const lsf = lr.every((r) => r.sf !== undefined)
      ? sum(lr.map((r) => r.sf ?? 0))
      : null;
    return {
      unit_type: g,
      units: all.length,
      leased_units: lr.length,
      vacant_units: all.filter((r) => r.status === "vacant").length,
      non_revenue_units: all.filter(
        (r) => r.status === "model" || r.status === "down",
      ).length,
      average_sf: all.every((r) => r.sf !== undefined)
        ? round(sum(all.map((r) => r.sf ?? 0)) / all.length, 2)
        : null,
      average_market_rent: round(
        sum(all.map((r) => r.market_rent)) / all.length,
        2,
      ),
      average_lease_rent: avg(sum(lr.map((r) => r.lease_rent ?? 0)), lr.length),
      average_effective_rent: avg(eff, lr.length),
      loss_to_lease_monthly: round(sum(lr.map((r) => r.loss_to_lease ?? 0)), 2),
      concessions_monthly: round(
        sum(lr.map((r) => r.concession_monthly ?? 0)),
        2,
      ),
      physical_occupancy: round(lr.length / all.length, 4),
      effective_rent_psf: lsf !== null && lsf > 0 ? round(eff / lsf, 4) : null,
    };
  });

  // Warnings for judgment calls.
  if (concessions > 0)
    t.warn(
      "Concessions are amortised straight-line over each lease's full term (effective rent), not recognised as they burn off; a cash view of the current month differs.",
    );
  if (byStatus.notice > 0)
    t.warn(
      `${byStatus.notice} unit(s) on notice are counted as leased and occupied at their lease rent; they will become vacant.`,
    );
  if (mtm > 0)
    t.warn(
      `${mtm} lease(s) ended before as_of ${asOf} and are treated as month-to-month at their lease_rent.`,
    );
  const ignored = units
    .filter(
      (u) =>
        u.status !== "occupied" &&
        u.status !== "notice" &&
        (u.lease_rent !== undefined || u.concession !== undefined),
    )
    .map((u) => u.unit_id);
  if (ignored.length)
    t.warn(
      `Units ${ignored.slice(0, 10).join(", ")}${ignored.length > 10 ? ` and ${ignored.length - 10} more` : ""} are vacant, model, or down but carry lease_rent or a concession; those lease terms were ignored (a pre-leased unit counts as vacant until move-in).`,
    );
  if (ltl < 0)
    t.warn(
      `Lease rents exceed market rents in total (gain to lease of ${fmtMoney(-ltl)} a month); check that market_rent is current.`,
    );
  if (rows.some((r) => r.sf === undefined))
    t.warn(
      "Some units have no sf; per-SF figures and average sf are null for the property or unit types missing it.",
    );
  t.warn(
    "Economic occupancy here is effective lease rent ÷ gross potential rent, before delinquency, bad debt, and other income; it is not collections.",
  );

  const value: MultifamilyRentRoll = {
    mode: "rent_roll",
    as_of: asOf,
    unit_count: n,
    units_by_status: byStatus,
    leased_units: nLeased,
    gross_potential_rent_monthly: gpr,
    vacancy_loss_monthly: vacancy,
    non_revenue_units_monthly: nonRevenue,
    loss_to_lease_monthly: ltl,
    concessions_monthly: concessions,
    effective_rent_income_monthly: income,
    gross_potential_rent_annual: round(gpr * 12, 2),
    effective_rent_income_annual: round(income * 12, 2),
    physical_occupancy: physical,
    economic_occupancy: economic,
    average_market_rent: round(gpr / n, 2),
    average_lease_rent: avg(
      sum(leasedRows.map((r) => r.lease_rent ?? 0)),
      nLeased,
    ),
    effective_rent_per_unit: perUnit,
    effective_rent_psf: psf,
    lease_expirations: expirations,
    month_to_month_units: mtm,
    no_lease_end_units: noEnd,
    unit_types: unitTypes,
  };
  if (input.include_units)
    value.units = rows.map((r) => ({
      unit_id: r.unit_id,
      unit_type: r.unit_type,
      status: r.status,
      market_rent: r.market_rent,
      lease_rent: r.lease_rent,
      loss_to_lease: r.loss_to_lease,
      term_months: r.term_months,
      concession_total: r.concession_total,
      concession_monthly: r.concession_monthly,
      effective_rent: r.effective_rent,
      lease_end: r.lease_end,
    }));
  return t.result("calc.multifamily_rent_roll", 1, value);
}
