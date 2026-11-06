import { z } from "zod";

import { IsoDate, Trace, parseInput } from "./core.ts";
import type { CalcResult } from "./core.ts";
import { addDays, addMonths, daysBetween } from "./dates.ts";
import { lastWeekday, nthWeekday } from "./rules.ts";

const Label = z.string().min(1).max(200);
const NoticeMonths = z
  .number()
  .int()
  .min(0)
  .max(120)
  .describe(
    'Notice "no later than N months before" the date it counts back from, in calendar months.',
  );
const NoticeDays = z
  .number()
  .int()
  .min(0)
  .max(3650)
  .describe(
    'Notice "no later than N days before" the date it counts back from, in calendar days.',
  );

const oneNotice = (
  v: { notice_months?: number; notice_days?: number; notice_window?: unknown },
  window: boolean,
): boolean =>
  [v.notice_months, v.notice_days, window ? v.notice_window : undefined].filter(
    (x) => x !== undefined,
  ).length === 1;

const NoticeWindow = z
  .object({
    earliest_months_before: z
      .number()
      .int()
      .min(1)
      .max(120)
      .describe(
        "The window opens this many calendar months before the expiration in effect (notice given earlier is premature).",
      ),
    latest_months_before: z
      .number()
      .int()
      .min(0)
      .max(120)
      .describe(
        "The window closes this many calendar months before the expiration in effect (the last day to give notice).",
      ),
  })
  .refine((w) => w.earliest_months_before > w.latest_months_before, {
    message: "earliest_months_before must be greater than latest_months_before",
    path: ["earliest_months_before"],
  });

export const CriticalDatesInput = z
  .object({
    expiration_date: IsoDate.describe(
      "Expiration date of the current term (YYYY-MM-DD), as the lease or the latest amendment states it.",
    ),
    commencement_date: IsoDate.optional().describe(
      "Commencement date (YYYY-MM-DD). Optional; listed as an event and checked to be before expiration_date.",
    ),
    as_of: IsoDate.optional().describe(
      "Date to measure from (YYYY-MM-DD), usually today. Deadlines before it are flagged as passed; next_deadline is the first one on or after it.",
    ),
    renewal_option: z
      .object({
        count: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("Number of successive renewal options."),
        term_months: z
          .number()
          .int()
          .min(1)
          .max(600)
          .describe("Length of each renewal term in calendar months."),
        notice_months: NoticeMonths.optional(),
        notice_days: NoticeDays.optional(),
        notice_window: NoticeWindow.optional().describe(
          'A notice window ("not earlier than 18 nor later than 12 months before expiration"), instead of notice_months or notice_days.',
        ),
      })
      .refine((v) => oneNotice(v, true), {
        message:
          "give exactly one of notice_months, notice_days or notice_window",
      })
      .optional()
      .describe(
        "Renewal options, as lease.renewal_option states them: each is exercised by notice counted back from the expiration in effect when it is exercised.",
      ),
    termination_options: z
      .array(
        z
          .object({
            effective_date: IsoDate.describe(
              "Date the early termination takes effect (YYYY-MM-DD).",
            ),
            notice_months: NoticeMonths.optional(),
            notice_days: NoticeDays.optional(),
            label: Label.optional().describe(
              'Name for this option, e.g. "Year 5 termination right".',
            ),
          })
          .refine((v) => oneNotice(v, false), {
            message: "give exactly one of notice_months or notice_days",
          }),
      )
      .max(20)
      .default([])
      .describe(
        "Early termination options, as lease.termination_option states them; notice counts back from each effective_date.",
      ),
    expansion_option_deadline: IsoDate.optional().describe(
      "Last day to exercise an expansion option (lease.expansion_option_deadline), YYYY-MM-DD.",
    ),
    other_deadlines: z
      .array(
        z
          .object({
            label: Label.describe(
              'What the deadline is, e.g. "ROFO response for Suite 410".',
            ),
            date: IsoDate.optional().describe(
              "The deadline, when the lease states the date.",
            ),
            from_date: IsoDate.optional().describe(
              "Or the date it counts from (e.g. the day Landlord's ROFO notice was received), with days_after.",
            ),
            days_after: z
              .number()
              .int()
              .min(0)
              .max(3650)
              .optional()
              .describe("Calendar days after from_date."),
          })
          .refine(
            (v) =>
              v.date !== undefined
                ? v.from_date === undefined && v.days_after === undefined
                : v.from_date !== undefined && v.days_after !== undefined,
            { message: "give date, or from_date with days_after" },
          ),
      )
      .max(50)
      .default([])
      .describe(
        "Other deadlines: expansion rights, ROFO or ROFR response periods, contraction rights.",
      ),
    business_day_roll: z
      .enum(["none", "preceding", "following"])
      .default("none")
      .describe(
        'What to do with a deadline that falls on a weekend or holiday: "none" (default) keeps the date and flags it; "preceding" moves it to the business day before (never later than the lease date: the safe choice); "following" moves it to the next business day, which only a lease clause that says so allows.',
      ),
    holidays: z
      .enum(["us_federal", "none"])
      .default("us_federal")
      .describe(
        'Holidays that are not business days: "us_federal" (the eleven US federal holidays of 5 U.S.C. §6103(a), with the federal observed day when one falls on a weekend) or "none" (weekends only).',
      ),
  })
  .superRefine((v, ctx) => {
    if (
      v.commencement_date !== undefined &&
      v.commencement_date >= v.expiration_date
    )
      ctx.addIssue({
        code: "custom",
        path: ["commencement_date"],
        message: "must be before expiration_date",
      });
    v.termination_options.forEach((o, i) => {
      if (o.effective_date > v.expiration_date)
        ctx.addIssue({
          code: "custom",
          path: ["termination_options", i, "effective_date"],
          message: "must not be after expiration_date",
        });
    });
  });
export type CriticalDatesInput = z.input<typeof CriticalDatesInput>;

export type CriticalEventKind =
  | "commencement"
  | "expiration"
  | "renewal_window_opens"
  | "renewal_notice_deadline"
  | "renewal_term_ends"
  | "termination_notice_deadline"
  | "termination_effective"
  | "expansion_option_deadline"
  | "deadline";

export interface CriticalEvent {
  date: string;
  kind: CriticalEventKind;
  label: string;
  /** Renewal or termination option number (1-based). */
  option?: number;
  /** The date the lease arithmetic gives, when business_day_roll moved it. */
  unadjusted_date?: string;
  rolled_because?: string;
  /** Set when a deadline falls on a weekend or holiday and was not moved. */
  non_business_day?: string;
  days_from_as_of?: number;
}

export interface CriticalDates {
  as_of: string | null;
  business_day_roll: "none" | "preceding" | "following";
  holidays: "us_federal" | "none";
  events: CriticalEvent[];
  next_deadline: CriticalEvent | null;
  renewal_terms: {
    option: number;
    window_opens?: string;
    notice_deadline: string;
    term_start: string;
    term_end: string;
  }[];
  termination_options: {
    option: number;
    effective_date: string;
    notice_deadline: string;
  }[];
  conventions: string[];
}

const DEADLINES: ReadonlySet<CriticalEventKind> = new Set([
  "renewal_notice_deadline",
  "termination_notice_deadline",
  "expansion_option_deadline",
  "deadline",
]);

/** First year the holiday list below matches 5 U.S.C. §6103(a) (Martin Luther King, Jr. Day). */
export const US_FEDERAL_HOLIDAYS_FROM = 1986;

const ymd = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const weekday = (date: string): number =>
  new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/**
 * US federal holidays (5 U.S.C. §6103(a)) of one year on their actual dates, plus the observed
 * day of each that falls on a weekend (Saturday: the Friday before; Sunday: the Monday after;
 * 5 U.S.C. §6103(b) and Executive Order 11582). Juneteenth from 2021. Inauguration Day, a holiday
 * only around Washington, DC, is not included. Python: `us_federal_holidays`.
 */
export function usFederalHolidays(year: number): Map<string, string> {
  const days: [string, string][] = [
    [ymd(year, 1, 1), "New Year's Day"],
    [nthWeekday(year, 1, 1, 3), "Birthday of Martin Luther King, Jr."],
    [nthWeekday(year, 2, 1, 3), "Washington's Birthday"],
    [lastWeekday(year, 5, 1), "Memorial Day"],
    ...(year >= 2021
      ? [
          [ymd(year, 6, 19), "Juneteenth National Independence Day"] as [
            string,
            string,
          ],
        ]
      : []),
    [ymd(year, 7, 4), "Independence Day"],
    [nthWeekday(year, 9, 1, 1), "Labor Day"],
    [nthWeekday(year, 10, 1, 2), "Columbus Day"],
    [ymd(year, 11, 11), "Veterans Day"],
    [nthWeekday(year, 11, 4, 4), "Thanksgiving Day"],
    [ymd(year, 12, 25), "Christmas Day"],
  ];
  const map = new Map<string, string>();
  for (const [d, name] of days) {
    map.set(d, name);
    const dow = weekday(d);
    if (dow === 6) map.set(addDays(d, -1), `${name} (observed)`);
    if (dow === 0) map.set(addDays(d, 1), `${name} (observed)`);
  }
  return map;
}

function monthEnd(iso: string): string {
  return addDays(addMonths(`${iso.slice(0, 8)}01`, 1), -1);
}

export function criticalDates(
  input: CriticalDatesInput,
): CalcResult<CriticalDates> {
  const v = parseInput(CriticalDatesInput, input);
  const t = new Trace();
  const roll = v.business_day_roll;
  const asOf = v.as_of ?? null;
  const events: CriticalEvent[] = [];
  let early = false;

  /** Why a date is not a business day, or undefined. */
  const nonBusiness = (date: string): string | undefined => {
    const dow = weekday(date);
    if (dow === 6) return "Saturday";
    if (dow === 0) return "Sunday";
    if (v.holidays === "none") return undefined;
    const year = Number(date.slice(0, 4));
    if (year < US_FEDERAL_HOLIDAYS_FROM) {
      early = true;
      return undefined;
    }
    // A New Year's Day on a Saturday is observed on December 31 of the year before.
    return (
      usFederalHolidays(year).get(date) ??
      (date.endsWith("-12-31")
        ? usFederalHolidays(year + 1).get(date)
        : undefined)
    );
  };

  /** The nearest business day before (step −1) or after (step 1) a date. */
  const businessDay = (date: string, step: number): string => {
    let d = addDays(date, step);
    while (nonBusiness(d)) d = addDays(d, step);
    return d;
  };

  /** months before `from`, same day of month clamped to month end, with the month-end warning. */
  const monthsBefore = (from: string, months: number, what: string): string => {
    const d = addMonths(from, -months);
    if (from === monthEnd(from) && d !== monthEnd(d))
      t.warn(
        `${what}: ${from} is the last day of its month and FactLot keeps the day of month, giving ${d}. Read month-end to month-end it would be ${monthEnd(d)}, which is later; FactLot gives the earlier date.`,
      );
    return d;
  };

  const add = (
    date: string,
    kind: CriticalEventKind,
    label: string,
    option?: number,
  ): CriticalEvent => {
    const e: CriticalEvent = {
      date,
      kind,
      label,
      ...(option !== undefined ? { option } : {}),
    };
    if (DEADLINES.has(kind)) {
      const why = nonBusiness(date);
      if (why && roll === "none") {
        e.non_business_day = why;
        t.warn(
          `${label} falls on ${date}, not a business day (${why}). FactLot did not move it (business_day_roll none); the lease's business-day clause decides whether it moves.`,
        );
      } else if (why) {
        const d = businessDay(date, roll === "preceding" ? -1 : 1);
        e.date = d;
        e.unadjusted_date = date;
        e.rolled_because = why;
        t.step(
          `${label}: rolled to a business day`,
          d,
          `${date} is not a business day (${why}); business_day_roll ${roll}`,
        );
        if (roll === "following")
          t.warn(
            `${label} was moved later, from ${date} to ${d}. Only a lease clause that extends a deadline falling on a non-business day allows that; the preceding business day, ${businessDay(date, -1)}, is safe either way.`,
          );
      }
    }
    if (asOf !== null) e.days_from_as_of = daysBetween(asOf, e.date);
    events.push(e);
    return e;
  };

  if (v.commencement_date !== undefined)
    add(v.commencement_date, "commencement", "Commencement date");
  add(
    t.step("Expiration date", v.expiration_date, "as given"),
    "expiration",
    "Expiration date",
  );

  const renewalTerms: CriticalDates["renewal_terms"] = [];
  const ro = v.renewal_option;
  if (ro) {
    const firstStart = addDays(v.expiration_date, 1);
    let current = v.expiration_date;
    for (let k = 1; k <= ro.count; k++) {
      const name = `Renewal option ${k}`;
      let opens: string | undefined;
      let deadline: string;
      if (ro.notice_window) {
        const w = ro.notice_window;
        opens = t.step(
          `${name}: notice window opens`,
          monthsBefore(current, w.earliest_months_before, name),
          `${current} − ${w.earliest_months_before} months`,
        );
        deadline = t.step(
          `${name}: last day to give notice`,
          monthsBefore(current, w.latest_months_before, name),
          `${current} − ${w.latest_months_before} months`,
        );
      } else if (ro.notice_months !== undefined)
        deadline = t.step(
          `${name}: last day to give notice`,
          monthsBefore(current, ro.notice_months, name),
          `${current} − ${ro.notice_months} months (same day of month, clamped to the month's last day)`,
        );
      else
        deadline = t.step(
          `${name}: last day to give notice`,
          addDays(current, -ro.notice_days!),
          `${current} − ${ro.notice_days} days`,
        );
      const start = addDays(current, 1);
      const end = t.step(
        `${name}: renewal term ends`,
        addDays(addMonths(firstStart, k * ro.term_months), -1),
        `${firstStart} + ${k} × ${ro.term_months} months − 1 day`,
      );
      if (opens !== undefined)
        add(opens, "renewal_window_opens", `${name}: notice window opens`, k);
      const de = add(
        deadline,
        "renewal_notice_deadline",
        `${name}: last day to give notice`,
        k,
      );
      add(end, "renewal_term_ends", `${name}: renewal term ends`, k);
      renewalTerms.push({
        option: k,
        ...(opens !== undefined ? { window_opens: opens } : {}),
        notice_deadline: de.date,
        term_start: start,
        term_end: end,
      });
      current = end;
    }
    if (ro.count > 1)
      t.warn(
        "Renewal options after the first assume every earlier option was exercised: each notice counts back from the expiration of the term before it.",
      );
  }

  const terminations: CriticalDates["termination_options"] = [];
  v.termination_options.forEach((o, i) => {
    const name = o.label ?? `Termination option ${i + 1}`;
    const deadline =
      o.notice_months !== undefined
        ? t.step(
            `${name}: last day to give notice`,
            monthsBefore(o.effective_date, o.notice_months, name),
            `${o.effective_date} − ${o.notice_months} months (same day of month, clamped to the month's last day)`,
          )
        : t.step(
            `${name}: last day to give notice`,
            addDays(o.effective_date, -o.notice_days!),
            `${o.effective_date} − ${o.notice_days} days`,
          );
    const de = add(
      deadline,
      "termination_notice_deadline",
      `${name}: last day to give notice`,
      i + 1,
    );
    add(
      o.effective_date,
      "termination_effective",
      `${name}: effective date`,
      i + 1,
    );
    terminations.push({
      option: i + 1,
      effective_date: o.effective_date,
      notice_deadline: de.date,
    });
  });

  if (v.expansion_option_deadline !== undefined)
    add(
      v.expansion_option_deadline,
      "expansion_option_deadline",
      "Expansion option deadline",
    );
  for (const o of v.other_deadlines) {
    const date =
      o.date ??
      t.step(
        o.label,
        addDays(o.from_date!, o.days_after!),
        `${o.from_date} + ${o.days_after} days`,
      );
    add(date, "deadline", o.label);
  }

  if (early)
    t.warn(
      `The US federal holiday calendar here starts in ${US_FEDERAL_HOLIDAYS_FROM}; earlier dates were checked for weekends only.`,
    );
  // Stable: events on one date keep the order they were added in.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let next: CriticalEvent | null = null;
  if (asOf !== null) {
    for (const e of events)
      if (DEADLINES.has(e.kind) && e.date < asOf)
        t.warn(
          `${e.label} (${e.date}) is before as_of ${asOf}: it has passed.`,
        );
    next = events.find((e) => DEADLINES.has(e.kind) && e.date >= asOf) ?? null;
    if (next)
      t.step(
        "Next deadline",
        next.date,
        `${next.label}, ${next.days_from_as_of} days after ${asOf}`,
      );
  }

  return t.result("calc.critical_dates", 1, {
    as_of: asOf,
    business_day_roll: roll,
    holidays: v.holidays,
    events,
    next_deadline: next,
    renewal_terms: renewalTerms,
    termination_options: terminations,
    conventions: [
      "Months are calendar months: N months before a date is the same day of the month N months earlier, or that month's last day when it is shorter (August 31 − 6 months = February 28 or 29). A month-end date is not moved to the target month's end; when that reading would give a later date, a warning says so.",
      'Notice "no later than N months (or days) before" a date is due on that date minus N months (or days): the deadline is the last day notice may be given.',
      "A renewal term starts the day after the expiration in effect and ends the day before the same day of the month term_months later; each later option counts back from the end of the term before it.",
      "Deadlines that fall on a weekend or holiday are flagged and not moved unless business_day_roll says so; windows that open and the lease's own dates (expiration, terms, effective dates) are never moved.",
      "Holidays: the US federal holidays of 5 U.S.C. §6103(a) with their observed days (Saturday: the Friday before; Sunday: the Monday after), not state, bank or local holidays; the lease's definition of business day controls.",
      "Not legal advice: confirm each deadline against the lease's notice clause (how notice is given and when it is deemed received).",
    ],
  });
}
