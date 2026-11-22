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
  expense_statement_audit: {
    lease: text(
      500,
      "The tenant's lease (with its amendments): a PDF path on this machine (local server), or the name of a lease whose pages are in the conversation.",
    ),
    statement: text(
      500,
      "The landlord's operating-expense (CAM) statement: a PDF path on this machine (local server), or the name of a statement whose pages are in the conversation.",
    ),
    as_of: z
      .string()
      .regex(DATE, "a date as YYYY-MM-DD")
      .describe(
        "Today's date (YYYY-MM-DD): the audit counts its deadlines from it and reads no clock.",
      ),
    landlord_contact: optionalText(
      200,
      "The landlord organisation the dispute would go to, when the person wants to send it (never invent one).",
    ),
  },
  expense_portfolio_audit: {
    tenant: text(
      200,
      "The tenant organisation whose locations are audited (the person's own, or the client of the audit firm or broker; never invent one).",
    ),
    locations: multiline(
      2_000,
      "The locations to audit, one per line: a label, and where the person has it the landlord and the statement year (for example a store number, its landlord, the year), with where each lease and statement is (a PDF path on this machine for a local server, or the name of a document whose pages are in the conversation). Up to 50 per call.",
    ),
    as_of: z
      .string()
      .regex(DATE, "a date as YYYY-MM-DD")
      .describe(
        "Today's date (YYYY-MM-DD): every location's deadline is counted from it and the tools read no clock.",
      ),
  },
  estoppel_certificate: {
    lease: text(
      500,
      "The tenant's lease (with its amendments): a PDF path on this machine (local server), or the name of a lease whose pages are in the conversation.",
    ),
    tenant: text(
      200,
      "The tenant organisation that will be asked to confirm the statements (never invent one).",
    ),
    as_of: z
      .string()
      .regex(DATE, "a date as YYYY-MM-DD")
      .describe(
        "The date the statements are made as of (YYYY-MM-DD): the certificate reads no clock.",
      ),
    relying_party: optionalText(
      200,
      "The lender or buyer that asked for the estoppel and will rely on it, when the person has named one (never invent one).",
    ),
  },
  rent_roll_certification: {
    rent_roll: text(
      500,
      "The rent roll to certify: a PDF path on this machine (local server), or the name of a rent roll whose pages are in the conversation.",
    ),
    property: text(
      240,
      "The property in words: name and address (never invent one).",
    ),
    as_of: z
      .string()
      .regex(DATE, "a date as YYYY-MM-DD")
      .describe(
        "The date of the rent roll (YYYY-MM-DD): the certification reads no clock.",
      ),
    certifier: text(
      200,
      "The borrower or seller (or the broker acting for one) that certifies the roll (never invent one).",
    ),
    relying_party: optionalText(
      200,
      "The lender or buyer that asked for the certification and will rely on it, when the person has named one (never invent one).",
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
    case "expense_statement_audit": {
      const a = args as Args<"expense_statement_audit">;
      return [
        `Audit the landlord's expense statement (${a.statement}) against the tenant's lease (${a.lease}), as of ${a.as_of}. You extract; FactLot verifies and does the arithmetic. Every finding must rest on a verified lease fact: no source, no finding.`,
        numbered([
          "Get the lease's pages and the statement's pages exactly as given (doc_read_pdf with the PDF's path on a local server; otherwise the pages in the conversation).",
          "doc_abstract_lease (or doc_verify_facts) on the lease for the terms the audit reads: lease.pro_rata_share, lease.cam_cap (or lease.cam_cap_rate when the clause does not say how the cap builds), lease.operating_expense_base_year or lease.expense_stop, lease.cam_admin_fee, lease.cam_gross_up, one lease.cam_exclusion per excluded category, lease.capex_treatment and lease.audit_right (window, notice form, cost-shifting threshold). doc_predicates gives the shapes of the known predicates; audit_expense_statement's description gives the rest. Each value comes with its verbatim quote and page.",
          "doc_verify_facts on the statement for statement.period (year, statement date, and received_date only when the statement itself prints it), one statement.line per billed line (building-level amounts; not the fee), statement.share_applied, statement.admin_fee (with level: building when the fee is printed on the building's expenses, level: tenant when on the tenant's share), statement.gross_up, statement.cap_applied, statement.total (as printed, with includes_fee true when it includes the fee), statement.tenant_charge, the estimates and the balance. Hold anything that is not verified for the person to review; never pass an unverified value on. If the statement does not print the day the tenant received it, ask the person for that day and their full name and pass them as received {date, stated_by}.",
          "audit_expense_statement with the verified lease facts, the verified statement facts, the prior year's lines if the person has them, and as_of. Read warnings and checks_not_run first: a warning that the differences exceed the tenant's whole charge means an amount was entered at the wrong level and the total must not be used until it is corrected; a check whose lease term is missing did not run, and that is not a clean result.",
          "Show the person every finding in full: its code, title, the landlord's figure, the figure the lease yields, the difference, the lease quote and page, the statement quote and page, the calculation steps, its class (follows_from_terms, depends_on_reading, question_to_ask) and what they must confirm. Say plainly that these are differences against quoted terms, not legal conclusions. Give the deadline and the notice form the lease requires.",
          "If the person wants a document, report_create kind expense_audit with the same arguments (hosted server; PDF).",
          "To dispute, fact_package_create from the lease and statement facts, then show the person the package_items, the calculation and the counterparty, ask for the full name of the person who approves, and only after they say it may be sent call fact_package_send with approved_by and approval_confirmed. Say whether it went as a test or for real from the answer's message. fact_package_status reads the answers.",
        ]),
        "On the hosted server a caller without a Pro or Team key gets the summary only (count, total difference, deadlines, checks not run) and the answer says what is withheld; relay that in plain words. Results are arithmetic against quoted terms, not legal or accounting advice; an overcharge is claimed only where the arithmetic follows from a quoted term.",
        "No registry lookup is needed. If property facts are wanted as well, call registry_coverage first.",
        CITE,
      ].join("\n\n");
    }
    case "expense_portfolio_audit": {
      const a = args as Args<"expense_portfolio_audit">;
      return [
        `Audit the landlords' expense statements for ${a.tenant}'s locations, as of ${a.as_of}, in one portfolio. The locations:\n${a.locations}\n\nYou extract; FactLot verifies and does the arithmetic. Every finding must rest on a verified lease fact: no source, no finding. A location is audited the same way as a single statement; the portfolio adds them up.`,
        numbered([
          "For each location, get the lease's pages and the statement's pages exactly as given (doc_read_pdf with the PDF's path on a local server; otherwise the pages in the conversation).",
          "For each location, doc_abstract_lease (or doc_verify_facts) on the lease for the terms the audit reads (lease.pro_rata_share, lease.cam_cap or lease.cam_cap_rate, lease.operating_expense_base_year or lease.expense_stop, lease.cam_admin_fee, lease.cam_gross_up, one lease.cam_exclusion per excluded category, lease.capex_treatment, lease.audit_right), and doc_verify_facts on the statement (statement.period with the date the tenant received it, one statement.line per billed line, statement.share_applied, statement.admin_fee, statement.gross_up, statement.cap_applied, statement.total, the estimates and the balance), each value with its verbatim quote and page. Hold anything not verified for the person to review; never pass an unverified value on.",
          "audit_expense_portfolio with one entry in audits per location: its label (unique), the landlord as named on the statement, lease_facts, statement_facts and the prior year's lines if the person has them, and as_of. A location whose input fails validation is listed under locations_invalid with its issues and the others are still audited: show the person each issue, fix that location and run it again. Read each location's checks_not_run first: a check whose lease term is missing did not run, and that is not a clean result.",
          "Show the person the portfolio first: locations audited, total at stake apart for findings that follow from the leases' terms and findings that depend on a reading, the totals by landlord, the ranking, the dispute deadlines in date order with days remaining, and the repeated issues (the same check failing at several locations, or across years for one landlord). Then each location's findings with their lease pages (include_results returns every quote and calculation step). Say plainly that these are differences against quoted terms, not legal conclusions.",
          "If the person wants a document, report_create kind expense_audit_portfolio with the same arguments (hosted server; PDF or XLSX with one row per finding). It counts one report for each location audited in full (report_units), so say how many that is before building it.",
          "To dispute, work one location at a time: fact_package_create from that location's lease and statement facts, then show the person that location's package_items, the landlord and the deadline, ask for the full name of the person who approves, and only after they say it may be sent call fact_package_send with that location's package_items, its attestation (package.attestation, unchanged) and approved_by with approval_confirmed. Never put two locations in one package: each landlord receives only its own location. Say whether it went as a test or for real from the answer's message. fact_package_status reads the answers.",
        ]),
        "On the hosted server a caller without a Pro or Team key gets the summary only (counts and totals); the one free full document covers a single audit, not a portfolio, and the answer says so. Relay that in plain words. Results are arithmetic against quoted terms, not legal or accounting advice.",
        "No registry lookup is needed. If property facts are wanted as well, call registry_coverage first.",
        CITE,
      ].join("\n\n");
    }
    case "estoppel_certificate": {
      const a = args as Args<"estoppel_certificate">;
      return [
        `Prepare a tenant estoppel certificate for ${a.tenant} from the lease (${a.lease}), as of ${a.as_of}${a.relying_party ? `, for ${a.relying_party} to rely on` : ""}. You extract; FactLot verifies and prepares. Every statement from the lease must rest on a verified lease fact: no source, no statement.`,
        numbered([
          "Get the lease's pages and every amendment's pages exactly as given (doc_read_pdf with the PDF's path on a local server; otherwise the pages in the conversation).",
          "doc_abstract_lease (or doc_verify_facts) on the lease and each amendment for the terms the estoppel reads: lease.landlord, lease.tenant, lease.commencement_date, lease.expiration_date, lease.rentable_area_sf, lease.base_rent_schedule, lease.security_deposit, lease.free_rent, lease.ti_allowance and any option (lease.renewal_option, lease.expansion_option, lease.termination_option, lease.rofr, lease.rofo, lease.purchase_option). An amendment's fact names the earlier fact it changes in supersedes. Each value comes with its verbatim quote and page. Hold anything not verified for the person to review.",
          "estoppel_prepare with the verified lease facts, the parties, the premises, the documents (original and amendments, by document_id) and as_of. Read gaps and conflicts first: a missing term is a gap, a lease and an amendment that disagree is a conflict, and neither is guessed or resolved.",
          "Show the person every statement in full with its quote and page, and say which are for the tenant to confirm because no lease sentence can support them. Say plainly that these are facts and arithmetic, not legal conclusions, and that the tenant's signature, not FactLot, makes it an estoppel.",
          "fact_package_create from the package_facts, then show the person the package_items, the tenant and the relying party, ask for the full name of the person who approves, and only after they say it may be sent call fact_package_send with kind estoppel, the package_items as items, relying_parties and approved_by with approval_confirmed. Say whether it went as a test or for real from the answer's message. Send link_for_counterparty to the tenant; give each relying party its own link from links_for_relying_parties only after the tenant has answered.",
          "fact_package_status reads the tenant's answers (agreed, disputed, or its own version), the signer's name and title with the electronic signature record, when each lender or buyer link was opened, and who has recorded reliance. A disputed statement is never recorded as relied on: show the person what the tenant said.",
          "For the certificate, report_create kind estoppel_certificate with estoppel_prepare's arguments, the tenant's answers as context.estoppel_answers and the reliers as context.estoppel_reliers and the signature as context.estoppel_signature (hosted server; PDF).",
        ]),
        "On the hosted server a caller without a Pro or Team key gets the summary only (counts, statement titles and status, gaps and conflicts) and the answer says what is withheld; relay that in plain words. Nothing is sent without the named person's approval, and real sending needs a FactLot account key.",
        "No registry lookup is needed. If property facts are wanted as well, call registry_coverage first.",
        CITE,
      ].join("\n\n");
    }
    case "rent_roll_certification": {
      const a = args as Args<"rent_roll_certification">;
      return [
        `Certify the rent roll (${a.rent_roll}) for ${a.property}, as of ${a.as_of}, on behalf of ${a.certifier}${a.relying_party ? `, for ${a.relying_party} to rely on` : ""}. You extract; FactLot verifies, checks and grades. Every figure on the roll and in a lease must rest on a verified fact with its quote and page: no source, no fact.`,
        numbered([
          "Get the rent roll's pages exactly as given (doc_read_pdf with the PDF's path on a local server; otherwise the pages in the conversation).",
          "doc_verify_facts on the rent roll for each line, one fact per field with the line's verbatim row as the quote and its page: rent_roll.tenant_name, rent_roll.suite, rent_roll.rentable_area_sf, rent_roll.lease_start_date, rent_roll.lease_expiration_date, rent_roll.base_rent_monthly, rent_roll.base_rent_annual, rent_roll.base_rent_psf, and where the roll states them rent_roll.next_rent_step, rent_roll.security_deposit, rent_roll.free_rent_outstanding, rent_roll.renewal_option, rent_roll.recoveries. Mark a vacant suite occupancy vacant. Hold anything not verified for the person to review.",
          "For each tenant whose lease the person supplies, doc_abstract_lease on the lease and every amendment (lease.tenant, lease.commencement_date, lease.expiration_date, lease.rentable_area_sf, lease.base_rent_schedule, lease.security_deposit, lease.free_rent, lease.renewal_option, and lease.suite, lease.recovery_structure, lease.operating_expense_base_year if the lease states them). A tenant with no lease supplied is simply left without one: it is graded no lease supplied, never assumed.",
          "Optionally, for a tenant with a confirmed estoppel (estoppel_prepare then fact_package_send kind estoppel, fact_package_status), pass its statement keys, codes and the tenant's answers as that lease's estoppel.",
          "rent_roll_certify with the lines, the leases, as_of, the parties and building_area_sf if known. Read the flags and each line's grade first: matches lease, matches lease and confirmed by tenant, differs (with both figures, the difference and the quotes), no lease supplied, not checkable (with the reason). Show the person every difference with its quotes, and say plainly that these are facts and arithmetic, not legal, appraisal or lending advice.",
          "fact_package_create from the package_facts, then show the person the package_items, the totals and the recipient, ask for the full name of the person who approves, and only after they say it may be sent call fact_package_send with kind rent_roll, the package_items as items, package_calculation as calculation, to the lender or buyer, estoppel_links for any line confirmed by a tenant, and approved_by with approval_confirmed. Say whether it went as a test or for real from the answer's message. Send link_for_counterparty to the lender or buyer: it shows each line with its grade, quotes, pages and document fingerprints and lets them record reliance on the lines graded as matching, never on a line that differs, has no lease or could not be checked.",
          "fact_package_status shows who has recorded reliance and on which lines.",
          "For the certificate, report_create kind rent_roll_certificate with rent_roll_certify's arguments and who has relied as context.rent_roll_reliers (hosted server; PDF, or XLSX of the line grid).",
        ]),
        "The certifying party's certification, not FactLot, is what the lender or buyer relies on, and FactLot checked the roll against the documents supplied only: say so. On the hosted server a caller without a Pro or Team key gets the summary only (totals, key figures, counts of each grade, flags) and the answer says what is withheld; relay that in plain words. Nothing is sent without the named person's approval, and real sending needs a FactLot account key.",
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
  expense_statement_audit: {
    title: "Audit a landlord's expense statement",
    description:
      "A tenant's audit of a CAM statement: abstract the lease, verify the statement, run audit_expense_statement, show every finding with its quote and calculation, get the named person's approval, then send the dispute.",
  },
  expense_portfolio_audit: {
    title: "Audit many expense statements at once",
    description:
      "A tenant's audit of many landlords' CAM statements: verify each location's lease and statement, run audit_expense_portfolio, show the totals, ranking, deadlines and repeated issues, then each location's findings, the portfolio report, and one dispute package per landlord.",
  },
  estoppel_certificate: {
    title: "Prepare a tenant estoppel certificate",
    description:
      "A tenant estoppel from a lease: abstract the lease and amendments, run estoppel_prepare, show every statement with its quote, get the named person's approval, send to the tenant with a link for the lender or buyer, read the answers and reliance, then the certificate.",
  },
  rent_roll_certification: {
    title: "Certify a rent roll against the leases",
    description:
      "A commercial rent roll certified for a lender or buyer: verify each roll line and each lease, run rent_roll_certify, show every grade and difference with its quote, get the named person's approval, send to the lender or buyer who records reliance on the lines graded as matching, then the certificate.",
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
