# Using FactLot from an agent

FactLot exists so an agent doing commercial real estate work never has to guess a number or
an identifier. This page covers which tool to call, when, and how to report the result.

## Golden rules

1. **Don't do CRE math in context.** Call a `calc_*` tool for rent, abatement, NER, CAM, percentage
   rent, loan sizing, loan amortization schedules, ASC 842 remeasurement, prepayment and defeasance,
   WALT, NPV, IRR, property DCFs, direct-cap values, LP/GP waterfalls, 1031 exchange deadlines and
   boot, lease-versus-own, renew-versus-relocate, hotel metrics, multifamily rent rolls, capital
   expenditure recovery, and the Texas unequal-appraisal arithmetic.
   Models drift on compounding, caps, and amortization. The calculators don't.
2. **Cite the method.** Report the formula ID (`provenance.formula`, for example
   `calc.debt_sizing@3`; `formula` holds the same as `{id, version}`) and point to `steps`.
   A human can check every intermediate value without redoing the work.
3. **Surface warnings.** `warnings` lists assumptions that need a human, such as the order of a
   CAM cap versus the base year, or a prorated breakpoint. A field left to a default that changes
   the result, and that the result does not echo, is named there with the default used: for
   example `calc_compare_proposals`' `discount_rate_annual` (0.08), and `calc_cam_reconciliation`'s
   `controllable` (true, under a cap), `variable` (false, with a gross-up) and
   `gross_up.target_occupancy` (0.95). So is a value that cannot affect the answer, such as a gross
   proposal's `expense_psf_annual` from the tenant's side. Pass the field to make the warning go away.
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
| Texas unequal-appraisal arithmetic: the value against the median of adjusted comparables | `calc_tx_unequal_appraisal`                         |
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
| "Give me this as a workbook, a PDF or a calendar file" (hosted only)                     | `report_create`                                     |

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

## Texas property tax

FactLot is software. It is not a property tax consultant under Texas Occupations Code chapter 1152,
does not prepare, file or advise on protests, and does not represent owners before an appraisal
review board. If you provide property tax services to others for compensation, your own
registration obligations apply.

The Texas tools are built for the people who do this work: registered property tax consultants,
appraisers, attorneys and CRE analysts who run the software themselves. They compute a deadline,
list parcels from a public roll, and do the arithmetic of a comparison the user sets up. Their
outputs are not an appraisal or an opinion of value (Occupations Code §1103.003(1)), not legal or
tax advice, and not a substitute for the advice of an attorney (the statement Government Code
§81.101(c) describes). No tool says whether to protest, what value to put forward, or how a
protest might turn out. No Texas tool returns or looks up owners, files anything, signs a §1.111
agent designation, or contacts an appraisal district. Every `calc_tx_unequal_appraisal` result
carries this in `disclaimer` (it is not repeated in `warnings`); pass it on.

| Step                      | Tool                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| What is covered           | `registry_coverage`                                                                                        |
| Find the subject's URN    | `registry_resolve_parcel`                                                                                  |
| Subject's value history   | `registry_tx_equity_candidates` (`subject.value_history`)                                                  |
| Candidate parcels         | `registry_tx_equity_candidates` (`candidates`)                                                             |
| The comparison arithmetic | `calc_tx_unequal_appraisal`, on comparables and adjustments the user chose                                 |
| Filing deadline           | `rules_tx_property_tax_protest_deadline` (verified)                                                        |
| PDF packet and workbook   | `report_create` (hosted), or `examples/reconciliation/build.py tx_unequal_appraisal` (self-hosted)         |
| Fact package              | `fact_package_create`                                                                                      |
| Hearing evidence dates    | draft rule `tx_protest_evidence_dates` (SDKs only, not a tool; [docs](rules/tx-protest-evidence-dates.md)) |

**Coverage.** The hosted API serves Harris, Dallas, Travis, Collin, Denton and Williamson counties (Denton and Williamson from 2027 preliminary rolls); `registry_coverage` lists exactly what is hosted. Tarrant County is not served by the hosted registry while the publisher's terms for AI use are unclear. A self-hosted FactLot with a Texas registry file
(`FACTLOT_REGISTRY_DB`) answers the same tools for the districts it holds. For a county that is not
covered, the user reads values from the appraisal district's own property search and passes them
to the calculator directly.

### Worked example: a Harris County parcel

Harris Central Appraisal District account numbers are 13 digits, as printed on the notice. The
calls below are in order; each result is reported as returned, with its warnings.

1. `registry_coverage` with `{}`. Confirm Harris County (FIPS 48201) is listed before treating a
   miss as meaningful.
2. `registry_resolve_parcel`:

   ```json
   { "state_fips": "48", "county_fips": "201", "apn": "0011440000001" }
   ```

   returns `urn` `fl:parcel:us-48201:0011440000001`, or `urn: null` with the county's coverage.

3. `registry_tx_equity_candidates`:

   ```json
   { "urn": "fl:parcel:us-48201:0011440000001" }
   ```

   Without `tax_year` it compares in the newest tax year whose roll gives the subject a value; pass
   `tax_year` to pin one.

   `subject` carries the roll value, `value_basis`, areas, year built, state property category
   code and `value_history` (market and appraised value by tax year, each cited to that year's
   roll). `candidates` are candidates under FactLot's default rule, a design choice, not a legal
   standard; a person decides which, if any, to use. `selection` echoes the rule and its
   parameters, and `sources` gives each roll's licence, attribution and AI-use terms.

   `calc_args` is the same subject and candidates in `calc_tx_unequal_appraisal`'s input shape:
   `tax_year`, `subject` and `comparables` with exactly the calculator's fields (`id` the FactLot
   URN, `label` the situs address, `county_fips`, `value`, `value_basis`, the areas, and a
   comparable's `citation`; nulls left out; no adjustments). It is the default rule's list, not a
   selection by FactLot. `selection_rule` restates the parameters used (tax year, category code,
   area band and year band with their bounds, counts per tier) with a `notice` saying so. The
   order is: candidates, the person's review (remove, add or edit comparables, add adjustments
   with reasons), `calc_tx_unequal_appraisal` with the reviewed `calc_args`, then `report_create`.

4. `calc_tx_unequal_appraisal` with the comparables the user chose and the adjustments the user
   supplied, each with a reason. The figures below are the inputs of the first case in
   `spec/vectors/calc/tx_unequal_appraisal.json`, not roll values. With real data, start from the
   reviewed `calc_args` of step 3, which keeps only the calculator's fields; by hand, pass from each
   chosen candidate only `id`, `county_fips`, `value`, `value_basis`, `improvement_area_sf`,
   `land_area_sf`, `citation` and optionally `label` and `address`; the tool rejects any other
   field, and a `null` (leave those out, including a `null` `locator` inside `citation`).

   ```json
   {
     "tax_year": 2027,
     "subject": {
       "id": "S",
       "county_fips": "201",
       "value": 1000000,
       "value_basis": "appraised"
     },
     "adjustment_combine": "sum",
     "comparables": [
       {
         "id": "A",
         "county_fips": "201",
         "value": 900000,
         "value_basis": "appraised",
         "adjustments": [
           {
             "label": "location",
             "kind": "percent",
             "value": 0.2,
             "reason": "comp on a weaker corridor"
           },
           {
             "label": "age",
             "kind": "percent",
             "value": -0.1,
             "reason": "comp newer"
           }
         ]
       },
       {
         "id": "B",
         "county_fips": "201",
         "value": 950000,
         "value_basis": "appraised",
         "adjustments": [
           {
             "label": "condition",
             "kind": "percent",
             "value": -0.05,
             "reason": "comp renovated 2024"
           }
         ]
       },
       {
         "id": "C",
         "county_fips": "201",
         "value": 1050000,
         "value_basis": "appraised"
       },
       {
         "id": "D",
         "county_fips": "201",
         "value": 980000,
         "value_basis": "appraised",
         "adjustments": [
           {
             "label": "age",
             "kind": "percent",
             "value": 0.05,
             "reason": "comp older"
           },
           {
             "label": "parking",
             "kind": "percent",
             "value": 0.03,
             "reason": "comp has less parking"
           }
         ]
       },
       {
         "id": "E",
         "county_fips": "201",
         "value": 920000,
         "value_basis": "appraised",
         "adjustments": [
           {
             "label": "excess land",
             "kind": "amount",
             "value": -20000,
             "reason": "comp has a surplus pad site"
           }
         ]
       }
     ]
   }
   ```

   returns `median_adjusted_value` 990,000 (the third of 900,000; 902,500; 990,000; 1,050,000;
   1,058,400), `subject_minus_median` 10,000 and `subject_minus_median_pct` 0.010101 (a fraction of the median, 1.0101%). Report the
   median only as the comparison figure the statute uses.

5. `rules_tx_property_tax_protest_deadline` with `{ "tax_year": 2027 }` returns `deadline`
   2027-05-17 (May 15 is a Saturday) and the conservative file-by date (`conservative_file_by`)
   2027-05-14. A notice delivered after April 15 moves the deadline; pass `notice_delivered_date`.
   `status` (`open`, `passed` or `not_yet_open`), `days_remaining` and, once the deadline has
   passed, `next_season` say where the deadline stands on `as_of` (default: today in US Central
   time; pass it to fix the date), and `notes` lists what the rule does not cover.
6. On the hosted API, call `report_create` with `kind` `tx_unequal_appraisal`, `format` `pdf` or
   `xlsx`, and the step 4 arguments as `arguments`: it builds the evidence packet (PDF) or the
   adjustment-grid workbook with live Excel formulas beside FactLot's numbers, and returns a link
   that works 24 hours. On a self-hosted FactLot, save the step 4 arguments as `evidence.json` and
   run
   `python3 examples/reconciliation/build.py tx_unequal_appraisal --input evidence.json --out evidence.xlsx`
   for the workbook. For a fact package, call
   `registry_get` on the subject and on each comparable the user chose. Keep only facts whose
   `predicate` starts with `parcel.`. Drop every `ownership.*` fact, the ownership links and any
   entity record, and never show them. Then call `fact_package_create` with the kept facts and the
   title "Unequal-appraisal arithmetic, tax year 2027". A package shows the facts were not changed after packaging (its digest, and the holder's signature if they sign it) and carries their citations; it does not itself prove they match the roll, so cite the roll record for each value. FactLot never signs it.

The `tx-unequal-appraisal-arithmetic` and `tx-property-tax-protest` skills in the Claude Code
plugin follow this sequence.

### Unequal-appraisal arithmetic

`calc_tx_unequal_appraisal` (`calc.tx_unequal_appraisal@1`) does the arithmetic of Tex. Tax Code
§41.43(b)(3) and §42.26(a)(3): the subject's value against "the median appraised value of a
reasonable number of comparable properties appropriately adjusted". The tool never picks
comparables or invents an adjustment, and each adjustment needs a `reason` in the user's words.
Tax Code §41.43(a-3) and §41.67(d) attach conditions to evidence exchanged by the 14th day before
a hearing; the draft rule `rules.tx.protest_evidence_dates` computes those dates and is not
verified.

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
- **Sum or compound** (`adjustment_combine`). `sum` (the default) adds a comparable's percentages
  and applies the total once: +10% and −10% leave the value unchanged. `compound` multiplies
  (1 + each): 1.10 × 0.90 = 0.99.
- **Rounding.** Normalized, after-percentage and adjusted values are rounded to the cent at each
  step and the percentage factor to six decimals, the same in every SDK.
- **The median.** Adjusted values are sorted ascending. For an odd count the median is the middle
  value; for an even count it is the mean of the two middle values (to the cent), and both are
  returned in `median_pair`. Report `median_adjusted_value` only as the comparison figure the
  statute uses, with `subject_minus_median` and `subject_minus_median_pct` as what the arithmetic
  shows. `subject_minus_median_pct` is a fraction of the median, like every FactLot rate: 0.1554 is
  15.54%.
- **How many comparables.** The statute says "a reasonable number" and does not define it. The tool
  requires at least 3 (a FactLot input floor, not law), takes up to 200, and warns when fewer than
  5 comparables are given.
- **Other warnings.** A comparable in a different county (appraisal district) from the subject, a
  comparable whose total adjustment exceeds 25% (a FactLot flag, not a legal limit), and a
  comparable with the same value, basis and areas as the subject. A comparable with the subject's
  `id`, or two with the same `id`, is an input error.
- **No adjustments.** When no comparable has an adjustment, a warning says the median is of
  unadjusted values and quotes the statute's words, "the median appraised value of a reasonable
  number of comparable properties appropriately adjusted".
- **Area spread.** With `normalize_by` `none`, a comparable whose improvement area (or land area,
  when the subject gives only that) differs from the subject's by more than 25% draws a warning that
  a median of whole values and a median of values per SF can differ materially, and that
  `normalize_by` compares values per SF. The 25% is a FactLot flag, not a legal limit.
- **Flags.** Each comparable row has `flags`, a list of `{code, message}` facts about the inputs.
  They never remove a comparable or change a number: `value_psf_above_2x` and
  `value_psf_below_half` (value per SF of the normalizing area, or of improvement area with
  `normalize_by` `none`, more than twice or less than half the subject's), `land_ratio_above_2x`
  and `land_ratio_below_half` (land-to-improvement area ratio against the subject's), and
  `missing_area` (with `normalize_by` `none`, an area the subject has and the comparable lacks).
  The thresholds are FactLot's, not law.
- **Labels and addresses.** The subject and each comparable take an optional `label` (up to 80
  characters) and `address` (up to 120), echoed as `subject_label`, `subject_address` and each
  row's `label` and `address` so a report can print them. Neither enters the arithmetic. Any other
  field is still rejected by name.
- **Citations.** Each comparable's `citation` (`fact_id`, `document_id`, `locator`, `as_of`) is
  passed through to the output unchanged, and `law` lists the sections relied on with their
  official URLs.

### The evidence packet and the workbook

The hosted `report_create` (MCP) and `POST /v1/reports` (REST) build the documents from the same
arithmetic, by code with no model. With `kind` `tx_unequal_appraisal` the `pdf` is the packet: the
subject, the comparables grid, each adjustment with its reason, the adjusted values in ascending
order, the median and the difference, the warnings, every citation and the statutes cited. The
`xlsx` is the adjustment-grid workbook (ReadMe, Reconcile and Grid sheets with live formulas, then
Steps and Law). Send the `calc_tx_unequal_appraisal` arguments as `arguments`; FactLot runs the
tool itself and prints only its figures. The optional `context` takes a `title`, a `prepared_for`
line and citations, and caller text is refused when it reads as advice or a valuation (for example
`recommend`, `should`, `protest`, `worth`, `appraisal`, `save`). Each document states that it is
not an appraisal or an opinion of value, and not legal or tax advice. The link works for 24 hours,
then the file is deleted; a report counts against the plan's monthly allowance (3 free per IP
address, 50 on Pro, 1,000 on Team) and never as a registry lookup. See
[reports](reports.md). The self-hosted path is `examples/reconciliation/build.py
tx_unequal_appraisal`.

### Candidate parcels

`registry_tx_equity_candidates` lists candidate parcels from an appraisal-district roll for an
unequal-appraisal comparison (Tax Code §41.43(b)(3)), on the hosted API for the Texas counties
`registry_coverage` lists and on a self-hosted FactLot with a registry file (`FACTLOT_REGISTRY_DB`).
For a parcel or county it does not hold, it answers as `registry_get` does: a `NotFound` error with
a `coverage` object saying whether the county is loaded (HTTP 404 on the REST API; the same object
with `isError` over MCP). Give the subject as `urn`, or as
`county_fips` and `apn`. Parcels outside Texas are an input error, and so are Tarrant County
parcels on every server: Tarrant County is not served by the hosted registry while the publisher's
terms for AI use are unclear.

**Many clients at once.** `registry_tx_equity_candidates_batch` takes up to 50 `subjects` (each
with your `id` and its `urn`, or `county_fips` and `apn`) and the rule parameters once; each entry
of `results` is that subject's answer from `registry_tx_equity_candidates` (minus the `notice` and
`selection.rule`, given once at the top) or that subject's error, so one parcel outside Texas, in
Tarrant County or not in the registry does not fail the others. It returns candidates per subject
only and never runs `calc_tx_unequal_appraisal`: a person still chooses each subject's comparables.
On the hosted API each answered subject counts as one registry lookup. Likewise
`rules_tx_property_tax_protest_deadline_batch` takes up to 200 `items` (`id`, `tax_year`,
optional `notice_delivered_date`, plus one optional `as_of` for all) and answers each under
`rules.tx.property_tax_protest_deadline@2` exactly as the single tool would, with an invalid item
carrying its own `error`, a `summary` of items per deadline and per status, and the rule,
citations, disclaimer, `as_of` and `notes` once; it is a rules tool, never a
lookup.

- **One tax year.** Each tax year's roll is its own registry source, so a parcel can carry a
  certified roll and next year's preliminary roll at once. The tool compares within one year: the
  newest tax year whose roll gives the subject a positive market or appraised value, or the
  `tax_year` you pass. Every field of the subject and of each candidate comes from that year's roll
  (building class also from the district's buildings file for that year), and candidates come only
  from the same district's roll for that year. `selection.tax_year`, `available_tax_years`,
  `roll_sources`, and `building_class_sources` say what was used.
- **Default rule** (a FactLot design choice, not a legal standard; every parameter is optional and
  echoed in `selection.parameters`): same appraisal district (county) and roll year as the subject;
  exactly the same `parcel.state_property_category` code; improvement area within `area_band`
  (0.35, a share) of the subject's; year built within `year_band` (15) years when both are known;
  an appraised or market value. Parcels sharing the subject's `parcel.neighborhood_code` are listed
  first when the registry holds one, then the subject's 5-digit ZIP code, then the rest of the
  county only when those tiers hold fewer than `min_matches` (10). Within a tier, nearest
  improvement area first, then URN; at most `limit` (50, up to 200).
- **Output.** `subject` and each of `candidates` carry `id`, `county_fips`, `value` and
  `value_basis` (`appraised` when the roll gives an appraised value, else `market`),
  `market_value`, `appraised_value`, the areas, `year_built`, the district's codes, `situs_address`,
  `tax_year`, and the `citation` of the value fact; a missing fact is `null`. `selection.tiers`
  says which tier each candidate came from and how many matched there. Each candidate's
  `citation.document_id` names its entry in `sources`, which gives that snapshot's `license`,
  `attribution` (null when the source asks for none), `ai_use`, and `redistribution`: relay them
  with the candidate.
- **Value history.** The subject carries `value_history`: market and appraised value by tax year
  from every snapshot, newest first, each value cited to the roll of that tax year. A tax year two
  snapshots value differently is listed once per value.
- **Boundaries.** The output is a list of candidates under FactLot's default rule, a design
  choice, not a legal standard; a person decides which to use and supplies any adjustments. The
  tool never returns owner names, mailing addresses, or ownership facts. Do not look up the owners
  of the subject or of candidate parcels (`registry_get` and `registry_owned_by` records can carry
  the owner of record); ownership is not part of this comparison. The one use of `registry_get`
  in this workflow is the fact package in step 6 of the worked example, keeping only `parcel.*`
  facts.

## Example: Claude Messages API with the Python SDK

Requires `pip install anthropic` and an `ANTHROPIC_API_KEY`. The loop passes every tool, so the
model may call a `registry_*` tool; on a server with no registry it gets `RegistryUnavailable`, and for a region the registry does not hold it gets a coverage miss. Either way it moves on. On the hosted API, call `registry_coverage` first.

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
