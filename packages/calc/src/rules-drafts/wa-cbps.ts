/**
 * DRAFT: Washington Clean Buildings Performance Standard (WAC 194-50) energy use intensity target.
 *
 * Computes a building's energy use intensity target (EUIt) from Tables 7-2a and 7-3 as modified
 * in Normative Annex Z (Section Z7), applies the 15% reduction for more recently built floor
 * area, compares a weather-normalized EUI with the target, and gives the covered-building tier
 * and initial compliance date. Tables are from chapter 194-50 WAC as certified on 2026-08-12
 * (WSR 26-15-112, effective 2026-08-21). Not verified: see docs/rules/wa-cbps.md.
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

// Table 7-2a (I-P units) and Table 7-3, WAC 194-50-150 Section Z7. Generated from the official
// PDF and checked against an independent parse of the Code Reviser's HTML.
// [No., Portfolio Manager type, sub-type, detailed sub-type, EUIt1 climate zone 4C (kBtu/sf/yr),
//  EUIt1 climate zone 5B, shift factor at 50 or fewer weekly hours, 51 to 167, 168];
// null where the table gives no energy target.
export const WA_CBPS_ACTIVITIES: readonly (readonly [
  number,
  string,
  string,
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
])[] = [
  [1, "Banking/financial services", "Bank Branch", "", 69, 71, 0.8, 1.0, 1.5],
  [
    2,
    "Banking/financial services",
    "Financial Office",
    "",
    69,
    71,
    0.8,
    1.0,
    1.5,
  ],
  [3, "Education", "Adult Education", "", 49, 51, 0.9, 1.1, 1.9],
  [4, "Education", "College/University", "", 102, 102, 0.9, 1.1, 1.9],
  [
    5,
    "Education",
    "K-12 School",
    "Elementary/middle school",
    49,
    50,
    0.9,
    1.1,
    1.9,
  ],
  [6, "Education", "K-12 School", "High school", 48, 49, 0.9, 1.1, 1.9],
  [7, "Education", "Preschool/Daycare", "", 59, 59, 0.9, 1.1, 1.9],
  [8, "Education", "Vocational School", "", 49, 51, 0.9, 1.1, 1.9],
  [9, "Education", "Other - Education", "", 49, 51, 0.9, 1.1, 1.9],
  [10, "Entertainment/public assembly", "Aquarium", "", 55, 59, 0.6, 1.1, 1.6],
  [
    11,
    "Entertainment/public assembly",
    "Bar/Nightclub",
    "",
    55,
    59,
    0.6,
    1.1,
    1.6,
  ],
  [
    12,
    "Entertainment/public assembly",
    "Bowling Alley",
    "",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [13, "Entertainment/public assembly", "Casino", "", 55, 59, 0.6, 1.1, 1.6],
  [
    14,
    "Entertainment/public assembly",
    "Convention Center",
    "",
    50,
    52,
    0.6,
    1.1,
    1.6,
  ],
  [
    15,
    "Entertainment/public assembly",
    "Fitness Center/Health Club/Gym",
    "",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [
    16,
    "Entertainment/public assembly",
    "Ice/Curling Rink",
    "",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [
    17,
    "Entertainment/public assembly",
    "Indoor Arena",
    "",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [
    18,
    "Entertainment/public assembly",
    "Movie Theater",
    "",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [19, "Entertainment/public assembly", "Museum", "", 67, 70, 0.6, 1.1, 1.6],
  [
    20,
    "Entertainment/public assembly",
    "Performing Arts",
    "",
    55,
    59,
    0.6,
    1.1,
    1.6,
  ],
  [
    21,
    "Entertainment/public assembly",
    "Race Track",
    "",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [
    22,
    "Entertainment/public assembly",
    "Roller Rink",
    "",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [
    23,
    "Entertainment/public assembly",
    "Social/Meeting Hall",
    "",
    50,
    52,
    0.6,
    1.1,
    1.6,
  ],
  [
    24,
    "Entertainment/public assembly",
    "Stadium (Closed)",
    "",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [
    25,
    "Entertainment/public assembly",
    "Stadium (Open)",
    "",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [
    26,
    "Entertainment/public assembly",
    "Swimming Pool",
    "",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [27, "Entertainment/public assembly", "Zoo", "", 55, 59, 0.6, 1.1, 1.6],
  [
    28,
    "Entertainment/public assembly",
    "Other - Entertainment/Public Assembly",
    "Entertainment/culture",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [
    29,
    "Entertainment/public assembly",
    "Other - Entertainment/Public Assembly",
    "Library",
    56,
    59,
    0.6,
    1.1,
    1.6,
  ],
  [
    30,
    "Entertainment/public assembly",
    "Other - Entertainment/Public Assembly",
    "Other public assembly",
    55,
    59,
    0.6,
    1.1,
    1.6,
  ],
  [
    31,
    "Entertainment/public assembly",
    "Other - Entertainment/Public Assembly",
    "Recreation",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [
    32,
    "Entertainment/public assembly",
    "Other - Entertainment/Public Assembly",
    "Social/meeting",
    50,
    52,
    0.6,
    1.1,
    1.6,
  ],
  [
    33,
    "Entertainment/public assembly",
    "Other - Recreation",
    "",
    73,
    78,
    0.6,
    1.1,
    1.6,
  ],
  [
    34,
    "Entertainment/public assembly",
    "Other - Stadium",
    "",
    67,
    70,
    0.6,
    1.1,
    1.6,
  ],
  [35, "Food sales and service", "Bar/Nightclub", "", 361, 378, 0.6, 1.1, 1.5],
  [
    36,
    "Food sales and service",
    "Convenience Store with Gas Station",
    "",
    260,
    269,
    0.5,
    0.9,
    1.3,
  ],
  [
    37,
    "Food sales and service",
    "Convenience Store without Gas Station",
    "",
    244,
    253,
    0.5,
    0.9,
    1.3,
  ],
  [
    38,
    "Food sales and service",
    "Fast Food Restaurant",
    "",
    427,
    454,
    0.6,
    1.1,
    1.5,
  ],
  [
    39,
    "Food sales and service",
    "Food Sales",
    "Grocery/food market",
    191,
    198,
    0.5,
    0.9,
    1.3,
  ],
  [
    40,
    "Food sales and service",
    "Food Sales",
    "Convenience store with gas",
    260,
    269,
    0.5,
    0.9,
    1.3,
  ],
  [
    41,
    "Food sales and service",
    "Food Sales",
    "Convenience store",
    244,
    253,
    0.5,
    0.9,
    1.3,
  ],
  [
    42,
    "Food sales and service",
    "Food Sales",
    "Other food sales",
    184,
    189,
    0.5,
    0.9,
    1.3,
  ],
  [
    43,
    "Food sales and service",
    "Food Service",
    "Fast food",
    427,
    454,
    0.6,
    1.1,
    1.5,
  ],
  [
    44,
    "Food sales and service",
    "Food Service",
    "Restaurant/cafeteria",
    361,
    378,
    0.6,
    1.1,
    1.5,
  ],
  [
    45,
    "Food sales and service",
    "Food Service",
    "Other food service",
    293,
    308,
    0.6,
    1.1,
    1.5,
  ],
  [46, "Food sales and service", "Restaurant", "", 361, 378, 0.6, 1.1, 1.5],
  [
    47,
    "Food sales and service",
    "Supermarket/Grocery Store",
    "",
    191,
    198,
    0.5,
    0.9,
    1.3,
  ],
  [
    48,
    "Food sales and service",
    "Wholesale Club/Supercenter",
    "",
    68,
    75,
    0.6,
    1.0,
    1.5,
  ],
  [
    49,
    "Food sales and service",
    "Other - Restaurant/Bar",
    "",
    361,
    378,
    0.6,
    1.1,
    1.5,
  ],
  [50, "Healthcare", "Ambulatory Surgical Center", "", 90, 96, 0.8, 1.1, 1.3],
  [
    51,
    "Healthcare",
    "Hospital (General Medical & Surgical)",
    "",
    215,
    215,
    1.0,
    1.0,
    1.0,
  ],
  [52, "Healthcare", "Medical Office", "", null, null, null, null, null],
  [
    53,
    "Healthcare",
    "Outpatient Rehabilitation/Physical Therapy",
    "",
    90,
    96,
    0.8,
    1.1,
    1.3,
  ],
  [54, "Healthcare", "Residential Care Facility", "", 78, 82, 1.0, 1.0, 1.0],
  [55, "Healthcare", "Senior Care Community", "", 78, 82, 1.0, 1.0, 1.0],
  [
    56,
    "Healthcare",
    "Urgent Care/Clinic/Other Outpatient",
    "",
    90,
    96,
    0.8,
    1.1,
    1.3,
  ],
  [57, "Healthcare", "Other - Specialty Hospital", "", 196, 196, 1.0, 1.0, 1.0],
  [58, "Lodging/residential", "Barracks", "", 88, 90, 1.0, 1.0, 1.0],
  [59, "Lodging/residential", "Hotel", "Hotel", 68, 72, 1.0, 1.0, 1.0],
  [60, "Lodging/residential", "Hotel", "Motel or inn", 74, 77, 1.0, 1.0, 1.0],
  [61, "Lodging/residential", "Multifamily Housing", "", 32, 33, 1.0, 1.0, 1.0],
  [
    62,
    "Lodging/residential",
    "Prison/Incarceration",
    "",
    101,
    106,
    1.0,
    1.0,
    1.0,
  ],
  [
    63,
    "Lodging/residential",
    "Residence Hall/Dormitory",
    "",
    88,
    90,
    1.0,
    1.0,
    1.0,
  ],
  [
    64,
    "Lodging/residential",
    "Residential Care Facility",
    "",
    78,
    82,
    1.0,
    1.0,
    1.0,
  ],
  [
    65,
    "Lodging/residential",
    "Senior Care Community",
    "",
    78,
    82,
    1.0,
    1.0,
    1.0,
  ],
  [
    66,
    "Lodging/residential",
    "Other - Lodging/Residential",
    "",
    71,
    74,
    1.0,
    1.0,
    1.0,
  ],
  [67, "Mixed use", "Mixed Use Property", "", null, null, null, null, null],
  [68, "Office", "Medical Office", "", 60, 65, 0.8, 1.1, 1.3],
  [69, "Office", "Office", "Admin/professional office", 63, 66, 0.8, 1.0, 1.5],
  [70, "Office", "Office", "Bank/other financial", 69, 71, 0.8, 1.0, 1.5],
  [71, "Office", "Office", "Government office", 66, 69, 0.8, 1.0, 1.5],
  [
    72,
    "Office",
    "Office",
    "Medical office (diagnostic)",
    60,
    65,
    0.8,
    1.1,
    1.3,
  ],
  [73, "Office", "Office", "Other office", 66, 68, 0.8, 1.0, 1.5],
  [74, "Office", "Veterinary Office", "", 90, 96, 0.8, 1.1, 1.3],
  [75, "Office", "Other - Office", "", 66, 68, 0.8, 1.0, 1.5],
  [76, "Public services", "Courthouse", "", 101, 106, 0.8, 0.8, 1.1],
  [77, "Public services", "Fire Station", "", 65, 68, 0.8, 0.8, 1.1],
  [78, "Public services", "Library", "", 56, 59, 0.6, 1.1, 1.6],
  [
    79,
    "Public services",
    "Mailing Center/Post Office",
    "",
    51,
    54,
    0.8,
    1.2,
    1.3,
  ],
  [80, "Public services", "Police Station", "", 65, 68, 0.8, 0.8, 1.1],
  [81, "Public services", "Prison/Incarceration", "", 101, 106, 1.0, 1.0, 1.0],
  [82, "Public services", "Social/Meeting Hall", "", 50, 52, 0.6, 1.1, 1.6],
  [
    83,
    "Public services",
    "Transportation Terminal/Station",
    "",
    55,
    59,
    0.6,
    1.1,
    1.6,
  ],
  [84, "Public services", "Other - Public Service", "", 66, 69, 0.8, 1.2, 1.3],
  [85, "Religious worship", "Worship Facility", "", 39, 42, 0.9, 1.7, 1.7],
  [86, "Retail", "Automobile Dealership", "", 59, 66, 0.6, 1.0, 1.5],
  [
    87,
    "Retail",
    "Convenience Store with Gas Station",
    "",
    260,
    269,
    0.5,
    0.9,
    1.3,
  ],
  [
    88,
    "Retail",
    "Convenience Store without Gas Station",
    "",
    244,
    253,
    0.5,
    0.9,
    1.3,
  ],
  [89, "Retail", "Enclosed Mall", "", 58, 64, 0.6, 1.0, 1.5],
  [90, "Retail", "Lifestyle Center", "Enclosed mall", 58, 64, 0.6, 1.0, 1.5],
  [91, "Retail", "Lifestyle Center", "Other retail", 55, 62, 0.6, 1.0, 1.5],
  [92, "Retail", "Lifestyle Center", "Retail store", 68, 75, 0.6, 1.0, 1.5],
  [93, "Retail", "Lifestyle Center", "", null, null, null, null, null],
  [94, "Retail", "Retail Store", "", 68, 75, 0.6, 1.0, 1.5],
  [95, "Retail", "Strip Mall", "", null, null, null, null, null],
  [96, "Retail", "Supermarket/Grocery Store", "", 191, 198, 0.5, 0.9, 1.3],
  [97, "Retail", "Wholesale Club/Supercenter", "", 68, 75, 0.6, 1.0, 1.5],
  [98, "Retail", "Other - Retail/Mall", "Enclosed mall", 58, 64, 0.6, 1.0, 1.5],
  [99, "Retail", "Other - Retail/Mall", "", null, null, null, null, null],
  [100, "Technology/science", "Data Center", "", null, null, null, null, null],
  [101, "Technology/science", "Laboratory", "", 237, 249, 1.0, 1.0, 1.0],
  [
    102,
    "Technology/science",
    "Other - Technology/Science",
    "Other service",
    66,
    69,
    0.8,
    1.2,
    1.3,
  ],
  [
    103,
    "Services",
    "Personal Services (Health/Beauty, Dry Cleaning, etc.)",
    "",
    66,
    69,
    0.8,
    1.2,
    1.3,
  ],
  [
    104,
    "Services",
    "Repair Services (Vehicle, Shoe, Locksmith, etc.)",
    "Repair shop",
    36,
    39,
    0.8,
    1.2,
    1.3,
  ],
  [
    105,
    "Services",
    "Repair Services (Vehicle, Shoe, Locksmith, etc.)",
    "Vehicle service/repair shop",
    60,
    64,
    0.8,
    1.2,
    1.3,
  ],
  [
    106,
    "Services",
    "Repair Services (Vehicle, Shoe, Locksmith, etc.)",
    "Vehicle storage/maintenance",
    41,
    44,
    0.8,
    1.2,
    1.3,
  ],
  [107, "Services", "Other - Services", "", 66, 69, 0.8, 1.2, 1.3],
  [108, "Utility", "Energy/Power Station", "", null, null, null, null, null],
  [109, "Utility", "Other - Utility", "", null, null, null, null, null],
  [
    110,
    "Warehouse/storage",
    "Self-Storage Facility",
    "",
    36,
    44,
    0.8,
    1.0,
    1.4,
  ],
  [111, "Warehouse/storage", "Distribution Center", "", 36, 44, 0.8, 1.0, 1.4],
  [
    112,
    "Warehouse/storage",
    "Nonrefrigerated Warehouse",
    "",
    36,
    44,
    0.8,
    1.0,
    1.4,
  ],
  [
    113,
    "Warehouse/storage",
    "Refrigerated Warehouse",
    "",
    121,
    126,
    1.0,
    1.0,
    1.4,
  ],
];

/** Table 7-1/7-2a notes that explain why an activity has no energy target. */
const NO_TARGET_NOTE: Record<number, string> = {
  52: "note 3: all medical offices are the diagnostic type; use activity 68 or 72",
  67: "note 4: mixed-use buildings must use the Section 7.2.3 method; enter each activity as its own space",
  93: "note 4: mixed-use buildings must use the Section 7.2.3 method; enter each activity as its own space",
  95: "note 4: mixed-use buildings must use the Section 7.2.3 method; enter each activity as its own space",
  99: "note 4: mixed-use buildings must use the Section 7.2.3 method; enter each activity as its own space",
  100: "note 6: a building activity without an energy target, included to provide a definition only",
  108: "note 7: a building activity without an energy target that may be exempt, see Section Z4.1(2)(d)",
  109: "note 7: a building activity without an energy target that may be exempt, see Section Z4.1(2)(d)",
};

const CHAPTER =
  "https://lawfilesext.leg.wa.gov/law/WACPDF/WAC%20194%20%20TITLE/WAC%20194%20-%2050%20%20CHAPTER/WAC%20194%20-%2050%20%20COMBINEDCHAPTER.pdf";
const ANNEX_Z =
  "https://lawfilesext.leg.wa.gov/law/WAC/WAC%20194%20%20TITLE/WAC%20194%20-%2050%20%20CHAPTER/WAC%20194%20-%2050%20-150.htm";
const RETRIEVED = "2026-11-03";

export const WA_CBPS_EUI_TARGET: DraftRuleMeta = {
  id: "rules.wa.cbps_eui_target",
  version: 1,
  jurisdiction: "us-wa",
  title:
    "Washington Clean Buildings Performance Standard energy use intensity target",
  citations: [
    {
      law: "WAC 194-50-030 (definitions)",
      url: CHAPTER,
      retrieved: RETRIEVED,
      covers:
        "Tier 1 and Tier 2 covered buildings; more recently built buildings (permit application on or after 2016-07-01)",
    },
    {
      law: "WAC 194-50-040 §4.3.2",
      url: CHAPTER,
      retrieved: RETRIEVED,
      covers:
        "a Tier 1 building complies when its weather-normalized EUI is less than or equal to its EUIt",
    },
    {
      law: "WAC 194-50-070 §§7.2.1.2, 7.2.2, 7.2.3",
      url: CHAPTER,
      retrieved: RETRIEVED,
      covers:
        "EUIt = Σ (A × S × EUIt1) over activities; 15% reduction for more recently built floor area",
    },
    {
      law: "WAC 194-50-150 Section Z7, Tables 7-2a and 7-3",
      url: ANNEX_Z,
      retrieved: RETRIEVED,
      covers:
        "EUIt1 by building activity and climate zone; operating shifts normalization factors",
    },
    {
      law: "WAC 194-50-150 Section Z6.2 (Form B instructions 2 and 5–9)",
      url: ANNEX_Z,
      retrieved: RETRIEVED,
      covers:
        "climate zone 5C uses 4C and 6B uses 5B; fraction of floor area and weighted target per activity",
    },
    {
      law: "WAC 194-50-150 Section Z3.2",
      url: ANNEX_Z,
      retrieved: RETRIEVED,
      covers: "Tier 1 initial compliance dates by gross floor area",
    },
    {
      law: "WAC 194-50-160 Section Y3.2",
      url: CHAPTER,
      retrieved: RETRIEVED,
      covers: "Tier 2 initial compliance date",
    },
  ],
  verification: {
    status: "draft",
    notes:
      "Drafted from chapter 194-50 WAC as certified on 2026-08-12 (last update 2026-07-21, WSR 26-15-112, effective 2026-08-21), retrieved from lawfilesext.leg.wa.gov on 2026-11-03. RCW 19.27A.200 and .210 were not read: app.leg.wa.gov disallows automated access in robots.txt. Not checked by a named maintainer.",
  },
  not_covered: [
    "the exceptions to Section 7.2.3 (single-use majority, similar activities, nontarget spaces, nontarget buildings)",
    "vacant and partially vacant buildings (Section 7.2.4), campus-level and grouped-building targets (Normative Annex W)",
    "alternative weekly hours allowed by Table 7-3 notes 7 and 9, and the ENERGY STAR median fallback in Section 7.2.1.1",
    "conditional compliance, investment criteria, exemptions and extensions",
    "administrative penalties (Section Z5.4) and the RCW 19.27A text",
  ],
};

export const WaCbpsInput = z.strictObject({
  climate_zone: z
    .enum(["4C", "5B", "5C", "6B"])
    .describe(
      "ASHRAE climate zone of the building (Informative Annex G). 5C is treated as 4C and 6B as 5B (Form B instruction 2).",
    ),
  spaces: z
    .array(
      z.strictObject({
        activity: z
          .number()
          .int()
          .min(1)
          .max(113)
          .describe("Building activity type No. from Table 7-1 (1–113)."),
        floor_area_sf: z
          .number()
          .finite()
          .positive()
          .max(1e8)
          .describe("Gross floor area with this activity, in square feet."),
        weekly_operating_hours: z
          .number()
          .int()
          .min(0)
          .max(168)
          .describe(
            "Average weekly operating hours for this activity, as defined in the notes to Table 7-3.",
          ),
        more_recently_built: z
          .boolean()
          .default(false)
          .describe(
            "True for floor area in buildings or additions permitted on an application dated 2016-07-01 or later.",
          ),
      }),
    )
    .min(1)
    .max(100),
  weather_normalized_eui: z
    .number()
    .finite()
    .nonnegative()
    .max(1e4)
    .optional()
    .describe(
      "Measured weather-normalized site EUI, kBtu/sf/yr, to compare with the target.",
    ),
  coverage: z
    .strictObject({
      nonresidential_hotel_motel_dormitory_sf: z
        .number()
        .finite()
        .nonnegative()
        .max(1e8),
      multifamily_residential_sf: z.number().finite().nonnegative().max(1e8),
      gross_floor_area_sf: z.number().finite().positive().max(1e8),
    })
    .optional()
    .describe(
      "Floor areas excluding the parking garage, for the tier and compliance date.",
    ),
});
export type WaCbpsInput = z.input<typeof WaCbpsInput>;

export interface WaCbpsResult {
  climate_zone_used: "4C" | "5B";
  floor_area_sf: number;
  spaces: {
    activity: number;
    activity_name: string;
    floor_area_sf: number;
    area_fraction: number;
    weekly_operating_hours: number;
    shift_factor: number;
    eui_target_1: number;
    more_recently_built: boolean;
    weighted_target: number;
  }[];
  /** EUIt before the 15% reduction for more recently built floor area (Section 7.2.1.1). */
  eui_target_before_recent_reduction: number;
  /** EUIt, kBtu/sf/yr (Section 7.2.1.2 applied). */
  eui_target: number;
  weather_normalized_eui: number | null;
  meets_target: boolean | null;
  tier: "tier1" | "tier2" | "not_covered" | "undetermined" | null;
  initial_compliance_date: string | null;
}

function activityName(row: (typeof WA_CBPS_ACTIVITIES)[number]): string {
  return [row[1], row[2], row[3]].filter(Boolean).join(" — ");
}

export function waCbpsEuiTarget(
  raw: WaCbpsInput,
): CalcResult<DraftValue<WaCbpsResult>> {
  const input = parseInput(WaCbpsInput, raw);
  const t = new Trace();
  const zone: "4C" | "5B" =
    input.climate_zone === "4C" || input.climate_zone === "5C" ? "4C" : "5B";
  t.step(
    "Climate zone used",
    zone,
    `${input.climate_zone} per Form B instruction 2`,
  );

  const rows = input.spaces.map((s, i) => {
    const row = WA_CBPS_ACTIVITIES[s.activity - 1];
    if (!row || row[0] !== s.activity)
      throw new CalcInputError(`unknown activity ${s.activity}`);
    if (
      row[4] === null ||
      row[5] === null ||
      row[6] === null ||
      row[7] === null ||
      row[8] === null
    )
      throw new CalcInputError(
        `spaces.${i}.activity: activity ${s.activity} (${activityName(row)}) has no energy target in Table 7-2a (${NO_TARGET_NOTE[s.activity] ?? "see the table notes"})`,
        [{ path: `spaces.${i}.activity`, message: "no energy target" }],
      );
    return { s, row, e1: zone === "4C" ? row[4] : row[5] };
  });

  let total = 0;
  for (const { s } of rows) total += s.floor_area_sf;
  t.step("Floor area with a target", total, "Σ floor area", "sf");

  let base = 0;
  let target = 0;
  const spaces = rows.map(({ s, row, e1 }) => {
    const h = s.weekly_operating_hours;
    const shift = (h <= 50 ? row[6] : h <= 167 ? row[7] : row[8]) as number;
    const a = s.floor_area_sf / total;
    const w = a * shift * e1;
    const wr = s.more_recently_built ? w * 0.85 : w;
    base += w;
    target += wr;
    return {
      activity: s.activity,
      activity_name: activityName(row),
      floor_area_sf: s.floor_area_sf,
      area_fraction: round(a, 6),
      weekly_operating_hours: h,
      shift_factor: shift,
      eui_target_1: e1,
      more_recently_built: s.more_recently_built,
      weighted_target: round(wr, 4),
    };
  });
  const baseR = round(base, 2);
  const targetR = round(target, 2);
  t.step(
    "EUIt before the recent-construction reduction",
    baseR,
    spaces
      .map((s) => `${s.area_fraction} × ${s.shift_factor} × ${s.eui_target_1}`)
      .join(" + "),
    "kBtu/sf/yr",
  );
  t.step(
    "EUIt",
    targetR,
    spaces.some((s) => s.more_recently_built)
      ? "more recently built floor area reduced by 15% (Section 7.2.1.2)"
      : "no more recently built floor area",
    "kBtu/sf/yr",
  );

  let meets: boolean | null = null;
  const wneui = input.weather_normalized_eui ?? null;
  if (wneui !== null) {
    meets = reduceNoise(wneui) <= reduceNoise(target);
    t.step(
      "Meets the EUIt",
      meets ? "yes" : "no",
      `WNEUI ${wneui} ${meets ? "≤" : ">"} EUIt (Section 4.3.2)`,
    );
    if (!meets && reduceNoise(wneui) <= reduceNoise(base))
      t.warn(
        "The building misses the reduced target but meets the target before the 15% reduction: Exception 1 to Section 4.3.2.1 allows compliance by recommissioning.",
      );
  }

  let tier: WaCbpsResult["tier"] = null;
  let date: string | null = null;
  if (input.coverage) {
    const c = input.coverage;
    const nonres = c.nonresidential_hotel_motel_dormitory_sf;
    const sum = nonres + c.multifamily_residential_sf;
    if (nonres > 50000) tier = "tier1";
    else if (sum > 20000 && sum <= 50000) tier = "tier2";
    else if (nonres === 0 && c.multifamily_residential_sf >= 50000)
      tier = "tier2";
    else if (sum <= 20000) tier = "not_covered";
    else tier = "undetermined";
    t.step("Covered building tier", tier, "Section 3 definitions");
    if (tier === "tier1") {
      const g = c.gross_floor_area_sf;
      date =
        g > 220000
          ? "2026-06-01"
          : g > 90000
            ? "2027-06-01"
            : g > 50000
              ? "2028-06-01"
              : null;
      if (date === null)
        t.warn(
          "Tier 1 by use, but gross floor area is 50,000 sf or less: no Section Z3.2 cohort applies; check the areas.",
        );
    } else if (tier === "tier2") date = "2027-07-01";
    if (date)
      t.step(
        "Initial compliance date",
        date,
        tier === "tier1" ? "Section Z3.2" : "Section Y3.2",
      );
    if (tier === "undetermined")
      t.warn(
        "Over 50,000 sf in total with 50,000 sf or less of nonresidential, hotel, motel and dormitory area: the WAC definitions do not settle the tier for this mix.",
      );
    if (date)
      t.warn("Reports are due on this date and every five years thereafter.");
  }
  if (tier === "tier2" || tier === null)
    t.warn(
      "Section 4.3.2 (meeting the EUIt) is the Tier 1 compliance test; Tier 2 buildings report an EUIt but comply through Annex Y.",
    );
  t.warn(
    "Rounding: the EUIt is reported to 0.01 kBtu/sf/yr; the comparison with the WNEUI uses the unrounded target. The WAC does not specify rounding.",
  );

  return draftResult(t, WA_CBPS_EUI_TARGET, {
    climate_zone_used: zone,
    floor_area_sf: total,
    spaces,
    eui_target_before_recent_reduction: baseR,
    eui_target: targetR,
    weather_normalized_eui: wneui,
    meets_target: meets,
    tier,
    initial_compliance_date: date,
  });
}
