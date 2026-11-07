# Reports: XLSX, PDF and ICS from FactLot results

`report_create` (MCP) and `POST /v1/reports` (REST) turn a FactLot tool result into the document a
CRE analyst or a Texas property tax consultant would otherwise build by hand: a workbook (with live
formulas where the arithmetic is simple, and live checks everywhere), a paginated PDF, or a
calendar. Hosted only (api.factlot.com).

**Status:** open on api.factlot.com since 2026-11-07. `/v1/plans` shows `reports.available: true`
and the per-plan monthly allowance. (A self-hosted deployment without `REPORTS_ENABLED` answers
503 `ReportsUnavailable` and does not list `report_create`.)

Reports are **deterministic** and **built by code, with no model**. The same request gives the same
document. The only exception is the generation time: it is printed in the footer, stamped in the PDF
metadata and in each ICS event's `DTSTAMP`. Every kind but `lease_abstract` is built from FactLot's
own run of the tool on the `arguments` you send, so every computed number in it is a figure FactLot
computed. Numbers follow one convention in every PDF and workbook: money to the cent with the sign
first (`-$25,000.00`); rates as percentages to two decimals (0.0625 is 6.25%), or four for a fine
rate such as a periodic discount rate; ratios such as a DSCR to two decimals (`1.25x`); audit-trail
values to 6 significant digits, with a note that the full precision is in the tool result; years,
periods, months and counts without digit grouping (`2026`). A workbook cell holds the tool's full
number and only its number format follows the convention. The Inputs section shows the arguments
exactly as sent.

## Kinds

| `kind`                 | Reads the result of                                          | Formats              |
| ---------------------- | ------------------------------------------------------------ | -------------------- |
| `tx_unequal_appraisal` | `calc_tx_unequal_appraisal`                                  | `pdf`, `xlsx`        |
| `lease_abstract`       | `doc_abstract_lease`                                         | `pdf`, `xlsx`        |
| `cam_reconciliation`   | `calc_cam_reconciliation` or `calc_cam_reconciliation_batch` | `pdf`, `xlsx`        |
| `debt_sizing`          | `calc_debt_sizing`                                           | `pdf`, `xlsx`        |
| `asc842_schedule`      | `calc_lease_remeasurement_asc842`                            | `pdf`, `xlsx`        |
| `compare_proposals`    | `calc_compare_proposals`                                     | `pdf`, `xlsx`        |
| `dcf_summary`          | `calc_dcf_pro_forma`                                         | `pdf`, `xlsx`        |
| `critical_dates`       | `calc_critical_dates`                                        | `pdf`, `xlsx`, `ics` |
| `tx_protest_deadline`  | `rules_tx_property_tax_protest_deadline` or its `_batch`     | `ics`, `pdf`         |

- **tx_unequal_appraisal.** The PDF is an evidence packet: the subject, the comparables grid, the
  adjustments with their reasons, the adjusted values in ascending order, the median, the
  difference, the warnings, every citation, the statutes cited, the conventions and the tool's
  steps. The workbook follows the layout of
  [`examples/reconciliation/tx_unequal_appraisal.py`](../examples/reconciliation/tx_unequal_appraisal.py):
  ReadMe, Reconcile, and Grid with live formulas and the evidence-trail columns. Steps and Law
  sheets follow. The grid normalizes from each comparable's area as the example does. On Grid the
  notice is one merged row of fixed height above a short subject block, and only the header row
  and the comparable column are frozen. The title and prepared-for line, when sent, are printed on
  ReadMe and Grid as supplied by the caller. Both documents show the normalizing area, each
  comparable's area and adjusted $/SF; the workbook also has the $/SF adjustment total and
  reconciles the adjusted $/SF. A comparable's or the subject's `label` and `address`, when sent,
  are printed next to its id. The statutes table's last column is the source URL (a link in the
  PDF). The Texas disclaimer is on the PDF's cover and in every page's footer. A **Sources and
  rights** block (in the PDF after the grid, in the workbook at the top of the Provenance sheet)
  lists each distinct source document the subject's and the comparables' citations name, with
  its title, as-of date, URL, the rights its publisher states word for word (AI use,
  redistribution, license, attribution) and which properties cite it. The source details come
  from `context.sources`: send the `sources` of `registry_tx_equity_candidates` as returned. A
  right of `unknown`, or a source sent without rights, is printed as "rights not stated by the
  publisher: relay to the recipient"; a cited document with no entry in `context.sources` says
  that its source and rights were not sent. Comparables without a citation, or cited without a
  document ID, are named below the table and stay in the grid: no comparable is left out
  because of its source's rights.
- **lease_abstract.** The documents in the order applied. Each current term comes with its quote,
  page and document, what it superseded, conflicts and open items. Then come the values that need
  review and any pending amendments.
- **cam_reconciliation.** One tenant's statement: shares, gross-up, cap, admin fee, base-year or stop
  deduction, charge, estimates and balance due, then the terms as sent: pro rata share, gross-up
  occupancies and the tool's gross-up factor, the tenant's occupancy fraction, the cap method, rate
  and reference amount, and the admin fee rate and when it applies. For a whole pool: the building totals, why expenses
  were not recovered, and every tenant's statement.
- **debt_sizing.** The loan each test allows, the binding constraint, the resulting metrics, and any
  refinance gap and stress table. With the arguments, an amortization summary from
  `calc_amortization_schedule` on the max loan.
- **asc842_schedule.** The remeasurement, and the liability and right-of-use schedules by period.
- **compare_proposals.** The proposals side by side on the tool's metric (discounted net effective
  rent, or effective occupancy cost), with the audit trail. With the arguments, each proposal's
  terms, leasing commissions and downtime. The proposal the metric ranks first is called
  "first-ranked", never "best".
- **dcf_summary.** Value, reversion, the annual cash flows and the lease events.
- **critical_dates.** The dated list and the renewal and termination options. The `ics` calendar has
  an event for each date and each renewal notice window as one multi-day event. Every notice
  deadline and window has a reminder 30 days before; a deadline less than 30 days after the
  report is generated also gets a reminder an hour after generation, so one always fires. When
  `business_day_roll` moves a notice deadline to a **later** business day, the calendar event is
  dated on the contractual (unrolled) date and the later date is only described: only a lease
  clause that extends a deadline falling on a non-business day allows it. Each event's
  description carries the tool's warnings about its dates (a warning that names no date is put on
  every deadline). UIDs do not change when the calendar is generated again. Event titles are short
  (the calendar's name is its `X-WR-CALNAME`), and a renewal window is one multi-day event, not
  also a one-day "window opens" event. Dates before the day the calendar is generated are left
  out; send `"include_past": true` to keep them.
- **tx_protest_deadline.** A calendar for the Texas protest filing deadline, from FactLot's run of
  `rules_tx_property_tax_protest_deadline` on `arguments` (`tax_year`, and optionally
  `notice_delivered_date` and `as_of`), or of `rules_tx_property_tax_protest_deadline_batch` when
  `arguments` has `items` (`[{id, tax_year, notice_delivered_date?}]`, up to 200): one calendar
  for a portfolio. Each notice gets two all-day events: "Texas protest filing deadline, tax year
  N" on the statutory `deadline`, and "Conservative file-by date, tax year N" on
  `conservative_file_by`, which says why it is earlier (the unadjusted date is not a business
  day and §1.06 moves the deadline later) or that it is the same day. In a batch each title ends
  with the item's `id` in brackets. Each description has the basis (May 15, or the 30th day after
  the notice was delivered), the days the deadline was moved past, the status and days remaining
  as of the rule's `as_of`, the statutes the rule cites with its verification note (the
  §41.44(a)(1) text as checked), every warning and note of the rule (what it does not cover: late
  protests under §41.44(b)-(c-3), §25.25 motions), the rule's disclaimer, both Texas disclaimer
  sentences and "FactLot is software, not a property tax consultant under Texas Occupations Code
  chapter 1152; it does not prepare, file or advise on protests." The file-by event has reminders
  30 and 7 days before, plus one an hour after generation when it is under 30 days away (when the
  file-by date is already behind and the deadline is not, the reminder is on the deadline). When
  the requested tax year's deadline has passed, the events are the rule's `next_season` dates
  (the next tax year, May 15 basis) and each description says the requested year passed;
  `"include_past": true` keeps the passed year's events too. Dates before the generation day
  (US Central time) are left out unless `include_past` is set, and the calendar's description
  says how many. Without `as_of`, the status is measured from the generation day in US Central
  time. UIDs depend only on the notice (the batch item's `id`, else the `context.title`), the tax
  year and the event, so a calendar generated again (on another day, or after a notice date
  changes) updates its events instead of adding new ones; send a `title` per property when
  importing several single-notice calendars. A batch item the rule cannot answer is refused (400
  `ArgumentsError`, naming `arguments.items.<i>`), never left out. The `pdf` is a deadline sheet:
  the same dates in a table, the statutes, warnings and notes, then the rule's steps, the
  arguments and the provenance. Every date is the rule's; nothing in it says whether to protest.

Every calculator document has the line `Generated by FactLot <version> on <UTC time> from
<tool>@<formula version>; numbers are the tool's results; see https://factlot.com/terms`. It is in
the PDF page footer, the workbook's ReadMe and print footer, and each calendar event's description
(`tx_protest_deadline` says `dates are the rule's results` instead).
A lease abstract never says its numbers are the tool's results. Built from a result you send, every
page (PDF footer, each sheet's print footer) starts with `Abstract values as supplied by the caller;
FactLot did not recompute them.`; built from the documents' text in `arguments`, with `Abstract
values as supplied by the caller and checked against the lease text sent.` Every Texas
document also says it is not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)), not
legal or tax advice, and not a substitute for the advice of an attorney. Nothing in a report
recommends anything.

Workbooks keep the tool's figures as numbers with number formats, and each calculator workbook
has a Steps sheet with the tool's audit trail. Which cells are live Excel formulas depends on the
kind:

- `tx_unequal_appraisal`: the Grid is live arithmetic from the inputs (normalization, factors,
  adjusted values, $/SF, the median and the difference), reconciled on the Reconcile sheet.
- `dcf_summary`: on the CashFlows sheet the subtotals (gross revenue, effective gross revenue, net
  operating income, cash flow before debt service) are live formulas over the lines above them.
- The other kinds are value workbooks: their figures are FactLot's numbers, tied out by live
  formulas on a Checks sheet (a CAM statement's charge and balance, a debt sizing's binding test,
  an ASC 842 schedule's totals, a DCF's value, net sale proceeds and each year's NOI and cash flow).

A check puts the formula's result beside the number FactLot returned, with a Difference column and
a Status. FactLot evaluates every formula before it writes the file, so a viewer that does not
recalculate still shows numbers. Excel recalculates the formulas when the file opens. When the
arguments are sent, an Inputs section lists them as sent; in the PDF a list of more than six plain
values is one row with its count and first values, and the workbook's Inputs sheet has all of them.

## What a report accepts

```json
{
  "kind": "debt_sizing",
  "format": "pdf",
  "arguments": { "noi": 2205000, "value": 36000000, "rate_annual": 0.0625 },
  "context": {
    "title": "100 Main Street refinance",
    "prepared_for": "Credit committee"
  },
  "inline": false
}
```

- `arguments` are the tool's arguments, and every kind but `lease_abstract` requires them. FactLot
  runs the tool on them and builds the document from that run only. Without them the answer is
  `400 ArgumentsRequired`.
- `input` is a tool result. For the calculator kinds it is never used: when you send one with the
  arguments, the answer's `result_mismatch` says whether it differs from FactLot's run, and the
  document says the same. For `lease_abstract`, FactLot can only rerun the abstract from the
  documents' text, so it also accepts the `doc_abstract_lease` result as `input` alone. It checks
  that result's exact shape (no extra fields) and its counts, and labels every page as described
  above. You can send the MCP `structuredContent` or the REST body; `provenance` may be included.
- `context` (optional) is text only: `title` and `prepared_for` (at most 120 characters each). For
  `tx_unequal_appraisal` it can also carry a `subject_citation` and `comparable_citations`, keyed by
  comparable id (or `#1`, `#2`… for a comparable without one); a locator is at most 200 characters.
  And `sources` (up to 200): `registry_tx_equity_candidates`' `sources` entries as returned
  (`document_id`, `title`, `uri` as an http(s) URL, `as_of`, `rights`), printed in the Sources and
  rights block; their text goes through the same advice filter as other caller text.
- `inline: true` also returns the file as base64 when it is under 1 MiB: `content_base64` over
  REST, an embedded resource over MCP.
- `include_past: true` (`ics` only: `critical_dates` and `tx_protest_deadline`) keeps dates before
  today in the calendar.

Text you supply is printed as yours: the document labels it "supplied by the caller". That covers
the title and prepared-for line, citations and their locators, each `tx_protest_deadline` batch
item's `id`, and for `tx_unequal_appraisal` the
comparable and subject ids, their optional `label` (at most 80 characters) and `address` (at most
120), and each adjustment's label and reason (a reason is at most 200 characters). A report
states arithmetic only, so such text is refused when it reads as advice or a valuation. The test
looks for whole advice phrases, not word stems: `you should` or `should`, `we recommend` or
`recommended`, `will win`, `worth $…`, `is worth`, `opinion of value`, `market value is`, `our
appraisal`, `appraised at` followed by a figure, `protest your`, `grounds to protest`, `you can
save`, `savings of`, `tax savings`. Names and statutory terms pass: Worthington Plaza, First
Savings Bank, Protestant Church, Fort Worth, an appraisal district, the appraisal review board, an
appraisal notice or notice of appraised value, the appraisal roll, unequal appraisal, a protest
packet, deadline or hearing, a tax protest, and the disclaimer's own denial "not an appraisal or an
opinion of value". A refusal is `422 TextNotAllowed` and names the field
and the phrase.

A calculator report never carries numbers FactLot did not compute. Refusals say why in `issues`:

| Code                | When                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ArgumentsRequired` | A calculator kind without `arguments`.                                                                                        |
| `ArgumentsError`    | The tool refused `arguments` (its own `issues`, under `arguments.`).                                                          |
| `NotAToolResult`    | `lease_abstract` only: the `input` is not the tool's result (a missing or extra field), or its counts do not match its lists. |
| `FormulaVersion`    | `lease_abstract` only: the `input` is from another version of the formula; call the tool again.                               |
| `TextNotAllowed`    | `422`: caller text with advice or valuation wording; `issues` names each field.                                               |
| `InputError`        | The request itself: unknown `kind`, a `format` the kind does not offer, bad `context`, caller text over its length limit.     |

Each issue names its path (`arguments` itself when the arguments are not an object) and says
`missing` for a required field that was not sent. `next` says where the shape is: this page for
the request, and the tool's `inputSchema` in `GET https://api.factlot.com/v1/tools` for its
arguments; for a wrong `format` it lists the formats the kind offers.

## The answer and the download

```json
{
  "download_url": "https://api.factlot.com/v1/reports/d/<token>",
  "expires_at": "2026-11-08T12:00:00.000Z",
  "bytes": 12688,
  "sha256": "<hex SHA-256 of the file>",
  "filename": "factlot-debt-sizing-2026-11-07.pdf",
  "content_type": "application/pdf",
  "kind": "debt_sizing",
  "format": "pdf",
  "source": "calc_debt_sizing@3",
  "check": "computed",
  "generated_at": "2026-11-07T12:00:00.000Z",
  "billed": true,
  "reports": {
    "used": 1,
    "limit": 50,
    "remaining": 49,
    "resets_at": "2026-12-01T00:00:00.000Z"
  }
}
```

`billed` is in every answer, refusals included: `true` when this request counted against the month
(a report built and stored), `false` otherwise. `source` names the tool and its formula version; a
lease abstract's is `doc_abstract_lease` (the abstract has no formula version).

`check` is `computed` when the document is built from FactLot's run of the tool on `arguments`, and
`supplied` for a lease abstract built from the result you sent. `result_mismatch` is there when you
sent `input` with `arguments`: `true` when it differs from FactLot's run (it was not used either
way).

`GET download_url` returns the file with its content type, `Content-Disposition: attachment`,
`Cache-Control: no-store` and `X-FactLot-Report-SHA256`. The link is the only credential, so no key
is needed and you should share it like the file itself. A link works for 24 hours. After that, or
for an unknown token, the answer is `404`. Downloads are rate limited per link and per address.
FactLot keeps the file for those 24 hours only, under a hash of the link's random 256-bit token.
Nothing else about the request is stored. Files over 25 MiB are refused.

The file is stored in Workers KV, which takes up to about a minute to reach every Cloudflare
location. A download from somewhere other than where the report was made can answer `404` for that
first minute; retry it then.

## Limits

| Plan | Reports a month                                  |
| ---- | ------------------------------------------------ |
| Free | 3 per IP address (stored only as a hash), no key |
| Pro  | 50 per subscription, shared by its keys          |
| Team | 1,000 per subscription, shared by its keys       |

Months are calendar months (UTC). A month that is used up is refused before any work. A request is
checked first, and requests with input errors are free. The report is then counted and built; if
building fails in a way FactLot sees (a size limit, a fault in FactLot, storage), it is given back.
A fault on FactLot's side answers `500 ReportFailed` (an `isError` tool result over MCP) with no
internal detail. Over the limit the answer is `429 ReportQuotaExceeded` over REST, or the same error
as an MCP tool result with `isError`, naming the reset time; every other tool keeps working.
Responses carry `X-FactLot-Reports-Quota-Limit`, `-Remaining` and `-Reset`, refusals of a
request's input included. `GET /v1/plans` lists
the limits under `reports`.

One request builds one report: in an MCP batch, the first `report_create` is built and any other
answers `isError` `OneReportPerRequest`, not run and not counted.

Size limits, so every document builds in well under a second:

- A PDF shows at most 2,000 characters of any one text (a reason, a quote, a warning); longer text
  is cut with an ellipsis and a note saying how long it was. The workbook keeps the full text.
- A PDF draws at most 60,000 lines of text; a larger one is refused with `413 TooLarge`.
- The `tx_unequal_appraisal` PDF lays out at most 60 comparables with at most 10 adjustments each.
  Above that the answer is `413 TooLarge`, and its `next` asks for `"format": "xlsx"`: the workbook
  takes the tool's full set, up to 200 comparables.
- The request body is at most 1 MB.

## Examples

Each example sends the tool's `arguments`, so FactLot computes the result and builds the document in
one call. Add `-H "Authorization: Bearer $FACTLOT_KEY"` to count against a paid plan.

Texas unequal appraisal, evidence packet:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "tx_unequal_appraisal", "format": "pdf",
  "context": { "title": "Subject parcel, tax year 2027" },
  "arguments": {"tax_year":2027,"subject":{"id":"SUBJECT","value":800000,"value_basis":"market"},"comparables":[{"id":"C-1","value":750000,"value_basis":"market","adjustments":[{"label":"signage","kind":"amount","value":15000,"reason":"comparable has none"}],"citation":{"document_id":"fl:document:sha256-1d126a7c278cfd3998a899c06b8eea84cb0621ea1a1ef56a6c1bbb7ef616f0ff","locator":"account 0042","as_of":"2027-04-15"}},{"id":"C-2","value":820000,"value_basis":"market"},{"id":"C-3","value":790000,"value_basis":"market","adjustments":[{"label":"condition","kind":"percent","value":-0.025,"reason":"comparable in better condition"}]}]}
}'
```

Lease abstract, workbook:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "lease_abstract", "format": "xlsx",
  "arguments": {"as_of":"2027-01-01","subject":"fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4","documents":[{"role":"original","title":"Office Lease","pages":["OFFICE LEASE. 1.2 Term. The Term shall commence on March 1, 2026 and shall expire on June 30, 2031, unless sooner terminated."],"candidates":[{"predicate":"lease.expiration_date","value":"2031-06-30","quote":"shall expire on June 30, 2031","page":1}]}]}
}'
```

CAM reconciliation, tenant statement:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "cam_reconciliation", "format": "pdf",
  "arguments": {"year":2025,"pro_rata_share":0.0425,"estimates_paid":5000,"expenses":[{"category":"common area maintenance","amount":50000},{"category":"real estate taxes","amount":62000,"controllable":false},{"category":"insurance","amount":20000,"controllable":false}],"cap":{"method":"year_over_year","rate":0.04,"reference_amount":1500}}
}'
```

Debt sizing:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "debt_sizing", "format": "pdf",
  "arguments": {"noi":2205000,"value":36000000,"rate_annual":0.0625,"amortization_years":30,"max_ltv":0.7,"min_dscr":1.25,"min_debt_yield":0.085,"round_down_to":1000}
}'
```

ASC 842 schedule:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "asc842_schedule", "format": "xlsx",
  "arguments": {"classification":"operating","payments":[{"period":1,"amount":1000},{"period":2,"amount":1000},{"period":3,"amount":1000},{"period":4,"amount":1000}],"remaining_periods":4,"discount_rate_annual":0.06,"discount_rate_updated":true,"liability_before":3900,"rou_asset_before":3900,"event":"reassessment_of_term_or_option"}
}'
```

Lease proposals compared:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "compare_proposals", "format": "pdf",
  "arguments": {"perspective":"landlord","proposals":[{"name":"Tower A","schedule":{"commencement_date":"2027-01-01","term_months":60,"area_sf":5000,"starting_rent_psf_annual":35,"escalation":{"type":"percent","rate":0.03},"abated_months":[1,2,3]},"ti_allowance_psf":40,"leasing_commissions":30000},{"name":"Park B","schedule":{"commencement_date":"2027-01-01","term_months":84,"area_sf":5000,"starting_rent_psf_annual":32,"escalation":{"type":"percent","rate":0.03},"abated_months":[1,2,3,4,5,6]},"ti_allowance_psf":60,"leasing_commissions":45000}]}
}'
```

DCF summary:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "dcf_summary", "format": "xlsx",
  "arguments": {"hold_years":5,"leases":[{"name":"Whole building","area_sf":10000,"rent_psf_annual":20,"months_remaining":120,"market_rent_psf_annual":20}],"market_leasing":{"renewal_probability":0.7,"lease_term_months":60,"downtime_months":6},"operating_expenses_psf_annual":8,"exit_cap_rate":0.08,"discount_rate":0.08}
}'
```

Critical dates as a calendar, downloaded straight away:

```bash
url=$(curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "critical_dates", "format": "ics",
  "context": { "title": "Suite 400 lease" },
  "arguments": {"expiration_date":"2031-06-30","as_of":"2026-11-07","renewal_option":{"count":2,"term_months":60,"notice_window":{"earliest_months_before":18,"latest_months_before":12}},"termination_options":[{"effective_date":"2029-06-30","notice_months":9}]}
}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["download_url"])')
curl -s -o suite-400.ics "$url"
```

Texas protest deadlines for a portfolio, as a calendar:

```bash
curl -s https://api.factlot.com/v1/reports -H 'content-type: application/json' -d '{
  "kind": "tx_protest_deadline", "format": "ics",
  "context": { "title": "Protest deadlines 2027" },
  "arguments": {"items":[{"id":"HCAD 0412340010025","tax_year":2027,"notice_delivered_date":"2027-04-28"},{"id":"TAD 41234567","tax_year":2027}]}
}'
```

Over MCP, call `report_create` with the same fields as `arguments`. With `"inline": true` the answer
also has the file as an embedded resource (`mimeType`, base64 `blob`).

## Running it yourself

The engine is the `@factlot/reports` workspace package (`createReport()`). It is private to this
repository (not published to npm) and runs in Node 22 and in Workers; its only new dependency is
`pdf-lib`, pinned, loaded only when a PDF is built. The hosted layer adds the quota, the 24-hour
storage and the download links.
