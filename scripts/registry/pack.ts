/**
 * Build the hosted registry pack: the files the factlot-registry Worker (deploy/registry) answers from.
 *
 *   node --experimental-strip-types --conditions=factlot-source scripts/registry/pack.ts --out <dir> <db>...
 *
 * Each <db> is a registry SQLite file, named by its basename ("md.db" is region "md") or given as name=path. The
 * files must hold disjoint regions. Records, history, dated records and ownership are made by the SDK itself
 * (configureRegistry + runTool on each file) and checked back after encoding; searches get indexes that follow the
 * SQL in packages/tools/src/registry.ts. The pack holds registry data: keep it out of git and never publish it.
 *
 * --jobs <n> builds the regions in up to n processes at once and gives the same pack (see "parallel builds" below):
 *
 *   node --experimental-strip-types --conditions=factlot-source scripts/registry/pack.ts --jobs 6 --out <dir> \
 *     md.db dc.db ut.db tx.db ny.db ca.db ma.db co.db ct.db
 *
 * The wall-clock time is then about that of the slowest file (Texas) rather than the sum. Each process holds one
 * file's address, name and crosswalk rows in memory, and the parent holds them all while it writes the indexes.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADDRESS_STREET_TYPES,
  TX_EQUITY_COUNTY_SOURCES_SQL,
  TX_EQUITY_RANGE_SQL,
  TX_EQUITY_SOURCE_SQL,
  computeRegistryCoverage,
  configureRegistry,
  coverageReport,
  equityCompanions,
  equityComparable,
  equityFactDocs,
  equityMissing,
  equityRollYears,
  equityRolls,
  equityRowsBySubject,
  equitySource,
  equityYearFacts,
  hostedWithheldCounties,
  mergeCoverage,
  runTool,
  situsZip5,
  type RegistryCoverage,
} from "../../packages/tools/src/index.ts";
import {
  EQUITY_BUCKET_BYTES,
  buildList,
  byArea,
  decodeRow,
  encodeRow,
  groupBucket,
  groupDir,
  poolName,
  type EqRow,
  type EquityManifest,
  type EquitySubject,
  type PoolHeader,
  type SortedList,
} from "../../deploy/registry/src/equity.ts";
import {
  hostedCoverageResult,
  partialCounties,
} from "../../deploy/registry/src/hosted.ts";
import {
  INLINE_ROWS,
  MAX_LIMIT,
  NAME_BUCKET_BYTES,
  NAME_CHUNK_ROWS,
  NAME_INLINE_ROWS,
  NAME_PAGE_ROWS,
  NAME_POSTING_MAX,
  PACK_FORMAT,
  PACK_MAX_FILES,
  PACK_MAX_FILE_BYTES,
  PAGE_ROWS,
  SHARD_TARGET_BYTES,
  ShardEncoder,
  SharedPages,
  decodeEntry,
  getResult,
  shardOf,
  sqliteCompare,
  upperAscii,
  urnPrefix,
  type GetEntry,
  type Manifest,
  type PackDb,
} from "../../deploy/registry/src/format.ts";
import {
  nameGrams,
  type AddressRow,
  type ExactList,
  type ExactNames,
  type NameRow,
  type PostedRow,
  type Posting,
} from "../../deploy/registry/src/search.ts";

type Row = Record<string, unknown>;
interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...p: unknown[]): Row | undefined;
    all(...p: unknown[]): Row[];
    iterate(...p: unknown[]): IterableIterator<Row>;
    run(...p: unknown[]): unknown;
  };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (
    p: string,
    o?: { readOnly?: boolean; timeout?: number },
  ) => Db;
};

/** A date before any snapshot: the dated variant for "before this file's first date". */
const BEFORE = "0001-01-01";

export interface PackSource {
  name: string;
  path: string;
}

export interface PackStats {
  files: number;
  bytes: number;
  largest: { path: string; bytes: number };
  manifest: Manifest;
}

const ok = (tool: string, input: unknown): Row => {
  const out = runTool(tool, input);
  if (!out.ok)
    throw new Error(
      `${tool} ${JSON.stringify(input)}: ${out.error.error}: ${out.error.message}`,
    );
  return out.result as Row;
};

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function withoutKeys(rec: Row, ...keys: string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(rec)) if (!keys.includes(k)) out[k] = v;
  return out;
}

class Writer {
  files = 0;
  bytes = 0;
  largest = { path: "", bytes: 0 };
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  write(path: string, value: unknown): number {
    const text = JSON.stringify(value);
    const full = join(this.dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
    const n = Buffer.byteLength(text);
    this.files += 1;
    this.bytes += n;
    if (n > this.largest.bytes) this.largest = { path, bytes: n };
    return n;
  }
}

/** One subject's stored answers, made by runTool on the configured file and checked against them after decoding. */
function subjectEntry(
  urn: string,
  kind: string,
  dbIndex: number,
  dates: string[],
  q?: EquitySubject,
): { entry: GetEntry; expect: [boolean, string | undefined, string][] } {
  const base = ok("registry_get", { urn, include_history: true });
  const rec = withoutKeys(base, "history");
  const hist = base.history as unknown[];
  const entry: GetEntry = { k: dbIndex, r: rec, v: [] };
  if (q) entry.q = q;
  if (!same(hist, rec.facts)) entry.h = hist;
  const expect: [boolean, string | undefined, string][] = [
    [true, undefined, JSON.stringify(base)],
    [false, undefined, JSON.stringify(rec)],
  ];
  for (const at of [BEFORE, ...dates]) {
    const dated = ok("registry_get", { urn, include_history: true, as_of: at });
    expect.push([true, at, JSON.stringify(dated)]);
    expect.push([false, at, JSON.stringify(withoutKeys(dated, "history"))]);
    if (dated.as_of !== at) throw new Error(`${urn}: as_of not echoed`);
    const vr = withoutKeys(dated, "history", "as_of");
    const vh = dated.history as unknown[];
    const rv = same(vr, rec) ? 0 : vr;
    const hv = same(vh, hist) ? 0 : same(vh, vr.facts) ? 1 : vh;
    entry.v.push(rv === 0 && hv === 0 ? 0 : [rv, hv]);
  }
  if (kind === "entity") {
    const owned = ok("registry_owned_by", { entity_urn: urn });
    if ((owned.results as unknown[]).length)
      entry.o = {
        results: owned.results as unknown[],
        buildings: owned.buildings as unknown[],
      };
  }
  return { entry, expect };
}

function checkEntry(
  urn: string,
  entry: GetEntry,
  dates: string[],
  expect: [boolean, string | undefined, string][],
): void {
  for (const [history, asOf, want] of expect) {
    const got = JSON.stringify(getResult(entry, dates, history, asOf));
    if (got !== want)
      throw new Error(
        `${urn}: the packed record differs from runTool (history ${history}, as_of ${asOf ?? "none"})`,
      );
  }
}

/** A file with more entities than this keeps only the entities that own a parcel the pack holds. */
export const ENTITY_WHOLE_MAX = 50_000;

export interface FilterResult {
  /** The file to pack: the source itself when nothing is dropped, else the filtered copy. */
  path: string;
  parcels_dropped: number;
  buildings_dropped: number;
  /** Entity jurisdiction → [entities kept, entities in the source] for a jurisdiction kept only in part. */
  entity_scope: Record<string, { served: number; total: number }>;
  /** What the suppression list removed: entities dropped, and parcels whose owner facts were dropped. */
  suppressed: { entities: number; parcel_owners: number };
}

/**
 * A removal list (data policy section 4, "Corrections and takedowns"). It names people, so it lives outside the
 * repository, next to the registry files, and is passed with --suppress. Entities and buildings in `subjects` are
 * not served at all; a parcel in `subjects`, or one whose owner of record matches `owner_names` (case, spacing
 * and punctuation ignored), keeps its parcel facts and loses its owner, mailing address and ownership links; an
 * entity whose legal name matches `owner_names` is not served.
 */
export interface Suppression {
  subjects: string[];
  owner_names: string[];
}

/** The comparison form of an owner name for the suppression list. */
export function suppressionKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Reads and checks a suppression file: {"subjects": [...URNs], "owner_names": [...]} (either may be absent). */
export function readSuppression(path: string): Suppression {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<
    Record<keyof Suppression, unknown>
  >;
  const list = (v: unknown, what: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim()))
      throw new Error(`${path}: "${what}" must be a list of non-empty strings`);
    return v as string[];
  };
  const subjects = list(raw.subjects, "subjects");
  for (const u of subjects)
    if (!/^fl:(entity|parcel|building):[^:]+:.+/.test(u))
      throw new Error(`${path}: ${u} is not an entity, parcel or building URN`);
  return { subjects, owner_names: list(raw.owner_names, "owner_names") };
}

const sqlText = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/**
 * The registry file the pack is built from: `src` without the parcels and buildings of `excludeCounties` (5-digit
 * FIPS), and, when it holds more than ENTITY_WHOLE_MAX entities, without the entities that own none of its
 * remaining parcels. Everything attached to a dropped subject goes with it (facts, coverage, links, crosswalk IDs,
 * index rows, building members), as do the sources and snapshots of an excluded county. Rows keep their order.
 * When nothing would be dropped the source itself is returned. `src` is only read.
 */
export function filterRegistry(
  src: string,
  out: string,
  excludeCounties: string[],
  entityWholeMax = ENTITY_WHOLE_MAX,
  suppression: Suppression = { subjects: [], owner_names: [] },
): FilterResult {
  const probe = new DatabaseSync(src, { readOnly: true });
  // The suppression list, resolved against this file: entities (and buildings) to drop, parcels to strip of owners.
  const names = new Set(suppression.owner_names.map(suppressionKey));
  const dropSubjects = new Set(
    suppression.subjects.filter((u) => !u.startsWith("fl:parcel:")),
  );
  const ownerParcels = new Set(
    suppression.subjects.filter((u) => u.startsWith("fl:parcel:")),
  );
  const excludedRanges = excludeCounties.flatMap((fips) =>
    ["parcel", "building"].map(
      (kind) =>
        `(urn >= ${sqlText(`fl:${kind}:us-${fips}:`)} AND urn < ${sqlText(`fl:${kind}:us-${fips};`)})`,
    ),
  );
  const excluded = excludedRanges.length
    ? `(${excludedRanges.join(" OR ")})`
    : "0";
  let dropCount: number;
  let entities: { j: string; n: number }[];
  try {
    dropCount = Number(
      probe
        .prepare(`SELECT COUNT(*) AS n FROM subjects WHERE ${excluded}`)
        .get()?.n,
    );
    entities = probe
      .prepare(
        "SELECT substr(urn, 11, instr(substr(urn, 11), ':') - 1) AS j, COUNT(*) AS n FROM subjects " +
          "WHERE kind = 'entity' GROUP BY j ORDER BY j",
      )
      .all()
      .map((r) => ({ j: String(r.j), n: Number(r.n) }));
    if (names.size) {
      for (const r of probe
        .prepare(
          "SELECT subject, predicate, value_json FROM facts WHERE predicate IN ('ownership.owner_of_record', 'entity.legal_name')",
        )
        .iterate()) {
        let v: unknown;
        try {
          v = JSON.parse(String(r.value_json));
        } catch {
          continue;
        }
        if (typeof v !== "string" || !names.has(suppressionKey(v))) continue;
        if (r.predicate === "entity.legal_name")
          dropSubjects.add(String(r.subject));
        else ownerParcels.add(String(r.subject));
      }
    }
    const present = (urns: Set<string>) => {
      const q = probe.prepare("SELECT 1 AS x FROM subjects WHERE urn = ?");
      return [...urns].filter((u) => q.get(u) !== undefined);
    };
    for (const u of [...dropSubjects])
      if (!present(new Set([u])).length) dropSubjects.delete(u);
    for (const u of [...ownerParcels])
      if (!present(new Set([u])).length) ownerParcels.delete(u);
  } finally {
    probe.close();
  }
  const total = entities.reduce((a, e) => a + e.n, 0);
  const trim = total > entityWholeMax;
  if (!dropCount && !trim && !dropSubjects.size && !ownerParcels.size)
    return {
      path: src,
      parcels_dropped: 0,
      buildings_dropped: 0,
      entity_scope: {},
      suppressed: { entities: 0, parcel_owners: 0 },
    };
  rmSync(out, { force: true });
  mkdirSync(join(out, ".."), { recursive: true });
  // Another process may be reading the same source (a parity check, a maintain step finishing): wait for its lock.
  const d = new DatabaseSync(out, { timeout: 120_000 });
  try {
    d.exec(
      "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;",
    );
    d.exec(`ATTACH ${sqlText(src)} AS s`);
    const schema = d
      .prepare(
        "SELECT type, name, sql FROM s.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all();
    for (const type of ["table", "index", "view"])
      for (const r of schema) if (r.type === type) d.exec(String(r.sql));
    const counts = (where: string) =>
      Number(
        d
          .prepare(
            `SELECT COUNT(*) AS n FROM s.subjects WHERE kind = ? AND ${excluded}`,
          )
          .get(where)?.n,
      );
    const parcelsDropped = counts("parcel");
    const buildingsDropped = counts("building");
    // The subjects kept, and the source subjects dropped (a link to a subject the file never held stays).
    d.exec(
      "CREATE TEMP TABLE suppressed (urn TEXT PRIMARY KEY); CREATE TEMP TABLE suppressed_owner (urn TEXT PRIMARY KEY)",
    );
    const addSup = d.prepare("INSERT OR IGNORE INTO suppressed VALUES (?)");
    for (const u of dropSubjects) addSup.run(u);
    const addOwner = d.prepare(
      "INSERT OR IGNORE INTO suppressed_owner VALUES (?)",
    );
    for (const u of ownerParcels) addOwner.run(u);
    d.exec(
      `CREATE TEMP TABLE keep (urn TEXT PRIMARY KEY); INSERT INTO keep SELECT urn FROM s.subjects WHERE kind != 'entity' AND NOT ${excluded} AND urn NOT IN (SELECT urn FROM suppressed)`,
    );
    if (trim)
      d.exec(
        "INSERT OR IGNORE INTO keep SELECT r.from_urn FROM s.relationships r JOIN s.subjects e ON e.urn = r.from_urn " +
          "WHERE e.kind = 'entity' AND r.type = 'owns' AND r.to_urn IN (SELECT urn FROM keep)",
      );
    else
      d.exec(
        "INSERT INTO keep SELECT urn FROM s.subjects WHERE kind = 'entity'",
      );
    d.exec("DELETE FROM keep WHERE urn IN (SELECT urn FROM suppressed)");
    const kept = (col: string) =>
      `(${col} IN (SELECT urn FROM keep) OR NOT EXISTS (SELECT 1 FROM s.subjects x WHERE x.urn = ${col}))`;
    const sourceKept = excludeCounties.length
      ? `(county_fips IS NULL OR state_fips || county_fips NOT IN (${excludeCounties.map(sqlText).join(", ")}))`
      : "1";
    for (const sql of [
      `INSERT INTO meta SELECT * FROM s.meta WHERE key != 'coverage' ORDER BY rowid`,
      `INSERT INTO sources SELECT * FROM s.sources WHERE ${sourceKept} ORDER BY rowid`,
      "INSERT INTO snapshots SELECT * FROM s.snapshots WHERE source_id IN (SELECT source_id FROM main.sources) ORDER BY rowid",
      "INSERT INTO subjects SELECT * FROM s.subjects WHERE urn IN (SELECT urn FROM keep) ORDER BY rowid",
      "INSERT INTO facts SELECT * FROM s.facts WHERE subject IN (SELECT urn FROM keep) ORDER BY rowid",
      `INSERT INTO coverage SELECT * FROM s.coverage WHERE ${kept("subject")} ORDER BY rowid`,
      `INSERT INTO relationships SELECT * FROM s.relationships WHERE ${kept("from_urn")} AND ${kept("to_urn")} ORDER BY rowid`,
      `INSERT INTO crosswalk SELECT * FROM s.crosswalk WHERE ${kept("urn")} ORDER BY rowid`,
      "INSERT INTO address_index SELECT * FROM s.address_index WHERE urn IN (SELECT urn FROM keep) ORDER BY rowid",
      "INSERT INTO name_index SELECT * FROM s.name_index WHERE urn IN (SELECT urn FROM keep) ORDER BY rowid",
      `INSERT INTO building_members SELECT * FROM s.building_members WHERE ${kept("building_urn")} AND ${kept("parcel_urn")} ORDER BY rowid`,
    ]) {
      const table = /^INSERT INTO (\w+)/.exec(sql)![1]!;
      const has = d
        .prepare(
          "SELECT 1 AS x FROM s.sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table);
      if (has) d.exec(sql);
    }
    // A suppressed parcel keeps its parcel facts, without its owner, mailing address or ownership links.
    d.exec(
      "DELETE FROM main.facts WHERE subject IN (SELECT urn FROM suppressed_owner) AND predicate LIKE 'ownership.%'",
    );
    d.exec(
      "DELETE FROM main.relationships WHERE type = 'owns' AND to_urn IN (SELECT urn FROM suppressed_owner)",
    );
    const scope: FilterResult["entity_scope"] = {};
    if (trim)
      for (const e of entities)
        scope[e.j] = {
          served: Number(
            d
              .prepare(
                "SELECT COUNT(*) AS n FROM main.subjects WHERE kind = 'entity' AND urn >= ? AND urn < ?",
              )
              .get(`fl:entity:${e.j}:`, `fl:entity:${e.j};`)?.n,
          ),
          total: e.n,
        };
    d.exec("DETACH s");
    return {
      path: out,
      parcels_dropped: parcelsDropped,
      buildings_dropped: buildingsDropped,
      entity_scope: scope,
      suppressed: {
        entities: dropSubjects.size,
        parcel_owners: ownerParcels.size,
      },
    };
  } catch (err) {
    d.close();
    rmSync(out, { force: true });
    throw err;
  } finally {
    try {
      d.close();
    } catch {
      // closed above
    }
  }
}

/** The `sources` entries of every snapshot of a file's Texas sources, by document ID. */
function texasDocs(d: Db): [string, Row][] {
  return d
    .prepare(
      "SELECT s.document_id FROM snapshots s JOIN sources src USING (source_id) WHERE src.state_fips = '48' ORDER BY s.document_id",
    )
    .all()
    .map((r) => {
      const doc = String(r.document_id);
      return [
        doc,
        equitySource(doc, d.prepare(TX_EQUITY_SOURCE_SQL).get(doc)!),
      ];
    });
}

interface PoolSpec {
  county: string;
  region: string;
  rolls: string[];
  companions: string[];
  categoryJson: unknown;
  category: string;
  taxYear: number;
}

/**
 * The candidate data of one file's Texas counties: each parcel's EquitySubject (returned) and the pools (written),
 * made with the SDK's own rule functions from the rows its SQL reads, and checked to decode back to them.
 */
function buildEquity(
  d: Db,
  regions: string[],
  w: Writer,
  m: EquityManifest,
  docIndex: Map<string, number>,
  poolNames: Set<string>,
  log: (line: string) => void,
): Map<string, EquitySubject> {
  const out = new Map<string, EquitySubject>();
  const di = (doc: string): number => {
    const i = docIndex.get(doc);
    if (i === undefined) throw new Error(`${doc} is not a Texas snapshot`);
    return i;
  };
  for (const region of regions) {
    const started = Date.now();
    const lo = `fl:parcel:${region}:`;
    const hi = `fl:parcel:${region};`;
    const countySources = d
      .prepare(TX_EQUITY_COUNTY_SOURCES_SQL)
      .all(region.slice(3, 5), region.slice(5, 8))
      .map((r) => String(r.source_id));
    const rowsBy = equityRowsBySubject(
      d.prepare(TX_EQUITY_RANGE_SQL).all(lo, hi),
    );
    const parcels = d
      .prepare(
        "SELECT urn FROM subjects WHERE kind = 'parcel' AND urn >= ? AND urn < ? ORDER BY urn",
      )
      .all(lo, hi)
      .map((r) => String(r.urn));
    const specs = new Map<string, PoolSpec>();
    const pending: [string, EquitySubject][] = [];
    for (const urn of parcels) {
      const rows = rowsBy.get(urn) ?? [];
      const years = equityRollYears(rows);
      const q: EquitySubject = {
        y: [...years.entries()].map(([src, [y, v]]) => [src, y, v]),
        e: [],
      };
      for (const year of [...new Set([...years.values()].map(([y]) => y))]) {
        const rolls = equityRolls(years, year);
        const companions = equityCompanions(countySources, rolls, year);
        const facts = equityYearFacts(rows, rolls, companions);
        const shaped = equityComparable(urn, facts);
        let key: string | null = null;
        if (!equityMissing(shaped).length) {
          const categoryJson = facts.get(
            "parcel.state_property_category",
          )!.value_json;
          key = JSON.stringify([
            region,
            rolls,
            companions,
            categoryJson,
            shaped.tax_year,
          ]);
          if (!specs.has(key))
            specs.set(key, {
              county: region.slice(5, 8),
              region,
              rolls,
              companions,
              categoryJson,
              category: shaped.state_property_category as string,
              taxYear: shaped.tax_year as number,
            });
        }
        q.e.push([
          year,
          rolls,
          companions,
          shaped,
          equityFactDocs(facts).map(di),
          key,
          0,
        ]);
      }
      pending.push([urn, q]);
    }
    // Pools: the comparables of each subject year, as the SDK's pool query selects them.
    const names = new Map<string, string>();
    const members = new Map<string, Set<string>>();
    for (const key of [...specs.keys()].sort()) {
      const spec = specs.get(key)!;
      let name = poolName(region.slice(3), key);
      for (let i = 2; poolNames.has(name); i++)
        name = `${poolName(region.slice(3), key)}-${i}`;
      poolNames.add(name);
      names.set(key, name);
      const h: Omit<PoolHeader, "all" | "buckets"> = {
        u: lo,
        county: spec.county,
        category: spec.category,
        tax_year: spec.taxYear,
        locs: [],
      };
      const rows: EqRow[] = [];
      const inPool = new Set<string>();
      for (const urn of parcels) {
        const prs = rowsBy.get(urn);
        if (
          !prs?.some(
            (r) =>
              r.predicate === "parcel.state_property_category" &&
              r.value_json === spec.categoryJson &&
              spec.rolls.includes(String(r.source_id)),
          )
        )
          continue;
        const facts = equityYearFacts(prs, spec.rolls, spec.companions);
        const c = equityComparable(urn, facts);
        const area = c.improvement_area_sf as number | null;
        // What the rule requires whatever the parameters: the pool's category and tax year, a positive area, a value.
        if (
          c.state_property_category !== spec.category ||
          c.tax_year !== spec.taxYear ||
          area === null ||
          !(area > 0) ||
          c.value === null
        )
          continue;
        const enc = encodeRow(
          lo,
          c,
          equityFactDocs(facts).map(di),
          di,
          m,
          h.locs,
        );
        if (
          JSON.stringify(decodeRow(h as PoolHeader, m, enc)) !==
          JSON.stringify(c)
        )
          throw new Error(
            `${urn}: the encoded comparable does not decode to the SDK's`,
          );
        rows.push(enc);
        inPool.add(urn);
      }
      members.set(key, inPool);
      rows.sort(byArea);
      const write = (path: string, value: unknown) => w.write(path, value);
      const all = buildList(rows, `q/${name}/all`, write);
      const groups = new Map<string, EqRow[]>();
      const add = (g: string, r: EqRow) => {
        const list = groups.get(g);
        if (list) list.push(r);
        else groups.set(g, [r]);
      };
      for (const r of rows) {
        const zip = situsZip5(r[8]);
        if (r[6] !== null) add(`N:${r[6]}`, r);
        if (zip !== null) add(`Z:${zip}`, r);
        if (r[6] !== null && zip !== null) add(`X:${r[6]}\u0000${zip}`, r);
      }
      const dirs = new Set<string>();
      const lists: [string, SortedList][] = [];
      for (const g of [...groups.keys()].sort()) {
        const dir = groupDir(name, g);
        if (dirs.has(dir))
          throw new Error(`pool ${name}: two groups share ${dir}`);
        dirs.add(dir);
        lists.push([
          g,
          buildList(groups.get(g)!, dir, write, g.startsWith("X:")),
        ]);
      }
      const bytes = lists.reduce(
        (a, [g, l]) => a + g.length + JSON.stringify(l).length + 4,
        0,
      );
      const buckets = Math.max(1, Math.ceil(bytes / EQUITY_BUCKET_BYTES));
      const files: Record<string, SortedList>[] = Array.from(
        { length: buckets },
        () => ({}),
      );
      for (const [g, l] of lists) files[groupBucket(g, buckets)]![g] = l;
      files.forEach((f, i) => w.write(`q/${name}/b${i}.json`, f));
      w.write(`q/${name}/h.json`, { ...h, all, buckets } satisfies PoolHeader);
      m.pools += 1;
    }
    for (const [urn, q] of pending) {
      for (const e of q.e)
        if (e[5] !== null) {
          e[6] = members.get(e[5])!.has(urn) ? 1 : 0;
          e[5] = names.get(e[5])!;
        }
      out.set(urn, q);
    }
    log(
      `  ${region}: candidate data for ${parcels.length} parcels in ${specs.size} pools (${Math.round((Date.now() - started) / 1000)} s)`,
    );
  }
  return out;
}

/** Write the entity name index that search.ts reads; rows are in scan order. */
function writeNameIndex(
  w: Writer,
  rows: NameRow[],
  postingMax = NAME_POSTING_MAX,
): Manifest["names"] {
  const posted: PostedRow[] = rows.map(([k, urn, label], i) => {
    const up = upperAscii(k);
    return up === k ? [k, urn, label, i] : [k, urn, label, i, up];
  });
  // Posting lists, in scan order, of every gram that is not too common.
  const lists = new Map<string, PostedRow[]>();
  for (const r of posted)
    for (const g of nameGrams(r[4] ?? r[0])) {
      const list = lists.get(g);
      if (list) list.push(r);
      else lists.set(g, [r]);
    }
  const df: Record<string, number> = {};
  const dict: [string, Posting][] = [];
  const pages = new SharedPages<PostedRow>();
  for (const g of [...lists.keys()].sort()) {
    const list = lists.get(g)!;
    df[g] = list.length;
    if (list.length > postingMax) continue;
    if (list.length <= NAME_INLINE_ROWS) {
      dict.push([g, list]);
      continue;
    }
    dict.push([g, pages.add(list)]);
  }
  pages.write("n/p", NAME_PAGE_ROWS, (path, v) => w.write(path, v));
  w.write("n/df.json", df);
  const bucketed = <T>(prefix: string, entries: [string, T][]): number => {
    const bytes = entries.reduce(
      (a, [k, v]) => a + k.length + JSON.stringify(v).length + 4,
      0,
    );
    const n = Math.max(1, Math.ceil(bytes / NAME_BUCKET_BYTES));
    const groups: Record<string, T>[] = Array.from({ length: n }, () => ({}));
    for (const [k, v] of entries) groups[shardOf(k, n)]![k] = v;
    groups.forEach((g, i) => w.write(`${prefix}/${i}.json`, g));
    return n;
  };
  const gramBuckets = bucketed("n/b", dict);
  // Exact keys: an entity is an exact match for key K when its first row matching K is K itself.
  const byUrn = new Map<string, PostedRow[]>();
  for (const r of posted) {
    const list = byUrn.get(r[1]);
    if (list) list.push(r);
    else byUrn.set(r[1], [r]);
  }
  const exact = new Map<string, ExactNames>();
  for (const r of posted) {
    const k = r[0];
    const needle = upperAscii(k);
    const first = byUrn
      .get(r[1])!
      .find((x) => (x[4] ?? x[0]).includes(needle))!;
    if (first !== r) continue;
    const list = exact.get(k);
    if (list) list.push([r[1], r[2], r[3]]);
    else exact.set(k, [[r[1], r[2], r[3]]]);
  }
  for (const list of exact.values())
    list.sort((a, b) => sqliteCompare(a[1], b[1]) || a[2] - b[2]);
  const exactBuckets = bucketed(
    "n/e",
    [...exact.keys()]
      .sort()
      .map((k) => [k, exact.get(k)!] as [string, ExactNames]),
  );
  // Every row by label, then scan order.
  const byLabel = [...posted].sort(
    (a, b) => sqliteCompare(a[2], b[2]) || a[3] - b[3],
  );
  let chunks = 0;
  for (let i = 0; i < byLabel.length; i += NAME_CHUNK_ROWS)
    w.write(`n/l/${chunks++}.json`, byLabel.slice(i, i + NAME_CHUNK_ROWS));
  return {
    rows: rows.length,
    posting_max: postingMax,
    gram_buckets: gramBuckets,
    exact_buckets: exactBuckets,
    label_chunks: chunks,
  };
}

function meta(d: Db): Map<string, string> {
  return new Map(
    d
      .prepare("SELECT key, value FROM meta")
      .all()
      .map((r) => [String(r.key), String(r.value)]),
  );
}

export interface PackOptions {
  /**
   * 5-digit county FIPS the pack serves nothing of; each needs a reason in hostedWithheldCounties(). Every county
   * of hostedWithheldCounties() is excluded whether or not it is listed here: a pack never serves one.
   */
  excludeCounties?: string[];
  /** Subjects and owner names never served (a removal request); see readSuppression. */
  suppression?: Suppression;
  /**
   * Checks each (filtered) registry file before it is packed and returns what is wrong with it (empty: fine); a
   * finding stops the build. The CLI passes the Python privacy scan (factlot.registry.privacy_scan).
   */
  privacyCheck?: (dbPath: string) => string[];
  /** Where the filtered copies of the files are written (default: next to the pack, "<out>.work"). */
  work?: string;
  /** A file with more entities keeps only those owning a packed parcel (default ENTITY_WHOLE_MAX). */
  entityWholeMax?: number;
  /** The longest name posting list (default NAME_POSTING_MAX); tests lower it to exercise the label-ordered path. */
  namePostingMax?: number;
  /** The most files a pack may hold (default PACK_MAX_FILES, the Workers static-assets limit); tests lower it. */
  maxFiles?: number;
}

/** The checks and the withheld counties every build starts with; returns them with the sorted exclusion list. */
function startBuild(
  sources: PackSource[],
  out: string,
  options: PackOptions,
): { exclude: string[]; withheld: Record<string, string>; target: string } {
  if (!sources.length) throw new Error("no registry files given");
  const reasons = hostedWithheldCounties();
  const exclude = [
    ...new Set([...(options.excludeCounties ?? []), ...Object.keys(reasons)]),
  ].sort();
  const withheld: Record<string, string> = {};
  for (const fips of exclude) {
    if (!/^[0-9]{5}$/.test(fips))
      throw new Error(`--exclude-county ${fips}: give a 5-digit county FIPS`);
    if (!Object.hasOwn(reasons, fips))
      throw new Error(
        `--exclude-county ${fips}: no reason in hostedWithheldCounties() for withholding it`,
      );
    withheld[fips] = reasons[fips]!;
  }
  const names = new Set<string>();
  for (const s of sources) {
    if (!/^[a-z0-9-]+$/.test(s.name))
      throw new Error(`region name "${s.name}": use a-z, 0-9 and -`);
    if (names.has(s.name)) throw new Error(`region "${s.name}" given twice`);
    names.add(s.name);
    if (!existsSync(s.path)) throw new Error(`no such file: ${s.path}`);
  }
  const target = resolve(out);
  if (existsSync(target) && readdirSync(target).length) {
    if (!existsSync(join(target, "manifest.json")))
      throw new Error(
        `${target} is not empty and is not a pack; refusing to replace it`,
      );
  }
  return { exclude, withheld, target };
}

/** The file a region is packed from: filtered (withheld counties, entity scope, suppression) and privacy-checked. */
function prepareSource(
  s: PackSource,
  work: string,
  exclude: string[],
  options: PackOptions,
  log: (line: string) => void,
): { source: PackSource; entityScope: Manifest["entity_scope"] } {
  const f = filterRegistry(
    s.path,
    join(work, `${s.name}.db`),
    exclude,
    options.entityWholeMax,
    options.suppression,
  );
  const problems = options.privacyCheck?.(f.path) ?? [];
  if (problems.length)
    throw new Error(
      `${s.name}: the privacy scan refused ${f.path}:\n  ${problems.join("\n  ")}\n` +
        "Run python3 -m factlot.registry.maintain <db> --purge-persons on the source file, then pack again.",
    );
  if (f.suppressed.entities || f.suppressed.parcel_owners)
    log(
      `${s.name}: suppressed ${f.suppressed.entities} entities and the owner facts of ${f.suppressed.parcel_owners} parcels`,
    );
  if (f.path !== s.path)
    log(
      `${s.name}: filtered copy ${f.path} (${f.parcels_dropped} parcels and ${f.buildings_dropped} buildings withheld; entities: ${
        Object.entries(f.entity_scope)
          .map(([j, e]) => `${j} ${e.served} of ${e.total}`)
          .join(", ") || "all"
      })`,
    );
  return {
    source: { name: s.name, path: f.path },
    entityScope: f.entity_scope,
  };
}

/** Texas candidate state shared by the regions of one build process. */
interface EquityState {
  equity: EquityManifest;
  docIndex: Map<string, number>;
  poolNames: Set<string>;
}

const newEquityState = (): EquityState => ({
  equity: { docs: [], pools: 0 },
  docIndex: new Map(),
  poolNames: new Set(),
});

/** What one region adds to the pack besides its record shards and candidate pools (which it writes itself). */
export interface RegionPart {
  db: PackDb;
  coverage: RegistryCoverage;
  name_key_version: string | null;
  address_key_version: string | null;
  /** Subject prefixes ("fl:parcel:us-24005"), in the order of the file's sorted subjects. */
  prefixes: string[];
  /** Parcels of Texas counties (with candidate data). */
  texas_parcels: number;
  /** The candidate source documents this region added, in index order, and the pools it wrote. */
  equity_docs: EquityManifest["docs"];
  equity_pools: number;
  crosswalk: [string, string][];
  address_rows: AddressRow[];
  name_rows: NameRow[];
}

/** Writes one region's record shards (g/<k>/) and, for Texas counties, its candidate pools (q/). */
function buildRegion(
  src: PackSource,
  k: number,
  w: Writer,
  eqs: EquityState,
  log: (line: string) => void,
  maxFiles: number,
): RegionPart {
  const d = new DatabaseSync(src.path, { readOnly: true });
  try {
    const m = meta(d);
    const nv = m.get("name_key_version") ?? null;
    const av = m.get("address_key_version") ?? null;
    if (av !== "2")
      throw new Error(
        `${src.name}: address_key_version is ${av ?? "unset"}; re-key the file (python -m factlot.registry.maintain <file> --all) before packing`,
      );
    const dates = d
      .prepare(
        "SELECT as_of FROM facts UNION SELECT as_of FROM coverage UNION SELECT as_of FROM relationships ORDER BY 1",
      )
      .all()
      .map((r) => String(r.as_of));
    if (dates.length && dates[0]! <= BEFORE)
      throw new Error(`${src.name}: a date before ${BEFORE}`);
    configureRegistry(src.path);
    const cov = computeRegistryCoverage();
    let texas = 0;
    for (const c of cov.counties) if (c.state_fips === "48") texas += c.parcels;
    const texasRegions = cov.counties
      .filter((c) => c.state_fips === "48")
      .map((c) => c.region);
    const docsBefore = eqs.equity.docs.length;
    const poolsBefore = eqs.equity.pools;
    let eq: Map<string, EquitySubject> | undefined;
    if (texasRegions.length) {
      for (const [doc, entry] of texasDocs(d))
        if (!eqs.docIndex.has(doc)) {
          eqs.docIndex.set(doc, eqs.equity.docs.length);
          eqs.equity.docs.push([doc, entry]);
        }
      eq = buildEquity(
        d,
        texasRegions,
        w,
        eqs.equity,
        eqs.docIndex,
        eqs.poolNames,
        log,
      );
    }
    const subjects = d
      .prepare("SELECT urn, kind FROM subjects ORDER BY urn")
      .all()
      .map((r) => [String(r.urn), String(r.kind)] as [string, string]);
    const prefixes: string[] = [];
    let last: string | undefined;
    const seen = new Set<string>();
    for (const [urn] of subjects) {
      const p = urnPrefix(urn);
      if (p === last) continue;
      last = p;
      if (!seen.has(p)) {
        seen.add(p);
        prefixes.push(p);
      }
    }
    // Size the shards from a sample encoded together.
    const sample = new ShardEncoder();
    const step = Math.max(1, Math.floor(subjects.length / 150));
    let sampled = 0;
    for (let i = 0; i < subjects.length; i += step) {
      const [urn, kind] = subjects[i]!;
      sample.add(urn, subjectEntry(urn, kind, k, dates, eq?.get(urn)).entry);
      sampled += 1;
    }
    const perSubject = sampled
      ? JSON.stringify(sample.encode()).length / sampled
      : 0;
    const shards = Math.max(
      1,
      Math.ceil((subjects.length * perSubject) / SHARD_TARGET_BYTES),
    );
    // Stop now rather than hours later: the Worker cannot serve a pack over the static-assets file limit.
    if (w.files + shards > maxFiles)
      throw new Error(
        `${src.name}: ${shards} record shards would take the pack past ${maxFiles} files (${w.files} written so far); a Worker version cannot hold it`,
      );
    const groups: [string, string][][] = Array.from(
      { length: shards },
      () => [],
    );
    for (const s of subjects) groups[shardOf(s[0], shards)]!.push(s);
    const started = Date.now();
    groups.forEach((group, g) => {
      const enc = new ShardEncoder();
      const checks: [
        string,
        GetEntry,
        [boolean, string | undefined, string][],
      ][] = [];
      for (const [urn, kind] of group) {
        const { entry, expect } = subjectEntry(
          urn,
          kind,
          k,
          dates,
          eq?.get(urn),
        );
        enc.add(urn, entry);
        checks.push([urn, entry, expect]);
      }
      const shard = enc.encode();
      const parsed = JSON.parse(JSON.stringify(shard)) as typeof shard;
      for (const [urn, entry, expect] of checks) {
        const back = decodeEntry(parsed, urn) as GetEntry;
        if (!same(back, entry))
          throw new Error(`${urn}: the shard does not decode to its entry`);
        checkEntry(urn, back, dates, expect);
      }
      w.write(`g/${k}/${g}.json`, shard);
      if (g % 200 === 199)
        log(
          `  ${src.name}: ${g + 1}/${shards} record shards (${Math.round((Date.now() - started) / 1000)} s)`,
        );
    });
    const crosswalk: [string, string][] = d
      .prepare("SELECT system, external_id, urn FROM crosswalk")
      .all()
      .map((r) => [
        JSON.stringify([String(r.system), String(r.external_id)]),
        String(r.urn),
      ]);
    const addressRows: AddressRow[] = d
      .prepare(
        "SELECT a.key, a.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn",
      )
      .all()
      .map((r) => [
        String(r.urn),
        r.label === null ? null : String(r.label),
        String(r.key),
      ]);
    // The scan order of registrySearchEntities' query plan (SCAN name_index, then the subject by URN).
    const nameRows: NameRow[] = d
      .prepare(
        "SELECT n.key, n.urn, s.label FROM name_index n JOIN subjects s ON s.urn = n.urn WHERE s.kind = 'entity' ORDER BY n.rowid",
      )
      .all()
      .map((r) => [
        String(r.key),
        String(r.urn),
        r.label === null ? null : String(r.label),
      ]);
    const kinds: Record<string, number> = {};
    for (const [, x] of subjects) kinds[x] = (kinds[x] ?? 0) + 1;
    log(
      `${src.name}: ${subjects.length} subjects in ${shards} shards, ${dates.length} dates (${Math.round((Date.now() - started) / 1000)} s)`,
    );
    return {
      db: {
        name: src.name,
        parcel_rule: m.get("parcel_rule") ?? null,
        dates,
        shards,
        parcels: kinds.parcel ?? 0,
        entities: kinds.entity ?? 0,
        buildings: kinds.building ?? 0,
        subjects: subjects.length,
      },
      coverage: cov,
      name_key_version: nv,
      address_key_version: av,
      prefixes,
      texas_parcels: texas,
      equity_docs: eqs.equity.docs.slice(docsBefore),
      equity_pools: eqs.equity.pools - poolsBefore,
      crosswalk,
      address_rows: addressRows,
      name_rows: nameRows,
    };
  } finally {
    d.close();
    configureRegistry(undefined);
  }
}

/** The regions of a build so far, combined in the order the files were given. */
class Combined {
  readonly dbs: PackDb[] = [];
  readonly covs: RegistryCoverage[] = [];
  readonly prefixes: Record<string, number> = {};
  readonly counties: Record<string, number> = {};
  readonly crosswalk = new Map<string, string>();
  readonly addressRows: AddressRow[] = [];
  readonly nameRows: NameRow[] = [];
  readonly entityScope: Manifest["entity_scope"] = {};
  readonly equity: EquityManifest = { docs: [], pools: 0 };
  nameVersion: string | null | undefined;
  addressVersion: string | null | undefined;
  texas = 0;

  addScope(scope: Manifest["entity_scope"]): void {
    for (const [j, e] of Object.entries(scope)) {
      if (Object.hasOwn(this.entityScope, j))
        throw new Error(`entity registry ${j} is in two files`);
      this.entityScope[j] = e;
    }
  }

  /**
   * Add region k. `sharedEquity`: the part's candidate documents are already in this.equity (one process built
   * every region with one EquityState); otherwise they are this part's own, indexed from 0.
   */
  add(k: number, part: RegionPart, sharedEquity: boolean): void {
    const name = part.db.name;
    if (k !== this.dbs.length) throw new Error(`region ${name} out of order`);
    if (
      this.nameVersion !== undefined &&
      this.nameVersion !== part.name_key_version
    )
      throw new Error(`${name}: name_key_version differs from the other files`);
    this.nameVersion = part.name_key_version;
    this.addressVersion = part.address_key_version;
    this.covs.push(part.coverage);
    for (const c of part.coverage.counties) {
      if (Object.hasOwn(this.counties, c.region))
        throw new Error(`${name}: county ${c.region} is in two files`);
      this.counties[c.region] = k;
    }
    this.texas += part.texas_parcels;
    if (!sharedEquity && part.equity_docs.length) {
      if (this.equity.docs.length)
        throw new Error(
          `${name}: Texas candidate data in more than one file; build them in one process (--jobs 1)`,
        );
      this.equity.docs.push(...part.equity_docs);
    }
    if (!sharedEquity) this.equity.pools += part.equity_pools;
    for (const p of part.prefixes) {
      if (Object.hasOwn(this.prefixes, p) && this.prefixes[p] !== k)
        throw new Error(`${name}: subjects under ${p} are in two files`);
      this.prefixes[p] = k;
    }
    for (const [key, urn] of part.crosswalk) {
      if (this.crosswalk.has(key))
        throw new Error(`${name}: crosswalk ID ${key} is in two files`);
      this.crosswalk.set(key, urn);
    }
    for (const r of part.address_rows) this.addressRows.push(r);
    for (const r of part.name_rows) this.nameRows.push(r);
    this.dbs.push(part.db);
  }
}

/** Writes the indexes that span regions (crosswalk, addresses, names) and the manifest. */
function finishPack(
  c: Combined,
  w: Writer,
  withheld: Record<string, string>,
  log: (line: string) => void,
  options: PackOptions,
): Manifest {
  if (c.texas)
    log(
      `${c.texas} Texas parcels with candidate data in ${c.equity.pools} pools`,
    );
  const { crosswalk, addressRows, nameRows } = c;

  // Crosswalk shards.
  const xBytes = [...crosswalk].reduce(
    (a, [k, v]) => a + k.length + v.length + 6,
    0,
  );
  const xShards = Math.max(1, Math.ceil(xBytes / SHARD_TARGET_BYTES));
  const xGroups: Record<string, string>[] = Array.from(
    { length: xShards },
    () => ({}),
  );
  for (const [key, urn] of crosswalk)
    xGroups[shardOf(key, xShards)]![key] = urn;
  xGroups.forEach((g, i) => w.write(`x/${i}.json`, g));

  // Address lists, sorted by label then URN (then key) as the search orders them.
  addressRows.sort(
    (a, b) =>
      sqliteCompare(a[1], b[1]) ||
      sqliteCompare(a[0], b[0]) ||
      sqliteCompare(a[2], b[2]),
  );
  const lists = new Map<string, AddressRow[]>();
  const exact = new Map<string, ExactList>();
  const add = (key: string, row: AddressRow) => {
    const list = lists.get(key);
    if (list) list.push(row);
    else lists.set(key, [row]);
  };
  for (const row of addressRows) {
    const t = upperAscii(row[2]).split(" ");
    const keys = new Set<string>();
    if (t[0]) keys.add(`F:${t[0]}`);
    t.forEach((x, j) => {
      if (!ADDRESS_STREET_TYPES.has(x)) return;
      keys.add(`U:${x}`);
      if (j > 0 && t[j - 1]) keys.add(`B:${t[j - 1]} ${x}`);
      if (j + 1 < t.length && t[j + 1]) keys.add(`A:${x} ${t[j + 1]}`);
    });
    for (const key of keys) add(key, row);
    const e = exact.get(row[2]);
    if (!e) exact.set(row[2], [[row[0], row[1]]]);
    else if (e[e.length - 1]![0] !== row[0]) e.push([row[0], row[1]]);
  }
  // A one-word street query matches every row of its U list, so only the first MAX_LIMIT URNs (besides the
  // exact ones) can be returned.
  for (const [key, rows] of lists) {
    if (!key.startsWith("U:")) continue;
    const skip = new Set((exact.get(key.slice(2)) ?? []).map(([u]) => u));
    const urns = new Set<string>();
    let n = 0;
    for (; n < rows.length; n++) {
      const urn = rows[n]![0];
      if (skip.has(urn) || urns.has(urn)) continue;
      if (urns.size === MAX_LIMIT) break;
      urns.add(urn);
    }
    lists.set(key, rows.slice(0, n));
  }
  const dict: [string, unknown][] = [];
  const pages = new SharedPages<AddressRow>();
  for (const [key, rows] of lists) {
    if (rows.length <= INLINE_ROWS) {
      dict.push([key, rows]);
      continue;
    }
    dict.push([key, pages.add(rows)]);
  }
  pages.write("a/p", PAGE_ROWS, (path, v) => w.write(path, v));
  for (const [key, list] of exact) dict.push([`E:${key}`, list]);
  const aBytes = dict.reduce(
    (a, [k, v]) => a + k.length + JSON.stringify(v).length + 4,
    0,
  );
  const aShards = Math.max(1, Math.ceil(aBytes / SHARD_TARGET_BYTES));
  const aGroups: Record<string, unknown>[] = Array.from(
    { length: aShards },
    () => ({}),
  );
  for (const [key, v] of dict) aGroups[shardOf(key, aShards)]![key] = v;
  aGroups.forEach((g, i) => w.write(`a/${i}.json`, g));

  // Entity name index.
  const names = writeNameIndex(w, nameRows, options.namePostingMax);

  const coverage = mergeCoverage(c.covs);
  const versions = {
    name_key_version: c.nameVersion ?? null,
    address_key_version: c.addressVersion ?? null,
  };
  const partial = partialCounties(coverage);
  const manifest: Manifest = {
    format: PACK_FORMAT,
    built_at: new Date().toISOString(),
    dbs: c.dbs,
    prefixes: c.prefixes,
    counties: c.counties,
    versions,
    coverage,
    coverage_result: hostedCoverageResult(
      {
        withheld,
        entity_scope: c.entityScope,
        partial_counties: partial,
      },
      coverage,
      coverageReport(coverage, versions),
    ),
    crosswalk_shards: xShards,
    address_shards: aShards,
    names,
    withheld,
    entity_scope: c.entityScope,
    ...(Object.keys(partial).length ? { partial_counties: partial } : {}),
    equity: c.equity.docs.length ? c.equity : null,
    counts: {
      parcels: coverage.totals.parcels,
      entities: coverage.totals.entities,
      buildings: coverage.totals.buildings,
      subjects: c.dbs.reduce((a, d) => a + d.subjects, 0),
      crosswalk_ids: crosswalk.size,
      address_rows: addressRows.length,
      entity_names: nameRows.length,
    },
  };
  w.write("manifest.json", manifest);
  const maxFiles = options.maxFiles ?? PACK_MAX_FILES;
  if (w.files > maxFiles)
    throw new Error(
      `the pack holds ${w.files} files, more than the ${maxFiles} a Worker version may hold`,
    );
  if (w.largest.bytes > PACK_MAX_FILE_BYTES)
    throw new Error(
      `${w.largest.path} is ${w.largest.bytes} bytes, over the static-assets limit of ${PACK_MAX_FILE_BYTES}`,
    );
  return manifest;
}

export function buildPack(
  sources: PackSource[],
  out: string,
  log: (line: string) => void = () => {},
  options: PackOptions = {},
): PackStats {
  const { exclude, withheld, target } = startBuild(sources, out, options);
  const tmp = `${target}.building-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  const w = new Writer(tmp);
  const work = resolve(options.work ?? `${target}.work`);
  const c = new Combined();
  const eqs = newEquityState();
  const prepared = sources.map((s) => {
    const p = prepareSource(s, work, exclude, options, log);
    c.addScope(p.entityScope);
    return p.source;
  });
  try {
    prepared.forEach((src, k) => {
      const part = buildRegion(
        src,
        k,
        w,
        eqs,
        log,
        options.maxFiles ?? PACK_MAX_FILES,
      );
      c.add(k, part, true);
    });
    c.equity.docs.push(...eqs.equity.docs);
    c.equity.pools = eqs.equity.pools;
    const manifest = finishPack(c, w, withheld, log, options);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(tmp, target);
    return { files: w.files, bytes: w.bytes, largest: w.largest, manifest };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// --- parallel builds ---------------------------------------------------------------------------
//
// With --jobs N, each region (registry file) is filtered, checked and packed by its own process into
// <out>.parts/<k>/: its record shards g/<k>/ and candidate pools q/ (the same files a single-process build
// writes, since both depend only on the region and its index k), and part.json with everything the
// cross-region indexes and the manifest need. The parent then moves those files into the pack and writes the
// crosswalk, address and name indexes and the manifest exactly as a single-process build does, so the two
// builds give the same files (the manifest differs only in built_at). Candidate data indexes its source
// documents across the pack, so at most one file may hold Texas parcels in a parallel build.

/** One region job of a parallel build (the --build-part argument). */
interface PartJob {
  name: string;
  path: string;
  k: number;
  /** The part directory: files/ (pack files) and part.json. */
  dir: string;
  work: string;
  exclude: string[];
  entityWholeMax?: number;
  suppression?: Suppression;
  privacyScan: boolean;
  maxFiles?: number;
}

interface PartResult {
  part: RegionPart;
  entity_scope: Manifest["entity_scope"];
  files: number;
  bytes: number;
  largest: { path: string; bytes: number };
}

/** A big JSON value written as one line per element, so no single string is too long for V8. */
function writeJsonLines(path: string, head: unknown, rows: unknown[][]): void {
  const fd = openSync(path, "w");
  try {
    writeSync(fd, `${JSON.stringify(head)}\n`);
    for (const list of rows) {
      writeSync(fd, `${list.length}\n`);
      let buf = "";
      for (const r of list) {
        buf += `${JSON.stringify(r)}\n`;
        if (buf.length > 1 << 20) {
          writeSync(fd, buf);
          buf = "";
        }
      }
      if (buf) writeSync(fd, buf);
    }
  } finally {
    closeSync(fd);
  }
}

function readJsonLines(path: string, lists: number): [unknown, unknown[][]] {
  const lines = readFileSync(path, "utf8").split("\n");
  let i = 0;
  const head = JSON.parse(lines[i++]!) as unknown;
  const out: unknown[][] = [];
  for (let l = 0; l < lists; l++) {
    const n = Number(lines[i++]);
    const list: unknown[] = new Array(n);
    for (let j = 0; j < n; j++) list[j] = JSON.parse(lines[i++]!);
    out.push(list);
  }
  return [head, out];
}

/** Child process: build one region of a parallel build into its part directory. */
export function buildPart(job: PartJob, log: (line: string) => void): void {
  rmSync(job.dir, { recursive: true, force: true });
  const w = new Writer(join(job.dir, "files"));
  const options: PackOptions = {
    entityWholeMax: job.entityWholeMax,
    suppression: job.suppression,
    privacyCheck: job.privacyScan ? pythonPrivacyScan : undefined,
  };
  const { source, entityScope } = prepareSource(
    { name: job.name, path: job.path },
    job.work,
    job.exclude,
    options,
    log,
  );
  const part = buildRegion(
    source,
    job.k,
    w,
    newEquityState(),
    log,
    job.maxFiles ?? PACK_MAX_FILES,
  );
  const { crosswalk, address_rows, name_rows, ...rest } = part;
  const head: Omit<PartResult, "part"> & {
    part: Omit<RegionPart, "crosswalk" | "address_rows" | "name_rows">;
  } = {
    part: rest,
    entity_scope: entityScope,
    files: w.files,
    bytes: w.bytes,
    largest: w.largest,
  };
  writeJsonLines(join(job.dir, "part.jsonl"), head, [
    crosswalk,
    address_rows,
    name_rows,
  ]);
}

function readPart(dir: string): PartResult {
  const [head, [crosswalk, address_rows, name_rows]] = readJsonLines(
    join(dir, "part.jsonl"),
    3,
  ) as [Omit<PartResult, "part"> & { part: RegionPart }, unknown[][]];
  return {
    ...head,
    part: {
      ...head.part,
      crosswalk: crosswalk as [string, string][],
      address_rows: address_rows as AddressRow[],
      name_rows: name_rows as NameRow[],
    },
  };
}

/** Whether a registry file holds any Texas parcel (a quick probe of the subjects' URN index). */
function holdsTexas(path: string): boolean {
  const d = new DatabaseSync(path, { readOnly: true });
  try {
    return (
      d
        .prepare(
          "SELECT 1 AS x FROM subjects WHERE urn >= 'fl:parcel:us-48' AND urn < 'fl:parcel:us-49' LIMIT 1",
        )
        .get() !== undefined
    );
  } finally {
    d.close();
  }
}

export interface ParallelOptions extends Omit<PackOptions, "privacyCheck"> {
  /** Processes at once (default: one per file). */
  jobs?: number;
  /** Run the Python privacy scan on each filtered file (the CLI does unless --skip-privacy-scan). */
  privacyScan?: boolean;
}

/**
 * buildPack with each region in its own process (see "parallel builds" above); the same pack. Rejects files that
 * one process must build together (Texas parcels in more than one file).
 */
export async function buildPackParallel(
  sources: PackSource[],
  out: string,
  log: (line: string) => void = () => {},
  options: ParallelOptions = {},
): Promise<PackStats> {
  const { exclude, withheld, target } = startBuild(sources, out, options);
  const texasFiles = sources.filter((s) => holdsTexas(s.path));
  if (texasFiles.length > 1)
    throw new Error(
      `Texas parcels are in ${texasFiles.map((s) => s.name).join(" and ")}: candidate data spans them, so build without --jobs`,
    );
  const tmp = `${target}.building-${process.pid}`;
  const partsDir = `${target}.parts`;
  rmSync(tmp, { recursive: true, force: true });
  rmSync(partsDir, { recursive: true, force: true });
  const work = resolve(options.work ?? `${target}.work`);
  const jobs = sources.map((s, k): PartJob => ({
    name: s.name,
    path: s.path,
    k,
    dir: join(partsDir, String(k)),
    work,
    exclude,
    entityWholeMax: options.entityWholeMax,
    suppression: options.suppression,
    privacyScan: options.privacyScan ?? false,
    maxFiles: options.maxFiles,
  }));
  const script = fileURLToPath(import.meta.url);
  const runJob = (job: PartJob): Promise<void> =>
    new Promise((ok, fail) => {
      mkdirSync(job.dir, { recursive: true });
      const jobFile = join(partsDir, `${job.k}.job.json`);
      writeFileSync(jobFile, JSON.stringify(job));
      const child = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--conditions=factlot-source",
          "--disable-warning=ExperimentalWarning",
          script,
          "--build-part",
          jobFile,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let errText = "";
      let pending = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop()!;
        for (const l of lines) log(l);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        errText = (errText + chunk).slice(-4000);
      });
      child.on("error", fail);
      child.on("close", (code) => {
        if (pending) log(pending);
        if (code === 0) ok();
        else
          fail(
            new Error(
              `region ${job.name} (process exit ${code}): ${errText.trim()}`,
            ),
          );
      });
    });
  const limit = Math.max(1, Math.min(options.jobs ?? jobs.length, jobs.length));
  try {
    const queue = [...jobs];
    let failed: unknown;
    await Promise.all(
      Array.from({ length: limit }, async () => {
        for (let job = queue.shift(); job && !failed; job = queue.shift())
          await runJob(job).catch((err: unknown) => {
            failed ??= err;
          });
      }),
    );
    if (failed) throw failed;
    const w = new Writer(tmp);
    const c = new Combined();
    jobs.forEach((job) => {
      const r = readPart(job.dir);
      c.addScope(r.entity_scope);
      c.add(job.k, r.part, false);
      // The part's files, moved into the pack under the same paths.
      const files = join(job.dir, "files");
      for (const top of existsSync(files) ? readdirSync(files) : []) {
        const from = join(files, top);
        if (top === "g") {
          mkdirSync(join(tmp, "g"), { recursive: true });
          renameSync(join(from, String(job.k)), join(tmp, "g", String(job.k)));
        } else if (top === "q") {
          mkdirSync(join(tmp, "q"), { recursive: true });
          for (const pool of readdirSync(from)) {
            if (existsSync(join(tmp, "q", pool)))
              throw new Error(`pool ${pool} is in two regions`);
            renameSync(join(from, pool), join(tmp, "q", pool));
          }
        } else throw new Error(`region ${job.name} wrote ${top}/`);
      }
      w.files += r.files;
      w.bytes += r.bytes;
      if (r.largest.bytes > w.largest.bytes) w.largest = r.largest;
    });
    const manifest = finishPack(c, w, withheld, log, options);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(tmp, target);
    rmSync(partsDir, { recursive: true, force: true });
    return { files: w.files, bytes: w.bytes, largest: w.largest, manifest };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * The Python privacy scan of a registry file (python -m factlot.registry.privacy_scan): owner facts the person
 * rule reads as natural persons, and mailing addresses of owners and entities whose names read as a person's or a
 * family's. The rules live in Python (normalize.py), where ingest applies them, so the pack uses the same code.
 */
export function pythonPrivacyScan(dbPath: string): string[] {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const r = spawnSync(
    "python3",
    ["-m", "factlot.registry.privacy_scan", "--json", dbPath],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: join(root, "python/src") },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (r.error || (r.status !== 0 && r.status !== 1))
    return [
      `the privacy scan did not run (${r.error?.message ?? `exit ${r.status}: ${r.stderr.trim().slice(0, 300)}`}); pass --skip-privacy-scan only if you know why`,
    ];
  const report = JSON.parse(r.stdout) as { problems: string[] };
  return report.problems;
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === "--build-part") {
    const job = JSON.parse(readFileSync(argv[1]!, "utf8")) as PartJob;
    buildPart(job, (l) => console.log(l));
    return;
  }
  let out: string | undefined;
  let work: string | undefined;
  let jobs = 1;
  const excludeCounties: string[] = [];
  const sources: PackSource[] = [];
  let suppress: string | undefined;
  let privacyScan = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") out = argv[++i];
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--exclude-county") excludeCounties.push(argv[++i] ?? "");
    else if (a === "--suppress") suppress = argv[++i];
    else if (a === "--skip-privacy-scan") privacyScan = false;
    else if (a === "--work") work = argv[++i];
    else if (a === "--jobs") jobs = Number(argv[++i]);
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else {
      const eq = a.indexOf("=");
      const path = eq > 0 ? a.slice(eq + 1) : a;
      const name =
        eq > 0 ? a.slice(0, eq) : basename(path).replace(/\.db$/, "");
      sources.push({ name, path: resolve(path) });
    }
  }
  if (!out || !sources.length || !Number.isInteger(jobs) || jobs < 1) {
    console.error(
      "usage: node scripts/registry/pack.ts --out <dir> [--jobs <n>] [--exclude-county <5-digit FIPS>]... [--suppress <file>] [--work <dir>] [--skip-privacy-scan] <db | name=db>...",
    );
    process.exit(2);
  }
  const started = Date.now();
  if (!privacyScan)
    console.warn(
      "pack: --skip-privacy-scan: the files are packed without the person and home-address check",
    );
  const suppression = suppress ? readSuppression(resolve(suppress)) : undefined;
  const log = (l: string) => console.log(l);
  const stats =
    jobs > 1
      ? await buildPackParallel(sources, out, log, {
          excludeCounties,
          work,
          suppression,
          privacyScan,
          jobs,
        })
      : buildPack(sources, out, log, {
          excludeCounties,
          work,
          suppression,
          privacyCheck: privacyScan ? pythonPrivacyScan : undefined,
        });
  console.log(
    `pack: ${stats.files} files, ${(stats.bytes / 1048576).toFixed(1)} MiB, largest ${stats.largest.path} ${(stats.largest.bytes / 1024).toFixed(1)} KiB, regions ${stats.manifest.dbs.map((d) => d.name).join(", ")} (${Math.round((Date.now() - started) / 1000)} s)`,
  );
  console.log(`written to ${resolve(out)}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
