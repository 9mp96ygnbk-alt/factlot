/**
 * Draft rules packs, kept apart from the verified packs in `rulePacks`.
 *
 * `rulePacks` holds verified rules and is what tool servers expose. Packs here are drafts: no
 * named maintainer has checked them against the official text. They are not tools; callers reach
 * them only through `runDraftRule(name, input, { acknowledgeDraft: true })`, and every result
 * carries `status: "draft"` and DRAFT_WARNING as its first warning. To promote a pack, a
 * maintainer completes the checklist in its docs page and moves it into `rulePacks`
 * (docs/rules.md).
 */
import type { z } from "zod";

import { CalcInputError } from "../core.ts";
import type { CalcResult } from "../core.ts";
import {
  BOSTON_BERDO_EMISSIONS_STANDARD,
  BostonBerdoInput,
  bostonBerdoEmissionsStandard,
} from "./boston-berdo.ts";
import type { DraftRuleMeta } from "./draft.ts";
import {
  NYC_LL97_BUILDING_EMISSIONS,
  NycLl97Input,
  nycLl97BuildingEmissions,
} from "./nyc-ll97.ts";
import {
  TX_PROTEST_EVIDENCE_DATES,
  TxProtestEvidenceDatesInput,
  txProtestEvidenceDates,
} from "./tx-evidence-dates.ts";
import { WA_CBPS_EUI_TARGET, WaCbpsInput, waCbpsEuiTarget } from "./wa-cbps.ts";

export { DRAFT_WARNING } from "./draft.ts";
export type { DraftCitation, DraftRuleMeta } from "./draft.ts";
export {
  BOSTON_BERDO_EMISSIONS_STANDARD,
  BOSTON_BERDO_STANDARDS,
} from "./boston-berdo.ts";
export {
  NYC_LL97_BUILDING_EMISSIONS,
  NYC_LL97_EMISSIONS_FACTORS,
  NYC_LL97_OTHER_FUELS,
} from "./nyc-ll97.ts";
export { TX_PROTEST_EVIDENCE_DATES } from "./tx-evidence-dates.ts";
export { WA_CBPS_ACTIVITIES, WA_CBPS_EUI_TARGET } from "./wa-cbps.ts";

interface DraftPack {
  meta: DraftRuleMeta;
  description: string;
  input: z.ZodType;
  run: (input: never) => CalcResult<unknown>;
}

const packs = {
  nyc_ll97_building_emissions: {
    meta: NYC_LL97_BUILDING_EMISSIONS,
    description:
      "New York City Local Law 97: a covered building's annual emissions limit (floor area by ENERGY STAR Portfolio Manager property type × the 1 RCNY §103-14 factors), its emissions from energy use, the excess and the $268/tCO2e penalty, for 2024–2034.",
    input: NycLl97Input,
    run: nycLl97BuildingEmissions,
  },
  wa_cbps_eui_target: {
    meta: WA_CBPS_EUI_TARGET,
    description:
      "Washington Clean Buildings Performance Standard: a building's energy use intensity target from WAC 194-50 Tables 7-2a and 7-3, whether a weather-normalized EUI meets it, and the covered-building tier and initial compliance date.",
    input: WaCbpsInput,
    run: waCbpsEuiTarget,
  },
  boston_berdo_emissions_standard: {
    meta: BOSTON_BERDO_EMISSIONS_STANDARD,
    description:
      "Boston BERDO 2.0: the emissions standard for a building use and year from Table 1 of the ordinance, the building's limit, and the excess and Alternative Compliance Payment for given emissions.",
    input: BostonBerdoInput,
    run: bostonBerdoEmissionsStandard,
  },
  tx_protest_evidence_dates: {
    meta: TX_PROTEST_EVIDENCE_DATES,
    description:
      "Texas protest evidence dates for an appraisal review board hearing: the 14th day before the first day of the hearing for the owner's evidence (Tax Code §41.43(a-1), (a-3)(3)) with a conservative date rolled back past weekends and Texas legal holidays, and the 14-day date for the district's requested evidence (§41.461(a), §41.67(d)).",
    input: TxProtestEvidenceDatesInput,
    run: txProtestEvidenceDates,
  },
} satisfies Record<string, DraftPack>;

export type DraftRuleName = keyof typeof packs;

export type DraftRulePackInfo = DraftRuleMeta & {
  description: string;
  input: z.ZodType;
};

/** Draft packs: metadata, description and input schema. Not tools; call through runDraftRule. */
export const draftRulePacks = {} as Record<DraftRuleName, DraftRulePackInfo>;
for (const [name, p] of Object.entries(packs) as [DraftRuleName, DraftPack][])
  draftRulePacks[name] = {
    ...p.meta,
    description: p.description,
    input: p.input,
  };

/**
 * Run a draft rules pack. The caller must pass `{ acknowledgeDraft: true }`, stating that it
 * knows the rule has not been verified against the official text. Throws CalcInputError for an
 * unknown pack, a missing acknowledgement, or invalid input.
 */
export function runDraftRule(
  name: string,
  input: unknown,
  options: { acknowledgeDraft: boolean },
): CalcResult<unknown> {
  if (!Object.hasOwn(packs, name))
    throw new CalcInputError(`no draft rules pack named "${name}"`, [
      { path: "name", message: "unknown draft rules pack" },
    ]);
  if (options?.acknowledgeDraft !== true)
    throw new CalcInputError(
      `draft rules pack "${name}" has not been verified against the official text; pass { acknowledgeDraft: true } to run it`,
      [{ path: "acknowledgeDraft", message: "must be true" }],
    );
  return (
    packs[name as DraftRuleName].run as (i: unknown) => CalcResult<unknown>
  )(input);
}
