/**
 * Watch lists: storage, inside the LIMITER Durable Object class (SQLite storage; no new binding
 * or migration). Two kinds of object, by name:
 *
 *   watch:sub:<subscription>   one subscription's lists, subjects, fingerprints, changes, alert
 *                              settings
 *   watch:index                the subscriptions that watch something (or have an alert address),
 *                              and the progress of the check of the current registry pack
 *
 * These objects never set an alarm, so the meter's alarm (which wipes an object whose counters are
 * all spent) never runs on them. Every request is one synchronous run of SQL statements, so each
 * operation applies whole or not at all.
 *
 * Checks are numbered: the index gives each new pack `built_at` it sees a new sequence number
 * (`seq`), so a pack that is rolled back and deployed again is compared again, and its changes are
 * stored under the new number instead of being taken for ones already stored.
 *
 * Tables of a subscription object:
 *   w_lists    (name, created_at)
 *   w_subjects (list, urn, aspects, added_at)            one row per list membership
 *   w_prints   (urn, label, print, status, built_at,      one fingerprint per watched URN; `seq` is
 *               seq, checked_at, fails, skipped_seq,      the check it was compared in, `fails` the
 *               last_error)                               failed reads in a row, `skipped_seq` a
 *                                                         check it was given up for
 *   w_changes  (id, urn, aspect, built_at, seq,          unique per (urn, aspect, seq)
 *               detected_at, body)
 *   w_meta     (name, value)                              alert_email, alert_id (confirmed),
 *                                                         pending_email (masked: the full
 *                                                         address waits in KV, which deletes
 *                                                         it after 24 hours), pending_id,
 *                                                         pending_expires, confirm_last,
 *                                                         confirm_day, digest:<seq>
 * Tables of the index object:
 *   w_owners   (owner, done_seq)
 *   w_meta     seq, built_at, done_seq, lease_until
 */
import type { Aspect, ChangeBody } from "./watch-print.ts";

export interface SqlLike {
  exec(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): Record<string, unknown>[] };
}

export interface WatchStorage {
  sql: SqlLike;
  deleteAll(): Promise<void>;
}

/** Changes kept per subscription: newest first, at most this many, none older than 400 days. */
export const MAX_CHANGES_KEPT = 10_000;
export const CHANGE_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;

const SUB_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS w_lists (name TEXT PRIMARY KEY, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS w_subjects (list TEXT NOT NULL, urn TEXT NOT NULL, aspects TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (list, urn))",
  "CREATE INDEX IF NOT EXISTS w_subjects_urn ON w_subjects (urn)",
  "CREATE TABLE IF NOT EXISTS w_prints (urn TEXT PRIMARY KEY, label TEXT, print TEXT NOT NULL, status TEXT NOT NULL, built_at TEXT NOT NULL, seq INTEGER NOT NULL, checked_at TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, skipped_seq INTEGER NOT NULL DEFAULT 0, last_error TEXT)",
  "CREATE TABLE IF NOT EXISTS w_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, urn TEXT NOT NULL, aspect TEXT NOT NULL, built_at TEXT NOT NULL, seq INTEGER NOT NULL, detected_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (urn, aspect, seq))",
  "CREATE INDEX IF NOT EXISTS w_changes_built_at ON w_changes (built_at)",
  "CREATE INDEX IF NOT EXISTS w_changes_seq ON w_changes (seq)",
  "CREATE INDEX IF NOT EXISTS w_changes_detected ON w_changes (detected_at)",
  "CREATE TABLE IF NOT EXISTS w_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
const INDEX_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS w_owners (owner TEXT PRIMARY KEY, done_seq INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS w_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

const rows = (sql: SqlLike, q: string, ...b: (string | number | null)[]) =>
  sql.exec(q, ...b).toArray();

function getMeta(sql: SqlLike, name: string): string | undefined {
  const r = rows(sql, "SELECT value FROM w_meta WHERE name = ?", name)[0];
  return r ? String(r.value) : undefined;
}
function setMeta(sql: SqlLike, name: string, value: string): void {
  sql.exec(
    "INSERT INTO w_meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    name,
    value,
  );
}
function deleteMeta(sql: SqlLike, name: string): void {
  sql.exec("DELETE FROM w_meta WHERE name = ?", name);
}
const count = (sql: SqlLike, q: string, ...b: (string | number | null)[]) =>
  Number(rows(sql, q, ...b)[0]?.n ?? 0);

/** Whether the object holds any table yet (a read that creates nothing). */
function hasTables(sql: SqlLike): boolean {
  return (
    rows(
      sql,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'w_meta'",
    ).length > 0
  );
}

// --- A subscription's object -------------------------------------------------------------------

export interface NewSubject {
  urn: string;
  label: string | null;
  print: string;
  status: string;
  built_at: string;
}

export interface StoredChange extends ChangeBody {
  id: number;
  urn: string;
  label: string | null;
  built_at: string;
  detected_at: string;
}

export interface AlertState {
  /** The confirmed address alerts go to, or null. */
  email: string | null;
  alert_id: string | null;
  /** An address waiting for its confirmation link, masked (u•••r@example.com), or null. */
  pending_email: string | null;
  pending_id: string | null;
  pending_expires: string | null;
}

type Args = Record<string, unknown>;

const subjectCount = (sql: SqlLike) =>
  count(sql, "SELECT COUNT(*) AS n FROM w_subjects");

function changeRow(r: Record<string, unknown>): StoredChange {
  return {
    id: Number(r.id),
    urn: String(r.urn),
    label: r.label === null || r.label === undefined ? null : String(r.label),
    built_at: String(r.built_at),
    detected_at: String(r.detected_at),
    ...(JSON.parse(String(r.body)) as ChangeBody),
  };
}

const CHANGE_COLUMNS =
  "c.id, c.urn, c.aspect, c.built_at, c.detected_at, c.body, p.label";

/** Aspects of every list a URN is in, together. */
function unionAspects(sql: SqlLike, urn: string): Aspect[] {
  const set = new Set<Aspect>();
  for (const r of rows(
    sql,
    "SELECT aspects FROM w_subjects WHERE urn = ?",
    urn,
  ))
    for (const a of String(r.aspects).split(",")) if (a) set.add(a as Aspect);
  return [...set];
}

/** Drop fingerprints and changes of URNs no longer in any list; the count of URNs dropped. */
function dropOrphans(sql: SqlLike): number {
  const n = count(
    sql,
    "SELECT COUNT(*) AS n FROM w_prints WHERE urn NOT IN (SELECT urn FROM w_subjects)",
  );
  sql.exec(
    "DELETE FROM w_changes WHERE urn NOT IN (SELECT urn FROM w_subjects)",
  );
  sql.exec(
    "DELETE FROM w_prints WHERE urn NOT IN (SELECT urn FROM w_subjects)",
  );
  return n;
}

/** Retention: the newest MAX_CHANGES_KEPT changes, none older than CHANGE_RETENTION_DAYS. */
function prune(sql: SqlLike, now: number): void {
  const cutoff = new Date(now - CHANGE_RETENTION_DAYS * DAY_MS).toISOString();
  sql.exec("DELETE FROM w_changes WHERE detected_at < ?", cutoff);
  sql.exec(
    "DELETE FROM w_changes WHERE id <= (SELECT MAX(id) FROM w_changes) - ?",
    MAX_CHANGES_KEPT,
  );
}

const nowOf = (a: Args) =>
  typeof a.now === "string"
    ? Date.parse(a.now)
    : typeof a.now === "number"
      ? a.now
      : Date.now();

/** URNs checked under the plan: the first `max` by their first membership (a downgrade keeps the oldest). */
function checkedUrns(sql: SqlLike, max: number): string[] {
  return rows(
    sql,
    "SELECT urn FROM (SELECT urn, MIN(added_at) AS first FROM w_subjects GROUP BY urn ORDER BY first, urn LIMIT ?)",
    max,
  ).map((r) => String(r.urn));
}

function alertState(sql: SqlLike): AlertState {
  return {
    email: getMeta(sql, "alert_email") ?? null,
    alert_id: getMeta(sql, "alert_id") ?? null,
    pending_email: getMeta(sql, "pending_email") ?? null,
    pending_id: getMeta(sql, "pending_id") ?? null,
    pending_expires: getMeta(sql, "pending_expires") ?? null,
  };
}

const NO_ALERTS: AlertState = {
  email: null,
  alert_id: null,
  pending_email: null,
  pending_id: null,
  pending_expires: null,
};

/** The answer of a read on an empty object, or undefined for an operation that writes. */
function emptyAnswer(op: string, a: Args): unknown {
  switch (op) {
    case "room":
      return {
        list_allowed: Number(a.maxLists) > 0,
        room: Number(a.maxSubjects),
        already: [],
        fresh: a.urns,
        known: [],
      };
    case "list":
      return {
        lists: [],
        subjects: [],
        total: 0,
        distinct: 0,
        over_limit: 0,
        matching: 0,
        next_offset: null,
        alerts: NO_ALERTS,
        last_built_at: null,
      };
    case "changes":
      return {
        changes: [],
        cursor: Math.max(0, Number(a.since ?? 0)),
        more: false,
      };
    case "recent":
      return { changes: [] };
    case "pending":
      return { items: [], remaining: 0, total: 0 };
    case "check_state":
      return { failing: 0, skipped: [] };
    case "alerts_get":
      return NO_ALERTS;
    case "digest_claim":
      return { claimed: false, email: null, alert_id: null, changes: [] };
    case "prune":
      return { ok: true };
  }
  return undefined;
}

/** One operation on a subscription's object. */
export function subscriptionOp(sql: SqlLike, op: string, a: Args): unknown {
  // A read of an object that never held data answers empty and creates nothing (the account
  // page reads every subscription's object).
  if (!hasTables(sql)) {
    const empty = emptyAnswer(op, a);
    if (empty !== undefined) return empty;
  }
  for (const q of SUB_SCHEMA) sql.exec(q);
  // An unconfirmed address's masked form goes once its link has expired.
  if (a.now !== undefined) {
    const exp = getMeta(sql, "pending_expires");
    if (exp !== undefined && Date.parse(exp) <= nowOf(a))
      for (const k of ["pending_email", "pending_id", "pending_expires"])
        deleteMeta(sql, k);
  }
  switch (op) {
    case "room": {
      // Which URNs are new to the list, and how many more the plan allows.
      const list = String(a.list);
      const urns = a.urns as string[];
      const listExists =
        rows(sql, "SELECT 1 AS x FROM w_lists WHERE name = ?", list).length > 0;
      const lists = count(sql, "SELECT COUNT(*) AS n FROM w_lists");
      const already = new Set(
        rows(sql, "SELECT urn FROM w_subjects WHERE list = ?", list).map((r) =>
          String(r.urn),
        ),
      );
      const known = new Set(
        rows(sql, "SELECT urn FROM w_prints").map((r) => String(r.urn)),
      );
      return {
        list_allowed: listExists || lists < Number(a.maxLists),
        room: Math.max(0, Number(a.maxSubjects) - subjectCount(sql)),
        already: urns.filter((u) => already.has(u)),
        fresh: urns.filter((u) => !already.has(u)),
        // Watched in another list already: no registry read needed.
        known: urns.filter((u) => !already.has(u) && known.has(u)),
      };
    }
    case "add": {
      const list = String(a.list);
      const now = String(a.now);
      const seq = Number(a.seq ?? 0);
      const aspects = (a.aspects as string[]).join(",");
      const items = a.items as NewSubject[];
      const lists = count(sql, "SELECT COUNT(*) AS n FROM w_lists");
      const listExists =
        rows(sql, "SELECT 1 AS x FROM w_lists WHERE name = ?", list).length > 0;
      if (!listExists && lists >= Number(a.maxLists))
        return {
          added: [],
          refused: items.map((i) => i.urn),
          reused: [],
          total: subjectCount(sql),
        };
      sql.exec(
        "INSERT INTO w_lists (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
        list,
        now,
      );
      const added: string[] = [];
      const refused: string[] = [];
      // Read for this call, but stored meanwhile by another call: its lookup is given back.
      const reused: string[] = [];
      for (const item of [
        ...items,
        ...((a.known as string[] | undefined) ?? []).map((urn) => ({ urn })),
      ] as NewSubject[]) {
        const inList =
          rows(
            sql,
            "SELECT 1 AS x FROM w_subjects WHERE list = ? AND urn = ?",
            list,
            item.urn,
          ).length > 0;
        if (inList) {
          if (item.print !== undefined) reused.push(item.urn);
          continue;
        }
        if (subjectCount(sql) >= Number(a.maxSubjects)) {
          refused.push(item.urn);
          continue;
        }
        sql.exec(
          "INSERT INTO w_subjects (list, urn, aspects, added_at) VALUES (?, ?, ?, ?)",
          list,
          item.urn,
          aspects,
          now,
        );
        if (item.print !== undefined) {
          const had =
            rows(sql, "SELECT 1 AS x FROM w_prints WHERE urn = ?", item.urn)
              .length > 0;
          if (had) reused.push(item.urn);
          else
            sql.exec(
              "INSERT INTO w_prints (urn, label, print, status, built_at, seq, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
              item.urn,
              item.label,
              item.print,
              item.status,
              item.built_at,
              seq,
              now,
            );
        }
        added.push(item.urn);
      }
      return { added, refused, reused, total: subjectCount(sql) };
    }
    case "remove": {
      const list = String(a.list);
      let removed: number;
      if (a.all === true) {
        removed = count(
          sql,
          "SELECT COUNT(*) AS n FROM w_subjects WHERE list = ?",
          list,
        );
        sql.exec("DELETE FROM w_subjects WHERE list = ?", list);
        sql.exec("DELETE FROM w_lists WHERE name = ?", list);
      } else {
        removed = 0;
        for (const urn of a.urns as string[]) {
          removed += count(
            sql,
            "SELECT COUNT(*) AS n FROM w_subjects WHERE list = ? AND urn = ?",
            list,
            urn,
          );
          sql.exec(
            "DELETE FROM w_subjects WHERE list = ? AND urn = ?",
            list,
            urn,
          );
        }
      }
      const forgotten = dropOrphans(sql);
      const s = alertState(sql);
      return {
        removed,
        forgotten,
        total: subjectCount(sql),
        alerts: s.email !== null || s.pending_email !== null,
      };
    }
    case "list": {
      prune(sql, nowOf(a));
      const lists = rows(
        sql,
        "SELECT l.name, l.created_at, COUNT(s.urn) AS n FROM w_lists l LEFT JOIN w_subjects s ON s.list = l.name GROUP BY l.name ORDER BY l.name",
      ).map((r) => ({
        name: String(r.name),
        created_at: String(r.created_at),
        subjects: Number(r.n),
      }));
      const filter = typeof a.list === "string" ? a.list : null;
      const offset = Math.max(0, Number(a.offset ?? 0));
      const limit = Math.min(500, Math.max(1, Number(a.limit ?? 100)));
      const checked = new Set(checkedUrns(sql, Number(a.maxSubjects)));
      const subjects = rows(
        sql,
        `SELECT s.list, s.urn, s.aspects, s.added_at, p.label, p.built_at, p.status, p.skipped_seq, p.seq, p.last_error, p.fails FROM w_subjects s LEFT JOIN w_prints p ON p.urn = s.urn ${filter === null ? "" : "WHERE s.list = ?"} ORDER BY s.list, s.added_at, s.urn LIMIT ? OFFSET ?`,
        ...(filter === null ? [] : [filter]),
        limit,
        offset,
      ).map((r) => ({
        list: String(r.list),
        urn: String(r.urn),
        label:
          r.label === null || r.label === undefined ? null : String(r.label),
        aspects: String(r.aspects).split(","),
        added_at: String(r.added_at),
        checked_built_at: r.built_at ? String(r.built_at) : null,
        status: r.status ? String(r.status) : "unknown",
        checked: checked.has(String(r.urn)),
        ...(Number(r.fails ?? 0) > 0 ||
        (Number(r.skipped_seq ?? 0) > 0 &&
          Number(r.skipped_seq) >= Number(r.seq ?? 0))
          ? { read_error: r.last_error ? String(r.last_error) : "read failed" }
          : {}),
      }));
      const distinct = count(
        sql,
        "SELECT COUNT(DISTINCT urn) AS n FROM w_subjects",
      );
      const matching = count(
        sql,
        `SELECT COUNT(*) AS n FROM w_subjects ${filter === null ? "" : "WHERE list = ?"}`,
        ...(filter === null ? [] : [filter]),
      );
      return {
        lists,
        subjects,
        total: subjectCount(sql),
        distinct,
        over_limit: Math.max(0, distinct - checked.size),
        matching,
        next_offset:
          offset + subjects.length < matching ? offset + subjects.length : null,
        alerts: alertState(sql),
        last_built_at: getMeta(sql, "last_built_at") ?? null,
      };
    }
    case "changes": {
      prune(sql, nowOf(a));
      const since = Math.max(0, Number(a.since ?? 0));
      const limit = Math.min(200, Math.max(1, Number(a.limit ?? 50)));
      const filter = typeof a.list === "string" ? a.list : null;
      const watched =
        filter === null
          ? null
          : new Map(
              rows(
                sql,
                "SELECT urn, aspects FROM w_subjects WHERE list = ?",
                filter,
              ).map((r) => [
                String(r.urn),
                new Set(String(r.aspects).split(",")),
              ]),
            );
      const out: StoredChange[] = [];
      let cursor = since;
      let more = false;
      for (;;) {
        const page = rows(
          sql,
          `SELECT ${CHANGE_COLUMNS} FROM w_changes c LEFT JOIN w_prints p ON p.urn = c.urn WHERE c.id > ? ORDER BY c.id LIMIT 500`,
          cursor,
        ).map(changeRow);
        for (const c of page) {
          if (out.length >= limit) {
            more = true;
            break;
          }
          cursor = c.id;
          const as = watched?.get(c.urn);
          if (
            watched === null ||
            (as !== undefined && (c.aspect === "record" || as.has(c.aspect)))
          )
            out.push(c);
        }
        if (more || page.length < 500) break;
      }
      return { changes: out, cursor, more };
    }
    case "recent":
      // The newest changes, newest first (the account page).
      return {
        changes: rows(
          sql,
          `SELECT ${CHANGE_COLUMNS} FROM w_changes c LEFT JOIN w_prints p ON p.urn = c.urn ORDER BY c.id DESC LIMIT ?`,
          Math.min(50, Math.max(1, Number(a.limit ?? 10))),
        ).map(changeRow),
      };
    case "prune":
      prune(sql, nowOf(a));
      return { ok: true };
    case "pending": {
      // Watched URNs not yet compared in check `seq` (and not given up for it), the oldest
      // membership first; only the first maxSubjects URNs are checked (a downgraded plan).
      prune(sql, nowOf(a));
      if (a.keys_seen === true) deleteMeta(sql, "no_keys");
      const seq = Number(a.seq);
      const max = Math.max(0, Number(a.max));
      const pending: {
        urn: string;
        aspects: Aspect[];
        print: string;
        fails: number;
      }[] = [];
      let remaining = 0;
      for (const urn of checkedUrns(sql, Number(a.maxSubjects))) {
        const p = rows(
          sql,
          "SELECT print, seq, fails, skipped_seq FROM w_prints WHERE urn = ?",
          urn,
        )[0];
        if (p && (Number(p.seq) === seq || Number(p.skipped_seq) === seq))
          continue;
        remaining++;
        if (pending.length < max)
          pending.push({
            urn,
            aspects: unionAspects(sql, urn),
            print: p ? String(p.print) : "",
            fails: p ? Number(p.fails) : 0,
          });
      }
      return { items: pending, remaining, total: subjectCount(sql) };
    }
    case "apply": {
      const seq = Number(a.seq);
      const builtAt = String(a.built_at);
      const now = String(a.now);
      const maxFails = Number(a.maxFails ?? 3);
      const results = (a.results ?? []) as {
        urn: string;
        label?: string | null;
        print: string;
        status: string;
        changes: ChangeBody[];
      }[];
      let stored = 0;
      for (const r of results) {
        // Only URNs still watched (one may have been removed while the check ran).
        if (
          rows(
            sql,
            "SELECT 1 AS x FROM w_subjects WHERE urn = ? LIMIT 1",
            r.urn,
          ).length === 0
        )
          continue;
        for (const c of r.changes) {
          const before = rows(
            sql,
            "SELECT 1 AS x FROM w_changes WHERE urn = ? AND aspect = ? AND seq = ?",
            r.urn,
            c.aspect,
            seq,
          ).length;
          sql.exec(
            "INSERT INTO w_changes (urn, aspect, built_at, seq, detected_at, body) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(urn, aspect, seq) DO NOTHING",
            r.urn,
            c.aspect,
            builtAt,
            seq,
            now,
            JSON.stringify(c),
          );
          if (!before) stored++;
        }
        sql.exec(
          "INSERT INTO w_prints (urn, label, print, status, built_at, seq, checked_at, fails, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL) ON CONFLICT(urn) DO UPDATE SET label = COALESCE(excluded.label, w_prints.label), print = excluded.print, status = excluded.status, built_at = excluded.built_at, seq = excluded.seq, checked_at = excluded.checked_at, fails = 0, last_error = NULL",
          r.urn,
          r.label ?? null,
          r.print,
          r.status,
          builtAt,
          seq,
          now,
        );
      }
      // Failed reads: the fingerprint stays as it was and is read again next run; after
      // maxFails in a row the URN is given up for this check (and tried again in the next).
      let skipped = 0;
      for (const f of (a.failed ?? []) as { urn: string; reason: string }[]) {
        const p = rows(
          sql,
          "SELECT fails FROM w_prints WHERE urn = ?",
          f.urn,
        )[0];
        if (!p) continue;
        const fails = Number(p.fails) + 1;
        if (fails >= maxFails) {
          skipped++;
          sql.exec(
            "UPDATE w_prints SET fails = 0, skipped_seq = ?, last_error = ? WHERE urn = ?",
            seq,
            f.reason.slice(0, 200),
            f.urn,
          );
        } else
          sql.exec(
            "UPDATE w_prints SET fails = ?, last_error = ? WHERE urn = ?",
            fails,
            f.reason.slice(0, 200),
            f.urn,
          );
      }
      setMeta(sql, "last_built_at", builtAt);
      prune(sql, Date.parse(now));
      return { stored, skipped };
    }
    case "no_keys": {
      // Distinct checks in a row that found no key record for the subscription.
      const seq = Number(a.seq);
      const [last, n] = (getMeta(sql, "no_keys") ?? "0|0").split("|");
      const count = Number(last) === seq ? Number(n) : Number(n) + 1;
      setMeta(sql, "no_keys", `${seq}|${count}`);
      return { count };
    }
    case "check_state": {
      // Subjects whose reads are failing, or were given up for check `seq`.
      const seq = Number(a.seq);
      return {
        failing: count(
          sql,
          "SELECT COUNT(*) AS n FROM w_prints WHERE fails > 0 AND seq <> ?",
          seq,
        ),
        skipped: rows(
          sql,
          "SELECT urn, last_error FROM w_prints WHERE skipped_seq = ? AND seq <> ? ORDER BY urn LIMIT 20",
          seq,
          seq,
        ).map((r) => ({
          urn: String(r.urn),
          reason: r.last_error ? String(r.last_error) : "read failed",
        })),
      };
    }
    case "alerts_get":
      return alertState(sql);
    case "alerts_request": {
      // One pending address at a time; a confirmation email at most every minGapMs and
      // maxPerDay a UTC day per subscription.
      const now = nowOf(a);
      const last = Number(getMeta(sql, "confirm_last") ?? 0);
      if (now - last < Number(a.minGapMs))
        return {
          ok: false,
          limited: "gap",
          retry_at: new Date(last + Number(a.minGapMs)).toISOString(),
        };
      const day = new Date(now).toISOString().slice(0, 10);
      const [d, n] = (getMeta(sql, "confirm_day") ?? "|0").split("|");
      const sent = d === day ? Number(n) : 0;
      if (sent >= Number(a.maxPerDay))
        return {
          ok: false,
          limited: "day",
          retry_at: new Date(Date.parse(day) + DAY_MS).toISOString(),
        };
      const previous = getMeta(sql, "pending_id") ?? null;
      setMeta(sql, "confirm_last", String(now));
      setMeta(sql, "confirm_day", `${day}|${sent + 1}`);
      setMeta(sql, "pending_email", String(a.email));
      setMeta(sql, "pending_id", String(a.pending_id));
      setMeta(sql, "pending_expires", String(a.expires));
      return { ok: true, previous_pending_id: previous };
    }
    case "alerts_confirm": {
      const s = alertState(sql);
      if (
        s.pending_id === null ||
        s.pending_id !== a.pending_id ||
        typeof a.email !== "string" ||
        Date.parse(s.pending_expires ?? "") <= nowOf(a)
      )
        return { ok: false };
      setMeta(sql, "alert_email", a.email);
      setMeta(sql, "alert_id", String(a.alert_id));
      for (const k of ["pending_email", "pending_id", "pending_expires"])
        deleteMeta(sql, k);
      return { ok: true, previous_alert_id: s.alert_id };
    }
    case "alerts_off": {
      const s = alertState(sql);
      for (const k of [
        "alert_email",
        "alert_id",
        "pending_email",
        "pending_id",
        "pending_expires",
      ])
        deleteMeta(sql, k);
      return {
        previous_alert_id: s.alert_id,
        previous_pending_id: s.pending_id,
        total: subjectCount(sql),
      };
    }
    case "digest_claim": {
      // Claimed before the email is sent, so two runs (or a retry after a failed write) never
      // send one check's digest twice.
      const seq = Number(a.seq);
      if (getMeta(sql, `digest:${seq}`) !== undefined)
        return { claimed: false, email: null, alert_id: null, changes: [] };
      for (const r of rows(
        sql,
        "SELECT name FROM w_meta WHERE name LIKE 'digest:%' ORDER BY CAST(substr(name, 8) AS INTEGER) DESC LIMIT -1 OFFSET 11",
      ))
        deleteMeta(sql, String(r.name));
      setMeta(sql, `digest:${seq}`, String(a.now));
      return {
        claimed: true,
        email: getMeta(sql, "alert_email") ?? null,
        alert_id: getMeta(sql, "alert_id") ?? null,
        changes: rows(
          sql,
          `SELECT ${CHANGE_COLUMNS} FROM w_changes c LEFT JOIN w_prints p ON p.urn = c.urn WHERE c.seq = ? ORDER BY c.id`,
          seq,
        ).map(changeRow),
      };
    }
    case "digest_release":
      // The email could not be sent: a later run may try again.
      deleteMeta(sql, `digest:${Number(a.seq)}`);
      return { ok: true };
  }
  throw new Error(`unknown watch op ${op}`);
}

// --- The index object --------------------------------------------------------------------------

/** The check number of pack `built_at`: a pack different from the last one seen gets a new one. */
function ensureSeq(sql: SqlLike, builtAt: string): number {
  const seq = Number(getMeta(sql, "seq") ?? 0);
  if (getMeta(sql, "built_at") === builtAt && seq > 0) return seq;
  setMeta(sql, "seq", String(seq + 1));
  setMeta(sql, "built_at", builtAt);
  return seq + 1;
}

export function indexOp(sql: SqlLike, op: string, a: Args): unknown {
  for (const q of INDEX_SCHEMA) sql.exec(q);
  switch (op) {
    case "register":
      sql.exec(
        "INSERT INTO w_owners (owner, done_seq) VALUES (?, 0) ON CONFLICT(owner) DO NOTHING",
        String(a.owner),
      );
      return { ok: true };
    case "unregister":
      sql.exec("DELETE FROM w_owners WHERE owner = ?", String(a.owner));
      return { ok: true };
    case "current":
      // The check the scheduled run last started; tools never start one.
      return {
        seq: Number(getMeta(sql, "seq") ?? 0),
        built_at: getMeta(sql, "built_at") ?? null,
      };
    case "begin": {
      // Start or resume the check of pack `built_at`: refused while another run holds the lease.
      const seq = ensureSeq(sql, String(a.built_at));
      const now = Number(a.now);
      if (Number(getMeta(sql, "done_seq") ?? 0) === seq)
        return { state: "done", seq, owners: [] };
      const lease = Number(getMeta(sql, "lease_until") ?? 0);
      if (lease > now) return { state: "busy", seq, owners: [] };
      setMeta(sql, "lease_until", String(now + Number(a.lease_ms)));
      return {
        state: "run",
        seq,
        owners: rows(
          sql,
          "SELECT owner FROM w_owners WHERE done_seq <> ? ORDER BY owner",
          seq,
        ).map((r) => String(r.owner)),
      };
    }
    case "done":
      sql.exec(
        "UPDATE w_owners SET done_seq = ? WHERE owner = ?",
        Number(a.seq),
        String(a.owner),
      );
      return { ok: true };
    case "end": {
      // Release the lease; the check is done when no owner is left for it.
      const seq = Number(a.seq);
      deleteMeta(sql, "lease_until");
      const left = count(
        sql,
        "SELECT COUNT(*) AS n FROM w_owners WHERE done_seq <> ?",
        seq,
      );
      if (left === 0) setMeta(sql, "done_seq", String(seq));
      return { left };
    }
    case "state":
      return {
        seq: Number(getMeta(sql, "seq") ?? 0),
        built_at: getMeta(sql, "built_at") ?? null,
        done_seq: Number(getMeta(sql, "done_seq") ?? 0),
        owners: count(sql, "SELECT COUNT(*) AS n FROM w_owners"),
      };
  }
  throw new Error(`unknown watch index op ${op}`);
}

/** The `/watch` request of the Durable Object: `{kind, op, args}`. */
export async function watchObjectFetch(
  storage: WatchStorage,
  request: Request,
): Promise<Response> {
  const b = (await request.json()) as {
    kind: "sub" | "index";
    op: string;
    args?: Args;
  };
  let result: unknown;
  if (b.op === "forget") {
    // Delete everything, creating nothing on an object that never held data.
    const had = hasTables(storage.sql);
    const alerts = had ? alertState(storage.sql) : NO_ALERTS;
    if (had) await storage.deleteAll();
    result = {
      forgotten: had,
      alert_id: alerts.alert_id,
      pending_id: alerts.pending_id,
    };
  } else
    result =
      b.kind === "index"
        ? indexOp(storage.sql, b.op, b.args ?? {})
        : subscriptionOp(storage.sql, b.op, b.args ?? {});
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}
