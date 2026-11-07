/**
 * Mocked FEMA effective NFHL point client. No live requests.
 * Fixtures are synthetic. The rounded coordinate is the public example only.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  FEMA_EFFECTIVE_LAYER28_PATH,
  FEMA_EFFECTIVE_ORIGIN,
  FEMA_POINT_BYTE_CAP,
  FEMA_POINT_RECORD_CAP,
  FEMA_POINT_TIMEOUT_MS,
  fetchFemaEffectiveNfhlPoint,
} from "../fetch-fema-nfhl.ts";
import type { FemaFetchDeps, FemaPointQuery } from "../fetch-fema-nfhl.ts";

const FETCHED_AT = "2026-11-07T12:00:00Z";
const PLANTED = "PLANTED-ZONE-TOKEN";

function pointQuery(overrides: Partial<FemaPointQuery> = {}): FemaPointQuery {
  return {
    x: -95.37,
    y: 29.76,
    inputSrid: 4269,
    pointRole: "caller_point",
    commercialScopeAsserted: false,
    ...overrides,
  };
}

function featureBody(zones: string[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    exceededTransferLimit: false,
    ...extra,
    features: zones.map((zone, index) => ({
      attributes: {
        OBJECTID: index + 1,
        DFIRM_ID: "48201C",
        FLD_ZONE: zone,
        ZONE_SUBTY: zone === "X" ? "AREA OF MINIMAL FLOOD HAZARD" : null,
        SFHA_TF: zone === "X" ? "F" : "T",
        STATIC_BFE: -9999,
        DEPTH: -9999,
        VELOCITY: -9999,
        V_DATUM: null,
        LEN_UNIT: null,
        VEL_UNIT: null,
        SOURCE_CIT: "SYNTHETIC",
      },
    })),
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

test("requests the fixed effective layer-28 endpoint with explicit CRS and geometry", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const deps: FemaFetchDeps = {
    now: () => FETCHED_AT,
    fetch: (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(jsonResponse(featureBody(["X"])));
    },
  };
  const result = await fetchFemaEffectiveNfhlPoint(
    pointQuery({ commercialScopeAsserted: true }),
    deps,
  );
  assert.equal(seen.length, 1);
  const request = seen[0];
  assert.ok(request);
  const url = new URL(request.url);
  assert.equal(url.origin, FEMA_EFFECTIVE_ORIGIN);
  assert.equal(url.pathname, FEMA_EFFECTIVE_LAYER28_PATH);
  assert.equal(url.searchParams.get("f"), "json");
  assert.equal(url.searchParams.get("geometry"), "-95.37,29.76");
  assert.equal(url.searchParams.get("geometryType"), "esriGeometryPoint");
  assert.equal(url.searchParams.get("inSR"), "4269");
  assert.equal(url.searchParams.get("spatialRel"), "esriSpatialRelIntersects");
  assert.equal(url.searchParams.get("returnGeometry"), "false");
  assert.equal(
    url.searchParams.get("resultRecordCount"),
    String(FEMA_POINT_RECORD_CAP),
  );
  assert.equal(url.searchParams.has("resultOffset"), false);
  assert.equal(request.url.includes("geometry=-95.37%2C29.76"), true);
  assert.equal(request.url.includes("/MapServer/0"), false);
  assert.equal(request.url.toLowerCase().includes("prelim"), false);
  const fields = url.searchParams.get("outFields") ?? "";
  assert.equal(fields.includes("FLD_ZONE"), true);
  assert.equal(fields.includes("ZONE_SUBTY"), true);
  assert.equal(fields.includes("OWNER"), false);
  assert.equal(fields.includes("ADDRESS"), false);
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.redirect, "manual");
  assert.equal(request.init.credentials, "omit");
  assert.equal(
    (request.init as RequestInit & { cache?: string }).cache,
    "no-store",
  );
  assert.deepEqual(request.init.headers, { accept: "application/json" });
  assert.equal(result.transport.attempts, 1);
  assert.equal(result.transport.retries, 0);
  assert.equal(result.transport.failure, "none");
  assert.equal(result.transport.layer_id, 28);
  assert.equal(result.transport.availability_layer_queried, false);
  assert.equal(result.transport.preliminary_or_pending_substituted, false);
  assert.equal(result.transport.redirect_followed, false);
  assert.equal(result.evidence.status, "observed");
  assert.equal(result.evidence.map_status, "effective");
  assert.equal(result.evidence.map_status_verified, false);
  assert.equal(result.evidence.fetched_at, FETCHED_AT);
  assert.equal(result.evidence.request_url, request.url);
  assert.equal(result.evidence.flood.features[0]?.fld_zone_raw, "X");
  assert.equal(
    result.evidence.flood.features[0]?.zone_subtype_raw,
    "AREA OF MINIMAL FLOOD HAZARD",
  );
  assert.equal(result.evidence.flood.features[0]?.no_flood_risk, false);
  assert.equal(result.evidence.flood.area_percent, null);
  assert.equal(result.evidence.flood.parcel_floodplain_label, null);
  assert.equal(result.evidence.geometry.covers_whole_parcel, false);
  assert.equal(result.evidence.commercial_scope_verified, false);
  assert.equal(result.evidence.caller_asserts_commercial_scope, true);
  assert.equal(result.evidence.parcel_identity_verified, false);
  assert.equal(result.evidence.source_authenticity_verified, false);
  assert.equal(result.evidence.comparability.flood_risk_probability, null);

  seen.length = 0;
  await fetchFemaEffectiveNfhlPoint(pointQuery({ inputSrid: 4326 }), deps);
  const second = seen[0];
  assert.ok(second);
  assert.equal(new URL(second.url).searchParams.get("inSR"), "4326");
});

test("a caller-supplied URL is ignored", async () => {
  let requested = "";
  const deps: FemaFetchDeps = {
    now: () => FETCHED_AT,
    fetch: (url) => {
      requested = url;
      return Promise.resolve(jsonResponse(featureBody(["AE"])));
    },
  };
  await fetchFemaEffectiveNfhlPoint(
    {
      ...pointQuery(),
      url: "https://evil.example/arcgis/rest/services/public/NFHL/MapServer/28/query",
    } as FemaPointQuery,
    deps,
  );
  assert.equal(new URL(requested).origin, FEMA_EFFECTIVE_ORIGIN);
  assert.equal(requested.includes("evil.example"), false);
});

test("bad CRS or geometry does not fetch and does not swap coordinates", async () => {
  const secret = "owner@example.com";
  const cases: Partial<FemaPointQuery>[] = [
    { x: Number.NaN },
    { x: secret as unknown as number },
    { x: 181 },
    { y: 91 },
    { x: 29.76, y: -95.37 },
    { inputSrid: 3857 },
    { inputSrid: 102100 },
    { inputSrid: "4269" as unknown as number },
    { inputSrid: "EPSG:4269" as unknown as number },
    { pointRole: undefined },
    { pointRole: "parcel" as unknown as FemaPointQuery["pointRole"] },
  ];
  for (const overrides of cases) {
    let calls = 0;
    const result = await fetchFemaEffectiveNfhlPoint(pointQuery(overrides), {
      now: () => FETCHED_AT,
      fetch: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(featureBody(["X"])));
      },
    });
    assert.equal(calls, 0, JSON.stringify(overrides));
    assert.equal(result.transport.attempts, 0);
    assert.equal(result.transport.failure, "invalid_input");
    assert.equal(result.evidence.status, "invalid");
    assert.equal(result.evidence.unknown_reason, "invalid_input");
    assert.equal(result.evidence.body_used, false);
    assert.equal(result.evidence.flood.features.length, 0);
    assert.equal(result.evidence.flood.assumed_zone, null);
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes(secret), false);
    assert.equal(encoded.includes("29.76,-95.37"), false);
  }
  const swapped = await fetchFemaEffectiveNfhlPoint(
    pointQuery({ x: 29.76, y: -95.37 }),
    {
      now: () => FETCHED_AT,
      fetch: () => Promise.resolve(jsonResponse(featureBody(["X"]))),
    },
  );
  assert.equal(swapped.evidence.geometry.x, null);
  assert.equal(swapped.evidence.geometry.y, null);
  assert.equal(
    swapped.evidence.details.includes("coordinate_not_swapped"),
    true,
  );
  assert.equal(JSON.stringify(swapped).includes("-95.37"), false);
});

test("a byte cap and an oversized content-length are truncated, not a flood result", async () => {
  const oversized = new Uint8Array(FEMA_POINT_BYTE_CAP + 1);
  oversized.set(new TextEncoder().encode(`{"ZONE_SUBTY":"${PLANTED}"}`));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oversized);
      controller.close();
    },
  });
  const streamed = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(new Response(stream, { status: 200 })),
  });
  assert.equal(streamed.transport.failure, "truncated");
  assert.equal(streamed.transport.attempts, 1);
  assert.equal(streamed.evidence.unknown_reason, "truncated");
  assert.equal(
    streamed.evidence.unknown_reasons.includes("no_feature_unknown"),
    false,
  );
  assert.equal(streamed.evidence.flood.features.length, 0);
  assert.equal(streamed.evidence.flood.determination_allowed, false);
  assert.equal(streamed.evidence.flood.assumed_zone, null);
  assert.equal(JSON.stringify(streamed).includes(PLANTED), false);

  const declared = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(featureBody(["X"], { ZONE_SUBTY: PLANTED }), 200, {
          "content-length": String(FEMA_POINT_BYTE_CAP + 1),
        }),
      ),
  });
  assert.equal(declared.transport.failure, "truncated");
  assert.equal(declared.evidence.unknown_reason, "truncated");
  assert.equal(declared.evidence.flood.features.length, 0);
  assert.equal(JSON.stringify(declared).includes(PLANTED), false);
  assert.equal(JSON.stringify(declared).includes("AREA OF MINIMAL"), false);
});

test("more features than the record cap are not a clean determination", async () => {
  const zones = ["AE", "X", "VE", "A", "AH", "AO"];
  assert.ok(zones.length > FEMA_POINT_RECORD_CAP);
  const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(featureBody(zones))),
  });
  assert.equal(result.transport.failure, "none");
  assert.equal(result.evidence.unknown_reason, "truncated");
  assert.equal(
    result.evidence.unknown_reasons.includes("no_feature_unknown"),
    false,
  );
  assert.equal(result.evidence.flood.determination_allowed, false);
  assert.equal(
    result.evidence.completeness.result_record_cap,
    FEMA_POINT_RECORD_CAP,
  );
  assert.equal(result.evidence.flood.area_percent, null);
});

test("timeout and network failure do not retry or infer a zone", async () => {
  let calls = 0;
  let fire: (() => void) | undefined;
  const pending = fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    setTimeout: (fn, ms) => {
      assert.equal(ms, FEMA_POINT_TIMEOUT_MS);
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
  assert.ok(fire);
  fire();
  const timedOut = await pending;
  assert.equal(calls, 1);
  assert.equal(timedOut.transport.retries, 0);
  assert.equal(timedOut.transport.failure, "timeout");
  assert.equal(timedOut.evidence.unknown_reason, "timeout");
  assert.deepEqual(timedOut.evidence.unknown_reasons, ["timeout"]);
  assert.equal(timedOut.evidence.flood.features.length, 0);
  assert.equal(timedOut.evidence.flood.assumed_zone, null);

  const network = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.reject(new Error("socket closed")),
  });
  assert.equal(network.transport.failure, "network");
  assert.equal(network.transport.attempts, 1);
  assert.equal(network.evidence.unknown_reason, "timeout");
  assert.equal(network.evidence.flood.features.length, 0);
});

test("caller cancel does not become a flood result", async () => {
  let calls = 0;
  const already = AbortSignal.abort();
  const pre = await fetchFemaEffectiveNfhlPoint(
    pointQuery({ signal: already }),
    {
      now: () => FETCHED_AT,
      fetch: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(featureBody(["X"])));
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(pre.transport.failure, "caller_cancel");
  assert.equal(pre.evidence.unknown_reason, "timeout");
  assert.equal(pre.evidence.flood.features.length, 0);
  assert.equal(pre.evidence.flood.assumed_zone, null);

  const controller = new AbortController();
  let sawAbort = false;
  const inflight = fetchFemaEffectiveNfhlPoint(
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
  assert.equal(cancelled.evidence.flood.features.length, 0);
  assert.equal(cancelled.evidence.flood.assumed_sfha, null);
});

test("HTTP errors, ArcGIS errors, 429, and 403 are single attempts and not zone X", async () => {
  for (const status of [400, 403, 429, 500]) {
    let calls = 0;
    const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
      now: () => FETCHED_AT,
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          jsonResponse(
            JSON.stringify({
              features: [
                {
                  attributes: {
                    FLD_ZONE: "X",
                    ZONE_SUBTY: PLANTED,
                    SFHA_TF: "F",
                  },
                },
              ],
            }),
            status,
          ),
        );
      },
    });
    assert.equal(calls, 1, String(status));
    assert.equal(result.transport.retries, 0);
    assert.equal(result.transport.failure, "http");
    assert.equal(result.evidence.unknown_reason, "provider_error");
    assert.equal(result.evidence.http_status, status);
    assert.equal(result.evidence.flood.features.length, 0);
    assert.equal(result.evidence.flood.assumed_zone, null);
    assert.equal(result.evidence.flood.assumed_sfha, null);
    assert.equal(JSON.stringify(result).includes(PLANTED), false);
  }

  const arcgis = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(
          JSON.stringify({
            error: { code: 400, message: "Failed to execute query." },
            features: [
              {
                attributes: {
                  FLD_ZONE: "X",
                  ZONE_SUBTY: PLANTED,
                  SFHA_TF: "F",
                },
              },
            ],
          }),
        ),
      ),
  });
  assert.equal(arcgis.transport.failure, "none");
  assert.equal(arcgis.evidence.unknown_reason, "provider_error");
  assert.equal(arcgis.evidence.details.includes("arcgis_error"), true);
  assert.equal(arcgis.evidence.flood.features.length, 0);
  assert.equal(JSON.stringify(arcgis).includes(PLANTED), false);
});

test("a no-hit on the effective service stays unknown", async () => {
  const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(featureBody([]))),
  });
  assert.equal(result.evidence.map_status, "effective");
  assert.equal(result.evidence.status, "unknown");
  assert.equal(result.evidence.unknown_reason, "no_feature_unknown");
  assert.equal(result.evidence.flood.features.length, 0);
  assert.equal(result.evidence.flood.assumed_zone, null);
  assert.equal(result.evidence.flood.assumed_sfha, null);
  assert.equal(result.evidence.flood.determination_allowed, false);
  assert.equal(result.evidence.geometry.covers_whole_parcel, false);
});

test("multiple intersecting zones stay ambiguous and are not a parcel result", async () => {
  const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse(featureBody(["AE", "X"]))),
  });
  assert.equal(result.transport.failure, "none");
  assert.equal(result.evidence.status, "ambiguous");
  assert.equal(result.evidence.unknown_reason, "boundary_multiple");
  assert.deepEqual(
    result.evidence.flood.features.map((feature) => feature.fld_zone_raw),
    ["AE", "X"],
  );
  assert.equal(result.evidence.flood.single_zone_determination, false);
  assert.equal(result.evidence.flood.area_percent, null);
  assert.equal(result.evidence.flood.parcel_floodplain_label, null);
  assert.equal(result.evidence.geometry.covers_whole_parcel, false);
  for (const feature of result.evidence.flood.features) {
    assert.equal(feature.no_flood_risk, false);
  }
});

test("exceededTransferLimit is not a complete negative", async () => {
  const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () =>
      Promise.resolve(
        jsonResponse(featureBody(["X"], { exceededTransferLimit: true })),
      ),
  });
  assert.equal(result.evidence.unknown_reason, "truncated");
  assert.equal(
    result.evidence.unknown_reasons.includes("no_feature_unknown"),
    false,
  );
  assert.equal(result.evidence.completeness.exceeded_transfer_limit, true);
  assert.equal(result.evidence.flood.determination_allowed, false);
  assert.equal(result.evidence.completeness.complete, false);
  assert.equal(result.evidence.flood.assumed_zone, null);
});

test("redirects are not followed, including a cross-origin Location", async () => {
  const cases = [
    "https://evil.example/arcgis/rest/services/public/NFHL/MapServer/28/query",
    "https://hazards.fema.gov/arcgis/rest/services/PrelimPending/Prelim_NFHL/MapServer/28/query",
    "https://user:secret@hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
  ];
  for (const location of cases) {
    const urls: string[] = [];
    const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
      now: () => FETCHED_AT,
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve(
          new Response(featureBody(["X"]), {
            status: 302,
            headers: { location },
          }),
        );
      },
    });
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0] ?? "").origin, FEMA_EFFECTIVE_ORIGIN);
    assert.equal(result.transport.attempts, 1);
    assert.equal(result.transport.retries, 0);
    assert.equal(result.transport.redirect_followed, false);
    assert.equal(result.transport.failure, "redirect");
    assert.equal(result.transport.cross_origin_redirect_blocked, true);
    assert.equal(result.evidence.unknown_reason, "provider_error");
    assert.equal(result.evidence.flood.features.length, 0);
    assert.equal(JSON.stringify(result).includes("evil.example"), false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(JSON.stringify(result).includes("Prelim"), false);
  }
});

test("malformed JSON is not an empty-feature negative", async () => {
  const result = await fetchFemaEffectiveNfhlPoint(pointQuery(), {
    now: () => FETCHED_AT,
    fetch: () => Promise.resolve(jsonResponse("{not-json")),
  });
  assert.equal(result.transport.failure, "none");
  assert.equal(result.evidence.unknown_reason, "malformed_response");
  assert.equal(result.evidence.details.includes("body_not_json"), true);
  assert.equal(
    result.evidence.unknown_reasons.includes("no_feature_unknown"),
    false,
  );
  assert.equal(result.evidence.flood.features.length, 0);
  assert.equal(result.evidence.flood.assumed_zone, null);
});
