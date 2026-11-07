/**
 * Hosted API keys. A key is `fl_live_` plus 32 random bytes (base64url). Only its SHA-256 is
 * stored; the plaintext is shown to the buyer once (checkout success page, rotation, minting).
 *
 * KV layout:
 *   key:<sha256>        KeyRecord
 *   sub:<subscription>  JSON array of the key hashes issued for the subscription
 *   subevt:<sub>        `created` (unix seconds) of the last subscription webhook applied
 *
 * Retention: a key record that is not active (cancelled, unpaid, refunded, disputed, rotated or
 * revoked) is written with a 365-day expiry, so KV deletes it within 12 months; an active record
 * has none. Reactivation rewrites it without an expiry.
 *
 * KV is eventually consistent (a write can take up to a minute to be seen everywhere), so a new
 * key can be refused for that long in another region, and a revoked one can keep working.
 */
import type { KV } from "./types.ts";
import type { PlanId } from "./plans.ts";

export const KEY_PREFIX = "fl_live_";
const KEY_RE = /^fl_live_[A-Za-z0-9_-]{43}$/;

export interface KeyRecord {
  plan: PlanId;
  /** "active" keys work; anything else is refused. Derived by `deriveStatus`. */
  status: "active" | "inactive";
  customer: string;
  subscription: string;
  /** Stripe subscription status at the last check. */
  stripe_status: string;
  created: string;
  /** ms since epoch of the last subscription check with Stripe. */
  checked_at: number;
  /** Set when the key was replaced by /v1/billing/rotate (12 hex chars of the new key's hash). */
  replaced_by?: string;
  /** Set when the key was revoked with DELETE /v1/billing/keys/{id}. */
  revoked_at?: string;
  /** Stripe pause_collection is set on the subscription. */
  paused?: boolean;
  /**
   * The subscription's payment was fully refunded or disputed. Sticky: Stripe still reports the
   * subscription active, so only a maintainer clears it (scripts/billing/mint-key.ts clear-hold).
   */
  hold?: "refunded" | "disputed";
  /** ISO time of the last failed invoice payment; cleared once the subscription is active. */
  payment_failed_at?: string;
  /** ISO time the record became inactive; it is deleted 365 days later. */
  inactive_since?: string;
  /** ISO end of the subscription's current billing period (renewal date), from Stripe. */
  period_end?: string;
  /** The subscription ends at period_end instead of renewing. */
  cancel_at_period_end?: boolean;
}

/** How long KV keeps a record that is no longer active. */
export const INACTIVE_RETENTION_SECONDS = 365 * 24 * 60 * 60;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 256 random bits, base64url (43 characters): claim and recovery tokens. */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function generateKey(): string {
  return KEY_PREFIX + randomToken();
}

export { base64url };

export function looksLikeKey(token: string): boolean {
  return KEY_RE.test(token);
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The public id of a key: the first 16 hex characters of its hash. Safe to show and log. */
export function keyId(hash: string): string {
  return hash.slice(0, 16);
}

export function bearer(header: string | null): string | undefined {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return m?.[1];
}

/**
 * Subscription states that keep a key working. `past_due` is deliberately active: it is the
 * grace period while Stripe retries a failed payment, and the owner's dunning settings in Stripe
 * (Billing > Revenue recovery) decide when it ends, by moving the subscription to `canceled` or
 * `unpaid`. A subscription with `pause_collection` set is not active: nothing is being paid.
 */
export function stripeStatusIsActive(
  status: string,
  pauseCollection?: unknown,
): boolean {
  if (pauseCollection !== undefined && pauseCollection !== null) return false;
  return status === "active" || status === "trialing" || status === "past_due";
}

/** Stripe states a subscription never leaves. */
export function stripeStatusIsTerminal(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

/** Whether a record may call tools: every condition that can switch a key off, in one place. */
export function deriveStatus(r: KeyRecord): "active" | "inactive" {
  return !r.replaced_by &&
    !r.revoked_at &&
    !r.hold &&
    stripeStatusIsActive(r.stripe_status, r.paused ? true : undefined)
    ? "active"
    : "inactive";
}

/** A key that still belongs to its customer (possibly inactive for billing reasons). */
export function isLiveKey(r: KeyRecord): boolean {
  return !r.replaced_by && !r.revoked_at;
}

export async function readKey(
  kv: KV,
  hash: string,
): Promise<KeyRecord | undefined> {
  const raw = await kv.get(`key:${hash}`);
  return raw ? (JSON.parse(raw) as KeyRecord) : undefined;
}

/** The record as stored: status derived, inactive_since set or cleared. */
export function settle(record: KeyRecord, now: number = Date.now()): KeyRecord {
  const status = deriveStatus(record);
  const next: KeyRecord = { ...record, status };
  if (status === "active") delete next.inactive_since;
  else next.inactive_since ??= new Date(now).toISOString();
  return next;
}

/** When KV deletes an inactive record (ISO), or undefined for an active one. */
export function deletesAt(record: KeyRecord): string | undefined {
  if (!record.inactive_since) return undefined;
  const t =
    Date.parse(record.inactive_since) + INACTIVE_RETENTION_SECONDS * 1000;
  return new Date(t).toISOString();
}

export async function writeKey(
  kv: KV,
  hash: string,
  record: KeyRecord,
  now: number = Date.now(),
): Promise<void> {
  const next = settle(record, now);
  await kv.put(
    `key:${hash}`,
    JSON.stringify(next),
    next.status === "active"
      ? undefined
      : {
          // The 365 days run from when it became inactive, not from this write.
          expirationTtl: Math.max(
            60,
            Math.floor((Date.parse(deletesAt(next)!) - now) / 1000),
          ),
        },
  );
}

async function readList(kv: KV, name: string): Promise<string[]> {
  const raw = await kv.get(name);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

async function addToList(kv: KV, name: string, value: string): Promise<void> {
  const list = await readList(kv, name);
  if (list.includes(value)) return;
  list.push(value);
  await kv.put(name, JSON.stringify(list));
}

/** All key hashes issued for one subscription (for webhooks, rotation and minting). */
export function subscriptionKeys(
  kv: KV,
  subscription: string,
): Promise<string[]> {
  return readList(kv, `sub:${subscription}`);
}

export function addSubscriptionKey(
  kv: KV,
  subscription: string,
  hash: string,
): Promise<void> {
  return addToList(kv, `sub:${subscription}`, hash);
}

/** The subscription's keys that still belong to the customer, oldest first. */
export async function liveKeys(
  kv: KV,
  subscription: string,
): Promise<{ hash: string; record: KeyRecord }[]> {
  const out: { hash: string; record: KeyRecord }[] = [];
  for (const hash of await subscriptionKeys(kv, subscription)) {
    const record = await readKey(kv, hash);
    if (record && isLiveKey(record)) out.push({ hash, record });
  }
  return out.sort((a, b) => a.record.created.localeCompare(b.record.created));
}

export async function removeSubscriptionKey(
  kv: KV,
  subscription: string,
  hash: string,
): Promise<void> {
  const list = await subscriptionKeys(kv, subscription);
  if (!list.includes(hash)) return;
  await kv.put(
    `sub:${subscription}`,
    JSON.stringify(list.filter((h) => h !== hash)),
  );
}

/**
 * The meter subject for a key: its subscription, so every key of one subscription shares the
 * plan's limits and rotating or minting a key never resets or multiplies them.
 */
export function meterSubject(record: KeyRecord, hash: string): string {
  return record.subscription
    ? `sub:${record.subscription}`
    : `key:${keyId(hash)}`;
}

/**
 * Rewrite a subscription's key list with the retention of its keys: no expiry while one of them
 * is active, else the 365 days that apply to the records themselves.
 */
export async function settleSubscription(
  kv: KV,
  subscription: string,
): Promise<void> {
  const hashes = await subscriptionKeys(kv, subscription);
  if (hashes.length === 0) return;
  let active = false;
  for (const hash of hashes)
    if ((await readKey(kv, hash))?.status === "active") active = true;
  await kv.put(
    `sub:${subscription}`,
    JSON.stringify(hashes),
    active ? undefined : { expirationTtl: INACTIVE_RETENTION_SECONDS },
  );
}
