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
  batch:
    "registry_tx_equity_candidates_batch counts one lookup per answered subject: it needs one free lookup per subject to run (a batch larger than what remains is refused whole), and subjects with an error are given back.",
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

// --- Model-backed tools ---------------------------------------------------------------------------

/**
 * Monthly allowances of the two hosted tools that call a model (doc_extract_lease,
 * report_narrative). Counted per subscription per calendar month (UTC), like registry lookups,
 * in their own counters. The free tier has none: these tools spend model tokens.
 */
export interface ModelAllowance {
  /** Pages with text read by doc_extract_lease. */
  ingest_pages_per_month: number;
  /** report_narrative calls. */
  narratives_per_month: number;
}

export const MODEL_ALLOWANCES: Record<Tier, ModelAllowance> = {
  anonymous: { ingest_pages_per_month: 0, narratives_per_month: 0 },
  pro: { ingest_pages_per_month: 100, narratives_per_month: 50 },
  team: { ingest_pages_per_month: 2_000, narratives_per_month: 1_000 },
};

/** How the model-backed tools are counted, one sentence each (in /v1/plans). */
export const MODEL_QUOTA_RULES = {
  tools:
    "doc_extract_lease (a model reads a lease, FactLot verifies every value against the page text) and report_narrative (a model drafts prose from a result, FactLot verifies every figure) are hosted only, for Pro and Team keys.",
  ingest_pages:
    "Each page with text that doc_extract_lease reads counts once, charged when the model is called; scanned pages, input errors and calls the model could not answer are not counted.",
  narratives:
    "Each report_narrative call that returns a narrative counts once; input errors and calls the model could not answer are not counted.",
  at_cap:
    "At a cap these tools answer 429 until the month resets at 00:00 UTC on the 1st; every other tool keeps working and nothing extra is billed.",
};

/** The model-backed tools' allowances by plan, for /v1/plans (`available`: the server has a model). */
export function modelPlansInfo(available: boolean) {
  return {
    available,
    tools: ["doc_extract_lease", "report_narrative"],
    free: MODEL_ALLOWANCES.anonymous,
    pro: MODEL_ALLOWANCES.pro,
    team: MODEL_ALLOWANCES.team,
    rules: MODEL_QUOTA_RULES,
  };
}
