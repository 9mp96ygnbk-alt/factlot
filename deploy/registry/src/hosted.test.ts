// registry_coverage on the hosted registry: each county carries its field availability from the pack manifest.
import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeFieldLinks,
  unlabelValueHistory,
  type CountyFields,
} from "../../../packages/tools/src/fields.ts";
import {
  coverageReport,
  type RegistryCoverage,
} from "../../../packages/tools/src/registry.ts";

import { getResult, type GetEntry } from "./format.ts";
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

test("hosted registry_coverage: one note on how to get the fields; the counties as the SDK gave them", () => {
  const sdk = {
    counties: [{ ...cov.counties[0], name: "San Francisco County" }],
  };
  const r = hostedCoverageResult({ fields: { "06075": sf } }, cov, sdk) as {
    counties: Record<string, unknown>[];
    fields_note: string;
  };
  assert.equal(r.fields_note, FIELDS_NOTE);
  assert.match(FIELDS_NOTE, /with fields: true/);
  assert.deepEqual(r.counties, sdk.counties);
  // With fields: true the SDK's answer already carries each county's fields; they pass through.
  const withFields = coverageReport(
    cov,
    { name_key_version: "2", address_key_version: "2" },
    { "06075": sf },
  );
  const h = hostedCoverageResult(
    { fields: { "06075": sf } },
    cov,
    withFields,
  ) as {
    counties: { fields: unknown }[];
  };
  assert.deepEqual(h.counties[0]!.fields, {
    shares: { appraised_value: 1, building_facts: 0.9, zoning: 0.9 },
    roll_years: [
      { tax_year: 2025, value_types: ["appraised"], as_of: "2026-06-26" },
    ],
  });
  // A pack built before the manifest carried fields answers as before.
  assert.equal(hostedCoverageResult({}, cov, sdk), sdk);
});

test("records: value_history labelled at answer time from the manifest's value_files; an older pack's stays bare", () => {
  const stored = {
    urn: "fl:parcel:us-48999:1",
    value_history: [
      {
        tax_year: 2026,
        market_value: 5,
        appraised_value: null,
        as_of: "2026-07-20",
        citations: {
          market_value: {
            fact_id: "f1",
            document_id: "d1",
            locator: null,
            as_of: "2026-07-20",
          },
          appraised_value: null,
        },
      },
    ],
  };
  const entry: GetEntry = { k: 0, r: stored, v: [] };
  const files = {
    d1: {
      source_id: "tx-x-cad",
      filename: "2026%20Certified%20Export.zip",
      as_of: "2026-07-20",
      read_on: "2026-11-02",
    },
  };
  const labelled = getResult(entry, [], false, undefined, files) as {
    value_history: Record<string, unknown>[];
  };
  assert.deepEqual(labelled.value_history[0], {
    ...stored.value_history[0],
    value_types: ["market"],
    file: {
      source_id: "tx-x-cad",
      filename: "2026 Certified Export.zip",
      as_of: "2026-07-20",
      read_on: "2026-11-02",
    },
    roll: "certified",
    notes: [],
  });
  assert.deepEqual(getResult(entry, [], false, undefined), stored);
  // What a pack stores carries no label.
  assert.deepEqual(
    unlabelValueHistory(labelled.value_history),
    stored.value_history,
  );
});

test("field availability across files: owner links held in another file count for the county", () => {
  const merged = mergeFieldLinks([sf], [{ "us-06075": 3 }, {}]);
  assert.deepEqual(merged[0]!.groups.entity_links, { parcels: 3, share: 0.3 });
  assert.equal(
    mergeFieldLinks([sf], [{ "us-06075": 99 }])[0]!.groups.entity_links.parcels,
    10,
  );
  assert.equal(mergeFieldLinks([sf], [{}])[0], sf);
});
