/**
 * Hosted-only account surfaces: two MCP tools the router adds to `tools/list` when a FactLot key
 * is present (they are not in the open-source catalog and do not exist on a self-hosted server),
 * the REST twin `GET /v1/account/usage`, the region a registry call is about, and the hosted
 * coverage summary the account page shows.
 */
import { accountSummary } from "./billing.ts";
import { meterSubject, type KeyRecord } from "./keys.ts";
import { PLANS } from "./plans.ts";
import type { Env, Fetcher, UsageSummary } from "./types.ts";

export const ACCOUNT_TOOL_NAMES = new Set(["account_status", "account_usage"]);

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** MCP tool definitions, listed only for a caller with a FactLot key. */
export const ACCOUNT_TOOLS = [
  {
    name: "account_status",
    title: "FactLot account status",
    description:
      "Hosted FactLot account tool (only on api.factlot.com with an API key; not a CRE tool). Returns the plan of the key this connection uses: status, price, requests a minute, registry lookups used this month with the limit and reset time, renewal date, the subscription's keys (created, last used) and any billing hold. Free: never counts as a lookup.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { title: "FactLot account status", ...READ_ONLY },
  },
  {
    name: "account_usage",
    title: "FactLot account usage",
    description:
      "Hosted FactLot account tool (only on api.factlot.com with an API key; not a CRE tool). Returns charged registry lookups per UTC day for the last `days` days (default 30, at most 90), totals by tool and by region prefix (us-24 is Maryland by state FIPS, us-11 DC; searches are 'search'), and this month's quota. Free: never counts as a lookup.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          default: 30,
          description: "How many UTC days back, today included.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "FactLot account usage", ...READ_ONLY },
  },
];

const SEARCH_TOOLS = new Set([
  "registry_search_address",
  "registry_search_entities",
]);

/**
 * The region prefix a registry call is about: `us-24` from a parcel or building URN or a
 * state_fips argument, `us-md` from an entity URN, `search` for searches, `other` otherwise.
 */
export function regionOf(tool: string, args: unknown): string {
  if (SEARCH_TOOLS.has(tool)) return "search";
  if (typeof args !== "object" || args === null) return "other";
  const a = args as Record<string, unknown>;
  for (const k of ["urn", "entity_urn"]) {
    const v = a[k];
    if (typeof v !== "string") continue;
    const m = /^fl:[a-z]+:(us-[0-9]{2}|us-[a-z]{2})/i.exec(v.trim());
    if (m) return m[1]!.toLowerCase();
  }
  if (typeof a.state_fips === "string" && /^[0-9]{2}$/.test(a.state_fips))
    return `us-${a.state_fips}`;
  return "other";
}

/** /v1/account/usage and account_usage: daily usage plus this month's quota. */
export async function accountUsage(
  env: Env,
  hash: string,
  record: KeyRecord,
  days = 30,
): Promise<
  UsageSummary & { month: { used: number; limit: number; resets_at: string } }
> {
  const subject = meterSubject(record, hash);
  const plan = PLANS[record.plan];
  const [usage, q] = await Promise.all([
    env.METER.usage(subject, days),
    env.METER.quota(subject, "month", plan.registryLookupsPerMonth),
  ]);
  return {
    ...usage,
    month: { used: q.used, limit: q.limit, resets_at: q.resets_at },
  };
}

/** The answer to one account tool call (a JSON-RPC message). */
export async function answerAccountCall(
  env: Env,
  hash: string,
  record: KeyRecord,
  message: {
    id: string | number;
    params?: { name?: unknown; arguments?: unknown };
  },
): Promise<unknown> {
  const name = message.params?.name;
  const args = (message.params?.arguments ?? {}) as { days?: unknown };
  let data: unknown;
  if (name === "account_status") data = await accountSummary(env, hash, record);
  else {
    const days =
      typeof args.days === "number" && Number.isInteger(args.days)
        ? Math.min(90, Math.max(1, args.days))
        : 30;
    data = await accountUsage(env, hash, record, days);
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    },
  };
}

export interface HostedRegion {
  state: string;
  counties: number;
  parcels: number;
  /** Latest source date among the state's counties (YYYY-MM-DD). */
  as_of: string;
}

let coverageCache: { at: number; regions: HostedRegion[] } | undefined;

/**
 * The hosted registry's coverage by state, from registry_coverage on the inner handler (cached
 * ten minutes per isolate). Empty when the registry does not answer.
 */
export async function hostedRegions(
  api: Fetcher,
  apiBase: string,
  now: number,
): Promise<HostedRegion[]> {
  if (coverageCache && now - coverageCache.at < 10 * 60_000)
    return coverageCache.regions;
  try {
    const res = await api.fetch(
      new Request(`${apiBase}/v1/registry/coverage`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      counties?: {
        state?: unknown;
        parcels?: unknown;
        sources?: { as_of?: unknown }[];
      }[];
    };
    const byState = new Map<string, HostedRegion>();
    for (const c of body.counties ?? []) {
      const state = typeof c.state === "string" ? c.state : "?";
      const r = byState.get(state) ?? {
        state,
        counties: 0,
        parcels: 0,
        as_of: "",
      };
      r.counties++;
      r.parcels += typeof c.parcels === "number" ? c.parcels : 0;
      for (const s of c.sources ?? [])
        if (typeof s.as_of === "string" && s.as_of > r.as_of)
          r.as_of = s.as_of.slice(0, 10);
      byState.set(state, r);
    }
    const regions = [...byState.values()].sort((a, b) =>
      a.state.localeCompare(b.state),
    );
    coverageCache = { at: now, regions };
    return regions;
  } catch {
    return [];
  }
}

/** Tests: forget the cached coverage. */
export function resetCoverageCache(): void {
  coverageCache = undefined;
}
