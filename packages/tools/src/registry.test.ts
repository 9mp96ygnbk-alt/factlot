// Cross-language parity: the Python pipeline builds a (synthetic) registry; Python and
// TypeScript then answer the same tool calls and must return identical JSON.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { countyName } from "./county_names.ts";

import {
  addressQuery,
  configureRegistry,
  legacyNormalizeAddress,
  legacyNormalizeName,
  normalizeAddress,
  normalizeName,
  runTool,
} from "./index.ts";

const spec = fileURLToPath(new URL("../../../spec/registry/", import.meta.url));
const calls = JSON.parse(readFileSync(join(spec, "calls.json"), "utf8")) as {
  tool: string;
  arguments: unknown;
}[];

test("registry tools without a registry report RegistryUnavailable", () => {
  configureRegistry(undefined);
  const saved = process.env.FACTLOT_REGISTRY_DB;
  delete process.env.FACTLOT_REGISTRY_DB;
  const r = runTool("registry_get", { urn: "fl:parcel:us-48201:1" });
  assert.equal(!r.ok && r.error.error, "RegistryUnavailable");
  if (saved !== undefined) process.env.FACTLOT_REGISTRY_DB = saved;
});

test("registry tools: TypeScript matches Python on the shared fixture", () => {
  const db = join(
    mkdtempSync(join(tmpdir(), "factlot-registry-")),
    "fixture.db",
  );
  execFileSync("python3", [join(spec, "build_fixture.py"), db]);
  const python = JSON.parse(
    execFileSync("python3", [join(spec, "query_fixture.py"), db], {
      encoding: "utf8",
    }),
  ) as Record<string, unknown>[];
  configureRegistry(db);
  try {
    calls.forEach((c, i) => {
      const outcome = runTool(c.tool, c.arguments);
      const ts = outcome.ok ? outcome.result : outcome.error;
      const py = python[i] as Record<string, unknown>;
      const label = `${c.tool} ${JSON.stringify(c.arguments)}`;
      // A NotFound carries a message and coverage both languages must word alike; other errors
      // (input validation) are compared by kind only.
      if ("error" in py && py.error !== "NotFound") {
        assert.equal((ts as { error: string }).error, py.error, label);
      } else {
        assert.deepEqual(JSON.parse(JSON.stringify(ts)), py, label);
      }
    });
    // A parcel holds many sales: all current ones are returned, newest first (price breaks a date tie).
    const parcel = python[0] as {
      facts: { predicate: string; value: unknown }[];
    };
    assert.deepEqual(
      parcel.facts
        .filter((f) => f.predicate === "transaction.sale")
        .map((f) => (f.value as { price_usd: number }).price_usd),
      [12500000, 9000000, 0],
    );
    assert.equal(
      parcel.facts.filter((f) => f.predicate === "zoning.district").length,
      1,
    );
    const at = (args: Record<string, unknown>) =>
      python[
        calls.findIndex(
          (c) => JSON.stringify(c.arguments) === JSON.stringify(args),
        )
      ] as {
        status?: string;
        facts?: { predicate: string; value: unknown }[];
        warnings?: string[];
        results?: unknown[];
        coverage?: { message: string };
      };
    const p1 = "fl:parcel:us-48999:0001-000-0001";
    // as_of: the 2025 roll's facts on a 2025 date; nothing before the first snapshot.
    const y2025 = at({ urn: p1, as_of: "2025-12-31" });
    assert.equal(
      y2025.facts?.find((f) => f.predicate === "parcel.market_value")?.value,
      21000000,
    );
    assert.equal(
      at({ urn: p1, as_of: "2024-01-01" }).status,
      "not_yet_recorded",
    );
    assert.deepEqual(at({ urn: p1, as_of: "2024-01-01" }).facts, []);
    // Area sanity checks: a warning, the facts untouched.
    const tower = at({ urn: "fl:parcel:us-48999:0004-000-0001" });
    assert.equal(tower.warnings?.length, 1);
    assert.match(tower.warnings?.[0] ?? "", /1666\.7 times/);
    assert.equal(
      tower.facts?.find((f) => f.predicate === "parcel.land_area_sf")?.value,
      150,
    );
    assert.equal(
      at({ urn: "fl:parcel:us-48999:0004-000-0002" }).warnings?.length,
      2,
    );
    // Address search by whole words: a bare name or a partial word finds nothing.
    assert.deepEqual(at({ query: "Main" }).results, []);
    assert.match(at({ query: "Main" }).coverage?.message ?? "", /whole words/);
    assert.deepEqual(at({ query: "100 Mai" }).results, []);
    assert.equal(at({ query: "Main St" }).results?.length, 1);
    assert.equal(at({ query: "100 Main" }).results?.length, 1);
    // Recorded deeds, mortgages and satisfactions are many-valued too, newest first; an energy report is single-valued.
    const dates = (predicate: string) =>
      parcel.facts
        .filter((f) => f.predicate === predicate)
        .map((f) => (f.value as { date: string }).date);
    assert.deepEqual(dates("transaction.deed"), ["2025-03-14", "2021-07-02"]);
    assert.deepEqual(dates("debt.mortgage_recorded"), [
      "2025-03-20",
      "2025-03-20",
    ]);
    assert.deepEqual(dates("debt.mortgage_satisfaction_recorded"), [
      "2024-11-05",
    ]);
    assert.equal(
      parcel.facts.filter((f) => f.predicate === "energy.site_eui").length,
      1,
    );
    // A building holds one debt.cmbs_loan fact per trust that holds a note of its loan, newest report first.
    const building = at({
      urn: "fl:building:us-48999:77999:300-harbor-dr",
    }) as {
      facts?: { predicate: string; value: { trust: string } }[];
    };
    assert.deepEqual(
      (building.facts ?? [])
        .filter((f) => f.predicate === "debt.cmbs_loan")
        .map((f) => f.value.trust),
      ["Other 2026-C2 Mortgage Trust", "Example 2026-C1 Mortgage Trust"],
    );
    // Value history: a tax year two snapshots value differently is listed twice, newest first.
    const subject = "fl:parcel:us-48997:1000001";
    const history = (
      at({ urn: subject }) as {
        value_history?: { tax_year: number; as_of: string }[];
      }
    ).value_history;
    assert.deepEqual(
      history?.map((e) => [e.tax_year, e.as_of]),
      [
        [2027, "2027-04-15"],
        [2026, "2026-10-15"],
        [2026, "2026-07-25"],
        [2025, "2025-07-25"],
      ],
    );
    // Equity candidates: tiers in order.
    const eq = runTool("registry_tx_equity_candidates", {
      urn: subject,
      tax_year: 2026,
    });
    assert.ok(eq.ok);
    const result = eq.result as {
      selection: { tiers: { tier: string; ids: string[] }[] };
    };
    assert.deepEqual(
      result.selection.tiers.map((t) => [t.tier, t.ids.length]),
      [
        ["neighborhood", 2],
        ["zip", 4],
        ["county", 1],
      ],
    );
    // One tax year at a time: the 2027 preliminary roll's codes and class, never 2026's.
    const y2027 = runTool("registry_tx_equity_candidates", { urn: subject });
    assert.ok(y2027.ok);
    const r2027 = y2027.result as {
      subject: { building_class: string | null };
      candidates: {
        id: string;
        neighborhood_code: string | null;
        building_class: string | null;
        tax_year: number;
      }[];
      selection: { tax_year: number; roll_sources: string[] };
    };
    assert.deepEqual(
      [
        r2027.selection.tax_year,
        r2027.selection.roll_sources,
        r2027.subject.building_class,
      ],
      [2027, ["test-cad-997-2027"], "C"],
    );
    assert.deepEqual(
      r2027.candidates.map((c) => [
        c.id.slice(-2),
        c.neighborhood_code,
        c.building_class,
        c.tax_year,
      ]),
      [
        ["02", "N150", "A", 2027],
        ["09", "N300", null, 2027],
      ],
    );
    const tarrant = runTool("registry_tx_equity_candidates", {
      urn: "fl:parcel:us-48439:00001234",
    });
    assert.ok(!tarrant.ok && tarrant.error.error === "InputError");
    assert.match(
      tarrant.ok ? "" : tarrant.error.message,
      /Tarrant Appraisal District's published signals do not say whether serving its data to AI agents is allowed/,
    );
    // No owner data in any equity output (TypeScript's own run): every ownership.* fact ID and value in
    // the file, what the roll gave for the owners the registry does not keep (a natural person, an owner
    // withheld under Tax Code §25.025), and in a result any entity URN.
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (
        p: string,
        o?: { readOnly?: boolean },
      ) => {
        prepare(sql: string): {
          all(...p: unknown[]): Record<string, unknown>[];
        };
        close(): void;
      };
    };
    const file = new DatabaseSync(db, { readOnly: true });
    const ownerRows = file
      .prepare(
        "SELECT fact_id, value_json, subject FROM facts WHERE predicate LIKE 'ownership.%'",
      )
      .all();
    file.close();
    const person = "fl:parcel:us-48997:1000014";
    const withheld = "fl:parcel:us-48997:1000015";
    assert.ok(
      !ownerRows.some((r) => r.subject === person || r.subject === withheld),
    );
    const banned = new Set<string>([
      "Jane Q Example",
      "Jane",
      "12 Quiet Lane",
      "CONFIDENTIAL",
    ]);
    for (const r of ownerRows) {
      banned.add(String(r.fact_id));
      const v: unknown = JSON.parse(String(r.value_json));
      if (typeof v === "string") banned.add(v);
    }
    assert.ok(banned.has("Bayou Equity Holdings LLC"));
    assert.ok(
      (result as unknown as { candidates: { id: string }[] }).candidates.some(
        (c) => c.id === person,
      ) &&
        (result as unknown as { candidates: { id: string }[] }).candidates.some(
          (c) => c.id === withheld,
        ),
    );
    const equityCalls = [
      ...calls.filter((c) => c.tool === "registry_tx_equity_candidates"),
      { tool: "registry_tx_equity_candidates", arguments: { urn: person } },
      { tool: "registry_tx_equity_candidates", arguments: { urn: withheld } },
    ];
    for (const c of equityCalls) {
      const out = runTool(c.tool, c.arguments);
      const text = JSON.stringify(
        out.ok ? out.result : out.error,
      ).toUpperCase();
      const label = JSON.stringify(c.arguments);
      for (const b of banned)
        assert.ok(!text.includes(b.toUpperCase()), `${label}: ${b}`);
      assert.ok(!text.includes("OWNERSHIP."), `${label}: ownership.`);
      // An error may quote the entity URN it was given; a result names no entity.
      if (out.ok)
        assert.ok(!text.includes("FL:ENTITY:"), `${label}: entity URN`);
    }
  } finally {
    configureRegistry(undefined);
  }
});

test("name and address normalization match the Python vectors", () => {
  const v = JSON.parse(readFileSync(join(spec, "normalize.json"), "utf8")) as {
    names: [string, string][];
    addresses: [string, string][];
    legacy_addresses: [string, string][];
    address_queries: [string, { mode: string | null; tokens: string[] }][];
  };
  for (const [input, expected] of v.names)
    assert.equal(normalizeName(input), expected, input);
  for (const [input, expected] of v.addresses)
    assert.equal(normalizeAddress(input), expected, input);
  for (const [input, expected] of v.legacy_addresses)
    assert.equal(legacyNormalizeAddress(input), expected, input);
  for (const [input, expected] of v.address_queries)
    assert.deepEqual(addressQuery(input), expected, input);
});

test("county names come from the Census table in spec/registry/county-names.tsv", () => {
  const rows = readFileSync(join(spec, "county-names.tsv"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t") as [string, string]);
  assert.ok(rows.length > 3000);
  for (const [fips, name] of rows) assert.equal(countyName(fips), name, fips);
  assert.equal(countyName("04021"), "Pinal County");
  assert.equal(countyName("48999"), undefined);
});

test("entity search uses the name keys the file was built with", () => {
  const db = join(mkdtempSync(join(tmpdir(), "factlot-registry-")), "keys.db");
  execFileSync("python3", [join(spec, "build_fixture.py"), db]);
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (p: string) => {
      exec(sql: string): void;
      prepare(sql: string): { get(...a: unknown[]): Record<string, unknown> };
    };
  };
  const w = new DatabaseSync(db);
  const urn = String(
    w.prepare("SELECT urn FROM subjects WHERE kind = 'entity' LIMIT 1").get()
      .urn,
  );
  // A key only the earlier rules make ("W G G"); the current rules make "WGG".
  w.exec(
    `INSERT INTO name_index VALUES ('W G G PROPERTIES LLC', '${urn}'); ` +
      "DELETE FROM meta WHERE key = 'name_key_version'",
  );
  const search = () => {
    const r = runTool("registry_search_entities", {
      query: "W.G.G. Properties LLC",
    });
    assert.ok(r.ok);
    return (r.result as { results: { urn: string }[] }).results.map(
      (x) => x.urn,
    );
  };
  configureRegistry(db);
  try {
    assert.deepEqual(
      search(),
      [urn],
      "a version 1 file is searched by version 1 keys",
    );
    w.exec("INSERT INTO meta VALUES ('name_key_version', '2')");
    configureRegistry(db);
    assert.deepEqual(
      search(),
      [],
      "a re-keyed file is searched by current keys",
    );
    assert.equal(
      legacyNormalizeName("W.G.G. Properties LLC"),
      "W G G PROPERTIES LLC",
    );
  } finally {
    configureRegistry(undefined);
  }
});

function fixtureDb(name: string): {
  path: string;
  exec(sql: string): void;
} {
  const path = join(mkdtempSync(join(tmpdir(), "factlot-registry-")), name);
  execFileSync("python3", [join(spec, "build_fixture.py"), path]);
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (p: string) => { exec(sql: string): void };
  };
  const w = new DatabaseSync(path);
  return { path, exec: (sql) => w.exec(sql) };
}

test("address search uses the address keys the file was built with", () => {
  const db = fixtureDb("addresses.db");
  // A file built before address key version 2 spells directionals out in its keys.
  db.exec(
    "DELETE FROM address_index; DELETE FROM meta WHERE key = 'address_key_version'; " +
      "INSERT INTO address_index VALUES ('9 NORTHWEST INDUSTRIAL WAY EXAMPLE CITY TX 77999', 'fl:parcel:us-48999:0003-000-0001')",
  );
  const search = (query: string) => {
    const r = runTool("registry_search_address", { query });
    assert.ok(r.ok);
    return (r.result as { results: { urn: string }[] }).results.map(
      (x) => x.urn,
    );
  };
  configureRegistry(db.path);
  try {
    assert.deepEqual(search("9 Northwest Industrial Way"), [
      "fl:parcel:us-48999:0003-000-0001",
    ]);
    assert.deepEqual(search("9 NW Industrial Way"), []);
    db.exec("INSERT INTO meta VALUES ('address_key_version', '2')");
    configureRegistry(db.path);
    assert.deepEqual(
      search("9 Northwest Industrial Way"),
      [],
      "a re-keyed file is searched by current keys only",
    );
  } finally {
    configureRegistry(undefined);
  }
});

test("coverage computed on read equals the stored summary, and a stale one is recomputed", () => {
  const db = fixtureDb("coverage.db");
  const coverage = () => {
    configureRegistry(db.path);
    const r = runTool("registry_coverage", {});
    assert.ok(r.ok);
    return r.result as { totals: { parcels: number } };
  };
  try {
    const stored = coverage();
    db.exec("DELETE FROM meta WHERE key = 'coverage'");
    assert.deepEqual(coverage(), stored);
    // A stored summary whose stamp no longer matches the file is ignored.
    db.exec(
      `INSERT INTO meta VALUES ('coverage', '${JSON.stringify({ stamp: { snapshots: 1, subjects_max_rowid: 1 }, summary: { ...stored, totals: { parcels: -1 } } })}')`,
    );
    assert.equal(coverage().totals.parcels, stored.totals.parcels);
  } finally {
    configureRegistry(undefined);
  }
});
