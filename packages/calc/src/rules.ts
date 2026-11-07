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

/** The nth given weekday (0 = Sunday) of a month, as YYYY-MM-DD. */
export function nthWeekday(
  year: number,
  month: number,
  dow: number,
  n: number,
): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return iso(year, month, 1 + ((dow - firstDow + 7) % 7) + 7 * (n - 1));
}

/** The last given weekday (0 = Sunday) of a month, as YYYY-MM-DD. */
export function lastWeekday(year: number, month: number, dow: number): string {
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
  version: 2,
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
  /** Last business day on or before the unadjusted deadline: not later than the deadline even if the holiday list is wrong. */
  conservative_file_by: string;
  skipped_non_business_days: { date: string; reason: string }[];
  /** What this result is and is not: information about a statutory deadline, not legal or tax advice. */
  disclaimer: string;
}

/** The disclaimer every protest-deadline result carries, dated by the rule's verification date. */
export function txProtestDeadlineDisclaimer(checkedOn: string): string {
  return `Information about a statutory deadline computed from the statute text as checked on ${checkedOn}: not legal or tax advice and not a substitute for the advice of an attorney. Confirm the date on the notice you received and with the appraisal district.`;
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
    "Conservative file-by date",
    safe,
    "latest business day on or before the unadjusted deadline",
  );
  if (skipped.length)
    t.warn(
      `${safe} is the last business day on or before the unadjusted date ${unadjusted}; the statutory deadline is ${deadline} under §1.06.`,
    );

  return ruleResult(t, TX_PROTEST_DEADLINE, {
    deadline,
    unadjusted_deadline: unadjusted,
    governing_basis: basis,
    conservative_file_by: safe,
    skipped_non_business_days: skipped,
    disclaimer: txProtestDeadlineDisclaimer(
      TX_PROTEST_DEADLINE.verification.verified_at ?? "an unrecorded date",
    ),
  });
}

// --- Texas: protest deadlines for many notices at once ------------------------------------------

/** The batch's own formula identity; every item is answered under TX_PROTEST_DEADLINE (@2). */
export const TX_PROTEST_DEADLINE_BATCH: RuleMeta = {
  ...TX_PROTEST_DEADLINE,
  id: "rules.tx.property_tax_protest_deadline_batch",
  version: 1,
  title: "Texas property tax protest deadlines (batch)",
};

/** Most items in one rules_tx_property_tax_protest_deadline_batch call. */
export const TX_PROTEST_DEADLINE_BATCH_MAX_ITEMS = 200;

const TAX_YEAR_ISSUE = "expected an integer from 2000 to 2100";
const DATE_ISSUE = "expected a valid YYYY-MM-DD date";

export const TxProtestDeadlineBatchItem = z.object({
  id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Your label for this notice (a client, account or parcel number), echoed back with its result. Unique within the batch.",
    ),
  // Required here; its value is checked per item, so a bad value gives that item an error
  // instead of failing the batch.
  tax_year: z
    .unknown()
    .meta({ type: "integer", minimum: 2000, maximum: 2100 })
    .describe(
      "Tax year being protested, e.g. 2026 (2000–2100). An invalid value is an error for this item only.",
    ),
  notice_delivered_date: z
    .unknown()
    .optional()
    .meta({ type: "string", format: "date" })
    .describe(
      "Date the appraisal district's notice of appraised value was delivered (Tax Code §25.19), YYYY-MM-DD. A mailed notice is presumed delivered on the day it was deposited in the mail (§1.07(c)). Omit if unknown (May 15 is then the only basis). An invalid date is an error for this item only.",
    ),
});

export const TxProtestDeadlineBatchInput = z
  .object({
    items: z
      .array(TxProtestDeadlineBatchItem)
      .min(1)
      .max(TX_PROTEST_DEADLINE_BATCH_MAX_ITEMS)
      .describe(
        "The notices to compute deadlines for (1–200): each one's id, tax year and, if known, notice delivery date. Each result equals rules_tx_property_tax_protest_deadline for that item.",
      ),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    v.items.forEach((x, i) => {
      if (ids.has(x.id))
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "id"],
          message: `duplicate id "${x.id}"`,
        });
      ids.add(x.id);
    });
  });
export type TxProtestDeadlineBatchInput = z.input<
  typeof TxProtestDeadlineBatchInput
>;

type DeadlineFields = Omit<TxProtestDeadline, "disclaimer">;

/** One item of a batch: its deadline (as the single rule returns it) or its input error. */
export type TxProtestDeadlineBatchResult =
  | ({ id: string } & DeadlineFields & { warnings: string[] })
  | {
      id: string;
      error: {
        error: "CalcInputError";
        message: string;
        issues: { path: string; message: string }[];
      };
    };

export interface TxProtestDeadlineBatch {
  results: TxProtestDeadlineBatchResult[];
  summary: {
    items: number;
    answered: number;
    errors: number;
    /** Answered items per deadline, earliest first. */
    by_deadline: { deadline: string; count: number }[];
    earliest: string | null;
    latest: string | null;
  };
  disclaimer: string;
}

/** A YYYY-MM-DD string naming a real calendar day (year 1 or later), as `_valid_date` in Python. */
function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v))
    return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= (days[m - 1] ?? 0);
}

/** One item's deadline, or its input error; the same text in both SDKs. */
function batchItem(item: {
  id: string;
  tax_year?: unknown;
  notice_delivered_date?: unknown;
}): TxProtestDeadlineBatchResult {
  const issues: { path: string; message: string }[] = [];
  const year = item.tax_year;
  if (
    typeof year !== "number" ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  )
    issues.push({ path: "tax_year", message: TAX_YEAR_ISSUE });
  const notice = item.notice_delivered_date ?? undefined;
  if (notice !== undefined && !validDate(notice))
    issues.push({ path: "notice_delivered_date", message: DATE_ISSUE });
  if (issues.length)
    return {
      id: item.id,
      error: {
        error: "CalcInputError",
        message: `invalid input: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
        issues,
      },
    };
  try {
    const r = txProtestDeadline({
      tax_year: year as number,
      ...(notice === undefined
        ? {}
        : { notice_delivered_date: notice as string }),
    });
    const { rule: _rule, disclaimer: _disclaimer, ...fields } = r.value;
    void _rule;
    void _disclaimer;
    return { id: item.id, ...fields, warnings: r.warnings };
  } catch (err) {
    if (!(err instanceof CalcInputError)) throw err;
    return {
      id: item.id,
      error: {
        error: "CalcInputError",
        message: err.message,
        issues: err.issues,
      },
    };
  }
}

/**
 * Protest deadlines for many notices in one call (a consultant's client list): each item is
 * answered by txProtestDeadline (rule rules.tx.property_tax_protest_deadline@2) exactly as a
 * single call would answer it, an item with bad input carries its error without failing the
 * others, and a summary counts the items per deadline.
 */
export function txProtestDeadlineBatch(
  raw: TxProtestDeadlineBatchInput,
): CalcResult<TxProtestDeadlineBatch & { rule: RuleMeta }> {
  const input = parseInput(TxProtestDeadlineBatchInput, raw);
  const t = new Trace();
  const results = input.items.map(batchItem);
  const answered = results.flatMap((r) => ("error" in r ? [] : [r]));
  const counts = new Map<string, number>();
  for (const r of answered)
    counts.set(r.deadline, (counts.get(r.deadline) ?? 0) + 1);
  const byDeadline = [...counts.keys()]
    .sort()
    .map((deadline) => ({ deadline, count: counts.get(deadline) ?? 0 }));
  const errors = results.length - answered.length;
  t.step("Items", results.length, "notices given");
  t.step(
    "Deadlines computed",
    answered.length,
    `${TX_PROTEST_DEADLINE.id}@${TX_PROTEST_DEADLINE.version} for each item`,
  );
  t.step("Items with an input error", errors, "results[i].error");
  const earliest = byDeadline[0]?.deadline ?? null;
  const latest = byDeadline[byDeadline.length - 1]?.deadline ?? null;
  if (earliest !== null && latest !== null) {
    t.step("Earliest deadline", earliest, "earliest answered deadline");
    t.step("Latest deadline", latest, "latest answered deadline");
  }
  if (errors)
    t.warn(
      `${errors} of ${results.length} items have an input error (results[i].error) and no deadline; the other items are answered.`,
    );
  const warned = answered.filter((r) => r.warnings.length > 0).map((r) => r.id);
  if (warned.length)
    t.warn(
      `Results for ${warned.slice(0, 10).join(", ")}${warned.length > 10 ? ` and ${warned.length - 10} more` : ""} carry warnings (results[i].warnings); relay them with each deadline.`,
    );
  if (TX_PROTEST_DEADLINE.verification.status !== "verified")
    t.warn(
      `Rule ${TX_PROTEST_DEADLINE.id}@${TX_PROTEST_DEADLINE.version} is a DRAFT: not yet verified against ${TX_PROTEST_DEADLINE.citations.map((c) => c.law).join("; ")}. Confirm with the official text or a professional before relying on it.`,
    );
  return t.result(
    TX_PROTEST_DEADLINE_BATCH.id,
    TX_PROTEST_DEADLINE_BATCH.version,
    {
      results,
      summary: {
        items: results.length,
        answered: answered.length,
        errors,
        by_deadline: byDeadline,
        earliest,
        latest,
      },
      disclaimer: txProtestDeadlineDisclaimer(
        TX_PROTEST_DEADLINE.verification.verified_at ?? "an unrecorded date",
      ),
      rule: TX_PROTEST_DEADLINE,
    },
  );
}

/** Registry of rule packs, for tool servers and docs generators. */
export const rulePacks = {
  tx_property_tax_protest_deadline: {
    ...TX_PROTEST_DEADLINE,
    description:
      "Deadline to file a Texas property tax protest with the appraisal review board: the later of May 15 or 30 days after the notice of appraised value was delivered, rolled past weekends and Texas legal holidays, plus a conservative file-by date (the last business day on or before the unadjusted deadline). Returns the statute citations, the rule's verification status and a disclaimer. Information about a statutory deadline: not legal or tax advice and not a substitute for the advice of an attorney.",
    input: TxProtestDeadlineInput,
    run: txProtestDeadline,
  },
  tx_property_tax_protest_deadline_batch: {
    ...TX_PROTEST_DEADLINE_BATCH,
    path: "/v1/rules/tx_property_tax_protest_deadline/batch",
    description:
      "Texas property tax protest deadlines for many notices in one call (1–200 items, e.g. a consultant's client list): each item's id, tax year and, if known, notice delivery date. Each result is exactly what rules_tx_property_tax_protest_deadline returns for that item under rule rules.tx.property_tax_protest_deadline@2 (deadline, unadjusted deadline, governing basis, conservative file-by date, skipped days, the item's warnings), echoed with its id; an item with invalid input carries its error and the others are still answered. summary counts the items per deadline, earliest first, with the earliest and latest deadline. The statute citations, the rule's verification status and the disclaimer appear once (value.rule, value.disclaimer). A rules tool: never a registry lookup. Information about statutory deadlines: not legal or tax advice and not a substitute for the advice of an attorney; it does not say whether to protest.",
    input: TxProtestDeadlineBatchInput,
    run: txProtestDeadlineBatch,
  },
} as const;
