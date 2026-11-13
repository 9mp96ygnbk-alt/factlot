// Reads and formats the hosted usage counters (deploy/cloudflare/src/usage.ts). Pure functions:
// usage.mjs fetches the records, this file turns them into numbers and text.
import { parseUsageRecord } from "../../deploy/cloudflare/src/usage.ts";
import {
  newSketch,
  sketchEstimate,
  sketchFromString,
  sketchMerge,
} from "../../deploy/cloudflare/src/usage-sketch.ts";

export const CALLER_ORDER = [
  "keyless",
  "oauth_free",
  "free_key",
  "pro",
  "team",
];
const CALLER_LABEL = {
  keyless: "keyless address",
  oauth_free: "free OAuth connection",
  free_key: "free key",
  pro: "Pro key",
  team: "Team key",
};

/** The UTC date `n` days before `date` (YYYY-MM-DD). */
export function shiftDay(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Parse raw KV values into records, dropping anything that is not one. */
export function parseRecords(values) {
  return values.map((v) => parseUsageRecord(v)).filter(Boolean);
}

/**
 * The window: `yesterday` and the `days` complete UTC days ending with it. `today` is a
 * YYYY-MM-DD date (today's own counters are partial and are left out).
 */
export function windowDays(today, days = 7) {
  const yesterday = shiftDay(today, -1);
  const week = [];
  for (let i = days - 1; i >= 0; i--) week.push(shiftDay(yesterday, -i));
  return { yesterday, week };
}

/** Sum counters and merge caller sketches over the records of the given days. */
function collect(records, days) {
  const set = new Set(days);
  const counters = new Map();
  const callers = new Map();
  const haveDays = new Set();
  for (const r of records) {
    if (!set.has(r.day)) continue;
    haveDays.add(r.day);
    for (const [k, n] of Object.entries(r.counters))
      if (Number.isFinite(n)) counters.set(k, (counters.get(k) ?? 0) + n);
    for (const [kind, text] of Object.entries(r.callers)) {
      const s = sketchFromString(text);
      if (!s) continue;
      if (!callers.has(kind)) callers.set(kind, newSketch());
      sketchMerge(callers.get(kind), s);
    }
  }
  return { counters, callers, haveDays: [...haveDays].sort() };
}

/** Counters of one event, grouped by the dimension at `index` (0-based after the event name). */
function by(counters, event, index, filter = () => true) {
  const out = new Map();
  for (const [k, n] of counters) {
    const parts = k.split("|");
    if (parts[0] !== event || !filter(parts)) continue;
    const g = parts[index + 1] ?? "";
    out.set(g, (out.get(g) ?? 0) + n);
  }
  return out;
}

function total(map) {
  let t = 0;
  for (const n of map.values()) t += n;
  return t;
}

/** The numbers of one period, or `undefined` when no record of it exists. */
export function summarize(records, days) {
  const { counters, callers, haveDays } = collect(records, days);
  if (haveDays.length === 0) return undefined;
  const distinct = {};
  for (const kind of CALLER_ORDER)
    distinct[kind] = callers.has(kind) ? sketchEstimate(callers.get(kind)) : 0;
  const paid = newSketch();
  for (const k of ["pro", "team"])
    if (callers.has(k)) sketchMerge(paid, callers.get(k));
  const requestsBySurface = by(counters, "req", 0);
  const pages = by(counters, "req", 1, (p) => p[1] === "site");
  const rest = by(counters, "req", 1, (p) => p[1] === "rest");
  return {
    days: haveDays,
    requests: {
      total: total(requestsBySurface),
      by_surface: Object.fromEntries(requestsBySurface),
      site_pages: Object.fromEntries(pages),
      rest_routes: Object.fromEntries(rest),
      by_status: Object.fromEntries(by(counters, "req", 2)),
    },
    mcp_calls: Object.fromEntries(by(counters, "mcp_call", 0)),
    lookups: {
      total: total(by(counters, "lookup", 0)),
      by_tool: Object.fromEntries(by(counters, "lookup", 0)),
      by_region: Object.fromEntries(by(counters, "lookup", 1)),
      by_caller: Object.fromEntries(by(counters, "lookup", 2)),
    },
    // Answers that found nothing: [tool, outcome, caller kind]; outcome "free" (not counted),
    // "charged" (past the hourly guard, also in lookups) or "not_loaded" (a coverage miss).
    empty_answers: {
      total: total(by(counters, "lookup_empty", 0)),
      by_outcome: Object.fromEntries(by(counters, "lookup_empty", 1)),
      by_tool: Object.fromEntries(by(counters, "lookup_empty", 0)),
    },
    distinct_callers: distinct,
    active_paid_keys: sketchEstimate(paid),
    quota_exhausted: Object.fromEntries(by(counters, "quota_exhausted", 0)),
    plan_required: Object.fromEntries(by(counters, "plan_required", 0)),
    history_notes: total(by(counters, "history_note", 0)),
    checkout_starts_by_interval: Object.fromEntries(
      [...counters]
        .filter(([k]) => k.startsWith("checkout_start|"))
        .map(([k, n]) => [k.split("|").slice(1).join("/"), n]),
    ),
    checkout_completions: Object.fromEntries(
      [...counters]
        .filter(([k]) => k.startsWith("checkout_complete|"))
        .map(([k, n]) => [k.split("|").slice(1).join("/"), n]),
    ),
    reports: Object.fromEntries(by(counters, "report", 0)),
    model_calls: Object.fromEntries(
      [...counters]
        .filter(([k]) => k.startsWith("model_call|"))
        .map(([k, n]) => [k.split("|").slice(1).join("/"), n]),
    ),
    overflow: counters.get("overflow") ?? 0,
  };
}

/** Build the report object for `today` (UTC date) from parsed records. */
export function buildReport(records, today, days = 7) {
  const w = windowDays(today, days);
  return {
    today,
    yesterday: w.yesterday,
    week: { from: w.week[0], to: w.yesterday, days: w.week },
    yesterday_summary: summarize(records, [w.yesterday]),
    week_summary: summarize(records, w.week),
  };
}

const NO = "no data";

function cell(s, pick) {
  return s ? String(pick(s)) : NO;
}

function topRows(label, ya, wa, n = 12) {
  const keys = new Set([...Object.keys(ya ?? {}), ...Object.keys(wa ?? {})]);
  const sorted = [...keys].sort(
    (a, b) =>
      (wa?.[b] ?? ya?.[b] ?? 0) - (wa?.[a] ?? ya?.[a] ?? 0) ||
      a.localeCompare(b),
  );
  const rows = sorted
    .slice(0, n)
    .map((k) => [
      `  ${k}`,
      ya ? String(ya[k] ?? 0) : NO,
      wa ? String(wa[k] ?? 0) : NO,
    ]);
  if (sorted.length > n) rows.push([`  (${sorted.length - n} more)`, "", ""]);
  if (sorted.length === 0) rows.push(["  none", ya ? "0" : NO, wa ? "0" : NO]);
  return [[label, "", ""], ...rows];
}

/** Plain-text report. */
export function formatReport(report) {
  const y = report.yesterday_summary;
  const w = report.week_summary;
  const rows = [];
  const add = (...r) => rows.push(...r);
  const num = (pick) => [cell(y, pick), cell(w, pick)];

  add(["Requests", ...num((s) => s.requests.total)]);
  add(
    ...["mcp", "rest", "site", "other"].map((k) => [
      `  ${k}`,
      y ? String(y.requests.by_surface[k] ?? 0) : NO,
      w ? String(w.requests.by_surface[k] ?? 0) : NO,
    ]),
  );
  add(
    ...topRows(
      "Site pages (path group)",
      y?.requests.site_pages,
      w?.requests.site_pages,
    ),
  );
  add(
    ...topRows("REST routes", y?.requests.rest_routes, w?.requests.rest_routes),
  );
  add(...topRows("MCP tool calls (by tool)", y?.mcp_calls, w?.mcp_calls));
  add(["Registry lookups (charged)", ...num((s) => s.lookups.total)]);
  add(...topRows("  by tool", y?.lookups.by_tool, w?.lookups.by_tool));
  add(...topRows("  by region", y?.lookups.by_region, w?.lookups.by_region));
  add([
    "Registry answers that found nothing",
    ...num((s) => s.empty_answers.total),
  ]);
  add(
    ...topRows(
      "  by outcome (free, charged past the hourly guard, not_loaded)",
      y?.empty_answers.by_outcome,
      w?.empty_answers.by_outcome,
    ),
  );
  add(
    ...topRows("  by tool", y?.empty_answers.by_tool, w?.empty_answers.by_tool),
  );
  add(["Distinct callers (approximate)", "", ""]);
  add(
    ...CALLER_ORDER.map((k) => [
      `  ${CALLER_LABEL[k]}`,
      y ? String(y.distinct_callers[k]) : NO,
      w ? String(w.distinct_callers[k]) : NO,
    ]),
  );
  add(["Active paid keys (made a request)", ...num((s) => s.active_paid_keys)]);
  add(
    ...topRows(
      "Quota exhausted (by caller)",
      y?.quota_exhausted,
      w?.quota_exhausted,
    ),
  );
  add(
    ...topRows(
      "PlanRequired refusals (by reason)",
      y?.plan_required,
      w?.plan_required,
    ),
  );
  add([
    "History notes served (free answers with history withheld)",
    ...num((s) => s.history_notes),
  ]);
  add(
    ...topRows(
      "Checkout starts (plan/interval)",
      y?.checkout_starts_by_interval,
      w?.checkout_starts_by_interval,
    ),
  );
  add(
    ...topRows(
      "Checkout completions (plan/by)",
      y && Object.fromEntries(Object.entries(y.checkout_completions)),
      w && Object.fromEntries(Object.entries(w.checkout_completions)),
    ),
  );
  add(...topRows("Reports (outcome)", y?.reports, w?.reports));
  add(
    ...topRows(
      "Model-tool calls (tool/outcome)",
      y?.model_calls,
      w?.model_calls,
    ),
  );

  const width = Math.max(...rows.map((r) => r[0].length)) + 2;
  const head = `${"".padEnd(width)}${`yesterday ${report.yesterday}`.padStart(22)}${`7 days to ${report.week.to}`.padStart(24)}`;
  const lines = rows.map(
    ([l, a, b]) => `${l.padEnd(width)}${a.padStart(22)}${b.padStart(24)}`,
  );
  const have = w ? w.days.length : 0;
  const notes = [];
  if (!y && !w)
    notes.push(
      "No usage records for these days: the counters were not enabled (USAGE_COUNTERS_ENABLED) or no request reached an isolate that wrote them.",
    );
  else {
    const missing = report.week.days.filter((d) => !w?.days.includes(d));
    notes.push(
      `Days with data in the 7-day window: ${have} of ${report.week.days.length}${missing.length ? ` (no data: ${missing.join(", ")})` : ""}.`,
    );
  }
  notes.push(
    "Counts are lower bounds by up to 30 seconds of events per isolate that was evicted before it wrote. Distinct callers are estimates (about 5% off); keyless addresses are hashed per UTC day, so over 7 days they count caller-days.",
  );
  if ((w?.overflow ?? 0) > 0 || (y?.overflow ?? 0) > 0)
    notes.push(
      `Some distinct counters overflowed their per-isolate cap (yesterday ${y?.overflow ?? 0}, 7 days ${w?.overflow ?? 0} events not broken down).`,
    );
  return [
    "FactLot hosted usage (UTC days)",
    "",
    head,
    ...lines,
    "",
    ...notes,
  ].join("\n");
}
