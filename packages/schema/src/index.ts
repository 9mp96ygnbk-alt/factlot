/**
 * @factlot/schema — the open FactLot data model.
 *
 * A FactLot record is a *fact*: one atomic, citable claim about one subject,
 * with provenance (where it came from and how it was produced) and rights
 * (whether an AI agent may use or redistribute it). Everything else in
 * FactLot — IDs, calculators, ingestion, the hosted registry — produces or
 * consumes facts in this shape.
 */
import { z } from "zod";

/** ISO 8601 calendar date, `YYYY-MM-DD`. */
export const IsoDate = z.iso.date();
/** ISO 8601 timestamp with offset. */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Any FactLot ID in canonical URN form, e.g. `fl:parcel:us-06037:5432001012`. */
export const FactLotIdString = z
  .string()
  .regex(
    /^fl:[a-z]+:[^\s:]+(?::[^\s]+)?$/,
    "expected a FactLot URN (fl:<kind>:...)",
  );

/** True when both are valid ISO dates and `from` is after `to`. */
function datesReversed(from: unknown, to: unknown): boolean {
  return (
    IsoDate.safeParse(from).success &&
    IsoDate.safeParse(to).success &&
    (from as string) > (to as string)
  );
}

/**
 * A pointer into a source document precise enough for a human to verify.
 *
 * Every object in the model is strict: a field the schema does not define is an error, as the
 * published JSON Schema (`additionalProperties: false`) says, so a misspelled field is caught.
 */
export const SourceRef = z.strictObject({
  /** Stable document identifier (a FactLot document ID or the caller's own). */
  document_id: z.string().min(1),
  /** Where the document can be retrieved, if shareable. */
  uri: z.string().url().optional(),
  /** Human-readable title, e.g. "Third Amendment to Lease, 2021-04-02". */
  title: z.string().optional(),
  /** 1-based page number. */
  page: z.number().int().positive().optional(),
  /** Section or clause reference as written in the document, e.g. "§4.2(b)". */
  section: z.string().optional(),
  /** Verbatim supporting text. */
  quote: z.string().optional(),
  /** True when the cited page's text came from OCR of a scanned image, so a reviewer checks the scan, not a text layer. */
  ocr: z.boolean().optional(),
  /** Character offsets of `quote` within the document's extracted text. */
  span: z
    .strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .refine((s) => s.end >= s.start, {
      message: "span ends before it starts",
      path: ["end"],
    })
    .optional(),
  /** SHA-256 of the exact document bytes the fact was read from. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  retrieved_at: IsoDateTime.optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** How a fact came to be. Agents use this to decide when to escalate to a human. */
export const Method = z.enum([
  /** Read from an official public record (assessor, recorder, permit office, SOS). */
  "public_record",
  /** Extracted from a document by software (model or parser). */
  "extracted",
  /** Confirmed by a named human against the source. */
  "human_verified",
  /** Produced by a deterministic FactLot calculator from other facts. */
  "computed",
  /** Asserted by a counterparty (rent roll, OM, estoppel) and not yet verified. */
  "reported",
  /** Inferred from indirect evidence. Lowest trust. */
  "inferred",
]);
export type Method = z.infer<typeof Method>;

export const Provenance = z
  .strictObject({
    method: Method,
    sources: z.array(SourceRef),
    /** Software that produced the fact, for reproducibility. */
    producer: z
      .strictObject({ name: z.string(), version: z.string() })
      .optional(),
    /** For `computed` facts: the formula ID and version used, e.g. `calc.ner@1`. */
    formula: z.string().optional(),
    /** For `computed` facts: IDs of the input facts. */
    inputs: z.array(z.string()).optional(),
    /** Producer's calibrated probability that the value is correct, 0..1. */
    confidence: z.number().min(0).max(1).optional(),
    verified_by: z.string().optional(),
    verified_at: IsoDateTime.optional(),
  })
  .refine((p) => p.method === "computed" || p.sources.length > 0, {
    // An inferred fact cites the evidence it was inferred from.
    message: "facts other than computed must cite at least one source",
    path: ["sources"],
  })
  .refine(
    (p) =>
      p.method !== "computed" ||
      p.formula !== undefined ||
      p.sources.length > 0,
    {
      message: "a computed fact names its formula or cites a source",
      path: ["formula"],
    },
  );
export type Provenance = z.infer<typeof Provenance>;

/**
 * Machine-readable usage rights. Agents frequently hold data they are contractually
 * barred from feeding to an LLM. Every fact says so up front.
 */
export const Rights = z.strictObject({
  ai_use: z.enum(["permitted", "prohibited", "unknown"]),
  redistribution: z.enum([
    "permitted",
    "attribution_required",
    "prohibited",
    "unknown",
  ]),
  /** SPDX identifier or URL of the governing license/terms. */
  license: z.string().optional(),
  attribution: z.string().optional(),
});
export type Rights = z.infer<typeof Rights>;

/** A JSON value: what a fact's `value` may hold. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);

/**
 * One atomic claim. `predicate` is a dotted, namespaced name (see `Predicates`);
 * namespaces are open so asset-class-specific facts (e.g. `datacenter.critical_it_mw`)
 * do not need a schema change.
 */
export const Fact = z
  .strictObject({
    /** FactLot fact ID, if registered. */
    id: z.string().optional(),
    /** What the fact is about (parcel, building, space, entity, lease, ...). */
    subject: FactLotIdString,
    predicate: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
        "dotted lower_snake predicate",
      ),
    value: JsonValue,
    /** UCUM-style unit where meaningful: "USD", "USD/sf/yr", "sf", "ft", "MW". */
    unit: z.string().optional(),
    /** Date the fact was true/observed. */
    as_of: IsoDate,
    /** Effective window, for facts that change over time (rent steps, zoning). */
    valid_from: IsoDate.optional(),
    valid_to: IsoDate.optional(),
    provenance: Provenance,
    rights: Rights.optional(),
    /** Fact IDs this one replaces (e.g. an amendment superseding original lease terms). */
    supersedes: z.array(z.string()).optional(),
  })
  .refine((f) => !datesReversed(f.valid_from, f.valid_to), {
    message: "valid_to is before valid_from",
    path: ["valid_to"],
  });
export type Fact = z.infer<typeof Fact>;

/** Entity kinds FactLot identifies. */
export const EntityKind = z.enum([
  "parcel",
  "building",
  "space",
  "entity",
  "lease",
  "document",
  "loan",
]);
export type EntityKind = z.infer<typeof EntityKind>;

/** A link between two identified things, itself carrying provenance. */
export const Relationship = z
  .strictObject({
    from: FactLotIdString,
    type: z.enum([
      "located_on", // building -> parcel
      "part_of", // space -> building
      "owns", // entity -> parcel/building
      "controls", // entity -> entity (managing member, parent)
      "leases", // lease -> space
      "landlord_of", // entity -> lease
      "tenant_of", // entity -> lease
      "guarantor_of", // entity -> lease/loan
      "amends", // document -> document
      "secures", // loan -> parcel
      "lender_of", // entity -> loan
      "same_as", // crosswalk to another ID system
    ]),
    to: z.string().min(1),
    as_of: IsoDate,
    valid_from: IsoDate.optional(),
    valid_to: IsoDate.optional(),
    provenance: Provenance,
  })
  .refine((r) => !datesReversed(r.valid_from, r.valid_to), {
    message: "valid_to is before valid_from",
    path: ["valid_to"],
  });
export type Relationship = z.infer<typeof Relationship>;

/**
 * Starter predicate vocabulary. Not exhaustive and not closed — new predicates
 * are added by pull request. Keep names stable once published.
 */
export const Predicates = {
  lease: [
    "lease.commencement_date",
    "lease.expiration_date",
    "lease.rentable_area_sf",
    "lease.base_rent_schedule",
    "lease.free_rent",
    "lease.ti_allowance",
    "lease.security_deposit",
    "lease.renewal_option",
    "lease.termination_option",
    "lease.expansion_option",
    "lease.rofo",
    "lease.rofr",
    "lease.exclusive_use",
    "lease.prohibited_use",
    "lease.co_tenancy",
    "lease.radius_restriction",
    "lease.assignment_sublease",
    "lease.opex_structure",
    "lease.opex_base_year",
    "lease.cam_cap",
    "lease.pro_rata_share",
    "lease.percentage_rent",
    "lease.guaranty",
    "lease.green_lease_data_sharing",
    "lease.critical_date",
    // A lease comparable (see LeaseComp) and the net effective rent derived from one.
    "lease.comp",
    "lease.net_effective_rent",
  ],
  building: [
    "building.rentable_area_sf",
    "building.gross_floor_area_sf",
    "building.year_built",
    "building.stories",
    "building.clear_height_ft",
    "building.dock_doors",
    "building.power_amps",
    "building.power_mw",
    "building.floor_load_psf",
    "building.parking_ratio",
    "building.sprinkler_type",
    "building.construction_class",
  ],
  parcel: [
    "parcel.apn",
    "parcel.land_area_sf",
    "parcel.zoning_district",
    "parcel.assessed_value",
    "parcel.market_value",
    "parcel.tax_amount",
    "parcel.flood_zone",
    "parcel.last_sale",
    // Lot-level building facts the registry writes (the lot's buildings taken together).
    "parcel.built_far",
    "parcel.num_buildings",
    "parcel.num_floors",
    "parcel.units_residential",
    "parcel.units_total",
    "parcel.area_by_use_sf",
    "parcel.land_use_code",
    "parcel.year_altered",
    "parcel.historic_district",
    "parcel.landmark_designated",
  ],
  // Zoning as the registry writes it. `zoning.district` is the registry's name for what the
  // starter list called `parcel.zoning_district`, which the registry does not write.
  zoning: [
    "zoning.district",
    "zoning.district_description",
    "zoning.other_districts",
    "zoning.split_zone",
    "zoning.commercial_overlay",
    "zoning.special_district",
    "zoning.limited_height_district",
    "zoning.e_designation",
    "zoning.max_far_residential",
    "zoning.max_far_commercial",
    "zoning.max_far_facility",
    "zoning.max_far_manufacturing",
    "zoning.max_far_affordable_residential",
    "zoning.max_far_nonresidential",
    "zoning.max_height_ft",
  ],
  // Building energy benchmarking disclosures (NYC Local Law 84, DC): the newest usable report of the property.
  energy: [
    "energy.reporting_year",
    "energy.property_type",
    "energy.site_eui",
    "energy.weather_normalized_site_eui",
    "energy.source_eui",
    "energy.energy_star_score",
    "energy.ghg_emissions",
    "energy.ghg_intensity",
    "energy.floor_area_sf",
    "energy.property_lot_count",
  ],
  // One fact per sale or recorded deed; a parcel may hold many (see MULTI_VALUED_PREDICATES in @factlot/tools).
  transaction: ["transaction.sale", "transaction.deed"],
  ownership: [
    "ownership.owner_of_record",
    "ownership.beneficial_owner",
    "ownership.deed",
  ],
  debt: [
    "debt.lender",
    "debt.original_balance",
    "debt.maturity_date",
    "debt.rate",
    "debt.special_servicing",
    // One fact per CMBS trust's participation in a building's loan (a structured value; SEC Form
    // ABS-EE). A building may hold several: see MULTI_VALUED_PREDICATES in @factlot/tools.
    "debt.cmbs_loan",
    // Recorded mortgages and satisfactions as the registry writes them (many per parcel, organisations only).
    "debt.mortgage_recorded",
    "debt.mortgage_satisfaction_recorded",
  ],
  // The registrant that lists an entity as a subsidiary in Exhibit 21 of its 10-K (inferred).
  entity: ["entity.parent"],
} as const;

/** What a lease comp is: how the deal came about. */
export const CompType = z.enum([
  "new",
  "renewal",
  "extension",
  "expansion",
  "sublease",
  "amendment",
  "holdover",
  "other",
]);
export const PropertyType = z.enum([
  "office",
  "industrial",
  "retail",
  "medical_office",
  "flex",
  "mixed_use",
  "datacenter",
  "self_storage",
  "hotel",
  "multifamily",
  "land",
  "other",
]);
/** Who the tenant is by type only: a comp never names a party. */
export const TenantType = z.enum([
  "government_federal",
  "government_state_local",
  "corporate",
  "professional_services",
  "medical",
  "retail_national",
  "retail_local",
  "nonprofit",
  "other",
  "unknown",
]);
export const ExpenseBasis = z.enum([
  "full_service",
  "modified_gross",
  "industrial_gross",
  "base_year",
  "nnn",
  "absolute_net",
  "ground",
  "not_full_service",
  "unknown",
]);
export const ConfirmingParty = z.enum([
  "landlord",
  "tenant",
  "landlord_broker",
  "tenant_broker",
  "both_parties",
  "public_record",
  "appraiser",
  "lender",
  "other",
]);
export const CompVerification = z.enum([
  "unverified",
  "party_confirmed",
  "document_verified",
  "public_record",
]);

/**
 * The value of a `lease.comp` fact: one lease comparable, shareable without a central database.
 *
 * A comp names no person or company. It carries economics (rent, escalations, concessions, term,
 * area, expense basis), who confirmed it and how well, and optionally the building (an `fl:building:`
 * ID, which anyone can compute from the address). Its rights (`ai_use`, `redistribution`) are the
 * enclosing fact's `rights`. Cross-field rules (a term, an expiration after commencement, free rent
 * within the term, no contact details in the text) are checked by `lease_comp_validate`.
 */
export const LeaseComp = z.strictObject({
  comp_type: CompType,
  property_type: PropertyType.optional(),
  tenant_type: TenantType.optional(),
  /** Area leased, square feet, on the basis in `area_basis`. */
  area_sf: z.number().positive(),
  area_basis: z.enum(["rentable", "usable", "gross", "unknown"]).optional(),
  /** Lease commencement (the date rent begins unless the lease says otherwise). */
  commencement_date: IsoDate,
  expiration_date: IsoDate.optional(),
  /** Term in months; given, or implied by the two dates. */
  term_months: z.number().int().positive().max(1200).optional(),
  /** First date the tenant may terminate early, if the lease allows it. */
  early_termination_date: IsoDate.optional(),
  /** First-year base rent of the deal, USD per SF per year (annual, not monthly). */
  starting_rent_psf_yr: z.number().nonnegative().optional(),
  /** Rent being paid now (an observed rent, e.g. from a public inventory); not a deal's starting rent. */
  current_rent_psf_yr: z.number().nonnegative().optional(),
  escalation: z
    .strictObject({
      type: z.enum(["none", "percent", "fixed_psf"]),
      /** Percent bumps as a decimal (0.03 = 3%), compounding. */
      rate: z.number().gt(-1).lt(10).optional(),
      /** Fixed bump, USD per SF per year, added at each step. */
      amount: z.number().optional(),
      every_months: z.number().int().positive().optional(),
    })
    .optional(),
  /** Months of fully abated base rent at the start of the term. */
  free_rent_months: z.number().int().nonnegative().optional(),
  free_rent_applies_to: z.enum(["base_rent", "gross_rent"]).optional(),
  /** Landlord-funded improvement allowance, USD per SF, once. */
  ti_allowance_psf: z.number().nonnegative().optional(),
  /** Total leasing commissions the landlord pays, USD. */
  leasing_commissions_usd: z.number().nonnegative().optional(),
  other_concessions_usd: z.number().nonnegative().optional(),
  expense_basis: ExpenseBasis.optional(),
  /** Operating expenses the tenant pays on top of rent, USD per SF per year (NNN and similar). */
  opex_psf_yr: z.number().nonnegative().optional(),
  renewal_options: z
    .strictObject({
      count: z.number().int().nonnegative(),
      term_months: z.number().int().positive().optional(),
    })
    .optional(),
  /** `fl:building:` ID of the building, if the contributor chooses to say where. */
  building: z
    .string()
    .regex(/^fl:building:[^\s]+$/, "expected a FactLot building URN")
    .optional(),
  submarket: z.string().max(120).optional(),
  /** Two-letter US state or territory code. */
  state: z
    .string()
    .regex(/^[A-Z]{2}$/, "expected a two-letter state code")
    .optional(),
  /** Who vouches for the numbers. */
  confirming_party: ConfirmingParty,
  verification: CompVerification,
  /** Caveats a reader needs (what the numbers are and are not). No names or contact details. */
  notes: z.string().max(1000).optional(),
});
export type LeaseComp = z.infer<typeof LeaseComp>;

/** All schemas, keyed by name, for JSON Schema export. */
export const schemas = {
  SourceRef,
  Provenance,
  Rights,
  Fact,
  Relationship,
  LeaseComp,
} as const;

/** JSON Schema (draft 2020-12) for each FactLot schema, for non-TypeScript agents. */
export function jsonSchemas(): Record<keyof typeof schemas, unknown> {
  const out = {} as Record<keyof typeof schemas, unknown>;
  for (const [name, schema] of Object.entries(schemas)) {
    out[name as keyof typeof schemas] = z.toJSONSchema(schema, {
      unrepresentable: "any",
    });
  }
  return out;
}
