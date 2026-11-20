/**
 * audit_expense_statement: a tenant's audit of a landlord's operating-expense (CAM) statement.
 *
 * Input: verified facts. Lease facts (what the lease says, each with its quote and page) and
 * statement facts (what the landlord billed, each with its quote and page), from doc_abstract_lease,
 * doc_verify_facts or doc_spread_statement, each passing fact_validate. Output: findings, each with a
 * stable code, the landlord's figure, the figure the lease yields, the dollar difference, the fact ids
 * and quotes it rests on, the calculation steps, a confidence class and what a person must confirm;
 * totals; deadlines; the audit cost-shifting test; the checks that could not run and why; and the
 * items to hand to fact_package_send.
 *
 * Rules: deterministic (same inputs, same findings; no model, no clock: `as_of` is an input);
 * no source, no fact (a finding without a verified lease fact behind it is never produced, and a
 * check whose lease term is missing is listed as not run); no legal conclusions (a finding is
 * "follows_from_terms" only when the arithmetic follows from a quoted term and the statement's own
 * numbers; otherwise it is "depends_on_reading" or "question_to_ask"). Nothing is approximated: a
 * check that cannot be made exact is left out and said so. python/src/factlot/audit.py is the same
 * code; spec/differential runs both on the same inputs.
 *
 * Hosted plan: on the hosted API a caller without a Pro or Team key (or with gating on and no paid
 * plan) gets the summary only (count, total difference, deadlines, checks not run); the Worker says
 * so through runWithExchangeCaller({ fullAudit: false }). Locally the answer is always whole.
 */
import { addDays, daysBetween, powInt, round } from "@factlot/calc";
import { z } from "zod";

import { ToolInputError, validateFact } from "./documents.ts";
import type { Json } from "./documents.ts";
import { currentExchangeCaller } from "./exchange.ts";

export const AUDIT_MAX_FACTS = 1_000;
export const AUDIT_PLAN_URL = "https://factlot.com/pricing/";

const FactList = (max: number) =>
  z.array(z.record(z.string(), z.unknown())).min(1).max(max);

export const AuditExpenseStatementInput = z.object({
  lease_facts: FactList(200).describe(
    "The lease's verified facts (doc_abstract_lease's facts, or doc_verify_facts' verified[].fact), each with its quote and page. Read by predicate: lease.pro_rata_share (number; required: every finding rests on it), lease.pro_rata_basis {tenant_sf, building_sf}, lease.cam_cap {method, rate} or, when the lease says only 'cumulative' or 'non-cumulative' and not how, lease.cam_cap_rate {rate} (the audit then shows the figure under each of the three methods), lease.operating_expense_base_year (integer), lease.expense_stop {amount} (building-level USD per year), lease.cam_admin_fee {rate, base: actual|grossed_up, excluded_from_base: [category words]}, lease.cam_gross_up {target_occupancy, applies_to: variable_expenses|all_expenses, base_year_grossed_up?: boolean}, lease.cam_exclusion (one per excluded category: a string, or {category, keywords?: [words]}), lease.capex_treatment {keywords: [words], recoverable: excluded|amortized, amortization_years?, interest_rate?}, lease.audit_right {window_days, starts_from: statement_receipt|statement_date, notice_form, auditor?, cost_shift_threshold?: {type: percent_of_billed|amount, value}}. A check whose lease term is missing is listed in checks_not_run; nothing is guessed.",
  ),
  statement_facts: FactList(AUDIT_MAX_FACTS).describe(
    "The landlord's statement as verified facts, each with its quote and page. Read by predicate: statement.period {year, statement_date, received_date}, statement.line {label, amount (building-level USD), controllable?, variable?, capital?, grossed_up_amount?, amortization?: {cost, years, rate}} (one per billed line), statement.total {amount}, statement.share_applied {share, building_sf?}, statement.gross_up {actual_occupancy, target_occupancy}, statement.admin_fee {rate, base_amount, amount}, statement.cap_reference {year, amount} (the tenant's controllable amount in the cap's reference year), statement.cap_applied {limit: number or null}, statement.base_year_applied {base_year?, stop_amount?, deduction, grossed_up?}, statement.base_year_total {year, amount}, statement.separately_billed {label, amount}, statement.tenant_charge {amount}, statement.estimates_credited {amount}, statement.estimates_paid {amount}, statement.balance_claimed {amount}.",
  ),
  prior_statement_facts: FactList(AUDIT_MAX_FACTS)
    .optional()
    .describe(
      "Optional: the prior year's statement.line and statement.period facts, for the year-over-year questions.",
    ),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "Today's date, YYYY-MM-DD. The tool reads no clock: deadlines are counted from this date.",
    ),
  yoy_threshold: z
    .number()
    .gt(0)
    .max(10)
    .default(0.1)
    .describe(
      "A line that rose by more than this fraction over the prior year is listed as a question to ask (default 0.10 = 10%). Never an overcharge.",
    ),
});
export type AuditInput = z.output<typeof AuditExpenseStatementInput>;

// --- fact value shapes --------------------------------------------------------------------------

const N = z.number().finite();
const Money = N.min(0);
const Ratio = N.gt(0).max(1);
const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Words = z.array(z.string().min(1).max(100)).max(50);
const strict = <T extends z.ZodRawShape>(s: T) => z.strictObject(s);

const LEASE_SHAPES: Record<string, z.ZodType> = {
  "lease.pro_rata_share": Ratio,
  "lease.pro_rata_basis": strict({
    tenant_sf: N.gt(0),
    building_sf: N.gt(0),
  }),
  "lease.cam_cap": strict({
    method: z.enum([
      "compounding_from_base",
      "simple_from_base",
      "year_over_year",
    ]),
    rate: N.min(0),
  }),
  "lease.cam_cap_rate": strict({ rate: N.min(0) }),
  "lease.operating_expense_base_year": z.number().int().min(1900).max(2200),
  "lease.expense_stop": strict({ amount: Money }),
  "lease.cam_admin_fee": strict({
    rate: N.min(0).max(1),
    base: z.enum(["actual", "grossed_up"]),
    excluded_from_base: Words.default([]),
  }),
  "lease.cam_gross_up": strict({
    target_occupancy: Ratio,
    applies_to: z.enum(["variable_expenses", "all_expenses"]),
    base_year_grossed_up: z.boolean().optional(),
  }),
  "lease.cam_exclusion": z.union([
    z.string().min(1).max(200),
    strict({
      category: z.string().min(1).max(200),
      keywords: Words.optional(),
    }),
  ]),
  "lease.capex_treatment": strict({
    keywords: Words.default([]),
    recoverable: z.enum(["excluded", "amortized"]),
    amortization_years: z.number().int().min(1).max(100).optional(),
    interest_rate: N.min(0).max(1).optional(),
    method: z.enum(["level_payment", "straight_line"]).optional(),
  }),
  "lease.audit_right": strict({
    window_days: z.number().int().min(1).max(3650),
    starts_from: z.enum(["statement_receipt", "statement_date"]),
    notice_form: z.string().min(1).max(500),
    auditor: z.string().min(1).max(500).optional(),
    cost_shift_threshold: strict({
      type: z.enum(["percent_of_billed", "amount"]),
      value: N.gt(0),
    }).optional(),
  }),
};
const LEASE_MULTI = new Set(["lease.cam_exclusion"]);

const STATEMENT_SHAPES: Record<string, z.ZodType> = {
  "statement.period": strict({
    year: z.number().int().min(1900).max(2200),
    statement_date: Date_,
    received_date: Date_,
  }),
  "statement.line": strict({
    label: z.string().min(1).max(300),
    amount: Money,
    controllable: z.boolean().optional(),
    variable: z.boolean().optional(),
    capital: z.boolean().optional(),
    grossed_up_amount: Money.optional(),
    amortization: strict({
      cost: N.gt(0),
      years: z.number().int().min(1).max(100),
      rate: N.min(0).max(1),
    }).optional(),
  }),
  "statement.total": strict({ amount: Money }),
  "statement.share_applied": strict({
    share: Ratio,
    building_sf: N.gt(0).optional(),
  }),
  "statement.gross_up": strict({
    actual_occupancy: Ratio,
    target_occupancy: Ratio,
  }),
  "statement.admin_fee": strict({
    rate: N.min(0).max(1),
    base_amount: Money,
    amount: Money,
  }),
  "statement.cap_reference": strict({
    year: z.number().int().min(1900).max(2200),
    amount: Money,
  }),
  "statement.cap_applied": strict({ limit: Money.nullable() }),
  "statement.base_year_applied": strict({
    base_year: z.number().int().min(1900).max(2200).optional(),
    stop_amount: Money.optional(),
    deduction: Money,
    grossed_up: z.boolean().optional(),
  }),
  "statement.base_year_total": strict({
    year: z.number().int().min(1900).max(2200),
    amount: Money,
  }),
  "statement.separately_billed": strict({
    label: z.string().min(1).max(300),
    amount: Money,
  }),
  "statement.tenant_charge": strict({ amount: Money }),
  "statement.estimates_credited": strict({ amount: Money }),
  "statement.estimates_paid": strict({ amount: Money }),
  "statement.balance_claimed": strict({ amount: N }),
};
const STATEMENT_MULTI = new Set([
  "statement.line",
  "statement.separately_billed",
]);
const PRIOR_USED = new Set(["statement.line", "statement.period"]);

// --- facts --------------------------------------------------------------------------------------

interface AFact {
  id: string;
  predicate: string;
  value: Json;
  raw: unknown;
  quote: string;
  page: number;
  document_id: string | null;
}

type Issue = { path: string; message: string };

/**
 * Read a list of facts: each must pass fact_validate, name a source with quote and page, have a
 * unique id, and (for known predicates) a value of the shape this tool reads. Returns the facts
 * grouped by predicate; predicates this tool does not read are listed in `ignored`.
 */
function readFacts(
  list: Record<string, unknown>[],
  path: string,
  side: "lease" | "statement",
  shapes: Record<string, z.ZodType>,
  multi: Set<string>,
  only: Set<string> | undefined,
  issues: Issue[],
  ids: Set<string>,
  ignored: string[],
): Map<string, AFact[]> {
  const out = new Map<string, AFact[]>();
  list.forEach((f, i) => {
    const at = `${path}.${i}`;
    const v = validateFact(f);
    if (!v.valid) {
      for (const x of v.issues.slice(0, 3))
        issues.push({
          path: `${at}${x.path ? `.${x.path}` : ""}`,
          message: `not a valid fact (fact_validate): ${x.message}`,
        });
      return;
    }
    const id = String(f.id);
    const predicate = String(f.predicate);
    const sources = (f.provenance as { sources?: unknown } | undefined)
      ?.sources;
    const src = Array.isArray(sources)
      ? (sources[0] as Json | undefined)
      : undefined;
    if (
      !src ||
      typeof src.quote !== "string" ||
      src.quote.trim() === "" ||
      typeof src.page !== "number"
    ) {
      issues.push({
        path: `${at}.provenance.sources`,
        message:
          "no source: every fact the audit reads needs a quote and a page (no source, no finding)",
      });
      return;
    }
    if (!predicate.startsWith(`${side}.`)) {
      issues.push({
        path: `${at}.predicate`,
        message: `${predicate} is not a ${side} fact: ${side}_facts holds ${side}.* predicates`,
      });
      return;
    }
    if (ids.has(id)) {
      issues.push({ path: `${at}.id`, message: `duplicate fact id ${id}` });
      return;
    }
    ids.add(id);
    const shape = shapes[predicate];
    if (!shape || (only && !only.has(predicate))) {
      ignored.push(predicate);
      return;
    }
    const parsed = shape.safeParse(f.value);
    if (!parsed.success) {
      issues.push({
        path: `${at}.value`,
        message: `${predicate}: ${parsed.error.issues
          .slice(0, 2)
          .map((x) => `${x.path.join(".") || "value"}: ${x.message}`)
          .join("; ")}`,
      });
      return;
    }
    const value: Json =
      typeof parsed.data === "object" && parsed.data !== null
        ? (parsed.data as Json)
        : { value: parsed.data };
    const fact: AFact = {
      id,
      predicate,
      value,
      raw: parsed.data,
      quote: src.quote,
      page: src.page,
      document_id: typeof src.document_id === "string" ? src.document_id : null,
    };
    const prev = out.get(predicate);
    if (prev && !multi.has(predicate)) {
      issues.push({
        path: `${at}.predicate`,
        message: `${predicate} appears twice (${prev[0]!.id} and ${id}): give the one that applies`,
      });
      return;
    }
    out.set(predicate, [...(prev ?? []), fact]);
  });
  return out;
}

// --- helpers ------------------------------------------------------------------------------------

const TOL = 0.005; // half a cent: a difference below this is not a difference
const BASE_TOL = 0.02; // two cents: a base that is the product of rounded figures
const usd = (x: number): number => round(x, 2);

function money(x: number): string {
  const r = round(Math.abs(x), 2).toFixed(2);
  const [int, frac] = r.split(".") as [string, string];
  return `${x < 0 && r !== "0.00" ? "-" : ""}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}
/** A short, identical-in-both-languages number: integers bare, others to at most 6 places. */
function num(x: number): string {
  return String(round(x, 6));
}
const pct = (x: number): string => `${num(round(x * 100, 4))}%`;

/** Lower-case words of a label, single-spaced. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function hasWords(label: string, phrase: string): boolean {
  const p = norm(phrase);
  return p !== "" && ` ${norm(label)} `.includes(` ${p} `);
}

type Class = "follows_from_terms" | "depends_on_reading" | "question_to_ask";

interface Source {
  side: "lease" | "statement";
  fact_id: string;
  predicate: string;
  quote: string;
  page: number;
  document_id: string | null;
}

interface Finding {
  id: string;
  code: string;
  check: string;
  title: string;
  class: Class;
  landlord_label: string;
  lease_label: string;
  landlord_figure: number | null;
  lease_figure: number | null;
  difference: number | null;
  unit: "USD";
  lease_fact_ids: string[];
  statement_fact_ids: string[];
  line_fact_ids: string[];
  sources: Source[];
  steps: string[];
  confirm: string[];
}

interface NotRun {
  check: string;
  status: "not_run" | "partly_run";
  reason: string;
}

/** What the two figures of a finding are, as a reader names them: [the landlord's, the lease's]. */
const FIGURE_LABELS: Record<string, [string, string]> = {
  FEE_RATE_ABOVE_CAP: ["Fee at the rate billed", "Fee at the lease rate"],
  FEE_ON_EXCLUDED_LINES: [
    "Fee on the landlord's base",
    "Fee on the lease's base",
  ],
  FEE_ON_GROSSED_UP_BASE: [
    "Fee on the landlord's base",
    "Fee on the lease's base",
  ],
  FEE_BASE_UNRECONCILED: [
    "Fee on the landlord's base",
    "Fee on the lease's base",
  ],
  CAP_EXCEEDED: ["Controllable charge billed", "Charge at the cap"],
  CAP_METHOD_AMBIGUOUS: ["Controllable charge billed", "Charge at the cap"],
  CAPEX_BILLED_AS_OPERATING: [
    "Charged to the tenant",
    "Recoverable under the lease",
  ],
  CAPEX_AMORTIZATION: ["Charged to the tenant", "Recoverable under the lease"],
  GROSSUP_ON_FIXED_EXPENSE: ["Charge as grossed up", "Charge without gross-up"],
  GROSSUP_WRONG_OCCUPANCY: [
    "Charge at the landlord's occupancy",
    "Charge at the lease's occupancy",
  ],
  SHARE_DIFFERS: ["Charge at the share applied", "Charge at the lease share"],
  EXCLUDED_CATEGORY_BILLED: [
    "Charged to the tenant",
    "Recoverable under the lease",
  ],
  DUPLICATE_LINE: ["Charged to the tenant", "Charged once"],
  DUPLICATE_OF_SEPARATE_BILL: ["Charged to the tenant", "Charged once"],
  BASE_YEAR_DIFFERS: [
    "Deduction the landlord applied",
    "Deduction the lease yields",
  ],
  BASE_YEAR_DEDUCTION: [
    "Deduction the landlord applied",
    "Deduction the lease yields",
  ],
  STOP_DIFFERS: [
    "Deduction the landlord applied",
    "Deduction the lease yields",
  ],
  ARITH_LINES_VS_TOTAL: ["Share of the stated total", "Share of the lines"],
  ARITH_ESTIMATES: ["Estimates credited", "Estimates paid"],
  ARITH_BALANCE: ["Balance claimed", "Balance the figures yield"],
  ARITH_FEE: ["Fee stated", "Fee the rate and base yield"],
  YOY_RISE: ["This year's line", "Prior year's line"],
};

const CHECKS: [string, string][] = [
  ["management_fee", "Management or admin fee"],
  ["cap", "Cap on controllable expenses"],
  ["capital_items", "Capital items"],
  ["gross_up", "Gross-up"],
  ["pro_rata_share", "Pro-rata share"],
  ["excluded_categories", "Excluded categories billed"],
  ["duplicates", "Duplicate lines"],
  ["base_year_or_stop", "Base year or expense stop"],
  ["arithmetic", "Arithmetic"],
  ["year_over_year", "Year over year"],
  ["deadlines", "Deadline to dispute or audit"],
  ["cost_shifting", "Audit cost-shifting"],
];

const CONFIRM_COMMON =
  "that the quoted lease sentence is the one that governs (check amendments and the defined terms)";

interface Line {
  fact: AFact;
  label: string;
  amount: number;
  controllable: boolean | undefined;
  variable: boolean | undefined;
  capital: boolean | undefined;
  grossed: number | undefined;
  amortization: { cost: number; years: number; rate: number } | undefined;
}

/** The level annual payment per dollar of cost over n years at rate r (r = 0: 1 / n). */
function levelFactor(r: number, n: number): number {
  if (r === 0) return 1 / n;
  return r / (1 - 1 / powInt(1 + r, n));
}

function audit(input: AuditInput): Json {
  // ---- read and validate every fact -----------------------------------------------------------
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const ignoredLease: string[] = [];
  const ignoredStatement: string[] = [];
  const L = readFacts(
    input.lease_facts,
    "lease_facts",
    "lease",
    LEASE_SHAPES,
    LEASE_MULTI,
    undefined,
    issues,
    ids,
    ignoredLease,
  );
  const S_ = readFacts(
    input.statement_facts,
    "statement_facts",
    "statement",
    STATEMENT_SHAPES,
    STATEMENT_MULTI,
    undefined,
    issues,
    ids,
    ignoredStatement,
  );
  const P = input.prior_statement_facts
    ? readFacts(
        input.prior_statement_facts,
        "prior_statement_facts",
        "statement",
        STATEMENT_SHAPES,
        STATEMENT_MULTI,
        PRIOR_USED,
        issues,
        new Set(),
        [],
      )
    : new Map<string, AFact[]>();
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  const lease = (p: string): AFact | undefined => L.get(p)?.[0];
  const st = (p: string): AFact | undefined => S_.get(p)?.[0];
  const v = <T>(f: AFact | undefined): T | undefined =>
    f?.value as T | undefined;

  const findings: Finding[] = [];
  const counts = new Map<string, number>();
  const notRun: NotRun[] = [];
  const ran = new Map<string, number>();
  const sourceOf = (f: AFact, side: "lease" | "statement"): Source => ({
    side,
    fact_id: f.id,
    predicate: f.predicate,
    quote: f.quote,
    page: f.page,
    document_id: f.document_id,
  });
  function add(
    check: string,
    code: string,
    f: {
      title: string;
      class: Class;
      landlord: number | null;
      lease: number | null;
      difference: number | null;
      leaseFacts: AFact[];
      statementFacts: AFact[];
      lines?: AFact[];
      steps: string[];
      confirm: string[];
    },
  ): void {
    if (f.leaseFacts.length === 0)
      throw new Error(`${code}: a finding needs a lease fact behind it`);
    const n = (counts.get(code) ?? 0) + 1;
    counts.set(code, n);
    ran.set(check, (ran.get(check) ?? 0) + 1);
    const uniq = (a: AFact[]) => [...new Map(a.map((x) => [x.id, x])).values()];
    const lf = uniq(f.leaseFacts);
    const sf = uniq(f.statementFacts);
    findings.push({
      id: `${code}.${n}`,
      code,
      check,
      title: f.title,
      class: f.class,
      landlord_label: FIGURE_LABELS[code]?.[0] ?? "Landlord's figure",
      lease_label: FIGURE_LABELS[code]?.[1] ?? "Figure the lease yields",
      landlord_figure: f.landlord,
      lease_figure: f.lease,
      difference: f.difference,
      unit: "USD",
      lease_fact_ids: lf.map((x) => x.id),
      statement_fact_ids: sf.map((x) => x.id),
      line_fact_ids: uniq(f.lines ?? []).map((x) => x.id),
      sources: [
        ...lf.map((x) => sourceOf(x, "lease")),
        ...sf.map((x) => sourceOf(x, "statement")),
      ],
      steps: f.steps,
      confirm: [...f.confirm, CONFIRM_COMMON],
    });
  }
  const skip = (
    check: string,
    reason: string,
    status: NotRun["status"] = "not_run",
  ) => notRun.push({ check, status, reason });
  const missing = (parts: [unknown, string][]): string[] =>
    parts.filter(([x]) => x === undefined || x === null).map(([, n]) => n);

  // ---- common reads ---------------------------------------------------------------------------
  const shareFact = lease("lease.pro_rata_share");
  const leaseShare = shareFact ? (shareFact.raw as number) : undefined;
  const appliedFact = st("statement.share_applied");
  const applied = v<{ share: number; building_sf?: number }>(appliedFact);
  const S = applied?.share ?? leaseShare;
  const periodFact = st("statement.period");
  const period = v<{
    year: number;
    statement_date: string;
    received_date: string;
  }>(periodFact);
  const lines: Line[] = (S_.get("statement.line") ?? []).map((f) => {
    const x = f.value as {
      label: string;
      amount: number;
      controllable?: boolean;
      variable?: boolean;
      capital?: boolean;
      grossed_up_amount?: number;
      amortization?: { cost: number; years: number; rate: number };
    };
    return {
      fact: f,
      label: x.label,
      amount: x.amount,
      controllable: x.controllable,
      variable: x.variable,
      capital: x.capital,
      grossed: x.grossed_up_amount,
      amortization: x.amortization,
    };
  });
  const sumActual = (ls: Line[]) => ls.reduce((a, l) => a + l.amount, 0);
  const sumGross = (ls: Line[]) =>
    ls.reduce((a, l) => a + (l.grossed ?? l.amount), 0);

  const exclusions = (L.get("lease.cam_exclusion") ?? []).map((f) => {
    const raw = f.raw as string | { category: string; keywords?: string[] };
    return {
      fact: f,
      words:
        typeof raw === "string"
          ? [raw]
          : [raw.category, ...(raw.keywords ?? [])],
    };
  });
  const excludedBy = (label: string) =>
    exclusions.find((e) => e.words.some((w) => hasWords(label, w)));
  const capexFact = lease("lease.capex_treatment");
  const capex = v<{
    keywords: string[];
    recoverable: "excluded" | "amortized";
    amortization_years?: number;
    interest_rate?: number;
    method?: string;
  }>(capexFact);
  const isCapital = (l: Line) =>
    l.capital === true ||
    (capex?.keywords ?? []).some((w) => hasWords(l.label, w));
  const feeFact = lease("lease.cam_admin_fee");
  const fee = v<{
    rate: number;
    base: "actual" | "grossed_up";
    excluded_from_base: string[];
  }>(feeFact);
  const feeExcluded = (l: Line) =>
    (fee?.excluded_from_base ?? []).some((w) => hasWords(l.label, w)) ||
    excludedBy(l.label) !== undefined ||
    (capex?.recoverable === "excluded" && isCapital(l));
  const anchor = shareFact ? [shareFact] : [];
  const flaggedExcluded = new Set(
    lines.filter((l) => excludedBy(l.label)).map((l) => l.fact.id),
  );

  const needShare = (check: string): boolean => {
    if (shareFact === undefined || S === undefined) {
      skip(
        check,
        "needs lease.pro_rata_share (every finding rests on the tenant's share, and the lease term is missing)",
      );
      return false;
    }
    if (
      lines.length === 0 &&
      check !== "deadlines" &&
      check !== "cost_shifting"
    ) {
      skip(check, "needs statement.line facts (no billed line was given)");
      return false;
    }
    return true;
  };

  // ---- 5. pro-rata share ----------------------------------------------------------------------
  if (needShare("pro_rata_share")) {
    if (!applied)
      skip(
        "pro_rata_share",
        "needs statement.share_applied (the share the statement applied)",
      );
    else if (
      Math.abs(applied.share - leaseShare!) > 1e-9 &&
      applied.share > leaseShare!
    ) {
      const pool = sumActual(lines);
      const lb = v<{ tenant_sf: number; building_sf: number }>(
        lease("lease.pro_rata_basis"),
      );
      const denom =
        lb &&
        applied.building_sf !== undefined &&
        Math.abs(lb.building_sf - applied.building_sf) > 1e-9
          ? ` The statement's denominator is ${num(applied.building_sf)} SF; the lease's is ${num(lb.building_sf)} SF.`
          : "";
      add("pro_rata_share", "SHARE_DIFFERS", {
        title: `Share applied is ${pct(applied.share)}; the lease states ${pct(leaseShare!)}`,
        class: "follows_from_terms",
        landlord: usd(applied.share * pool),
        lease: usd(leaseShare! * pool),
        difference: usd(applied.share * pool - leaseShare! * pool),
        leaseFacts: [
          shareFact!,
          ...(lb ? [lease("lease.pro_rata_basis")!] : []),
        ],
        statementFacts: [appliedFact!],
        steps: [
          `Pool of billed lines: ${money(pool)} (${lines.length} lines)`,
          `Landlord: ${pct(applied.share)} x ${money(pool)} = ${money(applied.share * pool)}`,
          `Lease: ${pct(leaseShare!)} x ${money(pool)} = ${money(leaseShare! * pool)}`,
          `Difference to the tenant: ${money(applied.share * pool - leaseShare! * pool)}.${denom}`,
        ],
        confirm: [
          "that the lease share has not changed by amendment or remeasurement",
        ],
      });
    } else ran.set("pro_rata_share", ran.get("pro_rata_share") ?? 0);
  }

  // ---- 1. management or admin fee -------------------------------------------------------------
  const feeStatement = st("statement.admin_fee");
  const feeS = v<{ rate: number; base_amount: number; amount: number }>(
    feeStatement,
  );
  if (needShare("management_fee")) {
    const m = missing([
      [feeFact, "lease.cam_admin_fee"],
      [feeStatement, "statement.admin_fee"],
    ]);
    if (m.length) skip("management_fee", `needs ${m.join(" and ")}`);
    else {
      ran.set("management_fee", ran.get("management_fee") ?? 0);
      const rl = fee!.rate;
      const rs = feeS!.rate;
      const b = feeS!.base_amount;
      const share = S!;
      if (rs > rl + 1e-9)
        add("management_fee", "FEE_RATE_ABOVE_CAP", {
          title: `Fee rate billed is ${pct(rs)}; the lease allows ${pct(rl)}`,
          class: "follows_from_terms",
          landlord: usd(b * rs),
          lease: usd(b * rl),
          difference: usd(b * rs - b * rl),
          leaseFacts: [feeFact!, ...anchor],
          statementFacts: [feeStatement!],
          steps: [
            `Fee base on the statement: ${money(b)}`,
            `Landlord: ${pct(rs)} x ${money(b)} = ${money(b * rs)}`,
            `Lease: ${pct(rl)} x ${money(b)} = ${money(b * rl)}`,
          ],
          confirm: [
            "that the lease's rate is the maximum, and not a rate for one category of cost",
          ],
        });
      const clean = lines.filter((l) => !feeExcluded(l));
      const excluded = lines.filter((l) => feeExcluded(l));
      const A = share * sumActual(lines);
      const B = share * sumGross(lines);
      const C = share * sumActual(clean);
      const D = share * sumGross(clean);
      const ideal = fee!.base === "actual" ? C : D;
      const near = (x: number) => Math.abs(b - x) <= BASE_TOL;
      // Each fee-base finding compares two fees at the lease's rate: on the base before the
      // error and on the base after it, so the two figures are comparable totals and the
      // difference is their difference.
      const base = (
        code: string,
        title: string,
        hi: number,
        lo: number,
        cls: Class,
        step: string,
        confirmExtra: string,
        ls: AFact[],
      ) =>
        add("management_fee", code, {
          title,
          class: cls,
          landlord: usd(rl * hi),
          lease: usd(rl * lo),
          difference: usd(usd(rl * hi) - usd(rl * lo)),
          leaseFacts: [feeFact!, ...anchor],
          statementFacts: [feeStatement!, ...ls],
          lines: ls,
          steps: [
            `Fee base on the statement: ${money(b)}; the base the lease yields: ${money(ideal)}`,
            step,
            `Fee at the lease rate on the higher base: ${pct(rl)} x ${money(hi)} = ${money(rl * hi)}`,
            `Fee at the lease rate on the lower base: ${pct(rl)} x ${money(lo)} = ${money(rl * lo)}`,
            `Difference: ${money(rl * hi)} less ${money(rl * lo)} = ${money(usd(rl * hi) - usd(rl * lo))}`,
          ],
          confirm: [confirmExtra],
        });
      if (b > ideal + BASE_TOL) {
        const exLines = excluded.map((l) => l.fact);
        if (fee!.base === "actual" && near(A))
          base(
            "FEE_ON_EXCLUDED_LINES",
            "Fee charged on lines the lease excludes from the fee base",
            A,
            C,
            "depends_on_reading",
            `The statement's fee base equals the share of every line (${money(A)}), so it includes: ${excluded.map((l) => l.label).join("; ")}`,
            "which lines the landlord included in its fee base (the statement gives only the total)",
            exLines,
          );
        else if (fee!.base === "actual" && near(B)) {
          base(
            "FEE_ON_GROSSED_UP_BASE",
            "Fee charged on a grossed-up base; the lease says actual expenses",
            B,
            A,
            "depends_on_reading",
            `The statement's fee base equals the share of every line grossed up (${money(B)}), not of actual amounts (${money(A)})`,
            "which lines the landlord included in its fee base (the statement gives only the total)",
            [],
          );
          if (A - C > BASE_TOL)
            base(
              "FEE_ON_EXCLUDED_LINES",
              "Fee charged on lines the lease excludes from the fee base",
              A,
              C,
              "depends_on_reading",
              `The base also includes: ${excluded.map((l) => l.label).join("; ")}`,
              "which lines the landlord included in its fee base (the statement gives only the total)",
              exLines,
            );
        } else if (fee!.base === "actual" && near(D))
          base(
            "FEE_ON_GROSSED_UP_BASE",
            "Fee charged on a grossed-up base; the lease says actual expenses",
            D,
            C,
            "depends_on_reading",
            `The statement's fee base equals the share of the non-excluded lines grossed up (${money(D)}), not of actual amounts (${money(C)})`,
            "which lines the landlord included in its fee base (the statement gives only the total)",
            [],
          );
        else if (fee!.base === "grossed_up" && near(B))
          base(
            "FEE_ON_EXCLUDED_LINES",
            "Fee charged on lines the lease excludes from the fee base",
            B,
            D,
            "depends_on_reading",
            `The statement's fee base equals the share of every line grossed up (${money(B)}), so it includes: ${excluded.map((l) => l.label).join("; ")}`,
            "which lines the landlord included in its fee base (the statement gives only the total)",
            exLines,
          );
        else
          base(
            "FEE_BASE_UNRECONCILED",
            "Fee base is higher than any base the lease allows, and matches none of the statement's lines",
            b,
            ideal,
            "depends_on_reading",
            `The statement's fee base (${money(b)}) matches none of: all lines (${money(A)}), all lines grossed up (${money(B)}), lines the lease allows (${money(C)}), those grossed up (${money(D)})`,
            "how the landlord built its fee base (ask for the workpaper)",
            [],
          );
      }
    }
  }

  // ---- 2. cap ---------------------------------------------------------------------------------
  const capFact = lease("lease.cam_cap");
  const capRateFact = lease("lease.cam_cap_rate");
  if (needShare("cap")) {
    const refFact = st("statement.cap_reference");
    const appliedCapFact = st("statement.cap_applied");
    const m = missing([
      [capFact ?? capRateFact, "lease.cam_cap (or lease.cam_cap_rate)"],
      [refFact, "statement.cap_reference"],
      [appliedCapFact, "statement.cap_applied"],
      [period, "statement.period"],
    ]);
    const noFlag = lines.filter((l) => l.controllable === undefined);
    if (m.length) skip("cap", `needs ${m.join(", ")}`);
    else if (noFlag.length)
      skip(
        "cap",
        `every line needs a controllable flag (statement.line controllable true or false); missing on: ${noFlag.map((l) => l.label).join("; ")}`,
      );
    else {
      const ref = v<{ year: number; amount: number }>(refFact)!;
      const n = period!.year - ref.year;
      if (n < 0)
        skip(
          "cap",
          `statement.cap_reference year ${ref.year} is after the statement year ${period!.year}`,
        );
      else {
        ran.set("cap", ran.get("cap") ?? 0);
        const rate = capFact
          ? (capFact.value as { rate: number }).rate
          : (capRateFact!.value as { rate: number }).rate;
        const methods: (
          "compounding_from_base" | "simple_from_base" | "year_over_year"
        )[] = capFact
          ? [
              (
                capFact.value as {
                  method:
                    | "compounding_from_base"
                    | "simple_from_base"
                    | "year_over_year";
                }
              ).method,
            ]
          : ["compounding_from_base", "simple_from_base", "year_over_year"];
        const limit = (mth: string): number =>
          mth === "compounding_from_base"
            ? ref.amount * powInt(1 + rate, n)
            : mth === "simple_from_base"
              ? ref.amount * (1 + rate * n)
              : ref.amount * (1 + rate);
        const Cc = sumActual(lines.filter((l) => l.controllable === true));
        const share = S!;
        const billed = share * Cc;
        const lim = v<{ limit: number | null }>(appliedCapFact)!.limit;
        const landlord = lim === null ? billed : Math.min(billed, lim);
        const per = methods.map((mth) => ({
          mth,
          lim: limit(mth),
          yield: Math.min(billed, limit(mth)),
        }));
        const high = Math.max(...per.map((p) => p.yield));
        const low = Math.min(...per.map((p) => p.yield));
        const steps = [
          `Tenant's share of controllable lines: ${pct(share)} x ${money(Cc)} = ${money(billed)}`,
          `Cap limit the landlord applied: ${lim === null ? "none" : money(lim)}; the landlord's controllable charge: ${money(landlord)}`,
          ...per.map(
            (p) =>
              `Cap limit under ${p.mth} (reference ${money(ref.amount)} in ${ref.year}, ${pct(rate)}, ${n} year${n === 1 ? "" : "s"}): ${money(p.lim)}; charge ${money(p.yield)}`,
          ),
        ];
        const leaseFacts = [(capFact ?? capRateFact)!, ...anchor];
        const stFacts = [
          refFact!,
          appliedCapFact!,
          ...lines.filter((l) => l.controllable === true).map((l) => l.fact),
        ];
        const ctl = lines
          .filter((l) => l.controllable === true)
          .map((l) => l.fact);
        if (capFact) {
          if (landlord - high > TOL)
            add("cap", "CAP_EXCEEDED", {
              title: `Controllable charge ${money(landlord)} exceeds the cap (${money(high)}) under the lease's ${per[0]!.mth.replace(/_/g, " ")} method`,
              class: "follows_from_terms",
              landlord: usd(landlord),
              lease: usd(high),
              difference: usd(landlord - high),
              leaseFacts,
              statementFacts: stFacts.slice(0, 2),
              lines: ctl,
              steps,
              confirm: [
                "that the reference amount is the base-year figure the lease means, and that no line the landlord calls controllable is uncontrollable under the lease's definition",
              ],
            });
        } else if (landlord - low > TOL) {
          const least = Math.max(0, landlord - high);
          add("cap", "CAP_METHOD_AMBIGUOUS", {
            title: `The lease states a ${pct(rate)} cap without saying how it builds; the controllable charge is ${money(landlord)} and the cap is between ${money(low)} and ${money(high)} depending on the reading`,
            class: "depends_on_reading",
            landlord: usd(landlord),
            lease: usd(high),
            difference: usd(least),
            leaseFacts,
            statementFacts: stFacts.slice(0, 2),
            lines: ctl,
            steps: [
              ...steps,
              `Difference to the tenant under the reading most favourable to the landlord: ${money(least)}; under the least favourable: ${money(landlord - low)}`,
            ],
            confirm: [
              "which of the three methods the lease means (the clause says only 'cumulative' or 'non-cumulative', not how the cap builds)",
            ],
          });
        }
      }
    }
  }

  // ---- 3. capital items -----------------------------------------------------------------------
  if (needShare("capital_items")) {
    if (!capexFact)
      skip(
        "capital_items",
        "needs lease.capex_treatment (how the lease treats capital items)",
      );
    else if (
      capex!.recoverable === "amortized" &&
      capex!.amortization_years === undefined
    )
      skip(
        "capital_items",
        "lease.capex_treatment says amortized but gives no amortization_years",
      );
    else if (
      capex!.recoverable === "amortized" &&
      capex!.method === "straight_line" &&
      (capex!.interest_rate ?? 0) > 0
    )
      skip(
        "capital_items",
        "a declining-balance schedule depends on the year of the improvement; only level-payment amortization is computed (leave it to a person)",
      );
    else {
      ran.set("capital_items", ran.get("capital_items") ?? 0);
      const share = S!;
      const nYears = capex!.amortization_years;
      const rate = capex!.interest_rate ?? 0;
      for (const l of lines) {
        if (!isCapital(l) || flaggedExcluded.has(l.fact.id)) continue;
        if (capex!.recoverable === "excluded") {
          add("capital_items", "CAPEX_BILLED_AS_OPERATING", {
            title: `Capital item billed as an operating expense: ${l.label}`,
            class: "follows_from_terms",
            landlord: usd(share * l.amount),
            lease: 0,
            difference: usd(share * l.amount),
            leaseFacts: [capexFact, ...anchor],
            statementFacts: [l.fact],
            lines: [l.fact],
            steps: [
              `${l.label}: ${money(l.amount)} building-level; tenant's share ${pct(share)} = ${money(share * l.amount)}; the lease excludes capital items`,
            ],
            confirm: [
              "that this line is a capital item as the lease defines it (a repair is not a replacement)",
            ],
          });
        } else if (l.amortization) {
          const f = levelFactor(rate, nYears!);
          const leaseAnnual = l.amortization.cost * f;
          if (share * (l.amount - leaseAnnual) > TOL)
            add("capital_items", "CAPEX_AMORTIZATION", {
              title: `Capital item ${l.label} amortized over ${l.amortization.years} years at ${pct(l.amortization.rate)}; the lease says ${nYears} years at ${pct(rate)}`,
              class: "follows_from_terms",
              landlord: usd(share * l.amount),
              lease: usd(share * leaseAnnual),
              difference: usd(share * (l.amount - leaseAnnual)),
              leaseFacts: [capexFact, ...anchor],
              statementFacts: [l.fact],
              lines: [l.fact],
              steps: [
                `Cost ${money(l.amortization.cost)}; the statement bills ${money(l.amount)} for the year`,
                `Level annual payment under the lease: ${money(l.amortization.cost)} x ${num(round(f, 8))} = ${money(leaseAnnual)}`,
                `Tenant's share ${pct(share)}: landlord ${money(share * l.amount)}; lease ${money(share * leaseAnnual)}`,
              ],
              confirm: [
                "whether the lease's amortization is a level payment, as computed here",
              ],
            });
        } else {
          const leaseAnnual = l.amount * levelFactor(rate, nYears!);
          if (share * (l.amount - leaseAnnual) > TOL)
            add("capital_items", "CAPEX_BILLED_AS_OPERATING", {
              title: `Capital item billed in full; the lease allows amortization over ${nYears} years: ${l.label}`,
              class: "follows_from_terms",
              landlord: usd(share * l.amount),
              lease: usd(share * leaseAnnual),
              difference: usd(share * (l.amount - leaseAnnual)),
              leaseFacts: [capexFact, ...anchor],
              statementFacts: [l.fact],
              lines: [l.fact],
              steps: [
                `${l.label}: ${money(l.amount)} billed in one year`,
                `First-year recovery under the lease: ${money(l.amount)} x ${num(round(levelFactor(rate, nYears!), 8))} = ${money(leaseAnnual)}`,
                `Tenant's share ${pct(share)}: landlord ${money(share * l.amount)}; lease ${money(share * leaseAnnual)}`,
              ],
              confirm: [
                "that this line is a capital item as the lease defines it, and the year the amortization starts",
              ],
            });
        }
      }
    }
  }

  // ---- 4. gross-up ----------------------------------------------------------------------------
  const grossLeaseFact = lease("lease.cam_gross_up");
  const grossLease = v<{
    target_occupancy: number;
    applies_to: string;
    base_year_grossed_up?: boolean;
  }>(grossLeaseFact);
  const grossStFact = st("statement.gross_up");
  const grossSt = v<{ actual_occupancy: number; target_occupancy: number }>(
    grossStFact,
  );
  if (needShare("gross_up")) {
    if (!grossLeaseFact)
      skip("gross_up", "needs lease.cam_gross_up (the gross-up clause)");
    else {
      ran.set("gross_up", ran.get("gross_up") ?? 0);
      const share = S!;
      const variableOnly = grossLease!.applies_to === "variable_expenses";
      const unflagged = lines.filter((l) => l.variable === undefined);
      if (variableOnly) {
        for (const l of lines)
          if (
            l.variable === false &&
            l.grossed !== undefined &&
            l.grossed - l.amount > TOL
          )
            add("gross_up", "GROSSUP_ON_FIXED_EXPENSE", {
              title: `Gross-up applied to a fixed expense: ${l.label}`,
              class: "follows_from_terms",
              landlord: usd(share * l.grossed),
              lease: usd(share * l.amount),
              difference: usd(share * (l.grossed - l.amount)),
              leaseFacts: [grossLeaseFact, ...anchor],
              statementFacts: [l.fact],
              lines: [l.fact],
              steps: [
                `${l.label}: actual ${money(l.amount)}, grossed up to ${money(l.grossed)}; the lease grosses up variable expenses only`,
              ],
              confirm: [
                "that this expense is fixed (it does not vary with occupancy) as the lease defines it",
              ],
            });
      }
      if (grossSt) {
        const eligible = lines.filter((l) =>
          variableOnly ? l.variable === true : true,
        );
        const leaseT = grossLease!.target_occupancy;
        const stT = grossSt.target_occupancy;
        const occ = grossSt.actual_occupancy;
        const calc = (a: number, t: number) => (occ < t ? a * (t / occ) : a);
        let excess = 0;
        for (const l of eligible) {
          const landlordAmt = l.grossed ?? calc(l.amount, stT);
          const leaseAmt = calc(l.amount, leaseT);
          if (landlordAmt - leaseAmt > TOL) excess += landlordAmt - leaseAmt;
        }
        if (share * excess > TOL)
          add("gross_up", "GROSSUP_WRONG_OCCUPANCY", {
            title: `Grossed up to ${pct(stT)} occupancy (actual ${pct(occ)}); the lease grosses up to ${pct(leaseT)}`,
            class: "follows_from_terms",
            landlord: usd(
              share *
                eligible.reduce(
                  (a, l) => a + (l.grossed ?? calc(l.amount, stT)),
                  0,
                ),
            ),
            lease: usd(
              share * eligible.reduce((a, l) => a + calc(l.amount, leaseT), 0),
            ),
            difference: usd(share * excess),
            leaseFacts: [grossLeaseFact, ...anchor],
            statementFacts: [grossStFact!, ...eligible.map((l) => l.fact)],
            lines: eligible.map((l) => l.fact),
            steps: [
              `Gross-up eligible lines (${variableOnly ? "variable expenses" : "all expenses"}): ${eligible.map((l) => l.label).join("; ")}`,
              `Landlord's occupancy used: actual ${pct(occ)}, target ${pct(stT)}; the lease's target is ${pct(leaseT)}`,
              `Excess grossed-up amount (building level): ${money(excess)}; tenant's share ${pct(share)} = ${money(share * excess)}`,
            ],
            confirm: [
              "the actual occupancy (the statement's figure is used as stated)",
            ],
          });
        const by = v<{ grossed_up?: boolean }>(
          st("statement.base_year_applied"),
        );
        if (
          grossLease!.base_year_grossed_up === true &&
          by?.grossed_up === false
        )
          add("gross_up", "GROSSUP_BASE_YEAR_INCONSISTENT", {
            title:
              "The current year is grossed up but the base year deduction is not",
            class: "question_to_ask",
            landlord: null,
            lease: null,
            difference: null,
            leaseFacts: [grossLeaseFact, ...anchor],
            statementFacts: [grossStFact!, st("statement.base_year_applied")!],
            steps: [
              "The lease grosses up the base year as well; the statement's base-year deduction is not grossed up. A figure needs the base year's occupancy, which the statement does not give.",
            ],
            confirm: [
              "the base year's actual occupancy and whether its expenses were grossed up",
            ],
          });
      }
      if (unflagged.length && variableOnly)
        skip(
          "gross_up",
          `lines without a variable flag were not tested: ${unflagged.map((l) => l.label).join("; ")}`,
          "partly_run",
        );
      if (!grossSt)
        skip(
          "gross_up",
          "needs statement.gross_up (the occupancy the statement used) for the occupancy and base-year tests; the fixed-expense test ran",
          "partly_run",
        );
    }
  }

  // ---- 6. excluded categories -----------------------------------------------------------------
  if (needShare("excluded_categories")) {
    if (exclusions.length === 0)
      skip(
        "excluded_categories",
        "needs lease.cam_exclusion (the lease's excluded categories)",
      );
    else {
      ran.set("excluded_categories", ran.get("excluded_categories") ?? 0);
      for (const l of lines) {
        const e = excludedBy(l.label);
        if (!e) continue;
        const share = S!;
        if (share * l.amount > TOL)
          add("excluded_categories", "EXCLUDED_CATEGORY_BILLED", {
            title: `Billed a category the lease excludes: ${l.label}`,
            class: "follows_from_terms",
            landlord: usd(share * l.amount),
            lease: 0,
            difference: usd(share * l.amount),
            leaseFacts: [e.fact, ...anchor],
            statementFacts: [l.fact],
            lines: [l.fact],
            steps: [
              `${l.label}: ${money(l.amount)} building-level; tenant's share ${pct(share)} = ${money(share * l.amount)}; matched to the lease's exclusion (${e.words.join(", ")})`,
            ],
            confirm: [
              "that this line is in the excluded category as the lease defines it (the match is by the words in the lease's exclusion)",
            ],
          });
      }
    }
  }

  // ---- 7. duplicates --------------------------------------------------------------------------
  if (needShare("duplicates")) {
    ran.set("duplicates", ran.get("duplicates") ?? 0);
    const share = S!;
    const seen = new Map<string, Line>();
    for (const l of lines) {
      const key = `${norm(l.label)}|${round(l.amount, 2)}`;
      const first = seen.get(key);
      if (first && l.amount > 0)
        add("duplicates", "DUPLICATE_LINE", {
          title: `The same line appears twice: ${l.label} ${money(l.amount)}`,
          class: "depends_on_reading",
          landlord: usd(share * l.amount * 2),
          lease: usd(share * l.amount),
          difference: usd(share * l.amount),
          leaseFacts: anchor,
          statementFacts: [first.fact, l.fact],
          lines: [first.fact, l.fact],
          steps: [
            `Two lines with the same label and amount (${money(l.amount)}); the second at the tenant's share ${pct(share)} = ${money(share * l.amount)}`,
          ],
          confirm: [
            "that the two lines are one cost billed twice, and not two real costs of the same size",
          ],
        });
      else seen.set(key, l);
    }
    for (const sb of S_.get("statement.separately_billed") ?? []) {
      const x = sb.value as { label: string; amount: number };
      const hit = lines.find((l) => norm(l.label) === norm(x.label));
      const poolShare = hit ? share * hit.amount : 0;
      if (hit && Math.min(poolShare, x.amount) > TOL)
        add("duplicates", "DUPLICATE_OF_SEPARATE_BILL", {
          title: `A line in the statement is also billed separately: ${x.label}`,
          class: "depends_on_reading",
          landlord: usd(poolShare + x.amount),
          lease: usd(Math.max(poolShare, x.amount)),
          difference: usd(Math.min(poolShare, x.amount)),
          leaseFacts: anchor,
          statementFacts: [hit.fact, sb],
          lines: [hit.fact],
          steps: [
            `Pool line ${hit.label}: ${money(hit.amount)}; tenant's share ${pct(share)} = ${money(poolShare)}`,
            `Billed separately: ${money(x.amount)}`,
            `The smaller of the two is the amount billed twice: ${money(Math.min(poolShare, x.amount))}`,
          ],
          confirm: [
            "that the separate bill is for the same cost as the pool line",
          ],
        });
    }
  }

  // ---- 8. base year or expense stop -----------------------------------------------------------
  if (needShare("base_year_or_stop")) {
    const byFact = st("statement.base_year_applied");
    const by = v<{
      base_year?: number;
      stop_amount?: number;
      deduction: number;
    }>(byFact);
    const leaseBase = lease("lease.operating_expense_base_year");
    const stopFact = lease("lease.expense_stop");
    const m = missing([[by, "statement.base_year_applied"]]);
    if (m.length) skip("base_year_or_stop", `needs ${m.join(", ")}`);
    else if (!leaseBase && !stopFact)
      skip(
        "base_year_or_stop",
        "needs lease.operating_expense_base_year or lease.expense_stop",
      );
    else {
      ran.set("base_year_or_stop", ran.get("base_year_or_stop") ?? 0);
      const share = S!;
      const baseYear = leaseBase ? (leaseBase.raw as number) : undefined;
      const totalFact = (S_.get("statement.base_year_total") ?? []).find(
        (f) => (f.value as { year: number }).year === baseYear,
      );
      const total = totalFact
        ? (totalFact.value as { amount: number }).amount
        : undefined;
      if (by!.stop_amount !== undefined && stopFact) {
        const stop = (stopFact.value as { amount: number }).amount;
        const leaseDed = share * stop;
        if (leaseDed - by!.deduction > TOL)
          add("base_year_or_stop", "STOP_DIFFERS", {
            title: `Expense stop applied is ${money(by!.stop_amount)}; the lease states ${money(stop)}`,
            class: "follows_from_terms",
            landlord: usd(by!.deduction),
            lease: usd(leaseDed),
            difference: usd(leaseDed - by!.deduction),
            leaseFacts: [stopFact, ...anchor],
            statementFacts: [byFact!],
            steps: [
              `Deduction on the statement: ${money(by!.deduction)}`,
              `Lease: ${pct(share)} x ${money(stop)} = ${money(leaseDed)}`,
            ],
            confirm: [
              "that the stop is a building-level annual figure, and whether it escalates",
            ],
          });
      } else if (baseYear !== undefined && by!.base_year !== undefined) {
        if (by!.base_year !== baseYear) {
          if (total !== undefined) {
            const leaseDed = share * total;
            if (leaseDed - by!.deduction > TOL)
              add("base_year_or_stop", "BASE_YEAR_DIFFERS", {
                title: `Base year applied is ${by!.base_year}; the lease states ${baseYear}`,
                class: "follows_from_terms",
                landlord: usd(by!.deduction),
                lease: usd(leaseDed),
                difference: usd(leaseDed - by!.deduction),
                leaseFacts: [leaseBase!, ...anchor],
                statementFacts: [byFact!, totalFact!],
                steps: [
                  `Deduction on the statement: ${money(by!.deduction)}`,
                  `Lease: ${pct(share)} x base-year total ${money(total)} (${baseYear}) = ${money(leaseDed)}`,
                ],
                confirm: [
                  "the base-year total (the statement's figure is used as stated)",
                ],
              });
          } else
            add("base_year_or_stop", "BASE_YEAR_DIFFERS", {
              title: `Base year applied is ${by!.base_year}; the lease states ${baseYear}`,
              class: "depends_on_reading",
              landlord: null,
              lease: null,
              difference: null,
              leaseFacts: [leaseBase!, ...anchor],
              statementFacts: [byFact!],
              steps: [
                "The base-year total for the lease's base year is not among the facts, so no dollar difference is computed.",
              ],
              confirm: [
                "the building's total expenses in the lease's base year",
              ],
            });
        } else if (total !== undefined) {
          const leaseDed = share * total;
          if (leaseDed - by!.deduction > TOL)
            add("base_year_or_stop", "BASE_YEAR_DEDUCTION", {
              title: `Base-year deduction is ${money(by!.deduction)}; the lease's base year (${baseYear}) yields ${money(leaseDed)}`,
              class: "follows_from_terms",
              landlord: usd(by!.deduction),
              lease: usd(leaseDed),
              difference: usd(leaseDed - by!.deduction),
              leaseFacts: [leaseBase!, ...anchor],
              statementFacts: [byFact!, totalFact!],
              steps: [
                `Lease: ${pct(share)} x ${money(total)} = ${money(leaseDed)}; statement: ${money(by!.deduction)}`,
              ],
              confirm: [
                "whether the base year's total was adjusted (grossed up, or restated for the lease's definitions)",
              ],
            });
        }
      }
    }
  }

  // ---- 9. arithmetic --------------------------------------------------------------------------
  if (needShare("arithmetic")) {
    ran.set("arithmetic", ran.get("arithmetic") ?? 0);
    const share = S!;
    const totalFact = st("statement.total");
    if (totalFact) {
      const t = (totalFact.value as { amount: number }).amount;
      const sum = sumActual(lines);
      if (Math.abs(t - sum) > TOL)
        add("arithmetic", "ARITH_LINES_VS_TOTAL", {
          title: `The lines add to ${money(sum)}; the statement's total is ${money(t)}`,
          class: "follows_from_terms",
          landlord: usd(share * t),
          lease: usd(share * sum),
          difference: usd(Math.max(0, usd(share * t) - usd(share * sum))),
          leaseFacts: anchor,
          statementFacts: [totalFact, ...lines.map((l) => l.fact)],
          steps: [
            `Sum of the ${lines.length} lines: ${money(sum)}; stated total: ${money(t)}; gap ${money(t - sum)}`,
            t > sum
              ? `If the charge is computed from the total, the tenant's share of the gap is ${pct(share)} x ${money(t - sum)} = ${money(share * (t - sum))}`
              : "The total is lower than the lines: no overcharge from this gap",
          ],
          confirm: [
            "which figure the charge was computed from (the lines or the total)",
          ],
        });
    }
    const credited = st("statement.estimates_credited");
    const paid = st("statement.estimates_paid");
    if (credited && paid) {
      const c = (credited.value as { amount: number }).amount;
      const p = (paid.value as { amount: number }).amount;
      if (p - c > TOL)
        add("arithmetic", "ARITH_ESTIMATES", {
          title: `The statement credits ${money(c)} of estimates; the tenant paid ${money(p)}`,
          class: "follows_from_terms",
          landlord: usd(c),
          lease: usd(p),
          difference: usd(p - c),
          leaseFacts: anchor,
          statementFacts: [credited, paid],
          steps: [
            `Estimates paid by the tenant: ${money(p)}; credited on the statement: ${money(c)}; difference ${money(p - c)}`,
          ],
          confirm: [
            "the tenant's payment records (the paid figure is the one given as a fact)",
          ],
        });
    }
    const charge = st("statement.tenant_charge");
    const balance = st("statement.balance_claimed");
    if (charge && credited && balance) {
      const ch = (charge.value as { amount: number }).amount;
      const c = (credited.value as { amount: number }).amount;
      const b = (balance.value as { amount: number }).amount;
      if (b - (ch - c) > TOL)
        add("arithmetic", "ARITH_BALANCE", {
          title: `The balance claimed is ${money(b)}; the charge less estimates credited is ${money(ch - c)}`,
          class: "follows_from_terms",
          landlord: usd(b),
          lease: usd(ch - c),
          difference: usd(b - (ch - c)),
          leaseFacts: anchor,
          statementFacts: [charge, credited, balance],
          steps: [
            `Charge ${money(ch)} less estimates credited ${money(c)} = ${money(ch - c)}; balance claimed ${money(b)}`,
          ],
          confirm: ["whether other charges are included in the balance"],
        });
    }
    if (feeS && feeFact) {
      const exp = feeS.rate * feeS.base_amount;
      if (feeS.amount - exp > 0.01 + TOL)
        add("arithmetic", "ARITH_FEE", {
          title: `The fee billed is ${money(feeS.amount)}; its rate on its base is ${money(exp)}`,
          class: "follows_from_terms",
          landlord: usd(feeS.amount),
          lease: usd(exp),
          difference: usd(feeS.amount - exp),
          leaseFacts: [feeFact, ...anchor],
          statementFacts: [feeStatement!],
          steps: [
            `${pct(feeS.rate)} x ${money(feeS.base_amount)} = ${money(exp)}; billed ${money(feeS.amount)}`,
          ],
          confirm: ["whether other fees are included in the amount billed"],
        });
    }
  }

  // ---- 10. year over year ---------------------------------------------------------------------
  if (needShare("year_over_year")) {
    const priorLines = P.get("statement.line") ?? [];
    if (priorLines.length === 0)
      skip(
        "year_over_year",
        "needs prior_statement_facts with statement.line facts",
      );
    else {
      ran.set("year_over_year", ran.get("year_over_year") ?? 0);
      const byLabel = new Map<string, { amount: number; facts: AFact[] }>();
      for (const f of priorLines) {
        const x = f.value as { label: string; amount: number };
        const k = norm(x.label);
        const e = byLabel.get(k) ?? { amount: 0, facts: [] };
        e.amount += x.amount;
        e.facts.push(f);
        byLabel.set(k, e);
      }
      const cur = new Map<string, number>();
      for (const l of lines)
        cur.set(norm(l.label), (cur.get(norm(l.label)) ?? 0) + l.amount);
      const done = new Set<string>();
      for (const l of lines) {
        const k = norm(l.label);
        const p = byLabel.get(k);
        if (!p || p.amount <= 0 || done.has(k)) continue;
        done.add(k);
        const now = cur.get(k)!;
        const rise = now / p.amount - 1;
        if (rise > input.yoy_threshold)
          add("year_over_year", "YOY_RISE", {
            title: `Question to ask: ${l.label} rose ${pct(rise)} (${money(p.amount)} to ${money(now)})`,
            class: "question_to_ask",
            landlord: usd(now),
            lease: usd(p.amount),
            difference: null,
            leaseFacts: anchor,
            statementFacts: [l.fact, ...p.facts],
            lines: [l.fact],
            steps: [
              `${l.label}: prior year ${money(p.amount)}, this year ${money(now)}, up ${pct(rise)} (the threshold is ${pct(input.yoy_threshold)})`,
              `Tenant's share of the rise: ${pct(S!)} x ${money(now - p.amount)} = ${money(S! * (now - p.amount))}. This is a question, not an overcharge.`,
            ],
            confirm: ["the reason for the rise (a rise is not an error)"],
          });
      }
    }
  }

  // ---- 11. deadlines --------------------------------------------------------------------------
  const rightFact = lease("lease.audit_right");
  const right = v<{
    window_days: number;
    starts_from: string;
    notice_form: string;
    auditor?: string;
    cost_shift_threshold?: { type: string; value: number };
  }>(rightFact);
  const deadlines: Json[] = [];
  {
    const m = missing([
      [rightFact, "lease.audit_right"],
      [period, "statement.period"],
    ]);
    if (m.length) skip("deadlines", `needs ${m.join(" and ")}`);
    else {
      ran.set("deadlines", 1);
      const from =
        right!.starts_from === "statement_receipt"
          ? period!.received_date
          : period!.statement_date;
      const last = addDays(from, right!.window_days);
      const left = daysBetween(input.as_of, last);
      deadlines.push({
        code: "AUDIT_WINDOW",
        title: "Last day to exercise the audit right or dispute the statement",
        last_day: last,
        starts_from: right!.starts_from,
        counted_from: from,
        window_days: right!.window_days,
        as_of: input.as_of,
        status: left >= 0 ? "open" : "passed",
        days_remaining: left,
        notice_form: right!.notice_form,
        ...(right!.auditor !== undefined
          ? { auditor_requirement: right!.auditor }
          : {}),
        lease_fact_ids: [rightFact!.id],
        statement_fact_ids: [periodFact!.id],
        sources: [
          sourceOf(rightFact!, "lease"),
          sourceOf(periodFact!, "statement"),
        ],
        steps: [
          `${right!.starts_from === "statement_receipt" ? "Received" : "Dated"} ${from}; ${right!.window_days} days later is ${last}; as of ${input.as_of}: ${left >= 0 ? `${left} days left` : `${-left} days past`}`,
        ],
        confirm: [
          "how the lease counts days (calendar days, business days, a day of receipt) and what counts as notice",
          CONFIRM_COMMON,
        ],
      });
    }
  }

  // ---- totals, then 12. cost-shifting ---------------------------------------------------------
  const firmSum = findings
    .filter((f) => f.class === "follows_from_terms" && f.difference !== null)
    .reduce((a, f) => a + f.difference!, 0);
  const readingSum = findings
    .filter((f) => f.class === "depends_on_reading" && f.difference !== null)
    .reduce((a, f) => a + f.difference!, 0);
  let costShifting: Json | null = null;
  {
    const thr = right?.cost_shift_threshold;
    const charge = v<{ amount: number }>(st("statement.tenant_charge"))?.amount;
    if (!rightFact) skip("cost_shifting", "needs lease.audit_right");
    else if (!thr)
      skip(
        "cost_shifting",
        "lease.audit_right states no cost-shifting threshold",
      );
    else if (thr.type === "percent_of_billed" && charge === undefined)
      skip(
        "cost_shifting",
        "the threshold is a percent of the amount billed: needs statement.tenant_charge",
      );
    else {
      ran.set("cost_shifting", 1);
      const amount = thr.type === "amount" ? thr.value : charge! * thr.value;
      const firm = usd(firmSum);
      costShifting = {
        code: "COST_SHIFT",
        threshold_type: thr.type,
        threshold_value: thr.value,
        threshold_amount: usd(amount),
        firm_difference: firm,
        difference_with_readings: usd(firmSum + readingSum),
        crosses_on_firm_findings: firmSum > amount,
        crosses_if_readings_hold: firmSum + readingSum > amount,
        lease_fact_ids: [rightFact.id],
        sources: [
          sourceOf(rightFact, "lease"),
          ...(charge !== undefined
            ? [sourceOf(st("statement.tenant_charge")!, "statement")]
            : []),
        ],
        steps: [
          thr.type === "amount"
            ? `Threshold: ${money(thr.value)}`
            : `Threshold: ${pct(thr.value)} of the ${money(charge!)} billed = ${money(amount)}`,
          `Differences that follow from the lease's terms: ${money(firmSum)}; with the findings that depend on a reading: ${money(firmSum + readingSum)}`,
          `The lease's threshold is ${firmSum > amount ? "crossed" : firmSum + readingSum > amount ? "crossed only if the readings hold" : "not crossed"}`,
        ],
        confirm: [
          "how the lease measures the overcharge (the whole statement, or each line) and whether the threshold is 'more than' or 'at least'",
        ],
      };
    }
  }

  // ---- items for fact_package_send ------------------------------------------------------------
  const flaggedLines = new Set(findings.flatMap((f) => f.line_fact_ids));
  const items: Json[] = [];
  const notSent: string[] = [];
  for (const f of findings) {
    if (
      f.class === "question_to_ask" ||
      f.landlord_figure === null ||
      f.lease_figure === null
    ) {
      notSent.push(f.id);
      continue;
    }
    items.push({
      key: f.id,
      label: f.title.slice(0, 160),
      value: f.lease_figure,
      unit: "USD",
      position: "state_ours",
      their_value: f.landlord_figure,
      fact_ids: [...f.lease_fact_ids, ...f.statement_fact_ids],
    });
  }
  lines.forEach((l, i) => {
    if (flaggedLines.has(l.fact.id)) return;
    items.push({
      key: `LINE.${i + 1}`,
      label: l.label.slice(0, 160),
      value: l.amount,
      unit: "USD",
      position: "accept_theirs",
      their_value: l.amount,
      fact_ids: [l.fact.id],
    });
  });

  // ---- checks table, answer -------------------------------------------------------------------
  const checks = CHECKS.map(([check, name]) => {
    const nr = notRun.filter((n) => n.check === check);
    const status = nr.find((n) => n.status === "not_run")
      ? "not_run"
      : nr.length
        ? "partly_run"
        : "ran";
    return {
      check,
      name,
      status,
      findings: findings.filter((f) => f.check === check).length,
      ...(nr.length ? { reason: nr.map((n) => n.reason).join("; ") } : {}),
    };
  });
  const factsUsed = new Set<string>(
    findings.flatMap((f) => [...f.lease_fact_ids, ...f.statement_fact_ids]),
  );
  for (const d of deadlines)
    for (const id of [
      ...(d.lease_fact_ids as string[]),
      ...(d.statement_fact_ids as string[]),
    ])
      factsUsed.add(id);
  for (const l of lines) factsUsed.add(l.fact.id);
  const firmCount = findings.filter(
    (f) => f.class === "follows_from_terms",
  ).length;
  const readingCount = findings.filter(
    (f) => f.class === "depends_on_reading",
  ).length;
  const questionCount = findings.filter(
    (f) => f.class === "question_to_ask",
  ).length;
  return {
    as_of: input.as_of,
    statement_year: period?.year ?? null,
    findings: findings as unknown as Json[],
    totals: {
      finding_count: findings.length,
      follows_from_terms: firmCount,
      depends_on_reading: readingCount,
      question_to_ask: questionCount,
      firm_difference: usd(firmSum),
      difference_with_readings: usd(firmSum + readingSum),
      total_difference: usd(firmSum + readingSum),
      unit: "USD",
    },
    deadlines,
    cost_shifting: costShifting,
    checks,
    checks_not_run: notRun as unknown as Json[],
    package_items: items,
    questions_not_sent: notSent,
    facts_used: [...factsUsed],
    facts_ignored: {
      lease: [...new Set(ignoredLease)],
      statement: [...new Set(ignoredStatement)],
    },
    notes: [
      "A finding is a difference between the statement and what the lease's quoted terms yield, with the sources named. It is not a legal conclusion: findings that depend on a reading of the lease, and questions, say so in their class.",
      "Each finding isolates one error while holding the others as the statement has them; findings can overlap where one line breaks more than one term, so the total is the sum of the findings, not a recomputed charge.",
    ],
  };
}

/** The summary a caller without a paid plan gets (hosted API, gating on): counts, total, deadlines, what could not run. */
export function auditSummary(full: Json): Json {
  const t = full.totals as Json;
  return {
    limited: true,
    summary: {
      finding_count: t.finding_count,
      total_difference: t.total_difference,
      firm_difference: t.firm_difference,
      unit: "USD",
      deadlines: (full.deadlines as Json[]).map((d) => ({
        code: d.code,
        last_day: d.last_day,
        status: d.status,
        days_remaining: d.days_remaining,
        notice_form: d.notice_form,
      })),
      checks_not_run: full.checks_not_run,
    },
    audit_available: "pro",
    audit_withheld: [
      "each finding (code, title, the landlord's figure, the lease's figure, the difference, the quotes and pages, the calculation steps)",
      "the audit cost-shifting test",
      "the items to send with fact_package_send",
      "the audit report (report_create kind expense_audit)",
    ],
    audit_note: `The count, total difference, deadlines and checks that could not run are free. Each finding with its lease quote and calculation, the report and sending the dispute as a package are part of the paid plans (Pro and Team): ${AUDIT_PLAN_URL}`,
  };
}

/** True when the host (the hosted Worker) has said this caller gets the summary only. */
export function auditLimited(): boolean {
  return currentExchangeCaller()?.fullAudit === false;
}

export function auditExpenseStatement(input: AuditInput): Json {
  const full = audit(input);
  return auditLimited() ? auditSummary(full) : full;
}
