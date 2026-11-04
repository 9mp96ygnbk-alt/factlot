# DRAFT: NYC Local Law 97 building emissions

**Status: draft.** No named maintainer has checked this pack against the official text. Do not
rely on it. Every result says `status: "draft"` and starts its warnings with "DRAFT — not verified
against the official text; do not rely on it."

|                   |                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Pack              | `nyc_ll97_building_emissions`                                                                      |
| Rule ID           | `rules.nyc.ll97_building_emissions@1`                                                              |
| Code              | `packages/calc/src/rules-drafts/nyc-ll97.ts`, `python/src/factlot/rules_drafts/nyc_ll97.py`        |
| Vectors           | `spec/vectors/rules/drafts/nyc_ll97_building_emissions.json` (expected values from `reference.py`) |
| Reference tables  | `spec/vectors/rules/drafts/nyc_ll97.tables.json`                                                   |
| Sources retrieved | 2026-11-03                                                                                         |

## What it does

Given the floor area of a building by ENERGY STAR Portfolio Manager (ESPM) property type and its
annual energy use by source, for a calendar year from 2024 to 2034, it returns:

- the annual building emissions limit: Σ (emissions factor × floor area), per property type;
- the building's emissions: Σ (energy × coefficient), per source;
- the excess over the limit, whether the building is within the limit, and the penalty
  (excess × $268);
- whether the summed floor area exceeds 25,000 gross square feet.

```ts
import { runDraftRule } from "@factlot/calc";

runDraftRule(
  "nyc_ll97_building_emissions",
  {
    calendar_year: 2024,
    spaces: [{ property_type: "Office", floor_area_sf: 100000 }],
    energy: { utility_electricity_kwh: 2000000, natural_gas_kbtu: 5000000 },
  },
  { acknowledgeDraft: true },
);
// limit 758 tCO2e, emissions 843.474 tCO2e, excess 85.474 tCO2e, penalty $22,907.03
```

```python
from factlot import run_draft_rule

run_draft_rule("nyc_ll97_building_emissions", {...}, acknowledge_draft=True)
```

Inputs: `calendar_year` (2024–2034); `spaces`, a list of `{property_type, floor_area_sf}` with the
property type spelled exactly as in the rule's tables; `energy` with any of
`utility_electricity_kwh`, `natural_gas_kbtu`, `fuel_oil_2_kbtu`, `fuel_oil_4_kbtu`,
`district_steam_kbtu`, and `other_fuels: [{fuel, kbtu}]` for the fuels in §103-14(d)(3)(i)(a).
Unknown fields are rejected.

Rounding is a calculator convention, not law: per-space limits, per-source emissions and the
totals are rounded half away from zero to 0.0001 tCO2e; the excess is the difference of the
rounded totals; the penalty is rounded to the cent.

## Sources and operative text

All retrieved 2026-11-03 from nyc.gov.

- **Local Law 97 of 2019** (adds Admin. Code Article 320):
  https://www.nyc.gov/assets/buildings/local_laws/ll97of2019.pdf
- **Local Law 147 of 2019** (amends §28-320.3.1.1 and §28-320.3.2):
  https://www.nyc.gov/assets/buildings/local_laws/ll147of2019.pdf
- **1 RCNY §103-14**, DOB compilation including the amendment effective 2025-01-19:
  https://www.nyc.gov/assets/buildings/rules/1_RCNY_103-14.pdf
- **1 RCNY §103-14 promulgation details** (the Notices of Adoption, used for the independent
  transcription): https://www.nyc.gov/assets/buildings/rules/1_RCNY_103-14_prom_details_date.pdf

### Covered building size test — Admin. Code §28-320.1 (L.L. 97/2019)

> COVERED BUILDING. The term "covered building" means, as it appears in the records of the
> department of finance, (i) a building that exceeds 25,000 gross square feet or (ii) two or more
> buildings on the same tax lot that together exceed 50,000 gross square feet (9290 m2), or (iii)
> two or more buildings held in the condominium form of ownership that are governed by the same
> board of managers and that together exceed 50,000 gross square feet (9290 m2).

Encoded: `exceeds_25000_gsf` (summed floor area > 25,000). Not encoded: the lot and condominium
tests, the seven exceptions, Department of Finance records.

### Property types and floor area — 1 RCNY §103-14(c)(2), (d)(1)

> The occupancy group for each space in a covered building must be determined according to the
> Energy Star Portfolio Manager (ESPM) property type as set out in this rule, or any successor ESPM
> name for such property type, that most accurately describes the use of such space during the year
> for which building emissions are reported, provided that the ESPM property types "Other" and
> "Mixed Use" may not be assigned to any portion of a covered building.

> The floor area of each occupancy group or property type reported must add up to the covered
> building's gross floor area.

Encoded: the 60 property types in the tables; "Other" and "Mixed Use" are rejected; gross floor
area is the sum of the spaces.

### Emissions factors — 1 RCNY §103-14(c)(3)(i) and (iii)

> (i) Except as provided in subparagraph (ii) of this paragraph, for the purposes of reporting for
> calendar years 2024 – 2029, the following emissions factors apply to the following Energy Star
> Portfolio Manager (ESPM) property types: […]

> (iii) For the purposes of reporting for calendar years 2030 – 2034, the following emissions
> factors apply to the following Energy Star Portfolio Manager property types: […]

The two tables (60 rows each, tCO2e per sf) are in `nyc_ll97.tables.json`. Not encoded: the
2035–2039 and 2040–2049 tables (no emissions coefficients exist yet for those years).

### Limit — 1 RCNY §103-14(d)(2)(ii)

> The building emissions limit for a covered building with multiple occupancy groups or property
> types must be calculated as the sum of the emissions factor for each occupancy group or property
> type multiplied by the floor area of each occupancy group or property type in the covered
> building: B = ∑ lk ∙ sk (Equation 103-14.1)

### Emissions — 1 RCNY §103-14(d)(4)(i)

> X = ∑n mn ∙ gn (Equation 103-14.13) […] mn = the energy consumed for each energy source or fuel
> type, n, in kBtu for the year reported. gn = the GHG carbon coefficient for the year reported for
> each energy source or fuel type, n, in tCO2e per kBtu.

Utility electricity is taken in kWh and multiplied by the per-kWh coefficient the law gives, which
is the same product.

### Coefficients, 2024–2029 — Admin. Code §28-320.3.1.1 items 1–5 (as amended by L.L. 147/2019)

> 1. Utility electricity consumed on the premises of a covered building that is delivered to the
>    building via the electric grid shall be calculated as generating 0.000288962 tCO2e per kilowatt
>    hour […]
> 2. Natural gas combusted on the premises of a covered building shall be calculated as generating
>    0.00005311 tCO2e per kbtu.
> 3. #2 fuel oil combusted on the premises of a covered building shall be calculated as generating
>    0.00007421 tCO2e per kbtu.
> 4. #4 fuel oil combusted on the premises of a covered building shall be calculated as generating
>    0.00007529 tCO2e per kbtu.
> 5. District steam consumed on the premises of a covered building shall be calculated as
>    generating 0.00004493tCO2e per kbtu.

### Coefficients, 2030–2034 — 1 RCNY §103-14(d)(3)(i)(b) and (d)(3)(ii)

> b. Exceptions. Notwithstanding any other provision of this subparagraph, for building emissions
> reports for calendar years 2030 – 2034: 1. Number two (No. 2) fuel oil combusted on the premises
> of a covered building shall be calculated as 0.00007421 tCO2e per kBtu. 2. Number four (No. 4)
> fuel oil combusted on the premises of a covered building shall be calculated as 0.00007529 tCO2e
> per kBtu.

> a. Utility electricity consumed on the premises of a covered building that is delivered to the
> building via the electric grid shall be calculated as generating 0.000145 tCO2e per kWh […]
> b. Natural gas delivered by a utility combusted or consumed on the premises of a covered building
> shall be calculated as generating 0.00005311 tCO2e per kBtu.
> c. District steam delivered by a utility and consumed on the premises of a covered building shall
> be calculated as 0.0000432 tCO2e per kBtu.

### Other fuels, 2024–2034 — 1 RCNY §103-14(d)(3)(i)(a)

> For the following fuel types combusted or consumed on premises, greenhouse gas emissions must be
> calculated as generating the following amounts of tCO2e per kBtu: […]

Nineteen fuels, butane through biofuel, in `nyc_ll97.tables.json`.

### Penalty — Admin. Code §28-320.6 and 1 RCNY §103-14(h)

> §28-320.6 Penalties. An owner of a covered building who has submitted a report pursuant to
> section 28-320.3.7 which indicates that such building has exceeded its annual building emissions
> limit shall be liable for a civil penalty of not more than an amount equal to the difference
> between the building emissions limit for such year and the reported building emissions for such
> year, multiplied by $268.

> (h) […] Such penalty shall be an amount equal to the difference between the building emissions
> limit established for a calendar year and the actual emissions reported for such calendar year
> in the building emissions report, multiplied by $268.

The pack returns this amount and warns that the statute makes it a maximum and that §103-14(i)
allows mitigation.

## Not covered (gaps)

- The 2024–2025 election to use the occupancy-group limits in §28-320.3.1 where higher
  (§103-14(c)(3)(ii)). The rule says emissions may not be calculated "using a combination of such
  provisions"; whether that allows a per-space choice is unclear, so it is not encoded.
- Time-of-use electricity, campus-style systems, distributed energy resources, fuel cells,
  beneficial electrification, co-generation (§103-14(d)(3)(iii)–(vii), (d)(4)(iii)).
- Deductions: renewable energy credits, clean distributed energy, AHRF offsets, EV charging,
  emergencies (§103-14(d)(4)(ii), (e)).
- Who is covered beyond the 25,000 sf test: lots, condominiums, exceptions, Article 321.
- Adjustments (§28-320.7 to .9), penalty mitigation (§103-14(i)), the late-report penalty
  (§103-14(g)), and calendar years after 2034.
- The codified Admin. Code text (published by American Legal Publishing, not a .gov site) was not
  read; the pack relies on the local laws as enacted.

## Verification checklist

A maintainer moving this pack to `verified` must complete every step and record the results in
the pull request.

1. Download the three official files above yourself and note the retrieval date.
2. Confirm currency:
   - check the NYC rules portal (rules.cityofnewyork.us) for any amendment of 1 RCNY §103-14
     effective after 2025-01-19, and re-download the compilation if there is one;
   - check the codified Admin. Code Article 320 (§28-320.1, §28-320.3.1.1, §28-320.3.2,
     §28-320.6) for any local law after L.L. 147 of 2019 that changes the text quoted here.
3. Run `python3 scripts/rules/check_draft_tables.py nyc <your 1_RCNY_103-14.pdf>` and confirm
   "0 difference(s)". This checks the 120 emissions factors, 19 fuel coefficients and the
   2030–2034 coefficients against the official PDF.
4. Read each quotation in this page against the official text, word for word.
5. Confirm or reject each interpretation the pack makes:
   - the ESPM property-type factors apply for every year, with no occupancy-group election;
   - 2024–2029 utility electricity, natural gas, #2 and #4 oil and district steam come from
     §28-320.3.1.1; 2030–2034 from §103-14(d)(3)(i)(b) and (d)(3)(ii); other fuels from
     §103-14(d)(3)(i)(a) for both periods;
   - the 2030–2034 electricity coefficient is 0.000145 tCO2e **per kWh** (a public comment on the
     proposed rule questioned the unit; the adopted text says kWh);
   - gross floor area is the sum of the spaces, and the size flag uses "exceeds 25,000";
   - the penalty is excess × $268, reported as the maximum before mitigation;
   - the rounding convention above is acceptable.
6. Recompute by hand the vectors "office, 2024: electricity and gas over the limit" and "hotel with
   restaurant, 2032, other fuels" and confirm the expected values.
7. Accept the gap list above, or open issues for the gaps that must close before release.
8. Then, in one pull request: set `verification.status` to `"verified"` with `verified_by` (your
   name) and `verified_at` in both SDKs; move the pack from `draftRulePacks` / `DRAFT_RULES` to
   `rulePacks` / `RULES` (this makes it a tool and adds one OpenAPI operation); move its vectors
   to `spec/vectors/rules/`; bump the version if any behaviour changed; update `docs/rules.md`.
