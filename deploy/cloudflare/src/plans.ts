/**
 * Hosted plans. The calculators, IDs, document and rules tools are free on the hosted API (rate
 * limited per address) and open source to run locally. Registry lookups are metered: a daily
 * allowance per address without a key, a monthly allowance per subscription with one. Caps are
 * hard: nothing is billed beyond the monthly price.
 */
export type PlanId = "pro" | "team";
export type Tier = "anonymous" | PlanId;

export interface Plan {
  id: PlanId;
  name: string;
  /** USD cents per month. */
  monthlyCents: number;
  /** Stripe price lookup key; the worker finds or creates the price under this key. */
  lookupKey: string;
  /** Per key. */
  requestsPerMinute: number;
  /** Registry lookups per calendar month (UTC), shared by every key of the subscription. */
  registryLookupsPerMonth: number;
  /** Live API keys one subscription may hold at once. */
  maxKeys: number;
  summary: string;
}

export const ANONYMOUS_REQUESTS_PER_MINUTE = 60;
/** Registry lookups per UTC day for one client address (IPv6: per /64) without a key. */
export const ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY = 25;
export const PRICING_URL = "https://factlot.com/#pricing";

export const PLANS: Record<PlanId, Plan> = {
  pro: {
    id: "pro",
    name: "FactLot Pro",
    monthlyCents: 4900,
    lookupKey: "factlot_pro_monthly_v1",
    requestsPerMinute: 600,
    registryLookupsPerMonth: 5_000,
    maxKeys: 1,
    summary:
      "1 API key, 600 requests a minute, 5,000 registry lookups a month, email support.",
  },
  team: {
    id: "team",
    name: "FactLot Team",
    monthlyCents: 59900,
    lookupKey: "factlot_team_monthly_v1",
    requestsPerMinute: 3000,
    registryLookupsPerMonth: 100_000,
    maxKeys: 5,
    summary:
      "Up to 5 API keys, 3,000 requests a minute, 100,000 registry lookups a month, priority support, and a vote on which regions open next.",
  },
};

/** Registry tools that are not metered: the discovery call every agent makes first. */
export const UNMETERED_REGISTRY_TOOLS = new Set(["registry_coverage"]);

/** Whether a call of the tool `name` counts as one registry lookup (`known`: the catalog's names). */
export function isMeteredRegistryTool(
  name: unknown,
  known?: ReadonlySet<string>,
): boolean {
  return (
    typeof name === "string" &&
    name.startsWith("registry_") &&
    !UNMETERED_REGISTRY_TOOLS.has(name) &&
    (known === undefined || known.has(name))
  );
}

/** How registry lookups are counted, one sentence each (in /v1/plans). */
export const QUOTA_RULES = {
  counted:
    "A lookup is one answered call to a registry_* tool: a record, a resolved ID, owners, or a search that ran inside loaded coverage (even with no results). Free: registry_coverage, input errors, misses outside loaded coverage (county, state, entity registry or ID system not loaded) and calls the registry could not answer.",
  free: `Without a key, ${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY} lookups a day per IP address (stored only as a hash; IPv6 per /64), counted per UTC day and reset at 00:00 UTC.`,
  paid: "With a key, lookups count per subscription per calendar month (UTC), shared by all of its keys; requests a minute count per key.",
  at_cap:
    "At a cap, registry calls answer 429 RegistryQuotaExceeded until the reset, other tools keep working, and nothing extra is billed.",
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "pro" || value === "team";
}

/** The plan a Stripe price lookup key belongs to, if any. */
export function planForLookupKey(lookupKey: unknown): PlanId | undefined {
  return Object.values(PLANS).find((p) => p.lookupKey === lookupKey)?.id;
}

/** "$49 a month" */
export function priceText(plan: Plan): string {
  return `$${(plan.monthlyCents / 100).toLocaleString("en-US")} a month`;
}

/** Public plan list for agents and the site (no Stripe IDs). */
export function publicPlans(checkoutBase: string) {
  return {
    free: {
      price: "$0",
      requests_per_minute: ANONYMOUS_REQUESTS_PER_MINUTE,
      registry_lookups_per_day: ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
      auth: "none",
      note: `Every calculator, ID, fact, rules and document tool at ${ANONYMOUS_REQUESTS_PER_MINUTE} requests a minute per IP address, and ${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY} registry lookups a day per IP address.`,
    },
    ...Object.fromEntries(
      Object.values(PLANS).map((p) => [
        p.id,
        {
          price: `$${p.monthlyCents / 100} per month`,
          requests_per_minute: p.requestsPerMinute,
          registry_lookups_per_month: p.registryLookupsPerMonth,
          keys: p.maxKeys,
          auth: "bearer",
          note: p.summary,
          checkout: `${checkoutBase}/billing/checkout?plan=${p.id}`,
        },
      ]),
    ),
  };
}

// --- Reports ------------------------------------------------------------------------------------

/**
 * Reports (report_create over MCP, POST /v1/reports) per calendar month (UTC): without a key per
 * IP address (a month-salted hash of it), with one per subscription, shared by its keys. Only a
 * report that was built and stored counts; input errors are free.
 */
export const REPORTS_PER_MONTH: Record<Tier, number> = {
  anonymous: 3,
  pro: 50,
  team: 1_000,
};

/** Hours a report's download link works. */
export const REPORT_DOWNLOAD_HOURS = 24;

/** The reports block of /v1/plans. */
export function reportLimits() {
  return {
    per_month: {
      free: REPORTS_PER_MONTH.anonymous,
      pro: REPORTS_PER_MONTH.pro,
      team: REPORTS_PER_MONTH.team,
    },
    counted: `One report is one document built and stored (report_create or POST /v1/reports). Without a key, per IP address (stored only as a hash) per calendar month (UTC); with a key, per subscription per calendar month (UTC). Input errors are free. Download links work for ${REPORT_DOWNLOAD_HOURS} hours.`,
  };
}
