/**
 * Metering in one Durable Object class (bound as LIMITER, SQLite-backed). Every subject gets its
 * own object (`meter:ip:<hash of the address>`, `meter:key:<key id>`, `meter:sub:<subscription>`),
 * so each decision below runs single-threaded inside one object and is exact:
 *
 * - Requests per minute: a fixed-window counter in memory. If the object is evicted the window
 *   restarts, which only ever errs in the caller's favour.
 * - Registry lookups per UTC day (no key) or calendar month (UTC, per subscription): fixed-window
 *   counters in the object's SQLite storage, so they survive eviction and restarts. The window
 *   is read from the object's own clock, so every request for one subject agrees on it. An alarm
 *   at the end of each window deletes the ended window's counter (the privacy page promises that
 *   day counts go when the day ends and month counts when the month ends).
 * - Claims: first-writer-wins markers (`claim:<name>`), used where KV's eventual consistency is
 *   not enough (redeeming one checkout session from two regions at once). Deleted after 30 days.
 *
 * The plain per-minute limiter (`objectLimiter`) uses the same class without touching storage.
 */
import type {
  HitResult,
  MeterService,
  QuotaKind,
  QuotaSpec,
  QuotaState,
  RateLimit,
} from "./types.ts";

export interface DurableObjectStubLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}
interface SqlStorageLike {
  exec(
    query: string,
    ...bindings: (string | number)[]
  ): { toArray(): Record<string, unknown>[] };
}
export interface DurableObjectStateLike {
  storage: {
    sql: SqlStorageLike;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAll(): Promise<void>;
  };
}

/** How long a claim is kept; the KV marker written after it covers later reloads. */
export const CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class WindowCounter {
  private windowStart = 0;
  private count = 0;

  private roll(periodMs: number, now: number): void {
    if (now - this.windowStart >= periodMs) {
      this.windowStart = now - (now % periodMs);
      this.count = 0;
    }
  }

  /** Count one request at `now`; true when it is within `limit` for its `periodMs` window. */
  hit(limit: number, periodMs: number, now: number): boolean {
    this.roll(periodMs, now);
    this.count++;
    return this.count <= limit;
  }

  /** True when one more hit at `now` would be within `limit`; counts nothing. */
  peek(limit: number, periodMs: number, now: number): boolean {
    this.roll(periodMs, now);
    return this.count < limit;
  }
}

/** The fixed window `now` falls in, and when it ends (both UTC). */
export function quotaWindow(
  kind: QuotaKind,
  now: number,
): { window: string; resetsAt: number } {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (kind === "day")
    return {
      window: `day:${d.toISOString().slice(0, 10)}`,
      resetsAt: Date.UTC(y, m, d.getUTCDate() + 1),
    };
  return {
    window: `month:${d.toISOString().slice(0, 7)}`,
    resetsAt: Date.UTC(y, m + 1, 1),
  };
}

/** Durable counters and claims for one object. Synchronous, so a read-modify-write is atomic. */
export interface CounterStore {
  getCount(window: string): number;
  setCount(window: string, used: number): void;
  /** Drop counters of earlier windows of the same kind (`day:` or `month:`). */
  pruneBefore(window: string): void;
  getClaim(name: string): string | undefined;
  setClaim(name: string, value: string): void;
  /** Counter and claim rows held. */
  size(): number;
  clearClaims(): void;
  /** The object's storage was wiped (deleteAll): forget anything cached about it. */
  reset(): void;
}

/**
 * CounterStore over a Durable Object's SQLite storage. Tables are created on first use and again
 * after `reset()`: `deleteAll()` drops them, and the object can stay resident afterwards.
 */
export function sqlStore(sql: SqlStorageLike): CounterStore {
  let ready = false;
  const db = () => {
    if (!ready) {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS quota (period TEXT PRIMARY KEY, used INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS claim (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      ready = true;
    }
    return sql;
  };
  return {
    reset() {
      ready = false;
    },
    getCount(window) {
      const row = db()
        .exec("SELECT used FROM quota WHERE period = ?", window)
        .toArray()[0];
      return row ? Number(row.used) : 0;
    },
    setCount(window, used) {
      db().exec(
        "INSERT INTO quota (period, used) VALUES (?, ?) ON CONFLICT(period) DO UPDATE SET used = excluded.used",
        window,
        used,
      );
    },
    pruneBefore(window) {
      const kind = window.slice(0, window.indexOf(":") + 1);
      db().exec(
        "DELETE FROM quota WHERE period < ? AND substr(period, 1, ?) = ?",
        window,
        kind.length,
        kind,
      );
    },
    getClaim(name) {
      const row = db()
        .exec("SELECT value FROM claim WHERE name = ?", name)
        .toArray()[0];
      return row ? String(row.value) : undefined;
    },
    setClaim(name, value) {
      db().exec(
        "INSERT INTO claim (name, value) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
        name,
        value,
      );
    },
    size() {
      const row = db()
        .exec(
          "SELECT (SELECT COUNT(*) FROM quota) + (SELECT COUNT(*) FROM claim) AS n",
        )
        .toArray()[0];
      return Number(row?.n ?? 0);
    },
    clearClaims() {
      db().exec("DELETE FROM claim");
    },
  };
}

function quotaState(used: number, limit: number, resetsAt: number): QuotaState {
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resets_at: new Date(resetsAt).toISOString(),
  };
}

/** One caller's meter: the decisions the Durable Object makes, testable without the runtime. */
export class Meter {
  private readonly minute = new WindowCounter();
  private readonly storeFactory: () => CounterStore;
  private storeInstance: CounterStore | undefined;
  private readonly now: () => number;

  constructor(store: () => CounterStore, now: () => number = Date.now) {
    this.storeFactory = store;
    this.now = now;
  }

  private get store(): CounterStore {
    this.storeInstance ??= this.storeFactory();
    return this.storeInstance;
  }

  /** Plain per-minute limiter; `peek` checks without counting. */
  minuteOnly(limit: number, peek: boolean): boolean {
    return peek
      ? this.minute.peek(limit, 60_000, this.now())
      : this.minute.hit(limit, 60_000, this.now());
  }

  /**
   * Count one request against `perMinute` (null: no minute limit here). When it is allowed and
   * `quota` is given, also take up to `quota.n` registry lookups from the current window (fewer
   * when the window runs short; a request refused by the minute limit takes none).
   */
  hit(
    perMinute: number | null,
    quota?: QuotaSpec,
  ): HitResult & { window_ends?: number } {
    const now = this.now();
    const ok =
      perMinute === null ? true : this.minute.hit(perMinute, 60_000, now);
    if (!quota) return { ok, granted: 0 };
    const { window, resetsAt } = quotaWindow(quota.kind, now);
    this.store.pruneBefore(window);
    const used = this.store.getCount(window);
    const granted = ok ? Math.max(0, Math.min(quota.n, quota.limit - used)) : 0;
    if (granted > 0) this.store.setCount(window, used + granted);
    // The store was touched (tables exist even when nothing was counted): the caller schedules
    // the end-of-window alarm, which empties the object once nothing is left.
    return {
      ok,
      granted,
      quota: quotaState(used + granted, quota.limit, resetsAt),
      window_ends: resetsAt,
    };
  }

  /**
   * Give back `n` lookups taken in the window that ends at `resetsAt` (the registry could not
   * answer). Nothing happens once that window has ended.
   */
  refund(kind: QuotaKind, n: number, resetsAt: string): QuotaState | undefined {
    const { window, resetsAt: end } = quotaWindow(kind, this.now());
    if (new Date(end).toISOString() !== resetsAt || n <= 0) return undefined;
    const used = Math.max(0, this.store.getCount(window) - n);
    this.store.setCount(window, used);
    return quotaState(used, 0, end);
  }

  /** The store was wiped. */
  storageCleared(): void {
    this.storeInstance?.reset();
  }

  /**
   * Alarm work: drop counters of ended windows and, once their time is up, claims. Returns when
   * the next alarm is due, or undefined when nothing is left (the object can be emptied).
   */
  cleanup(): number | undefined {
    const now = this.now();
    this.store.pruneBefore(quotaWindow("day", now).window);
    this.store.pruneBefore(quotaWindow("month", now).window);
    this.store.clearClaims();
    if (this.store.size() === 0) return undefined;
    // What is left is the current window: of the day if a day counter is, else of the month.
    const day = quotaWindow("day", now);
    return this.store.getCount(day.window) > 0
      ? day.resetsAt
      : quotaWindow("month", now).resetsAt;
  }

  /** The current window's usage, counting nothing; `window_ends` as for `hit`. */
  quota(kind: QuotaKind, limit: number): QuotaState & { window_ends: number } {
    const { window, resetsAt } = quotaWindow(kind, this.now());
    return {
      ...quotaState(this.store.getCount(window), limit, resetsAt),
      window_ends: resetsAt,
    };
  }

  /** Store `value` under `name` unless something is stored already; returns what is stored. */
  claim(name: string, value: string): string {
    const existing = this.store.getClaim(name);
    if (existing !== undefined) return existing;
    this.store.setClaim(name, value);
    return value;
  }
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

/** The Durable Object class (bound as LIMITER). */
export class RateLimiterObject {
  private readonly meter: Meter;
  private readonly state: DurableObjectStateLike;
  private readonly now: () => number;
  /** The alarm known to be set (avoids a storage read per request). */
  private alarmAt: number | null | undefined;

  constructor(
    state: DurableObjectStateLike,
    _env?: unknown,
    opts: { store?: CounterStore; now?: () => number } = {},
  ) {
    this.state = state;
    this.now = opts.now ?? Date.now;
    this.meter = new Meter(
      () => opts.store ?? sqlStore(state.storage.sql),
      this.now,
    );
  }

  /** Make sure an alarm fires by `at` (the earliest pending deletion). */
  private async alarmBy(at: number): Promise<void> {
    if (this.alarmAt === undefined)
      this.alarmAt = await this.state.storage.getAlarm();
    if (this.alarmAt !== null && this.alarmAt <= at) return;
    await this.state.storage.setAlarm(at);
    this.alarmAt = at;
  }

  async alarm(): Promise<void> {
    this.alarmAt = null;
    const next = this.meter.cleanup();
    if (next === undefined) {
      await this.state.storage.deleteAll();
      // deleteAll dropped the tables; the next request recreates them.
      this.meter.storageCleared();
    } else await this.alarmBy(next);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/hit") {
      const b = (await request.json()) as {
        perMinute: number | null;
        quota?: QuotaSpec;
      };
      const { window_ends, ...result } = this.meter.hit(b.perMinute, b.quota);
      if (window_ends !== undefined) await this.alarmBy(window_ends);
      return jsonResponse(result);
    }
    if (url.pathname === "/quota") {
      const b = (await request.json()) as { kind: QuotaKind; limit: number };
      const { window_ends, ...state } = this.meter.quota(b.kind, b.limit);
      await this.alarmBy(window_ends);
      return jsonResponse(state);
    }
    if (url.pathname === "/refund") {
      const b = (await request.json()) as {
        kind: QuotaKind;
        n: number;
        resets_at: string;
      };
      return jsonResponse({
        refunded: this.meter.refund(b.kind, b.n, b.resets_at) !== undefined,
      });
    }
    if (url.pathname === "/claim") {
      const b = (await request.json()) as { name: string; value: string };
      const value = this.meter.claim(b.name, b.value);
      await this.alarmBy(this.now() + CLAIM_TTL_MS);
      return jsonResponse({ value });
    }
    const limit = Number(url.searchParams.get("limit") ?? "60");
    const ok = this.meter.minuteOnly(limit, url.searchParams.has("peek"));
    return new Response(ok ? "1" : "0");
  }
}

async function call<T>(
  ns: DurableObjectNamespaceLike,
  name: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await ns
    .get(ns.idFromName(name))
    .fetch(`https://limiter${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  if (!res.ok) throw new Error(`limiter answered ${res.status}`);
  return (await res.json()) as T;
}

/** A per-minute RateLimit backed by the LIMITER namespace; `prefix` keeps uses apart. */
export function objectLimiter(
  ns: DurableObjectNamespaceLike,
  prefix: string,
  limit: number,
): RateLimit {
  const ask = async (key: string, peek: boolean) => {
    const stub = ns.get(ns.idFromName(`${prefix}:${key}`));
    const res = await stub.fetch(
      `https://limiter/?limit=${limit}${peek ? "&peek=1" : ""}`,
    );
    return { success: (await res.text()) === "1" };
  };
  return {
    limit: ({ key }) => ask(key, false),
    peek: ({ key }) => ask(key, true),
  };
}

/** The caller meter (minute limit + registry quota) and claims, backed by the LIMITER namespace. */
export function objectMeter(ns: DurableObjectNamespaceLike): MeterService {
  return {
    hit: (subject, perMinute, quota) =>
      call<HitResult>(ns, `meter:${subject}`, "/hit", { perMinute, quota }),
    consume: (subject, quota) =>
      call<HitResult>(ns, `meter:${subject}`, "/hit", {
        perMinute: null,
        quota,
      }),
    refund: async (subject, kind, n, resets_at) => {
      await call(ns, `meter:${subject}`, "/refund", { kind, n, resets_at });
    },
    quota: (subject, kind, limit) =>
      call<QuotaState>(ns, `meter:${subject}`, "/quota", { kind, limit }),
    claim: async (name, value) =>
      (
        await call<{ value: string }>(ns, `claim:${name}`, "/claim", {
          name,
          value,
        })
      ).value,
  };
}

/**
 * The bucket a client address is metered under: IPv4 as is, IPv6 by its /64 (one subscriber
 * line usually holds a whole /64, so per-/128 counting would be trivially bypassed). An
 * IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function ipBucket(address: string): string {
  const ip = address.trim().toLowerCase().split("%")[0] ?? "";
  if (!ip.includes(":")) return ip.slice(0, 64) || "unknown";
  const halves = ip.split("::");
  if (halves.length > 2) return ip.slice(0, 64);
  const parse = (s: string | undefined): string[] | undefined => {
    if (!s) return [];
    const out: string[] = [];
    for (const part of s.split(":")) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(part)) {
        const o = part.split(".").map(Number);
        if (o.some((n) => n > 255)) return undefined;
        out.push(
          ((o[0]! << 8) | o[1]!).toString(16),
          ((o[2]! << 8) | o[3]!).toString(16),
        );
      } else if (/^[0-9a-f]{1,4}$/.test(part))
        out.push(parseInt(part, 16).toString(16));
      else return undefined;
    }
    return out;
  };
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  if (!head || !tail) return ip.slice(0, 64);
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return ip.slice(0, 64);
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const v4 = parseInt(groups[6]!, 16) * 65536 + parseInt(groups[7]!, 16);
    return [24, 16, 8, 0].map((s) => (v4 >>> s) & 255).join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

let warnedNoSalt = false;

/**
 * The meter subject for a caller without a key: a hash of the address bucket (IPv6: the /64),
 * salted with a secret (Worker secret IP_HASH_SALT) and the UTC day. The raw address is never a
 * storage or object name, a day's counts cannot be linked to another day's, and without the
 * secret the hash cannot be reversed by hashing every IPv4 address.
 */
export async function addressSubject(
  address: string,
  now: number = Date.now(),
  secret?: string,
): Promise<string> {
  if (!secret && !warnedNoSalt) {
    warnedNoSalt = true;
    console.warn(
      JSON.stringify({
        msg: "IP_HASH_SALT is not set; address hashes use the date only",
      }),
    );
  }
  const day = quotaWindow("day", now).window;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `factlot-meter|${secret ?? ""}|${day}|${ipBucket(address)}`,
    ),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ip:${hex.slice(0, 32)}`;
}
