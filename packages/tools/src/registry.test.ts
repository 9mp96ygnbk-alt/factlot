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
  TX_EQUITY_NOTICE,
  TX_EQUITY_WITHHELD_COUNTIES,
  addressQuery,
  addressWordsWithoutOrdinals,
  configureRegistry,
  hostedWithheldCounties,
  legacyNormalizeAddress,
  legacyNormalizeName,
  normalizeAddress,
  normalizeName,
  runTool,
  withTxEquityCalcArgs,
} from "./index.ts";

const spec = fileURLToPath(new URL("../../../spec/registry/", import.meta.url));
// calls.json is what every surface answers (the registry Worker replays it too); calls_tx_batch.json
// holds registry_tx_equity_candidates_batch, which the SDKs answer and the Worker does not yet.
const calls = ["calls.json", "calls_tx_batch.json"].flatMap(
  (name) =>
    JSON.parse(readFileSync(join(spec, name), "utf8")) as {
      tool: string;
      arguments: unknown;
    }[],
);

test("registry tools without a registry report RegistryUnavailable", () => {
  configureRegistry(undefined);
  const saved = process.env.FACTLOT_REGISTRY_DB;
  delete process.env.FACTLOT_REGISTRY_DB;
  const r = runTool("registry_get", { urn: "fl:parcel:us-48201:1" });
  assert.equal(!r.ok && r.error.error, "RegistryUnavailable");
  if (saved !== undefined) process.env.FACTLOT_REGISTRY_DB = saved;
});

test("hosted withheld counties and the equity notice match Python", () => {
  const hosted = hostedWithheldCounties();
  assert.deepEqual(Object.keys(hosted), ["48439"]);
  assert.equal(hosted["48439"], TX_EQUITY_WITHHELD_COUNTIES["439"]);
  hosted["48439"] = "changed";
  assert.notEqual(hostedWithheldCounties()["48439"], "changed", "a fresh copy");
  assert.ok(
    TX_EQUITY_NOTICE.includes(
      "Not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)); not legal or tax advice and not a substitute for the advice of an attorney.",
    ),
  );
  assert.ok(
    TX_EQUITY_NOTICE.endsWith(
      "FactLot is software, not a property tax consultant under Texas Occupations Code chapter 1152; it does not prepare, file or advise on protests.",
    ),
  );
  const python = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json; from factlot.registry.tx_equity import NOTICE, hosted_withheld_counties; print(json.dumps({'notice': NOTICE, 'hosted': hosted_withheld_counties()}))",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: fileURLToPath(
            new URL("../../../python/src", import.meta.url),
          ),
        },
      },
    ),
  ) as { notice: string; hosted: Record<string, string> };
  assert.equal(python.notice, TX_EQUITY_NOTICE);
  assert.deepEqual(python.hosted, hostedWithheldCounties());
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
    // Two unusable areas, and so no usable improvement fact either.
    assert.equal(
      at({ urn: "fl:parcel:us-48999:0004-000-0002" }).warnings?.length,
      3,
    );
    // A unit record with no improvement facts warns and names the parcel of its building that has
    // them (here the common lot); that parcel does not warn.
    const unit = at({ urn: "fl:parcel:us-48999:0002-000-1002" }).warnings;
    assert.equal(unit?.length, 1);
    assert.match(unit?.[0] ?? "", /values may be for the land only/);
    assert.match(
      unit?.[0] ?? "",
      /has them: fl:parcel:us-48999:0002-000-1000\./,
    );
    assert.deepEqual(
      at({ urn: "fl:parcel:us-48999:0002-000-1000" }).warnings,
      [],
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
    // calc_args: paste-ready for calc_tx_unequal_appraisal, with exactly its fields.
    const full = eq.result as {
      subject: Record<string, unknown>;
      candidates: Record<string, unknown>[];
      calc_args: {
        tax_year: number;
        subject: Record<string, unknown>;
        comparables: Record<string, unknown>[];
      };
      selection_rule: {
        tax_year: number;
        tiers: { tier: string; matched: number; returned: number }[];
        notice: string;
      };
    };
    const allowed = new Set([
      "id",
      "label",
      "county_fips",
      "value",
      "value_basis",
      "improvement_area_sf",
      "land_area_sf",
      "citation",
    ]);
    assert.equal(full.calc_args.tax_year, 2026);
    assert.equal(full.calc_args.subject.id, subject);
    assert.deepEqual(
      full.calc_args.comparables.map((c) => c.id),
      full.candidates.map((c) => c.id),
    );
    for (const [i, c] of [
      full.calc_args.subject,
      ...full.calc_args.comparables,
    ].entries()) {
      for (const k of Object.keys(c)) assert.ok(allowed.has(k), `${i}: ${k}`);
      for (const v of Object.values(c)) assert.notEqual(v, null);
      const row = i === 0 ? full.subject : full.candidates[i - 1]!;
      if (typeof row.situs_address === "string")
        assert.equal(c.label, (row.situs_address as string).slice(0, 80));
    }
    const calc = runTool("calc_tx_unequal_appraisal", full.calc_args);
    assert.ok(calc.ok, JSON.stringify(calc.ok ? "" : calc.error));
    assert.equal(full.selection_rule.tax_year, 2026);
    assert.deepEqual(
      full.selection_rule.tiers.map((t) => [t.tier, t.returned]),
      [
        ["neighborhood", 2],
        ["zip", 4],
        ["county", 1],
      ],
    );
    assert.match(
      full.selection_rule.notice,
      /not a selection of comparables by FactLot/,
    );
    // An answer from a registry service that predates calc_args gets the same fields back.
    const { calc_args: _ca, selection_rule: _sr, ...old } = full;
    void [_ca, _sr];
    const rebuilt = withTxEquityCalcArgs(old) as typeof full;
    assert.deepEqual(rebuilt.calc_args, full.calc_args);
    assert.deepEqual(rebuilt.selection_rule, full.selection_rule);
    assert.equal(withTxEquityCalcArgs(full), full);
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
    // The batch: each subject answered exactly as the single tool answers it, minus the notice and
    // selection rule given once at the top; a subject's error stays in its entry.
    const batch = runTool("registry_tx_equity_candidates_batch", {
      subjects: [
        { id: "A", urn: subject },
        { id: "T", urn: "fl:parcel:us-48439:00001234" },
        { id: "M", urn: "fl:parcel:us-48997:9999999" },
      ],
      tax_year: 2026,
    });
    assert.ok(batch.ok);
    const b = batch.result as {
      results: Record<string, unknown>[];
      summary: { subjects: number; answered: number; errors: number };
      rule: string;
      notice: string;
    };
    const single = eq.result as Record<string, unknown>;
    const { notice: _n, selection: sel, ...rest } = single;
    const { rule: _r, ...selNoRule } = sel as Record<string, unknown>;
    void _n;
    void _r;
    assert.deepEqual(b.results[0], { id: "A", ...rest, selection: selNoRule });
    assert.equal(b.notice, single.notice);
    assert.equal(b.rule, (sel as { rule: string }).rule);
    assert.ok(!tarrant.ok);
    assert.deepEqual(b.results[1], {
      id: "T",
      error: tarrant.ok ? null : tarrant.error,
    });
    assert.equal((b.results[2]?.error as { error: string }).error, "NotFound");
    // Answered subjects are what the hosted API meters, one lookup each.
    assert.deepEqual(b.summary, { subjects: 3, answered: 1, errors: 2 });
    // Candidates only: nothing from calc_tx_unequal_appraisal (no formula, no computed values).
    assert.ok(!JSON.stringify(b).includes("calc.tx_unequal_appraisal"));
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
      ...calls.filter((c) =>
        c.tool.startsWith("registry_tx_equity_candidates"),
      ),
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
      // An error may quote the entity URN it was given (a batch subject's too); a result names no entity.
      const answers = !out.ok
        ? []
        : c.tool.endsWith("_batch")
          ? (
              out.result as { results: Record<string, unknown>[] }
            ).results.filter((r) => !("error" in r))
          : [out.result];
      for (const a of answers)
        assert.ok(
          !JSON.stringify(a).toUpperCase().includes("FL:ENTITY:"),
          `${label}: entity URN`,
        );
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

test("address search: a query with an ordinal finds a street the roll writes bare, when nothing else matched", () => {
  const db = fixtureDb("ordinals.db");
  db.exec(
    "INSERT INTO address_index VALUES ('136 W 42 ST EXAMPLE CITY TX 77999', 'fl:parcel:us-48999:0004-000-0001'); " +
      "INSERT INTO address_index VALUES ('9 5TH ST EXAMPLE CITY TX 77999', 'fl:parcel:us-48999:0003-000-0001'); " +
      "INSERT INTO address_index VALUES ('9 5 ST EXAMPLE CITY TX 77999', 'fl:parcel:us-48999:0001-000-0002')",
  );
  configureRegistry(db.path);
  try {
    const search = (query: string) => {
      const r = runTool("registry_search_address", { query });
      assert.ok(r.ok);
      return (r.result as { results: { urn: string }[] }).results.map(
        (x) => x.urn,
      );
    };
    assert.deepEqual(search("136 West 42nd Street"), [
      "fl:parcel:us-48999:0004-000-0001",
    ]);
    assert.deepEqual(search("W 42nd St"), ["fl:parcel:us-48999:0004-000-0001"]);
    assert.deepEqual(search("9 Fifth St"), [
      "fl:parcel:us-48999:0003-000-0001",
    ]);
    assert.deepEqual(search("9 5 St"), ["fl:parcel:us-48999:0001-000-0002"]);
    assert.deepEqual(search("136 W 43rd St"), []);
    assert.deepEqual(addressWordsWithoutOrdinals(["42ND", "ST"]), null);
    assert.deepEqual(addressWordsWithoutOrdinals(["W", "42ND", "ST"]), [
      "W",
      "42",
      "ST",
    ]);
    assert.deepEqual(addressWordsWithoutOrdinals(["100", "MAIN", "ST"]), null);
  } finally {
    configureRegistry(undefined);
  }
});

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

test("ownership links: only the owner the record shows is current, once per parcel", () => {
  // District 997 loads one source per roll year (2025, 2026 and a 2027 preliminary roll), and each year keeps
  // its owner facts and links. Synthetic organisations only.
  const db = fixtureDb("owners.db");
  configureRegistry(db.path);
  type Link = { from_urn: string; type: string; as_of: string };
  const get = (urn: string, asOf?: string) => {
    const r = runTool("registry_get", {
      urn,
      ...(asOf ? { as_of: asOf } : {}),
    });
    assert.ok(r.ok);
    const rec = r.result as {
      relationships: Link[];
      facts: { predicate: string; value: unknown }[];
    };
    return {
      owners: rec.relationships
        .filter((l) => l.type === "owns")
        .map((l) => [l.from_urn, l.as_of]),
      owner: rec.facts.find((f) => f.predicate === "ownership.owner_of_record")
        ?.value,
    };
  };
  const owned = (entity: string) => {
    const r = runTool("registry_owned_by", { entity_urn: entity });
    assert.ok(r.ok);
    return (r.result as { results: { urn: string }[] }).results.map(
      (x) => x.urn,
    );
  };
  const p = (apn: string) => `fl:parcel:us-48997:${apn}`;
  const BAYOU = "fl:entity:us-tx:0807777777";
  const PARTNERS = "fl:entity:us-tx:0808888888";
  try {
    // Owner changed on the newest roll: the new owner alone, from the roll the owner fact comes from.
    assert.deepEqual(get(p("1000002")), {
      owners: [[PARTNERS, "2027-04-15"]],
      owner: "Example Office Partners LP",
    });
    // The same owner on every roll: one link, not one per roll year.
    assert.deepEqual(get(p("1000001")).owners, [[BAYOU, "2027-04-15"]]);
    // A dated lookup shows the owner on the latest roll at or before the date.
    assert.deepEqual(get(p("1000002"), "2026-12-31"), {
      owners: [[BAYOU, "2026-10-15"]],
      owner: "Bayou Equity Holdings LLC",
    });
    assert.deepEqual(get(p("1000001"), "2025-12-31").owners, [
      [BAYOU, "2025-07-25"],
    ]);
    // A parcel on an older roll only keeps that roll's owner.
    assert.deepEqual(get(p("1000010")).owners, [[BAYOU, "2025-07-25"]]);
    // Portfolios: each parcel once; the former owner no longer holds the parcel it sold.
    const bayou = owned(BAYOU);
    assert.equal(new Set(bayou).size, bayou.length);
    assert.ok(bayou.includes(p("1000001")) && bayou.includes(p("1000010")));
    assert.ok(!bayou.includes(p("1000002")));
    assert.deepEqual(owned(PARTNERS), [
      p("1000002"),
      p("1000003"),
      p("1000004"),
    ]);
    // A parcel from a single-source roll is unchanged: its one owner, linked from its latest snapshot.
    assert.deepEqual(
      get("fl:parcel:us-48999:0001-000-0001").owners.map((o) => o[0]),
      ["fl:entity:us-tx:0801111111"],
    );
  } finally {
    configureRegistry(undefined);
  }
});
