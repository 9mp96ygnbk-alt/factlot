/**
 * Read-only access to a FactLot Registry SQLite file (built by the Python `factlot.registry`
 * pipeline). Mirrors the Python query logic exactly; a cross-language test enforces it.
 * Configure with FACTLOT_REGISTRY_DB=/path/to/registry.db or `configureRegistry(path)`.
 */
import { createRequire } from "node:module";

import { FactLotIdError, addressTokens, parcelId, parse } from "@factlot/id";

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
      "this FactLot server has no registry loaded. Registry tools read a registry file: download one (sample: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/registry-sample-dc-2026-11-03) and run FactLot yourself with FACTLOT_REGISTRY_DB pointing at it. The hosted API does not serve the registry yet.",
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
 * Predicates a parcel may hold many of at once (one fact per sale). Every other predicate is
 * single-valued: when two current sources disagree, the newest fact is returned.
 */
export const MULTI_VALUED_PREDICATES: ReadonlySet<string> = new Set([
  "transaction.sale",
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
    const price = typeof v.price_usd === "number" ? v.price_usd : -1;
    return [typeof v.date === "string" ? v.date : "", price, String(f.id)];
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

export function registryFacts(urn: string, history = false): Row[] {
  const d = open();
  const table = history ? "facts" : "current_facts";
  const rows = d
    .prepare(
      `SELECT * FROM ${table} WHERE subject = ? ORDER BY predicate, as_of DESC, fact_id`,
    )
    .all(urn);
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

function status(d: Database, urn: string): string {
  const rows = d
    .prepare(
      "SELECT c.present FROM coverage c WHERE c.subject = ? AND c.as_of = " +
        "(SELECT MAX(as_of) FROM coverage d WHERE d.subject = c.subject AND d.source_id = c.source_id)",
    )
    .all(urn);
  return rows.length === 0 || rows.some((r) => Number(r.present) === 1)
    ? "current"
    : "not_in_latest_snapshot";
}

export function registryGet(urn: string): Row | null {
  const d = open();
  parse(urn); // a malformed URN is a format error (FactLotIdError), not a miss
  const subj = d.prepare("SELECT * FROM subjects WHERE urn = ?").get(urn);
  if (!subj) return null;
  const extra: Row = {};
  if (subj.kind === "parcel") extra.building = buildingOf(d, urn);
  else if (subj.kind === "building") extra.building = buildingDetail(d, urn);
  const relationships = d
    .prepare(
      `SELECT from_urn, type, to_urn, as_of, method, confidence, basis, document_id FROM relationships r ` +
        `WHERE (from_urn = ? OR to_urn = ?) AND ${CURRENT_LINK} ORDER BY as_of DESC`,
    )
    .all(urn, urn)
    .map((r) => ({ ...r }));
  const crosswalk = d
    .prepare("SELECT system, external_id FROM crosswalk WHERE urn = ?")
    .all(urn)
    .map((r) => ({ ...r }));
  return {
    urn,
    kind: subj.kind,
    short: subj.short,
    label: subj.label,
    status: status(d, urn),
    facts: registryFacts(urn),
    relationships,
    crosswalk,
    ...extra,
  };
}

export function registryResolveParcel(
  stateFips: string,
  countyFips: string,
  apn: string,
): string | null {
  const urn = parcelId({ stateFips, countyFips, apn }).urn;
  return open().prepare("SELECT 1 AS x FROM subjects WHERE urn = ?").get(urn)
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

export function registrySearchAddress(address: string, limit = 20): Row[] {
  const d = open();
  const keys = addressSearchKeys(d, address);
  const like = keys.map(() => "a.key LIKE ?").join(" OR ");
  const exact = keys.map(() => "a.key = ?").join(" OR ");
  return d
    .prepare(
      "SELECT s.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn " +
        `WHERE ${like} GROUP BY s.urn ORDER BY MAX(${exact}) DESC, s.label, s.urn LIMIT ?`,
    )
    .all(...keys.map((k) => `%${k}%`), ...keys, limit)
    .map((r) => ({ ...r }));
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
  return {
    ...coverage(d),
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
      .map(
        (c) =>
          `county ${c.state_fips}${c.county_fips} (${stateLabel(c.state_fips)}, ${c.parcels} parcels)`,
      )
      .join(", ");
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
  const label = `county ${stateFips}${countyFips} (${stateLabel(stateFips)})`;
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
          ? `no building is rolled up at this address: county ${region.slice(3)} (${stateLabel(stateFips)}) is loaded in this registry (${county.parcels} parcels, as of ${latestAsOf(county.sources)}), and the registry records a building only where two or more of its parcels share a street address and ZIP code; search the address with registry_search_address to find a single parcel`
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
