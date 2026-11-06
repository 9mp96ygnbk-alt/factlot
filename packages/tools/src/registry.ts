/**
 * Read-only access to a FactLot Registry SQLite file (built by the Python `factlot.registry`
 * pipeline). Mirrors the Python query logic exactly; a cross-language test enforces it.
 * Configure with FACTLOT_REGISTRY_DB=/path/to/registry.db or `configureRegistry(path)`.
 */
import { createRequire } from "node:module";

import { fmtNum } from "@factlot/calc";
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
      "this FactLot server has no registry loaded. Registry tools read a registry file: download one (sample: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/registry-sample-dc-2026-11-04) and run FactLot yourself with FACTLOT_REGISTRY_DB pointing at it. The hosted API does not serve the registry yet.",
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
    warnings: areaWarnings(facts),
  };
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
  // A file without parcel_rule was built with parcel rule 1 (ID spec 0.1-0.2) and keeps its URNs.
  const rule = d
    .prepare("SELECT value FROM meta WHERE key = 'parcel_rule'")
    .get();
  return parcelId({
    stateFips,
    countyFips,
    apn,
    ...(rule && String(rule.value) === PARCEL_RULE
      ? {}
      : { normalize: normalizeApnV1 }),
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
  return row && String(row.value) === NAME_KEY_VERSION
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
  const keys = [normalizeAddress(address)];
  const legacy = legacyNormalizeAddress(address);
  if (
    !(row && String(row.value) === ADDRESS_KEY_VERSION) &&
    !keys.includes(legacy)
  )
    keys.push(legacy);
  return keys;
}

/** Street types: a query without a house number must name one ("Main St", not "Main"). */
const STREET_TYPES = new Set([
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

export function registrySearchAddress(address: string, limit = 20): Row[] {
  const d = open();
  const { mode } = addressQuery(address);
  if (mode === null) return [];
  const line = address.split(",")[0] ?? "";
  // Each key version the file may hold: the words of the street line under that version's rules.
  const runs = addressSearchKeys(d, line).map((k) => k.split(" "));
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

interface CoverageSource {
  source_id: string;
  as_of: string;
}
interface CountyCoverage {
  region: string;
  state_fips: string;
  county_fips: string;
  state: string | null;
  parcels: number;
  buildings: number;
  sources: CoverageSource[];
}
interface RegistryCoverage {
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
  const cov = coverage(d);
  return {
    ...cov,
    counties: cov.counties.map((c) => ({
      ...c,
      name: countyName(`${c.state_fips}${c.county_fips}`) ?? null,
    })),
    name_key_version: versions.get("name_key_version") ?? "1",
    address_key_version: versions.get("address_key_version") ?? "1",
    scope: REGISTRY_SCOPE,
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

function parcelMiss(
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

function entityMiss(
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

function addressMiss(cov: RegistryCoverage, query: string): Row {
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

function entitiesMiss(cov: RegistryCoverage): Row {
  return {
    loaded_jurisdictions: cov.entity_registries.map((r) => r.jurisdiction),
    message: `no registered entity matched; entity registries loaded: ${registriesSummary(cov)}. Natural persons are never searchable`,
  };
}

function externalMiss(
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
  const { kind, parts } = parse(urn);
  const cov = coverage(open());
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

/** The error for a parcel outside Texas (`texas_only` in Python). */
export function texasOnly(stateFips: string): string {
  return `registry_tx_equity_candidates is Texas-only (state FIPS 48): this parcel is in state FIPS ${stateFips}. Texas unequal-appraisal protests compare parcels on one Texas appraisal district's roll`;
}

/** The only predicates the candidate tool reads (never ownership.*), `PARCEL_PREDICATES` in Python. */
export const TX_EQUITY_PREDICATES = [
  "parcel.tax_year",
  "parcel.state_property_category",
  "parcel.market_value",
  "parcel.appraised_value",
  "parcel.improvement_area_sf",
  "parcel.land_area_sf",
  "parcel.year_built",
  "parcel.neighborhood_code",
  "parcel.building_class",
  "parcel.situs_address",
] as const;
const EQUITY_IN = TX_EQUITY_PREDICATES.map((p) => `'${p}'`).join(", ");
const EQUITY_ORDER =
  " ORDER BY f.subject, f.predicate, f.as_of DESC, f.fact_id";
const EQUITY_SUBJECT_SQL =
  `SELECT f.* FROM current_facts f WHERE f.subject = ? AND f.predicate IN (${EQUITY_IN})` +
  EQUITY_ORDER;
const EQUITY_POOL_SQL =
  "SELECT f.* FROM current_facts f WHERE f.subject IN (SELECT c.subject FROM current_facts c WHERE c.subject >= ? " +
  "AND c.subject < ? AND c.predicate = 'parcel.state_property_category' AND c.value_json = ?) " +
  `AND f.predicate IN (${EQUITY_IN})` +
  EQUITY_ORDER;
const EQUITY_SOURCE_SQL =
  "SELECT s.document_id, s.source_id, s.as_of, s.retrieved_at, s.filename, src.publisher, src.title, src.url, " +
  "src.license, src.ai_use, src.redistribution, src.attribution FROM snapshots s JOIN sources src USING (source_id) " +
  "WHERE s.document_id = ?";
const ZIP_AFTER_COMMA = /(?:^|[^0-9A-Z_])([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$/;
const STATE_ZIP_TAIL = /\s[A-Z]{2}\s+([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$/;
const TIERS = ["neighborhood", "zip", "county"] as const;

export const TX_EQUITY_RULE =
  "FactLot's default candidate rule (a design choice, not a legal standard): parcels in the subject's appraisal district (county) whose current facts give the same tax year as the subject's and exactly the same state property category code, an improvement area within area_band (a share) of the subject's, a year built within year_band years of the subject's when both are known, and an appraised or market value. Tiers: parcels sharing the subject's neighborhood code (when it has one), then parcels in its 5-digit ZIP code, then the rest of the county only when the first two tiers hold fewer than min_matches. Ordered by tier, then nearest improvement area, then URN; at most limit returned.";
export const TX_EQUITY_NOTICE =
  "Candidates only: a person decides which, if any, to use as comparables. The selection rule is FactLot's default, not a legal standard of comparability. For evidence calculations only: FactLot does not represent property owners, file protests, or advise whether to protest or what value to claim. Owner names and mailing addresses are never returned.";

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

type FactsBySubject = Map<string, Map<string, Row>>;

/** subject → predicate → its newest current fact row (`registry_get`'s rule for single-valued predicates). */
function firstPerPredicate(rows: Row[]): FactsBySubject {
  const out: FactsBySubject = new Map();
  for (const r of rows) {
    const subject = String(r.subject);
    const facts = out.get(subject) ?? new Map<string, Row>();
    if (!facts.has(String(r.predicate))) facts.set(String(r.predicate), r);
    out.set(subject, facts);
  }
  return out;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function positive(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}

/** A parcel shaped as a `calc_tx_unequal_appraisal` subject or comparable; missing facts are null. */
function comparable(urn: string, facts: Map<string, Row>): Row {
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
  return {
    id: urn,
    county_fips: (urn.split(":")[2] ?? "").slice(5, 8),
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
    neighborhood_code: nonEmptyString(val("parcel.neighborhood_code")),
    building_class: nonEmptyString(val("parcel.building_class")),
    situs_address: nonEmptyString(val("parcel.situs_address")),
    tax_year: finite(val("parcel.tax_year")),
    citation: cited ? factCitation(cited) : null,
  };
}

/** The cited snapshots with their source's rights, as `registry_get` gives each fact's `rights`. */
function equitySources(d: Database, documentIds: Set<string>): Row[] {
  const out: Row[] = [];
  for (const doc of [...documentIds].sort()) {
    const row = d.prepare(EQUITY_SOURCE_SQL).get(doc);
    if (!row) continue;
    const r: Row = {
      ai_use: row.ai_use,
      redistribution: row.redistribution,
      license: row.license,
    };
    if (row.attribution) r.attribution = row.attribution;
    out.push({
      document_id: doc,
      source_id: row.source_id,
      title: `${row.publisher}: ${row.title} (${row.filename})`,
      uri: row.url,
      retrieved_at: row.retrieved_at,
      as_of: row.as_of,
      rights: r,
    });
  }
  return out;
}

export interface TxEquityParams {
  area_band: number;
  year_band: number;
  min_matches: number;
  limit: number;
}

/** The parcel URN a `registry_tx_equity_candidates` call names: its `urn`, or the URN of its APN under the file's rule. */
export function txEquitySubjectUrn(
  stateFips: string,
  countyFips: string,
  apn: string,
): string {
  return parcelUrn(open(), stateFips, countyFips, apn);
}

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
  const { area_band, year_band, min_matches, limit } = params;
  const region = urn.split(":")[2] ?? "";
  const subjectFacts =
    firstPerPredicate(d.prepare(EQUITY_SUBJECT_SQL).all(urn)).get(urn) ??
    new Map<string, Row>();
  const subject: Row = {
    ...comparable(urn, subjectFacts),
    value_history: registryValueHistory(urn),
  };
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
  const warnings: string[] = [];
  const missing = (
    [
      ["parcel.tax_year", subject.tax_year],
      ["parcel.state_property_category", subject.state_property_category],
      ["parcel.improvement_area_sf", area],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v === null)
    .map(([p]) => p);
  if (subject.value === null)
    warnings.push(
      "the subject has no current parcel.appraised_value or parcel.market_value fact",
    );
  type Match = [number, number, string, Row, Map<string, Row>];
  const matched: Match[] = [];
  if (missing.length) {
    warnings.push(
      `no candidates selected: the subject has no current ${missing.join(", ")} fact (an improvement area must be positive), which the rule needs`,
    );
  } else {
    const { min: lo, max: hi } = areaBand as { min: number; max: number };
    const pool = firstPerPredicate(
      d
        .prepare(EQUITY_POOL_SQL)
        .all(
          `fl:parcel:${region}:`,
          `fl:parcel:${region};`,
          subjectFacts.get("parcel.state_property_category")!.value_json,
        ),
    );
    for (const [candUrn, facts] of pool) {
      if (candUrn === urn) continue;
      const c = comparable(candUrn, facts);
      const cArea = positive(c.improvement_area_sf);
      if (
        c.state_property_category !== subject.state_property_category ||
        c.tax_year !== subject.tax_year ||
        cArea === null ||
        !(lo <= cArea && cArea <= hi) ||
        c.value === null
      )
        continue;
      if (
        year !== null &&
        c.year_built !== null &&
        Math.abs((c.year_built as number) - year) > year_band
      )
        continue;
      const tier =
        subject.neighborhood_code !== null &&
        c.neighborhood_code === subject.neighborhood_code
          ? 0
          : zip5 !== null && situsZip5(c.situs_address) === zip5
            ? 1
            : 2;
      matched.push([
        tier,
        Math.abs(cArea - (area as number)),
        candUrn,
        c,
        facts,
      ]);
    }
  }
  matched.sort(
    (a, b) =>
      a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0),
  );
  const counts = [0, 1, 2].map((t) => matched.filter((m) => m[0] === t).length);
  const widened = counts[0]! + counts[1]! < min_matches;
  const included = matched.filter((m) => m[0] < 2 || widened);
  const returned = included.slice(0, limit);
  const keys = [subject.neighborhood_code, zip5, subject.county_fips];
  const applied = [keys[0] !== null, keys[1] !== null, widened];
  const tiers = [0, 1, 2].map((t) => ({
    tier: TIERS[t],
    key: keys[t],
    applied: applied[t]! && !missing.length,
    matched: counts[t],
    returned: returned.filter((m) => m[0] === t).length,
    ids: returned.filter((m) => m[0] === t).map((m) => m[2]),
  }));
  const candidates = returned.map((m) => m[3]);
  if (!missing.length && included.length < min_matches)
    warnings.push(
      `${included.length} candidates meet the rule in the whole county, fewer than min_matches (${min_matches}); the statute does not define a reasonable number of comparables`,
    );
  if (subject.value_basis !== null) {
    const other = candidates.filter(
      (c) => c.value_basis !== subject.value_basis,
    ).length;
    if (other)
      warnings.push(
        `${other} of the ${candidates.length} candidates have a value_basis other than the subject's (${String(subject.value_basis)}): compare like with like`,
      );
  }
  // Every snapshot a returned fact comes from, with its source's rights.
  const docs = new Set<string>();
  for (const facts of [subjectFacts, ...returned.map((m) => m[4])])
    for (const f of facts.values()) docs.add(String(f.document_id));
  for (const e of subject.value_history as Row[])
    for (const cite of Object.values(e.citations as Row))
      if (cite) docs.add(String((cite as Row).document_id));
  return {
    subject,
    candidates,
    selection: {
      rule: TX_EQUITY_RULE,
      parameters: { area_band, year_band, min_matches, limit },
      criteria,
      tiers,
      widened_to_county: widened && !missing.length,
      matched: included.length,
      returned: returned.length,
      truncated: included.length > returned.length,
    },
    sources: equitySources(d, docs),
    notice: TX_EQUITY_NOTICE,
    warnings,
  };
}
