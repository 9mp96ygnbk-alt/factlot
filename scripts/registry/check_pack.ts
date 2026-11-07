/**
 * Sampled parity check of a built pack against the registry files it was built from.
 *
 *   node --experimental-strip-types --conditions=factlot-source scripts/registry/check_pack.ts \
 *     --pack <dir> --scratch <dir> [--exclude-county <FIPS>]... [--samples 2000] [--equity 2000] [--seed 1] \
 *     [--part i/n] [--reuse] <db | name=db>...
 *
 * Filters the files as pack.ts does (the same --exclude-county; entities of a large registry kept only where they
 * own a served parcel) and merges them into <scratch>/merged.db (one registry file holding every served region, as
 * the hosted registry is meant to answer; --reuse keeps an earlier one). Compares the Worker's answers with
 * runTool's on it, with the hosted misses and coverage (hosted.ts): records (undated, with history and value
 * history, and dated), ownership, crosswalk IDs, address and entity searches drawn from the files' own keys,
 * coverage and misses, parcels of withheld counties and entities not served (drawn from the unfiltered files), and
 * Texas unequal-appraisal candidates for --equity subjects spread over every county and category code, at default,
 * tighter and other parameters. resolve_parcel is compared with each county's own file, since its parcel rule is per
 * file. --part i/n checks every n-th call from the i-th (run n processes to share the work). Prints counts and
 * timings only (never a name or a record); mismatches go to <scratch>/mismatches[-i].jsonl. CPU times are per call
 * on a fresh pack reader (every file read and parsed) except the name gram counts, which a Worker isolate keeps.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { cpuUsage } from "node:process";

import {
  computeRegistryCoverage,
  configureRegistry,
  getTool,
  runTool,
  type RegistryCoverage,
} from "../../packages/tools/src/index.ts";
import { fileAssets } from "../../deploy/registry/src/file_assets.ts";
import { hostedOutcome } from "../../deploy/registry/src/hosted.ts";
import { Pack } from "../../deploy/registry/src/store.ts";
import { filterRegistry } from "./pack.ts";
import { runRegistryTool } from "../../deploy/registry/src/tools.ts";
import type { Manifest } from "../../deploy/registry/src/format.ts";

type Row = Record<string, unknown>;
interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: unknown[]): Row[];
    get(...p: unknown[]): Row | undefined;
  };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => Db;
};

const TABLES = [
  "sources",
  "snapshots",
  "subjects",
  "facts",
  "relationships",
  "crosswalk",
  "coverage",
  "name_index",
  "address_index",
  "building_members",
];

function merge(files: string[], out: string): void {
  rmSync(out, { force: true });
  copyFileSync(files[0]!, out);
  const d = new DatabaseSync(out);
  d.exec("DELETE FROM meta WHERE key = 'coverage'");
  files.slice(1).forEach((f, i) => {
    d.exec(`ATTACH '${f.replaceAll("'", "''")}' AS m${i}`);
    for (const t of TABLES)
      d.exec(`INSERT INTO main.${t} SELECT * FROM m${i}.${t} ORDER BY rowid`);
    d.exec(`DETACH m${i}`);
  });
  d.close();
}

let seed = 1;
const rand = (): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 2 ** 32;
};
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)]!;

interface Call {
  tool: string;
  args: Row;
  db?: string;
  /** The row of the report (default: the tool). */
  label?: string;
}

interface Options {
  pack: string;
  scratch: string;
  samples: number;
  equity: number;
  exclude: string[];
  part: [number, number];
  reuse: boolean;
}

function main(argv: string[]): void {
  const o: Options = {
    pack: "",
    scratch: "",
    samples: 2000,
    equity: 2000,
    exclude: [],
    part: [0, 1],
    reuse: false,
  };
  const files: { name: string; path: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--pack") o.pack = resolve(argv[++i]!);
    else if (a === "--scratch") o.scratch = resolve(argv[++i]!);
    else if (a === "--samples") o.samples = Number(argv[++i]);
    else if (a === "--equity") o.equity = Number(argv[++i]);
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--exclude-county") o.exclude.push(argv[++i]!);
    else if (a === "--reuse") o.reuse = true;
    else if (a === "--part") {
      const [x, n] = argv[++i]!.split("/").map(Number);
      o.part = [x!, n!];
    } else {
      const eq = a.indexOf("=");
      const path = resolve(eq > 0 ? a.slice(eq + 1) : a);
      files.push({
        name: eq > 0 ? a.slice(0, eq) : basename(path).replace(/\.db$/, ""),
        path,
      });
    }
  }
  if (!o.pack || !o.scratch || !files.length) {
    console.error(
      "usage: check_pack.ts --pack <dir> --scratch <dir> [--exclude-county FIPS]... [--samples N] [--equity N] [--part i/n] [--reuse] <db>...",
    );
    process.exit(2);
  }
  mkdirSync(o.scratch, { recursive: true });
  const merged = join(o.scratch, "merged.db");
  const served = files.map((f) => ({
    ...f,
    served: join(o.scratch, `served-${f.name}.db`),
  }));
  if (!(o.reuse && existsSync(merged))) {
    console.log("filtering and merging the files...");
    for (const f of served) {
      const r = filterRegistry(f.path, f.served, o.exclude);
      if (r.path !== f.served) copyFileSync(f.path, f.served);
    }
    merge(
      served.map((f) => f.served),
      merged,
    );
  }
  void run(o, merged, served);
}

async function run(
  o: Options,
  merged: string,
  files: { name: string; path: string; served: string }[],
): Promise<void> {
  const { pack: packDir, scratch, samples } = o;
  const d = new DatabaseSync(merged, { readOnly: true });
  const all = (sql: string, ...p: unknown[]) => d.prepare(sql).all(...p);
  const manifest = (await new Pack(fileAssets(packDir)).manifest()) as Manifest;
  const calls: Call[] = [];

  // Records.
  const subjects = all(
    "SELECT urn, kind FROM subjects ORDER BY random() LIMIT ?",
    samples,
  );
  const dates = [...new Set(manifest.dbs.flatMap((db) => db.dates))];
  for (const s of subjects) {
    const urn = String(s.urn);
    calls.push({ tool: "registry_get", args: { urn } });
    calls.push({ tool: "registry_get", args: { urn, include_history: true } });
    const at = pick([...dates, "2000-01-01", "2099-12-31", "2026-11-03"]);
    calls.push({
      tool: "registry_get",
      args: { urn, as_of: at, include_history: rand() < 0.5 },
    });
    calls.push({ tool: "registry_tx_equity_candidates", args: { urn } });
  }
  for (const r of all(
    "SELECT urn FROM subjects WHERE kind = 'entity' ORDER BY random() LIMIT ?",
    samples,
  ))
    calls.push({ tool: "registry_owned_by", args: { entity_urn: r.urn } });
  for (const r of all(
    "SELECT DISTINCT from_urn FROM relationships WHERE type = 'owns' ORDER BY random() LIMIT ?",
    samples,
  ))
    calls.push({ tool: "registry_owned_by", args: { entity_urn: r.from_urn } });
  // Crosswalk.
  for (const r of all(
    "SELECT system, external_id FROM crosswalk ORDER BY random() LIMIT ?",
    samples,
  )) {
    calls.push({
      tool: "registry_resolve_external",
      args: { system: r.system, external_id: r.external_id },
    });
    calls.push({
      tool: "registry_resolve_external",
      args: { system: r.system, external_id: `${String(r.external_id)}0` },
    });
  }
  // Parcels by APN, against each county's own file.
  for (const f of files) {
    const db = new DatabaseSync(f.served, { readOnly: true });
    for (const r of db
      .prepare(
        "SELECT f.subject, f.value_json FROM facts f WHERE f.predicate = 'parcel.apn' ORDER BY random() LIMIT ?",
      )
      .all(Math.ceil(samples / files.length))) {
      const region = String(r.subject).split(":")[2]!;
      const apn = JSON.parse(String(r.value_json)) as string;
      for (const a of [apn, apn.toLowerCase(), ` ${apn}-`, `${apn}9`])
        calls.push({
          tool: "registry_resolve_parcel",
          args: {
            state_fips: region.slice(3, 5),
            county_fips: region.slice(5, 8),
            apn: a,
          },
          db: f.served,
        });
    }
    db.close();
  }
  // What the pack does not serve, drawn from the unfiltered files: parcels of withheld counties (records, APNs,
  // candidates) and entities that own no served parcel.
  for (const f of files) {
    const db = new DatabaseSync(f.path, { readOnly: true });
    for (const fips of o.exclude) {
      for (const r of db
        .prepare(
          "SELECT f.subject, f.value_json FROM facts f WHERE f.subject >= ? AND f.subject < ? AND f.predicate = 'parcel.apn' LIMIT ?",
        )
        .all(`fl:parcel:us-${fips}:`, `fl:parcel:us-${fips};`, 100)) {
        const urn = String(r.subject);
        const apn = JSON.parse(String(r.value_json)) as string;
        calls.push(
          { tool: "registry_get", args: { urn }, label: "withheld get" },
          {
            tool: "registry_resolve_parcel",
            args: {
              state_fips: fips.slice(0, 2),
              county_fips: fips.slice(2),
              apn,
            },
            db: f.served,
            label: "withheld resolve",
          },
          {
            tool: "registry_tx_equity_candidates",
            args: { urn },
            label: "withheld equity",
          },
        );
      }
    }
    if (Object.keys(manifest.entity_scope).length) {
      const servedDb = new DatabaseSync(f.served, { readOnly: true });
      const gone = (urn: string) =>
        !servedDb.prepare("SELECT 1 AS x FROM subjects WHERE urn = ?").get(urn);
      let n = 0;
      for (const r of db
        .prepare(
          "SELECT urn FROM subjects WHERE kind = 'entity' AND rowid % 997 = 0 LIMIT 2000",
        )
        .all()) {
        const urn = String(r.urn);
        if (!gone(urn) || n >= 200) continue;
        n += 1;
        calls.push(
          { tool: "registry_get", args: { urn }, label: "unserved entity get" },
          {
            tool: "registry_owned_by",
            args: { entity_urn: urn },
            label: "unserved entity owned_by",
          },
        );
      }
      servedDb.close();
    }
    db.close();
  }
  // Texas candidates: subjects from every county and category code (each at least a few), at several parameters.
  const strata = new Map<string, string[]>();
  for (const r of all(
    "SELECT f.subject, f.value_json FROM facts f WHERE f.subject >= 'fl:parcel:us-48' AND f.subject < 'fl:parcel:us-49' AND f.predicate = 'parcel.state_property_category' GROUP BY f.subject",
  )) {
    const k = `${String(r.subject).slice(13, 18)} ${String(r.value_json)}`;
    const list = strata.get(k) ?? [];
    list.push(String(r.subject));
    strata.set(k, list);
  }
  const txTotal = [...strata.values()].reduce((a, l) => a + l.length, 0);
  const tighter = [
    { area_band: 0.2, year_band: 8, limit: 20, min_matches: 5 },
    { area_band: 0.1, year_band: 5, limit: 10 },
    { area_band: 0.3, year_band: 0, min_matches: 3, limit: 50 },
  ];
  const other = [
    { area_band: 0.6, year_band: 30, limit: 100 },
    { min_matches: 100, limit: 200 },
    { area_band: 1, year_band: 100, min_matches: 200, limit: 200 },
    { tax_year: 2026 },
    { tax_year: 2025 },
  ];
  let equitySubjects = 0;
  for (const k of [...strata.keys()].sort()) {
    const list = strata.get(k)!;
    const n = Math.min(
      list.length,
      Math.max(5, Math.round((o.equity * list.length) / Math.max(1, txTotal))),
    );
    for (let i = 0; i < n; i++) {
      const urn = list.splice(Math.floor(rand() * list.length), 1)[0]!;
      equitySubjects += 1;
      calls.push(
        {
          tool: "registry_tx_equity_candidates",
          args: { urn },
          label: "equity default",
        },
        {
          tool: "registry_tx_equity_candidates",
          args: { urn, ...pick(tighter) },
          label: "equity tighter",
        },
        {
          tool: "registry_tx_equity_candidates",
          args: { urn, ...pick(other) },
          label: "equity other",
        },
      );
    }
  }
  for (const r of all(
    "SELECT f.subject, f.value_json FROM facts f WHERE f.subject >= 'fl:parcel:us-48' AND f.subject < 'fl:parcel:us-49' AND f.predicate = 'parcel.apn' ORDER BY random() LIMIT 50",
  )) {
    const region = String(r.subject).split(":")[2]!;
    calls.push({
      tool: "registry_tx_equity_candidates",
      args: {
        county_fips: region.slice(5, 8),
        apn: JSON.parse(String(r.value_json)),
      },
      label: "equity by apn",
    });
  }
  console.log(
    `${equitySubjects} Texas candidate subjects from ${strata.size} county and category strata`,
  );
  // Address searches from real keys.
  const streetTypes =
    /^(ALY|AVE|BLVD|BYP|CIR|CSWY|CT|DR|EXPY|FWY|HWY|LN|LOOP|PATH|PIKE|PKWY|PL|PLZ|RD|ROW|RUN|SQ|ST|TER|TPKE|TRL|WALK|WAY|XING)$/;
  for (const r of all(
    "SELECT key FROM address_index ORDER BY random() LIMIT ?",
    samples,
  )) {
    const t = String(r.key).split(" ");
    const ti = t.findIndex((x) => streetTypes.test(x));
    const qs = [
      t.join(" "),
      `${t.slice(0, Math.max(2, ti + 1)).join(" ")}, Somewhere, MD`,
      t.slice(0, 2).join(" ").toLowerCase(),
      `${t[0]} ${t[t.length - 1]}`,
    ];
    if (ti > 0)
      qs.push(
        t.slice(Math.max(1, ti - 1), ti + 1).join(" "),
        t.slice(1, ti + 1).join(" "),
        t[ti]!,
      );
    if (ti >= 0 && ti + 1 < t.length) qs.push(t.slice(ti, ti + 2).join(" "));
    for (const query of qs)
      calls.push({
        tool: "registry_search_address",
        args: { query, limit: pick([1, 5, 20, 100]) },
      });
  }
  for (const query of [
    "St",
    "Ave",
    "Main St",
    "1 Main St",
    "100",
    "Baltimore",
    "MD",
    "1 MD",
    "Way",
    "N Charles St",
  ])
    calls.push({
      tool: "registry_search_address",
      args: { query, limit: 100 },
    });
  // Entity searches from real name keys.
  for (const r of all(
    "SELECT key FROM name_index ORDER BY random() LIMIT ?",
    Math.ceil(samples / 4),
  )) {
    const k = String(r.key);
    for (const query of [
      k,
      k.toLowerCase(),
      k.slice(0, 4),
      k.slice(2, 9),
      `${k} X`,
    ])
      calls.push({
        tool: "registry_search_entities",
        args: { query, limit: pick([1, 5, 20, 100]) },
      });
  }
  for (const query of ["", "LLC", "INC", "zzzz"])
    calls.push({
      tool: "registry_search_entities",
      args: { query, limit: 100 },
    });
  calls.push({ tool: "registry_coverage", args: {} });
  for (const urn of [
    "fl:parcel:us-48201:1",
    "fl:entity:us-de:1",
    "fl:building:us-24005:21093:1-main-st",
    "fl:parcel:us-24005:x",
  ])
    calls.push({ tool: "registry_get", args: { urn } });
  d.close();

  configureRegistry(merged);
  const mergedCoverage: RegistryCoverage = computeRegistryCoverage();
  const pinned = new Map<string, unknown>();
  const [part, parts] = o.part;
  let valueHistories = 0;
  const stats = new Map<
    string,
    { n: number; bad: number; cpu: number[]; reads: number[] }
  >();
  const mismatches: string[] = [];
  let current: string | undefined;
  for (const [ci, c] of calls.entries()) {
    if (ci % parts !== part) continue;
    const db = c.db ?? merged;
    if (db !== current) {
      configureRegistry(db);
      current = db;
    }
    const parsed = getTool(c.tool)!.input.safeParse(c.args);
    if (!parsed.success) continue;
    let want = runTool(c.tool, c.args);
    // resolve_parcel: the URN from the county's own file (its parcel rule), and on a miss the coverage of the file
    // holding every region.
    if (c.db && want.ok && (want.result as Row).urn === null) {
      configureRegistry(merged);
      current = merged;
      want = runTool(c.tool, c.args);
    }
    want = hostedOutcome(manifest, mergedCoverage, c.tool, c.args, want);
    // Cold: a fresh pack reader, so every file is read and parsed (the manifest read is excluded below).
    const pack = new Pack(fileAssets(packDir), pinned);
    await pack.manifest();
    const before = pack.reads;
    const t0 = cpuUsage();
    const got = await runRegistryTool(pack, c.tool, parsed.data);
    const dt = cpuUsage(t0);
    const label = c.label ?? c.tool;
    const s = stats.get(label) ?? { n: 0, bad: 0, cpu: [], reads: [] };
    s.n += 1;
    s.cpu.push((dt.user + dt.system) / 1000);
    s.reads.push(pack.reads - before);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      s.bad += 1;
      mismatches.push(
        JSON.stringify({ tool: c.tool, args: c.args, got, want }),
      );
    } else if (
      c.tool === "registry_get" &&
      want.ok &&
      String(c.args.urn).startsWith("fl:parcel:us-48") &&
      ((want.result as Row).value_history as unknown[] | undefined)?.length
    )
      valueHistories += 1;
    stats.set(c.label ?? c.tool, s);
  }
  configureRegistry(undefined);
  const out = join(
    scratch,
    parts > 1 ? `mismatches-${part}.jsonl` : "mismatches.jsonl",
  );
  writeFileSync(out, mismatches.join("\n"));
  const q = (a: number[], p: number) =>
    [...a].sort((x, y) => x - y)[
      Math.min(a.length - 1, Math.floor(a.length * p))
    ] ?? 0;
  console.log(
    "tool                            calls  mismatches  cpu ms p50 / p95 / max   files read max",
  );
  for (const [tool, s] of stats)
    console.log(
      `${tool.padEnd(32)}${String(s.n).padStart(5)}  ${String(s.bad).padStart(10)}  ${q(s.cpu, 0.5).toFixed(2)} / ${q(s.cpu, 0.95).toFixed(2)} / ${Math.max(...s.cpu).toFixed(2)}   ${Math.max(...s.reads)}`,
    );
  console.log(
    `total mismatches: ${mismatches.length}${mismatches.length ? ` (see ${out})` : ""}`,
  );
  console.log(
    `Texas parcel records with a value history, matched: ${valueHistories}`,
  );
  if (!existsSync(merged)) console.log("merged file missing");
}

main(process.argv.slice(2));
