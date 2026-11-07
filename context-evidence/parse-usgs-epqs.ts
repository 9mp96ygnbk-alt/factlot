/**
 * Pure parser for a caller-supplied USGS EPQS `/v1/json` response.
 *
 * Documented wkids are 4326 and 102100. Observed acceptance of 4269 is not
 * treated as documentation. Feet are international feet. Resolution units and
 * vertical datum stay unknown unless a later, separate raster-metadata parse
 * supports them. This function does not fetch and does not subtract BFE.
 */
import {
  COMPARABILITY,
  INTERNATIONAL_FOOT_METERS,
  PARSER_LIMITS,
  SCHEMA_VERSION,
  SOURCE_EVIDENCE_CHECKED,
  USGS_CREDIT,
  USGS_DISCLAIMERS,
  USGS_ELEVATION_FAQ_URL,
  USGS_EPQS_DOCS_URL,
  USGS_EPQS_PARSER_VERSION,
  addUnique,
  assessRequest,
  cleanToken,
  decodeBody,
  hasProviderError,
  hashInput,
  httpFailure,
  isRecord,
  locationsMatch,
  parseDateToken,
  parseServiceContentLabel,
  plausibleTerrain,
  providerErrorMessage,
  readWkid,
  resolveStatus,
  strictFinite,
} from "./contracts.ts";
import type {
  Comparability,
  EvidenceInput,
  EvidenceStatus,
  GeometryAssessment,
  RawDate,
  RequestedUnit,
  RequestAssessment,
  UnknownReason,
} from "./contracts.ts";

const RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "location",
  "locationId",
  "value",
  "rasterId",
  "resolution",
  "attributes",
]);

export type ElevationReading = {
  raw: number | string | null;
  parsed: number | null;
  requested_unit: RequestedUnit | null;
  linear_unit: "meter" | "international_foot" | null;
  /** Exact decimal string. The elevation itself is not converted. */
  exact_meters_per_unit: "1" | typeof INTERNATIONAL_FOOT_METERS | null;
  us_survey_foot_assumed: false;
  usable_as_contextual_elevation: boolean;
  vertical_datum: null;
  vertical_datum_verified: false;
  caller_asserted_vertical_datum: string | null;
  zero_can_be_valid_terrain: true;
  negative_can_be_valid_terrain: true;
  nodata_encoding_live_verified: false;
  confidence_interval_meters: null;
};

export type UsgsEpqsEvidence = {
  schema_version: typeof SCHEMA_VERSION;
  parser_version: typeof USGS_EPQS_PARSER_VERSION;
  provider: "USGS";
  product: "EPQS";
  credit: typeof USGS_CREDIT;
  citations: {
    docs: typeof USGS_EPQS_DOCS_URL;
    accuracy_faq: typeof USGS_ELEVATION_FAQ_URL;
    terms_checked: typeof SOURCE_EVIDENCE_CHECKED;
  };
  documented_wkids: readonly [4326, 102100];
  accepted_undocumented_wkid_4269: false;
  source_url: string | null;
  request_url: string | null;
  official_host_recognized: boolean;
  source_authenticity_verified: false;
  fetched_at: string | null;
  fetched_at_valid: boolean;
  http_status: number | null;
  timeout: boolean;
  response_sha256: string | null;
  response_hash_basis: "response_text" | "json_stringify_parsed_value" | null;
  caller_supplied_response_hash: string | null;
  status: EvidenceStatus;
  unknown_reason: UnknownReason | null;
  unknown_reasons: UnknownReason[];
  details: string[];
  parcel_identity_verified: false;
  commercial_scope_verified: false;
  caller_asserts_commercial_scope: boolean;
  geometry: GeometryAssessment;
  comparability: Comparability;
  limits: typeof PARSER_LIMITS;
  disclaimers: typeof USGS_DISCLAIMERS;
  body_used: boolean;
  withheld_non_context_attributes: boolean;
  provider_error_message: string | null;
  location_id: string | null;
  raster_id: number | string | null;
  resolution: {
    raw: number | string | null;
    parsed: number | null;
    unit: null;
    unit_known: false;
  };
  acquisition_date: RawDate;
  service_content_date: RawDate;
  service_content_date_used_as_acquisition: false;
  elevation: ElevationReading | null;
};

function emptyElevation(request: RequestAssessment): ElevationReading {
  return {
    raw: null,
    parsed: null,
    requested_unit: request.units,
    linear_unit:
      request.units === "Meters"
        ? "meter"
        : request.units === "Feet"
          ? "international_foot"
          : null,
    exact_meters_per_unit:
      request.units === "Meters"
        ? "1"
        : request.units === "Feet"
          ? INTERNATIONAL_FOOT_METERS
          : null,
    us_survey_foot_assumed: false,
    usable_as_contextual_elevation: false,
    vertical_datum: null,
    vertical_datum_verified: false,
    caller_asserted_vertical_datum: request.caller_asserted_vertical_datum,
    zero_can_be_valid_terrain: true,
    negative_can_be_valid_terrain: true,
    nodata_encoding_live_verified: false,
    confidence_interval_meters: null,
  };
}

function envelope(
  request: RequestAssessment,
  hash: ReturnType<typeof hashInput>,
  reasons: UnknownReason[],
  details: string[],
  bodyUsed: boolean,
  withheld: boolean,
  providerMessage: string | null,
  geometry: GeometryAssessment,
  elevation: ElevationReading | null,
  locationId: string | null,
  rasterId: number | string | null,
  resolution: UsgsEpqsEvidence["resolution"],
  acquisition: RawDate,
  serviceContent: RawDate,
): UsgsEpqsEvidence {
  const resolved = resolveStatus(reasons, "usgs-epqs");
  return {
    schema_version: SCHEMA_VERSION,
    parser_version: USGS_EPQS_PARSER_VERSION,
    provider: "USGS",
    product: "EPQS",
    credit: USGS_CREDIT,
    citations: {
      docs: USGS_EPQS_DOCS_URL,
      accuracy_faq: USGS_ELEVATION_FAQ_URL,
      terms_checked: SOURCE_EVIDENCE_CHECKED,
    },
    documented_wkids: [4326, 102100],
    accepted_undocumented_wkid_4269: false,
    source_url: request.source_url,
    request_url: request.request_url,
    official_host_recognized: request.official_host_recognized,
    source_authenticity_verified: false,
    fetched_at: request.fetched_at,
    fetched_at_valid: request.fetched_at_valid,
    http_status: request.http_status,
    timeout: request.timeout,
    response_sha256: hash.response_sha256,
    response_hash_basis: hash.response_hash_basis,
    caller_supplied_response_hash: request.caller_supplied_response_hash,
    status: resolved.status,
    unknown_reason: resolved.unknown_reason,
    unknown_reasons: resolved.unknown_reasons,
    details,
    parcel_identity_verified: false,
    commercial_scope_verified: false,
    caller_asserts_commercial_scope: request.caller_asserts_commercial_scope,
    geometry,
    comparability: COMPARABILITY,
    limits: PARSER_LIMITS,
    disclaimers: USGS_DISCLAIMERS,
    body_used: bodyUsed,
    withheld_non_context_attributes: withheld,
    provider_error_message: providerMessage,
    location_id: locationId,
    raster_id: rasterId,
    resolution,
    acquisition_date: acquisition,
    service_content_date: serviceContent,
    service_content_date_used_as_acquisition: false,
    elevation,
  };
}

function readId(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return cleanToken(value, 64);
}

function resolutionOf(value: unknown): UsgsEpqsEvidence["resolution"] {
  const parsed = strictFinite(value);
  return {
    raw:
      typeof value === "number" && Number.isFinite(value)
        ? value
        : cleanToken(value, 64),
    parsed: parsed.ok ? parsed.n : null,
    unit: null,
    unit_known: false,
  };
}

export function parseUsgsEpqs(input: EvidenceInput = {}): UsgsEpqsEvidence {
  const request = assessRequest(input.request, "usgs-epqs");
  const hash = hashInput(input);
  const reasons = [...request.reasons];
  const details = [...request.details];
  const geometry: GeometryAssessment = { ...request.geometry };
  const serviceContent = parseServiceContentLabel(
    request.service_content_date_raw,
  );
  let acquisition = parseDateToken(undefined);
  let elevation: ElevationReading | null = null;
  let locationId: string | null = null;
  let rasterId: number | string | null = null;
  let resolution = resolutionOf(undefined);
  let withheld = false;

  const finish = (
    bodyUsed: boolean,
    providerMessage: string | null = null,
  ): UsgsEpqsEvidence =>
    envelope(
      request,
      hash,
      reasons,
      details,
      bodyUsed,
      withheld,
      providerMessage,
      geometry,
      elevation,
      locationId,
      rasterId,
      resolution,
      acquisition,
      serviceContent,
    );

  if (request.bfe_present) addUnique(details, "bfe_subtraction_refused");
  if (request.caller_asserted_vertical_datum !== null) {
    addUnique(details, "caller_datum_not_verified");
  }
  if (!request.ok) return finish(false);
  if (request.timeout) {
    addUnique(reasons, "timeout");
    return finish(false);
  }
  if (request.transport_truncated) {
    addUnique(reasons, "truncated");
    if (httpFailure(request.http_status)) addUnique(reasons, "provider_error");
    return finish(false);
  }
  if (httpFailure(request.http_status)) {
    addUnique(reasons, "provider_error");
    return finish(false);
  }

  const decoded = decodeBody(input);
  if (!decoded.ok || !isRecord(decoded.value)) {
    addUnique(reasons, "malformed_response");
    addUnique(details, decoded.ok ? "body_not_object" : decoded.detail);
    return finish(decoded.ok);
  }
  if (hasProviderError(decoded.value)) {
    addUnique(reasons, "provider_error");
    addUnique(details, "provider_error_object");
    return finish(true, providerErrorMessage(decoded.value));
  }
  for (const key of Object.keys(decoded.value)) {
    if (!RESPONSE_KEYS.has(key)) withheld = true;
  }
  if (
    Object.hasOwn(decoded.value, "verticalDatum") ||
    Object.hasOwn(decoded.value, "resolutionUnit")
  ) {
    withheld = true;
    addUnique(details, "response_datum_or_resolution_unit_not_accepted");
  }

  const reading = emptyElevation(request);
  const parsed = strictFinite(decoded.value.value);
  if (!parsed.ok) {
    addUnique(reasons, "malformed_response");
    addUnique(
      details,
      parsed.kind === "missing"
        ? "value_missing"
        : parsed.kind === "nonfinite"
          ? "value_nonfinite"
          : "value_malformed",
    );
  } else {
    reading.raw =
      typeof decoded.value.value === "number"
        ? decoded.value.value
        : cleanToken(decoded.value.value, 64);
    reading.parsed = parsed.n;
    if (request.units === null) {
      addUnique(reasons, "missing_units");
    } else if (!plausibleTerrain(parsed.n, request.units)) {
      addUnique(reasons, "nodata_unverified");
      addUnique(details, "sentinel_unverified");
      addUnique(details, "nodata_encoding_not_live_verified");
    }
  }

  const location = isRecord(decoded.value.location)
    ? decoded.value.location
    : null;
  const spatial =
    location !== null && isRecord(location.spatialReference)
      ? location.spatialReference
      : null;
  const returnedX =
    location === null ? strictFinite(undefined) : strictFinite(location.x);
  const returnedY =
    location === null ? strictFinite(undefined) : strictFinite(location.y);
  const returnedWkid = spatial === null ? null : readWkid(spatial.wkid);
  const returnedLatest = spatial === null ? null : readWkid(spatial.latestWkid);
  geometry.returned_srid = returnedWkid;
  geometry.returned_latest_srid = returnedLatest;
  if (returnedX.ok && returnedY.ok) {
    geometry.returned_x = returnedX.n;
    geometry.returned_y = returnedY.n;
  }
  if (returnedWkid === null || geometry.input_srid === null) {
    geometry.returned_spatial_reference_match = "not_returned";
    addUnique(reasons, "malformed_response");
    addUnique(details, "spatial_reference_not_returned");
  } else if (returnedWkid !== geometry.input_srid) {
    geometry.returned_spatial_reference_match = "mismatch";
    addUnique(reasons, "malformed_response");
    addUnique(details, "spatial_reference_mismatch");
  } else {
    geometry.returned_spatial_reference_match = "match";
    if (returnedLatest !== null && returnedLatest !== returnedWkid) {
      addUnique(details, "latest_wkid_recorded_not_relabeled");
    }
  }
  if (
    geometry.x === null ||
    geometry.y === null ||
    !returnedX.ok ||
    !returnedY.ok ||
    geometry.input_srid === null
  ) {
    geometry.returned_location_match = "not_returned";
    addUnique(reasons, "malformed_response");
    addUnique(details, "location_not_returned");
  } else if (
    !locationsMatch(geometry.x, returnedX.n, geometry.input_srid) ||
    !locationsMatch(geometry.y, returnedY.n, geometry.input_srid)
  ) {
    geometry.returned_location_match = "mismatch";
    addUnique(reasons, "malformed_response");
    addUnique(details, "location_mismatch");
  } else {
    geometry.returned_location_match = "match";
  }

  locationId = cleanToken(decoded.value.locationId, 80);
  rasterId = readId(decoded.value.rasterId);
  resolution = resolutionOf(decoded.value.resolution);
  addUnique(details, "resolution_unit_unknown");

  const attributes = isRecord(decoded.value.attributes)
    ? decoded.value.attributes
    : null;
  if (attributes !== null) {
    for (const key of Object.keys(attributes)) {
      if (key !== "AcquisitionDate") withheld = true;
    }
    acquisition = parseDateToken(attributes.AcquisitionDate);
  } else if (decoded.value.AcquisitionDate !== undefined) {
    acquisition = parseDateToken(decoded.value.AcquisitionDate);
  }
  if (acquisition.invalid) {
    addUnique(reasons, "invalid_source_date");
    addUnique(details, "acquisition_date_invalid");
  } else if (!acquisition.valid) {
    addUnique(details, "acquisition_date_missing");
  }

  const aligned =
    geometry.returned_location_match === "match" &&
    geometry.returned_spatial_reference_match === "match" &&
    request.units !== null &&
    parsed.ok &&
    plausibleTerrain(parsed.n, request.units);
  reading.usable_as_contextual_elevation = aligned;
  if (aligned || parsed.ok) addUnique(reasons, "datum_unknown");
  elevation = reading;
  if (!aligned) reading.usable_as_contextual_elevation = false;
  return finish(true);
}
