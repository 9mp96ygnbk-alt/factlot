/**
 * Typed evidence contracts for caller-supplied FEMA NFHL and USGS EPQS payloads.
 *
 * Pure descriptions and validators. Nothing here fetches, caches, or joins a
 * parcel. Caller metadata is recorded as an assertion and is not source
 * authenticity, commercial-scope verification, or parcel identity.
 *
 * Source notes checked 2026-11-06 (date-only; not a map effective date):
 * FEMA NFHL https://www.fema.gov/flood-maps/national-flood-hazard-layer
 * FEMA map services https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm
 * USGS EPQS docs https://epqs.nationalmap.gov/v1/docs
 * USGS credits https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits
 */
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = "context-evidence/1";
export const FEMA_NFHL_PARSER_VERSION = "parse-fema-nfhl/1";
export const USGS_EPQS_PARSER_VERSION = "parse-usgs-epqs/1";

/** Calendar day the implementation evidence was read. Not retrieval and not effective. */
export const SOURCE_EVIDENCE_CHECKED = "2026-11-06";

export const FEMA_CREDIT = "FEMA National Flood Hazard Layer";
export const USGS_CREDIT = "U.S. Geological Survey, 3DEP/EPQS";

export const FEMA_NFHL_INFO_URL =
  "https://www.fema.gov/flood-maps/national-flood-hazard-layer";
export const FEMA_SERVICE_GUIDE_URL =
  "https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm";
export const USGS_EPQS_DOCS_URL = "https://epqs.nationalmap.gov/v1/docs";
export const USGS_ELEVATION_FAQ_URL =
  "https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map";

export const EVIDENCE_STATUSES = [
  "observed",
  "unknown",
  "ambiguous",
  "invalid",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const UNKNOWN_REASONS = [
  "no_feature_unknown",
  "explicit_unmapped",
  "provider_error",
  "timeout",
  "truncated",
  "invalid_input",
  "malformed_response",
  "missing_units",
  "datum_unknown",
  "invalid_source_date",
  "boundary_multiple",
  "nodata_unverified",
] as const;
export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

export const MAP_STATUSES = ["effective", "preliminary", "pending"] as const;
export type MapStatus = (typeof MAP_STATUSES)[number];

export const GEOMETRY_SEMANTICS = ["point", "parcel_polygon"] as const;
export type GeometrySemantics = (typeof GEOMETRY_SEMANTICS)[number];

export const POINT_ROLES = [
  "caller_point",
  "centroid",
  "representative_point",
] as const;
export type PointRole = (typeof POINT_ROLES)[number];

export const DECLARED_AXES = [
  "longitude_latitude",
  "easting_northing",
] as const;
export type DeclaredAxis = (typeof DECLARED_AXES)[number];

export const SPATIAL_MATCHES = [
  "match",
  "mismatch",
  "not_returned",
  "not_applicable",
] as const;
export type SpatialMatch = (typeof SPATIAL_MATCHES)[number];

/** FEMA point queries this parser will validate. Native NFHL CRS is 4269. */
export const FEMA_INPUT_SRIDS = [4269, 4326] as const;
/**
 * EPQS documented wkids are only 4326 and 102100. Runtime acceptance of 4269
 * was observed and is intentionally not treated as documentation.
 */
export const USGS_DOCUMENTED_WKIDS = [4326, 102100] as const;

export const REQUESTED_UNITS = ["Meters", "Feet"] as const;
export type RequestedUnit = (typeof REQUESTED_UNITS)[number];

/** Exact decimal, not a binary float. International foot, not US survey foot. */
export const INTERNATIONAL_FOOT_METERS = "0.3048";

/** Published MapServer maxRecordCount. A safety ceiling, not a coverage rule. */
export const FEATURE_PARSE_CEILING = 2000;

const FEMA_BLOCKING: ReadonlySet<UnknownReason> = new Set([
  "invalid_input",
  "timeout",
  "truncated",
  "provider_error",
  "malformed_response",
  "no_feature_unknown",
  "boundary_multiple",
]);

const USGS_BLOCKING: ReadonlySet<UnknownReason> = new Set([
  ...FEMA_BLOCKING,
  "missing_units",
  "nodata_unverified",
]);

const BLOCKING_PRIORITY: readonly UnknownReason[] = [
  "invalid_input",
  "timeout",
  "truncated",
  "provider_error",
  "malformed_response",
  "nodata_unverified",
  "missing_units",
  "no_feature_unknown",
  "boundary_multiple",
];

export const FEMA_DISCLAIMERS = [
  "not_a_flood_risk_probability_or_safety_determination",
  "not_an_insurance_legal_buildability_valuation_or_survey_conclusion",
  "point_or_uncomputed_geometry_is_not_a_whole_parcel",
  "area_percent_not_computed",
  "panel_effective_date_is_not_a_latest_lomr",
  "caller_metadata_is_not_source_authenticity_or_parcel_identity",
  "no_elevation_bfe_subtraction",
  "empty_or_failed_responses_are_not_zone_x",
] as const;

export const USGS_DISCLAIMERS = [
  "interpolated_elevation_is_not_a_survey_or_finished_floor",
  "not_an_insurance_legal_buildability_valuation_or_engineering_conclusion",
  "vertical_datum_unverified_unless_raster_metadata_supports_it",
  "resolution_unit_unknown",
  "explicit_feet_mean_international_feet",
  "no_universal_rmse_confidence_interval",
  "no_elevation_bfe_subtraction",
  "outside_coverage_nodata_encoding_not_live_verified",
  "caller_metadata_is_not_source_authenticity_or_parcel_identity",
  "undocumented_wkid_4269_is_not_accepted",
] as const;

export const PARSER_LIMITS = Object.freeze({
  fetches: false,
  parcel_aggregation: false,
  bfe_subtraction: false,
  flood_probability: false,
  insurance_legal_buildability_valuation_or_survey: false,
  default_zone_x_on_empty: false,
  default_srid: false,
  default_units: false,
  default_map_status: false,
  accepts_undocumented_epqs_wkid_4269: false,
  live_nodata_encoding_verified: false,
  vertical_datum_verified_from_caller_flag: false,
  area_percent: false,
  whole_parcel_from_point: false,
  coordinates_are_never_swapped: true,
  feature_parse_ceiling: FEATURE_PARSE_CEILING,
  feature_parse_ceiling_is_publisher_quota: false,
});

export type ParserFamily = "fema-nfhl" | "usgs-epqs";

export type EvidenceInput = {
  response?: unknown;
  request?: unknown;
};

export type GeometryAssessment = {
  semantics: GeometrySemantics | null;
  point_role: PointRole | null;
  declared_axis: DeclaredAxis | null;
  input_srid: number | null;
  returned_srid: number | null;
  returned_latest_srid: number | null;
  x: number | null;
  y: number | null;
  returned_x: number | null;
  returned_y: number | null;
  request_coordinates_validated: boolean;
  returned_location_match: SpatialMatch;
  returned_spatial_reference_match: SpatialMatch;
  covers_whole_parcel: false;
  parcel_geometry_digest: string | null;
  parcel_geometry_digest_verified: false;
};

export type RequestAssessment = {
  ok: boolean;
  reasons: UnknownReason[];
  details: string[];
  source_url: string | null;
  request_url: string | null;
  official_host_recognized: boolean;
  fetched_at: string | null;
  fetched_at_valid: boolean;
  http_status: number | null;
  timeout: boolean;
  transport_truncated: boolean;
  caller_supplied_response_hash: string | null;
  caller_asserts_commercial_scope: boolean;
  geometry: GeometryAssessment;
  map_status: MapStatus | null;
  map_status_verified: false;
  caller_asserted_map_status: MapStatus | null;
  map_status_conflict: boolean;
  overwrites_effective_observation: false;
  layer_id: number | null;
  result_record_cap: number | null;
  units: RequestedUnit | null;
  units_unrecognized: boolean;
  service_content_date_raw: string | null;
  caller_asserted_vertical_datum: string | null;
  bfe_present: boolean;
};

export type HashResult = {
  response_sha256: string | null;
  response_hash_basis: "response_text" | "json_stringify_parsed_value" | null;
};

export type DecodedBody =
  | { ok: true; value: unknown }
  | { ok: false; detail: "body_missing" | "body_not_json" };

export type StatusResolution = {
  status: EvidenceStatus;
  unknown_reason: UnknownReason | null;
  unknown_reasons: UnknownReason[];
};

export type RawDate = {
  raw: number | string | null;
  /** Date-only. Epoch instants use the UTC calendar day and are not shifted. */
  calendar_date: string | null;
  calendar_basis: "utc_epoch_day" | "date_only" | null;
  valid: boolean;
  invalid: boolean;
  guessed: false;
};

export type Comparability = {
  comparable_to_bfe: false;
  elevation_minus_bfe: null;
  flood_risk_probability: null;
  insurance_determination: null;
  legal_determination: null;
  buildability_determination: null;
  valuation_determination: null;
  survey_determination: null;
};

export const COMPARABILITY: Comparability = Object.freeze({
  comparable_to_bfe: false,
  elevation_minus_bfe: null,
  flood_risk_probability: null,
  insurance_determination: null,
  legal_determination: null,
  buildability_determination: null,
  valuation_determination: null,
  survey_determination: null,
});

const FEMA_HOSTS: ReadonlySet<string> = new Set([
  "hazards.fema.gov",
  "www.fema.gov",
  "fema.gov",
]);
const USGS_HOSTS: ReadonlySet<string> = new Set([
  "epqs.nationalmap.gov",
  "apps.nationalmap.gov",
]);
const FEMA_LAYERS: ReadonlySet<number> = new Set([28, 3, 1, 41]);
const MERCATOR_LIMIT = 20037508.342789244;
const UNIT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "n/a",
  "na",
  "null",
  "none",
  "unknown",
  "-",
  "—",
]);

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function addUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

export function orderReasons(
  reasons: readonly UnknownReason[],
): UnknownReason[] {
  const present = new Set(reasons);
  return UNKNOWN_REASONS.filter((reason) => present.has(reason));
}

export function resolveStatus(
  reasons: readonly UnknownReason[],
  family: ParserFamily,
): StatusResolution {
  const unknown_reasons = orderReasons(reasons);
  const blocking = family === "fema-nfhl" ? FEMA_BLOCKING : USGS_BLOCKING;
  let unknown_reason: UnknownReason | null = null;
  for (const reason of BLOCKING_PRIORITY) {
    if (blocking.has(reason) && unknown_reasons.includes(reason)) {
      unknown_reason = reason;
      break;
    }
  }
  let status: EvidenceStatus = "observed";
  if (unknown_reason === "invalid_input") status = "invalid";
  else if (unknown_reason === "boundary_multiple") status = "ambiguous";
  else if (unknown_reason !== null) status = "unknown";
  return {
    status,
    unknown_reason: status === "observed" ? null : unknown_reason,
    unknown_reasons,
  };
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashInput(input: EvidenceInput): HashResult {
  const request = isRecord(input.request) ? input.request : null;
  const text = request?.response_text;
  if (typeof text === "string") {
    return {
      response_sha256: sha256Hex(text),
      response_hash_basis: "response_text",
    };
  }
  if (input.response !== undefined) {
    try {
      const encoded = JSON.stringify(input.response);
      if (typeof encoded !== "string") {
        return { response_sha256: null, response_hash_basis: null };
      }
      return {
        response_sha256: sha256Hex(encoded),
        response_hash_basis: "json_stringify_parsed_value",
      };
    } catch {
      return { response_sha256: null, response_hash_basis: null };
    }
  }
  return { response_sha256: null, response_hash_basis: null };
}

export function decodeBody(input: EvidenceInput): DecodedBody {
  const request = isRecord(input.request) ? input.request : null;
  const text = request?.response_text;
  if (typeof text === "string") {
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, detail: "body_not_json" };
    }
  }
  if (input.response !== undefined) return { ok: true, value: input.response };
  return { ok: false, detail: "body_missing" };
}

export function strictFinite(
  value: unknown,
):
  | { ok: true; n: number }
  | { ok: false; kind: "missing" | "malformed" | "nonfinite" } {
  if (value === null || value === undefined)
    return { ok: false, kind: "missing" };
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, n: value }
      : { ok: false, kind: "nonfinite" };
  }
  if (typeof value !== "string") return { ok: false, kind: "malformed" };
  const token = value.trim();
  if (token.length === 0) return { ok: false, kind: "missing" };
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
    return { ok: false, kind: "malformed" };
  }
  const n = Number(token);
  return Number.isFinite(n)
    ? { ok: true, n }
    : { ok: false, kind: "nonfinite" };
}

export function cleanToken(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length === 0 || token.length > max || token.includes("@"))
    return null;
  return token;
}

export function placeholderUnit(value: unknown, max: number): string | null {
  const token = cleanToken(value, max);
  if (token === null) return null;
  if (UNIT_PLACEHOLDERS.has(token.toLowerCase())) return null;
  return token;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

export function calendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  if (year < 1950 || year > 2100 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function emptyDate(raw: number | string | null = null): RawDate {
  return {
    raw,
    calendar_date: null,
    calendar_basis: null,
    valid: false,
    invalid: false,
    guessed: false,
  };
}

export function invalidDate(raw: number | string | null): RawDate {
  return {
    raw,
    calendar_date: null,
    calendar_basis: null,
    valid: false,
    invalid: true,
    guessed: false,
  };
}

/** ISO `YYYY-MM-DD` or observed `M/D/YYYY`. Invalid tokens are not repaired. */
export function parseDateToken(value: unknown): RawDate {
  if (value === null || value === undefined || value === "") return emptyDate();
  if (typeof value !== "string") return invalidDate(null);
  const token = value.trim();
  if (token.length === 0 || token.length > 40 || token.includes("@")) {
    return invalidDate(null);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (iso) {
    const date = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (date === null) return invalidDate(token);
    return {
      raw: token,
      calendar_date: date,
      calendar_basis: "date_only",
      valid: true,
      invalid: false,
      guessed: false,
    };
  }
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(token);
  if (mdy) {
    const date = calendarDate(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
    if (date === null) return invalidDate(token);
    return {
      raw: token,
      calendar_date: date,
      calendar_basis: "date_only",
      valid: true,
      invalid: false,
      guessed: false,
    };
  }
  return invalidDate(token);
}

/**
 * English month labels stay date-only. `Date.parse` is not used, so the
 * calendar day cannot shift with the process timezone.
 */
export function parseServiceContentLabel(value: unknown): RawDate {
  const dated = parseDateToken(value);
  if (dated.valid || dated.raw === null) return dated;
  if (typeof value !== "string") return dated;
  const token = value.trim();
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(token);
  const monthName = match?.[1];
  const dayText = match?.[2];
  const yearText = match?.[3];
  if (
    monthName === undefined ||
    dayText === undefined ||
    yearText === undefined
  ) {
    return dated;
  }
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return invalidDate(token);
  const date = calendarDate(Number(yearText), month, Number(dayText));
  if (date === null) return invalidDate(token);
  return {
    raw: token,
    calendar_date: date,
    calendar_basis: "date_only",
    valid: true,
    invalid: false,
    guessed: false,
  };
}

export function parseEpochMilliseconds(value: unknown): RawDate {
  if (value === null || value === undefined || value === "") return emptyDate();
  let raw: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) raw = value;
  else if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    raw = Number(value.trim());
  }
  if (raw === null || !Number.isSafeInteger(raw)) {
    return invalidDate(
      typeof value === "string" ? cleanToken(value, 40) : null,
    );
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return invalidDate(raw);
  const date = calendarDate(
    instant.getUTCFullYear(),
    instant.getUTCMonth() + 1,
    instant.getUTCDate(),
  );
  if (date === null) return invalidDate(raw);
  return {
    raw,
    calendar_date: date,
    calendar_basis: "utc_epoch_day",
    valid: true,
    invalid: false,
    guessed: false,
  };
}

export function parseSourceDate(value: unknown): RawDate {
  if (typeof value === "number") return parseEpochMilliseconds(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return parseEpochMilliseconds(value);
  }
  return parseDateToken(value);
}

export function plausibleTerrain(
  value: number,
  unit: RequestedUnit | null,
): boolean {
  if (unit === "Feet") return Math.abs(value) * 3048 <= 100000000;
  if (unit === "Meters") return Math.abs(value) <= 10000;
  return false;
}

export function emptyGeometry(): GeometryAssessment {
  return {
    semantics: null,
    point_role: null,
    declared_axis: null,
    input_srid: null,
    returned_srid: null,
    returned_latest_srid: null,
    x: null,
    y: null,
    returned_x: null,
    returned_y: null,
    request_coordinates_validated: false,
    returned_location_match: "not_applicable",
    returned_spatial_reference_match: "not_applicable",
    covers_whole_parcel: false,
    parcel_geometry_digest: null,
    parcel_geometry_digest_verified: false,
  };
}

function parseHttpUrl(value: unknown): { url: URL; raw: string } | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length === 0 || token.length > 2000 || token.includes("@"))
    return null;
  try {
    const url = new URL(token);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { url, raw: token };
  } catch {
    return null;
  }
}

function readMapStatus(value: unknown): MapStatus | "bad" | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "effective" || value === "preliminary" || value === "pending") {
    return value;
  }
  return "bad";
}

function mapStatusFromPath(pathname: string): MapStatus | "conflict" | null {
  const path = pathname.toLowerCase();
  const pending = path.includes("/prelimpending/pending_nfhl/");
  const preliminary = path.includes("/prelimpending/prelim_nfhl/");
  const effective = path.includes("/public/nfhl/");
  const hits = Number(pending) + Number(preliminary) + Number(effective);
  if (hits > 1) return "conflict";
  if (pending) return "pending";
  if (preliminary) return "preliminary";
  if (effective) return "effective";
  return null;
}

function layerFromPath(pathname: string): number | null {
  const match = /\/mapserver\/(\d+)(?:\/|$)/i.exec(pathname);
  if (!match) return null;
  const layer = Number(match[1]);
  return Number.isInteger(layer) ? layer : null;
}

function readLayer(value: unknown): number | "bad" | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return "bad";
}

function readSrid(value: unknown): number | "bad" | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return "bad";
}

function readCap(value: unknown): number | "bad" | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value <= 100000 ? value : "bad";
  }
  return "bad";
}

function readUnits(value: unknown): RequestedUnit | "bad" | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "Meters" || value === "Feet") return value;
  return "bad";
}

function readMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | "bad" | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    for (const item of allowed) if (item === value) return item;
  }
  return "bad";
}

function validFetchedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      token,
    );
  if (!match) return null;
  if (
    calendarDate(Number(match[1]), Number(match[2]), Number(match[3])) === null
  ) {
    return null;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== "Z") {
    const offsetHour = Number(match[8]);
    const offsetMinute = Number(match[9]);
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  return token;
}

function digestOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(token)) return null;
  return token;
}

function coordinateError(
  value: unknown,
): "missing" | "malformed" | "nonfinite" | null {
  const parsed = strictFinite(value);
  if (parsed.ok) return null;
  return parsed.kind;
}

export function assessRequest(
  request: unknown,
  family: ParserFamily,
): RequestAssessment {
  const reasons: UnknownReason[] = [];
  const details: string[] = [];
  const geometry = emptyGeometry();
  const result: RequestAssessment = {
    ok: false,
    reasons,
    details,
    source_url: null,
    request_url: null,
    official_host_recognized: false,
    fetched_at: null,
    fetched_at_valid: false,
    http_status: null,
    timeout: false,
    transport_truncated: false,
    caller_supplied_response_hash: null,
    caller_asserts_commercial_scope: false,
    geometry,
    map_status: null,
    map_status_verified: false,
    caller_asserted_map_status: null,
    map_status_conflict: false,
    overwrites_effective_observation: false,
    layer_id: null,
    result_record_cap: null,
    units: null,
    units_unrecognized: false,
    service_content_date_raw: null,
    caller_asserted_vertical_datum: null,
    bfe_present: false,
  };
  if (!isRecord(request)) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "request_missing");
    return result;
  }

  const requestUrl = parseHttpUrl(request.request_url);
  if (requestUrl === null) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "request_url_invalid");
  } else {
    result.request_url = requestUrl.raw;
  }
  let sourceUrl: { url: URL; raw: string } | null = null;
  if (request.source_url !== undefined && request.source_url !== null) {
    sourceUrl = parseHttpUrl(request.source_url);
    if (sourceUrl === null) {
      addUnique(reasons, "invalid_input");
      addUnique(details, "source_url_invalid");
    } else {
      result.source_url = sourceUrl.raw;
    }
  }
  const hosts = family === "fema-nfhl" ? FEMA_HOSTS : USGS_HOSTS;
  result.official_host_recognized = [requestUrl, sourceUrl].some(
    (parsed) => parsed !== null && hosts.has(parsed.url.hostname.toLowerCase()),
  );

  const fetched = validFetchedAt(request.fetched_at);
  if (fetched === null) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "fetched_at_missing_or_not_zoned");
  } else {
    result.fetched_at = fetched;
    result.fetched_at_valid = true;
  }

  if (request.timeout === true) result.timeout = true;
  else if (request.timeout !== undefined && request.timeout !== false) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "timeout_not_boolean");
  }
  if (request.transport_truncated === true) result.transport_truncated = true;
  else if (
    request.transport_truncated !== undefined &&
    request.transport_truncated !== false
  ) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "transport_truncated_not_boolean");
  }

  const http = request.http_status;
  if (
    typeof http === "number" &&
    Number.isInteger(http) &&
    http >= 100 &&
    http <= 599
  ) {
    result.http_status = http;
  } else if (http === undefined || http === null) {
    if (!result.timeout) {
      addUnique(reasons, "invalid_input");
      addUnique(details, "http_status_invalid");
    }
  } else {
    addUnique(reasons, "invalid_input");
    addUnique(details, "http_status_invalid");
  }

  const hash = cleanToken(request.response_hash, 128);
  if (typeof request.response_hash === "string" && hash === null) {
    addUnique(details, "caller_response_hash_ignored");
  }
  result.caller_supplied_response_hash =
    hash !== null && /^[a-f0-9]{64}$/.test(hash) ? hash : null;

  result.caller_asserts_commercial_scope =
    request.commercial_scope_validated === true;
  result.bfe_present = request.bfe !== undefined && request.bfe !== null;
  result.service_content_date_raw = cleanToken(
    request.service_content_date,
    40,
  );
  result.caller_asserted_vertical_datum = cleanToken(
    request.caller_asserted_vertical_datum,
    40,
  );

  const semantics = readMember(request.semantics, GEOMETRY_SEMANTICS);
  if (semantics === null) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "geometry_semantics_missing");
  } else if (semantics === "bad") {
    addUnique(reasons, "invalid_input");
    addUnique(details, "geometry_semantics_invalid");
  } else {
    geometry.semantics = semantics;
  }
  const role = readMember(request.point_role, POINT_ROLES);
  if (role === "bad") {
    addUnique(reasons, "invalid_input");
    addUnique(details, "point_role_invalid");
  } else if (role === null && geometry.semantics === "point") {
    addUnique(reasons, "invalid_input");
    addUnique(details, "point_role_missing");
  } else if (role !== null) {
    geometry.point_role = role;
  }
  const axis = readMember(request.declared_axis, DECLARED_AXES);
  if (axis === "bad") {
    addUnique(reasons, "invalid_input");
    addUnique(details, "declared_axis_invalid");
  } else {
    geometry.declared_axis = axis;
  }
  geometry.parcel_geometry_digest = digestOf(request.parcel_geometry_digest);

  const srid = readSrid(request.input_srid);
  const allowed: readonly number[] =
    family === "fema-nfhl" ? FEMA_INPUT_SRIDS : USGS_DOCUMENTED_WKIDS;
  if (srid === null) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "srid_missing");
    addUnique(details, "no_default_srid");
  } else if (srid === "bad" || !allowed.includes(srid)) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "srid_unrecognized");
    if (family === "usgs-epqs" && srid === 4269) {
      addUnique(details, "wkid_4269_not_documented");
    }
  } else {
    geometry.input_srid = srid;
  }

  if (
    geometry.input_srid !== null &&
    geometry.declared_axis === "longitude_latitude" &&
    geometry.input_srid === 102100
  ) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "axis_incompatible_with_srid");
  }
  if (
    geometry.input_srid !== null &&
    geometry.declared_axis === "easting_northing" &&
    (geometry.input_srid === 4269 || geometry.input_srid === 4326)
  ) {
    addUnique(reasons, "invalid_input");
    addUnique(details, "axis_incompatible_with_srid");
  }

  const xError = coordinateError(request.x);
  const yError = coordinateError(request.y);
  if (
    family === "usgs-epqs" &&
    (request.y === undefined || request.y === null || request.y === "")
  ) {
    addUnique(details, "missing_y_http_400_expected_by_docs_not_live_verified");
  }
  if (xError !== null || yError !== null) {
    addUnique(reasons, "invalid_input");
    addUnique(
      details,
      xError === "missing" || yError === "missing"
        ? "coordinate_missing"
        : xError === "nonfinite" || yError === "nonfinite"
          ? "coordinate_nonfinite"
          : "coordinate_malformed",
    );
    addUnique(details, "coordinate_not_swapped");
  } else if (geometry.input_srid !== null) {
    const x = strictFinite(request.x);
    const y = strictFinite(request.y);
    if (x.ok && y.ok) {
      const geographic =
        geometry.input_srid === 4269 || geometry.input_srid === 4326;
      const inRange = geographic
        ? x.n >= -180 && x.n <= 180 && y.n >= -90 && y.n <= 90
        : Math.abs(x.n) <= MERCATOR_LIMIT && Math.abs(y.n) <= MERCATOR_LIMIT;
      if (!inRange) {
        addUnique(reasons, "invalid_input");
        addUnique(details, "coordinate_out_of_range");
        addUnique(details, "coordinate_not_swapped");
      } else {
        geometry.x = x.n;
        geometry.y = y.n;
        geometry.request_coordinates_validated = true;
      }
    }
  }

  if (family === "fema-nfhl") {
    const asserted = readMapStatus(request.map_status);
    if (asserted === "bad") {
      addUnique(reasons, "invalid_input");
      addUnique(details, "map_status_unrecognized");
    } else {
      result.caller_asserted_map_status = asserted;
    }
    const fromUrl =
      requestUrl === null ? null : mapStatusFromPath(requestUrl.url.pathname);
    if (fromUrl === "conflict") {
      addUnique(reasons, "invalid_input");
      addUnique(details, "map_status_url_conflict");
    } else if (
      fromUrl !== null &&
      asserted !== null &&
      asserted !== "bad" &&
      asserted !== fromUrl
    ) {
      result.map_status_conflict = true;
      addUnique(reasons, "invalid_input");
      addUnique(details, "map_status_conflict");
    } else {
      result.map_status = fromUrl;
      if (fromUrl === null) addUnique(details, "no_default_map_status");
    }
    const layer = readLayer(request.layer_id);
    const urlLayer =
      requestUrl === null ? null : layerFromPath(requestUrl.url.pathname);
    if (layer === null) {
      addUnique(reasons, "invalid_input");
      addUnique(details, "layer_id_missing");
    } else if (layer === "bad" || !FEMA_LAYERS.has(layer)) {
      addUnique(reasons, "invalid_input");
      addUnique(details, "layer_id_not_interpreted");
    } else if (urlLayer !== null && urlLayer !== layer) {
      addUnique(reasons, "invalid_input");
      addUnique(details, "layer_id_url_conflict");
    } else {
      result.layer_id = layer;
    }
  }

  const units = readUnits(request.units);
  if (units === "bad") {
    result.units_unrecognized = true;
    if (family === "usgs-epqs") addUnique(details, "units_unrecognized");
  } else if (units === null) {
    if (family === "usgs-epqs") addUnique(details, "no_default_units");
  } else {
    result.units = units;
  }

  const cap = readCap(request.result_record_cap);
  if (cap === "bad") {
    addUnique(reasons, "invalid_input");
    addUnique(details, "result_record_cap_invalid");
  } else {
    result.result_record_cap = cap;
  }

  result.ok = !reasons.includes("invalid_input");
  return result;
}

export function providerErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const error = value.error;
  const message = isRecord(error)
    ? error.message
    : typeof error === "string"
      ? error
      : null;
  return cleanToken(message, 200);
}

export function hasProviderError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const error = value.error;
  if (error === null || error === undefined || error === false) return false;
  if (typeof error === "string") return error.trim().length > 0;
  if (typeof error === "number") return Number.isFinite(error);
  return typeof error === "object";
}

export function exceededTransfer(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const flag = value.exceededTransferLimit;
  return flag === true || flag === 1 || flag === "true";
}

export function readFeatures(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null;
  return Array.isArray(value.features) ? value.features : null;
}

export function featureAttributes(
  feature: unknown,
): Record<string, unknown> | null {
  if (!isRecord(feature)) return null;
  if (isRecord(feature.attributes)) return feature.attributes;
  if (isRecord(feature.properties)) return feature.properties;
  return null;
}

export function readWkid(value: unknown): number | null {
  const srid = readSrid(value);
  return typeof srid === "number" ? srid : null;
}

export function locationsMatch(
  left: number,
  right: number,
  srid: number,
): boolean {
  const tolerance = srid === 102100 ? 0.05 : 1e-5;
  return Math.abs(left - right) <= tolerance;
}

export function httpFailure(status: number | null): boolean {
  return status !== 200;
}
