/**
 * Usage counters: how the hosted service is used, without recording who used it.
 *
 * Off unless USAGE_COUNTERS_ENABLED is exactly "true". When on, the Worker keeps small in-memory
 * counters per isolate and writes them to KV (the existing KEYS namespace, under `usage:v1:`), one
 * key per UTC day and isolate: `usage:v1:<YYYY-MM-DD>:<isolate id>`. An isolate only ever writes
 * its own key, so isolates never overwrite each other, and the reader (scripts/ops/usage.mjs)
 * adds them up. Keys expire after 40 days.
 *
 * What is kept, all bounded:
 * - Counters, named `<event>|<dimension>|...`. Dimensions are path groups, tool names, region
 *   prefixes (`us-48`), tiers, reasons, plan and interval. Every dimension is cleaned (lowercase,
 *   32 characters of letters, digits and _ . - plus the slash and star of path groups, else "other") and one isolate keeps at most MAX_KEYS distinct
 *   counters a day (the rest add to `overflow`). Never a URL, address, URN, key or email.
 * - Distinct callers per tier, as HyperLogLog sketches (usage-sketch.ts) of values that are
 *   already hashes: the Worker's daily salted address hash (keyless), the OAuth connection's
 *   subject, or the key ID. A sketch cannot be turned back into a caller, and it merges across
 *   isolates and days.
 * - Cost: counting is a memory update, no subrequest. Writing is one KV put per isolate at most
 *   every FLUSH_MS, from waitUntil, after the response. No sampling. What cannot be known: counts
 *   an isolate had not written when it was evicted (up to FLUSH_MS of events), and callers across
 *   days for keyless addresses (the hash rotates daily, so a returning address counts once a day).
 * - Event rows (not requests) are also written to the existing Analytics Engine dataset (USAGE),
 *   as index "evt", blob1 the event name, blobs 2 to 4 its dimensions, double1 the count, so the
 *   history can be queried by SQL with a token that can read Analytics Engine.
 *
 * Registry answers: `lookup` counts the charged lookups (by tool, region and caller kind);
 * `lookup_empty` counts answers that found nothing, by tool, outcome and caller kind: "free"
 * (not counted, within the hourly guard), "charged" (past the guard, also in `lookup`) or
 * "not_loaded" (a coverage miss). The miss rate is lookup_empty over lookup_empty plus the
 * answers that found something (lookup minus lookup_empty "charged"). No query text is kept.
 *
 * Counting never throws and never changes a response.
 */
import type { Env } from "./types.ts";
import {
  newSketch,
  sketchAdd,
  sketchFromString,
  sketchToString,
} from "./usage-sketch.ts";

export const USAGE_KEY_PREFIX = "usage:v1:";
export const USAGE_TTL_SECONDS = 40 * 24 * 60 * 60;
export const FLUSH_MS = 30_000;
export const MAX_KEYS = 300;

export type EventName =
  | "req"
  | "mcp_call"
  | "lookup"
  /** A registry answer that found nothing: [tool, "free" | "charged" | "not_loaded", caller kind]. */
  | "lookup_empty"
  | "quota_exhausted"
  | "plan_required"
  | "history_note"
  | "checkout_start"
  | "checkout_complete"
  | "report"
  | "model_call";

/** The callers kinds sketches are kept for. */
export const CALLER_KINDS = [
  "keyless",
  "oauth_free",
  "free_key",
  "pro",
  "team",
] as const;
export type CallerKind = (typeof CALLER_KINDS)[number];

export interface UsageRecord {
  v: 1;
  day: string;
  isolate: string;
  updated: string;
  counters: Record<string, number>;
  callers: Record<string, string>;
}

export function usageEnabled(env: Pick<Env, "USAGE_COUNTERS_ENABLED">) {
  return env.USAGE_COUNTERS_ENABLED === "true";
}

/** A dimension value: lowercase [a-z0-9_.*\/-], at most 32 characters, else "other". */
export function dim(value: unknown): string {
  if (typeof value !== "string") return "other";
  const v = value.toLowerCase();
  if (!/^[a-z0-9_.*/-]{1,32}$/.test(v)) return "other";
  // Look-alikes of personal or opaque values are refused too: an IPv4 address, long digit runs
  // (ids, phone numbers), long hex strings (hashes, tokens).
  if (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ||
    /\d{5,}/.test(v) ||
    /^[0-9a-f]{16,}$/.test(v)
  )
    return "other";
  return v;
}

/** A region prefix (`us-48`, `us-tx`), "search" or "other". */
export function regionDim(value: unknown): string {
  return typeof value === "string" &&
    /^(us-[0-9]{2}|us-[a-z]{2}|search|other)$/.test(value)
    ? value
    : "other";
}

/** The kind of a free-or-paid caller from the plan name on its key record. */
export function callerKind(
  plan: string | undefined,
  oauthFree: boolean,
): CallerKind {
  if (oauthFree) return "oauth_free";
  if (plan === undefined) return "keyless";
  if (plan === "pro" || plan === "team") return plan;
  return "free_key";
}

// ---- Paths ---------------------------------------------------------------------------------

/** Top-level site paths that get their own group; anything else is "other". */
const SITE_SECTIONS = new Set([
  "pricing",
  "try",
  "lookup",
  "texas",
  "mcp",
  "coverage",
  "status",
  "security",
  "assurance",
  "sla",
  "privacy",
  "terms",
  "calculators",
  "markets",
  "market",
  "property",
  "properties",
  "parcel",
  "parcels",
  "county",
  "counties",
  "docs",
  "account",
  "billing",
  "authorize",
  "free-key",
]);
const SITE_FILES = new Set([
  "llms.txt",
  "robots.txt",
  "sitemap.xml",
  "favicon.svg",
  "styles.css",
]);
const ASSET_EXTENSION =
  /\.(css|js|mjs|json|png|jpg|jpeg|svg|ico|webp|gif|woff2?|txt|xml|map|pdf)$/;

export interface PathClass {
  surface: "mcp" | "rest" | "site" | "other";
  group: string;
}

/**
 * The surface and path group of a request: bounded by construction. `apiHost`: the request came
 * in on the API host (api.*), where everything that is not /mcp is REST.
 */
export function classifyPath(
  path: string,
  apiHost: boolean,
  status: number,
): PathClass {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/mcp" || p === "/mcp/signin")
    return { surface: "mcp", group: "/mcp" };
  if (p === "/v1" || p.startsWith("/v1/") || apiHost) {
    if (status === 404) return { surface: "rest", group: "unknown" };
    const kept: string[] = [];
    for (const seg of p.split("/").slice(1, 4)) {
      // Opaque tokens (report downloads, claim links) are long or mixed: dropped.
      if (!/^(v1|[a-z][a-z_.-]{0,30})$/.test(seg)) break;
      kept.push(seg);
    }
    return {
      surface: "rest",
      group: kept.length === 0 ? "/" : `/${kept.join("/")}`.slice(0, 32),
    };
  }
  if (p === "/") return { surface: "site", group: "/" };
  const segs = p.split("/").filter(Boolean);
  const first = segs[0]!.toLowerCase();
  if (segs.length === 1 && SITE_FILES.has(first))
    return { surface: "site", group: `/${first}` };
  if (ASSET_EXTENSION.test(p.toLowerCase()))
    return { surface: "site", group: "asset" };
  if (SITE_SECTIONS.has(first))
    return {
      surface: "site",
      group: segs.length === 1 ? `/${first}` : `/${first}/*`,
    };
  return { surface: "site", group: "other" };
}

export function statusClass(status: number): string {
  return status >= 100 && status < 600
    ? `${Math.floor(status / 100)}xx`
    : "other";
}

// ---- State ---------------------------------------------------------------------------------

interface DayState {
  day: string;
  counters: Map<string, number>;
  callers: Map<string, Uint8Array>;
  dirty: boolean;
}

interface Runtime {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  waitUntil?: (p: Promise<unknown>) => void;
}

const runtime: Runtime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

let isolateId: string | undefined;
let state: DayState | undefined;
let lastFlush = 0;
let timerSet = false;

function isolate(): string {
  return (isolateId ??= crypto.randomUUID().replace(/-/g, "").slice(0, 12));
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** For tests: forget everything and inject the clock, the sleep and waitUntil. */
export function resetUsageForTests(over: Partial<Runtime> = {}): void {
  state = undefined;
  isolateId = undefined;
  lastFlush = 0;
  timerSet = false;
  runtime.now = over.now ?? (() => Date.now());
  runtime.sleep = over.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  runtime.waitUntil = over.waitUntil;
}

/** The request's waitUntil, kept so a flush can run after the response. */
export function setUsageWaitUntil(
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
): void {
  if (waitUntil) runtime.waitUntil = waitUntil;
}

function current(): DayState {
  const day = dayOf(runtime.now());
  if (!state || state.day !== day) {
    state = { day, counters: new Map(), callers: new Map(), dirty: false };
    lastFlush = 0;
  }
  return state;
}

export function snapshot(s: DayState = current()): UsageRecord {
  return {
    v: 1,
    day: s.day,
    isolate: isolate(),
    updated: new Date(runtime.now()).toISOString(),
    counters: Object.fromEntries(s.counters),
    callers: Object.fromEntries(
      [...s.callers].map(([k, v]) => [k, sketchToString(v)]),
    ),
  };
}

/** Keeps a counter key short and free of the separator. */
function counterKey(name: string, dims: string[]): string {
  return [name, ...dims.map(dim)].join("|");
}

function bump(s: DayState, key: string, n: number): void {
  const k =
    s.counters.has(key) || s.counters.size < MAX_KEYS ? key : "overflow";
  s.counters.set(k, (s.counters.get(k) ?? 0) + n);
  s.dirty = true;
}

// ---- Writing -------------------------------------------------------------------------------

async function flush(env: Env, s: DayState): Promise<void> {
  if (!s.dirty) return;
  s.dirty = false;
  lastFlush = runtime.now();
  try {
    await env.KEYS.put(
      `${USAGE_KEY_PREFIX}${s.day}:${isolate()}`,
      JSON.stringify(snapshot(s)),
      { expirationTtl: USAGE_TTL_SECONDS },
    );
  } catch {
    s.dirty = true; // try again at the next interval
    console.error(JSON.stringify({ msg: "usage flush failed" }));
  }
}

function track(p: Promise<unknown>): void {
  if (runtime.waitUntil) {
    try {
      runtime.waitUntil(p);
      return;
    } catch {
      // a finished request's context: let the promise run on its own
    }
  }
  void p;
}

/** Writes now when FLUSH_MS has passed since the last write, otherwise once, later. */
function schedule(env: Env, s: DayState): void {
  const wait = FLUSH_MS - (runtime.now() - lastFlush);
  if (wait <= 0) {
    track(flush(env, s));
    return;
  }
  if (timerSet) return;
  timerSet = true;
  track(
    runtime.sleep(Math.min(wait, FLUSH_MS)).then(async () => {
      timerSet = false;
      await flush(env, s);
    }),
  );
}

// ---- Counting ------------------------------------------------------------------------------

/** Count one event. A no-op unless the master variable is "true"; never throws. */
export function countEvent(
  env: Env,
  name: EventName,
  dims: unknown[] = [],
  n = 1,
): void {
  if (!usageEnabled(env)) return;
  try {
    const clean = dims.map((d) => dim(d));
    const s = current();
    bump(s, counterKey(name, clean), n);
    if (name !== "req" && env.USAGE) {
      env.USAGE.writeDataPoint({
        indexes: ["evt"],
        blobs: [name, clean[0] ?? "", clean[1] ?? "", clean[2] ?? ""],
        doubles: [n],
      });
    }
    schedule(env, s);
  } catch {
    // counting must never break a request
  }
}

/**
 * Note a caller for the distinct counts. `subject` must already be a hash or an ID (the daily
 * address hash, an OAuth subject, a key ID); it is folded into a sketch and not kept.
 */
export function noteCaller(env: Env, kind: CallerKind, subject: string): void {
  if (!usageEnabled(env)) return;
  try {
    const s = current();
    let sketch = s.callers.get(kind);
    if (!sketch) s.callers.set(kind, (sketch = newSketch()));
    sketchAdd(sketch, subject);
    s.dirty = true;
    schedule(env, s);
  } catch {
    // never breaks a request
  }
}

/** One request: surface, path group and status class. */
export function recordRequest(
  env: Env,
  req: { host: string; path: string; status: number },
): void {
  if (!usageEnabled(env)) return;
  const c = classifyPath(
    req.path,
    req.host.toLowerCase().startsWith("api."),
    req.status,
  );
  countEvent(env, "req", [c.surface, c.group, statusClass(req.status)]);
}

/** Reads a stored record back; undefined for anything that is not one. */
export function parseUsageRecord(text: string): UsageRecord | undefined {
  try {
    const v = JSON.parse(text) as Partial<UsageRecord>;
    if (
      v?.v !== 1 ||
      typeof v.day !== "string" ||
      typeof v.counters !== "object" ||
      v.counters === null
    )
      return undefined;
    const callers: Record<string, string> = {};
    for (const [k, t] of Object.entries(v.callers ?? {}))
      if (sketchFromString(t)) callers[k] = t as string;
    return {
      v: 1,
      day: v.day,
      isolate: String(v.isolate ?? ""),
      updated: String(v.updated ?? ""),
      counters: v.counters as Record<string, number>,
      callers,
    };
  } catch {
    return undefined;
  }
}

// ---- Helpers for the router ----------------------------------------------------------------

/** MCP tools/call messages by tool name (names outside `known` count as "other"). */
export function countToolCalls(
  env: Env,
  items: unknown[],
  tier: string,
  known: ReadonlySet<string>,
): void {
  if (!usageEnabled(env)) return;
  for (const m of items) {
    const c = m as { method?: unknown; params?: { name?: unknown } } | null;
    if (c?.method !== "tools/call") continue;
    const name = c.params?.name;
    countEvent(env, "mcp_call", [
      typeof name === "string" && known.has(name) ? name : "other",
      tier,
    ]);
  }
}

/** A tool answer that a free caller received with earlier values cut (gating.ts sets history_available). */
function withheld(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null) return false;
  const a = answer as Record<string, unknown>;
  if (a.history_available === "pro") return true;
  const subject = a.subject as Record<string, unknown> | undefined;
  return subject?.history_available === "pro";
}

/**
 * Count the answers in a gated 200 response that had history withheld (a REST body, or the
 * results of an MCP response). Reads a clone of the response, and only with counters on.
 */
export async function countHistoryWithheld(
  env: Env,
  res: Response,
  surface: "mcp" | "rest",
  kind: CallerKind,
): Promise<void> {
  if (!usageEnabled(env)) return;
  try {
    const parsed: unknown = await res.clone().json();
    const answers: unknown[] = [];
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
      if (surface === "rest") {
        answers.push(m);
        continue;
      }
      const r = (m as { result?: { structuredContent?: unknown } } | null)
        ?.result;
      if (r?.structuredContent !== undefined) answers.push(r.structuredContent);
    }
    const n = answers.filter(withheld).length;
    if (n > 0) countEvent(env, "history_note", [surface, kind], n);
  } catch {
    // not JSON: nothing to count
  }
}

/** A checkout that opened: GET answers 303 (plan and interval in the URL), POST answers 200 with plan and interval. */
export async function countCheckoutStart(
  env: Env,
  request: Request,
  url: URL,
  res: Response,
): Promise<void> {
  if (!usageEnabled(env)) return;
  try {
    let plan: unknown;
    let interval: unknown;
    if (request.method === "GET") {
      if (res.status !== 303) return;
      plan = url.searchParams.get("plan");
      interval = url.searchParams.get("interval");
    } else {
      if (res.status !== 200) return;
      const body = (await res.clone().json()) as {
        plan?: unknown;
        interval?: unknown;
      };
      plan = body.plan;
      interval = body.interval;
    }
    if (plan !== "pro" && plan !== "team") return;
    countEvent(env, "checkout_start", [
      plan,
      interval === "year" ? "year" : "month",
    ]);
  } catch {
    // never breaks a request
  }
}
