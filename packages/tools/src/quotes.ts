/**
 * Deterministic checks on values an agent read from a document. A port of the FactLot Ingest
 * verifier (python/src/factlot/ingest/verify.py): the same value shapes, the same quote
 * matching, the same written-form rules, and the same reasons. spec/vectors/documents.json pins
 * both languages. Nothing here calls a model.
 *
 * Quote matching normalizes both sides the way Python's `_norm` does: Unicode NFKC, typographic
 * quotes and dashes to ASCII, every run of whitespace (Python's definition, which includes line
 * breaks) to one space, trimmed, lowercased. Nothing else is forgiven: a word hyphenated across a
 * line break must be quoted with its hyphen.
 */

/** Ingest predicates and the value shape each expects (python/src/factlot/ingest/extract.py). */
export const PREDICATES: Readonly<Record<string, string>> = {
  "lease.landlord":
    "string (the landlord's name exactly as written in the document)",
  "lease.tenant":
    "string (the tenant's name exactly as written in the document)",
  "lease.commencement_date": "date (YYYY-MM-DD)",
  "lease.expiration_date": "date (YYYY-MM-DD)",
  "lease.rentable_area_sf": "number (square feet)",
  "lease.base_rent_schedule":
    'array of {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "annual_rent_psf": number}',
  "lease.free_rent":
    'object {"months": number, "applies_to": "base_rent" | "gross_rent"}',
  "lease.security_deposit": "number (USD)",
  "lease.pro_rata_share": "number between 0 and 1",
  "lease.cam_cap":
    'object {"method": "compounding_from_base" | "simple_from_base" | "year_over_year", "rate": number}',
  "lease.renewal_option":
    'object {"count": number, "term_months": number, "notice_months": number, "rent": string}',
  "lease.termination_option":
    'object {"effective_date": "YYYY-MM-DD", "notice_months": number, "fee": string}',
  "lease.rofr":
    'string (summary of the right of first refusal), or object {"applies_to": "space" | "purchase", "description": string (what it covers, as written), "response_days": number (optional; days to respond)}',
  "lease.rofo":
    'string (summary of the right of first offer), or object {"applies_to": "space" | "purchase", "description": string (what it covers, as written), "response_days": number (optional; days to respond)}',
  "lease.exclusive_use":
    'string (the protected use), or object {"protected_use": string (as written), "carve_outs": array of strings (optional; exceptions as written), "applies_to": string (optional; where it applies, e.g. "the Shopping Center")}',
  "lease.assignment_sublease":
    'string (summary of consent requirements), or object {"consent_standard": "prohibited" | "sole_discretion" | "not_unreasonably_withheld" | "not_unreasonably_withheld_conditioned_or_delayed" | "no_consent_required", "permitted_transfers": string (optional; transfers allowed without consent), "recapture_right": boolean (optional), "profit_share": number between 0 and 1 (optional; Landlord\'s share of transfer profit)}',
  "lease.percentage_rent":
    'object {"rate": number between 0 and 1, "breakpoint": {"type": "natural" | "fixed", "amount": number (annual sales in USD; required when type is fixed)}, "sales_exclusions": string (optional summary of sales excluded from gross sales)}',
  "lease.co_tenancy":
    'object {"trigger": string (the co-tenancy condition), "remedy": string (what Tenant may do when it fails), "cure_period_months": number (optional), "required_occupancy": number between 0 and 1 (optional; share of the center that must be open), "named_tenants": array of strings (optional; required co-tenants as written), "remedy_type": "alternate_rent" | "termination" | "alternate_rent_then_termination" | "other" (optional)}',
  "lease.renewal_notice_deadline":
    "date (YYYY-MM-DD; the last day to exercise a renewal option)",
  "lease.termination_notice_deadline":
    "date (YYYY-MM-DD; the last day to give notice of early termination)",
  "lease.rent_commencement_date":
    "date (YYYY-MM-DD; the day rent starts, when it differs from commencement)",
  "lease.expansion_option_deadline":
    "date (YYYY-MM-DD; the last day to exercise an expansion option)",
  "lease.operating_expense_base_year":
    "integer (the operating-expense base year, e.g. 2026)",
  "lease.parking":
    'object {"spaces": number, "rate_monthly": number (optional, USD per space per month)}',
  "lease.guaranty":
    'object {"guarantor": string (the guarantor\'s name exactly as written: the name only, never an address), "cap": number (optional, USD)}',
  "lease.prohibited_uses":
    "array of strings (each use the lease prohibits, as written)",
  "lease.go_dark":
    'object {"operating_covenant": boolean (true when Tenant must keep operating), "recapture_right": boolean (optional; Landlord may recapture or terminate if Tenant stops operating), "dark_period_days": number (optional; days dark before that right arises)}',
  "lease.radius_restriction":
    'object {"radius_miles": number, "duration": string (optional, e.g. "during the Term"), "remedy": string (optional)}',
  "lease.relocation_right":
    'object {"notice_days": number (optional), "landlord_pays_costs": boolean (optional), "tenant_may_terminate": boolean (optional), "replacement_premises": string (optional, e.g. "substantially similar size")}, at least one field',
  "lease.kick_out":
    'object {"party": "landlord" | "tenant", "sales_threshold": number (optional; annual gross sales in USD), "test_period": string (optional, e.g. "the third Lease Year"), "notice_days": number (optional), "effective_date": "YYYY-MM-DD" (optional), "fee": string (optional)}',
};

export function isIngestPredicate(predicate: string): boolean {
  return Object.hasOwn(PREDICATES, predicate);
}

// --- normalization --------------------------------------------------------------------------

/** Python's whitespace (str.isspace, re `\s`), which differs from JavaScript's `\s`. */
const PY_WS =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RUN = new RegExp(`[${PY_WS}]+`, "g");
const WS_ONE = new RegExp(`^[${PY_WS}]$`);
const WS_LEAD = new RegExp(`^[${PY_WS}]+`);
const WS_TRAIL = new RegExp(`[${PY_WS}]+$`);
const TYPOGRAPHIC = /[‘’“”–—]/g;
const TYPOGRAPHIC_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
};

function typographic(text: string): string {
  return text.replace(TYPOGRAPHIC, (c) => TYPOGRAPHIC_MAP[c] ?? c);
}

/** Python's str.strip(). */
export function pyStrip(text: string): string {
  return text.replace(WS_LEAD, "").replace(WS_TRAIL, "");
}

/** The verifier's normalization (Python `_norm`). */
export function norm(text: string): string {
  return pyStrip(
    typographic(text.normalize("NFKC")).replace(WS_RUN, " "),
  ).toLowerCase();
}

// --- value shapes -----------------------------------------------------------------------------

const DATE_PREDICATES = new Set([
  "lease.commencement_date",
  "lease.expiration_date",
  "lease.renewal_notice_deadline",
  "lease.termination_notice_deadline",
  "lease.rent_commencement_date",
  "lease.expansion_option_deadline",
]);
// A guarantor is a name. Anything that reads as a street address or a postal code is rejected, so
// a natural person's address never becomes a fact (the same rule the registry applies to owners).
// The Python pattern runs with re.ASCII, so \s there is ASCII whitespace; JavaScript's \s is wider.
const ADDRESS_ASCII =
  /\b\d+[a-z]?[ \t\n\r\f\v]+[\w.'-]+([ \t\n\r\f\v]+[\w.'-]+)*[ \t\n\r\f\v]+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way|terrace|ter|circle|cir|highway|hwy|parkway|pkwy|suite|ste|apt|apartment|unit|floor|fl)\b\.?|\b\d{5}(-\d{4})?\b|\bp\.?o\.? box\b/i;

function daysIn(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** A calendar date Python's `date` accepts (years 1–9999). */
function validYmd(y: number, m: number, d: number): boolean {
  return (
    y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)
  );
}

export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v))
    return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  return validYmd(y, m, d);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isText(v: unknown): v is string {
  return typeof v === "string" && pyStrip(v) !== "";
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const has = (o: Record<string, unknown>, k: string): boolean =>
  Object.hasOwn(o, k);

/** A reason the value has the wrong shape for an Ingest predicate, or undefined (Python `check_value`). */
export function checkValue(
  predicate: string,
  value: unknown,
): string | undefined {
  if (!isIngestPredicate(predicate)) return `unknown predicate ${predicate}`;
  if (DATE_PREDICATES.has(predicate))
    return isDate(value) ? undefined : "expected YYYY-MM-DD date";
  if (
    predicate === "lease.rentable_area_sf" ||
    predicate === "lease.security_deposit"
  )
    return isNum(value) && value > 0 ? undefined : "expected positive number";
  if (predicate === "lease.pro_rata_share")
    return isNum(value) && value > 0 && value <= 1
      ? undefined
      : "expected number in (0, 1]";
  if (predicate === "lease.base_rent_schedule") {
    if (!Array.isArray(value) || value.length === 0)
      return "expected non-empty array of rent steps";
    for (const step of value) {
      if (!(
        isPlainObject(step) &&
        isDate(step.from) &&
        isDate(step.to) &&
        isNum(step.annual_rent_psf)
      ))
        return "each rent step needs from, to (YYYY-MM-DD) and annual_rent_psf";
      if ((step.from as string) > (step.to as string))
        return "rent step ends before it starts";
    }
    return undefined;
  }
  if (predicate === "lease.cam_cap") {
    const ok =
      isPlainObject(value) &&
      ["compounding_from_base", "simple_from_base", "year_over_year"].includes(
        value.method as string,
      ) &&
      isNum(value.rate);
    if (ok && !((value.rate as number) > 0 && (value.rate as number) <= 1))
      return "rate must be a fraction in (0, 1], e.g. 0.05 for 5%";
    return ok
      ? undefined
      : "expected {method, rate} with an explicit cap method";
  }
  if (
    predicate === "lease.free_rent" ||
    predicate === "lease.renewal_option" ||
    predicate === "lease.termination_option"
  )
    return isPlainObject(value) && Object.keys(value).length > 0
      ? undefined
      : "expected object";
  if (predicate === "lease.percentage_rent") {
    if (
      !isPlainObject(value) ||
      !(isNum(value.rate) && value.rate > 0 && value.rate <= 1)
    )
      return "expected {rate, breakpoint} with rate in (0, 1]";
    const bp = value.breakpoint;
    if (!isPlainObject(bp) || !["natural", "fixed"].includes(bp.type as string))
      return "expected breakpoint {type: natural | fixed, amount?}";
    if (bp.type === "fixed" && !(isNum(bp.amount) && bp.amount > 0))
      return "a fixed breakpoint needs a positive amount";
    if (has(bp, "amount") && !(isNum(bp.amount) && bp.amount > 0))
      return "breakpoint amount must be a positive number";
    if (has(value, "sales_exclusions") && !isText(value.sales_exclusions))
      return "sales_exclusions must be a non-empty string";
    return undefined;
  }
  if (predicate === "lease.operating_expense_base_year")
    return isNum(value) &&
      Number.isInteger(value) &&
      value >= 1900 &&
      value <= 2200
      ? undefined
      : "expected a four-digit integer year";
  if (predicate === "lease.parking") {
    if (!isPlainObject(value) || !(isNum(value.spaces) && value.spaces > 0))
      return "expected {spaces, rate_monthly?} with a positive number of spaces";
    if (
      has(value, "rate_monthly") &&
      !(isNum(value.rate_monthly) && value.rate_monthly >= 0)
    )
      return "rate_monthly must be a non-negative number";
    return undefined;
  }
  if (predicate === "lease.guaranty") {
    if (!isPlainObject(value) || !isText(value.guarantor))
      return "expected {guarantor, cap?} with the guarantor's name";
    if (ADDRESS_ASCII.test(value.guarantor))
      return "guarantor must be a name, not an address";
    if (has(value, "cap") && !(isNum(value.cap) && value.cap > 0))
      return "cap must be a positive number";
    return undefined;
  }
  if (Object.hasOwn(CLAUSES, predicate)) return checkClause(predicate, value);
  return isText(value) ? undefined : "expected non-empty string";
}

// Clause predicates: which fields an object value may carry and the test each must pass, in the
// order they are checked (Python `_CLAUSES`). `stringOk` predicates also accept a plain summary
// string, the shape they had before clause objects. A test is a check or a list of enum values.
type FieldCheck = "text" | "texts" | "positive" | "fraction" | "bool" | "date";
type FieldTest = FieldCheck | readonly string[];
interface ClauseRule {
  expected: string;
  stringOk?: boolean;
  arrayOfText?: boolean;
  nonEmpty?: boolean;
  required?: Readonly<Record<string, FieldTest>>;
  optional?: Readonly<Record<string, FieldTest>>;
}
const FIELD_REASONS: Record<FieldCheck, string> = {
  text: "must be a non-empty string",
  texts: "must be a non-empty array of non-empty strings",
  positive: "must be a positive number",
  fraction: "must be a number in (0, 1]",
  bool: "must be true or false",
  date: "must be a YYYY-MM-DD date",
};
const isTexts = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every(isText);
const FIELD_CHECKS: Record<FieldCheck, (v: unknown) => boolean> = {
  text: isText,
  texts: isTexts,
  positive: (v) => isNum(v) && v > 0,
  fraction: (v) => isNum(v) && v > 0 && v <= 1,
  bool: (v) => typeof v === "boolean",
  date: isDate,
};
const ROFR: ClauseRule = {
  stringOk: true,
  expected:
    "expected a summary string, or {applies_to: space | purchase, description, response_days?}",
  required: { applies_to: ["space", "purchase"], description: "text" },
  optional: { response_days: "positive" },
};
const CLAUSES: Readonly<Record<string, ClauseRule>> = {
  "lease.rofr": ROFR,
  "lease.rofo": ROFR,
  "lease.exclusive_use": {
    stringOk: true,
    expected:
      "expected the protected use as a string, or {protected_use, carve_outs?, applies_to?}",
    required: { protected_use: "text" },
    optional: { carve_outs: "texts", applies_to: "text" },
  },
  "lease.assignment_sublease": {
    stringOk: true,
    expected:
      "expected a summary string, or {consent_standard, permitted_transfers?, recapture_right?, profit_share?}",
    required: {
      consent_standard: [
        "prohibited",
        "sole_discretion",
        "not_unreasonably_withheld",
        "not_unreasonably_withheld_conditioned_or_delayed",
        "no_consent_required",
      ],
    },
    optional: {
      permitted_transfers: "text",
      recapture_right: "bool",
      profit_share: "fraction",
    },
  },
  "lease.co_tenancy": {
    expected: "expected {trigger, remedy} as non-empty strings",
    required: { trigger: "text", remedy: "text" },
    optional: {
      cure_period_months: "positive",
      required_occupancy: "fraction",
      named_tenants: "texts",
      remedy_type: [
        "alternate_rent",
        "termination",
        "alternate_rent_then_termination",
        "other",
      ],
    },
  },
  "lease.prohibited_uses": {
    arrayOfText: true,
    expected: "expected a non-empty array of prohibited uses as strings",
  },
  "lease.go_dark": {
    expected:
      "expected {operating_covenant, recapture_right?, dark_period_days?} with operating_covenant true or false",
    required: { operating_covenant: "bool" },
    optional: { recapture_right: "bool", dark_period_days: "positive" },
  },
  "lease.radius_restriction": {
    expected:
      "expected {radius_miles, duration?, remedy?} with a positive radius in miles",
    required: { radius_miles: "positive" },
    optional: { duration: "text", remedy: "text" },
  },
  "lease.relocation_right": {
    expected:
      "expected an object with at least one of notice_days, landlord_pays_costs, tenant_may_terminate, replacement_premises",
    nonEmpty: true,
    optional: {
      notice_days: "positive",
      landlord_pays_costs: "bool",
      tenant_may_terminate: "bool",
      replacement_premises: "text",
    },
  },
  "lease.kick_out": {
    expected:
      "expected {party: landlord | tenant, sales_threshold?, test_period?, notice_days?, effective_date?, fee?}",
    required: { party: ["landlord", "tenant"] },
    optional: {
      sales_threshold: "positive",
      test_period: "text",
      notice_days: "positive",
      effective_date: "date",
      fee: "text",
    },
  },
};

const fieldOk = (test: FieldTest, v: unknown): boolean =>
  typeof test === "string" ? FIELD_CHECKS[test](v) : test.includes(v as string);

function checkClause(predicate: string, value: unknown): string | undefined {
  const rule = CLAUSES[predicate]!;
  if (rule.arrayOfText) return isTexts(value) ? undefined : rule.expected;
  if (!isPlainObject(value)) {
    if (rule.stringOk)
      return isText(value) ? undefined : "expected non-empty string";
    return rule.expected;
  }
  for (const [k, t] of Object.entries(rule.required ?? {}))
    if (!(has(value, k) && fieldOk(t, value[k]))) return rule.expected;
  if (rule.nonEmpty && Object.keys(value).length === 0) return rule.expected;
  for (const [k, t] of Object.entries(rule.optional ?? {}))
    if (has(value, k) && !fieldOk(t, value[k]))
      return typeof t === "string"
        ? `${k} ${FIELD_REASONS[t]}`
        : `${k} must be one of ${t.join(", ")}`;
  return undefined;
}

export const PREDICATE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * The shape check for any predicate: Ingest predicates get `checkValue`; any other dotted
 * lower_snake predicate needs a value that is not null and, if a string, not blank.
 */
export function checkAnyValue(
  predicate: string,
  value: unknown,
): string | undefined {
  if (isIngestPredicate(predicate)) return checkValue(predicate, value);
  if (!PREDICATE_PATTERN.test(predicate))
    return "predicate must be dotted lower_snake, e.g. lease.expiration_date";
  if (value === null || value === undefined) return "expected a value";
  if (typeof value === "string" && !isText(value))
    return "expected non-empty string";
  return undefined;
}

// --- value–quote consistency ----------------------------------------------------------------

export type Kind = "number" | "ratio" | "date" | "string" | "text" | "phrase";
type Spec = Kind | readonly [Spec] | { readonly [k: string]: Spec };

// Which parts of each predicate's value are checked against the quote, and how (Python
// `_CONSISTENCY`). A list spec applies to each element; dict keys that are not listed (enums,
// free-text summaries) are not checked; predicates not listed are never failed by this check.
const CONSISTENCY: Readonly<Record<string, Spec>> = {
  "lease.commencement_date": "date",
  "lease.expiration_date": "date",
  "lease.rentable_area_sf": "number",
  "lease.security_deposit": "number",
  "lease.pro_rata_share": "ratio",
  "lease.base_rent_schedule": [
    { from: "date", to: "date", annual_rent_psf: "number" },
  ],
  "lease.free_rent": { months: "number" },
  "lease.cam_cap": { rate: "ratio" },
  "lease.renewal_option": {
    count: "number",
    term_months: "number",
    notice_months: "number",
  },
  "lease.termination_option": {
    effective_date: "date",
    notice_months: "number",
  },
  "lease.landlord": "string",
  "lease.tenant": "string",
  "lease.percentage_rent": { rate: "ratio", breakpoint: { amount: "number" } },
  "lease.co_tenancy": {
    cure_period_months: "number",
    required_occupancy: "ratio",
    named_tenants: ["string"],
  },
  "lease.renewal_notice_deadline": "date",
  "lease.termination_notice_deadline": "date",
  "lease.rent_commencement_date": "date",
  "lease.expansion_option_deadline": "date",
  "lease.operating_expense_base_year": "number",
  "lease.parking": { spaces: "number", rate_monthly: "number" },
  "lease.guaranty": { guarantor: "string", cap: "number" },
  "lease.rofr": { description: "text", response_days: "number" },
  "lease.rofo": { description: "text", response_days: "number" },
  "lease.exclusive_use": {
    protected_use: "text",
    carve_outs: ["text"],
    applies_to: "text",
  },
  "lease.assignment_sublease": {
    consent_standard: "phrase",
    permitted_transfers: "text",
    profit_share: "ratio",
  },
  "lease.prohibited_uses": ["text"],
  "lease.go_dark": { dark_period_days: "number" },
  "lease.radius_restriction": { radius_miles: "number" },
  "lease.relocation_right": { notice_days: "number" },
  "lease.kick_out": {
    sales_threshold: "number",
    notice_days: "number",
    effective_date: "date",
  },
};

/**
 * "phrase": an enum value the quote must word in one of these ways (Python `PHRASES`). Every group
 * needs one of its alternatives in the normalized quote. Values not listed are not checked.
 */
export const PHRASES: Readonly<Record<string, readonly (readonly string[])[]>> =
  {
    sole_discretion: [
      [
        "sole discretion",
        "absolute discretion",
        "sole and absolute discretion",
      ],
    ],
    not_unreasonably_withheld: [["unreasonably withh"]],
    not_unreasonably_withheld_conditioned_or_delayed: [
      ["unreasonably withh"],
      ["delay", "conditioned"],
    ],
  };

/** True when the predicate has value parts the consistency check compares with the quote. */
export function hasConsistencyRule(predicate: string): boolean {
  return Object.hasOwn(CONSISTENCY, predicate);
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTHS = new Map<string, number>(MONTH_NAMES.map((m, i) => [m, i + 1]));
for (const [m, i] of [...MONTHS])
  if (!MONTHS.has(m.slice(0, 3))) MONTHS.set(m.slice(0, 3), i);
MONTHS.set("sept", 9);
const byLength = (keys: Iterable<string>): string =>
  [...keys].sort((a, b) => b.length - a.length).join("|");
const MONTH_RE = byLength(MONTHS.keys());
const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
};
const TENS_RE = Object.keys(TENS).join("|");
const UNITS_RE = UNITS.join("|");
const ORDINAL_RE = byLength(Object.keys(ORDINALS));
export const NUMBER_TOKEN = /(?<![\d.])(\d[\d,]*(?:\.\d+)?|\.\d+)/g;
const NUMBER_WORD = new RegExp(
  `\\b(?:(${TENS_RE})(?:[ -](${UNITS_RE}))?|(${UNITS_RE}))\\b`,
  "g",
);
type DateRead = (
  m: RegExpMatchArray,
) => [string | number, string | number, string | number][];
const DATE_PATTERNS: [RegExp, DateRead][] = [
  // 2027-03-01, 2027/03/01
  [/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g, (m) => [[m[1]!, m[2]!, m[3]!]]],
  // 3/1/2027, 03-01-2027, 1.3.2027 (read both month-first and day-first)
  [
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g,
    (m) => [
      [m[3]!, m[1]!, m[2]!],
      [m[3]!, m[2]!, m[1]!],
    ],
  ],
  // March 1, 2027; Mar. 1st 2027
  [
    new RegExp(
      `\\b(${MONTH_RE})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`,
      "g",
    ),
    (m) => [[m[3]!, MONTHS.get(m[1]!)!, m[2]!]],
  ],
  // 1 March 2027; 1st day of March, 2027
  [
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)? (?:day of )?(${MONTH_RE})\\.?,? (\\d{4})\\b`,
      "g",
    ),
    (m) => [[m[3]!, MONTHS.get(m[2]!)!, m[1]!]],
  ],
  // first day of March, 2027; twenty-eighth day of February, 2031
  [
    new RegExp(
      `\\b(?:(${TENS_RE})[ -])?(${ORDINAL_RE}) day of (${MONTH_RE})\\.?,? (\\d{4})\\b`,
      "g",
    ),
    (m) => [
      [m[4]!, MONTHS.get(m[3]!)!, (m[1] ? TENS[m[1]]! : 0) + ORDINALS[m[2]!]!],
    ],
  ],
];

/**
 * A decimal's canonical key (digits without leading or trailing zeros, and an exponent), so
 * 24.5, 24.50 and 2.45e1 compare equal as Python's Decimal does. Undefined if not a number.
 */
export function decimalKey(text: string): string | undefined {
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return undefined;
  const frac = m[3] ?? "";
  let digits = (m[2]! + frac).replace(/^0+/, "");
  let exp = Number(m[4] ?? 0) - frac.length;
  if (digits === "") return "0";
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  digits = digits.slice(0, digits.length - trailing);
  exp += trailing;
  return `${m[1] === "-" ? "-" : ""}${digits}e${exp}`;
}

/** The key of `key` times 100 (a ratio in percent). */
function times100(key: string): string {
  if (key === "0") return key;
  const i = key.lastIndexOf("e");
  return `${key.slice(0, i)}e${Number(key.slice(i + 1)) + 2}`;
}

/** Every number written in the (normalized) quote, in digits or as a word up to ninety-nine. */
export function numbersIn(quote: string): Set<string> {
  const found = new Set<string>();
  for (const m of quote.matchAll(NUMBER_TOKEN)) {
    const k = decimalKey(m[1]!.replaceAll(",", "").replace(/\.+$/, ""));
    if (k !== undefined) found.add(k);
  }
  for (const m of quote.matchAll(NUMBER_WORD)) {
    const [, tens, unit, lone] = m;
    const n = lone
      ? UNITS.indexOf(lone)
      : TENS[tens!]! + (unit ? UNITS.indexOf(unit) : 0);
    found.add(decimalKey(String(n))!);
  }
  return found;
}

/** Every calendar date written in the (normalized) quote, as "y-m-d" with unpadded numbers. */
export function datesIn(quote: string): Set<string> {
  const found = new Set<string>();
  for (const [pattern, read] of DATE_PATTERNS) {
    for (const m of quote.matchAll(pattern)) {
      for (const [y, mo, d] of read(m)) {
        const [yy, mm, dd] = [Number(y), Number(mo), Number(d)];
        if (validYmd(yy, mm, dd)) found.add(`${yy}-${mm}-${dd}`);
      }
    }
  }
  return found;
}

/** Character ranges of the dates written in a (normalized) text. */
export function dateRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const [pattern, read] of DATE_PATTERNS)
    for (const m of text.matchAll(pattern))
      if (
        read(m).some(([y, mo, d]) => validYmd(Number(y), Number(mo), Number(d)))
      )
        out.push([m.index!, m.index! + m[0].length]);
  return out;
}

const dateKey = (iso: string): string =>
  iso
    .split("-")
    .map((p) => String(Number(p)))
    .join("-");

/** A value as it appears in a reason: JSON, numbers as JavaScript writes them. */
export function showValue(value: unknown): string {
  return isNum(value) ? String(value) : JSON.stringify(value);
}

/**
 * The first number written in digits in a free-text value that the normalized quote does not
 * state, as written without commas, or undefined (Python `text_number_missing`).
 */
export function textNumberMissing(
  text: string,
  quote: string,
): string | undefined {
  const numbers = numbersIn(quote);
  for (const m of norm(text).matchAll(NUMBER_TOKEN)) {
    const written = m[1]!.replaceAll(",", "").replace(/\.+$/, "");
    const k = decimalKey(written);
    if (k !== undefined && !numbers.has(k)) return written;
  }
  return undefined;
}

/** The reason a value part of the given kind was not found in the normalized quote (Python `missing_reason`). */
export function missingReason(
  kind: Kind,
  value: unknown,
  path: string,
  quote: string,
): string {
  const where = path ? ` (${path})` : "";
  if (kind === "text")
    return `number ${textNumberMissing(value as string, quote)} in value ${showValue(value)}${where} not found in quote`;
  return `value ${showValue(value)}${where} not found in quote`;
}

/** True when `value` of the given kind cannot be found in the normalized quote (Python `_missing`). */
export function missing(kind: Kind, value: unknown, quote: string): boolean {
  if (kind === "text")
    return (
      typeof value === "string" && textNumberMissing(value, quote) !== undefined
    );
  if (kind === "phrase") {
    const groups =
      typeof value === "string" && Object.hasOwn(PHRASES, value)
        ? PHRASES[value]
        : undefined;
    return (
      !!groups &&
      groups.length > 0 &&
      !groups.every((g) => g.some((alt) => quote.includes(alt)))
    );
  }
  if (kind === "string") {
    const v = typeof value === "string" ? norm(value) : "";
    return !(v && quote.includes(v));
  }
  if (kind === "date") {
    if (!isDate(value)) return false; // not checkable; the shape check reports malformed dates
    return !datesIn(quote).has(dateKey(value));
  }
  if (!isNum(value)) return false;
  const wanted = decimalKey(String(value))!;
  const numbers = numbersIn(quote);
  if (numbers.has(wanted)) return false;
  if (
    kind === "ratio" &&
    (quote.includes("%") || quote.includes("percent")) &&
    numbers.has(times100(wanted))
  )
    return false;
  return true;
}

/** A value part the consistency check compares with the quote, or one it leaves alone. */
export interface Part {
  path: string;
  as?: Kind;
  value: unknown;
}

/** Whether a value can be checked as the given kind (malformed parts are left to the shape check). */
function checkable(kind: Kind, value: unknown): boolean {
  // A text is checked for the numbers written in digits in it; one without digits is not checked.
  if (kind === "text")
    return typeof value === "string" && /[0-9]/.test(norm(value));
  if (kind === "phrase")
    return typeof value === "string" && Object.hasOwn(PHRASES, value);
  if (kind === "string") return typeof value === "string";
  if (kind === "date") return isDate(value);
  return isNum(value);
}

/** The kind generic predicates check a scalar as: dates, numbers, ratios (0 < x ≤ 1). */
function genericKind(value: unknown): Kind | undefined {
  if (isNum(value)) return value > 0 && value <= 1 ? "ratio" : "number";
  if (isDate(value)) return "date";
  return undefined;
}

/**
 * Every leaf of the value, with the kind it is checked as (`as`) or none when it is not checked
 * (enums, summaries, booleans). Paths start at "value" and include array indexes.
 * `reasonPath` is the path Python's `_walk` names in its reason (no array indexes).
 */
export function valueParts(
  predicate: string,
  value: unknown,
): (Part & { reasonPath: string })[] {
  const out: (Part & { reasonPath: string })[] = [];
  const join = (a: string, b: string | number): string =>
    a ? `${a}.${b}` : String(b);
  const leaves = (v: unknown, path: string, reasonPath: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => leaves(x, join(path, i), reasonPath));
      return;
    }
    if (isPlainObject(v)) {
      for (const [k, x] of Object.entries(v))
        leaves(x, join(path, k), join(reasonPath, k));
      return;
    }
    out.push({ path: path || "value", value: v, reasonPath });
  };
  const known = (
    spec: Spec | undefined,
    v: unknown,
    path: string,
    rp: string,
  ): void => {
    if (typeof spec === "string") {
      if (checkable(spec, v))
        out.push({ path: path || "value", as: spec, value: v, reasonPath: rp });
      else leaves(v, path, rp);
      return;
    }
    if (Array.isArray(spec)) {
      if (!Array.isArray(v)) return leaves(v, path, rp);
      v.forEach((x, i) => known(spec[0], x, join(path, i), rp));
      return;
    }
    if (spec === undefined || !isPlainObject(v)) return leaves(v, path, rp);
    // Spec order first (the order Python's _walk checks, so the first failure is the same).
    const sub = spec as Record<string, Spec>;
    for (const [k, inner] of Object.entries(sub))
      if (has(v, k)) known(inner, v[k], join(path, k), join(rp, k));
    for (const [k, x] of Object.entries(v))
      if (!Object.hasOwn(sub, k)) leaves(x, join(path, k), join(rp, k));
  };
  const generic = (v: unknown, path: string): void => {
    if (Array.isArray(v)) return v.forEach((x, i) => generic(x, join(path, i)));
    if (isPlainObject(v)) {
      for (const [k, x] of Object.entries(v)) generic(x, join(path, k));
      return;
    }
    const as = genericKind(v);
    out.push({
      path: path || "value",
      value: v,
      reasonPath: path,
      ...(as ? { as } : {}),
    });
  };
  if (isIngestPredicate(predicate))
    known(CONSISTENCY[predicate], value, "", "");
  else generic(value, "");
  return out.map((p) => ({
    ...p,
    path: p.path === "value" ? "value" : `value.${p.path}`,
  }));
}

/**
 * A reason the value does not follow from the quote, or undefined if it does or cannot be
 * checked (Python `check_consistency`). Ingest predicates use their table; any other predicate
 * has its numbers, ratios (0 < x ≤ 1) and dates checked, wherever they sit in the value.
 */
export function checkConsistency(
  predicate: string,
  value: unknown,
  quote: string,
): string | undefined {
  const q = norm(quote);
  for (const p of valueParts(predicate, value)) {
    if (p.as && missing(p.as, p.value, q))
      return missingReason(p.as, p.value, p.reasonPath, q);
  }
  return undefined;
}

// --- quotes on pages --------------------------------------------------------------------------

export const MIN_QUOTE_CHARS = 12;

/** A document's pages, normalized once. */
export class PageText {
  readonly pages: readonly string[];
  readonly normalized: readonly string[];
  private hyphenated?: string[][];
  private maps = new Map<number, SpanMap | null>();

  constructor(pages: readonly string[]) {
    this.pages = pages;
    this.normalized = pages.map(norm);
  }

  /** Pages (1-based) that contain the quote only if a word hyphenated at a line break is rejoined. */
  hyphenationHits(q: string): number[] {
    this.hyphenated ??= this.pages.map((p) => hyphenReadings(p).map(norm));
    const hits: number[] = [];
    this.hyphenated.forEach((readings, i) => {
      if (readings.some((t) => t.includes(q))) hits.push(i + 1);
    });
    return hits;
  }

  /** Code-point offsets of the normalized quote within the document text (pages joined by \f). */
  span(page: number, q: string): { start: number; end: number } | undefined {
    if (!this.maps.has(page))
      this.maps.set(page, spanMap(this.pages[page - 1]!));
    const map = this.maps.get(page);
    if (!map || map.text !== this.normalized[page - 1]) return undefined;
    const at = map.text.indexOf(q);
    if (at < 0) return undefined;
    let offset = 0;
    for (let i = 0; i < page - 1; i++) offset += codePoints(this.pages[i]!) + 1;
    return {
      start: offset + map.start[at]!,
      end: offset + map.end[at + q.length - 1]!,
    };
  }
}

/** Length in code points, as Python counts. */
function codePoints(s: string): number {
  return s.length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
}

/**
 * Readings of a page with a word hyphenated at a line break written without the break
 * ("com-mencement") and joined ("commencement"), and with soft hyphens removed. Used only to
 * explain why a quote was not found; never to accept one.
 */
function hyphenReadings(text: string): string[] {
  const broken = /([A-Za-z])-[ \t]*(?:\r\n|\r|\n)[ \t]*([A-Za-z])/g;
  return [
    text.replace(broken, "$1-$2"),
    text.replace(broken, "$1$2").replaceAll("\u00ad", ""),
  ];
}

interface SpanMap {
  text: string;
  /** For each UTF-16 unit of `text`: the code-point range of the original text it came from. */
  start: number[];
  end: number[];
}

/**
 * The normalization applied piece by piece (a base character with its combining marks), with
 * the original position of every output character. When the result differs from normalizing
 * the whole page at once (rare: context-dependent case mapping or composition across pieces),
 * the caller gives no span rather than a wrong one.
 */
function spanMap(page: string): SpanMap {
  const clusters: { text: string; s: number; e: number }[] = [];
  let cp = 0;
  for (const ch of page) {
    const last = clusters[clusters.length - 1];
    if (last && /^\p{M}$/u.test(ch)) {
      last.text += ch;
      last.e = cp + 1;
    } else clusters.push({ text: ch, s: cp, e: cp + 1 });
    cp++;
  }
  // NFKC and the typographic replacements per cluster, then each whitespace run to one space.
  const out: { ch: string; s: number; e: number; ws: boolean }[] = [];
  for (const c of clusters) {
    for (const ch of typographic(c.text.normalize("NFKC"))) {
      const last = out[out.length - 1];
      if (!WS_ONE.test(ch)) out.push({ ch, s: c.s, e: c.e, ws: false });
      else if (last?.ws) last.e = c.e;
      else out.push({ ch: " ", s: c.s, e: c.e, ws: true });
    }
  }
  while (out[0]?.ws) out.shift();
  while (out[out.length - 1]?.ws) out.pop();
  let text = "";
  const start: number[] = [];
  const end: number[] = [];
  for (const { ch, s: from, e: to } of out) {
    const lower = ch.toLowerCase();
    text += lower;
    for (let i = 0; i < lower.length; i++) {
      start.push(from);
      end.push(to);
    }
  }
  return { text, start, end };
}

/** Where a candidate's quote was found (Python `verify`, quote part). */
export type Location =
  | { ok: true; page: number; corrected: boolean; q: string }
  | { ok: false; reason: string };

export function locateQuote(
  doc: PageText,
  quote: string,
  claimedPage: number,
): Location {
  const q = norm(quote);
  if ([...q].length < MIN_QUOTE_CHARS)
    return {
      ok: false,
      reason: `quote shorter than ${MIN_QUOTE_CHARS} characters`,
    };
  const claimed = doc.normalized[claimedPage - 1];
  if (claimedPage >= 1 && claimed !== undefined && claimed.includes(q))
    return { ok: true, page: claimedPage, corrected: false, q };
  const hits: number[] = [];
  doc.normalized.forEach((t, i) => {
    if (t.includes(q)) hits.push(i + 1);
  });
  if (hits.length > 1)
    return {
      ok: false,
      reason: `quote appears on several pages [${hits.join(", ")}]; cannot cite a single page`,
    };
  if (hits.length === 0) {
    const joined = doc.hyphenationHits(q);
    if (joined.length)
      return {
        ok: false,
        reason: `quote not found in the document; it matches page${joined.length > 1 ? "s" : ""} ${joined.join(", ")} only if a word hyphenated at a line break is rejoined. Quote the text as printed: keep the hyphen and the line break (a space will do), e.g. "com- mencement"`,
      };
    return { ok: false, reason: "quote not found in the document" };
  }
  return { ok: true, page: hits[0]!, corrected: true, q };
}
