/**
 * Paid hosted access through Stripe Checkout.
 *
 *   GET  /billing/checkout?plan=pro|team   303 to a Stripe Checkout page (people, site buttons)
 *   POST /v1/billing/checkout {"plan":...}  {"url": ...} (agents hand the link to their human)
 *   GET  /billing/success?session_id=...    issues the API key and shows it once
 *   GET  /v1/account          (bearer)      plan, limits, registry lookups used, keys
 *   POST /v1/billing/portal   (bearer)      {"url": ...} Stripe customer portal: card, invoices, cancel
 *   POST /v1/billing/rotate   (bearer)      {"key": ...} new key; the old one stops working
 *   POST /v1/billing/keys     (bearer)      {"key": ...} one more key, up to the plan's key limit
 *   DELETE /v1/billing/keys/{id} (bearer)   revoke one key (never the last)
 *   POST /v1/billing/webhook                Stripe events (keys are also re-checked lazily)
 *
 * Prices are found by lookup key and created on first use, so the only required secret is
 * STRIPE_SECRET_KEY. Without it every billing route answers 503 with a contact address. With a
 * test key (sk_test_, rk_test_) checkout stays closed; everything else works for existing keys.
 */
import {
  INACTIVE_RETENTION_SECONDS,
  addSubscriptionKey,
  deletesAt,
  deriveStatus,
  generateKey,
  hashKey,
  isLiveKey,
  keyId,
  liveKeys,
  meterSubject,
  readKey,
  removeSubscriptionKey,
  settle,
  settleSubscription,
  stripeStatusIsTerminal,
  subscriptionKeys,
  writeKey,
  type KeyRecord,
} from "./keys.ts";
import {
  PLANS,
  isPlanId,
  planForLookupKey,
  priceText,
  type PlanId,
} from "./plans.ts";
import { StripeError, stripeClient, verifyStripeSignature } from "./stripe.ts";
import type { StripeClient } from "./stripe.ts";
import type { Env, KV } from "./types.ts";
import { keyPage, messagePage } from "./pages.ts";

/** How long a key's subscription status is trusted before it is re-checked with Stripe. */
export const RECHECK_MS = 6 * 60 * 60 * 1000;
/** After a failed re-check, the next attempt waits this long (a Stripe outage costs one call per key per 10 minutes). */
export const RECHECK_BACKOFF_MS = 10 * 60 * 1000;
/** The re-check runs on a customer's request, so it gives Stripe this long. */
export const RECHECK_TIMEOUT_MS = 5_000;
/** Stripe events are far smaller; anything larger is refused before the signature is computed. */
export const WEBHOOK_MAX_BYTES = 1024 * 1024;
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
export const CONTACT = "contact@factlot.com";
export const DISCUSSIONS =
  "https://github.com/9mp96ygnbk-alt/factlot/discussions";
export const CHECKOUT_CLOSED_MESSAGE = `Paid plans open shortly. Email ${CONTACT} to be told when they do.`;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function billingClosed(): Response {
  return json(503, {
    error: "BillingNotOpen",
    message: `Billing is not configured. Email ${CONTACT}.`,
  });
}

/** Checkout takes new customers only with a live Stripe key. */
export function checkoutOpen(env: Env): boolean {
  return /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");
}

export interface BillingDeps {
  env: Env;
  stripe: StripeClient;
  now: () => number;
}

export function billingDeps(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): BillingDeps | undefined {
  if (!env.STRIPE_SECRET_KEY) return undefined;
  return { env, stripe: stripeClient(env.STRIPE_SECRET_KEY, fetchImpl), now };
}

export const siteUrl = (env: Env) =>
  (env.SITE_URL ?? "https://factlot.com").replace(/\/$/, "");
const siteHost = (env: Env) => siteUrl(env).replace(/^https?:\/\//, "");

/** The Stripe price for a plan: cached in KV, else found by lookup key, else created. */
export async function ensurePrice(
  d: BillingDeps,
  plan: PlanId,
): Promise<string> {
  const p = PLANS[plan];
  const cacheKey = `price:${p.lookupKey}`;
  const cached = await d.env.KEYS.get(cacheKey);
  if (cached) return cached;
  const found = (await d.stripe.get("/prices", {
    "lookup_keys[]": p.lookupKey,
    active: true,
    limit: 1,
  })) as { data?: { id: string }[] };
  let id = found.data?.[0]?.id;
  if (!id) {
    const product = await d.stripe.post("/products", {
      name: p.name,
      description: p.summary,
      "metadata[factlot_plan]": p.id,
    });
    const price = await d.stripe.post("/prices", {
      product: String(product.id),
      currency: "usd",
      unit_amount: p.monthlyCents,
      "recurring[interval]": "month",
      lookup_key: p.lookupKey,
      nickname: `${p.name} monthly`,
      "metadata[factlot_plan]": p.id,
    });
    id = String(price.id);
  }
  await d.env.KEYS.put(cacheKey, id, { expirationTtl: 24 * 60 * 60 });
  return id;
}

export async function createCheckout(
  d: BillingDeps,
  plan: PlanId,
): Promise<string> {
  const price = await ensurePrice(d, plan);
  const site = siteUrl(d.env);
  const session = await d.stripe.post("/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    success_url: `${site}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/#pricing`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    "tax_id_collection[enabled]": true,
    // Needs a terms of service URL in the Stripe dashboard (Settings > Business > Public details).
    "consent_collection[terms_of_service]": "required",
    "custom_text[terms_of_service_acceptance][message]": `I agree to the [FactLot Terms of Service](${site}/terms).`,
    "custom_text[submit][message]": `${priceText(PLANS[plan])}, renews monthly until cancelled. Cancel any time at ${siteHost(d.env)}/account.`,
    "metadata[factlot_plan]": plan,
    "subscription_data[metadata][factlot_plan]": plan,
  });
  return String(session.url);
}

/** What a Stripe subscription object says about access. */
export interface SubscriptionState {
  stripe_status: string;
  plan?: PlanId;
  paused: boolean;
}

/**
 * The plan of a subscription: the price's lookup key (portal upgrades and downgrades change the
 * price), else the price's factlot_plan metadata, else the subscription's metadata (set at
 * checkout, so it can be stale after a plan change).
 */
export function planFromSubscription(
  sub: Record<string, unknown>,
): PlanId | undefined {
  const items = sub.items as
    | {
        data?: {
          price?: { lookup_key?: unknown; metadata?: Record<string, unknown> };
        }[];
      }
    | undefined;
  const price = items?.data?.[0]?.price;
  const byKey = planForLookupKey(price?.lookup_key);
  if (byKey) return byKey;
  if (isPlanId(price?.metadata?.factlot_plan))
    return price.metadata.factlot_plan;
  const meta = (sub.metadata ?? {}) as Record<string, unknown>;
  return isPlanId(meta.factlot_plan) ? meta.factlot_plan : undefined;
}

export function subscriptionState(
  sub: Record<string, unknown>,
): SubscriptionState {
  return {
    stripe_status: String(sub.status ?? "unknown"),
    plan: planFromSubscription(sub),
    paused: sub.pause_collection !== undefined && sub.pause_collection !== null,
  };
}

/** A record updated with a subscription's state. Canceled is final: a late event cannot undo it. */
function applyState(
  rec: KeyRecord,
  s: SubscriptionState,
  checkedAt: number,
): KeyRecord {
  const stripe_status =
    stripeStatusIsTerminal(rec.stripe_status) &&
    !stripeStatusIsTerminal(s.stripe_status)
      ? rec.stripe_status
      : s.stripe_status;
  const next: KeyRecord = {
    ...rec,
    stripe_status,
    plan: s.plan ?? rec.plan,
    checked_at: checkedAt,
  };
  if (s.paused) next.paused = true;
  else delete next.paused;
  if (stripe_status === "active" || stripe_status === "trialing")
    delete next.payment_failed_at;
  return settle(next, checkedAt);
}

type Redeemed =
  | { ok: true; key: string; plan: PlanId }
  | { ok: false; status: number; message: string };

const ALREADY_SHOWN = `The key for this purchase was already shown. Lost it? Email ${CONTACT} from the address you paid with and we will issue a new one.`;

/**
 * Redeem a completed checkout session for an API key, once. Two loads of the success page at the
 * same moment (two tabs, or two regions) both pass the KV check, so the session is claimed in a
 * Durable Object (strongly consistent) and only the winner's key is kept. The key record is
 * written before the claim, so a shown key always has a record; a loser deletes its record.
 */
export async function redeemSession(
  d: BillingDeps,
  sessionId: string,
): Promise<Redeemed> {
  const kv = d.env.KEYS;
  if (!SESSION_RE.test(sessionId))
    return {
      ok: false,
      status: 400,
      message: "That checkout link is not valid.",
    };
  if (await kv.get(`session:${sessionId}`))
    return { ok: false, status: 409, message: ALREADY_SHOWN };
  let session: Record<string, unknown>;
  try {
    session = await d.stripe.get(`/checkout/sessions/${sessionId}`, {
      "expand[]": "subscription",
    });
  } catch (err) {
    if (err instanceof StripeError && err.status === 404)
      return {
        ok: false,
        status: 404,
        message: "We could not find that checkout.",
      };
    throw err;
  }
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const metaPlan = meta.factlot_plan;
  const paid =
    session.status === "complete" &&
    (session.payment_status === "paid" ||
      session.payment_status === "no_payment_required");
  // A bank (ACH) payment completes checkout before the money arrives: the key comes once it does.
  if (
    session.status === "complete" &&
    session.payment_status === "unpaid" &&
    session.mode === "subscription" &&
    isPlanId(metaPlan)
  ) {
    if (await kv.get(`sessionfail:${sessionId}`))
      return {
        ok: false,
        status: 402,
        message: `Your bank payment did not go through, so no key was issued and nothing was charged. Start again at ${siteUrl(d.env)}/#pricing with another payment method, or email ${CONTACT}.`,
      };
    return {
      ok: false,
      status: 202,
      message:
        "Thank you. Your bank payment is processing, which usually takes 1 to 4 business days. Bookmark this page: once the payment clears, it shows your API key (once). Stripe emails you when the payment goes through.",
    };
  }
  if (!paid || session.mode !== "subscription" || !isPlanId(metaPlan))
    return {
      ok: false,
      status: 402,
      message:
        "This checkout is not complete yet. If you just paid, reload this page in a minute.",
    };
  const rawSub = session.subscription;
  const subObject =
    typeof rawSub === "object" && rawSub !== null
      ? (rawSub as Record<string, unknown>)
      : undefined;
  const subscription = String(subObject?.id ?? rawSub ?? "");
  const customer = String(
    typeof session.customer === "object" && session.customer !== null
      ? (session.customer as { id?: unknown }).id
      : (session.customer ?? ""),
  );
  const state: SubscriptionState = subObject
    ? subscriptionState(subObject)
    : { stripe_status: "active", plan: metaPlan, paused: false };
  const plan = state.plan ?? metaPlan;

  const key = generateKey();
  const hash = await hashKey(key);
  const id = keyId(hash);
  const base: KeyRecord = {
    plan,
    status: "active",
    customer,
    subscription,
    stripe_status: "active",
    created: new Date(d.now()).toISOString(),
    checked_at: d.now(),
  };
  await writeKey(kv, hash, applyState(base, state, d.now()), d.now());
  let winner: string;
  try {
    winner = await d.env.METER.claim(`session:${sessionId}`, id);
  } catch (err) {
    await kv.delete(`key:${hash}`); // never shown, so never kept
    throw err;
  }
  if (winner !== id) {
    await kv.delete(`key:${hash}`);
    return { ok: false, status: 409, message: ALREADY_SHOWN };
  }
  await addSubscriptionKey(kv, subscription, hash);
  await kv.put(
    `session:${sessionId}`,
    JSON.stringify({ key_id: id, redeemed_at: base.created }),
    { expirationTtl: INACTIVE_RETENTION_SECONDS },
  );
  return { ok: true, key, plan };
}

/** Re-check a key's subscription with Stripe when the cached status is older than RECHECK_MS. */
export async function refreshIfStale(
  d: BillingDeps,
  hash: string,
  record: KeyRecord,
): Promise<KeyRecord> {
  if (!isLiveKey(record) || d.now() - record.checked_at < RECHECK_MS)
    return record;
  let next: KeyRecord;
  try {
    const sub = await d.stripe.get(
      `/subscriptions/${record.subscription}`,
      {},
      { timeoutMs: RECHECK_TIMEOUT_MS },
    );
    next = applyState(record, subscriptionState(sub), d.now());
  } catch (err) {
    if (err instanceof StripeError && err.status === 404) {
      // Stripe does not know the subscription (for example a sandbox purchase checked with a
      // live key): the key is not backed by a payment, so it stops working.
      next = settle(
        { ...record, stripe_status: "missing", checked_at: d.now() },
        d.now(),
      );
    } else {
      // Stripe unreachable or slow: keep the last known status (never lock a paying customer
      // out for Stripe's outage) and try again after the backoff, not on every request.
      next = {
        ...record,
        checked_at: d.now() - RECHECK_MS + RECHECK_BACKOFF_MS,
      };
    }
  }
  try {
    await writeKey(d.env.KEYS, hash, next, d.now());
  } catch {
    // A KV write limit (one write per key per second) must not fail the customer's request.
  }
  return next;
}

/** Apply `change` to every live key of the subscriptions; returns how many records changed. */
async function updateKeys(
  kv: KV,
  subscriptions: string[],
  change: (rec: KeyRecord) => KeyRecord,
  now: number,
): Promise<number> {
  let n = 0;
  for (const subscription of subscriptions) {
    for (const hash of await subscriptionKeys(kv, subscription)) {
      const rec = await readKey(kv, hash);
      if (!rec || !isLiveKey(rec)) continue;
      await writeKey(kv, hash, change(rec), now);
      n++;
    }
    await settleSubscription(kv, subscription);
  }
  return n;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : undefined;
  }
  return undefined;
}

/** An invoice's subscription, in both the older and the 2025+ API shapes. */
export function invoiceSubscription(
  invoice: Record<string, unknown>,
): string | undefined {
  const parent = invoice.parent as
    { subscription_details?: { subscription?: unknown } } | undefined;
  return (
    idOf(invoice.subscription) ??
    idOf(parent?.subscription_details?.subscription)
  );
}

/**
 * The subscriptions a charge paid for: through its invoice when the charge names one (older API
 * versions), else every subscription of the charge's customer (asked of Stripe; FactLot keeps
 * no customer index). A customer with two subscriptions loses access on both: the safe side.
 */
async function subscriptionsForCharge(
  d: BillingDeps | undefined,
  charge: Record<string, unknown>,
): Promise<string[]> {
  if (!d) return [];
  const invoice = idOf(charge.invoice);
  if (invoice) {
    const sub = invoiceSubscription(await d.stripe.get(`/invoices/${invoice}`));
    if (sub) return [sub];
  }
  const customer = idOf(charge.customer);
  if (!customer) return [];
  const list = (await d.stripe.get("/subscriptions", {
    customer,
    status: "all",
    limit: 100,
  })) as { data?: { id?: unknown }[] };
  return (list.data ?? [])
    .map((s) => idOf(s.id))
    .filter((s) => s !== undefined);
}

/** Read at most `max` bytes of the body; undefined when it is longer. */
async function readCapped(
  request: Request,
  max: number,
): Promise<string | undefined> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

interface StripeEvent {
  id?: string;
  type?: string;
  /** Unix seconds. */
  created?: number;
  data?: { object?: Record<string, unknown> };
}

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function handleWebhook(
  env: Env,
  request: Request,
  now: () => number = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET)
    return json(404, { error: "NotFound", message: "webhook not configured" });
  const declared = Number(request.headers.get("content-length") ?? "0");
  const payload =
    declared > WEBHOOK_MAX_BYTES
      ? undefined
      : await readCapped(request, WEBHOOK_MAX_BYTES);
  if (payload === undefined)
    return json(413, { error: "PayloadTooLarge", message: "body over 1 MB" });
  const ok = await verifyStripeSignature(
    payload,
    request.headers.get("stripe-signature"),
    env.STRIPE_WEBHOOK_SECRET,
    Math.floor(now() / 1000),
  );
  if (!ok) return json(400, { error: "BadSignature" });
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return json(400, { error: "BadRequest", message: "body is not JSON" });
  }
  const obj = event.data?.object ?? {};
  const created = Number(event.created ?? 0);
  const kv = env.KEYS;
  try {
    if (event.type && SUBSCRIPTION_EVENTS.has(event.type) && idOf(obj.id)) {
      const sub = idOf(obj.id)!;
      // Stripe does not deliver events in order: an event older than the last one applied to
      // this subscription is stale. Equal timestamps apply (canceled stays final either way).
      const last = Number((await kv.get(`subevt:${sub}`)) ?? "0");
      if (created && created < last)
        return json(200, { received: true, skipped: "older than applied" });
      const state = subscriptionState(obj);
      if (event.type === "customer.subscription.deleted")
        state.stripe_status = "canceled";
      const updated = await updateKeys(
        kv,
        [sub],
        (rec) => applyState(rec, state, now()),
        now(),
      );
      if (created)
        await kv.put(`subevt:${sub}`, String(created), {
          expirationTtl: INACTIVE_RETENTION_SECONDS,
        });
      return json(200, { received: true, keys_updated: updated });
    }
    if (
      event.type === "charge.refunded" ||
      event.type === "charge.dispute.created"
    ) {
      const d = billingDeps(env, fetchImpl, now);
      let charge: Record<string, unknown> | undefined = obj;
      const hold = event.type === "charge.refunded" ? "refunded" : "disputed";
      if (hold === "refunded" && obj.refunded !== true)
        return json(200, { received: true, skipped: "partial refund" });
      if (hold === "disputed") {
        const chargeId = idOf(obj.charge);
        charge =
          typeof obj.charge === "object" && obj.charge !== null
            ? (obj.charge as Record<string, unknown>)
            : chargeId && d
              ? await d.stripe.get(`/charges/${chargeId}`)
              : undefined;
      }
      const subs = charge ? await subscriptionsForCharge(d, charge) : [];
      const updated = await updateKeys(
        kv,
        subs,
        (rec) => ({ ...rec, hold: rec.hold ?? hold }),
        now(),
      );
      return json(200, { received: true, keys_updated: updated });
    }
    if (
      event.type === "checkout.session.async_payment_failed" &&
      idOf(obj.id)
    ) {
      await kv.put(`sessionfail:${idOf(obj.id)}`, "failed", {
        expirationTtl: 90 * 24 * 60 * 60,
      });
      return json(200, { received: true });
    }
    if (event.type === "invoice.payment_failed") {
      const sub = invoiceSubscription(obj);
      const at = new Date((created || Math.floor(now() / 1000)) * 1000);
      const updated = sub
        ? await updateKeys(
            kv,
            [sub],
            (rec) => ({ ...rec, payment_failed_at: at.toISOString() }),
            now(),
          )
        : 0;
      return json(200, { received: true, keys_updated: updated });
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "webhook failed",
        type: String(event.type ?? "").slice(0, 64),
        error: err instanceof Error ? err.name : typeof err,
      }),
    );
    // 5xx: Stripe retries the event with backoff.
    return json(503, { error: "ServiceUnavailable", message: "retry later" });
  }
  return json(200, { received: true });
}

/** A copy of a live record for a new key of the same subscription. */
function freshRecord(record: KeyRecord, now: number): KeyRecord {
  const next: KeyRecord = { ...record, created: new Date(now).toISOString() };
  delete next.replaced_by;
  delete next.revoked_at;
  delete next.inactive_since;
  return next;
}

/** What key changes need: KV and a clock (no Stripe call). */
export interface KeyDeps {
  env: Env;
  now: () => number;
}

export async function rotateKey(
  d: KeyDeps,
  oldHash: string,
  record: KeyRecord,
): Promise<string> {
  const kv = d.env.KEYS;
  const key = generateKey();
  const hash = await hashKey(key);
  await writeKey(kv, hash, freshRecord(record, d.now()), d.now());
  await addSubscriptionKey(kv, record.subscription, hash);
  await writeKey(
    kv,
    oldHash,
    { ...record, replaced_by: hash.slice(0, 12) },
    d.now(),
  );
  await removeSubscriptionKey(kv, record.subscription, oldHash);
  return key;
}

/** One more key for the subscription, within the plan's key limit. */
export async function mintKey(
  d: KeyDeps,
  record: KeyRecord,
): Promise<
  { ok: true; key: string; id: string } | { ok: false; limit: number }
> {
  const kv = d.env.KEYS;
  const limit = PLANS[record.plan].maxKeys;
  // KV is eventually consistent: two mints at the same moment from two regions can both pass
  // this count. The plan's limits are per subscription, so an extra key adds no capacity.
  if ((await liveKeys(kv, record.subscription)).length >= limit)
    return { ok: false, limit };
  const key = generateKey();
  const hash = await hashKey(key);
  await writeKey(kv, hash, freshRecord(record, d.now()), d.now());
  await addSubscriptionKey(kv, record.subscription, hash);
  return { ok: true, key, id: keyId(hash) };
}

/** Revoke the subscription's key with public id `id`; the last live key cannot be revoked. */
export async function revokeKey(
  d: KeyDeps,
  record: KeyRecord,
  id: string,
): Promise<"revoked" | "not_found" | "last_key"> {
  const kv = d.env.KEYS;
  const keys = await liveKeys(kv, record.subscription);
  const target = keys.find((k) => keyId(k.hash) === id);
  if (!target) return "not_found";
  if (keys.length <= 1) return "last_key";
  await writeKey(
    kv,
    target.hash,
    { ...target.record, revoked_at: new Date(d.now()).toISOString() },
    d.now(),
  );
  await removeSubscriptionKey(kv, record.subscription, target.hash);
  return "revoked";
}

export async function portalUrl(
  d: BillingDeps,
  record: KeyRecord,
): Promise<string> {
  const s = await d.stripe.post("/billing_portal/sessions", {
    customer: record.customer,
    return_url: `${siteUrl(d.env)}/account`,
  });
  return String(s.url);
}

export interface AccountSummary {
  plan: PlanId;
  plan_name: string;
  price: string;
  status: "active" | "inactive";
  stripe_status: string;
  paused?: boolean;
  hold?: string;
  payment_failed_at?: string;
  requests_per_minute: number;
  created: string;
  key_id: string;
  registry_lookups: { used: number; limit: number; resets_at: string };
  keys: {
    count: number;
    limit: number;
    items: { id: string; created: string; current: boolean }[];
  };
  manage: string;
  /** Set while the key is inactive: when the record is deleted. */
  inactive_since?: string;
  deletes_at?: string;
  data_retention: string;
}

/** What /v1/account and the /account page show for a key. */
export async function accountSummary(
  env: Env,
  hash: string,
  record: KeyRecord,
): Promise<AccountSummary> {
  const plan = PLANS[record.plan];
  const keys = await liveKeys(env.KEYS, record.subscription);
  const q = await env.METER.quota(
    meterSubject(record, hash),
    "month",
    plan.registryLookupsPerMonth,
  );
  return {
    plan: plan.id,
    plan_name: plan.name,
    price: priceText(plan),
    status: deriveStatus(record),
    stripe_status: record.stripe_status,
    ...(record.paused ? { paused: true } : {}),
    ...(record.hold ? { hold: record.hold } : {}),
    ...(record.payment_failed_at
      ? { payment_failed_at: record.payment_failed_at }
      : {}),
    requests_per_minute: plan.requestsPerMinute,
    created: record.created,
    key_id: keyId(hash),
    registry_lookups: { used: q.used, limit: q.limit, resets_at: q.resets_at },
    keys: {
      count: keys.length,
      limit: plan.maxKeys,
      items: keys.map((k) => ({
        id: keyId(k.hash),
        created: k.record.created,
        current: k.hash === hash,
      })),
    },
    manage: `${siteUrl(env)}/account`,
    ...(record.inactive_since
      ? { inactive_since: record.inactive_since, deletes_at: deletesAt(record) }
      : {}),
    data_retention:
      "Kept while the key is active; deleted 365 days after it becomes inactive (cancelled, unpaid, refunded, disputed, rotated or revoked).",
  };
}

export async function checkoutRoute(
  env: Env,
  request: Request,
  url: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const isGet = request.method === "GET";
  let plan: unknown = url.searchParams.get("plan");
  if (!isGet) {
    try {
      plan = ((await request.json()) as { plan?: unknown }).plan;
    } catch {
      plan = undefined;
    }
  }
  if (!isPlanId(plan)) {
    const message = 'plan must be "pro" or "team"';
    return isGet
      ? messagePage(400, "Choose a plan", message)
      : json(400, { error: "BadRequest", message });
  }
  const d = billingDeps(env, fetchImpl);
  if (!d || !checkoutOpen(env))
    return isGet
      ? messagePage(503, "Paid plans open shortly", CHECKOUT_CLOSED_MESSAGE)
      : json(503, {
          error: "CheckoutClosed",
          message: CHECKOUT_CLOSED_MESSAGE,
        });
  try {
    const checkout = await createCheckout(d, plan);
    return isGet
      ? new Response(null, {
          status: 303,
          headers: { location: checkout, "cache-control": "no-store" },
        })
      : json(200, {
          url: checkout,
          plan,
          note: "Open this link in a browser to pay; the API key is shown on the page Stripe returns to.",
        });
  } catch (err) {
    const message =
      err instanceof StripeError
        ? "Stripe could not start checkout."
        : "Checkout failed.";
    return isGet
      ? messagePage(502, "Checkout failed", `${message} Email ${CONTACT}.`)
      : json(502, { error: "CheckoutFailed", message });
  }
}

export async function successRoute(
  env: Env,
  url: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const d = billingDeps(env, fetchImpl);
  if (!d)
    return messagePage(503, "Paid plans open shortly", CHECKOUT_CLOSED_MESSAGE);
  let result: Redeemed;
  try {
    result = await redeemSession(d, url.searchParams.get("session_id") ?? "");
  } catch {
    return messagePage(
      502,
      "About your FactLot key",
      `We could not reach Stripe or our key store. Your payment is safe: reload this page in a minute, or email ${CONTACT}.`,
    );
  }
  if (!result.ok)
    return messagePage(result.status, "About your FactLot key", result.message);
  return keyPage(
    result.key,
    PLANS[result.plan],
    env.API_URL ?? "https://api.factlot.com",
    siteUrl(env),
  );
}
