# Texas commercial protest kit (spec)

Status: **spec, not built.** Written 2026-11-06 for the 2027 protest season. Statute text quoted
here was read at statutes.capitol.texas.gov on 2026-11-06. No named person has verified the rules
below yet (see [rules packs](rules.md) for what "verified" means).

The kit helps an owner of Texas commercial property, or the registered consultant, attorney, or
in-house tax team working for them, build the evidence for an appraisal review board (ARB) protest:
the dates, the comparable properties, and the arithmetic, each cited to the public record. It does
not file protests, act as anyone's agent, or say whether to protest.

## Why this fits

- **The data is already loaded.** Every Texas adapter writes `parcel.market_value`,
  `parcel.tax_year`, `parcel.improvement_area_sf`, `parcel.land_area_sf`, `parcel.year_built`,
  and `parcel.state_property_category` from the appraisal roll itself: Harris (87,717 commercial
  parcels), Dallas (59,645), Tarrant (45,976), Travis (30,555), Collin (18,035), Denton (13,304),
  Williamson (11,699), and Fort Bend (9,698), about 276,600 in all
  ([coverage](registry/coverage.md)). Six of them also write `parcel.appraised_value`; the Dallas
  and Fort Bend adapters record market value only.
- **The deadline rule is verified and live.** `rules_tx_property_tax_protest_deadline`
  (`rules.tx.property_tax_protest_deadline@1`) and the `tx-property-tax-protest` plugin skill.
- **The strongest argument in Texas is arithmetic on roll data.** Texas does not make sale prices
  public, so owners rarely have sales evidence. An unequal-appraisal protest compares the
  property's value with the median of comparable properties' appraised values, and those values
  are on the roll. That is a deterministic, cited calculation, which is what FactLot does.
- **Users asked.** In the 2026-11 product review, personas inside Harris or Dallas said they
  would use the protest rule and the real rolls "tomorrow"; others asked for tax history.
- **It is timed.** Value notices go out in spring and most protests are due May 15 (in 2027,
  Monday May 17, because May 15 is a Saturday). A kit started now can be ready.

## The law it rests on

Quoted from the official text. Elements marked _(design)_ are FactLot choices, not law.

| Element                                    | Source                                       | What it says                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grounds                                    | Tax Code §41.41(a)(1)–(2)                    | An owner may protest the "determination of the appraised value" and "unequal appraisal of the owner's property".                                                                                                                                                                                                                                                                  |
| Burden on the district                     | §41.43(a)                                    | In a value or unequal-appraisal protest the district must establish the value "by a preponderance of the evidence"; if it fails, the protest is decided for the owner.                                                                                                                                                                                                            |
| Unequal appraisal at the ARB               | §41.43(b)(1)–(3)                             | Decided for the owner unless the district shows the property's ratio is at or below a median level of appraisal, or (b)(3) "the appraised value of the property is equal to or less than the median appraised value of a reasonable number of comparable properties appropriately adjusted".                                                                                      |
| Unequal appraisal in court                 | §42.26(a)(3), (b)                            | Same test on appeal; the court sets the value to the median, and where several tests apply, to "the value that results in the lowest appraised value".                                                                                                                                                                                                                            |
| Which value to compare                     | §42.26(d)                                    | Until 2027-01-01: market value when the property is capped under §23.23 or §23.231. From 2027-01-01: only a residence homestead capped under §23.23. The §23.231 circuit breaker and its protest ground §41.41(a)(4-a) drop out of the text on that date.                                                                                                                         |
| Higher burden with owner evidence          | §41.43(a-3), (a-5)                           | Clear-and-convincing burden on the district if the value was lowered under this subtitle the year before (not by a §1.111(e) agreement) and the owner files information "sufficient to allow for a determination" (income and expenses, sales, or unequal-appraisal information) "not later than the 14th day before the date of the first day of the hearing". It is not a duty. |
| Same, for properties of $1 million or less | §41.43(a-1), (a-2)                           | Clear-and-convincing burden if the owner delivers a certified appraisal (Occupations Code ch. 1103) made within 180 days before the hearing, by the 14th day before it.                                                                                                                                                                                                           |
| District's evidence                        | §41.461(a)(2), §41.67(d)                     | On request the owner gets the data, schedules and formulas the district will use. Requested information not delivered at least 14 days before the hearing may not be used, except in rebuttal.                                                                                                                                                                                    |
| Value cannot go up                         | §41.47(c-2)                                  | The ARB may not set a value above the one on the records submitted to it, unless the owner asks.                                                                                                                                                                                                                                                                                  |
| Evidence is not an appraisal               | §41.66(l)                                    | A person offering evidence in a value or unequal-appraisal protest is not subject to ch. 1103 unless they say they are offering it as a licence holder.                                                                                                                                                                                                                           |
| Filing deadline                            | §41.44(a)(1), §1.06                          | Already built and verified.                                                                                                                                                                                                                                                                                                                                                       |
| Who needs to register as a consultant      | Occupations Code §1152.001(5)–(6), §1152.002 | See [Legal boundary](#legal-boundary).                                                                                                                                                                                                                                                                                                                                            |

Out of scope for v1: the §41.43(b)(1)–(2) ratio tests (they need market values from sales the
owner usually cannot get; the Comptroller's property value study, admissible under §42.26(c), is a
candidate source for later), exemptions, special appraisal (agricultural and similar), business
personal property, residential property, and late protests.

## Legal boundary

This section decides what the kit may do. It is a reading of the statute for design purposes, not
a legal opinion, and it has a gate (G1 below).

- Occupations Code §1152.001(5)–(6): a "property tax consultant" performs "property tax
  consulting services" **for compensation**. Those services include representing someone in a
  protest, negotiating with the district for them, acting as their §1.111 agent, and "consulting
  or advising another person concerning ... an action the other person may protest".
- §1152.002(a) exempts, among others, licensed attorneys, CPAs, a property owner's own employees,
  and a person who "assists another person in the performance of property tax consulting
  services" (a)(7), unless that person is the designated agent or gets more than half its income
  from the work (b).

Design rules that follow:

1. **No representation, ever.** No tool or skill files a protest, signs a §1.111 designation,
   contacts a district, or negotiates.
2. **Tools compute; they do not advise.** Outputs state what the arithmetic shows with the inputs
   given ("the subject's appraised value is above the median adjusted value of the 9 comparables
   supplied"). No output says whether to protest, what value to claim, or how likely a protest is
   to win. The plugin skill tells the user to file themselves or use a registered consultant or
   attorney.
3. **Never called an appraisal.** Workbooks and outputs say "evidence calculation" and carry the
   §41.66(l) point: they are not offered as the work of a ch. 1103 licence holder.
4. **The paying customer we design for is the professional.** Registered consultants, tax
   attorneys, CPAs, and in-house tax departments are the commercial protest market and are either
   registered or exempt. Selling them a calculation and data tool fits the "assists" exemption
   reading. Selling an owner a paid "protest service" does not, so the kit is never marketed that
   way.
5. **Until G1 clears, protest tools are free.** The open-source SDK and the hosted free tier carry
   them; no paid plan is sold on the strength of them.

## What gets built

Each piece follows the existing conventions: TypeScript and Python with shared vectors in
`spec/vectors/`, a differential test, unknown fields rejected with a did-you-mean, whole-number
percentages rejected, a versioned formula or rule ID, an audit trail, and every input fact's
citation passed through to the output.

### P1. `calc_tx_unequal_appraisal` (`calc.tx_unequal_appraisal@1`)

The §41.43(b)(3) / §42.26(a)(3) arithmetic. No registry needed: any agent can call it with comps
it has.

Input:

```json
{
  "tax_year": 2027,
  "subject": {
    "id": "fl:parcel:us-48201:0420150000012",
    "appraised_value": 4200000,
    "improvement_area_sf": 31000,
    "value_basis": "appraised"
  },
  "normalize_by": "improvement_area_sf",
  "adjustment_combine": "sum",
  "comparables": [
    {
      "id": "fl:parcel:us-48201:0420150000034",
      "appraised_value": 3650000,
      "improvement_area_sf": 29500,
      "value_basis": "appraised",
      "citation": { "fact_id": "…", "document_id": "fl:document:sha256-…" },
      "adjustments": [
        {
          "label": "age",
          "kind": "percent",
          "value": 0.05,
          "reason": "comp built 1998, subject 2006"
        },
        {
          "label": "size",
          "kind": "percent",
          "value": -0.02,
          "reason": "comp 5% smaller"
        }
      ]
    }
  ]
}
```

- `normalize_by` (_design_): `null` compares whole values; `improvement_area_sf` or
  `land_area_sf` converts each comp to $/SF and multiplies by the subject's area before
  adjusting, which is how most unequal-appraisal grids are built. Required areas must be present
  and positive.
- Adjustments are supplied by the caller, each with a label and reason; the tool never invents
  one. `kind` is `percent` (a decimal), `amount` (USD), or `psf` (USD per SF of the normalizing
  area). `adjustment_combine` (_design_) is `sum` (percentages added, then applied once; the
  usual grid practice) or `compound`. Amounts and $/SF adjustments are applied after percentages.
- Output: each comp's normalized and adjusted value with every step; the sorted list; the median
  (for an even count, the mean of the two middle values, with both listed); the subject's value
  minus the median, in dollars and percent; and `indicated_value`, the median, labelled as "the
  value §42.26(b) would set if this comparison were accepted".
- Warnings: a comp whose `value_basis` differs from the subject's; tax year 2026 or earlier with
  a §23.231-capped property (§42.26(d) then requires market value); a comp in a different county
  (appraisal district) from the subject; fewer than 5 comps ("the statute does not define a
  reasonable number"); one comp contributing an adjustment over 25% in total (_design_ flag, not
  law); a comp equal to the subject.
- Errors: fewer than 3 comps (_design_ floor, documented as a product rule, not law); the subject
  among its own comps.

### P2. `rules_tx_protest_evidence_dates` (`rules.tx.protest_evidence_dates@1`)

Given the scheduled first day of the hearing, return the dates that matter before it:

- `owner_evidence_by`: the 14th day before the first day of the hearing, for §41.43(a-1) and
  (a-3) to apply;
- `district_evidence_due`: the 14th day before the hearing, after which requested district
  information is excluded under §41.67(d);
- `appraisal_made_on_or_after`: the 180th day before the hearing, for an (a-1) appraisal.

Open point for the verifier: whether §1.06's rollover moves a "not later than the 14th day
before" date when it lands on a weekend or holiday. The rule returns the unadjusted date and a
`recommended_by` date that rolls **back** to the previous business day, which is safe either way,
following the deadline rule's `recommended_file_by` pattern. Starts as a draft pack and becomes a
tool only once verified.

### P3. `registry_tx_equity_candidates`

Registry tool: given a Texas parcel, return candidate comparables from the same appraisal
district and tax year, with their values, characteristics, and citations, and the rule that
chose them. Candidates, not comps: a person or their agent decides which to use.

- Default selection (_design_, every parameter returned and overridable): same county and tax
  year; same `parcel.state_property_category` code; improvement area within ±35% of the subject;
  year built within ±15 years when both are known; same ZIP code first, widening to the county
  if fewer than 10 match; at most 50, nearest in area first.
- Output omits owner names and mailing addresses entirely. Comps need values and characteristics,
  not people, so the tool never returns `ownership.*` facts (data policy §3).
- Works today against a local registry file (`FACTLOT_REGISTRY_DB`). Hosted lookups follow the
  owner's hosted-registry work for the Texas region; this kit does not change `deploy/cloudflare`.
- Output is shaped to feed P1 directly.

Better candidates need fields the adapters do not read yet: the district's neighborhood code and
building class or quality (HCAD's building and neighborhood files, and their equivalents in the
other seven districts). That is adapter work (P3b), run on the real files before any count is
recorded.

### P4. Value history and the 2027 rolls

- `registry_get` already takes `as_of` and `include_history`. Add a value-history view on top:
  market and appraised value by tax year, each cited, so a user can see the change being
  protested.
- For Dallas and Fort Bend, where only market value is recorded, P1 and P3 use market value and
  say so. For commercial property without a cap, appraised and market value are normally the
  same; checking whether Dallas's export carries a separate appraised value is part of G3.
- The weekly collector must pick up each district's **preliminary 2027 values** when they appear
  in spring, and the adapters must record them as tax year 2027 without retiring the certified
  2026 facts. The timing and file names for each of the eight districts are unverified (G3).
- History before 2026 exists only if a district publishes prior-year exports; unverified (G3).

### P5. Income approach, linked

No new calculator: `calc_direct_cap` and `calc_dcf_pro_forma` already do the arithmetic. The
skill wires them in, and for Greater Houston it can cite asking rents from Fact Lease
(factlease.com/houston/suites.json). Those are public asking rents from listing pages, not
signed-lease rents, and are labelled that way in every output.

### P6. Evidence workbook and fact package

- An Excel workbook in the style of `examples/reconciliation/`: subject, comps with citations,
  the adjustment grid with live formulas beside FactLot's numbers, the median, and the dates.
  Titled "evidence calculation", never "appraisal".
- A `fact_package_create` package of the subject, the comps and the calculation, so a reviewer
  can run `fact_package_verify` and check every cited value against its source document.

### P7. Plugin skill `tx-commercial-protest-evidence`

Extends the existing skill: deadline (built), evidence dates (P2), candidates (P3), the user picks
comps and supplies or confirms adjustments, the calculation (P1), optionally the income approach
(P5), then the workbook and package (P6). It follows the design rules above and ends by telling
the user to file through the district's own process, themselves or through a registered
consultant or attorney.

## Gates

| Gate | What                                                                                                                                           | Who                 | Blocks                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------- |
| G1   | Counsel reads the [legal boundary](#legal-boundary), especially §1152.001(6)(C) and the (a)(7) reading, before any paid plan relies on the kit | founder and counsel | charging for protest tools              |
| G2   | A named maintainer verifies P1's statutory elements and P2 against the official text and records it                                            | maintainer          | P2 becoming a tool; P1 "verified" label |
| G3   | Each district's preliminary-roll timing, file names, and prior-year exports, checked on the publisher's pages                                  | data agent          | P4                                      |
| G4   | Tarrant's robots.txt `Content-Signal: ai-train=no` re-read for this use (lookup, not training; expected to be fine)                            | data agent          | Tarrant in P3                           |

San Antonio stays out until Bexar's bulk file is obtained (a records request, already gated).

## Build order and dates

| When (2026–27) | Work                                                                                                  | Done means                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Nov–Dec        | P1 calculator; P2 as a draft pack                                                                     | both SDKs, vectors with independently computed answers, differential test, docs |
| Dec–Jan        | P3 on a local registry; P3b neighborhood and class fields for Harris and Dallas first                 | adapter run on the real 2026 files; candidate rule tested on known parcels      |
| Jan–Feb        | P4 value history; G3 checks; P6 workbook and package                                                  | workbook reconciles to 0.00 against FactLot's numbers                           |
| Feb–Mar        | P7 skill; G1 and G2; simulated-user round with consultant and owner personas                          | skill runs end to end on a Harris parcel with the free hosted tools             |
| Apr–May        | Preliminary 2027 rolls collected and loaded; hosted Texas lookups if the owner's region work is ready | 2027 values queryable before the May 17, 2027 deadline                          |

## Not doing

- Residential protests (natural-person owners, and the registry is commercial only).
- Guessing sale prices, or inferring market value from anything other than what the roll states.
- Telling anyone to protest, what to claim, or their odds.
- Filing, agent designation, or contact with a district.
