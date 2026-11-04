// Cross-language parity: the Python pipeline builds a (synthetic) registry; Python and
// TypeScript then answer the same tool calls and must return identical JSON.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  configureRegistry,
  legacyNormalizeName,
  normalizeAddress,
  normalizeName,
  runTool,
} from "./index.ts";

const spec = fileURLToPath(new URL("../../../spec/registry/", import.meta.url));
const calls = JSON.parse(readFileSync(join(spec, "calls.json"), "utf8")) as {
  tool: string;
  arguments: unknown;
}[];

test("registry tools without a registry report RegistryUnavailable", () => {
  configureRegistry(undefined);
  const saved = process.env.FACTLOT_REGISTRY_DB;
  delete process.env.FACTLOT_REGISTRY_DB;
  const r = runTool("registry_get", { urn: "fl:parcel:us-48201:1" });
  assert.equal(!r.ok && r.error.error, "RegistryUnavailable");
  if (saved !== undefined) process.env.FACTLOT_REGISTRY_DB = saved;
});

test("registry tools: TypeScript matches Python on the shared fixture", () => {
  const db = join(
    mkdtempSync(join(tmpdir(), "factlot-registry-")),
    "fixture.db",
  );
  execFileSync("python3", [join(spec, "build_fixture.py"), db]);
  const python = JSON.parse(
    execFileSync("python3", [join(spec, "query_fixture.py"), db], {
      encoding: "utf8",
    }),
  ) as Record<string, unknown>[];
  configureRegistry(db);
  try {
    calls.forEach((c, i) => {
      const outcome = runTool(c.tool, c.arguments);
      const ts = outcome.ok ? outcome.result : outcome.error;
      const py = python[i] as Record<string, unknown>;
      const label = `${c.tool} ${JSON.stringify(c.arguments)}`;
      if ("error" in py) {
        assert.equal((ts as { error: string }).error, py.error, label);
      } else {
        assert.deepEqual(JSON.parse(JSON.stringify(ts)), py, label);
      }
    });
    // A parcel holds many sales: all current ones are returned, newest first (price breaks a date tie).
    const parcel = python[0] as {
      facts: { predicate: string; value: unknown }[];
    };
    assert.deepEqual(
      parcel.facts
        .filter((f) => f.predicate === "transaction.sale")
        .map((f) => (f.value as { price_usd: number }).price_usd),
      [12500000, 9000000, 0],
    );
    assert.equal(
      parcel.facts.filter((f) => f.predicate === "zoning.district").length,
      1,
    );
  } finally {
    configureRegistry(undefined);
  }
});

test("name and address normalization match the Python vectors", () => {
  const v = JSON.parse(readFileSync(join(spec, "normalize.json"), "utf8")) as {
    names: [string, string][];
    addresses: [string, string][];
  };
  for (const [input, expected] of v.names)
    assert.equal(normalizeName(input), expected, input);
  for (const [input, expected] of v.addresses)
    assert.equal(normalizeAddress(input), expected, input);
});

test("entity search uses the name keys the file was built with", () => {
  const db = join(mkdtempSync(join(tmpdir(), "factlot-registry-")), "keys.db");
  execFileSync("python3", [join(spec, "build_fixture.py"), db]);
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (p: string) => {
      exec(sql: string): void;
      prepare(sql: string): { get(...a: unknown[]): Record<string, unknown> };
    };
  };
  const w = new DatabaseSync(db);
  const urn = String(
    w.prepare("SELECT urn FROM subjects WHERE kind = 'entity' LIMIT 1").get()
      .urn,
  );
  // A key only the earlier rules make ("W G G"); the current rules make "WGG".
  w.exec(
    `INSERT INTO name_index VALUES ('W G G PROPERTIES LLC', '${urn}'); ` +
      "DELETE FROM meta WHERE key = 'name_key_version'",
  );
  const search = () => {
    const r = runTool("registry_search_entities", {
      query: "W.G.G. Properties LLC",
    });
    assert.ok(r.ok);
    return (r.result as { results: { urn: string }[] }).results.map(
      (x) => x.urn,
    );
  };
  configureRegistry(db);
  try {
    assert.deepEqual(
      search(),
      [urn],
      "a version 1 file is searched by version 1 keys",
    );
    w.exec("INSERT INTO meta VALUES ('name_key_version', '2')");
    configureRegistry(db);
    assert.deepEqual(
      search(),
      [],
      "a re-keyed file is searched by current keys",
    );
    assert.equal(
      legacyNormalizeName("W.G.G. Properties LLC"),
      "W G G PROPERTIES LLC",
    );
  } finally {
    configureRegistry(undefined);
  }
});
