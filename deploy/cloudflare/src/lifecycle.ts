/**
 * Lifecycle emails: the messages that carry a person from a first try to a paid plan, and the
 * rules that decide what may be sent. Dark unless the Worker variable LIFECYCLE_EMAILS_ENABLED is
 * exactly "true": with it off no lifecycle message is sent, the consent boxes are not shown and
 * the stop and consent routes answer 404 like the repo's other dark features.
 *
 * Two classes (lifecycle-copy.ts, MESSAGES):
 * - Transactional (A0 the key link email, B0 the welcome email): sent because of what the person
 *   did or bought, no consent beyond the request. They do not go through this file's gate.
 * - Promotional (A1 to A4 for a free key, B1 and B2 for a plan): sent only to an address whose
 *   owner ticked the separate consent box (unticked by default), at most PROMO_DAILY_CAP a day and
 *   once per person per message, never to a stopped address, always with the postal address and a
 *   one-click stop link in the footer and in the List-Unsubscribe headers.
 *
 * KV (the KEYS namespace):
 *   lc:<kind>:<h>    consent record, kind "free" or "paid", h the salted address hash that
 *                    freekey.ts uses: {to, consent_at, subject, key_hash or subscription, since}. It
 *                    holds the address because mail cannot be sent without it, and only for someone
 *                    who ticked the box. Deleted by a stop (and whenever a stop marker is seen for
 *                    its hash), by deleting the free key (whether or not this feature is on), by
 *                    the plan's cancellation (the Stripe webhook, through lcsub:), and by the
 *                    sweep when a due item finds the key or plan gone. It is never written back
 *                    after a send (the sent markers live elsewhere), so a stop cannot be undone by
 *                    a send in flight.
 *   lcsub:<subscription>  the address hash of a plan's consent record, so the cancellation webhook
 *                    can delete it. Deleted with the record.
 *   lcdue:<yyyymmddhh>:<kind>:<h>:<id>  one time-based message's due hour (A2, A4, B1, B2), written
 *                    with the consent record; empty value. The sweep lists this prefix in date
 *                    order, handles what is due and deletes it; KV deletes it on its own
 *                    DUE_UNTIL_DAYS + 2 days after it falls due, as a backstop.
 *   lcmark:<kind>:<h> which messages were sent (time) or failed ("failed:<time>"): ids and times
 *                    only, no address. A failed message is marked so it stops being due. Written
 *                    with a MARK_TTL_DAYS expiry (the once-only claims last as long), so a mark
 *                    written after a concurrent stop does not stay for good.
 *   lcstop:<h>       suppression: the time of the stop and nothing else (the hash, no address). Kept
 *                    for good; deleting a key does not remove it, and a new key request or a new
 *                    consent cannot undo it.
 * Durable Object claims (strongly consistent): `lcsent:<d>` once per person per message and
 * `lccap:<d>` the day's one optional message, where d is a SHA-256 of the address hash with the
 * message id or the day, so a claim never holds the address hash itself. Claims are kept 395 days
 * (limiter.ts CLAIM_TTL_MS) and are not deleted by a stop or a key deletion.
 *
 * Secret rotation: every hash here (and every stop link already emailed) is keyed by
 * RECOVERY_SIGNING_SECRET. Rotating it orphans the stop markers and the consent records and breaks
 * the stop links in mail already sent, so a stopped address could be mailed again. Do not rotate
 * it while this feature is on without first exporting and re-keying the stop markers.
 *
 * Triggers: A1 and A3 fire from the router (a free key's answer that left something out; its daily
 * lookups running out); A2, A4, B1 and B2 are time based and run from `lifecycleSweep`, which the
 * Worker's scheduled handler calls every hour (scheduled.ts LIFECYCLE_CRON; no cron is configured:
 * the owner adds it when switching on).
 *
 * Nothing here logs an address, link or key.
 */
import { billingDeps, siteUrl, type BillingDeps } from "./billing.ts";
import { sendEmail } from "./email.ts";
import {
  DUE_AFTER_DAYS,
  DUE_UNTIL_DAYS,
  checkConsentProof,
  PROMO_DAILY_CAP,
  freeWeekMessage,
  lifecycleEnabled,
  limitReachedMessage,
  paidWeekMessage,
  unusedFreeMessage,
  unusedPaidMessage,
  withheldMessage,
  type Built,
  type MessageId,
  type PromoContext,
  type UsageFacts,
  type WithheldFacts,
} from "./lifecycle-copy.ts";
import {
  deriveStatus,
  hashKey,
  liveKeys,
  randomToken,
  type KeyRecord,
} from "./keys.ts";
import { escapeHtml, page, messagePage } from "./pages.ts";
import { PLANS, isPlanId, type PlanId } from "./plans.ts";
import { EMAIL_RE } from "./recovery.ts";
import { hmacSha256Hex } from "./stripe.ts";
import type { Env, UsageSummary } from "./types.ts";

export { lifecycleEnabled };

/** The salted hash of a lower-cased address: the same value freekey.ts keys its records by. */
export async function addressHash(env: Env, email: string): Promise<string> {
  return hashKey(
    `factlot-freekey-email|${env.RECOVERY_SIGNING_SECRET ?? ""}|${email.trim().toLowerCase()}`,
  );
}

export type Kind = "free" | "paid";

export interface LifecycleRecord {
  v: 1;
  kind: Kind;
  /** The address, kept only because a note cannot be sent without it. */
  to: string;
  consent_at: string;
  /** The meter subject whose usage the time-based messages read. */
  subject: string;
  /** Free: the hash of the current free key. */
  key_hash?: string;
  /** Paid: the subscription id. */
  subscription?: string;
  plan?: PlanId;
  /** ISO: when the key or the plan began. */
  since: string;
}

/** Sent messages: the time, or "failed:<time>" for one whose send failed. */
export type Marks = Partial<Record<MessageId, string>>;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

const recordKey = (kind: Kind, h: string) => `lc:${kind}:${h}`;
const stopKey = (h: string) => `lcstop:${h}`;
const markKey = (kind: Kind, h: string) => `lcmark:${kind}:${h}`;
const subKey = (subscription: string) => `lcsub:${subscription}`;
const DUE_PREFIX = "lcdue:";
/** The due hour of a time: the next whole hour UTC (yyyymmddhh), so "due" never comes early. */
const dueHour = (ms: number) =>
  new Date(Math.ceil(ms / 3_600_000) * 3_600_000)
    .toISOString()
    .slice(0, 13)
    .replace(/[-T]/g, "");
const dueKey = (at: number, kind: Kind, h: string, id: MessageId) =>
  `${DUE_PREFIX}${dueHour(at)}:${kind}:${h}:${id}`;
/** How long a sent mark is kept: as long as the once-only claims (limiter.ts CLAIM_TTL_MS). */
export const MARK_TTL_DAYS = 395;

/** The two time-based messages of a record, with the time each falls due. */
function dueItems(kind: Kind, since: number): { id: MessageId; at: number }[] {
  return kind === "free"
    ? [
        { id: "A2", at: since + DUE_AFTER_DAYS.A2 * DAY_MS },
        { id: "A4", at: since + DUE_AFTER_DAYS.A4 * DAY_MS },
      ]
    : [
        { id: "B1", at: since + DUE_AFTER_DAYS.B1 * DAY_MS },
        { id: "B2", at: since + DUE_AFTER_DAYS.B2 * DAY_MS },
      ];
}

/**
 * Delete a consent record and everything kept beside it (marks, due items, the plan pointer).
 * `rec` is the record when already read; otherwise it is read here to find its due items.
 */
async function dropRecord(
  env: Env,
  kind: Kind,
  h: string,
  rec?: LifecycleRecord,
): Promise<void> {
  rec ??= await readRecord(env, kind, h);
  await env.KEYS.delete(recordKey(kind, h));
  await env.KEYS.delete(markKey(kind, h));
  if (rec) {
    const since = Date.parse(rec.since);
    if (Number.isFinite(since))
      for (const d of dueItems(kind, since))
        await env.KEYS.delete(dueKey(d.at, kind, h, d.id));
    if (rec.subscription) {
      if ((await env.KEYS.get(subKey(rec.subscription))) === h)
        await env.KEYS.delete(subKey(rec.subscription));
    }
  }
}

async function readMarks(env: Env, kind: Kind, h: string): Promise<Marks> {
  const raw = await env.KEYS.get(markKey(kind, h));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Marks;
  } catch {
    return {};
  }
}

async function writeMark(
  env: Env,
  kind: Kind,
  h: string,
  id: MessageId,
  value: string,
): Promise<void> {
  const marks = await readMarks(env, kind, h);
  marks[id] = value;
  await env.KEYS.put(markKey(kind, h), JSON.stringify(marks), {
    expirationTtl: MARK_TTL_DAYS * 86_400,
  });
}

/** A claim name that does not contain the address hash itself. */
async function claimName(prefix: string, h: string, part: string) {
  return `${prefix}:${(await hashKey(`${prefix}|${h}|${part}`)).slice(0, 32)}`;
}

async function readRecord(
  env: Env,
  kind: Kind,
  h: string,
): Promise<LifecycleRecord | undefined> {
  const raw = await env.KEYS.get(recordKey(kind, h));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as LifecycleRecord;
  } catch {
    return undefined;
  }
}

export async function isSuppressed(env: Env, h: string): Promise<boolean> {
  return (await env.KEYS.get(stopKey(h))) !== null;
}

/** Everything needed to print a note's footer, or undefined when notes cannot be sent. */
function promoContext(
  env: Env,
  h: string,
  kind: Kind,
): Promise<PromoContext> | undefined {
  const address = env.POSTAL_ADDRESS?.trim().replace(/\s+/g, " ");
  if (
    !lifecycleEnabled(env) ||
    !env.EMAIL ||
    !env.RECOVERY_SIGNING_SECRET ||
    !address
  )
    return undefined;
  return stopUrl(env, h).then((url) => ({
    site: siteUrl(env),
    api: (env.API_URL ?? "https://api.factlot.com").replace(/\/$/, ""),
    stopUrl: url,
    address,
    audience: kind,
  }));
}

// --- Stop link ----------------------------------------------------------------------------------

const STOP_PURPOSE = "factlot-lifecycle-stop";
const STOP_TOKEN = /^([0-9a-f]{64})\.([0-9a-f]{64})$/;

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function stopSignature(secret: string, h: string): Promise<string> {
  return hmacSha256Hex(secret, `${STOP_PURPOSE}|${h}`);
}

/** The stop link of one address hash: signed, for stopping only, and it does not expire. */
export async function stopUrl(env: Env, h: string): Promise<string> {
  const secret = env.RECOVERY_SIGNING_SECRET ?? "";
  return `${siteUrl(env)}/account/stop/${h}.${await stopSignature(secret, h)}`;
}

/** The address hash a stop token is for, or undefined when it is malformed or forged. */
export async function checkStopToken(
  env: Env,
  token: string,
): Promise<string | undefined> {
  const m = STOP_TOKEN.exec(token);
  const secret = env.RECOVERY_SIGNING_SECRET;
  if (!m || !secret) return undefined;
  return sameString(m[2]!, await stopSignature(secret, m[1]!))
    ? m[1]
    : undefined;
}

/**
 * Stop the optional emails for an address hash for good: write the suppression marker and delete
 * the consent records (and with them the address). Idempotent. Returns whether it was already so.
 */
export async function stopEmails(
  env: Env,
  h: string,
  now: number,
): Promise<{ already: boolean }> {
  const already = await isSuppressed(env, h);
  if (!already) await env.KEYS.put(stopKey(h), new Date(now).toISOString());
  for (const kind of ["free", "paid"] as const) await dropRecord(env, kind, h);
  return { already };
}

/**
 * Free key deletion removes the consent record (and the address in it), whether or not this
 * feature is on, so turning it off never strands an address: two KV deletes. Its due items expire
 * on their own, and the sweep drops any it meets. The suppression marker stays.
 */
export async function forgetFreeConsent(env: Env, h: string): Promise<void> {
  await env.KEYS.delete(recordKey("free", h));
  await env.KEYS.delete(markKey("free", h));
}

/**
 * A cancelled plan: delete its consent record through the subscription's pointer. Run by the
 * Stripe webhook whether or not this feature is on (one KV read when there is no record).
 */
export async function forgetPaidConsent(
  env: Env,
  subscription: string,
): Promise<void> {
  const h = await env.KEYS.get(subKey(subscription));
  if (!h) return;
  const rec = await readRecord(env, "paid", h);
  if (!rec || rec.subscription === subscription)
    await dropRecord(env, "paid", h, rec);
  await env.KEYS.delete(subKey(subscription));
}

// --- Consent ------------------------------------------------------------------------------------

export interface ConsentInput {
  kind: Kind;
  h: string;
  /** The address; needed unless a record already exists to update. */
  to?: string;
  subject: string;
  keyHash?: string;
  subscription?: string;
  plan?: PlanId;
  now: number;
}

/**
 * Record (or refresh) the consent of an address. Nothing is written when the feature is off or
 * the address was stopped. With no `to`, only an existing record is refreshed (a new free key for
 * an address that already consented). The consent timestamp of an existing record is kept.
 */
export async function recordConsent(
  env: Env,
  c: ConsentInput,
): Promise<"recorded" | "refreshed" | "suppressed" | "off" | "none"> {
  if (!lifecycleEnabled(env)) return "off";
  if (await isSuppressed(env, c.h)) {
    // A record written meanwhile elsewhere does not survive the stop.
    await dropRecord(env, c.kind, c.h);
    return "suppressed";
  }
  const existing = await readRecord(env, c.kind, c.h);
  if (!existing && !c.to) return "none";
  const iso = new Date(c.now).toISOString();
  const rec: LifecycleRecord = existing
    ? {
        ...existing,
        subject: c.subject,
        ...(c.keyHash ? { key_hash: c.keyHash } : {}),
        ...(c.subscription ? { subscription: c.subscription } : {}),
        ...(c.plan ? { plan: c.plan } : {}),
      }
    : {
        v: 1,
        kind: c.kind,
        to: c.to!,
        consent_at: iso,
        subject: c.subject,
        ...(c.keyHash ? { key_hash: c.keyHash } : {}),
        ...(c.subscription ? { subscription: c.subscription } : {}),
        ...(c.plan ? { plan: c.plan } : {}),
        since: iso,
      };
  await env.KEYS.put(recordKey(c.kind, c.h), JSON.stringify(rec));
  if (!existing) {
    // The time-based messages, indexed by when they fall due.
    for (const d of dueItems(c.kind, c.now))
      await env.KEYS.put(dueKey(d.at, c.kind, c.h, d.id), "", {
        expirationTtl: Math.max(
          60,
          Math.ceil((d.at - c.now) / 1000) + (DUE_UNTIL_DAYS + 2) * 86_400,
        ),
      });
  }
  if (c.kind === "paid" && rec.subscription)
    await env.KEYS.put(subKey(rec.subscription), c.h);
  // A stop that landed while this ran must win: look again and take the record back out.
  if (await isSuppressed(env, c.h)) {
    await dropRecord(env, c.kind, c.h, rec);
    return "suppressed";
  }
  return existing ? "refreshed" : "recorded";
}

// --- Sending ------------------------------------------------------------------------------------

export type SendResult =
  | "sent"
  | "off"
  | "not-ready"
  | "no-consent"
  | "suppressed"
  | "already"
  | "cap"
  | "failed";

/**
 * The gate every optional message passes: feature on and sendable, a consent record, not stopped,
 * not sent before, and the day's one optional message not yet used. The cap and the once-only
 * marker are Durable Object claims, so two requests at the same moment cannot both send. A send
 * that fails is not retried (at most once means at most once).
 */
export async function deliverPromo(
  env: Env,
  kind: Kind,
  h: string,
  id: MessageId,
  now: number,
  build: (rec: LifecycleRecord, ctx: PromoContext) => Built | undefined,
): Promise<SendResult> {
  if (!lifecycleEnabled(env)) return "off";
  // The cheap checks first: no stop marker, a consent record, not sent (or failed) before.
  if (await isSuppressed(env, h)) {
    await dropRecord(env, kind, h);
    return "suppressed";
  }
  const rec = await readRecord(env, kind, h);
  if (!rec) return "no-consent";
  const ctx = await promoContext(env, h, kind);
  if (!ctx) return "not-ready";
  if ((await readMarks(env, kind, h))[id]) return "already";
  const built = build(rec, ctx);
  if (!built) return "no-consent";
  // The day's cap: the first optional message of the day takes it; the same message may retry.
  const day = dayOf(now);
  const cap = await env.METER.claim(await claimName("lccap", h, day), id);
  if (PROMO_DAILY_CAP === 1 && cap !== id) return "cap";
  const mine = randomToken();
  if (
    (await env.METER.claim(await claimName("lcsent", h, id), mine)) !== mine
  ) {
    // Sent (or tried) before, by another run: stop it being due.
    await writeMark(env, kind, h, id, `claimed:${new Date(now).toISOString()}`);
    return "already";
  }
  // A stop during the claims above wins.
  if (await isSuppressed(env, h)) {
    await dropRecord(env, kind, h, rec);
    return "suppressed";
  }
  let ok: boolean;
  try {
    ok = await sendEmail(env, "lifecycle", {
      to: rec.to,
      ...built,
      headers: {
        "List-Unsubscribe": `<${ctx.stopUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch {
    ok = false;
  }
  // Mark it either way, so a failed message stops being due and cannot keep taking the day's slot.
  // The consent record is not touched: a stop in flight stays stopped.
  const stamp = new Date(now).toISOString();
  await writeMark(env, kind, h, id, ok ? stamp : `failed:${stamp}`).catch(
    () => undefined,
  );
  return ok ? "sent" : "failed";
}

// --- Event triggers (router hooks) ---------------------------------------------------------------

type Json = Record<string, unknown>;

/** The parcel URN a registry request named, from a REST body (text) or an MCP tools/call message. */
export function urnOfRequest(raw: unknown): string | undefined {
  let body = raw;
  if (typeof raw === "string") {
    try {
      body = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  const item = Array.isArray(body) ? body[0] : body;
  if (typeof item !== "object" || item === null) return undefined;
  const m = item as Json;
  const args =
    (m.params as { arguments?: unknown } | undefined)?.arguments ?? m;
  const urn = (args as Json | null)?.urn;
  return typeof urn === "string" && /^fl:parcel:us-\d{5}:[a-z0-9-]+$/.test(urn)
    ? urn
    : undefined;
}

/** What the gated answer(s) of a 200 response left out, or undefined when nothing was. */
export async function withheldOf(
  res: Response,
  surface: "mcp" | "rest",
): Promise<WithheldFacts | undefined> {
  let parsed: unknown;
  try {
    parsed = await res.clone().json();
  } catch {
    return undefined;
  }
  const out: WithheldFacts = {};
  const years = new Set<number>();
  for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
    const answer =
      surface === "rest"
        ? m
        : (m as { result?: { structuredContent?: unknown } } | null)?.result
            ?.structuredContent;
    if (typeof answer !== "object" || answer === null) continue;
    const a = answer as Json;
    const w = (a.history_withheld ??
      (a.subject as Json | undefined)?.history_withheld) as
      { tax_years?: unknown; facts?: unknown } | undefined;
    if (w) {
      if (Array.isArray(w.tax_years))
        for (const y of w.tax_years) if (typeof y === "number") years.add(y);
      if (typeof w.facts === "number") out.facts = (out.facts ?? 0) + w.facts;
    }
    const p = a.portfolio_withheld as
      { count?: unknown; total?: unknown } | undefined;
    if (p && typeof p.count === "number" && typeof p.total === "number")
      out.portfolio = { count: p.count, total: p.total };
  }
  if (years.size > 0) out.years = [...years];
  return out.years || out.facts || out.portfolio ? out : undefined;
}

/**
 * A1: after a free key's gated answer. Cheap when the key's owner did not consent: one KV read.
 * `defer` runs the work after the response.
 */
export async function onFreeKeyAnswer(
  env: Env,
  freeKey: { email_hash: string },
  res: Response,
  surface: "mcp" | "rest",
  requestBody: unknown,
  defer: (work: Promise<unknown>) => void,
  now: number,
): Promise<void> {
  if (!lifecycleEnabled(env)) return;
  if (!(await env.KEYS.get(recordKey("free", freeKey.email_hash)))) return;
  const facts = await withheldOf(res, surface);
  if (!facts) return;
  const urn = urnOfRequest(requestBody);
  defer(
    deliverPromo(env, "free", freeKey.email_hash, "A1", now, (_r, ctx) =>
      withheldMessage(ctx, { ...facts, ...(urn ? { urn } : {}) }),
    ).catch(() => "failed"),
  );
}

/** A3: a free key's daily lookups ran out. Nothing but a consent check runs for a key without one. */
export function onFreeKeyLimit(
  env: Env,
  freeKey: { email_hash: string },
  quota: { limit: number; resets_at: string },
  defer: (work: Promise<unknown>) => void,
  now: number,
): void {
  if (!lifecycleEnabled(env)) return;
  defer(
    (async () => {
      if (!(await env.KEYS.get(recordKey("free", freeKey.email_hash)))) return;
      await deliverPromo(
        env,
        "free",
        freeKey.email_hash,
        "A3",
        now,
        (_r, ctx) =>
          limitReachedMessage(ctx, {
            limit: quota.limit,
            resetsAt: quota.resets_at,
          }),
      );
    })().catch(() => undefined),
  );
}

// --- The daily sweep (A2, A4, B1, B2) -------------------------------------------------------------

function usageFacts(u: UsageSummary): UsageFacts {
  return {
    lookups: u.total,
    tools: Object.entries(u.by_tool)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t),
  };
}

/**
 * The message a record is due for, given its age, what was sent, and whether its meter shows any
 * lookup since the key or plan began (undefined: none due). A message already sent or failed is
 * never due again.
 */
export function dueMessage(
  kind: Kind,
  marks: Marks,
  ageDays: number,
  used: boolean,
): MessageId | undefined {
  if (ageDays > DUE_UNTIL_DAYS) return undefined;
  const free = kind === "free";
  const firstId: MessageId = free ? "A2" : "B1";
  const weekId: MessageId = free ? "A4" : "B2";
  const firstDays = free ? DUE_AFTER_DAYS.A2 : DUE_AFTER_DAYS.B1;
  const weekDays = free ? DUE_AFTER_DAYS.A4 : DUE_AFTER_DAYS.B2;
  if (!marks[weekId] && ageDays >= weekDays && used) return weekId;
  if (!marks[firstId] && ageDays >= firstDays && !used) return firstId;
  return undefined;
}

export interface SweepResult {
  checked: number;
  sent: Partial<Record<MessageId, number>>;
  removed: number;
  errors: number;
  /** Everything due by now was handled (the next item, if any, is not due yet). */
  complete: boolean;
}

/**
 * Due items one sweep invocation handles. The Workers KV limits page gives 1,000 operations to
 * external services per invocation (the paid plan's 10,000 subrequests is the larger limit), so
 * the worst case must stay under 1,000 counting every KV, Durable Object and send operation. One
 * paid item, at most: stop marker 1, record 1, liveness 6 (the subscription's key list and up to
 * 5 keys), marks 1, meter usage 1, then the send gate (stop 1, marks 1, two claims 2, the second
 * stop check 1, the send 1 and its header-fallback resend 1, mark read and write 2), then the due
 * item's delete 1 = 21; a stopped or ended record instead costs at most the record's clean-up
 * (about 8). 40 x 21 + 1 for the list = 841, under 1,000 with margin. A free item costs fewer.
 * With the hourly cron that is 960 items a day, and an item is handled once and deleted.
 */
export const SWEEP_BATCH = 40;

/**
 * Handle the time-based messages that are due: list the `lcdue:` index in date order (oldest
 * first), and for each item due by now remove the record if the address was stopped or the key
 * or plan has ended, send the message if it still applies, and delete the item. Items past
 * DUE_UNTIL_DAYS are deleted unsent. A run stops at the first item not yet due; the next run picks
 * up what this one did not reach. One bad item cannot stop the run (it is counted and deleted).
 */
export async function lifecycleSweep(
  env: Env,
  now: number = Date.now(),
  batchSize = SWEEP_BATCH,
): Promise<SweepResult> {
  const result: SweepResult = {
    checked: 0,
    sent: {},
    removed: 0,
    errors: 0,
    complete: true,
  };
  if (!lifecycleEnabled(env) || !env.KEYS.list) return result;
  const batch = await env.KEYS.list({
    prefix: DUE_PREFIX,
    limit: Math.min(batchSize, SWEEP_BATCH),
  });
  const nowHour = dueHour(now - 3_599_999);
  let reachedFuture = false;
  for (const { name } of batch.keys) {
    const m = /^lcdue:(\d{10}):(free|paid):([0-9a-f]{64}):(A2|A4|B1|B2)$/.exec(
      name,
    );
    if (!m) {
      await env.KEYS.delete(name);
      continue;
    }
    if (m[1]! > nowHour) {
      reachedFuture = true;
      break;
    }
    result.checked++;
    try {
      await sweepOne(env, m[2] as Kind, m[3]!, m[4] as MessageId, now, result);
    } catch {
      result.errors++;
    }
    await env.KEYS.delete(name).catch(() => undefined);
  }
  result.complete = reachedFuture || batch.list_complete;
  return result;
}

async function sweepOne(
  env: Env,
  kind: Kind,
  h: string,
  id: MessageId,
  now: number,
  result: SweepResult,
): Promise<void> {
  const drop = async (rec?: LifecycleRecord) => {
    if (!(await env.KEYS.get(recordKey(kind, h)))) return;
    await dropRecord(env, kind, h, rec);
    result.removed++;
  };
  if (await isSuppressed(env, h)) return drop();
  const rec = await readRecord(env, kind, h);
  if (!rec) return;
  if (!(await recordIsLive(env, rec))) return drop(rec);
  const ageDays = (now - Date.parse(rec.since)) / DAY_MS;
  // Past DUE_UNTIL_DAYS nothing time-based is sent: the item is just deleted.
  if (!(ageDays >= 1) || ageDays > DUE_UNTIL_DAYS) return;
  const marks = await readMarks(env, kind, h);
  // The meter's window runs back from today: far enough to cover everything since the start.
  const window = Math.min(DUE_UNTIL_DAYS, Math.ceil(ageDays) + 1);
  const usage = await env.METER.usage(rec.subject, window);
  if (dueMessage(kind, marks, ageDays, usage.total > 0) !== id) return;
  const plan = rec.plan && isPlanId(rec.plan) ? PLANS[rec.plan] : PLANS.pro;
  const r = await deliverPromo(env, kind, h, id, now, (_rec, ctx) => {
    if (id === "A2") return unusedFreeMessage(ctx);
    if (id === "A4") return freeWeekMessage(ctx, usageFacts(usage));
    if (id === "B1") return unusedPaidMessage(ctx, plan);
    return paidWeekMessage(ctx, plan, usageFacts(usage));
  });
  if (r === "sent") result.sent[id] = (result.sent[id] ?? 0) + 1;
}

/** Whether the key or plan a record is about still exists and works. */
async function recordIsLive(env: Env, rec: LifecycleRecord): Promise<boolean> {
  if (rec.kind === "free") {
    const raw = rec.key_hash
      ? await env.KEYS.get(`freekey:${rec.key_hash}`)
      : null;
    if (!raw) return false;
    try {
      return !(JSON.parse(raw) as { revoked_at?: string }).revoked_at;
    } catch {
      return false;
    }
  }
  if (!rec.subscription) return false;
  const keys = await liveKeys(env.KEYS, rec.subscription);
  return keys.some(
    (k: { record: KeyRecord }) => deriveStatus(k.record) === "active",
  );
}

// --- Routes ---------------------------------------------------------------------------------------

export interface LifecycleRouteOptions {
  now: () => number;
  /** The request body, already read with a size cap (POST /account/stop and /account/lifecycle). */
  body?: string;
  fetchImpl?: typeof fetch;
  defer?: (work: Promise<unknown>) => void;
}

const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

const STOPPED_TITLE = "Optional emails stopped";
const STOPPED_TEXT =
  "FactLot will not send you any more optional emails. Notes about your key or plan that you need to use the service, such as a sign-in link you ask for, still arrive when you ask for them.";

function stopFormPage(status = 200, message?: string): Response {
  return page(
    "Stop optional emails",
    `<h1>Stop optional emails</h1>
${message ? `<div class="notice" role="status"><p>${message}</p></div>` : ""}
<p class="lead">Enter the address that gets them. They stop at once and for good. No sign-in needed.</p>
<form method="post" action="/account/stop"><label for="stop-email">Email</label><input id="stop-email" name="email" type="email" autocomplete="email" required maxlength="254">
<div class="buttons"><button type="submit" class="button primary">Stop optional emails</button></div></form>`,
    { status, formAction: "'self'" },
  );
}

/**
 * /account/stop, /account/stop/<token> and /account/lifecycle. Undefined when the feature is off
 * or the path is not one of these (the caller then answers 404 as for any unknown path).
 */
export async function lifecycleRoute(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  opts: LifecycleRouteOptions,
): Promise<Response | undefined> {
  if (!lifecycleEnabled(env)) return undefined;
  const now = opts.now();
  if (path.startsWith("/account/stop/")) {
    if (!["GET", "HEAD", "POST"].includes(request.method))
      return new Response("Use GET or POST.\n", {
        status: 405,
        headers: { allow: "GET, HEAD, POST" },
      });
    const h = await checkStopToken(env, path.slice("/account/stop/".length));
    if (!h)
      return messagePage(
        404,
        "Stop optional emails",
        "This stop link is not valid. Copy the whole link from the email, or stop them from the account page.",
        { next: { href: "/account/stop", label: "Stop them by address" } },
      );
    // HEAD changes nothing. A GET only shows a button: mail gateways fetch links before the
    // reader sees them, and must not unsubscribe anyone. The button (a POST to this same URL) and
    // the RFC 8058 one-click POST that List-Unsubscribe-Post promises both stop, and either can be
    // repeated with the same result. No sign-in is needed.
    if (request.method !== "POST")
      return page(
        "Stop optional emails",
        `<h1>Stop optional emails</h1>
<p class="lead">Press the button to stop the optional emails from FactLot to this address. They stop at once and for good.</p>
<form method="post" action="${escapeHtml(path)}"><div class="buttons"><button type="submit" class="button primary">Stop optional emails</button></div></form>`,
        { formAction: "'self'" },
      );
    await stopEmails(env, h, now);
    return messagePage(200, STOPPED_TITLE, STOPPED_TEXT);
  }
  if (path === "/account/stop") {
    if (request.method === "GET" || request.method === "HEAD")
      return stopFormPage();
    if (request.method !== "POST")
      return new Response("Use GET or POST.\n", {
        status: 405,
        headers: { allow: "GET, HEAD, POST" },
      });
    const origin = request.headers.get("origin");
    if (origin && origin !== "null" && origin !== url.origin)
      return stopFormPage(403, "This form only works on its own page.");
    const body = new URLSearchParams(opts.body ?? "");
    const email = (body.get("email") ?? "").trim();
    if (email.length > 254 || !EMAIL_RE.test(email))
      return stopFormPage(400, "Enter a valid email address.");
    if (!env.RECOVERY_SIGNING_SECRET)
      return stopFormPage(
        503,
        "This is being set up; write to the contact address on this page.",
      );
    await stopByForm(env, await addressHash(env, email), now);
    // The same answer for every address: it tells nobody whether it was getting the emails.
    return messagePage(
      200,
      STOPPED_TITLE,
      "If that address was getting optional emails from FactLot, they have stopped.",
    );
  }
  if (path === "/account/lifecycle") {
    if (request.method !== "POST")
      return new Response("Use POST.\n", {
        status: 405,
        headers: { allow: "POST" },
      });
    return paidConsentRoute(env, request, url, opts);
  }
  return undefined;
}

/** New stop markers the address form may create in one hour, across all callers. */
export const STOP_FORM_PER_HOUR = 100;

/**
 * The address form: an address with a consent record is always stopped. Otherwise a marker is
 * written only for an address FactLot has a free key for (so it can never be mailed later), and
 * only while the hour's STOP_FORM_PER_HOUR new markers are not used up; for any other address
 * nothing is written. The page answers the same in every case. Signed stop links are not limited.
 */
async function stopByForm(env: Env, h: string, now: number): Promise<void> {
  const consented =
    (await env.KEYS.get(recordKey("free", h))) !== null ||
    (await env.KEYS.get(recordKey("paid", h))) !== null;
  if (consented) {
    await stopEmails(env, h, now);
    return;
  }
  if (await isSuppressed(env, h)) return;
  if ((await env.KEYS.get(`freeemail:${h}`)) === null) return;
  const hour = new Date(now).toISOString().slice(0, 13);
  const hit = await env.METER.consume(`lcstopform:${hour}`, {
    kind: "day",
    limit: STOP_FORM_PER_HOUR,
    n: 1,
  });
  if (hit.granted < 1) return;
  await stopEmails(env, h, now);
}

/** POST /account/lifecycle: the checkbox on the page after checkout. */
async function paidConsentRoute(
  env: Env,
  request: Request,
  url: URL,
  opts: LifecycleRouteOptions,
): Promise<Response> {
  const form = new URLSearchParams(opts.body ?? "");
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return messagePage(
      403,
      "Optional emails",
      "This form only works on its own page.",
    );
  if (form.get("lifecycle_emails") === null)
    return messagePage(
      200,
      "Optional emails",
      "Nothing changed. You will get no optional emails.",
    );
  const sessionId = form.get("session_id") ?? "";
  const d: BillingDeps | undefined = billingDeps(
    env,
    opts.fetchImpl,
    opts.now,
    opts.defer,
  );
  const fail = (text: string) => messagePage(400, "Optional emails", text);
  if (!d || !SESSION_RE.test(sessionId) || !env.RECOVERY_SIGNING_SECRET)
    return fail("We could not save that choice.");
  // The form on the page after checkout carries a proof that this browser was shown it for this
  // session within the last hour; a session id seen elsewhere cannot set anyone's choice.
  if (
    !(await checkConsentProof(
      env.RECOVERY_SIGNING_SECRET,
      sessionId,
      form.get("t"),
      form.get("proof"),
      opts.now(),
    ))
  )
    return fail(
      "This choice can only be saved from the page shown right after you paid, and within an hour of it.",
    );
  // Only a checkout whose key was shown (the success page) can carry the choice.
  if (!(await env.KEYS.get(`session:${sessionId}`)))
    return fail("We could not find that checkout.");
  let session: Json;
  try {
    session = await d.stripe.get(`/checkout/sessions/${sessionId}`);
  } catch {
    return messagePage(
      502,
      "Optional emails",
      "We could not reach Stripe. Your choice was not saved; try again in a minute.",
    );
  }
  const details = session.customer_details as { email?: unknown } | undefined;
  const email = details?.email ?? session.customer_email;
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const sub = session.subscription;
  const subscription = typeof sub === "string" ? sub : "";
  if (
    typeof email !== "string" ||
    !EMAIL_RE.test(email) ||
    !subscription ||
    !isPlanId(meta.factlot_plan) ||
    session.status !== "complete"
  )
    return fail("We could not save that choice.");
  const result = await recordConsent(env, {
    kind: "paid",
    h: await addressHash(env, email),
    to: email,
    subject: `sub:${subscription}`,
    subscription,
    plan: meta.factlot_plan,
    now: opts.now(),
  });
  if (result === "suppressed")
    return messagePage(
      200,
      "Optional emails",
      "You stopped optional emails from FactLot earlier, so none will be sent.",
    );
  return messagePage(
    200,
    "Optional emails",
    "Saved. Each optional note carries a link that stops them; you can also stop them at factlot.com/account/stop.",
  );
}
