/**
 * Which tool each report kind reads, and where a report's figures come from.
 *
 * Every calculator kind is built from FactLot's own run of its tool: the caller sends the tool's
 * arguments and the tool runs here. A result sent alongside is never used; the answer only says
 * whether it matched (result_mismatch). So a calculator report carries no number FactLot did
 * not compute.
 *
 * lease_abstract is the exception: its result comes from lease documents FactLot cannot reread
 * without them. With the tool's arguments (the documents' text) it is run here too; with only a
 * result, that result is accepted after a check of its exact shape (strict: no unknown fields),
 * the formula version and its counts, and every page of the document says the values are the
 * caller's and were not recomputed.
 *
 * The shapes and arithmetic links below also check every result FactLot computes before a
 * document is built from it.
 */
import {
  TX_EVIDENCE_NOTICE,
  TX_UNEQUAL_APPRAISAL_LAW,
  round,
} from "@factlot/calc";
import { getTool, runTool } from "@factlot/tools";
import { z } from "zod";

export const REPORT_KINDS = [
  "tx_unequal_appraisal",
  "lease_abstract",
  "cam_reconciliation",
  "debt_sizing",
  "asc842_schedule",
  "compare_proposals",
  "dcf_summary",
  "critical_dates",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_FORMATS = ["xlsx", "pdf", "ics"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** The tool (or tools) whose result each kind reads. */
export const KIND_TOOLS: Record<ReportKind, readonly string[]> = {
  tx_unequal_appraisal: ["calc_tx_unequal_appraisal"],
  lease_abstract: ["doc_abstract_lease"],
  cam_reconciliation: [
    "calc_cam_reconciliation",
    "calc_cam_reconciliation_batch",
  ],
  debt_sizing: ["calc_debt_sizing"],
  asc842_schedule: ["calc_lease_remeasurement_asc842"],
  compare_proposals: ["calc_compare_proposals"],
  dcf_summary: ["calc_dcf_pro_forma"],
  critical_dates: ["calc_critical_dates"],
};

export const KIND_FORMATS: Record<ReportKind, readonly ReportFormat[]> = {
  tx_unequal_appraisal: ["xlsx", "pdf"],
  lease_abstract: ["xlsx", "pdf"],
  cam_reconciliation: ["xlsx", "pdf"],
  debt_sizing: ["xlsx", "pdf"],
  asc842_schedule: ["xlsx", "pdf"],
  compare_proposals: ["xlsx", "pdf"],
  dcf_summary: ["xlsx", "pdf"],
  critical_dates: ["xlsx", "pdf", "ics"],
};

export interface Issue {
  path: string;
  message: string;
}

/** The kinds built from a calculator FactLot reruns: arguments are required. */
export const COMPUTED_KINDS: readonly ReportKind[] = REPORT_KINDS.filter(
  (k) => k !== "lease_abstract",
);

export type ReportErrorCode =
  | "InputError"
  | "ArgumentsRequired"
  | "NotAToolResult"
  | "FormulaVersion"
  | "ArgumentsError"
  | "TextNotAllowed"
  | "TooLarge";

export class ReportInputError extends Error {
  override name = "ReportInputError";
  readonly code: ReportErrorCode;
  readonly issues: Issue[];
  /** What to do instead, when the error knows better than its code (e.g. ask for xlsx). */
  readonly next: string | undefined;
  constructor(
    code: ReportErrorCode,
    message: string,
    issues: Issue[] = [],
    next?: string,
  ) {
    super(message);
    this.code = code;
    this.issues = issues;
    this.next = next;
  }
}

/** Where a report request's shape is documented (each kind's arguments are its tool's). */
export const REPORTS_DOCS =
  "https://github.com/9mp96ygnbk-alt/factlot/blob/main/docs/reports.md";
export const TOOLS_URL = "https://api.factlot.com/v1/tools";

/** "missing" for a required field that was not sent, else the message as given. */
export function issueMessage(message: string): string {
  return /received undefined$/i.test(message)
    ? "missing: this field is required"
    : message;
}

/** A path under a prefix: "arguments" itself, or "arguments.x.y". */
export function under(prefix: string, path: string): string {
  return path ? `${prefix}.${path}` : prefix;
}

// --- shapes -------------------------------------------------------------------------------------

const N = z.number().finite();
const Int = z.number().int();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Step = z.strictObject({
  label: z.string(),
  value: z.union([N, z.string()]),
  formula: z.string().optional(),
  unit: z.string().optional(),
});

const Provenance = z.strictObject({
  method: z.literal("computed"),
  formula: z.string(),
  producer: z.strictObject({ name: z.string(), version: z.string() }),
  sources: z.array(z.unknown()).max(0),
});

function calcResult<T extends z.ZodType>(id: string, value: T) {
  return z.strictObject({
    value,
    formula: z.strictObject({ id: z.literal(id), version: Int }),
    steps: z.array(Step),
    warnings: z.array(z.string()),
    provenance: Provenance.optional(),
  });
}

const Basis = z.enum(["appraised", "market"]);
const TxAdjustment = z.strictObject({
  label: z.string(),
  kind: z.enum(["percent", "amount", "psf"]),
  value: N,
  reason: z.string(),
});
export const TxCitation = z.strictObject({
  fact_id: z.string().min(1).max(200).optional(),
  document_id: z.string().min(1).max(200).optional(),
  locator: z.string().min(1).max(500).optional(),
  as_of: IsoDate.optional(),
});
// Added to calc.tx_unequal_appraisal@1 without a version change: optional here so a result from
// before the addition is still accepted.
const TxFlag = z.strictObject({
  code: z.enum([
    "value_psf_above_2x",
    "value_psf_below_half",
    "land_ratio_above_2x",
    "land_ratio_below_half",
    "missing_area",
  ]),
  message: z.string(),
});
/**
 * tx_unequal_appraisal results are always FactLot's own run (the kind requires arguments), so
 * these two shapes pass through fields a newer calculator adds: a report built from them reads
 * only the fields listed. `label` and `address` are the caller's optional names for a property.
 */
const TxComparable = z.looseObject({
  index: Int.min(0),
  id: z.string().nullable(),
  label: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  county_fips: z.string().nullable(),
  value: N.positive(),
  value_basis: Basis,
  normalized_value: N,
  percent_factor: N,
  after_percent_value: N,
  amount_adjustments_total: N,
  adjusted_value: N,
  adjusted_value_psf: N.nullable(),
  total_adjustment_pct: N,
  adjustments: z.array(TxAdjustment),
  citation: TxCitation.nullable(),
  flags: z.array(TxFlag).optional(),
});
const TxValue = z.looseObject({
  disclaimer: z.string(),
  tax_year: Int,
  normalize_by: z.enum(["none", "improvement_area_sf", "land_area_sf"]),
  adjustment_combine: z.enum(["sum", "compound"]),
  comparables_count: Int,
  comparables: z.array(TxComparable).min(3).max(200),
  sorted_adjusted_values: z.array(N),
  median_adjusted_value: N,
  median_pair: z.tuple([N, N]).nullable(),
  subject_id: z.string().nullable(),
  subject_label: z.string().nullable().optional(),
  subject_address: z.string().nullable().optional(),
  subject_value: N.positive(),
  subject_value_basis: Basis,
  subject_minus_median: N,
  subject_minus_median_pct: N,
  law: z.array(
    z.strictObject({
      section: z.string(),
      url: z.string(),
      covers: z.string(),
    }),
  ),
});

const CamValue = z.strictObject({
  recoverable_expenses: N,
  grossed_up_expenses: N,
  tenant_share_controllable: N,
  tenant_share_uncontrollable: N,
  cap_limit: N.nullable(),
  cap_reduction: N,
  admin_fee: N,
  occupancy_fraction: N,
  structure_deduction: N,
  tenant_charge: N,
  estimates_paid: N,
  balance_due: N,
});
const CamStatement = calcResult("calc.cam_reconciliation", CamValue);
const CamBatchValue = z.strictObject({
  year: Int,
  building: z.strictObject({
    total_expenses: N,
    non_recoverable_expenses: N,
    recoverable_expenses: N,
    grossed_up_expenses: N,
    tenant_count: Int,
    total_pro_rata_share: N,
    occupied_share: N,
    total_tenant_charges: N,
    total_estimates_paid: N,
    total_balance_due: N,
    recovery_ratio: N,
    unrecovered: N,
    unrecovered_reasons: z.array(
      z.strictObject({
        reason: z.string(),
        amount: N,
        explanation: z.string(),
      }),
    ),
  }),
  tenants: z
    .array(z.strictObject({ name: z.string(), statement: CamStatement }))
    .min(1),
});

const Constraint = z.enum(["ltv", "dscr", "debt_yield"]);
const DebtValue = z.strictObject({
  max_loan: N,
  binding_constraint: Constraint,
  loan_by_constraint: z.strictObject({
    ltv: N.optional(),
    dscr: N.optional(),
    debt_yield: N.optional(),
  }),
  annual_constant: N,
  annual_debt_service: N,
  resulting: z.strictObject({ ltv: N.nullable(), dscr: N, debt_yield: N }),
  refinance: z
    .strictObject({
      existing_loan_balance: N,
      shortfall: N,
      excess_proceeds: N,
    })
    .optional(),
  stress: z
    .array(
      z.strictObject({
        noi_shock: N,
        rate_shock: N,
        value_shock: N,
        noi: N,
        rate_annual: N,
        value: N.nullable(),
        max_loan: N,
        binding_constraint: Constraint,
        annual_debt_service: N,
        ltv: N.nullable(),
        dscr: N.nullable(),
        debt_yield: N.nullable(),
        refinance_shortfall: N.optional(),
      }),
    )
    .optional(),
});

const Asc842Value = z.strictObject({
  classification: z.enum(["operating", "finance"]),
  remaining_periods: Int,
  periodic_rate: N,
  total_remaining_payments: N,
  new_lease_liability: N,
  liability_adjustment: N,
  rou_asset_adjustment: N,
  gain_recognized: N,
  new_rou_asset: N,
  straight_line_lease_cost: N.nullable(),
  periodic_amortization: N.nullable(),
  total_interest: N,
  total_amortization: N,
  total_lease_cost: N,
  schedule: z.array(
    z.strictObject({
      period: Int,
      opening_liability: N,
      payment: N,
      interest: N,
      closing_liability: N,
      amortization: N,
      closing_rou_asset: N,
      lease_cost: N,
    }),
  ),
});

const ProposalsValue = z.strictObject({
  perspective: z.enum(["tenant", "landlord"]),
  metric: z.enum([
    "effective_occupancy_cost_psf",
    "discounted_net_effective_rent_psf",
  ]),
  area_basis: z.enum(["rentable", "usable"]),
  ranking: z
    .array(
      z.strictObject({
        rank: Int,
        name: z.string(),
        metric_psf_annual: N,
        total_net: N,
        term_months: Int,
        area_sf: N.positive(),
        usable_sf: N.nullable(),
        load_factor: N.nullable(),
        basis_area_sf: N.positive(),
        opex_structure: z
          .enum(["gross", "nnn", "base_year", "expense_stop"])
          .nullable(),
        downtime_months: Int,
      }),
    )
    .min(2),
  best: z.string(),
  unit: z.string().optional(),
  rate_unit: z.string().optional(),
});

const DcfYear = z.strictObject({
  year: Int,
  in_hold: z.boolean(),
  potential_base_rent: N,
  free_rent: N,
  expense_recoveries: N,
  gross_revenue: N,
  general_vacancy: N,
  credit_loss: N,
  effective_gross_revenue: N,
  operating_expenses: N,
  management_fee: N,
  net_operating_income: N,
  tenant_improvements: N,
  leasing_commissions: N,
  capital_reserves: N,
  cash_flow_before_debt: N,
});
const DcfValue = z.strictObject({
  hold_years: Int,
  building_area_sf: N.positive(),
  cash_flows: z.array(DcfYear).min(2),
  noi_year_1: N,
  exit: z.strictObject({
    noi_basis: z.enum(["forward", "trailing"]),
    noi: N,
    cap_rate: N,
    gross_sale_price: N,
    selling_costs: N,
    net_sale_proceeds: N,
  }),
  discount_rate: N,
  timing: z.enum(["end_of_year", "mid_year"]),
  pv_cash_flows: N,
  pv_reversion: N,
  value: N,
  value_per_sf: N,
  reversion_share_of_value: N.nullable(),
  going_in_cap_rate_on_value: N.nullable(),
  purchase_price: N.nullable(),
  npv: N.nullable(),
  going_in_cap_rate_on_price: N.nullable(),
  unlevered_irr: N.nullable(),
  equity_multiple: N.nullable(),
  lease_events: z.array(
    z.strictObject({
      lease: z.string(),
      kind: z.enum(["in_place", "new", "blended"]),
      start_month: N,
      end_month: N,
      renewal_probability: N.nullable(),
      downtime_months: N,
      free_rent_months: N,
      rent_psf_annual: N,
      tenant_improvements: N,
      leasing_commission: N,
    }),
  ),
});

const EventKind = z.enum([
  "commencement",
  "expiration",
  "renewal_window_opens",
  "renewal_notice_deadline",
  "renewal_term_ends",
  "termination_notice_deadline",
  "termination_effective",
  "expansion_option_deadline",
  "deadline",
]);
const CriticalEvent = z.strictObject({
  date: IsoDate,
  kind: EventKind,
  label: z.string(),
  option: Int.optional(),
  unadjusted_date: IsoDate.optional(),
  rolled_because: z.string().optional(),
  non_business_day: z.string().optional(),
  days_from_as_of: Int.optional(),
});
const DatesValue = z.strictObject({
  as_of: IsoDate.nullable(),
  business_day_roll: z.enum(["none", "preceding", "following"]),
  holidays: z.enum(["us_federal", "none"]),
  events: z.array(CriticalEvent).min(1),
  next_deadline: CriticalEvent.nullable(),
  renewal_terms: z.array(
    z.strictObject({
      option: Int,
      window_opens: IsoDate.optional(),
      notice_deadline: IsoDate,
      term_start: IsoDate,
      term_end: IsoDate,
    }),
  ),
  termination_options: z.array(
    z.strictObject({
      option: Int,
      effective_date: IsoDate,
      notice_deadline: IsoDate,
    }),
  ),
  conventions: z.array(z.string()),
});

const Obj = z.record(z.string(), z.unknown());
const LeaseSource = z.looseObject({
  document: Int,
  document_id: z.string().nullable().optional(),
  title: z.string().optional(),
  page: Int.optional(),
  section: z.string().optional(),
  quote: z.string().optional(),
  quote_on_page: z.boolean(),
  fact_id: z.string(),
});
const LeaseAbstract = z.strictObject({
  subject: z.string(),
  as_of: IsoDate,
  documents: z.array(
    z.looseObject({
      document: Int,
      verified: Int,
      needs_review: Int,
      rejected: Int,
    }),
  ),
  fields: z.array(
    z.looseObject({
      predicate: z.string(),
      value: z.unknown(),
      source: LeaseSource,
      history: z.array(Obj),
      conflicts: z.array(Obj).optional(),
      pending: z.array(Obj).optional(),
      open_items: z.array(Obj).optional(),
      notes: z.array(z.string()).optional(),
      carried_forward: z.array(Obj).optional(),
    }),
  ),
  facts: z.array(Obj),
  pending: z.array(Obj),
  pending_facts: z.array(Obj),
  needs_review: z.array(z.looseObject({ predicate: z.string() })),
  rejected: z.array(z.looseObject({ predicate: z.string() })),
  warnings: z.array(z.string()),
  summary: z.looseObject({
    documents: Int,
    fields: Int,
    facts: Int,
    pending: Int,
    needs_review: Int,
    rejected: Int,
    conflicts: Int,
  }),
});

export type TxResult = z.output<ReturnType<typeof calcResult<typeof TxValue>>>;
export type CamResult = z.output<typeof CamStatement>;
export type CamBatchResult = z.output<
  ReturnType<typeof calcResult<typeof CamBatchValue>>
>;
export type DebtResult = z.output<
  ReturnType<typeof calcResult<typeof DebtValue>>
>;
export type Asc842Result = z.output<
  ReturnType<typeof calcResult<typeof Asc842Value>>
>;
export type ProposalsResult = z.output<
  ReturnType<typeof calcResult<typeof ProposalsValue>>
>;
export type DcfResult = z.output<
  ReturnType<typeof calcResult<typeof DcfValue>>
>;
export type DatesResult = z.output<
  ReturnType<typeof calcResult<typeof DatesValue>>
>;
export type LeaseAbstractResult = z.output<typeof LeaseAbstract>;
export type CriticalEventT = z.output<typeof CriticalEvent>;

const SCHEMAS: Record<string, z.ZodType> = {
  calc_tx_unequal_appraisal: calcResult("calc.tx_unequal_appraisal", TxValue),
  calc_cam_reconciliation: CamStatement,
  calc_cam_reconciliation_batch: calcResult(
    "calc.cam_reconciliation_batch",
    CamBatchValue,
  ),
  calc_debt_sizing: calcResult("calc.debt_sizing", DebtValue),
  calc_lease_remeasurement_asc842: calcResult(
    "calc.lease_remeasurement_asc842",
    Asc842Value,
  ),
  calc_compare_proposals: calcResult("calc.compare_proposals", ProposalsValue),
  calc_dcf_pro_forma: calcResult("calc.dcf_pro_forma", DcfValue),
  calc_critical_dates: calcResult("calc.critical_dates", DatesValue),
  doc_abstract_lease: LeaseAbstract,
};

// --- the links every genuine result satisfies --------------------------------------------------

const eq = (a: number, b: number) => a === b || Math.abs(a - b) < 1e-9;

function txLinks(r: TxResult, bad: Issue[]): void {
  const v = r.value;
  if (v.disclaimer !== TX_EVIDENCE_NOTICE)
    bad.push({
      path: "value.disclaimer",
      message: "is not the evidence notice the tool returns",
    });
  if (JSON.stringify(v.law) !== JSON.stringify(TX_UNEQUAL_APPRAISAL_LAW))
    bad.push({
      path: "value.law",
      message: "is not the list of statutes the tool cites",
    });
  if (v.comparables_count !== v.comparables.length)
    bad.push({
      path: "value.comparables_count",
      message: "does not match the comparables listed",
    });
  v.comparables.forEach((c, i) => {
    const at = `value.comparables.${i}`;
    if (c.index !== i)
      bad.push({ path: `${at}.index`, message: `should be ${i}` });
    const pcts = c.adjustments.filter((a) => a.kind === "percent");
    let f: number;
    if (v.adjustment_combine === "sum") {
      let s = 0;
      for (const a of pcts) s += a.value;
      f = round(1 + s, 6);
    } else {
      let p = 1;
      for (const a of pcts) p *= 1 + a.value;
      f = round(p, 6);
    }
    if (!eq(f, c.percent_factor))
      bad.push({
        path: `${at}.percent_factor`,
        message: "does not follow from the percentage adjustments",
      });
    if (
      !eq(
        round(c.normalized_value * c.percent_factor, 2),
        c.after_percent_value,
      )
    )
      bad.push({
        path: `${at}.after_percent_value`,
        message: "is not normalized value × factor",
      });
    if (
      !eq(
        round(c.after_percent_value + c.amount_adjustments_total, 2),
        c.adjusted_value,
      )
    )
      bad.push({
        path: `${at}.adjusted_value`,
        message: "is not the value after percentages plus amounts",
      });
    if (v.normalize_by === "none" && !eq(round(c.value, 2), c.normalized_value))
      bad.push({
        path: `${at}.normalized_value`,
        message: "should equal the value when nothing is normalized",
      });
    if (
      !eq(
        round(c.adjusted_value / c.normalized_value - 1, 6),
        c.total_adjustment_pct,
      )
    )
      bad.push({
        path: `${at}.total_adjustment_pct`,
        message: "is not adjusted ÷ normalized − 1",
      });
  });
  const sorted = v.comparables
    .map((c) => c.adjusted_value)
    .sort((a, b) => a - b);
  if (JSON.stringify(sorted) !== JSON.stringify(v.sorted_adjusted_values))
    bad.push({
      path: "value.sorted_adjusted_values",
      message: "are not the adjusted values in ascending order",
    });
  const n = sorted.length;
  const median =
    n % 2
      ? sorted[(n - 1) / 2]!
      : round((sorted[n / 2 - 1]! + sorted[n / 2]!) / 2, 2);
  if (!eq(median, v.median_adjusted_value))
    bad.push({
      path: "value.median_adjusted_value",
      message: "is not the median of the adjusted values",
    });
  const pair = n % 2 ? null : [sorted[n / 2 - 1], sorted[n / 2]];
  if (JSON.stringify(pair) !== JSON.stringify(v.median_pair))
    bad.push({
      path: "value.median_pair",
      message: "is not the two middle values",
    });
  if (
    !eq(
      round(v.subject_value - v.median_adjusted_value, 2),
      v.subject_minus_median,
    )
  )
    bad.push({
      path: "value.subject_minus_median",
      message: "is not subject value − median",
    });
  if (
    !eq(
      round(v.subject_minus_median / v.median_adjusted_value, 6),
      v.subject_minus_median_pct,
    )
  )
    bad.push({
      path: "value.subject_minus_median_pct",
      message: "is not (subject − median) ÷ median",
    });
}

function camLinks(
  v: z.output<typeof CamValue>,
  at: string,
  bad: Issue[],
): void {
  if (!eq(round(v.tenant_charge - v.estimates_paid, 2), v.balance_due))
    bad.push({
      path: `${at}.balance_due`,
      message: "is not the tenant charge less estimates paid",
    });
}

function camBatchLinks(r: CamBatchResult, bad: Issue[]): void {
  const b = r.value.building;
  if (b.tenant_count !== r.value.tenants.length)
    bad.push({
      path: "value.building.tenant_count",
      message: "does not match the tenants listed",
    });
  r.value.tenants.forEach((t, i) =>
    camLinks(t.statement.value, `value.tenants.${i}.statement.value`, bad),
  );
  const sum = (f: (v: z.output<typeof CamValue>) => number) =>
    round(
      r.value.tenants.reduce((s, t) => s + f(t.statement.value), 0),
      2,
    );
  if (
    !eq(
      sum((v) => v.tenant_charge),
      b.total_tenant_charges,
    )
  )
    bad.push({
      path: "value.building.total_tenant_charges",
      message: "is not the sum of the tenant charges",
    });
  if (
    !eq(
      sum((v) => v.balance_due),
      b.total_balance_due,
    )
  )
    bad.push({
      path: "value.building.total_balance_due",
      message: "is not the sum of the balances due",
    });
}

function debtLinks(r: DebtResult, bad: Issue[]): void {
  const v = r.value;
  const loans = Object.entries(v.loan_by_constraint) as [string, number][];
  const binding = v.loan_by_constraint[v.binding_constraint];
  if (binding === undefined)
    bad.push({
      path: "value.binding_constraint",
      message: "is not one of the tests in loan_by_constraint",
    });
  else if (loans.some(([, x]) => x < binding))
    bad.push({
      path: "value.binding_constraint",
      message: "is not the test giving the smallest loan",
    });
  else if (v.max_loan > binding + 1e-6)
    bad.push({
      path: "value.max_loan",
      message: "exceeds the binding test's loan",
    });
}

function asc842Links(r: Asc842Result, bad: Issue[]): void {
  const v = r.value;
  if (v.schedule.length !== v.remaining_periods)
    bad.push({
      path: "value.schedule",
      message: "does not have remaining_periods rows",
    });
  v.schedule.forEach((p, i) => {
    if (p.period !== i + 1)
      bad.push({
        path: `value.schedule.${i}.period`,
        message: `should be ${i + 1}`,
      });
  });
  const total = round(
    v.schedule.reduce((s, p) => s + p.interest, 0),
    2,
  );
  if (!eq(total, v.total_interest))
    bad.push({
      path: "value.total_interest",
      message: "is not the sum of the schedule's interest",
    });
}

function proposalsLinks(r: ProposalsResult, bad: Issue[]): void {
  const v = r.value;
  v.ranking.forEach((p, i) => {
    if (p.rank !== i + 1)
      bad.push({
        path: `value.ranking.${i}.rank`,
        message: `should be ${i + 1}`,
      });
  });
  if (v.best !== v.ranking[0]?.name)
    bad.push({
      path: "value.best",
      message: "is not the first-ranked proposal",
    });
}

function dcfLinks(r: DcfResult, bad: Issue[]): void {
  const v = r.value;
  v.cash_flows.forEach((y, i) => {
    if (y.year !== i + 1)
      bad.push({
        path: `value.cash_flows.${i}.year`,
        message: `should be ${i + 1}`,
      });
  });
  if (v.cash_flows.filter((y) => y.in_hold).length !== v.hold_years)
    bad.push({
      path: "value.cash_flows",
      message: "do not cover hold_years years in the hold",
    });
  if (!eq(round(v.pv_cash_flows + v.pv_reversion, 2), v.value))
    bad.push({
      path: "value.value",
      message: "is not the PV of cash flows plus the PV of the reversion",
    });
  if (!eq(v.cash_flows[0]!.net_operating_income, v.noi_year_1))
    bad.push({
      path: "value.noi_year_1",
      message: "is not year 1's net operating income",
    });
}

function datesLinks(r: DatesResult, bad: Issue[]): void {
  const ev = r.value.events;
  for (let i = 1; i < ev.length; i++)
    if (ev[i]!.date < ev[i - 1]!.date) {
      bad.push({
        path: `value.events.${i}`,
        message: "events are not in date order",
      });
      break;
    }
}

function leaseLinks(r: LeaseAbstractResult, bad: Issue[]): void {
  const s = r.summary;
  const pairs: [string, number, number][] = [
    ["fields", s.fields, r.fields.length],
    ["facts", s.facts, r.facts.length],
    ["needs_review", s.needs_review, r.needs_review.length],
    ["rejected", s.rejected, r.rejected.length],
  ];
  for (const [k, a, b] of pairs)
    if (a !== b)
      bad.push({
        path: `summary.${k}`,
        message: `says ${a} but ${b} are listed`,
      });
}

const LINKS: Record<string, (r: never, bad: Issue[]) => void> = {
  calc_tx_unequal_appraisal: txLinks,
  calc_cam_reconciliation: (r: CamResult, bad) =>
    camLinks(r.value, "value", bad),
  calc_cam_reconciliation_batch: camBatchLinks,
  calc_debt_sizing: debtLinks,
  calc_lease_remeasurement_asc842: asc842Links,
  calc_compare_proposals: proposalsLinks,
  calc_dcf_pro_forma: dcfLinks,
  calc_critical_dates: datesLinks,
  doc_abstract_lease: leaseLinks,
};

// --- entry --------------------------------------------------------------------------------------

/** Order-insensitive deep equality of JSON values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (typeof a === "object") {
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a as object).filter(
      (k) => (a as Record<string, unknown>)[k] !== undefined,
    );
    const kb = Object.keys(b as object).filter(
      (k) => (b as Record<string, unknown>)[k] !== undefined,
    );
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      jsonEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }
  return false;
}

function withoutProvenance(r: unknown): unknown {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return r;
  const { provenance: _drop, ...rest } = r as Record<string, unknown>;
  void _drop;
  return rest;
}

/** Which of the kind's tools a result (or arguments) belongs to. */
function toolFor(kind: ReportKind, input: unknown, args: unknown): string {
  const tools = KIND_TOOLS[kind];
  if (tools.length === 1) return tools[0]!;
  // cam_reconciliation: one tenant or a whole pool, as the arguments say.
  void input;
  return typeof args === "object" && args !== null && "tenants" in args
    ? "calc_cam_reconciliation_batch"
    : "calc_cam_reconciliation";
}

export interface Checked {
  tool: string;
  result: unknown;
  /**
   * "computed": FactLot ran the tool on the arguments sent and the document is built from that
   * run. "supplied": a lease abstract result the caller sent, checked (shape, formula version,
   * counts) but not recomputed.
   */
  check: "computed" | "supplied";
  /** The tool's arguments when given (validated by the tool). */
  args?: unknown;
  /** A result was sent with the arguments: true when it differs from FactLot's run (unused). */
  result_mismatch?: boolean;
}

function zodIssues(err: z.ZodError, prefix: string): Issue[] {
  return err.issues.slice(0, 20).map((i) => ({
    path: [prefix, ...i.path.map(String)].filter(Boolean).join("."),
    message: issueMessage(i.message),
  }));
}

/**
 * The result a report is built from. Calculator kinds: FactLot's run of the tool on `args`
 * (required); a supplied `input` is compared, never used. lease_abstract: the run on `args` when
 * given, else the supplied `input`, checked. Throws ReportInputError with issues an agent can
 * act on.
 */
export function checkInput(
  kind: ReportKind,
  input: unknown,
  args: unknown,
): Checked {
  const tool = toolFor(kind, input, args);
  const spec = getTool(tool);
  if (!spec) throw new ReportInputError("InputError", `unknown tool ${tool}`);
  if (args === undefined) {
    if (kind !== "lease_abstract")
      throw new ReportInputError(
        "ArgumentsRequired",
        `${kind} reports are built only from FactLot's own run of ${KIND_TOOLS[kind].join(" or ")}: send the tool's arguments as arguments (a result alone is not accepted, so the document never carries a number FactLot did not compute)`,
        [{ path: "arguments", message: `required for ${kind}` }],
      );
    if (input === undefined)
      throw new ReportInputError(
        "InputError",
        "give arguments (doc_abstract_lease's arguments) or input (its result)",
        [{ path: "arguments", message: "required unless input is given" }],
      );
    return { tool, result: checkSupplied(tool, input), check: "supplied" };
  }
  const out = runTool(tool, args);
  if (!out.ok)
    throw new ReportInputError(
      "ArgumentsError",
      `${tool} refused the arguments: ${out.error.message}`,
      out.error.issues.map((i) => ({
        path: under("arguments", i.path),
        message: issueMessage(i.message),
      })),
      `fix the fields listed in issues and retry; ${tool}'s arguments schema is the inputSchema of its entry in GET ${TOOLS_URL} (the arguments are the ones you would call the tool with)`,
    );
  // FactLot's own result: a failed check here is a fault in FactLot, not in the request.
  const parsed = SCHEMAS[tool]!.safeParse(out.result);
  if (!parsed.success)
    throw new Error(`${tool}: its result does not have the shape reports read`);
  const bad: Issue[] = [];
  LINKS[tool]!(parsed.data as never, bad);
  if (bad.length)
    throw new Error(`${tool}: its result fails a consistency check`);
  return {
    tool,
    result: parsed.data,
    check: "computed",
    args,
    ...(input !== undefined
      ? {
          result_mismatch: !jsonEqual(
            withoutProvenance(out.result),
            withoutProvenance(input),
          ),
        }
      : {}),
  };
}

/** A result the caller sent (lease_abstract only): its exact shape, formula version and counts. */
function checkSupplied(tool: string, result: unknown): unknown {
  const spec = getTool(tool)!;
  const formula = (
    result as { formula?: { id?: unknown; version?: unknown } } | null
  )?.formula;
  if (
    spec.formula &&
    typeof formula?.id === "string" &&
    formula.id !== spec.formula.id
  )
    throw new ReportInputError(
      "NotAToolResult",
      `input is a result of ${formula.id}, not of ${tool} (${spec.formula.id})`,
      [{ path: "input.formula.id", message: `expected ${spec.formula.id}` }],
    );
  const version = formula?.version;
  if (
    spec.formula &&
    typeof version === "number" &&
    version !== spec.formula.version
  )
    throw new ReportInputError(
      "FormulaVersion",
      `this result is from ${spec.formula.id}@${version}; this FactLot computes ${spec.formula.id}@${spec.formula.version}. Call ${tool} again and send its new result.`,
      [
        {
          path: "input.formula.version",
          message: `expected ${spec.formula.version}`,
        },
      ],
    );
  const parsed = SCHEMAS[tool]!.safeParse(result);
  if (!parsed.success)
    throw new ReportInputError(
      "NotAToolResult",
      `input is not a ${tool} result as FactLot returns it (send the tool's result unchanged: value, formula, steps, warnings)`,
      zodIssues(parsed.error, "input"),
    );
  const bad: Issue[] = [];
  LINKS[tool]!(parsed.data as never, bad);
  if (bad.length)
    throw new ReportInputError(
      "NotAToolResult",
      `input is not an unmodified ${tool} result: its figures do not agree with each other (send the tool's result unchanged)`,
      bad.slice(0, 20).map((b) => ({ ...b, path: `input.${b.path}` })),
    );
  return parsed.data;
}
