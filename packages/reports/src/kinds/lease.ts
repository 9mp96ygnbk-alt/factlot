/** lease_abstract (from doc_abstract_lease) and critical_dates (with an iCalendar file). */
import type { Block, Raw, ReportDoc } from "../doc.ts";
import { jsonText } from "../format.ts";
import { calendar, type IcsEvent } from "../ics.ts";
import type {
  CriticalEventT,
  DatesResult,
  LeaseAbstractResult,
} from "../validate.ts";
import {
  LEASE_COMPUTED_LABEL,
  SUPPLIED_LABEL,
  closingBlocks,
  subtitle,
  warningsBlocks,
  type KindInput,
} from "./common.ts";

type Obj = Record<string, unknown>;

/** "lease.base_rent_schedule" → "Base rent schedule". */
export function termLabel(predicate: string): string {
  const s = predicate
    .replace(/^lease\./, "")
    .replace(/[._]/g, " ")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const str = (x: unknown) =>
  x === undefined || x === null ? "" : typeof x === "string" ? x : jsonText(x);

function docName(r: LeaseAbstractResult, index: unknown): string {
  const d = r.documents.find((x) => x.document === index) as Obj | undefined;
  if (!d) return `document ${String(index)}`;
  return typeof d.title === "string" ? d.title : `document ${String(index)}`;
}

export function leaseDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as LeaseAbstractResult;
  const s = r.summary;
  const blocks: Block[] = [];
  blocks.push({
    t: "notice",
    text:
      k.checked.check === "supplied"
        ? `${SUPPLIED_LABEL} They are the doc_abstract_lease result sent with the request; FactLot checked its shape and counts only, because the lease documents were not sent.`
        : `${LEASE_COMPUTED_LABEL} FactLot ran doc_abstract_lease on the documents' text sent with the request; it did not see the signed lease.`,
  });
  blocks.push({
    t: "notice",
    tone: "info",
    text: "Each term below is a value extracted from the lease documents whose quote FactLot found on the cited page (or, for a fact given without its pages, whose value its quote states). FactLot only orders what was extracted: it does not find terms that were missed and does not interpret the lease. Items under Needs review are not verified.",
  });
  blocks.push({ t: "heading", text: "Summary" });
  blocks.push({
    t: "kv",
    rows: [
      { label: "Lease (subject)", value: r.subject, fmt: "text" },
      { label: "As of", value: r.as_of, fmt: "date" },
      { label: "Documents", value: s.documents, fmt: "int" },
      { label: "Terms abstracted", value: s.fields, fmt: "int" },
      { label: "Verified facts", value: s.facts, fmt: "int" },
      ...(typeof s.confirmed_by_person === "number"
        ? [
            {
              label: "Confirmed by a person",
              value: s.confirmed_by_person,
              fmt: "int" as const,
            },
          ]
        : []),
      { label: "Needs review", value: s.needs_review, fmt: "int" },
      { label: "Rejected", value: s.rejected, fmt: "int" },
      { label: "Pending (not yet in effect)", value: s.pending, fmt: "int" },
      { label: "Terms with conflicts", value: s.conflicts, fmt: "int" },
    ],
  });

  blocks.push({ t: "heading", text: "Documents, in the order applied" });
  blocks.push({
    t: "table",
    size: 7,
    columns: [
      { header: "Input (from 0)", fmt: "int", width: 0.55 },
      { header: "Title", fmt: "text", width: 1.5 },
      { header: "Role", fmt: "text", width: 0.85 },
      { header: "Effective", fmt: "date", width: 0.85 },
      { header: "Applied", fmt: "text", width: 0.65 },
      { header: "Verified", fmt: "int", width: 0.65 },
      { header: "Review", fmt: "int", width: 0.6 },
      { header: "Rejected", fmt: "int", width: 0.7 },
      { header: "Document ID", fmt: "text", width: 2.5 },
    ],
    rows: r.documents.map((d) => {
      const o = d as Obj;
      return [
        d.document,
        str(o.title),
        `${str(o.role)}${o.role_inferred ? " (inferred)" : ""}`,
        typeof o.effective_date === "string" ? o.effective_date : null,
        o.pending ? "pending" : str(o.applied),
        d.verified,
        d.needs_review,
        d.rejected,
        str(o.document_id),
      ];
    }),
  });

  blocks.push({
    t: "heading",
    text: "Lease terms (current as of the abstract date)",
  });
  blocks.push({
    t: "table",
    sheet: "Terms",
    size: 7,
    columns: [
      { header: "Term", fmt: "text", width: 1.25 },
      { header: "Value", fmt: "text", width: 1.6 },
      { header: "Quote", fmt: "text", width: 2.4 },
      { header: "Page", fmt: "int", width: 0.4 },
      { header: "Document", fmt: "text", width: 1.1 },
      { header: "Notes", fmt: "text", width: 1.6 },
    ],
    rows: r.fields.map((f) => {
      const src = f.source;
      const notes: string[] = [];
      if (f.history.length)
        notes.push(
          `supersedes ${f.history.map((h) => `${str(h.value)} (${docName(r, h.document)})`).join("; ")}`,
        );
      if (f.conflicts?.length)
        notes.push(
          `CONFLICT: ${f.conflicts.map((c) => `${str(c.value)} (${docName(r, c.document)})`).join("; ")}`,
        );
      if (f.pending?.length)
        notes.push(
          `pending: ${f.pending.map((p) => `${str(p.value)} from ${str(p.effective_date)}`).join("; ")}`,
        );
      if (f.open_items?.length)
        notes.push(
          `open items: ${f.open_items.map((o) => `${str(o.status)} (${str(o.reason)})`).join("; ")}`,
        );
      if (f.carried_forward?.length)
        notes.push("earlier rent steps carried forward");
      if (f.notes?.length) notes.push(...f.notes);
      if (!src.quote_on_page)
        notes.push(
          "quote not rechecked on the page (given as a fact without pages)",
        );
      if ((src as Obj).method === "human_verified")
        notes.push(`confirmed by ${str((src as Obj).verified_by)}`);
      return [
        `${termLabel(f.predicate)}\n${f.predicate}`,
        str(f.value),
        src.quote ?? "",
        src.page ?? null,
        `${docName(r, src.document)}${src.section ? `, ${src.section}` : ""}`,
        notes.join("\n"),
      ];
    }),
  });

  const reviewRows = (items: Obj[]): Raw[][] =>
    items.map((x) => [
      termLabel(str(x.predicate)),
      str(x.value),
      str(x.quote),
      typeof x.page === "number" ? x.page : null,
      docName(r, x.document),
      `${str(x.check)}${x.reason ? `: ${str(x.reason)}` : ""}`,
    ]);
  const reviewCols = [
    { header: "Term", fmt: "text" as const, width: 1.1 },
    { header: "Value extracted", fmt: "text" as const, width: 1.2 },
    { header: "Quote", fmt: "text" as const, width: 2.2 },
    { header: "Page", fmt: "int" as const, width: 0.4 },
    { header: "Document", fmt: "text" as const, width: 1 },
    { header: "Why", fmt: "text" as const, width: 2 },
  ];
  blocks.push({ t: "heading", text: "Needs review (not verified)" });
  blocks.push(
    r.needs_review.length
      ? {
          t: "table",
          sheet: "NeedsReview",
          size: 7,
          columns: reviewCols,
          rows: reviewRows(r.needs_review),
        }
      : { t: "para", text: "Nothing needs review.", grey: true },
  );
  if (r.rejected.length)
    blocks.push(
      { t: "heading", text: "Rejected" },
      {
        t: "table",
        sheet: "Rejected",
        size: 7,
        columns: reviewCols,
        rows: reviewRows(r.rejected),
      },
    );
  if (r.pending.length)
    blocks.push(
      {
        t: "heading",
        text: "Pending (amendments effective after the abstract date)",
      },
      {
        t: "table",
        size: 7,
        columns: [
          { header: "Term", fmt: "text", width: 1.2 },
          { header: "Value", fmt: "text", width: 1.6 },
          { header: "Effective", fmt: "date", width: 0.8 },
          { header: "Quote", fmt: "text", width: 2.4 },
          { header: "Page", fmt: "int", width: 0.4 },
          { header: "Document", fmt: "text", width: 1 },
        ],
        rows: r.pending.map((p) => [
          termLabel(str(p.predicate)),
          str(p.value),
          typeof p.effective_date === "string" ? p.effective_date : null,
          str(p.quote),
          typeof p.page === "number" ? p.page : null,
          docName(r, p.document),
        ]),
      },
    );
  blocks.push(...warningsBlocks(r.warnings));
  blocks.push(...closingBlocks(k, "doc_abstract_lease"));
  return {
    title: k.ctx.title ?? `Lease abstract as of ${r.as_of}`,
    subtitle: subtitle(
      [
        r.subject,
        `${s.documents} document${s.documents === 1 ? "" : "s"}`,
        `${s.needs_review} to review`,
      ],
      k.ctx,
    ),
    blocks,
    readme: [
      "A lease abstract from doc_abstract_lease: each current term with the quote, page and document that states it, what it superseded, conflicts and open items, and the extracted values that still need review.",
    ],
  };
}

// --- critical dates -----------------------------------------------------------------------------

const KIND_LABEL: Record<CriticalEventT["kind"], string> = {
  commencement: "commencement",
  expiration: "expiration",
  renewal_window_opens: "renewal window opens",
  renewal_notice_deadline: "renewal notice deadline",
  renewal_term_ends: "renewal term ends",
  termination_notice_deadline: "termination notice deadline",
  termination_effective: "termination effective",
  expansion_option_deadline: "expansion option deadline",
  deadline: "deadline",
};

const DEADLINES = new Set<CriticalEventT["kind"]>([
  "renewal_notice_deadline",
  "termination_notice_deadline",
  "expansion_option_deadline",
  "deadline",
]);

function eventNote(e: CriticalEventT): string {
  const parts: string[] = [];
  if (e.unadjusted_date)
    parts.push(
      `moved from ${e.unadjusted_date} (${e.rolled_because ?? "not a business day"})`,
    );
  if (e.non_business_day) parts.push(`falls on a ${e.non_business_day}`);
  return parts.join("; ");
}

export function datesDoc(k: KindInput): ReportDoc {
  const r = k.checked.result as DatesResult;
  const v = r.value;
  const nd = v.next_deadline;
  const blocks: Block[] = [
    { t: "heading", text: "Summary" },
    {
      t: "kv",
      rows: [
        {
          label: "Measured from (as of)",
          value: v.as_of ?? "not given",
          fmt: v.as_of ? "date" : "text",
        },
        {
          label: "Next deadline",
          value: nd ? `${nd.date}: ${nd.label}` : "none on or after as of",
          fmt: "text",
        },
        ...(nd?.days_from_as_of !== undefined
          ? [
              {
                label: "Days to the next deadline",
                value: nd.days_from_as_of,
                fmt: "int" as const,
              },
            ]
          : []),
        {
          label: "Deadlines on a weekend or holiday",
          value:
            v.business_day_roll === "none"
              ? "flagged, not moved"
              : `moved to the ${v.business_day_roll} business day`,
          fmt: "text",
        },
        {
          label: "Holidays",
          value:
            v.holidays === "us_federal"
              ? "US federal (5 U.S.C. §6103)"
              : "none",
          fmt: "text",
        },
      ],
    },
    { t: "heading", text: "Critical dates" },
    {
      t: "table",
      sheet: "Dates",
      size: 7.5,
      columns: [
        { header: "Date", fmt: "date", width: 0.9 },
        { header: "Event", fmt: "text", width: 2.6 },
        { header: "Kind", fmt: "text", width: 1.3 },
        { header: "Days from as of", fmt: "int", width: 0.8 },
        { header: "Note", fmt: "text", width: 1.8 },
      ],
      rows: v.events.map((e) => [
        e.date,
        e.label,
        KIND_LABEL[e.kind],
        e.days_from_as_of ?? null,
        eventNote(e),
      ]),
      bold: v.events
        .map((e, i) => (DEADLINES.has(e.kind) ? i : -1))
        .filter((i) => i >= 0),
    },
  ];
  if (v.renewal_terms.length)
    blocks.push(
      { t: "heading", text: "Renewal options" },
      {
        t: "table",
        size: 8,
        columns: [
          { header: "Option", fmt: "int", width: 0.6 },
          { header: "Notice window opens", fmt: "date", width: 1.1 },
          { header: "Last day for notice", fmt: "date", width: 1.1 },
          { header: "Term starts", fmt: "date", width: 1 },
          { header: "Term ends", fmt: "date", width: 1 },
        ],
        rows: v.renewal_terms.map((t) => [
          t.option,
          t.window_opens ?? null,
          t.notice_deadline,
          t.term_start,
          t.term_end,
        ]),
      },
    );
  if (v.termination_options.length)
    blocks.push(
      { t: "heading", text: "Termination options" },
      {
        t: "table",
        size: 8,
        columns: [
          { header: "Option", fmt: "int", width: 0.6 },
          { header: "Last day for notice", fmt: "date", width: 1.2 },
          { header: "Effective date", fmt: "date", width: 1.2 },
        ],
        rows: v.termination_options.map((t) => [
          t.option,
          t.notice_deadline,
          t.effective_date,
        ]),
      },
    );
  blocks.push(
    { t: "heading", text: "Conventions" },
    { t: "bullets", items: v.conventions },
  );
  blocks.push(...warningsBlocks(r.warnings));
  blocks.push(...closingBlocks(k, "calc_critical_dates", r.steps));
  return {
    title: k.ctx.title ?? "Lease critical dates",
    subtitle: subtitle(
      [nd ? `Next deadline ${nd.date}` : undefined, `${v.events.length} dates`],
      k.ctx,
    ),
    blocks,
    readme: [
      "A lease's critical dates from calc_critical_dates: notice deadlines and windows for renewal, termination and expansion options and other deadlines, with weekend and holiday handling as the tool applied it.",
    ],
  };
}

async function uid(parts: string[]): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("\u001f")),
  );
  return `${[...new Uint8Array(d).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}@factlot.com`;
}

/** Days before a notice event its reminder fires. */
export const REMINDER_DAYS = 30;

export async function datesIcs(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as DatesResult;
  const v = r.value;
  const name = k.ctx.title ?? "Lease critical dates";
  const scope = [
    name,
    v.events.find((e) => e.kind === "expiration")?.date ?? "",
  ];
  const events: IcsEvent[] = [];
  const remind = (what: string) => [
    {
      daysBefore: REMINDER_DAYS,
      description: `In ${REMINDER_DAYS} days: ${what}`,
    },
  ];
  for (const t of v.renewal_terms)
    if (t.window_opens) {
      const summary = `${name}: renewal option ${t.option} notice window (${t.window_opens} to ${t.notice_deadline})`;
      events.push({
        uid: await uid([...scope, "window", String(t.option)]),
        start: t.window_opens,
        end: t.notice_deadline,
        summary,
        description: `Renewal option ${t.option}: notice may be given from ${t.window_opens} through ${t.notice_deadline}. Renewal term ${t.term_start} to ${t.term_end}.\n\n${k.p.footer}`,
        categories: ["Lease", "Notice window"],
        alarms: remind(
          `renewal option ${t.option} notice window opens on ${t.window_opens}`,
        ),
      });
    }
  for (const e of v.events) {
    const deadline = DEADLINES.has(e.kind);
    const note = eventNote(e);
    events.push({
      uid: await uid([...scope, e.kind, String(e.option ?? ""), e.label]),
      start: e.date,
      summary: `${name}: ${e.label}`,
      description: [
        `${e.label} (${KIND_LABEL[e.kind]}): ${e.date}.`,
        note ? `${note.charAt(0).toUpperCase()}${note.slice(1)}.` : "",
        deadline
          ? "Confirm the deadline and how notice must be given against the lease's notice clause."
          : "",
        "",
        k.p.footer,
      ]
        .filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""))
        .join("\n"),
      categories: ["Lease", deadline ? "Deadline" : "Date"],
      ...(deadline ? { alarms: remind(`${e.label} on ${e.date}`) } : {}),
    });
  }
  const text = calendar({
    prodId: `-//FactLot//Reports ${k.p.version}//EN`,
    name,
    description: `Generated by FactLot from ${k.p.toolRef}. Notice deadlines and windows carry a reminder ${REMINDER_DAYS} days before.${k.ctx.title ? " The calendar name is supplied by the caller." : ""}`,
    stamp: k.p.generatedAt,
    events,
  });
  return new TextEncoder().encode(text);
}
