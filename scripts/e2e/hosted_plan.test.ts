import assert from "node:assert/strict";
import test from "node:test";

import { RegistryGate, isPaidOnlyCall, plannedSpend } from "./hosted_plan.ts";

const headers = (h: Record<string, string>) => ({
  get: (n: string) => h[n] ?? null,
});

test("paid-only registry calls: batches, recorded facts, dated get, candidates with a tax year", () => {
  assert.equal(isPaidOnlyCall("registry_lookup_batch", { items: [] }), true);
  assert.equal(
    isPaidOnlyCall("registry_tx_equity_candidates_batch", { subjects: [] }),
    true,
  );
  assert.equal(isPaidOnlyCall("registry_recorded_facts", { urn: "x" }), true);
  assert.equal(isPaidOnlyCall("registry_get", { urn: "x" }), false);
  assert.equal(
    isPaidOnlyCall("registry_get", { urn: "x", as_of: "2025-01-01" }),
    true,
  );
  assert.equal(
    isPaidOnlyCall("registry_tx_equity_candidates", {
      urn: "x",
      tax_year: 2025,
    }),
    true,
  );
  assert.equal(
    isPaidOnlyCall("registry_tx_equity_candidates", { urn: "x" }),
    false,
  );
  assert.equal(
    isPaidOnlyCall("rules_tx_property_tax_protest_deadline_batch", {}),
    false,
  );
});

test("planned spend: finds count, misses and PlanRequired do not, a batch counts per item", () => {
  const calls = [
    { tool: "registry_get", arguments: { urn: "a" }, finds: true },
    { tool: "registry_get", arguments: { urn: "miss" }, finds: false },
    {
      tool: "registry_lookup_batch",
      arguments: { items: [{ urn: "a" }, { urn: "b" }] },
      finds: true,
    },
  ];
  assert.deepEqual(
    plannedSpend(calls, {
      paid: false,
      keyed: false,
      reports: true,
      unknown: 3,
    }),
    { lookups: 1, lookups_max: 4, reports: 1, model_calls: 0 },
  );
  assert.deepEqual(
    plannedSpend(calls, { paid: true, keyed: true, reports: true, unknown: 0 }),
    { lookups: 3, lookups_max: 3, reports: 1, model_calls: 4 },
  );
  assert.deepEqual(
    plannedSpend(calls, {
      paid: true,
      keyed: true,
      reports: false,
      unknown: 0,
    }),
    { lookups: 3, lookups_max: 3, reports: 0, model_calls: 0 },
  );
});

test("the registry gate stops at the first used-up answer and reports it once", () => {
  const g = new RegistryGate();
  assert.equal(g.open(), true);
  assert.equal(
    g.observe(
      200,
      undefined,
      headers({ "x-factlot-registry-quota-remaining": "2" }),
    ),
    true,
  );
  assert.equal(g.remaining, 2);
  assert.equal(
    g.observe(
      429,
      "RegistryQuotaExceeded",
      headers({ "x-factlot-registry-quota-reset": "2026-11-14T00:00:00Z" }),
    ),
    false,
  );
  assert.equal(g.open(), false);
  assert.equal(g.open(), false);
  assert.match(
    g.failure()!,
    /after 1 registry calls .*the 2 registry calls after it were not made \(the allowance resets at 2026-11-14T00:00:00Z\)/,
  );
});

test("the registry gate stops before a call when the quota header says none is left", () => {
  const g = new RegistryGate();
  g.observe(
    200,
    undefined,
    headers({ "x-factlot-registry-quota-remaining": "0" }),
  );
  assert.equal(g.open(), false);
  assert.match(g.failure()!, /none left in the quota header/);
  const fresh = new RegistryGate();
  fresh.observe(404, "NotFound", headers({}));
  assert.equal(fresh.open(), true);
  assert.equal(fresh.failure(), null);
});
