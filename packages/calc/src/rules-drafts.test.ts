// Draft rules packs: shared vectors (spec/vectors/rules/drafts), reference tables, and the draft/verified separation.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  BOSTON_BERDO_STANDARDS,
  CalcInputError,
  DRAFT_WARNING,
  NYC_LL97_EMISSIONS_FACTORS,
  NYC_LL97_OTHER_FUELS,
  WA_CBPS_ACTIVITIES,
  draftRulePacks,
  rulePacks,
  runDraftRule,
} from "./index.ts";

const dir = new URL("../../../spec/vectors/rules/drafts/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );
const OFFICIAL_HOSTS = [
  "www.nyc.gov",
  "lawfilesext.leg.wa.gov",
  "www.boston.gov",
  "statutes.capitol.texas.gov",
];

const files = readdirSync(dir).filter(
  (f) => f.endsWith(".json") && !f.endsWith(".tables.json"),
);

test("every draft pack has a vector file", () => {
  assert.deepEqual(
    files.map((f) => read(f).rule).sort(),
    Object.keys(draftRulePacks).sort(),
  );
});

for (const file of files) {
  const spec = read(file) as {
    rule: keyof typeof draftRulePacks;
    calculator: string;
    version: number;
    cases: {
      name: string;
      input: unknown;
      expect?: Record<string, unknown>;
      expect_error?: boolean;
    }[];
  };
  test(`draft rule vectors: ${spec.rule}`, () => {
    const pack = draftRulePacks[spec.rule];
    assert.ok(pack, spec.rule);
    assert.equal(pack.id, spec.calculator);
    assert.equal(pack.version, spec.version);
    for (const c of spec.cases) {
      if (c.expect_error) {
        assert.throws(
          () => runDraftRule(spec.rule, c.input, { acknowledgeDraft: true }),
          CalcInputError,
          c.name,
        );
        continue;
      }
      const result = runDraftRule(spec.rule, c.input, {
        acknowledgeDraft: true,
      }) as { warnings: string[] };
      for (const [path, expected] of Object.entries(c.expect ?? {}))
        assert.deepEqual(at(result, path), expected, `${c.name} → ${path}`);
      assert.ok(
        result.warnings[0]?.startsWith(DRAFT_WARNING),
        `${c.name}: the first warning is the draft warning`,
      );
    }
  });
}

test("draft packs are marked draft, name no verifier, and cite official sources with retrieval dates", () => {
  for (const [name, p] of Object.entries(draftRulePacks)) {
    assert.equal(p.verification.status, "draft", name);
    assert.ok(!("verified_by" in p.verification), name);
    assert.ok(!("verified_at" in p.verification), name);
    assert.ok(p.citations.length > 0, name);
    for (const c of p.citations) {
      assert.ok(OFFICIAL_HOSTS.includes(new URL(c.url).host), c.url);
      assert.match(c.retrieved, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(c.covers.length > 0);
    }
    assert.ok(p.not_covered.length > 0, name);
  }
});

test("verified and draft packs stay separate", () => {
  for (const [name, r] of Object.entries(rulePacks)) {
    assert.equal(r.verification.status, "verified", name);
    assert.ok(!(name in draftRulePacks), name);
  }
});

test("draft packs run only when the caller acknowledges the draft status", () => {
  const input = {
    building_use: "office",
    gross_floor_area_sf: 50000,
    calendar_year: 2025,
  };
  assert.throws(
    () =>
      runDraftRule("boston_berdo_emissions_standard", input, {
        acknowledgeDraft: false,
      }),
    CalcInputError,
  );
  assert.throws(
    () =>
      (runDraftRule as (n: string, i: unknown, o?: unknown) => unknown)(
        "boston_berdo_emissions_standard",
        input,
      ),
    CalcInputError,
  );
  assert.throws(
    () => runDraftRule("no_such_pack", input, { acknowledgeDraft: true }),
    CalcInputError,
  );
  const r = runDraftRule("boston_berdo_emissions_standard", input, {
    acknowledgeDraft: true,
  }) as { value: { rule: { title: string } } };
  r.value.rule.title = "changed";
  assert.notEqual(
    draftRulePacks.boston_berdo_emissions_standard.title,
    "changed",
    "results carry a copy of the metadata",
  );
});

test("NYC LL97 tables equal the reference transcription", () => {
  const ref = read("nyc_ll97.tables.json");
  assert.deepEqual(
    NYC_LL97_EMISSIONS_FACTORS.map((r) => [...r]),
    ref.emissions_factors_tco2e_per_sf.map((r: Record<string, string>) => [
      r.property_type,
      Number(r["2024-2029"]),
      Number(r["2030-2034"]),
    ]),
  );
  assert.deepEqual(
    NYC_LL97_OTHER_FUELS.map((r) => [...r]),
    ref.other_fuels_tco2e_per_kbtu.map((r: Record<string, string>) => [
      r.fuel,
      r.label,
      Number(r["2024-2034"]),
    ]),
  );
});

test("WA CBPS tables equal the reference transcription", () => {
  const ref = read("wa_cbps.tables.json");
  const num = (v: string | null) => (v === null ? null : Number(v));
  assert.deepEqual(
    WA_CBPS_ACTIVITIES.map((r) => [...r]),
    ref.activities.map(
      (a: {
        no: number;
        type: string;
        subtype: string;
        detail: string;
        eui_target_1: Record<string, string | null>;
        shift_factor: Record<string, string> | null;
      }) => [
        a.no,
        a.type,
        a.subtype,
        a.detail,
        num(a.eui_target_1["4C"] ?? null),
        num(a.eui_target_1["5B"] ?? null),
        num(a.shift_factor?.["50_or_less"] ?? null),
        num(a.shift_factor?.["51_to_167"] ?? null),
        num(a.shift_factor?.["168"] ?? null),
      ],
    ),
  );
});

test("Boston BERDO table equals the reference transcription", () => {
  const ref = read("boston_berdo.tables.json");
  const periods = [
    "2025-2029",
    "2030-2034",
    "2035-2039",
    "2040-2044",
    "2045-2049",
    "2050-",
  ];
  assert.deepEqual(
    BOSTON_BERDO_STANDARDS.map((r) => [...r]),
    ref.standards_kgco2e_per_sf.map((r: Record<string, string>) => [
      r.building_use,
      r.label,
      ...periods.map((p) => Number(r[p])),
    ]),
  );
});
