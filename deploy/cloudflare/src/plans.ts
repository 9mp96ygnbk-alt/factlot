/**
 * Hosted plans. Prices: Pro $49 base, Team $599 base; the
 * calculators, IDs and fact tools stay free and open source to run locally.
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
  requestsPerMinute: number;
  summary: string;
}

export const ANONYMOUS_REQUESTS_PER_MINUTE = 60;

export const PLANS: Record<PlanId, Plan> = {
  pro: {
    id: "pro",
    name: "FactLot Pro",
    monthlyCents: 4900,
    lookupKey: "factlot_pro_monthly_v1",
    requestsPerMinute: 600,
    summary:
      "Hosted FactLot API key: 600 requests per minute, hosted registry lookups, email support.",
  },
  team: {
    id: "team",
    name: "FactLot Team",
    monthlyCents: 59900,
    lookupKey: "factlot_team_monthly_v1",
    requestsPerMinute: 3000,
    summary:
      "Hosted FactLot API key for a team: 3,000 requests per minute, hosted registry lookups, priority support and input on which regions open next.",
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "pro" || value === "team";
}

/** Public plan list for agents and the site (no Stripe IDs). */
export function publicPlans(checkoutBase: string) {
  return {
    free: {
      price: "$0",
      requests_per_minute: ANONYMOUS_REQUESTS_PER_MINUTE,
      auth: "none",
      note: "Every calculator, ID and fact tool. Or run it locally with no limit: it is open source.",
    },
    ...Object.fromEntries(
      Object.values(PLANS).map((p) => [
        p.id,
        {
          price: `$${p.monthlyCents / 100} per month`,
          requests_per_minute: p.requestsPerMinute,
          auth: "bearer",
          note: p.summary,
          checkout: `${checkoutBase}/billing/checkout?plan=${p.id}`,
        },
      ]),
    ),
  };
}
