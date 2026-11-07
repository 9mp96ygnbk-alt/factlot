/**
 * Account recovery by email, for a buyer who lost every key.
 *
 *   POST /account/recover  {email}          always "If that email has a FactLot subscription, a
 *                                           link is on its way" (no enumeration; the lookup and
 *                                           the email run after the answer, so timing says
 *                                           nothing either)
 *   GET  /account/recover/<token>           the account (plan, usage, keys) and "Issue a new key"
 *   POST /account/recover/<token>           action=issue: a new key, shown once; the link is used
 *                                           action=portal: Stripe's billing portal (link kept)
 *
 * Lookup: Stripe customers with that email (GET /v1/customers?email=, exact match, also tried
 * in lower case), their subscriptions, and only subscriptions with keys in KV. Each gets its own
 * link in one email. A link is `<id>.<sig>`: 256 random bits and an HMAC-SHA256 of them under
 * the RECOVERY_SIGNING_SECRET Worker secret, so a forged link is refused before KV is read. KV
 * keeps `recover:<sha256(id)>` (subscription, expiry) for 15 minutes; a Durable Object claim
 * makes "issue" work once even when two clicks race. Email addresses, links and tokens are never
 * logged, and an address gets at most one email every 5 minutes.
 *
 * Off (the form says so) until both the Email Service binding (EMAIL) and the secret are set.
 */
import {
  accountSummary,
  billingDeps,
  json,
  logStripeError,
  mintKey,
  portalUrl,
  rotateKey,
  siteUrl,
  type BillingDeps,
} from "./billing.ts";
import { CONTACT } from "./contact.ts";
import { recoveryMessage, sendEmail } from "./email.ts";
import {
  base64url,
  deriveStatus,
  hashKey,
  keyId,
  liveKeys,
  randomToken,
  type KeyRecord,
} from "./keys.ts";
import {
  RECOVERY_SENT,
  RECOVERY_SETUP_NOTICE,
  messagePage,
  onboardingPage,
  recoveryPage,
  recoverySentPage,
  type RecoveryState,
} from "./pages.ts";
import { PLANS } from "./plans.ts";
import type { Env } from "./types.ts";

export const RECOVERY_TTL_SECONDS = 15 * 60;
/** One recovery email per address per this long. */
export const RECOVERY_RESEND_SECONDS = 5 * 60;
/** At most this many subscriptions (links) in one email. */
const MAX_LINKS = 5;

const TOKEN_RE = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,252}\.[^\s@<>"]{2,}$/;

export function recoveryState(env: Env): RecoveryState {
  if (!env.EMAIL) return "no-email";
  if (!env.RECOVERY_SIGNING_SECRET) return "no-secret";
  return "on";
}

async function sign(secret: string, id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`factlot-recover|${id}`),
      ),
    ),
  );
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface RecoveryRecord {
  subscription: string;
  /** ISO. */
  expires_at: string;
  used_at?: string;
}

/** A signed, single-use link token for one subscription, stored for 15 minutes. */
export async function createRecoveryToken(
  env: Env,
  subscription: string,
  now: number,
): Promise<string> {
  const secret = env.RECOVERY_SIGNING_SECRET;
  if (!secret) throw new Error("RECOVERY_SIGNING_SECRET is not set");
  const id = randomToken();
  const rec: RecoveryRecord = {
    subscription,
    expires_at: new Date(now + RECOVERY_TTL_SECONDS * 1000).toISOString(),
  };
  await env.KEYS.put(`recover:${await hashKey(id)}`, JSON.stringify(rec), {
    expirationTtl: RECOVERY_TTL_SECONDS,
  });
  return `${id}.${await sign(secret, id)}`;
}

type TokenCheck =
  | { ok: true; hash: string; rec: RecoveryRecord }
  | { ok: false; why: "invalid" | "expired" | "used" };

export async function checkRecoveryToken(
  env: Env,
  token: string,
  now: number,
): Promise<TokenCheck> {
  const m = TOKEN_RE.exec(token);
  const secret = env.RECOVERY_SIGNING_SECRET;
  if (!m || !secret) return { ok: false, why: "invalid" };
  if (!sameString(m[2]!, await sign(secret, m[1]!)))
    return { ok: false, why: "invalid" };
  const hash = await hashKey(m[1]!);
  const raw = await env.KEYS.get(`recover:${hash}`);
  if (!raw) return { ok: false, why: "expired" };
  const rec = JSON.parse(raw) as RecoveryRecord;
  if (rec.used_at) return { ok: false, why: "used" };
  if (now > Date.parse(rec.expires_at)) return { ok: false, why: "expired" };
  return { ok: true, hash, rec };
}

/** The subscriptions with FactLot keys that belong to Stripe customers with this email. */
export async function subscriptionsForEmail(
  d: BillingDeps,
  email: string,
): Promise<{ subscription: string; record: KeyRecord }[]> {
  const variants = [...new Set([email, email.toLowerCase()])];
  const customers = new Set<string>();
  for (const v of variants) {
    const found = (await d.stripe.get("/customers", {
      email: v,
      limit: 10,
    })) as {
      data?: { id?: unknown }[];
    };
    for (const c of found.data ?? [])
      if (typeof c.id === "string") customers.add(c.id);
  }
  const out: { subscription: string; record: KeyRecord }[] = [];
  for (const customer of customers) {
    const subs = (await d.stripe.get("/subscriptions", {
      customer,
      status: "all",
      limit: 20,
    })) as { data?: { id?: unknown }[] };
    for (const s of subs.data ?? []) {
      if (typeof s.id !== "string") continue;
      const keys = await liveKeys(d.env.KEYS, s.id);
      if (keys.length > 0 && out.length < MAX_LINKS)
        out.push({ subscription: s.id, record: keys[keys.length - 1]!.record });
    }
  }
  return out;
}

/** The lookup and the email, run after the answer is sent. */
export async function sendRecovery(
  d: BillingDeps,
  email: string,
): Promise<void> {
  const kv = d.env.KEYS;
  const wait = `recoverwait:${await hashKey(email.toLowerCase())}`;
  try {
    if (await kv.get(wait)) return;
    await kv.put(wait, "1", { expirationTtl: RECOVERY_RESEND_SECONDS });
    const subs = await subscriptionsForEmail(d, email);
    if (subs.length === 0) return;
    const site = siteUrl(d.env);
    const links = [];
    for (const s of subs)
      links.push({
        plan: PLANS[s.record.plan],
        url: `${site}/account/recover/${await createRecoveryToken(d.env, s.subscription, d.now())}`,
      });
    await sendEmail(d.env, "recovery", {
      to: email,
      ...recoveryMessage(links, RECOVERY_TTL_SECONDS / 60),
    });
  } catch (err) {
    logStripeError("recovery lookup", err);
  }
}

export interface RecoveryOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  defer?: BillingDeps["defer"];
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes(
    "application/json",
  );
}

/** POST /account/recover (form or JSON {email}). The caller has rate-limited the address. */
export async function recoverRequestRoute(
  env: Env,
  request: Request,
  body: string,
  opts: RecoveryOptions = {},
): Promise<Response> {
  const asJson = wantsJson(request);
  const state = recoveryState(env);
  const d = billingDeps(env, opts.fetchImpl, opts.now, opts.defer);
  if (state !== "on" || !d)
    return asJson
      ? json(503, {
          error: "RecoveryUnavailable",
          code: "RecoveryUnavailable",
          message: RECOVERY_SETUP_NOTICE,
          next: `mailto:${CONTACT}`,
        })
      : messagePage(503, "Recover your account", RECOVERY_SETUP_NOTICE, {
          next: { href: `mailto:${CONTACT}`, label: `Email ${CONTACT}` },
        });
  let email: string;
  try {
    email = asJson
      ? String((JSON.parse(body) as { email?: unknown }).email ?? "")
      : (new URLSearchParams(body).get("email") ?? "");
  } catch {
    email = "";
  }
  email = email.trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    const message = "Enter the email address you paid with.";
    return asJson
      ? json(400, {
          error: "BadRequest",
          code: "BadRequest",
          message,
          next: 'POST /account/recover {"email":"you@example.com"}',
        })
      : messagePage(400, "Recover your account", message, {
          next: { href: "/account#recover", label: "Try again" },
        });
  }
  d.defer(sendRecovery(d, email));
  return asJson
    ? json(202, { status: "sent_if_known", message: RECOVERY_SENT })
    : recoverySentPage();
}

const LINK_PROBLEM = {
  invalid:
    "This recovery link is not valid. Copy the whole link from the email, or ask for a new one.",
  expired:
    "This recovery link has expired (links last 15 minutes). Ask for a new one.",
  used: "This recovery link was already used to issue a key. Ask for a new one if you need another.",
};

function linkProblem(why: keyof typeof LINK_PROBLEM): Response {
  return messagePage(
    why === "invalid" ? 404 : 410,
    "Recover your account",
    LINK_PROBLEM[why],
    { next: { href: "/account#recover", label: "Email me a new link" } },
  );
}

/** GET or POST /account/recover/<token>. POSTs have passed the same-origin check. */
export async function recoverLinkRoute(
  env: Env,
  request: Request,
  token: string,
  body: string | undefined,
  opts: RecoveryOptions = {},
): Promise<Response> {
  const now = opts.now ?? Date.now;
  if (recoveryState(env) !== "on")
    return messagePage(503, "Recover your account", RECOVERY_SETUP_NOTICE);
  const check = await checkRecoveryToken(env, token, now());
  if (!check.ok) return linkProblem(check.why);
  const keys = await liveKeys(env.KEYS, check.rec.subscription);
  if (keys.length === 0)
    return messagePage(
      404,
      "Recover your account",
      `This subscription has no keys left. Email ${CONTACT}.`,
    );
  const newest = keys[keys.length - 1]!;
  const plan = PLANS[newest.record.plan];
  const atLimit = keys.length >= plan.maxKeys;
  const oldest = keys[0]!;
  const summary = await accountSummary(env, newest.hash, newest.record);
  summary.keys.items = summary.keys.items.map((k) => ({
    ...k,
    current: false,
  }));
  const replaces = atLimit ? keyId(oldest.hash) : undefined;
  if (request.method !== "POST")
    return recoveryPage(summary, token, { replaces });
  const action = new URLSearchParams(body ?? "").get("action");
  if (action === "portal") {
    const d = billingDeps(env, opts.fetchImpl, now);
    try {
      if (!d) throw new Error("billing not configured");
      return new Response(null, {
        status: 303,
        headers: {
          location: await portalUrl(d, newest.record),
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      logStripeError("portal session", err);
      return recoveryPage(summary, token, {
        replaces,
        status: 502,
        notice: `Stripe did not answer. Try again in a minute, or email ${CONTACT}.`,
      });
    }
  }
  if (action !== "issue") return recoveryPage(summary, token, { replaces });
  if (deriveStatus(newest.record) !== "active")
    return recoveryPage(summary, token, {
      replaces,
      status: 403,
      notice: "Keys can be issued only while the subscription is active.",
    });
  // Once, even when two clicks race: the Durable Object claim decides.
  const mine = randomToken();
  if ((await env.METER.claim(`recover:${check.hash}`, mine)) !== mine)
    return linkProblem("used");
  await env.KEYS.put(
    `recover:${check.hash}`,
    JSON.stringify({ ...check.rec, used_at: new Date(now()).toISOString() }),
    { expirationTtl: RECOVERY_TTL_SECONDS },
  );
  const deps = { env, now };
  let key: string;
  let note: string;
  if (atLimit) {
    key = await rotateKey(deps, oldest.hash, oldest.record);
    note = `Key ${keyId(oldest.hash)} no longer works (allow a minute everywhere); this new key replaces it.`;
  } else {
    const minted = await mintKey(deps, newest.record);
    if (!minted.ok) {
      key = await rotateKey(deps, oldest.hash, oldest.record);
      note = `Key ${keyId(oldest.hash)} no longer works (allow a minute everywhere); this new key replaces it.`;
    } else {
      key = minted.key;
      note = "Your other keys keep working.";
    }
  }
  return onboardingPage({
    key,
    plan,
    api: env.API_URL ?? "https://api.factlot.com",
    site: siteUrl(env),
    notice: { title: "Access recovered", text: note },
  });
}
