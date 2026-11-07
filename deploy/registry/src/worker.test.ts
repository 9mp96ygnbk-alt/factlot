// Parity: the Worker, answering from a pack built from the synthetic registry fixture, must return exactly what
// runTool returns against the fixture itself, for every record and a battery of searches, misses and dated lookups.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPack } from "../../../scripts/registry/pack.ts";
import {
  configureRegistry,
  getTool,
  runTool,
} from "../../../packages/tools/src/index.ts";

import { fileAssets } from "./file_assets.ts";
import { addressListKey } from "./search.ts";
import { handle } from "./worker.ts";

const spec = fileURLToPath(new URL("../../../spec/registry/", import.meta.url));
const calls = JSON.parse(readFileSync(join(spec, "calls.json"), "utf8")) as {
  tool: string;
  arguments: Record<string, unknown>;
}[];

type Row = Record<string, unknown>;
interface Db {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): Row[] };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => Db;
};

const dir = mkdtempSync(join(tmpdir(), "factlot-registry-pack-"));
const fixture = join(dir, "fixture.db");
execFileSync("python3", [join(spec, "build_fixture.py"), fixture]);

function rows(sql: string): Row[] {
  const d = new DatabaseSync(fixture, { readOnly: true });
  try {
    return d.prepare(sql).all();
  } finally {
    d.close();
  }
}

async function worker(
  assets: ReturnType<typeof fileAssets>,
  tool: string,
  input: unknown,
): Promise<string> {
  const res = await handle(
    new Request("https://registry.internal/run", {
      method: "POST",
      body: JSON.stringify({ tool, input }),
    }),
    { ASSETS: assets },
  );
  assert.equal(res.status, 200);
  return res.text();
}

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

/** Compare the Worker with runTool on `db` for each call; returns the mismatches. */
async function compare(
  pack: string,
  db: string,
  list: Call[],
): Promise<string[]> {
  const assets = fileAssets(pack);
  const bad: string[] = [];
  configureRegistry(db);
  try {
    for (const { tool, args } of list) {
      const schema = getTool(tool)!.input as unknown as { shape: Row };
      const parsed = getTool(tool)!.input.safeParse(args);
      // The API rejects these before the Worker sees them.
      if (
        !parsed.success ||
        Object.keys(args).some((k) => !(k in schema.shape))
      )
        continue;
      const want = runTool(tool, args);
      const got = await worker(assets, tool, parsed.data);
      if (tool === "registry_tx_equity_candidates" && want.ok) {
        // A subject the pack holds: the hosted registry does not compute candidates.
        if (JSON.parse(got).error?.error !== "RegistryUnavailable")
          bad.push(
            `${tool} ${JSON.stringify(args)}: expected RegistryUnavailable`,
          );
        continue;
      }
      if (got !== JSON.stringify(want))
        bad.push(
          `${tool} ${JSON.stringify(args)}\n  worker ${got}\n  sdk    ${JSON.stringify(want)}`,
        );
    }
  } finally {
    configureRegistry(undefined);
  }
  return bad;
}

function dayBefore(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

function getCalls(): Call[] {
  const dates = rows(
    "SELECT as_of FROM facts UNION SELECT as_of FROM coverage UNION SELECT as_of FROM relationships",
  ).map((r) => String(r.as_of));
  const asOfs = [
    undefined,
    "1999-01-01",
    "2099-12-31",
    ...dates.flatMap((d) => [d, dayBefore(d)]),
  ];
  const out: Call[] = [];
  for (const r of rows("SELECT urn, kind FROM subjects")) {
    const urn = String(r.urn);
    for (const as_of of asOfs)
      for (const include_history of [false, true])
        out.push({
          tool: "registry_get",
          args: { urn, include_history, ...(as_of ? { as_of } : {}) },
        });
    out.push({ tool: "registry_owned_by", args: { entity_urn: urn } });
    out.push({ tool: "registry_tx_equity_candidates", args: { urn } });
  }
  for (const urn of [
    "fl:parcel:us-48999:9999-000-0001",
    "fl:parcel:us-48001:1",
    "fl:parcel:us-04021:501-01-001",
    "fl:entity:us-tx:0000000001",
    "fl:entity:us-de:1234567",
    "fl:building:us-48999:77999:1-nowhere-rd",
    "fl:building:us-06037:90012:1-main-st",
    "not a urn",
    "fl:parcel:bad",
  ])
    for (const tool of ["registry_get", "registry_owned_by"])
      out.push({
        tool,
        args: tool === "registry_get" ? { urn } : { entity_urn: urn },
      });
  for (const r of rows("SELECT system, external_id FROM crosswalk"))
    out.push({
      tool: "registry_resolve_external",
      args: { system: r.system, external_id: r.external_id },
    });
  out.push(
    {
      tool: "registry_resolve_external",
      args: { system: "test-account", external_id: "nope" },
    },
    {
      tool: "registry_resolve_external",
      args: { system: "nyc_bbl", external_id: "1" },
    },
    { tool: "registry_coverage", args: {} },
  );
  for (const r of rows(
    "SELECT f.value_json AS apn, s.urn FROM facts f JOIN subjects s ON s.urn = f.subject WHERE f.predicate = 'parcel.apn'",
  )) {
    const apn = JSON.parse(String(r.apn)) as string;
    const region = String(r.urn).split(":")[2]!;
    for (const a of [
      apn,
      apn.toLowerCase(),
      ` ${apn} `,
      apn.replaceAll("-", " "),
    ])
      out.push({
        tool: "registry_resolve_parcel",
        args: {
          state_fips: region.slice(3, 5),
          county_fips: region.slice(5, 8),
          apn: a,
        },
      });
  }
  for (const args of [
    { state_fips: "48", county_fips: "999", apn: "nope-1" },
    { state_fips: "48", county_fips: "999", apn: "---" },
    { state_fips: "24", county_fips: "005", apn: "1" },
    { state_fips: "4", county_fips: "005", apn: "1" },
    { state_fips: "48", county_fips: "439", apn: "1" },
  ]) {
    out.push({ tool: "registry_resolve_parcel", args });
    out.push({ tool: "registry_tx_equity_candidates", args });
  }
  return out;
}

function searchCalls(): Call[] {
  const queries = new Set<string>([
    "Main",
    "100 Mai",
    "#",
    "Suite 4",
    "ST",
    "st",
    "Dr",
    "Way",
    "300",
    "1 Nowhere Rd",
    "1 Nowhere Rd, Casa Grande, AZ 85122",
    "Tower Ct, Example City, TX",
    "Industrial Way",
    "Northwest Industrial Way",
    "Harbor Dr Example",
    "Dr Example City",
    "100 100",
    "9 nw industrial way",
  ]);
  for (const r of rows("SELECT key FROM address_index")) {
    const key = String(r.key);
    const t = key.split(" ");
    queries.add(key);
    queries.add(key.toLowerCase());
    queries.add(`${t.slice(0, 3).join(" ")}, Example City, TX`);
    queries.add(t.slice(0, 2).join(" "));
    queries.add(`${t[0]} ${t[t.length - 1]}`);
    for (let i = 0; i < t.length; i++)
      for (let j = i + 1; j <= Math.min(t.length, i + 4); j++) {
        const run = t.slice(i, j);
        if (addressListKey("street", run)) queries.add(run.join(" "));
      }
  }
  const names = new Set<string>([
    "",
    "LLC",
    "holdings",
    "zzz",
    "W.G.G. Properties LLC",
    "a",
  ]);
  for (const r of rows("SELECT key FROM name_index")) {
    const k = String(r.key);
    names.add(k);
    names.add(k.toLowerCase());
    names.add(k.slice(0, 5));
    names.add(k.slice(3));
  }
  const out: Call[] = [];
  for (const query of queries)
    for (const limit of [1, 2, 20])
      out.push({ tool: "registry_search_address", args: { query, limit } });
  for (const query of names)
    for (const limit of [1, 3, 20])
      out.push({ tool: "registry_search_entities", args: { query, limit } });
  return out;
}

function runToolOn(db: string, c: Call) {
  configureRegistry(db);
  try {
    return runTool(c.tool, c.args);
  } finally {
    configureRegistry(undefined);
  }
}

const shared: Call[] = calls
  .filter((c) => c.tool.startsWith("registry_"))
  .map((c) => ({ tool: c.tool, args: c.arguments }));

test("the Worker answers like runTool on the shared fixture", async () => {
  const pack = join(dir, "pack");
  buildPack([{ name: "fixture", path: fixture }], pack);
  const list = [...shared, ...getCalls(), ...searchCalls()];
  const bad = await compare(pack, fixture, list);
  assert.ok(list.length > 2000, `${list.length} calls`);
  assert.deepEqual(
    bad.slice(0, 5),
    [],
    `${bad.length} of ${list.length} differ`,
  );
});

test("a pack of two files answers like one file holding both (coverage, misses, searches)", async () => {
  // Split the fixture: county 48999 and its buildings in one file, everything else in the other.
  const a = join(dir, "a.db");
  const b = join(dir, "b.db");
  copyFileSync(fixture, a);
  copyFileSync(fixture, b);
  const inA = "(urn LIKE 'fl:parcel:us-48999:%' OR urn LIKE 'fl:building:%')";
  const keep = (db: string, where: string) => {
    const d = new DatabaseSync(db);
    const gone = `(SELECT urn FROM subjects WHERE NOT ${where})`;
    d.exec(
      `DELETE FROM facts WHERE subject IN ${gone}; DELETE FROM coverage WHERE subject IN ${gone};` +
        `DELETE FROM address_index WHERE urn IN ${gone}; DELETE FROM name_index WHERE urn IN ${gone};` +
        `DELETE FROM crosswalk WHERE urn IN ${gone}; DELETE FROM building_members WHERE parcel_urn IN ${gone} OR building_urn IN ${gone};` +
        `DELETE FROM relationships WHERE from_urn IN ${gone} OR to_urn IN ${gone};` +
        `DELETE FROM meta WHERE key = 'coverage'; DELETE FROM subjects WHERE NOT ${where};`,
    );
    d.close();
  };
  keep(a, inA);
  keep(b, `NOT ${inA}`);
  const pack = join(dir, "pack2");
  buildPack(
    [
      { name: "a", path: a },
      { name: "b", path: b },
    ],
    pack,
  );
  // Ownership links cross the split (an entity in one file owns parcels in the other), so records and ownership
  // are compared on the single-file pack; here only what spans files: coverage, misses, resolves and searches.
  const list = [...shared, ...getCalls(), ...searchCalls()].filter(
    (c) =>
      c.tool !== "registry_owned_by" &&
      !(
        c.tool === "registry_get" &&
        JSON.parse(JSON.stringify(runToolOn(fixture, c))).ok
      ),
  );
  const bad = await compare(pack, fixture, list);
  assert.deepEqual(
    bad.slice(0, 5),
    [],
    `${bad.length} of ${list.length} differ`,
  );
});

test("HTTP: /run, /health and nothing else", async () => {
  const env = { ASSETS: fileAssets(join(dir, "pack")) };
  const req = (path: string, init?: RequestInit) =>
    handle(new Request(`https://registry.internal${path}`, init), env);
  const health = await req("/health");
  assert.equal(health.status, 200);
  const h = (await health.json()) as {
    ok: boolean;
    pack: { regions: string[]; counts: Row };
  };
  assert.equal(h.ok, true);
  assert.deepEqual(h.pack.regions, ["fixture"]);
  assert.equal(h.pack.counts.parcels, 25);
  for (const path of ["/", "/manifest.json", "/g/0/0.json", "/run/x"])
    assert.equal((await req(path)).status, 404, path);
  assert.equal((await req("/run")).status, 405);
  assert.equal((await req("/run", { method: "POST", body: "{" })).status, 400);
  assert.equal((await req("/run", { method: "POST", body: "{}" })).status, 400);
  const unknown = await req("/run", {
    method: "POST",
    body: JSON.stringify({ tool: "calc_noi", input: {} }),
  });
  assert.equal(
    ((await unknown.json()) as { error: { error: string } }).error.error,
    "UnknownTool",
  );
});
