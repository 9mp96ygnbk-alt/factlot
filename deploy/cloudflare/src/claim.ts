/**
 * The agent claim flow. An agent that starts checkout (POST /v1/billing/checkout) gets, next to
 * the payment link for its human, a `claim_url` it can poll:
 *
 *   GET /v1/billing/claim/<token>
 *     202 {status:"pending"}            the checkout is not paid yet (poll every 2 s or slower)
 *     200 {key, plan, ...}              paid: the key, exactly once
 *     410 {status:"claimed", by}        already collected, by the agent or by the success page
 *     404                               unknown or expired
 *
 * The token is 256 random bits; KV holds only its SHA-256 (`claim:<hash>`), the checkout session
 * id and the expiry, for an hour plus a short grace. The Checkout session carries the claim's
 * public id (the first 16 hex of the hash) in its metadata. Redemption goes through the same
 * single-redemption path as the success page (redeemSession and its Durable Object claim), so
 * the key is shown once in total, to whichever asks first. The token is never logged.
 */
import {
  billingDeps,
  json,
  logStripeError,
  redeemSession,
  siteUrl,
  type BillingDeps,
  type RedeemedBy,
} from "./billing.ts";
import { CONTACT } from "./contact.ts";
import { hashKey, keyId, randomToken } from "./keys.ts";
import { PLANS } from "./plans.ts";
import { StripeError } from "./stripe.ts";
import type { Env } from "./types.ts";

/** How long a claim (and the agent's checkout session) lasts. */
export const CLAIM_TTL_SECONDS = 60 * 60;
/** KV keeps the claim this much longer, so a payment finished in the last minute is collected. */
export const CLAIM_GRACE_SECONDS = 15 * 60;
/** Polls per token: one every this many milliseconds. */
export const CLAIM_POLL_MS = 2_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

interface ClaimRecord {
  session: string;
  /** ISO. */
  expires_at: string;
  /** Set once the key was collected through this claim or the page. */
  claimed_by?: RedeemedBy;
}

export interface NewClaim {
  token: string;
  id: string;
  hash: string;
  expiresAt: number;
}

/** A fresh claim token (not stored yet: the checkout session id comes first). */
export async function newClaim(now: number): Promise<NewClaim> {
  const token = randomToken();
  const hash = await hashKey(token);
  return {
    token,
    hash,
    id: keyId(hash),
    expiresAt: Math.floor(now / 1000) + CLAIM_TTL_SECONDS,
  };
}

export async function storeClaim(
  env: Env,
  claim: NewClaim,
  sessionId: string,
): Promise<void> {
  const rec: ClaimRecord = {
    session: sessionId,
    expires_at: new Date(claim.expiresAt * 1000).toISOString(),
  };
  await env.KEYS.put(`claim:${claim.hash}`, JSON.stringify(rec), {
    expirationTtl: CLAIM_TTL_SECONDS + CLAIM_GRACE_SECONDS,
  });
}

export const claimUrl = (env: Env, token: string) =>
  `${(env.API_URL ?? "https://api.factlot.com").replace(/\/$/, "")}/v1/billing/claim/${token}`;

function notFound(): Response {
  return json(404, {
    error: "NotFound",
    code: "NotFound",
    status: "not_found",
    message:
      "No checkout claim with this URL: it is mistyped or expired (claims last an hour). Start a new checkout with POST /v1/billing/checkout.",
    next: "POST /v1/billing/checkout",
  });
}

/** GET /v1/billing/claim/<token>. Rate limits (per address, per token) are applied by the caller. */
export async function claimRoute(
  env: Env,
  token: string,
  opts: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    defer?: BillingDeps["defer"];
  } = {},
): Promise<Response> {
  const now = opts.now ?? Date.now;
  if (!TOKEN_RE.test(token)) return notFound();
  const hash = await hashKey(token);
  const raw = await env.KEYS.get(`claim:${hash}`);
  if (!raw) return notFound();
  const rec = JSON.parse(raw) as ClaimRecord;
  const gone = (by: RedeemedBy) =>
    json(410, {
      error: "Claimed",
      code: "Claimed",
      status: "claimed",
      by,
      message:
        by === "agent"
          ? "This key was already collected through this claim URL. It is shown once."
          : "The buyer's success page already showed this key. Ask your human to paste it into your secret store, or recover access at /account with the email they paid with.",
      next: `${siteUrl(env)}/account`,
    });
  if (rec.claimed_by) return gone(rec.claimed_by);
  const d = billingDeps(env, opts.fetchImpl, now, opts.defer);
  if (!d)
    return json(503, {
      error: "BillingNotOpen",
      code: "BillingNotOpen",
      message: `Billing is not configured. Email ${CONTACT}.`,
      next: `mailto:${CONTACT}`,
    });
  let result;
  try {
    result = await redeemSession(d, rec.session, "agent");
  } catch (err) {
    if (!(err instanceof StripeError)) logStripeError("claim redeem", err);
    return json(
      502,
      {
        error: "ServiceUnavailable",
        code: "ServiceUnavailable",
        message:
          "Stripe or the key store did not answer. Poll again in a few seconds; the payment is safe.",
        retry_after_seconds: 5,
        next: "poll this URL again",
      },
      { "retry-after": "5" },
    );
  }
  const remember = async (by: RedeemedBy) => {
    const left = Math.max(
      60,
      Math.floor(
        (Date.parse(rec.expires_at) - now()) / 1000 + CLAIM_GRACE_SECONDS,
      ),
    );
    try {
      await env.KEYS.put(
        `claim:${hash}`,
        JSON.stringify({ ...rec, claimed_by: by }),
        { expirationTtl: left },
      );
    } catch {
      // The Durable Object claim already decides; this marker only saves a Stripe call.
    }
  };
  if (result.ok) {
    await remember("agent");
    const plan = PLANS[result.plan];
    const site = siteUrl(env);
    const api = (env.API_URL ?? "https://api.factlot.com").replace(/\/$/, "");
    return json(200, {
      key: result.key,
      plan: plan.id,
      plan_name: plan.name,
      requests_per_minute: plan.requestsPerMinute,
      registry_lookups_per_month: plan.registryLookupsPerMonth,
      account: `${site}/account`,
      mcp: `${api}/mcp`,
      onboarding: `${api}/v1/onboarding?plan=${plan.id}`,
      note: "This key is shown once. Store it in your secret store now and send it as Authorization: Bearer <key>. It can take up to a minute to activate everywhere.",
    });
  }
  if (result.status === 409) {
    await remember(result.by ?? "page");
    return gone(result.by ?? "page");
  }
  const expired = now() > Date.parse(rec.expires_at);
  if (result.status === 402 && result.session_status === "payment_failed")
    return json(402, {
      error: "PaymentFailed",
      code: "PaymentFailed",
      status: "failed",
      message: result.message,
      next: "POST /v1/billing/checkout",
    });
  if (result.status === 202)
    return json(
      202,
      {
        status: "processing",
        message:
          "The bank payment is processing (1 to 4 business days). Poll at most every few minutes; the key comes once it clears.",
        retry_after_seconds: 600,
      },
      { "retry-after": "600" },
    );
  if (result.status === 402 && result.session_status === "open" && !expired)
    return json(
      202,
      {
        status: "pending",
        message:
          "Waiting for payment. Give your human the checkout url; poll this URL every few seconds.",
        expires_at: rec.expires_at,
        retry_after_seconds: CLAIM_POLL_MS / 1000,
      },
      { "retry-after": String(CLAIM_POLL_MS / 1000) },
    );
  // Expired, unknown or never paid.
  return notFound();
}
