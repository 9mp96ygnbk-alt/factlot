// Expected values computed independently in Python (decimal rounding), not from this code.
import assert from "node:assert/strict";
import test from "node:test";

import { CalcInputError, compareProposals, percentageRent } from "./index.ts";

const A = {
  name: "Tower A",
  schedule: {
    commencement_date: "2027-01-01",
    term_months: 60,
    area_sf: 5000,
    starting_rent_psf_annual: 35,
    escalation: { type: "percent" as const, rate: 0.03 },
    abated_months: [1, 2, 3],
  },
  ti_allowance_psf: 40,
  leasing_commissions: 30_000,
};
const B = {
  name: "Park B",
  schedule: {
    commencement_date: "2027-01-01",
    term_months: 84,
    area_sf: 5000,
    starting_rent_psf_annual: 32,
    escalation: { type: "percent" as const, rate: 0.03 },
    abated_months: [1, 2, 3, 4, 5, 6],
  },
  ti_allowance_psf: 60,
  leasing_commissions: 45_000,
  additional_costs_psf_annual: 9,
  tenant_upfront_costs: 25_000,
};

test("tenant perspective ranks by effective occupancy cost, including NNN expenses", () => {
  const r = compareProposals({ proposals: [B, A], discount_rate_annual: 0.08 });
  assert.equal(r.value.metric, "effective_occupancy_cost_psf");
  assert.equal(r.value.best, "Tower A");
  assert.deepEqual(
    r.value.ranking.map((p) => [p.name, p.metric_psf_annual, p.total_net]),
    [
      ["Tower A", 25.2203, 685_348.69],
      ["Park B", 30.558, 1_185_993.82],
    ],
  );
});

test("landlord perspective ranks by discounted NER", () => {
  const r = compareProposals({ perspective: "landlord", proposals: [A, B] });
  assert.deepEqual(
    r.value.ranking.map((p) => [p.name, p.metric_psf_annual, p.total_net]),
    [
      ["Tower A", 23.7701, 655_348.69],
      ["Park B", 18.9569, 800_993.82],
    ],
  );
});

test("proposal comparison validates input", () => {
  assert.throws(() => compareProposals({ proposals: [A] }), CalcInputError);
  assert.throws(() => compareProposals({ proposals: [A, A] }), CalcInputError);
  const gross = compareProposals({ proposals: [A, { ...A, name: "A2" }] });
  assert.ok(gross.warnings.some((w) => w.includes("tied")));
  assert.ok(gross.warnings.some((w) => w.includes("additional costs")));
});

test("percentage rent: natural, fixed, partial year, exclusions", () => {
  const base = {
    gross_sales: 5_000_000,
    rate: 0.06,
    base_rent_annual: 240_000,
  };
  const natural = percentageRent(base);
  assert.equal(natural.value.breakpoint, 4_000_000);
  assert.equal(natural.value.percentage_rent, 60_000);
  assert.equal(
    percentageRent({
      ...base,
      breakpoint: { type: "fixed", amount: 4_500_000 },
    }).value.percentage_rent,
    30_000,
  );
  const half = percentageRent({
    ...base,
    gross_sales: 2_500_000,
    period_fraction: 0.5,
  });
  assert.equal(half.value.breakpoint, 2_000_000);
  assert.equal(half.value.percentage_rent, 30_000);
  assert.equal(half.warnings.length, 1);
  const excl = percentageRent({
    ...base,
    sales_exclusions: 200_000,
    percentage_rent_paid: 50_000,
  });
  assert.equal(excl.value.percentage_rent, 48_000);
  assert.equal(excl.value.balance_due, -2_000);
  assert.equal(
    percentageRent({ ...base, gross_sales: 3_000_000 }).value.percentage_rent,
    0,
  );
});

test("compare_proposals@2 states its discounting convention in the steps", () => {
  const r = compareProposals({ proposals: [A, B] });
  const step = r.steps.find((s) => s.label === "Discounting");
  assert.ok(String(step?.value).includes("start of each month"));
  assert.ok(r.warnings.some((w) => w.startsWith("Terms differ (60 to 84")));
});

test("compare_proposals names a defaulted discount rate and a tenant-side gross expense estimate, and only then", () => {
  const gross = {
    ...A,
    operating_expenses: { type: "gross" as const, expense_psf_annual: 12 },
  };
  const warns = (input: Parameters<typeof compareProposals>[0]): string[] =>
    compareProposals(input).warnings.filter((w) =>
      /discount_rate_annual not given|full-service gross/.test(w),
    );
  assert.deepEqual(
    warns({
      proposals: [
        gross,
        { ...B, operating_expenses: { type: "nnn", expense_psf_annual: 12 } },
      ],
    }).map((w) => w.slice(0, 30)),
    ["Tower A is full-service gross ", "discount_rate_annual not given"],
  );
  // The rate given, or the landlord's side (where the gross estimate is the landlord's cost): no such warning.
  assert.deepEqual(
    warns({
      discount_rate_annual: 0.08,
      perspective: "landlord",
      proposals: [gross, B],
    }),
    [],
  );
  // A gross proposal with no estimate has nothing to ignore.
  assert.deepEqual(
    warns({
      discount_rate_annual: 0.07,
      proposals: [{ ...A, operating_expenses: { type: "gross" } }, B],
    }),
    [],
  );
});
