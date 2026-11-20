/**
 * expense_audit: a tenant's audit of a landlord's expense statement (audit_expense_statement),
 * laid out in the institutional style (institutional.ts). PDF only.
 */
import { usd } from "../format.ts";
import { InstitutionalWriter, type Cell } from "../institutional.ts";
import type { KindInput } from "./common.ts";
import { checkSentence } from "./common.ts";

type Json = Record<string, unknown>;

export const AUDIT_NOTICE =
  "These findings compare the landlord's statement with what the quoted lease terms yield, worked from the facts shown with their quotations and pages. A finding that follows from the lease states a difference worked from the quoted terms; a finding that depends on a reading, or a question to raise, is labelled so. None is a legal conclusion: confirm each against the lease and its amendments before relying on it.";

const BASIS: Record<string, string> = {
  follows_from_terms: "Follows from the lease",
  depends_on_reading: "Depends on a reading",
  question_to_ask: "Question to raise",
};
const BASIS_LONG: Record<string, string> = {
  follows_from_terms:
    "Follows from the lease's terms and the statement's numbers",
  depends_on_reading: "Depends on how the lease sentence is read",
  question_to_ask: "A question to raise, not an overcharge",
};

/** Section headings: the finding in a phrase. A code not listed uses the tool's own title. */
const SHORT_TITLE: Record<string, string> = {
  FEE_RATE_ABOVE_CAP: "Administrative fee rate above the lease rate",
  FEE_ON_EXCLUDED_LINES:
    "Administrative fee charged on lines the lease excludes",
  FEE_ON_GROSSED_UP_BASE: "Administrative fee charged on a grossed-up base",
  FEE_BASE_UNRECONCILED: "Administrative fee base the lease does not allow",
  CAP_EXCEEDED: "Controllable expenses charged above the cap",
  CAP_METHOD_AMBIGUOUS: "Cap on controllable expenses: method not stated",
  CAPEX_BILLED_AS_OPERATING: "Capital item billed as an operating expense",
  CAPEX_AMORTIZATION: "Capital item recovered over a different period",
  GROSSUP_ON_FIXED_EXPENSE: "Gross-up applied to a fixed expense",
  GROSSUP_WRONG_OCCUPANCY: "Gross-up to an occupancy the lease does not state",
  GROSSUP_BASE_YEAR_INCONSISTENT: "Gross-up inconsistent with the base year",
  SHARE_DIFFERS: "Tenant's share differs from the lease",
  EXCLUDED_CATEGORY_BILLED: "Category the lease excludes was billed",
  DUPLICATE_LINE: "A line appears twice",
  DUPLICATE_OF_SEPARATE_BILL: "A cost also billed to the tenant separately",
  BASE_YEAR_DIFFERS: "Base year differs from the lease",
  BASE_YEAR_DEDUCTION: "Base-year deduction differs from the lease",
  STOP_DIFFERS: "Expense stop differs from the lease",
  ARITH_LINES_VS_TOTAL: "Lines do not add to the stated total",
  ARITH_ESTIMATES: "Estimates credited differ from estimates paid",
  ARITH_BALANCE: "Balance claimed does not follow from the figures",
  ARITH_FEE: "Fee stated does not follow from its rate and base",
  YOY_RISE: "Line rose sharply on the prior year",
};

/** Plain words for the predicates a "needs ..." reason names. */
const PREDICATE_WORDS: Record<string, string> = {
  "lease.pro_rata_share": "the lease's pro-rata share",
  "lease.pro_rata_basis": "the lease's share basis (areas)",
  "lease.cam_cap": "the lease's cap on controllable expenses",
  "lease.cam_cap_rate": "the lease's cap rate",
  "lease.cam_admin_fee": "the lease's administrative fee clause",
  "lease.cam_gross_up": "the lease's gross-up clause",
  "lease.cam_exclusion": "the lease's excluded categories",
  "lease.capex_treatment": "the lease's treatment of capital items",
  "lease.audit_right": "the lease's audit right",
  "lease.operating_expense_base_year": "the lease's base year",
  "lease.expense_stop": "the lease's expense stop",
  "statement.period": "the statement's period and dates",
  "statement.line": "the statement's expense lines",
  "statement.total": "the statement's stated total",
  "statement.share_applied": "the share the statement applied",
  "statement.gross_up": "the gross-up the statement applied",
  "statement.admin_fee": "the fee the statement charged",
  "statement.cap_reference": "the cap reference amount on the statement",
  "statement.cap_applied": "the cap limit the statement applied",
  "statement.base_year_applied": "the base-year deduction on the statement",
  "statement.base_year_total": "the base-year total on the statement",
  "statement.tenant_charge": "the tenant's charge on the statement",
  "statement.estimates_credited": "the estimates credited on the statement",
  "statement.estimates_paid": "the estimates paid",
  "statement.balance_claimed": "the balance claimed on the statement",
  "statement.separately_billed": "separately billed costs",
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : String(v ?? "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 2026-07-08 as "July 8, 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : iso;
}

/** Every ISO date in a sentence, written as a person reads it. */
export const readable = (s: string): string =>
  s
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (d) => longDate(d))
    .replace(/\b(?:[a-z]+_)+[a-z]+\b/g, (t) => t.replace(/_/g, " "));

/** Money to the cent, with thousands separators. */
const cents = (x: number | null): string => (x === null ? "—" : usd(x));
/** Money for a large figure: ".00" dropped. */
const big = (x: number | null): string =>
  x === null ? "—" : usd(x).replace(/\.00$/, "");

/** A tool's "needs lease.x and statement.y" with the predicates in words. */
function plainNeeds(reason: string): string {
  let mapped = false;
  let s = reason
    .replace(
      /prior_statement_facts with statement\.line facts/g,
      () => (
        (mapped = true),
        "the prior year's statement, with its expense lines"
      ),
    )
    .replace(/\b(?:lease|statement)\.[a-z_]+\b/g, (p) => {
      if (PREDICATE_WORDS[p]) mapped = true;
      return PREDICATE_WORDS[p] ?? p;
    });
  // "(the gross-up clause)" only repeated what the predicate said.
  if (mapped) s = s.replace(/\s*\([^)]*\)\s*$/, "");
  return readable(s.charAt(0).toUpperCase() + s.slice(1));
}

interface SourceRow {
  side: string;
  fact_id: string;
  predicate: string;
  quote: string;
  page: number | null;
  document_id: string;
}

function sourceLabel(s: SourceRow): string {
  return `${s.side === "lease" ? "Lease" : "Statement"}, page ${s.page ?? "?"}`;
}

/** Every fact the report cites or the tool used, once. */
function collectSources(r: Json, args: unknown): SourceRow[] {
  const out = new Map<string, SourceRow>();
  const add = (s: Json, fallbackSide?: string) => {
    const id = str(s.fact_id ?? s.id);
    if (!id || out.has(id)) return;
    out.set(id, {
      side: str(s.side ?? fallbackSide),
      fact_id: id,
      predicate: str(s.predicate),
      quote: str(s.quote),
      page: num(s.page),
      document_id: str(s.document_id),
    });
  };
  for (const f of arr(r.findings)) arr(f.sources).forEach((s) => add(s));
  for (const d of arr(r.deadlines)) arr(d.sources).forEach((s) => add(s));
  const cost = r.cost_shifting as Json | null;
  if (cost) arr(cost.sources).forEach((s) => add(s));
  // Facts used but not cited by a finding: read from the arguments, when they were sent.
  const used = new Set((r.facts_used as unknown[] | undefined)?.map(str) ?? []);
  const a = (args ?? {}) as Json;
  for (const [key, side] of [
    ["lease_facts", "lease"],
    ["statement_facts", "statement"],
    ["prior_statement_facts", "statement"],
  ] as const)
    for (const f of arr(a[key])) {
      const id = str(f.id);
      if (!used.has(id) || out.has(id)) continue;
      const prov = (f.provenance ?? {}) as Json;
      const src = arr(prov.sources)[0] ?? {};
      out.set(id, {
        side,
        fact_id: id,
        predicate: str(f.predicate),
        quote: str(src.quote),
        page: num(src.page),
        document_id: str(src.document_id),
      });
    }
  for (const id of used)
    if (!out.has(id))
      out.set(id, {
        side: "",
        fact_id: id,
        predicate: "",
        quote: "",
        page: null,
        document_id: "",
      });
  return [...out.values()].sort(
    (x, y) =>
      Number(y.side === "lease") - Number(x.side === "lease") ||
      (x.page ?? 0) - (y.page ?? 0) ||
      x.predicate.localeCompare(y.predicate) ||
      x.fact_id.localeCompare(y.fact_id),
  );
}

const digest = (id: string): string => {
  const m = /sha256-([0-9a-f]{8})/.exec(id);
  return m ? m[1]! : "";
};

export async function auditPdf(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as Json;
  const totals = r.totals as Json;
  const findings = arr(r.findings);
  const deadlines = arr(r.deadlines);
  const notRun = arr(r.checks_not_run);
  const cost = r.cost_shifting as Json | null;
  const year = typeof r.statement_year === "number" ? r.statement_year : null;
  const asOf = longDate(str(r.as_of));
  const preparedFor = k.ctx.prepared_for;
  const subject = k.ctx.title;
  const sources = collectSources(r, k.checked.args);

  const w = await InstitutionalWriter.create({
    title: `Operating expense statement audit${year ? `, ${year}` : ""}`,
    subject: `Operating expense statement audit, ${asOf}`,
    brand: "FactLot",
    mastheadRight: `Expense statement audit  ·  ${asOf}`,
    runningHeader: `Expense statement audit${year ? `, ${year}` : ""}${preparedFor ? `  ·  ${preparedFor}` : ""}`,
    footer: `Prepared from the documents supplied. Not legal advice. FactLot ${k.p.version}.`,
    producer: `FactLot ${k.p.version} reports`,
    keywords: k.p.keywords,
    created: k.p.generatedAt,
  });

  // ---- page 1 ---------------------------------------------------------------------------------
  w.titleBlock({
    title: "Operating expense statement audit",
    line: [
      year ? `Statement year ${year}` : "Statement year not given",
      subject,
    ]
      .filter(Boolean)
      .join("  ·  "),
    preparedFor,
    asOf,
  });
  const d0 = deadlines[0];
  const days = d0 ? (num(d0.days_remaining) ?? 0) : null;
  const cells: Cell[] = [
    {
      figure: big(num(totals.total_difference)),
      label: "Total difference if the readings hold",
    },
    {
      figure: big(num(totals.firm_difference)),
      label: "Difference that follows from the lease's terms",
    },
    {
      figure: String(totals.finding_count),
      label: totals.finding_count === 1 ? "Finding" : "Findings",
    },
    d0
      ? {
          figure: longDate(str(d0.last_day)),
          label:
            days !== null && days >= 0
              ? `Last day to dispute (${days} ${days === 1 ? "day" : "days"} remaining)`
              : `Last day to dispute (passed ${-(days ?? 0)} days ago)`,
        }
      : {
          figure: "Not computed",
          label: "Last day to dispute: the lease's audit term was not supplied",
        },
  ];
  w.band(cells, { figureSize: 21, accent: true });

  w.section("Summary of findings", 90);
  if (findings.length === 0) {
    w.para(
      "No finding: every check that could run found the statement consistent with the lease terms supplied. The checks that could not run are listed under Checks not performed.",
    );
  } else {
    const rows = findings.map((f, i) => [
      String(i + 1),
      SHORT_TITLE[str(f.code)] ?? str(f.title),
      BASIS[str(f.class)] ?? str(f.class),
      cents(num(f.landlord_figure)),
      cents(num(f.lease_figure)),
      cents(num(f.difference)),
    ]);
    rows.push(["", "Total", "", "", "", cents(num(totals.total_difference))]);
    w.table(
      [
        { header: "No.", width: 24 },
        { header: "Finding", width: 150 },
        { header: "Basis", width: 82 },
        { header: "Landlord's figure", width: 76, align: "right" },
        { header: "Lease yields", width: 76, align: "right" },
        { header: "Difference", width: 62, align: "right" },
      ],
      rows,
      { totalRow: true },
    );
  }

  w.note("How to read this report", AUDIT_NOTICE);

  const dateRows = (d: Json): [string, string][] => {
    const dd = num(d.days_remaining) ?? 0;
    const rows: [string, string][] = [
      [
        "Last day to dispute or audit",
        `${longDate(str(d.last_day))} (${
          dd >= 0
            ? `open, ${dd} ${dd === 1 ? "day" : "days"} remaining`
            : `passed ${-dd} days ago`
        } as of ${asOf})`,
      ],
      [
        "How it was counted",
        `${str(d.window_days)} days from ${str(d.starts_from).replace("_", " ")}, ${longDate(str(d.counted_from))}`,
      ],
      ["Notice the lease requires", cap(readable(str(d.notice_form)))],
    ];
    if (d.auditor_requirement)
      rows.push(["Who may audit", cap(readable(str(d.auditor_requirement)))]);
    if (cost) {
      const type = str(cost.threshold_type);
      const val = num(cost.threshold_value);
      rows.push(
        [
          "Cost-shifting threshold",
          `${cents(num(cost.threshold_amount))}${
            type === "percent_of_billed" && val !== null
              ? ` (${(val * 100).toFixed(2).replace(/\.?0+$/, "")}% of the tenant's billed charge)`
              : ""
          }`,
        ],
        [
          "Threshold crossed",
          `On the findings that follow from the lease: ${cost.crosses_on_firm_findings ? "yes" : "no"} (${cents(num(cost.firm_difference))}). If the readings hold: ${cost.crosses_if_readings_hold ? "yes" : "no"} (${cents(num(cost.difference_with_readings))}).`,
        ],
      );
    }
    return rows;
  };
  w.section(
    "Key dates and notice",
    deadlines[0] ? w.definitionsHeight(dateRows(deadlines[0])) : 30,
  );
  if (deadlines.length === 0)
    w.para("The deadline could not be computed: see Checks not performed.", {
      color: "slate",
    });
  for (const d of deadlines) w.definitions(dateRows(d));

  // ---- the findings ---------------------------------------------------------------------------
  findings.forEach((f, i) => {
    const short = SHORT_TITLE[str(f.code)] ?? str(f.title);
    w.section(`${i + 1}. ${short}`, 175);
    w.label(BASIS_LONG[str(f.class)] ?? str(f.class));
    w.space(4);
    if (/[$\d]/.test(str(f.title)))
      w.para(readable(str(f.title)), { after: 7 });
    const diff = num(f.difference);
    w.band(
      [
        {
          figure: big(num(f.landlord_figure)),
          label: str(f.landlord_label) || "Landlord's figure",
        },
        {
          figure: big(num(f.lease_figure)),
          label: str(f.lease_label) || "Figure the lease yields",
        },
        {
          figure: diff === null ? "—" : big(diff),
          label:
            diff === null
              ? "No figure: a question, not a difference"
              : "Difference to the tenant",
        },
      ],
      { figureSize: 15 },
    );
    w.subhead("Calculation", 50);
    w.steps((f.steps as string[]).map(readable));
    w.subhead("Lease and statement language", 60);
    const seen = new Set<string>();
    for (const s of arr(f.sources)) {
      const id = str(s.fact_id);
      if (seen.has(id)) continue;
      seen.add(id);
      w.quote(
        str(s.quote),
        sourceLabel({
          side: str(s.side),
          fact_id: id,
          predicate: "",
          quote: "",
          page: num(s.page),
          document_id: "",
        }),
      );
    }
    w.subhead("To confirm before relying on this", 40);
    w.bullets((f.confirm as string[]).map((c) => cap(readable(c))));
  });

  // ---- checks not performed -------------------------------------------------------------------
  const names = new Map(
    arr(r.checks).map((c) => [str(c.check), str(c.name)] as const),
  );
  w.section("Checks not performed", 70);
  if (notRun.length === 0)
    w.para("Every check ran on the facts supplied.", { color: "slate" });
  else
    w.table(
      [
        { header: "Check", width: 34 },
        { header: "What it needs", width: 66 },
      ],
      notRun.map((c) => [
        names.get(str(c.check)) ??
          str(c.check)
            .replace(/_/g, " ")
            .replace(/^./, (x) => x.toUpperCase()),
        `${str(c.status) === "partly_run" ? "Partly run. " : ""}${plainNeeds(str(c.reason))}`,
      ]),
    );

  // ---- basis of preparation, important information ---------------------------------------------
  w.section("Basis of preparation", 60);
  const callerText = k.ctx.title || k.ctx.prepared_for;
  w.para(
    `This report applies deterministic checks to the lease facts and statement facts supplied, each fact carrying the quotation and page it was read from. FactLot runs no model: the same facts give the same findings. A finding is the difference between the landlord's statement and what the quoted lease terms yield, and a check with no verified lease fact behind it is listed as not performed. ${checkSentence(k.checked, "audit_expense_statement")} Prepared by FactLot ${k.p.version} with ${k.p.toolRef} on ${longDate(k.p.generatedAt.toISOString().slice(0, 10))} (UTC).${
      callerText
        ? " The title and the prepared-for line were supplied by the caller and are printed as supplied."
        : ""
    }`,
    { size: 8, leading: 11.5 },
  );
  w.section("Important information", 50);
  w.para(
    "This report is prepared from the documents supplied and has not been checked against any other source. It is not legal advice and states no legal conclusion; a finding that depends on a reading of the lease, or a question to raise, is labelled as such. Confirm each finding against the lease and its amendments, and take advice before disputing a statement or giving notice. Deadlines are counted from the dates on the statement as supplied: confirm how the lease counts days and what counts as notice.",
    { size: 8, leading: 11.5 },
  );

  // ---- sources --------------------------------------------------------------------------------
  w.section("Sources", 80);
  w.table(
    [
      { header: "Document", width: 25 },
      { header: "Page", width: 6, align: "right" },
      { header: "Predicate", width: 30 },
      { header: "Fact id", width: 39, mono: true },
    ],
    sources.map((s) => [
      `${s.side === "lease" ? "Lease" : s.side === "statement" ? "Statement" : ""}${digest(s.document_id) ? ` \u00b7 ${digest(s.document_id)}` : ""}`,
      s.page === null ? "" : String(s.page),
      s.predicate,
      s.fact_id,
    ]),
    { size: 7.75, padY: 3.5 },
  );
  return w.bytes();
}
