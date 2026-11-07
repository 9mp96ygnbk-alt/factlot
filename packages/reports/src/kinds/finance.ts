/** cam_reconciliation, debt_sizing, asc842_schedule, compare_proposals and dcf_summary. */
import { runTool } from "@factlot/tools";

import type { Block, Check, Kv, Raw, ReportDoc, TableColumn } from "../doc.ts";
import { num, pct, roundInText, usd } from "../format.ts";
import type {
  Asc842Result,
  CamBatchResult,
  CamResult,
  DcfResult,
  DebtResult,
  ProposalsResult,
} from "../validate.ts";
import {
  closingBlocks,
  subtitle,
  warningsBlocks,
  type KindInput,
} from "./common.ts";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj =>
  typeof x === "object" && x !== null && !Array.isArray(x);

// --- CAM ----------------------------------------------------------------------------------------

type CamValue = CamResult["value"];

function camStatementRows(v: CamValue): Kv[] {
  return [
    {
      label: "Recoverable expenses (pool)",
      value: v.recoverable_expenses,
      fmt: "usd",
    },
    {
      label: "Recoverable expenses after gross-up",
      value: v.grossed_up_expenses,
      fmt: "usd",
    },
    {
      label: "Tenant share of controllable expenses",
      value: v.tenant_share_controllable,
      fmt: "usd",
    },
    {
      label: "Cap limit",
      value: v.cap_limit ?? "no cap",
      fmt: v.cap_limit === null ? "text" : "usd",
    },
    { label: "Cap reduction (deducted)", value: v.cap_reduction, fmt: "usd" },
    {
      label: "Tenant share of uncontrollable expenses",
      value: v.tenant_share_uncontrollable,
      fmt: "usd",
    },
    { label: "Admin fee", value: v.admin_fee, fmt: "usd" },
    { label: "Occupancy fraction", value: v.occupancy_fraction, fmt: "pct" },
    {
      label: "Base-year or expense-stop deduction",
      value: v.structure_deduction,
      fmt: "usd",
    },
    {
      label: "Tenant CAM charge",
      value: v.tenant_charge,
      fmt: "usd",
      name: "charge",
    },
    {
      label: "Estimates paid",
      value: v.estimates_paid,
      fmt: "usd",
      name: "estimates",
    },
    {
      label: "Balance due (true-up; negative is a credit to the tenant)",
      value: v.balance_due,
      fmt: "usd",
      name: "balance",
    },
  ];
}

/** The share, gross-up, cap and admin-fee terms as sent in the arguments (D10). */
function camTerms(
  args: unknown,
  v: CamValue,
  steps: CamResult["steps"],
): Block[] {
  if (!isObj(args)) return [];
  const rows: Kv[] = [];
  if (typeof args.pro_rata_share === "number")
    rows.push({
      label: "Pro rata share",
      value: args.pro_rata_share,
      fmt: "pct4",
    });
  const g = isObj(args.gross_up) ? args.gross_up : undefined;
  if (g) {
    const actual =
      typeof g.actual_occupancy === "number" ? g.actual_occupancy : undefined;
    const target =
      typeof g.target_occupancy === "number" ? g.target_occupancy : undefined;
    if (actual !== undefined)
      rows.push({
        label: "Gross-up: actual occupancy",
        value: actual,
        fmt: "pct",
      });
    if (target !== undefined)
      rows.push({
        label: "Gross-up: target occupancy",
        value: target,
        fmt: "pct",
      });
    const factor = steps.find((x) => /^Gross-up factor/i.test(x.label));
    if (factor && typeof factor.value === "number")
      rows.push({
        label: "Gross-up factor on variable expenses (from the tool)",
        value: factor.value,
        fmt: "factor",
      });
  } else rows.push({ label: "Gross-up", value: "none sent", fmt: "text" });
  rows.push({
    label: "Tenant occupancy fraction (from the tool)",
    value: v.occupancy_fraction,
    fmt: "pct",
  });
  const cap = isObj(args.cap) ? args.cap : undefined;
  if (cap) {
    rows.push({
      label: "Cap method",
      value: String(cap.method ?? "").replace(/_/g, " "),
      fmt: "text",
    });
    if (typeof cap.rate === "number")
      rows.push({ label: "Cap rate", value: cap.rate, fmt: "pct" });
    if (typeof cap.reference_amount === "number")
      rows.push({
        label: "Cap reference amount",
        value: cap.reference_amount,
        fmt: "usd",
      });
  } else rows.push({ label: "Cap", value: "none sent", fmt: "text" });
  const fee = isObj(args.admin_fee) ? args.admin_fee : undefined;
  if (fee) {
    if (typeof fee.rate === "number")
      rows.push({ label: "Admin fee rate", value: fee.rate, fmt: "pct" });
    if (typeof fee.applied === "string")
      rows.push({
        label: "Admin fee applied",
        value: fee.applied.replace(/_/g, " "),
        fmt: "text",
      });
  } else rows.push({ label: "Admin fee", value: "none sent", fmt: "text" });
  return [
    {
      t: "heading",
      text: "Share, gross-up, cap and admin fee (as sent in the arguments)",
    },
    { t: "kv", rows },
  ];
}

function expenseLines(args: unknown): Block[] {
  const lines =
    isObj(args) && Array.isArray(args.expenses) ? (args.expenses as Obj[]) : [];
  if (!lines.length) return [];
  const flag = (x: unknown, dflt: boolean) => ((x ?? dflt) ? "yes" : "no");
  return [
    { t: "heading", text: "Expense lines (as sent in the arguments)" },
    {
      t: "table",
      size: 7.5,
      columns: [
        { header: "Category", fmt: "text", width: 2.2 },
        { header: "Amount", fmt: "usd", width: 1.3 },
        { header: "Recoverable", fmt: "text", width: 0.9 },
        { header: "Controllable", fmt: "text", width: 0.9 },
        { header: "Variable (grossed up)", fmt: "text", width: 1 },
        { header: "Admin fee applies", fmt: "text", width: 0.9 },
      ],
      rows: lines.map((e) => [
        String(e.category ?? ""),
        typeof e.amount === "number" ? e.amount : null,
        flag(e.recoverable, true),
        flag(e.controllable, true),
        flag(e.variable, false),
        flag(e.admin_fee_applies, true),
      ]),
    },
  ];
}

export function camDoc(k: KindInput): ReportDoc {
  if (k.checked.tool === "calc_cam_reconciliation_batch") return camBatchDoc(k);
  const r = k.checked.result as CamResult;
  const v = r.value;
  const year =
    isObj(k.checked.args) && typeof k.checked.args.year === "number"
      ? k.checked.args.year
      : undefined;
  const blocks: Block[] = [
    { t: "heading", text: "Tenant statement" },
    { t: "kv", rows: camStatementRows(v) },
    ...camTerms(k.checked.args, v, r.steps),
    ...expenseLines(k.checked.args),
    ...warningsBlocks(r.warnings),
    ...closingBlocks(k, "calc_cam_reconciliation", r.steps),
  ];
  return {
    title:
      k.ctx.title ?? `CAM reconciliation statement${year ? `, ${year}` : ""}`,
    subtitle: subtitle(
      [
        `Balance due ${usd(v.balance_due)}`,
        `tenant charge ${usd(v.tenant_charge)}`,
      ],
      k.ctx,
    ),
    blocks,
    checks: [
      {
        label: "Balance due = charge − estimates paid",
        formula: "ROUND({charge}-{estimates},2)",
        factlot: v.balance_due,
        dp: 2,
        field: "value.balance_due",
      },
    ],
    readme: [
      "A CAM (common area maintenance) reconciliation statement for one tenant from calc_cam_reconciliation: the pool's recoverable expenses, gross-up, the tenant's shares, cap, admin fee, base-year or stop deduction, the charge, estimates paid and the balance due.",
    ],
  };
}

function camBatchDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as CamBatchResult;
  const v = r.value;
  const b = v.building;
  const blocks: Block[] = [
    { t: "heading", text: "Building" },
    {
      t: "kv",
      rows: [
        { label: "Year", value: String(v.year), fmt: "text" },
        { label: "Total expenses", value: b.total_expenses, fmt: "usd" },
        {
          label: "Non-recoverable expenses",
          value: b.non_recoverable_expenses,
          fmt: "usd",
        },
        {
          label: "Recoverable expenses",
          value: b.recoverable_expenses,
          fmt: "usd",
        },
        {
          label: "Recoverable expenses after gross-up",
          value: b.grossed_up_expenses,
          fmt: "usd",
        },
        { label: "Tenants", value: b.tenant_count, fmt: "int" },
        {
          label: "Total pro rata share",
          value: b.total_pro_rata_share,
          fmt: "pct",
        },
        {
          label: "Occupied share (share × occupancy)",
          value: b.occupied_share,
          fmt: "pct",
        },
        {
          label: "Total tenant charges",
          value: b.total_tenant_charges,
          fmt: "usd",
          name: "total_charges",
        },
        {
          label: "Total estimates paid",
          value: b.total_estimates_paid,
          fmt: "usd",
        },
        {
          label: "Total balance due",
          value: b.total_balance_due,
          fmt: "usd",
          name: "total_balance",
        },
        { label: "Recovery ratio", value: b.recovery_ratio, fmt: "pct" },
        { label: "Unrecovered", value: b.unrecovered, fmt: "usd" },
      ],
    },
    { t: "heading", text: "Why expenses were not recovered" },
    {
      t: "table",
      size: 7.5,
      columns: [
        { header: "Reason", fmt: "text", width: 1.4 },
        { header: "Amount", fmt: "usd", width: 1.1 },
        { header: "Explanation", fmt: "text", width: 4 },
      ],
      rows: b.unrecovered_reasons.map((x) => [
        x.reason.replace(/_/g, " "),
        x.amount,
        x.explanation,
      ]),
    },
    { t: "heading", text: "Tenants" },
    {
      t: "table",
      sheet: "Tenants",
      size: 7,
      columns: [
        { header: "Tenant", fmt: "text", width: 1.6 },
        { header: "Shares (ctrl + unctrl)", fmt: "usd", width: 1.2 },
        { header: "Cap reduction", fmt: "usd", width: 1 },
        { header: "Admin fee", fmt: "usd", width: 1 },
        { header: "Occupancy", fmt: "pct", width: 0.8 },
        { header: "Base-year / stop deduction", fmt: "usd", width: 1.1 },
        { header: "Charge", fmt: "usd", width: 1.1, name: "charges" },
        { header: "Estimates paid", fmt: "usd", width: 1.1 },
        { header: "Balance due", fmt: "usd", width: 1.1, name: "balances" },
      ],
      rows: v.tenants.map((t) => {
        const s = t.statement.value;
        return [
          t.name,
          `${usd(s.tenant_share_controllable)} + ${usd(s.tenant_share_uncontrollable)}`,
          s.cap_reduction,
          s.admin_fee,
          s.occupancy_fraction,
          s.structure_deduction,
          s.tenant_charge,
          s.estimates_paid,
          s.balance_due,
        ];
      }),
    },
  ];
  for (const t of v.tenants) {
    blocks.push({
      t: "heading",
      text: `Tenant statement: ${t.name}`,
      only: "pdf",
    });
    blocks.push({
      t: "kv",
      rows: camStatementRows(t.statement.value).map(
        ({ name: _n, ...x }) => (void _n, x),
      ),
      only: "pdf",
    });
    if (t.statement.warnings.length)
      blocks.push({ t: "bullets", items: t.statement.warnings, only: "pdf" });
    blocks.push({
      t: "table",
      only: "pdf",
      size: 7,
      columns: [
        { header: "Step", fmt: "text", width: 2.2 },
        { header: "Value", fmt: "step", width: 1.2 },
        { header: "How it was reached", fmt: "text", width: 3.6 },
      ],
      rows: t.statement.steps.map((s) => [
        s.label,
        s.value,
        roundInText(s.formula ?? ""),
      ]),
      fmts: t.statement.steps.map((s) => [
        undefined,
        s.unit === "USD" ? "usd" : undefined,
      ]),
    });
  }
  blocks.push(...expenseLines(k.checked.args));
  blocks.push(...warningsBlocks(r.warnings));
  blocks.push(...closingBlocks(k, "calc_cam_reconciliation_batch", r.steps));
  return {
    title:
      k.ctx.title ??
      `CAM reconciliation, ${v.year}: ${b.tenant_count} tenant statements`,
    subtitle: subtitle(
      [
        `Total charges ${usd(b.total_tenant_charges)}`,
        `recovery ratio ${pct(b.recovery_ratio)}`,
      ],
      k.ctx,
    ),
    blocks,
    checks: [
      {
        label: "Total tenant charges = Σ charges",
        formula: "ROUND(SUM({charges}),2)",
        factlot: b.total_tenant_charges,
        dp: 2,
        field: "value.building.total_tenant_charges",
      },
      {
        label: "Total balance due = Σ balances",
        formula: "ROUND(SUM({balances}),2)",
        factlot: b.total_balance_due,
        dp: 2,
        field: "value.building.total_balance_due",
      },
    ],
    readme: [
      "CAM reconciliation for one expense pool from calc_cam_reconciliation_batch: the building's totals, why expenses were not recovered, and each tenant's statement (charge, estimates paid, balance due).",
    ],
  };
}

// --- debt sizing --------------------------------------------------------------------------------

const TEST_LABEL: Record<string, string> = {
  ltv: "Loan-to-value",
  dscr: "Debt service coverage",
  debt_yield: "Debt yield",
};

function amortizationBlocks(k: KindInput, maxLoan: number): Block[] {
  const a = k.checked.args;
  if (
    !isObj(a) ||
    typeof a.rate_annual !== "number" ||
    typeof a.amortization_years !== "number" ||
    a.amortization_years <= 0 ||
    maxLoan <= 0
  )
    return [];
  const months = a.amortization_years * 12;
  const out = runTool("calc_amortization_schedule", {
    principal: maxLoan,
    rate_annual: a.rate_annual,
    term_months: months,
    amortization_months: months,
  });
  if (!out.ok) return [];
  const res = out.result as {
    value: {
      amortizing_payment: number | null;
      total_interest: number;
      total_payments: number;
      periods: number;
      schedule: { period: number; closing_balance: number }[];
    };
    formula: { id: string; version: number };
  };
  const v = res.value;
  const at = (year: number) =>
    v.schedule.find((p) => p.period === year * 12)?.closing_balance;
  const rows: Kv[] = [
    { label: "Loan (the max loan above)", value: maxLoan, fmt: "usd" },
    { label: "Monthly payment", value: v.amortizing_payment, fmt: "usd" },
    { label: "Payments", value: v.periods, fmt: "plain" },
    {
      label: "Total interest over the amortization",
      value: v.total_interest,
      fmt: "usd",
    },
    { label: "Total payments", value: v.total_payments, fmt: "usd" },
  ];
  for (const y of [1, 5, 7, 10].filter((y) => y * 12 < v.periods)) {
    const bal = at(y);
    if (bal !== undefined)
      rows.push({ label: `Balance after year ${y}`, value: bal, fmt: "usd" });
  }
  return [
    { t: "heading", text: "Amortization summary" },
    {
      t: "para",
      text: `From calc_amortization_schedule (${res.formula.id}@${res.formula.version}) on the max loan at the arguments' rate and amortization (${a.amortization_years} years, monthly, 30/360): a second FactLot tool run by this report, not part of the sizing result.`,
      grey: true,
    },
    { t: "kv", rows },
  ];
}

export function debtDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as DebtResult;
  const v = r.value;
  const tests = (["ltv", "dscr", "debt_yield"] as const).filter(
    (t) => v.loan_by_constraint[t] !== undefined,
  );
  const blocks: Block[] = [
    { t: "heading", text: "Result" },
    {
      t: "kv",
      rows: [
        {
          label: "Maximum loan",
          value: v.max_loan,
          fmt: "usd",
          name: "max_loan",
        },
        {
          label: "Binding constraint",
          value: TEST_LABEL[v.binding_constraint] ?? v.binding_constraint,
          fmt: "text",
        },
        {
          label: "Annual loan constant",
          value: v.annual_constant,
          fmt: "pct4",
        },
        {
          label: "Annual debt service",
          value: v.annual_debt_service,
          fmt: "usd",
        },
        {
          label: "Resulting loan-to-value",
          value: v.resulting.ltv ?? "no value given",
          fmt: v.resulting.ltv === null ? "text" : "pct",
        },
        {
          label: "Resulting debt service coverage",
          value: v.resulting.dscr,
          fmt: "times",
        },
        {
          label: "Resulting debt yield",
          value: v.resulting.debt_yield,
          fmt: "pct",
        },
      ],
    },
    { t: "heading", text: "Sizing tests" },
    {
      t: "table",
      size: 8.5,
      columns: [
        { header: "Test", fmt: "text", width: 2 },
        {
          header: "Loan this test allows",
          fmt: "usd",
          width: 1.6,
          name: "test_loans",
        },
        { header: "", fmt: "text", width: 1.2 },
      ],
      rows: tests.map((t) => [
        TEST_LABEL[t]!,
        v.loan_by_constraint[t]!,
        t === v.binding_constraint ? "binding" : "",
      ]),
      bold: [tests.indexOf(v.binding_constraint)],
    },
    {
      t: "kv",
      only: "xlsx",
      rows: [
        {
          label: "Binding test's loan",
          value: v.loan_by_constraint[v.binding_constraint] ?? null,
          fmt: "usd",
          name: "binding_loan",
        },
      ],
    },
  ];
  if (v.refinance)
    blocks.push(
      { t: "heading", text: "Refinance" },
      {
        t: "kv",
        rows: [
          {
            label: "Existing loan balance",
            value: v.refinance.existing_loan_balance,
            fmt: "usd",
          },
          {
            label: "Shortfall (equity or paydown needed)",
            value: v.refinance.shortfall,
            fmt: "usd",
          },
          {
            label: "Excess proceeds",
            value: v.refinance.excess_proceeds,
            fmt: "usd",
          },
        ],
      },
    );
  if (v.stress?.length)
    blocks.push(
      { t: "heading", text: "Stress scenarios" },
      {
        t: "table",
        size: 6.8,
        columns: [
          { header: "NOI shock", fmt: "pct", width: 0.8 },
          { header: "Rate shock", fmt: "pct", width: 0.8 },
          { header: "Value shock", fmt: "pct", width: 0.8 },
          { header: "NOI", fmt: "usd", width: 1.1 },
          { header: "Rate", fmt: "pct", width: 0.7 },
          { header: "Value", fmt: "usd", width: 1.2 },
          { header: "Max loan", fmt: "usd", width: 1.2 },
          { header: "Binding", fmt: "text", width: 0.8 },
          { header: "Debt service", fmt: "usd", width: 1.1 },
          { header: "LTV", fmt: "pct", width: 0.65 },
          { header: "DSCR", fmt: "times", width: 0.65 },
          { header: "Debt yield", fmt: "pct", width: 0.7 },
          ...(v.stress.some((s) => s.refinance_shortfall !== undefined)
            ? [{ header: "Refi shortfall", fmt: "usd" as const, width: 1.1 }]
            : []),
        ],
        rows: v.stress.map((s) => [
          s.noi_shock,
          s.rate_shock,
          s.value_shock,
          s.noi,
          s.rate_annual,
          s.value,
          s.max_loan,
          s.binding_constraint,
          s.annual_debt_service,
          s.ltv,
          s.dscr,
          s.debt_yield,
          ...(v.stress!.some((x) => x.refinance_shortfall !== undefined)
            ? [s.refinance_shortfall ?? null]
            : []),
        ]),
      },
    );
  blocks.push(...amortizationBlocks(k, v.max_loan));
  blocks.push(...warningsBlocks(r.warnings));
  blocks.push(...closingBlocks(k, "calc_debt_sizing", r.steps));
  return {
    title: k.ctx.title ?? "Debt sizing",
    subtitle: subtitle(
      [
        `Maximum loan ${usd(v.max_loan)}`,
        `binding: ${TEST_LABEL[v.binding_constraint]?.toLowerCase()}`,
      ],
      k.ctx,
    ),
    blocks,
    checks: [
      {
        label: "Binding test = the smallest loan of the tests",
        formula: "MIN({test_loans})",
        factlot: v.loan_by_constraint[v.binding_constraint]!,
        dp: 2,
        field: `value.loan_by_constraint.${v.binding_constraint}`,
      },
    ],
    readme: [
      "Loan sizing from calc_debt_sizing: the loan each test allows (loan-to-value, debt service coverage, debt yield), the binding one, the resulting metrics, and any refinance gap and stress scenarios.",
    ],
  };
}

// --- ASC 842 ------------------------------------------------------------------------------------

export function asc842Doc(k: KindInput): ReportDoc {
  const r = k.checked.result as Asc842Result;
  const v = r.value;
  const opt = (label: string, x: number | null): Kv[] =>
    x === null ? [] : [{ label, value: x, fmt: "usd" }];
  const blocks: Block[] = [
    { t: "heading", text: "Remeasurement" },
    {
      t: "kv",
      rows: [
        { label: "Classification", value: v.classification, fmt: "text" },
        {
          label: "Remaining periods",
          value: v.remaining_periods,
          fmt: "plain",
        },
        {
          label: "Periodic discount rate",
          value: v.periodic_rate,
          fmt: "pct4",
        },
        {
          label: "Total remaining payments",
          value: v.total_remaining_payments,
          fmt: "usd",
          name: "total_payments",
        },
        {
          label: "New lease liability",
          value: v.new_lease_liability,
          fmt: "usd",
        },
        {
          label: "Liability adjustment",
          value: v.liability_adjustment,
          fmt: "usd",
        },
        {
          label: "ROU asset adjustment",
          value: v.rou_asset_adjustment,
          fmt: "usd",
        },
        { label: "Gain recognized", value: v.gain_recognized, fmt: "usd" },
        { label: "New right-of-use asset", value: v.new_rou_asset, fmt: "usd" },
        ...opt(
          "Straight-line lease cost per period",
          v.straight_line_lease_cost,
        ),
        ...opt("ROU amortization per period", v.periodic_amortization),
        {
          label: "Total interest",
          value: v.total_interest,
          fmt: "usd",
          name: "total_interest",
        },
        {
          label: "Total ROU amortization",
          value: v.total_amortization,
          fmt: "usd",
          name: "total_amortization",
        },
        {
          label: "Total lease cost",
          value: v.total_lease_cost,
          fmt: "usd",
          name: "total_cost",
        },
      ],
    },
    { t: "heading", text: "Liability and right-of-use asset schedule" },
    {
      t: "table",
      sheet: "Schedule",
      size: 7,
      columns: [
        { header: "Period", fmt: "plain", width: 0.6 },
        { header: "Opening liability", fmt: "usd", width: 1.3 },
        { header: "Payment", fmt: "usd", width: 1.05, name: "payments" },
        { header: "Interest", fmt: "usd", width: 1.05, name: "interest" },
        { header: "Closing liability", fmt: "usd", width: 1.3 },
        {
          header: "ROU amortization",
          fmt: "usd",
          width: 1.1,
          name: "amortization",
        },
        { header: "Closing ROU asset", fmt: "usd", width: 1.3 },
        { header: "Lease cost", fmt: "usd", width: 1.05, name: "cost" },
      ],
      rows: v.schedule.map((p) => [
        p.period,
        p.opening_liability,
        p.payment,
        p.interest,
        p.closing_liability,
        p.amortization,
        p.closing_rou_asset,
        p.lease_cost,
      ]),
    },
    ...warningsBlocks(r.warnings),
    ...closingBlocks(k, "calc_lease_remeasurement_asc842", r.steps),
  ];
  return {
    title: k.ctx.title ?? `ASC 842 remeasurement: ${v.classification} lease`,
    subtitle: subtitle(
      [
        `New lease liability ${usd(v.new_lease_liability)}`,
        `${v.remaining_periods} periods`,
      ],
      k.ctx,
    ),
    blocks,
    checks: [
      {
        label: "Total interest = Σ schedule interest",
        formula: "ROUND(SUM({interest}),2)",
        factlot: v.total_interest,
        dp: 2,
        field: "value.total_interest",
      },
      {
        label: "Total ROU amortization = Σ schedule amortization",
        formula: "ROUND(SUM({amortization}),2)",
        factlot: v.total_amortization,
        dp: 2,
        field: "value.total_amortization",
      },
      {
        label: "Total lease cost = Σ schedule lease cost",
        formula: "ROUND(SUM({cost}),2)",
        factlot: v.total_lease_cost,
        dp: 2,
        field: "value.total_lease_cost",
      },
      {
        label: "Total remaining payments = Σ schedule payments",
        formula: "ROUND(SUM({payments}),2)",
        factlot: v.total_remaining_payments,
        dp: 2,
        field: "value.total_remaining_payments",
      },
    ],
    readme: [
      "An ASC 842 lease remeasurement from calc_lease_remeasurement_asc842: the new liability and right-of-use asset, the adjustments, and the liability and ROU schedules by period.",
    ],
  };
}

// --- proposals ----------------------------------------------------------------------------------

export function proposalsDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as ProposalsResult;
  const v = r.value;
  const metric =
    v.metric === "discounted_net_effective_rent_psf"
      ? "Discounted net effective rent"
      : "Effective occupancy cost";
  const unit = v.rate_unit ?? "USD/SF/yr";
  const blocks: Block[] = [
    { t: "heading", text: "Ranking" },
    {
      t: "kv",
      rows: [
        { label: "Perspective", value: v.perspective, fmt: "text" },
        {
          label: "Metric",
          value: `${metric} (${unit}); ${v.perspective === "tenant" ? "lower" : "higher"} ranks first`,
          fmt: "text",
        },
        { label: "Area basis", value: v.area_basis, fmt: "text" },
        { label: "First-ranked proposal", value: v.best, fmt: "text" },
      ],
    },
    {
      t: "table",
      size: 7.2,
      columns: [
        { header: "Rank", fmt: "int", width: 0.5 },
        { header: "Proposal", fmt: "text", width: 1.7 },
        { header: `${metric} (${unit})`, fmt: "num", width: 1.3 },
        { header: "Total net", fmt: "usd", width: 1.3 },
        { header: "Term (months)", fmt: "plain", width: 0.75 },
        { header: "Rentable area", fmt: "int", width: 0.9 },
        { header: "Usable area", fmt: "int", width: 0.8 },
        { header: "Load factor", fmt: "num", width: 0.6 },
        { header: "Opex", fmt: "text", width: 0.9 },
        { header: "Downtime (months)", fmt: "plain", width: 0.75 },
      ],
      rows: v.ranking.map((p) => [
        p.rank,
        p.name,
        p.metric_psf_annual,
        p.total_net,
        p.term_months,
        p.area_sf,
        p.usable_sf,
        p.load_factor,
        p.opex_structure ?? "none",
        p.downtime_months,
      ]),
      bold: [0],
    },
  ];
  const a = k.checked.args;
  if (isObj(a) && Array.isArray(a.proposals)) {
    const rows: Raw[][] = (a.proposals as Obj[]).map((p) => {
      const s = isObj(p.schedule) ? p.schedule : {};
      const esc = isObj(s.escalation) ? s.escalation : {};
      const opex = isObj(p.operating_expenses) ? p.operating_expenses : {};
      return [
        String(p.name ?? ""),
        typeof s.starting_rent_psf_annual === "number"
          ? s.starting_rent_psf_annual
          : null,
        typeof s.commencement_date === "string" ? s.commencement_date : null,
        typeof s.term_months === "number" ? s.term_months : null,
        Object.keys(esc).length
          ? Object.entries(esc)
              .map(
                ([x, y]) =>
                  `${x}: ${typeof y === "number" ? num(y) : String(y)}`,
              )
              .join("; ")
          : "",
        Array.isArray(s.abated_months) ? s.abated_months.length : 0,
        typeof p.ti_allowance_psf === "number" ? p.ti_allowance_psf : 0,
        typeof opex.type === "string"
          ? `${opex.type}${typeof opex.expense_psf_annual === "number" ? ` ${usd(opex.expense_psf_annual)}/SF` : ""}`
          : "",
        typeof p.leasing_commissions === "number" ? p.leasing_commissions : 0,
        typeof p.downtime_months === "number" ? p.downtime_months : 0,
      ];
    });
    blocks.push(
      { t: "heading", text: "Proposal terms (as sent in the arguments)" },
      {
        t: "table",
        size: 7,
        columns: [
          { header: "Proposal", fmt: "text", width: 1.5 },
          { header: "Starting rent ($/SF/yr)", fmt: "usd", width: 0.9 },
          { header: "Commencement", fmt: "date", width: 0.9 },
          { header: "Term (months)", fmt: "plain", width: 0.7 },
          { header: "Escalation", fmt: "text", width: 1.3 },
          { header: "Abated months", fmt: "int", width: 0.7 },
          { header: "TI ($/SF)", fmt: "usd", width: 0.7 },
          { header: "Operating expenses", fmt: "text", width: 1.2 },
          { header: "Leasing commissions", fmt: "usd", width: 1 },
          { header: "Downtime (months)", fmt: "plain", width: 0.7 },
        ],
        rows,
      },
    );
  }
  blocks.push(...warningsBlocks(r.warnings));
  blocks.push(...closingBlocks(k, "calc_compare_proposals", r.steps));
  return {
    title:
      k.ctx.title ?? `Lease proposals compared (${v.perspective} perspective)`,
    subtitle: subtitle(
      [
        `${v.ranking.length} proposals`,
        `${metric.toLowerCase()}`,
        `first: ${v.best}`,
      ],
      k.ctx,
    ),
    blocks,
    readme: [
      "Lease proposals side by side from calc_compare_proposals, ranked on the tool's metric (discounted net effective rent for a landlord, effective occupancy cost for a tenant), with each proposal's present value and one-time items in the Steps sheet.",
    ],
  };
}

// --- DCF ----------------------------------------------------------------------------------------

const DCF_LINES: [keyof DcfResult["value"]["cash_flows"][number], string][] = [
  ["potential_base_rent", "Potential base rent"],
  ["free_rent", "Free rent"],
  ["expense_recoveries", "Expense recoveries"],
  ["gross_revenue", "Gross revenue"],
  ["general_vacancy", "General vacancy"],
  ["credit_loss", "Credit loss"],
  ["effective_gross_revenue", "Effective gross revenue"],
  ["operating_expenses", "Operating expenses"],
  ["management_fee", "Management fee"],
  ["net_operating_income", "Net operating income"],
  ["tenant_improvements", "Tenant improvements"],
  ["leasing_commissions", "Leasing commissions"],
  ["capital_reserves", "Capital reserves"],
  ["cash_flow_before_debt", "Cash flow before debt service"],
];
const DCF_BOLD = new Set([
  "gross_revenue",
  "effective_gross_revenue",
  "net_operating_income",
  "cash_flow_before_debt",
]);

export function dcfDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as DcfResult;
  const v = r.value;
  const optRows = (
    rows: [string, number | null, "usd" | "pct" | "times"][],
  ): Kv[] =>
    rows
      .filter(([, x]) => x !== null)
      .map(([label, x, fmt]) => ({ label, value: x, fmt }));
  const cashTable = (
    years: DcfResult["value"]["cash_flows"],
    only?: "pdf" | "xlsx",
  ): Block => ({
    t: "table",
    ...(only ? { only } : {}),
    ...(only === "xlsx" ? { sheet: "CashFlows" } : {}),
    size: 6.8,
    columns: [
      { header: "Line (USD)", fmt: "text", width: 2.1 } as TableColumn,
      ...years.map((y) => ({
        header: `Year ${y.year}${y.in_hold ? "" : " (exit NOI)"}`,
        fmt: "usd" as const,
        width: 1.15,
      })),
    ],
    rows: DCF_LINES.map(([key, label]) => [
      label,
      ...years.map((y) => y[key] as number),
    ]),
    bold: DCF_LINES.map(([key], i) => (DCF_BOLD.has(key) ? i : -1)).filter(
      (i) => i >= 0,
    ),
  });
  const blocks: Block[] = [
    { t: "heading", text: "Value" },
    {
      t: "kv",
      rows: [
        {
          label: "Value (PV of cash flows + PV of reversion)",
          value: v.value,
          fmt: "usd",
          name: "value",
        },
        {
          label: "Value per SF",
          value: v.value_per_sf,
          fmt: "usd",
          name: "value_psf",
        },
        {
          label: "PV of cash flows",
          value: v.pv_cash_flows,
          fmt: "usd",
          name: "pv_cf",
        },
        {
          label: "PV of reversion",
          value: v.pv_reversion,
          fmt: "usd",
          name: "pv_rev",
        },
        ...optRows([
          ["Reversion share of value", v.reversion_share_of_value, "pct"],
          ["Going-in cap rate on value", v.going_in_cap_rate_on_value, "pct"],
        ]),
        { label: "Discount rate", value: v.discount_rate, fmt: "pct" },
        {
          label: "Discounting",
          value: v.timing === "mid_year" ? "mid-year" : "end of year",
          fmt: "text",
        },
        { label: "Hold (years)", value: v.hold_years, fmt: "plain" },
        {
          label: "Building area (SF)",
          value: v.building_area_sf,
          fmt: "int",
          name: "area",
        },
        { label: "Year 1 NOI", value: v.noi_year_1, fmt: "usd" },
        ...optRows([
          ["Purchase price", v.purchase_price, "usd"],
          ["NPV at the purchase price", v.npv, "usd"],
          ["Going-in cap rate on price", v.going_in_cap_rate_on_price, "pct"],
          ["Unlevered IRR", v.unlevered_irr, "pct"],
          ["Equity multiple", v.equity_multiple, "times"],
        ]),
      ],
    },
    { t: "heading", text: "Reversion" },
    {
      t: "kv",
      rows: [
        { label: "Exit NOI basis", value: v.exit.noi_basis, fmt: "text" },
        { label: "Exit NOI", value: v.exit.noi, fmt: "usd" },
        { label: "Exit cap rate", value: v.exit.cap_rate, fmt: "pct" },
        {
          label: "Gross sale price",
          value: v.exit.gross_sale_price,
          fmt: "usd",
          name: "gross_sale",
        },
        {
          label: "Selling costs",
          value: v.exit.selling_costs,
          fmt: "usd",
          name: "selling_costs",
        },
        {
          label: "Net sale proceeds",
          value: v.exit.net_sale_proceeds,
          fmt: "usd",
        },
      ],
    },
    { t: "heading", text: "Annual cash flows" },
  ];
  for (let i = 0; i < v.cash_flows.length; i += 6)
    blocks.push(cashTable(v.cash_flows.slice(i, i + 6), "pdf"));
  blocks.push(cashTable(v.cash_flows, "xlsx"));
  blocks.push(
    { t: "heading", text: "Lease events" },
    {
      t: "table",
      sheet: "LeaseEvents",
      size: 7,
      columns: [
        { header: "Lease", fmt: "text", width: 1.6 },
        { header: "Kind", fmt: "text", width: 0.8 },
        { header: "Start month", fmt: "plain", width: 0.7 },
        { header: "End month", fmt: "plain", width: 0.7 },
        { header: "Renewal probability", fmt: "pct", width: 0.8 },
        { header: "Downtime (months)", fmt: "num", width: 0.8 },
        { header: "Free rent (months)", fmt: "num", width: 0.8 },
        { header: "Rent ($/SF/yr)", fmt: "num", width: 0.9 },
        { header: "TI", fmt: "usd", width: 1.1 },
        { header: "Leasing commission", fmt: "usd", width: 1.1 },
      ],
      rows: v.lease_events.map((e) => [
        e.lease,
        e.kind.replace("_", "-"),
        e.start_month,
        e.end_month,
        e.renewal_probability,
        e.downtime_months,
        e.free_rent_months,
        e.rent_psf_annual,
        e.tenant_improvements,
        e.leasing_commission,
      ]),
    },
    ...warningsBlocks(r.warnings),
    ...closingBlocks(k, "calc_dcf_pro_forma", r.steps),
  );
  return {
    title: k.ctx.title ?? `DCF summary: value ${usd(v.value)}`,
    subtitle: subtitle(
      [
        `${v.hold_years}-year hold`,
        `discount rate ${pct(v.discount_rate)}`,
        `exit cap ${pct(v.exit.cap_rate)}`,
      ],
      k.ctx,
    ),
    blocks,
    checks: [
      {
        label: "Value = PV of cash flows + PV of reversion",
        formula: "ROUND({pv_cf}+{pv_rev},2)",
        factlot: v.value,
        dp: 2,
        field: "value.value",
      },
      {
        label: "Net sale proceeds = gross sale price − selling costs",
        formula: "ROUND({gross_sale}-{selling_costs},2)",
        factlot: v.exit.net_sale_proceeds,
        dp: 2,
        field: "value.exit.net_sale_proceeds",
      },
      {
        label: "Value per SF = value ÷ building area",
        formula: "ROUND({value}/{area},2)",
        factlot: v.value_per_sf,
        dp: 2,
        field: "value.value_per_sf",
      },
    ] satisfies Check[],
    readme: [
      "A discounted cash flow summary from calc_dcf_pro_forma: value, reversion, the annual cash flows (the year after the hold is shown for the exit NOI), and the lease events behind them.",
    ],
  };
}
