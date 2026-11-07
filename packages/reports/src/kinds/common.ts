/** Pieces every report kind shares: the audit trail, warnings, and how the input was checked. */
import { z } from "zod";

import type { Block, Provenance, ReportDoc } from "../doc.ts";
import { TEXT_LIMITS } from "../text.ts";
import { TxCitation, type Checked } from "../validate.ts";

/** A citation the caller adds: its locator is capped tighter than a tool result's. */
const ContextCitation = TxCitation.extend({
  locator: z.string().min(1).max(TEXT_LIMITS.locator).optional(),
});

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
});
export type ReportContext = z.output<typeof ReportContext>;

export interface KindInput {
  checked: Checked;
  ctx: ReportContext;
  p: Provenance;
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
  return `Computed: FactLot ran ${tool} on the arguments sent with this request; every figure in this document is from that run.${sent}`;
}

export const TRACE_SENTENCE =
  "Every computed number in this document is a figure from FactLot's run of the tool, printed as returned (rates are decimals in the result and percentages here: 0.0625 is 6.25%); an Inputs section lists the arguments as sent. Nothing is estimated, rounded further or written by a model.";

export const SUPPLIED_TRACE_SENTENCE =
  "The values in this document are printed as the result states them. Nothing is estimated or written by a model.";

export function stepsBlock(
  steps: {
    label: string;
    value: number | string;
    formula?: string;
    unit?: string;
  }[],
): Block {
  return {
    t: "table",
    sheet: "Steps",
    columns: [
      { header: "Step", fmt: "text", width: 2.2 },
      { header: "Value", fmt: "num", width: 1.3 },
      { header: "Unit", fmt: "text", width: 0.7 },
      { header: "How it was reached", fmt: "text", width: 3.6 },
    ],
    // A long text value reads better in the wide column, ahead of how it was reached.
    rows: steps.map((s) =>
      typeof s.value === "string" && s.value.length > 28
        ? [
            s.label,
            "",
            s.unit ?? "",
            s.formula ? `${s.value}\n${s.formula}` : s.value,
          ]
        : [s.label, s.value, s.unit ?? "", s.formula ?? ""],
    ),
    size: 7,
  };
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
export function inputsBlocks(args: unknown): Block[] {
  if (args === undefined) return [];
  const rows: (string | number)[][] = [];
  const walk = (v: unknown, path: string) => {
    if (rows.length >= MAX_ARG_ROWS) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (typeof v === "object" && v !== null)
      for (const [key, x] of Object.entries(v))
        walk(x, path ? `${path}.${key}` : key);
    else if (typeof v === "number") rows.push([path, v]);
    else {
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
  return [
    { t: "heading", text: "Inputs: the arguments the tool was run on" },
    {
      t: "table",
      sheet: "Inputs",
      size: 7,
      columns: [
        { header: "Argument", fmt: "text", width: 2.4 },
        { header: "Value", fmt: "num", width: 2.4 },
      ],
      rows:
        rows.length >= MAX_ARG_ROWS
          ? [...rows, [`(first ${MAX_ARG_ROWS} values shown)`, ""]]
          : rows,
    },
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
