// Field availability (fields.ts) and the labels of value-history entries, on a small registry built here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compactFields,
  computeRegistryFields,
  displayFilename,
  configureRegistry,
  registryValueHistory,
  rollOf,
  runTool,
  yearsText,
} from "./index.ts";

interface Db {
  exec(sql: string): void;
  prepare(sql: string): { run(...p: unknown[]): unknown };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (p: string) => Db;
};
const python = fileURLToPath(new URL("../../../python/src", import.meta.url));
const schema = readFileSync(
  join(python, "factlot/registry/schema.sql"),
  "utf8",
);

const P1 = "fl:parcel:us-48999:0001";
const P2 = "fl:parcel:us-48999:0002";
const P3 = "fl:parcel:us-48997:0003";
const E1 = "fl:entity:us-tx:32000000001";

/** Two Texas counties: 48999 with four roll years from four files, 48997 with two read-dated files. */
function build(): string {
  const path = join(mkdtempSync(join(tmpdir(), "factlot-fields-")), "f.db");
  const d = new DatabaseSync(path);
  d.exec(schema);
  const src = d.prepare(
    "INSERT INTO sources VALUES (?, 'A district', 't', 'https://example.test', '48', ?, 'public record', 'permitted', 'permitted', NULL, '2026-11-01')",
  );
  for (const [id, county] of [
    ["tx-x-cad", "999"],
    ["tx-x-cad-2025", "999"],
    ["tx-x-cad-2023", "999"],
    ["tx-y-cad", "997"],
    ["tx-y-cad-2025", "997"],
    ["tx-comptroller", null],
  ])
    src.run(id, county);
  const snap = d.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, 1)");
  // [document, source, read at, as of, file name]
  const docs: [string, string, string, string, string][] = [
    [
      "doc-a",
      "tx-x-cad",
      "2026-11-02T10:00:00Z",
      "2026-07-20",
      "2026-Certified-Export.zip",
    ],
    [
      "doc-b",
      "tx-x-cad-2025",
      "2026-11-12T10:00:00Z",
      "2025-07-25",
      "b_2025.zip",
    ],
    [
      "doc-c",
      "tx-x-cad-2023",
      "2026-11-12T10:00:00Z",
      "2026-11-09",
      "Real_acct_owner.zip",
    ],
    ["doc-d", "tx-x-cad", "2026-11-07T10:00:00Z", "2026-11-07", "roll.csv"],
    ["doc-f", "tx-y-cad", "2026-11-02T08:00:00Z", "2026-11-02", "current.zip"],
    [
      "doc-g",
      "tx-y-cad-2025",
      "2026-11-02T09:00:00Z",
      "2026-11-02",
      "last.zip",
    ],
    [
      "doc-e",
      "tx-comptroller",
      "2026-11-02T09:00:00Z",
      "2026-10-31",
      "export.csv",
    ],
    [
      "doc-h",
      "tx-x-cad",
      "2026-11-12T10:00:00Z",
      "2026-11-12",
      "multi%20year.csv",
    ],
  ];
  for (const [doc, source, read, asOf, file] of docs)
    snap.run(doc, source, read, asOf, file);
  const subj = d.prepare("INSERT INTO subjects VALUES (?, ?, ?, NULL)");
  subj.run(P1, "parcel", "p1");
  subj.run(P2, "parcel", "p2");
  subj.run(P3, "parcel", "p3");
  subj.run(E1, "entity", "e1");
  const asOfOf = new Map(docs.map(([doc, , , asOf]) => [doc, asOf]));
  let n = 0;
  const fact = d.prepare(
    "INSERT INTO facts VALUES (?, ?, ?, ?, NULL, ?, 'extracted', NULL, ?, ?)",
  );
  const add = (urn: string, predicate: string, value: unknown, doc: string) =>
    fact.run(
      `f${n++}`,
      urn,
      predicate,
      JSON.stringify(value),
      asOfOf.get(doc),
      doc,
      `account ${urn.slice(-4)}`,
    );
  // P1: 2026 (certified file), 2027 (a read-dated file of a later tax year), 2025, and 2023 from a late file.
  add(P1, "parcel.tax_year", 2026, "doc-a");
  add(P1, "parcel.market_value", 1000000, "doc-a");
  add(P1, "parcel.appraised_value", 900000, "doc-a");
  add(P1, "ownership.owner_of_record", "EXAMPLE TOWER LLC", "doc-a");
  add(P1, "parcel.improvement_area_sf", 12000, "doc-a");
  add(P1, "zoning.district", "C-1", "doc-a");
  add(P1, "parcel.tax_year", 2027, "doc-d");
  add(P1, "parcel.market_value", 1100000, "doc-d");
  add(P1, "parcel.appraised_value", 1000000, "doc-d");
  add(P1, "parcel.tax_year", 2025, "doc-b");
  add(P1, "parcel.market_value", 950000, "doc-b");
  add(P1, "parcel.tax_year", 2023, "doc-c");
  add(P1, "parcel.market_value", 500000, "doc-c");
  // P2: the current file, market value only; a tax year and no value in the 2027 file.
  add(P2, "parcel.tax_year", 2026, "doc-a");
  add(P2, "parcel.market_value", 300000, "doc-a");
  add(P2, "parcel.tax_year", 2027, "doc-d");
  // One file of two tax years: P1's 2022 with both values, P2's 2024 with market value only.
  add(P1, "parcel.tax_year", 2022, "doc-h");
  add(P1, "parcel.market_value", 400000, "doc-h");
  add(P1, "parcel.appraised_value", 390000, "doc-h");
  add(P2, "parcel.tax_year", 2024, "doc-h");
  add(P2, "parcel.market_value", 250000, "doc-h");
  // P3: two read-dated files of consecutive years, and a recorded sale.
  add(P3, "parcel.tax_year", 2026, "doc-f");
  add(P3, "parcel.market_value", 200000, "doc-f");
  add(P3, "parcel.tax_year", 2025, "doc-g");
  add(P3, "parcel.market_value", 190000, "doc-g");
  add(P3, "transaction.sale", { price_usd: 1 }, "doc-f");
  add(E1, "entity.legal_name", "EXAMPLE TOWER LLC", "doc-e");
  d.prepare(
    "INSERT INTO relationships VALUES (?, 'owns', ?, '2026-10-31', 'exact', 1, 'doc-e', 'name')",
  ).run(E1, P1);
  d.close();
  return path;
}

test("rollOf: file names, and the Texas tax-year rule", () => {
  const roll = (
    name: string | null,
    year: number | null,
    asOf: string,
    id = "tx-a",
  ) => rollOf(id, name, year, asOf);
  assert.equal(roll("x_PRELIM.zip", 2026, "2026-05-01"), "preliminary");
  assert.equal(roll("roll.csv", 2027, "2026-11-07"), "preliminary");
  // "current" is not evidence of a preliminary roll: a post-certification export can be called current.
  assert.equal(roll("DCAD2026_CURRENT.zip", 2026, "2026-11-01"), null);
  // Outside Texas a fiscal year ahead of the file's date is the usual roll year, not a preliminary one.
  assert.equal(roll("fy27.zip", 2027, "2026-05-15", "ny-nyc-dof"), null);
  for (const name of [
    "2025-CERTIFIED-EXPORT.zip",
    "DCAD2025_CERTIFIED_07242025.zip",
    "Brazos-2016-Certified-Export.zip",
    "2025-GCO-CERTF-APPR-ROLL-SUPP0.zip",
  ])
    assert.equal(roll(name, 2025, "2025-08-01"), "certified", name);
  // Pre-certified, uncertified and estimate files, and a bare "cert", are never labelled certified.
  for (const name of [
    "UNCERTIFIED_2025.zip",
    "PreCert_Export.zip",
    "2025-Pre-Cert-Roll.zip",
    "NonCertified.zip",
    "Non-Certified.zip",
    "2025_Certified_Estimate.zip",
    "2024_Cert_Web_Export.zip",
    "x.zip",
    null,
  ])
    assert.equal(roll(name, 2025, "2025-08-01"), null, String(name));
  // An as-of date that is not a date gives no label.
  assert.equal(roll("x_PRELIM.zip", 2026, ""), null);
  assert.equal(roll("2025-CERTIFIED.zip", 2025, "unknown"), null);
  assert.equal(yearsText([2025, 2022, 2023, 2024]), "2022 to 2025");
  assert.equal(yearsText([2016, 2020, 2018]), "2016, 2018 and 2020");
  assert.equal(
    displayFilename("2026%20Certified%20Supp%200.zip"),
    "2026 Certified Supp 0.zip",
  );
  assert.equal(displayFilename("100%.zip"), "100%.zip");
  assert.equal(displayFilename("%E0%A4%A.zip"), "%E0%A4%A.zip");
  assert.equal(displayFilename("%FF.zip"), "%FF.zip");
  assert.equal(displayFilename(null), null);
});

test("field availability: shares and roll years per county, computed from the file", () => {
  const path = build();
  configureRegistry(path);
  try {
    const f = computeRegistryFields();
    assert.deepEqual(
      f.counties.map((c) => [c.region, c.parcels]),
      [
        ["us-48997", 1],
        ["us-48999", 2],
      ],
    );
    const x = f.counties[1]!;
    const shares = Object.fromEntries(
      Object.entries(x.groups).map(([g, s]) => [g, s.share]),
    );
    assert.deepEqual(shares, {
      owner_of_record: 0.5,
      owner_mailing_address: 0,
      market_value: 1,
      appraised_value: 0.5,
      building_facts: 0.5,
      neighborhood_and_class: 0,
      zoning: 0.5,
      recorded_sales: 0,
      deeds_and_mortgages: 0,
      energy_benchmarks: 0,
      entity_links: 0.5,
    });
    assert.deepEqual(
      x.roll_years.map((y) => [
        y.tax_year,
        y.parcels,
        y.value_types.join("+"),
        y.preliminary,
        y.files.map((fl) => `${fl.as_of}/${fl.dated}/${fl.roll}`).join(" "),
      ]),
      [
        // P2 has a 2027 tax year and no 2027 value: it is not counted.
        [2027, 1, "market+appraised", true, "2026-11-07/read/preliminary"],
        [2026, 2, "market+appraised", false, "2026-07-20/file/certified"],
        [2025, 1, "market", false, "2025-07-25/file/null"],
        // The two-year file: 2024 has market value only, 2022 both.
        [2024, 1, "market", false, "2026-11-12/read/null"],
        [2023, 1, "market", false, "2026-11-09/file/null"],
        [2022, 1, "market+appraised", false, "2026-11-12/read/null"],
      ],
    );
    assert.equal(f.counties[0]!.groups.recorded_sales.share, 1);
    assert.deepEqual(compactFields(f.counties[0]!), {
      shares: { market_value: 1, recorded_sales: 1 },
      roll_years: [
        { tax_year: 2026, value_types: ["market"], as_of: "2026-11-02" },
        { tax_year: 2025, value_types: ["market"], as_of: "2026-11-02" },
      ],
    });
  } finally {
    configureRegistry(undefined);
  }
});

const READ = (d: string) =>
  `${d}, this file's as-of date, is the day the registry read it.`;
const LATE = (y: number, d: string) =>
  `This ${y} value comes from a file dated ${d}, after the ${y} roll year: it is the roll as the publisher held it on that date, which can differ from the roll as certified.`;

function pyJson(code: string, ...args: string[]): unknown {
  return JSON.parse(
    execFileSync("python3", ["-c", code, ...args], {
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: python },
    }),
  ) as unknown;
}

type Entry = Record<string, unknown> & {
  file: { as_of: string; read_on: string; filename: string | null } | null;
  notes: string[];
};

test("value history: each year says its value types, file and roll, with notes of what the files show; Python agrees", () => {
  const path = build();
  configureRegistry(path);
  let p1: Entry[];
  let p3: Entry[];
  try {
    p1 = registryValueHistory(P1) as Entry[];
    p3 = registryValueHistory(P3) as Entry[];
  } finally {
    configureRegistry(undefined);
  }
  assert.deepEqual(
    p1.map((e) => [e.tax_year, e.value_types, e.roll, e.notes]),
    [
      [2027, ["market", "appraised"], "preliminary", [READ("2026-11-07")]],
      [2026, ["market", "appraised"], "certified", []],
      [2025, ["market"], null, []],
      [
        2023,
        ["market"],
        null,
        [
          LATE(2023, "2026-11-09"),
          "The registry holds no value of this parcel for 2024, between this 2023 entry and the 2025 entry.",
        ],
      ],
      [
        2022,
        ["market", "appraised"],
        null,
        [READ("2026-11-12"), LATE(2022, "2026-11-12")],
      ],
    ],
  );
  assert.deepEqual(p1[3]!.file, {
    source_id: "tx-x-cad-2023",
    filename: "Real_acct_owner.zip",
    as_of: "2026-11-09",
    read_on: "2026-11-12",
  });
  // The file name is shown URL-decoded.
  assert.equal(p1[4]!.file!.filename, "multi year.csv");
  // Two read-dated files of consecutive years: each says only its own date.
  assert.deepEqual(
    p3.map((e) => e.notes),
    [[READ("2026-11-02")], [READ("2026-11-02")]],
  );
  const py = pyJson(
    "import json, sys; from factlot.registry.store import Registry; r = Registry.open_readonly(sys.argv[1]); print(json.dumps([r.value_history(u) for u in sys.argv[2:]]))",
    path,
    P1,
    P3,
  );
  assert.deepEqual(py, JSON.parse(JSON.stringify([p1, p3])));
});

test("value history: an entry's notes name no file or date of another entry", () => {
  const path = build();
  configureRegistry(path);
  try {
    for (const urn of [P1, P2, P3]) {
      const h = registryValueHistory(urn) as Entry[];
      h.forEach((e, i) => {
        const own = [String(e.as_of), e.file?.as_of, e.file?.read_on];
        const others = h
          .filter((_, j) => j !== i)
          .flatMap((x) => [String(x.as_of), x.file?.as_of ?? ""])
          .filter((d) => d && !own.includes(d));
        for (const n of e.notes)
          for (const d of others)
            assert.ok(!n.includes(d), `${urn} ${String(e.tax_year)}: ${n}`);
      });
    }
  } finally {
    configureRegistry(undefined);
  }
});

test("registry_coverage with fields: each county's compact field availability; Python agrees", () => {
  const path = build();
  configureRegistry(path);
  let ts: unknown;
  try {
    const r = runTool("registry_coverage", { fields: true });
    assert.ok(r.ok);
    ts = r.result;
    const plain = runTool("registry_coverage", {});
    assert.ok(plain.ok);
    assert.ok(
      (plain.result as { counties: Record<string, unknown>[] }).counties.every(
        (c) => !("fields" in c),
      ),
    );
  } finally {
    configureRegistry(undefined);
  }
  const py = pyJson(
    "import json, sys; from factlot.registry.store import Registry; from factlot.registry import coverage; r = Registry.open_readonly(sys.argv[1]); print(json.dumps(coverage.tool_result(r.db, r.coverage(), fields=True)))",
    path,
  );
  assert.deepEqual(py, JSON.parse(JSON.stringify(ts)));
  const x = (
    ts as { counties: { region: string; fields: unknown }[] }
  ).counties.find((c) => c.region === "us-48999")!;
  assert.deepEqual(
    (x.fields as { roll_years: { tax_year: number }[] }).roll_years.map(
      (y) => y.tax_year,
    ),
    [2027, 2026, 2025, 2024, 2023, 2022],
  );
});

test("field availability: Python computes the same", () => {
  const path = build();
  configureRegistry(path);
  let ts: unknown;
  try {
    ts = computeRegistryFields().counties;
  } finally {
    configureRegistry(undefined);
  }
  const py = pyJson(
    "import json, sqlite3, sys; from factlot.registry.fields import field_availability; print(json.dumps(field_availability(sqlite3.connect(sys.argv[1]))))",
    path,
  );
  assert.deepEqual(py, JSON.parse(JSON.stringify(ts)));
});
