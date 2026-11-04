# DRAFT: Washington Clean Buildings Performance Standard EUI target

**Status: draft.** No named maintainer has checked this pack against the official text. Do not
rely on it. Every result says `status: "draft"` and starts its warnings with "DRAFT — not verified
against the official text; do not rely on it."

|                   |                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Pack              | `wa_cbps_eui_target`                                                                      |
| Rule ID           | `rules.wa.cbps_eui_target@1`                                                              |
| Code              | `packages/calc/src/rules-drafts/wa-cbps.ts`, `python/src/factlot/rules_drafts/wa_cbps.py` |
| Vectors           | `spec/vectors/rules/drafts/wa_cbps_eui_target.json` (expected values from `reference.py`) |
| Reference tables  | `spec/vectors/rules/drafts/wa_cbps.tables.json`                                           |
| Sources retrieved | 2026-11-03                                                                                |

## What it does

For a building described by its activities (Table 7-1 numbers), floor areas, weekly operating
hours and whether each area was more recently built, in climate zone 4C, 5B, 5C or 6B, it returns:

- the energy use intensity target (EUIt), kBtu/sf/yr, with and without the 15% reduction for
  more recently built floor area;
- given a weather-normalized EUI, whether the building meets the target (the Tier 1 test);
- given floor areas by use, the covered-building tier and initial compliance date.

```ts
runDraftRule(
  "wa_cbps_eui_target",
  {
    climate_zone: "5C",
    spaces: [
      { activity: 69, floor_area_sf: 80000, weekly_operating_hours: 60 },
      {
        activity: 94,
        floor_area_sf: 20000,
        weekly_operating_hours: 40,
        more_recently_built: true,
      },
    ],
    weather_normalized_eui: 60,
    coverage: {
      nonresidential_hotel_motel_dormitory_sf: 100000,
      multifamily_residential_sf: 0,
      gross_floor_area_sf: 100000,
    },
  },
  { acknowledgeDraft: true },
);
// EUIt 57.34 (58.56 before the reduction), does not meet it, Tier 1, first report 2027-06-01
```

Weekly hours must be whole numbers from 0 to 168, so each falls in exactly one column of Table 7-3
(50 or less, 51 to 167, 168). Activities without an energy target (Table 7-1 rows 52, 67, 93, 95,
99, 100, 108, 109) are rejected with the table note that explains why.

Rounding is a calculator convention, not law: the EUIt is reported to 0.01 kBtu/sf/yr and the
comparison with the WNEUI uses the unrounded target.

## Sources and operative text

Chapter 194-50 WAC as certified on 2026-08-12 (last update 2026-07-21; WSR 26-15-112, effective
2026-08-21), from the Code Reviser's file server, retrieved 2026-11-03:

- combined chapter PDF:
  https://lawfilesext.leg.wa.gov/law/WACPDF/WAC%20194%20%20TITLE/WAC%20194%20-%2050%20%20CHAPTER/WAC%20194%20-%2050%20%20COMBINEDCHAPTER.pdf
- WAC 194-50-150 (Normative Annex Z) HTML, used for the independent transcription:
  https://lawfilesext.leg.wa.gov/law/WAC/WAC%20194%20%20TITLE/WAC%20194%20-%2050%20%20CHAPTER/WAC%20194%20-%2050%20-150.htm

RCW 19.27A.200 and 19.27A.210 were **not** read: app.leg.wa.gov disallows automated access in its
robots.txt. A maintainer must read them in a browser.

### Covered buildings and more recently built — WAC 194-50-030

> Tier 1 covered building: A building where the sum of nonresidential, hotel, motel, and dormitory
> floor areas exceeds 50,000 gross square feet, excluding the parking garage area.

> Tier 2 covered building: A building where the sum of multifamily residential, nonresidential,
> hotel, motel, and dormitory floor areas exceeds 20,000 gross square feet, but does not exceed
> 50,000 gross square feet, excluding the parking garage area. Tier 2 covered buildings also include
> multifamily residential buildings where floor areas are equal to or exceed 50,000 gross square
> feet, excluding the parking garage area.

> More recently built buildings: Buildings and additions permitted for construction based on the
> application permit date of July 1, 2016, or later.

Encoded: `tier1` when nonresidential/hotel/motel/dormitory area > 50,000; `tier2` when the sum is
over 20,000 and at most 50,000, or for an all-multifamily building of 50,000 sf or more;
`not_covered` at 20,000 or less; otherwise `undetermined` (for example 40,000 sf office plus
30,000 sf apartments, which neither definition clearly covers).

### Meeting the target — WAC 194-50-040 §4.3.2

> If the Tier 1 covered building's measured weather normalized energy use intensity (WNEUI) is less
> than or equal to its energy use intensity target (EUIt), the building complies.

### The target — WAC 194-50-070 §§7.2.1.2, 7.2.2, 7.2.3

> 7.2.1.2 Additional target for more recently built buildings: The EUIt values for a more recently
> built building (or addition), calculated in accordance with Section 7.2.1, shall be reduced by 15
> percent for all floor area meeting the definition of more recently built buildings.

> 7.2.2 […] (EUIt) = S × (EUIt1) where (EUIt1) is the building activity energy target value in
> Table 7-2a for the appropriate building activities/types and climate, and S is the building
> operating shifts normalization factor in Table 7-3.

> 7.2.3 […] EUIt = (A × S × EUIt1)1 + (A × S × EUIt1)2 + ... + (A × S × EUIt1)n Where: (A)i =
> percentage of the gross floor area with single building activity i […]

Encoded: A is each space's share of the floor area entered; each more recently built space's
weighted target is multiplied by 0.85.

### Tables — WAC 194-50-150 Section Z7

> Table 7-2a Building Activity Site Energy Targets (EUIt1) (I-P Units)

> Table 7-3 Building Operating Shifts Normalization Factor […] Weekly Hours […] 50 or less […] 51
> to 167 […] 168

113 rows each, in `wa_cbps.tables.json`.

### Climate zone — WAC 194-50-150 Section Z6.2, Form B instruction 2

> List the building location climate zone, 4C or 5B. […] a. Buildings located in Climate Zone 5C
> shall use Climate Zone 4C. b. Buildings located in Climate Zone 6B shall use Climate Zone 5B.

### Compliance dates — WAC 194-50-150 Section Z3.2 and WAC 194-50-160 Section Y3.2

> 1. Compliance date. a. For a building with more than 220,000 gross square feet, June 1, 2026; b.
>    For a building with more than 90,000 gross square feet but less than 220,001 gross square feet,
>    June 1, 2027; and c. For a building with more than 50,000 gross square feet but less than 90,001
>    gross square feet, June 1, 2028.

> 1. Compliance date. For a building with more than 20,000 gross square feet but less than 50,001
>    gross square feet and all multifamily residential buildings more than 20,000 gross square feet:
>    July 1, 2027.

## Not covered (gaps)

- The five exceptions to §7.2.3 (single-use majority, similar activities, nontarget spaces at 10%
  and 50%, nontarget buildings), vacant spaces (§7.2.4), grouped and campus-level targets
  (Annex W), the ENERGY STAR median fallback (§7.2.1.1 exception 1), local equivalent programs.
- Alternative weekly hours for health care, aquariums, museums and zoos (Table 7-3 notes 7, 9) and
  campus-level shift factors (note 10).
- Conditional compliance, investment criteria, energy management plans, exemptions, extensions.
- Penalties (§Z5.4): "not to exceed $5,000 plus an amount based on the duration of any continuing
  violation", with a daily amount "equal to one dollar per square foot of gross floor area per
  year". Whether the daily amount is $1/sf divided by 365 is not stated, so it is not encoded.
- The RCW text (robots.txt).

## Verification checklist

1. Download the combined chapter PDF and the WAC 194-50-150 HTML yourself and note the date.
   Confirm the certification date and the latest WSR in the history notes; if the chapter changed
   after WSR 26-15-112, re-check everything below against the new text.
2. Read RCW 19.27A.200 (definitions) and 19.27A.210 in a browser and confirm they do not conflict
   with the WAC definitions, thresholds and dates used here.
3. Run `python3 scripts/rules/check_draft_tables.py wa <your WAC 194-50-150 .htm>` and confirm
   "0 difference(s)" (113 rows × 2 targets and 3 shift factors, plus the row names). Spot-check
   five rows against the PDF too.
4. Read each quotation in this page against the official text, word for word.
5. Confirm or reject each interpretation:
   - integer weekly hours and the three columns of Table 7-3;
   - A is the share of the floor area entered (spaces without targets are rejected, not excluded);
   - the 15% reduction applies to the weighted target of each more recently built space;
   - meeting the target is WNEUI ≤ unrounded EUIt;
   - the tier logic, including the `undetermined` case, and that the Z3.2 cohort uses the gross
     floor area entered (the WAC does not say whether parking is excluded there);
   - Table 7-2a row 51 (Hospital) carries an asterisk with no footnote: confirm it changes nothing;
   - row 52 (Medical Office under Healthcare) has no target: medical offices use rows 68 or 72.
6. Recompute by hand "office with a recent retail addition, 5C mapped to 4C, Tier 1 cohort 2027"
   and "three-way mix with uneven areas".
7. Accept the gap list, or open issues for gaps that must close first.
8. Then promote as described in `docs/rules.md` (status, `verified_by`, `verified_at` in both
   SDKs; move to `rulePacks` / `RULES`; move the vectors; bump the version if behaviour changed).
