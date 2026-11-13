/**
 * The FactLot tool catalog: one list of tools, with identical names, inputs, and
 * outputs on every surface (MCP, REST, OpenAPI, and each AI provider's function calling).
 */
import { CalcInputError, IsoDate, calculators, rulePacks } from "@factlot/calc";
import {
  FactLotIdError,
  buildingId,
  documentId,
  entityId,
  parcelId,
  parse,
  shortId,
  spaceId,
} from "@factlot/id";
import { z } from "zod";

import { LeaseCompValidateInput, validateLeaseComp } from "./comps.ts";
import { LeaseCompSearchInput, searchLeaseComps } from "./comps_search.ts";
import {
  AbstractLeaseInput,
  CompareInput,
  ToolInputError,
  VerifyClaimInput,
  VerifyFactsInput,
  abstractLease,
  compare,
  validateFact,
  verifyClaim,
  verifyFacts,
} from "./documents.ts";
import {
  FactPackageCreateInput,
  FactPackageVerifyInput,
  createFactPackage,
  verifyFactPackage,
} from "./packages.ts";
import { DocPredicatesInput, docPredicates } from "./predicates.ts";
import { SpreadStatementInput, spreadStatement } from "./statements.ts";
import { UseConflictInput, checkUseConflict } from "./uses.ts";

import {
  RegistryUnavailableError,
  registryCoverage,
  registryFacts,
  registryGet,
  registryOwnedByResult,
  registryPath,
  registryRecordMiss,
  registryResolveExternalResult,
  registryResolveParcelResult,
  registrySearchAddressResult,
  registrySearchEntitiesResult,
  registryTxEquityCandidates,
  texasOnly,
  TEXAS_FIPS,
  TX_EQUITY_DEFAULTS,
  TX_EQUITY_LIMIT_MAX,
  TX_EQUITY_NOTICE,
  TX_EQUITY_RULE,
  TX_EQUITY_USE_CODES_MAX,
  TX_EQUITY_WHICH_PARCEL,
  txEquityWithheld,
  txEquitySubjectUrn,
  withTxEquityCalcArgs,
} from "./registry.ts";
import {
  INPUT_LIMITS,
  appliesUnitPolicy,
  inputShapeIssue,
  unitSlipIssues,
  unknownFields,
  withoutNulls,
  withRateHints,
} from "./limits.ts";

export const CATALOG_VERSION = "0.5.0";

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  /** Runs the tool on already-shaped input; throws CalcInputError/FactLotIdError on domain errors. */
  run: (input: never) => unknown;
  /** REST path under the API root, e.g. "/v1/calc/rent_schedule". */
  path: string;
  /** Formula identity for calculators. */
  formula?: { id: string; version: number };
  /** Set for tools that need a FactLot Registry database (hosted, or FACTLOT_REGISTRY_DB). */
  requires?: "registry";
  /** Set for tools whose run returns a Promise (WebCrypto); call them through runToolAsync. */
  async?: true;
  /**
   * Set for tools that parse their own input (the calculators): run receives the arguments as
   * sent, after the checks, so a tool can tell an omitted field from its schema default (as
   * Python's run_tool does).
   */
  rawInput?: true;
}

export interface ToolError {
  error:
    | "CalcInputError"
    | "FactLotIdError"
    | "InputError"
    | "UnknownTool"
    | "RegistryUnavailable"
    | "NotFound";
  message: string;
  issues: { path: string; message: string }[];
  /** On a registry NotFound: whether the region or registry asked about is loaded in this file. */
  coverage?: unknown;
}

export type ToolOutcome =
  { ok: true; result: unknown } | { ok: false; error: ToolError };

const PRODUCER = { name: "@factlot/tools", version: CATALOG_VERSION };

const calcTools: ToolSpec[] = Object.entries(calculators).map(([name, c]) => ({
  name: `calc_${name}`,
  title: c.title,
  description: `${c.description} Deterministic: the same inputs always give the same result, with formula ID ${c.id}@${c.version}, every step, and any warnings.`,
  input: c.input,
  path: `/v1/calc/${name}`,
  formula: { id: c.id, version: c.version },
  rawInput: true,
  run: (input: never) => {
    const result = (
      c.run as (i: unknown) => { formula: { id: string; version: number } }
    )(input);
    return {
      ...result,
      provenance: {
        method: "computed",
        formula: `${result.formula.id}@${result.formula.version}`,
        producer: PRODUCER,
        sources: [],
      },
    };
  },
}));

const ruleTools: ToolSpec[] = Object.entries(rulePacks).map(([name, r]) => ({
  name: `rules_${name}`,
  title: r.title,
  description: `${r.description} Verification status: ${r.verification.status}. Cite rule ${r.id}@${r.version} and its statutes.`,
  input: r.input,
  path: "path" in r ? r.path : `/v1/rules/${name}`,
  formula: { id: r.id, version: r.version },
  run: (input: never) => {
    const result = (
      r.run as (i: unknown) => { formula: { id: string; version: number } }
    )(input);
    return {
      ...result,
      provenance: {
        method: "computed",
        formula: `${result.formula.id}@${result.formula.version}`,
        producer: PRODUCER,
        sources: [],
      },
    };
  },
}));

const ParcelInput = z.object({
  state_fips: z
    .string()
    .max(16)
    .describe('2-digit state FIPS code, e.g. "06" for California.'),
  county_fips: z
    .string()
    .max(16)
    .describe('3-digit county FIPS code, e.g. "037" for Los Angeles County.'),
  apn: z
    .string()
    .max(200)
    .describe(
      "Assessor's parcel number exactly as the county prints it. Letter case and the separator characters are normalized; where a separator falls is kept, except in counties with a documented fixed-width format (NYC BBL, Los Angeles AIN, Cook County PIN, DC SSL).",
    ),
});
const EntityInput = z.object({
  jurisdiction: z
    .string()
    .max(64)
    .describe(
      'Registry jurisdiction, e.g. "us-de" for Delaware, or "lei" for a Legal Entity Identifier.',
    ),
  registry_number: z
    .string()
    .max(200)
    .describe(
      "File number issued by that registry, or the 20-character LEI (its ISO 17442 check digits are verified).",
    ),
});
const SpaceInput = z.object({
  building_urn: z
    .string()
    .max(500)
    .describe(
      "FactLot building URN from id_building, e.g. fl:building:us-11001:20002:208-massachusetts-ave-ne (a minted fl:building:<26-character token> also works).",
    ),
  suite: z
    .string()
    .max(200)
    .describe(
      'Suite or unit as written ("Suite 400", "STE 400", "#400", "3rd Floor" all normalize).',
    ),
});
const BuildingInput = z.object({
  state_fips: z
    .string()
    .max(16)
    .describe(
      '2-digit state FIPS code, e.g. "11" for the District of Columbia.',
    ),
  county_fips: z
    .string()
    .max(16)
    .describe('3-digit county FIPS code, e.g. "001".'),
  zip: z
    .string()
    .max(16)
    .describe(
      '5-digit ZIP code of the address, e.g. "20002" (ZIP+4 accepted).',
    ),
  street: z
    .string()
    .max(300)
    .describe(
      'Street line: house number and street, e.g. "208 Massachusetts Ave NE". A suite, unit or floor is ignored, and so is anything after a comma (city, state).',
    ),
});
const DocumentInput = z
  .object({
    content_base64: z
      .string()
      .optional()
      .describe(
        "Base64 of the exact file bytes (preferred: every party gets the same ID).",
      ),
    text: z
      .string()
      .optional()
      .describe(
        "Document text, UTF-8 encoded before hashing. Use only when bytes are unavailable.",
      ),
  })
  .refine((v) => (v.content_base64 === undefined) !== (v.text === undefined), {
    message: "provide exactly one of content_base64 or text",
  });
const ParseInput = z.object({
  urn: z
    .string()
    .max(500)
    .describe("A FactLot URN to validate, e.g. fl:parcel:us-06037:5432001012."),
});
const FactValidateInput = z.object({
  fact: z
    .record(z.string(), z.unknown())
    .describe(
      "A FactLot fact: subject, predicate, value, as_of, provenance (with sources), optional rights.",
    ),
});

const idTools: ToolSpec[] = [
  {
    name: "id_parcel",
    title: "FactLot parcel ID",
    description:
      'Deterministic FactLot ID for a parcel from state FIPS, county FIPS, and the assessor\'s parcel number (APN). The same parcel always yields the same ID, offline. Use it as the join key across systems. APNs that differ only in where a separator falls ("12-34", "1-234") get different IDs; in a county with a documented fixed-width format the variants of one APN converge (NYC BBL "3-1234-56" = "3012340056").',
    input: ParcelInput,
    path: "/v1/id/parcel",
    run: (i: never) => {
      const v = i as z.output<typeof ParcelInput>;
      return parcelId({
        stateFips: v.state_fips,
        countyFips: v.county_fips,
        apn: v.apn,
      });
    },
  },
  {
    name: "id_entity",
    title: "FactLot legal-entity ID",
    description:
      "Deterministic FactLot ID for a legal entity (LLC, LP, corporation, trust) from its registry jurisdiction and file number, or from its LEI (an LEI whose ISO 17442 check digits do not match is rejected).",
    input: EntityInput,
    path: "/v1/id/entity",
    run: (i: never) => {
      const v = i as z.output<typeof EntityInput>;
      return entityId({
        jurisdiction: v.jurisdiction,
        registryNumber: v.registry_number,
      });
    },
  },
  {
    name: "id_space",
    title: "FactLot space (suite) ID",
    description:
      'FactLot ID for a suite or unit within a building, given the building\'s FactLot URN (from id_building). Suite designators are normalized: "Suite 100", "Ste 100" and "#100" agree, while "1-20" and "120" stay distinct.',
    input: SpaceInput,
    path: "/v1/id/space",
    run: (i: never) => {
      const v = i as z.output<typeof SpaceInput>;
      return spaceId(v.building_urn, v.suite);
    },
  },
  {
    name: "id_building",
    title: "FactLot building ID",
    description:
      "Deterministic FactLot ID for a building from its street address: county FIPS, ZIP code, and street line. Every condominium unit, suite, and floor at the address gets the same building ID, offline. Pass it to id_space for a suite, or to registry_get to see the building's parcels.",
    input: BuildingInput,
    path: "/v1/id/building",
    run: (i: never) => {
      const v = i as z.output<typeof BuildingInput>;
      return buildingId({
        stateFips: v.state_fips,
        countyFips: v.county_fips,
        zip: v.zip,
        street: v.street,
      });
    },
  },
  {
    name: "id_document",
    title: "FactLot document ID",
    description:
      "Content-addressed FactLot ID (SHA-256) for a document such as a lease, amendment, or estoppel.",
    input: DocumentInput,
    path: "/v1/id/document",
    run: (i: never) => {
      const v = i as z.output<typeof DocumentInput>;
      return documentId(
        v.content_base64 !== undefined
          ? Buffer.from(v.content_base64, "base64")
          : (v.text ?? ""),
      );
    },
  },
  {
    name: "id_parse",
    title: "Parse a FactLot ID",
    description:
      "Validate a FactLot URN and return its kind, components, and short ID.",
    input: ParseInput,
    path: "/v1/id/parse",
    run: (i: never) => {
      const { urn } = i as z.output<typeof ParseInput>;
      return { ...parse(urn), urn, short: shortId(urn) };
    },
  },
  {
    name: "fact_validate",
    title: "Validate a FactLot fact",
    description:
      "Check one FactLot fact against the published fact schema (spec/schemas/fact.json): subject URN, dotted predicate, as_of date, provenance, optional rights; unknown fields are rejected at every level. Rules: every fact except a computed one cites at least one source (an inferred fact cites the evidence it was inferred from); a computed fact names its formula or cites a source; valid_from is not after valid_to; a source span does not end before it starts. For Ingest predicates (lease.expiration_date, lease.rentable_area_sf, lease.base_rent_schedule, ...) the value must have the predicate's shape and every source quote must state the value, by the same written-form rules as doc_verify_facts (a quote saying \"2,500 square feet\" does not support 1000). Not checked: that the quote is in the document, that the document or sha256 exists, that supersedes IDs exist, and quotes for other predicates; doc_verify_facts with the document's pages checks the quote. Returns { valid, issues }. Call before storing or sharing facts.",
    input: FactValidateInput,
    path: "/v1/facts/validate",
    run: (i: never) =>
      validateFact((i as z.output<typeof FactValidateInput>).fact),
  },
];

const docTools: ToolSpec[] = [
  {
    name: "doc_verify_facts",
    title: "Verify extracted document facts",
    description:
      'Check values YOU extracted from a document against its text, deterministically; FactLot runs no model. Send the pages as text and one candidate per value: {predicate, value, quote, page}. Each candidate is checked in order: (1) the value\'s shape (Ingest predicates such as lease.expiration_date YYYY-MM-DD, lease.pro_rata_share in (0, 1], ordered lease.base_rent_schedule steps; any other dotted predicate needs a non-empty value); (2) the quote, at least 12 characters, is on the cited page, where only whitespace, line breaks, letter case and typographic quotes and dashes may differ (a word hyphenated across a line must keep its hyphen; a quote found on exactly one other page is accepted with the page corrected); (3) every number, date and party name in the value is written in the quote, in any common form: 1250000 matches "$1,250,000.00", 0.03 matches "3%" or "three percent", 2031-06-30 matches "June 30, 2031" or "6/30/2031"; text the lease states as written (a prohibited use, a carve-out, a protected use) is written in it as words, ignoring case, punctuation and line breaks; (4) a confidence you give below 0.8 holds it for review; (5) every other part of the value must be confirmed by the quote too: a true/false value, an enum or a summary not written in the quote holds the candidate for review, named in the reason. Verified means every part of the value was found in the quote. Returns verified (FactLot facts: method extracted, citing document_id, page, quote and character span, plus which value parts were checked and as what), needs_review (the quote is on the page but does not state the value: check consistency; low confidence: confidence; a part FactLot cannot confirm from the quote, such as a boolean: coverage) and rejected (wrong shape; quote missing, too short, or on several pages), each with a reason to act on. Not checked: meaning (a quote stating the number in another context passes), and whether the pages came from the file whose sha256 you give.',
    input: VerifyFactsInput,
    path: "/v1/doc/verify_facts",
    run: (i: never) =>
      verifyFacts(i as z.output<typeof VerifyFactsInput>, PRODUCER),
  },
  {
    name: "doc_abstract_lease",
    title: "Lease abstract with amendments",
    description:
      "Current-state lease abstract from a lease and its amendments, with amendment precedence, as of as_of. Give each document's pages with the candidates you extracted (checked exactly as doc_verify_facts checks them), or the facts doc_verify_facts already returned for it (without pages only the value against its quote is rechecked, marked quote_on_page: false). Documents may come in any order: give the lease role original and each amendment role amendment with its effective_date (without a role the lease is inferred only when that is unambiguous, otherwise it is an input error; two or more amendments need effective dates). The original applies first, then amendments by effective_date; a later document's value for a predicate controls, and the earlier one moves to history and is linked through supersedes. An amendment effective after as_of is pending: its values are listed under pending and pending_facts with a warning and do not control. A rent schedule restated from a later date keeps the earlier steps before it (carried_forward). Each field gives its value, the controlling document, page, quote and fact, the superseded history, conflicts (two different values from one document, or from two documents of the same rank), pending values and open_items (a candidate for that predicate in the controlling or a later document that needs review or was rejected, so the value may not be final). FactLot only orders what you extracted: it does not find terms you missed, and an amendment that changes a term without restating it (\"extended by 24 months\") needs the resulting value extracted with that sentence as its quote, which the quote check will hold for review if the date is not written there.",
    input: AbstractLeaseInput,
    path: "/v1/doc/abstract_lease",
    run: (i: never) =>
      abstractLease(i as z.output<typeof AbstractLeaseInput>, PRODUCER),
  },
  {
    name: "doc_compare",
    title: "Compare asserted values with a lease",
    description:
      "Compare values another document asserts (an estoppel, rent roll or offering memo, mapped by you to predicates) with verified lease facts from doc_abstract_lease or doc_verify_facts. Each asserted value comes back match, mismatch (with the differing fields), not_in_lease, or ambiguous_in_lease (two current lease facts disagree), with the controlling lease citation (document, page, quote). Values compare exactly as JSON: numbers by value, strings exactly (a name written differently is a mismatch), and for an object only the fields you assert. Facts another fact supersedes are ignored. When the lease fact is an extracted fact whose quote does not confirm part of its value (a true/false value, an enum), the result lists those parts in lease_not_checked. The lease facts must pass fact_validate; FactLot does not re-read the lease, so pass the facts its document tools returned.",
    input: CompareInput,
    path: "/v1/doc/compare",
    run: (i: never) => compare(i as z.output<typeof CompareInput>),
  },
  {
    name: "doc_verify_claim",
    title: "Verify a claim against a document",
    description:
      "Check one claim against a document page: {predicate, value} (anything doc_verify_facts accepts) or a short claim sentence ({text} or a bare string), plus the verbatim quote and page it rests on. Returns supported (the quote is on the page and every checked number, date and name in the claim is written in it), contradicted (the quote is on the page and states other numbers or dates of the same kind, listed in quote_states), or unverifiable (the quote is not on the page, nothing in the claim can be checked, or the quote states no value of that kind), with the evidence (document_id, page, quote, span) and each part checked. Textual, not semantic: for a sentence only its numbers and dates are compared, never its meaning, and a quote that mentions the right number for a different term still supports it.",
    input: VerifyClaimInput,
    path: "/v1/doc/verify_claim",
    run: (i: never) => verifyClaim(i as z.output<typeof VerifyClaimInput>),
  },
  {
    name: "doc_spread_statement",
    title: "Spread an operating statement",
    description:
      "Spread a T-12, operating statement, budget or rent roll summary YOU read, onto FactLot's published chart of accounts (multifamily, commercial, or hotel after the USALI summary), deterministically; FactLot runs no model. Send the pages as text and one line per item: {label, amount, quote, page}, optionally your category, a period column, and for a subtotal the indexes of the lines it sums; give the statement's own totals (effective_gross_income, total_operating_expenses, net_operating_income, ebitda, ...) as lines with that total as category. Each line is checked: the quote is on the page (a quote under 12 characters, such as a short row, only where it stands as whole words), the amount (as a number, any common written form; (1,200) and -1,200 read as negative) and the label are written in it; a line that fails is excluded with the reason, and a stated total that does not foot names the lines left out. The label is mapped to the chart by keywords: your category is used when it is in the chart, and an exception flags it for review when the dictionary maps the label elsewhere; an ambiguous or unknown label without a category is excluded. Vacancy, concessions, credit loss and other contra lines are always subtracted. Returns per period the sections, the computed totals (EGI, operating expenses, NOI, capital items, net cash flow; for hotels departmental profit, GOP, EBITDA and NOI after the replacement reserve), whether each total and subtotal the statement states foots (within 0.5 per line added, or your tolerance), every line with its citation (document, page, quote, span) and status, statistics (units, occupancy, ADR), and exceptions to review. Not checked: whether the agent missed lines, and meaning beyond the written amount and label.",
    input: SpreadStatementInput,
    path: "/v1/doc/spread_statement",
    run: (i: never) =>
      spreadStatement(i as z.output<typeof SpreadStatementInput>),
  },
  {
    name: "doc_check_use_conflict",
    title: "Check a proposed use against exclusives",
    description:
      "Check a proposed use (a description, plus an optional use category or 2022 NAICS code) against a center's verified lease.exclusive_use and lease.prohibited_uses facts (from doc_verify_facts or doc_abstract_lease; each must pass fact_validate). Deterministic and textual: a restriction is a potential conflict when it shares a use category with the proposed use (FactLot's published use-category vocabulary, matched on keywords, the category given and NAICS codes) or shares words with it (two or more, or every significant word of the restriction). Each hit is labelled \"potential conflict — needs human review\" and returns the controlling quote and citation, the categories and words that matched, and the exclusive's carve-outs, flagging those that mention the proposed use. FactLot does not interpret the lease, decide whether a carve-out applies, or give legal conclusions; an empty result does not mean there is no conflict. Superseded facts are ignored.",
    input: UseConflictInput,
    path: "/v1/doc/check_use_conflict",
    run: (i: never) => checkUseConflict(i as z.output<typeof UseConflictInput>),
  },
  {
    name: "doc_predicates",
    title: "Lease predicate catalog",
    description:
      "Look up the lease predicates doc_verify_facts and doc_abstract_lease know (lease.expiration_date, lease.base_rent_schedule, lease.go_dark, ...) before extracting: for each, its value shape as JSON Schema, one valid example with a quote that states it (and whether that example verifies), which parts of the value are checked against the quote and how (number, ratio, date, verbatim name, as-written words, a worded enum, a number inside free text), which count as checked only when the quote writes them out (summaries, some enums), and which always need review (true/false values and enums no wording confirms, such as a CAM cap method or a kick-out party) unless a person confirms them. Generated from the same tables the checks use. Give predicate for one, prefix (e.g. lease.renewal) for a group, or neither for all. Also returns notes on statuses, paths, human confirmation and the generic rules for any other dotted predicate. Reads no document.",
    input: DocPredicatesInput,
    path: "/v1/doc/predicates",
    run: (i: never) => docPredicates(i as z.output<typeof DocPredicatesInput>),
  },
];

const packageTools: ToolSpec[] = [
  {
    name: "fact_package_create",
    title: "Create a fact package",
    description:
      "Bundle FactLot facts (each must pass fact_validate) into a fact package a counterparty can verify: canonical JSON (RFC 8785) of every fact, an RFC 6962 Merkle tree over the facts, the source documents the facts cite with their sha256 where known, and a digest over all of it. Returns the unsigned package, its digest, and signing_message, the exact text to sign. FactLot never holds private keys: to sign, the holder signs signing_message with their own Ed25519 key on their own machine (factlot.sign_fact_package in Python, signFactPackage in @factlot/tools, or fact_package_sign in the local MCP server). Deterministic: no clock time is added (pass created_at), and the same facts always give the same digest.",
    input: FactPackageCreateInput,
    path: "/v1/facts/package",
    run: (i: never) =>
      createFactPackage(i as z.output<typeof FactPackageCreateInput>),
  },
  {
    name: "fact_package_verify",
    title: "Verify a fact package",
    description:
      "Verify a fact package from fact_package_create: recompute every fact's hash, the Merkle root and the digest from the content (any changed fact, title, date or document list shows as a mismatch); check each fact against fact_validate; check the Ed25519 signature, against the public_key you pass (base64url, the signer's key you trust) or, without one, only against the key inside the package (which proves nothing about who signed); and, given the source documents' pages, check every quote is on its cited page. Returns valid plus each check's details, checks_run and checks_not_run (what was and was not checked), and values_not_checked: the parts of extracted facts' values that their quotes do not confirm (a true/false value, an enum, a summary), which do not change valid. Not checked: that the pages you pass are the original files (pass sha256 to tie them to the file hash), or what the facts mean.",
    input: FactPackageVerifyInput,
    path: "/v1/facts/package/verify",
    async: true,
    run: (i: never) =>
      verifyFactPackage(i as z.output<typeof FactPackageVerifyInput>),
  },
];

const compTools: ToolSpec[] = [
  {
    name: "lease_comp_validate",
    title: "Validate a lease comp and derive its NER",
    description:
      "Check a lease comparable one firm shares with others, as a FactLot fact with predicate lease.comp, and derive its net effective rent. The fact goes through fact_validate (schema, citations, rights), then the comp's own rules: shape (spec/schemas/fact.json LeaseComp: area, commencement, term or expiration, starting or current rent, escalation, free rent, TI, leasing commissions, expense basis, confirming party, verification), an expiration after commencement, a term that matches the dates, free rent within the term, no email, phone or ID number in the text. A comp names no person or company. With the default share profile it also needs the deal's starting rent, escalations, free rent, TI, property type, an expense basis other than unknown, and stated rights. When valid and a starting rent is given, ner.fact is a computed lease.net_effective_rent fact (formula calc.net_effective_rent@1, straight-line and discounted at discount_rate_annual, on the comp's own expense basis; no conversion between full service and net). Returns { valid, issues, warnings, ner }. Call before sharing a comp.",
    input: LeaseCompValidateInput,
    path: "/v1/comps/validate",
    run: (i: never) =>
      validateLeaseComp(i as z.output<typeof LeaseCompValidateInput>, PRODUCER),
  },
  {
    name: "lease_comp_search",
    title: "Search GSA lease comps (federal tenant)",
    description:
      "Search the 6,994 lease comps from the U.S. General Services Administration's Lease Inventory (October 2026 file, FactLot release lease-comps-gsa-2026-11-04), bundled with FactLot: works offline and on the hosted API, no registry needed. READ THE CAVEAT: the tenant in every one of these leases is the federal government (GSA, for an agency); they are not market comps for private tenants, and the rent is the current annual rent in GSA's file divided by the rentable SF, not the starting rent (no escalations, free rent, TI or commissions are known). Filter by state, 5-digit county FIPS, city, ZIP, a radius around a latitude/longitude (GSA's own coordinates; nothing is geocoded), rentable SF, commencement date, rent per SF, property type (office, industrial, other) and expense basis; sort; limit (default 25, at most 200). Each comp gives its FactLot lease ID, GSA lease number, address, county FIPS, building ID, landlord (organisations only; individuals are never stored), rentable SF, commencement, expiration, term, early-termination date, annual rent, rent per SF per year, property type, expense basis and the row of the GSA file it comes from. summary gives the count and the median, quartiles and range of rent per SF over every match, labelled as statistics of GSA leases. Every answer carries the caveat and the citation (GSA file URL, SHA-256 document ID, as-of and retrieval dates, licence: public domain). These are statistics of GSA leases, kept apart from market comps.",
    input: LeaseCompSearchInput,
    path: "/v1/comps/search",
    run: (i: never) =>
      searchLeaseComps(i as z.output<typeof LeaseCompSearchInput>, PRODUCER),
  },
];

class NotFoundError extends Error {
  override name = "NotFoundError";
  coverage: unknown;
  constructor(message: string, coverage?: unknown) {
    super(message);
    this.coverage = coverage;
  }
}

const REGISTRY_NOTE =
  " Requires a FactLot Registry (public-record facts about commercial property, each cited to the source file and record).";
const Limit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .describe("Maximum results (1–100).");

/** The subject fields of registry_tx_equity_candidates (and of each batch subject). */
const TxEquitySubjectFields = {
  urn: z
    .string()
    .max(500)
    .optional()
    .describe(
      "FactLot parcel URN of the subject, e.g. fl:parcel:us-48201:0011440000001. Give this, or county_fips and apn.",
    ),
  state_fips: z
    .string()
    .max(16)
    .optional()
    .describe('With county_fips and apn: "48" (Texas), the only state served.'),
  county_fips: z
    .string()
    .max(16)
    .optional()
    .describe('3-digit Texas county FIPS, e.g. "201" for Harris County.'),
  apn: z
    .string()
    .max(200)
    .optional()
    .describe("Appraisal district account number as the district prints it."),
};

/** The rule parameters of registry_tx_equity_candidates, shared by every subject of a batch. */
const TxEquityParamFields = {
  area_band: z
    .number()
    .gt(0)
    .max(1)
    .default(TX_EQUITY_DEFAULTS.area_band)
    .describe(
      "Improvement area band as a share of the subject's (0.35: within ±35%).",
    ),
  year_band: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(TX_EQUITY_DEFAULTS.year_band)
    .describe(
      "Year-built band in years, applied when both the subject's and the candidate's are known.",
    ),
  min_matches: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(TX_EQUITY_DEFAULTS.min_matches)
    .describe(
      "Widen from the neighborhood and ZIP code tiers to the whole county when they hold fewer than this.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(TX_EQUITY_LIMIT_MAX)
    .default(TX_EQUITY_DEFAULTS.limit)
    .describe(
      "Maximum candidates returned (1–200; a larger value is refused). Fewer are returned when fewer meet the rule, or when the neighborhood and ZIP code tiers hold at least min_matches, because the rest of the county is then not included; a warning gives the counts.",
    ),
  tax_year: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe(
      "Roll year to compare in: the subject and every candidate are read from that year's roll files only (building class also from that year's buildings file, named in selection.building_class_sources); selection.compared_files lists the files the compared values are cited from. Default: the newest tax year whose roll gives the subject a positive value. A year whose files hold values but no category code or improvement area gives no candidates, with a warning naming the missing facts. On the hosted API, tax_year needs a Pro or Team key.",
    ),
  same_building_class: z
    .boolean()
    .default(false)
    .describe(
      "Only parcels whose building class (from the compared roll year) is exactly the subject's. Not applied, with a warning, when the subject has none. Default false: building class is not compared.",
    ),
  same_local_use_code: z
    .boolean()
    .default(false)
    .describe(
      "Only parcels whose local use code (the district's own use or class code) is exactly the subject's. Not applied, with a warning, when the subject has none or local_use_codes is given. Default false.",
    ),
  local_use_codes: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(TX_EQUITY_USE_CODES_MAX)
    .optional()
    .describe(
      "Only parcels whose local use code is one of these, compared exactly as the roll prints them (1–50 codes). Default: no use-code test.",
    ),
};

/** Most subjects in one registry_tx_equity_candidates_batch call. */
export const TX_EQUITY_BATCH_MAX_SUBJECTS = 50;

interface TxEquityCall {
  urn?: string;
  state_fips?: string;
  county_fips?: string;
  apn?: string;
  area_band: number;
  year_band: number;
  min_matches: number;
  limit: number;
  tax_year?: number;
  same_building_class?: boolean;
  same_local_use_code?: boolean;
  local_use_codes?: string[];
}

/**
 * registry_tx_equity_candidates for one subject after schema validation: the which-parcel, Texas-only
 * and withheld-county checks, then the candidates. Throws the tool's errors.
 */
function txEquityCandidatesFor(v: TxEquityCall): Record<string, unknown> {
  const byApn =
    v.state_fips !== undefined ||
    v.county_fips !== undefined ||
    v.apn !== undefined;
  if (
    (v.urn !== undefined) === byApn ||
    (byApn && (v.county_fips === undefined || v.apn === undefined))
  )
    throw new ToolInputError([{ path: "", message: TX_EQUITY_WHICH_PARCEL }]);
  let urn: string;
  if (v.urn !== undefined) {
    const { kind, parts } = parse(v.urn);
    if (kind !== "parcel")
      throw new FactLotIdError(
        `"${v.urn}" is a ${kind} URN; registry_tx_equity_candidates needs a parcel URN`,
      );
    const state = (parts[0] ?? "").slice(3, 5);
    if (state !== TEXAS_FIPS)
      throw new ToolInputError([{ path: "urn", message: texasOnly(state) }]);
    const withheld = txEquityWithheld((parts[0] ?? "").slice(5, 8));
    if (withheld)
      throw new ToolInputError([{ path: "urn", message: withheld }]);
    urn = v.urn;
  } else {
    const state = v.state_fips ?? TEXAS_FIPS;
    if (state !== TEXAS_FIPS)
      throw new ToolInputError([
        { path: "state_fips", message: texasOnly(state) },
      ]);
    const withheld = txEquityWithheld(v.county_fips!);
    if (withheld)
      throw new ToolInputError([{ path: "county_fips", message: withheld }]);
    urn = txEquitySubjectUrn(state, v.county_fips!, v.apn!);
  }
  const result = registryTxEquityCandidates(urn, {
    area_band: v.area_band,
    year_band: v.year_band,
    min_matches: v.min_matches,
    limit: v.limit,
    ...(v.tax_year === undefined ? {} : { tax_year: v.tax_year }),
    same_building_class: v.same_building_class ?? false,
    same_local_use_code: v.same_local_use_code ?? false,
    ...(v.local_use_codes === undefined
      ? {}
      : { local_use_codes: v.local_use_codes }),
  });
  if (!result) {
    const coverage = registryRecordMiss(urn);
    throw new NotFoundError(
      `no registry record for ${urn}: ${String(coverage.message)}`,
      coverage,
    );
  }
  return result;
}

const registryTools: ToolSpec[] = [
  {
    name: "registry_get",
    title: "Get a registry record",
    description:
      "Everything the FactLot Registry knows about a parcel, legal entity, or building: status, current cited facts (owner of record, situs address, property category, areas, values), ownership links, external IDs, and for a parcel the building it belongs to (condominium units roll up into one building). value_history (parcels) lists market and appraised value by tax year from every snapshot, newest first, each value cited; a tax year two snapshots value differently appears once per value. as_of gives the facts as they stood on a date. warnings flags area facts that look wrong (building area above 40 times the land area, a land area of 0); the facts themselves are as the source publishes them. A building record can carry debt.cmbs_loan facts (one per CMBS trust holding a note of its loan: balance, rate, maturity, payment status, servicer, special-servicing dates, NOI, DSCR) and an entity record can carry entity.parent facts (the SEC registrant that lists it as a subsidiary in Exhibit 21), each cited to its SEC filing. A miss says whether the county or entity registry is loaded. On the hosted API, a call without a Pro or Team key gets the current roll year only in value_history and history (the answer says so); a Pro or Team key gets every year." +
      REGISTRY_NOTE,
    input: z.object({
      urn: z
        .string()
        .max(500)
        .describe(
          "FactLot URN of a parcel, entity, or building, e.g. fl:parcel:us-48201:0011440000001 (Harris County, Texas) or fl:parcel:us-36061:1000020002 (Manhattan: a New York City borough-block-lot).",
        ),
      include_history: z
        .boolean()
        .default(false)
        .describe(
          "Also return every fact from every snapshot, superseded ones included (history lists current facts too; a source loaded once has no superseded facts).",
        ),
      as_of: IsoDate.optional().describe(
        "Date (YYYY-MM-DD): return the facts and ownership links current on that date, from the snapshots dated on or before it, instead of the latest. With include_history, history stops at that date. On the hosted API a dated lookup needs a Pro or Team key.",
      ),
    }),
    path: "/v1/registry/get",
    requires: "registry",
    run: (i: never) => {
      const { urn, include_history, as_of } = i as {
        urn: string;
        include_history: boolean;
        as_of?: string;
      };
      const record = registryGet(urn, as_of);
      if (!record) {
        const coverage = registryRecordMiss(urn);
        throw new NotFoundError(
          `no registry record for ${urn}: ${String(coverage.message)}`,
          coverage,
        );
      }
      return include_history
        ? { ...record, history: registryFacts(urn, true, as_of) }
        : record;
    },
  },
  {
    name: "registry_resolve_parcel",
    title: "Resolve a parcel in the registry",
    description:
      "Find a parcel's FactLot URN from state FIPS, county FIPS, and APN, if the registry holds it. A miss returns urn null with coverage: whether that county is loaded in this registry." +
      REGISTRY_NOTE,
    input: z.object({
      state_fips: z
        .string()
        .max(16)
        .describe(
          '2-digit state FIPS, e.g. "48" for Texas, "36" for New York.',
        ),
      county_fips: z
        .string()
        .max(16)
        .describe(
          '3-digit county FIPS, e.g. "201" for Harris County, Texas, or "061" for New York County (Manhattan).',
        ),
      apn: z
        .string()
        .max(200)
        .describe(
          "Parcel or account number as the county prints it: an appraisal district account number in Texas, a borough-block-lot (e.g. 1000020002) in New York City, an AIN in Los Angeles County, a parcel number in San Francisco, a PID in Boston, a schedule number in Denver, the CAMA link in Connecticut.",
        ),
    }),
    path: "/v1/registry/resolve_parcel",
    requires: "registry",
    run: (i: never) => {
      const v = i as { state_fips: string; county_fips: string; apn: string };
      return registryResolveParcelResult(v.state_fips, v.county_fips, v.apn);
    },
  },
  {
    name: "registry_resolve_external",
    title: "Resolve an external ID",
    description:
      'Find the FactLot URN for an ID from another system, e.g. system "sdat_account" (a Maryland SDAT account number), "hcad_account" (a Harris CAD account number), "nyc_bbl" (a New York City borough-block-lot), "la_ain" (a Los Angeles County Assessor ID number), "sf_parcel", "boston_pid", "denver_schednum" or "ct_cama_link". registry_coverage lists the systems a registry holds.' +
      REGISTRY_NOTE,
    input: z.object({
      system: z
        .string()
        .max(100)
        .describe(
          'Crosswalk system name, e.g. "sdat_account" (Maryland), "hcad_account" (Harris County, Texas) or "nyc_bbl" (New York City).',
        ),
      external_id: z.string().max(200).describe("The ID in that system."),
    }),
    path: "/v1/registry/resolve_external",
    requires: "registry",
    run: (i: never) => {
      const v = i as { system: string; external_id: string };
      return registryResolveExternalResult(v.system, v.external_id);
    },
  },
  {
    name: "registry_search_address",
    title: "Search parcels by address",
    description:
      "Find commercial parcels by situs address. Matches whole words of the street line (the part before the first comma), normalized: 'Street' = 'St', 'Northwest' = 'N.W.' = 'NW'; a suite, unit, '#' or floor is ignored. Give a house number ('1200 Main', '1200 Main St NW') or a street name with its type ('Main St'); a city or a part of a word alone matches nothing. No match returns coverage: what this registry holds." +
      REGISTRY_NOTE,
    input: z.object({
      query: z
        .string()
        .min(1)
        .max(500)
        .describe(
          "Street address, or a house number and street words, or a street name with its type.",
        ),
      limit: Limit,
    }),
    path: "/v1/registry/search_address",
    requires: "registry",
    run: (i: never) => {
      const v = i as { query: string; limit: number };
      return registrySearchAddressResult(v.query, v.limit);
    },
  },
  {
    name: "registry_search_entities",
    title: "Search legal entities by name",
    description:
      "Find registered business entities (LLCs, LPs, corporations) by name. Natural persons are not searchable." +
      REGISTRY_NOTE,
    input: z.object({
      query: z.string().min(1).max(500).describe("Entity name or part of one."),
      limit: Limit,
    }),
    path: "/v1/registry/search_entities",
    requires: "registry",
    run: (i: never) => {
      const v = i as { query: string; limit: number };
      return registrySearchEntitiesResult(v.query, v.limit);
    },
  },
  {
    name: "registry_owned_by",
    title: "Parcels owned by an entity",
    description:
      "Commercial parcels currently linked to a legal entity as owner of record (inferred links carry a confidence), each with the building it belongs to, plus a per-building summary so condominium units count once per building." +
      REGISTRY_NOTE,
    input: z.object({
      entity_urn: z
        .string()
        .max(500)
        .describe("FactLot entity URN, e.g. fl:entity:us-tx:0801111111."),
    }),
    path: "/v1/registry/owned_by",
    requires: "registry",
    run: (i: never) =>
      registryOwnedByResult((i as { entity_urn: string }).entity_urn),
  },
  {
    name: "registry_coverage",
    title: "What the registry holds",
    description:
      "The counties (with parcel and building counts), entity registries, and crosswalk systems this FactLot Registry file holds, each with its sources and as-of dates. Call it before concluding that a parcel or entity does not exist: a miss outside these regions means not loaded, not absent." +
      REGISTRY_NOTE,
    input: z.object({}),
    path: "/v1/registry/coverage",
    requires: "registry",
    run: () => registryCoverage(),
  },
  {
    name: "registry_tx_equity_candidates",
    title: "Texas unequal-appraisal candidates",
    description:
      "Candidate comparable parcels for a Texas unequal-appraisal comparison (Tax Code §41.43(b)(3)), from one tax year of the subject's appraisal district roll (the newest year whose roll gives the subject a value, or tax_year), with every field of the subject and the candidates read from that year's roll only: same county and tax year, the same state property category code, improvement area within area_band of the subject's, year built within year_band years when both are known; parcels sharing the subject's neighborhood code first (when the roll gives one), then its ZIP code, then the rest of the county if fewer than min_matches. Optional narrowing, off by default: same_building_class, same_local_use_code, local_use_codes. Each candidate and the subject carry their roll fields: id, apn (the district's account number), value and value_basis, value_per_sf (that value divided by the improvement area, to the cent: the roll's figures and one division, not an opinion of value), market and appraised value, improvement and land area, year built, state property category, local use code, neighborhood code, building class, situs address, tax year, and the citation of the value fact; the subject adds its value history by tax year. Separate land and improvement values are not returned. calc_args gives the same subject and candidates with exactly calc_tx_unequal_appraisal's input fields (tax_year, subject, comparables; id = the FactLot URN, label = the situs address, nulls left out, no adjustments): the candidate list under the default rule, not a selection by FactLot, for the caller to review and edit (remove, add or adjust comparables, each adjustment with a reason) before passing it to calc_tx_unequal_appraisal. Order of operations: registry_tx_equity_candidates, then the person's review, then calc_tx_unequal_appraisal with the reviewed calc_args, then report_create. selection echoes the rule, the effective parameters, the tax year and roll sources used, the files the compared values come from (compared_files: as-of date, and whether the file is dated before July 25 of the tax year, the certification date in Tax Code §26.01(a)), the subject's category, class, use code and area (subject_summary), each narrowing parameter and whether it was applied, how many parcels each step of the rule left (steps), the candidates counted by building class and by local use code with the subject's own beside them (class_counts, use_code_counts), and which tier each candidate came from; selection_rule restates the parameters used (tax year, category, area band and year band with their bounds, the subject summary, the narrowing applied, the step counts, counts per tier) with a notice that the list is the default rule's output (the default rule with the narrowing listed, when a narrowing was applied). Each candidate's citation.document_id names its entry in sources, which gives that snapshot's license, attribution, ai_use and redistribution: relay them with the candidate. Candidates under FactLot's default rule, a design choice, not a legal standard; a person decides which, if any, to use. For evidence calculations only: FactLot does not represent property owners, file protests, or advise whether to protest. Not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)); not legal or tax advice and not a substitute for the advice of an attorney. Never returns owner names, mailing addresses, or ownership facts: ownership is outside this comparison and is not needed for it. Texas parcels only. Tarrant County is not served by the hosted registry while the publisher's terms for AI use are unclear. On the hosted API, a call without a Pro or Team key gets the current roll year only in the subject's value_history (the answer says so); the candidates are unchanged." +
      REGISTRY_NOTE,
    input: z.object({ ...TxEquitySubjectFields, ...TxEquityParamFields }),
    path: "/v1/registry/tx_equity_candidates",
    requires: "registry",
    run: (i: never) => txEquityCandidatesFor(i as TxEquityCall),
  },
  {
    name: "registry_tx_equity_candidates_batch",
    title: "Texas unequal-appraisal candidates (batch)",
    description:
      "registry_tx_equity_candidates for many subjects in one call (1–50, e.g. a consultant's client parcels): each subject's id (your label, echoed back) and its urn, or county_fips and apn, plus the rule parameters once for every subject (area_band, year_band, min_matches, limit, tax_year, same_building_class, same_local_use_code, local_use_codes). Each entry of results is that subject's answer from registry_tx_equity_candidates (subject, candidates, calc_args, selection, selection_rule, sources, warnings) or that subject's error (error, message, issues, and coverage on a miss), so one subject outside Texas, in Tarrant County, or not in the registry does not fail the others; the Texas-only and Tarrant checks apply to each subject. The selection rule and the notice appear once at the top (rule, notice) instead of in every answer; summary counts subjects, answered and errors. Candidates per subject only: this tool never runs calc_tx_unequal_appraisal and never picks comparables; a person decides, for each subject, which candidates (if any) to use, and only those go to calc_tx_unequal_appraisal (each subject's calc_args is its candidate list in that tool's input shape, for review and editing first). Relay each candidate's source rights from that subject's sources. For evidence calculations only: FactLot does not represent property owners, file protests, or advise whether to protest. Not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)); not legal or tax advice and not a substitute for the advice of an attorney. Never returns owner names, mailing addresses, or ownership facts: ownership is outside this comparison. On the hosted API each answered subject counts as one registry lookup (a subject with an error is not counted), and this batch tool needs a Pro or Team key; registry_tx_equity_candidates, one subject per call, stays within the free daily lookups." +
      REGISTRY_NOTE,
    input: z
      .object({
        subjects: z
          .array(
            z.object({
              id: z
                .string()
                .min(1)
                .max(200)
                .describe(
                  "Your label for this subject (a client or account), echoed back with its answer. Unique within the batch.",
                ),
              ...TxEquitySubjectFields,
            }),
          )
          .min(1)
          .max(TX_EQUITY_BATCH_MAX_SUBJECTS)
          .describe(
            "The subject parcels (1–50): each one's id and its urn, or county_fips and apn (with state_fips 48, or none).",
          ),
        ...TxEquityParamFields,
      })
      .superRefine((v, ctx) => {
        const ids = new Set<string>();
        v.subjects.forEach((s, i) => {
          if (ids.has(s.id))
            ctx.addIssue({
              code: "custom",
              path: ["subjects", i, "id"],
              message: `duplicate id "${s.id}"`,
            });
          ids.add(s.id);
        });
      }),
    path: "/v1/registry/tx_equity_candidates/batch",
    requires: "registry",
    run: (i: never) => {
      const { subjects, ...params } = i as Omit<
        TxEquityCall,
        "urn" | "state_fips" | "county_fips" | "apn"
      > & {
        subjects: ({ id: string } & Pick<
          TxEquityCall,
          "urn" | "state_fips" | "county_fips" | "apn"
        >)[];
      };
      const results = subjects.map(({ id, ...subject }) => {
        let answer: Record<string, unknown>;
        try {
          answer = txEquityCandidatesFor({ ...subject, ...params });
        } catch (err) {
          // No registry is no answer for any subject: the whole call fails, as the single tool does.
          if (err instanceof RegistryUnavailableError) throw err;
          const outcome = errorOutcome(err);
          if (outcome.ok) throw err;
          return { id, error: outcome.error };
        }
        const { notice: _notice, selection, ...rest } = answer;
        const { rule: _rule, ...perSubject } = selection as Record<
          string,
          unknown
        >;
        void _notice;
        void _rule;
        return { id, ...rest, selection: perSubject };
      });
      const errors = results.filter((r) => "error" in r).length;
      return {
        results,
        summary: {
          subjects: results.length,
          answered: results.length - errors,
          errors,
        },
        rule: TX_EQUITY_RULE,
        notice: TX_EQUITY_NOTICE,
      };
    },
  },
];

/** Every FactLot tool, in a stable order. */
export const tools: readonly ToolSpec[] = [
  ...calcTools,
  ...ruleTools,
  ...idTools,
  ...docTools,
  ...packageTools,
  ...compTools,
  ...registryTools,
];

export function getTool(name: string): ToolSpec | undefined {
  return tools.find((t) => t.name === name);
}

type Checked =
  { tool: ToolSpec; data: unknown; args: unknown } | { error: ToolOutcome };

const inputFor = (c: {
  tool: ToolSpec;
  data: unknown;
  args: unknown;
}): unknown => (c.tool.rawInput ? c.args : c.data);

/**
 * Structural caps, unknown fields, whole-number percents and schema validation, in that order
 * (runTool, runToolAsync).
 */
function checkInput(name: string, args: unknown): Checked {
  const tool = getTool(name);
  if (!tool) {
    return {
      error: {
        ok: false,
        error: {
          error: "UnknownTool",
          message: `no FactLot tool named "${name}"`,
          issues: [],
        },
      },
    };
  }
  const kind =
    name.startsWith("calc_") || name.startsWith("rules_")
      ? "CalcInputError"
      : "InputError";
  // Structural caps first: an agent can send any JSON, and schema validation of a huge or
  // deeply nested value is itself the cost to avoid.
  const shape = inputShapeIssue(args ?? {});
  if (shape) {
    return {
      error: {
        ok: false,
        error: {
          error: kind,
          message: `invalid input: ${shape.path || "(root)"}: ${shape.message}`,
          issues: [shape],
        },
      },
    };
  }
  // A null for a named field is the field left out (agent frameworks send null for skipped
  // optionals); every later check, and the tool itself, sees the input without it.
  args = withoutNulls(schemaOf(tool), args ?? {});
  // Unknown fields next: validation would drop them silently, so a misspelled optional field
  // would change the answer with no sign.
  const unknown = unknownFields(schemaOf(tool), args).slice(
    0,
    INPUT_LIMITS.maxIssues,
  );
  if (unknown.length) {
    return {
      error: {
        ok: false,
        error: {
          error: kind,
          message: `invalid input: ${unknown.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
          issues: unknown,
        },
      },
    };
  }
  // Whole-number percents next: a rate above 1 (8 for 8%) or a min_dscr above 10 is a unit slip
  // that some schemas bound and some do not, so one check covers every calculator.
  if (appliesUnitPolicy(name)) {
    const slips = unitSlipIssues(args).slice(0, INPUT_LIMITS.maxIssues);
    if (slips.length)
      return {
        error: {
          ok: false,
          error: {
            error: kind,
            message: `invalid input: ${slips.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
            issues: slips,
          },
        },
      };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const all = parsed.error.issues;
    const issues = withRateHints(
      args,
      all.slice(0, INPUT_LIMITS.maxIssues).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
    const more =
      all.length > issues.length
        ? `; and ${all.length - issues.length} more`
        : "";
    return {
      error: {
        ok: false,
        error: {
          error: kind,
          message: `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}${more}`,
          issues,
        },
      },
    };
  }
  return { tool, data: parsed.data, args };
}

/** A thrown domain error as an outcome; anything else is a bug and is rethrown. */
function errorOutcome(err: unknown): ToolOutcome {
  if (err instanceof CalcInputError) {
    return {
      ok: false,
      error: {
        error: "CalcInputError",
        message: err.message,
        issues: err.issues,
      },
    };
  }
  if (err instanceof FactLotIdError) {
    return {
      ok: false,
      error: { error: "FactLotIdError", message: err.message, issues: [] },
    };
  }
  if (err instanceof RegistryUnavailableError) {
    return {
      ok: false,
      error: {
        error: "RegistryUnavailable",
        message: err.message,
        issues: [],
      },
    };
  }
  if (err instanceof ToolInputError) {
    return {
      ok: false,
      error: {
        error: "InputError",
        message: err.message,
        issues: err.issues,
      },
    };
  }
  if (err instanceof NotFoundError) {
    const error: ToolError = {
      error: "NotFound",
      message: err.message,
      issues: [],
    };
    if (err.coverage !== undefined) error.coverage = err.coverage;
    return { ok: false, error };
  }
  throw err;
}

/**
 * Validate input and run a tool. Never throws for bad input: returns errors as data agents can act
 * on. Tools marked `async` (fact_package_verify, which checks Ed25519 signatures with WebCrypto)
 * need runToolAsync; every other tool runs here.
 */
export function runTool(name: string, args: unknown): ToolOutcome {
  const c = checkInput(name, args);
  if ("error" in c) return c.error;
  if (c.tool.async)
    return {
      ok: false,
      error: {
        error: "InputError",
        message: `${name} runs asynchronously (it verifies signatures with WebCrypto); call runToolAsync`,
        issues: [],
      },
    };
  try {
    return {
      ok: true,
      result: (c.tool.run as (i: unknown) => unknown)(inputFor(c)),
    };
  } catch (err) {
    return errorOutcome(err);
  }
}

/**
 * Answers a registry tool somewhere else (the hosted API's registry service). It receives the
 * input after the checks and schema defaults, and returns the outcome runTool would return.
 */
export type RegistryRunner = (
  name: string,
  input: unknown,
) => Promise<ToolOutcome>;

let registryRunner: RegistryRunner | undefined;

/** Send registry tools to a runner instead of a local file (undefined: back to the local file). */
export function configureRegistryRunner(
  runner: RegistryRunner | undefined,
): void {
  registryRunner = runner;
}

/** Whether registry tools can answer here: a registry runner, or a registry file. */
export function registryAvailable(): boolean {
  return registryRunner !== undefined || registryPath() !== undefined;
}

/**
 * A registry service's candidate answer with `calc_args` and `selection_rule`, built here from the answer's own
 * fields when the service (a registry Worker deployed before they existed) left them out: single answers and each
 * answered subject of a batch. Answers that carry them, and every other outcome, pass through unchanged.
 */
function withCalcArgs(name: string, outcome: ToolOutcome): ToolOutcome {
  if (!outcome.ok) return outcome;
  const result = outcome.result as Record<string, unknown>;
  if (name === "registry_tx_equity_candidates")
    return { ok: true, result: withTxEquityCalcArgs(result) };
  if (
    name === "registry_tx_equity_candidates_batch" &&
    Array.isArray(result.results)
  )
    return {
      ok: true,
      result: {
        ...result,
        results: (result.results as Record<string, unknown>[]).map((r) =>
          "error" in r ? r : withTxEquityCalcArgs(r),
        ),
      },
    };
  return outcome;
}

/** runTool for every tool, including asynchronous ones. The MCP server and REST API use this. */
export async function runToolAsync(
  name: string,
  args: unknown,
): Promise<ToolOutcome> {
  const c = checkInput(name, args);
  if ("error" in c) return c.error;
  if (c.tool.requires === "registry" && registryRunner) {
    try {
      return withCalcArgs(name, await registryRunner(name, inputFor(c)));
    } catch {
      return {
        ok: false,
        error: {
          error: "RegistryUnavailable",
          message: "the registry service did not answer; retry in a moment",
          issues: [],
        },
      };
    }
  }
  try {
    return {
      ok: true,
      result: await (c.tool.run as (i: unknown) => unknown)(inputFor(c)),
    };
  } catch (err) {
    return errorOutcome(err);
  }
}

const schemaCache = new WeakMap<ToolSpec, Record<string, unknown>>();
function schemaOf(tool: ToolSpec): Record<string, unknown> {
  let s = schemaCache.get(tool);
  if (!s) schemaCache.set(tool, (s = inputJsonSchema(tool)));
  return s;
}

/** JSON Schema (draft 2020-12) of a tool's input, without the `$schema` key. */
export function inputJsonSchema(tool: ToolSpec): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
