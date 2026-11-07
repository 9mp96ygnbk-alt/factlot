/**
 * Build the hosted registry pack: the files the factlot-registry Worker (deploy/registry) answers from.
 *
 *   node --experimental-strip-types --conditions=factlot-source scripts/registry/pack.ts --out <dir> <db>...
 *
 * Each <db> is a registry SQLite file, named by its basename ("md.db" is region "md") or given as name=path. The
 * files must hold disjoint regions. Records, history, dated records and ownership are made by the SDK itself
 * (configureRegistry + runTool on each file) and checked back after encoding; searches get indexes that follow the
 * SQL in packages/tools/src/registry.ts. The pack holds registry data: keep it out of git and never publish it.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADDRESS_STREET_TYPES,
  computeRegistryCoverage,
  configureRegistry,
  coverageReport,
  mergeCoverage,
  runTool,
  type RegistryCoverage,
} from "../../packages/tools/src/index.ts";
import {
  INLINE_ROWS,
  MAX_LIMIT,
  NAME_CHUNK_ROWS,
  PACK_FORMAT,
  PAGE_ROWS,
  SHARD_TARGET_BYTES,
  ShardEncoder,
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
import type {
  AddressRow,
  ExactList,
  NameRow,
} from "../../deploy/registry/src/search.ts";

type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): {
    get(...p: unknown[]): Row | undefined;
    all(...p: unknown[]): Row[];
  };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => Db;
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
): { entry: GetEntry; expect: [boolean, string | undefined, string][] } {
  const base = ok("registry_get", { urn, include_history: true });
  const rec = withoutKeys(base, "history");
  const hist = base.history as unknown[];
  const entry: GetEntry = { k: dbIndex, r: rec, v: [] };
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

function meta(d: Db): Map<string, string> {
  return new Map(
    d
      .prepare("SELECT key, value FROM meta")
      .all()
      .map((r) => [String(r.key), String(r.value)]),
  );
}

export function buildPack(
  sources: PackSource[],
  out: string,
  log: (line: string) => void = () => {},
): PackStats {
  if (!sources.length) throw new Error("no registry files given");
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
  const tmp = `${target}.building-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  const w = new Writer(tmp);

  const dbs: PackDb[] = [];
  const covs: RegistryCoverage[] = [];
  const prefixes: Record<string, number> = {};
  const counties: Record<string, number> = {};
  const crosswalk = new Map<string, string>();
  const addressRows: AddressRow[] = [];
  const nameRows: NameRow[] = [];
  let nameVersion: string | null | undefined;
  let addressVersion: string | null | undefined;
  let texas = 0;

  try {
    sources.forEach((src, k) => {
      const d = new DatabaseSync(src.path, { readOnly: true });
      try {
        const m = meta(d);
        const nv = m.get("name_key_version") ?? null;
        const av = m.get("address_key_version") ?? null;
        if (av !== "2")
          throw new Error(
            `${src.name}: address_key_version is ${av ?? "unset"}; re-key the file (python -m factlot.registry.maintain <file> --all) before packing`,
          );
        if (nameVersion !== undefined && nameVersion !== nv)
          throw new Error(
            `${src.name}: name_key_version differs from the other files`,
          );
        nameVersion = nv;
        addressVersion = av;
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
        covs.push(cov);
        for (const c of cov.counties) {
          if (Object.hasOwn(counties, c.region))
            throw new Error(`${src.name}: county ${c.region} is in two files`);
          counties[c.region] = k;
          if (c.state_fips === "48") texas += c.parcels;
        }
        const subjects = d
          .prepare("SELECT urn, kind FROM subjects ORDER BY urn")
          .all()
          .map((r) => [String(r.urn), String(r.kind)] as [string, string]);
        for (const [urn] of subjects) {
          const p = urnPrefix(urn);
          if (Object.hasOwn(prefixes, p) && prefixes[p] !== k)
            throw new Error(
              `${src.name}: subjects under ${p} are in two files`,
            );
          prefixes[p] = k;
        }
        // Size the shards from a sample encoded together.
        const sample = new ShardEncoder();
        const step = Math.max(1, Math.floor(subjects.length / 150));
        let sampled = 0;
        for (let i = 0; i < subjects.length; i += step) {
          const [urn, kind] = subjects[i]!;
          sample.add(urn, subjectEntry(urn, kind, k, dates).entry);
          sampled += 1;
        }
        const perSubject = sampled
          ? JSON.stringify(sample.encode()).length / sampled
          : 0;
        const shards = Math.max(
          1,
          Math.ceil((subjects.length * perSubject) / SHARD_TARGET_BYTES),
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
            const { entry, expect } = subjectEntry(urn, kind, k, dates);
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
        for (const r of d
          .prepare("SELECT system, external_id, urn FROM crosswalk")
          .all()) {
          const key = JSON.stringify([String(r.system), String(r.external_id)]);
          if (crosswalk.has(key))
            throw new Error(`${src.name}: crosswalk ID ${key} is in two files`);
          crosswalk.set(key, String(r.urn));
        }
        for (const r of d
          .prepare(
            "SELECT a.key, a.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn",
          )
          .all())
          addressRows.push([
            String(r.urn),
            r.label === null ? null : String(r.label),
            String(r.key),
          ]);
        // The scan order of registrySearchEntities' query plan (SCAN name_index, then the subject by URN).
        for (const r of d
          .prepare(
            "SELECT n.key, n.urn, s.label FROM name_index n JOIN subjects s ON s.urn = n.urn WHERE s.kind = 'entity' ORDER BY n.rowid",
          )
          .all())
          nameRows.push([
            String(r.key),
            String(r.urn),
            r.label === null ? null : String(r.label),
          ]);
        const kinds = (kind: string) =>
          subjects.filter(([, x]) => x === kind).length;
        dbs.push({
          name: src.name,
          parcel_rule: m.get("parcel_rule") ?? null,
          dates,
          shards,
          parcels: kinds("parcel"),
          entities: kinds("entity"),
          buildings: kinds("building"),
          subjects: subjects.length,
        });
        log(
          `${src.name}: ${subjects.length} subjects in ${shards} shards, ${dates.length} dates (${Math.round((Date.now() - started) / 1000)} s)`,
        );
      } finally {
        d.close();
        configureRegistry(undefined);
      }
    });
    if (texas)
      log(
        `note: ${texas} Texas parcels; registry_tx_equity_candidates answers RegistryUnavailable for them`,
      );

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
    let page = 0;
    for (const [key, rows] of lists) {
      if (rows.length <= INLINE_ROWS) {
        dict.push([key, rows]);
        continue;
      }
      const p: number[] = [];
      for (let i = 0; i < rows.length; i += PAGE_ROWS) {
        w.write(`a/p/${page}.json`, rows.slice(i, i + PAGE_ROWS));
        p.push(page++);
      }
      dict.push([key, { n: rows.length, p }]);
    }
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

    // Entity name rows in scan order.
    let chunks = 0;
    for (let i = 0; i < nameRows.length; i += NAME_CHUNK_ROWS)
      w.write(`n/${chunks++}.json`, nameRows.slice(i, i + NAME_CHUNK_ROWS));

    const coverage = mergeCoverage(covs);
    const versions = {
      name_key_version: nameVersion ?? null,
      address_key_version: addressVersion ?? null,
    };
    const manifest: Manifest = {
      format: PACK_FORMAT,
      built_at: new Date().toISOString(),
      dbs,
      prefixes,
      counties,
      versions,
      coverage,
      coverage_result: coverageReport(coverage, versions),
      crosswalk_shards: xShards,
      address_shards: aShards,
      name_chunks: chunks,
      counts: {
        parcels: coverage.totals.parcels,
        entities: coverage.totals.entities,
        buildings: coverage.totals.buildings,
        subjects: dbs.reduce((a, d) => a + d.subjects, 0),
        crosswalk_ids: crosswalk.size,
        address_rows: addressRows.length,
        entity_names: nameRows.length,
      },
    };
    w.write("manifest.json", manifest);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(tmp, target);
    return { files: w.files, bytes: w.bytes, largest: w.largest, manifest };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function main(argv: string[]): void {
  let out: string | undefined;
  const sources: PackSource[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") out = argv[++i];
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else {
      const eq = a.indexOf("=");
      const path = eq > 0 ? a.slice(eq + 1) : a;
      const name =
        eq > 0 ? a.slice(0, eq) : basename(path).replace(/\.db$/, "");
      sources.push({ name, path: resolve(path) });
    }
  }
  if (!out || !sources.length) {
    console.error(
      "usage: node scripts/registry/pack.ts --out <dir> <db | name=db>...",
    );
    process.exit(2);
  }
  const started = Date.now();
  const stats = buildPack(sources, out, (l) => console.log(l));
  console.log(
    `pack: ${stats.files} files, ${(stats.bytes / 1048576).toFixed(1)} MiB, largest ${stats.largest.path} ${(stats.largest.bytes / 1024).toFixed(1)} KiB, regions ${stats.manifest.dbs.map((d) => d.name).join(", ")} (${Math.round((Date.now() - started) / 1000)} s)`,
  );
  console.log(`written to ${resolve(out)}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
