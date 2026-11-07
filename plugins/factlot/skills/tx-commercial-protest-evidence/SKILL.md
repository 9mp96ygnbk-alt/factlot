---
name: tx-commercial-protest-evidence
description: Evidence arithmetic for a Texas commercial property tax protest on the ground of unequal appraisal. Use when the user (a property owner, or the registered consultant, attorney, CPA or in-house tax team working for one) wants to compare a Texas commercial property's appraised value with comparable properties, find candidate comparables on the appraisal roll, compute the median adjusted value of chosen comparables, run direct-capitalization arithmetic on their own income figures, or assemble cited evidence for an appraisal review board hearing. Calls FactLot calc_tx_unequal_appraisal, registry_tx_equity_candidates, rules_tx_property_tax_protest_deadline, calc_direct_cap and fact_package_create. It never advises whether to protest, what value to claim, or the chances, and never files or represents anyone. Not a substitute for the advice of an attorney.
---

# Texas commercial protest evidence

This skill does arithmetic and gathers public-record facts. It does not give legal or tax advice,
it is not an appraisal, and FactLot does not represent property owners. Say this once at the start,
before any numbers, in these words or very close to them, and do not shorten it:

> **This is not a substitute for the advice of an attorney.** These are evidence calculations on
> public appraisal-roll data and on the figures you supply. They are not an appraisal or an opinion
> of value, and not legal or tax advice. I can't tell you whether to protest, what value to ask
> for, or how a hearing will go. To file, use your appraisal district's own protest process
> yourself, or work with a property tax consultant registered with the Texas Department of
> Licensing and Regulation, or an attorney.

## Hard rules

- **Never recommend.** Do not say whether to protest, which value to claim, or the odds, even if
  asked directly. If asked, repeat the boundary above and offer to explain what the numbers show.
- **Never invent adjustments.** Adjustments (age, size, condition, location, class) are judgment
  calls. Ask the user, or their consultant or attorney, for each one with its reason. You may list
  the usual categories neutrally; never propose a percentage or amount yourself.
- **Never pick the comparables for the user.** Show the candidates and the rule that selected them;
  the user decides which to use and why.
- **No owner information.** Never look up, show, or discuss who owns the subject or a comparable
  property; ownership is not needed for this comparison. The candidate tool returns none. Do not
  call `registry_get`, `registry_owned_by` or any other tool on a candidate to find its owner.
- **Never file, sign a §1.111 agent designation, contact the appraisal district, or draft a
  communication to it on the user's behalf.**
- **Never call the output an appraisal, a valuation, or an opinion of value** (Occupations Code
  §1103.003(1) defines an appraisal as an opinion of value). Call it an evidence calculation.
- Report every tool's values, formula or rule ID, and every warning as returned. Do the arithmetic
  only through the tools, never in-context.

## 1. The filing deadline

Call `rules_tx_property_tax_protest_deadline` with `tax_year` and, if the user has it, the date the
notice of appraised value was delivered (follow the `tx-property-tax-protest` skill). Give the
deadline and the conservative file-by date the tool returns (`recommended_file_by`) with the statute
citations.

If the user already has a hearing date, you may point them to two 14-day rules, quoting the
statute rather than computing a date, and always with their conditions:

- Tax Code §41.43(a-3): the district carries a higher burden of proof if the property's value was
  lowered under the property tax code in the preceding tax year (and that value was not set by a
  §1.111(e) agreement) and the owner files sufficient information "not later than the 14th day
  before the date of the first day of the hearing". Under §41.43(a-5) this is not a duty; it is
  only a condition for the higher burden. (§41.43(a-1) is a similar rule only for property worth
  $1 million or less, with a certified appraisal; it rarely fits commercial property.)
- Tax Code §41.67(d): information the owner previously requested under §41.461 that was not
  delivered "at least 14 days before the scheduled or postponed hearing" may not be used as
  evidence, except to rebut the owner's evidence or argument.

Whether either rule applies is for the user and their consultant or attorney. FactLot's date rule
(`rules.tx.protest_evidence_dates`) is an unverified draft available only in the SDKs; do not
present its dates as settled, and tell them to confirm dates with the appraisal review board.

## 2. The subject property

Ask for the county and the appraisal district account number (on the notice). With a registry
loaded, `registry_resolve_parcel` and `registry_get` return the subject's cited facts, including
`value_history` by tax year. Without one, ask the user for the values on their notice: the
appraised value, the market value, improvement (building) area and land area in SF, year built,
and the state property category code (for example F1 commercial, F2 industrial, B multifamily).

## 3. Candidate comparables

With a Texas registry loaded (`FACTLOT_REGISTRY_DB`, self-hosted or local), call
`registry_tx_equity_candidates` for the subject. Show the effective selection rule it returns (same
county and tax year, same category, area band, year band, neighborhood and ZIP tiers) and say it is
FactLot's default screen, not a legal standard of comparability. List the candidates with their
values, areas, year built, situs address and citation; no owner data. Relay each source's
attribution, licence and AI-use terms from the result's `sources` with the data.

The hosted endpoint has no Texas registry yet; self-hosted with a Texas registry file can list candidates. If the tool is unavailable or returns a miss,
the user can look up comparables themselves on the appraisal district's public property search and
give you the values; record where each one came from.

## 4. The unequal-appraisal calculation

When the user has chosen at least three comparables (five or more is better; the statute only says
"a reasonable number") and supplied each adjustment with a reason, call `calc_tx_unequal_appraisal`:

- `tax_year`; `subject` with `value`, `value_basis` (`appraised` or `market`), areas, `county_fips`,
  and `circuit_breaker_23_231` if the property is under the §23.231 limitation;
- `normalize_by`: `improvement_area_sf` to compare on value per building SF (the usual grid),
  `land_area_sf` for land, or `none` for whole values;
- `adjustment_combine`: `sum` (percentages added, the usual grid) or `compound`;
- `comparables`: from step 3 as returned (their `citation` passes through), each with the user's
  `adjustments` (`percent` as a decimal, `amount` in USD, or `psf`), each with `label` and `reason`.

Report: each comparable's normalized and adjusted value, the sorted list, `median_adjusted_value`
(for an even count, the mean of the two middle values, both shown), the subject's value minus the
median in dollars and percent, every warning, and the `law` citations. Describe the median only as
the comparison figure Tax Code §41.43(b)(3) and §42.26(a)(3) use. Do not call it a target, a claim,
or what the property "should" be valued at.

## 5. Direct-capitalization arithmetic (optional)

If the user wants it, `calc_direct_cap` divides an NOI by a cap rate (follow the `cre-valuation`
skill). The user supplies the NOI, the cap rate and its basis from their own records or their
consultant's. Present the result as the arithmetic of those inputs, not as a value of the property
or a value to claim, and do not suggest an NOI, a market rent or a cap rate yourself.

## 6. The evidence package

Offer two artifacts:

- **A cited fact package**: `fact_package_create` with the subject's and comparables' facts (from
  the registry, each already cited to the appraisal-roll file, with its source's rights) and a
  title such as "Evidence calculation: unequal appraisal, tax year 2027". No ownership facts go in
  it. Anyone can check it with `fact_package_verify`.
  FactLot never signs it; the holder signs with their own key if they want to.
- **An Excel workbook**: with the Python SDK checked out, `python3
examples/reconciliation/build.py tx_unequal_appraisal --input evidence.json --out evidence.xlsx`
  writes the adjustment grid with live Excel formulas beside FactLot's numbers. The input file is
  the `calc_tx_unequal_appraisal` arguments.

End by repeating that this is not a substitute for the advice of an attorney, and that the user
files through the appraisal district's own process, themselves or through a registered property
tax consultant or an attorney.
