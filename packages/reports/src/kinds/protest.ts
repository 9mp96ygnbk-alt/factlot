/**
 * tx_protest_deadline: a calendar (and a one-page deadline sheet) from FactLot's own run of
 * rules_tx_property_tax_protest_deadline, or of its _batch for a portfolio. Every date is the
 * rule's: this file lays the rule's result out and computes no deadline of its own. No
 * recommendation: it never says whether to protest.
 */
import { texasToday } from "@factlot/calc";

import type { Block, Raw, ReportDoc } from "../doc.ts";
import {
  calendar,
  dayNumber,
  eventUid,
  type IcsAlarm,
  type IcsEvent,
} from "../ics.ts";
import type {
  ProtestBatchResult,
  ProtestDeadlineT,
  ProtestResult,
} from "../validate.ts";
import { closingBlocks, subtitle, type KindInput } from "./common.ts";
import { TX_DISCLAIMER } from "./tx.ts";

/** The ch. 1152 sentence the other Texas outputs carry (registry_tx_equity_candidates' notice). */
export const TX_SOFTWARE =
  "FactLot is software, not a property tax consultant under Texas Occupations Code chapter 1152; it does not prepare, file or advise on protests.";

/** What the dates are, on every event and on the sheet. */
export const PROTEST_SCOPE =
  "Information about a statutory deadline: the dates are the rule's. It does not say whether to protest.";

/** Days before the conservative file-by date its reminders fire. */
export const PROTEST_REMINDER_DAYS = [30, 7] as const;

/** One notice: a single call's result, or one answered item of a batch. */
interface Subject {
  /** The batch item's id (the caller's label for the notice); undefined for a single call. */
  label: string | undefined;
  tax_year: number;
  notice_delivered_date: string | undefined;
  d: ProtestDeadlineT;
  warnings: string[];
}

interface Run {
  subjects: Subject[];
  as_of: string;
  notes: string[];
  disclaimer: string;
  rule: ProtestResult["value"]["rule"];
  /** The batch's own warnings (a single call's are on its subject). */
  warnings: string[];
  steps: ProtestResult["steps"];
  batch: boolean;
  /** Said when the caller sent no as_of: the status is then measured from the generation day. */
  asOfNote: string;
}

type Obj = Record<string, unknown>;
const arg = (o: unknown, key: string): unknown =>
  typeof o === "object" && o !== null ? (o as Obj)[key] : undefined;
const dateArg = (o: unknown): string | undefined => {
  const v = arg(o, "notice_delivered_date");
  return typeof v === "string" ? v : undefined;
};

function runOf(k: KindInput): Run {
  const args = k.checked.args;
  if (k.checked.tool === "rules_tx_property_tax_protest_deadline_batch") {
    const r = k.checked.result as ProtestBatchResult;
    const items = (arg(args, "items") as unknown[] | undefined) ?? [];
    const subjects = r.value.results.flatMap((x, i): Subject[] =>
      "error" in x
        ? [] // refused before rendering (validate.ts): never reached
        : [
            {
              label: String(x.id),
              tax_year: Number(arg(items[i], "tax_year")),
              notice_delivered_date: dateArg(items[i]),
              d: x as unknown as ProtestDeadlineT,
              warnings: (x as { warnings: string[] }).warnings,
            },
          ],
    );
    return {
      subjects,
      as_of: r.value.as_of,
      notes: r.value.notes,
      disclaimer: r.value.disclaimer,
      rule: r.value.rule,
      warnings: r.warnings,
      steps: r.steps,
      batch: true,
      asOfNote: asOfNote(args, r.value.as_of),
    };
  }
  const r = k.checked.result as ProtestResult;
  return {
    subjects: [
      {
        label: undefined,
        tax_year: Number(arg(args, "tax_year")),
        notice_delivered_date: dateArg(args),
        d: r.value,
        warnings: r.warnings,
      },
    ],
    as_of: r.value.as_of,
    notes: r.value.notes,
    disclaimer: r.value.disclaimer,
    rule: r.value.rule,
    warnings: [],
    steps: r.steps,
    batch: false,
    asOfNote: asOfNote(args, r.value.as_of),
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function asOfNote(args: unknown, asOf: string): string {
  return arg(args, "as_of") == null
    ? `as_of was not sent: the status is measured from the day the report was generated in US Central time (${asOf}).`
    : "";
}

function statusText(s: Subject, asOf: string): string {
  const d = s.d;
  if (d.status === "passed")
    return `As of ${asOf}: status passed (the tax year ${s.tax_year} deadline ${d.deadline} is before ${asOf}).`;
  const days = d.days_remaining ?? 0;
  return d.status === "not_yet_open"
    ? `As of ${asOf}: status not yet open (before January 1 of tax year ${s.tax_year}); ${plural(days, "day")} to the deadline.`
    : `As of ${asOf}: status open; ${plural(days, "day")} to the deadline.`;
}

function basisText(s: Subject): string {
  const d = s.d;
  return d.governing_basis === "may_15"
    ? `Basis: May 15 of the tax year (Tex. Tax Code §41.44(a)(1))${s.notice_delivered_date ? `; the 30th day after the notice delivered on ${s.notice_delivered_date} is not later` : "; no notice delivery date was given"}. Unadjusted deadline ${d.unadjusted_deadline}.`
    : `Basis: the 30th day after the notice of appraised value was delivered (${s.notice_delivered_date ?? "date given"}), later than May 15 (Tex. Tax Code §41.44(a)(1)). Unadjusted deadline ${d.unadjusted_deadline}.`;
}

function rolledText(d: ProtestDeadlineT): string {
  return d.skipped_non_business_days.length
    ? `Moved to the next regular business day under Tex. Tax Code §1.06, past ${d.skipped_non_business_days.map((x) => `${x.date} (${x.reason})`).join(", ")}.`
    : "";
}

function fileByWhy(d: {
  unadjusted: string | undefined;
  deadline: string;
  file_by: string;
  reason: string | undefined;
}): string {
  if (d.file_by === d.deadline)
    return `The same day as the statutory deadline${d.unadjusted ? `: ${d.unadjusted} is a business day, so nothing is moved` : ""}.`;
  return `Earlier than the statutory deadline ${d.deadline}: ${d.unadjusted ? `the unadjusted date ${d.unadjusted}${d.reason ? ` is a ${d.reason}` : " is not a business day"}` : "the unadjusted date is not a business day"}, and §1.06 moves the deadline to the next regular business day. The file-by date is the last business day on or before the unadjusted date, so it does not depend on the rule's holiday list being right.`;
}

function ruleLines(run: Run): string[] {
  const v = run.rule.verification;
  return [
    "Statutes the rule cites:",
    ...run.rule.citations.map((c) => `- ${c.law}: ${c.url}`),
    `Rule ${run.rule.id}@${run.rule.version}, ${v.status}${v.verified_by ? ` by ${v.verified_by}` : ""}${v.verified_at ? ` on ${v.verified_at}` : ""}${v.notes ? `: ${v.notes}` : "."}`,
  ];
}

const listText = (heading: string, xs: string[]) =>
  xs.length ? [heading, ...xs.map((x) => `- ${x}`)].join("\n") : "";

/** Description lines joined, with one blank line at most between sections. */
const join = (xs: string[]) =>
  xs
    .filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""))
    .join("\n")
    .replace(/\n+$/, "");

export async function protestIcs(k: KindInput): Promise<Uint8Array> {
  const run = runOf(k);
  const generated = k.p.generatedAt;
  // "Before today" is measured in US Central time, as the rule measures as_of.
  const today = texasToday(generated);
  const todayN = dayNumber(today);
  const past = (on: string) => !k.include_past && dayNumber(on) < todayN;
  const scopeKey = (s: Subject) => s.label ?? k.ctx.title ?? "";
  const named = (s: Subject) => (s.label ? ` (${s.label})` : "");
  const closing = [
    listText("Not covered by the rule:", run.notes),
    run.disclaimer,
    PROTEST_SCOPE,
    TX_DISCLAIMER,
    TX_SOFTWARE,
    "",
    k.p.footer,
  ];
  const remind = (what: string, on: string): IcsAlarm[] => {
    const days = dayNumber(on) - todayN;
    return [
      ...PROTEST_REMINDER_DAYS.map((n) => ({
        daysBefore: n,
        description: `In ${n} days: ${what}`,
      })),
      ...(days >= 0 && days < PROTEST_REMINDER_DAYS[0]
        ? [
            {
              at: new Date(generated.getTime() + 3_600_000),
              description: `${days === 0 ? "Today" : `In ${plural(days, "day")}`}: ${what}`,
            },
          ]
        : []),
    ];
  };

  const events: IcsEvent[] = [];
  let omitted = 0;
  let passed = 0;
  /** The deadline and file-by pair of one tax year for one subject. */
  const pair = async (
    s: Subject,
    year: number,
    dates: {
      deadline: string;
      file_by: string;
      unadjusted: string | undefined;
      reason: string | undefined;
    },
    lead: string[],
    alarms: boolean,
  ) => {
    const fileByShown = !past(dates.file_by);
    const deadlineShown = !past(dates.deadline);
    // The reminders go on the file-by date; when it is left out as past, on the deadline.
    const alarmOn = fileByShown ? dates.file_by : dates.deadline;
    const what = (on: string) =>
      on === dates.file_by
        ? `conservative file-by date for the Texas protest, tax year ${year}${named(s)}, is ${on} (statutory deadline ${dates.deadline})`
        : `Texas protest filing deadline, tax year ${year}${named(s)}, is ${on}`;
    const warnings = listText("Warnings from the rule:", s.warnings);
    if (deadlineShown)
      events.push({
        uid: await eventUid([
          "tx_protest_deadline",
          scopeKey(s),
          String(year),
          "deadline",
        ]),
        start: dates.deadline,
        summary: `Texas protest filing deadline, tax year ${year}${named(s)}`,
        description: join([
          `Statutory deadline to file a protest with the appraisal review board, tax year ${year}${named(s)}: ${dates.deadline}.`,
          ...lead.filter(Boolean),
          warnings,
          ...ruleLines(run),
          ...closing,
        ]),
        categories: ["Texas property tax", "Deadline"],
        ...(alarms && !fileByShown
          ? { alarms: remind(what(dates.deadline), dates.deadline) }
          : {}),
      });
    else omitted++;
    if (fileByShown)
      events.push({
        uid: await eventUid([
          "tx_protest_deadline",
          scopeKey(s),
          String(year),
          "file_by",
        ]),
        start: dates.file_by,
        summary: `Conservative file-by date, tax year ${year}${named(s)}`,
        description: join([
          `Conservative file-by date for the Texas protest, tax year ${year}${named(s)}: ${dates.file_by}. Statutory deadline: ${dates.deadline}.`,
          fileByWhy(dates),
          ...lead.filter(Boolean),
          warnings,
          ...ruleLines(run),
          ...closing,
        ]),
        categories: ["Texas property tax", "File-by date"],
        ...(alarms ? { alarms: remind(what(alarmOn), alarmOn) } : {}),
      });
    else omitted++;
  };

  for (const s of run.subjects) {
    const d = s.d;
    const thisYear = {
      deadline: d.deadline,
      file_by: d.conservative_file_by,
      unadjusted: d.unadjusted_deadline,
      reason: d.skipped_non_business_days[0]?.reason,
    };
    if (d.status !== "passed" || !d.next_season) {
      await pair(
        s,
        s.tax_year,
        thisYear,
        [basisText(s), rolledText(d), statusText(s, run.as_of)],
        true,
      );
      continue;
    }
    passed++;
    // The requested year has passed: it is kept only with include_past, and said either way.
    const n = d.next_season;
    const passedLine = `Tax year ${s.tax_year}: its deadline ${d.deadline} passed (status passed as of ${run.as_of}).`;
    if (k.include_past)
      await pair(
        s,
        s.tax_year,
        thisYear,
        [
          `This deadline passed: status passed as of ${run.as_of}.`,
          basisText(s),
          rolledText(d),
        ],
        false,
      );
    const may15 = `${n.tax_year}-05-15`;
    await pair(
      s,
      n.tax_year,
      {
        deadline: n.deadline,
        file_by: n.conservative_file_by,
        unadjusted: may15,
        reason: undefined,
      },
      [
        `${passedLine} These dates are the rule's next_season for tax year ${n.tax_year}.`,
        `Basis: May 15 of tax year ${n.tax_year} (Tex. Tax Code §41.44(a)(1)); next_season is computed with no notice delivery date.`,
        n.deadline !== may15
          ? `${may15} is not a business day; the rule moves the deadline to ${n.deadline} under Tex. Tax Code §1.06.`
          : "",
      ],
      true,
    );
  }

  const asOfNote = `Status as of ${run.as_of}.`;
  const text = calendar({
    prodId: `-//FactLot//Reports ${k.p.version}//EN`,
    name: k.ctx.title ?? "Texas protest deadlines",
    description: [
      `Generated by FactLot from ${k.p.toolRef}. ${asOfNote}${run.asOfNote ? ` ${run.asOfNote}` : ""}`,
      `${run.batch ? `${plural(run.subjects.length, "notice")}: each` : "The notice"} has its statutory filing deadline and a conservative file-by date; the file-by date has reminders ${PROTEST_REMINDER_DAYS.join(" and ")} days before (and one an hour after generation when under ${PROTEST_REMINDER_DAYS[0]} days away).`,
      passed
        ? `For ${run.batch ? plural(passed, "notice") : "this notice"} the requested tax year's deadline has passed: the calendar has the rule's next_season dates (next tax year, May 15 basis)${k.include_past ? " and the passed dates" : ""}.`
        : "",
      omitted
        ? `${plural(omitted, "date")} before ${today} ${omitted === 1 ? "is" : "are"} left out (send include_past: true to keep them).`
        : "",
      ...run.warnings,
      TX_DISCLAIMER,
      TX_SOFTWARE,
      k.ctx.title ? "The calendar name is supplied by the caller." : "",
    ]
      .filter(Boolean)
      .join(" "),
    stamp: generated,
    events,
  });
  return new TextEncoder().encode(text);
}

/** The one-page deadline sheet (PDF). */
export function protestDoc(k: KindInput): ReportDoc {
  const run = runOf(k);
  const blocks: Block[] = [
    { t: "notice", text: TX_DISCLAIMER },
    { t: "notice", text: `${PROTEST_SCOPE} ${TX_SOFTWARE}` },
    { t: "heading", text: `Deadlines (status as of ${run.as_of})` },
  ];
  if (run.asOfNote) blocks.push({ t: "para", text: run.asOfNote, grey: true });
  const rows: Raw[][] = run.subjects.map((s) => [
    ...(run.batch ? [s.label ?? ""] : []),
    s.tax_year,
    s.d.governing_basis === "may_15" ? "May 15" : "Notice + 30 days",
    s.d.deadline,
    s.d.conservative_file_by,
    s.d.status.replace(/_/g, " "),
    s.d.days_remaining,
    s.d.next_season
      ? `${s.d.next_season.tax_year}: ${s.d.next_season.deadline} (file by ${s.d.next_season.conservative_file_by})`
      : "",
  ]);
  blocks.push({
    t: "table",
    size: 8,
    columns: [
      ...(run.batch
        ? [{ header: "Notice", fmt: "text" as const, width: 1.4 }]
        : []),
      { header: "Tax year", fmt: "plain", width: 0.6 },
      { header: "Basis", fmt: "text", width: 0.9 },
      { header: "Statutory deadline", fmt: "date", width: 1 },
      { header: "Conservative file-by", fmt: "date", width: 1 },
      { header: "Status", fmt: "text", width: 0.8 },
      { header: "Days to deadline", fmt: "plain", width: 0.7 },
      { header: "Next season (passed only)", fmt: "text", width: 1.6 },
    ],
    rows,
  });
  const details = run.subjects.flatMap((s) =>
    [
      basisText(s),
      rolledText(s.d),
      s.d.conservative_file_by !== s.d.deadline
        ? `Conservative file-by ${s.d.conservative_file_by}: ${fileByWhy({ unadjusted: s.d.unadjusted_deadline, deadline: s.d.deadline, file_by: s.d.conservative_file_by, reason: s.d.skipped_non_business_days[0]?.reason })}`
        : "",
    ]
      .filter(Boolean)
      .map((x) => (s.label ? `${s.label}: ${x}` : x)),
  );
  blocks.push({ t: "bullets", items: details });
  blocks.push(
    { t: "heading", text: "Statutes the rule cites" },
    {
      t: "table",
      size: 8,
      columns: [
        { header: "Statute", fmt: "text", width: 1.4 },
        { header: "Source", fmt: "text", width: 3.6 },
      ],
      rows: run.rule.citations.map((c) => [c.law, c.url]),
    },
    { t: "para", text: ruleLines(run).slice(-1)[0]!, grey: true },
  );
  const warnings = [
    ...run.warnings,
    ...run.subjects.flatMap((s) =>
      s.warnings.map((w) => (s.label ? `${s.label}: ${w}` : w)),
    ),
  ];
  blocks.push({ t: "heading", text: "Warnings from the rule" });
  blocks.push(
    warnings.length
      ? { t: "bullets", items: warnings }
      : { t: "para", text: "The rule returned no warnings.", grey: true },
  );
  blocks.push(
    { t: "heading", text: "Not covered by the rule" },
    { t: "bullets", items: run.notes },
    { t: "para", text: run.disclaimer },
  );
  blocks.push(...closingBlocks(k, k.checked.tool, run.steps));
  const first = run.subjects[0]!;
  return {
    title:
      k.ctx.title ??
      (run.batch
        ? "Texas protest filing deadlines"
        : `Texas protest filing deadline, tax year ${first.tax_year}`),
    subtitle: subtitle(
      [
        run.batch
          ? plural(run.subjects.length, "notice")
          : `Deadline ${first.d.deadline}`,
        `As of ${run.as_of}`,
      ],
      k.ctx,
    ),
    blocks,
    readme: [
      "Texas property tax protest filing deadlines from rules_tx_property_tax_protest_deadline: the statutory deadline and a conservative file-by date for each notice.",
    ],
  };
}
