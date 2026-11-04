/**
 * DRAFT: Boston BERDO 2.0 emissions standard (City of Boston Code, Ordinances, Ch. VII §7-2.2(i)).
 *
 * Looks up the CO2e emissions standard for a building use and calendar year from Table 1 of the
 * ordinance, converts it to an annual limit for the building's gross floor area, and, given the
 * building's reported emissions, the excess and its cost at the Alternative Compliance Payment
 * rate. Emissions themselves are not computed: BERDO emissions factors are set each year by
 * Environment Department guidance (Regulations §VIII), which this pack does not encode.
 * Not verified: see docs/rules/boston-berdo.md.
 */
import { z } from "zod";

import {
  CalcInputError,
  Trace,
  parseInput,
  reduceNoise,
  round,
} from "../core.ts";
import type { CalcResult } from "../core.ts";
import { draftResult } from "./draft.ts";
import type { DraftRuleMeta, DraftValue } from "./draft.ts";

// Table 1: CO2e Emissions Standards by Building Use, kgCO2e/sf/yr, for 2025–2029, 2030–2034,
// 2035–2039, 2040–2044, 2045–2049 and 2050 onward. Checked against a second extraction.
export const BOSTON_BERDO_STANDARDS: readonly (readonly [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  ["assembly", "Assembly", 7.8, 4.6, 3.3, 2.1, 1.1, 0.0],
  ["college_university", "College/University", 10.2, 5.3, 3.8, 2.5, 1.2, 0.0],
  ["education", "Education", 3.9, 2.4, 1.8, 1.2, 0.6, 0.0],
  [
    "food_sales_and_service",
    "Food Sales & Service",
    17.4,
    10.9,
    8.0,
    5.4,
    2.7,
    0.0,
  ],
  ["healthcare", "Healthcare", 15.4, 10.0, 7.4, 4.9, 2.4, 0.0],
  ["lodging", "Lodging", 5.8, 3.7, 2.7, 1.8, 0.9, 0.0],
  [
    "manufacturing_industrial",
    "Manufacturing/Industrial",
    23.9,
    15.3,
    10.9,
    6.7,
    3.2,
    0.0,
  ],
  ["multifamily_housing", "Multifamily housing", 4.1, 2.4, 1.8, 1.1, 0.6, 0.0],
  ["office", "Office", 5.3, 3.2, 2.4, 1.6, 0.8, 0.0],
  ["retail", "Retail", 7.1, 3.4, 2.4, 1.5, 0.7, 0.0],
  ["services", "Services", 7.5, 4.5, 3.3, 2.2, 1.1, 0.0],
  ["storage", "Storage", 5.4, 2.8, 1.8, 1.0, 0.4, 0.0],
  ["technology_science", "Technology/Science", 19.2, 11.1, 7.8, 5.1, 2.5, 0.0],
];

const PERIODS = [
  "2025-2029",
  "2030-2034",
  "2035-2039",
  "2040-2044",
  "2045-2049",
  "2050-",
] as const;

const ORDINANCE =
  "https://www.boston.gov/sites/default/files/file/2023/12/BERDO%202.0%20Final%20Amended%20Docket%200775_1.pdf";
const REGULATIONS =
  "https://www.boston.gov/sites/default/files/file/2025/09/2025%20Final%20Regulations.pdf";
const RETRIEVED = "2026-11-03";

export const BOSTON_BERDO_EMISSIONS_STANDARD: DraftRuleMeta = {
  id: "rules.boston.berdo_emissions_standard",
  version: 1,
  jurisdiction: "us-ma-boston",
  title: "Boston BERDO 2.0 emissions standard by building use",
  citations: [
    {
      law: "City of Boston Code, Ordinances, Ch. VII §7-2.2(i) and Table 1",
      url: ORDINANCE,
      retrieved: RETRIEVED,
      covers:
        "emissions standards (kgCO2e/sf/yr) by building use and period; compliance measured annually as CO2e per square foot",
    },
    {
      law: "City of Boston Code, Ordinances, Ch. VII §7-2.2(m)(d)",
      url: ORDINANCE,
      retrieved: RETRIEVED,
      covers: "Alternative Compliance Payment of $234 per metric ton of CO2e",
    },
    {
      law: "BERDO Regulations §IX.a(i) (Air Pollution Control Commission, approved 2025-09-17)",
      url: REGULATIONS,
      retrieved: RETRIEVED,
      covers:
        "gross floor area for compliance: third-party verified, else Boston Assessing Department records",
    },
  ],
  verification: {
    status: "draft",
    notes:
      "Drafted from the docket text of the BERDO 2.0 ordinance (Docket #0775, filed 2021-09-22) and the 2025 regulations, both published on boston.gov and retrieved 2026-11-03. The codified §7-2.2 was not read: confirm the docket text is the ordinance as passed and that Table 1 has not been updated by the Commission. Not checked by a named maintainer.",
  },
  not_covered: [
    "computing emissions from energy use (emissions factors come from annual Environment Department guidance, Regulations §VIII)",
    "blended standards for buildings with more than one primary use (§7-2.2(i)(i); method in Policies and Procedures)",
    "which buildings are covered and from which year, including the 20,000–35,000 sf deferral to 2030 emissions",
    "Individual Compliance Schedules, Hardship Compliance Plans, Building Portfolios, exempt energy, RECs and PPAs",
    "fines (Regulations §XVIII)",
  ],
};

const USES = BOSTON_BERDO_STANDARDS.map(([id]) => id) as [string, ...string[]];

export const BostonBerdoInput = z.strictObject({
  building_use: z
    .enum(USES)
    .describe(
      "Building use from Table 1 (for a mixed-use building, its largest primary use; blended standards are not modelled).",
    ),
  gross_floor_area_sf: z
    .number()
    .finite()
    .positive()
    .max(1e8)
    .describe(
      "Gross floor area in square feet: third-party verified, else the Boston Assessing Department figure (Regulations §IX.a(i)).",
    ),
  calendar_year: z
    .number()
    .int()
    .min(2025)
    .max(2100)
    .describe("Emissions year, 2025 or later."),
  emissions_tco2e: z
    .number()
    .finite()
    .nonnegative()
    .max(1e9)
    .optional()
    .describe(
      "The building's annual emissions in metric tons CO2e, computed with the Environment Department's emissions factors.",
    ),
});
export type BostonBerdoInput = z.input<typeof BostonBerdoInput>;

export interface BostonBerdoResult {
  building_use: string;
  building_use_label: string;
  calendar_year: number;
  period: (typeof PERIODS)[number];
  emissions_standard_kgco2e_per_sf: number;
  emissions_limit_tco2e: number;
  emissions_tco2e: number | null;
  emissions_intensity_kgco2e_per_sf: number | null;
  meets_standard: boolean | null;
  excess_emissions_tco2e: number | null;
  alternative_compliance_payment_usd: number | null;
}

const ACP_PER_TCO2E = 234;

export function bostonBerdoEmissionsStandard(
  raw: BostonBerdoInput,
): CalcResult<DraftValue<BostonBerdoResult>> {
  const input = parseInput(BostonBerdoInput, raw);
  const t = new Trace();
  const row = BOSTON_BERDO_STANDARDS.find(([id]) => id === input.building_use);
  if (!row)
    throw new CalcInputError(`unknown building use ${input.building_use}`);
  const i = Math.min(Math.floor((input.calendar_year - 2025) / 5), 5);
  const period = PERIODS[i] as (typeof PERIODS)[number];
  const std = row[2 + i] as number;
  t.step(
    "Emissions standard",
    std,
    `Table 1, ${row[1]}, ${period}`,
    "kgCO2e/sf/yr",
  );
  const limit = round((input.gross_floor_area_sf * std) / 1000, 4);
  t.step(
    "Emissions limit",
    limit,
    `${input.gross_floor_area_sf} sf × ${std} kgCO2e/sf ÷ 1,000`,
    "tCO2e",
  );

  let intensity: number | null = null;
  let meets: boolean | null = null;
  let excess: number | null = null;
  let acp: number | null = null;
  const e = input.emissions_tco2e ?? null;
  if (e !== null) {
    const exact = (e * 1000) / input.gross_floor_area_sf;
    intensity = round(exact, 4);
    meets = reduceNoise(exact) <= std;
    t.step(
      "Emissions intensity",
      intensity,
      `${e} tCO2e × 1,000 ÷ ${input.gross_floor_area_sf} sf`,
      "kgCO2e/sf",
    );
    excess = Math.max(0, round(round(e, 4) - limit, 4));
    t.step(
      "Excess over the standard",
      excess,
      `max(0, ${e} − ${limit})`,
      "tCO2e",
    );
    acp = round(excess * ACP_PER_TCO2E, 2);
    t.step(
      "Alternative Compliance Payments to cover the excess",
      acp,
      `${excess} tCO2e × $234`,
      "USD",
    );
    if (excess > 0)
      t.warn(
        "Alternative Compliance Payments are a compliance option, not a fine; the $234 rate is reviewed every five years (§7-2.2(m)(d)). Fines for missing the standard are set in Regulations §XVIII and are not modelled.",
      );
  }
  t.warn(
    "Buildings of 20,000 sf (or 15 units) up to 35,000 sf (or 35 units) are not subject to the standards until 2030 emissions (§7-2.2(i)); coverage is not checked here.",
  );
  t.warn(
    "Rounding: the limit, intensity and excess are rounded to 0.0001 and the payment to the cent; the ordinance does not specify rounding.",
  );

  return draftResult(t, BOSTON_BERDO_EMISSIONS_STANDARD, {
    building_use: row[0],
    building_use_label: row[1],
    calendar_year: input.calendar_year,
    period,
    emissions_standard_kgco2e_per_sf: std,
    emissions_limit_tco2e: limit,
    emissions_tco2e: e,
    emissions_intensity_kgco2e_per_sf: intensity,
    meets_standard: meets,
    excess_emissions_tco2e: excess,
    alternative_compliance_payment_usd: acp,
  });
}
