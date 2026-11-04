import assert from "node:assert/strict";
import test from "node:test";

import {
  FactLotIdError,
  buildingId,
  documentId,
  entityId,
  isFactLotUrn,
  mint,
  normalizeApnV1,
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

test("parcel rule 2 keeps where a separator falls; rule 1 IDs can be recomputed", () => {
  const id = (apn: string) =>
    parcelId({ stateFips: "32", countyFips: "031", apn }).urn;
  assert.notEqual(id("12-34"), id("1-234"));
  assert.equal(id("12-34"), "fl:parcel:us-32031:12-34");
  assert.equal(id("12 34"), id("12-34"));
  const v1 = parcelId({
    stateFips: "32",
    countyFips: "031",
    apn: "12-34",
    normalize: normalizeApnV1,
  });
  assert.equal(v1.urn, "fl:parcel:us-32031:1234");
  assert.equal(parse(v1.urn).kind, "parcel", "a 0.2 parcel ID still parses");
  // NYC BBL: the zero-padded 10-digit form, whatever the input's padding.
  const bbl = (apn: string) =>
    parcelId({ stateFips: "36", countyFips: "047", apn }).urn;
  assert.equal(bbl("3-1234-56"), bbl("3-01234-0056"));
  assert.equal(bbl("3-1234-56"), "fl:parcel:us-36047:3012340056");
  assert.throws(() => bbl("1-1234-56"), /borough 3/);
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

test("distinct suites never merge, and spellings of one suite converge", () => {
  const b = "fl:building:01jbx3k8q2v7m9c4t6w8y0a2b4";
  assert.notEqual(spaceId(b, "Suite 1-20").urn, spaceId(b, "Suite 120").urn);
  assert.notEqual(spaceId(b, "1-2").urn, spaceId(b, "12").urn);
  const same = ["Suite 100", "Ste 100", "#100", "STE. 100", "Unit 100"];
  assert.equal(new Set(same.map((s) => spaceId(b, s).urn)).size, 1);
  assert.equal(normalizeSuite("Third Floor"), normalizeSuite("3rd Floor"));
  assert.notEqual(normalizeSuite("Suite 0100"), normalizeSuite("Suite 100"));
});

test("building IDs come from the street address and carry spaces", () => {
  const a = buildingId({
    stateFips: "11",
    countyFips: "001",
    zip: "20002",
    street: "208 Massachusetts Avenue Northeast, Unit 4",
  });
  const b = buildingId({
    stateFips: "11",
    countyFips: "001",
    zip: "20002-4941",
    street: "208 MASSACHUSETTS AVE N.E. # E",
  });
  assert.deepEqual(a, b);
  assert.equal(a.urn, "fl:building:us-11001:20002:208-massachusetts-ave-ne");
  assert.match(a.short, /^flb_/);
  assert.deepEqual(parse(a.urn).parts, [
    "us-11001",
    "20002",
    "208-massachusetts-ave-ne",
  ]);
  const space = spaceId(a, "Suite 1-20");
  assert.equal(
    space.urn,
    "fl:space:us-11001:20002:208-massachusetts-ave-ne:1-20",
  );
  assert.equal(parse(space.urn).parts.length, 4);
  // A different ZIP code is a different building (one street address can exist in two towns).
  assert.notEqual(
    buildingId({
      stateFips: "11",
      countyFips: "001",
      zip: "20003",
      street: "208 Massachusetts Ave NE",
    }).urn,
    a.urn,
  );
});
