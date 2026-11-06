# Using FactLot from an agent

FactLot exists so an agent doing commercial real estate work never has to guess a number or
an identifier. This page covers which tool to call, when, and how to report the result.

## Golden rules

1. **Don't do CRE math in context.** Call a `calc_*` tool for rent, abatement, NER, CAM, percentage
   rent, loan sizing, loan amortization schedules, ASC 842 remeasurement, prepayment and defeasance,
   WALT, NPV, IRR, property DCFs, direct-cap values, LP/GP waterfalls, 1031 exchange deadlines and
   boot, lease-versus-own, renew-versus-relocate, hotel metrics, multifamily rent rolls, capital
   expenditure recovery, and Texas unequal-appraisal evidence.
   Models drift on compounding, caps, and amortization. The calculators don't.
2. **Cite the method.** Report the formula ID (`provenance.formula`, for example
   `calc.debt_sizing@3`; `formula` holds the same as `{id, version}`) and point to `steps`.
   A human can check every intermediate value without redoing the work.
3. **Surface warnings.** `warnings` lists assumptions that need a human, such as the order of a
   CAM cap versus the base year, or a prorated breakpoint.
   Pass rates as decimals (0.065 for 6.5%): every `calc_*` tool and `lease_comp_validate` rejects a
   rate field above 1 in absolute value, and a `min_dscr` above 10, with an error that names the
   decimal you probably meant. Shares and ratios (`pro_rata_share`, `max_ltv`, occupancy) are
   decimals too.
4. **Use FactLot IDs as join keys.** Compute `id_parcel`, `id_entity`, `id_building`, `id_space`,
   and `id_document` IDs offline. Two agents given the same county parcel number, state file
   number, or street address always produce the same ID.
5. **Emit facts, not prose.** When you extract something from a lease or a record, emit a fact
   with `provenance.sources` (document, page, section, quote) and check it with `fact_validate`.
   Uncited facts are rejected.
6. **You extract, FactLot verifies.** To read a document, send its page text and, for each
   value, the verbatim quote and page to `doc_verify_facts` (or `doc_abstract_lease` for a lease
   with amendments). FactLot runs no model; it returns cited facts, items for review, and
   rejections with reasons. See [document verification](document-verification.md).

## Which tool when

| The user asks…                                                                           | Call                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| "What's the rent schedule / total rent / expiration date?"                               | `calc_rent_schedule`                                |
| "What's the net effective rent on this deal?"                                            | `calc_net_effective_rent`                           |
| "Which of these proposals is better?" (tenant rep or landlord)                           | `calc_compare_proposals`                            |
| "What does the tenant owe in percentage rent?"                                           | `calc_percentage_rent`                              |
| "Reconcile CAM / opex for 2026" or "check this CAM statement"                            | `calc_cam_reconciliation`                           |
| "CAM true-ups for every tenant" or "why wasn't the pool recovered?"                      | `calc_cam_reconciliation_batch`                     |
| "What can we recover for the roof / HVAC under the lease?"                               | `calc_capex_recovery`                               |
| "Analyze this rent roll" or "effective rent after six weeks free?"                       | `calc_multifamily_rent_roll`                        |
| "How big a loan can this support?" or "which constraint binds?"                          | `calc_debt_sizing`                                  |
| "Show me the loan schedule / balloon / interest-only payments"                           | `calc_amortization_schedule`                        |
| "Remeasure this lease under ASC 842" after an amendment or reassessment                  | `calc_lease_remeasurement_asc842`                   |
| "What does it cost to prepay or defease this loan?"                                      | `calc_prepayment_and_defeasance`                    |
| "What's the WALT?"                                                                       | `calc_walt`                                         |
| "NPV / IRR of these cash flows"                                                          | `calc_npv`, `calc_irr`                              |
| "What's it worth on a DCF from this rent roll?" or "what's the IRR?"                     | `calc_dcf_pro_forma`                                |
| "Value at a 6.5% cap" or "what cap rate does this price imply?"                          | `calc_direct_cap`                                   |
| "How do the LP and GP split it?" (pref, catch-up, promote)                               | `calc_equity_waterfall`                             |
| "When are my 1031 deadlines?" or "do I have boot?" (not tax advice)                      | `calc_exchange_1031`                                |
| Compare a Texas property's value with the median of adjusted comparables (evidence only) | `calc_tx_unequal_appraisal`                         |
| "When is a Texas protest due?"                                                           | `rules_tx_property_tax_protest_deadline`            |
| "Should we buy the building or keep leasing?"                                            | `calc_lease_vs_own`                                 |
| "Should we renew or move?" or "what rent makes moving worth it?"                         | `calc_renew_vs_relocate`                            |
| "What's the occupancy / ADR / RevPAR / GOP / NOI of this hotel?"                         | `calc_hotel_metrics`                                |
| You have a county parcel number, a state LLC file number, a suite, or a PDF              | `id_parcel`, `id_entity`, `id_space`, `id_document` |
| You have a building's street address                                                     | `id_building`                                       |
| You extracted a fact and want to store or share it                                       | `fact_validate`                                     |
| "Abstract this lease" (you read the pages and propose each term with a quote)            | `doc_verify_facts`, `doc_abstract_lease`            |
| "Does the estoppel / rent roll match the lease?"                                         | `doc_compare`                                       |
| "Is this claim supported by the document?"                                               | `doc_verify_claim`                                  |

## Mapping lease language to inputs

- **CAM caps.** Lease terms like "cumulative" and "non-cumulative" are used inconsistently, so
  FactLot names caps by what they compute:
  - "Cumulative, compounding", where unused increases carry forward → `compounding_from_base`
  - "Cumulative, non-compounding" → `simple_from_base`
  - "Non-cumulative", meaning each year is capped over the prior year → `year_over_year`

  If the lease is ambiguous, run more than one method and show the difference to a human.

- **Free rent** → `abated_months` (1-based). "Three months free" usually means `[1, 2, 3]`, but
  check whether the lease abates base rent only or gross rent too.
- **NNN vs gross proposals** → put estimated expenses in `additional_costs_psf_annual` for the
  net proposals, or the comparison flatters them.
- **Partial lease years** → `period_fraction` for percentage rent. Check whether the lease
  prorates by days or by months.
- **Leases priced per kW, MW, acre, unit, key, room, or parking space** → set `unit` on the
  schedule (`kw`, `mw`, `acre`, `unit`, `key`, `room`, `space`) in `calc_rent_schedule`,
  `calc_net_effective_rent`, or each proposal of `calc_compare_proposals`. `area_sf` then holds the
  quantity (kW, acres, ...) and every `_psf` field is per that unit; the numbers are computed
  exactly as for square feet, and the result adds `unit` and `rate_unit` (for example
  `USD/kW/yr`). Rates are annual: a $/kW/month quote is × 12. Every proposal in a comparison uses
  the same unit, and load factors and usable area apply to square feet only.
- **Apartment concessions** → `calc_multifamily_rent_roll`: "six weeks free" is
  `{"type": "weeks_free", "weeks": 6}` (worth lease rent × 12 ÷ 52 per week), "one month free" is
  `{"type": "months_free", "months": 1}`, and a look-and-lease credit is `{"type": "amount"}`.
  Concessions are amortised straight-line over the lease term. Give `units` for a whole rent roll
  (with `as_of`) or `lease` for one lease.
- **Capital items passed through CAM** → `calc_capex_recovery`. Take the amortization period
  (useful life or the period the lease states), interest on the unamortized balance, straight-line
  or level payment, and any cost-savings limit from the clause, and quote each clause in `clauses`;
  the result echoes every assumption with its clause.
- **A whole building's CAM** → `calc_cam_reconciliation_batch` with the expense pool once and every
  tenant's terms. Each tenant's `statement` is exactly what `calc_cam_reconciliation` returns for
  that tenant; `building.unrecovered_reasons` explains the gap between the pool and what was billed
  (vacant or unleased share, lease exclusions, gross-up, caps, base years and stops, admin fees).

## Valuation conventions

The valuation tools state every convention in `steps` and `warnings`. The ones to check against a
spreadsheet or another model before relying on a figure:

- **`calc_dcf_pro_forma`** works in months and reports years: analysis month m is in year
  ⌊(m − 1) ÷ 12⌋ + 1. A lease runs through `months_remaining`; at expiration one **blended** lease
  starts, weighting renewal and new-tenant assumptions by the renewal probability p: rent = market
  × (p × `renewal_rent_pct_of_market` + 1 − p), TI per SF and the commission rate are weighted the
  same way. Downtime D = (1 − p) × new-tenant downtime and free rent F = p × renewal + (1 − p) ×
  new are kept fractional, not rounded: the suite is vacant for the whole months of D, the new
  lease's first month collects 1 − (the fraction of D) of its rent and recoveries, and free rent
  abates F's whole months and then the fraction of the next month (0.45 months of downtime: the
  first month collects 55%). Every lease that expires inside the projection rolls over; if the
  downtime runs past the forward year, the next lease is listed in `lease_events` but its TI and
  commission are outside the cash flows, and a warning says so. A suite vacant at the start is
  leased to a new tenant after the full downtime. Market rent and TI grow by
  `market_rent_growth_rate` each analysis year; expenses and reserves by `expense_growth_rate`. Free
  rent abates base rent only; NNN tenants still pay recoveries. TI and commissions (a share of the
  base rent over the whole new term, after free rent) are paid when the lease starts. General
  vacancy and credit loss are shares of gross revenue on top of modelled downtime. The sale is at
  the end of the hold at `exit_cap_rate` on the next year's NOI (`exit_noi_basis: "forward"`) or the
  last hold year's; a warning names any rollover downtime, free rent, TI or commissions in that
  forward year, which is capitalized as is. The value is the present value at `discount_rate`, end
  of year (Excel NPV) or mid-year for operating cash flows; the unlevered IRR is always end of year
  (Excel IRR). Every annual line is rounded to the cent and the subtotals are sums of rounded
  lines, so each row foots.
  FactLot does not claim ARGUS parity: ARGUS and other models may treat fractional downtime,
  general vacancy, or commission bases differently.
- **`calc_direct_cap`**: capitalized income = NOI − capital reserve; as-is value = capitalized
  income ÷ cap rate − lease-up costs − free-rent burn-off + other adjustments. State whether the NOI
  is trailing, forward, or stabilized (`noi_basis`); the cap rate must be on the same basis.
- **`calc_amortization_schedule`**: the level payment is rounded to the cent and computed on a 30/360
  basis even when interest accrues actual/360 or actual/365; the final payment repays the whole
  balance, so the schedule closes at 0.00. `balloon_balance` is the principal repaid at maturity
  beyond the regular payment's principal (a few cents, possibly negative, for a fully amortizing
  loan).
- **`calc_equity_waterfall`**: contributions are split `lp_share` / 1 − `lp_share`; pref and return of
  capital go pro rata to capital, then the optional catch-up, then IRR tiers measured on the LP's cash
  flows (each hurdle balance compounds at (1 + hurdle)^(1/periods_per_year) − 1 and falls with every
  LP distribution), then the residual split. Pref accrues from the period after a contribution. The
  catch-up target is a share of all profit distributed so far, pref included. Confirm these against
  the operating agreement; the tool warns where agreements commonly differ.
- **`calc_exchange_1031`** is not tax advice. It counts 45 and 180 calendar days from the transfer
  (IRC §1031(a)(3)), ends the exchange period at `tax_return_due_date` when that is earlier, applies
  the three-property, 200%, and 95% tests of Treas. Reg. §1.1031(k)-1(c)(4), and nets boot: cash
  boot is cash taken plus exchange funds not reinvested; mortgage boot is debt relieved less new debt
  and cash added. A property identified after the 45-day deadline is left out of the count, value,
  and tests (and listed under `late_identifications`); one received after the exchange deadline does
  not count toward the 95% exception. It does not move deadlines for weekends, holidays, or disaster relief.

## Texas unequal appraisal

`calc_tx_unequal_appraisal` (`calc.tx_unequal_appraisal@1`) does the arithmetic of Tex. Tax Code
§41.43(b)(3) and §42.26(a)(3): the subject's value against "the median appraised value of a
reasonable number of comparable properties appropriately adjusted". It is an **evidence
calculation only**: not an appraisal or an opinion of value (Occupations Code §1103.003(1)), not
legal or tax advice, and not a substitute for the advice of an attorney. It never says whether to
protest, what value to put forward, or how a protest might turn out. FactLot does not represent
property owners; the person files through the appraisal district's own process, themselves or
through a registered property tax consultant or an attorney. Every result says so in `disclaimer`
and in its first warning; pass that on.

Which tool when:

- **The filing deadline**: `rules_tx_property_tax_protest_deadline` (verified).
- **The comparison itself**: `calc_tx_unequal_appraisal`, with comparables and adjustments the
  user chose or confirmed. The tool never picks comparables or invents an adjustment, and each
  adjustment needs a `reason` in the user's words.
- **Evidence dates before the hearing** (the owner's 14-day date and the §41.67(d)
  requested-information cutoff): the draft
  rule pack `tx_protest_evidence_dates`, opt-in through `runDraftRule` / `run_draft_rule` with the
  draft acknowledged; it is not a tool yet ([docs](rules/tx-protest-evidence-dates.md)).

Conventions:

- **Value basis.** Give every value from the roll with `value_basis` (`appraised` or `market`) and
  use one basis throughout; a comparable on a different basis draws a warning. For tax year 2026 or
  earlier, on appeal under §42.26, §42.26(d) (text in effect until 2027-01-01) requires market value
  when the property is subject to the §23.231 limitation (`circuit_breaker_23_231`); appraisal
  review board practice may differ. §23.231(k) says "This section expires December 31, 2026", and
  from 2027-01-01 §42.26(d) and §41.41(a) no longer refer to §23.231, so for later years the tool
  warns you to check whether the limitation applies.
- **Normalization** (`normalize_by`). `none` compares whole values. `improvement_area_sf` or
  `land_area_sf` converts each comparable to value per SF of that area and multiplies by the
  subject's same area (comparable value ÷ comparable area × subject area); the subject and every
  comparable must then have that area.
- **Order of adjustments.** Percentages first, then USD amounts and $/SF adjustments (a $/SF
  adjustment is × the subject's normalizing area, so it needs `normalize_by`). Percentages are
  decimals between −1 and 1 (0.05 for +5%); 5 is rejected.
- **Sum or compound** (`adjustment_combine`). `sum` (the default, as most adjustment grids work)
  adds a comparable's percentages and applies the total once: +10% and −10% leave the value
  unchanged. `compound` multiplies (1 + each): 1.10 × 0.90 = 0.99.
- **Rounding.** Normalized, after-percentage and adjusted values are rounded to the cent at each
  step and the percentage factor to six decimals, the same in every SDK.
- **The median.** Adjusted values are sorted ascending. For an odd count the median is the middle
  value; for an even count it is the mean of the two middle values (to the cent), and both are
  returned in `median_pair`. Report `median_adjusted_value` only as the comparison figure the
  statute uses, with `subject_minus_median` and `subject_minus_median_pct` as what the arithmetic
  shows.
- **How many comparables.** The statute says "a reasonable number" and does not define it. The tool
  requires at least 3 (a FactLot product floor, not law), takes up to 200, and warns below 5.
- **Other warnings.** A comparable in a different county (appraisal district) from the subject, a
  comparable whose total adjustment exceeds 25% (a FactLot flag, not a legal limit), and a
  comparable with the same value, basis and areas as the subject. A comparable with the subject's
  `id`, or two with the same `id`, is an input error.
- **Citations.** Each comparable's `citation` (`fact_id`, `document_id`, `locator`, `as_of`) is
  passed through to the output unchanged, and `law` lists the sections relied on with their
  official URLs.

## Example: Claude Messages API with the Python SDK

Requires `pip install anthropic` and an `ANTHROPIC_API_KEY`. The loop passes every tool, so the
model may call a `registry_*` tool; without a registry it gets `RegistryUnavailable` and moves on.

```python
import json

import anthropic
import factlot

MODEL = "claude-..."  # replace with a current Claude model ID
client = anthropic.Anthropic()
messages = [{"role": "user", "content": "Compare these two office proposals for my client: ..."}]
while True:
    response = client.messages.create(
        model=MODEL, max_tokens=4096, tools=factlot.anthropic_tools(), messages=messages
    )
    messages.append({"role": "assistant", "content": response.content})
    calls = [b for b in response.content if b.type == "tool_use"]
    if not calls:
        break
    messages.append({"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": c.id, "content": json.dumps(factlot.run_tool(c.name, c.input))}
        for c in calls
    ]})
```

`run_tool` returns input errors as data (`{"error": "CalcInputError", "issues": [...]}`), so the
model can fix its arguments and retry.

## Example: emitting a computed fact

```json
{
  "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4",
  "predicate": "lease.net_effective_rent",
  "value": 28.4772,
  "unit": "USD/sf/yr",
  "as_of": "2026-11-02",
  "provenance": {
    "method": "computed",
    "formula": "calc.net_effective_rent@1",
    "sources": []
  }
}
```
