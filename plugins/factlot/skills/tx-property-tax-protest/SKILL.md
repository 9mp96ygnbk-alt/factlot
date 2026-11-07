---
name: tx-property-tax-protest
description: Texas property tax protest filing deadline. Use when the user asks when a notice of protest to a Texas appraisal review board (ARB) is due, given a tax year and optionally the date the notice of appraised value was delivered. Calls FactLot rules_tx_property_tax_protest_deadline (rules.tx.property_tax_protest_deadline@2), which applies weekend and Texas legal holiday rollover and returns statute citations, instead of reasoning about dates in-context. A date calculation, not a substitute for the advice of an attorney.
---

# Texas property tax protest deadline

FactLot is software. It is not a property tax consultant under Texas Occupations Code chapter 1152,
does not prepare, file or advise on protests, and does not represent owners before an appraisal
review board. If you provide property tax services to others for compensation, your own
registration obligations apply.

The general deadline to file a notice of protest with the appraisal review board is the later of
May 15 or 30 days after the notice of appraised value was delivered (Tax Code §41.44(a)(1)),
rolled past weekends and Texas legal holidays (§1.06). The tool also returns a conservative file-by
date: the latest business day on or before the unadjusted date, which does not rely on the
rollover. It returns the governing basis, the days it skipped and why, the statute citations, and
the rule's verification status.

## Gather these inputs

| Argument                | Meaning                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tax_year`              | Integer tax year the protest concerns (2027)                                                                                                                                         |
| `notice_delivered_date` | `YYYY-MM-DD` the appraisal district's notice was delivered. A mailed notice counts as delivered the day it was deposited in the mail. Omit if unknown; May 15 is then the only basis |

Ask for the notice date. If the user cannot find it, run without it and relay the warning that a
notice delivered after April 15 moves the deadline later than May 15.

## Call

Tool: `rules_tx_property_tax_protest_deadline`. Worked example (vector "Juneteenth then a weekend"):

```json
{ "tax_year": 2026, "notice_delivered_date": "2026-05-20" }
```

Returned: `deadline` 2026-06-22 (`unadjusted_deadline` 2026-06-19, skipped as Juneteenth and then
the weekend), conservative file-by date 2026-06-18. Without a notice date, `{"tax_year": 2027}`
returns `deadline` 2027-05-17 (May 15 falls on a Saturday) and conservative file-by date
2027-05-14.

## Report

Give the deadline and the conservative file-by date (`conservative_file_by`), name the governing
basis, list the skipped days, and quote the statutes in `value.rule.citations` and the rule's
verification status (`value.rule.verification.status`) as returned. Say that this is a date
calculation, not legal advice and not a substitute for the advice of an attorney, and that the
appraisal district's notice and instructions govern the user's own case.

## Rules

- Never work out these dates in-context; report the tool's values as returned.
- Cite the rule ID from `provenance.formula` (`rules.tx.property_tax_protest_deadline@2`) and the
  statutes in `value.rule.citations`.
- Surface every entry in `warnings` and the verification status.
- The rule covers the general deadline only, not the other §41.44 deadlines, §25.25 corrections,
  or late-protest relief. Do not say whether to protest or how to file.
- If the FactLot MCP tools are unavailable, POST the same arguments to
  `https://api.factlot.com/v1/rules/tx_property_tax_protest_deadline`.
