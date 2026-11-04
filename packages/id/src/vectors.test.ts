// Runs the language-neutral conformance vectors in spec/vectors/id.json against @factlot/id.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FactLotIdError,
  buildingId,
  documentId,
  entityId,
  normalizeStreet,
  normalizeSuite,
  normalizeSuiteV1,
  parcelId,
  parse,
  shortId,
  spaceId,
} from "./index.ts";

type Input = Record<string, string>;
const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/id.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    fn: string;
    input: Input;
    expect?: Record<string, string>;
    expect_error?: boolean;
  }[];
};

const fns: Record<string, (i: Input) => object> = {
  parcel: (i) =>
    parcelId({
      stateFips: i.state_fips ?? "",
      countyFips: i.county_fips ?? "",
      apn: i.apn ?? "",
    }),
  entity: (i) =>
    entityId({
      jurisdiction: i.jurisdiction ?? "",
      registryNumber: i.registry_number ?? "",
    }),
  document: (i) => documentId(i.text ?? ""),
  space: (i) => spaceId(i.building_urn ?? "", i.suite ?? ""),
  normalize_suite: (i) => ({ value: normalizeSuite(i.suite ?? "") }),
  normalize_suite_v1: (i) => ({ value: normalizeSuiteV1(i.suite ?? "") }),
  normalize_street: (i) => ({ value: normalizeStreet(i.street ?? "") }),
  building: (i) =>
    buildingId({
      stateFips: i.state_fips ?? "",
      countyFips: i.county_fips ?? "",
      zip: i.zip ?? "",
      street: i.street ?? "",
    }),
  parse: (i) => ({
    kind: parse(i.urn ?? "").kind,
    short: shortId(i.urn ?? ""),
  }),
};

test("vectors: factlot-id", () => {
  for (const c of spec.cases) {
    const fn = fns[c.fn];
    assert.ok(fn, `unknown fn ${c.fn}`);
    const label = `${c.fn} ${JSON.stringify(c.input)}`;
    if (c.expect_error) {
      assert.throws(() => fn(c.input), FactLotIdError, label);
      continue;
    }
    const out = fn(c.input) as Record<string, string>;
    for (const [k, v] of Object.entries(c.expect ?? {}))
      assert.equal(out[k], v, `${label} → ${k}`);
  }
});
