// The predicate catalog (doc_predicates) against the tables the checks use: every predicate is
// listed, every example has the predicate's shape and gets the outcome the catalog states, and
// the parts the catalog says are checked are the parts the verifier checks.
import assert from "node:assert/strict";
import test from "node:test";

import { runTool } from "./index.ts";
import { predicateCatalog } from "./predicates.ts";
import {
  CONSISTENCY,
  PREDICATES,
  checkConsistency,
  checkValue,
  coverage,
} from "./quotes.ts";

type Entry = Record<string, unknown> & {
  predicate: string;
  value_schema: Record<string, unknown>;
  example: { value: unknown; quote: string; outcome: string };
  checked: { path: string }[];
  checked_if_written: { path: string }[];
  always_review: { path: string }[];
};
const entries = predicateCatalog().predicates as Entry[];
const generic = (path: string): string => path.replace(/\.\d+(?=\.|$)/g, "[]");

test("the catalog lists every predicate in the checks tables, once", () => {
  const listed = entries.map((e) => e.predicate);
  assert.deepEqual([...listed].sort(), Object.keys(PREDICATES).sort());
  for (const p of Object.keys(CONSISTENCY))
    assert.ok(listed.includes(p), `${p} is in CONSISTENCY but not listed`);
  assert.equal(new Set(listed).size, listed.length);
});

test("every example has its predicate's shape and is stated by its quote", () => {
  for (const e of entries) {
    assert.equal(
      checkValue(e.predicate, e.example.value),
      undefined,
      e.predicate,
    );
    assert.equal(
      checkConsistency(e.predicate, e.example.value, e.example.quote),
      undefined,
      e.predicate,
    );
  }
});

test("the parts the catalog lists are the parts the verifier checks", () => {
  for (const e of entries) {
    const cov = coverage(e.predicate, e.example.value, e.example.quote);
    const always = e.checked.map((r) => r.path);
    const ifWritten = e.checked_if_written.map((r) => r.path);
    const review = e.always_review.map((r) => r.path);
    for (const c of cov.checked)
      assert.ok(
        [...always, ...ifWritten].includes(generic(c.path)),
        `${e.predicate}: ${c.path} is checked but not listed as checked`,
      );
    for (const p of cov.not_checked)
      assert.ok(
        [...review, ...ifWritten].includes(generic(p)),
        `${e.predicate}: ${p} is not checked but not listed for review`,
      );
    assert.equal(
      e.example.outcome,
      cov.gaps.length ? "needs_review" : "verified",
      e.predicate,
    );
  }
});

test("doc_verify_facts gives every example the outcome the catalog states", () => {
  for (const e of entries) {
    const out = runTool("doc_verify_facts", {
      document: { pages: [e.example.quote] },
      as_of: "2026-11-06",
      candidates: [
        {
          predicate: e.predicate,
          value: e.example.value,
          quote: e.example.quote,
          page: 1,
        },
      ],
    });
    assert.ok(out.ok, e.predicate);
    const r = out.result as {
      verified: unknown[];
      needs_review: { check: string }[];
    };
    if (e.example.outcome === "verified")
      assert.equal(r.verified.length, 1, e.predicate);
    else assert.equal(r.needs_review[0]?.check, "coverage", e.predicate);
  }
});

test("removing a required field or using an unknown enum value fails the shape check", () => {
  const objectOf = (
    s: Record<string, unknown>,
  ): Record<string, unknown> | undefined =>
    s.type === "object"
      ? s
      : Array.isArray(s.anyOf)
        ? (s.anyOf as Record<string, unknown>[]).find(
            (b) => b.type === "object",
          )
        : undefined;
  for (const e of entries) {
    const schema = objectOf(e.value_schema);
    const value = e.example.value;
    if (
      !schema ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    )
      continue;
    for (const k of (schema.required as string[] | undefined) ?? []) {
      const rest = { ...(value as Record<string, unknown>) };
      delete rest[k];
      assert.notEqual(
        checkValue(e.predicate, rest),
        undefined,
        `${e.predicate} without ${k}`,
      );
    }
    for (const [k, s] of Object.entries(
      schema.properties as Record<string, Record<string, unknown>>,
    ))
      if (Array.isArray(s.enum) && k in (value as object))
        assert.notEqual(
          checkValue(e.predicate, { ...(value as object), [k]: "not_a_value" }),
          undefined,
          `${e.predicate}.${k}`,
        );
  }
});

test("the lease-year form's example verifies with its commencement date", () => {
  const rent = entries.find((e) => e.predicate === "lease.base_rent_schedule")!;
  const form = (rent.alternate_forms as Record<string, unknown>[])[0]!;
  const ex = form.example as {
    value: unknown;
    quote: string;
    commencement: { value: string; quote: string };
  };
  const out = runTool("doc_verify_facts", {
    document: { pages: [ex.commencement.quote, ex.quote] },
    as_of: "2026-11-06",
    candidates: [
      {
        predicate: "lease.base_rent_schedule",
        value: ex.value,
        quote: ex.quote,
        page: 2,
        commencement: { ...ex.commencement, page: 1 },
      },
    ],
  });
  assert.ok(out.ok);
  assert.equal((out.result as { verified: unknown[] }).verified.length, 1);
});
