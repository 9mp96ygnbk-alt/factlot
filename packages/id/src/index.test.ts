import assert from "node:assert/strict";
import test from "node:test";

import {
  FactLotIdError,
  documentId,
  entityId,
  isFactLotUrn,
  mint,
  normalizeSuite,
  parcelId,
  parse,
  shortId,
  shortIdKind,
  spaceId,
} from "./index.ts";

test("parcel IDs are deterministic across APN formatting", () => {
  const a = parcelId({
    stateFips: "06",
    countyFips: "037",
    apn: "5432-001-012",
  });
  const b = parcelId({
    stateFips: "06",
    countyFips: "037",
    apn: " 5432 001 012 ",
  });
  assert.equal(a.urn, "fl:parcel:us-06037:5432001012");
  assert.deepEqual(a, b);
  assert.match(a.short, /^flp_[0-9a-hjkmnp-tv-z]{24}$/);
});

test("same APN in different counties yields different IDs", () => {
  const a = parcelId({ stateFips: "06", countyFips: "037", apn: "123" });
  const b = parcelId({ stateFips: "06", countyFips: "059", apn: "123" });
  assert.notEqual(a.short, b.short);
});

test("county-specific APN normalization overrides the default", () => {
  const p = parcelId({
    stateFips: "36",
    countyFips: "061",
    apn: "1-00123-0045",
    normalize: (apn) => apn.replace(/-/g, "x"),
  });
  assert.equal(p.urn, "fl:parcel:us-36061:1x00123x0045");
});

test("rejects bad FIPS codes", () => {
  assert.throws(
    () => parcelId({ stateFips: "6", countyFips: "037", apn: "1" }),
    FactLotIdError,
  );
  assert.throws(
    () => parcelId({ stateFips: "06", countyFips: "37", apn: "1" }),
    FactLotIdError,
  );
  assert.throws(
    () => parcelId({ stateFips: "06", countyFips: "037", apn: "--" }),
    FactLotIdError,
  );
});

test("entity IDs normalize registry numbers", () => {
  assert.equal(
    entityId({ jurisdiction: "US-DE", registryNumber: "7654-321" }).urn,
    "fl:entity:us-de:7654321",
  );
  assert.equal(
    entityId({ jurisdiction: "lei", registryNumber: "5493001KJTIIGC8Y1R12" })
      .urn,
    "fl:entity:lei:5493001kjtiigc8y1r12",
  );
  assert.throws(
    () => entityId({ jurisdiction: "lei", registryNumber: "short" }),
    FactLotIdError,
  );
  assert.throws(
    () => entityId({ jurisdiction: "delaware", registryNumber: "1" }),
    FactLotIdError,
  );
});

test("document IDs are content-addressed", () => {
  const d = documentId("lease text");
  assert.match(d.urn, /^fl:document:sha256-[a-f0-9]{64}$/);
  assert.equal(d.urn, documentId(new TextEncoder().encode("lease text")).urn);
  assert.notEqual(d.urn, documentId("lease text.").urn);
});

test("suite normalization", () => {
  for (const s of ["Suite 400", "STE. 400", "#400", "ste 400", "Unit 400"]) {
    assert.equal(normalizeSuite(s), "400", s);
  }
  for (const s of ["3rd Floor", "Floor 3", "FL 3", "fl. 03"]) {
    assert.equal(normalizeSuite(s), "f3", s);
  }
  assert.equal(normalizeSuite("Suite 1200-A"), "1200a");
});

test("minted IDs are valid, unique, and time-sortable", () => {
  const a = mint("building", 1_700_000_000_000);
  const b = mint("building", 1_700_000_000_001);
  assert.equal(parse(a.urn).kind, "building");
  assert.match(a.urn, /^fl:building:[0-9a-hjkmnp-tv-z]{26}$/);
  assert.notEqual(a.urn, mint("building", 1_700_000_000_000).urn);
  assert.ok(a.urn < b.urn, "lexicographic order follows time");
  assert.throws(() => mint("lease", -1), FactLotIdError);
});

test("space IDs derive from the building and suite", () => {
  const b = mint("building");
  const s = spaceId(b, "Suite 400");
  assert.equal(s.urn, `${b.urn.replace("fl:building:", "fl:space:")}:400`);
  assert.deepEqual(spaceId(b.urn, "#400"), s);
  assert.throws(() =>
    spaceId(
      parcelId({ stateFips: "06", countyFips: "037", apn: "1" }).urn,
      "1",
    ),
  );
});

test("parse, validation, and short IDs", () => {
  const p = parcelId({
    stateFips: "48",
    countyFips: "201",
    apn: "0420150000012",
  });
  assert.deepEqual(parse(p.urn), {
    kind: "parcel",
    parts: ["us-48201", "0420150000012"],
  });
  assert.equal(shortId(p.urn), p.short);
  assert.equal(shortIdKind(p.short), "parcel");
  assert.equal(isFactLotUrn(p.urn), true);
  for (const bad of [
    "fl:parcel:us-48201:ABC",
    "fl:widget:x",
    "urn:x",
    "fl:parcel:us-482:1",
  ]) {
    assert.equal(isFactLotUrn(bad), false, bad);
  }
  assert.throws(() => shortIdKind("flz_abc"), FactLotIdError);
});
