/**
 * Rules packs: jurisdiction logic as versioned, cited, effective-dated code.
 *
 * Every rule declares the law it implements and a verification status. A rule ships as
 * "draft" until a person has checked it against the official text of each citation and
 * recorded who and when. Draft results always carry a warning, and — where a mistake could
 * cost someone a legal deadline — a conservative alternative that cannot be late.
 */
import { z } from "zod";

import { CalcInputError, IsoDate, Trace, parseInput } from "./core.ts";
import type { CalcResult } from "./core.ts";
import { addDays } from "./dates.ts";

export interface RuleMeta {
  id: string;
  version: number;
  jurisdiction: string;
  title: string;
  citations: { law: string; url: string }[];
  verification: {
    status: "draft" | "verified";
    verified_by?: string;
    verified_at?: string;
    notes: string;
  };
}

function ruleResult<T extends object>(
  t: Trace,
  meta: RuleMeta,
  value: T,
): CalcResult<T & { rule: RuleMeta }> {
  if (meta.verification.status !== "verified") {
    t.warn(
      `Rule ${meta.id}@${meta.version} is a DRAFT: not yet verified against ${meta.citations.map((c) => c.law).join("; ")}. Confirm with the official text or a professional before relying on it.`,
    );
  }
  return t.result(meta.id, meta.version, { ...value, rule: meta });
}

// --- calendar ------------------------------------------------------------------------------

const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

function nthWeekday(
  year: number,
  month: number,
  dow: number,
  n: number,
): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return iso(year, month, 1 + ((dow - firstDow + 7) % 7) + 7 * (n - 1));
}

function lastWeekday(year: number, month: number, dow: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  return iso(
    year,
    month,
    last.getUTCDate() - ((last.getUTCDay() - dow + 7) % 7),
  );
}

/**
 * Texas legal holidays on their actual dates: national holidays listed in Gov't Code §662.003(a)
 * and state holidays in §662.003(b). Observed (shifted) dates are deliberately NOT treated as
 * holidays, and Columbus Day is excluded: when unsure, assume a business day so a computed
 * deadline is never later than the law allows.
 */
export function texasHolidays(year: number): Map<string, string> {
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const days: [string, string][] = [
    [iso(year, 1, 1), "New Year's Day"],
    [iso(year, 1, 19), "Confederate Heroes Day"],
    [nthWeekday(year, 1, 1, 3), "Martin Luther King, Jr., Day"],
    [nthWeekday(year, 2, 1, 3), "Presidents' Day"],
    [iso(year, 3, 2), "Texas Independence Day"],
    [iso(year, 4, 21), "San Jacinto Day"],
    [lastWeekday(year, 5, 1), "Memorial Day"],
    [iso(year, 6, 19), "Emancipation Day (Juneteenth)"],
    [iso(year, 7, 4), "Independence Day"],
    [iso(year, 8, 27), "Lyndon Baines Johnson Day"],
    [nthWeekday(year, 9, 1, 1), "Labor Day"],
    [iso(year, 11, 11), "Veterans Day"],
    [thanksgiving, "Thanksgiving Day"],
    [addDays(thanksgiving, 1), "Day after Thanksgiving"],
    [iso(year, 12, 24), "Christmas Eve"],
    [iso(year, 12, 25), "Christmas Day"],
    [iso(year, 12, 26), "Day after Christmas"],
  ];
  // First listed name wins when two holidays share a date (e.g. MLK Day and Confederate Heroes Day).
  const map = new Map<string, string>();
  for (const [d, name] of days) if (!map.has(d)) map.set(d, name);
  return map;
}

/**
 * Why `date` (YYYY-MM-DD) is not a Texas business day: "Saturday", "Sunday", or the name of the
 * Texas legal holiday (texasHolidays), else undefined.
 */
export function nonBusinessReason(date: string): string | undefined {
  const dow = weekday(date);
  if (dow === 6) return "Saturday";
  if (dow === 0) return "Sunday";
  return texasHolidays(Number(date.slice(0, 4))).get(date);
}

// --- Texas: property tax protest deadline -------------------------------------------------------

export const TX_PROTEST_DEADLINE: RuleMeta = {
  id: "rules.tx.property_tax_protest_deadline",
  version: 1,
  jurisdiction: "us-tx",
  title: "Texas property tax protest deadline",
  citations: [
    {
      law: "Tex. Tax Code §41.44(a)(1)",
      url: "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm#41.44",
    },
    {
      law: "Tex. Tax Code §1.06",
      url: "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.1.htm#1.06",
    },
    {
      law: "Tex. Gov't Code §662.003",
      url: "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.662.htm#662.003",
    },
  ],
  verification: {
    status: "verified",
    verified_by: "FactLot maintainers",
    verified_at: "2026-11-02",
    notes:
      "Checked against the official text at statutes.capitol.texas.gov on 2026-11-02: §41.44(a)(1) (the later of May 15 and the 30th day after the notice was delivered), §1.06 as amended by H.B. 1392 eff. 2026-01-01 (an act is timely on the next regular business day when the last day is a Saturday, Sunday, or legal state or national holiday), and §662.003(a)-(b) (the holiday list; §662.003(c) optional holidays are not legal holidays). Covers the general deadline only. Not covered: §41.44(a)(2)-(5), §25.25 corrections, late-protest relief under §41.44(b)-(c-3), and county-specific practice. 'Delivered' follows §1.07(c): a mailed notice is presumed delivered when deposited in the mail.",
  },
};

export const TxProtestDeadlineInput = z.object({
  tax_year: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .describe("Tax year being protested, e.g. 2026."),
  notice_delivered_date: IsoDate.optional().describe(
    "Date the appraisal district's notice of appraised value was delivered (Tax Code §25.19), YYYY-MM-DD. A mailed notice is presumed delivered on the day it was deposited in the mail (§1.07(c)). Omit if unknown (May 15 is then the only basis).",
  ),
});
export type TxProtestDeadlineInput = z.input<typeof TxProtestDeadlineInput>;

export interface TxProtestDeadline {
  /** Last day to file, after weekend/holiday rollover (§1.06). */
  deadline: string;
  /** The later of May 15 and notice + 30 days, before rollover. */
  unadjusted_deadline: string;
  governing_basis: "may_15" | "30_days_after_notice";
  /** Latest business day on or before the unadjusted deadline: safe even if the holiday list is wrong. */
  recommended_file_by: string;
  skipped_non_business_days: { date: string; reason: string }[];
}

export function txProtestDeadline(
  raw: TxProtestDeadlineInput,
): CalcResult<TxProtestDeadline & { rule: RuleMeta }> {
  const input = parseInput(TxProtestDeadlineInput, raw);
  const t = new Trace();
  const may15 = iso(input.tax_year, 5, 15);
  let unadjusted = may15;
  let basis: TxProtestDeadline["governing_basis"] = "may_15";
  t.step("May 15 of the tax year", may15, "§41.44(a)(1)");
  if (input.notice_delivered_date) {
    if (Number(input.notice_delivered_date.slice(0, 4)) !== input.tax_year) {
      throw new CalcInputError(
        `notice_delivered_date ${input.notice_delivered_date} is not in tax year ${input.tax_year}`,
      );
    }
    const plus30 = addDays(input.notice_delivered_date, 30);
    t.step(
      "30th day after notice delivered",
      plus30,
      `${input.notice_delivered_date} + 30 days`,
    );
    if (plus30 > may15) {
      unadjusted = plus30;
      basis = "30_days_after_notice";
    }
  } else {
    t.warn(
      "No notice delivery date given: if the notice was delivered after April 15, the deadline is later than May 15.",
    );
  }
  t.step("Unadjusted deadline", unadjusted, "later of the two dates");

  let deadline = unadjusted;
  const skipped: { date: string; reason: string }[] = [];
  for (
    let reason = nonBusinessReason(deadline);
    reason;
    reason = nonBusinessReason(deadline)
  ) {
    skipped.push({ date: deadline, reason });
    deadline = addDays(deadline, 1);
  }
  t.step(
    "Deadline",
    deadline,
    skipped.length
      ? `rolled past ${skipped.map((s) => `${s.date} (${s.reason})`).join(", ")} per §1.06`
      : "no rollover needed",
  );

  let safe = unadjusted;
  while (nonBusinessReason(safe)) safe = addDays(safe, -1);
  t.step(
    "Recommended file-by date",
    safe,
    "latest business day on or before the unadjusted deadline",
  );
  if (skipped.length)
    t.warn(`Filing by ${safe} avoids relying on the weekend/holiday rollover.`);

  return ruleResult(t, TX_PROTEST_DEADLINE, {
    deadline,
    unadjusted_deadline: unadjusted,
    governing_basis: basis,
    recommended_file_by: safe,
    skipped_non_business_days: skipped,
  });
}

/** Registry of rule packs, for tool servers and docs generators. */
export const rulePacks = {
  tx_property_tax_protest_deadline: {
    ...TX_PROTEST_DEADLINE,
    description:
      "Deadline to file a Texas property tax protest with the appraisal review board: the later of May 15 or 30 days after the notice of appraised value was delivered, rolled past weekends and Texas legal holidays, plus a conservative file-by date. Returns the statute citations and the rule's verification status.",
    input: TxProtestDeadlineInput,
    run: txProtestDeadline,
  },
} as const;
