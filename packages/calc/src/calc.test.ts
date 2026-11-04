// Expected values were computed independently (Python, decimal rounding), not from this code.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CalcInputError,
  addMonths,
  annualConstant,
  calculators,
  camReconciliation,
  debtSizing,
  irr,
  leaseRemeasurementAsc842,
  netEffectiveRent,
  npv,
  rentSchedule,
  round,
  walt,
} from "./index.ts";

test("round is half-away-from-zero on decimal values", () => {
  assert.equal(round(1.005), 1.01);
  assert.equal(round(-1.005), -1.01);
  assert.equal(round(27318.175), 27318.18);
  assert.equal(round(1e-9, 2), 0);
  assert.equal(Object.is(round(-0.001), -0), false);
});

test("addMonths clamps to month end without drifting", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-15", -12), "2025-11-15");
});

test("rent schedule with 3% bumps and 3 months free", () => {
  const r = rentSchedule({
    commencement_date: "2026-01-01",
    term_months: 60,
    area_sf: 10_000,
    starting_rent_psf_annual: 30,
    escalation: { type: "percent", rate: 0.03 },
    abated_months: [1, 2, 3],
  });
  assert.equal(r.formula.id, "calc.rent_schedule");
  assert.equal(r.value.expiration_date, "2030-12-31");
  assert.deepEqual(
    r.value.steps.map((s) => s.monthly_rent),
    [25_000, 25_750, 26_522.5, 27_318.18, 28_137.72],
  );
  assert.equal(r.value.steps[0]?.abated_months, 3);
  assert.equal(r.value.total_scheduled_rent, 1_592_740.8);
  assert.equal(r.value.total_abatement, 75_000);
  assert.equal(r.value.total_rent_due, 1_517_740.8);
  assert.equal(r.value.monthly, undefined);
  assert.ok(r.steps.length > 0);
});

test("rent schedule rejects abatement beyond the term and bad input", () => {
  const base = {
    commencement_date: "2026-01-01",
    term_months: 12,
    area_sf: 1000,
    starting_rent_psf_annual: 20,
  };
  assert.throws(
    () => rentSchedule({ ...base, abated_months: [13] }),
    CalcInputError,
  );
  assert.throws(
    () => rentSchedule({ ...base, commencement_date: "2026-02-30" }),
    CalcInputError,
  );
  assert.throws(() => rentSchedule({ ...base, area_sf: -5 }), CalcInputError);
});

test("net effective rent, straight-line and discounted", () => {
  const schedule = {
    commencement_date: "2026-01-01",
    term_months: 120,
    area_sf: 10_000,
    starting_rent_psf_annual: 40,
    abated_months: [1, 2, 3, 4, 5, 6],
  };
  const r = netEffectiveRent({
    schedule,
    ti_allowance_psf: 50,
    leasing_commissions: 100_000,
    discount_rate_annual: 0.08,
  });
  assert.equal(r.value.total_landlord_costs, 600_000);
  assert.equal(r.value.net_effective_rent_psf, 32);
  assert.equal(r.value.pv_rent, 2_568_980.49);
  assert.equal(r.value.discounted_net_effective_rent_psf, 28.4772);

  const flat = netEffectiveRent({
    schedule,
    ti_allowance_psf: 50,
    leasing_commissions: 100_000,
  });
  assert.equal(
    flat.value.discounted_net_effective_rent_psf,
    flat.value.net_effective_rent_psf,
  );
});

const camBase = {
  year: 2026,
  pro_rata_share: 0.1,
  expenses: [
    { category: "real estate taxes", amount: 300_000, controllable: false },
    { category: "insurance", amount: 50_000, controllable: false },
    { category: "janitorial", amount: 200_000, variable: true },
    { category: "repairs & maintenance", amount: 150_000 },
    { category: "roof replacement", amount: 400_000, recoverable: false },
  ],
  gross_up: { actual_occupancy: 0.8, target_occupancy: 0.95 },
  estimates_paid: 60_000,
};

test("CAM reconciliation with gross-up and compounding cap", () => {
  const r = camReconciliation({
    ...camBase,
    cap: {
      method: "compounding_from_base",
      rate: 0.05,
      reference_amount: 30_000,
      years_elapsed: 3,
    },
  });
  assert.equal(r.value.recoverable_expenses, 700_000);
  assert.equal(r.value.grossed_up_expenses, 737_500);
  assert.equal(r.value.tenant_share_controllable, 38_750);
  assert.equal(r.value.tenant_share_uncontrollable, 35_000);
  assert.equal(r.value.cap_limit, 34_728.75);
  assert.equal(r.value.cap_reduction, 4_021.25);
  assert.equal(r.value.tenant_charge, 69_728.75);
  assert.equal(r.value.balance_due, 9_728.75);
});

test("CAM cap methods differ exactly as defined", () => {
  const limit = (cap: Parameters<typeof camReconciliation>[0]["cap"]) =>
    camReconciliation({ ...camBase, cap }).value.cap_limit;
  assert.equal(
    limit({
      method: "simple_from_base",
      rate: 0.05,
      reference_amount: 30_000,
      years_elapsed: 3,
    }),
    34_500,
  );
  assert.equal(
    limit({ method: "year_over_year", rate: 0.05, reference_amount: 33_000 }),
    34_650,
  );
  assert.throws(
    () =>
      camReconciliation({
        ...camBase,
        cap: {
          method: "compounding_from_base",
          rate: 0.05,
          reference_amount: 1,
        },
      }),
    CalcInputError,
  );
});

test("CAM base year deduction and refund case", () => {
  const r = camReconciliation({
    ...camBase,
    structure: { type: "base_year", base_year_expenses: 650_000 },
    estimates_paid: 20_000,
  });
  // (38,750 + 35,000) − 65,000 = 8,750 charge; 8,750 − 20,000 = −11,250 credit.
  assert.equal(r.value.tenant_charge, 8_750);
  assert.equal(r.value.balance_due, -11_250);
});

test("debt sizing reports the binding constraint", () => {
  const base = {
    noi: 1_000_000,
    rate_annual: 0.06,
    amortization_years: 30,
    max_ltv: 0.65,
    min_dscr: 1.25,
    min_debt_yield: 0.09,
  };
  const ltvBound = debtSizing({ ...base, value: 15_000_000 });
  assert.equal(ltvBound.value.binding_constraint, "ltv");
  assert.equal(ltvBound.value.max_loan, 9_750_000);
  assert.equal(ltvBound.value.loan_by_constraint.dscr, 11_119_440.96);

  const dyBound = debtSizing({ ...base, value: 20_000_000 });
  assert.equal(dyBound.value.binding_constraint, "debt_yield");
  assert.equal(dyBound.value.max_loan, 11_111_111);

  assert.ok(Math.abs(annualConstant(0.06, 30) - 0.07194606301833083) < 1e-15);
  assert.equal(annualConstant(0.06, 0), 0.06);
  assert.throws(
    () => debtSizing({ noi: 1, rate_annual: 0.05, amortization_years: 0 }),
    CalcInputError,
  );
  assert.throws(
    () =>
      debtSizing({
        noi: 1,
        rate_annual: 0.05,
        amortization_years: 0,
        max_ltv: 0.6,
      }),
    CalcInputError,
  );
});

test("WALT by area and by rent", () => {
  const leases = [
    { expiration_date: "2031-01-01", area_sf: 10_000, annual_rent: 500_000 },
    { expiration_date: "2028-01-01", area_sf: 30_000, annual_rent: 600_000 },
    { expiration_date: "2025-06-30", area_sf: 0.0001, annual_rent: 0.0001 },
  ];
  const byArea = walt({ as_of: "2026-01-01", leases: leases.slice(0, 2) });
  assert.equal(byArea.value.walt_years, 2.7488);
  assert.equal(
    walt({ as_of: "2026-01-01", weight_by: "rent", leases: leases.slice(0, 2) })
      .value.walt_years,
    3.3626,
  );
  const withExpired = walt({ as_of: "2026-01-01", leases });
  assert.equal(withExpired.value.expired_count, 1);
  assert.equal(withExpired.warnings.length, 1);
});

test("IRR and NPV", () => {
  const r = irr({ cash_flows: [-100, 10, 10, 110] });
  assert.ok(Math.abs(r.value.irr_periodic - 0.1) < 1e-8);
  assert.equal(
    npv({ cash_flows: [-100, 10, 10, 110], rate: 0.1 }).value.npv,
    0,
  );
  const monthly = irr({
    cash_flows: [-100, ...Array(11).fill(1), 101],
    periods_per_year: 12,
  });
  assert.ok(Math.abs(monthly.value.irr_annual - 0.12682503013196977) < 1e-7);
  assert.throws(() => irr({ cash_flows: [100, 10] }), CalcInputError);
  const multi = irr({ cash_flows: [-100, 230, -132] });
  assert.deepEqual(multi.value.roots, [0.1, 0.2]);
  assert.equal(multi.value.irr_periodic, 0.1);
  assert.equal(multi.warnings.length, 1);
});

test("every registered calculator has a matching formula id", () => {
  for (const [name, c] of Object.entries(calculators)) {
    assert.equal(c.id, `calc.${name}`);
    assert.ok(Number.isInteger(c.version) && c.version >= 1);
    assert.equal(typeof c.run, "function");
  }
});

test("round strips binary noise before rounding half away from zero", () => {
  assert.equal(round((95.58 * 245051) / 12), 1951831.22);
  assert.equal(round(0.1 + 0.2, 1), 0.3);
  assert.equal(round(2.675), 2.68);
  assert.equal(round(-2.675), -2.68);
  assert.equal(round(1.5e-7, 2), 0);
  assert.equal(round(0.000155, 4), 0.0002);
  assert.equal(round(9.995), 10);
  assert.equal(round(123456789.125, 2), 123456789.13);
  assert.equal(round(1234.5, 0), 1235);
});

test("every calculator input field is described for agents", async () => {
  const { z } = await import("zod");
  const missing: string[] = [];
  const walk = (s: unknown, path: string): void => {
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, unknown>;
    const props = o.properties as
      Record<string, Record<string, unknown>> | undefined;
    for (const [k, v] of Object.entries(props ?? {})) {
      if (k !== "type" && typeof v.description !== "string")
        missing.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
    for (const key of ["items", "oneOf", "anyOf"]) {
      const sub = o[key];
      for (const x of Array.isArray(sub) ? sub : sub ? [sub] : [])
        walk(x, path);
    }
  };
  for (const [name, c] of Object.entries(calculators)) {
    walk(
      z.toJSONSchema(c.input, { io: "input", unrepresentable: "any" }),
      name,
    );
  }
  assert.deepEqual(missing, []);
});

test("irr@2: a long series reports no spurious roots near -100%", () => {
  // 200 alternating flows: (1 + r)^t underflows to 0 for r near -1 and the NPV there is NaN.
  // calc.irr@1 bracketed those NaN values and reported roots at -99.99%, -99% and -98%.
  const flows = Array.from(
    { length: 200 },
    (_, i) => (i % 2 ? 1 : -1) * (1 + (i % 7)),
  );
  const r = irr({ cash_flows: flows });
  assert.equal(r.formula.version, 2);
  assert.ok(r.value.roots.every((x) => x > -0.9));
  assert.deepEqual(r.warnings, []);
});

test("debt sizing without stress or an existing loan keeps the v2 result shape", () => {
  const r = debtSizing({
    noi: 1_000_000,
    value: 15_000_000,
    rate_annual: 0.06,
    amortization_years: 30,
    max_ltv: 0.65,
  });
  assert.deepEqual(Object.keys(r.value).sort(), [
    "annual_constant",
    "annual_debt_service",
    "binding_constraint",
    "loan_by_constraint",
    "max_loan",
    "resulting",
  ]);
});

test("asc842@2: every schedule row rolls forward in cents and the totals foot", () => {
  // Deterministic pseudo-random inputs (LCG), so the invariant is checked on many shapes.
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const cents = (x: number): number => Math.round(x * 100);
  for (let c = 0; c < 300; c++) {
    const n = 1 + Math.floor(rand() * 120);
    const payments = [];
    for (let k = 1; k <= n; k++)
      if (rand() < 0.85)
        payments.push({ period: k, amount: round(rand() * 90_000, 2) });
    if (!payments.length) payments.push({ period: n, amount: 1000 });
    const r = leaseRemeasurementAsc842({
      classification: rand() < 0.5 ? "operating" : "finance",
      payments,
      remaining_periods: n,
      payment_timing: rand() < 0.5 ? "begin" : "end",
      discount_rate_annual: rand() < 0.1 ? 0 : round(rand() * 0.15, 4),
      periods_per_year: [12, 4, 1][Math.floor(rand() * 3)] ?? 12,
      discount_rate_updated: true,
      liability_before: round(rand() * 3e6, 2),
      rou_asset_before: round(rand() * 3e6, 2),
      event: "modification_extend_term",
    }).value;
    let interest = 0;
    let amort = 0;
    let cost = 0;
    let rou = cents(r.new_rou_asset);
    let liability = cents(r.new_lease_liability);
    for (const row of r.schedule) {
      assert.equal(cents(row.opening_liability), liability);
      liability =
        cents(row.opening_liability) - cents(row.payment) + cents(row.interest);
      assert.equal(cents(row.closing_liability), liability, `case ${c}`);
      rou -= cents(row.amortization);
      assert.equal(cents(row.closing_rou_asset), rou, `case ${c}`);
      interest += cents(row.interest);
      amort += cents(row.amortization);
      cost += cents(row.lease_cost);
    }
    assert.equal(liability, 0);
    assert.equal(rou, 0);
    assert.equal(cents(r.total_interest), interest);
    assert.equal(cents(r.total_amortization), amort);
    assert.equal(cents(r.total_lease_cost), cost);
  }
});
