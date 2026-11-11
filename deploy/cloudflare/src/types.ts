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

/** Which counter a quota uses: registry lookups (the default) or reports. */
export type QuotaCounter = "lookups" | "reports";

export interface QuotaSpec {
  kind: QuotaKind;
  limit: number;
  /** Lookups (or reports) this request wants. */
  n: number;
  /** Default "lookups". */
  counter?: QuotaCounter;
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
  quota(
    subject: string,
    kind: QuotaKind,
    limit: number,
    counter?: QuotaCounter,
  ): Promise<QuotaState>;
  /** Give back lookups the registry could not answer (same window only). */
  refund(
    subject: string,
    kind: QuotaKind,
    n: number,
    resets_at: string,
    counter?: QuotaCounter,
  ): Promise<void>;
  /** First writer wins, strongly consistent: returns the value stored under `name`. */
  claim(name: string, value: string): Promise<string>;
  /** Record charged registry lookups for `sub:<subscription>` (tool name, region prefix). */
  record(
    subject: string,
    items: { tool: string; region: string }[],
  ): Promise<void>;
  /** Daily lookups and totals by tool and region for the last `days` UTC days. */
  usage(subject: string, days: number): Promise<UsageSummary>;
  /** When `key:<key id>` last made a request (ISO, to the minute). */
  lastUsed(subject: string): Promise<string | undefined>;
}

export interface UsageSummary {
  from: string;
  to: string;
  daily: { date: string; lookups: number }[];
  by_tool: Record<string, number>;
  by_region: Record<string, number>;
  total: number;
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

/** One address, optionally with a display name (Cloudflare Email Service). */
export interface EmailAddress {
  email: string;
  name?: string;
}

/** The structured message of the Email Service `send_email` binding. */
export interface EmailMessageBuilder {
  to: string | EmailAddress;
  from: string | EmailAddress;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | EmailAddress;
  headers?: Record<string, string>;
}

/** The `send_email` binding (Cloudflare Email Service). Errors carry a `code` such as E_SENDER_NOT_VERIFIED. */
export interface SendEmail {
  send(message: EmailMessageBuilder): Promise<{ messageId: string }>;
}

export interface Env {
  /** API-key records, Stripe checkout sessions already redeemed, cached price IDs. */
  KEYS: KV;
  /** Per-address minute limiter for billing pages and rejected keys (60 per minute). */
  RL_ANON: RateLimit;
  /** Per-caller minute limits and registry quotas. */
  METER: MeterService;
  /** Per agent-claim token: one poll every 2 seconds. */
  RL_CLAIM: RateLimit;
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
  /** Secret: salts the hash that names a keyless caller's meter (never the raw address). */
  IP_HASH_SALT?: string;
  /** Public site origin used in checkout return URLs (default https://factlot.com). */
  SITE_URL?: string;
  /** Public API origin advertised to agents (default https://api.factlot.com). */
  API_URL?: string;
  /**
   * Optional: Cloudflare Email Service binding (wrangler.jsonc `send_email`). Without it the
   * welcome email is skipped and email recovery says it is being set up.
   */
  EMAIL?: SendEmail;
  /** Secret: signs account-recovery links. Without it email recovery stays off. */
  RECOVERY_SIGNING_SECRET?: string;
  /**
   * Secret, optional: Anthropic API key for the two model-backed tools (doc_extract_lease,
   * report_narrative). Without it they are not listed and their routes answer 503
   * ModelUnavailable; every other tool runs without a model either way.
   */
  ANTHROPIC_API_KEY?: string;
  /** "true" opens report_create and POST /v1/reports; anything else keeps them closed (downloads still serve). */
  REPORTS_ENABLED?: string;
  /** "true" turns paid gating on: value history and batch registry tools for Pro and Team only. Unset: off. */
  GATING_ENABLED?: string;
}
