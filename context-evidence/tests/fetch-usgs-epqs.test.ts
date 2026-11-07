/**
 * Mocked USGS EPQS point client. No live requests.
 *
 * Fixtures are synthetic. The invalid AcquisitionDate token "0/5/2025",
 * rasterId 30348, and the rounded public coordinate are the retained
 * observation from the parser fixtures. Nothing here is a county coverage
 * or completeness result.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { USGS_EPQS_DOCS_URL } from "../contracts.ts";
import {
  USGS_EPQS_BYTE_CAP,
  USGS_EPQS_DEFAULT_WKID,
  USGS_EPQS_JSON_PATH,
  USGS_EPQS_ORIGIN,
  USGS_EPQS_TIMEOUT_MS,
  fetchUsgsEpqsPoint,
} from "../fetch-usgs-epqs.ts";
import type {
  UsgsEpqsFetchDeps,
  UsgsEpqsPointQuery,
} from "../fetch-usgs-epqs.ts";

const FETCHED_AT = "2026-11-07T12:00:00Z";
const PLANTED = "PLANTED-ELEVATION";
const MERCATOR_LIMIT = 20037508.342789244;
const ENDPOINT = `${USGS_EPQS_ORIGIN}${USGS_EPQS_JSON_PATH}`;

let platformFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  platformFetchCalls += 1;
  throw new Error("platform fetch is not used by the EPQS client");
}) as typeof globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

function pointQuery(
  overrides: Partial<UsgsEpqsPointQuery> = {},
): UsgsEpqsPointQuery {
  return {
    x: -95.37,
    y: 29.76,
    wkid: 4326,
    units: "Meters",
    includeDate: true,
    pointRole: "caller_point",
    commercialScopeAsserted: false,
    ...overrides,
  };
}

function epqsBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    location: {
      x: -95.37,
      y: 29.76,
      spatialReference: { wkid: 4326, latestWkid: 4326 },
    },
    locationId: "synthetic-location",
    value: "15.25",
    rasterId: 30348,
    resolution: 1,
    ...overrides,
  });
}

function jsonResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function chunkedResponse(body: string, status = 200): Response {
  const bytes = new TextEncoder().encode(body);
  const mid = Math.max(1, Math.floor(bytes.byteLength / 2));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("the module does not bind a platform fetch", () => {
  const source = readFileSync(
    new URL("../fetch-usgs-epqs.ts", import.meta.url),
    "utf8",
  );
  const withoutInjected = source.replaceAll("deps.fetch", "");
  assert.equal(source.includes("globalThis.fetch"), false);
  assert.equal(source.includes("global.fetch"), false);
  assert.equal(/\bfetch\s*\(/.test(withoutInjected), false);
  assert.equal(platformFetchCalls, 0);
});

test("requests only the fixed EPQS json endpoint and keeps units and CRS", async () => {
  const body = epqsBody({
    attributes: { AcquisitionDate: "5/1/2025" },
  });
  const seen: { url: string; init: RequestInit }[] = [];
  const deps: UsgsEpqsFetchDeps = {
    now: () => FETCHED_AT,
    fetch: (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(chunkedResponse(body));
    },
  };
  const result = await fetchUsgsEpqsPoint(
    pointQuery({ commercialScopeAsserted: true }),
    deps,
  );
  assert.equal(seen.length, 1);
  const request = seen[0];
  assert.ok(request);
  assert.equal(
    request.url,
    `${ENDPOINT}?x=-95.37&y=29.76&wkid=4326&units=Meters&includeDate=true`,
  );
  const url = new URL(request.url);
  assert.equal(url.origin, USGS_EPQS_ORIGIN);
  assert.equal(url.pathname, USGS_EPQS_JSON_PATH);
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.port, "");
  assert.deepEqual(
    [...url.searchParams.keys()],
    ["x", "y", "wkid", "units", "includeDate"],
  );
  assert.equal(url.searchParams.get("x"), "-95.37");
  assert.equal(url.searchParams.get("y"), "29.76");
  assert.equal(url.searchParams.get("wkid"), "4326");
  assert.equal(url.searchParams.get("units"), "Meters");
  assert.equal(url.searchParams.get("includeDate"), "true");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.redirect, "manual");
  assert.equal(request.init.credentials, "omit");
  assert.equal(
    (request.init as RequestInit & { cache?: string }).cache,
    "no-store",
  );
  assert.deepEqual(request.init.headers, { accept: "application/json" });
  assert.equal(USGS_EPQS_BYTE_CAP, 65536);
  assert.equal(USGS_EPQS_TIMEOUT_MS, 8000);
  assert.equal(USGS_EPQS_DEFAULT_WKID, 4326);
  assert.equal(result.transport.attempts, 1);
  assert.equal(result.transport.retries, 0);
  assert.equal(result.transport.failure, "none");
  assert.equal(result.transport.byte_cap, USGS_EPQS_BYTE_CAP);
  assert.equal(result.transport.timeout_ms, USGS_EPQS_TIMEOUT_MS);
  assert.equal(result.transport.wkid_sent, 4326);
  assert.equal(result.transport.wkid_defaulted, false);
  assert.equal(result.transport.units_sent, "Meters");
  assert.equal(result.transport.units_defaulted, false);
  assert.equal(result.transport.include_date_sent, true);
  assert.equal(result.transport.undocumented_wkid_4269_sent, false);
  assert.equal(result.transport.redirect_followed, false);
  assert.equal(result.evidence.status, "observed");
  assert.equal(result.evidence.fetched_at, FETCHED_AT);
  assert.equal(result.evidence.source_url, USGS_EPQS_DOCS_URL);
  assert.equal(result.evidence.request_url, request.url);
  assert.equal(result.evidence.official_host_recognized, true);
  assert.equal(result.evidence.source_authenticity_verified, false);
  assert.equal(result.evidence.geometry.input_srid, 4326);
  assert.equal(result.evidence.geometry.point_role, "caller_point");
  assert.equal(result.evidence.geometry.covers_whole_parcel, false);
  assert.equal(result.evidence.elevation?.parsed, 15.25);
  assert.equal(result.evidence.elevation?.raw, "15.25");
  assert.equal(result.evidence.elevation?.requested_unit, "Meters");
  assert.equal(result.evidence.elevation?.linear_unit, "meter");
  assert.equal(result.evidence.elevation?.exact_meters_per_unit, "1");
  assert.equal(result.evidence.elevation?.usable_as_contextual_elevation, true);
  assert.equal(result.evidence.elevation?.vertical_datum, null);
  assert.equal(result.evidence.elevation?.vertical_datum_verified, false);
  assert.equal(result.evidence.acquisition_date.calendar_date, "2025-05-01");
  assert.equal(result.evidence.acquisition_date.guessed, false);
  assert.equal(result.evidence.raster_id, 30348);
  assert.equal(result.evidence.resolution.unit, null);
  assert.equal(result.evidence.resolution.unit_known, false);
  assert.equal(result.evidence.commercial_scope_verified, false);
  assert.equal(result.evidence.caller_asserts_commercial_scope, true);
  assert.equal(result.evidence.parcel_identity_verified, false);
  assert.equal(result.evidence.accepted_undocumented_wkid_4269, false);
  assert.deepEqual(result.evidence.documented_wkids, [4326, 102100]);
  assert.equal(result.evidence.comparability.elevation_minus_bfe, null);
  assert.equal(result.evidence.comparability.flood_risk_probability, null);
  assert.equal(result.evidence.comparability.insurance_determination, null);
  assert.equal(result.evidence.comparability.buildability_determination, null);
  assert.equal(result.evidence.comparability.survey_determination, null);
  assert.equal(result.evidence.limits.bfe_subtraction, false);
  assert.equal(result.evidence.limits.flood_probability, false);
  assert.equal(result.evidence.response_hash_basis, "response_text");
  assert.equal(
    result.evidence.response_sha256,
    createHash("sha256").update(body, "utf8").digest("hex"),
  );
  assert.equal(
    result.evidence.disclaimers.includes("no_elevation_bfe_subtraction"),
    true,
  );
  assert.equal(platformFetchCalls, 0);
});

test("an omitted wkid is sent as 4326 and units are never defaulted", async () => {
  const seen: string[] = [];
  const deps: UsgsEpqsFetchDeps = {
    now: () => FETCHED_AT,
    fetch: (url) => {
      seen.push(url);
      return Promise.resolve(jsonResponse(epqsBody()));
    },
  };
  const omitted = await fetchUsgsEpqsPoint(
    {
      x: -95.37,
      y: 29.76,
      units: "Meters",
      pointRole: "caller_point",
    },
    deps,
  );
  assert.equal(
    seen[0],
    `${ENDPOINT}?x=-95.37&y=29.76&wkid=4326&units=Meters&includeDate=false`,
  );
  assert.equal(omitted.transport.wkid_sent, 4326);
  assert.equal(omitted.transport.wkid_defaulted, true);
  assert.equal(omitted.transport.include_date_sent, false);
  assert.equal(omitted.transport.units_defaulted, false);
  assert.equal(omitted.evidence.geometry.input_srid, 4326);
  assert.equal(omitted.evidence.elevation?.requested_unit, "Meters");
  assert.equal(omitted.evidence.acquisition_date.calendar_date, null);
  assert.equal(omitted.evidence.acquisition_date.guessed, false);
  assert.equal(
    omitted.evidence.details.includes("acquisition_date_missing"),
    true,
  );

  let calls = 0;
  const missingUnits = await fetchUsgsEpqsPoint(
    pointQuery({ units: undefined }),
    {
      now: () => FETCHED_AT,
      fetch: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(epqsBody({ value: PLANTED })));
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(missingUnits.transport.attempts, 0);
  assert.equal(missingUnits.transport.failure, "invalid_input");
  assert.equal(missingUnits.transport.units_sent, null);
  assert.equal(missingUnits.transport.units_defaulted, false);
  assert.equal(missingUnits.evidence.status, "invalid");
  assert.equal(missingUnits.evidence.elevation, null);
  assert.equal(
    missingUnits.evidence.details.includes("no_default_units"),
    true,
  );
  assert.equal(missingUnits.evidence.request_url?.includes("units="), false);
  assert.equal(JSON.stringify(missingUnits).includes(PLANTED), false);

  for (const units of ["feet", "ft", "meters", "ftUS", "US survey feet"]) {
    let unitCalls = 0;
    const result = await fetchUsgsEpqsPoint(pointQuery({ units }), {
      now: () => FETCHED_AT,
      fetch: () => {
        unitCalls += 1;
        return Promise.resolve(jsonResponse(epqsBody({ value: 10 })));
      },
    });
    assert.equal(unitCalls, 0, units);
    assert.equal(result.transport.failure, "invalid_input");
    assert.equal(result.evidence.elevation, null);
    assert.equal(result.evidence.details.includes("units_unrecognized"), true);
    assert.equal(result.evidence.request_url?.includes("units="), false);
  }
});

test("explicit Feet means international feet and 102100 is not relabeled", async () => {
  let requested = "";
  const result = await fetchUsgsEpqsPoint(
    pointQuery({
      x: -10615000,
      y: 3470000,
      wkid: 102100,
      units: "Feet",
      includeDate: false,
    }),
    {
      now: () => FETCHED_AT,
      fetch: (url) => {
        requested = url;
        return Promise.resolve(
          jsonResponse(
            epqsBody({
              value: 120,
              location: {
                x: -10615000,
                y: 3470000,
                spatialReference: { wkid: 102100, latestWkid: 3857 },
              },
            }),
          ),
        );
      },
    },
  );
  assert.equal(
    requested,
    `${ENDPOINT}?x=-10615000&y=3470000&wkid=102100&units=Feet&includeDate=false`,
  );
  assert.equal(requested.includes("4269"), false);
  assert.equal(requested.includes("3857"), false);
  assert.equal(result.transport.wkid_sent, 102100);
  assert.equal(result.transport.wkid_defaulted, false);
  assert.equal(result.transport.units_sent, "Feet");
  assert.equal(result.evidence.status, "observed");
  assert.equal(result.evidence.geometry.input_srid, 102100);
  assert.equal(result.evidence.geometry.returned_latest_srid, 3857);
  assert.equal(
    result.evidence.details.includes("latest_wkid_recorded_not_relabeled"),
    true,
  );
  assert.equal(result.evidence.elevation?.requested_unit, "Feet");
  assert.equal(result.evidence.elevation?.linear_unit, "international_foot");
  assert.equal(result.evidence.elevation?.exact_meters_per_unit, "0.3048");
  assert.equal(result.evidence.elevation?.us_survey_foot_assumed, false);
  assert.equal(result.evidence.elevation?.parsed, 120);
  assert.equal(result.evidence.elevation?.usable_as_contextual_elevation, true);
  assert.equal(result.evidence.elevation?.vertical_datum, null);
});

test("degree-like Web Mercator numbers are sent unchanged", async () => {
  let requested = "";
  const result = await fetchUsgsEpqsPoint(
    pointQuery({ x: 29.76, y: -95.37, wkid: 102100, units: "Meters" }),
    {
      now: () => FETCHED_AT,
      fetch: (url) => {
        requested = url;
        return Promise.resolve(
          jsonResponse(
            epqsBody({
              value: 12,
              location: {
                x: 29.76,
                y: -95.37,
                spatialReference: { wkid: 102100, latestWkid: 3857 },
              },
            }),
          ),
        );
      },
    },
  );
  assert.equal(
    requested,
    `${ENDPOINT}?x=29.76&y=-95.37&wkid=102100&units=Meters&includeDate=true`,
  );
  assert.equal(requested.includes("wkid=4326"), false);
  assert.equal(requested.includes("-10615000"), false);
  assert.equal(result.evidence.geometry.input_srid, 102100);
  assert.equal(result.evidence.geometry.x, 29.76);
  assert.equal(result.evidence.geometry.y, -95.37);
  assert.equal(result.evidence.elevation?.parsed, 12);
  assert.equal(result.transport.failure, "none");
});

test("documented geographic and mercator bounds are fetched and the next step is not", async () => {
  const cases: { query: Partial<UsgsEpqsPointQuery>; urlPart: string }[] = [
    {
      query: { x: 180, y: 90, wkid: 4326 },
      urlPart: "x=180&y=90&wkid=4326",
    },
    {
      query: { x: -180, y: -90, wkid: 4326 },
      urlPart: "x=-180&y=-90&wkid=4326",
    },
    {
      query: { x: MERCATOR_LIMIT, y: -MERCATOR_LIMIT, wkid: 102100 },
      urlPart: `x=${MERCATOR_LIMIT}&y=${-MERCATOR_LIMIT}&wkid=102100`,
    },
  ];
  for (const item of cases) {
    let requested = "";
    const query = pointQuery({ ...item.query, includeDate: false });
    const x = query.x as number;
    const y = query.y as number;
    const wkid = query.wkid as number;
    const result = await fetchUsgsEpqsPoint(query, {
      now: () => FETCHED_AT,
      fetch: (url) => {
        requested = url;
        return Promise.resolve(
          jsonResponse(
            epqsBody({
              value: 1,
              location: {
                x,
                y,
                spatialReference: { wkid, latestWkid: wkid },
              },
            }),
          ),
        );
      },
    });
    assert.equal(requested.includes(item.urlPart), true, item.urlPart);
    assert.equal(result.transport.failure, "none", item.urlPart);
    assert.equal(result.evidence.elevation?.parsed, 1, item.urlPart);
    assert.equal(new URL(requested).origin, USGS_EPQS_ORIGIN);
  }

  for (const overrides of [
    { x: 180.0000001, wkid: 4326 },
    { y: -90.0000001, wkid: 4326 },
    { x: MERCATOR_LIMIT + 1, y: 0, wkid: 102100 },
    { x: 0, y: -MERCATOR_LIMIT - 1, wkid: 102100 },
  ]) {
    let calls = 0;
    const result = await fetchUsgsEpqsPoint(pointQuery(overrides), {
      now: () => FETCHED_AT,
      fetch: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(epqsBody({ value: PLANTED })));
      },
    });
    assert.equal(calls, 0, JSON.stringify(overrides));
    assert.equal(result.transport.attempts, 0);
    assert.equal(result.evidence.elevation, null);
    assert.equal(
      result.evidence.details.includes("coordinate_out_of_range"),
      true,
    );
    assert.equal(JSON.stringify(result).includes(PLANTED), false);
  }
});

test("a caller-supplied URL, host, or credential is ignored", async () => {
  let requested = "";
  const deps: UsgsEpqsFetchDeps = {
    now: () => FETCHED_AT,
    fetch: (url) => {
      requested = url;
      return Promise.resolve(jsonResponse(epqsBody()));
    },
  };
  await fetchUsgsEpqsPoint(
    {
      ...pointQuery(),
      url: "https://evil.example/v1/json?x=1&y=2&wkid=4269&units=Feet",
      endpoint: "https://apps.nationalmap.gov/epqs/",
      host: "https://epqs.nationalmap.gov/v1/xml",
      apiKey: "secret-token",
    } as UsgsEpqsPointQuery,
    deps,
  );
  assert.equal(new URL(requested).origin, USGS_EPQS_ORIGIN);
  assert.equal(new URL(requested).pathname, USGS_EPQS_JSON_PATH);
  assert.equal(requested.includes("evil.example"), false);
  assert.equal(requested.includes("apps.nationalmap.gov"), false);
  assert.equal(requested.includes("/v1/xml"), false);
  assert.equal(requested.includes("4269"), false);
  assert.equal(requested.includes("secret-token"), false);
  assert.equal(requested.includes("apiKey"), false);
  assert.equal(platformFetchCalls, 0);
});

test("bad CRS, geometry, includeDate, or point role does not fetch", async () => {
  const secret = "owner@example.com";
  const cases: Partial<UsgsEpqsPointQuery>[] = [
    { x: Number.NaN },
    { x: Number.POSITIVE_INFINITY },
    { x: 1e-7 },
    { x: secret as unknown as number },
    { x: "-95.37" as unknown as number },
    { y: undefined },
    { x: 29.76, y: -95.37 },
    { wkid: 4269 },
    { wkid: 3857 },
    { wkid: 4269.5 },
    { wkid: "4326" as unknown as number },
    { wkid: "EPSG:4326" as unknown as number },
    { wkid: null },
    { includeDate: "true" as unknown as boolean },
    { includeDate: 1 as unknown as boolean },
    { includeDate: null },
    { pointRole: undefined },
    { pointRole: "parcel" as unknown as UsgsEpqsPointQuery["pointRole"] },
  ];
  for (const overrides of cases) {
    let calls = 0;
    const result = await fetchUsgsEpqsPoint(pointQuery(overrides), {
      now: () => FETCHED_AT,
      fetch: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(epqsBody({ value: PLANTED })));
      },
    });
    assert.equal(calls, 0, JSON.stringify(overrides));
    assert.equal(result.transport.attempts, 0);
    assert.equal(result.transport.retries, 0);
    assert.equal(result.transport.failure, "invalid_input");
    assert.equal(result.transport.undocumented_wkid_4269_sent, false);
    assert.equal(result.transport.wkid_sent, null);
    assert.equal(result.evidence.status, "invalid");
    assert.equal(result.evidence.unknown_reason, "invalid_input");
    assert.equal(result.evidence.body_used, false);
    assert.equal(result.evidence.elevation, null);
    assert.equal(result.evidence.request_url, ENDPOINT);
    assert.equal(result.evidence.request_url?.includes("wkid="), false);
    assert.equal(JSON.stringify(result).includes(PLANTED), false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }

  const swapped = await fetchUsgsEpqsPoint(
    pointQuery({ x: 29.76, y: -95.37 }),
    {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(epqsBody())),
    },
  );
  assert.equal(swapped.evidence.geometry.x, null);
  assert.equal(swapped.evidence.geometry.y, null);
  assert.equal(
    swapped.evidence.details.includes("coordinate_not_swapped"),
    true,
  );
  assert.equal(JSON.stringify(swapped).includes("29.76"), false);
  assert.equal(JSON.stringify(swapped).includes("-95.37"), false);

  const nad83 = await fetchUsgsEpqsPoint(pointQuery({ wkid: 4269 }), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(epqsBody({ value: PLANTED }))),
  });
  assert.equal(nad83.transport.attempts, 0);
  assert.equal(nad83.transport.undocumented_wkid_4269_sent, false);
  assert.equal(nad83.evidence.accepted_undocumented_wkid_4269, false);
  assert.equal(
    nad83.evidence.details.includes("wkid_4269_not_documented"),
    true,
  );
  assert.equal(nad83.evidence.request_url?.includes("4269"), false);
  assert.equal(nad83.evidence.elevation, null);

  const missingY = await fetchUsgsEpqsPoint(pointQuery({ y: undefined }), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(epqsBody())),
  });
  assert.equal(missingY.transport.attempts, 0);
  assert.equal(
    missingY.evidence.details.includes(
      "missing_y_http_400_expected_by_docs_not_live_verified",
    ),
    true,
  );
  assert.equal(missingY.evidence.elevation, null);
});

test("documented point roles are forwarded", async () => {
  for (const pointRole of [
    "caller_point",
    "centroid",
    "representative_point",
  ] as const) {
    const result = await fetchUsgsEpqsPoint(pointQuery({ pointRole }), {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(epqsBody())),
    });
    assert.equal(result.transport.failure, "none", pointRole);
    assert.equal(result.evidence.geometry.point_role, pointRole);
  }
});

test("a byte cap, a broken stream, and an oversized content-length are not an elevation", async () => {
  const oversized = new Uint8Array(USGS_EPQS_BYTE_CAP + 1);
  oversized.set(new TextEncoder().encode(`{"value":"${PLANTED}"}`));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oversized);
      controller.close();
    },
  });
  const streamed = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(new Response(stream, { status: 200 })),
  });
  assert.equal(streamed.transport.failure, "truncated");
  assert.equal(streamed.transport.attempts, 1);
  assert.equal(streamed.transport.retries, 0);
  assert.equal(streamed.evidence.unknown_reason, "truncated");
  assert.equal(streamed.evidence.elevation, null);
  assert.equal(streamed.evidence.body_used, false);
  assert.equal(JSON.stringify(streamed).includes(PLANTED), false);

  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"value":"${PLANTED}"}`));
      controller.error(new Error("cut"));
    },
  });
  const cut = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(new Response(broken, { status: 200 })),
  });
  assert.equal(cut.transport.failure, "truncated");
  assert.equal(cut.evidence.elevation, null);
  assert.equal(JSON.stringify(cut).includes(PLANTED), false);

  const declared = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(epqsBody({ value: PLANTED }), 200, {
          "content-length": String(USGS_EPQS_BYTE_CAP + 1),
        }),
      ),
  });
  assert.equal(declared.transport.failure, "truncated");
  assert.equal(declared.evidence.unknown_reason, "truncated");
  assert.equal(declared.evidence.elevation, null);
  assert.equal(declared.evidence.http_status, 200);
  assert.equal(JSON.stringify(declared).includes(PLANTED), false);
});

test("timeout and network failure do not retry or invent an elevation", async () => {
  let calls = 0;
  let fire: (() => void) | undefined;
  const delays: number[] = [];
  const pending = fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    setTimeout: (fn, ms) => {
      delays.push(ms);
      fire = fn;
      return 1;
    },
    clearTimeout: () => undefined,
    fetch: (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(delays, [USGS_EPQS_TIMEOUT_MS]);
  assert.ok(fire);
  fire();
  const timedOut = await pending;
  assert.equal(calls, 1);
  assert.equal(timedOut.transport.retries, 0);
  assert.equal(timedOut.transport.failure, "timeout");
  assert.equal(timedOut.transport.wkid_sent, 4326);
  assert.equal(timedOut.transport.units_sent, "Meters");
  assert.equal(timedOut.evidence.unknown_reason, "timeout");
  assert.deepEqual(timedOut.evidence.unknown_reasons, ["timeout"]);
  assert.equal(timedOut.evidence.elevation, null);
  assert.equal(timedOut.evidence.body_used, false);
  assert.equal(timedOut.evidence.geometry.input_srid, 4326);

  const network = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: () => Promise.reject(new Error("secret-host.example")),
  });
  assert.equal(network.transport.failure, "network");
  assert.equal(network.transport.attempts, 1);
  assert.equal(network.transport.retries, 0);
  assert.equal(network.evidence.unknown_reason, "timeout");
  assert.equal(network.evidence.elevation, null);
  assert.equal(JSON.stringify(network).includes("secret-host.example"), false);
  assert.equal(platformFetchCalls, 0);
});

test("caller cancel does not become an elevation", async () => {
  let calls = 0;
  const already = AbortSignal.abort();
  const pre = await fetchUsgsEpqsPoint(pointQuery({ signal: already }), {
    now: () => FETCHED_AT,
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(epqsBody({ value: PLANTED })));
    },
  });
  assert.equal(calls, 0);
  assert.equal(pre.transport.failure, "caller_cancel");
  assert.equal(pre.transport.attempts, 0);
  assert.equal(pre.transport.retries, 0);
  assert.equal(pre.transport.wkid_sent, null);
  assert.equal(pre.evidence.unknown_reason, "timeout");
  assert.equal(pre.evidence.elevation, null);
  assert.equal(JSON.stringify(pre).includes(PLANTED), false);

  const controller = new AbortController();
  let sawAbort = false;
  const inflight = fetchUsgsEpqsPoint(
    pointQuery({ signal: controller.signal }),
    {
      now: () => FETCHED_AT,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      fetch: (_url, init) =>
        new Promise((resolve, reject) => {
          calls += 1;
          init.signal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    },
  );
  controller.abort();
  const cancelled = await inflight;
  assert.equal(calls, 1);
  assert.equal(sawAbort, true);
  assert.equal(cancelled.transport.failure, "caller_cancel");
  assert.equal(cancelled.transport.retries, 0);
  assert.equal(cancelled.transport.attempts, 1);
  assert.equal(cancelled.evidence.elevation, null);
  assert.equal(cancelled.evidence.comparability.elevation_minus_bfe, null);
});

test("HTTP errors, 403, and 429 are a single attempt and not an elevation", async () => {
  for (const status of [400, 403, 429, 500]) {
    let calls = 0;
    const delays: number[] = [];
    const result = await fetchUsgsEpqsPoint(pointQuery(), {
      now: () => FETCHED_AT,
      setTimeout: (_fn, ms) => {
        delays.push(ms);
        return 1;
      },
      clearTimeout: () => undefined,
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          jsonResponse(
            JSON.stringify({
              value: PLANTED,
              error: { code: status, message: "slow down" },
            }),
            status,
            status === 429 ? { "retry-after": "1" } : {},
          ),
        );
      },
    });
    assert.equal(calls, 1, String(status));
    assert.deepEqual(delays, [USGS_EPQS_TIMEOUT_MS], String(status));
    assert.equal(result.transport.retries, 0);
    assert.equal(result.transport.failure, "http");
    assert.equal(result.evidence.unknown_reason, "provider_error");
    assert.equal(result.evidence.http_status, status);
    assert.equal(result.evidence.elevation, null);
    assert.equal(result.evidence.provider_error_message, null);
    assert.equal(result.evidence.geometry.input_srid, 4326);
    assert.equal(result.evidence.request_url?.includes("units=Meters"), true);
    assert.equal(JSON.stringify(result).includes(PLANTED), false);
    assert.equal(JSON.stringify(result).includes("slow down"), false);
  }

  const arcgis = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(
          JSON.stringify({
            error: {
              code: 400,
              message: "Invalid or missing input parameters.",
            },
            value: PLANTED,
          }),
        ),
      ),
  });
  assert.equal(arcgis.transport.failure, "none");
  assert.equal(arcgis.transport.attempts, 1);
  assert.equal(arcgis.evidence.unknown_reason, "provider_error");
  assert.equal(arcgis.evidence.details.includes("provider_error_object"), true);
  assert.equal(
    arcgis.evidence.provider_error_message,
    "Invalid or missing input parameters.",
  );
  assert.equal(arcgis.evidence.elevation, null);
  assert.equal(JSON.stringify(arcgis).includes(PLANTED), false);
});

test("a no-data sentinel is not rewritten to zero, and a real zero stays zero", async () => {
  const sentinel = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(epqsBody({ value: -1000000 }))),
  });
  assert.equal(sentinel.transport.failure, "none");
  assert.equal(sentinel.evidence.status, "unknown");
  assert.equal(sentinel.evidence.unknown_reason, "nodata_unverified");
  assert.equal(sentinel.evidence.elevation?.parsed, -1000000);
  assert.equal(
    sentinel.evidence.elevation?.usable_as_contextual_elevation,
    false,
  );
  assert.equal(
    sentinel.evidence.elevation?.nodata_encoding_live_verified,
    false,
  );
  assert.equal(
    sentinel.evidence.details.includes("nodata_encoding_not_live_verified"),
    true,
  );

  for (const value of [0, -3.2, "0"]) {
    const result = await fetchUsgsEpqsPoint(pointQuery(), {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(epqsBody({ value }))),
    });
    assert.equal(result.evidence.status, "observed", String(value));
    assert.equal(result.evidence.unknown_reason, null, String(value));
    assert.equal(
      result.evidence.unknown_reasons.includes("nodata_unverified"),
      false,
      String(value),
    );
    assert.equal(
      result.evidence.elevation?.usable_as_contextual_elevation,
      true,
    );
    assert.equal(result.evidence.elevation?.zero_can_be_valid_terrain, true);
    assert.notEqual(result.evidence.elevation?.parsed, null);
  }
  const zero = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(epqsBody({ value: 0 }))),
  });
  assert.equal(zero.evidence.elevation?.parsed, 0);
});

test("an invalid AcquisitionDate is not repaired", async () => {
  const result = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(
          epqsBody({
            value: "15.25",
            rasterId: 30348,
            resolution: 1,
            attributes: {
              AcquisitionDate: "0/5/2025",
              OWNER: "Example Person",
            },
          }),
        ),
      ),
  });
  assert.equal(result.evidence.status, "observed");
  assert.equal(result.evidence.acquisition_date.raw, "0/5/2025");
  assert.equal(result.evidence.acquisition_date.calendar_date, null);
  assert.equal(result.evidence.acquisition_date.invalid, true);
  assert.equal(result.evidence.acquisition_date.guessed, false);
  assert.equal(
    result.evidence.unknown_reasons.includes("invalid_source_date"),
    true,
  );
  assert.equal(result.evidence.elevation?.parsed, 15.25);
  assert.equal(result.evidence.elevation?.usable_as_contextual_elevation, true);
  assert.equal(result.evidence.withheld_non_context_attributes, true);
  assert.equal(JSON.stringify(result).includes("Example Person"), false);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes("2025-05-05"), false);
  assert.equal(encoded.includes("2025-01-05"), false);
  assert.equal(encoded.includes("2025-05-01"), false);
});

test("a response datum is not verified", async () => {
  const result = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(
          epqsBody({ verticalDatum: "NAVD88", resolutionUnit: "Meters" }),
        ),
      ),
  });
  assert.equal(result.evidence.elevation?.vertical_datum, null);
  assert.equal(result.evidence.elevation?.vertical_datum_verified, false);
  assert.equal(result.evidence.resolution.unit, null);
  assert.equal(
    result.evidence.details.includes(
      "response_datum_or_resolution_unit_not_accepted",
    ),
    true,
  );
});

test("redirects are not followed", async () => {
  const locations = [
    "https://evil.example/v1/json",
    "https://apps.nationalmap.gov/epqs/",
    "https://epqs.nationalmap.gov/v1/xml",
    "https://epqs.nationalmap.gov/v1/json/",
    "https://user:secret@epqs.nationalmap.gov/v1/json",
    "http://epqs.nationalmap.gov/v1/json",
  ];
  for (const location of locations) {
    for (const status of [301, 302, 307, 308]) {
      const urls: string[] = [];
      const result = await fetchUsgsEpqsPoint(pointQuery(), {
        now: () => FETCHED_AT,
        fetch: (url) => {
          urls.push(url);
          return Promise.resolve(
            new Response(JSON.stringify({ value: PLANTED }), {
              status,
              headers: { location },
            }),
          );
        },
      });
      assert.equal(urls.length, 1);
      assert.equal(new URL(urls[0] ?? "").origin, USGS_EPQS_ORIGIN);
      assert.equal(result.transport.attempts, 1);
      assert.equal(result.transport.retries, 0);
      assert.equal(result.transport.redirect_followed, false);
      assert.equal(result.transport.failure, "redirect");
      assert.equal(result.transport.cross_origin_redirect_blocked, true);
      assert.equal(result.evidence.unknown_reason, "provider_error");
      assert.equal(result.evidence.http_status, status);
      assert.equal(result.evidence.elevation, null);
      const encoded = JSON.stringify(result);
      assert.equal(encoded.includes(PLANTED), false);
      assert.equal(encoded.includes("evil.example"), false);
      assert.equal(encoded.includes("secret"), false);
      assert.equal(encoded.includes("apps.nationalmap.gov"), false);
    }
  }

  const sameHost = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ value: PLANTED }), {
          status: 302,
          headers: {
            location:
              "https://epqs.nationalmap.gov/v1/json?x=0&y=0&wkid=102100&units=Feet&includeDate=true",
          },
        }),
      ),
  });
  assert.equal(sameHost.transport.failure, "redirect");
  assert.equal(sameHost.transport.redirect_followed, false);
  assert.equal(sameHost.transport.cross_origin_redirect_blocked, false);
  assert.equal(sameHost.transport.retries, 0);
  assert.equal(sameHost.evidence.elevation, null);
  assert.equal(sameHost.evidence.request_url?.includes("units=Meters"), true);
  assert.equal(sameHost.evidence.request_url?.includes("units=Feet"), false);
  assert.equal(JSON.stringify(sameHost).includes(PLANTED), false);
});

test("a final URL outside the allowlist is not parsed", async () => {
  const urls = [
    "https://evil.example/v1/json",
    "https://epqs.nationalmap.gov/v1/xml",
    "https://user:secret@epqs.nationalmap.gov/v1/json",
    "http://epqs.nationalmap.gov/v1/json",
  ];
  for (const finalUrl of urls) {
    const response = new Response(JSON.stringify({ value: PLANTED }), {
      status: 200,
    });
    Object.defineProperty(response, "url", { value: finalUrl });
    const result = await fetchUsgsEpqsPoint(pointQuery(), {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(response),
    });
    assert.equal(result.transport.failure, "redirect", finalUrl);
    assert.equal(result.transport.redirect_followed, false);
    assert.equal(result.transport.cross_origin_redirect_blocked, true);
    assert.equal(result.transport.retries, 0);
    assert.equal(result.evidence.elevation, null);
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes(PLANTED), false, finalUrl);
    assert.equal(encoded.includes("secret"), false, finalUrl);
    assert.equal(encoded.includes("evil.example"), false, finalUrl);
  }
});

test("malformed, empty, and non-JSON bodies are not elevation zero", async () => {
  const malformed = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse("{not-json")),
  });
  assert.equal(malformed.transport.failure, "none");
  assert.equal(malformed.evidence.unknown_reason, "malformed_response");
  assert.equal(malformed.evidence.details.includes("body_not_json"), true);
  assert.equal(malformed.evidence.elevation, null);

  const xml = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        new Response("<Elevation>15.25</Elevation>", { status: 200 }),
      ),
  });
  assert.equal(xml.evidence.unknown_reason, "malformed_response");
  assert.equal(xml.evidence.elevation, null);
  assert.equal(JSON.stringify(xml).includes("15.25"), false);

  for (const body of ["", "null", "0", "[]"]) {
    const result = await fetchUsgsEpqsPoint(pointQuery(), {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(body)),
    });
    assert.equal(result.evidence.elevation, null, body);
    assert.equal(result.evidence.unknown_reason, "malformed_response", body);
  }
});

test("a missing injected fetch or a bad clock does not call the network", async () => {
  const started = platformFetchCalls;
  const missing = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => FETCHED_AT,
  } as UsgsEpqsFetchDeps);
  assert.equal(missing.transport.failure, "invalid_input");
  assert.equal(missing.transport.attempts, 0);
  assert.equal(missing.evidence.elevation, null);
  assert.equal(platformFetchCalls, started);

  let calls = 0;
  const badClock = await fetchUsgsEpqsPoint(pointQuery(), {
    now: () => "not-a-timestamp",
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(epqsBody({ value: PLANTED })));
    },
  });
  assert.equal(calls, 0);
  assert.equal(badClock.transport.failure, "invalid_input");
  assert.equal(badClock.transport.attempts, 0);
  assert.equal(badClock.evidence.status, "invalid");
  assert.equal(badClock.evidence.elevation, null);
  assert.equal(JSON.stringify(badClock).includes(PLANTED), false);

  const defaultClock = await fetchUsgsEpqsPoint(pointQuery(), {
    fetch: () => Promise.resolve(jsonResponse(epqsBody())),
  });
  assert.equal(defaultClock.transport.failure, "none");
  assert.equal(defaultClock.evidence.fetched_at_valid, true);
  assert.match(
    defaultClock.evidence.fetched_at ?? "",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
  );
  assert.equal(platformFetchCalls, started);
});

test("commercial scope stays a caller assertion and a supplied BFE is not subtracted", async () => {
  const asserted = await fetchUsgsEpqsPoint(
    {
      ...pointQuery({ commercialScopeAsserted: true }),
      bfe: 10,
      static_bfe: 12,
    } as UsgsEpqsPointQuery,
    {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(epqsBody({ value: 15.25 }))),
    },
  );
  assert.equal(asserted.evidence.caller_asserts_commercial_scope, true);
  assert.equal(asserted.evidence.commercial_scope_verified, false);
  assert.equal(asserted.evidence.elevation?.parsed, 15.25);
  assert.equal(asserted.evidence.comparability.elevation_minus_bfe, null);
  assert.equal(
    asserted.evidence.details.includes("bfe_subtraction_refused"),
    false,
  );
  assert.equal("bfe_delta" in asserted.evidence, false);

  const textual = await fetchUsgsEpqsPoint(
    pointQuery({
      commercialScopeAsserted: "true" as unknown as boolean,
    }),
    {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(epqsBody())),
    },
  );
  assert.equal(textual.evidence.caller_asserts_commercial_scope, false);
  assert.equal(textual.evidence.commercial_scope_verified, false);
  assert.equal(textual.transport.failure, "none");
});

test("the same injected clock and body are deterministic", async () => {
  const body = epqsBody({
    attributes: { AcquisitionDate: "0/5/2025" },
  });
  const deps: UsgsEpqsFetchDeps = {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(body)),
  };
  const query = pointQuery();
  assert.deepEqual(
    await fetchUsgsEpqsPoint(query, deps),
    await fetchUsgsEpqsPoint(query, deps),
  );
});
