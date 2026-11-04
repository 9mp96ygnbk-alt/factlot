// Properties of the operations calculators that the shared vectors cannot express: units that
// change labels but never numbers, rent rolls and capex schedules that foot, and batch CAM
// statements identical to the single-tenant calculator.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CalcInputError,
  LeaseUnit,
  camBatchTenantInput,
  camReconciliation,
  camReconciliationBatch,
  CamReconciliationBatchInput,
  capexRecovery,
  compareProposals,
  multifamilyRentRoll,
  netEffectiveRent,
  rentSchedule,
} from "./index.ts";
import type {
  MultifamilyRentRoll,
  MultifamilySingleLeaseResult,
} from "./index.ts";

const SCHEDULE = {
  commencement_date: "2026-01-15",
  term_months: 60,
  area_sf: 2400,
  starting_rent_psf_annual: 1740,
  escalation: { type: "fixed_psf" as const, amount: 36 },
  abated_months: [1, 2],
};

/** Every number in `a` and `b` agrees, ignoring strings (labels). */
function sameNumbers(a: unknown, b: unknown, where = ""): void {
  if (typeof a === "number" || typeof b === "number") {
    assert.equal(a, b, where);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, where);
    a.forEach((x, i) => sameNumbers(x, b[i], `${where}[${i}]`));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of Object.keys(a))
      sameNumbers(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${where}.${k}`,
      );
  }
}

test("unit absent: lease outputs are unchanged and carry no unit fields", () => {
  const r = rentSchedule(SCHEDULE);
  assert.ok(!("unit" in r.value) && !("rate_unit" in r.value));
  const n = netEffectiveRent({
    schedule: SCHEDULE,
    discount_rate_annual: 0.08,
  });
  assert.ok(!("rate_unit" in n.value));
  assert.ok(n.steps.some((s) => s.unit === "USD/sf/yr"));
  assert.ok(!n.warnings.some((w) => w.startsWith("Unit is")));
});

test("every unit gives the same numbers as square feet, with its own labels", () => {
  const base = rentSchedule(SCHEDULE);
  const ner = netEffectiveRent({
    schedule: SCHEDULE,
    ti_allowance_psf: 50,
    discount_rate_annual: 0.08,
  });
  for (const unit of LeaseUnit.options) {
    const r = rentSchedule({ ...SCHEDULE, unit });
    sameNumbers(r.value, base.value, unit);
    assert.equal(r.value.unit, unit);
    const n = netEffectiveRent({
      schedule: { ...SCHEDULE, unit },
      ti_allowance_psf: 50,
      discount_rate_annual: 0.08,
    });
    sameNumbers(n.value, ner.value, unit);
    assert.equal(n.value.rate_unit, r.value.rate_unit);
    assert.ok(n.steps.some((s) => s.unit === n.value.rate_unit));
    if (unit !== "sf") {
      assert.ok(
        r.warnings.some((w) => w.startsWith(`Unit is ${unit}:`)),
        `${unit} warning`,
      );
      assert.ok(!n.steps.some((s) => s.unit === "USD/sf/yr"), unit);
    }
  }
  const kw = rentSchedule({ ...SCHEDULE, unit: "kw" });
  assert.equal(kw.value.rate_unit, "USD/kW/yr");
  assert.ok(kw.steps.some((s) => s.value === "+$36/kW/yr every 12 months"));
});

test("compare_proposals: units rank per unit and must match across proposals", () => {
  const p = (name: string, rent: number, unit?: LeaseUnit) => ({
    name,
    schedule: {
      ...SCHEDULE,
      starting_rent_psf_annual: rent,
      ...(unit ? { unit } : {}),
    },
  });
  const sf = compareProposals({ proposals: [p("A", 1700), p("B", 1750)] });
  const kw = compareProposals({
    proposals: [p("A", 1700, "kw"), p("B", 1750, "kw")],
  });
  sameNumbers(kw.value.ranking, sf.value.ranking);
  assert.equal(kw.value.rate_unit, "USD/kW/yr");
  assert.ok(!("rate_unit" in sf.value));
  assert.throws(
    () => compareProposals({ proposals: [p("A", 1700, "kw"), p("B", 1750)] }),
    CalcInputError,
  );
  assert.throws(
    () =>
      compareProposals({
        proposals: [
          { ...p("A", 1700, "acre"), load_factor: 1.1 },
          p("B", 1750, "acre"),
        ],
      }),
    CalcInputError,
  );
});

const ROLL = {
  as_of: "2026-11-01",
  include_units: true,
  units: [
    {
      unit_id: "1",
      unit_type: "1x1",
      sf: 700,
      status: "occupied" as const,
      market_rent: 1500,
      lease_rent: 1450,
      lease_start: "2026-03-01",
      lease_end: "2027-02-28",
      concession: { type: "weeks_free" as const, weeks: 6 },
    },
    {
      unit_id: "2",
      unit_type: "1x1",
      sf: 700,
      status: "vacant" as const,
      market_rent: 1500,
    },
    {
      unit_id: "3",
      bedrooms: 2,
      sf: 1000,
      status: "notice" as const,
      market_rent: 2000,
      lease_rent: 1990,
      lease_term_months: 12,
      lease_end: "2026-12-31",
      concession: { type: "amount" as const, amount: 600 },
    },
    {
      unit_id: "4",
      bedrooms: 0,
      sf: 480,
      status: "down" as const,
      market_rent: 1100,
    },
  ],
};

test("rent roll foots: GPR less losses equals effective rent income", () => {
  const v = multifamilyRentRoll(ROLL).value as MultifamilyRentRoll;
  assert.equal(v.mode, "rent_roll");
  const waterfall =
    v.gross_potential_rent_monthly -
    v.vacancy_loss_monthly -
    v.non_revenue_units_monthly -
    v.loss_to_lease_monthly -
    v.concessions_monthly;
  assert.equal(
    Math.round(waterfall * 100),
    Math.round(v.effective_rent_income_monthly * 100),
  );
  const perUnit = (v.units ?? []).reduce(
    (a, u) => a + (u.effective_rent ?? 0),
    0,
  );
  assert.equal(
    Math.round(perUnit * 100),
    Math.round(v.effective_rent_income_monthly * 100),
  );
  assert.deepEqual(
    v.unit_types.map((g) => g.unit_type),
    ["1x1", "2BR", "studio"],
  );
  assert.equal(v.units_by_status.down, 1);
  assert.equal(v.physical_occupancy, 0.5);
});

test("single-lease mode: one month free on 12 months is lease rent less a twelfth", () => {
  const r = multifamilyRentRoll({
    lease: {
      lease_rent: 1800,
      lease_term_months: 12,
      concession: { type: "months_free", months: 1 },
    },
  });
  const v = r.value as MultifamilySingleLeaseResult;
  assert.equal(v.effective_monthly_rent, 1650);
  assert.equal(r.formula.id, "calc.multifamily_rent_roll");
});

test("rent roll input errors name the unit", () => {
  assert.throws(
    () =>
      multifamilyRentRoll({
        as_of: "2026-11-01",
        units: [{ unit_id: "9", status: "occupied", market_rent: 1 }],
      }),
    (e: unknown) =>
      e instanceof CalcInputError && e.issues[0]?.path === "units.0.lease_rent",
  );
});

test("capex schedules foot: principal sums to cost and level payments are level", () => {
  for (const method of ["straight_line", "level_payment"] as const)
    for (const [cost, years, rate] of [
      [100000, 5, 0.08],
      [987654.32, 12, 0.065],
      [1000.01, 3, 0],
      [50, 30, 0.1],
    ] as const) {
      const v = capexRecovery({
        cost,
        amortization_years: years,
        interest_rate_annual: rate,
        method,
      }).value;
      assert.equal(v.total_principal, cost, `${method} ${cost}`);
      assert.equal(v.schedule.at(-1)?.closing_balance, 0);
      for (const y of v.schedule)
        assert.equal(
          Math.round((y.opening_balance - y.principal) * 100),
          Math.round(y.closing_balance * 100),
        );
      if (method === "level_payment" && rate > 0)
        for (const y of v.schedule.slice(0, -1))
          assert.equal(y.amortization, v.annual_payment);
      assert.equal(v.total_unrecovered, 0);
    }
});

test("capex echoes every assumption with its clause", () => {
  const r = capexRecovery({
    cost: 10000,
    amortization_years: 2,
    clauses: { cost: "§6.2", method: "§6.2(c)" },
  });
  assert.deepEqual(
    r.value.assumptions.map((a) => [a.assumption, a.clause]),
    [
      ["cost", "§6.2"],
      ["amortization_period", null],
      ["interest", null],
      ["method", "§6.2(c)"],
      ["cost_savings_cap", null],
      ["pro_rata_share", null],
    ],
  );
});

const BATCH = {
  year: 2026,
  expenses: [
    { category: "taxes", amount: 300000, controllable: false },
    { category: "janitorial", amount: 120000, variable: true },
    { category: "repairs", amount: 80000 },
    { category: "marketing", amount: 15000 },
  ],
  gross_up: { actual_occupancy: 0.82 },
  tenants: [
    {
      name: "A",
      pro_rata_share: 0.3,
      estimates_paid: 50000,
      admin_fee: { rate: 0.12, capped: true },
      cap: {
        method: "simple_from_base" as const,
        rate: 0.05,
        reference_amount: 40000,
        years_elapsed: 2,
      },
      excluded_categories: ["marketing"],
    },
    {
      name: "B",
      pro_rata_share: 0.45,
      structure: { type: "base_year" as const, base_year_expenses: 400000 },
      occupancy: { move_out_date: "2026-06-30" },
    },
  ],
};

test("batch statements equal the single-tenant calculator, and reasons sum to unrecovered", () => {
  const r = camReconciliationBatch(BATCH);
  const parsed = CamReconciliationBatchInput.parse(BATCH);
  r.value.tenants.forEach((t, i) => {
    assert.deepEqual(
      t.statement,
      camReconciliation(camBatchTenantInput(parsed, i)),
    );
  });
  // The same tenant entered by hand as a single-tenant input.
  assert.deepEqual(
    r.value.tenants[0]?.statement,
    camReconciliation({
      year: 2026,
      pro_rata_share: 0.3,
      estimates_paid: 50000,
      admin_fee: { rate: 0.12, capped: true },
      cap: BATCH.tenants[0]?.cap,
      gross_up: { actual_occupancy: 0.82 },
      expenses: [
        { category: "taxes", amount: 300000, controllable: false },
        { category: "janitorial", amount: 120000, variable: true },
        { category: "repairs", amount: 80000 },
        { category: "marketing", amount: 15000, recoverable: false },
      ],
    }),
  );
  const b = r.value.building;
  const reasons = b.unrecovered_reasons.reduce((a, x) => a + x.amount, 0);
  assert.equal(Math.round(reasons * 100), Math.round(b.unrecovered * 100));
  assert.ok(
    Math.abs(
      b.unrecovered_reasons.find((x) => x.reason === "rounding")?.amount ?? 1,
    ) <= 0.05,
  );
});

test("batch input errors carry the tenant's path", () => {
  assert.throws(
    () =>
      camReconciliationBatch({
        ...BATCH,
        tenants: [
          {
            name: "A",
            pro_rata_share: 0.3,
            cap: {
              method: "simple_from_base",
              rate: 0.05,
              reference_amount: 1,
            },
          },
        ],
      }),
    (e: unknown) => e instanceof CalcInputError && /tenants\.0/.test(e.message),
  );
});
