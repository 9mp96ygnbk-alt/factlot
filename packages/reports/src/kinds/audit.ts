/** expense_audit: a tenant's audit of a landlord's expense statement (audit_expense_statement). */
import type { Block, ReportDoc } from "../doc.ts";
import type { KindInput } from "./common.ts";
import { usd } from "../format.ts";
import { checkSentence, subtitle } from "./common.ts";

type Json = Record<string, unknown>;

export const AUDIT_NOTICE =
  "These findings are differences between the landlord's statement and what the quoted lease terms yield, worked from the facts shown with their quotes and pages. They are not legal conclusions. A finding that follows from the lease's terms is stated as a difference; a finding that depends on how a lease sentence is read, or a question to ask, is labelled as such. Confirm each against the lease and any amendments before relying on it.";

const CLASS_LABEL: Record<string, string> = {
  follows_from_terms:
    "Follows from the lease's terms and the statement's numbers",
  depends_on_reading: "Depends on how the lease sentence is read",
  question_to_ask: "A question to ask, not an overcharge",
};

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : String(v ?? "");

function sourceLines(sources: Json[]): string[] {
  return sources.map(
    (s) =>
      `${s.side === "lease" ? "Lease" : "Statement"}, page ${str(s.page)} (${str(s.predicate)}, fact ${str(s.fact_id)}): "${str(s.quote)}"`,
  );
}

export function auditDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as Json;
  const totals = r.totals as Json;
  const findings = arr(r.findings);
  const deadlines = arr(r.deadlines);
  const notRun = arr(r.checks_not_run);
  const cost = r.cost_shifting as Json | null;
  const year = r.statement_year;
  const blocks: Block[] = [
    { t: "heading", text: "Summary" },
    {
      t: "kv",
      rows: [
        {
          label: "Statement year",
          value: typeof year === "number" ? year : "not given",
          fmt: "plain",
        },
        {
          label: "Findings",
          value: totals.finding_count as number,
          fmt: "int",
        },
        {
          label: "Follow from the lease's terms",
          value: totals.follows_from_terms as number,
          fmt: "int",
        },
        {
          label: "Depend on a reading of the lease",
          value: totals.depends_on_reading as number,
          fmt: "int",
        },
        {
          label: "Questions to ask",
          value: totals.question_to_ask as number,
          fmt: "int",
        },
        {
          label: "Difference that follows from the lease's terms",
          value: totals.firm_difference as number,
          fmt: "usd",
        },
        {
          label: "Total difference if the readings hold",
          value: totals.total_difference as number,
          fmt: "usd",
        },
        ...(deadlines[0]
          ? [
              {
                label: "Last day to dispute or invoke the audit right",
                value: str(deadlines[0].last_day),
                fmt: "text" as const,
                note: `${str(deadlines[0].status)} as of ${str(r.as_of)}`,
              },
            ]
          : []),
      ],
    },
    { t: "notice", tone: "info", text: AUDIT_NOTICE },
    { t: "heading", text: "Deadline" },
    ...(deadlines.length
      ? deadlines.flatMap((d): Block[] => [
          {
            t: "kv",
            rows: [
              { label: "Last day", value: str(d.last_day), fmt: "text" },
              {
                label: "Counted from",
                value: `${str(d.counted_from)} (${str(d.starts_from).replace("_", " ")}) plus ${str(d.window_days)} days`,
                fmt: "text",
              },
              {
                label: "Status as of " + str(r.as_of),
                value:
                  (d.days_remaining as number) >= 0
                    ? `open, ${str(d.days_remaining)} days left`
                    : `passed ${-(d.days_remaining as number)} days ago`,
                fmt: "text",
              },
              {
                label: "Notice the lease requires",
                value: str(d.notice_form),
                fmt: "text",
              },
              ...(d.auditor_requirement
                ? [
                    {
                      label: "Who may audit",
                      value: str(d.auditor_requirement),
                      fmt: "text" as const,
                    },
                  ]
                : []),
            ],
          },
          { t: "para", text: sourceLines(arr(d.sources)).join("\n"), size: 8 },
          { t: "bullets", items: (d.confirm as string[]) ?? [] },
        ])
      : [
          {
            t: "para",
            text: "The deadline could not be computed (see the checks that could not run).",
            grey: true,
          } as Block,
        ]),
  ];
  if (cost)
    blocks.push(
      { t: "heading", text: "Audit cost-shifting" },
      {
        t: "kv",
        rows: [
          {
            label: "Threshold in the lease",
            value: cost.threshold_amount as number,
            fmt: "usd",
            note: str(cost.threshold_type).replace(/_/g, " "),
          },
          {
            label: "Difference that follows from the lease's terms",
            value: cost.firm_difference as number,
            fmt: "usd",
          },
          {
            label: "Difference if the readings hold",
            value: cost.difference_with_readings as number,
            fmt: "usd",
          },
          {
            label: "Crossed on those findings",
            value: cost.crosses_on_firm_findings ? "yes" : "no",
            fmt: "text",
          },
          {
            label: "Crossed if the readings hold",
            value: cost.crosses_if_readings_hold ? "yes" : "no",
            fmt: "text",
          },
        ],
      },
      {
        t: "bullets",
        items: [
          ...((cost.steps as string[]) ?? []),
          ...((cost.confirm as string[]) ?? []).map((c) => `Confirm ${c}`),
        ],
      },
    );
  blocks.push({ t: "heading", text: "Findings" });
  if (findings.length === 0)
    blocks.push({
      t: "para",
      text: "No finding: every check that could run found the statement consistent with the lease terms given.",
      grey: true,
    });
  for (const f of findings) {
    blocks.push(
      { t: "subheading", text: `${str(f.id)}  ${str(f.title)}` },
      {
        t: "kv",
        rows: [
          {
            label: "Confidence",
            value: CLASS_LABEL[str(f.class)] ?? str(f.class),
            fmt: "text",
          },
          {
            label: "Landlord's figure",
            value: (f.landlord_figure as number | null) ?? "not stated",
            fmt: "usd",
          },
          {
            label: "Figure the lease yields",
            value: (f.lease_figure as number | null) ?? "not stated",
            fmt: "usd",
          },
          {
            label: "Difference to the tenant",
            value: (f.difference as number | null) ?? "no figure: a question",
            fmt: "usd",
          },
        ],
      },
      { t: "para", text: "Calculation", grey: true },
      { t: "bullets", items: f.steps as string[] },
      { t: "para", text: "Quotes and pages", grey: true },
      { t: "para", text: sourceLines(arr(f.sources)).join("\n"), size: 8 },
      { t: "para", text: "To confirm before relying on it", grey: true },
      { t: "bullets", items: f.confirm as string[] },
    );
  }
  blocks.push(
    { t: "heading", text: "Checks that could not run" },
    notRun.length
      ? {
          t: "bullets",
          items: notRun.map(
            (n) =>
              `${str(n.check).replace(/_/g, " ")} (${str(n.status).replace("_", " ")}): ${str(n.reason)}`,
          ),
        }
      : { t: "para", text: "Every check ran on the facts given.", grey: true },
    { t: "heading", text: "Provenance" },
    {
      t: "kv",
      rows: [
        { label: "Tool", value: k.p.toolRef, fmt: "text" },
        { label: "FactLot version", value: k.p.version, fmt: "text" },
        {
          label: "Generated (UTC)",
          value: k.p.generatedAt
            .toISOString()
            .replace("T", " ")
            .replace(/\.\d+Z$/, " UTC"),
          fmt: "text",
        },
        {
          label: "Facts used",
          value: (r.facts_used as unknown[]).length,
          fmt: "int",
        },
      ],
    },
    { t: "para", text: checkSentence(k.checked, "audit_expense_statement") },
    {
      t: "para",
      grey: true,
      text: "Every figure in this document is from FactLot's run of the tool on the facts sent, each fact with its quote and page. Money is shown to the cent. Nothing is estimated or written by a model, and no source means no finding: a check whose lease term is missing is listed above as not run.",
    },
  );
  return {
    title:
      k.ctx.title ??
      `Expense statement audit${typeof year === "number" ? `, ${year}` : ""}`,
    subtitle: subtitle(
      [
        `${str(totals.finding_count)} finding${totals.finding_count === 1 ? "" : "s"}`,
        `total difference ${usd(totals.total_difference as number)}`,
        deadlines[0] ? `deadline ${str(deadlines[0].last_day)}` : undefined,
      ],
      k.ctx,
    ),
    blocks,
    readme: [
      "A tenant's audit of a landlord's expense statement from audit_expense_statement: findings against the lease's quoted terms, each with its calculation, quotes and pages, the deadline to dispute or audit, and the checks that could not run.",
    ],
  };
}
