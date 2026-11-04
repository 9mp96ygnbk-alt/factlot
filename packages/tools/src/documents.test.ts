// Document verification tools: the shared vectors (spec/vectors/documents.json, also run by the
// Python SDK) and unit tests for the parts the vectors do not reach.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DOC_LIMITS, runTool, runToolAsync, tools } from "./index.ts";
import { canonicalJson } from "./packages.ts";
import { checkConsistency, norm } from "./quotes.ts";

interface Case {
  name: string;
  tool: string;
  arguments: unknown;
  expect?: Record<string, unknown>;
  expect_error?: string;
  expect_issues?: { path: string; message: string }[];
}
const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/documents.json", import.meta.url),
    "utf8",
  ),
) as {
  documents: Record<string, string[]>;
  consistency: {
    predicate: string;
    value: unknown;
    quote: string;
    expect: string | null;
  }[];
  cases: Case[];
  canonical_json: { value: unknown; expect: string }[];
};

/** Replaces {"$pages": name} with the named document's pages. */
function resolve(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$pages === "string") return spec.documents[o.$pages];
    return Object.fromEntries(
      Object.entries(o).map(([k, x]) => [k, resolve(x)]),
    );
  }
  return v;
}

const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );

test("vectors: written forms (consistency)", () => {
  for (const c of spec.consistency)
    assert.equal(
      checkConsistency(c.predicate, c.value, c.quote) ?? null,
      c.expect,
      `${c.predicate} ${JSON.stringify(c.value)} / ${c.quote}`,
    );
});

test("vectors: canonical JSON (RFC 8785) for fact packages", () => {
  for (const c of spec.canonical_json)
    assert.equal(canonicalJson(c.value), c.expect, JSON.stringify(c.value));
});

test("vectors: document tools and fact_validate", async () => {
  for (const c of spec.cases) {
    const outcome = await runToolAsync(c.tool, resolve(c.arguments));
    if (c.expect_error) {
      assert.equal(outcome.ok, false, c.name);
      if (!outcome.ok) {
        assert.equal(outcome.error.error, c.expect_error, c.name);
        if (c.expect_issues)
          assert.deepEqual(outcome.error.issues, c.expect_issues, c.name);
      }
      continue;
    }
    assert.ok(outcome.ok, `${c.name}: ${JSON.stringify(outcome)}`);
    if (outcome.ok)
      for (const [k, v] of Object.entries(c.expect ?? {}))
        assert.deepEqual(
          at(outcome.result, k),
          v === null ? undefined : v,
          `${c.name} → ${k}`,
        );
  }
});

const lease = spec.documents.lease!;

test("every verified fact passes fact_validate", () => {
  const r = runTool("doc_verify_facts", resolve(spec.cases[0]!.arguments));
  assert.ok(r.ok);
  for (const v of (r.result as { verified: { fact: unknown }[] }).verified) {
    const check = runTool("fact_validate", { fact: v.fact });
    assert.deepEqual(check.ok && check.result, { valid: true, issues: [] });
  }
});

test("a span slices the quoted text out of the pages joined by form feeds", () => {
  const r = runTool("doc_verify_facts", {
    document: { pages: lease },
    as_of: "2026-11-03",
    candidates: [
      {
        predicate: "lease.pro_rata_share",
        value: 0.0425,
        quote: "TENANT’S PRO- PORTIONATE SHARE IS 4.25%",
        page: 2,
      },
    ],
  });
  assert.ok(r.ok);
  const fact = (
    r.result as {
      verified: {
        fact: {
          provenance: { sources: { span: { start: number; end: number } }[] };
        };
      }[];
    }
  ).verified[0]!.fact;
  const { start, end } = fact.provenance.sources[0]!.span;
  const text = [...lease.join("\f")];
  const slice = text.slice(start, end).join("");
  assert.equal(slice, "Tenant’s Pro-\nportionate Share is 4.25%");
  assert.equal(norm(slice), norm("TENANT’S PRO- PORTIONATE SHARE IS 4.25%"));
});

test("no span rather than a wrong one when normalizing piece by piece differs", () => {
  // Final sigma: lowercasing "ΟΔΟΣ" as a word gives "οδος" with a final ς; letter by letter, σ.
  const r = runTool("doc_verify_facts", {
    document: { pages: ["Address: ΟΔΟΣ ΑΘΗΝΑΣ 12, synthetic text."] },
    as_of: "2026-11-03",
    candidates: [
      {
        predicate: "lease.premises_street",
        value: "ΟΔΟΣ ΑΘΗΝΑΣ",
        quote: "Address: ΟΔΟΣ ΑΘΗΝΑΣ 12",
        page: 1,
      },
    ],
  });
  assert.ok(r.ok);
  const source = (
    r.result as {
      verified: { fact: { provenance: { sources: { span?: unknown }[] } } }[];
    }
  ).verified[0]!.fact.provenance.sources[0]!;
  assert.equal(source.span, undefined);
});

test("size caps: characters per call", () => {
  const big = "x".repeat(DOC_LIMITS.charactersPerPage);
  const pages = Array.from(
    { length: DOC_LIMITS.charactersPerCall / DOC_LIMITS.charactersPerPage + 1 },
    () => big,
  );
  const r = runTool("doc_verify_claim", {
    document: { pages },
    claim: { text: "about 5 things" },
    quote: "xxxxxxxxxxxxxxxx",
    page: 1,
  });
  assert.equal(!r.ok && r.error.error, "InputError");
  assert.match(!r.ok ? r.error.message : "", /2000000 per call/);
  const long = runTool("doc_verify_claim", {
    document: { pages: ["x".repeat(DOC_LIMITS.charactersPerPage + 1)] },
    claim: { text: "about 5 things" },
    quote: "xxxxxxxxxxxxxxxx",
    page: 1,
  });
  assert.equal(!long.ok && long.error.error, "InputError");
});

test("descriptions say the agent extracts and FactLot verifies", () => {
  for (const name of [
    "doc_verify_facts",
    "doc_abstract_lease",
    "doc_compare",
    "doc_verify_claim",
  ]) {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, name);
    assert.match(t.description, /not|Not/, `${name} says what is not checked`);
  }
  assert.match(
    tools.find((t) => t.name === "doc_verify_facts")!.description,
    /YOU extracted/,
  );
});
