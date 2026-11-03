import { z } from "zod";

import {
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { annualConstant } from "./debt.ts";
import { npvAt } from "./finance.ts";

const GrowthRate = z
  .number()
  .finite()
  .min(0)
  .lt(1)
  .default(0)
  .describe(
    "Annual growth applied to expenses after year 1, e.g. 0.03 (year k = year-1 amount × (1 + g)^(k − 1)).",
  );

export const LeaseRentInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("schedule"),
      annual_rent: z
        .array(NonNegMoney)
        .min(1)
        .max(50)
        .describe(
          "Rent due in each year of the horizon, USD, year 1 first. Must have exactly horizon_years entries.",
        ),
    })
    .describe("Explicit rent per year."),
  z
    .object({
      type: z.literal("escalating"),
      base_rent_annual: NonNegMoney.describe("Year-1 rent, USD per year."),
      escalation_rate_annual: z
        .number()
        .finite()
        .min(0)
        .lt(1)
        .default(0)
        .describe(
          "Compounding annual bump, e.g. 0.03: rent_k = base × (1 + e)^(k − 1).",
        ),
    })
    .describe("Base rent with a compounding annual escalation."),
]);

export const LeaseVsOwnInput = z
  .object({
    horizon_years: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe(
        "Analysis horizon in years. Both cases are compared over this period; the own case sells at the end of it.",
      ),
    discount_rate_annual: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .describe(
        "Annual discount rate as a decimal, e.g. 0.08, applied to both cases' year-end cash flows (year 0 = closing / move-in).",
      ),
    lease: z
      .object({
        rent: LeaseRentInput.describe(
          "Annual rent, as an explicit schedule or base rent with escalation.",
        ),
        free_rent_months: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe(
            "Rent-free months at the start of the lease, abated from year 1 (and year 2 if more than 12). Must not exceed the horizon.",
          ),
        operating_expenses_annual: NonNegMoney.default(0).describe(
          "Year-1 operating expenses borne by the tenant on top of rent (NNN charges, utilities), USD per year.",
        ),
        expense_growth_rate_annual: GrowthRate,
        upfront_costs: NonNegMoney.default(0).describe(
          "Tenant's one-time costs at move-in not covered by allowances: TI overage, moving, security deposit treated as cost, USD.",
        ),
      })
      .describe("The lease alternative."),
    own: z
      .object({
        purchase_price: NonNegMoney.describe("Purchase price, USD."),
        closing_costs: NonNegMoney.default(0).describe(
          "Acquisition closing costs, USD (added to the purchase price for cash and for depreciable basis).",
        ),
        loan: z
          .object({
            amount: NonNegMoney.describe("Loan principal at closing, USD."),
            rate_annual: z
              .number()
              .finite()
              .min(0)
              .lt(1)
              .describe("Annual interest rate, e.g. 0.065."),
            amortization_years: z
              .number()
              .int()
              .min(0)
              .max(50)
              .describe(
                "Amortization in years with monthly payments; 0 means interest-only. Any balance outstanding at the horizon is repaid from sale proceeds.",
              ),
          })
          .optional()
          .describe("Acquisition financing. Omit for an all-cash purchase."),
        operating_expenses_annual: NonNegMoney.default(0).describe(
          "Year-1 operating expenses borne by the owner (utilities, repairs, management), USD per year.",
        ),
        capex_reserve_annual: NonNegMoney.default(0).describe(
          "Year-1 capital reserve, USD per year. Treated as a cash cost; not tax-deductible.",
        ),
        property_taxes_annual: NonNegMoney.default(0).describe(
          "Year-1 property taxes, USD per year.",
        ),
        insurance_annual: NonNegMoney.default(0).describe(
          "Year-1 property insurance, USD per year.",
        ),
        expense_growth_rate_annual: GrowthRate,
        residual: z
          .discriminatedUnion("type", [
            z
              .object({
                type: z.literal("value"),
                amount: NonNegMoney.describe(
                  "Expected gross sale price at the end of the horizon, USD.",
                ),
              })
              .describe("A stated residual value."),
            z
              .object({
                type: z.literal("exit_cap"),
                cap_rate: z
                  .number()
                  .finite()
                  .gt(0)
                  .lt(1)
                  .describe("Exit capitalization rate, e.g. 0.07."),
                stabilized_noi: NonNegMoney.describe(
                  "Stabilized NOI the property would earn if leased at market in the year after the horizon, USD per year.",
                ),
              })
              .describe(
                "Residual = stabilized NOI ÷ exit cap rate (direct capitalization).",
              ),
          ])
          .describe("How the sale price at the horizon is set."),
        selling_costs_rate: z
          .number()
          .finite()
          .min(0)
          .lt(1)
          .default(0)
          .describe(
            "Brokerage and closing costs on sale as a share of the sale price, e.g. 0.03.",
          ),
        tax: z
          .object({
            marginal_tax_rate: z
              .number()
              .finite()
              .min(0)
              .lt(1)
              .describe(
                "Combined marginal income tax rate applied to deductions and to the gain on sale, e.g. 0.26.",
              ),
            depreciation_life_years: z
              .number()
              .int()
              .min(1)
              .max(100)
              .default(39)
              .describe(
                "Straight-line depreciation life for the building (39 for US non-residential real property). No mid-month convention.",
              ),
            land_share: z
              .number()
              .finite()
              .min(0)
              .lt(1)
              .default(0.2)
              .describe(
                "Share of purchase price plus closing costs allocated to land, which is not depreciated.",
              ),
            rent_deductible: z
              .boolean()
              .default(true)
              .describe(
                "Whether rent paid in the lease case is deductible (true for an operating business).",
              ),
            interest_deductible: z
              .boolean()
              .default(true)
              .describe("Whether loan interest in the own case is deductible."),
            depreciation_deductible: z
              .boolean()
              .default(true)
              .describe("Whether depreciation in the own case is deductible."),
          })
          .optional()
          .describe(
            "Optional after-tax comparison. When omitted (the default), both cases are compared pre-tax. Operating expenses, property taxes, and insurance are always deductible when this block is present; the gain on sale is taxed at the marginal rate (no separate recapture rate).",
          ),
      })
      .describe("The purchase alternative."),
  })
  .superRefine((v, ctx) => {
    if (
      v.lease.rent.type === "schedule" &&
      v.lease.rent.annual_rent.length !== v.horizon_years
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["lease", "rent", "annual_rent"],
        message: `must have exactly horizon_years (${v.horizon_years}) entries`,
      });
    }
    if (v.lease.free_rent_months > v.horizon_years * 12) {
      ctx.addIssue({
        code: "custom",
        path: ["lease", "free_rent_months"],
        message: "must not exceed the horizon",
      });
    }
  });
export type LeaseVsOwnInput = z.input<typeof LeaseVsOwnInput>;

export interface LeaseYear {
  year: number;
  rent: number;
  free_rent: number;
  operating_expenses: number;
  upfront_costs: number;
  tax_savings: number;
  /** Net cash cost for the year (positive = outflow). */
  net: number;
}

export interface OwnYear {
  year: number;
  equity: number;
  debt_service: number;
  interest: number;
  principal: number;
  operating_expenses: number;
  capex_reserve: number;
  property_taxes: number;
  insurance: number;
  depreciation: number;
  tax_savings: number;
  sale_proceeds: number;
  /** Net cash cost for the year (positive = outflow). */
  net: number;
}

export interface LeaseVsOwn {
  horizon_years: number;
  after_tax: boolean;
  lease: { npv: number; total_cost: number };
  own: {
    npv: number;
    total_cost: number;
    residual_value: number;
    loan_balance_at_horizon: number;
    net_sale_proceeds: number;
  };
  /** NPV of owning minus NPV of leasing; negative means owning costs less. */
  difference_npv: number;
  cheaper: "lease" | "own" | "equal";
  /** Gross sale price at the horizon at which the two NPVs are equal. */
  break_even_residual_value: number;
  cash_flows: { lease: LeaseYear[]; own: OwnYear[] };
}

/** Outstanding principal after `n` monthly payments on a level-payment loan. */
function loanBalance(
  amount: number,
  rateAnnual: number,
  amortizationYears: number,
  n: number,
): number {
  if (amortizationYears === 0) return amount;
  const N = amortizationYears * 12;
  if (n >= N) return 0;
  const r = rateAnnual / 12;
  if (r === 0) return amount * (1 - n / N);
  const pN = powInt(1 + r, N);
  return (amount * (pN - powInt(1 + r, n))) / (pN - 1);
}

/**
 * Lease vs. own over a fixed horizon: NPV of each case's cash costs, year by year, with the
 * own case selling at the horizon, and the residual value at which the two are equal.
 */
export function leaseVsOwn(raw: LeaseVsOwnInput): CalcResult<LeaseVsOwn> {
  const input = parseInput(LeaseVsOwnInput, raw);
  const t = new Trace();
  const H = input.horizon_years;
  const r = input.discount_rate_annual;
  const L = input.lease;
  const O = input.own;
  const tax = O.tax;
  const taxRate = tax ? tax.marginal_tax_rate : 0;
  t.step(
    "Method",
    "cost NPV = Σ net cost_t ÷ (1 + r)^t, t = 0..H; year 0 = move-in / closing, year H includes the sale",
    tax ? "after tax" : "pre-tax (no tax block supplied)",
  );

  // --- lease case --------------------------------------------------------------------
  const rentFor = (k: number): number =>
    L.rent.type === "schedule"
      ? (L.rent.annual_rent[k - 1] as number)
      : round(
          L.rent.base_rent_annual *
            powInt(1 + L.rent.escalation_rate_annual, k - 1),
          2,
        );
  const leaseYears: LeaseYear[] = [
    {
      year: 0,
      rent: 0,
      free_rent: 0,
      operating_expenses: 0,
      upfront_costs: L.upfront_costs,
      tax_savings: 0,
      net: L.upfront_costs,
    },
  ];
  for (let k = 1; k <= H; k++) {
    const rent = rentFor(k);
    const freeMonths = Math.min(
      12,
      Math.max(0, L.free_rent_months - 12 * (k - 1)),
    );
    const free = round((rent * freeMonths) / 12, 2);
    const opex = round(
      L.operating_expenses_annual *
        powInt(1 + L.expense_growth_rate_annual, k - 1),
      2,
    );
    const deductible = (tax?.rent_deductible ? rent - free : 0) + opex;
    const savings = tax ? round(taxRate * deductible, 2) : 0;
    leaseYears.push({
      year: k,
      rent,
      free_rent: free,
      operating_expenses: opex,
      upfront_costs: 0,
      tax_savings: savings,
      net: round(rent - free + opex - savings, 2),
    });
  }
  const leaseNets = leaseYears.map((y) => y.net);
  const leaseNpvRaw = npvAt(leaseNets, r);
  const leaseNpv = t.step(
    "Lease NPV",
    round(leaseNpvRaw, 2),
    `Σ (rent − free rent + expenses − tax savings)_t ÷ (1 + ${r})^t, t = 0..${H}; ${L.free_rent_months} free months`,
    "USD",
  );

  // --- own case ----------------------------------------------------------------------
  const basis = O.purchase_price + O.closing_costs;
  const loan = O.loan;
  const loanAmount = loan ? loan.amount : 0;
  const equity = round(basis - loanAmount, 2);
  t.step(
    "Equity at closing",
    equity,
    `${fmtMoney(O.purchase_price)} + ${fmtMoney(O.closing_costs)} closing − ${fmtMoney(loanAmount)} loan`,
    "USD",
  );
  const annualDs =
    loan && loan.amount > 0
      ? round(
          loan.amount *
            annualConstant(loan.rate_annual, loan.amortization_years),
          2,
        )
      : 0;
  if (loan && loan.amount > 0) {
    t.step(
      "Annual debt service",
      annualDs,
      loan.amortization_years === 0
        ? `interest-only: ${fmtMoney(loan.amount)} × ${fmtPct(loan.rate_annual, 3)}`
        : `${fmtMoney(loan.amount)} × annual constant at ${fmtPct(loan.rate_annual, 3)} over ${loan.amortization_years} years`,
      "USD",
    );
  }
  const balanceAt = (months: number): number =>
    loan
      ? loanBalance(
          loan.amount,
          loan.rate_annual,
          loan.amortization_years,
          months,
        )
      : 0;
  const depreciableBasis = tax ? basis * (1 - tax.land_share) : 0;
  const annualDep = tax
    ? round(depreciableBasis / tax.depreciation_life_years, 2)
    : 0;
  if (tax) {
    t.step(
      "Annual depreciation",
      annualDep,
      `(${fmtMoney(basis)} × (1 − ${tax.land_share})) ÷ ${tax.depreciation_life_years} years, straight-line`,
      "USD",
    );
  }

  const ownYears: OwnYear[] = [
    {
      year: 0,
      equity,
      debt_service: 0,
      interest: 0,
      principal: 0,
      operating_expenses: 0,
      capex_reserve: 0,
      property_taxes: 0,
      insurance: 0,
      depreciation: 0,
      tax_savings: 0,
      sale_proceeds: 0,
      net: equity,
    },
  ];
  let accumulatedDep = 0;
  const g = O.expense_growth_rate_annual;
  for (let k = 1; k <= H; k++) {
    const grow = powInt(1 + g, k - 1);
    const ds =
      loan && (loan.amortization_years === 0 || k <= loan.amortization_years)
        ? annualDs
        : 0;
    const principal = round(balanceAt(12 * (k - 1)) - balanceAt(12 * k), 2);
    const interest = round(ds - principal, 2);
    const opex = round(O.operating_expenses_annual * grow, 2);
    const capex = round(O.capex_reserve_annual * grow, 2);
    const taxes = round(O.property_taxes_annual * grow, 2);
    const insurance = round(O.insurance_annual * grow, 2);
    const dep = tax && k <= tax.depreciation_life_years ? annualDep : 0;
    accumulatedDep += dep;
    const deductible =
      (tax?.interest_deductible ? interest : 0) +
      (tax?.depreciation_deductible ? dep : 0) +
      opex +
      taxes +
      insurance;
    const savings = tax ? round(taxRate * deductible, 2) : 0;
    ownYears.push({
      year: k,
      equity: 0,
      debt_service: ds,
      interest,
      principal,
      operating_expenses: opex,
      capex_reserve: capex,
      property_taxes: taxes,
      insurance,
      depreciation: dep,
      tax_savings: savings,
      sale_proceeds: 0,
      net: round(ds + opex + capex + taxes + insurance - savings, 2),
    });
  }

  // Sale at the horizon.
  const residual =
    O.residual.type === "value"
      ? O.residual.amount
      : round(O.residual.stabilized_noi / O.residual.cap_rate, 2);
  t.step(
    "Residual value",
    residual,
    O.residual.type === "value"
      ? "stated"
      : `${fmtMoney(O.residual.stabilized_noi)} NOI ÷ ${fmtPct(O.residual.cap_rate)} exit cap`,
    "USD",
  );
  const sellingCosts = round(residual * O.selling_costs_rate, 2);
  const balanceH = round(balanceAt(12 * H), 2);
  const adjustedBasis = round(basis - accumulatedDep, 2);
  const gain = round(residual - sellingCosts - adjustedBasis, 2);
  const taxOnSale = tax ? round(gain * taxRate, 2) : 0;
  const proceeds = round(residual - sellingCosts - balanceH - taxOnSale, 2);
  t.step(
    "Net sale proceeds",
    proceeds,
    `${fmtMoney(residual)} − ${fmtMoney(sellingCosts)} selling costs − ${fmtMoney(balanceH)} loan payoff${tax ? ` − ${fmtMoney(taxOnSale)} tax on gain (${fmtMoney(gain)} × ${taxRate})` : ""}`,
    "USD",
  );
  const last = ownYears[H] as OwnYear;
  const ownNetsExSale = ownYears.map((y) => y.net);
  last.sale_proceeds = proceeds;
  last.net = round(last.net - proceeds, 2);
  const ownNets = ownYears.map((y) => y.net);
  const ownNpvRaw = npvAt(ownNets, r);
  const ownNpv = t.step(
    "Own NPV",
    round(ownNpvRaw, 2),
    `Σ (equity + debt service + expenses − tax savings − sale proceeds)_t ÷ (1 + ${r})^t, t = 0..${H}`,
    "USD",
  );
  const diff = t.step(
    "Difference",
    round(ownNpv - leaseNpv, 2),
    `own NPV − lease NPV = ${fmtMoney(ownNpv)} − ${fmtMoney(leaseNpv)}`,
    "USD",
  );
  const cheaper = diff < 0 ? "own" : diff > 0 ? "lease" : "equal";
  t.step("Cheaper", cheaper, "lower NPV of cost");

  // Break-even residual: own NPV is linear in the sale price, so solve directly.
  const npvOwnExSale = npvAt(ownNetsExSale, r);
  const neededProceeds = (npvOwnExSale - leaseNpvRaw) * powInt(1 + r, H);
  const breakEven = t.step(
    "Break-even residual value",
    round(
      (neededProceeds + balanceH - taxRate * adjustedBasis) /
        ((1 - O.selling_costs_rate) * (1 - taxRate)),
      2,
    ),
    "sale price R with (R × (1 − selling costs) − loan payoff − tax on gain) ÷ (1 + r)^H = own NPV before sale − lease NPV",
    "USD",
  );

  const totalLease = round(
    leaseNets.reduce((a, b) => a + b, 0),
    2,
  );
  const totalOwn = round(
    ownNets.reduce((a, b) => a + b, 0),
    2,
  );

  if (!tax)
    t.warn(
      "Pre-tax comparison: add the tax block to reflect rent deductibility versus interest and depreciation.",
    );
  if (tax)
    t.warn(
      "Tax treatment is simplified: straight-line depreciation without a mid-month convention and one marginal rate on the gain (no depreciation recapture rate).",
    );
  if (O.residual.type === "exit_cap")
    t.warn(
      "Residual value is capitalized from an assumed stabilized NOI; the comparison is sensitive to the exit cap rate.",
    );
  if (breakEven <= 0)
    t.warn(
      "Owning costs less than leasing even with a zero sale price; the break-even residual is not meaningful.",
    );
  else if (breakEven > residual * 2 && residual > 0)
    t.warn(
      "Break-even residual is more than twice the assumed residual; leasing is strongly favored at these inputs.",
    );
  if (loan && loan.amount > basis)
    t.warn(
      "The loan exceeds the purchase price plus closing costs, so equity at closing is negative (cash out at year 0); check the loan amount.",
    );

  return t.result("calc.lease_vs_own", 2, {
    horizon_years: H,
    after_tax: tax !== undefined,
    lease: { npv: leaseNpv, total_cost: totalLease },
    own: {
      npv: ownNpv,
      total_cost: totalOwn,
      residual_value: residual,
      loan_balance_at_horizon: balanceH,
      net_sale_proceeds: proceeds,
    },
    difference_npv: diff,
    cheaper,
    break_even_residual_value: breakEven,
    cash_flows: { lease: leaseYears, own: ownYears },
  });
}
