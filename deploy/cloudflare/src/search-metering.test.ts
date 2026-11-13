// Which address-search misses the hosted API charges (isChargedAnswer): a search kept to a county the registry does
// not hold cannot match, so it is free, as registry_resolve_parcel on such a county is.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addressMiss,
  type RegistryCoverage,
} from "../../../packages/tools/src/registry.ts";

import { isChargedAnswer } from "./router.ts";

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
  // A place that lies wholly in counties the registry does not hold (San Antonio: Bexar, Comal, Medina) is the
  // same miss: free. One that lies partly in a held county (Houston: Harris) stays a miss inside coverage.
  const sa = addressMiss(cov, "4000 Medical Dr, San Antonio, TX");
  assert.equal(sa.reason, "county_not_loaded");
  assert.equal(sa.county_loaded, false);
  assert.equal(isChargedAnswer({ results: [], coverage: sa }), false);
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
