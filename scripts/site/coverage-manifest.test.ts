// The one coverage manifest (site/coverage.json): every published coverage figure, by store, with
// its date. These tests keep the surfaces from drifting apart again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { withCoverageStore } from "../../deploy/cloudflare/src/registry.ts";
import { RESOURCE_DATA } from "../../packages/mcp/src/resource-data.ts";
import { coverageResource } from "../../packages/mcp/src/resources.ts";

import { buildCoverageCatalog } from "./coverage-catalog.mjs";
import {
  COVERAGE_FILE,
  COVERAGE_PAGE,
  coverageDifferences,
  hostedFigures,
  pageStatesStores,
  storesText,
  type CoverageManifest,
} from "./gen-coverage.ts";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL(COVERAGE_FILE, root), "utf8"),
) as CoverageManifest;

test("the manifest is current: the hosted store is the pack manifest's figures, every store has a date", () => {
  assert.deepEqual(coverageDifferences(manifest), []);
  const hosted = manifest.stores.find((s) => s.id === "hosted_registry")!;
  assert.deepEqual(
    {
      parcels: hosted.parcels,
      counties: hosted.counties,
      states: hosted.states,
      computed_at: hosted.computed_at,
    },
    hostedFigures(),
  );
  assert.deepEqual(manifest.stores.map((s) => s.id).sort(), [
    "hosted_registry",
    "record",
  ]);
});

test("a stale manifest is caught", () => {
  const stale = structuredClone(manifest);
  stale.stores[0]!.parcels += 1;
  assert.match(
    coverageDifferences(stale).join(" "),
    /hosted_registry\.parcels/,
  );
});

test("the coverage page states both stores, each with its date, from the manifest", () => {
  const page = readFileSync(new URL(COVERAGE_PAGE, root), "utf8");
  assert.ok(pageStatesStores(page, manifest));
  for (const s of manifest.stores)
    assert.ok(storesText(manifest).includes(s.computed_at.slice(0, 10)));
});

test("factlot://coverage carries the manifest's stores and says which store its own figures describe", () => {
  const r = coverageResource(RESOURCE_DATA, {
    hosted: true,
    registry: true,
  } as never) as {
    store: string;
    stores: unknown;
    totals: { parcels: number };
  };
  assert.equal(r.store, "hosted_registry");
  assert.deepEqual(
    r.stores,
    manifest.stores.map((s) => ({
      id: s.id,
      name: s.name,
      describes: s.describes,
      parcels: s.parcels,
      counties: s.counties,
      states: s.states,
      computed_at: s.computed_at,
      computed_from: s.computed_from,
    })),
  );
  assert.equal(
    r.totals.parcels,
    manifest.stores.find((s) => s.id === "hosted_registry")!.parcels,
  );
});

test("the hosted registry_coverage answer names its store and build time; every existing field is unchanged", () => {
  const before = {
    ok: true as const,
    result: { counties: [{ region: "us-48257", parcels: 3 }], sources: [] },
  };
  const after = withCoverageStore("registry_coverage", before) as unknown as {
    result: typeof before.result & {
      store: { id: string; computed_at: string; manifest: string };
    };
  };
  const { store, ...rest } = after.result;
  assert.deepEqual(rest, before.result);
  const hosted = manifest.stores.find((s) => s.id === "hosted_registry")!;
  assert.equal(store.id, "hosted_registry");
  assert.equal(store.computed_at, hosted.computed_at);
  assert.equal(store.manifest, "https://factlot.com/coverage.json");
  // Any other tool, and an error, pass through untouched.
  assert.equal(withCoverageStore("registry_get", before), before);
});

test("/coverage.json carries every store with its date", () => {
  const cat = buildCoverageCatalog({
    hosted: JSON.parse(
      readFileSync(new URL("site/_data/hosted.json", root), "utf8"),
    ),
    configs: new Map(),
    toolNames: [],
    version: "0",
    idExampleUrn: () => "",
    stores: manifest,
  });
  assert.equal(cat.store, "hosted_registry");
  assert.deepEqual(cat.stores, manifest.stores);
});
