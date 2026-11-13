/**
 * @factlot/reports: client-ready XLSX, PDF and ICS documents from FactLot tool results.
 *
 * Deterministic and model-free. A calculator report is a layout of FactLot's own run of the
 * tool on the arguments sent (a result sent alongside is only compared, never used). A lease
 * abstract is built from the documents' text when sent, else from a supplied result that is
 * checked and labelled as the caller's on every page. Apart from the generation time printed in
 * the footer (and an ICS file's DTSTAMP), the same request gives the same bytes.
 */
import { CATALOG_VERSION, getTool } from "@factlot/tools";
import { z } from "zod";

import {
  renderPdf,
  renderXlsx,
  type Provenance,
  type ReportDoc,
} from "./doc.ts";
import { slug, utcStamp } from "./format.ts";
import { checkCallerText } from "./text.ts";
import {
  LEASE_COMPUTED_LABEL,
  ReportContext,
  SUPPLIED_LABEL,
  type KindInput,
} from "./kinds/common.ts";
import {
  asc842Doc,
  camDoc,
  dcfDoc,
  debtDoc,
  proposalsDoc,
} from "./kinds/finance.ts";
import { datesDoc, datesIcs, leaseDoc } from "./kinds/lease.ts";
import { protestDoc, protestIcs } from "./kinds/protest.ts";
import {
  parcelRecord,
  propertySheetDoc,
  sheetSubject,
  type RegistryLookup,
} from "./kinds/sheet.ts";
import { TX_DISCLAIMER, txDoc, txXlsx } from "./kinds/tx.ts";
import {
  COMPUTED_KINDS,
  KIND_FORMATS,
  KIND_TOOLS,
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORTS_DOCS,
  REGISTRY_KINDS,
  ReportInputError,
  TOOLS_URL,
  checkInput,
  issueMessage,
  type ReportFormat,
  type TxResult,
  type ReportKind,
} from "./validate.ts";

export {
  COMPUTED_KINDS,
  KIND_FORMATS,
  KIND_TOOLS,
  REGISTRY_KINDS,
  REPORT_FORMATS,
  REPORT_KINDS,
  ReportContext,
  ReportInputError,
  type ReportFormat,
  type ReportKind,
};
export { jsonEqual } from "./validate.ts";
export { unzip } from "./zip.ts";
export { TX_DISCLAIMER } from "./kinds/tx.ts";
export { TX_SOFTWARE } from "./kinds/protest.ts";
export {
  ENTITY_NOT_PRINTED,
  SHEET_CONTACT,
  SHEET_CONTACT_LINE,
  OWNER_NOT_ORGANISATION,
  OWNER_NOT_PUBLISHED,
  OWNER_PERSON_STYLE,
  SHEET_BOUNDARY,
  SHEET_FACTS,
  SHEET_PRICING_URL,
  type RegistryLookup,
  type SheetPlan,
} from "./kinds/sheet.ts";
export { PARCEL_URN } from "./validate.ts";

/** KV's largest value; a larger document is refused. */
export const MAX_REPORT_BYTES = 25 * 1024 * 1024;

/**
 * The Texas evidence packet (PDF) lays out at most this many comparables, each with at most
 * this many adjustments; the workbook takes the tool's full set (up to 200 comparables).
 */
export const TX_PDF_MAX_COMPARABLES = 60;
export const TX_PDF_MAX_ADJUSTMENTS = 10;

export const TERMS_URL = "https://factlot.com/terms";

export const CONTENT_TYPES: Record<ReportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  ics: "text/calendar; charset=utf-8",
};

export const KIND_TITLES: Record<ReportKind, string> = {
  tx_unequal_appraisal: "Texas unequal-appraisal evidence",
  lease_abstract: "Lease abstract",
  cam_reconciliation: "CAM reconciliation",
  debt_sizing: "Debt sizing",
  asc842_schedule: "ASC 842 schedule",
  compare_proposals: "Lease proposals compared",
  dcf_summary: "DCF summary",
  critical_dates: "Lease critical dates",
  tx_protest_deadline: "Texas protest deadline",
  property_sheet: "Property sheet",
};

export const ReportRequest = z.strictObject({
  kind: z.enum(REPORT_KINDS).describe("Which report."),
  format: z
    .enum(REPORT_FORMATS)
    .describe(
      "xlsx, pdf, or ics (critical_dates and tx_protest_deadline). tx_protest_deadline comes as ics or pdf; property_sheet as pdf or xlsx.",
    ),
  input: z
    .unknown()
    .optional()
    .describe(
      "lease_abstract only: the doc_abstract_lease result, used when arguments are not sent (each page then says the values are the caller's). For other kinds a result sent here is not used; the answer says whether it matches FactLot's run (result_mismatch).",
    ),
  arguments: z
    .unknown()
    .optional()
    .describe(
      "The tool's arguments. Required for every kind but lease_abstract: FactLot runs the tool on them and builds the document from that run only. tx_protest_deadline: rules_tx_property_tax_protest_deadline's (tax_year, notice_delivered_date?, as_of?), or with items the _batch rule's (items: [{id, tax_year, notice_delivered_date?}], as_of?). property_sheet: { urn } only, a parcel's FactLot ID; FactLot runs registry_get on it for the caller (gated and counted as the caller's lookup).",
    ),
  context: ReportContext.optional().describe(
    "Optional title, prepared-for line, and citations (text only).",
  ),
  include_past: z
    .boolean()
    .optional()
    .describe(
      "ics only: also put dates before today in the calendar (critical_dates: today in UTC; tx_protest_deadline: today in US Central time, and the passed tax year's dates beside next season's). By default they are left out.",
    ),
});
export type ReportRequest = z.input<typeof ReportRequest>;

export interface ReportFile {
  bytes: Uint8Array;
  filename: string;
  content_type: string;
  kind: ReportKind;
  format: ReportFormat;
  /** e.g. calc_debt_sizing@3 */
  source: string;
  /**
   * "computed": built from FactLot's run of the tool on the arguments. "supplied": a lease
   * abstract built from the result the caller sent (checked, not recomputed).
   */
  check: "computed" | "supplied";
  /** Present when a result was sent with the arguments: true when it differs from FactLot's run. */
  result_mismatch?: boolean;
  generated_at: string;
}

export interface CreateOptions {
  /** FactLot version printed in the footer (default: the tool catalog's). */
  version?: string;
  /** Generation time, ms since epoch (default: now). */
  now?: number;
  /**
   * property_sheet: the host's registry_get answer for the caller (gated for their plan). The
   * package never reads a registry; without this a property_sheet request is refused.
   */
  registry?: RegistryLookup;
}

/** The report request as JSON Schema (for the MCP tool), plus `inline`. */
export function reportRequestJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ReportRequest, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** The value at a path of a parsed JSON value (undefined when any step is missing). */
function at(v: unknown, path: readonly PropertyKey[]): unknown {
  let cur = v;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function issuesOf(err: z.ZodError, request: unknown) {
  return err.issues.slice(0, 20).map((i) => ({
    path: i.path.map(String).join("."),
    message:
      i.code !== "unrecognized_keys" &&
      i.path.length > 0 &&
      at(request, i.path) === undefined
        ? "missing: this field is required"
        : issueMessage(i.message),
  }));
}

/** Where to look for a kind's request shape and its tool's arguments. */
function schemaNext(kind?: ReportKind): string {
  const tools = kind ? KIND_TOOLS[kind].join(" or ") : undefined;
  return `fix the fields listed in issues and retry; the request shape is in ${REPORTS_DOCS}#what-a-report-accepts${tools ? `, and the arguments are ${tools}'s (its inputSchema in GET ${TOOLS_URL})` : ""}`;
}

/** A request that passed every input check, ready to render. */
export interface PreparedReport {
  kind: ReportKind;
  format: ReportFormat;
  ctx: ReportContext;
  checked: KindInput["checked"];
  include_past?: boolean;
}

/**
 * Check a request and compute (or check) its result: everything short of building the file.
 * Cheap next to rendering; throws ReportInputError for anything an agent can fix.
 */
export function prepareReport(
  request: unknown,
  opts: Pick<CreateOptions, "now"> = {},
): PreparedReport {
  const parsed = ReportRequest.safeParse(request);
  if (!parsed.success) {
    const r = request as { kind?: unknown } | null;
    const kind = REPORT_KINDS.find((k) => k === r?.kind);
    const issues = issuesOf(parsed.error, request).map((i) =>
      i.path === "format" && kind
        ? {
            ...i,
            message: `${i.message}; ${kind} comes as ${KIND_FORMATS[kind].join(", ")}`,
          }
        : i,
    );
    throw new ReportInputError(
      "InputError",
      issues.some((i) => i.message.startsWith("missing"))
        ? `invalid report request: missing ${issues
            .filter((i) => i.message.startsWith("missing"))
            .map((i) => i.path)
            .join(", ")}`
        : "invalid report request",
      issues,
      schemaNext(kind),
    );
  }
  const { kind, format, input, arguments: args } = parsed.data;
  const ctx = parsed.data.context ?? {};
  if (!KIND_FORMATS[kind].includes(format))
    throw new ReportInputError(
      "InputError",
      `${kind} reports come as ${KIND_FORMATS[kind].join(" or ")}, not ${format}`,
      [{ path: "format", message: `one of ${KIND_FORMATS[kind].join(", ")}` }],
      `send "format" as one of ${KIND_FORMATS[kind].map((f) => `"${f}"`).join(", ")}`,
    );
  if (REGISTRY_KINDS.includes(kind) && parsed.data.context !== undefined)
    throw new ReportInputError(
      "InputError",
      `${kind} takes no context: it prints only what the registry's answer holds`,
      [{ path: "context", message: `not accepted for ${kind}` }],
      'send only "kind", "format" and "arguments": { "urn": "fl:parcel:..." }',
    );
  checkCallerText(kind, ctx, args);
  const checked = checkInput(kind, input, args, opts.now ?? Date.now());
  if (kind === "tx_unequal_appraisal" && format === "pdf")
    txPdfLimits(checked.result as TxResult);
  return {
    kind,
    format,
    ctx,
    checked,
    ...(parsed.data.include_past ? { include_past: true } : {}),
  };
}

/** Refuse a Texas evidence packet too large to lay out as a PDF (413; the workbook takes it). */
function txPdfLimits(r: TxResult): void {
  const comps = r.value.comparables;
  const issues = [
    ...(comps.length > TX_PDF_MAX_COMPARABLES
      ? [
          {
            path: "arguments.comparables",
            message: `${comps.length} comparables; the PDF lays out at most ${TX_PDF_MAX_COMPARABLES}`,
          },
        ]
      : []),
    ...comps.flatMap((c, i) =>
      c.adjustments.length > TX_PDF_MAX_ADJUSTMENTS
        ? [
            {
              path: `arguments.comparables.${i}.adjustments`,
              message: `${c.adjustments.length} adjustments; the PDF lays out at most ${TX_PDF_MAX_ADJUSTMENTS} per comparable`,
            },
          ]
        : [],
    ),
  ];
  if (issues.length)
    throw new ReportInputError(
      "TooLarge",
      `a tx_unequal_appraisal PDF lays out at most ${TX_PDF_MAX_COMPARABLES} comparables with at most ${TX_PDF_MAX_ADJUSTMENTS} adjustments each; the xlsx workbook takes the full set (up to 200 comparables)`,
      issues.slice(0, 20),
      'ask for "format": "xlsx" (the adjustment-grid workbook takes every comparable and adjustment), or send fewer comparables or adjustments for the PDF',
    );
}

/** The parcel a registry kind looks up (undefined for every other kind). */
export function registryUrn(prepared: PreparedReport): string | undefined {
  return REGISTRY_KINDS.includes(prepared.kind)
    ? (prepared.checked.args as { urn: string }).urn
    : undefined;
}

/**
 * Attach the host's registry_get answer to a prepared registry kind. Throws (a fault, not the
 * caller's) when the answer is not the parcel asked for.
 */
export function attachRegistry(
  prepared: PreparedReport,
  lookup: RegistryLookup,
): PreparedReport {
  const urn = registryUrn(prepared);
  if (urn === undefined)
    throw new Error(`${prepared.kind} is not built from the registry`);
  parcelRecord(lookup.record, urn);
  return { ...prepared, checked: { ...prepared.checked, result: lookup } };
}

/** Build one document. Throws ReportInputError for anything an agent can fix. */
export async function createReport(
  request: unknown,
  opts: CreateOptions = {},
): Promise<ReportFile> {
  const prepared = prepareReport(request, opts);
  if (registryUrn(prepared) === undefined) return renderReport(prepared, opts);
  if (!opts.registry)
    throw new ReportInputError(
      "InputError",
      `${prepared.kind} is built by the hosted API from its registry (api.factlot.com): it is not available without one`,
      [{ path: "kind", message: "hosted only" }],
      "send this request to POST https://api.factlot.com/v1/reports or report_create on the hosted MCP server",
    );
  return renderReport(attachRegistry(prepared, opts.registry), opts);
}

/**
 * Build the file for a prepared request. A document over a size limit throws ReportInputError
 * (TooLarge); anything else thrown is a fault in FactLot, not in the request.
 */
export async function renderReport(
  prepared: PreparedReport,
  opts: CreateOptions = {},
): Promise<ReportFile> {
  const { kind, format, ctx, checked } = prepared;
  if (REGISTRY_KINDS.includes(kind) && checked.result === undefined)
    throw new Error(`${kind}: no registry answer attached`);
  const version = opts.version ?? CATALOG_VERSION;
  const now = opts.now ?? Date.now();
  const generatedAt = new Date(now);
  const formula = getTool(checked.tool)?.formula;
  // A calculator is named with its formula version; a tool without one (doc_abstract_lease) by
  // name only: the package version is not a version of the tool's output.
  const toolRef = formula ? `${checked.tool}@${formula.version}` : checked.tool;
  // Only a document built from FactLot's own run says its numbers are the tool's results. A
  // lease abstract leads every page's footer with where its values came from.
  const generated = `Generated by FactLot ${version} on ${utcStamp(now)} from ${toolRef}`;
  const footer =
    kind === "lease_abstract"
      ? `${checked.check === "supplied" ? SUPPLIED_LABEL : LEASE_COMPUTED_LABEL} ${generated}; see ${TERMS_URL}`
      : kind === "tx_protest_deadline"
        ? `${generated}; dates are the rule's results; see ${TERMS_URL}`
        : kind === "property_sheet"
          ? `${generated}; public-record values as published, laid out by code with no model; not an appraisal; see ${TERMS_URL}`
          : `${generated}; numbers are the tool's results; see ${TERMS_URL}`;
  // A Texas PDF carries the disclaimer twice: on the cover and in every page's footer.
  const p: Provenance = {
    footer:
      (kind === "tx_unequal_appraisal" || kind === "tx_protest_deadline") &&
      format === "pdf"
        ? `${footer}. ${TX_DISCLAIMER}`
        : footer,
    version,
    toolRef,
    generatedAt,
    header: `FactLot | ${KIND_TITLES[kind]}${ctx.title ? ` | ${ctx.title}` : ""}`,
    keywords: ["FactLot", kind, toolRef],
  };
  const k: KindInput = {
    checked,
    ctx,
    p,
    ...(prepared.include_past ? { include_past: true } : {}),
  };

  let bytes: Uint8Array;
  if (format === "ics")
    bytes =
      kind === "tx_protest_deadline" ? await protestIcs(k) : await datesIcs(k);
  else if (kind === "tx_unequal_appraisal" && format === "xlsx")
    bytes = await txXlsx(k);
  else {
    const doc = BUILDERS[kind](k);
    bytes =
      format === "pdf" ? await renderPdf(doc, p) : await renderXlsx(doc, p);
  }
  if (bytes.byteLength > MAX_REPORT_BYTES)
    throw new ReportInputError(
      "TooLarge",
      `the ${format} file would be ${bytes.byteLength} bytes; the limit is ${MAX_REPORT_BYTES} (25 MiB)`,
    );

  const subject = ctx.title ?? subjectOf(kind, checked.result, checked.args);
  const date = generatedAt.toISOString().slice(0, 10);
  const filename = [
    "factlot",
    slug(kind),
    ...(subject ? [subjectSlug(subject, kind, date)] : []),
    date,
  ]
    .filter(Boolean)
    .join("-");
  return {
    bytes,
    filename: `${filename}.${format}`,
    content_type: CONTENT_TYPES[format],
    kind,
    format,
    source: toolRef,
    check: checked.check,
    ...(checked.result_mismatch !== undefined
      ? { result_mismatch: checked.result_mismatch }
      : {}),
    generated_at: generatedAt.toISOString(),
  };
}

const BUILDERS: Record<ReportKind, (k: KindInput) => ReportDoc> = {
  tx_unequal_appraisal: txDoc,
  lease_abstract: leaseDoc,
  cam_reconciliation: camDoc,
  debt_sizing: debtDoc,
  asc842_schedule: asc842Doc,
  compare_proposals: proposalsDoc,
  dcf_summary: dcfDoc,
  critical_dates: datesDoc,
  tx_protest_deadline: protestDoc,
  property_sheet: propertySheetDoc,
};

/**
 * The subject part of a filename: cut at a word boundary, without the kind's own words repeated
 * and without a trailing year that the date after it repeats ("…-tax-year-2026-2026-11-07").
 */
export function subjectSlug(
  subject: string,
  kind: ReportKind,
  date: string,
): string {
  let s = slug(subject, 200);
  const kindWords = slug(kind).replace(/^tx-/, "");
  s = s.replace(new RegExp(`(^|-)${kindWords}(?=-|$)`), "$1");
  s = s.replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  const year = date.slice(0, 4);
  const trailingYear = new RegExp(`-?(?:(?:tax-)?year-)?${year}$`);
  return slug(s.replace(trailingYear, ""), 40)
    .replace(trailingYear, "")
    .replace(/-+$/g, "");
}

function subjectOf(
  kind: ReportKind,
  result: unknown,
  args?: unknown,
): string | undefined {
  if (kind === "property_sheet")
    return sheetSubject({ checked: { args, result } });
  const r = result as { value?: { subject_id?: unknown; tax_year?: unknown } };
  if (kind === "tx_unequal_appraisal") {
    const id =
      typeof r.value?.subject_id === "string" ? r.value.subject_id : "";
    return `${String(r.value?.tax_year ?? "")}${id ? `-${id}` : ""}`;
  }
  return undefined;
}
