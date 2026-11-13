/**
 * MCP prompts: named, argument-taking recipes for the common jobs. Each one tells the model which
 * tools to call in which order, to cite every fact, when to call registry_coverage first, and
 * what a Pro or Team key adds on the hosted API (plan facts from RESOURCE_DATA.plans, generated
 * from deploy/cloudflare/src/plans.ts). A prompt uses no registry lookup and needs no key; the
 * calls it describes are made by the model afterwards, under the usual rules.
 */
import { TX_EQUITY_CALC_ARGS_NOTICE, TX_EQUITY_NOTICE } from "@factlot/tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { RESOURCE_DATA } from "./resource-data.ts";
import {
  HOSTED_MCP_URL,
  type ResourceContext,
  type ResourceData,
} from "./resources.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A C0 or C1 control character, or a Unicode line or paragraph separator. */
const isControl = (c: number) =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;

/** Whether `v` holds a control character; newline, carriage return and tab pass when `lines`. */
function hasControl(v: string, lines = false): boolean {
  for (const ch of v) {
    const c = ch.codePointAt(0)!;
    if (lines && (c === 0x0a || c === 0x0d || c === 0x09)) continue;
    if (isControl(c)) return true;
  }
  return false;
}

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !hasControl(v), "one line of text, no control characters");

/** A single-line argument (an address, parcel id, name or path). */
const text = (max: number, description: string) =>
  line(max).describe(description);
const optionalText = (max: number, description: string) =>
  line(max).optional().describe(description);
/** A multi-line argument: newlines and tabs allowed, other control characters not. */
const multiline = (max: number, description: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !hasControl(v, true),
      "text without control characters other than newlines and tabs",
    )
    .describe(description);

/** The calculator for each `calculation` of deal_math. */
export const DEAL_CALCULATORS = {
  net_effective_rent: "calc_net_effective_rent",
  compare_proposals: "calc_compare_proposals",
  rent_schedule: "calc_rent_schedule",
  debt_sizing: "calc_debt_sizing",
  amortization_schedule: "calc_amortization_schedule",
  npv: "calc_npv",
  irr: "calc_irr",
  dcf_pro_forma: "calc_dcf_pro_forma",
  direct_cap: "calc_direct_cap",
  equity_waterfall: "calc_equity_waterfall",
  lease_vs_own: "calc_lease_vs_own",
  renew_vs_relocate: "calc_renew_vs_relocate",
  prepayment_and_defeasance: "calc_prepayment_and_defeasance",
} as const;

export const PROMPT_ARGS = {
  property_owner: {
    property: text(
      300,
      "The property: a street address, a county parcel or account number, or a FactLot parcel URN (fl:parcel:...).",
    ),
    place: optionalText(
      120,
      "City, county or state, when the property is a parcel number or the address is ambiguous.",
    ),
  },
  owner_portfolio: {
    owner: text(
      200,
      "The owner: a company's registered name (an LLC, LP or corporation) or a FactLot entity URN (fl:entity:...).",
    ),
    jurisdiction: z
      .string()
      .regex(/^us-[a-z]{2}$/, "a jurisdiction such as us-tx")
      .optional()
      .describe(
        "The entity registry to look in, such as us-tx, when the name could match in several states.",
      ),
  },
  parcel_value_history: {
    parcel: text(
      300,
      "The parcel: a street address, a county parcel or account number, or a FactLot parcel URN.",
    ),
    as_of: z
      .string()
      .regex(DATE, "a date as YYYY-MM-DD")
      .optional()
      .describe(
        "Read the record as it stood on this date (YYYY-MM-DD) instead of the latest.",
      ),
  },
  tx_unequal_appraisal_candidates: {
    parcel: text(
      300,
      "The Texas subject parcel: a street address, the appraisal district account number, or a FactLot parcel URN.",
    ),
    county: optionalText(
      80,
      "The Texas county, when the parcel is given as an account number.",
    ),
    tax_year: z
      .string()
      .regex(/^\d{4}$/, "a four-digit tax year")
      .optional()
      .describe(
        "Roll year to compare in; by default the newest year whose roll gives the subject a value.",
      ),
  },
  lease_abstract_check: {
    document: text(
      500,
      "The lease: a PDF path on this machine (local server), or the name of a lease whose pages are in the conversation.",
    ),
    as_of: z
      .string()
      .regex(DATE, "a date as YYYY-MM-DD")
      .optional()
      .describe(
        "Date the abstract states the lease as of (YYYY-MM-DD); amendments effective later are pending.",
      ),
  },
  deal_math: {
    question: multiline(
      2_000,
      "The deal question with its figures, e.g. 'net effective rent on a 10-year lease at $42/sf with 6 months free and $60/sf TI'.",
    ),
    calculation: z
      .enum(
        Object.keys(DEAL_CALCULATORS) as [
          keyof typeof DEAL_CALCULATORS,
          ...(keyof typeof DEAL_CALCULATORS)[],
        ],
      )
      .optional()
      .describe(
        `The calculation, when known: ${Object.keys(DEAL_CALCULATORS).join(", ")}.`,
      ),
  },
} as const;

export type PromptName = keyof typeof PROMPT_ARGS;

// --- Shared paragraphs ---------------------------------------------------------------------------

const CITE =
  "Cite every fact you report: its predicate and value, the source (publisher and dataset) and as_of date, and its document_id (fetch with that ID returns the source snapshot). Relay each source's licence, attribution, ai_use and redistribution as the answer gives them, and every warning. Report only what the tools return: when a fact is missing, say so; do not fill it in from memory or elsewhere.";

function registryWhere(ctx: ResourceContext): string {
  if (ctx.registry || ctx.hosted) return "";
  return ` This server has no registry loaded, so it lists no registry_* tools: make these calls on the hosted FactLot server (${HOSTED_MCP_URL}; the free tier needs no key) or on a server whose FACTLOT_REGISTRY_DB names a registry file. factlot://coverage says what the hosted service covers.`;
}

function coverageFirst(ctx: ResourceContext): string {
  return `Call registry_coverage first unless you already know the place is covered (it is never metered): a lookup outside its regions is a coverage miss, which means not loaded, not that the property does not exist.${registryWhere(ctx)}`;
}

function lookups(data: ResourceData): string {
  return `Each registry_* call except registry_coverage that finds something is one registry lookup (without a key, ${data.plans.free.registry_lookups_per_day} a day per address on the hosted API); calls that find nothing (up to an hourly limit), input errors and misses outside loaded coverage are free.`;
}

function paidPlans(data: ResourceData): string {
  return data.plans.paid
    .map(
      (p) =>
        `${p.name} (${p.registry_lookups_per_month.toLocaleString("en-US")} registry lookups a month)`,
    )
    .join(" or ");
}

/** What a Pro or Team key adds, for the features a prompt touches. */
function planNote(
  data: ResourceData,
  features: ("history" | "dated" | "batch" | "portfolio" | "tax_year")[],
): string {
  const g = data.plans.gating;
  const parts: string[] = [];
  if (features.includes("history"))
    parts.push(
      `registry_get without a Pro or Team key returns the ${g.free_history} in value_history and history (the answer says so in history_available and history_note); a Pro or Team key returns every roll year held`,
    );
  if (features.includes("dated"))
    parts.push(`a dated registry_get (as_of) is for ${g.dated_get} keys only`);
  if (features.includes("tax_year"))
    parts.push(
      `registry_tx_equity_candidates with tax_year (a roll year you name) is for Pro and Team keys only; without tax_year it uses the newest roll year with values`,
    );
  if (features.includes("portfolio"))
    parts.push(
      `registry_owned_by without a Pro or Team key returns an owner's first three parcels and says how many were left out (portfolio_note); a Pro or Team key returns every parcel`,
    );
  if (features.includes("batch"))
    parts.push(
      `registry_tx_equity_candidates_batch, several subjects in one call, is for ${g.batch} keys only`,
    );
  return `On the hosted API with paid gating on: ${parts.join("; ")}. When an answer is cut for this reason, say so and that ${paidPlans(data)} answers it, with ${data.plans.pricing_url}; do not suggest a key is needed for anything else.`;
}

const resolveSteps = (what: string) =>
  `Find the ${what}'s FactLot URN: a URN (fl:parcel:...) is used as is; an address goes to registry_search_address (query: the address; ordinals such as 42nd match); a county parcel or account number goes to registry_resolve_parcel (state_fips, county_fips, apn as the county prints it), or registry_resolve_external with the county's own ID system. If several parcels match, list them with their labels and ask which one before going on.`;

function messages(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

const numbered = (steps: string[]) =>
  steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

// --- The prompts ---------------------------------------------------------------------------------

type Args<N extends PromptName> = {
  [K in keyof (typeof PROMPT_ARGS)[N]]?: string;
};

export function promptText(
  name: PromptName,
  args: Record<string, string | undefined>,
  ctx: ResourceContext,
  data: ResourceData = RESOURCE_DATA,
): string {
  switch (name) {
    case "property_owner": {
      const a = args as Args<"property_owner">;
      return [
        `Find who owns this property, from public records: ${a.property}${a.place ? ` (${a.place})` : ""}.`,
        numbered([
          coverageFirst(ctx),
          resolveSteps("parcel"),
          "registry_get on the parcel URN: report ownership.owner_of_record and the ownership links (an inferred link carries a confidence: give it), with the parcel's situs address and the date the owner was recorded.",
          "If the owner is linked to a registered entity, registry_get on that entity URN for its registry facts (name, jurisdiction, file number, status), cited the same way.",
        ]),
        "Owners that are natural persons are never returned: a parcel whose owner is a person shows no owner. Some places publish no owner names at all (factlot://markets/{slug} lists what each place does not hold). In either case say the record shows no organisation owner; do not guess one or look for a person's name elsewhere.",
        CITE,
        lookups(data),
      ].join("\n\n");
    }
    case "owner_portfolio": {
      const a = args as Args<"owner_portfolio">;
      return [
        `List the commercial parcels linked to this owner as owner of record: ${a.owner}${a.jurisdiction ? ` (entity registry ${a.jurisdiction})` : ""}.`,
        numbered([
          `${coverageFirst(ctx)} Its entity_registries say which entity registries are loaded and whether each is served in part.`,
          "Unless the owner is given as an entity URN (fl:entity:...), registry_search_entities with the registered name as query. Registered business entities only: natural persons are not searchable. If several entities match, list them (name, jurisdiction, file number) and ask which one.",
          "registry_owned_by with that entity_urn: report each parcel with its building, the per-building summary (condominium units count once per building), and the confidence of any inferred link.",
          "Only if the person asks about a parcel, registry_get on it for its cited facts.",
        ]),
        "The list holds parcels in hosted (or loaded) coverage only: say that it is not a complete portfolio of the owner everywhere.",
        planNote(data, ["portfolio"]),
        CITE,
        lookups(data),
      ].join("\n\n");
    }
    case "parcel_value_history": {
      const a = args as Args<"parcel_value_history">;
      return [
        `Give the value history of this parcel by tax year: ${a.parcel}${a.as_of ? `, as it stood on ${a.as_of}` : ""}.`,
        numbered([
          `${coverageFirst(ctx)} factlot://coverage/{place} gives the roll years held for each hosted Texas county.`,
          resolveSteps("parcel"),
          `registry_get on the URN${a.as_of ? ` with as_of ${a.as_of}` : ""}: value_history lists market and appraised value by tax year, newest first, each value cited. Report each year's values with its citation; say which rolls are preliminary, and when two snapshots value one tax year differently, give both.`,
          "Report the change between years only from these figures; for compounded rates or any other arithmetic on them call a calc_* tool (for example calc_irr or calc_npv), not mental math.",
        ]),
        planNote(data, a.as_of ? ["history", "dated"] : ["history"]),
        CITE,
        lookups(data),
      ].join("\n\n");
    }
    case "tx_unequal_appraisal_candidates": {
      const a = args as Args<"tx_unequal_appraisal_candidates">;
      return [
        `List Texas unequal-appraisal candidates (Tax Code §41.43(b)(3)) for this subject parcel, for the person to review: ${a.parcel}${a.county ? ` (${a.county} County)` : ""}${a.tax_year ? `, roll year ${a.tax_year}` : ""}.`,
        numbered([
          `${coverageFirst(ctx)} Only Texas parcels in hosted counties have candidates.${data.hosted.text?.withheld ? ` ${data.hosted.text.withheld}` : ""}`,
          resolveSteps("subject parcel"),
          "registry_get on the subject URN for its cited roll facts and value_history.",
          `registry_tx_equity_candidates with the subject's urn${a.tax_year ? ` and tax_year ${a.tax_year}` : ""}. Present the candidates as returned, with their tier, roll fields and citations, and restate selection_rule: they are candidates under FactLot's default rule, a design choice and not a legal standard. FactLot does not select comparables, and neither do you: the person decides which, if any, to use.`,
          "Only after the person has reviewed and edited the list (calc_args is that list in the calculator's input shape: remove, add or edit comparables, and any adjustment needs a reason and evidence), call calc_tx_unequal_appraisal with the reviewed calc_args (normalize_by improvement_area_sf when areas differ) and relay its flags and warnings.",
          "rules_tx_property_tax_protest_deadline (tax_year, and notice_delivered_date if known) for whether the protest window is open as of today.",
          "If the person wants the evidence packet or the adjustment grid, report_create kind tx_unequal_appraisal with the reviewed calculator arguments (hosted server only; pdf or xlsx).",
        ]),
        TX_EQUITY_NOTICE,
        TX_EQUITY_CALC_ARGS_NOTICE,
        "Do not look up the owners of candidate parcels; ownership is not needed for this comparison. Do not describe the list as comparables chosen for the person, and do not call any result an appraisal or a value opinion.",
        planNote(
          data,
          a.tax_year ? ["history", "tax_year", "batch"] : ["history", "batch"],
        ),
        CITE,
        lookups(data),
      ].join("\n\n");
    }
    case "lease_abstract_check": {
      const a = args as Args<"lease_abstract_check">;
      return [
        `Check a lease abstract against the lease itself: ${a.document}${a.as_of ? `, as of ${a.as_of}` : ""}. You extract; FactLot verifies.`,
        numbered([
          ctx.localFiles
            ? "Get the page text: doc_read_pdf with the PDF's path (OCR backend such as tesseract for scanned pages). If the pages are already in the conversation, use them exactly as given."
            : "Get the page text from the conversation, page by page, exactly as given (this server cannot read files on the person's machine; the local FactLot server's doc_read_pdf can).",
          "doc_predicates for the lease predicates and their value shapes. For each term (parties, premises, dates, rent steps, options, CAM, use and exclusives), extract the value with its verbatim quote and page.",
          `doc_verify_facts with the document and those candidates${a.as_of ? ` (as_of ${a.as_of})` : ""}; for a lease with amendments, doc_abstract_lease with each document's role (original, amendment) and effective_date, so later amendments control and pending ones are listed.`,
          "Report each verified term with its page and quote; list every item held for review and every rejection with its reason. Never present an unverified value as verified, and say where a term may not be final (open_items, conflicts, pending).",
          "Run arithmetic on verified terms only through calc_* tools (calc_rent_schedule, calc_critical_dates for notice windows); fact_package_create bundles the cited facts to hand on.",
        ]),
        "No registry lookup is needed. If property facts are wanted as well, call registry_coverage first.",
        CITE,
      ].join("\n\n");
    }
    case "deal_math": {
      const a = args as Args<"deal_math">;
      const calc = a.calculation
        ? DEAL_CALCULATORS[a.calculation as keyof typeof DEAL_CALCULATORS]
        : undefined;
      return [
        `Answer this deal question with FactLot's calculators, not mental math: ${a.question}`,
        numbered([
          calc
            ? `Use ${calc}; factlot://schemas/tools/${calc} gives its input schema.`
            : "Choose the calc_* tool (search finds it; for example calc_net_effective_rent, calc_compare_proposals, calc_debt_sizing, calc_irr, calc_direct_cap, calc_equity_waterfall); factlot://schemas/tools/{tool} gives its input schema.",
          "Map the figures to its inputs: rates and shares as decimals (0.065 for 6.5%), free rent as abated months, NNN expenses in additional costs. Ask for any figure the question does not give instead of assuming it; where a default is used, the warnings name it.",
          "Call the tool. Report the result with its formula ID (for example calc.net_effective_rent@1) and point to the returned steps; surface every warning to the person.",
          "If figures come from a lease or other document, verify them first with doc_verify_facts. If they come from public records, call registry_coverage first, then the registry tools, and cite those facts.",
          "For a workbook or PDF of the result, report_create (hosted server only).",
        ]),
        "Results are arithmetic, not appraisal, legal, tax or investment advice.",
        CITE,
      ].join("\n\n");
    }
  }
}

const PROMPTS: Record<PromptName, { title: string; description: string }> = {
  property_owner: {
    title: "Who owns this property",
    description:
      "The owner of record of a commercial property from public records, cited: coverage check, parcel lookup, owner and entity facts.",
  },
  owner_portfolio: {
    title: "An owner's portfolio",
    description:
      "The commercial parcels linked to a registered entity as owner of record, cited, within hosted coverage.",
  },
  parcel_value_history: {
    title: "Value history of a parcel",
    description:
      "Market and appraised value by tax year for one parcel, each value cited; optionally as of a date.",
  },
  tx_unequal_appraisal_candidates: {
    title: "Texas unequal-appraisal candidates",
    description:
      "Candidate parcels under FactLot's default rule for a Texas subject parcel, for the person to review; then the arithmetic on the reviewed list. Candidates only: not advice and not an appraisal.",
  },
  lease_abstract_check: {
    title: "Lease abstract check",
    description:
      "Verify a lease's terms against its pages: extract with quotes, verify with doc_verify_facts or doc_abstract_lease, report what is verified and what needs review.",
  },
  deal_math: {
    title: "Deal maths with the calculators",
    description:
      "Net effective rent, proposal comparison, debt sizing, NPV/IRR, DCF, direct cap, waterfalls and more through the calc_* tools, with formula IDs and warnings.",
  },
};

/** Register every prompt on `server`. */
export function registerPrompts(
  server: McpServer,
  ctx: ResourceContext,
  data: ResourceData = RESOURCE_DATA,
): void {
  for (const name of Object.keys(PROMPTS) as PromptName[]) {
    const { title, description } = PROMPTS[name];
    server.registerPrompt(
      name,
      { title, description, argsSchema: PROMPT_ARGS[name] },
      (args: Record<string, string | undefined>) =>
        messages(promptText(name, args, ctx, data)),
    );
  }
}
