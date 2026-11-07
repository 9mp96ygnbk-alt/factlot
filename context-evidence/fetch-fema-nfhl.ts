/**
 * Bounded point client for the official effective FEMA NFHL flood-hazard layer.
 *
 * The URL is fixed. Callers cannot supply a host, a path, or a credential.
 * Responses are handed to `parseFemaNfhl` unchanged. This module does not
 * query preliminary or pending services, the availability layer, or a parcel.
 * `fetch` is required from the caller so importing this file performs no I/O.
 */
import { assessRequest } from "./contracts.ts";
import { parseFemaNfhl } from "./parse-fema-nfhl.ts";
import type { FemaNfhlEvidence } from "./parse-fema-nfhl.ts";
import type { PointRole } from "./contracts.ts";

export const FEMA_EFFECTIVE_ORIGIN = "https://hazards.fema.gov";
export const FEMA_EFFECTIVE_LAYER28_PATH =
  "/arcgis/rest/services/public/NFHL/MapServer/28/query";
export const FEMA_EFFECTIVE_SOURCE =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";

/** Client safety cap for one point intersection. Not a publisher quota. */
export const FEMA_POINT_RECORD_CAP = 5;
/** Hard ceiling for a point response body, including a streamed read. */
export const FEMA_POINT_BYTE_CAP = 65536;
export const FEMA_POINT_TIMEOUT_MS = 8000;
const MAX_STREAM_READS = 128;

const FLOOD_FIELDS = [
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
] as const;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

export type FemaPointQuery = {
  x: unknown;
  y: unknown;
  inputSrid: unknown;
  pointRole: unknown;
  /** Caller assertion only. This client does not verify commercial use. */
  commercialScopeAsserted?: unknown;
  signal?: AbortSignal;
};

export type InjectedFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type FemaFetchDeps = {
  fetch: InjectedFetch;
  now?: () => string;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type FemaTransportFailure =
  | "none"
  | "invalid_input"
  | "timeout"
  | "caller_cancel"
  | "network"
  | "http"
  | "truncated"
  | "redirect";

export type FemaPointTransport = {
  attempts: number;
  retries: 0;
  record_cap: typeof FEMA_POINT_RECORD_CAP;
  byte_cap: typeof FEMA_POINT_BYTE_CAP;
  timeout_ms: typeof FEMA_POINT_TIMEOUT_MS;
  layer_id: 28;
  availability_layer_queried: false;
  preliminary_or_pending_substituted: false;
  redirect_followed: false;
  cross_origin_redirect_blocked: boolean;
  failure: FemaTransportFailure;
};

export type FemaPointFetchResult = {
  evidence: FemaNfhlEvidence;
  transport: FemaPointTransport;
};

type ValidPoint = {
  x: number;
  y: number;
  inputSrid: 4269 | 4326;
  pointRole: PointRole;
};

function defaultNow(): string {
  return new Date().toISOString();
}

function isAllowlisted(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "hazards.fema.gov" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === FEMA_EFFECTIVE_LAYER28_PATH
  );
}

function bareEndpoint(): string {
  return `${FEMA_EFFECTIVE_ORIGIN}${FEMA_EFFECTIVE_LAYER28_PATH}`;
}

function formatCoord(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = Object.is(value, -0) ? "0" : String(value);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  return text;
}

function readPoint(query: FemaPointQuery): ValidPoint | null {
  if (typeof query.x !== "number" || typeof query.y !== "number") return null;
  const xText = formatCoord(query.x);
  const yText = formatCoord(query.y);
  if (xText === null || yText === null) return null;
  if (query.x < -180 || query.x > 180 || query.y < -90 || query.y > 90) {
    return null;
  }
  if (query.inputSrid !== 4269 && query.inputSrid !== 4326) return null;
  if (
    query.pointRole !== "caller_point" &&
    query.pointRole !== "centroid" &&
    query.pointRole !== "representative_point"
  ) {
    return null;
  }
  return {
    x: query.x,
    y: query.y,
    inputSrid: query.inputSrid,
    pointRole: query.pointRole,
  };
}

function buildQueryUrl(point: ValidPoint): string | null {
  const x = formatCoord(point.x);
  const y = formatCoord(point.y);
  if (x === null || y === null) return null;
  const url = new URL(bareEndpoint());
  url.searchParams.set("f", "json");
  url.searchParams.set("geometry", `${x},${y}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", String(point.inputSrid));
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", FLOOD_FIELDS.join(","));
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", String(FEMA_POINT_RECORD_CAP));
  if (!isAllowlisted(url)) return null;
  if (url.searchParams.has("resultOffset")) return null;
  return url.toString();
}

function transport(
  failure: FemaTransportFailure,
  attempts: number,
  crossOriginRedirectBlocked = false,
): FemaPointTransport {
  return {
    attempts,
    retries: 0,
    record_cap: FEMA_POINT_RECORD_CAP,
    byte_cap: FEMA_POINT_BYTE_CAP,
    timeout_ms: FEMA_POINT_TIMEOUT_MS,
    layer_id: 28,
    availability_layer_queried: false,
    preliminary_or_pending_substituted: false,
    redirect_followed: false,
    cross_origin_redirect_blocked: crossOriginRedirectBlocked,
    failure,
  };
}

function evidenceFrom(
  query: FemaPointQuery,
  fetchedAt: string,
  requestUrl: string,
  extra: {
    httpStatus?: number | null;
    timeout?: boolean;
    transportTruncated?: boolean;
    responseText?: string | null;
  },
): FemaNfhlEvidence {
  const request: Record<string, unknown> = {
    source_url: FEMA_EFFECTIVE_SOURCE,
    request_url: requestUrl,
    fetched_at: fetchedAt,
    timeout: extra.timeout === true,
    transport_truncated: extra.transportTruncated === true,
    layer_id: 28,
    input_srid: query.inputSrid,
    x: query.x,
    y: query.y,
    semantics: "point",
    point_role: query.pointRole,
    commercial_scope_validated: query.commercialScopeAsserted === true,
    result_record_cap: FEMA_POINT_RECORD_CAP,
  };
  if (typeof extra.httpStatus === "number")
    request.http_status = extra.httpStatus;
  if (typeof extra.responseText === "string") {
    request.response_text = extra.responseText;
  }
  return parseFemaNfhl({ request });
}

function contentLengthOverCap(headers: Headers): boolean {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return false;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length > FEMA_POINT_BYTE_CAP;
}

function locationIsCrossOrigin(headers: Headers): boolean {
  const raw = headers.get("location");
  if (
    raw === null ||
    raw.length === 0 ||
    raw.length > 2000 ||
    raw.includes("@")
  ) {
    return true;
  }
  try {
    return !isAllowlisted(new URL(raw, bareEndpoint()));
  } catch {
    return true;
  }
}

async function readCapped(
  response: Response,
): Promise<{ truncated: boolean; text: string | null }> {
  if (contentLengthOverCap(response.headers)) {
    await response.body?.cancel();
    return { truncated: true, text: null };
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > FEMA_POINT_BYTE_CAP)
      return { truncated: true, text: null };
    return { truncated: false, text };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reads = 0;
  let finished = false;
  try {
    while (reads < MAX_STREAM_READS) {
      reads += 1;
      const step = await reader.read();
      if (step.done) {
        finished = true;
        break;
      }
      const value = step.value;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > FEMA_POINT_BYTE_CAP) {
        await reader.cancel();
        return { truncated: true, text: null };
      }
      chunks.push(value.slice());
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { truncated: true, text: null };
  }
  if (!finished) {
    await reader.cancel().catch(() => undefined);
    return { truncated: true, text: null };
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(body);
  return { truncated: false, text };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export async function fetchFemaEffectiveNfhlPoint(
  query: FemaPointQuery,
  deps: FemaFetchDeps,
): Promise<FemaPointFetchResult> {
  const now = deps.now ?? defaultNow;
  const fetchedAt = now();
  const point = readPoint(query);
  const requestUrl = point === null ? bareEndpoint() : buildQueryUrl(point);
  if (
    point === null ||
    requestUrl === null ||
    typeof deps.fetch !== "function"
  ) {
    return {
      evidence: evidenceFrom(
        query,
        fetchedAt,
        requestUrl ?? bareEndpoint(),
        {},
      ),
      transport: transport("invalid_input", 0),
    };
  }
  const draft = assessRequest(
    {
      source_url: FEMA_EFFECTIVE_SOURCE,
      request_url: requestUrl,
      fetched_at: fetchedAt,
      http_status: 200,
      timeout: false,
      layer_id: 28,
      input_srid: point.inputSrid,
      x: point.x,
      y: point.y,
      semantics: "point",
      point_role: point.pointRole,
      result_record_cap: FEMA_POINT_RECORD_CAP,
    },
    "fema-nfhl",
  );
  if (
    !draft.ok ||
    draft.map_status !== "effective" ||
    draft.layer_id !== 28 ||
    !draft.geometry.request_coordinates_validated
  ) {
    return {
      evidence: evidenceFrom(query, fetchedAt, requestUrl, {}),
      transport: transport("invalid_input", 0),
    };
  }

  if (query.signal?.aborted) {
    return {
      evidence: evidenceFrom(query, fetchedAt, requestUrl, {
        timeout: true,
      }),
      transport: transport("caller_cancel", 0),
    };
  }

  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimeout ??
    ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const controller = new AbortController();
  let abortKind: "timeout" | "caller" | null = null;
  const onCallerAbort = () => {
    if (abortKind === null) abortKind = "caller";
    controller.abort();
  };
  if (query.signal) {
    query.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimer(() => {
    if (abortKind === null) abortKind = "timeout";
    controller.abort();
  }, FEMA_POINT_TIMEOUT_MS);

  let attempts = 0;
  try {
    attempts = 1;
    const init: RequestInit & { cache: "no-store" } = {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    };
    const response = await deps.fetch(requestUrl, init);
    if (response.url) {
      let finalUrl: URL | null = null;
      try {
        finalUrl = new URL(response.url);
      } catch {
        finalUrl = null;
      }
      if (finalUrl === null || !isAllowlisted(finalUrl)) {
        await response.body?.cancel();
        return {
          evidence: evidenceFrom(query, fetchedAt, requestUrl, {
            httpStatus: REDIRECT_STATUSES.has(response.status)
              ? response.status
              : 302,
          }),
          transport: transport("redirect", attempts, true),
        };
      }
    }
    if (
      REDIRECT_STATUSES.has(response.status) ||
      response.type === "opaqueredirect"
    ) {
      const crossOrigin = locationIsCrossOrigin(response.headers);
      await response.body?.cancel();
      return {
        evidence: evidenceFrom(query, fetchedAt, requestUrl, {
          httpStatus: REDIRECT_STATUSES.has(response.status)
            ? response.status
            : 302,
        }),
        transport: transport("redirect", attempts, crossOrigin),
      };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return {
        evidence: evidenceFrom(query, fetchedAt, requestUrl, {
          httpStatus: response.status,
        }),
        transport: transport("http", attempts),
      };
    }
    const read = await readCapped(response);
    if (read.truncated || read.text === null) {
      return {
        evidence: evidenceFrom(query, fetchedAt, requestUrl, {
          httpStatus: 200,
          transportTruncated: true,
        }),
        transport: transport("truncated", attempts),
      };
    }
    return {
      evidence: evidenceFrom(query, fetchedAt, requestUrl, {
        httpStatus: 200,
        responseText: read.text,
      }),
      transport: transport("none", attempts),
    };
  } catch (error) {
    const failure: FemaTransportFailure = isAbortError(error)
      ? abortKind === "caller"
        ? "caller_cancel"
        : "timeout"
      : "network";
    return {
      evidence: evidenceFrom(query, fetchedAt, requestUrl, { timeout: true }),
      transport: transport(failure, attempts),
    };
  } finally {
    clearTimer(timer);
    query.signal?.removeEventListener("abort", onCallerAbort);
  }
}
