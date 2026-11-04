/**
 * Paid hosted access through Stripe Checkout.
 *
 *   GET  /billing/checkout?plan=pro|team   303 to a Stripe Checkout page (people, site buttons)
 *   POST /v1/billing/checkout {"plan":...}  {"url": ...} (agents hand the link to their human)
 *   GET  /billing/success?session_id=...    issues the API key and shows it once
 *   POST /v1/billing/portal   (bearer)      {"url": ...} Stripe customer portal: card, invoices, cancel
 *   POST /v1/billing/rotate   (bearer)      {"key": ...} new key; the old one stops working
 *   POST /v1/billing/webhook                Stripe events (optional; keys are also re-checked lazily)
 *
 * Prices are found by lookup key and created on first use, so the only required secret is
 * STRIPE_SECRET_KEY. Without it every billing route answers 503 with a contact address.
 */
import {
  addSubscriptionKey,
  generateKey,
  hashKey,
  readKey,
  stripeStatusIsActive,
  subscriptionKeys,
  writeKey,
  type KeyRecord,
} from "./keys.ts";
import { PLANS, isPlanId, type PlanId } from "./plans.ts";
import { StripeError, stripeClient, verifyStripeSignature } from "./stripe.ts";
import type { StripeClient } from "./stripe.ts";
import type { Env, KV } from "./types.ts";
import { keyPage, messagePage } from "./pages.ts";

/** How long a key's subscription status is trusted before it is re-checked with Stripe. */
export const RECHECK_MS = 6 * 60 * 60 * 1000;
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
export const CONTACT = "contact@factlot.com";
export const DISCUSSIONS =
  "https://github.com/9mp96ygnbk-alt/factlot/discussions";

export function json(status: number, body: unknown, headers: HeadersInit = {}) {
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
    message: `Paid plans open shortly. Email ${CONTACT} or ask in ${DISCUSSIONS} for early access.`,
  });
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

const siteUrl = (env: Env) =>
  (env.SITE_URL ?? "https://factlot.com").replace(/\/$/, "");

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
    "metadata[factlot_plan]": plan,
    "subscription_data[metadata][factlot_plan]": plan,
  });
  return String(session.url);
}

/** Redeem a completed checkout session for an API key, once. */
export async function redeemSession(
  d: BillingDeps,
  sessionId: string,
): Promise<
  | { ok: true; key: string; plan: PlanId }
  | { ok: false; status: number; message: string }
> {
  if (!SESSION_RE.test(sessionId))
    return {
      ok: false,
      status: 400,
      message: "That checkout link is not valid.",
    };
  if (await d.env.KEYS.get(`session:${sessionId}`))
    return {
      ok: false,
      status: 409,
      message: `The key for this purchase was already shown. Lost it? Email ${CONTACT} from the address you paid with and we will issue a new one.`,
    };
  let session: Record<string, unknown>;
  try {
    session = await d.stripe.get(`/checkout/sessions/${sessionId}`);
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
  const plan = meta.factlot_plan;
  const paid =
    session.status === "complete" &&
    (session.payment_status === "paid" ||
      session.payment_status === "no_payment_required");
  if (!paid || session.mode !== "subscription" || !isPlanId(plan))
    return {
      ok: false,
      status: 402,
      message:
        "This checkout is not complete yet. If you just paid, reload this page in a minute.",
    };
  const subscription = String(session.subscription ?? "");
  const customer = String(session.customer ?? "");
  // Mark the session redeemed before issuing, so a double load cannot mint two keys.
  await d.env.KEYS.put(`session:${sessionId}`, "redeemed");
  const key = generateKey();
  const hash = await hashKey(key);
  await writeKey(d.env.KEYS, hash, {
    plan,
    status: "active",
    customer,
    subscription,
    stripe_status: "active",
    created: new Date(d.now()).toISOString(),
    checked_at: d.now(),
  });
  await addSubscriptionKey(d.env.KEYS, subscription, hash);
  return { ok: true, key, plan };
}

/** Re-check a key's subscription with Stripe when the cached status is older than RECHECK_MS. */
export async function refreshIfStale(
  d: BillingDeps,
  hash: string,
  record: KeyRecord,
): Promise<KeyRecord> {
  if (record.replaced_by || d.now() - record.checked_at < RECHECK_MS)
    return record;
  try {
    const sub = await d.stripe.get(`/subscriptions/${record.subscription}`);
    const stripeStatus = String(sub.status ?? "unknown");
    const next: KeyRecord = {
      ...record,
      stripe_status: stripeStatus,
      status: stripeStatusIsActive(stripeStatus) ? "active" : "inactive",
      checked_at: d.now(),
    };
    await writeKey(d.env.KEYS, hash, next);
    return next;
  } catch (err) {
    // Stripe does not know the subscription (for example a sandbox purchase checked with a live
    // key): the key is not backed by a payment, so it stops working.
    if (err instanceof StripeError && err.status === 404) {
      const next: KeyRecord = {
        ...record,
        stripe_status: "missing",
        status: "inactive",
        checked_at: d.now(),
      };
      await writeKey(d.env.KEYS, hash, next);
      return next;
    }
    // Stripe unreachable: keep the last known status rather than locking a paying customer out.
    return record;
  }
}

async function setSubscriptionStatus(
  kv: KV,
  subscription: string,
  stripeStatus: string,
  now: number,
): Promise<number> {
  let n = 0;
  for (const hash of await subscriptionKeys(kv, subscription)) {
    const rec = await readKey(kv, hash);
    if (!rec || rec.replaced_by) continue;
    await writeKey(kv, hash, {
      ...rec,
      stripe_status: stripeStatus,
      status: stripeStatusIsActive(stripeStatus) ? "active" : "inactive",
      checked_at: now,
    });
    n++;
  }
  return n;
}

export async function handleWebhook(
  env: Env,
  request: Request,
  now: () => number = Date.now,
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET)
    return json(404, { error: "NotFound", message: "webhook not configured" });
  const payload = await request.text();
  const ok = await verifyStripeSignature(
    payload,
    request.headers.get("stripe-signature"),
    env.STRIPE_WEBHOOK_SECRET,
    Math.floor(now() / 1000),
  );
  if (!ok) return json(400, { error: "BadSignature" });
  const event = JSON.parse(payload) as {
    type?: string;
    data?: { object?: { id?: string; status?: string } };
  };
  const obj = event.data?.object;
  if (
    (event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted") &&
    obj?.id
  ) {
    const status =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : String(obj.status ?? "unknown");
    const updated = await setSubscriptionStatus(
      env.KEYS,
      obj.id,
      status,
      now(),
    );
    return json(200, { received: true, keys_updated: updated });
  }
  return json(200, { received: true });
}

export async function rotateKey(
  d: BillingDeps,
  oldHash: string,
  record: KeyRecord,
): Promise<string> {
  const key = generateKey();
  const hash = await hashKey(key);
  await writeKey(d.env.KEYS, hash, {
    ...record,
    created: new Date(d.now()).toISOString(),
    replaced_by: undefined,
  });
  await addSubscriptionKey(d.env.KEYS, record.subscription, hash);
  await writeKey(d.env.KEYS, oldHash, {
    ...record,
    status: "inactive",
    replaced_by: hash.slice(0, 12),
  });
  return key;
}

export async function portalUrl(
  d: BillingDeps,
  record: KeyRecord,
): Promise<string> {
  const s = await d.stripe.post("/billing_portal/sessions", {
    customer: record.customer,
    return_url: siteUrl(d.env),
  });
  return String(s.url);
}

export async function checkoutRoute(
  env: Env,
  request: Request,
  url: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const d = billingDeps(env, fetchImpl);
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
  if (!d)
    return isGet
      ? messagePage(
          503,
          "Paid plans open shortly",
          `Email ${CONTACT} for early access.`,
        )
      : billingClosed();
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
    return messagePage(503, "Paid plans open shortly", `Email ${CONTACT}.`);
  const result = await redeemSession(
    d,
    url.searchParams.get("session_id") ?? "",
  );
  if (!result.ok)
    return messagePage(result.status, "About your FactLot key", result.message);
  return keyPage(
    result.key,
    PLANS[result.plan],
    env.API_URL ?? "https://api.factlot.com",
  );
}
