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
  /** Count one request; success is false once the minute's budget is spent. */
  limit(options: { key: string }): Promise<{ success: boolean }>;
  /** Whether one more request would pass, counting nothing. */
  peek(options: { key: string }): Promise<{ success: boolean }>;
}

export type QuotaKind = "day" | "month";

export interface QuotaSpec {
  kind: QuotaKind;
  limit: number;
  /** Lookups this request wants. */
  n: number;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  /** ISO 8601, UTC: when the window ends and the count restarts. */
  resets_at: string;
}

export interface HitResult {
  /** Within the per-minute limit. */
  ok: boolean;
  /** Registry lookups granted (0 to quota.n). */
  granted: number;
  quota?: QuotaState;
}

/** Per-caller metering (Durable Objects): requests per minute, registry quota, claims. */
export interface MeterService {
  /**
   * One request against `perMinute` for `subject` (`ip:<hash>` or `key:<key id>`), plus up to
   * `quota.n` registry lookups from the same subject's quota when given.
   */
  hit(
    subject: string,
    perMinute: number,
    quota?: QuotaSpec,
  ): Promise<HitResult>;
  /** Registry lookups only (no minute limit), for `sub:<subscription>`. */
  consume(subject: string, quota: QuotaSpec): Promise<HitResult>;
  quota(subject: string, kind: QuotaKind, limit: number): Promise<QuotaState>;
  /** First writer wins, strongly consistent: returns the value stored under `name`. */
  claim(name: string, value: string): Promise<string>;
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
  /** Per-address minute limiter for billing pages and rejected keys (60 per minute). */
  RL_ANON: RateLimit;
  /** Per-caller minute limits and registry quotas. */
  METER: MeterService;
  /** Optional usage metering (Workers Analytics Engine). */
  USAGE?: AnalyticsDataset;
  /**
   * Optional: the registry service (Worker factlot-registry, bound by service binding). When set,
   * the registry tools answer from it; without it they report that no registry is loaded.
   */
  REGISTRY?: Fetcher;
  /** Static landing page (Workers static assets). */
  ASSETS?: Fetcher;
  /**
   * Secret. Without it billing answers 503. Checkout opens only with a live key (sk_live_ or
   * rk_live_); with a test key, existing records keep working but checkout stays closed.
   */
  STRIPE_SECRET_KEY?: string;
  /** Secret, optional: verifies Stripe webhooks at /v1/billing/webhook. */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Public site origin used in checkout return URLs (default https://factlot.com). */
  SITE_URL?: string;
  /** Public API origin advertised to agents (default https://api.factlot.com). */
  API_URL?: string;
}
