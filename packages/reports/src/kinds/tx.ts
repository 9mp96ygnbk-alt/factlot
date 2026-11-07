/**
 * tx_unequal_appraisal: an evidence packet (PDF) and the adjustment grid with live formulas
 * (XLSX, the layout and ReadMe wording of examples/reconciliation/tx_unequal_appraisal.py).
 * Arithmetic only: no recommendation, no opinion of value.
 */
import type { TxUnequalAppraisalInput } from "@factlot/calc";

import type { Block, Provenance, ReportDoc } from "../doc.ts";
import { appendBlocks, putLines } from "../doc.ts";
import { pct, roundInText, usd } from "../format.ts";
import type { TxResult } from "../validate.ts";
import { Workbook, addr, fx, range, type Sheet } from "../xlsx.ts";
import {
  closingBlocks,
  subtitle,
  warningsBlocks,
  type KindInput,
} from "./common.ts";

/** The disclaimer every Texas document carries, word for word. */
export const TX_DISCLAIMER =
  "Not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)); not legal or tax advice and not a substitute for the advice of an attorney.";

/** The notice of the reconciliation workbook (examples/reconciliation/tx_unequal_appraisal.py). */
export const NOTICE =
  "Evidence calculation only: arithmetic on the values and adjustments supplied. It is not an appraisal or an opinion " +
  "of value (Tex. Occ. Code §1103.003(1)), it is not legal or tax advice, and it is not a substitute for the advice " +
  "of an attorney. It does not say whether to protest or what value to claim. FactLot does not represent property owners.";

const NEXT_STEP =
  "To file, use the appraisal district's own protest process, yourself or through a property tax consultant registered " +
  "with the Texas Department of Licensing and Regulation, or an attorney.";

export const CONVENTIONS = [
  "Normalization: with normalize_by set to an area, each comparable becomes value ÷ its area × the subject's same area, " +
    "rounded to the cent. With none, the comparable's value is used whole.",
  "Percentage adjustments are decimals (0.05 = +5%). sum adds a comparable's percentages and applies 1 + total once; " +
    "compound multiplies (1 + each). The factor is rounded to 6 decimals, then normalized × factor is rounded to the cent.",
  "USD amount adjustments, then $/SF adjustments × the subject's normalizing area, are added after the percentages; " +
    "the adjusted value is rounded to the cent.",
  "The median is Excel's MEDIAN of the adjusted values: the middle value, or for an even count the mean of the two " +
    "middle values, rounded to the cent. Subject minus median is in USD and as a share of the median (6 decimals).",
  "Every adjustment and its reason is the user's (or their consultant's or attorney's). The workbook does not choose " +
    "comparables or adjustments.",
];

const EVIDENCE_KEYS = ["document_id", "locator", "as_of", "fact_id"] as const;
const EVIDENCE_HEADERS = [
  "Source document ID",
  "Locator in source",
  "As of",
  "Fact ID",
];

type Comp = TxResult["value"]["comparables"][number];
type Cite = NonNullable<Comp["citation"]>;

const nameOf = (c: Comp) => c.id ?? `#${c.index + 1}`;

/** The result's citation, else one the caller supplied in context. */
function citationOf(
  c: Comp,
  k: KindInput,
): { cite: Cite | null; supplied: Cite | null } {
  const supplied = k.ctx.comparable_citations?.[nameOf(c)] ?? null;
  return { cite: c.citation, supplied };
}

/** The caller's title and prepared-for line, labelled as theirs. */
export function callerLines(k: KindInput): string[] {
  return [
    ...(k.ctx.title ? [`Title (supplied by the caller): ${k.ctx.title}`] : []),
    ...(k.ctx.prepared_for
      ? [`Prepared for (supplied by the caller): ${k.ctx.prepared_for}`]
      : []),
  ];
}

type Named = { label?: unknown; address?: unknown };
const textOf = (x: unknown): string | undefined =>
  typeof x === "string" && x.trim() ? x : undefined;

/** A comparable's caller-supplied label and address (from the result, else the arguments). */
export function compNames(
  c: Comp,
  args: unknown,
): { label?: string; address?: string } {
  const a = (args as { comparables?: Named[] } | undefined)?.comparables?.[
    c.index
  ];
  const label = textOf((c as Named).label) ?? textOf(a?.label);
  const address = textOf((c as Named).address) ?? textOf(a?.address);
  return {
    ...(label ? { label } : {}),
    ...(address ? { address } : {}),
  };
}

function subjectLabel(r: TxResult, args: unknown): string | undefined {
  return (
    textOf((r.value as { subject_label?: unknown }).subject_label) ??
    textOf((args as { subject?: Named } | undefined)?.subject?.label)
  );
}

function subjectAddress(r: TxResult, args: unknown): string | undefined {
  return (
    textOf((r.value as { subject_address?: unknown }).subject_address) ??
    textOf((args as { subject?: Named } | undefined)?.subject?.address)
  );
}

/** "C-1 (Oak Plaza, 100 Main St)" when a label or address was supplied. */
function displayName(c: Comp, args: unknown): string {
  const n = compNames(c, args);
  const extra = [n.label, n.address].filter(Boolean).join(", ");
  return extra ? `${nameOf(c)} (${extra})` : nameOf(c);
}

/**
 * What a statute covers, as the report prints it. Two of the tool's descriptions are restated
 * here: §41.66(l) from the statute's words, and §42.26(d) with which text a report of this tax
 * year is printed against.
 */
export function lawCovers(
  l: { section: string; covers: string },
  taxYear: number,
): string {
  if (l.section.includes("41.66(l)"))
    return "a property owner, attorney or agent offering evidence or argument in a protest under §41.41(a)(1) or (2) (value or unequal appraisal) is not subject to Occupations Code ch. 1103 (real estate appraisers) unless presenting as a licensed or certified appraiser; a license holder states the capacity in which they appear";
  if (l.section.includes("42.26(d)")) {
    const base = l.covers.replace(
      /;\s*the text in effect from 2027-01-01.*$/,
      "",
    );
    return taxYear < 2027
      ? `${base}. This report is for tax year ${taxYear}: the text in effect until 2026-12-31 covers property under the §23.23 residence homestead limitation or the §23.231 limitation on other real property; the text in effect from 2027-01-01 refers only to a residence homestead under §23.23. Which text governs a particular appeal is a legal question.`
      : `${base}. The text in effect from 2027-01-01 refers only to a residence homestead under §23.23 (the earlier text also covered the §23.231 limitation on other real property).`;
  }
  return l.covers;
}

function areaWord(by: string): string {
  return by === "improvement_area_sf"
    ? "improvement area"
    : by === "land_area_sf"
      ? "land area"
      : "none";
}

export function txDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as TxResult;
  const v = r.value;
  const txArgs = k.checked.args as Args | undefined;
  const subjArea =
    txArgs && v.normalize_by !== "none"
      ? areaOf(txArgs.subject, v.normalize_by)
      : undefined;
  const compArea = (c: Comp) =>
    txArgs && v.normalize_by !== "none"
      ? (areaOf(txArgs.comparables[c.index] ?? {}, v.normalize_by) ?? null)
      : null;
  const subjectName = [
    v.subject_id ?? "the subject (no id given)",
    [subjectLabel(r, k.checked.args), subjectAddress(r, k.checked.args)]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(": ");
  const blocks: Block[] = [];
  blocks.push({ t: "notice", text: TX_DISCLAIMER });
  blocks.push({
    t: "notice",
    text: "Evidence calculation only: the arithmetic of Tex. Tax Code §41.43(b)(3) and §42.26(a)(3) on the comparables and adjustments supplied. It does not say whether to protest or what value to claim, and FactLot did not choose the comparables, values or adjustments. FactLot does not represent property owners.",
  });

  blocks.push({ t: "heading", text: "Summary" });
  blocks.push({
    t: "kv",
    rows: [
      { label: "Subject", value: subjectName, fmt: "text" },
      { label: "Tax year", value: String(v.tax_year), fmt: "text" },
      {
        label: `Subject value (${v.subject_value_basis})`,
        value: v.subject_value,
        fmt: "usd",
      },
      { label: "Comparables", value: v.comparables_count, fmt: "int" },
      {
        label: "Median adjusted value of the comparables",
        value: v.median_adjusted_value,
        fmt: "usd",
      },
      ...(v.median_pair
        ? [
            {
              label: "Two middle values (even count; the median is their mean)",
              value: `${usd(v.median_pair[0])} and ${usd(v.median_pair[1])}`,
              fmt: "text" as const,
            },
          ]
        : []),
      {
        label: "Subject value minus median",
        value: v.subject_minus_median,
        fmt: "usd",
      },
      {
        label: "Subject value minus median, share of the median",
        value: v.subject_minus_median_pct,
        fmt: "pct",
      },
      { label: "Normalized by", value: areaWord(v.normalize_by), fmt: "text" },
      ...(subjArea !== undefined
        ? [
            {
              label: `Subject ${areaWord(v.normalize_by)} (SF), the normalizing area`,
              value: subjArea,
              fmt: "int" as const,
            },
          ]
        : []),
      {
        label: "Percentage adjustments",
        value: v.adjustment_combine === "sum" ? "summed" : "compounded",
        fmt: "text",
      },
    ],
  });
  if (k.ctx.subject_citation) {
    blocks.push({
      t: "subheading",
      text: "Subject value source (supplied by the caller)",
    });
    blocks.push({
      t: "kv",
      rows: EVIDENCE_KEYS.filter((key) => k.ctx.subject_citation?.[key]).map(
        (key, i) => ({
          label: EVIDENCE_HEADERS[EVIDENCE_KEYS.indexOf(key)] ?? String(i),
          value: k.ctx.subject_citation![key]!,
          fmt: "text" as const,
        }),
      ),
    });
  }

  blocks.push({ t: "heading", text: "Comparables grid" });
  blocks.push({
    t: "para",
    grey: true,
    text: "Supplied by the caller: the comparables, their ids and values, the adjustments with their labels and reasons, and the citations. FactLot computed the rest.",
  });
  const norm = v.normalize_by !== "none";
  const areas = norm && subjArea !== undefined;
  blocks.push({
    t: "table",
    size: 7,
    columns: [
      { header: "Comparable", fmt: "text", width: 1.5 },
      { header: "Roll value", fmt: "usd", width: 1.35 },
      { header: "Basis", fmt: "text", width: 0.85 },
      ...(areas
        ? [{ header: "Area (SF)", fmt: "int" as const, width: 0.8 }]
        : []),
      { header: norm ? "Normalized" : "Value used", fmt: "usd", width: 1.35 },
      { header: "% factor", fmt: "factor", width: 0.85 },
      { header: "After %", fmt: "usd", width: 1.35 },
      { header: "USD and $/SF adj.", fmt: "usd", width: 1.2 },
      { header: "Adjusted value", fmt: "usd", width: 1.4 },
      { header: "Total adj.", fmt: "pct", width: 0.9 },
      ...(norm
        ? [{ header: "Adjusted $/SF", fmt: "usd" as const, width: 0.95 }]
        : []),
    ],
    rows: v.comparables.map((c) => [
      displayName(c, k.checked.args),
      c.value,
      c.value_basis,
      ...(areas ? [compArea(c)] : []),
      c.normalized_value,
      c.percent_factor,
      c.after_percent_value,
      c.amount_adjustments_total,
      c.adjusted_value,
      c.total_adjustment_pct,
      ...(norm ? [c.adjusted_value_psf] : []),
    ]),
  });

  blocks.push({
    t: "heading",
    text: "Adjustments and reasons (supplied by the caller)",
  });
  const adj = v.comparables.flatMap((c) =>
    c.adjustments.map((a) => [
      nameOf(c),
      a.kind,
      a.label,
      a.kind === "percent"
        ? pct(a.value)
        : a.kind === "psf"
          ? `${usd(a.value)}/SF`
          : usd(a.value),
      a.reason,
    ]),
  );
  blocks.push(
    adj.length
      ? {
          t: "table",
          size: 7.5,
          columns: [
            { header: "Comparable", fmt: "text", width: 1.3 },
            { header: "Kind", fmt: "text", width: 0.8 },
            { header: "Label", fmt: "text", width: 1.1 },
            { header: "Adjustment", fmt: "text", width: 1.1 },
            { header: "Reason", fmt: "text", width: 3.6 },
          ],
          rows: adj,
        }
      : { t: "para", text: "No adjustments were applied.", grey: true },
  );

  blocks.push({
    t: "heading",
    text: "Adjusted values in ascending order and the median",
  });
  const order = [...v.comparables].sort(
    (a, b) => a.adjusted_value - b.adjusted_value || a.index - b.index,
  );
  const n = order.length;
  const mids = n % 2 ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
  blocks.push({
    t: "table",
    size: 8,
    bold: mids,
    columns: [
      { header: "Position", fmt: "int", width: 0.7 },
      { header: "Comparable", fmt: "text", width: 2 },
      { header: "Adjusted value", fmt: "usd", width: 1.4 },
      { header: "", fmt: "text", width: 1.6 },
    ],
    rows: order.map((c, i) => [
      i + 1,
      displayName(c, k.checked.args),
      v.sorted_adjusted_values[i] ?? c.adjusted_value,
      mids.includes(i) ? (n % 2 ? "the median" : "middle value") : "",
    ]),
  });
  blocks.push({
    t: "kv",
    rows: [
      {
        label: "Median adjusted value",
        value: v.median_adjusted_value,
        fmt: "usd",
        note: "the comparison figure in Tax Code §41.43(b)(3) and §42.26(a)(3)",
      },
      { label: "Subject value", value: v.subject_value, fmt: "usd" },
      {
        label: "Subject value minus median",
        value: v.subject_minus_median,
        fmt: "usd",
      },
      {
        label: "Subject value minus median, share of the median",
        value: v.subject_minus_median_pct,
        fmt: "pct",
      },
    ],
  });

  blocks.push(...warningsBlocks(r.warnings));

  blocks.push({ t: "heading", text: "Citations (supplied by the caller)" });
  const citeRows: (string | null)[][] = [];
  if (k.ctx.subject_citation)
    citeRows.push([
      v.subject_id ? `${v.subject_id} (subject)` : "Subject",
      "supplied",
      ...EVIDENCE_KEYS.map((key) => k.ctx.subject_citation?.[key] ?? ""),
    ]);
  for (const c of v.comparables) {
    const { cite, supplied } = citationOf(c, k);
    if (cite)
      citeRows.push([
        nameOf(c),
        "in the result",
        ...EVIDENCE_KEYS.map((key) => cite[key] ?? ""),
      ]);
    if (supplied)
      citeRows.push([
        nameOf(c),
        "supplied",
        ...EVIDENCE_KEYS.map((key) => supplied[key] ?? ""),
      ]);
    if (!cite && !supplied)
      citeRows.push([nameOf(c), "none given", "", "", "", ""]);
  }
  blocks.push({
    t: "table",
    size: 7,
    columns: [
      { header: "Property", fmt: "text", width: 1.2 },
      { header: "Citation", fmt: "text", width: 0.8 },
      { header: "Source document ID", fmt: "text", width: 2 },
      { header: "Locator in source", fmt: "text", width: 1.6 },
      { header: "As of", fmt: "text", width: 0.8 },
      { header: "Fact ID", fmt: "text", width: 1.6 },
    ],
    rows: citeRows,
  });

  blocks.push({ t: "heading", text: "Statutes cited" });
  blocks.push({
    t: "table",
    size: 7.5,
    columns: [
      { header: "Section", fmt: "text", width: 1.4 },
      { header: "What it covers", fmt: "text", width: 3.4 },
      { header: "Source (URL)", fmt: "text", width: 2 },
    ],
    rows: v.law.map((l) => [l.section, lawCovers(l, v.tax_year), l.url]),
  });

  blocks.push({ t: "heading", text: "Conventions (stated, not hidden)" });
  blocks.push({ t: "bullets", items: CONVENTIONS });
  blocks.push(...closingBlocks(k, "calc_tx_unequal_appraisal", r.steps));

  return {
    title: k.ctx.title ?? `Unequal-appraisal evidence, tax year ${v.tax_year}`,
    subtitle: subtitle(
      [
        v.subject_id ? `Subject ${v.subject_id}` : undefined,
        `${v.comparables_count} comparables`,
        "Tex. Tax Code §41.43(b)(3), §42.26(a)(3)",
      ],
      k.ctx,
    ),
    blocks,
    readme: [],
  };
}

// --- the workbook -------------------------------------------------------------------------------

type Args = TxUnequalAppraisalInput;

class Recon {
  readonly sh: Sheet;
  row = 7;
  readonly first = 7;
  constructor(wb: Workbook) {
    const sh = (this.sh = wb.sheet("Reconcile"));
    [46, 12, 22, 22, 14, 12, 28, 40].forEach((w, i) => sh.width(i + 1, w));
    sh.put(1, 1, "Reconciliation: Excel formulas vs FactLot output", "title");
    sh.put(
      2,
      1,
      "Inputs as supplied. Excel column = live formulas on the Grid sheet. FactLot column = the number FactLot returned (recorded).",
      "note",
    );
    [
      "Output",
      "Unit",
      "Excel (live formula)",
      "FactLot (recorded)",
      "Difference",
      "Status",
      "FactLot field",
      "Tolerance / note",
    ].forEach((h, i) => sh.put(6, i + 1, h, "header"));
  }
  section(label: string): void {
    this.sh.put(this.row++, 1, label, "bold");
  }
  add(
    label: string,
    unit: string,
    ref: string,
    factlot: number,
    field: string,
    style: "money" | "num6" = "money",
    dp = 8,
  ): void {
    const sh = this.sh;
    const r = this.row++;
    sh.put(r, 1, label, "text");
    sh.put(r, 2, unit, "text");
    sh.put(r, 3, fx(`=${ref}`), style);
    sh.put(r, 4, factlot, style === "money" ? "fl_money" : "fl_num6");
    sh.put(r, 5, fx(`=ROUND(${addr(r, 3)}-${addr(r, 4)},${dp})`), "diff");
    sh.put(r, 6, fx(`=IF(${addr(r, 5)}=0,"match","DIFFERENT")`), "bold");
    sh.put(r, 7, field, "note");
    sh.put(r, 8, `rounded to ${dp} decimals`, "note");
  }
  finish(): void {
    const last = this.row - 1;
    this.sh.put(3, 1, "Rows compared", "bold");
    this.sh.put(
      3,
      3,
      fx(
        `=COUNTIF(F${this.first}:F${last},"match")+COUNTIF(F${this.first}:F${last},"DIFFERENT")`,
      ),
      "int",
    );
    this.sh.put(4, 1, "Rows that differ", "bold");
    this.sh.put(
      4,
      3,
      fx(`=COUNTIF(F${this.first}:F${last},"DIFFERENT")`),
      "int",
    );
    this.sh.freeze = "A7";
  }
}

function areaOf(
  x: { improvement_area_sf?: number; land_area_sf?: number },
  by: string,
): number | undefined {
  return by === "improvement_area_sf"
    ? x.improvement_area_sf
    : by === "land_area_sf"
      ? x.land_area_sf
      : undefined;
}

function gridSheet(
  wb: Workbook,
  rec: Recon,
  r: TxResult,
  args: Args | undefined,
  k: KindInput,
): void {
  const v = r.value;
  const by = v.normalize_by;
  const comps = v.comparables;
  const subjArea = args && by !== "none" ? areaOf(args.subject, by) : undefined;
  // With the arguments, the grid normalizes from each comparable's area like the example; with
  // only the result, the normalized value is the tool's figure, entered as an input.
  const fromArgs =
    args !== undefined && (by === "none" || subjArea !== undefined);
  const count = (c: Comp, kind: string) =>
    c.adjustments.filter((a) => a.kind === kind).length;
  const kmax = Math.max(0, ...comps.map((c) => count(c, "percent")));
  const amax = Math.max(0, ...comps.map((c) => count(c, "amount")));
  const pmax = Math.max(0, ...comps.map((c) => count(c, "psf")));
  const psfAsTotal = !fromArgs && pmax > 0;

  const sh = wb.sheet("Grid");
  const title = `Unequal-appraisal arithmetic, tax year ${v.tax_year}`;

  const headers = [
    "Comparable",
    "Value",
    "Basis",
    ...(by !== "none" && fromArgs ? ["Area (SF)"] : []),
    by !== "none" && !fromArgs ? "Normalized (FactLot)" : "Normalized",
  ];
  headers.push(
    ...Array.from({ length: kmax }, (_, i) => `% adj ${i + 1}`),
    "Factor",
    "After %",
  );
  if (psfAsTotal) headers.push("USD and $/SF adj (FactLot total)");
  else
    headers.push(
      ...Array.from({ length: amax }, (_, i) => `USD adj ${i + 1}`),
      ...Array.from({ length: pmax }, (_, i) => `$/SF adj ${i + 1}`),
      ...(pmax ? ["$/SF adj total (USD)"] : []),
    );
  headers.push("Adjusted", "Total adj %");
  const psfCol = subjArea !== undefined && by !== "none";
  if (psfCol) headers.push("Adjusted $/SF");
  const evidenceStart = headers.length + 1;
  headers.push(...EVIDENCE_HEADERS);
  const named = comps.map((c) => compNames(c, args));
  const namesStart = headers.length + 1;
  const hasNames = named.some((n) => n.label || n.address);
  if (hasNames)
    headers.push(
      "Label (supplied by the caller)",
      "Address (supplied by the caller)",
    );
  const hr = 8;
  headers.forEach((h, i) => {
    sh.put(hr, i + 1, h, "header");
    sh.width(i + 1, i === 0 ? 22 : i + 1 >= evidenceStart ? 28 : 14);
    if (i + 1 >= namesStart && hasNames) sh.width(i + 1, 36);
  });
  // The rows above the grid have explicit heights and the long texts are merged across the
  // grid's width, so Excel never autofits them tall: only the header row and the id column
  // stay frozen, with a short block above.
  const across = Math.max(8, Math.min(headers.length, 14));
  sh.put(1, 1, title, "title");
  sh.height(1, 20);
  sh.banner(
    2,
    1,
    across,
    "Blue on yellow = inputs; the rest are live formulas. " + NOTICE,
    "warn",
  );
  const supplied = callerLines(k);
  if (supplied.length) sh.banner(3, 1, across, supplied.join(" | "), "note");
  sh.put(4, 1, "Subject id", "text");
  sh.put(4, 2, v.subject_id ?? "", "in_text");
  sh.put(4, 3, "Tax year", "text");
  sh.put(4, 4, String(v.tax_year), "in_text");
  const subjName = [subjectLabel(r, args), subjectAddress(r, args)]
    .filter(Boolean)
    .join(", ");
  if (subjName) {
    sh.put(4, 5, "Subject (supplied by the caller)", "text");
    sh.put(4, 7, subjName, "in_text");
  }
  sh.put(5, 1, "Subject value", "text");
  const subjValue = sh.put(5, 2, v.subject_value, "in_money");
  sh.put(5, 3, v.subject_value_basis, "in_text");
  let subjAreaRef: string | undefined;
  if (by !== "none" && subjArea !== undefined) {
    sh.put(
      6,
      1,
      `Subject ${by.replace("_sf", "").replace(/_/g, " ")} (SF)`,
      "text",
    );
    subjAreaRef = sh.put(6, 2, subjArea, "in_int");
  }
  for (const row of [4, 5, 6]) sh.height(row, 15);
  sh.banner(
    7,
    1,
    across,
    `Normalize by: ${by}. Percentages: ${v.adjustment_combine}.` +
      (by !== "none" && !fromArgs
        ? " Normalized values are FactLot's (the areas were not sent with the request)."
        : "") +
      (psfAsTotal
        ? " $/SF adjustments are in FactLot's amount total (the subject's area was not sent)."
        : ""),
    "note",
  );
  sh.freeze = `B${hr + 1}`;
  sh.landscape = true;

  const adjustedRefs: string[] = [];
  let row = hr + 1;
  comps.forEach((c, ci) => {
    const argComp = args?.comparables[ci];
    let col = 1;
    sh.put(row, col++, nameOf(c), "in_text");
    const val = sh.put(row, col++, c.value, "in_money");
    sh.put(row, col++, c.value_basis, "in_text");
    let norm: string;
    if (by !== "none" && fromArgs) {
      const area = sh.put(row, col++, areaOf(argComp ?? {}, by) ?? 0, "in_int");
      norm = sh.put(
        row,
        col++,
        fx(`=ROUND(${val}/${area}*${subjAreaRef},2)`),
        "money",
      );
    } else if (by !== "none")
      norm = sh.put(row, col++, c.normalized_value, "in_money");
    else norm = sh.put(row, col++, fx(`=ROUND(${val},2)`), "money");
    const pcts = c.adjustments.filter((a) => a.kind === "percent");
    const pref: string[] = [];
    for (let i = 0; i < kmax; i++)
      pref.push(
        sh.put(row, col++, i < pcts.length ? pcts[i]!.value : 0, "in_pct2"),
      );
    const ftxt = !pref.length
      ? "=ROUND(1,6)"
      : v.adjustment_combine === "sum"
        ? `=ROUND(1+SUM(${range(pref[0]!, pref[pref.length - 1]!)}),6)`
        : `=ROUND(PRODUCT(${pref.map((p) => `1+${p}`).join(",")}),6)`;
    const factor = sh.put(row, col++, fx(ftxt), "num6");
    const after = sh.put(
      row,
      col++,
      fx(`=ROUND(${norm}*${factor},2)`),
      "money",
    );
    let expr = after;
    if (psfAsTotal) {
      const t = sh.put(row, col++, c.amount_adjustments_total, "in_money");
      expr += `+${t}`;
    } else {
      const amts = c.adjustments.filter((a) => a.kind === "amount");
      const aref: string[] = [];
      for (let i = 0; i < amax; i++)
        aref.push(
          sh.put(row, col++, i < amts.length ? amts[i]!.value : 0, "in_money"),
        );
      const psfs = c.adjustments.filter((a) => a.kind === "psf");
      const sref: string[] = [];
      for (let i = 0; i < pmax; i++)
        sref.push(
          sh.put(row, col++, i < psfs.length ? psfs[i]!.value : 0, "in_num4"),
        );
      if (aref.length)
        expr += `+SUM(${range(aref[0]!, aref[aref.length - 1]!)})`;
      if (sref.length) {
        const psfTotal = sh.put(
          row,
          col++,
          fx(
            `=ROUND(SUM(${range(sref[0]!, sref[sref.length - 1]!)})*${subjAreaRef},2)`,
          ),
          "money",
        );
        expr += `+${psfTotal}`;
      }
    }
    const adjusted = sh.put(row, col++, fx(`=ROUND(${expr},2)`), "money");
    sh.put(row, col++, fx(`=ROUND(${adjusted}/${norm}-1,6)`), "pct2");
    adjustedRefs.push(adjusted);
    const psf = psfCol
      ? sh.put(row, col, fx(`=ROUND(${adjusted}/${subjAreaRef},2)`), "money")
      : undefined;
    if (named[ci]?.label) sh.put(row, namesStart, named[ci].label, "in_text");
    if (named[ci]?.address)
      sh.put(row, namesStart + 1, named[ci].address, "in_text");
    const { cite, supplied } = citationOf(c, k);
    const evidence = cite ?? supplied;
    EVIDENCE_KEYS.forEach((key, i) => {
      if (evidence?.[key])
        sh.put(row, evidenceStart + i, String(evidence[key]), "in_text");
    });
    const name = nameOf(c);
    if (by !== "none" && fromArgs)
      rec.add(
        `${name}: normalized value`,
        "USD",
        norm,
        c.normalized_value,
        "normalized_value",
      );
    rec.add(
      `${name}: percentage factor`,
      "factor",
      factor,
      c.percent_factor,
      "percent_factor",
      "num6",
      6,
    );
    rec.add(
      `${name}: adjusted value`,
      "USD",
      adjusted,
      c.adjusted_value,
      "adjusted_value",
    );
    if (psf && c.adjusted_value_psf !== null)
      rec.add(
        `${name}: adjusted $/SF`,
        "USD/SF",
        psf,
        c.adjusted_value_psf,
        "adjusted_value_psf",
      );
    row++;
  });

  row++;
  const all = range(adjustedRefs[0]!, adjustedRefs[adjustedRefs.length - 1]!);
  sh.put(row, 1, "Median adjusted value", "bold");
  const median = sh.put(row, 2, fx(`=ROUND(MEDIAN(${all}),2)`), "money");
  sh.put(
    row,
    3,
    "the comparison figure in Tax Code §41.43(b)(3) and §42.26(a)(3)",
    "note",
  );
  sh.put(row + 1, 1, "Subject value minus median", "bold");
  const diff = sh.put(
    row + 1,
    2,
    fx(`=ROUND(${subjValue}-${median},2)`),
    "money",
  );
  sh.put(row + 2, 1, "Subject value minus median, share of median", "bold");
  const share = sh.put(row + 2, 2, fx(`=ROUND(${diff}/${median},6)`), "num6");
  rec.add(
    "Median adjusted value",
    "USD",
    median,
    v.median_adjusted_value,
    "median_adjusted_value",
  );
  rec.add(
    "Subject value minus median",
    "USD",
    diff,
    v.subject_minus_median,
    "subject_minus_median",
  );
  rec.add(
    "Subject minus median, share of median",
    "ratio",
    share,
    v.subject_minus_median_pct,
    "subject_minus_median_pct",
    "num6",
    6,
  );

  row += 4;
  sh.put(row++, 1, "Adjustments and reasons (supplied by the caller)", "bold");
  ["Comparable", "Kind", "Label", "Value", "Reason"].forEach((h, i) =>
    sh.put(row, i + 1, h, "header"),
  );
  row++;
  for (const c of comps)
    for (const a of c.adjustments) {
      sh.put(row, 1, nameOf(c), "text");
      sh.put(row, 2, a.kind, "text");
      sh.put(row, 3, a.label, "text");
      sh.put(row, 4, a.value, a.kind === "amount" ? "money" : "num4");
      sh.put(row, 5, a.reason, "text");
      row++;
    }
  row++;
  sh.put(row++, 1, "FactLot warnings", "bold");
  if (!r.warnings.length) sh.put(row++, 1, "none", "note");
  for (const w of r.warnings) sh.put(row++, 1, w, "note");
}

function userReadme(
  wb: Workbook,
  r: TxResult,
  p: Provenance,
  fromArgs: boolean,
  k: KindInput,
): void {
  const v = r.value;
  const sh = wb.sheet("ReadMe");
  sh.width(1, 120);
  sh.put(1, 1, `Unequal-appraisal arithmetic, tax year ${v.tax_year}`, "title");
  sh.banner(2, 1, 1, NOTICE, "warn");
  let row = putLines(sh, 3, callerLines(k), "note");
  row++;
  sh.put(row++, 1, "What this workbook is", "bold");
  row = putLines(sh, row, [
    "The arithmetic of Tax Code §41.43(b)(3) and §42.26(a)(3) on the comparables and adjustments you chose, " +
      "reconciled to calc_tx_unequal_appraisal with zero difference.",
    "FactLot did not choose the comparables, the values or the adjustments: they are the ones in the " +
      (fromArgs ? "arguments" : "result") +
      " this workbook was built from.",
  ]);
  row++;
  sh.put(row, 1, "Sheets", "bold");
  row = putLines(sh, row + 1, [
    "Grid: the subject (id, tax year, value), each comparable's value, adjustments and adjusted value, then the " +
      "median and the subject's value minus the median. Blue on yellow cells are your inputs; the rest are live Excel " +
      "formulas. The last columns carry each comparable's source (document ID, locator, as-of date, fact ID) as you " +
      "supplied it; a blank means the input gave none. The adjustments and their reasons are listed below the grid.",
    "Reconcile: the Excel figures beside the numbers FactLot returned for the same inputs, with a Difference column " +
      "and a Status. Difference is ROUND(Excel - FactLot, n), n shown in the Tolerance column; 0 means the two agree.",
    "If you change an input on Grid, the FactLot column on Reconcile does not change (it is a recorded output); " +
      "call calc_tx_unequal_appraisal again to refresh it.",
    "Steps: the tool's audit trail. Law: the statutes the tool cites. Provenance: how the figures were " +
      "reached (FactLot's run of the tool on the arguments, listed on Inputs as sent) and when.",
  ]);
  row++;
  sh.put(row, 1, `FactLot version ${p.version}. Calculator reconciled`, "bold");
  sh.put(
    row + 1,
    1,
    `calc_tx_unequal_appraisal  (${r.formula.id}@${r.formula.version})`,
    "text",
  );
  row += 3;
  sh.put(row, 1, "Conventions (stated, not hidden)", "bold");
  row = putLines(sh, row + 1, CONVENTIONS);
  row++;
  sh.put(row, 1, "Notes", "bold");
  row = putLines(sh, row + 1, [NEXT_STEP, TX_DISCLAIMER]);
  row++;
  sh.put(row, 1, p.footer, "note");
}

export async function txXlsx(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as TxResult;
  const args = k.checked.args as Args | undefined;
  const v = r.value;
  const wb = new Workbook({
    title: `Unequal-appraisal arithmetic, tax year ${v.tax_year}`,
    creator: `FactLot ${k.p.version}`,
    created: k.p.generatedAt.toISOString().replace(/\.\d+Z$/, "Z"),
    footer: k.p.footer,
  });
  userReadme(wb, r, k.p, args !== undefined, k);
  const rec = new Recon(wb);
  rec.section(`Unequal-appraisal arithmetic, tax year ${v.tax_year}`);
  gridSheet(wb, rec, r, args, k);
  rec.finish();

  const steps = wb.sheet("Steps");
  [44, 20, 10, 90].forEach((w, i) => steps.width(i + 1, w));
  steps.put(1, 1, "Audit trail: calc_tx_unequal_appraisal steps", "title");
  ["Step", "Value", "Unit", "How it was reached"].forEach((h, i) =>
    steps.put(3, i + 1, h, "header"),
  );
  r.steps.forEach((s, i) => {
    steps.put(4 + i, 1, roundInText(s.label), "text");
    steps.put(
      4 + i,
      2,
      typeof s.value === "number" ? s.value : roundInText(s.value),
      typeof s.value === "number"
        ? s.unit === "USD"
          ? "money"
          : Number.isInteger(s.value)
            ? "int"
            : "num_s"
        : "text",
    );
    steps.put(4 + i, 3, s.unit ?? "", "text");
    steps.put(4 + i, 4, roundInText(s.formula ?? ""), "text");
  });
  steps.put(
    5 + r.steps.length,
    1,
    "Each cell holds the tool's full number; the text in How it was reached shows money to the cent and long decimals to 6 significant digits.",
    "note",
  );
  steps.freeze = "A4";

  const law = wb.sheet("Law");
  [34, 90, 60].forEach((w, i) => law.width(i + 1, w));
  law.put(1, 1, "Statutes cited by calc_tx_unequal_appraisal", "title");
  ["Section", "What it covers", "Source (URL)"].forEach((h, i) =>
    law.put(3, i + 1, h, "header"),
  );
  v.law.forEach((l, i) => {
    law.put(4 + i, 1, l.section, "text");
    law.put(4 + i, 2, lawCovers(l, v.tax_year), "text");
    law.put(4 + i, 3, l.url, "text");
  });

  // How the figures were reached: the input check, the arguments as sent, provenance.
  const prov = wb.sheet("Provenance");
  [46, 22, 60].forEach((w, i) => prov.width(i + 1, w));
  prov.put(1, 1, "Input check and provenance", "title");
  appendBlocks(
    wb,
    prov,
    2,
    closingBlocks(k, "calc_tx_unequal_appraisal"),
    `Unequal-appraisal arithmetic, tax year ${v.tax_year}`,
    new Map(),
  );
  return wb.bytes();
}
