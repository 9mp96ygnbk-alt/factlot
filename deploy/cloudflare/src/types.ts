/**
 * The small slices of the Cloudflare Workers runtime this deployment uses, typed locally so the
 * modules stay testable under plain Node (`node --test`) without the workers type package.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AnalyticsDataset {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: string[];
    doubles?: number[];
  }): void;
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  /** API-key records, Stripe checkout sessions already redeemed, cached price IDs. */
  KEYS: KV;
  RL_ANON: RateLimit;
  RL_PRO: RateLimit;
  RL_TEAM: RateLimit;
  /** Optional usage metering (Workers Analytics Engine). */
  USAGE?: AnalyticsDataset;
  /**
   * Optional: the registry service (Worker factlot-registry, bound by service binding). When set,
   * the registry tools answer from it; without it they report that no registry is loaded.
   */
  REGISTRY?: Fetcher;
  /** Static landing page (Workers static assets). */
  ASSETS?: Fetcher;
  /** Secret. Billing answers 503 "not open yet" until it is set. */
  STRIPE_SECRET_KEY?: string;
  /** Secret, optional: verifies Stripe webhooks at /v1/billing/webhook. */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Public site origin used in checkout return URLs (default https://factlot.com). */
  SITE_URL?: string;
  /** Public API origin advertised to agents (default https://api.factlot.com). */
  API_URL?: string;
}
