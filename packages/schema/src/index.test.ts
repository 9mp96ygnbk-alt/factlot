import assert from "node:assert/strict";
import test from "node:test";

import { Fact, jsonSchemas } from "./index.ts";

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
