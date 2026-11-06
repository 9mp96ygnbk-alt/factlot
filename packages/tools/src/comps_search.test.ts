// lease_comp_search conformance vectors (spec/vectors/lease_comp_search.json), shared with the Python SDK.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GSA_LEASE_COMPS_TSV } from "./data/gsa_lease_comps.ts";
import { runTool } from "./index.ts";

const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/lease_comp_search.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    tool: string;
    arguments: unknown;
    expect?: Record<string, unknown>;
    expect_error?: string;
    expect_issues?: { path: string; message: string }[];
    expect_issue_paths?: string[];
  }[];
};

const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );

test("vectors: lease_comp_search", () => {
  assert.ok(spec.cases.length > 10);
  for (const c of spec.cases) {
    const outcome = runTool(c.tool, c.arguments);
    if (c.expect_error) {
      assert.equal(outcome.ok, false, c.name);
      if (!outcome.ok) {
        assert.equal(outcome.error.error, c.expect_error, c.name);
        if (c.expect_issues)
          assert.deepEqual(outcome.error.issues, c.expect_issues, c.name);
        if (c.expect_issue_paths)
          assert.deepEqual(
            outcome.error.issues.map((i) => i.path),
            c.expect_issue_paths,
            c.name,
          );
      }
      continue;
    }
    assert.ok(outcome.ok, c.name);
    if (outcome.ok)
      for (const [k, v] of Object.entries(c.expect ?? {}))
        assert.deepEqual(at(outcome.result, k), v, `${c.name} → ${k}`);
  }
});

test("the bundled TypeScript data is the Python package's TSV, byte for byte", () => {
  const tsv = readFileSync(
    new URL(
      "../../../python/src/factlot/data/gsa_lease_comps.tsv",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(GSA_LEASE_COMPS_TSV, tsv);
});

test("every answer carries the federal-tenant caveat and the citation", () => {
  const outcome = runTool("lease_comp_search", { zip: "77002", limit: 1 });
  assert.ok(outcome.ok);
  const r = outcome.result as {
    caveat: string;
    citation: { document_id: string; license: string };
    results: { source: { document_id: string } }[];
  };
  assert.match(
    r.caveat,
    /federal government .* is the tenant, not market comps/,
  );
  assert.match(r.citation.license, /^Public domain/);
  assert.equal(r.results[0]?.source.document_id, r.citation.document_id);
});
