/**
 * tx_unequal_appraisal context from registry_tx_equity_candidates: the roll fields of the subject and
 * candidates, and the selection rule as applied, sent back by the caller as the tool returned them. The
 * report prints them labelled as such, after checking each row's value and improvement area against the
 * calculation (tx.ts); value per SF is computed there, never taken from the caller. Codes and ids are checked as caller
 * text (text.ts); step names are the tool's own, so any other wording is refused here.
 */
import { TX_EQUITY_STEPS } from "@factlot/tools";
import { z } from "zod";

/** The characters of an appraisal-roll account number, class or use code (the Texas rolls use these). */
const CODE = /^[A-Za-z0-9 ._\-/#(),+=&]{1,64}$/;
const Code = z
  .string()
  .regex(
    CODE,
    "letters, digits, spaces and . _ - / # ( ) , + = & only, at most 64",
  )
  .nullable()
  .optional();
// Bounded, so the JSON schema is anyOf [number, null] rather than a type array (one type per schema).
const Num = z.number().min(0).max(1e12).nullable().optional();
const Int = z.number().int().min(0).max(1e12).nullable().optional();

/** One subject or candidate row of registry_tx_equity_candidates, as returned; other fields pass through unread. */
export const ContextCandidate = z.looseObject({
  id: z.string().min(1).max(200),
  apn: Code,
  state_property_category: Code,
  building_class: Code,
  local_use_code: Code,
  neighborhood_code: Code,
  improvement_area_sf: Num,
  land_area_sf: Num,
  year_built: Int,
  value: Num,
  value_basis: z.enum(["appraised", "market"]).nullable().optional(),
  tax_year: Int,
});
export type ContextCandidate = z.output<typeof ContextCandidate>;

const NARROWING = [
  "same_building_class",
  "same_local_use_code",
  "local_use_codes",
] as const;

/** registry_tx_equity_candidates' selection_rule, as returned; other fields pass through unread. */
export const ContextSelectionRule = z.looseObject({
  tax_year: Int,
  state_property_category: Code,
  area_band: z
    .looseObject({ share: Num, min_sf: Num, max_sf: Num })
    .nullable()
    .optional(),
  year_band: z
    .looseObject({ years: Int, min: Num, max: Num })
    .nullable()
    .optional(),
  min_matches: Int,
  limit: Int,
  narrowing: z
    .array(
      z.looseObject({
        parameter: z.enum(NARROWING),
        applied: z.boolean(),
        value: z
          .union([
            z.string().regex(CODE),
            z.array(z.string().regex(CODE)).max(50),
          ])
          .nullable()
          .optional(),
      }),
    )
    .max(NARROWING.length)
    .optional(),
  steps: z
    .array(
      z.looseObject({
        step: z.enum(Object.values(TX_EQUITY_STEPS) as [string, ...string[]]),
        left: z.number().int().min(0),
      }),
    )
    .max(Object.keys(TX_EQUITY_STEPS).length)
    .optional(),
  tiers: z
    .array(
      z.looseObject({
        tier: z.enum(["neighborhood", "zip", "county"]),
        key: Code,
        applied: z.boolean().optional(),
        matched: Int,
        returned: Int,
      }),
    )
    .max(3)
    .optional(),
  widened_to_county: z.boolean().optional(),
  matched: Int,
  returned: Int,
});
export type ContextSelectionRule = z.output<typeof ContextSelectionRule>;
