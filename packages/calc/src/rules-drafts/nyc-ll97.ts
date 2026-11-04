/**
 * DRAFT: New York City Local Law 97 of 2019 (Admin. Code Article 320) building emissions limits.
 *
 * Given a covered building's floor area by Energy Star Portfolio Manager (ESPM) property type and
 * its annual energy use by source, computes the annual building emissions limit, the building's
 * emissions, any excess over the limit and the civil penalty for that excess, for calendar years
 * 2024–2034. The tables below come from 1 RCNY §103-14 as compiled by the Department of
 * Buildings (amendments through 2025-01-19). Not verified: see docs/rules/nyc-ll97.md.
 */
import { z } from "zod";

import { CalcInputError, Trace, parseInput, round } from "../core.ts";
import type { CalcResult } from "../core.ts";
import { draftResult } from "./draft.ts";
import type { DraftRuleMeta, DraftValue } from "./draft.ts";

// [ESPM property type, 2024–2029 factor, 2030–2034 factor] in tCO2e per square foot, 1 RCNY §103-14(c)(3)(i) and (iii).
export const NYC_LL97_EMISSIONS_FACTORS: readonly (readonly [
  string,
  number,
  number,
])[] = [
  ["Adult Education", 0.00758, 0.003565528],
  ["Ambulatory Surgical Center", 0.01181, 0.008980612],
  ["Automobile Dealership", 0.00675, 0.002824097],
  ["Bank Branch", 0.00987, 0.004036172],
  ["Bowling Alley", 0.00574, 0.003103815],
  ["College/University", 0.00987, 0.002099748],
  ["Convenience Store without Gas Station", 0.00675, 0.003540032],
  ["Courthouse", 0.00426, 0.001480533],
  ["Data Center", 0.02381, 0.014791131],
  ["Distribution Center", 0.00574, 0.0009916],
  ["Enclosed Mall", 0.01074, 0.003983803],
  ["Financial Office", 0.00846, 0.003697004],
  ["Fitness Center/Health Club/Gym", 0.00987, 0.003946728],
  ["Food Sales", 0.01181, 0.00520888],
  ["Food Service", 0.01181, 0.007749414],
  ["Hospital (General Medical & Surgical)", 0.02381, 0.007335204],
  ["Hotel", 0.00987, 0.003850668],
  ["K-12 School", 0.00675, 0.002230588],
  ["Laboratory", 0.02381, 0.026029868],
  ["Library", 0.00675, 0.002218412],
  ["Lifestyle Center", 0.00846, 0.00470585],
  ["Mailing Center/Post Office", 0.00426, 0.00198044],
  ["Manufacturing/Industrial Plant", 0.00758, 0.00141703],
  ["Medical Office", 0.01074, 0.002912778],
  ["Movie Theater", 0.01181, 0.005395268],
  ["Multifamily Housing", 0.00675, 0.00334664],
  ["Museum", 0.01181, 0.0053958],
  ["Non-Refrigerated Warehouse", 0.00426, 0.000883187],
  ["Office", 0.00758, 0.002690852],
  ["Other - Education", 0.00846, 0.002934006],
  ["Other - Entertainment/Public Assembly", 0.00987, 0.002956738],
  ["Other - Lodging/Residential", 0.00758, 0.001901982],
  ["Other - Mall", 0.01074, 0.001928226],
  ["Other - Public Services", 0.00758, 0.003808033],
  ["Other - Recreation", 0.00987, 0.00447957],
  ["Other - Restaurant/Bar", 0.02381, 0.008505075],
  ["Other - Services", 0.01074, 0.001823381],
  ["Other - Specialty Hospital", 0.02381, 0.006321819],
  ["Other - Technology/Science", 0.02381, 0.010446456],
  ["Outpatient Rehabilitation/Physical Therapy", 0.01181, 0.006018323],
  ["Parking", 0.00426, 0.000214421],
  ["Performing Arts", 0.00846, 0.002472539],
  [
    "Personal Services (Health/Beauty, Dry Cleaning, etc.)",
    0.00574,
    0.004843037,
  ],
  ["Pre-school/Daycare", 0.00675, 0.002362874],
  ["Refrigerated Warehouse", 0.00987, 0.002852131],
  ["Repair Services (Vehicle, Shoe, Locksmith, etc.)", 0.00426, 0.002210699],
  ["Residence Hall/Dormitory", 0.00758, 0.002464089],
  ["Residential Care Facility", 0.01138, 0.004893124],
  ["Restaurant", 0.01181, 0.004038374],
  ["Retail Store", 0.00758, 0.00210449],
  ["Self-Storage Facility", 0.00426, 0.00061183],
  ["Senior Care Community", 0.01138, 0.004410123],
  ["Social/Meeting Hall", 0.00987, 0.003833108],
  ["Strip Mall", 0.01181, 0.001361842],
  ["Supermarket/Grocery Store", 0.02381, 0.00675519],
  ["Transportation Terminal/Station", 0.00426, 0.000571669],
  ["Urgent Care/Clinic/Other Outpatient", 0.01181, 0.005772375],
  ["Vocational School", 0.00574, 0.004613122],
  ["Wholesale Club/Supercenter", 0.01138, 0.004264962],
  ["Worship Facility", 0.00574, 0.001230602],
];
// [fuel id, label in the rule, tCO2e per kBtu], 1 RCNY §103-14(d)(3)(i)(a), calendar years 2024–2034.
export const NYC_LL97_OTHER_FUELS: readonly (readonly [
  string,
  string,
  number,
])[] = [
  ["butane", "Butane", 0.00006502],
  ["butylene", "Butylene", 0.00006897],
  ["diesel", "Diesel", 0.00007421],
  ["distillate_fuel_oil_no_1", "Distillate Fuel Oil No. 1", 0.0000735],
  ["ethane", "Ethane", 0.00005985],
  ["ethylene", "Ethylene", 0.00006621],
  ["gasoline", "Gasoline", 0.00007047],
  ["isobutane", "Isobutane", 0.00006519],
  ["isobutylene", "Isobutylene", 0.00006911],
  ["kerosene", "Kerosene", 0.00007769],
  ["naphtha_below_401f", "Naphtha (< 401 deg F)", 0.00006827],
  ["other_oil_above_401f", "Other Oil (> 401 deg F)", 0.00007647],
  ["pentanes_plus", "Pentanes Plus", 0.00007027],
  ["propane", "Propane", 0.00006425],
  ["propylene", "Propylene", 0.00006802],
  ["special_naphtha", "Special Naphtha", 0.00007259],
  ["coke_oven_gas", "Coke Oven Gas", 0.00004689],
  ["fuel_gas", "Fuel Gas", 0.00005925],
  ["biofuel", "Biofuel", 0.00007389],
];

const LL97 = "https://www.nyc.gov/assets/buildings/local_laws/ll97of2019.pdf";
const LL147 = "https://www.nyc.gov/assets/buildings/local_laws/ll147of2019.pdf";
const RCNY = "https://www.nyc.gov/assets/buildings/rules/1_RCNY_103-14.pdf";
const RETRIEVED = "2026-11-03";

export const NYC_LL97_BUILDING_EMISSIONS: DraftRuleMeta = {
  id: "rules.nyc.ll97_building_emissions",
  version: 1,
  jurisdiction: "us-ny-nyc",
  title: "NYC Local Law 97 building emissions limit, emissions and penalty",
  citations: [
    {
      law: "NYC Admin. Code §28-320.1 (definition of covered building)",
      url: LL97,
      retrieved: RETRIEVED,
      covers: "the 25,000 gross square foot size test",
    },
    {
      law: "NYC Admin. Code §28-320.3.1.1 (as amended by L.L. 147 of 2019)",
      url: LL147,
      retrieved: RETRIEVED,
      covers:
        "2024–2029 coefficients: utility electricity, natural gas, #2 and #4 fuel oil, district steam",
    },
    {
      law: "NYC Admin. Code §28-320.6",
      url: LL97,
      retrieved: RETRIEVED,
      covers: "penalty of $268 per tCO2e over the limit",
    },
    {
      law: "1 RCNY §103-14(c)(3)(i), (iii)",
      url: RCNY,
      retrieved: RETRIEVED,
      covers:
        "emissions factors by ESPM property type for 2024–2029 and 2030–2034",
    },
    {
      law: "1 RCNY §103-14(d)(2), (d)(4)(i)",
      url: RCNY,
      retrieved: RETRIEVED,
      covers:
        "limit = Σ factor × floor area (Equation 103-14.1); emissions = Σ energy × coefficient (Equation 103-14.13)",
    },
    {
      law: "1 RCNY §103-14(d)(3)(i)–(ii)",
      url: RCNY,
      retrieved: RETRIEVED,
      covers:
        "coefficients for other fuels (2024–2034) and for utility electricity, natural gas, district steam and #2/#4 oil (2030–2034)",
    },
    {
      law: "1 RCNY §103-14(h)",
      url: RCNY,
      retrieved: RETRIEVED,
      covers: "penalty = (actual emissions − limit) × $268",
    },
  ],
  verification: {
    status: "draft",
    notes:
      "Drafted from Local Laws 97 and 147 of 2019 (nyc.gov) and the DOB compilation of 1 RCNY §103-14 (effective through the amendment of 2025-01-19), retrieved 2026-11-03. The codified Admin. Code text was not read: confirm no later local law changed §28-320.3 or §28-320.6. Not checked by a named maintainer.",
  },
  not_covered: [
    "the occupancy-group election for 2024 and 2025 in 1 RCNY §103-14(c)(3)(ii)",
    "time-of-use electricity coefficients, campus-style systems, distributed energy resources, fuel cells and beneficial electrification (§103-14(d)(3)(iii)–(vii), (d)(4)(iii))",
    "deductions for renewable energy credits, clean distributed energy, offsets and EV charging (§103-14(d)(4)(ii), (e))",
    "covered-building exceptions, multi-building tax lots and condominiums (§28-320.1), and Article 321 buildings",
    "adjustments under §28-320.7 to §28-320.9, penalty mitigation under §103-14(i), and the late-report penalty in §103-14(g)",
    "calendar years after 2034",
  ],
};

const PROPERTY_TYPES = NYC_LL97_EMISSIONS_FACTORS.map(([name]) => name) as [
  string,
  ...string[],
];
const FUEL_IDS = NYC_LL97_OTHER_FUELS.map(([id]) => id) as [
  string,
  ...string[],
];
const Quantity = z.number().finite().nonnegative().max(1e13);

export const NycLl97Input = z.strictObject({
  calendar_year: z
    .number()
    .int()
    .min(2024)
    .max(2034)
    .describe("Calendar year being reported, 2024–2034."),
  spaces: z
    .array(
      z.strictObject({
        property_type: z
          .enum(PROPERTY_TYPES)
          .describe(
            "Energy Star Portfolio Manager property type, exactly as named in 1 RCNY §103-14(c)(3).",
          ),
        floor_area_sf: z
          .number()
          .finite()
          .positive()
          .max(1e8)
          .describe("Floor area of this property type, in square feet."),
      }),
    )
    .min(1)
    .max(100)
    .describe(
      "Floor area by property type; the areas must add up to the building's gross floor area (§103-14(d)(1)).",
    ),
  energy: z
    .strictObject({
      utility_electricity_kwh: Quantity.optional(),
      natural_gas_kbtu: Quantity.optional(),
      fuel_oil_2_kbtu: Quantity.optional(),
      fuel_oil_4_kbtu: Quantity.optional(),
      district_steam_kbtu: Quantity.optional(),
      other_fuels: z
        .array(
          z.strictObject({
            fuel: z.enum(FUEL_IDS),
            kbtu: Quantity,
          }),
        )
        .max(40)
        .optional(),
    })
    .describe(
      "Annual energy consumed on the premises: grid electricity in kWh, everything else in kBtu.",
    ),
});
export type NycLl97Input = z.input<typeof NycLl97Input>;

export interface NycLl97Result {
  calendar_year: number;
  compliance_period: "2024-2029" | "2030-2034";
  gross_floor_area_sf: number;
  /** Over 25,000 gross square feet: the single-building size test in §28-320.1 only. */
  exceeds_25000_gsf: boolean;
  limit_by_space: {
    property_type: string;
    floor_area_sf: number;
    emissions_factor_tco2e_per_sf: number;
    limit_tco2e: number;
  }[];
  emissions_limit_tco2e: number;
  emissions_by_source: {
    source: string;
    quantity: number;
    unit: "kWh" | "kBtu";
    coefficient_tco2e_per_unit: number;
    emissions_tco2e: number;
  }[];
  building_emissions_tco2e: number;
  excess_emissions_tco2e: number;
  within_limit: boolean;
  penalty_usd: number;
}

const PENALTY_PER_TCO2E = 268;

function coefficients(period: NycLl97Result["compliance_period"]) {
  return period === "2024-2029"
    ? {
        utility_electricity_kwh: 0.000288962,
        natural_gas_kbtu: 0.00005311,
        fuel_oil_2_kbtu: 0.00007421,
        fuel_oil_4_kbtu: 0.00007529,
        district_steam_kbtu: 0.00004493,
      }
    : {
        utility_electricity_kwh: 0.000145,
        natural_gas_kbtu: 0.00005311,
        fuel_oil_2_kbtu: 0.00007421,
        fuel_oil_4_kbtu: 0.00007529,
        district_steam_kbtu: 0.0000432,
      };
}

export function nycLl97BuildingEmissions(
  raw: NycLl97Input,
): CalcResult<DraftValue<NycLl97Result>> {
  const input = parseInput(NycLl97Input, raw);
  const t = new Trace();
  const period: NycLl97Result["compliance_period"] =
    input.calendar_year <= 2029 ? "2024-2029" : "2030-2034";
  t.step("Compliance period", period, "§28-320.3.1 / §28-320.3.2");

  // Limit: Equation 103-14.1, B = Σ l_k × s_k.
  let limit = 0;
  let gfa = 0;
  const limitBySpace = input.spaces.map((s) => {
    const row = NYC_LL97_EMISSIONS_FACTORS.find(
      ([name]) => name === s.property_type,
    );
    if (!row)
      throw new CalcInputError(`unknown property type ${s.property_type}`);
    const factor = period === "2024-2029" ? row[1] : row[2];
    const part = factor * s.floor_area_sf;
    limit += part;
    gfa += s.floor_area_sf;
    return {
      property_type: s.property_type,
      floor_area_sf: s.floor_area_sf,
      emissions_factor_tco2e_per_sf: factor,
      limit_tco2e: round(part, 4),
    };
  });
  const limitR = round(limit, 4);
  t.step(
    "Annual building emissions limit",
    limitR,
    limitBySpace
      .map((s) => `${s.emissions_factor_tco2e_per_sf} × ${s.floor_area_sf} sf`)
      .join(" + "),
    "tCO2e",
  );

  // Emissions: Equation 103-14.13, X = Σ m_n × g_n.
  const coef = coefficients(period);
  const sources: NycLl97Result["emissions_by_source"] = [];
  let emissions = 0;
  const add = (
    source: string,
    quantity: number | undefined,
    unit: "kWh" | "kBtu",
    g: number,
  ) => {
    if (quantity === undefined) return;
    const e = quantity * g;
    emissions += e;
    sources.push({
      source,
      quantity,
      unit,
      coefficient_tco2e_per_unit: g,
      emissions_tco2e: round(e, 4),
    });
  };
  add(
    "utility_electricity",
    input.energy.utility_electricity_kwh,
    "kWh",
    coef.utility_electricity_kwh,
  );
  add(
    "natural_gas",
    input.energy.natural_gas_kbtu,
    "kBtu",
    coef.natural_gas_kbtu,
  );
  add("fuel_oil_2", input.energy.fuel_oil_2_kbtu, "kBtu", coef.fuel_oil_2_kbtu);
  add("fuel_oil_4", input.energy.fuel_oil_4_kbtu, "kBtu", coef.fuel_oil_4_kbtu);
  add(
    "district_steam",
    input.energy.district_steam_kbtu,
    "kBtu",
    coef.district_steam_kbtu,
  );
  for (const f of input.energy.other_fuels ?? []) {
    const row = NYC_LL97_OTHER_FUELS.find(([id]) => id === f.fuel);
    if (!row) throw new CalcInputError(`unknown fuel ${f.fuel}`);
    add(f.fuel, f.kbtu, "kBtu", row[2]);
  }
  const emissionsR = round(emissions, 4);
  t.step(
    "Annual building emissions",
    emissionsR,
    sources.length
      ? sources
          .map(
            (s) => `${s.quantity} ${s.unit} × ${s.coefficient_tco2e_per_unit}`,
          )
          .join(" + ")
      : "no energy reported",
    "tCO2e",
  );
  if (!sources.length)
    t.warn(
      "No energy use was given, so emissions are zero; all energy consumed on the premises must be included (§103-14(d)(4)(ii)).",
    );

  const excess = Math.max(0, round(emissionsR - limitR, 4));
  t.step(
    "Excess over the limit",
    excess,
    `max(0, ${emissionsR} − ${limitR})`,
    "tCO2e",
  );
  const penalty = round(excess * PENALTY_PER_TCO2E, 2);
  t.step("Penalty", penalty, `${excess} tCO2e × $268`, "USD");
  if (penalty > 0)
    t.warn(
      '§28-320.6 caps the penalty at this amount ("not more than"); 1 RCNY §103-14(h) sets it at this amount, subject to mitigation under §103-14(i) and the factors in §28-320.6.1. Deductions and adjustments are not modelled.',
    );
  if (gfa <= 25000)
    t.warn(
      "Floor area is 25,000 sf or less: a single building this size is not a covered building, but two or more buildings on one tax lot, or condominium buildings under one board, over 50,000 sf together are (§28-320.1).",
    );
  if (input.calendar_year <= 2025)
    t.warn(
      "For 2024 and 2025 an owner may instead use the occupancy-group limits in §28-320.3.1 where they are higher (1 RCNY §103-14(c)(3)(ii)); this pack uses the property-type factors only.",
    );
  t.warn(
    "Rounding: components and totals are rounded to 0.0001 tCO2e and the penalty to the cent; the law does not specify rounding.",
  );

  return draftResult(t, NYC_LL97_BUILDING_EMISSIONS, {
    calendar_year: input.calendar_year,
    compliance_period: period,
    gross_floor_area_sf: gfa,
    exceeds_25000_gsf: gfa > 25000,
    limit_by_space: limitBySpace,
    emissions_limit_tco2e: limitR,
    emissions_by_source: sources,
    building_emissions_tco2e: emissionsR,
    excess_emissions_tco2e: excess,
    within_limit: emissionsR <= limitR,
    penalty_usd: penalty,
  });
}
