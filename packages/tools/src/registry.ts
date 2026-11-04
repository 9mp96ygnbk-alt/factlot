/**
 * Read-only access to a FactLot Registry SQLite file (built by the Python `factlot.registry`
 * pipeline). Mirrors the Python query logic exactly; a cross-language test enforces it.
 * Configure with FACTLOT_REGISTRY_DB=/path/to/registry.db or `configureRegistry(path)`.
 */
import { createRequire } from "node:module";

import { parcelId } from "@factlot/id";

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

/** Point the registry tools at a SQLite file (or undefined to fall back to FACTLOT_REGISTRY_DB). */
export function configureRegistry(path: string | undefined): void {
  configuredPath = path;
  db?.close();
  db = undefined;
  dbPath = undefined;
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

export function normalizeAddress(address: string): string {
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
    if (!history && seen.has(f.predicate)) continue;
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
  return out;
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
  const subj = d.prepare("SELECT * FROM subjects WHERE urn = ?").get(urn);
  if (!subj) return null;
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

export function registrySearchAddress(address: string, limit = 20): Row[] {
  const key = normalizeAddress(address);
  return open()
    .prepare(
      "SELECT DISTINCT s.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn " +
        "WHERE a.key LIKE ? ORDER BY (a.key = ?) DESC, s.label LIMIT ?",
    )
    .all(`%${key}%`, key, limit)
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
