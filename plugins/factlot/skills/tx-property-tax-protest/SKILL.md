---
name: tx-property-tax-protest
description: Texas property tax protest deadline. Use when the user asks when a Texas property tax protest (appraisal review board, ARB) must be filed, given a tax year and optionally the date the notice of appraised value was delivered. Calls FactLot rules_tx_property_tax_protest_deadline (rules.tx.property_tax_protest_deadline@1), which applies weekend and Texas legal holiday rollover and returns statute citations, instead of reasoning about dates in-context.
---

# Texas property tax protest deadline

Deadline to file a protest with the appraisal review board: the later of May 15 or 30 days after the notice of appraised value was delivered, rolled past weekends and Texas legal holidays, plus a conservative file-by date. The tool returns the governing basis, the days it skipped and why, the statute citations, and the rule's verification status.

## Gather these inputs

| Argument                | Meaning                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tax_year`              | Integer year being protested (2026)                                                                                                                                                  |
| `notice_delivered_date` | `YYYY-MM-DD` the appraisal district's notice was delivered. A mailed notice counts as delivered the day it was deposited in the mail. Omit if unknown; May 15 is then the only basis |

Ask for the notice date. If the user cannot find it, run without it and relay the warning that a notice delivered after April 15 moves the deadline later than May 15.

## Call

Tool: `rules_tx_property_tax_protest_deadline`. Worked example (vector "Juneteenth then a weekend"):

```json
{ "tax_year": 2026, "notice_delivered_date": "2026-05-20" }
```

Returned: `deadline` 2026-06-22 (`unadjusted_deadline` 2026-06-19, skipped as Juneteenth and then the weekend), `recommended_file_by` 2026-06-18. Without a notice date, `{"tax_year": 2027}` returns `deadline` 2027-05-17 (May 15 falls on a Saturday) and `recommended_file_by` 2027-05-14.

## Report

Give the deadline and the recommended file-by date, name the governing basis, list the skipped days, and quote the statutes in `value.rule.citations` and the rule's verification status (`value.rule.verification.status`) as returned. Tell the user to confirm with the appraisal district or a property tax professional before relying on the date; this is a date calculation, not legal advice.

## Rules

- Never work out these dates in-context; report the tool's values as returned.
- Cite the rule ID from `provenance.formula` (`rules.tx.property_tax_protest_deadline@1`) and the statutes in `value.rule.citations`.
- Surface every entry in `warnings` and the verification status.
- If the FactLot MCP tools are unavailable, POST the same arguments to `https://api.factlot.com/v1/rules/tx_property_tax_protest_deadline`.
