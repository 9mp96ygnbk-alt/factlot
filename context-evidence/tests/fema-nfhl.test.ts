/**
 * Synthetic FEMA NFHL fixtures. No network.
 *
 * The Harris point uses the retained public rounded coordinate and the retained
 * layer-28 attributes from the 2026-11-06 source check (DFIRM 48201C, zone X,
 * subtype, SFHA F, -9999 sentinels). Identifiers other than that DFIRM, and
 * every panel/LOMR/study value not named in that check, are synthetic.
 * Expected dates for the retained epoch values were calculated independently:
 * 1483660800000 ms is 2017-01-06 UTC, and 253392451200000 ms is 9999-09-09 UTC.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseFemaNfhl } from "../parse-fema-nfhl.ts";
import type { FloodFeature } from "../parse-fema-nfhl.ts";

const EFFECTIVE_ROOT =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
const EFFECTIVE_28 =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?f=json&geometry=-95.37%2C29.76&geometryType=esriGeometryPoint&inSR=4269&spatialRel=esriSpatialRelIntersects&outFields=%2A&returnGeometry=false";
const PRELIM_28 =
  "https://hazards.fema.gov/arcgis/rest/services/PrelimPending/Prelim_NFHL/MapServer/28/query";
const PENDING_28 =
  "https://hazards.fema.gov/arcgis/rest/services/PrelimPending/Pending_NFHL/MapServer/28/query";

function femaRequest(overrides: Record<string, unknown> = {}) {
  return {
    source_url: EFFECTIVE_ROOT,
    request_url: EFFECTIVE_28,
    fetched_at: "2026-11-06T23:37:00Z",
    http_status: 200,
    timeout: false,
    transport_truncated: false,
    layer_id: 28,
    input_srid: 4269,
    x: -95.37,
    y: 29.76,
    semantics: "point",
    point_role: "caller_point",
    commercial_scope_validated: false,
    ...overrides,
  };
}

function attributes(overrides: Record<string, unknown> = {}) {
  return {
    GFID: "synthetic-gfid",
    OBJECTID: 1,
    DFIRM_ID: "48201C",
    VERSION_ID: "synthetic",
    FLD_AR_ID: "synthetic-ar",
    STUDY_TYP: null,
    FLD_ZONE: "X",
    ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD",
    SFHA_TF: "F",
    STATIC_BFE: -9999,
    V_DATUM: null,
    DEPTH: -9999,
    LEN_UNIT: null,
    VELOCITY: -9999,
    VEL_UNIT: null,
    SOURCE_CIT: "SYNTHETIC",
    ...overrides,
  };
}

function arcgis(
  rows: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    exceededTransferLimit: false,
    features: rows.map((row) => ({ attributes: row })),
    ...extra,
  };
}

function first(features: FloodFeature[]): FloodFeature {
  const feature = features[0];
  assert.ok(feature);
  return feature;
}

test("retained Harris point keeps zone X, subtype, and sentinel measures", () => {
  const result = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest({ commercial_scope_validated: true }),
  });
  const feature = first(result.flood.features);
  assert.equal(result.status, "observed");
  assert.equal(result.unknown_reason, null);
  assert.deepEqual(result.unknown_reasons, []);
  assert.equal(result.map_status, "effective");
  assert.equal(result.map_status_verified, false);
  assert.equal(result.source_authenticity_verified, false);
  assert.equal(result.commercial_scope_verified, false);
  assert.equal(result.caller_asserts_commercial_scope, true);
  assert.equal(result.parcel_identity_verified, false);
  assert.equal(result.geometry.covers_whole_parcel, false);
  assert.equal(result.geometry.semantics, "point");
  assert.equal(result.geometry.x, -95.37);
  assert.equal(result.geometry.y, 29.76);
  assert.equal(result.geometry.input_srid, 4269);
  assert.equal(feature.dfirm_id, "48201C");
  assert.equal(feature.fld_zone_raw, "X");
  assert.equal(feature.zone_subtype_raw, "AREA OF MINIMAL FLOOD HAZARD");
  assert.equal(feature.zone_class, "x");
  assert.equal(feature.minimal_hazard_context, true);
  assert.equal(feature.no_flood_risk, false);
  assert.equal(feature.sfha_source, false);
  assert.equal(feature.sfha_source_is_safety_determination, false);
  assert.equal(feature.object_id_stable_across_refreshes, false);
  assert.equal(feature.static_bfe.raw, -9999);
  assert.equal(feature.static_bfe.parsed, null);
  assert.equal(feature.static_bfe.sentinel_minus_9999, true);
  assert.equal(feature.static_bfe.usable_as_source_stated_measure, false);
  assert.equal(feature.depth.sentinel_minus_9999, true);
  assert.equal(feature.velocity.unit_raw, null);
  assert.equal(feature.static_bfe.vertical_datum_verified, false);
  assert.equal(result.flood.area_percent, null);
  assert.equal(result.flood.parcel_floodplain_label, null);
  assert.equal(result.flood.assumed_zone, null);
  assert.equal(result.flood.single_zone_determination, true);
  assert.equal(result.comparability.flood_risk_probability, null);
  assert.equal(result.comparability.elevation_minus_bfe, null);
  assert.equal(result.comparability.insurance_determination, null);
  assert.equal(result.retrieval_is_map_effective_date, false);
  assert.equal(result.limits.default_zone_x_on_empty, false);
  assert.equal(result.limits.fetches, false);
});

test("empty HTTP 200 features are no_feature_unknown and not zone X", () => {
  const result = parseFemaNfhl({
    response: arcgis([]),
    request: femaRequest(),
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.unknown_reason, "no_feature_unknown");
  assert.deepEqual(result.unknown_reasons, ["no_feature_unknown"]);
  assert.equal(result.flood.features.length, 0);
  assert.equal(result.flood.assumed_zone, null);
  assert.equal(result.flood.assumed_sfha, null);
  assert.equal(result.flood.determination_allowed, false);
  assert.equal(result.completeness.complete, false);
});

test("explicit ANI, NP, OW, and D stay distinct from minimal hazard", () => {
  const cases = [
    { zone: "ANI", zoneClass: "ani", unmapped: true },
    { zone: "NP", zoneClass: "np", unmapped: true },
    { zone: "OW", zoneClass: "open_water", unmapped: false },
    { zone: "OPEN WATER", zoneClass: "open_water", unmapped: false },
    { zone: "D", zoneClass: "d_undetermined", unmapped: false },
  ] as const;
  for (const item of cases) {
    const result = parseFemaNfhl({
      response: arcgis([
        attributes({ FLD_ZONE: item.zone, ZONE_SUBTY: null, SFHA_TF: null }),
      ]),
      request: femaRequest(),
    });
    const feature = first(result.flood.features);
    assert.equal(result.status, "observed", item.zone);
    assert.equal(feature.zone_class, item.zoneClass);
    assert.equal(feature.minimal_hazard_context, false);
    assert.equal(feature.no_flood_risk, false);
    assert.equal(feature.fld_zone_raw === "X", false);
    assert.equal(
      result.unknown_reasons.includes("explicit_unmapped"),
      item.unmapped,
    );
  }
});

test("STUDY_TYP NP is not zone NP", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      attributes({
        FLD_ZONE: "AE",
        ZONE_SUBTY: null,
        STUDY_TYP: "NP",
        SFHA_TF: "T",
      }),
    ]),
    request: femaRequest(),
  });
  const feature = first(result.flood.features);
  assert.equal(feature.zone_class, "named");
  assert.equal(feature.fld_zone_raw, "AE");
  assert.equal(feature.study_type, "NP");
  assert.equal(feature.study_type_is_zone, false);
  assert.equal(feature.sfha_source, true);
  assert.equal(feature.sfha_source_is_safety_determination, false);
});

test("zone X subtypes that are not minimal hazard stay not-safe", () => {
  for (const subtype of [
    "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
    "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE",
  ]) {
    const result = parseFemaNfhl({
      response: arcgis([attributes({ ZONE_SUBTY: subtype })]),
      request: femaRequest(),
    });
    const feature = first(result.flood.features);
    assert.equal(feature.zone_class, "x");
    assert.equal(feature.minimal_hazard_context, false);
    assert.equal(feature.no_flood_risk, false);
    assert.equal(feature.zone_subtype_raw, subtype);
  }
});

test("SFHA word FALSE is not coerced to a source false", () => {
  const result = parseFemaNfhl({
    response: arcgis([attributes({ SFHA_TF: "FALSE" })]),
    request: femaRequest(),
  });
  assert.equal(first(result.flood.features).sfha_source, null);
});

test("malformed coordinates and unrecognized CRS are invalid before the body", () => {
  const secret = "owner@example.com";
  const cases: Record<string, unknown>[] = [
    { x: Number.NaN, y: 29.76 },
    { x: "NaN", y: 29.76 },
    { x: `12deg-${secret}`, y: 29.76 },
    { x: 181, y: 29.76 },
    { x: 29.76, y: -95.37 },
    { input_srid: undefined },
    { input_srid: 3857 },
    { input_srid: "EPSG:4269" },
    { semantics: "point", point_role: undefined },
    { fetched_at: "2026-11-06" },
    { http_status: "200" },
  ];
  for (const overrides of cases) {
    const result = parseFemaNfhl({
      response: arcgis([attributes({ SOURCE_CIT: secret })]),
      request: femaRequest(overrides),
    });
    assert.equal(result.status, "invalid");
    assert.equal(result.unknown_reason, "invalid_input");
    assert.equal(result.body_used, false);
    assert.equal(result.flood.features.length, 0);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  const swapped = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest({
      request_url:
        "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
      x: 29.76,
      y: -95.37,
    }),
  });
  assert.equal(swapped.geometry.x, null);
  assert.equal(swapped.geometry.y, null);
  assert.equal(swapped.details.includes("coordinate_not_swapped"), true);
  assert.equal(JSON.stringify(swapped).includes("-95.37"), false);
  const missingSrid = parseFemaNfhl({
    response: arcgis([]),
    request: femaRequest({ input_srid: undefined }),
  });
  assert.equal(missingSrid.geometry.input_srid, null);
  assert.equal(missingSrid.details.includes("no_default_srid"), true);
});

test("provider errors, timeout, bad JSON, and transport truncation are not zone X", () => {
  const planted = "PLANTED-ZONE-TOKEN";
  const body = arcgis([attributes({ FLD_ZONE: "X", ZONE_SUBTY: planted })]);
  const provider = parseFemaNfhl({
    response: {
      error: { code: 400, message: "Failed to execute query." },
      features: body.features,
    },
    request: femaRequest(),
  });
  assert.equal(provider.status, "unknown");
  assert.equal(provider.unknown_reason, "provider_error");
  assert.equal(provider.flood.features.length, 0);
  assert.equal(provider.provider_error_message, "Failed to execute query.");
  assert.equal(JSON.stringify(provider).includes(planted), false);

  for (const status of [403, 429, 500]) {
    const result = parseFemaNfhl({
      response: body,
      request: femaRequest({ http_status: status }),
    });
    assert.equal(result.unknown_reason, "provider_error");
    assert.equal(result.flood.features.length, 0);
    assert.equal(JSON.stringify(result).includes(planted), false);
  }

  const timedOut = parseFemaNfhl({
    response: body,
    request: femaRequest({ timeout: true, http_status: null }),
  });
  assert.deepEqual(timedOut.unknown_reasons, ["timeout"]);
  assert.equal(timedOut.flood.features.length, 0);

  const badJson = parseFemaNfhl({
    request: femaRequest({ response_text: "{not-json" }),
  });
  assert.equal(badJson.unknown_reason, "malformed_response");
  assert.equal(badJson.details.includes("body_not_json"), true);

  const truncated = parseFemaNfhl({
    response: body,
    request: femaRequest({ transport_truncated: true }),
  });
  assert.equal(truncated.unknown_reason, "truncated");
  assert.equal(truncated.unknown_reasons.includes("no_feature_unknown"), false);
  assert.equal(truncated.body_used, false);
  assert.equal(JSON.stringify(truncated).includes(planted), false);
});

test("exceededTransferLimit or a caller cap is incomplete, including an empty page", () => {
  const rows = [
    attributes({ FLD_ZONE: "AE", ZONE_SUBTY: null }),
    attributes({ FLD_ZONE: "X", OBJECTID: 2 }),
  ];
  const exceeded = parseFemaNfhl({
    response: arcgis(rows, { exceededTransferLimit: true }),
    request: femaRequest(),
  });
  assert.equal(exceeded.unknown_reason, "truncated");
  assert.equal(exceeded.unknown_reasons.includes("no_feature_unknown"), false);
  assert.equal(exceeded.flood.features.length, 2);
  assert.equal(exceeded.flood.determination_allowed, false);
  assert.equal(exceeded.flood.contextual_list_allowed, false);
  assert.equal(exceeded.completeness.complete, false);
  assert.equal(exceeded.completeness.feature_count, 2);

  const capped = parseFemaNfhl({
    response: arcgis(rows),
    request: femaRequest({ result_record_cap: 1 }),
  });
  assert.equal(capped.unknown_reason, "truncated");
  assert.equal(capped.details.includes("over_result_cap"), true);
  assert.equal(capped.flood.determination_allowed, false);

  const emptyExceeded = parseFemaNfhl({
    response: { features: [], exceededTransferLimit: true },
    request: femaRequest(),
  });
  assert.equal(emptyExceeded.unknown_reason, "truncated");
  assert.equal(
    emptyExceeded.unknown_reasons.includes("no_feature_unknown"),
    false,
  );
});

test("a point on an AE/X boundary keeps both zones and no area percent", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      attributes({ FLD_ZONE: "AE", ZONE_SUBTY: null, SFHA_TF: "T" }),
      attributes({ FLD_ZONE: "X", OBJECTID: 2 }),
    ]),
    request: femaRequest(),
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.unknown_reason, "boundary_multiple");
  assert.deepEqual(
    result.flood.features.map((feature) => feature.fld_zone_raw),
    ["AE", "X"],
  );
  assert.equal(result.flood.area_percent, null);
  assert.equal(result.flood.parcel_floodplain_label, null);
  assert.equal(result.flood.single_zone_determination, false);
  assert.equal(result.flood.contextual_list_allowed, true);
  assert.equal(result.geometry.covers_whole_parcel, false);
});

test("parcel geometry crossing zones still has no percent", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      attributes({ FLD_ZONE: "AE", ZONE_SUBTY: null }),
      attributes({ FLD_ZONE: "X", OBJECTID: 2 }),
    ]),
    request: femaRequest({
      semantics: "parcel_polygon",
      point_role: undefined,
      parcel_geometry_digest: "sha256:synthetic",
    }),
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.flood.features.length, 2);
  assert.equal(result.flood.area_percent, null);
  assert.equal(result.geometry.covers_whole_parcel, false);
  assert.equal(result.geometry.parcel_geometry_digest_verified, false);
  assert.equal(result.geometry.parcel_geometry_digest, "sha256:synthetic");
});

test("coastal zones with mixed or missing measures stay contextual", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      attributes({
        FLD_ZONE: "VE",
        ZONE_SUBTY: null,
        SFHA_TF: "T",
        STATIC_BFE: -9999,
        V_DATUM: "NAVD88",
        LEN_UNIT: null,
      }),
      attributes({
        OBJECTID: 2,
        FLD_ZONE: "AE",
        ZONE_SUBTY: null,
        SFHA_TF: "T",
        STATIC_BFE: 12,
        V_DATUM: null,
        LEN_UNIT: "Feet",
      }),
      attributes({
        OBJECTID: 3,
        FLD_ZONE: "OW",
        ZONE_SUBTY: null,
        SFHA_TF: null,
        STATIC_BFE: null,
        DEPTH: null,
        VELOCITY: null,
      }),
    ]),
    request: femaRequest(),
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.flood.features.length, 3);
  for (const feature of result.flood.features) {
    assert.equal(feature.no_flood_risk, false);
    assert.equal(feature.static_bfe.usable_as_source_stated_measure, false);
    assert.equal(feature.static_bfe.comparable_to_dem_or_bfe, false);
  }
  const ae = result.flood.features[1];
  assert.ok(ae);
  assert.equal(ae.static_bfe.parsed, 12);
  assert.equal(ae.static_bfe.unit_raw, "Feet");
  assert.equal(ae.static_bfe.vertical_datum_raw, null);
  assert.equal(result.unknown_reasons.includes("datum_unknown"), true);
  assert.equal(result.comparability.survey_determination, null);
  assert.equal(result.comparability.buildability_determination, null);
});

test("a stated BFE with unit and source datum is still not a survey conclusion", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      attributes({
        FLD_ZONE: "AE",
        ZONE_SUBTY: null,
        SFHA_TF: "T",
        STATIC_BFE: 12.5,
        DEPTH: 2,
        LEN_UNIT: "Feet",
        V_DATUM: "NAVD88",
        VELOCITY: 0,
        VEL_UNIT: "Feet per second",
      }),
    ]),
    request: femaRequest(),
  });
  const feature = first(result.flood.features);
  assert.equal(result.status, "observed");
  assert.equal(feature.static_bfe.usable_as_source_stated_measure, true);
  assert.equal(feature.static_bfe.parsed, 12.5);
  assert.equal(feature.static_bfe.vertical_datum_source_stated, true);
  assert.equal(feature.static_bfe.vertical_datum_verified, false);
  assert.equal(feature.static_bfe.comparable_to_dem_or_bfe, false);
  assert.equal(feature.depth.usable_as_source_stated_measure, true);
  assert.equal(feature.velocity.usable_as_source_stated_measure, true);
  assert.equal(feature.velocity.parsed, 0);
  assert.equal(result.comparability.elevation_minus_bfe, null);
});

test("preliminary and pending URLs are not relabeled effective", () => {
  const effective = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest(),
  });
  const preliminary = parseFemaNfhl({
    response: arcgis([attributes({ FLD_ZONE: "AE", ZONE_SUBTY: null })]),
    request: femaRequest({
      request_url: PRELIM_28,
      source_url:
        "https://hazards.fema.gov/arcgis/rest/services/PrelimPending/Prelim_NFHL/MapServer",
    }),
  });
  const pending = parseFemaNfhl({
    response: arcgis([attributes({ FLD_ZONE: "AE", ZONE_SUBTY: null })]),
    request: femaRequest({ request_url: PENDING_28 }),
  });
  assert.equal(effective.map_status, "effective");
  assert.equal(first(effective.flood.features).fld_zone_raw, "X");
  assert.equal(preliminary.map_status, "preliminary");
  assert.equal(preliminary.overwrites_effective_observation, false);
  assert.equal(preliminary.map_status_verified, false);
  assert.equal(pending.map_status, "pending");
  assert.equal(first(effective.flood.features).fld_zone_raw, "X");

  const conflict = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest({ request_url: PRELIM_28, map_status: "effective" }),
  });
  assert.equal(conflict.status, "invalid");
  assert.equal(conflict.map_status, null);
  assert.equal(conflict.map_status_conflict, true);
  assert.equal(conflict.flood.features.length, 0);
});

test("a URL that does not name a map generation does not default to effective", () => {
  const result = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest({
      request_url:
        "https://hazards.fema.gov/arcgis/rest/services/other/MapServer/28/query",
      source_url:
        "https://hazards.fema.gov/arcgis/rest/services/other/MapServer",
      map_status: "effective",
    }),
  });
  assert.equal(result.status, "observed");
  assert.equal(result.map_status, null);
  assert.equal(result.caller_asserted_map_status, "effective");
  assert.equal(result.details.includes("no_default_map_status"), true);
});

test("panel dates stay panel dates and a sentinel preliminary date is not repaired", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      {
        FIRM_PAN: "48201C0690N",
        EFF_DATE: 1483660800000,
        PRE_DATE: 253392451200000,
        PANEL_TYP: "SYNTHETIC",
        SCALE: null,
        SOURCE_CIT: "SYNTHETIC",
      },
    ]),
    request: femaRequest({
      layer_id: 3,
      request_url:
        "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/3/query",
      fetched_at: "2026-11-06T13:37:00-10:00",
    }),
  });
  const panel = result.panels.features[0];
  assert.ok(panel);
  assert.equal(result.map_status, "effective");
  assert.equal(result.panels.queried, true);
  assert.equal(result.flood.queried, false);
  assert.equal(result.flood.assumed_zone, null);
  assert.equal(panel.firm_pan, "48201C0690N");
  assert.equal(panel.effective_date.calendar_date, "2017-01-06");
  assert.equal(panel.effective_date.calendar_basis, "utc_epoch_day");
  assert.equal(panel.preliminary_date.raw, 253392451200000);
  assert.equal(panel.preliminary_date.valid, false);
  assert.equal(panel.preliminary_date.invalid, true);
  assert.equal(panel.preliminary_date.calendar_date, null);
  assert.equal(panel.preliminary_date.guessed, false);
  assert.equal(panel.preliminary_date_sets_map_status, false);
  assert.equal(panel.latest_lomr_date, null);
  assert.equal(panel.latest_lomr_date_known, false);
  assert.equal(result.fetched_at, "2026-11-06T13:37:00-10:00");
  assert.equal(result.retrieval_is_map_effective_date, false);
  assert.equal(result.unknown_reasons.includes("invalid_source_date"), true);
  assert.notEqual(panel.effective_date.calendar_date, "2026-11-06");
});

test("a LOMR case status does not set the NFHL map status", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      {
        CASE_NO: "SYN-00-00-0000A",
        STATUS: "Effective",
        EFF_DATE: 1483660800000,
        LOMR_ID: "SYNTHETIC-LOMR",
      },
    ]),
    request: femaRequest({
      layer_id: 1,
      request_url:
        "https://hazards.fema.gov/arcgis/rest/services/PrelimPending/Prelim_NFHL/MapServer/1/query",
    }),
  });
  const lomr = result.lomrs.features[0];
  assert.ok(lomr);
  assert.equal(result.map_status, "preliminary");
  assert.equal(lomr.case_status_raw, "Effective");
  assert.equal(lomr.case_status_sets_map_status, false);
  assert.equal(lomr.effective_date.calendar_date, "2017-01-06");
  assert.equal(result.overwrites_effective_observation, false);
  assert.equal(result.flood.latest_lomr_date, null);
});

test("study dates and datums stay separate and unverified", () => {
  const result = parseFemaNfhl({
    response: arcgis([
      {
        INDX_EFFDT: 1483660800000,
        DBREV_DT: "2020-05-02",
        H_DATUM: "NAD83",
        V_DATUM: "NAVD88",
        SOURCE_CIT: "SYNTHETIC",
      },
    ]),
    request: femaRequest({
      layer_id: 41,
      request_url:
        "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/41/query",
    }),
  });
  const study = result.study_info.features[0];
  assert.ok(study);
  assert.equal(study.index_effective_date.calendar_date, "2017-01-06");
  assert.equal(study.database_revision_date.calendar_date, "2020-05-02");
  assert.equal(study.vertical_datum_raw, "NAVD88");
  assert.equal(study.vertical_datum_verified, false);
  assert.equal(study.collapsed_updated_at, null);
  assert.equal("updated_at" in result, false);
});

test("layer 10 and a layer/url conflict are not interpreted as flood zones", () => {
  const rejected = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest({
      layer_id: 10,
      request_url:
        "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/10/query",
    }),
  });
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.details.includes("layer_id_not_interpreted"), true);
  assert.equal(rejected.flood.features.length, 0);

  const conflict = parseFemaNfhl({
    response: arcgis([attributes()]),
    request: femaRequest({ layer_id: 3 }),
  });
  assert.equal(conflict.details.includes("layer_id_url_conflict"), true);
  assert.equal(conflict.flood.features.length, 0);
});

test("GeoJSON properties are read and non-context attributes are not echoed", () => {
  const person = "Example Person";
  const street = "100 Example Street";
  const result = parseFemaNfhl({
    response: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: {
            ...attributes({ DUAL_ZONE: "T", AR_REVERT: -9999 }),
            OWNER: person,
            ADDRESS: street,
            "SHAPE.STArea()": 12345.678,
          },
        },
      ],
    },
    request: femaRequest(),
  });
  const feature = first(result.flood.features);
  assert.equal(feature.fld_zone_raw, "X");
  assert.equal(feature.dual_zone_raw, "T");
  assert.equal(feature.ar_revert_raw, -9999);
  assert.equal(feature.revert_measures_usable, false);
  assert.equal(result.withheld_non_context_attributes, true);
  assert.equal(result.details.includes("shape_area_ignored"), true);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes(person), false);
  assert.equal(encoded.includes(street), false);
  assert.equal(encoded.includes("12345.678"), false);
});

test("centroid and representative roles are preserved and are not a parcel", () => {
  for (const role of ["centroid", "representative_point"] as const) {
    const result = parseFemaNfhl({
      response: arcgis([attributes()]),
      request: femaRequest({ point_role: role }),
    });
    assert.equal(result.geometry.point_role, role);
    assert.equal(result.geometry.covers_whole_parcel, false);
    assert.equal(result.flood.area_percent, null);
  }
});

test("the same input is deterministic and does not mutate a frozen request", () => {
  const response = Object.freeze({
    exceededTransferLimit: false,
    features: Object.freeze([
      Object.freeze({ attributes: Object.freeze(attributes()) }),
    ]),
  });
  const request = Object.freeze(femaRequest());
  const left = parseFemaNfhl({ response, request });
  const right = parseFemaNfhl({ response, request });
  assert.deepEqual(left, right);
});

test("response text is hashed and a ceiling does not become zone X", () => {
  const text = '{"features":[],"exceededTransferLimit":false}';
  const hashed = parseFemaNfhl({
    request: femaRequest({ response_text: text }),
  });
  assert.equal(
    hashed.response_sha256,
    "43ea1a95b0396894a51d1de29fcde910f72c333bdb69511226b2b474b68aa6e3",
  );
  assert.equal(hashed.response_hash_basis, "response_text");
  assert.equal(hashed.unknown_reason, "no_feature_unknown");

  const planted = "CEILING-PII-TOKEN";
  const features = Array.from({ length: 2001 }, () => ({
    attributes: attributes({ OWNER: planted }),
  }));
  const ceiling = parseFemaNfhl({
    response: { features, exceededTransferLimit: false },
    request: femaRequest(),
  });
  assert.equal(ceiling.unknown_reason, "truncated");
  assert.equal(ceiling.completeness.feature_count, 2001);
  assert.equal(ceiling.completeness.above_feature_parse_ceiling, true);
  assert.equal(ceiling.flood.features.length, 0);
  assert.equal(JSON.stringify(ceiling).includes(planted), false);
  assert.equal(ceiling.limits.feature_parse_ceiling_is_publisher_quota, false);
});
