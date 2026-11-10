// Parity: the Worker, answering from a pack built from the synthetic registry fixture, must return exactly what
// runTool returns against the fixture itself, for every record and a battery of searches, misses and dated lookups.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { packProblems } from "../../../scripts/registry/deploy.ts";
import { buildPack } from "../../../scripts/registry/pack.ts";
import {
  computeRegistryCoverage,
  configureRegistry,
  equityRule,
  getTool,
  runTool,
  selectEquityCandidates,
} from "../../../packages/tools/src/index.ts";

import {
  EQUITY_CHUNK_ROWS,
  buildList,
  byArea,
  listCount,
  listNearest,
  type EqRow,
  type EquityManifest,
  type PoolHeader,
} from "./equity.ts";
import { fileAssets } from "./file_assets.ts";
import { SharedPages, listPages, type Manifest } from "./format.ts";
import { hostedOutcome, type HostedScope } from "./hosted.ts";
import { addressListKey } from "./search.ts";
import { Pack } from "./store.ts";
import { handle } from "./worker.ts";

const spec = fileURLToPath(new URL("../../../spec/registry/", import.meta.url));
const calls = JSON.parse(readFileSync(join(spec, "calls.json"), "utf8")) as {
  tool: string;
  arguments: Record<string, unknown>;
}[];

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

const dir = mkdtempSync(join(tmpdir(), "factlot-registry-pack-"));
const fixture = join(dir, "fixture.db");
execFileSync("python3", [join(spec, "build_fixture.py"), fixture]);

let rowsFrom = fixture;
function rows(sql: string): Row[] {
  const d = new DatabaseSync(rowsFrom, { readOnly: true });
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
  scope?: HostedScope,
): Promise<string[]> {
  const assets = fileAssets(pack);
  const bad: string[] = [];
  // Every pack withholds the counties of hostedWithheldCounties(), so its answers carry that scope.
  if (!scope) {
    const m = JSON.parse(
      readFileSync(join(pack, "manifest.json"), "utf8"),
    ) as Manifest;
    if (
      Object.keys(m.withheld ?? {}).length ||
      Object.keys(m.entity_scope ?? {}).length
    )
      scope = { withheld: m.withheld, entity_scope: m.entity_scope };
  }
  configureRegistry(db);
  const cov = scope ? computeRegistryCoverage() : undefined;
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
      const sdk = runTool(tool, args);
      // runToolAsync (the API) rejects unknown fields, nested ones included, before the registry runner.
      if (!sdk.ok && sdk.error.message.includes("unknown field")) continue;
      const want = scope ? hostedOutcome(scope, cov!, tool, args, sdk) : sdk;
      const got = await worker(assets, tool, parsed.data);
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

// Defaults, tighter and wider bands, a short limit, a high min_matches (the county tier), each roll year.
const EQUITY_PARAMS: Record<string, unknown>[] = [
  {},
  { area_band: 0.1, year_band: 3 },
  { area_band: 1, year_band: 100, limit: 200 },
  { limit: 1 },
  { limit: 3, min_matches: 200 },
  { min_matches: 1 },
  { tax_year: 2025 },
  { tax_year: 2026, area_band: 0.2 },
  { tax_year: 2027, min_matches: 50 },
  { tax_year: 2024 },
];

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
    for (const p of EQUITY_PARAMS)
      out.push({ tool: "registry_tx_equity_candidates", args: { urn, ...p } });
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
  // Batches: misses and input errors only (answered per subject), and one with every subject.
  out.push({
    tool: "registry_tx_equity_candidates_batch",
    args: {
      subjects: [
        { id: "a", state_fips: "48", county_fips: "999", apn: "nope-1" },
        { id: "b", county_fips: "439", apn: "1" },
        { id: "c", urn: "fl:parcel:us-04021:501-01-001" },
        { id: "d", urn: "fl:entity:us-tx:0000000001" },
        { id: "e", county_fips: "999" },
      ],
      area_band: 0.2,
    },
  });
  out.push({
    tool: "registry_tx_equity_candidates_batch",
    args: {
      subjects: rows("SELECT urn FROM subjects WHERE kind = 'parcel'")
        .map((r, n) => ({ id: `s${n}`, urn: String(r.urn) }))
        .slice(0, 50),
    },
  });
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

const batchCalls = JSON.parse(
  readFileSync(join(spec, "calls_tx_batch.json"), "utf8"),
) as typeof calls;
const shared: Call[] = [...calls, ...batchCalls]
  .filter((c) => c.tool.startsWith("registry_"))
  .map((c) => ({ tool: c.tool, args: c.arguments }));

test("the Worker answers like runTool on the shared fixture", async () => {
  const pack = join(dir, "pack");
  buildPack([{ name: "fixture", path: fixture }], pack);
  assert.ok(
    shared.filter((c) => c.tool === "registry_tx_equity_candidates_batch")
      .length >= 2,
  );
  const list = [...shared, ...getCalls(), ...searchCalls()];
  const bad = await compare(pack, fixture, list);
  assert.ok(list.length > 2000, `${list.length} calls`);
  assert.deepEqual(
    bad.slice(0, 5),
    [],
    `${bad.length} of ${list.length} differ`,
  );
});

test("entity search through the label-ordered list answers like runTool", async () => {
  // Posting lists of at most 2 rows: most queries take the label-ordered path.
  const pack = join(dir, "pack-names");
  buildPack([{ name: "fixture", path: fixture }], pack, () => {}, {
    namePostingMax: 2,
  });
  const list = searchCalls().filter(
    (c) => c.tool === "registry_search_entities",
  );
  const bad = await compare(pack, fixture, list);
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

function allFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allFiles(join(root, e.name)) : [join(root, e.name)],
  );
}

test("a withheld county and an entity registry served in part", async () => {
  // The fixture with its county 48999 renamed Tarrant (48439), the county the hosted registry withholds.
  const x = join(dir, "tarrant.db");
  copyFileSync(fixture, x);
  const d = new DatabaseSync(x);
  d.exec("PRAGMA foreign_keys = OFF");
  const rename = (table: string, col: string) =>
    d.exec(
      `UPDATE ${table} SET ${col} = replace(${col}, 'us-48999:', 'us-48439:') WHERE ${col} LIKE '%us-48999:%'`,
    );
  for (const [t, c] of [
    ["subjects", "urn"],
    ["facts", "subject"],
    ["coverage", "subject"],
    ["relationships", "from_urn"],
    ["relationships", "to_urn"],
    ["crosswalk", "urn"],
    ["address_index", "urn"],
    ["name_index", "urn"],
    ["building_members", "building_urn"],
    ["building_members", "parcel_urn"],
  ])
    rename(t!, c!);
  d.exec(
    "UPDATE sources SET county_fips = '439' WHERE county_fips = '999'; DELETE FROM meta WHERE key = 'coverage'",
  );
  d.close();
  const pack = join(dir, "pack-tarrant");
  const stats = buildPack([{ name: "x", path: x }], pack, () => {}, {
    excludeCounties: ["48439"],
    entityWholeMax: 0,
  });
  assert.deepEqual(packProblems(pack), []);
  const served = join(`${pack}.work`, "x.db");
  const m = stats.manifest;
  assert.match(m.withheld["48439"]!, /Tarrant Appraisal District/);
  const scope = m.entity_scope["us-tx"]!;
  assert.ok(
    scope && scope.served < scope.total,
    JSON.stringify(m.entity_scope),
  );
  // Nothing of the county is in the pack.
  for (const f of allFiles(pack)) {
    const text = readFileSync(f, "utf8");
    assert.ok(!/fl:(parcel|building):us-48439/.test(text), relative(pack, f));
  }
  // Everything else answers as runTool on the served data, with the hosted misses; calls drawn from the full file.
  rowsFrom = x;
  try {
    const list = [...shared, ...getCalls(), ...searchCalls()];
    const bad = await compare(pack, served, list, m);
    assert.deepEqual(
      bad.slice(0, 5),
      [],
      `${bad.length} of ${list.length} differ`,
    );
  } finally {
    rowsFrom = fixture;
  }
  const assets = fileAssets(pack);
  const call = async (tool: string, input: Row) =>
    JSON.parse(
      await worker(assets, tool, getTool(tool)!.input.parse(input)),
    ) as { ok: boolean; result?: Row; error?: Row };
  const tarrantUrn = rows(
    "SELECT urn FROM subjects WHERE urn LIKE 'fl:parcel:us-48999:%' LIMIT 1",
  )[0]!.urn as string;
  const withheld =
    /Tarrant County, TX \(48439\) is not served by the hosted registry while the publisher's terms for AI use are unclear: Tarrant Appraisal District/;
  const get = await call("registry_get", {
    urn: tarrantUrn.replace("us-48999", "us-48439"),
  });
  assert.equal(get.error?.error, "NotFound");
  assert.match(String(get.error?.message), withheld);
  const resolve = await call("registry_resolve_parcel", {
    state_fips: "48",
    county_fips: "439",
    apn: "1",
  });
  assert.match(String((resolve.result!.coverage as Row).message), withheld);
  const cov = await call("registry_coverage", {});
  const hosted = cov.result!.hosted as {
    withheld_counties: Row[];
    entity_registries: Row[];
  };
  assert.equal(hosted.withheld_counties[0]!.region, "us-48439");
  assert.match(String(hosted.withheld_counties[0]!.message), withheld);
  assert.ok(hosted.entity_registries.some((r) => r.jurisdiction === "us-tx"));
  const equity = await call("registry_tx_equity_candidates", {
    urn: tarrantUrn.replace("us-48999", "us-48439"),
  });
  assert.equal(equity.error?.error, "InputError");
  assert.match(String(equity.error?.message), /Tarrant Appraisal District/);
  // An entity that owns no served parcel: a miss that says what entity lookups cover.
  const droppedEntity = new DatabaseSync(x, { readOnly: true })
    .prepare(
      "SELECT urn FROM subjects WHERE kind = 'entity' AND urn LIKE 'fl:entity:us-tx:%' AND urn NOT IN (SELECT r.from_urn FROM relationships r WHERE r.type = 'owns' AND r.to_urn NOT LIKE '%us-48439:%') LIMIT 1",
    )
    .all()[0]!.urn as string;
  const gone = await call("registry_get", { urn: droppedEntity });
  assert.equal(gone.error?.error, "NotFound");
  assert.match(
    String(gone.error?.message),
    /entity lookups cover entities that own a hosted parcel/,
  );
  const owned = await call("registry_owned_by", { entity_urn: droppedEntity });
  assert.match(
    String((owned.result!.coverage as Row).message),
    /entity lookups cover entities that own a hosted parcel/,
  );
});

test("candidates: non-Texas and withheld parcels are input errors, as in the SDK", async () => {
  const assets = fileAssets(join(dir, "pack"));
  for (const [input, path, pattern] of [
    [{ urn: "fl:parcel:us-24005:1" }, "urn", /Texas-only/],
    [
      { state_fips: "24", county_fips: "005", apn: "1" },
      "state_fips",
      /Texas-only/,
    ],
    [{ urn: "fl:parcel:us-48439:1" }, "urn", /Tarrant Appraisal District/],
    [
      { county_fips: "439", apn: "1" },
      "county_fips",
      /Tarrant Appraisal District/,
    ],
  ] as [Row, string, RegExp][]) {
    const got = JSON.parse(
      await worker(
        assets,
        "registry_tx_equity_candidates",
        getTool("registry_tx_equity_candidates")!.input.parse(input),
      ),
    ) as { error: { error: string; message: string; issues: Row[] } };
    assert.equal(got.error.error, "InputError");
    assert.equal(got.error.issues[0]!.path, path);
    assert.match(got.error.message, pattern);
  }
});

test("candidate lists split into chunks count and order like the whole list", async () => {
  // Synthetic pools large enough for chunked lists (with and without count chunks); every count and nearest-row
  // answer is checked against the SDK's selection over the decoded rows.
  let seed = 3;
  const rand = () =>
    (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const docs: EquityManifest = {
    docs: [["doc-0", { document_id: "doc-0" }]],
    pools: 1,
  };
  for (const n of [EQUITY_CHUNK_ROWS * 4 + 17, 21000]) {
    const root = mkdtempSync(join(tmpdir(), "factlot-equity-"));
    const rowsOf: EqRow[] = [];
    for (let i = 0; i < n; i++) {
      const area = Math.round(1000 + rand() * 50000) * (rand() < 0.1 ? 1 : 1);
      const year = rand() < 0.15 ? null : 1950 + Math.floor(rand() * 75);
      rowsOf.push([
        String(100000 + i),
        rand() < 0.5 ? 1000 + i : null,
        500 + i,
        rand() < 0.05 ? 20000 : area,
        null,
        year,
        rand() < 0.5 ? `N${i % 7}` : null,
        null,
        `${i} Main St, Example TX 7700${i % 3}`,
        ["f" + i, 0, null, "2026-01-01"],
        [0],
      ]);
    }
    rowsOf.sort(byArea);
    const write = (path: string, value: unknown) => {
      const full = join(root, path);
      execFileSync("mkdir", ["-p", join(full, "..")]);
      writeFileSync(full, JSON.stringify(value));
    };
    const list = buildList(rowsOf, "q/p/all", write);
    assert.ok(!("r" in list) && !("a" in list));
    assert.equal("cc" in list && list.cc !== undefined, n > 20000);
    const h: PoolHeader = {
      u: "fl:parcel:us-48997:",
      county: "997",
      category: "F1",
      tax_year: 2026,
      locs: [],
      all: list,
      buckets: 1,
    };
    const { decodeRow } = await import("./equity.ts");
    const pool = rowsOf.map((r) => ({
      urn: h.u + r[0],
      row: decodeRow(h, docs, r),
      docs: ["doc-0"],
    }));
    const pack = new Pack(fileAssets(root));
    for (let t = 0; t < 40; t++) {
      const subject = pool[Math.floor(rand() * pool.length)]!;
      const params = {
        area_band: [0.01, 0.1, 0.35, 1][t % 4]!,
        year_band: [0, 5, 15, 100][Math.floor(t / 4) % 4]!,
        min_matches: 10,
        limit: [1, 10, 200][t % 3]!,
      };
      // A subject outside the pool's neighborhoods and ZIP codes: every match is tier 2.
      const s = {
        ...subject.row,
        neighborhood_code: null,
        situs_address: null,
      };
      const rule = equityRule(subject.urn, s, params)!;
      const want = selectEquityCandidates(subject.urn, s, pool, params);
      const count = await listCount(pack, list, rule);
      assert.equal(count - 1, want.length, `count ${JSON.stringify(params)}`);
      const near = await listNearest(
        pack,
        h,
        docs,
        list,
        rule,
        2,
        params.limit,
      );
      assert.deepEqual(
        near.map((m) => m.urn),
        want.slice(0, params.limit).map((m) => m.urn),
        JSON.stringify(params),
      );
    }
  }
});

test("long lists share pages and read back whole", async () => {
  const root = mkdtempSync(join(tmpdir(), "factlot-pages-"));
  const pages = new SharedPages<number>();
  const lists = [5, 1, 12, 7, 30, 1, 4].map((n, i) =>
    Array.from({ length: n }, (_, j) => i * 100 + j),
  );
  const at = lists.map((l) => pages.add(l));
  const written = pages.write("p", 6, (path, v) => {
    execFileSync("mkdir", ["-p", join(root, path, "..")]);
    writeFileSync(join(root, path), JSON.stringify(v));
  });
  assert.equal(written, Math.ceil(60 / 6));
  const pack = new Pack(fileAssets(root));
  for (const [i, list] of lists.entries()) {
    const got: number[] = [];
    for await (const rows of listPages<number>(pack, "p", 6, at[i]!))
      got.push(...rows);
    assert.deepEqual(got, list);
  }
});

test("every pack withholds Tarrant, even when --exclude-county is left out", async () => {
  const x = join(dir, "tarrant-default.db");
  copyFileSync(fixture, x);
  const d = new DatabaseSync(x);
  d.exec("PRAGMA foreign_keys = OFF");
  for (const [t, c] of [
    ["subjects", "urn"],
    ["facts", "subject"],
    ["coverage", "subject"],
    ["relationships", "from_urn"],
    ["relationships", "to_urn"],
    ["crosswalk", "urn"],
    ["address_index", "urn"],
    ["name_index", "urn"],
    ["building_members", "building_urn"],
    ["building_members", "parcel_urn"],
  ])
    d.exec(
      `UPDATE ${t} SET ${c} = replace(${c}, 'us-48999:', 'us-48439:') WHERE ${c} LIKE '%us-48999:%'`,
    );
  d.exec(
    "UPDATE sources SET county_fips = '439' WHERE county_fips = '999'; DELETE FROM meta WHERE key = 'coverage'",
  );
  d.close();
  const pack = join(dir, "pack-tarrant-default");
  buildPack([{ name: "x", path: x }], pack); // no excludeCounties
  assert.deepEqual(packProblems(pack), []);
  for (const f of allFiles(pack))
    assert.ok(
      !/fl:(parcel|building):us-48439/.test(readFileSync(f, "utf8")),
      relative(pack, f),
    );
  // deploy.ts refuses a pack whose manifest serves the county or does not record it as withheld.
  const m = JSON.parse(
    readFileSync(join(pack, "manifest.json"), "utf8"),
  ) as Manifest;
  const bad = {
    ...m,
    withheld: {},
    counties: { ...m.counties, "us-48439": 0 },
  };
  writeFileSync(join(pack, "manifest.json"), JSON.stringify(bad));
  const problems = packProblems(pack);
  assert.ok(
    problems.some((p) => /serves county 48439/.test(p)),
    problems.join("\n"),
  );
  // And the Worker answers nothing of a withheld county, even from such a pack.
  const store = new Pack(fileAssets(pack));
  assert.equal(await store.entry("fl:parcel:us-48439:1"), undefined);
});

test("the suppression list: an entity is not served, a parcel loses its owner but keeps its facts", async () => {
  configureRegistry(fixture);
  let owned: { urn: string; owner: string } | undefined;
  let entity: string | undefined;
  try {
    const db = new DatabaseSync(fixture, { readOnly: true });
    const row = db
      .prepare(
        "SELECT subject, value_json FROM facts WHERE predicate = 'ownership.owner_of_record' LIMIT 1",
      )
      .get();
    owned = {
      urn: String(row!.subject),
      owner: JSON.parse(String(row!.value_json)) as string,
    };
    entity = String(
      db
        .prepare(
          "SELECT from_urn FROM relationships WHERE type = 'owns' AND from_urn LIKE 'fl:entity:%' LIMIT 1",
        )
        .get()!.from_urn,
    );
    db.close();
  } finally {
    configureRegistry(undefined);
  }
  const pack = join(dir, "pack-suppressed");
  const stats = buildPack(
    [{ name: "fixture", path: fixture }],
    pack,
    () => {},
    {
      suppression: {
        subjects: [entity!],
        owner_names: [owned!.owner.toLowerCase()],
      },
    },
  );
  assert.ok(stats.files > 0);
  const store = new Pack(fileAssets(pack));
  assert.equal(await store.entry(entity!), undefined, "the entity is gone");
  const parcel = await store.entry(owned!.urn);
  assert.ok(parcel, "the parcel is still served");
  const text = JSON.stringify(parcel);
  assert.ok(!text.includes("ownership.owner_of_record"), text.slice(0, 300));
  assert.ok(!text.includes("ownership.owner_mailing_address"));
  assert.ok(text.includes("parcel."), "its parcel facts stay");
});
