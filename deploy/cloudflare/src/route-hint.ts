/**
 * Near misses of REST paths under /v1/: a path that matches a real route once separators are
 * normalised (`/v1/rules/tx/property-tax-protest-deadline` for
 * `/v1/rules/tx_property_tax_protest_deadline`), or a tool name used as a path
 * (`/v1/report_create`, `/v1/registry_get`). The 404 for such a path names the right one. No
 * fuzzy matching beyond that: a misspelt word is not guessed.
 */
import { tools } from "@factlot/tools";

import { MODEL_PATHS } from "./model-tools.ts";
import { REPORT_TOOL_NAME } from "./reports.ts";

export interface Route {
  method: "GET" | "POST";
  path: string;
}

/**
 * Which hosted routes answer: the same switches /openapi.json uses (reports open, a model
 * configured), so a hint never points to a route that answers ReportsUnavailable or
 * ModelUnavailable.
 */
export interface HintOptions {
  reports: boolean;
  model: boolean;
}

/** The REST routes a person reaches by name: every catalog tool, and the hosted ones. */
const routes = (o: HintOptions): (Route & { name?: string })[] => [
  ...tools.map((t) => ({
    method: "POST" as const,
    path: t.path,
    name: t.name,
  })),
  ...(o.reports
    ? [{ method: "POST" as const, path: "/v1/reports", name: REPORT_TOOL_NAME }]
    : []),
  ...(o.model
    ? [...MODEL_PATHS].map(([path, name]) => ({
        method: "POST" as const,
        path,
        name,
      }))
    : []),
  { method: "GET", path: "/v1/tools" },
  { method: "GET", path: "/v1/plans" },
  { method: "GET", path: "/v1/onboarding" },
  { method: "GET", path: "/v1/account" },
  { method: "GET", path: "/v1/account/usage" },
  { method: "POST", path: "/v1/billing/checkout" },
];

/** A path or tool name with `/v1/`, case and separators (/ - _ .) normalised away. */
export function routeKey(pathOrName: string): string {
  return pathOrName
    .toLowerCase()
    .replace(/^\/?v1(\/|$)/, "")
    .replace(/[/_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Normalised key -> route; a key two different routes share is left out (no guessing). */
function byKey(o: HintOptions): ReadonlyMap<string, Route> {
  const out = new Map<string, Route | null>();
  const add = (key: string, r: Route) => {
    if (!key) return;
    const seen = out.get(key);
    if (seen === undefined) out.set(key, { method: r.method, path: r.path });
    else if (seen !== null && seen.path !== r.path) out.set(key, null);
  };
  for (const r of routes(o)) {
    add(routeKey(r.path), r);
    if (r.name) add(routeKey(r.name), r);
  }
  return new Map([...out].filter((e): e is [string, Route] => e[1] !== null));
}

const MAPS = new Map<string, ReadonlyMap<string, Route>>();

/** The route `path` (an unknown path under /v1/) most likely meant, or undefined. */
export function routeHint(
  path: string,
  o: HintOptions = { reports: true, model: true },
): Route | undefined {
  if (!path.startsWith("/v1/")) return undefined;
  const id = `${o.reports}:${o.model}`;
  if (!MAPS.has(id)) MAPS.set(id, byKey(o));
  const route = MAPS.get(id)!.get(routeKey(path));
  return route && route.path !== path ? route : undefined;
}

/**
 * A 404 for an unknown path under /v1/, with `did_you_mean` (method and path), `next` and the
 * message naming the right route when the path is a near miss. Anything else is returned as is.
 */
export async function withRouteHint(
  res: Response,
  path: string,
  apiBase: string,
  o: HintOptions,
): Promise<Response> {
  const route = res.status === 404 ? routeHint(path, o) : undefined;
  if (!route) return res;
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return res;
  const b = body as Record<string, unknown>;
  const right = `${route.method} ${route.path}`;
  const out = new Response(
    JSON.stringify({
      ...b,
      message: `${typeof b.message === "string" ? `${b.message}. ` : ""}Did you mean ${right}? Every route: ${apiBase}/openapi.json`,
      did_you_mean: right,
      next: `${route.method} ${apiBase}${route.path}`,
    }),
    res,
  );
  out.headers.delete("content-length");
  return out;
}
