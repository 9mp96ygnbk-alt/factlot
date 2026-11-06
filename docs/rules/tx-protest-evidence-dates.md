# DRAFT: Texas protest evidence dates

**Status: draft.** No named maintainer has checked this pack against the official text. Do not
rely on it. Every result says `status: "draft"` and starts its warnings with "DRAFT — not verified
against the official text; do not rely on it."

|                   |                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Pack              | `tx_protest_evidence_dates`                                                                                   |
| Rule ID           | `rules.tx.protest_evidence_dates@1`                                                                           |
| Code              | `packages/calc/src/rules-drafts/tx-evidence-dates.ts`, `python/src/factlot/rules_drafts/tx_evidence_dates.py` |
| Vectors           | `spec/vectors/rules/drafts/tx_protest_evidence_dates.json` (expected dates from `reference.py`)               |
| Holiday logic     | the verified `rules.tx.property_tax_protest_deadline` calendar (`texasHolidays` / `texas_holidays`)           |
| Sources retrieved | 2026-11-06                                                                                                    |

## What it does

Given the first day of an appraisal review board (ARB) hearing on a protest, it returns:

- `owner_evidence_by_unadjusted`: the hearing date minus 14 calendar days. Delivering the owner's
  evidence by this date is a condition for the district to carry the higher clear-and-convincing
  burden, and only under the other conditions of each subsection:
  - §41.43(a-3) applies only if the appraised value was lowered under this subtitle in the
    preceding tax year and that value was not set by a written agreement under §1.111(e);
  - §41.43(a-1) applies only to property with a market or appraised value of $1 million or less,
    and only with an appraisal by an appraiser certified under Occupations Code ch. 1103;
  - neither is a duty: under §41.43(a-5), (a-3)(3) "does not impose a duty on a property owner to
    provide any information".
- `owner_evidence_conservative_by`: the same date, or, if it is a Saturday, Sunday or Texas legal
  holiday, the business day before it, with `owner_evidence_skipped_non_business_days` listing each
  day skipped and why. Whether Tax Code §1.06 moves a "not later than the 14th day before" date
  forward to the next business day is not settled here, so the pack gives the earlier date, which is
  timely under either reading.
- `requested_information_cutoff`: the hearing date minus 14 days. This is an exclusion rule, not a
  due date: information previously requested under §41.461 and not delivered at least 14 days
  before the scheduled or postponed hearing may not be used, except to rebut (§41.67(d)). A
  postponed hearing moves it; rerun with the new hearing date.
- `not_covered`: what the pack leaves out (below).

```ts
runDraftRule(
  "tx_protest_evidence_dates",
  { hearing_date: "2027-06-14" },
  { acknowledgeDraft: true },
);
// owner_evidence_by_unadjusted 2027-05-31 (Memorial Day), owner_evidence_conservative_by
// 2027-05-28 (skips Memorial Day, Sunday, Saturday), requested_information_cutoff 2027-05-31
```

```python
factlot.run_draft_rule("tx_protest_evidence_dates", {"hearing_date": "2027-06-14"}, acknowledge_draft=True)
```

Holidays are those of the verified protest-deadline rule: Gov't Code §662.003(a) and (b) on their
actual dates, with observed (shifted) dates and Columbus Day not treated as holidays. When a day is
in doubt, treating it as a business day makes the rolled-back date later, so a holiday the list
misses could put the conservative date on that holiday; it can never put it after the unadjusted
date.

## Sources and operative text

Retrieved 2026-11-06 from the Texas Legislature's statutes site. The pages at
statutes.capitol.texas.gov render with JavaScript; the same text is served as static files from
the site's file server (`https://tcss.legis.texas.gov/resources/TX/htm/TX.41.htm` and `TX.1.htm`),
which is where it was read.

- Tax Code chapter 41: https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm
- Tax Code chapter 1: https://statutes.capitol.texas.gov/Docs/TX/htm/TX.1.htm
- Gov't Code chapter 662: https://statutes.capitol.texas.gov/Docs/GV/htm/GV.662.htm

### Owner's evidence, value or unequal-appraisal protest — §41.43(a-3)(3)

> (3) not later than the 14th day before the date of the first day of the hearing, the property
> owner files with the appraisal review board and delivers to the chief appraiser:

followed by (A) information sufficient to determine the appraised or market value, or (B)
information sufficient to determine whether the property was appraised unequally. Encoded:
`owner_evidence_by_unadjusted` = first day of the hearing − 14 days.

### Owner's appraisal, property of $1 million or less — §41.43(a-1)

> If in the protest relating to a property with a market or appraised value of $1 million or less
> as determined by the appraisal district the property owner files with the appraisal review board
> and, not later than the 14th day before the date of the first day of the hearing, delivers to the
> chief appraiser a copy of an appraisal of the property performed not later than the 180th day
> before the date of the first day of the hearing by an appraiser certified under Chapter 1103,
> Occupations Code, …

Encoded: the same 14-day date. Not encoded: the 180-day date (see Not covered).

### Not a duty — §41.43(a-5)

> Subsection (a-3)(3) does not impose a duty on a property owner to provide any information in a
> protest authorized by Section 41.41(a)(1) or (2). That subdivision is merely a condition to the
> applicability of the standard of evidence provided by Subsection (a-3).

### District's evidence — §41.461(a) and §41.67(d)

§41.461(a):

> At least 14 days before a hearing on a protest, the chief appraiser shall:

including (a)(2), to "inform the property owner that the owner or the agent of the owner is
entitled on request to a copy of the data, schedules, formulas, and all other information the chief
appraiser will introduce at the hearing to establish any matter at issue".

§41.67(d):

> Information that was previously requested under Section 41.461 by the protesting party that was
> not delivered to the protesting party at least 14 days before the scheduled or postponed hearing
> may not be used or offered in any form as evidence in the hearing, including as a document or
> through argument or testimony. This subsection does not apply to information offered to rebut
> evidence or argument presented at the hearing by the protesting party or that party's designated
> agent.

Encoded: `requested_information_cutoff` = hearing date − 14 days, an exclusion rule and not a due
date. "At least 14 days before" is read as delivered on or before that date. The rebuttal exception
in the second sentence is not computed; the result states it.

### Weekends and holidays — §1.06

> An act is timely if: (1) the last day for the performance of the act is: (A) a Saturday, Sunday,
> or legal state or national holiday; … and (2) the act is performed on the next regular business
> day.

Not applied forward. Whether a date fixed as "not later than the 14th day before" a hearing is a
"last day for the performance of the act" that §1.06 extends is the open point below; the pack
rolls the date back instead.

## Not covered (gaps)

- **The §41.43(a-1) 180-day date.** The appraisal must be "performed not later than the 180th day
  before the date of the first day of the hearing". Read literally that is a latest date (an
  appraisal performed long before the hearing would qualify), but it can also be read as a window
  of 180 days before the hearing. The direction is ambiguous, so no date is computed.
- **§41.66(a):** the copy of the ARB's hearing procedures, which on request "shall be delivered to
  the property owner not later than the 10th day before the date the hearing on the protest
  begins".
- **County and ARB practice:** local hearing procedures, evidence portals and exchange rules.
- **Postponements and rescheduled hearings** (including §41.66(h), postponement when the chief
  appraiser did not comply with §41.461): rerun with the new first day of the hearing.

## Verification checklist

1. Read §41.43(a-1), (a-3), (a-5), §41.461(a), §41.66(a) and (h), §41.67(d) and §1.06 in the
   official text yourself and note the date; confirm none has been amended since 2026-11-06.
2. Read each quotation in this page against the official text, word for word.
3. Decide the open point: does §1.06 extend a "not later than the 14th day before" date that falls
   on a weekend or holiday? If it does, the unadjusted date rolled forward is also timely; record
   the answer and whether to add that date. Until then the pack returns only the earlier date.
4. Confirm or reject each interpretation:
   - "the 14th day before the date of the first day of the hearing" is the hearing date minus 14
     calendar days;
   - "at least 14 days before the scheduled or postponed hearing" (§41.67(d)) gives the same date;
   - the holiday list of the verified deadline rule is the right list for these dates.
5. Recompute by hand "hearing 14 days after Memorial Day", "year boundary" and "Confederate Heroes
   Day and MLK Day back to back".
6. Accept the gap list, or open issues for gaps that must close first.
7. Then promote as described in `docs/rules.md`.
