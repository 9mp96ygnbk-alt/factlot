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
