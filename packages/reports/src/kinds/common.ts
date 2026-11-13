/** Pieces every report kind shares: the audit trail, warnings, and how the input was checked. */
import { z } from "zod";

import type { Block, Fmt, Provenance, ReportDoc } from "../doc.ts";
import { isRounded, roundInText, ungrouped } from "../format.ts";
import { TEXT_LIMITS } from "../text.ts";
import { TxCitation, type Checked } from "../validate.ts";

import { ContextCandidate, ContextSelectionRule } from "./tx_context.ts";

/** A citation the caller adds: its locator is capped tighter than a tool result's. */
const ContextCitation = TxCitation.extend({
  locator: z.string().min(1).max(TEXT_LIMITS.locator).optional(),
});

/** Longest text of a source entry (title, license, attribution) and of its URL. */
export const SOURCE_TEXT_MAX = 300;
export const SOURCE_URL_MAX = 500;

const SourceText = z.string().max(SOURCE_TEXT_MAX).nullable().optional();

/**
 * One entry of registry_tx_equity_candidates' `sources` (or registry_get's), as returned: the
 * snapshot a citation's document_id names, its publisher's URL and as-of date, and the rights
 * the publisher states. Fields a newer registry adds pass through unread.
 */
export const ContextSource = z.looseObject({
  document_id: z.string().min(1).max(200),
  source_id: SourceText,
  title: SourceText,
  uri: z
    .string()
    .max(SOURCE_URL_MAX)
    .regex(/^https?:\/\/\S+$/, "an http or https URL")
    .nullable()
    .optional(),
  retrieved_at: z.string().max(40).nullable().optional(),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  rights: z
    .looseObject({
      ai_use: z.string().max(64).nullable().optional(),
      redistribution: z.string().max(64).nullable().optional(),
      license: SourceText,
      attribution: SourceText,
    })
    .nullable()
    .optional(),
});
export type ContextSource = z.output<typeof ContextSource>;

/**
 * Optional text the caller adds to a report, printed as supplied by the caller. Never numbers
 * that go into a calculation; advice or valuation wording is refused (text.ts).
 */
export const ReportContext = z.strictObject({
  title: z
    .string()
    .min(1)
    .max(TEXT_LIMITS.title)
    .optional()
    .describe(
      "Report title shown on the cover, e.g. the property or lease name. Defaults to one from the result.",
    ),
  prepared_for: z
    .string()
    .min(1)
    .max(TEXT_LIMITS.prepared_for)
    .optional()
    .describe("Who the report is prepared for, printed under the title."),
  subject_citation: ContextCitation.optional().describe(
    "tx_unequal_appraisal: where the subject's value comes from (document_id, locator, as_of, fact_id).",
  ),
  comparable_citations: z
    .record(z.string().min(1).max(200), ContextCitation)
    .optional()
    .refine(
      (r) => r === undefined || Object.keys(r).length <= 200,
      "at most 200 citations",
    )
    .describe(
      "tx_unequal_appraisal: citations by comparable id (or #1, #2 … for comparables without an id), for comparables whose result carries none. A citation in the result is kept; one here for the same comparable is listed beside it.",
    ),
  sources: z
    .array(ContextSource)
    .max(200)
    .optional()
    .describe(
      'tx_unequal_appraisal: the `sources` of registry_tx_equity_candidates (or registry_get) as returned: each cited document_id with its title, uri, as_of and rights (ai_use, redistribution, license, attribution). The packet\'s Sources and rights block prints each cited source with its as-of date, URL and rights; a source sent without rights, or a right of "unknown", is printed as not stated by the publisher.',
    ),
  candidates: z
    .array(ContextCandidate)
    .max(201)
    .optional()
    .describe(
      "tx_unequal_appraisal: the rows of registry_tx_equity_candidates' `subject` and `candidates` for this calculation's subject and comparables only, as returned, matched by id. Each row's value and improvement_area_sf must equal that subject's or comparable's in the calculation, and every id must be one of them (InputError otherwise). The packet and workbook print the account number (apn), state property category, building class, local use code, land area and year built as sent, and value per SF computed from the calculation's value and area.",
    ),
  selection_rule: ContextSelectionRule.optional().describe(
    "tx_unequal_appraisal: the `selection_rule` of registry_tx_equity_candidates as returned. The packet and workbook print FactLot's default candidate rule with the parameters, narrowing, step counts and tier counts applied.",
  ),
});
export type ReportContext = z.output<typeof ReportContext>;

export interface KindInput {
  checked: Checked;
  ctx: ReportContext;
  p: Provenance;
  /** critical_dates ics: keep events dated before the generation day. */
  include_past?: boolean;
}

/** The label on every page of a lease abstract built from a result the caller sent. */
export const SUPPLIED_LABEL =
  "Abstract values as supplied by the caller; FactLot did not recompute them.";
/** The label on every page of a lease abstract FactLot ran from the documents' text. */
export const LEASE_COMPUTED_LABEL =
  "Abstract values as supplied by the caller and checked against the lease text sent.";

export function checkSentence(c: KindInput["checked"], tool: string): string {
  if (c.check === "supplied")
    return `Supplied: the ${tool} result the caller sent. FactLot checked its shape and counts but did not recompute it: the lease documents were not sent.`;
  const sent =
    c.result_mismatch === undefined
      ? ""
      : c.result_mismatch
        ? " A result was sent with the request too; it differs from this run and was not used."
        : " A result was sent with the request too; it matches this run and was not used.";
  if (tool === "doc_abstract_lease")
    return `Checked: FactLot ran ${tool} on the documents' text sent with this request. The values are the ones supplied with the documents, each kept only where its quote was found on the cited page; FactLot did not compute them.${sent}`;
  return `Computed: FactLot ran ${tool} on the arguments sent with this request; every figure in this document is from that run.${sent}`;
}

export const TRACE_SENTENCE =
  "Every computed number in this document is a figure from FactLot's run of the tool. Money is shown to the cent, rates as percentages to two decimals (0.0625 is 6.25%), ratios to two decimals and audit-trail values to 6 significant digits; the full precision is in the tool result and in the workbook's cells. An Inputs section lists the arguments as sent. Nothing is estimated or written by a model.";

export const SUPPLIED_TRACE_SENTENCE =
  "The values in this document are printed as the result states them. Nothing is estimated or written by a model.";

/** The note under an audit trail whose values are rounded for display. */
export const STEPS_NOTE =
  "Values are rounded to 6 significant digits (money to the cent); the full precision is in the tool result.";

/** A step's text as printed: money with its sign first, long decimals rounded, neutral words. */
function stepText(s: string): string {
  return roundInText(s).replace(/^Best\b/, "First-ranked");
}

export function stepsBlock(
  steps: {
    label: string;
    value: number | string;
    formula?: string;
    unit?: string;
  }[],
): Block {
  const usdUnit = (u?: string) => /^USD\b/.test(u ?? "");
  return {
    t: "table",
    sheet: "Steps",
    columns: [
      { header: "Step", fmt: "text", width: 2.2 },
      { header: "Value", fmt: "step", width: 1.3 },
      { header: "Unit", fmt: "text", width: 0.7 },
      { header: "How it was reached", fmt: "text", width: 3.6 },
    ],
    // A long text value reads better in the wide column, ahead of how it was reached.
    rows: steps.map((s) => {
      const label = stepText(s.label);
      const formula = s.formula ? stepText(s.formula) : "";
      return typeof s.value === "string" && s.value.length > 28
        ? [
            label,
            "",
            s.unit ?? "",
            formula ? `${stepText(s.value)}\n${formula}` : stepText(s.value),
          ]
        : [
            label,
            typeof s.value === "string" ? stepText(s.value) : s.value,
            s.unit ?? "",
            formula,
          ];
    }),
    fmts: steps.map((s): (Fmt | undefined)[] => [
      undefined,
      usdUnit(s.unit) ? "usd" : undefined,
    ]),
    size: 7,
  };
}

/** Whether a step list shows any value rounded for display. */
function stepsRounded(steps: Parameters<typeof stepsBlock>[0]): boolean {
  return steps.some(
    (s) =>
      (typeof s.value === "number" &&
        (/^USD\b/.test(s.unit ?? "")
          ? Math.round(s.value * 100) / 100 !== s.value
          : isRounded(s.value))) ||
      /\d\.\d{7,}/.test(`${s.formula ?? ""} ${String(s.value)}`),
  );
}

export function warningsBlocks(
  warnings: string[],
  heading = "Warnings from the tool",
): Block[] {
  return [
    { t: "heading", text: heading },
    warnings.length
      ? { t: "bullets", items: warnings }
      : { t: "para", text: "The tool returned no warnings.", grey: true },
  ];
}

/** The closing sections: how the input was checked, the audit trail, provenance. */
export function closingBlocks(
  k: KindInput,
  tool: string,
  steps?: Parameters<typeof stepsBlock>[0],
): Block[] {
  const out: Block[] = [];
  if (steps?.length) {
    out.push({ t: "heading", text: "Audit trail (the tool's steps)" });
    out.push(stepsBlock(steps));
    out.push({
      t: "para",
      grey: true,
      text: stepsRounded(steps)
        ? STEPS_NOTE
        : "Values as the tool returned them (money to the cent).",
      only: "pdf",
    });
  }
  out.push(...inputsBlocks(k.checked.args));
  out.push({ t: "heading", text: "Provenance" });
  out.push({
    t: "kv",
    rows: [
      { label: "Tool and formula", value: k.p.toolRef, fmt: "text" },
      { label: "FactLot version", value: k.p.version, fmt: "text" },
      {
        label: "Generated (UTC)",
        value: k.p.generatedAt
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, " UTC"),
        fmt: "text",
      },
    ],
  });
  out.push({ t: "para", text: checkSentence(k.checked, tool) });
  out.push({
    t: "para",
    text: tool.startsWith("calc_") ? TRACE_SENTENCE : SUPPLIED_TRACE_SENTENCE,
    grey: true,
  });
  return out;
}

/** Longest argument text shown in full; longer text (page text, say) is summarized. */
const MAX_ARG_TEXT = 300;
const MAX_ARG_ROWS = 400;

/** The tool's arguments, when sent, flattened to one row per value. */
/** A list of plain values longer than this is one row in the PDF (all of it in the workbook). */
const PDF_LIST_SHOWN = 6;

export function inputsBlocks(args: unknown): Block[] {
  if (args === undefined) return [];
  const table = (compact: boolean): Block => {
    const rows: (string | number)[][] = [];
    const fmts: (Fmt | undefined)[][] = [];
    const scalar = (v: unknown) => typeof v !== "object" || v === null;
    const walk = (v: unknown, path: string) => {
      if (rows.length >= MAX_ARG_ROWS) return;
      if (
        compact &&
        Array.isArray(v) &&
        v.length > PDF_LIST_SHOWN &&
        v.every(scalar)
      ) {
        rows.push([
          `${path} (${v.length} values)`,
          `${v
            .slice(0, PDF_LIST_SHOWN)
            .map((x) => (typeof x === "string" ? x : String(x)))
            .join(", ")}, … (all ${v.length} in the workbook's Inputs sheet)`,
        ]);
      } else if (Array.isArray(v))
        v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (typeof v === "object" && v !== null)
        for (const [key, x] of Object.entries(v))
          walk(x, path ? `${path}.${key}` : key);
      else if (typeof v === "number") {
        fmts[rows.length] = [
          undefined,
          Number.isInteger(v) && ungrouped(path) ? "plain" : undefined,
        ];
        rows.push([path, v]);
      } else {
        const text = typeof v === "boolean" ? String(v) : String(v ?? "");
        rows.push([
          path,
          text.length > MAX_ARG_TEXT
            ? `(${text.length} characters of text, not shown)`
            : text,
        ]);
      }
    };
    walk(args, "");
    return {
      t: "table",
      only: compact ? "pdf" : "xlsx",
      sheet: "Inputs",
      size: 7,
      columns: [
        { header: "Argument", fmt: "text", width: 2.4 },
        { header: "Value", fmt: "exact", width: 2.4 },
      ],
      rows:
        rows.length >= MAX_ARG_ROWS
          ? [...rows, [`(first ${MAX_ARG_ROWS} values shown)`, ""]]
          : rows,
      fmts: Array.from({ length: rows.length }, (_, i) => fmts[i] ?? []),
    };
  };
  return [
    { t: "heading", text: "Inputs: the arguments the tool was run on" },
    table(true),
    table(false),
  ];
}

export function subtitle(
  parts: (string | undefined | false)[],
  ctx: ReportContext,
): string {
  const supplied =
    ctx.title && ctx.prepared_for
      ? "Title and prepared-for line supplied by the caller"
      : ctx.title
        ? "Title supplied by the caller"
        : ctx.prepared_for
          ? "Prepared-for line supplied by the caller"
          : undefined;
  return [
    ...(ctx.prepared_for ? [`Prepared for ${ctx.prepared_for}`] : []),
    ...parts.filter(Boolean),
    ...(supplied ? [supplied] : []),
  ].join(" | ");
}

export type Builder = (k: KindInput) => ReportDoc;
