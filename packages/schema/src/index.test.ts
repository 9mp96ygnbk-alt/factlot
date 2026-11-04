import assert from "node:assert/strict";
import test from "node:test";

import { Fact, jsonSchemas, Predicates } from "./index.ts";

const base = {
  subject: "fl:lease:us-06037:abc123",
  predicate: "lease.expiration_date",
  value: "2031-03-31",
  as_of: "2026-11-02",
};

test("accepts a cited extracted fact", () => {
  const parsed = Fact.parse({
    ...base,
    provenance: {
      method: "extracted",
      sources: [
        {
          document_id: "doc-1",
          page: 3,
          section: "§2.1",
          quote: "expire on March 31, 2031",
        },
      ],
      confidence: 0.97,
    },
    rights: { ai_use: "permitted", redistribution: "prohibited" },
  });
  assert.equal(parsed.value, "2031-03-31");
});

test("rejects an extracted fact with no source", () => {
  const r = Fact.safeParse({
    ...base,
    provenance: { method: "extracted", sources: [] },
  });
  assert.equal(r.success, false);
});

test("allows computed facts without document sources", () => {
  const r = Fact.safeParse({
    ...base,
    predicate: "lease.net_effective_rent",
    value: 41.27,
    unit: "USD/sf/yr",
    provenance: { method: "computed", sources: [], formula: "calc.ner@1" },
  });
  assert.equal(r.success, true);
});

test("rejects malformed predicates and subjects", () => {
  const prov = { method: "public_record", sources: [{ document_id: "x" }] };
  assert.equal(
    Fact.safeParse({ ...base, predicate: "Expiration", provenance: prov })
      .success,
    false,
  );
  assert.equal(
    Fact.safeParse({ ...base, subject: "lease-123", provenance: prov }).success,
    false,
  );
});

test("exports JSON Schema for every schema", () => {
  const s = jsonSchemas();
  assert.ok(s.Fact && typeof s.Fact === "object");
  assert.deepEqual(Object.keys(s).sort(), [
    "Fact",
    "Provenance",
    "Relationship",
    "Rights",
    "SourceRef",
  ]);
});

const cited = {
  method: "extracted",
  sources: [
    { document_id: "doc-1", page: 3, quote: "expire on March 31, 2031" },
  ],
};

test("rejects fields the schema does not define, at every level", () => {
  const r = Fact.safeParse({ ...base, provenance: cited, units: "sf" });
  assert.equal(r.success, false);
  const nested = Fact.safeParse({
    ...base,
    provenance: { ...cited, sources: [{ document_id: "d", pg: 3 }] },
  });
  assert.equal(nested.success, false);
  assert.deepEqual(
    !nested.success && nested.error.issues.map((i) => i.path.join(".")),
    ["provenance.sources.0"],
  );
});

test("rejects valid_from after valid_to, and a span that ends before it starts", () => {
  const dates = Fact.safeParse({
    ...base,
    valid_from: "2031-01-01",
    valid_to: "2030-12-31",
    provenance: cited,
  });
  assert.deepEqual(!dates.success && dates.error.issues.map((i) => i.message), [
    "valid_to is before valid_from",
  ]);
  const span = Fact.safeParse({
    ...base,
    provenance: {
      method: "extracted",
      sources: [{ document_id: "d", span: { start: 9, end: 2 } }],
    },
  });
  assert.equal(span.success, false);
});

test("an inferred fact cites its evidence; a computed one names its formula", () => {
  assert.equal(
    Fact.safeParse({ ...base, provenance: { method: "inferred", sources: [] } })
      .success,
    false,
  );
  assert.equal(
    Fact.safeParse({ ...base, provenance: { method: "computed", sources: [] } })
      .success,
    false,
  );
  assert.equal(
    Fact.safeParse({
      ...base,
      provenance: { method: "inferred", sources: [{ document_id: "d" }] },
    }).success,
    true,
  );
});

test("every starter predicate is a valid dotted lower_snake name in its namespace", () => {
  for (const [namespace, names] of Object.entries(Predicates)) {
    for (const predicate of names) {
      assert.ok(predicate.startsWith(`${namespace}.`), predicate);
      assert.equal(
        Fact.shape.predicate.safeParse(predicate).success,
        true,
        predicate,
      );
    }
  }
  const all: string[] = Object.values(Predicates).flat();
  assert.equal(new Set(all).size, all.length, "no duplicates");
  for (const p of [
    "zoning.district",
    "zoning.max_far_commercial",
    "transaction.sale",
    "transaction.deed",
    "debt.mortgage_recorded",
    "debt.mortgage_satisfaction_recorded",
    "zoning.max_height_ft",
    "energy.site_eui",
    "parcel.num_floors",
  ]) {
    assert.ok(all.includes(p), p);
  }
});
