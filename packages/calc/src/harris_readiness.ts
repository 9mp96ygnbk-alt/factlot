/**
 * Caller-supplied readiness for one Harris unequal-appraisal subject.
 *
 * Pure. No network, no database, and no valuation. A filled field is a cited
 * roll figure the caller already holds. It is not a county-complete extract and
 * not a hosted lookup. See docs/registry/quality/harris-calculator-input-audit.md.
 */

export const CALCULATOR = "calc.tx_unequal_appraisal";
export const CALCULATOR_VERSION = 1;
const HARRIS_FIPS = "201";
const ROLL_SOURCE = "tx-harris-cad";
const ROLL_FILE = "Real_acct_owner.zip";
const BUILDINGS_SOURCE = "tx-harris-cad-buildings";
const BUILDINGS_FILE = "Real_building_land.zip";
/** Same age line the registry audit warns on. Above 400 days is not filled. */
const STALE_AFTER_DAYS = 400;
const MAX_VALUE_USD = 50_000_000_000;
const MAX_AREA_SF = 500_000_000;
const TAX_YEAR_MIN = 1982;
const TAX_YEAR_MAX = 2100;
const AUDIT_FILE = "docs/registry/quality/audit-2026-11-03/after-texas.json";

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
type Side = { status: string; value: number | null; unit: string | null };
type Row = {
  status: string;
  source_id: string;
  as_of: string;
  license_reviewed: string;
  redistribution: string;
  fields: Record<string, { present: number; missing: number }>;
  blockers: string[];
};

const REFUSALS: Record<string, [string, string]> = {
  tax_rate: [
    "tax_rate",
    "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit for this account and tax year. A county-wide rate is not assumed. Unknown is not zero.",
  ],
  "parcel.tax_rate": [
    "tax_rate",
    "No tax rate is evaluated. A rate would have to be the adopted rate of each taxing unit for this account and tax year. A county-wide rate is not assumed. Unknown is not zero.",
  ],
  exemption: [
    "exemption",
    'Exemption eligibility is not determined. Unknown is not "no exemption".',
  ],
  "parcel.exemption": [
    "exemption",
    'Exemption eligibility is not determined. Unknown is not "no exemption".',
  ],
  zoning: [
    "zoning",
    "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning in the City of Houston is not applied to every Harris municipality.",
  ],
  "parcel.zoning": [
    "zoning",
    "Zoning is not mapped. Unknown is not unrestricted, and the lack of conventional zoning in the City of Houston is not applied to every Harris municipality.",
  ],
  noi: ["noi", "NOI is not on the appraisal roll and is not inferred."],
  "parcel.noi": [
    "noi",
    "NOI is not on the appraisal roll and is not inferred.",
  ],
  cap_rate: ["cap_rate", "A cap rate is not inferred from roll values."],
  "parcel.cap_rate": [
    "cap_rate",
    "A cap rate is not inferred from roll values.",
  ],
  rent: ["rent", "Rent is not on the appraisal roll and is not inferred."],
  "parcel.rent": [
    "rent",
    "Rent is not on the appraisal roll and is not inferred.",
  ],
  "lease.rent": [
    "rent",
    "Rent is not on the appraisal roll and is not inferred.",
  ],
  sale_price: [
    "sale_price",
    "No sale price is read. Roll market value is not a sale.",
  ],
  "parcel.sale_price": [
    "sale_price",
    "No sale price is read. Roll market value is not a sale.",
  ],
  "transaction.sale": [
    "sale_price",
    "No sale price is read. Roll market value is not a sale.",
  ],
  taxable_value: [
    "taxable_value",
    "Taxable value after exemptions is not the appraised value and is not filled.",
  ],
  "parcel.taxable_value": [
    "taxable_value",
    "Taxable value after exemptions is not the appraised value and is not filled.",
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

const VALUE_DEFINITION: Record<string, string> = {
  appraised:
    "Roll appraised value (HCAD tot_appr_val as parcel.appraised_value), USD. Not taxable value, not a sale price, and not NOI.",
  market:
    "Roll market value (HCAD tot_mkt_val as parcel.market_value), USD. Not an appraised value, not a sale price, and not NOI.",
};
const AREA_DEFINITION: Record<string, string> = {
  "parcel.improvement_area_sf":
    "Account improvement area (HCAD bld_ar as parcel.improvement_area_sf), square feet. Not rentable area and not a sum of building-section im_sq_ft.",
  "parcel.land_area_sf":
    "Account land area in square feet as stored (parcel.land_area_sf). The roll adapter may have converted acreage when land_ar was 0. This diagnostic does not convert units and cannot tell which column was used.",
};

const FIGURES =
  "Figures are copied from docs/registry/quality/audit-2026-11-03/after-texas.json. This function does not remeasure them and does not download anything.";
const NOT_COMPLETE =
  "Not county-complete. The counts are the commercial extract in that audit (state categories B, F1, and F2), not every account in the county.";
const NOT_QUERY =
  "Not queryable. Hosted lookup is not opened by this diagnostic.";
const REDIST = "Redistribution is unknown and is not treated as granted.";
const OUTSIDE =
  "Tax rates, exemptions, taxable value, sales, rent, NOI, cap rates, and zoning are outside this diagnostic. Unknown is not zero.";
const ATTEST_OK =
  "Caller attestation matches those published figures. parcel_count and audit_violations were ignored. Neither a parcel count nor zero audit violations certifies the county.";
const ATTEST_BAD =
  "Caller attestation does not match the published audit. The caller's figures were not adopted.";
const GENERIC =
  "This diagnostic only checks cited Harris subject fields for calc.tx_unequal_appraisal. It does not evaluate that input, and unknown is not zero.";

const PUBLISHED: Record<string, Row> = {
  "201": {
    status: "cited_subject_fields_only",
    source_id: ROLL_SOURCE,
    as_of: "2026-11-01",
    license_reviewed: "2026-11-02",
    redistribution: "unknown",
    fields: {
      "parcel.appraised_value": { present: 87462, missing: 255 },
      "parcel.improvement_area_sf": { present: 75796, missing: 11921 },
      "parcel.market_value": { present: 87462, missing: 255 },
      "parcel.tax_year": { present: 87717, missing: 0 },
    },
    blockers: [
      FIGURES,
      NOT_COMPLETE,
      NOT_QUERY,
      REDIST,
      OUTSIDE,
      "parcel.appraised_value is missing on 255 accounts in the published audit. Market value is not a substitute.",
      "parcel.improvement_area_sf is missing on 11921 accounts in the published audit. Those accounts cannot be normalized by improvement area.",
    ],
  },
  "453": {
    status: "cited_subject_fields_only",
    source_id: "tx-travis-cad",
    as_of: "2026-10-06",
    license_reviewed: "2026-11-02",
    redistribution: "unknown",
    fields: {
      "parcel.appraised_value": { present: 30555, missing: 0 },
      "parcel.improvement_area_sf": { present: 29150, missing: 1405 },
      "parcel.market_value": { present: 30555, missing: 0 },
      "parcel.tax_year": { present: 30555, missing: 0 },
    },
    blockers: [
      FIGURES,
      NOT_COMPLETE,
      NOT_QUERY,
      REDIST,
      OUTSIDE,
      "The current snapshot in that audit is as_of 2026-10-06. An older 2026-07-18 snapshot is in the same file and is not the figure used here.",
      "parcel.improvement_area_sf is missing on 1405 accounts in the current extract.",
    ],
  },
  "085": {
    status: "cited_subject_fields_only",
    source_id: "tx-collin-cad",
    as_of: "2026-11-02",
    license_reviewed: "2026-11-02",
    redistribution: "unknown",
    fields: {
      "parcel.appraised_value": { present: 17795, missing: 240 },
      "parcel.improvement_area_sf": { present: 17125, missing: 910 },
      "parcel.market_value": { present: 17795, missing: 240 },
      "parcel.tax_year": { present: 17795, missing: 240 },
    },
    blockers: [
      FIGURES,
      NOT_COMPLETE,
      NOT_QUERY,
      REDIST,
      OUTSIDE,
      "parcel.tax_year is missing on 240 accounts in the published audit. Those accounts must not be given a guessed tax year.",
      "parcel.appraised_value is missing on 240 accounts in the published audit. Market value is not a substitute.",
      "parcel.improvement_area_sf is missing on 910 accounts in the published audit.",
    ],
  },
  "113": {
    status: "not_ready",
    source_id: "tx-dallas-cad",
    as_of: "2026-10-12",
    license_reviewed: "2026-11-02",
    redistribution: "unknown",
    fields: {
      "parcel.appraised_value": { present: 0, missing: 59645 },
      "parcel.improvement_area_sf": { present: 59292, missing: 353 },
      "parcel.market_value": { present: 59645, missing: 0 },
      "parcel.tax_year": { present: 59645, missing: 0 },
    },
    blockers: [
      FIGURES,
      "Not ready for the appraised-value subject. parcel.appraised_value is present on 0 accounts and missing on 59645 in the published audit.",
      "parcel.market_value is present on 59645 accounts. It is not relabeled as appraised value.",
      "Not queryable and not county-complete. This diagnostic does not download Dallas.",
    ],
  },
  "439": {
    status: "not_ready",
    source_id: "tx-tarrant-ad",
    as_of: "2026-11-02",
    license_reviewed: "2026-11-02",
    redistribution: "unknown",
    fields: {
      "parcel.appraised_value": { present: 44934, missing: 1042 },
      "parcel.improvement_area_sf": { present: 39635, missing: 6341 },
      "parcel.market_value": { present: 44934, missing: 1042 },
      "parcel.tax_year": { present: 45976, missing: 0 },
    },
    blockers: [
      FIGURES,
      "Not ready. Tarrant Appraisal District data is not served to agents until that district's published signals allow it. Field counts do not lift the hold.",
      "Not queryable and not county-complete. This diagnostic does not download Tarrant.",
    ],
  },
};

function emptySide(): Side {
  return { status: "absent", value: null, unit: null };
}

function shell(): Record<string, unknown> {
  return {
    calculator: CALCULATOR,
    calculator_version: CALCULATOR_VERSION,
    not_county_complete: true,
    queryable: false,
    verified_against_publisher: false,
    coverage_claim: "field_diagnostic_only",
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
      "Owner names and mailing addresses are not read and are not returned.",
    );
  const facts = raw.facts;
  if (!Array.isArray(facts)) return;
  for (const fact of facts) {
    if (fact && typeof fact === "object" && ownerish((fact as Fact).predicate))
      addIssue(
        issues,
        "refused",
        "owner_not_returned",
        "ownership",
        "Owner names and mailing addresses are not read and are not returned.",
      );
  }
}

function refuseName(name: string, issues: Issue[]): void {
  const known = REFUSALS[name];
  if (known) {
    addIssue(issues, "refused", "unsupported", known[0], known[1]);
    return;
  }
  addIssue(
    issues,
    "refused",
    "unsupported",
    SAFE_NAME.test(name) ? name : "fact",
    GENERIC,
  );
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

function screenFact(
  fact: Fact,
  predicate: string,
  requestedYear: number,
  evaluation: string,
  pair: [string, string],
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
      message: `${predicate} is cited to the buildings file. Section im_sq_ft is not the account improvement area and is not copied into it.`,
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
      message: `${predicate} is cited to the buildings file. Land area is not taken from building sections.`,
    };
  if (sourceId !== pair[0] || filename !== pair[1])
    return {
      class: "mismatched",
      code: "untrusted_source",
      field: predicate,
      message: `${predicate} does not cite the known Harris source and filename for this predicate. Other metadata is not treated as verified evidence.`,
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
      message: `${predicate} as_of is after evaluation_date, so it is not usable evidence.`,
    };
  if (utcDays(evaluation) - utcDays(asOf) > STALE_AFTER_DAYS)
    return {
      class: "stale",
      code: "stale",
      field: predicate,
      message: `${predicate} as_of is more than 400 days before evaluation_date. The registry audit warns above 400 days. A stale fact is not filled.`,
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
      message: `${predicate} must be a number. Text and booleans are not coerced into a value.`,
    };
  if (value === 0)
    return {
      class: "invalid",
      code: "zero",
      field: predicate,
      message: `${predicate} is 0. Zero is not a usable value.`,
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

function pairFor(predicate: string): [string, string] {
  return predicate === "parcel.building_class"
    ? [BUILDINGS_SOURCE, BUILDINGS_FILE]
    : [ROLL_SOURCE, ROLL_FILE];
}

function cite(fact: Fact): Record<string, unknown> {
  return {
    source_id: fact.source_id,
    filename: fact.filename,
    locator: fact.locator,
    tax_year: fact.tax_year,
    as_of: fact.as_of,
    verified_against_publisher: false,
  };
}

function neighborhoodSentinel(value: unknown): boolean {
  if (blank(value)) return true;
  if (isNumber(value) && value === 0) return true;
  return typeof value === "string" && SENTINEL_CODES.has(value.trim());
}

/** Diagnose one caller-supplied card for calc.tx_unequal_appraisal's subject fields. */
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
  let requested = card.requested ?? [];
  if (!Array.isArray(requested)) {
    addIssue(
      issues,
      "invalid",
      "requested",
      "requested",
      "requested must be a list of field names when it is present.",
    );
    requested = [];
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
  out.evaluation_date = card.evaluation_date;
  const fips = card.county_fips;
  if (typeof fips === "string" && FIPS.test(fips)) out.county_fips = fips;
  if (out.county_fips !== HARRIS_FIPS) {
    out.jurisdiction_status = "not_harris";
    addIssue(
      issues,
      "mismatched",
      "jurisdiction",
      "county_fips",
      "This diagnostic is only for Harris County, Texas (FIPS 201). It does not assess other counties and does not acquire their data.",
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
      "tax_year must be an integer from 1982 through 2100, the range calc.tx_unequal_appraisal accepts.",
    );
    out.issues = sortIssues(issues);
    return out;
  }
  out.tax_year = taxYear;
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
  let facts = card.facts ?? [];
  if (!Array.isArray(facts)) {
    addIssue(
      issues,
      "invalid",
      "facts",
      "facts",
      "facts must be a list of caller-supplied fact objects.",
    );
    facts = [];
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
    const predicate = row.predicate;
    if (typeof predicate !== "string" || !SAFE_NAME.test(predicate)) {
      addIssue(issues, "refused", "unsupported", "fact", GENERIC);
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
    const problem = screenFact(
      fact,
      predicate,
      taxYear as number,
      evaluation,
      pairFor(predicate),
    );
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
          `${predicate} must be an integer. Text and booleans are not coerced into a value.`,
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
    } else if (predicate === "parcel.situs_address") {
      if (typeof value !== "string" || value.trim() === "") {
        addIssue(
          issues,
          "invalid",
          "wrong_type",
          predicate,
          "parcel.situs_address must be text.",
        );
        return null;
      }
    } else if (predicate === "parcel.neighborhood_code") {
      if (typeof value !== "string" || value.trim() === "") {
        addIssue(
          issues,
          "invalid",
          "wrong_type",
          predicate,
          "parcel.neighborhood_code must be text.",
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
    if (!present) return { status: "not_filled", value: null, unit: null };
    return {
      status: "usable",
      value: accepted.get(predicate)!.value as number,
      unit: "USD",
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
      "subject.value is not filled. No appraised value was usable, and market value was not relabeled as appraised.",
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
      selected_because:
        selectedBasis === "market"
          ? "caller_selected_market"
          : "statutory_comparison_uses_appraised",
    };
  }
  const filled: Record<string, unknown>[] = [
    {
      field: "subject.county_fips",
      value: HARRIS_FIPS,
      unit: null,
      definition:
        "Caller county_fips matched 201 (Harris County, Texas), the appraisal district. Not a taxing unit, not a tax rate, and not a parcel fact from the roll.",
      citation: {
        source_id: null,
        filename: null,
        locator: null,
        tax_year: null,
        as_of: null,
        verified_against_publisher: false,
      },
    },
  ];
  const improvement = accepted.get("parcel.improvement_area_sf");
  if (improvement)
    filled.push({
      field: "subject.improvement_area_sf",
      value: improvement.value,
      unit: "sf",
      definition: AREA_DEFINITION["parcel.improvement_area_sf"],
      citation: cite(improvement),
    });
  const land = accepted.get("parcel.land_area_sf");
  if (land)
    filled.push({
      field: "subject.land_area_sf",
      value: land.value,
      unit: "sf",
      definition: AREA_DEFINITION["parcel.land_area_sf"],
      citation: cite(land),
    });
  const yearFact = accepted.get("parcel.tax_year");
  if (yearFact)
    filled.push({
      field: "subject.tax_year",
      value: yearFact.value,
      unit: "year",
      definition:
        "Tax year of the roll values (HCAD yr as parcel.tax_year). Not the snapshot as-of date.",
      citation: cite(yearFact),
    });
  if (selectedBasis != null) {
    const fact = accepted.get(
      selectedBasis === "market"
        ? "parcel.market_value"
        : "parcel.appraised_value",
    )!;
    filled.push({
      field: "subject.value",
      value: fact.value,
      unit: "USD",
      basis: selectedBasis,
      definition: VALUE_DEFINITION[selectedBasis],
      citation: cite(fact),
    });
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
      "A neighborhood code is not an unequal-appraisal subject field and was not checked against HCAD's neighborhood list.",
    );
  if (accepted.has("parcel.building_class"))
    addIssue(
      issues,
      "limitation",
      "building_class_not_area",
      "parcel.building_class",
      "Building class is not an unequal-appraisal subject field and is not an area.",
    );
  out.issues = sortIssues(issues);
  return out;
}

function sourceBlock(row: Row | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    source_id: row.source_id,
    as_of: row.as_of,
    audit_file: AUDIT_FILE,
    license_reviewed: row.license_reviewed,
    redistribution: row.redistribution,
  };
}

function attestationMatches(row: Row, attestation: unknown): boolean {
  if (
    attestation == null ||
    typeof attestation !== "object" ||
    Array.isArray(attestation)
  )
    return false;
  const got = attestation as Fact;
  if (got.source_id !== row.source_id || got.as_of !== row.as_of) return false;
  if (got.queryable !== false) return false;
  const fields = got.fields;
  if (fields == null || typeof fields !== "object" || Array.isArray(fields))
    return false;
  const gotFields = fields as Record<string, Fact>;
  const expectedNames = Object.keys(row.fields).sort();
  const gotNames = Object.keys(gotFields).sort();
  if (expectedNames.join() !== gotNames.join()) return false;
  for (const name of expectedNames) {
    const item = gotFields[name];
    const expected = row.fields[name]!;
    if (item == null || typeof item !== "object") return false;
    const keys = Object.keys(item).sort().join();
    if (keys !== "missing,present") return false;
    if (!isInt(item.present) || !isInt(item.missing)) return false;
    if (item.present !== expected.present || item.missing !== expected.missing)
      return false;
  }
  return true;
}

/** Evidence gate for the same subject-field diagnostic. Does not download a county. */
export function countyEvidenceGate(raw: unknown): Record<string, unknown> {
  const card =
    raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Fact)
      : null;
  const fips = card ? card.county_fips : null;
  const fipsOut = typeof fips === "string" && FIPS.test(fips) ? fips : null;
  const row = fipsOut ? PUBLISHED[fipsOut] : undefined;
  let blockers = row
    ? [...row.blockers]
    : [
        "No bundled field audit for this county. This diagnostic does not download rolls and does not treat a parcel count as readiness.",
      ];
  let status = row ? row.status : "not_ready";
  let attestation = "not_supplied";
  if (card && "attestation" in card) {
    if (row && attestationMatches(row, card.attestation)) {
      attestation = "matches_published_audit";
      blockers = [...blockers, ATTEST_OK];
    } else {
      attestation = "does_not_match_published_audit";
      status = "not_ready";
      blockers = [ATTEST_BAD, ...blockers];
    }
  }
  return {
    diagnostic: "county_evidence_gate",
    calculator: CALCULATOR,
    county_fips: fipsOut,
    status,
    not_county_complete: true,
    queryable: false,
    verified_against_publisher: false,
    figures_remeasured: false,
    source: sourceBlock(row),
    published_fields: row
      ? Object.fromEntries(
          Object.entries(row.fields).map(([key, value]) => [key, { ...value }]),
        )
      : null,
    ignored_for_status: ["audit_violations", "parcel_count"],
    attestation,
    blockers,
  };
}
