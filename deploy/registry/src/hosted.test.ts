// registry_coverage on the hosted registry: each county carries its field availability from the pack manifest.
import assert from "node:assert/strict";
import test from "node:test";

import type { CountyFields } from "../../../packages/tools/src/fields.ts";
import type { RegistryCoverage } from "../../../packages/tools/src/registry.ts";

import { FIELDS_NOTE, hostedCoverageResult } from "./hosted.ts";

const cov: RegistryCoverage = {
  counties: [
    {
      region: "us-06075",
      state_fips: "06",
      county_fips: "075",
      state: "CA",
      parcels: 10,
      buildings: 0,
      sources: [
        { source_id: "ca-san-francisco-assessor", as_of: "2026-06-26" },
      ],
    },
  ],
  entity_registries: [],
  crosswalk_systems: [],
  totals: {
    parcels: 10,
    entities: 0,
    buildings: 0,
    counties: 1,
    states: ["CA"],
  },
};

const share = (parcels: number) => ({ parcels, share: parcels / 10 });
const sf: CountyFields = {
  region: "us-06075",
  parcels: 10,
  groups: {
    owner_of_record: share(0),
    owner_mailing_address: share(0),
    market_value: share(0),
    appraised_value: share(10),
    building_facts: share(9),
    neighborhood_and_class: share(0),
    zoning: share(9),
    recorded_sales: share(0),
    deeds_and_mortgages: share(0),
    energy_benchmarks: share(0),
    entity_links: share(0),
  },
  roll_years: [
    {
      tax_year: 2025,
      parcels: 10,
      value_types: ["appraised"],
      preliminary: false,
      files: [
        {
          source_id: "ca-san-francisco-assessor",
          filename: "wv5m-vpq2.csv",
          as_of: "2026-06-26",
          read_on: "2026-11-03",
          dated: "file",
          roll: null,
          parcels: 10,
          market_value: 0,
          appraised_value: 10,
        },
      ],
    },
  ],
};

test("hosted registry_coverage: each county says which fact groups and roll years it holds", () => {
  const sdk = {
    counties: [{ ...cov.counties[0], name: "San Francisco County" }],
  };
  const r = hostedCoverageResult({ fields: { "06075": sf } }, cov, sdk) as {
    counties: Record<string, unknown>[];
    fields_note: string;
  };
  assert.equal(r.fields_note, FIELDS_NOTE);
  assert.deepEqual(r.counties[0]!.fields, {
    shares: { appraised_value: 1, building_facts: 0.9, zoning: 0.9 },
    roll_years: [
      { tax_year: 2025, value_types: ["appraised"], as_of: "2026-06-26" },
    ],
  });
  // A pack built before the manifest carried fields answers as before.
  assert.equal(hostedCoverageResult({}, cov, sdk), sdk);
  assert.ok(JSON.stringify(r).length < 2000);
});
