/**
 * Sampled parity check of a built pack against the registry files it was built from.
 *
 *   node --experimental-strip-types --conditions=factlot-source scripts/registry/check_pack.ts \
 *     --pack <dir> --scratch <dir> [--samples 2000] [--seed 1] <db | name=db>...
 *
 * Merges the files into <scratch>/merged.db (one registry file holding every region, as the hosted registry is
 * meant to answer) and compares the Worker's answers with runTool's on it: records (undated, with history, and
 * dated), ownership, crosswalk IDs, address and entity searches drawn from the files' own keys, coverage and
 * misses. resolve_parcel is compared with each county's own file, since its parcel rule is per file. Prints counts
 * and timings only (never a name or a record); mismatches go to <scratch>/mismatches.jsonl.
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
  configureRegistry,
  getTool,
  runTool,
} from "../../packages/tools/src/index.ts";
import { fileAssets } from "../../deploy/registry/src/file_assets.ts";
import { Pack } from "../../deploy/registry/src/store.ts";
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
}

function main(argv: string[]): void {
  let pack = "";
  let scratch = "";
  let samples = 2000;
  const files: { name: string; path: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--pack") pack = resolve(argv[++i]!);
    else if (a === "--scratch") scratch = resolve(argv[++i]!);
    else if (a === "--samples") samples = Number(argv[++i]);
    else if (a === "--seed") seed = Number(argv[++i]);
    else {
      const eq = a.indexOf("=");
      const path = resolve(eq > 0 ? a.slice(eq + 1) : a);
      files.push({
        name: eq > 0 ? a.slice(0, eq) : basename(path).replace(/\.db$/, ""),
        path,
      });
    }
  }
  if (!pack || !scratch || !files.length) {
    console.error(
      "usage: check_pack.ts --pack <dir> --scratch <dir> [--samples N] <db>...",
    );
    process.exit(2);
  }
  mkdirSync(scratch, { recursive: true });
  const merged = join(scratch, "merged.db");
  console.log("merging the files...");
  merge(
    files.map((f) => f.path),
    merged,
  );
  void run(pack, scratch, merged, files, samples);
}

async function run(
  packDir: string,
  scratch: string,
  merged: string,
  files: { name: string; path: string }[],
  samples: number,
): Promise<void> {
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
    const db = new DatabaseSync(f.path, { readOnly: true });
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
          db: f.path,
        });
    }
    db.close();
  }
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

  const stats = new Map<
    string,
    { n: number; bad: number; cpu: number[]; reads: number[] }
  >();
  const mismatches: string[] = [];
  let current: string | undefined;
  for (const c of calls) {
    const db = c.db ?? merged;
    if (db !== current) {
      configureRegistry(db);
      current = db;
    }
    const parsed = getTool(c.tool)!.input.safeParse(c.args);
    if (!parsed.success) continue;
    const want = runTool(c.tool, c.args);
    // Cold: a fresh pack reader, so every file is read and parsed (the manifest read is excluded below).
    const pack = new Pack(fileAssets(packDir));
    await pack.manifest();
    const before = pack.reads;
    const t0 = cpuUsage();
    const got = await runRegistryTool(pack, c.tool, parsed.data);
    const dt = cpuUsage(t0);
    const s = stats.get(c.tool) ?? { n: 0, bad: 0, cpu: [], reads: [] };
    s.n += 1;
    s.cpu.push((dt.user + dt.system) / 1000);
    s.reads.push(pack.reads - before);
    const unanswerable = c.tool === "registry_tx_equity_candidates" && want.ok;
    if (
      unanswerable
        ? got.ok || got.error.error !== "RegistryUnavailable"
        : JSON.stringify(got) !== JSON.stringify(want)
    ) {
      s.bad += 1;
      mismatches.push(
        JSON.stringify({ tool: c.tool, args: c.args, got, want }),
      );
    }
    stats.set(c.tool, s);
  }
  configureRegistry(undefined);
  writeFileSync(join(scratch, "mismatches.jsonl"), mismatches.join("\n"));
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
    `total mismatches: ${mismatches.length}${mismatches.length ? ` (see ${join(scratch, "mismatches.jsonl")})` : ""}`,
  );
  if (!existsSync(merged)) console.log("merged file missing");
}

main(process.argv.slice(2));
