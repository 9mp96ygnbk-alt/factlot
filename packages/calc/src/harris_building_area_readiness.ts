/**
 * Caller-supplied format check for one Harris commercial building area.
 *
 * Pure. No network, no database, and no valuation. It does not compute a
 * building area, impute a missing figure, substitute one column for another,
 * or sum building rows. A filled_recognized value is the caller's own positive
 * finite square-foot base_ar (or a clearly labeled commercial Base Area /
 * Building Area), echoed back. It was not read from Harris County.
 * not_county_complete is always true. verified_against_publisher is always false.
 *
 * HCAD Definition_help: Base Area equals Building Area for commercial
 * properties. That equivalence is a label rule applied to caller-supplied
 * fields. This module does not open Definition_help or any HCAD file.
 * act_ar is not a recommended commercial Total Building Area fill. Agreement
 * with bld_ar in an extract is not semantic equivalence.
 */

const HARRIS_FIPS = "201";
const MAX_AREA_SF = 500_000_000;
const FIPS = /^\d{3}$/;

const CLASS_ORDER: Record<string, number> = {
  invalid: 0,
  mismatched: 1,
  missing: 2,
  refused: 3,
  limitation: 4,
};

const CARD_KEYS = new Set([
  "county_fips",
  "building_row_count",
  "multi_building",
  "building_rows",
  "bld_ar",
  "base_ar",
  "act_ar",
  "unit",
  "label",
  "value",
  "commercial",
  "market_value",
  "appraised_value",
  "tot_mkt_val",
  "tot_appr_val",
  "acreage",
  "requested",
  "owner_name",
  "owner_mailing_address",
  "owner",
  "aggregation_rule",
]);

const ROW_KEYS = new Set([
  "bld_ar",
  "base_ar",
  "act_ar",
  "unit",
  "label",
  "value",
  "commercial",
  "market_value",
  "appraised_value",
  "tot_mkt_val",
  "tot_appr_val",
  "acreage",
]);

const OWNER_KEYS = ["owner_name", "owner_mailing_address", "owner"];
const MONEY_KEYS = [
  "market_value",
  "appraised_value",
  "tot_mkt_val",
  "tot_appr_val",
];
const MONEY_LABELS = new Set([
  "market_value",
  "appraised_value",
  "tot_mkt_val",
  "tot_appr_val",
  "Market Value",
  "Appraised Value",
]);
const ACT_LABELS = new Set(["act_ar", "Actual Area", "Total Building Area"]);
const ACRE_LABELS = new Set(["acreage", "acres", "acre"]);

const DEFINITION =
  "Caller-supplied HCAD base_ar (Base Area). HCAD Definition_help states that Base Area equals Building Area for commercial properties. A recognized label is a caller-supplied format check only and does not verify the figure against the publisher. Not actual area (act_ar), not account bld_ar, not rentable area, and not a sum of building rows.";

const OWNER_MESSAGE =
  "Owner names and mailing addresses are not read and are not returned.";
const UNKNOWN_INPUT =
  "The input includes a property this diagnostic does not accept. That property was ignored and was not copied into the result.";
const UNKNOWN_ROW =
  "A building row includes a property this diagnostic does not accept. That row was not used and was not copied into the result.";
const INPUT_MESSAGE = "input must be an object of caller-supplied fields.";
const BAD_FIPS =
  "county_fips must be a 3-digit string. Harris County is 201. Other types are not coerced, and other counties are not assessed.";
const JURISDICTION =
  "This diagnostic is only for Harris County, Texas (FIPS 201). It does not assess other counties, does not use their published counts, and does not acquire their data.";
const GENERIC =
  "This diagnostic only checks the format of a caller-supplied Harris commercial building area. It does not compute an area, does not fetch county data, and does not treat unknown as zero.";
const REQUESTED_TYPE = "requested must be a list of names when it is present.";
const COMMERCIAL_TYPE =
  "commercial must be a boolean when it is present. Other types are not coerced.";
const ROW_COUNT_TYPE =
  "building_row_count must be an integer of 0 or more. Text and booleans are not coerced.";
const MULTI_TYPE = "multi_building must be a boolean when it is present.";
const ROWS_TYPE = "building_rows must be a list when it is present.";
const ROW_SHAPE = "Each building row must be an object. That row was not used.";
const ROW_CONTRADICTION =
  "The building-row count and the building-row list disagree. No area was selected and rows were not summed.";
const MULTI =
  "The caller indicated more than one building row or a multi-building account. No official aggregation rule is applied, so the rows are not summed and no building area is filled.";
const AGGREGATION =
  "An aggregation rule was supplied. It is not an official rule and was not applied. Building rows were not summed.";
const NO_ROW =
  "The caller reported no building row. No building area was invented.";
const ACT_AR =
  "act_ar is not a recommended commercial Total Building Area fill. Empirical agreement with bld_ar is not semantic equivalence. The figure was not copied and was not substituted for base_ar.";
const MONEY =
  "Market value and appraised value are not building area. They were not copied into the result.";
const MONEY_LABEL =
  "A market or appraised value was supplied as the area candidate. It is not a building area and was not copied.";
const BLD_NOT_USED =
  "Account bld_ar is not the commercial Base Area. It was not substituted for base_ar and was not summed with it.";
const NOT_REPAIR =
  "bld_ar is 0. The filled commercial candidate is the caller-supplied base area only. It does not repair or replace the zero account bld_ar.";
const STRICT =
  "Exactly one building row was asserted, bld_ar is 0, and base_ar is a positive finite square-foot figure. The commercial candidate label is recorded only. The figure was not copied into a filled value and is not a repair of bld_ar.";
const SECOND =
  "A second area figure was not substituted for base_ar and was not summed with it.";
const BLANK =
  "The commercial building-area candidate is blank. Blank is not a building area and was not copied.";
const ZERO =
  "The commercial building-area candidate is 0. Zero is not a building area and is not treated as missing. The figure was not copied.";
const WRONG_TYPE =
  "The commercial building-area candidate must be a number. Text, booleans, and other values are not coerced and were not copied.";
const NON_FINITE =
  "The commercial building-area candidate is not finite. It was not coerced and was not copied.";
const NEGATIVE =
  "The commercial building-area candidate is negative. A negative figure is not a building area and was not copied.";
const IMPLAUSIBLE =
  "The commercial building-area candidate exceeds 500000000 sf, the registry audit's implausible-area line. It is not filled.";
const UNITS =
  "The commercial building-area candidate is not in square feet. Acres are not converted, and an unrecognized unit is not assumed. The figure was not copied.";
const MISSING =
  "No caller-supplied commercial base_ar (Base Area) was recognized. act_ar and bld_ar are not substituted. Nothing was fetched.";
const NOT_COMMERCIAL =
  "The Building Area label is a commercial candidate only when commercial is true. The figure was not copied.";
const ACREAGE_ONLY =
  "Acreage was supplied without a square-foot commercial building area. Acres are not converted into building area and were not copied.";
const ACREAGE_BESIDE =
  "Acreage was not converted into commercial building area and was not copied.";
const UNRECOGNIZED =
  "The supplied label is not a Harris commercial base-area or building-area field. The figure was not copied.";
const UNLABELED =
  "An unlabeled value is not a commercial building area. It was not copied.";

const REFUSALS: Record<string, [string, string]> = {
  tax_rate: [
    "tax_rate",
    "No tax rate is evaluated. Nothing is fetched. Unknown is not zero.",
  ],
  "parcel.tax_rate": [
    "tax_rate",
    "No tax rate is evaluated. Nothing is fetched. Unknown is not zero.",
  ],
  exemption: [
    "exemption",
    "Exemption eligibility is not determined. Unknown is not no exemption. Nothing is fetched.",
  ],
  "parcel.exemption": [
    "exemption",
    "Exemption eligibility is not determined. Unknown is not no exemption. Nothing is fetched.",
  ],
  sale: [
    "sale",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  sale_price: [
    "sale",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  "parcel.sale_price": [
    "sale",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  "transaction.sale": [
    "sale",
    "No sale price is read. Roll market value is not a sale. Nothing is fetched.",
  ],
  rent: ["rent", "Rent is not inferred. Nothing is fetched."],
  "parcel.rent": ["rent", "Rent is not inferred. Nothing is fetched."],
  "lease.rent": ["rent", "Rent is not inferred. Nothing is fetched."],
  noi: ["noi", "NOI is not inferred. Nothing is fetched."],
  "parcel.noi": ["noi", "NOI is not inferred. Nothing is fetched."],
  cap_rate: ["cap_rate", "A cap rate is not inferred. Nothing is fetched."],
  "parcel.cap_rate": [
    "cap_rate",
    "A cap rate is not inferred. Nothing is fetched.",
  ],
  flood: ["flood", "Flood status is not determined. Nothing is fetched."],
  "parcel.flood": [
    "flood",
    "Flood status is not determined. Nothing is fetched.",
  ],
  elevation: ["elevation", "Elevation is not determined. Nothing is fetched."],
  "parcel.elevation": [
    "elevation",
    "Elevation is not determined. Nothing is fetched.",
  ],
  insurance: [
    "insurance",
    "Insurance conclusions are not made. Nothing is fetched.",
  ],
  "parcel.insurance": [
    "insurance",
    "Insurance conclusions are not made. Nothing is fetched.",
  ],
  buildability: [
    "buildability",
    "Buildability is not determined. Nothing is fetched.",
  ],
  "parcel.buildability": [
    "buildability",
    "Buildability is not determined. Nothing is fetched.",
  ],
  valuation: [
    "valuation",
    "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
  ],
  automatic_valuation: [
    "valuation",
    "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
  ],
  avm: [
    "valuation",
    "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
  ],
  "parcel.valuation": [
    "valuation",
    "No automatic valuation is made. This diagnostic does not conclude value. Nothing is fetched.",
  ],
};

type Issue = { class: string; code: string; field: string; message: string };
type Card = Record<string, unknown>;
type Kind =
  "multi" | "none" | "single" | "unspecified" | "bad" | "contradiction";
type LabelKind =
  | "absent"
  | "recognized"
  | "act"
  | "money"
  | "acre"
  | "building_rejected"
  | "unrecognized";

function isObject(value: unknown): value is Card {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function blank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function exactZero(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value === 0;
}

function shell(): Record<string, unknown> {
  return {
    diagnostic: "harris_commercial_building_area_readiness",
    not_county_complete: true,
    queryable: false,
    verified_against_publisher: false,
    publisher_content_checked: false,
    coverage_claim: "field_diagnostic_only",
    check_kind: "caller_supplied_format",
    computed: false,
    imputed: false,
    substituted: false,
    summed: false,
    repair_claimed: false,
    act_ar_recommended_commercial_fill: false,
    county_fips: null,
    jurisdiction_status: "unchecked",
    status: "invalid",
    commercial_candidate_label: null,
    filled: null,
    issues: [],
  };
}

function add(
  issues: Issue[],
  klass: string,
  code: string,
  field: string,
  message: string,
): void {
  const item = { class: klass, code, field, message };
  if (
    !issues.some(
      (have) =>
        have.class === item.class &&
        have.code === item.code &&
        have.field === item.field &&
        have.message === item.message,
    )
  )
    issues.push(item);
}

function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const byClass = (CLASS_ORDER[a.class] ?? 9) - (CLASS_ORDER[b.class] ?? 9);
    if (byClass !== 0) return byClass;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.field !== b.field) return a.field < b.field ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
}

function finish(
  out: Record<string, unknown>,
  issues: Issue[],
  status: string,
): Record<string, unknown> {
  out.status = status;
  out.issues = sortIssues(issues);
  return out;
}

function noteOwners(card: Card, issues: Issue[]): void {
  if (OWNER_KEYS.some((key) => key in card))
    add(issues, "refused", "owner_not_returned", "ownership", OWNER_MESSAGE);
}

function refuseRequested(name: string, issues: Issue[]): void {
  const known = REFUSALS[name];
  if (known) {
    add(issues, "refused", "unsupported", known[0], known[1]);
    return;
  }
  add(issues, "refused", "unsupported", "requested", GENERIC);
}

function labelOf(source: Card): { kind: LabelKind; label: string | null } {
  if (!("label" in source)) return { kind: "absent", label: null };
  const label = source.label;
  if (label === "base_ar" || label === "Base Area")
    return { kind: "recognized", label };
  if (label === "Building Area") {
    if (source.commercial === true)
      return { kind: "recognized", label: "Building Area" };
    return { kind: "building_rejected", label: null };
  }
  if (typeof label === "string" && ACT_LABELS.has(label))
    return { kind: "act", label: null };
  if (typeof label === "string" && MONEY_LABELS.has(label))
    return { kind: "money", label: null };
  if (typeof label === "string" && ACRE_LABELS.has(label))
    return { kind: "acre", label: null };
  return { kind: "unrecognized", label: null };
}

function hasCompetingArea(card: Card | null): boolean {
  return !!card && ("base_ar" in card || "label" in card || "value" in card);
}

function fold(signals: string[]): Kind {
  if (signals.includes("multi")) return "multi";
  if (signals.includes("bad")) return "bad";
  let concrete: string | null = null;
  for (const signal of signals) {
    if (signal !== "none" && signal !== "single") continue;
    if (concrete == null) concrete = signal;
    else if (concrete !== signal) return "contradiction";
  }
  if (concrete == null) return "unspecified";
  return concrete === "none" ? "none" : "single";
}

function noteCommercial(card: Card | null, issues: Issue[]): void {
  if (card && "commercial" in card && typeof card.commercial !== "boolean")
    add(issues, "invalid", "commercial", "commercial", COMMERCIAL_TYPE);
}

function noteSide(card: Card, row: Card | null, issues: Issue[]): void {
  if ("act_ar" in card || (row != null && "act_ar" in row))
    add(issues, "limitation", "act_ar", "act_ar", ACT_AR);
  if (
    MONEY_KEYS.some((key) => key in card) ||
    (row != null && MONEY_KEYS.some((key) => key in row))
  )
    add(issues, "limitation", "not_building_area", "market_value", MONEY);
  const cardLabel = labelOf(card).kind;
  const rowLabel = row ? labelOf(row).kind : "absent";
  if (cardLabel === "act" || rowLabel === "act")
    add(issues, "limitation", "act_ar", "act_ar", ACT_AR);
}

function unitState(source: Card): "sf" | "bad" {
  if (!("unit" in source)) return "sf";
  return source.unit === "sf" ? "sf" : "bad";
}

type ValueStatus =
  | "filled_recognized"
  | "blank"
  | "invalid"
  | "units_unknown"
  | "zero"
  | "missing";

function classifyValue(
  value: unknown,
  unit: "sf" | "bad",
  issues: Issue[],
): ValueStatus {
  if (blank(value)) {
    add(issues, "invalid", "blank", "commercial_building_area", BLANK);
    return "blank";
  }
  if (typeof value !== "number") {
    add(
      issues,
      "invalid",
      "wrong_type",
      "commercial_building_area",
      WRONG_TYPE,
    );
    return "invalid";
  }
  if (!Number.isFinite(value)) {
    add(
      issues,
      "invalid",
      "non_finite",
      "commercial_building_area",
      NON_FINITE,
    );
    return "invalid";
  }
  if (unit === "bad") {
    add(issues, "invalid", "units", "commercial_building_area", UNITS);
    return "units_unknown";
  }
  if (value === 0) {
    add(issues, "invalid", "zero", "commercial_building_area", ZERO);
    return "zero";
  }
  if (value < 0) {
    add(issues, "invalid", "negative", "commercial_building_area", NEGATIVE);
    return "invalid";
  }
  if (value > MAX_AREA_SF) {
    add(
      issues,
      "invalid",
      "implausible",
      "commercial_building_area",
      IMPLAUSIBLE,
    );
    return "invalid";
  }
  return "filled_recognized";
}

function filledRow(label: string, value: unknown): Record<string, unknown> {
  return {
    field: label,
    value,
    unit: "sf",
    definition: DEFINITION,
    evidence: "caller_supplied_format",
    verified_against_publisher: false,
  };
}

function bldValue(card: Card, row: Card | null): unknown {
  if ("bld_ar" in card) return card.bld_ar;
  if (row && "bld_ar" in row) return row.bld_ar;
  return undefined;
}

function bldPresent(card: Card, row: Card | null): boolean {
  return "bld_ar" in card || (!!row && "bld_ar" in row);
}

/** Format-check one caller-supplied Harris commercial building area. Not a valuation. */
export function harrisBuildingAreaReadiness(
  raw: unknown,
): Record<string, unknown> {
  const out = shell();
  if (!isObject(raw)) return finish(out, [issueInput()], "invalid");
  return run(out, raw);
}

function issueInput(): Issue {
  return {
    class: "invalid",
    code: "input",
    field: "input",
    message: INPUT_MESSAGE,
  };
}

function run(
  out: Record<string, unknown>,
  card: Card,
): Record<string, unknown> {
  const issues: Issue[] = [];
  noteOwners(card, issues);
  if (Object.keys(card).some((key) => !CARD_KEYS.has(key)))
    add(issues, "invalid", "unknown_property", "input", UNKNOWN_INPUT);

  const fips = card.county_fips;
  if (typeof fips === "string" && FIPS.test(fips)) out.county_fips = fips;
  if (out.county_fips !== HARRIS_FIPS) {
    if (typeof out.county_fips === "string") {
      out.jurisdiction_status = "not_harris";
      add(issues, "mismatched", "jurisdiction", "county_fips", JURISDICTION);
      return finish(out, issues, "not_harris");
    }
    add(issues, "invalid", "county_fips", "county_fips", BAD_FIPS);
    return finish(out, issues, "invalid");
  }
  out.jurisdiction_status = "harris";

  noteCommercial(card, issues);
  if ("requested" in card) {
    const requested = card.requested;
    if (!Array.isArray(requested)) {
      add(issues, "invalid", "requested", "requested", REQUESTED_TYPE);
      return finish(out, issues, "invalid");
    }
    if (requested.length > 0) {
      for (const name of requested) {
        if (typeof name === "string") refuseRequested(name, issues);
        else add(issues, "refused", "unsupported", "requested", GENERIC);
      }
      return finish(out, issues, "refused");
    }
  }

  if ("aggregation_rule" in card)
    add(issues, "limitation", "aggregation", "aggregation_rule", AGGREGATION);

  const signals: string[] = [];
  let seenRow: Card | null = null;
  let usableRow: Card | null = null;
  if ("multi_building" in card) {
    if (card.multi_building === true) signals.push("multi");
    else if (card.multi_building !== false) {
      add(issues, "invalid", "multi_building", "multi_building", MULTI_TYPE);
      signals.push("bad");
    }
  }
  if ("building_row_count" in card) {
    const count = card.building_row_count;
    if (!isInt(count) || count < 0) {
      add(issues, "invalid", "row_count", "building_row_count", ROW_COUNT_TYPE);
      signals.push("bad");
    } else if (count > 1) signals.push("multi");
    else if (count === 0) signals.push("none");
    else signals.push("single");
  }
  if ("building_rows" in card) {
    const rows = card.building_rows;
    if (!Array.isArray(rows)) {
      add(issues, "invalid", "building_rows", "building_rows", ROWS_TYPE);
      signals.push("bad");
    } else if (rows.length > 1) signals.push("multi");
    else if (rows.length === 0) signals.push("none");
    else {
      const first = rows[0];
      if (!isObject(first)) {
        add(issues, "invalid", "row_shape", "building_rows", ROW_SHAPE);
        signals.push("bad");
      } else {
        seenRow = first;
        noteOwners(first, issues);
        if (Object.keys(first).some((key) => !ROW_KEYS.has(key))) {
          add(
            issues,
            "invalid",
            "unknown_property",
            "building_row",
            UNKNOWN_ROW,
          );
          signals.push("single");
        } else {
          noteCommercial(first, issues);
          signals.push("single");
          usableRow = first;
        }
      }
    }
  }

  const kind = fold(signals);
  if (kind === "multi") {
    noteSide(card, null, issues);
    add(issues, "limitation", "multi_row", "building_rows", MULTI);
    return finish(out, issues, "multi_row_unknown");
  }
  if (kind === "bad") {
    noteSide(card, seenRow, issues);
    return finish(out, issues, "invalid");
  }
  if (kind === "contradiction") {
    noteSide(card, seenRow, issues);
    add(
      issues,
      "invalid",
      "row_contradiction",
      "building_rows",
      ROW_CONTRADICTION,
    );
    return finish(out, issues, "invalid");
  }
  if (kind === "none") {
    noteSide(card, null, issues);
    add(issues, "missing", "no_building_row", "building_rows", NO_ROW);
    return finish(out, issues, "no_building_row");
  }

  noteSide(card, seenRow ?? usableRow, issues);
  const found = choose(card, usableRow);
  const present = bldPresent(card, usableRow);
  const zeroBld = exactZero(bldValue(card, usableRow));

  if (found.kind === "none") {
    add(issues, "missing", "absent", "commercial_building_area", MISSING);
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "missing");
  }
  if (found.kind === "act") {
    add(issues, "limitation", "act_ar", "act_ar", ACT_AR);
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "missing");
  }
  if (found.kind === "money") {
    add(
      issues,
      "invalid",
      "not_building_area",
      "commercial_building_area",
      MONEY_LABEL,
    );
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "invalid");
  }
  if (found.kind === "building_rejected") {
    add(
      issues,
      "invalid",
      "not_commercial",
      "commercial_building_area",
      NOT_COMMERCIAL,
    );
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "invalid");
  }
  if (found.kind === "acre" || found.kind === "acreage") {
    add(issues, "invalid", "units", "acreage", ACREAGE_ONLY);
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "units_unknown");
  }
  if (found.kind === "unrecognized") {
    add(
      issues,
      "limitation",
      "unrecognized_label",
      "commercial_building_area",
      UNRECOGNIZED,
    );
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "missing");
  }
  if (found.kind === "unlabeled") {
    add(
      issues,
      "limitation",
      "unlabeled",
      "commercial_building_area",
      UNLABELED,
    );
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "missing");
  }
  if (found.kind !== "recognized") {
    add(issues, "missing", "absent", "commercial_building_area", MISSING);
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "missing");
  }

  const source = found.source;
  const label = found.label;
  if (found.second)
    add(
      issues,
      "limitation",
      "not_substituted",
      "commercial_building_area",
      SECOND,
    );
  if (
    "acreage" in source ||
    "acreage" in card ||
    (usableRow != null && "acreage" in usableRow)
  )
    add(issues, "limitation", "acres", "acreage", ACREAGE_BESIDE);

  out.commercial_candidate_label = label;
  if (!("base_ar" in source) && !("value" in source)) {
    add(issues, "missing", "absent", "commercial_building_area", MISSING);
    noteBld(issues, present, zeroBld, false);
    return finish(out, issues, "missing");
  }
  const value = "base_ar" in source ? source.base_ar : source.value;
  const status = classifyValue(value, unitState(source), issues);
  if (status === "filled_recognized" && kind === "single" && zeroBld) {
    add(
      issues,
      "limitation",
      "candidate_label_only",
      "commercial_building_area",
      STRICT,
    );
    return finish(
      out,
      issues,
      "strict_single_row_base_ar_candidate_label_only",
    );
  }
  if (status === "filled_recognized") {
    out.filled = filledRow(label, value);
    noteBld(issues, present, zeroBld, true);
    return finish(out, issues, "filled_recognized");
  }
  noteBld(issues, present, zeroBld, false);
  return finish(out, issues, status);
}

function noteBld(
  issues: Issue[],
  present: boolean,
  zeroBld: boolean,
  filled: boolean,
): void {
  if (!present) return;
  if (filled && zeroBld) {
    add(issues, "limitation", "not_a_repair", "bld_ar", NOT_REPAIR);
    return;
  }
  add(issues, "limitation", "not_substituted", "bld_ar", BLD_NOT_USED);
}

type Found =
  | {
      kind: "recognized";
      source: Card;
      label: string;
      second: boolean;
    }
  | {
      kind:
        | "none"
        | "act"
        | "money"
        | "building_rejected"
        | "acre"
        | "acreage"
        | "unrecognized"
        | "unlabeled";
    };

function choose(card: Card, row: Card | null): Found {
  const rowHas = hasCompetingArea(row);
  if ("base_ar" in card) {
    return {
      kind: "recognized",
      source: card,
      label: "base_ar",
      second: "label" in card || "value" in card || rowHas,
    };
  }
  const cardLabel = labelOf(card);
  if (cardLabel.kind === "recognized" && cardLabel.label != null) {
    return {
      kind: "recognized",
      source: card,
      label: cardLabel.label,
      second: rowHas,
    };
  }
  if (row && "base_ar" in row) {
    return {
      kind: "recognized",
      source: row,
      label: "base_ar",
      second:
        cardLabel.kind !== "absent" ||
        "value" in card ||
        "label" in row ||
        "value" in row,
    };
  }
  if (row) {
    const rowLabel = labelOf(row);
    if (rowLabel.kind === "recognized" && rowLabel.label != null) {
      return {
        kind: "recognized",
        source: row,
        label: rowLabel.label,
        second: cardLabel.kind !== "absent" || "value" in card,
      };
    }
  }
  if (cardLabel.kind === "act") return { kind: "act" };
  if (cardLabel.kind === "money") return { kind: "money" };
  if (cardLabel.kind === "building_rejected")
    return { kind: "building_rejected" };
  if (cardLabel.kind === "acre") return { kind: "acre" };
  if (cardLabel.kind === "unrecognized") return { kind: "unrecognized" };
  if ("value" in card) return { kind: "unlabeled" };
  if ("acreage" in card) return { kind: "acreage" };
  if (row) {
    const rowLabel = labelOf(row);
    if (rowLabel.kind === "act") return { kind: "act" };
    if (rowLabel.kind === "money") return { kind: "money" };
    if (rowLabel.kind === "building_rejected")
      return { kind: "building_rejected" };
    if (rowLabel.kind === "acre") return { kind: "acre" };
    if (rowLabel.kind === "unrecognized") return { kind: "unrecognized" };
    if ("value" in row) return { kind: "unlabeled" };
    if ("acreage" in row) return { kind: "acreage" };
  }
  return { kind: "none" };
}
