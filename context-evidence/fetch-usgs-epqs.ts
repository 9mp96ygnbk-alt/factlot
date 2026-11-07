/**
 * Bounded point client for the USGS Elevation Point Query Service.
 *
 * The only request this module can make is
 * `GET https://epqs.nationalmap.gov/v1/json`. A caller-supplied host, path,
 * credential, or parameter is ignored. Documented wkids are 4326 and 102100.
 * An omitted wkid is sent as the documented default 4326. 4269 is never sent.
 * Units are required from the caller because Feet and Meters change the
 * returned number; Feet means international feet. The capped body is handed
 * to `parseUsgsEpqs` unchanged. This module does not invent an elevation,
 * treat no-data as zero, repair AcquisitionDate, or compute a flood, BFE,
 * insurance, or buildability result. `fetch` is required from the caller so
 * importing this file performs no I/O.
 */
import { assessRequest, USGS_EPQS_DOCS_URL } from "./contracts.ts";
import type { PointRole, RequestedUnit } from "./contracts.ts";
import { parseUsgsEpqs } from "./parse-usgs-epqs.ts";
import type { UsgsEpqsEvidence } from "./parse-usgs-epqs.ts";

export const USGS_EPQS_ORIGIN = "https://epqs.nationalmap.gov";
export const USGS_EPQS_JSON_PATH = "/v1/json";

/** Same one-shot body ceiling as the FEMA point client. Not a raster budget. */
export const USGS_EPQS_BYTE_CAP = 65536;
/** Same one-shot time budget as the FEMA point client. */
export const USGS_EPQS_TIMEOUT_MS = 8000;
/** Documented EPQS default. Sent explicitly when the caller omits wkid. */
export const USGS_EPQS_DEFAULT_WKID = 4326;

/**
 * Same Web Mercator bound `assessRequest` uses. A point outside it is not
 * fetched. This is not a coverage or data-completeness limit.
 */
const MERCATOR_LIMIT = 20037508.342789244;
const MAX_STREAM_READS = 128;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

export type UsgsEpqsPointQuery = {
  x: unknown;
  y: unknown;
  /**
   * 4326 or 102100. Omitted means 4326. Any other value, including 4269,
   * is refused before a request is made.
   */
  wkid?: unknown;
  /** "Meters" or "Feet". Omitted units are not defaulted. */
  units: unknown;
  /** Omitted means false. Non-booleans are not coerced. */
  includeDate?: unknown;
  pointRole: unknown;
  /** Caller assertion only. This client does not verify commercial use. */
  commercialScopeAsserted?: unknown;
  signal?: AbortSignal;
};

export type UsgsEpqsInjectedFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type UsgsEpqsFetchDeps = {
  fetch: UsgsEpqsInjectedFetch;
  now?: () => string;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type UsgsEpqsTransportFailure =
  | "none"
  | "invalid_input"
  | "timeout"
  | "caller_cancel"
  | "network"
  | "http"
  | "truncated"
  | "redirect";

export type UsgsEpqsPointTransport = {
  attempts: number;
  retries: 0;
  byte_cap: typeof USGS_EPQS_BYTE_CAP;
  timeout_ms: typeof USGS_EPQS_TIMEOUT_MS;
  wkid_sent: 4326 | 102100 | null;
  units_sent: RequestedUnit | null;
  include_date_sent: boolean | null;
  wkid_defaulted: boolean;
  units_defaulted: false;
  undocumented_wkid_4269_sent: false;
  redirect_followed: false;
  /** Location was missing, malformed, or outside the json-endpoint allowlist. */
  cross_origin_redirect_blocked: boolean;
  failure: UsgsEpqsTransportFailure;
};

export type UsgsEpqsPointFetchResult = {
  evidence: UsgsEpqsEvidence;
  transport: UsgsEpqsPointTransport;
};

type ValidPoint = {
  x: number;
  y: number;
  xText: string;
  yText: string;
  wkid: 4326 | 102100;
  wkidDefaulted: boolean;
  units: RequestedUnit;
  includeDate: boolean;
  pointRole: PointRole;
};

function defaultNow(): string {
  return new Date().toISOString();
}

function isAllowlisted(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "epqs.nationalmap.gov" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === USGS_EPQS_JSON_PATH
  );
}

function bareEndpoint(): string {
  return `${USGS_EPQS_ORIGIN}${USGS_EPQS_JSON_PATH}`;
}

function formatCoord(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = Object.is(value, -0) ? "0" : String(value);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  return text;
}

function isPointRole(value: unknown): value is PointRole {
  return (
    value === "caller_point" ||
    value === "centroid" ||
    value === "representative_point"
  );
}

function coordinatesInRange(
  x: number,
  y: number,
  wkid: 4326 | 102100,
): boolean {
  if (wkid === 102100) {
    return Math.abs(x) <= MERCATOR_LIMIT && Math.abs(y) <= MERCATOR_LIMIT;
  }
  return x >= -180 && x <= 180 && y >= -90 && y <= 90;
}

function readPoint(query: UsgsEpqsPointQuery): ValidPoint | null {
  if (typeof query.x !== "number" || typeof query.y !== "number") return null;
  const xText = formatCoord(query.x);
  const yText = formatCoord(query.y);
  if (xText === null || yText === null) return null;

  let wkid: 4326 | 102100;
  let wkidDefaulted = false;
  if (query.wkid === undefined) {
    wkid = USGS_EPQS_DEFAULT_WKID;
    wkidDefaulted = true;
  } else if (query.wkid === 4326 || query.wkid === 102100) {
    wkid = query.wkid;
  } else {
    return null;
  }
  if (!coordinatesInRange(query.x, query.y, wkid)) return null;
  if (query.units !== "Meters" && query.units !== "Feet") return null;

  let includeDate: boolean;
  if (query.includeDate === undefined) includeDate = false;
  else if (typeof query.includeDate === "boolean")
    includeDate = query.includeDate;
  else return null;
  if (!isPointRole(query.pointRole)) return null;

  return {
    x: query.x,
    y: query.y,
    xText,
    yText,
    wkid,
    wkidDefaulted,
    units: query.units,
    includeDate,
    pointRole: query.pointRole,
  };
}

function buildQueryUrl(point: ValidPoint): string | null {
  const url = new URL(bareEndpoint());
  url.searchParams.set("x", point.xText);
  url.searchParams.set("y", point.yText);
  url.searchParams.set("wkid", String(point.wkid));
  url.searchParams.set("units", point.units);
  url.searchParams.set("includeDate", point.includeDate ? "true" : "false");
  if (!isAllowlisted(url)) return null;
  if (url.username !== "" || url.password !== "" || url.port !== "")
    return null;
  return url.toString();
}

function transport(
  failure: UsgsEpqsTransportFailure,
  attempts: number,
  sent?: {
    wkid: 4326 | 102100;
    units: RequestedUnit;
    includeDate: boolean;
    wkidDefaulted: boolean;
  },
  crossOriginRedirectBlocked = false,
): UsgsEpqsPointTransport {
  return {
    attempts,
    retries: 0,
    byte_cap: USGS_EPQS_BYTE_CAP,
    timeout_ms: USGS_EPQS_TIMEOUT_MS,
    wkid_sent: sent?.wkid ?? null,
    units_sent: sent?.units ?? null,
    include_date_sent: sent?.includeDate ?? null,
    wkid_defaulted: sent?.wkidDefaulted === true,
    units_defaulted: false,
    undocumented_wkid_4269_sent: false,
    redirect_followed: false,
    cross_origin_redirect_blocked: crossOriginRedirectBlocked,
    failure,
  };
}

function evidenceFrom(
  query: UsgsEpqsPointQuery,
  fetchedAt: string,
  requestUrl: string,
  extra: {
    httpStatus?: number | null;
    timeout?: boolean;
    transportTruncated?: boolean;
    responseText?: string | null;
  },
  sent: ValidPoint | null = null,
): UsgsEpqsEvidence {
  const request: Record<string, unknown> = {
    source_url: USGS_EPQS_DOCS_URL,
    request_url: requestUrl,
    fetched_at: fetchedAt,
    timeout: extra.timeout === true,
    transport_truncated: extra.transportTruncated === true,
    input_srid: sent
      ? sent.wkid
      : query.wkid === undefined
        ? USGS_EPQS_DEFAULT_WKID
        : query.wkid,
    x: sent ? sent.x : query.x,
    y: sent ? sent.y : query.y,
    units: sent ? sent.units : query.units,
    semantics: "point",
    point_role: sent ? sent.pointRole : query.pointRole,
    commercial_scope_validated: query.commercialScopeAsserted === true,
  };
  if (typeof extra.httpStatus === "number") {
    request.http_status = extra.httpStatus;
  }
  if (typeof extra.responseText === "string") {
    request.response_text = extra.responseText;
  }
  return parseUsgsEpqs({ request });
}

function contentLengthOverCap(headers: Headers): boolean {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return false;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length > USGS_EPQS_BYTE_CAP;
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
    if (text.length > USGS_EPQS_BYTE_CAP)
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
      if (total > USGS_EPQS_BYTE_CAP) {
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

export async function fetchUsgsEpqsPoint(
  query: UsgsEpqsPointQuery,
  deps: UsgsEpqsFetchDeps,
): Promise<UsgsEpqsPointFetchResult> {
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
      source_url: USGS_EPQS_DOCS_URL,
      request_url: requestUrl,
      fetched_at: fetchedAt,
      http_status: 200,
      timeout: false,
      transport_truncated: false,
      input_srid: point.wkid,
      x: point.x,
      y: point.y,
      units: point.units,
      semantics: "point",
      point_role: point.pointRole,
      commercial_scope_validated: query.commercialScopeAsserted === true,
    },
    "usgs-epqs",
  );
  if (
    !draft.ok ||
    draft.units !== point.units ||
    draft.geometry.input_srid !== point.wkid ||
    draft.geometry.point_role !== point.pointRole ||
    !draft.geometry.request_coordinates_validated
  ) {
    return {
      evidence: evidenceFrom(query, fetchedAt, requestUrl, {}, point),
      transport: transport("invalid_input", 0),
    };
  }

  if (query.signal?.aborted) {
    return {
      evidence: evidenceFrom(
        query,
        fetchedAt,
        requestUrl,
        { timeout: true },
        point,
      ),
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
  }, USGS_EPQS_TIMEOUT_MS);

  const sent = {
    wkid: point.wkid,
    units: point.units,
    includeDate: point.includeDate,
    wkidDefaulted: point.wkidDefaulted,
  };
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
          evidence: evidenceFrom(
            query,
            fetchedAt,
            requestUrl,
            {
              httpStatus: REDIRECT_STATUSES.has(response.status)
                ? response.status
                : 302,
            },
            point,
          ),
          transport: transport("redirect", attempts, sent, true),
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
        evidence: evidenceFrom(
          query,
          fetchedAt,
          requestUrl,
          {
            httpStatus: REDIRECT_STATUSES.has(response.status)
              ? response.status
              : 302,
          },
          point,
        ),
        transport: transport("redirect", attempts, sent, crossOrigin),
      };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return {
        evidence: evidenceFrom(
          query,
          fetchedAt,
          requestUrl,
          { httpStatus: response.status },
          point,
        ),
        transport: transport("http", attempts, sent),
      };
    }
    const read = await readCapped(response);
    if (read.truncated || read.text === null) {
      return {
        evidence: evidenceFrom(
          query,
          fetchedAt,
          requestUrl,
          { httpStatus: 200, transportTruncated: true },
          point,
        ),
        transport: transport("truncated", attempts, sent),
      };
    }
    return {
      evidence: evidenceFrom(
        query,
        fetchedAt,
        requestUrl,
        { httpStatus: 200, responseText: read.text },
        point,
      ),
      transport: transport("none", attempts, sent),
    };
  } catch (error) {
    const failure: UsgsEpqsTransportFailure = isAbortError(error)
      ? abortKind === "caller"
        ? "caller_cancel"
        : "timeout"
      : "network";
    return {
      evidence: evidenceFrom(
        query,
        fetchedAt,
        requestUrl,
        { timeout: true },
        point,
      ),
      transport: transport(failure, attempts, sent),
    };
  } finally {
    clearTimer(timer);
    query.signal?.removeEventListener("abort", onCallerAbort);
  }
}
