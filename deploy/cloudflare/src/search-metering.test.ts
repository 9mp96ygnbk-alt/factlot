// Which address-search misses the hosted API charges (isChargedAnswer): a search kept to a county the registry does
// not hold cannot match, so it is free, as registry_resolve_parcel on such a county is; a city or ZIP code in counties
// it does not hold does not keep the search anywhere, so that miss found nothing inside loaded coverage.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addressMiss,
  type RegistryCoverage,
} from "../../../packages/tools/src/registry.ts";

import { foundNothing, isChargedAnswer } from "./router.ts";

const cov: RegistryCoverage = {
  counties: [
    {
      region: "us-48201",
      state_fips: "48",
      county_fips: "201",
      state: "TX",
      parcels: 10,
      buildings: 0,
      sources: [{ source_id: "tx-harris", as_of: "2026-07-25" }],
    },
  ],
  entity_registries: [],
  crosswalk_systems: [],
  totals: {
    parcels: 10,
    entities: 0,
    buildings: 0,
    counties: 1,
    states: ["TX"],
  },
};

test("an address search kept to a county the registry does not hold is not charged", () => {
  for (const where of [
    { county_fips: "48439" },
    { state: "TX", county_fips: "439" },
  ]) {
    const coverage = addressMiss(cov, "301 Commerce St", where);
    assert.equal(coverage.reason, "county_not_loaded");
    assert.equal(coverage.county_loaded, false);
    assert.equal(isChargedAnswer({ results: [], coverage }), false);
  }
  // A city or ZIP code that lies wholly in counties the registry does not hold (San Antonio: Bexar, Comal, Medina;
  // 78205: Bexar) is said so, but a city or ZIP code never filters: the search ran over every county held (in Texas,
  // or everywhere), so the miss is inside loaded coverage, an answer that found nothing (free within the hourly
  // guard, counted past it). A county_fips the registry holds keeps the search to it: the place is not read.
  for (const [query, where] of [
    ["803 N Grant Ave, San Antonio, TX", {}],
    ["803 N Grant Ave, 78205", {}],
    ["803 N Grant Ave", { city: "San Antonio", state: "TX" }],
    [
      "803 N Grant Ave",
      { city: "San Antonio", state: "TX", county_fips: "48201" },
    ],
  ] as const) {
    const miss = addressMiss(cov, query, where);
    const label = `${query} ${JSON.stringify(where)}`;
    assert.equal(miss.county_loaded, undefined, label);
    assert.equal(isChargedAnswer({ results: [], coverage: miss }), true, label);
    assert.equal(
      foundNothing("registry_search_address", { results: [], coverage: miss }),
      true,
      label,
    );
    if ("county_fips" in where) {
      assert.equal(miss.reason, "no_match", label);
      assert.equal(miss.place_counties, undefined, label);
    } else assert.equal(miss.reason, "county_not_loaded", label);
  }
  const houston = addressMiss(cov, "1 Nowhere Rd, Houston, TX");
  assert.equal(houston.county_loaded, undefined);
  assert.equal(isChargedAnswer({ results: [], coverage: houston }), true);
  // Other misses in a loaded state are charged as before.
  const street = addressMiss(cov, "1 Nowhere Rd, Houston, TX");
  assert.equal(street.state_loaded, true);
  assert.equal(isChargedAnswer({ results: [], coverage: street }), true);
  // A state that is not loaded stays free.
  const state = addressMiss(cov, "1 Main St, Chicago, IL");
  assert.equal(isChargedAnswer({ results: [], coverage: state }), false);
});
