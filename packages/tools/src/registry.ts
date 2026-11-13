/**
 * Read-only access to a FactLot Registry SQLite file (built by the Python `factlot.registry`
 * pipeline). Mirrors the Python query logic exactly; a cross-language test enforces it.
 * Configure with FACTLOT_REGISTRY_DB=/path/to/registry.db or `configureRegistry(path)`.
 */
import { createRequire } from "node:module";

import { fmtNum, round } from "@factlot/calc";
import {
  FactLotIdError,
  addressTokens,
  normalizeApnV1,
  parcelId,
  parse,
} from "@factlot/id";

import { countyName } from "./county_names.ts";

type Row = Record<string, unknown>;
interface Statement {
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}
interface Database {
  prepare(sql: string): Statement;
  close(): void;
}

export class RegistryUnavailableError extends Error {
  override name = "RegistryUnavailableError";
}

let configuredPath: string | undefined;
let db: Database | undefined;
let dbPath: string | undefined;
// The coverage summary of the open file (read from meta or computed), with the stamp it was made at.
let coverageCache: { stamp: string; summary: unknown } | undefined;

/** Point the registry tools at a SQLite file (or undefined to fall back to FACTLOT_REGISTRY_DB). */
export function configureRegistry(path: string | undefined): void {
  configuredPath = path;
  db?.close();
  db = undefined;
  dbPath = undefined;
  coverageCache = undefined;
}

export function registryPath(): string | undefined {
  return configuredPath ?? process.env.FACTLOT_REGISTRY_DB ?? undefined;
}

function open(): Database {
  const path = registryPath();
  if (!path)
    throw new RegistryUnavailableError(
      "this FactLot server has no registry loaded. Registry tools read a registry file: download one (sample: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/registry-sample-dc-2026-11-07) and run FactLot yourself with FACTLOT_REGISTRY_DB pointing at it. The hosted API at https://api.factlot.com serves the regions listed by registry_coverage.",
    );
  if (db && dbPath === path) return db;
  db?.close();
  coverageCache = undefined;
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => Database;
  };
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    // The path and the driver's message stay out of the error: agents and remote callers see
    // this text, and a filesystem path is server detail they do not need.
    throw new RegistryUnavailableError(
      "cannot open the FactLot Registry configured in FACTLOT_REGISTRY_DB",
    );
  }
  dbPath = path;
  return db;
}

// --- normalization (must match factlot.registry.normalize) ------------------------------------

const SUFFIXES: [RegExp, string][] = [
  [/\bLIMITED LIABILITY COMPANY\b/g, "LLC"],
  [/\bL L C\b/g, "LLC"],
  [/\bLIMITED LIABILITY PARTNERSHIP\b/g, "LLP"],
  [/\bL L P\b/g, "LLP"],
  [/\bLIMITED PARTNERSHIP\b/g, "LP"],
  [/\bL P\b/g, "LP"],
  [/\bINCORPORATED\b/g, "INC"],
  [/\bCORPORATION\b/g, "CORP"],
  [/\bCOMPANY\b/g, "CO"],
  [/\bLIMITED\b/g, "LTD"],
];

// Apostrophes are dropped, not spaced: rolls write "OREILLY" where the registration says "O'REILLY".
const APOSTROPHES = /['\u2018\u2019`\u00b4]/g;
// What a roll appends to an owner but is not part of the name: a trade name ("DBA"), "ET AL", and
// a connector left dangling by a truncated line.
const NAME_TAIL = /\s(?:DBA|D B A|ET AL|ETAL|ET UX|ETUX|ET VIR|ETVIR)\b.*$/;
const DANGLING = /\s(?:AND|THE)$/;
const NUMBER_WORD = /\b(?:NO|NUMBER)\s+(?=\d)/g;

// One spelling per inconsistently abbreviated word (must match NAME_TOKEN_CANON in normalize.py).
const NAME_TOKEN_CANON: Record<string, string> = {
  PPTY: "PROPERTY",
  PPTIES: "PROPERTIES",
  PPRTIES: "PROPERTIES",
  PPTYS: "PROPERTIES",
  CTR: "CENTER",
  CTRS: "CENTERS",
  PTNR: "PARTNER",
  PTNRS: "PARTNERS",
  PRTNRS: "PARTNERS",
  PTNRSHP: "PARTNERSHIP",
  PTNRSHIP: "PARTNERSHIP",
  PRTNRSHP: "PARTNERSHIP",
  APTS: "APARTMENTS",
  MGMT: "MANAGEMENT",
  MGT: "MANAGEMENT",
  DEVEL: "DEVELOPMENT",
  BLDG: "BUILDING",
  BLDGS: "BUILDINGS",
  INTL: "INTERNATIONAL",
  HLDGS: "HOLDINGS",
  HLDG: "HOLDING",
  RLTY: "REALTY",
  STREET: "ST",
  AVENUE: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  BOULEVARD: "BLVD",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
};

export function normalizeName(name: string): string {
  let s = name.toUpperCase().replace(APOSTROPHES, "").replaceAll("&", " AND ");
  s = s
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, repl] of SUFFIXES) s = s.replace(pattern, repl);
  s = s.replace(/^THE /, "");
  const tail = s.replace(NAME_TAIL, "");
  if (tail) s = tail;
  for (;;) {
    const trimmed = s.replace(DANGLING, "");
    if (trimmed === s || !trimmed) break;
    s = trimmed;
  }
  s = s.replace(NUMBER_WORD, "").replace(/\s+/g, " ").trim();
  return joinInitials(s)
    .split(" ")
    .map((t) => NAME_TOKEN_CANON[t] ?? t)
    .join(" ");
}

// Consecutive single letters run together: "W G G PROPERTIES" (from "W.G.G.") is "WGG PROPERTIES".
function joinInitials(s: string): string {
  const out: string[] = [];
  let run = "";
  for (const t of s.split(" ")) {
    if (/^[A-Z]$/.test(t)) {
      run += t;
      continue;
    }
    if (run) {
      out.push(run);
      run = "";
    }
    out.push(t);
  }
  if (run) out.push(run);
  return out.join(" ");
}

const STREET: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  BOULEVARD: "BLVD",
  LANE: "LN",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
  FREEWAY: "FWY",
  COURT: "CT",
  PLACE: "PL",
  CIRCLE: "CIR",
  TRAIL: "TRL",
  SUITE: "STE",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  EXPRESSWAY: "EXPY",
};

/**
 * Address search key (address key version 2): "Northwest", "North West" and "N.W." are "NW", and a
 * unit, suite, "#" or floor designator is dropped with its value (`addressTokens` in @factlot/id).
 */
export function normalizeAddress(address: string): string {
  return addressTokens(address).join(" ");
}

/** The key `normalizeAddress` made before 2026-11-03 (address key version 1; `legacy_address_key` in Python). */
export function legacyNormalizeAddress(address: string): string {
  return address
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET[w] ?? w)
    .join(" ");
}

// --- queries ------------------------------------------------------------------------------

const CURRENT_LINK =
  "(r.type != 'owns' OR EXISTS (SELECT 1 FROM current_facts cf WHERE cf.subject = r.to_urn " +
  "AND cf.predicate = 'ownership.owner_of_record' AND cf.document_id = r.document_id))";

function rights(d: Database, documentId: string): { source: Row; rights: Row } {
  const row = d
    .prepare(
      "SELECT s.*, src.publisher, src.title AS src_title, src.url, src.license, src.ai_use, src.redistribution, src.attribution " +
        "FROM snapshots s JOIN sources src USING (source_id) WHERE s.document_id = ?",
    )
    .get(documentId) as Row;
  const source: Row = {
    document_id: documentId,
    title: `${row.publisher}: ${row.src_title} (${row.filename})`,
    uri: row.url,
    retrieved_at: row.retrieved_at,
  };
  const r: Row = {
    ai_use: row.ai_use,
    redistribution: row.redistribution,
    license: row.license,
  };
  if (row.attribution) r.attribution = row.attribution;
  return { source, rights: r };
}

/**
 * Predicates a subject may hold many of at once (one fact per sale, deed, mortgage or satisfaction; one per CMBS trust's
 * participation in a building's loan; one per registrant that lists an entity as its subsidiary). Every other predicate is
 * single-valued: when two current sources disagree, the newest fact is returned.
 */
export const MULTI_VALUED_PREDICATES: ReadonlySet<string> = new Set([
  "transaction.sale",
  "transaction.deed",
  "debt.mortgage_recorded",
  "debt.mortgage_satisfaction_recorded",
  "debt.cmbs_loan",
  "entity.parent",
]);

/** Order the facts of a many-valued predicate (sales) newest first, in the slots they occupy. */
function newestFirst(facts: Row[]): Row[] {
  const slots: number[] = [];
  facts.forEach((f, i) => {
    if (MULTI_VALUED_PREDICATES.has(String(f.predicate))) slots.push(i);
  });
  if (slots.length < 2) return facts;
  const key = (f: Row): [string, number, string] => {
    const v = (f.value ?? {}) as Row;
    const amount = v.price_usd ?? v.current_balance_usd;
    const price = typeof amount === "number" ? amount : -1;
    const when = v.date ?? v.reporting_period_end;
    return [typeof when === "string" ? when : "", price, String(f.id)];
  };
  const ordered = slots
    .map((i) => facts[i]!)
    .sort((a, b) => {
      const [da, pa, ia] = key(a);
      const [db, pb, ib] = key(b);
      if (da !== db) return da < db ? 1 : -1;
      if (pa !== pb) return pa < pb ? 1 : -1;
      return ia < ib ? 1 : ia > ib ? -1 : 0;
    });
  slots.forEach((i, n) => {
    facts[i] = ordered[n]!;
  });
  return facts;
}

// Facts current on a date: the coverage rule of the `current_facts` view, applied to the snapshots
// dated on or before it (`_FACTS_AT` in Python).
const FACTS_AT =
  "SELECT f.* FROM facts f JOIN snapshots s ON s.document_id = f.document_id WHERE f.subject = ? " +
  "AND f.as_of <= ? AND f.as_of = (SELECT MAX(c.as_of) FROM coverage c WHERE c.subject = f.subject " +
  "AND c.source_id = s.source_id AND c.as_of <= ?)";
const ORDER_FACTS = " ORDER BY predicate, as_of DESC, fact_id";

/**
 * Facts about a subject: the current ones, or the whole history. With `asOf` (YYYY-MM-DD), the
 * facts that were current on that date, or with `history` every fact dated on or before it.
 */
export function registryFacts(
  urn: string,
  history = false,
  asOf?: string,
): Row[] {
  const d = open();
  const rows =
    asOf === undefined
      ? d
          .prepare(
            `SELECT * FROM ${history ? "facts" : "current_facts"} WHERE subject = ?${ORDER_FACTS}`,
          )
          .all(urn)
      : history
        ? d
            .prepare(
              `SELECT * FROM facts WHERE subject = ? AND as_of <= ?${ORDER_FACTS}`,
            )
            .all(urn, asOf)
        : d.prepare(FACTS_AT + ORDER_FACTS).all(urn, asOf, asOf);
  const out: Row[] = [];
  const seen = new Set<unknown>();
  for (const f of rows) {
    if (
      !history &&
      seen.has(f.predicate) &&
      !MULTI_VALUED_PREDICATES.has(String(f.predicate))
    )
      continue;
    seen.add(f.predicate);
    const { source, rights: r } = rights(d, String(f.document_id));
    if (f.locator) source.section = f.locator;
    const provenance: Row = {
      method: f.method,
      sources: [source],
      producer: { name: "factlot.registry", version: "1" },
    };
    const fact: Row = {
      id: f.fact_id,
      subject: urn,
      predicate: f.predicate,
      value: JSON.parse(String(f.value_json)),
      as_of: f.as_of,
      provenance,
      rights: r,
    };
    if (f.unit) fact.unit = f.unit;
    if (f.confidence !== null && f.confidence !== undefined)
      provenance.confidence = f.confidence;
    out.push(fact);
  }
  return newestFirst(out);
}

function status(d: Database, urn: string, asOf?: string): string {
  const at = asOf === undefined ? "" : " AND c.as_of <= ?";
  const rows = d
    .prepare(
      `SELECT c.present FROM coverage c WHERE c.subject = ?${at} AND c.as_of = ` +
        `(SELECT MAX(as_of) FROM coverage d WHERE d.subject = c.subject AND d.source_id = c.source_id${at.replace("c.", "d.")})`,
    )
    .all(...(asOf === undefined ? [urn] : [urn, asOf, asOf]));
  if (
    rows.length === 0 &&
    asOf !== undefined &&
    d.prepare("SELECT 1 AS x FROM coverage WHERE subject = ?").get(urn)
  )
    return "not_yet_recorded";
  return rows.length === 0 || rows.some((r) => Number(r.present) === 1)
    ? "current"
    : "not_in_latest_snapshot";
}

// An ownership link on a date: made by then, from an owner-of-record fact current on that date.
const LINK_AT =
  "r.as_of <= ? AND (r.type != 'owns' OR EXISTS (SELECT 1 FROM facts f JOIN snapshots s ON " +
  "s.document_id = f.document_id WHERE f.subject = r.to_urn AND f.predicate = 'ownership.owner_of_record' " +
  "AND f.document_id = r.document_id AND f.as_of <= ? AND f.as_of = (SELECT MAX(c.as_of) FROM coverage c " +
  "WHERE c.subject = f.subject AND c.source_id = s.source_id AND c.as_of <= ?)))";

/**
 * A registry record: current facts and links, or with `asOf` (YYYY-MM-DD) those current on that
 * date (the building roll-up and crosswalk IDs are the file's current ones either way).
 */
export function registryGet(urn: string, asOf?: string): Row | null {
  const d = open();
  parse(urn); // a malformed URN is a format error (FactLotIdError), not a miss
  const subj = d.prepare("SELECT * FROM subjects WHERE urn = ?").get(urn);
  if (!subj) return null;
  const extra: Row = {};
  if (subj.kind === "parcel") {
    extra.building = buildingOf(d, urn);
    extra.value_history = registryValueHistory(urn, asOf);
  } else if (subj.kind === "building") extra.building = buildingDetail(d, urn);
  const relationships = d
    .prepare(
      `SELECT from_urn, type, to_urn, as_of, method, confidence, basis, document_id FROM relationships r ` +
        `WHERE (from_urn = ? OR to_urn = ?) AND ${asOf === undefined ? CURRENT_LINK : LINK_AT} ORDER BY as_of DESC`,
    )
    .all(urn, urn, ...(asOf === undefined ? [] : [asOf, asOf, asOf]))
    .map((r) => ({ ...r }));
  const crosswalk = d
    .prepare("SELECT system, external_id FROM crosswalk WHERE urn = ?")
    .all(urn)
    .map((r) => ({ ...r }));
  const facts = registryFacts(urn, false, asOf);
  const state = status(d, urn, asOf);
  return {
    urn,
    kind: subj.kind,
    short: subj.short,
    label: subj.label,
    ...(asOf === undefined ? {} : { as_of: asOf }),
    status: state,
    facts,
    // No link before the record itself.
    relationships: state === "not_yet_recorded" ? [] : relationships,
    crosswalk,
    ...extra,
    warnings: [
      ...areaWarnings(facts),
      ...(subj.kind === "parcel"
        ? improvementWarnings(
            facts,
            extra.building as Row | null,
            extra.building
              ? improvedSiblings(d, String((extra.building as Row).urn), urn)
              : [],
          )
        : []),
    ],
  };
}

/** Parcels of a building, other than `parcelUrn`, whose current facts include improvement facts (at most 5). */
function improvedSiblings(
  d: Database,
  buildingUrn: string,
  parcelUrn: string,
): string[] {
  return d
    .prepare(
      "SELECT DISTINCT m.parcel_urn AS urn FROM building_members m JOIN current_facts f ON f.subject = m.parcel_urn " +
        "WHERE m.building_urn = ? AND m.parcel_urn <> ? AND (f.predicate = 'parcel.year_built' OR " +
        "(f.predicate = 'parcel.improvement_area_sf' AND CAST(f.value_json AS REAL) > 0)) ORDER BY m.parcel_urn LIMIT 5",
    )
    .all(buildingUrn, parcelUrn)
    .map((r) => String(r.urn));
}

/**
 * A warning when a parcel record carries no improvement facts (`improvement_warnings` in Python):
 * its values may be for the land only. `siblings` are parcels of its building that do carry them,
 * where the improvements are probably assessed (a land account and a separate improvement account at
 * one address, for example).
 */
export function improvementWarnings(
  facts: Row[],
  building: Row | null,
  siblings: string[],
): string[] {
  if (!facts.length) return [];
  const improved = facts.some(
    (f) =>
      (f.predicate === "parcel.year_built" && finite(f.value) !== null) ||
      (f.predicate === "parcel.improvement_area_sf" &&
        (finite(f.value) ?? 0) > 0),
  );
  if (improved) return [];
  const base =
    "This parcel record has no improvement facts (parcel.improvement_area_sf, parcel.year_built), so its values may be for the land only";
  if (building && siblings.length) {
    const one = siblings.length === 1;
    return [
      `${base}. ${one ? "Another parcel" : "Other parcels"} of building ${String(building.urn)} at the same address ${one ? "has" : "have"} them: ${siblings.join(", ")}. The building is probably assessed on ${one ? "that account" : "those accounts"}; get ${one ? "it" : "them"} for the building's area, age and value.`,
    ];
  }
  return [
    `${base}: it may be vacant land, the source may not publish building facts for it, or the building may be assessed on another account.`,
  ];
}

// --- value history (Registry.value_history) ------------------------------------------------------

const VALUE_HISTORY_IN =
  "'parcel.tax_year', 'parcel.market_value', 'parcel.appraised_value'";
const ORDER_VALUE_HISTORY =
  " ORDER BY as_of DESC, document_id, predicate, fact_id";

/** The citation of one stored fact row: what a reader needs to find it in its source (`fact_citation` in Python). */
function factCitation(row: Row): Row {
  return {
    fact_id: row.fact_id,
    document_id: row.document_id,
    locator: row.locator ?? null,
    as_of: row.as_of,
  };
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function rowValue(row: Row | undefined): unknown {
  return row ? JSON.parse(String(row.value_json)) : null;
}

/**
 * Value-history entries from fact rows ordered by `ORDER_VALUE_HISTORY` (`value_history_entries` in Python).
 * The rows of one snapshot make one entry; where a snapshot holds two facts for one predicate (a file that
 * lists a parcel twice) the first in that order is used.
 */
function valueHistoryEntries(rows: Row[]): Row[] {
  const byDoc = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    const doc = String(r.document_id);
    const facts = byDoc.get(doc) ?? new Map<string, Row>();
    if (!facts.has(String(r.predicate))) facts.set(String(r.predicate), r);
    byDoc.set(doc, facts);
  }
  const kept: Row[] = [];
  for (const facts of byDoc.values()) {
    const market = facts.get("parcel.market_value");
    const appraised = facts.get("parcel.appraised_value");
    const mv = finite(rowValue(market));
    const av = finite(rowValue(appraised));
    if (mv === null && av === null) continue;
    const ty = finite(rowValue(facts.get("parcel.tax_year")));
    // Restated unchanged: the newer snapshot's entry stands.
    if (
      kept.some(
        (e) =>
          e.tax_year === ty &&
          e.market_value === mv &&
          e.appraised_value === av,
      )
    )
      continue;
    const first = (mv !== null ? market : appraised) as Row;
    kept.push({
      tax_year: ty,
      market_value: mv,
      appraised_value: av,
      as_of: first.as_of,
      citations: {
        market_value: mv !== null ? factCitation(market as Row) : null,
        appraised_value: av !== null ? factCitation(appraised as Row) : null,
      },
    });
  }
  // Snapshots are newest first already; a stable sort by tax year keeps that order within a year.
  return kept.sort((a, b) => {
    const ya = a.tax_year as number | null;
    const yb = b.tax_year as number | null;
    if (ya === null || yb === null)
      return (ya === null ? 1 : 0) - (yb === null ? 1 : 0);
    return yb - ya;
  });
}

/**
 * A parcel's market and appraised values by tax year, each cited (`Registry.value_history` in Python). Read
 * from every snapshot (current and superseded; with `asOf`, those dated on or before it): one entry per
 * snapshot that recorded a value. A tax year a later snapshot restates with the same values is listed once,
 * cited to the newest; a tax year two snapshots value differently is listed once per value, newest snapshot
 * first. Ordered by tax year, newest first (an entry without a tax year last).
 */
export function registryValueHistory(urn: string, asOf?: string): Row[] {
  const d = open();
  const sql = `SELECT * FROM facts WHERE subject = ? AND predicate IN (${VALUE_HISTORY_IN})${asOf === undefined ? "" : " AND as_of <= ?"}`;
  return valueHistoryEntries(
    d
      .prepare(sql + ORDER_VALUE_HISTORY)
      .all(...(asOf === undefined ? [urn] : [urn, asOf])),
  );
}

/** Floor-area ratio (improvement area ÷ land area) above which `registry_get` warns. */
export const MAX_PLAUSIBLE_FAR = 40;

function areaValue(facts: Row[], predicate: string): number | undefined {
  const v = facts.find((f) => f.predicate === predicate)?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Sanity checks on a parcel's area facts (`area_warnings` in Python). The facts are returned as the
 * source publishes them; a warning says which look wrong.
 */
export function areaWarnings(facts: Row[]): string[] {
  const land = areaValue(facts, "parcel.land_area_sf");
  const building = areaValue(facts, "parcel.improvement_area_sf");
  const out: string[] = [];
  if (land !== undefined && land <= 0)
    out.push(
      `parcel.land_area_sf is ${fmtNum(land)}: a land area must be positive, so the source's value is not usable`,
    );
  if (building !== undefined && building < 0)
    out.push(
      `parcel.improvement_area_sf is ${fmtNum(building)}: a building area cannot be negative, so the source's value is not usable`,
    );
  if (
    land !== undefined &&
    building !== undefined &&
    land > 0 &&
    building > 0 &&
    building / land > MAX_PLAUSIBLE_FAR
  )
    out.push(
      `parcel.improvement_area_sf (${fmtNum(building)} sf) is ${fmtNum(building / land, 1)} times parcel.land_area_sf (${fmtNum(land)} sf), a floor-area ratio above ${MAX_PLAUSIBLE_FAR}, which few buildings anywhere reach: one of the two areas is probably not this parcel's own (a condominium unit's record, for example, can carry the whole building's area against the unit's share of the land); check the source before using either`,
    );
  return out;
}

/** Meta `parcel_rule` of a file built under ID spec 0.3 (`PARCEL_RULE` in Python). */
const PARCEL_RULE = "2";

/** The parcel URN for an APN under the parcel rule the file was built with (`Registry.parcel_urn` in Python). */
function parcelUrn(
  d: Database,
  stateFips: string,
  countyFips: string,
  apn: string,
): string {
  const rule = d
    .prepare("SELECT value FROM meta WHERE key = 'parcel_rule'")
    .get();
  return parcelUrnForRule(
    rule ? String(rule.value) : null,
    stateFips,
    countyFips,
    apn,
  );
}

/**
 * The parcel URN for an APN under a file's meta `parcel_rule` (null: a file without one, built with parcel rule 1
 * under ID spec 0.1-0.2, which keeps its URNs). Throws FactLotIdError for an APN or FIPS code the rule rejects.
 */
export function parcelUrnForRule(
  rule: string | null,
  stateFips: string,
  countyFips: string,
  apn: string,
): string {
  return parcelId({
    stateFips,
    countyFips,
    apn,
    ...(rule === PARCEL_RULE ? {} : { normalize: normalizeApnV1 }),
  }).urn;
}

export function registryResolveParcel(
  stateFips: string,
  countyFips: string,
  apn: string,
): string | null {
  const d = open();
  const urn = parcelUrn(d, stateFips, countyFips, apn);
  return d.prepare("SELECT 1 AS x FROM subjects WHERE urn = ?").get(urn)
    ? urn
    : null;
}

export function registryResolveExternal(
  system: string,
  externalId: string,
): string | null {
  const row = open()
    .prepare("SELECT urn FROM crosswalk WHERE system = ? AND external_id = ?")
    .get(system, externalId);
  return row ? String(row.urn) : null;
}

// Files built before 2026-11-03 carry no name_key_version and keep the earlier keys until
// `python -m factlot.registry.maintain <db> --all` re-keys them; search them with the earlier rules.
const NAME_KEY_VERSION = "2";

/** The key `normalizeName` made before 2026-11-03 (name key version 1; `legacy_name_key` in Python). */
export function legacyNormalizeName(name: string): string {
  let s = name.toUpperCase().replaceAll("&", " AND ");
  s = s
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, repl] of SUFFIXES) s = s.replace(pattern, repl);
  s = s.replace(/^THE /, "");
  return s.replace(/\s+/g, " ").trim();
}

function nameSearchKey(d: Database, name: string): string {
  const row = d
    .prepare("SELECT value FROM meta WHERE key = 'name_key_version'")
    .get();
  return nameSearchKeyFor(row ? String(row.value) : null, name);
}

/** The entity search key for a name in a file whose meta `name_key_version` is `version` (null: none). */
export function nameSearchKeyFor(version: string | null, name: string): string {
  return version === NAME_KEY_VERSION
    ? normalizeName(name)
    : legacyNormalizeName(name);
}

export function registrySearchEntities(name: string, limit = 20): Row[] {
  const d = open();
  const key = nameSearchKey(d, name);
  return d
    .prepare(
      "SELECT DISTINCT s.urn, s.label FROM name_index n JOIN subjects s ON s.urn = n.urn " +
        "WHERE s.kind = 'entity' AND n.key LIKE ? ORDER BY (n.key = ?) DESC, s.label LIMIT ?",
    )
    .all(`%${key}%`, key, limit)
    .map((r) => ({ ...r }));
}

// Files built before 2026-11-03 carry no address_key_version and keep version 1 address keys until
// `python -m factlot.registry.maintain <db> --all` re-keys them; search them by both keys.
const ADDRESS_KEY_VERSION = "2";

function addressSearchKeys(d: Database, address: string): string[] {
  const row = d
    .prepare("SELECT value FROM meta WHERE key = 'address_key_version'")
    .get();
  return addressSearchKeysFor(row ? String(row.value) : null, address);
}

/**
 * The address keys a street line is searched by in a file whose meta `address_key_version` is `version`
 * (null: none): the current key, and for a file not yet re-keyed the version 1 key too.
 */
export function addressSearchKeysFor(
  version: string | null,
  address: string,
): string[] {
  const keys = [normalizeAddress(address)];
  const legacy = legacyNormalizeAddress(address);
  if (version !== ADDRESS_KEY_VERSION && !keys.includes(legacy))
    keys.push(legacy);
  return keys;
}

/** Street types: a query without a house number must name one ("Main St", not "Main"). */
const STREET_TYPES: ReadonlySet<string> = new Set([
  "ALY",
  "AVE",
  "BLVD",
  "BYP",
  "CIR",
  "CSWY",
  "CT",
  "DR",
  "EXPY",
  "FWY",
  "HWY",
  "LN",
  "LOOP",
  "PATH",
  "PIKE",
  "PKWY",
  "PL",
  "PLZ",
  "RD",
  "ROW",
  "RUN",
  "SQ",
  "ST",
  "TER",
  "TPKE",
  "TRL",
  "WALK",
  "WAY",
  "XING",
]);

/** The street types an address query without a house number must name (`STREET_TYPES` in Python). */
export const ADDRESS_STREET_TYPES: ReadonlySet<string> = STREET_TYPES;

export interface AddressQuery {
  /** "house_number": the first word is a number; "street": a street name with its type; null: neither. */
  mode: "house_number" | "street" | null;
  /** Words of the street line (before the first comma), as the address index writes them. */
  tokens: string[];
}

/**
 * How `registry_search_address` reads a query (`address_query` in Python). Matching is by whole
 * words of the street line: with a house number, an address starting with that number and holding
 * every other word; otherwise the words in a row, and only when they include a street type, so a
 * city ("Ontario") or a part of a word never matches a street that happens to contain it.
 */
export function addressQuery(query: string): AddressQuery {
  const tokens = addressTokens(query.split(",")[0] ?? "");
  const mode = /^[0-9]/.test(tokens[0] ?? "")
    ? "house_number"
    : tokens.some((t) => STREET_TYPES.has(t))
      ? "street"
      : null;
  return { mode, tokens };
}

const ORDINAL_WORD = /^([0-9]+)(?:ST|ND|RD|TH)$/;

/**
 * The words of a street line with the ordinal endings of its street numbers dropped ("W 42ND ST" → "W 42 ST"),
 * or null when no word after the first has one (`address_words_without_ordinals` in Python). Some rolls write
 * numbered streets bare ("136 WEST 42 STREET", "350 5 AVENUE"), so a query that found nothing is searched once
 * more this way. The first word is left alone: there it is a house number or the query's leading word.
 */
export function addressWordsWithoutOrdinals(words: string[]): string[] | null {
  let changed = false;
  const out = words.map((w, i) => {
    const m = i > 0 ? ORDINAL_WORD.exec(w) : null;
    if (!m) return w;
    changed = true;
    return m[1]!;
  });
  return changed ? out : null;
}

export function registrySearchAddress(address: string, limit = 20): Row[] {
  const d = open();
  const { mode } = addressQuery(address);
  if (mode === null) return [];
  const line = address.split(",")[0] ?? "";
  // Each key version the file may hold: the words of the street line under that version's rules.
  const runs = addressSearchKeys(d, line).map((k) => k.split(" "));
  const found = searchAddressRuns(d, mode, runs, limit);
  if (found.length) return found;
  // Nothing matched: once more with ordinal endings dropped, for rolls that write numbered streets bare.
  const bare = runs
    .map(addressWordsWithoutOrdinals)
    .filter((w): w is string[] => w !== null);
  return bare.length ? searchAddressRuns(d, mode, bare, limit) : found;
}

function searchAddressRuns(
  d: Database,
  mode: "house_number" | "street",
  runs: string[][],
  limit: number,
): Row[] {
  const where: string[] = [];
  const params: string[] = [];
  for (const words of runs) {
    if (mode === "street") {
      where.push("(' ' || a.key || ' ') LIKE ?");
      params.push(`% ${words.join(" ")} %`);
    } else {
      where.push(
        "(" +
          ["(a.key || ' ') LIKE ?"]
            .concat(words.slice(1).map(() => "(' ' || a.key || ' ') LIKE ?"))
            .join(" AND ") +
          ")",
      );
      params.push(`${words[0]} %`, ...words.slice(1).map((w) => `% ${w} %`));
    }
  }
  const keys = runs.map((w) => w.join(" "));
  const exact = keys.map(() => "a.key = ?").join(" OR ");
  return d
    .prepare(
      "SELECT s.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn " +
        `WHERE ${where.join(" OR ")} GROUP BY s.urn ORDER BY MAX(${exact}) DESC, s.label, s.urn LIMIT ?`,
    )
    .all(...params, ...keys, limit)
    .map((r) => ({ ...r }));
}

/** A source snapshot (`fl:document:sha256-…`) the registry cites, or null (`Registry.snapshot` in Python). */
export function registrySnapshot(documentId: string): Row | null {
  const row = open()
    .prepare(
      "SELECT s.document_id, s.source_id, s.retrieved_at, s.as_of, s.filename, s.bytes, src.publisher, " +
        "src.title, src.url, src.license, src.ai_use, src.redistribution, src.attribution " +
        "FROM snapshots s JOIN sources src USING (source_id) WHERE s.document_id = ?",
    )
    .get(documentId);
  return row ? { ...row } : null;
}

export function registryOwnedBy(entityUrn: string): Row[] {
  return open()
    .prepare(
      "SELECT r.to_urn AS urn, s.label, r.confidence, r.as_of FROM relationships r JOIN subjects s ON s.urn = r.to_urn " +
        `WHERE r.from_urn = ? AND r.type = 'owns' AND ${CURRENT_LINK} ORDER BY s.label`,
    )
    .all(entityUrn)
    .map((r) => ({ ...r }));
}

// --- coverage: what the file holds, and why a query missed (factlot.registry.coverage) -----------

const STATE_BY_FIPS: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
  "72": "PR",
};
const STATES = new Set(Object.values(STATE_BY_FIPS));
const LIST_CAP = 10;
export const REGISTRY_SCOPE =
  "Commercial, industrial and multifamily parcels only (no single-family homes), each fact cited to its source file; owners of record are kept only for organisations, never natural persons.";

export interface CoverageSource {
  source_id: string;
  as_of: string;
}
export interface CountyCoverage {
  region: string;
  state_fips: string;
  county_fips: string;
  state: string | null;
  parcels: number;
  buildings: number;
  sources: CoverageSource[];
}
export interface RegistryCoverage {
  counties: CountyCoverage[];
  entity_registries: {
    jurisdiction: string;
    entities: number;
    sources: CoverageSource[];
  }[];
  crosswalk_systems: { system: string; ids: number }[];
  totals: {
    parcels: number;
    entities: number;
    buildings: number;
    counties: number;
    states: string[];
  };
}

function statePostal(stateFips: string): string | null {
  return STATE_BY_FIPS[stateFips] ?? null;
}

function stateLabel(stateFips: string): string {
  return statePostal(stateFips) ?? `state ${stateFips}`;
}

/**
 * "Pinal County, AZ (04021)", with the Census name (`county_names.ts`); "county 48999 (TX)" for a
 * code the Census list does not hold. `detail` goes inside the parentheses after the code.
 */
function countyLabel(
  stateFips: string,
  countyFips: string,
  detail = "",
): string {
  const fips = `${stateFips}${countyFips}`;
  const name = countyName(fips);
  return name
    ? `${name}, ${stateLabel(stateFips)} (${fips}${detail})`
    : `county ${fips} (${stateLabel(stateFips)}${detail})`;
}

function coverageStamp(d: Database): {
  snapshots: number;
  subjects_max_rowid: number;
} {
  return {
    snapshots: Number(
      d.prepare("SELECT COUNT(*) AS n FROM snapshots").get()?.n,
    ),
    subjects_max_rowid: Number(
      d.prepare("SELECT COALESCE(MAX(rowid), 0) AS n FROM subjects").get()?.n,
    ),
  };
}

function coverageSources(
  d: Database,
  lo: string,
  hi: string,
  keySql: string,
): Map<string, CoverageSource[]> {
  const out = new Map<string, CoverageSource[]>();
  for (const r of d
    .prepare(
      `SELECT ${keySql} AS k, c.source_id AS source_id, MAX(c.as_of) AS as_of FROM coverage c ` +
        "WHERE c.subject >= ? AND c.subject < ? GROUP BY k, c.source_id ORDER BY k, c.source_id",
    )
    .all(lo, hi)) {
    const k = String(r.k);
    const list = out.get(k) ?? [];
    list.push({ source_id: String(r.source_id), as_of: String(r.as_of) });
    out.set(k, list);
  }
  return out;
}

/** What the configured file holds, computed from its tables (never the stored meta summary). */
export function computeRegistryCoverage(): RegistryCoverage {
  return computeCoverage(open());
}

function computeCoverage(d: Database): RegistryCoverage {
  const buildings = new Map(
    d
      .prepare(
        "SELECT substr(urn, 13, 8) AS region, COUNT(*) AS n FROM subjects WHERE kind = 'building' " +
          "AND urn LIKE 'fl:building:us-%' GROUP BY region",
      )
      .all()
      .map((r) => [String(r.region), Number(r.n)]),
  );
  const parcelSources = coverageSources(
    d,
    "fl:parcel:",
    "fl:parcel;",
    "substr(c.subject, 11, 8)",
  );
  const counties: CountyCoverage[] = d
    .prepare(
      "SELECT substr(urn, 11, 8) AS region, COUNT(*) AS n FROM subjects WHERE kind = 'parcel' " +
        "GROUP BY region ORDER BY region",
    )
    .all()
    .map((r) => {
      const region = String(r.region);
      const stateFips = region.slice(3, 5);
      return {
        region,
        state_fips: stateFips,
        county_fips: region.slice(5, 8),
        state: statePostal(stateFips),
        parcels: Number(r.n),
        buildings: buildings.get(region) ?? 0,
        sources: parcelSources.get(region) ?? [],
      };
    });
  const entitySources = coverageSources(
    d,
    "fl:entity:",
    "fl:entity;",
    "substr(c.subject, 11, instr(substr(c.subject, 11), ':') - 1)",
  );
  const registries = d
    .prepare(
      "SELECT substr(urn, 11, instr(substr(urn, 11), ':') - 1) AS j, COUNT(*) AS n FROM subjects " +
        "WHERE kind = 'entity' GROUP BY j ORDER BY j",
    )
    .all()
    .map((r) => ({
      jurisdiction: String(r.j),
      entities: Number(r.n),
      sources: entitySources.get(String(r.j)) ?? [],
    }));
  const systems = d
    .prepare(
      "SELECT system, COUNT(*) AS n FROM crosswalk GROUP BY system ORDER BY system",
    )
    .all()
    .map((r) => ({ system: String(r.system), ids: Number(r.n) }));
  const states = [
    ...new Set(counties.map((c) => c.state ?? `state ${c.state_fips}`)),
  ].sort();
  return {
    counties,
    entity_registries: registries,
    crosswalk_systems: systems,
    totals: {
      parcels: counties.reduce((a, c) => a + c.parcels, 0),
      entities: registries.reduce((a, r) => a + r.entities, 0),
      buildings: [...buildings.values()].reduce((a, n) => a + n, 0),
      counties: counties.length,
      states,
    },
  };
}

function coverage(d: Database): RegistryCoverage {
  const now = coverageStamp(d);
  const key = `${now.snapshots}:${now.subjects_max_rowid}`;
  if (coverageCache?.stamp === key)
    return coverageCache.summary as RegistryCoverage;
  let summary: RegistryCoverage | undefined;
  const row = d.prepare("SELECT value FROM meta WHERE key = 'coverage'").get();
  if (row) {
    try {
      const stored = JSON.parse(String(row.value)) as {
        stamp?: { snapshots?: number; subjects_max_rowid?: number };
        summary?: RegistryCoverage;
      };
      if (
        stored.summary &&
        typeof stored.summary === "object" &&
        stored.stamp?.snapshots === now.snapshots &&
        stored.stamp.subjects_max_rowid === now.subjects_max_rowid
      )
        summary = stored.summary;
    } catch {
      summary = undefined;
    }
  }
  summary ??= computeCoverage(d);
  coverageCache = { stamp: key, summary };
  return summary;
}

/** What the configured registry file holds: counties, entity registries, crosswalk systems, as-of dates. */
export function registryCoverage(): Row {
  const d = open();
  const versions = new Map(
    d
      .prepare(
        "SELECT key, value FROM meta WHERE key IN ('name_key_version', 'address_key_version')",
      )
      .all()
      .map((r) => [String(r.key), String(r.value)]),
  );
  return coverageReport(coverage(d), {
    name_key_version: versions.get("name_key_version") ?? null,
    address_key_version: versions.get("address_key_version") ?? null,
  });
}

/** The `registry_coverage` answer for a coverage summary and the file's key versions (null: not set). */
export function coverageReport(
  cov: RegistryCoverage,
  versions: {
    name_key_version: string | null;
    address_key_version: string | null;
  },
): Row {
  return {
    ...cov,
    counties: cov.counties.map((c) => ({
      ...c,
      name: countyName(`${c.state_fips}${c.county_fips}`) ?? null,
    })),
    name_key_version: versions.name_key_version ?? "1",
    address_key_version: versions.address_key_version ?? "1",
    scope: REGISTRY_SCOPE,
  };
}

// SQLite's default (BINARY) text order: UTF-8 bytes, which is code point order.
function binaryCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const fx =
      x >= 0xd800 && x <= 0xdfff ? x + 0x2000 : x >= 0xe000 ? x - 0x800 : x;
    const fy =
      y >= 0xd800 && y <= 0xdfff ? y + 0x2000 : y >= 0xe000 ? y - 0x800 : y;
    return fx - fy;
  }
  return a.length - b.length;
}

function mergeSources(lists: CoverageSource[][]): CoverageSource[] {
  const latest = new Map<string, string>();
  for (const list of lists)
    for (const s of list) {
      const was = latest.get(s.source_id);
      if (was === undefined || binaryCompare(s.as_of, was) > 0)
        latest.set(s.source_id, s.as_of);
    }
  return [...latest.keys()]
    .sort(binaryCompare)
    .map((source_id) => ({ source_id, as_of: latest.get(source_id)! }));
}

/**
 * The coverage of one file holding everything the given files hold, as `registry_coverage` would compute it on
 * read. The files must hold disjoint subjects and crosswalk IDs, and no region split across files.
 */
export function mergeCoverage(parts: RegistryCoverage[]): RegistryCoverage {
  const counties = new Map<string, CountyCoverage[]>();
  const registries = new Map<string, RegistryCoverage["entity_registries"]>();
  const systems = new Map<string, number>();
  for (const p of parts) {
    for (const c of p.counties)
      counties.set(c.region, [...(counties.get(c.region) ?? []), c]);
    for (const r of p.entity_registries)
      registries.set(r.jurisdiction, [
        ...(registries.get(r.jurisdiction) ?? []),
        r,
      ]);
    for (const s of p.crosswalk_systems)
      systems.set(s.system, (systems.get(s.system) ?? 0) + s.ids);
  }
  const mergedCounties: CountyCoverage[] = [...counties.keys()]
    .sort(binaryCompare)
    .map((region) => {
      const list = counties.get(region)!;
      return {
        ...list[0]!,
        parcels: list.reduce((a, c) => a + c.parcels, 0),
        buildings: list.reduce((a, c) => a + c.buildings, 0),
        sources: mergeSources(list.map((c) => c.sources)),
      };
    });
  const mergedRegistries = [...registries.keys()]
    .sort(binaryCompare)
    .map((jurisdiction) => {
      const list = registries.get(jurisdiction)!;
      return {
        jurisdiction,
        entities: list.reduce((a, r) => a + r.entities, 0),
        sources: mergeSources(list.map((r) => r.sources)),
      };
    });
  const states = [
    ...new Set(mergedCounties.map((c) => c.state ?? `state ${c.state_fips}`)),
  ].sort();
  return {
    counties: mergedCounties,
    entity_registries: mergedRegistries,
    crosswalk_systems: [...systems.keys()]
      .sort(binaryCompare)
      .map((system) => ({ system, ids: systems.get(system)! })),
    totals: {
      parcels: mergedCounties.reduce((a, c) => a + c.parcels, 0),
      entities: mergedRegistries.reduce((a, r) => a + r.entities, 0),
      buildings: parts.reduce((a, p) => a + p.totals.buildings, 0),
      counties: mergedCounties.length,
      states,
    },
  };
}

function countiesSummary(cov: RegistryCoverage): string {
  const counties = cov.counties;
  if (!counties.length) return "no parcels";
  if (counties.length <= LIST_CAP)
    return counties
      .map((c) =>
        countyLabel(c.state_fips, c.county_fips, `, ${c.parcels} parcels`),
      )
      .join("; ");
  const states = cov.totals.states;
  return `${counties.length} counties in ${states.length} states (${states.join(", ")})`;
}

function registriesSummary(cov: RegistryCoverage): string {
  const regs = cov.entity_registries;
  if (!regs.length) return "no entity registries";
  if (regs.length <= LIST_CAP)
    return regs
      .map((r) => `${r.jurisdiction} (${r.entities} entities)`)
      .join(", ");
  return `${regs.length} entity registries (${regs.map((r) => r.jurisdiction).join(", ")})`;
}

function latestAsOf(sources: CoverageSource[]): string {
  return (
    sources.reduce<string | undefined>(
      (a, s) => (a === undefined || s.as_of > a ? s.as_of : a),
      undefined,
    ) ?? "unknown"
  );
}

/** Pure: the `coverage` object of a miss, from a coverage summary. */
export function parcelMiss(
  cov: RegistryCoverage,
  stateFips: string,
  countyFips: string,
): Row {
  const region = `us-${stateFips}${countyFips}`;
  const county = cov.counties.find((c) => c.region === region);
  const label = countyLabel(stateFips, countyFips);
  const message = county
    ? `${label} is loaded in this registry (${county.parcels} parcels, as of ${latestAsOf(county.sources)}), but this parcel is not in it: the registry holds commercial, industrial and multifamily parcels only, so a residential or exempt parcel is not found`
    : `${label} is not loaded in this registry; loaded: ${countiesSummary(cov)}. Call registry_coverage for what this registry holds`;
  return {
    region,
    state: statePostal(stateFips),
    county_loaded: county !== undefined,
    state_loaded: cov.counties.some((c) => c.state_fips === stateFips),
    loaded_states: cov.totals.states,
    message,
  };
}

/** Pure: the `coverage` object of a miss, from a coverage summary. */
export function entityMiss(
  cov: RegistryCoverage,
  jurisdiction: string,
  known: boolean,
): Row {
  const reg = cov.entity_registries.find(
    (r) => r.jurisdiction === jurisdiction,
  );
  const message = known
    ? "this entity is in the registry, but no current owner of record is linked to it"
    : reg
      ? `no entity with this number in entity registry ${jurisdiction} (${reg.entities} entities, as of ${latestAsOf(reg.sources)})`
      : `entity registry ${jurisdiction} is not loaded in this registry; loaded: ${registriesSummary(cov)}. Call registry_coverage for what this registry holds`;
  return {
    jurisdiction,
    loaded: reg !== undefined,
    entity_known: known,
    loaded_jurisdictions: cov.entity_registries.map((r) => r.jurisdiction),
    message,
  };
}

const QUERY_STATE =
  /(?:,\s*([A-Z]{2})(?:\s+[0-9]{5}(?:-[0-9]{4})?)?|\b([A-Z]{2})\s+[0-9]{5}(?:-[0-9]{4})?)\s*$/;

/** The state a search query names at its end (", TX" or "TX 77002"), or null (`query_state` in Python). */
export function queryState(query: string): string | null {
  const m = QUERY_STATE.exec(query.toUpperCase().trim());
  const st = m ? (m[1] ?? m[2]) : undefined;
  return st && STATES.has(st) ? st : null;
}

/** Pure: the `coverage` object of a miss, from a coverage summary. */
export function addressMiss(cov: RegistryCoverage, query: string): Row {
  const st = queryState(query);
  const states = cov.totals.states;
  const loaded = st ? states.includes(st) : null;
  const message =
    st && !loaded
      ? `no parcel matched: ${st} is not loaded in this registry; loaded: ${countiesSummary(cov)}`
      : addressQuery(query).mode === null
        ? `no parcel matched: address search matches whole words of the street address, so give a house number ("1200 Main St") or a street name with its type ("Main St"); a city, state or part of a word alone matches nothing. Loaded: ${countiesSummary(cov)}`
        : `no parcel matched in this registry (loaded: ${countiesSummary(cov)}); it holds commercial, industrial and multifamily parcels only, searched by situs address: try the house number and street name alone`;
  return { state: st, state_loaded: loaded, loaded_states: states, message };
}

/** Pure: the `coverage` object of a miss, from a coverage summary. */
export function entitiesMiss(cov: RegistryCoverage): Row {
  return {
    loaded_jurisdictions: cov.entity_registries.map((r) => r.jurisdiction),
    message: `no registered entity matched; entity registries loaded: ${registriesSummary(cov)}. Natural persons are never searchable`,
  };
}

/** Pure: the `coverage` object of a miss, from a coverage summary. */
export function externalMiss(
  cov: RegistryCoverage,
  system: string,
  externalId: string,
): Row {
  const found = cov.crosswalk_systems.find((s) => s.system === system);
  const names =
    cov.crosswalk_systems.map((s) => `${s.system} (${s.ids} IDs)`).join(", ") ||
    "none";
  const message = found
    ? `no ID "${externalId}" in crosswalk system ${system} (${found.ids} IDs loaded)`
    : `crosswalk system "${system}" is not in this registry; systems: ${names}`;
  return { system, system_loaded: found !== undefined, message };
}

/**
 * The `coverage` object of a `registry_get` miss. Throws FactLotIdError for a malformed URN,
 * so a typo is reported as a format error rather than as a missing record.
 */
export function registryRecordMiss(urn: string): Row {
  parse(urn);
  return recordMiss(coverage(open()), urn);
}

/** Pure `registryRecordMiss` over a coverage summary; throws FactLotIdError for a malformed URN. */
export function recordMiss(cov: RegistryCoverage, urn: string): Row {
  const { kind, parts } = parse(urn);
  const region = parts[0] ?? "";
  if (kind === "parcel")
    return parcelMiss(cov, region.slice(3, 5), region.slice(5, 8));
  if (kind === "entity") return entityMiss(cov, region, false);
  if (kind === "building" && parts.length === 3) {
    const stateFips = region.slice(3, 5);
    const out = parcelMiss(cov, stateFips, region.slice(5, 8));
    const county = cov.counties.find((c) => c.region === region);
    out.message =
      county && !cov.totals.buildings
        ? "no building is rolled up at this address: this registry file holds no building roll-up (a file built before 2026-11-03 has none until `python -m factlot.registry.maintain <file> --buildings` adds it)"
        : county
          ? `no building is rolled up at this address: ${countyLabel(stateFips, region.slice(5, 8))} is loaded in this registry (${county.parcels} parcels, as of ${latestAsOf(county.sources)}), and the registry records a building only where two or more of its parcels share a street address and ZIP code; search the address with registry_search_address to find a single parcel`
          : `no building is rolled up at this address: ${String(out.message)}`;
    return out;
  }
  return {
    message: `the registry holds parcels, entities and buildings; it has no ${kind} records`,
  };
}

/** `registry_resolve_parcel`: the URN, or null with the coverage of the county asked about. */
export function registryResolveParcelResult(
  stateFips: string,
  countyFips: string,
  apn: string,
): Row {
  const urn = registryResolveParcel(stateFips, countyFips, apn);
  return urn
    ? { urn }
    : {
        urn: null,
        coverage: parcelMiss(coverage(open()), stateFips, countyFips),
      };
}

/** `registry_resolve_external`: the URN, or null with the crosswalk systems this file holds. */
export function registryResolveExternalResult(
  system: string,
  externalId: string,
): Row {
  const urn = registryResolveExternal(system, externalId);
  return urn
    ? { urn }
    : {
        urn: null,
        coverage: externalMiss(coverage(open()), system, externalId),
      };
}

/** `registry_search_address`: matches, or none with what the file holds. */
export function registrySearchAddressResult(query: string, limit: number): Row {
  const results = registrySearchAddress(query, limit);
  return results.length
    ? { results }
    : { results, coverage: addressMiss(coverage(open()), query) };
}

/** `registry_search_entities`: matches, or none with the entity registries the file holds. */
export function registrySearchEntitiesResult(
  query: string,
  limit: number,
): Row {
  const results = registrySearchEntities(query, limit);
  return results.length
    ? { results }
    : { results, coverage: entitiesMiss(coverage(open())) };
}

/** `registry_owned_by`: parcels with their buildings, a per-building summary, and coverage when empty. */
export function registryOwnedByResult(entityUrn: string): Row {
  const d = open();
  const { kind, parts } = parse(entityUrn);
  if (kind !== "entity")
    throw new FactLotIdError(
      `"${entityUrn}" is a ${kind} URN; registry_owned_by needs an entity URN`,
    );
  const results = registryOwnedBy(entityUrn);
  const out: Row = { results, buildings: ownedBuildings(d, results) };
  if (!results.length) {
    const known = d
      .prepare("SELECT 1 AS x FROM subjects WHERE urn = ?")
      .get(entityUrn);
    out.coverage = entityMiss(coverage(d), parts[0] ?? "", known !== undefined);
  }
  return out;
}

// --- buildings (factlot.registry.buildings) ----------------------------------------------------

export const BUILDING_RULE_BASIS: Record<string, string> = {
  dc_condo_lot:
    "District of Columbia SSL lot numbered 2000-6999, which the District's lot numbering assigns to condominium units (DCGIS property records: lots 2000-6999 are condo lots)",
  nyc_condo_unit_lot:
    "New York City BBL lot numbered 1001-6999, which Department of Finance lot numbering assigns to condominium units (NYC Planning PLUTO data dictionary)",
  nyc_condo_billing_lot:
    "New York City BBL lot numbered 7501-7599, a condominium billing lot under Department of Finance lot numbering (NYC Planning PLUTO data dictionary)",
  same_street_address:
    "same street line and ZIP code in its situs address as the building's other parcels",
};
const BUILDING_GROUPING =
  "Parcels in one county whose current situs addresses share a street line and ZIP code (unit, suite, '#' and floor designators removed). Each member's rule says what else marks it: a condominium lot in the source's own lot numbering, or the shared address alone. A situs whose ZIP code the publisher cut short joins the one building at its street line whose ZIP code begins with the digits left (zip_found other_parcels). Inferred, not a published building record: two buildings at one address are one building here.";

function hasBuildings(d: Database): boolean {
  return (
    d
      .prepare(
        "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'building_members'",
      )
      .get() !== undefined
  );
}

function buildingOf(d: Database, parcelUrn: string): Row | null {
  if (!hasBuildings(d)) return null;
  const row = d
    .prepare(
      "SELECT m.building_urn, m.rule, s.short, s.label FROM building_members m " +
        "JOIN subjects s ON s.urn = m.building_urn WHERE m.parcel_urn = ? ORDER BY m.building_urn LIMIT 1",
    )
    .get(parcelUrn);
  if (!row) return null;
  const counts = d
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(is_unit), 0) AS u FROM building_members WHERE building_urn = ?",
    )
    .get(row.building_urn);
  const rule = String(row.rule);
  return {
    urn: row.building_urn,
    short: row.short,
    label: row.label,
    parcel_count: Number(counts?.n),
    unit_count: Number(counts?.u),
    rule,
    basis: BUILDING_RULE_BASIS[rule],
  };
}

function buildingDetail(d: Database, buildingUrn: string): Row {
  const members = hasBuildings(d)
    ? d
        .prepare(
          "SELECT m.parcel_urn, s.label, m.rule, m.is_unit, m.street_found, m.zip_found FROM building_members m " +
            "JOIN subjects s ON s.urn = m.parcel_urn WHERE m.building_urn = ? ORDER BY m.parcel_urn",
        )
        .all(buildingUrn)
        .map((r) => ({
          urn: r.parcel_urn,
          label: r.label,
          rule: String(r.rule),
          is_unit: Number(r.is_unit) === 1,
          street_found: r.street_found,
          zip_found: r.zip_found,
        }))
    : [];
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.rule, (counts.get(m.rule) ?? 0) + 1);
  const rules = [...counts.keys()].sort();
  return {
    parcel_count: members.length,
    unit_count: members.filter((m) => m.is_unit).length,
    rules: Object.fromEntries(rules.map((r) => [r, counts.get(r)])),
    basis: Object.fromEntries(rules.map((r) => [r, BUILDING_RULE_BASIS[r]])),
    grouping: BUILDING_GROUPING,
    members,
  };
}

function ownedBuildings(d: Database, parcels: Row[]): Row[] {
  const out = new Map<string, Row & { owned_parcels: number }>();
  for (const p of parcels) {
    const b = buildingOf(d, String(p.urn));
    p.building = b ? b.urn : null;
    if (!b) continue;
    const key = String(b.urn);
    const entry = out.get(key) ?? {
      urn: b.urn,
      label: b.label,
      owned_parcels: 0,
      parcel_count: b.parcel_count,
      unit_count: b.unit_count,
    };
    entry.owned_parcels += 1;
    out.set(key, entry);
  }
  return [...out.values()].sort(
    (a, b) =>
      b.owned_parcels - a.owned_parcels ||
      (String(a.urn) < String(b.urn)
        ? -1
        : String(a.urn) > String(b.urn)
          ? 1
          : 0),
  );
}

// --- Texas unequal-appraisal candidates (factlot.registry.tx_equity) ---------------------------

export const TEXAS_FIPS = "48";
export const TX_EQUITY_DEFAULTS = {
  area_band: 0.35,
  year_band: 15,
  min_matches: 10,
  limit: 50,
} as const;
export const TX_EQUITY_WHICH_PARCEL =
  "give urn, or county_fips and apn (with state_fips 48, or none)";

/**
 * Counties the candidate tool serves no parcel of, with the reason (`WITHHELD_COUNTIES` in Python). Tarrant
 * Appraisal District (48439): its robots.txt signals "search=yes,ai-train=no,use=reference"; use=reference is
 * undefined and ai-input is not stated.
 */
export const TX_EQUITY_WITHHELD_COUNTIES: Record<string, string> = {
  "439":
    "Tarrant Appraisal District's published signals do not say whether serving its data to AI agents is allowed; FactLot does not serve Tarrant comparables until that is clarified",
};

/**
 * Counties a hosted FactLot service serves from no tool (`HOSTED_WITHHELD_COUNTIES` /
 * `hosted_withheld_counties()` in Python), keyed by 5-digit county FIPS, with the reason. Owner decision of
 * 2026-11-07: Tarrant (48439) is withheld from every hosted tool, not only the candidate tool. Self-hosted
 * SDKs are unaffected; the hosted pack builder imports this as its one source of truth. Returns a fresh copy.
 */
export function hostedWithheldCounties(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(TX_EQUITY_WITHHELD_COUNTIES).map(([county, reason]) => [
      `${TEXAS_FIPS}${county}`,
      reason,
    ]),
  );
}

/** Why the candidate tool serves no parcel of this county, or undefined (own keys only, as a Python dict). */
export function txEquityWithheld(countyFips: string): string | undefined {
  return Object.hasOwn(TX_EQUITY_WITHHELD_COUNTIES, countyFips)
    ? TX_EQUITY_WITHHELD_COUNTIES[countyFips]
    : undefined;
}

/**
 * The tax year the district's first per-year roll sources were loaded for (`ROLL_BASE_TAX_YEAR` in Python): that
 * year keeps the plain source id, every other year is `<source_id>-<year>`.
 */
export const ROLL_BASE_TAX_YEAR = 2026;
const YEAR_SUFFIX = /-([0-9]{4})$/;

/** The tax year a roll or companion source holds by its id (`source_tax_year` in Python). */
export function sourceTaxYear(sourceId: string): number {
  const m = YEAR_SUFFIX.exec(sourceId);
  return m ? Number(m[1]) : ROLL_BASE_TAX_YEAR;
}

/** The error for a parcel outside Texas (`texas_only` in Python). */
export function texasOnly(stateFips: string): string {
  return `registry_tx_equity_candidates is Texas-only (state FIPS 48): this parcel is in state FIPS ${stateFips}. Texas unequal-appraisal protests compare parcels on one Texas appraisal district's roll`;
}

/** The only predicates the candidate tool reads (never ownership.*), `PARCEL_PREDICATES` in Python. */
export const TX_EQUITY_PREDICATES = [
  "parcel.tax_year",
  "parcel.apn",
  "parcel.state_property_category",
  "parcel.market_value",
  "parcel.appraised_value",
  "parcel.improvement_area_sf",
  "parcel.land_area_sf",
  "parcel.year_built",
  "parcel.neighborhood_code",
  "parcel.building_class",
  "parcel.local_use_code",
  "parcel.situs_address",
] as const;
const EQUITY_IN = TX_EQUITY_PREDICATES.map((p) => `'${p}'`).join(", ");
const EQUITY_ORDER =
  " ORDER BY f.subject, f.predicate, f.as_of DESC, f.fact_id";
// Current facts of one parcel with the source of each, and the same for every parcel in a county whose category
// fact in one of the given roll sources has a given value (the caller fills in the source lists).
const EQUITY_SUBJECT_SQL =
  "SELECT f.*, s.source_id AS source_id FROM current_facts f JOIN snapshots s ON s.document_id = f.document_id " +
  `WHERE f.subject = ? AND f.predicate IN (${EQUITY_IN})` +
  EQUITY_ORDER;
const equityPoolSql = (rolls: number, sources: number): string =>
  "SELECT f.*, s.source_id AS source_id FROM current_facts f JOIN snapshots s ON s.document_id = f.document_id " +
  "WHERE f.subject IN (SELECT c.subject FROM current_facts c JOIN snapshots cs ON cs.document_id = c.document_id " +
  "WHERE c.subject >= ? AND c.subject < ? AND c.predicate = 'parcel.state_property_category' AND c.value_json = ? " +
  `AND cs.source_id IN (${Array(rolls).fill("?").join(", ")})) AND f.predicate IN (${EQUITY_IN}) ` +
  `AND s.source_id IN (${Array(sources).fill("?").join(", ")})` +
  EQUITY_ORDER;
const EQUITY_COUNTY_SOURCES_SQL =
  "SELECT source_id FROM sources WHERE state_fips = ? AND county_fips = ? ORDER BY source_id";
const EQUITY_SOURCE_SQL =
  "SELECT s.document_id, s.source_id, s.as_of, s.retrieved_at, s.filename, src.publisher, src.title, src.url, " +
  "src.license, src.ai_use, src.redistribution, src.attribution FROM snapshots s JOIN sources src USING (source_id) " +
  "WHERE s.document_id = ?";
const ZIP_AFTER_COMMA = /(?:^|[^0-9A-Z_])([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$/;
const STATE_ZIP_TAIL = /\s[A-Z]{2}\s+([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$/;
const TIERS = ["neighborhood", "zip", "county"] as const;

export const TX_EQUITY_RULE =
  "FactLot's default candidate rule (a design choice, not a legal standard): the subject's roll year is the newest tax year whose roll gives it a positive market or appraised value (or tax_year when given), and every field of the subject and the candidates is read from that year's roll (building class also from the district's buildings file for that year). Candidates are parcels on the same district's roll for that year with exactly the same state property category code, an improvement area within area_band (a share) of the subject's, a year built within year_band years of the subject's when both are known, and an appraised or market value. Tiers: parcels sharing the subject's neighborhood code (when it has one), then parcels in its 5-digit ZIP code, then the rest of the county only when the first two tiers hold fewer than min_matches. Ordered by tier, then nearest improvement area, then URN; at most limit returned.";
export const TX_EQUITY_NOTICE =
  "Candidates only: a person decides which, if any, to use as comparables. The selection rule is FactLot's default, not a legal standard of comparability. For evidence calculations only: FactLot does not represent property owners, file protests, or advise whether to protest or what value to claim. Owner names and mailing addresses are never returned. Not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)); not legal or tax advice and not a substitute for the advice of an attorney. FactLot is software, not a property tax consultant under Texas Occupations Code chapter 1152; it does not prepare, file or advise on protests.";

export const TX_EQUITY_CALC_ARGS_NOTICE =
  "calc_args is the candidate list under FactLot's default rule (selection_rule) in calc_tx_unequal_appraisal's input shape, not a selection of comparables by FactLot: the caller reviews it, may remove, add or edit comparables, and adds any adjustments, each with a reason, before calling calc_tx_unequal_appraisal (which needs at least 3 comparables). The order of operations is registry_tx_equity_candidates, review, calc_tx_unequal_appraisal with the reviewed calc_args, then report_create.";

/** Longest `label` calc_tx_unequal_appraisal accepts. */
const CALC_LABEL_MAX = 80;

/** The citation keys calc_tx_unequal_appraisal accepts, in its order. */
const CALC_CITATION_KEYS = ["fact_id", "document_id", "locator", "as_of"];

/**
 * A subject or candidate row as a calc_tx_unequal_appraisal subject or comparable (`_calc_party` in Python): only the
 * calculator's fields, nulls left out (the calculator rejects them), `id` the FactLot URN and `label` the situs
 * address (cut to 80 characters with "…" when longer); the citation of the value for a comparable only (the
 * calculator's subject has no citation field).
 */
function calcParty(row: Row, withCitation: boolean): Row {
  const out: Row = { id: row.id };
  const situs = nonEmptyString(row.situs_address);
  if (situs !== null)
    out.label =
      situs.length > CALC_LABEL_MAX
        ? `${situs.slice(0, CALC_LABEL_MAX - 1)}…`
        : situs;
  for (const k of [
    "county_fips",
    "value",
    "value_basis",
    "improvement_area_sf",
    "land_area_sf",
  ])
    if (row[k] !== null && row[k] !== undefined && row[k] !== "")
      out[k] = row[k];
  const cite = row.citation as Row | null | undefined;
  if (withCitation && cite) {
    const c: Row = {};
    for (const k of CALC_CITATION_KEYS)
      if (cite[k] !== null && cite[k] !== undefined && cite[k] !== "")
        c[k] = cite[k];
    out.citation = c;
  }
  return out;
}

/**
 * `calc_args` and `selection_rule` of a `registry_tx_equity_candidates` answer, from the answer's own `subject`,
 * `candidates` and `selection` (`equity_calc_args` in Python), so the hosted API can add them to an answer that
 * lacks them. `calc_args` is null when the subject has no value or no roll year.
 */
export function txEquityCalcArgs(answer: Row): {
  calc_args: Row | null;
  selection_rule: Row;
} {
  const subject = answer.subject as Row;
  const candidates = (answer.candidates as Row[]) ?? [];
  const selection = answer.selection as Row;
  const criteria = selection.criteria as Row;
  const parameters = selection.parameters as Row;
  const area = criteria.improvement_area_sf as Row | null;
  const year = criteria.year_built as Row | null;
  const taxYear = (selection.tax_year ?? subject.tax_year) as number | null;
  const calcArgs =
    subject.value === null || taxYear === null
      ? null
      : {
          tax_year: taxYear,
          subject: calcParty(subject, false),
          comparables: candidates.map((c) => calcParty(c, true)),
        };
  return {
    calc_args: calcArgs,
    selection_rule: {
      tax_year: selection.tax_year,
      state_property_category: criteria.state_property_category,
      area_band: {
        share: parameters.area_band,
        min_sf: area === null ? null : area.min,
        max_sf: area === null ? null : area.max,
      },
      year_band: {
        years: parameters.year_band,
        min: year === null ? null : year.min,
        max: year === null ? null : year.max,
      },
      min_matches: parameters.min_matches,
      limit: parameters.limit,
      subject_summary: selection.subject_summary ?? null,
      narrowing: (selection.narrowing as Row[] | undefined) ?? [],
      steps: (selection.steps as Row[] | undefined) ?? [],
      tiers: (selection.tiers as Row[]).map((t) => ({
        tier: t.tier,
        key: t.key,
        applied: t.applied,
        matched: t.matched,
        returned: t.returned,
      })),
      widened_to_county: selection.widened_to_county,
      matched: selection.matched,
      returned: selection.returned,
      notice: TX_EQUITY_CALC_ARGS_NOTICE,
    },
  };
}

/**
 * An answer with `calc_args` and `selection_rule` added at the end when it lacks them (an answer from a registry
 * service built before they existed); an answer that has them is returned as is.
 */
export function withTxEquityCalcArgs(answer: Row): Row {
  if ("calc_args" in answer || typeof answer.selection !== "object")
    return answer;
  return { ...answer, ...txEquityCalcArgs(answer) };
}

/** The 5-digit ZIP code of a situs address (`situs_zip5` in Python): after the first comma, or after a state. */
export function situsZip5(situs: unknown): string | null {
  if (typeof situs !== "string") return null;
  const s = situs.toUpperCase().trim();
  const comma = s.indexOf(",");
  const m =
    comma >= 0
      ? ZIP_AFTER_COMMA.exec(s.slice(comma + 1))
      : STATE_ZIP_TAIL.exec(s);
  return m ? m[1]! : null;
}

/** Fact rows grouped by subject, each subject's rows in their query order. */
export function equityRowsBySubject(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const subject = String(r.subject);
    const list = out.get(subject) ?? [];
    list.push(r);
    out.set(subject, list);
  }
  return out;
}

/**
 * source → [tax year, has a positive value] for each source whose current facts give the parcel a tax year. `rows`
 * are one parcel's current facts of `TX_EQUITY_PREDICATES` with their `source_id`, in `f.predicate, f.as_of DESC,
 * f.fact_id` order.
 */
export function equityRollYears(rows: Row[]): Map<string, [number, boolean]> {
  const first = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    const src = String(r.source_id);
    const facts = first.get(src) ?? new Map<string, Row>();
    if (!facts.has(String(r.predicate))) facts.set(String(r.predicate), r);
    first.set(src, facts);
  }
  const out = new Map<string, [number, boolean]>();
  for (const [src, facts] of first) {
    const year = finite(rowValue(facts.get("parcel.tax_year")));
    if (year === null) continue;
    const valued = ["parcel.market_value", "parcel.appraised_value"].some(
      (p) => (finite(rowValue(facts.get(p))) ?? 0) > 0,
    );
    out.set(src, [year, valued]);
  }
  return out;
}

/** The roll year the rule compares in, the subject's roll years (newest first), and a warning for a missing year. */
export function equityYearUsed(
  years: Map<string, [number, boolean]>,
  taxYear: number | null,
): { yearUsed: number | null; available: number[]; warnings: string[] } {
  const available = [...new Set([...years.values()].map(([y]) => y))].sort(
    (a, b) => b - a,
  );
  const valued = [...years.values()].filter(([, v]) => v).map(([y]) => y);
  const warnings: string[] = [];
  let yearUsed: number | null;
  if (taxYear !== null) {
    yearUsed = available.includes(taxYear) ? taxYear : null;
    if (yearUsed === null)
      warnings.push(
        `the subject is on no current roll for tax year ${taxYear}; its roll years: ${available.map((y) => String(Math.trunc(y))).join(", ") || "none"}`,
      );
  } else {
    yearUsed = valued.length
      ? Math.max(...valued)
      : available.length
        ? available[0]!
        : null;
  }
  return { yearUsed, available, warnings };
}

/** The subject's roll sources for a year (sorted). */
export function equityRolls(
  years: Map<string, [number, boolean]>,
  yearUsed: number | null,
): string[] {
  return [...years.entries()]
    .filter(([, [y]]) => y === yearUsed)
    .map(([src]) => src)
    .sort();
}

/** The county's companion sources (building files) of the same tax year as the rolls, in `countySources` order. */
export function equityCompanions(
  countySources: string[],
  rolls: string[],
  yearUsed: number | null,
): string[] {
  return countySources.filter(
    (c) =>
      !rolls.includes(c) &&
      yearUsed !== null &&
      sourceTaxYear(c) === yearUsed &&
      rolls.some((r) => c.startsWith(r.replace(YEAR_SUFFIX, "") + "-")),
  );
}

/** predicate → newest fact from the year's roll sources; building class from a companion when the roll has none. */
export function equityYearFacts(
  rows: Row[],
  rolls: string[],
  companions: string[],
): Map<string, Row> {
  const facts = new Map<string, Row>();
  for (const r of rows)
    if (rolls.includes(String(r.source_id)) && !facts.has(String(r.predicate)))
      facts.set(String(r.predicate), r);
  if (!facts.has("parcel.building_class"))
    for (const r of rows)
      if (
        companions.includes(String(r.source_id)) &&
        r.predicate === "parcel.building_class" &&
        !facts.has("parcel.building_class")
      )
        facts.set("parcel.building_class", r);
  return facts;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function positive(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * A subject or candidate row in the answer's key order (`_shape` in Python), with `value_per_sf` computed: the
 * roll's value (appraised where the roll gives one, else market, as `value_basis` says) divided by the roll's
 * improvement area, rounded to the cent; null without both. Fields a row lacks (a row from a registry pack built
 * before `apn` and `local_use_code` were kept) are null.
 */
export function equityShape(r: Row): Row {
  const value = finite(r.value);
  const area = positive(r.improvement_area_sf);
  const orNull = (v: unknown) => (v === undefined ? null : v);
  return {
    id: r.id,
    county_fips: r.county_fips,
    apn: orNull(r.apn),
    value: orNull(r.value),
    value_basis: orNull(r.value_basis),
    value_per_sf:
      value !== null && area !== null ? round(value / area, 2) : null,
    market_value: orNull(r.market_value),
    appraised_value: orNull(r.appraised_value),
    improvement_area_sf: orNull(r.improvement_area_sf),
    land_area_sf: orNull(r.land_area_sf),
    year_built: orNull(r.year_built),
    state_property_category: orNull(r.state_property_category),
    local_use_code: orNull(r.local_use_code),
    neighborhood_code: orNull(r.neighborhood_code),
    building_class: orNull(r.building_class),
    situs_address: orNull(r.situs_address),
    tax_year: orNull(r.tax_year),
    citation: orNull(r.citation),
  };
}

/** A parcel shaped as a `calc_tx_unequal_appraisal` subject or comparable; missing facts are null. */
export function equityComparable(urn: string, facts: Map<string, Row>): Row {
  const val = (p: string) => rowValue(facts.get(p));
  const market = finite(val("parcel.market_value"));
  const appraised = finite(val("parcel.appraised_value"));
  const basis =
    appraised !== null ? "appraised" : market !== null ? "market" : null;
  const cited = basis
    ? facts.get(
        basis === "appraised"
          ? "parcel.appraised_value"
          : "parcel.market_value",
      )
    : undefined;
  return equityShape({
    id: urn,
    county_fips: (urn.split(":")[2] ?? "").slice(5, 8),
    apn: nonEmptyString(val("parcel.apn")),
    value: basis === "appraised" ? appraised : market,
    value_basis: basis,
    market_value: market,
    appraised_value: appraised,
    improvement_area_sf: finite(val("parcel.improvement_area_sf")),
    land_area_sf: finite(val("parcel.land_area_sf")),
    year_built: finite(val("parcel.year_built")),
    state_property_category: nonEmptyString(
      val("parcel.state_property_category"),
    ),
    local_use_code: nonEmptyString(val("parcel.local_use_code")),
    neighborhood_code: nonEmptyString(val("parcel.neighborhood_code")),
    building_class: nonEmptyString(val("parcel.building_class")),
    situs_address: nonEmptyString(val("parcel.situs_address")),
    tax_year: finite(val("parcel.tax_year")),
    citation: cited ? factCitation(cited) : null,
  });
}

/** The snapshots the facts come from (document IDs, sorted, once each). */
export function equityFactDocs(facts: Map<string, Row>): string[] {
  return [
    ...new Set([...facts.values()].map((f) => String(f.document_id))),
  ].sort();
}

/** The cited snapshots with their source's rights, as `registry_get` gives each fact's `rights`. */
function equitySources(d: Database, documentIds: Set<string>): Row[] {
  const out: Row[] = [];
  for (const doc of [...documentIds].sort()) {
    const row = d.prepare(EQUITY_SOURCE_SQL).get(doc);
    if (!row) continue;
    out.push(equitySource(doc, row));
  }
  return out;
}

/** One `sources` entry from a row of `EQUITY_SOURCE_SQL`. */
export function equitySource(doc: string, row: Row): Row {
  // Every right is stated, attribution included (null when the source asks for none), so an agent can relay them.
  const r: Row = {
    ai_use: row.ai_use,
    redistribution: row.redistribution,
    license: row.license,
    attribution: row.attribution || null,
  };
  return {
    document_id: doc,
    source_id: row.source_id,
    title: `${row.publisher}: ${row.title} (${row.filename})`,
    uri: row.url,
    retrieved_at: row.retrieved_at,
    as_of: row.as_of,
    rights: r,
  };
}

export interface TxEquityParams {
  area_band: number;
  year_band: number;
  min_matches: number;
  limit: number;
  tax_year?: number;
  /** Only candidates with exactly the subject's building class (when the subject has one). */
  same_building_class?: boolean;
  /** Only candidates with exactly the subject's local use code (when the subject has one). */
  same_local_use_code?: boolean;
  /** Only candidates whose local use code is one of these (exact match). */
  local_use_codes?: string[];
}

/** The most candidates one answer returns: the input schema's bound on `limit` (`LIMIT_MAX` in Python). */
export const TX_EQUITY_LIMIT_MAX = 200;
/** Most codes in `local_use_codes` (`USE_CODES_MAX` in Python). */
export const TX_EQUITY_USE_CODES_MAX = 50;

/** The parcel URN a `registry_tx_equity_candidates` call names: its `urn`, or the URN of its APN under the file's rule. */
export function txEquitySubjectUrn(
  stateFips: string,
  countyFips: string,
  apn: string,
): string {
  return parcelUrn(open(), stateFips, countyFips, apn);
}

/** A comparable the rule may select, with the snapshots its facts come from. */
export interface EquityCandidate {
  urn: string;
  row: Row;
  docs: string[];
}

/** A selected comparable: its tier (0 neighborhood, 1 ZIP code, 2 county) and distance in improvement area. */
export interface EquityMatch extends EquityCandidate {
  tier: number;
  distance: number;
}

/** The rule's tests for one subject and parameters (`null` when the subject lacks a fact the rule needs). */
export interface EquityRule {
  urn: string;
  category: unknown;
  taxYear: unknown;
  area: number;
  lo: number;
  hi: number;
  year: number | null;
  yearBand: number;
  neighborhood: string | null;
  zip: string | null;
  /** The building class a candidate must have (same_building_class, applied when the subject has one), or null. */
  buildingClass: string | null;
  /** The local use codes a candidate's must be one of (local_use_codes, or the subject's for same_local_use_code), or null. */
  useCodes: string[] | null;
}

/** The facts the rule needs that the subject lacks (an improvement area must be positive). */
export function equityMissing(subject: Row): string[] {
  return (
    [
      ["parcel.tax_year", subject.tax_year],
      ["parcel.state_property_category", subject.state_property_category],
      ["parcel.improvement_area_sf", positive(subject.improvement_area_sf)],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v === null)
    .map(([p]) => p);
}

export function equityRule(
  urn: string,
  subject: Row,
  params: TxEquityParams,
): EquityRule | null {
  if (equityMissing(subject).length) return null;
  const area = positive(subject.improvement_area_sf) as number;
  const cls = subject.building_class as string | null;
  const code = subject.local_use_code as string | null;
  return {
    urn,
    category: subject.state_property_category,
    taxYear: subject.tax_year,
    area,
    lo: area * (1 - params.area_band),
    hi: area * (1 + params.area_band),
    year: subject.year_built as number | null,
    yearBand: params.year_band,
    neighborhood: subject.neighborhood_code as string | null,
    zip: situsZip5(subject.situs_address),
    buildingClass: params.same_building_class ? cls : null,
    useCodes: params.local_use_codes?.length
      ? [...params.local_use_codes]
      : params.same_local_use_code && code !== null
        ? [code]
        : null,
  };
}

/** Whether a row passes the caller's narrowing (building class, local use codes); the rule's other tests aside. */
function equityNarrowed(rule: EquityRule, c: Row): boolean {
  if (rule.buildingClass !== null && c.building_class !== rule.buildingClass)
    return false;
  return (
    rule.useCodes === null ||
    (typeof c.local_use_code === "string" &&
      rule.useCodes.includes(c.local_use_code))
  );
}

/** Whether a comparable (not the subject itself) meets the rule's category, year, area, value and year-built tests. */
export function equityAccepts(rule: EquityRule, c: Row): boolean {
  const cArea = positive(c.improvement_area_sf);
  if (
    c.state_property_category !== rule.category ||
    c.tax_year !== rule.taxYear ||
    cArea === null ||
    !(rule.lo <= cArea && cArea <= rule.hi) ||
    c.value === null
  )
    return false;
  if (
    rule.year !== null &&
    c.year_built !== null &&
    Math.abs((c.year_built as number) - rule.year) > rule.yearBand
  )
    return false;
  return equityNarrowed(rule, c);
}

/**
 * How many comparables of `pool` (the subject itself never) each step of the rule leaves, county-wide, before the
 * tiers and `limit` (`_funnel` in Python): the same roll year and category code with a positive improvement area
 * and a value; then the area band; then the year-built band; then, when applied, the building class and the local
 * use codes.
 */
export function equityFunnel(
  rule: EquityRule,
  pool: Iterable<EquityCandidate>,
): number[] {
  const out = [0, 0, 0];
  if (rule.buildingClass !== null) out.push(0);
  if (rule.useCodes !== null) out.push(0);
  for (const { urn, row: c } of pool) {
    const cArea = positive(c.improvement_area_sf);
    if (
      urn === rule.urn ||
      c.state_property_category !== rule.category ||
      c.tax_year !== rule.taxYear ||
      cArea === null ||
      c.value === null
    )
      continue;
    out[0]! += 1;
    if (!(rule.lo <= cArea && cArea <= rule.hi)) continue;
    out[1]! += 1;
    if (
      rule.year !== null &&
      c.year_built !== null &&
      Math.abs((c.year_built as number) - rule.year) > rule.yearBand
    )
      continue;
    out[2]! += 1;
    let k = 3;
    if (rule.buildingClass !== null) {
      if (c.building_class !== rule.buildingClass) continue;
      out[k++]! += 1;
    }
    if (rule.useCodes !== null) {
      if (
        typeof c.local_use_code !== "string" ||
        !rule.useCodes.includes(c.local_use_code)
      )
        continue;
      out[k]! += 1;
    }
  }
  return out;
}

/** The tier of an accepted comparable: 0 the subject's neighborhood, 1 its ZIP code, 2 the rest of the county. */
export function equityTier(rule: EquityRule, c: Row): number {
  return rule.neighborhood !== null && c.neighborhood_code === rule.neighborhood
    ? 0
    : rule.zip !== null && situsZip5(c.situs_address) === rule.zip
      ? 1
      : 2;
}

/** Tier, then nearest improvement area, then URN. */
export function equityCompare(a: EquityMatch, b: EquityMatch): number {
  return (
    a.tier - b.tier ||
    a.distance - b.distance ||
    (a.urn < b.urn ? -1 : a.urn > b.urn ? 1 : 0)
  );
}

/** One comparable as a match, or null when the rule rejects it (the subject itself included). */
export function equityMatch(
  rule: EquityRule,
  cand: EquityCandidate,
): EquityMatch | null {
  if (cand.urn === rule.urn || !equityAccepts(rule, cand.row)) return null;
  return {
    ...cand,
    tier: equityTier(rule, cand.row),
    distance: Math.abs(
      (positive(cand.row.improvement_area_sf) as number) - rule.area,
    ),
  };
}

/**
 * The candidate selection, pure: every comparable of `pool` the rule accepts for `subject`, in tier, distance and
 * URN order. The SDK passes the whole county pool; the hosted registry passes the rows its indexes give.
 */
export function selectEquityCandidates(
  urn: string,
  subject: Row,
  pool: Iterable<EquityCandidate>,
  params: TxEquityParams,
): EquityMatch[] {
  const rule = equityRule(urn, subject, params);
  if (!rule) return [];
  const matched: EquityMatch[] = [];
  for (const cand of pool) {
    const m = equityMatch(rule, cand);
    if (m) matched.push(m);
  }
  return matched.sort(equityCompare);
}

/** Whether the rule widens to the county tier, from the per-tier match counts. */
export function equityWidened(counts: number[], minMatches: number): boolean {
  return counts[0]! + counts[1]! < minMatches;
}

/** What a `registry_tx_equity_candidates` answer is made from, however the matches were found. */
export interface TxEquityParts {
  /** The shaped subject, with its value history. */
  subject: Row;
  subjectDocs: string[];
  params: TxEquityParams;
  yearUsed: number | null;
  available: number[];
  rolls: string[];
  companions: string[];
  /** Warnings before the selection (a tax year the subject is on no roll for). */
  warnings: string[];
  /** Matches per tier (0 when the subject lacks a fact the rule needs). */
  counts: number[];
  /** equityFunnel's counts (empty when the subject lacks a fact the rule needs). */
  funnel: number[];
  /** The first `limit` matches the rule includes, in `equityCompare` order. */
  returned: EquityMatch[];
}

/** The steps of equityFunnel, in its order (`STEPS` in Python). */
export const TX_EQUITY_STEPS = {
  base: "on the district's roll for the tax year, with exactly the subject's state property category code, a positive improvement area and an appraised or market value",
  area: "improvement area within area_band of the subject's",
  year: "year built within year_band years of the subject's, when both are known",
  same_building_class:
    "building class exactly the subject's (same_building_class)",
  same_local_use_code:
    "local use code exactly the subject's (same_local_use_code)",
  local_use_codes: "local use code one of local_use_codes",
} as const;

/** A number written into an answer's text, as fmtNum writes it (`fmt_num` in Python). */
const numText = (x: unknown): string =>
  typeof x === "number" ? fmtNum(x) : "not on the roll";
const codeText = (x: unknown): string =>
  typeof x === "string" ? x : "not on the roll";

/**
 * The caller's narrowing parameters as the answer states them (`_narrowing` in Python): one entry per parameter
 * asked for, whether it was applied, the value it compared, and in words what it did. A parameter that needs a
 * subject field the subject lacks is not applied; local_use_codes takes the place of same_local_use_code.
 */
export function equityNarrowing(
  subject: Row,
  params: TxEquityParams,
  yearUsed: number | null,
  missing: boolean,
): Row[] {
  const roll = yearUsed === null ? "any roll" : `the ${fmtNum(yearUsed)} roll`;
  const out: Row[] = [];
  const entry = (parameter: string, value: unknown, text: string): Row => ({
    parameter,
    applied: value !== null && !missing,
    value,
    text: missing
      ? `not applied: the subject lacks a fact the rule needs, so no candidates are selected`
      : text,
  });
  if (params.same_building_class) {
    const cls = subject.building_class as string | null;
    out.push(
      entry(
        "same_building_class",
        cls,
        cls === null
          ? `not applied: the subject has no building class on ${roll}`
          : `only parcels whose building class is exactly the subject's (${cls})`,
      ),
    );
  }
  const codes = params.local_use_codes ?? [];
  if (params.same_local_use_code) {
    const code = subject.local_use_code as string | null;
    out.push(
      entry(
        "same_local_use_code",
        codes.length ? null : code,
        codes.length
          ? "not applied: local_use_codes was given and is used instead"
          : code === null
            ? `not applied: the subject has no local use code on ${roll}`
            : `only parcels whose local use code is exactly the subject's (${code})`,
      ),
    );
  }
  if (codes.length)
    out.push(
      entry(
        "local_use_codes",
        [...codes],
        `only parcels whose local use code is one of: ${codes.join(", ")}`,
      ),
    );
  return out;
}

/** The `registry_tx_equity_candidates` result from its parts; `sources` gives each cited snapshot's entry. */
export function assembleTxEquity(
  p: TxEquityParts,
  sources: (documentIds: Set<string>) => Row[],
): Row {
  const { subject, params, counts, returned, yearUsed } = p;
  const { area_band, year_band, min_matches, limit } = params;
  const taxYear = params.tax_year ?? null;
  const warnings = [...p.warnings];
  const area = positive(subject.improvement_area_sf);
  const year = subject.year_built as number | null;
  const zip5 = situsZip5(subject.situs_address);
  const areaBand =
    area === null
      ? null
      : {
          subject: area,
          min: area * (1 - area_band),
          max: area * (1 + area_band),
        };
  const criteria: Row = {
    county_fips: subject.county_fips,
    tax_year: subject.tax_year,
    state_property_category: subject.state_property_category,
    improvement_area_sf: areaBand,
    year_built:
      year === null
        ? null
        : { subject: year, min: year - year_band, max: year + year_band },
    neighborhood_code: subject.neighborhood_code,
    zip: zip5,
  };
  const missing = equityMissing(subject);
  const narrowing = equityNarrowing(
    subject,
    params,
    yearUsed,
    missing.length > 0,
  );
  if (subject.value === null)
    warnings.push(
      "the subject has no current parcel.appraised_value or parcel.market_value fact",
    );
  if (missing.length)
    warnings.push(
      `no candidates selected: the subject has no current ${missing.join(", ")} fact (an improvement area must be positive), which the rule needs`,
    );
  else
    for (const n of narrowing)
      if (!n.applied) warnings.push(`${String(n.parameter)} ${String(n.text)}`);
  const widened = equityWidened(counts, min_matches);
  const included = counts[0]! + counts[1]! + (widened ? counts[2]! : 0);
  const keys = [subject.neighborhood_code, zip5, subject.county_fips];
  const applied = [keys[0] !== null, keys[1] !== null, widened];
  const tiers = [0, 1, 2].map((t) => ({
    tier: TIERS[t],
    key: keys[t],
    applied: applied[t]! && !missing.length,
    matched: counts[t],
    returned: returned.filter((m) => m.tier === t).length,
    ids: returned.filter((m) => m.tier === t).map((m) => m.urn),
  }));
  const candidates = returned.map((m) => m.row);
  const stepNames: string[] = missing.length
    ? []
    : [TX_EQUITY_STEPS.base, TX_EQUITY_STEPS.area, TX_EQUITY_STEPS.year];
  for (const n of narrowing)
    if (n.applied)
      stepNames.push(
        TX_EQUITY_STEPS[n.parameter as keyof typeof TX_EQUITY_STEPS],
      );
  if (stepNames.length !== p.funnel.length)
    throw new Error("the candidate steps and their counts disagree");
  const steps = stepNames.map((step, i) => ({ step, left: p.funnel[i] }));
  if (!missing.length && included < min_matches)
    warnings.push(
      `${included} candidates meet the rule in the whole county, fewer than min_matches (${min_matches}); the statute does not define a reasonable number of comparables`,
    );
  if (!missing.length && returned.length < limit) {
    const near = counts[0]! + counts[1]!;
    if (!widened && counts[2]! > 0)
      warnings.push(
        `${returned.length} candidates returned for limit ${limit}: the neighborhood and ZIP code tiers hold ${near}, at least min_matches (${min_matches}), so the rule does not include the ${counts[2]} more that meet it in the rest of the county; a min_matches above ${near} includes them`,
      );
    else if (included >= min_matches)
      warnings.push(
        `${returned.length} candidates returned for limit ${limit}: no other parcel meets the rule`,
      );
  }
  if (subject.value_basis !== null) {
    const other = candidates.filter(
      (c) => c.value_basis !== subject.value_basis,
    ).length;
    if (other)
      warnings.push(
        `${other} of the ${candidates.length} candidates have a value_basis other than the subject's (${String(subject.value_basis)}): compare like with like`,
      );
  }
  for (const [field, words] of [
    ["building_class", "a building class"],
    ["local_use_code", "a local use code"],
  ] as const) {
    const mine = subject[field];
    if (typeof mine !== "string") continue;
    const other = candidates.filter((c) => c[field] !== mine).length;
    if (other)
      warnings.push(
        `${other} of the ${candidates.length} candidates have ${words} other than the subject's (${mine}) or none on the roll`,
      );
  }
  // Every snapshot a returned fact comes from, with its source's rights.
  const docs = new Set<string>(p.subjectDocs);
  for (const m of returned) for (const doc of m.docs) docs.add(doc);
  for (const e of subject.value_history as Row[])
    for (const cite of Object.values(e.citations as Row))
      if (cite) docs.add(String((cite as Row).document_id));
  const srcs = sources(docs);
  // The files the compared values come from: each value citation's snapshot.
  const citedBy = new Map<string, { subject: boolean; candidates: number }>();
  const cite = (row: Row, isSubject: boolean) => {
    const c = row.citation as Row | null;
    if (!c) return;
    const doc = String(c.document_id);
    const e = citedBy.get(doc) ?? { subject: false, candidates: 0 };
    if (isSubject) e.subject = true;
    else e.candidates += 1;
    citedBy.set(doc, e);
  };
  cite(subject, true);
  for (const c of candidates) cite(c, false);
  const certification = yearUsed === null ? null : `${fmtNum(yearUsed)}-07-25`;
  const comparedFiles = srcs
    .filter((s) => citedBy.has(String(s.document_id)))
    .map((s) => ({
      document_id: s.document_id,
      source_id: s.source_id,
      title: s.title,
      as_of: s.as_of,
      tax_year: yearUsed,
      before_certification_deadline:
        certification === null || typeof s.as_of !== "string"
          ? null
          : s.as_of < certification,
      subject_value: citedBy.get(String(s.document_id))!.subject,
      candidate_values: citedBy.get(String(s.document_id))!.candidates,
    }));
  const subjectSummary =
    `the subject on ${yearUsed === null ? "no roll" : `the ${fmtNum(yearUsed)} roll`}: ` +
    `state property category ${codeText(subject.state_property_category)}; ` +
    `building class ${codeText(subject.building_class)}; ` +
    `local use code ${codeText(subject.local_use_code)}; ` +
    `improvement area ${area === null ? "not on the roll" : `${fmtNum(area)} sf`}; ` +
    `year built ${numText(year)}`;
  return withTxEquityCalcArgs({
    subject,
    candidates,
    selection: {
      rule: TX_EQUITY_RULE,
      parameters: {
        area_band,
        year_band,
        min_matches,
        limit,
        tax_year: taxYear,
        same_building_class: params.same_building_class ?? false,
        same_local_use_code: params.same_local_use_code ?? false,
        local_use_codes: params.local_use_codes?.length
          ? [...params.local_use_codes]
          : null,
      },
      tax_year: yearUsed,
      available_tax_years: p.available,
      roll_sources: p.rolls,
      building_class_sources: p.companions,
      compared_files: comparedFiles,
      subject_summary: subjectSummary,
      criteria,
      narrowing,
      steps,
      tiers,
      widened_to_county: widened && !missing.length,
      matched: included,
      returned: returned.length,
      truncated: included > returned.length,
    },
    sources: srcs,
    notice: TX_EQUITY_NOTICE,
    warnings,
  });
}

/** The first `limit` matches the rule includes, and the per-tier counts, from all matches in order. */
export function equityReturned(
  matched: EquityMatch[],
  params: TxEquityParams,
): { counts: number[]; returned: EquityMatch[] } {
  const counts = [0, 1, 2].map(
    (t) => matched.filter((m) => m.tier === t).length,
  );
  const widened = equityWidened(counts, params.min_matches);
  const returned = matched
    .filter((m) => m.tier < 2 || widened)
    .slice(0, params.limit);
  return { counts, returned };
}

/** The pool query for a subject's roll year: parcels of the county with its category code on one of the rolls. */
export function equityPoolQuery(
  region: string,
  categoryJson: unknown,
  rolls: string[],
  companions: string[],
): { sql: string; params: unknown[] } {
  return {
    sql: equityPoolSql(rolls.length, rolls.length + companions.length),
    params: [
      `fl:parcel:${region}:`,
      `fl:parcel:${region};`,
      categoryJson,
      ...rolls,
      ...rolls,
      ...companions,
    ],
  };
}

/** The county's sources, sorted (the companions are chosen from these). */
export const TX_EQUITY_COUNTY_SOURCES_SQL = EQUITY_COUNTY_SOURCES_SQL;
/** A parcel's current facts for the rule, with their source (one parameter: the URN). */
export const TX_EQUITY_SUBJECT_SQL = EQUITY_SUBJECT_SQL;
/** The same rows for every parcel with a URN in [?, ?), grouped by parcel (equityRowsBySubject). */
export const TX_EQUITY_RANGE_SQL = EQUITY_SUBJECT_SQL.replace(
  "WHERE f.subject = ?",
  "WHERE f.subject >= ? AND f.subject < ?",
);
/** A snapshot with its source's rights (one parameter: the document ID), for `equitySource`. */
export const TX_EQUITY_SOURCE_SQL = EQUITY_SOURCE_SQL;

/**
 * Candidate comparables for a Texas unequal-appraisal comparison (`equity_candidates` in Python). The caller
 * has checked that `urn` is a Texas parcel; a parcel this file does not hold is null.
 */
export function registryTxEquityCandidates(
  urn: string,
  params: TxEquityParams,
): Row | null {
  const d = open();
  if (!d.prepare("SELECT 1 AS x FROM subjects WHERE urn = ?").get(urn))
    return null;
  const region = urn.split(":")[2] ?? "";
  const subjectRows =
    equityRowsBySubject(d.prepare(EQUITY_SUBJECT_SQL).all(urn)).get(urn) ?? [];
  const years = equityRollYears(subjectRows);
  const { yearUsed, available, warnings } = equityYearUsed(
    years,
    params.tax_year ?? null,
  );
  const rolls = equityRolls(years, yearUsed);
  const countySources = d
    .prepare(EQUITY_COUNTY_SOURCES_SQL)
    .all(region.slice(3, 5), region.slice(5, 8))
    .map((r) => String(r.source_id));
  const companions = equityCompanions(countySources, rolls, yearUsed);
  const subjectFacts = equityYearFacts(subjectRows, rolls, companions);
  const subject: Row = {
    ...equityComparable(urn, subjectFacts),
    value_history: registryValueHistory(urn),
  };
  let matched: EquityMatch[] = [];
  let funnel: number[] = [];
  const rule = equityRule(urn, subject, params);
  if (rule) {
    const q = equityPoolQuery(
      region,
      subjectFacts.get("parcel.state_property_category")!.value_json,
      rolls,
      companions,
    );
    const pool: EquityCandidate[] = [];
    for (const [candUrn, candRows] of equityRowsBySubject(
      d.prepare(q.sql).all(...q.params),
    )) {
      const facts = equityYearFacts(candRows, rolls, companions);
      pool.push({
        urn: candUrn,
        row: equityComparable(candUrn, facts),
        docs: equityFactDocs(facts),
      });
    }
    matched = selectEquityCandidates(urn, subject, pool, params);
    funnel = equityFunnel(rule, pool);
  }
  const { counts, returned } = equityReturned(matched, params);
  return assembleTxEquity(
    {
      subject,
      subjectDocs: equityFactDocs(subjectFacts),
      params,
      yearUsed,
      available,
      rolls,
      companions,
      warnings,
      counts,
      funnel,
      returned,
    },
    (docs) => equitySources(d, docs),
  );
}
