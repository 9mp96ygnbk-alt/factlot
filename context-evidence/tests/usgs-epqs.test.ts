/**
 * Synthetic USGS EPQS fixtures. No network.
 *
 * Live elevation numbers and the outside-coverage no-data encoding were not
 * retained: the 2026-11-06 follow-up requests timed out. Values below are
 * synthetic. The invalid AcquisitionDate token "0/5/2025", rasterId 30348,
 * resolution 1, and the rounded public coordinate are the retained observation.
 * 1 international foot is the exact decimal 0.3048, not the US survey foot.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseUsgsEpqs } from "../parse-usgs-epqs.ts";

const DOCS = "https://epqs.nationalmap.gov/v1/docs";
const QUERY =
  "https://epqs.nationalmap.gov/v1/json?x=-95.37&y=29.76&units=Meters&wkid=4326&includeDate=true";

function usgsRequest(overrides: Record<string, unknown> = {}) {
  return {
    source_url: DOCS,
    request_url: QUERY,
    fetched_at: "2026-11-06T23:37:00Z",
    http_status: 200,
    timeout: false,
    transport_truncated: false,
    input_srid: 4326,
    x: -95.37,
    y: 29.76,
    units: "Meters",
    semantics: "point",
    point_role: "caller_point",
    commercial_scope_validated: false,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    location: {
      x: -95.37,
      y: 29.76,
      spatialReference: { wkid: 4326, latestWkid: 4326 },
    },
    locationId: "synthetic-location",
    value: "15.25",
    rasterId: 900001,
    resolution: 1,
    ...overrides,
  };
}

test("a synthetic meter elevation stays contextual with datum and resolution unknown", () => {
  const result = parseUsgsEpqs({
    response: body(),
    request: usgsRequest({ commercial_scope_validated: true }),
  });
  assert.equal(result.status, "observed");
  assert.equal(result.unknown_reason, null);
  assert.deepEqual(result.unknown_reasons, ["datum_unknown"]);
  assert.equal(result.elevation?.parsed, 15.25);
  assert.equal(result.elevation?.raw, "15.25");
  assert.equal(result.elevation?.requested_unit, "Meters");
  assert.equal(result.elevation?.linear_unit, "meter");
  assert.equal(result.elevation?.exact_meters_per_unit, "1");
  assert.equal(result.elevation?.usable_as_contextual_elevation, true);
  assert.equal(result.elevation?.vertical_datum, null);
  assert.equal(result.elevation?.vertical_datum_verified, false);
  assert.equal(result.elevation?.confidence_interval_meters, null);
  assert.equal(result.elevation?.nodata_encoding_live_verified, false);
  assert.equal(result.resolution.parsed, 1);
  assert.equal(result.resolution.unit, null);
  assert.equal(result.resolution.unit_known, false);
  assert.equal(result.details.includes("resolution_unit_unknown"), true);
  assert.equal(result.comparability.comparable_to_bfe, false);
  assert.equal(result.comparability.elevation_minus_bfe, null);
  assert.equal(result.comparability.survey_determination, null);
  assert.equal(result.source_authenticity_verified, false);
  assert.equal(result.commercial_scope_verified, false);
  assert.equal(result.caller_asserts_commercial_scope, true);
  assert.equal(result.parcel_identity_verified, false);
  assert.equal(result.accepted_undocumented_wkid_4269, false);
  assert.deepEqual(result.documented_wkids, [4326, 102100]);
  assert.equal(result.limits.live_nodata_encoding_verified, false);
  assert.equal(result.geometry.covers_whole_parcel, false);
});

test("the retained invalid AcquisitionDate is not repaired", () => {
  const result = parseUsgsEpqs({
    response: body({
      value: "15.25",
      rasterId: 30348,
      resolution: 1,
      attributes: { AcquisitionDate: "0/5/2025" },
    }),
    request: usgsRequest(),
  });
  assert.equal(result.status, "observed");
  assert.equal(result.raster_id, 30348);
  assert.equal(result.acquisition_date.raw, "0/5/2025");
  assert.equal(result.acquisition_date.calendar_date, null);
  assert.equal(result.acquisition_date.invalid, true);
  assert.equal(result.acquisition_date.guessed, false);
  assert.equal(result.unknown_reasons.includes("invalid_source_date"), true);
  assert.equal(result.elevation?.usable_as_contextual_elevation, true);
  assert.equal(result.elevation?.vertical_datum, null);
  assert.equal(result.comparability.comparable_to_bfe, false);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes("2025-05-05"), false);
  assert.equal(encoded.includes("2025-01-05"), false);
  assert.equal(encoded.includes("2025-05-01"), false);
});

test("valid M/D/YYYY and ISO dates parse, and impossible days do not", () => {
  const valid = parseUsgsEpqs({
    response: body({ attributes: { AcquisitionDate: "5/1/2025" } }),
    request: usgsRequest(),
  });
  assert.equal(valid.acquisition_date.calendar_date, "2025-05-01");
  assert.equal(valid.acquisition_date.calendar_basis, "date_only");
  assert.equal(valid.acquisition_date.guessed, false);

  const leap = parseUsgsEpqs({
    response: body({ attributes: { AcquisitionDate: "2024-02-29" } }),
    request: usgsRequest(),
  });
  assert.equal(leap.acquisition_date.calendar_date, "2024-02-29");

  const notLeap = parseUsgsEpqs({
    response: body({ attributes: { AcquisitionDate: "2/29/2025" } }),
    request: usgsRequest(),
  });
  assert.equal(notLeap.acquisition_date.raw, "2/29/2025");
  assert.equal(notLeap.acquisition_date.valid, false);
  assert.equal(notLeap.acquisition_date.guessed, false);
});

test("wkid 4269 is not accepted as a documented EPQS input", () => {
  const result = parseUsgsEpqs({
    response: body({ value: "15.25", rasterId: 30348 }),
    request: usgsRequest({
      input_srid: 4269,
      request_url:
        "https://epqs.nationalmap.gov/v1/json?x=-95.37&y=29.76&units=Meters&wkid=4269&includeDate=true",
    }),
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.unknown_reason, "invalid_input");
  assert.equal(result.accepted_undocumented_wkid_4269, false);
  assert.equal(result.details.includes("wkid_4269_not_documented"), true);
  assert.equal(result.body_used, false);
  assert.equal(result.elevation, null);
  assert.equal(JSON.stringify(result).includes("15.25"), false);
});

test("omitted wkid or units are not defaulted", () => {
  const missingWkid = parseUsgsEpqs({
    response: body(),
    request: usgsRequest({ input_srid: undefined }),
  });
  assert.equal(missingWkid.status, "invalid");
  assert.equal(missingWkid.geometry.input_srid, null);
  assert.equal(missingWkid.details.includes("no_default_srid"), true);
  assert.equal(missingWkid.elevation, null);

  const missingUnits = parseUsgsEpqs({
    response: body({ value: 15.25 }),
    request: usgsRequest({ units: undefined }),
  });
  assert.equal(missingUnits.status, "unknown");
  assert.equal(missingUnits.unknown_reason, "missing_units");
  assert.equal(missingUnits.elevation?.requested_unit, null);
  assert.equal(missingUnits.elevation?.usable_as_contextual_elevation, false);
  assert.equal(missingUnits.elevation?.parsed, 15.25);
  assert.equal(missingUnits.details.includes("no_default_units"), true);

  for (const units of ["feet", "ftUS", "US survey feet"]) {
    const result = parseUsgsEpqs({
      response: body(),
      request: usgsRequest({ units }),
    });
    assert.equal(result.unknown_reason, "missing_units", units);
    assert.equal(result.elevation?.linear_unit, null);
  }
});

test("explicit Feet means international feet and 102100 may report latestWkid 3857", () => {
  const result = parseUsgsEpqs({
    response: {
      location: {
        x: -10615000,
        y: 3470000,
        spatialReference: { wkid: 102100, latestWkid: 3857 },
      },
      value: 30000,
      rasterId: 900001,
      resolution: 1,
    },
    request: usgsRequest({
      input_srid: 102100,
      units: "Feet",
      x: -10615000,
      y: 3470000,
      request_url:
        "https://epqs.nationalmap.gov/v1/json?x=-10615000&y=3470000&units=Feet&wkid=102100",
    }),
  });
  assert.equal(result.status, "observed");
  assert.equal(result.geometry.input_srid, 102100);
  assert.equal(result.geometry.returned_latest_srid, 3857);
  assert.equal(result.geometry.returned_spatial_reference_match, "match");
  assert.equal(
    result.details.includes("latest_wkid_recorded_not_relabeled"),
    true,
  );
  assert.equal(result.elevation?.requested_unit, "Feet");
  assert.equal(result.elevation?.linear_unit, "international_foot");
  assert.equal(result.elevation?.exact_meters_per_unit, "0.3048");
  assert.equal(result.elevation?.us_survey_foot_assumed, false);
  assert.equal(result.elevation?.parsed, 30000);
  assert.equal(result.elevation?.usable_as_contextual_elevation, true);
});

test("requesting 3857 or an EPSG prefix is unrecognized", () => {
  for (const input_srid of [3857, "EPSG:4326"]) {
    const result = parseUsgsEpqs({
      response: body(),
      request: usgsRequest({ input_srid }),
    });
    assert.equal(result.status, "invalid");
    assert.equal(result.details.includes("srid_unrecognized"), true);
    assert.equal(result.elevation, null);
  }
  const numeric = parseUsgsEpqs({
    response: body(),
    request: usgsRequest({ input_srid: "4326" }),
  });
  assert.equal(numeric.status, "observed");
  assert.equal(numeric.geometry.input_srid, 4326);
});

test("zero and negative finite elevations can be valid", () => {
  for (const value of [0, -3.2, "0", "-86.5"]) {
    const result = parseUsgsEpqs({
      response: body({ value }),
      request: usgsRequest(),
    });
    assert.equal(result.status, "observed", String(value));
    assert.equal(result.elevation?.usable_as_contextual_elevation, true);
    assert.equal(result.unknown_reason, null);
  }
});

test("missing, malformed, nonfinite, mismatched, and unverified sentinels are unknown", () => {
  const missing = parseUsgsEpqs({
    response: body({ value: null }),
    request: usgsRequest({ x: 0, y: 0 }),
  });
  assert.equal(missing.unknown_reason, "malformed_response");
  assert.equal(missing.details.includes("value_missing"), true);
  assert.equal(missing.unknown_reasons.includes("nodata_unverified"), false);
  assert.equal(missing.elevation?.parsed, null);
  assert.equal(missing.elevation?.usable_as_contextual_elevation, false);
  assert.equal(missing.elevation?.nodata_encoding_live_verified, false);

  const junk = parseUsgsEpqs({
    response: body({ value: "12 meters" }),
    request: usgsRequest(),
  });
  assert.equal(junk.details.includes("value_malformed"), true);
  assert.equal(junk.elevation?.usable_as_contextual_elevation, false);

  const nonfinite = parseUsgsEpqs({
    response: body({ value: Number.POSITIVE_INFINITY }),
    request: usgsRequest(),
  });
  assert.equal(nonfinite.details.includes("value_nonfinite"), true);

  const shifted = parseUsgsEpqs({
    response: body({
      location: {
        x: 0,
        y: 0,
        spatialReference: { wkid: 4326, latestWkid: 4326 },
      },
    }),
    request: usgsRequest(),
  });
  assert.equal(shifted.geometry.returned_location_match, "mismatch");
  assert.equal(shifted.unknown_reason, "malformed_response");
  assert.equal(shifted.elevation?.usable_as_contextual_elevation, false);

  const far = parseUsgsEpqs({
    response: body({
      location: {
        x: -95.38,
        y: 29.76,
        spatialReference: { wkid: 4326, latestWkid: 4326 },
      },
    }),
    request: usgsRequest(),
  });
  assert.equal(far.geometry.returned_location_match, "mismatch");

  const close = parseUsgsEpqs({
    response: body({
      location: {
        x: -95.3700004,
        y: 29.7600004,
        spatialReference: { wkid: 4326, latestWkid: 4326 },
      },
    }),
    request: usgsRequest(),
  });
  assert.equal(close.geometry.returned_location_match, "match");
  assert.equal(close.status, "observed");

  const wrongSrid = parseUsgsEpqs({
    response: body({
      location: {
        x: -95.37,
        y: 29.76,
        spatialReference: { wkid: 4269, latestWkid: 4326 },
      },
    }),
    request: usgsRequest(),
  });
  assert.equal(wrongSrid.geometry.returned_spatial_reference_match, "mismatch");
  assert.equal(wrongSrid.geometry.input_srid, 4326);
  assert.equal(wrongSrid.elevation?.usable_as_contextual_elevation, false);

  const sentinel = parseUsgsEpqs({
    response: body({ value: -1000000 }),
    request: usgsRequest(),
  });
  assert.equal(sentinel.status, "unknown");
  assert.equal(sentinel.unknown_reason, "nodata_unverified");
  assert.equal(sentinel.elevation?.parsed, -1000000);
  assert.equal(sentinel.elevation?.usable_as_contextual_elevation, false);
  assert.equal(sentinel.elevation?.nodata_encoding_live_verified, false);
  assert.equal(
    sentinel.details.includes("nodata_encoding_not_live_verified"),
    true,
  );

  const tallFeet = parseUsgsEpqs({
    response: body({ value: 40000 }),
    request: usgsRequest({ units: "Feet" }),
  });
  assert.equal(tallFeet.unknown_reason, "nodata_unverified");
});

test("an origin point with a normal value is not treated as no-data", () => {
  const result = parseUsgsEpqs({
    response: body({
      value: 4,
      location: {
        x: 0,
        y: 0,
        spatialReference: { wkid: 4326, latestWkid: 4326 },
      },
    }),
    request: usgsRequest({ x: 0, y: 0 }),
  });
  assert.equal(result.status, "observed");
  assert.equal(result.elevation?.parsed, 4);
  assert.equal(result.elevation?.usable_as_contextual_elevation, true);
  assert.equal(result.unknown_reasons.includes("nodata_unverified"), false);
});

test("timeouts and provider failures are not clean no-data", () => {
  const timedOut = parseUsgsEpqs({
    response: body({ value: -1000000 }),
    request: usgsRequest({ timeout: true, http_status: null }),
  });
  assert.deepEqual(timedOut.unknown_reasons, ["timeout"]);
  assert.equal(timedOut.elevation, null);
  assert.equal(timedOut.body_used, false);

  for (const http_status of [403, 429, 500]) {
    const result = parseUsgsEpqs({
      response: body({ value: 15.25 }),
      request: usgsRequest({ http_status }),
    });
    assert.deepEqual(result.unknown_reasons, ["provider_error"]);
    assert.equal(result.elevation, null);
  }

  const errorBody = parseUsgsEpqs({
    response: {
      error: { code: 400, message: "Invalid or missing input parameters." },
    },
    request: usgsRequest(),
  });
  assert.equal(errorBody.unknown_reason, "provider_error");
  assert.equal(errorBody.elevation, null);

  const badJson = parseUsgsEpqs({
    request: usgsRequest({ response_text: "{not-json" }),
  });
  assert.equal(badJson.unknown_reason, "malformed_response");
  assert.equal(badJson.details.includes("body_not_json"), true);

  const truncated = parseUsgsEpqs({
    response: body(),
    request: usgsRequest({ transport_truncated: true }),
  });
  assert.equal(truncated.unknown_reason, "truncated");
  assert.equal(truncated.unknown_reasons.includes("nodata_unverified"), false);
  assert.equal(truncated.elevation, null);
});

test("missing y is invalid input and a docs-only 400 note is not a live claim", () => {
  const secret = "15.25-secret";
  const result = parseUsgsEpqs({
    response: body({ value: secret }),
    request: usgsRequest({
      y: undefined,
      http_status: 400,
      request_url:
        "https://epqs.nationalmap.gov/v1/json?x=-95.37&units=Meters&wkid=4326",
    }),
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.unknown_reason, "invalid_input");
  assert.equal(
    result.details.includes(
      "missing_y_http_400_expected_by_docs_not_live_verified",
    ),
    true,
  );
  assert.equal(result.body_used, false);
  assert.equal(result.elevation, null);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("swapped and junk coordinates are rejected and not echoed", () => {
  const secret = "owner@example.com";
  const swapped = parseUsgsEpqs({
    response: body(),
    request: usgsRequest({
      request_url:
        "https://epqs.nationalmap.gov/v1/json?units=Meters&wkid=4326",
      x: 29.76,
      y: -95.37,
    }),
  });
  assert.equal(swapped.status, "invalid");
  assert.equal(swapped.geometry.x, null);
  assert.equal(swapped.geometry.y, null);
  assert.equal(swapped.details.includes("coordinate_not_swapped"), true);
  const swappedText = JSON.stringify(swapped);
  assert.equal(swappedText.includes("29.76"), false);
  assert.equal(swappedText.includes("-95.37"), false);

  const junk = parseUsgsEpqs({
    response: body({ value: secret }),
    request: usgsRequest({
      request_url:
        "https://epqs.nationalmap.gov/v1/json?units=Meters&wkid=4326",
      x: secret,
      y: 29.76,
    }),
  });
  assert.equal(junk.status, "invalid");
  assert.equal(JSON.stringify(junk).includes(secret), false);
});

test("caller datum, response datum, and resolution units are not verified", () => {
  const result = parseUsgsEpqs({
    response: body({ verticalDatum: "NGVD29", resolutionUnit: "Meters" }),
    request: usgsRequest({ caller_asserted_vertical_datum: "NAVD88" }),
  });
  assert.equal(result.status, "observed");
  assert.equal(result.elevation?.vertical_datum, null);
  assert.equal(result.elevation?.vertical_datum_verified, false);
  assert.equal(result.elevation?.caller_asserted_vertical_datum, "NAVD88");
  assert.equal(result.resolution.unit, null);
  assert.equal(result.details.includes("caller_datum_not_verified"), true);
  assert.equal(
    result.details.includes("response_datum_or_resolution_unit_not_accepted"),
    true,
  );
});

test("a service-content label is date-only and is not the acquisition date", () => {
  const result = parseUsgsEpqs({
    response: body({ attributes: { AcquisitionDate: "0/5/2025" } }),
    request: usgsRequest({ service_content_date: "October 26, 2026" }),
  });
  assert.equal(result.service_content_date.calendar_date, "2026-10-26");
  assert.equal(result.service_content_date.calendar_basis, "date_only");
  assert.equal(result.service_content_date_used_as_acquisition, false);
  assert.equal(result.acquisition_date.raw, "0/5/2025");
  assert.equal(result.acquisition_date.calendar_date, null);
  assert.notEqual(
    result.service_content_date.calendar_date,
    result.acquisition_date.calendar_date,
  );
});

test("a supplied BFE is not subtracted", () => {
  const result = parseUsgsEpqs({
    response: body({ value: 12 }),
    request: usgsRequest({ bfe: 10 }),
  });
  assert.equal(result.elevation?.parsed, 12);
  assert.equal(result.comparability.elevation_minus_bfe, null);
  assert.equal(result.details.includes("bfe_subtraction_refused"), true);
  assert.equal("bfe_delta" in result, false);
});

test("degree-like Web Mercator numbers are not relabeled, and a declared axis conflict is invalid", () => {
  const asMeters = parseUsgsEpqs({
    response: body({
      location: {
        x: -95.37,
        y: 29.76,
        spatialReference: { wkid: 102100, latestWkid: 3857 },
      },
    }),
    request: usgsRequest({
      input_srid: 102100,
      request_url:
        "https://epqs.nationalmap.gov/v1/json?x=-95.37&y=29.76&units=Meters&wkid=102100",
    }),
  });
  assert.equal(asMeters.status, "observed");
  assert.equal(asMeters.geometry.input_srid, 102100);
  assert.equal(asMeters.geometry.x, -95.37);

  const conflict = parseUsgsEpqs({
    response: body({ value: "15.25" }),
    request: usgsRequest({
      input_srid: 102100,
      declared_axis: "longitude_latitude",
      request_url:
        "https://epqs.nationalmap.gov/v1/json?units=Meters&wkid=102100",
    }),
  });
  assert.equal(conflict.status, "invalid");
  assert.equal(conflict.details.includes("axis_incompatible_with_srid"), true);
  assert.equal(conflict.elevation, null);
});

test("extra attribute values are not echoed", () => {
  const person = "Example Person";
  const result = parseUsgsEpqs({
    response: body({
      attributes: { AcquisitionDate: "2024-01-02", OWNER: person },
    }),
    request: usgsRequest(),
  });
  assert.equal(result.withheld_non_context_attributes, true);
  assert.equal(result.acquisition_date.calendar_date, "2024-01-02");
  assert.equal(JSON.stringify(result).includes(person), false);
});

test("the same synthetic input is deterministic", () => {
  const response = Object.freeze(body());
  const request = Object.freeze(usgsRequest());
  assert.deepEqual(
    parseUsgsEpqs({ response, request }),
    parseUsgsEpqs({ response, request }),
  );
});
