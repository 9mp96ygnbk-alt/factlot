/**
 * The lease predicate catalog (doc_predicates): for each Ingest predicate, its value shape as JSON
 * Schema, a valid example with a quote that states it, and which parts of the value are checked
 * against the quote and how. The checks come from the same tables the verifier uses (quotes.ts
 * CONSISTENCY, STRING_FORMS, PHRASES and CLAUSES), so the catalog cannot drift from them; the
 * shapes of the non-clause predicates are written here and a test runs every example through
 * checkValue and coverage. scripts/gen-schemas.ts writes the result to spec/schemas/predicates.json,
 * which the Python SDK serves as is.
 */
import { z } from "zod";

import { ToolInputError } from "./documents.ts";
import type { Json } from "./documents.ts";
import { suggest } from "./limits.ts";
import {
  CLAUSES,
  OBJECT_FIELDS,
  PHRASES,
  PREDICATES,
  PREDICATE_PATTERN,
  STRING_FORMS,
  coverage,
  specFor,
} from "./quotes.ts";
import type { FieldTest, Kind, Spec } from "./quotes.ts";

type Schema = Record<string, unknown>;

const DATE: Schema = {
  type: "string",
  format: "date",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
  description: "YYYY-MM-DD",
};
const POSITIVE: Schema = { type: "number", exclusiveMinimum: 0 };
const FRACTION: Schema = { type: "number", exclusiveMinimum: 0, maximum: 1 };
const TEXT: Schema = { type: "string", minLength: 1 };
const object = (
  properties: Record<string, Schema>,
  required: string[] = [],
  extra: Schema = {},
): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
  ...extra,
});

/** Shapes of the predicates that are not clause objects (quotes.ts checkValue). */
const SHAPES: Readonly<Record<string, Schema>> = {
  "lease.landlord": TEXT,
  "lease.tenant": TEXT,
  "lease.commencement_date": DATE,
  "lease.expiration_date": DATE,
  "lease.rentable_area_sf": POSITIVE,
  "lease.base_rent_schedule": {
    type: "array",
    minItems: 1,
    items: object(
      { from: DATE, to: DATE, annual_rent_psf: { type: "number" } },
      ["from", "to", "annual_rent_psf"],
    ),
    description: "Rent steps in order; each step's from is not after its to.",
  },
  "lease.security_deposit": POSITIVE,
  "lease.pro_rata_share": FRACTION,
  "lease.cam_cap": object(
    {
      method: {
        enum: ["compounding_from_base", "simple_from_base", "year_over_year"],
      },
      rate: FRACTION,
    },
    ["method", "rate"],
  ),
  "lease.percentage_rent": object(
    {
      rate: FRACTION,
      breakpoint: object(
        { type: { enum: ["natural", "fixed"] }, amount: POSITIVE },
        ["type"],
        { description: "A fixed breakpoint needs a positive amount." },
      ),
      sales_exclusions: TEXT,
    },
    ["rate", "breakpoint"],
  ),
  "lease.renewal_notice_deadline": DATE,
  "lease.termination_notice_deadline": DATE,
  "lease.rent_commencement_date": DATE,
  "lease.expansion_option_deadline": DATE,
  "lease.operating_expense_base_year": {
    type: "integer",
    minimum: 1900,
    maximum: 2200,
  },
  "lease.parking": object(
    { spaces: POSITIVE, rate_monthly: { type: "number", minimum: 0 } },
    ["spaces"],
  ),
  "lease.guaranty": object(
    {
      guarantor: {
        ...TEXT,
        description:
          "The guarantor's name as written; a value that reads as a street address, postal code or PO box is refused.",
      },
      cap: POSITIVE,
    },
    ["guarantor"],
  ),
};

function fieldSchema(test: FieldTest): Schema {
  if (typeof test !== "string") return { enum: [...test] };
  return {
    text: TEXT,
    texts: { type: "array", minItems: 1, items: TEXT },
    number: { type: "number" },
    positive: POSITIVE,
    fraction: FRACTION,
    bool: { type: "boolean" },
    date: DATE,
  }[test];
}

/** A clause predicate's shape, from the same rule checkValue applies (quotes.ts CLAUSES). */
function clauseSchema(predicate: string): Schema {
  const rule = CLAUSES[predicate]!;
  if (rule.arrayOfText) return fieldSchema("texts");
  const props: Record<string, Schema> = {};
  for (const [k, t] of Object.entries({
    ...rule.required,
    ...rule.optional,
  }))
    props[k] = fieldSchema(t);
  const obj = object(props, Object.keys(rule.required ?? {}), {
    ...(rule.nonEmpty ? { minProperties: 1 } : {}),
  });
  return rule.stringOk ? { anyOf: [TEXT, obj] } : obj;
}

export function valueSchema(predicate: string): Schema {
  if (Object.hasOwn(CLAUSES, predicate)) return clauseSchema(predicate);
  if (Object.hasOwn(OBJECT_FIELDS, predicate))
    return object(
      Object.fromEntries(
        Object.entries(OBJECT_FIELDS[predicate]!).map(([k, t]) => [
          k,
          fieldSchema(t),
        ]),
      ),
      [],
      { minProperties: 1 },
    );
  return SHAPES[predicate]!;
}

/** One example per predicate: a valid value and a synthetic quote that states it. */
const EXAMPLES: Readonly<Record<string, { value: unknown; quote: string }>> = {
  "lease.landlord": {
    value: "Sample Landlord LLC",
    quote: "entered into by Sample Landlord LLC (“Landlord”)",
  },
  "lease.tenant": {
    value: "Example Tenant, Inc.",
    quote: "and Example Tenant, Inc. (“Tenant”)",
  },
  "lease.commencement_date": {
    value: "2026-07-01",
    quote: "The Commencement Date is July 1, 2026.",
  },
  "lease.expiration_date": {
    value: "2031-06-30",
    quote: "The Term shall expire on June 30, 2031.",
  },
  "lease.rentable_area_sf": {
    value: 12500,
    quote: "containing approximately 12,500 rentable square feet",
  },
  "lease.base_rent_schedule": {
    value: [
      { from: "2026-07-01", to: "2027-06-30", annual_rent_psf: 34.5 },
      { from: "2027-07-01", to: "2028-06-30", annual_rent_psf: 35.54 },
    ],
    quote:
      "July 1, 2026 to June 30, 2027: $34.50 per RSF; July 1, 2027 to June 30, 2028: $35.54 per RSF",
  },
  "lease.free_rent": {
    value: { months: 3, applies_to: "base_rent" },
    quote:
      "Base Rent shall be abated for the first three (3) months of the Term",
  },
  "lease.security_deposit": {
    value: 95000,
    quote: "a security deposit of $95,000.00",
  },
  "lease.pro_rata_share": {
    value: 0.0425,
    quote: "Tenant's Proportionate Share is 4.25%",
  },
  "lease.cam_cap": {
    value: { method: "compounding_from_base", rate: 0.05 },
    quote:
      "Controllable Operating Expenses shall not increase by more than five percent (5%) per year, on a cumulative and compounding basis",
  },
  "lease.renewal_option": {
    value: {
      count: 1,
      term_months: 60,
      notice_months: 12,
      rent: "95% of Fair Market Rent",
    },
    quote:
      "Tenant shall have one (1) option to extend the Term for sixty (60) months by notice given not less than twelve (12) months before expiration, at 95% of Fair Market Rent",
  },
  "lease.termination_option": {
    value: {
      effective_date: "2029-06-30",
      notice_months: 9,
      fee: "the unamortized leasing costs",
    },
    quote:
      "Tenant may terminate this Lease effective June 30, 2029 on nine (9) months' notice and payment of the unamortized leasing costs",
  },
  "lease.rofr": {
    value: {
      applies_to: "space",
      description: "the adjacent Suite 410",
      response_days: 10,
    },
    quote:
      "Tenant shall have a right of first refusal on the adjacent Suite 410, exercisable within ten (10) days after Landlord's notice",
  },
  "lease.rofo": {
    value: {
      applies_to: "space",
      description: "any space on the fourth floor",
      response_days: 15,
    },
    quote:
      "Landlord shall first offer to Tenant any space on the fourth floor that becomes available; Tenant shall respond within fifteen (15) days",
  },
  "lease.exclusive_use": {
    value: {
      protected_use: "the sale of coffee",
      carve_outs: ["a full-service restaurant"],
      applies_to: "the Shopping Center",
    },
    quote:
      "no other premises in the Shopping Center shall be used for the sale of coffee, except by a full-service restaurant",
  },
  "lease.assignment_sublease": {
    value: {
      consent_standard: "not_unreasonably_withheld_conditioned_or_delayed",
      profit_share: 0.5,
    },
    quote:
      "with Landlord's consent, which shall not be unreasonably withheld, conditioned or delayed; Landlord shall receive fifty percent (50%) of any transfer profit",
  },
  "lease.percentage_rent": {
    value: { rate: 0.06, breakpoint: { type: "natural" } },
    quote:
      "Percentage Rent equal to six percent (6%) of Gross Sales in excess of the natural breakpoint",
  },
  "lease.co_tenancy": {
    value: {
      trigger: "the Anchor Tenant ceases to operate",
      remedy: "pay 50% of Base Rent",
      cure_period_months: 12,
      named_tenants: ["Major Grocer"],
    },
    quote:
      "If Major Grocer, the Anchor Tenant ceases to operate in the Shopping Center, Tenant may pay 50% of Base Rent for up to twelve (12) months",
  },
  "lease.renewal_notice_deadline": {
    value: "2030-06-30",
    quote: "the exercise notice must be received no later than June 30, 2030",
  },
  "lease.termination_notice_deadline": {
    value: "2028-09-30",
    quote: "notice of termination must be given by September 30, 2028",
  },
  "lease.rent_commencement_date": {
    value: "2026-10-01",
    quote: "the Rent Commencement Date shall be October 1, 2026",
  },
  "lease.expansion_option_deadline": {
    value: "2028-12-31",
    quote: "Tenant may exercise the expansion option by December 31, 2028",
  },
  "lease.operating_expense_base_year": {
    value: 2026,
    quote: "the Base Year shall be calendar year 2026",
  },
  "lease.parking": {
    value: { spaces: 40, rate_monthly: 125 },
    quote: "forty (40) unreserved parking spaces at $125 per space per month",
  },
  "lease.guaranty": {
    value: { guarantor: "Example Parent Corp.", cap: 500000 },
    quote: "guaranteed by Example Parent Corp., up to $500,000",
  },
  "lease.prohibited_uses": {
    value: ["dry cleaner", "bowling alley"],
    quote: "the Premises shall not be used as a dry-cleaner or a bowling alley",
  },
  "lease.go_dark": {
    value: {
      operating_covenant: true,
      recapture_right: true,
      dark_period_days: 180,
    },
    quote:
      "Tenant shall continuously operate in the Premises. If Tenant ceases to operate for more than 180 days, Landlord may recapture the Premises",
  },
  "lease.radius_restriction": {
    value: { radius_miles: 3, duration: "during the Term" },
    quote:
      "Tenant shall not operate a similar store within three (3) miles of the Shopping Center during the Term",
  },
  "lease.relocation_right": {
    value: {
      notice_days: 60,
      landlord_pays_costs: true,
      replacement_premises: "substantially similar size",
    },
    quote:
      "Landlord may relocate Tenant on sixty (60) days' notice to space of substantially similar size, at Landlord's cost",
  },
  "lease.kick_out": {
    value: {
      party: "tenant",
      sales_threshold: 2000000,
      test_period: "the third Lease Year",
      notice_days: 90,
    },
    quote:
      "If Gross Sales in the third Lease Year are less than $2,000,000, Tenant may terminate this Lease on ninety (90) days' notice",
  },
};

const HOW: Readonly<Record<string, string>> = {
  number:
    "the number is written in the quote in any common form (1250000 matches $1,250,000.00, 1,250,000 or 1250000; 24.5 matches 24.50/SF; whole numbers up to ninety-nine also as words, e.g. twelve (12))",
  ratio:
    "the decimal, or its percentage when the quote has a % sign or the word percent (0.0425 matches 4.25% or 4.25 percent, not a bare 4.25)",
  date: "the calendar date is written in the quote in a common form (June 30, 2031; Jun. 30, 2031; 6/30/2031; 30 June 2031; the thirtieth day of June, 2031), not a two-digit year or a relative date",
  string:
    "written in the quote verbatim, ignoring case, whitespace and typographic quotes",
  words:
    "written in the quote as whole words, ignoring case, whitespace, punctuation and a word hyphenated at a line break; a number in it must be in the quote",
  text: "every number written in digits in it is in the quote",
  phrase: "the quote words it as phrases lists",
  derived:
    "derived from the commencement date (candidate.commencement), which is checked against its own quote",
};

const WRITTEN =
  "counts as checked only when it is written in the quote as whole words (as for words); otherwise the candidate is held in needs_review with check coverage";

interface Rule {
  path: string;
  as: string;
  how: string;
  form?: "string" | "object";
  values?: string[];
  phrases?: Record<string, readonly (readonly string[])[]>;
}

/**
 * Where each leaf of the shape is checked: always (a failure is needs_review, check
 * consistency), only when the quote writes it out, or never (needs_review, check coverage, unless
 * a person confirms it).
 */
function rules(predicate: string): {
  checked: Rule[];
  checked_if_written: Rule[];
  always_review: Rule[];
} {
  const checked: Rule[] = [];
  const ifWritten: Rule[] = [];
  const review: Rule[] = [];
  const enumValues = (schema: Schema): string[] =>
    Array.isArray(schema.enum) ? (schema.enum as string[]) : [];
  const leaf = (
    schema: Schema,
    spec: Spec | undefined,
    path: string,
    form?: "string" | "object",
  ): void => {
    const at = { path, ...(form ? { form } : {}) };
    const kind = typeof spec === "string" ? (spec as Kind) : undefined;
    const values = enumValues(schema);
    if (kind === "summary") {
      ifWritten.push({ ...at, as: "summary", how: WRITTEN });
      return;
    }
    if (kind === "text") {
      checked.push({ ...at, as: "text", how: HOW.text! });
      ifWritten.push({ ...at, as: "summary", how: WRITTEN });
      return;
    }
    if (kind === "phrase" || kind === "enum") {
      const worded = values.filter((v) => Object.hasOwn(PHRASES, v));
      const other = values.filter((v) => !Object.hasOwn(PHRASES, v));
      const phrases = Object.fromEntries(worded.map((v) => [v, PHRASES[v]!]));
      if (worded.length)
        (kind === "phrase" ? checked : ifWritten).push({
          ...at,
          as: "phrase",
          how:
            kind === "phrase"
              ? "the quote must word the value as phrases lists (every group needs one of its alternatives); otherwise needs_review with check consistency"
              : "counts as checked only when the quote words it as phrases lists; otherwise needs_review with check coverage",
          values: worded,
          phrases,
        });
      if (other.length)
        review.push({
          ...at,
          as: "enum",
          how: "an enum value no quote wording confirms: needs_review with check coverage unless a person confirms it",
          values: other,
        });
      return;
    }
    if (kind) {
      checked.push({ ...at, as: kind, how: HOW[kind]! });
      return;
    }
    if (schema.type === "boolean")
      review.push({
        ...at,
        as: "boolean",
        how: "a quote cannot prove true or false by containing words: needs_review with check coverage unless a person confirms it",
      });
    else if (values.length)
      review.push({
        ...at,
        as: "enum",
        how: "an enum value no quote wording confirms: needs_review with check coverage unless a person confirms it",
        values,
      });
    else
      review.push({
        ...at,
        as: String(schema.type ?? "value"),
        how: "no rule checks this part: needs_review with check coverage unless a person confirms it",
      });
  };
  const walk = (
    schema: Schema,
    spec: Spec | undefined,
    path: string,
    form?: "string" | "object",
  ): void => {
    if (Array.isArray(schema.anyOf)) {
      for (const branch of schema.anyOf as Schema[]) {
        const isString = branch.type === "string";
        walk(
          branch,
          isString ? STRING_FORMS[predicate] : spec,
          path,
          isString ? "string" : "object",
        );
      }
      return;
    }
    if (schema.type === "object") {
      const props = schema.properties as Record<string, Schema>;
      const sub =
        spec && typeof spec === "object" && !Array.isArray(spec)
          ? (spec as Record<string, Spec>)
          : {};
      for (const [k, s] of Object.entries(props))
        walk(s, sub[k], `${path}.${k}`, form);
      return;
    }
    if (schema.type === "array") {
      walk(
        schema.items as Schema,
        Array.isArray(spec) ? (spec[0] as Spec) : undefined,
        `${path}[]`,
        form,
      );
      return;
    }
    leaf(schema, spec, path, form);
  };
  walk(
    valueSchema(predicate),
    specFor(predicate, EXAMPLES[predicate]!.value),
    "value",
  );
  return { checked, checked_if_written: ifWritten, always_review: review };
}

/** The outcome doc_verify_facts gives the example (shape and consistency pass by construction). */
function exampleOutcome(predicate: string): Json {
  const ex = EXAMPLES[predicate]!;
  const cov = coverage(predicate, ex.value, ex.quote);
  return {
    value: ex.value,
    quote: ex.quote,
    outcome: cov.gaps.length ? "needs_review" : "verified",
    checked: cov.checked.map((c) => c.path),
    not_checked: cov.not_checked,
  };
}

const LEASE_YEAR_FORM: Json = {
  form: "lease_years",
  how: "A rent table written by lease year (Lease Years 1–5: $34.50 ...). Give steps {lease_years: [first, last], annual_rent_psf} and, on the candidate, commencement {value, quote, page}. FactLot checks each rent and each lease-year number against the table's quote and the commencement date against its own quote, then derives each step's from and to: Lease Year N runs from the (N−1)th anniversary of the commencement date to the day before the next (a February 29 commencement's anniversary in a common year is February 28). The verified fact cites both quotes, keeps lease_years on each step, names formula doc.lease_year_dates@1, and the result shows the dates under derived_from. If the commencement date is not verified, the schedule stays in needs_review (check derivation).",
  value_schema: {
    type: "array",
    minItems: 1,
    items: object(
      {
        lease_years: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "integer", minimum: 1, maximum: 99 },
          description: "[first, last] lease year of the step, in order",
        },
        annual_rent_psf: { type: "number" },
      },
      ["lease_years", "annual_rent_psf"],
    ),
  },
  checked: [
    { path: "value[].annual_rent_psf", as: "number", how: HOW.number },
    { path: "value[].lease_years[]", as: "number", how: HOW.number },
    { path: "value[].from", as: "derived", how: HOW.derived },
    { path: "value[].to", as: "derived", how: HOW.derived },
  ],
  example: {
    value: [
      { lease_years: [1, 5], annual_rent_psf: 34.5 },
      { lease_years: [6, 10], annual_rent_psf: 38 },
    ],
    quote:
      "Lease Years 1-5: $34.50 per rentable square foot per annum; Lease Years 6-10: $38.00",
    commencement: {
      value: "2026-07-01",
      quote: "The Commencement Date is July 1, 2026",
    },
  },
};

export function describePredicate(predicate: string): Json {
  const r = rules(predicate);
  return {
    predicate,
    description: PREDICATES[predicate],
    value_schema: valueSchema(predicate),
    example: exampleOutcome(predicate),
    checked: r.checked,
    checked_if_written: r.checked_if_written,
    always_review: r.always_review,
    ...(predicate === "lease.base_rent_schedule"
      ? { alternate_forms: [LEASE_YEAR_FORM] }
      : {}),
  };
}

export const PREDICATE_NOTES = {
  statuses:
    "doc_verify_facts checks a candidate's shape (value_schema; a wrong shape is rejected, check value), that its quote is on the cited page (rejected, check quote), every part under checked (a part the quote does not state is needs_review, check consistency), its confidence (below 0.8: needs_review, check confidence), and then that every other part is confirmed: a part under checked_if_written that the quote does not write out, or any part under always_review, holds the candidate in needs_review with check coverage. Verified means every part of the value was confirmed.",
  paths:
    "Paths start at value; [] stands for every item of an array. form string or object marks the two shapes of a predicate that also accepts a plain summary string.",
  confirmation:
    "A person who has read the clause can confirm the parts no quote can prove: send the candidate again with confirmation {by, at, note?}. by is the person's name or role; FactLot records it as given and does not authenticate it, so an agent must never confirm its own extraction. The fact is then verified with method human_verified, the quote-checked parts under checked and the rest under confirmed_by_person. A confirmation never overrides a quote that is not on the page, a part under checked that the quote does not state, or a low confidence.",
  generic:
    "Any other dotted lower_snake predicate (lease.notice_days, om.occupancy) is accepted with generic rules: the value must not be null or blank; every number, ratio (a number in (0, 1]) and date in it is checked against the quote, and text counts as checked only when written in the quote.",
};

/** The whole catalog, as spec/schemas/predicates.json publishes it. */
export function predicateCatalog(): Json {
  return {
    notes: PREDICATE_NOTES,
    predicates: Object.keys(PREDICATES).map(describePredicate),
  };
}

let cached: Json | undefined;
const catalog = (): Json => (cached ??= predicateCatalog());

export const DocPredicatesInput = z.object({
  predicate: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "One predicate to describe, e.g. lease.go_dark. Omit both predicate and prefix for every lease predicate.",
    ),
  prefix: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Only predicates starting with this, e.g. "lease.renewal" or "lease.". Give predicate or prefix, not both.',
    ),
});

export function docPredicates(
  input: z.output<typeof DocPredicatesInput>,
): Json {
  if (input.predicate !== undefined && input.prefix !== undefined)
    throw new ToolInputError([
      { path: "", message: "give predicate or prefix, not both" },
    ]);
  const all = catalog().predicates as Json[];
  const picked = all.filter((p) =>
    input.predicate !== undefined
      ? p.predicate === input.predicate
      : input.prefix === undefined ||
        (p.predicate as string).startsWith(input.prefix),
  );
  const out: Json = { notes: catalog().notes, predicates: picked };
  if (input.predicate !== undefined && picked.length === 0) {
    const near = suggest(input.predicate, Object.keys(PREDICATES));
    out.note = PREDICATE_PATTERN.test(input.predicate)
      ? `${input.predicate} is not an Ingest predicate${near ? ` (did you mean ${near}?)` : ""}; doc_verify_facts checks it with the generic rules in notes.generic`
      : `${input.predicate} is not a dotted lower_snake predicate${near ? ` (did you mean ${near}?)` : ""}`;
  }
  return out;
}
