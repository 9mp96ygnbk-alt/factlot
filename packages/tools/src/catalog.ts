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
import { SpreadStatementInput, spreadStatement } from "./statements.ts";
import { UseConflictInput, checkUseConflict } from "./uses.ts";

import {
  RegistryUnavailableError,
  registryCoverage,
  registryFacts,
  registryGet,
  registryOwnedByResult,
  registryRecordMiss,
  registryResolveExternalResult,
  registryResolveParcelResult,
  registrySearchAddressResult,
  registrySearchEntitiesResult,
} from "./registry.ts";
import {
  INPUT_LIMITS,
  implausibleInputWarnings,
  inputShapeIssue,
  unknownFields,
  withRateHints,
} from "./limits.ts";

export const CATALOG_VERSION = "0.2.0";

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
  description: `${c.description} Deterministic: use this instead of doing the math yourself; cite formula ${c.id}@${c.version} and the returned steps, and surface any warnings.`,
  input: c.input,
  path: `/v1/calc/${name}`,
  formula: { id: c.id, version: c.version },
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
  path: `/v1/rules/${name}`,
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
      'Check values YOU extracted from a document against its text, deterministically; FactLot runs no model. Send the pages as text and one candidate per value: {predicate, value, quote, page}. Each candidate is checked in order: (1) the value\'s shape (Ingest predicates such as lease.expiration_date YYYY-MM-DD, lease.pro_rata_share in (0, 1], ordered lease.base_rent_schedule steps; any other dotted predicate needs a non-empty value); (2) the quote, at least 12 characters, is on the cited page, where only whitespace, line breaks, letter case and typographic quotes and dashes may differ (a word hyphenated across a line must keep its hyphen; a quote found on exactly one other page is accepted with the page corrected); (3) every number, date and party name in the value is written in the quote, in any common form: 1250000 matches "$1,250,000.00", 0.03 matches "3%" or "three percent", 2031-06-30 matches "June 30, 2031" or "6/30/2031"; (4) a confidence you give below 0.8 holds it for review. Returns verified (FactLot facts: method extracted, citing document_id, page, quote and character span, plus which value parts were and were not checked), needs_review (the quote is on the page but does not state the value, or low confidence) and rejected (wrong shape; quote missing, too short, or on several pages), each with a reason to act on. Not checked: enums and free-text summaries, meaning (a quote stating the number in another context passes), and whether the pages came from the file whose sha256 you give.',
    input: VerifyFactsInput,
    path: "/v1/doc/verify_facts",
    run: (i: never) =>
      verifyFacts(i as z.output<typeof VerifyFactsInput>, PRODUCER),
  },
  {
    name: "doc_abstract_lease",
    title: "Lease abstract with amendments",
    description:
      "Current-state lease abstract from a lease and its amendments, with amendment precedence. Give each document's pages with the candidates you extracted (checked exactly as doc_verify_facts checks them), or the facts doc_verify_facts already returned for it (without pages only the value against its quote is rechecked, marked quote_on_page: false). The original applies first, then amendments by effective_date (in the order given if any is undated); a later document's value for a predicate controls, and the earlier one moves to history and is linked through supersedes. Each field gives its value, the controlling document, page, quote and fact, the superseded history, conflicts (one document stating two different values) and open_items (a candidate for that predicate in the controlling or a later document that needs review or was rejected, so the value may not be final). FactLot only orders what you extracted: it does not find terms you missed, and an amendment that changes a term without restating it (\"extended by 24 months\") needs the resulting value extracted with that sentence as its quote, which the quote check will hold for review if the date is not written there.",
    input: AbstractLeaseInput,
    path: "/v1/doc/abstract_lease",
    run: (i: never) =>
      abstractLease(i as z.output<typeof AbstractLeaseInput>, PRODUCER),
  },
  {
    name: "doc_compare",
    title: "Compare asserted values with a lease",
    description:
      "Compare values another document asserts (an estoppel, rent roll or offering memo, mapped by you to predicates) with verified lease facts from doc_abstract_lease or doc_verify_facts. Each asserted value comes back match, mismatch (with the differing fields), not_in_lease, or ambiguous_in_lease (two current lease facts disagree), with the controlling lease citation (document, page, quote). Values compare exactly as JSON: numbers by value, strings exactly (a name written differently is a mismatch), and for an object only the fields you assert. Facts another fact supersedes are ignored. The lease facts must pass fact_validate; FactLot does not re-read the lease, so pass the facts its document tools returned.",
    input: CompareInput,
    path: "/v1/doc/compare",
    run: (i: never) => compare(i as z.output<typeof CompareInput>),
  },
  {
    name: "doc_verify_claim",
    title: "Verify a claim against a document",
    description:
      "Check one claim against a document page: {predicate, value} (anything doc_verify_facts accepts) or a short claim sentence, plus the verbatim quote and page it rests on. Returns supported (the quote is on the page and every checked number, date and name in the claim is written in it), contradicted (the quote is on the page and states other numbers or dates of the same kind, listed in quote_states), or unverifiable (the quote is not on the page, nothing in the claim can be checked, or the quote states no value of that kind), with the evidence (document_id, page, quote, span) and each part checked. Textual, not semantic: for a sentence only its numbers and dates are compared, never its meaning, and a quote that mentions the right number for a different term still supports it.",
    input: VerifyClaimInput,
    path: "/v1/doc/verify_claim",
    run: (i: never) => verifyClaim(i as z.output<typeof VerifyClaimInput>),
  },
  {
    name: "doc_spread_statement",
    title: "Spread an operating statement",
    description:
      "Spread a T-12, operating statement, budget or rent roll summary YOU read, onto FactLot's published chart of accounts (multifamily, commercial, or hotel after the USALI summary), deterministically; FactLot runs no model. Send the pages as text and one line per item: {label, amount, quote, page}, optionally your category, a period column, and for a subtotal the indexes of the lines it sums; give the statement's own totals (effective_gross_income, total_operating_expenses, net_operating_income, ebitda, ...) as lines with that total as category. Each line is checked: the quote is on the page, the amount (as a number, any common written form; (1,200) and -1,200 read as negative) and the label are written in it; a line that fails is excluded with the reason. The label is mapped to the chart by keywords: your category is used when it is in the chart, and an exception flags it for review when the dictionary maps the label elsewhere; an ambiguous or unknown label without a category is excluded. Vacancy, concessions, credit loss and other contra lines are always subtracted. Returns per period the sections, the computed totals (EGI, operating expenses, NOI, capital items, net cash flow; for hotels departmental profit, GOP, EBITDA and NOI after the replacement reserve), whether each total and subtotal the statement states foots (within 0.5 per line added, or your tolerance), every line with its citation (document, page, quote, span) and status, statistics (units, occupancy, ADR), and exceptions to review. Not checked: whether the agent missed lines, and meaning beyond the written amount and label.",
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
      "Verify a fact package from fact_package_create: recompute every fact's hash, the Merkle root and the digest from the content (any changed fact, title, date or document list shows as a mismatch); check each fact against fact_validate; check the Ed25519 signature, against the public_key you pass (base64url, the signer's key you trust) or, without one, only against the key inside the package (which proves nothing about who signed); and, given the source documents' pages, check every quote is on its cited page. Returns valid plus each check's details. Not checked: that the pages you pass are the original files (pass sha256 to tie them to the file hash), or what the facts mean.",
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

const registryTools: ToolSpec[] = [
  {
    name: "registry_get",
    title: "Get a registry record",
    description:
      "Everything the FactLot Registry knows about a parcel, legal entity, or building: status, current cited facts (owner of record, situs address, property category, areas, values), ownership links, external IDs, and for a parcel the building it belongs to (condominium units roll up into one building). as_of gives the facts as they stood on a date. warnings flags area facts that look wrong (building area above 40 times the land area, a land area of 0); the facts themselves are as the source publishes them. A miss says whether the county or entity registry is loaded." +
      REGISTRY_NOTE,
    input: z.object({
      urn: z
        .string()
        .max(500)
        .describe(
          "FactLot URN of a parcel, entity, or building, e.g. fl:parcel:us-48201:0420150000012.",
        ),
      include_history: z
        .boolean()
        .default(false)
        .describe(
          "Also return every fact from every snapshot, superseded ones included (history lists current facts too; a source loaded once has no superseded facts).",
        ),
      as_of: IsoDate.optional().describe(
        "Date (YYYY-MM-DD): return the facts and ownership links current on that date, from the snapshots dated on or before it, instead of the latest. With include_history, history stops at that date.",
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
        .describe('2-digit state FIPS, e.g. "48" for Texas.'),
      county_fips: z
        .string()
        .max(16)
        .describe('3-digit county FIPS, e.g. "201" for Harris County.'),
      apn: z
        .string()
        .max(200)
        .describe("Parcel or account number as the county prints it."),
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
      'Find the FactLot URN for an ID from another system, e.g. system "tx-harris-cad-account" or "us-tx-taxpayer".' +
      REGISTRY_NOTE,
    input: z.object({
      system: z
        .string()
        .max(100)
        .describe('Crosswalk system name, e.g. "tx-harris-cad-account".'),
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

type Checked = { tool: ToolSpec; data: unknown } | { error: ToolOutcome };

/** Structural caps, unknown fields and schema validation, in that order (runTool, runToolAsync). */
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
  // Unknown fields next: validation would drop them silently, so a misspelled optional field
  // would change the answer with no sign.
  const unknown = unknownFields(schemaOf(tool), args ?? {}).slice(
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
  const parsed = tool.input.safeParse(args ?? {});
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
  return { tool, data: parsed.data };
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

function finish(name: string, args: unknown, result: unknown): ToolOutcome {
  const warnings = (result as { warnings?: unknown } | null)?.warnings;
  if (name.startsWith("calc_") && Array.isArray(warnings))
    warnings.push(...implausibleInputWarnings(args));
  return { ok: true, result };
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
    return finish(name, args, (c.tool.run as (i: unknown) => unknown)(c.data));
  } catch (err) {
    return errorOutcome(err);
  }
}

/** runTool for every tool, including asynchronous ones. The MCP server and REST API use this. */
export async function runToolAsync(
  name: string,
  args: unknown,
): Promise<ToolOutcome> {
  const c = checkInput(name, args);
  if ("error" in c) return c.error;
  try {
    return finish(
      name,
      args,
      await (c.tool.run as (i: unknown) => unknown)(c.data),
    );
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
