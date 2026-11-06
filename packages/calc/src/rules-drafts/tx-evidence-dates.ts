/**
 * DRAFT: Texas protest evidence dates before an appraisal review board hearing (Tax Code
 * §41.43(a-1) and (a-3)(3), §41.461(a), §41.67(d)).
 *
 * Given the first day of the hearing, returns the 14th day before it for the owner's evidence (a
 * condition for the clear-and-convincing standard), a conservative owner date rolled back past
 * weekends and Texas legal holidays, and the §41.67(d) requested-information cutoff (an exclusion
 * rule, not a due date). The holiday
 * logic is the verified deadline rule's (rules.ts). Not verified: see
 * docs/rules/tx-protest-evidence-dates.md.
 */
import { z } from "zod";

import { IsoDate, Trace, parseInput } from "../core.ts";
import type { CalcResult } from "../core.ts";
import { addDays } from "../dates.ts";
import { nonBusinessReason } from "../rules.ts";
import { draftResult } from "./draft.ts";
import type { DraftRuleMeta, DraftValue } from "./draft.ts";

const TX41 = "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm";
const RETRIEVED = "2026-11-06";

export const TX_PROTEST_EVIDENCE_DATES: DraftRuleMeta = {
  id: "rules.tx.protest_evidence_dates",
  version: 1,
  jurisdiction: "us-tx",
  title:
    "Texas protest evidence dates before an appraisal review board hearing",
  citations: [
    {
      law: "Tex. Tax Code §41.43(a-3)(3)",
      url: `${TX41}#41.43`,
      retrieved: RETRIEVED,
      covers:
        "owner_evidence_by_unadjusted: the owner files with the appraisal review board and delivers to the chief appraiser, not later than the 14th day before the date of the first day of the hearing, information sufficient for the clear-and-convincing standard of (a-3), which applies only if the appraised value was lowered under this subtitle in the preceding tax year and that value was not set by a §1.111(e) agreement",
    },
    {
      law: "Tex. Tax Code §41.43(a-1)",
      url: `${TX41}#41.43`,
      retrieved: RETRIEVED,
      covers:
        "owner_evidence_by_unadjusted: for property with a market or appraised value of $1 million or less, an appraisal by a certified appraiser is delivered to the chief appraiser not later than the 14th day before the date of the first day of the hearing (the 180-day appraisal date is not computed)",
    },
    {
      law: "Tex. Tax Code §41.43(a-5)",
      url: `${TX41}#41.43`,
      retrieved: RETRIEVED,
      covers:
        "the (a-3)(3) filing is a condition for the higher standard, not a duty of the owner",
    },
    {
      law: "Tex. Tax Code §41.461(a)",
      url: `${TX41}#41.461`,
      retrieved: RETRIEVED,
      covers:
        "requested_information_cutoff: at least 14 days before a hearing the chief appraiser informs the owner of the right to request the data, schedules, formulas and other information the chief appraiser will introduce",
    },
    {
      law: "Tex. Tax Code §41.67(d)",
      url: `${TX41}#41.67`,
      retrieved: RETRIEVED,
      covers:
        "requested_information_cutoff: an exclusion rule, not a due date: information previously requested under §41.461 and not delivered at least 14 days before the scheduled or postponed hearing may not be used, except to rebut",
    },
    {
      law: "Tex. Tax Code §1.06",
      url: "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.1.htm#1.06",
      retrieved: RETRIEVED,
      covers:
        "owner_evidence_conservative_by: the weekend and holiday rule for a last day; whether it moves a 'not later than the 14th day before' date is not settled here, so the date is rolled back, not forward",
    },
    {
      law: "Tex. Gov't Code §662.003",
      url: "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.662.htm#662.003",
      retrieved: RETRIEVED,
      covers:
        "owner_evidence_conservative_by: the Texas legal holidays skipped, on their actual dates, as in rules.tx.property_tax_protest_deadline",
    },
  ],
  verification: {
    status: "draft",
    notes:
      "Drafted from the official text of Tax Code §§1.06, 41.43, 41.461, 41.66 and 41.67, read on 2026-11-06 from the files behind statutes.capitol.texas.gov. Not checked by a named maintainer. Open point for the verifier: whether §1.06 moves a 'not later than the 14th day before' date that falls on a weekend or holiday; the pack returns the unadjusted date and a date rolled back to the previous business day, which is timely under either reading.",
  },
  not_covered: [
    "the §41.43(a-1) appraisal date: the appraisal must be 'performed not later than the 180th day before the date of the first day of the hearing', which can be read as a latest date or as a window, so no date is computed",
    "§41.66(a): the copy of the appraisal review board's hearing procedures, delivered on request not later than the 10th day before the hearing",
    "county and appraisal review board practice: local procedures, evidence portals and exchange rules",
    "postponements and rescheduled hearings (including §41.66(h)): rerun with the new first day of the hearing",
  ],
};

export const TxProtestEvidenceDatesInput = z.strictObject({
  hearing_date: IsoDate.describe(
    "Date of the first day of the appraisal review board hearing on the protest, YYYY-MM-DD, as scheduled (or as postponed).",
  ),
});
export type TxProtestEvidenceDatesInput = z.input<
  typeof TxProtestEvidenceDatesInput
>;

export interface TxProtestEvidenceDates {
  hearing_date: string;
  /** The 14th day before the first day of the hearing (§41.43(a-1), (a-3)(3)). */
  owner_evidence_by_unadjusted: string;
  /** The unadjusted date, or the business day before it if it is a Saturday, Sunday or Texas legal holiday: timely under either reading of §1.06. */
  owner_evidence_conservative_by: string;
  owner_evidence_skipped_non_business_days: { date: string; reason: string }[];
  /** 14 days before the scheduled or postponed hearing: information previously requested under §41.461 and not delivered by then may not be used, except to rebut (§41.67(d)). An exclusion rule, not a due date. */
  requested_information_cutoff: string;
  not_covered: string[];
}

export function txProtestEvidenceDates(
  raw: TxProtestEvidenceDatesInput,
): CalcResult<DraftValue<TxProtestEvidenceDates>> {
  const input = parseInput(TxProtestEvidenceDatesInput, raw);
  const t = new Trace();
  const hearing = input.hearing_date;
  t.step("First day of the hearing", hearing, "as given");
  const hearingReason = nonBusinessReason(hearing);
  if (hearingReason !== undefined)
    t.warn(
      `The hearing date ${hearing} falls on ${hearingReason}; check it against the notice of hearing.`,
    );

  const unadjusted = t.step(
    "Owner evidence by (unadjusted)",
    addDays(hearing, -14),
    `${hearing} − 14 calendar days: "not later than the 14th day before the date of the first day of the hearing" (§41.43(a-1), (a-3)(3))`,
  );
  const skipped: { date: string; reason: string }[] = [];
  let conservative = unadjusted;
  for (
    let reason = nonBusinessReason(conservative);
    reason !== undefined;
    reason = nonBusinessReason(conservative)
  ) {
    skipped.push({ date: conservative, reason });
    conservative = addDays(conservative, -1);
  }
  t.step(
    "Owner evidence, conservative date",
    conservative,
    skipped.length > 0
      ? `rolled back past ${skipped.map((s) => `${s.date} (${s.reason})`).join(", ")} to the previous business day`
      : "the unadjusted date is a business day",
  );
  if (skipped.length > 0)
    t.warn(
      `${unadjusted} falls on ${skipped[0]?.reason}. Whether Tax Code §1.06 moves a "not later than the 14th day before" date to the next business day is not settled here; ${conservative}, the business day before, is timely under either reading.`,
    );
  t.warn(
    "The owner's 14-day date matters only for the clear-and-convincing standard, and only under its conditions: §41.43(a-3) applies only if the appraised value was lowered under this subtitle in the preceding tax year and that value was not set by a written agreement under §1.111(e); §41.43(a-1) applies only to property with a market or appraised value of $1 million or less and an appraisal by a certified appraiser. Filing is not a duty (§41.43(a-5)).",
  );

  const cutoff = t.step(
    "Requested-information cutoff",
    addDays(hearing, -14),
    `${hearing} − 14 days: information previously requested under §41.461 and "not delivered to the protesting party at least 14 days before the scheduled or postponed hearing may not be used or offered in any form as evidence in the hearing", except "information offered to rebut evidence or argument presented at the hearing by the protesting party or that party's designated agent" (§41.67(d))`,
  );
  t.warn(
    "The requested-information cutoff is an exclusion rule, not a due date, and a postponed hearing moves it: §41.67(d) counts from the scheduled or postponed hearing. Rerun with the new hearing date.",
  );

  return draftResult(t, TX_PROTEST_EVIDENCE_DATES, {
    hearing_date: hearing,
    owner_evidence_by_unadjusted: unadjusted,
    owner_evidence_conservative_by: conservative,
    owner_evidence_skipped_non_business_days: skipped,
    requested_information_cutoff: cutoff,
    not_covered: [...TX_PROTEST_EVIDENCE_DATES.not_covered],
  });
}
