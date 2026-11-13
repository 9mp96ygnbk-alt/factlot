// What each hosted county has and lacks (site/_data/fields.json) and the one hosted count: the coverage page, the
// county map file, coverage.json, llms.txt and the market and Texas pages must agree with the pack's manifest
// (site/_data/hosted.json), because they all come from it or from the registry files it was built from.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildCoverageCatalog } from "./coverage-catalog.mjs";
import {
  FIELDS_SENTENCES,
  cellText,
  hostedFieldsTable,
  placeFieldsText,
  rollYearsText,
} from "./fields.mjs";
import { fieldsDifferences, type FieldsData } from "./gen-fields.ts";
import type { HostedData } from "./gen-hosted.ts";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const hosted = JSON.parse(read("site/_data/hosted.json")) as HostedData;
const fields = JSON.parse(read("site/_data/fields.json")) as FieldsData;
const counties = JSON.parse(read("docs/registry/coverage-counties.json")) as {
  counts: Record<string, number>;
  counties: Record<
    string,
    {
      class: string;
      commercial_parcels: number;
      data_as_of: string;
      area?: string;
    }
  >;
};
const labels = Object.fromEntries(fields.groups.map((g) => [g.key, g.label]));
const row = (fips: string) => fields.counties.find((c) => c.fips === fips)!;

describe("field availability", () => {
  it("fields.json holds exactly the hosted counties, with the pack's parcel counts and dates", () => {
    assert.deepEqual(fieldsDifferences(fields, hosted), []);
  });
  it("cells say yes, no or partial with the share", () => {
    assert.equal(cellText(0), "no");
    assert.equal(cellText(1), "yes");
    assert.equal(cellText(0.996), "yes");
    assert.equal(cellText(0.64), "partial (64%)");
    assert.equal(cellText(0.001), "partial (1%)");
  });
  it("what llms.txt says of Los Angeles and San Francisco is what the data holds", () => {
    for (const fips of ["06037", "06075"])
      assert.equal(row(fips).groups.owner_of_record.share, 0, fips);
    for (const file of ["llms.txt", "site/llms.txt"])
      assert.ok(read(file).includes(FIELDS_SENTENCES), file);
  });
  it("Travis: 2026 with both values, 2022 to 2025 market value only", () => {
    assert.equal(
      rollYearsText(row("48453")),
      "2026: market and appraised value; 2022 to 2025: market value only",
    );
  });
  it("Midland: no values; Denton and Williamson: a preliminary 2027 roll", () => {
    assert.equal(rollYearsText(row("48329")), "no values");
    for (const fips of ["48121", "48491"])
      assert.deepEqual(
        row(fips).roll_years.map((y) => [y.tax_year, y.preliminary]),
        [[2027, true]],
      );
  });
  it("the place paragraph names what a place lacks", () => {
    const sf = placeFieldsText("San Francisco", [row("06075")], labels);
    assert.match(sf, /It holds no owner of record, /);
    assert.match(sf, /Roll years held: 2025: appraised value only\./);
    assert.doesNotMatch(sf, /Owners of record are kept/);
  });
  it("the coverage table has one row per hosted county", () => {
    const html = hostedFieldsTable(fields);
    assert.equal(
      (html.match(/<tr><th scope="row">/g) ?? []).length,
      hosted.counties.length,
    );
    assert.match(
      html,
      /Suffolk County, MA <span class="small">\(the City of Boston only\)/,
    );
  });
  it("coverage.json carries each county's fields", () => {
    const cat = buildCoverageCatalog({
      hosted,
      fields,
      configs: new Map(),
      toolNames: [],
      version: "0",
      idExampleUrn: () => "x",
    }) as {
      places: {
        counties: {
          fips: string;
          fields?: { shares: Record<string, number> };
        }[];
      }[];
    };
    const all = cat.places.flatMap((p) => p.counties);
    assert.equal(all.length, hosted.counties.length);
    assert.ok(all.every((c) => c.fields));
    assert.equal(
      all.find((c) => c.fips === "11001")!.fields!.shares.recorded_sales,
      row("11001").groups.recorded_sales.share,
    );
  });
});

describe("one hosted count", () => {
  it("the county map file marks exactly the pack's counties, with its counts and dates", () => {
    const mapHosted = Object.entries(counties.counties)
      .filter(([, c]) => c.class === "hosted")
      .map(([f]) => f)
      .sort();
    assert.deepEqual(mapHosted, hosted.counties.map((c) => c.fips).sort());
    assert.equal(counties.counts.hosted, hosted.totals.counties);
    for (const c of hosted.counties) {
      const m = counties.counties[c.fips]!;
      assert.deepEqual(
        [m.commercial_parcels, m.data_as_of],
        [c.parcels, c.as_of],
        c.name,
      );
    }
    // Travis: one count and one date everywhere (the pack's), and llms.txt states the same count.
    const travis = hosted.counties.find((c) => c.fips === "48453")!;
    assert.equal(
      counties.counties["48453"]!.commercial_parcels,
      travis.parcels,
    );
    assert.ok(
      read("llms.txt").includes(
        `Travis ${new Intl.NumberFormat("en-US").format(travis.parcels)}`,
      ),
    );
  });
  it("the coverage page does not call a county loaded unless the hosted API serves it", () => {
    const tpl = read("site/_content/coverage.html");
    assert.doesNotMatch(tpl, /Loaded, not\s+yet audited/);
    assert.match(
      tpl,
      /Built in the open-source pipeline, not on the hosted API/,
    );
  });
});
