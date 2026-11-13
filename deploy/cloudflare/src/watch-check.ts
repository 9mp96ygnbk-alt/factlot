/**
 * Watch lists: the check after a registry update, and the alert email.
 *
 * Registry data changes only when a new pack is deployed, and the pack's manifest names it by
 * `built_at` (GET /health of the registry Worker). The check compares every watched subject with
 * the new pack once:
 *
 * - Trigger: the Worker's scheduled handler (a cron trigger, e.g. every 15 minutes). A run with no
 *   new pack costs one registry request and one Durable Object request. As a fallback, and so an
 *   agent never reads stale results, watch_changes also checks up to WATCH_CHECK.inlineReads of the
 *   caller's own subjects inline when the pack is newer than their fingerprints.
 * - Limits: at most WATCH_CHECK.subrequests subrequests per invocation (registry reads, Durable
 *   Object calls, KV reads and emails, all counted), far under the Workers Paid limit. A run that
 *   runs out stops cleanly; the next invocation resumes where it stopped.
 * - Idempotent per built_at: a subject's fingerprint records the pack it was compared with, so it
 *   is read once per pack; a change is stored once per (subject, aspect, built_at); a digest goes
 *   once per (subscription, built_at). A lease in the index object keeps two runs apart.
 * - One registry read per watched URN per pack, shared by every subscription watching it in a run.
 * - A subscription whose keys are all cancelled (or gone) is deleted on the way (fingerprints,
 *   changes, alert address); one that is unpaid or paused is skipped for that pack.
 * - The checks never touch a customer's lookup quota.
 */
import { CONTACT } from "./contact.ts";
import { EMAIL_FROM, watchDigestMessage } from "./email.ts";
import { deriveStatus, liveKeys, stripeStatusIsTerminal } from "./keys.ts";
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
  /** Subrequests one invocation may make, of every kind together. */
  subrequests: 400,
  /** Registry reads in flight at once. */
  readConcurrency: 6,
  /** How long a run holds the index's lease (a crashed run is resumed after it). */
  leaseMs: 14 * 60_000,
  /** Subrequests kept back per subscription for its bookkeeping (pending, apply, KV, digest). */
  perOwner: 10,
  /** Subjects watch_changes compares inline when the pack is newer. */
  inlineReads: 25,
  /** Changes listed in one email. */
  emailItems: 50,
} as const;

export const REGISTRY_HEALTH_URL = "https://registry.internal/health";

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

export type ReadOutcome =
  { found: true; record: Json } | { found: false; message: string };

export interface RegistryReader {
  /** The pack's built_at, or undefined when the registry does not say. */
  builtAt(): Promise<string | undefined>;
  /** registry_get of one URN. Throws when the registry cannot answer. */
  get(urn: string): Promise<ReadOutcome>;
}

let healthCache: { at: number; builtAt: string | undefined } | undefined;

export function registryReader(
  service: Fetcher,
  opts: { now?: () => number; cacheMs?: number } = {},
): RegistryReader {
  const now = opts.now ?? Date.now;
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
    async get(urn) {
      const res = await service.fetch(
        new Request(REGISTRY_RUN_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tool: "registry_get", input: { urn } }),
        }),
      );
      if (!res.ok) throw new Error(`registry answered ${res.status}`);
      const o = (await res.json()) as
        | { ok: true; result: Json }
        | { ok: false; error: { error?: string; message?: string } };
      if (o.ok) return { found: true, record: o.result };
      if (o.error?.error === "NotFound")
        return {
          found: false,
          message: String(o.error.message ?? "not found"),
        };
      throw new Error(`registry error ${String(o.error?.error)}`);
    },
  };
}

/** Tests: forget the cached pack date. */
export function resetWatchHealthCache(): void {
  healthCache = undefined;
}

// --- Comparing --------------------------------------------------------------------------------

export interface PendingItem {
  urn: string;
  aspects: Aspect[];
  print: string;
}

export interface CheckContext {
  reader: RegistryReader;
  /** Fingerprints read in this run, by URN (shared by subscriptions). */
  cache: Map<string, Promise<Print | Missing>>;
  /** Count subrequests spent. */
  spend(n: number): void;
  now: () => number;
}

export function newContext(
  reader: RegistryReader,
  now: () => number = Date.now,
  spend: (n: number) => void = () => {},
): CheckContext {
  return { reader, cache: new Map(), spend, now };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

/** Read (or reuse) one URN's current fingerprint. Throws when the registry cannot answer. */
function current(ctx: CheckContext, urn: string): Promise<Print | Missing> {
  let p = ctx.cache.get(urn);
  if (!p) {
    ctx.spend(1);
    p = ctx.reader
      .get(urn)
      .then((o): Promise<Print | Missing> =>
        o.found
          ? fingerprint(o.record)
          : Promise.resolve({ missing: true, message: o.message }),
      );
    ctx.cache.set(urn, p);
  }
  return p;
}

/** Compare pending subjects with the pack and store the result in the subscription's object. */
export async function compareBatch(
  watch: WatchService,
  subscription: string,
  builtAt: string,
  items: PendingItem[],
  ctx: CheckContext,
  labels: Map<string, string | null> = new Map(),
): Promise<number> {
  const results = await mapLimit(
    items,
    WATCH_CHECK.readConcurrency,
    async (it) => {
      const cur = await current(ctx, it.urn);
      const old = it.print ? (JSON.parse(it.print) as Print) : undefined;
      const changes: ChangeBody[] = old
        ? compare(old, cur, new Set(it.aspects))
        : [];
      const print: Print =
        "missing" in cur
          ? old
            ? { ...old, status: "missing" }
            : missingPrint()
          : cur;
      return {
        urn: it.urn,
        label: labels.get(it.urn) ?? null,
        print: JSON.stringify(print),
        changes,
      };
    },
  );
  ctx.spend(1);
  const r = await watch.sub<{ stored: number }>(subscription, "apply", {
    built_at: builtAt,
    now: new Date(ctx.now()).toISOString(),
    results,
  });
  return r.stored;
}

function missingPrint(): Print {
  return {
    v: 1,
    kind: "",
    status: "missing",
    value: null,
    owner: null,
    documents: { count: 0, items: [] },
    entity_status: null,
    other: {},
    newest_as_of: null,
  };
}

// --- Alerts -----------------------------------------------------------------------------------

export const STOP_PATH = "/account/watch-alerts/stop/";
const STOP_PURPOSE = "factlot-watch-stop";

/** The stop link's token for an alert id: `<id>.<HMAC>`. */
export async function stopToken(
  secret: string,
  alertId: string,
): Promise<string> {
  return `${alertId}.${await sign(secret, alertId, STOP_PURPOSE)}`;
}

/** The alert id of a valid stop token, or undefined. */
export async function stopTokenId(
  secret: string,
  token: string,
): Promise<string | undefined> {
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return undefined;
  const expected = await sign(secret, m[1]!, STOP_PURPOSE);
  let diff = expected.length === m[2]!.length ? 0 : 1;
  for (let i = 0; i < Math.min(expected.length, m[2]!.length); i++)
    diff |= expected.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  return diff === 0 ? m[1] : undefined;
}

/** Alerts can be sent: the Email Service binding and the link-signing secret are set. */
export function alertsReady(env: Env): boolean {
  return env.EMAIL !== undefined && !!env.RECOVERY_SIGNING_SECRET;
}

/** Send one release's digest; false (one log line, no address) when it fails. */
export async function sendDigest(
  env: Env,
  to: string,
  alertId: string,
  builtAt: string,
  changes: StoredChange[],
): Promise<boolean> {
  if (!env.EMAIL || !env.RECOVERY_SIGNING_SECRET) return false;
  const site = (env.SITE_URL ?? "https://factlot.com").replace(/\/$/, "");
  const stop = `${site}${STOP_PATH}${await stopToken(env.RECOVERY_SIGNING_SECRET, alertId)}`;
  const shown = changes.slice(0, WATCH_CHECK.emailItems);
  const message = watchDigestMessage({
    builtAt,
    items: shown.map((c) => ({
      urn: c.urn,
      label: c.label,
      summary: c.summary,
    })),
    more: changes.length - shown.length,
    account: `${site}/account#watch`,
    stop,
    postal: env.OPERATOR_POSTAL_ADDRESS,
  });
  try {
    await env.EMAIL.send({
      ...message,
      to,
      from: EMAIL_FROM,
      replyTo: CONTACT,
      headers: {
        "List-Unsubscribe": `<${stop}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.error(
      JSON.stringify({
        msg: "email failed",
        kind: "watch",
        code: typeof code === "string" ? code.slice(0, 64) : undefined,
        error: err instanceof Error ? err.name : typeof err,
      }),
    );
    return false;
  }
}

// --- The scheduled check ----------------------------------------------------------------------

export interface CheckReport {
  state: "off" | "no_pack" | "done" | "busy" | "run";
  built_at?: string;
  subscriptions_done: number;
  subscriptions_deleted: number;
  subjects_read: number;
  changes: number;
  digests: number;
  subrequests: number;
  /** Subscriptions still to check for this pack (the next run resumes them). */
  left?: number;
}

/** The subscription's plan while it is active, "gone" when it is cancelled, or "inactive". */
async function subscriptionPlan(
  env: Env,
  subscription: string,
  ctx: CheckContext,
): Promise<PlanId | "gone" | "inactive"> {
  const keys = await liveKeys(env.KEYS, subscription);
  ctx.spend(1 + keys.length);
  if (
    keys.length === 0 ||
    keys.every((k) => stripeStatusIsTerminal(k.record.stripe_status))
  )
    return "gone";
  const active = keys.find((k) => deriveStatus(k.record) === "active");
  return active ? active.record.plan : "inactive";
}

/**
 * Check one subscription against pack `builtAt` within `budget()` subrequests. Complete when
 * every watched subject was compared (and the digest, if due, was sent).
 */
async function checkSubscription(
  env: Env,
  watch: WatchService,
  subscription: string,
  builtAt: string,
  ctx: CheckContext,
  budget: () => number,
  report: CheckReport,
): Promise<boolean> {
  const plan = await subscriptionPlan(env, subscription, ctx);
  if (plan === "gone") {
    ctx.spend(3);
    await forgetWatch(env, subscription);
    report.subscriptions_deleted++;
    return true;
  }
  if (plan === "inactive") return true;
  for (;;) {
    const room = budget();
    if (room < 1) return false;
    ctx.spend(1);
    const p = await watch.sub<{ items: PendingItem[]; remaining: number }>(
      subscription,
      "pending",
      {
        built_at: builtAt,
        max: room,
        maxSubjects: WATCH_LIMITS[plan].subjects,
      },
    );
    if (p.items.length === 0) break;
    const before = ctx.cache.size;
    report.changes += await compareBatch(
      watch,
      subscription,
      builtAt,
      p.items,
      ctx,
    );
    report.subjects_read += ctx.cache.size - before;
    if (p.remaining <= p.items.length) break;
  }
  ctx.spend(1);
  const d = await watch.sub<{
    sent: boolean;
    email: string | null;
    alert_id: string | null;
    changes: StoredChange[];
  }>(subscription, "digest", { built_at: builtAt });
  if (
    !d.sent &&
    d.email &&
    d.alert_id &&
    d.changes.length > 0 &&
    alertsReady(env)
  ) {
    ctx.spend(2);
    if (await sendDigest(env, d.email, d.alert_id, builtAt, d.changes)) {
      report.digests++;
      await watch.sub(subscription, "digest_sent", {
        built_at: builtAt,
        now: new Date(ctx.now()).toISOString(),
      });
    }
  }
  return true;
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
    /** Subrequests this run may make (default WATCH_CHECK.subrequests). */
    budget?: number;
  } = {},
): Promise<CheckReport> {
  const report: CheckReport = {
    state: "off",
    subscriptions_done: 0,
    subscriptions_deleted: 0,
    subjects_read: 0,
    changes: 0,
    digests: 0,
    subrequests: 0,
  };
  const watch = env.WATCH;
  if (!watchEnabled(env) || !watch || (!deps.reader && !env.REGISTRY))
    return report;
  const now = deps.now ?? Date.now;
  const reader = deps.reader ?? registryReader(env.REGISTRY!, { now });
  const ctx = newContext(reader, now, (n) => (report.subrequests += n));
  const budget = Math.min(
    deps.budget ?? WATCH_CHECK.subrequests,
    WATCH_CHECK.subrequests,
  );
  const left = () => budget - report.subrequests;

  ctx.spend(1);
  const builtAt = await reader.builtAt();
  if (!builtAt) return { ...report, state: "no_pack" };
  report.built_at = builtAt;
  ctx.spend(1);
  const begin = await watch.index<{
    state: CheckReport["state"];
    owners: string[];
  }>("begin", { built_at: builtAt, now: now(), lease_ms: WATCH_CHECK.leaseMs });
  report.state = begin.state;
  if (begin.state !== "run") return report;
  try {
    for (const owner of begin.owners) {
      if (left() < WATCH_CHECK.perOwner + 1) break;
      const subscription = owner.replace(/^sub:/, "");
      const complete = await checkSubscription(
        env,
        watch,
        subscription,
        builtAt,
        ctx,
        () => left() - WATCH_CHECK.perOwner,
        report,
      );
      if (!complete) break;
      ctx.spend(1);
      await watch.index("done", { owner, built_at: builtAt });
      report.subscriptions_done++;
    }
  } catch (err) {
    // The registry or storage did not answer: stop here; the next run resumes.
    console.error(
      JSON.stringify({
        msg: "watch check stopped",
        error: err instanceof Error ? err.name : typeof err,
      }),
    );
  } finally {
    ctx.spend(1);
    const end = await watch.index<{ left: number }>("end", {
      built_at: builtAt,
    });
    report.left = end.left;
  }
  return report;
}
