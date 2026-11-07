/**
 * Pure parser for a caller-supplied FEMA NFHL query response.
 *
 * Interprets effective, preliminary, or pending MapServer layers 28, 3, 1,
 * and 41. It does not fetch, does not decide insurance or safety, and does
 * not turn an empty or failed response into zone X.
 */
import {
  COMPARABILITY,
  FEMA_CREDIT,
  FEMA_DISCLAIMERS,
  FEMA_NFHL_INFO_URL,
  FEMA_NFHL_PARSER_VERSION,
  FEMA_SERVICE_GUIDE_URL,
  FEATURE_PARSE_CEILING,
  PARSER_LIMITS,
  SCHEMA_VERSION,
  SOURCE_EVIDENCE_CHECKED,
  addUnique,
  assessRequest,
  cleanToken,
  decodeBody,
  exceededTransfer,
  featureAttributes,
  hasProviderError,
  hashInput,
  httpFailure,
  isRecord,
  parseSourceDate,
  placeholderUnit,
  providerErrorMessage,
  readFeatures,
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
  RequestAssessment,
  UnknownReason,
} from "./contracts.ts";

const FLOOD_KEYS: ReadonlySet<string> = new Set([
  "GFID",
  "OBJECTID",
  "DFIRM_ID",
  "VERSION_ID",
  "FLD_AR_ID",
  "STUDY_TYP",
  "FLD_ZONE",
  "ZONE_SUBTY",
  "SFHA_TF",
  "STATIC_BFE",
  "V_DATUM",
  "DEPTH",
  "LEN_UNIT",
  "VELOCITY",
  "VEL_UNIT",
  "SOURCE_CIT",
  "DUAL_ZONE",
  "AR_REVERT",
  "AR_SUBTRV",
  "BFE_REVERT",
  "DEP_REVERT",
  "GLOBALID",
]);

const PANEL_KEYS: ReadonlySet<string> = new Set([
  "FIRM_PAN",
  "EFF_DATE",
  "PRE_DATE",
  "PANEL_TYP",
  "SCALE",
  "SOURCE_CIT",
  "FIRM_ID",
  "PANEL",
  "SUFFIX",
]);

const LOMR_KEYS: ReadonlySet<string> = new Set([
  "CASE_NO",
  "STATUS",
  "EFF_DATE",
  "LOMR_ID",
]);

const STUDY_KEYS: ReadonlySet<string> = new Set([
  "INDX_EFFDT",
  "DBREV_DT",
  "H_DATUM",
  "V_DATUM",
  "SOURCE_CIT",
]);

export type ZoneClass =
  "x" | "d_undetermined" | "ani" | "np" | "open_water" | "named" | "missing";

export type SourceMeasure = {
  raw: number | string | null;
  parsed: number | null;
  sentinel_minus_9999: boolean;
  unit_raw: string | null;
  vertical_datum_raw: string | null;
  vertical_datum_source_stated: boolean;
  vertical_datum_verified: false;
  usable_as_source_stated_measure: boolean;
  comparable_to_dem_or_bfe: false;
};

export type FloodFeature = {
  gfid: string | null;
  object_id: number | string | null;
  object_id_stable_across_refreshes: false;
  global_id: string | null;
  dfirm_id: string | null;
  version_id: string | null;
  fld_ar_id: string | null;
  study_type: string | null;
  study_type_is_zone: false;
  fld_zone_raw: string | null;
  zone_subtype_raw: string | null;
  zone_class: ZoneClass;
  minimal_hazard_context: boolean;
  no_flood_risk: false;
  sfha_source: boolean | null;
  sfha_source_is_safety_determination: false;
  static_bfe: SourceMeasure;
  depth: SourceMeasure;
  velocity: SourceMeasure;
  source_citation: string | null;
  dual_zone_raw: string | null;
  ar_revert_raw: number | string | null;
  ar_subtrv_raw: number | string | null;
  bfe_revert_raw: number | string | null;
  dep_revert_raw: number | string | null;
  revert_measures_usable: false;
};

export type PanelFeature = {
  firm_pan: string | null;
  panel_type: string | null;
  scale_raw: number | string | null;
  source_citation: string | null;
  effective_date: RawDate;
  preliminary_date: RawDate;
  preliminary_date_sets_map_status: false;
  latest_lomr_date: null;
  latest_lomr_date_known: false;
};

export type LomrFeature = {
  case_number: string | null;
  case_status_raw: string | null;
  case_status_sets_map_status: false;
  lomr_id: string | null;
  effective_date: RawDate;
};

export type StudyFeature = {
  index_effective_date: RawDate;
  database_revision_date: RawDate;
  horizontal_datum_raw: string | null;
  vertical_datum_raw: string | null;
  vertical_datum_verified: false;
  source_citation: string | null;
  collapsed_updated_at: null;
};

export type FemaNfhlEvidence = {
  schema_version: typeof SCHEMA_VERSION;
  parser_version: typeof FEMA_NFHL_PARSER_VERSION;
  provider: "FEMA";
  product: "NFHL";
  credit: typeof FEMA_CREDIT;
  citations: {
    nfhl: typeof FEMA_NFHL_INFO_URL;
    service_guide: typeof FEMA_SERVICE_GUIDE_URL;
    terms_checked: typeof SOURCE_EVIDENCE_CHECKED;
  };
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
  map_status: RequestAssessment["map_status"];
  map_status_verified: false;
  caller_asserted_map_status: RequestAssessment["caller_asserted_map_status"];
  map_status_conflict: boolean;
  overwrites_effective_observation: false;
  retrieval_is_map_effective_date: false;
  layer_id: number | null;
  parcel_identity_verified: false;
  commercial_scope_verified: false;
  caller_asserts_commercial_scope: boolean;
  geometry: GeometryAssessment;
  comparability: Comparability;
  limits: typeof PARSER_LIMITS;
  disclaimers: typeof FEMA_DISCLAIMERS;
  body_used: boolean;
  withheld_non_context_attributes: boolean;
  provider_error_message: string | null;
  completeness: {
    complete: boolean;
    exceeded_transfer_limit: boolean;
    transport_truncated: boolean;
    result_record_cap: number | null;
    feature_count: number | null;
    above_feature_parse_ceiling: boolean;
  };
  flood: {
    queried: boolean;
    features: FloodFeature[];
    determination_allowed: boolean;
    contextual_list_allowed: boolean;
    single_zone_determination: boolean;
    area_percent: null;
    parcel_floodplain_label: null;
    assumed_zone: null;
    assumed_sfha: null;
    latest_lomr_date: null;
    lomr_applicability_known: false;
  };
  panels: {
    queried: boolean;
    features: PanelFeature[];
    contextual_list_allowed: boolean;
  };
  lomrs: {
    queried: boolean;
    features: LomrFeature[];
    contextual_list_allowed: boolean;
  };
  study_info: {
    queried: boolean;
    features: StudyFeature[];
    contextual_list_allowed: boolean;
  };
};

function sourceId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  return cleanToken(value, 80);
}

function objectId(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return cleanToken(value, 80);
}

function rawScalar(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return cleanToken(value, 80);
}

function classifyZone(raw: string | null): ZoneClass {
  if (raw === null) return "missing";
  const zone = raw.toUpperCase().replace(/\s+/g, " ");
  if (zone === "X") return "x";
  if (zone === "D") return "d_undetermined";
  if (zone === "ANI") return "ani";
  if (zone === "NP") return "np";
  if (zone === "OW" || zone === "OPEN WATER") return "open_water";
  return "named";
}

function sfhaSource(value: unknown): boolean | null {
  const token = cleanToken(value, 8);
  if (token === null) return null;
  const upper = token.toUpperCase();
  if (upper === "T") return true;
  if (upper === "F") return false;
  return null;
}

function measure(
  rawValue: unknown,
  unitValue: unknown,
  datumValue: unknown,
  requireDatum: boolean,
): SourceMeasure {
  const parsed = strictFinite(rawValue);
  const number = parsed.ok ? parsed.n : null;
  const sentinel = number === -9999;
  const unit = placeholderUnit(unitValue, 40);
  const datum = placeholderUnit(datumValue, 40);
  const usable =
    number !== null &&
    !sentinel &&
    unit !== null &&
    (!requireDatum || datum !== null);
  return {
    raw: rawScalar(rawValue),
    parsed: sentinel ? null : number,
    sentinel_minus_9999: sentinel,
    unit_raw: unit,
    vertical_datum_raw: requireDatum ? datum : null,
    vertical_datum_source_stated: requireDatum && datum !== null,
    vertical_datum_verified: false,
    usable_as_source_stated_measure: usable,
    comparable_to_dem_or_bfe: false,
  };
}

function scanKeys(
  attributes: Record<string, unknown>,
  allow: ReadonlySet<string>,
): { withheld: boolean; shapeIgnored: boolean } {
  let withheld = false;
  let shapeIgnored = false;
  for (const key of Object.keys(attributes)) {
    if (allow.has(key)) continue;
    withheld = true;
    if (/area|length/i.test(key)) shapeIgnored = true;
  }
  return { withheld, shapeIgnored };
}

function floodFeature(attributes: Record<string, unknown>): FloodFeature {
  const zone = cleanToken(attributes.FLD_ZONE, 40);
  const subtype = cleanToken(attributes.ZONE_SUBTY, 300);
  const zoneClass = classifyZone(zone);
  const minimal =
    zoneClass === "x" &&
    subtype !== null &&
    subtype.toUpperCase().includes("MINIMAL FLOOD HAZARD");
  return {
    gfid: sourceId(attributes.GFID),
    object_id: objectId(attributes.OBJECTID),
    object_id_stable_across_refreshes: false,
    global_id: sourceId(attributes.GLOBALID),
    dfirm_id: sourceId(attributes.DFIRM_ID),
    version_id: sourceId(attributes.VERSION_ID),
    fld_ar_id: sourceId(attributes.FLD_AR_ID),
    study_type: cleanToken(attributes.STUDY_TYP, 40),
    study_type_is_zone: false,
    fld_zone_raw: zone,
    zone_subtype_raw: subtype,
    zone_class: zoneClass,
    minimal_hazard_context: minimal,
    no_flood_risk: false,
    sfha_source: sfhaSource(attributes.SFHA_TF),
    sfha_source_is_safety_determination: false,
    static_bfe: measure(
      attributes.STATIC_BFE,
      attributes.LEN_UNIT,
      attributes.V_DATUM,
      true,
    ),
    depth: measure(
      attributes.DEPTH,
      attributes.LEN_UNIT,
      attributes.V_DATUM,
      true,
    ),
    velocity: measure(attributes.VELOCITY, attributes.VEL_UNIT, null, false),
    source_citation: cleanToken(attributes.SOURCE_CIT, 120),
    dual_zone_raw: cleanToken(attributes.DUAL_ZONE, 40),
    ar_revert_raw: rawScalar(attributes.AR_REVERT),
    ar_subtrv_raw: rawScalar(attributes.AR_SUBTRV),
    bfe_revert_raw: rawScalar(attributes.BFE_REVERT),
    dep_revert_raw: rawScalar(attributes.DEP_REVERT),
    revert_measures_usable: false,
  };
}

function panelFeature(attributes: Record<string, unknown>): PanelFeature {
  return {
    firm_pan: sourceId(attributes.FIRM_PAN),
    panel_type: cleanToken(attributes.PANEL_TYP, 80),
    scale_raw: rawScalar(attributes.SCALE),
    source_citation: cleanToken(attributes.SOURCE_CIT, 120),
    effective_date: parseSourceDate(attributes.EFF_DATE),
    preliminary_date: parseSourceDate(attributes.PRE_DATE),
    preliminary_date_sets_map_status: false,
    latest_lomr_date: null,
    latest_lomr_date_known: false,
  };
}

function lomrFeature(attributes: Record<string, unknown>): LomrFeature {
  return {
    case_number: sourceId(attributes.CASE_NO),
    case_status_raw: cleanToken(attributes.STATUS, 80),
    case_status_sets_map_status: false,
    lomr_id: sourceId(attributes.LOMR_ID),
    effective_date: parseSourceDate(attributes.EFF_DATE),
  };
}

function studyFeature(attributes: Record<string, unknown>): StudyFeature {
  return {
    index_effective_date: parseSourceDate(attributes.INDX_EFFDT),
    database_revision_date: parseSourceDate(attributes.DBREV_DT),
    horizontal_datum_raw: placeholderUnit(attributes.H_DATUM, 40),
    vertical_datum_raw: placeholderUnit(attributes.V_DATUM, 40),
    vertical_datum_verified: false,
    source_citation: cleanToken(attributes.SOURCE_CIT, 120),
    collapsed_updated_at: null,
  };
}

function returnedSrid(value: unknown): {
  wkid: number | null;
  latest: number | null;
} {
  if (!isRecord(value)) return { wkid: null, latest: null };
  const spatial = isRecord(value.spatialReference)
    ? value.spatialReference
    : null;
  if (spatial === null) return { wkid: null, latest: null };
  return { wkid: readWkid(spatial.wkid), latest: readWkid(spatial.latestWkid) };
}

function applyReturnedSrid(
  geometry: GeometryAssessment,
  wkid: number | null,
  latest: number | null,
): void {
  geometry.returned_srid = wkid;
  geometry.returned_latest_srid = latest;
  if (wkid === null) {
    geometry.returned_spatial_reference_match = "not_returned";
    return;
  }
  geometry.returned_spatial_reference_match =
    geometry.input_srid !== null && wkid === geometry.input_srid
      ? "match"
      : "mismatch";
  if (
    geometry.returned_spatial_reference_match === "match" &&
    latest !== null &&
    latest !== wkid
  ) {
    geometry.returned_spatial_reference_match = "match";
  }
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
  completeness: FemaNfhlEvidence["completeness"],
  flood: FemaNfhlEvidence["flood"],
  panels: FemaNfhlEvidence["panels"],
  lomrs: FemaNfhlEvidence["lomrs"],
  study: FemaNfhlEvidence["study_info"],
): FemaNfhlEvidence {
  const resolved = resolveStatus(reasons, "fema-nfhl");
  return {
    schema_version: SCHEMA_VERSION,
    parser_version: FEMA_NFHL_PARSER_VERSION,
    provider: "FEMA",
    product: "NFHL",
    credit: FEMA_CREDIT,
    citations: {
      nfhl: FEMA_NFHL_INFO_URL,
      service_guide: FEMA_SERVICE_GUIDE_URL,
      terms_checked: SOURCE_EVIDENCE_CHECKED,
    },
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
    map_status: request.map_status,
    map_status_verified: false,
    caller_asserted_map_status: request.caller_asserted_map_status,
    map_status_conflict: request.map_status_conflict,
    overwrites_effective_observation: false,
    retrieval_is_map_effective_date: false,
    layer_id: request.layer_id,
    parcel_identity_verified: false,
    commercial_scope_verified: false,
    caller_asserts_commercial_scope: request.caller_asserts_commercial_scope,
    geometry,
    comparability: COMPARABILITY,
    limits: PARSER_LIMITS,
    disclaimers: FEMA_DISCLAIMERS,
    body_used: bodyUsed,
    withheld_non_context_attributes: withheld,
    provider_error_message: providerMessage,
    completeness,
    flood,
    panels,
    lomrs,
    study_info: study,
  };
}

function emptyPayloads(layer: number | null): {
  completeness: FemaNfhlEvidence["completeness"];
  flood: FemaNfhlEvidence["flood"];
  panels: FemaNfhlEvidence["panels"];
  lomrs: FemaNfhlEvidence["lomrs"];
  study: FemaNfhlEvidence["study_info"];
} {
  return {
    completeness: {
      complete: false,
      exceeded_transfer_limit: false,
      transport_truncated: false,
      result_record_cap: null,
      feature_count: null,
      above_feature_parse_ceiling: false,
    },
    flood: {
      queried: layer === 28,
      features: [],
      determination_allowed: false,
      contextual_list_allowed: false,
      single_zone_determination: false,
      area_percent: null,
      parcel_floodplain_label: null,
      assumed_zone: null,
      assumed_sfha: null,
      latest_lomr_date: null,
      lomr_applicability_known: false,
    },
    panels: {
      queried: layer === 3,
      features: [],
      contextual_list_allowed: false,
    },
    lomrs: {
      queried: layer === 1,
      features: [],
      contextual_list_allowed: false,
    },
    study: {
      queried: layer === 41,
      features: [],
      contextual_list_allowed: false,
    },
  };
}

export function parseFemaNfhl(input: EvidenceInput = {}): FemaNfhlEvidence {
  const request = assessRequest(input.request, "fema-nfhl");
  const hash = hashInput(input);
  const reasons = [...request.reasons];
  const details = [...request.details];
  const geometry: GeometryAssessment = { ...request.geometry };
  const payloads = emptyPayloads(request.layer_id);
  payloads.completeness.result_record_cap = request.result_record_cap;
  payloads.completeness.transport_truncated = request.transport_truncated;

  const finish = (
    bodyUsed: boolean,
    withheld = false,
    providerMessage: string | null = null,
  ): FemaNfhlEvidence =>
    envelope(
      request,
      hash,
      reasons,
      details,
      bodyUsed,
      withheld,
      providerMessage,
      geometry,
      payloads.completeness,
      payloads.flood,
      payloads.panels,
      payloads.lomrs,
      payloads.study,
    );

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
  if (!decoded.ok) {
    addUnique(reasons, "malformed_response");
    addUnique(details, decoded.detail);
    return finish(false);
  }
  if (hasProviderError(decoded.value)) {
    addUnique(reasons, "provider_error");
    addUnique(details, "arcgis_error");
    return finish(true, false, providerErrorMessage(decoded.value));
  }
  const features = readFeatures(decoded.value);
  if (features === null) {
    addUnique(reasons, "malformed_response");
    addUnique(details, "feature_list_missing");
    return finish(true);
  }

  const spatial = returnedSrid(decoded.value);
  applyReturnedSrid(geometry, spatial.wkid, spatial.latest);
  if (geometry.returned_spatial_reference_match === "mismatch") {
    addUnique(details, "returned_srid_differs_from_request");
  }

  const exceeded = exceededTransfer(decoded.value);
  const overCap =
    request.result_record_cap !== null &&
    features.length > request.result_record_cap;
  const overCeiling = features.length > FEATURE_PARSE_CEILING;
  payloads.completeness.exceeded_transfer_limit = exceeded;
  payloads.completeness.feature_count = features.length;
  payloads.completeness.above_feature_parse_ceiling = overCeiling;
  if (exceeded || overCap || overCeiling) {
    addUnique(reasons, "truncated");
    if (exceeded) addUnique(details, "exceeded_transfer_limit");
    if (overCap) addUnique(details, "over_result_cap");
    if (overCeiling) addUnique(details, "above_feature_parse_ceiling");
  }

  if (overCeiling) return finish(true);

  let withheld = false;
  let shapeIgnored = false;
  let junk = false;
  const parsedFlood: FloodFeature[] = [];
  const parsedPanels: PanelFeature[] = [];
  const parsedLomrs: LomrFeature[] = [];
  const parsedStudy: StudyFeature[] = [];
  const allow =
    request.layer_id === 28
      ? FLOOD_KEYS
      : request.layer_id === 3
        ? PANEL_KEYS
        : request.layer_id === 1
          ? LOMR_KEYS
          : STUDY_KEYS;

  for (const feature of features) {
    const attributes = featureAttributes(feature);
    if (attributes === null) {
      junk = true;
      continue;
    }
    const scanned = scanKeys(attributes, allow);
    if (scanned.withheld) withheld = true;
    if (scanned.shapeIgnored) shapeIgnored = true;
    if (request.layer_id === 28) parsedFlood.push(floodFeature(attributes));
    else if (request.layer_id === 3)
      parsedPanels.push(panelFeature(attributes));
    else if (request.layer_id === 1) parsedLomrs.push(lomrFeature(attributes));
    else parsedStudy.push(studyFeature(attributes));
  }
  if (junk) addUnique(details, "feature_entries_unreadable");
  if (
    junk &&
    parsedFlood.length +
      parsedPanels.length +
      parsedLomrs.length +
      parsedStudy.length ===
      0
  ) {
    addUnique(reasons, "malformed_response");
    return finish(true, withheld);
  }
  if (shapeIgnored) addUnique(details, "shape_area_ignored");

  const truncated = reasons.includes("truncated");
  const count =
    request.layer_id === 28
      ? parsedFlood.length
      : request.layer_id === 3
        ? parsedPanels.length
        : request.layer_id === 1
          ? parsedLomrs.length
          : parsedStudy.length;
  if (count === 0 && !truncated) {
    addUnique(reasons, "no_feature_unknown");
  }
  if (request.layer_id === 28 && parsedFlood.length > 1 && !truncated) {
    addUnique(reasons, "boundary_multiple");
    addUnique(details, "no_area_percent");
  }
  if (request.layer_id === 28 && geometry.semantics === "parcel_polygon") {
    addUnique(details, "no_area_percent");
  }

  for (const feature of parsedFlood) {
    if (feature.zone_class === "ani" || feature.zone_class === "np") {
      addUnique(reasons, "explicit_unmapped");
    }
    if (feature.zone_class === "missing") {
      addUnique(reasons, "malformed_response");
      addUnique(details, "zone_missing");
    }
    if (
      feature.static_bfe.parsed !== null &&
      feature.static_bfe.unit_raw === null
    ) {
      addUnique(reasons, "missing_units");
    }
    if (feature.depth.parsed !== null && feature.depth.unit_raw === null) {
      addUnique(reasons, "missing_units");
    }
    if (
      feature.velocity.parsed !== null &&
      feature.velocity.unit_raw === null
    ) {
      addUnique(reasons, "missing_units");
    }
    if (
      (feature.static_bfe.parsed !== null &&
        !feature.static_bfe.vertical_datum_source_stated) ||
      (feature.depth.parsed !== null &&
        !feature.depth.vertical_datum_source_stated)
    ) {
      addUnique(reasons, "datum_unknown");
    }
  }
  for (const panel of parsedPanels) {
    if (panel.effective_date.invalid || panel.preliminary_date.invalid) {
      addUnique(reasons, "invalid_source_date");
    }
  }
  for (const lomr of parsedLomrs) {
    if (lomr.effective_date.invalid) addUnique(reasons, "invalid_source_date");
  }
  for (const study of parsedStudy) {
    if (
      study.index_effective_date.invalid ||
      study.database_revision_date.invalid
    ) {
      addUnique(reasons, "invalid_source_date");
    }
    if (study.vertical_datum_raw === null) addUnique(reasons, "datum_unknown");
  }

  const blocked =
    truncated ||
    reasons.includes("malformed_response") ||
    reasons.includes("no_feature_unknown");
  const contextual = !blocked && count > 0;
  payloads.completeness.complete = contextual;
  if (request.layer_id === 28) {
    payloads.flood.features = parsedFlood;
    payloads.flood.contextual_list_allowed = contextual;
    payloads.flood.single_zone_determination =
      contextual &&
      parsedFlood.length === 1 &&
      !reasons.includes("boundary_multiple");
    payloads.flood.determination_allowed =
      payloads.flood.single_zone_determination;
  } else if (request.layer_id === 3) {
    payloads.panels.features = parsedPanels;
    payloads.panels.contextual_list_allowed = contextual;
  } else if (request.layer_id === 1) {
    payloads.lomrs.features = parsedLomrs;
    payloads.lomrs.contextual_list_allowed = contextual;
  } else {
    payloads.study.features = parsedStudy;
    payloads.study.contextual_list_allowed = contextual;
  }
  if (truncated) {
    payloads.flood.determination_allowed = false;
    payloads.flood.single_zone_determination = false;
    payloads.completeness.complete = false;
  }
  return finish(true, withheld);
}
