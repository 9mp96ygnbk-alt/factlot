/**
 * Watch lists: the check after a registry update, the registry reads, and the alert emails.
 *
 * Registry data changes only when a new pack is deployed, and the pack's manifest names it by
 * `built_at` (GET /health of the registry Worker). The check compares every watched subject with
 * the new pack once:
 *
 * - Trigger: the Worker's scheduled handler (a cron trigger). A run with no new pack costs one
 *   registry request and one Durable Object request. As a fallback, and so an agent never reads
 *   stale results, watch_changes also checks up to WATCH_CHECK.inlineReads of the caller's own
 *   subjects inline when the pack is newer than their fingerprints.
 * - Limits: Cloudflare allows at most 32 Worker invocations per request, and each service-binding
 *   call counts. A run makes at most WATCH_CHECK.invocations calls to the registry and to Durable
 *   Objects together (counting both, the strictest reading), reads up to GET_MANY_MAX subjects
 *   per registry call (POST /get-many of the registry Worker), and stops cleanly when the budget
 *   is spent; the next run resumes where it stopped.
 * - Idempotent per check: each new pack gets a check number from the index; a subject is read
 *   once per check, a change is stored once per (subject, aspect, check), and a digest is claimed
 *   before it is sent, so it goes at most once per (subscription, check). A lease in the index
 *   keeps two runs apart. A pack rolled back and deployed again is a new check.
 * - Failures: a subject the registry cannot read keeps its fingerprint and is read again in the
 *   next run, alone; after WATCH_CHECK.maxFails failures in a row it is given up for that check
 *   (watch_changes and watch_list say so) and tried again in the next. When the registry does not
 *   answer at all (its /health fails too) the run stops and nothing is counted against any
 *   subject. An error in one subscription never stops the others.
 * - Deletion: the check deletes a subscription's watch data only when one of its key records
 *   shows a terminal Stripe status and none is active. An empty or unreadable key list is skipped
 *   and tried again (KV is eventually consistent; a rotation can be seen half-way). The Stripe
 *   webhook is the main deletion path.
 * - The checks never touch a customer's lookup quota.
 *
 * Stop and confirmation links are signed with RECOVERY_SIGNING_SECRET, and recorded-document
 * hashes use a key derived from it: rotating the secret makes every stop and confirmation link
 * already sent invalid (alerts then stop from the account page or watch_alerts), and the next
 * comparison re-baselines recorded documents without reporting them as changed.
 */
import { sendEmail, watchConfirmMessage, watchDigestMessage } from "./email.ts";
import {
  deriveStatus,
  isLiveKey,
  readKey,
  stripeStatusIsTerminal,
  subscriptionKeys,
  type KeyRecord,
} from "./keys.ts";
import type { DurableObjectNamespaceLike } from "./limiter.ts";
import { WATCH_LIMITS, watchEnabled, type PlanId } from "./plans.ts";
import { sign } from "./recovery.ts";
import { REGISTRY_RUN_URL } from "./registry.ts";
import type { Env, Fetcher, WatchService } from "./types.ts";
import { forgetWatch } from "./watch-forget.ts";
import {
  compare,
  fingerprint,
  type Aspect,
  type ChangeBody,
  type Missing,
  type Print,
} from "./watch-print.ts";
import type { StoredChange } from "./watch-store.ts";

export const WATCH_CHECK = {
  /** Registry and Durable Object calls one invocation may make (Cloudflare's limit is 32). */
  invocations: 30,
  /** Subjects one registry call reads (the registry Worker's GET_MANY_MAX). */
  chunk: 50,
  /** Calls kept back per subscription for its bookkeeping (pending, apply, digest, done). */
  perOwner: 6,
  /** How long a run holds the index's lease (a crashed run is resumed after it). */
  leaseMs: 14 * 60_000,
  /** Failed reads in a row before a subject is given up for one check. */
  maxFails: 3,
  /** Failed digest sends for one check before it is marked not sent. */
  maxDigestFails: 5,
  /** Subjects watch_changes compares inline when the pack is newer. */
  inlineReads: 25,
  /** Changes listed in one email. */
  emailItems: 50,
  /** Hours a confirmation link works. */
  confirmHours: 24,
  /** One confirmation email per subscription per this long, and at most confirmPerDay a UTC day. */
  confirmGapMs: 10 * 60_000,
  confirmPerDay: 5,
} as const;

export const REGISTRY_HEALTH_URL = "https://registry.internal/health";
export const REGISTRY_GET_MANY_URL = "https://registry.internal/get-many";

/** The watch storage over the LIMITER namespace (objects `watch:sub:<id>` and `watch:index`). */
export function objectWatch(ns: DurableObjectNamespaceLike): WatchService {
  const call = async <T>(
    name: string,
    kind: "sub" | "index",
    op: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const res = await ns
      .get(ns.idFromName(name))
      .fetch("https://limiter/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, op, args }),
      });
    if (!res.ok) throw new Error(`watch store answered ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    sub: (subscription, op, args) =>
      call(`watch:sub:${subscription}`, "sub", op, args),
    index: (op, args) => call("watch:index", "index", op, args),
  };
}

// --- Registry reads ----------------------------------------------------------------------------

type Json = Record<string, unknown>;

export type SubjectRead =
  | { found: true; record: Json }
  | { found: false; message: string }
  | { error: string };

/** A registry call that failed as a whole (5xx, no answer). */
export class RegistryCallFailed extends Error {}
/** The registry does not answer at all: the run stops. */
export class RegistryDown extends Error {}

export interface RegistryReader {
  /** The pack's built_at, or undefined when the registry does not say. One call; throws on failure. */
  builtAt(): Promise<string | undefined>;
  /**
   * registry_get of up to GET_MANY_MAX URNs within `maxCalls` calls: `reads[k]` is URN k's
   * answer, or undefined when it was not read (the calls ran out). Throws RegistryCallFailed when
   * the first call fails as a whole.
   */
  getMany(
    urns: string[],
    maxCalls: number,
  ): Promise<{ reads: (SubjectRead | undefined)[]; calls: number }>;
}

let healthCache: { at: number; builtAt: string | undefined } | undefined;
/** Whether the registry Worker has /get-many (an older deployment answers 404). */
let getManyMissing = false;

function readOf(o: unknown): SubjectRead {
  const out = o as
    | { ok: true; result: Json }
    | { ok: false; error?: { error?: string; message?: string } }
    | null;
  if (out && out.ok === true) return { found: true, record: out.result };
  if (out && out.ok === false && out.error?.error === "NotFound")
    return { found: false, message: String(out.error.message ?? "not found") };
  return {
    error: String(
      (out as { error?: { error?: string } } | null)?.error?.error ??
        "no answer",
    ).slice(0, 64),
  };
}

export function registryReader(
  service: Fetcher,
  opts: { now?: () => number; cacheMs?: number } = {},
): RegistryReader {
  const now = opts.now ?? Date.now;
  const single = async (urn: string): Promise<SubjectRead> => {
    try {
      const res = await service.fetch(
        new Request(REGISTRY_RUN_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tool: "registry_get", input: { urn } }),
        }),
      );
      if (!res.ok) return { error: `registry answered ${res.status}` };
      return readOf(await res.json());
    } catch {
      return { error: "no answer" };
    }
  };
  return {
    async builtAt() {
      const cacheMs = opts.cacheMs ?? 0;
      if (cacheMs > 0 && healthCache && now() - healthCache.at < cacheMs)
        return healthCache.builtAt;
      const res = await service.fetch(new Request(REGISTRY_HEALTH_URL));
      if (!res.ok) throw new Error(`registry health answered ${res.status}`);
      const b = (await res.json()) as { pack?: { built_at?: unknown } };
      const builtAt =
        typeof b.pack?.built_at === "string" ? b.pack.built_at : undefined;
      healthCache = { at: now(), builtAt };
      return builtAt;
    },
    async getMany(urns, maxCalls) {
      const reads: (SubjectRead | undefined)[] = new Array(urns.length);
      if (urns.length === 0 || maxCalls < 1) return { reads, calls: 0 };
      let calls = 0;
      if (!getManyMissing) {
        calls++;
        let res: Response;
        try {
          res = await service.fetch(
            new Request(REGISTRY_GET_MANY_URL, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ urns }),
            }),
          );
        } catch {
          throw new RegistryCallFailed("no answer");
        }
        if (res.status === 404) getManyMissing = true;
        else if (!res.ok)
          throw new RegistryCallFailed(`answered ${res.status}`);
        else {
          const b = (await res.json()) as { outcomes?: unknown[] };
          urns.forEach((_, k) => (reads[k] = readOf(b.outcomes?.[k])));
          return { reads, calls };
        }
      }
      // An older registry Worker: one call per URN, as far as the calls allow.
      for (let k = 0; k < urns.length && calls < maxCalls; k++) {
        calls++;
        reads[k] = await single(urns[k]!);
      }
      return { reads, calls };
    },
  };
}

/** Tests: forget the cached pack date and what the registry supports. */
export function resetWatchHealthCache(): void {
  healthCache = undefined;
  getManyMissing = false;
}

// --- Comparing --------------------------------------------------------------------------------

export interface PendingItem {
  urn: string;
  aspects: Aspect[];
  print: string;
  /** Failed reads in a row: such a subject is read alone. */
  fails: number;
}

export interface CheckContext {
  reader: RegistryReader;
  /** Reads of this run, by URN (shared by subscriptions). */
  cache: Map<string, SubjectRead>;
  /** Count calls (registry and Durable Object). */
  spend(n: number): void;
  now: () => number;
  /** The secret recorded-document hashes are keyed with. */
  secret?: string;
}

export function newContext(
  reader: RegistryReader,
  now: () => number = Date.now,
  spend: (n: number) => void = () => {},
  secret?: string,
): CheckContext {
  return { reader, cache: new Map(), spend, now, secret };
}

/**
 * Compare pending subjects with the pack within `maxCalls` registry calls and store the result
 * (one more call). Subjects not read for lack of calls stay pending. Returns how many subjects
 * were settled (compared, or counted as failed) and the changes stored. Throws RegistryDown when
 * the registry does not answer at all.
 */
export async function compareItems(
  watch: WatchService,
  subscription: string,
  seq: number,
  builtAt: string,
  items: PendingItem[],
  ctx: CheckContext,
  maxCalls: number,
  /** URNs already settled for this subscription in this run: left alone, and added to. */
  seen: Set<string> = new Set(),
  /**
   * Whether failed reads count toward giving a subject up (the scheduled check). Inline reads
   * (watch_changes) never count them: a failed subject there is simply left pending.
   */
  countFailures = true,
): Promise<{
  settled: number;
  stored: number;
  reads: number;
  /** Subjects that failed and will be read again (not yet given up). */
  retry: number;
  /** A call failed while the registry answered: nothing more was read. */
  stopped?: boolean;
}> {
  items = items.filter((i) => !seen.has(i.urn));
  // Calls: a subject that failed before is read alone; the rest in chunks.
  const groups: PendingItem[][] = [];
  let chunk: PendingItem[] = [];
  for (const it of items) {
    if (ctx.cache.has(it.urn)) continue;
    if (it.fails > 0) groups.push([it]);
    else {
      chunk.push(it);
      if (chunk.length === WATCH_CHECK.chunk) {
        groups.push(chunk);
        chunk = [];
      }
    }
  }
  if (chunk.length) groups.push(chunk);
  let calls = 0;
  let reads = 0;
  let stopped = false;
  for (const g of groups) {
    if (calls >= maxCalls) break;
    const urns = g.map((i) => i.urn);
    try {
      const r = await ctx.reader.getMany(urns, maxCalls - calls);
      calls += r.calls;
      ctx.spend(r.calls);
      r.reads.forEach((read, k) => {
        if (read) {
          ctx.cache.set(urns[k]!, read);
          reads++;
        }
      });
    } catch (err) {
      if (!(err instanceof RegistryCallFailed)) throw err;
      // The failed call and the health probe both count (the loop ends below).
      ctx.spend(2);
      // Is the registry down, or did these subjects break the call?
      const up = await ctx.reader.builtAt().then(
        (b) => b !== undefined,
        () => false,
      );
      if (!up) throw new RegistryDown("registry does not answer");
      // These subjects broke the call: record their failure now (each is read alone next run)
      // and read nothing more for this subscription in this run.
      for (const u of urns) ctx.cache.set(u, { error: "registry error" });
      stopped = true;
      break;
    }
  }
  const results: {
    urn: string;
    label: string | null;
    print: string;
    status: string;
    changes: ChangeBody[];
  }[] = [];
  const failed: { urn: string; reason: string }[] = [];
  let uncounted = 0;
  for (const it of items) {
    const read = ctx.cache.get(it.urn);
    if (!read) continue;
    if ("error" in read) {
      if (countFailures) failed.push({ urn: it.urn, reason: read.error });
      else uncounted++;
      continue;
    }
    const old = it.print ? (JSON.parse(it.print) as Print) : undefined;
    const cur: Print | Missing = read.found
      ? await fingerprint(read.record, ctx.secret)
      : { missing: true, message: read.message };
    const changes = old ? compare(old, cur, new Set(it.aspects)) : [];
    const print: Print =
      "missing" in cur
        ? old
          ? { ...old, status: "missing" }
          : missingPrint()
        : cur;
    results.push({
      urn: it.urn,
      label:
        read.found && typeof read.record.label === "string"
          ? read.record.label
          : null,
      print: JSON.stringify(print),
      status: print.status,
      changes,
    });
  }
  if (results.length === 0 && failed.length === 0)
    return { settled: 0, stored: 0, reads, retry: uncounted, stopped };
  for (const x of [...results, ...failed]) seen.add(x.urn);
  ctx.spend(1);
  const r = await watch.sub<{ stored: number; skipped: number }>(
    subscription,
    "apply",
    {
      seq,
      built_at: builtAt,
      now: new Date(ctx.now()).toISOString(),
      results,
      failed,
      maxFails: WATCH_CHECK.maxFails,
    },
  );
  return {
    settled: results.length + failed.length,
    stored: r.stored,
    reads,
    retry: failed.length - r.skipped + uncounted,
    stopped,
  };
}

function missingPrint(): Print {
  return {
    v: 1,
    kind: "",
    status: "missing",
    value: null,
    owner: null,
    documents: { count: 0, items: [] },
    dk: "",
    entity_status: null,
    other: {},
    newest_as_of: null,
  };
}

// --- Signed links and alert emails --------------------------------------------------------------

export const STOP_PATH = "/account/watch-alerts/stop/";
export const CONFIRM_PATH = "/account/watch-alerts/confirm/";
const STOP_PURPOSE = "factlot-watch-stop";
const CONFIRM_PURPOSE = "factlot-watch-confirm";

async function linkToken(
  secret: string,
  id: string,
  purpose: string,
): Promise<string> {
  return `${id}.${await sign(secret, id, purpose)}`;
}

async function linkId(
  secret: string,
  token: string,
  purpose: string,
): Promise<string | undefined> {
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return undefined;
  const expected = await sign(secret, m[1]!, purpose);
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  return diff === 0 ? m[1] : undefined;
}

/** The stop link's token for an alert id: `<id>.<HMAC>`. */
export const stopToken = (secret: string, alertId: string) =>
  linkToken(secret, alertId, STOP_PURPOSE);
/** The alert id of a valid stop token, or undefined. */
export const stopTokenId = (secret: string, token: string) =>
  linkId(secret, token, STOP_PURPOSE);
/** The confirmation link's token for a pending address id. */
export const confirmToken = (secret: string, pendingId: string) =>
  linkToken(secret, pendingId, CONFIRM_PURPOSE);
export const confirmTokenId = (secret: string, token: string) =>
  linkId(secret, token, CONFIRM_PURPOSE);

/** Alerts can be sent: the Email Service binding and the link-signing secret are set. */
export function alertsReady(env: Env): boolean {
  return env.EMAIL !== undefined && !!env.RECOVERY_SIGNING_SECRET;
}

const siteOf = (env: Env) =>
  (env.SITE_URL ?? "https://factlot.com").replace(/\/$/, "");

/** Through sendEmail (email.ts): one log line without the address on failure, and a resend without
 * the List-Unsubscribe headers if Email Sending refuses them. */
function send(
  env: Env,
  kind: "watch" | "watchconfirm",
  to: string,
  message: { subject: string; text: string; html: string },
  headers?: Record<string, string>,
): Promise<boolean> {
  return sendEmail(env, kind, {
    to,
    ...message,
    ...(headers ? { headers } : {}),
  });
}

/** The one email an unconfirmed address ever gets: its confirmation link. */
export async function sendConfirmation(
  env: Env,
  to: string,
  pendingId: string,
): Promise<boolean> {
  if (!env.RECOVERY_SIGNING_SECRET) return false;
  const url = `${siteOf(env)}${CONFIRM_PATH}${await confirmToken(env.RECOVERY_SIGNING_SECRET, pendingId)}`;
  return send(
    env,
    "watchconfirm",
    to,
    watchConfirmMessage(url, WATCH_CHECK.confirmHours),
  );
}

/** Send one check's digest to the confirmed address; false (one log line, no address) when it fails. */
export async function sendDigest(
  env: Env,
  to: string,
  alertId: string,
  builtAt: string,
  changes: StoredChange[],
): Promise<boolean> {
  if (!env.RECOVERY_SIGNING_SECRET) return false;
  const site = siteOf(env);
  const stop = `${site}${STOP_PATH}${await stopToken(env.RECOVERY_SIGNING_SECRET, alertId)}`;
  const shown = changes.slice(0, WATCH_CHECK.emailItems);
  return send(
    env,
    "watch",
    to,
    watchDigestMessage({
      builtAt,
      items: shown.map((c) => ({
        urn: c.urn,
        label: c.label,
        summary: c.summary,
      })),
      more: changes.length - shown.length,
      account: `${site}/account#watch`,
      stop,
      postal: env.POSTAL_ADDRESS,
    }),
    {
      "List-Unsubscribe": `<${stop}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  );
}

// --- The scheduled check ----------------------------------------------------------------------

export interface CheckReport {
  state: "off" | "no_pack" | "done" | "busy" | "run";
  built_at?: string;
  seq?: number;
  subscriptions_done: number;
  subscriptions_deleted: number;
  subscriptions_failed: number;
  subjects_read: number;
  changes: number;
  digests: number;
  /** Registry and Durable Object calls this run made. */
  invocations: number;
  /** The registry stopped answering; the next run resumes. */
  stopped?: boolean;
  /** Subscriptions still to check for this pack (the next run resumes them). */
  left?: number;
}

/**
 * The subscription's plan while a live key is active; "gone" only when a key record shows a
 * terminal Stripe status and none is active; "inactive" when a live key exists and is not active
 * (unpaid, paused, on hold); "skip" when the key list is empty or unreadable (KV may be behind).
 */
export async function subscriptionPlan(
  env: Env,
  subscription: string,
): Promise<PlanId | "gone" | "inactive" | "skip" | "none"> {
  let records: KeyRecord[];
  try {
    const hashes = await subscriptionKeys(env.KEYS, subscription);
    records = (
      await Promise.all(hashes.map((h) => readKey(env.KEYS, h)))
    ).filter((r): r is KeyRecord => r !== undefined);
  } catch {
    return "skip";
  }
  const active = records.find(
    (r) => isLiveKey(r) && deriveStatus(r) === "active",
  );
  if (active) return active.plan;
  if (records.some((r) => stripeStatusIsTerminal(r.stripe_status)))
    return "gone";
  if (records.some((r) => isLiveKey(r))) return "inactive";
  return records.length === 0 ? "none" : "skip";
}

/**
 * A subscription cancelled while watch lists were off has no webhook left to delete it, and its
 * key records expire 365 days after it became inactive. Its watch data is deleted only after an
 * unbroken streak of checks that found no key record at all, lasting BOTH at least
 * NO_KEY_CHECKS_BEFORE_DELETE distinct check numbers AND at least NO_KEY_DAYS_BEFORE_DELETE days
 * since the first of them: check numbers alone can come quickly when two packs alternate during
 * a gradual registry deploy, and KV staleness lasts seconds to a minute. Any other outcome (a key
 * record seen, an unreadable list) ends the streak.
 */
export const NO_KEY_CHECKS_BEFORE_DELETE = 3;
export const NO_KEY_DAYS_BEFORE_DELETE = 7;

type Outcome = "done" | "later" | "budget";

async function checkSubscription(
  env: Env,
  watch: WatchService,
  subscription: string,
  seq: number,
  builtAt: string,
  ctx: CheckContext,
  left: () => number,
  report: CheckReport,
): Promise<Outcome> {
  const plan = await subscriptionPlan(env, subscription);
  if (plan === "skip") {
    ctx.spend(1);
    await watch.sub(subscription, "keys_seen", {});
    return "later";
  }
  if (plan === "none") {
    ctx.spend(1);
    const n = await watch.sub<{ count: number; since_ms: number }>(
      subscription,
      "no_keys",
      { seq, now: ctx.now() },
    );
    if (
      n.count < NO_KEY_CHECKS_BEFORE_DELETE ||
      n.since_ms < NO_KEY_DAYS_BEFORE_DELETE * 86_400_000
    )
      return "later";
    ctx.spend(2);
    await forgetWatch(env, subscription);
    report.subscriptions_deleted++;
    return "done";
  }
  if (plan === "gone") {
    ctx.spend(2);
    await forgetWatch(env, subscription);
    report.subscriptions_deleted++;
    return "done";
  }
  if (plan === "inactive") {
    // Not compared for this pack; retention still applies.
    ctx.spend(1);
    await watch.sub(subscription, "prune", {
      now: new Date(ctx.now()).toISOString(),
      keys_seen: true,
    });
    return "done";
  }
  const seen = new Set<string>();
  let retry = 0;
  for (;;) {
    const calls = left() - WATCH_CHECK.perOwner;
    if (calls < 1) return "budget";
    ctx.spend(1);
    const p = await watch.sub<{ items: PendingItem[]; remaining: number }>(
      subscription,
      "pending",
      {
        seq,
        max: calls * WATCH_CHECK.chunk,
        maxSubjects: WATCH_LIMITS[plan].subjects,
        now: new Date(ctx.now()).toISOString(),
        // A key record was found: the no-key count starts again.
        keys_seen: true,
      },
    );
    const fresh = p.items.filter((i) => !seen.has(i.urn));
    if (fresh.length === 0) break;
    const r = await compareItems(
      watch,
      subscription,
      seq,
      builtAt,
      fresh,
      ctx,
      calls,
      seen,
    );
    report.changes += r.stored;
    report.subjects_read += r.reads;
    retry += r.retry;
    if (r.stopped) return "later";
    if (r.settled < fresh.length) return "budget";
    if (p.remaining <= p.items.length) break;
  }
  // Subjects whose read failed are read again (alone) in the next run; the digest waits for them.
  if (retry > 0) return "later";
  ctx.spend(1);
  const d = await watch.sub<{
    claimed: boolean;
    email: string | null;
    alert_id: string | null;
    changes: StoredChange[];
  }>(subscription, "digest_claim", {
    seq,
    now: new Date(ctx.now()).toISOString(),
  });
  if (
    d.claimed &&
    d.email &&
    d.alert_id &&
    d.changes.length > 0 &&
    alertsReady(env)
  ) {
    ctx.spend(1);
    if (await sendDigest(env, d.email, d.alert_id, builtAt, d.changes))
      report.digests++;
    else {
      ctx.spend(1);
      const rel = await watch.sub<{ given_up: boolean }>(
        subscription,
        "digest_release",
        { seq, maxFails: WATCH_CHECK.maxDigestFails },
      );
      // Not done: a later run sends it (after maxDigestFails failures it is marked not sent).
      if (!rel.given_up) return "later";
    }
  }
  return "done";
}

/**
 * One scheduled run: when the pack is newer than the last completed check, compare watched
 * subjects within the invocation's budget, resuming where the last run stopped.
 */
export async function runWatchCheck(
  env: Env,
  deps: {
    reader?: RegistryReader;
    now?: () => number;
    /** Calls this run may make (default and maximum WATCH_CHECK.invocations). */
    budget?: number;
  } = {},
): Promise<CheckReport> {
  const report: CheckReport = {
    state: "off",
    subscriptions_done: 0,
    subscriptions_deleted: 0,
    subscriptions_failed: 0,
    subjects_read: 0,
    changes: 0,
    digests: 0,
    invocations: 0,
  };
  const watch = env.WATCH;
  if (!watchEnabled(env) || !watch || (!deps.reader && !env.REGISTRY))
    return report;
  const now = deps.now ?? Date.now;
  const reader = deps.reader ?? registryReader(env.REGISTRY!, { now });
  const budget = Math.min(
    deps.budget ?? WATCH_CHECK.invocations,
    WATCH_CHECK.invocations,
  );
  const ctx = newContext(
    reader,
    now,
    (n) => (report.invocations += n),
    env.RECOVERY_SIGNING_SECRET,
  );
  const left = () => budget - report.invocations;

  ctx.spend(1);
  const builtAt = await reader.builtAt();
  if (!builtAt) return { ...report, state: "no_pack" };
  report.built_at = builtAt;
  ctx.spend(1);
  const begin = await watch.index<{
    state: CheckReport["state"];
    seq: number;
    owners: string[];
  }>("begin", { built_at: builtAt, now: now(), lease_ms: WATCH_CHECK.leaseMs });
  report.state = begin.state;
  report.seq = begin.seq;
  if (begin.state !== "run") return report;
  try {
    for (const owner of begin.owners) {
      // Room for this subscription's bookkeeping, its done mark and the run's end.
      if (left() < WATCH_CHECK.perOwner + 3) break;
      const subscription = owner.replace(/^sub:/, "");
      let outcome: Outcome;
      try {
        outcome = await checkSubscription(
          env,
          watch,
          subscription,
          begin.seq,
          builtAt,
          ctx,
          () => left() - 2,
          report,
        );
      } catch (err) {
        if (err instanceof RegistryDown) {
          report.stopped = true;
          break;
        }
        // One subscription's failure never stops the others; it is tried again next run.
        report.subscriptions_failed++;
        console.error(
          JSON.stringify({
            msg: "watch check failed for a subscription",
            error: err instanceof Error ? err.name : typeof err,
          }),
        );
        continue;
      }
      if (outcome === "budget") break;
      if (outcome === "later") continue;
      ctx.spend(1);
      await watch.index("done", { owner, seq: begin.seq });
      report.subscriptions_done++;
    }
  } finally {
    ctx.spend(1);
    const end = await watch.index<{ left: number }>("end", { seq: begin.seq });
    report.left = end.left;
  }
  return report;
}
