/**
 * The free API key, issued by email.
 *
 *   POST /v1/keys/free  {email, accept_terms: true}   (also the form on /account, POST
 *   /account/free-key) always answers 202 {sent_if_valid: true}: the same for every address, so
 *   it tells nobody whether an address already has a key. The email goes out after the answer.
 *   GET  /account/free-key/<token>   a confirm page; it redeems nothing (link prefetchers)
 *   POST /account/free-key/<token>   redeems the link once: mints `fl_free_...`, shown once
 *
 * A free key has the anonymous tier's limits (plans.ts) but its own meter: `freekey:<id>`
 * instead of the caller's IP address, so people behind one NAT stop sharing a daily allowance.
 * Abuse limits: three keys minted per address a day, and one address's free keys together get at
 * most FREE_KEY_ADDRESS_LOOKUPS_PER_DAY lookups a day and the per-IP minute limit, whichever
 * key they use (router.ts).
 *
 * KV: `freekey:<sha256(key)>` {tier "free", email_hash, created, revoked_at?}; `freeemail:
 * <email_hash>` the current key's hash (one active key per address: a new one revokes the old);
 * `freelink:<sha256(id)>` the link's record (30 minutes); `freewait:<email_hash>` the resend
 * wait. The address itself is never stored or logged: only a salted hash of its lower case.
 * Links reuse the recovery signing secret under their own purpose string.
 */
import { CONTACT } from "./contact.ts";
import { sendEmail, freeKeyMessage } from "./email.ts";
import { json, siteUrl } from "./billing.ts";
import { hashKey, keyId, randomToken } from "./keys.ts";
import {
  EMAIL_RE,
  TOKEN_RE,
  sameString,
  sign,
  recoveryState,
} from "./recovery.ts";
import {
  freeKeyConfirmPage,
  freeKeyIssuedPage,
  freeKeySentPage,
  messagePage,
  FREE_KEY_SENT,
} from "./pages.ts";
import { FREE_KEY_ADDRESS_LOOKUPS_PER_DAY } from "./plans.ts";
import type { Env, KV } from "./types.ts";

export { FREE_KEY_ADDRESS_LOOKUPS_PER_DAY };

export const FREE_KEY_PREFIX = "fl_free_";
const FREE_KEY_RE = /^fl_free_[A-Za-z0-9_-]{43}$/;
export const FREE_KEY_LINK_TTL_SECONDS = 30 * 60;
/** One link email per address per this long. */
export const FREE_KEY_RESEND_SECONDS = 5 * 60;
/** Free keys minted per address per UTC day. */
export const FREE_KEY_MINTS_PER_ADDRESS_PER_DAY = 3;
const PURPOSE = "factlot-freekey";

export interface FreeKeyRecord {
  tier: "free";
  /** Salted SHA-256 of the lower-cased email (never the address). */
  email_hash: string;
  created: string;
  revoked_at?: string;
}

export interface FreeKeyCaller {
  hash: string;
  /** The meter subject of the key's own allowance. */
  subject: string;
  email_hash: string;
}

const REVOKED_RETENTION_SECONDS = 365 * 24 * 60 * 60;

export function isFreeKeyToken(token: string): boolean {
  return token.startsWith(FREE_KEY_PREFIX);
}

export function freeKeyState(env: Env) {
  return recoveryState(env);
}

async function emailHash(env: Env, email: string): Promise<string> {
  return hashKey(
    `factlot-freekey-email|${env.RECOVERY_SIGNING_SECRET ?? ""}|${email.trim().toLowerCase()}`,
  );
}

/** The key behind a bearer token, or undefined (unknown, malformed, revoked). */
export async function resolveFreeKey(
  env: Env,
  token: string,
): Promise<FreeKeyCaller | undefined> {
  if (!FREE_KEY_RE.test(token)) return undefined;
  const hash = await hashKey(token);
  const raw = await env.KEYS.get(`freekey:${hash}`);
  if (!raw) return undefined;
  const rec = JSON.parse(raw) as FreeKeyRecord;
  if (rec.revoked_at) return undefined;
  return {
    hash,
    subject: `freekey:${keyId(hash)}`,
    email_hash: rec.email_hash,
  };
}

interface LinkRecord {
  email_hash: string;
  expires_at: string;
  used_at?: string;
}

async function createLink(env: Env, eh: string, now: number): Promise<string> {
  const secret = env.RECOVERY_SIGNING_SECRET!;
  const id = randomToken();
  const rec: LinkRecord = {
    email_hash: eh,
    expires_at: new Date(now + FREE_KEY_LINK_TTL_SECONDS * 1000).toISOString(),
  };
  await env.KEYS.put(`freelink:${await hashKey(id)}`, JSON.stringify(rec), {
    expirationTtl: FREE_KEY_LINK_TTL_SECONDS,
  });
  return `${id}.${await sign(secret, id, PURPOSE)}`;
}

type Check =
  | { ok: true; hash: string; rec: LinkRecord }
  | { ok: false; why: "invalid" | "expired" | "used" };

async function checkLink(env: Env, token: string, now: number): Promise<Check> {
  const m = TOKEN_RE.exec(token);
  const secret = env.RECOVERY_SIGNING_SECRET;
  if (!m || !secret) return { ok: false, why: "invalid" };
  if (!sameString(m[2]!, await sign(secret, m[1]!, PURPOSE)))
    return { ok: false, why: "invalid" };
  const hash = await hashKey(m[1]!);
  const raw = await env.KEYS.get(`freelink:${hash}`);
  if (!raw) return { ok: false, why: "expired" };
  const rec = JSON.parse(raw) as LinkRecord;
  if (rec.used_at) return { ok: false, why: "used" };
  if (now > Date.parse(rec.expires_at)) return { ok: false, why: "expired" };
  return { ok: true, hash, rec };
}

/** The email, run after the answer is sent. */
async function sendLink(
  env: Env,
  email: string,
  now: () => number,
): Promise<void> {
  const kv: KV = env.KEYS;
  try {
    const eh = await emailHash(env, email);
    if (await kv.get(`freewait:${eh}`)) return;
    await kv.put(`freewait:${eh}`, "1", {
      expirationTtl: FREE_KEY_RESEND_SECONDS,
    });
    const url = `${siteUrl(env)}/account/free-key/${await createLink(env, eh, now())}`;
    await sendEmail(env, "freekey", {
      to: email,
      ...freeKeyMessage(url, FREE_KEY_LINK_TTL_SECONDS / 60),
    });
  } catch {
    console.error(JSON.stringify({ msg: "free key email failed" }));
  }
}

export interface FreeKeyOptions {
  now?: () => number;
  defer?: (work: Promise<unknown>) => void;
  /** The caller's day-salted address hash (router.ts addressSubject). */
  address: string;
  cors?: Record<string, string>;
}

const wantsJson = (request: Request) =>
  (request.headers.get("content-type") ?? "").includes("application/json");

function withCors(res: Response, cors?: Record<string, string>): Response {
  if (!cors) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/** POST /v1/keys/free and POST /account/free-key. The caller has rate-limited the address. */
export async function freeKeyRequestRoute(
  env: Env,
  request: Request,
  body: string,
  opts: FreeKeyOptions,
): Promise<Response> {
  const asJson = wantsJson(request);
  const now = opts.now ?? Date.now;
  const fail = (status: number, code: string, message: string) =>
    withCors(
      asJson
        ? json(status, {
            error: code,
            code,
            message,
            next: 'POST /v1/keys/free {"email":"you@example.com","accept_terms":true}',
          })
        : messagePage(status, "Get a free key", message, {
            next: { href: "/account#free-key", label: "Try again" },
          }),
      opts.cors,
    );
  if (freeKeyState(env) !== "on")
    return fail(
      503,
      "FreeKeyUnavailable",
      `Free keys by email are being set up; email ${CONTACT}.`,
    );
  let email = "";
  let accepted = false;
  try {
    if (asJson) {
      const b = JSON.parse(body) as { email?: unknown; accept_terms?: unknown };
      email = typeof b.email === "string" ? b.email : "";
      accepted = b.accept_terms === true;
    } else {
      const f = new URLSearchParams(body);
      email = f.get("email") ?? "";
      accepted = f.get("accept_terms") !== null;
    }
  } catch {
    // falls through to the 400 below
  }
  email = email.trim();
  if (email.length > 254 || !EMAIL_RE.test(email))
    return fail(400, "BadRequest", "Enter a valid email address.");
  if (!accepted)
    return fail(
      400,
      "TermsNotAccepted",
      "Accept the terms and privacy policy (accept_terms: true) to get a free key.",
    );
  const defer = opts.defer ?? ((w) => void w.catch(() => {}));
  defer(sendLink(env, email, now));
  return withCors(
    asJson
      ? json(202, { sent_if_valid: true, message: FREE_KEY_SENT })
      : freeKeySentPage(),
    opts.cors,
  );
}

const LINK_PROBLEM = {
  invalid:
    "This link is not valid. Copy the whole link from the email, or ask for a new one.",
  expired: "This link has expired (links last 30 minutes). Ask for a new one.",
  used: "This link was already used. Ask for a new one if you need another key.",
};

function linkProblem(why: keyof typeof LINK_PROBLEM): Response {
  return messagePage(
    why === "invalid" ? 404 : 410,
    "Get a free key",
    LINK_PROBLEM[why],
    { next: { href: "/account#free-key", label: "Email me a new link" } },
  );
}

/** GET (confirm page) or POST (redeem) /account/free-key/<token>. */
export async function freeKeyLinkRoute(
  env: Env,
  request: Request,
  token: string,
  opts: FreeKeyOptions,
): Promise<Response> {
  const now = opts.now ?? Date.now;
  if (freeKeyState(env) !== "on")
    return messagePage(
      503,
      "Get a free key",
      `Free keys by email are being set up; email ${CONTACT}.`,
    );
  const check = await checkLink(env, token, now());
  if (!check.ok) return linkProblem(check.why);
  // Only a POST redeems: a GET or HEAD from a prefetcher or preview bot shows the button.
  if (request.method !== "POST") return freeKeyConfirmPage(token);
  // Three keys per address a day (taken before the link is spent, so a refusal keeps the link).
  const mint = await env.METER.consume(`freemint:${opts.address}`, {
    kind: "day",
    limit: FREE_KEY_MINTS_PER_ADDRESS_PER_DAY,
    n: 1,
  });
  if (mint.granted < 1)
    return messagePage(
      429,
      "Get a free key",
      `Free keys are limited to ${FREE_KEY_MINTS_PER_ADDRESS_PER_DAY} a day per network address. Try again tomorrow (00:00 UTC), or open this link from another connection while it is valid.`,
    );
  // Once, even when two clicks race: the Durable Object claim decides.
  const mine = randomToken();
  if ((await env.METER.claim(`freelink:${check.hash}`, mine)) !== mine) {
    if (mint.quota)
      await env.METER.refund(
        "freemint:" + opts.address,
        "day",
        1,
        mint.quota.resets_at,
      ).catch(() => {});
    return linkProblem("used");
  }
  await env.KEYS.put(
    `freelink:${check.hash}`,
    JSON.stringify({ ...check.rec, used_at: new Date(now()).toISOString() }),
    { expirationTtl: FREE_KEY_LINK_TTL_SECONDS },
  );
  const key = FREE_KEY_PREFIX + randomToken();
  const hash = await hashKey(key);
  const eh = check.rec.email_hash;
  // One active key per address: the previous one stops working.
  const prev = await env.KEYS.get(`freeemail:${eh}`);
  if (prev && prev !== hash) {
    const raw = await env.KEYS.get(`freekey:${prev}`);
    if (raw) {
      const old = JSON.parse(raw) as FreeKeyRecord;
      old.revoked_at = new Date(now()).toISOString();
      await env.KEYS.put(`freekey:${prev}`, JSON.stringify(old), {
        expirationTtl: REVOKED_RETENTION_SECONDS,
      });
    }
  }
  const rec: FreeKeyRecord = {
    tier: "free",
    email_hash: eh,
    created: new Date(now()).toISOString(),
  };
  await env.KEYS.put(`freekey:${hash}`, JSON.stringify(rec));
  await env.KEYS.put(`freeemail:${eh}`, hash);
  return freeKeyIssuedPage({
    key,
    replaced: prev !== null && prev !== hash,
    api: env.API_URL ?? "https://api.factlot.com",
    site: siteUrl(env),
  });
}
