/**
 * Hosted API keys. A key is `fl_live_` plus 32 random bytes (base64url). Only its SHA-256 is
 * stored; the plaintext is shown to the buyer once, on the checkout success page.
 */
import type { KV } from "./types.ts";
import type { PlanId } from "./plans.ts";

export const KEY_PREFIX = "fl_live_";
const KEY_RE = /^fl_live_[A-Za-z0-9_-]{43}$/;

export interface KeyRecord {
  plan: PlanId;
  /** "active" keys work; anything else is refused. */
  status: "active" | "inactive";
  customer: string;
  subscription: string;
  /** Stripe subscription status at the last check. */
  stripe_status: string;
  created: string;
  /** ms since epoch of the last subscription check with Stripe. */
  checked_at: number;
  /** Set when the key was replaced by /v1/billing/rotate. */
  replaced_by?: string;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return KEY_PREFIX + base64url(bytes);
}

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

export function bearer(header: string | null): string | undefined {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return m?.[1];
}

/** Subscription states that keep a key working (past_due is a grace period while Stripe retries). */
export function stripeStatusIsActive(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

export async function readKey(
  kv: KV,
  hash: string,
): Promise<KeyRecord | undefined> {
  const raw = await kv.get(`key:${hash}`);
  return raw ? (JSON.parse(raw) as KeyRecord) : undefined;
}

export async function writeKey(
  kv: KV,
  hash: string,
  record: KeyRecord,
): Promise<void> {
  await kv.put(`key:${hash}`, JSON.stringify(record));
}

/** All key hashes issued for one subscription (for webhooks and rotation). */
export async function subscriptionKeys(
  kv: KV,
  subscription: string,
): Promise<string[]> {
  const raw = await kv.get(`sub:${subscription}`);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function addSubscriptionKey(
  kv: KV,
  subscription: string,
  hash: string,
): Promise<void> {
  const list = await subscriptionKeys(kv, subscription);
  if (!list.includes(hash)) list.push(hash);
  await kv.put(`sub:${subscription}`, JSON.stringify(list));
}
