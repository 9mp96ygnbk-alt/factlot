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
  configureRegistry,
  registryValueHistory,
  rollOf,
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
  // P2: the current file only, market value only.
  add(P2, "parcel.tax_year", 2026, "doc-a");
  add(P2, "parcel.market_value", 300000, "doc-a");
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
  assert.equal(
    rollOf("tx-a", "x_PRELIM.zip", 2026, "2026-05-01"),
    "preliminary",
  );
  assert.equal(
    rollOf("tx-a", "DCAD2027_CURRENT.zip", 2026, "2026-11-01"),
    "preliminary",
  );
  assert.equal(rollOf("tx-a", "roll.csv", 2027, "2026-11-07"), "preliminary");
  // Outside Texas a fiscal year ahead of the file's date is the usual roll year, not a preliminary one.
  assert.equal(rollOf("ny-nyc-dof", "fy27.zip", 2027, "2026-05-15"), null);
  assert.equal(
    rollOf("tx-a", "2025-CERTIFIED-EXPORT.zip", 2025, "2025-08-01"),
    "certified",
  );
  assert.equal(rollOf("tx-a", "x.zip", 2025, "2025-08-01"), null);
  assert.equal(yearsText([2025, 2022, 2023, 2024]), "2022 to 2025");
  assert.equal(yearsText([2016, 2020, 2018]), "2016, 2018 and 2020");
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
        [2027, 1, "market+appraised", true, "2026-11-07/read/preliminary"],
        [2026, 2, "market+appraised", false, "2026-07-20/file/certified"],
        [2025, 1, "market", false, "2025-07-25/file/null"],
        [2023, 1, "market", false, "2026-11-09/file/null"],
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

test("value history: each year says its value types, file and roll, with notes of what the files show; Python agrees", () => {
  const path = build();
  configureRegistry(path);
  let p1: Record<string, unknown>[];
  let p3: Record<string, unknown>[];
  try {
    p1 = registryValueHistory(P1);
    p3 = registryValueHistory(P3);
  } finally {
    configureRegistry(undefined);
  }
  assert.deepEqual(
    p1.map((e) => [e.tax_year, e.value_types, e.roll, e.notes]),
    [
      [
        2027,
        ["market", "appraised"],
        "preliminary",
        [
          "2026-11-07 is the date the registry read this file, not a date the publisher gave for the roll.",
        ],
      ],
      [2026, ["market", "appraised"], "certified", []],
      [
        2025,
        ["market"],
        null,
        [
          "The registry holds no value of this parcel for 2024, between the 2023 and 2025 entries.",
        ],
      ],
      [
        2023,
        ["market"],
        null,
        [
          "This 2023 value comes from a file dated 2026-11-09, after the 2023 roll year: it is the roll as the publisher held it on that date, which can differ from the roll as certified.",
        ],
      ],
    ],
  );
  assert.deepEqual(p1[3]!.file, {
    source_id: "tx-x-cad-2023",
    filename: "Real_acct_owner.zip",
    as_of: "2026-11-09",
    read_on: "2026-11-12",
  });
  assert.deepEqual(p3[0]!.notes, [
    "2026-11-02 is the date the registry read this file, not a date the publisher gave for the roll.",
    "The 2025 and 2026 values come from files dated 2026-11-02 and 2026-11-02, the days the registry read them, so neither date is a certification date.",
  ]);
  const py = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json, sys; from factlot.registry.store import Registry; r = Registry.open_readonly(sys.argv[1]); print(json.dumps([r.value_history(u) for u in sys.argv[2:]]))",
        path,
        P1,
        P3,
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONPATH: python } },
    ),
  ) as unknown;
  assert.deepEqual(py, JSON.parse(JSON.stringify([p1, p3])));
});
