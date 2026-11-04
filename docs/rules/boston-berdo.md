# DRAFT: Boston BERDO 2.0 emissions standard

**Status: draft.** No named maintainer has checked this pack against the official text. Do not
rely on it. Every result says `status: "draft"` and starts its warnings with "DRAFT — not verified
against the official text; do not rely on it."

|                   |                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Pack              | `boston_berdo_emissions_standard`                                                                      |
| Rule ID           | `rules.boston.berdo_emissions_standard@1`                                                              |
| Code              | `packages/calc/src/rules-drafts/boston-berdo.ts`, `python/src/factlot/rules_drafts/boston_berdo.py`    |
| Vectors           | `spec/vectors/rules/drafts/boston_berdo_emissions_standard.json` (expected values from `reference.py`) |
| Reference table   | `spec/vectors/rules/drafts/boston_berdo.tables.json`                                                   |
| Sources retrieved | 2026-11-03                                                                                             |

## What it does

For one of the 13 building uses in Table 1 of the ordinance, a gross floor area and an emissions
year (2025 or later), it returns the emissions standard (kgCO2e/sf/yr), the building's limit in
tCO2e, and, given the building's emissions in tCO2e, its emissions intensity, whether it meets the
standard, the excess, and what Alternative Compliance Payments for the excess would cost at
$234/tCO2e.

It does **not** compute emissions. BERDO emissions factors are adopted each year in Environment
Department guidance (Regulations §VIII.a), not in the ordinance or regulations, so the caller must
supply emissions computed with those factors.

```ts
runDraftRule(
  "boston_berdo_emissions_standard",
  {
    building_use: "office",
    gross_floor_area_sf: 120000,
    calendar_year: 2031,
    emissions_tco2e: 500,
  },
  { acknowledgeDraft: true },
);
// standard 3.2 kgCO2e/sf, limit 384 tCO2e, intensity 4.1667, excess 116 tCO2e, ACP $27,144
```

Building uses: `assembly`, `college_university`, `education`, `food_sales_and_service`,
`healthcare`, `lodging`, `manufacturing_industrial`, `multifamily_housing`, `office`, `retail`,
`services`, `storage`, `technology_science`.

Rounding is a calculator convention, not law: limit, intensity and excess to 0.0001, the payment
to the cent. Meeting the standard compares the unrounded intensity with the standard.

## Sources and operative text

Both retrieved 2026-11-03 from boston.gov:

- **Ordinance** amending City of Boston Code, Ordinances, Chapter VII, Sections 7-2.1 and 7-2.2
  (BERDO 2.0), Docket #0775, final amended text, filed in Council 2021-09-22:
  https://www.boston.gov/sites/default/files/file/2023/12/BERDO%202.0%20Final%20Amended%20Docket%200775_1.pdf
- **BERDO Regulations**, approved by the Air Pollution Control Commission 2025-09-17:
  https://www.boston.gov/sites/default/files/file/2025/09/2025%20Final%20Regulations.pdf

### Emissions standards — §7-2.2(i) and Table 1

> Each Building subject to the reporting requirements of this Subsection shall comply with the CO2e
> Emissions standards set forth in Table 1 below; provided, however, that Building Owners may
> develop and request approval for Individual Compliance Schedules pursuant to the requirements in
> section (k) or request a Hardship Compliance Plan pursuant to section (l). Buildings must comply
> with the Emissions standards on an annual basis and compliance shall be measured as a total of
> metric ton of CO2e Emissions per square foot.

> Table 1: CO2e Emissions Standards by Building Use […] Emissions standard (kgCO2e/SF/yr.) […]
> 2025 - 2029 2030-2034 2035-2039 2040-2044 2045-2049 2050-

The 13 rows are in `boston_berdo.tables.json`. Encoded: the column is chosen by the emissions year;
limit = floor area × standard ÷ 1,000.

### Floor area — Regulations §IX.a(i)

> When calculating square footage to determine compliance with Section 7-2.2(i), third-party
> verified Gross Floor Area shall be used. When third-party verified Gross Floor Area is not
> available, square footage as it appears in the records of the Boston Assessing Department shall
> be used.

The pack takes the floor area as given.

### Alternative Compliance Payment — §7-2.2(m)(d)

> The initial cost of an Alternative Compliance Payment shall be $234 per metric ton of CO2e. The
> cost of an Alternative Compliance Payment shall be reviewed every five (5) years by the Review
> Board, with input from the Environment Department, and may be adjusted by the Regulations.

## Not covered (gaps)

- Emissions from energy use (annual Environment Department emissions factors; time-of-use and
  district energy factors).
- Blended standards for buildings with more than one primary use (§7-2.2(i), "Blended Emissions
  Standards"; Regulations §IX.b says the method is in the Policies and Procedures, which were not
  retrieved).
- Coverage: which buildings are subject, and the deferral in §7-2.2(i): "Buildings equal to or
  greater than twenty thousand (20,000) square or fifteen (15) units but less than thirty-five
  thousand (35,000) square feet or thirty-five (35) units shall not be subject to the Emissions
  standards until 2031, reporting for 2030 emissions." The "or … but less than … or" wording is
  ambiguous for buildings that meet one test and not the other, so it is not encoded.
- Individual Compliance Schedules, Hardship Compliance Plans, Building Portfolios, exempt energy,
  RECs, PPAs, municipal aggregation.
- Fines (Regulations §XVIII table: per-day amounts by building class).

## Verification checklist

1. Download both files yourself and note the date. Confirm with the City Clerk or the codified City
   of Boston Code that the docket text is §7-2.2 as passed (and as in force today), and check
   whether the Commission has updated Table 1 under §7-2.2(i) or adjusted the $234 Alternative
   Compliance Payment rate (its first five-year review falls about now).
2. Run `python3 scripts/rules/check_draft_tables.py boston <your ordinance .pdf>` and confirm
   "0 difference(s)"; also read the 13 rows by eye (only one official document was available, so the
   two extractions behind the reference table are of the same PDF).
3. Read each quotation in this page against the official text, word for word.
4. Confirm or reject each interpretation:
   - the standard for a year is the Table 1 column containing that year, and "2050-" applies to
     every later year;
   - Table 1 is in kgCO2e and §7-2.2(i) speaks of metric tons, so the limit divides by 1,000;
   - meeting the standard means intensity ≤ standard (equal meets it);
   - a mixed-use building without a blended standard is held to its largest primary use (the pack
     takes whichever use the caller gives).
5. Recompute by hand "office, 2031, over the standard" and "last year of the first period".
6. Accept the gap list, or open issues for gaps that must close first.
7. Then promote as described in `docs/rules.md`.
