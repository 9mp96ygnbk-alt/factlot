import assert from "node:assert/strict";
import test from "node:test";

import {
  configureRegistry,
  configureRegistryRunner,
  registryAvailable,
  runToolAsync,
  type ToolOutcome,
} from "./index.ts";

test("registry runner answers registry tools with checked, defaulted input", async (t) => {
  const prior = process.env.FACTLOT_REGISTRY_DB;
  delete process.env.FACTLOT_REGISTRY_DB;
  configureRegistry(undefined);
  t.after(() => {
    configureRegistryRunner(undefined);
    if (prior !== undefined) process.env.FACTLOT_REGISTRY_DB = prior;
  });
  assert.equal(registryAvailable(), false);

  const calls: [string, unknown][] = [];
  configureRegistryRunner(async (name, input) => {
    calls.push([name, input]);
    return { ok: true, result: { urn: "fl:parcel:us-11001:x" } };
  });
  assert.equal(registryAvailable(), true);

  const out = await runToolAsync("registry_search_address", {
    query: "1200 Main St",
  });
  assert.deepEqual(out, { ok: true, result: { urn: "fl:parcel:us-11001:x" } });
  // The schema default for limit is applied before the runner sees the input.
  assert.deepEqual(calls, [
    ["registry_search_address", { query: "1200 Main St", limit: 20 }],
  ]);

  // Bad input never reaches the runner.
  const bad = await runToolAsync("registry_search_address", { query: "" });
  assert.equal(bad.ok, false);
  assert.equal(calls.length, 1);

  // Other tools do not go through it.
  const id = await runToolAsync("id_parcel", {
    state_fips: "11",
    county_fips: "001",
    apn: "0001 0001",
  });
  assert.equal(calls.length, 1);
  assert.equal(id.ok, true);
});

test("a registry runner that fails reports RegistryUnavailable", async (t) => {
  t.after(() => configureRegistryRunner(undefined));
  configureRegistryRunner(async () => {
    throw new Error("binding down");
  });
  const out: ToolOutcome = await runToolAsync("registry_coverage", {});
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.error.error, "RegistryUnavailable");
    assert.doesNotMatch(out.error.message, /binding down/);
  }
});

test("candidate answers from a registry service without calc_args get calc_args and selection_rule", async (t) => {
  t.after(() => configureRegistryRunner(undefined));
  const urn = "fl:parcel:us-48201:0011440000001";
  const comp = (n: number, situs: string | null) => ({
    id: `fl:parcel:us-48201:00000000000${n}`,
    county_fips: "201",
    value: 1_000_000 + n,
    value_basis: "appraised",
    market_value: 1_100_000,
    appraised_value: 1_000_000 + n,
    improvement_area_sf: 10_000,
    land_area_sf: null,
    year_built: 1990,
    state_property_category: "F1",
    neighborhood_code: "N1",
    building_class: null,
    situs_address: situs,
    tax_year: 2026,
    citation: {
      fact_id: `fl:fact:${n}`,
      document_id: "fl:document:sha256-x",
      locator: null,
      as_of: "2026-07-25",
    },
  });
  const answer = {
    subject: {
      ...comp(0, "1000 LOUISIANA ST, HOUSTON, TX 77002"),
      id: urn,
      value_history: [],
    },
    candidates: [comp(1, "1 MAIN ST, HOUSTON, TX 77002"), comp(2, null)],
    selection: {
      rule: "r",
      parameters: {
        area_band: 0.35,
        year_band: 15,
        min_matches: 10,
        limit: 50,
        tax_year: null,
      },
      tax_year: 2026,
      criteria: {
        state_property_category: "F1",
        improvement_area_sf: { subject: 10_000, min: 6_500, max: 13_500 },
        year_built: { subject: 1990, min: 1975, max: 2005 },
      },
      tiers: [
        {
          tier: "neighborhood",
          key: "N1",
          applied: true,
          matched: 2,
          returned: 2,
          ids: [],
        },
      ],
      widened_to_county: false,
      matched: 2,
      returned: 2,
    },
    sources: [],
    notice: "n",
    warnings: [],
  };
  configureRegistryRunner(async (name) =>
    name === "registry_tx_equity_candidates"
      ? { ok: true, result: answer }
      : {
          ok: true,
          result: {
            results: [
              { id: "A", ...answer },
              { id: "B", error: { error: "NotFound" } },
            ],
          },
        },
  );
  const one = await runToolAsync("registry_tx_equity_candidates", { urn });
  assert.ok(one.ok);
  const r = one.result as {
    calc_args: {
      tax_year: number;
      subject: Record<string, unknown>;
      comparables: Record<string, unknown>[];
    };
    selection_rule: { area_band: unknown; notice: string };
  };
  assert.deepEqual(r.calc_args.subject, {
    id: urn,
    label: "1000 LOUISIANA ST, HOUSTON, TX 77002",
    county_fips: "201",
    value: 1_000_000,
    value_basis: "appraised",
    improvement_area_sf: 10_000,
  });
  assert.deepEqual(r.calc_args.comparables[0], {
    id: "fl:parcel:us-48201:000000000001",
    label: "1 MAIN ST, HOUSTON, TX 77002",
    county_fips: "201",
    value: 1_000_001,
    value_basis: "appraised",
    improvement_area_sf: 10_000,
    citation: {
      fact_id: "fl:fact:1",
      document_id: "fl:document:sha256-x",
      as_of: "2026-07-25",
    },
  });
  assert.equal("label" in r.calc_args.comparables[1]!, false);
  assert.deepEqual(r.selection_rule.area_band, {
    share: 0.35,
    min_sf: 6_500,
    max_sf: 13_500,
  });
  const batch = await runToolAsync("registry_tx_equity_candidates_batch", {
    subjects: [
      { id: "A", urn },
      { id: "B", urn },
    ],
  });
  assert.ok(batch.ok);
  const results = (batch.result as { results: Record<string, unknown>[] })
    .results;
  assert.deepEqual(results[0]!.calc_args, r.calc_args);
  assert.equal("calc_args" in results[1]!, false);
});
