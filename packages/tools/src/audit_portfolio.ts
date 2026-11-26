/**
 * audit_expense_portfolio: a tenant with many locations (or a lease audit firm or tenant-rep broker
 * acting for one) audits many landlord expense statements at once.
 *
 * Each location is one audit_expense_statement call: the same function (`audit` in audit.ts), not a
 * second implementation. This file reads the list, runs the audit on each location, and adds up what
 * comes back: totals by finding class and by check, dollars at stake in total and by landlord, the
 * locations ranked by dollars, the dispute deadlines in date order, the checks that failed in more than
 * one place, and the locations whose input could not be audited (reported one by one: a bad location
 * never fails the call).
 *
 * Rules: deterministic (same inputs, same answer; no model, no clock: `as_of` is an input and every
 * days-remaining figure counts from it); nothing is guessed (a location's input that fails validation is
 * reported with its issues and is not audited); each location's findings remain sendable to its own
 * landlord through fact_package_send: the answer carries that location's package_items and, on the
 * hosted API, its own attestation (the one audit_expense_statement would have returned for that
 * location's input), so each send is attested on its own.
 *
 * Plan rule: on the hosted API a caller without a Pro or Team key gets the summary (counts and totals).
 * The first free document covers one single audit, not a portfolio: nothing is taken from it here.
 * Metering: the portfolio report (report_create kind expense_audit_portfolio) counts one unit of the
 * monthly report allowance per location audited in full; the tool call itself is not metered, as
 * audit_expense_statement is not. python/src/factlot/audit_portfolio.py is the same code.
 */
import { z } from "zod";

import { CHECKS, audit, norm, type AuditInput } from "./audit.ts";
import { attestResult } from "./attestation.ts";
import { ToolInputError } from "./documents.ts";
import type { Json } from "./documents.ts";
import { auditLimited } from "./audit.ts";
import { documentId, FREE_DOCUMENT_PLAN_URL } from "./free_document.ts";
import { canonicalJson } from "./packages.ts";
import { round } from "@factlot/calc";
import { createHash } from "node:crypto";

export const PORTFOLIO_MAX_AUDITS = 50;
export const PORTFOLIO_PLAN_URL = "https://factlot.com/pricing/";
const LABEL_MAX = 120;
const LANDLORD_MAX = 200;

const ENTRY_KEYS = [
  "label",
  "landlord",
  "lease_facts",
  "statement_facts",
  "prior_statement_facts",
  "yoy_threshold",
] as const;

// The entries are checked one by one in the tool (a bad entry is reported for that location only), so
// the schema describes their shape without rejecting the call for it.
const Entry = z.looseObject({
  label: z
    .unknown()
    .optional()
    .describe(
      "Required: the location's name as the person knows it (a store number, a property name, a suite), 1 to 120 characters, unique within the call. Printed in the answer and the report.",
    ),
  landlord: z
    .unknown()
    .optional()
    .describe(
      "Optional: the landlord organisation named on the statement, as typed (at most 200 characters). Locations with the same landlord (compared by letters and digits only) are totalled together and checked for repeated issues. Left out: the location is totalled under 'Landlord not named'.",
    ),
  lease_facts: z
    .unknown()
    .optional()
    .describe(
      "Required: the location's lease facts, exactly as audit_expense_statement's lease_facts (an array of verified facts, each with its quote and page).",
    ),
  statement_facts: z
    .unknown()
    .optional()
    .describe(
      "Required: the landlord's statement as verified facts, exactly as audit_expense_statement's statement_facts.",
    ),
  prior_statement_facts: z
    .unknown()
    .optional()
    .describe(
      "Optional: the prior year's statement.line and statement.period facts for this location, as audit_expense_statement's prior_statement_facts.",
    ),
  yoy_threshold: z
    .unknown()
    .optional()
    .describe(
      "Optional: this location's year-over-year threshold, a number above 0 and at most 10, as audit_expense_statement's yoy_threshold. Default: the call's yoy_threshold.",
    ),
});

export const AuditExpensePortfolioInput = z.object({
  audits: z
    .array(Entry)
    .min(1)
    .max(PORTFOLIO_MAX_AUDITS)
    .describe(
      `Up to ${PORTFOLIO_MAX_AUDITS} audits, one per location (or per location and year), each the input audit_expense_statement takes (lease_facts, statement_facts, prior_statement_facts, yoy_threshold) plus a label and optionally the landlord. An entry that fails validation is reported with its issues under locations_invalid and the others are audited; the call does not fail for it.`,
    ),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "Today's date, YYYY-MM-DD, for every location. The tool reads no clock: every deadline's days remaining is counted from this date.",
    ),
  yoy_threshold: z
    .number()
    .gt(0)
    .max(10)
    .default(0.1)
    .describe(
      "A line that rose by more than this fraction over the prior year is listed as a question to ask (default 0.10 = 10%), for every location that does not set its own.",
    ),
  include_results: z
    .boolean()
    .default(false)
    .describe(
      "True: each location also carries its whole audit_expense_statement result (every finding with its quotes, pages and calculation steps) under result. Default false: each location carries its summary, its findings in short form and result_ref (the digests of its input and result, to check a result against).",
    ),
});
export type PortfolioInput = z.output<typeof AuditExpensePortfolioInput>;

const CLASSES = [
  "follows_from_terms",
  "depends_on_reading",
  "question_to_ask",
] as const;
type Cls = (typeof CLASSES)[number];
const CLASS_LABEL: Record<Cls, string> = {
  follows_from_terms: "Follows from the lease's terms",
  depends_on_reading: "Depends on how the lease sentence is read",
  question_to_ask: "A question to ask, not an overcharge",
};
const NO_LANDLORD = "Landlord not named";

const usd = (x: number): number => round(x, 2);
const sha256Hex = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyObjects = (v: unknown, max: number): v is Json[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= max && v.every(isObj);

type Issue = { path: string; message: string };

interface Prepared {
  index: number;
  label: string;
  landlord: string | null;
  auditInput: AuditInput;
}

/** The audit input of one entry (what audit_expense_statement would be called with), or its issues. */
function prepareEntry(
  entry: unknown,
  index: number,
  asOf: string,
  defaultYoy: number,
  seen: Map<string, number>,
):
  | { ok: true; value: Prepared }
  | { ok: false; label: string; landlord: string | null; issues: Issue[] } {
  const at = (k: string) => `audits.${index}.${k}`;
  const issues: Issue[] = [];
  const e = isObj(entry) ? entry : {};
  if (!isObj(entry))
    return {
      ok: false,
      label: "",
      landlord: null,
      issues: [{ path: `audits.${index}`, message: "expected an object" }],
    };
  for (const k of Object.keys(e).sort())
    if (!(ENTRY_KEYS as readonly string[]).includes(k))
      issues.push({
        path: at(k),
        message: `unknown field; known fields here: ${ENTRY_KEYS.join(", ")}`,
      });
  let label = "";
  if (typeof e.label !== "string" || e.label.trim() === "")
    issues.push({
      path: at("label"),
      message: "missing: every location needs a label (1 to 120 characters)",
    });
  else if (e.label.trim().length > LABEL_MAX)
    issues.push({
      path: at("label"),
      message: `at most ${LABEL_MAX} characters`,
    });
  else {
    label = e.label.trim();
    const first = seen.get(label.toLowerCase());
    if (first !== undefined)
      issues.push({
        path: at("label"),
        message: `duplicate label "${label}" (also audits.${first}): each location's label must be unique`,
      });
    else seen.set(label.toLowerCase(), index);
  }
  let landlord: string | null = null;
  if (e.landlord !== undefined && e.landlord !== null) {
    if (typeof e.landlord !== "string" || e.landlord.trim() === "")
      issues.push({
        path: at("landlord"),
        message: "expected a name (text), or leave the field out",
      });
    else if (e.landlord.trim().length > LANDLORD_MAX)
      issues.push({
        path: at("landlord"),
        message: `at most ${LANDLORD_MAX} characters`,
      });
    else if (norm(e.landlord) === "")
      issues.push({
        path: at("landlord"),
        message: "a name needs at least one letter or digit",
      });
    else landlord = e.landlord.trim();
  }
  const list = (k: string, max: number, required: boolean) => {
    const v = e[k];
    if (v === undefined || v === null) {
      if (required)
        issues.push({
          path: at(k),
          message: "missing: this field is required",
        });
      return undefined;
    }
    if (!nonEmptyObjects(v, max)) {
      issues.push({
        path: at(k),
        message: `expected a list of 1 to ${max} facts (objects)`,
      });
      return undefined;
    }
    return v;
  };
  const lease_facts = list("lease_facts", 200, true);
  const statement_facts = list("statement_facts", 1000, true);
  const prior = list("prior_statement_facts", 1000, false);
  let yoy = defaultYoy;
  if (e.yoy_threshold !== undefined && e.yoy_threshold !== null) {
    const y = e.yoy_threshold;
    if (typeof y !== "number" || !Number.isFinite(y) || y <= 0 || y > 10)
      issues.push({
        path: at("yoy_threshold"),
        message: "expected a number above 0 and at most 10",
      });
    else yoy = y;
  }
  if (issues.length || !lease_facts || !statement_facts)
    return { ok: false, label, landlord, issues: issues.slice(0, 20) };
  return {
    ok: true,
    value: {
      index,
      label,
      landlord,
      auditInput: {
        lease_facts,
        statement_facts,
        ...(prior ? { prior_statement_facts: prior } : {}),
        as_of: asOf,
        yoy_threshold: yoy,
      },
    },
  };
}

/** The audit input of each location that passes the shape checks, in order (also used to attest). */
export function portfolioAuditInputs(input: PortfolioInput): {
  index: number;
  label: string;
  auditInput: AuditInput;
}[] {
  const seen = new Map<string, number>();
  const out: { index: number; label: string; auditInput: AuditInput }[] = [];
  input.audits.forEach((entry, i) => {
    const p = prepareEntry(entry, i, input.as_of, input.yoy_threshold, seen);
    if (p.ok) out.push(p.value);
  });
  return out;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface Loc {
  index: number;
  label: string;
  landlord: string | null;
  landlordKey: string | null;
  year: number | null;
  full: Json;
  entry: Json;
}

function documentsOf(auditInput: AuditInput): Json {
  const ids = (facts: Json[] | undefined): string[] => {
    const out: string[] = [];
    for (const f of facts ?? []) {
      const prov = isObj(f.provenance) ? f.provenance : {};
      const src = arr(prov.sources)[0];
      const id =
        src && typeof src.document_id === "string" ? src.document_id : "";
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  return {
    lease_documents: ids(auditInput.lease_facts),
    statement_documents: ids(auditInput.statement_facts),
  };
}

function pages(f: Json, side: string): number[] {
  const out: number[] = [];
  for (const s of arr(f.sources))
    if (s.side === side && typeof s.page === "number" && !out.includes(s.page))
      out.push(s.page);
  return out.sort((a, b) => a - b);
}

function locationEntry(p: Prepared, full: Json, includeResults: boolean): Json {
  const totals = full.totals as Json;
  const findings = arr(full.findings);
  const byClass: Record<string, number> = {
    follows_from_terms: 0,
    depends_on_reading: 0,
    question_to_ask: 0,
  };
  for (const f of findings)
    if (typeof f.difference === "number")
      byClass[str(f.class)] = usd((byClass[str(f.class)] ?? 0) + f.difference);
  const items = arr(full.package_items);
  const cost = full.cost_shifting as Json | null;
  const entry: Json = {
    index: p.index,
    label: p.label,
    landlord: p.landlord,
    status: "audited",
    statement_year: (full.statement_year ?? null) as number | null,
    summary: {
      finding_count: totals.finding_count as number,
      follows_from_terms: totals.follows_from_terms as number,
      depends_on_reading: totals.depends_on_reading as number,
      question_to_ask: totals.question_to_ask as number,
      dollars_at_stake: {
        firm_difference: totals.firm_difference as number,
        readings_difference: usd(
          num(totals.total_difference) - num(totals.firm_difference),
        ),
        total_difference: totals.total_difference as number,
        by_class: byClass,
        unit: "USD",
      },
      deadlines: arr(full.deadlines).map((d) => ({
        code: d.code as string,
        last_day: d.last_day as string,
        status: d.status as string,
        days_remaining: d.days_remaining as number,
        notice_form: d.notice_form as string,
        window_days: d.window_days as number,
        starts_from: d.starts_from as string,
        counted_from: d.counted_from as string,
      })),
      checks: arr(full.checks).map((c) => ({
        check: c.check as string,
        status: c.status as string,
        findings: c.findings as number,
      })),
      checks_not_run: full.checks_not_run as Json[],
      cost_shifting: cost
        ? {
            threshold_amount: cost.threshold_amount as number,
            crosses_on_firm_findings: cost.crosses_on_firm_findings as boolean,
            crosses_if_readings_hold: cost.crosses_if_readings_hold as boolean,
          }
        : null,
    },
    findings: findings.map((f) => ({
      id: f.id as string,
      code: f.code as string,
      check: f.check as string,
      class: f.class as string,
      title: f.title as string,
      landlord_label: f.landlord_label as string,
      lease_label: f.lease_label as string,
      landlord_figure: f.landlord_figure as number | null,
      lease_figure: f.lease_figure as number | null,
      difference: f.difference as number | null,
      lease_pages: pages(f, "lease"),
      statement_pages: pages(f, "statement"),
      lease_fact_ids: f.lease_fact_ids as string[],
    })),
    sources: {
      ...documentsOf(p.auditInput),
      facts_used: (full.facts_used as string[]).length,
    },
    result_ref: {
      tool: "audit_expense_statement",
      input_digest: sha256Hex(canonicalJson(p.auditInput as unknown as Json)),
      result_digest: documentId(full),
      note: "The same audit_expense_statement call on this location's lease_facts, statement_facts, prior_statement_facts (if any), as_of and yoy_threshold returns a result whose digest is result_digest.",
    },
    package: {
      kind: "expense_reconciliation",
      package_items: items,
      items_count: items.length,
      questions_not_sent: full.questions_not_sent as string[],
      note: "To send this location's findings to its own landlord: fact_package_create from this location's lease and statement facts, then fact_package_send with package_items as items (and this location's attestation, when the hosted service returned one). One package per location; never combine locations in one package.",
    },
  };
  if (includeResults) entry.result = full;
  return entry;
}

interface Dl {
  label: string;
  landlord: string | null;
  statement_year: number | null;
  last_day: string;
  days_remaining: number;
  status: string;
  notice_form: string;
  window_days: number;
  starts_from: string;
  counted_from: string;
}

function money(x: number): string {
  const r = round(Math.abs(x), 2).toFixed(2);
  const [int, frac] = r.split(".") as [string, string];
  return `${x < 0 && r !== "0.00" ? "-" : ""}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function portfolio(input: PortfolioInput): Json {
  const seen = new Map<string, number>();
  const prepared: Prepared[] = [];
  const invalid: Json[] = [];
  input.audits.forEach((entry, i) => {
    const p = prepareEntry(entry, i, input.as_of, input.yoy_threshold, seen);
    if (p.ok) prepared.push(p.value);
    else
      invalid.push({
        index: i,
        label: p.label || null,
        landlord: p.landlord,
        status: "input_invalid",
        issues: p.issues,
      });
  });
  const locs: Loc[] = [];
  for (const p of prepared) {
    let full: Json;
    try {
      full = audit(p.auditInput);
    } catch (err) {
      if (!(err instanceof ToolInputError)) throw err;
      invalid.push({
        index: p.index,
        label: p.label,
        landlord: p.landlord,
        status: "input_invalid",
        issues: err.issues.map((x) => ({
          path: `audits.${p.index}.${x.path}`,
          message: x.message,
        })),
      });
      continue;
    }
    locs.push({
      index: p.index,
      label: p.label,
      landlord: p.landlord,
      landlordKey: p.landlord === null ? null : norm(p.landlord),
      year:
        typeof full.statement_year === "number" ? full.statement_year : null,
      full,
      entry: locationEntry(p, full, input.include_results),
    });
  }
  invalid.sort((a, b) => num(a.index) - num(b.index));

  // ---- totals ---------------------------------------------------------------------------------
  let firm = 0;
  let readings = 0;
  const classCount: Record<Cls, number> = {
    follows_from_terms: 0,
    depends_on_reading: 0,
    question_to_ask: 0,
  };
  const classDollars: Record<Cls, number> = {
    follows_from_terms: 0,
    depends_on_reading: 0,
    question_to_ask: 0,
  };
  let findingCount = 0;
  for (const l of locs) {
    const t = l.full.totals as Json;
    firm += num(t.firm_difference);
    readings += num(t.total_difference) - num(t.firm_difference);
    findingCount += num(t.finding_count);
    for (const f of arr(l.full.findings)) {
      const c = f.class as Cls;
      classCount[c] += 1;
      if (typeof f.difference === "number")
        classDollars[c] = usd(classDollars[c] + f.difference);
    }
  }
  firm = usd(firm);
  readings = usd(readings);
  const total = usd(firm + readings);

  // ---- by check ---------------------------------------------------------------------------------
  const byCheck = CHECKS.map(([check, name]) => {
    let findings = 0;
    const cc: Record<Cls, number> = {
      follows_from_terms: 0,
      depends_on_reading: 0,
      question_to_ask: 0,
    };
    let dollars = 0;
    let withFindings = 0;
    let ran = 0;
    let partly = 0;
    let notRun = 0;
    for (const l of locs) {
      const fs = arr(l.full.findings).filter((f) => f.check === check);
      if (fs.length) withFindings += 1;
      for (const f of fs) {
        findings += 1;
        cc[f.class as Cls] += 1;
        if (typeof f.difference === "number")
          dollars = usd(dollars + f.difference);
      }
      const st = arr(l.full.checks).find((c) => c.check === check)?.status;
      if (st === "ran") ran += 1;
      else if (st === "partly_run") partly += 1;
      else notRun += 1;
    }
    return {
      check,
      name,
      findings,
      follows_from_terms: cc.follows_from_terms,
      depends_on_reading: cc.depends_on_reading,
      question_to_ask: cc.question_to_ask,
      dollars_at_stake: dollars,
      locations_with_findings: withFindings,
      locations_ran: ran,
      locations_partly_run: partly,
      locations_not_run: notRun,
    };
  });

  // ---- by landlord ------------------------------------------------------------------------------
  const groups = new Map<string, { name: string | null; locs: Loc[] }>();
  for (const l of locs) {
    const key = l.landlordKey ?? "";
    const g = groups.get(key) ?? { name: l.landlord, locs: [] };
    g.locs.push(l);
    groups.set(key, g);
  }
  const dlOf = (l: Loc): Dl[] =>
    arr(l.full.deadlines).map((d) => ({
      label: l.label,
      landlord: l.landlord,
      statement_year: l.year,
      last_day: str(d.last_day),
      days_remaining: num(d.days_remaining),
      status: str(d.status),
      notice_form: str(d.notice_form),
      window_days: num(d.window_days),
      starts_from: str(d.starts_from),
      counted_from: str(d.counted_from),
    }));
  const dlSort = (a: Dl, b: Dl): number =>
    cmp(a.last_day, b.last_day) || cmp(a.label, b.label);
  const earliestOpen = (list: Dl[]): Json | null => {
    const open = list.filter((d) => d.status === "open").sort(dlSort);
    const d = open[0];
    return d
      ? {
          label: d.label,
          last_day: d.last_day,
          days_remaining: d.days_remaining,
        }
      : null;
  };
  const byLandlord = [...groups.values()]
    .map((g) => {
      const f = usd(
        g.locs.reduce(
          (a, l) => a + num((l.full.totals as Json).firm_difference),
          0,
        ),
      );
      const t = usd(
        g.locs.reduce(
          (a, l) => a + num((l.full.totals as Json).total_difference),
          0,
        ),
      );
      return {
        landlord: g.name,
        landlord_name: g.name ?? NO_LANDLORD,
        locations: g.locs.length,
        location_labels: g.locs.map((l) => l.label),
        findings: g.locs.reduce(
          (a, l) => a + num((l.full.totals as Json).finding_count),
          0,
        ),
        firm_difference: f,
        readings_difference: usd(t - f),
        total_difference: t,
        earliest_deadline: earliestOpen(g.locs.flatMap(dlOf)),
      };
    })
    .sort(
      (a, b) =>
        b.total_difference - a.total_difference ||
        cmp(a.landlord_name, b.landlord_name),
    );

  // ---- ranking and deadlines --------------------------------------------------------------------
  const ranking = locs
    .map((l) => ({
      label: l.label,
      landlord: l.landlord,
      statement_year: l.year,
      finding_count: num((l.full.totals as Json).finding_count),
      firm_difference: num((l.full.totals as Json).firm_difference),
      total_difference: num((l.full.totals as Json).total_difference),
    }))
    .sort(
      (a, b) =>
        b.total_difference - a.total_difference ||
        b.firm_difference - a.firm_difference ||
        cmp(a.label, b.label),
    )
    .map((r, i) => ({ rank: i + 1, ...r }));
  const deadlines = locs.flatMap(dlOf).sort(dlSort);
  const withoutDeadline = locs
    .filter((l) => arr(l.full.deadlines).length === 0)
    .map((l) => l.label);
  const openDl = deadlines.filter((d) => d.status === "open").length;

  // ---- repeated issues --------------------------------------------------------------------------
  // A check "fails" at a location when it has a finding that is an overcharge claim (follows from the
  // lease's terms, or depends on a reading); a question to ask is not a failure.
  const failing = (l: Loc, check: string): Json[] =>
    arr(l.full.findings).filter(
      (f) => f.check === check && f.class !== "question_to_ask",
    );
  const repeated: Json[] = [];
  CHECKS.forEach(([check, name], ci) => {
    const failed = locs.filter((l) => failing(l, check).length > 0);
    if (failed.length < 2) return;
    const row = (scope: string, landlord: string | null, ls: Loc[]): Json => {
      const fs = ls.flatMap((l) => failing(l, check));
      const years = [
        ...new Set(ls.flatMap((l) => (l.year === null ? [] : [l.year]))),
      ].sort((a, b) => a - b);
      const dollars = usd(
        fs.reduce(
          (a, f) => a + (typeof f.difference === "number" ? f.difference : 0),
          0,
        ),
      );
      const names = [
        ...new Set(
          ls.flatMap((l) => (l.landlord === null ? [] : [l.landlord])),
        ),
      ];
      return {
        check,
        check_name: name,
        scope,
        landlord,
        landlords: names,
        locations: ls.map((l) => l.label),
        location_count: ls.length,
        statement_years: years,
        across_years: years.length >= 2,
        finding_count: fs.length,
        finding_codes: [...new Set(fs.map((f) => str(f.code)))].sort(),
        dollars_at_stake: dollars,
        summary: `${name}: a finding at ${ls.length} locations${
          landlord !== null ? ` for ${landlord}` : ""
        }${years.length >= 2 ? `, in statement years ${years.join(", ")}` : ""}, ${money(dollars)} in all`,
        _order: ci,
      };
    };
    const rows: Json[] = [];
    const byKey = new Map<string, Loc[]>();
    for (const l of failed)
      if (l.landlordKey !== null)
        byKey.set(l.landlordKey, [...(byKey.get(l.landlordKey) ?? []), l]);
    for (const ls of byKey.values())
      if (ls.length >= 2) rows.push(row("landlord", ls[0]!.landlord, ls));
    const oneLandlordCoversAll =
      byKey.size === 1 && [...byKey.values()][0]!.length === failed.length;
    if (!oneLandlordCoversAll) rows.push(row("portfolio", null, failed));
    repeated.push(...rows);
  });
  repeated.sort(
    (a, b) =>
      num(b.dollars_at_stake) - num(a.dollars_at_stake) ||
      num(a._order) - num(b._order) ||
      cmp(str(a.landlord), str(b.landlord)) ||
      cmp(str(a.scope), str(b.scope)),
  );
  for (const r of repeated) delete r._order;

  // ---- warnings and answer ----------------------------------------------------------------------
  const warnings: string[] = [];
  if (invalid.length)
    warnings.push(
      `${invalid.length} ${invalid.length === 1 ? "location was" : "locations were"} not audited because the input failed validation (${invalid
        .map((x) => str(x.label) || `audits.${num(x.index)}`)
        .join(
          ", ",
        )}); the issues are under locations_invalid and the other locations were audited.`,
    );
  const passed = [
    ...new Set(
      deadlines.filter((d) => d.status === "passed").map((d) => d.label),
    ),
  ];
  if (passed.length)
    warnings.push(
      `The last day to dispute or audit has passed as of ${input.as_of} for: ${passed.join(", ")}. Confirm with the lease how the day is counted and whether a late dispute is still open.`,
    );
  if (withoutDeadline.length)
    warnings.push(
      `No deadline could be computed (the lease's audit right was not supplied) for: ${withoutDeadline.join(", ")}.`,
    );
  const exceeding = locs
    .filter((l) => (l.full.totals as Json).exceeds_tenant_charge === true)
    .map((l) => l.label);
  if (exceeding.length)
    warnings.push(
      `The differences add to more than the tenant's whole charge at: ${exceeding.join(", ")}. A difference cannot exceed what was billed, so these totals (and the portfolio totals that include them) are not reliable until a person has checked the level each amount was entered at; each location's own warnings say more (include_results).`,
    );
  const levelNotes = locs
    .filter((l) => arr(l.full.warnings).length > 0)
    .map((l) => l.label);
  if (levelNotes.length)
    warnings.push(
      `The audit of these locations carries its own warnings (a level that was inferred or not stated, or a total above the tenant's charge): ${levelNotes.join(", ")}. Read them with include_results before relying on the figures.`,
    );

  return {
    as_of: input.as_of,
    portfolio: {
      locations_submitted: input.audits.length,
      locations_audited: locs.length,
      locations_invalid: invalid.length,
      finding_count: findingCount,
      follows_from_terms: classCount.follows_from_terms,
      depends_on_reading: classCount.depends_on_reading,
      question_to_ask: classCount.question_to_ask,
      firm_difference: firm,
      readings_difference: readings,
      total_difference: total,
      unit: "USD",
      earliest_deadline: earliestOpen(deadlines),
      open_deadlines: openDl,
      passed_deadlines: deadlines.length - openDl,
      locations_without_deadline: withoutDeadline.length,
    },
    report_units: locs.length,
    by_class: CLASSES.map((c) => ({
      class: c,
      label: CLASS_LABEL[c],
      findings: classCount[c],
      dollars_at_stake: classDollars[c],
    })),
    by_check: byCheck,
    by_landlord: byLandlord,
    ranking,
    deadlines,
    locations_without_deadline: withoutDeadline,
    repeated_issues: repeated,
    locations: locs.map((l) => l.entry),
    locations_invalid: invalid,
    warnings,
    notes: [
      "Each location is one audit_expense_statement run: a finding is a difference between that statement and what the lease's quoted terms yield, with the sources named. It is not a legal conclusion: findings that depend on a reading of the lease, and questions, say so in their class.",
      "Dollars at stake are the sum of the findings that follow from the lease's terms and the findings that depend on a reading, shown apart. A question to ask carries no dollars. Findings can overlap within a location, so a total is the sum of findings, not a recomputed charge.",
      "A repeated issue is a check with an overcharge finding (one that follows from the terms or depends on a reading) at two or more locations; a landlord's own pattern is listed apart, with the statement years it spans.",
      `The portfolio report (report_create kind expense_audit_portfolio) counts one unit of the monthly report allowance for each location audited in full (report_units); locations with invalid input are not counted.`,
    ],
  };
}

/** The summary a caller without a paid plan gets (hosted API, gating on): counts and totals. */
export function portfolioSummary(full: Json): Json {
  const p = full.portfolio as Json;
  return {
    limited: true,
    summary: {
      locations_submitted: p.locations_submitted,
      locations_audited: p.locations_audited,
      locations_invalid: p.locations_invalid,
      finding_count: p.finding_count,
      follows_from_terms: p.follows_from_terms,
      depends_on_reading: p.depends_on_reading,
      question_to_ask: p.question_to_ask,
      firm_difference: p.firm_difference,
      readings_difference: p.readings_difference,
      total_difference: p.total_difference,
      unit: "USD",
      open_deadlines: p.open_deadlines,
      passed_deadlines: p.passed_deadlines,
      locations_without_deadline: p.locations_without_deadline,
    },
    report_units: full.report_units,
    // Input errors are free and the caller needs them to fix the input: the issues, not audit results.
    locations_invalid: full.locations_invalid,
    audit_available: "pro",
    audit_withheld: [
      "the ranking of locations, the totals by landlord and by check, and the schedule of dispute deadlines",
      "the repeated issues across locations and years",
      "each location's summary and findings, and the items to send to each landlord with fact_package_send",
      "the portfolio report (report_create kind expense_audit_portfolio)",
    ],
    free_document: {
      free_document: false,
      note: `The one free full document an email-verified account gets covers a single audit (audit_expense_statement), not a portfolio: this answer is the summary and nothing was taken from that free document. ${FREE_DOCUMENT_PLAN_URL}`,
    },
    audit_note: `The counts and totals are free. The ranking, the deadline schedule, each location's findings with their lease quotes, the report and sending each location's dispute as a package are part of the paid plans (Pro and Team): ${PORTFOLIO_PLAN_URL}`,
  };
}

export function portfolioLimited(): boolean {
  return auditLimited();
}

export function auditExpensePortfolio(input: PortfolioInput): Json {
  const full = portfolio(input);
  return portfolioLimited() ? portfolioSummary(full) : full;
}

/**
 * The hosted service signs each location on its own: the attestation of a location is the one
 * audit_expense_statement returns for that location's input (same inputs digest, same items), so a
 * location's package is sent and checked exactly as a single audit's. A service without a signing key
 * says so; a local run adds nothing.
 */
export async function attestPortfolio(
  input: PortfolioInput,
  out: unknown,
  toolVersion: string,
): Promise<unknown> {
  if (!isObj(out) || !Array.isArray(out.locations)) return out;
  const byIndex = new Map(portfolioAuditInputs(input).map((p) => [p.index, p]));
  let note: string | undefined;
  let signed = 0;
  const locations: Json[] = [];
  for (const loc of out.locations as Json[]) {
    const p = byIndex.get(num(loc.index));
    const pkg = isObj(loc.package) ? loc.package : undefined;
    const items = pkg ? arr(pkg.package_items) : [];
    if (!p || !pkg || items.length === 0) {
      locations.push(loc);
      continue;
    }
    const attested = (await attestResult(
      "audit_expense_statement",
      p.auditInput,
      { package_items: items },
      toolVersion,
    )) as Json;
    if (!("attestation" in attested)) {
      locations.push(loc);
      continue;
    }
    if (attested.attestation !== null) signed += 1;
    if (typeof attested.attestation_note === "string")
      note = attested.attestation === null ? attested.attestation_note : note;
    locations.push({
      ...loc,
      package: { ...pkg, attestation: attested.attestation },
    });
  }
  if (signed === 0 && note === undefined) return { ...out, locations };
  return {
    ...out,
    locations,
    ...(signed > 0
      ? {
          attestation_note:
            "Each location's package carries its own attestation (package.attestation): give it, unchanged, to fact_package_send with that location's package_items. The attestation is the one audit_expense_statement returns for that location's input, so each location's send is checked on its own. Any change to an item or a cited fact makes it invalid and the send is refused.",
        }
      : { attestation_note: note }),
  };
}
