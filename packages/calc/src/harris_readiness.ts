/**
 * Caller-supplied format check for one Harris unequal-appraisal subject.
 *
 * Pure. No network, no database, and no valuation. A filled field means the
 * caller supplied a value in a recognized shape. It does not mean the figure
 * was read from Harris County, and it is not a county-complete extract.
 * `verified_against_publisher` is always false. The 400-day as-of line is a
 * local validation policy, not an official refresh standard.
 * See docs/registry/quality/harris-calculator-input-audit.md.
 */

const HARRIS_FIPS = "201";
const ROLL_SOURCE = "tx-harris-cad";
const ROLL_FILE = "Real_acct_owner.zip";
const BUILDINGS_SOURCE = "tx-harris-cad-buildings";
const BUILDINGS_FILE = "Real_building_land.zip";
/** Local policy only. Above 400 days is not filled. Not an HCAD refresh rule. */
const STALE_AFTER_DAYS = 400;
const MAX_VALUE_USD = 50_000_000_000;
const MAX_AREA_SF = 500_000_000;
const TAX_YEAR_MIN = 1982;
const TAX_YEAR_MAX = 2100;

const HOUSTON_CITY = /(?:^|,\s*)HOUSTON(?:\s+TX\b|\s*,|\s*$)/i;
const FIPS = /^\d{3}$/;
const SAFE_NAME = /^[a-z][a-z0-9_.]{0,80}$/;
const CLASS_ORDER: Record<string, number> = {
  invalid: 0,
  mismatched: 1,
  uncited: 2,
  stale: 3,
  missing: 4,
  refused: 5,
  limitation: 6,
};
const CARD_KEYS = new Set([
  "evaluation_date",
  "county_fips",
  "tax_year",
  "prefer",
  "facts",
  "requested",
  "owner_name",
  "owner_mailing_address",
  "owner",
]);
const FACT_KEYS = new Set([
  "predicate",
  "value",
  "unit",
  "source_id",
  "filename",
  "locator",
  "tax_year",
  "as_of",
]);
const OWNER_KEYS = ["owner_name", "owner_mailing_address", "owner"];
const SENTINEL_CODES = new Set(["", "0", "0.0", "0.00"]);
const SUPPORTED = new Set([
  "parcel.tax_year",
  "parcel.appraised_value",
  "parcel.market_value",
  "parcel.improvement_area_sf",
  "parcel.land_area_sf",
  "parcel.situs_address",
  "parcel.neighborhood_code",
  "parcel.building_class",
]);

type Issue = { class: string; code: string; field: string; message: string };
type Fact = Record<string, unknown>;
type Side = {
  status: string;
  value: number | null;
  unit: string | null;
  evidence: string;
};

const REFUSALS: Record<string, [string, string]> = {
  tax_rate: [
    "tax_rate",
    "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit for this account and tax year. A county-wide rate is not assumed. Unknown is not zero. Nothing is fetched.",
  ],
  "parcel.tax_rate": [
    "tax_rate",
    "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit for this account and tax year. A county-wide rate is not assumed. Unknown is not zero. Nothing is fetched.",
  ],
  exemption: [
    "exemption",
    'Exemption eligibility is not determined. Unknown is not "no exemption". Nothing is fetched.',
  ],
  "parcel.exemption": [
    "exemption",
    'Exemption eligibility is not determined. Unknown is not "no exemption". Nothing is fetched.',
  ],
  zoning: [
    "zoning",
    "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning in the City of Houston is not applied to every Harris municipality. Nothing is fetched.",
  ],
  "parcel.zoning": [
    "zoning",
    "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning in the City of Houston is not applied to every Harris municipality. Nothing is fetched.",
  ],
  noi: [
    "noi",
    "NOI is not on the appraisal roll and is not inferred. Nothing is fetched.",
  ],
  "parcel.noi": [
    "noi",
    "NOI is not on the appraisal roll and is not inferred. Nothing is fetched.",
  ],
  cap_rate: [
    "cap_rate",
    "A cap rate is not inferred from roll values. Nothing is fetched.",
  ],
  "parcel.cap_rate": [
    "cap_rate",
    "A cap rate is not inferred from roll values. Nothing is fetched.",
  ],
  rent: [
    "rent",
    "Rent is not on the appraisal roll and is not inferred. Nothing is fetched.",
  ],
  "parcel.rent": [
    "rent",
    "Rent is not on the appraisal roll and is not inferred. Nothing is fetched.",
  ],
  "lease.rent": [
    "rent",
    "Rent is not on the appraisal roll and is not inferred. Nothing is fetched.",
  ],
  sale_price: [
    "sale_price",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  "parcel.sale_price": [
    "sale_price",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  "transaction.sale": [
    "sale_price",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  taxable_value: [
    "taxable_value",
    "Taxable value after exemptions is not the appraised value and is not filled. Nothing is fetched.",
  ],
  "parcel.taxable_value": [
    "taxable_value",
    "Taxable value after exemptions is not the appraised value and is not filled. Nothing is fetched.",
  ],
  circuit_breaker_23_231: [
    "circuit_breaker_23_231",
    "circuit_breaker_23_231 is not set. Exemption and section 23.231 status are not accepted here. The calculator default of false is not applied, because false would mean not subject rather than unknown.",
  ],
  "parcel.circuit_breaker": [
    "circuit_breaker_23_231",
    "circuit_breaker_23_231 is not set. Exemption and section 23.231 status are not accepted here. The calculator default of false is not applied, because false would mean not subject rather than unknown.",
  ],
};

const LABEL =
  "Recognized citation labels are source_id tx-harris-cad and filename Real_acct_owner.zip. A matching label is a format check only and does not verify the figure against the publisher.";

const VALUE_DEFINITION: Record<string, string> = {
  appraised: `Caller-cited parcel.appraised_value in USD (the HCAD tot_appr_val shape). ${LABEL} Not taxable value, not a sale price, and not NOI.`,
  market: `Caller-cited parcel.market_value in USD (the HCAD tot_mkt_val shape). ${LABEL} Not an appraised value, not a sale price, and not NOI.`,
};
const AREA_DEFINITION: Record<string, string> = {
  "parcel.improvement_area_sf": `Caller-cited parcel.improvement_area_sf in square feet (the HCAD bld_ar shape). ${LABEL} Not rentable area and not a sum of building-section im_sq_ft.`,
  "parcel.land_area_sf": `Caller-cited parcel.land_area_sf in square feet. ${LABEL} The roll adapter may convert acreage when land_ar is 0; this diagnostic does not convert units and cannot tell which column was used.`,
};
const YEAR_DEFINITION = `Caller-cited parcel.tax_year (the HCAD yr shape). ${LABEL} Not the snapshot as-of date.`;
const FIPS_DEFINITION =
  "Caller county_fips matched 201 (Harris County, Texas), the appraisal district. Not a taxing unit, not a tax rate, and not a parcel fact from the roll. Not a publisher check.";
const GENERIC =
  "This diagnostic only checks the format of caller-cited Harris subject fields for calc.tx_unequal_appraisal. It does not evaluate that input, does not fetch it, and does not treat unknown as zero.";
const OWNER_MESSAGE =
  "Owner names and mailing addresses are not read and are not returned.";
const UNKNOWN_INPUT =
  "The input includes a property this diagnostic does not accept. That property was ignored and was not copied into the result.";
const UNKNOWN_FACT =
  "A fact includes a property this diagnostic does not accept. That fact was not used and was not copied into the result.";

function emptySide(): Side {
  return { status: "absent", value: null, unit: null, evidence: "none" };
}

function shell(): Record<string, unknown> {
  return {
    calculator: "calc.tx_unequal_appraisal",
    calculator_version: 1,
    not_county_complete: true,
    queryable: false,
    verified_against_publisher: false,
    publisher_content_checked: false,
    coverage_claim: "field_diagnostic_only",
    check_kind: "caller_cited_format",
    freshness_policy: "local_limit_400_days",
    freshness_is_official_standard: false,
    county_fips: null,
    jurisdiction_status: "unchecked",
    tax_year: null,
    evaluation_date: null,
    prefer: null,
    selected_value: null,
    appraised_value: emptySide(),
    market_value: emptySide(),
    filled: [],
    normalize_by_supported: [],
    issues: [],
  };
}

function addIssue(
  bucket: Issue[],
  klass: string,
  code: string,
  field: string,
  message: string,
): void {
  const item = { class: klass, code, field, message };
  if (!bucket.some((have) => JSON.stringify(have) === JSON.stringify(item)))
    bucket.push(item);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      CLASS_ORDER[a.class]! - CLASS_ORDER[b.class]! ||
      cmp(a.code, b.code) ||
      cmp(a.field, b.field) ||
      cmp(a.message, b.message),
  );
}

function leap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parseIso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return null;
  const dim = [
    31,
    leap(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day > dim[month - 1]!) return null;
  return value;
}

function utcDays(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function blank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function ownerish(predicate: unknown): boolean {
  return (
    typeof predicate === "string" &&
    (predicate.startsWith("ownership.") ||
      predicate === "owner_name" ||
      predicate === "owner_mailing_address")
  );
}

function noteOwners(raw: Fact, issues: Issue[]): void {
  if (OWNER_KEYS.some((key) => key in raw))
    addIssue(
      issues,
      "refused",
      "owner_not_returned",
      "ownership",
      OWNER_MESSAGE,
    );
  const facts = raw.facts;
  if (!Array.isArray(facts)) return;
  for (const fact of facts) {
    if (
      fact &&
      typeof fact === "object" &&
      !Array.isArray(fact) &&
      ownerish((fact as Fact).predicate)
    )
      addIssue(
        issues,
        "refused",
        "owner_not_returned",
        "ownership",
        OWNER_MESSAGE,
      );
  }
}

function refuseName(name: string, issues: Issue[]): void {
  const known = REFUSALS[name];
  if (known) {
    addIssue(issues, "refused", "unsupported", known[0], known[1]);
    return;
  }
  addIssue(issues, "refused", "unsupported", "requested", GENERIC);
}

function unitIssue(predicate: string, unit: unknown): [string, string] | null {
  if (
    predicate === "parcel.appraised_value" ||
    predicate === "parcel.market_value"
  ) {
    if (unit !== "USD")
      return [
        "unit",
        `${predicate} must use unit "USD". Other units are not converted, and a missing unit is not assumed.`,
      ];
  } else if (
    predicate === "parcel.improvement_area_sf" ||
    predicate === "parcel.land_area_sf"
  ) {
    if (unit !== "sf")
      return [
        "unit",
        `${predicate} must use unit "sf" (square feet). Acres and other units are not converted.`,
      ];
  } else if (predicate === "parcel.tax_year") {
    if (unit != null && unit !== "year")
      return ["unit", `${predicate} unit must be "year" or omitted.`];
  } else if (predicate === "parcel.building_class" && unit != null) {
    return [
      "unit",
      `${predicate} does not take a unit. A class code is not an area.`,
    ];
  } else if (
    (predicate === "parcel.situs_address" ||
      predicate === "parcel.neighborhood_code") &&
    unit != null
  ) {
    return ["unit", `${predicate} does not take a numeric unit.`];
  }
  return null;
}

function citationOk(fact: Fact): boolean {
  if (typeof fact.source_id !== "string" || fact.source_id === "") return false;
  if (typeof fact.filename !== "string" || fact.filename === "") return false;
  if (typeof fact.locator !== "string" || fact.locator.trim() === "")
    return false;
  if (!("as_of" in fact) || fact.as_of == null || fact.as_of === "")
    return false;
  if (!("tax_year" in fact) || fact.tax_year == null) return false;
  return true;
}

function pairFor(predicate: string): [string, string] {
  return predicate === "parcel.building_class"
    ? [BUILDINGS_SOURCE, BUILDINGS_FILE]
    : [ROLL_SOURCE, ROLL_FILE];
}

function screenFact(
  fact: Fact,
  predicate: string,
  requestedYear: number,
  evaluation: string,
): Issue | null {
  if (!citationOk(fact))
    return {
      class: "uncited",
      code: "uncited",
      field: predicate,
      message: `${predicate} has no complete citation. source_id, filename, locator, tax_year, and as_of are required. An uncited figure is not filled.`,
    };
  if (!isInt(fact.tax_year))
    return {
      class: "invalid",
      code: "tax_year_type",
      field: predicate,
      message: `${predicate} tax_year must be an integer. Text is not coerced.`,
    };
  const sourceId = fact.source_id;
  const filename = fact.filename;
  if (
    predicate === "parcel.improvement_area_sf" &&
    sourceId === BUILDINGS_SOURCE &&
    filename === BUILDINGS_FILE
  )
    return {
      class: "mismatched",
      code: "semantic",
      field: predicate,
      message: `${predicate} is cited with the buildings-file labels. Section im_sq_ft is not the account improvement area and is not copied into it. The label is not a publisher check.`,
    };
  if (
    predicate === "parcel.land_area_sf" &&
    sourceId === BUILDINGS_SOURCE &&
    filename === BUILDINGS_FILE
  )
    return {
      class: "mismatched",
      code: "semantic",
      field: predicate,
      message: `${predicate} is cited with the buildings-file labels. Land area is not taken from building sections. The label is not a publisher check.`,
    };
  const pair = pairFor(predicate);
  if (sourceId !== pair[0] || filename !== pair[1])
    return {
      class: "mismatched",
      code: "unrecognized_citation_label",
      field: predicate,
      message: `${predicate} source_id and filename are not the recognized citation labels for that predicate. A recognized label is still only caller-cited format and is not a publisher check.`,
    };
  const asOf = parseIso(fact.as_of);
  if (asOf == null)
    return {
      class: "invalid",
      code: "bad_as_of",
      field: predicate,
      message: `${predicate} as_of is not a real calendar date YYYY-MM-DD.`,
    };
  if (asOf > evaluation)
    return {
      class: "invalid",
      code: "future_as_of",
      field: predicate,
      message: `${predicate} as_of is after evaluation_date, so it is not usable as caller-cited evidence.`,
    };
  if (utcDays(evaluation) - utcDays(asOf) > STALE_AFTER_DAYS)
    return {
      class: "stale",
      code: "stale",
      field: predicate,
      message: `${predicate} as_of is more than 400 days before evaluation_date. The 400-day line is a local validation policy, not an official refresh standard and not a certification that a newer file is current. The fact is not filled.`,
    };
  if (fact.tax_year !== requestedYear)
    return {
      class: "mismatched",
      code: "tax_year",
      field: predicate,
      message: `${predicate} tax_year does not match the requested tax year. A different year's value is not mixed in.`,
    };
  const unit = fact.unit === "" ? null : (fact.unit ?? null);
  const unitProblem = unitIssue(predicate, unit);
  if (unitProblem)
    return {
      class: "mismatched",
      code: unitProblem[0],
      field: predicate,
      message: unitProblem[1],
    };
  return null;
}

function amountIssue(
  predicate: string,
  value: unknown,
  kind: "usd" | "sf",
): Issue | null {
  if (blank(value))
    return {
      class: "missing",
      code: "blank",
      field: predicate,
      message: `${predicate} is blank. Blank is not a value.`,
    };
  if (typeof value === "boolean" || !isNumber(value))
    return {
      class: "invalid",
      code: "wrong_type",
      field: predicate,
      message: `${predicate} must be a number. Text, booleans, and non-finite values are not coerced into a value.`,
    };
  if (value === 0)
    return {
      class: "invalid",
      code: "zero",
      field: predicate,
      message: `${predicate} is 0. Zero is not a usable value and is not treated as missing.`,
    };
  if (value < 0)
    return {
      class: "invalid",
      code: "negative",
      field: predicate,
      message: `${predicate} is negative. A negative figure is not a usable value.`,
    };
  const limit = kind === "usd" ? MAX_VALUE_USD : MAX_AREA_SF;
  if (value > limit) {
    const line =
      kind === "usd"
        ? "50000000000 USD, the registry audit's implausible-value line"
        : "500000000 sf, the registry audit's implausible-area line";
    return {
      class: "invalid",
      code: "implausible",
      field: predicate,
      message: `${predicate} exceeds ${line}. It is not filled.`,
    };
  }
  return null;
}

function cite(fact: Fact): Record<string, unknown> {
  return {
    evidence: "caller_cited_format",
    source_label_recognized: true,
    filename_label_recognized: true,
    locator_present: true,
    tax_year: fact.tax_year,
    as_of: fact.as_of,
    verified_against_publisher: false,
  };
}

function filledFact(
  field: string,
  value: unknown,
  unit: string,
  definition: string,
  fact: Fact,
  basis?: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    field,
    value,
    unit,
    definition,
    evidence: "caller_cited_format",
    verified_against_publisher: false,
    citation: cite(fact),
  };
  if (basis != null) row.basis = basis;
  return row;
}

function neighborhoodSentinel(value: unknown): boolean {
  if (blank(value)) return true;
  if (isNumber(value) && value === 0) return true;
  return typeof value === "string" && SENTINEL_CODES.has(value.trim());
}

function fipsRow(): Record<string, unknown> {
  return {
    field: "subject.county_fips",
    value: HARRIS_FIPS,
    unit: null,
    definition: FIPS_DEFINITION,
    evidence: "caller_asserted_jurisdiction",
    verified_against_publisher: false,
    citation: {
      evidence: "caller_asserted_jurisdiction",
      source_label_recognized: false,
      filename_label_recognized: false,
      locator_present: false,
      tax_year: null,
      as_of: null,
      verified_against_publisher: false,
    },
  };
}

/** Format-check one caller-supplied card for calc.tx_unequal_appraisal's subject fields. */
export function harrisReadiness(raw: unknown): Record<string, unknown> {
  const out = shell();
  const issues: Issue[] = [];
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    addIssue(
      issues,
      "invalid",
      "input",
      "input",
      "input must be an object of caller-supplied fields.",
    );
    out.issues = sortIssues(issues);
    return out;
  }
  const card = raw as Fact;
  noteOwners(card, issues);
  if (Object.keys(card).some((key) => !CARD_KEYS.has(key)))
    addIssue(issues, "invalid", "unknown_property", "input", UNKNOWN_INPUT);
  const requestedRaw: unknown = card.requested ?? [];
  let requested: unknown[];
  if (!Array.isArray(requestedRaw)) {
    addIssue(
      issues,
      "invalid",
      "requested",
      "requested",
      "requested must be a list of field names when it is present.",
    );
    requested = [];
  } else {
    requested = requestedRaw;
  }
  for (const name of requested) {
    if (typeof name === "string") refuseName(name, issues);
    else addIssue(issues, "refused", "unsupported", "requested", GENERIC);
  }
  const evaluation = parseIso(card.evaluation_date);
  if (evaluation == null) {
    addIssue(
      issues,
      "invalid",
      "evaluation_date",
      "evaluation_date",
      "evaluation_date must be a real calendar date YYYY-MM-DD. The diagnostic does not substitute today's date.",
    );
    out.issues = sortIssues(issues);
    return out;
  }
  const evaluationDate: string = evaluation;
  out.evaluation_date = evaluationDate;
  const fips = card.county_fips;
  if (typeof fips === "string" && FIPS.test(fips)) out.county_fips = fips;
  if (out.county_fips !== HARRIS_FIPS) {
    out.jurisdiction_status = "not_harris";
    addIssue(
      issues,
      "mismatched",
      "jurisdiction",
      "county_fips",
      "This diagnostic is only for Harris County, Texas (FIPS 201). It does not assess other counties, does not use their published counts, and does not acquire their data.",
    );
    out.issues = sortIssues(issues);
    return out;
  }
  out.jurisdiction_status = "harris";
  const taxYear = card.tax_year;
  if (!isInt(taxYear) || taxYear < TAX_YEAR_MIN || taxYear > TAX_YEAR_MAX) {
    addIssue(
      issues,
      "invalid",
      "tax_year",
      "tax_year",
      "tax_year must be an integer from 1982 through 2100, the range calc.tx_unequal_appraisal accepts. A numeric string is not coerced.",
    );
    out.issues = sortIssues(issues);
    return out;
  }
  const year: number = taxYear;
  out.tax_year = year;
  let prefer = "prefer" in card ? card.prefer : "appraised";
  if (prefer !== "appraised" && prefer !== "market") {
    addIssue(
      issues,
      "invalid",
      "prefer",
      "prefer",
      'prefer must be "appraised" or "market".',
    );
    prefer = null;
  }
  out.prefer = prefer;
  const factsRaw: unknown = card.facts ?? [];
  let facts: unknown[];
  if (!Array.isArray(factsRaw)) {
    addIssue(
      issues,
      "invalid",
      "facts",
      "facts",
      "facts must be a list of caller-supplied fact objects.",
    );
    facts = [];
  } else {
    facts = factsRaw;
  }
  const grouped = new Map<string, Fact[]>();
  for (const fact of facts) {
    if (fact == null || typeof fact !== "object" || Array.isArray(fact)) {
      addIssue(
        issues,
        "invalid",
        "fact_shape",
        "facts",
        "Each fact must be an object. That entry was skipped.",
      );
      continue;
    }
    const row = fact as Fact;
    if (Object.keys(row).some((key) => !FACT_KEYS.has(key))) {
      addIssue(issues, "invalid", "unknown_property", "fact", UNKNOWN_FACT);
      continue;
    }
    const predicate = row.predicate;
    if (typeof predicate !== "string" || !SAFE_NAME.test(predicate)) {
      addIssue(issues, "refused", "unsupported", "requested", GENERIC);
      continue;
    }
    if (ownerish(predicate)) continue;
    if (REFUSALS[predicate] || !SUPPORTED.has(predicate)) {
      refuseName(predicate, issues);
      continue;
    }
    const list = grouped.get(predicate) ?? [];
    list.push(row);
    grouped.set(predicate, list);
  }
  const accepted = new Map<string, Fact>();

  function take(predicate: string): Fact | null {
    const rows = grouped.get(predicate) ?? [];
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      addIssue(
        issues,
        "mismatched",
        "duplicate",
        predicate,
        `More than one ${predicate} fact was supplied. None was selected.`,
      );
      return null;
    }
    const fact = rows[0]!;
    if (
      predicate === "parcel.neighborhood_code" &&
      neighborhoodSentinel(fact.value)
    ) {
      addIssue(
        issues,
        "invalid",
        "not_a_code",
        predicate,
        "Neighborhood code 0.00 or blank is not a code. It is not stored as a neighborhood.",
      );
      return null;
    }
    if (predicate === "parcel.building_class" && isNumber(fact.value)) {
      addIssue(
        issues,
        "invalid",
        "wrong_type",
        predicate,
        "parcel.building_class must be text. A number is not improvement area and is not converted.",
      );
      return null;
    }
    const problem = screenFact(fact, predicate, year, evaluationDate);
    if (problem) {
      addIssue(
        issues,
        problem.class,
        problem.code,
        problem.field,
        problem.message,
      );
      return null;
    }
    const value = fact.value;
    if (
      predicate === "parcel.appraised_value" ||
      predicate === "parcel.market_value"
    ) {
      const amount = amountIssue(predicate, value, "usd");
      if (amount) {
        addIssue(
          issues,
          amount.class,
          amount.code,
          amount.field,
          amount.message,
        );
        return null;
      }
    } else if (
      predicate === "parcel.improvement_area_sf" ||
      predicate === "parcel.land_area_sf"
    ) {
      const amount = amountIssue(predicate, value, "sf");
      if (amount) {
        addIssue(
          issues,
          amount.class,
          amount.code,
          amount.field,
          amount.message,
        );
        return null;
      }
    } else if (predicate === "parcel.tax_year") {
      if (!isInt(value)) {
        addIssue(
          issues,
          "invalid",
          "wrong_type",
          predicate,
          `${predicate} must be an integer. Text, booleans, and non-finite values are not coerced into a value.`,
        );
        return null;
      }
      if (value !== taxYear) {
        addIssue(
          issues,
          "mismatched",
          "tax_year",
          predicate,
          `${predicate} tax_year does not match the requested tax year. A different year's value is not mixed in.`,
        );
        return null;
      }
    } else if (
      predicate === "parcel.situs_address" ||
      predicate === "parcel.neighborhood_code"
    ) {
      if (typeof value !== "string" || value.trim() === "") {
        addIssue(
          issues,
          "invalid",
          "wrong_type",
          predicate,
          `${predicate} must be text.`,
        );
        return null;
      }
    } else if (predicate === "parcel.building_class") {
      if (typeof value !== "string" || value.trim() === "") {
        addIssue(
          issues,
          "invalid",
          "blank",
          predicate,
          "parcel.building_class is blank. Blank is not a class.",
        );
        return null;
      }
    }
    return fact;
  }

  for (const predicate of [
    "parcel.tax_year",
    "parcel.appraised_value",
    "parcel.market_value",
    "parcel.improvement_area_sf",
    "parcel.land_area_sf",
    "parcel.situs_address",
    "parcel.neighborhood_code",
    "parcel.building_class",
  ]) {
    const got = take(predicate);
    if (got) accepted.set(predicate, got);
  }
  if (!grouped.has("parcel.tax_year"))
    addIssue(
      issues,
      "missing",
      "tax_year",
      "subject.tax_year",
      "parcel.tax_year is absent, so subject.tax_year is not filled. The requested tax year is not copied in as a fact.",
    );
  if (!grouped.has("parcel.improvement_area_sf"))
    addIssue(
      issues,
      "missing",
      "area",
      "subject.improvement_area_sf",
      "parcel.improvement_area_sf is absent. normalize_by improvement_area_sf is blocked. Land area is not copied into it.",
    );
  if (!grouped.has("parcel.land_area_sf"))
    addIssue(
      issues,
      "missing",
      "area",
      "subject.land_area_sf",
      "parcel.land_area_sf is absent. normalize_by land_area_sf is blocked. Improvement area is not copied into it.",
    );

  function side(predicate: string, present: boolean): Side {
    if (!grouped.has(predicate)) return emptySide();
    if (!present)
      return {
        status: "not_filled",
        value: null,
        unit: null,
        evidence: "none",
      };
    return {
      status: "caller_cited",
      value: accepted.get(predicate)!.value as number,
      unit: "USD",
      evidence: "caller_cited_format",
    };
  }
  const appraisedOk = accepted.has("parcel.appraised_value");
  const marketOk = accepted.has("parcel.market_value");
  out.appraised_value = side("parcel.appraised_value", appraisedOk);
  out.market_value = side("parcel.market_value", marketOk);
  let selectedBasis: "appraised" | "market" | null = null;
  const appraisedSide = out.appraised_value as Side;
  const marketSide = out.market_value as Side;
  if (prefer === "market" && marketOk) {
    selectedBasis = "market";
    marketSide.status = "selected";
    if (appraisedOk) appraisedSide.status = "not_used";
  } else if (prefer === "appraised" && appraisedOk) {
    selectedBasis = "appraised";
    appraisedSide.status = "selected";
    if (marketOk) marketSide.status = "not_used";
  } else if (marketOk && !appraisedOk) {
    marketSide.status = "available_not_selected";
  }
  if (selectedBasis == null) {
    addIssue(
      issues,
      "missing",
      "value",
      "subject.value",
      "subject.value is not filled. No appraised value passed the caller-cited format checks, and market value was not relabeled as appraised.",
    );
  } else {
    const fact = accepted.get(
      selectedBasis === "market"
        ? "parcel.market_value"
        : "parcel.appraised_value",
    )!;
    out.selected_value = {
      field: "subject.value",
      basis: selectedBasis,
      value: fact.value,
      unit: "USD",
      evidence: "caller_cited_format",
      selected_because:
        selectedBasis === "market"
          ? "caller_selected_market"
          : "statutory_comparison_uses_appraised",
      verified_against_publisher: false,
    };
  }
  const filled: Record<string, unknown>[] = [fipsRow()];
  const improvement = accepted.get("parcel.improvement_area_sf");
  if (improvement)
    filled.push(
      filledFact(
        "subject.improvement_area_sf",
        improvement.value,
        "sf",
        AREA_DEFINITION["parcel.improvement_area_sf"]!,
        improvement,
      ),
    );
  const land = accepted.get("parcel.land_area_sf");
  if (land)
    filled.push(
      filledFact(
        "subject.land_area_sf",
        land.value,
        "sf",
        AREA_DEFINITION["parcel.land_area_sf"]!,
        land,
      ),
    );
  const yearFact = accepted.get("parcel.tax_year");
  if (yearFact)
    filled.push(
      filledFact(
        "subject.tax_year",
        yearFact.value,
        "year",
        YEAR_DEFINITION,
        yearFact,
      ),
    );
  if (selectedBasis != null) {
    const fact = accepted.get(
      selectedBasis === "market"
        ? "parcel.market_value"
        : "parcel.appraised_value",
    )!;
    filled.push(
      filledFact(
        "subject.value",
        fact.value,
        "USD",
        VALUE_DEFINITION[selectedBasis]!,
        fact,
        selectedBasis,
      ),
    );
  }
  filled.sort((a, b) => cmp(String(a.field), String(b.field)));
  out.filled = filled;
  const supported: string[] = selectedBasis != null ? ["none"] : [];
  if (selectedBasis != null && accepted.has("parcel.improvement_area_sf"))
    supported.push("improvement_area_sf");
  if (selectedBasis != null && accepted.has("parcel.land_area_sf"))
    supported.push("land_area_sf");
  out.normalize_by_supported = supported;
  const situs = accepted.get("parcel.situs_address");
  if (situs && HOUSTON_CITY.test(String(situs.value)))
    addIssue(
      issues,
      "limitation",
      "houston_zoning",
      "zoning",
      "Situs city is Houston. The City of Houston does not use a conventional zoning ordinance. That is not a fact that this parcel is unzoned, and it does not describe other municipalities in Harris County. This diagnostic does not assign a zoning district.",
    );
  if (accepted.has("parcel.neighborhood_code"))
    addIssue(
      issues,
      "limitation",
      "neighborhood_not_subject",
      "parcel.neighborhood_code",
      "A neighborhood code passed the caller-cited format checks. It is not an unequal-appraisal subject field, it was not checked against HCAD's neighborhood list, and the code is not repeated here.",
    );
  if (accepted.has("parcel.building_class"))
    addIssue(
      issues,
      "limitation",
      "building_class_not_area",
      "parcel.building_class",
      "A building class passed the caller-cited format checks. It is not an unequal-appraisal subject field, it is not an area, and the class text is not repeated here.",
    );
  out.issues = sortIssues(issues);
  return out;
}
