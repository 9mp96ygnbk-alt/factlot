/**
 * Watch lists: storage, inside the LIMITER Durable Object class (SQLite storage; no new binding
 * or migration). Two kinds of object, by name:
 *
 *   watch:sub:<subscription>   one subscription's lists, subjects, fingerprints, changes, alert
 *                              settings
 *   watch:index                the subscriptions that watch at least one subject, and the
 *                              progress of the check of the current registry pack
 *
 * These objects never set an alarm, so the meter's alarm (which wipes an object whose counters are
 * all spent) never runs on them. Every request is one synchronous run of SQL statements, so each
 * operation applies whole or not at all.
 *
 * Tables of a subscription object:
 *   w_lists    (name, created_at)
 *   w_subjects (list, urn, aspects, added_at)                 one row per list membership
 *   w_prints   (urn, label, print, built_at, checked_at)      one fingerprint per watched URN
 *   w_changes  (id, urn, aspect, built_at, detected_at, body) unique per (urn, aspect, built_at)
 *   w_meta     (name, value)                                  alert_email, alert_id,
 *                                                             digest:<built_at>
 * Tables of the index object:
 *   w_owners   (owner, done_built_at)
 *   w_meta     built_at, done_built_at, lease_until
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

const SUB_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS w_lists (name TEXT PRIMARY KEY, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS w_subjects (list TEXT NOT NULL, urn TEXT NOT NULL, aspects TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (list, urn))",
  "CREATE TABLE IF NOT EXISTS w_prints (urn TEXT PRIMARY KEY, label TEXT, print TEXT NOT NULL, built_at TEXT NOT NULL, checked_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS w_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, urn TEXT NOT NULL, aspect TEXT NOT NULL, built_at TEXT NOT NULL, detected_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (urn, aspect, built_at))",
  "CREATE TABLE IF NOT EXISTS w_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
const INDEX_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS w_owners (owner TEXT PRIMARY KEY, done_built_at TEXT NOT NULL)",
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
  built_at: string;
}

export interface WatchedSubject {
  urn: string;
  label: string | null;
  aspects: Aspect[];
  added_at: string;
  checked_built_at: string;
  status: string;
}

export interface StoredChange extends ChangeBody {
  id: number;
  urn: string;
  label: string | null;
  built_at: string;
  detected_at: string;
}

export interface Alerts {
  email: string | null;
  alert_id: string | null;
}

type Args = Record<string, unknown>;

function subjectCount(sql: SqlLike): number {
  return Number(rows(sql, "SELECT COUNT(*) AS n FROM w_subjects")[0]?.n ?? 0);
}

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
  const orphans = rows(
    sql,
    "SELECT urn FROM w_prints WHERE urn NOT IN (SELECT urn FROM w_subjects)",
  );
  sql.exec(
    "DELETE FROM w_changes WHERE urn NOT IN (SELECT urn FROM w_subjects)",
  );
  sql.exec(
    "DELETE FROM w_prints WHERE urn NOT IN (SELECT urn FROM w_subjects)",
  );
  return orphans.length;
}

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
        matching: 0,
        next_offset: null,
        alerts: { email: null },
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
      return { items: [], remaining: 0 };
    case "alerts_get":
      return { email: null, alert_id: null };
    case "digest":
      return { sent: false, email: null, alert_id: null, changes: [] };
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
  switch (op) {
    case "room": {
      // Which URNs are new to the list, and how many more the plan allows.
      const list = String(a.list);
      const urns = a.urns as string[];
      const listExists =
        rows(sql, "SELECT 1 AS x FROM w_lists WHERE name = ?", list).length > 0;
      const lists = Number(
        rows(sql, "SELECT COUNT(*) AS n FROM w_lists")[0]?.n ?? 0,
      );
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
      const aspects = (a.aspects as string[]).join(",");
      const items = a.items as NewSubject[];
      const lists = Number(
        rows(sql, "SELECT COUNT(*) AS n FROM w_lists")[0]?.n ?? 0,
      );
      const listExists =
        rows(sql, "SELECT 1 AS x FROM w_lists WHERE name = ?", list).length > 0;
      if (!listExists && lists >= Number(a.maxLists))
        return {
          added: [],
          refused: items.map((i) => i.urn),
          total: subjectCount(sql),
        };
      sql.exec(
        "INSERT INTO w_lists (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
        list,
        now,
      );
      const added: string[] = [];
      const refused: string[] = [];
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
        if (inList) continue;
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
        if (item.print !== undefined)
          sql.exec(
            "INSERT INTO w_prints (urn, label, print, built_at, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(urn) DO NOTHING",
            item.urn,
            item.label,
            item.print,
            item.built_at,
            now,
          );
        added.push(item.urn);
      }
      return { added, refused, total: subjectCount(sql) };
    }
    case "remove": {
      const list = String(a.list);
      let removed: number;
      if (a.all === true) {
        removed = Number(
          rows(
            sql,
            "SELECT COUNT(*) AS n FROM w_subjects WHERE list = ?",
            list,
          )[0]?.n ?? 0,
        );
        sql.exec("DELETE FROM w_subjects WHERE list = ?", list);
        sql.exec("DELETE FROM w_lists WHERE name = ?", list);
      } else {
        removed = 0;
        for (const urn of a.urns as string[]) {
          removed += rows(
            sql,
            "SELECT 1 AS x FROM w_subjects WHERE list = ? AND urn = ?",
            list,
            urn,
          ).length;
          sql.exec(
            "DELETE FROM w_subjects WHERE list = ? AND urn = ?",
            list,
            urn,
          );
        }
      }
      const forgotten = dropOrphans(sql);
      return { removed, forgotten, total: subjectCount(sql) };
    }
    case "list": {
      const lists = rows(
        sql,
        "SELECT l.name, l.created_at, COUNT(s.urn) AS n, MAX(s.aspects) AS aspects FROM w_lists l LEFT JOIN w_subjects s ON s.list = l.name GROUP BY l.name ORDER BY l.name",
      ).map((r) => ({
        name: String(r.name),
        created_at: String(r.created_at),
        subjects: Number(r.n),
        aspects: r.aspects ? String(r.aspects).split(",") : [],
      }));
      const filter = typeof a.list === "string" ? a.list : null;
      const offset = Math.max(0, Number(a.offset ?? 0));
      const limit = Math.min(500, Math.max(1, Number(a.limit ?? 100)));
      const subjects = rows(
        sql,
        `SELECT s.list, s.urn, s.aspects, s.added_at, p.label, p.built_at, p.print FROM w_subjects s LEFT JOIN w_prints p ON p.urn = s.urn ${filter === null ? "" : "WHERE s.list = ?"} ORDER BY s.list, s.added_at, s.urn LIMIT ? OFFSET ?`,
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
        status: r.print
          ? String((JSON.parse(String(r.print)) as { status?: unknown }).status)
          : "unknown",
      }));
      const matching = Number(
        rows(
          sql,
          `SELECT COUNT(*) AS n FROM w_subjects ${filter === null ? "" : "WHERE list = ?"}`,
          ...(filter === null ? [] : [filter]),
        )[0]?.n ?? 0,
      );
      return {
        lists,
        subjects,
        total: subjectCount(sql),
        matching,
        next_offset:
          offset + subjects.length < matching ? offset + subjects.length : null,
        alerts: { email: getMeta(sql, "alert_email") ?? null },
        last_built_at: getMeta(sql, "last_built_at") ?? null,
      };
    }
    case "changes": {
      const since = Math.max(0, Number(a.since ?? 0));
      const limit = Math.min(200, Math.max(1, Number(a.limit ?? 50)));
      const filter = typeof a.list === "string" ? a.list : null;
      const builtAt = typeof a.built_at === "string" ? a.built_at : null;
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
          `SELECT c.id, c.urn, c.aspect, c.built_at, c.detected_at, c.body, p.label FROM w_changes c LEFT JOIN w_prints p ON p.urn = c.urn WHERE c.id > ?${builtAt === null ? "" : " AND c.built_at = ?"} ORDER BY c.id LIMIT 500`,
          cursor,
          ...(builtAt === null ? [] : [builtAt]),
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
          "SELECT c.id, c.urn, c.aspect, c.built_at, c.detected_at, c.body, p.label FROM w_changes c LEFT JOIN w_prints p ON p.urn = c.urn ORDER BY c.id DESC LIMIT ?",
          Math.min(50, Math.max(1, Number(a.limit ?? 10))),
        ).map(changeRow),
      };
    case "pending": {
      // Watched URNs not yet compared with pack `built_at`, oldest membership first; only the
      // first maxSubjects memberships are checked (a plan downgraded below its count).
      const builtAt = String(a.built_at);
      const max = Math.max(0, Number(a.max));
      const allowed = rows(
        sql,
        "SELECT urn FROM (SELECT urn, MIN(added_at) AS first FROM w_subjects GROUP BY urn ORDER BY first, urn LIMIT ?)",
        Number(a.maxSubjects),
      ).map((r) => String(r.urn));
      const pending: { urn: string; aspects: Aspect[]; print: string }[] = [];
      let remaining = 0;
      for (const urn of allowed) {
        const p = rows(
          sql,
          "SELECT print, built_at FROM w_prints WHERE urn = ?",
          urn,
        )[0];
        if (p && String(p.built_at) === builtAt) continue;
        remaining++;
        if (pending.length < max)
          pending.push({
            urn,
            aspects: unionAspects(sql, urn),
            print: p ? String(p.print) : "",
          });
      }
      return { items: pending, remaining };
    }
    case "apply": {
      const builtAt = String(a.built_at);
      const now = String(a.now);
      const results = a.results as {
        urn: string;
        label?: string | null;
        print: string;
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
            "SELECT 1 AS x FROM w_changes WHERE urn = ? AND aspect = ? AND built_at = ?",
            r.urn,
            c.aspect,
            builtAt,
          ).length;
          sql.exec(
            "INSERT INTO w_changes (urn, aspect, built_at, detected_at, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(urn, aspect, built_at) DO NOTHING",
            r.urn,
            c.aspect,
            builtAt,
            now,
            JSON.stringify(c),
          );
          if (!before) stored++;
        }
        sql.exec(
          "INSERT INTO w_prints (urn, label, print, built_at, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(urn) DO UPDATE SET label = COALESCE(excluded.label, w_prints.label), print = excluded.print, built_at = excluded.built_at, checked_at = excluded.checked_at",
          r.urn,
          r.label ?? null,
          r.print,
          builtAt,
          now,
        );
      }
      setMeta(sql, "last_built_at", builtAt);
      // Retention: the newest MAX_CHANGES_KEPT, none older than CHANGE_RETENTION_DAYS.
      const cutoff = new Date(
        Date.parse(now) - CHANGE_RETENTION_DAYS * 86_400_000,
      ).toISOString();
      sql.exec("DELETE FROM w_changes WHERE detected_at < ?", cutoff);
      sql.exec(
        "DELETE FROM w_changes WHERE id <= (SELECT MAX(id) FROM w_changes) - ?",
        MAX_CHANGES_KEPT,
      );
      return { stored };
    }
    case "alerts_get":
      return {
        email: getMeta(sql, "alert_email") ?? null,
        alert_id: getMeta(sql, "alert_id") ?? null,
      } satisfies Alerts;
    case "alerts_set": {
      const previous = getMeta(sql, "alert_id") ?? null;
      if (typeof a.email === "string" && typeof a.alert_id === "string") {
        setMeta(sql, "alert_email", a.email);
        setMeta(sql, "alert_id", a.alert_id);
      } else {
        deleteMeta(sql, "alert_email");
        deleteMeta(sql, "alert_id");
      }
      return { previous_alert_id: previous };
    }
    case "digest": {
      // What one release's digest would hold, and whether it went already.
      const builtAt = String(a.built_at);
      return {
        sent: getMeta(sql, `digest:${builtAt}`) !== undefined,
        email: getMeta(sql, "alert_email") ?? null,
        alert_id: getMeta(sql, "alert_id") ?? null,
        changes: rows(
          sql,
          "SELECT c.id, c.urn, c.aspect, c.built_at, c.detected_at, c.body, p.label FROM w_changes c LEFT JOIN w_prints p ON p.urn = c.urn WHERE c.built_at = ? ORDER BY c.id",
          builtAt,
        ).map(changeRow),
      };
    }
    case "digest_sent": {
      // Keep the marks of the last few releases only.
      for (const r of rows(
        sql,
        "SELECT name FROM w_meta WHERE name LIKE 'digest:%' ORDER BY name DESC LIMIT -1 OFFSET 11",
      ))
        deleteMeta(sql, String(r.name));
      setMeta(sql, `digest:${String(a.built_at)}`, String(a.now));
      return { ok: true };
    }
  }
  throw new Error(`unknown watch op ${op}`);
}

// --- The index object --------------------------------------------------------------------------

export function indexOp(sql: SqlLike, op: string, a: Args): unknown {
  for (const q of INDEX_SCHEMA) sql.exec(q);
  switch (op) {
    case "register":
      sql.exec(
        "INSERT INTO w_owners (owner, done_built_at) VALUES (?, ?) ON CONFLICT(owner) DO NOTHING",
        String(a.owner),
        typeof a.built_at === "string" ? a.built_at : "",
      );
      return { ok: true };
    case "unregister":
      sql.exec("DELETE FROM w_owners WHERE owner = ?", String(a.owner));
      return { ok: true };
    case "begin": {
      // Start or resume the check of pack `built_at`: refused while another run holds the lease.
      const builtAt = String(a.built_at);
      const now = Number(a.now);
      if (getMeta(sql, "done_built_at") === builtAt)
        return { state: "done", owners: [] };
      const lease = Number(getMeta(sql, "lease_until") ?? 0);
      if (lease > now) return { state: "busy", owners: [] };
      setMeta(sql, "lease_until", String(now + Number(a.lease_ms)));
      setMeta(sql, "built_at", builtAt);
      return {
        state: "run",
        owners: rows(
          sql,
          "SELECT owner FROM w_owners WHERE done_built_at <> ? ORDER BY owner",
          builtAt,
        ).map((r) => String(r.owner)),
      };
    }
    case "done":
      sql.exec(
        "UPDATE w_owners SET done_built_at = ? WHERE owner = ?",
        String(a.built_at),
        String(a.owner),
      );
      return { ok: true };
    case "end": {
      // Release the lease; the pack is done when no owner is left for it.
      const builtAt = String(a.built_at);
      deleteMeta(sql, "lease_until");
      const left = Number(
        rows(
          sql,
          "SELECT COUNT(*) AS n FROM w_owners WHERE done_built_at <> ?",
          builtAt,
        )[0]?.n ?? 0,
      );
      if (left === 0) setMeta(sql, "done_built_at", builtAt);
      return { left };
    }
    case "state":
      return {
        built_at: getMeta(sql, "built_at") ?? null,
        done_built_at: getMeta(sql, "done_built_at") ?? null,
        owners: Number(
          rows(sql, "SELECT COUNT(*) AS n FROM w_owners")[0]?.n ?? 0,
        ),
      };
  }
  throw new Error(`unknown watch index op ${op}`);
}

/** The `/watch` request of the Durable Object: `{object, op, args}`. */
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
    const alerts = had
      ? (subscriptionOp(storage.sql, "alerts_get", {}) as Alerts)
      : { alert_id: null };
    if (had) await storage.deleteAll();
    result = { forgotten: had, alert_id: alerts.alert_id };
  } else
    result =
      b.kind === "index"
        ? indexOp(storage.sql, b.op, b.args ?? {})
        : subscriptionOp(storage.sql, b.op, b.args ?? {});
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}
